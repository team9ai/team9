export type TaskRunStatus =
  | "draft"
  | "upcoming"
  | "in_progress"
  | "paused"
  | "pending_action"
  | "completed"
  | "failed"
  | "stopped"
  | "timeout";

export interface TaskRun {
  id: string;
  tenantId: string;
  routineId: string | null;
  routineVersion: number | null;
  botId: string | null;
  creatorId: string;
  title: string;
  description: string | null;
  status: TaskRunStatus;
  channelId: string | null;
  taskcastTaskId: string | null;
  tokenUsage: number;
  startedAt: string | null;
  completedAt: string | null;
  duration: number | null;
  error: { code?: string; message: string; details?: unknown } | null;
  triggerId: string | null;
  triggerType: string | null;
  triggerContext: Record<string, unknown> | null;
  documentVersionId: string | null;
  sourceRunId: string | null;
  hiddenAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskDeliverable {
  id: string;
  runId: string;
  routineId: string | null;
  fileName: string;
  fileSize: number | null;
  mimeType: string | null;
  fileUrl: string;
  createdAt: string;
}

export interface TaskRunDetail extends TaskRun {
  deliverables: TaskDeliverable[];
}

export interface CreateTaskRunDto {
  title: string;
  description?: string;
  botId?: string;
}

export interface UpdateTaskRunDto {
  title?: string;
}
