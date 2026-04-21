import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createElement } from "react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import type { TreeSnapshot, TreeNode } from "@/types/relations";

// ==================== Mocks ====================

// Mock wsService — onRelationChanged and onRelationsPurged must return unsubscribe fns
const mockWsService = vi.hoisted(() => {
  const listeners: Record<string, Set<(e: unknown) => void>> = {};
  return {
    onRelationChanged: vi.fn((cb: (e: unknown) => void) => {
      if (!listeners["relationChanged"])
        listeners["relationChanged"] = new Set();
      listeners["relationChanged"].add(cb);
      return () => listeners["relationChanged"].delete(cb);
    }),
    onRelationsPurged: vi.fn((cb: (e: unknown) => void) => {
      if (!listeners["relationsPurged"])
        listeners["relationsPurged"] = new Set();
      listeners["relationsPurged"].add(cb);
      return () => listeners["relationsPurged"].delete(cb);
    }),
    _emit: (event: string, payload: unknown) => {
      listeners[event]?.forEach((cb) => cb(payload));
    },
  };
});

vi.mock("@/services/websocket", () => ({
  default: mockWsService,
}));

// Mock useViewTree
const mockUseViewTree = vi.hoisted(() => vi.fn());

vi.mock("../useViewTree", () => ({
  useViewTree: mockUseViewTree,
}));

// Import AFTER mocks
import { useTreeLoader } from "../useTreeLoader";

// ==================== Test helpers ====================

function createTestClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

const emptySnapshot: TreeSnapshot = {
  nodes: [],
  nextCursor: null,
  ancestorsIncluded: [],
};

function makeQueryResult(
  overrides: Partial<{
    data: TreeSnapshot;
    isLoading: boolean;
    refetch: ReturnType<typeof vi.fn>;
  }> = {},
) {
  return {
    data: emptySnapshot,
    isLoading: false,
    refetch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ==================== Tests ====================

describe("useTreeLoader", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestClient();
  });

  // ---- initial fetch configuration ----

  it("passes defaultDepth as maxDepth to useViewTree", () => {
    mockUseViewTree.mockReturnValue(makeQueryResult());

    renderHook(
      () => useTreeLoader({ channelId: "c", viewId: "v", defaultDepth: 3 }),
      { wrapper: createWrapper(queryClient) },
    );

    expect(mockUseViewTree).toHaveBeenCalledWith(
      "c",
      "v",
      expect.objectContaining({ maxDepth: 3 }),
    );
  });

  it("passes filter and sort to useViewTree", () => {
    mockUseViewTree.mockReturnValue(makeQueryResult());
    const filter = { status: "open" };
    const sort = [{ field: "createdAt", dir: "asc" }];

    renderHook(
      () =>
        useTreeLoader({
          channelId: "c",
          viewId: "v",
          defaultDepth: 2,
          filter,
          sort,
        }),
      { wrapper: createWrapper(queryClient) },
    );

    expect(mockUseViewTree).toHaveBeenCalledWith(
      "c",
      "v",
      expect.objectContaining({ filter, sort }),
    );
  });

  it("passes limit: 50 by default", () => {
    mockUseViewTree.mockReturnValue(makeQueryResult());

    renderHook(
      () => useTreeLoader({ channelId: "c", viewId: "v", defaultDepth: 3 }),
      { wrapper: createWrapper(queryClient) },
    );

    expect(mockUseViewTree).toHaveBeenCalledWith(
      "c",
      "v",
      expect.objectContaining({ limit: 50 }),
    );
  });

  it("initial cursor is null", () => {
    mockUseViewTree.mockReturnValue(makeQueryResult());

    renderHook(
      () => useTreeLoader({ channelId: "c", viewId: "v", defaultDepth: 3 }),
      { wrapper: createWrapper(queryClient) },
    );

    expect(mockUseViewTree).toHaveBeenCalledWith(
      "c",
      "v",
      expect.objectContaining({ cursor: null }),
    );
  });

  it("initial expandedIds is empty array", () => {
    mockUseViewTree.mockReturnValue(makeQueryResult());

    renderHook(
      () => useTreeLoader({ channelId: "c", viewId: "v", defaultDepth: 3 }),
      { wrapper: createWrapper(queryClient) },
    );

    expect(mockUseViewTree).toHaveBeenCalledWith(
      "c",
      "v",
      expect.objectContaining({ expandedIds: [] }),
    );
  });

  // ---- return values ----

  it("returns empty nodes and ancestorsIncluded when data is undefined", () => {
    mockUseViewTree.mockReturnValue({
      data: undefined,
      isLoading: true,
      refetch: vi.fn(),
    });

    const { result } = renderHook(
      () => useTreeLoader({ channelId: "c", viewId: "v", defaultDepth: 3 }),
      { wrapper: createWrapper(queryClient) },
    );

    expect(result.current.nodes).toEqual([]);
    expect(result.current.ancestorsIncluded).toEqual([]);
    expect(result.current.isLoading).toBe(true);
  });

  it("returns nodes and ancestorsIncluded from data", () => {
    const node: TreeNode = {
      messageId: "m1",
      effectiveParentId: null,
      parentSource: null,
      depth: 0,
      hasChildren: true,
      childrenLoaded: false,
    };
    const snapshot: TreeSnapshot = {
      nodes: [node],
      nextCursor: "next-cursor",
      ancestorsIncluded: ["ancestor-1"],
    };
    mockUseViewTree.mockReturnValue(makeQueryResult({ data: snapshot }));

    const { result } = renderHook(
      () => useTreeLoader({ channelId: "c", viewId: "v", defaultDepth: 3 }),
      { wrapper: createWrapper(queryClient) },
    );

    expect(result.current.nodes).toHaveLength(1);
    expect(result.current.nodes[0].messageId).toBe("m1");
    expect(result.current.ancestorsIncluded).toEqual(["ancestor-1"]);
  });

  // ---- expand / collapse ----

  it("expand adds nodeId to expandedSet", () => {
    mockUseViewTree.mockReturnValue(makeQueryResult());

    const { result } = renderHook(
      () => useTreeLoader({ channelId: "c", viewId: "v", defaultDepth: 3 }),
      { wrapper: createWrapper(queryClient) },
    );

    act(() => {
      result.current.expand("x");
    });

    expect(result.current.expandedSet.has("x")).toBe(true);
  });

  it("expand adds nodeId to extraExpands (passed to useViewTree)", () => {
    mockUseViewTree.mockReturnValue(makeQueryResult());

    const { result } = renderHook(
      () => useTreeLoader({ channelId: "c", viewId: "v", defaultDepth: 3 }),
      { wrapper: createWrapper(queryClient) },
    );

    act(() => {
      result.current.expand("x");
    });

    // After expand, useViewTree should be called with expandedIds containing 'x'
    const lastCall =
      mockUseViewTree.mock.calls[mockUseViewTree.mock.calls.length - 1];
    expect(lastCall[2].expandedIds).toContain("x");
  });

  it("expand is idempotent — adding same id twice does not duplicate in extraExpands", () => {
    mockUseViewTree.mockReturnValue(makeQueryResult());

    const { result } = renderHook(
      () => useTreeLoader({ channelId: "c", viewId: "v", defaultDepth: 3 }),
      { wrapper: createWrapper(queryClient) },
    );

    act(() => {
      result.current.expand("x");
      result.current.expand("x");
    });

    const lastCall =
      mockUseViewTree.mock.calls[mockUseViewTree.mock.calls.length - 1];
    const expandedIds: string[] = lastCall[2].expandedIds;
    expect(expandedIds.filter((id) => id === "x")).toHaveLength(1);
  });

  it("collapse removes nodeId from expandedSet", () => {
    mockUseViewTree.mockReturnValue(makeQueryResult());

    const { result } = renderHook(
      () => useTreeLoader({ channelId: "c", viewId: "v", defaultDepth: 3 }),
      { wrapper: createWrapper(queryClient) },
    );

    act(() => {
      result.current.expand("x");
    });

    expect(result.current.expandedSet.has("x")).toBe(true);

    act(() => {
      result.current.collapse("x");
    });

    expect(result.current.expandedSet.has("x")).toBe(false);
  });

  it("collapse on non-existent id is a no-op", () => {
    mockUseViewTree.mockReturnValue(makeQueryResult());

    const { result } = renderHook(
      () => useTreeLoader({ channelId: "c", viewId: "v", defaultDepth: 3 }),
      { wrapper: createWrapper(queryClient) },
    );

    // Should not throw
    act(() => {
      result.current.collapse("nonexistent");
    });

    expect(result.current.expandedSet.has("nonexistent")).toBe(false);
  });

  it("multiple independent expansions work correctly", () => {
    mockUseViewTree.mockReturnValue(makeQueryResult());

    const { result } = renderHook(
      () => useTreeLoader({ channelId: "c", viewId: "v", defaultDepth: 3 }),
      { wrapper: createWrapper(queryClient) },
    );

    act(() => {
      result.current.expand("a");
      result.current.expand("b");
      result.current.expand("c");
    });

    expect(result.current.expandedSet.has("a")).toBe(true);
    expect(result.current.expandedSet.has("b")).toBe(true);
    expect(result.current.expandedSet.has("c")).toBe(true);

    act(() => {
      result.current.collapse("b");
    });

    expect(result.current.expandedSet.has("a")).toBe(true);
    expect(result.current.expandedSet.has("b")).toBe(false);
    expect(result.current.expandedSet.has("c")).toBe(true);
  });

  // ---- loadMoreRoots ----

  it("loadMoreRoots advances cursor to nextCursor", () => {
    mockUseViewTree.mockReturnValue(
      makeQueryResult({ data: { ...emptySnapshot, nextCursor: "cursor-abc" } }),
    );

    const { result } = renderHook(
      () => useTreeLoader({ channelId: "c", viewId: "v", defaultDepth: 3 }),
      { wrapper: createWrapper(queryClient) },
    );

    act(() => {
      result.current.loadMoreRoots();
    });

    const lastCall =
      mockUseViewTree.mock.calls[mockUseViewTree.mock.calls.length - 1];
    expect(lastCall[2].cursor).toBe("cursor-abc");
  });

  it("loadMoreRoots is no-op when nextCursor is null", () => {
    mockUseViewTree.mockReturnValue(
      makeQueryResult({ data: { ...emptySnapshot, nextCursor: null } }),
    );

    const { result } = renderHook(
      () => useTreeLoader({ channelId: "c", viewId: "v", defaultDepth: 3 }),
      { wrapper: createWrapper(queryClient) },
    );

    const callsBefore = mockUseViewTree.mock.calls.length;

    act(() => {
      result.current.loadMoreRoots();
    });

    // No additional calls triggered by cursor change
    const lastCall =
      mockUseViewTree.mock.calls[mockUseViewTree.mock.calls.length - 1];
    expect(lastCall[2].cursor).toBe(null);
    expect(mockUseViewTree.mock.calls.length).toBe(callsBefore);
  });

  // ---- WebSocket events ----

  it("subscribes to onRelationChanged on mount", () => {
    mockUseViewTree.mockReturnValue(makeQueryResult());

    renderHook(
      () => useTreeLoader({ channelId: "c", viewId: "v", defaultDepth: 3 }),
      { wrapper: createWrapper(queryClient) },
    );

    expect(mockWsService.onRelationChanged).toHaveBeenCalledTimes(1);
  });

  it("subscribes to onRelationsPurged on mount", () => {
    mockUseViewTree.mockReturnValue(makeQueryResult());

    renderHook(
      () => useTreeLoader({ channelId: "c", viewId: "v", defaultDepth: 3 }),
      { wrapper: createWrapper(queryClient) },
    );

    expect(mockWsService.onRelationsPurged).toHaveBeenCalledTimes(1);
  });

  it("calls refetch when relation_changed fires for the same channel", async () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    mockUseViewTree.mockReturnValue(makeQueryResult({ refetch }));

    renderHook(
      () =>
        useTreeLoader({ channelId: "chan-1", viewId: "v", defaultDepth: 3 }),
      { wrapper: createWrapper(queryClient) },
    );

    act(() => {
      mockWsService._emit("relationChanged", { channelId: "chan-1" });
    });

    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
  });

  it("does not call refetch when relation_changed fires for a different channel", async () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    mockUseViewTree.mockReturnValue(makeQueryResult({ refetch }));

    renderHook(
      () =>
        useTreeLoader({ channelId: "chan-1", viewId: "v", defaultDepth: 3 }),
      { wrapper: createWrapper(queryClient) },
    );

    act(() => {
      mockWsService._emit("relationChanged", { channelId: "other-channel" });
    });

    expect(refetch).not.toHaveBeenCalled();
  });

  it("calls refetch when relations_purged fires for the same channel", async () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    mockUseViewTree.mockReturnValue(makeQueryResult({ refetch }));

    renderHook(
      () =>
        useTreeLoader({ channelId: "chan-1", viewId: "v", defaultDepth: 3 }),
      { wrapper: createWrapper(queryClient) },
    );

    act(() => {
      mockWsService._emit("relationsPurged", { channelId: "chan-1" });
    });

    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
  });

  it("does not call refetch when relations_purged fires for a different channel", async () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    mockUseViewTree.mockReturnValue(makeQueryResult({ refetch }));

    renderHook(
      () =>
        useTreeLoader({ channelId: "chan-1", viewId: "v", defaultDepth: 3 }),
      { wrapper: createWrapper(queryClient) },
    );

    act(() => {
      mockWsService._emit("relationsPurged", { channelId: "other-channel" });
    });

    expect(refetch).not.toHaveBeenCalled();
  });

  it("unsubscribes from WS events on unmount", () => {
    mockUseViewTree.mockReturnValue(makeQueryResult());

    const { unmount } = renderHook(
      () =>
        useTreeLoader({ channelId: "chan-1", viewId: "v", defaultDepth: 3 }),
      { wrapper: createWrapper(queryClient) },
    );

    const refetch = vi.fn().mockResolvedValue(undefined);
    mockUseViewTree.mockReturnValue(makeQueryResult({ refetch }));

    unmount();

    // After unmount, emitting events should NOT call refetch
    act(() => {
      mockWsService._emit("relationChanged", { channelId: "chan-1" });
      mockWsService._emit("relationsPurged", { channelId: "chan-1" });
    });

    expect(refetch).not.toHaveBeenCalled();
  });
});
