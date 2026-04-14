import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MessageItem } from "../MessageItem";
import type { Message } from "@/types/im";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function renderWithProviders(ui: React.ReactElement) {
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
    content: "test content",
    type: "text",
    isPinned: false,
    isEdited: false,
    isDeleted: false,
    createdAt: "2026-03-27T12:00:00Z",
    updatedAt: "2026-03-27T12:00:00Z",
    ...overrides,
  };
}

describe("MessageItem - agent event rendering", () => {
  it("should render TrackingEventItem for messages with agentEventType metadata", () => {
    const msg = makeMessage({
      metadata: {
        agentEventType: "tool_call",
        status: "completed",
        toolName: "SearchFiles",
      },
    });

    renderWithProviders(<MessageItem message={msg} />);

    // tool_call events now use getLabelKey for localized labels; this test
    // uses the simple `t: (key) => key` mock above, so the label resolves to
    // the raw i18n key. "SearchFiles" is not registered in toolNameLabelKeys,
    // so it falls back to the invoke_tool success key.
    expect(
      screen.getByText("tracking.ops.invokeTool.success"),
    ).toBeInTheDocument();
    expect(screen.getByText("SearchFiles")).toBeInTheDocument();
    // Should NOT render avatar/sender
    expect(screen.queryByText("Unknown User")).not.toBeInTheDocument();
  });

  it("should NOT render as agent event when metadata has no agentEventType", () => {
    const msg = makeMessage({
      metadata: { someOtherField: "value" },
      sender: {
        id: "user-1",
        email: "test@example.com",
        username: "TestUser",
        displayName: "Test User",
        avatarUrl: undefined,
        status: "online",
        isActive: true,
        userType: "human",
        createdAt: "2026-03-27T12:00:00Z",
        updatedAt: "2026-03-27T12:00:00Z",
      },
    });

    renderWithProviders(<MessageItem message={msg} />);

    // Should render normally with sender name
    expect(screen.getByText("Test User")).toBeInTheDocument();
  });

  it("should NOT render as agent event when agentEventType is not a string", () => {
    const msg = makeMessage({
      metadata: { agentEventType: 123 },
      sender: {
        id: "user-1",
        email: "test@example.com",
        username: "TestUser",
        displayName: "Test User",
        avatarUrl: undefined,
        status: "online",
        isActive: true,
        userType: "human",
        createdAt: "2026-03-27T12:00:00Z",
        updatedAt: "2026-03-27T12:00:00Z",
      },
    });

    renderWithProviders(<MessageItem message={msg} />);

    expect(screen.getByText("Test User")).toBeInTheDocument();
  });

  it("should render with tight spacing when previous message is also an agent event", () => {
    const prevMsg = makeMessage({
      id: "msg-0",
      metadata: { agentEventType: "agent_start", status: "completed" },
    });
    const msg = makeMessage({
      metadata: {
        agentEventType: "tool_call",
        status: "completed",
        toolName: "Search",
      },
    });

    const { container } = renderWithProviders(
      <MessageItem message={msg} prevMessage={prevMsg} />,
    );

    const wrapper = container.firstChild as HTMLElement;
    // Should NOT have mt-1 class (not first in group)
    expect(wrapper.className).not.toContain("mt-1");
  });

  it("should render with top margin when first agent event in group", () => {
    const prevMsg = makeMessage({ id: "msg-0" }); // regular message, no metadata
    const msg = makeMessage({
      metadata: {
        agentEventType: "tool_call",
        status: "completed",
        toolName: "Search",
      },
    });

    const { container } = renderWithProviders(
      <MessageItem message={msg} prevMessage={prevMsg} />,
    );

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("mt-1");
  });

  it("should render tool_result as collapsible", () => {
    const msg = makeMessage({
      metadata: { agentEventType: "tool_result", status: "completed" },
      content:
        '{"results": [1, 2, 3], "count": 42, "more_data": "something extra to make it longer than sixty characters total"}',
    });

    renderWithProviders(<MessageItem message={msg} />);

    // Event-type labels now go through i18n. This test uses the `t: (k) => k`
    // mock above, so the label resolves to the raw i18n key.
    expect(
      screen.getByText("tracking.eventLabels.toolResult"),
    ).toBeInTheDocument();
    // Should show truncated with ...
    expect(screen.getByText(/\.\.\./)).toBeInTheDocument();
  });

  it("should handle null content gracefully", () => {
    const msg = makeMessage({
      metadata: { agentEventType: "agent_start", status: "completed" },
      content: null as unknown as string,
    });

    renderWithProviders(<MessageItem message={msg} />);

    // Event-type labels now go through i18n. This test uses the `t: (k) => k`
    // mock above, so the label resolves to the raw i18n key.
    expect(
      screen.getByText("tracking.eventLabels.agentStart"),
    ).toBeInTheDocument();
  });
});
