import http from "@/services/http";
import type { Message } from "@/types/im";

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

export interface StartDeepResearchInChannelInput {
  input: string;
  origin?: "dashboard" | "chat";
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

export interface StartDeepResearchInChannelResult {
  task: Task;
  message: Message;
}

interface RawTask {
  id?: string;
  taskId?: string;
  status?: TaskStatus;
  createdAt?: string;
  updatedAt?: string;
  startedAt?: string;
  completedAt?: string;
  prompt?: string | null;
  input?: unknown;
  finalReport?: { url?: string | null } | null;
  reportUrl?: string | null;
  error?: { code: string; message: string; details?: unknown } | null;
}

function extractPrompt(input: unknown): string | null {
  if (typeof input === "string") {
    return input;
  }

  if (Array.isArray(input)) {
    const textPart = input.find(
      (part) =>
        typeof part === "object" &&
        part !== null &&
        "text" in part &&
        typeof (part as { text?: unknown }).text === "string",
    ) as { text: string } | undefined;

    return textPart?.text ?? null;
  }

  return null;
}

function normalizeTask(raw: RawTask): TaskWithReport {
  const id = raw.id ?? raw.taskId;
  if (!id) {
    throw new Error("deep-research task is missing an id");
  }

  const createdAt = raw.createdAt ?? raw.startedAt ?? new Date().toISOString();
  const updatedAt =
    raw.updatedAt ?? raw.completedAt ?? raw.startedAt ?? createdAt;

  return {
    id,
    status: raw.status ?? "pending",
    createdAt,
    updatedAt,
    prompt: raw.prompt ?? extractPrompt(raw.input),
    reportUrl: raw.reportUrl ?? raw.finalReport?.url ?? null,
    error: raw.error ?? null,
  };
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

  /** Start deep research inside a specific chat channel. */
  startInChannel: async (
    channelId: string,
    body: StartDeepResearchInChannelInput,
  ): Promise<StartDeepResearchInChannelResult> => {
    const res = await http.post<unknown>(
      `/v1/im/channels/${encodeURIComponent(channelId)}/deep-research`,
      body,
    );
    const raw = unwrapHubEnvelope<{
      task: {
        id?: string;
        taskId?: string;
        status?: TaskStatus;
        createdAt?: string;
        updatedAt?: string;
      };
      message: Message;
    }>(res.data);

    return {
      task: normalizeTask(raw.task),
      message: raw.message,
    };
  },

  /** List tasks with optional filter/pagination params. */
  listTasks: async (params?: ListTasksParams): Promise<ListTasksResponse> => {
    const res = await http.get<unknown>("/v1/deep-research/tasks", {
      params,
    });
    const raw = unwrapHubEnvelope<ListTasksResponse>(res.data);
    return {
      ...raw,
      items: raw.items.map((item) => normalizeTask(item as RawTask)),
    };
  },

  /** Fetch a single task by id. */
  getTask: async (id: string): Promise<TaskWithReport> => {
    const res = await http.get<unknown>(
      `/v1/deep-research/tasks/${encodeURIComponent(id)}`,
    );
    return normalizeTask(unwrapHubEnvelope<RawTask>(res.data));
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
