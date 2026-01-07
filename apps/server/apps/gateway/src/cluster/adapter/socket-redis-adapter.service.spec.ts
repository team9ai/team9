import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { SocketRedisAdapterService } from './socket-redis-adapter.service.js';
import { RedisService } from '@team9/redis';

describe('SocketRedisAdapterService', () => {
  let service: SocketRedisAdapterService;
  let redisService: jest.Mocked<RedisService>;

  const mockRedisClient = {
    duplicate: jest.fn(),
    once: jest.fn(),
    quit: jest.fn().mockResolvedValue(undefined),
  };

  const mockDuplicatedClient = {
    once: jest.fn((event: string, callback: () => void) => {
      if (event === 'ready') {
        // Simulate ready event
        setTimeout(callback, 0);
      }
      return mockDuplicatedClient;
    }),
    quit: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    mockRedisClient.duplicate.mockReturnValue(mockDuplicatedClient);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SocketRedisAdapterService,
        {
          provide: RedisService,
          useValue: {
            getClient: jest.fn().mockReturnValue(mockRedisClient),
          },
        },
      ],
    }).compile();

    service = module.get<SocketRedisAdapterService>(SocketRedisAdapterService);
    redisService = module.get(RedisService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should not be initialized before onModuleInit', () => {
      expect(service.isInitialized()).toBe(false);
    });

    it('should initialize on module init', async () => {
      await service.onModuleInit();

      expect(redisService.getClient).toHaveBeenCalled();
      expect(mockRedisClient.duplicate).toHaveBeenCalledTimes(2);
      expect(service.isInitialized()).toBe(true);
    });

    it('should throw if getAdapter called before init', () => {
      expect(() => service.getAdapter()).toThrow(
        'Socket.io Redis Adapter not initialized',
      );
    });

    it('should return adapter after init', async () => {
      await service.onModuleInit();

      const adapter = service.getAdapter();
      expect(adapter).toBeDefined();
    });
  });

  describe('cleanup', () => {
    it('should cleanup on module destroy', async () => {
      await service.onModuleInit();
      await service.onModuleDestroy();

      expect(mockDuplicatedClient.quit).toHaveBeenCalledTimes(2);
      expect(service.isInitialized()).toBe(false);
    });
  });
});
