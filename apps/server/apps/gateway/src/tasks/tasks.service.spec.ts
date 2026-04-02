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
  let documentsService: { create: MockFn };
  let triggersService: { createBatch: MockFn };

  beforeEach(async () => {
    db = mockDb();
    amqpConnection = { publish: jest.fn<any>().mockResolvedValue(undefined) };
    documentsService = {
      create: jest.fn<any>().mockResolvedValue({ id: 'doc-1' }),
    };
    triggersService = {
      createBatch: jest.fn<any>().mockResolvedValue(undefined),
    };
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

    it('returns null currentExecution when the task points to a missing execution', async () => {
      const task = {
        ...BASE_TASK,
        currentExecutionId: 'exec-missing',
      };

      db.limit.mockResolvedValueOnce([task] as any);
      db.limit.mockResolvedValueOnce([] as any);

      await expect(service.getById('task-1', 'tenant-1')).resolves.toEqual({
        ...task,
        currentExecution: null,
      });

      expect(db.orderBy).not.toHaveBeenCalled();
    });
  });

  describe('getExecutions', () => {
    it('returns executions ordered by newest first', async () => {
      db.limit.mockResolvedValueOnce([
        {
          ...BASE_TASK,
        },
      ] as any);

      const executions = [
        {
          id: 'exec-2',
          taskId: 'task-1',
          createdAt: new Date('2024-01-02T00:00:00.000Z'),
        },
        {
          id: 'exec-1',
          taskId: 'task-1',
          createdAt: new Date('2024-01-01T00:00:00.000Z'),
        },
      ];
      db.orderBy.mockResolvedValueOnce(executions as any);

      await expect(
        service.getExecutions('task-1', 'tenant-1'),
      ).resolves.toEqual(executions);

      expect(db.orderBy).toHaveBeenCalledTimes(1);
    });
  });

  describe('getExecution', () => {
    it('returns a matching execution when it exists for the task', async () => {
      const steps = [
        {
          id: 'step-1',
          executionId: 'exec-1',
          orderIndex: 1,
        },
      ];
      const deliverables = [
        {
          id: 'del-1',
          taskId: 'task-1',
          executionId: 'exec-1',
        },
      ];
      const interventions = [
        {
          id: 'int-1',
          taskId: 'task-1',
          executionId: 'exec-1',
        },
      ];
      const execution = {
        id: 'exec-1',
        taskId: 'task-1',
        status: 'completed',
      };

      db.limit.mockResolvedValueOnce([
        {
          ...BASE_TASK,
        },
      ] as any);
      db.limit.mockResolvedValueOnce([execution] as any);
      db.where
        .mockImplementationOnce(() => db as any)
        .mockImplementationOnce(() => db as any)
        .mockImplementationOnce(() => db as any)
        .mockResolvedValueOnce(deliverables as any)
        .mockResolvedValueOnce(interventions as any);
      db.orderBy.mockResolvedValueOnce(steps as any);

      await expect(
        service.getExecution('task-1', 'exec-1', 'tenant-1'),
      ).resolves.toEqual({
        ...execution,
        steps,
        deliverables,
        interventions,
      });
    });

    it('throws when the execution does not exist for the task', async () => {
      db.limit.mockResolvedValueOnce([
        {
          ...BASE_TASK,
        },
      ] as any);
      db.limit.mockResolvedValueOnce([] as any);

      await expect(
        service.getExecution('task-1', 'exec-missing', 'tenant-1'),
      ).rejects.toThrow('Execution not found');
    });
  });

  describe('getDeliverables', () => {
    it('returns deliverables for the requested execution', async () => {
      const deliverables = [
        {
          id: 'del-1',
          taskId: 'task-1',
          executionId: 'exec-1',
          createdAt: new Date('2024-01-01T12:00:00.000Z'),
        },
      ];

      db.limit.mockResolvedValueOnce([
        {
          ...BASE_TASK,
        },
      ] as any);
      db.orderBy.mockResolvedValueOnce(deliverables as any);

      await expect(
        service.getDeliverables('task-1', 'exec-1', 'tenant-1'),
      ).resolves.toEqual(deliverables);

      expect(db.orderBy).toHaveBeenCalledTimes(1);
    });
  });

  describe('getInterventions', () => {
    it('returns pending interventions ordered by newest first', async () => {
      const interventions = [
        {
          id: 'int-1',
          taskId: 'task-1',
          status: 'pending',
          createdAt: new Date('2024-01-01T13:00:00.000Z'),
        },
      ];

      db.limit.mockResolvedValueOnce([
        {
          ...BASE_TASK,
        },
      ] as any);
      db.orderBy.mockResolvedValueOnce(interventions as any);

      await expect(
        service.getInterventions('task-1', 'tenant-1'),
      ).resolves.toEqual(interventions);

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

  describe('create', () => {
    it('creates a linked document and skips trigger creation when none are provided', async () => {
      const createdTask = {
        id: 'task-new',
        tenantId: 'tenant-1',
        creatorId: 'user-1',
        title: 'New task',
        documentId: 'doc-new',
      };

      documentsService.create.mockResolvedValueOnce({ id: 'doc-new' } as any);
      db.returning.mockResolvedValueOnce([createdTask] as any);

      await expect(
        service.create(
          {
            title: 'New task',
            botId: 'bot-1',
            description: 'plan it',
          } as never,
          'user-1',
          'tenant-1',
        ),
      ).resolves.toEqual(createdTask);

      expect(documentsService.create).toHaveBeenCalledWith(
        { documentType: 'task', content: '', title: 'New task' },
        { type: 'user', id: 'user-1' },
        'tenant-1',
      );
      expect(triggersService.createBatch).not.toHaveBeenCalled();
    });

    it('creates triggers after inserting the task when triggers are provided', async () => {
      const createdTask = {
        id: 'task-new',
        tenantId: 'tenant-1',
        creatorId: 'user-1',
        title: 'New task',
        documentId: 'doc-new',
      };
      const triggers = [{ type: 'manual-trigger' }];

      documentsService.create.mockResolvedValueOnce({ id: 'doc-new' } as any);
      db.returning.mockResolvedValueOnce([createdTask] as any);

      await service.create(
        {
          title: 'New task',
          botId: 'bot-1',
          triggers,
        } as never,
        'user-1',
        'tenant-1',
      );

      expect(triggersService.createBatch).toHaveBeenCalledWith(
        expect.any(String),
        triggers,
        'tenant-1',
      );
    });
  });

  describe('update', () => {
    it('rejects updates from non-creators before writing to the database', async () => {
      db.limit.mockResolvedValueOnce([
        {
          ...BASE_TASK,
          creatorId: 'user-2',
        },
      ] as any);

      await expect(
        service.update(
          'task-1',
          { title: 'Updated title' } as never,
          'user-1',
          'tenant-1',
        ),
      ).rejects.toThrow('You do not have permission to perform this action');

      expect(db.update).not.toHaveBeenCalled();
    });

    it('persists provided fields when the creator updates the task', async () => {
      const task = {
        ...BASE_TASK,
        creatorId: 'user-1',
      };
      const updatedTask = {
        ...task,
        title: 'Updated title',
        description: 'Updated description',
      };

      db.limit.mockResolvedValueOnce([task] as any);
      db.returning.mockResolvedValueOnce([updatedTask] as any);

      await expect(
        service.update(
          'task-1',
          {
            title: 'Updated title',
            description: 'Updated description',
          } as never,
          'user-1',
          'tenant-1',
        ),
      ).resolves.toEqual(updatedTask);

      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Updated title',
          description: 'Updated description',
          updatedAt: expect.any(Date),
        }),
      );
    });
  });

  describe('delete', () => {
    it('rejects deleting active tasks until they are stopped', async () => {
      db.limit.mockResolvedValueOnce([
        {
          ...BASE_TASK,
          status: 'pending_action' as const,
        },
      ] as any);

      await expect(
        service.delete('task-1', 'user-1', 'tenant-1'),
      ).rejects.toThrow(
        'Cannot delete task in pending_action status. Stop the task first.',
      );

      expect(db.delete).not.toHaveBeenCalled();
    });

    it('deletes inactive tasks owned by the requesting user', async () => {
      db.limit.mockResolvedValueOnce([
        {
          ...BASE_TASK,
          creatorId: 'user-1',
          status: 'completed' as const,
        },
      ] as any);

      await expect(
        service.delete('task-1', 'user-1', 'tenant-1'),
      ).resolves.toEqual({ success: true });

      expect(db.delete).toHaveBeenCalledTimes(1);
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

    it('rejects start when the task is not upcoming', async () => {
      db.limit.mockResolvedValueOnce([
        {
          ...BASE_TASK,
          status: 'in_progress' as const,
          botId: 'bot-1',
        },
      ] as any);

      await expect(
        service.start('task-1', 'user-1', 'tenant-1', {
          message: 'kick off',
        } as never),
      ).rejects.toThrow('Cannot start task in in_progress status');

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

    it('bubbles up publish failures before syncing TaskCast', async () => {
      const task = {
        ...BASE_TASK,
        status: 'in_progress' as const,
        currentExecutionId: 'exec-1',
      };
      db.limit.mockResolvedValueOnce([task] as any);
      amqpConnection.publish.mockRejectedValueOnce(new Error('broker down'));

      await expect(
        service.stop('task-1', 'user-1', 'tenant-1', {
          reason: 'manual stop',
        }),
      ).rejects.toThrow('broker down');

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

    it('rejects when task restart is requested for a non-terminal task', async () => {
      db.limit.mockResolvedValueOnce([
        {
          ...BASE_TASK,
          status: 'in_progress' as const,
        },
      ] as any);

      await expect(
        service.restart('task-1', 'user-1', 'tenant-1', {
          notes: 'retry with fixes',
        }),
      ).rejects.toThrow('Cannot restart task in in_progress status');

      expect(amqpConnection.publish).not.toHaveBeenCalled();
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

    it('rejects retry when the task has no assigned bot', async () => {
      db.limit
        .mockResolvedValueOnce([
          {
            ...BASE_TASK,
            status: 'failed' as const,
            botId: null,
          },
        ] as any)
        .mockResolvedValueOnce([
          {
            id: 'exec-source',
            taskId: 'task-1',
            status: 'completed',
          },
        ] as any);

      await expect(
        service.retry(
          'task-1',
          { executionId: 'exec-source', notes: 'try again' } as never,
          'user-1',
          'tenant-1',
        ),
      ).rejects.toThrow('Cannot retry task without an assigned bot');

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
      taskRow = {
        ...BASE_TASK,
        status: 'pending_action' as const,
        currentExecutionId: 'exec-1',
      },
      interventionRow = intervention,
    }: {
      taskRow?: typeof BASE_TASK | null;
      interventionRow?: typeof intervention | null;
    } = {}) {
      let limitCallCount = 0;
      db.limit.mockImplementation((() => {
        limitCallCount++;
        if (limitCallCount === 1) {
          return Promise.resolve(taskRow ? [taskRow] : []);
        }
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

    it('rejects when the task cannot be found', async () => {
      setupResolveInterventionMocks({ taskRow: null });

      await expect(
        service.resolveIntervention('task-1', 'int-1', 'user-1', 'tenant-1', {
          action: 'approve',
        }),
      ).rejects.toThrow('Task not found');

      expect(amqpConnection.publish).not.toHaveBeenCalled();
      expect(taskCastService.transitionStatus).not.toHaveBeenCalled();
      expect(taskCastService.publishEvent).not.toHaveBeenCalled();
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
