import {
  Module,
  OnModuleInit,
  NestModule,
  MiddlewareConsumer,
  Logger,
} from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { SentryModule } from '@sentry/nestjs/setup';
import { SentryGlobalFilter } from '@sentry/nestjs/setup';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { join } from 'path';
import { AppController } from './app.controller.js';
import { HealthController } from './health.controller.js';
import { AppService } from './app.service.js';
import {
  DatabaseModule,
  ConfigService as DbConfigService,
} from '@team9/database';
import { RedisModule } from '@team9/redis';
import { AiClientModule } from '@team9/ai-client';
import { RabbitmqModule } from '@team9/rabbitmq';
import { StorageModule } from '@team9/storage';
import { ImModule } from './im/im.module.js';
import { EditionModule } from './edition/index.js';
import { AuthModule } from './auth/auth.module.js';
import { WorkspaceModule } from './workspace/workspace.module.js';
import { ClusterModule } from './cluster/cluster.module.js';
import { TenantMiddleware } from './common/middleware/tenant.middleware.js';
import { FileModule } from './file/file.module.js';
import { NotificationModule } from './notification/notification.module.js';
import { SearchModule } from './search/search.module.js';
import { BotModule } from './bot/bot.module.js';
import { OpenclawModule } from './openclaw/openclaw.module.js';
import { FileKeeperModule } from './file-keeper/file-keeper.module.js';
import { ApplicationsModule } from './applications/applications.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { SentryUserInterceptor } from './common/interceptors/sentry-user.interceptor.js';

@Module({
  imports: [
    SentryModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        join(process.cwd(), '.env.local'),
        join(process.cwd(), '.env'),
      ],
    }),
    EventEmitterModule.forRoot(),
    // Edition module - handles community/enterprise feature loading
    // TenantModule is loaded dynamically in enterprise edition
    EditionModule.forRootAsync(),
    DatabaseModule,
    RedisModule,
    AiClientModule,
    RabbitmqModule,
    StorageModule,
    BotModule,
    OpenclawModule,
    FileKeeperModule,
    ApplicationsModule,
    AuthModule,
    ClusterModule,
    ImModule,
    WorkspaceModule,
    FileModule,
    NotificationModule,
    SearchModule,
    DocumentsModule,
  ],
  controllers: [AppController, HealthController],
  providers: [
    AppService,
    { provide: APP_FILTER, useClass: SentryGlobalFilter },
    { provide: APP_INTERCEPTOR, useClass: SentryUserInterceptor },
  ],
})
export class AppModule implements OnModuleInit, NestModule {
  private readonly logger = new Logger(AppModule.name);

  constructor(private readonly configService: DbConfigService) {}

  configure(consumer: MiddlewareConsumer) {
    // Apply TenantMiddleware to all routes
    consumer.apply(TenantMiddleware).forRoutes('*');
  }

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
