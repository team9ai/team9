import {
  Inject,
  Injectable,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  Logger,
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
  type Folder9CreateTokenResponse,
  type Folder9Permission,
} from '../wikis/types/folder9.types.js';
import { FolderTokenRequestDto } from './dto/folder-token-request.dto.js';
import { parseSessionShape } from './parse-session-shape.js';

/**
 * Response body for `POST /api/v1/bot/folder-token`.
 *
 * Mirror of `Team9FolderTokenResponse` in
 * `team9-agent-pi/packages/claw-hive-types/src/team9-folder-token.ts`.
 */
export interface FolderTokenResponse {
  token: string;
  /** Unix ms. Absent → treat as long-lived. */
  expiresAt?: number;
}

/**
 * Set of logical keys handled by this endpoint. The agent-pi side
 * (`Team9LogicalMountKey`) is the canonical type — kept loose-typed
 * (string) at the DTO layer so wire validation passes for everything,
 * with semantic acceptance enforced here.
 */
const KNOWN_LOGICAL_KEYS = new Set([
  'session.tmp',
  'session.home',
  'agent.tmp',
  'agent.home',
  'routine.tmp',
  'routine.home',
  'routine.document',
  'user.tmp',
  'user.home',
]);

/**
 * Authorization + Folder9 token minting for the
 * `POST /api/v1/bot/folder-token` endpoint.
 *
 * Serves `JustBashTeam9WorkspaceComponent` (agent-pi side) — the
 * component calls this endpoint at `onSessionStart` to obtain
 * folder-scoped Folder9 tokens on demand, replacing the old model
 * where tokens were pre-minted at session-creation time.
 *
 * ## v1 authz scope
 *
 * - `routine.document`: full authz — caller is a known bot in the
 *   same tenant as the routine, the routine's `folderId` matches the
 *   request's `folderId`, and the requested permission is `read` or
 *   `write` (no `propose`/`admin` for routines in v1).
 * - `session.{tmp,home}`, `agent.{tmp,home}`, `user.{tmp,home}`,
 *   `routine.{tmp,home}`: real authz against `workspace_folder_mounts`
 *   plus logicalKey-specific ownership. Every non-document logicalKey
 *   first requires a matching `workspace_folder_mounts` row keyed by
 *   `(workspaceId, folderId, scope, mountKey)`; the scope-specific
 *   gates layer on top:
 *     * `agent.*`  — `mountRow.scopeId === bot.managedMeta.agentId`.
 *     * `session.*` — parsed sessionId is recognized AND
 *       `parsed.agentId === bot.managedMeta.agentId` AND
 *       `mountRow.scopeId === req.sessionId`.
 *     * `user.*`   — parsed sessionId is a DM AND `req.userId` is a
 *       member of the parsed channel AND `mountRow.scopeId === req.userId`.
 *     * `routine.{tmp,home}` — `req.routineId` is provided AND a
 *       `routines` row exists with `(id=req.routineId, botId=bot.id)`
 *       AND `mountRow.scopeId === req.routineId`.
 * - `admin` permission: never issued from this endpoint, regardless
 *   of logical key. The bot surface is mount-time access; admin-tier
 *   lifecycle ops go through PSK paths.
 * - Cross-tenant: 403. Both `req.workspaceId` and the caller's tenant
 *   (from `TenantMiddleware`) must align with the target resource's
 *   tenant.
 *
 * ## TTL policy
 *
 * - `read`     → 6h. Matches task-worker's A.7 read-token TTL;
 *   executions are usually far shorter but 6h gives retries on
 *   transient folder9 outages without a re-issue round-trip.
 * - `propose`  → 1h. Short window for review-cycle proposals.
 * - `write`    → 1h. The component re-issues at the next session
 *   start if the user comes back later, so we don't need 24h here
 *   (in contrast to the retired A.8 pre-mint). Bounded leak window.
 * - `admin`    → never (rejected up front).
 *
 * ## Naming / audit conventions
 *
 * - `created_by` = `bot:${botUserId}`. The bot is the actor that
 *   authenticated to this endpoint; identifying it directly in the
 *   audit trail beats indirecting through `user:`/`agent:` because
 *   those identifiers may not be present on every logical-key path.
 * - `name` = `${logicalKey}-${scopeId}` where `scopeId` is the
 *   logical scope's identifier (e.g. `routineId` for
 *   `routine.document`, `sessionId` otherwise). folder9 surfaces
 *   `name` in audit logs.
 */
@Injectable()
export class FolderTokenService {
  private readonly logger = new Logger(FolderTokenService.name);

  /** 6h — long-lived read window for executions + retries. */
  private static readonly READ_TTL_MS = 6 * 60 * 60_000;
  /** 1h — write/propose window. */
  private static readonly WRITE_TTL_MS = 60 * 60_000;
  /** 1h — propose mirrors write. */
  private static readonly PROPOSE_TTL_MS = 60 * 60_000;

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly folder9Client: Folder9ClientService,
  ) {}

  /**
   * Authorize a folder-token request and mint the Folder9 token.
   *
   * @param req Validated DTO from the controller.
   * @param callerBotUserId Authenticated bot's user id (`sub` on
   *        the JWT). Already verified against the
   *        `X-Team9-Bot-User-Id` header by the controller.
   * @param callerTenantId Tenant attached by `TenantMiddleware`.
   *        Cross-checked against `req.workspaceId` and (for
   *        routine-scoped requests) the routine's `tenantId` so a
   *        misconfigured caller can't ask for tokens in another
   *        tenant.
   */
  async issueToken(
    req: FolderTokenRequestDto,
    callerBotUserId: string,
    callerTenantId: string | undefined,
  ): Promise<FolderTokenResponse> {
    if (!KNOWN_LOGICAL_KEYS.has(req.logicalKey)) {
      // Unknown logicalKey is treated as a policy denial — the agent-pi
      // client expects 403 → `not_allowed` so the mount degrades cleanly.
      throw new ForbiddenException(`Unknown logicalKey "${req.logicalKey}"`);
    }

    if (req.permission === 'admin') {
      throw new ForbiddenException(
        'admin permission is never issued via this endpoint',
      );
    }

    // I8: fail-closed cross-tenant gate.
    //
    // Previously, an undefined callerTenantId silently bypassed the
    // workspace-id check. That's the wrong default for an authz layer:
    // a caller without a known tenant has no claim on any workspace's
    // resources. Refuse the request loudly with a structured log so
    // ops can spot misconfigured ingress (e.g. middleware not running).
    if (callerTenantId === undefined) {
      this.logger.warn(
        `folder-token: refusing — tenant context missing on caller (botUserId=${callerBotUserId}, workspaceId=${req.workspaceId}, logicalKey=${req.logicalKey})`,
      );
      throw new ForbiddenException('tenant context missing');
    }
    if (callerTenantId !== req.workspaceId) {
      throw new ForbiddenException(
        'Caller tenant does not match requested workspaceId',
      );
    }

    // Bot identity gate — applies to every logical key. The bot must
    // exist and be active in `im_bots`. Cross-tenant bots are caught
    // by the workspaceId check above (TenantMiddleware ties the request
    // to the caller's tenant).
    const bot = await this.loadActiveBotByUserId(callerBotUserId);
    if (!bot) {
      throw new ForbiddenException('Caller is not a known bot user');
    }

    // I7: stub authz scopes are read-only.
    //
    // session.{tmp,home}, agent.{tmp,home}, user.{tmp,home},
    // routine.{tmp,home} ride a stub authz path until real RBAC lands
    // (per design spec). Until then, write/propose access through this
    // endpoint would silently widen the trust boundary, so we cap the
    // permitted action at `read`. routine.document keeps its own real
    // authz (already gated above) and is unaffected.
    const STUB_AUTHZ_LOGICAL_KEYS = new Set([
      'session.tmp',
      'session.home',
      'agent.tmp',
      'agent.home',
      'user.tmp',
      'user.home',
      'routine.tmp',
      'routine.home',
    ]);
    if (
      STUB_AUTHZ_LOGICAL_KEYS.has(req.logicalKey) &&
      req.permission !== 'read'
    ) {
      throw new ForbiddenException('stub authz; only read permitted');
    }

    // Resolve the audit `scopeId` and run logical-key-specific authz.
    let scopeId: string;
    if (req.logicalKey === 'routine.document') {
      if (req.permission === 'propose') {
        throw new ForbiddenException(
          'propose permission is not supported for routine.document in v1',
        );
      }
      const routine = await this.authorizeRoutineDocument(req);
      scopeId = routine.id;
    } else {
      // session.*, agent.*, user.*, routine.{tmp,home}: real authz
      // delegated to a single helper that combines the
      // workspace_folder_mounts row match with the logicalKey-specific
      // ownership check.
      scopeId = await this.authorizeNonDocumentLogicalKey(req, bot);
    }

    // Mint the folder9-scoped token.
    const ttlMs = this.resolveTtlMs(req.permission);
    const createdBy = `bot:${callerBotUserId}`;
    const name = `${req.logicalKey}-${scopeId}`;

    let minted: Folder9CreateTokenResponse;
    try {
      minted = await this.folder9Client.createToken({
        folder_id: req.folderId,
        permission: req.permission as Folder9Permission,
        name,
        created_by: createdBy,
        expires_at: new Date(Date.now() + ttlMs).toISOString(),
      });
    } catch (err) {
      if (err instanceof Folder9ApiError && err.status === 404) {
        throw new NotFoundException(
          `Folder ${req.folderId} not found in folder9`,
        );
      }
      // 5xx + network errors → 503 so the agent-pi client sees
      // `network_error` and degrades the mount with a warning.
      this.logger.error(
        `folder9 createToken failed for folderId=${req.folderId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw new ServiceUnavailableException(
        'folder9 token mint failed; retry later',
      );
    }

    this.logger.debug(
      `folder-token issued: sessionId=${req.sessionId} logicalKey=${req.logicalKey} ` +
        `scopeId=${scopeId} folderId=${req.folderId} permission=${req.permission} ttlMs=${ttlMs}`,
    );

    const response: FolderTokenResponse = { token: minted.token };
    if (minted.expires_at) {
      const parsed = Date.parse(minted.expires_at);
      if (!Number.isNaN(parsed)) {
        response.expiresAt = parsed;
      }
    }
    return response;
  }

  /**
   * Verify the caller is allowed to mint a token for
   * `logicalKey === "routine.document"`. Returns the resolved routine
   * row so the caller can use its id as the audit `scopeId`.
   *
   * Authz checks (in order):
   * 1. Routine exists.
   * 2. `routine.tenantId === req.workspaceId` (already cross-checked
   *    against the caller's tenant earlier).
   * 3. `routine.folderId === req.folderId` — the caller can only mint
   *    a token for the folder this routine actually owns. Mismatch is
   *    403 (folder exists but doesn't belong to the claimed routine).
   * 4. If the caller passed `routineId`, it must match the resolved
   *    routine's id.
   */
  private async authorizeRoutineDocument(
    req: FolderTokenRequestDto,
  ): Promise<{ id: string; tenantId: string; folderId: string | null }> {
    let routine: {
      id: string;
      tenantId: string;
      folderId: string | null;
    } | null;

    if (req.routineId) {
      routine = await this.findRoutineById(req.routineId);
    } else {
      routine = await this.findRoutineByFolderId(req.folderId);
    }

    if (!routine) {
      throw new NotFoundException(
        req.routineId
          ? `Routine ${req.routineId} not found`
          : `No routine found for folderId ${req.folderId}`,
      );
    }

    if (routine.tenantId !== req.workspaceId) {
      throw new ForbiddenException(
        'workspaceId does not match the routine tenant',
      );
    }

    if (routine.folderId !== req.folderId) {
      // Either the routine has no folder yet (legacy/draft) or the
      // caller is asking about a different folder under this routine
      // claim. Either way the bot is not allowed to write through
      // this combination.
      throw new ForbiddenException(
        "folderId does not match the routine's document folder",
      );
    }

    if (req.routineId !== undefined && routine.id !== req.routineId) {
      throw new ForbiddenException('routineId does not match folder ownership');
    }

    return routine;
  }

  private resolveTtlMs(
    permission: FolderTokenRequestDto['permission'],
  ): number {
    switch (permission) {
      case 'read':
        return FolderTokenService.READ_TTL_MS;
      case 'propose':
        return FolderTokenService.PROPOSE_TTL_MS;
      case 'write':
        return FolderTokenService.WRITE_TTL_MS;
      default:
        // `admin` is rejected before reaching this point; kept here
        // as defense-in-depth so an accidental future change can't
        // silently mint an admin token with a stale TTL.
        throw new ForbiddenException(
          `permission ${permission} is not supported`,
        );
    }
  }

  private async findRoutineById(
    routineId: string,
  ): Promise<{ id: string; tenantId: string; folderId: string | null } | null> {
    const rows = await this.db
      .select({
        id: schema.routines.id,
        tenantId: schema.routines.tenantId,
        folderId: schema.routines.folderId,
      })
      .from(schema.routines)
      .where(eq(schema.routines.id, routineId))
      .limit(1);
    return rows[0] ?? null;
  }

  private async findRoutineByFolderId(
    folderId: string,
  ): Promise<{ id: string; tenantId: string; folderId: string | null } | null> {
    const rows = await this.db
      .select({
        id: schema.routines.id,
        tenantId: schema.routines.tenantId,
        folderId: schema.routines.folderId,
      })
      .from(schema.routines)
      .where(eq(schema.routines.folderId, folderId))
      .limit(1);
    return rows[0] ?? null;
  }

  private async loadActiveBotByUserId(
    botUserId: string,
  ): Promise<BotIdentity | null> {
    const rows = await this.db
      .select({
        id: schema.bots.id,
        userId: schema.bots.userId,
        managedMeta: schema.bots.managedMeta,
      })
      .from(schema.bots)
      .where(
        and(eq(schema.bots.userId, botUserId), eq(schema.bots.isActive, true)),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const managedAgentId =
      row.managedMeta &&
      typeof row.managedMeta === 'object' &&
      typeof (row.managedMeta as { agentId?: unknown }).agentId === 'string'
        ? (row.managedMeta as { agentId: string }).agentId
        : null;
    return { id: row.id, userId: row.userId, managedAgentId };
  }

  /**
   * Real authz for `session.*`, `agent.*`, `user.*`, `routine.{tmp,home}`.
   *
   * Common gate: every non-document logicalKey requires a matching
   * `workspace_folder_mounts` row (identified by workspaceId + folderId
   * + scope + mountKey). Without one, the caller is unconditionally
   * unauthorized — the row is what ties a Folder9 folderId to an audit
   * scope inside team9.
   *
   * After the row match, scope-specific ownership tightens the gate:
   *   - `agent.*`: the row's `scopeId` must match the bot's
   *     `managedMeta.agentId`.
   *   - `session.*`: the sessionId must parse, the parsed `agentId`
   *     must match the bot's managed agent, and the row's `scopeId`
   *     must match the request's `sessionId`.
   *   - `user.*`: only valid for DM sessions — the parsed channel must
   *     contain `req.userId`, and the row's `scopeId` must match
   *     `req.userId`.
   *   - `routine.{tmp,home}`: `req.routineId` must be present, the
   *     `routines` row must exist + be owned by the caller bot
   *     (`routines.botId === bot.id`), and the row's `scopeId` must
   *     match `req.routineId`.
   *
   * Returns the resolved audit `scopeId` (used for folder9 token
   * naming + logging).
   */
  private async authorizeNonDocumentLogicalKey(
    req: FolderTokenRequestDto,
    bot: BotIdentity,
  ): Promise<string> {
    const mountKey = req.logicalKey.split('.')[1];
    const scope = req.logicalKey.split('.')[0];
    const mountRow = await this.findWorkspaceFolderMount(
      req.workspaceId,
      req.folderId,
      scope,
      mountKey,
    );
    if (!mountRow) {
      throw new ForbiddenException(
        'No workspace_folder_mounts row matches (workspaceId, folderId, ' +
          'scope, mountKey) — caller is not authorized for this folder',
      );
    }

    switch (req.logicalKey) {
      case 'agent.tmp':
      case 'agent.home': {
        if (!bot.managedAgentId) {
          throw new ForbiddenException(
            'Caller bot has no managed agent — agent.* not allowed',
          );
        }
        if (mountRow.scopeId !== bot.managedAgentId) {
          throw new ForbiddenException(
            'agent.* mount row belongs to a different agent',
          );
        }
        return mountRow.scopeId;
      }

      case 'session.tmp':
      case 'session.home': {
        const shape = parseSessionShape(req.sessionId);
        if (shape.kind === 'unknown') {
          throw new ForbiddenException(`Unparseable sessionId for session.*`);
        }
        if (!bot.managedAgentId || shape.agentId !== bot.managedAgentId) {
          throw new ForbiddenException(
            'sessionId does not belong to caller bot',
          );
        }
        if (mountRow.scopeId !== req.sessionId) {
          throw new ForbiddenException(
            'session.* mount row does not match sessionId',
          );
        }
        return req.sessionId;
      }

      case 'user.tmp':
      case 'user.home': {
        const shape = parseSessionShape(req.sessionId);
        if (shape.kind !== 'dm') {
          throw new ForbiddenException('user.* is only valid for DM sessions');
        }
        if (req.userId === undefined) {
          throw new ForbiddenException('user.* requires userId');
        }
        const isMember = await this.isUserMemberOfChannel(
          shape.channelId,
          req.userId,
        );
        if (!isMember) {
          throw new ForbiddenException(
            'userId is not a member of the DM channel',
          );
        }
        if (mountRow.scopeId !== req.userId) {
          throw new ForbiddenException(
            'user.* mount row does not match userId',
          );
        }
        return req.userId;
      }

      case 'routine.tmp':
      case 'routine.home': {
        if (req.routineId === undefined) {
          throw new ForbiddenException('routine.{tmp,home} requires routineId');
        }
        const routine = await this.loadRoutineByIdAndBot(req.routineId, bot.id);
        if (!routine) {
          throw new ForbiddenException(
            'Routine not found or not owned by caller bot',
          );
        }
        if (mountRow.scopeId !== req.routineId) {
          throw new ForbiddenException(
            'routine.* mount row does not match routineId',
          );
        }
        return req.routineId;
      }

      default:
        // Defense-in-depth — KNOWN_LOGICAL_KEYS already screens the
        // request earlier, and `routine.document` is handled before
        // this helper runs. Anything else here is a server-side bug.
        throw new ForbiddenException(
          `Unsupported logicalKey for non-document authz: ${req.logicalKey}`,
        );
    }
  }

  /**
   * Lookup helper for the `workspace_folder_mounts` row that backs a
   * non-document logicalKey. Lookup is keyed by
   * (workspaceId, folder9FolderId, scope, mountKey) — the unique index
   * on the table makes this an indexed lookup.
   */
  private async findWorkspaceFolderMount(
    workspaceId: string,
    folder9FolderId: string,
    scope: string,
    mountKey: string,
  ): Promise<{ scopeId: string; folderType: string } | null> {
    const rows = await this.db
      .select({
        scopeId: schema.workspaceFolderMounts.scopeId,
        folderType: schema.workspaceFolderMounts.folderType,
      })
      .from(schema.workspaceFolderMounts)
      .where(
        and(
          eq(schema.workspaceFolderMounts.workspaceId, workspaceId),
          eq(schema.workspaceFolderMounts.folder9FolderId, folder9FolderId),
          eq(schema.workspaceFolderMounts.scope, scope),
          eq(schema.workspaceFolderMounts.mountKey, mountKey),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Direct DB membership probe — mirrors the inline pattern in
   * `FileService.canAccessFile` so we don't drag a full `ChannelsService`
   * dependency into this module just for one boolean check. The unique
   * `(channel_id, user_id)` index makes this a single-row lookup.
   */
  private async isUserMemberOfChannel(
    channelId: string,
    userId: string,
  ): Promise<boolean> {
    const rows = await this.db
      .select({ id: schema.channelMembers.id })
      .from(schema.channelMembers)
      .where(
        and(
          eq(schema.channelMembers.channelId, channelId),
          eq(schema.channelMembers.userId, userId),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /**
   * Lookup a routine constrained by both `id` and `botId` — collapses
   * "exists" + "owned by caller bot" into a single round-trip. Returns
   * `null` if either condition fails.
   */
  private async loadRoutineByIdAndBot(
    routineId: string,
    botId: string,
  ): Promise<{ id: string } | null> {
    const rows = await this.db
      .select({ id: schema.routines.id })
      .from(schema.routines)
      .where(
        and(
          eq(schema.routines.id, routineId),
          eq(schema.routines.botId, botId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }
}

/**
 * Caller-bot identity loaded once at the top of {@link FolderTokenService.issueToken}
 * and threaded into every authz helper. `id` is the `im_bots.id` PK,
 * `userId` is the shadow user (matches the JWT `sub`), `managedAgentId`
 * is `managedMeta.agentId` lifted out and narrowed to `string | null`
 * so callers don't need to re-parse the jsonb on every check.
 */
interface BotIdentity {
  id: string;
  userId: string;
  managedAgentId: string | null;
}
