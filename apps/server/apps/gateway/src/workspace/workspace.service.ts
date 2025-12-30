import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DatabaseService } from '@team9/database';
import * as schema from '@team9/database/schemas';
import { eq, and, sql, isNull } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import type { CreateInvitationDto } from './dto';

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

@Injectable()
export class WorkspaceService {
  constructor(private readonly db: DatabaseService) {}

  private generateInviteCode(): string {
    return randomBytes(16).toString('hex');
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

    const [invitation] = await this.db.db
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
    const [creator] = await this.db.db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        displayName: schema.users.displayName,
      })
      .from(schema.users)
      .where(eq(schema.users.id, createdBy))
      .limit(1);

    const baseUrl = process.env.APP_URL || 'http://localhost:5173';
    const url = `${baseUrl}/invite/${code}`;

    return {
      id: invitation.id,
      code: invitation.code,
      url,
      role: invitation.role,
      maxUses: invitation.maxUses,
      usedCount: invitation.usedCount,
      expiresAt: invitation.expiresAt,
      isActive: invitation.isActive,
      createdAt: invitation.createdAt,
      createdBy: creator
        ? {
            id: creator.id,
            username: creator.username,
            displayName: creator.displayName,
          }
        : undefined,
    };
  }

  async getInvitations(tenantId: string): Promise<InvitationResponse[]> {
    const invitations = await this.db.db
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

    const baseUrl = process.env.APP_URL || 'http://localhost:5173';

    return invitations.map(({ invitation, creator }) => ({
      id: invitation.id,
      code: invitation.code,
      url: `${baseUrl}/invite/${invitation.code}`,
      role: invitation.role,
      maxUses: invitation.maxUses,
      usedCount: invitation.usedCount,
      expiresAt: invitation.expiresAt,
      isActive: invitation.isActive,
      createdAt: invitation.createdAt,
      createdBy: creator
        ? {
            id: creator.id,
            username: creator.username,
            displayName: creator.displayName,
          }
        : undefined,
    }));
  }

  async revokeInvitation(tenantId: string, code: string): Promise<void> {
    const result = await this.db.db
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
    const [result] = await this.db.db
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
        expiresAt: invitation.expiresAt,
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
      invitedBy: creator ? creator.displayName || creator.username : undefined,
      expiresAt: invitation.expiresAt,
      isValid: true,
    };
  }

  async acceptInvitation(
    code: string,
    userId: string,
  ): Promise<AcceptInvitationResponse> {
    // Get invitation
    const [invitation] = await this.db.db
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
    const [existingMember] = await this.db.db
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
    const [member] = await this.db.db
      .insert(schema.tenantMembers)
      .values({
        tenantId: invitation.tenantId,
        userId,
        role: invitation.role,
        invitedBy: invitation.createdBy,
      })
      .returning();

    // Record usage
    await this.db.db.insert(schema.invitationUsage).values({
      invitationId: invitation.id,
      userId,
    });

    // Update usage count
    await this.db.db
      .update(schema.workspaceInvitations)
      .set({
        usedCount: sql`${schema.workspaceInvitations.usedCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(schema.workspaceInvitations.id, invitation.id));

    // Get workspace info
    const [workspace] = await this.db.db
      .select()
      .from(schema.tenants)
      .where(eq(schema.tenants.id, invitation.tenantId))
      .limit(1);

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
}
