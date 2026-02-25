import { Module, Global, Logger } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schemas/index.js';
import { ConfigService } from './config.service.js';
import { DATABASE_CONNECTION } from './database.constants.js';
import { env } from '@team9/shared';

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_CONNECTION,
      useFactory: () => {
        const logger = new Logger('DatabaseModule');

        const user = env.POSTGRES_USER;
        const password = env.POSTGRES_PASSWORD;
        const host = env.DB_HOST;
        const port = env.DB_PORT;
        const database = env.POSTGRES_DB;

        logger.log(
          `Connecting to PostgreSQL at ${host}:${port}/${database} as ${user}`,
        );

        // Use connection options instead of connection string to avoid encoding issues
        const client = postgres({
          host,
          port,
          database,
          username: user,
          password, // Password is passed directly, no encoding needed
          max: 10,
          connect_timeout: 5,
        });

        return drizzle(client, { schema });
      },
    },
    ConfigService,
  ],
  exports: [DATABASE_CONNECTION, ConfigService],
})
export class DatabaseModule {}
