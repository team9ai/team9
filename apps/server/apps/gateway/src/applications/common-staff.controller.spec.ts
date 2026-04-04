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

jest.unstable_mockModule('./common-staff.service.js', () => ({
  CommonStaffService: class CommonStaffService {},
}));

const { CommonStaffController } = await import('./common-staff.controller.js');
const { CommonStaffService } = await import('./common-staff.service.js');

import { Test, TestingModule } from '@nestjs/testing';
import type {
  CreateCommonStaffDto,
  UpdateCommonStaffDto,
} from './dto/common-staff.dto.js';
import type {
  GeneratePersonaDto,
  GenerateAvatarDto,
  GenerateCandidatesDto,
} from './dto/generate-persona.dto.js';

// ── Types ──────────────────────────────────────────────────────────────────────
type MockFn = jest.Mock<(...args: any[]) => any>;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-uuid-1234';
const USER_ID = 'user-uuid-owner';
const APP_ID = 'installed-app-uuid';
const BOT_ID = 'bot-uuid-1234';
const BOT_USER_ID = 'bot-user-uuid-1234';
const AGENT_ID = `common-staff-${BOT_ID}`;

const makeCreateDto = (
  overrides: Partial<CreateCommonStaffDto> = {},
): CreateCommonStaffDto => ({
  displayName: 'Test Staff',
  model: { provider: 'anthropic', id: 'claude-3-5-sonnet-20241022' },
  roleTitle: 'Software Engineer',
  mentorId: USER_ID,
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

const makeStaffResult = () => ({
  botId: BOT_ID,
  userId: BOT_USER_ID,
  agentId: AGENT_ID,
  displayName: 'Test Staff',
});

// ── Tests ──────────────────────────────────────────────────────────────────────

/** Creates an async generator that yields the given strings */
async function* makeChunkGenerator(chunks: string[]): AsyncGenerator<string> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

/** Minimal mock for Express Response used in SSE endpoint tests */
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

describe('CommonStaffController', () => {
  let controller: InstanceType<typeof CommonStaffController>;
  let commonStaffService: {
    createStaff: MockFn;
    updateStaff: MockFn;
    deleteStaff: MockFn;
    generatePersona: MockFn;
    generateAvatar: MockFn;
    generateCandidates: MockFn;
  };

  beforeEach(async () => {
    commonStaffService = {
      createStaff: jest.fn<any>().mockResolvedValue(makeStaffResult()),
      updateStaff: jest.fn<any>().mockResolvedValue(undefined),
      deleteStaff: jest.fn<any>().mockResolvedValue(undefined),
      generatePersona: jest
        .fn<any>()
        .mockReturnValue(makeChunkGenerator(['Hello', ' world'])),
      generateAvatar: jest.fn<any>().mockResolvedValue({
        avatarUrl: 'https://api.dicebear.com/9.x/avataaars/svg?seed=Alex',
      }),
      generateCandidates: jest.fn<any>().mockReturnValue(
        (async function* () {
          yield {
            type: 'candidate',
            data: { candidateIndex: 1, displayName: 'Alice' },
          };
        })(),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CommonStaffController],
      providers: [
        { provide: CommonStaffService, useValue: commonStaffService },
      ],
    }).compile();

    controller = module.get(CommonStaffController);
  });

  // ── createStaff ──────────────────────────────────────────────────────────────

  describe('createStaff', () => {
    it('calls service.createStaff with correct args', async () => {
      const dto = makeCreateDto();
      await controller.createStaff(APP_ID, TENANT_ID, USER_ID, dto);

      expect(commonStaffService.createStaff).toHaveBeenCalledWith(
        APP_ID,
        TENANT_ID,
        USER_ID,
        dto,
      );
    });

    it('returns the result from service.createStaff', async () => {
      const expected = makeStaffResult();
      commonStaffService.createStaff.mockResolvedValueOnce(expected);

      const result = await controller.createStaff(
        APP_ID,
        TENANT_ID,
        USER_ID,
        makeCreateDto(),
      );

      expect(result).toEqual(expected);
    });

    it('propagates errors from service.createStaff', async () => {
      const error = new Error('Service error');
      commonStaffService.createStaff.mockRejectedValueOnce(error);

      await expect(
        controller.createStaff(APP_ID, TENANT_ID, USER_ID, makeCreateDto()),
      ).rejects.toThrow('Service error');
    });

    it('passes through optional dto fields', async () => {
      const dto = makeCreateDto({
        roleTitle: 'Manager',
        persona: 'Experienced leader',
        jobDescription: 'Leads teams',
        avatarUrl: 'https://example.com/avatar.png',
        agenticBootstrap: true,
      });
      await controller.createStaff(APP_ID, TENANT_ID, USER_ID, dto);

      expect(commonStaffService.createStaff).toHaveBeenCalledWith(
        APP_ID,
        TENANT_ID,
        USER_ID,
        expect.objectContaining({
          roleTitle: 'Manager',
          persona: 'Experienced leader',
          jobDescription: 'Leads teams',
          avatarUrl: 'https://example.com/avatar.png',
          agenticBootstrap: true,
        }),
      );
    });
  });

  // ── updateStaff ──────────────────────────────────────────────────────────────

  describe('updateStaff', () => {
    it('calls service.updateStaff with correct args', async () => {
      const dto = makeUpdateDto();
      await controller.updateStaff(APP_ID, BOT_ID, TENANT_ID, dto);

      expect(commonStaffService.updateStaff).toHaveBeenCalledWith(
        APP_ID,
        TENANT_ID,
        BOT_ID,
        dto,
      );
    });

    it('returns undefined (no body for PATCH)', async () => {
      const result = await controller.updateStaff(
        APP_ID,
        BOT_ID,
        TENANT_ID,
        makeUpdateDto(),
      );

      expect(result).toBeUndefined();
    });

    it('propagates errors from service.updateStaff', async () => {
      const error = new Error('Update failed');
      commonStaffService.updateStaff.mockRejectedValueOnce(error);

      await expect(
        controller.updateStaff(APP_ID, BOT_ID, TENANT_ID, makeUpdateDto()),
      ).rejects.toThrow('Update failed');
    });

    it('passes empty dto when no fields provided', async () => {
      const dto: UpdateCommonStaffDto = {};
      await controller.updateStaff(APP_ID, BOT_ID, TENANT_ID, dto);

      expect(commonStaffService.updateStaff).toHaveBeenCalledWith(
        APP_ID,
        TENANT_ID,
        BOT_ID,
        {},
      );
    });

    it('passes all optional fields when provided', async () => {
      const dto = makeUpdateDto({
        roleTitle: 'Senior Engineer',
        persona: 'Expert',
        jobDescription: 'Leads architecture',
        model: { provider: 'openai', id: 'gpt-4o' },
        avatarUrl: 'https://example.com/new-avatar.png',
        mentorId: 'new-mentor-id',
      });
      await controller.updateStaff(APP_ID, BOT_ID, TENANT_ID, dto);

      expect(commonStaffService.updateStaff).toHaveBeenCalledWith(
        APP_ID,
        TENANT_ID,
        BOT_ID,
        expect.objectContaining({
          roleTitle: 'Senior Engineer',
          persona: 'Expert',
          jobDescription: 'Leads architecture',
          model: { provider: 'openai', id: 'gpt-4o' },
          avatarUrl: 'https://example.com/new-avatar.png',
          mentorId: 'new-mentor-id',
        }),
      );
    });
  });

  // ── deleteStaff ──────────────────────────────────────────────────────────────

  describe('deleteStaff', () => {
    it('calls service.deleteStaff with correct args', async () => {
      await controller.deleteStaff(APP_ID, BOT_ID, TENANT_ID);

      expect(commonStaffService.deleteStaff).toHaveBeenCalledWith(
        APP_ID,
        TENANT_ID,
        BOT_ID,
      );
    });

    it('returns undefined (204 No Content)', async () => {
      const result = await controller.deleteStaff(APP_ID, BOT_ID, TENANT_ID);

      expect(result).toBeUndefined();
    });

    it('propagates errors from service.deleteStaff', async () => {
      const error = new Error('Delete failed');
      commonStaffService.deleteStaff.mockRejectedValueOnce(error);

      await expect(
        controller.deleteStaff(APP_ID, BOT_ID, TENANT_ID),
      ).rejects.toThrow('Delete failed');
    });

    it('calls service with different appId and botId independently', async () => {
      const differentAppId = 'different-app-uuid';
      const differentBotId = 'different-bot-uuid';

      await controller.deleteStaff(differentAppId, differentBotId, TENANT_ID);

      expect(commonStaffService.deleteStaff).toHaveBeenCalledWith(
        differentAppId,
        TENANT_ID,
        differentBotId,
      );
    });
  });

  // ── generatePersona ──────────────────────────────────────────────────────────

  describe('generatePersona', () => {
    const makePersonaDto = (
      overrides: Partial<GeneratePersonaDto> = {},
    ): GeneratePersonaDto => ({
      displayName: 'Alex',
      roleTitle: 'Engineer',
      ...overrides,
    });

    it('writes each chunk as an SSE data event', async () => {
      commonStaffService.generatePersona.mockReturnValueOnce(
        makeChunkGenerator(['chunk1', 'chunk2']),
      );
      const res = makeMockResponse();

      await controller.generatePersona(
        APP_ID,
        TENANT_ID,
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
        makePersonaDto(),
        res as any,
      );

      expect(order[0]).toBe('flush');
    });

    it('delegates to service.generatePersona with correct args', async () => {
      const res = makeMockResponse();
      const dto = makePersonaDto({ prompt: 'Make it quirky' });

      await controller.generatePersona(APP_ID, TENANT_ID, dto, res as any);

      expect(commonStaffService.generatePersona).toHaveBeenCalledWith(
        APP_ID,
        TENANT_ID,
        dto,
      );
    });

    it('handles empty stream (only [DONE] is written)', async () => {
      commonStaffService.generatePersona.mockReturnValueOnce(
        makeChunkGenerator([]),
      );
      const res = makeMockResponse();

      await controller.generatePersona(
        APP_ID,
        TENANT_ID,
        makePersonaDto(),
        res as any,
      );

      // Only the [DONE] sentinel should appear, no data chunks
      const dataChunks = res._written.filter(
        (w: string) => w !== 'data: [DONE]\n\n',
      );
      expect(dataChunks).toHaveLength(0);
      expect(res._written).toContain('data: [DONE]\n\n');
    });

    it('propagates errors from service.generatePersona', async () => {
      async function* errorStream(): AsyncGenerator<string> {
        throw new Error('Stream error');
      }
      commonStaffService.generatePersona.mockReturnValueOnce(errorStream());
      const res = makeMockResponse();

      await expect(
        controller.generatePersona(
          APP_ID,
          TENANT_ID,
          makePersonaDto(),
          res as any,
        ),
      ).rejects.toThrow('Stream error');
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

    it('calls service.generateAvatar with correct args', async () => {
      const dto = makeAvatarDto();
      await controller.generateAvatar(APP_ID, TENANT_ID, dto);

      expect(commonStaffService.generateAvatar).toHaveBeenCalledWith(
        APP_ID,
        TENANT_ID,
        dto,
      );
    });

    it('returns the avatarUrl from service', async () => {
      const expected = {
        avatarUrl: 'https://api.dicebear.com/9.x/avataaars/svg?seed=Alex',
      };
      commonStaffService.generateAvatar.mockResolvedValueOnce(expected);

      const result = await controller.generateAvatar(
        APP_ID,
        TENANT_ID,
        makeAvatarDto(),
      );

      expect(result).toEqual(expected);
    });

    it('propagates errors from service.generateAvatar', async () => {
      commonStaffService.generateAvatar.mockRejectedValueOnce(
        new Error('Avatar error'),
      );

      await expect(
        controller.generateAvatar(APP_ID, TENANT_ID, makeAvatarDto()),
      ).rejects.toThrow('Avatar error');
    });

    it('passes all optional dto fields through', async () => {
      const dto = makeAvatarDto({
        style: 'anime',
        displayName: 'Hikari',
        roleTitle: 'Developer',
        persona: 'Energetic and curious',
        prompt: 'With blue eyes',
      });
      await controller.generateAvatar(APP_ID, TENANT_ID, dto);

      expect(commonStaffService.generateAvatar).toHaveBeenCalledWith(
        APP_ID,
        TENANT_ID,
        expect.objectContaining({
          style: 'anime',
          displayName: 'Hikari',
          roleTitle: 'Developer',
          persona: 'Energetic and curious',
          prompt: 'With blue eyes',
        }),
      );
    });
  });

  // ── generateCandidates ────────────────────────────────────────────────────────

  describe('generateCandidates', () => {
    const makeCandidatesDto = (
      overrides: Partial<GenerateCandidatesDto> = {},
    ): GenerateCandidatesDto => ({
      jobTitle: 'Engineer',
      jobDescription: 'Builds things',
      ...overrides,
    });

    async function* makeCandidateStream(
      events: { type: 'candidate' | 'partial'; data: unknown }[],
    ) {
      for (const event of events) {
        yield event;
      }
    }

    it('writes each candidate event as an SSE data line', async () => {
      const events = [
        {
          type: 'candidate' as const,
          data: { candidateIndex: 1, displayName: 'Alice' },
        },
        {
          type: 'candidate' as const,
          data: { candidateIndex: 2, displayName: 'Bob' },
        },
      ];
      commonStaffService.generateCandidates.mockReturnValueOnce(
        makeCandidateStream(events),
      );
      const res = makeMockResponse();

      await controller.generateCandidates(
        APP_ID,
        TENANT_ID,
        makeCandidatesDto(),
        res as any,
      );

      expect(res._written).toContain(`data: ${JSON.stringify(events[0])}\n\n`);
      expect(res._written).toContain(`data: ${JSON.stringify(events[1])}\n\n`);
    });

    it('writes [DONE] sentinel at the end', async () => {
      const res = makeMockResponse();

      await controller.generateCandidates(
        APP_ID,
        TENANT_ID,
        makeCandidatesDto(),
        res as any,
      );

      expect(res._written).toContain('data: [DONE]\n\n');
    });

    it('calls res.end() after the stream completes', async () => {
      const res = makeMockResponse();

      await controller.generateCandidates(
        APP_ID,
        TENANT_ID,
        makeCandidatesDto(),
        res as any,
      );

      expect(res.end).toHaveBeenCalledTimes(1);
    });

    it('sets X-Accel-Buffering header to no', async () => {
      const res = makeMockResponse();

      await controller.generateCandidates(
        APP_ID,
        TENANT_ID,
        makeCandidatesDto(),
        res as any,
      );

      expect(res.setHeader).toHaveBeenCalledWith('X-Accel-Buffering', 'no');
    });

    it('calls flushHeaders before streaming', async () => {
      const res = makeMockResponse();
      const order: string[] = [];
      res.flushHeaders.mockImplementation(() => order.push('flush'));
      res.write.mockImplementation(() => order.push('write'));

      await controller.generateCandidates(
        APP_ID,
        TENANT_ID,
        makeCandidatesDto(),
        res as any,
      );

      expect(order[0]).toBe('flush');
    });

    it('delegates to service.generateCandidates with correct args', async () => {
      const res = makeMockResponse();
      const dto = makeCandidatesDto({ jobTitle: 'Designer' });

      await controller.generateCandidates(APP_ID, TENANT_ID, dto, res as any);

      expect(commonStaffService.generateCandidates).toHaveBeenCalledWith(
        APP_ID,
        TENANT_ID,
        dto,
      );
    });

    it('handles empty stream (only [DONE] is written)', async () => {
      commonStaffService.generateCandidates.mockReturnValueOnce(
        makeCandidateStream([]),
      );
      const res = makeMockResponse();

      await controller.generateCandidates(
        APP_ID,
        TENANT_ID,
        makeCandidatesDto(),
        res as any,
      );

      const dataChunks = res._written.filter(
        (w: string) => w !== 'data: [DONE]\n\n',
      );
      expect(dataChunks).toHaveLength(0);
      expect(res._written).toContain('data: [DONE]\n\n');
    });

    it('propagates errors from service.generateCandidates', async () => {
      async function* errorStream(): AsyncGenerator<{
        type: 'candidate' | 'partial';
        data: unknown;
      }> {
        throw new Error('Candidates stream error');
      }
      commonStaffService.generateCandidates.mockReturnValueOnce(errorStream());
      const res = makeMockResponse();

      await expect(
        controller.generateCandidates(
          APP_ID,
          TENANT_ID,
          makeCandidatesDto(),
          res as any,
        ),
      ).rejects.toThrow('Candidates stream error');
    });
  });
});
