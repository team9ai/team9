import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RelationInspectionResult } from "@/types/relations";

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
import { useMessageRelations } from "../useMessageRelations";

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

const emptyResult: RelationInspectionResult = {
  outgoing: { parent: [], related: [] },
  incoming: { children: [], relatedBy: [] },
};

// ==================== Tests ====================

describe("useMessageRelations", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestClient();
  });

  it("does not fetch when messageId is undefined", () => {
    const { result } = renderHook(() => useMessageRelations(undefined), {
      wrapper: createWrapper(queryClient),
    });

    expect(mockMessageRelationsApi.getMessageRelations).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("fetches relations with default depth=1", async () => {
    mockMessageRelationsApi.getMessageRelations.mockResolvedValueOnce(
      emptyResult,
    );

    const { result } = renderHook(() => useMessageRelations("m1"), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockMessageRelationsApi.getMessageRelations).toHaveBeenCalledWith(
      "m1",
      { depth: 1 },
    );
    expect(result.current.data).toEqual(emptyResult);
  });

  it("fetches relations with custom depth", async () => {
    mockMessageRelationsApi.getMessageRelations.mockResolvedValueOnce(
      emptyResult,
    );

    const { result } = renderHook(() => useMessageRelations("m1", 3), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockMessageRelationsApi.getMessageRelations).toHaveBeenCalledWith(
      "m1",
      { depth: 3 },
    );
  });

  it("is enabled when messageId is defined", () => {
    mockMessageRelationsApi.getMessageRelations.mockResolvedValueOnce(
      emptyResult,
    );

    renderHook(() => useMessageRelations("m1"), {
      wrapper: createWrapper(queryClient),
    });

    expect(mockMessageRelationsApi.getMessageRelations).toHaveBeenCalledWith(
      "m1",
      { depth: 1 },
    );
  });

  it("returns error state on API failure", async () => {
    const error = new Error("Network error");
    mockMessageRelationsApi.getMessageRelations.mockRejectedValueOnce(error);

    const { result } = renderHook(() => useMessageRelations("m1"), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBe(error);
  });

  it("uses different query keys for different depths", async () => {
    mockMessageRelationsApi.getMessageRelations.mockResolvedValue(emptyResult);

    renderHook(() => useMessageRelations("m1", 1), {
      wrapper: createWrapper(queryClient),
    });
    renderHook(() => useMessageRelations("m1", 2), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() =>
      expect(mockMessageRelationsApi.getMessageRelations).toHaveBeenCalledTimes(
        2,
      ),
    );
  });

  it("returns populated relation data", async () => {
    const withData: RelationInspectionResult = {
      outgoing: {
        parent: [
          {
            messageId: "parent-1",
            depth: 1,
            propertyDefinitionId: "def-1",
            parentSource: "relation",
          },
        ],
        related: [],
      },
      incoming: {
        children: [
          {
            messageId: "child-1",
            depth: 1,
            propertyDefinitionId: "def-1",
            parentSource: "relation",
          },
        ],
        relatedBy: [],
      },
    };
    mockMessageRelationsApi.getMessageRelations.mockResolvedValueOnce(withData);

    const { result } = renderHook(() => useMessageRelations("m1"), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.outgoing.parent).toHaveLength(1);
    expect(result.current.data?.incoming.children).toHaveLength(1);
  });
});
