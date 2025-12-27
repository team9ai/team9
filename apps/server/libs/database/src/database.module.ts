import { Module, Global, Logger } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schemas.js';
import { ConfigService } from './config.service.js';
import { DATABASE_CONNECTION } from './database.constants.js';

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_CONNECTION,
      useFactory: () => {
        const logger = new Logger('DatabaseModule');

        const user = process.env.POSTGRES_USER || 'postgres';
        const password = process.env.POSTGRES_PASSWORD || 'postgres';
        const host = process.env.DB_HOST || 'localhost';
        const port = process.env.DB_PORT || '5432';
        const database = process.env.POSTGRES_DB || 'team9';

        logger.log(
          `Connecting to PostgreSQL at ${host}:${port}/${database} as ${user}`,
        );

        // Use connection options instead of connection string to avoid encoding issues
        const client = postgres({
          host,
          port: parseInt(port, 10),
          database,
          username: user,
          password, // Password is passed directly, no encoding needed
          max: 10,
          idle_timeout: 20,
        });

        return drizzle(client, { schema });
      },
    },
    ConfigService,
  ],
  exports: [DATABASE_CONNECTION, ConfigService],
})
export class DatabaseModule {}
