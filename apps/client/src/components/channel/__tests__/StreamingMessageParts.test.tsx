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
  it("renders stream parts through the shared AgentStreamView package", () => {
    const { container } = render(
      <StreamingMessageParts stream={makeStream()} members={[]} />,
    );

    expect(container.querySelector("[data-stream-view]")).toBeInTheDocument();
    expect(
      container.querySelector('[data-stream-item-kind="thinking"]'),
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-stream-item-kind="agent-message"]'),
    ).toBeInTheDocument();
    expect(screen.getByText("first reply")).toBeInTheDocument();
    expect(screen.getByText("second reply")).toBeInTheDocument();
  });

  it("does not render an empty streaming bubble before text arrives", () => {
    render(
      <StreamingMessageParts
        stream={makeStream({
          content: "",
          thinking: "",
          isThinking: false,
          isStreaming: true,
          parts: [],
        })}
        members={[]}
      />,
    );

    expect(screen.getByText(/^Thinking/)).toBeInTheDocument();
    expect(screen.queryByText("streaming...")).not.toBeInTheDocument();
  });

  it("does not render an empty shared thinking wrapper for text-only streams", () => {
    const { container } = render(
      <StreamingMessageParts
        stream={makeStream({
          content: "plain reply",
          thinking: "",
          isThinking: false,
          parts: [],
        })}
        members={[]}
      />,
    );

    expect(
      container.querySelector('[data-stream-item-kind="thinking"]'),
    ).not.toBeInTheDocument();
    expect(
      container.querySelectorAll('[data-stream-item-kind="agent-message"]'),
    ).toHaveLength(1);
    expect(screen.getByText("plain reply")).toBeInTheDocument();
  });

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

  it("hides a completed pre-content thinking part while later non-text progress is active", () => {
    const { container } = render(
      <StreamingMessageParts
        stream={makeStream({
          content: "",
          thinking: "tool planning",
          isThinking: false,
          parts: [
            {
              id: "stream-1-0",
              type: "thinking",
              content: "tool planning",
              startedAt: Date.now() - 12_000,
              isStreaming: false,
              durationMs: 12_000,
            },
          ],
        })}
        members={[]}
      />,
    );

    expect(screen.queryByText(/^Thought for/)).not.toBeInTheDocument();
    expect(container.firstChild).toBeNull();
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
