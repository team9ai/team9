import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { ExecutionStrategy } from './execution-strategy.interface.js';

// ── DB mock ────────────────────────────────────────────────────────────

/**
 * We use result queues:
 * - selectResultQueue: each call to db.select()...limit() pops the next result
 * - returningResultQueue: each call to db.update()...returning() pops the next result
 *
 * triggerExecution uses db.update().returning() for CAS task claiming (step 1),
 * then db.select()...limit() for document and bot lookups.
 * The first entry in selectResultQueue is therefore the bot lookup result
 * (or document query if task has a documentId).
 */
let selectResultQueue: any[][];
let returningResultQueue: any[][];

function makeChainableSelect() {
  const chain: any = {};
  chain.select = jest.fn<any>().mockReturnValue(chain);
  chain.from = jest.fn<any>().mockReturnValue(chain);
  chain.innerJoin = jest.fn<any>().mockReturnValue(chain);
  chain.where = jest.fn<any>().mockReturnValue(chain);
  chain.orderBy = jest.fn<any>().mockReturnValue(chain);
  chain.limit = jest.fn<any>().mockImplementation(() => {
    return Promise.resolve(selectResultQueue.shift() ?? []);
  });
  return chain;
}

const insertValues: any[] = [];
function makeChainableInsert() {
  const chain: any = {};
  chain.values = jest.fn<any>().mockImplementation((v: any) => {
    insertValues.push(v);
    return chain;
  });
  chain.returning = jest.fn<any>().mockResolvedValue([]);
  return chain;
}

const updateSets: any[] = [];
function makeChainableUpdate() {
  const chain: any = {};
  chain.set = jest.fn<any>().mockImplementation((v: any) => {
    updateSets.push(v);
    return chain;
  });
  chain.where = jest.fn<any>().mockReturnValue(chain);
  chain.returning = jest.fn<any>().mockImplementation(() => {
    return Promise.resolve(returningResultQueue.shift() ?? []);
  });
  return chain;
}

let mockDb: any;

function resetDb() {
  const selectChain = makeChainableSelect();
  const insertChain = makeChainableInsert();
  const updateChain = makeChainableUpdate();

  mockDb = {
    select: jest.fn<any>().mockReturnValue(selectChain),
    insert: jest.fn<any>().mockReturnValue(insertChain),
    update: jest.fn<any>().mockReturnValue(updateChain),
    _selectChain: selectChain,
    _insertChain: insertChain,
    _updateChain: updateChain,
  };
}

// ── TaskCast mock ──────────────────────────────────────────────────────

const mockTaskCastClient = {
  createTask: jest.fn<any>().mockResolvedValue('tc-task-id'),
};

// ── UUID mock ──────────────────────────────────────────────────────────

let uuidCounter = 0;
jest.unstable_mockModule('uuid', () => ({
  v7: jest.fn<any>().mockImplementation(() => `mock-uuid-${++uuidCounter}`),
}));

// ── Test data ──────────────────────────────────────────────────────────

const sampleTask = {
  id: 'task-001',
  title: 'My Test Task',
  tenantId: 'tenant-001',
  creatorId: 'user-001',
  botId: 'bot-001',
  documentId: null,
  version: 3,
  status: 'idle',
};

const sampleBot = {
  userId: 'bot-user-001',
  type: 'system',
  managedProvider: null,
};

// ── Tests ──────────────────────────────────────────────────────────────

describe('ExecutorService', () => {
  let ExecutorService: any;
  let service: any;
  let mockStrategy: ExecutionStrategy;

  beforeEach(async () => {
    jest.clearAllMocks();
    uuidCounter = 0;
    selectResultQueue = [];
    returningResultQueue = [];
    insertValues.length = 0;
    updateSets.length = 0;

    resetDb();
    mockTaskCastClient.createTask.mockResolvedValue('tc-task-id');

    ({ ExecutorService } = await import('./executor.service.js'));
    service = new ExecutorService(mockDb, mockTaskCastClient);

    mockStrategy = {
      execute: jest.fn<any>().mockResolvedValue(undefined),
      pause: jest.fn<any>().mockResolvedValue(undefined),
      resume: jest.fn<any>().mockResolvedValue(undefined),
      stop: jest.fn<any>().mockResolvedValue(undefined),
    };
  });

  // ── Task not found ─────────────────────────────────────────────────

  it('should return early when task does not exist', async () => {
    // CAS update().returning() returns empty → task not claimed
    returningResultQueue = [[]];

    await service.triggerExecution('nonexistent-task');

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  // ── Task has no bot ────────────────────────────────────────────────

  it('should return early when task has no botId', async () => {
    // CAS returns task with no botId
    returningResultQueue = [[{ ...sampleTask, botId: null }]];

    await service.triggerExecution('task-001');

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  // ── Version snapshot ───────────────────────────────────────────────

  it('should snapshot the task version in execution record', async () => {
    // CAS returns task (version=5); bot lookup via select
    returningResultQueue = [[{ ...sampleTask, version: 5 }]];
    selectResultQueue = [[sampleBot]];
    service.registerStrategy('system', mockStrategy);

    await service.triggerExecution('task-001');

    // insertValues: [channel, channelMember-creator, execution, channelMember-bot]
    const executionInsert = insertValues.find(
      (v) => v.taskVersion !== undefined,
    );
    expect(executionInsert).toBeDefined();
    expect(executionInsert.taskVersion).toBe(5);
  });

  // ── Bot not found ──────────────────────────────────────────────────

  it('should mark execution as failed when bot lookup returns empty', async () => {
    // CAS returns task; bot lookup returns empty
    returningResultQueue = [[sampleTask]];
    selectResultQueue = [[]]; // bot not found

    await service.triggerExecution('task-001');

    // Should call update to mark status as failed
    expect(mockDb.update).toHaveBeenCalled();
    const failedSet = updateSets.find((s) => s.status === 'failed');
    expect(failedSet).toBeDefined();
  });

  // ── No strategy registered ────────────────────────────────────────

  it('should mark execution as failed when no strategy is registered for bot type', async () => {
    returningResultQueue = [[sampleTask]];
    selectResultQueue = [
      [{ userId: 'bot-user-001', type: 'unknown_type', managedProvider: null }],
    ];
    // No strategy registered

    await service.triggerExecution('task-001');

    expect(mockDb.update).toHaveBeenCalled();
    const failedSet = updateSets.find((s) => s.status === 'failed');
    expect(failedSet).toBeDefined();
  });

  // ── Strategy failure ───────────────────────────────────────────────

  it('should mark execution as failed when strategy.execute throws', async () => {
    returningResultQueue = [[sampleTask]];
    selectResultQueue = [[sampleBot]];

    const failingStrategy: ExecutionStrategy = {
      execute: jest.fn<any>().mockRejectedValue(new Error('agent crashed')),
      pause: jest.fn<any>(),
      resume: jest.fn<any>(),
      stop: jest.fn<any>(),
    };
    service.registerStrategy('system', failingStrategy);

    await service.triggerExecution('task-001');

    expect(failingStrategy.execute).toHaveBeenCalled();
    const failedSet = updateSets.find((s) => s.status === 'failed');
    expect(failedSet).toBeDefined();
  });

  // ── Happy path ─────────────────────────────────────────────────────

  it('should delegate to the registered strategy on success', async () => {
    returningResultQueue = [[sampleTask]];
    selectResultQueue = [[sampleBot]];
    service.registerStrategy('system', mockStrategy);

    await service.triggerExecution('task-001');

    expect(mockStrategy.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-001',
        botId: 'bot-001',
      }),
    );
  });

  // ── Channel naming ────────────────────────────────────────────────

  it('should create task channel with sanitized name and channelId suffix', async () => {
    returningResultQueue = [
      [{ ...sampleTask, title: 'My  Multi   Space  Task' }],
    ];
    selectResultQueue = [[sampleBot]];
    service.registerStrategy('system', mockStrategy);

    await service.triggerExecution('task-001');

    const channelInsert = insertValues.find((v) => v.type === 'task');
    expect(channelInsert).toBeDefined();
    expect(channelInsert.name).not.toMatch(/\s/);
    expect(channelInsert.name).toMatch(/^task-my-multi-space-task-/);
  });

  // ── Task status update ────────────────────────────────────────────

  it('should update task status to in_progress on execution start', async () => {
    returningResultQueue = [[sampleTask]];
    selectResultQueue = [[sampleBot]];
    service.registerStrategy('system', mockStrategy);

    await service.triggerExecution('task-001');

    const inProgressSet = updateSets.find((s) => s.status === 'in_progress');
    expect(inProgressSet).toBeDefined();
  });

  // ── Hive strategy routing ─────────────────────────────────────────

  it('should route to "hive" strategy when managedProvider is "hive"', async () => {
    const hiveBot = {
      userId: 'bot-user-001',
      type: 'custom',
      managedProvider: 'hive',
    };
    returningResultQueue = [[sampleTask]];
    selectResultQueue = [[hiveBot]];

    const hiveStrategy = {
      execute: jest.fn<any>().mockResolvedValue(undefined),
      pause: jest.fn<any>().mockResolvedValue(undefined),
      resume: jest.fn<any>().mockResolvedValue(undefined),
      stop: jest.fn<any>().mockResolvedValue(undefined),
    };
    service.registerStrategy('hive', hiveStrategy);

    await service.triggerExecution('task-001');

    expect(hiveStrategy.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-001',
        tenantId: 'tenant-001',
      }),
    );
  });

  it('should pass tenantId in ExecutionContext', async () => {
    returningResultQueue = [[{ ...sampleTask, tenantId: 'tenant-xyz' }]];
    selectResultQueue = [[sampleBot]];
    service.registerStrategy('system', mockStrategy);

    await service.triggerExecution('task-001');

    expect(mockStrategy.execute).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-xyz' }),
    );
  });

  // ── stopExecution: hive strategy routing ─────────────────────────

  it('stopExecution: routes to "hive" strategy when managedProvider is "hive"', async () => {
    const sampleExecution = {
      id: 'exec-001',
      channelId: 'chan-001',
      taskcastTaskId: 'tc-001',
      startedAt: new Date(),
    };
    const hiveBot = { type: 'custom', managedProvider: 'hive' };
    const taskWithExecution = {
      id: 'task-001',
      botId: 'bot-001',
      tenantId: 'tenant-001',
      title: 'My Test Task',
      currentExecutionId: 'exec-001',
    };

    // select queue order: task, execution, bot
    selectResultQueue = [[taskWithExecution], [sampleExecution], [hiveBot]];

    const hiveStrategy = {
      execute: jest.fn<any>().mockResolvedValue(undefined),
      pause: jest.fn<any>().mockResolvedValue(undefined),
      resume: jest.fn<any>().mockResolvedValue(undefined),
      stop: jest.fn<any>().mockResolvedValue(undefined),
    };
    service.registerStrategy('hive', hiveStrategy);

    await service.stopExecution('task-001');

    expect(hiveStrategy.stop).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-001',
        executionId: 'exec-001',
      }),
    );
  });

  // ── stopExecution: bot-not-found marks execution as failed ────────

  it('stopExecution: marks execution and task as failed when bot is not found', async () => {
    const sampleExecution = {
      id: 'exec-001',
      channelId: 'chan-001',
      taskcastTaskId: 'tc-001',
      startedAt: new Date(),
    };
    const taskWithExecution = {
      id: 'task-001',
      botId: 'bot-missing',
      tenantId: 'tenant-001',
      title: 'My Test Task',
      currentExecutionId: 'exec-001',
    };

    // select queue order: task, execution, bot (empty — not found)
    selectResultQueue = [[taskWithExecution], [sampleExecution], []];

    await service.stopExecution('task-001');

    // strategy.stop must NOT be called (no strategy involved)
    expect(mockStrategy.stop).not.toHaveBeenCalled();
    // DB must be updated with status 'failed' for both execution and task
    const failedSet = updateSets.find((s) => s.status === 'failed');
    expect(failedSet).toBeDefined();
  });

  // ── stopExecution: tenantId in ExecutionContext ───────────────────

  it('stopExecution: includes tenantId in ExecutionContext passed to strategy', async () => {
    const sampleExecution = {
      id: 'exec-001',
      channelId: 'chan-001',
      taskcastTaskId: 'tc-001',
      startedAt: new Date(),
    };
    const taskWithExecution = {
      id: 'task-001',
      botId: 'bot-001',
      tenantId: 'tenant-abc',
      title: 'My Test Task',
      currentExecutionId: 'exec-001',
    };

    // select queue order: task, execution, bot
    selectResultQueue = [
      [taskWithExecution],
      [sampleExecution],
      [{ type: 'system', managedProvider: null }],
    ];
    service.registerStrategy('system', mockStrategy);

    await service.stopExecution('task-001');

    expect(mockStrategy.stop).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-abc' }),
    );
  });
});
