import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { PropertyDefinition } from "@/types/properties";

// ==================== Mocks ====================

const mockDefinitions: PropertyDefinition[] = [];
const mockProperties: Record<string, unknown> = {};
const mockSetProperty = { mutate: vi.fn(), isPending: false };
const mockRemoveProperty = { mutate: vi.fn(), isPending: false };
const mockCreateDefinition = { mutate: vi.fn(), isPending: false };

vi.mock("@/hooks/usePropertyDefinitions", () => ({
  usePropertyDefinitions: () => ({ data: mockDefinitions }),
  useCreatePropertyDefinition: () => mockCreateDefinition,
}));

vi.mock("@/hooks/useMessageProperties", () => ({
  useMessageProperties: () => ({ data: mockProperties }),
  useSetProperty: () => mockSetProperty,
  useRemoveProperty: () => mockRemoveProperty,
}));

vi.mock("../AiAutoFillButton", () => ({
  AiAutoFillButton: () => <button data-testid="ai-auto-fill">AI</button>,
}));

const mockAiAutoFill = vi.fn();
vi.mock("@/services/api/properties", () => ({
  aiAutoFillApi: {
    autoFill: (...args: unknown[]) => mockAiAutoFill(...args),
  },
}));

const mockOpenChannelSettings = vi.fn();
vi.mock("@/stores", () => ({
  useChannelSettingsStore: (
    selector: (state: {
      openChannelSettings: typeof mockOpenChannelSettings;
    }) => unknown,
  ) => selector({ openChannelSettings: mockOpenChannelSettings }),
}));

// ==================== Helpers ====================

function makeDefinition(
  overrides: Partial<PropertyDefinition> = {},
): PropertyDefinition {
  return {
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
    ...overrides,
  };
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

let queryClient: QueryClient;

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

// Import after mocks
import { PropertyPanel } from "../PropertyPanel";
import { PropertySelector } from "../PropertySelector";

// ==================== PropertyPanel Tests ====================

describe("PropertyPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createQueryClient();
    // Reset shared mock data
    mockDefinitions.length = 0;
    Object.keys(mockProperties).forEach((k) => delete mockProperties[k]);
  });

  it("renders tags row and properties table", () => {
    mockDefinitions.push(
      makeDefinition({
        id: "def-tags",
        key: "_tags",
        valueType: "tags",
        isNative: true,
        config: {
          options: [
            { value: "bug", label: "Bug", color: "#ef4444" },
            { value: "feature", label: "Feature" },
          ],
        },
      }),
      makeDefinition({
        id: "def-priority",
        key: "priority",
        valueType: "number",
        order: 1,
      }),
    );
    Object.assign(mockProperties, {
      _tags: ["bug"],
      priority: 5,
    });

    render(<PropertyPanel channelId="ch-1" messageId="msg-1" />, {
      wrapper: Wrapper,
    });

    // Tags row
    expect(screen.getByText("Bug")).toBeInTheDocument();
    // Properties table has the key label
    expect(screen.getByText("priority")).toBeInTheDocument();
  });

  it("collapses properties when more than 5 rows", () => {
    // Create 7 property definitions with values
    for (let i = 0; i < 7; i++) {
      mockDefinitions.push(
        makeDefinition({
          id: `def-${i}`,
          key: `prop_${i}`,
          valueType: "text",
          order: i,
        }),
      );
      (mockProperties as Record<string, unknown>)[`prop_${i}`] = `value-${i}`;
    }

    render(<PropertyPanel channelId="ch-1" messageId="msg-1" />, {
      wrapper: Wrapper,
    });

    // Only first 5 rows visible
    expect(screen.getByText("prop_0")).toBeInTheDocument();
    expect(screen.getByText("prop_4")).toBeInTheDocument();
    expect(screen.queryByText("prop_5")).not.toBeInTheDocument();

    // Expand button shows count
    expect(screen.getByText(/Expand all \(7\)/)).toBeInTheDocument();
  });

  it("expand button shows all rows after click", async () => {
    for (let i = 0; i < 7; i++) {
      mockDefinitions.push(
        makeDefinition({
          id: `def-${i}`,
          key: `prop_${i}`,
          valueType: "text",
          order: i,
        }),
      );
      (mockProperties as Record<string, unknown>)[`prop_${i}`] = `value-${i}`;
    }

    render(<PropertyPanel channelId="ch-1" messageId="msg-1" />, {
      wrapper: Wrapper,
    });

    const expandBtn = screen.getByText(/Expand all/);
    fireEvent.click(expandBtn);

    // Now all 7 rows should be visible
    expect(screen.getByText("prop_5")).toBeInTheDocument();
    expect(screen.getByText("prop_6")).toBeInTheDocument();
    // Collapse button shown
    expect(screen.getByText("Collapse")).toBeInTheDocument();
  });

  it("returns null when no tags and no properties with values and no definitions", () => {
    // mockDefinitions is empty, mockProperties is empty
    const { container } = render(
      <PropertyPanel channelId="ch-1" messageId="msg-1" />,
      { wrapper: Wrapper },
    );

    expect(container.firstChild).toBeNull();
  });
});

// ==================== PropertySelector Tests ====================

describe("PropertySelector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createQueryClient();
    mockDefinitions.length = 0;
    Object.keys(mockProperties).forEach((k) => delete mockProperties[k]);
  });

  it("renders search input and property list when opened", async () => {
    mockDefinitions.push(
      makeDefinition({ id: "def-1", key: "status", valueType: "text" }),
      makeDefinition({ id: "def-2", key: "priority", valueType: "number" }),
    );

    render(
      <PropertySelector
        channelId="ch-1"
        messageId="msg-1"
        currentProperties={{}}
        onSetProperty={vi.fn()}
        open={true}
        onOpenChange={vi.fn()}
      />,
      { wrapper: Wrapper },
    );

    expect(
      screen.getByPlaceholderText("Search properties..."),
    ).toBeInTheDocument();
    expect(screen.getByText("status")).toBeInTheDocument();
    expect(screen.getByText("priority")).toBeInTheDocument();
  });

  it("filters properties by search term", async () => {
    mockDefinitions.push(
      makeDefinition({ id: "def-1", key: "status", valueType: "text" }),
      makeDefinition({ id: "def-2", key: "priority", valueType: "number" }),
      makeDefinition({ id: "def-3", key: "assignee", valueType: "person" }),
    );

    render(
      <PropertySelector
        channelId="ch-1"
        messageId="msg-1"
        currentProperties={{}}
        onSetProperty={vi.fn()}
        open={true}
        onOpenChange={vi.fn()}
      />,
      { wrapper: Wrapper },
    );

    const searchInput = screen.getByPlaceholderText("Search properties...");
    fireEvent.change(searchInput, { target: { value: "pri" } });

    // Only priority should be visible
    expect(screen.getByText("priority")).toBeInTheDocument();
    expect(screen.queryByText("status")).not.toBeInTheDocument();
    expect(screen.queryByText("assignee")).not.toBeInTheDocument();
  });

  it("shows 'set' indicator for properties that already have values", async () => {
    mockDefinitions.push(
      makeDefinition({ id: "def-1", key: "status", valueType: "text" }),
      makeDefinition({ id: "def-2", key: "priority", valueType: "number" }),
    );

    render(
      <PropertySelector
        channelId="ch-1"
        messageId="msg-1"
        currentProperties={{ status: "open" }}
        onSetProperty={vi.fn()}
        open={true}
        onOpenChange={vi.fn()}
      />,
      { wrapper: Wrapper },
    );

    expect(screen.getByText("set")).toBeInTheDocument();
  });

  it("shows 'No properties found' when search matches nothing", async () => {
    mockDefinitions.push(
      makeDefinition({ id: "def-1", key: "status", valueType: "text" }),
    );

    render(
      <PropertySelector
        channelId="ch-1"
        messageId="msg-1"
        currentProperties={{}}
        onSetProperty={vi.fn()}
        open={true}
        onOpenChange={vi.fn()}
      />,
      { wrapper: Wrapper },
    );

    const searchInput = screen.getByPlaceholderText("Search properties...");
    fireEvent.change(searchInput, { target: { value: "zzzzzzz" } });

    expect(screen.getByText("No properties found")).toBeInTheDocument();
  });

  it("hides AI auto-fill row when no definition has aiAutoFill enabled", () => {
    mockDefinitions.push(
      makeDefinition({
        id: "def-1",
        key: "status",
        valueType: "text",
        aiAutoFill: false,
      }),
    );

    render(
      <PropertySelector
        channelId="ch-1"
        messageId="msg-1"
        currentProperties={{}}
        onSetProperty={vi.fn()}
        open={true}
        onOpenChange={vi.fn()}
      />,
      { wrapper: Wrapper },
    );

    expect(screen.queryByText("AI auto-fill")).not.toBeInTheDocument();
  });

  it("shows AI auto-fill row when at least one definition has aiAutoFill enabled", () => {
    mockDefinitions.push(
      makeDefinition({
        id: "def-1",
        key: "status",
        valueType: "text",
        aiAutoFill: true,
      }),
    );

    render(
      <PropertySelector
        channelId="ch-1"
        messageId="msg-1"
        currentProperties={{}}
        onSetProperty={vi.fn()}
        open={true}
        onOpenChange={vi.fn()}
      />,
      { wrapper: Wrapper },
    );

    expect(screen.getByText("AI auto-fill")).toBeInTheDocument();
  });

  it("clicking AI auto-fill row calls aiAutoFillApi.autoFill and closes popover", async () => {
    mockAiAutoFill.mockResolvedValueOnce({ status: "accepted" });
    mockDefinitions.push(
      makeDefinition({
        id: "def-1",
        key: "status",
        valueType: "text",
        aiAutoFill: true,
      }),
    );
    const onOpenChange = vi.fn();

    render(
      <PropertySelector
        channelId="ch-1"
        messageId="msg-42"
        currentProperties={{}}
        onSetProperty={vi.fn()}
        open={true}
        onOpenChange={onOpenChange}
      />,
      { wrapper: Wrapper },
    );

    fireEvent.click(screen.getByText("AI auto-fill"));

    await waitFor(() => {
      expect(mockAiAutoFill).toHaveBeenCalledWith("msg-42", {
        preserveExisting: true,
      });
    });
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("clicking settings icon opens channel settings on properties tab and closes popover", () => {
    mockDefinitions.push(
      makeDefinition({ id: "def-1", key: "status", valueType: "text" }),
    );
    const onOpenChange = vi.fn();

    render(
      <PropertySelector
        channelId="ch-9"
        messageId="msg-1"
        currentProperties={{}}
        onSetProperty={vi.fn()}
        open={true}
        onOpenChange={onOpenChange}
      />,
      { wrapper: Wrapper },
    );

    fireEvent.click(screen.getByTitle("Manage properties"));

    expect(mockOpenChannelSettings).toHaveBeenCalledWith("ch-9", "properties");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows error text when AI auto-fill request fails", async () => {
    mockAiAutoFill.mockRejectedValueOnce(new Error("boom"));
    mockDefinitions.push(
      makeDefinition({
        id: "def-1",
        key: "status",
        valueType: "text",
        aiAutoFill: true,
      }),
    );

    render(
      <PropertySelector
        channelId="ch-1"
        messageId="msg-1"
        currentProperties={{}}
        onSetProperty={vi.fn()}
        open={true}
        onOpenChange={vi.fn()}
      />,
      { wrapper: Wrapper },
    );

    fireEvent.click(screen.getByText("AI auto-fill"));

    await waitFor(() => {
      expect(screen.getByText("AI failed")).toBeInTheDocument();
    });
  });
});

// ==================== Task Relation Helpers Tests ====================

import { resolveUniqueKey, hasParentRelationDef } from "../PropertySelector";

describe("resolveUniqueKey", () => {
  it("returns base key when no conflict", () => {
    expect(resolveUniqueKey("parentMessage", [])).toBe("parentMessage");
  });

  it("returns base key when existing keys are different", () => {
    expect(
      resolveUniqueKey("parentMessage", [{ key: "other" }, { key: "foo" }]),
    ).toBe("parentMessage");
  });

  it("returns base-2 when base key exists", () => {
    expect(resolveUniqueKey("parentMessage", [{ key: "parentMessage" }])).toBe(
      "parentMessage-2",
    );
  });

  it("skips -2 if it also exists and returns -3", () => {
    expect(
      resolveUniqueKey("parentMessage", [
        { key: "parentMessage" },
        { key: "parentMessage-2" },
      ]),
    ).toBe("parentMessage-3");
  });

  it("falls back to timestamp suffix after 99 conflicts", () => {
    const defs = [{ key: "k" }];
    for (let n = 2; n < 100; n++) defs.push({ key: `k-${n}` });
    const result = resolveUniqueKey("k", defs);
    // Should be "k-<timestamp>" — starts with "k-" and suffix is numeric
    expect(result.startsWith("k-")).toBe(true);
    expect(Number(result.slice(2))).toBeGreaterThan(0);
  });
});

describe("hasParentRelationDef", () => {
  it("returns false for empty array", () => {
    expect(hasParentRelationDef([])).toBe(false);
  });

  it("returns false when no message_ref type exists", () => {
    expect(hasParentRelationDef([{ valueType: "text", config: {} }])).toBe(
      false,
    );
  });

  it("returns false when message_ref exists but no relationKind", () => {
    expect(
      hasParentRelationDef([
        { valueType: "message_ref", config: { cardinality: "single" } },
      ]),
    ).toBe(false);
  });

  it("returns false when message_ref has relationKind=related", () => {
    expect(
      hasParentRelationDef([
        {
          valueType: "message_ref",
          config: { relationKind: "related" },
        },
      ]),
    ).toBe(false);
  });

  it("returns true when message_ref has relationKind=parent", () => {
    expect(
      hasParentRelationDef([
        {
          valueType: "message_ref",
          config: { relationKind: "parent" },
        },
      ]),
    ).toBe(true);
  });

  it("handles undefined config gracefully", () => {
    expect(
      hasParentRelationDef([{ valueType: "message_ref", config: undefined }]),
    ).toBe(false);
  });
});

// ==================== PropertySelector Task Relation Shortcuts Tests ====================

describe("PropertySelector — task relation shortcuts", () => {
  const defaultProps = {
    channelId: "c1",
    messageId: "msg-1",
    currentProperties: {},
    onSetProperty: vi.fn(),
    open: true,
    onOpenChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createQueryClient();
    mockDefinitions.length = 0;
    Object.keys(mockProperties).forEach((k) => delete mockProperties[k]);
    // Provide a default success behavior for createMutation.mutate
    mockCreateDefinition.mutate.mockImplementation(
      (
        dto: unknown,
        opts?: { onSuccess?: (def: PropertyDefinition) => void },
      ) => {
        opts?.onSuccess?.(
          makeDefinition({ id: "new-def", key: (dto as { key: string }).key }),
        );
      },
    );
  });

  it("shows 任务关系 section with 父任务 and 关联任务 entries", () => {
    render(<PropertySelector {...defaultProps} />, { wrapper: Wrapper });

    expect(screen.getByText("任务关系")).toBeInTheDocument();
    expect(screen.getByText("父任务")).toBeInTheDocument();
    expect(screen.getByText("关联任务")).toBeInTheDocument();
  });

  it("clicking 父任务 creates definition with expected config", () => {
    render(<PropertySelector {...defaultProps} />, { wrapper: Wrapper });

    fireEvent.click(screen.getByText("父任务"));

    expect(mockCreateDefinition.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "parentMessage",
        valueType: "message_ref",
        config: {
          scope: "same_channel",
          cardinality: "single",
          relationKind: "parent",
        },
      }),
      expect.any(Object),
    );
  });

  it("clicking 关联任务 creates definition with expected config", () => {
    render(<PropertySelector {...defaultProps} />, { wrapper: Wrapper });

    fireEvent.click(screen.getByText("关联任务"));

    expect(mockCreateDefinition.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "relatedMessages",
        valueType: "message_ref",
        config: {
          scope: "same_channel",
          cardinality: "multi",
          relationKind: "related",
        },
      }),
      expect.any(Object),
    );
  });

  it("disables 父任务 when a parent definition already exists", () => {
    mockDefinitions.push(
      makeDefinition({
        id: "def-parent",
        key: "parentMessage",
        valueType: "message_ref",
        config: { relationKind: "parent" },
      }),
    );

    render(<PropertySelector {...defaultProps} />, { wrapper: Wrapper });

    const btn = screen.getByText("父任务").closest("button");
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", "此频道已有父任务属性");
  });

  it("does not disable 关联任务 when a parent definition already exists", () => {
    mockDefinitions.push(
      makeDefinition({
        id: "def-parent",
        key: "parentMessage",
        valueType: "message_ref",
        config: { relationKind: "parent" },
      }),
    );

    render(<PropertySelector {...defaultProps} />, { wrapper: Wrapper });

    const btn = screen.getByText("关联任务").closest("button");
    expect(btn).not.toBeDisabled();
  });

  it("auto-suffixes key to parentMessage-2 when parentMessage key already used", () => {
    mockDefinitions.push(
      makeDefinition({
        id: "def-text",
        key: "parentMessage",
        valueType: "text",
        config: {},
      }),
    );

    render(<PropertySelector {...defaultProps} />, { wrapper: Wrapper });

    fireEvent.click(screen.getByText("父任务"));

    expect(mockCreateDefinition.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ key: "parentMessage-2" }),
      expect.any(Object),
    );
  });

  it("auto-suffixes key to relatedMessages-2 when relatedMessages key already used", () => {
    mockDefinitions.push(
      makeDefinition({
        id: "def-existing",
        key: "relatedMessages",
        valueType: "text",
        config: {},
      }),
    );

    render(<PropertySelector {...defaultProps} />, { wrapper: Wrapper });

    fireEvent.click(screen.getByText("关联任务"));

    expect(mockCreateDefinition.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ key: "relatedMessages-2" }),
      expect.any(Object),
    );
  });
});
