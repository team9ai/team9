import http from "../http";
import type {
  Skill,
  SkillDetail,
  SkillVersion,
  SkillVersionDetail,
  SkillType,
  CreateSkillDto,
  UpdateSkillDto,
  CreateVersionDto,
  ReviewVersionDto,
} from "@/types/skill";

export interface SkillListParams {
  type?: SkillType;
}

export const skillsApi = {
  create: async (dto: CreateSkillDto): Promise<Skill> => {
    const response = await http.post<Skill>("/v1/skills", dto);
    return response.data;
  },

  list: async (params?: SkillListParams): Promise<Skill[]> => {
    const response = await http.get<Skill[]>("/v1/skills", { params });
    return response.data;
  },

  getById: async (id: string): Promise<SkillDetail> => {
    const response = await http.get<SkillDetail>(`/v1/skills/${id}`);
    return response.data;
  },

  update: async (id: string, dto: UpdateSkillDto): Promise<Skill> => {
    const response = await http.patch<Skill>(`/v1/skills/${id}`, dto);
    return response.data;
  },

  delete: async (id: string): Promise<void> => {
    await http.delete(`/v1/skills/${id}`);
  },

  // Versions
  listVersions: async (id: string): Promise<SkillVersion[]> => {
    const response = await http.get<SkillVersion[]>(
      `/v1/skills/${id}/versions`,
    );
    return response.data;
  },

  getVersion: async (
    id: string,
    version: number,
  ): Promise<SkillVersionDetail> => {
    const response = await http.get<SkillVersionDetail>(
      `/v1/skills/${id}/versions/${version}`,
    );
    return response.data;
  },

  createVersion: async (
    id: string,
    dto: CreateVersionDto,
  ): Promise<SkillVersion> => {
    const response = await http.post<SkillVersion>(
      `/v1/skills/${id}/versions`,
      dto,
    );
    return response.data;
  },

  reviewVersion: async (
    id: string,
    version: number,
    dto: ReviewVersionDto,
  ): Promise<void> => {
    await http.patch(`/v1/skills/${id}/versions/${version}`, dto);
  },
};

export default skillsApi;
