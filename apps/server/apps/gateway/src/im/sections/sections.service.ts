import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
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
import { CreateSectionDto, UpdateSectionDto } from './dto/index.js';

export interface SectionResponse {
  id: string;
  tenantId: string | null;
  name: string;
  order: number;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SectionWithChannels extends SectionResponse {
  channels: {
    id: string;
    name: string | null;
    type: 'direct' | 'public' | 'private';
    order: number;
  }[];
}

@Injectable()
export class SectionsService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async create(
    dto: CreateSectionDto,
    creatorId: string,
    tenantId?: string,
  ): Promise<SectionResponse> {
    // Get current max order
    const maxOrderResult = await this.db
      .select({ maxOrder: schema.channelSections.order })
      .from(schema.channelSections)
      .where(
        tenantId
          ? eq(schema.channelSections.tenantId, tenantId)
          : (undefined as never),
      )
      .orderBy(asc(schema.channelSections.order))
      .limit(1);

    const nextOrder = (maxOrderResult[0]?.maxOrder ?? -1) + 1;

    const [section] = await this.db
      .insert(schema.channelSections)
      .values({
        id: uuidv7(),
        tenantId,
        name: dto.name,
        order: nextOrder,
        createdBy: creatorId,
      })
      .returning();

    return section;
  }

  async findById(id: string): Promise<SectionResponse | null> {
    const [section] = await this.db
      .select()
      .from(schema.channelSections)
      .where(eq(schema.channelSections.id, id))
      .limit(1);

    return section || null;
  }

  async findByIdOrThrow(id: string): Promise<SectionResponse> {
    const section = await this.findById(id);
    if (!section) {
      throw new NotFoundException('Section not found');
    }
    return section;
  }

  async getSections(tenantId?: string): Promise<SectionResponse[]> {
    const sections = await this.db
      .select()
      .from(schema.channelSections)
      .where(
        tenantId
          ? eq(schema.channelSections.tenantId, tenantId)
          : (undefined as never),
      )
      .orderBy(asc(schema.channelSections.order));

    return sections;
  }

  async getSectionsWithChannels(
    tenantId?: string,
  ): Promise<SectionWithChannels[]> {
    const sections = await this.getSections(tenantId);

    const sectionsWithChannels = await Promise.all(
      sections.map(async (section) => {
        const channels = await this.db
          .select({
            id: schema.channels.id,
            name: schema.channels.name,
            type: schema.channels.type,
            order: schema.channels.order,
          })
          .from(schema.channels)
          .where(
            and(
              eq(schema.channels.sectionId, section.id),
              eq(schema.channels.isArchived, false),
            ),
          )
          .orderBy(asc(schema.channels.order));

        return {
          ...section,
          channels,
        };
      }),
    );

    return sectionsWithChannels;
  }

  async update(
    id: string,
    dto: UpdateSectionDto,
    _requesterId: string,
  ): Promise<SectionResponse> {
    const [section] = await this.db
      .update(schema.channelSections)
      .set({
        ...dto,
        updatedAt: new Date(),
      })
      .where(eq(schema.channelSections.id, id))
      .returning();

    if (!section) {
      throw new NotFoundException('Section not found');
    }

    return section;
  }

  async delete(id: string, _requesterId: string): Promise<void> {
    const section = await this.findById(id);
    if (!section) {
      throw new NotFoundException('Section not found');
    }

    // Move all channels in this section to no section (null)
    await this.db
      .update(schema.channels)
      .set({ sectionId: null })
      .where(eq(schema.channels.sectionId, id));

    // Delete the section
    await this.db
      .delete(schema.channelSections)
      .where(eq(schema.channelSections.id, id));
  }

  async reorderSections(
    sectionIds: string[],
    tenantId?: string,
  ): Promise<SectionResponse[]> {
    // Update order for each section
    await Promise.all(
      sectionIds.map((sectionId, index) =>
        this.db
          .update(schema.channelSections)
          .set({ order: index, updatedAt: new Date() })
          .where(
            and(
              eq(schema.channelSections.id, sectionId),
              tenantId
                ? eq(schema.channelSections.tenantId, tenantId)
                : (undefined as never),
            ),
          ),
      ),
    );

    return this.getSections(tenantId);
  }

  async moveChannelToSection(
    channelId: string,
    sectionId: string | null,
    order?: number,
    requesterId?: string,
  ): Promise<void> {
    // Verify channel exists
    const [channel] = await this.db
      .select()
      .from(schema.channels)
      .where(eq(schema.channels.id, channelId))
      .limit(1);

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    // If moving to a section, verify section exists
    if (sectionId) {
      const section = await this.findById(sectionId);
      if (!section) {
        throw new NotFoundException('Section not found');
      }
    }

    // Check if user has permission (owner or admin of channel)
    if (requesterId) {
      const [membership] = await this.db
        .select({ role: schema.channelMembers.role })
        .from(schema.channelMembers)
        .where(
          and(
            eq(schema.channelMembers.channelId, channelId),
            eq(schema.channelMembers.userId, requesterId),
          ),
        )
        .limit(1);

      if (!membership || !['owner', 'admin'].includes(membership.role)) {
        throw new ForbiddenException(
          'Insufficient permissions to move channel',
        );
      }
    }

    await this.db
      .update(schema.channels)
      .set({
        sectionId,
        order: order ?? 0,
        updatedAt: new Date(),
      })
      .where(eq(schema.channels.id, channelId));
  }
}
