import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';

jest.unstable_mockModule('@team9/auth', () => ({
  AuthGuard: class AuthGuard {},
  CurrentUser: () => () => undefined,
}));

jest.unstable_mockModule(
  '../../common/decorators/current-tenant.decorator.js',
  () => ({
    CurrentTenantId: () => () => undefined,
  }),
);

jest.unstable_mockModule('../websocket/websocket.gateway.js', () => ({
  WebsocketGateway: class WebsocketGateway {},
}));

const { ChannelsController } = await import('./channels.controller.js');

type MockFn = jest.Mock<(...args: any[]) => any>;

const TENANT_ID = 'tenant-1';
const USER_ID = 'user-1';
const TARGET_USER_ID = 'user-2';
const CHANNEL_ID = 'channel-1';
const MEMBER_ID = 'member-1';
const BOT_ID = 'bot-1';
const NOW = new Date('2026-04-01T12:00:00Z');

const makeChannel = (overrides: Record<string, unknown> = {}) => ({
  id: CHANNEL_ID,
  tenantId: TENANT_ID,
  name: 'General',
  description: 'General discussion',
  type: 'public',
  avatarUrl: null,
  createdBy: USER_ID,
  sectionId: null,
  order: 0,
  isArchived: false,
  isActivated: true,
  snapshot: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

describe('ChannelsController', () => {
  let controller: ChannelsController;
  let channelsService: Record<string, MockFn>;
  let websocketGateway: Record<string, MockFn>;
  let eventEmitter: { emit: MockFn };

  beforeEach(() => {
    channelsService = {
      getUserChannels: jest.fn<any>().mockResolvedValue([{ id: CHANNEL_ID }]),
      getPublicChannels: jest.fn<any>().mockResolvedValue([{ id: CHANNEL_ID }]),
      create: jest.fn<any>().mockResolvedValue(makeChannel()),
      createDirectChannel: jest
        .fn<any>()
        .mockResolvedValue(makeChannel({ type: 'direct' })),
      assertReadAccess: jest.fn<any>().mockResolvedValue(undefined),
      findByIdOrThrow: jest.fn<any>().mockResolvedValue(makeChannel()),
      getPublicChannelPreview: jest
        .fn<any>()
        .mockResolvedValue(makeChannel({ type: 'public' })),
      joinPublicChannel: jest.fn<any>().mockResolvedValue(undefined),
      update: jest.fn<any>().mockResolvedValue(
        makeChannel({
          name: 'Renamed',
          updatedAt: new Date('2026-04-01T12:30:00Z'),
        }),
      ),
      getChannelMembers: jest
        .fn<any>()
        .mockResolvedValue([{ userId: USER_ID }]),
      getMemberRole: jest.fn<any>().mockResolvedValue('owner'),
      isMember: jest.fn<any>().mockResolvedValue(true),
      isBot: jest.fn<any>().mockResolvedValue(false),
      addMember: jest.fn<any>().mockResolvedValue(undefined),
      updateMember: jest.fn<any>().mockResolvedValue(undefined),
      removeMember: jest.fn<any>().mockResolvedValue(undefined),
      getChannelMemberIds: jest
        .fn<any>()
        .mockResolvedValue([USER_ID, TARGET_USER_ID]),
      findById: jest.fn<any>().mockResolvedValue(makeChannel()),
      deleteChannel: jest.fn<any>().mockResolvedValue(undefined),
      archiveChannel: jest.fn<any>().mockResolvedValue(undefined),
      unarchiveChannel: jest
        .fn<any>()
        .mockResolvedValue(makeChannel({ isArchived: false })),
      deactivateChannel: jest.fn<any>().mockResolvedValue({
        snapshot: { totalMessageCount: 3, latestMessages: [] },
      }),
      activateChannel: jest.fn<any>().mockResolvedValue(undefined),
    };

    websocketGateway = {
      broadcastToWorkspace: jest.fn<any>().mockResolvedValue(undefined),
      sendToUser: jest.fn<any>().mockResolvedValue(undefined),
      sendToChannelMembers: jest.fn<any>().mockResolvedValue(true),
    };

    eventEmitter = {
      emit: jest.fn<any>(),
    };

    controller = new ChannelsController(
      channelsService as never,
      websocketGateway as never,
      eventEmitter as never,
    );
  });

  it('forwards tenant and user to getMyChannels()', async () => {
    const result = await controller.getMyChannels(USER_ID, TENANT_ID);

    expect(channelsService.getUserChannels).toHaveBeenCalledWith(
      USER_ID,
      TENANT_ID,
    );
    expect(result).toEqual([{ id: CHANNEL_ID }]);
  });

  it('forwards tenant and user to getPublicChannels()', async () => {
    const result = await controller.getPublicChannels(USER_ID, TENANT_ID);

    expect(channelsService.getPublicChannels).toHaveBeenCalledWith(
      TENANT_ID,
      USER_ID,
    );
    expect(result).toEqual([{ id: CHANNEL_ID }]);
  });

  it('broadcasts public channels to the workspace and emits search indexing events', async () => {
    const channel = makeChannel({ type: 'public' });
    channelsService.create.mockResolvedValueOnce(channel);

    const result = await controller.createChannel(USER_ID, TENANT_ID, {
      name: 'Announcements',
      type: 'public',
    } as never);

    expect(channelsService.create).toHaveBeenCalledWith(
      { name: 'Announcements', type: 'public' },
      USER_ID,
      TENANT_ID,
    );
    expect(websocketGateway.broadcastToWorkspace).toHaveBeenCalledWith(
      TENANT_ID,
      'channel_created',
      channel,
    );
    expect(websocketGateway.sendToUser).not.toHaveBeenCalledWith(
      USER_ID,
      'channel_created',
      channel,
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith('channel.created', {
      channel,
    });
    expect(result).toEqual(channel);
  });

  it('broadcasts private channels to the creator only', async () => {
    const channel = makeChannel({ type: 'private' });
    channelsService.create.mockResolvedValueOnce(channel);

    await controller.createChannel(USER_ID, TENANT_ID, {
      name: 'Private',
      type: 'private',
    } as never);

    expect(websocketGateway.sendToUser).toHaveBeenCalledWith(
      USER_ID,
      'channel_created',
      channel,
    );
  });

  it('notifies both users when creating a direct channel', async () => {
    const channel = makeChannel({ type: 'direct' });
    channelsService.createDirectChannel.mockResolvedValueOnce(channel);

    const result = await controller.createDirectChannel(
      USER_ID,
      TENANT_ID,
      TARGET_USER_ID,
    );

    expect(channelsService.createDirectChannel).toHaveBeenCalledWith(
      USER_ID,
      TARGET_USER_ID,
      TENANT_ID,
    );
    expect(websocketGateway.sendToUser).toHaveBeenNthCalledWith(
      1,
      TARGET_USER_ID,
      'channel_created',
      channel,
    );
    expect(websocketGateway.sendToUser).toHaveBeenNthCalledWith(
      2,
      USER_ID,
      'channel_created',
      channel,
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith('channel.created', {
      channel,
    });
    expect(result).toEqual(channel);
  });

  it('asserts read access before returning a channel', async () => {
    const channel = makeChannel();
    channelsService.findByIdOrThrow.mockResolvedValueOnce(channel);

    const result = await controller.getChannel(USER_ID, CHANNEL_ID);

    expect(channelsService.assertReadAccess).toHaveBeenCalledWith(
      CHANNEL_ID,
      USER_ID,
    );
    expect(channelsService.findByIdOrThrow).toHaveBeenCalledWith(
      CHANNEL_ID,
      USER_ID,
    );
    expect(result).toEqual(channel);
  });

  it('throws ForbiddenException when a public preview is unavailable', async () => {
    channelsService.getPublicChannelPreview.mockResolvedValueOnce(null);

    await expect(
      controller.getChannelPreview(USER_ID, CHANNEL_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows joining a public channel and notifies the user', async () => {
    const channel = makeChannel({ type: 'public' });
    channelsService.findByIdOrThrow.mockResolvedValueOnce(channel);

    const result = await controller.joinChannel(USER_ID, CHANNEL_ID);

    expect(channelsService.joinPublicChannel).toHaveBeenCalledWith(
      CHANNEL_ID,
      USER_ID,
    );
    expect(channelsService.findByIdOrThrow).toHaveBeenCalledWith(
      CHANNEL_ID,
      USER_ID,
    );
    expect(websocketGateway.sendToUser).toHaveBeenCalledWith(
      USER_ID,
      'channel_created',
      channel,
    );
    expect(result).toEqual({ success: true });
  });

  it('forwards updates and notifies channel members with the updated payload', async () => {
    const updatedAt = new Date('2026-04-01T12:30:00Z');
    const channel = makeChannel({
      name: 'Renamed',
      description: 'Updated description',
      avatarUrl: 'https://cdn.example.com/avatar.png',
      updatedAt,
    });
    channelsService.update.mockResolvedValueOnce(channel);

    const result = await controller.updateChannel(USER_ID, CHANNEL_ID, {
      name: 'Renamed',
      description: 'Updated description',
      avatarUrl: 'https://cdn.example.com/avatar.png',
    } as never);

    expect(channelsService.update).toHaveBeenCalledWith(
      CHANNEL_ID,
      {
        name: 'Renamed',
        description: 'Updated description',
        avatarUrl: 'https://cdn.example.com/avatar.png',
      },
      USER_ID,
    );
    expect(websocketGateway.sendToChannelMembers).toHaveBeenCalledWith(
      CHANNEL_ID,
      'channel_updated',
      {
        channelId: CHANNEL_ID,
        name: 'Renamed',
        description: 'Updated description',
        avatarUrl: 'https://cdn.example.com/avatar.png',
        updatedBy: USER_ID,
        updatedAt,
      },
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith('channel.updated', {
      channel,
    });
    expect(result).toEqual(channel);
  });

  it('forwards getMembers after checking read access', async () => {
    const result = await controller.getMembers(USER_ID, CHANNEL_ID);

    expect(channelsService.assertReadAccess).toHaveBeenCalledWith(
      CHANNEL_ID,
      USER_ID,
    );
    expect(channelsService.getChannelMembers).toHaveBeenCalledWith(CHANNEL_ID);
    expect(result).toEqual([{ userId: USER_ID }]);
  });

  it('rejects addMember when the requester has no role', async () => {
    channelsService.getMemberRole.mockResolvedValueOnce(null);

    await expect(
      controller.addMember(USER_ID, CHANNEL_ID, {
        userId: TARGET_USER_ID,
      } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(channelsService.isBot).not.toHaveBeenCalled();
    expect(channelsService.addMember).not.toHaveBeenCalled();
  });

  it('rejects human invites for non-owner members', async () => {
    channelsService.getMemberRole.mockResolvedValueOnce('member');
    channelsService.isBot.mockResolvedValueOnce(false);

    await expect(
      controller.addMember(USER_ID, CHANNEL_ID, {
        userId: TARGET_USER_ID,
      } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(channelsService.addMember).not.toHaveBeenCalled();
  });

  it('allows member invites for bots and notifies the new member and the room', async () => {
    const channel = makeChannel({ type: 'private' });
    channelsService.getMemberRole.mockResolvedValueOnce('member');
    channelsService.isBot.mockResolvedValueOnce(true);
    channelsService.findByIdOrThrow.mockResolvedValueOnce(channel);

    const result = await controller.addMember(USER_ID, CHANNEL_ID, {
      userId: BOT_ID,
      role: 'member',
    } as never);

    expect(channelsService.addMember).toHaveBeenCalledWith(
      CHANNEL_ID,
      BOT_ID,
      'member',
    );
    expect(websocketGateway.sendToUser).toHaveBeenCalledWith(
      BOT_ID,
      'channel_created',
      channel,
    );
    expect(websocketGateway.sendToChannelMembers).toHaveBeenCalledWith(
      CHANNEL_ID,
      'channel_joined',
      {
        channelId: CHANNEL_ID,
        userId: BOT_ID,
      },
    );
    expect(result).toEqual({ success: true });
  });

  it('forwards member updates and returns success', async () => {
    const result = await controller.updateMember(
      USER_ID,
      CHANNEL_ID,
      MEMBER_ID,
      { role: 'admin', notificationsEnabled: false } as never,
    );

    expect(channelsService.updateMember).toHaveBeenCalledWith(
      CHANNEL_ID,
      MEMBER_ID,
      { role: 'admin', notificationsEnabled: false },
      USER_ID,
    );
    expect(result).toEqual({ success: true });
  });

  it('notifies the room and removed user when removing a member', async () => {
    const result = await controller.removeMember(
      USER_ID,
      CHANNEL_ID,
      MEMBER_ID,
    );

    expect(channelsService.removeMember).toHaveBeenCalledWith(
      CHANNEL_ID,
      MEMBER_ID,
      USER_ID,
    );
    expect(websocketGateway.sendToChannelMembers).toHaveBeenCalledWith(
      CHANNEL_ID,
      'channel_left',
      {
        channelId: CHANNEL_ID,
        userId: MEMBER_ID,
      },
    );
    expect(websocketGateway.sendToUser).toHaveBeenCalledWith(
      MEMBER_ID,
      'channel_left',
      {
        channelId: CHANNEL_ID,
        userId: MEMBER_ID,
      },
    );
    expect(result).toEqual({ success: true });
  });

  it('notifies the room and leaving user when leaving a channel', async () => {
    const result = await controller.leaveChannel(USER_ID, CHANNEL_ID);

    expect(channelsService.removeMember).toHaveBeenCalledWith(
      CHANNEL_ID,
      USER_ID,
      USER_ID,
    );
    expect(websocketGateway.sendToChannelMembers).toHaveBeenCalledWith(
      CHANNEL_ID,
      'channel_left',
      {
        channelId: CHANNEL_ID,
        userId: USER_ID,
      },
    );
    expect(websocketGateway.sendToUser).toHaveBeenCalledWith(
      USER_ID,
      'channel_left',
      {
        channelId: CHANNEL_ID,
        userId: USER_ID,
      },
    );
    expect(result).toEqual({ success: true });
  });

  it('archives a channel and notifies every member', async () => {
    const memberIds = [USER_ID, TARGET_USER_ID];
    channelsService.getChannelMemberIds.mockResolvedValueOnce(memberIds);
    channelsService.findById.mockResolvedValueOnce(makeChannel());

    const result = await controller.deleteChannel(USER_ID, CHANNEL_ID, {
      permanent: false,
    } as never);

    expect(channelsService.archiveChannel).toHaveBeenCalledWith(
      CHANNEL_ID,
      USER_ID,
    );
    expect(channelsService.deleteChannel).not.toHaveBeenCalled();
    expect(websocketGateway.sendToUser).toHaveBeenNthCalledWith(
      1,
      USER_ID,
      'channel_archived',
      {
        channelId: CHANNEL_ID,
        channelName: 'General',
        archivedBy: USER_ID,
      },
    );
    expect(websocketGateway.sendToUser).toHaveBeenNthCalledWith(
      2,
      TARGET_USER_ID,
      'channel_archived',
      {
        channelId: CHANNEL_ID,
        channelName: 'General',
        archivedBy: USER_ID,
      },
    );
    expect(eventEmitter.emit).not.toHaveBeenCalledWith(
      'channel.deleted',
      CHANNEL_ID,
    );
    expect(result).toEqual({ success: true });
  });

  it('permanently deletes a channel and notifies every member', async () => {
    const memberIds = [USER_ID, TARGET_USER_ID];
    channelsService.getChannelMemberIds.mockResolvedValueOnce(memberIds);
    channelsService.findById.mockResolvedValueOnce(makeChannel());

    const result = await controller.deleteChannel(USER_ID, CHANNEL_ID, {
      permanent: true,
      confirmationName: 'General',
    } as never);

    expect(channelsService.deleteChannel).toHaveBeenCalledWith(
      CHANNEL_ID,
      USER_ID,
      'General',
    );
    expect(channelsService.archiveChannel).not.toHaveBeenCalled();
    expect(websocketGateway.sendToUser).toHaveBeenNthCalledWith(
      1,
      USER_ID,
      'channel_deleted',
      {
        channelId: CHANNEL_ID,
        channelName: 'General',
        deletedBy: USER_ID,
      },
    );
    expect(websocketGateway.sendToUser).toHaveBeenNthCalledWith(
      2,
      TARGET_USER_ID,
      'channel_deleted',
      {
        channelId: CHANNEL_ID,
        channelName: 'General',
        deletedBy: USER_ID,
      },
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'channel.deleted',
      CHANNEL_ID,
    );
    expect(result).toEqual({ success: true });
  });

  it('unarchives a channel and notifies each member', async () => {
    const channel = makeChannel({ isArchived: false });
    channelsService.unarchiveChannel.mockResolvedValueOnce(channel);
    channelsService.getChannelMemberIds.mockResolvedValueOnce([
      USER_ID,
      TARGET_USER_ID,
    ]);

    const result = await controller.unarchiveChannel(USER_ID, CHANNEL_ID);

    expect(channelsService.unarchiveChannel).toHaveBeenCalledWith(
      CHANNEL_ID,
      USER_ID,
    );
    expect(websocketGateway.sendToUser).toHaveBeenNthCalledWith(
      1,
      USER_ID,
      'channel_unarchived',
      {
        channelId: CHANNEL_ID,
        channelName: 'General',
        unarchivedBy: USER_ID,
      },
    );
    expect(websocketGateway.sendToUser).toHaveBeenNthCalledWith(
      2,
      TARGET_USER_ID,
      'channel_unarchived',
      {
        channelId: CHANNEL_ID,
        channelName: 'General',
        unarchivedBy: USER_ID,
      },
    );
    expect(result).toEqual(channel);
  });

  it('rejects deactivate when the requester is not a channel member', async () => {
    channelsService.isMember.mockResolvedValueOnce(false);

    await expect(
      controller.deactivateChannel(USER_ID, CHANNEL_ID),
    ).rejects.toThrow('Not a channel member');

    expect(channelsService.isBot).not.toHaveBeenCalled();
    expect(channelsService.deactivateChannel).not.toHaveBeenCalled();
  });

  it('rejects deactivate when the requester is a member but not a bot', async () => {
    channelsService.isMember.mockResolvedValueOnce(true);
    channelsService.isBot.mockResolvedValueOnce(false);

    await expect(
      controller.deactivateChannel(USER_ID, CHANNEL_ID),
    ).rejects.toThrow('Only bots can deactivate channels');

    expect(channelsService.deactivateChannel).not.toHaveBeenCalled();
  });

  it('deactivates a channel for bot members and broadcasts the snapshot', async () => {
    channelsService.isMember.mockResolvedValueOnce(true);
    channelsService.isBot.mockResolvedValueOnce(true);

    const result = await controller.deactivateChannel(USER_ID, CHANNEL_ID);

    expect(channelsService.deactivateChannel).toHaveBeenCalledWith(CHANNEL_ID);
    expect(websocketGateway.sendToChannelMembers).toHaveBeenCalledWith(
      CHANNEL_ID,
      'tracking:deactivated',
      {
        channelId: CHANNEL_ID,
        snapshot: {
          totalMessageCount: 3,
          latestMessages: [],
        },
      },
    );
    expect(result).toEqual({ success: true });
  });

  it('rejects activate when the requester is not a channel member', async () => {
    channelsService.isMember.mockResolvedValueOnce(false);

    await expect(
      controller.activateChannel(USER_ID, CHANNEL_ID),
    ).rejects.toThrow('Not a channel member');

    expect(channelsService.isBot).not.toHaveBeenCalled();
    expect(channelsService.activateChannel).not.toHaveBeenCalled();
  });

  it('rejects activate when the requester is a member but not a bot', async () => {
    channelsService.isMember.mockResolvedValueOnce(true);
    channelsService.isBot.mockResolvedValueOnce(false);

    await expect(
      controller.activateChannel(USER_ID, CHANNEL_ID),
    ).rejects.toThrow('Only bots can activate channels');

    expect(channelsService.activateChannel).not.toHaveBeenCalled();
  });

  it('activates a channel for bot members and broadcasts the event', async () => {
    channelsService.isMember.mockResolvedValueOnce(true);
    channelsService.isBot.mockResolvedValueOnce(true);

    const result = await controller.activateChannel(USER_ID, CHANNEL_ID);

    expect(channelsService.activateChannel).toHaveBeenCalledWith(CHANNEL_ID);
    expect(websocketGateway.sendToChannelMembers).toHaveBeenCalledWith(
      CHANNEL_ID,
      'tracking:activated',
      {
        channelId: CHANNEL_ID,
      },
    );
    expect(result).toEqual({ success: true });
  });
});
