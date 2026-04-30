import {
  Module,
  OnModuleInit,
  NestModule,
  MiddlewareConsumer,
  Logger,
} from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { SentryModule } from '@sentry/nestjs/setup';
import { CustomSentryFilter } from './common/filters/sentry-global.filter.js';
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
import { LegacyTaskRoutesMiddleware } from './common/middleware/legacy-task-routes.middleware.js';
import { FileModule } from './file/file.module.js';
import { NotificationModule } from './notification/notification.module.js';
import { SearchModule } from './search/search.module.js';
import { BotModule } from './bot/bot.module.js';
import { BotChannelsModule } from './bot/channels/bot-channels.module.js';
import { OpenclawModule } from './openclaw/openclaw.module.js';
import { FileKeeperModule } from './file-keeper/file-keeper.module.js';
import { ApplicationsModule } from './applications/applications.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { RoutinesModule } from './routines/routines.module.js';
import { ResourcesModule } from './resources/resources.module.js';
import { SkillsModule } from './skills/skills.module.js';
import { PushModule } from './push/push.module.js';
import { WikisModule } from './wikis/wikis.module.js';
import { Folder9Module } from './folder9/folder9.module.js';
import { SentryUserInterceptor } from './common/interceptors/sentry-user.interceptor.js';
import { ImSharedModule } from './im/shared/im-shared.module.js';
import { PosthogModule } from '@team9/posthog';
import { BillingHubModule } from './billing-hub/billing-hub.module.js';
import { AccountModule } from './account/account.module.js';
import { AhandModule } from './ahand/ahand.module.js';

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
    PosthogModule,
    BillingHubModule,
    ImSharedModule,
    BotModule,
    BotChannelsModule,
    OpenclawModule,
    FileKeeperModule,
    ApplicationsModule,
    AuthModule,
    AccountModule,
    ClusterModule,
    ImModule,
    WorkspaceModule,
    FileModule,
    NotificationModule,
    SearchModule,
    DocumentsModule,
    RoutinesModule,
    ResourcesModule,
    SkillsModule,
    PushModule,
    WikisModule,
    Folder9Module,
    AhandModule,
  ],
  controllers: [AppController, HealthController],
  providers: [
    AppService,
    { provide: APP_FILTER, useClass: CustomSentryFilter },
    { provide: APP_INTERCEPTOR, useClass: SentryUserInterceptor },
  ],
})
export class AppModule implements OnModuleInit, NestModule {
  private readonly logger = new Logger(AppModule.name);

  constructor(private readonly configService: DbConfigService) {}

  configure(consumer: MiddlewareConsumer) {
    // Rewrite legacy /v1/tasks → /v1/routines during rename rollout
    consumer
      .apply(LegacyTaskRoutesMiddleware)
      .forRoutes('v1/tasks/{*path}', 'v1/bot/tasks/{*path}');
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
