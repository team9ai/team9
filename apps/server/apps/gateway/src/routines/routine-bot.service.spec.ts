import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { RoutineBotService } from './routine-bot.service.js';
import { TaskCastService } from './taskcast.service.js';

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
    'delete',
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

  beforeEach(() => {
    db = mockDb();
    wsGateway = {
      broadcastToWorkspace: jest.fn<any>().mockResolvedValue(undefined),
    };
    taskCastService = {
      publishEvent: jest.fn<any>().mockResolvedValue(undefined),
      transitionStatus: jest.fn<any>().mockResolvedValue(undefined),
    };

    // Directly instantiate with stub implementations for new dependencies
    service = new RoutineBotService(
      db as never,
      wsGateway as never,
      taskCastService as never,
      {} as never, // documentsService — not used in TaskCast tests
      {} as never, // routineTriggersService — not used in TaskCast tests
    );
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

// ── RoutineBotService — Routine CRUD (bot-scoped) ─────────────────────

describe('RoutineBotService — Routine CRUD (bot-scoped)', () => {
  let service: RoutineBotService;
  let db: ReturnType<typeof mockDb>;
  let wsGateway: { broadcastToWorkspace: MockFn };
  let taskCastService: { publishEvent: MockFn; transitionStatus: MockFn };
  let documentsService: { create: MockFn; getById: MockFn; update: MockFn };
  let routineTriggersService: { listByRoutine: MockFn; replaceAllForRoutine: MockFn };

  const BOT_ROW = { id: 'bot-1', userId: 'bot-user-1', ownerId: 'owner-user-1', mentorId: null };
  const ROUTINE_ROW = {
    id: 'routine-1',
    tenantId: 'tenant-1',
    botId: 'bot-1',
    creatorId: 'owner-user-1',
    title: 'My Routine',
    documentId: 'doc-1',
    status: 'draft',
  };

  beforeEach(() => {
    db = mockDb();
    wsGateway = { broadcastToWorkspace: jest.fn<any>().mockResolvedValue(undefined) };
    taskCastService = {
      publishEvent: jest.fn<any>().mockResolvedValue(undefined),
      transitionStatus: jest.fn<any>().mockResolvedValue(undefined),
    };
    documentsService = {
      create: jest.fn<any>().mockResolvedValue({ id: 'doc-1' }),
      getById: jest.fn<any>().mockResolvedValue({ content: 'doc content' }),
      update: jest.fn<any>().mockResolvedValue(undefined),
    };
    routineTriggersService = {
      listByRoutine: jest.fn<any>().mockResolvedValue([]),
      replaceAllForRoutine: jest.fn<any>().mockResolvedValue(undefined),
    };

    // Directly instantiate to avoid NestJS DI token resolution issues in test
    service = new RoutineBotService(
      db as never,
      wsGateway as never,
      taskCastService as never,
      documentsService as never,
      routineTriggersService as never,
    );
  });

  // ── createRoutine ─────────────────────────────────────────────────

  describe('createRoutine', () => {
    it('resolves bot from botUserId, uses ownerId as creatorId, creates routine', async () => {
      // Bot lookup by shadow userId
      db.limit.mockResolvedValueOnce([BOT_ROW] as any);
      // Doc creation
      documentsService.create.mockResolvedValueOnce({ id: 'doc-1' } as any);
      // Routine insert
      db.returning.mockResolvedValueOnce([ROUTINE_ROW] as any);

      const result = await service.createRoutine(
        { title: 'My Routine' },
        'bot-user-1',
        'tenant-1',
      );

      expect(result).toEqual(ROUTINE_ROW);
      expect(documentsService.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'My Routine' }),
        { type: 'user', id: 'owner-user-1' },
        'tenant-1',
      );
    });

    it('uses mentorId over ownerId when mentorId is set', async () => {
      const botWithMentor = { ...BOT_ROW, mentorId: 'mentor-user-1' };
      db.limit.mockResolvedValueOnce([botWithMentor] as any);
      documentsService.create.mockResolvedValueOnce({ id: 'doc-1' } as any);
      db.returning.mockResolvedValueOnce([ROUTINE_ROW] as any);

      await service.createRoutine({ title: 'My Routine' }, 'bot-user-1', 'tenant-1');

      expect(documentsService.create).toHaveBeenCalledWith(
        expect.any(Object),
        { type: 'user', id: 'mentor-user-1' },
        'tenant-1',
      );
    });

    it('throws NotFoundException when bot is not found', async () => {
      db.limit.mockResolvedValueOnce([] as any);

      await expect(
        service.createRoutine({ title: 'My Routine' }, 'bot-user-1', 'tenant-1'),
      ).rejects.toThrow(NotFoundException);

      expect(documentsService.create).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when bot has neither mentorId nor ownerId', async () => {
      const orphanBot = { ...BOT_ROW, ownerId: null, mentorId: null };
      db.limit.mockResolvedValueOnce([orphanBot] as any);

      await expect(
        service.createRoutine({ title: 'My Routine' }, 'bot-user-1', 'tenant-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── getRoutineById ────────────────────────────────────────────────

  describe('getRoutineById', () => {
    it('returns routine enriched with documentContent and triggers', async () => {
      // getRoutineOrThrow: routine lookup
      db.limit
        .mockResolvedValueOnce([ROUTINE_ROW] as any)
        // verifyBotOwnership: bot lookup
        .mockResolvedValueOnce([BOT_ROW] as any);

      documentsService.getById.mockResolvedValueOnce({ content: 'my content' } as any);
      routineTriggersService.listByRoutine.mockResolvedValueOnce([{ id: 'trigger-1' }] as any);

      const result = await service.getRoutineById('routine-1', 'bot-user-1', 'tenant-1');

      expect(result).toMatchObject({
        id: 'routine-1',
        documentContent: 'my content',
        triggers: [{ id: 'trigger-1' }],
      });
    });

    it('throws NotFoundException when routine not found', async () => {
      db.limit.mockResolvedValueOnce([] as any);

      await expect(
        service.getRoutineById('nonexistent', 'bot-user-1', 'tenant-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when bot does not own the routine', async () => {
      db.limit
        .mockResolvedValueOnce([ROUTINE_ROW] as any)
        // verifyBotOwnership: returns a bot with different userId
        .mockResolvedValueOnce([{ userId: 'different-bot-user' }] as any);

      await expect(
        service.getRoutineById('routine-1', 'bot-user-1', 'tenant-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('returns empty documentContent when documentsService throws', async () => {
      db.limit
        .mockResolvedValueOnce([ROUTINE_ROW] as any)
        .mockResolvedValueOnce([BOT_ROW] as any);

      documentsService.getById.mockRejectedValueOnce(new Error('not found') as any);
      routineTriggersService.listByRoutine.mockResolvedValueOnce([] as any);

      const result = await service.getRoutineById('routine-1', 'bot-user-1', 'tenant-1');

      expect(result.documentContent).toBe('');
    });
  });

  // ── updateRoutine ─────────────────────────────────────────────────

  describe('updateRoutine', () => {
    it('updates routine and returns updated record', async () => {
      db.limit
        .mockResolvedValueOnce([ROUTINE_ROW] as any)
        .mockResolvedValueOnce([BOT_ROW] as any);

      const updatedRoutine = { ...ROUTINE_ROW, title: 'Updated Title' };
      db.returning.mockResolvedValueOnce([updatedRoutine] as any);

      const result = await service.updateRoutine(
        'routine-1',
        { title: 'Updated Title' },
        'bot-user-1',
        'tenant-1',
      );

      expect(result).toEqual(updatedRoutine);
    });

    it('updates documentContent via documentsService', async () => {
      db.limit
        .mockResolvedValueOnce([ROUTINE_ROW] as any)
        .mockResolvedValueOnce([BOT_ROW] as any);

      db.returning.mockResolvedValueOnce([ROUTINE_ROW] as any);

      await service.updateRoutine(
        'routine-1',
        { documentContent: 'new content' },
        'bot-user-1',
        'tenant-1',
      );

      expect(documentsService.update).toHaveBeenCalledWith(
        'doc-1',
        { content: 'new content' },
        { type: 'user', id: 'owner-user-1' },
      );
    });

    it('replaces triggers when provided', async () => {
      db.limit
        .mockResolvedValueOnce([ROUTINE_ROW] as any)
        .mockResolvedValueOnce([BOT_ROW] as any);

      db.returning.mockResolvedValueOnce([ROUTINE_ROW] as any);

      const triggers = [{ type: 'manual', config: {}, enabled: true }];
      await service.updateRoutine(
        'routine-1',
        { triggers } as never,
        'bot-user-1',
        'tenant-1',
      );

      expect(routineTriggersService.replaceAllForRoutine).toHaveBeenCalledWith(
        'routine-1',
        triggers,
        'tenant-1',
      );
    });

    it('throws BadRequestException when trying to change status', async () => {
      db.limit
        .mockResolvedValueOnce([ROUTINE_ROW] as any)
        .mockResolvedValueOnce([BOT_ROW] as any);

      await expect(
        service.updateRoutine(
          'routine-1',
          { status: 'upcoming' },
          'bot-user-1',
          'tenant-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ForbiddenException when bot does not own the routine', async () => {
      db.limit
        .mockResolvedValueOnce([ROUTINE_ROW] as any)
        .mockResolvedValueOnce([{ userId: 'different-bot-user' }] as any);

      await expect(
        service.updateRoutine('routine-1', { title: 'New' }, 'bot-user-1', 'tenant-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when routine does not exist', async () => {
      db.limit.mockResolvedValueOnce([] as any);

      await expect(
        service.updateRoutine('nonexistent', { title: 'X' }, 'bot-user-1', 'tenant-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
