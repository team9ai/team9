import { Module } from '@nestjs/common';
import { DatabaseModule } from '@team9/database';
import { AuthModule } from '../auth/auth.module.js';
import { WikisModule } from '../wikis/wikis.module.js';
import { FolderMountResolver } from './folder-mount-resolver.service.js';
import { FolderTokenController } from './folder-token.controller.js';
import { FolderTokenService } from './folder-token.service.js';

/**
 * Folder9Module wires the shared "folder9 primitives" used by both
 * the routines subsystem (skill folders) and the agent-pi runtime
 * (JustBashTeam9WorkspaceComponent mount issuance).
 *
 * Today it hosts `POST /api/v1/bot/folder-token` — the dynamic
 * Folder9 token-issuance endpoint that replaces the pre-minted
 * tokens formerly shipped in `startCreationSession`'s componentConfigs.
 *
 * `WikisModule` is imported because it exports `Folder9ClientService`
 * (shared folder9 HTTP client). `AuthModule` provides the bot-auth
 * guard stack (`AuthGuard`) used by the controller.
 */
@Module({
  imports: [DatabaseModule, AuthModule, WikisModule],
  controllers: [FolderTokenController],
  providers: [FolderTokenService, FolderMountResolver],
  exports: [FolderTokenService, FolderMountResolver],
})
export class Folder9Module {}
