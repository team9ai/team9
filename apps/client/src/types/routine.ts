// Routines Module Types — matching backend schemas in libs/database/src/schemas/routine/

// ── Enum types (string unions) ──────────────────────────────────────

export type RoutineStatus =
  | "draft"
  | "upcoming"
  | "in_progress"
  | "paused"
  | "pending_action"
  | "completed"
  | "failed"
  | "stopped"
  | "timeout";

export type RoutineScheduleType = "once" | "recurring";

export type RoutineStepStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed";

export type RoutineInterventionStatus = "pending" | "resolved" | "expired";

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

export interface Routine {
  id: string;
  tenantId: string;
  botId: string | null;
  creatorId: string;
  title: string;
  description: string | null;
  status: RoutineStatus;
  /** @deprecated Use triggers table instead */
  scheduleType: RoutineScheduleType;
  /** @deprecated Use triggers table instead */
  scheduleConfig: ScheduleConfig | null;
  /** @deprecated Use triggers table instead */
  nextRunAt: string | null;
  version: number;
  documentId: string | null;
  currentExecutionId: string | null;
  /** Token usage from the current execution (included in list responses) */
  tokenUsage?: number;
  creationChannelId: string | null;
  creationSessionId: string | null;
  sourceRef: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoutineExecution {
  id: string;
  routineId: string;
  routineVersion: number;
  status: RoutineStatus;
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
export interface RoutineExecutionDetail extends RoutineExecution {
  steps: RoutineStep[];
  interventions: RoutineIntervention[];
  deliverables: RoutineDeliverable[];
}

// ── Unified execution entry (timeline) ─────────────────────────────

export interface StatusChangeData {
  status: string;
  at: string;
}

export type ExecutionEntry =
  | { type: "step"; data: RoutineStep }
  | { type: "intervention"; data: RoutineIntervention }
  | { type: "deliverable"; data: RoutineDeliverable }
  | { type: "status_change"; data: StatusChangeData };

// ── Entity interfaces (continued) ──────────────────────────────────

export interface RoutineStep {
  id: string;
  executionId: string;
  routineId: string;
  orderIndex: number;
  title: string;
  status: RoutineStepStatus;
  tokenUsage: number;
  duration: number | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface RoutineDeliverable {
  id: string;
  executionId: string;
  routineId: string;
  fileName: string;
  fileSize: number | null;
  mimeType: string | null;
  fileUrl: string;
  createdAt: string;
}

export interface RoutineIntervention {
  id: string;
  executionId: string;
  routineId: string;
  stepId: string | null;
  prompt: string;
  actions: InterventionAction[];
  response: InterventionResponse | null;
  status: RoutineInterventionStatus;
  resolvedBy: string | null;
  resolvedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

// ── Detail type (getById response) ──────────────────────────────────

export interface RoutineDetail extends Routine {
  currentExecution: {
    execution: RoutineExecution;
    steps: RoutineStep[];
    interventions: RoutineIntervention[];
    deliverables: RoutineDeliverable[];
  } | null;
}

// ── DTO types for mutations ─────────────────────────────────────────

export interface CreateRoutineDto {
  title: string;
  botId?: string;
  description?: string;
  /** @deprecated Use triggers field instead */
  scheduleType?: RoutineScheduleType;
  /** @deprecated Use triggers field instead */
  scheduleConfig?: ScheduleConfig;
  documentContent?: string;
  triggers?: CreateTriggerDto[];
}

export interface UpdateRoutineDto {
  title?: string;
  botId?: string | null;
  description?: string;
  /** @deprecated Use trigger CRUD API instead */
  scheduleType?: RoutineScheduleType;
  /** @deprecated Use trigger CRUD API instead */
  scheduleConfig?: ScheduleConfig;
}

export interface ResolveInterventionDto {
  action: string;
  message?: string;
}

// ── Trigger types ──────────────────────────────────────────────────

export type RoutineTriggerType =
  | "manual"
  | "interval"
  | "schedule"
  | "channel_message";

export interface RoutineTrigger {
  id: string;
  routineId: string;
  type: RoutineTriggerType;
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
  type: RoutineTriggerType;
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
