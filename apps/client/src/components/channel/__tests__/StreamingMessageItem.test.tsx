import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StreamingMessageItem } from "../StreamingMessageItem";
import type { StreamingMessage } from "@/stores/useStreamingStore";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@/hooks/useMessages", () => ({
  useFullContent: () => ({ data: undefined }),
}));

vi.mock("@/hooks/useChannels", () => ({
  useCreateDirectChannel: () => ({ mutateAsync: vi.fn() }),
}));

function makeStream(
  overrides: Partial<StreamingMessage> = {},
): StreamingMessage {
  return {
    streamId: "stream-1",
    channelId: "channel-1",
    senderId: "bot-1",
    content: "好，走一次完整的工具调用链：",
    thinking: "",
    isThinking: false,
    isStreaming: true,
    startedAt: Date.now(),
    parts: [],
    ...overrides,
  };
}

describe("StreamingMessageItem", () => {
  it("renders the streaming cursor inline with the final text paragraph", () => {
    const { container } = render(
      <StreamingMessageItem stream={makeStream()} members={[]} />,
    );

    const paragraph = screen
      .getByText("好，走一次完整的工具调用链：")
      .closest("p");
    const cursor = container.querySelector(
      '.channel-message-content span[class*="animate-pulse"][class*="bg-foreground"]',
    );

    expect(paragraph).not.toBeNull();
    expect(cursor).not.toBeNull();
    expect(paragraph).toContainElement(cursor as HTMLElement);
  });
});
