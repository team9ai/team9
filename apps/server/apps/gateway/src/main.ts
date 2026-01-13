import './load-env.js'; // Load environment variables first
import { NestFactory } from '@nestjs/core';
import { VersioningType, Logger } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { SocketRedisAdapterService } from './cluster/adapter/socket-redis-adapter.service.js';
import { WebsocketGateway } from './im/websocket/websocket.gateway.js';
import { runMigrations } from '@team9/database';

// Helper to add timeout to promises
const withTimeout = <T>(
  promise: Promise<T>,
  ms: number,
  operation: string,
): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${operation} timeout after ${ms}ms`)),
        ms,
      ),
    ),
  ]);

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Run database migrations before starting the app (with 30s timeout)
  try {
    logger.log('Running database migrations...');
    await withTimeout(runMigrations(), 30_000, 'Database migration');
    logger.log('Database migrations completed');
  } catch (error) {
    logger.error('Database migration failed:', error);
    // Don't exit - let the app try to start anyway
    // The app may still work if tables already exist
    logger.warn('Continuing startup despite migration failure...');
  }

  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  // Configure Socket.io Redis Adapter for multi-node deployment
  try {
    const adapterService = app.get(SocketRedisAdapterService);
    const wsGateway = app.get(WebsocketGateway);

    if (adapterService.isInitialized() && wsGateway.server) {
      wsGateway.server.adapter(adapterService.getAdapter());
      logger.log('Socket.io Redis Adapter configured successfully');
    } else {
      logger.warn(
        'Socket.io Redis Adapter not ready, will be configured in afterInit',
      );
    }
  } catch (error) {
    logger.warn(`Socket.io Redis Adapter configuration skipped: ${error}`);
  }

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port, '0.0.0.0');
  logger.log(`Application is running on: http://0.0.0.0:${port}`);
}
void bootstrap();
