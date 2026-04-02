import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { TasksService } from './tasks.service.js';
import { TaskCastService } from './taskcast.service.js';
import { DATABASE_CONNECTION } from '@team9/database';
import { DocumentsService } from '../documents/documents.service.js';
import { TriggersService } from './triggers.service.js';
import {
  AmqpConnection,
  RABBITMQ_EXCHANGES,
  RABBITMQ_ROUTING_KEYS,
} from '@team9/rabbitmq';

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

  describe('list', () => {
    it('maps missing token usage to zero while preserving explicit values', async () => {
      const taskA = {
        ...BASE_TASK,
        id: 'task-a',
        currentExecutionId: 'exec-a',
      };
      const taskB = {
        ...BASE_TASK,
        id: 'task-b',
        currentExecutionId: 'exec-b',
      };

      db.orderBy.mockResolvedValueOnce([
        { task: taskA, executionTokenUsage: null },
        { task: taskB, executionTokenUsage: 17 },
      ] as any);

      await expect(service.list('tenant-1')).resolves.toEqual([
        { ...taskA, tokenUsage: 0 },
        { ...taskB, tokenUsage: 17 },
      ]);
    });
  });

  describe('getById', () => {
    it('returns null currentExecution when the task has not started an execution', async () => {
      const task = {
        ...BASE_TASK,
        currentExecutionId: null,
      };
      db.limit.mockResolvedValueOnce([task] as any);

      await expect(service.getById('task-1', 'tenant-1')).resolves.toEqual({
        ...task,
        currentExecution: null,
      });

      expect(db.orderBy).not.toHaveBeenCalled();
    });

    it('hydrates the current execution with steps, interventions, and deliverables', async () => {
      const task = {
        ...BASE_TASK,
        currentExecutionId: 'exec-1',
      };
      const execution = {
        id: 'exec-1',
        taskId: 'task-1',
        status: 'completed',
        startedAt: new Date('2024-01-01T10:00:00.000Z'),
        completedAt: new Date('2024-01-01T12:00:00.000Z'),
      };
      const steps = [
        {
          id: 'step-1',
          executionId: 'exec-1',
          orderIndex: 1,
          createdAt: new Date('2024-01-01T10:30:00.000Z'),
        },
      ];
      const interventions = [
        {
          id: 'int-1',
          executionId: 'exec-1',
          createdAt: new Date('2024-01-01T10:45:00.000Z'),
        },
      ];
      const deliverables = [
        {
          id: 'del-1',
          executionId: 'exec-1',
          createdAt: new Date('2024-01-01T11:15:00.000Z'),
        },
      ];

      db.limit.mockResolvedValueOnce([task] as any);
      db.limit.mockResolvedValueOnce([execution] as any);
      db.orderBy.mockResolvedValueOnce(steps as any);
      db.where
        .mockImplementationOnce(() => db as any)
        .mockImplementationOnce(() => db as any)
        .mockImplementationOnce(() => db as any)
        .mockResolvedValueOnce(interventions as any)
        .mockResolvedValueOnce(deliverables as any);

      await expect(service.getById('task-1', 'tenant-1')).resolves.toEqual({
        ...task,
        currentExecution: {
          execution,
          steps,
          interventions,
          deliverables,
        },
      });

      expect(db.orderBy).toHaveBeenCalledTimes(1);
    });
  });

  describe('getExecutionEntries', () => {
    it('merges timeline entries in chronological order and falls back to epoch for missing timestamps', async () => {
      const task = {
        ...BASE_TASK,
        currentExecutionId: 'exec-1',
      };
      const execution = {
        id: 'exec-1',
        taskId: 'task-1',
        status: 'completed',
        startedAt: new Date('2024-01-01T10:00:00.000Z'),
        completedAt: new Date('2024-01-01T12:00:00.000Z'),
      };
      const steps = [
        {
          id: 'step-late',
          executionId: 'exec-1',
          createdAt: new Date('2024-01-01T11:00:00.000Z'),
        },
        {
          id: 'step-epoch',
          executionId: 'exec-1',
          createdAt: null,
        },
      ];
      const interventions = [
        {
          id: 'int-1',
          executionId: 'exec-1',
          createdAt: new Date('2024-01-01T09:30:00.000Z'),
        },
      ];
      const deliverables = [
        {
          id: 'del-1',
          executionId: 'exec-1',
          createdAt: undefined,
        },
      ];

      db.limit.mockResolvedValueOnce([task] as any);
      db.limit.mockResolvedValueOnce([execution] as any);
      db.where
        .mockImplementationOnce(() => db as any)
        .mockImplementationOnce(() => db as any)
        .mockResolvedValueOnce(steps as any)
        .mockResolvedValueOnce(interventions as any)
        .mockResolvedValueOnce(deliverables as any);

      await expect(
        service.getExecutionEntries('task-1', 'exec-1', 'tenant-1'),
      ).resolves.toEqual([
        { type: 'step', data: steps[1] },
        { type: 'deliverable', data: deliverables[0] },
        { type: 'intervention', data: interventions[0] },
        {
          type: 'status_change',
          data: {
            status: 'started',
            at: '2024-01-01T10:00:00.000Z',
          },
        },
        { type: 'step', data: steps[0] },
        {
          type: 'status_change',
          data: {
            status: 'completed',
            at: '2024-01-01T12:00:00.000Z',
          },
        },
      ]);
    });
  });

  // ── pause ─────────────────────────────────────────────────────────

  describe('start', () => {
    it('publishes start commands with notes and trigger id for runnable tasks', async () => {
      const task = {
        ...BASE_TASK,
        status: 'upcoming' as const,
        botId: 'bot-1',
      };
      db.limit.mockResolvedValueOnce([task] as any);

      await expect(
        service.start('task-1', 'user-1', 'tenant-1', {
          message: 'kick off',
          notes: 'from trigger',
          triggerId: 'trigger-1',
        } as never),
      ).resolves.toEqual({ success: true });

      expect(amqpConnection.publish).toHaveBeenCalledWith(
        RABBITMQ_EXCHANGES.TASK_COMMANDS,
        RABBITMQ_ROUTING_KEYS.TASK_COMMAND,
        expect.objectContaining({
          type: 'start',
          taskId: 'task-1',
          userId: 'user-1',
          message: 'kick off',
          notes: 'from trigger',
          triggerId: 'trigger-1',
        }),
        { persistent: true },
      );
    });

    it('rejects start when the task has no assigned bot', async () => {
      db.limit.mockResolvedValueOnce([
        {
          ...BASE_TASK,
          status: 'upcoming' as const,
          botId: null,
        },
      ] as any);

      await expect(
        service.start('task-1', 'user-1', 'tenant-1', {
          message: 'kick off',
        } as never),
      ).rejects.toThrow('Cannot start task without an assigned bot');

      expect(amqpConnection.publish).not.toHaveBeenCalled();
    });
  });

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
      expect(amqpConnection.publish).toHaveBeenCalledWith(
        RABBITMQ_EXCHANGES.TASK_COMMANDS,
        RABBITMQ_ROUTING_KEYS.TASK_COMMAND,
        expect.objectContaining({
          type: 'pause',
          taskId: 'task-1',
          userId: 'user-1',
        }),
        { persistent: true },
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

    it('rejects when the task is not in_progress', async () => {
      const task = {
        ...BASE_TASK,
        status: 'paused' as const,
        currentExecutionId: 'exec-1',
      };
      db.limit.mockResolvedValue([task] as any);

      await expect(
        service.pause('task-1', 'user-1', 'tenant-1'),
      ).rejects.toThrow('Cannot pause task in paused status');

      expect(amqpConnection.publish).not.toHaveBeenCalled();
      expect(taskCastService.transitionStatus).not.toHaveBeenCalled();
    });

    it('rejects and does not sync TaskCast when publishing fails', async () => {
      const task = {
        ...BASE_TASK,
        status: 'in_progress' as const,
        currentExecutionId: 'exec-1',
      };
      db.limit.mockResolvedValue([task] as any);
      amqpConnection.publish.mockRejectedValueOnce(new Error('broker down'));

      await expect(
        service.pause('task-1', 'user-1', 'tenant-1'),
      ).rejects.toThrow('broker down');

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
      expect(amqpConnection.publish).toHaveBeenCalledWith(
        RABBITMQ_EXCHANGES.TASK_COMMANDS,
        RABBITMQ_ROUTING_KEYS.TASK_COMMAND,
        expect.objectContaining({
          type: 'resume',
          taskId: 'task-1',
          userId: 'user-1',
          message: 'resuming',
        }),
        { persistent: true },
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

    it('rejects when the task is not paused', async () => {
      const task = {
        ...BASE_TASK,
        status: 'in_progress' as const,
        currentExecutionId: 'exec-1',
      };
      db.limit.mockResolvedValue([task] as any);

      await expect(
        service.resume('task-1', 'user-1', 'tenant-1', { message: 'resuming' }),
      ).rejects.toThrow('Cannot resume task in in_progress status');

      expect(amqpConnection.publish).not.toHaveBeenCalled();
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
      expect(amqpConnection.publish).toHaveBeenCalledWith(
        RABBITMQ_EXCHANGES.TASK_COMMANDS,
        RABBITMQ_ROUTING_KEYS.TASK_COMMAND,
        expect.objectContaining({
          type: 'stop',
          taskId: 'task-1',
          userId: 'user-1',
          message: 'manual stop',
        }),
        { persistent: true },
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

    it('calls transitionStatus when task is pending_action (valid stop transition)', async () => {
      const task = {
        ...BASE_TASK,
        status: 'pending_action' as const,
        currentExecutionId: 'exec-3',
      };
      db.limit.mockResolvedValue([task] as any);

      await service.stop('task-1', 'user-1', 'tenant-1', {
        reason: 'manual stop',
      });

      expect(taskCastService.transitionStatus).toHaveBeenCalledWith(
        TaskCastService.taskcastId('exec-3'),
        'stopped',
      );
      expect(amqpConnection.publish).toHaveBeenCalledWith(
        RABBITMQ_EXCHANGES.TASK_COMMANDS,
        RABBITMQ_ROUTING_KEYS.TASK_COMMAND,
        expect.objectContaining({
          type: 'stop',
          taskId: 'task-1',
          userId: 'user-1',
          message: 'manual stop',
        }),
        { persistent: true },
      );
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

    it('rejects when the task is not stopable', async () => {
      const task = {
        ...BASE_TASK,
        status: 'completed' as const,
        currentExecutionId: 'exec-1',
      };
      db.limit.mockResolvedValue([task] as any);

      await expect(
        service.stop('task-1', 'user-1', 'tenant-1', { reason: 'manual stop' }),
      ).rejects.toThrow('Cannot stop task in completed status');

      expect(amqpConnection.publish).not.toHaveBeenCalled();
      expect(taskCastService.transitionStatus).not.toHaveBeenCalled();
    });
  });

  describe('restart', () => {
    it('publishes restart commands for terminal tasks', async () => {
      db.limit.mockResolvedValueOnce([
        {
          ...BASE_TASK,
          status: 'failed' as const,
        },
      ] as any);

      await expect(
        service.restart('task-1', 'user-1', 'tenant-1', {
          notes: 'retry with fixes',
        }),
      ).resolves.toEqual({ success: true });

      expect(amqpConnection.publish).toHaveBeenCalledWith(
        RABBITMQ_EXCHANGES.TASK_COMMANDS,
        RABBITMQ_ROUTING_KEYS.TASK_COMMAND,
        expect.objectContaining({
          type: 'restart',
          taskId: 'task-1',
          userId: 'user-1',
          notes: 'retry with fixes',
        }),
        { persistent: true },
      );
    });
  });

  describe('retry', () => {
    it('publishes retry commands when the source execution is terminal', async () => {
      db.limit
        .mockResolvedValueOnce([
          {
            ...BASE_TASK,
            status: 'failed' as const,
            botId: 'bot-1',
          },
        ] as any)
        .mockResolvedValueOnce([
          {
            id: 'exec-source',
            taskId: 'task-1',
            status: 'stopped',
          },
        ] as any);

      await expect(
        service.retry(
          'task-1',
          { executionId: 'exec-source', notes: 'try again' } as never,
          'user-1',
          'tenant-1',
        ),
      ).resolves.toEqual({ success: true });

      expect(amqpConnection.publish).toHaveBeenCalledWith(
        RABBITMQ_EXCHANGES.TASK_COMMANDS,
        RABBITMQ_ROUTING_KEYS.TASK_COMMAND,
        expect.objectContaining({
          type: 'retry',
          taskId: 'task-1',
          userId: 'user-1',
          notes: 'try again',
          sourceExecutionId: 'exec-source',
        }),
        { persistent: true },
      );
    });

    it('rejects retry when the source execution does not exist', async () => {
      db.limit
        .mockResolvedValueOnce([
          {
            ...BASE_TASK,
            status: 'failed' as const,
            botId: 'bot-1',
          },
        ] as any)
        .mockResolvedValueOnce([] as any);

      await expect(
        service.retry(
          'task-1',
          { executionId: 'missing-exec', notes: 'try again' } as never,
          'user-1',
          'tenant-1',
        ),
      ).rejects.toThrow('Execution not found');

      expect(amqpConnection.publish).not.toHaveBeenCalled();
    });

    it('rejects retry when the source execution is not terminal', async () => {
      db.limit
        .mockResolvedValueOnce([
          {
            ...BASE_TASK,
            status: 'failed' as const,
            botId: 'bot-1',
          },
        ] as any)
        .mockResolvedValueOnce([
          {
            id: 'exec-source',
            taskId: 'task-1',
            status: 'in_progress',
          },
        ] as any);

      await expect(
        service.retry(
          'task-1',
          { executionId: 'exec-source', notes: 'try again' } as never,
          'user-1',
          'tenant-1',
        ),
      ).rejects.toThrow('Cannot retry execution in in_progress status');

      expect(amqpConnection.publish).not.toHaveBeenCalled();
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

    function setupResolveInterventionMocks({
      interventionRow = intervention,
    }: {
      interventionRow?: typeof intervention | null;
    } = {}) {
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
        if (limitCallCount === 2) {
          return Promise.resolve(interventionRow ? [interventionRow] : []);
        }
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
      expect(amqpConnection.publish).toHaveBeenCalledWith(
        RABBITMQ_EXCHANGES.TASK_COMMANDS,
        RABBITMQ_ROUTING_KEYS.TASK_COMMAND,
        expect.objectContaining({
          type: 'resume',
          taskId: 'task-1',
          userId: 'user-1',
          message: 'Intervention resolved: approve - looks good',
        }),
        { persistent: true },
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

    it('rejects when the intervention is not found', async () => {
      setupResolveInterventionMocks({ interventionRow: null });

      await expect(
        service.resolveIntervention('task-1', 'int-1', 'user-1', 'tenant-1', {
          action: 'approve',
        }),
      ).rejects.toThrow('Intervention not found');

      expect(amqpConnection.publish).not.toHaveBeenCalled();
      expect(taskCastService.transitionStatus).not.toHaveBeenCalled();
      expect(taskCastService.publishEvent).not.toHaveBeenCalled();
    });

    it('rejects when the intervention is already resolved', async () => {
      setupResolveInterventionMocks({
        interventionRow: { ...intervention, status: 'resolved' },
      });

      await expect(
        service.resolveIntervention('task-1', 'int-1', 'user-1', 'tenant-1', {
          action: 'approve',
        }),
      ).rejects.toThrow('Intervention is already resolved');

      expect(amqpConnection.publish).not.toHaveBeenCalled();
      expect(taskCastService.transitionStatus).not.toHaveBeenCalled();
      expect(taskCastService.publishEvent).not.toHaveBeenCalled();
    });

    it('rejects when the intervention belongs to a previous execution', async () => {
      setupResolveInterventionMocks({
        interventionRow: { ...intervention, executionId: 'exec-previous' },
      });

      await expect(
        service.resolveIntervention('task-1', 'int-1', 'user-1', 'tenant-1', {
          action: 'approve',
        }),
      ).rejects.toThrow(
        'Intervention belongs to a previous execution. Cannot resolve.',
      );

      expect(amqpConnection.publish).not.toHaveBeenCalled();
      expect(taskCastService.transitionStatus).not.toHaveBeenCalled();
      expect(taskCastService.publishEvent).not.toHaveBeenCalled();
    });
  });
});
