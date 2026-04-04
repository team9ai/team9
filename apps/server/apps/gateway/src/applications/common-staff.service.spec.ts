import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockStreamText = jest.fn<any>();

jest.unstable_mockModule('ai', () => ({
  streamText: mockStreamText,
  Output: { object: jest.fn().mockReturnValue('mock-output-spec') },
}));

const { CommonStaffService } = await import('./common-staff.service.js');
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { DATABASE_CONNECTION } from '@team9/database';
import { AiClientService } from '@team9/ai-client';
import { BotService } from '../bot/bot.service.js';
import { ClawHiveService } from '@team9/claw-hive';
import { ChannelsService } from '../im/channels/channels.service.js';
import { InstalledApplicationsService } from './installed-applications.service.js';
import type {
  CreateCommonStaffDto,
  UpdateCommonStaffDto,
} from './dto/common-staff.dto.js';
import type {
  GeneratePersonaDto,
  GenerateAvatarDto,
  GenerateCandidatesDto,
} from './dto/generate-persona.dto.js';

// ── helpers ──────────────────────────────────────────────────────────────────

type MockFn = jest.Mock<(...args: any[]) => any>;

/**
 * Minimal Drizzle chain mock.
 *
 * Each call to `where(...)` returns a fresh "terminal node" that:
 *   - is thenable (so `await db.select().from().where()` works)
 *   - exposes `.limit()` which resolves to the next queued limit result
 *
 * This allows both query patterns used in the service:
 *   - `await db.select().from().where()`          → where-terminal (dequeues from whereQueue)
 *   - `await db.select().from().where().limit(1)` → limit-terminal  (dequeues from limitQueue)
 *
 * Use `db.enqueue(value)` to schedule a result for the next where-terminal query.
 * Use `db.limit.mockResolvedValueOnce(value)` for limit-terminal queries.
 * Use `db.clearQueue()` to discard pending where-terminal queue entries.
 */
function mockDb() {
  const whereQueue: unknown[] = [];

  // Shared limit mock so tests can configure it with mockResolvedValueOnce
  const limitMock: MockFn = jest.fn<any>();
  limitMock.mockResolvedValue([]); // default

  /** Creates a thenable terminal node returned by .where() */
  function makeTerminalNode() {
    const node: {
      then: (
        resolve: (v: unknown) => unknown,
        reject?: (e: unknown) => unknown,
      ) => Promise<unknown>;
      limit: MockFn;
    } = {
      then(resolve, reject) {
        const value = whereQueue.length > 0 ? whereQueue.shift() : [];
        return Promise.resolve(value).then(resolve, reject);
      },
      limit: limitMock,
    };
    return node;
  }

  const chain: Record<string, MockFn> & {
    enqueue: (value: unknown) => void;
    clearQueue: () => void;
    limit: MockFn;
  } = {} as any;

  const methods = [
    'select',
    'from',
    'innerJoin',
    'leftJoin',
    'update',
    'set',
    'delete',
  ];
  for (const m of methods) {
    chain[m] = jest.fn<any>().mockReturnValue(chain);
  }

  // where() returns a fresh terminal node each call
  chain.where = jest.fn<any>().mockImplementation(() => makeTerminalNode());

  // Expose the shared limit mock so tests can configure it
  chain.limit = limitMock;

  // Helper to schedule a result for the next where-terminal query
  chain.enqueue = (value: unknown) => {
    whereQueue.push(value);
  };

  // Helper to discard all pending where-terminal queue entries
  chain.clearQueue = () => {
    whereQueue.length = 0;
  };

  return chain;
}

// ── fixtures ──────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-uuid-1234';
const OWNER_ID = 'user-uuid-owner';
const INSTALLED_APP_ID = 'installed-app-uuid';
const BOT_ID = 'bot-uuid-1234';
const BOT_USER_ID = 'bot-user-uuid-1234';
const AGENT_ID = `common-staff-${BOT_ID}`;

const makeInstalledApp = (applicationId = 'common-staff') => ({
  id: INSTALLED_APP_ID,
  applicationId,
  tenantId: TENANT_ID,
  installedBy: OWNER_ID,
  config: {},
  permissions: {},
  status: 'active' as const,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
});

const makeBotResult = () => ({
  bot: {
    botId: BOT_ID,
    userId: BOT_USER_ID,
    username: 'common-staff-bot',
    displayName: 'Test Staff',
    email: 'staff@team9.local',
    type: 'system',
    ownerId: OWNER_ID,
    mentorId: OWNER_ID,
    description: null,
    capabilities: null,
    extra: null,
    managedProvider: 'hive',
    managedMeta: { agentId: AGENT_ID },
    isActive: true,
  },
  accessToken: 'access-token-1234',
});

const makeCreateDto = (
  overrides: Partial<CreateCommonStaffDto> = {},
): CreateCommonStaffDto => ({
  displayName: 'Test Staff',
  model: { provider: 'anthropic', id: 'claude-3-5-sonnet-20241022' },
  roleTitle: 'Software Engineer',
  mentorId: OWNER_ID,
  persona: 'Helpful assistant',
  jobDescription: 'Writes code',
  ...overrides,
});

const makeUpdateDto = (
  overrides: Partial<UpdateCommonStaffDto> = {},
): UpdateCommonStaffDto => ({
  displayName: 'Updated Staff',
  ...overrides,
});

// ── tests ─────────────────────────────────────────────────────────────────────

/** Creates an async generator that yields the given strings */
async function* makeChunkGenerator(chunks: string[]): AsyncGenerator<string> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

/** Creates an async iterable that yields the given items */
function makeAsyncIterable<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          if (i < items.length) return { value: items[i++], done: false };
          return { value: undefined as any, done: true };
        },
      };
    },
  };
}

/** Builds a mock return value for streamText */
function mockStreamTextReturn(chunks: string[]) {
  return { textStream: makeAsyncIterable(chunks) };
}

/** Builds a mock return value for streamText with structured output */
function mockStreamTextWithOutputReturn(
  partials: unknown[],
  finalObj: unknown,
) {
  return {
    partialOutputStream: makeAsyncIterable(partials),
    output: Promise.resolve(finalObj),
  };
}

/** Creates an error-producing textStream that yields one chunk then throws */
function makeErrorTextStream(): AsyncIterable<string> {
  return {
    [Symbol.asyncIterator]() {
      let yielded = false;
      return {
        async next() {
          if (!yielded) {
            yielded = true;
            return { value: 'start', done: false };
          }
          throw new Error('AI provider error');
        },
      };
    },
  };
}

describe('CommonStaffService', () => {
  let service: CommonStaffService;
  let db: ReturnType<typeof mockDb>;
  let botService: {
    createWorkspaceBot: MockFn;
    getBotById: MockFn;
    getBotsByInstalledApplicationId: MockFn;
    updateBotExtra: MockFn;
    updateBotDisplayName: MockFn;
    updateBotMentor: MockFn;
    deleteBotAndCleanup: MockFn;
  };
  let clawHiveService: {
    registerAgent: MockFn;
    updateAgent: MockFn;
    deleteAgent: MockFn;
    sendInput: MockFn;
  };
  let channelsService: { createDirectChannelsBatch: MockFn };
  let installedApplicationsService: { findById: MockFn };
  let aiClientService: { chat: MockFn };

  beforeEach(async () => {
    db = mockDb();
    // Default: mentor membership check passes (limit(1) returns the mentor)
    db.limit.mockResolvedValue([{ userId: OWNER_ID }]);

    botService = {
      createWorkspaceBot: jest.fn<any>().mockResolvedValue(makeBotResult()),
      getBotById: jest.fn<any>().mockResolvedValue(makeBotResult().bot),
      getBotsByInstalledApplicationId: jest.fn<any>().mockResolvedValue([]),
      updateBotExtra: jest.fn<any>().mockResolvedValue(undefined),
      updateBotDisplayName: jest.fn<any>().mockResolvedValue(undefined),
      updateBotMentor: jest.fn<any>().mockResolvedValue(undefined),
      deleteBotAndCleanup: jest.fn<any>().mockResolvedValue(undefined),
    };

    clawHiveService = {
      registerAgent: jest.fn<any>().mockResolvedValue(undefined),
      updateAgent: jest.fn<any>().mockResolvedValue(undefined),
      deleteAgent: jest.fn<any>().mockResolvedValue(undefined),
      sendInput: jest.fn<any>().mockResolvedValue({ messages: [] }),
    };

    channelsService = {
      createDirectChannelsBatch: jest.fn<any>().mockResolvedValue(new Map()),
    };

    installedApplicationsService = {
      findById: jest.fn<any>().mockResolvedValue(makeInstalledApp()),
    };

    // Default: streamText returns text stream (for generatePersona)
    // Candidate tests override with mockStreamTextWithOutputReturn
    mockStreamText.mockReset();
    mockStreamText.mockReturnValue(mockStreamTextReturn(['Hello', ' world']));

    // aiClientService is still injected via DI (will be removed in Task 3)
    aiClientService = {
      chat: jest
        .fn<any>()
        .mockReturnValue(makeChunkGenerator(['Hello', ' world'])),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommonStaffService,
        { provide: DATABASE_CONNECTION, useValue: db },
        { provide: BotService, useValue: botService },
        { provide: ClawHiveService, useValue: clawHiveService },
        { provide: ChannelsService, useValue: channelsService },
        {
          provide: InstalledApplicationsService,
          useValue: installedApplicationsService,
        },
        { provide: AiClientService, useValue: aiClientService },
      ],
    }).compile();

    service = module.get<CommonStaffService>(CommonStaffService);
  });

  // ── createStaff ──────────────────────────────────────────────────────────────

  describe('createStaff', () => {
    it('creates bot with correct parameters', async () => {
      const dto = makeCreateDto();
      await service.createStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID, dto);

      expect(botService.createWorkspaceBot).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerId: OWNER_ID,
          tenantId: TENANT_ID,
          displayName: dto.displayName,
          type: 'system',
          installedApplicationId: INSTALLED_APP_ID,
          generateToken: true,
          mentorId: dto.mentorId,
          managedProvider: 'hive',
        }),
      );
    });

    it('sets managedMeta with agentId after bot creation', async () => {
      const dto = makeCreateDto();
      await service.createStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID, dto);

      expect(db.update).toHaveBeenCalled();
      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({
          managedMeta: { agentId: AGENT_ID },
        }),
      );
    });

    it('sets BotExtra.commonStaff with dto fields', async () => {
      const dto = makeCreateDto({
        roleTitle: 'Dev',
        persona: 'Expert',
        jobDescription: 'Codes',
      });
      await service.createStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID, dto);

      expect(botService.updateBotExtra).toHaveBeenCalledWith(
        BOT_ID,
        expect.objectContaining({
          commonStaff: expect.objectContaining({
            roleTitle: 'Dev',
            persona: 'Expert',
            jobDescription: 'Codes',
            model: dto.model,
          }),
        }),
      );
    });

    it('registers claw-hive agent with correct params', async () => {
      const dto = makeCreateDto();
      await service.createStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID, dto);

      expect(clawHiveService.registerAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          id: AGENT_ID,
          name: dto.displayName,
          tenantId: TENANT_ID,
          model: dto.model,
          metadata: expect.objectContaining({
            tenantId: TENANT_ID,
            botId: BOT_ID,
          }),
          componentConfigs: expect.objectContaining({
            'system-prompt': { prompt: 'You are a helpful AI assistant.' },
            team9: expect.objectContaining({
              team9AuthToken: 'access-token-1234',
              botUserId: BOT_USER_ID,
            }),
            'team9-staff-profile': {},
            'team9-staff-bootstrap': {},
            'team9-staff-soul': {},
          }),
        }),
      );
    });

    it('registers claw-hive agent without common-staff-agent component', async () => {
      const dto = makeCreateDto();
      await service.createStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID, dto);

      const call = clawHiveService.registerAgent.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      const configs = call['componentConfigs'] as Record<string, unknown>;
      expect(configs).not.toHaveProperty('common-staff-agent');
    });

    it('creates DM channels for workspace members', async () => {
      const memberIds = ['member-a', 'member-b'];
      // In createStaff, chain is awaited twice without .limit():
      //   1st: update bots.managedMeta (no-op result)
      //   2nd: members select → needs real member list
      db.enqueue([]); // update managedMeta result (ignored)
      db.enqueue(memberIds.map((userId) => ({ userId }))); // members select

      await service.createStaff(
        INSTALLED_APP_ID,
        TENANT_ID,
        OWNER_ID,
        makeCreateDto(),
      );

      expect(channelsService.createDirectChannelsBatch).toHaveBeenCalledWith(
        BOT_USER_ID,
        expect.arrayContaining(memberIds),
        TENANT_ID,
      );
    });

    it('skips DM creation when bot is the only member', async () => {
      // In createStaff, chain is awaited twice without .limit():
      //   1st: update bots.managedMeta (no-op result)
      //   2nd: members select → only the bot itself
      db.enqueue([]); // update managedMeta result (ignored)
      db.enqueue([{ userId: BOT_USER_ID }]); // members select → only bot

      await service.createStaff(
        INSTALLED_APP_ID,
        TENANT_ID,
        OWNER_ID,
        makeCreateDto(),
      );

      expect(channelsService.createDirectChannelsBatch).not.toHaveBeenCalled();
    });

    it('returns correct result object', async () => {
      const dto = makeCreateDto();
      const result = await service.createStaff(
        INSTALLED_APP_ID,
        TENANT_ID,
        OWNER_ID,
        dto,
      );

      expect(result).toEqual({
        botId: BOT_ID,
        userId: BOT_USER_ID,
        agentId: AGENT_ID,
        displayName: dto.displayName,
      });
    });

    it('updates avatarUrl when provided', async () => {
      const dto = makeCreateDto({
        avatarUrl: 'https://example.com/avatar.png',
      });
      await service.createStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID, dto);

      expect(db.update).toHaveBeenCalled();
      // The users table update for avatar
      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({
          avatarUrl: 'https://example.com/avatar.png',
        }),
      );
    });

    // ── agenticBootstrap ──────────────────────────────────────────────────────

    describe('agenticBootstrap', () => {
      const MENTOR_ID = OWNER_ID;
      const DM_CHANNEL_ID = 'dm-channel-uuid-1234';

      beforeEach(() => {
        // Mentor DM channel is in the result map
        channelsService.createDirectChannelsBatch.mockResolvedValue(
          new Map([[MENTOR_ID, { id: DM_CHANNEL_ID }]]),
        );
        // In createStaff, chain is awaited twice without .limit():
        //   1st: update bots.managedMeta (no-op result)
        //   2nd: members select (tenant members including mentor)
        db.enqueue([]); // update managedMeta result (ignored)
        db.enqueue([{ userId: MENTOR_ID }]); // members select result
      });

      it('triggers sendInput with bootstrap event using deterministic sessionId when agenticBootstrap=true', async () => {
        const dto = makeCreateDto({
          agenticBootstrap: true,
          mentorId: MENTOR_ID,
        });
        await service.createStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID, dto);

        const expectedSessionId = `team9/${TENANT_ID}/${AGENT_ID}/dm/${DM_CHANNEL_ID}`;
        expect(clawHiveService.sendInput).toHaveBeenCalledWith(
          expectedSessionId,
          expect.objectContaining({
            type: 'team9:bootstrap.start',
            source: 'team9',
            payload: {
              mentorId: MENTOR_ID,
              isMentorDm: true,
              channelId: DM_CHANNEL_ID,
            },
          }),
          TENANT_ID,
        );
      });

      it('does not trigger sendInput when agenticBootstrap=false', async () => {
        const dto = makeCreateDto({
          agenticBootstrap: false,
          mentorId: MENTOR_ID,
        });
        await service.createStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID, dto);

        expect(clawHiveService.sendInput).not.toHaveBeenCalled();
      });

      it('does not trigger sendInput when agenticBootstrap is not set', async () => {
        const dto = makeCreateDto({ mentorId: MENTOR_ID });
        await service.createStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID, dto);

        expect(clawHiveService.sendInput).not.toHaveBeenCalled();
      });

      it('falls back to ownerId when agenticBootstrap=true and mentorId is not set', async () => {
        const dto = makeCreateDto({
          agenticBootstrap: true,
          mentorId: undefined,
        });
        await service.createStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID, dto);

        // Should fall back to ownerId (OWNER_ID === MENTOR_ID in this context)
        const expectedSessionId = `team9/${TENANT_ID}/${AGENT_ID}/dm/${DM_CHANNEL_ID}`;
        expect(clawHiveService.sendInput).toHaveBeenCalledWith(
          expectedSessionId,
          expect.objectContaining({
            type: 'team9:bootstrap.start',
            source: 'team9',
            payload: {
              mentorId: OWNER_ID,
              isMentorDm: true,
              channelId: DM_CHANNEL_ID,
            },
          }),
          TENANT_ID,
        );
      });

      it('skips bootstrap and warns when mentor has no DM channel', async () => {
        // Return empty map — no DM for mentor
        channelsService.createDirectChannelsBatch.mockResolvedValueOnce(
          new Map(),
        );

        const dto = makeCreateDto({
          agenticBootstrap: true,
          mentorId: MENTOR_ID,
        });
        // Should not throw
        await expect(
          service.createStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID, dto),
        ).resolves.toBeDefined();

        expect(clawHiveService.sendInput).not.toHaveBeenCalled();
      });

      it('does not fail entire creation when sendInput throws', async () => {
        clawHiveService.sendInput.mockRejectedValueOnce(
          new Error('Session service unavailable'),
        );

        const dto = makeCreateDto({
          agenticBootstrap: true,
          mentorId: MENTOR_ID,
        });
        // Should resolve successfully (bootstrap failure is non-fatal)
        await expect(
          service.createStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID, dto),
        ).resolves.toBeDefined();
      });

      it('auto-generates displayName as "Candidate #N" when agenticBootstrap=true and displayName missing', async () => {
        // 2 existing bots → next candidate is #3
        botService.getBotsByInstalledApplicationId.mockResolvedValueOnce([
          { botId: 'existing-1' },
          { botId: 'existing-2' },
        ]);

        const dto: CreateCommonStaffDto = {
          displayName: '',
          model: { provider: 'anthropic', id: 'claude-3-5-sonnet-20241022' },
          mentorId: MENTOR_ID,
          agenticBootstrap: true,
        };

        await service.createStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID, dto);

        expect(botService.createWorkspaceBot).toHaveBeenCalledWith(
          expect.objectContaining({ displayName: 'Candidate #3' }),
        );
      });

      it('auto-generates "Candidate #1" when no existing bots', async () => {
        botService.getBotsByInstalledApplicationId.mockResolvedValueOnce([]);

        const dto: CreateCommonStaffDto = {
          displayName: '',
          model: { provider: 'anthropic', id: 'claude-3-5-sonnet-20241022' },
          mentorId: MENTOR_ID,
          agenticBootstrap: true,
        };

        await service.createStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID, dto);

        expect(botService.createWorkspaceBot).toHaveBeenCalledWith(
          expect.objectContaining({ displayName: 'Candidate #1' }),
        );
      });

      it('preserves provided displayName even when agenticBootstrap=true', async () => {
        const dto = makeCreateDto({
          agenticBootstrap: true,
          displayName: 'Alice',
          mentorId: MENTOR_ID,
        });

        await service.createStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID, dto);

        expect(
          botService.getBotsByInstalledApplicationId,
        ).not.toHaveBeenCalled();
        expect(botService.createWorkspaceBot).toHaveBeenCalledWith(
          expect.objectContaining({ displayName: 'Alice' }),
        );
      });
    });

    it('throws BadRequestException when mentorId is not a workspace member', async () => {
      // Mentor validation uses db.limit(1) — return empty to simulate non-member
      db.limit.mockResolvedValueOnce([]);

      await expect(
        service.createStaff(
          INSTALLED_APP_ID,
          TENANT_ID,
          OWNER_ID,
          makeCreateDto({ mentorId: 'non-member-user' }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('passes when mentorId is a valid workspace member', async () => {
      // db.limit default already returns [{ userId: OWNER_ID }] from beforeEach
      await expect(
        service.createStaff(
          INSTALLED_APP_ID,
          TENANT_ID,
          OWNER_ID,
          makeCreateDto(),
        ),
      ).resolves.toBeDefined();
    });

    it('throws NotFoundException when installed application is not found', async () => {
      installedApplicationsService.findById.mockResolvedValueOnce(null);

      await expect(
        service.createStaff(
          INSTALLED_APP_ID,
          TENANT_ID,
          OWNER_ID,
          makeCreateDto(),
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when application is not common-staff type', async () => {
      installedApplicationsService.findById.mockResolvedValueOnce(
        makeInstalledApp('openclaw'),
      );

      await expect(
        service.createStaff(
          INSTALLED_APP_ID,
          TENANT_ID,
          OWNER_ID,
          makeCreateDto(),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rolls back bot if registration fails', async () => {
      clawHiveService.registerAgent.mockRejectedValueOnce(
        new Error('Hive unavailable'),
      );

      await expect(
        service.createStaff(
          INSTALLED_APP_ID,
          TENANT_ID,
          OWNER_ID,
          makeCreateDto(),
        ),
      ).rejects.toThrow('Hive unavailable');

      expect(botService.deleteBotAndCleanup).toHaveBeenCalledWith(BOT_ID);
    });

    it('still throws if rollback cleanup also fails', async () => {
      clawHiveService.registerAgent.mockRejectedValueOnce(
        new Error('Hive unavailable'),
      );
      botService.deleteBotAndCleanup.mockRejectedValueOnce(
        new Error('Cleanup failed'),
      );

      // Still throws original error
      await expect(
        service.createStaff(
          INSTALLED_APP_ID,
          TENANT_ID,
          OWNER_ID,
          makeCreateDto(),
        ),
      ).rejects.toThrow('Hive unavailable');
    });
  });

  // ── updateStaff ──────────────────────────────────────────────────────────────

  describe('updateStaff', () => {
    beforeEach(() => {
      // Default: bot belongs to the installed application
      // (bot ownership check is the first/only `await chain` call in updateStaff)
      db.enqueue([{ installedApplicationId: INSTALLED_APP_ID }]);
    });

    it('updates bot display name when provided', async () => {
      const dto = makeUpdateDto({ displayName: 'New Name' });
      await service.updateStaff(INSTALLED_APP_ID, TENANT_ID, BOT_ID, dto);

      expect(botService.updateBotDisplayName).toHaveBeenCalledWith(
        BOT_ID,
        'New Name',
      );
    });

    it('does not update display name when not provided', async () => {
      const dto = makeUpdateDto({ displayName: undefined });
      await service.updateStaff(INSTALLED_APP_ID, TENANT_ID, BOT_ID, dto);

      expect(botService.updateBotDisplayName).not.toHaveBeenCalled();
    });

    it('updates mentor when mentorId is provided', async () => {
      const dto = makeUpdateDto({ mentorId: 'new-mentor-id' });
      await service.updateStaff(INSTALLED_APP_ID, TENANT_ID, BOT_ID, dto);

      expect(botService.updateBotMentor).toHaveBeenCalledWith(
        BOT_ID,
        'new-mentor-id',
      );
    });

    it('throws BadRequestException when updated mentorId is not a workspace member', async () => {
      // Mentor validation uses db.limit(1) — return empty to simulate non-member
      db.limit.mockResolvedValueOnce([]);

      const dto = makeUpdateDto({ mentorId: 'non-member-user' });
      await expect(
        service.updateStaff(INSTALLED_APP_ID, TENANT_ID, BOT_ID, dto),
      ).rejects.toThrow(BadRequestException);
    });

    it('skips mentor validation when mentorId is empty string (clearing mentor)', async () => {
      const dto = makeUpdateDto({ mentorId: '' });
      await service.updateStaff(INSTALLED_APP_ID, TENANT_ID, BOT_ID, dto);

      // Mentor cleared — no validation needed, sets to null
      expect(botService.updateBotMentor).toHaveBeenCalledWith(BOT_ID, null);
    });

    it('sets mentor to null when mentorId is empty string', async () => {
      const dto = makeUpdateDto({ mentorId: '' });
      await service.updateStaff(INSTALLED_APP_ID, TENANT_ID, BOT_ID, dto);

      expect(botService.updateBotMentor).toHaveBeenCalledWith(BOT_ID, null);
    });

    it('does not update mentor when mentorId not in dto', async () => {
      const dto: UpdateCommonStaffDto = {};
      await service.updateStaff(INSTALLED_APP_ID, TENANT_ID, BOT_ID, dto);

      expect(botService.updateBotMentor).not.toHaveBeenCalled();
    });

    it('merges BotExtra.commonStaff with existing values', async () => {
      const existingBot = {
        ...makeBotResult().bot,
        extra: {
          commonStaff: {
            roleTitle: 'Old Role',
            persona: 'Old Persona',
          },
        },
      };
      botService.getBotById.mockResolvedValueOnce(existingBot); // first call for verification

      const dto = makeUpdateDto({ roleTitle: 'New Role' });
      await service.updateStaff(INSTALLED_APP_ID, TENANT_ID, BOT_ID, dto);

      expect(botService.updateBotExtra).toHaveBeenCalledWith(
        BOT_ID,
        expect.objectContaining({
          commonStaff: expect.objectContaining({
            roleTitle: 'New Role',
            persona: 'Old Persona', // preserved
          }),
        }),
      );
    });

    it('syncs to claw-hive after update', async () => {
      const dto = makeUpdateDto({
        displayName: 'New Name',
        model: { provider: 'openai', id: 'gpt-4o' },
      });
      await service.updateStaff(INSTALLED_APP_ID, TENANT_ID, BOT_ID, dto);

      expect(clawHiveService.updateAgent).toHaveBeenCalledWith(
        AGENT_ID,
        expect.objectContaining({
          tenantId: TENANT_ID,
          name: 'New Name',
          model: { provider: 'openai', id: 'gpt-4o' },
        }),
      );
    });

    it('does not pass componentConfigs to updateAgent', async () => {
      const dto = makeUpdateDto({
        roleTitle: 'New Role',
        persona: 'New Persona',
        jobDescription: 'New Desc',
      });
      await service.updateStaff(INSTALLED_APP_ID, TENANT_ID, BOT_ID, dto);

      const call = clawHiveService.updateAgent.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(call).not.toHaveProperty('componentConfigs');
    });

    it('does not pass common-staff-agent componentConfig to updateAgent', async () => {
      const dto = makeUpdateDto({ displayName: 'New Name' });
      await service.updateStaff(INSTALLED_APP_ID, TENANT_ID, BOT_ID, dto);

      const call = clawHiveService.updateAgent.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      const configs = call['componentConfigs'] as
        | Record<string, unknown>
        | undefined;
      expect(configs?.['common-staff-agent']).toBeUndefined();
    });

    it('throws NotFoundException when installed application is not found', async () => {
      installedApplicationsService.findById.mockResolvedValueOnce(null);

      await expect(
        service.updateStaff(
          INSTALLED_APP_ID,
          TENANT_ID,
          BOT_ID,
          makeUpdateDto(),
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when application is not common-staff type', async () => {
      installedApplicationsService.findById.mockResolvedValueOnce(
        makeInstalledApp('openclaw'),
      );

      await expect(
        service.updateStaff(
          INSTALLED_APP_ID,
          TENANT_ID,
          BOT_ID,
          makeUpdateDto(),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when bot is not found', async () => {
      botService.getBotById.mockResolvedValueOnce(null);

      await expect(
        service.updateStaff(
          INSTALLED_APP_ID,
          TENANT_ID,
          BOT_ID,
          makeUpdateDto(),
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when bot does not belong to this installed application', async () => {
      // Override the beforeEach default: bot ownership check returns empty
      db.clearQueue();
      db.enqueue([]); // empty means no matching record

      await expect(
        service.updateStaff(
          INSTALLED_APP_ID,
          TENANT_ID,
          BOT_ID,
          makeUpdateDto(),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('updates avatarUrl when provided', async () => {
      const dto = makeUpdateDto({
        avatarUrl: 'https://example.com/new-avatar.png',
      });
      await service.updateStaff(INSTALLED_APP_ID, TENANT_ID, BOT_ID, dto);

      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({
          avatarUrl: 'https://example.com/new-avatar.png',
        }),
      );
    });
  });

  // ── deleteStaff ──────────────────────────────────────────────────────────────

  describe('deleteStaff', () => {
    beforeEach(() => {
      // Default: bot belongs to the installed application
      // (bot ownership check is the only `await chain` call in deleteStaff)
      db.enqueue([{ installedApplicationId: INSTALLED_APP_ID }]);
    });

    it('deletes claw-hive agent before bot', async () => {
      const deleteOrder: string[] = [];
      clawHiveService.deleteAgent.mockImplementation(async () => {
        deleteOrder.push('agent');
      });
      botService.deleteBotAndCleanup.mockImplementation(async () => {
        deleteOrder.push('bot');
      });

      await service.deleteStaff(INSTALLED_APP_ID, TENANT_ID, BOT_ID);

      expect(deleteOrder).toEqual(['agent', 'bot']);
    });

    it('calls deleteAgent with correct agentId', async () => {
      await service.deleteStaff(INSTALLED_APP_ID, TENANT_ID, BOT_ID);

      expect(clawHiveService.deleteAgent).toHaveBeenCalledWith(AGENT_ID);
    });

    it('calls deleteBotAndCleanup with correct botId', async () => {
      await service.deleteStaff(INSTALLED_APP_ID, TENANT_ID, BOT_ID);

      expect(botService.deleteBotAndCleanup).toHaveBeenCalledWith(BOT_ID);
    });

    it('still deletes bot even if claw-hive deletion fails', async () => {
      clawHiveService.deleteAgent.mockRejectedValueOnce(
        new Error('Agent not found'),
      );

      await expect(
        service.deleteStaff(INSTALLED_APP_ID, TENANT_ID, BOT_ID),
      ).resolves.not.toThrow();

      expect(botService.deleteBotAndCleanup).toHaveBeenCalledWith(BOT_ID);
    });

    it('throws NotFoundException when installed application is not found', async () => {
      installedApplicationsService.findById.mockResolvedValueOnce(null);

      await expect(
        service.deleteStaff(INSTALLED_APP_ID, TENANT_ID, BOT_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when application is not common-staff type', async () => {
      installedApplicationsService.findById.mockResolvedValueOnce(
        makeInstalledApp('base-model-staff'),
      );

      await expect(
        service.deleteStaff(INSTALLED_APP_ID, TENANT_ID, BOT_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when bot is not found', async () => {
      botService.getBotById.mockResolvedValueOnce(null);

      await expect(
        service.deleteStaff(INSTALLED_APP_ID, TENANT_ID, BOT_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when bot does not belong to this installed application', async () => {
      // Override the beforeEach default: bot ownership check returns empty
      db.clearQueue();
      db.enqueue([]); // empty means no matching record

      await expect(
        service.deleteStaff(INSTALLED_APP_ID, TENANT_ID, BOT_ID),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── generatePersona ──────────────────────────────────────────────────────────

  describe('generatePersona', () => {
    const makePersonaDto = (
      overrides: Partial<GeneratePersonaDto> = {},
    ): GeneratePersonaDto => ({
      displayName: 'Alex',
      roleTitle: 'Senior Engineer',
      ...overrides,
    });

    it('yields chunks from the AI stream', async () => {
      mockStreamText.mockReturnValueOnce(
        mockStreamTextReturn(['chunk1', 'chunk2', 'chunk3']),
      );

      const chunks: string[] = [];
      for await (const chunk of service.generatePersona(
        INSTALLED_APP_ID,
        TENANT_ID,
        makePersonaDto(),
      )) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['chunk1', 'chunk2', 'chunk3']);
    });

    it('calls streamText with correct parameters', async () => {
      for await (const _ of service.generatePersona(
        INSTALLED_APP_ID,
        TENANT_ID,
        makePersonaDto(),
      )) {
        // consume
      }

      expect(mockStreamText).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.9,
          maxTokens: 1024,
        }),
      );
    });

    it('passes displayName and roleTitle in the user message', async () => {
      for await (const _ of service.generatePersona(
        INSTALLED_APP_ID,
        TENANT_ID,
        makePersonaDto({ displayName: 'Jordan', roleTitle: 'Product Manager' }),
      )) {
        // consume
      }

      const callArg = mockStreamText.mock.calls[0][0] as {
        system: string;
        messages: { role: string; content: string }[];
      };
      const userMessage = callArg.messages.find((m) => m.role === 'user');
      expect(userMessage?.content).toContain('Jordan');
      expect(userMessage?.content).toContain('Product Manager');
    });

    it('includes existingPersona in the user message when provided', async () => {
      const existingPersona = 'Thoughtful and methodical thinker.';

      for await (const _ of service.generatePersona(
        INSTALLED_APP_ID,
        TENANT_ID,
        makePersonaDto({ existingPersona }),
      )) {
        // consume
      }

      const callArg = mockStreamText.mock.calls[0][0] as {
        system: string;
        messages: { role: string; content: string }[];
      };
      const userMessage = callArg.messages.find((m) => m.role === 'user');
      expect(userMessage?.content).toContain(existingPersona);
    });

    it('instructs AI to expand existing persona, not regenerate', async () => {
      for await (const _ of service.generatePersona(
        INSTALLED_APP_ID,
        TENANT_ID,
        makePersonaDto({ existingPersona: 'Sharp and decisive.' }),
      )) {
        // consume
      }

      const callArg = mockStreamText.mock.calls[0][0] as {
        system: string;
        messages: { role: string; content: string }[];
      };
      const userMessage = callArg.messages.find((m) => m.role === 'user');
      // Should tell LLM to expand, not regenerate
      expect(userMessage?.content.toLowerCase()).toMatch(/expand|refine/);
    });

    it('includes user prompt in the message when provided', async () => {
      const userPrompt = 'Make the persona more formal and authoritative.';

      for await (const _ of service.generatePersona(
        INSTALLED_APP_ID,
        TENANT_ID,
        makePersonaDto({ prompt: userPrompt }),
      )) {
        // consume
      }

      const callArg = mockStreamText.mock.calls[0][0] as {
        system: string;
        messages: { role: string; content: string }[];
      };
      const userMessage = callArg.messages.find((m) => m.role === 'user');
      expect(userMessage?.content).toContain(userPrompt);
    });

    it('includes jobDescription in the user message when provided', async () => {
      for await (const _ of service.generatePersona(
        INSTALLED_APP_ID,
        TENANT_ID,
        makePersonaDto({ jobDescription: 'Builds distributed systems' }),
      )) {
        // consume
      }

      const callArg = mockStreamText.mock.calls[0][0] as {
        system: string;
        messages: { role: string; content: string }[];
      };
      const userMessage = callArg.messages.find((m) => m.role === 'user');
      expect(userMessage?.content).toContain('Builds distributed systems');
    });

    it('works with all optional fields omitted', async () => {
      for await (const _ of service.generatePersona(
        INSTALLED_APP_ID,
        TENANT_ID,
        {},
      )) {
        // consume
      }

      expect(mockStreamText).toHaveBeenCalledTimes(1);
    });

    it('propagates errors from the AI stream', async () => {
      mockStreamText.mockReturnValueOnce({
        textStream: makeErrorTextStream(),
      });

      const gen = service.generatePersona(
        INSTALLED_APP_ID,
        TENANT_ID,
        makePersonaDto(),
      );

      // First chunk should succeed
      const first = await gen.next();
      expect(first.value).toBe('start');

      // Second iteration should throw
      await expect(gen.next()).rejects.toThrow('AI provider error');
    });

    it('uses OpenRouter model via streamText', async () => {
      for await (const _ of service.generatePersona(
        INSTALLED_APP_ID,
        TENANT_ID,
        makePersonaDto(),
      )) {
        // consume
      }

      expect(mockStreamText).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.9,
          maxTokens: 1024,
        }),
      );
      const callArg = mockStreamText.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(callArg.model).toBeDefined();
    });

    it('yields empty stream when AI returns no chunks', async () => {
      mockStreamText.mockReturnValueOnce(mockStreamTextReturn([]));

      const chunks: string[] = [];
      for await (const chunk of service.generatePersona(
        INSTALLED_APP_ID,
        TENANT_ID,
        makePersonaDto(),
      )) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(0);
    });

    it('verifies app before generating (calls installedApplicationsService.findById)', async () => {
      for await (const _ of service.generatePersona(
        INSTALLED_APP_ID,
        TENANT_ID,
        makePersonaDto(),
      )) {
        // consume
      }

      expect(installedApplicationsService.findById).toHaveBeenCalledWith(
        INSTALLED_APP_ID,
        TENANT_ID,
      );
    });

    it('throws BadRequestException when application is not common-staff type', async () => {
      installedApplicationsService.findById.mockResolvedValueOnce(
        makeInstalledApp('openclaw'),
      );

      const gen = service.generatePersona(
        INSTALLED_APP_ID,
        TENANT_ID,
        makePersonaDto(),
      );

      await expect(gen.next()).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when application is not found', async () => {
      installedApplicationsService.findById.mockResolvedValueOnce(null);

      const gen = service.generatePersona(
        INSTALLED_APP_ID,
        TENANT_ID,
        makePersonaDto(),
      );

      await expect(gen.next()).rejects.toThrow(BadRequestException);
    });
  });

  // ── generateAvatar ────────────────────────────────────────────────────────────

  describe('generateAvatar', () => {
    const makeAvatarDto = (
      overrides: Partial<GenerateAvatarDto> = {},
    ): GenerateAvatarDto => ({
      style: 'realistic',
      displayName: 'Alex',
      ...overrides,
    });

    it('returns an avatarUrl string', async () => {
      const result = await service.generateAvatar(
        INSTALLED_APP_ID,
        TENANT_ID,
        makeAvatarDto(),
      );

      expect(result).toHaveProperty('avatarUrl');
      expect(typeof result.avatarUrl).toBe('string');
    });

    it('encodes displayName in the placeholder URL', async () => {
      const result = await service.generateAvatar(
        INSTALLED_APP_ID,
        TENANT_ID,
        makeAvatarDto({ displayName: 'Hello World' }),
      );

      expect(result.avatarUrl).toContain(encodeURIComponent('Hello World'));
    });

    it('falls back to "staff" seed when displayName is not provided', async () => {
      const result = await service.generateAvatar(
        INSTALLED_APP_ID,
        TENANT_ID,
        makeAvatarDto({ displayName: undefined }),
      );

      expect(result.avatarUrl).toContain('staff');
    });

    it('throws BadRequestException when application is not common-staff type', async () => {
      installedApplicationsService.findById.mockResolvedValueOnce(
        makeInstalledApp('openclaw'),
      );

      await expect(
        service.generateAvatar(INSTALLED_APP_ID, TENANT_ID, makeAvatarDto()),
      ).rejects.toThrow(BadRequestException);
    });

    it('verifies app before generating (calls installedApplicationsService.findById)', async () => {
      await service.generateAvatar(
        INSTALLED_APP_ID,
        TENANT_ID,
        makeAvatarDto(),
      );

      expect(installedApplicationsService.findById).toHaveBeenCalledWith(
        INSTALLED_APP_ID,
        TENANT_ID,
      );
    });

    it.each([
      ['realistic', 'realistic'],
      ['cartoon', 'cartoon'],
      ['anime', 'anime'],
      ['notion-lineart', 'notion-lineart'],
    ] as const)('accepts style "%s" without throwing', async (style) => {
      await expect(
        service.generateAvatar(
          INSTALLED_APP_ID,
          TENANT_ID,
          makeAvatarDto({ style }),
        ),
      ).resolves.toHaveProperty('avatarUrl');
    });
  });

  // ── generateCandidates ────────────────────────────────────────────────────────

  describe('generateCandidates', () => {
    const makeCandidatesDto = (
      overrides: Partial<GenerateCandidatesDto> = {},
    ): GenerateCandidatesDto => ({
      jobTitle: 'Software Engineer',
      jobDescription: 'Write and review code',
      ...overrides,
    });

    it('yields partial and complete events from streamObject', async () => {
      const partials = [
        { candidates: [{ candidateIndex: 1, displayName: 'Alice' }] },
        {
          candidates: [
            {
              candidateIndex: 1,
              displayName: 'Alice',
              roleTitle: 'Backend Engineer',
              persona: 'Detail-oriented',
              summary: 'Alice builds reliable systems.',
            },
            { candidateIndex: 2, displayName: 'Bob' },
          ],
        },
      ];
      const final = {
        candidates: [
          {
            candidateIndex: 1,
            displayName: 'Alice',
            roleTitle: 'Backend Engineer',
            persona: 'Detail-oriented',
            summary: 'Alice builds reliable systems.',
          },
          {
            candidateIndex: 2,
            displayName: 'Bob',
            roleTitle: 'Frontend Engineer',
            persona: 'Creative',
            summary: 'Bob crafts UIs.',
          },
          {
            candidateIndex: 3,
            displayName: 'Carol',
            roleTitle: 'DevOps Engineer',
            persona: 'Pragmatic',
            summary: 'Carol keeps systems running.',
          },
        ],
      };

      mockStreamText.mockReturnValueOnce(
        mockStreamTextWithOutputReturn(partials, final),
      );

      const events: { type: string; data: unknown }[] = [];
      for await (const event of service.generateCandidates(
        INSTALLED_APP_ID,
        TENANT_ID,
        makeCandidatesDto(),
      )) {
        events.push(event);
      }

      const partialEvents = events.filter((e) => e.type === 'partial');
      expect(partialEvents).toHaveLength(2);

      const completeEvents = events.filter((e) => e.type === 'complete');
      expect(completeEvents).toHaveLength(1);
      expect(
        (completeEvents[0].data as { candidates: unknown[] }).candidates,
      ).toHaveLength(3);
    });

    it('throws BadRequestException when application is not common-staff type', async () => {
      installedApplicationsService.findById.mockResolvedValueOnce(
        makeInstalledApp('openclaw'),
      );

      const gen = service.generateCandidates(
        INSTALLED_APP_ID,
        TENANT_ID,
        makeCandidatesDto(),
      );

      await expect(gen.next()).rejects.toThrow(BadRequestException);
    });

    it('calls streamObject with temperature and schema', async () => {
      mockStreamText.mockReturnValueOnce(
        mockStreamTextWithOutputReturn([], { candidates: [] }),
      );

      for await (const _ of service.generateCandidates(
        INSTALLED_APP_ID,
        TENANT_ID,
        makeCandidatesDto(),
      )) {
        // consume
      }

      expect(mockStreamText).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.95,
          output: expect.anything(),
        }),
      );
    });

    it('includes jobTitle and jobDescription in the prompt', async () => {
      mockStreamText.mockReturnValueOnce(
        mockStreamTextWithOutputReturn([], { candidates: [] }),
      );

      for await (const _ of service.generateCandidates(
        INSTALLED_APP_ID,
        TENANT_ID,
        makeCandidatesDto({
          jobTitle: 'Data Scientist',
          jobDescription: 'Build ML models',
        }),
      )) {
        // consume
      }

      const callArg = mockStreamText.mock.calls[0][0] as {
        prompt: string;
      };
      expect(callArg.prompt).toContain('Data Scientist');
      expect(callArg.prompt).toContain('Build ML models');
    });

    it('uses default prompt when no job info provided', async () => {
      mockStreamText.mockReturnValueOnce(
        mockStreamTextWithOutputReturn([], { candidates: [] }),
      );

      for await (const _ of service.generateCandidates(
        INSTALLED_APP_ID,
        TENANT_ID,
        {},
      )) {
        // consume
      }

      const callArg = mockStreamText.mock.calls[0][0] as {
        prompt: string;
      };
      expect(callArg.prompt).toBeTruthy();
    });

    it('yields only complete event when no partials emitted', async () => {
      mockStreamText.mockReturnValueOnce(
        mockStreamTextWithOutputReturn([], { candidates: [] }),
      );

      const events: { type: string; data: unknown }[] = [];
      for await (const event of service.generateCandidates(
        INSTALLED_APP_ID,
        TENANT_ID,
        makeCandidatesDto(),
      )) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('complete');
    });

    it('verifies app before generating', async () => {
      mockStreamText.mockReturnValueOnce(
        mockStreamTextWithOutputReturn([], { candidates: [] }),
      );

      for await (const _ of service.generateCandidates(
        INSTALLED_APP_ID,
        TENANT_ID,
        makeCandidatesDto(),
      )) {
        // consume
      }

      expect(installedApplicationsService.findById).toHaveBeenCalledWith(
        INSTALLED_APP_ID,
        TENANT_ID,
      );
    });

    it('propagates errors from the partial output stream', async () => {
      function makeErrorOutputStream(): AsyncIterable<unknown> {
        return {
          [Symbol.asyncIterator]() {
            let yielded = false;
            return {
              async next() {
                if (!yielded) {
                  yielded = true;
                  return {
                    value: { candidates: [{ candidateIndex: 1 }] },
                    done: false,
                  };
                }
                throw new Error('Stream error');
              },
            };
          },
        };
      }
      mockStreamText.mockReturnValueOnce({
        partialOutputStream: makeErrorOutputStream(),
        output: Promise.reject(new Error('Stream error')).catch(() => {}),
      });

      const gen = service.generateCandidates(
        INSTALLED_APP_ID,
        TENANT_ID,
        makeCandidatesDto(),
      );

      // First partial should succeed
      const first = await gen.next();
      expect(first.value).toEqual({
        type: 'partial',
        data: { candidates: [{ candidateIndex: 1 }] },
      });

      // Second iteration should throw
      await expect(gen.next()).rejects.toThrow('Stream error');
    });
  });
});
