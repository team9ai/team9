import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockCreateAdapter = jest.fn<any>(() => ({ adapter: 'redis' }));

jest.unstable_mockModule('@socket.io/redis-adapter', () => ({
  createAdapter: mockCreateAdapter,
}));

function createRedisClient(options: { fail?: boolean } = {}) {
  return {
    once: jest.fn<any>((event: string, cb: (error?: Error) => void) => {
      if (options.fail && event === 'error') {
        cb(new Error('redis init failed'));
      } else if (!options.fail && event === 'ready') {
        cb();
      }
      return undefined;
    }),
    quit: jest.fn<any>().mockResolvedValue(undefined),
  };
}

describe('SocketRedisAdapterService', () => {
  let SocketRedisAdapterService: typeof import('./socket-redis-adapter.service.js').SocketRedisAdapterService;
  let redisService: {
    getClient: jest.Mock;
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const pubClient = createRedisClient();
    const subClient = createRedisClient();
    const baseClient = {
      duplicate: jest
        .fn<any>()
        .mockReturnValueOnce(pubClient)
        .mockReturnValueOnce(subClient),
    };
    redisService = {
      getClient: jest.fn<any>(() => baseClient),
    };

    ({ SocketRedisAdapterService } =
      await import('./socket-redis-adapter.service.js'));
  });

  it('initializes redis pub/sub clients and exposes the adapter instance', async () => {
    const service = new SocketRedisAdapterService(redisService as never);

    await service.onModuleInit();

    expect(mockCreateAdapter).toHaveBeenCalledWith(
      expect.objectContaining({
        once: expect.any(Function),
        quit: expect.any(Function),
      }),
      expect.objectContaining({
        once: expect.any(Function),
        quit: expect.any(Function),
      }),
      { key: 'im:socket:' },
    );
    expect(service.isInitialized()).toBe(true);
    expect(service.getAdapter()).toEqual({ adapter: 'redis' });
  });

  it('throws when the adapter is requested before initialization', async () => {
    const service = new SocketRedisAdapterService(redisService as never);

    expect(() => service.getAdapter()).toThrow(
      'Socket.io Redis Adapter not initialized. Call onModuleInit first.',
    );
    expect(service.isInitialized()).toBe(false);
  });

  it('rethrows initialization failures', async () => {
    const baseClient = {
      duplicate: jest
        .fn<any>()
        .mockReturnValueOnce(createRedisClient({ fail: true }))
        .mockReturnValueOnce(createRedisClient({ fail: true })),
    };
    redisService.getClient.mockReturnValue(baseClient);
    const service = new SocketRedisAdapterService(redisService as never);

    await expect(service.onModuleInit()).rejects.toThrow('redis init failed');
  });

  it('quits both clients and clears the adapter on destroy', async () => {
    const pubClient = createRedisClient();
    const subClient = createRedisClient();
    const baseClient = {
      duplicate: jest
        .fn<any>()
        .mockReturnValueOnce(pubClient)
        .mockReturnValueOnce(subClient),
    };
    redisService.getClient.mockReturnValue(baseClient);
    const service = new SocketRedisAdapterService(redisService as never);

    await service.onModuleInit();
    await service.onModuleDestroy();

    expect(pubClient.quit).toHaveBeenCalled();
    expect(subClient.quit).toHaveBeenCalled();
    expect(service.isInitialized()).toBe(false);
    expect(() => service.getAdapter()).toThrow();
  });

  it('swallows destroy-time redis errors', async () => {
    const pubClient = createRedisClient();
    const subClient = createRedisClient();
    pubClient.quit.mockRejectedValue(new Error('quit failed'));
    const baseClient = {
      duplicate: jest
        .fn<any>()
        .mockReturnValueOnce(pubClient)
        .mockReturnValueOnce(subClient),
    };
    redisService.getClient.mockReturnValue(baseClient);
    const service = new SocketRedisAdapterService(redisService as never);

    await service.onModuleInit();

    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
  });
});
