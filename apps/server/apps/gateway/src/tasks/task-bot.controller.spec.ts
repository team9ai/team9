import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('@team9/auth', () => ({
  AuthGuard: class AuthGuard {},
  CurrentUser: () => () => undefined,
}));

const { TaskBotController } = await import('./task-bot.controller.js');

type MockFn = jest.Mock<(...args: any[]) => any>;

describe('TaskBotController', () => {
  let controller: TaskBotController;
  let taskBotService: {
    reportSteps: MockFn;
    updateStatus: MockFn;
    createIntervention: MockFn;
    addDeliverable: MockFn;
    getTaskDocument: MockFn;
  };

  beforeEach(() => {
    taskBotService = {
      reportSteps: jest.fn<any>().mockResolvedValue({ success: true }),
      updateStatus: jest.fn<any>().mockResolvedValue({ success: true }),
      createIntervention: jest.fn<any>().mockResolvedValue({
        id: 'intervention-1',
      }),
      addDeliverable: jest.fn<any>().mockResolvedValue({ id: 'deliverable-1' }),
      getTaskDocument: jest.fn<any>().mockResolvedValue({
        id: 'document-1',
      }),
    };

    controller = new TaskBotController(taskBotService as never);
  });

  it('delegates reportSteps with task, execution, bot user, and dto', async () => {
    const dto = { steps: [{ title: 'Step 1', status: 'completed' }] };

    await expect(
      controller.reportSteps(
        'task-1',
        'execution-1',
        dto as never,
        'bot-user-1',
      ),
    ).resolves.toEqual({ success: true });

    expect(taskBotService.reportSteps).toHaveBeenCalledWith(
      'task-1',
      'execution-1',
      'bot-user-1',
      dto,
    );
  });

  it('delegates updateStatus and forwards status plus optional error', async () => {
    await expect(
      controller.updateStatus(
        'task-1',
        'execution-1',
        { status: 'failed', error: 'boom' } as never,
        'bot-user-1',
      ),
    ).resolves.toEqual({ success: true });

    expect(taskBotService.updateStatus).toHaveBeenCalledWith(
      'task-1',
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
        'task-1',
        'execution-1',
        dto as never,
        'bot-user-1',
      ),
    ).resolves.toEqual({ id: 'intervention-1' });

    expect(taskBotService.createIntervention).toHaveBeenCalledWith(
      'task-1',
      'execution-1',
      'bot-user-1',
      dto,
    );
  });

  it('delegates deliverable creation', async () => {
    const dto = { kind: 'link', title: 'Spec', url: 'https://example.com' };

    await expect(
      controller.addDeliverable(
        'task-1',
        'execution-1',
        dto as never,
        'bot-user-1',
      ),
    ).resolves.toEqual({ id: 'deliverable-1' });

    expect(taskBotService.addDeliverable).toHaveBeenCalledWith(
      'task-1',
      'execution-1',
      'bot-user-1',
      dto,
    );
  });

  it('delegates document retrieval', async () => {
    await expect(
      controller.getDocument('task-1', 'execution-1', 'bot-user-1'),
    ).resolves.toEqual({ id: 'document-1' });

    expect(taskBotService.getTaskDocument).toHaveBeenCalledWith(
      'task-1',
      'execution-1',
      'bot-user-1',
    );
  });
});
