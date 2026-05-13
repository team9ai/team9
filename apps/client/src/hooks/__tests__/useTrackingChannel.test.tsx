import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentType, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WS_EVENTS } from "@/types/ws-events";
import { useTrackingChannel } from "../useTrackingChannel";

const listeners = vi.hoisted(
  () => new Map<string, Array<(event: unknown) => void>>(),
);

const mockImApi = vi.hoisted(() => ({
  channels: {
    getChannel: vi.fn(),
  },
  messages: {
    getMessages: vi.fn(),
  },
}));

const mockWsService = vi.hoisted(() => ({
  on: vi.fn((event: string, callback: (event: unknown) => void) => {
    const existing = listeners.get(event) ?? [];
    listeners.set(event, [...existing, callback]);
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
  onNewMessage: vi.fn((callback: (event: unknown) => void) => {
    const existing = listeners.get(WS_EVENTS.MESSAGE.NEW) ?? [];
    listeners.set(WS_EVENTS.MESSAGE.NEW, [...existing, callback]);
  }),
  onTrackingDeactivated: vi.fn((callback: (event: unknown) => void) => {
    const existing = listeners.get(WS_EVENTS.TRACKING.DEACTIVATED) ?? [];
    listeners.set(WS_EVENTS.TRACKING.DEACTIVATED, [...existing, callback]);
  }),
  offTrackingDeactivated: vi.fn(),
}));

vi.mock("@/services/api/im", () => ({
  default: mockImApi,
}));

vi.mock("@/services/websocket", () => ({
  default: mockWsService,
}));

vi.mock("../useChannelObserver", () => ({
  useChannelObserver: vi.fn(),
}));

function emit(event: string, payload: unknown) {
  for (const listener of listeners.get(event) ?? []) {
    listener(payload);
  }
}

function makeWrapperWithClient(): {
  wrapper: ComponentType<{ children: ReactNode }>;
  queryClient: QueryClient;
} {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  return { wrapper: Wrapper, queryClient };
}

function makeWrapper(): ComponentType<{ children: ReactNode }> {
  return makeWrapperWithClient().wrapper;
}

describe("useTrackingChannel", () => {
  beforeEach(() => {
    listeners.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
    mockImApi.channels.getChannel.mockResolvedValue({
      id: "tracking-1",
      isActivated: true,
    });
    mockImApi.messages.getMessages.mockResolvedValue([]);
  });

  it("merges streaming metadata updates into the active tracking stream", async () => {
    const { result } = renderHook(() => useTrackingChannel("tracking-1"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      emit(WS_EVENTS.STREAMING.START, {
        streamId: "stream-1",
        channelId: "tracking-1",
        senderId: "bot-1",
        startedAt: 1700000000000,
        metadata: {
          agentEventType: "writing",
          status: "running",
        },
      });
    });

    expect(result.current.activeStream?.metadata).toEqual({
      agentEventType: "writing",
      status: "running",
    });

    act(() => {
      emit(WS_EVENTS.STREAMING.METADATA, {
        streamId: "stream-1",
        channelId: "tracking-1",
        senderId: "bot-1",
        metadata: {
          agentEventType: "tool_call",
          status: "running",
          toolCallId: "tc-1",
          toolName: "RunScript",
          toolArgsText: '{"cmd":"pnpm test"}',
          toolPhase: "args_streaming",
        },
      });
    });

    await waitFor(() =>
      expect(result.current.activeStream?.metadata).toMatchObject({
        agentEventType: "tool_call",
        status: "running",
        toolCallId: "tc-1",
        toolName: "RunScript",
        toolArgsText: '{"cmd":"pnpm test"}',
        toolPhase: "args_streaming",
      }),
    );
  });

  it("creates an active tracking stream from metadata delta events after refresh", async () => {
    const { result } = renderHook(() => useTrackingChannel("tracking-1"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      emit(WS_EVENTS.STREAMING.METADATA, {
        streamId: "stream-1",
        channelId: "tracking-1",
        senderId: "bot-1",
        metadata: {
          agentEventType: "tool_call",
          status: "running",
          toolCallId: "tc-1",
          toolName: "RunScript",
          deltaData: { toolArgsText: '{"cmd":"pnpm' },
          toolPhase: "args_streaming",
        },
      });
      emit(WS_EVENTS.STREAMING.METADATA, {
        streamId: "stream-1",
        channelId: "tracking-1",
        senderId: "bot-1",
        metadata: {
          deltaData: { toolArgsText: ' test"}' },
          toolPhase: "args_streaming",
        },
      });
    });

    await waitFor(() =>
      expect(result.current.activeStream?.metadata).toMatchObject({
        agentEventType: "tool_call",
        status: "running",
        toolCallId: "tc-1",
        toolName: "RunScript",
        toolArgsText: '{"cmd":"pnpm test"}',
        toolPhase: "args_streaming",
      }),
    );
  });

  it("refetches tracking messages when a stream ends without a message payload", async () => {
    const { wrapper, queryClient } = makeWrapperWithClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useTrackingChannel("tracking-1"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      emit(WS_EVENTS.STREAMING.START, {
        streamId: "stream-1",
        channelId: "tracking-1",
        senderId: "bot-1",
        startedAt: 1700000000000,
        metadata: {
          agentEventType: "tool_call",
          status: "running",
          toolCallId: "tc-1",
          toolName: "run_command",
        },
      });
    });

    expect(result.current.activeStream?.streamId).toBe("stream-1");

    act(() => {
      emit(WS_EVENTS.STREAMING.END, {
        streamId: "stream-1",
        channelId: "tracking-1",
        senderId: "bot-1",
        message: null,
      });
    });

    await waitFor(() => expect(result.current.activeStream).toBeNull());
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["trackingMessages", "tracking-1"],
      refetchType: "all",
    });
  });

  it("keeps the finalized tool call visible from streaming_end message payload", async () => {
    const { result } = renderHook(() => useTrackingChannel("tracking-1"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      emit(WS_EVENTS.STREAMING.START, {
        streamId: "stream-1",
        channelId: "tracking-1",
        senderId: "bot-1",
        startedAt: 1700000000000,
        metadata: {
          agentEventType: "tool_call",
          status: "running",
          toolCallId: "tc-1",
          toolName: "run_command",
          toolArgsText: '{"command":"pnpm',
          toolPhase: "args_streaming",
        },
      });
      emit(WS_EVENTS.STREAMING.END, {
        streamId: "stream-1",
        channelId: "tracking-1",
        senderId: "bot-1",
        message: {
          id: "tool-call-message-1",
          channelId: "tracking-1",
          senderId: "bot-1",
          content: "run_command",
          type: "tracking",
          createdAt: "2026-05-13T00:00:00.000Z",
          metadata: {
            agentEventType: "tool_call",
            status: "running",
            toolCallId: "tc-1",
            toolName: "run_command",
            toolArgs: { command: "pnpm test" },
            toolPhase: "executing",
          },
        },
      });
    });

    await waitFor(() => expect(result.current.activeStream).toBeNull());
    expect(result.current.latestMessages).toContainEqual(
      expect.objectContaining({
        id: "tool-call-message-1",
        metadata: expect.objectContaining({
          agentEventType: "tool_call",
          toolPhase: "executing",
          toolArgs: { command: "pnpm test" },
        }),
      }),
    );
  });
});
