import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';
import { Test, type TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { WebhookController } from './webhook.controller.js';
import { DATABASE_CONNECTION } from '@team9/database';
import { ConfigService } from '@nestjs/config';

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
  ];
  for (const m of methods) {
    chain[m] = jest.fn<any>().mockReturnValue(chain);
  }
  // Default: no execution found
  chain.limit.mockResolvedValue([]);
  chain.returning.mockResolvedValue([]);
  return chain;
}

const EXEC_ID = 'exec-uuid-1234';
const TASK_ID = 'task-uuid-5678';
const TASKCAST_ID = `agent_task_exec_${EXEC_ID}`;

describe('WebhookController', () => {
  let controller: WebhookController;
  let db: ReturnType<typeof mockDb>;

  const configService = {
    get: jest.fn<any>().mockImplementation((key: string) => {
      if (key === 'TASKCAST_WEBHOOK_SECRET') return 'test-secret';
      return undefined;
    }),
  };

  beforeEach(async () => {
    db = mockDb();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhookController],
      providers: [
        { provide: DATABASE_CONNECTION, useValue: db },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    controller = module.get<WebhookController>(WebhookController);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ──────────────────────────────────────────────────────────────────
  // Webhook secret validation
  // ──────────────────────────────────────────────────────────────────

  describe('webhook secret validation', () => {
    it('rejects request with wrong webhook secret', async () => {
      await expect(
        controller.handleTimeout(
          { taskId: TASKCAST_ID, status: 'timeout' },
          'wrong-secret',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects request with missing webhook secret', async () => {
      await expect(
        controller.handleTimeout(
          { taskId: TASKCAST_ID, status: 'timeout' },
          undefined,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows request with valid webhook secret', async () => {
      // execution not found — just verifying no ForbiddenException
      db.limit.mockResolvedValue([]);

      await expect(
        controller.handleTimeout(
          { taskId: TASKCAST_ID, status: 'timeout' },
          'test-secret',
        ),
      ).resolves.toBeUndefined();
    });

    it('allows request when no webhook secret is configured', async () => {
      const noSecretConfig = {
        get: jest.fn<any>().mockReturnValue(undefined),
      };

      const module: TestingModule = await Test.createTestingModule({
        controllers: [WebhookController],
        providers: [
          { provide: DATABASE_CONNECTION, useValue: db },
          { provide: ConfigService, useValue: noSecretConfig },
        ],
      }).compile();

      const controllerNoSecret =
        module.get<WebhookController>(WebhookController);

      db.limit.mockResolvedValue([]);

      // Should not throw even with no secret header
      await expect(
        controllerNoSecret.handleTimeout(
          { taskId: TASKCAST_ID, status: 'timeout' },
          undefined,
        ),
      ).resolves.toBeUndefined();
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // TaskCast ID parsing
  // ──────────────────────────────────────────────────────────────────

  describe('TaskCast ID parsing', () => {
    it('parses executionId from agent_task_exec_ prefix correctly', async () => {
      db.limit.mockResolvedValue([{ id: EXEC_ID, routineId: TASK_ID }]);

      await controller.handleTimeout(
        { taskId: TASKCAST_ID, status: 'timeout' },
        'test-secret',
      );

      // The where clause on the first select should have been called,
      // meaning the ID was parsed and used for DB lookup
      expect(db.where).toHaveBeenCalled();
    });

    it('returns early for unexpected TaskCast ID format (no prefix)', async () => {
      await controller.handleTimeout(
        { taskId: 'some_other_id_format', status: 'timeout' },
        'test-secret',
      );

      // DB should never be queried for unknown format
      expect(db.select).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // Run lookup
  // ──────────────────────────────────────────────────────────────────

  describe('run lookup', () => {
    it('returns early when task run is not found', async () => {
      db.limit.mockResolvedValue([]);

      await controller.handleTimeout(
        { taskId: TASKCAST_ID, status: 'timeout' },
        'test-secret',
      );

      // update should never be called if the run is absent
      expect(db.update).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // Timeout status update
  // ──────────────────────────────────────────────────────────────────

  describe('timeout status update', () => {
    it('updates task run and routine compatibility rows on valid webhook', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-04-02T10:00:00.000Z'));
      db.limit.mockResolvedValue([{ id: EXEC_ID, routineId: TASK_ID }]);

      await controller.handleTimeout(
        { taskId: TASKCAST_ID, status: 'timeout' },
        'test-secret',
      );

      // update() should be called for task run, legacy execution, and routine.
      expect(db.update).toHaveBeenCalledTimes(3);

      const setCalls = db.set.mock.calls;
      expect(setCalls[0]?.[0]).toMatchObject({
        status: 'timeout',
        completedAt: new Date('2026-04-02T10:00:00.000Z'),
        updatedAt: new Date('2026-04-02T10:00:00.000Z'),
      });
      expect(setCalls[1]?.[0]).toMatchObject({
        status: 'timeout',
        completedAt: new Date('2026-04-02T10:00:00.000Z'),
      });
      expect(setCalls[2]?.[0]).toMatchObject({
        status: 'timeout',
        updatedAt: new Date('2026-04-02T10:00:00.000Z'),
      });
    });

    it('does not update routine status for an independent task run', async () => {
      db.limit.mockResolvedValue([{ id: EXEC_ID, routineId: null }]);

      await controller.handleTimeout(
        { taskId: TASKCAST_ID, status: 'timeout' },
        'test-secret',
      );

      expect(db.update).toHaveBeenCalledTimes(2);
    });
  });
});
