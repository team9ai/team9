import { api } from "./client";

export interface ToolInfo {
  name: string;
  description: string;
  awaitsExternalResponse: boolean;
  parameters: {
    type: "object";
    properties: Record<
      string,
      {
        type: string;
        description?: string;
        enum?: string[];
        items?: { type: string };
      }
    >;
    required?: string[];
  };
}

export const toolsApi = {
  /**
   * Get all available tools
   */
  async list(): Promise<ToolInfo[]> {
    const response = await api.get<{ tools: ToolInfo[] }>("/tools");
    return response.tools;
  },

  /**
   * Get tool by name
   */
  async get(name: string): Promise<ToolInfo> {
    const response = await api.get<{ tool: ToolInfo }>(`/tools/${name}`);
    return response.tool;
  },
};
