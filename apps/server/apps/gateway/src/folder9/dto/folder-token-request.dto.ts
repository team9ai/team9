import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Request body for `POST /api/v1/bot/folder-token`.
 *
 * This is the server-side mirror of `Team9FolderTokenRequest` in
 * `team9-agent-pi/packages/claw-hive-types/src/team9-folder-token.ts`.
 * team9 deliberately does NOT depend on `@team9claw/claw-hive-types`
 * (independent release cycles), so this DTO is a local redeclaration.
 * When the canonical agent-pi type changes, this MUST be updated in
 * lockstep.
 *
 * The shape lets `JustBashTeam9WorkspaceComponent` (agent-pi side) ask
 * for a Folder9-scoped token at `onSessionStart` with full session
 * context. The server authorizes based on the caller's bot identity
 * and the (workspace, folder, routine) triple, then mints a short-to-
 * medium-lived Folder9 token and returns it.
 */
export class FolderTokenRequestDto {
  @IsString()
  @MaxLength(512)
  sessionId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  agentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  routineId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  userId?: string;

  /**
   * One of the `Team9LogicalMountKey` union values. Kept as
   * loosely-validated string here so the wire format stays stable as
   * we incrementally expand the allow-list, with semantic acceptance
   * enforced by `FolderTokenService`.
   */
  @IsString()
  @MaxLength(64)
  logicalKey!: string;

  @IsString()
  @MaxLength(128)
  workspaceId!: string;

  @IsString()
  @MaxLength(128)
  folderId!: string;

  @IsIn(['light', 'managed'])
  folderType!: 'light' | 'managed';

  @IsIn(['read', 'propose', 'write', 'admin'])
  permission!: 'read' | 'propose' | 'write' | 'admin';
}
