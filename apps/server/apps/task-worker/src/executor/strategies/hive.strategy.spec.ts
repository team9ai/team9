import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { ExecutionContext } from '../execution-strategy.interface.js';

// ── DB mock ────────────────────────────────────────────────────────────

const mockDb: any = {
  select: jest.fn<any>(),
  from: jest.fn<any>(),
  where: jest.fn<any>(),
  limit: jest.fn<any>(),
};
mockDb.select.mockReturnValue(mockDb);
mockDb.from.mockReturnValue(mockDb);
mockDb.where.mockReturnValue(mockDb);

// ── ClawHiveService mock ───────────────────────────────────────────────

const mockClawHive = {
  sendInput: jest.fn<any>().mockResolvedValue({ messages: [] }),
  interruptSession: jest.fn<any>().mockResolvedValue(undefined),
  deleteSession: jest.fn<any>().mockResolvedValue(undefined),
};

// ── Base context ───────────────────────────────────────────────────────

const baseContext: ExecutionContext = {
  taskId: 'task-001',
  executionId: 'exec-001',
  botId: 'bot-001',
  channelId: 'ch-task-001',
  title: 'Write a report',
  documentContent: 'Research and write about AI trends',
  taskcastTaskId: 'agent_task_exec_exec-001',
  tenantId: 'tenant-abc',
};

function makeBot(agentId: string) {
  return { managedMeta: { agentId } };
}

function resetDbChain(result: any[] = []) {
  mockDb.select.mockReturnValue(mockDb);
  mockDb.from.mockReturnValue(mockDb);
  mockDb.where.mockReturnValue(mockDb);
  mockDb.limit.mockReturnValue(Promise.resolve(result));
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('HiveStrategy', () => {
  let HiveStrategy: any;
  let strategy: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    resetDbChain([makeBot('my-agent')]);
    ({ HiveStrategy } = await import('./hive.strategy.js'));
    strategy = new HiveStrategy(mockDb, mockClawHive);
  });

  // ── execute() ──────────────────────────────────────────────────────

  describe('execute()', () => {
    it('calls sendInput with team9:task.start and correct session ID', async () => {
      await strategy.execute(baseContext);

      expect(mockClawHive.sendInput).toHaveBeenCalledWith(
        'team9/tenant-abc/my-agent/task/task-001',
        expect.objectContaining({
          type: 'team9:task.start',
          source: 'team9',
          payload: expect.objectContaining({
            taskId: 'task-001',
            executionId: 'exec-001',
            channelId: 'ch-task-001',
            title: 'Write a report',
            documentContent: 'Research and write about AI trends',
          }),
        }),
        'tenant-abc',
      );
    });

    it('throws when bot has no managedMeta.agentId', async () => {
      resetDbChain([{ managedMeta: {} }]);

      await expect(strategy.execute(baseContext)).rejects.toThrow(
        'Hive agentId not configured for bot bot-001',
      );
      expect(mockClawHive.sendInput).not.toHaveBeenCalled();
    });

    it('throws when bot is not found', async () => {
      resetDbChain([]);

      await expect(strategy.execute(baseContext)).rejects.toThrow(
        'Hive bot not found: bot-001',
      );
    });

    it('includes location with type "task" in payload', async () => {
      await strategy.execute(baseContext);

      const payload = (mockClawHive.sendInput.mock.calls[0] as any[])[1]
        .payload;
      expect(payload.location).toEqual({ type: 'task', id: 'ch-task-001' });
    });

    it('omits documentContent from payload when undefined', async () => {
      const ctxNoDoc: ExecutionContext = {
        ...baseContext,
        documentContent: undefined,
      };
      await strategy.execute(ctxNoDoc);

      const payload = (mockClawHive.sendInput.mock.calls[0] as any[])[1]
        .payload;
      expect(payload.documentContent).toBeUndefined();
    });
  });

  // ── pause() ────────────────────────────────────────────────────────

  describe('pause()', () => {
    it('calls interruptSession with correct session ID and tenantId', async () => {
      await strategy.pause(baseContext);

      expect(mockClawHive.interruptSession).toHaveBeenCalledWith(
        'team9/tenant-abc/my-agent/task/task-001',
        'tenant-abc',
      );
    });

    it('throws when bot has no agentId', async () => {
      resetDbChain([{ managedMeta: null }]);
      await expect(strategy.pause(baseContext)).rejects.toThrow();
    });

    it('does not throw when interruptSession fails (session may have ended)', async () => {
      mockClawHive.interruptSession.mockRejectedValueOnce(
        new Error('Failed to interrupt session: 404'),
      );

      // Should resolve (not throw)
      await expect(strategy.pause(baseContext)).resolves.toBeUndefined();
    });
  });

  // ── resume() ───────────────────────────────────────────────────────

  describe('resume()', () => {
    it('sends team9:task.resume event', async () => {
      await strategy.resume({ ...baseContext, message: 'Please continue' });

      expect(mockClawHive.sendInput).toHaveBeenCalledWith(
        'team9/tenant-abc/my-agent/task/task-001',
        expect.objectContaining({
          type: 'team9:task.resume',
          payload: expect.objectContaining({
            taskId: 'task-001',
            executionId: 'exec-001',
            message: 'Please continue',
          }),
        }),
        'tenant-abc',
      );
    });

    it('resume message is undefined when not provided', async () => {
      await strategy.resume(baseContext); // no message field

      const payload = (mockClawHive.sendInput.mock.calls[0] as any[])[1]
        .payload;
      expect(payload.message).toBeUndefined();
    });
  });

  // ── stop() ─────────────────────────────────────────────────────────

  describe('stop()', () => {
    it('calls deleteSession with correct session ID and tenantId', async () => {
      await strategy.stop(baseContext);

      expect(mockClawHive.deleteSession).toHaveBeenCalledWith(
        'team9/tenant-abc/my-agent/task/task-001',
        'tenant-abc',
      );
    });

    it('throws when bot has no agentId', async () => {
      resetDbChain([{ managedMeta: {} }]);
      await expect(strategy.stop(baseContext)).rejects.toThrow(
        'Hive agentId not configured for bot bot-001',
      );
      expect(mockClawHive.deleteSession).not.toHaveBeenCalled();
    });
  });
});
