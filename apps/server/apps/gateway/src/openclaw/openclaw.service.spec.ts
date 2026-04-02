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

  it('skips agent, device, and instance control calls when the integration is not configured', async () => {
    mockEnv.OPENCLAW_API_URL = undefined as unknown as string;

    await expect(service.startInstance('instance-1')).resolves.toBeUndefined();
    await expect(service.stopInstance('instance-1')).resolves.toBeUndefined();
    await expect(
      service.createAgent('instance-1', { name: 'helper' }),
    ).resolves.toBeNull();
    await expect(service.listAgents('instance-1')).resolves.toBeNull();
    await expect(
      service.deleteAgent('instance-1', 'agent-1'),
    ).resolves.toBeUndefined();
    await expect(
      service.setAgentIdentity('instance-1', 'agent-1', { name: 'Helper' }),
    ).resolves.toBeUndefined();
    await expect(service.listDevices('instance-1')).resolves.toBeNull();
    await expect(
      service.approveDevice('instance-1', 'req-1'),
    ).resolves.toBeUndefined();
    await expect(
      service.rejectDevice('instance-1', 'req-1'),
    ).resolves.toBeUndefined();

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('creates and lists agents through the control plane api', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(
        createJsonResponse({
          agent_id: 'agent-1',
          name: 'helper',
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          agents: [{ agentId: 'agent-1', name: 'helper', bindings: ['team9'] }],
        }),
      );

    await expect(
      service.createAgent('instance-1', {
        name: 'helper',
        model: 'gpt-test',
      }),
    ).resolves.toEqual({
      agent_id: 'agent-1',
      name: 'helper',
    });
    await expect(service.listAgents('instance-1', true)).resolves.toEqual([
      { agentId: 'agent-1', name: 'helper', bindings: ['team9'] },
    ]);

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      'https://plane.test/api/instances/instance-1/agents',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          name: 'helper',
          model: 'gpt-test',
        }),
      }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      'https://plane.test/api/instances/instance-1/agents?bindings=true',
      expect.objectContaining({
        method: 'GET',
      }),
    );
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

  it('sends mutating agent and device operations to the expected endpoints', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        status: 204,
        headers: new Headers(),
        json: jest.fn<any>(),
        text: jest.fn<any>(),
      })
      .mockResolvedValueOnce(createJsonResponse({}, 200))
      .mockResolvedValueOnce(createJsonResponse({}, 200))
      .mockResolvedValueOnce(createJsonResponse({}, 200))
      .mockResolvedValueOnce(createJsonResponse({}, 200));

    await expect(
      service.deleteAgent('instance-1', 'agent-1'),
    ).resolves.toBeUndefined();
    await expect(
      service.setAgentIdentity('instance-1', 'agent-1', {
        name: 'Helper',
        emoji: '🤖',
      }),
    ).resolves.toBeUndefined();
    await expect(
      service.approveDevice('instance-1', 'req-1'),
    ).resolves.toBeUndefined();
    await expect(
      service.rejectDevice('instance-1', 'req-2'),
    ).resolves.toBeUndefined();
    await expect(service.startInstance('instance-1')).resolves.toBeUndefined();

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      'https://plane.test/api/instances/instance-1/agents/agent-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      'https://plane.test/api/instances/instance-1/agents/agent-1/identity',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          name: 'Helper',
          emoji: '🤖',
        }),
      }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      3,
      'https://plane.test/api/instances/instance-1/devices/approve',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ request_id: 'req-1' }),
      }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      4,
      'https://plane.test/api/instances/instance-1/devices/reject',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ request_id: 'req-2' }),
      }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      5,
      'https://plane.test/api/instances/instance-1/start',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('wraps network failures as service unavailable errors', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('socket hang up'));

    await expect(service.listInstances()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('wraps timeout failures as service unavailable errors', async () => {
    const timeoutError = new Error('timed out');
    timeoutError.name = 'TimeoutError';
    (global.fetch as jest.Mock).mockRejectedValue(timeoutError);

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

  it('maps workspace aggregates and fans out over multiple workspace ids', async () => {
    db.selectChain.where.mockResolvedValueOnce([
      {
        lastMessageAt: new Date('2026-04-02T00:00:00.000Z'),
        messagesLast7d: '5',
      },
    ]);

    await expect(
      service.getWorkspaceLastMessage('workspace-1'),
    ).resolves.toEqual({
      workspace_id: 'workspace-1',
      last_message_at: new Date('2026-04-02T00:00:00.000Z'),
      messages_last_7d: 5,
    });

    const workspaceSpy = jest
      .spyOn(service, 'getWorkspaceLastMessage')
      .mockResolvedValueOnce({
        workspace_id: 'workspace-1',
        last_message_at: null,
        messages_last_7d: 1,
      } as never)
      .mockResolvedValueOnce({
        workspace_id: 'workspace-2',
        last_message_at: null,
        messages_last_7d: 0,
      } as never);

    await expect(service.getWorkspacesLastMessages([])).resolves.toEqual({
      results: [],
    });
    await expect(
      service.getWorkspacesLastMessages(['workspace-1', 'workspace-2']),
    ).resolves.toEqual({
      results: [
        {
          workspace_id: 'workspace-1',
          last_message_at: null,
          messages_last_7d: 1,
        },
        {
          workspace_id: 'workspace-2',
          last_message_at: null,
          messages_last_7d: 0,
        },
      ],
    });

    expect(workspaceSpy).toHaveBeenNthCalledWith(1, 'workspace-1');
    expect(workspaceSpy).toHaveBeenNthCalledWith(2, 'workspace-2');
  });

  it('maps instance conversations with and without a last message', async () => {
    db.execute.mockResolvedValue([
      {
        channel_id: 'channel-1',
        channel_created_at: new Date('2026-04-01T00:00:00.000Z'),
        bot_user_id: 'bot-user-1',
        bot_username: 'helper',
        bot_display_name: 'Helper',
        bot_avatar_url: null,
        other_user_id: 'user-1',
        other_username: 'alice',
        other_display_name: 'Alice',
        other_avatar_url: 'https://avatar.test/alice.png',
        last_message_id: 'msg-1',
        last_message_content: 'hello',
        last_message_sender_id: 'user-1',
        last_message_at: new Date('2026-04-02T00:00:00.000Z'),
        last_message_type: 'text',
        message_count: '3',
      },
      {
        channel_id: 'channel-2',
        channel_created_at: new Date('2026-04-01T01:00:00.000Z'),
        bot_user_id: 'bot-user-2',
        bot_username: 'helper-2',
        bot_display_name: null,
        bot_avatar_url: null,
        other_user_id: 'user-2',
        other_username: 'bob',
        other_display_name: null,
        other_avatar_url: null,
        last_message_id: null,
        last_message_content: null,
        last_message_sender_id: null,
        last_message_at: null,
        last_message_type: null,
        message_count: 0,
      },
    ]);

    await expect(
      service.getInstanceConversations('instance-1'),
    ).resolves.toEqual({
      conversations: [
        {
          channel_id: 'channel-1',
          channel_created_at:
            'Wed Apr 01 2026 08:00:00 GMT+0800 (China Standard Time)',
          bot: {
            user_id: 'bot-user-1',
            username: 'helper',
            display_name: 'Helper',
            avatar_url: null,
          },
          other_user: {
            user_id: 'user-1',
            username: 'alice',
            display_name: 'Alice',
            avatar_url: 'https://avatar.test/alice.png',
          },
          last_message: {
            id: 'msg-1',
            content: 'hello',
            sender_id: 'user-1',
            created_at:
              'Thu Apr 02 2026 08:00:00 GMT+0800 (China Standard Time)',
            type: 'text',
          },
          message_count: 3,
        },
        {
          channel_id: 'channel-2',
          channel_created_at:
            'Wed Apr 01 2026 09:00:00 GMT+0800 (China Standard Time)',
          bot: {
            user_id: 'bot-user-2',
            username: 'helper-2',
            display_name: null,
            avatar_url: null,
          },
          other_user: {
            user_id: 'user-2',
            username: 'bob',
            display_name: null,
            avatar_url: null,
          },
          last_message: null,
          message_count: 0,
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
