import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockEq = jest.fn((field: unknown, value: unknown) => ({
  kind: 'eq',
  field,
  value,
}));
const mockAnd = jest.fn((...conditions: unknown[]) => ({
  kind: 'and',
  conditions,
}));
const mockInArray = jest.fn((field: unknown, values: unknown[]) => ({
  kind: 'inArray',
  field,
  values,
}));

jest.unstable_mockModule('@team9/database', () => ({
  DATABASE_CONNECTION: Symbol('DATABASE_CONNECTION'),
  eq: mockEq,
  and: mockAnd,
  inArray: mockInArray,
  desc: jest.fn(),
  lt: jest.fn(),
  sql: jest.fn(),
}));

jest.unstable_mockModule('@team9/database/schemas', () => ({
  notifications: {
    id: 'notifications.id',
    userId: 'notifications.userId',
    isRead: 'notifications.isRead',
    isArchived: 'notifications.isArchived',
    readAt: 'notifications.readAt',
    archivedAt: 'notifications.archivedAt',
    category: 'notifications.category',
    type: 'notifications.type',
    title: 'notifications.title',
    body: 'notifications.body',
    actorId: 'notifications.actorId',
    tenantId: 'notifications.tenantId',
    channelId: 'notifications.channelId',
    messageId: 'notifications.messageId',
    referenceType: 'notifications.referenceType',
    referenceId: 'notifications.referenceId',
    metadata: 'notifications.metadata',
    actionUrl: 'notifications.actionUrl',
    priority: 'notifications.priority',
    expiresAt: 'notifications.expiresAt',
    createdAt: 'notifications.createdAt',
  },
  users: {
    id: 'users.id',
    username: 'users.username',
    displayName: 'users.displayName',
    avatarUrl: 'users.avatarUrl',
  },
}));

const { NotificationService } = await import('./notification.service.js');
const schema = await import('@team9/database/schemas');

function createDbMock() {
  const selectChain = {
    from: jest.fn<any>().mockReturnThis(),
    where: jest.fn<any>().mockResolvedValue([{ id: 'notif-1' }]),
    groupBy: jest.fn<any>().mockResolvedValue([]),
  };
  const insertChain = {
    values: jest.fn<any>().mockReturnThis(),
    returning: jest.fn<any>().mockResolvedValue([{ id: 'created-notif' }]),
  };
  const deleteChain = {
    where: jest.fn<any>().mockReturnThis(),
    returning: jest.fn<any>().mockResolvedValue([{ id: 'notif-1' }]),
  };
  const chain = {
    select: jest.fn<any>().mockReturnValue(selectChain),
    insert: jest.fn<any>().mockReturnValue(insertChain),
    update: jest.fn<any>().mockReturnThis(),
    set: jest.fn<any>().mockReturnThis(),
    where: jest.fn<any>().mockResolvedValue(undefined),
    delete: jest.fn<any>().mockReturnValue(deleteChain),
  };

  return { ...chain, selectChain, insertChain, deleteChain };
}

describe('NotificationService.markAllAsRead', () => {
  let service: NotificationService;
  let db: ReturnType<typeof createDbMock>;

  beforeEach(() => {
    jest.clearAllMocks();
    db = createDbMock();
    service = new NotificationService(db as any);
  });

  it('includes type filtering when types are provided', async () => {
    const types = ['mention', 'reply'] as any[];

    await service.markAllAsRead('user-1', 'message', types);

    expect(mockInArray).toHaveBeenCalledWith(schema.notifications.type, types);
    expect(mockAnd).toHaveBeenCalledWith(
      { kind: 'eq', field: schema.notifications.userId, value: 'user-1' },
      { kind: 'eq', field: schema.notifications.isRead, value: false },
      { kind: 'eq', field: schema.notifications.category, value: 'message' },
      {
        kind: 'inArray',
        field: schema.notifications.type,
        values: types,
      },
    );
    expect(db.update).toHaveBeenCalledWith(schema.notifications);
    expect(db.set).toHaveBeenCalledWith(
      expect.objectContaining({
        isRead: true,
        readAt: expect.any(Date),
      }),
    );
  });

  it('applies type filtering without category when category is omitted', async () => {
    const types = ['mention'] as any[];

    await service.markAllAsRead('user-1', undefined, types);

    expect(mockInArray).toHaveBeenCalledWith(schema.notifications.type, types);
    expect(mockAnd).toHaveBeenCalledWith(
      { kind: 'eq', field: schema.notifications.userId, value: 'user-1' },
      { kind: 'eq', field: schema.notifications.isRead, value: false },
      {
        kind: 'inArray',
        field: schema.notifications.type,
        values: types,
      },
    );
  });

  it('does not add a type filter when types are omitted', async () => {
    await service.markAllAsRead('user-1', 'message');

    expect(mockInArray).not.toHaveBeenCalled();
    expect(mockAnd).toHaveBeenCalledWith(
      { kind: 'eq', field: schema.notifications.userId, value: 'user-1' },
      { kind: 'eq', field: schema.notifications.isRead, value: false },
      { kind: 'eq', field: schema.notifications.category, value: 'message' },
    );
  });

  it('returns unread notification IDs using the same optional filters', async () => {
    const ids = await service.getUnreadNotificationIds('user-1', 'message', [
      'mention',
    ] as any[]);

    expect(ids).toEqual(['notif-1']);
    expect(db.select).toHaveBeenCalledWith({ id: schema.notifications.id });
    expect(db.selectChain.from).toHaveBeenCalledWith(schema.notifications);
    expect(mockInArray).toHaveBeenCalledWith(schema.notifications.type, [
      'mention',
    ]);
    expect(mockAnd).toHaveBeenCalledWith(
      { kind: 'eq', field: schema.notifications.userId, value: 'user-1' },
      { kind: 'eq', field: schema.notifications.isRead, value: false },
      { kind: 'eq', field: schema.notifications.category, value: 'message' },
      {
        kind: 'inArray',
        field: schema.notifications.type,
        values: ['mention'],
      },
    );
  });

  it('creates a notification with a generated id and default priority', async () => {
    const notification = await service.create({
      userId: 'user-1',
      category: 'message' as any,
      type: 'mention' as any,
      title: 'Hello',
      messageId: 'msg-1',
    });

    expect(db.insert).toHaveBeenCalledWith(schema.notifications);
    expect(db.insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.any(String),
        userId: 'user-1',
        category: 'message',
        type: 'mention',
        title: 'Hello',
        messageId: 'msg-1',
        priority: 'normal',
      }),
    );
    expect(notification).toEqual({ id: 'created-notif' });
  });

  it('aggregates unread counts by category and type', async () => {
    const categoryChain = {
      from: jest.fn<any>().mockReturnThis(),
      where: jest.fn<any>().mockReturnThis(),
      groupBy: jest.fn<any>().mockResolvedValue([
        { category: 'message', count: '2' },
        { category: 'workspace', count: 1 },
      ]),
    };
    const typeChain = {
      from: jest.fn<any>().mockReturnThis(),
      where: jest.fn<any>().mockReturnThis(),
      groupBy: jest.fn<any>().mockResolvedValue([
        { type: 'mention', count: '2' },
        { type: 'workspace_invitation', count: 1 },
      ]),
    };
    db.select.mockReturnValueOnce(categoryChain).mockReturnValueOnce(typeChain);

    const counts = await service.getUnreadCounts('user-1');

    expect(counts.total).toBe(3);
    expect(counts.byCategory.message).toBe(2);
    expect(counts.byCategory.workspace).toBe(1);
    expect(counts.byType.mention).toBe(2);
    expect(counts.byType.workspace_invitation).toBe(1);
    expect(categoryChain.groupBy).toHaveBeenCalledWith(
      schema.notifications.category,
    );
    expect(typeChain.groupBy).toHaveBeenCalledWith(schema.notifications.type);
  });

  it('archives selected notifications for a user', async () => {
    await service.archive('user-1', ['notif-1', 'notif-2']);

    expect(db.update).toHaveBeenCalledWith(schema.notifications);
    expect(db.set).toHaveBeenCalledWith(
      expect.objectContaining({
        isArchived: true,
        archivedAt: expect.any(Date),
      }),
    );
    expect(mockAnd).toHaveBeenCalledWith(
      { kind: 'eq', field: schema.notifications.userId, value: 'user-1' },
      {
        kind: 'inArray',
        field: schema.notifications.id,
        values: ['notif-1', 'notif-2'],
      },
    );
  });

  it('cleans up expired notifications and returns the deleted count', async () => {
    const count = await service.cleanupExpired();

    expect(db.delete).toHaveBeenCalledWith(schema.notifications);
    expect(db.deleteChain.returning).toHaveBeenCalledWith({
      id: schema.notifications.id,
    });
    expect(count).toBe(1);
  });
});
