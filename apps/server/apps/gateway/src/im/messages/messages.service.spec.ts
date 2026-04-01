import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { MessagesService, type MessageResponse } from './messages.service.js';

function createDbMock() {
  const selectLimit = jest.fn<any>().mockResolvedValue([]);
  const selectOrderBy = jest.fn<any>().mockResolvedValue([]);
  const selectWhere = jest.fn<any>().mockReturnValue({
    limit: selectLimit,
    orderBy: selectOrderBy,
  });
  const selectFrom = jest.fn<any>().mockReturnValue({ where: selectWhere });

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
    insert: jest.fn<any>().mockReturnValue({ values: insertValues }),
    update: jest.fn<any>().mockReturnValue({ set: updateSet }),
    delete: jest.fn<any>().mockReturnValue({ where: deleteWhere }),
    chains: {
      selectFrom,
      selectWhere,
      selectLimit,
      selectOrderBy,
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
  let service: MessagesService;
  let db: ReturnType<typeof createDbMock>;
  let channelSequenceService: {
    generateChannelSeq: jest.Mock<any>;
  };
  let logger: {
    warn: jest.Mock<any>;
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-02T10:30:00.000Z'));

    db = createDbMock();
    channelSequenceService = {
      generateChannelSeq: jest.fn<any>().mockResolvedValue(101),
    };
    service = new MessagesService(db as never, channelSequenceService as never);
    logger = {
      warn: jest.fn<any>(),
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

  it('pins messages by updating the pinned flag', async () => {
    await expect(
      service.pinMessage('message-1', true),
    ).resolves.toBeUndefined();

    expect(db.chains.updateSet).toHaveBeenCalledWith({
      isPinned: true,
      updatedAt: new Date('2026-04-02T10:30:00.000Z'),
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
});
