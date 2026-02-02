import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BotService } from './bot.service.js';
import { ChannelsService } from '../im/channels/channels.service.js';
import { DATABASE_CONNECTION } from '@team9/database';

// ── helpers ──────────────────────────────────────────────────────────

type MockFn = jest.Mock<(...args: any[]) => any>;

/** Build a minimal Drizzle-like mock that chains select→from→where→limit */
function mockDb() {
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
  ];
  for (const m of methods) {
    chain[m] = jest.fn<any>().mockReturnValue(chain);
  }
  chain.limit.mockResolvedValue([]);
  chain.returning.mockResolvedValue([]);
  return chain;
}

describe('BotService', () => {
  let service: BotService;
  let db: ReturnType<typeof mockDb>;
  let channelsService: { createDirectChannel: MockFn };
  let eventEmitter: { emit: MockFn };

  beforeEach(async () => {
    db = mockDb();
    channelsService = {
      createDirectChannel: jest.fn<any>().mockResolvedValue({}),
    };
    eventEmitter = { emit: jest.fn<any>() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BotService,
        { provide: DATABASE_CONNECTION, useValue: db },
        { provide: ChannelsService, useValue: channelsService },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get<BotService>(BotService);
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

      let limitCallCount = 0;
      db.limit.mockImplementation((() => {
        limitCallCount++;
        if (limitCallCount === 1) return Promise.resolve([ownerRow]);
        return Promise.resolve([]);
      }) as any);

      let returningCallCount = 0;
      db.returning.mockImplementation((() => {
        returningCallCount++;
        if (returningCallCount === 1) return Promise.resolve([userRow]);
        if (returningCallCount === 2) return Promise.resolve([botRow]);
        return Promise.resolve([{}]);
      }) as any);

      const result = await service.createWorkspaceBot(ownerId, tenantId);

      expect(result.userId).toBe('bot-user-uuid');
      expect(result.botId).toBe('bot-uuid');
      expect(result.type).toBe('custom');
      expect(result.ownerId).toBe(ownerId);

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
        service.createWorkspaceBot('nonexistent', tenantId),
      ).rejects.toThrow('Owner nonexistent not found');
    });

    it('should not create DM channel if bot creation fails', async () => {
      const ownerRow = { id: ownerId, username: 'alice' };
      db.limit.mockResolvedValue([ownerRow] as any);

      let returningCallCount = 0;
      db.returning.mockImplementation((() => {
        returningCallCount++;
        if (returningCallCount === 1) {
          return Promise.resolve([
            { id: 'u1', email: 'e', username: 'u', displayName: 'd' },
          ]);
        }
        return Promise.reject(new Error('DB constraint error'));
      }) as any);

      await expect(
        service.createWorkspaceBot(ownerId, tenantId),
      ).rejects.toThrow('DB constraint error');

      expect(channelsService.createDirectChannel).not.toHaveBeenCalled();
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

      let returningCallCount = 0;
      db.returning.mockImplementation((() => {
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
  });

  // ── system bot helpers ────────────────────────────────────────────

  describe('system bot helpers', () => {
    it('getSystemBotUserId should return null when not initialized', () => {
      expect(service.getSystemBotUserId()).toBeNull();
    });

    it('isSystemBotEnabled should return false when not initialized', () => {
      expect(service.isSystemBotEnabled()).toBe(false);
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
});
