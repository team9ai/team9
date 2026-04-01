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
    category: 'notifications.category',
    type: 'notifications.type',
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
  };
  const chain = {
    select: jest.fn<any>().mockReturnValue(selectChain),
    update: jest.fn<any>().mockReturnThis(),
    set: jest.fn<any>().mockReturnThis(),
    where: jest.fn<any>().mockResolvedValue(undefined),
  };

  return { ...chain, selectChain };
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
});
