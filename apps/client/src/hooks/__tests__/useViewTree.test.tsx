import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TreeSnapshot } from "@/types/relations";

// ==================== Mocks ====================

const mockMessageRelationsApi = vi.hoisted(() => ({
  getMessageRelations: vi.fn(),
  getViewTree: vi.fn(),
}));

vi.mock("@/services/api/properties", () => ({
  messageRelationsApi: mockMessageRelationsApi,
  propertyDefinitionsApi: {},
  messagePropertiesApi: {},
  aiAutoFillApi: {},
  auditLogsApi: {},
  propertiesApi: {},
  default: {},
}));

// Import after mocks
import { useViewTree } from "../useViewTree";

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

const defaultOpts = { expandedIds: [] };

// ==================== Tests ====================

describe("useViewTree", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestClient();
  });

  it("does not fetch when channelId is empty string", () => {
    renderHook(() => useViewTree("", "view-1", defaultOpts), {
      wrapper: createWrapper(queryClient),
    });

    expect(mockMessageRelationsApi.getViewTree).not.toHaveBeenCalled();
  });

  it("does not fetch when viewId is empty string", () => {
    renderHook(() => useViewTree("ch-1", "", defaultOpts), {
      wrapper: createWrapper(queryClient),
    });

    expect(mockMessageRelationsApi.getViewTree).not.toHaveBeenCalled();
  });

  it("fetches tree with minimal options", async () => {
    mockMessageRelationsApi.getViewTree.mockResolvedValueOnce(emptySnapshot);

    const { result } = renderHook(
      () => useViewTree("ch-1", "view-1", defaultOpts),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockMessageRelationsApi.getViewTree).toHaveBeenCalledWith(
      "ch-1",
      "view-1",
      {
        maxDepth: undefined,
        expandedIds: [],
        cursor: undefined,
        limit: undefined,
        filter: undefined,
        sort: undefined,
      },
    );
    expect(result.current.data).toEqual(emptySnapshot);
  });

  it("fetches with all options", async () => {
    mockMessageRelationsApi.getViewTree.mockResolvedValueOnce(emptySnapshot);
    const filter = [{ field: "status", op: "eq", value: "open" }];
    const sort = [{ field: "createdAt", dir: "asc" }];
    const opts = {
      maxDepth: 3,
      expandedIds: ["m1", "m2"],
      cursor: "cursor-abc",
      limit: 20,
      filter,
      sort,
    };

    const { result } = renderHook(() => useViewTree("ch-1", "view-1", opts), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockMessageRelationsApi.getViewTree).toHaveBeenCalledWith(
      "ch-1",
      "view-1",
      opts,
    );
  });

  it("includes filter/sort in query key (different keys = separate fetches)", async () => {
    mockMessageRelationsApi.getViewTree.mockResolvedValue(emptySnapshot);

    renderHook(() => useViewTree("ch-1", "view-1", { expandedIds: [] }), {
      wrapper: createWrapper(queryClient),
    });
    renderHook(
      () =>
        useViewTree("ch-1", "view-1", {
          expandedIds: [],
          filter: { status: "open" },
        }),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() =>
      expect(mockMessageRelationsApi.getViewTree).toHaveBeenCalledTimes(2),
    );
  });

  it("returns error state on API failure", async () => {
    const error = new Error("Server error");
    mockMessageRelationsApi.getViewTree.mockRejectedValueOnce(error);

    const { result } = renderHook(
      () => useViewTree("ch-1", "view-1", defaultOpts),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBe(error);
  });

  it("returns populated tree snapshot", async () => {
    const snapshot: TreeSnapshot = {
      nodes: [
        {
          messageId: "m1",
          effectiveParentId: null,
          parentSource: null,
          depth: 0,
          hasChildren: true,
          childrenLoaded: false,
        },
        {
          messageId: "m2",
          effectiveParentId: "m1",
          parentSource: "relation",
          depth: 1,
          hasChildren: false,
          childrenLoaded: false,
        },
      ],
      nextCursor: null,
      ancestorsIncluded: [],
    };
    mockMessageRelationsApi.getViewTree.mockResolvedValueOnce(snapshot);

    const { result } = renderHook(
      () => useViewTree("ch-1", "view-1", defaultOpts),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.nodes).toHaveLength(2);
    expect(result.current.data?.nodes[0].messageId).toBe("m1");
    expect(result.current.data?.nodes[1].effectiveParentId).toBe("m1");
  });

  it("refetches when expandedIds change", async () => {
    mockMessageRelationsApi.getViewTree.mockResolvedValue(emptySnapshot);

    const { rerender } = renderHook(
      ({ expandedIds }: { expandedIds: string[] }) =>
        useViewTree("ch-1", "view-1", { expandedIds }),
      {
        initialProps: { expandedIds: [] as string[] },
        wrapper: createWrapper(queryClient),
      },
    );

    await waitFor(() =>
      expect(mockMessageRelationsApi.getViewTree).toHaveBeenCalledTimes(1),
    );

    rerender({ expandedIds: ["m1"] });

    await waitFor(() =>
      expect(mockMessageRelationsApi.getViewTree).toHaveBeenCalledTimes(2),
    );
  });
});
