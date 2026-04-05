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
  if (!isRecord(value)) {
    return fallback;
  }

  const agentEventType = value.agentEventType;
  const status = value.status;

  if (!isAgentEventType(agentEventType) || !isAgentEventStatus(status)) {
    return fallback;
  }

  return {
    agentEventType,
    status,
    ...(typeof value.toolName === "string" ? { toolName: value.toolName } : {}),
    ...(typeof value.toolCallId === "string"
      ? { toolCallId: value.toolCallId }
      : {}),
    ...(isRecord(value.toolArgs) ? { toolArgs: value.toolArgs } : {}),
    ...(typeof value.success === "boolean" ? { success: value.success } : {}),
    ...(typeof value.surfaceId === "string"
      ? { surfaceId: value.surfaceId }
      : {}),
    ...(Array.isArray(value.payload) ? { payload: value.payload } : {}),
    ...(isRecord(value.surfaceMetadata)
      ? { surfaceMetadata: value.surfaceMetadata }
      : {}),
    ...(isRecord(value.selections)
      ? {
          selections: value.selections as Record<
            string,
            { selected: string[]; otherText: string | null }
          >,
        }
      : {}),
    ...(typeof value.responderId === "string"
      ? { responderId: value.responderId }
      : {}),
    ...(typeof value.responderName === "string"
      ? { responderName: value.responderName }
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
    latestMessages: snapshot.latestMessages.map((message) => ({
      ...message,
      metadata: getAgentEventMetadata(message.metadata, {
        agentEventType: "writing",
        status: "completed",
      }),
    })),
  };
}
