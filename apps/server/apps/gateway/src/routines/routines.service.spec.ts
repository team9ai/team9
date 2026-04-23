import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { RoutinesService } from './routines.service.js';
import { TaskCastService } from './taskcast.service.js';
import { DATABASE_CONNECTION } from '@team9/database';
import { DocumentsService } from '../documents/documents.service.js';
import { ChannelsService } from '../im/channels/channels.service.js';
import { ClawHiveService } from '@team9/claw-hive';
import { BotService } from '../bot/bot.service.js';
import { RoutineTriggersService } from './routine-triggers.service.js';
import { WEBSOCKET_GATEWAY } from '../shared/constants/injection-tokens.js';
import {
  AmqpConnection,
  RABBITMQ_EXCHANGES,
  RABBITMQ_ROUTING_KEYS,
} from '@team9/rabbitmq';
import { UsersService } from '../im/users/users.service.js';

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

describe('RoutinesService — TaskCast integration', () => {
  let service: RoutinesService;
  let db: ReturnType<typeof mockDb>;
  let taskCastService: { transitionStatus: MockFn; publishEvent: MockFn };
  let amqpConnection: { publish: MockFn };
  let documentsService: { create: MockFn; update: MockFn; getById: MockFn };
  let routineTriggersService: {
    createBatch: MockFn;
    replaceAllForRoutine: MockFn;
    listByRoutine: MockFn;
  };
  let channelsService: {
    archiveCreationChannel: MockFn;
    createRoutineSessionChannel: MockFn;
    hardDeleteRoutineSessionChannel: MockFn;
  };
  let clawHiveService: {
    deleteAgent: MockFn;
    registerAgent: MockFn;
    sendInput: MockFn;
    createSession: MockFn;
    deleteSession: MockFn;
  };
  let botsService: { getBotById: MockFn };
  let wsGateway: { broadcastToWorkspace: MockFn };
  let usersService: { getLocalePreferences: MockFn };

  beforeEach(async () => {
    db = mockDb();
    amqpConnection = { publish: jest.fn<any>().mockResolvedValue(undefined) };
    documentsService = {
      create: jest.fn<any>().mockResolvedValue({ id: 'doc-1' }),
      update: jest.fn<any>().mockResolvedValue(undefined),
      getById: jest.fn<any>().mockResolvedValue({
        id: 'doc-1',
        tenantId: 'tenant-1',
        currentVersion: { versionIndex: 1, content: 'some content' },
      }),
    };
    routineTriggersService = {
      createBatch: jest.fn<any>().mockResolvedValue(undefined),
      replaceAllForRoutine: jest.fn<any>().mockResolvedValue(undefined),
      listByRoutine: jest.fn<any>().mockResolvedValue([]),
    };
    taskCastService = {
      transitionStatus: jest.fn<any>().mockResolvedValue(undefined),
      publishEvent: jest.fn<any>().mockResolvedValue(undefined),
    };
    channelsService = {
      archiveCreationChannel: jest.fn<any>().mockResolvedValue(undefined),
      createRoutineSessionChannel: jest
        .fn<any>()
        .mockResolvedValue({ id: 'channel-1' }),
      hardDeleteRoutineSessionChannel: jest
        .fn<any>()
        .mockResolvedValue(undefined),
    };
    clawHiveService = {
      deleteAgent: jest.fn<any>().mockResolvedValue(undefined),
      registerAgent: jest.fn<any>().mockResolvedValue(undefined),
      sendInput: jest.fn<any>().mockResolvedValue({ messages: [] }),
      createSession: jest
        .fn<any>()
        .mockResolvedValue({ sessionId: 'pre-created-session' }),
      deleteSession: jest.fn<any>().mockResolvedValue(undefined),
    };
    botsService = {
      getBotById: jest.fn<any>().mockResolvedValue(null),
    };
    wsGateway = {
      broadcastToWorkspace: jest.fn<any>().mockResolvedValue(undefined),
    };
    usersService = {
      getLocalePreferences: jest
        .fn<any>()
        .mockResolvedValue({ language: null, timeZone: null }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoutinesService,
        { provide: DATABASE_CONNECTION, useValue: db },
        { provide: AmqpConnection, useValue: amqpConnection },
        { provide: DocumentsService, useValue: documentsService },
        { provide: RoutineTriggersService, useValue: routineTriggersService },
        { provide: TaskCastService, useValue: taskCastService },
        { provide: ChannelsService, useValue: channelsService },
        { provide: ClawHiveService, useValue: clawHiveService },
        { provide: BotService, useValue: botsService },
        { provide: WEBSOCKET_GATEWAY, useValue: wsGateway },
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();

    service = module.get<RoutinesService>(RoutinesService);
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
        { routine: taskA, executionTokenUsage: null },
        { routine: taskB, executionTokenUsage: 17 },
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
        routineId: 'task-1',
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
          routineId: 'task-1',
          createdAt: new Date('2024-01-02T00:00:00.000Z'),
        },
        {
          id: 'exec-1',
          routineId: 'task-1',
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
          routineId: 'task-1',
          executionId: 'exec-1',
        },
      ];
      const interventions = [
        {
          id: 'int-1',
          routineId: 'task-1',
          executionId: 'exec-1',
        },
      ];
      const execution = {
        id: 'exec-1',
        routineId: 'task-1',
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
          routineId: 'task-1',
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
          routineId: 'task-1',
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
        routineId: 'task-1',
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
      expect(routineTriggersService.createBatch).not.toHaveBeenCalled();
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

      expect(routineTriggersService.createBatch).toHaveBeenCalledWith(
        expect.any(String),
        triggers,
        'tenant-1',
      );
    });

    // ── A-I5: create flow must emit ZERO broadcasts (regression) ──────
    it('does NOT emit routine:updated when creating a routine with N triggers (A-C1 regression)', async () => {
      const createdTask = {
        id: 'task-new',
        tenantId: 'tenant-1',
        creatorId: 'user-1',
        title: 'New task',
        documentId: 'doc-new',
      };
      const triggers = [
        { type: 'manual' },
        { type: 'manual' },
        { type: 'manual' },
      ];

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

      // RoutinesService.create itself must NOT emit (it's a create, not
      // update), and since createBatch bypasses the public create()
      // wrapper post A-C1, the nested calls must not emit either.
      expect(wsGateway.broadcastToWorkspace).not.toHaveBeenCalled();
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

    it('broadcasts routine:updated to the workspace on successful update', async () => {
      const task = {
        ...BASE_TASK,
        creatorId: 'user-1',
        tenantId: 'tenant-1',
      };
      const updatedTask = { ...task, title: 'Renamed' };

      db.limit.mockResolvedValueOnce([task] as any);
      db.returning.mockResolvedValueOnce([updatedTask] as any);

      await service.update(
        'task-1',
        { title: 'Renamed' } as never,
        'user-1',
        'tenant-1',
      );

      expect(wsGateway.broadcastToWorkspace).toHaveBeenCalledTimes(1);
      expect(wsGateway.broadcastToWorkspace).toHaveBeenCalledWith(
        'tenant-1',
        'routine:updated',
        { routineId: 'task-1' },
      );
    });

    it('does not broadcast when the caller is not the creator', async () => {
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

      expect(wsGateway.broadcastToWorkspace).not.toHaveBeenCalled();
    });

    it('does not broadcast when a rejected status transition is requested', async () => {
      db.limit.mockResolvedValueOnce([
        {
          ...BASE_TASK,
          creatorId: 'user-1',
          status: 'draft' as const,
        },
      ] as any);

      await expect(
        service.update(
          'task-1',
          { status: 'in_progress' } as never,
          'user-1',
          'tenant-1',
        ),
      ).rejects.toThrow(
        "Cannot change routine status from 'draft' to 'in_progress'",
      );

      expect(wsGateway.broadcastToWorkspace).not.toHaveBeenCalled();
    });

    it('does not broadcast when the routine is not found', async () => {
      db.limit.mockResolvedValueOnce([] as any);

      await expect(
        service.update(
          'task-1',
          { title: 'Updated title' } as never,
          'user-1',
          'tenant-1',
        ),
      ).rejects.toThrow('Routine not found');

      expect(wsGateway.broadcastToWorkspace).not.toHaveBeenCalled();
    });

    // ── A-I4: triggers replace path emits exactly once ────────────────
    it('emits routine:updated exactly once when dto.triggers is provided (replaceAllForRoutine path)', async () => {
      const task = {
        ...BASE_TASK,
        creatorId: 'user-1',
        tenantId: 'tenant-1',
      };
      const updatedTask = { ...task };
      db.limit.mockResolvedValueOnce([task] as any);
      db.returning.mockResolvedValueOnce([updatedTask] as any);

      const triggers = [{ type: 'manual' }];
      await service.update(
        'task-1',
        { triggers } as never,
        'user-1',
        'tenant-1',
      );

      // Triggers were replaced via the dedicated service
      expect(routineTriggersService.replaceAllForRoutine).toHaveBeenCalledWith(
        'task-1',
        triggers,
      );
      // And only ONE broadcast happened (from the outer update's tail —
      // replaceAllForRoutine itself must not emit).
      expect(wsGateway.broadcastToWorkspace).toHaveBeenCalledTimes(1);
      expect(wsGateway.broadcastToWorkspace).toHaveBeenCalledWith(
        'tenant-1',
        'routine:updated',
        { routineId: 'task-1' },
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
        'Cannot delete routine in pending_action status. Stop the routine first.',
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

    // ── A-I9: delete broadcasts routine:updated ───────────────────────
    it('broadcasts routine:updated to the workspace on successful delete', async () => {
      db.limit.mockResolvedValueOnce([
        {
          ...BASE_TASK,
          id: 'task-1',
          tenantId: 'tenant-1',
          creatorId: 'user-1',
          status: 'completed' as const,
        },
      ] as any);

      await service.delete('task-1', 'user-1', 'tenant-1');

      expect(wsGateway.broadcastToWorkspace).toHaveBeenCalledTimes(1);
      expect(wsGateway.broadcastToWorkspace).toHaveBeenCalledWith(
        'tenant-1',
        'routine:updated',
        { routineId: 'task-1' },
      );
    });

    it('does NOT broadcast when delete is rejected (non-creator)', async () => {
      db.limit.mockResolvedValueOnce([
        {
          ...BASE_TASK,
          creatorId: 'other-user',
          status: 'completed' as const,
        },
      ] as any);

      await expect(
        service.delete('task-1', 'user-1', 'tenant-1'),
      ).rejects.toThrow('You do not have permission to perform this action');

      expect(wsGateway.broadcastToWorkspace).not.toHaveBeenCalled();
      expect(db.delete).not.toHaveBeenCalled();
    });

    it('does NOT broadcast when delete is rejected (active routine)', async () => {
      db.limit.mockResolvedValueOnce([
        {
          ...BASE_TASK,
          creatorId: 'user-1',
          status: 'in_progress' as const,
        },
      ] as any);

      await expect(
        service.delete('task-1', 'user-1', 'tenant-1'),
      ).rejects.toThrow('Cannot delete routine in in_progress status');

      expect(wsGateway.broadcastToWorkspace).not.toHaveBeenCalled();
      expect(db.delete).not.toHaveBeenCalled();
    });

    it('does NOT broadcast when the routine is not found', async () => {
      db.limit.mockResolvedValueOnce([] as any);

      await expect(
        service.delete('task-missing', 'user-1', 'tenant-1'),
      ).rejects.toThrow('Routine not found');

      expect(wsGateway.broadcastToWorkspace).not.toHaveBeenCalled();
      expect(db.delete).not.toHaveBeenCalled();
    });

    it('uses the DB-verified tenantId (not the param) for the broadcast', async () => {
      // Routine lives in tenant-1 but caller passes some other tenantId —
      // the getRoutineOrThrow will of course reject cross-tenant lookups,
      // but here we verify that when the DB row is found, its tenantId
      // (not the param) is used. Shape: DB row has tenantId set explicitly.
      db.limit.mockResolvedValueOnce([
        {
          ...BASE_TASK,
          id: 'task-1',
          tenantId: 'tenant-verified',
          creatorId: 'user-1',
          status: 'completed' as const,
        },
      ] as any);

      await service.delete('task-1', 'user-1', 'tenant-verified');

      expect(wsGateway.broadcastToWorkspace).toHaveBeenCalledWith(
        'tenant-verified',
        'routine:updated',
        { routineId: 'task-1' },
      );
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
          routineId: 'task-1',
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
      ).rejects.toThrow('Cannot start routine without an assigned bot');

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
      ).rejects.toThrow('Cannot start routine in in_progress status');

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
          routineId: 'task-1',
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
      ).rejects.toThrow('Cannot pause routine in paused status');

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
          routineId: 'task-1',
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
      ).rejects.toThrow('Cannot resume routine in in_progress status');

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
          routineId: 'task-1',
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
          routineId: 'task-1',
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
      ).rejects.toThrow('Cannot stop routine in completed status');

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
          routineId: 'task-1',
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
      ).rejects.toThrow('Cannot restart routine in in_progress status');

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
            routineId: 'task-1',
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
          routineId: 'task-1',
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
            routineId: 'task-1',
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
            routineId: 'task-1',
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
      ).rejects.toThrow('Cannot retry routine without an assigned bot');

      expect(amqpConnection.publish).not.toHaveBeenCalled();
    });
  });

  // ── resolveIntervention ───────────────────────────────────────────

  describe('resolveIntervention', () => {
    const intervention = {
      id: 'int-1',
      routineId: 'task-1',
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
          routineId: 'task-1',
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
      ).rejects.toThrow('Routine not found');

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

  // ── draft-aware create ────────────────────────────────────────────

  describe('create — draft awareness', () => {
    const createdTask = {
      id: 'task-new',
      tenantId: 'tenant-1',
      creatorId: 'user-1',
      title: 'New task',
      documentId: 'doc-new',
      status: 'upcoming' as const,
    };

    beforeEach(() => {
      documentsService.create.mockResolvedValue({ id: 'doc-new' } as any);
      db.returning.mockResolvedValue([createdTask] as any);
    });

    it('defaults status to upcoming when not provided', async () => {
      await service.create(
        { title: 'New task' } as never,
        'user-1',
        'tenant-1',
      );

      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'upcoming' }),
      );
    });

    it('writes draft status when explicitly provided', async () => {
      await service.create(
        { title: 'New task', status: 'draft' } as never,
        'user-1',
        'tenant-1',
      );

      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'draft' }),
      );
    });

    it('skips trigger registration when status is draft', async () => {
      const triggers = [{ type: 'manual' }];
      await service.create(
        { title: 'New task', status: 'draft', triggers } as never,
        'user-1',
        'tenant-1',
      );

      expect(routineTriggersService.createBatch).not.toHaveBeenCalled();
    });

    it('registers triggers for upcoming routines', async () => {
      const triggers = [{ type: 'manual' }];
      await service.create(
        { title: 'New task', status: 'upcoming', triggers } as never,
        'user-1',
        'tenant-1',
      );

      expect(routineTriggersService.createBatch).toHaveBeenCalledWith(
        expect.any(String),
        triggers,
        'tenant-1',
      );
    });

    it('writes sourceRef when provided in options', async () => {
      await service.create(
        { title: 'New task' } as never,
        'user-1',
        'tenant-1',
        { sourceRef: 'ref-abc' },
      );

      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({ sourceRef: 'ref-abc' }),
      );
    });

    it('writes sourceRef as null when options not provided', async () => {
      await service.create(
        { title: 'New task' } as never,
        'user-1',
        'tenant-1',
      );

      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({ sourceRef: null }),
      );
    });
  });

  // ── draft-aware update ────────────────────────────────────────────

  describe('update — draft awareness', () => {
    const draftTask = {
      ...BASE_TASK,
      status: 'draft' as const,
      creatorId: 'user-1',
      documentId: 'doc-1',
    };
    const upcomingTask = {
      ...BASE_TASK,
      status: 'upcoming' as const,
      creatorId: 'user-1',
      documentId: 'doc-1',
    };

    it('rejects status transition from draft to upcoming', async () => {
      db.limit.mockResolvedValueOnce([draftTask] as any);

      await expect(
        service.update(
          'task-1',
          { status: 'upcoming' } as never,
          'user-1',
          'tenant-1',
        ),
      ).rejects.toThrow(
        "Cannot change routine status from 'draft' to 'upcoming'",
      );

      expect(db.update).not.toHaveBeenCalled();
    });

    it('rejects status transition from upcoming to draft', async () => {
      db.limit.mockResolvedValueOnce([upcomingTask] as any);

      await expect(
        service.update(
          'task-1',
          { status: 'draft' } as never,
          'user-1',
          'tenant-1',
        ),
      ).rejects.toThrow(
        "Cannot change routine status from 'upcoming' to 'draft'",
      );

      expect(db.update).not.toHaveBeenCalled();
    });

    it('allows update when status matches current (no-op status field)', async () => {
      db.limit.mockResolvedValueOnce([draftTask] as any);
      db.returning.mockResolvedValueOnce([draftTask] as any);

      await expect(
        service.update(
          'task-1',
          { status: 'draft', title: 'New title' } as never,
          'user-1',
          'tenant-1',
        ),
      ).resolves.toEqual(draftTask);
    });

    it('allows update when status field is not provided', async () => {
      db.limit.mockResolvedValueOnce([draftTask] as any);
      db.returning.mockResolvedValueOnce([draftTask] as any);

      await expect(
        service.update(
          'task-1',
          { title: 'New title' } as never,
          'user-1',
          'tenant-1',
        ),
      ).resolves.toEqual(draftTask);
    });

    it('calls documentsService.update with documentContent', async () => {
      db.limit.mockResolvedValueOnce([draftTask] as any);
      db.returning.mockResolvedValueOnce([draftTask] as any);

      await service.update(
        'task-1',
        { documentContent: 'new content' } as never,
        'user-1',
        'tenant-1',
      );

      expect(documentsService.update).toHaveBeenCalledWith(
        'doc-1',
        { content: 'new content' },
        { type: 'user', id: 'user-1' },
      );
    });

    it('throws when documentContent provided but routine has no documentId', async () => {
      db.limit.mockResolvedValueOnce([
        { ...draftTask, documentId: null },
      ] as any);

      await expect(
        service.update(
          'task-1',
          { documentContent: 'new content' } as never,
          'user-1',
          'tenant-1',
        ),
      ).rejects.toThrow(
        'Cannot update document content: routine has no linked document.',
      );

      expect(documentsService.update).not.toHaveBeenCalled();
    });

    it('calls replaceAllForRoutine when triggers are provided', async () => {
      db.limit.mockResolvedValueOnce([draftTask] as any);
      db.returning.mockResolvedValueOnce([draftTask] as any);

      const triggers = [{ type: 'manual' }];
      await service.update(
        'task-1',
        { triggers } as never,
        'user-1',
        'tenant-1',
      );

      expect(routineTriggersService.replaceAllForRoutine).toHaveBeenCalledWith(
        'task-1',
        triggers,
      );
    });

    it('allows empty triggers array (wholesale delete)', async () => {
      db.limit.mockResolvedValueOnce([draftTask] as any);
      db.returning.mockResolvedValueOnce([draftTask] as any);

      await service.update(
        'task-1',
        { triggers: [] } as never,
        'user-1',
        'tenant-1',
      );

      expect(routineTriggersService.replaceAllForRoutine).toHaveBeenCalledWith(
        'task-1',
        [],
      );
    });

    it('does not call replaceAllForRoutine when triggers field is absent', async () => {
      db.limit.mockResolvedValueOnce([draftTask] as any);
      db.returning.mockResolvedValueOnce([draftTask] as any);

      await service.update(
        'task-1',
        { title: 'No triggers field' } as never,
        'user-1',
        'tenant-1',
      );

      expect(
        routineTriggersService.replaceAllForRoutine,
      ).not.toHaveBeenCalled();
    });
  });

  // ── draft-aware list ──────────────────────────────────────────────

  describe('list — draft visibility', () => {
    it("hides other users' drafts when currentUserId is provided", async () => {
      const ownDraft = {
        ...BASE_TASK,
        id: 'task-own-draft',
        status: 'draft' as const,
        creatorId: 'user-1',
      };
      const otherDraft = {
        ...BASE_TASK,
        id: 'task-other-draft',
        status: 'draft' as const,
        creatorId: 'user-2',
      };
      const upcoming = {
        ...BASE_TASK,
        id: 'task-upcoming',
        status: 'upcoming' as const,
        creatorId: 'user-2',
      };

      // The query includes the draft-filter condition so the DB already filters;
      // we simulate the DB returning only allowed rows
      db.orderBy.mockResolvedValueOnce([
        { routine: ownDraft, executionTokenUsage: null },
        { routine: upcoming, executionTokenUsage: null },
      ] as any);

      const result = await service.list('tenant-1', undefined, 'user-1');

      // own draft and upcoming visible, other draft excluded (simulated by mock)
      expect(result).toEqual([
        { ...ownDraft, tokenUsage: 0 },
        { ...upcoming, tokenUsage: 0 },
      ]);

      // Confirm the or condition was added (indicated by extra condition count via and)
      expect(db.where).toHaveBeenCalled();
      // Other draft would not appear since query filtered it
      expect(result.find((r) => r.id === otherDraft.id)).toBeUndefined();
    });

    it('shows own drafts when currentUserId is provided', async () => {
      const ownDraft = {
        ...BASE_TASK,
        id: 'task-own-draft',
        status: 'draft' as const,
        creatorId: 'user-1',
      };

      db.orderBy.mockResolvedValueOnce([
        { routine: ownDraft, executionTokenUsage: null },
      ] as any);

      const result = await service.list('tenant-1', undefined, 'user-1');

      expect(result).toEqual([{ ...ownDraft, tokenUsage: 0 }]);
    });

    it('shows all non-drafts regardless of creator', async () => {
      const upcoming = {
        ...BASE_TASK,
        id: 'task-upcoming',
        status: 'upcoming' as const,
        creatorId: 'user-2',
      };
      const completed = {
        ...BASE_TASK,
        id: 'task-completed',
        status: 'completed' as const,
        creatorId: 'user-3',
      };

      db.orderBy.mockResolvedValueOnce([
        { routine: upcoming, executionTokenUsage: null },
        { routine: completed, executionTokenUsage: 5 },
      ] as any);

      const result = await service.list('tenant-1', undefined, 'user-1');

      expect(result).toEqual([
        { ...upcoming, tokenUsage: 0 },
        { ...completed, tokenUsage: 5 },
      ]);
    });
  });

  // ── draft-aware start ─────────────────────────────────────────────

  describe('start — draft rejection', () => {
    it('rejects start when the task is a draft', async () => {
      db.limit.mockResolvedValueOnce([
        {
          ...BASE_TASK,
          status: 'draft' as const,
          botId: 'bot-1',
        },
      ] as any);

      await expect(
        service.start('task-1', 'user-1', 'tenant-1', {
          message: 'kick off',
        } as never),
      ).rejects.toThrow(
        'Cannot start routine in draft status. Complete creation first via POST /v1/routines/:id/complete-creation.',
      );

      expect(amqpConnection.publish).not.toHaveBeenCalled();
    });
  });

  // ── draft-aware delete ────────────────────────────────────────────

  describe('delete — draft bypass', () => {
    it('allows deletion of draft routines without the active-status guard', async () => {
      db.limit.mockResolvedValueOnce([
        {
          ...BASE_TASK,
          status: 'draft' as const,
          creatorId: 'user-1',
        },
      ] as any);

      await expect(
        service.delete('task-1', 'user-1', 'tenant-1'),
      ).resolves.toEqual({ success: true });

      expect(db.delete).toHaveBeenCalledTimes(1);
    });
  });

  describe('delete — draft handling', () => {
    const ROUTINE_ID = 'task-1';
    const DRAFT_WITH_CHANNEL = {
      ...BASE_TASK,
      id: ROUTINE_ID,
      status: 'draft' as const,
      creatorId: 'user-1',
      creationChannelId: 'channel-1',
    };

    it('hard-deletes the creation channel when deleting a draft with creationChannelId set', async () => {
      db.limit.mockResolvedValueOnce([DRAFT_WITH_CHANNEL] as any);

      await expect(
        service.delete(ROUTINE_ID, 'user-1', 'tenant-1'),
      ).resolves.toEqual({ success: true });

      expect(db.delete).toHaveBeenCalledTimes(1);
      expect(clawHiveService.deleteAgent).not.toHaveBeenCalled();
      expect(
        channelsService.hardDeleteRoutineSessionChannel,
      ).toHaveBeenCalledWith('channel-1', 'tenant-1');
    });

    it('does not call hardDeleteRoutineSessionChannel when draft has no creationChannelId', async () => {
      const draftWithoutChannel = {
        ...DRAFT_WITH_CHANNEL,
        creationChannelId: null,
      };
      db.limit.mockResolvedValueOnce([draftWithoutChannel] as any);

      await expect(
        service.delete(ROUTINE_ID, 'user-1', 'tenant-1'),
      ).resolves.toEqual({ success: true });

      expect(db.delete).toHaveBeenCalledTimes(1);
      expect(
        channelsService.hardDeleteRoutineSessionChannel,
      ).not.toHaveBeenCalled();
    });

    it('still deletes the routine row when hardDeleteRoutineSessionChannel throws', async () => {
      db.limit.mockResolvedValueOnce([DRAFT_WITH_CHANNEL] as any);

      channelsService.hardDeleteRoutineSessionChannel.mockRejectedValueOnce(
        new Error('cascade failed'),
      );

      const loggerWarnSpy = jest.spyOn((service as any).logger, 'warn');

      const result = await service.delete(ROUTINE_ID, 'user-1', 'tenant-1');

      expect(result).toEqual({ success: true });
      expect(db.delete).toHaveBeenCalled();
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('failed to hard-delete creation channel'),
      );
    });

    it('hard-deletes the creation channel for non-draft routines too', async () => {
      // The creation channel remains linked to the routine even after it
      // transitions to upcoming (archived, but row still exists). Deleting
      // the routine must also drop the channel — the FK ON DELETE SET NULL
      // goes the other direction (channel→routine column), not routine→channel.
      db.limit.mockResolvedValueOnce([
        {
          ...DRAFT_WITH_CHANNEL,
          status: 'upcoming' as const,
        },
      ] as any);

      await expect(
        service.delete(ROUTINE_ID, 'user-1', 'tenant-1'),
      ).resolves.toEqual({ success: true });

      expect(
        channelsService.hardDeleteRoutineSessionChannel,
      ).toHaveBeenCalledWith('channel-1', 'tenant-1');
      expect(db.delete).toHaveBeenCalled();
    });

    it('does not call hardDeleteRoutineSessionChannel for non-draft routines without creationChannelId', async () => {
      db.limit.mockResolvedValueOnce([
        {
          ...DRAFT_WITH_CHANNEL,
          status: 'upcoming' as const,
          creationChannelId: null,
        },
      ] as any);

      await service.delete(ROUTINE_ID, 'user-1', 'tenant-1');

      expect(
        channelsService.hardDeleteRoutineSessionChannel,
      ).not.toHaveBeenCalled();
      expect(db.delete).toHaveBeenCalled();
    });
  });

  // ── completeCreation ──────────────────────────────────────────────

  describe('completeCreation', () => {
    const DRAFT_ROUTINE = {
      ...BASE_TASK,
      id: 'routine-1',
      status: 'draft' as const,
      creatorId: 'user-1',
      botId: 'bot-1',
      title: 'My Routine',
      documentId: 'doc-1',
      creationChannelId: 'channel-1',
    };

    const UPDATED_ROUTINE = {
      ...DRAFT_ROUTINE,
      status: 'upcoming' as const,
    };

    beforeEach(() => {
      // By default, getBotById returns a valid bot so completeCreation doesn't
      // reject with "executing agent no longer exists". Individual tests that
      // need the bot to be missing override with mockResolvedValueOnce(null).
      botsService.getBotById.mockResolvedValue({
        botId: 'bot-1',
        userId: 'user-1',
      } as any);
    });

    it('transitions draft → upcoming and archives the creation channel', async () => {
      db.limit.mockResolvedValueOnce([DRAFT_ROUTINE] as any);
      db.returning.mockResolvedValueOnce([UPDATED_ROUTINE] as any);
      documentsService.getById.mockResolvedValueOnce({
        id: 'doc-1',
        tenantId: 'tenant-1',
        currentVersion: { versionIndex: 1, content: 'some content' },
      } as any);

      const result = await service.completeCreation(
        'routine-1',
        {},
        'user-1',
        'tenant-1',
      );

      expect(result).toEqual(UPDATED_ROUTINE);
      expect(db.update).toHaveBeenCalledTimes(1);
      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'upcoming' }),
      );
      expect(channelsService.archiveCreationChannel).toHaveBeenCalledWith(
        'channel-1',
        'tenant-1',
      );
      expect(clawHiveService.deleteAgent).not.toHaveBeenCalled();
    });

    it('throws 404 when routine is not found', async () => {
      db.limit.mockResolvedValueOnce([] as any);

      await expect(
        service.completeCreation('missing-id', {}, 'user-1', 'tenant-1'),
      ).rejects.toThrow('Routine not found');
    });

    it('throws 403 when caller is not the creator', async () => {
      db.limit.mockResolvedValueOnce([
        { ...DRAFT_ROUTINE, creatorId: 'other-user' },
      ] as any);

      await expect(
        service.completeCreation('routine-1', {}, 'user-1', 'tenant-1'),
      ).rejects.toThrow('You do not have permission to perform this action');
    });

    it('is idempotent — returns current routine when already upcoming', async () => {
      const upcomingRoutine = {
        ...DRAFT_ROUTINE,
        status: 'upcoming' as const,
        creationChannelId: null,
      };
      db.limit.mockResolvedValueOnce([upcomingRoutine] as any);

      const result = await service.completeCreation(
        'routine-1',
        {},
        'user-1',
        'tenant-1',
      );

      expect(result).toEqual(upcomingRoutine);
      expect(db.update).not.toHaveBeenCalled();
    });

    it('retries archive on idempotent-upcoming path when creationChannelId still set', async () => {
      // Earlier completeCreation call succeeded status-flip but failed
      // archive — the routine is now upcoming AND creationChannelId is
      // still set. A retry should re-attempt archival.
      const upcomingWithChannel = {
        ...DRAFT_ROUTINE,
        status: 'upcoming' as const,
        creationChannelId: 'ch-1',
      };
      db.limit.mockResolvedValueOnce([upcomingWithChannel] as any);
      channelsService.archiveCreationChannel.mockResolvedValueOnce(undefined);

      const result = await service.completeCreation(
        'routine-1',
        {},
        'user-1',
        'tenant-1',
      );

      expect(result).toEqual(upcomingWithChannel);
      expect(channelsService.archiveCreationChannel).toHaveBeenCalledWith(
        'ch-1',
        'tenant-1',
      );
      // Status flip is NOT re-executed (idempotent path)
      expect(db.update).not.toHaveBeenCalled();
    });

    it('idempotent-upcoming archive failure is non-fatal', async () => {
      const upcomingWithChannel = {
        ...DRAFT_ROUTINE,
        status: 'upcoming' as const,
        creationChannelId: 'ch-1',
      };
      db.limit.mockResolvedValueOnce([upcomingWithChannel] as any);
      channelsService.archiveCreationChannel.mockRejectedValueOnce(
        new Error('transient'),
      );

      // Still returns the routine without throwing
      const result = await service.completeCreation(
        'routine-1',
        {},
        'user-1',
        'tenant-1',
      );
      expect(result).toEqual(upcomingWithChannel);
    });

    it('throws 400 when status is not draft or upcoming (e.g. completed)', async () => {
      db.limit.mockResolvedValueOnce([
        { ...DRAFT_ROUTINE, status: 'completed' as const },
      ] as any);

      await expect(
        service.completeCreation('routine-1', {}, 'user-1', 'tenant-1'),
      ).rejects.toThrow(
        "Cannot complete creation of routine in 'completed' status",
      );
    });

    it('throws 400 with validation error when title is empty', async () => {
      db.limit.mockResolvedValueOnce([{ ...DRAFT_ROUTINE, title: '' }] as any);
      documentsService.getById.mockResolvedValueOnce({
        id: 'doc-1',
        tenantId: 'tenant-1',
        currentVersion: { versionIndex: 1, content: 'some content' },
      } as any);

      await expect(
        service.completeCreation('routine-1', {}, 'user-1', 'tenant-1'),
      ).rejects.toMatchObject({
        response: {
          message: 'Missing required fields',
          errors: expect.arrayContaining(['title is required']),
        },
      });
    });

    it('throws 400 with validation error when botId is null', async () => {
      db.limit.mockResolvedValueOnce([
        { ...DRAFT_ROUTINE, botId: null },
      ] as any);
      documentsService.getById.mockResolvedValueOnce({
        id: 'doc-1',
        tenantId: 'tenant-1',
        currentVersion: { versionIndex: 1, content: 'some content' },
      } as any);

      await expect(
        service.completeCreation('routine-1', {}, 'user-1', 'tenant-1'),
      ).rejects.toMatchObject({
        response: {
          message: 'Missing required fields',
          errors: expect.arrayContaining(['botId is required']),
        },
      });
    });

    it('throws 400 with validation error when document content is empty', async () => {
      db.limit.mockResolvedValueOnce([DRAFT_ROUTINE] as any);
      documentsService.getById.mockResolvedValueOnce({
        id: 'doc-1',
        tenantId: 'tenant-1',
        currentVersion: { versionIndex: 1, content: '' },
      } as any);

      await expect(
        service.completeCreation('routine-1', {}, 'user-1', 'tenant-1'),
      ).rejects.toMatchObject({
        response: {
          message: 'Missing required fields',
          errors: expect.arrayContaining(['documentContent is required']),
        },
      });
    });

    it('calls archiveCreationChannel with the correct channel and tenant when creationChannelId is set', async () => {
      db.limit.mockResolvedValueOnce([DRAFT_ROUTINE] as any);
      db.returning.mockResolvedValueOnce([UPDATED_ROUTINE] as any);
      documentsService.getById.mockResolvedValueOnce({
        id: 'doc-1',
        tenantId: 'tenant-1',
        currentVersion: { versionIndex: 1, content: 'some content' },
      } as any);

      const result = await service.completeCreation(
        'routine-1',
        {},
        'user-1',
        'tenant-1',
      );

      expect(result).toEqual(UPDATED_ROUTINE);
      expect(channelsService.archiveCreationChannel).toHaveBeenCalledWith(
        'channel-1',
        'tenant-1',
      );
    });

    it('logs a warning but still returns the updated routine when archiveCreationChannel fails', async () => {
      db.limit.mockResolvedValueOnce([DRAFT_ROUTINE] as any);
      db.returning.mockResolvedValueOnce([UPDATED_ROUTINE] as any);
      documentsService.getById.mockResolvedValueOnce({
        id: 'doc-1',
        tenantId: 'tenant-1',
        currentVersion: { versionIndex: 1, content: 'some content' },
      } as any);

      channelsService.archiveCreationChannel.mockRejectedValueOnce(
        new Error('disk full'),
      );

      const loggerWarnSpy = jest.spyOn((service as any).logger, 'warn');

      const result = await service.completeCreation(
        'routine-1',
        { notes: undefined },
        'user-1',
        'tenant-1',
      );

      expect(result.status).toBe('upcoming');
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('failed to archive creation channel'),
      );
    });

    it('does not call archiveCreationChannel when creationChannelId is null', async () => {
      const draftWithoutChannel = {
        ...DRAFT_ROUTINE,
        creationChannelId: null,
      };
      db.limit.mockResolvedValueOnce([draftWithoutChannel] as any);
      db.returning.mockResolvedValueOnce([
        { ...UPDATED_ROUTINE, creationChannelId: null },
      ] as any);
      documentsService.getById.mockResolvedValueOnce({
        id: 'doc-1',
        tenantId: 'tenant-1',
        currentVersion: { versionIndex: 1, content: 'some content' },
      } as any);

      await service.completeCreation('routine-1', {}, 'user-1', 'tenant-1');

      expect(channelsService.archiveCreationChannel).not.toHaveBeenCalled();
    });

    it('does not call deleteAgent on completion (no clone to clean up)', async () => {
      db.limit.mockResolvedValueOnce([DRAFT_ROUTINE] as any);
      db.returning.mockResolvedValueOnce([UPDATED_ROUTINE] as any);
      documentsService.getById.mockResolvedValueOnce({
        id: 'doc-1',
        tenantId: 'tenant-1',
        currentVersion: { versionIndex: 1, content: 'some content' },
      } as any);

      const result = await service.completeCreation(
        'routine-1',
        {},
        'user-1',
        'tenant-1',
      );

      expect(result).toEqual(UPDATED_ROUTINE);
      expect(clawHiveService.deleteAgent).not.toHaveBeenCalled();
    });

    it('returns 400 when executing bot no longer exists', async () => {
      db.limit.mockResolvedValueOnce([DRAFT_ROUTINE] as any);
      documentsService.getById.mockResolvedValueOnce({
        id: 'doc-1',
        tenantId: 'tenant-1',
        currentVersion: { versionIndex: 1, content: 'some content' },
      } as any);
      botsService.getBotById.mockResolvedValue(null as any);

      await expect(
        service.completeCreation('routine-1', {}, 'user-1', 'tenant-1'),
      ).rejects.toMatchObject({
        response: {
          message: 'Missing required fields',
          errors: expect.arrayContaining([
            expect.stringMatching(/executing agent/i),
          ]),
        },
      });
    });

    it('treats missing document as empty content (validation error)', async () => {
      // documentId is set but documentsService.getById throws (doc deleted)
      db.limit.mockResolvedValueOnce([DRAFT_ROUTINE] as any);
      documentsService.getById.mockRejectedValueOnce(
        new Error('not found') as any,
      );

      await expect(
        service.completeCreation('routine-1', {}, 'user-1', 'tenant-1'),
      ).rejects.toMatchObject({
        response: {
          message: 'Missing required fields',
          errors: expect.arrayContaining(['documentContent is required']),
        },
      });
    });

    it('returns validation error when routine has no linked document (documentId null)', async () => {
      db.limit.mockResolvedValueOnce([
        { ...DRAFT_ROUTINE, documentId: null },
      ] as any);

      await expect(
        service.completeCreation('routine-1', {}, 'user-1', 'tenant-1'),
      ).rejects.toMatchObject({
        response: {
          message: 'Missing required fields',
          errors: expect.arrayContaining(['documentContent is required']),
        },
      });
    });

    // ── documentContent shape + tenant-guard tests ────────────────────

    it('completeCreation: tenant mismatch on document treats content as empty (rejects with documentContent required)', async () => {
      db.limit.mockResolvedValueOnce([DRAFT_ROUTINE] as any);
      documentsService.getById.mockResolvedValueOnce({
        id: 'doc-1',
        tenantId: 'other-tenant',
        currentVersion: { versionIndex: 1, content: 'foo' },
      } as any);

      await expect(
        service.completeCreation('routine-1', {}, 'user-1', 'tenant-1'),
      ).rejects.toMatchObject({
        response: {
          message: 'Missing required fields',
          errors: expect.arrayContaining(['documentContent is required']),
        },
      });
    });

    it('completeCreation: validates documentContent via doc.currentVersion.content (real shape)', async () => {
      db.limit.mockResolvedValueOnce([DRAFT_ROUTINE] as any);
      db.returning.mockResolvedValueOnce([UPDATED_ROUTINE] as any);
      documentsService.getById.mockResolvedValueOnce({
        id: 'doc-1',
        tenantId: 'tenant-1',
        currentVersion: { versionIndex: 1, content: 'real content' },
      } as any);

      const result = await service.completeCreation(
        'routine-1',
        {},
        'user-1',
        'tenant-1',
      );
      expect(result.status).toBe('upcoming');
    });

    // ── A-I3: completeCreation broadcasts routine:updated ─────────────

    it('broadcasts routine:updated on successful draft → upcoming transition', async () => {
      db.limit.mockResolvedValueOnce([DRAFT_ROUTINE] as any);
      db.returning.mockResolvedValueOnce([UPDATED_ROUTINE] as any);
      documentsService.getById.mockResolvedValueOnce({
        id: 'doc-1',
        tenantId: 'tenant-1',
        currentVersion: { versionIndex: 1, content: 'some content' },
      } as any);

      await service.completeCreation('routine-1', {}, 'user-1', 'tenant-1');

      expect(wsGateway.broadcastToWorkspace).toHaveBeenCalledTimes(1);
      expect(wsGateway.broadcastToWorkspace).toHaveBeenCalledWith(
        'tenant-1',
        'routine:updated',
        { routineId: 'routine-1' },
      );
    });

    it('still broadcasts even when the non-fatal channel archive step fails', async () => {
      db.limit.mockResolvedValueOnce([DRAFT_ROUTINE] as any);
      db.returning.mockResolvedValueOnce([UPDATED_ROUTINE] as any);
      documentsService.getById.mockResolvedValueOnce({
        id: 'doc-1',
        tenantId: 'tenant-1',
        currentVersion: { versionIndex: 1, content: 'some content' },
      } as any);
      // Archive fails after the DB update — broadcast is emitted BEFORE
      // the archive attempt, so it still fires.
      channelsService.archiveCreationChannel.mockRejectedValueOnce(
        new Error('disk full'),
      );

      const result = await service.completeCreation(
        'routine-1',
        {},
        'user-1',
        'tenant-1',
      );

      expect(result.status).toBe('upcoming');
      expect(wsGateway.broadcastToWorkspace).toHaveBeenCalledTimes(1);
      expect(wsGateway.broadcastToWorkspace).toHaveBeenCalledWith(
        'tenant-1',
        'routine:updated',
        { routineId: 'routine-1' },
      );
    });

    it('does NOT broadcast when routine is not found', async () => {
      db.limit.mockResolvedValueOnce([] as any);

      await expect(
        service.completeCreation('missing-id', {}, 'user-1', 'tenant-1'),
      ).rejects.toThrow('Routine not found');

      expect(wsGateway.broadcastToWorkspace).not.toHaveBeenCalled();
    });

    it('does NOT broadcast when caller is not the creator', async () => {
      db.limit.mockResolvedValueOnce([
        { ...DRAFT_ROUTINE, creatorId: 'other-user' },
      ] as any);

      await expect(
        service.completeCreation('routine-1', {}, 'user-1', 'tenant-1'),
      ).rejects.toThrow('You do not have permission to perform this action');

      expect(wsGateway.broadcastToWorkspace).not.toHaveBeenCalled();
    });

    it('does NOT broadcast on idempotent-upcoming path (no status flip)', async () => {
      // Already upcoming — early return without DB update.
      const upcomingRoutine = {
        ...DRAFT_ROUTINE,
        status: 'upcoming' as const,
        creationChannelId: null,
      };
      db.limit.mockResolvedValueOnce([upcomingRoutine] as any);

      await service.completeCreation('routine-1', {}, 'user-1', 'tenant-1');

      // Only the row update triggers a broadcast; idempotent path skips
      // the DB update entirely, so no emit.
      expect(wsGateway.broadcastToWorkspace).not.toHaveBeenCalled();
    });

    it('does NOT broadcast when validation fails (e.g. empty title)', async () => {
      db.limit.mockResolvedValueOnce([{ ...DRAFT_ROUTINE, title: '' }] as any);
      documentsService.getById.mockResolvedValueOnce({
        id: 'doc-1',
        tenantId: 'tenant-1',
        currentVersion: { versionIndex: 1, content: 'some content' },
      } as any);

      await expect(
        service.completeCreation('routine-1', {}, 'user-1', 'tenant-1'),
      ).rejects.toMatchObject({
        response: { message: 'Missing required fields' },
      });

      expect(wsGateway.broadcastToWorkspace).not.toHaveBeenCalled();
    });

    it('uses the DB-verified tenantId (from the fetched routine) for the broadcast', async () => {
      db.limit.mockResolvedValueOnce([
        { ...DRAFT_ROUTINE, tenantId: 'tenant-verified' },
      ] as any);
      db.returning.mockResolvedValueOnce([
        { ...UPDATED_ROUTINE, tenantId: 'tenant-verified' },
      ] as any);
      documentsService.getById.mockResolvedValueOnce({
        id: 'doc-1',
        tenantId: 'tenant-verified',
        currentVersion: { versionIndex: 1, content: 'some content' },
      } as any);

      await service.completeCreation(
        'routine-1',
        {},
        'user-1',
        'tenant-verified',
      );

      expect(wsGateway.broadcastToWorkspace).toHaveBeenCalledWith(
        'tenant-verified',
        'routine:updated',
        { routineId: 'routine-1' },
      );
    });

    // ── autoRunFirst ─────────────────────────────────────────────────

    const setupDraftFixture = () => {
      db.limit.mockResolvedValueOnce([DRAFT_ROUTINE] as any);
      db.returning.mockResolvedValueOnce([UPDATED_ROUTINE] as any);
      documentsService.getById.mockResolvedValueOnce({
        id: 'doc-1',
        tenantId: 'tenant-1',
        currentVersion: { versionIndex: 1, content: 'some content' },
      } as any);
    };

    it('dispatches one manual execution when autoRunFirst is true', async () => {
      setupDraftFixture();
      const startSpy = jest
        .spyOn(service, 'start')
        .mockResolvedValue({ success: true } as any);

      await service.completeCreation(
        'routine-1',
        { autoRunFirst: true },
        'user-1',
        'tenant-1',
      );

      expect(startSpy).toHaveBeenCalledTimes(1);
      expect(startSpy).toHaveBeenCalledWith(
        'routine-1',
        'user-1',
        'tenant-1',
        expect.objectContaining({ message: expect.any(String) }),
      );
      startSpy.mockRestore();
    });

    it('does NOT dispatch when autoRunFirst is omitted', async () => {
      setupDraftFixture();
      const startSpy = jest
        .spyOn(service, 'start')
        .mockResolvedValue({ success: true } as any);

      await service.completeCreation('routine-1', {}, 'user-1', 'tenant-1');

      expect(startSpy).not.toHaveBeenCalled();
      startSpy.mockRestore();
    });

    it('does NOT dispatch when autoRunFirst is false', async () => {
      setupDraftFixture();
      const startSpy = jest
        .spyOn(service, 'start')
        .mockResolvedValue({ success: true } as any);

      await service.completeCreation(
        'routine-1',
        { autoRunFirst: false },
        'user-1',
        'tenant-1',
      );

      expect(startSpy).not.toHaveBeenCalled();
      startSpy.mockRestore();
    });

    it('logs warn but does NOT throw when autoRunFirst dispatch fails', async () => {
      setupDraftFixture();
      const startSpy = jest
        .spyOn(service, 'start')
        .mockRejectedValue(new Error('dispatch boom'));
      const loggerWarn = jest.spyOn((service as any).logger, 'warn');

      const result = await service.completeCreation(
        'routine-1',
        { autoRunFirst: true },
        'user-1',
        'tenant-1',
      );

      expect(result).toBeDefined(); // Did NOT throw
      expect(loggerWarn).toHaveBeenCalledWith(
        expect.stringContaining('autoRunFirst dispatch failed'),
      );
      startSpy.mockRestore();
      loggerWarn.mockRestore();
    });

    it('does NOT dispatch in idempotent path when status already upcoming', async () => {
      const upcomingRoutine = {
        ...DRAFT_ROUTINE,
        status: 'upcoming' as const,
        creationChannelId: null,
      };
      db.limit.mockResolvedValueOnce([upcomingRoutine] as any);
      const startSpy = jest
        .spyOn(service, 'start')
        .mockResolvedValue({ success: true } as any);

      await service.completeCreation(
        'routine-1',
        { autoRunFirst: true }, // Even with true, must not dispatch
        'user-1',
        'tenant-1',
      );

      expect(startSpy).not.toHaveBeenCalled();
      startSpy.mockRestore();
    });
  });

  // ── createWithCreationTask ────────────────────────────────────────

  describe('createWithCreationTask', () => {
    const SOURCE_BOT = {
      userId: 'bot-user-1',
      botId: 'bot-1',
      username: 'my-bot',
      displayName: 'My Bot',
      email: 'bot@team9.local',
      type: 'custom',
      ownerId: 'owner-1',
      mentorId: null,
      description: null,
      capabilities: null,
      extra: null,
      managedProvider: 'hive',
      managedMeta: { agentId: 'source-agent-id' },
      isActive: true,
    };

    const DRAFT_NEW_ROUTINE = {
      id: 'routine-new-1',
      tenantId: 'tenant-1',
      botId: 'bot-1',
      creatorId: 'user-1',
      title: 'Routine #1',
      description: null,
      status: 'draft',
      scheduleType: 'once',
      scheduleConfig: null,
      documentId: 'doc-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      currentExecutionId: null,
    };

    /**
     * Set up happy-path mocks for createWithCreationTask.
     *
     * Call sequence in the service:
     *   1. getBotById (wrapper pre-flight)
     *   2. db bot-tenant validation: where().limit()
     *   3. db count query: where() → resolves directly
     *   4. draft-conflict check: where().limit()  (before create — no orphan risk)
     *   5. create() → documentsService.create() + db.insert().values().returning()
     *   6. startCreationSession → getRoutineOrThrow: db.select().from().where().limit()
     *   7. startCreationSession → getBotById (inner re-validation)
     */
    function setupHappyPath(
      overrides: {
        botResult?: typeof SOURCE_BOT | null;
        botTenantRow?: { tenantId: string } | null;
        draftRoutine?: typeof DRAFT_NEW_ROUTINE;
      } = {},
    ) {
      const {
        botResult = SOURCE_BOT,
        botTenantRow = { tenantId: 'tenant-1' },
        draftRoutine = DRAFT_NEW_ROUTINE,
      } = overrides;

      // Outer createWithCreationTask wrapper:
      //   1. getBotById (bot lookup for pre-flight)
      botsService.getBotById.mockResolvedValueOnce(botResult as any);

      //   2. Bot-tenant validation: db.select().from().leftJoin().where().limit()
      db.where.mockReturnValueOnce(db as any);
      db.limit.mockResolvedValueOnce(
        botTenantRow ? [botTenantRow] : ([] as any),
      );

      //   3. Count query: db.select().from().where() — terminal Promise
      db.where.mockResolvedValueOnce([{ count: 0 }] as any);

      //   4. create() → documentsService.create() + db.insert().values().returning()
      documentsService.create.mockResolvedValueOnce({ id: 'doc-1' } as any);
      db.returning.mockResolvedValueOnce([draftRoutine] as any);

      // Inner startCreationSession:
      //   5. getRoutineOrThrow: db.select().from().where().limit() → draft
      db.limit.mockResolvedValueOnce([draftRoutine] as any);

      //   6. Bot-tenant re-validation inside startCreationSession
      db.where.mockReturnValueOnce(db as any);
      db.limit.mockResolvedValueOnce(
        botTenantRow ? [botTenantRow] : ([] as any),
      );

      //   7. getBotById (inner) for bot.userId
      botsService.getBotById.mockResolvedValueOnce(botResult as any);

      //   8. Atomic claim UPDATE with .returning() → 1-row array means won
      db.returning.mockResolvedValueOnce([
        { id: draftRoutine.id } as any,
      ] as any);
    }

    it('happy path: creates draft + channel + sends kickoff event to original bot session', async () => {
      setupHappyPath();

      channelsService.createRoutineSessionChannel.mockResolvedValueOnce({
        id: 'channel-42',
      } as any);

      const result = await service.createWithCreationTask(
        { agentId: 'bot-1' },
        'user-1',
        'tenant-1',
      );

      // Session ID uses original bot's agentId, not a clone ID
      expect(result).toEqual({
        routineId: 'routine-new-1',
        creationChannelId: 'channel-42',
        creationSessionId: `team9/tenant-1/source-agent-id/dm/channel-42`,
      });

      expect(channelsService.createRoutineSessionChannel).toHaveBeenCalledWith({
        creatorId: 'user-1',
        botUserId: 'bot-user-1',
        tenantId: 'tenant-1',
        routineId: 'routine-new-1',
        purpose: 'creation',
      });

      // No clone agent registration
      expect(clawHiveService.registerAgent).not.toHaveBeenCalled();

      // Kickoff event sent to the original bot's session
      expect(clawHiveService.sendInput).toHaveBeenCalledWith(
        `team9/tenant-1/source-agent-id/dm/channel-42`,
        expect.objectContaining({
          type: 'team9:routine-creation.start',
          source: 'team9',
          payload: expect.objectContaining({
            routineId: 'routine-new-1',
            creatorUserId: 'user-1',
            tenantId: 'tenant-1',
          }),
        }),
        'tenant-1',
      );
    });

    it('auto-generates title "Routine #N" based on existing routine count', async () => {
      setupHappyPath();

      channelsService.createRoutineSessionChannel.mockResolvedValueOnce({
        id: 'channel-42',
      } as any);

      await service.createWithCreationTask(
        { agentId: 'bot-1' },
        'user-1',
        'tenant-1',
      );

      // The create() call inserts a doc with title "Routine #1"
      expect(documentsService.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Routine #1' }),
        expect.any(Object),
        'tenant-1',
      );
    });

    it('throws 404 when bot does not exist', async () => {
      botsService.getBotById.mockResolvedValueOnce(null as any);

      await expect(
        service.createWithCreationTask(
          { agentId: 'missing-bot' },
          'user-1',
          'tenant-1',
        ),
      ).rejects.toThrow(NotFoundException);

      expect(db.insert).not.toHaveBeenCalled();
      expect(
        channelsService.createRoutineSessionChannel,
      ).not.toHaveBeenCalled();
    });

    it('throws 400 when bot belongs to a different tenant', async () => {
      botsService.getBotById.mockResolvedValueOnce(SOURCE_BOT as any);
      // Bot-tenant validation: tenant mismatch
      db.limit.mockResolvedValueOnce([{ tenantId: 'other-tenant' }] as any);

      await expect(
        service.createWithCreationTask(
          { agentId: 'bot-1' },
          'user-1',
          'tenant-1',
        ),
      ).rejects.toThrow(BadRequestException);

      expect(clawHiveService.sendInput).not.toHaveBeenCalled();
    });

    it('throws 400 when bot has no agentId in managedMeta', async () => {
      const botWithoutAgentId = { ...SOURCE_BOT, managedMeta: {} };
      botsService.getBotById.mockResolvedValueOnce(botWithoutAgentId as any);

      // Bot-tenant validation succeeds
      db.where.mockReturnValueOnce(db as any);
      db.limit.mockResolvedValueOnce([{ tenantId: 'tenant-1' }] as any);

      await expect(
        service.createWithCreationTask(
          { agentId: 'bot-1' },
          'user-1',
          'tenant-1',
        ),
      ).rejects.toThrow('Bot is not a managed hive agent');
    });

    // Regression guard: we deliberately allow multiple concurrent draft
    // creations per (user, bot). The previous implementation rejected the
    // second call with a 400 and "Complete or delete it first", which was
    // both semantically wrong (drafts are a first-class entity and a user
    // can plausibly be building several routines with the same assistant
    // at once) and a one-way trap: one stuck draft blocked ALL subsequent
    // creations against that bot with no in-UI recovery path. If this
    // test ever flips to expect a 400, someone reintroduced the bad
    // check — preserve the comment and the user-reported pathology.
    it('creates a new draft even when the user already has an in-progress draft for the same bot', async () => {
      setupHappyPath();
      channelsService.createRoutineSessionChannel.mockResolvedValueOnce({
        id: 'channel-concurrent',
      } as any);
      clawHiveService.sendInput.mockResolvedValueOnce(undefined as any);

      const result = await service.createWithCreationTask(
        { agentId: 'bot-1' },
        'user-1',
        'tenant-1',
      );

      expect(result.routineId).toBe(DRAFT_NEW_ROUTINE.id);
      expect(result.creationChannelId).toBe('channel-concurrent');
      // A second draft was actually created — not short-circuited by a
      // pre-flight "already exists" check.
      expect(documentsService.create).toHaveBeenCalledTimes(1);
      expect(channelsService.createRoutineSessionChannel).toHaveBeenCalledTimes(
        1,
      );
      expect(clawHiveService.sendInput).toHaveBeenCalledTimes(1);
    });

    it('rolls back draft if startCreationSession fails during channel creation', async () => {
      setupHappyPath();

      channelsService.createRoutineSessionChannel.mockRejectedValueOnce(
        new Error('channel creation failed') as any,
      );

      await expect(
        service.createWithCreationTask(
          { agentId: 'bot-1' },
          'user-1',
          'tenant-1',
        ),
      ).rejects.toThrow('channel creation failed');

      // No clone to delete (never registered)
      expect(clawHiveService.deleteAgent).not.toHaveBeenCalled();

      // Draft routine should be deleted by outer rollback
      expect(db.delete).toHaveBeenCalled();
    });

    it('rolls back draft if sendInput fails', async () => {
      setupHappyPath();

      channelsService.createRoutineSessionChannel.mockResolvedValueOnce({
        id: 'channel-42',
      } as any);
      clawHiveService.sendInput.mockRejectedValueOnce(
        new Error('send failed') as any,
      );

      await expect(
        service.createWithCreationTask(
          { agentId: 'bot-1' },
          'user-1',
          'tenant-1',
        ),
      ).rejects.toThrow('send failed');

      // No clone was ever created — deleteAgent must not be called
      expect(clawHiveService.deleteAgent).not.toHaveBeenCalled();

      // Inner rollback: startCreationSession deletes the channel
      expect(
        channelsService.hardDeleteRoutineSessionChannel,
      ).toHaveBeenCalledWith('channel-42', 'tenant-1');

      // Outer rollback: createWithCreationTask deletes the draft routine row
      expect(db.delete).toHaveBeenCalled();
    });

    it('logs error but still throws original error when rollback delete fails', async () => {
      setupHappyPath();

      channelsService.createRoutineSessionChannel.mockResolvedValueOnce({
        id: 'channel-42',
      } as any);

      const sendError = new Error('send failed');
      clawHiveService.sendInput.mockRejectedValueOnce(sendError as any);

      // Simulate outer rollback draft-delete also failing
      const deleteError = new Error('db unavailable');
      db.delete.mockReturnValueOnce({
        where: jest.fn<any>().mockRejectedValueOnce(deleteError),
      } as any);

      const loggerErrorSpy = jest.spyOn((service as any).logger, 'error');

      await expect(
        service.createWithCreationTask(
          { agentId: 'bot-1' },
          'user-1',
          'tenant-1',
        ),
      ).rejects.toThrow('send failed');

      // logger.error must have been called with rollback failure info
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('failed to delete draft routine'),
      );
    });
  });

  describe('startCreationSession', () => {
    const ROUTINE_ID = 'routine-1';
    const USER_ID = 'user-1';
    const TENANT_ID = 'tenant-1';
    const BOT_ID = 'bot-1';
    const BOT_USER_ID = 'bot-user-1';
    const AGENT_ID = 'agent-1';
    const CHANNEL_ID = 'channel-1';

    /**
     * Mock the sequence of DB calls that startCreationSession performs
     * when it needs to actually materialize a creation session.
     *
     * Flow:
     *   1. getRoutineOrThrow: db.select().from().where().limit()
     *   2. [fast-idempotent check: inline, no db call if short-circuit]
     *   3. Bot-tenant validation: db.select().from().leftJoin().where().limit()
     *   4. Atomic claim UPDATE: db.update().set().where().returning()
     *      (returning 1 row = won, 0 rows = lost race)
     */
    function mockGetRoutine(
      overrides: Record<string, unknown> = {},
      opts: {
        botTenantRow?: { tenantId: string } | null;
        claimResult?: { id: string }[];
      } = {},
    ) {
      const routine = {
        id: ROUTINE_ID,
        tenantId: TENANT_ID,
        creatorId: USER_ID,
        botId: BOT_ID,
        status: 'draft',
        title: 'Test Draft',
        creationChannelId: null,
        creationSessionId: null,
        ...overrides,
      };
      const {
        botTenantRow = { tenantId: TENANT_ID },
        claimResult = [{ id: ROUTINE_ID }],
      } = opts;

      // Step 1: getRoutineOrThrow — db.select().from().where().limit()
      // We prime one db.where.mockReturnValueOnce(db) so that .where() returns
      // the chain, allowing .limit() to resolve via the limit queue.
      db.where.mockReturnValueOnce(db as any);
      db.limit.mockResolvedValueOnce([routine]);

      // Step 3: bot-tenant validation — db.select().from().leftJoin().where().limit()
      // A second db.where.mockReturnValueOnce(db) keeps .where() chainable so
      // .limit() can resolve via the limit queue.
      db.where.mockReturnValueOnce(db as any);
      db.limit.mockResolvedValueOnce(
        botTenantRow ? [botTenantRow] : ([] as any),
      );

      // Step 5: inline trigger fetch — db.select().from().where() resolves directly.
      // No tenantId column on routineTriggers; scoped by routineId only.
      db.where.mockResolvedValueOnce([] as any);

      // Step 6: atomic claim UPDATE returning()
      db.returning.mockResolvedValueOnce(claimResult as any);

      return routine;
    }

    beforeEach(() => {
      botsService.getBotById.mockResolvedValue({
        id: BOT_ID,
        userId: BOT_USER_ID,
        managedMeta: { agentId: AGENT_ID },
      });
      channelsService.createRoutineSessionChannel.mockResolvedValue({
        id: CHANNEL_ID,
      });
      channelsService.hardDeleteRoutineSessionChannel.mockResolvedValue(
        undefined,
      );
      clawHiveService.sendInput.mockResolvedValue({ messages: [] });
    });

    it('creates channel, derives session id, persists, and sends kickoff event', async () => {
      mockGetRoutine();

      const result = await service.startCreationSession(
        ROUTINE_ID,
        USER_ID,
        TENANT_ID,
      );

      expect(channelsService.createRoutineSessionChannel).toHaveBeenCalledWith({
        creatorId: USER_ID,
        botUserId: BOT_USER_ID,
        tenantId: TENANT_ID,
        routineId: ROUTINE_ID,
        purpose: 'creation',
      });
      expect(result.creationChannelId).toBe(CHANNEL_ID);
      expect(result.creationSessionId).toBe(
        `team9/${TENANT_ID}/${AGENT_ID}/dm/${CHANNEL_ID}`,
      );
      expect(clawHiveService.createSession).toHaveBeenCalledTimes(1);
      expect(clawHiveService.sendInput).toHaveBeenCalledWith(
        result.creationSessionId,
        expect.objectContaining({
          type: 'team9:routine-creation.start',
          payload: expect.objectContaining({
            routineId: ROUTINE_ID,
            creatorUserId: USER_ID,
            tenantId: TENANT_ID,
          }),
        }),
        TENANT_ID,
      );
      // createSession must be called before sendInput
      const createSessionOrder = (clawHiveService.createSession as jest.Mock)
        .mock.invocationCallOrder[0];
      const sendInputOrder = (clawHiveService.sendInput as jest.Mock).mock
        .invocationCallOrder[0];
      expect(createSessionOrder).toBeLessThan(sendInputOrder);
    });

    it('is idempotent when creationChannelId already set AND channel is routine-session', async () => {
      // Step 1: getRoutineOrThrow returns a draft with both fields set
      db.limit.mockResolvedValueOnce([
        {
          id: ROUTINE_ID,
          tenantId: TENANT_ID,
          creatorId: USER_ID,
          botId: BOT_ID,
          status: 'draft',
          title: 'Test Draft',
          creationChannelId: 'existing-channel',
          creationSessionId: 'existing-session',
        },
      ]);

      // Step 2: channel type lookup returns 'routine-session' → trust the
      // persisted ids and short-circuit before bot-tenant query / claim.
      db.limit.mockResolvedValueOnce([{ type: 'routine-session' }]);

      const result = await service.startCreationSession(
        ROUTINE_ID,
        USER_ID,
        TENANT_ID,
      );

      expect(
        channelsService.createRoutineSessionChannel,
      ).not.toHaveBeenCalled();
      expect(clawHiveService.sendInput).not.toHaveBeenCalled();
      expect(result).toEqual({
        creationChannelId: 'existing-channel',
        creationSessionId: 'existing-session',
      });
    });

    it('clears legacy direct-channel ids and materializes a fresh routine-session', async () => {
      // Step 1: getRoutineOrThrow returns a draft pointing at a legacy
      // Phase 1 'direct' DM channel (stale back-reference)
      db.limit.mockResolvedValueOnce([
        {
          id: ROUTINE_ID,
          tenantId: TENANT_ID,
          creatorId: USER_ID,
          botId: BOT_ID,
          status: 'draft',
          title: 'Legacy draft',
          creationChannelId: 'legacy-direct-channel',
          creationSessionId: 'legacy-session',
        },
      ]);

      // Step 2: channel type lookup returns 'direct' → clear ids + fall through
      db.limit.mockResolvedValueOnce([{ type: 'direct' }]);

      // Step 3: after the null-clearing UPDATE, fall through to the
      // bot-tenant validation leftJoin query (returns draft-tenant match)
      db.where.mockReturnValueOnce(db as any);
      db.limit.mockResolvedValueOnce([{ tenantId: TENANT_ID }]);

      // Step 4: atomic claim UPDATE returning 1 row = won
      db.returning.mockResolvedValueOnce([{ id: ROUTINE_ID }]);

      const result = await service.startCreationSession(
        ROUTINE_ID,
        USER_ID,
        TENANT_ID,
      );

      // Materialized a fresh channel
      expect(channelsService.createRoutineSessionChannel).toHaveBeenCalledWith({
        creatorId: USER_ID,
        botUserId: BOT_USER_ID,
        tenantId: TENANT_ID,
        routineId: ROUTINE_ID,
        purpose: 'creation',
      });
      expect(result.creationChannelId).toBe(CHANNEL_ID);
      expect(result.creationSessionId).toBe(
        `team9/${TENANT_ID}/${AGENT_ID}/dm/${CHANNEL_ID}`,
      );
    });

    it('rejects non-draft routines with BadRequestException', async () => {
      // Only getRoutineOrThrow is consumed before the guard throws
      db.limit.mockResolvedValueOnce([
        {
          id: ROUTINE_ID,
          tenantId: TENANT_ID,
          creatorId: USER_ID,
          botId: BOT_ID,
          status: 'upcoming',
          title: 'x',
          creationChannelId: null,
          creationSessionId: null,
        },
      ]);

      await expect(
        service.startCreationSession(ROUTINE_ID, USER_ID, TENANT_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects non-creator with ForbiddenException', async () => {
      db.limit.mockResolvedValueOnce([
        {
          id: ROUTINE_ID,
          tenantId: TENANT_ID,
          creatorId: 'someone-else',
          botId: BOT_ID,
          status: 'draft',
          title: 'x',
          creationChannelId: null,
          creationSessionId: null,
        },
      ]);

      await expect(
        service.startCreationSession(ROUTINE_ID, USER_ID, TENANT_ID),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects drafts with null botId', async () => {
      db.limit.mockResolvedValueOnce([
        {
          id: ROUTINE_ID,
          tenantId: TENANT_ID,
          creatorId: USER_ID,
          botId: null,
          status: 'draft',
          title: 'x',
          creationChannelId: null,
          creationSessionId: null,
        },
      ]);

      await expect(
        service.startCreationSession(ROUTINE_ID, USER_ID, TENANT_ID),
      ).rejects.toThrow(BadRequestException);
      expect(botsService.getBotById).not.toHaveBeenCalled();
    });

    it('rejects when the bound bot belongs to a different tenant', async () => {
      // Routine loads successfully
      db.limit.mockResolvedValueOnce([
        {
          id: ROUTINE_ID,
          tenantId: TENANT_ID,
          creatorId: USER_ID,
          botId: BOT_ID,
          status: 'draft',
          title: 'x',
          creationChannelId: null,
          creationSessionId: null,
        },
      ]);
      // Bot-tenant validation returns wrong tenant
      db.where.mockReturnValueOnce(db as any);
      db.limit.mockResolvedValueOnce([{ tenantId: 'other-tenant' }] as any);

      await expect(
        service.startCreationSession(ROUTINE_ID, USER_ID, TENANT_ID),
      ).rejects.toThrow(BadRequestException);
      expect(
        channelsService.createRoutineSessionChannel,
      ).not.toHaveBeenCalled();
    });

    it('rejects bots without managedMeta.agentId', async () => {
      mockGetRoutine();
      botsService.getBotById.mockResolvedValue({
        id: BOT_ID,
        userId: BOT_USER_ID,
        managedMeta: null,
      });

      await expect(
        service.startCreationSession(ROUTINE_ID, USER_ID, TENANT_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('rolls back the channel AND clears routine fields when sendInput fails', async () => {
      mockGetRoutine();
      clawHiveService.sendInput.mockRejectedValue(new Error('hive down'));

      await expect(
        service.startCreationSession(ROUTINE_ID, USER_ID, TENANT_ID),
      ).rejects.toThrow('hive down');

      // Channel rolled back
      expect(
        channelsService.hardDeleteRoutineSessionChannel,
      ).toHaveBeenCalledWith(CHANNEL_ID, TENANT_ID);

      // Explicit cleanup UPDATE cleared both columns (fix #6)
      // The db.set call should include both fields set to null
      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({
          creationChannelId: null,
          creationSessionId: null,
        }),
      );

      // createSession had succeeded → Hive session must also be cleaned up
      expect(clawHiveService.deleteSession).toHaveBeenCalledWith(
        expect.stringContaining(CHANNEL_ID),
        TENANT_ID,
      );
    });

    it('loses the race and returns winner ids when atomic claim returns 0 rows', async () => {
      // mockGetRoutine with claimResult=[] means the conditional UPDATE
      // claimed nothing (a concurrent caller won)
      mockGetRoutine({}, { claimResult: [] });

      // After the race loss, the service re-reads the routine to get the
      // winner's ids. Enqueue that read.
      db.limit.mockResolvedValueOnce([
        {
          id: ROUTINE_ID,
          tenantId: TENANT_ID,
          creatorId: USER_ID,
          botId: BOT_ID,
          status: 'draft',
          title: 'Test Draft',
          creationChannelId: 'winner-channel',
          creationSessionId: 'winner-session',
        },
      ]);

      const result = await service.startCreationSession(
        ROUTINE_ID,
        USER_ID,
        TENANT_ID,
      );

      // Speculative channel was cleaned up
      expect(
        channelsService.hardDeleteRoutineSessionChannel,
      ).toHaveBeenCalledWith(CHANNEL_ID, TENANT_ID);
      // Kickoff was NOT sent (we're not the winner)
      expect(clawHiveService.sendInput).not.toHaveBeenCalled();
      // Returned the winner's ids
      expect(result).toEqual({
        creationChannelId: 'winner-channel',
        creationSessionId: 'winner-session',
      });
    });

    it('calls createSession with team9Context before sendInput', async () => {
      const SESSION_ID = `team9/${TENANT_ID}/${AGENT_ID}/dm/${CHANNEL_ID}`;
      mockGetRoutine();

      await service.startCreationSession(ROUTINE_ID, USER_ID, TENANT_ID);

      expect(clawHiveService.createSession).toHaveBeenCalledTimes(1);
      expect(clawHiveService.createSession).toHaveBeenCalledWith(
        AGENT_ID,
        expect.objectContaining({
          sessionId: SESSION_ID,
          userId: USER_ID,
          team9Context: expect.objectContaining({
            routineId: ROUTINE_ID,
            creatorUserId: USER_ID,
            creationChannelId: CHANNEL_ID,
            isCreationChannel: true,
          }),
        }),
        TENANT_ID,
      );
      // Must be called before sendInput
      const createSessionOrder = (clawHiveService.createSession as jest.Mock)
        .mock.invocationCallOrder[0];
      const sendInputOrder = (clawHiveService.sendInput as jest.Mock).mock
        .invocationCallOrder[0];
      expect(createSessionOrder).toBeLessThan(sendInputOrder);
    });

    it('kickoff payload includes the enriched draft fields when doc is present', async () => {
      const DOCUMENT_ID = 'doc-42';
      mockGetRoutine({
        description: 'My routine description',
        documentId: DOCUMENT_ID,
        botId: BOT_ID,
      });
      documentsService.getById.mockResolvedValueOnce({
        id: DOCUMENT_ID,
        tenantId: TENANT_ID,
        currentVersion: { versionIndex: 1, content: 'draft doc content' },
      });

      await service.startCreationSession(ROUTINE_ID, USER_ID, TENANT_ID);

      const sendInputCall = (clawHiveService.sendInput as jest.Mock).mock
        .calls[0] as [string, { payload: Record<string, unknown> }, string];
      const payload = sendInputCall[1].payload;
      expect(payload.routineId).toBe(ROUTINE_ID);
      expect(payload.creatorUserId).toBe(USER_ID);
      expect(payload.tenantId).toBe(TENANT_ID);
      expect(payload.creationChannelId).toBe(CHANNEL_ID);
      expect(payload.title).toBe('Test Draft');
      expect(payload.description).toBe('My routine description');
      expect(payload.documentContent).toBe('draft doc content');
      expect(payload.botId).toBe(BOT_ID);
      expect(payload.triggers).toEqual([]);
    });

    it('payload uses null for missing optional fields when draft has none', async () => {
      // Default mockGetRoutine has no description and no documentId
      mockGetRoutine({ description: null, documentId: null });

      await service.startCreationSession(ROUTINE_ID, USER_ID, TENANT_ID);

      const sendInputCall = (clawHiveService.sendInput as jest.Mock).mock
        .calls[0] as [string, { payload: Record<string, unknown> }, string];
      const payload = sendInputCall[1].payload;
      expect(payload.description).toBeNull();
      expect(payload.documentContent).toBeNull();
      expect(payload.triggers).toEqual([]);
    });

    it('runs rollback when createSession rejects', async () => {
      mockGetRoutine();
      clawHiveService.createSession.mockRejectedValueOnce(
        new Error('hive createSession boom'),
      );

      await expect(
        service.startCreationSession(ROUTINE_ID, USER_ID, TENANT_ID),
      ).rejects.toThrow('hive createSession boom');

      // Channel hard-deleted (rollback)
      expect(
        channelsService.hardDeleteRoutineSessionChannel,
      ).toHaveBeenCalledWith(CHANNEL_ID, TENANT_ID);

      // Routine creation columns cleared (claimed = true before createSession throws)
      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({
          creationChannelId: null,
          creationSessionId: null,
        }),
      );

      // sendInput was never reached
      expect(clawHiveService.sendInput).not.toHaveBeenCalled();

      // createSession itself rejected → sessionCreated is still false → NO deleteSession call
      expect(clawHiveService.deleteSession).not.toHaveBeenCalled();
    });

    it('rolls back the Hive session when sendInput fails after createSession succeeded', async () => {
      mockGetRoutine();
      clawHiveService.sendInput.mockRejectedValueOnce(
        new Error('sendInput exploded'),
      );

      await expect(
        service.startCreationSession(ROUTINE_ID, USER_ID, TENANT_ID),
      ).rejects.toThrow('sendInput exploded');

      // createSession succeeded, so deleteSession must be called for cleanup
      expect(clawHiveService.deleteSession).toHaveBeenCalledWith(
        expect.stringContaining(CHANNEL_ID),
        TENANT_ID,
      );

      // Channel hard-deleted and DB columns cleared (claimed = true)
      expect(
        channelsService.hardDeleteRoutineSessionChannel,
      ).toHaveBeenCalledWith(CHANNEL_ID, TENANT_ID);
      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({
          creationChannelId: null,
          creationSessionId: null,
        }),
      );
    });

    it('logs error but does not throw when deleteSession rollback fails (non-404)', async () => {
      mockGetRoutine();
      clawHiveService.sendInput.mockRejectedValueOnce(
        new Error('sendInput failed'),
      );
      clawHiveService.deleteSession.mockRejectedValueOnce(
        new Error('500 internal server error'),
      );
      const loggerError = jest
        .spyOn((service as any).logger, 'error')
        .mockImplementation(() => undefined);

      // Original error must propagate; deleteSession failure must not re-throw
      await expect(
        service.startCreationSession(ROUTINE_ID, USER_ID, TENANT_ID),
      ).rejects.toThrow('sendInput failed');

      expect(loggerError).toHaveBeenCalledWith(
        expect.stringContaining('failed to roll back Hive session'),
      );
    });

    it('logs warn and uses null documentContent when documentsService.getById throws', async () => {
      const DOCUMENT_ID = 'doc-fail';
      mockGetRoutine({ documentId: DOCUMENT_ID });
      documentsService.getById.mockRejectedValueOnce(
        new Error('doc fetch boom'),
      );
      const loggerWarn = jest
        .spyOn((service as any).logger, 'warn')
        .mockImplementation(() => undefined);

      // Should resolve successfully despite getById failure
      await service.startCreationSession(ROUTINE_ID, USER_ID, TENANT_ID);

      expect(loggerWarn).toHaveBeenCalledWith(
        expect.stringContaining('failed to fetch draft documentContent'),
      );

      // documentContent in the payload should be null
      const payload = (
        (clawHiveService.sendInput as jest.Mock).mock.calls[0] as [
          string,
          { payload: Record<string, unknown> },
          string,
        ]
      )[1].payload;
      expect(payload.documentContent).toBeNull();

      loggerWarn.mockRestore();
    });

    it('kickoff payload includes draft triggers from inline DB select', async () => {
      const expectedTriggers = [
        {
          id: 't-1',
          type: 'manual',
          config: {},
          enabled: true,
          routineId: ROUTINE_ID,
        },
      ];
      // Three db.where() calls in startCreationSession before atomic claim:
      //   #1 getRoutineOrThrow, #2 bot-tenant, #3 trigger fetch
      const DRAFT = {
        id: ROUTINE_ID,
        tenantId: TENANT_ID,
        creatorId: USER_ID,
        botId: BOT_ID,
        status: 'draft',
        title: 'Test Draft',
        creationChannelId: null,
        creationSessionId: null,
      };

      // #1 getRoutineOrThrow
      db.where.mockReturnValueOnce(db as any);
      db.limit.mockResolvedValueOnce([DRAFT]);
      // #2 bot-tenant leftJoin
      db.where.mockReturnValueOnce(db as any);
      db.limit.mockResolvedValueOnce([{ tenantId: TENANT_ID }] as any);
      // #3 inline trigger fetch — returns our expected triggers
      db.where.mockResolvedValueOnce(expectedTriggers as any);
      // atomic claim
      db.returning.mockResolvedValueOnce([{ id: ROUTINE_ID }] as any);

      await service.startCreationSession(ROUTINE_ID, USER_ID, TENANT_ID);

      const payload = (
        (clawHiveService.sendInput as jest.Mock).mock.calls[0] as [
          string,
          { payload: Record<string, unknown> },
          string,
        ]
      )[1].payload;
      expect(payload.triggers).toEqual(expectedTriggers);
    });

    it('kickoff payload triggers defaults to [] when inline trigger select throws', async () => {
      const DRAFT = {
        id: ROUTINE_ID,
        tenantId: TENANT_ID,
        creatorId: USER_ID,
        botId: BOT_ID,
        status: 'draft',
        title: 'Test Draft',
        creationChannelId: null,
        creationSessionId: null,
      };

      // #1 getRoutineOrThrow
      db.where.mockReturnValueOnce(db as any);
      db.limit.mockResolvedValueOnce([DRAFT]);
      // #2 bot-tenant leftJoin
      db.where.mockReturnValueOnce(db as any);
      db.limit.mockResolvedValueOnce([{ tenantId: TENANT_ID }] as any);
      // #3 inline trigger fetch — throws synchronously so the surrounding
      // try/catch in the service handles it gracefully
      db.where.mockImplementationOnce(() => {
        throw new Error('triggers fetch boom');
      });
      // atomic claim
      db.returning.mockResolvedValueOnce([{ id: ROUTINE_ID }] as any);

      const loggerWarn = jest
        .spyOn((service as any).logger, 'warn')
        .mockImplementation(() => undefined);

      await service.startCreationSession(ROUTINE_ID, USER_ID, TENANT_ID);

      const payload = (
        (clawHiveService.sendInput as jest.Mock).mock.calls[0] as [
          string,
          { payload: Record<string, unknown> },
          string,
        ]
      )[1].payload;
      expect(payload.triggers).toEqual([]);
      expect(loggerWarn).toHaveBeenCalledWith(
        expect.stringContaining('failed to fetch draft triggers'),
      );

      loggerWarn.mockRestore();
    });

    // ── documentContent enrichment tests ──────────────────────────────

    it('startCreationSession: kickoff payload includes documentContent from doc.currentVersion.content', async () => {
      const DOCUMENT_ID = 'doc-1';
      mockGetRoutine({ documentId: DOCUMENT_ID });
      documentsService.getById.mockResolvedValueOnce({
        id: DOCUMENT_ID,
        tenantId: TENANT_ID,
        currentVersion: { versionIndex: 1, content: 'doc body' },
      } as any);

      await service.startCreationSession(ROUTINE_ID, USER_ID, TENANT_ID);

      const payload = (clawHiveService.sendInput as jest.Mock).mock
        .calls[0] as [string, { payload: Record<string, unknown> }, string];
      expect(payload[1].payload.documentContent).toBe('doc body');
    });

    it('startCreationSession: documentContent stays null when doc tenantId mismatches', async () => {
      const DOCUMENT_ID = 'doc-1';
      mockGetRoutine({ documentId: DOCUMENT_ID });
      documentsService.getById.mockResolvedValueOnce({
        id: DOCUMENT_ID,
        tenantId: 'other-tenant',
        currentVersion: { versionIndex: 1, content: 'leaked' },
      } as any);
      const loggerWarn = jest.spyOn((service as any).logger, 'warn');

      await service.startCreationSession(ROUTINE_ID, USER_ID, TENANT_ID);

      const payload = (clawHiveService.sendInput as jest.Mock).mock
        .calls[0] as [string, { payload: Record<string, unknown> }, string];
      expect(payload[1].payload.documentContent).toBeNull();
      expect(loggerWarn).toHaveBeenCalledWith(
        expect.stringContaining('tenant mismatch'),
      );
      loggerWarn.mockRestore();
    });

    it('startCreationSession: documentContent stays null when currentVersion is null', async () => {
      const DOCUMENT_ID = 'doc-1';
      mockGetRoutine({ documentId: DOCUMENT_ID });
      documentsService.getById.mockResolvedValueOnce({
        id: DOCUMENT_ID,
        tenantId: TENANT_ID,
        currentVersion: null,
      } as any);

      await service.startCreationSession(ROUTINE_ID, USER_ID, TENANT_ID);

      const payload = (clawHiveService.sendInput as jest.Mock).mock
        .calls[0] as [string, { payload: Record<string, unknown> }, string];
      expect(payload[1].payload.documentContent).toBeNull();
    });

    describe('creator language propagation', () => {
      it("includes creator's language + timeZone in team9Context when both are set", async () => {
        mockGetRoutine();
        usersService.getLocalePreferences.mockResolvedValue({
          language: 'zh-CN',
          timeZone: 'Asia/Shanghai',
        });

        await service.startCreationSession(ROUTINE_ID, USER_ID, TENANT_ID);

        const createSessionCall = (clawHiveService.createSession as jest.Mock)
          .mock.calls[0];
        const sessionArgs = createSessionCall[1] as {
          team9Context: Record<string, unknown>;
        };
        expect(sessionArgs.team9Context).toMatchObject({
          language: 'zh-CN',
          timeZone: 'Asia/Shanghai',
        });
        expect(usersService.getLocalePreferences).toHaveBeenCalledWith(USER_ID);
      });

      it('omits language when only timeZone is set', async () => {
        mockGetRoutine();
        usersService.getLocalePreferences.mockResolvedValue({
          language: null,
          timeZone: 'Asia/Shanghai',
        });

        await service.startCreationSession(ROUTINE_ID, USER_ID, TENANT_ID);

        const sessionArgs = (clawHiveService.createSession as jest.Mock).mock
          .calls[0][1] as {
          team9Context: Record<string, unknown>;
        };
        expect(sessionArgs.team9Context).not.toHaveProperty('language');
        expect(sessionArgs.team9Context).toMatchObject({
          timeZone: 'Asia/Shanghai',
        });
      });

      it('omits timeZone when only language is set', async () => {
        mockGetRoutine();
        usersService.getLocalePreferences.mockResolvedValue({
          language: 'zh-CN',
          timeZone: null,
        });

        await service.startCreationSession(ROUTINE_ID, USER_ID, TENANT_ID);

        const sessionArgs = (clawHiveService.createSession as jest.Mock).mock
          .calls[0][1] as {
          team9Context: Record<string, unknown>;
        };
        expect(sessionArgs.team9Context).toMatchObject({ language: 'zh-CN' });
        expect(sessionArgs.team9Context).not.toHaveProperty('timeZone');
      });

      it('omits both language and timeZone when creator has neither set', async () => {
        mockGetRoutine();
        usersService.getLocalePreferences.mockResolvedValue({
          language: null,
          timeZone: null,
        });

        await service.startCreationSession(ROUTINE_ID, USER_ID, TENANT_ID);

        const sessionArgs = (clawHiveService.createSession as jest.Mock).mock
          .calls[0][1] as {
          team9Context: Record<string, unknown>;
        };
        expect(sessionArgs.team9Context).not.toHaveProperty('language');
        expect(sessionArgs.team9Context).not.toHaveProperty('timeZone');
        // Existing fields remain intact.
        expect(sessionArgs.team9Context).toMatchObject({
          routineId: expect.any(String),
          creatorUserId: expect.any(String),
          creationChannelId: expect.any(String),
          isCreationChannel: true,
        });
      });

      it('rolls back claim + channel when getLocalePreferences rejects', async () => {
        mockGetRoutine();
        // Claim succeeds, but the locale read throws (transient DB issue).
        usersService.getLocalePreferences.mockRejectedValue(
          new Error('db down'),
        );

        await expect(
          service.startCreationSession(ROUTINE_ID, USER_ID, TENANT_ID),
        ).rejects.toThrow('db down');

        // Speculative channel must be hard-deleted.
        expect(
          channelsService.hardDeleteRoutineSessionChannel,
        ).toHaveBeenCalledWith(CHANNEL_ID, TENANT_ID);

        // Routine creation columns cleared (claimed = true before getLocalePreferences throws)
        expect(db.set).toHaveBeenCalledWith(
          expect.objectContaining({
            creationChannelId: null,
            creationSessionId: null,
          }),
        );

        // Kickoff MUST NOT have happened — the locale read runs after the
        // claim but before createSession/sendInput.
        expect(clawHiveService.createSession).not.toHaveBeenCalled();
        expect(clawHiveService.sendInput).not.toHaveBeenCalled();
      });
    });
  });
});

// ── completeCreation race-condition tests (I2) ────────────────────────
// These are separate describe blocks to keep the main completeCreation
// fixtures clean, while testing the conditional UPDATE race gate.

describe('RoutinesService — completeCreation race guard', () => {
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

  const DRAFT_ROUTINE = {
    id: 'routine-1',
    tenantId: 'tenant-1',
    status: 'draft' as const,
    creatorId: 'user-1',
    botId: 'bot-1',
    title: 'My Routine',
    documentId: 'doc-1',
    creationChannelId: 'channel-1',
    scheduleType: 'once',
    scheduleConfig: null,
    description: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    currentExecutionId: null,
  };

  let service: RoutinesService;
  let db: ReturnType<typeof mockDb>;
  let botsService: { getBotById: MockFn };
  let documentsService: { create: MockFn; update: MockFn; getById: MockFn };
  let routineTriggersService: {
    createBatch: MockFn;
    replaceAllForRoutine: MockFn;
    listByRoutine: MockFn;
  };
  let channelsService: {
    archiveCreationChannel: MockFn;
    createRoutineSessionChannel: MockFn;
    hardDeleteRoutineSessionChannel: MockFn;
  };
  let clawHiveService: {
    deleteAgent: MockFn;
    registerAgent: MockFn;
    sendInput: MockFn;
    createSession: MockFn;
    deleteSession: MockFn;
  };
  let amqpConnection: { publish: MockFn };
  let taskCastService: { transitionStatus: MockFn; publishEvent: MockFn };
  let wsGateway: { broadcastToWorkspace: MockFn };
  let usersService: { getLocalePreferences: MockFn };

  beforeEach(async () => {
    db = mockDb();
    amqpConnection = { publish: jest.fn<any>().mockResolvedValue(undefined) };
    wsGateway = {
      broadcastToWorkspace: jest.fn<any>().mockResolvedValue(undefined),
    };
    documentsService = {
      create: jest.fn<any>().mockResolvedValue({ id: 'doc-1' }),
      update: jest.fn<any>().mockResolvedValue(undefined),
      getById: jest.fn<any>().mockResolvedValue({
        id: 'doc-1',
        tenantId: 'tenant-1',
        currentVersion: { versionIndex: 1, content: 'some content' },
      }),
    };
    routineTriggersService = {
      createBatch: jest.fn<any>().mockResolvedValue(undefined),
      replaceAllForRoutine: jest.fn<any>().mockResolvedValue(undefined),
      listByRoutine: jest.fn<any>().mockResolvedValue([]),
    };
    taskCastService = {
      transitionStatus: jest.fn<any>().mockResolvedValue(undefined),
      publishEvent: jest.fn<any>().mockResolvedValue(undefined),
    };
    channelsService = {
      archiveCreationChannel: jest.fn<any>().mockResolvedValue(undefined),
      createRoutineSessionChannel: jest
        .fn<any>()
        .mockResolvedValue({ id: 'channel-1' }),
      hardDeleteRoutineSessionChannel: jest
        .fn<any>()
        .mockResolvedValue(undefined),
    };
    clawHiveService = {
      deleteAgent: jest.fn<any>().mockResolvedValue(undefined),
      registerAgent: jest.fn<any>().mockResolvedValue(undefined),
      sendInput: jest.fn<any>().mockResolvedValue({ messages: [] }),
      createSession: jest
        .fn<any>()
        .mockResolvedValue({ sessionId: 'pre-created-session' }),
      deleteSession: jest.fn<any>().mockResolvedValue(undefined),
    };
    botsService = {
      getBotById: jest
        .fn<any>()
        .mockResolvedValue({ botId: 'bot-1', userId: 'user-1' }),
    };
    usersService = {
      getLocalePreferences: jest
        .fn<any>()
        .mockResolvedValue({ language: null, timeZone: null }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoutinesService,
        { provide: DATABASE_CONNECTION, useValue: db },
        { provide: AmqpConnection, useValue: amqpConnection },
        { provide: DocumentsService, useValue: documentsService },
        { provide: RoutineTriggersService, useValue: routineTriggersService },
        { provide: TaskCastService, useValue: taskCastService },
        { provide: ChannelsService, useValue: channelsService },
        { provide: ClawHiveService, useValue: clawHiveService },
        { provide: BotService, useValue: botsService },
        { provide: WEBSOCKET_GATEWAY, useValue: wsGateway },
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();

    service = module.get<RoutinesService>(RoutinesService);
  });

  it('race-loss: returns winner state without dispatching autoRunFirst', async () => {
    // Initial read: sees status='draft'
    db.limit.mockResolvedValueOnce([DRAFT_ROUTINE] as any);
    // Bot validation
    botsService.getBotById.mockResolvedValueOnce({
      botId: 'bot-1',
      userId: 'user-1',
    } as any);
    // Doc content check
    documentsService.getById.mockResolvedValueOnce({
      id: 'doc-1',
      tenantId: 'tenant-1',
      currentVersion: { versionIndex: 1, content: 'some content' },
    } as any);
    // Conditional UPDATE returns empty (lost the race)
    db.returning.mockResolvedValueOnce([] as any);
    // Re-fetch via getRoutineOrThrow returns the winner's upcoming state
    db.limit.mockResolvedValueOnce([
      { ...DRAFT_ROUTINE, status: 'upcoming' },
    ] as any);

    const startSpy = jest
      .spyOn(service, 'start')
      .mockResolvedValue({ success: true } as any);

    const result = await service.completeCreation(
      'routine-1',
      { autoRunFirst: true }, // even with true, race-loser must NOT dispatch
      'user-1',
      'tenant-1',
    );

    expect(result.status).toBe('upcoming');
    expect(startSpy).not.toHaveBeenCalled();
    // Archive was still attempted on race-loss path (winner's channel)
    expect(channelsService.archiveCreationChannel).toHaveBeenCalledWith(
      'channel-1',
      'tenant-1',
    );

    startSpy.mockRestore();
  });

  it('race-loss: archives channel best-effort even when archiveCreationChannel throws', async () => {
    db.limit.mockResolvedValueOnce([DRAFT_ROUTINE] as any);
    botsService.getBotById.mockResolvedValueOnce({
      botId: 'bot-1',
      userId: 'user-1',
    } as any);
    documentsService.getById.mockResolvedValueOnce({
      id: 'doc-1',
      tenantId: 'tenant-1',
      currentVersion: { versionIndex: 1, content: 'some content' },
    } as any);
    db.returning.mockResolvedValueOnce([] as any);
    db.limit.mockResolvedValueOnce([
      { ...DRAFT_ROUTINE, status: 'upcoming' },
    ] as any);

    channelsService.archiveCreationChannel.mockRejectedValueOnce(
      new Error('archive boom'),
    );
    const loggerWarn = jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => undefined);

    // Should NOT throw even if archive fails
    const result = await service.completeCreation(
      'routine-1',
      {},
      'user-1',
      'tenant-1',
    );

    expect(result.status).toBe('upcoming');
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('race-loss'),
    );

    loggerWarn.mockRestore();
  });

  it('winner: still dispatches autoRunFirst when conditional UPDATE returns a row', async () => {
    const UPDATED = { ...DRAFT_ROUTINE, status: 'upcoming' as const };

    db.limit.mockResolvedValueOnce([DRAFT_ROUTINE] as any);
    botsService.getBotById.mockResolvedValueOnce({
      botId: 'bot-1',
      userId: 'user-1',
    } as any);
    documentsService.getById.mockResolvedValueOnce({
      id: 'doc-1',
      tenantId: 'tenant-1',
      currentVersion: { versionIndex: 1, content: 'some content' },
    } as any);
    // Conditional UPDATE returns a row (we are the winner)
    db.returning.mockResolvedValueOnce([UPDATED] as any);

    const startSpy = jest
      .spyOn(service, 'start')
      .mockResolvedValue({ success: true } as any);

    await service.completeCreation(
      'routine-1',
      { autoRunFirst: true },
      'user-1',
      'tenant-1',
    );

    expect(startSpy).toHaveBeenCalledTimes(1);

    startSpy.mockRestore();
  });
});
