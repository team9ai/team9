import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import * as bcrypt from 'bcrypt';
import { DATABASE_CONNECTION } from '@team9/database';
import { RedisService } from '@team9/redis';
import { BotAuthCacheService } from './bot-auth-cache.service.js';
import { BotService } from './bot.service.js';
import { ChannelsService } from '../im/channels/channels.service.js';

type MockFn = jest.Mock<(...args: any[]) => any>;

function createRawHex(fingerprint: string, fillChar = 'a'): string {
  if (fingerprint.length !== 8) {
    throw new Error('fingerprint must be 8 characters');
  }
  return `${fingerprint}${fillChar.repeat(88)}`;
}

function createSelectWhereChain(rows: unknown[]) {
  const chain: Record<string, MockFn> = {
    from: jest.fn<any>(),
    innerJoin: jest.fn<any>(),
    leftJoin: jest.fn<any>(),
    where: jest.fn<any>(),
    limit: jest.fn<any>(),
  };

  chain.from.mockReturnValue(chain);
  chain.innerJoin.mockReturnValue(chain);
  chain.leftJoin.mockReturnValue(chain);
  chain.where.mockResolvedValue(rows);
  chain.limit.mockResolvedValue(rows);

  return chain;
}

function createSelectLimitChain(rows: unknown[]) {
  const chain: Record<string, MockFn> = {
    from: jest.fn<any>(),
    innerJoin: jest.fn<any>(),
    leftJoin: jest.fn<any>(),
    where: jest.fn<any>(),
    limit: jest.fn<any>(),
  };

  chain.from.mockReturnValue(chain);
  chain.innerJoin.mockReturnValue(chain);
  chain.leftJoin.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.limit.mockResolvedValue(rows);

  return chain;
}

function createMutationChain(result: unknown = []) {
  const chain: Record<string, MockFn> = {
    set: jest.fn<any>(),
    where: jest.fn<any>(),
    values: jest.fn<any>(),
    returning: jest.fn<any>(),
  };

  chain.set.mockReturnValue(chain);
  chain.values.mockReturnValue(chain);
  chain.where.mockResolvedValue(result);
  chain.returning.mockResolvedValue(result);

  return chain;
}

function createDbMock() {
  const selectQueue: Array<Record<string, MockFn>> = [];
  const updateChain = createMutationChain();
  const deleteChain = createMutationChain();
  const insertChain = createMutationChain();
  const txChain = createMutationChain();

  const db = {
    select: jest.fn<any>(() => {
      const next = selectQueue.shift();
      if (!next) {
        throw new Error('Unexpected select call');
      }
      return next;
    }),
    update: jest.fn<any>(() => updateChain),
    delete: jest.fn<any>(() => deleteChain),
    insert: jest.fn<any>(() => insertChain),
    transaction: jest.fn<any>((fn) => fn(txChain)),
    __queueSelect(chain: Record<string, MockFn>) {
      selectQueue.push(chain);
    },
    __clearSelects() {
      selectQueue.length = 0;
    },
    __updateChain: updateChain,
    __deleteChain: deleteChain,
  };

  return db;
}

function createRedisMock() {
  const values = new Map<string, string>();
  const sets = new Map<string, Set<string>>();

  return {
    get: jest.fn(async (key: string) => values.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      values.set(key, value);
      return 'OK';
    }),
    incr: jest.fn(async (key: string) => {
      const current = Number.parseInt(values.get(key) ?? '0', 10);
      const next = current + 1;
      values.set(key, String(next));
      return next;
    }),
    exists: jest.fn(async (key: string) =>
      values.has(key) || sets.has(key) ? 1 : 0,
    ),
    sadd: jest.fn(async (key: string, member: string) => {
      const set = sets.get(key) ?? new Set<string>();
      set.add(member);
      sets.set(key, set);
      return set.size;
    }),
    smembers: jest.fn(async (key: string) => [...(sets.get(key) ?? new Set())]),
    expire: jest.fn(async () => 1),
    del: jest.fn(async (key: string) => {
      const deletedValue = values.delete(key);
      const deletedSet = sets.delete(key);
      return deletedValue || deletedSet ? 1 : 0;
    }),
  };
}

describe('BotService auth validation', () => {
  let service: BotService;
  let db: ReturnType<typeof createDbMock>;
  let redis: ReturnType<typeof createRedisMock>;
  let channelsService: {
    createDirectChannel: MockFn;
    deleteDirectChannelsForUser: MockFn;
  };
  let eventEmitter: { emit: MockFn };

  beforeEach(async () => {
    db = createDbMock();
    redis = createRedisMock();
    channelsService = {
      createDirectChannel: jest.fn<any>().mockResolvedValue({}),
      deleteDirectChannelsForUser: jest.fn<any>().mockResolvedValue(0),
    };
    eventEmitter = { emit: jest.fn<any>() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BotService,
        BotAuthCacheService,
        { provide: DATABASE_CONNECTION, useValue: db },
        { provide: RedisService, useValue: redis },
        { provide: ChannelsService, useValue: channelsService },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get(BotService);
  });

  it('returns botId, userId, and tenantId for a valid active token and preserves legacy validation output', async () => {
    const rawHex = createRawHex('12345678', 'a');
    const rawToken = `t9bot_${rawHex}`;
    const hash = await bcrypt.hash(rawHex, 4);

    db.__queueSelect(
      createSelectWhereChain([
        {
          botId: 'bot-1',
          userId: 'user-1',
          tenantId: 'tenant-1',
          accessToken: `12345678:${hash}`,
        },
      ]),
    );
    db.__queueSelect(
      createSelectLimitChain([
        {
          botId: 'bot-1',
          userId: 'user-1',
          tenantId: 'tenant-1',
          accessToken: `12345678:${hash}`,
        },
      ]),
    );

    const context = await service.validateAccessTokenWithContext(rawToken);

    expect(context).toEqual({
      botId: 'bot-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
    });

    db.__queueSelect(
      createSelectWhereChain([
        {
          botId: 'bot-1',
          userId: 'user-1',
          tenantId: 'tenant-1',
          accessToken: `12345678:${hash}`,
        },
      ]),
    );
    db.__queueSelect(
      createSelectLimitChain([
        {
          botId: 'bot-1',
          userId: 'user-1',
          tenantId: 'tenant-1',
          accessToken: `12345678:${hash}`,
        },
      ]),
    );
    db.__queueSelect(
      createSelectLimitChain([
        {
          id: 'user-1',
          email: 'bot@example.com',
          username: 'bot-user',
        },
      ]),
    );

    await expect(service.validateAccessToken(rawToken)).resolves.toEqual({
      userId: 'user-1',
      email: 'bot@example.com',
      username: 'bot-user',
    });
  });

  it('returns null for invalid tokens without hitting the database', async () => {
    await expect(
      service.validateAccessTokenWithContext('not-a-bot-token'),
    ).resolves.toBeNull();

    expect(db.select).not.toHaveBeenCalled();
  });

  it('preserves legacy validation for a valid bot token without an installed-application link', async () => {
    const rawHex = createRawHex('feedface', 'b');
    const rawToken = `t9bot_${rawHex}`;
    const hash = await bcrypt.hash(rawHex, 4);

    db.__queueSelect(
      createSelectWhereChain([
        {
          botId: 'bot-legacy',
          userId: 'user-legacy',
          tenantId: null,
          accessToken: `feedface:${hash}`,
        },
      ]),
    );
    db.__queueSelect(
      createSelectLimitChain([
        {
          botId: 'bot-legacy',
          userId: 'user-legacy',
          tenantId: null,
          accessToken: `feedface:${hash}`,
        },
      ]),
    );

    await expect(
      service.validateAccessTokenWithContext(rawToken),
    ).resolves.toBeNull();

    db.__queueSelect(
      createSelectWhereChain([
        {
          botId: 'bot-legacy',
          userId: 'user-legacy',
          tenantId: null,
          accessToken: `feedface:${hash}`,
        },
      ]),
    );
    db.__queueSelect(
      createSelectLimitChain([
        {
          botId: 'bot-legacy',
          userId: 'user-legacy',
          tenantId: null,
          accessToken: `feedface:${hash}`,
        },
      ]),
    );
    db.__queueSelect(
      createSelectLimitChain([
        {
          id: 'user-legacy',
          email: 'legacy@example.com',
          username: 'legacy-bot',
        },
      ]),
    );

    await expect(service.validateAccessToken(rawToken)).resolves.toEqual({
      userId: 'user-legacy',
      email: 'legacy@example.com',
      username: 'legacy-bot',
    });
  });

  it('uses the cache-backed validation path for repeated token checks', async () => {
    const rawHex = createRawHex('87654321', 'c');
    const rawToken = `t9bot_${rawHex}`;
    const hash = await bcrypt.hash(rawHex, 4);

    db.__queueSelect(
      createSelectWhereChain([
        {
          botId: 'bot-cache',
          userId: 'user-cache',
          tenantId: 'tenant-cache',
          accessToken: `87654321:${hash}`,
        },
      ]),
    );
    db.__queueSelect(
      createSelectLimitChain([
        {
          botId: 'bot-cache',
          userId: 'user-cache',
          tenantId: 'tenant-cache',
          accessToken: `87654321:${hash}`,
        },
      ]),
    );

    const first = await service.validateAccessTokenWithContext(rawToken);
    const second = await service.validateAccessTokenWithContext(rawToken);

    expect(first).toEqual({
      botId: 'bot-cache',
      userId: 'user-cache',
      tenantId: 'tenant-cache',
    });
    expect(second).toEqual(first);
    expect(db.select).toHaveBeenCalledTimes(2);
    expect(redis.set).toHaveBeenCalled();
    expect(redis.get).toHaveBeenCalledTimes(5);
  });

  it('does not return or cache a positive strict context when the bot token changes before final confirmation', async () => {
    const rawHex = createRawHex('deadbeef', 'd');
    const rawToken = `t9bot_${rawHex}`;
    const initialHash = await bcrypt.hash(rawHex, 4);
    const rotatedHex = `beadbeef${rawHex.slice(8)}`;
    const rotatedHash = await bcrypt.hash(rotatedHex, 4);

    db.__queueSelect(
      createSelectWhereChain([
        {
          botId: 'bot-race',
          userId: 'user-race',
          tenantId: 'tenant-race',
          accessToken: `deadbeef:${initialHash}`,
        },
      ]),
    );
    db.__queueSelect(
      createSelectLimitChain([
        {
          botId: 'bot-race',
          userId: 'user-race',
          tenantId: 'tenant-race',
          accessToken: `deadbeef:${rotatedHash}`,
        },
      ]),
    );

    await expect(
      service.validateAccessTokenWithContext(rawToken),
    ).resolves.toBeNull();

    db.__queueSelect(createSelectWhereChain([]));

    await expect(
      service.validateAccessTokenWithContext(rawToken),
    ).resolves.toBeNull();

    expect(db.select).toHaveBeenCalledTimes(2);
    expect(redis.set).toHaveBeenLastCalledWith(
      expect.stringMatching(/^auth:bot-token:[a-f0-9]{64}$/),
      JSON.stringify({ invalid: true }),
      5,
    );
  });

  it('invalidates cached validation results on revocation', async () => {
    const rawHex = createRawHex('aaaaaaaa', 'e');
    const rawToken = `t9bot_${rawHex}`;
    const hash = await bcrypt.hash(rawHex, 4);

    db.__queueSelect(
      createSelectWhereChain([
        {
          botId: 'bot-revoke',
          userId: 'user-revoke',
          tenantId: 'tenant-revoke',
          accessToken: `aaaaaaaa:${hash}`,
        },
      ]),
    );
    db.__queueSelect(
      createSelectLimitChain([
        {
          botId: 'bot-revoke',
          userId: 'user-revoke',
          tenantId: 'tenant-revoke',
          accessToken: `aaaaaaaa:${hash}`,
        },
      ]),
    );
    await expect(
      service.validateAccessTokenWithContext(rawToken),
    ).resolves.toEqual({
      botId: 'bot-revoke',
      userId: 'user-revoke',
      tenantId: 'tenant-revoke',
    });

    db.__queueSelect(
      createSelectLimitChain([
        {
          accessToken: `aaaaaaaa:${hash}`,
        },
      ]),
    );

    await service.revokeAccessToken('bot-revoke');

    db.__queueSelect(createSelectWhereChain([]));

    await expect(
      service.validateAccessTokenWithContext(rawToken),
    ).resolves.toBeNull();
    expect(db.select).toHaveBeenCalledTimes(4);
    const invalidationOrder =
      redis.incr.mock.invocationCallOrder.at(-1) ?? Number.MAX_SAFE_INTEGER;
    const revokeMutationOrder =
      db.__updateChain.where.mock.invocationCallOrder[0] ??
      Number.MAX_SAFE_INTEGER;
    expect(revokeMutationOrder).toBeLessThan(invalidationOrder);
    expect(redis.set).toHaveBeenCalledWith(
      'auth:bot-token-mutation:bot-revoke',
      '1',
      30,
    );
    expect(redis.smembers).toHaveBeenCalledWith(
      'auth:bot-token-keys:bot-revoke',
    );
  });

  it('invalidates cached validation results when generating a new token', async () => {
    const rawHex = createRawHex('bbbbbbbb', 'f');
    const rawToken = `t9bot_${rawHex}`;
    const hash = await bcrypt.hash(rawHex, 4);

    db.__queueSelect(
      createSelectWhereChain([
        {
          botId: 'bot-generate',
          userId: 'user-generate',
          tenantId: 'tenant-generate',
          accessToken: `bbbbbbbb:${hash}`,
        },
      ]),
    );
    db.__queueSelect(
      createSelectLimitChain([
        {
          botId: 'bot-generate',
          userId: 'user-generate',
          tenantId: 'tenant-generate',
          accessToken: `bbbbbbbb:${hash}`,
        },
      ]),
    );
    await service.validateAccessTokenWithContext(rawToken);

    db.__queueSelect(
      createSelectLimitChain([{ id: 'bot-generate', userId: 'user-generate' }]),
    );
    const tokenResult = await service.generateAccessToken('bot-generate');

    expect(tokenResult.botId).toBe('bot-generate');
    expect(tokenResult.userId).toBe('user-generate');
    expect(tokenResult.accessToken).toMatch(/^t9bot_[a-f0-9]{96}$/);
    const invalidationOrder =
      redis.incr.mock.invocationCallOrder.at(-1) ?? Number.MAX_SAFE_INTEGER;
    const generateMutationOrder =
      db.__updateChain.where.mock.invocationCallOrder[0] ??
      Number.MAX_SAFE_INTEGER;
    expect(generateMutationOrder).toBeLessThan(invalidationOrder);
    expect(redis.set).toHaveBeenCalledWith(
      'auth:bot-token-mutation:bot-generate',
      '1',
      30,
    );

    db.__queueSelect(createSelectWhereChain([]));

    await expect(
      service.validateAccessTokenWithContext(rawToken),
    ).resolves.toBeNull();
    expect(db.select).toHaveBeenCalledTimes(4);
    expect(redis.smembers).toHaveBeenCalledWith(
      'auth:bot-token-keys:bot-generate',
    );
  });

  it('revokes bot auth before channel cleanup and deletes the shadow user after cache invalidation', async () => {
    const rawHex = createRawHex('cccccccc', '0');
    const rawToken = `t9bot_${rawHex}`;
    const hash = await bcrypt.hash(rawHex, 4);

    db.__queueSelect(
      createSelectWhereChain([
        {
          botId: 'bot-delete',
          userId: 'user-delete',
          tenantId: 'tenant-delete',
          accessToken: `cccccccc:${hash}`,
        },
      ]),
    );
    db.__queueSelect(
      createSelectLimitChain([
        {
          botId: 'bot-delete',
          userId: 'user-delete',
          tenantId: 'tenant-delete',
          accessToken: `cccccccc:${hash}`,
        },
      ]),
    );
    await service.validateAccessTokenWithContext(rawToken);

    db.__queueSelect(
      createSelectLimitChain([
        {
          botId: 'bot-delete',
          userId: 'user-delete',
          username: 'bot-delete',
          displayName: 'Bot Delete',
          email: 'bot-delete@example.com',
          type: 'custom',
          ownerId: null,
          mentorId: null,
          description: null,
          capabilities: null,
          extra: null,
          managedProvider: null,
          managedMeta: null,
          isActive: true,
        },
      ]),
    );
    db.__queueSelect(
      createSelectLimitChain([
        {
          accessToken: `cccccccc:${hash}`,
        },
      ]),
    );

    await service.deleteBotAndCleanup('bot-delete');

    const revokeMutationOrder =
      db.__updateChain.where.mock.invocationCallOrder[0] ??
      Number.MAX_SAFE_INTEGER;
    const cacheInvalidationOrder = Math.max(
      redis.incr.mock.invocationCallOrder.at(-1) ?? 0,
      redis.smembers.mock.invocationCallOrder[0] ?? 0,
      ...redis.del.mock.invocationCallOrder,
    );
    const channelCleanupOrder =
      channelsService.deleteDirectChannelsForUser.mock.invocationCallOrder[0] ??
      Number.MAX_SAFE_INTEGER;
    const userDeletionOrder =
      db.__deleteChain.where.mock.invocationCallOrder[0] ??
      Number.MAX_SAFE_INTEGER;

    expect(revokeMutationOrder).toBeLessThan(channelCleanupOrder);
    expect(cacheInvalidationOrder).toBeLessThan(channelCleanupOrder);
    expect(cacheInvalidationOrder).toBeLessThan(userDeletionOrder);
    expect(channelsService.deleteDirectChannelsForUser).toHaveBeenCalledWith(
      'user-delete',
    );
    expect(redis.set).toHaveBeenCalledWith(
      'auth:bot-token-mutation:bot-delete',
      '1',
      30,
    );
  });

  it('rolls back token generation when cache invalidation fails after the token update', async () => {
    db.__queueSelect(
      createSelectLimitChain([
        {
          id: 'bot-fail-generate',
          userId: 'user-fail',
          accessToken: 'prevhash:old-token-hash',
        },
      ]),
    );
    redis.incr.mockRejectedValueOnce(new Error('redis down'));

    await expect(
      service.generateAccessToken('bot-fail-generate'),
    ).rejects.toThrow('redis down');

    expect(db.update).toHaveBeenCalledTimes(2);
  });

  it('rolls back token revocation when cache invalidation fails after the token update', async () => {
    db.__queueSelect(
      createSelectLimitChain([
        {
          accessToken: 'revokehash:old-token-hash',
        },
      ]),
    );
    redis.incr.mockRejectedValueOnce(new Error('redis down'));

    await expect(service.revokeAccessToken('bot-fail-revoke')).rejects.toThrow(
      'redis down',
    );

    expect(db.update).toHaveBeenCalledTimes(2);
  });

  it('rolls back token revocation and aborts bot deletion when cache invalidation fails', async () => {
    db.__queueSelect(
      createSelectLimitChain([
        {
          botId: 'bot-fail-delete',
          userId: 'user-fail-delete',
          username: 'bot-fail-delete',
          displayName: 'Bot Fail Delete',
          email: 'bot-fail-delete@example.com',
          type: 'custom',
          ownerId: null,
          mentorId: null,
          description: null,
          capabilities: null,
          extra: null,
          managedProvider: null,
          managedMeta: null,
          isActive: true,
        },
      ]),
    );
    db.__queueSelect(
      createSelectLimitChain([
        {
          accessToken: 'deletehash:old-token-hash',
        },
      ]),
    );
    redis.incr.mockRejectedValueOnce(new Error('redis down'));

    await expect(
      service.deleteBotAndCleanup('bot-fail-delete'),
    ).rejects.toThrow('redis down');

    expect(db.update).toHaveBeenCalledTimes(2);
    expect(db.delete).not.toHaveBeenCalled();
    expect(channelsService.deleteDirectChannelsForUser).not.toHaveBeenCalled();
  });

  it('allows lifecycle methods to continue when cache-key deletion fails after a successful version bump', async () => {
    db.__queueSelect(
      createSelectLimitChain([
        { id: 'bot-best-effort', userId: 'user-best-effort' },
      ]),
    );
    redis.smembers.mockRejectedValueOnce(new Error('smembers failed'));
    redis.del.mockRejectedValue(new Error('del failed'));

    await expect(
      service.generateAccessToken('bot-best-effort'),
    ).resolves.toEqual(
      expect.objectContaining({
        botId: 'bot-best-effort',
        userId: 'user-best-effort',
      }),
    );

    expect(redis.incr).toHaveBeenCalledWith(
      'auth:bot-token-version:bot-best-effort',
    );
    expect(db.update).toHaveBeenCalled();
  });
});
