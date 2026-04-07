import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockCreateTask = jest.fn<any>();

jest.unstable_mockModule('@taskcast/server-sdk', () => ({
  TaskcastServerClient: jest.fn<any>().mockImplementation(() => ({
    createTask: mockCreateTask,
  })),
}));

const configService = {
  get: jest.fn<any>().mockReturnValue('http://localhost:3721'),
};

describe('TaskCastClient', () => {
  let TaskCastClient: any;
  let client: any;

  const params = {
    routineId: 'task-abc',
    executionId: 'exec-123',
    botId: 'bot-xyz',
    tenantId: 'tenant-999',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    configService.get.mockReturnValue('http://localhost:3721');

    ({ TaskCastClient } = await import('./taskcast.client.js'));
    client = new TaskCastClient(configService as any);
  });

  // ── createTask ─────────────────────────────────────────────────────

  describe('createTask', () => {
    it('should pass deterministic ID and correct metadata to SDK createTask', async () => {
      mockCreateTask.mockResolvedValue({ id: 'agent_task_exec_exec-123' });

      await client.createTask(params);

      expect(mockCreateTask).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'agent_task_exec_exec-123',
          type: `agent_task.${params.routineId}`,
          ttl: 86400,
          metadata: {
            routineId: params.routineId,
            executionId: params.executionId,
            botId: params.botId,
            tenantId: params.tenantId,
          },
        }),
      );
    });

    it('should return task.id on success', async () => {
      mockCreateTask.mockResolvedValue({ id: 'agent_task_exec_exec-123' });

      const result = await client.createTask(params);

      expect(result).toBe('agent_task_exec_exec-123');
    });

    it('should return null on SDK error (fire-and-forget)', async () => {
      mockCreateTask.mockRejectedValue(new Error('network error'));

      const result = await client.createTask(params);

      expect(result).toBeNull();
    });

    it('should use custom TTL when provided', async () => {
      mockCreateTask.mockResolvedValue({ id: 'agent_task_exec_exec-123' });

      await client.createTask({ ...params, ttl: 3600 });

      expect(mockCreateTask).toHaveBeenCalledWith(
        expect.objectContaining({ ttl: 3600 }),
      );
    });

    it('should default TTL to 86400 when not provided', async () => {
      mockCreateTask.mockResolvedValue({ id: 'agent_task_exec_exec-123' });

      await client.createTask(params);

      expect(mockCreateTask).toHaveBeenCalledWith(
        expect.objectContaining({ ttl: 86400 }),
      );
    });
  });
});
