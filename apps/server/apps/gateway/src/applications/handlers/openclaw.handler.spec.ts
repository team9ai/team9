import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  beforeAll,
  afterAll,
} from '@jest/globals';
import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DATABASE_CONNECTION } from '@team9/database';
import { OpenClawHandler } from './openclaw.handler.js';
import { BotService } from '../../bot/bot.service.js';
import { OpenclawService } from '../../openclaw/openclaw.service.js';
import type { InstallContext } from './application-handler.interface.js';

// ── env stubs ────────────────────────────────────────────────────────────────

const savedEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const key of ['API_URL', 'CAPABILITY_BASE_URL']) {
    savedEnv[key] = process.env[key];
  }
  process.env.API_URL = 'http://localhost:3000';
  process.env.CAPABILITY_BASE_URL = 'http://localhost:4000';

  // Suppress logger output during tests
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
});

afterAll(() => {
  for (const [key, val] of Object.entries(savedEnv)) {
    if (val === undefined) delete process.env[key];
    else process.env[key] = val;
  }
  jest.restoreAllMocks();
});

// ── helpers ──────────────────────────────────────────────────────────────────

type MockFn = jest.Mock<(...args: any[]) => any>;

function mockDb() {
  const chain: Record<string, MockFn> = {};
  const methods = ['select', 'from', 'where', 'innerJoin', 'delete'];
  for (const m of methods) {
    chain[m] = jest.fn<any>().mockReturnValue(chain);
  }
  chain.where.mockResolvedValue([]);
  return chain;
}

// ── fixtures ─────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-uuid-1234';
const INSTALLED_BY = 'user-uuid-owner';
const INSTALLED_APP = { id: 'installed-app-uuid' } as any;

const makeContext = (): InstallContext => ({
  installedApplication: INSTALLED_APP,
  tenantId: TENANT_ID,
  installedBy: INSTALLED_BY,
});

const BOT_RESULT = {
  bot: {
    botId: 'bot-id-openclaw',
    userId: 'bot-user-openclaw',
    username: 'openclaw-bot',
    displayName: 'OpenClaw Bot',
    email: 'openclaw@team9.local',
    type: 'system',
    ownerId: INSTALLED_BY,
    mentorId: INSTALLED_BY,
    description: null,
    capabilities: null,
    extra: null,
    managedProvider: null,
    managedMeta: null,
    isActive: true,
  },
  accessToken: 'token-openclaw',
};

const INSTANCE_RESULT = {
  access_url: 'https://openclaw.example.com',
};

// ── tests ────────────────────────────────────────────────────────────────────

describe('OpenClawHandler', () => {
  let handler: OpenClawHandler;
  let db: ReturnType<typeof mockDb>;
  let botService: {
    createWorkspaceBot: MockFn;
    deleteBotAndCleanup: MockFn;
  };
  let openclawService: {
    createInstance: MockFn;
    deleteInstance: MockFn;
  };

  beforeEach(async () => {
    db = mockDb();

    botService = {
      createWorkspaceBot: jest.fn<any>().mockResolvedValue(BOT_RESULT),
      deleteBotAndCleanup: jest.fn<any>().mockResolvedValue(undefined),
    };

    openclawService = {
      createInstance: jest.fn<any>().mockResolvedValue(INSTANCE_RESULT),
      deleteInstance: jest.fn<any>().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OpenClawHandler,
        { provide: DATABASE_CONNECTION, useValue: db },
        { provide: BotService, useValue: botService },
        { provide: OpenclawService, useValue: openclawService },
      ],
    }).compile();

    handler = module.get<OpenClawHandler>(OpenClawHandler);
  });

  // ── onInstall ──────────────────────────────────────────────────────────────

  describe('onInstall', () => {
    it('creates bot, instance, and returns config with secrets', async () => {
      const result = await handler.onInstall(makeContext());

      expect(botService.createWorkspaceBot).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerId: INSTALLED_BY,
          tenantId: TENANT_ID,
          displayName: 'OpenClaw Bot',
          installedApplicationId: INSTALLED_APP.id,
          generateToken: true,
          mentorId: INSTALLED_BY,
        }),
      );

      expect(openclawService.createInstance).toHaveBeenCalledWith(
        BOT_RESULT.bot.botId,
        BOT_RESULT.bot.botId,
        expect.objectContaining({
          TEAM9_TOKEN: BOT_RESULT.accessToken,
        }),
      );

      expect(result.config).toEqual({ instancesId: BOT_RESULT.bot.botId });
      expect(result.secrets).toEqual({ instanceResult: INSTANCE_RESULT });
      expect(result.botId).toBe(BOT_RESULT.bot.botId);
    });

    it('rolls back bot when createInstance fails', async () => {
      openclawService.createInstance.mockRejectedValueOnce(
        new Error('Instance creation timeout'),
      );

      await expect(handler.onInstall(makeContext())).rejects.toThrow(
        'Instance creation timeout',
      );

      expect(botService.deleteBotAndCleanup).toHaveBeenCalledWith(
        BOT_RESULT.bot.botId,
      );
    });

    it('re-throws original error even if bot cleanup fails', async () => {
      openclawService.createInstance.mockRejectedValueOnce(
        new Error('Instance creation timeout'),
      );
      botService.deleteBotAndCleanup.mockRejectedValueOnce(
        new Error('Cleanup failed'),
      );

      await expect(handler.onInstall(makeContext())).rejects.toThrow(
        'Instance creation timeout',
      );
    });
  });

  // ── onUninstall ────────────────────────────────────────────────────────────

  describe('onUninstall', () => {
    it('deletes OpenClaw instance and cleans up bots', async () => {
      const app = {
        id: 'installed-app-uuid',
        config: { instancesId: 'inst-123' },
      } as any;
      db.where.mockResolvedValueOnce([{ id: 'bot-1' }]);

      await handler.onUninstall(app);

      expect(openclawService.deleteInstance).toHaveBeenCalledWith('inst-123');
      expect(botService.deleteBotAndCleanup).toHaveBeenCalledWith('bot-1');
    });

    it('still cleans up bots if instance deletion fails', async () => {
      const app = {
        id: 'installed-app-uuid',
        config: { instancesId: 'inst-123' },
      } as any;
      db.where.mockResolvedValueOnce([{ id: 'bot-1' }]);
      openclawService.deleteInstance.mockRejectedValueOnce(
        new Error('Not found'),
      );

      await expect(handler.onUninstall(app)).resolves.not.toThrow();

      expect(botService.deleteBotAndCleanup).toHaveBeenCalledWith('bot-1');
    });

    it('skips instance deletion when config has no instancesId', async () => {
      const app = { id: 'installed-app-uuid', config: {} } as any;
      db.where.mockResolvedValueOnce([]);

      await handler.onUninstall(app);

      expect(openclawService.deleteInstance).not.toHaveBeenCalled();
    });

    it('is a no-op when no bots are found', async () => {
      const app = {
        id: 'installed-app-uuid',
        config: { instancesId: 'inst-123' },
      } as any;
      db.where.mockResolvedValueOnce([]);

      await handler.onUninstall(app);

      expect(openclawService.deleteInstance).toHaveBeenCalledWith('inst-123');
      expect(botService.deleteBotAndCleanup).not.toHaveBeenCalled();
    });
  });
});
