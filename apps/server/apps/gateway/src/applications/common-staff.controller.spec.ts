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

describe('CommonStaffController', () => {
  let controller: InstanceType<typeof CommonStaffController>;
  let commonStaffService: {
    createStaff: MockFn;
    updateStaff: MockFn;
    deleteStaff: MockFn;
  };

  beforeEach(async () => {
    commonStaffService = {
      createStaff: jest.fn<any>().mockResolvedValue(makeStaffResult()),
      updateStaff: jest.fn<any>().mockResolvedValue(undefined),
      deleteStaff: jest.fn<any>().mockResolvedValue(undefined),
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
});
