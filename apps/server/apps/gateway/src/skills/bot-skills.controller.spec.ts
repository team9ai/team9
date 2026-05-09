import { jest, describe, it, expect, beforeEach } from '@jest/globals';

jest.unstable_mockModule('@team9/auth', () => ({
  AuthGuard: class AuthGuard {},
  CurrentUser: () => () => undefined,
}));

jest.unstable_mockModule('./skills.service.js', () => ({
  SkillsService: class SkillsService {},
}));

jest.unstable_mockModule(
  '../common/decorators/current-tenant.decorator.js',
  () => ({
    CurrentTenantId: () => () => undefined,
  }),
);

const { BotSkillsController } = await import('./bot-skills.controller.js');
const { SkillsService } = await import('./skills.service.js');

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

// ── Types ──────────────────────────────────────────────────────────────────────
type MockFn = jest.Mock<(...args: any[]) => any>;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BOT_USER_ID = 'bot-uuid-1234';
const TENANT_ID = 'tenant-uuid-1234';
const SKILL_ID = 'skill-uuid-1234';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BotSkillsController', () => {
  let controller: InstanceType<typeof BotSkillsController>;
  let service: {
    listForAgent: MockFn;
    getByIdForAgent: MockFn;
    getFolderBlobForAgent: MockFn;
    create: MockFn;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BotSkillsController],
      providers: [SkillsService],
    }).compile();

    controller = module.get(BotSkillsController);
    service = module.get(SkillsService);

    service.listForAgent = jest.fn<MockFn>();
    service.getByIdForAgent = jest.fn<MockFn>();
    service.getFolderBlobForAgent = jest.fn<MockFn>();
    service.create = jest.fn<MockFn>();
  });

  // ── Auth mismatch ──────────────────────────────────────────────────────────

  describe('bot auth guard', () => {
    it('rejects list when header bot id mismatches authenticated user', async () => {
      await expect(
        controller.list(BOT_USER_ID, 'other-id', TENANT_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects list when header bot id is missing', async () => {
      await expect(
        controller.list(BOT_USER_ID, undefined, TENANT_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects list when header bot id is empty string', async () => {
      await expect(
        controller.list(BOT_USER_ID, '', TENANT_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects getById when header bot id mismatches authenticated user', async () => {
      await expect(
        controller.getById(SKILL_ID, BOT_USER_ID, 'other-id', TENANT_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects getFolderBlob when header bot id mismatches authenticated user', async () => {
      await expect(
        controller.getFolderBlob(
          SKILL_ID,
          BOT_USER_ID,
          'other-id',
          TENANT_ID,
          'skill.md',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects create when header bot id mismatches authenticated user', async () => {
      await expect(
        controller.create(
          { name: 'X', type: 'general' },
          BOT_USER_ID,
          'other-id',
          TENANT_ID,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // ── GET /v1/bot/skills ─────────────────────────────────────────────────────

  describe('list', () => {
    it('calls listForAgent with tenantId and no filters when none provided', async () => {
      service.listForAgent.mockResolvedValue([]);
      await controller.list(BOT_USER_ID, BOT_USER_ID, TENANT_ID);
      expect(service.listForAgent).toHaveBeenCalledWith(TENANT_ID, {
        type: undefined,
        name: undefined,
      });
    });

    it('passes type and name filters through to listForAgent', async () => {
      service.listForAgent.mockResolvedValue([]);
      await controller.list(
        BOT_USER_ID,
        BOT_USER_ID,
        TENANT_ID,
        'general',
        'deploy',
      );
      expect(service.listForAgent).toHaveBeenCalledWith(TENANT_ID, {
        type: 'general',
        name: 'deploy',
      });
    });

    it('returns the result from listForAgent', async () => {
      const skills = [{ id: 'skill-1', name: 'S1', agentAccess: 'read' }];
      service.listForAgent.mockResolvedValue(skills);
      const result = await controller.list(BOT_USER_ID, BOT_USER_ID, TENANT_ID);
      expect(result).toEqual(skills);
    });
  });

  // ── GET /v1/bot/skills/:id ─────────────────────────────────────────────────

  describe('getById', () => {
    it('returns skill from service', async () => {
      const skill = { id: SKILL_ID, name: 'S1', agentAccess: 'read' };
      service.getByIdForAgent.mockResolvedValue(skill);
      const result = await controller.getById(
        SKILL_ID,
        BOT_USER_ID,
        BOT_USER_ID,
        TENANT_ID,
      );
      expect(result).toEqual(skill);
      expect(service.getByIdForAgent).toHaveBeenCalledWith(SKILL_ID, TENANT_ID);
    });

    it('forwards ForbiddenException from service when skill is hidden', async () => {
      service.getByIdForAgent.mockRejectedValue(
        new ForbiddenException('Skill is hidden from agents'),
      );
      await expect(
        controller.getById(SKILL_ID, BOT_USER_ID, BOT_USER_ID, TENANT_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // ── GET /v1/bot/skills/:id/folder/blob ────────────────────────────────────

  describe('getFolderBlob', () => {
    it('throws BadRequestException when path is empty', async () => {
      await expect(
        controller.getFolderBlob(
          SKILL_ID,
          BOT_USER_ID,
          BOT_USER_ID,
          TENANT_ID,
          '',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException with path message when path is empty', async () => {
      await expect(
        controller.getFolderBlob(
          SKILL_ID,
          BOT_USER_ID,
          BOT_USER_ID,
          TENANT_ID,
          '',
        ),
      ).rejects.toThrow(/path/);
    });

    it('calls getFolderBlobForAgent with correct args when path is provided', async () => {
      const blobResponse = {
        path: 'skill.md',
        size: 42,
        content: '# My Skill',
        encoding: 'text',
      };
      service.getFolderBlobForAgent.mockResolvedValue(blobResponse);
      const result = await controller.getFolderBlob(
        SKILL_ID,
        BOT_USER_ID,
        BOT_USER_ID,
        TENANT_ID,
        'skill.md',
      );
      expect(result).toEqual(blobResponse);
      expect(service.getFolderBlobForAgent).toHaveBeenCalledWith(
        SKILL_ID,
        BOT_USER_ID,
        TENANT_ID,
        'skill.md',
      );
    });

    it('forwards ForbiddenException from service when skill is hidden', async () => {
      service.getFolderBlobForAgent.mockRejectedValue(
        new ForbiddenException('Skill is hidden from agents'),
      );
      await expect(
        controller.getFolderBlob(
          SKILL_ID,
          BOT_USER_ID,
          BOT_USER_ID,
          TENANT_ID,
          'skill.md',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // ── POST /v1/bot/skills ────────────────────────────────────────────────────

  describe('create', () => {
    it('defaults agentAccess to write by passing it to service.create', async () => {
      service.create.mockResolvedValue({
        id: 'new-skill',
        agentAccess: 'write',
      } as never);
      await controller.create(
        { name: 'X', type: 'general' },
        BOT_USER_ID,
        BOT_USER_ID,
        TENANT_ID,
      );
      expect(service.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'X' }),
        BOT_USER_ID,
        TENANT_ID,
        { agentAccess: 'write' },
      );
    });

    it('returns the created skill from service', async () => {
      const newSkill = { id: 'new-skill', name: 'X', agentAccess: 'write' };
      service.create.mockResolvedValue(newSkill as never);
      const result = await controller.create(
        { name: 'X', type: 'general' },
        BOT_USER_ID,
        BOT_USER_ID,
        TENANT_ID,
      );
      expect(result).toEqual(newSkill);
    });
  });
});
