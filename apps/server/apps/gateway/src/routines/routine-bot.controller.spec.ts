import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('@team9/auth', () => ({
  AuthGuard: class AuthGuard {},
  CurrentUser: () => () => undefined,
}));

const { RoutineBotController } = await import('./routine-bot.controller.js');

type MockFn = jest.Mock<(...args: any[]) => any>;

describe('RoutineBotController', () => {
  let controller: RoutineBotController;
  let routineBotService: {
    createRoutine: MockFn;
    getRoutineById: MockFn;
    updateRoutine: MockFn;
    reportSteps: MockFn;
    updateStatus: MockFn;
    createIntervention: MockFn;
    addDeliverable: MockFn;
    getRoutineDocument: MockFn;
  };

  beforeEach(() => {
    routineBotService = {
      createRoutine: jest
        .fn<any>()
        .mockResolvedValue({ id: 'routine-1', status: 'draft' }),
      getRoutineById: jest.fn<any>().mockResolvedValue({
        id: 'routine-1',
        documentContent: '',
        triggers: [],
      }),
      updateRoutine: jest
        .fn<any>()
        .mockResolvedValue({ id: 'routine-1', title: 'Updated' }),
      reportSteps: jest.fn<any>().mockResolvedValue({ success: true }),
      updateStatus: jest.fn<any>().mockResolvedValue({ success: true }),
      createIntervention: jest.fn<any>().mockResolvedValue({
        id: 'intervention-1',
      }),
      addDeliverable: jest.fn<any>().mockResolvedValue({ id: 'deliverable-1' }),
      getRoutineDocument: jest.fn<any>().mockResolvedValue({
        id: 'document-1',
      }),
    };

    controller = new RoutineBotController(routineBotService as never);
  });

  it('delegates createRoutine with dto, bot user, and tenant', async () => {
    const dto = { title: 'New Routine', documentContent: 'Do the thing' };

    await expect(
      controller.create(dto as never, 'bot-user-1', 'tenant-1'),
    ).resolves.toEqual({ id: 'routine-1', status: 'draft' });

    expect(routineBotService.createRoutine).toHaveBeenCalledWith(
      dto,
      'bot-user-1',
      'tenant-1',
    );
  });

  it('delegates getRoutineById with routineId, bot user, and tenant', async () => {
    await expect(
      controller.getById('routine-1', 'bot-user-1', 'tenant-1'),
    ).resolves.toEqual({ id: 'routine-1', documentContent: '', triggers: [] });

    expect(routineBotService.getRoutineById).toHaveBeenCalledWith(
      'routine-1',
      'bot-user-1',
      'tenant-1',
    );
  });

  it('delegates updateRoutine with routineId, dto, bot user, and tenant', async () => {
    const dto = { title: 'Updated' };

    await expect(
      controller.update('routine-1', dto as never, 'bot-user-1', 'tenant-1'),
    ).resolves.toEqual({ id: 'routine-1', title: 'Updated' });

    expect(routineBotService.updateRoutine).toHaveBeenCalledWith(
      'routine-1',
      dto,
      'bot-user-1',
      'tenant-1',
    );
  });

  it('delegates reportSteps with routine, execution, bot user, and dto', async () => {
    const dto = { steps: [{ title: 'Step 1', status: 'completed' }] };

    await expect(
      controller.reportSteps(
        'routine-1',
        'execution-1',
        dto as never,
        'bot-user-1',
      ),
    ).resolves.toEqual({ success: true });

    expect(routineBotService.reportSteps).toHaveBeenCalledWith(
      'routine-1',
      'execution-1',
      'bot-user-1',
      dto,
    );
  });

  it('delegates updateStatus and forwards status plus optional error', async () => {
    await expect(
      controller.updateStatus(
        'routine-1',
        'execution-1',
        { status: 'failed', error: 'boom' } as never,
        'bot-user-1',
      ),
    ).resolves.toEqual({ success: true });

    expect(routineBotService.updateStatus).toHaveBeenCalledWith(
      'routine-1',
      'execution-1',
      'bot-user-1',
      'failed',
      'boom',
    );
  });

  it('delegates intervention creation', async () => {
    const dto = { title: 'Need help', message: 'Blocked on API' };

    await expect(
      controller.createIntervention(
        'routine-1',
        'execution-1',
        dto as never,
        'bot-user-1',
      ),
    ).resolves.toEqual({ id: 'intervention-1' });

    expect(routineBotService.createIntervention).toHaveBeenCalledWith(
      'routine-1',
      'execution-1',
      'bot-user-1',
      dto,
    );
  });

  it('delegates deliverable creation', async () => {
    const dto = { kind: 'link', title: 'Spec', url: 'https://example.com' };

    await expect(
      controller.addDeliverable(
        'routine-1',
        'execution-1',
        dto as never,
        'bot-user-1',
      ),
    ).resolves.toEqual({ id: 'deliverable-1' });

    expect(routineBotService.addDeliverable).toHaveBeenCalledWith(
      'routine-1',
      'execution-1',
      'bot-user-1',
      dto,
    );
  });

  it('delegates document retrieval', async () => {
    await expect(
      controller.getDocument('routine-1', 'execution-1', 'bot-user-1'),
    ).resolves.toEqual({ id: 'document-1' });

    expect(routineBotService.getRoutineDocument).toHaveBeenCalledWith(
      'routine-1',
      'execution-1',
      'bot-user-1',
    );
  });
});
