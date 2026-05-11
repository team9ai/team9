import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentSessionComponents } from "../useAgentSessionComponents";

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
  closed = false;

  constructor(public readonly url: string) {
    eventSources.push(this);
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
});
