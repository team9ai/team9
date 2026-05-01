import type { AgentEventMetadata, ChannelSnapshot } from "@/types/im";

const AGENT_EVENT_TYPES = new Set<AgentEventMetadata["agentEventType"]>([
  "thinking",
  "writing",
  "tool_call",
  "tool_result",
  "agent_start",
  "agent_end",
  "error",
  "turn_separator",
  "a2ui_surface_update",
  "a2ui_response",
]);

const AGENT_EVENT_STATUSES = new Set<AgentEventMetadata["status"]>([
  "running",
  "completed",
  "failed",
  "resolved",
  "timeout",
  "cancelled",
]);

/** Validate and normalize selections — ensure each entry has selected: string[] */
function normalizeSelections(
  raw: Record<string, unknown>,
): Record<string, { selected: string[]; otherText: string | null }> {
  const result: Record<
    string,
    { selected: string[]; otherText: string | null }
  > = {};
  for (const [key, val] of Object.entries(raw)) {
    if (typeof val === "object" && val !== null) {
      const entry = val as Record<string, unknown>;
      result[key] = {
        selected: Array.isArray(entry.selected)
          ? entry.selected.filter((v): v is string => typeof v === "string")
          : [],
        otherText: typeof entry.otherText === "string" ? entry.otherText : null,
      };
    }
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAgentEventType(
  value: unknown,
): value is AgentEventMetadata["agentEventType"] {
  return (
    typeof value === "string" &&
    AGENT_EVENT_TYPES.has(value as AgentEventMetadata["agentEventType"])
  );
}

function isAgentEventStatus(
  value: unknown,
): value is AgentEventMetadata["status"] {
  return (
    typeof value === "string" &&
    AGENT_EVENT_STATUSES.has(value as AgentEventMetadata["status"])
  );
}

export function getAgentEventMetadata(
  value: unknown,
  fallback: AgentEventMetadata,
): AgentEventMetadata {
  return getOptionalAgentEventMetadata(value) ?? fallback;
}

export function getOptionalAgentEventMetadata(
  value: unknown,
): AgentEventMetadata | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const agentEventType = value.agentEventType;
  const status = value.status;

  if (!isAgentEventType(agentEventType) || !isAgentEventStatus(status)) {
    return undefined;
  }

  return {
    agentEventType,
    status,
    ...(typeof value.toolName === "string" ? { toolName: value.toolName } : {}),
    ...(typeof value.toolCallId === "string"
      ? { toolCallId: value.toolCallId }
      : {}),
    ...(isRecord(value.toolArgs) ? { toolArgs: value.toolArgs } : {}),
    ...(typeof value.toolArgsText === "string"
      ? { toolArgsText: value.toolArgsText }
      : {}),
    ...(value.toolPhase === "args_streaming" || value.toolPhase === "executing"
      ? { toolPhase: value.toolPhase }
      : {}),
    ...(typeof value.success === "boolean" ? { success: value.success } : {}),
    ...(typeof value.errorCode === "string"
      ? { errorCode: value.errorCode }
      : {}),
    ...(typeof value.errorMessage === "string"
      ? { errorMessage: value.errorMessage }
      : {}),
    ...(typeof value.resultTruncated === "boolean"
      ? { resultTruncated: value.resultTruncated }
      : {}),
    ...(typeof value.fullContentMessageId === "string"
      ? { fullContentMessageId: value.fullContentMessageId }
      : {}),
    ...(typeof value.completedAt === "string"
      ? { completedAt: value.completedAt }
      : {}),
    ...(typeof value.updatedAt === "string"
      ? { updatedAt: value.updatedAt }
      : {}),
    ...(typeof value.surfaceId === "string"
      ? { surfaceId: value.surfaceId }
      : {}),
    ...(Array.isArray(value.payload) ? { payload: value.payload } : {}),
    ...(isRecord(value.surfaceMetadata)
      ? { surfaceMetadata: value.surfaceMetadata }
      : {}),
    ...(isRecord(value.selections)
      ? {
          selections: normalizeSelections(
            value.selections as Record<string, unknown>,
          ),
        }
      : {}),
    ...(typeof value.responderId === "string"
      ? { responderId: value.responderId }
      : {}),
    ...(typeof value.responderName === "string"
      ? { responderName: value.responderName }
      : {}),
    // === Thinking event fields ===
    ...(typeof value.thinking === "string" ? { thinking: value.thinking } : {}),
    ...(typeof value.inputTokens === "number" &&
    Number.isFinite(value.inputTokens)
      ? { inputTokens: value.inputTokens }
      : {}),
    ...(typeof value.outputTokens === "number" &&
    Number.isFinite(value.outputTokens)
      ? { outputTokens: value.outputTokens }
      : {}),
    ...(typeof value.totalTokens === "number" &&
    Number.isFinite(value.totalTokens)
      ? { totalTokens: value.totalTokens }
      : {}),
    ...(typeof value.durationMs === "number" &&
    Number.isFinite(value.durationMs)
      ? { durationMs: value.durationMs }
      : {}),
    ...(typeof value.startedAt === "string"
      ? { startedAt: value.startedAt }
      : {}),
  };
}

type RawTrackingSnapshot = {
  totalMessageCount: number;
  latestMessages: Array<{
    id: string;
    content: string;
    metadata?: unknown;
    createdAt: string;
  }>;
};

export function normalizeTrackingSnapshot(
  snapshot: RawTrackingSnapshot,
): ChannelSnapshot {
  return {
    totalMessageCount: snapshot.totalMessageCount,
    latestMessages: snapshot.latestMessages.flatMap((message) => {
      const metadata = getOptionalAgentEventMetadata(message.metadata);
      return metadata && metadata.agentEventType !== "writing"
        ? [{ ...message, metadata }]
        : [];
    }),
  };
}
