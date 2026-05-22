import { describe, it, expect, jest } from '@jest/globals';

const { TaskTitleGeneratorService } =
  await import('./task-title-generator.service.js');

type MockFn = jest.Mock<(...args: any[]) => any>;

function createSelectBuilder(result: unknown[]) {
  const chain: Record<string, MockFn> = {
    from: jest.fn<any>().mockReturnThis(),
    where: jest.fn<any>().mockReturnThis(),
    limit: jest.fn<any>().mockResolvedValue(result),
  };
  return chain;
}

function createUpdateBuilder(result: unknown[], updatedValues: unknown[]) {
  const chain: Record<string, MockFn> = {
    set: jest.fn<any>(),
    where: jest.fn<any>().mockReturnThis(),
    returning: jest.fn<any>().mockResolvedValue(result),
  };
  chain.set.mockImplementation((value: unknown) => {
    updatedValues.push(value);
    return chain;
  });
  return chain;
}

describe('TaskTitleGeneratorService', () => {
  it('generates a short task title from the task description and notifies the creator', async () => {
    const run = {
      id: 'run-1',
      tenantId: 'tenant-1',
      creatorId: 'user-1',
      title: '请根据下面这个要求给我找youtube达人',
      description: '请根据下面这个要求给我找youtube达人，并整理首轮触达建议',
    };
    const updatedRun = {
      ...run,
      title: '寻找YouTube达人',
    };
    const updatedValues: unknown[] = [];
    const db = {
      select: jest.fn<any>(() => createSelectBuilder([run])),
      update: jest.fn<any>(() =>
        createUpdateBuilder([updatedRun], updatedValues),
      ),
    };
    const titleGenerator = {
      generate: jest.fn<any>().mockResolvedValue('寻找YouTube达人'),
    };
    const ws = {
      sendToUser: jest.fn<any>().mockResolvedValue(undefined),
    };
    const service = new TaskTitleGeneratorService(
      db as any,
      titleGenerator as any,
      ws as any,
    );

    await expect(
      service.generateForRun({
        runId: 'run-1',
        expectedCurrentTitle: '请根据下面这个要求给我找youtube达人',
      }),
    ).resolves.toEqual(updatedRun);

    expect(titleGenerator.generate).toHaveBeenCalledWith(run.description, {
      userId: 'user-1',
      tenantId: 'tenant-1',
    });
    expect(updatedValues[0]).toMatchObject({
      title: '寻找YouTube达人',
      updatedAt: expect.any(Date),
    });
    expect(ws.sendToUser).toHaveBeenCalledWith('user-1', 'task_updated', {
      taskId: 'run-1',
      title: '寻找YouTube达人',
    });
  });
});
