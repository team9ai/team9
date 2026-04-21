import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

jest.unstable_mockModule('@team9/auth', () => ({
  AuthGuard: class AuthGuard {},
  CurrentUser: () => () => undefined,
  BOT_TOKEN_VALIDATOR: Symbol('BOT_TOKEN_VALIDATOR'),
}));

jest.unstable_mockModule(
  '../../common/decorators/current-tenant.decorator.js',
  () => ({
    CurrentTenantId: () => () => undefined,
  }),
);

// Mock service modules to avoid loading their complex transitive dependencies
// (database, redis, rabbitmq, websocket, etc.) during unit testing.
jest.unstable_mockModule('../channels/channels.service.js', () => ({
  ChannelsService: class ChannelsService {},
}));

jest.unstable_mockModule('../messages/messages.service.js', () => ({
  MessagesService: class MessagesService {},
}));

jest.unstable_mockModule('../../search/search.service.js', () => ({
  SearchService: class SearchService {},
}));

const { BotMessagingController } =
  await import('./bot-messaging.controller.js');

type MockFn = jest.Mock<(...args: any[]) => any>;

describe('BotMessagingController', () => {
  let controller: InstanceType<typeof BotMessagingController>;
  let channelsService: Record<string, MockFn>;
  let messagesService: Record<string, MockFn>;
  let searchService: Record<string, MockFn>;

  beforeEach(() => {
    channelsService = {
      assertBotCanDm: jest.fn<any>().mockResolvedValue(undefined),
      createDirectChannel: jest.fn<any>().mockResolvedValue({ id: 'dm-ch-1' }),
      filterBotUserIds: jest.fn<any>().mockResolvedValue(new Set()),
    };
    messagesService = {
      sendFromBot: jest
        .fn<any>()
        .mockResolvedValue({ channelId: 'dm-ch-1', messageId: 'msg-1' }),
    };
    searchService = {
      searchUsers: jest.fn<any>().mockResolvedValue({
        items: [
          {
            id: 'sr-1',
            type: 'user',
            score: 1,
            data: {
              id: 'u-1',
              displayName: 'Alice',
              username: 'alice',
              email: 'a@x',
              status: 'online',
              isActive: true,
              createdAt: new Date(),
            },
          },
          {
            id: 'sr-2',
            type: 'user',
            score: 1,
            data: {
              id: 'u-2',
              displayName: 'Bob',
              username: 'bob',
              email: 'b@x',
              status: 'online',
              isActive: true,
              createdAt: new Date(),
            },
          },
        ],
        total: 2,
        hasMore: false,
      }),
    };
    controller = new BotMessagingController(
      channelsService as any,
      messagesService as any,
      searchService as any,
    );
  });

  describe('sendToUser', () => {
    it('happy path: returns channelId + messageId, calls services in order', async () => {
      const res = await controller.sendToUser('bot-1', 'tenant-1', {
        userId: 'user-42',
        content: 'hi',
      } as any);

      expect(channelsService['assertBotCanDm']).toHaveBeenCalledWith(
        'bot-1',
        'user-42',
        'tenant-1',
      );
      expect(channelsService['createDirectChannel']).toHaveBeenCalledWith(
        'bot-1',
        'user-42',
        'tenant-1',
      );
      expect(messagesService['sendFromBot']).toHaveBeenCalledWith({
        botUserId: 'bot-1',
        channelId: 'dm-ch-1',
        content: 'hi',
        attachments: undefined,
        workspaceId: 'tenant-1',
      });
      expect(res).toEqual({ channelId: 'dm-ch-1', messageId: 'msg-1' });
    });

    it('missing tenantId throws BadRequestException', async () => {
      await expect(
        controller.sendToUser('bot-1', undefined, {
          userId: 'u',
          content: 'x',
        } as any),
      ).rejects.toThrow('Bot token missing tenant context');

      expect(channelsService['assertBotCanDm']).not.toHaveBeenCalled();
      expect(channelsService['createDirectChannel']).not.toHaveBeenCalled();
      expect(messagesService['sendFromBot']).not.toHaveBeenCalled();
    });

    it('missing tenantId throws a BadRequestException instance', async () => {
      await expect(
        controller.sendToUser('bot-1', undefined, {
          userId: 'u',
          content: 'x',
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('forwards attachments to sendFromBot', async () => {
      const attachments = [
        {
          fileKey: 'k',
          fileName: 'n',
          mimeType: 'image/png',
          fileSize: 100,
        },
      ];
      await controller.sendToUser('bot-1', 'tenant-1', {
        userId: 'u',
        content: 'x',
        attachments,
      } as any);

      expect(messagesService['sendFromBot']).toHaveBeenCalledWith(
        expect.objectContaining({ attachments }),
      );
    });

    it('propagates DM_NOT_ALLOWED ForbiddenException from assertBotCanDm', async () => {
      channelsService['assertBotCanDm'].mockRejectedValue(
        new ForbiddenException('DM_NOT_ALLOWED'),
      );

      await expect(
        controller.sendToUser('bot-1', 'tenant-1', {
          userId: 'u',
          content: 'x',
        } as any),
      ).rejects.toThrow('DM_NOT_ALLOWED');

      expect(channelsService['createDirectChannel']).not.toHaveBeenCalled();
      expect(messagesService['sendFromBot']).not.toHaveBeenCalled();
    });

    it('propagates SELF_DM BadRequestException from assertBotCanDm', async () => {
      channelsService['assertBotCanDm'].mockRejectedValue(
        new BadRequestException('SELF_DM'),
      );

      await expect(
        controller.sendToUser('bot-1', 'tenant-1', {
          userId: 'bot-1',
          content: 'x',
        } as any),
      ).rejects.toThrow('SELF_DM');

      expect(channelsService['createDirectChannel']).not.toHaveBeenCalled();
    });

    it('propagates USER_NOT_FOUND NotFoundException from assertBotCanDm', async () => {
      channelsService['assertBotCanDm'].mockRejectedValue(
        new NotFoundException('USER_NOT_FOUND'),
      );

      await expect(
        controller.sendToUser('bot-1', 'tenant-1', {
          userId: 'u',
          content: 'x',
        } as any),
      ).rejects.toThrow('USER_NOT_FOUND');

      expect(channelsService['createDirectChannel']).not.toHaveBeenCalled();
    });

    it('propagates CROSS_TENANT BadRequestException from assertBotCanDm', async () => {
      channelsService['assertBotCanDm'].mockRejectedValue(
        new BadRequestException('CROSS_TENANT'),
      );

      await expect(
        controller.sendToUser('bot-1', 'tenant-1', {
          userId: 'u',
          content: 'x',
        } as any),
      ).rejects.toThrow('CROSS_TENANT');

      expect(channelsService['createDirectChannel']).not.toHaveBeenCalled();
    });
  });

  describe('searchUsers', () => {
    it('happy path: returns mapped fields without email/username/status', async () => {
      const res = await controller.searchUsers('bot-1', 'tenant-1', {
        q: 'Ali',
      } as any);

      expect(searchService['searchUsers']).toHaveBeenCalledWith(
        'Ali',
        'bot-1',
        'tenant-1',
        { limit: 5 },
      );
      expect(res.results).toHaveLength(2);
      expect(res.results[0]).toEqual({ userId: 'u-1', displayName: 'Alice' });
      expect(res.results[1]).toEqual({ userId: 'u-2', displayName: 'Bob' });
      expect(res.results[0]).not.toHaveProperty('email');
      expect(res.results[0]).not.toHaveProperty('username');
      expect(res.results[0]).not.toHaveProperty('status');
    });

    it('missing tenantId throws BadRequestException', async () => {
      await expect(
        controller.searchUsers('bot-1', undefined, { q: 'x' } as any),
      ).rejects.toThrow('Bot token missing tenant context');

      await expect(
        controller.searchUsers('bot-1', undefined, { q: 'x' } as any),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(searchService['searchUsers']).not.toHaveBeenCalled();
    });

    it('excludes bot users from results', async () => {
      channelsService['filterBotUserIds'].mockResolvedValue(new Set(['u-2']));

      const res = await controller.searchUsers('bot-1', 'tenant-1', {
        q: 'x',
      } as any);

      expect(res.results.map((r) => r.userId)).toEqual(['u-1']);
    });

    it('passes tenantId from decorator to searchService, not from query', async () => {
      await controller.searchUsers('bot-1', 'tenant-ctx', { q: 'x' } as any);

      expect(searchService['searchUsers']).toHaveBeenCalledWith(
        'x',
        'bot-1',
        'tenant-ctx',
        expect.any(Object),
      );
    });

    it('honors custom limit from query', async () => {
      await controller.searchUsers('bot-1', 'tenant-1', {
        q: 'x',
        limit: 8,
      } as any);

      expect(searchService['searchUsers']).toHaveBeenCalledWith(
        'x',
        'bot-1',
        'tenant-1',
        { limit: 8 },
      );
    });

    it('defaults limit to 5 when not provided', async () => {
      await controller.searchUsers('bot-1', 'tenant-1', { q: 'x' } as any);

      expect(searchService['searchUsers']).toHaveBeenCalledWith(
        'x',
        'bot-1',
        'tenant-1',
        { limit: 5 },
      );
    });

    it('passes botUserId to filterBotUserIds with mapped userIds', async () => {
      await controller.searchUsers('bot-1', 'tenant-1', { q: 'x' } as any);

      expect(channelsService['filterBotUserIds']).toHaveBeenCalledWith([
        'u-1',
        'u-2',
      ]);
    });

    it('returns empty results when all users are bots', async () => {
      channelsService['filterBotUserIds'].mockResolvedValue(
        new Set(['u-1', 'u-2']),
      );

      const res = await controller.searchUsers('bot-1', 'tenant-1', {
        q: 'x',
      } as any);

      expect(res.results).toHaveLength(0);
    });

    it('falls back to username when displayName is null/undefined', async () => {
      searchService['searchUsers'].mockResolvedValue({
        items: [
          {
            id: 'sr-3',
            type: 'user',
            score: 1,
            data: {
              id: 'u-3',
              displayName: null,
              username: 'charlie',
              email: 'c@x',
              status: 'offline',
              isActive: true,
              createdAt: new Date(),
            },
          },
        ],
        total: 1,
        hasMore: false,
      });

      const res = await controller.searchUsers('bot-1', 'tenant-1', {
        q: 'charlie',
      } as any);

      expect(res.results[0]).toEqual({ userId: 'u-3', displayName: 'charlie' });
    });

    it('returns empty results when search returns no items', async () => {
      searchService['searchUsers'].mockResolvedValue({
        items: [],
        total: 0,
        hasMore: false,
      });

      const res = await controller.searchUsers('bot-1', 'tenant-1', {
        q: 'nobody',
      } as any);

      expect(res.results).toHaveLength(0);
    });
  });
});
