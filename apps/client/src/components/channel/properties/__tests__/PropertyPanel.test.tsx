import { render, screen, fireEvent } from "@testing-library/react";
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
});
