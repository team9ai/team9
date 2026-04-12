import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RoutineTriggersService } from './routine-triggers.service.js';

function createDbMock() {
  const taskLimit = jest.fn<any>().mockResolvedValue([]);
  const taskWhere = jest.fn<any>().mockReturnValue({ limit: taskLimit });
  const taskFrom = jest.fn<any>().mockReturnValue({ where: taskWhere });

  const joinedLimit = jest.fn<any>().mockResolvedValue([]);
  const joinedWhere = jest.fn<any>().mockReturnValue({ limit: joinedLimit });
  const innerJoin = jest.fn<any>().mockReturnValue({ where: joinedWhere });
  const joinedFrom = jest.fn<any>().mockReturnValue({ innerJoin });

  const insertReturning = jest.fn<any>().mockResolvedValue([]);
  const insertValues = jest
    .fn<any>()
    .mockReturnValue({ returning: insertReturning });

  const updateReturning = jest.fn<any>().mockResolvedValue([]);
  const updateWhere = jest
    .fn<any>()
    .mockReturnValue({ returning: updateReturning });
  const updateSet = jest.fn<any>().mockReturnValue({ where: updateWhere });

  const deleteWhere = jest.fn<any>().mockResolvedValue(undefined);

  return {
    select: jest
      .fn<any>()
      .mockImplementation((projection?: unknown) =>
        projection ? { from: joinedFrom } : { from: taskFrom },
      ),
    insert: jest.fn<any>().mockReturnValue({ values: insertValues }),
    update: jest.fn<any>().mockReturnValue({ set: updateSet }),
    delete: jest.fn<any>().mockReturnValue({ where: deleteWhere }),
    chains: {
      taskFrom,
      taskWhere,
      taskLimit,
      joinedFrom,
      innerJoin,
      joinedWhere,
      joinedLimit,
      insertValues,
      insertReturning,
      updateSet,
      updateWhere,
      updateReturning,
      deleteWhere,
    },
  };
}

describe('RoutineTriggersService', () => {
  let service: RoutineTriggersService;
  let db: ReturnType<typeof createDbMock>;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-02T10:30:00.000Z'));
    db = createDbMock();
    service = new RoutineTriggersService(db as never);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('creates manual triggers with default enabled state and no nextRunAt', async () => {
    db.chains.taskLimit.mockResolvedValueOnce([
      { id: 'task-1', tenantId: 'tenant-1' },
    ]);
    db.chains.insertReturning.mockResolvedValueOnce([
      { id: 'trigger-1', type: 'manual', enabled: true, nextRunAt: null },
    ]);

    await expect(
      service.create(
        'task-1',
        {
          type: 'manual',
        } as never,
        'tenant-1',
      ),
    ).resolves.toEqual({
      id: 'trigger-1',
      type: 'manual',
      enabled: true,
      nextRunAt: null,
    });

    expect(db.chains.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        routineId: 'task-1',
        type: 'manual',
        enabled: true,
        nextRunAt: null,
      }),
    );
  });

  it('creates interval triggers with a calculated nextRunAt', async () => {
    db.chains.taskLimit.mockResolvedValueOnce([
      { id: 'task-1', tenantId: 'tenant-1' },
    ]);
    db.chains.insertReturning.mockResolvedValueOnce([
      { id: 'trigger-2', type: 'interval' },
    ]);

    await service.create(
      'task-1',
      {
        type: 'interval',
        enabled: false,
        config: {
          every: 30,
          unit: 'minutes',
        },
      } as never,
      'tenant-1',
    );

    expect(db.chains.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
        nextRunAt: new Date('2026-04-02T11:00:00.000Z'),
      }),
    );
  });

  it('creates schedule triggers for the next day when the scheduled time already passed', async () => {
    db.chains.taskLimit.mockResolvedValueOnce([
      { id: 'task-1', tenantId: 'tenant-1' },
    ]);
    db.chains.insertReturning.mockResolvedValueOnce([{ id: 'trigger-3' }]);
    const expectedNextRunAt = new Date('2026-04-02T10:30:00.000Z');
    expectedNextRunAt.setHours(9, 15, 0, 0);
    expectedNextRunAt.setDate(expectedNextRunAt.getDate() + 1);

    await service.create(
      'task-1',
      {
        type: 'schedule',
        config: {
          frequency: 'daily',
          time: '09:15',
          timezone: 'Asia/Shanghai',
        },
      } as never,
      'tenant-1',
    );

    expect(db.chains.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        nextRunAt: expectedNextRunAt,
      }),
    );
  });

  it('validates required config before inserting triggers', async () => {
    db.chains.taskLimit.mockResolvedValue([
      { id: 'task-1', tenantId: 'tenant-1' },
    ]);

    await expect(
      service.create(
        'task-1',
        {
          type: 'interval',
          config: {
            every: 0,
            unit: 'minutes',
          },
        } as never,
        'tenant-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.create(
        'task-1',
        {
          type: 'schedule',
          config: {
            frequency: 'weekly',
            time: '10:30',
          },
        } as never,
        'tenant-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.create(
        'task-1',
        {
          type: 'channel_message',
          config: {},
        } as never,
        'tenant-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(db.insert).not.toHaveBeenCalled();
  });

  it('lists triggers after confirming the task belongs to the tenant', async () => {
    const rows = [{ id: 'trigger-1' }, { id: 'trigger-2' }];
    db.chains.taskWhere
      .mockReturnValueOnce({ limit: db.chains.taskLimit })
      .mockResolvedValueOnce(rows);
    db.chains.taskLimit.mockResolvedValueOnce([
      { id: 'task-1', tenantId: 'tenant-1' },
    ]);

    await expect(service.listByRoutine('task-1', 'tenant-1')).resolves.toEqual(
      rows,
    );
  });

  it('updates trigger config and recalculates nextRunAt for interval triggers', async () => {
    db.chains.joinedLimit.mockResolvedValueOnce([
      {
        trigger: { id: 'trigger-1', type: 'interval' },
        tenantId: 'tenant-1',
      },
    ]);
    db.chains.updateReturning.mockResolvedValueOnce([
      { id: 'trigger-1', enabled: true },
    ]);

    await expect(
      service.update(
        'trigger-1',
        {
          config: { every: 2, unit: 'hours' },
          enabled: true,
        } as never,
        'tenant-1',
      ),
    ).resolves.toEqual({ id: 'trigger-1', enabled: true });

    expect(db.chains.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        config: { every: 2, unit: 'hours' },
        enabled: true,
        nextRunAt: new Date('2026-04-02T12:30:00.000Z'),
        updatedAt: expect.any(Date),
      }),
    );
  });

  it('updates enabled state without recalculating nextRunAt when config is absent', async () => {
    db.chains.joinedLimit.mockResolvedValueOnce([
      {
        trigger: { id: 'trigger-1', type: 'manual' },
        tenantId: 'tenant-1',
      },
    ]);
    db.chains.updateReturning.mockResolvedValueOnce([
      { id: 'trigger-1', enabled: false },
    ]);

    await service.update(
      'trigger-1',
      {
        enabled: false,
      } as never,
      'tenant-1',
    );

    expect(db.chains.updateSet).toHaveBeenCalledWith({
      enabled: false,
      updatedAt: new Date('2026-04-02T10:30:00.000Z'),
    });
  });

  it('deletes triggers after tenant ownership is confirmed', async () => {
    db.chains.joinedLimit.mockResolvedValueOnce([
      {
        trigger: { id: 'trigger-1', type: 'manual' },
        tenantId: 'tenant-1',
      },
    ]);

    await expect(service.delete('trigger-1', 'tenant-1')).resolves.toEqual({
      success: true,
    });

    expect(db.delete).toHaveBeenCalled();
    expect(db.chains.deleteWhere).toHaveBeenCalled();
  });

  it('throws not found when deleting a trigger outside the tenant', async () => {
    db.chains.joinedLimit.mockResolvedValueOnce([]);

    await expect(
      service.delete('trigger-1', 'tenant-1'),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(db.delete).not.toHaveBeenCalled();
  });

  it('creates trigger batches sequentially through create()', async () => {
    const createSpy = jest.spyOn(service, 'create');
    createSpy
      .mockResolvedValueOnce({ id: 'trigger-1' } as never)
      .mockResolvedValueOnce({ id: 'trigger-2' } as never);

    await expect(
      service.createBatch(
        'task-1',
        [
          { type: 'manual' },
          { type: 'channel_message', config: { channelId: 'channel-1' } },
        ] as never,
        'tenant-1',
      ),
    ).resolves.toEqual([{ id: 'trigger-1' }, { id: 'trigger-2' }]);

    expect(createSpy).toHaveBeenNthCalledWith(
      1,
      'task-1',
      { type: 'manual' },
      'tenant-1',
    );
    expect(createSpy).toHaveBeenNthCalledWith(
      2,
      'task-1',
      { type: 'channel_message', config: { channelId: 'channel-1' } },
      'tenant-1',
    );
  });

  // ── replaceAllForRoutine ──────────────────────────────────────────

  describe('replaceAllForRoutine', () => {
    it('deletes existing triggers then inserts new ones within a transaction', async () => {
      const txInsertReturning = jest.fn<any>().mockResolvedValue([]);
      const txInsertValues = jest
        .fn<any>()
        .mockReturnValue({ returning: txInsertReturning });
      const txDeleteWhere = jest.fn<any>().mockResolvedValue(undefined);
      const tx = {
        delete: jest.fn<any>().mockReturnValue({ where: txDeleteWhere }),
        insert: jest.fn<any>().mockReturnValue({ values: txInsertValues }),
      };

      db.transaction = jest
        .fn<any>()
        .mockImplementation((cb: (tx: typeof tx) => Promise<void>) => cb(tx));

      await service.replaceAllForRoutine(
        'routine-1',
        [{ type: 'manual' } as never],
        'tenant-1',
      );

      expect(db.transaction).toHaveBeenCalledTimes(1);
      expect(tx.delete).toHaveBeenCalledTimes(1);
      expect(txDeleteWhere).toHaveBeenCalledTimes(1);
      expect(tx.insert).toHaveBeenCalledTimes(1);
      expect(txInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          routineId: 'routine-1',
          tenantId: 'tenant-1',
          type: 'manual',
          enabled: true,
        }),
      );
    });

    it('deletes all triggers and inserts nothing when given an empty array', async () => {
      const txDeleteWhere = jest.fn<any>().mockResolvedValue(undefined);
      const tx = {
        delete: jest.fn<any>().mockReturnValue({ where: txDeleteWhere }),
        insert: jest.fn<any>(),
      };

      db.transaction = jest
        .fn<any>()
        .mockImplementation((cb: (tx: typeof tx) => Promise<void>) => cb(tx));

      await service.replaceAllForRoutine('routine-1', []);

      expect(db.transaction).toHaveBeenCalledTimes(1);
      expect(tx.delete).toHaveBeenCalledTimes(1);
      expect(txDeleteWhere).toHaveBeenCalledTimes(1);
      expect(tx.insert).not.toHaveBeenCalled();
    });

    it('executes all operations inside a transaction (db.transaction was called)', async () => {
      const tx = {
        delete: jest.fn<any>().mockReturnValue({
          where: jest.fn<any>().mockResolvedValue(undefined),
        }),
        insert: jest.fn<any>().mockReturnValue({
          values: jest.fn<any>().mockResolvedValue(undefined),
        }),
      };

      db.transaction = jest
        .fn<any>()
        .mockImplementation((cb: (tx: typeof tx) => Promise<void>) => cb(tx));

      await service.replaceAllForRoutine(
        'routine-1',
        [
          { type: 'manual' } as never,
          {
            type: 'interval',
            config: { every: 1, unit: 'hours' },
          } as never,
        ],
        'tenant-1',
      );

      // Verify operations went through the tx object, not the outer db
      expect(db.transaction).toHaveBeenCalledTimes(1);
      expect(tx.delete).toHaveBeenCalledTimes(1);
      expect(tx.insert).toHaveBeenCalledTimes(2);
      // The outer db.delete and db.insert must NOT have been called directly
      expect(db.delete).not.toHaveBeenCalled();
      expect(db.insert).not.toHaveBeenCalled();
    });
  });
});
