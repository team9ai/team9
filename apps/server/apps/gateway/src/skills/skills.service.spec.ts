import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';

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
  const userId = 'user-1';
  const tenantId = 'tenant-1';

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
  let folder9Client: {
    createFolder: jest.Mock;
    createToken: jest.Mock;
    commit: jest.Mock;
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

    folder9Client = {
      createFolder: jest.fn(async () => ({ id: 'folder-1' })),
      createToken: jest.fn(async () => ({ token: 'folder-token-1' })),
      commit: jest.fn(async () => ({ commit: 'commit-1', branch: 'main' })),
    };

    service = new SkillsService(db as never, folder9Client as never);
  });

  it('creates a light folder skill with a default skill.md', async () => {
    insertPlans.push({
      terminal: 'returning',
      result: [
        {
          id: 'skill-1',
          name: 'Skill A',
          agentAccess: 'read',
          folderId: 'folder-1',
        },
      ],
    });

    await expect(
      service.create(
        {
          name: 'Skill A',
          description: 'desc',
        },
        userId,
        tenantId,
      ),
    ).resolves.toEqual({
      id: 'skill-1',
      name: 'Skill A',
      agentAccess: 'read',
      folderId: 'folder-1',
    });

    expect(folder9Client.createFolder).toHaveBeenCalledWith(tenantId, {
      name: 'Skill A',
      type: 'light',
      owner_type: 'workspace',
      owner_id: tenantId,
      approval_mode: 'auto',
      metadata: { team9_kind: 'skill', team9_skill_id: 'uuid-1' },
    });
    expect(folder9Client.createToken).toHaveBeenCalledWith(
      expect.objectContaining({
        folder_id: 'folder-1',
        permission: 'write',
        created_by: 'user:user-1',
      }),
    );
    expect(folder9Client.commit).toHaveBeenCalledWith(
      tenantId,
      'folder-1',
      'folder-token-1',
      {
        message: 'Initialize skill',
        files: [
          {
            path: 'skill.md',
            content: expect.stringContaining('# Skill A'),
            action: 'create',
          },
        ],
      },
    );
    expect(insertValues[0]).toEqual(
      expect.objectContaining({
        id: 'uuid-1',
        tenantId,
        name: 'Skill A',
        description: 'desc',
        type: 'general',
        agentAccess: 'read',
        folderId: 'folder-1',
        creatorId: userId,
      }),
    );
  });

  it('seeds uploaded files into the light folder without creating DB file versions', async () => {
    insertPlans.push({
      terminal: 'returning',
      result: [
        {
          id: 'skill-1',
          name: 'Skill A',
          agentAccess: 'read',
          folderId: 'folder-1',
        },
      ],
    });

    await service.create(
      {
        name: 'Skill A',
        files: [
          { path: 'README.md', content: 'hello' },
          { path: 'prompt.txt', content: 'world' },
        ],
      },
      userId,
      tenantId,
    );

    expect(insertValues[0]).toEqual(
      expect.objectContaining({
        agentAccess: 'read',
        folderId: 'folder-1',
      }),
    );
    expect(insertValues).toHaveLength(1);
    expect(folder9Client.commit).toHaveBeenCalledWith(
      tenantId,
      'folder-1',
      'folder-token-1',
      {
        message: 'Initialize skill',
        files: [
          {
            path: 'skill.md',
            content: expect.stringContaining('# Skill A'),
            action: 'create',
          },
          { path: 'README.md', content: 'hello', action: 'create' },
          { path: 'prompt.txt', content: 'world', action: 'create' },
        ],
      },
    );
  });

  it('persists agentAccess from dto when provided', async () => {
    insertPlans.push({
      terminal: 'returning',
      result: [
        {
          id: 'skill-1',
          name: 'X',
          agentAccess: 'write',
          folderId: 'folder-1',
        },
      ],
    });

    const skill = await service.create(
      { name: 'X', type: 'general', agentAccess: 'write' },
      userId,
      tenantId,
    );

    expect(skill.agentAccess).toBe('write');
    expect(insertValues[0]).toEqual(
      expect.objectContaining({ agentAccess: 'write' }),
    );
  });

  it('uses caller-supplied default for agentAccess when dto omits it', async () => {
    insertPlans.push(
      {
        terminal: 'returning',
        result: [
          {
            id: 'skill-a',
            name: 'A',
            agentAccess: 'read',
            folderId: 'folder-1',
          },
        ],
      },
      {
        terminal: 'returning',
        result: [
          {
            id: 'skill-b',
            name: 'B',
            agentAccess: 'write',
            folderId: 'folder-2',
          },
        ],
      },
    );
    folder9Client.createFolder
      .mockResolvedValueOnce({ id: 'folder-1' })
      .mockResolvedValueOnce({ id: 'folder-2' });
    folder9Client.createToken
      .mockResolvedValueOnce({ token: 'token-1' })
      .mockResolvedValueOnce({ token: 'token-2' });

    const a = await service.create(
      { name: 'A', type: 'general' },
      userId,
      tenantId,
      { agentAccess: 'read' },
    );
    expect(a.agentAccess).toBe('read');
    expect(insertValues[0]).toEqual(
      expect.objectContaining({ agentAccess: 'read' }),
    );

    const b = await service.create(
      { name: 'B', type: 'general' },
      userId,
      tenantId,
      { agentAccess: 'write' },
    );
    expect(b.agentAccess).toBe('write');
    expect(insertValues[1]).toEqual(
      expect.objectContaining({ agentAccess: 'write' }),
    );
  });

  it('lists skills without pendingSuggestionsCount', async () => {
    selectPlans.push({
      terminal: 'orderBy',
      result: [
        { id: 'skill-1', name: 'One', agentAccess: 'read' },
        { id: 'skill-2', name: 'Two', agentAccess: 'write' },
      ],
    });

    const result = await service.list(tenantId, 'prompt' as never);
    expect(result).toEqual([
      { id: 'skill-1', name: 'One', agentAccess: 'read' },
      { id: 'skill-2', name: 'Two', agentAccess: 'write' },
    ]);
    expect(result[0]).not.toHaveProperty('pendingSuggestionsCount');
  });

  it('returns an empty list when there are no skills', async () => {
    selectPlans.push({ terminal: 'orderBy', result: [] });

    await expect(service.list(tenantId)).resolves.toEqual([]);
  });

  it('getById returns the slim skill row without version or file data', async () => {
    selectPlans.push({
      terminal: 'limit',
      result: [{ id: 'skill-1', name: 'Skill A', agentAccess: 'read' }],
    });

    await expect(service.getById('skill-1', tenantId)).resolves.toEqual({
      id: 'skill-1',
      name: 'Skill A',
      agentAccess: 'read',
    });

    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it('getById throws NotFoundException when skill does not exist', async () => {
    selectPlans.push({ terminal: 'limit', result: [] });

    await expect(service.getById('missing', tenantId)).rejects.toThrow(
      new NotFoundException('Skill not found'),
    );
  });

  it('updates a skill with only the provided fields', async () => {
    selectPlans.push({
      terminal: 'limit',
      result: [{ id: 'skill-1', tenantId }],
    });
    updatePlans.push({
      terminal: 'returning',
      result: [{ id: 'skill-1', name: 'Updated', icon: 'new-icon' }],
    });

    await expect(
      service.update(
        'skill-1',
        { name: 'Updated', icon: 'new-icon' } as never,
        tenantId,
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

  it('updates agentAccess', async () => {
    selectPlans.push({
      terminal: 'limit',
      result: [{ id: 'skill-1', tenantId, agentAccess: 'read' }],
    });
    updatePlans.push({
      terminal: 'returning',
      result: [{ id: 'skill-1', agentAccess: 'none' }],
    });

    const updated = await service.update(
      'skill-1',
      { agentAccess: 'none' },
      tenantId,
    );

    expect(updated.agentAccess).toBe('none');
    expect(updateSets[0]).toEqual(
      expect.objectContaining({
        agentAccess: 'none',
        updatedAt: expect.any(Date),
      }),
    );
  });

  it('deletes a skill after validating tenant ownership', async () => {
    selectPlans.push({
      terminal: 'limit',
      result: [{ id: 'skill-1', tenantId }],
    });

    await expect(service.delete('skill-1', tenantId)).resolves.toEqual({
      success: true,
    });

    expect(db.delete).toHaveBeenCalled();
  });
});
