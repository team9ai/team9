import http from "@/services/http";

export type TaskStatus = "pending" | "running" | "completed" | "failed";

// Capability hub wraps successful JSON responses in `{success: true, data: ...}`.
// The gateway is a thin passthrough so the envelope reaches the client
// unchanged. Unwrap here so callers always see the plain payload shape.
function unwrapHubEnvelope<T>(body: unknown): T {
  if (
    body !== null &&
    typeof body === "object" &&
    "data" in body &&
    (body as { success?: unknown }).success === true
  ) {
    return (body as { data: T }).data;
  }
  return body as T;
}

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
    const res = await http.post<unknown>("/v1/deep-research/tasks", body);
    // Hub's create endpoint returns { taskId, status, streamUrl } — rename
    // taskId → id to stay aligned with the get/list shape used elsewhere.
    const raw = unwrapHubEnvelope<{
      taskId?: string;
      id?: string;
      status?: TaskStatus;
    }>(res.data);
    const id = raw.id ?? raw.taskId;
    if (!id) throw new Error("createTask: missing task id in response");
    return {
      id,
      status: raw.status ?? "pending",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  },

  /** List tasks with optional filter/pagination params. */
  listTasks: async (params?: ListTasksParams): Promise<ListTasksResponse> => {
    const res = await http.get<unknown>("/v1/deep-research/tasks", {
      params,
    });
    return unwrapHubEnvelope<ListTasksResponse>(res.data);
  },

  /** Fetch a single task by id. */
  getTask: async (id: string): Promise<TaskWithReport> => {
    const res = await http.get<unknown>(
      `/v1/deep-research/tasks/${encodeURIComponent(id)}`,
    );
    return unwrapHubEnvelope<TaskWithReport>(res.data);
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
  const base = import.meta.env.VITE_API_BASE_URL ?? "";
  return fetch(
    `${base}/v1/deep-research/tasks/${encodeURIComponent(taskId)}/stream`,
    { headers, signal },
  );
}
