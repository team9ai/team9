import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('@team9/database', () => ({
  DATABASE_CONNECTION: Symbol('DATABASE_CONNECTION'),
  eq: jest.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
  and: jest.fn((...args: unknown[]) => ({ op: 'and', args })),
  inArray: jest.fn((left: unknown, right: unknown) => ({
    op: 'inArray',
    left,
    right,
  })),
  isNull: jest.fn((value: unknown) => ({ op: 'isNull', value })),
  lt: jest.fn((left: unknown, right: unknown) => ({ op: 'lt', left, right })),
  sql: jest.fn((strings: TemplateStringsArray, ...expr: unknown[]) => ({
    op: 'sql',
    strings,
    expr,
  })),
}));

jest.unstable_mockModule('uuid', () => ({
  v7: jest.fn(() => 'uuid-fixed'),
}));

const dbLib = await import('@team9/database');
const schema = await import('@team9/database/schemas');
const { OutboxProcessorService } =
  await import('./outbox-processor.service.js');

type MockFn = jest.Mock<(...args: any[]) => any>;

function makeDbMock(options?: {
  staleEvents?: any[];
  memberRows?: Array<{ userId: string }>;
}) {
  const staleSelectChain: Record<string, MockFn> = {};
  for (const method of ['from', 'where', 'orderBy']) {
    staleSelectChain[method] = jest.fn<any>().mockReturnValue(staleSelectChain);
  }
  staleSelectChain.limit = jest
    .fn<any>()
    .mockResolvedValue(options?.staleEvents ?? []);

  const memberSelectChain: Record<string, MockFn> = {};
  memberSelectChain.from = jest.fn<any>().mockReturnValue(memberSelectChain);
  memberSelectChain.where = jest
    .fn<any>()
    .mockImplementation(() => Promise.resolve(options?.memberRows ?? []));

  const updateChain: Record<string, MockFn> = {};
  updateChain.set = jest.fn<any>().mockReturnValue(updateChain);
  updateChain.where = jest.fn<any>().mockResolvedValue(undefined);

  const insertChain: Record<string, MockFn> = {};
  insertChain.values = jest.fn<any>().mockReturnValue(insertChain);
  insertChain.onConflictDoUpdate = jest.fn<any>().mockResolvedValue(undefined);

  const db: any = {
    select: jest.fn<any>().mockImplementation((projection?: unknown) => {
      if (projection) return memberSelectChain;
      return staleSelectChain;
    }),
    update: jest.fn<any>().mockReturnValue(updateChain),
    insert: jest.fn<any>().mockReturnValue(insertChain),
  };

  return { db, staleSelectChain, memberSelectChain, updateChain, insertChain };
}

function buildEvent(overrides: Record<string, any> = {}) {
  return {
    id: 'outbox-1',
    messageId: 'message-1',
    eventType: 'message_created',
    status: 'pending',
    retryCount: 0,
    payload: {
      msgId: 'message-1',
      channelId: 'channel-1',
      senderId: 'user-sender',
      content: 'hello',
      parentId: undefined,
      rootId: undefined,
      type: 'text',
      seqId: '123',
      timestamp: 1_700_000_000_000,
      workspaceId: 'workspace-1',
      metadata: { source: 'test' },
    },
    ...overrides,
  };
}

describe('OutboxProcessorService', () => {
  let service: OutboxProcessorService;
  let db: ReturnType<typeof makeDbMock>['db'];
  let staleSelectChain: ReturnType<typeof makeDbMock>['staleSelectChain'];
  let memberSelectChain: ReturnType<typeof makeDbMock>['memberSelectChain'];
  let updateChain: ReturnType<typeof makeDbMock>['updateChain'];
  let insertChain: ReturnType<typeof makeDbMock>['insertChain'];

  beforeEach(() => {
    jest.clearAllMocks();

    const mocks = makeDbMock();
    db = mocks.db;
    staleSelectChain = mocks.staleSelectChain;
    memberSelectChain = mocks.memberSelectChain;
    updateChain = mocks.updateChain;
    insertChain = mocks.insertChain;

    service = new OutboxProcessorService(db as never);
  });

  it('builds the stale events query with the expected filters and batch limit', async () => {
    const fixedNow = new Date('2024-01-01T12:00:00.000Z').getTime();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(fixedNow);

    await service.getStaleEvents();

    expect(db.select).toHaveBeenCalledWith();
    expect(staleSelectChain.from).toHaveBeenCalledWith(schema.messageOutbox);
    expect(dbLib.inArray).toHaveBeenCalledWith(schema.messageOutbox.status, [
      'pending',
      'processing',
    ]);

    const staleThreshold = new Date(fixedNow - 5 * 60 * 1000);
    expect(dbLib.lt).toHaveBeenCalledWith(
      schema.messageOutbox.createdAt,
      staleThreshold,
    );
    expect(dbLib.and).toHaveBeenCalledWith(
      expect.objectContaining({ op: 'inArray' }),
      expect.objectContaining({ op: 'lt' }),
    );
    expect(staleSelectChain.orderBy).toHaveBeenCalledWith(
      schema.messageOutbox.createdAt,
    );
    expect(staleSelectChain.limit).toHaveBeenCalledWith(100);

    nowSpy.mockRestore();
  });

  it('returns early when manual processing is already in progress', async () => {
    const getStaleEvents = jest.fn<any>();
    (service as any).getStaleEvents = getStaleEvents;
    (service as any).isProcessing = true;

    await expect(service.processStaleEvents()).resolves.toEqual({
      processed: 0,
      failed: 0,
    });

    expect(getStaleEvents).not.toHaveBeenCalled();
    expect((service as any).isProcessing).toBe(true);
  });

  it('returns zero counts when there are no stale events', async () => {
    const getStaleEvents = jest.fn<any>().mockResolvedValue([]);
    const processEvent = jest.fn<any>();
    (service as any).getStaleEvents = getStaleEvents;
    (service as any).processEvent = processEvent;

    await expect(service.processStaleEvents()).resolves.toEqual({
      processed: 0,
      failed: 0,
    });

    expect(getStaleEvents).toHaveBeenCalledTimes(1);
    expect(processEvent).not.toHaveBeenCalled();
    expect((service as any).isProcessing).toBe(false);
  });

  it('processes unread updates and marks an event completed', async () => {
    const memberMocks = makeDbMock({
      memberRows: [
        { userId: 'user-sender' },
        { userId: 'user-a' },
        { userId: 'user-b' },
      ],
    });
    db = memberMocks.db;
    memberSelectChain = memberMocks.memberSelectChain;
    updateChain = memberMocks.updateChain;
    insertChain = memberMocks.insertChain;
    service = new OutboxProcessorService(db as never);

    await (service as any).processEvent(
      buildEvent({
        retryCount: 0,
        payload: {
          msgId: 'message-1',
          channelId: 'channel-1',
          senderId: 'user-sender',
          content: 'hello',
          type: 'text',
          seqId: '123',
          timestamp: 1_700_000_000_000,
        },
      }),
    );

    expect(db.update).toHaveBeenCalledTimes(2);
    expect(updateChain.set).toHaveBeenNthCalledWith(1, {
      status: 'processing',
    });
    expect(updateChain.set).toHaveBeenNthCalledWith(2, {
      status: 'completed',
      processedAt: expect.any(Date),
    });
    expect(db.select).toHaveBeenCalledWith({
      userId: schema.channelMembers.userId,
    });
    expect(memberSelectChain.where).toHaveBeenCalled();
    expect(db.insert).toHaveBeenCalledTimes(2);
    expect(insertChain.values).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: 'uuid-fixed',
        userId: 'user-a',
        channelId: 'channel-1',
        unreadCount: 1,
      }),
    );
    expect(insertChain.values).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: 'uuid-fixed',
        userId: 'user-b',
        channelId: 'channel-1',
        unreadCount: 1,
      }),
    );
    expect(insertChain.onConflictDoUpdate).toHaveBeenCalledTimes(2);
  });

  it('marks an event completed without unread updates when there are no recipients', async () => {
    const memberMocks = makeDbMock({
      memberRows: [{ userId: 'user-sender' }],
    });
    db = memberMocks.db;
    updateChain = memberMocks.updateChain;
    insertChain = memberMocks.insertChain;
    service = new OutboxProcessorService(db as never);

    await (service as any).processEvent(
      buildEvent({
        payload: {
          msgId: 'message-2',
          channelId: 'channel-1',
          senderId: 'user-sender',
          content: 'hello',
          type: 'text',
          seqId: '456',
          timestamp: 1_700_000_000_100,
        },
      }),
    );

    expect(db.update).toHaveBeenCalledTimes(2);
    expect(updateChain.set).toHaveBeenNthCalledWith(1, {
      status: 'processing',
    });
    expect(updateChain.set).toHaveBeenNthCalledWith(2, {
      status: 'completed',
      processedAt: expect.any(Date),
    });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('retries to pending while under the retry limit', async () => {
    await (service as any).handleRetry(
      buildEvent({ retryCount: 0 }),
      new Error('transient failure'),
    );

    expect(db.update).toHaveBeenCalledTimes(1);
    expect(updateChain.set).toHaveBeenCalledWith({
      status: 'pending',
      retryCount: 1,
      errorMessage: 'transient failure',
    });
  });

  it('retries to failed when the retry limit is reached', async () => {
    await (service as any).handleRetry(
      buildEvent({ retryCount: 2 }),
      new Error('permanent failure'),
    );

    expect(db.update).toHaveBeenCalledTimes(1);
    expect(updateChain.set).toHaveBeenCalledWith({
      status: 'failed',
      retryCount: 3,
      errorMessage: 'permanent failure',
    });
  });

  it('rethrows top-level stale processing errors and resets the processing flag', async () => {
    const getStaleEvents = jest
      .fn<any>()
      .mockRejectedValue(new Error('db down'));
    (service as any).getStaleEvents = getStaleEvents;

    await expect(service.processStaleEvents()).rejects.toThrow('db down');

    expect(getStaleEvents).toHaveBeenCalledTimes(1);
    expect((service as any).isProcessing).toBe(false);
  });
});
