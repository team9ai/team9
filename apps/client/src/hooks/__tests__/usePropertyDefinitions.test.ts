import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PropertyDefinition } from "@/types/properties";

// ==================== Mock data ====================

const sampleDefinitions: PropertyDefinition[] = [
  {
    id: "def-1",
    channelId: "ch-1",
    key: "status",
    description: null,
    valueType: "text",
    isNative: false,
    config: {},
    order: 0,
    aiAutoFill: false,
    aiAutoFillPrompt: null,
    isRequired: false,
    defaultValue: null,
    showInChatPolicy: "auto",
    allowNewOptions: false,
    createdBy: null,
    createdAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-04-01T00:00:00Z",
  },
];

// ==================== Mocks ====================

const mockPropertyDefinitionsApi = vi.hoisted(() => ({
  getDefinitions: vi.fn(),
  createDefinition: vi.fn(),
  updateDefinition: vi.fn(),
  deleteDefinition: vi.fn(),
  reorderDefinitions: vi.fn(),
}));

const mockMessagePropertiesApi = vi.hoisted(() => ({
  getMessageProperties: vi.fn(),
  setProperty: vi.fn(),
  removeProperty: vi.fn(),
  batchSetProperties: vi.fn(),
}));

const mockTabsApi = vi.hoisted(() => ({
  getTabs: vi.fn(),
  createTab: vi.fn(),
  updateTab: vi.fn(),
  deleteTab: vi.fn(),
  reorderTabs: vi.fn(),
}));

const mockViewsApi = vi.hoisted(() => ({
  getViews: vi.fn(),
  createView: vi.fn(),
  updateView: vi.fn(),
  deleteView: vi.fn(),
  getViewMessages: vi.fn(),
}));

vi.mock("@/services/api/properties", () => ({
  propertyDefinitionsApi: mockPropertyDefinitionsApi,
  messagePropertiesApi: mockMessagePropertiesApi,
}));

vi.mock("@/services/api/views", () => ({
  tabsApi: mockTabsApi,
  viewsApi: mockViewsApi,
}));

vi.mock("@/services/websocket", () => ({
  default: {
    onPropertyDefinitionCreated: vi.fn(),
    onPropertyDefinitionUpdated: vi.fn(),
    onPropertyDefinitionDeleted: vi.fn(),
    offPropertyDefinitionCreated: vi.fn(),
    offPropertyDefinitionUpdated: vi.fn(),
    offPropertyDefinitionDeleted: vi.fn(),
    onMessagePropertyChanged: vi.fn(),
    offMessagePropertyChanged: vi.fn(),
    onTabCreated: vi.fn(),
    onTabUpdated: vi.fn(),
    onTabDeleted: vi.fn(),
    offTabCreated: vi.fn(),
    offTabUpdated: vi.fn(),
    offTabDeleted: vi.fn(),
    onViewCreated: vi.fn(),
    onViewUpdated: vi.fn(),
    onViewDeleted: vi.fn(),
    offViewCreated: vi.fn(),
    offViewUpdated: vi.fn(),
    offViewDeleted: vi.fn(),
  },
}));

// Import after mocks
import { usePropertyDefinitions } from "../usePropertyDefinitions";
import { useSetProperty, useRemoveProperty } from "../useMessageProperties";
import { useChannelTabs } from "../useChannelTabs";
import { useChannelViews } from "../useChannelViews";

// ==================== Test helpers ====================

function createTestClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
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

// ==================== usePropertyDefinitions ====================

describe("usePropertyDefinitions", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestClient();
  });

  it("fetches definitions on mount", async () => {
    mockPropertyDefinitionsApi.getDefinitions.mockResolvedValueOnce(
      sampleDefinitions,
    );

    const { result } = renderHook(() => usePropertyDefinitions("ch-1"), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(sampleDefinitions);
    });

    expect(mockPropertyDefinitionsApi.getDefinitions).toHaveBeenCalledWith(
      "ch-1",
    );
  });

  it("does not fetch when channelId is undefined", () => {
    const { result } = renderHook(() => usePropertyDefinitions(undefined), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.data).toBeUndefined();
    expect(result.current.isFetching).toBe(false);
    expect(mockPropertyDefinitionsApi.getDefinitions).not.toHaveBeenCalled();
  });

  it("returns cached data on staleTime", async () => {
    mockPropertyDefinitionsApi.getDefinitions.mockResolvedValue(
      sampleDefinitions,
    );

    const { result, rerender } = renderHook(
      () => usePropertyDefinitions("ch-1"),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => {
      expect(result.current.data).toEqual(sampleDefinitions);
    });

    // Rerender — should use cached data, not refetch
    rerender();

    expect(mockPropertyDefinitionsApi.getDefinitions).toHaveBeenCalledTimes(1);
  });
});

// ==================== useSetProperty ====================

describe("useSetProperty", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestClient();
  });

  it("calls API with correct params", async () => {
    mockMessagePropertiesApi.setProperty.mockResolvedValueOnce({
      success: true,
    });

    const { result } = renderHook(() => useSetProperty("msg-1", "ch-1"), {
      wrapper: createWrapper(queryClient),
    });

    act(() => {
      result.current.mutate({
        definitionId: "def-1",
        propertyKey: "status",
        value: "open",
      });
    });

    await waitFor(() => {
      expect(mockMessagePropertiesApi.setProperty).toHaveBeenCalledWith(
        "msg-1",
        "def-1",
        "open",
      );
    });
  });
});

// ==================== useRemoveProperty ====================

describe("useRemoveProperty", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestClient();
  });

  it("calls API with correct params", async () => {
    mockMessagePropertiesApi.removeProperty.mockResolvedValueOnce({
      success: true,
    });

    const { result } = renderHook(() => useRemoveProperty("msg-1", "ch-1"), {
      wrapper: createWrapper(queryClient),
    });

    act(() => {
      result.current.mutate({
        definitionId: "def-1",
        propertyKey: "status",
      });
    });

    await waitFor(() => {
      expect(mockMessagePropertiesApi.removeProperty).toHaveBeenCalledWith(
        "msg-1",
        "def-1",
      );
    });
  });
});

// ==================== useChannelTabs ====================

describe("useChannelTabs", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestClient();
  });

  it("fetches tabs on mount", async () => {
    const sampleTabs = [
      {
        id: "tab-1",
        channelId: "ch-1",
        name: "Messages",
        type: "messages",
        viewId: null,
        isBuiltin: true,
        order: 0,
        createdBy: null,
        createdAt: "2026-04-01T00:00:00Z",
        updatedAt: "2026-04-01T00:00:00Z",
      },
    ];
    mockTabsApi.getTabs.mockResolvedValueOnce(sampleTabs);

    const { result } = renderHook(() => useChannelTabs("ch-1"), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(sampleTabs);
    });

    expect(mockTabsApi.getTabs).toHaveBeenCalledWith("ch-1");
  });

  it("does not fetch when channelId is undefined", () => {
    const { result } = renderHook(() => useChannelTabs(undefined), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.data).toBeUndefined();
    expect(mockTabsApi.getTabs).not.toHaveBeenCalled();
  });
});

// ==================== useChannelViews ====================

describe("useChannelViews", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestClient();
  });

  it("fetches views on mount", async () => {
    const sampleViews = [
      {
        id: "view-1",
        channelId: "ch-1",
        name: "Table",
        type: "table",
        config: {},
        order: 0,
        createdBy: null,
        createdAt: "2026-04-01T00:00:00Z",
        updatedAt: "2026-04-01T00:00:00Z",
      },
    ];
    mockViewsApi.getViews.mockResolvedValueOnce(sampleViews);

    const { result } = renderHook(() => useChannelViews("ch-1"), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(sampleViews);
    });

    expect(mockViewsApi.getViews).toHaveBeenCalledWith("ch-1");
  });

  it("does not fetch when channelId is undefined", () => {
    const { result } = renderHook(() => useChannelViews(undefined), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.data).toBeUndefined();
    expect(mockViewsApi.getViews).not.toHaveBeenCalled();
  });
});
