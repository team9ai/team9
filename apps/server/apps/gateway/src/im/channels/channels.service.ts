import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  sql,
  desc,
  isNull,
  inArray,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import type { ChannelSnapshot, BotExtra } from '@team9/database/schemas';
import {
  CreateChannelDto,
  UpdateChannelDto,
  UpdateMemberDto,
} from './dto/index.js';
import { RedisService } from '@team9/redis';
import { REDIS_KEYS } from '../shared/constants/redis-keys.js';
import { ChannelMemberCacheService } from '../shared/channel-member-cache.service.js';
import {
  resolveAgentType,
  type AgentType,
} from '../../common/utils/agent-type.util.js';
import { PropertyDefinitionsService } from '../properties/property-definitions.service.js';
import { TabsService } from '../views/tabs.service.js';

export interface ChannelResponse {
  id: string;
  tenantId: string | null;
  name: string | null;
  description: string | null;
  type: 'direct' | 'public' | 'private' | 'task' | 'tracking' | 'echo';
  avatarUrl: string | null;
  createdBy: string | null;
  sectionId: string | null;
  order: number;
  isArchived: boolean;
  isActivated: boolean;
  snapshot: ChannelSnapshot | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChannelWithUnread extends ChannelResponse {
  unreadCount: number;
  lastReadMessageId: string | null;
  showInDmSidebar?: boolean;
  otherUser?: {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    status: 'online' | 'offline' | 'away' | 'busy';
    userType: 'human' | 'bot' | 'system';
    agentType: AgentType | null;
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
    agentType: AgentType | null;
    createdAt: Date;
  };
}

type ChannelUserSummaryRow = {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  status: 'online' | 'offline' | 'away' | 'busy';
  userType: 'human' | 'bot' | 'system';
  applicationId: string | null;
  managedProvider: string | null;
  managedMeta: schema.ManagedMeta | null;
};

@Injectable()
export class ChannelsService {
  private readonly logger = new Logger(ChannelsService.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly redis: RedisService,
    private readonly channelMemberCacheService: ChannelMemberCacheService,
    private readonly propertyDefinitionsService: PropertyDefinitionsService,
    private readonly tabsService: TabsService,
  ) {}

  /**
   * Check if a target user is a personal staff bot with restricted DM access.
   * Throws ForbiddenException if the requester is not the owner and DMs are not allowed.
   */
  async assertDirectMessageAllowed(
    requesterId: string,
    targetUserId: string,
  ): Promise<void> {
    const [botRow] = await this.db
      .select({
        ownerId: schema.bots.ownerId,
        extra: schema.bots.extra,
        applicationId: schema.installedApplications.applicationId,
      })
      .from(schema.bots)
      .leftJoin(
        schema.installedApplications,
        eq(schema.bots.installedApplicationId, schema.installedApplications.id),
      )
      .where(eq(schema.bots.userId, targetUserId))
      .limit(1);

    if (!botRow) return; // Not a bot — no restriction
    if (botRow.applicationId !== 'personal-staff') return; // Not a personal staff bot

    const extra = (botRow.extra as BotExtra) ?? {};
    const visibility = extra.personalStaff?.visibility;

    // Owner is always allowed
    if (botRow.ownerId === requesterId) return;

    if (!visibility?.allowDirectMessage) {
      throw new ForbiddenException(
        'This is a private assistant and is not open for direct messages.',
      );
    }
  }

  /**
   * Check if mentioning a set of user IDs is allowed for the given sender.
   * Throws BadRequestException if any mentioned user is a personal staff bot
   * with restricted mention access and the sender is not the owner.
   */
  async assertMentionsAllowed(
    senderId: string,
    mentionedUserIds: string[],
  ): Promise<void> {
    if (mentionedUserIds.length === 0) return;

    // Fetch bot rows for all mentioned user IDs in a single query
    const botRows = await this.db
      .select({
        userId: schema.bots.userId,
        ownerId: schema.bots.ownerId,
        extra: schema.bots.extra,
        applicationId: schema.installedApplications.applicationId,
      })
      .from(schema.bots)
      .leftJoin(
        schema.installedApplications,
        eq(schema.bots.installedApplicationId, schema.installedApplications.id),
      )
      .where(inArray(schema.bots.userId, mentionedUserIds));

    for (const botRow of botRows) {
      if (botRow.applicationId !== 'personal-staff') continue;

      const extra = (botRow.extra as BotExtra) ?? {};
      const visibility = extra.personalStaff?.visibility;

      // Owner is always allowed
      if (botRow.ownerId === senderId) continue;

      if (!visibility?.allowMention) {
        throw new BadRequestException(
          'This is a private assistant and is not open for @mentions.',
        );
      }
    }
  }

  private mapChannelUserSummary(row: ChannelUserSummaryRow) {
    return {
      id: row.userId,
      username: row.username,
      displayName: row.displayName,
      avatarUrl: row.avatarUrl,
      status: row.status,
      userType: row.userType,
      agentType: resolveAgentType({
        userType: row.userType,
        applicationId: row.applicationId,
        managedProvider: row.managedProvider,
        managedMeta: row.managedMeta,
      }),
    };
  }

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

    // Seed native properties and built-in tabs for public/private channels
    if (dto.type === 'public' || dto.type === 'private') {
      await this.propertyDefinitionsService.seedNativeProperties(
        channel.id,
        creatorId,
      );
      await this.tabsService.seedBuiltinTabs(channel.id);
    }

    return channel;
  }

  async createDirectChannel(
    userId1: string,
    userId2: string,
    tenantId?: string,
  ): Promise<ChannelResponse> {
    // Self-chat: create or return existing echo channel
    if (userId1 === userId2) {
      return this.getOrCreateEchoChannel(userId1, tenantId);
    }

    // Permission check: verify the requester can DM the target
    // (blocks DMs to restricted personal staff bots)
    await this.assertDirectMessageAllowed(userId1, userId2);

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

  /**
   * Get or create an echo channel (self-chat) for the given user.
   * Echo channels have a single member and no notifications.
   */
  private async getOrCreateEchoChannel(
    userId: string,
    tenantId?: string,
  ): Promise<ChannelResponse> {
    // Check if echo channel already exists for this user
    const existing = await this.db
      .select({ channelId: schema.channelMembers.channelId })
      .from(schema.channelMembers)
      .innerJoin(
        schema.channels,
        eq(schema.channels.id, schema.channelMembers.channelId),
      )
      .where(
        and(
          eq(schema.channels.type, 'echo'),
          eq(schema.channelMembers.userId, userId),
          isNull(schema.channelMembers.leftAt),
          tenantId ? eq(schema.channels.tenantId, tenantId) : undefined,
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      const [channel] = await this.db
        .select()
        .from(schema.channels)
        .where(eq(schema.channels.id, existing[0].channelId))
        .limit(1);
      return channel;
    }

    // Create new echo channel (with retry on race condition)
    try {
      const [channel] = await this.db
        .insert(schema.channels)
        .values({
          id: uuidv7(),
          tenantId,
          type: 'echo',
          createdBy: userId,
        })
        .returning();

      await this.addMember(channel.id, userId, 'owner');

      return channel;
    } catch {
      // Race condition: another request created the echo channel concurrently.
      // Re-query to find it.
      const [retried] = await this.db
        .select({ channelId: schema.channelMembers.channelId })
        .from(schema.channelMembers)
        .innerJoin(
          schema.channels,
          eq(schema.channels.id, schema.channelMembers.channelId),
        )
        .where(
          and(
            eq(schema.channels.type, 'echo'),
            eq(schema.channelMembers.userId, userId),
            isNull(schema.channelMembers.leftAt),
            tenantId ? eq(schema.channels.tenantId, tenantId) : undefined,
          ),
        )
        .limit(1);

      if (retried) {
        const [channel] = await this.db
          .select()
          .from(schema.channels)
          .where(eq(schema.channels.id, retried.channelId))
          .limit(1);
        return channel;
      }
      throw new ConflictException('Failed to create echo channel');
    }
  }

  /**
   * Batch-create DM channels between one user and multiple other users.
   * Skips pairs that already have an existing DM channel.
   * Uses 3 queries instead of N*3 for N members.
   *
   * Returns all DM channels (existing + newly created) mapped by the other user's ID.
   *
   * NOTE: This method does NOT run assertDirectMessageAllowed permission checks.
   * It is intended for trusted server-side flows (bot creation, workspace join).
   * Use createDirectChannel for user-initiated single-pair DM creation.
   */
  async createDirectChannelsBatch(
    newUserId: string,
    memberUserIds: string[],
    tenantId: string,
  ): Promise<Map<string, ChannelResponse>> {
    if (memberUserIds.length === 0) return new Map();

    // 1. Find all existing DM channels between newUserId and any of memberUserIds
    const existingDms = await this.db
      .select({
        channelId: schema.channelMembers.channelId,
        userId: schema.channelMembers.userId,
      })
      .from(schema.channelMembers)
      .innerJoin(
        schema.channels,
        eq(schema.channels.id, schema.channelMembers.channelId),
      )
      .where(
        and(
          eq(schema.channels.type, 'direct'),
          eq(schema.channels.tenantId, tenantId),
          isNull(schema.channelMembers.leftAt),
          sql`${schema.channelMembers.channelId} IN (
            SELECT cm2.channel_id FROM im_channel_members cm2
            WHERE cm2.user_id = ${newUserId} AND cm2.left_at IS NULL
          )`,
          inArray(schema.channelMembers.userId, memberUserIds),
        ),
      );

    // Map: otherUserId -> channelId for existing DMs
    const existingMap = new Map<string, string>();
    for (const row of existingDms) {
      existingMap.set(row.userId, row.channelId);
    }

    // Determine which members need new DM channels
    const needNew = memberUserIds.filter((id) => !existingMap.has(id));

    // 2. Batch insert new channels
    const resultMap = new Map<string, ChannelResponse>();

    if (needNew.length > 0) {
      const channelRows = needNew.map((memberId) => ({
        id: uuidv7(),
        tenantId,
        type: 'direct' as const,
        createdBy: memberId,
      }));

      const insertedChannels = await this.db
        .insert(schema.channels)
        .values(channelRows)
        .returning();

      // 3. Batch insert channel members (2 per channel: newUser + existingMember)
      const memberRows = insertedChannels.flatMap((ch, i) => [
        {
          id: uuidv7(),
          channelId: ch.id,
          userId: needNew[i],
          role: 'member' as const,
        },
        {
          id: uuidv7(),
          channelId: ch.id,
          userId: newUserId,
          role: 'member' as const,
        },
      ]);

      await this.db.insert(schema.channelMembers).values(memberRows);

      for (let i = 0; i < insertedChannels.length; i++) {
        resultMap.set(needNew[i], insertedChannels[i]);
      }
    }

    // 4. Fetch existing channel details for already-existing DMs
    if (existingMap.size > 0) {
      const existingChannelIds = [...new Set(existingMap.values())];
      const channels = await this.db
        .select()
        .from(schema.channels)
        .where(inArray(schema.channels.id, existingChannelIds));

      const channelById = new Map(channels.map((c) => [c.id, c]));
      for (const [memberId, channelId] of existingMap) {
        const ch = channelById.get(channelId);
        if (ch) resultMap.set(memberId, ch);
      }
    }

    return resultMap;
  }

  async findById(id: string): Promise<ChannelResponse | null> {
    return this.redis.getOrSet(
      REDIS_KEYS.CHANNEL_CACHE(id),
      async () => {
        const [channel] = await this.db
          .select()
          .from(schema.channels)
          .where(eq(schema.channels.id, id))
          .limit(1);

        return channel || null;
      },
      120,
    );
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
  ): Promise<{
    id: string;
    channelId: string;
    senderId: null;
    content: string;
    type: 'system';
    isPinned: boolean;
    isEdited: boolean;
    isDeleted: boolean;
    createdAt: Date;
    updatedAt: Date;
  }> {
    const [message] = await this.db
      .insert(schema.messages)
      .values({
        id: uuidv7(),
        channelId,
        content,
        type: 'system',
        senderId: null,
      })
      .returning();

    return {
      id: message.id,
      channelId: message.channelId,
      senderId: null,
      content: message.content ?? content,
      type: 'system',
      isPinned: message.isPinned,
      isEdited: message.isEdited,
      isDeleted: message.isDeleted,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
    };
  }

  async findByIdOrThrow(
    id: string,
    userId?: string,
  ): Promise<ChannelWithUnread> {
    const channel = await this.findById(id);
    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    // For direct/echo channels, fetch the other user's information
    if ((channel.type === 'direct' || channel.type === 'echo') && userId) {
      const otherUser =
        channel.type === 'echo'
          ? await this.getUserSummary(userId)
          : await this.getDmOtherUser(id, userId);

      return {
        ...channel,
        unreadCount: 0, // Not calculated for single channel view
        lastReadMessageId: null,
        otherUser: otherUser || undefined,
      };
    }

    return {
      ...channel,
      unreadCount: 0,
      lastReadMessageId: null,
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

    await this.redis.invalidate(REDIS_KEYS.CHANNEL_CACHE(id));

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
        isActivated: schema.channels.isActivated,
        snapshot: schema.channels.snapshot,
        createdAt: schema.channels.createdAt,
        updatedAt: schema.channels.updatedAt,
        unreadCount:
          sql<number>`COALESCE(${schema.userChannelReadStatus.unreadCount}, 0)`.as(
            'unread_count',
          ),
        lastReadMessageId: schema.userChannelReadStatus.lastReadMessageId,
        showInDmSidebar: schema.channelMembers.showInDmSidebar,
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

    // For direct/echo channels, batch-fetch "other user" info in a single query
    const directChannelIds = result
      .filter((ch) => ch.type === 'direct')
      .map((ch) => ch.id);
    const echoChannelIds = result
      .filter((ch) => ch.type === 'echo')
      .map((ch) => ch.id);

    type UserSummary = {
      id: string;
      username: string;
      displayName: string | null;
      avatarUrl: string | null;
      status: 'online' | 'offline' | 'away' | 'busy';
      userType: 'human' | 'bot' | 'system';
      agentType: AgentType | null;
    };
    const otherUserMap = new Map<string, UserSummary>();

    if (directChannelIds.length > 0) {
      const allMembers = await this.db
        .select({
          channelId: schema.channelMembers.channelId,
          userId: schema.channelMembers.userId,
          username: schema.users.username,
          displayName: schema.users.displayName,
          avatarUrl: schema.users.avatarUrl,
          status: schema.users.status,
          userType: schema.users.userType,
          applicationId: schema.installedApplications.applicationId,
          managedProvider: schema.bots.managedProvider,
          managedMeta: schema.bots.managedMeta,
        })
        .from(schema.channelMembers)
        .innerJoin(
          schema.users,
          eq(schema.users.id, schema.channelMembers.userId),
        )
        .leftJoin(
          schema.bots,
          eq(schema.bots.userId, schema.channelMembers.userId),
        )
        .leftJoin(
          schema.installedApplications,
          eq(
            schema.bots.installedApplicationId,
            schema.installedApplications.id,
          ),
        )
        .where(
          and(
            inArray(schema.channelMembers.channelId, directChannelIds),
            isNull(schema.channelMembers.leftAt),
          ),
        );

      for (const member of allMembers) {
        if (member.userId !== userId) {
          otherUserMap.set(
            member.channelId,
            this.mapChannelUserSummary(member),
          );
        }
      }
    }

    // For echo channels, the "other user" is the current user (self)
    if (echoChannelIds.length > 0) {
      const selfSummary = await this.getUserSummary(userId);
      if (selfSummary) {
        for (const id of echoChannelIds) {
          otherUserMap.set(id, selfSummary);
        }
      }
    }

    return result.map((channel) => {
      if (channel.type === 'direct' || channel.type === 'echo') {
        return {
          ...channel,
          otherUser: otherUserMap.get(channel.id),
        };
      }
      // Strip showInDmSidebar from non-DM channels
      const { showInDmSidebar: _, ...rest } = channel;
      return rest;
    });
  }

  /**
   * Get a user's summary info for echo channel display.
   */
  private async getUserSummary(userId: string): Promise<{
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    status: 'online' | 'offline' | 'away' | 'busy';
    userType: 'human' | 'bot' | 'system';
    agentType: AgentType | null;
  } | null> {
    const [user] = await this.db
      .select({
        userId: schema.users.id,
        username: schema.users.username,
        displayName: schema.users.displayName,
        avatarUrl: schema.users.avatarUrl,
        status: schema.users.status,
        userType: schema.users.userType,
        applicationId: sql<string | null>`NULL`,
        managedProvider: sql<string | null>`NULL`,
        managedMeta: sql<Record<string, unknown> | null>`NULL`,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    if (!user) return null;
    return this.mapChannelUserSummary(user);
  }

  /**
   * Get the "other user" in a direct channel, with Redis cache.
   */
  private async getDmOtherUser(
    channelId: string,
    userId: string,
  ): Promise<{
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    status: 'online' | 'offline' | 'away' | 'busy';
    userType: 'human' | 'bot' | 'system';
    agentType: AgentType | null;
  } | null> {
    return this.redis.getOrSet(
      REDIS_KEYS.CHANNEL_DM_OTHER_USER(channelId, userId),
      async () => {
        const members = await this.db
          .select({
            userId: schema.channelMembers.userId,
            username: schema.users.username,
            displayName: schema.users.displayName,
            avatarUrl: schema.users.avatarUrl,
            status: schema.users.status,
            userType: schema.users.userType,
            applicationId: schema.installedApplications.applicationId,
            managedProvider: schema.bots.managedProvider,
            managedMeta: schema.bots.managedMeta,
          })
          .from(schema.channelMembers)
          .innerJoin(
            schema.users,
            eq(schema.users.id, schema.channelMembers.userId),
          )
          .leftJoin(
            schema.bots,
            eq(schema.bots.userId, schema.channelMembers.userId),
          )
          .leftJoin(
            schema.installedApplications,
            eq(
              schema.bots.installedApplicationId,
              schema.installedApplications.id,
            ),
          )
          .where(
            and(
              eq(schema.channelMembers.channelId, channelId),
              isNull(schema.channelMembers.leftAt),
            ),
          );

        const otherUser = members.find((m) => m.userId !== userId);
        if (!otherUser) return null;

        return this.mapChannelUserSummary(otherUser);
      },
      120,
    );
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

    await this.channelMemberCacheService.invalidate(channelId);
    await this.redis.invalidate(
      REDIS_KEYS.CHANNEL_MEMBER_ROLE(channelId, userId),
    );
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

    await this.channelMemberCacheService.invalidate(channelId);
    await this.redis.invalidate(
      REDIS_KEYS.CHANNEL_MEMBER_ROLE(channelId, userId),
    );
  }

  async getMemberRole(
    channelId: string,
    userId: string,
  ): Promise<'owner' | 'admin' | 'member' | null> {
    return this.redis.getOrSet(
      REDIS_KEYS.CHANNEL_MEMBER_ROLE(channelId, userId),
      async () => {
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
      },
      120,
    );
  }

  async isMember(channelId: string, userId: string): Promise<boolean> {
    const role = await this.getMemberRole(channelId, userId);
    return role !== null;
  }

  /**
   * Assert that a user has read access to a channel.
   * - Channel members always have access.
   * - Public channels are readable by anyone.
   * - Tracking channels are readable by any tenant member.
   * Throws ForbiddenException if none of the above apply.
   */
  async assertReadAccess(channelId: string, userId: string): Promise<void> {
    const isMember = await this.isMember(channelId, userId);
    if (isMember) return;

    const channel = await this.findById(channelId);
    if (!channel) throw new ForbiddenException('Access denied');
    if (channel.type === 'public') return;
    if (
      channel.type === 'tracking' &&
      channel.tenantId &&
      (await this.isUserInTenant(userId, channel.tenantId))
    ) {
      return;
    }

    throw new ForbiddenException('Access denied');
  }

  async isBot(userId: string): Promise<boolean> {
    const [user] = await this.db
      .select({ userType: schema.users.userType })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    return user?.userType === 'bot';
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
        username: schema.users.username,
        displayName: schema.users.displayName,
        avatarUrl: schema.users.avatarUrl,
        status: schema.users.status,
        userType: schema.users.userType,
        createdAt: schema.users.createdAt,
        applicationId: schema.installedApplications.applicationId,
        managedProvider: schema.bots.managedProvider,
        managedMeta: schema.bots.managedMeta,
      })
      .from(schema.channelMembers)
      .innerJoin(
        schema.users,
        eq(schema.users.id, schema.channelMembers.userId),
      )
      .leftJoin(
        schema.bots,
        eq(schema.bots.userId, schema.channelMembers.userId),
      )
      .leftJoin(
        schema.installedApplications,
        eq(schema.bots.installedApplicationId, schema.installedApplications.id),
      )
      .where(
        and(
          eq(schema.channelMembers.channelId, channelId),
          isNull(schema.channelMembers.leftAt),
        ),
      );

    return result.map((row) => ({
      id: row.id,
      userId: row.userId,
      role: row.role,
      isMuted: row.isMuted,
      notificationsEnabled: row.notificationsEnabled,
      joinedAt: row.joinedAt,
      user: {
        ...this.mapChannelUserSummary(row),
        createdAt: row.createdAt,
      },
    }));
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

    if (dto.role) {
      await this.redis.invalidate(
        REDIS_KEYS.CHANNEL_MEMBER_ROLE(channelId, userId),
      );
    }
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
    if (channel.type === 'direct' || channel.type === 'echo') {
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

    await this.redis.invalidate(REDIS_KEYS.CHANNEL_CACHE(channelId));

    return updated;
  }

  /**
   * System helper to archive a routine creation channel.
   *
   * Unlike archiveChannel, this method:
   * - Does NOT enforce owner/admin role (system-initiated)
   * - ACCEPTS direct channels (creation channels are DMs)
   * - Is idempotent: no-op if channel missing or already archived
   */
  async archiveCreationChannel(
    channelId: string,
    tenantId?: string,
  ): Promise<void> {
    const conditions = [eq(schema.channels.id, channelId)];
    if (tenantId) {
      conditions.push(eq(schema.channels.tenantId, tenantId));
    }

    const [channel] = await this.db
      .select({
        id: schema.channels.id,
        type: schema.channels.type,
        isArchived: schema.channels.isArchived,
      })
      .from(schema.channels)
      .where(and(...conditions))
      .limit(1);

    if (!channel) {
      this.logger.debug(
        `archiveCreationChannel: channel ${channelId} not found, skipping`,
      );
      return;
    }
    if (channel.isArchived) {
      this.logger.debug(
        `archiveCreationChannel: channel ${channelId} already archived, skipping`,
      );
      return;
    }

    await this.db
      .update(schema.channels)
      .set({ isArchived: true, updatedAt: new Date() })
      .where(and(...conditions));

    await this.redis.invalidate(REDIS_KEYS.CHANNEL_CACHE(channelId));
  }

  /**
   * Deactivate a channel — sets isActivated=false, preventing further messages.
   * Used when agent execution ends to make the tracking channel read-only.
   * Also applicable to task channels when execution completes.
   * Returns a snapshot of the latest 3 messages and total message count.
   */
  async deactivateChannel(channelId: string): Promise<{
    snapshot: ChannelSnapshot;
  }> {
    const channel = await this.findById(channelId);
    if (!channel) {
      throw new NotFoundException('Channel not found');
    }
    if (channel.type !== 'tracking' && channel.type !== 'task') {
      throw new ForbiddenException(
        'Only tracking and task channels can be deactivated',
      );
    }
    if (!channel.isActivated) {
      const defaultSnapshot: ChannelSnapshot = {
        totalMessageCount: 0,
        latestMessages: [],
      };

      // Already deactivated — return existing snapshot
      return {
        snapshot: channel.snapshot ?? defaultSnapshot,
      };
    }

    // Query latest 3 messages and total count
    const [latestMessages, countResult] = await Promise.all([
      this.db
        .select({
          id: schema.messages.id,
          content: schema.messages.content,
          metadata: schema.messages.metadata,
          createdAt: schema.messages.createdAt,
        })
        .from(schema.messages)
        .where(eq(schema.messages.channelId, channelId))
        .orderBy(desc(schema.messages.createdAt))
        .limit(3),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.messages)
        .where(eq(schema.messages.channelId, channelId)),
    ]);

    const snapshot = {
      totalMessageCount: countResult[0]?.count ?? 0,
      latestMessages: latestMessages.reverse().map((m) => ({
        ...m,
        metadata: m.metadata as Record<string, unknown> | null,
      })),
    };

    await this.db
      .update(schema.channels)
      .set({
        isActivated: false,
        snapshot: snapshot,
        updatedAt: new Date(),
      })
      .where(eq(schema.channels.id, channelId));

    await this.redis.invalidate(REDIS_KEYS.CHANNEL_CACHE(channelId));

    return { snapshot };
  }

  /**
   * Activate a channel — sets isActivated=true, allowing messages again.
   * Used to reactivate a previously deactivated tracking/task channel.
   */
  async activateChannel(channelId: string): Promise<void> {
    const channel = await this.findById(channelId);
    if (!channel) {
      throw new NotFoundException('Channel not found');
    }
    if (channel.type !== 'tracking' && channel.type !== 'task') {
      throw new ForbiddenException(
        'Only tracking and task channels can be activated',
      );
    }
    if (channel.isActivated) return; // already activated

    await this.db
      .update(schema.channels)
      .set({ isActivated: true, updatedAt: new Date() })
      .where(eq(schema.channels.id, channelId));

    await this.redis.invalidate(REDIS_KEYS.CHANNEL_CACHE(channelId));
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

    await this.redis.invalidate(REDIS_KEYS.CHANNEL_CACHE(channelId));

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

    if (channel.type === 'direct' || channel.type === 'echo') {
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

    await this.redis.invalidate(REDIS_KEYS.CHANNEL_CACHE(channelId));
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
        isActivated: schema.channels.isActivated,
        snapshot: schema.channels.snapshot,
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

  /**
   * Check whether a user is a member of a given tenant.
   * Used by channel:observe to gate temporary subscriptions.
   */
  async isUserInTenant(userId: string, tenantId: string): Promise<boolean> {
    const result = await this.db
      .select({ id: schema.tenantMembers.id })
      .from(schema.tenantMembers)
      .where(
        and(
          eq(schema.tenantMembers.userId, userId),
          eq(schema.tenantMembers.tenantId, tenantId),
          isNull(schema.tenantMembers.leftAt),
        ),
      )
      .limit(1);
    return result.length > 0;
  }

  /**
   * Set the showInDmSidebar flag for the current user's membership
   * in a direct or echo channel.
   */
  async setSidebarVisibility(
    channelId: string,
    userId: string,
    show: boolean,
    tenantId?: string,
  ): Promise<void> {
    const [channel] = await this.db
      .select({ id: schema.channels.id, type: schema.channels.type })
      .from(schema.channels)
      .where(
        and(
          eq(schema.channels.id, channelId),
          tenantId ? eq(schema.channels.tenantId, tenantId) : undefined,
        ),
      )
      .limit(1);

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    if (channel.type !== 'direct' && channel.type !== 'echo') {
      throw new BadRequestException(
        'Sidebar visibility can only be changed for direct or echo channels',
      );
    }

    // Verify user is an active member of this channel
    const [member] = await this.db
      .select({ id: schema.channelMembers.id })
      .from(schema.channelMembers)
      .where(
        and(
          eq(schema.channelMembers.channelId, channelId),
          eq(schema.channelMembers.userId, userId),
          isNull(schema.channelMembers.leftAt),
        ),
      )
      .limit(1);

    if (!member) {
      throw new ForbiddenException('Not a member of this channel');
    }

    await this.db
      .update(schema.channelMembers)
      .set({ showInDmSidebar: show })
      .where(eq(schema.channelMembers.id, member.id));
  }

  /**
   * Delete all DM channels that a user participates in.
   * Used during bot cleanup to remove orphaned direct channels.
   */
  async deleteDirectChannelsForUser(userId: string): Promise<number> {
    // Find all DM channel IDs where this user is a member
    const dmChannels = await this.db
      .select({ channelId: schema.channelMembers.channelId })
      .from(schema.channelMembers)
      .innerJoin(
        schema.channels,
        eq(schema.channelMembers.channelId, schema.channels.id),
      )
      .where(
        and(
          eq(schema.channelMembers.userId, userId),
          eq(schema.channels.type, 'direct'),
        ),
      );

    if (dmChannels.length === 0) return 0;

    const channelIds = dmChannels.map((c) => c.channelId);

    // Delete channels (cascades to channel_members, messages, etc.)
    await this.db
      .delete(schema.channels)
      .where(inArray(schema.channels.id, channelIds));

    // Invalidate Redis cache for each channel
    for (const id of channelIds) {
      await this.redis.invalidate(REDIS_KEYS.CHANNEL_CACHE(id));
    }

    return channelIds.length;
  }
}
