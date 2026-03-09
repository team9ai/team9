import http from "../http";
import type {
  AgentTask,
  AgentTaskDetail,
  AgentTaskExecution,
  AgentTaskExecutionDetail,
  AgentTaskDeliverable,
  AgentTaskIntervention,
  AgentTaskStatus,
  AgentTaskScheduleType,
  AgentTaskTrigger,
  ExecutionEntry,
  CreateTaskDto,
  UpdateTaskDto,
  ResolveInterventionDto,
  CreateTriggerDto,
  UpdateTriggerDto,
  RetryExecutionDto,
} from "@/types/task";

export interface TaskListParams {
  botId?: string;
  status?: AgentTaskStatus;
  /** @deprecated Use trigger-based filtering instead */
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

  start: async (
    id: string,
    opts?: { notes?: string; triggerId?: string; message?: string },
  ): Promise<void> => {
    await http.post(`/v1/tasks/${id}/start`, opts ?? {});
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
  ): Promise<AgentTaskExecutionDetail> => {
    const response = await http.get<AgentTaskExecutionDetail>(
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

  // Trigger CRUD
  createTrigger: async (
    taskId: string,
    dto: CreateTriggerDto,
  ): Promise<AgentTaskTrigger> => {
    const response = await http.post<AgentTaskTrigger>(
      `/v1/tasks/${taskId}/triggers`,
      dto,
    );
    return response.data;
  },

  listTriggers: async (taskId: string): Promise<AgentTaskTrigger[]> => {
    const response = await http.get<AgentTaskTrigger[]>(
      `/v1/tasks/${taskId}/triggers`,
    );
    return response.data;
  },

  updateTrigger: async (
    taskId: string,
    triggerId: string,
    dto: UpdateTriggerDto,
  ): Promise<AgentTaskTrigger> => {
    const response = await http.patch<AgentTaskTrigger>(
      `/v1/tasks/${taskId}/triggers/${triggerId}`,
      dto,
    );
    return response.data;
  },

  deleteTrigger: async (taskId: string, triggerId: string): Promise<void> => {
    await http.delete(`/v1/tasks/${taskId}/triggers/${triggerId}`);
  },

  getExecutionEntries: async (
    id: string,
    execId: string,
  ): Promise<ExecutionEntry[]> => {
    const response = await http.get<ExecutionEntry[]>(
      `/v1/tasks/${id}/executions/${execId}/entries`,
    );
    return response.data;
  },

  // Retry
  retry: async (taskId: string, dto: RetryExecutionDto): Promise<void> => {
    await http.post(`/v1/tasks/${taskId}/retry`, dto);
  },
};

export default tasksApi;
