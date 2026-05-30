import { memo } from "react";
import { AgentStreamView } from "@team9claw/stream-display-ui";
import { StreamingMessageItem } from "./StreamingMessageItem";
import { StreamingThinkingRow } from "./StreamingThinkingRow";
import {
  buildTeam9StreamDisplayItems,
  type Team9ThinkingItemData,
} from "./streaming-display-adapter";
import type { StreamingMessage } from "@/stores/useStreamingStore";
import type { ChannelMember } from "@/types/im";

interface StreamingMessagePartsProps {
  stream: StreamingMessage;
  members: ChannelMember[];
}

export const StreamingMessageParts = memo(function StreamingMessageParts({
  stream,
  members,
}: StreamingMessagePartsProps) {
  const displayItems = buildTeam9StreamDisplayItems(stream);

  if (displayItems.length === 0) return null;

  return (
    <AgentStreamView
      items={displayItems}
      collapsed={{}}
      controls={{
        setCollapsed: () => undefined,
        toggleCollapsed: () => undefined,
      }}
      renderAgentMessage={(item) => (
        <StreamingMessageItem
          stream={item.data as unknown as StreamingMessage}
          members={members}
        />
      )}
      renderThinking={(item) => {
        const data = item.data as Team9ThinkingItemData;
        return (
          <StreamingThinkingRow
            stream={data.stream}
            thinking={data.thinking}
            startedAt={data.startedAt}
            isLive={data.isLive}
            durationMs={data.durationMs}
          />
        );
      }}
    />
  );
});
