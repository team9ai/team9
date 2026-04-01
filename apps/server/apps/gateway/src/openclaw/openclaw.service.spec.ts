import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';
import { ServiceUnavailableException } from '@nestjs/common';

const mockEnv = {
  OPENCLAW_API_URL: 'https://plane.test',
  OPENCLAW_AUTH_TOKEN: 'secret-token',
};

const mockEq = jest.fn((field: unknown, value: unknown) => ({
  kind: 'eq',
  field,
  value,
}));
const mockSql = jest.fn(
  (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings: Array.from(strings),
    values,
  }),
);

jest.unstable_mockModule('@team9/database', () => ({
  DATABASE_CONNECTION: Symbol('DATABASE_CONNECTION'),
  eq: mockEq,
  sql: mockSql,
}));

jest.unstable_mockModule('@team9/database/schemas', () => ({
  messages: {
    createdAt: 'messages.createdAt',
    channelId: 'messages.channelId',
  },
  channels: {
    id: 'channels.id',
    tenantId: 'channels.tenantId',
  },
}));

jest.unstable_mockModule('@team9/shared', () => ({
  env: mockEnv,
}));

const { OpenclawService } = await import('./openclaw.service.js');

function createDbMock() {
  const selectChain = {
    from: jest.fn<any>().mockReturnThis(),
    leftJoin: jest.fn<any>().mockReturnThis(),
    where: jest.fn<any>().mockResolvedValue([]),
  };

  return {
    select: jest.fn<any>().mockReturnValue(selectChain),
    execute: jest.fn<any>().mockResolvedValue([]),
    selectChain,
  };
}

function createJsonResponse(
  body: unknown,
  status = 200,
  headers?: HeadersInit,
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: jest.fn<any>().mockResolvedValue(body),
    text: jest.fn<any>().mockResolvedValue(JSON.stringify(body)),
  };
}

describe('OpenclawService', () => {
  let service: InstanceType<typeof OpenclawService>;
  let db: ReturnType<typeof createDbMock>;
  let originalFetch: typeof global.fetch | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEnv.OPENCLAW_API_URL = 'https://plane.test';
    mockEnv.OPENCLAW_AUTH_TOKEN = 'secret-token';
    db = createDbMock();
    service = new OpenclawService(db as any);
    originalFetch = global.fetch;
    global.fetch = jest.fn<any>();
  });

  afterEach(() => {
    if (originalFetch) {
      global.fetch = originalFetch;
    } else {
      delete (global as Partial<typeof global>).fetch;
    }
  });

  it('skips API calls when the integration is not configured', async () => {
    mockEnv.OPENCLAW_API_URL = undefined as unknown as string;

    await expect(service.createInstance('instance-1')).resolves.toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('creates an instance with auth header and serialized env payload', async () => {
    const responseBody = {
      instance: { id: 'instance-1' },
      access_url: 'https://instance-1.plane.test',
    };
    (global.fetch as jest.Mock).mockResolvedValue(
      createJsonResponse(responseBody),
    );

    const result = await service.createInstance('instance-1', 'sub-a', {
      TEAM9_TOKEN: 'abc',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://plane.test/api/instances',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer secret-token',
        }),
        body: JSON.stringify({
          id: 'instance-1',
          subdomain: 'sub-a',
          env: { TEAM9_TOKEN: 'abc' },
        }),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(result).toEqual(responseBody);
  });

  it('returns null for missing instances on 404', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      createJsonResponse({ error: 'not found' }, 404),
    );

    await expect(service.getInstance('missing')).resolves.toBeNull();
  });

  it('normalizes pending and paired devices from the control plane response', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      createJsonResponse({
        devices: {
          pending: [
            {
              requestId: 'req-1',
              deviceId: 'device-1',
              displayName: 'Pending Mac',
              platform: 'darwin',
              ts: 1,
            },
          ],
          paired: [
            {
              deviceId: 'device-2',
              displayName: 'Approved PC',
              platform: 'windows',
              approvedAtMs: 2,
            },
          ],
        },
      }),
    );

    await expect(service.listDevices('instance-1')).resolves.toEqual([
      expect.objectContaining({
        request_id: 'req-1',
        deviceId: 'device-1',
        name: 'Pending Mac',
        status: 'pending',
      }),
      expect.objectContaining({
        request_id: 'device-2',
        deviceId: 'device-2',
        name: 'Approved PC',
        status: 'approved',
      }),
    ]);
  });

  it('treats 204 responses as successful no-content operations', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 204,
      headers: new Headers(),
      json: jest.fn<any>(),
      text: jest.fn<any>(),
    });

    await expect(service.deleteInstance('instance-1')).resolves.toBeUndefined();
  });

  it('wraps network failures as service unavailable errors', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('socket hang up'));

    await expect(service.listInstances()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('returns an empty search result when the query is blank', async () => {
    await expect(service.searchInstances('   ')).resolves.toEqual({
      results: [],
    });
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('maps instance search rows to the public response shape', async () => {
    db.execute.mockResolvedValue([
      {
        instance_id: 'instance-1',
        workspace_name: 'Alpha',
        workspace_id: 'workspace-1',
        bot_id: 'bot-1',
        bot_name: 'helper-bot',
      },
    ]);

    await expect(service.searchInstances('alpha')).resolves.toEqual({
      results: [
        {
          instance_id: 'instance-1',
          workspace_name: 'Alpha',
          workspace_id: 'workspace-1',
          bot_id: 'bot-1',
          bot_name: 'helper-bot',
        },
      ],
    });
  });

  it('maps workspace activity rows and normalizes dates/numbers', async () => {
    db.execute.mockResolvedValue([
      {
        instance_id: 'instance-1',
        workspace_name: 'Alpha',
        last_message_at: new Date('2026-04-02T00:00:00.000Z'),
        messages_last_7d: '3',
      },
    ]);

    await expect(service.getAllInstanceActivity()).resolves.toEqual({
      results: [
        {
          instance_id: 'instance-1',
          workspace_name: 'Alpha',
          last_message_at: '2026-04-02T00:00:00.000Z',
          messages_last_7d: 3,
        },
      ],
    });
  });

  it('returns no conversation messages when the channel is not owned by the instance', async () => {
    db.execute.mockResolvedValueOnce([]);

    await expect(
      service.getConversationMessages('instance-1', 'channel-1'),
    ).resolves.toEqual({
      messages: [],
      has_more: false,
    });
  });

  it('maps conversation messages and computes has_more when an extra row is fetched', async () => {
    db.execute.mockResolvedValueOnce([{ ok: 1 }]).mockResolvedValueOnce([
      {
        id: 'msg-3',
        content: 'third',
        type: 'text',
        created_at: new Date('2026-04-02T00:03:00.000Z'),
        updated_at: new Date('2026-04-02T00:03:00.000Z'),
        is_edited: false,
        parent_id: null,
        sender_id: 'user-1',
        sender_username: 'alice',
        sender_display_name: 'Alice',
        sender_avatar_url: null,
        sender_type: 'human',
      },
      {
        id: 'msg-2',
        content: 'second',
        type: 'text',
        created_at: new Date('2026-04-02T00:02:00.000Z'),
        updated_at: new Date('2026-04-02T00:02:00.000Z'),
        is_edited: true,
        parent_id: 'parent-1',
        sender_id: null,
        sender_username: null,
        sender_display_name: null,
        sender_avatar_url: null,
        sender_type: null,
      },
      {
        id: 'msg-1',
        content: 'first',
        type: 'text',
        created_at: new Date('2026-04-02T00:01:00.000Z'),
        updated_at: new Date('2026-04-02T00:01:00.000Z'),
        is_edited: false,
        parent_id: null,
        sender_id: 'user-2',
        sender_username: 'bob',
        sender_display_name: null,
        sender_avatar_url: 'https://avatar.test/bob.png',
        sender_type: 'bot',
      },
    ]);

    await expect(
      service.getConversationMessages('instance-1', 'channel-1', 2),
    ).resolves.toEqual({
      messages: [
        {
          id: 'msg-3',
          content: 'third',
          type: 'text',
          created_at: 'Thu Apr 02 2026 08:03:00 GMT+0800 (China Standard Time)',
          updated_at: 'Thu Apr 02 2026 08:03:00 GMT+0800 (China Standard Time)',
          is_edited: false,
          parent_id: null,
          sender: {
            id: 'user-1',
            username: 'alice',
            display_name: 'Alice',
            avatar_url: null,
            user_type: 'human',
          },
        },
        {
          id: 'msg-2',
          content: 'second',
          type: 'text',
          created_at: 'Thu Apr 02 2026 08:02:00 GMT+0800 (China Standard Time)',
          updated_at: 'Thu Apr 02 2026 08:02:00 GMT+0800 (China Standard Time)',
          is_edited: true,
          parent_id: 'parent-1',
          sender: null,
        },
      ],
      has_more: true,
    });
  });
});
