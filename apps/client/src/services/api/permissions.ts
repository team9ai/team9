import http from "../http";

export interface PermissionRequest {
  id: string;
  spellId: string;
  permissionKey: string;
  requestedMetadata: Record<string, unknown>;
  reason?: string | null;
  contextChannelId?: string | null;
  expiresAt: string;
  status:
    | "pending"
    | "approved_once"
    | "approved_durable"
    | "denied"
    | "expired"
    | "cancelled";
  requesterBotId: string;
}

export interface PermissionGrant {
  id: string;
  subjectKind: "agent" | "channel-session" | "execution-session" | "task";
  subjectId: string;
  permissionKey: string;
  scopeMetadata: Record<string, unknown>;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface DecidePermissionInput {
  requestId: string;
  decision: "once" | "remember" | "deny";
  scopeOverride?: Record<string, unknown>;
  rememberSubject?: "agent" | "channel-session" | "execution-session" | "task";
  expiresAt?: string;
  note?: string;
}

export interface GrantsQuery {
  subjectKind: PermissionGrant["subjectKind"];
  subjectId: string;
}

const permissionsApi = {
  listRequests: async (params?: {
    status?: string;
    scope?: string;
  }): Promise<PermissionRequest[]> => {
    const response = await http.get<PermissionRequest[]>(
      "/permissions/requests",
      { params },
    );
    return response.data;
  },

  decideRequest: async ({
    requestId,
    ...body
  }: DecidePermissionInput): Promise<PermissionRequest> => {
    const response = await http.post<PermissionRequest>(
      `/permissions/requests/${requestId}/decide`,
      body,
    );
    return response.data;
  },

  listGrants: async (params: GrantsQuery): Promise<PermissionGrant[]> => {
    const response = await http.get<PermissionGrant[]>("/permissions/grants", {
      params,
    });
    return response.data;
  },

  createGrant: async (
    body: Omit<PermissionGrant, "id" | "revokedAt" | "createdAt">,
  ): Promise<PermissionGrant> => {
    const response = await http.post<PermissionGrant>(
      "/permissions/grants",
      body,
    );
    return response.data;
  },

  revokeGrant: async (grantId: string): Promise<void> => {
    await http.delete(`/permissions/grants/${grantId}`);
  },
};

export default permissionsApi;
