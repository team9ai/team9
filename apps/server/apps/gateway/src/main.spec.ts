import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';

describe('bootstrap', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function getBootstrapWithMocks(envOverrides: Record<string, any> = {}) {
    const mockRunMigrations = jest
      .fn<() => Promise<void>>()
      .mockResolvedValue(undefined);
    const mockRunSeed = jest
      .fn<() => Promise<void>>()
      .mockResolvedValue(undefined);

    const mockApp = {
      listen: jest.fn().mockResolvedValue(),
      useLogger: jest.fn(),
      enableCors: jest.fn(),
      useGlobalPipes: jest.fn(),
      setGlobalPrefix: jest.fn(),
      enableVersioning: jest.fn(),
      get: jest.fn(() => ({ isInitialized: () => false })),
    };

    const mockNestFactoryCreate = jest.fn().mockResolvedValue(mockApp);

    // Setup all mocks before import
    jest.unstable_mockModule('@nestjs/core', () => ({
      NestFactory: {
        create: mockNestFactoryCreate,
      },
    }));

    jest.unstable_mockModule('@team9/database', () => ({
      runMigrations: mockRunMigrations,
      runSeed: mockRunSeed,
    }));

    jest.unstable_mockModule('@team9/shared', () => ({
      env: {
        DB_HOST: 'localhost',
        DB_PORT: 5432,
        POSTGRES_DB: 'team9_test',
        POSTGRES_USER: 'postgres',
        POSTGRES_PASSWORD: 'postgres',
        AUTO_MIGRATE: false,
        AUTO_SEED: false,
        CORS_ORIGIN: 'http://localhost:3000',
        ...envOverrides,
      },
    }));

    jest.unstable_mockModule('./app.module.js', () => ({
      AppModule: class AppModule {},
    }));
    jest.unstable_mockModule(
      './cluster/adapter/socket-redis-adapter.service.js',
      () => ({
        SocketRedisAdapterService: class SocketRedisAdapterService {},
      }),
    );
    jest.unstable_mockModule('./im/websocket/websocket.gateway.js', () => ({
      WebsocketGateway: class WebsocketGateway {},
    }));
    jest.unstable_mockModule('./load-env.js', () => ({}));
    jest.unstable_mockModule('./instrument.js', () => ({}));
    jest.unstable_mockModule('./otel.js', () => ({}));

    const { bootstrap } = await import('./main.js');

    return {
      bootstrap,
      mockRunMigrations,
      mockRunSeed,
      mockNestFactoryCreate,
      mockApp,
    };
  }

  it('should skip migrations and seed when both flags are false', async () => {
    const { bootstrap, mockRunMigrations, mockRunSeed, mockNestFactoryCreate } =
      await getBootstrapWithMocks();

    await bootstrap();

    expect(mockRunMigrations).not.toHaveBeenCalled();
    expect(mockRunSeed).not.toHaveBeenCalled();
    expect(mockNestFactoryCreate).toHaveBeenCalledTimes(1);
  });

  it('should run migrations when AUTO_MIGRATE is true', async () => {
    const { bootstrap, mockRunMigrations, mockRunSeed, mockNestFactoryCreate } =
      await getBootstrapWithMocks({ AUTO_MIGRATE: true });

    await bootstrap();

    expect(mockRunMigrations).toHaveBeenCalledTimes(1);
    expect(mockRunSeed).not.toHaveBeenCalled();
    expect(mockNestFactoryCreate).toHaveBeenCalledTimes(1);
  });

  it('should run seed when AUTO_SEED is true', async () => {
    const { bootstrap, mockRunMigrations, mockRunSeed, mockNestFactoryCreate } =
      await getBootstrapWithMocks({ AUTO_SEED: true });

    await bootstrap();

    expect(mockRunMigrations).not.toHaveBeenCalled();
    expect(mockRunSeed).toHaveBeenCalledTimes(1);
    expect(mockNestFactoryCreate).toHaveBeenCalledTimes(1);
  });

  it('should run both migrations and seed when both flags are true', async () => {
    const { bootstrap, mockRunMigrations, mockRunSeed, mockNestFactoryCreate } =
      await getBootstrapWithMocks({ AUTO_MIGRATE: true, AUTO_SEED: true });

    await bootstrap();

    expect(mockRunMigrations).toHaveBeenCalledTimes(1);
    expect(mockRunSeed).toHaveBeenCalledTimes(1);
    expect(mockNestFactoryCreate).toHaveBeenCalledTimes(1);
  });

  it('should propagate errors from runMigrations', async () => {
    const { bootstrap, mockRunMigrations } = await getBootstrapWithMocks({
      AUTO_MIGRATE: true,
    });

    const error = new Error('migration failed');
    mockRunMigrations.mockRejectedValueOnce(error);

    await expect(bootstrap()).rejects.toThrow('migration failed');
  });

  it('should propagate errors from runSeed', async () => {
    const { bootstrap, mockRunSeed } = await getBootstrapWithMocks({
      AUTO_SEED: true,
    });

    const error = new Error('seed failed');
    mockRunSeed.mockRejectedValueOnce(error);

    await expect(bootstrap()).rejects.toThrow('seed failed');
  });
});
