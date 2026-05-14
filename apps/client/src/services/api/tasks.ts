import http from "../http";
import type {
  CreateTaskRunDto,
  TaskDeliverable,
  TaskRun,
  TaskRunDetail,
} from "@/types/task";

export const tasksApi = {
  create: async (dto: CreateTaskRunDto): Promise<TaskRun> => {
    const response = await http.post<TaskRun>("/v1/tasks", dto);
    return response.data;
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
