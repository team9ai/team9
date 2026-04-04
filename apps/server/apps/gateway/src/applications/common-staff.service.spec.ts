import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { DATABASE_CONNECTION } from '@team9/database';
import { AiClientService } from '@team9/ai-client';
import { CommonStaffService } from './common-staff.service.js';
import { BotService } from '../bot/bot.service.js';
import { ClawHiveService } from '@team9/claw-hive';
import { ChannelsService } from '../im/channels/channels.service.js';
import { InstalledApplicationsService } from './installed-applications.service.js';
import type {
  CreateCommonStaffDto,
  UpdateCommonStaffDto,
} from './dto/common-staff.dto.js';
import type { GeneratePersonaDto } from './dto/generate-persona.dto.js';

// ── helpers ──────────────────────────────────────────────────────────────────

type MockFn = jest.Mock<(...args: any[]) => any>;

/** Minimal Drizzle chain mock */
function mockDb() {
  const chain: Record<string, MockFn> = {};
  const methods = [
    'select',
    'from',
    'where',
    'innerJoin',
    'leftJoin',
    'limit',
    'update',
    'set',
    'delete',
  ];
  for (const m of methods) {
    chain[m] = jest.fn<any>().mockReturnValue(chain);
  }
  // Default: return empty member list (used for all terminal calls)
  chain.where.mockResolvedValue([]);
  chain.limit.mockResolvedValue([]);
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

describe('CommonStaffService', () => {
  let service: CommonStaffService;
  let db: ReturnType<typeof mockDb>;
  let botService: {
    createWorkspaceBot: MockFn;
    getBotById: MockFn;
    updateBotExtra: MockFn;
    updateBotDisplayName: MockFn;
    updateBotMentor: MockFn;
    deleteBotAndCleanup: MockFn;
  };
  let clawHiveService: {
    registerAgent: MockFn;
    updateAgent: MockFn;
    deleteAgent: MockFn;
  };
  let channelsService: { createDirectChannelsBatch: MockFn };
  let installedApplicationsService: { findById: MockFn };
  let aiClientService: { chat: MockFn };

  beforeEach(async () => {
    db = mockDb();

    botService = {
      createWorkspaceBot: jest.fn<any>().mockResolvedValue(makeBotResult()),
      getBotById: jest.fn<any>().mockResolvedValue(makeBotResult().bot),
      updateBotExtra: jest.fn<any>().mockResolvedValue(undefined),
      updateBotDisplayName: jest.fn<any>().mockResolvedValue(undefined),
      updateBotMentor: jest.fn<any>().mockResolvedValue(undefined),
      deleteBotAndCleanup: jest.fn<any>().mockResolvedValue(undefined),
    };

    clawHiveService = {
      registerAgent: jest.fn<any>().mockResolvedValue(undefined),
      updateAgent: jest.fn<any>().mockResolvedValue(undefined),
      deleteAgent: jest.fn<any>().mockResolvedValue(undefined),
    };

    channelsService = {
      createDirectChannelsBatch: jest.fn<any>().mockResolvedValue(new Map()),
    };

    installedApplicationsService = {
      findById: jest.fn<any>().mockResolvedValue(makeInstalledApp()),
    };

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
        }),
      );
    });

    it('creates DM channels for workspace members', async () => {
      const memberIds = ['member-a', 'member-b'];
      // First DB call: update bots.managedMeta (returns nothing meaningful)
      db.where.mockResolvedValueOnce([]);
      // Second DB call: select tenant members
      db.where.mockResolvedValueOnce(memberIds.map((userId) => ({ userId })));

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
      // Members list only has the bot itself
      db.where.mockResolvedValue([{ userId: BOT_USER_ID }]);

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

    it('handles agenticBootstrap flag (flag stored in dto, no extra action)', async () => {
      const dto = makeCreateDto({ agenticBootstrap: true });
      // Should not throw; bootstrap trigger is Task 11
      await expect(
        service.createStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID, dto),
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
      db.where.mockResolvedValue([
        { installedApplicationId: INSTALLED_APP_ID },
      ]);
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
      // Bot found but not linked to this installed application
      db.where.mockResolvedValueOnce([]); // empty means no matching record

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
      aiClientService.chat.mockReturnValueOnce(
        makeChunkGenerator(['chunk1', 'chunk2', 'chunk3']),
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

    it('calls aiClientService.chat with streaming enabled', async () => {
      for await (const _ of service.generatePersona(
        INSTALLED_APP_ID,
        TENANT_ID,
        makePersonaDto(),
      )) {
        // consume
      }

      expect(aiClientService.chat).toHaveBeenCalledWith(
        expect.objectContaining({ stream: true }),
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

      const callArg = aiClientService.chat.mock.calls[0][0] as {
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

      const callArg = aiClientService.chat.mock.calls[0][0] as {
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

      const callArg = aiClientService.chat.mock.calls[0][0] as {
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

      const callArg = aiClientService.chat.mock.calls[0][0] as {
        messages: { role: string; content: string }[];
      };
      const userMessage = callArg.messages.find((m) => m.role === 'user');
      expect(userMessage?.content).toContain(userPrompt);
    });

    it('works with all optional fields omitted', async () => {
      for await (const _ of service.generatePersona(
        INSTALLED_APP_ID,
        TENANT_ID,
        {},
      )) {
        // consume
      }

      expect(aiClientService.chat).toHaveBeenCalledTimes(1);
    });

    it('propagates errors from the AI stream', async () => {
      async function* errorStream(): AsyncGenerator<string> {
        yield 'start';
        throw new Error('AI provider error');
      }
      aiClientService.chat.mockReturnValueOnce(errorStream());

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

    it('uses claude provider with streaming enabled', async () => {
      for await (const _ of service.generatePersona(
        INSTALLED_APP_ID,
        TENANT_ID,
        makePersonaDto(),
      )) {
        // consume
      }

      expect(aiClientService.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'claude',
          stream: true,
        }),
      );
    });

    it('yields empty stream when AI returns no chunks', async () => {
      aiClientService.chat.mockReturnValueOnce(makeChunkGenerator([]));

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
  });
});
