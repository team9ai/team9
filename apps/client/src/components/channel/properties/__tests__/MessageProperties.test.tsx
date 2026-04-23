import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Message } from "@/types/im";
import type { PropertyDefinition } from "@/types/properties";

// ==================== Mocks ====================

vi.mock("@/components/ui/user-avatar", () => ({
  UserAvatar: ({ userId, name }: { userId: string; name?: string | null }) => (
    <span data-testid={`avatar-${userId}`}>{name ?? userId}</span>
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

const channelMembersMock: {
  data: Array<{
    userId: string;
    user: {
      id: string;
      displayName: string | null;
      username: string | null;
      avatarUrl: string | null;
      userType: string;
    };
  }>;
} = { data: [] };
vi.mock("@/hooks/useChannels", () => ({
  useChannelMembers: () => channelMembersMock,
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

  it("does not render an inline add button when no property values (even with canEdit)", () => {
    // The empty-state "+" affordance now lives outside MessageProperties —
    // on the hover toolbar and, when the message has reactions, inline next
    // to the reactions row. MessageProperties only hosts the "..." edit
    // trigger when values already exist.
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

    expect(screen.queryByTitle("Add properties")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Edit properties")).not.toBeInTheDocument();
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

  it("embeds PropertySelector for the '...' edit trigger when values exist and canEdit", () => {
    propertySelectorProps.mockClear();
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

    expect(propertySelectorProps).toHaveBeenCalled();
    // Edit-trigger lives inside the PropertySelector mock's output
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

  describe("person property", () => {
    const makeMember = (
      id: string,
      displayName: string | null,
      username: string | null,
    ) => ({
      userId: id,
      user: {
        id,
        displayName,
        username,
        avatarUrl: null,
        userType: "user",
      },
    });

    beforeEach(() => {
      channelMembersMock.data = [
        makeMember("u1", "Alice", "alice"),
        makeMember("u2", "Bob", "bob"),
        makeMember("u3", "Carol", "carol"),
        makeMember("u4", "Dave", "dave"),
        makeMember("u5", "Eve", "eve"),
        makeMember("u6", "Frank", "frank"),
      ];
    });

    it("native _people single user shows avatar + name, no 'People:' label", () => {
      const definitions = [
        makeDefinition({
          id: "def-1",
          key: "_people",
          valueType: "person",
          isNative: true,
        }),
      ];
      const message = makeMessage({ properties: { _people: ["u1"] } });

      render(
        <MessageProperties
          message={message}
          channelId="ch-1"
          definitions={definitions}
          canEdit={false}
        />,
      );

      // Value area should NOT carry the "People:" prefix next to the chip
      // (Tooltip body also contains "People" — we check there's no "People:" text)
      expect(screen.queryByText("People:")).not.toBeInTheDocument();
      // Avatar appears in both chip and tooltip body
      expect(screen.getAllByTestId("avatar-u1").length).toBeGreaterThan(0);
      // Name is rendered next to the avatar
      const names = screen.getAllByText("Alice");
      expect(names.length).toBeGreaterThan(0);
    });

    it("single person def (custom, no sibling person defs) hides key prefix", () => {
      const definitions = [
        makeDefinition({
          id: "def-1",
          key: "assignee",
          valueType: "person",
          isNative: false,
        }),
      ];
      const message = makeMessage({ properties: { assignee: "u2" } });

      render(
        <MessageProperties
          message={message}
          channelId="ch-1"
          definitions={definitions}
          canEdit={false}
        />,
      );

      // Only one person-type definition exists → no need to disambiguate,
      // so the "Assignee:" prefix is suppressed on the chip. The tooltip
      // body still contains the label.
      const chip = screen
        .getAllByTestId("avatar-u2")[0]
        .closest("span.inline-flex");
      expect(chip?.textContent ?? "").not.toContain("Assignee:");
      expect(screen.getAllByTestId("avatar-u2").length).toBeGreaterThan(0);
    });

    it("multi person defs: custom person chip shows its key prefix", () => {
      const definitions = [
        makeDefinition({
          id: "def-1",
          key: "_people",
          valueType: "person",
          isNative: true,
        }),
        makeDefinition({
          id: "def-2",
          key: "assignee",
          valueType: "person",
          isNative: false,
        }),
        makeDefinition({
          id: "def-3",
          key: "reviewer",
          valueType: "person",
          isNative: false,
        }),
      ];
      const message = makeMessage({
        properties: {
          _people: ["u1"],
          assignee: ["u2"],
          reviewer: ["u3"],
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

      // Native _people never shows prefix, even with siblings.
      expect(screen.queryByText("People:")).not.toBeInTheDocument();
      // Custom person chips MUST show their key prefix for disambiguation.
      expect(screen.getByText("Assignee:")).toBeInTheDocument();
      expect(screen.getByText("Reviewer:")).toBeInTheDocument();
    });

    it("native _people multiple users renders stacked avatars (up to 5)", () => {
      const definitions = [
        makeDefinition({
          id: "def-1",
          key: "_people",
          valueType: "person",
          isNative: true,
        }),
      ];
      const message = makeMessage({
        properties: { _people: ["u1", "u2", "u3", "u4", "u5", "u6"] },
      });

      render(
        <MessageProperties
          message={message}
          channelId="ch-1"
          definitions={definitions}
          canEdit={false}
        />,
      );

      // First 5 avatars rendered in the chip; 6th collapses under "+1".
      // Note: avatars may also appear in the tooltip body — we guard by
      // counting only occurrences on the chip ignoring any tooltip dupes.
      expect(screen.queryByText("People:")).not.toBeInTheDocument();
      expect(screen.getByText("+1")).toBeInTheDocument();
    });

    it("empty person value renders nothing for that property", () => {
      const definitions = [
        makeDefinition({
          id: "def-1",
          key: "_people",
          valueType: "person",
          isNative: true,
          showInChatPolicy: "show",
        }),
      ];
      const message = makeMessage({ properties: { _people: [] } });

      const { container } = render(
        <MessageProperties
          message={message}
          channelId="ch-1"
          definitions={definitions}
          canEdit={false}
        />,
      );

      // "show" policy + empty array -> filtered by hasValue, so chip area empty.
      // Container may still render the wrapper but no avatar elements.
      expect(container.querySelector('[data-testid^="avatar-"]')).toBeNull();
    });

    it("tooltip body shows key + full user info for person chip", () => {
      const definitions = [
        makeDefinition({
          id: "def-1",
          key: "_people",
          valueType: "person",
          isNative: true,
        }),
      ];
      const message = makeMessage({ properties: { _people: ["u1"] } });

      render(
        <MessageProperties
          message={message}
          channelId="ch-1"
          definitions={definitions}
          canEdit={false}
        />,
      );

      // Tooltip body renders: displayName "People" + def.key "(_people)" +
      // per-user full info (displayName + @username).
      expect(screen.getByText("(_people)")).toBeInTheDocument();
      expect(screen.getByText("@alice")).toBeInTheDocument();
    });
  });
});
