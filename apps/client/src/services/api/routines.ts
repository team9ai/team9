import http from "../http";
import type {
  Routine,
  RoutineDetail,
  RoutineExecution,
  RoutineExecutionDetail,
  RoutineDeliverable,
  RoutineIntervention,
  RoutineStatus,
  RoutineScheduleType,
  RoutineTrigger,
  ExecutionEntry,
  CreateRoutineDto,
  UpdateRoutineDto,
  ResolveInterventionDto,
  CreateTriggerDto,
  UpdateTriggerDto,
  RetryExecutionDto,
} from "@/types/routine";

export interface RoutineListParams {
  botId?: string;
  status?: RoutineStatus;
  /** @deprecated Use trigger-based filtering instead */
  scheduleType?: RoutineScheduleType;
}

export const routinesApi = {
  create: async (dto: CreateRoutineDto): Promise<Routine> => {
    const response = await http.post<Routine>("/v1/routines", dto);
    return response.data;
  },

  list: async (params?: RoutineListParams): Promise<Routine[]> => {
    const response = await http.get<Routine[]>("/v1/routines", {
      params,
    });
    return response.data;
  },

  getById: async (id: string): Promise<RoutineDetail> => {
    const response = await http.get<RoutineDetail>(`/v1/routines/${id}`);
    return response.data;
  },

  update: async (id: string, dto: UpdateRoutineDto): Promise<Routine> => {
    const response = await http.patch<Routine>(`/v1/routines/${id}`, dto);
    return response.data;
  },

  delete: async (id: string): Promise<void> => {
    await http.delete(`/v1/routines/${id}`);
  },

  start: async (
    id: string,
    opts?: { notes?: string; triggerId?: string; message?: string },
  ): Promise<void> => {
    await http.post(`/v1/routines/${id}/start`, opts ?? {});
  },

  pause: async (id: string): Promise<void> => {
    await http.post(`/v1/routines/${id}/pause`, {});
  },

  resume: async (id: string, message?: string): Promise<void> => {
    await http.post(`/v1/routines/${id}/resume`, message ? { message } : {});
  },

  stop: async (id: string, reason?: string): Promise<void> => {
    await http.post(`/v1/routines/${id}/stop`, reason ? { reason } : {});
  },

  restart: async (id: string, opts?: { notes?: string }): Promise<void> => {
    await http.post(`/v1/routines/${id}/restart`, opts ?? {});
  },

  getExecutions: async (id: string): Promise<RoutineExecution[]> => {
    const response = await http.get<RoutineExecution[]>(
      `/v1/routines/${id}/executions`,
    );
    return response.data;
  },

  getExecution: async (
    id: string,
    execId: string,
  ): Promise<RoutineExecutionDetail> => {
    const response = await http.get<RoutineExecutionDetail>(
      `/v1/routines/${id}/executions/${execId}`,
    );
    return response.data;
  },

  getDeliverables: async (
    id: string,
    executionId?: string,
  ): Promise<RoutineDeliverable[]> => {
    const response = await http.get<RoutineDeliverable[]>(
      `/v1/routines/${id}/deliverables`,
      { params: executionId ? { executionId } : undefined },
    );
    return response.data;
  },

  getInterventions: async (id: string): Promise<RoutineIntervention[]> => {
    const response = await http.get<RoutineIntervention[]>(
      `/v1/routines/${id}/interventions`,
    );
    return response.data;
  },

  resolveIntervention: async (
    routineId: string,
    interventionId: string,
    dto: ResolveInterventionDto,
  ): Promise<void> => {
    await http.post(
      `/v1/routines/${routineId}/interventions/${interventionId}/resolve`,
      dto,
    );
  },

  // Trigger CRUD
  createTrigger: async (
    routineId: string,
    dto: CreateTriggerDto,
  ): Promise<RoutineTrigger> => {
    const response = await http.post<RoutineTrigger>(
      `/v1/routines/${routineId}/triggers`,
      dto,
    );
    return response.data;
  },

  listTriggers: async (routineId: string): Promise<RoutineTrigger[]> => {
    const response = await http.get<RoutineTrigger[]>(
      `/v1/routines/${routineId}/triggers`,
    );
    return response.data;
  },

  updateTrigger: async (
    routineId: string,
    triggerId: string,
    dto: UpdateTriggerDto,
  ): Promise<RoutineTrigger> => {
    const response = await http.patch<RoutineTrigger>(
      `/v1/routines/${routineId}/triggers/${triggerId}`,
      dto,
    );
    return response.data;
  },

  deleteTrigger: async (
    routineId: string,
    triggerId: string,
  ): Promise<void> => {
    await http.delete(`/v1/routines/${routineId}/triggers/${triggerId}`);
  },

  getExecutionEntries: async (
    id: string,
    execId: string,
  ): Promise<ExecutionEntry[]> => {
    const response = await http.get<ExecutionEntry[]>(
      `/v1/routines/${id}/executions/${execId}/entries`,
    );
    return response.data;
  },

  // Retry
  retry: async (routineId: string, dto: RetryExecutionDto): Promise<void> => {
    await http.post(`/v1/routines/${routineId}/retry`, dto);
  },

  // Agentic creation
  createWithCreationTask: async (body: {
    agentId: string;
  }): Promise<{
    routineId: string;
    creationChannelId: string;
    creationSessionId: string;
  }> => {
    const response = await http.post<{
      routineId: string;
      creationChannelId: string;
      creationSessionId: string;
    }>("/v1/routines/with-creation-task", body);
    return response.data;
  },

  completeCreation: async (
    routineId: string,
    body?: { notes?: string },
  ): Promise<Routine> => {
    const response = await http.post<Routine>(
      `/v1/routines/${routineId}/complete-creation`,
      body ?? {},
    );
    return response.data;
  },

  startCreationSession: async (
    routineId: string,
  ): Promise<{
    creationChannelId: string;
    creationSessionId: string;
  }> => {
    const response = await http.post<{
      creationChannelId: string;
      creationSessionId: string;
    }>(`/v1/routines/${routineId}/start-creation-session`);
    return response.data;
  },
};

export default routinesApi;
