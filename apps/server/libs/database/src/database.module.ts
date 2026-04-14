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
          max: 30,
          idle_timeout: 20,
          connect_timeout: 10,
          max_lifetime: 60 * 30,
          // Force session TimeZone to UTC so `defaultNow()` on `timestamp`
          // (without time zone) columns stores UTC wall-clock, matching
          // Drizzle's read-side assumption (`value + '+0000'`). Without this,
          // a DB whose server default is a non-UTC zone (e.g. local Postgres
          // on a Mac in Asia/Shanghai) stores local wall-clock under
          // `now()` and every read drifts by the local offset.
          connection: { TimeZone: 'UTC' },
        });

        return drizzle(client, { schema });
      },
    },
    ConfigService,
  ],
  exports: [DATABASE_CONNECTION, ConfigService],
})
export class DatabaseModule {}
