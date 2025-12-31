import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const logger = new Logger('LogicService');

  const app = await NestFactory.create(AppModule);

  // Logic Service doesn't need HTTP endpoints for now
  // It mainly consumes messages from RabbitMQ
  const port = process.env.LOGIC_PORT ?? 3001;

  await app.listen(port);

  logger.log(`Logic Service is running on port ${port}`);
}

void bootstrap();
