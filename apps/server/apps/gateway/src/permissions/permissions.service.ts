// apps/server/apps/gateway/src/permissions/permissions.service.ts
import {
  BadRequestException,
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
  DATABASE_CONNECTION,
  desc,
  eq,
  isNull,
  type AuthPermissionGrant,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import { isPermissionKey, type PermissionKey } from './permission-keys.js';
import { matchesScope } from './permission-matcher.js';
import { SpellIdService } from './spell-id.service.js';
import { PermissionsApproverRepository } from './permissions-approver.repository.js';

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
}
