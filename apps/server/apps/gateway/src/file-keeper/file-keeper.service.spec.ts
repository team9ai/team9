import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { FileKeeperService } from './file-keeper.service.js';

type MockedFetch = jest.SpiedFunction<typeof fetch>;

function decodeJwtPayload(token: string) {
  const parts = token.split('.');
  expect(parts).toHaveLength(3);
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
}

function makeResponse(
  status: number,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
    json: jest.fn(async () => body),
    text: jest.fn(async () =>
      typeof body === 'string' ? body : JSON.stringify(body ?? {}),
    ),
  } as any;
}

describe('FileKeeperService', () => {
  const savedEnv = {
    FILE_KEEPER_BASE_URL: process.env.FILE_KEEPER_BASE_URL,
    FILE_KEEPER_JWT_SECRET: process.env.FILE_KEEPER_JWT_SECRET,
  };

  let service: FileKeeperService;
  let logger: { debug: jest.Mock<any>; warn: jest.Mock<any> };
  let fetchSpy: MockedFetch;

  beforeEach(() => {
    process.env.FILE_KEEPER_BASE_URL = 'https://file-keeper.example';
    process.env.FILE_KEEPER_JWT_SECRET = 'file-keeper-test-secret';
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-06-15T12:34:56.000Z'));

    service = new FileKeeperService();
    logger = {
      debug: jest.fn(),
      warn: jest.fn(),
    };
    (service as any).logger = logger;

    fetchSpy = jest.spyOn(globalThis as any, 'fetch');
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();

    if (savedEnv.FILE_KEEPER_BASE_URL === undefined) {
      delete process.env.FILE_KEEPER_BASE_URL;
    } else {
      process.env.FILE_KEEPER_BASE_URL = savedEnv.FILE_KEEPER_BASE_URL;
    }

    if (savedEnv.FILE_KEEPER_JWT_SECRET === undefined) {
      delete process.env.FILE_KEEPER_JWT_SECRET;
    } else {
      process.env.FILE_KEEPER_JWT_SECRET = savedEnv.FILE_KEEPER_JWT_SECRET;
    }
  });

  it('reports configuration status accurately', () => {
    expect(service.isConfigured()).toBe(true);

    delete process.env.FILE_KEEPER_BASE_URL;
    expect(new FileKeeperService().isConfigured()).toBe(false);
  });

  it('returns no workspaces when unconfigured', async () => {
    delete process.env.FILE_KEEPER_JWT_SECRET;

    const result = await service.listWorkspaces('instance-1');

    expect(result).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      'File-Keeper not configured, skipping listWorkspaces',
    );
  });

  it('merges sibling workspace directories with legacy subdirectories', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        makeResponse(200, {
          path: '.',
          entries: [
            {
              name: 'workspace-alpha',
              type: 'directory',
              modified: '2024-06-15T11:00:00.000Z',
            },
            {
              name: 'workspace-beta',
              type: 'directory',
              modified: '2024-06-15T11:30:00.000Z',
            },
            {
              name: 'notes.txt',
              type: 'file',
              modified: '2024-06-15T11:45:00.000Z',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        makeResponse(200, {
          path: 'workspace',
          entries: [
            {
              name: 'alpha',
              type: 'directory',
              modified: '2024-06-15T11:59:00.000Z',
            },
            {
              name: 'gamma',
              type: 'directory',
              modified: '2024-06-15T11:50:00.000Z',
            },
          ],
        }),
      );

    const result = await service.listWorkspaces('instance-1');

    expect(result).toEqual([
      {
        name: 'alpha',
        type: 'directory',
        modified: '2024-06-15T11:00:00.000Z',
      },
      {
        name: 'beta',
        type: 'directory',
        modified: '2024-06-15T11:30:00.000Z',
      },
      {
        name: 'gamma',
        type: 'directory',
        modified: '2024-06-15T11:50:00.000Z',
      },
    ]);

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      'https://file-keeper.example/api/instances/instance-1/data-dir?path=.',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: expect.stringContaining('Bearer '),
        }),
      }),
    );
    const rootToken = (fetchSpy.mock.calls[0]?.[1] as any)?.headers
      .Authorization as string;
    expect(decodeJwtPayload(rootToken.replace('Bearer ', '')).scopes).toEqual([
      'data-dir:ro',
    ]);
  });

  it('detects the default workspace when the workspace directory only contains files', async () => {
    fetchSpy
      .mockResolvedValueOnce(makeResponse(404, 'not found'))
      .mockResolvedValueOnce(
        makeResponse(200, {
          path: 'workspace',
          entries: [
            {
              name: 'first.md',
              type: 'file',
              modified: '2024-06-15T11:10:00.000Z',
            },
            {
              name: 'second.md',
              type: 'file',
              modified: '2024-06-15T11:20:00.000Z',
            },
          ],
        }),
      );

    const result = await service.listWorkspaces('instance-2');

    expect(result).toEqual([
      {
        name: 'default',
        type: 'directory',
        modified: '2024-06-15T11:20:00.000Z',
      },
    ]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('warns on non-404 scan failures but ignores 404s', async () => {
    fetchSpy
      .mockResolvedValueOnce(makeResponse(500, 'root boom'))
      .mockResolvedValueOnce(makeResponse(404, 'workspace missing'));

    const result = await service.listWorkspaces('instance-3');

    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to scan root for instance instance-3'),
    );
    expect(logger.warn.mock.calls[0][0]).toContain('500');
  });

  it('issues scoped tokens with the provided baseUrl override', () => {
    const result = service.issueToken(
      'instance-4',
      ['workspace-dir', 'workspace-dir:rw'],
      'https://override.example',
    );

    expect(result.baseUrl).toBe('https://override.example');
    expect(result.instanceId).toBe('instance-4');
    expect(result.expiresAt).toBe('2024-06-15T13:34:56.000Z');

    const payload = decodeJwtPayload(result.token);
    expect(payload).toMatchObject({
      iss: 'file-keeper',
      sub: 'instance-4',
      instance_id: 'instance-4',
      scopes: ['workspace-dir', 'workspace-dir:rw'],
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
  });

  it('throws when issuing a token without configuration', () => {
    delete process.env.FILE_KEEPER_BASE_URL;

    expect(() => service.issueToken('instance-5')).toThrow(
      'File-Keeper is not configured',
    );
  });

  it('returns undefined for 204 responses and uses the default request scope', async () => {
    fetchSpy.mockResolvedValueOnce(
      makeResponse(204, undefined, { 'content-length': '0' }),
    );

    await expect(
      (service as any).request(
        'POST',
        '/api/instances/instance-6/ping',
        'instance-6',
        undefined,
        'https://override.example',
      ),
    ).resolves.toBeUndefined();

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://override.example/api/instances/instance-6/ping',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: expect.stringContaining('Bearer '),
        }),
      }),
    );

    const token = (fetchSpy.mock.calls[0]?.[1] as any)?.headers
      .Authorization as string;
    expect(decodeJwtPayload(token.replace('Bearer ', '')).scopes).toEqual([
      'data-dir:ro',
    ]);
  });

  it('throws a descriptive error for non-ok responses', async () => {
    fetchSpy.mockResolvedValueOnce(makeResponse(500, 'upstream exploded'));

    await expect(
      (service as any).request(
        'GET',
        '/api/instances/instance-7/data-dir?path=.',
        'instance-7',
        ['workspace-dir'],
        'https://file-keeper.example',
      ),
    ).rejects.toThrow(
      'File-Keeper API error: GET /api/instances/instance-7/data-dir?path=. responded 500 — upstream exploded',
    );
  });
});
