import http, { API_BASE_URL } from "../http";
import { getValidAccessToken } from "../auth-session";
import type { AgentType } from "@/types/im";

// Types matching server schemas
export type ApplicationType = "managed" | "custom";

export interface Application {
  id: string;
  name: string;
  description: string;
  iconUrl?: string;
  categories: string[];
  enabled: boolean;
  type: ApplicationType;
}

export interface InstalledApplication {
  id: string;
  applicationId: string;
  name: string;
  description?: string;
  iconUrl?: string;
  tenantId: string;
  installedBy?: string;
  config: Record<string, unknown>;
  permissions: Record<string, unknown>;
  status: "active" | "inactive" | "pending" | "error";
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  /** Application type - managed apps cannot be uninstalled or disabled */
  type?: ApplicationType;
}

export interface InstallApplicationDto {
  applicationId: string;
  name?: string;
  description?: string;
  iconUrl?: string;
  config?: Record<string, unknown>;
  secrets?: Record<string, unknown>;
  permissions?: Record<string, unknown>;
}

export interface UpdateInstalledApplicationDto {
  name?: string;
  description?: string;
  iconUrl?: string;
  config?: Record<string, unknown>;
  secrets?: Record<string, unknown>;
  permissions?: Record<string, unknown>;
  isActive?: boolean;
}

// OpenClaw workspace types
export interface OpenClawWorkspace {
  name: string;
  modified?: string;
}

export interface OpenClawWorkspacesResponse {
  instanceId: string;
  workspaces: OpenClawWorkspace[];
}

export interface FileKeeperTokenResponse {
  token: string;
  baseUrl: string;
  instanceId: string;
  expiresAt: string;
}

export interface FileKeeperDirEntry {
  name: string;
  type: "file" | "directory";
  size?: number;
  modified: string;
}

export interface FileKeeperListResponse {
  path: string;
  entries: FileKeeperDirEntry[];
}

// Common Staff types
export interface CommonStaffBotInfo {
  botId: string;
  userId: string;
  username: string;
  displayName: string | null;
  roleTitle: string | null;
  persona: string | null;
  jobDescription: string | null;
  avatarUrl: string | null;
  model: { provider: string; id: string } | null;
  mentorId: string | null;
  mentorDisplayName: string | null;
  mentorAvatarUrl: string | null;
  isActive: boolean;
  createdAt: string;
  managedMeta: { agentId: string } | null;
}

// Base Model Staff types
export interface BaseModelStaffBotInfo {
  botId: string;
  userId: string;
  agentType: AgentType | null;
  username: string;
  displayName: string | null;
  isActive: boolean;
  createdAt: string;
  managedMeta: { agentId: string } | null;
}

// Aggregated app with bots (from /with-bots endpoint)
export interface InstalledApplicationWithBots extends InstalledApplication {
  bots: (OpenClawBotInfo | BaseModelStaffBotInfo | CommonStaffBotInfo)[];
  instanceStatus: OpenClawInstanceStatus | null;
}

// OpenClaw-specific types
export interface OpenClawInstanceStatus {
  instanceId: string;
  status: "creating" | "running" | "stopped" | "error";
  accessUrl: string;
  createdAt: string;
  lastHeartbeat?: string;
}

export interface OpenClawBotInfo {
  botId: string;
  userId: string;
  agentType: AgentType | null;
  agentId: string | null;
  workspace: string | null;
  username: string;
  displayName: string | null;
  isActive: boolean;
  createdAt: string;
  mentorId: string | null;
  mentorDisplayName: string | null;
  mentorAvatarUrl: string | null;
}

// OpenClaw device pairing types
export interface OpenClawDeviceInfo {
  // For pending: the pairing request ID. For approved: the device ID.
  request_id: string;
  // The cryptographic device ID (SHA256 of Ed25519 public key).
  deviceId?: string;
  name?: string;
  status: "pending" | "approved";
  [key: string]: unknown;
}

export const applicationsApi = {
  // Get all available applications
  getApplications: async (): Promise<Application[]> => {
    const response = await http.get<Application[]>("/v1/applications");
    return response.data;
  },

  // Get a single application
  getApplication: async (id: string): Promise<Application> => {
    const response = await http.get<Application>(`/v1/applications/${id}`);
    return response.data;
  },

  // Get all installed applications for current tenant
  getInstalledApplications: async (): Promise<InstalledApplication[]> => {
    const response = await http.get<InstalledApplication[]>(
      "/v1/installed-applications",
    );
    return response.data;
  },

  // Get all installed applications with bots and instance status (aggregated)
  getInstalledApplicationsWithBots: async (): Promise<
    InstalledApplicationWithBots[]
  > => {
    const response = await http.get<InstalledApplicationWithBots[]>(
      "/v1/installed-applications/with-bots",
    );
    return response.data;
  },

  // Get a single installed application
  getInstalledApplication: async (
    id: string,
  ): Promise<InstalledApplication> => {
    const response = await http.get<InstalledApplication>(
      `/v1/installed-applications/${id}`,
    );
    return response.data;
  },

  // Install an application
  installApplication: async (
    data: InstallApplicationDto,
  ): Promise<InstalledApplication> => {
    const response = await http.post<InstalledApplication>(
      "/v1/installed-applications",
      data,
    );
    return response.data;
  },

  // Update an installed application
  updateInstalledApplication: async (
    id: string,
    data: UpdateInstalledApplicationDto,
  ): Promise<InstalledApplication> => {
    const response = await http.patch<InstalledApplication>(
      `/v1/installed-applications/${id}`,
      data,
    );
    return response.data;
  },

  // Uninstall an application
  uninstallApplication: async (id: string): Promise<void> => {
    await http.delete(`/v1/installed-applications/${id}`);
  },

  // OpenClaw-specific endpoints
  getOpenClawStatus: async (
    installedAppId: string,
  ): Promise<OpenClawInstanceStatus> => {
    const response = await http.get<OpenClawInstanceStatus>(
      `/v1/installed-applications/${installedAppId}/openclaw/status`,
    );
    return response.data;
  },

  getOpenClawBots: async (
    installedAppId: string,
  ): Promise<OpenClawBotInfo[]> => {
    const response = await http.get<OpenClawBotInfo[]>(
      `/v1/installed-applications/${installedAppId}/openclaw/bots`,
    );
    return response.data;
  },

  updateOpenClawBot: async (
    installedAppId: string,
    botId: string,
    data: { displayName: string },
  ): Promise<void> => {
    await http.patch(
      `/v1/installed-applications/${installedAppId}/openclaw/bots/${botId}`,
      data,
    );
  },

  updateOpenClawBotMentor: async (
    installedAppId: string,
    botId: string,
    mentorId: string | null,
  ): Promise<void> => {
    await http.patch(
      `/v1/installed-applications/${installedAppId}/openclaw/bots/${botId}/mentor`,
      { mentorId },
    );
  },

  getOpenClawDevices: async (
    installedAppId: string,
  ): Promise<OpenClawDeviceInfo[]> => {
    const response = await http.get<{ devices: OpenClawDeviceInfo[] }>(
      `/v1/installed-applications/${installedAppId}/openclaw/devices`,
    );
    return response.data.devices;
  },

  approveOpenClawDevice: async (
    installedAppId: string,
    requestId: string,
  ): Promise<void> => {
    await http.post(
      `/v1/installed-applications/${installedAppId}/openclaw/devices/approve`,
      { requestId },
    );
  },

  rejectOpenClawDevice: async (
    installedAppId: string,
    requestId: string,
  ): Promise<void> => {
    await http.post(
      `/v1/installed-applications/${installedAppId}/openclaw/devices/reject`,
      { requestId },
    );
  },

  getOpenClawGatewayInfo: async (
    installedAppId: string,
  ): Promise<{
    instanceId: string;
    gatewayUrl: string;
    gatewayPort: number;
  }> => {
    const response = await http.get<{
      instanceId: string;
      gatewayUrl: string;
      gatewayPort: number;
    }>(`/v1/installed-applications/${installedAppId}/openclaw/gateway-info`);
    return response.data;
  },

  selfApproveOpenClawDevice: async (
    installedAppId: string,
    requestId: string,
  ): Promise<void> => {
    await http.post(
      `/v1/installed-applications/${installedAppId}/openclaw/devices/self-approve`,
      { requestId },
    );
  },

  openClawAction: async (
    installedAppId: string,
    action: "start" | "stop" | "restart",
  ): Promise<void> => {
    await http.post(
      `/v1/installed-applications/${installedAppId}/openclaw/${action}`,
    );
  },

  checkUsernameAvailable: async (
    username: string,
  ): Promise<{ available: boolean }> => {
    const response = await http.get<{ available: boolean }>(
      `/v1/bots/check-username`,
      { params: { username } },
    );
    return response.data;
  },

  checkOpenClawUsername: async (
    installedAppId: string,
    username: string,
  ): Promise<{ available: boolean }> => {
    const response = await http.get<{ available: boolean }>(
      `/v1/installed-applications/${installedAppId}/openclaw/check-username`,
      { params: { username } },
    );
    return response.data;
  },

  createOpenClawAgent: async (
    installedAppId: string,
    data: {
      displayName: string;
      username?: string;
      description?: string;
      agentSlug?: string;
    },
  ): Promise<{
    botId: string;
    agentId: string | null;
    displayName: string;
    mentorId: string;
  }> => {
    const response = await http.post<{
      botId: string;
      agentId: string | null;
      displayName: string;
      mentorId: string;
    }>(`/v1/installed-applications/${installedAppId}/openclaw/agents`, data);
    return response.data;
  },

  deleteOpenClawAgent: async (
    installedAppId: string,
    botId: string,
  ): Promise<void> => {
    await http.delete(
      `/v1/installed-applications/${installedAppId}/openclaw/agents/${botId}`,
    );
  },

  // Workspace endpoints (via Team9 backend)
  getOpenClawWorkspaces: async (
    installedAppId: string,
  ): Promise<OpenClawWorkspacesResponse> => {
    const response = await http.get<OpenClawWorkspacesResponse>(
      `/v1/installed-applications/${installedAppId}/openclaw/workspaces`,
    );
    return response.data;
  },

  getFileKeeperToken: async (
    installedAppId: string,
  ): Promise<FileKeeperTokenResponse> => {
    const response = await http.get<FileKeeperTokenResponse>(
      `/v1/installed-applications/${installedAppId}/openclaw/file-keeper-token`,
    );
    return response.data;
  },

  // Direct file-keeper operations (frontend → file-keeper)
  //
  // The "default" workspace uses data-dir?path=workspace/... because
  // OpenClaw stores the single workspace directly at .openclaw/workspace/
  // (no per-name subdirectories). Named workspaces use workspace-dir/{name}.

  _buildFileKeeperUrl: (
    tokenData: FileKeeperTokenResponse,
    workspaceName: string,
    path: string,
    extraParams?: string,
  ): string => {
    const base = `${tokenData.baseUrl}/api/instances/${tokenData.instanceId}`;
    if (workspaceName === "default") {
      const wsPath =
        path === "." || path === "" ? "workspace" : `workspace/${path}`;
      const params = `path=${encodeURIComponent(wsPath)}${extraParams ? `&${extraParams}` : ""}`;
      return `${base}/data-dir?${params}`;
    }
    const params = `path=${encodeURIComponent(path)}${extraParams ? `&${extraParams}` : ""}`;
    return `${base}/workspace-dir/${workspaceName}?${params}`;
  },

  listWorkspaceFiles: async (
    tokenData: FileKeeperTokenResponse,
    workspaceName: string,
    path: string = ".",
  ): Promise<FileKeeperListResponse> => {
    const url = applicationsApi._buildFileKeeperUrl(
      tokenData,
      workspaceName,
      path,
    );
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${tokenData.token}` },
    });
    if (!res.ok) throw new Error(`Failed to list files: ${res.status}`);
    return res.json();
  },

  downloadWorkspaceFile: async (
    tokenData: FileKeeperTokenResponse,
    workspaceName: string,
    path: string,
  ): Promise<Blob> => {
    const url = applicationsApi._buildFileKeeperUrl(
      tokenData,
      workspaceName,
      path,
    );
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${tokenData.token}` },
    });
    if (!res.ok) throw new Error(`Failed to download file: ${res.status}`);
    return res.blob();
  },

  uploadWorkspaceFile: async (
    tokenData: FileKeeperTokenResponse,
    workspaceName: string,
    path: string,
    file: File,
  ): Promise<void> => {
    const url = applicationsApi._buildFileKeeperUrl(
      tokenData,
      workspaceName,
      path,
    );
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${tokenData.token}`,
        "Content-Type": "application/octet-stream",
      },
      body: file,
    });
    if (!res.ok) throw new Error(`Failed to upload file: ${res.status}`);
  },

  deleteWorkspaceFile: async (
    tokenData: FileKeeperTokenResponse,
    workspaceName: string,
    path: string,
    recursive: boolean = false,
  ): Promise<void> => {
    const url = applicationsApi._buildFileKeeperUrl(
      tokenData,
      workspaceName,
      path,
      recursive ? "recursive=true" : undefined,
    );
    const res = await fetch(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tokenData.token}` },
    });
    if (!res.ok) throw new Error(`Failed to delete: ${res.status}`);
  },

  renameWorkspaceFile: async (
    tokenData: FileKeeperTokenResponse,
    workspaceName: string,
    path: string,
    destination: string,
  ): Promise<void> => {
    // For "default" workspace, destination must also include workspace/ prefix
    // since the server resolves it relative to .openclaw/ (the data-dir root)
    const resolvedDest =
      workspaceName === "default" ? `workspace/${destination}` : destination;
    const url = applicationsApi._buildFileKeeperUrl(
      tokenData,
      workspaceName,
      path,
      `action=rename&destination=${encodeURIComponent(resolvedDest)}`,
    );
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenData.token}` },
    });
    if (!res.ok) throw new Error(`Failed to rename: ${res.status}`);
  },

  copyWorkspaceFile: async (
    tokenData: FileKeeperTokenResponse,
    workspaceName: string,
    path: string,
    destination: string,
  ): Promise<void> => {
    const resolvedDest =
      workspaceName === "default" ? `workspace/${destination}` : destination;
    const url = applicationsApi._buildFileKeeperUrl(
      tokenData,
      workspaceName,
      path,
      `action=copy&destination=${encodeURIComponent(resolvedDest)}`,
    );
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenData.token}` },
    });
    if (!res.ok) throw new Error(`Failed to copy: ${res.status}`);
  },

  createWorkspaceFolder: async (
    tokenData: FileKeeperTokenResponse,
    workspaceName: string,
    path: string,
  ): Promise<void> => {
    const url = applicationsApi._buildFileKeeperUrl(
      tokenData,
      workspaceName,
      path,
      "action=mkdir",
    );
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenData.token}` },
    });
    if (!res.ok) throw new Error(`Failed to create folder: ${res.status}`);
  },

  // Common Staff endpoints

  createCommonStaff: async (
    appId: string,
    body: {
      displayName?: string;
      roleTitle?: string;
      mentorId?: string;
      persona?: string;
      jobDescription?: string;
      model: { provider: string; id: string };
      avatarUrl?: string;
      agenticBootstrap?: boolean;
    },
  ): Promise<{
    botId: string;
    userId: string;
    agentId: string;
    displayName: string;
  }> => {
    const response = await http.post<{
      botId: string;
      userId: string;
      agentId: string;
      displayName: string;
    }>(`/v1/installed-applications/${appId}/common-staff/staff`, body);
    return response.data;
  },

  updateCommonStaff: async (
    appId: string,
    botId: string,
    body: Record<string, unknown>,
  ): Promise<void> => {
    await http.patch(
      `/v1/installed-applications/${appId}/common-staff/staff/${botId}`,
      body,
    );
  },

  deleteCommonStaff: async (appId: string, botId: string): Promise<void> => {
    await http.delete(
      `/v1/installed-applications/${appId}/common-staff/staff/${botId}`,
    );
  },

  generateAvatar: async (
    appId: string,
    body: {
      style: string;
      displayName?: string;
      roleTitle?: string;
      persona?: string;
      prompt?: string;
    },
  ): Promise<{ avatarUrl: string }> => {
    const response = await http.post<{ avatarUrl: string }>(
      `/v1/installed-applications/${appId}/common-staff/generate-avatar`,
      body,
    );
    return response.data;
  },

  /**
   * Streams persona generation text as an async iterable of string chunks.
   * Usage: `for await (const chunk of applicationsApi.generatePersona(...)) { ... }`
   */
  generatePersona: async function* (
    appId: string,
    body: {
      displayName?: string;
      roleTitle?: string;
      existingPersona?: string;
      prompt?: string;
      jobDescription?: string;
    },
  ): AsyncGenerator<string> {
    const token = await getValidAccessToken();
    const url = `${API_BASE_URL}/v1/installed-applications/${appId}/common-staff/generate-persona`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`generatePersona failed: ${res.status}`);
    const reader = res.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let sseBuffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });
        // Parse SSE lines: "data: {json}\n\n"
        const lines = sseBuffer.split("\n");
        sseBuffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === "data: [DONE]") continue;
          if (trimmed.startsWith("data: ")) {
            try {
              const parsed = JSON.parse(trimmed.slice(6));
              if (parsed.text) yield parsed.text as string;
            } catch {
              // Skip malformed SSE lines
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  },

  /**
   * Streams candidate staff generation as an async iterable of structured events.
   * The server sends SSE lines; this parser yields typed candidate events.
   * Usage: `for await (const event of applicationsApi.generateCandidates(...)) { ... }`
   */
  generateCandidates: async function* (
    appId: string,
    body: {
      jobTitle?: string;
      jobDescription?: string;
    },
  ): AsyncGenerator<{
    type: "candidate" | "partial";
    data: {
      candidateIndex?: number;
      displayName?: string;
      roleTitle?: string;
      persona?: string;
      summary?: string;
      text?: string;
    };
  }> {
    const token = await getValidAccessToken();
    const url = `${API_BASE_URL}/v1/installed-applications/${appId}/common-staff/generate-candidates`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`generateCandidates failed: ${res.status}`);
    const reader = res.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let sseBuffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });
        // Parse SSE lines: each event is "data: <json>\n\n"
        const lines = sseBuffer.split("\n");
        sseBuffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") return;
          try {
            const parsed = JSON.parse(payload) as {
              type: "candidate" | "partial";
              data: {
                candidateIndex?: number;
                displayName?: string;
                roleTitle?: string;
                persona?: string;
                summary?: string;
                text?: string;
              };
            };
            yield parsed;
          } catch {
            // ignore malformed lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  },
};

export default applicationsApi;
