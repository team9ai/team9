import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { RoutineBotService } from './routine-bot.service.js';
import { RoutinesService } from './routines.service.js';
import { TaskCastService } from './taskcast.service.js';
import { DATABASE_CONNECTION } from '@team9/database';
import { WEBSOCKET_GATEWAY } from '../shared/constants/injection-tokens.js';

// ── helpers ───────────────────────────────────────────────────────────

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
    'leftJoin',
  ];
  for (const m of methods) {
    chain[m] = jest.fn<any>().mockReturnValue(chain);
  }
  // Default terminal resolutions
  chain.limit.mockResolvedValue([]);
  chain.returning.mockResolvedValue([]);
  // orderBy is also used as a terminal await in reportSteps (final steps list)
  chain.orderBy.mockResolvedValue([]);
  return chain;
}

// ── Shared fixtures ───────────────────────────────────────────────────

const TASK = {
  id: 'task-1',
  botId: 'bot-1',
  tenantId: 'tenant-1',
  currentExecutionId: 'exec-1',
  status: 'in_progress',
};

const BOT = { userId: 'bot-user-1' };

const EXECUTION_WITH_TASKCAST = {
  id: 'exec-1',
  taskId: 'task-1',
  taskcastTaskId: 'agent_task_exec_exec-1',
  startedAt: new Date(),
  status: 'in_progress',
};

const EXECUTION_WITHOUT_TASKCAST = {
  id: 'exec-1',
  taskId: 'task-1',
  taskcastTaskId: null,
  startedAt: new Date(),
  status: 'in_progress',
};

const EXECUTION_TERMINAL = {
  id: 'exec-1',
  taskId: 'task-1',
  taskcastTaskId: 'agent_task_exec_exec-1',
  startedAt: new Date(),
  status: 'completed',
};

/**
 * Set up the `limit` mock so that the first three calls return:
 *   1. execution (for getExecutionDirect — select from routineExecutions)
 *   2. task      (for getExecutionDirect — select from routines)
 *   3. bot       (for verifyBotOwnership — select from bots)
 * Any subsequent calls (e.g. per-step look-ups in reportSteps) resolve to [].
 */
function setupGetExecutionDirectMocks(
  db: ReturnType<typeof mockDb>,
  execution:
    | typeof EXECUTION_WITH_TASKCAST
    | typeof EXECUTION_WITHOUT_TASKCAST
    | typeof EXECUTION_TERMINAL,
) {
  db.limit
    .mockResolvedValueOnce([execution] as any)
    .mockResolvedValueOnce([TASK] as any)
    .mockResolvedValueOnce([BOT] as any);
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('RoutineBotService — TaskCast integration', () => {
  let service: RoutineBotService;
  let db: ReturnType<typeof mockDb>;
  let wsGateway: { broadcastToWorkspace: MockFn };
  let taskCastService: { publishEvent: MockFn; transitionStatus: MockFn };

  beforeEach(async () => {
    db = mockDb();
    wsGateway = {
      broadcastToWorkspace: jest.fn<any>().mockResolvedValue(undefined),
    };
    taskCastService = {
      publishEvent: jest.fn<any>().mockResolvedValue(undefined),
      transitionStatus: jest.fn<any>().mockResolvedValue(undefined),
    };

    // RoutinesService is injected by RoutineBotService — provide a minimal mock
    const routinesServiceMock = {
      getById: jest.fn<any>().mockResolvedValue(null),
      updateByBot: jest.fn<any>().mockResolvedValue(null),
      create: jest.fn<any>().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoutineBotService,
        { provide: DATABASE_CONNECTION, useValue: db },
        { provide: WEBSOCKET_GATEWAY, useValue: wsGateway },
        { provide: TaskCastService, useValue: taskCastService },
        { provide: RoutinesService, useValue: routinesServiceMock },
      ],
    }).compile();

    service = module.get<RoutineBotService>(RoutineBotService);
  });

  // ── reportSteps ──────────────────────────────────────────────────

  describe('reportSteps', () => {
    const dto = {
      steps: [{ orderIndex: 0, title: 'Step 1', status: 'completed' as const }],
    };

    /**
     * Helper: configure db.where so that calls #1-3 (getExecutionDirect) and
     * call #4 (per-step lookup) return the chain (enabling .limit() chaining),
     * while call #5 (sum query — no trailing .limit/.orderBy) returns a
     * resolved Promise with [{ total: 0 }], and calls #6+ (update where,
     * final select where) return the chain again.
     *
     * where call map for reportSteps with one step (no existing):
     *   #1  getExecutionDirect: routineExecutions.where → chain → .limit(1)
     *   #2  getExecutionDirect: routines.where → chain → .limit(1)
     *   #3  verifyBotOwnership: bots.where → chain → .limit(1)
     *   #4  step lookup: routineSteps.where(and(...)) → chain → .limit(1)
     *   #5  sum query: routineSteps.where(eq(executionId)) → awaited directly
     *   #6  update execution: routineExecutions.where → chain (awaited as update)
     *   #7  final steps: routineSteps.where → chain → .orderBy()
     */
    function setupReportStepsMocks(db: ReturnType<typeof mockDb>) {
      let whereCallCount = 0;
      db.where.mockImplementation((..._args: any[]) => {
        whereCallCount++;
        if (whereCallCount === 5) {
          // Sum query — no .limit/.orderBy follows; must be directly awaitable
          return Promise.resolve([{ total: 0 }]) as any;
        }
        return db as any;
      });
    }

    it('calls publishEvent with type "step", seriesId "steps", seriesMode "latest" when taskcastTaskId is set', async () => {
      setupGetExecutionDirectMocks(db, EXECUTION_WITH_TASKCAST);
      setupReportStepsMocks(db);

      await service.reportSteps('task-1', 'exec-1', 'bot-user-1', dto);

      expect(taskCastService.publishEvent).toHaveBeenCalledTimes(1);
      expect(taskCastService.publishEvent).toHaveBeenCalledWith(
        EXECUTION_WITH_TASKCAST.taskcastTaskId,
        expect.objectContaining({
          type: 'step',
          seriesId: 'steps',
          seriesMode: 'latest',
        }),
      );
    });

    it('does NOT call publishEvent when taskcastTaskId is null', async () => {
      setupGetExecutionDirectMocks(db, EXECUTION_WITHOUT_TASKCAST);
      setupReportStepsMocks(db);

      await service.reportSteps('task-1', 'exec-1', 'bot-user-1', dto);

      expect(taskCastService.publishEvent).not.toHaveBeenCalled();
    });
  });

  // ── updateStatus ─────────────────────────────────────────────────

  describe('updateStatus', () => {
    it('calls transitionStatus with the status when taskcastTaskId is set', async () => {
      setupGetExecutionDirectMocks(db, EXECUTION_WITH_TASKCAST);

      db.returning
        .mockResolvedValueOnce([
          { ...EXECUTION_WITH_TASKCAST, status: 'completed' },
        ] as any)
        .mockResolvedValueOnce([{ ...TASK, status: 'completed' }] as any);

      await service.updateStatus('task-1', 'exec-1', 'bot-user-1', 'completed');

      expect(taskCastService.transitionStatus).toHaveBeenCalledTimes(1);
      expect(taskCastService.transitionStatus).toHaveBeenCalledWith(
        EXECUTION_WITH_TASKCAST.taskcastTaskId,
        'completed',
      );
    });

    it('does NOT call transitionStatus when taskcastTaskId is null', async () => {
      setupGetExecutionDirectMocks(db, EXECUTION_WITHOUT_TASKCAST);

      db.returning
        .mockResolvedValueOnce([
          { ...EXECUTION_WITHOUT_TASKCAST, status: 'completed' },
        ] as any)
        .mockResolvedValueOnce([{ ...TASK, status: 'completed' }] as any);

      await service.updateStatus('task-1', 'exec-1', 'bot-user-1', 'completed');

      expect(taskCastService.transitionStatus).not.toHaveBeenCalled();
    });

    it('rejects invalid terminal status values before updating records', async () => {
      setupGetExecutionDirectMocks(db, EXECUTION_WITH_TASKCAST);

      await expect(
        service.updateStatus(
          'task-1',
          'exec-1',
          'bot-user-1',
          'pending_action',
        ),
      ).rejects.toThrow("Invalid status 'pending_action'");

      expect(db.update).not.toHaveBeenCalled();
      expect(wsGateway.broadcastToWorkspace).not.toHaveBeenCalled();
      expect(taskCastService.transitionStatus).not.toHaveBeenCalled();
    });
  });

  // ── createIntervention ───────────────────────────────────────────

  describe('createIntervention', () => {
    const dto = {
      prompt: 'Should I proceed?',
      actions: [{ label: 'Yes', value: 'yes' }],
    };

    it('calls transitionStatus("pending_action") AND publishEvent with type "intervention" when taskcastTaskId is set', async () => {
      setupGetExecutionDirectMocks(db, EXECUTION_WITH_TASKCAST);

      const interventionRow = {
        id: 'intervention-1',
        executionId: 'exec-1',
        taskId: 'task-1',
        prompt: dto.prompt,
        actions: dto.actions,
        stepId: null,
      };
      db.returning.mockResolvedValueOnce([interventionRow] as any);

      await service.createIntervention('task-1', 'exec-1', 'bot-user-1', dto);

      expect(taskCastService.transitionStatus).toHaveBeenCalledTimes(1);
      expect(taskCastService.transitionStatus).toHaveBeenCalledWith(
        EXECUTION_WITH_TASKCAST.taskcastTaskId,
        'pending_action',
      );

      expect(taskCastService.publishEvent).toHaveBeenCalledTimes(1);
      expect(taskCastService.publishEvent).toHaveBeenCalledWith(
        EXECUTION_WITH_TASKCAST.taskcastTaskId,
        expect.objectContaining({
          type: 'intervention',
        }),
      );
    });

    it('does NOT call TaskCast methods when taskcastTaskId is null', async () => {
      setupGetExecutionDirectMocks(db, EXECUTION_WITHOUT_TASKCAST);

      const interventionRow = {
        id: 'intervention-2',
        executionId: 'exec-1',
        taskId: 'task-1',
        prompt: dto.prompt,
        actions: dto.actions,
        stepId: null,
      };
      db.returning.mockResolvedValueOnce([interventionRow] as any);

      await service.createIntervention('task-1', 'exec-1', 'bot-user-1', dto);

      expect(taskCastService.transitionStatus).not.toHaveBeenCalled();
      expect(taskCastService.publishEvent).not.toHaveBeenCalled();
    });
  });

  // ── addDeliverable ───────────────────────────────────────────────

  describe('addDeliverable', () => {
    const deliverableData = {
      fileName: 'report.pdf',
      fileUrl: 'https://example.com/report.pdf',
    };

    it('calls publishEvent with type "deliverable" when taskcastTaskId is set', async () => {
      setupGetExecutionDirectMocks(db, EXECUTION_WITH_TASKCAST);

      const deliverableRow = {
        id: 'deliverable-1',
        executionId: 'exec-1',
        taskId: 'task-1',
        fileName: 'report.pdf',
        fileUrl: 'https://example.com/report.pdf',
        fileSize: null,
        mimeType: null,
      };
      db.returning.mockResolvedValueOnce([deliverableRow] as any);

      await service.addDeliverable(
        'task-1',
        'exec-1',
        'bot-user-1',
        deliverableData,
      );

      expect(taskCastService.publishEvent).toHaveBeenCalledTimes(1);
      expect(taskCastService.publishEvent).toHaveBeenCalledWith(
        EXECUTION_WITH_TASKCAST.taskcastTaskId,
        expect.objectContaining({
          type: 'deliverable',
        }),
      );
    });

    it('does NOT call publishEvent when taskcastTaskId is null', async () => {
      setupGetExecutionDirectMocks(db, EXECUTION_WITHOUT_TASKCAST);

      const deliverableRow = {
        id: 'deliverable-2',
        executionId: 'exec-1',
        taskId: 'task-1',
        fileName: 'report.pdf',
        fileUrl: 'https://example.com/report.pdf',
        fileSize: null,
        mimeType: null,
      };
      db.returning.mockResolvedValueOnce([deliverableRow] as any);

      await service.addDeliverable(
        'task-1',
        'exec-1',
        'bot-user-1',
        deliverableData,
      );

      expect(taskCastService.publishEvent).not.toHaveBeenCalled();
    });
  });

  // ── getRoutineDocument ──────────────────────────────────────────────

  describe('getRoutineDocument', () => {
    it('returns null when the task has no linked document', async () => {
      setupGetExecutionDirectMocks(db, EXECUTION_WITH_TASKCAST);

      await expect(
        service.getRoutineDocument('task-1', 'exec-1', 'bot-user-1'),
      ).resolves.toBeNull();

      expect(db.select).toHaveBeenCalledTimes(3);
    });

    it('throws when the linked document cannot be found', async () => {
      db.limit
        .mockResolvedValueOnce([EXECUTION_WITH_TASKCAST] as any)
        .mockResolvedValueOnce([{ ...TASK, documentId: 'doc-1' }] as any)
        .mockResolvedValueOnce([BOT] as any)
        .mockResolvedValueOnce([] as any);

      await expect(
        service.getRoutineDocument('task-1', 'exec-1', 'bot-user-1'),
      ).rejects.toThrow('Document not found');
    });

    it('returns document metadata with a null currentVersion when no version is linked', async () => {
      db.limit
        .mockResolvedValueOnce([EXECUTION_WITH_TASKCAST] as any)
        .mockResolvedValueOnce([{ ...TASK, documentId: 'doc-1' }] as any)
        .mockResolvedValueOnce([BOT] as any)
        .mockResolvedValueOnce([
          {
            id: 'doc-1',
            title: 'Runbook',
            documentType: 'text',
            currentVersionId: null,
          },
        ] as any);

      await expect(
        service.getRoutineDocument('task-1', 'exec-1', 'bot-user-1'),
      ).resolves.toEqual({
        id: 'doc-1',
        title: 'Runbook',
        documentType: 'text',
        currentVersion: null,
      });
    });

    it('hydrates the current document version when one is linked', async () => {
      db.limit
        .mockResolvedValueOnce([EXECUTION_WITH_TASKCAST] as any)
        .mockResolvedValueOnce([{ ...TASK, documentId: 'doc-1' }] as any)
        .mockResolvedValueOnce([BOT] as any)
        .mockResolvedValueOnce([
          {
            id: 'doc-1',
            title: 'Runbook',
            documentType: 'text',
            currentVersionId: 'ver-1',
          },
        ] as any)
        .mockResolvedValueOnce([
          {
            id: 'ver-1',
            versionIndex: 3,
            content: 'latest content',
            summary: 'latest summary',
            createdAt: new Date('2026-04-01T10:00:00.000Z'),
          },
        ] as any);

      await expect(
        service.getRoutineDocument('task-1', 'exec-1', 'bot-user-1'),
      ).resolves.toEqual({
        id: 'doc-1',
        title: 'Runbook',
        documentType: 'text',
        currentVersion: {
          id: 'ver-1',
          versionIndex: 3,
          content: 'latest content',
          summary: 'latest summary',
          createdAt: new Date('2026-04-01T10:00:00.000Z'),
        },
      });
    });

    it('rejects read access when the bot does not own the task', async () => {
      db.limit
        .mockResolvedValueOnce([EXECUTION_WITH_TASKCAST] as any)
        .mockResolvedValueOnce([{ ...TASK, documentId: 'doc-1' }] as any)
        .mockResolvedValueOnce([{ userId: 'different-bot-user' }] as any);

      await expect(
        service.getRoutineDocument('task-1', 'exec-1', 'bot-user-1'),
      ).rejects.toThrow('Bot does not own this routine');
    });
  });

  // ── Terminal execution rejection ─────────────────────────────────

  describe('getExecutionDirect — terminal status rejection', () => {
    it('rejects reportSteps on a completed execution with ConflictException', async () => {
      // execution lookup returns terminal status
      db.limit.mockResolvedValueOnce([EXECUTION_TERMINAL] as any);

      const dto = {
        steps: [
          { orderIndex: 0, title: 'Step 1', status: 'completed' as const },
        ],
      };

      await expect(
        service.reportSteps('task-1', 'exec-1', 'bot-user-1', dto),
      ).rejects.toThrow(
        'Cannot write to execution in terminal status: completed',
      );
    });

    it('rejects updateStatus on a completed execution with ConflictException', async () => {
      db.limit.mockResolvedValueOnce([EXECUTION_TERMINAL] as any);

      await expect(
        service.updateStatus('task-1', 'exec-1', 'bot-user-1', 'failed'),
      ).rejects.toThrow(
        'Cannot write to execution in terminal status: completed',
      );
    });

    it('rejects createIntervention on a completed execution with ConflictException', async () => {
      db.limit.mockResolvedValueOnce([EXECUTION_TERMINAL] as any);

      const dto = {
        prompt: 'Should I proceed?',
        actions: [{ label: 'Yes', value: 'yes' }],
      };

      await expect(
        service.createIntervention('task-1', 'exec-1', 'bot-user-1', dto),
      ).rejects.toThrow(
        'Cannot write to execution in terminal status: completed',
      );
    });

    it('rejects addDeliverable on a completed execution with ConflictException', async () => {
      db.limit.mockResolvedValueOnce([EXECUTION_TERMINAL] as any);

      await expect(
        service.addDeliverable('task-1', 'exec-1', 'bot-user-1', {
          fileName: 'report.pdf',
          fileUrl: 'https://example.com/report.pdf',
        }),
      ).rejects.toThrow(
        'Cannot write to execution in terminal status: completed',
      );
    });
  });

  // ── Execution not found ──────────────────────────────────────────

  describe('getExecutionDirect — execution not found', () => {
    it('throws NotFoundException when execution does not exist', async () => {
      // limit returns empty (no execution found)
      db.limit.mockResolvedValueOnce([] as any);

      await expect(
        service.reportSteps('task-1', 'nonexistent-exec', 'bot-user-1', {
          steps: [
            { orderIndex: 0, title: 'Step 1', status: 'completed' as const },
          ],
        }),
      ).rejects.toThrow('Execution not found for this routine');
    });
  });
});

// ── CRUD proxy methods ────────────────────────────────────────────────

describe('RoutineBotService — CRUD proxy methods', () => {
  let service: RoutineBotService;
  let db: ReturnType<typeof mockDb>;
  let routinesService: {
    getById: MockFn;
    updateByBot: MockFn;
    create: MockFn;
  };
  let taskCastService: { publishEvent: MockFn; transitionStatus: MockFn };

  const ROUTINE_ROW = {
    id: 'routine-1',
    tenantId: 'tenant-1',
    botId: 'bot-1',
    creatorId: 'user-1',
    title: 'My Routine',
    documentId: 'doc-1',
    status: 'draft',
    currentExecutionId: null,
  };

  beforeEach(async () => {
    db = mockDb();
    routinesService = {
      getById: jest.fn<any>().mockResolvedValue({
        ...ROUTINE_ROW,
        currentExecution: null,
      }),
      updateByBot: jest.fn<any>().mockResolvedValue(ROUTINE_ROW),
      create: jest.fn<any>().mockResolvedValue(ROUTINE_ROW),
    };
    taskCastService = {
      publishEvent: jest.fn<any>().mockResolvedValue(undefined),
      transitionStatus: jest.fn<any>().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoutineBotService,
        { provide: DATABASE_CONNECTION, useValue: db },
        { provide: WEBSOCKET_GATEWAY, useValue: { broadcastToWorkspace: jest.fn<any>() } },
        { provide: TaskCastService, useValue: taskCastService },
        { provide: RoutinesService, useValue: routinesService },
      ],
    }).compile();

    service = module.get<RoutineBotService>(RoutineBotService);
  });

  // ── createRoutine resolves bots.id and creatorId ─────────────────

  describe('createRoutine', () => {
    // Use a factory to avoid mutation across tests — createRoutine mutates dto.botId in-place
    const makeDto = () => ({ title: 'My Routine', status: 'draft' as const });

    it('resolves bots.id from shadow user and passes it as botId', async () => {
      // db.limit call #1: bots lookup by userId
      db.limit.mockResolvedValueOnce([
        { id: 'bots-uuid-1', mentorId: 'mentor-user-1', ownerId: null },
      ] as any);

      await service.createRoutine(makeDto(), 'shadow-user-1', 'tenant-1');

      // routinesService.create must receive the resolved bots.id, not the shadow user id
      expect(routinesService.create).toHaveBeenCalledWith(
        expect.objectContaining({ botId: 'bots-uuid-1' }),
        'mentor-user-1',
        'tenant-1',
      );
    });

    it('uses mentorId as creatorId when bot has a mentor', async () => {
      db.limit.mockResolvedValueOnce([
        { id: 'bots-uuid-1', mentorId: 'mentor-user-1', ownerId: 'owner-user-1' },
      ] as any);

      await service.createRoutine(makeDto(), 'shadow-user-1', 'tenant-1');

      expect(routinesService.create).toHaveBeenCalledWith(
        expect.anything(),
        'mentor-user-1',
        'tenant-1',
      );
    });

    it('falls back to ownerId as creatorId when bot has no mentor', async () => {
      db.limit.mockResolvedValueOnce([
        { id: 'bots-uuid-1', mentorId: null, ownerId: 'owner-user-1' },
      ] as any);

      await service.createRoutine(makeDto(), 'shadow-user-1', 'tenant-1');

      expect(routinesService.create).toHaveBeenCalledWith(
        expect.anything(),
        'owner-user-1',
        'tenant-1',
      );
    });

    it('falls back to botUserId as creatorId when bot has neither mentor nor owner', async () => {
      db.limit.mockResolvedValueOnce([
        { id: 'bots-uuid-1', mentorId: null, ownerId: null },
      ] as any);

      await service.createRoutine(makeDto(), 'shadow-user-1', 'tenant-1');

      expect(routinesService.create).toHaveBeenCalledWith(
        expect.anything(),
        'shadow-user-1',
        'tenant-1',
      );
    });

    it('does not override an explicit botId provided in the DTO when it belongs to the same tenant', async () => {
      // limit call #1: callerBot lookup by userId
      // limit call #2: targetBot lookup via bots JOIN installedApplications (leftJoin path)
      db.limit
        .mockResolvedValueOnce([
          { id: 'bots-uuid-resolved', mentorId: 'mentor-user-1', ownerId: null },
        ] as any)
        .mockResolvedValueOnce([
          { id: 'explicit-bot-id', tenantId: 'tenant-1' },
        ] as any);
      const dtoWithBotId = { ...makeDto(), botId: 'explicit-bot-id' };

      await service.createRoutine(dtoWithBotId, 'shadow-user-1', 'tenant-1');

      expect(routinesService.create).toHaveBeenCalledWith(
        expect.objectContaining({ botId: 'explicit-bot-id' }),
        expect.anything(),
        expect.anything(),
      );
    });

    it('throws BadRequestException when explicit botId is not found', async () => {
      const { BadRequestException } = await import('@nestjs/common');

      // limit call #1: callerBot lookup
      // limit call #2: targetBot lookup returns empty
      db.limit
        .mockResolvedValueOnce([
          { id: 'bots-uuid-resolved', mentorId: 'mentor-user-1', ownerId: null },
        ] as any)
        .mockResolvedValueOnce([] as any);
      const dtoWithBotId = { ...makeDto(), botId: 'nonexistent-bot' };

      await expect(
        service.createRoutine(dtoWithBotId, 'shadow-user-1', 'tenant-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ForbiddenException when explicit botId belongs to a different tenant', async () => {
      const { ForbiddenException } = await import('@nestjs/common');

      // limit call #1: callerBot lookup
      // limit call #2: targetBot belongs to different tenant
      db.limit
        .mockResolvedValueOnce([
          { id: 'bots-uuid-resolved', mentorId: 'mentor-user-1', ownerId: null },
        ] as any)
        .mockResolvedValueOnce([
          { id: 'cross-tenant-bot', tenantId: 'other-tenant' },
        ] as any);
      const dtoWithBotId = { ...makeDto(), botId: 'cross-tenant-bot' };

      await expect(
        service.createRoutine(dtoWithBotId, 'shadow-user-1', 'tenant-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when caller bot row is not found', async () => {
      const { NotFoundException } = await import('@nestjs/common');

      db.limit.mockResolvedValueOnce([] as any);

      await expect(
        service.createRoutine(makeDto(), 'shadow-user-1', 'tenant-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── updateRoutine delegates to updateByBot ────────────────────────

  describe('updateRoutine', () => {
    it('delegates to routinesService.updateByBot with the correct arguments', async () => {
      const dto = { title: 'New Title' } as never;
      routinesService.updateByBot.mockResolvedValueOnce({ ...ROUTINE_ROW, title: 'New Title' } as any);

      const result = await service.updateRoutine('routine-1', dto, 'bot-user-1', 'tenant-1');

      expect(routinesService.updateByBot).toHaveBeenCalledWith(
        'routine-1',
        dto,
        'bot-user-1',
        'tenant-1',
      );
      expect(result).toMatchObject({ title: 'New Title' });
    });

    it('propagates ForbiddenException from updateByBot when bot is not assigned', async () => {
      const { ForbiddenException } = await import('@nestjs/common');
      routinesService.updateByBot.mockRejectedValueOnce(
        new ForbiddenException('Bot is not the assigned agent for this routine') as any,
      );

      await expect(
        service.updateRoutine('routine-1', {} as never, 'wrong-bot-user', 'tenant-1'),
      ).rejects.toThrow('Bot is not the assigned agent for this routine');
    });
  });

  // ── getRoutineById enriches with documentContent and triggers ────────

  describe('getRoutineById', () => {
    // ROUTINE_ROW.botId is 'bot-1', so callerBot must have id: 'bot-1' to pass
    // ownership check. The signature is getRoutineById(routineId, botUserId, tenantId).
    const CALLER_BOT = { id: 'bot-1' };

    it('returns documentContent from the linked document when available', async () => {
      const doc = { id: 'doc-1', currentVersionId: 'ver-1' };
      const ver = { content: 'Do the thing every day.' };

      // limit call #1: callerBot lookup
      // limit call #2: document lookup
      // limit call #3: version lookup
      db.limit
        .mockResolvedValueOnce([CALLER_BOT] as any)
        .mockResolvedValueOnce([doc] as any)
        .mockResolvedValueOnce([ver] as any);

      const result = await service.getRoutineById('routine-1', 'bot-user-1', 'tenant-1');

      expect(result.documentContent).toBe('Do the thing every day.');
    });

    it('returns documentContent as null when the routine has no linked document', async () => {
      routinesService.getById.mockResolvedValueOnce({
        ...ROUTINE_ROW,
        documentId: null,
        currentExecution: null,
      } as any);

      // limit call #1: callerBot lookup only (no document fetching since documentId is null)
      db.limit.mockResolvedValueOnce([CALLER_BOT] as any);

      const result = await service.getRoutineById('routine-1', 'bot-user-1', 'tenant-1');

      expect(result.documentContent).toBeNull();
      // Only the callerBot lookup should have happened
      expect(db.limit).toHaveBeenCalledTimes(1);
    });

    it('returns documentContent as null when the document has no currentVersionId', async () => {
      const doc = { id: 'doc-1', currentVersionId: null };

      // limit call #1: callerBot lookup
      // limit call #2: document lookup (returns doc with no currentVersionId)
      db.limit
        .mockResolvedValueOnce([CALLER_BOT] as any)
        .mockResolvedValueOnce([doc] as any);

      const result = await service.getRoutineById('routine-1', 'bot-user-1', 'tenant-1');

      expect(result.documentContent).toBeNull();
    });

    it('returns documentContent as null when the document row is missing', async () => {
      // limit call #1: callerBot lookup
      // limit call #2: document lookup returns empty
      db.limit
        .mockResolvedValueOnce([CALLER_BOT] as any)
        .mockResolvedValueOnce([] as any);

      const result = await service.getRoutineById('routine-1', 'bot-user-1', 'tenant-1');

      expect(result.documentContent).toBeNull();
    });

    it('returns documentContent as null (non-fatal) when DB throws during lookup', async () => {
      // limit call #1: callerBot lookup succeeds
      // limit call #2: document lookup throws
      db.limit
        .mockResolvedValueOnce([CALLER_BOT] as any)
        .mockRejectedValueOnce(new Error('DB error') as any);

      const result = await service.getRoutineById('routine-1', 'bot-user-1', 'tenant-1');

      expect(result.documentContent).toBeNull();
    });

    it('spreads all routine fields alongside documentContent and triggers', async () => {
      const doc = { id: 'doc-1', currentVersionId: 'ver-1' };
      db.limit
        .mockResolvedValueOnce([CALLER_BOT] as any)
        .mockResolvedValueOnce([doc] as any)
        .mockResolvedValueOnce([{ content: 'instructions' }] as any);

      const result = await service.getRoutineById('routine-1', 'bot-user-1', 'tenant-1');

      expect(result).toMatchObject({
        id: 'routine-1',
        title: 'My Routine',
        documentContent: 'instructions',
      });
      expect(result).toHaveProperty('triggers');
    });

    it('throws ForbiddenException when the calling bot is not the assigned bot', async () => {
      const { ForbiddenException } = await import('@nestjs/common');

      // callerBot has a different id from ROUTINE_ROW.botId ('bot-1')
      db.limit.mockResolvedValueOnce([{ id: 'different-bot-id' }] as any);

      await expect(
        service.getRoutineById('routine-1', 'wrong-bot-user', 'tenant-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when callerBot row is not found', async () => {
      const { ForbiddenException } = await import('@nestjs/common');

      db.limit.mockResolvedValueOnce([] as any);

      await expect(
        service.getRoutineById('routine-1', 'nonexistent-bot-user', 'tenant-1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
