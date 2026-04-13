/**
 * Pure helpers powering MessageList's round auto-fold behavior.
 *
 * `MessageList` virtualises a flat list of `ChannelListItem`s (single messages,
 * streaming items, thinking placeholders). To render a collapsed round summary
 * in place of N consecutive agent-event messages without restructuring the
 * virtualised data, we pre-compute two look-up maps from the chronological
 * message array:
 *
 *  - `roundStateMap`   — roundId → { isFolded, firstMessageId, stepCount }
 *  - `messageRoundMap` — messageId → roundId
 *
 * `itemContent` then checks, for each agent-event message, whether it belongs
 * to a folded round. If it does, the *first* message in that round is replaced
 * by `<RoundCollapseSummary />` and the rest become 1px-high placeholders.
 *
 * These helpers are intentionally UI-agnostic (no React, no JSX) so they can
 * be exhaustively unit tested without a DOM.
 */

import type { Message } from "@/types/im";
import { groupMessagesByRound } from "@/lib/round-grouping";

/** Per-round fold state keyed by roundId. */
export interface RoundFoldEntry {
  /** Whether this round should currently be rendered as a collapsed summary. */
  isFolded: boolean;
  /** The ID of the first message in the round — the one that carries the summary row. */
  firstMessageId: string;
  /** The number of agent-event messages in the round (drives "N 步"). */
  stepCount: number;
}

/**
 * Output of {@link computeRoundFoldMaps}.
 *
 * Both maps are empty for non-DM channels, which is the signal to callers to
 * skip all fold-related branching and render messages as-is.
 */
export interface RoundFoldMaps {
  /** roundId → fold state (only populated for non-latest rounds in DM channels). */
  roundStateMap: Map<string, RoundFoldEntry>;
  /** messageId → roundId (only populated for non-latest rounds in DM channels). */
  messageRoundMap: Map<string, string>;
}

export interface ComputeRoundFoldMapsInput {
  /** Channel type — folding only applies when this is "direct". */
  channelType: string | undefined;
  /** Chronologically-ordered messages (same as MessageList's `chronoMessages`). */
  chronoMessages: Message[];
  /**
   * IDs of rounds that the user has manually expanded. These rounds are
   * excluded from the `roundStateMap` so the caller renders their messages
   * normally even though they are not the latest round.
   */
  userExpandedRounds: ReadonlySet<string>;
}

/**
 * Build the fold look-up maps for a single render of MessageList.
 *
 * Rules:
 *   - Non-DM channels (`channelType !== "direct"`) return empty maps so callers
 *     skip fold logic entirely.
 *   - The trailing round (`isLatest = true`) is never folded — the user is
 *     actively watching the agent execute.
 *   - Rounds the user has manually expanded (`userExpandedRounds`) are also
 *     excluded from the maps, so their messages render normally.
 *   - All other rounds are emitted with `isFolded: true`.
 */
export function computeRoundFoldMaps({
  channelType,
  chronoMessages,
  userExpandedRounds,
}: ComputeRoundFoldMapsInput): RoundFoldMaps {
  const roundStateMap = new Map<string, RoundFoldEntry>();
  const messageRoundMap = new Map<string, string>();

  if (channelType !== "direct") {
    return { roundStateMap, messageRoundMap };
  }

  const items = groupMessagesByRound(chronoMessages);
  for (const item of items) {
    if (item.type !== "round") continue;
    if (item.isLatest) continue;
    if (userExpandedRounds.has(item.roundId)) continue;

    roundStateMap.set(item.roundId, {
      isFolded: true,
      firstMessageId: item.messages[0].id,
      stepCount: item.stepCount,
    });
    for (const msg of item.messages) {
      messageRoundMap.set(msg.id, item.roundId);
    }
  }

  return { roundStateMap, messageRoundMap };
}

/**
 * Resolve the fold rendering decision for a single message.
 *
 * Returns one of:
 *  - `{ kind: "none" }`    — message is not inside a folded round, render it normally.
 *  - `{ kind: "summary" }` — this is the first message of a folded round; render the summary row.
 *  - `{ kind: "hidden" }`  — this message is inside a folded round but not the first one; render a placeholder.
 */
export type RoundRenderDecision =
  | { kind: "none" }
  | { kind: "summary"; roundId: string; stepCount: number }
  | { kind: "hidden"; roundId: string };

/**
 * Pure state reducer for the `userExpandedRounds` set.
 *
 * Given the current set and a roundId, returns a NEW set with that roundId
 * either added (if absent) or removed (if present). Kept in its own function
 * so the branch logic can be unit-tested in isolation — the production UI
 * only exposes the "expand" direction today because clicking a summary
 * removes the summary from the DOM.
 */
export function toggleExpandedRound(
  current: ReadonlySet<string>,
  roundId: string,
): Set<string> {
  const next = new Set(current);
  if (next.has(roundId)) {
    next.delete(roundId);
  } else {
    next.add(roundId);
  }
  return next;
}

export function decideRoundRender(
  messageId: string,
  maps: RoundFoldMaps,
): RoundRenderDecision {
  const roundId = maps.messageRoundMap.get(messageId);
  if (!roundId) return { kind: "none" };

  const state = maps.roundStateMap.get(roundId);
  if (!state || !state.isFolded) return { kind: "none" };

  if (state.firstMessageId === messageId) {
    return { kind: "summary", roundId, stepCount: state.stepCount };
  }
  return { kind: "hidden", roundId };
}
