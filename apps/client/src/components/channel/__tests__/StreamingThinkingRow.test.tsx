import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import i18n from "@/i18n";
import { StreamingThinkingRow } from "../StreamingThinkingRow";
import type { StreamingMessage } from "@/stores/useStreamingStore";

beforeEach(async () => {
  if (i18n.language !== "en") {
    await i18n.changeLanguage("en");
  }
});

function makeStream(
  overrides: Partial<StreamingMessage> = {},
): StreamingMessage {
  return {
    streamId: "s-1",
    channelId: "ch-1",
    senderId: "bot-1",
    content: "",
    thinking: "",
    isThinking: true,
    isStreaming: true,
    startedAt: Date.now(),
    ...overrides,
  };
}

describe("StreamingThinkingRow", () => {
  it("shows a pulsing 'Thinking Ns' row during the pre-content phase", () => {
    // Before any reply text arrives the row reads as in-flight: label
    // + icon both pulse. Rendering is NOT gated on thinking content
    // arriving — Claude doesn't flush thinking deltas until a reasoning
    // block finalizes, which can take several seconds, so we need to
    // surface the row the moment the stream starts.
    const stream = makeStream({
      startedAt: Date.now() - 2000,
      content: "",
      thinking: "",
    });
    render(<StreamingThinkingRow stream={stream} />);

    const label = screen.getByText(/^Thinking/);
    expect(label).toHaveClass("animate-pulse");
    expect(label).toHaveClass("text-foreground/70");

    const icon = screen.getByTestId("event-icon");
    expect(icon).toHaveClass("animate-pulse");
    expect(icon).toHaveClass("text-muted-foreground");
  });

  it("surfaces elapsed duration from stream.startedAt", () => {
    // Fixed startedAt 3 seconds before now: label should read "Thinking 3s".
    // We don't use fake timers here because buildThinkingStats pulls
    // `Date.now()` internally — setting the stream's startedAt relative
    // to the real clock is enough to prove the wiring.
    const stream = makeStream({ startedAt: Date.now() - 3000 });
    render(<StreamingThinkingRow stream={stream} />);

    expect(screen.getByText(/Thinking \d+s/)).toBeInTheDocument();
  });

  it("renders nothing when the bot replies without any thinking", () => {
    // Some bots (short replies, models that don't engage extended
    // thinking) stream text directly without ever producing a
    // reasoning block. The row must disappear in that case — leaving
    // a "Thought for 0s" remnant would lie about what the bot did.
    const stream = makeStream({
      startedAt: Date.now() - 200,
      content: "Hi!",
      thinking: "",
      isThinking: false,
    });
    const { container } = render(<StreamingThinkingRow stream={stream} />);
    expect(container.firstChild).toBeNull();
  });

  it("freezes into 'Thought for Ns' once reply text starts streaming", () => {
    // Reply text arriving is the signal that thinking is done. The row
    // flips from the live "Thinking Ns" state to the completed "Thought
    // for Ns" state with a frozen duration — no more pulse, so the
    // reader's attention shifts to the text below. When the stream ends
    // and the persisted thinking message arrives, it renders in the
    // same spot (MessageList sorts by effective time) so there's no
    // reshuffle.
    const stream = makeStream({
      startedAt: Date.now() - 4000,
      content: "Hello there!",
      thinking: "some reasoning",
      isThinking: false,
    });
    render(<StreamingThinkingRow stream={stream} />);

    const label = screen.getByText(/^Thought for/);
    expect(label).not.toHaveClass("animate-pulse");

    const icon = screen.getByTestId("event-icon");
    expect(icon).not.toHaveClass("animate-pulse");
  });

  it("wraps the row in the same gray/border strip as persisted agent events", () => {
    // Regression: the strip classes must stay in sync with MessageItem's
    // agent-event wrapper so the streaming row lines up visually with
    // the persisted tracking rows once the round settles.
    const stream = makeStream();
    const { container } = render(<StreamingThinkingRow stream={stream} />);

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("border-l-2");
    expect(wrapper.className).toContain("border-border");
    expect(wrapper.className).toContain("bg-muted/30");
    expect(wrapper.getAttribute("style")).toContain("padding-left: 9px");
  });

  it("collapses the thinking body by default (revealed on click)", () => {
    // TrackingEventItem's contract: thinking rows are collapsible and
    // start collapsed; the body is not in the initial DOM. The row is
    // still present and the label renders — we just don't want the
    // streaming reasoning text to visually dominate before the user
    // opts in. Click-to-expand behaviour is covered by TrackingEventItem
    // tests directly; here we only guard the collapsed default.
    const stream = makeStream({
      thinking: "Reasoning line one",
      isThinking: true,
    });
    render(<StreamingThinkingRow stream={stream} />);

    expect(screen.queryByTestId("expanded-content")).not.toBeInTheDocument();
  });
});
