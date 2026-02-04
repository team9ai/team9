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
};

export default applicationsApi;
