import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { TasksService } from './tasks.service.js';
import { TaskCastService } from './taskcast.service.js';
import { DATABASE_CONNECTION } from '@team9/database';
import { DocumentsService } from '../documents/documents.service.js';
import { TriggersService } from './triggers.service.js';
import { AmqpConnection } from '@team9/rabbitmq';

// ── helpers ──────────────────────────────────────────────────────────

type MockFn = jest.Mock<(...args: any[]) => any>;

function mockDb() {
  const chain: Record<string, MockFn> = {};
  const methods = [
    'select',
    'from',
    'where',
    'limit',
    'insert',
    'values',
    'returning',
    'update',
    'set',
    'and',
    'orderBy',
    'desc',
    'delete',
    'leftJoin',
    'innerJoin',
  ];
  for (const m of methods) {
    chain[m] = jest.fn<any>().mockReturnValue(chain);
  }
  chain.limit.mockResolvedValue([]);
  chain.returning.mockResolvedValue([]);
  return chain;
}

// ── fixtures ─────────────────────────────────────────────────────────

const BASE_TASK = {
  id: 'task-1',
  tenantId: 'tenant-1',
  botId: 'bot-1',
  creatorId: 'user-1',
  title: 'Test task',
  description: null,
  status: 'in_progress' as const,
  currentExecutionId: 'exec-1',
  scheduleType: 'once' as const,
  scheduleConfig: null,
  documentId: 'doc-1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('TasksService — TaskCast integration', () => {
  let service: TasksService;
  let db: ReturnType<typeof mockDb>;
  let taskCastService: { transitionStatus: MockFn; publishEvent: MockFn };
  let amqpConnection: { publish: MockFn };
  let documentsService: object;
  let triggersService: object;

  beforeEach(async () => {
    db = mockDb();
    amqpConnection = { publish: jest.fn<any>().mockResolvedValue(undefined) };
    documentsService = {};
    triggersService = {};
    taskCastService = {
      transitionStatus: jest.fn<any>().mockResolvedValue(undefined),
      publishEvent: jest.fn<any>().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        { provide: DATABASE_CONNECTION, useValue: db },
        { provide: AmqpConnection, useValue: amqpConnection },
        { provide: DocumentsService, useValue: documentsService },
        { provide: TriggersService, useValue: triggersService },
        { provide: TaskCastService, useValue: taskCastService },
      ],
    }).compile();

    service = module.get<TasksService>(TasksService);
  });

  // ── pause ─────────────────────────────────────────────────────────

  describe('pause', () => {
    it('calls transitionStatus with deterministic ID and "paused" when currentExecutionId exists', async () => {
      const task = {
        ...BASE_TASK,
        status: 'in_progress' as const,
        currentExecutionId: 'exec-1',
      };
      db.limit.mockResolvedValue([task] as any);

      await service.pause('task-1', 'user-1', 'tenant-1');

      const expectedTcId = TaskCastService.taskcastId('exec-1');
      expect(taskCastService.transitionStatus).toHaveBeenCalledWith(
        expectedTcId,
        'paused',
      );
    });

    it('does NOT call transitionStatus when currentExecutionId is null', async () => {
      const task = {
        ...BASE_TASK,
        status: 'in_progress' as const,
        currentExecutionId: null,
      };
      db.limit.mockResolvedValue([task] as any);

      await service.pause('task-1', 'user-1', 'tenant-1');

      expect(taskCastService.transitionStatus).not.toHaveBeenCalled();
    });
  });

  // ── resume ────────────────────────────────────────────────────────

  describe('resume', () => {
    it('calls transitionStatus with deterministic ID and "in_progress" when currentExecutionId exists', async () => {
      const task = {
        ...BASE_TASK,
        status: 'paused' as const,
        currentExecutionId: 'exec-1',
      };
      db.limit.mockResolvedValue([task] as any);

      await service.resume('task-1', 'user-1', 'tenant-1', {
        message: 'resuming',
      });

      const expectedTcId = TaskCastService.taskcastId('exec-1');
      expect(taskCastService.transitionStatus).toHaveBeenCalledWith(
        expectedTcId,
        'in_progress',
      );
    });

    it('does NOT call transitionStatus when currentExecutionId is null', async () => {
      const task = {
        ...BASE_TASK,
        status: 'paused' as const,
        currentExecutionId: null,
      };
      db.limit.mockResolvedValue([task] as any);

      await service.resume('task-1', 'user-1', 'tenant-1', {
        message: 'resuming',
      });

      expect(taskCastService.transitionStatus).not.toHaveBeenCalled();
    });
  });

  // ── stop ──────────────────────────────────────────────────────────

  describe('stop', () => {
    it('calls transitionStatus with deterministic ID and "stopped" when currentExecutionId exists', async () => {
      const task = {
        ...BASE_TASK,
        status: 'in_progress' as const,
        currentExecutionId: 'exec-1',
      };
      db.limit.mockResolvedValue([task] as any);

      await service.stop('task-1', 'user-1', 'tenant-1', {
        reason: 'manual stop',
      });

      const expectedTcId = TaskCastService.taskcastId('exec-1');
      expect(taskCastService.transitionStatus).toHaveBeenCalledWith(
        expectedTcId,
        'stopped',
      );
    });

    it('does NOT call transitionStatus when currentExecutionId is null', async () => {
      const task = {
        ...BASE_TASK,
        status: 'in_progress' as const,
        currentExecutionId: null,
      };
      db.limit.mockResolvedValue([task] as any);

      await service.stop('task-1', 'user-1', 'tenant-1', {
        reason: 'manual stop',
      });

      expect(taskCastService.transitionStatus).not.toHaveBeenCalled();
    });

    it('calls transitionStatus when task is paused (valid stop transition)', async () => {
      const task = {
        ...BASE_TASK,
        status: 'paused' as const,
        currentExecutionId: 'exec-2',
      };
      db.limit.mockResolvedValue([task] as any);

      await service.stop('task-1', 'user-1', 'tenant-1', {});

      expect(taskCastService.transitionStatus).toHaveBeenCalledWith(
        TaskCastService.taskcastId('exec-2'),
        'stopped',
      );
    });
  });

  // ── resolveIntervention ───────────────────────────────────────────

  describe('resolveIntervention', () => {
    const intervention = {
      id: 'int-1',
      taskId: 'task-1',
      executionId: 'exec-1',
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
      resolvedBy: null,
      resolvedAt: null,
      response: null,
    };

    const updatedIntervention = {
      ...intervention,
      status: 'resolved',
      resolvedBy: 'user-1',
      resolvedAt: new Date(),
      response: { action: 'approve', message: 'looks good' },
    };

    function setupResolveInterventionMocks() {
      // task has pending_action status so that validateStatusTransition is satisfied
      // (resolveIntervention doesn't call validateStatusTransition, so any status works)
      const task = {
        ...BASE_TASK,
        status: 'pending_action' as const,
        currentExecutionId: 'exec-1',
      };

      let limitCallCount = 0;
      db.limit.mockImplementation((() => {
        limitCallCount++;
        if (limitCallCount === 1) return Promise.resolve([task]);
        if (limitCallCount === 2) return Promise.resolve([intervention]);
        return Promise.resolve([]);
      }) as any);

      let returningCallCount = 0;
      db.returning.mockImplementation((() => {
        returningCallCount++;
        if (returningCallCount === 1)
          return Promise.resolve([updatedIntervention]);
        return Promise.resolve([{}]);
      }) as any);
    }

    it('calls transitionStatus with "in_progress" after resolving intervention', async () => {
      setupResolveInterventionMocks();

      await service.resolveIntervention(
        'task-1',
        'int-1',
        'user-1',
        'tenant-1',
        { action: 'approve', message: 'looks good' },
      );

      const expectedTcId = TaskCastService.taskcastId('exec-1');
      expect(taskCastService.transitionStatus).toHaveBeenCalledWith(
        expectedTcId,
        'in_progress',
      );
    });

    it('calls publishEvent with type "intervention" using the deterministic ID', async () => {
      setupResolveInterventionMocks();

      await service.resolveIntervention(
        'task-1',
        'int-1',
        'user-1',
        'tenant-1',
        { action: 'approve', message: 'looks good' },
      );

      const expectedTcId = TaskCastService.taskcastId('exec-1');
      expect(taskCastService.publishEvent).toHaveBeenCalledWith(
        expectedTcId,
        expect.objectContaining({
          type: 'intervention',
        }),
      );
    });

    it('calls both transitionStatus and publishEvent in order', async () => {
      const callOrder: string[] = [];
      taskCastService.transitionStatus.mockImplementation(async () => {
        callOrder.push('transitionStatus');
      });
      taskCastService.publishEvent.mockImplementation(async () => {
        callOrder.push('publishEvent');
      });

      setupResolveInterventionMocks();

      await service.resolveIntervention(
        'task-1',
        'int-1',
        'user-1',
        'tenant-1',
        { action: 'approve' },
      );

      expect(callOrder).toEqual(['transitionStatus', 'publishEvent']);
    });

    it('uses the deterministic ID format agent_task_exec_${executionId}', async () => {
      setupResolveInterventionMocks();

      await service.resolveIntervention(
        'task-1',
        'int-1',
        'user-1',
        'tenant-1',
        { action: 'approve' },
      );

      // Verify the exact deterministic ID format
      const expectedTcId = `agent_task_exec_exec-1`;
      expect(taskCastService.transitionStatus).toHaveBeenCalledWith(
        expectedTcId,
        expect.any(String),
      );
      expect(taskCastService.publishEvent).toHaveBeenCalledWith(
        expectedTcId,
        expect.any(Object),
      );
    });

    it('passes the resolved intervention data in the publishEvent payload', async () => {
      setupResolveInterventionMocks();

      await service.resolveIntervention(
        'task-1',
        'int-1',
        'user-1',
        'tenant-1',
        { action: 'approve', message: 'looks good' },
      );

      expect(taskCastService.publishEvent).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          type: 'intervention',
          data: expect.objectContaining({
            intervention: expect.objectContaining({
              id: 'int-1',
              status: 'resolved',
            }),
          }),
          seriesId: `intervention:int-1`,
          seriesMode: 'latest',
        }),
      );
    });
  });
});
