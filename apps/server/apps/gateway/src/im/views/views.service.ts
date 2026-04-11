import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  asc,
  desc,
  lt,
  isNull,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import type { ChannelView } from '@team9/database/schemas';
import type { ViewConfig, ViewFilter, ViewSort } from '@team9/shared';
import { MessagePropertiesService } from '../properties/message-properties.service.js';
import { CreateViewDto } from './dto/create-view.dto.js';
import { UpdateViewDto } from './dto/update-view.dto.js';

/** Maximum number of views per channel */
const MAX_VIEWS_PER_CHANNEL = 20;

/** Default batch size for fetching messages before in-app filtering */
const MESSAGE_BATCH_SIZE = 500;

@Injectable()
export class ViewsService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly messagePropertiesService: MessagePropertiesService,
  ) {}

  // ==================== CRUD ====================

  async findAllByChannel(channelId: string): Promise<ChannelView[]> {
    return this.db
      .select()
      .from(schema.channelViews)
      .where(eq(schema.channelViews.channelId, channelId))
      .orderBy(asc(schema.channelViews.order));
  }

  async findById(viewId: string): Promise<ChannelView | null> {
    const [row] = await this.db
      .select()
      .from(schema.channelViews)
      .where(eq(schema.channelViews.id, viewId))
      .limit(1);

    return row || null;
  }

  async findByIdOrThrow(viewId: string): Promise<ChannelView> {
    const row = await this.findById(viewId);
    if (!row) {
      throw new NotFoundException('View not found');
    }
    return row;
  }

  async create(
    channelId: string,
    dto: CreateViewDto,
    userId: string,
  ): Promise<ChannelView> {
    // Enforce per-channel view limit
    const existingCount = await this.countByChannel(channelId);
    if (existingCount >= MAX_VIEWS_PER_CHANNEL) {
      throw new BadRequestException(
        `Maximum ${MAX_VIEWS_PER_CHANNEL} views per channel`,
      );
    }

    const maxOrder = await this.getMaxOrder(channelId);

    const config: ViewConfig = dto.config ?? { filters: [], sorts: [] };

    const [row] = await this.db
      .insert(schema.channelViews)
      .values({
        id: uuidv7(),
        channelId,
        name: dto.name,
        type: dto.type,
        config,
        order: maxOrder + 1,
        createdBy: userId,
      })
      .returning();

    return row;
  }

  async update(viewId: string, dto: UpdateViewDto): Promise<ChannelView> {
    await this.findByIdOrThrow(viewId);

    const updateSet: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.name !== undefined) updateSet.name = dto.name;
    if (dto.order !== undefined) updateSet.order = dto.order;
    if (dto.config !== undefined) updateSet.config = dto.config;

    const [row] = await this.db
      .update(schema.channelViews)
      .set(updateSet)
      .where(eq(schema.channelViews.id, viewId))
      .returning();

    if (!row) {
      throw new NotFoundException('View not found');
    }

    return row;
  }

  async delete(viewId: string): Promise<void> {
    await this.findByIdOrThrow(viewId);

    await this.db
      .delete(schema.channelViews)
      .where(eq(schema.channelViews.id, viewId));
  }

  // ==================== Query Messages ====================

  async queryMessages(
    viewId: string,
    params: { group?: string; cursor?: string; limit?: number },
  ) {
    const view = await this.findByIdOrThrow(viewId);
    const config = (view.config ?? {}) as ViewConfig;
    const limit = params.limit ?? 20;

    // 1. Load a batch of root messages from this channel
    const conditions = [
      eq(schema.messages.channelId, view.channelId),
      eq(schema.messages.isDeleted, false),
      isNull(schema.messages.parentId),
    ];

    if (params.cursor) {
      conditions.push(lt(schema.messages.createdAt, new Date(params.cursor)));
    }

    const messages = await this.db
      .select()
      .from(schema.messages)
      .where(and(...conditions))
      .orderBy(desc(schema.messages.createdAt))
      .limit(MESSAGE_BATCH_SIZE);

    if (messages.length === 0) {
      return config.groupBy
        ? { groups: [], total: 0 }
        : { messages: [], total: 0, cursor: null };
    }

    // 2. Batch-load properties
    const messageIds = messages.map((m) => m.id);
    const propsMap =
      await this.messagePropertiesService.batchGetByMessageIds(messageIds);

    // 3. Apply filters in application layer
    const filtered = config.filters?.length
      ? messages.filter((m) =>
          this.matchesFilters(propsMap[m.id] ?? {}, config.filters!),
        )
      : messages;

    // 4. Apply sorts
    const sorted = config.sorts?.length
      ? this.applySorts(filtered, propsMap, config.sorts)
      : filtered;

    // 5. Group or paginate
    if (config.groupBy) {
      return this.buildGroupedResponse(
        sorted,
        propsMap,
        config.groupBy,
        params,
        limit,
      );
    }

    // Flat pagination
    const page = sorted.slice(0, limit);
    const nextCursor =
      page.length === limit
        ? page[page.length - 1].createdAt.toISOString()
        : null;

    return {
      messages: page.map((m) => ({
        ...m,
        properties: propsMap[m.id] ?? {},
      })),
      total: filtered.length,
      cursor: nextCursor,
    };
  }

  // ==================== Private Helpers ====================

  /**
   * Safely convert an unknown value to a string for comparison/grouping.
   * Avoids @typescript-eslint/no-base-to-string by explicit type narrowing.
   */
  private toStr(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') {
      return value.toString();
    }
    if (value === null || value === undefined) return '';
    return JSON.stringify(value);
  }

  private matchesFilters(
    props: Record<string, unknown>,
    filters: ViewFilter[],
  ): boolean {
    return filters.every((filter) => this.matchesSingleFilter(props, filter));
  }

  private matchesSingleFilter(
    props: Record<string, unknown>,
    filter: ViewFilter,
  ): boolean {
    const value = props[filter.propertyKey];

    switch (filter.operator) {
      case 'eq':
        return value === filter.value;
      case 'neq':
        return value !== filter.value;
      case 'gt':
        return typeof value === 'number' && typeof filter.value === 'number'
          ? value > filter.value
          : false;
      case 'gte':
        return typeof value === 'number' && typeof filter.value === 'number'
          ? value >= filter.value
          : false;
      case 'lt':
        return typeof value === 'number' && typeof filter.value === 'number'
          ? value < filter.value
          : false;
      case 'lte':
        return typeof value === 'number' && typeof filter.value === 'number'
          ? value <= filter.value
          : false;
      case 'contains':
        return typeof value === 'string' && typeof filter.value === 'string'
          ? value.includes(filter.value)
          : false;
      case 'not_contains':
        return typeof value === 'string' && typeof filter.value === 'string'
          ? !value.includes(filter.value)
          : true;
      case 'is_empty':
        return (
          value === undefined ||
          value === null ||
          value === '' ||
          (Array.isArray(value) && value.length === 0)
        );
      case 'is_not_empty':
        return (
          value !== undefined &&
          value !== null &&
          value !== '' &&
          !(Array.isArray(value) && value.length === 0)
        );
      case 'in':
        return Array.isArray(filter.value) && filter.value.includes(value);
      case 'not_in':
        return Array.isArray(filter.value) && !filter.value.includes(value);
      default:
        return true;
    }
  }

  private applySorts(
    messages: (typeof schema.messages.$inferSelect)[],
    propsMap: Record<string, Record<string, unknown>>,
    sorts: ViewSort[],
  ): (typeof schema.messages.$inferSelect)[] {
    return [...messages].sort((a, b) => {
      for (const sort of sorts) {
        const aVal = (propsMap[a.id] ?? {})[sort.propertyKey];
        const bVal = (propsMap[b.id] ?? {})[sort.propertyKey];
        const cmp = this.compareValues(aVal, bVal);
        if (cmp !== 0) {
          return sort.direction === 'asc' ? cmp : -cmp;
        }
      }
      return 0;
    });
  }

  private compareValues(a: unknown, b: unknown): number {
    if (a === b) return 0;
    if (a === undefined || a === null) return 1;
    if (b === undefined || b === null) return -1;

    if (typeof a === 'number' && typeof b === 'number') {
      return a - b;
    }

    if (typeof a === 'string' && typeof b === 'string') {
      return a.localeCompare(b);
    }

    if (typeof a === 'boolean' && typeof b === 'boolean') {
      return a === b ? 0 : a ? -1 : 1;
    }

    return this.toStr(a).localeCompare(this.toStr(b));
  }

  private buildGroupedResponse(
    messages: (typeof schema.messages.$inferSelect)[],
    propsMap: Record<string, Record<string, unknown>>,
    groupByKey: string,
    params: { group?: string; cursor?: string; limit?: number },
    limit: number,
  ) {
    // Group messages by the groupBy property value
    const groupMap = new Map<string, (typeof schema.messages.$inferSelect)[]>();

    for (const msg of messages) {
      const propValue = (propsMap[msg.id] ?? {})[groupByKey];
      const groupKey =
        propValue !== undefined && propValue !== null
          ? this.toStr(propValue)
          : '__ungrouped__';

      if (!groupMap.has(groupKey)) {
        groupMap.set(groupKey, []);
      }
      groupMap.get(groupKey)!.push(msg);
    }

    // If a specific group is requested, return only that group
    if (params.group !== undefined) {
      const groupMessages = groupMap.get(params.group) ?? [];
      const page = groupMessages.slice(0, limit);
      const nextCursor =
        page.length === limit
          ? page[page.length - 1].createdAt.toISOString()
          : null;

      return {
        groups: [
          {
            key: params.group,
            messages: page.map((m) => ({
              ...m,
              properties: propsMap[m.id] ?? {},
            })),
            total: groupMessages.length,
            cursor: nextCursor,
          },
        ],
        total: messages.length,
      };
    }

    // Return all groups, each with independent pagination
    const groups = Array.from(groupMap.entries()).map(
      ([key, groupMessages]) => {
        const page = groupMessages.slice(0, limit);
        const nextCursor =
          page.length === limit
            ? page[page.length - 1].createdAt.toISOString()
            : null;

        return {
          key,
          messages: page.map((m) => ({
            ...m,
            properties: propsMap[m.id] ?? {},
          })),
          total: groupMessages.length,
          cursor: nextCursor,
        };
      },
    );

    return {
      groups,
      total: messages.length,
    };
  }

  private async countByChannel(channelId: string): Promise<number> {
    const rows = await this.db
      .select({ id: schema.channelViews.id })
      .from(schema.channelViews)
      .where(eq(schema.channelViews.channelId, channelId));

    return rows.length;
  }

  private async getMaxOrder(channelId: string): Promise<number> {
    const rows = await this.db
      .select({ order: schema.channelViews.order })
      .from(schema.channelViews)
      .where(eq(schema.channelViews.channelId, channelId))
      .orderBy(asc(schema.channelViews.order));

    if (rows.length === 0) return -1;
    return Math.max(...rows.map((r) => r.order));
  }
}
