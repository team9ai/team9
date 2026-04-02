import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BotService } from './bot.service.js';
import { BotAuthCacheService } from './bot-auth-cache.service.js';
import { ChannelsService } from '../im/channels/channels.service.js';
import { DATABASE_CONNECTION } from '@team9/database';

// ── helpers ──────────────────────────────────────────────────────────

type MockFn = jest.Mock<(...args: any[]) => any>;

/** Build a minimal Drizzle-like mock that chains select→from→where→limit */
function mockChain() {
  const chain: Record<string, MockFn> = {};
  const methods = [
    'select',
    'from',
    'where',
    'limit',
    'insert',
    'values',
    'returning',
    'update',
    'set',
    'innerJoin',
    'delete',
  ];
  for (const m of methods) {
    chain[m] = jest.fn<any>().mockReturnValue(chain);
  }
  chain.limit.mockResolvedValue([]);
  chain.returning.mockResolvedValue([]);
  return chain;
}

function mockDb() {
  const chain = mockChain();
  // Transaction callback receives a separate chain so that call counts
  // inside the tx don't interfere with outer db calls.
  const txChain = mockChain();
  chain.transaction = jest.fn<any>((fn) => fn(txChain));
  (chain as any)._txChain = txChain;
  return chain;
}

type SystemBotEnvKey =
  | 'SYSTEM_BOT_EMAIL'
  | 'SYSTEM_BOT_USERNAME'
  | 'SYSTEM_BOT_PASSWORD'
  | 'SYSTEM_BOT_DISPLAY_NAME';

function snapshotSystemBotEnv(): Record<SystemBotEnvKey, string | undefined> {
  return {
    SYSTEM_BOT_EMAIL: process.env.SYSTEM_BOT_EMAIL,
    SYSTEM_BOT_USERNAME: process.env.SYSTEM_BOT_USERNAME,
    SYSTEM_BOT_PASSWORD: process.env.SYSTEM_BOT_PASSWORD,
    SYSTEM_BOT_DISPLAY_NAME: process.env.SYSTEM_BOT_DISPLAY_NAME,
  };
}

function restoreSystemBotEnv(
  snapshot: Record<SystemBotEnvKey, string | undefined>,
) {
  for (const key of Object.keys(snapshot) as SystemBotEnvKey[]) {
    const value = snapshot[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe('BotService', () => {
  let service: BotService;
  let db: ReturnType<typeof mockDb>;
  let channelsService: {
    createDirectChannel: MockFn;
    deleteDirectChannelsForUser: MockFn;
  };
  let eventEmitter: { emit: MockFn };
  let botAuthCache: {
    getOrSetValidation: MockFn;
    invalidateBot: MockFn;
  };

  beforeEach(async () => {
    db = mockDb();
    channelsService = {
      createDirectChannel: jest.fn<any>().mockResolvedValue({}),
      deleteDirectChannelsForUser: jest.fn<any>().mockResolvedValue(0),
    };
    eventEmitter = { emit: jest.fn<any>() };
    botAuthCache = {
      getOrSetValidation: jest.fn<any>(),
      invalidateBot: jest.fn<any>().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BotService,
        { provide: DATABASE_CONNECTION, useValue: db },
        { provide: ChannelsService, useValue: channelsService },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: BotAuthCacheService, useValue: botAuthCache },
      ],
    }).compile();

    service = module.get<BotService>(BotService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── createWorkspaceBot ────────────────────────────────────────────

  describe('createWorkspaceBot', () => {
    const ownerId = 'owner-uuid';
    const tenantId = 'tenant-uuid';

    it('should create a custom bot, add it to workspace, and create a DM channel', async () => {
      const ownerRow = { id: ownerId, username: 'alice' };
      const userRow = {
        id: 'bot-user-uuid',
        email: 'bot@team9.local',
        username: 'bot_abc_123',
        displayName: 'OpenClaw Bot',
      };
      const botRow = {
        id: 'bot-uuid',
        userId: 'bot-user-uuid',
        type: 'custom',
        ownerId,
        description: 'Auto-created bot for alice',
        capabilities: { canSendMessages: true, canReadMessages: true },
        isActive: true,
        webhookUrl: null,
      };

      // Owner lookup uses outer db chain
      let limitCallCount = 0;
      db.limit.mockImplementation((() => {
        limitCallCount++;
        if (limitCallCount === 1) return Promise.resolve([ownerRow]);
        return Promise.resolve([]);
      }) as any);

      // createBot inserts run inside transaction (txChain)
      const tx = (db as any)._txChain;
      let returningCallCount = 0;
      tx.returning.mockImplementation((() => {
        returningCallCount++;
        if (returningCallCount === 1) return Promise.resolve([userRow]);
        if (returningCallCount === 2) return Promise.resolve([botRow]);
        return Promise.resolve([{}]);
      }) as any);
      // tenantMembers insert uses outer db chain
      db.returning.mockResolvedValue([{}]);

      const result = await service.createWorkspaceBot({ ownerId, tenantId });

      expect(result.bot.userId).toBe('bot-user-uuid');
      expect(result.bot.botId).toBe('bot-uuid');
      expect(result.bot.type).toBe('custom');
      expect(result.bot.ownerId).toBe(ownerId);

      expect(db.insert).toHaveBeenCalled();
      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          userId: 'bot-user-uuid',
          role: 'member',
          invitedBy: ownerId,
        }),
      );

      expect(channelsService.createDirectChannel).toHaveBeenCalledWith(
        ownerId,
        'bot-user-uuid',
        tenantId,
      );

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'bot.created',
        expect.objectContaining({ userId: 'bot-user-uuid' }),
      );
    });

    it('should throw if owner is not found', async () => {
      db.limit.mockResolvedValue([] as any);

      await expect(
        service.createWorkspaceBot({ ownerId: 'nonexistent', tenantId }),
      ).rejects.toThrow('Owner nonexistent not found');
    });

    it('should not create DM channel if bot creation fails', async () => {
      const ownerRow = { id: ownerId, username: 'alice' };
      db.limit.mockResolvedValue([ownerRow] as any);

      // createBot inserts run inside transaction (txChain)
      const tx = (db as any)._txChain;
      let returningCallCount = 0;
      tx.returning.mockImplementation((() => {
        returningCallCount++;
        if (returningCallCount === 1) {
          return Promise.resolve([
            { id: 'u1', email: 'e', username: 'u', displayName: 'd' },
          ]);
        }
        return Promise.reject(new Error('DB constraint error'));
      }) as any);

      await expect(
        service.createWorkspaceBot({ ownerId, tenantId }),
      ).rejects.toThrow('DB constraint error');

      expect(channelsService.createDirectChannel).not.toHaveBeenCalled();
    });

    it('should link optional workspace metadata and generate a token when requested', async () => {
      const ownerRow = { id: ownerId, username: 'alice' };
      const userRow = {
        id: 'bot-user-uuid',
        email: 'bot@team9.local',
        username: 'bot_abc_123',
        displayName: 'Ops Bot',
      };
      const botRow = {
        id: 'bot-uuid',
        userId: 'bot-user-uuid',
        type: 'webhook',
        ownerId,
        description: 'Ops Bot for alice',
        capabilities: { canSendMessages: true, canReadMessages: true },
        isActive: true,
        webhookUrl: null,
        installedApplicationId: null,
        mentorId: null,
        managedProvider: null,
        managedMeta: null,
      };

      db.limit.mockResolvedValue([ownerRow] as any);

      const tx = (db as any)._txChain;
      let returningCallCount = 0;
      tx.returning.mockImplementation((() => {
        returningCallCount++;
        if (returningCallCount === 1) return Promise.resolve([userRow]);
        return Promise.resolve([botRow]);
      }) as any);

      const tokenSpy = jest
        .spyOn(service, 'generateAccessToken')
        .mockResolvedValue({
          botId: 'bot-uuid',
          userId: 'bot-user-uuid',
          accessToken: 't9bot_fake_token',
        });

      const result = await service.createWorkspaceBot({
        ownerId,
        tenantId,
        displayName: 'Ops Bot',
        username: 'bot_abc_123',
        type: 'webhook',
        installedApplicationId: 'app-123',
        generateToken: true,
        mentorId: 'mentor-123',
        managedProvider: 'openclaw',
        managedMeta: { agentId: 'agent-1' } as any,
      });

      expect(tokenSpy).toHaveBeenCalledWith('bot-uuid');
      expect(result.accessToken).toBe('t9bot_fake_token');
      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({
          installedApplicationId: 'app-123',
          mentorId: 'mentor-123',
          managedProvider: 'openclaw',
          managedMeta: { agentId: 'agent-1' },
          updatedAt: expect.any(Date),
        }),
      );
      expect(channelsService.createDirectChannel).toHaveBeenCalledWith(
        ownerId,
        'bot-user-uuid',
        tenantId,
      );
    });
  });

  describe('onModuleInit', () => {
    it('logs when the system bot is disabled', () => {
      const logSpy = jest
        .spyOn((service as any).logger, 'log')
        .mockImplementation(() => undefined);
      const previousEnabled = process.env.SYSTEM_BOT_ENABLED;
      process.env.SYSTEM_BOT_ENABLED = 'false';

      try {
        service.onModuleInit();
      } finally {
        if (previousEnabled === undefined) {
          delete process.env.SYSTEM_BOT_ENABLED;
        } else {
          process.env.SYSTEM_BOT_ENABLED = previousEnabled;
        }
      }

      expect(logSpy).toHaveBeenCalledWith(
        'System bot is disabled (SYSTEM_BOT_ENABLED != true)',
      );
    });
  });

  describe('initializeSystemBot', () => {
    it('warns and returns when required config is missing', async () => {
      const snapshot = snapshotSystemBotEnv();
      const warnSpy = jest
        .spyOn((service as any).logger, 'warn')
        .mockImplementation(() => undefined);

      delete process.env.SYSTEM_BOT_EMAIL;
      delete process.env.SYSTEM_BOT_USERNAME;
      delete process.env.SYSTEM_BOT_PASSWORD;
      delete process.env.SYSTEM_BOT_DISPLAY_NAME;

      try {
        await (service as any).initializeSystemBot();
      } finally {
        restoreSystemBotEnv(snapshot);
      }

      expect(warnSpy).toHaveBeenCalledWith(
        'System bot enabled but missing required config (SYSTEM_BOT_EMAIL, SYSTEM_BOT_USERNAME, SYSTEM_BOT_PASSWORD)',
      );
      expect(db.select).not.toHaveBeenCalled();
    });

    it('creates a new system bot when no existing user is found', async () => {
      const snapshot = snapshotSystemBotEnv();
      const createBotSpy = jest.spyOn(service, 'createBot').mockResolvedValue({
        userId: 'bot-user-1',
        botId: 'bot-1',
        username: 'system-bot',
        displayName: 'System Bot',
        email: 'system-bot@team9.local',
        type: 'system',
        ownerId: null,
        mentorId: null,
        description: 'System bot',
        capabilities: { canSendMessages: true, canReadMessages: true },
        extra: null,
        managedProvider: null,
        managedMeta: null,
        isActive: true,
      } as any);

      process.env.SYSTEM_BOT_EMAIL = 'system-bot@team9.local';
      process.env.SYSTEM_BOT_USERNAME = 'system-bot';
      process.env.SYSTEM_BOT_PASSWORD = 'secret';
      process.env.SYSTEM_BOT_DISPLAY_NAME = 'System Bot';

      db.limit.mockResolvedValueOnce([] as any);

      try {
        await (service as any).initializeSystemBot();
      } finally {
        restoreSystemBotEnv(snapshot);
      }

      expect(createBotSpy).toHaveBeenCalledWith({
        username: 'system-bot',
        displayName: 'System Bot',
        email: 'system-bot@team9.local',
        password: 'secret',
        type: 'system',
        description: 'System bot',
        capabilities: { canSendMessages: true, canReadMessages: true },
      });
      expect(service.getSystemBotUserId()).toBe('bot-user-1');
    });

    it('reuses an existing system bot user and inserts the missing bot row', async () => {
      const snapshot = snapshotSystemBotEnv();
      process.env.SYSTEM_BOT_EMAIL = 'system-bot@team9.local';
      process.env.SYSTEM_BOT_USERNAME = 'system-bot';
      process.env.SYSTEM_BOT_PASSWORD = 'secret';
      process.env.SYSTEM_BOT_DISPLAY_NAME = 'System Bot';

      db.limit
        .mockResolvedValueOnce([{ id: 'user-1' }] as any)
        .mockResolvedValueOnce([] as any);

      try {
        await (service as any).initializeSystemBot();
      } finally {
        restoreSystemBotEnv(snapshot);
      }

      expect(db.update).toHaveBeenCalled();
      expect(db.insert).toHaveBeenCalled();
      expect(service.getSystemBotUserId()).toBe('user-1');
    });
  });

  // ── createBot ─────────────────────────────────────────────────────

  describe('createBot', () => {
    it('should create user and bot records and emit event', async () => {
      const userRow = {
        id: 'u1',
        email: 'bot@team9.local',
        username: 'testbot',
        displayName: 'TestBot',
      };
      const botRow = {
        id: 'b1',
        userId: 'u1',
        type: 'custom',
        ownerId: null,
        description: 'desc',
        capabilities: { canSendMessages: true, canReadMessages: true },
        isActive: true,
      };

      const tx = (db as any)._txChain;
      let returningCallCount = 0;
      tx.returning.mockImplementation((() => {
        returningCallCount++;
        if (returningCallCount === 1) return Promise.resolve([userRow]);
        return Promise.resolve([botRow]);
      }) as any);

      const result = await service.createBot({
        username: 'testbot',
        displayName: 'TestBot',
        description: 'desc',
      });

      expect(result.userId).toBe('u1');
      expect(result.botId).toBe('b1');
      expect(result.type).toBe('custom');
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'bot.created',
        expect.objectContaining({ userId: 'u1', botId: 'b1' }),
      );
    });

    it('should roll back user insert and not emit event when bot insert fails', async () => {
      const userRow = {
        id: 'u1',
        email: 'bot@team9.local',
        username: 'testbot',
        displayName: 'TestBot',
      };

      const tx = (db as any)._txChain;
      let returningCallCount = 0;
      tx.returning.mockImplementation((() => {
        returningCallCount++;
        if (returningCallCount === 1) return Promise.resolve([userRow]);
        return Promise.reject(new Error('unique constraint violation'));
      }) as any);

      await expect(
        service.createBot({ username: 'testbot', displayName: 'TestBot' }),
      ).rejects.toThrow('unique constraint violation');

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('generateAccessToken', () => {
    it('should generate a fingerprinted token, invalidate cache, and persist the hash', async () => {
      db.limit.mockResolvedValue([{ id: 'bot-1', userId: 'user-1' }] as any);

      const result = await service.generateAccessToken('bot-1');

      expect(result).toMatchObject({
        botId: 'bot-1',
        userId: 'user-1',
        accessToken: expect.stringMatching(/^t9bot_[0-9a-f]{96}$/),
      });

      expect(botAuthCache.invalidateBot).toHaveBeenCalledWith('bot-1');
      const persisted = (db.set as any).mock.calls[0][0].accessToken as string;
      const fingerprint = result.accessToken.slice(6, 14);
      expect(persisted.startsWith(`${fingerprint}:`)).toBe(true);
      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({
          updatedAt: expect.any(Date),
        }),
      );
    });

    it('should throw when the bot does not exist', async () => {
      db.limit.mockResolvedValue([] as any);

      await expect(service.generateAccessToken('missing-bot')).rejects.toThrow(
        'Bot not found: missing-bot',
      );

      expect(botAuthCache.invalidateBot).not.toHaveBeenCalled();
    });
  });

  describe('validateAccessTokenWithContext', () => {
    it('returns null without consulting the cache for malformed tokens', async () => {
      await expect(
        service.validateAccessTokenWithContext('not-a-token'),
      ).resolves.toBeNull();

      expect(botAuthCache.getOrSetValidation).not.toHaveBeenCalled();
    });

    it('returns a resolved context from the cache for a valid token', async () => {
      const token = `t9bot_${'a'.repeat(96)}`;
      const findSpy = jest
        .spyOn(service as any, 'findValidatedAccessTokenMatch')
        .mockResolvedValue({
          botId: 'bot-1',
          userId: 'user-1',
          tenantId: 'tenant-1',
          authVersion: 3,
        });
      botAuthCache.getOrSetValidation.mockImplementation(
        async (_rawToken: string, resolve: () => Promise<any>) => resolve(),
      );

      await expect(
        service.validateAccessTokenWithContext(token),
      ).resolves.toEqual({
        context: {
          botId: 'bot-1',
          userId: 'user-1',
          tenantId: 'tenant-1',
        },
        version: 3,
      });

      expect(findSpy).toHaveBeenCalledWith(token);
      expect(botAuthCache.getOrSetValidation).toHaveBeenCalledWith(
        token,
        expect.any(Function),
      );
    });
  });

  describe('validateAccessToken', () => {
    it('returns null when no token match can be found', async () => {
      jest
        .spyOn(service as any, 'findValidatedAccessTokenMatch')
        .mockResolvedValue(null);

      await expect(
        service.validateAccessToken('t9bot_' + 'b'.repeat(96)),
      ).resolves.toBeNull();

      expect(db.limit).not.toHaveBeenCalled();
    });

    it('returns null when the matched bot user row is missing', async () => {
      jest
        .spyOn(service as any, 'findValidatedAccessTokenMatch')
        .mockResolvedValue({
          botId: 'bot-1',
          userId: 'user-1',
          tenantId: 'tenant-1',
          authVersion: 2,
        });
      db.limit.mockResolvedValueOnce([] as any);

      await expect(
        service.validateAccessToken('t9bot_' + 'c'.repeat(96)),
      ).resolves.toBeNull();
    });
  });

  // ── system bot helpers ────────────────────────────────────────────

  describe('system bot helpers', () => {
    it('getSystemBotUserId should return null when not initialized', () => {
      expect(service.getSystemBotUserId()).toBeNull();
    });

    it('isSystemBotEnabled should return false when not initialized', () => {
      expect(service.isSystemBotEnabled()).toBe(false);
    });

    it('getSystemBotUser and getSystemBotProfile should return null when not initialized', async () => {
      await expect(service.getSystemBotUser()).resolves.toBeNull();
      await expect(service.getSystemBotProfile()).resolves.toBeNull();
    });
  });

  // ── isBot ─────────────────────────────────────────────────────────

  describe('isBot', () => {
    it('should return true for bot user type', async () => {
      db.limit.mockResolvedValue([{ userType: 'bot' }] as any);
      expect(await service.isBot('some-id')).toBe(true);
    });

    it('should return false for human user type', async () => {
      db.limit.mockResolvedValue([{ userType: 'human' }] as any);
      expect(await service.isBot('some-id')).toBe(false);
    });

    it('should return false for unknown user', async () => {
      db.limit.mockResolvedValue([] as any);
      expect(await service.isBot('nonexistent')).toBe(false);
    });
  });

  // ── deleteBotAndCleanup ─────────────────────────────────────────────

  describe('deleteBotAndCleanup', () => {
    it('should delete DM channels, user, and emit event', async () => {
      // getBotById: limit returns bot row
      db.limit.mockResolvedValueOnce([
        { id: 'bot-1', userId: 'bot-user-1' },
      ] as any);

      await service.deleteBotAndCleanup('bot-1');

      expect(channelsService.deleteDirectChannelsForUser).toHaveBeenCalledWith(
        'bot-user-1',
      );
      expect(db.delete).toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'bot.deleted',
        expect.objectContaining({ botId: 'bot-1', userId: 'bot-user-1' }),
      );
    });

    it('should throw if bot is not found', async () => {
      db.limit.mockResolvedValueOnce([] as any);

      await expect(service.deleteBotAndCleanup('nonexistent')).rejects.toThrow(
        'Bot not found: nonexistent',
      );

      expect(
        channelsService.deleteDirectChannelsForUser,
      ).not.toHaveBeenCalled();
    });
  });

  describe('updateBotDisplayName', () => {
    it('throws when the target bot does not exist', async () => {
      jest.spyOn(service, 'getBotById').mockResolvedValueOnce(null);

      await expect(
        service.updateBotDisplayName('missing-bot', 'New Name'),
      ).rejects.toThrow('Bot not found: missing-bot');

      expect(db.update).not.toHaveBeenCalled();
    });
  });

  describe('revokeAccessToken', () => {
    it('invalidates the cache and clears the stored access token', async () => {
      await service.revokeAccessToken('bot-1');

      expect(botAuthCache.invalidateBot).toHaveBeenCalledWith('bot-1');
      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: null,
          updatedAt: expect.any(Date),
        }),
      );
    });
  });

  describe('updateWebhook', () => {
    it('should omit webhookHeaders when headers are not provided', async () => {
      await service.updateWebhook('bot-1', 'https://hooks.example.com');

      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({
          webhookUrl: 'https://hooks.example.com',
          updatedAt: expect.any(Date),
        }),
      );
      expect(db.set.mock.calls[0][0]).not.toHaveProperty('webhookHeaders');
    });

    it('should store an empty webhookHeaders object when null is provided', async () => {
      await service.updateWebhook('bot-1', 'https://hooks.example.com', null);

      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({
          webhookUrl: 'https://hooks.example.com',
          webhookHeaders: {},
          updatedAt: expect.any(Date),
        }),
      );
    });
  });
});
