import './load-env.js'; // Load environment variables first
import './instrument.js'; // Initialize Sentry before any other imports
import './otel.js'; // Initialize OpenTelemetry
import { NestFactory } from '@nestjs/core';
import { VersioningType, ValidationPipe, Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { json } from 'express';
import {
  securityHeadersMiddleware,
  trustedTypesReportOnlyMiddleware,
} from './security/security-headers.js';
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

  // Disable Nest's built-in body parser; register our own below with a raised
  // 10 MB limit and a `verify` callback that stashes the raw request buffer on
  // req.rawBody. Raw bytes are required by both the folder9 webhook controller
  // and the ahand hub webhook — both HMAC-SHA256 over the exact byte stream
  // that arrived on the wire (JSON.stringify of the parsed body is not
  // byte-stable). 10 MB accommodates wiki image uploads (up to ~5 MB raw →
  // ~6.7 MB base64) as well as long-text messages.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  app.use(
    json({
      limit: '10mb',
      verify: (req: unknown, _res, buf: Buffer) => {
        (req as { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );

  // Security headers — see security-headers.ts for the policy rationale.
  app.use(securityHeadersMiddleware());
  app.use(trustedTypesReportOnlyMiddleware);

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
