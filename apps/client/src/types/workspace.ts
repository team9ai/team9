// Workspace invitation types

export interface UserWorkspace {
  id: string;
  name: string;
  slug: string;
  role: "owner" | "admin" | "member" | "guest";
  joinedAt: string;
}

export interface WorkspaceInvitation {
  id: string;
  code: string;
  url: string;
  role: "owner" | "admin" | "member" | "guest";
  maxUses?: number;
  usedCount: number;
  expiresAt?: string;
  isActive: boolean;
  createdAt: string;
  createdBy?: {
    id: string;
    username: string;
    displayName?: string;
  };
}

export interface CreateInvitationDto {
  role?: "owner" | "admin" | "member" | "guest";
  maxUses?: number;
  expiresInDays?: number;
}

export interface InvitationInfo {
  workspaceName: string;
  workspaceSlug: string;
  invitedBy?: string;
  expiresAt?: string;
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
    joinedAt: string;
  };
}
