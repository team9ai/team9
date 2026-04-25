import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { Message } from "@/types/im";
import type { PropertyDefinition } from "@/types/properties";

// ==================== Mocks ====================

const mockDefinitions: { current: PropertyDefinition[] } = { current: [] };
const mockSetProperty = { mutate: vi.fn(), isPending: false };
const mockRemoveProperty = { mutate: vi.fn(), isPending: false };
const mockCreateDefinition = { mutate: vi.fn(), isPending: false };

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/usePropertyDefinitions", () => ({
  usePropertyDefinitions: () => ({ data: mockDefinitions.current }),
  useCreatePropertyDefinition: () => mockCreateDefinition,
}));

vi.mock("@/hooks/useMessageProperties", () => ({
  useMessageProperties: () => ({ data: {} }),
  useSetProperty: () => mockSetProperty,
  useRemoveProperty: () => mockRemoveProperty,
}));

// PropertySelector renders the trigger as-is when provided. Stub it to a thin
// passthrough so we only assert on MessageItem's wiring (whether the slot is
// populated or null), without dragging in the popover's deps.
vi.mock("../properties/PropertySelector", () => ({
  PropertySelector: ({ trigger }: { trigger?: ReactNode }) => <>{trigger}</>,
}));

// ==================== Helpers ====================

import { MessageItem } from "../MessageItem";

function renderWithProviders(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>{ui}</TooltipProvider>
    </QueryClientProvider>,
  );
}

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-1",
    channelId: "ch-1",
    senderId: "user-1",
    content: "hello",
    type: "text",
    isPinned: false,
    isEdited: false,
    isDeleted: false,
    createdAt: "2026-04-25T12:00:00Z",
    updatedAt: "2026-04-25T12:00:00Z",
    ...overrides,
  };
}

function hoverMessage() {
  // The MessageItem container is keyed by `id="message-<id>"`. Trigger
  // mouseenter on it to flip the internal isHovered state and reveal the
  // hover toolbar.
  const container = document.getElementById("message-msg-1");
  if (!container) throw new Error("message container not found");
  fireEvent.mouseEnter(container);
}

// ==================== Tests ====================

describe("MessageItem hover toolbar — properties entry", () => {
  it("renders the Tags button when supportsProperties is true even with no property definitions (regression for empty-channel onboarding bug)", () => {
    mockDefinitions.current = [];
    const onAddReaction = vi.fn();
    renderWithProviders(
      <MessageItem
        message={makeMessage()}
        currentUserId="other-user"
        supportsProperties
        onAddReaction={onAddReaction}
      />,
    );

    hoverMessage();

    expect(screen.getByTitle("Properties")).toBeInTheDocument();
  });

  it("renders the Tags button when supportsProperties is true and the channel already has definitions", () => {
    mockDefinitions.current = [
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
        createdAt: "2026-04-25T12:00:00Z",
        updatedAt: "2026-04-25T12:00:00Z",
      },
    ];
    renderWithProviders(
      <MessageItem
        message={makeMessage()}
        currentUserId="other-user"
        supportsProperties
        onAddReaction={vi.fn()}
      />,
    );

    hoverMessage();

    expect(screen.getByTitle("Properties")).toBeInTheDocument();
  });

  it("hides the Tags button when supportsProperties is false (e.g. direct/echo channels)", () => {
    mockDefinitions.current = [];
    renderWithProviders(
      <MessageItem
        message={makeMessage()}
        currentUserId="other-user"
        supportsProperties={false}
        onAddReaction={vi.fn()}
      />,
    );

    hoverMessage();

    expect(screen.queryByTitle("Properties")).not.toBeInTheDocument();
  });
});

describe("MessageItem reaction-row inline '+' add affordance", () => {
  const reactionMessage = () =>
    makeMessage({
      reactions: [
        {
          id: "r-1",
          messageId: "msg-1",
          userId: "other-user",
          emoji: "👍",
          createdAt: "2026-04-25T12:00:00Z",
        },
      ],
    });

  it("hides the inline '+' when the channel has no property definitions yet (would duplicate the hover-toolbar Tags entry)", () => {
    mockDefinitions.current = [];
    renderWithProviders(
      <MessageItem
        message={reactionMessage()}
        currentUserId="other-user"
        supportsProperties
        onAddReaction={vi.fn()}
        onRemoveReaction={vi.fn()}
      />,
    );

    expect(screen.queryByTitle("Add properties")).not.toBeInTheDocument();
  });

  it("shows the inline '+' when the channel has definitions and the message has reactions but no property values", () => {
    mockDefinitions.current = [
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
        createdAt: "2026-04-25T12:00:00Z",
        updatedAt: "2026-04-25T12:00:00Z",
      },
    ];
    renderWithProviders(
      <MessageItem
        message={reactionMessage()}
        currentUserId="other-user"
        supportsProperties
        onAddReaction={vi.fn()}
        onRemoveReaction={vi.fn()}
      />,
    );

    expect(screen.getByTitle("Add properties")).toBeInTheDocument();
  });
});
