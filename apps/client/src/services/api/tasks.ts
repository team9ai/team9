import http from "../http";
import type {
  AgentTask,
  AgentTaskDetail,
  AgentTaskExecution,
  AgentTaskDeliverable,
  AgentTaskIntervention,
  AgentTaskStatus,
  AgentTaskScheduleType,
  CreateTaskDto,
  UpdateTaskDto,
  ResolveInterventionDto,
} from "@/types/task";

export interface TaskListParams {
  botId?: string;
  status?: AgentTaskStatus;
  scheduleType?: AgentTaskScheduleType;
}

export const tasksApi = {
  create: async (dto: CreateTaskDto): Promise<AgentTask> => {
    const response = await http.post<AgentTask>("/v1/tasks", dto);
    return response.data;
  },

  list: async (params?: TaskListParams): Promise<AgentTask[]> => {
    const response = await http.get<AgentTask[]>("/v1/tasks", {
      params,
    });
    return response.data;
  },

  getById: async (id: string): Promise<AgentTaskDetail> => {
    const response = await http.get<AgentTaskDetail>(`/v1/tasks/${id}`);
    return response.data;
  },

  update: async (id: string, dto: UpdateTaskDto): Promise<AgentTask> => {
    const response = await http.patch<AgentTask>(`/v1/tasks/${id}`, dto);
    return response.data;
  },

  delete: async (id: string): Promise<void> => {
    await http.delete(`/v1/tasks/${id}`);
  },

  start: async (id: string, message?: string): Promise<void> => {
    await http.post(`/v1/tasks/${id}/start`, message ? { message } : {});
  },

  pause: async (id: string): Promise<void> => {
    await http.post(`/v1/tasks/${id}/pause`, {});
  },

  resume: async (id: string, message?: string): Promise<void> => {
    await http.post(`/v1/tasks/${id}/resume`, message ? { message } : {});
  },

  stop: async (id: string, reason?: string): Promise<void> => {
    await http.post(`/v1/tasks/${id}/stop`, reason ? { reason } : {});
  },

  restart: async (id: string): Promise<void> => {
    await http.post(`/v1/tasks/${id}/restart`, {});
  },

  getExecutions: async (id: string): Promise<AgentTaskExecution[]> => {
    const response = await http.get<AgentTaskExecution[]>(
      `/v1/tasks/${id}/executions`,
    );
    return response.data;
  },

  getExecution: async (
    id: string,
    execId: string,
  ): Promise<AgentTaskExecution> => {
    const response = await http.get<AgentTaskExecution>(
      `/v1/tasks/${id}/executions/${execId}`,
    );
    return response.data;
  },

  getDeliverables: async (
    id: string,
    executionId?: string,
  ): Promise<AgentTaskDeliverable[]> => {
    const response = await http.get<AgentTaskDeliverable[]>(
      `/v1/tasks/${id}/deliverables`,
      { params: executionId ? { executionId } : undefined },
    );
    return response.data;
  },

  getInterventions: async (id: string): Promise<AgentTaskIntervention[]> => {
    const response = await http.get<AgentTaskIntervention[]>(
      `/v1/tasks/${id}/interventions`,
    );
    return response.data;
  },

  resolveIntervention: async (
    taskId: string,
    interventionId: string,
    dto: ResolveInterventionDto,
  ): Promise<void> => {
    await http.post(
      `/v1/tasks/${taskId}/interventions/${interventionId}/resolve`,
      dto,
    );
  },
};

export default tasksApi;
