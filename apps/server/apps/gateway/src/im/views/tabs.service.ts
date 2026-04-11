import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
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
import type { ChannelTab } from '@team9/database/schemas';
import { CreateTabDto } from './dto/create-tab.dto.js';
import { UpdateTabDto } from './dto/update-tab.dto.js';

interface BuiltinTabSeed {
  name: string;
  type: string;
  order: number;
}

const BUILTIN_TABS: BuiltinTabSeed[] = [
  { name: 'Messages', type: 'messages', order: 0 },
  { name: 'Files', type: 'files', order: 1 },
];

@Injectable()
export class TabsService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async findAllByChannel(channelId: string): Promise<ChannelTab[]> {
    return this.db
      .select()
      .from(schema.channelTabs)
      .where(eq(schema.channelTabs.channelId, channelId))
      .orderBy(asc(schema.channelTabs.order));
  }

  async findById(tabId: string): Promise<ChannelTab | null> {
    const [row] = await this.db
      .select()
      .from(schema.channelTabs)
      .where(eq(schema.channelTabs.id, tabId))
      .limit(1);

    return row || null;
  }

  async findByIdOrThrow(tabId: string): Promise<ChannelTab> {
    const row = await this.findById(tabId);
    if (!row) {
      throw new NotFoundException('Tab not found');
    }
    return row;
  }

  async create(
    channelId: string,
    dto: CreateTabDto,
    userId: string,
  ): Promise<ChannelTab> {
    // view-type tabs require a valid viewId
    const viewTabTypes = new Set(['table_view', 'board_view', 'calendar_view']);
    if (viewTabTypes.has(dto.type) && !dto.viewId) {
      throw new BadRequestException('viewId is required for view-type tabs');
    }

    // Verify the view exists AND belongs to the same channel
    if (dto.viewId) {
      const [view] = await this.db
        .select()
        .from(schema.channelViews)
        .where(
          and(
            eq(schema.channelViews.id, dto.viewId),
            eq(schema.channelViews.channelId, channelId),
          ),
        )
        .limit(1);
      if (!view) {
        throw new BadRequestException('View not found in this channel');
      }
    }

    const maxOrder = await this.getMaxOrder(channelId);

    const [row] = await this.db
      .insert(schema.channelTabs)
      .values({
        id: uuidv7(),
        channelId,
        name: dto.name,
        type: dto.type,
        viewId: dto.viewId ?? null,
        isBuiltin: false,
        order: maxOrder + 1,
        createdBy: userId,
      })
      .returning();

    return row;
  }

  async update(tabId: string, dto: UpdateTabDto): Promise<ChannelTab> {
    await this.findByIdOrThrow(tabId);

    const updateSet: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.name !== undefined) updateSet.name = dto.name;
    if (dto.order !== undefined) updateSet.order = dto.order;

    const [row] = await this.db
      .update(schema.channelTabs)
      .set(updateSet)
      .where(eq(schema.channelTabs.id, tabId))
      .returning();

    if (!row) {
      throw new NotFoundException('Tab not found');
    }

    return row;
  }

  async delete(tabId: string): Promise<void> {
    const existing = await this.findByIdOrThrow(tabId);

    if (existing.isBuiltin) {
      throw new ForbiddenException('Cannot delete built-in tabs');
    }

    await this.db
      .delete(schema.channelTabs)
      .where(eq(schema.channelTabs.id, tabId));
  }

  async reorder(channelId: string, tabIds: string[]): Promise<void> {
    await Promise.all(
      tabIds.map((tabId, index) =>
        this.db
          .update(schema.channelTabs)
          .set({ order: index, updatedAt: new Date() })
          .where(
            and(
              eq(schema.channelTabs.id, tabId),
              eq(schema.channelTabs.channelId, channelId),
            ),
          ),
      ),
    );
  }

  /**
   * Seed built-in tabs for a channel (idempotent).
   * Creates Messages and Files tabs if they don't already exist.
   */
  async seedBuiltinTabs(channelId: string): Promise<void> {
    const existing = await this.findAllByChannel(channelId);
    const existingTypes = new Set(
      existing.filter((t) => t.isBuiltin).map((t) => t.type),
    );

    const toInsert = BUILTIN_TABS.filter((bt) => !existingTypes.has(bt.type));

    if (toInsert.length === 0) {
      return;
    }

    const values = toInsert.map((bt) => ({
      id: uuidv7(),
      channelId,
      name: bt.name,
      type: bt.type,
      isBuiltin: true,
      order: bt.order,
    }));

    await this.db.insert(schema.channelTabs).values(values);
  }

  // ==================== Private helpers ====================

  private async getMaxOrder(channelId: string): Promise<number> {
    const rows = await this.db
      .select({ order: schema.channelTabs.order })
      .from(schema.channelTabs)
      .where(eq(schema.channelTabs.channelId, channelId))
      .orderBy(asc(schema.channelTabs.order));

    if (rows.length === 0) return -1;
    return Math.max(...rows.map((r) => r.order));
  }
}
