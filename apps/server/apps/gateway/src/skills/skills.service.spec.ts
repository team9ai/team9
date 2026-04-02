import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { BadRequestException, NotFoundException } from '@nestjs/common';

let uuidCounter = 0;
jest.unstable_mockModule('uuid', () => ({
  v7: jest.fn(() => `uuid-${++uuidCounter}`),
}));

const { SkillsService } = await import('./skills.service.js');

type Plan = { terminal: 'where' | 'limit' | 'orderBy'; result: unknown[] };
type InsertPlan = { terminal: 'values' | 'returning'; result?: unknown[] };
type UpdatePlan = { terminal: 'where' | 'returning'; result?: unknown[] };

function createSelectBuilder(plan: Plan) {
  const chain: Record<string, jest.Mock> = {
    from: jest.fn(),
    where: jest.fn(),
    limit: jest.fn(),
    orderBy: jest.fn(),
  };

  chain.from.mockReturnValue(chain);
  chain.where.mockImplementation(() => {
    if (plan.terminal === 'where') {
      return Promise.resolve(plan.result);
    }
    return chain;
  });
  chain.limit.mockImplementation(() => {
    if (plan.terminal !== 'limit') {
      throw new Error('Unexpected limit() call');
    }
    return Promise.resolve(plan.result);
  });
  chain.orderBy.mockImplementation(() => {
    if (plan.terminal !== 'orderBy') {
      throw new Error('Unexpected orderBy() call');
    }
    return Promise.resolve(plan.result);
  });

  return chain;
}

function createInsertBuilder(plan: InsertPlan, insertValues: unknown[]) {
  const chain: Record<string, jest.Mock> = {
    values: jest.fn(),
    returning: jest.fn(),
  };

  chain.values.mockImplementation((value: unknown) => {
    insertValues.push(value);
    if (plan.terminal === 'values') {
      return Promise.resolve(undefined);
    }
    return chain;
  });
  chain.returning.mockImplementation(() => {
    if (plan.terminal !== 'returning') {
      throw new Error('Unexpected returning() call');
    }
    return Promise.resolve(plan.result ?? []);
  });

  return chain;
}

function createUpdateBuilder(plan: UpdatePlan, updateSets: unknown[]) {
  const chain: Record<string, jest.Mock> = {
    set: jest.fn(),
    where: jest.fn(),
    returning: jest.fn(),
  };

  chain.set.mockImplementation((value: unknown) => {
    updateSets.push(value);
    return chain;
  });
  chain.where.mockImplementation(() => {
    if (plan.terminal === 'where') {
      return Promise.resolve(plan.result ?? []);
    }
    return chain;
  });
  chain.returning.mockImplementation(() => {
    if (plan.terminal !== 'returning') {
      throw new Error('Unexpected returning() call');
    }
    return Promise.resolve(plan.result ?? []);
  });

  return chain;
}

function createDeleteBuilder(deleteResults: unknown[]) {
  return {
    where: jest.fn().mockResolvedValue(deleteResults),
  };
}

describe('SkillsService', () => {
  let selectPlans: Plan[];
  let insertPlans: InsertPlan[];
  let updatePlans: UpdatePlan[];
  let deleteResults: unknown[];
  let insertValues: unknown[];
  let updateSets: unknown[];
  let db: {
    select: jest.Mock;
    insert: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  let service: InstanceType<typeof SkillsService>;

  beforeEach(() => {
    uuidCounter = 0;
    selectPlans = [];
    insertPlans = [];
    updatePlans = [];
    deleteResults = [];
    insertValues = [];
    updateSets = [];

    db = {
      select: jest.fn(() => {
        const plan = selectPlans.shift();
        if (!plan) throw new Error('Missing select plan');
        return createSelectBuilder(plan);
      }),
      insert: jest.fn(() => {
        const plan = insertPlans.shift();
        if (!plan) throw new Error('Missing insert plan');
        return createInsertBuilder(plan, insertValues);
      }),
      update: jest.fn(() => {
        const plan = updatePlans.shift();
        if (!plan) throw new Error('Missing update plan');
        return createUpdateBuilder(plan, updateSets);
      }),
      delete: jest.fn(() => createDeleteBuilder(deleteResults)),
    };

    service = new SkillsService(db as never);
  });

  it('creates a skill without files and keeps currentVersion at zero', async () => {
    insertPlans.push({
      terminal: 'returning',
      result: [{ id: 'skill-1', name: 'Skill A', currentVersion: 0 }],
    });

    await expect(
      service.create(
        {
          name: 'Skill A',
          description: 'desc',
          type: 'prompt',
        } as never,
        'user-1',
        'tenant-1',
      ),
    ).resolves.toEqual({
      id: 'skill-1',
      name: 'Skill A',
      currentVersion: 0,
    });

    expect(insertValues[0]).toEqual(
      expect.objectContaining({
        id: 'uuid-1',
        tenantId: 'tenant-1',
        name: 'Skill A',
        description: 'desc',
        type: 'prompt',
        currentVersion: 0,
        creatorId: 'user-1',
      }),
    );
  });

  it('creates an initial published version when files are provided', async () => {
    insertPlans.push(
      {
        terminal: 'returning',
        result: [{ id: 'skill-1', name: 'Skill A', currentVersion: 1 }],
      },
      { terminal: 'values' },
      { terminal: 'values' },
      {
        terminal: 'returning',
        result: [{ id: 'version-1', skillId: 'uuid-1', version: 1 }],
      },
    );

    await service.create(
      {
        name: 'Skill A',
        type: 'prompt',
        files: [
          { path: 'README.md', content: 'hello' },
          { path: 'prompt.txt', content: 'world' },
        ],
      } as never,
      'user-1',
      'tenant-1',
    );

    expect(insertValues[0]).toEqual(
      expect.objectContaining({
        currentVersion: 1,
      }),
    );
    expect(insertValues[1]).toEqual(
      expect.objectContaining({
        skillId: 'uuid-1',
        path: 'README.md',
        content: 'hello',
        size: 5,
      }),
    );
    expect(insertValues[2]).toEqual(
      expect.objectContaining({
        skillId: 'uuid-1',
        path: 'prompt.txt',
        content: 'world',
        size: 5,
      }),
    );
    expect(insertValues[3]).toEqual(
      expect.objectContaining({
        skillId: 'uuid-1',
        version: 1,
        status: 'published',
        message: 'Initial version',
        creatorId: 'user-1',
        fileManifest: [
          { path: 'README.md', fileId: 'uuid-2' },
          { path: 'prompt.txt', fileId: 'uuid-3' },
        ],
      }),
    );
  });

  it('lists skills with pending suggestion counts and optional type filters', async () => {
    selectPlans.push(
      {
        terminal: 'orderBy',
        result: [
          { id: 'skill-1', name: 'One' },
          { id: 'skill-2', name: 'Two' },
        ],
      },
      {
        terminal: 'where',
        result: [{ skillId: 'skill-1' }, { skillId: 'skill-1' }],
      },
    );

    await expect(service.list('tenant-1', 'prompt' as never)).resolves.toEqual([
      { id: 'skill-1', name: 'One', pendingSuggestionsCount: 2 },
      { id: 'skill-2', name: 'Two', pendingSuggestionsCount: 0 },
    ]);
  });

  it('returns an empty list when there are no skills', async () => {
    selectPlans.push({ terminal: 'orderBy', result: [] });

    await expect(service.list('tenant-1')).resolves.toEqual([]);
  });

  it('hydrates current version files and pending suggestions in getById', async () => {
    selectPlans.push(
      {
        terminal: 'limit',
        result: [{ id: 'skill-1', currentVersion: 2, name: 'Skill A' }],
      },
      {
        terminal: 'limit',
        result: [
          {
            id: 'version-2',
            skillId: 'skill-1',
            version: 2,
            fileManifest: [
              { path: 'README.md', fileId: 'file-1' },
              { path: 'prompt.txt', fileId: 'file-2' },
            ],
          },
        ],
      },
      {
        terminal: 'where',
        result: [
          { id: 'file-1', path: 'README.md' },
          { id: 'file-2', path: 'prompt.txt' },
        ],
      },
      {
        terminal: 'where',
        result: [{ id: 'suggested-1', status: 'suggested' }],
      },
    );

    await expect(service.getById('skill-1', 'tenant-1')).resolves.toEqual({
      id: 'skill-1',
      currentVersion: 2,
      name: 'Skill A',
      currentVersionInfo: {
        id: 'version-2',
        skillId: 'skill-1',
        version: 2,
        fileManifest: [
          { path: 'README.md', fileId: 'file-1' },
          { path: 'prompt.txt', fileId: 'file-2' },
        ],
      },
      files: [
        { id: 'file-1', path: 'README.md' },
        { id: 'file-2', path: 'prompt.txt' },
      ],
      pendingSuggestions: [{ id: 'suggested-1', status: 'suggested' }],
    });
  });

  it('updates a skill with only the provided fields', async () => {
    selectPlans.push({
      terminal: 'limit',
      result: [{ id: 'skill-1', tenantId: 'tenant-1' }],
    });
    updatePlans.push({
      terminal: 'returning',
      result: [{ id: 'skill-1', name: 'Updated', icon: 'new-icon' }],
    });

    await expect(
      service.update(
        'skill-1',
        { name: 'Updated', icon: 'new-icon' } as never,
        'tenant-1',
      ),
    ).resolves.toEqual({
      id: 'skill-1',
      name: 'Updated',
      icon: 'new-icon',
    });

    expect(updateSets[0]).toEqual(
      expect.objectContaining({
        name: 'Updated',
        icon: 'new-icon',
        updatedAt: expect.any(Date),
      }),
    );
    expect(
      (updateSets[0] as Record<string, unknown>).description,
    ).toBeUndefined();
  });

  it('deletes a skill after validating tenant ownership', async () => {
    selectPlans.push({
      terminal: 'limit',
      result: [{ id: 'skill-1', tenantId: 'tenant-1' }],
    });

    await expect(service.delete('skill-1', 'tenant-1')).resolves.toEqual({
      success: true,
    });

    expect(db.delete).toHaveBeenCalled();
  });

  it('returns version files and throws when the version is missing', async () => {
    selectPlans.push(
      {
        terminal: 'limit',
        result: [{ id: 'skill-1', tenantId: 'tenant-1' }],
      },
      {
        terminal: 'limit',
        result: [
          {
            id: 'version-2',
            skillId: 'skill-1',
            version: 2,
            fileManifest: [{ path: 'README.md', fileId: 'file-1' }],
          },
        ],
      },
      {
        terminal: 'where',
        result: [{ id: 'file-1', path: 'README.md' }],
      },
      {
        terminal: 'limit',
        result: [{ id: 'skill-1', tenantId: 'tenant-1' }],
      },
      {
        terminal: 'limit',
        result: [],
      },
    );

    await expect(service.getVersion('skill-1', 2, 'tenant-1')).resolves.toEqual(
      {
        id: 'version-2',
        skillId: 'skill-1',
        version: 2,
        fileManifest: [{ path: 'README.md', fileId: 'file-1' }],
        files: [{ id: 'file-1', path: 'README.md' }],
      },
    );

    await expect(service.getVersion('skill-1', 99, 'tenant-1')).rejects.toThrow(
      new NotFoundException('Version not found'),
    );
  });

  it('creates a published version and bumps currentVersion', async () => {
    selectPlans.push({
      terminal: 'limit',
      result: [{ id: 'skill-1', currentVersion: 2, tenantId: 'tenant-1' }],
    });
    insertPlans.push(
      { terminal: 'values' },
      {
        terminal: 'returning',
        result: [{ id: 'version-3', version: 3, status: 'published' }],
      },
    );
    updatePlans.push({ terminal: 'where' });

    await expect(
      service.createVersion(
        'skill-1',
        {
          message: 'Add examples',
          status: 'published',
          files: [{ path: 'README.md', content: 'hello again' }],
        } as never,
        'user-1',
        'tenant-1',
      ),
    ).resolves.toEqual({
      id: 'version-3',
      version: 3,
      status: 'published',
    });

    expect(insertValues[0]).toEqual(
      expect.objectContaining({
        path: 'README.md',
        content: 'hello again',
      }),
    );
    expect(insertValues[1]).toEqual(
      expect.objectContaining({
        skillId: 'skill-1',
        version: 3,
        status: 'published',
        message: 'Add examples',
        creatorId: 'user-1',
      }),
    );
    expect(updateSets[0]).toEqual(
      expect.objectContaining({
        currentVersion: 3,
        updatedAt: expect.any(Date),
      }),
    );
  });

  it('reviews suggested versions and rejects invalid review attempts', async () => {
    selectPlans.push(
      {
        terminal: 'limit',
        result: [{ id: 'skill-1', tenantId: 'tenant-1' }],
      },
      {
        terminal: 'limit',
        result: [{ id: 'version-2', status: 'suggested' }],
      },
      {
        terminal: 'limit',
        result: [{ id: 'skill-1', tenantId: 'tenant-1' }],
      },
      {
        terminal: 'limit',
        result: [{ id: 'version-3', status: 'published' }],
      },
    );
    updatePlans.push({ terminal: 'where' }, { terminal: 'where' });

    await expect(
      service.reviewVersion('skill-1', 2, 'approve', 'tenant-1'),
    ).resolves.toEqual({ success: true });

    expect(updateSets[0]).toEqual({ status: 'published' });
    expect(updateSets[1]).toEqual(
      expect.objectContaining({
        currentVersion: 2,
        updatedAt: expect.any(Date),
      }),
    );

    await expect(
      service.reviewVersion('skill-1', 3, 'reject', 'tenant-1'),
    ).rejects.toThrow(
      new BadRequestException('Only suggested versions can be reviewed'),
    );
  });
});
