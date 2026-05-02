// apps/server/apps/gateway/src/permissions/permissions.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { DatabaseModule } from '@team9/database';
import { AuthModule } from '@team9/auth';
import { PermissionsService } from './permissions.service.js';
import { PermissionsController } from './permissions.controller.js';
import { PermissionsApproverRepository } from './permissions-approver.repository.js';
import { SpellIdService } from './spell-id.service.js';
import { PermissionsWsBridge } from './permissions.ws-bridge.js';
import { WebsocketModule } from '../im/websocket/websocket.module.js';

/**
 * PermissionsModule wires the permission-request/grant sub-system into the
 * gateway.
 *
 * Providers:
 *  - PermissionsService          — core business logic (requests + grants)
 *  - PermissionsApproverRepository — DB queries for approver resolution
 *  - SpellIdService              — human-readable spell-id generator
 *  - PermissionsWsBridge         — EventEmitter2 → WebSocket fan-out
 *
 * Controller:
 *  - PermissionsController       — REST surface (v1/permissions/*)
 *
 * Exports:
 *  - PermissionsService          — consumed by routines, openclaw, etc.
 *
 * Notes:
 *  - BotService is resolved from the @Global() BotModule that AppModule
 *    registers; no explicit import needed here.
 *  - WebsocketModule is imported via forwardRef to guard against circular
 *    dependency chains as more cross-module wiring lands.
 */
@Module({
  imports: [DatabaseModule, AuthModule, forwardRef(() => WebsocketModule)],
  controllers: [PermissionsController],
  providers: [
    PermissionsService,
    PermissionsApproverRepository,
    SpellIdService,
    PermissionsWsBridge,
  ],
  exports: [PermissionsService],
})
export class PermissionsModule {}
