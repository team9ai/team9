// Tasks Module Types — matching backend schemas in libs/database/src/schemas/task/

// ── Enum types (string unions) ──────────────────────────────────────

export type AgentTaskStatus =
  | "upcoming"
  | "in_progress"
  | "paused"
  | "pending_action"
  | "completed"
  | "failed"
  | "stopped"
  | "timeout";

export type AgentTaskScheduleType = "once" | "recurring";

export type AgentTaskStepStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed";

export type AgentTaskInterventionStatus = "pending" | "resolved" | "expired";

// ── Supporting types ────────────────────────────────────────────────

export interface ScheduleConfig {
  frequency?: string;
  time?: string;
  timezone?: string;
  dayOfWeek?: number;
  dayOfMonth?: number;
  cron?: string;
}

export interface ExecutionError {
  code?: string;
  message: string;
  details?: unknown;
}

export interface InterventionAction {
  label: string;
  value: string;
}

export interface InterventionResponse {
  action: string;
  message?: string;
}

// ── Entity interfaces ───────────────────────────────────────────────

export interface AgentTask {
  id: string;
  tenantId: string;
  botId: string | null;
  creatorId: string;
  title: string;
  description: string | null;
  status: AgentTaskStatus;
  /** @deprecated Use triggers table instead */
  scheduleType: AgentTaskScheduleType;
  /** @deprecated Use triggers table instead */
  scheduleConfig: ScheduleConfig | null;
  /** @deprecated Use triggers table instead */
  nextRunAt: string | null;
  documentId: string | null;
  currentExecutionId: string | null;
  /** Token usage from the current execution (included in list responses) */
  tokenUsage?: number;
  createdAt: string;
  updatedAt: string;
}

export interface AgentTaskExecution {
  id: string;
  taskId: string;
  version: number;
  status: AgentTaskStatus;
  channelId: string | null;
  taskcastTaskId: string | null;
  tokenUsage: number;
  triggerId: string | null;
  triggerType: string | null;
  triggerContext: TriggerContext | null;
  documentVersionId: string | null;
  sourceExecutionId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  duration: number | null;
  error: ExecutionError | null;
  createdAt: string;
}

/** Execution with nested steps, interventions, and deliverables (getExecution response) */
export interface AgentTaskExecutionDetail extends AgentTaskExecution {
  steps: AgentTaskStep[];
  interventions: AgentTaskIntervention[];
  deliverables: AgentTaskDeliverable[];
}

export interface AgentTaskStep {
  id: string;
  executionId: string;
  taskId: string;
  orderIndex: number;
  title: string;
  status: AgentTaskStepStatus;
  tokenUsage: number;
  duration: number | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface AgentTaskDeliverable {
  id: string;
  executionId: string;
  taskId: string;
  fileName: string;
  fileSize: number | null;
  mimeType: string | null;
  fileUrl: string;
  createdAt: string;
}

export interface AgentTaskIntervention {
  id: string;
  executionId: string;
  taskId: string;
  stepId: string | null;
  prompt: string;
  actions: InterventionAction[];
  response: InterventionResponse | null;
  status: AgentTaskInterventionStatus;
  resolvedBy: string | null;
  resolvedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

// ── Detail type (getById response) ──────────────────────────────────

export interface AgentTaskDetail extends AgentTask {
  currentExecution: {
    execution: AgentTaskExecution;
    steps: AgentTaskStep[];
    interventions: AgentTaskIntervention[];
    deliverables: AgentTaskDeliverable[];
  } | null;
}

// ── DTO types for mutations ─────────────────────────────────────────

export interface CreateTaskDto {
  title: string;
  botId?: string;
  description?: string;
  /** @deprecated Use triggers field instead */
  scheduleType?: AgentTaskScheduleType;
  /** @deprecated Use triggers field instead */
  scheduleConfig?: ScheduleConfig;
  documentContent?: string;
  triggers?: CreateTriggerDto[];
}

export interface UpdateTaskDto {
  title?: string;
  botId?: string | null;
  description?: string;
  /** @deprecated Use trigger CRUD API instead */
  scheduleType?: AgentTaskScheduleType;
  /** @deprecated Use trigger CRUD API instead */
  scheduleConfig?: ScheduleConfig;
}

export interface ResolveInterventionDto {
  action: string;
  message?: string;
}

// ── Trigger types ──────────────────────────────────────────────────

export type AgentTaskTriggerType =
  | "manual"
  | "interval"
  | "schedule"
  | "channel_message";

export interface AgentTaskTrigger {
  id: string;
  taskId: string;
  type: AgentTaskTriggerType;
  config: Record<string, unknown> | null;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Trigger context types ──────────────────────────────────────────

export interface ManualTriggerContext {
  triggeredAt: string;
  triggeredBy: string;
  notes?: string;
}

export interface ScheduleTriggerContext {
  triggeredAt: string;
  scheduledAt: string;
}

export interface ChannelMessageTriggerContext {
  triggeredAt: string;
  channelId: string;
  messageId: string;
  messageContent?: string;
  senderId: string;
}

export interface RetryTriggerContext {
  triggeredAt: string;
  triggeredBy: string;
  notes?: string;
  originalExecutionId: string;
  originalFailReason?: string;
}

export type TriggerContext =
  | ManualTriggerContext
  | ScheduleTriggerContext
  | ChannelMessageTriggerContext
  | RetryTriggerContext;

// ── Trigger DTOs ───────────────────────────────────────────────────

export interface CreateTriggerDto {
  type: AgentTaskTriggerType;
  config?: Record<string, unknown>;
  enabled?: boolean;
}

export interface UpdateTriggerDto {
  config?: Record<string, unknown>;
  enabled?: boolean;
}

export interface RetryExecutionDto {
  executionId: string;
  notes?: string;
}
