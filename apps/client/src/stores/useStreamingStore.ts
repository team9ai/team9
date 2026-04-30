import { create } from "zustand";

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

  /** Set the current accumulated text content for a stream */
  setStreamContent: (streamId: string, content: string) => void;

  /** Set the current accumulated thinking content for a stream */
  setThinkingContent: (streamId: string, content: string) => void;

  /** End a stream (remove from active) */
  endStream: (streamId: string) => void;

  /** Abort a stream */
  abortStream: (streamId: string) => void;

  /** Get active streams for a channel */
  getChannelStreams: (channelId: string) => StreamingMessage[];
}

// Auto-cleanup timeout for stale streams (120s)
const STREAM_TIMEOUT_MS = 120_000;
const streamTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

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

function aggregateParts(
  parts: StreamingPart[],
  type: StreamingPart["type"],
): string {
  return parts
    .filter((part) => part.type === type)
    .map((part) => part.content)
    .join("");
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
    // Clear any existing timeout for this streamId
    const existingTimeout = streamTimeouts.get(event.streamId);
    if (existingTimeout) clearTimeout(existingTimeout);

    // Set auto-cleanup timeout
    const timeout = setTimeout(() => {
      const stream = get().streams.get(event.streamId);
      if (stream?.isStreaming) {
        get().abortStream(event.streamId);
      }
      streamTimeouts.delete(event.streamId);
    }, STREAM_TIMEOUT_MS);
    streamTimeouts.set(event.streamId, timeout);

    set((state) => {
      const newStreams = new Map(state.streams);
      newStreams.set(event.streamId, {
        ...event,
        content: "",
        thinking: "",
        isThinking: false,
        isStreaming: true,
        parts: [],
      });
      return { streams: newStreams };
    });
  },

  setStreamContent: (streamId, content) => {
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
    set((state) => {
      const stream = state.streams.get(streamId);
      if (!stream) return state;
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

  endStream: (streamId) => {
    const timeout = streamTimeouts.get(streamId);
    if (timeout) {
      clearTimeout(timeout);
      streamTimeouts.delete(streamId);
    }
    set((state) => {
      const newStreams = new Map(state.streams);
      newStreams.delete(streamId);
      return { streams: newStreams };
    });
  },

  abortStream: (streamId) => {
    const timeout = streamTimeouts.get(streamId);
    if (timeout) {
      clearTimeout(timeout);
      streamTimeouts.delete(streamId);
    }
    set((state) => {
      const newStreams = new Map(state.streams);
      newStreams.delete(streamId);
      return { streams: newStreams };
    });
  },

  getChannelStreams: (channelId) => {
    return Array.from(get().streams.values()).filter(
      (s) => s.channelId === channelId,
    );
  },
}));
