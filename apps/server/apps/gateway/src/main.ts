import './load-env.js'; // Load environment variables first
import { NestFactory } from '@nestjs/core';
import { VersioningType, Logger } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { SocketRedisAdapterService } from './cluster/adapter/socket-redis-adapter.service.js';
import { WebsocketGateway } from './im/websocket/websocket.gateway.js';
import { runMigrations } from '@team9/database';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Run database migrations before starting the app
  try {
    logger.log('Running database migrations...');
    await runMigrations();
    logger.log('Database migrations completed');
  } catch (error) {
    logger.error('Database migration failed:', error);
    process.exit(1);
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

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
