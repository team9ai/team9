import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { v7 as uuidv7 } from 'uuid';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  inArray,
  isNull,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
const { messages, channelPropertyDefinitions } = schema;
import type {
  NewMessageProperty,
  MessageProperty,
} from '@team9/database/schemas';
import type { PropertyValueType, MessageRefConfig } from '@team9/shared';
import { WS_EVENTS } from '@team9/shared';
import {
  PropertyDefinitionsService,
  type PropertyDefinitionRow,
} from './property-definitions.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { WebsocketGateway } from '../websocket/websocket.gateway.js';
import { WEBSOCKET_GATEWAY } from '../../shared/constants/injection-tokens.js';
import { MessageRelationsService } from './message-relations.service.js';

/** Allowed message types for properties */
const ALLOWED_MESSAGE_TYPES = new Set(['text', 'long_text', 'file', 'image']);

/** Allowed channel types for properties */
const ALLOWED_CHANNEL_TYPES = new Set(['public', 'private']);

@Injectable()
export class MessagePropertiesService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly propertyDefinitionsService: PropertyDefinitionsService,
    private readonly auditService: AuditService,
    private readonly relationsService: MessageRelationsService,
    private readonly moduleRef: ModuleRef,
  ) {}

  /** Lazily resolve WebsocketGateway to avoid ESM circular dependency at import time */
  private get wsGateway(): WebsocketGateway {
    return this.moduleRef.get(WEBSOCKET_GATEWAY, { strict: false });
  }

  // ==================== Public Methods ====================

  /**
   * Get the channelId for a message (lightweight lookup for auth checks).
   * Throws NotFoundException if the message does not exist.
   */
  async getMessageChannelId(messageId: string): Promise<string> {
    const [msg] = await this.db
      .select({
        channelId: schema.messages.channelId,
        isDeleted: schema.messages.isDeleted,
      })
      .from(schema.messages)
      .where(eq(schema.messages.id, messageId))
      .limit(1);
    if (!msg || msg.isDeleted) throw new NotFoundException('Message not found');
    return msg.channelId;
  }

  /**
   * Inspect all relation edges for a given message.
   * Returns both outgoing (parent chain + related targets) and
   * incoming (children + relatedBy sources).
   */
  async getRelationsInspection(
    messageId: string,
    opts: {
      kind?: 'parent' | 'related' | 'all';
      direction?: 'outgoing' | 'incoming' | 'both';
      depth?: number;
    } = {},
  ): Promise<{
    outgoing: {
      parent: {
        messageId: string;
        depth: number;
        propertyDefinitionId: string;
        parentSource: 'relation' | 'thread';
      }[];
      related: { messageId: string; propertyDefinitionId: string }[];
    };
    incoming: {
      children: {
        messageId: string;
        depth: number;
        propertyDefinitionId: string;
        parentSource: 'relation' | 'thread';
      }[];
      relatedBy: { messageId: string; propertyDefinitionId: string }[];
    };
  }> {
    const kind = opts.kind ?? 'all';
    const direction = opts.direction ?? 'both';
    const depth = Math.min(Math.max(opts.depth ?? 1, 1), 10);

    const emptyResult = {
      outgoing: { parent: [], related: [] },
      incoming: { children: [], relatedBy: [] },
    };

    // Look up the message's channel
    const [msg] = await this.db
      .select({ channelId: messages.channelId })
      .from(messages)
      .where(eq(messages.id, messageId))
      .limit(1);

    if (!msg) return emptyResult;

    const result = {
      outgoing: {
        parent: [] as {
          messageId: string;
          depth: number;
          propertyDefinitionId: string;
          parentSource: 'relation' | 'thread';
        }[],
        related: [] as { messageId: string; propertyDefinitionId: string }[],
      },
      incoming: {
        children: [] as {
          messageId: string;
          depth: number;
          propertyDefinitionId: string;
          parentSource: 'relation' | 'thread';
        }[],
        relatedBy: [] as { messageId: string; propertyDefinitionId: string }[],
      },
    };

    // Fetch all property definitions for this channel
    const defs = await this.db
      .select({
        id: channelPropertyDefinitions.id,
        config: channelPropertyDefinitions.config,
      })
      .from(channelPropertyDefinitions)
      .where(eq(channelPropertyDefinitions.channelId, msg.channelId));

    const parentDefs = defs.filter(
      (d) => (d.config as MessageRefConfig | null)?.relationKind === 'parent',
    );
    const relatedDefs = defs.filter(
      (d) => (d.config as MessageRefConfig | null)?.relationKind === 'related',
    );

    // Outgoing parent: follow parent chain up to `depth` levels
    if (
      (kind === 'parent' || kind === 'all') &&
      (direction === 'outgoing' || direction === 'both')
    ) {
      for (const def of parentDefs) {
        let cur: string | null = messageId;
        let d = 1;
        while (cur && d <= depth) {
          const eff = await this.relationsService.getEffectiveParent(
            cur,
            def.id,
          );
          if (!eff) break;
          result.outgoing.parent.push({
            messageId: eff.id,
            depth: d,
            propertyDefinitionId: def.id,
            parentSource: eff.source,
          });
          cur = eff.id;
          d++;
        }
      }
    }

    // Outgoing related targets
    if (
      (kind === 'related' || kind === 'all') &&
      (direction === 'outgoing' || direction === 'both')
    ) {
      for (const def of relatedDefs) {
        const targets = await this.relationsService.getOutgoingTargets(
          messageId,
          def.id,
        );
        for (const t of targets) {
          result.outgoing.related.push({
            messageId: t,
            propertyDefinitionId: def.id,
          });
        }
      }
    }

    // Incoming children (messages that point to messageId as parent)
    if (
      (kind === 'parent' || kind === 'all') &&
      (direction === 'incoming' || direction === 'both')
    ) {
      const sources = await this.relationsService.getIncomingSources(
        messageId,
        'parent',
      );
      for (const s of sources) {
        result.incoming.children.push({
          messageId: s.sourceMessageId,
          depth: 1,
          propertyDefinitionId: s.propertyDefinitionId,
          parentSource: 'relation',
        });
      }
    }

    // Incoming relatedBy (messages that point to messageId as related)
    if (
      (kind === 'related' || kind === 'all') &&
      (direction === 'incoming' || direction === 'both')
    ) {
      const sources = await this.relationsService.getIncomingSources(
        messageId,
        'related',
      );
      for (const s of sources) {
        result.incoming.relatedBy.push({
          messageId: s.sourceMessageId,
          propertyDefinitionId: s.propertyDefinitionId,
        });
      }
    }

    return result;
  }

  /**
   * Get all properties for a message as a key-value map.
   * Keys are the property definition keys, values are the extracted values.
   */
  async getProperties(
    messageId: string,
    opts?: { excludeHidden?: boolean },
  ): Promise<Record<string, unknown>> {
    const rows = await this.db
      .select()
      .from(schema.messageProperties)
      .where(eq(schema.messageProperties.messageId, messageId));

    if (rows.length === 0) return {};

    const defIds = rows.map((r) => r.propertyDefinitionId);
    const definitions = await this.getDefinitionsByIds(defIds);

    const result: Record<string, unknown> = {};
    for (const row of rows) {
      const def = definitions.get(row.propertyDefinitionId);
      if (!def) continue;
      if (opts?.excludeHidden && def.showInChatPolicy === 'hide') continue;
      result[def.key] = await this.extractValueWithRelations(
        messageId,
        row,
        def,
      );
    }
    return result;
  }

  /**
   * Get properties for multiple messages (batch load).
   * Returns a map of messageId -> { key: value }.
   */
  async batchGetByMessageIds(
    messageIds: string[],
    opts?: { excludeHidden?: boolean },
  ): Promise<Record<string, Record<string, unknown>>> {
    if (messageIds.length === 0) return {};

    const rows = await this.db
      .select()
      .from(schema.messageProperties)
      .where(inArray(schema.messageProperties.messageId, messageIds));

    if (rows.length === 0) return {};

    const defIds = [...new Set(rows.map((r) => r.propertyDefinitionId))];
    const definitions = await this.getDefinitionsByIds(defIds);

    // Optionally filter out hidden definitions
    const visibleDefs = opts?.excludeHidden
      ? new Map(
          [...definitions.entries()].filter(
            ([, def]) => def.showInChatPolicy !== 'hide',
          ),
        )
      : definitions;

    // Pre-fetch all relation targets in batch, grouped by definition, to avoid N+1 queries.
    // For each visible relationKind definition, issue one query covering all source message IDs.
    const relationTargetMaps = new Map<string, Map<string, string[]>>();
    for (const [defId, def] of visibleDefs) {
      const cfg =
        def.valueType === 'message_ref'
          ? (def.config as MessageRefConfig | null)
          : null;
      if (!cfg?.relationKind) continue;

      // Collect source message IDs that have a property row for this definition
      const sourceIds = rows
        .filter((r) => r.propertyDefinitionId === defId)
        .map((r) => r.messageId);

      if (sourceIds.length > 0) {
        const map = await this.relationsService.getOutgoingTargetsForMany(
          sourceIds,
          defId,
        );
        relationTargetMaps.set(defId, map);
      }
    }

    const result: Record<string, Record<string, unknown>> = {};
    for (const row of rows) {
      const def = visibleDefs.get(row.propertyDefinitionId);
      if (!def) continue;

      if (!result[row.messageId]) {
        result[row.messageId] = {};
      }

      const cfg =
        def.valueType === 'message_ref'
          ? (def.config as MessageRefConfig | null)
          : null;

      if (cfg?.relationKind) {
        // Check for explicit clear sentinel
        const cleared = row.jsonValue as { explicitlyCleared?: boolean } | null;
        if (cleared?.explicitlyCleared === true) {
          result[row.messageId][def.key] =
            cfg.cardinality === 'single' ? null : [];
        } else {
          const targets =
            relationTargetMaps.get(def.id)?.get(row.messageId) ?? [];
          result[row.messageId][def.key] =
            cfg.cardinality === 'single' ? (targets[0] ?? null) : targets;
        }
      } else {
        result[row.messageId][def.key] = this.extractValue(row, def.valueType);
      }
    }
    return result;
  }

  /**
   * Set a single property value on a message (upsert).
   * Validates type, broadcasts WS event, and writes audit log.
   */
  async setProperty(
    messageId: string,
    definitionId: string,
    value: unknown,
    userId: string,
  ): Promise<void> {
    const { message } = await this.getValidatedMessage(messageId);
    const definition =
      await this.propertyDefinitionsService.findByIdOrThrow(definitionId);

    // Ensure definition belongs to the message's channel
    if (definition.channelId !== message.channelId) {
      throw new BadRequestException(
        'Property definition does not belong to this channel',
      );
    }

    // Branch: relationKind definitions route to message_relations table
    const relConfig =
      definition.valueType === 'message_ref'
        ? (definition.config as MessageRefConfig | null)
        : null;
    if (relConfig?.relationKind) {
      return this.setRelationKindProperty({
        message,
        definition: {
          id: definition.id,
          key: definition.key,
          config: relConfig,
        },
        value,
        userId,
      });
    }

    const mappedValues = this.validateAndMapValue(definition.valueType, value);

    // Check if property already exists (for audit: old vs new)
    const existing = await this.findExisting(messageId, definitionId);
    const oldValue = existing
      ? this.extractValue(existing, definition.valueType)
      : undefined;

    const now = new Date();
    if (existing) {
      await this.db
        .update(schema.messageProperties)
        .set({
          ...mappedValues,
          updatedBy: userId,
          updatedAt: now,
        })
        .where(eq(schema.messageProperties.id, existing.id));
    } else {
      await this.db.insert(schema.messageProperties).values({
        id: uuidv7(),
        messageId,
        propertyDefinitionId: definitionId,
        ...mappedValues,
        createdBy: userId,
        updatedBy: userId,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Audit log
    const action = existing ? 'property_updated' : 'property_set';
    await this.auditService.log({
      channelId: message.channelId,
      entityType: 'message',
      entityId: messageId,
      action,
      changes: {
        [definition.key]: { old: oldValue ?? null, new: value },
      },
      performedBy: userId,
      metadata: { definitionId, valueType: definition.valueType },
    });

    // WebSocket broadcast
    await this.wsGateway.sendToChannelMembers(
      message.channelId,
      WS_EVENTS.PROPERTY.MESSAGE_CHANGED,
      {
        channelId: message.channelId,
        messageId,
        properties: { set: { [definition.key]: value }, removed: [] },
        performedBy: userId,
      },
    );
  }

  /**
   * Remove a property value from a message.
   */
  async removeProperty(
    messageId: string,
    definitionId: string,
    userId: string,
  ): Promise<void> {
    const { message } = await this.getValidatedMessage(messageId);
    const definition =
      await this.propertyDefinitionsService.findByIdOrThrow(definitionId);

    if (definition.channelId !== message.channelId) {
      throw new BadRequestException(
        'Property definition does not belong to this channel',
      );
    }

    // Branch: relationKind definitions delegate removal to relations service
    const relConfig =
      definition.valueType === 'message_ref'
        ? (definition.config as MessageRefConfig | null)
        : null;
    if (relConfig?.relationKind) {
      return this.setRelationKindProperty({
        message,
        definition: {
          id: definition.id,
          key: definition.key,
          config: relConfig,
        },
        value: null,
        userId,
      });
    }

    const existing = await this.findExisting(messageId, definitionId);
    if (!existing) {
      throw new NotFoundException('Property value not found');
    }

    const oldValue = this.extractValue(existing, definition.valueType);

    await this.db
      .delete(schema.messageProperties)
      .where(eq(schema.messageProperties.id, existing.id));

    // Audit log
    await this.auditService.log({
      channelId: message.channelId,
      entityType: 'message',
      entityId: messageId,
      action: 'property_removed',
      changes: {
        [definition.key]: { old: oldValue, new: null },
      },
      performedBy: userId,
      metadata: { definitionId, valueType: definition.valueType },
    });

    // WebSocket broadcast
    await this.wsGateway.sendToChannelMembers(
      message.channelId,
      WS_EVENTS.PROPERTY.MESSAGE_CHANGED,
      {
        channelId: message.channelId,
        messageId,
        properties: { set: {}, removed: [definition.key] },
        performedBy: userId,
      },
    );
  }

  /**
   * Batch set multiple properties by key.
   * Uses schema-on-write: auto-creates definitions if they don't exist.
   */
  async batchSet(
    messageId: string,
    properties: { key: string; value: unknown }[],
    userId: string | null,
    opts?: { skipAudit?: boolean },
  ): Promise<void> {
    if (properties.length === 0) return;

    const { message, channel } = await this.getValidatedMessage(messageId);
    const effectiveUserId = userId ?? message.senderId ?? 'system';

    // Use channel propertySettings from getValidatedMessage (no redundant query)
    const settings = (channel.propertySettings ?? {}) as Record<
      string,
      unknown
    >;
    let allowCreate = settings.allowNonAdminCreateKey !== false;
    if (!allowCreate && effectiveUserId !== 'system') {
      // Check if user is admin/owner of the channel — they may always create keys
      const [member] = await this.db
        .select({ role: schema.channelMembers.role })
        .from(schema.channelMembers)
        .where(
          and(
            eq(schema.channelMembers.channelId, message.channelId),
            eq(schema.channelMembers.userId, effectiveUserId),
            isNull(schema.channelMembers.leftAt),
          ),
        )
        .limit(1);
      if (member && (member.role === 'admin' || member.role === 'owner')) {
        allowCreate = true;
      }
    }

    // Phase 1: Resolve all definitions outside the transaction.
    // (findOrCreate may create definitions, which is a separate concern)
    // relationKind properties are routed to setRelationKindProperty immediately —
    // they manage their own transaction, audit, and WS events.
    const resolvedDefinitions: {
      key: string;
      value: unknown;
      definition: Awaited<
        ReturnType<PropertyDefinitionsService['findOrCreate']>
      >;
      mappedValues: Partial<NewMessageProperty>;
    }[] = [];

    for (const { key, value } of properties) {
      const valueType = this.inferValueType(value);
      const definition = await this.propertyDefinitionsService.findOrCreate(
        message.channelId,
        key,
        valueType,
        effectiveUserId,
        allowCreate,
      );

      // Route relationKind properties through the dedicated handler which
      // enforces scope, cycle detection, cardinality, and emits the correct WS events.
      const relConfig =
        definition.valueType === 'message_ref'
          ? (definition.config as MessageRefConfig | null)
          : null;
      if (relConfig?.relationKind) {
        await this.setRelationKindProperty({
          message,
          definition: {
            id: definition.id,
            key: definition.key,
            config: relConfig,
          },
          value,
          userId: effectiveUserId,
        });
        continue; // skip jsonValue write and batch audit for this property
      }

      const mappedValues = this.validateAndMapValue(
        definition.valueType,
        value,
      );
      resolvedDefinitions.push({ key, value, definition, mappedValues });
    }

    // If all properties were relationKind, there is nothing left to write.
    if (resolvedDefinitions.length === 0) return;

    // Phase 2: Perform all message property writes atomically in a transaction
    // Collect audit entries to write after the transaction commits
    const auditEntries: {
      action: string;
      key: string;
      oldValue: unknown;
      newValue: unknown;
      definitionId: string;
      valueType: string;
    }[] = [];
    const setMap: Record<string, unknown> = {};

    await this.db.transaction(async (tx) => {
      for (const {
        key,
        value,
        definition,
        mappedValues,
      } of resolvedDefinitions) {
        // Find existing property within the transaction
        const [existingRow] = await tx
          .select()
          .from(schema.messageProperties)
          .where(
            and(
              eq(schema.messageProperties.messageId, messageId),
              eq(schema.messageProperties.propertyDefinitionId, definition.id),
            ),
          )
          .limit(1);

        const existing = existingRow ?? null;
        const oldValue = existing
          ? this.extractValue(existing, definition.valueType)
          : undefined;

        const now = new Date();
        if (existing) {
          await tx
            .update(schema.messageProperties)
            .set({
              ...mappedValues,
              updatedBy: effectiveUserId,
              updatedAt: now,
            })
            .where(eq(schema.messageProperties.id, existing.id));
        } else {
          await tx.insert(schema.messageProperties).values({
            id: uuidv7(),
            messageId,
            propertyDefinitionId: definition.id,
            ...mappedValues,
            createdBy: effectiveUserId,
            updatedBy: effectiveUserId,
            createdAt: now,
            updatedAt: now,
          });
        }

        auditEntries.push({
          action: existing ? 'property_updated' : 'property_set',
          key,
          oldValue: oldValue ?? null,
          newValue: value,
          definitionId: definition.id,
          valueType: definition.valueType,
        });

        setMap[key] = value;
      }
    });

    // Phase 3: Write audit logs after the transaction commits
    // (auditService uses its own DB connection, so we avoid holding the tx open)
    // Skip if caller handles its own audit logging (e.g., AI auto-fill)
    if (!opts?.skipAudit) {
      for (const entry of auditEntries) {
        await this.auditService.log({
          channelId: message.channelId,
          entityType: 'message',
          entityId: messageId,
          action: entry.action,
          changes: {
            [entry.key]: { old: entry.oldValue, new: entry.newValue },
          },
          performedBy: effectiveUserId,
          metadata: {
            definitionId: entry.definitionId,
            valueType: entry.valueType,
            batch: true,
          },
        });
      }
    }

    // Single WebSocket broadcast for non-relationKind properties in the batch.
    // (relationKind properties already emit their own targeted events via setRelationKindProperty)
    if (Object.keys(setMap).length > 0) {
      await this.wsGateway.sendToChannelMembers(
        message.channelId,
        WS_EVENTS.PROPERTY.MESSAGE_CHANGED,
        {
          channelId: message.channelId,
          messageId,
          properties: { set: setMap, removed: [] },
          performedBy: effectiveUserId,
        },
      );
    }
  }

  // ==================== RelationKind routing ====================

  /**
   * Route a write for a `message_ref` property whose config has `relationKind` set.
   * - Delegates target edge management to MessageRelationsService.
   * - Upserts a sentinel row in message_properties (null = has targets, { explicitlyCleared:true } = cleared).
   * - Writes an audit entry with addedTargetIds / removedTargetIds.
   */
  private async setRelationKindProperty(params: {
    message: { id: string; channelId: string };
    definition: { id: string; key: string; config: MessageRefConfig };
    value: unknown;
    userId: string;
  }): Promise<void> {
    const { message, definition, value, userId } = params;
    const config = definition.config;

    const explicitClear = value === null || value === undefined;
    const targetIds: string[] = explicitClear
      ? []
      : Array.isArray(value)
        ? (value as string[])
        : [value as string];

    // Wrap setRelationTargets + sentinel upsert in a single outer transaction (spec §2.5)
    const diff = await this.db.transaction(async (tx) => {
      const d = await this.relationsService.setRelationTargets(
        {
          sourceMessageId: message.id,
          targetMessageIds: targetIds,
          definition: {
            id: definition.id,
            channelId: message.channelId,
            config,
          },
          actorId: userId,
        },
        tx,
      );

      // Upsert sentinel row: null means "managed by relations", { explicitlyCleared:true } means "cleared"
      const jsonValue = explicitClear ? { explicitlyCleared: true } : null;
      const now = new Date();

      const existing = await tx
        .select()
        .from(schema.messageProperties)
        .where(
          and(
            eq(schema.messageProperties.messageId, message.id),
            eq(schema.messageProperties.propertyDefinitionId, definition.id),
          ),
        )
        .limit(1)
        .then((rows) => rows[0] ?? null);

      if (existing) {
        await tx
          .update(schema.messageProperties)
          .set({ jsonValue, updatedBy: userId, updatedAt: now })
          .where(eq(schema.messageProperties.id, existing.id));
      } else {
        await tx.insert(schema.messageProperties).values({
          id: uuidv7(),
          messageId: message.id,
          propertyDefinitionId: definition.id,
          textValue: null,
          numberValue: null,
          booleanValue: null,
          dateValue: null,
          jsonValue,
          fileKey: null,
          fileMetadata: null,
          createdBy: userId,
          updatedBy: userId,
          createdAt: now,
          updatedAt: now,
        });
      }

      return d;
    });

    // Audit log after txn commits — best effort, consistent with existing pattern
    await this.auditService.log({
      channelId: message.channelId,
      entityType: 'message',
      entityId: message.id,
      action: explicitClear ? 'property_removed' : 'property_set',
      changes: {
        [definition.key]: {
          old: diff.removedTargetIds,
          new: diff.addedTargetIds,
        },
      },
      performedBy: userId,
      metadata: {
        definitionId: definition.id,
        valueType: 'message_ref',
        relationKind: config.relationKind,
        addedTargetIds: diff.addedTargetIds,
        removedTargetIds: diff.removedTargetIds,
        ...(explicitClear ? { explicitlyCleared: true } : {}),
      },
    });

    // Determine the action type for the relation-changed event
    const action: 'added' | 'removed' | 'replaced' =
      diff.removedTargetIds.length > 0 && diff.addedTargetIds.length > 0
        ? 'replaced'
        : diff.addedTargetIds.length > 0
          ? 'added'
          : 'removed';

    // Emit message_relation_changed BEFORE message_property_changed (order guarantee)
    await this.wsGateway.emitRelationChanged({
      channelId: message.channelId,
      sourceMessageId: message.id,
      propertyDefinitionId: definition.id,
      propertyKey: definition.key,
      relationKind: config.relationKind!,
      action,
      addedTargetIds: diff.addedTargetIds,
      removedTargetIds: diff.removedTargetIds,
      currentTargetIds: diff.currentTargetIds,
      performedBy: userId,
      timestamp: new Date().toISOString(),
    });

    // Emit the legacy message_property_changed event with relationKind marker
    // Clients should NOT use the value (no target ids here) — they read from the relation event
    await this.wsGateway.sendToChannelMembers(
      message.channelId,
      WS_EVENTS.PROPERTY.MESSAGE_CHANGED,
      {
        channelId: message.channelId,
        messageId: message.id,
        properties: { set: { [definition.key]: null }, removed: [] },
        relationKind: config.relationKind,
        ...(explicitClear ? { explicitlyCleared: true } : {}),
        performedBy: userId,
      },
    );
  }

  /**
   * Extract the value for a property, routing relation-kind definitions to the
   * message_relations table instead of jsonValue.
   */
  private async extractValueWithRelations(
    messageId: string,
    row: MessageProperty,
    def: PropertyDefinitionRow,
  ): Promise<unknown> {
    const cfg =
      def.valueType === 'message_ref'
        ? (def.config as MessageRefConfig | null)
        : null;

    if (cfg?.relationKind) {
      // Check for explicit clear sentinel
      const cleared = row.jsonValue as { explicitlyCleared?: boolean } | null;
      if (cleared?.explicitlyCleared === true) {
        return cfg.cardinality === 'single' ? null : [];
      }
      // Assemble from relations table
      const targets = await this.relationsService.getOutgoingTargets(
        messageId,
        def.id,
      );
      return cfg.cardinality === 'single' ? (targets[0] ?? null) : targets;
    }

    return this.extractValue(row, def.valueType);
  }

  // ==================== Validation Helpers ====================

  /**
   * Validate that the message exists, is a root message, has allowed type,
   * and belongs to an allowed channel type.
   * Returns the message and channel data (including propertySettings).
   */
  async getValidatedMessage(messageId: string) {
    const [message] = await this.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.id, messageId))
      .limit(1);

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    if (message.isDeleted) {
      throw new NotFoundException('Message has been deleted');
    }

    if (message.parentId !== null) {
      throw new BadRequestException(
        'Properties can only be set on root messages (not thread replies)',
      );
    }

    if (!ALLOWED_MESSAGE_TYPES.has(message.type)) {
      throw new BadRequestException(
        `Properties cannot be set on ${message.type} messages. Allowed types: ${[...ALLOWED_MESSAGE_TYPES].join(', ')}`,
      );
    }

    // Validate channel type and fetch channel data (including propertySettings)
    const [channel] = await this.db
      .select({
        type: schema.channels.type,
        propertySettings: schema.channels.propertySettings,
      })
      .from(schema.channels)
      .where(eq(schema.channels.id, message.channelId))
      .limit(1);

    if (!channel || !ALLOWED_CHANNEL_TYPES.has(channel.type)) {
      throw new ForbiddenException(
        'Properties are only supported in public and private channels',
      );
    }

    return { message, channel };
  }

  /**
   * Validate value matches the expected type and map to the correct DB column.
   */
  private validateAndMapValue(
    valueType: PropertyValueType,
    value: unknown,
  ): Partial<NewMessageProperty> {
    const base: Partial<NewMessageProperty> = {
      textValue: null,
      numberValue: null,
      booleanValue: null,
      dateValue: null,
      jsonValue: null,
      fileKey: null,
      fileMetadata: null,
    };

    switch (valueType) {
      case 'text':
      case 'url':
      case 'single_select':
        if (typeof value !== 'string') {
          throw new BadRequestException(`Expected string for ${valueType}`);
        }
        return { ...base, textValue: value };

      case 'number':
        if (typeof value !== 'number') {
          throw new BadRequestException('Expected number');
        }
        return { ...base, numberValue: value };

      case 'boolean':
        if (typeof value !== 'boolean') {
          throw new BadRequestException('Expected boolean');
        }
        return { ...base, booleanValue: value };

      case 'date':
      case 'timestamp': {
        if (value === null || typeof value !== 'string') {
          throw new BadRequestException(
            `Expected date/timestamp string for ${valueType}`,
          );
        }
        const d = new Date(value);
        if (isNaN(d.getTime())) {
          throw new BadRequestException(
            `Expected valid date/timestamp string for ${valueType}`,
          );
        }
        return { ...base, dateValue: d };
      }

      case 'multi_select':
      case 'person':
      case 'message_ref':
      case 'tags':
      case 'date_range':
      case 'timestamp_range':
      case 'recurring':
        if (
          value === null ||
          (!Array.isArray(value) && typeof value !== 'object')
        ) {
          throw new BadRequestException(
            `Expected array/object for ${valueType}`,
          );
        }
        return { ...base, jsonValue: value };

      case 'file':
      case 'image': {
        const fv = value as {
          fileKey: string;
          metadata?: Record<string, unknown>;
        };
        if (!fv?.fileKey) {
          throw new BadRequestException('Expected object with fileKey');
        }
        return {
          ...base,
          fileKey: fv.fileKey,
          fileMetadata: fv.metadata ?? null,
        };
      }

      default:
        throw new BadRequestException(
          `Unsupported type: ${valueType as string}`,
        );
    }
  }

  /**
   * Extract the actual value from a DB row based on the definition's type.
   */
  private extractValue(row: MessageProperty, valueType: string): unknown {
    switch (valueType) {
      case 'text':
      case 'url':
      case 'single_select':
        return row.textValue;
      case 'number':
        return row.numberValue;
      case 'boolean':
        return row.booleanValue;
      case 'date':
      case 'timestamp':
        return row.dateValue?.toISOString() ?? null;
      case 'multi_select':
      case 'person':
      case 'message_ref':
      case 'tags':
      case 'date_range':
      case 'timestamp_range':
      case 'recurring':
        return row.jsonValue;
      case 'file':
      case 'image':
        return { fileKey: row.fileKey, metadata: row.fileMetadata };
      default:
        return null;
    }
  }

  /**
   * Infer a PropertyValueType from a JS value (for schema-on-write).
   */
  private inferValueType(value: unknown): PropertyValueType {
    if (typeof value === 'string') return 'text';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    if (Array.isArray(value)) {
      if (value.length > 0 && typeof value[0] === 'string')
        return 'multi_select';
      return 'multi_select'; // default array type
    }
    if (value !== null && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      if ('start' in obj && 'end' in obj) {
        // Check if values look like dates
        if (typeof obj.start === 'string' && !isNaN(Date.parse(obj.start))) {
          return 'date_range';
        }
      }
      if ('freq' in obj) return 'recurring';
      if ('fileKey' in obj) return 'file';
    }
    return 'text';
  }

  // ==================== Private DB Helpers ====================

  private async findExisting(
    messageId: string,
    definitionId: string,
  ): Promise<MessageProperty | null> {
    const [row] = await this.db
      .select()
      .from(schema.messageProperties)
      .where(
        and(
          eq(schema.messageProperties.messageId, messageId),
          eq(schema.messageProperties.propertyDefinitionId, definitionId),
        ),
      )
      .limit(1);

    return row ?? null;
  }

  private async getDefinitionsByIds(
    ids: string[],
  ): Promise<Map<string, PropertyDefinitionRow>> {
    if (ids.length === 0) return new Map();

    const rows = await this.db
      .select()
      .from(schema.channelPropertyDefinitions)
      .where(inArray(schema.channelPropertyDefinitions.id, ids));

    const map = new Map<string, PropertyDefinitionRow>();
    for (const row of rows) {
      map.set(row.id, row as PropertyDefinitionRow);
    }
    return map;
  }
}
