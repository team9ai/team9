import http from "../http";

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
  request_id: string;
  name?: string;
  status: string;
  [key: string]: any;
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

  openClawAction: async (
    installedAppId: string,
    action: "start" | "stop" | "restart",
  ): Promise<void> => {
    await http.post(
      `/v1/installed-applications/${installedAppId}/openclaw/${action}`,
    );
  },

  createOpenClawAgent: async (
    installedAppId: string,
    data: { displayName: string; description?: string },
  ): Promise<{
    botId: string;
    agentId: string | null;
    displayName: string;
    mentorId: string;
  }> => {
    const response = await http.post(
      `/v1/installed-applications/${installedAppId}/openclaw/agents`,
      data,
    );
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
};

export default applicationsApi;
