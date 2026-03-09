import http from "../http";
import type {
  Resource,
  ResourceUsageLog,
  CreateResourceDto,
  UpdateResourceDto,
  AuthorizeResourceDto,
  ResourceType,
} from "@/types/resource";

export const resourcesApi = {
  create: async (dto: CreateResourceDto): Promise<Resource> => {
    const response = await http.post<Resource>("/v1/resources", dto);
    return response.data;
  },

  list: async (params?: { type?: ResourceType }): Promise<Resource[]> => {
    const response = await http.get<Resource[]>("/v1/resources", { params });
    return response.data;
  },

  getById: async (id: string): Promise<Resource> => {
    const response = await http.get<Resource>(`/v1/resources/${id}`);
    return response.data;
  },

  update: async (id: string, dto: UpdateResourceDto): Promise<Resource> => {
    const response = await http.patch<Resource>(`/v1/resources/${id}`, dto);
    return response.data;
  },

  delete: async (id: string): Promise<void> => {
    await http.delete(`/v1/resources/${id}`);
  },

  authorize: async (
    id: string,
    dto: AuthorizeResourceDto,
  ): Promise<Resource> => {
    const response = await http.post<Resource>(
      `/v1/resources/${id}/authorize`,
      dto,
    );
    return response.data;
  },

  revoke: async (
    id: string,
    dto: { granteeType: string; granteeId: string },
  ): Promise<Resource> => {
    const response = await http.delete<Resource>(
      `/v1/resources/${id}/authorize`,
      { data: dto },
    );
    return response.data;
  },

  getUsageLogs: async (
    id: string,
    params?: { limit?: number; offset?: number },
  ): Promise<ResourceUsageLog[]> => {
    const response = await http.get<ResourceUsageLog[]>(
      `/v1/resources/${id}/usage-logs`,
      { params },
    );
    return response.data;
  },

  heartbeat: async (id: string): Promise<void> => {
    await http.post(`/v1/resources/${id}/heartbeat`);
  },
};

export default resourcesApi;
