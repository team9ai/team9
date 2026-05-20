import http from "../http";
import type {
  CreateTaskRunDto,
  TaskDeliverable,
  TaskRun,
  TaskRunDetail,
  UpdateTaskRunDto,
} from "@/types/task";

export const tasksApi = {
  create: async (dto: CreateTaskRunDto): Promise<TaskRun> => {
    const response = await http.post<TaskRun>("/v1/tasks", dto);
    return response.data;
  },

  update: async (id: string, dto: UpdateTaskRunDto): Promise<TaskRun> => {
    const response = await http.patch<TaskRun>(`/v1/tasks/${id}`, dto);
    return response.data;
  },

  hide: async (id: string): Promise<TaskRun> => {
    const response = await http.post<TaskRun>(`/v1/tasks/${id}/hide`);
    return response.data;
  },

  unhide: async (id: string): Promise<TaskRun> => {
    const response = await http.post<TaskRun>(`/v1/tasks/${id}/unhide`);
    return response.data;
  },

  archive: async (id: string): Promise<TaskRun> => {
    const response = await http.post<TaskRun>(`/v1/tasks/${id}/archive`);
    return response.data;
  },

  delete: async (id: string): Promise<void> => {
    await http.delete(`/v1/tasks/${id}`);
  },

  list: async (): Promise<TaskRun[]> => {
    const response = await http.get<TaskRun[]>("/v1/tasks");
    return response.data;
  },

  getById: async (id: string): Promise<TaskRunDetail> => {
    const response = await http.get<TaskRunDetail>(`/v1/tasks/${id}`);
    return response.data;
  },

  getDeliverables: async (id: string): Promise<TaskDeliverable[]> => {
    const response = await http.get<TaskDeliverable[]>(
      `/v1/tasks/${id}/deliverables`,
    );
    return response.data;
  },
};

export default tasksApi;
