import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  DATABASE_CONNECTION,
  and,
  desc,
  eq,
  isNull,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import { Folder9ClientService } from './folder9-client.service.js';
import type { CreateWikiDto } from './dto/create-wiki.dto.js';
import type { UpdateWikiDto } from './dto/update-wiki.dto.js';
import type { WikiDto } from './dto/wiki.dto.js';
import { requirePermission } from './utils/permission.js';
import type { Folder9UpdateFolderInput } from './types/folder9.types.js';

/**
 * The acting principal for any Wiki operation. The Controller layer derives
 * `isAgent` from the JWT and passes it through unchanged so the service can
 * apply the right permission table (humanPermission vs agentPermission) and
 * gate human-only operations like `createWiki`.
 */
export interface ActingUser {
  id: string;
  isAgent: boolean;
}

type WikiRow = typeof schema.workspaceWikis.$inferSelect;

/**
 * Normalise a free-form Wiki name into a URL-safe slug:
 *   - lowercase
 *   - replace any run of non-alphanumeric chars with a single dash
 *   - strip leading/trailing dashes
 *   - clamp to 100 chars (matches the slug column constraint)
 *   - fall back to "wiki" if everything stripped away
 */
function deriveSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  return slug || 'wiki';
}

/**
 * Convert a `workspace_wikis` row → `WikiDto` (the wire shape returned to
 * clients). Timestamps are serialised as ISO strings so HTTP responses are
 * deterministic regardless of the JSON serialiser in use.
 */
function toDto(row: WikiRow): WikiDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    slug: row.slug,
    approvalMode: row.approvalMode,
    humanPermission: row.humanPermission,
    agentPermission: row.agentPermission,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
  };
}

/**
 * Manages the `workspace_wikis` table and mirrors lifecycle changes to the
 * folder9 service. CRUD methods only — content operations (tree/page/commit/
 * proposals) are added in Task 6.
 *
 * Each mutation that talks to folder9 uses a "create folder first, then DB"
 * sequence with explicit compensation: if the DB write fails after folder9
 * succeeds, we attempt to roll back the orphan folder. Compensation failures
 * are logged but never mask the original error to the caller.
 */
@Injectable()
export class WikisService {
  private readonly logger = new Logger(WikisService.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly folder9: Folder9ClientService,
  ) {}

  /**
   * List all non-archived Wikis for a workspace. Sorted by `created_at DESC`
   * so newer Wikis surface first in the sidebar.
   */
  async listWikis(workspaceId: string): Promise<WikiDto[]> {
    const rows = await this.db
      .select()
      .from(schema.workspaceWikis)
      .where(
        and(
          eq(schema.workspaceWikis.workspaceId, workspaceId),
          isNull(schema.workspaceWikis.archivedAt),
        ),
      )
      .orderBy(desc(schema.workspaceWikis.createdAt));
    return (rows as WikiRow[]).map(toDto);
  }

  /**
   * Load a single Wiki by id, scoped to its workspace. Throws
   * `NotFoundException` if the row is missing — callers should always invoke
   * this before applying permission checks so unauthorised users still get a
   * 404 rather than a permission leak.
   */
  async getWikiOrThrow(workspaceId: string, wikiId: string): Promise<WikiRow> {
    const rows = (await this.db
      .select()
      .from(schema.workspaceWikis)
      .where(
        and(
          eq(schema.workspaceWikis.id, wikiId),
          eq(schema.workspaceWikis.workspaceId, workspaceId),
        ),
      )
      .limit(1)) as WikiRow[];
    const row = rows[0];
    if (!row) {
      throw new NotFoundException(`Wiki ${wikiId} not found`);
    }
    return row;
  }

  /**
   * Read a Wiki for display. Requires `read` permission (which every level
   * has by definition; the call still routes through `requirePermission` so
   * any future levels below read would be enforced consistently).
   */
  async getWiki(
    workspaceId: string,
    wikiId: string,
    user: ActingUser,
  ): Promise<WikiDto> {
    const wiki = await this.getWikiOrThrow(workspaceId, wikiId);
    requirePermission(wiki, user, 'read');
    return toDto(wiki);
  }

  /**
   * Create a new Wiki:
   *   1. Reject agent callers — only humans may provision Wikis.
   *   2. Derive (or accept) the slug and check it's unique within the workspace.
   *   3. Provision the folder9 folder.
   *   4. Insert the `workspace_wikis` row pointing at the new folder.
   *   5. If step 4 fails, attempt to delete the folder9 folder (compensation).
   *      Compensation failures are logged but never replace the original error.
   */
  async createWiki(
    workspaceId: string,
    user: ActingUser,
    dto: CreateWikiDto,
  ): Promise<WikiDto> {
    if (user.isAgent) {
      throw new ForbiddenException('Agents cannot create Wikis');
    }

    const slug = dto.slug ?? deriveSlug(dto.name);

    const existing = (await this.db
      .select()
      .from(schema.workspaceWikis)
      .where(
        and(
          eq(schema.workspaceWikis.workspaceId, workspaceId),
          eq(schema.workspaceWikis.slug, slug),
        ),
      )
      .limit(1)) as WikiRow[];
    if (existing.length > 0) {
      throw new ConflictException(`Wiki slug '${slug}' already exists`);
    }

    const approvalMode = dto.approvalMode ?? 'auto';
    const humanPermission = dto.humanPermission ?? 'write';
    const agentPermission = dto.agentPermission ?? 'read';

    const folder = await this.folder9.createFolder(workspaceId, {
      name: dto.name,
      type: 'managed',
      owner_type: 'workspace',
      owner_id: workspaceId,
      approval_mode: approvalMode,
    });

    try {
      const inserted = await this.db
        .insert(schema.workspaceWikis)
        .values({
          workspaceId,
          folder9FolderId: folder.id,
          name: dto.name,
          slug,
          approvalMode,
          humanPermission,
          agentPermission,
          createdBy: user.id,
        })
        .returning();
      return toDto(inserted[0]);
    } catch (err) {
      // Compensation: best-effort delete of the orphan folder9 folder. The
      // original error is always re-thrown so the caller sees the real cause.
      try {
        await this.folder9.deleteFolder(workspaceId, folder.id);
      } catch (compensationErr) {
        this.logger.error(
          `Compensation failed: could not delete folder9 folder ${folder.id} after DB insert error`,
          compensationErr instanceof Error
            ? compensationErr.stack
            : String(compensationErr),
        );
      }
      throw err;
    }
  }

  /**
   * Update a Wiki's mutable settings. Requires `write` permission.
   *
   * Mirrors `name` and `approvalMode` changes to folder9 (so the underlying
   * folder display name and review mode stay in sync). Permission changes are
   * stored locally only — folder9 has no concept of human/agent permission
   * tiers and we don't want to trip the API for no reason.
   *
   * Slug uniqueness is re-checked when the slug actually changes.
   */
  async updateWikiSettings(
    workspaceId: string,
    wikiId: string,
    user: ActingUser,
    dto: UpdateWikiDto,
  ): Promise<WikiDto> {
    const wiki = await this.getWikiOrThrow(workspaceId, wikiId);
    requirePermission(wiki, user, 'write');

    if (dto.slug !== undefined && dto.slug !== wiki.slug) {
      const dup = (await this.db
        .select()
        .from(schema.workspaceWikis)
        .where(
          and(
            eq(schema.workspaceWikis.workspaceId, workspaceId),
            eq(schema.workspaceWikis.slug, dto.slug),
          ),
        )
        .limit(1)) as WikiRow[];
      if (dup.length > 0) {
        throw new ConflictException(`Wiki slug '${dto.slug}' already exists`);
      }
    }

    const patch: Partial<WikiRow> = { updatedAt: new Date() };
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.slug !== undefined) patch.slug = dto.slug;
    if (dto.approvalMode !== undefined) patch.approvalMode = dto.approvalMode;
    if (dto.humanPermission !== undefined)
      patch.humanPermission = dto.humanPermission;
    if (dto.agentPermission !== undefined)
      patch.agentPermission = dto.agentPermission;

    const updated = (await this.db
      .update(schema.workspaceWikis)
      .set(patch)
      .where(eq(schema.workspaceWikis.id, wikiId))
      .returning()) as WikiRow[];

    if (dto.name !== undefined || dto.approvalMode !== undefined) {
      const folderPatch: Folder9UpdateFolderInput = {};
      if (dto.name !== undefined) folderPatch.name = dto.name;
      if (dto.approvalMode !== undefined)
        folderPatch.approval_mode = dto.approvalMode;
      await this.folder9.updateFolder(
        workspaceId,
        wiki.folder9FolderId,
        folderPatch,
      );
    }

    return toDto(updated[0]);
  }

  /**
   * Soft-archive a Wiki: sets `archived_at = now()`. The folder9 folder is
   * intentionally NOT deleted — archives keep the underlying git history
   * intact in case a future "restore" feature wants it back, and we don't
   * want a stale UI delete to nuke real data.
   */
  async archiveWiki(
    workspaceId: string,
    wikiId: string,
    user: ActingUser,
  ): Promise<void> {
    const wiki = await this.getWikiOrThrow(workspaceId, wikiId);
    requirePermission(wiki, user, 'write');
    await this.db
      .update(schema.workspaceWikis)
      .set({ archivedAt: new Date() })
      .where(eq(schema.workspaceWikis.id, wikiId));
  }
}
