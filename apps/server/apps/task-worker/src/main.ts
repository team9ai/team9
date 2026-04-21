import './load-env.js';
import './otel.js';
import { NestFactory } from '@nestjs/core';
import { VersioningType, Logger, type INestApplication } from '@nestjs/common';
import { bootstrapWithSchemaRetry } from '@team9/shared';
import { AppModule } from './app.module.js';

const logger = new Logger('TaskWorker');

async function startApp(): Promise<void> {
  let app: INestApplication | undefined;
  try {
    app = await NestFactory.create(AppModule);

    app.enableCors();
    app.setGlobalPrefix('api');
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
    });

    const port = process.env.TASK_WORKER_PORT ?? 3002;
    await app.listen(port);

    logger.log(`Task Worker service running on port ${port}`);
  } catch (err) {
    await app?.close().catch(() => {
      /* swallow teardown errors so the original error surfaces */
    });
    throw err;
  }
}

void bootstrapWithSchemaRetry(startApp, { logger });
