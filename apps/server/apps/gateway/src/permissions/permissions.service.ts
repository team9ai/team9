// apps/server/apps/gateway/src/permissions/permissions.service.ts
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  and,
  authPermissionGrants,
  authPermissionRequests,
  bots,
  DATABASE_CONNECTION,
  desc,
  eq,
  inArray,
  isNull,
  tenantMembers,
  type AuthPermissionGrant,
  type AuthPermissionRequest,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import {
  PERMISSION_KEYS,
  isPermissionKey,
  type PermissionKey,
} from './permission-keys.js';
import { matchesScope } from './permission-matcher.js';
import { SpellIdService } from './spell-id.service.js';
import { PermissionsApproverRepository } from './permissions-approver.repository.js';

export interface CreateRequestInput {
  tenantId: string;
  requesterBotId: string;
  permissionKey: PermissionKey;
  requestedMetadata: Record<string, unknown>;
  reason?: string;
  contextChannelId?: string;
  contextExecutionId?: string;
  contextRoutineId?: string;
  suggestedApproverIds?: string[];
  /** Default: 30 minutes */
  ttlMs?: number;
}

export type DecideInput = {
  requestId: string;
  userId: string;
} & (
  | { decision: 'deny'; note?: string }
  | { decision: 'once'; scopeOverride?: Record<string, unknown>; note?: string }
  | {
      decision: 'remember';
      scopeOverride?: Record<string, unknown>;
      expiresAt?: Date | null;
      rememberSubject?:
        | 'agent'
        | 'channel-session'
        | 'execution-session'
        | 'task';
      note?: string;
    }
);

const DEFAULT_REQUEST_TTL_MS = 30 * 60 * 1000;
/** Number of 3-word attempts before escalating to 4-word spell ids */
const SPELL_3WORD_RETRY_LIMIT = 3;
/** Total attempts before giving up */
const SPELL_MAX_ATTEMPTS = 5;

export const SUBJECT_RANK: Record<string, number> = {
  'execution-session': 4,
  'channel-session': 3,
  task: 2,
  agent: 1,
};

export interface GateContext {
  tenantId: string;
  botId: string;
  channelId?: string;
  executionId?: string;
  routineId?: string;
}

export type GateResult =
  | { allowed: true; via: 'grant'; grantId: string }
  | { allowed: true; via: 'approved_once'; requestId: string }
  | { allowed: false };

export interface CreateGrantInput {
  tenantId: string;
  grantedByUserId: string;
  subjectKind: 'agent' | 'channel-session' | 'execution-session' | 'task';
  subjectId: string;
  permissionKey: PermissionKey;
  scopeMetadata?: Record<string, unknown>;
  expiresAt?: Date | null;
  note?: string | null;
  source?: 'proactive' | 'request_approved';
  requestId?: string | null;
}

export interface ListGrantsInput {
  tenantId: string;
  subjectKind?: CreateGrantInput['subjectKind'];
  subjectId?: string;
  permissionKey?: PermissionKey;
  includeRevoked?: boolean;
}

@Injectable()
export class PermissionsService {
  private readonly logger = new Logger(PermissionsService.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly events: EventEmitter2,
    private readonly spell: SpellIdService,
    private readonly approvers: PermissionsApproverRepository,
  ) {}

  async createGrant(input: CreateGrantInput): Promise<AuthPermissionGrant> {
    if (!isPermissionKey(input.permissionKey)) {
      throw new BadRequestException(
        `Unknown permission key: ${String(input.permissionKey)}`,
      );
    }
    const [row] = await this.db
      .insert(authPermissionGrants)
      .values({
        tenantId: input.tenantId,
        grantedByUserId: input.grantedByUserId,
        subjectKind: input.subjectKind,
        subjectId: input.subjectId,
        permissionKey: input.permissionKey,
        scopeMetadata: input.scopeMetadata ?? {},
        source: input.source ?? 'proactive',
        requestId: input.requestId ?? null,
        expiresAt: input.expiresAt ?? null,
        note: input.note ?? null,
      })
      .returning();
    if (!row) {
      throw new Error('insert returned empty');
    }
    this.events.emit('permissions.grant.created', {
      id: row.id,
      tenantId: row.tenantId,
      subjectKind: row.subjectKind,
      subjectId: row.subjectId,
      permissionKey: row.permissionKey,
      scopeMetadata: row.scopeMetadata,
    });
    return row;
  }

  async revokeGrant(input: {
    grantId: string;
    userId: string;
  }): Promise<AuthPermissionGrant> {
    const [row] = await this.db
      .update(authPermissionGrants)
      .set({ revokedAt: new Date(), revokedByUserId: input.userId })
      .where(
        and(
          eq(authPermissionGrants.id, input.grantId),
          isNull(authPermissionGrants.revokedAt),
        ),
      )
      .returning();
    if (!row)
      throw new NotFoundException(
        `Grant ${input.grantId} not found or already revoked`,
      );
    this.events.emit('permissions.grant.revoked', {
      id: row.id,
      tenantId: row.tenantId,
    });
    return row;
  }

  async listGrants(input: ListGrantsInput): Promise<AuthPermissionGrant[]> {
    const where = [eq(authPermissionGrants.tenantId, input.tenantId)];
    if (input.subjectKind)
      where.push(eq(authPermissionGrants.subjectKind, input.subjectKind));
    if (input.subjectId)
      where.push(eq(authPermissionGrants.subjectId, input.subjectId));
    if (input.permissionKey)
      where.push(eq(authPermissionGrants.permissionKey, input.permissionKey));
    if (!input.includeRevoked)
      where.push(isNull(authPermissionGrants.revokedAt));
    return this.db.query.authPermissionGrants.findMany({
      where: and(...where),
      orderBy: [desc(authPermissionGrants.createdAt)],
    });
  }

  async gate(input: {
    key: PermissionKey;
    metadata: Record<string, unknown>;
    ctx: GateContext;
  }): Promise<GateResult> {
    // 1. Build candidate subject matchers
    const subjectMatchers: Array<{ kind: string; id: string }> = [
      { kind: 'agent', id: input.ctx.botId },
    ];
    if (input.ctx.channelId)
      subjectMatchers.push({
        kind: 'channel-session',
        id: input.ctx.channelId,
      });
    if (input.ctx.executionId)
      subjectMatchers.push({
        kind: 'execution-session',
        id: input.ctx.executionId,
      });
    if (input.ctx.routineId)
      subjectMatchers.push({ kind: 'task', id: input.ctx.routineId });

    // Fetch candidate grants filtered at SQL level (tenantId + key + not revoked)
    const grants = await this.db.query.authPermissionGrants.findMany({
      where: and(
        eq(authPermissionGrants.tenantId, input.ctx.tenantId),
        eq(authPermissionGrants.permissionKey, input.key),
        isNull(authPermissionGrants.revokedAt),
      ),
    });

    const now = Date.now();
    // Filter expired and non-matching subjects in JS, then sort by specificity
    const filtered = grants
      .filter((g) => !g.expiresAt || g.expiresAt.getTime() > now)
      .filter((g) =>
        subjectMatchers.some(
          (m) => m.kind === g.subjectKind && m.id === g.subjectId,
        ),
      )
      .sort(
        (a, b) =>
          (SUBJECT_RANK[b.subjectKind] ?? 0) -
          (SUBJECT_RANK[a.subjectKind] ?? 0),
      );

    for (const g of filtered) {
      if (matchesScope(input.metadata, g.scopeMetadata ?? {})) {
        return { allowed: true, via: 'grant', grantId: g.id };
      }
    }

    // 2. Fall through to once-approvals
    const candidate = await this.db.query.authPermissionRequests.findFirst({
      where: and(
        eq(authPermissionRequests.tenantId, input.ctx.tenantId),
        eq(authPermissionRequests.requesterBotId, input.ctx.botId),
        eq(authPermissionRequests.permissionKey, input.key),
        eq(authPermissionRequests.status, 'approved_once'),
        isNull(authPermissionRequests.consumedAt),
      ),
      orderBy: [desc(authPermissionRequests.decidedAt)],
    });

    if (
      candidate &&
      matchesScope(input.metadata, candidate.requestedMetadata ?? {}) &&
      (!candidate.contextChannelId ||
        candidate.contextChannelId === input.ctx.channelId) &&
      (!candidate.contextExecutionId ||
        candidate.contextExecutionId === input.ctx.executionId)
    ) {
      // Race-safe consume: only one concurrent caller will win
      const [consumed] = await this.db
        .update(authPermissionRequests)
        .set({ consumedAt: new Date() })
        .where(
          and(
            eq(authPermissionRequests.id, candidate.id),
            isNull(authPermissionRequests.consumedAt),
          ),
        )
        .returning();

      if (consumed) {
        this.events.emit('permissions.request.consumed', {
          id: consumed.id,
          requesterBotId: input.ctx.botId,
          permissionKey: input.key,
        });
        return { allowed: true, via: 'approved_once', requestId: consumed.id };
      }
      // Race lost — fall through to DENY
    }

    return { allowed: false };
  }

  // ---------------------------------------------------------------------------
  // Request lifecycle
  // ---------------------------------------------------------------------------

  async createRequest(input: CreateRequestInput) {
    const ttl = input.ttlMs ?? DEFAULT_REQUEST_TTL_MS;
    const expiresAt = new Date(Date.now() + ttl);

    let attempt = 0;
    while (true) {
      const wordCount = attempt < SPELL_3WORD_RETRY_LIMIT ? 3 : 4;
      const spellId = this.spell.generate({ wordCount });
      try {
        const [row] = await this.db
          .insert(authPermissionRequests)
          .values({
            spellId,
            tenantId: input.tenantId,
            requesterBotId: input.requesterBotId,
            contextChannelId: input.contextChannelId ?? null,
            contextExecutionId: input.contextExecutionId ?? null,
            contextRoutineId: input.contextRoutineId ?? null,
            permissionKey: input.permissionKey,
            requestedMetadata: input.requestedMetadata,
            suggestedApproverIds: input.suggestedApproverIds ?? [],
            reason: input.reason ?? null,
            status: 'pending',
            expiresAt,
          })
          .returning();
        const approverIds = await this.resolveApprovers({
          id: row.id,
          tenantId: row.tenantId,
          requesterBotId: row.requesterBotId,
          permissionKey: input.permissionKey,
          requestedMetadata: row.requestedMetadata,
          suggestedApproverIds: row.suggestedApproverIds ?? [],
          contextChannelId: row.contextChannelId,
          contextExecutionId: row.contextExecutionId,
          contextRoutineId: row.contextRoutineId,
        });
        this.events.emit('permissions.request.created', {
          id: row.id,
          spellId: row.spellId,
          tenantId: row.tenantId,
          requesterBotId: row.requesterBotId,
          permissionKey: row.permissionKey,
          requestedMetadata: row.requestedMetadata,
          contextChannelId: row.contextChannelId,
          expiresAt: row.expiresAt,
          reason: row.reason,
          approverIds,
        });
        return row;
      } catch (err) {
        if (this.isUniqueViolation(err) && attempt < SPELL_MAX_ATTEMPTS - 1) {
          attempt += 1;
          continue;
        }
        throw err;
      }
    }
  }

  async cancelRequest(input: { requestId: string; requesterBotId: string }) {
    const [row] = await this.db
      .update(authPermissionRequests)
      .set({ status: 'cancelled' })
      .where(
        and(
          eq(authPermissionRequests.id, input.requestId),
          eq(authPermissionRequests.requesterBotId, input.requesterBotId),
          eq(authPermissionRequests.status, 'pending'),
        ),
      )
      .returning();
    if (!row) {
      throw new NotFoundException('Request not found or already decided');
    }
    this.events.emit('permissions.request.decided', {
      id: row.id,
      spellId: row.spellId,
      status: row.status,
      decidedByUserId: null,
    });
    return row;
  }

  async decideRequest(input: DecideInput) {
    const existing = await this.db.query.authPermissionRequests.findFirst({
      where: eq(authPermissionRequests.id, input.requestId),
    });
    if (!existing) {
      throw new NotFoundException(`Request ${input.requestId} not found`);
    }
    if (existing.status !== 'pending') {
      throw new ConflictException(
        `Request ${input.requestId} is already ${existing.status}`,
      );
    }

    return this.db.transaction(async (tx) => {
      let durableGrantId: string | null = null;
      const newMetadata =
        'scopeOverride' in input && input.scopeOverride
          ? input.scopeOverride
          : existing.requestedMetadata;

      if (input.decision === 'remember') {
        const subjectKind =
          input.rememberSubject ?? this.defaultRememberSubject(existing);
        const subjectId = this.subjectIdFor(subjectKind, existing);
        const [grantRow] = await tx
          .insert(authPermissionGrants)
          .values({
            tenantId: existing.tenantId,
            grantedByUserId: input.userId,
            subjectKind,
            subjectId,
            permissionKey: existing.permissionKey,
            scopeMetadata: newMetadata,
            source: 'request_approved',
            requestId: existing.id,
            expiresAt: 'expiresAt' in input ? (input.expiresAt ?? null) : null,
            note: input.note ?? null,
          })
          .returning();
        durableGrantId = grantRow.id;
        this.events.emit('permissions.grant.created', {
          id: grantRow.id,
          tenantId: existing.tenantId,
        });
      }

      const newStatus =
        input.decision === 'deny'
          ? 'denied'
          : input.decision === 'once'
            ? 'approved_once'
            : 'approved_durable';

      const [updated] = await tx
        .update(authPermissionRequests)
        .set({
          status: newStatus,
          decidedByUserId: input.userId,
          decidedAt: new Date(),
          decisionNote: input.note ?? null,
          requestedMetadata: newMetadata,
          durableGrantId,
        })
        .where(eq(authPermissionRequests.id, existing.id))
        .returning();

      this.events.emit('permissions.request.decided', {
        id: updated.id,
        spellId: updated.spellId,
        status: updated.status,
        decidedByUserId: input.userId,
        durableGrantId,
      });
      return updated;
    });
  }

  async resolveApprovers(req: {
    id: string;
    tenantId: string;
    requesterBotId: string;
    permissionKey: PermissionKey;
    requestedMetadata: Record<string, unknown>;
    suggestedApproverIds: string[];
    contextChannelId: string | null;
    contextExecutionId: string | null;
    contextRoutineId: string | null;
  }): Promise<string[]> {
    const def = PERMISSION_KEYS[req.permissionKey];
    const primary = await def.resolveApprovers(
      {
        tenantId: req.tenantId,
        requesterBotId: req.requesterBotId,
        permissionKey: req.permissionKey,
        metadata: req.requestedMetadata,
        contextChannelId: req.contextChannelId,
        contextExecutionId: req.contextExecutionId,
        contextRoutineId: req.contextRoutineId,
      },
      { repo: this.approvers },
    );

    // Validate suggested approvers belong to same tenant (drop foreign-tenant entries)
    const suggested = req.suggestedApproverIds ?? [];
    let validSuggested: string[] = [];
    if (suggested.length) {
      const rows = await this.db.query.tenantMembers.findMany({
        where: and(
          eq(tenantMembers.tenantId, req.tenantId),
          inArray(tenantMembers.userId, suggested),
        ),
        columns: { userId: true },
      });
      validSuggested = rows.map((r) => r.userId);
      const dropped = suggested.filter((id) => !validSuggested.includes(id));
      if (dropped.length) {
        this.logger.warn(
          `Dropped foreign-tenant suggested approvers for request ${req.id}: ${dropped.join(', ')}`,
        );
      }
    }

    const union = new Set([...primary, ...validSuggested]);

    // Fallback when primary union is empty
    if (union.size === 0) {
      if (def.defaultApprovers === 'workspace-admins') {
        const ids = await this.approvers.findWorkspaceAdmins(req.tenantId);
        ids.forEach((id) => union.add(id));
      } else if (def.defaultApprovers === 'bot-owners') {
        const ids = await this.approvers.findBotOwnerAndMentor(
          req.requesterBotId,
        );
        ids.forEach((id) => union.add(id));
      }
    }

    // Workspace owners always included as safety net
    const wsOwners = await this.approvers.findWorkspaceOwners(req.tenantId);
    wsOwners.forEach((id) => union.add(id));

    return [...union];
  }

  async canDecide(
    userId: string,
    request: Parameters<this['resolveApprovers']>[0],
  ): Promise<boolean> {
    const ids = await this.resolveApprovers(request);
    return ids.includes(userId);
  }

  /**
   * Fetch a single permission request by its ID.
   * Returns null when the request does not exist.
   */
  async getRequest(id: string) {
    return (
      this.db.query.authPermissionRequests.findFirst({
        where: eq(authPermissionRequests.id, id),
      }) ?? null
    );
  }

  /**
   * Returns user IDs of all workspace admins (owners + admins) for the tenant.
   * Delegates to the approver repository.
   */
  async listAdminsForTenant(tenantId: string): Promise<string[]> {
    return this.approvers.findWorkspaceAdmins(tenantId);
  }

  /**
   * List permission requests visible to the caller.
   *
   * - scope 'mine': requests created by the bot whose shadow user is userId, OR
   *   requests where the caller is a potential approver (tenantId scoped).
   * - scope 'tenant': all requests for the tenant (admins only in practice —
   *   authorization enforced at controller layer).
   */
  async listRequests(input: {
    tenantId: string;
    userId: string;
    status?: string;
    scope?: 'mine' | 'tenant';
  }): Promise<AuthPermissionRequest[]> {
    const where = [eq(authPermissionRequests.tenantId, input.tenantId)];
    if (input.status) {
      where.push(eq(authPermissionRequests.status, input.status as never));
    }
    return this.db.query.authPermissionRequests.findMany({
      where: and(...where),
      orderBy: [desc(authPermissionRequests.createdAt)],
    });
  }

  /**
   * Fetch a single permission request by its spell ID (case-insensitive).
   * Returns null when the request does not exist.
   */
  async getRequestBySpell(
    spell: string,
  ): Promise<AuthPermissionRequest | null> {
    const normalized = spell.toLowerCase();
    return (
      (await this.db.query.authPermissionRequests.findFirst({
        where: eq(authPermissionRequests.spellId, normalized),
      })) ?? null
    );
  }

  /**
   * Resolve the bot ID that corresponds to the given shadow-user ID.
   * Throws ForbiddenException if the user is not a bot.
   */
  async requireBotIdForUser(userId: string): Promise<string> {
    const row = await this.db.query.bots.findFirst({
      where: eq(bots.userId, userId),
      columns: { id: true },
    });
    if (!row) {
      throw new ForbiddenException(
        'Only bot accounts may create or cancel permission requests',
      );
    }
    return row.id;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private isUniqueViolation(err: unknown): boolean {
    return Boolean(
      err &&
      typeof err === 'object' &&
      (err as { code?: string }).code === '23505',
    );
  }

  private defaultRememberSubject(req: {
    contextChannelId: string | null;
    contextRoutineId: string | null;
  }): 'agent' | 'channel-session' | 'task' {
    if (req.contextChannelId) return 'channel-session';
    if (req.contextRoutineId) return 'task';
    return 'agent';
  }

  private subjectIdFor(
    kind: 'agent' | 'channel-session' | 'execution-session' | 'task',
    req: {
      requesterBotId: string;
      contextChannelId: string | null;
      contextExecutionId: string | null;
      contextRoutineId: string | null;
    },
  ): string {
    switch (kind) {
      case 'agent':
        return req.requesterBotId;
      case 'channel-session':
        if (!req.contextChannelId) {
          throw new BadRequestException(
            'No channel context for channel-session subject',
          );
        }
        return req.contextChannelId;
      case 'execution-session':
        if (!req.contextExecutionId) {
          throw new BadRequestException(
            'No execution context for execution-session subject',
          );
        }
        return req.contextExecutionId;
      case 'task':
        if (!req.contextRoutineId) {
          throw new BadRequestException('No routine context for task subject');
        }
        return req.contextRoutineId;
    }
  }
}
