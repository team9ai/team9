import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
  Logger,
  Optional,
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
import { randomBytes } from 'crypto';
import { env } from '@team9/shared';
import type { CreateInvitationDto } from './dto/index.js';
import { RedisService } from '@team9/redis';
import { WS_EVENTS } from '../im/websocket/events/events.constants.js';
import { REDIS_KEYS } from '../im/shared/constants/redis-keys.js';
import { WEBSOCKET_GATEWAY } from '../shared/constants/injection-tokens.js';

// Import RabbitMQ types (will be optional)
type RabbitMQEventService = any;

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
  joinedAt: Date;
  invitedBy?: string;
  lastSeenAt: Date | null;
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
    @Optional() private readonly rabbitMQEventService?: RabbitMQEventService,
  ) {}

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
        tenantId: invitation.tenantId,
        userId,
        role: invitation.role,
        invitedBy: invitation.createdBy,
      })
      .returning();

    // Record usage
    await this.db.insert(schema.invitationUsage).values({
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
          WS_EVENTS.WORKSPACE_MEMBER_JOINED,
          memberJoinedPayload,
        );
        this.logger.log(
          `Sent WORKSPACE_MEMBER_JOINED to ${onlineIds.length} online users via WebSocket`,
        );
      } catch (error) {
        this.logger.warn(`Failed to broadcast via WebSocket: ${error.message}`);
      }
    }

    // 2. Queue for offline users via RabbitMQ (reliability)
    if (offlineIds.length > 0 && this.rabbitMQEventService) {
      try {
        await this.rabbitMQEventService.sendToOfflineUsers(
          invitation.tenantId,
          offlineIds,
          WS_EVENTS.WORKSPACE_MEMBER_JOINED,
          memberJoinedPayload,
        );
        this.logger.log(
          `Queued WORKSPACE_MEMBER_JOINED to ${offlineIds.length} offline users via RabbitMQ`,
        );
      } catch (error) {
        this.logger.warn(
          `Failed to queue message via RabbitMQ: ${error.message}`,
        );
        // Don't fail the request if RabbitMQ fails
      }
    } else if (offlineIds.length > 0) {
      this.logger.debug(
        `${offlineIds.length} offline users will miss WORKSPACE_MEMBER_JOINED event (RabbitMQ disabled)`,
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
  ): Promise<WorkspaceMemberResponse[]> {
    // Verify requester is a member
    const isMember = await this.isWorkspaceMember(tenantId, requesterId);
    if (!isMember) {
      throw new BadRequestException('Not a member of this workspace');
    }

    const members = await this.db
      .select({
        id: schema.tenantMembers.id,
        userId: schema.tenantMembers.userId,
        username: schema.users.username,
        displayName: schema.users.displayName,
        avatarUrl: schema.users.avatarUrl,
        role: schema.tenantMembers.role,
        joinedAt: schema.tenantMembers.joinedAt,
        invitedBy: schema.tenantMembers.invitedBy,
        lastSeenAt: schema.users.lastSeenAt,
      })
      .from(schema.tenantMembers)
      .innerJoin(schema.users, eq(schema.tenantMembers.userId, schema.users.id))
      .where(
        and(
          eq(schema.tenantMembers.tenantId, tenantId),
          isNull(schema.tenantMembers.leftAt),
        ),
      )
      .orderBy(schema.tenantMembers.joinedAt);

    // Get real-time online status from Redis (single source of truth)
    const onlineUsersHash = await this.redisService.hgetall(
      REDIS_KEYS.ONLINE_USERS,
    );

    return members.map((m) => ({
      ...m,
      // Status is ONLY from Redis, defaults to 'offline' if not found
      status:
        (onlineUsersHash[m.userId] as 'online' | 'offline' | 'away' | 'busy') ||
        'offline',
      invitedBy: m.invitedBy ?? undefined,
    }));
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
}
