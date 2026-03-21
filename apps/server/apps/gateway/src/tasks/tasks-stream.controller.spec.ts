import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Test, type TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { DATABASE_CONNECTION } from '@team9/database';
import { TasksStreamController } from './tasks-stream.controller.js';

// ── Types ──────────────────────────────────────────────────────────────────

type MockFn = jest.Mock<(...args: any[]) => any>;

// ── DB mock factory ────────────────────────────────────────────────────────

function mockDb() {
  const chain: Record<string, MockFn> = {};
  const methods = ['select', 'from', 'where', 'limit'];
  for (const m of methods) {
    chain[m] = jest.fn<any>().mockReturnValue(chain);
  }
  chain.limit.mockResolvedValue([]);
  return chain;
}

// ── Request / Response helpers ─────────────────────────────────────────────

function mockReq(overrides: Partial<any> = {}) {
  return {
    headers: { authorization: undefined, 'last-event-id': undefined },
    on: jest.fn<any>(),
    ...overrides,
  } as any;
}

function mockRes() {
  const res: any = {
    status: jest.fn<any>().mockReturnThis(),
    json: jest.fn<any>().mockReturnThis(),
    setHeader: jest.fn<any>(),
    flushHeaders: jest.fn<any>(),
    write: jest.fn<any>(),
    end: jest.fn<any>(),
    headersSent: false,
  };
  return res;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Set up the db.limit mock to return different values on sequential calls.
 * Call order:
 *   1st call → execution lookup
 *   2nd call → task lookup
 *   3rd call → membership check
 */
function setupDbSequence(
  db: ReturnType<typeof mockDb>,
  sequence: Array<unknown[]>,
) {
  let callCount = 0;
  db.limit.mockImplementation((_n: number) => {
    const result = sequence[callCount] ?? [];
    callCount++;
    return Promise.resolve(result);
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('TasksStreamController', () => {
  let controller: TasksStreamController;
  let jwtService: { verify: MockFn };
  let db: ReturnType<typeof mockDb>;

  const TASK_ID = 'task-1';
  const EXEC_ID = 'exec-1';
  const USER_ID = 'user-1';
  const TENANT_ID = 'tenant-1';

  beforeEach(async () => {
    db = mockDb();
    jwtService = { verify: jest.fn<any>().mockReturnValue({ sub: USER_ID }) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TasksStreamController],
      providers: [
        { provide: DATABASE_CONNECTION, useValue: db },
        { provide: JwtService, useValue: jwtService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn<any>().mockReturnValue('http://localhost:3721'),
          },
        },
      ],
    }).compile();

    controller = module.get<TasksStreamController>(TasksStreamController);
  });

  // ── Auth: no token ───────────────────────────────────────────────────────

  describe('authentication', () => {
    it('returns 401 when no token is provided (no header, no query param)', async () => {
      const req = mockReq({ headers: { authorization: undefined } });
      const res = mockRes();

      await controller.streamExecution(TASK_ID, EXEC_ID, undefined, req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    });

    it('returns 401 when JWT is invalid (verify throws)', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('invalid signature');
      });

      const req = mockReq({
        headers: { authorization: 'Bearer bad-token' },
      });
      const res = mockRes();

      await controller.streamExecution(TASK_ID, EXEC_ID, undefined, req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token' });
    });

    it('accepts token from Authorization Bearer header', async () => {
      // Provide full DB sequence so the controller proceeds past auth
      setupDbSequence(db, [
        [{ id: EXEC_ID }],
        [{ tenantId: TENANT_ID }],
        [{ id: 'member-1' }],
      ]);

      // Mock fetch to avoid actual network call; return a non-ok response so
      // it exits early after the auth/validation path.
      const mockFetch = jest
        .fn<any>()
        .mockResolvedValue({ ok: false, body: null });
      global.fetch = mockFetch as any;

      const req = mockReq({
        headers: { authorization: 'Bearer valid-token' },
      });
      const res = mockRes();

      await controller.streamExecution(TASK_ID, EXEC_ID, undefined, req, res);

      expect(jwtService.verify).toHaveBeenCalledWith('valid-token');
      // Did not get a 401 — auth passed
      expect(res.status).not.toHaveBeenCalledWith(401);
    });

    it('accepts token from ?token= query param', async () => {
      setupDbSequence(db, [
        [{ id: EXEC_ID }],
        [{ tenantId: TENANT_ID }],
        [{ id: 'member-1' }],
      ]);

      const mockFetch = jest
        .fn<any>()
        .mockResolvedValue({ ok: false, body: null });
      global.fetch = mockFetch as any;

      const req = mockReq({ headers: {} });
      const res = mockRes();

      await controller.streamExecution(
        TASK_ID,
        EXEC_ID,
        'query-token',
        req,
        res,
      );

      expect(jwtService.verify).toHaveBeenCalledWith('query-token');
      expect(res.status).not.toHaveBeenCalledWith(401);
    });
  });

  // ── Execution lookup ─────────────────────────────────────────────────────

  describe('execution lookup', () => {
    it('throws NotFoundException when execution is not found', async () => {
      // First limit() call returns empty → execution not found
      setupDbSequence(db, [[]]);

      const req = mockReq({
        headers: { authorization: 'Bearer valid-token' },
      });
      const res = mockRes();

      await expect(
        controller.streamExecution(TASK_ID, EXEC_ID, undefined, req, res),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── Workspace membership check ───────────────────────────────────────────

  describe('workspace membership', () => {
    it('returns 403 when user is not a workspace member', async () => {
      // execution found, task found with tenantId, membership empty
      setupDbSequence(db, [[{ id: EXEC_ID }], [{ tenantId: TENANT_ID }], []]);

      const req = mockReq({
        headers: { authorization: 'Bearer valid-token' },
      });
      const res = mockRes();

      await controller.streamExecution(TASK_ID, EXEC_ID, undefined, req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden' });
    });

    it('does not return 403 when user is a workspace member', async () => {
      setupDbSequence(db, [
        [{ id: EXEC_ID }],
        [{ tenantId: TENANT_ID }],
        [{ id: 'member-1' }],
      ]);

      const mockFetch = jest
        .fn<any>()
        .mockResolvedValue({ ok: false, body: null });
      global.fetch = mockFetch as any;

      const req = mockReq({
        headers: { authorization: 'Bearer valid-token' },
      });
      const res = mockRes();

      await controller.streamExecution(TASK_ID, EXEC_ID, undefined, req, res);

      expect(res.status).not.toHaveBeenCalledWith(403);
    });
  });

  // ── TaskCast ID computation ──────────────────────────────────────────────

  describe('TaskCast ID computation', () => {
    it('computes deterministic TaskCast ID as agent_task_exec_<execId>', async () => {
      const specificExecId = 'my-execution-id';

      setupDbSequence(db, [
        [{ id: specificExecId }],
        [{ tenantId: TENANT_ID }],
        [{ id: 'member-1' }],
      ]);

      let capturedUrl: string | undefined;
      const mockFetch = jest.fn<any>().mockImplementation((url: string) => {
        capturedUrl = url;
        return Promise.resolve({ ok: false, body: null });
      });
      global.fetch = mockFetch as any;

      const req = mockReq({
        headers: { authorization: 'Bearer valid-token' },
      });
      const res = mockRes();

      await controller.streamExecution(
        TASK_ID,
        specificExecId,
        undefined,
        req,
        res,
      );

      expect(capturedUrl).toContain(`agent_task_exec_${specificExecId}`);
    });
  });
});
