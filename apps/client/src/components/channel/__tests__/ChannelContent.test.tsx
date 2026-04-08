import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChannelContent, type ChannelContentProps } from "../ChannelContent";
import type { Message, ChannelMember } from "@/types/im";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../MessageList", () => ({
  MessageList: ({
    channelId,
    messages,
    readOnly,
  }: {
    channelId: string;
    messages: Message[];
    readOnly?: boolean;
  }) => (
    <div
      data-testid="message-list"
      data-channel-id={channelId}
      data-messages-count={messages.length}
      data-read-only={readOnly ? "true" : "false"}
    />
  ),
}));

vi.mock("../MessageInput", () => ({
  MessageInput: ({
    disabled,
    placeholder,
    autoSendInitialDraft,
  }: {
    disabled?: boolean;
    placeholder?: string;
    autoSendInitialDraft?: boolean;
  }) => (
    <div
      data-testid="message-input"
      data-disabled={disabled ? "true" : "false"}
      data-placeholder={placeholder ?? ""}
      data-auto-send={autoSendInitialDraft ? "true" : "false"}
    />
  ),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessage(id: string): Message {
  return {
    id,
    channelId: "ch-1",
    senderId: "user-1",
    content: `Message ${id}`,
    type: "text",
    isPinned: false,
    isEdited: false,
    isDeleted: false,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  };
}

const BASE_PROPS = {
  channelId: "ch-1",
  messages: [makeMessage("m-1"), makeMessage("m-2")],
  isLoading: false,
  onLoadMore: vi.fn(),
};

function makeOnSendMock(): NonNullable<ChannelContentProps["onSend"]> {
  return vi.fn(async () => undefined);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ChannelContent", () => {
  it("renders MessageList with provided messages", () => {
    render(<ChannelContent {...BASE_PROPS} />);

    const list = screen.getByTestId("message-list");
    expect(list).toBeInTheDocument();
    expect(list).toHaveAttribute("data-channel-id", "ch-1");
    expect(list).toHaveAttribute("data-messages-count", "2");
  });

  it("renders MessageInput when onSend is provided", () => {
    const onSend = makeOnSendMock();
    render(<ChannelContent {...BASE_PROPS} onSend={onSend} />);

    expect(screen.getByTestId("message-input")).toBeInTheDocument();
  });

  it("does not render MessageInput when onSend is omitted", () => {
    render(<ChannelContent {...BASE_PROPS} />);

    expect(screen.queryByTestId("message-input")).not.toBeInTheDocument();
  });

  it("renders read-only bar when showReadOnlyBar=true", () => {
    render(<ChannelContent {...BASE_PROPS} showReadOnlyBar />);

    expect(screen.getByText("Read-only")).toBeInTheDocument();
    expect(screen.queryByTestId("message-input")).not.toBeInTheDocument();
  });

  it("renders read-only bar even when onSend is provided if showReadOnlyBar=true", () => {
    const onSend = makeOnSendMock();
    render(<ChannelContent {...BASE_PROPS} onSend={onSend} showReadOnlyBar />);

    expect(screen.getByText("Read-only")).toBeInTheDocument();
    expect(screen.queryByTestId("message-input")).not.toBeInTheDocument();
  });

  it("readOnly only affects MessageList, not the input area", () => {
    const onSend = makeOnSendMock();
    render(<ChannelContent {...BASE_PROPS} onSend={onSend} readOnly />);

    // MessageList gets readOnly
    expect(screen.getByTestId("message-list")).toHaveAttribute(
      "data-read-only",
      "true",
    );
    // But MessageInput still renders (readOnly doesn't hide it)
    expect(screen.getByTestId("message-input")).toBeInTheDocument();
    // No read-only bar (showReadOnlyBar not set)
    expect(screen.queryByText("Read-only")).not.toBeInTheDocument();
  });

  it("renders unsynced banner when hasMoreUnsynced=true", () => {
    render(<ChannelContent {...BASE_PROPS} hasMoreUnsynced />);

    expect(
      screen.getByText(
        "You have older unread messages. Scroll up to load more.",
      ),
    ).toBeInTheDocument();
  });

  it("does not render unsynced banner by default", () => {
    render(<ChannelContent {...BASE_PROPS} />);

    expect(
      screen.queryByText(
        "You have older unread messages. Scroll up to load more.",
      ),
    ).not.toBeInTheDocument();
  });

  it("passes readOnly to MessageList", () => {
    render(<ChannelContent {...BASE_PROPS} readOnly />);

    const list = screen.getByTestId("message-list");
    expect(list).toHaveAttribute("data-read-only", "true");
  });

  it("passes isSendDisabled to MessageInput as disabled", () => {
    const onSend = makeOnSendMock();
    render(<ChannelContent {...BASE_PROPS} onSend={onSend} isSendDisabled />);

    const input = screen.getByTestId("message-input");
    expect(input).toHaveAttribute("data-disabled", "true");
  });

  it("passes inputPlaceholder to MessageInput", () => {
    const onSend = makeOnSendMock();
    render(
      <ChannelContent
        {...BASE_PROPS}
        onSend={onSend}
        inputPlaceholder="Type something..."
      />,
    );

    const input = screen.getByTestId("message-input");
    expect(input).toHaveAttribute("data-placeholder", "Type something...");
  });

  it("passes autoSendInitialDraft to MessageInput", () => {
    const onSend = makeOnSendMock();
    render(
      <ChannelContent
        {...BASE_PROPS}
        onSend={onSend}
        initialDraft="hello from dashboard"
        autoSendInitialDraft
      />,
    );

    const input = screen.getByTestId("message-input");
    expect(input).toHaveAttribute("data-auto-send", "true");
  });

  it("renders with empty messages array", () => {
    render(<ChannelContent {...BASE_PROPS} messages={[]} />);

    const list = screen.getByTestId("message-list");
    expect(list).toHaveAttribute("data-messages-count", "0");
  });

  it("renders with all optional props omitted (safe defaults)", () => {
    render(
      <ChannelContent
        channelId="ch-safe"
        messages={[]}
        isLoading={false}
        onLoadMore={vi.fn()}
      />,
    );

    // MessageList is rendered
    expect(screen.getByTestId("message-list")).toBeInTheDocument();
    // No MessageInput, no banners
    expect(screen.queryByTestId("message-input")).not.toBeInTheDocument();
    expect(screen.queryByText("Read-only")).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "You have older unread messages. Scroll up to load more.",
      ),
    ).not.toBeInTheDocument();
  });

  it("passes readOnly=false to MessageList by default", () => {
    render(<ChannelContent {...BASE_PROPS} />);

    const list = screen.getByTestId("message-list");
    expect(list).toHaveAttribute("data-read-only", "false");
  });

  it("does not render read-only bar when showReadOnlyBar is not set", () => {
    render(<ChannelContent {...BASE_PROPS} />);

    expect(screen.queryByText("Read-only")).not.toBeInTheDocument();
  });

  it("does not render unsynced banner when hasMoreUnsynced=false", () => {
    render(<ChannelContent {...BASE_PROPS} hasMoreUnsynced={false} />);

    expect(
      screen.queryByText(
        "You have older unread messages. Scroll up to load more.",
      ),
    ).not.toBeInTheDocument();
  });

  it("does not pass disabled to MessageInput when isSendDisabled is false", () => {
    const onSend = makeOnSendMock();
    render(
      <ChannelContent {...BASE_PROPS} onSend={onSend} isSendDisabled={false} />,
    );

    const input = screen.getByTestId("message-input");
    expect(input).toHaveAttribute("data-disabled", "false");
  });

  it("accepts members prop without error", () => {
    const members: ChannelMember[] = [
      {
        id: "mem-1",
        channelId: "ch-1",
        userId: "user-1",
        role: "member",
        isMuted: false,
        notificationsEnabled: true,
        joinedAt: "2024-01-01T00:00:00Z",
      },
    ];
    expect(() =>
      render(<ChannelContent {...BASE_PROPS} members={members} />),
    ).not.toThrow();
  });
});
