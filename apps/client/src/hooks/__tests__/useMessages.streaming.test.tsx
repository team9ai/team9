import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentType, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WS_EVENTS } from "@/types/ws-events";
import { useMessages } from "../useMessages";

const listeners = vi.hoisted(
  () => new Map<string, Array<(event: unknown) => void>>(),
);

const streamStore = vi.hoisted(() => ({
  streams: new Map<string, { parentId?: string }>(),
  startStream: vi.fn(),
  setStreamContent: vi.fn(),
  setThinkingContent: vi.fn(),
  setStreamMetadata: vi.fn(),
  endStream: vi.fn(),
  abortStream: vi.fn(),
}));

const mockImApi = vi.hoisted(() => ({
  messages: {
    getMessages: vi.fn(),
  },
}));

const mockWsService = vi.hoisted(() => ({
  onNewMessage: vi.fn((callback: (event: unknown) => void) => {
    const existing = listeners.get(WS_EVENTS.MESSAGE.NEW) ?? [];
    listeners.set(WS_EVENTS.MESSAGE.NEW, [...existing, callback]);
  }),
  onMessageUpdated: vi.fn((callback: (event: unknown) => void) => {
    const existing = listeners.get(WS_EVENTS.MESSAGE.UPDATED) ?? [];
    listeners.set(WS_EVENTS.MESSAGE.UPDATED, [...existing, callback]);
  }),
  onMessageDeleted: vi.fn((callback: (event: unknown) => void) => {
    const existing = listeners.get(WS_EVENTS.MESSAGE.DELETED) ?? [];
    listeners.set(WS_EVENTS.MESSAGE.DELETED, [...existing, callback]);
  }),
  onReactionAdded: vi.fn((callback: (event: unknown) => void) => {
    const existing = listeners.get(WS_EVENTS.REACTION.ADDED) ?? [];
    listeners.set(WS_EVENTS.REACTION.ADDED, [...existing, callback]);
  }),
  onReactionRemoved: vi.fn((callback: (event: unknown) => void) => {
    const existing = listeners.get(WS_EVENTS.REACTION.REMOVED) ?? [];
    listeners.set(WS_EVENTS.REACTION.REMOVED, [...existing, callback]);
  }),
  onStreamingStart: vi.fn((callback: (event: unknown) => void) => {
    const existing = listeners.get(WS_EVENTS.STREAMING.START) ?? [];
    listeners.set(WS_EVENTS.STREAMING.START, [...existing, callback]);
  }),
  onStreamingContent: vi.fn((callback: (event: unknown) => void) => {
    const existing = listeners.get(WS_EVENTS.STREAMING.CONTENT) ?? [];
    listeners.set(WS_EVENTS.STREAMING.CONTENT, [...existing, callback]);
  }),
  onStreamingThinkingContent: vi.fn((callback: (event: unknown) => void) => {
    const existing = listeners.get(WS_EVENTS.STREAMING.THINKING_CONTENT) ?? [];
    listeners.set(WS_EVENTS.STREAMING.THINKING_CONTENT, [
      ...existing,
      callback,
    ]);
  }),
  onStreamingMetadata: vi.fn((callback: (event: unknown) => void) => {
    const existing = listeners.get(WS_EVENTS.STREAMING.METADATA) ?? [];
    listeners.set(WS_EVENTS.STREAMING.METADATA, [...existing, callback]);
  }),
  onStreamingEnd: vi.fn((callback: (event: unknown) => void) => {
    const existing = listeners.get(WS_EVENTS.STREAMING.END) ?? [];
    listeners.set(WS_EVENTS.STREAMING.END, [...existing, callback]);
  }),
  onStreamingAbort: vi.fn((callback: (event: unknown) => void) => {
    const existing = listeners.get(WS_EVENTS.STREAMING.ABORT) ?? [];
    listeners.set(WS_EVENTS.STREAMING.ABORT, [...existing, callback]);
  }),
  off: vi.fn((event: string, callback?: (event: unknown) => void) => {
    if (!callback) {
      listeners.delete(event);
      return;
    }
    listeners.set(
      event,
      (listeners.get(event) ?? []).filter((listener) => listener !== callback),
    );
  }),
}));

vi.mock("@/analytics/posthog/client", () => ({
  getPostHogBrowserClient: () => null,
}));

vi.mock("@/services/api/im", () => ({
  default: mockImApi,
}));

vi.mock("@/services/websocket", () => ({
  default: mockWsService,
}));

vi.mock("@/stores", () => ({
  useSelectedWorkspaceId: () => "workspace-1",
}));

vi.mock("@/stores/useAppStore", () => ({
  useAppStore: {
    getState: () => ({ user: { id: "current-user" } }),
  },
}));

vi.mock("@/stores/useStreamingStore", () => ({
  useStreamingStore: {
    getState: () => streamStore,
  },
}));

vi.mock("../useThread", () => ({
  useThreadStore: {
    getState: () => ({
      primaryThread: { isOpen: false, rootMessageId: null },
      secondaryThread: { rootMessageId: null },
      openPrimaryThread: vi.fn(),
      openSecondaryThread: vi.fn(),
    }),
  },
}));

vi.mock("../useThreadScrollState", () => ({
  useThreadScrollStore: {
    getState: () => ({ send: vi.fn() }),
  },
}));

vi.mock("../useChannelScrollState", () => ({
  useChannelScrollStore: {
    getState: () => ({ send: vi.fn() }),
  },
}));

function emit(event: string, payload: unknown) {
  for (const listener of listeners.get(event) ?? []) {
    listener(payload);
  }
}

function makeWrapper(): {
  wrapper: ComponentType<{ children: ReactNode }>;
  queryClient: QueryClient;
} {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  return { wrapper: Wrapper, queryClient };
}

describe("useMessages streaming events", () => {
  beforeEach(() => {
    listeners.clear();
    vi.clearAllMocks();
    streamStore.streams = new Map();
    mockImApi.messages.getMessages.mockResolvedValue([]);
  });

  it("refetches channel messages when a stream ends without a message payload", async () => {
    const { wrapper, queryClient } = makeWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    renderHook(() => useMessages("ch-1"), { wrapper });

    await waitFor(() =>
      expect(mockImApi.messages.getMessages).toHaveBeenCalled(),
    );

    streamStore.streams.set("stream-1", {});

    act(() => {
      emit(WS_EVENTS.STREAMING.END, {
        streamId: "stream-1",
        channelId: "ch-1",
        senderId: "bot-1",
        message: null,
      });
    });

    expect(streamStore.endStream).toHaveBeenCalledWith("stream-1");
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["messages", "ch-1"],
      refetchType: "all",
    });
  });
});
