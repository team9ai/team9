import './load-env.js'; // Load environment variables first
import './instrument.js'; // Initialize Sentry before any other imports
import { NestFactory } from '@nestjs/core';
import { VersioningType, Logger } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { SocketRedisAdapterService } from './cluster/adapter/socket-redis-adapter.service.js';
import { WebsocketGateway } from './im/websocket/websocket.gateway.js';
async function bootstrap() {
  const logger = new Logger('Bootstrap');

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

  const port = Number(process.env.GATEWAY_PORT) || 3000;
  await app.listen(port, '0.0.0.0');
  logger.log(`Application is running on port ${port}`);
}
void bootstrap();
