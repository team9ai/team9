import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

const mockEq = jest.fn((field: unknown, value: unknown) => ({
  kind: 'eq',
  field,
  value,
}));
const mockAnd = jest.fn((...conditions: unknown[]) => ({
  kind: 'and',
  conditions,
}));
const mockDesc = jest.fn((field: unknown) => ({
  kind: 'desc',
  field,
}));

jest.unstable_mockModule('@team9/database', () => ({
  DATABASE_CONNECTION: Symbol('DATABASE_CONNECTION'),
  eq: mockEq,
  and: mockAnd,
  desc: mockDesc,
}));

jest.unstable_mockModule('@team9/database/schemas', () => ({
  resources: {
    id: 'resources.id',
    tenantId: 'resources.tenantId',
    type: 'resources.type',
    createdAt: 'resources.createdAt',
  },
  resourceUsageLogs: {
    resourceId: 'resourceUsageLogs.resourceId',
    createdAt: 'resourceUsageLogs.createdAt',
  },
}));

const { ResourcesService } = await import('./resources.service.js');
const schema = await import('@team9/database/schemas');

function createDbMock() {
  const selectLimit = jest.fn<any>().mockResolvedValue([]);
  const listOrderBy = jest.fn<any>().mockResolvedValue([]);
  const usageOffset = jest.fn<any>().mockResolvedValue([]);
  const usageLimit = jest.fn<any>().mockReturnValue({ offset: usageOffset });
  const usageOrderBy = jest.fn<any>().mockReturnValue({ limit: usageLimit });
  const selectWhere = jest.fn<any>().mockReturnValue({
    orderBy: usageOrderBy,
    limit: selectLimit,
  });
  const selectFrom = jest.fn<any>().mockReturnValue({ where: selectWhere });

  const insertReturning = jest.fn<any>().mockResolvedValue([]);
  const insertValues = jest
    .fn<any>()
    .mockReturnValue({ returning: insertReturning });

  const updateReturning = jest.fn<any>().mockResolvedValue([]);
  const updateWhere = jest
    .fn<any>()
    .mockReturnValue({ returning: updateReturning });
  const updateSet = jest.fn<any>().mockReturnValue({ where: updateWhere });

  const deleteWhere = jest.fn<any>().mockResolvedValue(undefined);

  return {
    select: jest.fn<any>().mockReturnValue({ from: selectFrom }),
    insert: jest.fn<any>().mockReturnValue({ values: insertValues }),
    update: jest.fn<any>().mockReturnValue({ set: updateSet }),
    delete: jest.fn<any>().mockReturnValue({ where: deleteWhere }),
    chains: {
      selectFrom,
      selectWhere,
      selectLimit,
      listOrderBy,
      usageOrderBy,
      usageLimit,
      usageOffset,
      insertValues,
      insertReturning,
      updateSet,
      updateWhere,
      updateReturning,
      deleteWhere,
    },
  };
}

describe('ResourcesService', () => {
  let service: ResourcesService;
  let db: ReturnType<typeof createDbMock>;

  beforeEach(() => {
    jest.clearAllMocks();
    db = createDbMock();
    service = new ResourcesService(db as never);
  });

  it('creates a resource in configuring status for the creator', async () => {
    const created = { id: 'resource-1', name: 'Vector DB' };
    db.chains.insertReturning.mockResolvedValue([created]);

    await expect(
      service.create(
        {
          type: 'mcp',
          name: 'Vector DB',
          description: 'Embeddings',
          config: { endpoint: 'https://example.com' },
        } as never,
        'user-1',
        'tenant-1',
      ),
    ).resolves.toEqual(created);

    expect(db.insert).toHaveBeenCalledWith(schema.resources);
    expect(db.chains.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.any(String),
        tenantId: 'tenant-1',
        type: 'mcp',
        name: 'Vector DB',
        description: 'Embeddings',
        config: { endpoint: 'https://example.com' },
        status: 'configuring',
        creatorId: 'user-1',
      }),
    );
  });

  it('lists resources scoped to tenant and optional type filter', async () => {
    const rows = [{ id: 'resource-1' }];
    db.chains.listOrderBy.mockResolvedValue(rows);
    db.chains.selectWhere.mockReturnValueOnce({
      orderBy: db.chains.listOrderBy,
      limit: db.chains.selectLimit,
    });

    await expect(
      service.list('tenant-1', { type: 'mcp' as never }),
    ).resolves.toEqual(rows);

    expect(mockAnd).toHaveBeenCalledWith(
      { kind: 'eq', field: schema.resources.tenantId, value: 'tenant-1' },
      { kind: 'eq', field: schema.resources.type, value: 'mcp' },
    );
    expect(mockDesc).toHaveBeenCalledWith(schema.resources.createdAt);
  });

  it('updates only provided fields for the creator', async () => {
    db.chains.selectLimit.mockResolvedValue([
      {
        id: 'resource-1',
        tenantId: 'tenant-1',
        creatorId: 'user-1',
      },
    ]);
    db.chains.updateReturning.mockResolvedValue([
      { id: 'resource-1', name: 'Updated', status: 'online' },
    ]);

    await expect(
      service.update(
        'resource-1',
        { name: 'Updated', status: 'online' } as never,
        'user-1',
        'tenant-1',
      ),
    ).resolves.toEqual({ id: 'resource-1', name: 'Updated', status: 'online' });

    expect(db.update).toHaveBeenCalledWith(schema.resources);
    expect(db.chains.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Updated',
        status: 'online',
        updatedAt: expect.any(Date),
      }),
    );
  });

  it('rejects updates from a non-creator', async () => {
    db.chains.selectLimit.mockResolvedValue([
      {
        id: 'resource-1',
        tenantId: 'tenant-1',
        creatorId: 'user-2',
      },
    ]);

    await expect(
      service.update(
        'resource-1',
        { name: 'Denied' } as never,
        'user-1',
        'tenant-1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(db.update).not.toHaveBeenCalled();
  });

  it('authorizes a new grantee with default full permissions', async () => {
    db.chains.selectLimit.mockResolvedValue([
      {
        id: 'resource-1',
        tenantId: 'tenant-1',
        creatorId: 'user-1',
        authorizations: [],
      },
    ]);
    const updated = {
      id: 'resource-1',
      authorizations: [{ granteeId: 'user-2' }],
    };
    db.chains.updateReturning.mockResolvedValue([updated]);

    await expect(
      service.authorize(
        'resource-1',
        { granteeType: 'user', granteeId: 'user-2' } as never,
        'user-1',
        'tenant-1',
      ),
    ).resolves.toEqual(updated);

    expect(db.chains.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizations: [
          expect.objectContaining({
            granteeType: 'user',
            granteeId: 'user-2',
            permissions: { level: 'full' },
            grantedBy: 'user-1',
            grantedAt: expect.any(String),
          }),
        ],
        updatedAt: expect.any(Date),
      }),
    );
  });

  it('rejects duplicate authorizations', async () => {
    db.chains.selectLimit.mockResolvedValue([
      {
        id: 'resource-1',
        tenantId: 'tenant-1',
        creatorId: 'user-1',
        authorizations: [{ granteeType: 'user', granteeId: 'user-2' }],
      },
    ]);

    await expect(
      service.authorize(
        'resource-1',
        { granteeType: 'user', granteeId: 'user-2' } as never,
        'user-1',
        'tenant-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(db.update).not.toHaveBeenCalled();
  });

  it('revokes only the matching authorization entry', async () => {
    db.chains.selectLimit.mockResolvedValue([
      {
        id: 'resource-1',
        tenantId: 'tenant-1',
        creatorId: 'user-1',
        authorizations: [
          { granteeType: 'user', granteeId: 'user-2' },
          { granteeType: 'agent', granteeId: 'agent-1' },
        ],
      },
    ]);
    const updated = { id: 'resource-1' };
    db.chains.updateReturning.mockResolvedValue([updated]);

    await expect(
      service.revoke(
        'resource-1',
        { granteeType: 'user', granteeId: 'user-2' } as never,
        'user-1',
        'tenant-1',
      ),
    ).resolves.toEqual(updated);

    expect(db.chains.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizations: [{ granteeType: 'agent', granteeId: 'agent-1' }],
        updatedAt: expect.any(Date),
      }),
    );
  });

  it('loads usage logs after confirming the resource exists', async () => {
    db.chains.selectLimit.mockResolvedValueOnce([
      {
        id: 'resource-1',
        tenantId: 'tenant-1',
        creatorId: 'user-1',
      },
    ]);
    const logs = [{ id: 'log-1' }];
    db.chains.usageOffset.mockResolvedValueOnce(logs);

    await expect(
      service.getUsageLogs('resource-1', 'tenant-1', 10, 20),
    ).resolves.toEqual(logs);

    expect(db.chains.usageLimit).toHaveBeenCalledWith(10);
    expect(db.chains.usageOffset).toHaveBeenCalledWith(20);
  });

  it('creates usage logs with nullable optional fields', async () => {
    const created = { id: 'log-1', action: 'access' };
    db.chains.insertReturning.mockResolvedValue([created]);

    await expect(
      service.createUsageLog('resource-1', {
        actorType: 'user',
        actorId: 'user-1',
        action: 'access',
      }),
    ).resolves.toEqual(created);

    expect(db.insert).toHaveBeenCalledWith(schema.resourceUsageLogs);
    expect(db.chains.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.any(String),
        resourceId: 'resource-1',
        actorType: 'user',
        actorId: 'user-1',
        action: 'access',
        routineId: null,
        executionId: null,
        metadata: null,
      }),
    );
  });

  it('heartbeats resources online and throws when the resource is missing', async () => {
    db.chains.updateReturning.mockResolvedValueOnce([{ id: 'resource-1' }]);

    await expect(service.heartbeat('resource-1')).resolves.toEqual({
      success: true,
    });

    expect(db.chains.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        lastHeartbeatAt: expect.any(Date),
        status: 'online',
        updatedAt: expect.any(Date),
      }),
    );

    db.chains.updateReturning.mockResolvedValueOnce([]);

    await expect(service.heartbeat('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('throws when a resource cannot be found in the tenant', async () => {
    db.chains.selectLimit.mockResolvedValue([]);

    await expect(service.getById('missing', 'tenant-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
