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
  it("renders label + icon pulsing while streaming", () => {
    // Thinking is a lifecycle event, so icon + label both stay neutral
    // gray — only the pulse animation signals activity. (This matches
    // the contract enforced by TrackingEventItem's own tests.)
    const stream = makeStream({ startedAt: Date.now() - 2000 });
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
