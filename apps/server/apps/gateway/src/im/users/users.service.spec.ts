import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { validate } from 'class-validator';

const dbModule = {
  DATABASE_CONNECTION: Symbol('DATABASE_CONNECTION'),
  eq: jest.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
  and: jest.fn((...clauses: unknown[]) => ({ op: 'and', clauses })),
  or: jest.fn((...clauses: unknown[]) => ({ op: 'or', clauses })),
  like: jest.fn((left: unknown, right: unknown) => ({
    op: 'like',
    left,
    right,
  })),
  sql: jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    op: 'sql',
    text: String.raw(strings, ...values.map((value) => String(value))),
  })),
  inArray: jest.fn((left: unknown, right: unknown[]) => ({
    op: 'inArray',
    left,
    right,
  })),
  isNull: jest.fn((value: unknown) => ({ op: 'isNull', value })),
};

const schemaModule = {
  users: {
    id: 'users.id',
    email: 'users.email',
    username: 'users.username',
    displayName: 'users.displayName',
    avatarUrl: 'users.avatarUrl',
    status: 'users.status',
    lastSeenAt: 'users.lastSeenAt',
    userType: 'users.userType',
    language: 'users.language',
    timeZone: 'users.timeZone',
    updatedAt: 'users.updatedAt',
  },
  bots: {
    userId: 'bots.userId',
    installedApplicationId: 'bots.installedApplicationId',
    managedProvider: 'bots.managedProvider',
    managedMeta: 'bots.managedMeta',
  },
  installedApplications: {
    id: 'installedApplications.id',
    applicationId: 'installedApplications.applicationId',
  },
  files: {
    id: 'files.id',
    visibility: 'files.visibility',
    uploaderId: 'files.uploaderId',
  },
  tenantMembers: {
    userId: 'tenantMembers.userId',
    tenantId: 'tenantMembers.tenantId',
    leftAt: 'tenantMembers.leftAt',
  },
};

jest.unstable_mockModule('@team9/database', () => dbModule);
jest.unstable_mockModule('@team9/database/schemas', () => schemaModule);

const { UsersService } = await import('./users.service.js');
const { UpdateUserDto } = await import('./dto/update-user.dto.js');

type MockFn = jest.Mock<(...args: any[]) => any>;

function createQuery(result: unknown) {
  const query: Record<string, MockFn> & {
    then: (
      resolve: (value: unknown) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise<unknown>;
  } = {
    from: jest.fn<any>(),
    where: jest.fn<any>(),
    limit: jest.fn<any>(),
    leftJoin: jest.fn<any>(),
    innerJoin: jest.fn<any>(),
    update: jest.fn<any>(),
    set: jest.fn<any>(),
    returning: jest.fn<any>(),
    then: (resolve, reject) => {
      if (result instanceof Error) {
        if (typeof reject === 'function') {
          return Promise.resolve(reject(result));
        }
        return Promise.reject(result);
      }
      return Promise.resolve(resolve(result));
    },
  };

  for (const key of [
    'from',
    'where',
    'limit',
    'leftJoin',
    'innerJoin',
    'update',
    'set',
    'returning',
  ] as const) {
    query[key].mockReturnValue(query as never);
  }

  return query;
}

function mockDb() {
  const state = {
    selectResults: [] as unknown[],
    updateResults: [] as unknown[],
  };

  const db = {
    __state: state,
    __queries: {
      select: [] as ReturnType<typeof createQuery>[],
      update: [] as ReturnType<typeof createQuery>[],
    },
    select: jest.fn((...args: unknown[]) => {
      const query = createQuery(state.selectResults.shift());
      Object.assign(query, { args });
      db.__queries.select.push(query);
      return query as never;
    }),
    update: jest.fn((...args: unknown[]) => {
      const query = createQuery(state.updateResults.shift());
      Object.assign(query, { args });
      db.__queries.update.push(query);
      return query as never;
    }),
  };

  return db;
}

describe('UsersService', () => {
  let service: UsersService;
  let db: ReturnType<typeof mockDb>;
  let redisService: {
    get: MockFn;
    set: MockFn;
    del: MockFn;
    hset: MockFn;
    hget: MockFn;
    hdel: MockFn;
    hgetall: MockFn;
  };
  let eventEmitter: {
    emit: MockFn;
  };
  let originalEnv: NodeJS.ProcessEnv;

  const now = new Date('2026-04-02T00:00:00Z');

  function user(overrides: Record<string, unknown> = {}) {
    return {
      id: 'user-1',
      email: 'user@test.com',
      username: 'alice',
      displayName: 'Alice',
      avatarUrl: null,
      status: 'offline',
      lastSeenAt: null,
      userType: 'human',
      agentType: null,
      language: null,
      timeZone: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.API_URL = 'https://api.team9.test';

    db = mockDb();
    redisService = {
      get: jest.fn<any>().mockResolvedValue(null),
      set: jest.fn<any>().mockResolvedValue('OK'),
      del: jest.fn<any>().mockResolvedValue(1),
      hset: jest.fn<any>().mockResolvedValue(1),
      hget: jest.fn<any>().mockResolvedValue(null),
      hdel: jest.fn<any>().mockResolvedValue(1),
      hgetall: jest.fn<any>().mockResolvedValue({}),
    };
    eventEmitter = {
      emit: jest.fn<any>(),
    };

    service = new UsersService(
      db as never,
      redisService as never,
      eventEmitter as never,
    );
    jest.useFakeTimers();
    jest.setSystemTime(now);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('findById', () => {
    it('returns cached user data without querying the DB on cache hit', async () => {
      const cached = user();
      redisService.get.mockResolvedValueOnce(JSON.stringify(cached));

      await expect(service.findById(cached.id)).resolves.toEqual(cached);

      expect(redisService.get).toHaveBeenCalledWith('im:user:user-1');
      expect(db.select).not.toHaveBeenCalled();
      expect(redisService.set).not.toHaveBeenCalled();
    });

    it('queries the DB and writes the result to Redis on cache miss', async () => {
      const expectedUser = user({
        userType: 'bot',
        status: 'online',
        agentType: 'base_model',
      });
      db.__state.selectResults.push([
        {
          ...expectedUser,
          applicationId: 'base-model-staff',
          managedProvider: 'hive',
          managedMeta: { agentId: 'base-model-claude-tenant-1' },
        },
      ]);

      await expect(service.findById(expectedUser.id)).resolves.toEqual(
        expectedUser,
      );

      expect(db.select).toHaveBeenCalled();
      expect(db.__queries.select[0].leftJoin).toHaveBeenCalledTimes(2);
      expect(redisService.set).toHaveBeenCalledWith(
        'im:user:user-1',
        JSON.stringify(expectedUser),
        3600,
      );
    });
  });

  describe('findByIdOrThrow', () => {
    it('returns the user when it exists', async () => {
      const dbUser = user();
      db.__state.selectResults.push([dbUser]);

      await expect(service.findByIdOrThrow(dbUser.id)).resolves.toEqual(dbUser);
    });

    it('throws NotFoundException when the user is missing', async () => {
      db.__state.selectResults.push([]);

      await expect(service.findByIdOrThrow('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('updates a user, invalidates cache, emits an event, and returns the normalized user', async () => {
      const updated = user({ status: 'away', displayName: 'Alicia' });
      db.__state.updateResults.push([updated]);

      await expect(
        service.update('user-1', { displayName: 'Alicia' }),
      ).resolves.toEqual(updated);

      expect(db.update).toHaveBeenCalled();
      expect(db.__queries.update[0].set).toHaveBeenCalledWith(
        expect.objectContaining({
          displayName: 'Alicia',
          updatedAt: now,
        }),
      );
      expect(redisService.del).toHaveBeenCalledWith('im:user:user-1');
      expect(eventEmitter.emit).toHaveBeenCalledWith('user.updated', {
        user: updated,
      });
    });

    it('throws NotFoundException and does not invalidate cache when no row is updated', async () => {
      db.__state.updateResults.push([]);

      await expect(
        service.update('missing', { displayName: 'Nope' }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(redisService.del).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('updates the current user username when it is unique', async () => {
      const returnedUser = user({
        id: 'user-uuid',
        email: 'alice@test.com',
        username: 'new-user-name',
      });
      db.__state.selectResults.push([]);
      db.__state.updateResults.push([returnedUser]);

      const result = await service.update('user-uuid', {
        username: 'new-user-name',
      });

      expect(db.select).toHaveBeenCalledWith({ id: schemaModule.users.id });
      expect(db.update).toHaveBeenCalledWith(schemaModule.users);
      expect(db.__queries.update[0].set).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'new-user-name',
          updatedAt: now,
        }),
      );
      expect(result).toEqual(returnedUser);
    });

    it('rejects a username that is already taken by another user', async () => {
      db.__state.selectResults.push([{ id: 'other-user' }]);

      await expect(
        service.update('user-uuid', { username: 'taken-name' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('maps a late unique violation to a conflict error', async () => {
      const uniqueViolation = Object.assign(
        new Error('duplicate key value violates unique constraint'),
        { code: '23505' },
      );
      db.__state.selectResults.push([]);
      db.__state.updateResults.push(uniqueViolation);

      await expect(
        service.update('user-uuid', { username: 'race-name' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('accepts a Team9 public file avatar URL owned by the current user', async () => {
      const fileId = '123e4567-e89b-12d3-a456-426614174000';
      const returnedUser = user({
        id: 'user-uuid',
        email: 'alice@test.com',
        avatarUrl: `https://api.team9.test/api/v1/files/public/file/${fileId}`,
      });
      db.__state.selectResults.push([
        { id: fileId, visibility: 'public', uploaderId: 'user-uuid' },
      ]);
      db.__state.updateResults.push([returnedUser]);

      await expect(
        service.update('user-uuid', {
          avatarUrl: `https://api.team9.test/api/v1/files/public/file/${fileId}`,
        }),
      ).resolves.toEqual(returnedUser);
    });

    it('rejects an arbitrary third-party avatar URL', async () => {
      await expect(
        service.update('user-uuid', {
          avatarUrl: 'https://tracker.example.com/pixel.png',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a public-file-shaped avatar URL from an untrusted origin', async () => {
      await expect(
        service.update('user-uuid', {
          avatarUrl:
            'https://evil.example/api/v1/files/public/file/123e4567-e89b-12d3-a456-426614174000',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a Team9 public file avatar URL not owned by the current user', async () => {
      const fileId = '123e4567-e89b-12d3-a456-426614174001';
      db.__state.selectResults.push([
        { id: fileId, visibility: 'public', uploaderId: 'other-user' },
      ]);

      await expect(
        service.update('user-uuid', {
          avatarUrl: `https://api.team9.test/api/v1/files/public/file/${fileId}`,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('persists language and timeZone when the DTO carries them', async () => {
      const updated = user({ language: 'zh-CN', timeZone: 'Asia/Shanghai' });
      db.__state.updateResults.push([updated]);

      await expect(
        service.update('user-1', {
          language: 'zh-CN',
          timeZone: 'Asia/Shanghai',
        }),
      ).resolves.toEqual(updated);

      expect(db.__queries.update[0].set).toHaveBeenCalledWith(
        expect.objectContaining({
          language: 'zh-CN',
          timeZone: 'Asia/Shanghai',
          updatedAt: now,
        }),
      );
    });

    it('allows updating language without touching timeZone', async () => {
      const updated = user({ language: 'ja', timeZone: null });
      db.__state.updateResults.push([updated]);

      await expect(
        service.update('user-1', { language: 'ja' }),
      ).resolves.toEqual(updated);

      const setCall = db.__queries.update[0].set.mock.calls[0]?.[0] as Record<
        string,
        unknown
      >;
      expect(setCall).toMatchObject({ language: 'ja' });
      expect(setCall).not.toHaveProperty('timeZone');
    });

    it('allows updating timeZone without touching language', async () => {
      const updated = user({ language: null, timeZone: 'America/New_York' });
      db.__state.updateResults.push([updated]);

      await expect(
        service.update('user-1', { timeZone: 'America/New_York' }),
      ).resolves.toEqual(updated);

      const setCall = db.__queries.update[0].set.mock.calls[0]?.[0] as Record<
        string,
        unknown
      >;
      expect(setCall).toMatchObject({ timeZone: 'America/New_York' });
      expect(setCall).not.toHaveProperty('language');
    });
  });

  describe('updateStatus', () => {
    it('stores online status in Redis, verifies the write, and clears cache', async () => {
      redisService.hget.mockResolvedValueOnce('online');

      await service.updateStatus('user-1', 'online');

      expect(redisService.hset).toHaveBeenCalledWith(
        'im:online_users',
        'user-1',
        'online',
      );
      expect(redisService.hget).toHaveBeenCalledWith(
        'im:online_users',
        'user-1',
      );
      expect(redisService.hdel).not.toHaveBeenCalled();
      expect(db.update).not.toHaveBeenCalled();
      expect(redisService.del).toHaveBeenCalledWith('im:user:user-1');
    });

    it('removes offline users from Redis, updates lastSeenAt, and clears cache', async () => {
      await service.updateStatus('user-1', 'offline');

      expect(redisService.hdel).toHaveBeenCalledWith(
        'im:online_users',
        'user-1',
      );
      expect(db.update).toHaveBeenCalled();
      expect(db.__queries.update[0].set).toHaveBeenCalledWith(
        expect.objectContaining({
          lastSeenAt: now,
          updatedAt: now,
        }),
      );
      expect(redisService.del).toHaveBeenCalledWith('im:user:user-1');
    });

    it('stores away status in Redis without touching the database', async () => {
      await service.updateStatus('user-1', 'away');

      expect(redisService.hset).toHaveBeenCalledWith(
        'im:online_users',
        'user-1',
        'away',
      );
      expect(db.update).not.toHaveBeenCalled();
      expect(redisService.hdel).not.toHaveBeenCalled();
      expect(redisService.del).toHaveBeenCalledWith('im:user:user-1');
    });
  });

  describe('status queries', () => {
    it('returns offline when Redis has no status', async () => {
      redisService.hget.mockResolvedValueOnce(null);

      await expect(service.getUserStatus('user-1')).resolves.toBe('offline');
    });

    it('returns online users from Redis', async () => {
      redisService.hgetall.mockResolvedValueOnce({
        'user-1': 'online',
        'user-2': 'away',
      });

      await expect(service.getOnlineUsers()).resolves.toEqual({
        'user-1': 'online',
        'user-2': 'away',
      });
    });

    it('detects online users from Redis status', async () => {
      redisService.hget.mockResolvedValueOnce('online');

      await expect(service.isOnline('user-1')).resolves.toBe(true);
    });

    it('returns false when user is not online', async () => {
      redisService.hget.mockResolvedValueOnce('away');

      await expect(service.isOnline('user-1')).resolves.toBe(false);
    });
  });

  describe('search', () => {
    it('searches users without a tenant filter', async () => {
      const users = [user({ id: 'user-1' }), user({ id: 'user-2' })];
      db.__state.selectResults.push(users);

      await expect(service.search('ali', 10)).resolves.toEqual(users);

      expect(db.select).toHaveBeenCalled();
      expect(db.__queries.select[0].where).toHaveBeenCalledWith(
        expect.objectContaining({ op: 'or' }),
      );
      expect(db.__queries.select[0].limit).toHaveBeenCalledWith(10);
      expect(dbModule.inArray).not.toHaveBeenCalled();
    });

    it('searches users within a tenant when tenantId is provided', async () => {
      const users = [user({ id: 'user-1' })];
      db.__state.selectResults.push([{ userId: 'user-1' }], users);

      await expect(service.search('ali', 5, 'tenant-1')).resolves.toEqual(
        users,
      );

      expect(db.select).toHaveBeenCalledTimes(2);
      expect(dbModule.inArray).toHaveBeenCalled();
      expect(db.__queries.select[1].limit).toHaveBeenCalledWith(5);
    });

    it('excludes restricted personal staff bots from non-owner search results', async () => {
      const humanUser = user({ id: 'user-1' });
      const restrictedBot = user({
        id: 'bot-1',
        userType: 'bot',
        applicationId: 'personal-staff',
        botOwnerId: 'other-owner',
        botExtra: {
          personalStaff: {
            visibility: { allowMention: false, allowDirectMessage: false },
          },
        },
      });
      db.__state.selectResults.push([humanUser, restrictedBot]);

      const result = await service.search('', 20, undefined, 'searcher-1');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('user-1');
    });

    it('includes personal staff bots when searcher is the owner', async () => {
      const ownedBot = user({
        id: 'bot-1',
        userType: 'bot',
        applicationId: 'personal-staff',
        botOwnerId: 'searcher-1',
        botExtra: {
          personalStaff: {
            visibility: { allowMention: false, allowDirectMessage: false },
          },
        },
      });
      db.__state.selectResults.push([ownedBot]);

      const result = await service.search('', 20, undefined, 'searcher-1');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('bot-1');
    });

    it('includes personal staff bots when allowMention is true', async () => {
      const accessibleBot = user({
        id: 'bot-1',
        userType: 'bot',
        applicationId: 'personal-staff',
        botOwnerId: 'other-owner',
        botExtra: {
          personalStaff: {
            visibility: { allowMention: true, allowDirectMessage: false },
          },
        },
      });
      db.__state.selectResults.push([accessibleBot]);

      const result = await service.search('', 20, undefined, 'searcher-1');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('bot-1');
    });

    it('includes personal staff bots when allowDirectMessage is true', async () => {
      const accessibleBot = user({
        id: 'bot-1',
        userType: 'bot',
        applicationId: 'personal-staff',
        botOwnerId: 'other-owner',
        botExtra: {
          personalStaff: {
            visibility: { allowMention: false, allowDirectMessage: true },
          },
        },
      });
      db.__state.selectResults.push([accessibleBot]);

      const result = await service.search('', 20, undefined, 'searcher-1');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('bot-1');
    });

    it('does not filter when searcherId is not provided', async () => {
      const restrictedBot = user({
        id: 'bot-1',
        userType: 'bot',
        applicationId: 'personal-staff',
        botOwnerId: 'other-owner',
        botExtra: {
          personalStaff: {
            visibility: { allowMention: false, allowDirectMessage: false },
          },
        },
      });
      db.__state.selectResults.push([restrictedBot]);

      // Without searcherId, no filtering should occur
      const result = await service.search('', 20);

      expect(result).toHaveLength(1);
    });
  });

  describe('getMultipleByIds', () => {
    it('returns early for an empty list', async () => {
      await expect(service.getMultipleByIds([])).resolves.toEqual([]);

      expect(db.select).not.toHaveBeenCalled();
    });

    it('loads multiple users with ANY sql filtering', async () => {
      const users = [user({ id: 'user-1' }), user({ id: 'user-2' })];
      db.__state.selectResults.push(users);

      await expect(
        service.getMultipleByIds(['user-1', 'user-2']),
      ).resolves.toEqual(users);

      expect(db.select).toHaveBeenCalled();
      expect(db.__queries.select[0].where).toHaveBeenCalledWith(
        expect.objectContaining({ op: 'sql' }),
      );
    });
  });

  describe('UpdateUserDto validation', () => {
    it('accepts usernames with underscores as well as lowercase letters, numbers, and hyphens', async () => {
      const dto = Object.assign(new UpdateUserDto(), {
        username: 'new_user-123',
      });

      const errors = await validate(dto);

      expect(errors).toHaveLength(0);
    });

    it('rejects usernames with invalid characters', async () => {
      const dto = Object.assign(new UpdateUserDto(), {
        username: 'Bad_User',
      });

      const errors = await validate(dto);

      expect(errors.some((error) => error.property === 'username')).toBe(true);
    });

    it.each([
      ['en'],
      ['zh-CN'],
      ['zh-Hans'],
      ['pt-BR'],
      ['ja'],
      ['en-US'],
      ['sr-Cyrl-RS'],
    ])('accepts valid BCP 47 language tag %s', async (language) => {
      const dto = Object.assign(new UpdateUserDto(), { language });
      const errors = await validate(dto);
      expect(errors.filter((e) => e.property === 'language')).toHaveLength(0);
    });

    it.each([['english'], ['zh_CN'], ['<script>'], ['12'], ['zh-!!']])(
      'rejects invalid language tag %s',
      async (language) => {
        const dto = Object.assign(new UpdateUserDto(), { language });
        const errors = await validate(dto);
        expect(errors.some((e) => e.property === 'language')).toBe(true);
      },
    );

    it.each([
      ['UTC'],
      ['Asia/Shanghai'],
      ['America/New_York'],
      ['America/Argentina/Buenos_Aires'],
      ['Etc/GMT+8'],
      ['Europe/London'],
    ])('accepts valid IANA time zone %s', async (timeZone) => {
      const dto = Object.assign(new UpdateUserDto(), { timeZone });
      const errors = await validate(dto);
      expect(errors.filter((e) => e.property === 'timeZone')).toHaveLength(0);
    });

    it.each([
      ['Asia/Shang hai'], // space
      ['not a zone'],
      ['Asia//Shanghai'], // empty component
      ['/Asia/Shanghai'], // leading slash
    ])('rejects invalid time zone %s', async (timeZone) => {
      const dto = Object.assign(new UpdateUserDto(), { timeZone });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'timeZone')).toBe(true);
    });
  });
});
