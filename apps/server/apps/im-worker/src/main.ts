import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const logger = new Logger('ImWorkerService');

  const app = await NestFactory.create(AppModule);

  // IM Worker doesn't need HTTP endpoints for now
  // It mainly consumes messages from RabbitMQ
  const port = process.env.IM_WORKER_PORT ?? 3001;

  await app.listen(port);

  logger.log(`IM Worker Service is running on port ${port}`);
}

void bootstrap();
