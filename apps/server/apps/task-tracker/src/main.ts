import './load-env.js';
import { NestFactory } from '@nestjs/core';
import { VersioningType, Logger } from '@nestjs/common';
import { env } from '@team9/shared';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const logger = new Logger('TaskTracker');
  const app = await NestFactory.create(AppModule);

  app.enableCors();
  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  const port =
    env.TASK_TRACKER_PORT || parseInt(process.env.PORT ?? '3000', 10);
  await app.listen(port);

  logger.log(`Task Tracker service running on port ${port}`);
}

void bootstrap();
