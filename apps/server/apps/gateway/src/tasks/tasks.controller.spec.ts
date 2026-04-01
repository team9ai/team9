import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.unstable_mockModule('@team9/auth', () => ({
  AuthGuard: class AuthGuard {},
  CurrentUser: () => () => undefined,
}));

jest.unstable_mockModule(
  '../common/decorators/current-tenant.decorator.js',
  () => ({
    CurrentTenantId: () => () => undefined,
  }),
);

jest.unstable_mockModule('./tasks.service.js', () => ({
  TasksService: class TasksService {},
}));

jest.unstable_mockModule('./triggers.service.js', () => ({
  TriggersService: class TriggersService {},
}));

const { TasksController } = await import('./tasks.controller.js');

type MockFn = jest.Mock<(...args: any[]) => any>;

describe('TasksController', () => {
  let controller: TasksController;
  let tasksService: Record<string, MockFn>;
  let triggersService: Record<string, MockFn>;

  const taskId = 'task-1';
  const executionId = 'exec-1';
  const interventionId = 'int-1';
  const triggerId = 'trigger-1';
  const tenantId = 'tenant-1';
  const userId = 'user-1';

  const createDto = { title: 'Test task' } as any;
  const updateDto = { title: 'Updated task' } as any;
  const startDto = { notes: 'start notes', triggerId: 'trigger-source' } as any;
  const resumeDto = { message: 'resume message' } as any;
  const stopDto = { reason: 'stop reason' } as any;
  const restartDto = { notes: 'restart notes' } as any;
  const resolveDto = { action: 'approve', message: 'looks good' } as any;
  const triggerDto = { type: 'manual', enabled: true } as any;
  const updateTriggerDto = { enabled: false } as any;
  const retryDto = { executionId, notes: 'retry notes' } as any;

  beforeEach(() => {
    tasksService = {
      create: jest.fn<any>().mockResolvedValue({ id: taskId }),
      list: jest.fn<any>().mockResolvedValue([{ id: taskId }]),
      getById: jest.fn<any>().mockResolvedValue({ id: taskId }),
      update: jest
        .fn<any>()
        .mockResolvedValue({ id: taskId, title: 'Updated task' }),
      delete: jest.fn<any>().mockResolvedValue({ success: true }),
      getExecutions: jest.fn<any>().mockResolvedValue([{ id: executionId }]),
      getExecution: jest.fn<any>().mockResolvedValue({ id: executionId }),
      getExecutionEntries: jest
        .fn<any>()
        .mockResolvedValue([{ type: 'step', data: { id: 'step-1' } }]),
      getDeliverables: jest.fn<any>().mockResolvedValue([{ id: 'del-1' }]),
      getInterventions: jest
        .fn<any>()
        .mockResolvedValue([{ id: interventionId }]),
      start: jest.fn<any>().mockResolvedValue({ success: true }),
      pause: jest.fn<any>().mockResolvedValue({ success: true }),
      resume: jest.fn<any>().mockResolvedValue({ success: true }),
      stop: jest.fn<any>().mockResolvedValue({ success: true }),
      restart: jest.fn<any>().mockResolvedValue({ success: true }),
      resolveIntervention: jest.fn<any>().mockResolvedValue({
        id: interventionId,
        status: 'resolved',
      }),
      retry: jest.fn<any>().mockResolvedValue({ success: true }),
    };

    triggersService = {
      create: jest.fn<any>().mockResolvedValue({ id: triggerId }),
      listByTask: jest.fn<any>().mockResolvedValue([{ id: triggerId }]),
      update: jest
        .fn<any>()
        .mockResolvedValue({ id: triggerId, enabled: false }),
      delete: jest.fn<any>().mockResolvedValue({ success: true }),
    };

    controller = new TasksController(
      tasksService as any,
      triggersService as any,
    );
  });

  describe('CRUD', () => {
    it('forwards create payload, user, and tenant to tasksService.create', async () => {
      const result = await controller.create(createDto, userId, tenantId);

      expect(tasksService.create).toHaveBeenCalledWith(
        createDto,
        userId,
        tenantId,
      );
      expect(result).toEqual({ id: taskId });
    });

    it('forwards tenant filters to tasksService.list', async () => {
      const result = await controller.list(
        tenantId,
        'bot-1',
        'in_progress',
        'once',
      );

      expect(tasksService.list).toHaveBeenCalledWith(tenantId, {
        botId: 'bot-1',
        status: 'in_progress',
        scheduleType: 'once',
      });
      expect(result).toEqual([{ id: taskId }]);
    });

    it('forwards taskId and tenant to tasksService.getById', async () => {
      const result = await controller.getById(taskId, tenantId);

      expect(tasksService.getById).toHaveBeenCalledWith(taskId, tenantId);
      expect(result).toEqual({ id: taskId });
    });

    it('forwards update payload, user, and tenant to tasksService.update', async () => {
      const result = await controller.update(
        taskId,
        updateDto,
        userId,
        tenantId,
      );

      expect(tasksService.update).toHaveBeenCalledWith(
        taskId,
        updateDto,
        userId,
        tenantId,
      );
      expect(result).toEqual({ id: taskId, title: 'Updated task' });
    });

    it('forwards taskId, user, and tenant to tasksService.delete', async () => {
      const result = await controller.delete(taskId, userId, tenantId);

      expect(tasksService.delete).toHaveBeenCalledWith(
        taskId,
        userId,
        tenantId,
      );
      expect(result).toEqual({ success: true });
    });
  });

  describe('execution views', () => {
    it('forwards taskId and tenant to tasksService.getExecutions', async () => {
      const result = await controller.getExecutions(taskId, tenantId);

      expect(tasksService.getExecutions).toHaveBeenCalledWith(taskId, tenantId);
      expect(result).toEqual([{ id: executionId }]);
    });

    it('forwards taskId, executionId, and tenant to tasksService.getExecution', async () => {
      const result = await controller.getExecution(
        taskId,
        executionId,
        tenantId,
      );

      expect(tasksService.getExecution).toHaveBeenCalledWith(
        taskId,
        executionId,
        tenantId,
      );
      expect(result).toEqual({ id: executionId });
    });

    it('forwards taskId, executionId, and tenant to tasksService.getExecutionEntries', async () => {
      const result = await controller.getExecutionEntries(
        taskId,
        executionId,
        tenantId,
      );

      expect(tasksService.getExecutionEntries).toHaveBeenCalledWith(
        taskId,
        executionId,
        tenantId,
      );
      expect(result).toEqual([{ type: 'step', data: { id: 'step-1' } }]);
    });

    it('forwards taskId, executionId, and tenant to tasksService.getDeliverables', async () => {
      const result = await controller.getDeliverables(
        taskId,
        tenantId,
        executionId,
      );

      expect(tasksService.getDeliverables).toHaveBeenCalledWith(
        taskId,
        executionId,
        tenantId,
      );
      expect(result).toEqual([{ id: 'del-1' }]);
    });

    it('forwards taskId and tenant to tasksService.getInterventions', async () => {
      const result = await controller.getInterventions(taskId, tenantId);

      expect(tasksService.getInterventions).toHaveBeenCalledWith(
        taskId,
        tenantId,
      );
      expect(result).toEqual([{ id: interventionId }]);
    });
  });

  describe('task control', () => {
    it('forwards start payload to tasksService.start', async () => {
      const result = await controller.start(taskId, userId, tenantId, startDto);

      expect(tasksService.start).toHaveBeenCalledWith(
        taskId,
        userId,
        tenantId,
        startDto,
      );
      expect(result).toEqual({ success: true });
    });

    it('forwards pause request to tasksService.pause', async () => {
      const result = await controller.pause(taskId, userId, tenantId);

      expect(tasksService.pause).toHaveBeenCalledWith(taskId, userId, tenantId);
      expect(result).toEqual({ success: true });
    });

    it('forwards resume payload to tasksService.resume', async () => {
      const result = await controller.resume(
        taskId,
        userId,
        tenantId,
        resumeDto,
      );

      expect(tasksService.resume).toHaveBeenCalledWith(
        taskId,
        userId,
        tenantId,
        resumeDto,
      );
      expect(result).toEqual({ success: true });
    });

    it('forwards stop payload to tasksService.stop', async () => {
      const result = await controller.stop(taskId, userId, tenantId, stopDto);

      expect(tasksService.stop).toHaveBeenCalledWith(
        taskId,
        userId,
        tenantId,
        stopDto,
      );
      expect(result).toEqual({ success: true });
    });

    it('forwards restart payload to tasksService.restart', async () => {
      const result = await controller.restart(
        taskId,
        userId,
        tenantId,
        restartDto,
      );

      expect(tasksService.restart).toHaveBeenCalledWith(
        taskId,
        userId,
        tenantId,
        restartDto,
      );
      expect(result).toEqual({ success: true });
    });

    it('forwards intervention resolution payload to tasksService.resolveIntervention', async () => {
      const result = await controller.resolveIntervention(
        taskId,
        interventionId,
        userId,
        tenantId,
        resolveDto,
      );

      expect(tasksService.resolveIntervention).toHaveBeenCalledWith(
        taskId,
        interventionId,
        userId,
        tenantId,
        resolveDto,
      );
      expect(result).toEqual({
        id: interventionId,
        status: 'resolved',
      });
    });
  });

  describe('trigger CRUD', () => {
    it('forwards create trigger payload to triggersService.create', async () => {
      const result = await controller.createTrigger(
        taskId,
        triggerDto,
        tenantId,
      );

      expect(triggersService.create).toHaveBeenCalledWith(
        taskId,
        triggerDto,
        tenantId,
      );
      expect(result).toEqual({ id: triggerId });
    });

    it('forwards taskId and tenant to triggersService.listByTask', async () => {
      const result = await controller.listTriggers(taskId, tenantId);

      expect(triggersService.listByTask).toHaveBeenCalledWith(taskId, tenantId);
      expect(result).toEqual([{ id: triggerId }]);
    });

    it('forwards trigger update payload to triggersService.update', async () => {
      const result = await controller.updateTrigger(
        taskId,
        triggerId,
        updateTriggerDto,
        tenantId,
      );

      expect(triggersService.update).toHaveBeenCalledWith(
        triggerId,
        updateTriggerDto,
        tenantId,
      );
      expect(result).toEqual({ id: triggerId, enabled: false });
    });

    it('forwards trigger delete request to triggersService.delete', async () => {
      const result = await controller.deleteTrigger(
        taskId,
        triggerId,
        tenantId,
      );

      expect(triggersService.delete).toHaveBeenCalledWith(triggerId, tenantId);
      expect(result).toEqual({ success: true });
    });
  });

  describe('retry', () => {
    it('forwards retry payload to tasksService.retry', async () => {
      const result = await controller.retry(taskId, userId, tenantId, retryDto);

      expect(tasksService.retry).toHaveBeenCalledWith(
        taskId,
        retryDto,
        userId,
        tenantId,
      );
      expect(result).toEqual({ success: true });
    });
  });
});
