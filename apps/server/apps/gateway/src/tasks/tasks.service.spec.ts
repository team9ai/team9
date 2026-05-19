import { describe, it, expect, beforeEach, jest } from '@jest/globals';

let uuidCounter = 0;
jest.unstable_mockModule('uuid', () => ({
  v7: jest.fn(() => `uuid-${++uuidCounter}`),
}));

const { TasksService } = await import('./tasks.service.js');

type InsertPlan = { returning?: unknown[] };

function createInsertBuilder(plan: InsertPlan, insertedValues: unknown[]) {
  const chain: Record<string, jest.Mock> = {
    values: jest.fn(),
    returning: jest.fn(),
  };

  chain.values.mockImplementation((value: unknown) => {
    insertedValues.push(value);
    if (plan.returning) {
      return chain;
    }
    return Promise.resolve(undefined);
  });
  chain.returning.mockResolvedValue(plan.returning ?? []);

  return chain;
}

describe('TasksService', () => {
  let insertedValues: unknown[];
  let insertPlans: InsertPlan[];
  let db: {
    insert: jest.Mock;
    select: jest.Mock;
  };
  let service: InstanceType<typeof TasksService>;

  beforeEach(() => {
    uuidCounter = 0;
    insertedValues = [];
    insertPlans = [];
    db = {
      insert: jest.fn(() =>
        createInsertBuilder(insertPlans.shift() ?? {}, insertedValues),
      ),
      select: jest.fn(),
    };
    service = new TasksService(db as never);
  });

  it('creates an independent task run without linking a routine', async () => {
    const createdRun = {
      id: 'uuid-1',
      tenantId: 'tenant-1',
      routineId: null,
      title: '找 20 位 KOC',
      channelId: 'uuid-2',
    };
    insertPlans.push({}, {}, { returning: [createdRun] });

    await expect(
      service.create(
        {
          title: '找 20 位 KOC',
          description: '整理首轮触达建议',
        },
        'user-1',
        'tenant-1',
      ),
    ).resolves.toEqual(createdRun);

    expect(db.insert).toHaveBeenCalledTimes(3);
    expect(db.select).not.toHaveBeenCalled();
    expect(insertedValues[0]).toMatchObject({
      id: 'uuid-2',
      tenantId: 'tenant-1',
      type: 'task',
      createdBy: 'user-1',
    });
    expect(insertedValues[1]).toMatchObject({
      id: 'uuid-3',
      channelId: 'uuid-2',
      userId: 'user-1',
      role: 'owner',
    });
    expect(insertedValues[2]).toMatchObject({
      id: 'uuid-1',
      tenantId: 'tenant-1',
      routineId: null,
      routineVersion: null,
      creatorId: 'user-1',
      title: '找 20 位 KOC',
      description: '整理首轮触达建议',
      status: 'upcoming',
      channelId: 'uuid-2',
    });
  });

  it('limits task run list queries so anomalous history cannot flood clients', async () => {
    const selectChain = {
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([{ id: 'run-1' }]),
    };
    db.select.mockReturnValueOnce(selectChain);

    await expect(service.list('tenant-1')).resolves.toEqual([{ id: 'run-1' }]);

    expect(selectChain.limit).toHaveBeenCalledWith(200);
  });
});
