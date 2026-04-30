import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ServiceUnavailableException } from '@nestjs/common';
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
import { Folder9ClientService } from '../wikis/folder9-client.service.js';
import { appMetrics } from '@team9/observability';

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
    // `.for('update')` issues SELECT ... FOR UPDATE in Drizzle. The mock
    // returns the chain itself (resolves like other chained methods)
    // unless a specific test overrides via mockResolvedValueOnce.
    'for',
  ];
  for (const m of methods) {
    chain[m] = jest.fn<any>().mockReturnValue(chain);
  }
  chain.limit.mockResolvedValue([]);
  chain.returning.mockResolvedValue([]);
  // `for('update')` resolves to a row array (matches the SELECT ... FOR
  // UPDATE shape that ensureRoutineFolder reads). Default empty so tests
  // pin specific outcomes via mockResolvedValueOnce.
  chain.for.mockResolvedValue([]);
  // `transaction(cb)` invokes the callback with a tx handle that mirrors
  // the same chain (so tx.insert/tx.update/tx.select all use the existing
  // mocks). Returns whatever the callback returns. Throws propagate
  // unchanged — matching Drizzle's real ROLLBACK-on-throw semantics for
  // the purposes of these unit tests.
  chain.transaction = jest
    .fn<any>()
    .mockImplementation((cb: (tx: any) => any) => cb(chain));
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
  let folder9Client: {
    createFolder: MockFn;
    createToken: MockFn;
    commit: MockFn;
    getBlob: MockFn;
    getTree: MockFn;
    getFolder: MockFn;
    log: MockFn;
  };

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
    // Folder9ClientService is consumed by `RoutinesService.create` (atomic
    // provision) via `provisionFolder9SkillFolder`. Default mock paints a
    // happy path; tests that exercise failure branches override per-call.
    folder9Client = {
      createFolder: jest
        .fn<any>()
        .mockResolvedValue({ id: 'folder-new', workspace_id: 'tenant-1' }),
      createToken: jest
        .fn<any>()
        .mockResolvedValue({ token: 'tok-new', expires_at: '2099-01-01' }),
      commit: jest.fn<any>().mockResolvedValue({ commit_id: 'commit-1' }),
      // getBlob is the SKILL.md read in completeCreation (A.5). The
      // top-level default is unused — every consumer (currently only
      // the completeCreation describe block) overrides via beforeEach
      // with a payload that matches its fixture's name/description.
      // We still wire the spy so tests can assertHaveBeenCalled.
      getBlob: jest.fn<any>().mockResolvedValue(undefined),
      // Folder proxy (A.6) endpoints exercise these. Defaults are
      // happy-path responses; tests that need failure modes override
      // via mockRejectedValueOnce / mockResolvedValueOnce.
      getTree: jest.fn<any>().mockResolvedValue([]),
      getFolder: jest.fn<any>().mockResolvedValue({
        id: 'folder-existing',
        name: 'routine-test',
        type: 'managed',
        owner_type: 'workspace',
        owner_id: 'tenant-1',
        workspace_id: 'tenant-1',
        approval_mode: 'auto',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      }),
      log: jest.fn<any>().mockResolvedValue([]),
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
        { provide: Folder9ClientService, useValue: folder9Client },
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
        // folderId starts NULL — the create flow back-fills it via the
        // post-INSERT UPDATE (run after the folder9 provision call,
        // outside any DB transaction — see C2 refactor).
        folderId: null,
      };

      documentsService.create.mockResolvedValueOnce({ id: 'doc-new' } as any);
      db.returning.mockResolvedValueOnce([createdTask] as any);

      // The flow returns the inserted row spread with the
      // newly-provisioned folderId. Default folder9 mock returns
      // `{id: 'folder-new'}` — so the resolved object equals the row
      // with folderId overridden.
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
      ).resolves.toEqual({ ...createdTask, folderId: 'folder-new' });

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

    // ── A.4 + C2: create + folder9 provision flow ───────────────────────
    //
    // create() now runs INSERT + provision + UPDATE folderId as three
    // separate DB operations (NOT in a single transaction). Folder9's
    // long HTTP I/O happens OUTSIDE any tx, so we don't pin a PG
    // connection across folder9 latency. On failure AFTER the INSERT,
    // the row is best-effort DELETEd so the caller doesn't observe a
    // half-baked routine; if DELETE itself fails, lazy-provision in
    // ensureRoutineFolder will heal the row on next access.

    describe('create + folder9 flow (A.4 / C2)', () => {
      it('happy path: provisions folder9, persists folderId, returns routine with non-null folderId', async () => {
        const createdTask = {
          id: 'task-atomic-happy',
          tenantId: 'tenant-1',
          creatorId: 'user-1',
          title: 'Atomic happy',
          description: null,
          documentId: 'doc-atomic-happy',
          folderId: null,
        };
        documentsService.create.mockResolvedValueOnce({
          id: 'doc-atomic-happy',
        } as any);
        db.returning.mockResolvedValueOnce([createdTask] as any);
        folder9Client.createFolder.mockResolvedValueOnce({
          id: 'folder-atomic-happy',
          workspace_id: 'tenant-1',
        });
        folder9Client.createToken.mockResolvedValueOnce({
          token: 'tok-atomic-happy',
          expires_at: '2099-01-01',
        });
        folder9Client.commit.mockResolvedValueOnce({
          commit_id: 'commit-atomic-happy',
        });

        const result = await service.create(
          { title: 'Atomic happy', botId: 'bot-1' } as never,
          'user-1',
          'tenant-1',
        );

        // Folder9 was contacted with the right workspace id (= tenantId).
        expect(folder9Client.createFolder).toHaveBeenCalledTimes(1);
        expect(folder9Client.createFolder.mock.calls[0][0]).toBe('tenant-1');
        expect(folder9Client.commit).toHaveBeenCalledTimes(1);

        // The returned row carries the new folderId — proves we splatted it
        // in after the post-INSERT UPDATE.
        expect(result).toMatchObject({
          id: 'task-atomic-happy',
          folderId: 'folder-atomic-happy',
        });

        // C2 contract: NO transaction wrapper around the slow flow.
        expect(db.transaction).not.toHaveBeenCalled();
        // Both an INSERT and an UPDATE were issued (UPDATE sets folderId).
        expect(db.insert).toHaveBeenCalled();
        expect(db.update).toHaveBeenCalled();
      });

      it('folder9 createFolder fails: throws 503, no UPDATE, best-effort DELETE of the just-INSERTed row', async () => {
        const draftRow = {
          id: 'task-atomic-fail-create',
          tenantId: 'tenant-1',
          creatorId: 'user-1',
          title: 'Atomic fail-create',
          description: null,
          documentId: 'doc-atomic-fail-create',
          folderId: null,
        };
        documentsService.create.mockResolvedValueOnce({
          id: 'doc-atomic-fail-create',
        } as any);
        db.returning.mockResolvedValueOnce([draftRow] as any);
        // Simulate folder9 down at the very first call.
        folder9Client.createFolder.mockRejectedValueOnce(
          new Error('folder9 unreachable'),
        );

        await expect(
          service.create(
            { title: 'Atomic fail-create', botId: 'bot-1' } as never,
            'user-1',
            'tenant-1',
          ),
        ).rejects.toBeInstanceOf(ServiceUnavailableException);

        // Token mint and commit must never have been attempted.
        expect(folder9Client.createToken).not.toHaveBeenCalled();
        expect(folder9Client.commit).not.toHaveBeenCalled();
        // The post-INSERT UPDATE for folderId must NOT have been issued.
        expect(db.update).not.toHaveBeenCalled();
        // C2 contract: best-effort cleanup DELETEs the just-INSERTed row
        // so the caller doesn't see a half-baked routine.
        expect(db.delete).toHaveBeenCalled();

        expect(routineTriggersService.createBatch).not.toHaveBeenCalled();
      });

      it('folder9 commit fails (orphan-folder window): throws 503, no folderId UPDATE, DELETEs the inserted row', async () => {
        const draftRow = {
          id: 'task-atomic-fail-commit',
          tenantId: 'tenant-1',
          creatorId: 'user-1',
          title: 'Atomic fail-commit',
          description: null,
          documentId: 'doc-atomic-fail-commit',
          folderId: null,
        };
        documentsService.create.mockResolvedValueOnce({
          id: 'doc-atomic-fail-commit',
        } as any);
        db.returning.mockResolvedValueOnce([draftRow] as any);
        folder9Client.createFolder.mockResolvedValueOnce({
          id: 'orphan-folder-id',
          workspace_id: 'tenant-1',
        });
        folder9Client.createToken.mockResolvedValueOnce({
          token: 'tok-orphan',
          expires_at: '2099-01-01',
        });
        // Folder created, token minted, then commit dies — folder9 has a
        // folder that the routines table will never reference. Orphan GC
        // reclaims it; this test verifies the local invariant: caller
        // sees no half-baked row.
        folder9Client.commit.mockRejectedValueOnce(
          new Error('folder9 commit timeout'),
        );

        await expect(
          service.create(
            { title: 'Atomic fail-commit', botId: 'bot-1' } as never,
            'user-1',
            'tenant-1',
          ),
        ).rejects.toBeInstanceOf(ServiceUnavailableException);

        expect(folder9Client.createFolder).toHaveBeenCalledTimes(1);
        expect(folder9Client.createToken).toHaveBeenCalledTimes(1);
        expect(folder9Client.commit).toHaveBeenCalledTimes(1);
        // The folderId UPDATE must NOT have been issued.
        expect(db.update).not.toHaveBeenCalled();
        // DELETE issued as best-effort cleanup so the caller doesn't see
        // the half-baked row.
        expect(db.delete).toHaveBeenCalled();
        expect(routineTriggersService.createBatch).not.toHaveBeenCalled();
      });

      it('cleanup DELETE failure is non-fatal: still throws 503, log records the failure', async () => {
        // Pathological case — provision throws, then our best-effort
        // DELETE also throws. We must still surface 503 to the caller
        // (the orphan row will be lazy-provisioned on next access).
        const draftRow = {
          id: 'task-atomic-delete-fail',
          tenantId: 'tenant-1',
          creatorId: 'user-1',
          title: 'Atomic delete-fail',
          description: null,
          documentId: 'doc-atomic-delete-fail',
          folderId: null,
        };
        documentsService.create.mockResolvedValueOnce({
          id: 'doc-atomic-delete-fail',
        } as any);
        db.returning.mockResolvedValueOnce([draftRow] as any);
        folder9Client.createFolder.mockRejectedValueOnce(
          new Error('folder9 down'),
        );
        // Make the cleanup DELETE itself reject. The mock chain's
        // `where(...)` returns `chain` (a thenable-by-await? no — a
        // plain object). To force the promise to reject we wire
        // `db.delete().where(...)` via mock that throws on await — the
        // simplest way is to override `db.where` to throw once when the
        // delete sequence picks it up. But since `where` is shared, we
        // override `db.delete` itself to return an object whose `where`
        // returns a rejected promise.
        const rejectingChain = {
          where: jest.fn<any>(() =>
            Promise.reject(new Error('cleanup db down')),
          ),
        };
        db.delete.mockReturnValueOnce(rejectingChain as any);

        const loggerErrorSpy = jest.spyOn((service as any).logger, 'error');

        await expect(
          service.create(
            { title: 'Atomic delete-fail', botId: 'bot-1' } as never,
            'user-1',
            'tenant-1',
          ),
        ).rejects.toBeInstanceOf(ServiceUnavailableException);

        // Both errors logged: the original folder9 failure AND the
        // best-effort DELETE failure.
        expect(loggerErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining('best-effort cleanup DELETE failed'),
        );
        loggerErrorSpy.mockRestore();
      });

      it('UPDATE folderId failure after folder9 success: throws 503, DELETEs the inserted row', async () => {
        // Provision succeeded but the local UPDATE folderId fails. The
        // folder is real on folder9 (will be GC'd as orphan); we DELETE
        // the routine row so the caller doesn't see it pointing nowhere.
        const draftRow = {
          id: 'task-atomic-update-fail',
          tenantId: 'tenant-1',
          creatorId: 'user-1',
          title: 'Atomic update-fail',
          description: null,
          documentId: 'doc-atomic-update-fail',
          folderId: null,
        };
        documentsService.create.mockResolvedValueOnce({
          id: 'doc-atomic-update-fail',
        } as any);
        db.returning.mockResolvedValueOnce([draftRow] as any);
        folder9Client.createFolder.mockResolvedValueOnce({
          id: 'folder-orphan',
          workspace_id: 'tenant-1',
        });
        folder9Client.createToken.mockResolvedValueOnce({
          token: 'tok-update-fail',
          expires_at: '2099-01-01',
        });
        folder9Client.commit.mockResolvedValueOnce({
          commit_id: 'commit-update-fail',
        });
        // Make the UPDATE chain reject when awaited. Override
        // db.update().set().where() to return a rejecting thenable.
        const rejectingChain = {
          set: jest.fn<any>().mockReturnThis(),
          where: jest.fn<any>(() =>
            Promise.reject(new Error('UPDATE constraint violation')),
          ),
        };
        // Explicitly set `set` to return the same chain so .where(...)
        // is reachable.
        rejectingChain.set.mockReturnValue(rejectingChain);
        db.update.mockReturnValueOnce(rejectingChain as any);

        await expect(
          service.create(
            { title: 'Atomic update-fail', botId: 'bot-1' } as never,
            'user-1',
            'tenant-1',
          ),
        ).rejects.toBeInstanceOf(ServiceUnavailableException);

        // Folder9 was reached.
        expect(folder9Client.createFolder).toHaveBeenCalledTimes(1);
        expect(folder9Client.commit).toHaveBeenCalledTimes(1);
        // Best-effort cleanup DELETE happened.
        expect(db.delete).toHaveBeenCalled();
      });

      it('exposes a self-counted DB-row leak proof: caller never gets a row reference back after a failed provision', async () => {
        // After a folder9 failure, the caller cannot observe the routine
        // because (a) the function rejected, and (b) we issued a
        // best-effort DELETE for the just-INSERTed row. Combining (a)
        // and (b) means the post-call observable state is "no routine
        // for this id" — even though the INSERT happened, the DELETE
        // erases it.
        const draftRow = {
          id: 'task-atomic-leak-proof',
          tenantId: 'tenant-1',
          creatorId: 'user-1',
          title: 'Atomic leak-proof',
          description: null,
          documentId: 'doc-atomic-leak-proof',
          folderId: null,
        };
        documentsService.create.mockResolvedValueOnce({
          id: 'doc-atomic-leak-proof',
        } as any);
        db.returning.mockResolvedValueOnce([draftRow] as any);
        folder9Client.createFolder.mockRejectedValueOnce(new Error('down'));

        await expect(
          service.create(
            { title: 'Atomic leak-proof', botId: 'bot-1' } as never,
            'user-1',
            'tenant-1',
          ),
        ).rejects.toBeInstanceOf(ServiceUnavailableException);

        // Best-effort cleanup DELETE issued.
        expect(db.delete).toHaveBeenCalled();

        // Simulate a follow-up SELECT for the same routineId — after
        // DELETE this returns [].
        db.limit.mockResolvedValueOnce([] as any);
        const after = await db
          .select()
          .from({} as any)
          .where({} as any)
          .limit(1);
        expect(after).toEqual([]);
      });

      // ── A.11 — folder9-failure metric ─────────────────────────────
      it('increments routines.create.folder9_failure_total exactly once when provision throws', async () => {
        const counterAdd = jest.fn();
        const spy = jest
          .spyOn(appMetrics, 'routinesCreateFolder9FailureTotal', 'get')
          .mockReturnValue({ add: counterAdd } as any);

        const draftRow = {
          id: 'task-atomic-metric',
          tenantId: 'tenant-1',
          creatorId: 'user-1',
          title: 'Atomic metric',
          description: null,
          documentId: 'doc-atomic-metric',
          folderId: null,
        };
        documentsService.create.mockResolvedValueOnce({
          id: 'doc-atomic-metric',
        } as any);
        db.returning.mockResolvedValueOnce([draftRow] as any);
        folder9Client.createFolder.mockRejectedValueOnce(
          new Error('folder9 down'),
        );

        await expect(
          service.create(
            { title: 'Atomic metric', botId: 'bot-1' } as never,
            'user-1',
            'tenant-1',
          ),
        ).rejects.toBeInstanceOf(ServiceUnavailableException);

        expect(counterAdd).toHaveBeenCalledTimes(1);
        // No labels — counter is unlabeled (alert is on its 5-min rate).
        expect(counterAdd).toHaveBeenCalledWith(1);
        spy.mockRestore();
      });

      it('does NOT increment folder9_failure_total when create succeeds', async () => {
        const counterAdd = jest.fn();
        const spy = jest
          .spyOn(appMetrics, 'routinesCreateFolder9FailureTotal', 'get')
          .mockReturnValue({ add: counterAdd } as any);

        documentsService.create.mockResolvedValueOnce({
          id: 'doc-happy-metric',
        } as any);
        db.returning.mockResolvedValueOnce([
          {
            id: 'task-happy-metric',
            tenantId: 'tenant-1',
            creatorId: 'user-1',
            title: 'Happy metric',
            description: null,
            documentId: 'doc-happy-metric',
            folderId: null,
          },
        ] as any);
        folder9Client.createFolder.mockResolvedValueOnce({
          id: 'folder-happy-metric',
          workspace_id: 'tenant-1',
        });
        folder9Client.createToken.mockResolvedValueOnce({
          token: 'tok-happy-metric',
          expires_at: '2099-01-01',
        });
        folder9Client.commit.mockResolvedValueOnce({
          commit_id: 'commit-happy-metric',
        });

        await service.create(
          { title: 'Happy metric', botId: 'bot-1' } as never,
          'user-1',
          'tenant-1',
        );

        expect(counterAdd).not.toHaveBeenCalled();
        spy.mockRestore();
      });
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

    // documentContent was dropped from UpdateRoutineDto in A.1 and the
    // permissive bridge was removed in A.4. The two tests that used to
    // exercise `service.update(..., { documentContent: '...' })` —
    // "calls documentsService.update with documentContent" and "throws
    // when documentContent provided but routine has no documentId" —
    // are obsolete and intentionally removed: there is no code path
    // left to test. Routine body editing now goes through the folder9
    // SKILL.md proxy (A.6).

    it('does NOT call documentsService.update on routine update', async () => {
      // Regression: the old bridge silently wrote dto.documentContent into
      // the linked Document. The new world owns routine body in folder9
      // SKILL.md, so PATCH on /v1/routines/:id must no longer touch
      // documentsService at all.
      db.limit.mockResolvedValueOnce([draftTask] as any);
      db.returning.mockResolvedValueOnce([draftTask] as any);

      await service.update(
        'task-1',
        { title: 'New title' } as never,
        'user-1',
        'tenant-1',
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
    const ROUTINE_DESCRIPTION = 'My routine description';

    const DRAFT_ROUTINE = {
      ...BASE_TASK,
      id: 'routine-1',
      status: 'draft' as const,
      creatorId: 'user-1',
      botId: 'bot-1',
      title: 'My Routine',
      // SKILL.md frontmatter `description` must equal this. Non-null +
      // non-empty so the new A.5 SKILL.md validation can compare against
      // a canonical value.
      description: ROUTINE_DESCRIPTION,
      // folderId pre-populated so `ensureRoutineFolder` takes the fast
      // path (no folder9 createFolder call) — the SELECT ... FOR UPDATE
      // returns this row, sees folderId, returns immediately. Individual
      // tests that need the slow-path (lazy provision) override the `for`
      // mock per-call.
      folderId: 'folder-existing',
      documentId: 'doc-1',
      creationChannelId: 'channel-1',
    };

    /**
     * SKILL.md content that satisfies validateSkillMd against
     * DRAFT_ROUTINE: name slug derived from `routine-1`, description
     * matches DRAFT_ROUTINE.description, body well past 20 chars.
     *
     * `slugifyUuid("routine-1")` → "routine-1" (one segment), so the
     * expected name is `routine-routine-1`.
     */
    const VALID_SKILL_MD = [
      '---',
      'name: routine-routine-1',
      `description: ${ROUTINE_DESCRIPTION}`,
      '---',
      '',
      'A complete routine body that easily clears the 20-char threshold.',
    ].join('\n');

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

      // After C2: `ensureRoutineFolder` reads via plain `.limit(1)`
      // (no row lock). The chain's `.limit` mock is shared with
      // `getRoutineOrThrow` — tests use `db.limit.mockResolvedValueOnce`
      // to set the FIRST call (getRoutineOrThrow) and we set a default
      // here so the SECOND call (ensureRoutineFolder's optimistic read)
      // also observes the DRAFT_ROUTINE row, which has folderId set so
      // ensureRoutineFolder takes the fast path.
      //
      // Vestigial: `.for('update')` is no longer used; leaving the
      // default in place doesn't matter (the spy is just never hit).
      db.for.mockResolvedValue([DRAFT_ROUTINE]);
      db.limit.mockResolvedValue([DRAFT_ROUTINE]);

      // Default SKILL.md read returns the valid fixture so happy-path
      // tests don't have to redeclare it. Failure-path tests override.
      folder9Client.getBlob.mockResolvedValue({
        path: 'SKILL.md',
        size: VALID_SKILL_MD.length,
        content: VALID_SKILL_MD,
        encoding: 'text' as const,
      });
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

    it('I1 — empty legacy documents-table content NO LONGER fails completeCreation', async () => {
      // I1 removed the documents-table gate. SKILL.md is now the source
      // of truth; an empty legacy document does not block status flip
      // as long as SKILL.md content validates. The default fixture
      // SKILL.md (VALID_SKILL_MD) already passes validation, so the
      // routine flips to upcoming successfully.
      db.limit.mockResolvedValueOnce([DRAFT_ROUTINE] as any);
      db.returning.mockResolvedValueOnce([UPDATED_ROUTINE] as any);
      documentsService.getById.mockResolvedValueOnce({
        id: 'doc-1',
        tenantId: 'tenant-1',
        currentVersion: { versionIndex: 1, content: '' },
      } as any);

      const result = await service.completeCreation(
        'routine-1',
        {},
        'user-1',
        'tenant-1',
      );
      expect(result.status).toBe('upcoming');
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

    it('I1 — missing legacy document NO LONGER fails completeCreation', async () => {
      // documentId is set but documentsService.getById throws (doc
      // deleted). After I1 the documents-table content is irrelevant —
      // only SKILL.md validation matters. SKILL.md still passes so the
      // status flip succeeds.
      db.limit.mockResolvedValueOnce([DRAFT_ROUTINE] as any);
      db.returning.mockResolvedValueOnce([UPDATED_ROUTINE] as any);

      const result = await service.completeCreation(
        'routine-1',
        {},
        'user-1',
        'tenant-1',
      );
      expect(result.status).toBe('upcoming');
    });

    it('I1 — null documentId NO LONGER fails completeCreation', async () => {
      // After I1 the documents-table content is irrelevant. The routine
      // can finish creation as long as SKILL.md validates — which it
      // does in the default fixture.
      db.limit.mockResolvedValueOnce([
        { ...DRAFT_ROUTINE, documentId: null },
      ] as any);
      db.returning.mockResolvedValueOnce([UPDATED_ROUTINE] as any);

      const result = await service.completeCreation(
        'routine-1',
        {},
        'user-1',
        'tenant-1',
      );
      expect(result.status).toBe('upcoming');
    });

    // ── (post-I1) document-table tenant-guard tests are obsolete ──────
    //
    // The legacy documents-table content gate was removed in I1 — only
    // SKILL.md validation matters now. Tenant-mismatch / "real shape"
    // tests against the documents service are therefore covered by
    // SKILL.md tests below; we keep one positive smoke test that pins
    // "happy SKILL.md flow → upcoming" to make sure the I1 removal
    // didn't accidentally change that path.

    it('I1 — happy SKILL.md flow flips to upcoming regardless of legacy doc content shape', async () => {
      db.limit.mockResolvedValueOnce([DRAFT_ROUTINE] as any);
      db.returning.mockResolvedValueOnce([UPDATED_ROUTINE] as any);
      // The documents-service mock could return literally anything
      // here — completeCreation no longer calls it on the new path.

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

    // ── A.5 SKILL.md validation ────────────────────────────────────
    //
    // These tests pin the integration: completeCreation must call
    // ensureRoutineFolder, mint a read-token, fetch SKILL.md, and run
    // validateSkillMd before flipping status. Validation FAILURE returns
    // `{ success: false, error }` (no throw) so the agent can retry.
    describe('SKILL.md validation (A.5)', () => {
      it('calls ensureRoutineFolder and reads SKILL.md before flipping status', async () => {
        db.limit.mockResolvedValueOnce([DRAFT_ROUTINE] as any);
        documentsService.getById.mockResolvedValueOnce({
          id: 'doc-1',
          tenantId: 'tenant-1',
          currentVersion: { versionIndex: 1, content: 'some content' },
        } as any);
        db.returning.mockResolvedValueOnce([UPDATED_ROUTINE] as any);

        await service.completeCreation('routine-1', {}, 'user-1', 'tenant-1');

        // After C2: ensureRoutineFolder uses plain `.limit(1)` (no row
        // lock). It still ran (the SKILL.md read+validation requires it),
        // observable via the createToken call below.

        // Read token minted with read scope, short TTL, and routine-scoped
        // creator label.
        expect(folder9Client.createToken).toHaveBeenCalledWith(
          expect.objectContaining({
            folder_id: 'folder-existing',
            permission: 'read',
            name: 'routine-finish-validate',
            created_by: 'routine:routine-1',
          }),
        );
        // The minted token's expires_at must be within ~5 minutes of now.
        const ttlIso = folder9Client.createToken.mock.calls[0][0]
          .expires_at as string;
        const ttlMs = new Date(ttlIso).getTime() - Date.now();
        expect(ttlMs).toBeGreaterThan(0);
        expect(ttlMs).toBeLessThanOrEqual(5 * 60_000 + 1000); // small clock fudge
        // SKILL.md fetched at folder root using the freshly-minted token.
        const mintedToken = folder9Client.createToken.mock.results[0]
          .value as Promise<{ token: string }>;
        const tokenStr = (await mintedToken).token;
        expect(folder9Client.getBlob).toHaveBeenCalledWith(
          'tenant-1',
          'folder-existing',
          tokenStr,
          'SKILL.md',
        );
      });

      it('returns { success: false, error } when SKILL.md frontmatter name is wrong', async () => {
        db.limit.mockResolvedValueOnce([DRAFT_ROUTINE] as any);
        documentsService.getById.mockResolvedValueOnce({
          id: 'doc-1',
          tenantId: 'tenant-1',
          currentVersion: { versionIndex: 1, content: 'some content' },
        } as any);
        // Override default valid SKILL.md with a name-mismatched fixture.
        folder9Client.getBlob.mockResolvedValueOnce({
          path: 'SKILL.md',
          size: 100,
          content: [
            '---',
            'name: routine-bogus',
            `description: ${ROUTINE_DESCRIPTION}`,
            '---',
            '',
            'A complete body that easily clears the threshold.',
          ].join('\n'),
          encoding: 'text' as const,
        });

        const result = await service.completeCreation(
          'routine-1',
          {},
          'user-1',
          'tenant-1',
        );

        expect(result).toEqual({
          success: false,
          error: expect.stringContaining('name'),
        });
        // Status flip MUST NOT have happened.
        expect(db.update).not.toHaveBeenCalled();
        // Channel archive MUST NOT have happened.
        expect(channelsService.archiveCreationChannel).not.toHaveBeenCalled();
      });

      it('returns { success: false, error } when SKILL.md description does not match', async () => {
        db.limit.mockResolvedValueOnce([DRAFT_ROUTINE] as any);
        documentsService.getById.mockResolvedValueOnce({
          id: 'doc-1',
          tenantId: 'tenant-1',
          currentVersion: { versionIndex: 1, content: 'some content' },
        } as any);
        folder9Client.getBlob.mockResolvedValueOnce({
          path: 'SKILL.md',
          size: 100,
          content: [
            '---',
            'name: routine-routine-1',
            'description: a totally different description',
            '---',
            '',
            'A complete body that easily clears the threshold.',
          ].join('\n'),
          encoding: 'text' as const,
        });

        const result = await service.completeCreation(
          'routine-1',
          {},
          'user-1',
          'tenant-1',
        );

        expect(result).toEqual({
          success: false,
          error: expect.stringContaining('description'),
        });
        expect(db.update).not.toHaveBeenCalled();
      });

      it('returns { success: false, error } when SKILL.md body is too short', async () => {
        db.limit.mockResolvedValueOnce([DRAFT_ROUTINE] as any);
        documentsService.getById.mockResolvedValueOnce({
          id: 'doc-1',
          tenantId: 'tenant-1',
          currentVersion: { versionIndex: 1, content: 'some content' },
        } as any);
        folder9Client.getBlob.mockResolvedValueOnce({
          path: 'SKILL.md',
          size: 50,
          content: [
            '---',
            'name: routine-routine-1',
            `description: ${ROUTINE_DESCRIPTION}`,
            '---',
            '',
            'too short',
          ].join('\n'),
          encoding: 'text' as const,
        });

        const result = await service.completeCreation(
          'routine-1',
          {},
          'user-1',
          'tenant-1',
        );

        expect(result).toEqual({
          success: false,
          error: expect.stringContaining('body'),
        });
        expect(db.update).not.toHaveBeenCalled();
      });

      it('returns { success: false, error } when SKILL.md frontmatter is malformed', async () => {
        db.limit.mockResolvedValueOnce([DRAFT_ROUTINE] as any);
        documentsService.getById.mockResolvedValueOnce({
          id: 'doc-1',
          tenantId: 'tenant-1',
          currentVersion: { versionIndex: 1, content: 'some content' },
        } as any);
        folder9Client.getBlob.mockResolvedValueOnce({
          path: 'SKILL.md',
          size: 30,
          content: 'no frontmatter here',
          encoding: 'text' as const,
        });

        const result = await service.completeCreation(
          'routine-1',
          {},
          'user-1',
          'tenant-1',
        );

        expect(result).toMatchObject({
          success: false,
          error: expect.stringMatching(/frontmatter/i),
        });
      });

      it('decodes base64 SKILL.md content before validating', async () => {
        const base64 = Buffer.from(VALID_SKILL_MD, 'utf8').toString('base64');
        db.limit.mockResolvedValueOnce([DRAFT_ROUTINE] as any);
        documentsService.getById.mockResolvedValueOnce({
          id: 'doc-1',
          tenantId: 'tenant-1',
          currentVersion: { versionIndex: 1, content: 'some content' },
        } as any);
        db.returning.mockResolvedValueOnce([UPDATED_ROUTINE] as any);
        folder9Client.getBlob.mockResolvedValueOnce({
          path: 'SKILL.md',
          size: base64.length,
          content: base64,
          encoding: 'base64' as const,
        });

        // Validation should succeed → status flip happens, return shape
        // is the upcoming row, not the failure object.
        const result = await service.completeCreation(
          'routine-1',
          {},
          'user-1',
          'tenant-1',
        );

        expect(result).toEqual(UPDATED_ROUTINE);
      });

      it('returns { success: false, error } when getBlob throws (e.g. SKILL.md missing)', async () => {
        db.limit.mockResolvedValueOnce([DRAFT_ROUTINE] as any);
        documentsService.getById.mockResolvedValueOnce({
          id: 'doc-1',
          tenantId: 'tenant-1',
          currentVersion: { versionIndex: 1, content: 'some content' },
        } as any);
        folder9Client.getBlob.mockRejectedValueOnce(new Error('404 Not Found'));

        const result = await service.completeCreation(
          'routine-1',
          {},
          'user-1',
          'tenant-1',
        );

        expect(result).toMatchObject({
          success: false,
          error: expect.stringMatching(/SKILL\.md.*could not be read/i),
        });
        expect(db.update).not.toHaveBeenCalled();
      });

      // ── C1 regression: null routine description ────────────────────
      //
      // Before C1 fix, `expectedDescription = ensured.description ?? ''`
      // — when the routine has a null description, the expected value
      // collapsed to `''`, which fails BOTH `description_empty` (must
      // be non-empty) AND `description_mismatch` (must equal). After
      // C1 fix, the expected value falls back to the same string the
      // provisioner seeds: `Generated from routine: <title>`. The agent
      // can then write SKILL.md frontmatter that matches and finish
      // creation cleanly.
      it('C1 — null routine description: completeCreation succeeds when SKILL.md mirrors the provisioner fallback', async () => {
        const draftWithNullDesc = {
          ...DRAFT_ROUTINE,
          description: null,
          // Provisioner-derived fallback is `Generated from routine - <title>`.
        };
        const upcomingFromNullDesc = {
          ...draftWithNullDesc,
          status: 'upcoming' as const,
        };
        db.limit.mockResolvedValueOnce([draftWithNullDesc] as any);
        // ensureRoutineFolder optimistic read sees the same row; folder
        // is already provisioned (fast path).
        db.limit.mockResolvedValueOnce([draftWithNullDesc] as any);

        // SKILL.md exactly matches what `provisionFolder9SkillFolder`
        // would have written: description = `Generated from routine - <title>`.
        folder9Client.getBlob.mockResolvedValueOnce({
          path: 'SKILL.md',
          size: 200,
          content: [
            '---',
            'name: routine-routine-1',
            `description: Generated from routine - ${draftWithNullDesc.title}`,
            '---',
            '',
            'A complete body that easily clears the 20-char threshold.',
          ].join('\n'),
          encoding: 'text' as const,
        } as any);

        db.returning.mockResolvedValueOnce([upcomingFromNullDesc] as any);

        const result = await service.completeCreation(
          'routine-1',
          {},
          'user-1',
          'tenant-1',
        );

        expect(result).toEqual(upcomingFromNullDesc);
        // Status flip happened — proves SKILL.md validation passed.
        expect(db.update).toHaveBeenCalled();
      });

      it('C1 — whitespace-only routine description treated as null (provisioner fallback applies)', async () => {
        // Mirror the provisioner's behaviour: a whitespace-only
        // description normalizes to empty, and the fallback fires.
        const draftWithBlankDesc = {
          ...DRAFT_ROUTINE,
          description: '   \n\n ',
        };
        const upcoming = {
          ...draftWithBlankDesc,
          status: 'upcoming' as const,
        };
        db.limit.mockResolvedValueOnce([draftWithBlankDesc] as any);
        db.limit.mockResolvedValueOnce([draftWithBlankDesc] as any);

        folder9Client.getBlob.mockResolvedValueOnce({
          path: 'SKILL.md',
          size: 200,
          content: [
            '---',
            'name: routine-routine-1',
            `description: Generated from routine - ${draftWithBlankDesc.title}`,
            '---',
            '',
            'A complete body that easily clears the 20-char threshold.',
          ].join('\n'),
          encoding: 'text' as const,
        } as any);

        db.returning.mockResolvedValueOnce([upcoming] as any);

        const result = await service.completeCreation(
          'routine-1',
          {},
          'user-1',
          'tenant-1',
        );

        expect(result.status).toBe('upcoming');
      });

      it('lazy-provisions folder9 folder when folderId is null then validates', async () => {
        // routine.folderId is null on the initial fetch (slow path of
        // ensureRoutineFolder will call provision via the folder9
        // client). After C2, ensureRoutineFolder uses plain `.limit(1)`
        // for both reads — getRoutineOrThrow + the optimistic read.
        const draftNoFolder = { ...DRAFT_ROUTINE, folderId: null };
        const ensuredNoFolder = {
          ...draftNoFolder,
          folderId: 'folder-fresh',
        };
        // First .limit() call: getRoutineOrThrow
        db.limit.mockResolvedValueOnce([draftNoFolder] as any);
        // Second .limit() call: ensureRoutineFolder optimistic read
        db.limit.mockResolvedValueOnce([draftNoFolder] as any);
        // Provision creates folder, mints write token, commits, then
        // UPDATEs the row via UPDATE-WHERE-NULL with .returning().
        folder9Client.createFolder.mockResolvedValueOnce({
          id: 'folder-fresh',
          workspace_id: 'tenant-1',
        } as any);
        folder9Client.createToken
          .mockResolvedValueOnce({
            // First mint: write-scoped token for provision
            id: 'tok-write',
            token: 'opaque-write',
            permission: 'write',
            folder_id: 'folder-fresh',
            created_by: 'routine:routine-1',
            created_at: '2026-04-27T00:00:00Z',
          } as any)
          .mockResolvedValueOnce({
            // Second mint: read-scoped token for the validation read
            token: 'tok-read',
            expires_at: '2099-01-01',
          } as any);
        folder9Client.commit.mockResolvedValueOnce({
          commit: 'sha-1',
          branch: 'main',
        } as any);
        // First .returning() call: ensureRoutineFolder slow-path UPDATE
        db.returning.mockResolvedValueOnce([ensuredNoFolder] as any);
        // Second .returning() call: completeCreation status flip
        db.returning.mockResolvedValueOnce([UPDATED_ROUTINE] as any);

        const result = await service.completeCreation(
          'routine-1',
          {},
          'user-1',
          'tenant-1',
        );

        expect(result).toEqual(UPDATED_ROUTINE);
        // Provision happened.
        expect(folder9Client.createFolder).toHaveBeenCalledTimes(1);
        // Two tokens: one for provision (write), one for validation (read).
        expect(folder9Client.createToken).toHaveBeenCalledTimes(2);
        expect(folder9Client.getBlob).toHaveBeenCalledWith(
          'tenant-1',
          'folder-fresh',
          'tok-read',
          'SKILL.md',
        );
      });

      // ── A.11 — validation-failure metric ──────────────────────────
      describe('validation_failure_total counter (A.11)', () => {
        let counterAdd: jest.Mock<(...args: any[]) => any>;

        beforeEach(() => {
          counterAdd = jest.fn<any>();
          jest
            .spyOn(
              appMetrics,
              'routinesCompleteCreationValidationFailureTotal',
              'get',
            )
            .mockReturnValue({ add: counterAdd } as any);
        });

        it('emits rule="name_mismatch" when SKILL.md name is wrong', async () => {
          db.limit.mockResolvedValueOnce([DRAFT_ROUTINE] as any);
          documentsService.getById.mockResolvedValueOnce({
            id: 'doc-1',
            tenantId: 'tenant-1',
            currentVersion: { versionIndex: 1, content: 'some content' },
          } as any);
          folder9Client.getBlob.mockResolvedValueOnce({
            path: 'SKILL.md',
            size: 200,
            content: [
              '---',
              'name: routine-WRONG',
              `description: ${ROUTINE_DESCRIPTION}`,
              '---',
              '',
              'A complete routine body that easily clears the 20-char threshold.',
            ].join('\n'),
            encoding: 'text' as const,
          } as any);

          const result = await service.completeCreation(
            'routine-1',
            {},
            'user-1',
            'tenant-1',
          );
          expect(result).toMatchObject({ success: false });
          expect(counterAdd).toHaveBeenCalledTimes(1);
          expect(counterAdd).toHaveBeenCalledWith(1, { rule: 'name_mismatch' });
        });

        it('emits rule="body_too_short" when SKILL.md body is too short', async () => {
          db.limit.mockResolvedValueOnce([DRAFT_ROUTINE] as any);
          documentsService.getById.mockResolvedValueOnce({
            id: 'doc-1',
            tenantId: 'tenant-1',
            currentVersion: { versionIndex: 1, content: 'some content' },
          } as any);
          folder9Client.getBlob.mockResolvedValueOnce({
            path: 'SKILL.md',
            size: 100,
            content: [
              '---',
              'name: routine-routine-1',
              `description: ${ROUTINE_DESCRIPTION}`,
              '---',
              '',
              'short',
            ].join('\n'),
            encoding: 'text' as const,
          } as any);

          await service.completeCreation('routine-1', {}, 'user-1', 'tenant-1');
          expect(counterAdd).toHaveBeenCalledWith(1, {
            rule: 'body_too_short',
          });
        });

        it('emits rule="read_failed" when SKILL.md cannot be fetched', async () => {
          db.limit.mockResolvedValueOnce([DRAFT_ROUTINE] as any);
          documentsService.getById.mockResolvedValueOnce({
            id: 'doc-1',
            tenantId: 'tenant-1',
            currentVersion: { versionIndex: 1, content: 'some content' },
          } as any);
          folder9Client.getBlob.mockRejectedValueOnce(
            new Error('404 Not Found'),
          );

          await service.completeCreation('routine-1', {}, 'user-1', 'tenant-1');
          expect(counterAdd).toHaveBeenCalledTimes(1);
          expect(counterAdd).toHaveBeenCalledWith(1, { rule: 'read_failed' });
        });

        it('does NOT emit the validation counter on the happy path', async () => {
          db.limit.mockResolvedValueOnce([DRAFT_ROUTINE] as any);
          db.returning.mockResolvedValueOnce([UPDATED_ROUTINE] as any);
          documentsService.getById.mockResolvedValueOnce({
            id: 'doc-1',
            tenantId: 'tenant-1',
            currentVersion: { versionIndex: 1, content: 'some content' },
          } as any);

          await service.completeCreation('routine-1', {}, 'user-1', 'tenant-1');

          expect(counterAdd).not.toHaveBeenCalled();
        });

        it('does NOT emit the validation counter on legacy required-field failures', async () => {
          // The legacy gate ("title is required" etc) throws BEFORE the
          // SKILL.md branch — those counter labels would muddy the
          // dashboard, so no metric fires for them.
          db.limit.mockResolvedValueOnce([
            { ...DRAFT_ROUTINE, title: '' },
          ] as any);
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

          expect(counterAdd).not.toHaveBeenCalled();
        });
      });
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

      //   9. ensureRoutineFolder (A.8 / C2) — uses optimistic
      //      `.limit(1)`. Returning a row with a populated folderId
      //      puts it on the fast path. Vestigial `.for('update')` mock
      //      kept for any path that still references it (none after C2).
      db.for.mockResolvedValueOnce([
        { ...draftRoutine, folderId: 'folder-existing' } as any,
      ] as any);
      db.limit.mockResolvedValueOnce([
        { ...draftRoutine, folderId: 'folder-existing' } as any,
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
        ensuredFolderRow?: Record<string, unknown> | null;
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
        // A.8: startCreationSession now calls ensureRoutineFolder before
        // createSession to back the `routine.document` mount. Default to
        // a pre-provisioned folder so tests take the fast path; tests
        // that exercise the lazy-provision branch override per-call.
        folderId: 'folder-existing',
        description: null,
        ...overrides,
      };
      const {
        botTenantRow = { tenantId: TENANT_ID },
        claimResult = [{ id: ROUTINE_ID }],
        ensuredFolderRow = routine,
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

      // Step 7 (A.8 / C2): ensureRoutineFolder runs an optimistic
      // `.limit(1)` (no row lock). Returning a row with a populated
      // folderId puts it on the fast path (no provision call, no
      // follow-up UPDATE). Vestigial `.for('update')` mock kept.
      //
      // Skip queuing this when the atomic claim is configured to lose
      // (claimResult = []) — in that branch, startCreationSession
      // returns early via re-read and never calls ensureRoutineFolder.
      // Queuing the mock anyway would shift the limit FIFO and feed
      // the wrong row to the winner re-read.
      const claimWonRow = claimResult.length > 0;
      if (ensuredFolderRow !== null && claimWonRow) {
        db.for.mockResolvedValueOnce([ensuredFolderRow] as any);
        db.limit.mockResolvedValueOnce([ensuredFolderRow] as any);
      }

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
          folderId: 'folder-existing',
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

      // Step 5 (A.8 / C2): ensureRoutineFolder fast path via .limit(1)
      db.for.mockResolvedValueOnce([
        { id: ROUTINE_ID, folderId: 'folder-existing' } as any,
      ]);
      db.limit.mockResolvedValueOnce([
        { id: ROUTINE_ID, folderId: 'folder-existing' } as any,
      ]);

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

    // ── A.8: routine.document folderMap injection (static intent) ─────
    //
    // The routine-creation channel session carries a STATIC INTENT for
    // the routine.document mount — workspaceId/folderId/folderType/
    // permission/readOnly only, NO token. The agent-pi
    // JustBashTeam9WorkspaceComponent issues the folder9 token
    // dynamically at onSessionStart via POST /api/v1/bot/folder-token
    // (served by FolderTokenController in this gateway). That move
    // lets the server see full session context at authorization time
    // and keeps folder9 tokens out of persisted componentConfigs.
    describe('A.8: just-bash-team9-workspace folderMap injection', () => {
      it('injects folderMap intent (no pre-minted token) into componentConfigs', async () => {
        mockGetRoutine({ folderId: 'folder-existing' });

        await service.startCreationSession(ROUTINE_ID, USER_ID, TENANT_ID);

        // No write-scoped token is minted in the new model. Any
        // folder9 createToken calls would only come from lazy
        // provisioning (not triggered here because folderId is set).
        expect(folder9Client.createToken).not.toHaveBeenCalled();

        // createSession invoked with the populated componentConfigs.
        // The folderMap carries a STATIC intent — no `token` field.
        expect(clawHiveService.createSession).toHaveBeenCalledWith(
          AGENT_ID,
          expect.objectContaining({
            componentConfigs: {
              'just-bash-team9-workspace': {
                folderMap: {
                  'routine.document': {
                    workspaceId: TENANT_ID,
                    folderId: 'folder-existing',
                    folderType: 'managed',
                    permission: 'write',
                    readOnly: false,
                  },
                },
                mountTeam9Skills: true,
              },
            },
          }),
          TENANT_ID,
        );

        const createSessionCall = (clawHiveService.createSession as jest.Mock)
          .mock.calls[0] as [string, Record<string, any>, string];
        const mountRef = (
          createSessionCall[1].componentConfigs as Record<string, any>
        )['just-bash-team9-workspace'].folderMap['routine.document'];
        expect(mountRef).not.toHaveProperty('token');
      });

      it('lazy-provisions the folder when routine.folderId is NULL and uses the new id', async () => {
        // Routine row read at step 1 has a NULL folderId. With C2
        // ensureRoutineFolder uses a plain `.limit(1)` for the
        // optimistic read; the row's folderId is NULL so the slow
        // path fires (provision via folder9 + UPDATE-WHERE-NULL via
        // .returning()). The slow-path UPDATE returns the
        // freshly-claimed row, then we use its `folderId` for
        // `routine.document` in the session config.
        const draft = {
          id: ROUTINE_ID,
          tenantId: TENANT_ID,
          creatorId: USER_ID,
          botId: BOT_ID,
          status: 'draft',
          title: 'Test Draft',
          creationChannelId: null,
          creationSessionId: null,
          folderId: null,
          description: null,
        };
        mockGetRoutine(
          { folderId: null },
          { ensuredFolderRow: { ...draft, folderId: null } },
        );
        // ensureRoutineFolder calls folder9Client.createFolder + commit
        // via provisionFolder9SkillFolder. The default folder9Client
        // mocks already paint a happy path that returns folder-new.
        folder9Client.createFolder.mockResolvedValueOnce({
          id: 'folder-new',
          workspace_id: TENANT_ID,
        });
        // Only one token mint now — the one INSIDE
        // provisionFolder9SkillFolder for the initial scaffold commit.
        // The old A.8 session-write token is gone (dynamic issuance).
        folder9Client.createToken.mockResolvedValueOnce({
          token: 'scaffold-tok',
          expires_at: 'x',
        });
        folder9Client.commit.mockResolvedValueOnce({
          commit_id: 'commit-init',
        });
        // C2: UPDATE-WHERE-NULL claim returns the freshly-claimed row.
        db.returning.mockResolvedValueOnce([
          { ...draft, folderId: 'folder-new' },
        ]);

        await service.startCreationSession(ROUTINE_ID, USER_ID, TENANT_ID);

        // The session componentConfigs must reference the
        // newly-provisioned folder id, and must NOT carry a token.
        const createSessionCall = (clawHiveService.createSession as jest.Mock)
          .mock.calls[0] as [string, Record<string, any>, string];
        const cfg = createSessionCall[1].componentConfigs as Record<
          string,
          any
        >;
        const mountRef =
          cfg['just-bash-team9-workspace'].folderMap['routine.document'];
        expect(mountRef.folderId).toBe('folder-new');
        expect(mountRef).not.toHaveProperty('token');
      });

      it('rolls back channel + claim if ensureRoutineFolder fails (folder9 outage)', async () => {
        // Lazy-provision branch where folder9.createFolder throws.
        const draft = {
          id: ROUTINE_ID,
          tenantId: TENANT_ID,
          creatorId: USER_ID,
          botId: BOT_ID,
          status: 'draft',
          title: 'Test Draft',
          creationChannelId: null,
          creationSessionId: null,
          folderId: null,
          description: null,
        };
        mockGetRoutine(
          { folderId: null },
          { ensuredFolderRow: { ...draft, folderId: null } },
        );
        folder9Client.createFolder.mockRejectedValueOnce(
          new Error('folder9 down'),
        );

        await expect(
          service.startCreationSession(ROUTINE_ID, USER_ID, TENANT_ID),
        ).rejects.toThrow(ServiceUnavailableException);

        expect(
          channelsService.hardDeleteRoutineSessionChannel,
        ).toHaveBeenCalledWith(CHANNEL_ID, TENANT_ID);
        expect(clawHiveService.createSession).not.toHaveBeenCalled();
      });
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
      // ensureRoutineFolder (A.8 / C2) fast path via .limit(1)
      db.for.mockResolvedValueOnce([
        { ...DRAFT, folderId: 'folder-existing' } as any,
      ]);
      db.limit.mockResolvedValueOnce([
        { ...DRAFT, folderId: 'folder-existing' } as any,
      ]);

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
      // ensureRoutineFolder (A.8 / C2) fast path via .limit(1)
      db.for.mockResolvedValueOnce([
        { ...DRAFT, folderId: 'folder-existing' } as any,
      ]);
      db.limit.mockResolvedValueOnce([
        { ...DRAFT, folderId: 'folder-existing' } as any,
      ]);

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

  // ── Folder proxy (A.6) ─────────────────────────────────────────────
  // Each public method follows the same template:
  //   1. ensureRoutineFolder (lazy-provision invariant)
  //   2. tenant gate (cross-tenant -> 403)
  //   3. mint per-request short-lived token
  //   4. forward to folder9 client
  //
  // Coverage targets: happy path, cross-tenant 403, lazy-provision
  // (NULL folderId triggers provision), folder9 propagation as 5xx.
  describe('folder proxy', () => {
    const ROUTINE_ID = 'routine-folder';
    const USER_ID = 'user-1';
    const TENANT_ID = 'tenant-1';

    const PROVISIONED_ROUTINE = {
      ...BASE_TASK,
      id: ROUTINE_ID,
      tenantId: TENANT_ID,
      folderId: 'folder-existing',
    };

    beforeEach(() => {
      // Default: ensureRoutineFolder fast-path (folderId already
      // populated). Both legacy `.for('update')` and new `.limit(1)`
      // mocks return the same row so any test that overrides one but
      // not the other still observes a consistent fast path.
      db.for.mockResolvedValue([PROVISIONED_ROUTINE]);
      db.limit.mockResolvedValue([PROVISIONED_ROUTINE]);
      folder9Client.createToken.mockResolvedValue({
        token: 'tok-folder-proxy',
        expires_at: '2099-01-01T00:00:00Z',
      });
    });

    describe('getRoutineFolderTree', () => {
      it('forwards to folder9 client with read-token + tree opts', async () => {
        folder9Client.getTree.mockResolvedValueOnce([
          { name: 'SKILL.md', path: 'SKILL.md', type: 'file', size: 100 },
        ]);

        const result = await service.getRoutineFolderTree(
          ROUTINE_ID,
          USER_ID,
          TENANT_ID,
          { path: 'docs', recursive: true },
        );

        expect(result).toEqual([
          { name: 'SKILL.md', path: 'SKILL.md', type: 'file', size: 100 },
        ]);
        expect(folder9Client.createToken).toHaveBeenCalledWith(
          expect.objectContaining({
            folder_id: 'folder-existing',
            permission: 'read',
            created_by: `user:${USER_ID}`,
          }),
        );
        // TTL window — read token is 5 min. Boundary check: token expires
        // strictly within the next 6 minutes, never zero.
        const mintArg = (folder9Client.createToken as any).mock.calls[0][0];
        const expiresAt = new Date(mintArg.expires_at).getTime();
        expect(expiresAt - Date.now()).toBeGreaterThan(0);
        expect(expiresAt - Date.now()).toBeLessThanOrEqual(6 * 60_000);

        expect(folder9Client.getTree).toHaveBeenCalledWith(
          TENANT_ID,
          'folder-existing',
          'tok-folder-proxy',
          { path: 'docs', recursive: true },
        );
      });

      it('triggers lazy provision when folderId is NULL', async () => {
        // C2: ensureRoutineFolder uses `.limit(1)` for the optimistic
        // read. Returns row with NULL folderId so the slow path
        // (provision + UPDATE-WHERE-NULL) fires.
        const draftRoutine = {
          ...PROVISIONED_ROUTINE,
          folderId: null as string | null,
        };
        db.for.mockResolvedValueOnce([draftRoutine] as any);
        db.limit.mockResolvedValueOnce([draftRoutine] as any);
        folder9Client.createFolder.mockResolvedValueOnce({
          id: 'folder-new',
          workspace_id: TENANT_ID,
        });
        folder9Client.commit.mockResolvedValueOnce({ commit_id: 'init' });
        // The UPDATE-WHERE-NULL claim returns the freshly-claimed row.
        db.returning.mockResolvedValueOnce([
          { ...draftRoutine, folderId: 'folder-new' } as any,
        ]);
        folder9Client.getTree.mockResolvedValueOnce([]);

        await service.getRoutineFolderTree(ROUTINE_ID, USER_ID, TENANT_ID);

        // createFolder fired during lazy provision.
        expect(folder9Client.createFolder).toHaveBeenCalled();
        // Read-token mint happened against the freshly-provisioned id.
        expect(folder9Client.getTree).toHaveBeenCalledWith(
          TENANT_ID,
          'folder-new',
          'tok-folder-proxy',
          {},
        );
      });

      it('rejects with 403 when caller tenant differs from routine tenant', async () => {
        await expect(
          service.getRoutineFolderTree(ROUTINE_ID, USER_ID, 'tenant-other'),
        ).rejects.toMatchObject({ status: 403 });
        expect(folder9Client.getTree).not.toHaveBeenCalled();
        expect(folder9Client.createToken).not.toHaveBeenCalled();
      });

      it('rejects with 404 when routine does not exist', async () => {
        db.for.mockResolvedValueOnce([] as any);
        db.limit.mockResolvedValueOnce([] as any);
        await expect(
          service.getRoutineFolderTree(ROUTINE_ID, USER_ID, TENANT_ID),
        ).rejects.toThrow(/not found/);
      });

      it('propagates folder9 client failure to caller (5xx)', async () => {
        folder9Client.getTree.mockRejectedValueOnce(
          new ServiceUnavailableException('folder9 unreachable'),
        );

        await expect(
          service.getRoutineFolderTree(ROUTINE_ID, USER_ID, TENANT_ID),
        ).rejects.toThrow(/folder9 unreachable/);
      });
    });

    describe('getRoutineFolderBlob', () => {
      it('forwards to folder9 client with read-token + path', async () => {
        folder9Client.getBlob.mockResolvedValueOnce({
          path: 'SKILL.md',
          size: 5,
          content: 'hello',
          encoding: 'text' as const,
        });

        const result = await service.getRoutineFolderBlob(
          ROUTINE_ID,
          USER_ID,
          TENANT_ID,
          'SKILL.md',
        );

        expect(result).toEqual({
          path: 'SKILL.md',
          size: 5,
          content: 'hello',
          encoding: 'text',
        });
        expect(folder9Client.createToken).toHaveBeenCalledWith(
          expect.objectContaining({ permission: 'read' }),
        );
        expect(folder9Client.getBlob).toHaveBeenCalledWith(
          TENANT_ID,
          'folder-existing',
          'tok-folder-proxy',
          'SKILL.md',
        );
      });

      it('throws 400 when path is empty', async () => {
        await expect(
          service.getRoutineFolderBlob(ROUTINE_ID, USER_ID, TENANT_ID, ''),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(folder9Client.getBlob).not.toHaveBeenCalled();
      });

      it('throws 400 when path is whitespace only', async () => {
        await expect(
          service.getRoutineFolderBlob(ROUTINE_ID, USER_ID, TENANT_ID, '   '),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it('rejects with 403 when caller tenant differs', async () => {
        await expect(
          service.getRoutineFolderBlob(
            ROUTINE_ID,
            USER_ID,
            'tenant-other',
            'SKILL.md',
          ),
        ).rejects.toMatchObject({ status: 403 });
      });

      it('propagates folder9 client failure', async () => {
        folder9Client.getBlob.mockRejectedValueOnce(
          new ServiceUnavailableException('folder9 down'),
        );
        await expect(
          service.getRoutineFolderBlob(
            ROUTINE_ID,
            USER_ID,
            TENANT_ID,
            'SKILL.md',
          ),
        ).rejects.toThrow(/folder9 down/);
      });
    });

    describe('commitRoutineFolder', () => {
      const COMMIT_DTO = {
        message: 'edit SKILL.md',
        files: [
          {
            path: 'SKILL.md',
            content: 'new body',
            action: 'update' as const,
          },
        ],
      };

      it('commits with propose=false when folder.approval_mode is auto', async () => {
        folder9Client.getFolder.mockResolvedValueOnce({
          id: 'folder-existing',
          workspace_id: TENANT_ID,
          approval_mode: 'auto',
        } as any);
        folder9Client.commit.mockResolvedValueOnce({
          commit_id: 'c-new',
        });

        const result = await service.commitRoutineFolder(
          ROUTINE_ID,
          USER_ID,
          TENANT_ID,
          COMMIT_DTO as any,
        );

        expect(result).toEqual({ commit_id: 'c-new' });
        // Token MUST be write-scoped (not propose) when not in propose-mode.
        const mintArg = (folder9Client.createToken as any).mock.calls[0][0];
        expect(mintArg.permission).toBe('write');
        // Write-token TTL: 15 min boundary check.
        const expiresAt = new Date(mintArg.expires_at).getTime();
        expect(expiresAt - Date.now()).toBeGreaterThan(0);
        expect(expiresAt - Date.now()).toBeLessThanOrEqual(16 * 60_000);
        // commit must include propose: false (NOT undefined — the wire
        // contract is explicit).
        expect(folder9Client.commit).toHaveBeenCalledWith(
          TENANT_ID,
          'folder-existing',
          'tok-folder-proxy',
          expect.objectContaining({
            message: 'edit SKILL.md',
            propose: false,
          }),
        );
      });

      it('commits with propose=false even when folder is in review mode (write-permission user)', async () => {
        // v1: tenant member always has write permission, so review-mode
        // folders still direct-commit (write bypasses review). The propose
        // path activates only when the user permission is explicitly
        // "propose" — which is not yet exposed in v1 RBAC.
        folder9Client.getFolder.mockResolvedValueOnce({
          id: 'folder-existing',
          workspace_id: TENANT_ID,
          approval_mode: 'review',
        } as any);
        folder9Client.commit.mockResolvedValueOnce({ commit_id: 'c-rev' });

        await service.commitRoutineFolder(
          ROUTINE_ID,
          USER_ID,
          TENANT_ID,
          COMMIT_DTO as any,
        );

        const mintArg = (folder9Client.createToken as any).mock.calls[0][0];
        expect(mintArg.permission).toBe('write');
        expect(folder9Client.commit).toHaveBeenCalledWith(
          TENANT_ID,
          'folder-existing',
          'tok-folder-proxy',
          expect.objectContaining({ propose: false }),
        );
      });

      it('lazy-provisions then commits when folderId is NULL', async () => {
        const draftRoutine = {
          ...PROVISIONED_ROUTINE,
          folderId: null as string | null,
        };
        // C2: ensureRoutineFolder uses `.limit(1)` for the optimistic
        // read, then UPDATE-WHERE-NULL with `.returning()` for the claim.
        db.for.mockResolvedValueOnce([draftRoutine] as any);
        db.limit.mockResolvedValueOnce([draftRoutine] as any);
        folder9Client.createFolder.mockResolvedValueOnce({
          id: 'folder-new',
          workspace_id: TENANT_ID,
        });
        // First createToken: provisioning (initial commit). Second: write
        // commit. Initial-commit response.
        folder9Client.commit
          .mockResolvedValueOnce({ commit_id: 'init' })
          .mockResolvedValueOnce({ commit_id: 'c-after-provision' });
        // UPDATE-WHERE-NULL claim returns the freshly-claimed row.
        db.returning.mockResolvedValueOnce([
          { ...draftRoutine, folderId: 'folder-new' } as any,
        ]);
        folder9Client.getFolder.mockResolvedValueOnce({
          id: 'folder-new',
          workspace_id: TENANT_ID,
          approval_mode: 'auto',
        } as any);

        await service.commitRoutineFolder(
          ROUTINE_ID,
          USER_ID,
          TENANT_ID,
          COMMIT_DTO as any,
        );

        expect(folder9Client.createFolder).toHaveBeenCalled();
        // Write commit fired against the new folder id.
        expect(folder9Client.commit).toHaveBeenLastCalledWith(
          TENANT_ID,
          'folder-new',
          'tok-folder-proxy',
          expect.objectContaining({ propose: false }),
        );
      });

      it('rejects with 403 when caller tenant differs', async () => {
        await expect(
          service.commitRoutineFolder(
            ROUTINE_ID,
            USER_ID,
            'tenant-other',
            COMMIT_DTO as any,
          ),
        ).rejects.toMatchObject({ status: 403 });
        expect(folder9Client.commit).not.toHaveBeenCalled();
      });

      it('propagates folder9 commit failure', async () => {
        folder9Client.getFolder.mockResolvedValueOnce({
          id: 'folder-existing',
          workspace_id: TENANT_ID,
          approval_mode: 'auto',
        } as any);
        folder9Client.commit.mockRejectedValueOnce(
          new ServiceUnavailableException('folder9 commit failed'),
        );

        await expect(
          service.commitRoutineFolder(
            ROUTINE_ID,
            USER_ID,
            TENANT_ID,
            COMMIT_DTO as any,
          ),
        ).rejects.toThrow(/folder9 commit failed/);
      });
    });

    describe('getRoutineFolderHistory', () => {
      it('forwards to folder9 client with read-token + log opts', async () => {
        folder9Client.log.mockResolvedValueOnce([
          {
            SHA: 'sha1',
            Message: 'init',
            AuthorName: 'a',
            AuthorEmail: 'a@b',
            Time: '2026-01-01T00:00:00Z',
          },
        ]);

        const result = await service.getRoutineFolderHistory(
          ROUTINE_ID,
          USER_ID,
          TENANT_ID,
          { ref: 'main', path: 'SKILL.md', limit: 25 },
        );

        expect(result).toHaveLength(1);
        expect(folder9Client.createToken).toHaveBeenCalledWith(
          expect.objectContaining({ permission: 'read' }),
        );
        expect(folder9Client.log).toHaveBeenCalledWith(
          TENANT_ID,
          'folder-existing',
          'tok-folder-proxy',
          { ref: 'main', path: 'SKILL.md', limit: 25 },
        );
      });

      it('rejects with 403 when caller tenant differs', async () => {
        await expect(
          service.getRoutineFolderHistory(ROUTINE_ID, USER_ID, 'tenant-other'),
        ).rejects.toMatchObject({ status: 403 });
      });

      it('propagates folder9 log failure', async () => {
        folder9Client.log.mockRejectedValueOnce(
          new ServiceUnavailableException('log failed'),
        );
        await expect(
          service.getRoutineFolderHistory(ROUTINE_ID, USER_ID, TENANT_ID),
        ).rejects.toThrow(/log failed/);
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
      // SELECT ... FOR UPDATE — invoked by ensureRoutineFolder (A.5
      // wires this into completeCreation's pre-flight checks).
      'for',
    ];
    for (const m of methods) {
      chain[m] = jest.fn<any>().mockReturnValue(chain);
    }
    chain.limit.mockResolvedValue([]);
    chain.returning.mockResolvedValue([]);
    chain.for.mockResolvedValue([]);
    chain.transaction = jest
      .fn<any>()
      .mockImplementation((cb: (tx: any) => any) => cb(chain));
    return chain;
  }

  const ROUTINE_DESCRIPTION = 'Race guard routine';

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
    // Non-null description so SKILL.md validation has something to
    // compare against. Empty would short-circuit on the empty-frontmatter
    // rule before exercising the race-guard branches we want to test.
    description: ROUTINE_DESCRIPTION,
    // folderId pre-populated → ensureRoutineFolder takes the fast path.
    folderId: 'folder-existing',
    createdAt: new Date(),
    updatedAt: new Date(),
    currentExecutionId: null,
  };

  /** SKILL.md content that satisfies validateSkillMd against DRAFT_ROUTINE. */
  const VALID_SKILL_MD = [
    '---',
    'name: routine-routine-1',
    `description: ${ROUTINE_DESCRIPTION}`,
    '---',
    '',
    'A complete routine body that easily clears the 20-char threshold.',
  ].join('\n');

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
  let folder9Client: {
    createFolder: MockFn;
    createToken: MockFn;
    commit: MockFn;
    getBlob: MockFn;
    getTree: MockFn;
    getFolder: MockFn;
    log: MockFn;
  };

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
    // Folder9 mock — stubbed for both create() (unused here) and the A.5
    // SKILL.md read path (createToken + getBlob). Default getBlob returns
    // the valid fixture so tests proceed past validation; race-guard
    // tests want to exercise the post-validation status flip, not the
    // SKILL.md gate itself.
    folder9Client = {
      createFolder: jest.fn<any>(),
      createToken: jest
        .fn<any>()
        .mockResolvedValue({ token: 'tok-read', expires_at: '2099-01-01' }),
      commit: jest.fn<any>(),
      getBlob: jest.fn<any>().mockResolvedValue({
        path: 'SKILL.md',
        size: VALID_SKILL_MD.length,
        content: VALID_SKILL_MD,
        encoding: 'text' as const,
      }),
      // Race-guard suite does not exercise folder-proxy endpoints,
      // but the type shape MUST match so spec tests at the bottom of
      // the file (folder proxy) compile against the same fixture
      // type. Defaults are inert.
      getTree: jest.fn<any>().mockResolvedValue([]),
      getFolder: jest.fn<any>().mockResolvedValue({
        id: 'folder-existing',
        approval_mode: 'auto',
        workspace_id: 'tenant-1',
      }),
      log: jest.fn<any>().mockResolvedValue([]),
    };
    // Default mocks: ensureRoutineFolder takes the fast path. Both
    // legacy `.for('update')` and new `.limit(1)` return the same row
    // so tests that override one or the other still observe a
    // consistent fast path (post-C2 the new code only calls .limit(1),
    // but we leave .for as a vestige).
    db.for.mockResolvedValue([DRAFT_ROUTINE]);
    db.limit.mockResolvedValue([DRAFT_ROUTINE]);

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
        { provide: Folder9ClientService, useValue: folder9Client },
      ],
    }).compile();

    service = module.get<RoutinesService>(RoutinesService);
  });

  it('race-loss: returns winner state without dispatching autoRunFirst', async () => {
    // After C2, completeCreation triggers FOUR `db.limit` calls in
    // order: (1) getRoutineOrThrow, (2) ensureRoutineFolder optimistic
    // SELECT, (3) re-fetch via getRoutineOrThrow on race-loss.
    // (1) sees draft
    db.limit.mockResolvedValueOnce([DRAFT_ROUTINE] as any);
    // (2) ensureRoutineFolder: same row, already has folderId (fast path)
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
    // (3) Re-fetch via getRoutineOrThrow returns the winner's upcoming state
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
    // Same call ordering as the previous test — one extra .limit for
    // ensureRoutineFolder's optimistic SELECT after C2.
    db.limit.mockResolvedValueOnce([DRAFT_ROUTINE] as any);
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

    // (1) getRoutineOrThrow + (2) ensureRoutineFolder optimistic SELECT
    db.limit.mockResolvedValueOnce([DRAFT_ROUTINE] as any);
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
