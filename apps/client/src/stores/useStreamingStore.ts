import { create } from "zustand";
import {
  clearPersistedStreamMetadata,
  loadPersistedStreamMetadata,
  mergeStreamingMetadata,
  persistStreamMetadata,
} from "@/lib/streaming-metadata";
import type { ActiveStreamingMessage } from "@/types/im";

export interface StreamingMessage {
  streamId: string;
  channelId: string;
  senderId: string;
  parentId?: string;
  /** Accumulated text content */
  content: string;
  /** Accumulated thinking content */
  thinking: string;
  /** Whether thinking content is currently being streamed */
  isThinking: boolean;
  /** Whether the stream is still active */
  isStreaming: boolean;
  /** Timestamp when streaming started */
  startedAt: number;
  /** Ordered thinking/text parts as they arrive within this response */
  parts: StreamingPart[];
  /** Optional agent-event metadata from streaming_start */
  metadata?: Record<string, unknown>;
}

export interface StreamingPart {
  id: string;
  type: "thinking" | "content";
  content: string;
  startedAt: number;
  isStreaming: boolean;
  durationMs?: number;
}

interface StreamingState {
  /** Active streaming messages indexed by streamId */
  streams: Map<string, StreamingMessage>;

  /** Start a new stream */
  startStream: (event: {
    streamId: string;
    channelId: string;
    senderId: string;
    parentId?: string;
    startedAt: number;
    metadata?: Record<string, unknown>;
  }) => void;

  /** Restore a stream snapshot fetched from the gateway */
  restoreStream: (event: ActiveStreamingMessage) => void;

  /** Set the current accumulated text content for a stream */
  setStreamContent: (streamId: string, content: string) => void;

  /** Set the current accumulated thinking content for a stream */
  setThinkingContent: (streamId: string, content: string) => void;

  /** Merge transient stream metadata, e.g. tool_call args streaming */
  setStreamMetadata: (
    streamId: string,
    metadata: Record<string, unknown>,
  ) => void;

  /** End a stream (remove from active) */
  endStream: (streamId: string) => void;

  /** Abort a stream */
  abortStream: (streamId: string) => void;

  /** Get active streams for a channel */
  getChannelStreams: (channelId: string) => StreamingMessage[];
}

// Auto-cleanup timeout for ordinary stale streams.
const STREAM_TIMEOUT_MS = 120_000;
// Deep research can legitimately run for many minutes with sparse upstream
// deltas. Keep its local placeholder alive longer than the backend worker cap
// so the UI does not disappear while the task is still running.
const LONG_RUNNING_STREAM_TIMEOUT_MS = 90 * 60_000;
const streamTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasLongRunningMetadata(
  metadata: Record<string, unknown> | undefined,
): boolean {
  return metadata?.longRunning === true || isRecord(metadata?.deepResearch);
}

function resolveStreamTimeoutMs(
  stream: StreamingMessage | undefined,
  incomingMetadata?: Record<string, unknown>,
): number {
  return hasLongRunningMetadata(incomingMetadata) ||
    hasLongRunningMetadata(stream?.metadata)
    ? LONG_RUNNING_STREAM_TIMEOUT_MS
    : STREAM_TIMEOUT_MS;
}

function clearStreamTimeout(streamId: string): void {
  const timeout = streamTimeouts.get(streamId);
  if (!timeout) return;
  clearTimeout(timeout);
  streamTimeouts.delete(streamId);
}

function refreshStreamTimeout(
  streamId: string,
  get: () => StreamingState,
  allowMissing = false,
  incomingMetadata?: Record<string, unknown>,
): void {
  const stream = get().streams.get(streamId);
  if (!allowMissing && !stream) {
    return;
  }
  clearStreamTimeout(streamId);
  const timeout = setTimeout(
    () => {
      const stream = get().streams.get(streamId);
      if (stream?.isStreaming) {
        get().abortStream(streamId);
      }
      streamTimeouts.delete(streamId);
    },
    resolveStreamTimeoutMs(stream, incomingMetadata),
  );
  streamTimeouts.set(streamId, timeout);
}

function closeActiveParts(
  parts: StreamingPart[],
  activeType: StreamingPart["type"],
  now: number,
): StreamingPart[] {
  return parts.map((part) => {
    if (!part.isStreaming || part.type === activeType) return part;
    return {
      ...part,
      isStreaming: false,
      durationMs: Math.max(0, now - part.startedAt),
    };
  });
}

function closeAllActiveParts(
  parts: StreamingPart[],
  now: number,
): StreamingPart[] {
  return parts.map((part) => {
    if (!part.isStreaming) return part;
    return {
      ...part,
      isStreaming: false,
      durationMs: Math.max(0, now - part.startedAt),
    };
  });
}

function aggregateParts(
  parts: StreamingPart[],
  type: StreamingPart["type"],
): string {
  return parts
    .filter((part) => part.type === type)
    .map((part) => part.content)
    .join("");
}

function preferAccumulatedContent(existing: string, incoming: string): string {
  if (!incoming) return existing;
  if (!existing) return incoming;
  if (incoming.startsWith(existing)) return incoming;
  if (existing.startsWith(incoming)) return existing;
  return incoming.length >= existing.length ? incoming : existing;
}

function buildRestoredParts(
  streamId: string,
  startedAt: number,
  thinking: string,
  content: string,
): StreamingPart[] {
  const parts: StreamingPart[] = [];
  if (thinking) {
    parts.push({
      id: `${streamId}-restore-thinking`,
      type: "thinking",
      content: thinking,
      startedAt,
      isStreaming: !content,
    });
  }
  if (content) {
    parts.push({
      id: `${streamId}-restore-content`,
      type: "content",
      content,
      startedAt,
      isStreaming: true,
    });
  }
  return parts;
}

function isToolCallMetadata(metadata: Record<string, unknown> | undefined) {
  return metadata?.agentEventType === "tool_call";
}

function updateStreamingParts(
  stream: StreamingMessage,
  type: StreamingPart["type"],
  incomingContent: string,
  previousAggregate: string,
): StreamingPart[] {
  const now = Date.now();
  const parts = closeActiveParts(stream.parts, type, now);
  const lastPart = parts[parts.length - 1];
  const isAggregateDelta = incomingContent.startsWith(previousAggregate);
  const nextContent = isAggregateDelta
    ? incomingContent.slice(previousAggregate.length)
    : incomingContent;

  if (!nextContent && isAggregateDelta) {
    return parts;
  }

  if (lastPart?.type === type) {
    const updatedPart: StreamingPart = {
      ...lastPart,
      content: isAggregateDelta ? lastPart.content + nextContent : nextContent,
      isStreaming: true,
      durationMs: undefined,
    };
    return [...parts.slice(0, -1), updatedPart];
  }

  return [
    ...parts,
    {
      id: `${stream.streamId}-${parts.length}`,
      type,
      content: nextContent,
      startedAt: now,
      isStreaming: true,
    },
  ];
}

export const useStreamingStore = create<StreamingState>((set, get) => ({
  streams: new Map(),

  startStream: (event) => {
    refreshStreamTimeout(event.streamId, get, true, event.metadata);

    set((state) => {
      const newStreams = new Map(state.streams);
      const existing = newStreams.get(event.streamId);
      if (existing) {
        const metadata = mergeStreamingMetadata(
          existing.metadata,
          event.metadata,
        );
        newStreams.set(event.streamId, {
          ...existing,
          ...event,
          parentId: event.parentId ?? existing.parentId,
          metadata,
          startedAt: existing.startedAt,
          isStreaming: true,
        });
        persistStreamMetadata(event.streamId, metadata);
        return { streams: newStreams };
      }

      const metadata = mergeStreamingMetadata(
        loadPersistedStreamMetadata(event.streamId),
        event.metadata,
      );
      newStreams.set(event.streamId, {
        ...event,
        metadata,
        content: "",
        thinking: "",
        isThinking: false,
        isStreaming: true,
        parts: [],
      });
      persistStreamMetadata(event.streamId, metadata);
      return { streams: newStreams };
    });
  },

  restoreStream: (event) => {
    refreshStreamTimeout(event.streamId, get, true, event.metadata);

    set((state) => {
      const newStreams = new Map(state.streams);
      const existing = newStreams.get(event.streamId);
      const metadata = mergeStreamingMetadata(
        existing?.metadata ?? loadPersistedStreamMetadata(event.streamId),
        event.metadata,
      );
      const content = preferAccumulatedContent(
        existing?.content ?? "",
        event.content,
      );
      const thinking = preferAccumulatedContent(
        existing?.thinking ?? "",
        event.thinking,
      );
      const startedAt = existing?.startedAt ?? event.startedAt;

      newStreams.set(event.streamId, {
        streamId: event.streamId,
        channelId: event.channelId,
        senderId: event.senderId,
        parentId: event.parentId ?? existing?.parentId,
        startedAt,
        metadata,
        content,
        thinking,
        isThinking: Boolean(thinking) && !content,
        isStreaming: true,
        parts:
          existing?.parts.length &&
          existing.content === content &&
          existing.thinking === thinking
            ? existing.parts
            : buildRestoredParts(event.streamId, startedAt, thinking, content),
      });
      persistStreamMetadata(event.streamId, metadata);
      return { streams: newStreams };
    });
  },

  setStreamContent: (streamId, content) => {
    refreshStreamTimeout(streamId, get);
    set((state) => {
      const stream = state.streams.get(streamId);
      if (!stream) return state;
      const parts = updateStreamingParts(
        stream,
        "content",
        content,
        stream.content,
      );
      const newStreams = new Map(state.streams);
      newStreams.set(streamId, {
        ...stream,
        content: aggregateParts(parts, "content"),
        isThinking: false,
        parts,
      });
      return { streams: newStreams };
    });
  },

  setThinkingContent: (streamId, content) => {
    refreshStreamTimeout(streamId, get);
    set((state) => {
      const stream = state.streams.get(streamId);
      if (!stream) return state;
      if (isToolCallMetadata(stream.metadata)) {
        const parts = closeAllActiveParts(stream.parts, Date.now());
        const newStreams = new Map(state.streams);
        newStreams.set(streamId, {
          ...stream,
          thinking: aggregateParts(parts, "thinking"),
          isThinking: false,
          parts,
        });
        return { streams: newStreams };
      }

      const parts = updateStreamingParts(
        stream,
        "thinking",
        content,
        stream.thinking,
      );
      const newStreams = new Map(state.streams);
      newStreams.set(streamId, {
        ...stream,
        thinking: aggregateParts(parts, "thinking"),
        isThinking: true,
        parts,
      });
      return { streams: newStreams };
    });
  },

  setStreamMetadata: (streamId, metadata) => {
    refreshStreamTimeout(streamId, get, false, metadata);
    set((state) => {
      const stream = state.streams.get(streamId);
      if (!stream) return state;
      const nextMetadata =
        mergeStreamingMetadata(
          stream.metadata ?? loadPersistedStreamMetadata(streamId),
          metadata,
        ) ?? {};
      const isToolCallMetadata = nextMetadata.agentEventType === "tool_call";
      const parts = isToolCallMetadata
        ? closeAllActiveParts(stream.parts, Date.now())
        : stream.parts;
      const newStreams = new Map(state.streams);
      newStreams.set(streamId, {
        ...stream,
        metadata: nextMetadata,
        content: aggregateParts(parts, "content"),
        thinking: aggregateParts(parts, "thinking"),
        isThinking: isToolCallMetadata ? false : stream.isThinking,
        parts,
      });
      persistStreamMetadata(streamId, nextMetadata);
      return { streams: newStreams };
    });
  },

  endStream: (streamId) => {
    clearStreamTimeout(streamId);
    set((state) => {
      const newStreams = new Map(state.streams);
      newStreams.delete(streamId);
      clearPersistedStreamMetadata(streamId);
      return { streams: newStreams };
    });
  },

  abortStream: (streamId) => {
    clearStreamTimeout(streamId);
    set((state) => {
      const newStreams = new Map(state.streams);
      newStreams.delete(streamId);
      clearPersistedStreamMetadata(streamId);
      return { streams: newStreams };
    });
  },

  getChannelStreams: (channelId) => {
    return Array.from(get().streams.values()).filter(
      (s) => s.channelId === channelId,
    );
  },
}));
