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
import type { TreeEntryDto } from './dto/tree-entry.dto.js';
import type { PageDto } from './dto/page.dto.js';
import type { CommitPageDto } from './dto/commit-page.dto.js';
import type { ProposalDto } from './dto/proposal.dto.js';
import {
  requirePermission,
  resolveWikiPermission,
} from './utils/permission.js';
import { parseFrontmatter } from './utils/frontmatter.js';
import {
  Folder9ApiError,
  Folder9Permission,
  type Folder9Proposal,
  type Folder9UpdateFolderInput,
} from './types/folder9.types.js';

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
 * Local TTL for cached folder9 tokens. We mint tokens with a slightly longer
 * folder9-side expiry ({@link TOKEN_MINT_TTL_MS}) so that the local cache
 * always invalidates before the remote token does — a freshly-minted token
 * returned from the cache is guaranteed to still be valid at folder9.
 */
const TOKEN_CACHE_TTL_MS = 15 * 60 * 1000;

/**
 * Requested `expires_at` when minting: one minute past the local cache TTL.
 * Stays comfortably under folder9's 24h server-side cap. Passed as RFC3339.
 */
const TOKEN_MINT_TTL_MS = 16 * 60 * 1000;

/**
 * Cache entry for a folder9-scoped token.
 *
 * `expiresAt` is a Unix-ms absolute deadline (Date.now() + {@link TOKEN_CACHE_TTL_MS}
 * at mint time). On hit, we only reuse the token if `Date.now() < expiresAt`.
 */
interface CachedToken {
  token: string;
  expiresAt: number;
}

/**
 * Build a stable cache key from the tuple that uniquely identifies a token's
 * attribution: folder + permission + created_by. `created_by` must participate
 * in the key because folder9 uses the token's creator string verbatim as the
 * git author/committer for commits routed through that token, so two users
 * cannot safely share a single write-scoped token.
 */
function tokenCacheKey(
  folder9FolderId: string,
  permission: Folder9Permission,
  createdBy: string,
): string {
  return `${folder9FolderId}::${permission}::${createdBy}`;
}

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

  /**
   * In-memory cache of folder9 tokens keyed by `folderId::permission::createdBy`.
   * Entries are refreshed lazily inside {@link getFolderToken} when expired.
   *
   * Since tokens are fetched on-demand and short-lived, we intentionally
   * keep this cache in-process rather than pushing it into Redis — losing a
   * few minutes of tokens on restart just means one extra mint per folder.
   */
  private readonly tokenCache = new Map<string, CachedToken>();

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

  // ────────────────────────────────────────────────────────────────────
  // Content operations (tree / page / commit / proposals)
  // ────────────────────────────────────────────────────────────────────

  /**
   * List tree entries under a Wiki. Requires `read` permission. The folder9
   * response is passed through unchanged — any filtering (e.g. hiding
   * dot-prefixed paths) is a concern for a higher layer, not the service.
   *
   * Uses a per-folder read-scoped token fetched via {@link getFolderToken}.
   * The token's `created_by` is the wiki id (not the user) so all read calls
   * for the same wiki share a single cached token regardless of caller.
   */
  async getTree(
    workspaceId: string,
    wikiId: string,
    user: ActingUser,
    opts: { path?: string; recursive?: boolean } = {},
  ): Promise<TreeEntryDto[]> {
    const wiki = await this.getWikiOrThrow(workspaceId, wikiId);
    requirePermission(wiki, user, 'read');
    const token = await this.getFolderToken(
      wiki.folder9FolderId,
      'read',
      this.readCreatedBy(wiki),
    );
    const entries = await this.folder9.getTree(
      workspaceId,
      wiki.folder9FolderId,
      token,
      {
        path: opts.path ?? '/',
        recursive: opts.recursive ?? false,
      },
    );
    return entries.map((e) => ({
      name: e.name,
      path: e.path,
      type: e.type,
      size: e.size,
    }));
  }

  /**
   * Fetch a single page from a Wiki. Requires `read` permission.
   *
   * Parses YAML frontmatter from the blob content and returns the page with
   * the frontmatter split out from the body. Malformed frontmatter is logged
   * at warn level and treated as "no frontmatter" — the raw body is returned
   * untouched so the caller can still see the content (never throw on a
   * parse failure; the UI must remain usable even for a damaged file).
   */
  async getPage(
    workspaceId: string,
    wikiId: string,
    user: ActingUser,
    path: string,
  ): Promise<PageDto> {
    const wiki = await this.getWikiOrThrow(workspaceId, wikiId);
    requirePermission(wiki, user, 'read');
    const token = await this.getFolderToken(
      wiki.folder9FolderId,
      'read',
      this.readCreatedBy(wiki),
    );
    const blob = await this.folder9.getBlob(
      workspaceId,
      wiki.folder9FolderId,
      token,
      path,
    );
    let frontmatter: Record<string, unknown> = {};
    let body = blob.content;
    try {
      const parsed = parseFrontmatter(blob.content);
      frontmatter = parsed.frontmatter;
      body = parsed.body;
    } catch (err) {
      // parseFrontmatter only throws FrontmatterParseError (an Error
      // subclass). Cast rather than narrow so we don't leave a dead
      // `instanceof Error` branch that no test can reach.
      this.logger.warn(
        `Malformed frontmatter in wiki ${wikiId} page "${path}": ${(err as Error).message} — returning raw body with empty frontmatter`,
      );
    }
    return {
      path,
      content: body,
      frontmatter,
      lastCommit: null,
    };
  }

  /**
   * Commit one or more file changes to a Wiki.
   *
   * Permission logic (per the design spec §"Commit Handling: auto vs review"):
   *
   *   | approvalMode | user perm | dto.propose | result                       |
   *   |--------------|-----------|-------------|------------------------------|
   *   | auto         | write     | false/undef | direct commit (propose=false)|
   *   | auto         | write     | true        | proposal (propose=true)      |
   *   | auto         | propose   | any         | proposal (propose=true)      |
   *   | review       | write     | any         | proposal (propose=true)      |
   *   | review       | propose   | any         | proposal (propose=true)      |
   *   | any          | read      | any         | ForbiddenException           |
   *
   * `approvalMode=review` forces everyone through a proposal — write users do
   * NOT bypass review (the spec is explicit about this being the whole point
   * of the review mode).
   *
   * The acting user's displayName/email is passed to folder9 via the token's
   * `created_by` field (folder9 uses it as both git author name and to build
   * the author email). Since folder9's commit endpoint does NOT accept
   * authorName/authorEmail in the request body (confirmed by reading
   * folder9/internal/api/handlers_files.go), routing the attribution through
   * the token is the only way to attribute the commit to a human.
   */
  async commitPage(
    workspaceId: string,
    wikiId: string,
    user: ActingUser,
    dto: CommitPageDto,
  ): Promise<{
    commit: { sha: string };
    proposal: { id: string; status: string } | null;
  }> {
    const wiki = await this.getWikiOrThrow(workspaceId, wikiId);
    const actualPerm = resolveWikiPermission(wiki, user);

    // Determine the effective propose flag first — this drives both the
    // required permission floor and the folder9 commit body.
    const effectivePropose =
      dto.propose === true ||
      wiki.approvalMode === 'review' ||
      actualPerm === 'propose';

    // Users going through the proposal path only need `propose`; direct
    // commits need full `write`. This also covers the read-only denial path.
    requirePermission(wiki, user, effectivePropose ? 'propose' : 'write');

    const profile = await this.loadUserProfile(user);
    const tokenPermission: Folder9Permission = effectivePropose
      ? 'propose'
      : 'write';
    const token = await this.getFolderToken(
      wiki.folder9FolderId,
      tokenPermission,
      profile.displayName,
    );

    try {
      const result = await this.folder9.commit(
        workspaceId,
        wiki.folder9FolderId,
        token,
        {
          message: dto.message,
          files: dto.files,
          propose: effectivePropose,
        },
      );
      return {
        commit: { sha: result.commit },
        proposal: result.proposal_id
          ? { id: result.proposal_id, status: 'pending' }
          : null,
      };
    } catch (err) {
      if (err instanceof Folder9ApiError && err.status === 409) {
        throw new ConflictException('Commit conflicts with current page');
      }
      throw err;
    }
  }

  /**
   * List proposals for a Wiki. Requires `read` permission. Maps folder9's
   * snake_case proposal shape onto our camelCase `ProposalDto`.
   *
   * `reviewedAt` is always `null` here because folder9 does not surface a
   * reviewed-at timestamp on proposals (confirmed by
   * internal/api/handlers_proposals.go). If/when folder9 adds it, widen this
   * mapping rather than inventing a value.
   */
  async listProposals(
    workspaceId: string,
    wikiId: string,
    user: ActingUser,
    opts: { status?: string } = {},
  ): Promise<ProposalDto[]> {
    const wiki = await this.getWikiOrThrow(workspaceId, wikiId);
    requirePermission(wiki, user, 'read');
    const token = await this.getFolderToken(
      wiki.folder9FolderId,
      'read',
      this.readCreatedBy(wiki),
    );
    const proposals = await this.folder9.listProposals(
      workspaceId,
      wiki.folder9FolderId,
      token,
      opts,
    );
    return proposals.map((p: Folder9Proposal) => ({
      id: p.id,
      wikiId,
      title: p.title,
      description: p.description,
      status: p.status === 'merged' ? 'approved' : p.status,
      authorId: p.author_id,
      authorType: p.author_type === 'user' ? 'user' : 'agent',
      createdAt: p.created_at,
      reviewedBy: p.reviewed_by ?? null,
      reviewedAt: null,
    }));
  }

  /**
   * Approve a pending proposal. Requires `write` permission. folder9's 409
   * response (proposal already resolved or merge conflict) is re-thrown as
   * NestJS `ConflictException` so the controller maps it to HTTP 409.
   */
  async approveProposal(
    workspaceId: string,
    wikiId: string,
    user: ActingUser,
    proposalId: string,
  ): Promise<void> {
    const wiki = await this.getWikiOrThrow(workspaceId, wikiId);
    requirePermission(wiki, user, 'write');
    const profile = await this.loadUserProfile(user);
    const token = await this.getFolderToken(
      wiki.folder9FolderId,
      'write',
      profile.displayName,
    );
    try {
      await this.folder9.approveProposal(
        workspaceId,
        wiki.folder9FolderId,
        proposalId,
        token,
        user.id,
      );
    } catch (err) {
      if (err instanceof Folder9ApiError && err.status === 409) {
        throw new ConflictException(
          'Proposal already resolved or conflicts with main',
        );
      }
      throw err;
    }
  }

  /**
   * Reject a pending proposal with an optional reason. Requires `write`
   * permission.
   */
  async rejectProposal(
    workspaceId: string,
    wikiId: string,
    user: ActingUser,
    proposalId: string,
    reason?: string,
  ): Promise<void> {
    const wiki = await this.getWikiOrThrow(workspaceId, wikiId);
    requirePermission(wiki, user, 'write');
    const profile = await this.loadUserProfile(user);
    const token = await this.getFolderToken(
      wiki.folder9FolderId,
      'write',
      profile.displayName,
    );
    await this.folder9.rejectProposal(
      workspaceId,
      wiki.folder9FolderId,
      proposalId,
      token,
      user.id,
      reason,
    );
  }

  /**
   * Fetch-or-mint a folder9 scoped token for `(folderId, permission, createdBy)`.
   *
   * Cache hits reuse the token as long as the local deadline (`expiresAt`,
   * Date.now() + {@link TOKEN_CACHE_TTL_MS} at mint time) has not passed. On
   * miss or expiry we call folder9 `POST /api/tokens` and store the fresh
   * token. The folder9-side `expires_at` is set one minute past the local
   * TTL so a freshly-cached token can never be expired on the remote.
   */
  private async getFolderToken(
    folder9FolderId: string,
    permission: Folder9Permission,
    createdBy: string,
  ): Promise<string> {
    const key = tokenCacheKey(folder9FolderId, permission, createdBy);
    const now = Date.now();
    const cached = this.tokenCache.get(key);
    if (cached && cached.expiresAt > now) {
      return cached.token;
    }

    const expiresAt = new Date(now + TOKEN_MINT_TTL_MS).toISOString();
    const minted = await this.folder9.createToken({
      folder_id: folder9FolderId,
      permission,
      name: `wiki-${permission}`,
      created_by: createdBy,
      expires_at: expiresAt,
    });

    this.tokenCache.set(key, {
      token: minted.token,
      expiresAt: now + TOKEN_CACHE_TTL_MS,
    });
    return minted.token;
  }

  /**
   * Stable `created_by` value used for all read-scoped tokens on a given
   * Wiki. Using the folder9 folder id means every reader (human or agent)
   * shares one cached token per wiki, which is the behaviour the
   * TOKEN_CACHE_TTL_MS design is tuned for.
   */
  private readCreatedBy(wiki: WikiRow): string {
    return `wiki:${wiki.folder9FolderId}`;
  }

  /**
   * Fetch the acting user's display name + email for git author attribution.
   *
   * Falls back to a synthetic identity (`user.id` / `${user.id}@team9.internal`)
   * if the users row is missing or the display name column is null. Agents
   * go through the same lookup — if there's no row we use the id fallback,
   * which cleanly tags commits as `agent:xyz` in git history.
   */
  private async loadUserProfile(
    user: ActingUser,
  ): Promise<{ displayName: string; email: string }> {
    const rows = (await this.db
      .select({
        displayName: schema.users.displayName,
        email: schema.users.email,
      })
      .from(schema.users)
      .where(eq(schema.users.id, user.id))
      .limit(1)) as Array<{ displayName: string | null; email: string }>;
    const row = rows[0];
    return {
      displayName: row?.displayName ?? user.id,
      email: row?.email ?? `${user.id}@team9.internal`,
    };
  }
}
