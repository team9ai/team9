import './load-env.js';
import { NestFactory } from '@nestjs/core';
import { VersioningType, Logger } from '@nestjs/common';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const logger = new Logger('TaskWorker');
  const app = await NestFactory.create(AppModule);

  app.enableCors();
  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  const port = process.env.TASK_WORKER_PORT ?? 3002;
  await app.listen(port);

  logger.log(`Task Worker service running on port ${port}`);
}

void bootstrap();
