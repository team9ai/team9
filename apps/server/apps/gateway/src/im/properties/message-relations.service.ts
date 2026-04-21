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

const { messageRelations, messages, messageProperties } = schema;

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

export interface EffectiveParent {
  id: string;
  source: 'relation' | 'thread';
}

export interface SubtreeNode {
  messageId: string;
  effectiveParentId: string | null;
  parentSource: 'relation' | 'thread' | null;
  depth: number;
  hasChildren: boolean;
}

export interface GetSubtreeParams {
  channelId: string;
  rootIds: string[];
  maxDepth: number;
  parentDefinitionId: string;
}

@Injectable()
export class MessageRelationsService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async setRelationTargets(
    params: SetRelationTargetsParams,
    existingTx?: PostgresJsDatabase<typeof schema>,
  ): Promise<SetRelationTargetsResult> {
    const { sourceMessageId, targetMessageIds, definition } = params;
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

    const run = (tx: PostgresJsDatabase<typeof schema>) =>
      this._setRelationTargetsTx(tx, params, desired);

    return existingTx ? run(existingTx) : this.db.transaction(run);
  }

  private async _setRelationTargetsTx(
    tx: PostgresJsDatabase<typeof schema>,
    params: SetRelationTargetsParams,
    desired: string[],
  ): Promise<SetRelationTargetsResult> {
    const { sourceMessageId, definition, actorId } = params;
    const { config } = definition;

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

  /**
   * Batch-load outgoing targets for multiple source messages with a single DB query.
   * Returns a Map keyed by sourceMessageId; each value is an ordered array of targetMessageIds.
   */
  async getOutgoingTargetsForMany(
    sourceMessageIds: string[],
    propertyDefinitionId: string,
  ): Promise<Map<string, string[]>> {
    if (sourceMessageIds.length === 0) return new Map();

    const rows = await this.db
      .select({
        sourceMessageId: messageRelations.sourceMessageId,
        targetMessageId: messageRelations.targetMessageId,
      })
      .from(messageRelations)
      .where(
        and(
          inArray(messageRelations.sourceMessageId, sourceMessageIds),
          eq(messageRelations.propertyDefinitionId, propertyDefinitionId),
        ),
      )
      .orderBy(messageRelations.createdAt);

    const map = new Map<string, string[]>();
    for (const id of sourceMessageIds) map.set(id, []);
    for (const r of rows) {
      const arr = map.get(r.sourceMessageId);
      if (arr) arr.push(r.targetMessageId);
    }
    return map;
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
   * Resolve the effective parent of a message for a given parent-type property definition.
   *
   * Priority:
   *   1. If `im_message_properties.jsonValue.explicitlyCleared === true` → null
   *   2. Stored relation edge (im_message_relations with relation_kind='parent')
   *   3. Thread parentId from im_messages
   *   4. null
   */
  async getEffectiveParent(
    messageId: string,
    parentDefinitionId: string,
  ): Promise<EffectiveParent | null> {
    // 1) Check explicit clear flag stored in jsonValue
    const [prop] = await this.db
      .select({ jsonValue: messageProperties.jsonValue })
      .from(messageProperties)
      .where(
        and(
          eq(messageProperties.messageId, messageId),
          eq(messageProperties.propertyDefinitionId, parentDefinitionId),
        ),
      )
      .limit(1);

    if (prop) {
      const json = prop.jsonValue as { explicitlyCleared?: boolean } | null;
      if (json?.explicitlyCleared === true) return null;
    }

    // 2) Stored relation edge
    const [rel] = await this.db
      .select({ targetMessageId: messageRelations.targetMessageId })
      .from(messageRelations)
      .where(
        and(
          eq(messageRelations.sourceMessageId, messageId),
          eq(messageRelations.propertyDefinitionId, parentDefinitionId),
          eq(messageRelations.relationKind, 'parent'),
        ),
      )
      .limit(1);

    if (rel) return { id: rel.targetMessageId, source: 'relation' };

    // 3) Thread parent from message row
    const [msg] = await this.db
      .select({ parentId: messages.parentId })
      .from(messages)
      .where(eq(messages.id, messageId))
      .limit(1);

    if (msg?.parentId) return { id: msg.parentId, source: 'thread' };

    return null;
  }

  /**
   * Return a flat list of subtree nodes rooted at `rootIds`, expanding children
   * up to `maxDepth` levels. Children are resolved via both stored relation edges
   * and thread parentId links. Depth-0 nodes are the roots themselves.
   *
   * The `hasChildren` flag is computed by probing one level beyond `maxDepth`:
   * any node that appears as a parent_id in the result set has children.
   *
   * Deleted messages (is_deleted = true) are excluded from the result.
   */
  async getSubtree(params: GetSubtreeParams): Promise<SubtreeNode[]> {
    const { channelId, rootIds, maxDepth, parentDefinitionId } = params;

    if (rootIds.length === 0) return [];

    // Build a SQL array literal for the root IDs so we can use ANY(...)
    const rootIdsSql = sql.join(
      rootIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    );

    const rows = (await this.db.execute(sql`
      WITH RECURSIVE tree(id, parent_id, parent_source, depth) AS (
        -- Anchor: the root messages at depth 0
        SELECT
          id,
          NULL::uuid AS parent_id,
          NULL::text AS parent_source,
          0 AS depth
        FROM im_messages
        WHERE id = ANY(ARRAY[${rootIdsSql}]) AND is_deleted = false
        UNION ALL
        -- Recursive step: find children of current level
        SELECT
          child.id,
          COALESCE(rel.target_message_id, child.parent_id) AS parent_id,
          CASE
            WHEN rel.target_message_id IS NOT NULL THEN 'relation'
            WHEN child.parent_id IS NOT NULL THEN 'thread'
            ELSE NULL
          END AS parent_source,
          tree.depth + 1 AS depth
        FROM tree
        JOIN im_messages child
          ON (
            -- Relation children: child has an explicit parent-relation pointing to tree.id.
            -- This takes priority over the thread link when both apply.
            child.id IN (
              SELECT source_message_id
              FROM im_message_relations
              WHERE target_message_id = tree.id
                AND relation_kind = 'parent'
                AND property_definition_id = ${parentDefinitionId}::uuid
            )
            OR
            -- Thread children: child.parent_id points to tree.id,
            -- BUT only when the child has NO explicit parent-relation for this definition
            -- (prevents double-counting when a thread reply also has an explicit override).
            (
              child.parent_id = tree.id
              AND NOT EXISTS (
                SELECT 1
                FROM im_message_relations
                WHERE source_message_id = child.id
                  AND relation_kind = 'parent'
                  AND property_definition_id = ${parentDefinitionId}::uuid
              )
            )
          )
        LEFT JOIN im_message_relations rel
          ON rel.source_message_id = child.id
         AND rel.relation_kind = 'parent'
         AND rel.property_definition_id = ${parentDefinitionId}::uuid
        LEFT JOIN im_message_properties cleared
          ON cleared.message_id = child.id
         AND cleared.property_definition_id = ${parentDefinitionId}::uuid
        WHERE child.channel_id = ${channelId}::uuid
          AND child.is_deleted = false
          -- Probe one level beyond maxDepth to determine hasChildren
          AND tree.depth < ${maxDepth + 1}
          -- §4.1: explicitlyCleared=true forces null parent even with a thread reply
          AND (cleared.json_value IS NULL OR COALESCE(cleared.json_value->>'explicitlyCleared', 'false') <> 'true')
      )
      SELECT id, parent_id, parent_source, depth FROM tree
    `)) as unknown as Array<{
      id: string;
      parent_id: string | null;
      parent_source: 'relation' | 'thread' | null;
      depth: number;
    }>;

    // Collect all IDs that appear as a parent — they have children in the result set
    const parentsInResult = new Set(
      rows
        .filter((r) => r.parent_id !== null)
        .map((r) => r.parent_id as string),
    );

    // Visible nodes are those at depth <= maxDepth; probe nodes (depth > maxDepth)
    // are only used to determine hasChildren and are excluded from the output.
    const visible = rows.filter((r) => r.depth <= maxDepth);

    return visible.map((r) => ({
      messageId: r.id,
      effectiveParentId: r.parent_id,
      parentSource: r.parent_source,
      depth: r.depth,
      hasChildren: parentsInResult.has(r.id),
    }));
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
