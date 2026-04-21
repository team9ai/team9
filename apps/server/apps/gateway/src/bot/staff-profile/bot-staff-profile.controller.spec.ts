import { jest, describe, it, expect, beforeEach } from '@jest/globals';

jest.unstable_mockModule('@team9/auth', () => ({
  AuthGuard: class AuthGuard {},
  CurrentUser: () => () => undefined,
}));

jest.unstable_mockModule('./bot-staff-profile.service.js', () => ({
  BotStaffProfileService: class BotStaffProfileService {},
}));

const { BotStaffProfileController } =
  await import('./bot-staff-profile.controller.js');
const { BotStaffProfileService } =
  await import('./bot-staff-profile.service.js');

import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import type { StaffProfileSnapshot } from './bot-staff-profile.service.js';
import type { UpdateBotStaffProfileDto } from './bot-staff-profile.dto.js';

// ── Types ──────────────────────────────────────────────────────────────────────
type MockFn = jest.Mock<(...args: any[]) => any>;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BOT_USER_ID = 'bot-user-uuid-1234';

const makeSnapshot = (
  overrides: Partial<StaffProfileSnapshot> = {},
): StaffProfileSnapshot => ({
  agentId: 'agent-uuid-1234',
  botUserId: BOT_USER_ID,
  identity: { name: 'Test Bot' },
  role: { title: 'Assistant', description: 'Helpful assistant' },
  persona: { markdown: 'You are helpful.' },
  updatedAt: '2026-04-21T00:00:00.000Z',
  ...overrides,
});

const makeUpdateDto = (
  overrides: Partial<UpdateBotStaffProfileDto> = {},
): UpdateBotStaffProfileDto =>
  ({
    identityPatch: { name: 'Updated Bot' },
    ...overrides,
  }) as UpdateBotStaffProfileDto;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BotStaffProfileController', () => {
  let controller: InstanceType<typeof BotStaffProfileController>;
  let service: {
    getSnapshot: MockFn;
    updateSnapshot: MockFn;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BotStaffProfileController],
      providers: [BotStaffProfileService],
    }).compile();

    controller = module.get(BotStaffProfileController);
    service = module.get(BotStaffProfileService);

    service.getSnapshot = jest.fn<MockFn>();
    service.updateSnapshot = jest.fn<MockFn>();
  });

  // ── GET /api/v1/bot/staff/profile ──────────────────────────────────────────

  describe('GET /api/v1/bot/staff/profile', () => {
    it('returns snapshot from service when header matches authenticated user', async () => {
      const snapshot = makeSnapshot();
      service.getSnapshot.mockResolvedValue(snapshot);

      const result = await controller.get(BOT_USER_ID, BOT_USER_ID);

      expect(result).toEqual(snapshot);
    });

    it('throws ForbiddenException with correct message when header is missing', async () => {
      await expect(controller.get(BOT_USER_ID, undefined)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(
        controller.get(BOT_USER_ID, undefined),
      ).rejects.toMatchObject({
        message: 'X-Team9-Bot-User-Id does not match authenticated bot',
      });
    });

    it('throws ForbiddenException with correct message when header does not match sub', async () => {
      await expect(
        controller.get(BOT_USER_ID, 'different-user-id'),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        controller.get(BOT_USER_ID, 'different-user-id'),
      ).rejects.toMatchObject({
        message: 'X-Team9-Bot-User-Id does not match authenticated bot',
      });
    });

    it('throws ForbiddenException when header is empty string', async () => {
      await expect(controller.get(BOT_USER_ID, '')).rejects.toThrow(
        ForbiddenException,
      );
      await expect(controller.get(BOT_USER_ID, '')).rejects.toMatchObject({
        message: 'X-Team9-Bot-User-Id does not match authenticated bot',
      });
    });

    it('passes the authenticated user id (not the header) to the service', async () => {
      const snapshot = makeSnapshot();
      service.getSnapshot.mockResolvedValue(snapshot);

      await controller.get(BOT_USER_ID, BOT_USER_ID);

      expect(service.getSnapshot).toHaveBeenCalledWith(BOT_USER_ID);
      expect(service.getSnapshot).toHaveBeenCalledTimes(1);
    });
  });

  // ── PATCH /api/v1/bot/staff/profile ────────────────────────────────────────

  describe('PATCH /api/v1/bot/staff/profile', () => {
    it('returns updated snapshot from service when header matches and body valid', async () => {
      const snapshot = makeSnapshot({ identity: { name: 'Updated Bot' } });
      service.updateSnapshot.mockResolvedValue(snapshot);
      const dto = makeUpdateDto();

      const result = await controller.patch(BOT_USER_ID, BOT_USER_ID, dto);

      expect(result).toEqual(snapshot);
    });

    it('throws ForbiddenException when header missing on PATCH', async () => {
      const dto = makeUpdateDto();

      await expect(
        controller.patch(BOT_USER_ID, undefined, dto),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        controller.patch(BOT_USER_ID, undefined, dto),
      ).rejects.toMatchObject({
        message: 'X-Team9-Bot-User-Id does not match authenticated bot',
      });
    });

    it('throws ForbiddenException when header does not match sub on PATCH', async () => {
      const dto = makeUpdateDto();

      await expect(
        controller.patch(BOT_USER_ID, 'wrong-user-id', dto),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        controller.patch(BOT_USER_ID, 'wrong-user-id', dto),
      ).rejects.toMatchObject({
        message: 'X-Team9-Bot-User-Id does not match authenticated bot',
      });
    });

    it('forwards dto fields (identityPatch, role, persona) to service.updateSnapshot', async () => {
      const snapshot = makeSnapshot();
      service.updateSnapshot.mockResolvedValue(snapshot);
      const dto = makeUpdateDto({
        identityPatch: { name: 'Bot Name' },
        role: { title: 'Analyst', description: 'Data analyst' } as any,
        persona: { mode: 'replace', content: 'You are analytical.' } as any,
      });

      await controller.patch(BOT_USER_ID, BOT_USER_ID, dto);

      expect(service.updateSnapshot).toHaveBeenCalledWith(BOT_USER_ID, {
        identityPatch: { name: 'Bot Name' },
        role: { title: 'Analyst', description: 'Data analyst' },
        persona: { mode: 'replace', content: 'You are analytical.' },
      });
    });

    it('forwards partial dto correctly — only persona set, others undefined', async () => {
      const snapshot = makeSnapshot();
      service.updateSnapshot.mockResolvedValue(snapshot);
      const dto = makeUpdateDto({
        identityPatch: undefined,
        role: undefined,
        persona: { mode: 'append', content: 'Extra context.' } as any,
      });

      await controller.patch(BOT_USER_ID, BOT_USER_ID, dto);

      expect(service.updateSnapshot).toHaveBeenCalledWith(BOT_USER_ID, {
        identityPatch: undefined,
        role: undefined,
        persona: { mode: 'append', content: 'Extra context.' },
      });
    });
  });
});
