import http from "../http";
import type {
  UserWorkspace,
  WorkspaceInvitation,
  CreateInvitationDto,
  CreateWorkspaceDto,
  UpdateWorkspaceDto,
  WorkspaceResponse,
  InvitationInfo,
  AcceptInvitationResponse,
  GetMembersParams,
  PaginatedMembersResponse,
  BillingProduct,
  WorkspaceBillingOverview,
  WorkspaceBillingSummary,
  OnboardingRoleCatalogItem,
  OnboardingRoleSelection,
  OnboardingTasksSelection,
  WorkspaceOnboarding,
  WorkspaceOnboardingStepData,
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

  // Get a workspace by id
  getWorkspace: async (workspaceId: string): Promise<WorkspaceResponse> => {
    const response = await http.get<WorkspaceResponse>(
      `/v1/workspaces/${workspaceId}`,
    );
    return response.data;
  },

  // Update workspace settings
  updateWorkspace: async (
    workspaceId: string,
    data: UpdateWorkspaceDto,
  ): Promise<WorkspaceResponse> => {
    const response = await http.patch<WorkspaceResponse>(
      `/v1/workspaces/${workspaceId}`,
      data,
    );
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

  getBillingProducts: async (
    workspaceId: string,
  ): Promise<BillingProduct[]> => {
    const response = await http.get<BillingProduct[]>(
      `/v1/workspaces/${workspaceId}/billing/products`,
    );
    return response.data;
  },

  getBillingSubscription: async (
    workspaceId: string,
  ): Promise<WorkspaceBillingSummary> => {
    const response = await http.get<WorkspaceBillingSummary>(
      `/v1/workspaces/${workspaceId}/billing/subscription`,
    );
    return response.data;
  },

  getBillingOverview: async (
    workspaceId: string,
  ): Promise<WorkspaceBillingOverview> => {
    const response = await http.get<WorkspaceBillingOverview>(
      `/v1/workspaces/${workspaceId}/billing/overview`,
    );
    return response.data;
  },

  createBillingCheckout: async (
    workspaceId: string,
    priceId: string,
    type: "subscription" | "one_time" = "subscription",
    view: "plans" | "credits" = "plans",
    amountCents?: number,
    successPath?: string,
    cancelPath?: string,
  ): Promise<{ checkoutUrl: string; sessionId: string }> => {
    const response = await http.post<{
      checkoutUrl: string;
      sessionId: string;
    }>(`/v1/workspaces/${workspaceId}/billing/checkout`, {
      priceId,
      type,
      view,
      ...(amountCents !== undefined ? { amountCents } : {}),
      ...(successPath ? { successPath } : {}),
      ...(cancelPath ? { cancelPath } : {}),
    });
    return response.data;
  },

  createBillingPortal: async (
    workspaceId: string,
    view: "plans" | "credits" = "plans",
    returnPath?: string,
  ): Promise<{ portalUrl: string }> => {
    const response = await http.post<{ portalUrl: string }>(
      `/v1/workspaces/${workspaceId}/billing/portal`,
      {
        view,
        ...(returnPath ? { returnPath } : {}),
      },
    );
    return response.data;
  },

  getOnboardingRoles: async (
    lang?: string,
  ): Promise<OnboardingRoleCatalogItem[]> => {
    const response = await http.get<OnboardingRoleCatalogItem[]>(
      "/v1/onboarding/roles",
      { params: lang ? { lang } : undefined },
    );
    return response.data;
  },

  getOnboardingState: async (
    workspaceId: string,
  ): Promise<WorkspaceOnboarding | null> => {
    const response = await http.get<WorkspaceOnboarding | null>(
      `/v1/workspaces/${workspaceId}/onboarding`,
    );
    return response.data;
  },

  updateOnboardingState: async (
    workspaceId: string,
    data: {
      currentStep?: number;
      status?: "in_progress" | "completed";
      stepData?: WorkspaceOnboardingStepData;
    },
  ): Promise<WorkspaceOnboarding> => {
    const response = await http.patch<WorkspaceOnboarding>(
      `/v1/workspaces/${workspaceId}/onboarding`,
      data,
    );
    return response.data;
  },

  generateOnboardingTasks: async (
    workspaceId: string,
    data: {
      role: OnboardingRoleSelection;
      tasks?: OnboardingTasksSelection;
      lang?: string;
    },
  ): Promise<{ tasks: OnboardingTasksSelection["generatedTasks"] }> => {
    const response = await http.post<{
      tasks: OnboardingTasksSelection["generatedTasks"];
    }>(`/v1/workspaces/${workspaceId}/onboarding/generate-tasks`, data);
    return response.data;
  },

  generateOnboardingChannels: async (
    workspaceId: string,
    data: {
      role: OnboardingRoleSelection;
      tasks?: OnboardingTasksSelection;
      lang?: string;
    },
  ): Promise<{
    channels: NonNullable<
      WorkspaceOnboardingStepData["channels"]
    >["channelDrafts"];
  }> => {
    const response = await http.post<{
      channels: NonNullable<
        WorkspaceOnboardingStepData["channels"]
      >["channelDrafts"];
    }>(`/v1/workspaces/${workspaceId}/onboarding/generate-channels`, data);
    return response.data;
  },

  generateOnboardingAgents: async (
    workspaceId: string,
    data: {
      role: OnboardingRoleSelection;
      tasks?: OnboardingTasksSelection;
      lang?: string;
    },
  ): Promise<{
    agents: WorkspaceOnboardingStepData["agents"];
  }> => {
    const response = await http.post<{
      agents: WorkspaceOnboardingStepData["agents"];
    }>(`/v1/workspaces/${workspaceId}/onboarding/generate-agents`, data);
    return response.data;
  },

  completeOnboarding: async (
    workspaceId: string,
    data?: { lang?: string },
  ): Promise<WorkspaceOnboarding> => {
    const response = await http.post<WorkspaceOnboarding>(
      `/v1/workspaces/${workspaceId}/onboarding/complete`,
      data ?? {},
    );
    return response.data;
  },
};

export default workspaceApi;
