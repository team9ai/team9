import { memo } from "react";
import { StreamingMessageItem } from "./StreamingMessageItem";
import { StreamingThinkingRow } from "./StreamingThinkingRow";
import type {
  StreamingMessage,
  StreamingPart,
} from "@/stores/useStreamingStore";
import type { ChannelMember } from "@/types/im";

interface StreamingMessagePartsProps {
  stream: StreamingMessage;
  members: ChannelMember[];
}

function streamForContentPart(
  stream: StreamingMessage,
  part: StreamingPart,
): StreamingMessage {
  return {
    ...stream,
    content: part.content,
    thinking: "",
    isThinking: false,
    isStreaming: part.isStreaming,
  };
}

export const StreamingMessageParts = memo(function StreamingMessageParts({
  stream,
  members,
}: StreamingMessagePartsProps) {
  if (stream.parts.length === 0) {
    return (
      <>
        <StreamingThinkingRow stream={stream} />
        <StreamingMessageItem stream={stream} members={members} />
      </>
    );
  }

  return (
    <>
      {stream.parts.map((part) =>
        part.type === "thinking" ? (
          <StreamingThinkingRow
            key={part.id}
            stream={stream}
            thinking={part.content}
            startedAt={part.startedAt}
            isLive={part.isStreaming}
            durationMs={part.durationMs}
          />
        ) : (
          <StreamingMessageItem
            key={part.id}
            stream={streamForContentPart(stream, part)}
            members={members}
          />
        ),
      )}
    </>
  );
});
