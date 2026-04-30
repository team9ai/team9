import { Module } from '@nestjs/common';
import { DatabaseModule } from '@team9/database';
import { AuthModule } from '../auth/auth.module.js';
import { WikisModule } from '../wikis/wikis.module.js';
import { BotAgentOwnership } from './bot-agent-ownership.service.js';
import { FolderMapBuilder } from './folder-map-builder.service.js';
import { FolderMapController } from './folder-map.controller.js';
import { FolderMountResolver } from './folder-mount-resolver.service.js';
import { FolderTokenController } from './folder-token.controller.js';
import { FolderTokenService } from './folder-token.service.js';

/**
 * Folder9Module wires the shared "folder9 primitives" used by both
 * the routines subsystem (skill folders) and the agent-pi runtime
 * (JustBashTeam9WorkspaceComponent mount issuance).
 *
 * Today it hosts:
 * - `POST /api/v1/bot/folder-token` — dynamic Folder9 token issuance.
 * - `POST /api/v1/bot/folder-map` — per-session folderMap with lazy
 *   provisioning of `workspace_folder_mounts` rows.
 *
 * `WikisModule` is imported because it exports `Folder9ClientService`
 * (shared folder9 HTTP client). `AuthModule` provides the bot-auth
 * guard stack (`AuthGuard`) used by the controllers.
 */
@Module({
  imports: [DatabaseModule, AuthModule, WikisModule],
  controllers: [FolderTokenController, FolderMapController],
  providers: [
    FolderTokenService,
    FolderMountResolver,
    FolderMapBuilder,
    BotAgentOwnership,
  ],
  exports: [
    FolderTokenService,
    FolderMountResolver,
    FolderMapBuilder,
    BotAgentOwnership,
  ],
})
export class Folder9Module {}
