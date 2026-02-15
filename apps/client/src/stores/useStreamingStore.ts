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
  }) => void;

  /** Append text delta to a stream */
  appendDelta: (streamId: string, delta: string) => void;

  /** Append thinking delta to a stream */
  appendThinkingDelta: (streamId: string, delta: string) => void;

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
      });
      return { streams: newStreams };
    });
  },

  appendDelta: (streamId, delta) => {
    set((state) => {
      const stream = state.streams.get(streamId);
      if (!stream) return state;
      const newStreams = new Map(state.streams);
      newStreams.set(streamId, {
        ...stream,
        content: delta,
        isThinking: false,
      });
      return { streams: newStreams };
    });
  },

  appendThinkingDelta: (streamId, delta) => {
    set((state) => {
      const stream = state.streams.get(streamId);
      if (!stream) return state;
      const newStreams = new Map(state.streams);
      newStreams.set(streamId, {
        ...stream,
        thinking: delta,
        isThinking: true,
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
