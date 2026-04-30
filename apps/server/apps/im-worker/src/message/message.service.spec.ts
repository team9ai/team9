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

function makeUpdateChain() {
  const chain: any = {};
  chain.set = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockResolvedValue(undefined);
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
    update: jest.fn(),
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
  const originalS3Endpoint = process.env.S3_PUBLIC_URL;

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(1710000000000);
    process.env.S3_PUBLIC_URL = 'https://cdn.example';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env.S3_PUBLIC_URL = originalS3Endpoint;
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
    const channelQuery = makeSelectChain();
    const insertChain = makeInsertChain();

    redisService.get.mockResolvedValueOnce('not-json');
    db.select
      .mockReturnValueOnce(memberQuery)
      .mockReturnValueOnce(channelQuery);
    memberQuery.where.mockResolvedValueOnce([
      { userId: 'user-1' },
      { userId: 'user-2' },
    ]);
    // Return a non-DM channel so unhide short-circuits
    channelQuery.limit.mockResolvedValueOnce([{ type: 'public' }]);
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
    const channelQuery = makeSelectChain();
    const insertChain = makeInsertChain();

    redisService.get.mockResolvedValueOnce(null);
    db.select
      .mockReturnValueOnce(memberQuery)
      .mockReturnValueOnce(channelQuery);
    memberQuery.where.mockResolvedValueOnce([{ userId: 'user-1' }]);
    // Return a non-DM channel so unhide short-circuits
    channelQuery.limit.mockResolvedValueOnce([{ type: 'public' }]);
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

  it.each([
    {
      type: 'file',
      payload: { fileName: 'spec.pdf' },
      expectedContent: 'spec.pdf',
    },
    {
      type: 'image',
      payload: { imageUrl: 'https://cdn.example/image.png' },
      expectedContent: 'https://cdn.example/image.png',
    },
    {
      type: 'system',
      payload: { content: 'system maintenance' },
      expectedContent: 'system maintenance',
    },
  ])(
    'stores $type payloads using the type-specific content field',
    async ({ type, payload, expectedContent }) => {
      const { service, db, redisService } = makeHarness();
      const memberQuery = makeSelectChain();
      const channelQuery = makeSelectChain();
      const messageInsert = makeInsertChain();

      redisService.get.mockResolvedValueOnce(null);
      db.select
        .mockReturnValueOnce(memberQuery)
        .mockReturnValueOnce(channelQuery);
      memberQuery.where.mockResolvedValueOnce([{ userId: 'user-1' }]);
      // Return a non-DM channel so unhide short-circuits
      channelQuery.limit.mockResolvedValueOnce([{ type: 'public' }]);
      db.insert.mockReturnValue(messageInsert);

      const response = await service.processUpstreamMessage({
        gatewayId: 'gateway-1',
        userId: 'user-1',
        socketId: 'socket-1',
        receivedAt: 1710000000000,
        message: {
          msgId: `client-msg-${type}`,
          clientMsgId: `client-msg-${type}`,
          senderId: 'user-1',
          targetType: 'channel',
          targetId: 'channel-1',
          type,
          payload,
          timestamp: 1710000000000,
        },
      } as never);

      expect(response).toEqual({
        msgId: expect.any(String),
        clientMsgId: `client-msg-${type}`,
        status: 'ok',
        seqId: '7',
        serverTime: 1710000000000,
      });
      expect(messageInsert.values).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expectedContent,
          type,
        }),
      );
    },
  );

  it.each([
    {
      title:
        'uses the direct parent as rootId when the parent is a root message',
      parentRow: { parentId: null, rootId: null },
      expectedRootId: 'reply-1',
    },
    {
      title: 'reuses the thread rootId when the parent is already a reply',
      parentRow: { parentId: 'reply-1', rootId: 'thread-root-1' },
      expectedRootId: 'thread-root-1',
    },
    {
      title:
        'falls back to the immediate parent when the parent record is missing',
      parentRow: null,
      expectedRootId: 'reply-1',
    },
  ])('$title', async ({ parentRow, expectedRootId }) => {
    const { service, db, redisService } = makeHarness();
    const memberQuery = makeSelectChain();
    const parentQuery = makeSelectChain();
    const channelQuery = makeSelectChain();
    const messageInsert = makeInsertChain();

    redisService.get.mockResolvedValueOnce(null);
    db.select
      .mockReturnValueOnce(parentQuery)
      .mockReturnValueOnce(memberQuery)
      .mockReturnValueOnce(channelQuery);
    parentQuery.limit.mockResolvedValueOnce(parentRow ? [parentRow] : []);
    memberQuery.where.mockResolvedValueOnce([{ userId: 'user-1' }]);
    // Return a non-DM channel so unhide short-circuits
    channelQuery.limit.mockResolvedValueOnce([{ type: 'public' }]);
    db.insert.mockReturnValue(messageInsert);

    const response = await service.processUpstreamMessage({
      gatewayId: 'gateway-1',
      userId: 'user-1',
      socketId: 'socket-1',
      receivedAt: 1710000000000,
      message: {
        msgId: 'client-msg-reply',
        clientMsgId: 'client-msg-reply',
        senderId: 'user-1',
        targetType: 'channel',
        targetId: 'channel-1',
        type: 'custom',
        payload: {
          content: 'fallback reply body',
          parentId: 'reply-1',
        },
        timestamp: 1710000000000,
      },
    } as never);

    expect(response).toEqual({
      msgId: expect.any(String),
      clientMsgId: 'client-msg-reply',
      status: 'ok',
      seqId: '7',
      serverTime: 1710000000000,
    });
    expect(parentQuery.limit).toHaveBeenCalledWith(1);
    expect(messageInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'fallback reply body',
        parentId: 'reply-1',
        rootId: expectedRootId,
        type: 'custom',
      }),
    );
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

  it('logs and rethrows HTTP persistence failures', async () => {
    const { service, db, sequenceService } = makeHarness();

    sequenceService.generateChannelSeq.mockResolvedValueOnce(19n);
    db.transaction.mockRejectedValueOnce(new Error('tx failed'));

    await expect(
      service.createAndPersist({
        clientMsgId: 'client-http-err',
        channelId: 'channel-1',
        senderId: 'user-1',
        content: 'boom',
        type: 'text',
      }),
    ).rejects.toThrow('tx failed');

    expect(db.transaction).toHaveBeenCalledTimes(1);
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
    // Mock channel type lookup for unhideDmChannelForMembers
    const channelQuery = makeSelectChain();
    db.select.mockReturnValueOnce(channelQuery);
    channelQuery.limit.mockResolvedValueOnce([{ type: 'public' }]);

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
    // Mock channel type lookup for unhideDmChannelForMembers
    const channelQuery = makeSelectChain();
    db.select.mockReturnValueOnce(channelQuery);
    channelQuery.limit.mockResolvedValueOnce([{ type: 'public' }]);

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

  it('writes external pass-through attachment with the provided fileUrl and null fileKey', async () => {
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
    const channelQuery = makeSelectChain();
    db.select.mockReturnValueOnce(channelQuery);
    channelQuery.limit.mockResolvedValueOnce([{ type: 'public' }]);

    await service.createAndPersist({
      clientMsgId: 'client-external-1',
      channelId: 'channel-1',
      senderId: 'user-1',
      content: 'external video',
      type: 'file',
      attachments: [
        {
          fileUrl: 'http://capability-hub/seedance/video.mp4',
          fileName: 'video.mp4',
          fileSize: 4096,
          mimeType: 'video/mp4',
        },
      ],
      workspaceId: 'workspace-1',
    });

    expect(attachmentInsert.values).toHaveBeenCalledWith([
      expect.objectContaining({
        messageId: expect.any(String),
        // External attachments persist a null fileKey since the bytes are
        // not in team9 S3, and store the supplied URL verbatim.
        fileKey: null,
        fileName: 'video.mp4',
        fileUrl: 'http://capability-hub/seedance/video.mp4',
        mimeType: 'video/mp4',
        fileSize: 4096,
      }),
    ]);
    expect(redisService.set).toHaveBeenCalled();
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

  describe('unhideDmChannelForMembers', () => {
    it('updates showInDmSidebar to true for all hidden members in a direct channel', async () => {
      const { service, db } = makeHarness();
      const channelQuery = makeSelectChain();
      const updateChain = makeUpdateChain();

      db.select.mockReturnValueOnce(channelQuery);
      channelQuery.limit.mockResolvedValueOnce([{ type: 'direct' }]);
      db.update.mockReturnValueOnce(updateChain);

      await (service as any).unhideDmChannelForMembers('dm-channel-1');

      expect(db.select).toHaveBeenCalledWith({ type: schema.channels.type });
      expect(channelQuery.from).toHaveBeenCalledWith(schema.channels);
      expect(channelQuery.limit).toHaveBeenCalledWith(1);
      expect(db.update).toHaveBeenCalledWith(schema.channelMembers);
      expect(updateChain.set).toHaveBeenCalledWith({ showInDmSidebar: true });
      expect(updateChain.where).toHaveBeenCalled();
    });

    it('updates showInDmSidebar to true for all hidden members in an echo channel', async () => {
      const { service, db } = makeHarness();
      const channelQuery = makeSelectChain();
      const updateChain = makeUpdateChain();

      db.select.mockReturnValueOnce(channelQuery);
      channelQuery.limit.mockResolvedValueOnce([{ type: 'echo' }]);
      db.update.mockReturnValueOnce(updateChain);

      await (service as any).unhideDmChannelForMembers('echo-channel-1');

      expect(db.update).toHaveBeenCalledWith(schema.channelMembers);
      expect(updateChain.set).toHaveBeenCalledWith({ showInDmSidebar: true });
    });

    it('does not update members for non-DM channel types', async () => {
      const { service, db } = makeHarness();
      const channelQuery = makeSelectChain();

      db.select.mockReturnValueOnce(channelQuery);
      channelQuery.limit.mockResolvedValueOnce([{ type: 'public' }]);

      await (service as any).unhideDmChannelForMembers('public-channel-1');

      expect(db.update).not.toHaveBeenCalled();
    });

    it('does not update members for private channel type', async () => {
      const { service, db } = makeHarness();
      const channelQuery = makeSelectChain();

      db.select.mockReturnValueOnce(channelQuery);
      channelQuery.limit.mockResolvedValueOnce([{ type: 'private' }]);

      await (service as any).unhideDmChannelForMembers('private-channel-1');

      expect(db.update).not.toHaveBeenCalled();
    });

    it('does not update members when channel is not found', async () => {
      const { service, db } = makeHarness();
      const channelQuery = makeSelectChain();

      db.select.mockReturnValueOnce(channelQuery);
      channelQuery.limit.mockResolvedValueOnce([]);

      await (service as any).unhideDmChannelForMembers('missing-channel');

      expect(db.update).not.toHaveBeenCalled();
    });

    it('calls unhideDmChannelForMembers after processing a DM message end-to-end', async () => {
      const { service, db, redisService } = makeHarness();
      const memberQuery = makeSelectChain();
      const channelQuery = makeSelectChain();
      const insertChain = makeInsertChain();
      const updateChain = makeUpdateChain();

      redisService.get.mockResolvedValueOnce(null);
      db.select
        .mockReturnValueOnce(memberQuery)
        .mockReturnValueOnce(channelQuery);
      memberQuery.where.mockResolvedValueOnce([
        { userId: 'user-1' },
        { userId: 'user-2' },
      ]);
      channelQuery.limit.mockResolvedValueOnce([{ type: 'direct' }]);
      db.insert.mockReturnValue(insertChain);
      db.update.mockReturnValueOnce(updateChain);

      const response = await service.processUpstreamMessage({
        gatewayId: 'gateway-1',
        userId: 'user-1',
        socketId: 'socket-1',
        receivedAt: 1710000000000,
        message: {
          msgId: 'client-msg-dm',
          clientMsgId: 'client-msg-dm',
          senderId: 'user-1',
          targetType: 'channel',
          targetId: 'dm-channel-1',
          type: 'text',
          payload: { content: 'hey' },
          timestamp: 1710000000000,
        },
      } as never);

      expect(response.status).toBe('ok');
      expect(db.update).toHaveBeenCalledWith(schema.channelMembers);
      expect(updateChain.set).toHaveBeenCalledWith({ showInDmSidebar: true });
    });
  });
});
