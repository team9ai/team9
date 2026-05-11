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

function makeWrapper(): ComponentType<{ children: ReactNode }> {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("useTrackingChannel", () => {
  beforeEach(() => {
    listeners.clear();
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
});
