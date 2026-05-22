import http from "../http";
import type { StaffBotResult } from "./applications";

export interface RecommendedStaffModel {
  provider: string;
  id: string;
}

export interface RecommendedStaffTemplate {
  templateId: string;
  name: string;
  description: string | null;
  displayName: string;
  roleTitle: string;
  shortRoleTitle: string | null;
  persona: string | null;
  jobDescription: string | null;
  avatarUrl: string | null;
  model: RecommendedStaffModel;
  unique: boolean;
  installed: boolean;
  installedBotId?: string;
}

export interface InstallRecommendedStaffDto {
  mentorId?: string | null;
}

export const agentHubApi = {
  getRecommendedStaff: async (): Promise<RecommendedStaffTemplate[]> => {
    const response = await http.get<RecommendedStaffTemplate[]>(
      "/v1/agent-hub/recommended-staff",
    );
    return response.data;
  },

  installRecommendedStaff: async (
    templateId: string,
    body: InstallRecommendedStaffDto = {},
  ): Promise<StaffBotResult> => {
    const encodedTemplateId = encodeURIComponent(templateId);
    const response = await http.post<StaffBotResult>(
      `/v1/agent-hub/recommended-staff/${encodedTemplateId}/install`,
      body,
    );
    return response.data;
  },
};

export default agentHubApi;
