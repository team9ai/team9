import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import * as schema from '@team9/database/schemas';
import { MessageService } from './message.service.js';

function makeSelectChain() {
  const chain: any = {};
  chain.from = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockReturnValue(chain);
  chain.orderBy = jest.fn().mockReturnValue(chain);
  chain.limit = jest.fn();
  return chain;
}

function makeInsertChain() {
  const chain: any = {};
  chain.values = jest.fn().mockReturnValue(chain);
  chain.onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
  return chain;
}

function makeHarness() {
  const redisClient = {
    lpush: jest.fn().mockResolvedValue(1),
    ltrim: jest.fn().mockResolvedValue('OK'),
  };

  const db = {
    select: jest.fn(),
    insert: jest.fn(),
    transaction: jest.fn(),
  };

  const redisService = {
    get: jest.fn(),
    set: jest.fn().mockResolvedValue('OK'),
    getClient: jest.fn().mockReturnValue(redisClient),
    expire: jest.fn().mockResolvedValue(1),
  };

  const sequenceService = {
    generateChannelSeq: jest.fn().mockResolvedValue(7n),
  };

  const routerService = {
    routeMessage: jest.fn().mockResolvedValue({ online: [], offline: [] }),
  };

  const service = new MessageService(
    db as never,
    redisService as never,
    sequenceService as never,
    routerService as never,
  );

  (service as any).logger = {
    debug: jest.fn(),
    error: jest.fn(),
  };

  return {
    service,
    db,
    redisService,
    redisClient,
    sequenceService,
    routerService,
  };
}

describe('MessageService', () => {
  const originalS3Endpoint = process.env.S3_ENDPOINT;

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(1710000000000);
    process.env.S3_ENDPOINT = 'https://cdn.example';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env.S3_ENDPOINT = originalS3Endpoint;
  });

  it('short-circuits duplicate upstream messages before sequence generation', async () => {
    const { service, db, redisService, sequenceService, routerService } =
      makeHarness();

    redisService.get.mockResolvedValueOnce(
      JSON.stringify({ msgId: 'msg-dup', seqId: '41' }),
    );

    const response = await service.processUpstreamMessage({
      gatewayId: 'gateway-1',
      userId: 'user-1',
      socketId: 'socket-1',
      receivedAt: 1710000000000,
      message: {
        msgId: 'client-msg-1',
        clientMsgId: 'client-msg-1',
        senderId: 'user-1',
        targetType: 'channel',
        targetId: 'channel-1',
        type: 'text',
        payload: { content: 'hello' },
        timestamp: 1710000000000,
      },
    } as never);

    expect(response).toEqual({
      msgId: 'msg-dup',
      clientMsgId: 'client-msg-1',
      status: 'duplicate',
      seqId: '41',
      serverTime: 1710000000000,
    });
    expect(sequenceService.generateChannelSeq).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(routerService.routeMessage).not.toHaveBeenCalled();
  });

  it('falls back when dedup cache cannot be parsed and still processes the message', async () => {
    const {
      service,
      db,
      redisService,
      redisClient,
      sequenceService,
      routerService,
    } = makeHarness();
    const memberQuery = makeSelectChain();
    const insertChain = makeInsertChain();

    redisService.get.mockResolvedValueOnce('not-json');
    db.select.mockReturnValueOnce(memberQuery);
    memberQuery.where.mockResolvedValueOnce([
      { userId: 'user-1' },
      { userId: 'user-2' },
    ]);
    db.insert.mockReturnValue(insertChain);
    sequenceService.generateChannelSeq.mockResolvedValueOnce(99n);

    const response = await service.processUpstreamMessage({
      gatewayId: 'gateway-1',
      userId: 'user-1',
      socketId: 'socket-1',
      receivedAt: 1710000000000,
      message: {
        msgId: 'client-msg-2',
        clientMsgId: 'client-msg-2',
        senderId: 'user-1',
        targetType: 'channel',
        targetId: 'channel-1',
        type: 'text',
        payload: { content: 'hello from json fallback' },
        timestamp: 1710000000000,
      },
    } as never);

    expect(response).toEqual({
      msgId: expect.any(String),
      clientMsgId: 'client-msg-2',
      status: 'ok',
      seqId: '99',
      serverTime: 1710000000000,
    });
    expect(sequenceService.generateChannelSeq).toHaveBeenCalledWith(
      'channel-1',
    );
    expect(redisService.set).toHaveBeenCalledWith(
      'im:dedup:client-msg-2',
      expect.stringMatching(/"seqId":"99"/),
      300,
    );
    expect(db.insert).toHaveBeenNthCalledWith(1, schema.messages);
    expect(db.insert).toHaveBeenNthCalledWith(2, schema.userChannelReadStatus);
    expect(routerService.routeMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        msgId: expect.any(String),
        seqId: 99n,
        senderId: 'user-1',
        targetId: 'channel-1',
        type: 'text',
      }),
      ['user-2'],
    );
    expect(redisClient.lpush).toHaveBeenCalledWith(
      'im:recent_messages:channel-1',
      expect.stringContaining('"seqId":"99"'),
    );
    expect(JSON.parse(redisClient.lpush.mock.calls[0][1] as string)).toEqual(
      expect.objectContaining({
        clientMsgId: 'client-msg-2',
        seqId: '99',
        senderId: 'user-1',
      }),
    );
  });

  it('skips routing and unread updates when there are no recipients', async () => {
    const { service, db, redisService, routerService } = makeHarness();
    const memberQuery = makeSelectChain();
    const insertChain = makeInsertChain();

    redisService.get.mockResolvedValueOnce(null);
    db.select.mockReturnValueOnce(memberQuery);
    memberQuery.where.mockResolvedValueOnce([{ userId: 'user-1' }]);
    db.insert.mockReturnValue(insertChain);

    const response = await service.processUpstreamMessage({
      gatewayId: 'gateway-1',
      userId: 'user-1',
      socketId: 'socket-1',
      receivedAt: 1710000000000,
      message: {
        msgId: 'client-msg-3',
        clientMsgId: 'client-msg-3',
        senderId: 'user-1',
        targetType: 'channel',
        targetId: 'channel-1',
        type: 'text',
        payload: { content: 'solo message' },
        timestamp: 1710000000000,
      },
    } as never);

    expect(response).toEqual({
      msgId: expect.any(String),
      clientMsgId: 'client-msg-3',
      status: 'ok',
      seqId: '7',
      serverTime: 1710000000000,
    });
    expect(routerService.routeMessage).not.toHaveBeenCalled();
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db.insert).toHaveBeenCalledWith(schema.messages);
  });

  it('returns an error ack when processing fails upstream', async () => {
    const { service, db, redisService, sequenceService, routerService } =
      makeHarness();

    redisService.get.mockResolvedValueOnce(null);
    sequenceService.generateChannelSeq.mockRejectedValueOnce(
      new Error('sequence down'),
    );

    const response = await service.processUpstreamMessage({
      gatewayId: 'gateway-1',
      userId: 'user-1',
      socketId: 'socket-1',
      receivedAt: 1710000000000,
      message: {
        msgId: 'client-msg-4',
        clientMsgId: 'client-msg-4',
        senderId: 'user-1',
        targetType: 'channel',
        targetId: 'channel-1',
        type: 'text',
        payload: { content: 'boom' },
        timestamp: 1710000000000,
      },
    } as never);

    expect(response).toEqual({
      msgId: '',
      clientMsgId: 'client-msg-4',
      status: 'error',
      serverTime: 1710000000000,
      error: 'sequence down',
    });
    expect(db.insert).not.toHaveBeenCalled();
    expect(routerService.routeMessage).not.toHaveBeenCalled();
  });

  it('short-circuits duplicate HTTP creates before opening a transaction', async () => {
    const { service, db, redisService, sequenceService } = makeHarness();

    redisService.get.mockResolvedValueOnce(
      JSON.stringify({ msgId: 'msg-http-dup', seqId: '11' }),
    );

    const response = await service.createAndPersist({
      clientMsgId: 'client-http-1',
      channelId: 'channel-1',
      senderId: 'user-1',
      content: 'hello',
      type: 'text',
    });

    expect(response).toEqual({
      msgId: 'msg-http-dup',
      seqId: '11',
      clientMsgId: 'client-http-1',
      status: 'duplicate',
      timestamp: 1710000000000,
    });
    expect(sequenceService.generateChannelSeq).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
    expect(redisService.set).not.toHaveBeenCalled();
  });

  it.each([
    {
      title: 'resolves first-level reply rootId from the direct parent',
      parentRow: { parentId: null, rootId: null },
      expectedRootId: 'reply-1',
    },
    {
      title: 'preserves thread rootId for nested replies',
      parentRow: { parentId: 'reply-1', rootId: 'thread-root-1' },
      expectedRootId: 'thread-root-1',
    },
  ])('$title', async ({ parentRow, expectedRootId }) => {
    const { service, db, redisService } = makeHarness();
    const parentQuery = makeSelectChain();
    const messageInsert = makeInsertChain();
    const outboxInsert = makeInsertChain();
    const tx = {
      insert: jest
        .fn()
        .mockReturnValueOnce(messageInsert)
        .mockReturnValueOnce(outboxInsert),
    };

    db.select.mockReturnValueOnce(parentQuery);
    parentQuery.limit.mockResolvedValueOnce([parentRow]);
    db.transaction.mockImplementationOnce(async (callback: any) =>
      callback(tx),
    );

    await service.createAndPersist({
      clientMsgId: 'client-http-2',
      channelId: 'channel-1',
      senderId: 'user-1',
      content: 'reply',
      parentId: 'reply-1',
      type: 'text',
    });

    expect(messageInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        parentId: 'reply-1',
        rootId: expectedRootId,
      }),
    );
    expect(redisService.set).toHaveBeenCalledWith(
      'im:dedup:client-http-2',
      expect.stringContaining('"seqId":"7"'),
      300,
    );
  });

  it('writes attachments and outbox records inside one transaction', async () => {
    const { service, db, redisService } = makeHarness();
    const messageInsert = makeInsertChain();
    const attachmentInsert = makeInsertChain();
    const outboxInsert = makeInsertChain();
    const tx = {
      insert: jest
        .fn()
        .mockReturnValueOnce(messageInsert)
        .mockReturnValueOnce(attachmentInsert)
        .mockReturnValueOnce(outboxInsert),
    };

    db.transaction.mockImplementationOnce(async (callback: any) =>
      callback(tx),
    );

    await service.createAndPersist({
      clientMsgId: 'client-http-3',
      channelId: 'channel-1',
      senderId: 'user-1',
      content: 'file upload',
      type: 'file',
      attachments: [
        {
          fileKey: 'uploads/file-1',
          fileName: 'spec.pdf',
          fileSize: 2048,
          mimeType: 'application/pdf',
        },
      ],
      metadata: {
        source: 'web',
      },
      workspaceId: 'workspace-1',
    });

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(tx.insert).toHaveBeenNthCalledWith(1, schema.messages);
    expect(tx.insert).toHaveBeenNthCalledWith(2, schema.messageAttachments);
    expect(tx.insert).toHaveBeenNthCalledWith(3, schema.messageOutbox);
    expect(messageInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'channel-1',
        senderId: 'user-1',
        content: 'file upload',
        rootId: null,
        type: 'file',
        seqId: 7n,
        clientMsgId: 'client-http-3',
        metadata: {
          source: 'web',
        },
      }),
    );
    expect(attachmentInsert.values).toHaveBeenCalledWith([
      expect.objectContaining({
        messageId: expect.any(String),
        fileKey: 'uploads/file-1',
        fileName: 'spec.pdf',
        fileUrl: 'https://cdn.example/uploads/file-1',
        mimeType: 'application/pdf',
        fileSize: 2048,
      }),
    ]);
    expect(outboxInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'message_created',
        payload: expect.objectContaining({
          channelId: 'channel-1',
          senderId: 'user-1',
          content: 'file upload',
          seqId: '7',
          timestamp: 1710000000000,
          workspaceId: 'workspace-1',
          metadata: {
            source: 'web',
          },
        }),
        status: 'pending',
      }),
    );
    expect(redisService.set).toHaveBeenCalledWith(
      'im:dedup:client-http-3',
      expect.stringContaining('"seqId":"7"'),
      300,
    );
  });

  it('returns messages since a seqId with the requested limit', async () => {
    const { service, db } = makeHarness();
    const query = makeSelectChain();
    const rows = [{ id: 'msg-1' }, { id: 'msg-2' }];

    db.select.mockReturnValueOnce(query);
    query.limit.mockResolvedValueOnce(rows);

    const result = await service.getMessagesSince('channel-1', 41n, 25);

    expect(result).toEqual(rows);
    expect(query.orderBy).toHaveBeenCalledWith(schema.messages.seqId);
    expect(query.limit).toHaveBeenCalledWith(25);
  });

  it('returns active channel member IDs through the public wrapper', async () => {
    const { service, db } = makeHarness();
    const query = makeSelectChain();

    db.select.mockReturnValueOnce(query);
    query.where.mockResolvedValueOnce([
      { userId: 'user-1' },
      { userId: 'user-2' },
    ]);

    const result = await service.getChannelMemberIdsPublic('channel-1');

    expect(result).toEqual(['user-1', 'user-2']);
    expect(db.select).toHaveBeenCalledWith({
      userId: schema.channelMembers.userId,
    });
    expect(query.from).toHaveBeenCalledWith(schema.channelMembers);
  });
});
