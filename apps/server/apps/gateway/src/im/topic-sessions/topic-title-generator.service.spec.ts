// Required env vars must be set before importing the service, since some
// transitively-imported modules (e.g. websocket.gateway) read env at load time.
process.env.CORS_ORIGIN ??= 'http://localhost:3000';

import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const { TopicTitleGeneratorService } =
  await import('./topic-title-generator.service.js');

type MockFn = jest.Mock<(...args: any[]) => any>;

function mockDb() {
  const chain: Record<string, MockFn> = {};
  for (const method of [
    'select',
    'from',
    'where',
    'limit',
    'innerJoin',
    'orderBy',
  ]) {
    chain[method] = jest.fn<any>().mockReturnValue(chain);
  }
  return chain;
}

describe('TopicTitleGeneratorService', () => {
  let db: ReturnType<typeof mockDb>;
  let hub: { request: MockFn; serviceHeaders: MockFn };
  let channels: { updateTopicSessionTitle: MockFn };
  let ws: { sendToUser: MockFn };
  let eventEmitter: { emit: MockFn };
  let service: InstanceType<typeof TopicTitleGeneratorService>;

  beforeEach(() => {
    db = mockDb();
    hub = {
      request: jest.fn<any>().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'AI总结标题' } }],
        }),
      }),
      serviceHeaders: jest.fn<any>().mockReturnValue({
        authorization: 'Bearer test',
      }),
    };
    channels = {
      updateTopicSessionTitle: jest.fn<any>().mockResolvedValue({
        id: 'channel-1',
        type: 'topic-session',
        name: 'AI总结标题',
      }),
    };
    ws = { sendToUser: jest.fn<any>().mockResolvedValue(undefined) };
    eventEmitter = { emit: jest.fn<any>() };
    service = new TopicTitleGeneratorService(
      db as any,
      hub as any,
      channels as any,
      ws as any,
      eventEmitter as any,
    );
  });

  it('replaces a temporary title when the bot reply triggers AI title generation', async () => {
    db.limit
      .mockResolvedValueOnce([
        {
          id: 'channel-1',
          type: 'topic-session',
          createdBy: 'user-1',
          tenantId: 'tenant-1',
          propertySettings: {
            topicSession: {
              title: '临时标题',
              titleSource: 'temporary',
            },
          },
        },
      ])
      .mockResolvedValueOnce([
        {
          content: '用户第一句话',
          senderId: 'user-1',
        },
      ]);

    await service.onMessageCreated({
      message: {
        id: 'msg-2',
        channelId: 'channel-1',
        senderId: 'bot-1',
        content: 'bot reply',
        type: 'text',
      },
      sender: { id: 'bot-1', userType: 'bot' },
    });

    expect(channels.updateTopicSessionTitle).toHaveBeenCalledWith(
      'channel-1',
      'AI总结标题',
      {
        expectCurrentTitleNull: true,
        allowTemporaryTitle: true,
        titleSource: 'generated',
      },
    );
    expect(ws.sendToUser).toHaveBeenCalledWith(
      'user-1',
      'topic_session_updated',
      { channelId: 'channel-1', title: 'AI总结标题' },
    );
  });
});
