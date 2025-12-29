import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { join } from 'path';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import {
  DatabaseModule,
  ConfigService as DbConfigService,
} from '@team9/database';
import { RedisModule } from '@team9/redis';
import { AiClientModule } from '@team9/ai-client';
// RabbitmqModule temporarily disabled due to NestJS 11 compatibility issue
// import { RabbitmqModule } from '@team9/rabbitmq';
import { ImModule } from './im/im.module.js';
import { EditionModule } from './edition/index.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        join(process.cwd(), '.env.local'),
        join(process.cwd(), '.env'),
      ],
    }),
    // Edition module - handles community/enterprise feature loading
    // TenantModule is loaded dynamically in enterprise edition
    EditionModule.forRootAsync(),
    DatabaseModule,
    RedisModule,
    AiClientModule,
    // RabbitmqModule,
    ImModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements OnModuleInit {
  private readonly logger = new Logger(AppModule.name);

  constructor(private readonly configService: DbConfigService) {}

  async onModuleInit() {
    // Load configurations from database on startup
    try {
      await this.configService.loadConfigs();
      this.logger.log('Database configurations loaded successfully');
    } catch {
      this.logger.warn(
        'Failed to load database configurations, using environment variables only',
      );
    }
  }
}
