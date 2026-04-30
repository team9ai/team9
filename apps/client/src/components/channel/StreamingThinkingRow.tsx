import { memo, useRef } from "react";
import { TrackingEventItem } from "./TrackingEventItem";
import type { StreamingMessage } from "@/stores/useStreamingStore";
import type { AgentEventMetadata } from "@/types/im";

/**
 * Live thinking row rendered while a bot is streaming.
 *
 * The row surfaces two phases of the in-flight stream:
 *
 *  1. **Thinking phase** — stream is active but no text content has
 *     arrived yet. We render "Thinking Ns" with a pulsing Brain icon,
 *     where N ticks up from 0 via TrackingEventItem's own interval.
 *     Crucially we drive `isStreaming` off `!stream.content` rather
 *     than off `stream.isThinking`, because Claude's thinking deltas
 *     only reach the WebSocket when a reasoning block is finalized —
 *     so during the first several seconds there's no live chunk yet,
 *     but the bot *is* thinking and the row should already be visible.
 *
 *  2. **Reply phase** — text content has started streaming. We freeze
 *     the row into its completed state ("Thought for Ns") and stop
 *     pulsing. When the stream ends and the persisted thinking row
 *     takes over, it lands in the same slot (MessageList sorts by
 *     effective time) so there's no visible reshuffle.
 *
 * `durationMs` is computed from `stream.startedAt` so the completed
 * label shows an accurate elapsed even if the server sent no thinking
 * chunks at all — a common case for short responses where the LLM
 * doesn't emit a reasoning block.
 *
 * Wrapper mirrors `MessageItem`'s agent-event wrapper (gray strip +
 * left border + the 9px padding that vertically centers the icon over
 * the avatar column). Keep these offsets in sync with MessageItem /
 * MessageList — they're what make the row line up with the rest of
 * the tracking strip once the round is persisted.
 */
interface StreamingThinkingRowProps {
  stream: StreamingMessage;
  thinking?: string;
  startedAt?: number;
  isLive?: boolean;
  durationMs?: number;
}

export const StreamingThinkingRow = memo(function StreamingThinkingRow({
  stream,
  thinking,
  startedAt,
  isLive,
  durationMs,
}: StreamingThinkingRowProps) {
  const thinkingContent = thinking ?? stream.thinking;
  const thinkingStartedAt = startedAt ?? stream.startedAt;
  const hasContent = isLive === undefined ? stream.content.length > 0 : !isLive;
  const hasThinking = thinkingContent.length > 0;

  // Freeze the elapsed duration at the exact moment reply text first
  // arrives, instead of recomputing `Date.now() - startedAt` on every
  // render. Without this the "Thought for Ns" label kept climbing for
  // the entire duration of text streaming — the component re-renders
  // on every content delta, so a re-read of `Date.now()` each render
  // made the counter tick up through the reply phase and only "stop"
  // when the stream ended and the persisted row took over.
  const frozenDurationMsRef = useRef<number | null>(null);
  if (hasContent && frozenDurationMsRef.current === null) {
    frozenDurationMsRef.current =
      durationMs ?? Math.max(0, Date.now() - thinkingStartedAt);
  }

  // Once the reply text has started arriving, only keep the row around
  // if thinking actually happened. Bots that skip thinking entirely —
  // short replies, small models, or any agent that doesn't engage the
  // extended-thinking feature — should NOT get a phantom
  // "Thought for 0s" row just because a StreamingMessage existed.
  // In that case we drop out so the reply bubble reads cleanly.
  if (hasContent && !hasThinking) {
    return null;
  }

  const startedAtIso = new Date(thinkingStartedAt).toISOString();

  // Freeze the row into its completed state once the reply text starts
  // streaming — thinking is definitely done by then, so show
  // "Thought for Ns" with a frozen duration rather than a still-pulsing
  // live row. The `durationMs` is captured once (see the ref above) so
  // we report an accurate elapsed even if the server never pushed any
  // live thinking chunks (Claude only flushes reasoning deltas at
  // block-finalization time).
  const metadata: AgentEventMetadata = hasContent
    ? {
        agentEventType: "thinking",
        status: "completed",
        thinking: thinkingContent,
        durationMs: frozenDurationMsRef.current ?? 0,
      }
    : {
        agentEventType: "thinking",
        status: "running",
        startedAt: startedAtIso,
        thinking: thinkingContent,
      };

  return (
    <div
      className="ml-2 mr-4 mt-1 pt-1.5 pb-0.5 pr-4 border-l-2 border-border bg-muted/30 rounded-r-md"
      style={{ paddingLeft: "9px" }}
    >
      <TrackingEventItem
        metadata={metadata}
        content={thinkingContent}
        isStreaming={!hasContent}
      />
    </div>
  );
});
