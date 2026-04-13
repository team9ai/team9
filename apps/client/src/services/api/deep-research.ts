import http from "@/services/http";

export type TaskStatus = "pending" | "running" | "completed" | "failed";

export interface CreateTaskInput {
  input: string | Array<Record<string, unknown>>;
  agentConfig?: { thinkingSummaries?: "auto" | "off" };
}

export interface Task {
  id: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  prompt?: string | null;
  finalReportS3?: string | null;
  error?: { code: string; message: string; details?: unknown } | null;
}

export interface ListTasksParams {
  status?: TaskStatus;
  cursor?: string;
  limit?: number;
}

export interface ListTasksResponse {
  items: Task[];
  nextCursor: string | null;
}

export interface TaskWithReport extends Task {
  reportUrl?: string | null;
}

export const deepResearchApi = {
  /** Create a new deep-research task. */
  createTask: async (body: CreateTaskInput): Promise<Task> => {
    const res = await http.post<Task>("/v1/deep-research/tasks", body);
    return res.data;
  },

  /** List tasks with optional filter/pagination params. */
  listTasks: async (params?: ListTasksParams): Promise<ListTasksResponse> => {
    const res = await http.get<ListTasksResponse>("/v1/deep-research/tasks", {
      params,
    });
    return res.data;
  },

  /** Fetch a single task by id. */
  getTask: async (id: string): Promise<TaskWithReport> => {
    const res = await http.get<TaskWithReport>(
      `/v1/deep-research/tasks/${encodeURIComponent(id)}`,
    );
    return res.data;
  },
};

/**
 * Open the server-sent events stream for a task. Returns the raw Response;
 * the caller is responsible for parsing body chunks with eventsource-parser.
 * Auth token and tenant id are injected here (bypassing the http interceptors
 * because fetch is used directly). lastEventId enables resumable streams.
 */
export async function openTaskStream(
  taskId: string,
  lastEventId: string | null,
  token: string,
  tenantId: string,
  signal: AbortSignal,
): Promise<Response> {
  const headers: Record<string, string> = {
    accept: "text/event-stream",
    authorization: `Bearer ${token}`,
    "x-tenant-id": tenantId,
  };
  if (lastEventId) headers["last-event-id"] = lastEventId;
  return fetch(
    `/api/v1/deep-research/tasks/${encodeURIComponent(taskId)}/stream`,
    { headers, signal },
  );
}
