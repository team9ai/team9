import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { DatabaseModule } from '@team9/database';
import { RedisModule } from '@team9/redis';
import { AuthModule } from '../auth/auth.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';

import { AhandController } from './ahand.controller.js';
import { AhandInternalController } from './ahand-internal.controller.js';
import { AhandHubWebhookController } from './ahand-webhook.controller.js';
import { AhandDevicesService } from './ahand.service.js';
import { AhandHubClient } from './ahand-hub.client.js';
import { AhandWebhookService } from './ahand-webhook.service.js';
import { AhandRedisPublisher } from './ahand-redis-publisher.service.js';
import { AhandEventsGateway } from './ahand-events.gateway.js';

@Module({
  imports: [
    ConfigModule,
    EventEmitterModule,
    DatabaseModule,
    RedisModule,
    AuthModule,
    forwardRef(() => WorkspaceModule),
  ],
  controllers: [
    AhandController,
    AhandInternalController,
    AhandHubWebhookController,
  ],
  providers: [
    AhandDevicesService,
    AhandHubClient,
    AhandWebhookService,
    AhandRedisPublisher,
    AhandEventsGateway,
  ],
  exports: [AhandDevicesService, AhandRedisPublisher],
})
export class AhandModule {}
