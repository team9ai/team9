import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { BotController } from './bot.controller.js';

describe('BotController', () => {
  let botService: {
    isUsernameTaken: jest.Mock<any>;
    getBotById: jest.Mock<any>;
  };
  let controller: BotController;

  beforeEach(() => {
    botService = {
      isUsernameTaken: jest.fn<any>(),
      getBotById: jest.fn<any>(),
    };
    controller = new BotController(botService as never);
  });

  describe('checkUsername', () => {
    it('rejects missing usernames', async () => {
      await expect(controller.checkUsername('' as never)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('trims the username and returns availability', async () => {
      botService.isUsernameTaken
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      await expect(controller.checkUsername('  alpha  ')).resolves.toEqual({
        available: true,
      });
      await expect(controller.checkUsername('beta')).resolves.toEqual({
        available: false,
      });

      expect(botService.isUsernameTaken).toHaveBeenNthCalledWith(1, 'alpha');
      expect(botService.isUsernameTaken).toHaveBeenNthCalledWith(2, 'beta');
    });
  });

  describe('assertBotOwner', () => {
    it('throws when the bot does not exist', async () => {
      botService.getBotById.mockResolvedValueOnce(null);

      await expect(
        (controller as any).assertBotOwner('bot-1', 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws when the bot is a system bot', async () => {
      botService.getBotById.mockResolvedValueOnce({
        id: 'bot-1',
        type: 'system',
        ownerId: 'user-1',
      });

      await expect(
        (controller as any).assertBotOwner('bot-1', 'user-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws when the requester is not the owner', async () => {
      botService.getBotById.mockResolvedValueOnce({
        id: 'bot-1',
        type: 'custom',
        ownerId: 'user-2',
      });

      await expect(
        (controller as any).assertBotOwner('bot-1', 'user-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows owners to manage non-system bots', async () => {
      botService.getBotById.mockResolvedValueOnce({
        id: 'bot-1',
        type: 'custom',
        ownerId: 'user-1',
      });

      await expect(
        (controller as any).assertBotOwner('bot-1', 'user-1'),
      ).resolves.toBeUndefined();
    });
  });
});
