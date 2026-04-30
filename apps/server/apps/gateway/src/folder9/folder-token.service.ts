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
 * - `session.*`, `agent.*`, `user.*`, `routine.tmp`, `routine.home`:
 *   stub — tenant alignment + bot-existence are still verified, then
 *   a token with the requested permission is minted. **TODO**: real
 *   authorization (session ownership / agent ownership / user-scoped
 *   home-dir gating) needs to land before these scopes ship to
 *   production. Tracked in the dynamic-token-issuance follow-up.
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

    if (callerTenantId !== undefined && callerTenantId !== req.workspaceId) {
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
      // Stub branch for session.*, agent.*, user.*, routine.tmp,
      // routine.home. Tenant alignment is already verified above.
      // TODO(team9-agent-pi #103): replace this stub with real authz
      // when the corresponding agent-pi feature ships:
      //   - session.{tmp,home}: verify session ownership (bot is the
      //     persona attached to the session; sessionId belongs to the
      //     same agent + tenant).
      //   - agent.{tmp,home}: verify the bot is the agent runtime
      //     (agentId matches the bot's managed agent).
      //   - routine.{tmp,home}: verify the bot has access to the
      //     routine (ownership or member-of routine.bots).
      //   - user.{tmp,home}: verify the bot is acting on behalf of
      //     `userId` (mentor relationship, DM channel, etc.).
      this.logger.warn(
        `folder-token issued via stub authz path: logicalKey=${req.logicalKey} ` +
          `bot=${callerBotUserId} workspace=${req.workspaceId}`,
      );
      scopeId = req.routineId ?? req.sessionId;
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
  ): Promise<{ userId: string } | null> {
    const rows = await this.db
      .select({ userId: schema.bots.userId })
      .from(schema.bots)
      .where(
        and(eq(schema.bots.userId, botUserId), eq(schema.bots.isActive, true)),
      )
      .limit(1);
    return rows[0] ?? null;
  }
}
