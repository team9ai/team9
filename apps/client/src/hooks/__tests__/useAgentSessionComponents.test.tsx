import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  agentSessionComponentsKey,
  useAgentSessionComponents,
} from "../useAgentSessionComponents";

const mockApi = vi.hoisted(() => ({
  channels: {
    getAgentSessionComponents: vi.fn(),
  },
}));

const auth = vi.hoisted(() => ({
  getValidAccessToken: vi.fn(),
  redirectToLogin: vi.fn(),
}));

const eventSources = vi.hoisted(() => [] as MockEventSource[]);

class MockEventSource {
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  private readonly listeners = new Map<
    string,
    Array<(event: MessageEvent<string>) => void>
  >();
  closed = false;

  constructor(public readonly url: string) {
    eventSources.push(this);
  }

  addEventListener(
    type: string,
    listener: (event: MessageEvent<string>) => void,
  ) {
    const current = this.listeners.get(type) ?? [];
    current.push(listener);
    this.listeners.set(type, current);
  }

  dispatch(type: string, data: string) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data } as MessageEvent<string>);
    }
  }

  close() {
    this.closed = true;
  }
}

vi.stubGlobal("EventSource", MockEventSource);

vi.mock("@/services/api", () => ({ api: { im: mockApi } }));
vi.mock("@/services/api/im", () => ({ default: mockApi }));
vi.mock("@/services/auth-session", () => auth);
vi.mock("@/constants/api-base-url", () => ({
  API_BASE_URL: "http://localhost:3000",
}));

function makeWrapper(
  queryClient: QueryClient,
): ComponentType<{ children: ReactNode }> {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("useAgentSessionComponents", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    eventSources.length = 0;
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    auth.getValidAccessToken.mockResolvedValue("token-1");
    mockApi.channels.getAgentSessionComponents.mockResolvedValue({
      sessionId: "session-1",
      components: [
        {
          id: "persona",
          typeKey: "persona",
          runtimeInjectedOnly: false,
          latestData: null,
        },
      ],
    });
  });

  it("loads initial components and opens authenticated SSE", async () => {
    const { result } = renderHook(
      () => useAgentSessionComponents("channel-1", true),
      { wrapper: makeWrapper(queryClient) },
    );

    await waitFor(() =>
      expect(result.current.data?.components).toHaveLength(1),
    );
    await waitFor(() => expect(eventSources).toHaveLength(1));
    expect(eventSources[0].url).toContain(
      "/v1/im/channels/channel-1/agent-session/events?token=token-1",
    );
  });

  it("encodes the channel id in the SSE URL", async () => {
    renderHook(() => useAgentSessionComponents("channel/1", true), {
      wrapper: makeWrapper(queryClient),
    });

    await waitFor(() => expect(eventSources).toHaveLength(1));
    expect(eventSources[0].url).toContain(
      "/v1/im/channels/channel%2F1/agent-session/events?token=token-1",
    );
  });

  it("directly patches latestData from component_data_snapshot", async () => {
    const { result } = renderHook(
      () => useAgentSessionComponents("channel-1", true),
      { wrapper: makeWrapper(queryClient) },
    );
    await waitFor(() =>
      expect(result.current.data?.components).toHaveLength(1),
    );
    await waitFor(() => expect(eventSources).toHaveLength(1));

    act(() => {
      eventSources[0].onmessage?.({
        data: JSON.stringify({
          type: "component_data_snapshot",
          sessionId: "session-1",
          timestamp: 1700000000000,
          turnIndex: 2,
          components: [{ componentId: "persona", data: { mood: "focused" } }],
        }),
      } as MessageEvent<string>);
    });

    await waitFor(() =>
      expect(result.current.data?.components[0].latestData).toEqual({
        data: { mood: "focused" },
        capturedAtCallId: null,
        capturedAt: 1700000000000,
      }),
    );
    expect(mockApi.channels.getAgentSessionComponents).toHaveBeenCalledTimes(1);
  });

  it("handles named component_data_snapshot SSE events", async () => {
    const { result } = renderHook(
      () => useAgentSessionComponents("channel-1", true),
      { wrapper: makeWrapper(queryClient) },
    );
    await waitFor(() =>
      expect(result.current.data?.components).toHaveLength(1),
    );
    await waitFor(() => expect(eventSources).toHaveLength(1));

    act(() => {
      eventSources[0].dispatch(
        "component_data_snapshot",
        JSON.stringify({
          type: "component_data_snapshot",
          sessionId: "session-1",
          timestamp: 1700000000200,
          turnIndex: 4,
          components: [{ componentId: "persona", data: { mood: "named" } }],
        }),
      );
    });

    await waitFor(() =>
      expect(result.current.data?.components[0].latestData).toEqual({
        data: { mood: "named" },
        capturedAtCallId: null,
        capturedAt: 1700000000200,
      }),
    );
  });

  it("ignores stale sessions and malformed component entries", async () => {
    renderHook(() => useAgentSessionComponents("channel-1", true), {
      wrapper: makeWrapper(queryClient),
    });
    await waitFor(() => expect(eventSources).toHaveLength(1));

    act(() => {
      eventSources[0].onmessage?.({
        data: JSON.stringify({
          type: "component_data_snapshot",
          sessionId: "old-session",
          timestamp: 1700000000000,
          turnIndex: 2,
          components: [{ componentId: "persona", data: { mood: "stale" } }],
        }),
      } as MessageEvent<string>);
      eventSources[0].onmessage?.({
        data: JSON.stringify({
          type: "component_data_snapshot",
          sessionId: "session-1",
          timestamp: 1700000000001,
          turnIndex: 3,
          components: [{ componentId: 42, data: { mood: "bad" } }],
        }),
      } as MessageEvent<string>);
    });

    const cached = queryClient.getQueryData<{
      components: Array<{ latestData: unknown }>;
    }>(agentSessionComponentsKey("channel-1"));
    expect(cached?.components[0].latestData).toBeNull();
    expect(mockApi.channels.getAgentSessionComponents).toHaveBeenCalledTimes(1);
  });

  it("inserts unknown components and refetches once", async () => {
    renderHook(() => useAgentSessionComponents("channel-1", true), {
      wrapper: makeWrapper(queryClient),
    });
    await waitFor(() =>
      expect(mockApi.channels.getAgentSessionComponents).toHaveBeenCalledTimes(
        1,
      ),
    );
    await waitFor(() => expect(eventSources).toHaveLength(1));

    act(() => {
      eventSources[0].onmessage?.({
        data: JSON.stringify({
          type: "component_data_snapshot",
          sessionId: "session-1",
          timestamp: 1700000000100,
          turnIndex: 3,
          components: [{ componentId: "host", data: { cwd: "/tmp" } }],
        }),
      } as MessageEvent<string>);
    });

    await waitFor(() =>
      expect(mockApi.channels.getAgentSessionComponents).toHaveBeenCalledTimes(
        2,
      ),
    );
  });

  it("deduplicates reconnect timers after repeated errors", async () => {
    renderHook(() => useAgentSessionComponents("channel-1", true), {
      wrapper: makeWrapper(queryClient),
    });
    await waitFor(() => expect(eventSources).toHaveLength(1));

    vi.useFakeTimers();
    try {
      act(() => {
        eventSources[0].onerror?.();
        eventSources[0].onerror?.();
      });
      expect(eventSources[0].closed).toBe(true);

      await act(async () => {
        vi.advanceTimersByTime(2_000);
        await Promise.resolve();
      });

      expect(eventSources).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
