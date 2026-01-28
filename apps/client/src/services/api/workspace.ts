import http from "../http";
import type {
  UserWorkspace,
  WorkspaceInvitation,
  CreateInvitationDto,
  CreateWorkspaceDto,
  WorkspaceResponse,
  InvitationInfo,
  AcceptInvitationResponse,
  GetMembersParams,
  PaginatedMembersResponse,
} from "@/types/workspace";

export const workspaceApi = {
  // Create a new workspace
  createWorkspace: async (
    data: CreateWorkspaceDto,
  ): Promise<WorkspaceResponse> => {
    const response = await http.post<WorkspaceResponse>("/v1/workspaces", data);
    return response.data;
  },

  // Get user's workspaces
  getUserWorkspaces: async (): Promise<UserWorkspace[]> => {
    const response = await http.get<UserWorkspace[]>("/v1/workspaces");
    return response.data;
  },

  // Get workspace members (paginated)
  getMembers: async (
    workspaceId: string,
    params?: GetMembersParams,
  ): Promise<PaginatedMembersResponse> => {
    const response = await http.get<PaginatedMembersResponse>(
      `/v1/workspaces/${workspaceId}/members`,
      { params },
    );
    return response.data;
  },

  // Create invitation link
  createInvitation: async (
    workspaceId: string,
    data: CreateInvitationDto,
  ): Promise<WorkspaceInvitation> => {
    const response = await http.post<WorkspaceInvitation>(
      `/v1/workspaces/${workspaceId}/invitations`,
      data,
    );
    return response.data;
  },

  // Get all invitations for a workspace
  getInvitations: async (
    workspaceId: string,
  ): Promise<WorkspaceInvitation[]> => {
    const response = await http.get<WorkspaceInvitation[]>(
      `/v1/workspaces/${workspaceId}/invitations`,
    );
    return response.data;
  },

  // Revoke an invitation
  revokeInvitation: async (
    workspaceId: string,
    code: string,
  ): Promise<void> => {
    await http.delete(`/v1/workspaces/${workspaceId}/invitations/${code}`);
  },

  // Get invitation info (public, no auth required)
  getInvitationInfo: async (code: string): Promise<InvitationInfo> => {
    const response = await http.get<InvitationInfo>(
      `/v1/invitations/${code}/info`,
    );
    return response.data;
  },

  // Accept an invitation (requires auth)
  acceptInvitation: async (code: string): Promise<AcceptInvitationResponse> => {
    const response = await http.post<AcceptInvitationResponse>(
      `/v1/invitations/${code}/accept`,
    );
    return response.data;
  },

  // Update member role
  updateMemberRole: async (
    workspaceId: string,
    userId: string,
    role: "admin" | "member" | "guest",
  ): Promise<{ success: boolean }> => {
    const response = await http.patch<{ success: boolean }>(
      `/v1/workspaces/${workspaceId}/members/${userId}/role`,
      { role },
    );
    return response.data;
  },

  // Remove member from workspace
  removeMember: async (
    workspaceId: string,
    userId: string,
  ): Promise<{ success: boolean }> => {
    const response = await http.delete<{ success: boolean }>(
      `/v1/workspaces/${workspaceId}/members/${userId}`,
    );
    return response.data;
  },
};

export default workspaceApi;
