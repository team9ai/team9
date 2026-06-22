import type { StreamDisplayItem } from "@team9claw/stream-display-core";
import type {
  StreamingMessage,
  StreamingPart,
} from "@/stores/useStreamingStore";

type AgentMessageItem = Extract<StreamDisplayItem, { kind: "agent-message" }>;

export interface Team9ThinkingItemData {
  stream: StreamingMessage;
  thinking?: string;
  startedAt?: number;
  isLive?: boolean;
  durationMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasDeepResearchMetadata(stream: StreamingMessage): boolean {
  return isRecord(stream.metadata?.deepResearch);
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

function agentItem(
  id: string,
  stream: StreamingMessage,
  timestamp = stream.startedAt,
): StreamDisplayItem {
  return {
    kind: "agent-message",
    id,
    turnId: stream.streamId,
    timestamp,
    data: stream as unknown as AgentMessageItem["data"],
  };
}

function thinkingItem(
  id: string,
  data: Team9ThinkingItemData,
  timestamp = data.startedAt ?? data.stream.startedAt,
): StreamDisplayItem {
  return {
    kind: "thinking",
    id,
    turnId: data.stream.streamId,
    timestamp,
    data,
  };
}

function shouldRenderWholeStreamThinkingRow(stream: StreamingMessage): boolean {
  const hasThinking = stream.thinking.length > 0;
  const hasContent =
    stream.content.length > 0 || (hasThinking && !stream.isThinking);

  return !(hasContent && !hasThinking);
}

export function buildTeam9StreamDisplayItems(
  stream: StreamingMessage,
): StreamDisplayItem[] {
  if (hasDeepResearchMetadata(stream)) {
    return [
      agentItem(`${stream.streamId}:deep-research`, {
        ...stream,
        thinking: "",
        isThinking: false,
      }),
    ];
  }

  const hasText =
    stream.content.length > 0 ||
    stream.parts.some(
      (part) => part.type === "content" && part.content.length > 0,
    );

  if (stream.parts.length === 0) {
    return [
      ...(shouldRenderWholeStreamThinkingRow(stream)
        ? [thinkingItem(`${stream.streamId}:thinking`, { stream })]
        : []),
      ...(stream.content.trim().length > 0
        ? [agentItem(`${stream.streamId}:content`, stream)]
        : []),
    ];
  }

  return stream.parts.flatMap((part) => {
    if (part.type === "thinking") {
      if (!part.isStreaming && (!hasText || part.content.length === 0)) {
        return [];
      }

      return [
        thinkingItem(
          part.id,
          {
            stream,
            thinking: part.content,
            startedAt: part.startedAt,
            isLive: part.isStreaming,
            durationMs: part.durationMs,
          },
          part.startedAt,
        ),
      ];
    }

    return [
      agentItem(part.id, streamForContentPart(stream, part), part.startedAt),
    ];
  });
}
