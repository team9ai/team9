import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';

const dbModule = {
  DATABASE_CONNECTION: Symbol('DATABASE_CONNECTION'),
  eq: jest.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
  and: jest.fn((...clauses: unknown[]) => ({ op: 'and', clauses })),
  asc: jest.fn((value: unknown) => ({ op: 'asc', value })),
};

const schemaModule = {
  channelSections: {
    id: 'channelSections.id',
    tenantId: 'channelSections.tenantId',
    name: 'channelSections.name',
    order: 'channelSections.order',
    createdBy: 'channelSections.createdBy',
    createdAt: 'channelSections.createdAt',
    updatedAt: 'channelSections.updatedAt',
  },
  channels: {
    id: 'channels.id',
    tenantId: 'channels.tenantId',
    name: 'channels.name',
    type: 'channels.type',
    order: 'channels.order',
    sectionId: 'channels.sectionId',
    isArchived: 'channels.isArchived',
  },
};

jest.unstable_mockModule('@team9/database', () => dbModule);
jest.unstable_mockModule('@team9/database/schemas', () => schemaModule);
jest.unstable_mockModule('uuid', () => ({
  v7: jest.fn(() => 'section-uuid'),
}));

const { SectionsService } = await import('./sections.service.js');

type MockFn = jest.Mock<(...args: any[]) => any>;

function createQuery(result: unknown) {
  const query: Record<string, MockFn> & {
    then: (resolve: (value: unknown) => unknown, reject?: unknown) => unknown;
  } = {
    from: jest.fn<any>(),
    where: jest.fn<any>(),
    orderBy: jest.fn<any>(),
    limit: jest.fn<any>(),
    values: jest.fn<any>(),
    returning: jest.fn<any>(),
    set: jest.fn<any>(),
    then: (resolve) => Promise.resolve(resolve(result)),
  };

  for (const key of [
    'from',
    'where',
    'orderBy',
    'limit',
    'values',
    'returning',
    'set',
  ] as const) {
    query[key].mockReturnValue(query as never);
  }

  return query;
}

function mockDb() {
  const state = {
    selectResults: [] as unknown[][],
    insertResults: [] as unknown[][],
    updateResults: [] as unknown[][],
    deleteResults: [] as unknown[][],
  };

  const db = {
    __state: state,
    __queries: {
      select: [] as ReturnType<typeof createQuery>[],
      insert: [] as ReturnType<typeof createQuery>[],
      update: [] as ReturnType<typeof createQuery>[],
      delete: [] as ReturnType<typeof createQuery>[],
    },
    select: jest.fn((...args: unknown[]) => {
      const query = createQuery(state.selectResults.shift());
      (query as any).args = args;
      db.__queries.select.push(query);
      return query as never;
    }),
    insert: jest.fn((...args: unknown[]) => {
      const query = createQuery(state.insertResults.shift());
      (query as any).args = args;
      db.__queries.insert.push(query);
      return query as never;
    }),
    update: jest.fn((...args: unknown[]) => {
      const query = createQuery(state.updateResults.shift());
      (query as any).args = args;
      db.__queries.update.push(query);
      return query as never;
    }),
    delete: jest.fn((...args: unknown[]) => {
      const query = createQuery(state.deleteResults.shift());
      (query as any).args = args;
      db.__queries.delete.push(query);
      return query as never;
    }),
  };

  return db;
}

describe('SectionsService', () => {
  let service: typeof SectionsService.prototype;
  let db: ReturnType<typeof mockDb>;

  const now = new Date('2026-04-01T00:00:00Z');

  function section(overrides: Record<string, unknown> = {}) {
    return {
      id: 'section-1',
      tenantId: 'tenant-1',
      name: 'General',
      order: 0,
      createdBy: 'user-1',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  function channel(overrides: Record<string, unknown> = {}) {
    return {
      id: 'channel-1',
      tenantId: 'tenant-1',
      name: 'General',
      type: 'public',
      order: 0,
      sectionId: 'section-1',
      isArchived: false,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  beforeEach(() => {
    db = mockDb();
    service = new SectionsService(db as any);
    jest.clearAllMocks();
  });

  it('creates a section after the current max order', async () => {
    db.__state.selectResults.push([{ maxOrder: 2 }]);
    db.__state.insertResults.push([
      section({ id: 'section-uuid', name: 'Announcements', order: 3 }),
    ]);

    const result = await service.create(
      { name: 'Announcements' } as any,
      'user-1',
      'tenant-1',
    );

    expect(result).toEqual(
      section({ id: 'section-uuid', name: 'Announcements', order: 3 }),
    );
    expect(db.__queries.select[0].where).toHaveBeenCalledWith(
      dbModule.eq.mock.results[0].value,
    );
    expect(db.__queries.insert[0].values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'section-uuid',
        tenantId: 'tenant-1',
        name: 'Announcements',
        order: 3,
        createdBy: 'user-1',
      }),
    );
  });

  it('starts a tenant section at order 0 when none exist', async () => {
    db.__state.selectResults.push([]);
    db.__state.insertResults.push([section({ id: 'section-uuid' })]);

    const result = await service.create({ name: 'General' } as any, 'user-1');

    expect(result.order).toBe(0);
    expect(db.__queries.select[0].where).toHaveBeenCalledWith(undefined);
  });

  it('returns a section from findById()', async () => {
    db.__state.selectResults.push([section()]);

    await expect(service.findById('section-1')).resolves.toEqual(section());
  });

  it('returns null from findById() when the section does not exist', async () => {
    db.__state.selectResults.push([]);

    await expect(service.findById('missing')).resolves.toBeNull();
  });

  it('returns a section from findByIdOrThrow()', async () => {
    db.__state.selectResults.push([section()]);

    await expect(service.findByIdOrThrow('section-1')).resolves.toEqual(
      section(),
    );
  });

  it('throws NotFoundException from findByIdOrThrow() when a section is missing', async () => {
    db.__state.selectResults.push([]);

    await expect(service.findByIdOrThrow('missing')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('returns tenant sections ordered by order', async () => {
    db.__state.selectResults.push([section({ id: 'section-2', order: 1 })]);

    const result = await service.getSections('tenant-1');

    expect(result).toEqual([section({ id: 'section-2', order: 1 })]);
    expect(db.__queries.select[0].where).toHaveBeenCalledWith(
      dbModule.eq.mock.results[0].value,
    );
    expect(db.__queries.select[0].orderBy).toHaveBeenCalledWith(
      dbModule.asc.mock.results[0].value,
    );
  });

  it('returns sections with their ordered non-archived channels', async () => {
    db.__state.selectResults.push(
      [
        section({ id: 'section-1', order: 0 }),
        section({ id: 'section-2', order: 1 }),
      ],
      [
        channel({ id: 'channel-1', sectionId: 'section-1', order: 0 }),
        channel({ id: 'channel-2', sectionId: 'section-1', order: 1 }),
      ],
      [channel({ id: 'channel-3', sectionId: 'section-2', order: 0 })],
    );

    const result = await service.getSectionsWithChannels('tenant-1');

    expect(result).toEqual([
      {
        ...section({ id: 'section-1', order: 0 }),
        channels: [
          channel({ id: 'channel-1', sectionId: 'section-1', order: 0 }),
          channel({ id: 'channel-2', sectionId: 'section-1', order: 1 }),
        ],
      },
      {
        ...section({ id: 'section-2', order: 1 }),
        channels: [
          channel({ id: 'channel-3', sectionId: 'section-2', order: 0 }),
        ],
      },
    ]);
    expect(db.__queries.select).toHaveLength(3);
    expect(db.__queries.select[1].where).toHaveBeenCalledWith(
      dbModule.and.mock.results[0].value,
    );
    expect(db.__queries.select[1].orderBy).toHaveBeenCalledWith(
      dbModule.asc.mock.results[1].value,
    );
  });

  it('updates a section and stamps updatedAt', async () => {
    db.__state.updateResults.push([
      section({ id: 'section-1', name: 'Renamed', updatedAt: now }),
    ]);

    const result = await service.update(
      'section-1',
      { name: 'Renamed' } as any,
      'user-1',
    );

    expect(result).toEqual(
      section({ id: 'section-1', name: 'Renamed', updatedAt: now }),
    );
    expect(db.__queries.update[0].set).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Renamed',
        updatedAt: expect.any(Date),
      }),
    );
  });

  it('throws NotFoundException when update does not affect a section', async () => {
    db.__state.updateResults.push([]);

    await expect(
      service.update('missing', { name: 'Renamed' } as any, 'user-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('moves channels out of a deleted section before deleting it', async () => {
    db.__state.selectResults.push([section()]);

    await service.delete('section-1', 'user-1');

    expect(db.__queries.update).toHaveLength(1);
    expect(db.__queries.update[0].set).toHaveBeenCalledWith({
      sectionId: null,
    });
    expect(db.__queries.delete).toHaveLength(1);
    expect(db.__queries.delete[0].where).toHaveBeenCalledWith(
      expect.objectContaining({
        op: 'eq',
        left: schemaModule.channelSections.id,
        right: 'section-1',
      }),
    );
  });

  it('throws NotFoundException when deleting a missing section', async () => {
    db.__state.selectResults.push([]);

    await expect(service.delete('missing', 'user-1')).rejects.toThrow(
      NotFoundException,
    );
    expect(db.__queries.update).toHaveLength(0);
    expect(db.__queries.delete).toHaveLength(0);
  });

  it('reorders sections and returns the refreshed list', async () => {
    db.__state.selectResults.push([
      section({ id: 'section-2', order: 0 }),
      section({ id: 'section-1', order: 1 }),
    ]);

    const result = await service.reorderSections(
      ['section-2', 'section-1'],
      'tenant-1',
    );

    expect(result).toEqual([
      section({ id: 'section-2', order: 0 }),
      section({ id: 'section-1', order: 1 }),
    ]);
    expect(db.__queries.update).toHaveLength(2);
    expect(db.__queries.update[0].set).toHaveBeenCalledWith(
      expect.objectContaining({ order: 0, updatedAt: expect.any(Date) }),
    );
    expect(db.__queries.update[1].set).toHaveBeenCalledWith(
      expect.objectContaining({ order: 1, updatedAt: expect.any(Date) }),
    );
    expect(db.__queries.select[0].where).toHaveBeenCalledWith(
      expect.objectContaining({
        op: 'eq',
        left: schemaModule.channelSections.tenantId,
        right: 'tenant-1',
      }),
    );
  });

  it('moves a channel to a section with the provided order', async () => {
    db.__state.selectResults.push([channel()]);
    db.__state.selectResults.push([section({ id: 'section-2' })]);

    await service.moveChannelToSection('channel-1', 'section-2', 3, 'user-1');

    expect(db.__queries.update).toHaveLength(1);
    expect(db.__queries.update[0].set).toHaveBeenCalledWith(
      expect.objectContaining({
        sectionId: 'section-2',
        order: 3,
        updatedAt: expect.any(Date),
      }),
    );
    expect(db.__queries.select).toHaveLength(2);
    expect(db.__queries.select[1].where).toHaveBeenCalledWith(
      expect.objectContaining({
        op: 'eq',
        left: schemaModule.channelSections.id,
        right: 'section-2',
      }),
    );
  });

  it('defaults moved channels to order 0 when order is omitted', async () => {
    db.__state.selectResults.push([channel()]);

    await service.moveChannelToSection('channel-1', null, undefined, 'user-1');

    expect(db.__queries.update[0].set).toHaveBeenCalledWith(
      expect.objectContaining({
        sectionId: null,
        order: 0,
        updatedAt: expect.any(Date),
      }),
    );
  });

  it('throws NotFoundException when the channel is missing', async () => {
    db.__state.selectResults.push([]);

    await expect(
      service.moveChannelToSection('missing-channel', 'section-1', 0, 'user-1'),
    ).rejects.toThrow(NotFoundException);
    expect(db.__queries.update).toHaveLength(0);
  });

  it('throws NotFoundException when the target section is missing', async () => {
    db.__state.selectResults.push([channel()]);
    db.__state.selectResults.push([]);

    await expect(
      service.moveChannelToSection('channel-1', 'missing-section', 0, 'user-1'),
    ).rejects.toThrow(NotFoundException);
    expect(db.__queries.update).toHaveLength(0);
  });
});
