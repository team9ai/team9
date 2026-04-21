import { Injectable, Inject } from '@nestjs/common';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  inArray,
  desc,
  sql,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import type { MessageRefConfig } from '@team9/shared';
import {
  RelationError,
  RelationSourceNotFoundError,
  RelationTargetNotFoundError,
} from './message-relations.errors.js';

const { messageRelations, messages } = schema;

export interface SetRelationTargetsParams {
  sourceMessageId: string;
  targetMessageIds: string[];
  definition: {
    id: string;
    channelId: string;
    config: MessageRefConfig;
  };
  actorId: string;
}

export interface SetRelationTargetsResult {
  addedTargetIds: string[];
  removedTargetIds: string[];
  currentTargetIds: string[];
}

export interface IncomingSource {
  sourceMessageId: string;
  propertyDefinitionId: string;
}

@Injectable()
export class MessageRelationsService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async setRelationTargets(
    params: SetRelationTargetsParams,
  ): Promise<SetRelationTargetsResult> {
    const { sourceMessageId, targetMessageIds, definition, actorId } = params;
    const { config } = definition;

    // Dedupe inputs
    const desired = Array.from(new Set(targetMessageIds));

    // Self-reference check
    if (desired.includes(sourceMessageId)) {
      throw new RelationError('SELF_REFERENCE');
    }

    // Cardinality check
    if (config.cardinality === 'single' && desired.length > 1) {
      throw new RelationError('CARDINALITY_EXCEEDED');
    }

    // relationKind is required when inserting relations — fail loudly if missing
    if (desired.length > 0 && !config.relationKind) {
      throw new RelationError(
        'DEFINITION_CONFLICT',
        'MessageRelationsService.setRelationTargets called without config.relationKind',
      );
    }

    return this.db.transaction(async (tx) => {
      // Load source message for channelId + tenantId
      const [source] = await tx
        .select({
          channelId: messages.channelId,
          tenantId: messages.tenantId,
        })
        .from(messages)
        .where(eq(messages.id, sourceMessageId))
        .limit(1);

      if (!source) {
        throw new RelationSourceNotFoundError(sourceMessageId);
      }

      // Validate targets exist and satisfy scope
      if (desired.length > 0) {
        const targetRows = await tx
          .select({ id: messages.id, channelId: messages.channelId })
          .from(messages)
          .where(inArray(messages.id, desired));

        const foundIds = new Set(targetRows.map((t) => t.id));
        for (const id of desired) {
          if (!foundIds.has(id)) {
            throw new RelationTargetNotFoundError(id);
          }
        }

        if (config.scope === 'same_channel') {
          for (const t of targetRows) {
            if (t.channelId !== source.channelId) {
              throw new RelationError('SCOPE_VIOLATION');
            }
          }
        }
      }

      // Load existing edges
      const existing = await tx
        .select({ targetMessageId: messageRelations.targetMessageId })
        .from(messageRelations)
        .where(
          and(
            eq(messageRelations.sourceMessageId, sourceMessageId),
            eq(messageRelations.propertyDefinitionId, definition.id),
          ),
        );

      const existingSet = new Set(existing.map((e) => e.targetMessageId));
      const desiredSet = new Set(desired);

      const toAdd = desired.filter((id) => !existingSet.has(id));
      const toRemove = [...existingSet].filter((id) => !desiredSet.has(id));

      // Cycle detection: run AFTER scope validation, BEFORE INSERT
      if (config.relationKind === 'parent' && toAdd.length > 0) {
        await this.assertNoCycle(tx, sourceMessageId, toAdd, 'parent');
      }

      if (toRemove.length > 0) {
        await tx
          .delete(messageRelations)
          .where(
            and(
              eq(messageRelations.sourceMessageId, sourceMessageId),
              eq(messageRelations.propertyDefinitionId, definition.id),
              inArray(messageRelations.targetMessageId, toRemove),
            ),
          );
      }

      if (toAdd.length > 0) {
        await tx.insert(messageRelations).values(
          toAdd.map((targetId) => ({
            tenantId: source.tenantId,
            channelId: source.channelId,
            sourceMessageId,
            targetMessageId: targetId,
            propertyDefinitionId: definition.id,
            relationKind: config.relationKind!,
            createdBy: actorId,
          })),
        );
      }

      return {
        addedTargetIds: toAdd,
        removedTargetIds: toRemove,
        currentTargetIds: desired,
      };
    });
  }

  async getOutgoingTargets(
    sourceMessageId: string,
    propertyDefinitionId: string,
  ): Promise<string[]> {
    const rows = await this.db
      .select({ targetMessageId: messageRelations.targetMessageId })
      .from(messageRelations)
      .where(
        and(
          eq(messageRelations.sourceMessageId, sourceMessageId),
          eq(messageRelations.propertyDefinitionId, propertyDefinitionId),
        ),
      )
      .orderBy(messageRelations.createdAt);

    return rows.map((r) => r.targetMessageId);
  }

  async getIncomingSources(
    targetMessageId: string,
    relationKind: 'parent' | 'related',
  ): Promise<IncomingSource[]> {
    const rows = await this.db
      .select({
        sourceMessageId: messageRelations.sourceMessageId,
        propertyDefinitionId: messageRelations.propertyDefinitionId,
      })
      .from(messageRelations)
      .innerJoin(messages, eq(messages.id, messageRelations.sourceMessageId))
      .where(
        and(
          eq(messageRelations.targetMessageId, targetMessageId),
          eq(messageRelations.relationKind, relationKind),
          eq(messages.isDeleted, false),
        ),
      )
      .orderBy(desc(messageRelations.createdAt));

    return rows;
  }

  /**
   * Walk the effective-parent chain of `targetId` using a WITH RECURSIVE CTE
   * that follows both im_message_relations (parent-kind edges) and
   * im_messages.parent_id (thread-derived parent links).
   *
   * Throws CYCLE_DETECTED if `sourceMessageId` appears in the ancestor chain.
   * Throws DEPTH_EXCEEDED if the chain reaches depth 10 before terminating.
   *
   * Only runs for `relationKind === 'parent'`; silently returns for other kinds.
   */
  private async assertNoCycle(
    tx: PostgresJsDatabase<typeof schema>,
    sourceMessageId: string,
    newTargetIds: string[],
    relationKind: 'parent' | 'related',
  ): Promise<void> {
    /* istanbul ignore next — defensive guard; call site already enforces parent kind */
    if (relationKind !== 'parent') return;

    for (const targetId of newTargetIds) {
      /* istanbul ignore next — setRelationTargets rejects self-ref before this point */
      if (targetId === sourceMessageId) continue;

      const rows = (await tx.execute(sql`
        WITH RECURSIVE ancestors(m, depth) AS (
          SELECT target_message_id, 1
            FROM im_message_relations
            WHERE source_message_id = ${targetId}::uuid AND relation_kind = 'parent'
          UNION ALL
          SELECT parent_id, 1
            FROM im_messages
            WHERE id = ${targetId}::uuid AND parent_id IS NOT NULL
          UNION ALL
          SELECT r.target_message_id, a.depth + 1
            FROM im_message_relations r
            JOIN ancestors a ON r.source_message_id = a.m
            WHERE r.relation_kind = 'parent' AND a.depth < 10
          UNION ALL
          SELECT msg.parent_id, a.depth + 1
            FROM im_messages msg
            JOIN ancestors a ON msg.id = a.m
            WHERE msg.parent_id IS NOT NULL AND a.depth < 10
        )
        SELECT m, depth FROM ancestors
        WHERE m = ${sourceMessageId}::uuid OR depth >= 10
        LIMIT 1;
      `)) as unknown as Array<{ m: string; depth: number }>;

      if (rows.length === 0) continue;

      const { m, depth } = rows[0];
      if (m === sourceMessageId) throw new RelationError('CYCLE_DETECTED');
      /* istanbul ignore next — CTE WHERE guarantees depth>=10 when m!==source */
      if (depth >= 10) throw new RelationError('DEPTH_EXCEEDED');
    }
  }
}
