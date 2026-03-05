import { Module, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { join } from 'path';
import { DatabaseModule } from '@team9/database';
import { RedisModule } from '@team9/redis';
import { RabbitmqModule } from '@team9/rabbitmq';
import { ExecutorModule } from './executor/executor.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        join(process.cwd(), '.env.local'),
        join(process.cwd(), '.env'),
      ],
    }),
    DatabaseModule,
    RedisModule,
    RabbitmqModule,
    ExecutorModule,
  ],
})
export class AppModule implements OnModuleInit {
  private readonly logger = new Logger(AppModule.name);

  onModuleInit() {
    this.logger.log('Task Worker service initialized');
  }
}
