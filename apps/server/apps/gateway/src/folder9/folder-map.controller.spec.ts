import { jest, describe, it, expect, beforeEach } from '@jest/globals';

jest.unstable_mockModule('@team9/auth', () => ({
  AuthGuard: class AuthGuard {},
  CurrentUser: () => () => undefined,
}));

jest.unstable_mockModule('./folder-map-builder.service.js', () => ({
  FolderMapBuilder: class FolderMapBuilder {},
}));

jest.unstable_mockModule('./bot-agent-ownership.service.js', () => ({
  BotAgentOwnership: class BotAgentOwnership {},
}));

const { FolderMapController } = await import('./folder-map.controller.js');
const { FolderMapBuilder } = await import('./folder-map-builder.service.js');
const { BotAgentOwnership } = await import('./bot-agent-ownership.service.js');

import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { FolderMapResponse } from './folder-map-builder.service.js';
import type { FolderMapRequestDto } from './dto/folder-map-request.dto.js';

type MockFn = jest.Mock<(...args: any[]) => any>;

const BOT_USER_ID = 'bot-user-uuid-1234';
const AGENT_ID = 'agent-uuid-1';

const makeDto = (
  overrides: Partial<FolderMapRequestDto> = {},
): FolderMapRequestDto =>
  ({
    sessionId: 'team9/tenant-1/agent-1/dm/channel-1',
    agentId: AGENT_ID,
    routineId: undefined,
    userId: undefined,
    ...overrides,
  }) as FolderMapRequestDto;

describe('FolderMapController', () => {
  let controller: InstanceType<typeof FolderMapController>;
  let builder: { buildFolderMap: MockFn };
  let ownership: { assertAgentBelongsToBot: MockFn };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FolderMapController],
      providers: [FolderMapBuilder, BotAgentOwnership],
    }).compile();

    controller = module.get(FolderMapController);
    builder = module.get(FolderMapBuilder);
    ownership = module.get(BotAgentOwnership);

    builder.buildFolderMap = jest.fn<MockFn>();
    ownership.assertAgentBelongsToBot = jest.fn<MockFn>();
  });

  describe('POST /api/v1/bot/folder-map', () => {
    it('returns folderMap from builder when header matches and agentId is owned', async () => {
      const response: FolderMapResponse = {
        folderMap: {
          'session.tmp': {
            workspaceId: 'tenant-1',
            folderId: 'f1',
            folderType: 'light',
            permission: 'write',
          },
        },
      };
      ownership.assertAgentBelongsToBot.mockResolvedValue(undefined);
      builder.buildFolderMap.mockResolvedValue(response);

      const result = await controller.build(
        makeDto(),
        BOT_USER_ID,
        BOT_USER_ID,
      );

      expect(result).toEqual(response);
    });

    it('forwards dto fields (sessionId, agentId, routineId, userId) to builder', async () => {
      ownership.assertAgentBelongsToBot.mockResolvedValue(undefined);
      builder.buildFolderMap.mockResolvedValue({ folderMap: {} });
      const dto = makeDto({
        sessionId: 'team9/tenant-1/agent-1/routine/r-1',
        routineId: 'r-1',
        userId: 'u-1',
      });

      await controller.build(dto, BOT_USER_ID, BOT_USER_ID);

      expect(builder.buildFolderMap).toHaveBeenCalledTimes(1);
      expect(builder.buildFolderMap).toHaveBeenCalledWith({
        sessionId: dto.sessionId,
        agentId: dto.agentId,
        routineId: 'r-1',
        userId: 'u-1',
      });
    });

    it('checks ownership with the authenticated sub (not the header)', async () => {
      ownership.assertAgentBelongsToBot.mockResolvedValue(undefined);
      builder.buildFolderMap.mockResolvedValue({ folderMap: {} });

      await controller.build(makeDto(), BOT_USER_ID, BOT_USER_ID);

      expect(ownership.assertAgentBelongsToBot).toHaveBeenCalledWith(
        BOT_USER_ID,
        AGENT_ID,
      );
    });

    it('throws ForbiddenException when X-Team9-Bot-User-Id header is missing', async () => {
      await expect(
        controller.build(makeDto(), BOT_USER_ID, undefined),
      ).rejects.toMatchObject({
        name: 'ForbiddenException',
        message: 'X-Team9-Bot-User-Id does not match authenticated bot',
      });
      expect(ownership.assertAgentBelongsToBot).not.toHaveBeenCalled();
      expect(builder.buildFolderMap).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when header is empty string', async () => {
      await expect(
        controller.build(makeDto(), BOT_USER_ID, ''),
      ).rejects.toMatchObject({
        name: 'ForbiddenException',
        message: 'X-Team9-Bot-User-Id does not match authenticated bot',
      });
      expect(ownership.assertAgentBelongsToBot).not.toHaveBeenCalled();
      expect(builder.buildFolderMap).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when header does not match authenticated sub', async () => {
      await expect(
        controller.build(makeDto(), BOT_USER_ID, 'different-user'),
      ).rejects.toMatchObject({
        name: 'ForbiddenException',
        message: 'X-Team9-Bot-User-Id does not match authenticated bot',
      });
      expect(ownership.assertAgentBelongsToBot).not.toHaveBeenCalled();
      expect(builder.buildFolderMap).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when agentId does not belong to caller bot', async () => {
      ownership.assertAgentBelongsToBot.mockRejectedValue(
        new ForbiddenException('agentId does not belong to caller bot'),
      );
      const dto = makeDto({ agentId: 'foreign-agent' });

      await expect(
        controller.build(dto, BOT_USER_ID, BOT_USER_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(builder.buildFolderMap).not.toHaveBeenCalled();
    });

    it('does not call ownership or builder when header validation fails', async () => {
      await expect(
        controller.build(makeDto(), BOT_USER_ID, 'mismatch'),
      ).rejects.toThrow();

      expect(ownership.assertAgentBelongsToBot).not.toHaveBeenCalled();
      expect(builder.buildFolderMap).not.toHaveBeenCalled();
    });
  });
});
