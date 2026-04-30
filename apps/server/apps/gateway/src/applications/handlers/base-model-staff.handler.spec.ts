import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { DATABASE_CONNECTION } from '@team9/database';
import { BaseModelStaffHandler } from './base-model-staff.handler.js';
import { BotService } from '../../bot/bot.service.js';
import { ClawHiveService } from '@team9/claw-hive';
import { ChannelsService } from '../../im/channels/channels.service.js';
import { RedisService } from '@team9/redis';
import { BASE_MODEL_PRESETS } from './base-model-staff.presets.js';
import type { InstallContext } from './application-handler.interface.js';
import { WEBSOCKET_GATEWAY } from '../../shared/constants/injection-tokens.js';

// ── helpers ──────────────────────────────────────────────────────────────────

type MockFn = jest.Mock<(...args: any[]) => any>;

/** Minimal Drizzle chain mock */
function mockDb() {
  const chain: Record<string, MockFn> = {};
  const methods = ['select', 'from', 'where', 'innerJoin', 'leftJoin'];
  for (const m of methods) {
    chain[m] = jest.fn<any>().mockReturnValue(chain);
  }
  // Default: return empty member list
  chain.where.mockResolvedValue([]);
  return chain;
}

// ── fixtures ──────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-uuid-1234';
const INSTALLED_BY = 'user-uuid-owner';
const INSTALLED_APP = { id: 'installed-app-uuid' } as any;

const makeContext = (): InstallContext => ({
  installedApplication: INSTALLED_APP,
  tenantId: TENANT_ID,
  installedBy: INSTALLED_BY,
});

const makeBotResult = (key: string) => ({
  bot: {
    botId: `bot-id-${key}`,
    userId: `bot-user-${key}`,
    username: `${key}-bot-short`,
    displayName: key,
    email: `${key}@team9.local`,
    type: 'system',
    ownerId: INSTALLED_BY,
    mentorId: INSTALLED_BY,
    description: null,
    capabilities: null,
    extra: null,
    managedProvider: 'hive',
    managedMeta: { agentId: `base-model-${key}-${TENANT_ID}` },
    isActive: true,
  },
  accessToken: `token-${key}`,
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe('BaseModelStaffHandler', () => {
  let handler: BaseModelStaffHandler;
  let db: ReturnType<typeof mockDb>;
  let botService: {
    createWorkspaceBot: MockFn;
    deleteBotAndCleanup: MockFn;
    getBotsByInstalledApplicationId: MockFn;
  };
  let clawHiveService: {
    healthCheck: MockFn;
    registerAgents: MockFn;
    deleteAgents: MockFn;
  };
  let channelsService: { createDirectChannelsBatch: MockFn };
  let websocketGateway: { sendToUser: MockFn };
  let redisService: { hgetall: MockFn };

  beforeEach(async () => {
    db = mockDb();

    botService = {
      createWorkspaceBot: jest.fn<any>(),
      deleteBotAndCleanup: jest.fn<any>().mockResolvedValue(undefined),
      getBotsByInstalledApplicationId: jest.fn<any>().mockResolvedValue([]),
    };

    clawHiveService = {
      healthCheck: jest.fn<any>().mockResolvedValue(true),
      registerAgents: jest.fn<any>().mockResolvedValue(undefined),
      deleteAgents: jest.fn<any>().mockResolvedValue(undefined),
    };

    channelsService = {
      createDirectChannelsBatch: jest.fn<any>().mockResolvedValue(new Map()),
    };

    websocketGateway = {
      sendToUser: jest.fn<any>().mockResolvedValue(undefined),
    };

    redisService = {
      hgetall: jest.fn<any>().mockResolvedValue({}),
    };

    // Default: createWorkspaceBot returns per-preset bot result
    for (const preset of BASE_MODEL_PRESETS) {
      botService.createWorkspaceBot.mockResolvedValueOnce(
        makeBotResult(preset.key),
      );
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BaseModelStaffHandler,
        { provide: DATABASE_CONNECTION, useValue: db },
        { provide: BotService, useValue: botService },
        { provide: ClawHiveService, useValue: clawHiveService },
        { provide: ChannelsService, useValue: channelsService },
        { provide: WEBSOCKET_GATEWAY, useValue: websocketGateway },
        { provide: RedisService, useValue: redisService },
      ],
    }).compile();

    handler = module.get<BaseModelStaffHandler>(BaseModelStaffHandler);
  });

  // ── onInstall ───────────────────────────────────────────────────────────────

  describe('onInstall', () => {
    it('health-checks claw-hive before proceeding', async () => {
      await handler.onInstall(makeContext());
      expect(clawHiveService.healthCheck).toHaveBeenCalledTimes(1);
    });

    it('throws if claw-hive health check fails', async () => {
      clawHiveService.healthCheck.mockResolvedValueOnce(false);
      await expect(handler.onInstall(makeContext())).rejects.toThrow(
        'Claw Hive API is not reachable',
      );
    });

    it('creates one bot per preset with correct parameters', async () => {
      await handler.onInstall(makeContext());

      expect(botService.createWorkspaceBot).toHaveBeenCalledTimes(
        BASE_MODEL_PRESETS.length,
      );

      for (const preset of BASE_MODEL_PRESETS) {
        expect(botService.createWorkspaceBot).toHaveBeenCalledWith(
          expect.objectContaining({
            tenantId: TENANT_ID,
            ownerId: INSTALLED_BY,
            type: 'system',
            displayName: preset.name,
            managedProvider: 'hive',
            managedMeta: {
              agentId: `base-model-${preset.key}-${TENANT_ID}`,
            },
          }),
        );
      }
    });

    it('batch-registers claw-hive agents with searchable metadata', async () => {
      await handler.onInstall(makeContext());

      expect(clawHiveService.registerAgents).toHaveBeenCalledTimes(1);
      expect(clawHiveService.registerAgents).toHaveBeenCalledWith(
        expect.objectContaining({
          atomic: true,
          agents: expect.arrayContaining(
            BASE_MODEL_PRESETS.map((preset) =>
              expect.objectContaining({
                id: `base-model-${preset.key}-${TENANT_ID}`,
                name: preset.name,
                blueprintId: 'team9-hive-base-model',
                tenantId: TENANT_ID,
                metadata: {
                  tenantId: TENANT_ID,
                  botId: `bot-id-${preset.key}`,
                  mentorId: INSTALLED_BY,
                },
                model: { provider: preset.provider, id: preset.modelId },
              }),
            ),
          ),
        }),
      );
    });

    it('passes virtual workspace componentConfigs (folder9 + just-bash + workspace layout) for every base-model agent', async () => {
      await handler.onInstall(makeContext());

      const call = clawHiveService.registerAgents.mock.calls[0][0] as {
        agents: Array<{ componentConfigs: Record<string, unknown> }>;
      };
      expect(call.agents).toHaveLength(BASE_MODEL_PRESETS.length);
      for (const agent of call.agents) {
        const configs = agent.componentConfigs;
        // folder9: workspaceId pinned to tenantId, no PSK shipped (workspace
        // mounts use externally-managed tokens issued lazily by Team9Component).
        expect(configs).toHaveProperty('folder9');
        const folder9Config = configs['folder9'] as Record<string, unknown>;
        expect(folder9Config.workspaceId).toBe(TENANT_ID);
        expect(folder9Config).not.toHaveProperty('folder9Psk');
        expect(configs).toEqual(
          expect.objectContaining({
            'just-bash': { network: 'none' },
            'just-bash-team9-workspace': { mountTeam9Skills: true },
          }),
        );
      }
    });

    it('creates DM channels for workspace members for each bot', async () => {
      const memberIds = ['member-a', 'member-b'];
      db.where.mockResolvedValueOnce(memberIds.map((userId) => ({ userId })));

      await handler.onInstall(makeContext());

      expect(channelsService.createDirectChannelsBatch).toHaveBeenCalledTimes(
        BASE_MODEL_PRESETS.length,
      );
    });

    it('emits channel_created events to online workspace members', async () => {
      const memberIds = ['member-a', 'member-b'];
      db.where.mockResolvedValueOnce(memberIds.map((userId) => ({ userId })));

      // member-a is online, member-b is offline
      redisService.hgetall.mockResolvedValueOnce({ 'member-a': 'online' });

      const dmChannelA = { id: 'dm-a', type: 'direct' };
      const dmChannelB = { id: 'dm-b', type: 'direct' };

      // Each bot creates DM channels with the two members
      for (let i = 0; i < BASE_MODEL_PRESETS.length; i++) {
        channelsService.createDirectChannelsBatch.mockResolvedValueOnce(
          new Map([
            ['member-a', dmChannelA],
            ['member-b', dmChannelB],
          ]),
        );
      }

      await handler.onInstall(makeContext());

      // Should notify member-a (online) for each bot, but not member-b (offline)
      expect(websocketGateway.sendToUser).toHaveBeenCalledWith(
        'member-a',
        'channel_created',
        dmChannelA,
      );
      expect(websocketGateway.sendToUser).not.toHaveBeenCalledWith(
        'member-b',
        expect.anything(),
        expect.anything(),
      );
    });

    it('does not fail installation if WebSocket notifications fail', async () => {
      const memberIds = ['member-a'];
      db.where.mockResolvedValueOnce(memberIds.map((userId) => ({ userId })));
      redisService.hgetall.mockRejectedValueOnce(new Error('Redis down'));

      for (let i = 0; i < BASE_MODEL_PRESETS.length; i++) {
        channelsService.createDirectChannelsBatch.mockResolvedValueOnce(
          new Map([['member-a', { id: 'dm-a', type: 'direct' }]]),
        );
      }

      // Should not throw — installation still succeeds
      const result = await handler.onInstall(makeContext());
      expect(result.config).toBeDefined();
    });

    it('returns config with all bot IDs', async () => {
      const result = await handler.onInstall(makeContext());

      const expectedBotIds = BASE_MODEL_PRESETS.map(
        (p) => makeBotResult(p.key).bot.botId,
      );
      expect(result.config).toEqual({ botIds: expectedBotIds });
    });

    it('skips DM creation when there are no workspace members', async () => {
      db.where.mockResolvedValueOnce([]);

      await handler.onInstall(makeContext());

      expect(channelsService.createDirectChannelsBatch).not.toHaveBeenCalled();
    });

    it('rolls back created bots if a later step fails', async () => {
      // First two bots succeed; third bot creation throws
      const firstResult = makeBotResult('claude');
      const secondResult = makeBotResult('chatgpt');

      // Reset the default mocks from beforeEach before setting failure scenario
      botService.createWorkspaceBot.mockReset();
      botService.createWorkspaceBot
        .mockResolvedValueOnce(firstResult)
        .mockResolvedValueOnce(secondResult)
        .mockRejectedValueOnce(new Error('DB error'));

      await expect(handler.onInstall(makeContext())).rejects.toThrow(
        'DB error',
      );

      // Should attempt cleanup for both created bots
      expect(botService.deleteBotAndCleanup).toHaveBeenCalledWith(
        firstResult.bot.botId,
      );
      expect(botService.deleteBotAndCleanup).toHaveBeenCalledWith(
        secondResult.bot.botId,
      );
    });
  });

  // ── onUninstall ─────────────────────────────────────────────────────────────

  describe('onUninstall', () => {
    const installedApp = { id: 'installed-app-uuid' } as any;

    it('batch-deletes claw-hive agents and deletes bots', async () => {
      const bots = BASE_MODEL_PRESETS.map((p) => ({
        ...makeBotResult(p.key).bot,
      }));
      botService.getBotsByInstalledApplicationId.mockResolvedValueOnce(bots);

      await handler.onUninstall(installedApp);

      const expectedAgentIds = bots.map((bot) => bot.managedMeta.agentId);
      expect(clawHiveService.deleteAgents).toHaveBeenCalledWith(
        expectedAgentIds,
      );
      for (const bot of bots) {
        expect(botService.deleteBotAndCleanup).toHaveBeenCalledWith(bot.botId);
      }
    });

    it('still deletes the bot record if agent deletion fails', async () => {
      const bots = [makeBotResult('claude').bot];
      botService.getBotsByInstalledApplicationId.mockResolvedValueOnce(bots);
      clawHiveService.deleteAgents.mockRejectedValueOnce(new Error('404'));

      await expect(handler.onUninstall(installedApp)).resolves.not.toThrow();

      expect(botService.deleteBotAndCleanup).toHaveBeenCalledWith(
        bots[0].botId,
      );
    });

    it('skips agent deletion when managedMeta.agentId is absent', async () => {
      const bot = { ...makeBotResult('claude').bot, managedMeta: null };
      botService.getBotsByInstalledApplicationId.mockResolvedValueOnce([bot]);

      await handler.onUninstall(installedApp);

      expect(clawHiveService.deleteAgents).not.toHaveBeenCalled();
      expect(botService.deleteBotAndCleanup).toHaveBeenCalledWith(bot.botId);
    });

    it('is a no-op when no bots are found', async () => {
      botService.getBotsByInstalledApplicationId.mockResolvedValueOnce([]);

      await handler.onUninstall(installedApp);

      expect(clawHiveService.deleteAgents).not.toHaveBeenCalled();
      expect(botService.deleteBotAndCleanup).not.toHaveBeenCalled();
    });
  });
});
