import { Module, Global } from '@nestjs/common';
import { RedisModule } from '@team9/redis';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ClusterNodeService } from './cluster-node.service.js';
import { SessionService } from './session/session.service.js';
import { HeartbeatService } from './heartbeat/heartbeat.service.js';
import { ZombieCleanerService } from './heartbeat/zombie-cleaner.service.js';
import { ConnectionService } from './connection/connection.service.js';
import { SocketRedisAdapterService } from './adapter/socket-redis-adapter.service.js';

@Global()
@Module({
  imports: [RedisModule, EventEmitterModule.forRoot()],
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
