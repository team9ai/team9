import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

const mockEq = jest.fn((left: unknown, right: unknown) => ({
  kind: 'eq',
  left,
  right,
}));
const mockAnd = jest.fn((...clauses: unknown[]) => ({
  kind: 'and',
  clauses,
}));
const mockGt = jest.fn((left: unknown, right: unknown) => ({
  kind: 'gt',
  left,
  right,
}));
const mockInArray = jest.fn((left: unknown, right: unknown) => ({
  kind: 'inArray',
  left,
  right,
}));
const mockSql = jest.fn(
  (strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: 'sql',
    text: String.raw(strings, ...values.map((value) => String(value))),
    values,
  }),
);
const mockUuidV7 = jest.fn(() => 'sync-position-id');

const schemaModule = {
  messages: {
    id: 'messages.id',
    channelId: 'messages.channelId',
    senderId: 'messages.senderId',
    parentId: 'messages.parentId',
    rootId: 'messages.rootId',
    content: 'messages.content',
    type: 'messages.type',
    seqId: 'messages.seqId',
    isPinned: 'messages.isPinned',
    isEdited: 'messages.isEdited',
    isDeleted: 'messages.isDeleted',
    createdAt: 'messages.createdAt',
    updatedAt: 'messages.updatedAt',
  },
  users: {
    id: 'users.id',
    username: 'users.username',
    displayName: 'users.displayName',
    avatarUrl: 'users.avatarUrl',
  },
  userChannelReadStatus: {
    id: 'userChannelReadStatus.id',
    userId: 'userChannelReadStatus.userId',
    channelId: 'userChannelReadStatus.channelId',
    lastReadAt: 'userChannelReadStatus.lastReadAt',
    unreadCount: 'userChannelReadStatus.unreadCount',
    lastSyncSeqId: 'userChannelReadStatus.lastSyncSeqId',
  },
};

jest.unstable_mockModule('@team9/database', () => ({
  DATABASE_CONNECTION: Symbol('DATABASE_CONNECTION'),
  eq: mockEq,
  and: mockAnd,
  gt: mockGt,
  inArray: mockInArray,
  sql: mockSql,
}));

jest.unstable_mockModule('@team9/database/schemas', () => schemaModule);
jest.unstable_mockModule('@team9/redis', () => ({
  RedisService: class RedisService {},
}));
jest.unstable_mockModule('uuid', () => ({
  v7: mockUuidV7,
}));

const { SyncService } = await import('./sync.service.js');
const schema = await import('@team9/database/schemas');
const { REDIS_KEYS } = await import('../shared/constants/redis-keys.js');

type SelectPlan = {
  terminal: 'where' | 'limit';
  result: unknown;
};

type MockFn = jest.Mock<(...args: any[]) => any>;

function createSelectQuery(plan: SelectPlan) {
  const query: Record<string, MockFn> = {
    from: jest.fn<any>(),
    where: jest.fn<any>(),
    orderBy: jest.fn<any>(),
    limit: jest.fn<any>(),
  };

  query.from.mockReturnValue(query as never);
  query.orderBy.mockReturnValue(query as never);
  query.where.mockImplementation(() =>
    plan.terminal === 'where' ? Promise.resolve(plan.result) : (query as never),
  );
  query.limit.mockImplementation(() =>
    plan.terminal === 'limit' ? Promise.resolve(plan.result) : (query as never),
  );

  return query;
}

function createInsertQuery() {
  const query = {
    values: jest.fn<any>().mockReturnThis(),
    onConflictDoUpdate: jest.fn<any>().mockResolvedValue(undefined),
  };

  return query;
}

function createDbMock() {
  const state = {
    selectPlans: [] as SelectPlan[],
  };

  const db: any = {
    select: jest.fn((...args: unknown[]) => {
      const plan = state.selectPlans.shift();
      if (!plan) {
        throw new Error(`Unexpected select() call: ${JSON.stringify(args)}`);
      }

      const query = createSelectQuery(plan);
      query.selectArgs = args;
      return query;
    }),
    insert: jest.fn((...args: unknown[]) => {
      const query = createInsertQuery();
      query.insertArgs = args;
      db.insertChain = query;
      return query;
    }),
    insertChain: null as ReturnType<typeof createInsertQuery> | null,
  };

  return { db, state };
}

function createRedisMock() {
  const client = {
    hget: jest.fn<any>().mockResolvedValue(null),
    hset: jest.fn<any>().mockResolvedValue(1),
    del: jest.fn<any>().mockResolvedValue(1),
  };

  const redisService = {
    get: jest.fn<any>().mockResolvedValue(null),
    getClient: jest.fn(() => client),
  };

  return { redisService, client };
}

function makeMessageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'message-1',
    channelId: 'channel-1',
    senderId: 'sender-1',
    parentId: null,
    rootId: null,
    content: 'hello',
    type: 'text',
    seqId: 6n,
    isPinned: false,
    isEdited: false,
    isDeleted: false,
    createdAt: new Date('2026-04-02T10:30:00.000Z'),
    updatedAt: new Date('2026-04-02T10:30:00.000Z'),
    ...overrides,
  };
}

function makeSenderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sender-1',
    username: 'alice',
    displayName: 'Alice',
    avatarUrl: null,
    ...overrides,
  };
}

describe('SyncService', () => {
  let service: InstanceType<typeof SyncService>;
  let db: ReturnType<typeof createDbMock>;
  let redis: ReturnType<typeof createRedisMock>;
  let logger: {
    debug: MockFn;
  };
  const now = new Date('2026-04-02T10:30:00.000Z');

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(now);

    db = createDbMock();
    redis = createRedisMock();
    service = new SyncService(db.db as never, redis.redisService as never);
    logger = {
      debug: jest.fn<any>(),
    };
    (service as any).logger = logger;
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('returns an empty response from cache without touching the DB when there are no new messages', async () => {
    redis.client.hget.mockResolvedValueOnce('42');
    redis.redisService.get.mockResolvedValueOnce('42');

    await expect(service.syncChannel('user-1', 'channel-1')).resolves.toEqual({
      channelId: 'channel-1',
      messages: [],
      fromSeqId: '42',
      toSeqId: '42',
      hasMore: false,
    });

    expect(redis.client.hget).toHaveBeenCalledWith(
      REDIS_KEYS.USER_SYNC_POSITIONS('user-1'),
      'channel-1',
    );
    expect(redis.redisService.get).toHaveBeenCalledWith(
      REDIS_KEYS.CHANNEL_SEQ('channel-1'),
    );
    expect(db.db.select).not.toHaveBeenCalled();
    expect(redis.client.hset).not.toHaveBeenCalled();
  });

  it('loads the sync position from the DB on cache miss and still early returns when the channel is already caught up', async () => {
    db.state.selectPlans.push({
      terminal: 'limit',
      result: [{ lastSyncSeqId: 7n }],
    });
    redis.client.hget.mockResolvedValueOnce(null);
    redis.redisService.get.mockResolvedValueOnce('7');

    await expect(service.syncChannel('user-1', 'channel-1')).resolves.toEqual({
      channelId: 'channel-1',
      messages: [],
      fromSeqId: '7',
      toSeqId: '7',
      hasMore: false,
    });

    expect(db.db.select).toHaveBeenCalledTimes(1);
    expect(redis.client.hset).toHaveBeenCalledWith(
      REDIS_KEYS.USER_SYNC_POSITIONS('user-1'),
      'channel-1',
      '7',
    );
    expect(db.db.insert).not.toHaveBeenCalled();
  });

  it('enriches senders for incremental sync results and advances the sync position', async () => {
    db.state.selectPlans.push(
      {
        terminal: 'limit',
        result: [{ lastSyncSeqId: 5n }],
      },
      {
        terminal: 'limit',
        result: [
          makeMessageRow({
            id: 'message-1',
            senderId: 'sender-1',
            seqId: 6n,
          }),
          makeMessageRow({
            id: 'message-2',
            senderId: 'sender-2',
            parentId: 'message-1',
            rootId: 'message-1',
            seqId: 7n,
          }),
        ],
      },
      {
        terminal: 'where',
        result: [
          makeSenderRow({
            id: 'sender-1',
            username: 'alice',
            displayName: 'Alice',
          }),
          makeSenderRow({
            id: 'sender-2',
            username: 'bob',
            displayName: 'Bob',
          }),
        ],
      },
    );
    redis.client.hget.mockResolvedValueOnce(null);
    redis.redisService.get.mockResolvedValueOnce('10');

    await expect(
      service.syncChannel('user-1', 'channel-1', 50),
    ).resolves.toEqual({
      channelId: 'channel-1',
      messages: [
        {
          id: 'message-1',
          channelId: 'channel-1',
          senderId: 'sender-1',
          parentId: null,
          rootId: null,
          content: 'hello',
          type: 'text',
          seqId: '6',
          isPinned: false,
          isEdited: false,
          isDeleted: false,
          createdAt: '2026-04-02T10:30:00.000Z',
          updatedAt: '2026-04-02T10:30:00.000Z',
          sender: {
            id: 'sender-1',
            username: 'alice',
            displayName: 'Alice',
            avatarUrl: null,
          },
        },
        {
          id: 'message-2',
          channelId: 'channel-1',
          senderId: 'sender-2',
          parentId: 'message-1',
          rootId: 'message-1',
          content: 'hello',
          type: 'text',
          seqId: '7',
          isPinned: false,
          isEdited: false,
          isDeleted: false,
          createdAt: '2026-04-02T10:30:00.000Z',
          updatedAt: '2026-04-02T10:30:00.000Z',
          sender: {
            id: 'sender-2',
            username: 'bob',
            displayName: 'Bob',
            avatarUrl: null,
          },
        },
      ],
      fromSeqId: '5',
      toSeqId: '7',
      hasMore: false,
    });

    expect(mockInArray).toHaveBeenCalledWith(schema.users.id, [
      'sender-1',
      'sender-2',
    ]);
    expect(redis.client.hset).toHaveBeenCalledWith(
      REDIS_KEYS.USER_SYNC_POSITIONS('user-1'),
      'channel-1',
      '7',
    );
    expect(db.db.insertChain?.values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'sync-position-id',
        userId: 'user-1',
        channelId: 'channel-1',
        lastSyncSeqId: 7n,
        lastReadAt: now,
        unreadCount: 0,
      }),
    );
    expect(logger.debug).toHaveBeenCalledWith(
      'Updated sync position: user=user-1, channel=channel-1, seqId=7',
    );
  });

  it('persists sync position updates to Redis and the database', async () => {
    await service.updateSyncPosition('user-9', 'channel-9', 99n);

    expect(redis.redisService.getClient).toHaveBeenCalledTimes(1);
    expect(redis.client.hset).toHaveBeenCalledWith(
      REDIS_KEYS.USER_SYNC_POSITIONS('user-9'),
      'channel-9',
      '99',
    );
    expect(db.db.insert).toHaveBeenCalledWith(schema.userChannelReadStatus);
    expect(db.db.insertChain?.values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'sync-position-id',
        userId: 'user-9',
        channelId: 'channel-9',
        lastSyncSeqId: 99n,
        lastReadAt: now,
        unreadCount: 0,
      }),
    );
    expect(db.db.insertChain?.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: [
          schema.userChannelReadStatus.userId,
          schema.userChannelReadStatus.channelId,
        ],
        set: expect.objectContaining({
          lastSyncSeqId: expect.objectContaining({ kind: 'sql' }),
        }),
      }),
    );
  });

  it('clears the sync cache hash for a user', async () => {
    await service.clearSyncCache('user-1');

    expect(redis.client.del).toHaveBeenCalledWith(
      REDIS_KEYS.USER_SYNC_POSITIONS('user-1'),
    );
  });
});
