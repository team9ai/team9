import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { StreamingMessageParts } from "../StreamingMessageParts";
import type { StreamingMessage } from "@/stores/useStreamingStore";

vi.mock("../MessageContent", () => ({
  MessageContent: ({ content }: { content: string }) => <div>{content}</div>,
}));

beforeEach(async () => {
  if (i18n.language !== "en") {
    await i18n.changeLanguage("en");
  }
});

function makeStream(
  overrides: Partial<StreamingMessage> = {},
): StreamingMessage {
  return {
    streamId: "stream-1",
    channelId: "channel-1",
    senderId: "bot-1",
    content: "first replysecond reply",
    thinking: "first thinkingsecond thinking",
    isThinking: false,
    isStreaming: true,
    startedAt: Date.now() - 5000,
    parts: [
      {
        id: "stream-1-0",
        type: "thinking",
        content: "first thinking",
        startedAt: Date.now() - 5000,
        isStreaming: false,
        durationMs: 1000,
      },
      {
        id: "stream-1-1",
        type: "content",
        content: "first reply",
        startedAt: Date.now() - 4000,
        isStreaming: false,
      },
      {
        id: "stream-1-2",
        type: "thinking",
        content: "second thinking",
        startedAt: Date.now() - 3000,
        isStreaming: false,
        durationMs: 2000,
      },
      {
        id: "stream-1-3",
        type: "content",
        content: "second reply",
        startedAt: Date.now() - 1000,
        isStreaming: true,
      },
    ],
    ...overrides,
  };
}

describe("StreamingMessageParts", () => {
  it("renders thinking and text parts in arrival order", () => {
    const { container } = render(
      <StreamingMessageParts stream={makeStream()} members={[]} />,
    );

    expect(screen.getByText("first reply")).toBeInTheDocument();
    expect(screen.getByText("second reply")).toBeInTheDocument();

    const text = container.textContent ?? "";
    const firstThinking = text.indexOf("Thought for 1s");
    const firstReply = text.indexOf("first reply");
    const secondThinking = text.indexOf("Thought for 2s");
    const secondReply = text.indexOf("second reply");

    expect(firstThinking).toBeGreaterThanOrEqual(0);
    expect(firstThinking).toBeLessThan(firstReply);
    expect(firstReply).toBeLessThan(secondThinking);
    expect(secondThinking).toBeLessThan(secondReply);
  });

  it("suppresses ordinary thinking rows for deep research streams", () => {
    render(
      <StreamingMessageParts
        stream={makeStream({
          content: "",
          thinking: "research thinking",
          metadata: {
            longRunning: true,
            deepResearch: {
              kind: "report",
              status: "running",
              phase: "searching",
              progress: {
                thoughts: [
                  {
                    text: "真实研究思路来自 deepResearch progress。",
                  },
                ],
              },
            },
          },
          parts: [
            {
              id: "stream-1-0",
              type: "thinking",
              content: "ordinary hidden thinking",
              startedAt: Date.now() - 5000,
              isStreaming: true,
            },
          ],
        })}
        members={[]}
      />,
    );

    expect(screen.queryByText(/Thought/)).not.toBeInTheDocument();
    expect(
      screen.getByText("真实研究思路来自 deepResearch progress。"),
    ).toBeInTheDocument();
  });
});
