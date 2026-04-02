import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NotificationTriggerService } from './notification-trigger.service.js';

type MockFn = jest.Mock<(...args: any[]) => any>;

function mockDb(memberRows: Array<{ userId: string }> = []) {
  const chain: Record<string, MockFn> = {};
  for (const method of ['select', 'from', 'where']) {
    chain[method] = jest.fn<any>().mockReturnValue(chain);
  }
  chain.where.mockResolvedValue(memberRows);
  return chain;
}

function buildNotification(overrides: Record<string, any> = {}) {
  return {
    id: 'notification-1',
    userId: 'user-1',
    category: 'message',
    type: 'mention',
    title: 'title',
    body: 'body',
    actorId: 'actor-1',
    tenantId: 'tenant-1',
    channelId: 'channel-1',
    messageId: 'message-1',
    referenceType: undefined,
    referenceId: undefined,
    metadata: undefined,
    actionUrl: '/channels/channel-1?message=message-1',
    priority: 'normal',
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('NotificationTriggerService', () => {
  let service: NotificationTriggerService;
  let db: ReturnType<typeof mockDb>;
  let notificationService: {
    create: MockFn;
    createBatch: MockFn;
    getActorInfo: MockFn;
  };
  let rabbitMQEventService: {
    publishDeliveryTask: MockFn;
  };

  beforeEach(() => {
    db = mockDb();
    notificationService = {
      create: jest.fn<any>().mockResolvedValue(buildNotification()),
      createBatch: jest.fn<any>().mockResolvedValue([]),
      getActorInfo: jest.fn<any>().mockResolvedValue(null),
    };
    rabbitMQEventService = {
      publishDeliveryTask: jest.fn<any>().mockResolvedValue(undefined),
    };

    service = new NotificationTriggerService(
      db as never,
      notificationService as never,
      rabbitMQEventService as never,
    );
  });

  describe('mention notifications', () => {
    it('aggregates by user, prefers direct mentions over broadcast mentions, and skips the sender', async () => {
      db.where.mockResolvedValue([
        { userId: 'user-target' },
        { userId: 'user-sender' },
        { userId: 'user-bystander' },
      ]);

      notificationService.create
        .mockResolvedValueOnce(
          buildNotification({
            userId: 'user-target',
            type: 'mention',
            title: 'alice mentioned you in #general',
            priority: 'high',
            actorId: 'user-sender',
          }),
        )
        .mockResolvedValueOnce(
          buildNotification({
            userId: 'user-bystander',
            type: 'everyone_mention',
            title: 'alice mentioned @everyone in #general',
            priority: 'high',
            actorId: 'user-sender',
          }),
        );

      await service.triggerMentionNotifications({
        messageId: 'message-1',
        channelId: 'channel-1',
        tenantId: 'tenant-1',
        senderId: 'user-sender',
        senderUsername: 'alice',
        channelName: 'general',
        content: 'hello',
        mentions: [
          { type: 'user', userId: 'user-target' },
          { type: 'user', userId: 'user-sender' },
          { type: 'everyone' },
        ],
      });

      expect(notificationService.create).toHaveBeenCalledTimes(2);
      expect(notificationService.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          userId: 'user-target',
          type: 'mention',
          title: 'alice mentioned you in #general',
          body: 'hello',
          actorId: 'user-sender',
          tenantId: 'tenant-1',
          channelId: 'channel-1',
          messageId: 'message-1',
          actionUrl: '/channels/channel-1?message=message-1',
          priority: 'high',
        }),
      );
      expect(notificationService.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          userId: 'user-bystander',
          type: 'everyone_mention',
          title: 'alice mentioned @everyone in #general',
        }),
      );
      expect(notificationService.create).not.toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-sender',
        }),
      );
      expect(rabbitMQEventService.publishDeliveryTask).toHaveBeenCalledTimes(2);
    });
  });

  describe('reply notifications', () => {
    it('dedupes parent and thread reply notifications for the same user', async () => {
      notificationService.create.mockResolvedValueOnce(
        buildNotification({
          userId: 'user-parent',
          type: 'thread_reply',
          title: 'alice replied in a thread in #general',
          priority: 'normal',
          actorId: 'user-sender',
        }),
      );

      const notifiedUserIds = await service.triggerReplyNotification({
        messageId: 'message-2',
        channelId: 'channel-1',
        tenantId: 'tenant-1',
        senderId: 'user-sender',
        senderUsername: 'alice',
        channelName: 'general',
        parentMessageId: 'parent-message',
        parentSenderId: 'user-parent',
        rootMessageId: 'root-message',
        rootSenderId: 'user-parent',
        content: 'reply body',
        isThreadReply: true,
      });

      expect(notificationService.create).toHaveBeenCalledTimes(1);
      expect(notificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-parent',
          type: 'thread_reply',
          title: 'alice replied in a thread in #general',
          body: 'reply body',
          actorId: 'user-sender',
          tenantId: 'tenant-1',
          channelId: 'channel-1',
          messageId: 'message-2',
          actionUrl:
            '/channels/channel-1?thread=root-message&message=message-2',
          priority: 'normal',
        }),
      );
      expect(notifiedUserIds).toEqual(['user-parent']);
      expect(rabbitMQEventService.publishDeliveryTask).toHaveBeenCalledTimes(1);
    });
  });

  describe('DM notifications', () => {
    it('skips self messages without creating or publishing notifications', async () => {
      await service.triggerDMNotification({
        messageId: 'message-3',
        channelId: 'channel-dm',
        senderId: 'user-self',
        senderUsername: 'alice',
        recipientId: 'user-self',
        content: 'hello',
      });

      expect(notificationService.create).not.toHaveBeenCalled();
      expect(rabbitMQEventService.publishDeliveryTask).not.toHaveBeenCalled();
    });

    it('publishes a DM notification with actor info when delivery is created', async () => {
      notificationService.create.mockResolvedValueOnce(
        buildNotification({
          category: 'message',
          type: 'dm_received',
          title: 'alice sent you a message',
          body: 'hello there',
          actorId: 'user-sender',
          userId: 'user-recipient',
          channelId: 'channel-dm',
          messageId: 'message-4',
          priority: 'high',
        }),
      );
      notificationService.getActorInfo.mockResolvedValueOnce({
        id: 'user-sender',
        username: 'alice',
        displayName: 'Alice',
        avatarUrl: 'https://cdn.example.com/a.png',
      });

      await service.triggerDMNotification({
        messageId: 'message-4',
        channelId: 'channel-dm',
        senderId: 'user-sender',
        senderUsername: 'alice',
        recipientId: 'user-recipient',
        content: 'hello there',
      });

      expect(notificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-recipient',
          category: 'message',
          type: 'dm_received',
          title: 'alice sent you a message',
          body: 'hello there',
          actorId: 'user-sender',
          channelId: 'channel-dm',
          messageId: 'message-4',
          actionUrl: '/channels/channel-dm?message=message-4',
          priority: 'high',
        }),
      );
      expect(notificationService.getActorInfo).toHaveBeenCalledWith(
        'user-sender',
      );
      expect(rabbitMQEventService.publishDeliveryTask).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'new',
          userId: 'user-recipient',
          payload: expect.objectContaining({
            actor: {
              id: 'user-sender',
              username: 'alice',
              displayName: 'Alice',
              avatarUrl: 'https://cdn.example.com/a.png',
            },
            channelId: 'channel-dm',
            messageId: 'message-4',
            title: 'alice sent you a message',
          }),
        }),
      );
    });

    it('skips publishing when notificationService.create returns null', async () => {
      notificationService.create.mockResolvedValueOnce(null);

      await service.triggerDMNotification({
        messageId: 'message-5',
        channelId: 'channel-dm',
        senderId: 'user-sender',
        senderUsername: 'alice',
        recipientId: 'user-recipient',
        content: 'hello there',
      });

      expect(notificationService.create).toHaveBeenCalledTimes(1);
      expect(rabbitMQEventService.publishDeliveryTask).not.toHaveBeenCalled();
    });
  });

  describe('workspace notifications', () => {
    it('publishes workspace invitations with actor info and reference metadata', async () => {
      notificationService.create.mockResolvedValueOnce(
        buildNotification({
          category: 'workspace',
          type: 'workspace_invitation',
          title: 'alice invited you to Team 9',
          body: 'Click to accept the invitation and join the workspace.',
          actorId: 'user-inviter',
          userId: 'user-invitee',
          tenantId: 'tenant-1',
          referenceType: 'workspace_invitation',
          referenceId: 'inv-1',
          actionUrl: '/invite/inv-1',
          priority: 'high',
        }),
      );
      notificationService.getActorInfo.mockResolvedValueOnce({
        id: 'user-inviter',
        username: 'alice',
        displayName: 'Alice',
        avatarUrl: null,
      });

      await service.triggerWorkspaceInvitation({
        invitationId: 'inv-1',
        tenantId: 'tenant-1',
        tenantName: 'Team 9',
        inviterId: 'user-inviter',
        inviterUsername: 'alice',
        inviteeId: 'user-invitee',
      });

      expect(notificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-invitee',
          category: 'workspace',
          type: 'workspace_invitation',
          title: 'alice invited you to Team 9',
          body: 'Click to accept the invitation and join the workspace.',
          actorId: 'user-inviter',
          tenantId: 'tenant-1',
          referenceType: 'workspace_invitation',
          referenceId: 'inv-1',
          actionUrl: '/invite/inv-1',
          priority: 'high',
        }),
      );
      expect(rabbitMQEventService.publishDeliveryTask).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-invitee',
          payload: expect.objectContaining({
            actor: {
              id: 'user-inviter',
              username: 'alice',
              displayName: 'Alice',
              avatarUrl: null,
            },
            actionUrl: '/invite/inv-1',
            title: 'alice invited you to Team 9',
            body: 'Click to accept the invitation and join the workspace.',
          }),
        }),
      );
    });

    it('skips the new member when notifying workspace joins', async () => {
      notificationService.create
        .mockResolvedValueOnce(
          buildNotification({
            category: 'workspace',
            type: 'member_joined',
            userId: 'user-1',
            actorId: 'user-new',
          }),
        )
        .mockResolvedValueOnce(
          buildNotification({
            category: 'workspace',
            type: 'member_joined',
            userId: 'user-2',
            actorId: 'user-new',
          }),
        );

      await service.triggerMemberJoined({
        tenantId: 'tenant-1',
        tenantName: 'Team 9',
        newMemberId: 'user-new',
        newMemberUsername: 'new-user',
        notifyUserIds: ['user-1', 'user-new', 'user-2'],
      });

      expect(notificationService.create).toHaveBeenCalledTimes(2);
      expect(notificationService.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          userId: 'user-1',
          category: 'workspace',
          type: 'member_joined',
          title: 'new-user joined Team 9',
          actorId: 'user-new',
          tenantId: 'tenant-1',
          actionUrl: '/',
          priority: 'low',
        }),
      );
      expect(notificationService.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          userId: 'user-2',
        }),
      );
    });

    it('publishes role change notifications with metadata', async () => {
      notificationService.create.mockResolvedValueOnce(
        buildNotification({
          category: 'workspace',
          type: 'role_changed',
          userId: 'user-target',
          title: 'Your role in Team 9 was changed',
          body: 'alice changed your role from member to admin.',
          actorId: 'user-admin',
          tenantId: 'tenant-1',
          metadata: { oldRole: 'member', newRole: 'admin' },
          actionUrl: '/',
          priority: 'normal',
        }),
      );
      notificationService.getActorInfo.mockResolvedValueOnce({
        id: 'user-admin',
        username: 'alice',
        displayName: 'Alice',
        avatarUrl: null,
      });

      await service.triggerRoleChanged({
        tenantId: 'tenant-1',
        tenantName: 'Team 9',
        userId: 'user-target',
        oldRole: 'member',
        newRole: 'admin',
        changedById: 'user-admin',
        changedByUsername: 'alice',
      });

      expect(notificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-target',
          category: 'workspace',
          type: 'role_changed',
          title: 'Your role in Team 9 was changed',
          body: 'alice changed your role from member to admin.',
          actorId: 'user-admin',
          tenantId: 'tenant-1',
          metadata: { oldRole: 'member', newRole: 'admin' },
          actionUrl: '/',
          priority: 'normal',
        }),
      );
      expect(rabbitMQEventService.publishDeliveryTask).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-target',
          payload: expect.objectContaining({
            type: 'role_changed',
            title: 'Your role in Team 9 was changed',
            body: 'alice changed your role from member to admin.',
            actor: {
              id: 'user-admin',
              username: 'alice',
              displayName: 'Alice',
              avatarUrl: null,
            },
          }),
        }),
      );
    });

    it('publishes all system announcement deliveries returned by createBatch', async () => {
      notificationService.createBatch.mockResolvedValueOnce([
        buildNotification({
          id: 'notification-1',
          userId: 'user-1',
          category: 'system',
          type: 'system_announcement',
          title: 'Announcement',
          body: 'Body',
          priority: 'normal',
          actorId: undefined,
        }),
        buildNotification({
          id: 'notification-2',
          userId: 'user-2',
          category: 'system',
          type: 'system_announcement',
          title: 'Announcement',
          body: 'Body',
          priority: 'normal',
          actorId: undefined,
        }),
      ]);

      await service.triggerSystemAnnouncement(
        ['user-1', 'user-2'],
        'Announcement',
        'Body',
        { kind: 'broadcast' },
      );

      expect(notificationService.createBatch).toHaveBeenCalledWith(
        ['user-1', 'user-2'],
        expect.objectContaining({
          category: 'system',
          type: 'system_announcement',
          title: 'Announcement',
          body: 'Body',
          metadata: { kind: 'broadcast' },
          priority: 'normal',
        }),
      );
      expect(rabbitMQEventService.publishDeliveryTask).toHaveBeenCalledTimes(2);
      expect(rabbitMQEventService.publishDeliveryTask).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          userId: 'user-1',
          payload: expect.objectContaining({
            id: 'notification-1',
            title: 'Announcement',
            body: 'Body',
            actor: null,
          }),
        }),
      );
      expect(rabbitMQEventService.publishDeliveryTask).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          userId: 'user-2',
          payload: expect.objectContaining({
            id: 'notification-2',
            title: 'Announcement',
            body: 'Body',
            actor: null,
          }),
        }),
      );
    });
  });
});
