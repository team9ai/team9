import http from "../http";
import type {
  CreateTaskRunDto,
  TaskDeliverable,
  TaskRun,
  TaskRunDetail,
  UpdateTaskRunDto,
} from "@/types/task";
import type {
  Routine,
  RoutineDeliverable,
  RoutineDetail,
} from "@/types/routine";

interface ErrorResponseBody {
  message?: string;
}

interface StartTaskRunDto {
  message?: string;
}

type TaskRouteMethod = "DELETE" | "GET" | "PATCH" | "POST";

function isTaskRouteMissing(error: unknown, method: TaskRouteMethod) {
  const response = getErrorResponse(error);
  const message = response?.data?.message;

  return (
    response?.status === 404 &&
    typeof message === "string" &&
    message.startsWith(`Cannot ${method} `) &&
    message.includes("/api/v1/tasks")
  );
}

function isTaskRunMissing(error: unknown) {
  const response = getErrorResponse(error);
  return (
    response?.status === 404 && response.data?.message === "Task run not found"
  );
}

function shouldFallbackToRoutine(error: unknown, method: TaskRouteMethod) {
  return isTaskRouteMissing(error, method) || isTaskRunMissing(error);
}

function getErrorResponse(error: unknown):
  | {
      status?: number;
      data?: ErrorResponseBody;
    }
  | undefined {
  if (
    !(error instanceof Error) ||
    !("response" in error) ||
    typeof error.response !== "object" ||
    error.response === null
  ) {
    return undefined;
  }

  return error.response as {
    status?: number;
    data?: ErrorResponseBody;
  };
}

function mapRoutineToTaskRun(routine: Routine): TaskRun {
  return {
    id: routine.id,
    tenantId: routine.tenantId,
    routineId: routine.id,
    routineVersion: routine.version,
    botId: routine.botId,
    creatorId: routine.creatorId,
    title: routine.title,
    description: routine.description,
    status: routine.status,
    channelId: routine.creationChannelId,
    taskcastTaskId: null,
    tokenUsage: routine.tokenUsage ?? 0,
    startedAt: null,
    completedAt: null,
    duration: null,
    error: null,
    triggerId: null,
    triggerType: null,
    triggerContext: null,
    documentVersionId: null,
    sourceRunId: null,
    hiddenAt: null,
    archivedAt: null,
    createdAt: routine.createdAt,
    updatedAt: routine.updatedAt,
  };
}

function mapRoutineDeliverableToTaskDeliverable(
  deliverable: RoutineDeliverable,
): TaskDeliverable {
  return {
    id: deliverable.id,
    runId: deliverable.executionId,
    routineId: deliverable.routineId,
    fileName: deliverable.fileName,
    fileSize: deliverable.fileSize,
    mimeType: deliverable.mimeType,
    fileUrl: deliverable.fileUrl,
    createdAt: deliverable.createdAt,
  };
}

function mapRoutineDetailToTaskRunDetail(
  routine: RoutineDetail,
): TaskRunDetail {
  const fallback = mapRoutineToTaskRun(routine);
  const execution = routine.currentExecution?.execution;

  return {
    ...fallback,
    ...(execution
      ? {
          status: execution.status,
          channelId: execution.channelId,
          taskcastTaskId: execution.taskcastTaskId,
          tokenUsage: execution.tokenUsage,
          startedAt: execution.startedAt,
          completedAt: execution.completedAt,
          duration: execution.duration,
          error: execution.error,
          triggerId: execution.triggerId,
          triggerType: execution.triggerType,
          triggerContext: execution.triggerContext as Record<
            string,
            unknown
          > | null,
          documentVersionId: execution.documentVersionId,
          sourceRunId: execution.sourceExecutionId,
        }
      : null),
    deliverables:
      routine.currentExecution?.deliverables.map(
        mapRoutineDeliverableToTaskDeliverable,
      ) ?? [],
  };
}

export const tasksApi = {
  create: async (dto: CreateTaskRunDto): Promise<TaskRun> => {
    try {
      const response = await http.post<TaskRun>("/v1/tasks", dto);
      return response.data;
    } catch (error) {
      if (!isTaskRouteMissing(error, "POST")) {
        throw error;
      }

      const response = await http.post<Routine>("/v1/routines", {
        title: dto.title,
        ...(dto.description ? { description: dto.description } : {}),
        ...(dto.botId ? { botId: dto.botId } : {}),
        scheduleType: "once",
        status: dto.triggerMode === "create_only" ? "draft" : "upcoming",
      });
      if (dto.executeImmediately && response.data.botId) {
        await http.post(`/v1/routines/${response.data.id}/start`, {
          message: dto.description ?? dto.title,
        });
      }
      return mapRoutineToTaskRun(response.data);
    }
  },

  start: async (id: string, dto: StartTaskRunDto = {}): Promise<void> => {
    try {
      await http.post(`/v1/tasks/${id}/start`, dto);
    } catch (error) {
      if (!isTaskRouteMissing(error, "POST")) {
        throw error;
      }

      await http.post(`/v1/routines/${id}/start`, dto);
    }
  },

  update: async (id: string, dto: UpdateTaskRunDto): Promise<TaskRun> => {
    try {
      const response = await http.patch<TaskRun>(`/v1/tasks/${id}`, dto);
      return response.data;
    } catch (error) {
      if (!shouldFallbackToRoutine(error, "PATCH")) {
        throw error;
      }

      const response = await http.patch<Routine>(`/v1/routines/${id}`, dto);
      return mapRoutineToTaskRun(response.data);
    }
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
    try {
      await http.delete(`/v1/tasks/${id}`);
    } catch (error) {
      if (!shouldFallbackToRoutine(error, "DELETE")) {
        throw error;
      }

      await http.delete(`/v1/routines/${id}`);
    }
  },

  list: async (): Promise<TaskRun[]> => {
    try {
      const response = await http.get<TaskRun[]>("/v1/tasks");
      return response.data;
    } catch (error) {
      if (!isTaskRouteMissing(error, "GET")) {
        throw error;
      }

      const response = await http.get<Routine[]>("/v1/routines");
      return response.data.map(mapRoutineToTaskRun);
    }
  },

  getById: async (id: string): Promise<TaskRunDetail> => {
    try {
      const response = await http.get<TaskRunDetail>(`/v1/tasks/${id}`);
      return response.data;
    } catch (error) {
      if (!shouldFallbackToRoutine(error, "GET")) {
        throw error;
      }

      const response = await http.get<RoutineDetail>(`/v1/routines/${id}`);
      return mapRoutineDetailToTaskRunDetail(response.data);
    }
  },

  getDeliverables: async (id: string): Promise<TaskDeliverable[]> => {
    try {
      const response = await http.get<TaskDeliverable[]>(
        `/v1/tasks/${id}/deliverables`,
      );
      return response.data;
    } catch (error) {
      if (!isTaskRouteMissing(error, "GET")) {
        throw error;
      }

      const detailResponse = await http.get<RoutineDetail>(
        `/v1/routines/${id}`,
      );
      return (
        detailResponse.data.currentExecution?.deliverables.map(
          mapRoutineDeliverableToTaskDeliverable,
        ) ?? []
      );
    }
  },
};

export default tasksApi;
