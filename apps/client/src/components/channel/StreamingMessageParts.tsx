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
  const hasTextContent =
    stream.content.length > 0 ||
    stream.parts.some(
      (part) => part.type === "content" && part.content.length > 0,
    );

  if (stream.parts.length === 0) {
    return (
      <>
        <StreamingThinkingRow stream={stream} />
        {stream.content.trim().length > 0 && (
          <StreamingMessageItem stream={stream} members={members} />
        )}
      </>
    );
  }

  return (
    <>
      {stream.parts.map((part) => {
        if (part.type === "thinking") {
          if (!part.isStreaming && !hasTextContent) {
            return null;
          }

          return (
            <StreamingThinkingRow
              key={part.id}
              stream={stream}
              thinking={part.content}
              startedAt={part.startedAt}
              isLive={part.isStreaming}
              durationMs={part.durationMs}
            />
          );
        }

        return (
          <StreamingMessageItem
            key={part.id}
            stream={streamForContentPart(stream, part)}
            members={members}
          />
        );
      })}
    </>
  );
});
