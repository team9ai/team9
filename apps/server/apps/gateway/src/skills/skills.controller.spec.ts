import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { SkillsController } from './skills.controller.js';

describe('SkillsController', () => {
  let skillsService: {
    create: jest.Mock;
    list: jest.Mock;
    getById: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    getSkillFolderTree: jest.Mock;
    getSkillFolderBlob: jest.Mock;
    commitSkillFolder: jest.Mock;
  };
  let controller: SkillsController;

  beforeEach(() => {
    skillsService = {
      create: jest.fn(),
      list: jest.fn(),
      getById: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      getSkillFolderTree: jest.fn(),
      getSkillFolderBlob: jest.fn(),
      commitSkillFolder: jest.fn(),
    };
    controller = new SkillsController(skillsService as never);
  });

  it('creates and lists skills for a tenant', async () => {
    skillsService.create.mockResolvedValue({ id: 'skill-1' });
    skillsService.list.mockResolvedValue([{ id: 'skill-1' }]);

    await expect(
      controller.create({ name: 'Skill A' } as never, 'user-1', 'tenant-1'),
    ).resolves.toEqual({ id: 'skill-1' });
    await expect(
      controller.list('tenant-1', 'prompt' as never),
    ).resolves.toEqual([{ id: 'skill-1' }]);

    expect(skillsService.create).toHaveBeenCalledWith(
      { name: 'Skill A' },
      'user-1',
      'tenant-1',
      { agentAccess: 'read' },
    );
    expect(skillsService.list).toHaveBeenCalledWith('tenant-1', 'prompt');
  });

  it('gets, updates, and deletes a skill', async () => {
    skillsService.getById.mockResolvedValue({ id: 'skill-1' });
    skillsService.update.mockResolvedValue({ id: 'skill-1', name: 'Updated' });
    skillsService.delete.mockResolvedValue({ success: true });

    await expect(controller.getById('skill-1', 'tenant-1')).resolves.toEqual({
      id: 'skill-1',
    });
    await expect(
      controller.update('skill-1', { name: 'Updated' } as never, 'tenant-1'),
    ).resolves.toEqual({
      id: 'skill-1',
      name: 'Updated',
    });
    await expect(controller.delete('skill-1', 'tenant-1')).resolves.toEqual({
      success: true,
    });

    expect(skillsService.getById).toHaveBeenCalledWith('skill-1', 'tenant-1');
    expect(skillsService.update).toHaveBeenCalledWith(
      'skill-1',
      { name: 'Updated' },
      'tenant-1',
    );
    expect(skillsService.delete).toHaveBeenCalledWith('skill-1', 'tenant-1');
  });

  it("passes hardcoded { agentAccess: 'read' } as 4th argument to service.create", async () => {
    skillsService.create.mockResolvedValue({ id: 'skill-2' });

    await controller.create(
      { name: 'Skill B', type: 'prompt', agentAccess: 'none' } as never,
      'user-1',
      'tenant-1',
    );

    expect(skillsService.create).toHaveBeenCalledWith(
      { name: 'Skill B', type: 'prompt', agentAccess: 'none' },
      'user-1',
      'tenant-1',
      { agentAccess: 'read' },
    );
  });

  it('getFolderTree forwards path and recursive flags to service', async () => {
    skillsService.getSkillFolderTree.mockResolvedValue([]);

    await controller.getFolderTree(
      'skill-1',
      'user-1',
      'tenant-1',
      '/sub',
      'true',
    );

    expect(skillsService.getSkillFolderTree).toHaveBeenCalledWith(
      'skill-1',
      'user-1',
      'tenant-1',
      { path: '/sub', recursive: true },
    );
  });

  it('getFolderBlob forwards path to service', async () => {
    skillsService.getSkillFolderBlob.mockResolvedValue({ content: '' });

    await controller.getFolderBlob(
      'skill-1',
      'user-1',
      'tenant-1',
      '/skill.md',
    );

    expect(skillsService.getSkillFolderBlob).toHaveBeenCalledWith(
      'skill-1',
      'user-1',
      'tenant-1',
      '/skill.md',
    );
  });

  it('commitFolder forwards dto to service', async () => {
    skillsService.commitSkillFolder.mockResolvedValue({ commitId: 'x' });

    const dto = {
      message: 'm',
      files: [{ path: 'a', content: 'b', action: 'create' as const }],
    };
    await controller.commitFolder(
      'skill-1',
      'user-1',
      'tenant-1',
      dto as never,
    );

    expect(skillsService.commitSkillFolder).toHaveBeenCalledWith(
      'skill-1',
      'user-1',
      'tenant-1',
      dto,
    );
  });
});
