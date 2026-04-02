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
const mockLt = jest.fn((field: unknown, value: unknown) => ({
  kind: 'lt',
  field,
  value,
}));

jest.unstable_mockModule('@team9/database', () => ({
  DATABASE_CONNECTION: Symbol('DATABASE_CONNECTION'),
  eq: mockEq,
  and: mockAnd,
  lt: mockLt,
}));

jest.unstable_mockModule('@team9/database/schemas', () => ({
  notifications: {
    id: 'notifications.id',
    userId: 'notifications.userId',
    messageId: 'notifications.messageId',
    type: 'notifications.type',
    category: 'notifications.category',
    title: 'notifications.title',
    body: 'notifications.body',
    actorId: 'notifications.actorId',
    tenantId: 'notifications.tenantId',
    channelId: 'notifications.channelId',
    referenceType: 'notifications.referenceType',
    referenceId: 'notifications.referenceId',
    metadata: 'notifications.metadata',
    actionUrl: 'notifications.actionUrl',
    priority: 'notifications.priority',
    expiresAt: 'notifications.expiresAt',
  },
  users: {
    id: 'users.id',
    username: 'users.username',
    displayName: 'users.displayName',
    avatarUrl: 'users.avatarUrl',
  },
}));

jest.unstable_mockModule('@team9/shared', () => ({
  NOTIFICATION_TYPE_PRIORITY: {
    mention: 100,
    dm_received: 100,
    channel_mention: 90,
    everyone_mention: 80,
    here_mention: 70,
    reply: 60,
    thread_reply: 50,
  },
}));

const { NotificationService } = await import('./notification.service.js');
const schema = await import('@team9/database/schemas');

function createDbMock() {
  const selectChain = {
    from: jest.fn<any>().mockReturnThis(),
    where: jest.fn<any>().mockReturnThis(),
    limit: jest.fn<any>().mockResolvedValue([]),
  };
  const insertChain = {
    values: jest.fn<any>().mockReturnThis(),
    returning: jest.fn<any>().mockResolvedValue([{ id: 'notif-created' }]),
  };
  const deleteChain = {
    where: jest.fn<any>().mockReturnThis(),
    returning: jest.fn<any>().mockResolvedValue([{ id: 'expired-1' }]),
  };

  return {
    select: jest.fn<any>().mockReturnValue(selectChain),
    insert: jest.fn<any>().mockReturnValue(insertChain),
    delete: jest.fn<any>().mockReturnValue(deleteChain),
    selectChain,
    insertChain,
    deleteChain,
  };
}

describe('im-worker NotificationService', () => {
  let service: NotificationService;
  let db: ReturnType<typeof createDbMock>;

  beforeEach(() => {
    jest.clearAllMocks();
    db = createDbMock();
    service = new NotificationService(db as any);
  });

  it('returns false when no existing notification matches the user and message', async () => {
    db.selectChain.limit.mockResolvedValue([]);

    await expect(
      service.hasHigherPriorityNotification('user-1', 'msg-1', 'reply' as any),
    ).resolves.toBe(false);

    expect(mockAnd).toHaveBeenCalledWith(
      { kind: 'eq', field: schema.notifications.userId, value: 'user-1' },
      { kind: 'eq', field: schema.notifications.messageId, value: 'msg-1' },
    );
  });

  it('returns true when an equal or higher priority notification already exists', async () => {
    db.selectChain.limit.mockResolvedValue([{ type: 'mention' }]);

    await expect(
      service.hasHigherPriorityNotification('user-1', 'msg-1', 'reply' as any),
    ).resolves.toBe(true);
  });

  it('returns false when the existing notification has lower priority', async () => {
    db.selectChain.limit.mockResolvedValue([{ type: 'thread_reply' }]);

    await expect(
      service.hasHigherPriorityNotification(
        'user-1',
        'msg-1',
        'mention' as any,
      ),
    ).resolves.toBe(false);
  });

  it('skips insert when a higher priority notification already exists', async () => {
    db.selectChain.limit.mockResolvedValue([{ type: 'mention' }]);

    const result = await service.create({
      userId: 'user-1',
      category: 'message' as any,
      type: 'reply' as any,
      title: 'Reply received',
      messageId: 'msg-1',
    });

    expect(result).toBeNull();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('creates a notification with default priority when no higher priority exists', async () => {
    db.selectChain.limit.mockResolvedValue([]);

    const result = await service.create({
      userId: 'user-1',
      category: 'message' as any,
      type: 'mention' as any,
      title: 'Mention received',
      messageId: 'msg-1',
    });

    expect(db.insert).toHaveBeenCalledWith(schema.notifications);
    expect(db.insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.any(String),
        userId: 'user-1',
        type: 'mention',
        priority: 'normal',
        messageId: 'msg-1',
      }),
    );
    expect(result).toEqual({ id: 'notif-created' });
  });

  it('returns an empty array for an empty batch', async () => {
    await expect(
      service.createBatch([], {
        category: 'message' as any,
        type: 'mention' as any,
        title: 'Nothing',
      }),
    ).resolves.toEqual([]);

    expect(db.insert).not.toHaveBeenCalled();
  });

  it('creates batched notifications for multiple users', async () => {
    db.insertChain.returning.mockResolvedValue([
      { id: 'notif-1' },
      { id: 'notif-2' },
    ]);

    const result = await service.createBatch(['user-1', 'user-2'], {
      category: 'message' as any,
      type: 'mention' as any,
      title: 'Batch',
      priority: 'high' as any,
    });

    expect(db.insertChain.values).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: 'user-1',
        priority: 'high',
      }),
      expect.objectContaining({
        userId: 'user-2',
        priority: 'high',
      }),
    ]);
    expect(result).toEqual([{ id: 'notif-1' }, { id: 'notif-2' }]);
  });

  it('returns actor info when the actor exists', async () => {
    db.selectChain.limit.mockResolvedValue([
      {
        id: 'user-2',
        username: 'alice',
        displayName: 'Alice',
        avatarUrl: null,
      },
    ]);

    await expect(service.getActorInfo('user-2')).resolves.toEqual({
      id: 'user-2',
      username: 'alice',
      displayName: 'Alice',
      avatarUrl: null,
    });
  });

  it('returns null when actor info is missing', async () => {
    db.selectChain.limit.mockResolvedValue([]);

    await expect(service.getActorInfo('user-3')).resolves.toBeNull();
  });

  it('cleans up expired notifications and returns the deleted count', async () => {
    const result = await service.cleanupExpired();

    expect(db.delete).toHaveBeenCalledWith(schema.notifications);
    expect(mockLt).toHaveBeenCalledWith(
      schema.notifications.expiresAt,
      expect.any(Date),
    );
    expect(result).toBe(1);
  });

  it('deletes notifications by message id', async () => {
    await service.deleteByMessageId('msg-2');

    expect(db.delete).toHaveBeenCalledWith(schema.notifications);
    expect(db.deleteChain.where).toHaveBeenCalledWith({
      kind: 'eq',
      field: schema.notifications.messageId,
      value: 'msg-2',
    });
  });
});
