import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Inject,
  Logger,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { v7 as uuidv7 } from 'uuid';
import {
  USER_EVENTS,
  type UserRegisteredEvent,
} from '../auth/events/user.events.js';
import { generateSlug, generateShortId } from '../common/utils/slug.util.js';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  sql,
  isNull,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import { randomBytes } from 'crypto';
import { env } from '@team9/shared';
import type { CreateInvitationDto } from './dto/index.js';
import { RedisService } from '@team9/redis';
import { WS_EVENTS } from '../im/websocket/events/events.constants.js';
import { REDIS_KEYS } from '../im/shared/constants/redis-keys.js';
import { WEBSOCKET_GATEWAY } from '../shared/constants/injection-tokens.js';
import { ChannelsService } from '../im/channels/channels.service.js';
import { BotService } from '../bot/bot.service.js';

export interface InvitationResponse {
  id: string;
  code: string;
  url: string;
  role: string;
  maxUses?: number;
  usedCount: number;
  expiresAt?: Date;
  isActive: boolean;
  createdAt: Date;
  createdBy?: {
    id: string;
    username: string;
    displayName?: string;
  };
}

export interface InvitationInfoResponse {
  workspaceName: string;
  workspaceSlug: string;
  invitedBy?: string;
  expiresAt?: Date;
  isValid: boolean;
  reason?: string;
}

export interface AcceptInvitationResponse {
  workspace: {
    id: string;
    name: string;
    slug: string;
  };
  member: {
    id: string;
    role: string;
    joinedAt: Date;
  };
}

export interface UserWorkspace {
  id: string;
  name: string;
  slug: string;
  role: string;
  joinedAt: Date;
}

export interface WorkspaceMemberResponse {
  id: string;
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: 'owner' | 'admin' | 'member' | 'guest';
  status: 'online' | 'offline' | 'away' | 'busy';
  userType: 'human' | 'bot' | 'system';
  joinedAt: Date;
  invitedBy?: string;
  lastSeenAt: Date | null;
}

export interface PaginatedMembersResponse {
  members: WorkspaceMemberResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface WorkspaceResponse {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  logoUrl: string | null;
  plan: 'free' | 'pro' | 'enterprise';
  settings: schema.TenantSettings;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class WorkspaceService {
  private readonly logger = new Logger(WorkspaceService.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    @Inject(WEBSOCKET_GATEWAY)
    private readonly websocketGateway: any,
    private readonly redisService: RedisService,
    private readonly channelsService: ChannelsService,
    private readonly botService: BotService,
  ) {}

  @OnEvent(USER_EVENTS.REGISTERED)
  async handleUserRegistered(event: UserRegisteredEvent): Promise<void> {
    const workspaceName = `${event.displayName}'s Workspace`;
    await this.create({
      name: workspaceName,
      ownerId: event.userId,
    });
    this.logger.log(
      `Created personal workspace for user ${event.userId}: ${workspaceName}`,
    );
  }

  private generateInviteCode(): string {
    return randomBytes(16).toString('hex');
  }

  async getUserWorkspaces(userId: string): Promise<UserWorkspace[]> {
    const memberships = await this.db
      .select({
        workspace: {
          id: schema.tenants.id,
          name: schema.tenants.name,
          slug: schema.tenants.slug,
        },
        role: schema.tenantMembers.role,
        joinedAt: schema.tenantMembers.joinedAt,
      })
      .from(schema.tenantMembers)
      .innerJoin(
        schema.tenants,
        eq(schema.tenantMembers.tenantId, schema.tenants.id),
      )
      .where(
        and(
          eq(schema.tenantMembers.userId, userId),
          isNull(schema.tenantMembers.leftAt),
        ),
      )
      .orderBy(schema.tenantMembers.joinedAt);

    return memberships.map((m) => ({
      id: m.workspace.id,
      name: m.workspace.name,
      slug: m.workspace.slug,
      role: m.role,
      joinedAt: m.joinedAt,
    }));
  }

  async createInvitation(
    tenantId: string,
    createdBy: string,
    dto: CreateInvitationDto,
  ): Promise<InvitationResponse> {
    const code = this.generateInviteCode();
    const expiresAt = dto.expiresInDays
      ? new Date(Date.now() + dto.expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    const [invitation] = await this.db
      .insert(schema.workspaceInvitations)
      .values({
        id: uuidv7(),
        tenantId,
        code,
        createdBy,
        role: dto.role || 'member',
        maxUses: dto.maxUses,
        expiresAt,
      })
      .returning();

    // Get creator info
    const [creator] = await this.db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        displayName: schema.users.displayName,
      })
      .from(schema.users)
      .where(eq(schema.users.id, createdBy))
      .limit(1);

    const baseUrl = env.APP_URL;
    const url = `${baseUrl}/invite/${code}`;

    return {
      id: invitation.id,
      code: invitation.code,
      url,
      role: invitation.role,
      maxUses: invitation.maxUses ?? undefined,
      usedCount: invitation.usedCount,
      expiresAt: invitation.expiresAt ?? undefined,
      isActive: invitation.isActive,
      createdAt: invitation.createdAt,
      createdBy: creator
        ? {
            id: creator.id,
            username: creator.username,
            displayName: creator.displayName ?? undefined,
          }
        : undefined,
    };
  }

  async getInvitations(tenantId: string): Promise<InvitationResponse[]> {
    const invitations = await this.db
      .select({
        invitation: schema.workspaceInvitations,
        creator: {
          id: schema.users.id,
          username: schema.users.username,
          displayName: schema.users.displayName,
        },
      })
      .from(schema.workspaceInvitations)
      .leftJoin(
        schema.users,
        eq(schema.workspaceInvitations.createdBy, schema.users.id),
      )
      .where(eq(schema.workspaceInvitations.tenantId, tenantId))
      .orderBy(sql`${schema.workspaceInvitations.createdAt} DESC`);

    const baseUrl = env.APP_URL;

    return invitations.map(({ invitation, creator }) => ({
      id: invitation.id,
      code: invitation.code,
      url: `${baseUrl}/invite/${invitation.code}`,
      role: invitation.role,
      maxUses: invitation.maxUses ?? undefined,
      usedCount: invitation.usedCount,
      expiresAt: invitation.expiresAt ?? undefined,
      isActive: invitation.isActive,
      createdAt: invitation.createdAt,
      createdBy: creator
        ? {
            id: creator.id,
            username: creator.username,
            displayName: creator.displayName ?? undefined,
          }
        : undefined,
    }));
  }

  async revokeInvitation(tenantId: string, code: string): Promise<void> {
    const result = await this.db
      .update(schema.workspaceInvitations)
      .set({ isActive: false, updatedAt: new Date() })
      .where(
        and(
          eq(schema.workspaceInvitations.tenantId, tenantId),
          eq(schema.workspaceInvitations.code, code),
        ),
      )
      .returning();

    if (result.length === 0) {
      throw new NotFoundException('Invitation not found');
    }
  }

  async getInvitationInfo(code: string): Promise<InvitationInfoResponse> {
    const [result] = await this.db
      .select({
        invitation: schema.workspaceInvitations,
        workspace: {
          name: schema.tenants.name,
          slug: schema.tenants.slug,
        },
        creator: {
          username: schema.users.username,
          displayName: schema.users.displayName,
        },
      })
      .from(schema.workspaceInvitations)
      .innerJoin(
        schema.tenants,
        eq(schema.workspaceInvitations.tenantId, schema.tenants.id),
      )
      .leftJoin(
        schema.users,
        eq(schema.workspaceInvitations.createdBy, schema.users.id),
      )
      .where(eq(schema.workspaceInvitations.code, code))
      .limit(1);

    if (!result) {
      return {
        workspaceName: '',
        workspaceSlug: '',
        isValid: false,
        reason: 'Invitation not found',
      };
    }

    const { invitation, workspace, creator } = result;

    // Check if invitation is valid
    if (!invitation.isActive) {
      return {
        workspaceName: workspace.name,
        workspaceSlug: workspace.slug,
        isValid: false,
        reason: 'Invitation has been revoked',
      };
    }

    if (invitation.expiresAt && new Date(invitation.expiresAt) < new Date()) {
      return {
        workspaceName: workspace.name,
        workspaceSlug: workspace.slug,
        expiresAt: invitation.expiresAt ?? undefined,
        isValid: false,
        reason: 'Invitation has expired',
      };
    }

    if (invitation.maxUses && invitation.usedCount >= invitation.maxUses) {
      return {
        workspaceName: workspace.name,
        workspaceSlug: workspace.slug,
        isValid: false,
        reason: 'Invitation has reached maximum uses',
      };
    }

    return {
      workspaceName: workspace.name,
      workspaceSlug: workspace.slug,
      invitedBy: creator
        ? (creator.displayName ?? creator.username)
        : undefined,
      expiresAt: invitation.expiresAt ?? undefined,
      isValid: true,
    };
  }

  async acceptInvitation(
    code: string,
    userId: string,
  ): Promise<AcceptInvitationResponse> {
    // Get invitation
    const [invitation] = await this.db
      .select()
      .from(schema.workspaceInvitations)
      .where(eq(schema.workspaceInvitations.code, code))
      .limit(1);

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    // Validate invitation
    if (!invitation.isActive) {
      throw new BadRequestException('Invitation has been revoked');
    }

    if (invitation.expiresAt && new Date(invitation.expiresAt) < new Date()) {
      throw new BadRequestException('Invitation has expired');
    }

    if (invitation.maxUses && invitation.usedCount >= invitation.maxUses) {
      throw new BadRequestException('Invitation has reached maximum uses');
    }

    // Check if user is already a member
    const [existingMember] = await this.db
      .select()
      .from(schema.tenantMembers)
      .where(
        and(
          eq(schema.tenantMembers.tenantId, invitation.tenantId),
          eq(schema.tenantMembers.userId, userId),
          isNull(schema.tenantMembers.leftAt),
        ),
      )
      .limit(1);

    if (existingMember) {
      throw new BadRequestException(
        'You are already a member of this workspace',
      );
    }

    // Add user to workspace
    const [member] = await this.db
      .insert(schema.tenantMembers)
      .values({
        id: uuidv7(),
        tenantId: invitation.tenantId,
        userId,
        role: invitation.role,
        invitedBy: invitation.createdBy,
      })
      .returning();

    // Record usage
    await this.db.insert(schema.invitationUsage).values({
      id: uuidv7(),
      invitationId: invitation.id,
      userId,
    });

    // Update usage count
    await this.db
      .update(schema.workspaceInvitations)
      .set({
        usedCount: sql`${schema.workspaceInvitations.usedCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(schema.workspaceInvitations.id, invitation.id));

    // Get workspace info
    const [workspace] = await this.db
      .select()
      .from(schema.tenants)
      .where(eq(schema.tenants.id, invitation.tenantId))
      .limit(1);

    // Get user info for broadcasting
    const [user] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    // Broadcast new member joined event to workspace
    const memberJoinedPayload = {
      workspaceId: invitation.tenantId,
      member: {
        id: member.id,
        userId: user.id,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        role: member.role,
        status: user.status,
        joinedAt: member.joinedAt,
      },
    };

    // Get online and offline member IDs for hybrid push strategy
    const { onlineIds, offlineIds } = await this.getOnlineOfflineMemberIds(
      invitation.tenantId,
    );

    // 1. Send to online users via WebSocket (low latency)
    if (onlineIds.length > 0) {
      try {
        await this.websocketGateway.broadcastToWorkspace(
          invitation.tenantId,
          WS_EVENTS.WORKSPACE.MEMBER_JOINED,
          memberJoinedPayload,
        );
        this.logger.log(
          `Sent WORKSPACE_MEMBER_JOINED to ${onlineIds.length} online users via WebSocket`,
        );
      } catch (error) {
        this.logger.warn(`Failed to broadcast via WebSocket: ${error.message}`);
      }
    }

    // Note: Offline users will see member joined via notification system
    // RabbitMQ offline queues removed - using SeqId-based incremental sync for messages
    if (offlineIds.length > 0) {
      this.logger.debug(
        `${offlineIds.length} offline users will receive WORKSPACE_MEMBER_JOINED via notification system`,
      );
    }

    // Create direct channel between inviter and invitee if invitation has a creator
    if (invitation.createdBy) {
      try {
        const directChannel = await this.channelsService.createDirectChannel(
          invitation.createdBy,
          userId,
          invitation.tenantId,
        );

        // Check online status for both users
        const onlineUsersHash = await this.redisService.hgetall(
          REDIS_KEYS.ONLINE_USERS,
        );
        const inviterOnline = invitation.createdBy in onlineUsersHash;
        const inviteeOnline = userId in onlineUsersHash;

        // Notify inviter via WebSocket if online
        // Note: Offline users will see new channel when they open channels list
        if (inviterOnline) {
          await this.websocketGateway.sendToUser(
            invitation.createdBy,
            WS_EVENTS.CHANNEL.CREATED,
            directChannel,
          );
          this.logger.log(
            `Sent CHANNEL_CREATED to online inviter ${invitation.createdBy} via WebSocket`,
          );
        }

        // Notify invitee via WebSocket if online
        if (inviteeOnline) {
          await this.websocketGateway.sendToUser(
            userId,
            WS_EVENTS.CHANNEL.CREATED,
            directChannel,
          );
          this.logger.log(
            `Sent CHANNEL_CREATED to online invitee ${userId} via WebSocket`,
          );
        }

        this.logger.log(
          `Created direct channel between inviter ${invitation.createdBy} and invitee ${userId}`,
        );
      } catch (error) {
        // Don't fail the invitation if direct channel creation fails
        this.logger.warn(
          `Failed to create direct channel between inviter and invitee: ${error.message}`,
        );
      }
    }

    // Add user to welcome channel and send system message
    try {
      const welcomeChannel = await this.channelsService.findByNameAndTenant(
        'welcome',
        invitation.tenantId,
      );

      if (welcomeChannel) {
        // Add user to welcome channel
        await this.channelsService.addMember(welcomeChannel.id, userId);

        // Send system message
        const displayName = user.displayName || user.username;
        await this.channelsService.sendSystemMessage(
          welcomeChannel.id,
          `${displayName} joined ${workspace.name}`,
        );

        this.logger.log(
          `Added user ${userId} to welcome channel and sent join message`,
        );
      }
    } catch (error) {
      // Don't fail the invitation if welcome channel operations fail
      this.logger.warn(
        `Failed to add user to welcome channel: ${error.message}`,
      );
    }

    return {
      workspace: {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
      },
      member: {
        id: member.id,
        role: member.role,
        joinedAt: member.joinedAt,
      },
    };
  }

  async getWorkspaceMembers(
    tenantId: string,
    requesterId: string,
    options?: { page?: number; limit?: number; search?: string },
  ): Promise<PaginatedMembersResponse> {
    const page = options?.page ?? 1;
    const limit = options?.limit ?? 20;
    const search = options?.search?.trim();

    // Verify requester is a member
    const isMember = await this.isWorkspaceMember(tenantId, requesterId);
    if (!isMember) {
      throw new BadRequestException('Not a member of this workspace');
    }

    // Build where conditions
    const whereConditions = [
      eq(schema.tenantMembers.tenantId, tenantId),
      isNull(schema.tenantMembers.leftAt),
    ];

    // Add search condition if provided
    if (search) {
      whereConditions.push(
        sql`(${schema.users.username} ILIKE ${`%${search}%`} OR ${schema.users.displayName} ILIKE ${`%${search}%`})`,
      );
    }

    // Get total count
    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.tenantMembers)
      .innerJoin(schema.users, eq(schema.tenantMembers.userId, schema.users.id))
      .where(and(...whereConditions));

    const total = Number(count);
    const totalPages = Math.ceil(total / limit);
    const offset = (page - 1) * limit;

    // Get paginated members
    const members = await this.db
      .select({
        id: schema.tenantMembers.id,
        userId: schema.tenantMembers.userId,
        username: schema.users.username,
        displayName: schema.users.displayName,
        avatarUrl: schema.users.avatarUrl,
        role: schema.tenantMembers.role,
        userType: schema.users.userType,
        joinedAt: schema.tenantMembers.joinedAt,
        invitedBy: schema.tenantMembers.invitedBy,
        lastSeenAt: schema.users.lastSeenAt,
      })
      .from(schema.tenantMembers)
      .innerJoin(schema.users, eq(schema.tenantMembers.userId, schema.users.id))
      .where(and(...whereConditions))
      .orderBy(schema.tenantMembers.joinedAt)
      .limit(limit)
      .offset(offset);

    // Get real-time online status from Redis (single source of truth)
    const onlineUsersHash = await this.redisService.hgetall(
      REDIS_KEYS.ONLINE_USERS,
    );

    return {
      members: members.map((m) => ({
        ...m,
        // Status is ONLY from Redis, defaults to 'offline' if not found
        status:
          (onlineUsersHash[m.userId] as
            | 'online'
            | 'offline'
            | 'away'
            | 'busy') || 'offline',
        userType: m.userType,
        invitedBy: m.invitedBy ?? undefined,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }

  async isWorkspaceMember(tenantId: string, userId: string): Promise<boolean> {
    const [member] = await this.db
      .select()
      .from(schema.tenantMembers)
      .where(
        and(
          eq(schema.tenantMembers.tenantId, tenantId),
          eq(schema.tenantMembers.userId, userId),
          isNull(schema.tenantMembers.leftAt),
        ),
      )
      .limit(1);

    return !!member;
  }

  async getWorkspaceIdsByUserId(userId: string): Promise<string[]> {
    const memberships = await this.db
      .select({ tenantId: schema.tenantMembers.tenantId })
      .from(schema.tenantMembers)
      .where(
        and(
          eq(schema.tenantMembers.userId, userId),
          isNull(schema.tenantMembers.leftAt),
        ),
      );

    return memberships.map((m) => m.tenantId);
  }

  /**
   * Get online and offline member IDs for a workspace
   * Used to implement hybrid push strategy (WebSocket + RabbitMQ)
   */
  async getOnlineOfflineMemberIds(tenantId: string): Promise<{
    onlineIds: string[];
    offlineIds: string[];
  }> {
    // Get all workspace members
    const members = await this.db
      .select({ userId: schema.tenantMembers.userId })
      .from(schema.tenantMembers)
      .where(
        and(
          eq(schema.tenantMembers.tenantId, tenantId),
          isNull(schema.tenantMembers.leftAt),
        ),
      );

    const allMemberIds = members.map((m) => m.userId);

    // Get online users from Redis
    const onlineUsersHash = await this.redisService.hgetall(
      REDIS_KEYS.ONLINE_USERS,
    );
    const onlineSet = new Set(Object.keys(onlineUsersHash));

    // Debug logging
    this.logger.debug(
      `[Online Status Debug] Workspace ${tenantId}:
      - Total members: ${allMemberIds.length} (${allMemberIds.join(', ')})
      - Redis key: ${REDIS_KEYS.ONLINE_USERS}
      - Online users in Redis: ${Object.keys(onlineUsersHash).length} (${Object.keys(onlineUsersHash).join(', ')})
      - Redis hash data: ${JSON.stringify(onlineUsersHash)}`,
    );

    // Distinguish between online and offline
    const onlineIds = allMemberIds.filter((id) => onlineSet.has(id));
    const offlineIds = allMemberIds.filter((id) => !onlineSet.has(id));

    this.logger.debug(
      `[Online Status Debug] Results:
      - Online: ${onlineIds.length} (${onlineIds.join(', ')})
      - Offline: ${offlineIds.length} (${offlineIds.join(', ')})`,
    );

    return { onlineIds, offlineIds };
  }

  // ===== Workspace CRUD =====

  async create(data: {
    name: string;
    slug?: string; // Internal use only, not exposed via API
    domain?: string;
    ownerId: string;
  }): Promise<WorkspaceResponse> {
    // Generate slug from name if not provided
    const slug = data.slug || (await this.generateUniqueSlug(data.name));

    // Check if provided slug already exists
    if (data.slug) {
      const existingSlug = await this.findBySlug(slug);
      if (existingSlug) {
        throw new ConflictException('Workspace slug already exists');
      }
    }

    // Check if domain already exists
    if (data.domain) {
      const existingDomain = await this.findByDomain(data.domain);
      if (existingDomain) {
        throw new ConflictException('Domain already in use');
      }
    }

    const [workspace] = await this.db
      .insert(schema.tenants)
      .values({
        id: uuidv7(),
        name: data.name,
        slug,
        domain: data.domain,
        plan: 'free',
      })
      .returning();

    // Add owner as member
    await this.addMember(workspace.id, data.ownerId, 'owner');

    // Create default welcome channel
    await this.channelsService.create(
      {
        name: 'welcome',
        description: 'Welcome to the workspace! Say hello to your teammates.',
        type: 'public',
      },
      data.ownerId,
      workspace.id,
    );

    // Add system bot to workspace if enabled
    const botUserId = this.botService.getBotUserId();
    if (botUserId && botUserId !== data.ownerId) {
      try {
        await this.addMember(workspace.id, botUserId, 'member', data.ownerId);
        this.logger.log(`Added system bot to workspace: ${workspace.name}`);

        // Create direct channel between owner and bot
        await this.channelsService.createDirectChannel(
          data.ownerId,
          botUserId,
          workspace.id,
        );
        this.logger.log(
          `Created direct channel between owner and bot in workspace: ${workspace.name}`,
        );
      } catch (error) {
        this.logger.warn(`Failed to add system bot to workspace: ${error}`);
      }
    }

    this.logger.log(`Created workspace: ${workspace.name} (${workspace.slug})`);

    return workspace as WorkspaceResponse;
  }

  /**
   * Generate a unique slug from the given base string.
   * Handles collisions by appending random suffixes.
   */
  async generateUniqueSlug(baseName: string): Promise<string> {
    const slug = generateSlug(baseName);
    const MAX_ATTEMPTS = 10;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const uniqueSlug = attempt === 0 ? slug : `${slug}-${generateShortId()}`;

      const existing = await this.findBySlug(uniqueSlug);
      if (!existing) {
        return uniqueSlug;
      }
    }

    // Fallback: use UUID suffix to guarantee uniqueness
    return `${slug}-${uuidv7().substring(0, 8)}`;
  }

  async findById(id: string): Promise<WorkspaceResponse | null> {
    const [workspace] = await this.db
      .select()
      .from(schema.tenants)
      .where(eq(schema.tenants.id, id))
      .limit(1);

    return (workspace as WorkspaceResponse) || null;
  }

  async findByIdOrThrow(id: string): Promise<WorkspaceResponse> {
    const workspace = await this.findById(id);
    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }
    return workspace;
  }

  async findBySlug(slug: string): Promise<WorkspaceResponse | null> {
    const [workspace] = await this.db
      .select()
      .from(schema.tenants)
      .where(eq(schema.tenants.slug, slug))
      .limit(1);

    return (workspace as WorkspaceResponse) || null;
  }

  async findByDomain(domain: string): Promise<WorkspaceResponse | null> {
    const [workspace] = await this.db
      .select()
      .from(schema.tenants)
      .where(eq(schema.tenants.domain, domain))
      .limit(1);

    return (workspace as WorkspaceResponse) || null;
  }

  async update(
    id: string,
    data: Partial<{
      name: string;
      slug: string;
      domain: string;
      logoUrl: string;
      plan: 'free' | 'pro' | 'enterprise';
      settings: schema.TenantSettings;
      isActive: boolean;
    }>,
  ): Promise<WorkspaceResponse> {
    const [workspace] = await this.db
      .update(schema.tenants)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(schema.tenants.id, id))
      .returning();

    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    return workspace as WorkspaceResponse;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(schema.tenants).where(eq(schema.tenants.id, id));
  }

  // ===== Member Management =====

  async addMember(
    workspaceId: string,
    userId: string,
    role: 'owner' | 'admin' | 'member' | 'guest' = 'member',
    invitedBy?: string,
  ): Promise<void> {
    // Check if already a member
    const existing = await this.getMember(workspaceId, userId);
    if (existing) {
      throw new ConflictException('User is already a member of this workspace');
    }

    await this.db.insert(schema.tenantMembers).values({
      id: uuidv7(),
      tenantId: workspaceId,
      userId,
      role,
      invitedBy,
    });

    this.logger.log(
      `Added user ${userId} to workspace ${workspaceId} as ${role}`,
    );
  }

  async removeMember(workspaceId: string, userId: string): Promise<void> {
    // Mark as left rather than hard delete
    await this.db
      .update(schema.tenantMembers)
      .set({ leftAt: new Date() })
      .where(
        and(
          eq(schema.tenantMembers.tenantId, workspaceId),
          eq(schema.tenantMembers.userId, userId),
          isNull(schema.tenantMembers.leftAt),
        ),
      );
  }

  async getMember(
    workspaceId: string,
    userId: string,
  ): Promise<{ id: string; role: string; joinedAt: Date } | null> {
    const [member] = await this.db
      .select()
      .from(schema.tenantMembers)
      .where(
        and(
          eq(schema.tenantMembers.tenantId, workspaceId),
          eq(schema.tenantMembers.userId, userId),
          isNull(schema.tenantMembers.leftAt),
        ),
      )
      .limit(1);

    return member
      ? { id: member.id, role: member.role, joinedAt: member.joinedAt }
      : null;
  }

  async getMemberRole(
    workspaceId: string,
    userId: string,
  ): Promise<'owner' | 'admin' | 'member' | 'guest' | null> {
    const member = await this.getMember(workspaceId, userId);
    return (member?.role as 'owner' | 'admin' | 'member' | 'guest') || null;
  }

  async updateMemberRole(
    workspaceId: string,
    userId: string,
    role: 'owner' | 'admin' | 'member' | 'guest',
  ): Promise<void> {
    await this.db
      .update(schema.tenantMembers)
      .set({ role })
      .where(
        and(
          eq(schema.tenantMembers.tenantId, workspaceId),
          eq(schema.tenantMembers.userId, userId),
          isNull(schema.tenantMembers.leftAt),
        ),
      );
  }

  // ===== Default Workspace =====

  async getOrCreateDefaultWorkspace(
    ownerId: string,
  ): Promise<WorkspaceResponse> {
    const defaultSlug = 'default';
    let workspace = await this.findBySlug(defaultSlug);

    if (!workspace) {
      workspace = await this.create({
        name: 'Default Workspace',
        slug: defaultSlug,
        ownerId,
      });
    } else {
      // Ensure user is a member
      const isMember = await this.isWorkspaceMember(workspace.id, ownerId);
      if (!isMember) {
        await this.addMember(workspace.id, ownerId, 'member');
      }
    }

    return workspace;
  }
}
