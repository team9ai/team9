import { memo } from "react";
import { TrackingEventItem } from "./TrackingEventItem";
import type { StreamingMessage } from "@/stores/useStreamingStore";
import type { AgentEventMetadata } from "@/types/im";

/**
 * Live thinking row rendered while a bot is streaming.
 *
 * Consumes `useStreamingStore`'s `StreamingMessage` and synthesizes the
 * `AgentEventMetadata` shape expected by `TrackingEventItem`, so the
 * in-flight row looks identical to the persisted "Thought for Xs" row
 * the user sees after thinking finishes. Brain icon pulses, duration
 * ticks up from 0s (via TrackingEventItem's own interval), and the
 * body expands to stream partial reasoning when the model surfaces it.
 *
 * Wrapper mirrors `MessageItem`'s agent-event wrapper (gray strip +
 * left border + the 9px padding that vertically centers the icon over
 * the avatar column). Keep these offsets in sync with MessageItem /
 * MessageList — they're what make the row line up with the rest of
 * the tracking strip once the round is persisted.
 */
interface StreamingThinkingRowProps {
  stream: StreamingMessage;
}

export const StreamingThinkingRow = memo(function StreamingThinkingRow({
  stream,
}: StreamingThinkingRowProps) {
  const metadata: AgentEventMetadata = {
    agentEventType: "thinking",
    status: "running",
    startedAt: new Date(stream.startedAt).toISOString(),
    thinking: stream.thinking,
  };

  return (
    <div
      className="ml-2 mr-4 mt-1 pt-1.5 pb-0.5 pr-4 border-l-2 border-border bg-muted/30 rounded-r-md"
      style={{ paddingLeft: "9px" }}
    >
      <TrackingEventItem
        metadata={metadata}
        content={stream.thinking}
        isStreaming
      />
    </div>
  );
});
