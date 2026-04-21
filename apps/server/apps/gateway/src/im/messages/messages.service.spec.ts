import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

// Mock modules that create circular dependencies BEFORE dynamic import
jest.unstable_mockModule('../properties/message-properties.service.js', () => ({
  MessagePropertiesService: class MessagePropertiesService {},
}));
jest.unstable_mockModule('../websocket/websocket.gateway.js', () => ({
  WebsocketGateway: class WebsocketGateway {},
}));
jest.unstable_mockModule(
  '../services/im-worker-grpc-client.service.js',
  () => ({
    ImWorkerGrpcClientService: class ImWorkerGrpcClientService {},
  }),
);

jest.unstable_mockModule('../../shared/constants/injection-tokens.js', () => ({
  WEBSOCKET_GATEWAY: Symbol('WEBSOCKET_GATEWAY'),
}));

const { MessagesService } = await import('./messages.service.js');
type MessageResponse = import('./messages.service.js').MessageResponse;

function createDbMock() {
  const selectLimit = jest.fn<any>().mockResolvedValue([]);
  const selectOrderBy = jest.fn<any>().mockResolvedValue([]);
  const selectLeftJoin = jest.fn<any>();
  const selectWhere = jest.fn<any>().mockReturnValue({
    limit: selectLimit,
    orderBy: selectOrderBy,
  });
  const selectQuery = {
    leftJoin: selectLeftJoin,
    where: selectWhere,
  };
  const selectFrom = jest.fn<any>().mockReturnValue(selectQuery);
  selectLeftJoin.mockReturnValue(selectQuery);

  // selectDistinct chain: returns { from: { where: resolvedValue } }
  const selectDistinctWhere = jest.fn<any>().mockResolvedValue([]);
  const selectDistinctFrom = jest.fn<any>().mockReturnValue({
    where: selectDistinctWhere,
  });

  const insertOnConflictDoNothing = jest.fn<any>().mockResolvedValue(undefined);
  const insertOnConflictDoUpdate = jest.fn<any>().mockResolvedValue(undefined);
  const insertValues = jest.fn<any>().mockReturnValue({
    onConflictDoNothing: insertOnConflictDoNothing,
    onConflictDoUpdate: insertOnConflictDoUpdate,
  });

  const updateWhere = jest.fn<any>().mockResolvedValue(undefined);
  const updateSet = jest.fn<any>().mockReturnValue({ where: updateWhere });

  const deleteWhere = jest.fn<any>().mockResolvedValue(undefined);

  return {
    select: jest.fn<any>().mockReturnValue({ from: selectFrom }),
    selectDistinct: jest
      .fn<any>()
      .mockReturnValue({ from: selectDistinctFrom }),
    insert: jest.fn<any>().mockReturnValue({ values: insertValues }),
    update: jest.fn<any>().mockReturnValue({ set: updateSet }),
    delete: jest.fn<any>().mockReturnValue({ where: deleteWhere }),
    chains: {
      selectFrom,
      selectLeftJoin,
      selectWhere,
      selectLimit,
      selectOrderBy,
      selectDistinctFrom,
      selectDistinctWhere,
      insertValues,
      insertOnConflictDoNothing,
      insertOnConflictDoUpdate,
      updateSet,
      updateWhere,
      deleteWhere,
    },
  };
}

function makeMessageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'message-1',
    channelId: 'channel-1',
    senderId: 'user-1',
    createdAt: new Date('2026-04-02T10:30:00.000Z'),
    ...overrides,
  };
}

function makeMessageResponse(
  overrides: Partial<MessageResponse> = {},
): MessageResponse {
  return {
    id: 'message-1',
    clientMsgId: null,
    channelId: 'channel-1',
    senderId: 'user-1',
    parentId: null,
    rootId: null,
    content: 'hello',
    type: 'text',
    isPinned: false,
    isEdited: false,
    isDeleted: false,
    createdAt: new Date('2026-04-02T10:30:00.000Z'),
    updatedAt: new Date('2026-04-02T10:30:00.000Z'),
    sender: null,
    attachments: [],
    reactions: [],
    replyCount: 0,
    lastRepliers: [],
    lastReplyAt: null,
    ...overrides,
  };
}

describe('MessagesService', () => {
  let service: InstanceType<typeof MessagesService>;
  let db: ReturnType<typeof createDbMock>;
  let channelSequenceService: {
    generateChannelSeq: jest.Mock<any>;
  };
  let messagePropertiesService: {
    batchGetByMessageIds: jest.Mock<any>;
  };
  let mockWsGateway: {
    emitRelationsPurged: jest.Mock<any>;
  };
  let logger: {
    warn: jest.Mock<any>;
    error: jest.Mock<any>;
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-02T10:30:00.000Z'));

    db = createDbMock();
    channelSequenceService = {
      generateChannelSeq: jest.fn<any>().mockResolvedValue(101),
    };
    messagePropertiesService = {
      batchGetByMessageIds: jest.fn<any>().mockResolvedValue({}),
    };
    mockWsGateway = {
      emitRelationsPurged: jest.fn<any>().mockResolvedValue(undefined),
    };
    const moduleRef = {
      get: jest.fn<any>().mockReturnValue(mockWsGateway),
    };
    service = new MessagesService(
      db as never,
      channelSequenceService as never,
      messagePropertiesService as never,
      moduleRef as never,
    );
    logger = {
      warn: jest.fn<any>(),
      error: jest.fn<any>(),
    };
    (service as any).logger = logger;
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('skips markAsRead when the message id is not a valid UUID', async () => {
    await expect(
      service.markAsRead('channel-1', 'user-1', 'invalid-id'),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Invalid messageId format: invalid-id'),
    );
    expect(db.select).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('skips markAsRead when the message does not exist yet', async () => {
    db.chains.selectLimit.mockResolvedValueOnce([]);

    await expect(
      service.markAsRead(
        'channel-1',
        'user-1',
        '11111111-1111-1111-1111-111111111111',
      ),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('not found in database'),
    );
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('upserts read status when markAsRead receives a persisted message id', async () => {
    db.chains.selectLimit.mockResolvedValueOnce([
      { id: '11111111-1111-1111-1111-111111111111' },
    ]);

    await expect(
      service.markAsRead(
        'channel-1',
        'user-1',
        '11111111-1111-1111-1111-111111111111',
      ),
    ).resolves.toBeUndefined();

    expect(db.chains.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        channelId: 'channel-1',
        lastReadMessageId: '11111111-1111-1111-1111-111111111111',
        unreadCount: 0,
        lastReadAt: new Date('2026-04-02T10:30:00.000Z'),
      }),
    );
    expect(db.chains.insertOnConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.any(Array),
        set: expect.objectContaining({
          lastReadMessageId: '11111111-1111-1111-1111-111111111111',
          unreadCount: 0,
        }),
      }),
    );
  });

  it('rejects update when the message is missing or owned by another sender', async () => {
    db.chains.selectLimit.mockResolvedValueOnce([]);
    await expect(
      service.update('message-1', 'user-1', {
        content: 'edited',
      } as never),
    ).rejects.toBeInstanceOf(NotFoundException);

    db.chains.selectLimit.mockResolvedValueOnce([
      makeMessageRow({ senderId: 'user-2' }),
    ]);
    await expect(
      service.update('message-1', 'user-1', {
        content: 'edited',
      } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(db.update).not.toHaveBeenCalled();
  });

  it('updates messages with a fresh sequence id and returns detailed payload', async () => {
    db.chains.selectLimit.mockResolvedValueOnce([makeMessageRow()]);
    const detailed = makeMessageResponse({ content: 'edited', isEdited: true });
    jest.spyOn(service, 'getMessageWithDetails').mockResolvedValue(detailed);

    await expect(
      service.update('message-1', 'user-1', {
        content: 'edited',
      } as never),
    ).resolves.toEqual(detailed);

    expect(channelSequenceService.generateChannelSeq).toHaveBeenCalledWith(
      'channel-1',
    );
    expect(db.chains.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'edited',
        isEdited: true,
        seqId: 101,
        updatedAt: new Date('2026-04-02T10:30:00.000Z'),
      }),
    );
  });

  it('rejects delete when the message is missing or owned by another sender', async () => {
    db.chains.selectLimit.mockResolvedValueOnce([]);
    await expect(service.delete('message-1', 'user-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    db.chains.selectLimit.mockResolvedValueOnce([
      makeMessageRow({ senderId: 'user-2' }),
    ]);
    await expect(service.delete('message-1', 'user-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    expect(db.update).not.toHaveBeenCalled();
  });

  it('soft deletes messages with a fresh sequence id', async () => {
    db.chains.selectLimit.mockResolvedValueOnce([makeMessageRow()]);
    channelSequenceService.generateChannelSeq.mockResolvedValueOnce(202);

    await expect(
      service.delete('message-1', 'user-1'),
    ).resolves.toBeUndefined();

    expect(channelSequenceService.generateChannelSeq).toHaveBeenCalledWith(
      'channel-1',
    );
    expect(db.chains.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        isDeleted: true,
        seqId: 202,
        deletedAt: new Date('2026-04-02T10:30:00.000Z'),
        updatedAt: new Date('2026-04-02T10:30:00.000Z'),
      }),
    );
  });

  it("allows admin to soft delete another user's message", async () => {
    db.chains.selectLimit.mockResolvedValueOnce([
      makeMessageRow({ senderId: 'other-user' }),
    ]);
    channelSequenceService.generateChannelSeq.mockResolvedValueOnce(203);

    await expect(
      service.delete('message-1', 'requesting-user', 'admin'),
    ).resolves.toBeUndefined();

    expect(db.chains.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        isDeleted: true,
        seqId: 203,
      }),
    );
  });

  it("allows owner to soft delete another user's message", async () => {
    db.chains.selectLimit.mockResolvedValueOnce([
      makeMessageRow({ senderId: 'other-user' }),
    ]);
    channelSequenceService.generateChannelSeq.mockResolvedValueOnce(204);

    await expect(
      service.delete('message-1', 'requesting-user', 'owner'),
    ).resolves.toBeUndefined();

    expect(db.chains.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        isDeleted: true,
        seqId: 204,
      }),
    );
  });

  it("rejects member role from deleting another user's message", async () => {
    db.chains.selectLimit.mockResolvedValueOnce([
      makeMessageRow({ senderId: 'other-user' }),
    ]);

    await expect(
      service.delete('message-1', 'requesting-user', 'member'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(db.update).not.toHaveBeenCalled();
  });

  it("rejects missing role from deleting another user's message", async () => {
    db.chains.selectLimit.mockResolvedValueOnce([
      makeMessageRow({ senderId: 'other-user' }),
    ]);

    await expect(
      service.delete('message-1', 'requesting-user'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(db.update).not.toHaveBeenCalled();
  });

  it('pins messages by updating the pinned flag', async () => {
    await expect(
      service.pinMessage('message-1', true),
    ).resolves.toBeUndefined();

    expect(db.chains.updateSet).toHaveBeenCalledWith({
      isPinned: true,
    });
  });

  it('resolves pinned messages through getMessageWithDetails', async () => {
    db.chains.selectOrderBy.mockResolvedValueOnce([
      { id: 'message-1' },
      { id: 'message-2' },
    ]);
    const getMessageWithDetailsSpy = jest
      .spyOn(service, 'getMessageWithDetails')
      .mockResolvedValueOnce(makeMessageResponse({ id: 'message-1' }))
      .mockResolvedValueOnce(makeMessageResponse({ id: 'message-2' }));

    await expect(service.getPinnedMessages('channel-1')).resolves.toEqual([
      makeMessageResponse({ id: 'message-1' }),
      makeMessageResponse({ id: 'message-2' }),
    ]);

    expect(getMessageWithDetailsSpy).toHaveBeenNthCalledWith(1, 'message-1');
    expect(getMessageWithDetailsSpy).toHaveBeenNthCalledWith(2, 'message-2');
  });

  it('builds message details without a sender and aggregates reactions and repliers', async () => {
    const messageRow = makeMessageRow({
      senderId: 'user-1',
      clientMsgId: 'client-1',
      content: 'detailed',
      metadata: { source: 'test' },
    });
    const attachments = [
      {
        id: 'att-1',
        fileName: 'report.pdf',
        fileKey: 'file-key',
        fileUrl: 'https://cdn.example.com/report.pdf',
        fileSize: 1024,
        mimeType: 'application/pdf',
        thumbnailUrl: null,
        width: null,
        height: null,
      },
      {
        id: 'att-2',
        fileName: 'image.png',
        fileKey: 'image-key',
        fileUrl: 'https://cdn.example.com/image.png',
        fileSize: 2048,
        mimeType: 'image/png',
        thumbnailUrl: 'https://cdn.example.com/thumb.png',
        width: 640,
        height: 480,
      },
    ];
    const reactions = [
      { emoji: ':+1:', userId: 'user-a' },
      { emoji: ':+1:', userId: 'user-b' },
      { emoji: ':tada:', userId: 'user-c' },
    ];
    const recentRepliers = [
      { senderId: 'user-c', createdAt: new Date('2026-04-02T10:33:00.000Z') },
      { senderId: 'user-b', createdAt: new Date('2026-04-02T10:32:00.000Z') },
      { senderId: 'user-c', createdAt: new Date('2026-04-02T10:31:00.000Z') },
      { senderId: 'user-a', createdAt: new Date('2026-04-02T10:30:00.000Z') },
    ];
    const replierUsers = [
      {
        id: 'user-c',
        username: 'carol',
        displayName: 'Carol',
        avatarUrl: null,
        userType: 'human',
        agentType: null,
      },
      {
        id: 'user-b',
        username: 'bob',
        displayName: 'Bob',
        avatarUrl: null,
        userType: 'human',
        agentType: null,
      },
      {
        id: 'user-a',
        username: 'alice',
        displayName: 'Alice',
        avatarUrl: null,
        userType: 'bot',
        agentType: null,
      },
    ];
    const makeSelectChain = (whereReturnValue: unknown) => ({
      from: jest.fn<any>().mockReturnValue({
        leftJoin: jest.fn<any>().mockReturnThis(),
        where: jest.fn<any>().mockReturnValue(whereReturnValue),
      }),
    });

    db.select
      .mockReturnValueOnce(
        makeSelectChain({
          limit: jest.fn<any>().mockResolvedValue([messageRow]),
        }),
      )
      .mockReturnValueOnce(makeSelectChain([]))
      .mockReturnValueOnce(makeSelectChain(attachments))
      .mockReturnValueOnce(makeSelectChain(reactions))
      .mockReturnValueOnce(makeSelectChain([{ count: 3 }]))
      .mockReturnValueOnce(
        makeSelectChain({
          orderBy: jest.fn<any>().mockResolvedValue(recentRepliers),
        }),
      )
      .mockReturnValueOnce(makeSelectChain(replierUsers));

    await expect(service.getMessageWithDetails('message-1')).resolves.toEqual(
      expect.objectContaining({
        id: 'message-1',
        clientMsgId: 'client-1',
        sender: null,
        attachments: expect.arrayContaining([
          expect.objectContaining({ id: 'att-1' }),
          expect.objectContaining({ id: 'att-2' }),
        ]),
        reactions: [
          {
            emoji: ':+1:',
            count: 2,
            userIds: ['user-a', 'user-b'],
          },
          {
            emoji: ':tada:',
            count: 1,
            userIds: ['user-c'],
          },
        ],
        replyCount: 3,
        lastReplyAt: new Date('2026-04-02T10:33:00.000Z'),
        lastRepliers: [
          {
            id: 'user-c',
            username: 'carol',
            displayName: 'Carol',
            avatarUrl: null,
            userType: 'human',
            agentType: null,
          },
          {
            id: 'user-b',
            username: 'bob',
            displayName: 'Bob',
            avatarUrl: null,
            userType: 'human',
            agentType: null,
          },
          {
            id: 'user-a',
            username: 'alice',
            displayName: 'Alice',
            avatarUrl: null,
            userType: 'bot',
            agentType: null,
          },
        ],
        metadata: { source: 'test' },
      }),
    );
  });

  it('throws when getMessageWithDetails cannot find the message', async () => {
    db.chains.selectLimit.mockResolvedValueOnce([]);

    await expect(
      service.getMessageWithDetails('missing-message'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('includes sender details when getMessageWithDetails finds the sender row', async () => {
    const messageRow = makeMessageRow({
      senderId: 'user-1',
      content: 'with sender',
    });
    const sender = {
      id: 'user-1',
      username: 'alice',
      displayName: 'Alice',
      avatarUrl: null,
      userType: 'human',
      agentType: null,
    };
    const makeSelectChain = (returnValue: unknown) => ({
      from: jest.fn<any>().mockReturnValue({
        leftJoin: jest.fn<any>().mockReturnThis(),
        where: jest.fn<any>().mockReturnValue(returnValue),
      }),
    });

    db.select
      .mockReturnValueOnce(
        makeSelectChain({
          limit: jest.fn<any>().mockResolvedValue([messageRow]),
        }),
      )
      .mockReturnValueOnce(makeSelectChain([sender]))
      .mockReturnValueOnce(makeSelectChain([]))
      .mockReturnValueOnce(makeSelectChain([]))
      .mockReturnValueOnce(makeSelectChain([{ count: 0 }]))
      .mockReturnValueOnce(
        makeSelectChain({
          orderBy: jest.fn<any>().mockResolvedValue([]),
        }),
      );

    await expect(service.getMessageWithDetails('message-1')).resolves.toEqual(
      expect.objectContaining({
        sender,
        attachments: [],
        reactions: [],
        replyCount: 0,
        lastRepliers: [],
        lastReplyAt: null,
        content: 'with sender',
      }),
    );
  });

  it('returns an empty map when the batch detail helper receives no messages', async () => {
    await expect(
      (service as any).getMessagesWithDetailsBatch([]),
    ).resolves.toEqual(new Map());

    expect(db.select).not.toHaveBeenCalled();
  });

  it('batches message details with grouped attachments, reactions, reply counts, and last repliers', async () => {
    const firstMessage = makeMessageRow({
      id: 'message-1',
      senderId: 'user-1',
      metadata: { source: 'batch' },
    });
    const secondMessage = makeMessageRow({
      id: 'message-2',
      senderId: null,
      content: 'without sender',
    });
    const makeSelectChain = (whereReturnValue: unknown) => ({
      from: jest.fn<any>().mockReturnValue({
        leftJoin: jest.fn<any>().mockReturnThis(),
        where: jest.fn<any>().mockReturnValue(whereReturnValue),
      }),
    });

    db.select
      .mockReturnValueOnce(
        makeSelectChain([
          {
            id: 'user-1',
            username: 'alice',
            displayName: 'Alice',
            avatarUrl: null,
            userType: 'human',
            agentType: null,
          },
        ]),
      )
      .mockReturnValueOnce(
        makeSelectChain([
          {
            id: 'att-1',
            messageId: 'message-1',
            fileName: 'report.pdf',
            fileKey: 'file-key',
            fileUrl: 'https://cdn.example.com/report.pdf',
            fileSize: 128,
            mimeType: 'application/pdf',
            thumbnailUrl: null,
            width: null,
            height: null,
          },
          {
            id: 'att-2',
            messageId: 'message-2',
            fileName: 'image.png',
            fileKey: 'image-key',
            fileUrl: 'https://cdn.example.com/image.png',
            fileSize: 256,
            mimeType: 'image/png',
            thumbnailUrl: 'https://cdn.example.com/thumb.png',
            width: 640,
            height: 480,
          },
        ]),
      )
      .mockReturnValueOnce(
        makeSelectChain([
          { messageId: 'message-1', emoji: ':+1:', userId: 'user-1' },
          { messageId: 'message-1', emoji: ':+1:', userId: 'user-3' },
          { messageId: 'message-1', emoji: ':eyes:', userId: 'user-4' },
        ]),
      )
      .mockReturnValueOnce(
        makeSelectChain({
          groupBy: jest.fn<any>().mockResolvedValue([
            { parentId: 'message-1', count: 2 },
            { parentId: null, count: 99 },
          ]),
        }),
      )
      .mockReturnValueOnce(
        makeSelectChain({
          orderBy: jest.fn<any>().mockResolvedValue([
            {
              parentId: 'message-1',
              senderId: 'user-3',
              createdAt: new Date('2026-04-02T10:33:00.000Z'),
            },
            {
              parentId: 'message-1',
              senderId: 'user-1',
              createdAt: new Date('2026-04-02T10:32:00.000Z'),
            },
            {
              parentId: 'message-1',
              senderId: 'user-3',
              createdAt: new Date('2026-04-02T10:31:00.000Z'),
            },
            {
              parentId: null,
              senderId: 'user-5',
              createdAt: new Date('2026-04-02T10:30:00.000Z'),
            },
            {
              parentId: 'message-2',
              senderId: null,
              createdAt: new Date('2026-04-02T10:29:00.000Z'),
            },
          ]),
        }),
      )
      .mockReturnValueOnce(
        makeSelectChain([
          {
            id: 'user-3',
            username: 'carol',
            displayName: 'Carol',
            avatarUrl: null,
            userType: 'bot',
            agentType: null,
          },
        ]),
      );

    const result = await (service as any).getMessagesWithDetailsBatch([
      firstMessage,
      secondMessage,
    ]);

    expect(result.get('message-1')).toEqual(
      expect.objectContaining({
        id: 'message-1',
        sender: {
          id: 'user-1',
          username: 'alice',
          displayName: 'Alice',
          avatarUrl: null,
          userType: 'human',
          agentType: null,
        },
        attachments: [
          expect.objectContaining({
            id: 'att-1',
            messageId: 'message-1',
          }),
        ],
        reactions: [
          {
            emoji: ':+1:',
            count: 2,
            userIds: ['user-1', 'user-3'],
          },
          {
            emoji: ':eyes:',
            count: 1,
            userIds: ['user-4'],
          },
        ],
        replyCount: 2,
        lastRepliers: [
          {
            id: 'user-3',
            username: 'carol',
            displayName: 'Carol',
            avatarUrl: null,
            userType: 'bot',
            agentType: null,
          },
          {
            id: 'user-1',
            username: 'alice',
            displayName: 'Alice',
            avatarUrl: null,
            userType: 'human',
            agentType: null,
          },
        ],
        lastReplyAt: new Date('2026-04-02T10:33:00.000Z'),
        metadata: { source: 'batch' },
      }),
    );
    expect(result.get('message-2')).toEqual(
      expect.objectContaining({
        id: 'message-2',
        sender: null,
        attachments: [
          expect.objectContaining({
            id: 'att-2',
            messageId: 'message-2',
          }),
        ],
        reactions: [],
        replyCount: 0,
        lastRepliers: [],
        lastReplyAt: null,
      }),
    );
  });

  it('returns an empty thread response when there are no first-level replies', async () => {
    const rootMessage = makeMessageResponse({ id: 'root-1' });
    db.chains.selectOrderBy.mockResolvedValueOnce([]);
    jest.spyOn(service, 'getMessageWithDetails').mockResolvedValue(rootMessage);
    jest
      .spyOn(service as any, 'getMessagesWithDetailsBatch')
      .mockResolvedValue(new Map());

    await expect(service.getThread('root-1', 2)).resolves.toEqual({
      rootMessage,
      replies: [],
      totalReplyCount: 0,
      hasMore: false,
      nextCursor: null,
    });
  });

  it('returns an empty sub-replies page when there are no replies', async () => {
    const emptySubRepliesLimit = jest.fn<any>().mockResolvedValue([]);
    db.chains.selectOrderBy.mockReturnValueOnce({
      limit: emptySubRepliesLimit,
    });
    jest
      .spyOn(service as any, 'getMessagesWithDetailsBatch')
      .mockResolvedValue(new Map());

    await expect(
      service.getSubReplies('reply-1', 2, '2026-04-02T10:30:00.000Z'),
    ).resolves.toEqual({
      replies: [],
      hasMore: false,
      nextCursor: null,
    });
  });

  it('builds thread responses with nested preview replies and pagination metadata', async () => {
    const rootMessage = makeMessageResponse({ id: 'root-1' });
    const reply1 = {
      id: 'reply-1',
      parentId: 'root-1',
      createdAt: new Date('2026-04-02T10:31:00.000Z'),
    };
    const reply2 = {
      id: 'reply-2',
      parentId: 'root-1',
      createdAt: new Date('2026-04-02T10:32:00.000Z'),
    };
    const reply3 = {
      id: 'reply-3',
      parentId: 'root-1',
      createdAt: new Date('2026-04-02T10:33:00.000Z'),
    };
    const subReply1 = {
      id: 'sub-1',
      parentId: 'reply-1',
      createdAt: new Date('2026-04-02T10:31:10.000Z'),
    };
    const subReply2 = {
      id: 'sub-2',
      parentId: 'reply-1',
      createdAt: new Date('2026-04-02T10:31:20.000Z'),
    };
    const subReply3 = {
      id: 'sub-3',
      parentId: 'reply-1',
      createdAt: new Date('2026-04-02T10:31:30.000Z'),
    };

    db.chains.selectOrderBy.mockResolvedValueOnce([
      reply1,
      subReply1,
      subReply2,
      subReply3,
      reply2,
      reply3,
    ]);

    jest.spyOn(service, 'getMessageWithDetails').mockResolvedValue(rootMessage);
    jest.spyOn(service as any, 'getMessagesWithDetailsBatch').mockResolvedValue(
      new Map([
        ['reply-1', makeMessageResponse({ id: 'reply-1' })],
        ['reply-2', makeMessageResponse({ id: 'reply-2' })],
        ['sub-1', makeMessageResponse({ id: 'sub-1' })],
        ['sub-2', makeMessageResponse({ id: 'sub-2' })],
      ]),
    );

    await expect(service.getThread('root-1', 2)).resolves.toEqual({
      rootMessage,
      replies: [
        {
          ...makeMessageResponse({ id: 'reply-1' }),
          subReplies: [
            makeMessageResponse({ id: 'sub-1' }),
            makeMessageResponse({ id: 'sub-2' }),
          ],
          subReplyCount: 3,
        },
        {
          ...makeMessageResponse({ id: 'reply-2' }),
          subReplies: [],
          subReplyCount: 0,
        },
      ],
      totalReplyCount: 3,
      hasMore: true,
      nextCursor: '2026-04-02T10:32:00.000Z',
    });
  });

  it('ignores an invalid thread cursor and still returns the first page of replies', async () => {
    const rootMessage = makeMessageResponse({ id: 'root-1' });
    db.chains.selectOrderBy.mockResolvedValueOnce([
      {
        id: 'reply-1',
        parentId: 'root-1',
        createdAt: new Date('2026-04-02T10:31:00.000Z'),
      },
      {
        id: 'reply-2',
        parentId: 'root-1',
        createdAt: new Date('2026-04-02T10:32:00.000Z'),
      },
    ]);

    jest.spyOn(service, 'getMessageWithDetails').mockResolvedValue(rootMessage);
    jest
      .spyOn(service as any, 'getMessagesWithDetailsBatch')
      .mockResolvedValue(
        new Map([['reply-1', makeMessageResponse({ id: 'reply-1' })]]),
      );

    await expect(service.getThread('root-1', 1, 'not-a-date')).resolves.toEqual(
      {
        rootMessage,
        replies: [
          {
            ...makeMessageResponse({ id: 'reply-1' }),
            subReplies: [],
            subReplyCount: 0,
          },
        ],
        totalReplyCount: 2,
        hasMore: true,
        nextCursor: '2026-04-02T10:31:00.000Z',
      },
    );
  });

  it('filters first-level thread replies when a valid cursor is provided', async () => {
    const rootMessage = makeMessageResponse({ id: 'root-1' });
    db.chains.selectOrderBy.mockResolvedValueOnce([
      {
        id: 'reply-old',
        parentId: 'root-1',
        rootId: 'root-1',
        createdAt: new Date('2026-04-02T10:30:00.000Z'),
      },
      {
        id: 'reply-new',
        parentId: 'root-1',
        rootId: 'root-1',
        createdAt: new Date('2026-04-02T10:32:00.000Z'),
      },
      {
        id: 'sub-1',
        parentId: 'reply-new',
        rootId: 'root-1',
        createdAt: new Date('2026-04-02T10:32:30.000Z'),
      },
    ]);
    jest.spyOn(service, 'getMessageWithDetails').mockResolvedValue(rootMessage);
    jest.spyOn(service as any, 'getMessagesWithDetailsBatch').mockResolvedValue(
      new Map([
        ['reply-new', makeMessageResponse({ id: 'reply-new' })],
        ['sub-1', makeMessageResponse({ id: 'sub-1' })],
      ]),
    );

    await expect(
      service.getThread('root-1', 2, '2026-04-02T10:31:00.000Z'),
    ).resolves.toEqual({
      rootMessage,
      replies: [
        {
          ...makeMessageResponse({ id: 'reply-new' }),
          subReplies: [makeMessageResponse({ id: 'sub-1' })],
          subReplyCount: 1,
        },
      ],
      totalReplyCount: 2,
      hasMore: false,
      nextCursor: null,
    });
  });

  it('throws when the message channel id cannot be resolved', async () => {
    db.chains.selectLimit.mockResolvedValueOnce([]);

    await expect(
      service.getMessageChannelId('missing-message'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('paginates second-level replies with limit plus one semantics', async () => {
    const orderedLimit = jest.fn<any>().mockResolvedValue([
      {
        id: 'sub-1',
        createdAt: new Date('2026-04-02T10:31:00.000Z'),
      },
      {
        id: 'sub-2',
        createdAt: new Date('2026-04-02T10:32:00.000Z'),
      },
      {
        id: 'sub-3',
        createdAt: new Date('2026-04-02T10:33:00.000Z'),
      },
    ]);
    const orderedWhereChain = {
      orderBy: jest.fn<any>().mockReturnValue({ limit: orderedLimit }),
      limit: db.chains.selectLimit,
    };
    db.chains.selectWhere.mockReturnValueOnce(orderedWhereChain);
    jest.spyOn(service as any, 'getMessagesWithDetailsBatch').mockResolvedValue(
      new Map([
        ['sub-1', makeMessageResponse({ id: 'sub-1' })],
        ['sub-2', makeMessageResponse({ id: 'sub-2' })],
      ]),
    );

    await expect(
      service.getSubReplies('reply-1', 2, '2026-04-02T10:30:30.000Z'),
    ).resolves.toEqual({
      replies: [
        makeMessageResponse({ id: 'sub-1' }),
        makeMessageResponse({ id: 'sub-2' }),
      ],
      hasMore: true,
      nextCursor: '2026-04-02T10:32:00.000Z',
    });

    expect(orderedLimit).toHaveBeenCalledWith(3);
  });

  it('falls back to the latest page when an around cursor cannot be resolved', async () => {
    const aroundTimestampChain = {
      from: jest.fn<any>().mockReturnThis(),
      where: jest.fn<any>().mockReturnThis(),
      limit: jest.fn<any>().mockResolvedValue([]),
    };
    const latestRowsLimit = jest.fn<any>().mockResolvedValue([
      makeMessageRow({
        id: 'message-3',
        createdAt: new Date('2026-04-02T10:33:00.000Z'),
      }),
      makeMessageRow({
        id: 'message-2',
        createdAt: new Date('2026-04-02T10:32:00.000Z'),
      }),
      makeMessageRow({
        id: 'message-1',
        createdAt: new Date('2026-04-02T10:31:00.000Z'),
      }),
    ]);
    const latestRowsChain = {
      from: jest.fn<any>().mockReturnThis(),
      where: jest.fn<any>().mockReturnThis(),
      orderBy: jest.fn<any>().mockReturnThis(),
      limit: latestRowsLimit,
    };
    db.select
      .mockReturnValueOnce(aroundTimestampChain)
      .mockReturnValueOnce(latestRowsChain);
    jest.spyOn(service as any, 'getMessagesWithDetailsBatch').mockResolvedValue(
      new Map([
        ['message-3', makeMessageResponse({ id: 'message-3' })],
        ['message-2', makeMessageResponse({ id: 'message-2' })],
      ]),
    );

    await expect(
      service.getChannelMessagesPaginated('channel-1', 2, {
        around: '11111111-1111-1111-1111-111111111111',
      }),
    ).resolves.toEqual({
      messages: [
        makeMessageResponse({ id: 'message-3' }),
        makeMessageResponse({ id: 'message-2' }),
      ],
      hasOlder: true,
      hasNewer: false,
    });

    expect(latestRowsLimit).toHaveBeenCalledWith(3);
  });

  it('falls back to the latest page when a before cursor cannot be resolved', async () => {
    const beforeTimestampChain = {
      from: jest.fn<any>().mockReturnThis(),
      where: jest.fn<any>().mockReturnThis(),
      limit: jest.fn<any>().mockResolvedValue([]),
    };
    const latestRowsLimit = jest.fn<any>().mockResolvedValue([
      makeMessageRow({
        id: 'message-2',
        createdAt: new Date('2026-04-02T10:32:00.000Z'),
      }),
      makeMessageRow({
        id: 'message-1',
        createdAt: new Date('2026-04-02T10:31:00.000Z'),
      }),
    ]);
    const latestRowsChain = {
      from: jest.fn<any>().mockReturnThis(),
      where: jest.fn<any>().mockReturnThis(),
      orderBy: jest.fn<any>().mockReturnThis(),
      limit: latestRowsLimit,
    };
    db.select
      .mockReturnValueOnce(beforeTimestampChain)
      .mockReturnValueOnce(latestRowsChain);
    jest.spyOn(service as any, 'getMessagesWithDetailsBatch').mockResolvedValue(
      new Map([
        ['message-2', makeMessageResponse({ id: 'message-2' })],
        ['message-1', makeMessageResponse({ id: 'message-1' })],
      ]),
    );

    await expect(
      service.getChannelMessagesPaginated('channel-1', 2, {
        before: '11111111-1111-1111-1111-111111111111',
      }),
    ).resolves.toEqual({
      messages: [
        makeMessageResponse({ id: 'message-2' }),
        makeMessageResponse({ id: 'message-1' }),
      ],
      hasOlder: false,
      hasNewer: false,
    });

    expect(latestRowsLimit).toHaveBeenCalledWith(3);
  });

  it('returns top-level channel messages and filters out missing detail rows', async () => {
    const orderedLimit = jest
      .fn<any>()
      .mockResolvedValue([{ id: 'message-1' }, { id: 'message-2' }]);
    db.chains.selectWhere.mockReturnValueOnce({
      orderBy: jest.fn<any>().mockReturnValue({ limit: orderedLimit }),
      limit: db.chains.selectLimit,
    });
    jest
      .spyOn(service as any, 'getMessagesWithDetailsBatch')
      .mockResolvedValue(
        new Map([['message-1', makeMessageResponse({ id: 'message-1' })]]),
      );

    await expect(
      service.getChannelMessages('channel-1', 2, 'not-a-uuid'),
    ).resolves.toEqual([makeMessageResponse({ id: 'message-1' })]);

    expect(orderedLimit).toHaveBeenCalledWith(2);
  });

  it('returns older channel messages when a valid before cursor resolves to a timestamp', async () => {
    const initialQueryChain = {
      from: jest.fn<any>().mockReturnThis(),
      where: jest.fn<any>().mockReturnThis(),
      orderBy: jest.fn<any>().mockReturnThis(),
      limit: jest.fn<any>().mockResolvedValue([]),
    };
    const beforeTimestampChain = {
      from: jest.fn<any>().mockReturnThis(),
      where: jest.fn<any>().mockReturnThis(),
      limit: jest
        .fn<any>()
        .mockResolvedValue([
          { createdAt: new Date('2026-04-02T10:35:00.000Z') },
        ]),
    };
    const olderRowsLimit = jest
      .fn<any>()
      .mockResolvedValue([
        makeMessageRow({ id: 'message-2' }),
        makeMessageRow({ id: 'message-1' }),
      ]);
    const olderRowsChain = {
      from: jest.fn<any>().mockReturnThis(),
      where: jest.fn<any>().mockReturnThis(),
      orderBy: jest.fn<any>().mockReturnThis(),
      limit: olderRowsLimit,
    };
    db.select
      .mockReturnValueOnce(initialQueryChain)
      .mockReturnValueOnce(beforeTimestampChain)
      .mockReturnValueOnce(olderRowsChain);
    jest.spyOn(service as any, 'getMessagesWithDetailsBatch').mockResolvedValue(
      new Map([
        ['message-2', makeMessageResponse({ id: 'message-2' })],
        ['message-1', makeMessageResponse({ id: 'message-1' })],
      ]),
    );

    await expect(
      service.getChannelMessages(
        'channel-1',
        2,
        '11111111-1111-1111-1111-111111111111',
      ),
    ).resolves.toEqual([
      makeMessageResponse({ id: 'message-2' }),
      makeMessageResponse({ id: 'message-1' }),
    ]);

    expect(olderRowsLimit).toHaveBeenCalledWith(2);
  });

  it('falls back to the latest channel messages when a valid before cursor cannot be resolved', async () => {
    const latestRowsLimit = jest.fn<any>().mockResolvedValue([
      makeMessageRow({
        id: 'message-2',
        createdAt: new Date('2026-04-02T10:32:00.000Z'),
      }),
      makeMessageRow({
        id: 'message-1',
        createdAt: new Date('2026-04-02T10:31:00.000Z'),
      }),
    ]);
    db.chains.selectWhere.mockReturnValueOnce({
      orderBy: jest.fn<any>().mockReturnValue({ limit: latestRowsLimit }),
      limit: db.chains.selectLimit,
    });
    db.chains.selectLimit.mockResolvedValueOnce([]);
    jest.spyOn(service as any, 'getMessagesWithDetailsBatch').mockResolvedValue(
      new Map([
        ['message-2', makeMessageResponse({ id: 'message-2' })],
        ['message-1', makeMessageResponse({ id: 'message-1' })],
      ]),
    );

    await expect(
      service.getChannelMessages(
        'channel-1',
        2,
        '11111111-1111-1111-1111-111111111111',
      ),
    ).resolves.toEqual([
      makeMessageResponse({ id: 'message-2' }),
      makeMessageResponse({ id: 'message-1' }),
    ]);

    expect(latestRowsLimit).toHaveBeenCalledWith(2);
  });

  it('returns thread replies through the batch detail helper', async () => {
    const orderedLimit = jest.fn<any>().mockResolvedValue([
      {
        id: 'reply-1',
        createdAt: new Date('2026-04-02T10:31:00.000Z'),
      },
      {
        id: 'reply-2',
        createdAt: new Date('2026-04-02T10:32:00.000Z'),
      },
    ]);
    db.chains.selectWhere.mockReturnValueOnce({
      orderBy: jest.fn<any>().mockReturnValue({ limit: orderedLimit }),
      limit: db.chains.selectLimit,
    });
    jest.spyOn(service as any, 'getMessagesWithDetailsBatch').mockResolvedValue(
      new Map([
        ['reply-1', makeMessageResponse({ id: 'reply-1' })],
        ['reply-2', makeMessageResponse({ id: 'reply-2' })],
      ]),
    );

    await expect(service.getThreadReplies('parent-1', 2)).resolves.toEqual([
      makeMessageResponse({ id: 'reply-1' }),
      makeMessageResponse({ id: 'reply-2' }),
    ]);
  });

  it('returns newer pages in descending order when a valid after cursor is provided', async () => {
    const afterTimestampChain = {
      from: jest.fn<any>().mockReturnThis(),
      where: jest.fn<any>().mockReturnThis(),
      limit: jest
        .fn<any>()
        .mockResolvedValue([
          { createdAt: new Date('2026-04-02T10:31:00.000Z') },
        ]),
    };
    const newerRowsLimit = jest.fn<any>().mockResolvedValue([
      makeMessageRow({
        id: 'message-2',
        createdAt: new Date('2026-04-02T10:32:00.000Z'),
      }),
      makeMessageRow({
        id: 'message-3',
        createdAt: new Date('2026-04-02T10:33:00.000Z'),
      }),
      makeMessageRow({
        id: 'message-4',
        createdAt: new Date('2026-04-02T10:34:00.000Z'),
      }),
    ]);
    const newerRowsChain = {
      from: jest.fn<any>().mockReturnThis(),
      where: jest.fn<any>().mockReturnThis(),
      orderBy: jest.fn<any>().mockReturnThis(),
      limit: newerRowsLimit,
    };
    db.select
      .mockReturnValueOnce(afterTimestampChain)
      .mockReturnValueOnce(newerRowsChain);
    jest.spyOn(service as any, 'getMessagesWithDetailsBatch').mockResolvedValue(
      new Map([
        ['message-3', makeMessageResponse({ id: 'message-3' })],
        ['message-2', makeMessageResponse({ id: 'message-2' })],
      ]),
    );

    await expect(
      service.getChannelMessagesPaginated('channel-1', 2, {
        after: '11111111-1111-1111-1111-111111111111',
      }),
    ).resolves.toEqual({
      messages: [
        makeMessageResponse({ id: 'message-3' }),
        makeMessageResponse({ id: 'message-2' }),
      ],
      hasOlder: true,
      hasNewer: true,
    });

    expect(newerRowsLimit).toHaveBeenCalledWith(3);
  });

  it('returns an empty newer page when the after cursor cannot be resolved', async () => {
    db.chains.selectLimit.mockResolvedValueOnce([]);

    await expect(
      service.getChannelMessagesPaginated('channel-1', 2, {
        after: '11111111-1111-1111-1111-111111111111',
      }),
    ).resolves.toEqual({
      messages: [],
      hasOlder: true,
      hasNewer: false,
    });
  });

  it('returns messages around an anchor and reports both directions when extra rows exist', async () => {
    const anchorTimestampChain = {
      from: jest.fn<any>().mockReturnThis(),
      where: jest.fn<any>().mockReturnThis(),
      limit: jest
        .fn<any>()
        .mockResolvedValue([
          { createdAt: new Date('2026-04-02T10:30:00.000Z') },
        ]),
    };
    const olderRowsChain = {
      from: jest.fn<any>().mockReturnThis(),
      where: jest.fn<any>().mockReturnThis(),
      orderBy: jest.fn<any>().mockReturnThis(),
      limit: jest.fn<any>().mockResolvedValue([
        makeMessageRow({
          id: 'older-nearest',
          createdAt: new Date('2026-04-02T10:29:00.000Z'),
        }),
        makeMessageRow({
          id: 'older-extra',
          createdAt: new Date('2026-04-02T10:28:00.000Z'),
        }),
      ]),
    };
    const newerRowsChain = {
      from: jest.fn<any>().mockReturnThis(),
      where: jest.fn<any>().mockReturnThis(),
      orderBy: jest.fn<any>().mockReturnThis(),
      limit: jest.fn<any>().mockResolvedValue([
        makeMessageRow({
          id: 'anchor',
          createdAt: new Date('2026-04-02T10:30:00.000Z'),
        }),
        makeMessageRow({
          id: 'newer-nearest',
          createdAt: new Date('2026-04-02T10:31:00.000Z'),
        }),
        makeMessageRow({
          id: 'newer-extra',
          createdAt: new Date('2026-04-02T10:32:00.000Z'),
        }),
      ]),
    };
    db.select
      .mockReturnValueOnce(anchorTimestampChain)
      .mockReturnValueOnce(olderRowsChain)
      .mockReturnValueOnce(newerRowsChain);
    jest.spyOn(service as any, 'getMessagesWithDetailsBatch').mockResolvedValue(
      new Map([
        ['newer-nearest', makeMessageResponse({ id: 'newer-nearest' })],
        ['anchor', makeMessageResponse({ id: 'anchor' })],
        ['older-nearest', makeMessageResponse({ id: 'older-nearest' })],
      ]),
    );

    await expect(
      service.getChannelMessagesPaginated('channel-1', 3, {
        around: '11111111-1111-1111-1111-111111111111',
      }),
    ).resolves.toEqual({
      messages: [
        makeMessageResponse({ id: 'newer-nearest' }),
        makeMessageResponse({ id: 'anchor' }),
        makeMessageResponse({ id: 'older-nearest' }),
      ],
      hasOlder: true,
      hasNewer: true,
    });
  });

  it('returns the latest page with hasOlder when no pagination cursor is provided', async () => {
    const orderedLimit = jest.fn<any>().mockResolvedValue([
      {
        id: 'message-3',
        createdAt: new Date('2026-04-02T10:33:00.000Z'),
      },
      {
        id: 'message-2',
        createdAt: new Date('2026-04-02T10:32:00.000Z'),
      },
      {
        id: 'message-1',
        createdAt: new Date('2026-04-02T10:31:00.000Z'),
      },
    ]);
    db.chains.selectWhere.mockReturnValueOnce({
      orderBy: jest.fn<any>().mockReturnValue({ limit: orderedLimit }),
      limit: db.chains.selectLimit,
    });
    jest.spyOn(service as any, 'getMessagesWithDetailsBatch').mockResolvedValue(
      new Map([
        ['message-3', makeMessageResponse({ id: 'message-3' })],
        ['message-2', makeMessageResponse({ id: 'message-2' })],
      ]),
    );

    await expect(
      service.getChannelMessagesPaginated('channel-1', 2, {}),
    ).resolves.toEqual({
      messages: [
        makeMessageResponse({ id: 'message-3' }),
        makeMessageResponse({ id: 'message-2' }),
      ],
      hasOlder: true,
      hasNewer: false,
    });

    expect(orderedLimit).toHaveBeenCalledWith(3);
  });

  it('returns older pages with hasNewer when a valid before cursor is provided', async () => {
    const beforeTimestampChain = {
      from: jest.fn<any>().mockReturnThis(),
      where: jest.fn<any>().mockReturnThis(),
      limit: jest
        .fn<any>()
        .mockResolvedValue([
          { createdAt: new Date('2026-04-02T10:35:00.000Z') },
        ]),
    };
    const beforeRowsLimit = jest.fn<any>().mockResolvedValue([
      makeMessageRow({
        id: 'message-2',
        createdAt: new Date('2026-04-02T10:34:00.000Z'),
      }),
      makeMessageRow({
        id: 'message-1',
        createdAt: new Date('2026-04-02T10:33:00.000Z'),
      }),
      makeMessageRow({
        id: 'message-0',
        createdAt: new Date('2026-04-02T10:32:00.000Z'),
      }),
    ]);
    const beforeRowsChain = {
      from: jest.fn<any>().mockReturnThis(),
      where: jest.fn<any>().mockReturnThis(),
      orderBy: jest.fn<any>().mockReturnThis(),
      limit: beforeRowsLimit,
    };
    db.select
      .mockReturnValueOnce(beforeTimestampChain)
      .mockReturnValueOnce(beforeRowsChain);
    jest.spyOn(service as any, 'getMessagesWithDetailsBatch').mockResolvedValue(
      new Map([
        ['message-2', makeMessageResponse({ id: 'message-2' })],
        ['message-1', makeMessageResponse({ id: 'message-1' })],
      ]),
    );

    await expect(
      service.getChannelMessagesPaginated('channel-1', 2, {
        before: '11111111-1111-1111-1111-111111111111',
      }),
    ).resolves.toEqual({
      messages: [
        makeMessageResponse({ id: 'message-2' }),
        makeMessageResponse({ id: 'message-1' }),
      ],
      hasOlder: true,
      hasNewer: true,
    });
  });

  describe('sendFromBot', () => {
    let botService: InstanceType<typeof MessagesService>;
    let imWorker: { createMessage: jest.Mock<any> };
    let mqService: {
      isReady: jest.Mock<any>;
      publishPostBroadcast: jest.Mock<any>;
    };
    let eventEmitterMock: { emit: jest.Mock<any> };
    let botDb: ReturnType<typeof createDbMock>;
    let botChannelSequenceService: { generateChannelSeq: jest.Mock<any> };
    let botMessagePropertiesService: { batchGetByMessageIds: jest.Mock<any> };
    let botLogger: { warn: jest.Mock<any> };
    let botModuleRef: { get: jest.Mock<any> };
    let msgResponse: MessageResponse;

    beforeEach(() => {
      botDb = createDbMock();
      botChannelSequenceService = {
        generateChannelSeq: jest.fn<any>().mockResolvedValue(1),
      };
      botMessagePropertiesService = {
        batchGetByMessageIds: jest.fn<any>().mockResolvedValue({}),
      };
      imWorker = {
        createMessage: jest.fn<any>().mockResolvedValue({
          msgId: 'msg-1',
          seqId: '1',
          clientMsgId: 'c-1',
        }),
      };
      mqService = {
        isReady: jest.fn<any>().mockReturnValue(true),
        publishPostBroadcast: jest.fn<any>().mockResolvedValue(undefined),
      };
      eventEmitterMock = { emit: jest.fn<any>() };
      botModuleRef = { get: jest.fn<any>() };

      botService = new MessagesService(
        botDb as never,
        botChannelSequenceService as never,
        botMessagePropertiesService as never,
        botModuleRef as never,
        imWorker as never,
        mqService as never,
        eventEmitterMock as never,
      );
      botLogger = { warn: jest.fn<any>() };
      (botService as any).logger = botLogger;

      // Stub the helper methods that require DB
      msgResponse = makeMessageResponse({
        id: 'msg-1',
        channelId: 'ch-1',
        senderId: 'bot-1',
        content: 'hello bot',
      });
      jest
        .spyOn(botService, 'getMessageWithDetails')
        .mockResolvedValue(msgResponse);
      jest
        .spyOn(botService, 'mergeProperties')
        .mockResolvedValue([msgResponse]);
      jest.spyOn(botService, 'truncateForPreview').mockReturnValue(msgResponse);
    });

    it('inserts message via gRPC, returns {channelId, messageId, preview}', async () => {
      const result = await botService.sendFromBot({
        botUserId: 'bot-1',
        channelId: 'ch-1',
        content: 'hello bot',
        workspaceId: 'ws-1',
      });

      expect(result).toEqual({
        channelId: 'ch-1',
        messageId: 'msg-1',
        preview: msgResponse,
      });
      expect(imWorker.createMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channelId: 'ch-1',
          senderId: 'bot-1',
          content: 'hello bot',
          workspaceId: 'ws-1',
        }),
      );
    });

    it('does NOT call websocketGateway directly (broadcast is caller responsibility)', async () => {
      // sendFromBot should not have a websocketGateway dep — no property exists
      expect((botService as any).websocketGateway).toBeUndefined();

      const result = await botService.sendFromBot({
        botUserId: 'bot-1',
        channelId: 'ch-1',
        content: 'hello bot',
        workspaceId: 'ws-1',
      });

      // preview is returned for the caller to broadcast
      expect(result.preview).toEqual(msgResponse);
    });

    it('forwards attachments to the gRPC client', async () => {
      const attachments = [
        {
          fileKey: 'file-key-1',
          fileName: 'photo.png',
          mimeType: 'image/png',
          fileSize: 1024,
        },
      ];

      await botService.sendFromBot({
        botUserId: 'bot-1',
        channelId: 'ch-1',
        content: 'see attachment',
        attachments,
        workspaceId: 'ws-1',
      });

      expect(imWorker.createMessage).toHaveBeenCalledWith(
        expect.objectContaining({ attachments }),
      );
    });

    it('skips post-broadcast publish when gatewayMQService is absent', async () => {
      const serviceWithoutMQ = new MessagesService(
        botDb as never,
        botChannelSequenceService as never,
        botMessagePropertiesService as never,
        botModuleRef as never,
        imWorker as never,
        undefined, // no MQ service
        eventEmitterMock as never,
      );
      jest
        .spyOn(serviceWithoutMQ, 'getMessageWithDetails')
        .mockResolvedValue(makeMessageResponse({ id: 'msg-1' }));
      jest
        .spyOn(serviceWithoutMQ, 'mergeProperties')
        .mockResolvedValue([makeMessageResponse({ id: 'msg-1' })]);
      jest
        .spyOn(serviceWithoutMQ, 'truncateForPreview')
        .mockReturnValue(makeMessageResponse({ id: 'msg-1' }));

      await serviceWithoutMQ.sendFromBot({
        botUserId: 'bot-1',
        channelId: 'ch-1',
        content: 'hi',
        workspaceId: 'ws-1',
      });

      expect(mqService.publishPostBroadcast).not.toHaveBeenCalled();
    });

    it('skips post-broadcast publish when gatewayMQService.isReady() returns false', async () => {
      mqService.isReady.mockReturnValue(false);

      await botService.sendFromBot({
        botUserId: 'bot-1',
        channelId: 'ch-1',
        content: 'hi',
        workspaceId: 'ws-1',
      });

      expect(mqService.publishPostBroadcast).not.toHaveBeenCalled();
    });

    it('does NOT publish channel-message trigger (RABBITMQ_ROUTING_KEYS.MESSAGE_CREATED)', async () => {
      // The publishWorkspaceEvent is the method used for MESSAGE_CREATED routing key.
      // Since GatewayMQService is passed in as a plain mock without publishWorkspaceEvent,
      // we verify it is never called — confirming the method is absent from sendFromBot.
      const mqWithWorkspaceEvent = {
        isReady: jest.fn<any>().mockReturnValue(true),
        publishPostBroadcast: jest.fn<any>().mockResolvedValue(undefined),
        publishWorkspaceEvent: jest.fn<any>().mockResolvedValue(undefined),
      };

      const serviceWithMQ = new MessagesService(
        botDb as never,
        botChannelSequenceService as never,
        botMessagePropertiesService as never,
        botModuleRef as never,
        imWorker as never,
        mqWithWorkspaceEvent as never,
        eventEmitterMock as never,
      );
      jest
        .spyOn(serviceWithMQ, 'getMessageWithDetails')
        .mockResolvedValue(makeMessageResponse({ id: 'msg-1' }));
      jest
        .spyOn(serviceWithMQ, 'mergeProperties')
        .mockResolvedValue([makeMessageResponse({ id: 'msg-1' })]);
      jest
        .spyOn(serviceWithMQ, 'truncateForPreview')
        .mockReturnValue(makeMessageResponse({ id: 'msg-1' }));

      await serviceWithMQ.sendFromBot({
        botUserId: 'bot-1',
        channelId: 'ch-1',
        content: 'hi',
        workspaceId: 'ws-1',
      });

      expect(mqWithWorkspaceEvent.publishWorkspaceEvent).not.toHaveBeenCalled();
    });

    it('emits message.created event for search indexing', async () => {
      await botService.sendFromBot({
        botUserId: 'bot-1',
        channelId: 'ch-1',
        content: 'hello bot',
        workspaceId: 'ws-1',
      });

      expect(eventEmitterMock.emit).toHaveBeenCalledWith(
        'message.created',
        expect.objectContaining({
          message: expect.objectContaining({ id: 'msg-1' }),
          channel: { id: 'ch-1' },
          sender: { id: 'bot-1' },
        }),
      );
    });

    it('fires post-broadcast publish and catches errors without propagating', async () => {
      mqService.publishPostBroadcast.mockRejectedValue(new Error('MQ down'));

      // Should not throw
      await expect(
        botService.sendFromBot({
          botUserId: 'bot-1',
          channelId: 'ch-1',
          content: 'hi',
          workspaceId: 'ws-1',
        }),
      ).resolves.toMatchObject({ channelId: 'ch-1', messageId: 'msg-1' });

      // Give the microtask queue a tick for the .catch() to run
      await Promise.resolve();

      expect(botLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('sendFromBot post-broadcast publish failed'),
      );
    });

    it('throws when imWorkerGrpcClientService is not injected', async () => {
      const serviceNoGrpc = new MessagesService(
        botDb as never,
        botChannelSequenceService as never,
        botMessagePropertiesService as never,
        botModuleRef as never,
        undefined, // no gRPC
      );

      await expect(
        serviceNoGrpc.sendFromBot({
          botUserId: 'bot-1',
          channelId: 'ch-1',
          content: 'hi',
          workspaceId: 'ws-1',
        }),
      ).rejects.toThrow('imWorkerGrpcClientService is not injected');
    });
  });

  it('adds reactions without failing on conflicts', async () => {
    await expect(
      service.addReaction('message-1', 'user-1', ':+1:'),
    ).resolves.toBeUndefined();

    expect(db.chains.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'message-1',
        userId: 'user-1',
        emoji: ':+1:',
      }),
    );
    expect(db.chains.insertOnConflictDoNothing).toHaveBeenCalled();
  });

  it('removes reactions by message, user, and emoji', async () => {
    await expect(
      service.removeReaction('message-1', 'user-1', ':+1:'),
    ).resolves.toBeUndefined();

    expect(db.delete).toHaveBeenCalled();
    expect(db.chains.deleteWhere).toHaveBeenCalled();
  });

  it('returns the owning channel id and rejects unknown messages', async () => {
    db.chains.selectLimit
      .mockResolvedValueOnce([{ channelId: 'channel-1' }])
      .mockResolvedValueOnce([]);

    await expect(service.getMessageChannelId('message-1')).resolves.toBe(
      'channel-1',
    );
    await expect(
      service.getMessageChannelId('missing-message'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  // ==================== cascade purge on soft delete ====================

  it('emits message_relations_purged with affectedSourceIds when inbound relation edges exist', async () => {
    db.chains.selectLimit.mockResolvedValueOnce([makeMessageRow()]);
    // selectDistinct returns two source messages that point to the deleted message
    db.chains.selectDistinctWhere.mockResolvedValueOnce([
      { sourceMessageId: 'src-a' },
      { sourceMessageId: 'src-b' },
    ]);
    channelSequenceService.generateChannelSeq.mockResolvedValueOnce(300);

    await expect(
      service.delete('message-1', 'user-1'),
    ).resolves.toBeUndefined();

    expect(mockWsGateway.emitRelationsPurged).toHaveBeenCalledWith({
      channelId: 'channel-1',
      deletedMessageId: 'message-1',
      affectedSourceIds: ['src-a', 'src-b'],
    });
  });

  it('skips emitRelationsPurged when no edges reference the deleted message', async () => {
    db.chains.selectLimit.mockResolvedValueOnce([makeMessageRow()]);
    // selectDistinct returns empty list — no inbound edges
    db.chains.selectDistinctWhere.mockResolvedValueOnce([]);
    channelSequenceService.generateChannelSeq.mockResolvedValueOnce(301);

    await expect(
      service.delete('message-1', 'user-1'),
    ).resolves.toBeUndefined();

    expect(mockWsGateway.emitRelationsPurged).not.toHaveBeenCalled();
  });

  it('logs error but does NOT throw when emitRelationsPurged fails (best-effort)', async () => {
    db.chains.selectLimit.mockResolvedValueOnce([makeMessageRow()]);
    db.chains.selectDistinctWhere.mockResolvedValueOnce([
      { sourceMessageId: 'src-a' },
    ]);
    channelSequenceService.generateChannelSeq.mockResolvedValueOnce(302);
    mockWsGateway.emitRelationsPurged.mockRejectedValueOnce(
      new Error('ws down'),
    );

    // Should resolve (not reject) — purge emit failure must not roll back the delete
    await expect(
      service.delete('message-1', 'user-1'),
    ).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('message_relations_purged'),
      expect.any(Error),
    );
    // The soft delete update should still have been called
    expect(db.chains.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ isDeleted: true }),
    );
  });
});
