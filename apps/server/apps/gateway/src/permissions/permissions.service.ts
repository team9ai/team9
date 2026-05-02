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
  DATABASE_CONNECTION,
  desc,
  eq,
  isNull,
  type AuthPermissionGrant,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import { isPermissionKey, type PermissionKey } from './permission-keys.js';
import { SpellIdService } from './spell-id.service.js';
import { PermissionsApproverRepository } from './permissions-approver.repository.js';

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
}
