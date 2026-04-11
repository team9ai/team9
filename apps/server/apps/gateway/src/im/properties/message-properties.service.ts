import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  forwardRef,
} from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  inArray,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import type {
  NewMessageProperty,
  MessageProperty,
} from '@team9/database/schemas';
import type { PropertyValueType } from '@team9/shared';
import { WS_EVENTS } from '@team9/shared';
import {
  PropertyDefinitionsService,
  type PropertyDefinitionRow,
} from './property-definitions.service.js';
import { AuditService } from '../audit/audit.service.js';
import { WebsocketGateway } from '../websocket/websocket.gateway.js';

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
    @Inject(forwardRef(() => WebsocketGateway))
    private readonly wsGateway: WebsocketGateway,
  ) {}

  // ==================== Public Methods ====================

  /**
   * Get all properties for a message as a key-value map.
   * Keys are the property definition keys, values are the extracted values.
   */
  async getProperties(messageId: string): Promise<Record<string, unknown>> {
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
      result[def.key] = this.extractValue(row, def.valueType);
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

    const result: Record<string, Record<string, unknown>> = {};
    for (const row of rows) {
      const def = visibleDefs.get(row.propertyDefinitionId);
      if (!def) continue;

      if (!result[row.messageId]) {
        result[row.messageId] = {};
      }
      result[row.messageId][def.key] = this.extractValue(row, def.valueType);
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
    const message = await this.getValidatedMessage(messageId);
    const definition =
      await this.propertyDefinitionsService.findByIdOrThrow(definitionId);

    // Ensure definition belongs to the message's channel
    if (definition.channelId !== message.channelId) {
      throw new BadRequestException(
        'Property definition does not belong to this channel',
      );
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
    const message = await this.getValidatedMessage(messageId);
    const definition =
      await this.propertyDefinitionsService.findByIdOrThrow(definitionId);

    if (definition.channelId !== message.channelId) {
      throw new BadRequestException(
        'Property definition does not belong to this channel',
      );
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
  ): Promise<void> {
    if (properties.length === 0) return;

    const message = await this.getValidatedMessage(messageId);
    const effectiveUserId = userId ?? message.senderId ?? 'system';

    // Check channel's propertySettings to determine if auto-creation is allowed
    const [channel] = await this.db
      .select({ propertySettings: schema.channels.propertySettings })
      .from(schema.channels)
      .where(eq(schema.channels.id, message.channelId))
      .limit(1);

    const settings = (channel?.propertySettings ?? {}) as Record<
      string,
      unknown
    >;
    const allowCreate = settings.allowNonAdminCreateKey !== false;

    const setMap: Record<string, unknown> = {};

    for (const { key, value } of properties) {
      // Find or create definition (schema-on-write)
      const valueType = this.inferValueType(value);
      const definition = await this.propertyDefinitionsService.findOrCreate(
        message.channelId,
        key,
        valueType,
        effectiveUserId,
        allowCreate,
      );

      const mappedValues = this.validateAndMapValue(
        definition.valueType,
        value,
      );
      const existing = await this.findExisting(messageId, definition.id);
      const oldValue = existing
        ? this.extractValue(existing, definition.valueType)
        : undefined;

      const now = new Date();
      if (existing) {
        await this.db
          .update(schema.messageProperties)
          .set({
            ...mappedValues,
            updatedBy: effectiveUserId,
            updatedAt: now,
          })
          .where(eq(schema.messageProperties.id, existing.id));
      } else {
        await this.db.insert(schema.messageProperties).values({
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

      // Audit log per property
      const action = existing ? 'property_updated' : 'property_set';
      await this.auditService.log({
        channelId: message.channelId,
        entityType: 'message',
        entityId: messageId,
        action,
        changes: {
          [key]: { old: oldValue ?? null, new: value },
        },
        performedBy: effectiveUserId,
        metadata: {
          definitionId: definition.id,
          valueType: definition.valueType,
          batch: true,
        },
      });

      setMap[key] = value;
    }

    // Single WebSocket broadcast for the entire batch
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

  // ==================== Validation Helpers ====================

  /**
   * Validate that the message exists, is a root message, has allowed type,
   * and belongs to an allowed channel type.
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

    // Validate channel type
    const [channel] = await this.db
      .select({ type: schema.channels.type })
      .from(schema.channels)
      .where(eq(schema.channels.id, message.channelId))
      .limit(1);

    if (!channel || !ALLOWED_CHANNEL_TYPES.has(channel.type)) {
      throw new ForbiddenException(
        'Properties are only supported in public and private channels',
      );
    }

    return message;
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
        const d = new Date(value as string);
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
        if (!Array.isArray(value) && typeof value !== 'object') {
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
