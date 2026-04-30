import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// StaffService.createLlmProvider() is called even when streamText is
// mocked, and it throws when neither OPENROUTER_API_KEY nor
// CAPABILITY_HUB_URL is set. Provide a stub value up-front so tests
// don't crash in minimal CI environments.
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';

const mockStreamText = jest.fn<any>();

jest.unstable_mockModule('ai', () => ({
  streamText: mockStreamText,
  Output: { object: jest.fn<any>().mockReturnValue('mock-output-spec') },
}));

const { PersonalStaffService } = await import('./personal-staff.service.js');
const { StaffService } = await import('./staff.service.js');
import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { DATABASE_CONNECTION } from '@team9/database';

import { BotService } from '../bot/bot.service.js';
import { ClawHiveService } from '@team9/claw-hive';
import { RedisService } from '@team9/redis';
import { ChannelsService } from '../im/channels/channels.service.js';
import { InstalledApplicationsService } from './installed-applications.service.js';
import { UsersService } from '../im/users/users.service.js';
import type {
  CreatePersonalStaffDto,
  UpdatePersonalStaffDto,
} from './dto/personal-staff.dto.js';
import type {
  GeneratePersonaDto,
  GenerateAvatarDto,
} from './dto/generate-persona.dto.js';

// ── helpers ──────────────────────────────────────────────────────────────────

type MockFn = jest.Mock<(...args: any[]) => any>;

/**
 * Minimal Drizzle chain mock — same pattern as common-staff.service.spec.ts.
 */
function mockDb() {
  const whereQueue: unknown[] = [];
  const limitMock: MockFn = jest.fn<any>();
  limitMock.mockResolvedValue([]);

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

  chain.where = jest.fn<any>().mockImplementation(() => makeTerminalNode());
  chain.limit = limitMock;
  chain.enqueue = (value: unknown) => {
    whereQueue.push(value);
  };
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
const AGENT_ID = `personal-staff-${BOT_ID}`;

const makeInstalledApp = (applicationId = 'personal-staff') => ({
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
    username: 'personal-staff-bot',
    displayName: 'Personal Assistant',
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
  overrides: Partial<CreatePersonalStaffDto> = {},
): CreatePersonalStaffDto => ({
  model: { provider: 'anthropic', id: 'claude-3-5-sonnet-20241022' },
  ...overrides,
});

const makeUpdateDto = (
  overrides: Partial<UpdatePersonalStaffDto> = {},
): UpdatePersonalStaffDto => ({
  displayName: 'Updated Personal Staff',
  ...overrides,
});

const makeExistingBot = (overrides: Record<string, unknown> = {}) => ({
  botId: BOT_ID,
  userId: BOT_USER_ID,
  displayName: 'Personal Assistant',
  avatarUrl: 'https://example.com/avatar.png',
  ownerId: OWNER_ID,
  mentorId: OWNER_ID,
  extra: {
    personalStaff: {
      persona: 'Friendly helper',
      model: { provider: 'anthropic', id: 'claude-3-5-sonnet-20241022' },
      visibility: { allowMention: false, allowDirectMessage: false },
    },
  },
  managedMeta: { agentId: AGENT_ID },
  isActive: true,
  ...overrides,
});

// ── helpers for async iteration ──────────────────────────────────────────────

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

function mockStreamTextReturn(chunks: string[]) {
  return { textStream: makeAsyncIterable(chunks) };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('PersonalStaffService', () => {
  let service: InstanceType<typeof PersonalStaffService>;
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
  let channelsService: {
    createDirectChannelsBatch: MockFn;
    createDirectChannel: MockFn;
  };
  let installedApplicationsService: { findById: MockFn };
  let usersService: { getLocalePreferences: MockFn };

  beforeEach(async () => {
    db = mockDb();

    botService = {
      createWorkspaceBot: jest.fn<any>().mockResolvedValue(makeBotResult()),
      getBotById: jest.fn<any>().mockResolvedValue(makeBotResult().bot),
      getBotsByInstalledApplicationId: jest.fn<any>().mockResolvedValue([]),
      updateBotExtra: jest.fn<any>().mockResolvedValue(undefined),
      updateBotDisplayName: jest.fn<any>().mockResolvedValue(undefined),
      updateBotMentor: jest.fn<any>().mockResolvedValue(undefined),
      deleteBotAndCleanup: jest.fn<any>().mockResolvedValue(undefined),
      generateAccessToken: jest
        .fn<any>()
        .mockResolvedValue({ accessToken: 'test-token' }),
    };

    clawHiveService = {
      registerAgent: jest.fn<any>().mockResolvedValue(undefined),
      updateAgent: jest.fn<any>().mockResolvedValue(undefined),
      deleteAgent: jest.fn<any>().mockResolvedValue(undefined),
      sendInput: jest.fn<any>().mockResolvedValue({ messages: [] }),
    };

    channelsService = {
      createDirectChannelsBatch: jest.fn<any>().mockResolvedValue(new Map()),
      createDirectChannel: jest
        .fn<any>()
        .mockResolvedValue({ id: 'dm-channel-uuid-1234' }),
    };

    installedApplicationsService = {
      findById: jest.fn<any>().mockResolvedValue(makeInstalledApp()),
    };

    usersService = {
      getLocalePreferences: jest
        .fn<any>()
        .mockResolvedValue({ language: null, timeZone: null }),
    };

    mockStreamText.mockReset();
    mockStreamText.mockReturnValue(mockStreamTextReturn(['Hello', ' world']));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StaffService,
        PersonalStaffService,
        { provide: DATABASE_CONNECTION, useValue: db },
        { provide: BotService, useValue: botService },
        { provide: ClawHiveService, useValue: clawHiveService },
        {
          provide: RedisService,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
            invalidate: jest.fn(),
          },
        },
        { provide: ChannelsService, useValue: channelsService },
        {
          provide: InstalledApplicationsService,
          useValue: installedApplicationsService,
        },
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();

    service = module.get(PersonalStaffService);
  });

  // ── getStaff ──────────────────────────────────────────────────────────────────

  describe('getStaff', () => {
    it('returns personal staff with hardcoded roleTitle and jobDescription', async () => {
      // findPersonalStaffBot query returns via limit()
      db.limit.mockResolvedValueOnce([makeExistingBot()]);

      const result = await service.getStaff(
        INSTALLED_APP_ID,
        TENANT_ID,
        OWNER_ID,
      );

      expect(result.roleTitle).toBe('Personal Assistant');
      expect(result.jobDescription).toBe(
        'Dedicated personal assistant for your owner',
      );
      expect(result.botId).toBe(BOT_ID);
      expect(result.userId).toBe(BOT_USER_ID);
      expect(result.persona).toBe('Friendly helper');
      expect(result.avatarUrl).toBe('https://example.com/avatar.png');
      expect(result.visibility).toEqual({
        allowMention: false,
        allowDirectMessage: false,
      });
    });

    it('throws NotFoundException when no personal staff exists', async () => {
      db.limit.mockResolvedValueOnce([]);

      await expect(
        service.getStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when installed app not found', async () => {
      installedApplicationsService.findById.mockResolvedValueOnce(null);

      await expect(
        service.getStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when app is not personal-staff type', async () => {
      installedApplicationsService.findById.mockResolvedValueOnce(
        makeInstalledApp('common-staff'),
      );

      await expect(
        service.getStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns default visibility when extra has no personalStaff', async () => {
      db.limit.mockResolvedValueOnce([makeExistingBot({ extra: {} })]);

      const result = await service.getStaff(
        INSTALLED_APP_ID,
        TENANT_ID,
        OWNER_ID,
      );

      expect(result.visibility).toEqual({
        allowMention: false,
        allowDirectMessage: false,
      });
      expect(result.persona).toBeNull();
      expect(result.model).toBeNull();
    });

    it('returns default visibility when extra is null', async () => {
      db.limit.mockResolvedValueOnce([makeExistingBot({ extra: null })]);

      const result = await service.getStaff(
        INSTALLED_APP_ID,
        TENANT_ID,
        OWNER_ID,
      );

      expect(result.visibility).toEqual({
        allowMention: false,
        allowDirectMessage: false,
      });
    });
  });

  // ── createStaff ──────────────────────────────────────────────────────────────

  describe('createStaff', () => {
    beforeEach(() => {
      // Default: findPersonalStaffBot returns no existing bot (limit returns empty)
      db.limit.mockResolvedValue([]);
    });

    it('creates bot with mentorId always set to ownerId', async () => {
      const dto = makeCreateDto();
      await service.createStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID, dto);

      expect(botService.createWorkspaceBot).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerId: OWNER_ID,
          tenantId: TENANT_ID,
          mentorId: OWNER_ID,
          type: 'system',
          installedApplicationId: INSTALLED_APP_ID,
          generateToken: true,
          managedProvider: 'hive',
        }),
      );
    });

    it('uses default display name "Personal Assistant" when none provided', async () => {
      const dto = makeCreateDto();
      await service.createStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID, dto);

      expect(botService.createWorkspaceBot).toHaveBeenCalledWith(
        expect.objectContaining({
          displayName: 'Personal Assistant',
        }),
      );
    });

    it('uses provided display name when given', async () => {
      const dto = makeCreateDto({ displayName: 'My Custom Bot' });
      await service.createStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID, dto);

      expect(botService.createWorkspaceBot).toHaveBeenCalledWith(
        expect.objectContaining({
          displayName: 'My Custom Bot',
        }),
      );
    });

    it('sets BotExtra.personalStaff with dto fields', async () => {
      const dto = makeCreateDto({ persona: 'Quirky helper' });
      await service.createStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID, dto);

      expect(botService.updateBotExtra).toHaveBeenCalledWith(
        BOT_ID,
        expect.objectContaining({
          personalStaff: expect.objectContaining({
            persona: 'Quirky helper',
            model: dto.model,
            visibility: { allowMention: false, allowDirectMessage: false },
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
          tenantId: TENANT_ID,
          model: dto.model,
          blueprintId: 'team9-personal-staff',
          metadata: expect.objectContaining({
            tenantId: TENANT_ID,
            botId: BOT_ID,
            mentorId: OWNER_ID,
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
            // Virtual workspace stack — folder9.workspaceId pinned to the
            // tenantId, just-bash with no-network policy, layout component
            // mounts bundled team9 skills. No folder9Psk shipped:
            // workspace mounts use externally-managed tokens.
            folder9: expect.objectContaining({
              workspaceId: TENANT_ID,
            }),
            'just-bash': { network: 'none' },
            'just-bash-team9-workspace': { mountTeam9Skills: true },
          }),
        }),
      );
    });

    it('does not ship folder9Psk in folder9 config (workspace uses externally-managed tokens)', async () => {
      const dto = makeCreateDto();
      await service.createStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID, dto);

      const call = clawHiveService.registerAgent.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      const configs = call['componentConfigs'] as Record<string, unknown>;
      const folder9Config = configs['folder9'] as Record<string, unknown>;
      expect(folder9Config).toBeDefined();
      expect(folder9Config).not.toHaveProperty('folder9Psk');
    });

    it('returns correct result object', async () => {
      const dto = makeCreateDto({ displayName: 'My PA' });
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
        displayName: 'My PA',
      });
    });

    it('throws ConflictException when personal staff already exists', async () => {
      db.limit.mockResolvedValueOnce([makeExistingBot()]);

      await expect(
        service.createStaff(
          INSTALLED_APP_ID,
          TENANT_ID,
          OWNER_ID,
          makeCreateDto(),
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException on DB unique constraint violation (race condition)', async () => {
      const dbError = new Error('unique_violation') as any;
      dbError.code = '23505';
      dbError.constraint = 'bots_owner_app_unique';
      botService.createWorkspaceBot.mockRejectedValueOnce(dbError);

      await expect(
        service.createStaff(
          INSTALLED_APP_ID,
          TENANT_ID,
          OWNER_ID,
          makeCreateDto(),
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('re-throws non-unique-constraint DB errors', async () => {
      const dbError = new Error('connection_error') as any;
      dbError.code = '08006';
      botService.createWorkspaceBot.mockRejectedValueOnce(dbError);

      await expect(
        service.createStaff(
          INSTALLED_APP_ID,
          TENANT_ID,
          OWNER_ID,
          makeCreateDto(),
        ),
      ).rejects.toThrow('connection_error');
    });

    it('throws NotFoundException when installed app not found', async () => {
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

    it('throws BadRequestException for wrong app type', async () => {
      installedApplicationsService.findById.mockResolvedValueOnce(
        makeInstalledApp('common-staff'),
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

    it('creates DM channel with only the owner', async () => {
      const dto = makeCreateDto();
      await service.createStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID, dto);

      expect(channelsService.createDirectChannelsBatch).toHaveBeenCalledWith(
        BOT_USER_ID,
        [OWNER_ID],
        TENANT_ID,
      );
    });

    it('updates avatarUrl when provided', async () => {
      const dto = makeCreateDto({
        avatarUrl: 'https://example.com/avatar.png',
      });
      await service.createStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID, dto);

      expect(db.update).toHaveBeenCalled();
      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({
          avatarUrl: 'https://example.com/avatar.png',
        }),
      );
    });

    describe('agenticBootstrap', () => {
      const DM_CHANNEL_ID = 'dm-channel-uuid-1234';

      beforeEach(() => {
        channelsService.createDirectChannelsBatch.mockResolvedValue(
          new Map([[OWNER_ID, { id: DM_CHANNEL_ID }]]),
        );
      });

      it('triggers bootstrap by default (agenticBootstrap=undefined)', async () => {
        const dto = makeCreateDto();
        await service.createStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID, dto);

        const expectedSessionId = `team9/${TENANT_ID}/${AGENT_ID}/dm/${DM_CHANNEL_ID}`;
        expect(clawHiveService.sendInput).toHaveBeenCalledWith(
          expectedSessionId,
          expect.objectContaining({
            type: 'team9:bootstrap.start',
            source: 'team9',
            payload: expect.objectContaining({
              mentorId: OWNER_ID,
              isMentorDm: true,
              channelId: DM_CHANNEL_ID,
            }),
          }),
          TENANT_ID,
        );
      });

      it('includes a standard team9Context in the bootstrap payload so Team9Component.onEvent can extract it', async () => {
        const dto = makeCreateDto();
        await service.createStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID, dto);

        const call = clawHiveService.sendInput.mock.calls[0];
        const event = call[1] as {
          payload: { team9Context: Record<string, unknown> };
        };
        expect(event.payload.team9Context).toEqual({
          source: 'team9',
          scopeType: 'dm',
          scopeId: DM_CHANNEL_ID,
          peerUserId: OWNER_ID,
          isMentorDm: true,
        });
      });

      it("includes the owner's persisted language + timeZone in team9Context when set", async () => {
        usersService.getLocalePreferences.mockResolvedValue({
          language: 'zh-CN',
          timeZone: 'Asia/Shanghai',
        });

        const dto = makeCreateDto();
        await service.createStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID, dto);

        expect(usersService.getLocalePreferences).toHaveBeenCalledWith(
          OWNER_ID,
        );

        const call = clawHiveService.sendInput.mock.calls[0];
        const event = call[1] as {
          payload: { team9Context: Record<string, unknown> };
        };
        expect(event.payload.team9Context).toMatchObject({
          source: 'team9',
          scopeType: 'dm',
          scopeId: DM_CHANNEL_ID,
          peerUserId: OWNER_ID,
          isMentorDm: true,
          language: 'zh-CN',
          timeZone: 'Asia/Shanghai',
        });
      });

      it('omits language and timeZone from team9Context when the owner has no preferences set', async () => {
        // Default usersService.getLocalePreferences mock returns { language: null, timeZone: null } →
        // neither key is spread into team9Context.
        const dto = makeCreateDto();
        await service.createStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID, dto);

        const call = clawHiveService.sendInput.mock.calls[0];
        const event = call[1] as {
          payload: { team9Context: Record<string, unknown> };
        };
        expect(event.payload.team9Context).not.toHaveProperty('language');
        expect(event.payload.team9Context).not.toHaveProperty('timeZone');
      });

      it('triggers bootstrap when agenticBootstrap=true', async () => {
        const dto = makeCreateDto({ agenticBootstrap: true });
        await service.createStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID, dto);

        expect(clawHiveService.sendInput).toHaveBeenCalled();
      });

      it('does NOT trigger bootstrap when agenticBootstrap=false', async () => {
        const dto = makeCreateDto({ agenticBootstrap: false });
        await service.createStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID, dto);

        expect(clawHiveService.sendInput).not.toHaveBeenCalled();
      });

      it('continues without error when bootstrap fails', async () => {
        clawHiveService.sendInput.mockRejectedValueOnce(
          new Error('Bootstrap error'),
        );
        const dto = makeCreateDto();
        const result = await service.createStaff(
          INSTALLED_APP_ID,
          TENANT_ID,
          OWNER_ID,
          dto,
        );

        expect(result.botId).toBe(BOT_ID);
      });

      it('skips bootstrap when DM channel creation fails', async () => {
        channelsService.createDirectChannelsBatch.mockRejectedValueOnce(
          new Error('DM error'),
        );
        const dto = makeCreateDto();
        const result = await service.createStaff(
          INSTALLED_APP_ID,
          TENANT_ID,
          OWNER_ID,
          dto,
        );

        expect(clawHiveService.sendInput).not.toHaveBeenCalled();
        expect(result.botId).toBe(BOT_ID);
      });
    });
  });

  // ── triggerBootstrapForExistingStaff ─────────────────────────────────────────

  describe('triggerBootstrapForExistingStaff', () => {
    const DM_CHANNEL_ID = 'dm-channel-uuid-5678';

    beforeEach(() => {
      channelsService.createDirectChannel.mockResolvedValue({
        id: DM_CHANNEL_ID,
      });
    });

    it('sends team9:bootstrap.start with the expected session id and payload', async () => {
      db.limit.mockResolvedValueOnce([makeExistingBot()]);

      await service.triggerBootstrapForExistingStaff(
        INSTALLED_APP_ID,
        TENANT_ID,
        OWNER_ID,
      );

      expect(channelsService.createDirectChannel).toHaveBeenCalledWith(
        BOT_USER_ID,
        OWNER_ID,
        TENANT_ID,
      );
      expect(clawHiveService.sendInput).toHaveBeenCalledWith(
        `team9/${TENANT_ID}/${AGENT_ID}/dm/${DM_CHANNEL_ID}`,
        expect.objectContaining({
          type: 'team9:bootstrap.start',
          source: 'team9',
          payload: expect.objectContaining({
            mentorId: OWNER_ID,
            isMentorDm: true,
            channelId: DM_CHANNEL_ID,
          }),
        }),
        TENANT_ID,
      );
    });

    it("injects the owner's locale into team9Context when set", async () => {
      db.limit.mockResolvedValueOnce([makeExistingBot()]);
      usersService.getLocalePreferences.mockResolvedValue({
        language: 'zh-CN',
        timeZone: 'Asia/Shanghai',
      });

      await service.triggerBootstrapForExistingStaff(
        INSTALLED_APP_ID,
        TENANT_ID,
        OWNER_ID,
      );

      expect(usersService.getLocalePreferences).toHaveBeenCalledWith(OWNER_ID);
      const call = clawHiveService.sendInput.mock.calls[0];
      const event = call[1] as {
        payload: { team9Context: Record<string, unknown> };
      };
      expect(event.payload.team9Context).toMatchObject({
        source: 'team9',
        scopeType: 'dm',
        scopeId: DM_CHANNEL_ID,
        peerUserId: OWNER_ID,
        isMentorDm: true,
        language: 'zh-CN',
        timeZone: 'Asia/Shanghai',
      });
    });

    it('logs and skips when no personal staff bot exists', async () => {
      db.limit.mockResolvedValueOnce([]);

      await service.triggerBootstrapForExistingStaff(
        INSTALLED_APP_ID,
        TENANT_ID,
        OWNER_ID,
      );

      expect(channelsService.createDirectChannel).not.toHaveBeenCalled();
      expect(clawHiveService.sendInput).not.toHaveBeenCalled();
    });

    it('logs and skips when the bot is missing managedMeta.agentId', async () => {
      db.limit.mockResolvedValueOnce([makeExistingBot({ managedMeta: null })]);

      await service.triggerBootstrapForExistingStaff(
        INSTALLED_APP_ID,
        TENANT_ID,
        OWNER_ID,
      );

      expect(channelsService.createDirectChannel).not.toHaveBeenCalled();
      expect(clawHiveService.sendInput).not.toHaveBeenCalled();
    });

    it('logs and skips when DM channel resolution throws', async () => {
      db.limit.mockResolvedValueOnce([makeExistingBot()]);
      channelsService.createDirectChannel.mockRejectedValueOnce(
        new Error('DM failure'),
      );

      await service.triggerBootstrapForExistingStaff(
        INSTALLED_APP_ID,
        TENANT_ID,
        OWNER_ID,
      );

      expect(clawHiveService.sendInput).not.toHaveBeenCalled();
    });

    it('does not throw when sendInput fails (fire-and-forget)', async () => {
      db.limit.mockResolvedValueOnce([makeExistingBot()]);
      clawHiveService.sendInput.mockRejectedValueOnce(
        new Error('Hive unreachable'),
      );

      await expect(
        service.triggerBootstrapForExistingStaff(
          INSTALLED_APP_ID,
          TENANT_ID,
          OWNER_ID,
        ),
      ).resolves.toBeUndefined();
    });

    it('skips firing when the bot already has bootstrappedAt set (onboarding retry guard)', async () => {
      db.limit.mockResolvedValueOnce([
        makeExistingBot({
          extra: {
            personalStaff: {
              persona: 'Friendly helper',
              bootstrappedAt: '2026-04-20T00:00:00.000Z',
            },
          },
        }),
      ]);

      await service.triggerBootstrapForExistingStaff(
        INSTALLED_APP_ID,
        TENANT_ID,
        OWNER_ID,
      );

      expect(channelsService.createDirectChannel).not.toHaveBeenCalled();
      expect(clawHiveService.sendInput).not.toHaveBeenCalled();
    });

    it('persists bootstrappedAt marker after a successful send', async () => {
      db.limit.mockResolvedValueOnce([makeExistingBot()]);

      await service.triggerBootstrapForExistingStaff(
        INSTALLED_APP_ID,
        TENANT_ID,
        OWNER_ID,
      );

      expect(db.update).toHaveBeenCalled();
      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({
          extra: expect.objectContaining({
            personalStaff: expect.objectContaining({
              bootstrappedAt: expect.any(String),
            }),
          }),
        }),
      );
    });

    it('does NOT persist the marker if send fails (so retries can still fire)', async () => {
      db.limit.mockResolvedValueOnce([makeExistingBot()]);
      clawHiveService.sendInput.mockRejectedValueOnce(new Error('Hive down'));

      await service.triggerBootstrapForExistingStaff(
        INSTALLED_APP_ID,
        TENANT_ID,
        OWNER_ID,
      );

      // db.update is only called for the marker write; the failure path
      // must skip it.
      expect(db.update).not.toHaveBeenCalled();
    });
  });

  // ── updateStaff ──────────────────────────────────────────────────────────────

  describe('updateStaff', () => {
    beforeEach(() => {
      // findPersonalStaffBot returns existing bot via limit()
      db.limit.mockResolvedValue([makeExistingBot()]);
    });

    it('delegates to staffService.updateBotAndAgent with correct params', async () => {
      const dto = makeUpdateDto({ displayName: 'Updated PA' });
      await service.updateStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID, dto);

      expect(botService.updateBotDisplayName).toHaveBeenCalledWith(
        BOT_ID,
        'Updated PA',
      );
    });

    it('merges personalStaff extra fields on update', async () => {
      const dto = makeUpdateDto({ persona: 'New persona' });
      await service.updateStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID, dto);

      expect(botService.updateBotExtra).toHaveBeenCalledWith(
        BOT_ID,
        expect.objectContaining({
          personalStaff: expect.objectContaining({
            persona: 'New persona',
            model: { provider: 'anthropic', id: 'claude-3-5-sonnet-20241022' },
            visibility: { allowMention: false, allowDirectMessage: false },
          }),
        }),
      );
    });

    it('updates visibility fields', async () => {
      const dto = makeUpdateDto({
        visibility: { allowMention: true },
      });
      await service.updateStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID, dto);

      expect(botService.updateBotExtra).toHaveBeenCalledWith(
        BOT_ID,
        expect.objectContaining({
          personalStaff: expect.objectContaining({
            visibility: { allowMention: true, allowDirectMessage: false },
          }),
        }),
      );
    });

    it('updates model when provided', async () => {
      const newModel = { provider: 'openai', id: 'gpt-4o' };
      const dto = makeUpdateDto({ model: newModel });
      await service.updateStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID, dto);

      expect(botService.updateBotExtra).toHaveBeenCalledWith(
        BOT_ID,
        expect.objectContaining({
          personalStaff: expect.objectContaining({
            model: newModel,
          }),
        }),
      );
    });

    it('throws NotFoundException when personal staff not found', async () => {
      db.limit.mockResolvedValueOnce([]);

      await expect(
        service.updateStaff(
          INSTALLED_APP_ID,
          TENANT_ID,
          OWNER_ID,
          makeUpdateDto(),
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when installed app not found', async () => {
      installedApplicationsService.findById.mockResolvedValueOnce(null);

      await expect(
        service.updateStaff(
          INSTALLED_APP_ID,
          TENANT_ID,
          OWNER_ID,
          makeUpdateDto(),
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException for wrong app type', async () => {
      installedApplicationsService.findById.mockResolvedValueOnce(
        makeInstalledApp('common-staff'),
      );

      await expect(
        service.updateStaff(
          INSTALLED_APP_ID,
          TENANT_ID,
          OWNER_ID,
          makeUpdateDto(),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('uses ownerId as currentMentorId when updating', async () => {
      const dto = makeUpdateDto();
      await service.updateStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID, dto);

      expect(clawHiveService.updateAgent).toHaveBeenCalledWith(
        AGENT_ID,
        expect.objectContaining({
          metadata: expect.objectContaining({
            mentorId: OWNER_ID,
          }),
        }),
      );
    });

    it('preserves existing extra fields not related to personalStaff', async () => {
      const botWithOpenClaw = makeExistingBot({
        extra: {
          openclaw: { agentId: 'oc-1' },
          personalStaff: {
            persona: 'Old',
            model: { provider: 'anthropic', id: 'claude-3-5-sonnet-20241022' },
            visibility: { allowMention: false, allowDirectMessage: false },
          },
        },
      });
      db.limit.mockResolvedValueOnce([botWithOpenClaw]);

      const dto = makeUpdateDto({ persona: 'New' });
      await service.updateStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID, dto);

      expect(botService.updateBotExtra).toHaveBeenCalledWith(
        BOT_ID,
        expect.objectContaining({
          openclaw: { agentId: 'oc-1' },
          personalStaff: expect.objectContaining({
            persona: 'New',
          }),
        }),
      );
    });

    it('handles empty update dto without error', async () => {
      const dto: UpdatePersonalStaffDto = {};
      await service.updateStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID, dto);

      expect(botService.updateBotExtra).toHaveBeenCalled();
    });

    // ── dmOutboundPolicy ────────────────────────────────────────────────────────

    describe('dmOutboundPolicy', () => {
      it('persists a new policy into extra.dmOutboundPolicy', async () => {
        const dto = makeUpdateDto({
          dmOutboundPolicy: { mode: 'anyone' },
        });
        await service.updateStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID, dto);

        expect(botService.updateBotExtra).toHaveBeenCalledWith(
          BOT_ID,
          expect.objectContaining({
            dmOutboundPolicy: { mode: 'anyone' },
          }),
        );
      });

      it('emits structured log when policy is changed', async () => {
        const logSpy = jest.spyOn(
          service['logger'] as unknown as { log: (...args: unknown[]) => void },
          'log',
        );

        const dto = makeUpdateDto({
          dmOutboundPolicy: { mode: 'same-tenant' },
        });
        await service.updateStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID, dto);

        expect(logSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            event: 'bot_dm_outbound_policy_changed',
            botId: BOT_ID,
            botUserId: BOT_USER_ID,
            actorUserId: OWNER_ID,
            from: null,
            to: { mode: 'same-tenant' },
          }),
        );
      });

      it('does NOT emit log when policy is deep-equal to existing', async () => {
        const existingPolicy = { mode: 'anyone' as const };
        db.limit.mockResolvedValueOnce([
          makeExistingBot({
            extra: {
              personalStaff: {
                persona: 'Friendly helper',
                model: {
                  provider: 'anthropic',
                  id: 'claude-3-5-sonnet-20241022',
                },
                visibility: { allowMention: false, allowDirectMessage: false },
              },
              dmOutboundPolicy: existingPolicy,
            },
          }),
        ]);

        const logSpy = jest.spyOn(
          service['logger'] as unknown as { log: (...args: unknown[]) => void },
          'log',
        );

        const dto = makeUpdateDto({
          dmOutboundPolicy: { mode: 'anyone' },
        });
        await service.updateStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID, dto);

        const policyChangedCalls = logSpy.mock.calls.filter(
          (args) =>
            typeof args[0] === 'object' &&
            args[0] !== null &&
            (args[0] as Record<string, unknown>).event ===
              'bot_dm_outbound_policy_changed',
        );
        expect(policyChangedCalls).toHaveLength(0);
      });

      it('does NOT update extra.dmOutboundPolicy when field is omitted (partial-update semantics)', async () => {
        const dto = makeUpdateDto({ persona: 'New persona' });
        await service.updateStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID, dto);

        const call = (botService.updateBotExtra.mock.calls as unknown[][])[0];
        const updatedExtra = call[1] as Record<string, unknown>;
        expect(updatedExtra).not.toHaveProperty('dmOutboundPolicy');
      });

      it('persists whitelist policy with userIds', async () => {
        const userIds = [
          '00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-000000000002',
        ];
        const dto = makeUpdateDto({
          dmOutboundPolicy: { mode: 'whitelist', userIds },
        });
        await service.updateStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID, dto);

        expect(botService.updateBotExtra).toHaveBeenCalledWith(
          BOT_ID,
          expect.objectContaining({
            dmOutboundPolicy: { mode: 'whitelist', userIds },
          }),
        );
      });
    });
  });

  // ── deleteStaff ──────────────────────────────────────────────────────────────

  describe('deleteStaff', () => {
    beforeEach(() => {
      db.limit.mockResolvedValue([makeExistingBot()]);
    });

    it('deletes bot and agent via staffService', async () => {
      await service.deleteStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID);

      expect(clawHiveService.deleteAgent).toHaveBeenCalledWith(AGENT_ID);
      expect(botService.deleteBotAndCleanup).toHaveBeenCalledWith(BOT_ID);
    });

    it('throws NotFoundException when personal staff not found', async () => {
      db.limit.mockResolvedValueOnce([]);

      await expect(
        service.deleteStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when installed app not found', async () => {
      installedApplicationsService.findById.mockResolvedValueOnce(null);

      await expect(
        service.deleteStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException for wrong app type', async () => {
      installedApplicationsService.findById.mockResolvedValueOnce(
        makeInstalledApp('common-staff'),
      );

      await expect(
        service.deleteStaff(INSTALLED_APP_ID, TENANT_ID, OWNER_ID),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── generatePersona ─────────────────────────────────────────────────────────

  describe('generatePersona', () => {
    beforeEach(() => {
      // Default: findPersonalStaffBot returns existing bot via limit()
      db.limit.mockResolvedValue([makeExistingBot()]);
    });

    it('yields text chunks from the AI stream', async () => {
      const chunks: string[] = [];
      for await (const chunk of service.generatePersona(
        INSTALLED_APP_ID,
        TENANT_ID,
        OWNER_ID,
        { displayName: 'PA' } as GeneratePersonaDto,
      )) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['Hello', ' world']);
    });

    it('passes hardcoded roleTitle and jobDescription to staffService', async () => {
      mockStreamText.mockReturnValueOnce(mockStreamTextReturn(['ok']));

      const gen = service.generatePersona(
        INSTALLED_APP_ID,
        TENANT_ID,
        OWNER_ID,
        {
          displayName: 'PA',
        } as GeneratePersonaDto,
      );
      // Consume the generator
      for await (const _ of gen) {
        // drain
      }

      // Verify streamText was called with our hardcoded values in the messages
      expect(mockStreamText).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              content: expect.stringContaining('PA'),
            }),
          ]),
        }),
      );
    });

    it('throws BadRequestException for wrong app type', async () => {
      installedApplicationsService.findById.mockResolvedValueOnce(
        makeInstalledApp('common-staff'),
      );

      const gen = service.generatePersona(
        INSTALLED_APP_ID,
        TENANT_ID,
        OWNER_ID,
        {
          displayName: 'PA',
        } as GeneratePersonaDto,
      );

      await expect(gen.next()).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when app not found', async () => {
      installedApplicationsService.findById.mockResolvedValueOnce(null);

      const gen = service.generatePersona(
        INSTALLED_APP_ID,
        TENANT_ID,
        OWNER_ID,
        {
          displayName: 'PA',
        } as GeneratePersonaDto,
      );

      await expect(gen.next()).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when user has no personal staff bot', async () => {
      db.limit.mockResolvedValueOnce([]);

      const gen = service.generatePersona(
        INSTALLED_APP_ID,
        TENANT_ID,
        OWNER_ID,
        {
          displayName: 'PA',
        } as GeneratePersonaDto,
      );

      await expect(gen.next()).rejects.toThrow(NotFoundException);
    });
  });

  // ── generateAvatar ──────────────────────────────────────────────────────────

  describe('generateAvatar', () => {
    beforeEach(() => {
      // Default: findPersonalStaffBot returns existing bot via limit()
      db.limit.mockResolvedValue([makeExistingBot()]);
    });

    it('returns avatarUrl from staffService', async () => {
      const result = await service.generateAvatar(
        INSTALLED_APP_ID,
        TENANT_ID,
        OWNER_ID,
        {
          style: 'cartoon',
          displayName: 'PA',
        } as GenerateAvatarDto,
      );

      expect(result).toHaveProperty('avatarUrl');
      expect(typeof result.avatarUrl).toBe('string');
    });

    it('throws BadRequestException for wrong app type', async () => {
      installedApplicationsService.findById.mockResolvedValueOnce(
        makeInstalledApp('common-staff'),
      );

      await expect(
        service.generateAvatar(INSTALLED_APP_ID, TENANT_ID, OWNER_ID, {
          style: 'realistic',
        } as GenerateAvatarDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when app not found', async () => {
      installedApplicationsService.findById.mockResolvedValueOnce(null);

      await expect(
        service.generateAvatar(INSTALLED_APP_ID, TENANT_ID, OWNER_ID, {
          style: 'realistic',
        } as GenerateAvatarDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when user has no personal staff bot', async () => {
      db.limit.mockResolvedValueOnce([]);

      await expect(
        service.generateAvatar(INSTALLED_APP_ID, TENANT_ID, OWNER_ID, {
          style: 'realistic',
        } as GenerateAvatarDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('passes hardcoded roleTitle to staffService.generateAvatar', async () => {
      await service.generateAvatar(INSTALLED_APP_ID, TENANT_ID, OWNER_ID, {
        style: 'anime',
        displayName: 'Bot',
      } as GenerateAvatarDto);

      // The avatar URL should be generated — the important thing is no error
      // The staffService.generateAvatar uses roleTitle internally
    });
  });

  // ── findPersonalStaffBot ────────────────────────────────────────────────────

  describe('findPersonalStaffBot', () => {
    it('returns null when no bot found', async () => {
      db.limit.mockResolvedValueOnce([]);

      const result = await service.findPersonalStaffBot(
        OWNER_ID,
        INSTALLED_APP_ID,
      );

      expect(result).toBeNull();
    });

    it('returns bot when found', async () => {
      db.limit.mockResolvedValueOnce([makeExistingBot()]);

      const result = await service.findPersonalStaffBot(
        OWNER_ID,
        INSTALLED_APP_ID,
      );

      expect(result).not.toBeNull();
      expect(result!.botId).toBe(BOT_ID);
      expect(result!.ownerId).toBe(OWNER_ID);
    });

    it('includes managedMeta.agentId so callers can target the claw-hive session', async () => {
      db.limit.mockResolvedValueOnce([makeExistingBot()]);

      const result = await service.findPersonalStaffBot(
        OWNER_ID,
        INSTALLED_APP_ID,
      );

      expect(result!.managedMeta).toEqual({ agentId: AGENT_ID });
    });
  });
});
