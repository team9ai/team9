import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
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
  sectionId: string | null;
  order: number;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChannelWithUnread extends ChannelResponse {
  unreadCount: number;
  otherUser?: {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    status: 'online' | 'offline' | 'away' | 'busy';
    userType: 'human' | 'bot' | 'system';
  };
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
    userType: 'human' | 'bot' | 'system';
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
        id: uuidv7(),
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
        id: uuidv7(),
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

  async findByNameAndTenant(
    name: string,
    tenantId: string,
  ): Promise<ChannelResponse | null> {
    const [channel] = await this.db
      .select()
      .from(schema.channels)
      .where(
        and(
          eq(schema.channels.name, name),
          eq(schema.channels.tenantId, tenantId),
        ),
      )
      .limit(1);

    return channel || null;
  }

  async sendSystemMessage(
    channelId: string,
    content: string,
  ): Promise<{ id: string }> {
    const [message] = await this.db
      .insert(schema.messages)
      .values({
        id: uuidv7(),
        channelId,
        content,
        type: 'system',
        senderId: null,
      })
      .returning({ id: schema.messages.id });

    return message;
  }

  async findByIdOrThrow(
    id: string,
    userId?: string,
  ): Promise<ChannelWithUnread> {
    const channel = await this.findById(id);
    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    // For direct channels, fetch the other user's information
    if (channel.type === 'direct' && userId) {
      const members = await this.db
        .select({
          userId: schema.channelMembers.userId,
          username: schema.users.username,
          displayName: schema.users.displayName,
          avatarUrl: schema.users.avatarUrl,
          status: schema.users.status,
          userType: schema.users.userType,
        })
        .from(schema.channelMembers)
        .innerJoin(
          schema.users,
          eq(schema.users.id, schema.channelMembers.userId),
        )
        .where(
          and(
            eq(schema.channelMembers.channelId, id),
            isNull(schema.channelMembers.leftAt),
          ),
        );

      const otherUser = members.find((m) => m.userId !== userId);

      return {
        ...channel,
        unreadCount: 0, // Not calculated for single channel view
        otherUser: otherUser
          ? {
              id: otherUser.userId,
              username: otherUser.username,
              displayName: otherUser.displayName,
              avatarUrl: otherUser.avatarUrl,
              status: otherUser.status,
              userType: otherUser.userType,
            }
          : undefined,
      };
    }

    return {
      ...channel,
      unreadCount: 0,
    };
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
        sectionId: schema.channels.sectionId,
        order: schema.channels.order,
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

    // For direct channels, fetch the other user's information
    const channelsWithUsers = await Promise.all(
      result.map(async (channel) => {
        if (channel.type === 'direct') {
          // Find the other user in this direct channel
          const members = await this.db
            .select({
              userId: schema.channelMembers.userId,
              username: schema.users.username,
              displayName: schema.users.displayName,
              avatarUrl: schema.users.avatarUrl,
              status: schema.users.status,
              userType: schema.users.userType,
            })
            .from(schema.channelMembers)
            .innerJoin(
              schema.users,
              eq(schema.users.id, schema.channelMembers.userId),
            )
            .where(
              and(
                eq(schema.channelMembers.channelId, channel.id),
                isNull(schema.channelMembers.leftAt),
              ),
            );

          const otherUser = members.find((m) => m.userId !== userId);

          return {
            ...channel,
            otherUser: otherUser
              ? {
                  id: otherUser.userId,
                  username: otherUser.username,
                  displayName: otherUser.displayName,
                  avatarUrl: otherUser.avatarUrl,
                  status: otherUser.status,
                  userType: otherUser.userType,
                }
              : undefined,
          };
        }
        return channel;
      }),
    );

    return channelsWithUsers;
  }

  async addMember(
    channelId: string,
    userId: string,
    role: 'owner' | 'admin' | 'member' = 'member',
  ): Promise<void> {
    // Check if user has any membership record (active or left)
    const [existing] = await this.db
      .select()
      .from(schema.channelMembers)
      .where(
        and(
          eq(schema.channelMembers.channelId, channelId),
          eq(schema.channelMembers.userId, userId),
        ),
      )
      .limit(1);

    if (existing) {
      // User has a record
      if (existing.leftAt === null) {
        // Still an active member
        throw new ConflictException('User is already a member');
      }
      // User previously left - rejoin by clearing leftAt and updating joinedAt
      await this.db
        .update(schema.channelMembers)
        .set({
          leftAt: null,
          joinedAt: new Date(),
          role,
        })
        .where(eq(schema.channelMembers.id, existing.id));
    } else {
      // No existing record - insert new
      await this.db.insert(schema.channelMembers).values({
        id: uuidv7(),
        channelId,
        userId,
        role,
      });
    }
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
          userType: schema.users.userType,
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

  /**
   * Archive a channel (soft delete)
   */
  async archiveChannel(
    channelId: string,
    requesterId: string,
  ): Promise<ChannelResponse> {
    // Check permission
    const role = await this.getMemberRole(channelId, requesterId);
    if (!role || !['owner', 'admin'].includes(role)) {
      throw new ForbiddenException(
        'Insufficient permissions to archive channel',
      );
    }

    // Get channel to check type
    const channel = await this.findById(channelId);
    if (!channel) {
      throw new NotFoundException('Channel not found');
    }
    if (channel.type === 'direct') {
      throw new ForbiddenException('Cannot archive direct message channels');
    }

    const [updated] = await this.db
      .update(schema.channels)
      .set({
        isArchived: true,
        updatedAt: new Date(),
      })
      .where(eq(schema.channels.id, channelId))
      .returning();

    return updated;
  }

  /**
   * Unarchive a channel
   */
  async unarchiveChannel(
    channelId: string,
    requesterId: string,
  ): Promise<ChannelResponse> {
    const role = await this.getMemberRole(channelId, requesterId);
    if (!role || !['owner', 'admin'].includes(role)) {
      throw new ForbiddenException('Insufficient permissions');
    }

    const [updated] = await this.db
      .update(schema.channels)
      .set({
        isArchived: false,
        updatedAt: new Date(),
      })
      .where(eq(schema.channels.id, channelId))
      .returning();

    if (!updated) {
      throw new NotFoundException('Channel not found');
    }

    return updated;
  }

  /**
   * Delete a channel permanently
   */
  async deleteChannel(
    channelId: string,
    requesterId: string,
    confirmationName?: string,
  ): Promise<void> {
    // Only owner can delete
    const role = await this.getMemberRole(channelId, requesterId);
    if (role !== 'owner') {
      throw new ForbiddenException('Only owner can delete a channel');
    }

    const channel = await this.findById(channelId);
    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    if (channel.type === 'direct') {
      throw new ForbiddenException('Cannot delete direct message channels');
    }

    // Verify confirmation name matches (Slack-style safety)
    if (confirmationName && channel.name !== confirmationName) {
      throw new ForbiddenException('Channel name confirmation does not match');
    }

    // Delete channel (cascades to members, messages, etc.)
    await this.db
      .delete(schema.channels)
      .where(eq(schema.channels.id, channelId));
  }

  /**
   * Get all public channels in a workspace/tenant (for browsing)
   * Returns channels with membership status for the requesting user
   * Optimized: Uses subqueries to avoid N+1 query problem
   */
  async getPublicChannels(
    tenantId: string | undefined,
    userId: string,
  ): Promise<(ChannelResponse & { isMember: boolean; memberCount: number })[]> {
    const result = await this.db
      .select({
        id: schema.channels.id,
        tenantId: schema.channels.tenantId,
        name: schema.channels.name,
        description: schema.channels.description,
        type: schema.channels.type,
        avatarUrl: schema.channels.avatarUrl,
        createdBy: schema.channels.createdBy,
        sectionId: schema.channels.sectionId,
        order: schema.channels.order,
        isArchived: schema.channels.isArchived,
        createdAt: schema.channels.createdAt,
        updatedAt: schema.channels.updatedAt,
        memberCount: sql<number>`(
          SELECT COUNT(*)::int
          FROM im_channel_members
          WHERE channel_id = im_channels.id
          AND left_at IS NULL
        )`,
        isMember: sql<boolean>`EXISTS (
          SELECT 1
          FROM im_channel_members
          WHERE channel_id = im_channels.id
          AND user_id = ${userId}
          AND left_at IS NULL
        )`,
      })
      .from(schema.channels)
      .where(
        and(
          eq(schema.channels.type, 'public'),
          eq(schema.channels.isArchived, false),
          tenantId ? eq(schema.channels.tenantId, tenantId) : undefined,
        ),
      );

    return result;
  }

  /**
   * Get public channel details (for non-members to preview)
   */
  async getPublicChannelPreview(
    channelId: string,
    userId: string,
  ): Promise<
    (ChannelResponse & { isMember: boolean; memberCount: number }) | null
  > {
    const [channel] = await this.db
      .select()
      .from(schema.channels)
      .where(
        and(
          eq(schema.channels.id, channelId),
          eq(schema.channels.type, 'public'),
        ),
      )
      .limit(1);

    if (!channel) {
      return null;
    }

    const isMember = await this.isMember(channelId, userId);
    const memberCount = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.channelMembers)
      .where(
        and(
          eq(schema.channelMembers.channelId, channelId),
          isNull(schema.channelMembers.leftAt),
        ),
      )
      .then((result) => Number(result[0]?.count || 0));

    return {
      ...channel,
      isMember,
      memberCount,
    };
  }

  /**
   * Join a public channel (self-join)
   */
  async joinPublicChannel(channelId: string, userId: string): Promise<void> {
    const channel = await this.findById(channelId);
    if (!channel) {
      throw new NotFoundException('Channel not found');
    }
    if (channel.type !== 'public') {
      throw new ForbiddenException('Can only self-join public channels');
    }

    await this.addMember(channelId, userId, 'member');
  }

  /**
   * Normalize channel name (supports Unicode)
   */
  static normalizeChannelName(name: string): string {
    return name
      .trim()
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Collapse multiple hyphens
      .replace(/^-|-$/g, '') // Remove leading/trailing hyphens
      .substring(0, 80);
  }

  /**
   * Validate channel name
   */
  static validateChannelName(name: string): {
    valid: boolean;
    error?: string;
  } {
    if (!name || name.trim().length === 0) {
      return { valid: false, error: 'Channel name is required' };
    }
    if (name.length > 80) {
      return {
        valid: false,
        error: 'Channel name must be 80 characters or less',
      };
    }
    // Allow Unicode letters, numbers, hyphens, and underscores
    // Must start with a letter or number (Unicode-aware)
    if (!/^[\p{L}\p{N}][\p{L}\p{N}\-_]*$/u.test(name)) {
      return {
        valid: false,
        error: 'Channel name must start with a letter or number',
      };
    }
    return { valid: true };
  }
}
