import { api } from "./client";
import type {
  AgentInstance,
  Blueprint,
  ExecutionMode,
  ExecutionModeStatus,
  LLMConfig,
  MemoryState,
  StateSummary,
  StepResult,
} from "@/types";

export interface CreateAgentRequest {
  blueprint: Blueprint;
  modelOverride?: LLMConfig;
}

export interface InjectEventRequest {
  event: {
    type: string;
    payload?: unknown;
  };
}

export interface ForkStateRequest {
  stateId: string;
}

export interface EditChunkRequest {
  stateId: string;
  content: unknown;
}

export const agentApi = {
  /**
   * Create agent from blueprint
   */
  async create(request: CreateAgentRequest): Promise<AgentInstance> {
    const response = await api.post<{ agent: AgentInstance }>(
      "/agents",
      request,
    );
    return response.agent;
  },

  /**
   * List all agents
   */
  async list(): Promise<AgentInstance[]> {
    const response = await api.get<{ agents: AgentInstance[] }>("/agents");
    return response.agents;
  },

  /**
   * Get agent by ID
   */
  async get(id: string): Promise<AgentInstance> {
    const response = await api.get<{ agent: AgentInstance }>(`/agents/${id}`);
    return response.agent;
  },

  /**
   * Delete agent
   */
  async delete(id: string): Promise<void> {
    await api.delete(`/agents/${id}`);
  },

  /**
   * Get agent state history
   */
  async getStateHistory(id: string): Promise<StateSummary[]> {
    const response = await api.get<{ states: StateSummary[] }>(
      `/agents/${id}/states`,
    );
    return response.states;
  },

  /**
   * Get specific state
   */
  async getState(agentId: string, stateId: string): Promise<MemoryState> {
    const response = await api.get<{ state: MemoryState }>(
      `/agents/${agentId}/states/${stateId}`,
    );
    return response.state;
  },

  /**
   * Get current state
   */
  async getCurrentState(id: string): Promise<MemoryState> {
    const response = await api.get<{ state: MemoryState }>(
      `/agents/${id}/current-state`,
    );
    return response.state;
  },

  /**
   * Inject event into agent
   */
  async injectEvent(id: string, request: InjectEventRequest): Promise<void> {
    await api.post(`/agents/${id}/inject`, request);
  },

  /**
   * Fork agent from state
   */
  async fork(id: string, request: ForkStateRequest): Promise<AgentInstance> {
    const response = await api.post<{ agent: AgentInstance }>(
      `/agents/${id}/fork`,
      request,
    );
    return response.agent;
  },

  /**
   * Edit chunk
   */
  async editChunk(
    agentId: string,
    chunkId: string,
    request: EditChunkRequest,
  ): Promise<void> {
    await api.put(`/agents/${agentId}/chunks/${chunkId}`, request);
  },

  /**
   * Update agent config
   */
  async updateConfig(
    id: string,
    config: { modelOverride?: LLMConfig },
  ): Promise<AgentInstance> {
    const response = await api.put<{ agent: AgentInstance }>(
      `/agents/${id}/config`,
      config,
    );
    return response.agent;
  },

  // ============ Execution Mode Control ============

  /**
   * Get execution mode status
   */
  async getExecutionModeStatus(id: string): Promise<ExecutionModeStatus> {
    const response = await api.get<{ status: ExecutionModeStatus }>(
      `/agents/${id}/execution-mode`,
    );
    return response.status;
  },

  /**
   * Set execution mode
   */
  async setExecutionMode(
    id: string,
    mode: ExecutionMode,
  ): Promise<ExecutionModeStatus> {
    const response = await api.put<{ status: ExecutionModeStatus }>(
      `/agents/${id}/execution-mode`,
      { mode },
    );
    return response.status;
  },

  /**
   * Execute a single step in stepping mode
   */
  async step(id: string): Promise<StepResult> {
    const response = await api.post<{ result: StepResult }>(
      `/agents/${id}/step`,
    );
    return response.result;
  },
};
