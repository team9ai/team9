import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  sql,
  isNull,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import {
  CreateChannelDto,
  UpdateChannelDto,
  UpdateMemberDto,
} from './dto/index.js';

export interface ChannelResponse {
  id: string;
  tenantId: string | null;
  name: string | null;
  description: string | null;
  type: 'direct' | 'public' | 'private';
  avatarUrl: string | null;
  createdBy: string | null;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChannelWithUnread extends ChannelResponse {
  unreadCount: number;
}

export interface ChannelMemberResponse {
  id: string;
  userId: string;
  role: 'owner' | 'admin' | 'member';
  isMuted: boolean;
  notificationsEnabled: boolean;
  joinedAt: Date;
  user: {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    status: 'online' | 'offline' | 'away' | 'busy';
  };
}

@Injectable()
export class ChannelsService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async create(
    dto: CreateChannelDto,
    creatorId: string,
    tenantId?: string,
  ): Promise<ChannelResponse> {
    const [channel] = await this.db
      .insert(schema.channels)
      .values({
        tenantId,
        name: dto.name,
        description: dto.description,
        type: dto.type,
        avatarUrl: dto.avatarUrl,
        createdBy: creatorId,
      })
      .returning();

    // Add creator as owner
    await this.addMember(channel.id, creatorId, 'owner');

    return channel;
  }

  async createDirectChannel(
    userId1: string,
    userId2: string,
    tenantId?: string,
  ): Promise<ChannelResponse> {
    // Check if direct channel already exists
    const existingChannels = await this.db
      .select({ channelId: schema.channelMembers.channelId })
      .from(schema.channelMembers)
      .innerJoin(
        schema.channels,
        eq(schema.channels.id, schema.channelMembers.channelId),
      )
      .where(
        and(
          eq(schema.channels.type, 'direct'),
          sql`${schema.channelMembers.userId} IN (${userId1}, ${userId2})`,
          isNull(schema.channelMembers.leftAt),
          tenantId ? eq(schema.channels.tenantId, tenantId) : undefined,
        ),
      )
      .groupBy(schema.channelMembers.channelId)
      .having(sql`COUNT(DISTINCT ${schema.channelMembers.userId}) = 2`);

    if (existingChannels.length > 0) {
      const [existing] = await this.db
        .select()
        .from(schema.channels)
        .where(eq(schema.channels.id, existingChannels[0].channelId))
        .limit(1);
      return existing;
    }

    // Create new direct channel
    const [channel] = await this.db
      .insert(schema.channels)
      .values({
        tenantId,
        type: 'direct',
        createdBy: userId1,
      })
      .returning();

    // Add both users
    await this.addMember(channel.id, userId1, 'member');
    await this.addMember(channel.id, userId2, 'member');

    return channel;
  }

  async findById(id: string): Promise<ChannelResponse | null> {
    const [channel] = await this.db
      .select()
      .from(schema.channels)
      .where(eq(schema.channels.id, id))
      .limit(1);

    return channel || null;
  }

  async findByIdOrThrow(id: string): Promise<ChannelResponse> {
    const channel = await this.findById(id);
    if (!channel) {
      throw new NotFoundException('Channel not found');
    }
    return channel;
  }

  async update(
    id: string,
    dto: UpdateChannelDto,
    requesterId: string,
  ): Promise<ChannelResponse> {
    // Check permission
    const role = await this.getMemberRole(id, requesterId);
    if (!role || !['owner', 'admin'].includes(role)) {
      throw new ForbiddenException('Insufficient permissions');
    }

    const [channel] = await this.db
      .update(schema.channels)
      .set({
        ...dto,
        updatedAt: new Date(),
      })
      .where(eq(schema.channels.id, id))
      .returning();

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    return channel;
  }

  async getUserChannels(
    userId: string,
    tenantId?: string,
  ): Promise<ChannelWithUnread[]> {
    const result = await this.db
      .select({
        id: schema.channels.id,
        tenantId: schema.channels.tenantId,
        name: schema.channels.name,
        description: schema.channels.description,
        type: schema.channels.type,
        avatarUrl: schema.channels.avatarUrl,
        createdBy: schema.channels.createdBy,
        isArchived: schema.channels.isArchived,
        createdAt: schema.channels.createdAt,
        updatedAt: schema.channels.updatedAt,
        unreadCount:
          sql<number>`COALESCE(${schema.userChannelReadStatus.unreadCount}, 0)`.as(
            'unread_count',
          ),
      })
      .from(schema.channelMembers)
      .innerJoin(
        schema.channels,
        eq(schema.channels.id, schema.channelMembers.channelId),
      )
      .leftJoin(
        schema.userChannelReadStatus,
        and(
          eq(
            schema.userChannelReadStatus.channelId,
            schema.channelMembers.channelId,
          ),
          eq(schema.userChannelReadStatus.userId, userId),
        ),
      )
      .where(
        and(
          eq(schema.channelMembers.userId, userId),
          isNull(schema.channelMembers.leftAt),
          tenantId ? eq(schema.channels.tenantId, tenantId) : undefined,
        ),
      );

    return result;
  }

  async addMember(
    channelId: string,
    userId: string,
    role: 'owner' | 'admin' | 'member' = 'member',
  ): Promise<void> {
    // Check if already a member
    const existing = await this.db
      .select()
      .from(schema.channelMembers)
      .where(
        and(
          eq(schema.channelMembers.channelId, channelId),
          eq(schema.channelMembers.userId, userId),
          isNull(schema.channelMembers.leftAt),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException('User is already a member');
    }

    await this.db.insert(schema.channelMembers).values({
      channelId,
      userId,
      role,
    });
  }

  async removeMember(
    channelId: string,
    userId: string,
    requesterId: string,
  ): Promise<void> {
    // Check requester permission
    const requesterRole = await this.getMemberRole(channelId, requesterId);
    if (!requesterRole || !['owner', 'admin'].includes(requesterRole)) {
      // Allow users to remove themselves
      if (userId !== requesterId) {
        throw new ForbiddenException('Insufficient permissions');
      }
    }

    await this.db
      .update(schema.channelMembers)
      .set({ leftAt: new Date() })
      .where(
        and(
          eq(schema.channelMembers.channelId, channelId),
          eq(schema.channelMembers.userId, userId),
          isNull(schema.channelMembers.leftAt),
        ),
      );
  }

  async getMemberRole(
    channelId: string,
    userId: string,
  ): Promise<'owner' | 'admin' | 'member' | null> {
    const [member] = await this.db
      .select({ role: schema.channelMembers.role })
      .from(schema.channelMembers)
      .where(
        and(
          eq(schema.channelMembers.channelId, channelId),
          eq(schema.channelMembers.userId, userId),
          isNull(schema.channelMembers.leftAt),
        ),
      )
      .limit(1);

    return member?.role || null;
  }

  async isMember(channelId: string, userId: string): Promise<boolean> {
    const role = await this.getMemberRole(channelId, userId);
    return role !== null;
  }

  async getChannelMembers(channelId: string): Promise<ChannelMemberResponse[]> {
    const result = await this.db
      .select({
        id: schema.channelMembers.id,
        userId: schema.channelMembers.userId,
        role: schema.channelMembers.role,
        isMuted: schema.channelMembers.isMuted,
        notificationsEnabled: schema.channelMembers.notificationsEnabled,
        joinedAt: schema.channelMembers.joinedAt,
        user: {
          id: schema.users.id,
          username: schema.users.username,
          displayName: schema.users.displayName,
          avatarUrl: schema.users.avatarUrl,
          status: schema.users.status,
        },
      })
      .from(schema.channelMembers)
      .innerJoin(
        schema.users,
        eq(schema.users.id, schema.channelMembers.userId),
      )
      .where(
        and(
          eq(schema.channelMembers.channelId, channelId),
          isNull(schema.channelMembers.leftAt),
        ),
      );

    return result;
  }

  async updateMember(
    channelId: string,
    userId: string,
    dto: UpdateMemberDto,
    requesterId: string,
  ): Promise<void> {
    // Only owner can change roles
    if (dto.role) {
      const requesterRole = await this.getMemberRole(channelId, requesterId);
      if (requesterRole !== 'owner') {
        throw new ForbiddenException('Only owner can change roles');
      }
    }

    await this.db
      .update(schema.channelMembers)
      .set(dto)
      .where(
        and(
          eq(schema.channelMembers.channelId, channelId),
          eq(schema.channelMembers.userId, userId),
          isNull(schema.channelMembers.leftAt),
        ),
      );
  }

  async getChannelMemberIds(channelId: string): Promise<string[]> {
    const members = await this.db
      .select({ userId: schema.channelMembers.userId })
      .from(schema.channelMembers)
      .where(
        and(
          eq(schema.channelMembers.channelId, channelId),
          isNull(schema.channelMembers.leftAt),
        ),
      );

    return members.map((m) => m.userId);
  }
}
