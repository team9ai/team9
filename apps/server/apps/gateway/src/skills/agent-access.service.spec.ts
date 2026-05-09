import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const { SkillAgentAccessService } = await import('./agent-access.service.js');

type SelectPlan = { result: unknown[] };

function createSelectBuilder(plan: SelectPlan) {
  const chain: Record<string, jest.Mock> = {
    from: jest.fn(),
    where: jest.fn(),
    limit: jest.fn(),
  };

  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.limit.mockImplementation(() => Promise.resolve(plan.result));

  return chain;
}

describe('SkillAgentAccessService', () => {
  const tenantId = 'tenant-1';
  const botUserId = 'bot:123';

  let selectPlans: SelectPlan[];
  let db: { select: jest.Mock };
  let service: InstanceType<typeof SkillAgentAccessService>;

  beforeEach(() => {
    selectPlans = [];

    db = {
      select: jest.fn(() => {
        const plan = selectPlans.shift();
        if (!plan) throw new Error('Missing select plan');
        return createSelectBuilder(plan);
      }),
    };

    service = new SkillAgentAccessService(db as never);
  });

  it('returns the agentAccess value for an existing skill in the tenant', async () => {
    selectPlans.push({ result: [{ agentAccess: 'write' }] });

    await expect(service.resolve('skill-1', botUserId, tenantId)).resolves.toBe(
      'write',
    );
  });

  it('returns "read" when skill has agentAccess set to read', async () => {
    selectPlans.push({ result: [{ agentAccess: 'read' }] });

    await expect(service.resolve('skill-1', botUserId, tenantId)).resolves.toBe(
      'read',
    );
  });

  it('returns "none" when skill has agentAccess set to none', async () => {
    selectPlans.push({ result: [{ agentAccess: 'none' }] });

    await expect(service.resolve('skill-1', botUserId, tenantId)).resolves.toBe(
      'none',
    );
  });

  it('returns "none" when the skill does not exist', async () => {
    selectPlans.push({ result: [] });

    await expect(
      service.resolve('missing-skill', botUserId, tenantId),
    ).resolves.toBe('none');
  });

  it('returns "none" for a skill that belongs to a different tenant (cross-tenant query returns empty)', async () => {
    // The DB query filters on both skillId AND tenantId, so a cross-tenant
    // lookup returns an empty result set — same as a missing skill.
    selectPlans.push({ result: [] });

    await expect(
      service.resolve('skill-1', botUserId, 'other-tenant'),
    ).resolves.toBe('none');
  });

  it('botUserId does not affect the result (v1 ignores it)', async () => {
    selectPlans.push({ result: [{ agentAccess: 'read' }] });
    selectPlans.push({ result: [{ agentAccess: 'read' }] });

    const result1 = await service.resolve('skill-1', 'bot:aaa', tenantId);
    const result2 = await service.resolve('skill-1', 'bot:bbb', tenantId);

    expect(result1).toBe('read');
    expect(result2).toBe('read');
  });
});
