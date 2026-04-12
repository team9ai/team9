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

jest.unstable_mockModule('./routines.service.js', () => ({
  RoutinesService: class RoutinesService {},
}));

jest.unstable_mockModule('./routine-triggers.service.js', () => ({
  RoutineTriggersService: class RoutineTriggersService {},
}));

const { RoutinesController } = await import('./routines.controller.js');

type MockFn = jest.Mock<(...args: any[]) => any>;

describe('RoutinesController', () => {
  let controller: RoutinesController;
  let routinesService: Record<string, MockFn>;
  let routineTriggersService: Record<string, MockFn>;

  const routineId = 'task-1';
  const executionId = 'exec-1';
  const interventionId = 'int-1';
  const triggerId = 'trigger-1';
  const tenantId = 'tenant-1';
  const userId = 'user-1';

  const createDto = { title: 'Test routine' } as any;
  const updateDto = { title: 'Updated routine' } as any;
  const startDto = { notes: 'start notes', triggerId: 'trigger-source' } as any;
  const resumeDto = { message: 'resume message' } as any;
  const stopDto = { reason: 'stop reason' } as any;
  const restartDto = { notes: 'restart notes' } as any;
  const resolveDto = { action: 'approve', message: 'looks good' } as any;
  const triggerDto = { type: 'manual', enabled: true } as any;
  const updateTriggerDto = { enabled: false } as any;
  const retryDto = { executionId, notes: 'retry notes' } as any;

  beforeEach(() => {
    routinesService = {
      create: jest.fn<any>().mockResolvedValue({ id: routineId }),
      list: jest.fn<any>().mockResolvedValue([{ id: routineId }]),
      getById: jest.fn<any>().mockResolvedValue({ id: routineId }),
      update: jest
        .fn<any>()
        .mockResolvedValue({ id: routineId, title: 'Updated routine' }),
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
      completeCreation: jest
        .fn<any>()
        .mockResolvedValue({ id: routineId, status: 'upcoming' }),
      createWithCreationTask: jest.fn<any>().mockResolvedValue({
        routineId,
        creationChannelId: 'channel-1',
        creationSessionId: `team9/tenant-1/source-agent-id/dm/channel-1`,
      }),
    };

    routineTriggersService = {
      create: jest.fn<any>().mockResolvedValue({ id: triggerId }),
      listByRoutine: jest.fn<any>().mockResolvedValue([{ id: triggerId }]),
      update: jest
        .fn<any>()
        .mockResolvedValue({ id: triggerId, enabled: false }),
      delete: jest.fn<any>().mockResolvedValue({ success: true }),
    };

    controller = new RoutinesController(
      routinesService as any,
      routineTriggersService as any,
    );
  });

  describe('CRUD', () => {
    it('forwards create payload, user, and tenant to routinesService.create', async () => {
      const result = await controller.create(createDto, userId, tenantId);

      expect(routinesService.create).toHaveBeenCalledWith(
        createDto,
        userId,
        tenantId,
      );
      expect(result).toEqual({ id: routineId });
    });

    it('forwards tenant filters to routinesService.list', async () => {
      const result = await controller.list(
        tenantId,
        userId,
        'bot-1',
        'in_progress',
        'once',
      );

      expect(routinesService.list).toHaveBeenCalledWith(
        tenantId,
        {
          botId: 'bot-1',
          status: 'in_progress',
          scheduleType: 'once',
        },
        userId,
      );
      expect(result).toEqual([{ id: routineId }]);
    });

    it('forwards routineId and tenant to routinesService.getById', async () => {
      const result = await controller.getById(routineId, tenantId);

      expect(routinesService.getById).toHaveBeenCalledWith(routineId, tenantId);
      expect(result).toEqual({ id: routineId });
    });

    it('forwards update payload, user, and tenant to routinesService.update', async () => {
      const result = await controller.update(
        routineId,
        updateDto,
        userId,
        tenantId,
      );

      expect(routinesService.update).toHaveBeenCalledWith(
        routineId,
        updateDto,
        userId,
        tenantId,
      );
      expect(result).toEqual({ id: routineId, title: 'Updated routine' });
    });

    it('forwards routineId, user, and tenant to routinesService.delete', async () => {
      const result = await controller.delete(routineId, userId, tenantId);

      expect(routinesService.delete).toHaveBeenCalledWith(
        routineId,
        userId,
        tenantId,
      );
      expect(result).toEqual({ success: true });
    });
  });

  describe('execution views', () => {
    it('forwards routineId and tenant to routinesService.getExecutions', async () => {
      const result = await controller.getExecutions(routineId, tenantId);

      expect(routinesService.getExecutions).toHaveBeenCalledWith(
        routineId,
        tenantId,
      );
      expect(result).toEqual([{ id: executionId }]);
    });

    it('forwards routineId, executionId, and tenant to routinesService.getExecution', async () => {
      const result = await controller.getExecution(
        routineId,
        executionId,
        tenantId,
      );

      expect(routinesService.getExecution).toHaveBeenCalledWith(
        routineId,
        executionId,
        tenantId,
      );
      expect(result).toEqual({ id: executionId });
    });

    it('forwards routineId, executionId, and tenant to routinesService.getExecutionEntries', async () => {
      const result = await controller.getExecutionEntries(
        routineId,
        executionId,
        tenantId,
      );

      expect(routinesService.getExecutionEntries).toHaveBeenCalledWith(
        routineId,
        executionId,
        tenantId,
      );
      expect(result).toEqual([{ type: 'step', data: { id: 'step-1' } }]);
    });

    it('forwards routineId, executionId, and tenant to routinesService.getDeliverables', async () => {
      const result = await controller.getDeliverables(
        routineId,
        tenantId,
        executionId,
      );

      expect(routinesService.getDeliverables).toHaveBeenCalledWith(
        routineId,
        executionId,
        tenantId,
      );
      expect(result).toEqual([{ id: 'del-1' }]);
    });

    it('forwards routineId and tenant to routinesService.getInterventions', async () => {
      const result = await controller.getInterventions(routineId, tenantId);

      expect(routinesService.getInterventions).toHaveBeenCalledWith(
        routineId,
        tenantId,
      );
      expect(result).toEqual([{ id: interventionId }]);
    });
  });

  describe('routine control', () => {
    it('forwards start payload to routinesService.start', async () => {
      const result = await controller.start(
        routineId,
        userId,
        tenantId,
        startDto,
      );

      expect(routinesService.start).toHaveBeenCalledWith(
        routineId,
        userId,
        tenantId,
        startDto,
      );
      expect(result).toEqual({ success: true });
    });

    it('forwards pause request to routinesService.pause', async () => {
      const result = await controller.pause(routineId, userId, tenantId);

      expect(routinesService.pause).toHaveBeenCalledWith(
        routineId,
        userId,
        tenantId,
      );
      expect(result).toEqual({ success: true });
    });

    it('forwards resume payload to routinesService.resume', async () => {
      const result = await controller.resume(
        routineId,
        userId,
        tenantId,
        resumeDto,
      );

      expect(routinesService.resume).toHaveBeenCalledWith(
        routineId,
        userId,
        tenantId,
        resumeDto,
      );
      expect(result).toEqual({ success: true });
    });

    it('forwards stop payload to routinesService.stop', async () => {
      const result = await controller.stop(
        routineId,
        userId,
        tenantId,
        stopDto,
      );

      expect(routinesService.stop).toHaveBeenCalledWith(
        routineId,
        userId,
        tenantId,
        stopDto,
      );
      expect(result).toEqual({ success: true });
    });

    it('forwards restart payload to routinesService.restart', async () => {
      const result = await controller.restart(
        routineId,
        userId,
        tenantId,
        restartDto,
      );

      expect(routinesService.restart).toHaveBeenCalledWith(
        routineId,
        userId,
        tenantId,
        restartDto,
      );
      expect(result).toEqual({ success: true });
    });

    it('forwards intervention resolution payload to routinesService.resolveIntervention', async () => {
      const result = await controller.resolveIntervention(
        routineId,
        interventionId,
        userId,
        tenantId,
        resolveDto,
      );

      expect(routinesService.resolveIntervention).toHaveBeenCalledWith(
        routineId,
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
    it('forwards create trigger payload to routineTriggersService.create', async () => {
      const result = await controller.createTrigger(
        routineId,
        triggerDto,
        tenantId,
      );

      expect(routineTriggersService.create).toHaveBeenCalledWith(
        routineId,
        triggerDto,
        tenantId,
      );
      expect(result).toEqual({ id: triggerId });
    });

    it('forwards routineId and tenant to routineTriggersService.listByRoutine', async () => {
      const result = await controller.listTriggers(routineId, tenantId);

      expect(routineTriggersService.listByRoutine).toHaveBeenCalledWith(
        routineId,
        tenantId,
      );
      expect(result).toEqual([{ id: triggerId }]);
    });

    it('forwards trigger update payload to routineTriggersService.update', async () => {
      const result = await controller.updateTrigger(
        routineId,
        triggerId,
        updateTriggerDto,
        tenantId,
      );

      expect(routineTriggersService.update).toHaveBeenCalledWith(
        triggerId,
        updateTriggerDto,
        tenantId,
      );
      expect(result).toEqual({ id: triggerId, enabled: false });
    });

    it('forwards trigger delete request to routineTriggersService.delete', async () => {
      const result = await controller.deleteTrigger(
        routineId,
        triggerId,
        tenantId,
      );

      expect(routineTriggersService.delete).toHaveBeenCalledWith(
        triggerId,
        tenantId,
      );
      expect(result).toEqual({ success: true });
    });
  });

  describe('retry', () => {
    it('forwards retry payload to routinesService.retry', async () => {
      const result = await controller.retry(
        routineId,
        userId,
        tenantId,
        retryDto,
      );

      expect(routinesService.retry).toHaveBeenCalledWith(
        routineId,
        retryDto,
        userId,
        tenantId,
      );
      expect(result).toEqual({ success: true });
    });
  });

  describe('completeCreation', () => {
    it('delegates to routinesService.completeCreation with correct arguments', async () => {
      const completeDto = { notes: 'all set' } as any;

      const result = await controller.completeCreation(
        routineId,
        completeDto,
        userId,
        tenantId,
      );

      expect(routinesService.completeCreation).toHaveBeenCalledWith(
        routineId,
        completeDto,
        userId,
        tenantId,
      );
      expect(result).toEqual({ id: routineId, status: 'upcoming' });
    });
  });

  describe('createWithCreationTask', () => {
    it('delegates to routinesService.createWithCreationTask with dto, userId, tenantId', async () => {
      const dto = { agentId: 'bot-1' } as any;

      const result = await controller.createWithCreationTask(
        dto,
        userId,
        tenantId,
      );

      expect(routinesService.createWithCreationTask).toHaveBeenCalledWith(
        dto,
        userId,
        tenantId,
      );
      expect(result).toEqual({
        routineId,
        creationChannelId: 'channel-1',
        creationSessionId: `team9/tenant-1/source-agent-id/dm/channel-1`,
      });
    });
  });
});
