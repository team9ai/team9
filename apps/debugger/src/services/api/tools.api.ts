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
  category?: string;
}

export interface ToolsResponse {
  /** Control tools from agent-framework */
  tools: ToolInfo[];
  /** External tools registered at runtime (e.g., Semrush API) */
  externalTools: ToolInfo[];
}

export const toolsApi = {
  /**
   * Get all available tools (control + external)
   */
  async list(): Promise<ToolsResponse> {
    const response = await api.get<ToolsResponse>("/tools");
    return response;
  },

  /**
   * Get only external tools (for component configuration)
   */
  async listExternalTools(): Promise<ToolInfo[]> {
    const response = await api.get<ToolsResponse>("/tools");
    return response.externalTools ?? [];
  },

  /**
   * Get tool by name
   */
  async get(name: string): Promise<ToolInfo> {
    const response = await api.get<{ tool: ToolInfo }>(`/tools/${name}`);
    return response.tool;
  },
};
