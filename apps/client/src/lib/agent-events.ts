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
 * Effective timeline position for a message.
 *
 * Regular messages (text, files, system, …) use `createdAt`. Agent events
 * whose metadata carries `startedAt` use that instead — this matters for
 * thinking events in particular: the server persists the thinking row when
 * the model *finishes* thinking, so its `createdAt` lands *after* the text
 * reply streamed alongside. Sorting by `startedAt` moves the row back to
 * where thinking actually began (typically the top of its round) so
 * "Thought for 4s" reads in chronological order, not chronologically last.
 *
 * Returns milliseconds since epoch. Falls back to `createdAt` when
 * `startedAt` is missing or unparseable.
 */
export function getEffectiveTimeMs(message: Message): number {
  const meta = getAgentMeta(message);
  if (meta?.startedAt) {
    const ts = new Date(meta.startedAt).getTime();
    if (!Number.isNaN(ts)) return ts;
  }
  return new Date(message.createdAt).getTime();
}

/**
 * Sort messages by effective time ascending (chronological).
 *
 * The sort is stable on the input order so messages with identical
 * effective times keep their server-supplied sequence — important for
 * same-millisecond tool_call/tool_result pairs that rely on arrival order.
 *
 * One extra rule layered on top of plain effective-time sort: a thinking
 * event's clamped effective time is `max(startedAt, preceding agent_start
 * createdAt)`. Without this clamp, thinking could sort *above* its own
 * round's agent_start — that happens when the model starts its LLM call
 * faster than the tracking observer persists `agent_start`, so the
 * server-side createdAt of `agent_start` ends up a few ms *after* the
 * thinking's true startedAt. Clamping keeps lifecycle markers as round
 * boundaries the way users expect: "Started" always comes first, then
 * "Thinking"/"Thought for Xs".
 *
 * Input is expected to already be in ascending `createdAt` order (this is
 * what MessageList produces after reversing the server's DESC list), so
 * walking forward once is enough to know the current round's agent_start.
 */
export function sortByEffectiveTime(messages: Message[]): Message[] {
  let lastAgentStartMs = Number.NEGATIVE_INFINITY;
  const effective = messages.map((m) => {
    const meta = getAgentMeta(m);
    const createdAtMs = new Date(m.createdAt).getTime();

    if (meta?.agentEventType === "agent_start") {
      lastAgentStartMs = createdAtMs;
      return createdAtMs;
    }

    if (meta?.startedAt) {
      const started = new Date(meta.startedAt).getTime();
      if (!Number.isNaN(started)) {
        // Never let an agent event drift above its round's start marker.
        return Math.max(started, lastAgentStartMs);
      }
    }
    return createdAtMs;
  });

  return messages
    .map((m, i) => ({ m, i, t: effective[i] }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map(({ m }) => m);
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
