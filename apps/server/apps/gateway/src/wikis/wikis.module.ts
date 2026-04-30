import { forwardRef, Module } from '@nestjs/common';
import { DatabaseModule } from '@team9/database';
import { WebsocketModule } from '../im/websocket/websocket.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';
import { WikisController } from './wikis.controller.js';
import { WikisService } from './wikis.service.js';
import { Folder9ClientService } from './folder9-client.service.js';
import { Folder9WebhookController } from './folder9-webhook.controller.js';

/**
 * WikisModule wires the Wiki feature into the gateway.
 *
 * - Controllers: `WikisController` (authenticated REST surface keyed on
 *   `wikiId`) and `Folder9WebhookController` (HMAC-gated inbound webhook
 *   from folder9 → workspace broadcast via WebsocketGateway).
 * - Providers: `WikisService` (permission-gated business logic, consumes
 *   DatabaseModule via `DATABASE_CONNECTION`) and `Folder9ClientService`
 *   (outbound folder9 HTTP client).
 *
 * `WikisService` is exported so the workspace seed hook (Task 10) can
 * inject it to create a `public` Wiki on workspace creation.
 *
 * `BotService` is used by `WikisController` for `isAgent` resolution; it
 * is resolved via the `@Global()` `BotModule` already registered in
 * `AppModule`, so no explicit import is needed here.
 *
 * WebsocketModule is imported via `forwardRef` to stay consistent with
 * the rest of the gateway (WorkspaceModule, ChannelsModule) — the wiki
 * surface itself doesn't close a cycle today, but the wrapper is cheap
 * insurance as more cross-module wiring lands.
 */
@Module({
  imports: [
    DatabaseModule,
    forwardRef(() => WebsocketModule),
    // WorkspaceModule exports WorkspaceGuard, which WikisController applies
    // via @UseGuards. forwardRef is required because WorkspaceModule's seed
    // hook imports WikisService (Task 10), creating a cycle.
    forwardRef(() => WorkspaceModule),
  ],
  controllers: [WikisController, Folder9WebhookController],
  providers: [WikisService, Folder9ClientService],
  // `Folder9ClientService` is exported so the routines feature
  // (`provisionFolder9SkillFolder`, `ensureRoutineFolder`) can reuse the
  // same HTTP client without re-wiring its env reads. It has no DI deps
  // beyond reading process.env, so a single shared singleton is sufficient.
  exports: [WikisService, Folder9ClientService],
})
export class WikisModule {}
