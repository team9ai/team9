import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('@team9/auth', () => ({
  AuthGuard: class AuthGuard {},
  CurrentUser: () => () => undefined,
}));

jest.unstable_mockModule('../../im/websocket/websocket.gateway.js', () => ({
  WebsocketGateway: class WebsocketGateway {},
}));

const { BotChannelsController } = await import('./bot-channels.controller.js');

type MockFn = jest.Mock<(...args: any[]) => any>;

const TENANT_ID = 'tenant-uuid-1';
const BOT_USER_ID = 'bot-uuid-1';
const CHANNEL_ID = 'channel-uuid-1';
const MEMBER_A = 'member-uuid-a';
const MEMBER_B = 'member-uuid-b';
const NOW = new Date('2026-04-17T10:00:00Z');

const makeChannel = (overrides: Record<string, unknown> = {}) => ({
  id: CHANNEL_ID,
  tenantId: TENANT_ID,
  name: 'Test Channel',
  description: null,
  type: 'private',
  avatarUrl: null,
  createdBy: BOT_USER_ID,
  sectionId: null,
  order: 0,
  isArchived: false,
  isActivated: true,
  snapshot: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

const makeMembers = (userIds: string[]) =>
  userIds.map((userId) => ({
    id: `member-row-${userId}`,
    userId,
    role: 'member' as const,
    isMuted: false,
    notificationsEnabled: true,
    joinedAt: NOW,
    user: {
      id: userId,
      username: `user_${userId}`,
      displayName: null,
      avatarUrl: null,
      status: 'offline' as const,
      userType: 'human' as const,
      agentType: null,
      staffKind: null,
      roleTitle: null,
      ownerName: null,
      createdAt: NOW,
    },
  }));

describe('BotChannelsController', () => {
  let controller: InstanceType<typeof BotChannelsController>;
  let channelsService: Record<string, MockFn>;
  let websocketGateway: Record<string, MockFn>;
  let eventEmitter: { emit: MockFn };

  beforeEach(() => {
    channelsService = {
      createChannelForBot: jest.fn<any>().mockResolvedValue(makeChannel()),
      getChannelMembers: jest
        .fn<any>()
        .mockResolvedValue(makeMembers([MEMBER_A, MEMBER_B])),
    };

    websocketGateway = {
      broadcastToWorkspace: jest.fn<any>().mockResolvedValue(undefined),
      sendToUser: jest.fn<any>().mockResolvedValue(undefined),
    };

    eventEmitter = {
      emit: jest.fn<any>(),
    };

    controller = new BotChannelsController(
      channelsService as never,
      websocketGateway as never,
      eventEmitter as never,
    );
  });

  // ── Happy path: public channel ──────────────────────────────────────────────

  describe('createChannel – public channel', () => {
    const publicDto = { name: 'Announcements', type: 'public' as const };

    it('calls createChannelForBot with correct args', async () => {
      const publicChannel = makeChannel({ type: 'public' });
      channelsService.createChannelForBot.mockResolvedValueOnce(publicChannel);

      await controller.createChannel(BOT_USER_ID, TENANT_ID, publicDto);

      expect(channelsService.createChannelForBot).toHaveBeenCalledWith(
        BOT_USER_ID,
        TENANT_ID,
        publicDto,
      );
    });

    it('broadcasts to workspace for a public channel', async () => {
      const publicChannel = makeChannel({ type: 'public' });
      channelsService.createChannelForBot.mockResolvedValueOnce(publicChannel);

      await controller.createChannel(BOT_USER_ID, TENANT_ID, publicDto);

      expect(websocketGateway.broadcastToWorkspace).toHaveBeenCalledWith(
        TENANT_ID,
        'channel_created',
        publicChannel,
      );
      expect(websocketGateway.sendToUser).not.toHaveBeenCalled();
    });

    it('emits channel.created event after broadcast', async () => {
      const publicChannel = makeChannel({ type: 'public' });
      channelsService.createChannelForBot.mockResolvedValueOnce(publicChannel);

      await controller.createChannel(BOT_USER_ID, TENANT_ID, publicDto);

      expect(eventEmitter.emit).toHaveBeenCalledWith('channel.created', {
        channel: publicChannel,
      });
    });

    it('returns the channel returned by the service', async () => {
      const publicChannel = makeChannel({
        type: 'public',
        name: 'Announcements',
      });
      channelsService.createChannelForBot.mockResolvedValueOnce(publicChannel);

      const result = await controller.createChannel(
        BOT_USER_ID,
        TENANT_ID,
        publicDto,
      );

      expect(result).toEqual(publicChannel);
    });
  });

  // ── Happy path: private channel ─────────────────────────────────────────────

  describe('createChannel – private channel', () => {
    const privateDto = {
      name: 'Secret Room',
      type: 'private' as const,
      memberUserIds: [MEMBER_A, MEMBER_B],
    };

    it('calls createChannelForBot with correct args', async () => {
      await controller.createChannel(BOT_USER_ID, TENANT_ID, privateDto);

      expect(channelsService.createChannelForBot).toHaveBeenCalledWith(
        BOT_USER_ID,
        TENANT_ID,
        privateDto,
      );
    });

    it('fans out sendToUser to each materialized member for a private channel', async () => {
      const privateChannel = makeChannel({ type: 'private' });
      channelsService.createChannelForBot.mockResolvedValueOnce(privateChannel);
      channelsService.getChannelMembers.mockResolvedValueOnce(
        makeMembers([MEMBER_A, MEMBER_B]),
      );

      await controller.createChannel(BOT_USER_ID, TENANT_ID, privateDto);

      expect(channelsService.getChannelMembers).toHaveBeenCalledWith(
        CHANNEL_ID,
      );
      expect(websocketGateway.sendToUser).toHaveBeenCalledTimes(2);
      expect(websocketGateway.sendToUser).toHaveBeenCalledWith(
        MEMBER_A,
        'channel_created',
        privateChannel,
      );
      expect(websocketGateway.sendToUser).toHaveBeenCalledWith(
        MEMBER_B,
        'channel_created',
        privateChannel,
      );
      expect(websocketGateway.broadcastToWorkspace).not.toHaveBeenCalled();
    });

    it('emits channel.created event after per-member fanout', async () => {
      const privateChannel = makeChannel({ type: 'private' });
      channelsService.createChannelForBot.mockResolvedValueOnce(privateChannel);

      await controller.createChannel(BOT_USER_ID, TENANT_ID, privateDto);

      expect(eventEmitter.emit).toHaveBeenCalledWith('channel.created', {
        channel: privateChannel,
      });
    });

    it('returns the channel returned by the service', async () => {
      const privateChannel = makeChannel({
        type: 'private',
        name: 'Secret Room',
      });
      channelsService.createChannelForBot.mockResolvedValueOnce(privateChannel);

      const result = await controller.createChannel(
        BOT_USER_ID,
        TENANT_ID,
        privateDto,
      );

      expect(result).toEqual(privateChannel);
    });

    it('handles a channel with no members (empty fanout)', async () => {
      channelsService.getChannelMembers.mockResolvedValueOnce([]);

      await controller.createChannel(BOT_USER_ID, TENANT_ID, privateDto);

      expect(websocketGateway.sendToUser).not.toHaveBeenCalled();
      // event is still emitted
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'channel.created',
        expect.any(Object),
      );
    });
  });

  // ── Defensive: missing tenantId ─────────────────────────────────────────────

  describe('createChannel – defensive tenantId check', () => {
    it('throws BadRequestException when tenantId is absent', async () => {
      const dto = { name: 'Broken', type: 'public' as const };

      await expect(
        controller.createChannel(
          BOT_USER_ID,
          undefined as unknown as string,
          dto,
        ),
      ).rejects.toThrow(BadRequestException);

      // Service should NOT be called
      expect(channelsService.createChannelForBot).not.toHaveBeenCalled();
    });
  });
});
