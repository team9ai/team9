import { Injectable, Inject } from '@nestjs/common';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  inArray,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import type { MessageRefConfig } from '@team9/shared';
import {
  RelationError,
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
        throw new RelationTargetNotFoundError(sourceMessageId);
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

      if (toAdd.length > 0 && config.relationKind) {
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
      .orderBy(messageRelations.createdAt);

    return rows;
  }
}
