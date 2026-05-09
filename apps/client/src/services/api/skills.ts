import http from "../http";
import type {
  Skill,
  SkillDetail,
  SkillType,
  CreateSkillDto,
  UpdateSkillDto,
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
};

export default skillsApi;
