import http from "../http";
import type {
  UserWorkspace,
  WorkspaceInvitation,
  CreateInvitationDto,
  InvitationInfo,
  AcceptInvitationResponse,
} from "@/types/workspace";

export const workspaceApi = {
  // Get user's workspaces
  getUserWorkspaces: async (): Promise<UserWorkspace[]> => {
    const response = await http.get<UserWorkspace[]>("/v1/workspaces");
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
};

export default workspaceApi;
