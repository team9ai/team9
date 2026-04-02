import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import { TenantMiddleware } from './tenant.middleware.js';

function createDbMock(result: unknown[] = []) {
  const selectChain = {
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue(result),
  };

  return {
    select: jest.fn().mockReturnValue(selectChain),
    selectChain,
  };
}

describe('TenantMiddleware', () => {
  let db: ReturnType<typeof createDbMock>;
  let redisService: {
    getOrSet: jest.Mock;
  };
  let middleware: TenantMiddleware;

  beforeEach(() => {
    db = createDbMock();
    redisService = {
      getOrSet: jest.fn(),
    };
    middleware = new TenantMiddleware(db as never, redisService as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('attaches an active tenant resolved from the request header', async () => {
    const tenant = {
      id: 'tenant-1',
      slug: 'alpha',
      isActive: true,
    };
    const req = {
      headers: { 'x-tenant-id': 'alpha' },
      query: {},
    };
    const next = jest.fn();
    redisService.getOrSet.mockResolvedValue(tenant);

    await middleware.use(req as never, {} as never, next);

    expect(redisService.getOrSet).toHaveBeenCalledWith(
      'tenant:alpha',
      expect.any(Function),
      300,
    );
    expect((req as any).tenant).toEqual(tenant);
    expect((req as any).tenantId).toBe('tenant-1');
    expect(next).toHaveBeenCalled();
  });

  it('ignores inactive tenants and still calls next', async () => {
    const req = {
      headers: {},
      query: { tenant: 'beta' },
    };
    const next = jest.fn();
    redisService.getOrSet.mockResolvedValue({
      id: 'tenant-2',
      slug: 'beta',
      isActive: false,
    });

    await middleware.use(req as never, {} as never, next);

    expect((req as any).tenant).toBeUndefined();
    expect((req as any).tenantId).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it('logs and swallows tenant resolution failures', async () => {
    const warnSpy = jest.spyOn((middleware as any).logger, 'warn');
    const next = jest.fn();
    redisService.getOrSet.mockRejectedValue(new Error('redis down'));

    await middleware.use(
      {
        headers: { host: 'team9.ai' },
        query: {},
      } as never,
      {} as never,
      next,
    );

    expect(warnSpy).toHaveBeenCalledWith(
      'Failed to resolve tenant context: redis down',
    );
    expect(next).toHaveBeenCalled();
  });

  it('resolves tenants by slug, uuid, or domain', async () => {
    const tenant = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      slug: 'alpha',
      domain: 'team9.ai',
      isActive: true,
    };
    db = createDbMock([tenant]);
    middleware = new TenantMiddleware(db as never, redisService as never);

    await expect(
      (middleware as any).findTenantByIdentifier('alpha'),
    ).resolves.toBe(tenant);
    await expect(
      (middleware as any).findTenantByIdentifier(
        '123e4567-e89b-12d3-a456-426614174000',
      ),
    ).resolves.toBe(tenant);
    await expect(
      (middleware as any).findTenantByIdentifier('team9.ai'),
    ).resolves.toBe(tenant);
  });

  it('extracts identifiers by header, query, domain, localhost default, and null', () => {
    expect(
      (middleware as any).extractTenantIdentifier({
        headers: { 'x-tenant-id': 'header-tenant', host: 'team9.ai' },
        query: { tenant: 'query-tenant' },
      }),
    ).toBe('header-tenant');
    expect(
      (middleware as any).extractTenantIdentifier({
        headers: {},
        query: { tenant: 'query-tenant' },
      }),
    ).toBe('query-tenant');
    expect(
      (middleware as any).extractTenantIdentifier({
        headers: { host: 'team9.ai' },
        query: {},
      }),
    ).toBe('team9.ai');
    expect(
      (middleware as any).extractTenantIdentifier({
        headers: { host: 'localhost:3000' },
        query: {},
      }),
    ).toBe('default');
    expect(
      (middleware as any).extractTenantIdentifier({
        headers: {},
        query: {},
      }),
    ).toBeNull();
  });

  it('detects uuids and localhost hosts', () => {
    expect(
      (middleware as any).isUUID('123e4567-e89b-12d3-a456-426614174000'),
    ).toBe(true);
    expect((middleware as any).isUUID('not-a-uuid')).toBe(false);

    expect((middleware as any).isLocalhost('localhost:3000')).toBe(true);
    expect((middleware as any).isLocalhost('127.0.0.1:3000')).toBe(true);
    expect((middleware as any).isLocalhost('192.168.1.5')).toBe(true);
    expect((middleware as any).isLocalhost('10.1.2.3')).toBe(true);
    expect((middleware as any).isLocalhost('team9.ai')).toBe(false);
  });
});
