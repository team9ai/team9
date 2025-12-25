import * as dotenv from 'dotenv';
import { join } from 'path';

// Load .env file from project root (two levels up from apps/gateway)
dotenv.config({ path: join(process.cwd(), '..', '..', '.env') });

import { NestFactory } from '@nestjs/core';
import { VersioningType } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
