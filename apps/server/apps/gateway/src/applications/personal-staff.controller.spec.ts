import { jest, describe, it, expect, beforeEach } from '@jest/globals';

jest.unstable_mockModule('@team9/auth', () => ({
  AuthGuard: class AuthGuard {},
  CurrentUser: () => () => undefined,
}));

jest.unstable_mockModule(
  '../common/decorators/current-tenant.decorator.js',
  () => ({
    CurrentTenantId: () => () => undefined,
  }),
);

jest.unstable_mockModule('../workspace/guards/workspace.guard.js', () => ({
  WorkspaceGuard: class WorkspaceGuard {},
}));

jest.unstable_mockModule('./personal-staff.service.js', () => ({
  PersonalStaffService: class PersonalStaffService {},
}));

const { PersonalStaffController } =
  await import('./personal-staff.controller.js');
const { PersonalStaffService } = await import('./personal-staff.service.js');

import { Test, TestingModule } from '@nestjs/testing';
import type {
  CreatePersonalStaffDto,
  UpdatePersonalStaffDto,
} from './dto/personal-staff.dto.js';
import type {
  GeneratePersonaDto,
  GenerateAvatarDto,
} from './dto/generate-persona.dto.js';

// ── Types ──────────────────────────────────────────────────────────────────────
type MockFn = jest.Mock<(...args: any[]) => any>;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-uuid-1234';
const USER_ID = 'user-uuid-owner';
const APP_ID = 'installed-app-uuid';
const BOT_ID = 'bot-uuid-1234';
const BOT_USER_ID = 'bot-user-uuid-1234';
const AGENT_ID = `personal-staff-${BOT_ID}`;

const makeCreateDto = (
  overrides: Partial<CreatePersonalStaffDto> = {},
): CreatePersonalStaffDto => ({
  model: { provider: 'anthropic', id: 'claude-3-5-sonnet-20241022' },
  ...overrides,
});

const makeUpdateDto = (
  overrides: Partial<UpdatePersonalStaffDto> = {},
): UpdatePersonalStaffDto => ({
  displayName: 'Updated PA',
  ...overrides,
});

const makeStaffResult = () => ({
  botId: BOT_ID,
  userId: BOT_USER_ID,
  agentId: AGENT_ID,
  displayName: 'Personal Assistant',
});

const makeGetStaffResult = () => ({
  botId: BOT_ID,
  userId: BOT_USER_ID,
  displayName: 'Personal Assistant',
  roleTitle: 'Personal Assistant',
  jobDescription: 'Dedicated personal assistant for your owner',
  persona: 'Friendly helper',
  model: { provider: 'anthropic', id: 'claude-3-5-sonnet-20241022' },
  visibility: { allowMention: false, allowDirectMessage: false },
  avatarUrl: null,
});

// ── Tests ──────────────────────────────────────────────────────────────────────

async function* makeChunkGenerator(chunks: string[]): AsyncGenerator<string> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

function makeMockResponse() {
  const written: string[] = [];
  return {
    setHeader: jest.fn<any>(),
    flushHeaders: jest.fn<any>(),
    write: jest.fn<any>((data: string) => {
      written.push(data);
    }),
    end: jest.fn<any>(),
    _written: written,
  };
}

describe('PersonalStaffController', () => {
  let controller: InstanceType<typeof PersonalStaffController>;
  let personalStaffService: {
    getStaff: MockFn;
    createStaff: MockFn;
    updateStaff: MockFn;
    deleteStaff: MockFn;
    generatePersona: MockFn;
    generateAvatar: MockFn;
  };

  beforeEach(async () => {
    personalStaffService = {
      getStaff: jest.fn<any>().mockResolvedValue(makeGetStaffResult()),
      createStaff: jest.fn<any>().mockResolvedValue(makeStaffResult()),
      updateStaff: jest.fn<any>().mockResolvedValue(undefined),
      deleteStaff: jest.fn<any>().mockResolvedValue(undefined),
      generatePersona: jest
        .fn<any>()
        .mockReturnValue(makeChunkGenerator(['Hello', ' world'])),
      generateAvatar: jest.fn<any>().mockResolvedValue({
        avatarUrl: 'https://api.dicebear.com/9.x/avataaars/svg?seed=PA',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PersonalStaffController],
      providers: [
        { provide: PersonalStaffService, useValue: personalStaffService },
      ],
    }).compile();

    controller = module.get(PersonalStaffController);
  });

  // ── getStaff ──────────────────────────────────────────────────────────────────

  describe('getStaff', () => {
    it('calls service.getStaff with correct args', async () => {
      await controller.getStaff(APP_ID, TENANT_ID, USER_ID);

      expect(personalStaffService.getStaff).toHaveBeenCalledWith(
        APP_ID,
        TENANT_ID,
        USER_ID,
      );
    });

    it('returns the result from service.getStaff', async () => {
      const expected = makeGetStaffResult();
      personalStaffService.getStaff.mockResolvedValueOnce(expected);

      const result = await controller.getStaff(APP_ID, TENANT_ID, USER_ID);

      expect(result).toEqual(expected);
    });

    it('propagates errors from service.getStaff', async () => {
      const error = new Error('Not found');
      personalStaffService.getStaff.mockRejectedValueOnce(error);

      await expect(
        controller.getStaff(APP_ID, TENANT_ID, USER_ID),
      ).rejects.toThrow('Not found');
    });
  });

  // ── createStaff ──────────────────────────────────────────────────────────────

  describe('createStaff', () => {
    it('calls service.createStaff with correct args', async () => {
      const dto = makeCreateDto();
      await controller.createStaff(APP_ID, TENANT_ID, USER_ID, dto);

      expect(personalStaffService.createStaff).toHaveBeenCalledWith(
        APP_ID,
        TENANT_ID,
        USER_ID,
        dto,
      );
    });

    it('returns the result from service.createStaff', async () => {
      const expected = makeStaffResult();
      personalStaffService.createStaff.mockResolvedValueOnce(expected);

      const result = await controller.createStaff(
        APP_ID,
        TENANT_ID,
        USER_ID,
        makeCreateDto(),
      );

      expect(result).toEqual(expected);
    });

    it('propagates errors from service.createStaff', async () => {
      const error = new Error('Conflict');
      personalStaffService.createStaff.mockRejectedValueOnce(error);

      await expect(
        controller.createStaff(APP_ID, TENANT_ID, USER_ID, makeCreateDto()),
      ).rejects.toThrow('Conflict');
    });

    it('passes through optional dto fields', async () => {
      const dto = makeCreateDto({
        displayName: 'My PA',
        persona: 'Quirky helper',
        avatarUrl: 'https://example.com/avatar.png',
        agenticBootstrap: false,
      });
      await controller.createStaff(APP_ID, TENANT_ID, USER_ID, dto);

      expect(personalStaffService.createStaff).toHaveBeenCalledWith(
        APP_ID,
        TENANT_ID,
        USER_ID,
        expect.objectContaining({
          displayName: 'My PA',
          persona: 'Quirky helper',
          avatarUrl: 'https://example.com/avatar.png',
          agenticBootstrap: false,
        }),
      );
    });
  });

  // ── updateStaff ──────────────────────────────────────────────────────────────

  describe('updateStaff', () => {
    it('calls service.updateStaff with correct args (no botId)', async () => {
      const dto = makeUpdateDto();
      await controller.updateStaff(APP_ID, TENANT_ID, USER_ID, dto);

      expect(personalStaffService.updateStaff).toHaveBeenCalledWith(
        APP_ID,
        TENANT_ID,
        USER_ID,
        dto,
      );
    });

    it('returns undefined (no body for PATCH)', async () => {
      const result = await controller.updateStaff(
        APP_ID,
        TENANT_ID,
        USER_ID,
        makeUpdateDto(),
      );

      expect(result).toBeUndefined();
    });

    it('propagates errors from service.updateStaff', async () => {
      const error = new Error('Update failed');
      personalStaffService.updateStaff.mockRejectedValueOnce(error);

      await expect(
        controller.updateStaff(APP_ID, TENANT_ID, USER_ID, makeUpdateDto()),
      ).rejects.toThrow('Update failed');
    });

    it('passes all optional fields when provided', async () => {
      const dto = makeUpdateDto({
        persona: 'Expert',
        model: { provider: 'openai', id: 'gpt-4o' },
        avatarUrl: 'https://example.com/new-avatar.png',
        visibility: { allowMention: true },
      });
      await controller.updateStaff(APP_ID, TENANT_ID, USER_ID, dto);

      expect(personalStaffService.updateStaff).toHaveBeenCalledWith(
        APP_ID,
        TENANT_ID,
        USER_ID,
        expect.objectContaining({
          persona: 'Expert',
          model: { provider: 'openai', id: 'gpt-4o' },
          avatarUrl: 'https://example.com/new-avatar.png',
          visibility: { allowMention: true },
        }),
      );
    });
  });

  // ── deleteStaff ──────────────────────────────────────────────────────────────

  describe('deleteStaff', () => {
    it('calls service.deleteStaff with correct args (no botId)', async () => {
      await controller.deleteStaff(APP_ID, TENANT_ID, USER_ID);

      expect(personalStaffService.deleteStaff).toHaveBeenCalledWith(
        APP_ID,
        TENANT_ID,
        USER_ID,
      );
    });

    it('returns undefined (204 No Content)', async () => {
      const result = await controller.deleteStaff(APP_ID, TENANT_ID, USER_ID);

      expect(result).toBeUndefined();
    });

    it('propagates errors from service.deleteStaff', async () => {
      const error = new Error('Delete failed');
      personalStaffService.deleteStaff.mockRejectedValueOnce(error);

      await expect(
        controller.deleteStaff(APP_ID, TENANT_ID, USER_ID),
      ).rejects.toThrow('Delete failed');
    });
  });

  // ── generatePersona ─────────────────────────────────────────────────────────

  describe('generatePersona', () => {
    const makePersonaDto = (
      overrides: Partial<GeneratePersonaDto> = {},
    ): GeneratePersonaDto => ({
      displayName: 'PA',
      ...overrides,
    });

    it('writes each chunk as an SSE data event', async () => {
      personalStaffService.generatePersona.mockReturnValueOnce(
        makeChunkGenerator(['chunk1', 'chunk2']),
      );
      const res = makeMockResponse();

      await controller.generatePersona(
        APP_ID,
        TENANT_ID,
        USER_ID,
        makePersonaDto(),
        res as any,
      );

      expect(res._written).toContain(
        `data: ${JSON.stringify({ text: 'chunk1' })}\n\n`,
      );
      expect(res._written).toContain(
        `data: ${JSON.stringify({ text: 'chunk2' })}\n\n`,
      );
    });

    it('writes [DONE] sentinel at the end of the stream', async () => {
      const res = makeMockResponse();

      await controller.generatePersona(
        APP_ID,
        TENANT_ID,
        USER_ID,
        makePersonaDto(),
        res as any,
      );

      expect(res._written).toContain('data: [DONE]\n\n');
    });

    it('calls res.end() after the stream completes', async () => {
      const res = makeMockResponse();

      await controller.generatePersona(
        APP_ID,
        TENANT_ID,
        USER_ID,
        makePersonaDto(),
        res as any,
      );

      expect(res.end).toHaveBeenCalledTimes(1);
    });

    it('sets X-Accel-Buffering header to no', async () => {
      const res = makeMockResponse();

      await controller.generatePersona(
        APP_ID,
        TENANT_ID,
        USER_ID,
        makePersonaDto(),
        res as any,
      );

      expect(res.setHeader).toHaveBeenCalledWith('X-Accel-Buffering', 'no');
    });

    it('calls flushHeaders before streaming', async () => {
      const res = makeMockResponse();
      const order: string[] = [];
      res.flushHeaders.mockImplementation(() => order.push('flush'));
      res.write.mockImplementation(() => order.push('write'));

      await controller.generatePersona(
        APP_ID,
        TENANT_ID,
        USER_ID,
        makePersonaDto(),
        res as any,
      );

      expect(order[0]).toBe('flush');
    });

    it('delegates to service.generatePersona with correct args including userId', async () => {
      const res = makeMockResponse();
      const dto = makePersonaDto({ prompt: 'Make it quirky' });

      await controller.generatePersona(
        APP_ID,
        TENANT_ID,
        USER_ID,
        dto,
        res as any,
      );

      expect(personalStaffService.generatePersona).toHaveBeenCalledWith(
        APP_ID,
        TENANT_ID,
        USER_ID,
        dto,
      );
    });

    it('handles empty stream (only [DONE] is written)', async () => {
      personalStaffService.generatePersona.mockReturnValueOnce(
        makeChunkGenerator([]),
      );
      const res = makeMockResponse();

      await controller.generatePersona(
        APP_ID,
        TENANT_ID,
        USER_ID,
        makePersonaDto(),
        res as any,
      );

      const dataChunks = res._written.filter(
        (w: string) => w !== 'data: [DONE]\n\n',
      );
      expect(dataChunks).toHaveLength(0);
      expect(res._written).toContain('data: [DONE]\n\n');
    });

    it('writes error event and calls res.end() when stream throws', async () => {
      // eslint-disable-next-line require-yield
      async function* errorStream(): AsyncGenerator<string> {
        throw new Error('Stream error');
      }
      personalStaffService.generatePersona.mockReturnValueOnce(errorStream());
      const res = makeMockResponse();

      await controller.generatePersona(
        APP_ID,
        TENANT_ID,
        USER_ID,
        makePersonaDto(),
        res as any,
      );

      expect(res._written).toContain(
        `data: ${JSON.stringify({ error: 'Stream error' })}\n\n`,
      );
      expect(res.end).toHaveBeenCalledTimes(1);
    });
  });

  // ── generateAvatar ──────────────────────────────────────────────────────────

  describe('generateAvatar', () => {
    const makeAvatarDto = (
      overrides: Partial<GenerateAvatarDto> = {},
    ): GenerateAvatarDto => ({
      style: 'realistic',
      displayName: 'PA',
      ...overrides,
    });

    it('calls service.generateAvatar with correct args including userId', async () => {
      const dto = makeAvatarDto();
      await controller.generateAvatar(APP_ID, TENANT_ID, USER_ID, dto);

      expect(personalStaffService.generateAvatar).toHaveBeenCalledWith(
        APP_ID,
        TENANT_ID,
        USER_ID,
        dto,
      );
    });

    it('returns the avatarUrl from service', async () => {
      const expected = {
        avatarUrl: 'https://api.dicebear.com/9.x/avataaars/svg?seed=PA',
      };
      personalStaffService.generateAvatar.mockResolvedValueOnce(expected);

      const result = await controller.generateAvatar(
        APP_ID,
        TENANT_ID,
        USER_ID,
        makeAvatarDto(),
      );

      expect(result).toEqual(expected);
    });

    it('propagates errors from service.generateAvatar', async () => {
      personalStaffService.generateAvatar.mockRejectedValueOnce(
        new Error('Avatar error'),
      );

      await expect(
        controller.generateAvatar(APP_ID, TENANT_ID, USER_ID, makeAvatarDto()),
      ).rejects.toThrow('Avatar error');
    });

    it('passes all optional dto fields through', async () => {
      const dto = makeAvatarDto({
        style: 'anime',
        displayName: 'Hikari',
        persona: 'Energetic and curious',
        prompt: 'With blue eyes',
      });
      await controller.generateAvatar(APP_ID, TENANT_ID, USER_ID, dto);

      expect(personalStaffService.generateAvatar).toHaveBeenCalledWith(
        APP_ID,
        TENANT_ID,
        USER_ID,
        expect.objectContaining({
          style: 'anime',
          displayName: 'Hikari',
          persona: 'Energetic and curious',
          prompt: 'With blue eyes',
        }),
      );
    });
  });
});
