import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentType, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WS_EVENTS } from "@/types/ws-events";
import { useMessages, useSendMessage } from "../useMessages";

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
    sendMessage: vi.fn(),
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

function getFirstCachedMessage(
  queryClient: QueryClient,
):
  | { id: string; sendStatus?: string; metadata?: Record<string, unknown> }
  | undefined {
  const data = queryClient.getQueryData<{
    pages: Array<
      | Array<{
          id: string;
          sendStatus?: string;
          metadata?: Record<string, unknown>;
        }>
      | {
          messages: Array<{
            id: string;
            sendStatus?: string;
            metadata?: Record<string, unknown>;
          }>;
        }
    >;
  }>(["messages", "ch-1"]);
  const firstPage = data?.pages[0];
  if (!firstPage) return undefined;
  return Array.isArray(firstPage) ? firstPage[0] : firstPage.messages[0];
}

function getCachedMessages(
  queryClient: QueryClient,
): Array<{ id: string; sendStatus?: string }> {
  const data = queryClient.getQueryData<{
    pages: Array<
      | Array<{ id: string; sendStatus?: string }>
      | { messages: Array<{ id: string; sendStatus?: string }> }
    >;
  }>(["messages", "ch-1"]);
  const firstPage = data?.pages[0];
  if (!firstPage) return [];
  return Array.isArray(firstPage) ? firstPage : firstPage.messages;
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
    mockImApi.messages.sendMessage.mockReset();
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

  it("preserves message metadata on optimistic A2UI response sends", async () => {
    const { wrapper, queryClient } = makeWrapper();
    mockImApi.messages.sendMessage.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(
      () => {
        useMessages("ch-1");
        return useSendMessage("ch-1");
      },
      { wrapper },
    );

    await waitFor(() =>
      expect(mockImApi.messages.getMessages).toHaveBeenCalled(),
    );

    act(() => {
      result.current.mutate({
        content: "这次选哪个？: 选项 C",
        metadata: {
          agentEventType: "a2ui_response",
          status: "completed",
          surfaceId: "choices-1",
          selections: {
            "这次选哪个？": { selected: ["c"], otherText: null },
          },
        },
      });
    });

    await waitFor(() =>
      expect(getFirstCachedMessage(queryClient)?.metadata).toMatchObject({
        agentEventType: "a2ui_response",
        status: "completed",
        surfaceId: "choices-1",
      }),
    );
  });

  it("keeps timeout sends recoverable when the late websocket message arrives", async () => {
    const { wrapper, queryClient } = makeWrapper();
    const timeoutError = Object.assign(new Error("Request timeout"), {
      code: "ECONNABORTED",
    });
    mockImApi.messages.sendMessage.mockRejectedValue(timeoutError);

    const { result } = renderHook(
      () => {
        useMessages("ch-1");
        return useSendMessage("ch-1");
      },
      { wrapper },
    );

    await waitFor(() =>
      expect(mockImApi.messages.getMessages).toHaveBeenCalled(),
    );

    await act(async () => {
      await expect(
        result.current.mutateAsync({ content: "hello" }),
      ).rejects.toThrow("Request timeout");
    });

    const sentPayload = mockImApi.messages.sendMessage.mock.calls[0]?.[1] as {
      clientMsgId?: string;
    };
    const clientMsgId = sentPayload.clientMsgId;
    expect(clientMsgId).toBeTruthy();

    expect(getFirstCachedMessage(queryClient)?.sendStatus).toBe("sending");

    act(() => {
      emit(WS_EVENTS.MESSAGE.NEW, {
        id: "server-1",
        clientMsgId,
        channelId: "ch-1",
        senderId: "current-user",
        content: "hello",
        type: "text",
        isPinned: false,
        isEdited: false,
        isDeleted: false,
        createdAt: "2026-05-12T00:00:00.000Z",
        updatedAt: "2026-05-12T00:00:00.000Z",
      });
    });

    expect(getCachedMessages(queryClient)).toEqual([
      expect.objectContaining({
        id: "server-1",
        sendStatus: undefined,
      }),
    ]);
  });
});
