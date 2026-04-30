import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Request body for `POST /api/v1/bot/folder-map`.
 *
 * Server-side mirror of `Team9FolderMapRequest` in
 * `team9-agent-pi/packages/claw-hive-types/src/team9-folder-map.ts`.
 * team9 deliberately does NOT depend on `@team9claw/claw-hive-types`
 * (independent release cycles), so this DTO is a local redeclaration
 * that MUST be updated in lockstep when the canonical agent-pi type
 * changes.
 *
 * The shape lets `JustBashTeam9WorkspaceComponent` (agent-pi side)
 * obtain a per-session folderMap at `onSessionStart`. The server
 * lazy-provisions any missing Folder9 folders (session.* / agent.* /
 * user.* / routine.{tmp,home}) via `FolderMapBuilder`.
 */
export class FolderMapRequestDto {
  @IsString()
  @MaxLength(512)
  sessionId!: string;

  @IsString()
  @MaxLength(128)
  agentId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  routineId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  userId?: string;
}
