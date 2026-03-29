import type { Message, AgentEventMetadata } from "@/types/im";

/** Extract agent event metadata from a message, if present */
export function getAgentMeta(message: Message): AgentEventMetadata | undefined {
  const meta = message.metadata as Record<string, unknown> | undefined;
  if (meta && typeof meta.agentEventType === "string") {
    return meta as unknown as AgentEventMetadata;
  }
  return undefined;
}

/**
 * Reorder agent event messages so each tool_result appears immediately
 * after its corresponding tool_call (matched by toolCallId).
 * Messages without toolCallId or non-agent messages are unaffected.
 */
export function pairToolEvents(messages: Message[]): Message[] {
  const resultByCallId = new Map<string, Message>();
  const callIds = new Set<string>();

  for (const msg of messages) {
    const meta = msg.metadata as AgentEventMetadata | undefined;
    if (meta?.agentEventType === "tool_call" && meta.toolCallId) {
      callIds.add(meta.toolCallId);
    }
    if (meta?.agentEventType === "tool_result" && meta.toolCallId) {
      resultByCallId.set(meta.toolCallId, msg);
    }
  }

  // Find tool_results that can be paired (both call and result exist)
  const pairedResultIds = new Set<string>();
  for (const [callId, resultMsg] of resultByCallId) {
    if (callIds.has(callId)) {
      pairedResultIds.add(resultMsg.id);
    }
  }

  if (pairedResultIds.size === 0) return messages;

  const result: Message[] = [];
  for (const msg of messages) {
    const meta = msg.metadata as AgentEventMetadata | undefined;

    // Skip paired tool_results — they'll be inserted after their tool_call
    if (pairedResultIds.has(msg.id)) continue;

    result.push(msg);

    // After a tool_call, insert its matching tool_result
    if (meta?.agentEventType === "tool_call" && meta.toolCallId) {
      const matchingResult = resultByCallId.get(meta.toolCallId);
      if (matchingResult && pairedResultIds.has(matchingResult.id)) {
        result.push(matchingResult);
      }
    }
  }

  return result;
}
