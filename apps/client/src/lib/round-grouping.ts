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
      /** Convenience alias for `messages.length` — used to render "N 步". */
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
        stepCount: roundMessages.length,
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
