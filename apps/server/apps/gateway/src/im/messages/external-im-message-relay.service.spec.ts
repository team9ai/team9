import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

const { ExternalImMessageRelayService } =
  await import('./external-im-message-relay.service.js');

function createDbMock(metadata: Record<string, unknown> | null = null) {
  const limit = jest.fn<any>().mockResolvedValue([{ metadata }]);
  const where = jest.fn<any>().mockReturnValue({ limit });
  const from = jest.fn<any>().mockReturnValue({ where });
  const select = jest.fn<any>().mockReturnValue({ from });

  return {
    select,
    chains: { from, where, limit },
  };
}

function createService(db = createDbMock()) {
  return {
    db,
    service: new ExternalImMessageRelayService(db as never),
  };
}

describe('ExternalImMessageRelayService', () => {
  const originalFetch = global.fetch;
  const originalWebhookUrl = process.env.EXTERNAL_IM_GATEWAY_URL;

  beforeEach(() => {
    process.env.EXTERNAL_IM_GATEWAY_URL = 'http://localhost:3719';
    global.fetch = jest.fn<any>().mockResolvedValue({
      ok: true,
      status: 200,
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalWebhookUrl === undefined) {
      delete process.env.EXTERNAL_IM_GATEWAY_URL;
    } else {
      process.env.EXTERNAL_IM_GATEWAY_URL = originalWebhookUrl;
    }
  });

  it('does not relay messages that originated from an external IM provider', async () => {
    const { db, service } = createService();

    await service.handleMessageCreated({
      message: {
        id: 'message-1',
        channelId: 'channel-1',
        senderId: 'user-1',
        content: 'hello from weixin',
        type: 'text',
        metadata: {
          externalIm: {
            provider: 'weixin-ilink',
          },
        },
      },
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
  });

  it('loads metadata and skips agent process messages when the event omits metadata', async () => {
    const { service } = createService(
      createDbMock({
        agentEventType: 'thinking',
        status: 'completed',
      }),
    );

    await service.handleMessageCreated({
      message: {
        id: 'message-1',
        channelId: 'channel-1',
        senderId: 'bot-1',
        content: 'internal thinking',
        type: 'text',
      },
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('delivers regular messages to the configured external IM webhook', async () => {
    const { service } = createService();

    await service.handleMessageCreated({
      message: {
        id: 'message-1',
        channelId: 'channel-1',
        senderId: 'bot-1',
        content: 'final answer',
        type: 'text',
        metadata: null,
        attachments: [
          {
            id: 'attachment-1',
            fileName: 'cat.png',
            mimeType: 'image/png',
            fileSize: 123,
            fileUrl: 'https://files.example/cat.png',
            publicUrl: 'https://signed.example/cat.png',
            thumbnailUrl: null,
          },
        ],
      },
      sender: {
        id: 'bot-1',
        username: 'assistant',
        displayName: 'Assistant',
      },
      channel: {
        id: 'channel-1',
        name: 'General',
        type: 'direct',
      },
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3719/team9/webhooks/message-created',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"content":"final answer"'),
      }),
    );
    const body = JSON.parse(
      (global.fetch as jest.Mock).mock.calls[0][1].body as string,
    );
    expect(body.data.attachments).toEqual([
      {
        id: 'attachment-1',
        fileName: 'cat.png',
        mimeType: 'image/png',
        fileSize: 123,
        fileUrl: 'https://files.example/cat.png',
        publicUrl: 'https://signed.example/cat.png',
        thumbnailUrl: null,
      },
    ]);
  });
});
