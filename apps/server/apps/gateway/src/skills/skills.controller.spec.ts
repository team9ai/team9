import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { SkillsController } from './skills.controller.js';

describe('SkillsController', () => {
  let skillsService: {
    create: jest.Mock;
    list: jest.Mock;
    getById: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    listVersions: jest.Mock;
    getVersion: jest.Mock;
    createVersion: jest.Mock;
    reviewVersion: jest.Mock;
  };
  let controller: SkillsController;

  beforeEach(() => {
    skillsService = {
      create: jest.fn(),
      list: jest.fn(),
      getById: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      listVersions: jest.fn(),
      getVersion: jest.fn(),
      createVersion: jest.fn(),
      reviewVersion: jest.fn(),
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

  it('lists and reads skill versions', async () => {
    skillsService.listVersions.mockResolvedValue([{ version: 1 }]);
    skillsService.getVersion.mockResolvedValue({ version: 2 });

    await expect(
      controller.listVersions('skill-1', 'tenant-1'),
    ).resolves.toEqual([{ version: 1 }]);
    await expect(
      controller.getVersion('skill-1', 2, 'tenant-1'),
    ).resolves.toEqual({ version: 2 });

    expect(skillsService.listVersions).toHaveBeenCalledWith(
      'skill-1',
      'tenant-1',
    );
    expect(skillsService.getVersion).toHaveBeenCalledWith(
      'skill-1',
      2,
      'tenant-1',
    );
  });

  it('creates and reviews skill versions', async () => {
    skillsService.createVersion.mockResolvedValue({ version: 2 });
    skillsService.reviewVersion.mockResolvedValue({
      version: 2,
      status: 'approved',
    });

    await expect(
      controller.createVersion(
        'skill-1',
        { changelog: 'new' } as never,
        'user-1',
        'tenant-1',
      ),
    ).resolves.toEqual({ version: 2 });
    await expect(
      controller.reviewVersion(
        'skill-1',
        2,
        { action: 'approved' } as never,
        'tenant-1',
      ),
    ).resolves.toEqual({
      version: 2,
      status: 'approved',
    });

    expect(skillsService.createVersion).toHaveBeenCalledWith(
      'skill-1',
      { changelog: 'new' },
      'user-1',
      'tenant-1',
    );
    expect(skillsService.reviewVersion).toHaveBeenCalledWith(
      'skill-1',
      2,
      'approved',
      'tenant-1',
    );
  });
});
