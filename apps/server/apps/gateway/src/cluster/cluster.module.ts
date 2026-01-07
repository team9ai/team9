import { Module, Global, forwardRef } from '@nestjs/common';
import { RedisModule } from '@team9/redis';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ClusterNodeService } from './cluster-node.service.js';
import { SessionService } from './session/session.service.js';
import { HeartbeatService } from './heartbeat/heartbeat.service.js';
import { ZombieCleanerService } from './heartbeat/zombie-cleaner.service.js';
import { ConnectionService } from './connection/connection.service.js';
import { SocketRedisAdapterService } from './adapter/socket-redis-adapter.service.js';
import { MessagesModule } from '../im/messages/messages.module.js';

@Global()
@Module({
  imports: [
    RedisModule,
    EventEmitterModule.forRoot(),
    forwardRef(() => MessagesModule),
  ],
  providers: [
    ClusterNodeService,
    SessionService,
    HeartbeatService,
    ZombieCleanerService,
    ConnectionService,
    SocketRedisAdapterService,
  ],
  exports: [
    ClusterNodeService,
    SessionService,
    HeartbeatService,
    ZombieCleanerService,
    ConnectionService,
    SocketRedisAdapterService,
  ],
})
export class ClusterModule {}
