import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  asc,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import type { PropertyValueType } from '@team9/shared';
import {
  CreatePropertyDefinitionDto,
  UpdatePropertyDefinitionDto,
} from './dto/index.js';

export interface PropertyDefinitionRow {
  id: string;
  channelId: string;
  key: string;
  description: string | null;
  valueType: PropertyValueType;
  isNative: boolean;
  config: unknown;
  order: number;
  aiAutoFill: boolean;
  aiAutoFillPrompt: string | null;
  isRequired: boolean;
  defaultValue: unknown;
  showInChatPolicy: string;
  allowNewOptions: boolean;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class PropertyDefinitionsService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async findAllByChannel(channelId: string): Promise<PropertyDefinitionRow[]> {
    const rows = await this.db
      .select()
      .from(schema.channelPropertyDefinitions)
      .where(eq(schema.channelPropertyDefinitions.channelId, channelId))
      .orderBy(asc(schema.channelPropertyDefinitions.order));

    return rows as PropertyDefinitionRow[];
  }

  async findById(id: string): Promise<PropertyDefinitionRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.channelPropertyDefinitions)
      .where(eq(schema.channelPropertyDefinitions.id, id))
      .limit(1);

    return (row as PropertyDefinitionRow) || null;
  }

  async findByIdOrThrow(id: string): Promise<PropertyDefinitionRow> {
    const row = await this.findById(id);
    if (!row) {
      throw new NotFoundException('Property definition not found');
    }
    return row;
  }

  async create(
    channelId: string,
    dto: CreatePropertyDefinitionDto,
    creatorId: string,
  ): Promise<PropertyDefinitionRow> {
    // Reject `_` prefix for non-native properties
    if (dto.key.startsWith('_')) {
      throw new BadRequestException(
        'Property keys starting with "_" are reserved for native properties',
      );
    }

    // Check for duplicate key
    const existing = await this.findByKey(channelId, dto.key);
    if (existing) {
      throw new ConflictException(
        `Property definition with key "${dto.key}" already exists in this channel`,
      );
    }

    // Get next order
    const maxOrder = await this.getMaxOrder(channelId);

    const [row] = await this.db
      .insert(schema.channelPropertyDefinitions)
      .values({
        id: uuidv7(),
        channelId,
        key: dto.key,
        description: dto.description,
        valueType: dto.valueType,
        isNative: false,
        config: dto.config ?? {},
        order: maxOrder + 1,
        aiAutoFill: dto.aiAutoFill ?? true,
        aiAutoFillPrompt: dto.aiAutoFillPrompt,
        isRequired: dto.isRequired ?? false,
        defaultValue: dto.defaultValue,
        showInChatPolicy: dto.showInChatPolicy ?? 'auto',
        allowNewOptions: dto.allowNewOptions ?? true,
        createdBy: creatorId,
      })
      .returning();

    return row as PropertyDefinitionRow;
  }

  async update(
    id: string,
    dto: UpdatePropertyDefinitionDto,
  ): Promise<PropertyDefinitionRow> {
    await this.findByIdOrThrow(id);

    // Build the update set, omitting undefined fields
    const updateSet: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.description !== undefined) updateSet.description = dto.description;
    if (dto.config !== undefined) updateSet.config = dto.config;
    if (dto.aiAutoFill !== undefined) updateSet.aiAutoFill = dto.aiAutoFill;
    if (dto.aiAutoFillPrompt !== undefined)
      updateSet.aiAutoFillPrompt = dto.aiAutoFillPrompt;
    if (dto.isRequired !== undefined) updateSet.isRequired = dto.isRequired;
    if (dto.defaultValue !== undefined)
      updateSet.defaultValue = dto.defaultValue;
    if (dto.showInChatPolicy !== undefined)
      updateSet.showInChatPolicy = dto.showInChatPolicy;
    if (dto.allowNewOptions !== undefined)
      updateSet.allowNewOptions = dto.allowNewOptions;

    const [row] = await this.db
      .update(schema.channelPropertyDefinitions)
      .set(updateSet)
      .where(eq(schema.channelPropertyDefinitions.id, id))
      .returning();

    if (!row) {
      throw new NotFoundException('Property definition not found');
    }

    return row as PropertyDefinitionRow;
  }

  async delete(id: string): Promise<void> {
    await this.findByIdOrThrow(id);

    await this.db
      .delete(schema.channelPropertyDefinitions)
      .where(eq(schema.channelPropertyDefinitions.id, id));
  }

  async reorder(
    channelId: string,
    definitionIds: string[],
  ): Promise<PropertyDefinitionRow[]> {
    await this.db.transaction(async (tx) => {
      for (let i = 0; i < definitionIds.length; i++) {
        await tx
          .update(schema.channelPropertyDefinitions)
          .set({ order: i, updatedAt: new Date() })
          .where(
            and(
              eq(schema.channelPropertyDefinitions.id, definitionIds[i]),
              eq(schema.channelPropertyDefinitions.channelId, channelId),
            ),
          );
      }
    });

    return this.findAllByChannel(channelId);
  }

  /**
   * Find or create a property definition by key (schema-on-write).
   * Used when setting a property value on a message with a key
   * that may not have a definition yet.
   */
  async findOrCreate(
    channelId: string,
    key: string,
    valueType: PropertyValueType,
    userId: string,
    allowCreate = true,
  ): Promise<PropertyDefinitionRow> {
    const existing = await this.findByKey(channelId, key);
    if (existing) {
      return existing;
    }

    if (!allowCreate) {
      throw new BadRequestException(
        `Property key "${key}" does not exist and auto-creation is not allowed`,
      );
    }

    if (key.startsWith('_')) {
      throw new BadRequestException(
        'Property keys starting with "_" are reserved for native properties',
      );
    }

    const maxOrder = await this.getMaxOrder(channelId);

    try {
      const [created] = await this.db
        .insert(schema.channelPropertyDefinitions)
        .values({
          id: uuidv7(),
          channelId,
          key,
          valueType,
          isNative: false,
          config: {},
          order: maxOrder + 1,
          aiAutoFill: true,
          isRequired: false,
          showInChatPolicy: 'auto',
          allowNewOptions: true,
          createdBy: userId,
        })
        .returning();

      return created as PropertyDefinitionRow;
    } catch (error: unknown) {
      // Unique constraint violation — another concurrent call created it
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code: string }).code === '23505'
      ) {
        const existing = await this.findByKey(channelId, key);
        if (existing) return existing;
      }
      throw error;
    }
  }

  // ==================== Private helpers ====================

  private async findByKey(
    channelId: string,
    key: string,
  ): Promise<PropertyDefinitionRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.channelPropertyDefinitions)
      .where(
        and(
          eq(schema.channelPropertyDefinitions.channelId, channelId),
          eq(schema.channelPropertyDefinitions.key, key),
        ),
      )
      .limit(1);

    return (row as PropertyDefinitionRow) || null;
  }

  private async getMaxOrder(channelId: string): Promise<number> {
    const rows = await this.db
      .select({ order: schema.channelPropertyDefinitions.order })
      .from(schema.channelPropertyDefinitions)
      .where(eq(schema.channelPropertyDefinitions.channelId, channelId))
      .orderBy(asc(schema.channelPropertyDefinitions.order));

    if (rows.length === 0) return -1;
    return Math.max(...rows.map((r) => r.order));
  }
}
