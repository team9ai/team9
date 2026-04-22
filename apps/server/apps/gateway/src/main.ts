import './load-env.js'; // Load environment variables first
import './instrument.js'; // Initialize Sentry before any other imports
import './otel.js'; // Initialize OpenTelemetry
import { json, raw } from 'express';
import { NestFactory } from '@nestjs/core';
import { VersioningType, ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { SocketRedisAdapterService } from './cluster/adapter/socket-redis-adapter.service.js';
import { WebsocketGateway } from './im/websocket/websocket.gateway.js';
import { env } from '@team9/shared';
import { runMigrations, runSeed } from '@team9/database';

const logger = new Logger('Bootstrap');

/**
 * Bootstrap the gateway application.
 *
 * Optionally runs database migrations and seeding based on environment variables
 * AUTO_MIGRATE and AUTO_SEED, then starts the NestJS application.
 *
 * This function is exported and can be unit-tested. Top-level invocation only
 * fires when the file is executed directly (not when imported).
 */
export async function bootstrap(): Promise<void> {
  if (env.AUTO_MIGRATE) {
    logger.log('AUTO_MIGRATE=true, running migrations...');
    await runMigrations();
    logger.log('Migrations completed successfully');
  }

  if (env.AUTO_SEED) {
    logger.log('AUTO_SEED=true, running seed...');
    await runSeed();
    logger.log('Seed completed successfully');
  }

  const app = await NestFactory.create(AppModule);

  // Raw body for ahand webhook signature verification — must come BEFORE json().
  app.use(
    '/api/ahand/hub-webhook',
    raw({ type: 'application/json', limit: '1mb' }),
  );

  // Raise JSON body parser limit to 1 MB to support long text messages (up to 100K chars)
  app.use(json({ limit: '1mb' }));

  // Use OTel logger when observability is enabled
  if (process.env.OTEL_ENABLED === 'true') {
    const { OtelLogger } = await import('@team9/observability');
    app.useLogger(new OtelLogger());
  }

  app.enableCors({
    origin:
      env.CORS_ORIGIN === '*'
        ? true
        : env.CORS_ORIGIN.split(',').map((o) => o.trim()),
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
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

// CLI entry — only runs when file is executed directly, not when imported.
const isDirectRun =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.endsWith(process.argv[1] ?? '');

if (isDirectRun) {
  bootstrap()
    .then(() => {
      logger.log('Bootstrap completed');
    })
    .catch((err) => {
      if (err instanceof Error) {
        logger.error(`Bootstrap failed: ${err.message}`, err.stack);
      } else {
        logger.error(`Bootstrap failed: ${String(err)}`);
      }
      process.exit(1);
    });
}
