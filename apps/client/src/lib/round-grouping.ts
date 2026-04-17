/**
 * Round grouping utilities.
 *
 * A "round" is a contiguous sequence of agent event messages
 * (thinking / tool_call / tool_result / agent_start / agent_end / error / ...)
 * not broken by any non-agent-event message. Rounds are used by the message
 * list to auto-collapse older execution steps into a short summary
 * ("... 查看执行过程（N 步）") while keeping the most recent round expanded.
 *
 * This file is intentionally pure and UI-agnostic so it can be covered by
 * fast unit tests without pulling in React or the websocket layer.
 */

import type { AgentEventMetadata, Message } from "@/types/im";

/**
 * Set of all known agent event types. Kept in sync with
 * `AgentEventMetadata["agentEventType"]` in `@/types/im`.
 *
 * This is duplicated from `agent-event-metadata.ts` on purpose: the grouping
 * logic only needs to know "is this an agent event?", so we keep the
 * dependency graph minimal and avoid pulling the normalizer into this module.
 */
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

/**
 * Result item produced by `groupMessagesByRound`.
 *
 * - `type: "message"` — a regular (non agent-event) message rendered as-is
 * - `type: "round"`   — a collapsible group of consecutive agent events
 */
export type RoundGroupItem =
  | { type: "message"; message: Message }
  | {
      type: "round";
      /** ID of the first message in this round; used as a stable React key. */
      roundId: string;
      /** All messages that belong to this round, in original order. */
      messages: Message[];
      /**
       * True only for the trailing round — i.e. a round that is not
       * followed by any regular message. The UI keeps this round expanded
       * while collapsing older (non-latest) rounds.
       */
      isLatest: boolean;
      /**
       * Number of visible display rows for this round — drives the "N 步" /
       * "(N steps)" copy on the collapse summary so the count matches what
       * the user sees after expanding. This differs from `messages.length`
       * because MessageList applies two visibility-changing transformations
       * when rendering a round:
       *
       *   - `tool_result` whose matching `tool_call` is in the same round is
       *     absorbed into the combined ToolCallBlock card (not a separate
       *     row). Each such `tool_result` therefore contributes 0.
       *   - `turn_separator` renders as `null` in TrackingEventItem, so it
       *     is never shown to the user and contributes 0.
       *
       * Unpaired tool events (a `tool_result` without a matching `tool_call`
       * in the same round, or a `tool_call` without a matching result) still
       * render as their own row and contribute 1.
       */
      stepCount: number;
    };

/**
 * Returns true when `message` should be treated as an agent execution step.
 *
 * The check inspects `message.metadata.agentEventType` and verifies that it
 * is one of the known agent event types. Anything else (text reply, system
 * notice, file attachment, malformed metadata, etc.) is considered a regular
 * message that should break a round.
 */
function isAgentEventMessage(message: Message): boolean {
  const metadata = message.metadata;
  if (metadata === null || typeof metadata !== "object") {
    return false;
  }
  const agentEventType = (metadata as Record<string, unknown>).agentEventType;
  if (typeof agentEventType !== "string") {
    return false;
  }
  return AGENT_EVENT_TYPES.has(
    agentEventType as AgentEventMetadata["agentEventType"],
  );
}

/**
 * Count the visible display rows a round will produce when expanded.
 *
 * Mirrors the visibility rules applied by `MessageList` when it renders
 * agent-event messages, so the count shown on a folded round's summary
 * matches the number of rows that will appear after the user expands it.
 * See the `stepCount` docstring on `RoundGroupItem` for the full rules.
 */
function countVisibleSteps(roundMessages: Message[]): number {
  const toolCallIds = new Set<string>();
  for (const message of roundMessages) {
    const metadata = message.metadata;
    if (metadata === null || typeof metadata !== "object") continue;
    const record = metadata as Record<string, unknown>;
    if (
      record.agentEventType === "tool_call" &&
      typeof record.toolCallId === "string" &&
      record.toolCallId
    ) {
      toolCallIds.add(record.toolCallId);
    }
  }

  let count = 0;
  for (const message of roundMessages) {
    const metadata = message.metadata;
    if (metadata === null || typeof metadata !== "object") continue;
    const record = metadata as Record<string, unknown>;
    const eventType = record.agentEventType;
    if (eventType === "turn_separator") continue;
    if (
      eventType === "tool_result" &&
      typeof record.toolCallId === "string" &&
      toolCallIds.has(record.toolCallId)
    ) {
      continue;
    }
    count += 1;
  }
  return count;
}

/**
 * Group a chronologically-ordered message list into rounds.
 *
 * Algorithm:
 *   1. Iterate messages in order.
 *   2. Keep a `currentRound` buffer for consecutive agent events.
 *   3. On a non agent-event message, flush the buffer as a round item
 *      (with `isLatest = false`) and push the message item.
 *   4. After the loop, if the buffer is non-empty, flush it with
 *      `isLatest = true` — nothing came after it, so it's the trailing round.
 *
 * Pure function: does not mutate `messages`; re-calling with the same input
 * returns an equivalent output.
 */
export function groupMessagesByRound(messages: Message[]): RoundGroupItem[] {
  const result: RoundGroupItem[] = [];
  let currentRound: Message[] | null = null;

  const flushRound = (isLatest: boolean) => {
    if (currentRound && currentRound.length > 0) {
      const roundMessages = currentRound;
      result.push({
        type: "round",
        roundId: roundMessages[0].id,
        messages: roundMessages,
        isLatest,
        stepCount: countVisibleSteps(roundMessages),
      });
    }
    currentRound = null;
  };

  for (const message of messages) {
    if (isAgentEventMessage(message)) {
      if (currentRound === null) {
        currentRound = [message];
      } else {
        currentRound.push(message);
      }
    } else {
      flushRound(false);
      result.push({ type: "message", message });
    }
  }

  flushRound(true);

  return result;
}
