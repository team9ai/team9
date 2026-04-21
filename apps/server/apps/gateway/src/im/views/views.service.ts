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
  sql,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import type { ChannelView } from '@team9/database/schemas';
import type { ViewConfig, ViewFilter, ViewSort } from '@team9/shared';
import { MessagePropertiesService } from '../properties/message-properties.service.js';
import {
  MessageRelationsService,
  type SubtreeNode,
} from '../properties/message-relations.service.js';
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
    private readonly relationsService: MessageRelationsService,
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

    if (dto.config?.hierarchyMode && dto.config?.groupBy) {
      throw new BadRequestException(
        'hierarchyMode is mutually exclusive with groupBy',
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

    if (dto.config?.hierarchyMode && dto.config?.groupBy) {
      throw new BadRequestException(
        'hierarchyMode is mutually exclusive with groupBy',
      );
    }

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
      const cursorDate = new Date(params.cursor);
      if (!isNaN(cursorDate.getTime())) {
        conditions.push(lt(schema.messages.createdAt, cursorDate));
      }
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
      messages: page.map((m) =>
        this.serializeMessageForView(m, propsMap[m.id] ?? {}),
      ),
      total: filtered.length,
      cursor: nextCursor,
    };
  }

  // ==================== Hierarchy Tree ====================

  /**
   * Build a hierarchy tree snapshot for the given view + channel.
   * Returns a flat list of SubtreeNodes (roots + ancestors + children),
   * a cursor for next-page, and the set of ancestor IDs that were included
   * purely for structural context (not in the direct hit set).
   */
  async getTreeSnapshot(params: {
    channelId: string;
    viewId: string;
    filter?: unknown;
    sort?: unknown;
    maxDepth: number;
    expandedIds: string[];
    cursor: string | null;
    limit: number;
  }): Promise<{
    nodes: SubtreeNode[];
    nextCursor: string | null;
    ancestorsIncluded: string[];
  }> {
    // 1) Find the channel's parent-kind definition
    const [parentDef] = await this.db
      .select({ id: schema.channelPropertyDefinitions.id })
      .from(schema.channelPropertyDefinitions)
      .where(
        and(
          eq(schema.channelPropertyDefinitions.channelId, params.channelId),
          sql`${schema.channelPropertyDefinitions.config}->>'relationKind' = 'parent'`,
        ),
      )
      .limit(1);

    if (!parentDef) {
      return { nodes: [], nextCursor: null, ancestorsIncluded: [] };
    }

    // 2) Load a page of message IDs from this channel/view
    const hitIds = await this.findMessageIdsForView(params);

    // 3) Walk ancestors for each hit and collect into a set
    // TODO(perf): N+1 — getEffectiveParent is called once per message in the
    // universe (hits + ancestors). For large pages this becomes O(n * depth)
    // round-trips. Follow-up: replace with a single batch CTE that resolves
    // the full ancestor chain for all hits in one query.
    const ancestorSet = new Set<string>();
    for (const id of hitIds) {
      let cur: string | null = id;
      while (cur) {
        const parent = await this.relationsService.getEffectiveParent(
          cur,
          parentDef.id,
        );
        if (!parent) break;
        if (ancestorSet.has(parent.id)) break;
        ancestorSet.add(parent.id);
        cur = parent.id;
      }
    }

    // 4) Identify roots: nodes in (hits ∪ ancestors) whose effective parent is null
    const universe = Array.from(new Set([...hitIds, ...ancestorSet]));
    const roots: string[] = [];
    for (const id of universe) {
      const p = await this.relationsService.getEffectiveParent(
        id,
        parentDef.id,
      );
      if (!p) roots.push(id);
    }

    // 5) Build subtree from roots up to maxDepth
    const nodes = await this.relationsService.getSubtree({
      channelId: params.channelId,
      rootIds: roots,
      maxDepth: params.maxDepth,
      parentDefinitionId: parentDef.id,
    });

    // 6) Augment with extra children for explicitly expanded IDs
    for (const id of params.expandedIds) {
      const extra = await this.relationsService.getSubtree({
        channelId: params.channelId,
        rootIds: [id],
        maxDepth: 1,
        parentDefinitionId: parentDef.id,
      });
      for (const n of extra) {
        if (!nodes.find((x) => x.messageId === n.messageId)) {
          nodes.push(n);
        }
      }
    }

    // 7) Cursor pagination: return the last hit ID when the page is full
    const nextCursor =
      hitIds.length === params.limit ? hitIds[hitIds.length - 1] : null;

    // 8) ancestorsIncluded = ancestor IDs that are not in the direct hit set
    const hitSet = new Set(hitIds);
    const ancestorsIncluded = [...ancestorSet].filter((id) => !hitSet.has(id));

    return { nodes, nextCursor, ancestorsIncluded };
  }

  /**
   * Fetch a paginated page of non-deleted message IDs from the channel,
   * sorted by (createdAt DESC, id DESC). Cursor is a message ID; the cursor
   * message's createdAt is looked up first so we can do a stable tuple comparison:
   *   WHERE (createdAt, id) < (cursor_createdAt, cursor_id)
   * This prevents duplicate rows when two messages share the same createdAt.
   *
   * Full filter/sort DSL integration is deferred; this MVP version returns all
   * non-deleted messages and lets `getTreeSnapshot` apply structural hierarchy.
   */
  private async findMessageIdsForView(params: {
    channelId: string;
    cursor: string | null;
    limit: number;
  }): Promise<string[]> {
    const conditions: ReturnType<typeof eq>[] = [
      eq(schema.messages.channelId, params.channelId),
      eq(schema.messages.isDeleted, false),
    ];

    if (params.cursor) {
      // Look up the cursor message's createdAt for stable tuple pagination
      const [cursorRow] = await this.db
        .select({ createdAt: schema.messages.createdAt })
        .from(schema.messages)
        .where(eq(schema.messages.id, params.cursor))
        .limit(1);

      if (cursorRow) {
        // Tuple comparison: (createdAt < cursor.createdAt)
        //                OR (createdAt = cursor.createdAt AND id < cursor.id)
        conditions.push(
          sql`(${schema.messages.createdAt} < ${cursorRow.createdAt} OR (${schema.messages.createdAt} = ${cursorRow.createdAt} AND ${schema.messages.id} < ${params.cursor}))`,
        );
      }
    }

    const rows = await this.db
      .select({ id: schema.messages.id })
      .from(schema.messages)
      .where(and(...conditions))
      .orderBy(desc(schema.messages.createdAt), desc(schema.messages.id))
      .limit(params.limit);

    return rows.map((r) => r.id);
  }

  // ==================== Private Helpers ====================

  /**
   * Serialize a message row for view responses. Drops seq_id because it is
   * a PostgreSQL bigint that Drizzle returns as a JS BigInt — Express's
   * JSON.stringify cannot serialize BigInt, and view clients do not consume
   * the field anyway (ViewMessageItem has no seqId).
   */
  private serializeMessageForView(
    m: typeof schema.messages.$inferSelect,
    properties: Record<string, unknown>,
  ) {
    const { seqId: _seqId, ...rest } = m;
    void _seqId;
    return {
      ...rest,
      properties,
    };
  }

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
        if (Array.isArray(value)) {
          return value.includes(filter.value);
        }
        return typeof value === 'string' && typeof filter.value === 'string'
          ? value.includes(filter.value)
          : false;
      case 'not_contains':
        if (Array.isArray(value)) {
          return !value.includes(filter.value);
        }
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
            messages: page.map((m) =>
              this.serializeMessageForView(m, propsMap[m.id] ?? {}),
            ),
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
          messages: page.map((m) =>
            this.serializeMessageForView(m, propsMap[m.id] ?? {}),
          ),
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
