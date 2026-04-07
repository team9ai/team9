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
    reportSteps: MockFn;
    updateStatus: MockFn;
    createIntervention: MockFn;
    addDeliverable: MockFn;
    getRoutineDocument: MockFn;
  };

  beforeEach(() => {
    routineBotService = {
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
