import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Message } from "@/types/im";
import type { PropertyDefinition } from "@/types/properties";

// ==================== Mocks ====================

vi.mock("@/components/ui/user-avatar", () => ({
  UserAvatar: ({ userId }: { userId: string }) => (
    <span data-testid={`avatar-${userId}`}>{userId}</span>
  ),
}));

vi.mock("../AiAutoFillButton", () => ({
  AiAutoFillButton: () => <button data-testid="ai-auto-fill">AI</button>,
}));

const propertySelectorProps = vi.fn();
vi.mock("../PropertySelector", () => ({
  PropertySelector: (props: {
    trigger?: React.ReactNode;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }) => {
    propertySelectorProps(props);
    return (
      <div data-testid="property-selector" data-open={String(props.open)}>
        {props.trigger ?? null}
      </div>
    );
  },
}));

vi.mock("@/hooks/useMessageProperties", () => ({
  useSetProperty: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveProperty: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/useChannels", () => ({
  useChannelMembers: () => ({ data: [] }),
}));

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
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

function makeMessage(
  overrides: Partial<Message> & { properties?: Record<string, unknown> } = {},
): Message {
  return {
    id: "msg-1",
    channelId: "ch-1",
    senderId: "user-1",
    parentId: null,
    rootId: null,
    content: "Hello world",
    type: "text",
    isPinned: false,
    isEdited: false,
    isDeleted: false,
    createdAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-04-01T00:00:00Z",
    properties: {},
    ...overrides,
  } as Message;
}

// Import after mocks
import { MessageProperties } from "../MessageProperties";

// ==================== Tests ====================

describe("MessageProperties", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders property chips for a message with properties", () => {
    const definitions = [
      makeDefinition({ id: "def-1", key: "priority", valueType: "number" }),
      makeDefinition({
        id: "def-2",
        key: "status",
        valueType: "single_select",
        config: {
          options: [
            { value: "open", label: "Open", color: "#22c55e" },
            { value: "closed", label: "Closed" },
          ],
        },
      }),
    ];
    const message = makeMessage({
      properties: { priority: 5, status: "open" },
    });

    render(
      <MessageProperties
        message={message}
        channelId="ch-1"
        definitions={definitions}
        canEdit={false}
      />,
    );

    // Number property renders with label
    expect(screen.getByText("Priority:")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    // Select renders as tag
    expect(screen.getByText("Open")).toBeInTheDocument();
  });

  it("hides property when showInChatPolicy is 'hide'", () => {
    const definitions = [
      makeDefinition({
        id: "def-1",
        key: "secret",
        valueType: "text",
        showInChatPolicy: "hide",
      }),
    ];
    const message = makeMessage({ properties: { secret: "hidden value" } });

    const { container } = render(
      <MessageProperties
        message={message}
        channelId="ch-1"
        definitions={definitions}
        canEdit={false}
      />,
    );

    expect(screen.queryByText("hidden value")).not.toBeInTheDocument();
    // No visible content at all -> null render
    expect(container.firstChild).toBeNull();
  });

  it("includes show-policy definitions in visible list even without value", () => {
    const definitions = [
      makeDefinition({
        id: "def-1",
        key: "notes",
        valueType: "text",
        showInChatPolicy: "show",
      }),
    ];
    const message = makeMessage({ properties: {} });

    const { container } = render(
      <MessageProperties
        message={message}
        channelId="ch-1"
        definitions={definitions}
        canEdit={true}
      />,
    );

    // The component renders (canEdit is true, there are visible definitions)
    // The definition with "show" policy passes the filter,
    // but PropertyValue returns null for null/undefined value,
    // so the label won't appear. However the edit button should be present.
    // The wrapper container is rendered (not null).
    expect(container.firstChild).not.toBeNull();
  });

  it("auto policy shows when value exists, hides when empty", () => {
    const definitions = [
      makeDefinition({
        id: "def-1",
        key: "title",
        valueType: "text",
        showInChatPolicy: "auto",
      }),
      makeDefinition({
        id: "def-2",
        key: "empty_field",
        valueType: "text",
        showInChatPolicy: "auto",
      }),
    ];
    const message = makeMessage({
      properties: { title: "My Title" },
    });

    render(
      <MessageProperties
        message={message}
        channelId="ch-1"
        definitions={definitions}
        canEdit={false}
      />,
    );

    expect(screen.getByText("My Title")).toBeInTheDocument();
    expect(screen.queryByText("Empty field:")).not.toBeInTheDocument();
  });

  it("uses property key (not definition ID) to look up values", () => {
    const definitions = [
      makeDefinition({
        id: "def-uuid-123",
        key: "priority",
        valueType: "number",
      }),
    ];
    // The properties map is keyed by `key`, not by `id`
    const message = makeMessage({ properties: { priority: 10 } });

    render(
      <MessageProperties
        message={message}
        channelId="ch-1"
        definitions={definitions}
        canEdit={false}
      />,
    );

    expect(screen.getByText("10")).toBeInTheDocument();
  });

  it("PropertyValue formats numbers correctly", () => {
    const definitions = [
      makeDefinition({
        id: "def-1",
        key: "count",
        valueType: "number",
      }),
    ];
    const message = makeMessage({ properties: { count: 1234 } });

    render(
      <MessageProperties
        message={message}
        channelId="ch-1"
        definitions={definitions}
        canEdit={false}
      />,
    );

    // toLocaleString formats 1234 -> "1,234"
    expect(screen.getByText("1,234")).toBeInTheDocument();
  });

  it("PropertyValue formats booleans correctly", () => {
    const definitions = [
      makeDefinition({
        id: "def-1",
        key: "active",
        valueType: "boolean",
      }),
    ];
    const message = makeMessage({ properties: { active: true } });

    render(
      <MessageProperties
        message={message}
        channelId="ch-1"
        definitions={definitions}
        canEdit={false}
      />,
    );

    // Boolean true renders as a Check icon, not text
    // The wrapper should exist with label "Active:"
    expect(screen.getByText("Active:")).toBeInTheDocument();
  });

  it("does not render [object Object] for structured values", () => {
    const definitions = [
      makeDefinition({
        id: "def-1",
        key: "range",
        valueType: "date_range",
      }),
    ];
    const message = makeMessage({
      properties: {
        range: { start: "2026-04-01", end: "2026-04-10" },
      },
    });

    render(
      <MessageProperties
        message={message}
        channelId="ch-1"
        definitions={definitions}
        canEdit={false}
      />,
    );

    expect(screen.queryByText("[object Object]")).not.toBeInTheDocument();
  });

  it("shows [...] button when properties exist and canEdit", () => {
    const definitions = [
      makeDefinition({ id: "def-1", key: "status", valueType: "text" }),
    ];
    const message = makeMessage({ properties: { status: "open" } });

    render(
      <MessageProperties
        message={message}
        channelId="ch-1"
        definitions={definitions}
        canEdit={true}
      />,
    );

    const editBtn = screen.getByTitle("Edit properties");
    expect(editBtn).toBeInTheDocument();
  });

  it("shows [+] button when no property values and canEdit", () => {
    const definitions = [
      makeDefinition({
        id: "def-1",
        key: "status",
        valueType: "text",
        showInChatPolicy: "show",
      }),
    ];
    const message = makeMessage({ properties: {} });

    render(
      <MessageProperties
        message={message}
        channelId="ch-1"
        definitions={definitions}
        canEdit={true}
      />,
    );

    const addBtn = screen.getByTitle("Add properties");
    expect(addBtn).toBeInTheDocument();
  });

  it("renders tags as individual tag chips", () => {
    const definitions = [
      makeDefinition({
        id: "def-1",
        key: "_tags",
        valueType: "tags",
        isNative: true,
        config: {
          options: [
            { value: "bug", label: "Bug", color: "#ef4444" },
            { value: "feature", label: "Feature", color: "#3b82f6" },
          ],
        },
      }),
    ];
    const message = makeMessage({
      properties: { _tags: ["bug", "feature"] },
    });

    render(
      <MessageProperties
        message={message}
        channelId="ch-1"
        definitions={definitions}
        canEdit={false}
      />,
    );

    expect(screen.getByText("Bug")).toBeInTheDocument();
    expect(screen.getByText("Feature")).toBeInTheDocument();
  });

  it("returns null when no definitions, no visible content, and canEdit is false", () => {
    const message = makeMessage({ properties: {} });

    const { container } = render(
      <MessageProperties
        message={message}
        channelId="ch-1"
        definitions={[]}
        canEdit={false}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("forwards selectorOpen/onSelectorOpenChange to the embedded PropertySelector", () => {
    propertySelectorProps.mockClear();
    const definitions = [
      makeDefinition({ id: "def-1", key: "status", valueType: "text" }),
    ];
    const message = makeMessage({ properties: { status: "open" } });
    const handleOpenChange = vi.fn();

    render(
      <MessageProperties
        message={message}
        channelId="ch-1"
        definitions={definitions}
        canEdit={true}
        selectorOpen={true}
        onSelectorOpenChange={handleOpenChange}
      />,
    );

    expect(propertySelectorProps).toHaveBeenCalled();
    const last = propertySelectorProps.mock.calls.at(-1)?.[0];
    expect(last.open).toBe(true);
    expect(last.onOpenChange).toBe(handleOpenChange);
    // Trigger button lives inside the PropertySelector mock's output
    expect(screen.getByTitle("Edit properties")).toBeInTheDocument();
  });

  it("does not embed PropertySelector when canEdit is false", () => {
    const definitions = [
      makeDefinition({ id: "def-1", key: "status", valueType: "text" }),
    ];
    const message = makeMessage({ properties: { status: "open" } });

    render(
      <MessageProperties
        message={message}
        channelId="ch-1"
        definitions={definitions}
        canEdit={false}
      />,
    );

    expect(screen.queryByTestId("property-selector")).not.toBeInTheDocument();
  });

  it("shows loading shimmer when aiAutoFillLoading is true", () => {
    const definitions = [
      makeDefinition({ id: "def-1", key: "status", valueType: "text" }),
    ];
    const message = makeMessage({ properties: {} });

    const { container } = render(
      <MessageProperties
        message={message}
        channelId="ch-1"
        definitions={definitions}
        canEdit={false}
        aiAutoFillLoading={true}
      />,
    );

    // Shimmer pulse elements are rendered
    const pulseElements = container.querySelectorAll(".animate-pulse");
    expect(pulseElements.length).toBeGreaterThan(0);
  });
});
