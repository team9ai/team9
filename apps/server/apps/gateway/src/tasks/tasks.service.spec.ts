import { describe, it, expect, beforeEach, jest } from '@jest/globals';

let uuidCounter = 0;
jest.unstable_mockModule('uuid', () => ({
  v7: jest.fn(() => `uuid-${++uuidCounter}`),
}));

const { TasksService } = await import('./tasks.service.js');

type InsertPlan = { returning?: unknown[] };
type UpdatePlan = { returning?: unknown[] };

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

function createUpdateBuilder(plan: UpdatePlan, updatedValues: unknown[]) {
  const chain: Record<string, jest.Mock> = {
    set: jest.fn(),
    where: jest.fn(),
    returning: jest.fn(),
  };

  chain.set.mockImplementation((value: unknown) => {
    updatedValues.push(value);
    return chain;
  });
  chain.where.mockReturnValue(chain);
  chain.returning.mockResolvedValue(plan.returning ?? []);

  return chain;
}

function createSelectBuilder(result: unknown[]) {
  const chain: Record<string, jest.Mock> = {
    from: jest.fn(),
    where: jest.fn(),
    innerJoin: jest.fn(),
    leftJoin: jest.fn(),
    orderBy: jest.fn(),
    limit: jest.fn(),
  };

  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.innerJoin.mockReturnValue(chain);
  chain.leftJoin.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  chain.limit.mockResolvedValue(result);

  return chain;
}

describe('TasksService', () => {
  let insertedValues: unknown[];
  let updatedValues: unknown[];
  let insertPlans: InsertPlan[];
  let updatePlans: UpdatePlan[];
  let selectResults: unknown[][];
  let db: {
    insert: jest.Mock;
    select: jest.Mock;
    update: jest.Mock;
  };
  let service: InstanceType<typeof TasksService>;
  let clawHive: {
    createSession: jest.Mock;
    sendInput: jest.Mock;
  };
  let imWorkerGrpc: {
    createMessage: jest.Mock;
  };
  let gatewayMQ: {
    isReady: jest.Mock;
    publishPostBroadcast: jest.Mock;
  };
  let taskCastService: {
    createTask: jest.Mock;
  };

  beforeEach(() => {
    uuidCounter = 0;
    insertedValues = [];
    updatedValues = [];
    insertPlans = [];
    updatePlans = [];
    selectResults = [];
    db = {
      insert: jest.fn(() =>
        createInsertBuilder(insertPlans.shift() ?? {}, insertedValues),
      ),
      select: jest.fn(() => createSelectBuilder(selectResults.shift() ?? [])),
      update: jest.fn(() =>
        createUpdateBuilder(updatePlans.shift() ?? {}, updatedValues),
      ),
    };
    clawHive = {
      createSession: jest.fn().mockResolvedValue(undefined),
      sendInput: jest.fn().mockResolvedValue(undefined),
    };
    imWorkerGrpc = {
      createMessage: jest.fn().mockResolvedValue({ msgId: 'msg-1' }),
    };
    gatewayMQ = {
      isReady: jest.fn().mockReturnValue(true),
      publishPostBroadcast: jest.fn().mockResolvedValue(undefined),
    };
    taskCastService = {
      createTask: jest.fn().mockResolvedValue('agent_task_exec_uuid-1'),
    };
    service = new (TasksService as unknown as new (
      ...args: unknown[]
    ) => InstanceType<typeof TasksService>)(
      db,
      clawHive,
      imWorkerGrpc,
      taskCastService,
      gatewayMQ,
    );
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

  it('starts an immediate task run with an initial message and Hive task session', async () => {
    const createdRun = {
      id: 'uuid-1',
      tenantId: 'tenant-1',
      routineId: null,
      routineVersion: null,
      botId: 'bot-1',
      creatorId: 'user-1',
      title: '找 30 个 YouTube 达人',
      description: '整理首轮触达建议',
      status: 'upcoming',
      channelId: 'uuid-2',
    };
    const startedRun = {
      ...createdRun,
      status: 'in_progress',
      taskcastTaskId: 'agent_task_exec_uuid-1',
    };
    const botRow = {
      userId: 'bot-user-1',
      managedProvider: 'hive',
      managedMeta: { agentId: 'agent-1' },
    };

    selectResults.push([botRow], [createdRun], [botRow]);
    insertPlans.push({}, {}, {}, { returning: [createdRun] });
    updatePlans.push({ returning: [startedRun] });

    await expect(
      service.create(
        {
          title: '找 30 个 YouTube 达人',
          description: '整理首轮触达建议',
          botId: 'bot-1',
          executeImmediately: true,
          triggerMode: 'immediate',
        } as never,
        'user-1',
        'tenant-1',
      ),
    ).resolves.toEqual(startedRun);

    expect(updatedValues[0]).toMatchObject({
      status: 'in_progress',
      taskcastTaskId: 'agent_task_exec_uuid-1',
    });
    expect(imWorkerGrpc.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'uuid-2',
        senderId: 'user-1',
        content: '整理首轮触达建议',
        workspaceId: 'tenant-1',
      }),
    );
    expect(clawHive.createSession).toHaveBeenCalledWith(
      'agent-1',
      expect.objectContaining({
        userId: 'user-1',
        sessionId: 'team9/tenant-1/agent-1/task/uuid-1',
        team9Context: expect.objectContaining({
          scopeType: 'task',
          scopeId: 'uuid-1',
          channelId: 'uuid-2',
        }),
      }),
      'tenant-1',
    );
    expect(clawHive.sendInput).toHaveBeenCalledWith(
      'team9/tenant-1/agent-1/task/uuid-1',
      expect.objectContaining({
        type: 'team9:task.start',
        payload: expect.objectContaining({
          taskId: 'uuid-1',
          executionId: 'uuid-1',
          channelId: 'uuid-2',
          message: '整理首轮触达建议',
          location: { type: 'task', id: 'uuid-2' },
        }),
      }),
      'tenant-1',
    );
    expect(taskCastService.createTask).toHaveBeenCalledTimes(1);
    expect(gatewayMQ.publishPostBroadcast).not.toHaveBeenCalled();
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
