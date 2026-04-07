import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockCreateTask = jest.fn<any>();
const mockTransitionTask = jest.fn<any>();
const mockPublishEvent = jest.fn<any>();

jest.unstable_mockModule('@taskcast/server-sdk', () => ({
  TaskcastServerClient: jest.fn<any>().mockImplementation(() => ({
    createTask: mockCreateTask,
    transitionTask: mockTransitionTask,
    publishEvent: mockPublishEvent,
  })),
}));

const configService = {
  get: jest.fn<any>().mockReturnValue('http://localhost:3721'),
};

describe('TaskCastService', () => {
  let TaskCastService: any;
  let service: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    configService.get.mockReturnValue('http://localhost:3721');

    ({ TaskCastService } = await import('./taskcast.service.js'));
    service = new TaskCastService(configService as any);
  });

  // ── Constructor ────────────────────────────────────────────────────

  describe('constructor', () => {
    it('should create client with baseUrl from ConfigService', async () => {
      const { TaskcastServerClient } = await import('@taskcast/server-sdk');
      expect(TaskcastServerClient).toHaveBeenCalledWith({
        baseUrl: 'http://localhost:3721',
      });
    });

    it('should use the value returned by ConfigService.get for TASKCAST_URL', async () => {
      configService.get.mockReturnValue('http://custom-taskcast:9999');
      const { TaskCastService: Svc } = await import('./taskcast.service.js');
      new Svc(configService as any);
      expect(configService.get).toHaveBeenCalledWith(
        'TASKCAST_URL',
        'http://localhost:3721',
      );
    });
  });

  // ── createTask ─────────────────────────────────────────────────────

  describe('createTask', () => {
    const params = {
      routineId: 'task-abc',
      executionId: 'exec-123',
      botId: 'bot-xyz',
      tenantId: 'tenant-999',
    };

    it('should call SDK createTask with deterministic ID and correct metadata', async () => {
      mockCreateTask.mockResolvedValue({ id: 'agent_task_exec_exec-123' });

      const result = await service.createTask(params);

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
      expect(result).toBe('agent_task_exec_exec-123');
    });

    it('should use provided ttl when specified', async () => {
      mockCreateTask.mockResolvedValue({ id: 'agent_task_exec_exec-123' });

      await service.createTask({ ...params, ttl: 3600 });

      expect(mockCreateTask).toHaveBeenCalledWith(
        expect.objectContaining({ ttl: 3600 }),
      );
    });

    it('should return task.id from the SDK response', async () => {
      mockCreateTask.mockResolvedValue({ id: 'returned-task-id' });

      const result = await service.createTask(params);

      expect(result).toBe('returned-task-id');
    });

    it('should return null when SDK throws (fire-and-forget)', async () => {
      mockCreateTask.mockRejectedValue(new Error('network error'));

      const result = await service.createTask(params);

      expect(result).toBeNull();
    });
  });

  // ── transitionStatus ───────────────────────────────────────────────

  describe('transitionStatus', () => {
    const taskId = 'agent_task_exec_exec-123';

    const statusMappings: Array<[string, string]> = [
      ['in_progress', 'running'],
      ['paused', 'paused'],
      ['pending_action', 'blocked'],
      ['completed', 'completed'],
      ['failed', 'failed'],
      ['timeout', 'timeout'],
      ['stopped', 'cancelled'],
    ];

    for (const [team9Status, taskcastStatus] of statusMappings) {
      it(`should map Team9 status '${team9Status}' to TaskCast status '${taskcastStatus}'`, async () => {
        mockTransitionTask.mockResolvedValue(undefined);

        await service.transitionStatus(taskId, team9Status);

        expect(mockTransitionTask).toHaveBeenCalledWith(taskId, taskcastStatus);
      });
    }

    it('should silently ignore unmapped status (e.g. upcoming)', async () => {
      await service.transitionStatus(taskId, 'upcoming');

      expect(mockTransitionTask).not.toHaveBeenCalled();
    });

    it('should silently ignore other unmapped statuses', async () => {
      await service.transitionStatus(taskId, 'unknown_status');

      expect(mockTransitionTask).not.toHaveBeenCalled();
    });

    it('should catch SDK errors silently and not rethrow', async () => {
      mockTransitionTask.mockRejectedValue(new Error('SDK error'));

      await expect(
        service.transitionStatus(taskId, 'completed'),
      ).resolves.toBeUndefined();
    });
  });

  // ── publishEvent ───────────────────────────────────────────────────

  describe('publishEvent', () => {
    const taskId = 'agent_task_exec_exec-123';

    it('should forward event to SDK with level info', async () => {
      mockPublishEvent.mockResolvedValue(undefined);

      const event = {
        type: 'step.completed',
        data: { step: 1, message: 'done' },
      };

      await service.publishEvent(taskId, event);

      expect(mockPublishEvent).toHaveBeenCalledWith(taskId, {
        type: event.type,
        level: 'info',
        data: event.data,
        seriesId: undefined,
        seriesMode: undefined,
      });
    });

    it('should forward seriesId and seriesMode when provided', async () => {
      mockPublishEvent.mockResolvedValue(undefined);

      const event = {
        type: 'progress',
        data: { pct: 50 },
        seriesId: 'series-001',
        seriesMode: 'latest' as const,
      };

      await service.publishEvent(taskId, event);

      expect(mockPublishEvent).toHaveBeenCalledWith(taskId, {
        type: event.type,
        level: 'info',
        data: event.data,
        seriesId: 'series-001',
        seriesMode: 'latest',
      });
    });

    it('should catch SDK errors silently and not rethrow', async () => {
      mockPublishEvent.mockRejectedValue(new Error('publish failed'));

      await expect(
        service.publishEvent(taskId, { type: 'ev', data: {} }),
      ).resolves.toBeUndefined();
    });
  });

  // ── deleteTask ─────────────────────────────────────────────────────

  describe('deleteTask', () => {
    it('should be a no-op and not throw', async () => {
      await expect(
        service.deleteTask('agent_task_exec_exec-123'),
      ).resolves.toBeUndefined();
    });

    it('should not call any SDK methods', async () => {
      await service.deleteTask('agent_task_exec_exec-123');

      expect(mockCreateTask).not.toHaveBeenCalled();
      expect(mockTransitionTask).not.toHaveBeenCalled();
      expect(mockPublishEvent).not.toHaveBeenCalled();
    });
  });

  // ── static taskcastId ──────────────────────────────────────────────

  describe('static taskcastId', () => {
    it('should return agent_task_exec_ prefixed executionId', () => {
      expect(TaskCastService.taskcastId('exec-123')).toBe(
        'agent_task_exec_exec-123',
      );
    });

    it('should handle arbitrary executionId strings', () => {
      expect(TaskCastService.taskcastId('abc-def-ghi')).toBe(
        'agent_task_exec_abc-def-ghi',
      );
    });

    it('should handle uuid-style executionId', () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      expect(TaskCastService.taskcastId(uuid)).toBe(`agent_task_exec_${uuid}`);
    });
  });
});
