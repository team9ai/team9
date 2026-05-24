import { describe, it, expect, jest } from '@jest/globals';
import { TasksController } from './tasks.controller.js';

describe('TasksController', () => {
  it('passes the current user to task list reads', async () => {
    const tasksService = {
      list: jest.fn().mockResolvedValue([]),
    };
    const controller = new TasksController(tasksService as never);

    await (
      controller.list as unknown as (
        tenantId: string,
        userId: string,
      ) => Promise<unknown[]>
    )('tenant-1', 'user-1');

    expect(tasksService.list).toHaveBeenCalledWith('tenant-1', 'user-1');
  });

  it('passes the current user to task detail reads', async () => {
    const tasksService = {
      getById: jest.fn().mockResolvedValue({ id: 'run-1' }),
    };
    const controller = new TasksController(tasksService as never);

    await (
      controller.getById as unknown as (
        runId: string,
        tenantId: string,
        userId: string,
      ) => Promise<unknown>
    )('run-1', 'tenant-1', 'user-1');

    expect(tasksService.getById).toHaveBeenCalledWith(
      'run-1',
      'tenant-1',
      'user-1',
    );
  });
});
