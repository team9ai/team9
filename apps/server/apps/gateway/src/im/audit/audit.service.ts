import { Injectable, Inject } from '@nestjs/common';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  desc,
  lt,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import type { AuditLog } from '@team9/database/schemas';

@Injectable()
export class AuditService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async log(params: {
    channelId?: string;
    entityType: 'channel' | 'message';
    entityId: string;
    action: string;
    changes: Record<string, { old: unknown; new: unknown }>;
    performedBy?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.db.insert(schema.auditLogs).values({
      channelId: params.channelId,
      entityType: params.entityType,
      entityId: params.entityId,
      action: params.action,
      changes: params.changes,
      performedBy: params.performedBy,
      metadata: params.metadata ?? null,
    });
  }

  async findByChannel(
    channelId: string,
    opts: {
      limit?: number;
      cursor?: string;
      entityType?: string;
      action?: string;
    } = {},
  ): Promise<{ logs: AuditLog[]; nextCursor: string | null }> {
    const limit = opts.limit ?? 50;

    const conditions = [eq(schema.auditLogs.channelId, channelId)];

    if (opts.cursor) {
      conditions.push(lt(schema.auditLogs.createdAt, new Date(opts.cursor)));
    }

    if (opts.entityType) {
      conditions.push(eq(schema.auditLogs.entityType, opts.entityType));
    }

    if (opts.action) {
      conditions.push(eq(schema.auditLogs.action, opts.action));
    }

    const logs = await this.db
      .select()
      .from(schema.auditLogs)
      .where(and(...conditions))
      .orderBy(desc(schema.auditLogs.createdAt), desc(schema.auditLogs.id))
      .limit(limit + 1);

    let nextCursor: string | null = null;

    if (logs.length > limit) {
      logs.pop();
      const lastLog = logs[logs.length - 1];
      nextCursor = lastLog.createdAt.toISOString();
    }

    return { logs, nextCursor };
  }
}
