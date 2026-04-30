import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  DATABASE_CONNECTION,
  and,
  eq,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import { Folder9ClientService } from '../wikis/folder9-client.service.js';
import {
  Folder9ApiError,
  type Folder9FolderType,
  type Folder9OwnerType,
} from '../wikis/types/folder9.types.js';

/**
 * Inputs for {@link FolderMountResolver.provisionFolderForMount}.
 *
 * The (workspaceId, scope, scopeId, mountKey) tuple is the idempotency key —
 * the unique index on `workspace_folder_mounts` ensures that two concurrent
 * callers passing the same key end up sharing one folder regardless of who
 * wins the INSERT race.
 *
 * `folderType` / `ownerType` / `ownerId` are forwarded to Folder9 only on
 * cache miss; on cache hit they're ignored because the registry row already
 * pins the folder type for that key.
 */
export interface ProvisionFolderForMountArgs {
  workspaceId: string;
  scope: 'session' | 'agent' | 'routine' | 'user';
  scopeId: string;
  mountKey: 'tmp' | 'home' | 'document';
  folderType: Folder9FolderType;
  ownerType: Folder9OwnerType;
  ownerId: string;
}

export interface ProvisionFolderForMountResult {
  folder9FolderId: string;
}

/**
 * Lazy + race-safe Folder9 folder provisioning for the workspace mount layer.
 *
 * Flow:
 *   1. SELECT — covers the steady-state cache hit path with no Folder9 traffic.
 *   2. On miss: createFolder via Folder9, then INSERT ... ON CONFLICT DO NOTHING.
 *   3. Re-SELECT — ensures concurrent callers converge on the winning row,
 *      with the loser's just-created folder leaking (logged for follow-up GC).
 *
 * Used by:
 *   - `FolderMapBuilder` (Task 3) — resolves mount → folderId during
 *     bot reply / agent prompt assembly so each mount has a deterministic id.
 *   - Expanded `FolderTokenService` authz (Task 5) — verifies that a token
 *     request's `(scope, scopeId, mountKey)` resolves to the same folderId
 *     before minting a write-scoped Folder9 token.
 */
@Injectable()
export class FolderMountResolver {
  private readonly logger = new Logger(FolderMountResolver.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly folder9: Folder9ClientService,
  ) {}

  async provisionFolderForMount(
    args: ProvisionFolderForMountArgs,
  ): Promise<ProvisionFolderForMountResult> {
    // 1. SELECT first — covers the cache hit (most common steady-state path).
    const existing = await this.lookup(args);
    if (existing) {
      return { folder9FolderId: existing };
    }

    // 2. Cache miss: create Folder9 folder.
    let folder9Id: string;
    try {
      const created = await this.folder9.createFolder(args.workspaceId, {
        name: `${args.scope}-${args.scopeId}-${args.mountKey}`,
        type: args.folderType,
        owner_type: args.ownerType,
        owner_id: args.ownerId,
        metadata: {
          team9Scope: {
            scope: args.scope,
            scopeId: args.scopeId,
            mountKey: args.mountKey,
          },
        },
      });
      folder9Id = created.id;
    } catch (e) {
      if (e instanceof Folder9ApiError) {
        // Mirror FolderTokenService: surface upstream Folder9 outages as 503
        // so the gateway returns a retryable status rather than a 500.
        throw new ServiceUnavailableException(
          `Folder9 createFolder failed: ${e.message}`,
        );
      }
      throw e;
    }

    // 3. INSERT ON CONFLICT DO NOTHING — race-safe. If a concurrent caller
    //    already inserted the same key, this is a no-op.
    await this.db
      .insert(schema.workspaceFolderMounts)
      .values({
        workspaceId: args.workspaceId,
        scope: args.scope,
        scopeId: args.scopeId,
        mountKey: args.mountKey,
        folderType: args.folderType,
        folder9FolderId: folder9Id,
      })
      .onConflictDoNothing();

    // 4. Re-SELECT. If our INSERT was the no-op (race loser), this returns
    //    the winner's folderId; our just-created folder leaks for follow-up
    //    GC. If our INSERT won, this returns our own folderId.
    const winner = await this.lookup(args);
    if (!winner) {
      // Should be unreachable — we just inserted (or someone else did).
      // Treating this as 503 lets the caller retry rather than blow up
      // with a NPE on `winner.folder9FolderId`.
      throw new ServiceUnavailableException(
        'workspace_folder_mounts row missing after insert; concurrent delete?',
      );
    }
    if (winner !== folder9Id) {
      this.logger.warn(
        `Folder9 folder leaked due to race: created=${folder9Id} winner=${winner} ` +
          `key=(${args.workspaceId},${args.scope},${args.scopeId},${args.mountKey})`,
      );
    }
    return { folder9FolderId: winner };
  }

  private async lookup(
    args: Pick<
      ProvisionFolderForMountArgs,
      'workspaceId' | 'scope' | 'scopeId' | 'mountKey'
    >,
  ): Promise<string | undefined> {
    const rows = await this.db
      .select({
        folder9FolderId: schema.workspaceFolderMounts.folder9FolderId,
      })
      .from(schema.workspaceFolderMounts)
      .where(
        and(
          eq(schema.workspaceFolderMounts.workspaceId, args.workspaceId),
          eq(schema.workspaceFolderMounts.scope, args.scope),
          eq(schema.workspaceFolderMounts.scopeId, args.scopeId),
          eq(schema.workspaceFolderMounts.mountKey, args.mountKey),
        ),
      )
      .limit(1);
    return rows[0]?.folder9FolderId;
  }
}
