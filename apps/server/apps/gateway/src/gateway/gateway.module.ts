import { Module, Global } from '@nestjs/common';
import { RedisModule } from '@team9/redis';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { GatewayNodeService } from './gateway-node.service.js';
import { SessionService } from './session/session.service.js';
import { HeartbeatService } from './heartbeat/heartbeat.service.js';
import { ZombieCleanerService } from './heartbeat/zombie-cleaner.service.js';
import { ConnectionService } from './connection/connection.service.js';

@Global()
@Module({
  imports: [RedisModule, EventEmitterModule.forRoot()],
  providers: [
    GatewayNodeService,
    SessionService,
    HeartbeatService,
    ZombieCleanerService,
    ConnectionService,
  ],
  exports: [
    GatewayNodeService,
    SessionService,
    HeartbeatService,
    ZombieCleanerService,
    ConnectionService,
  ],
})
export class GatewayModule {}
