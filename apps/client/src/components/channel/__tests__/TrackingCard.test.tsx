import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import i18n from "@/i18n";
import {
  TrackingCard,
  buildRenderItems,
  type TrackingDisplayItem,
} from "../TrackingCard";
import type { AgentEventMetadata, Message } from "@/types/im";

const mockUseTrackingChannel = vi.fn();
const mockTrackingEventItem = vi.fn();
const mockToolCallBlock = vi.fn();
const mockTrackingModal = vi.fn();

vi.mock("@/hooks/useTrackingChannel", () => ({
  useTrackingChannel: (...args: unknown[]) => mockUseTrackingChannel(...args),
}));

vi.mock("../TrackingModal", () => ({
  TrackingModal: (props: { isOpen: boolean; onClose: () => void }) => {
    mockTrackingModal(props);
    return props.isOpen ? (
      <div data-testid="tracking-modal">
        <button type="button" data-testid="close-modal" onClick={props.onClose}>
          close
        </button>
      </div>
    ) : null;
  },
}));

vi.mock("../TrackingEventItem", () => ({
  TrackingEventItem: (props: unknown) => {
    mockTrackingEventItem(props);
    return <div data-testid="tracking-event-item">event</div>;
  },
}));

vi.mock("../ToolCallBlock", () => ({
  ToolCallBlock: (props: unknown) => {
    mockToolCallBlock(props);
    return <div data-testid="tool-call-block">tool</div>;
  },
}));

// Ensure English locale for any other i18n-driven content.
beforeEach(async () => {
  if (i18n.language !== "en") {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  }
});

afterEach(() => {
  vi.clearAllMocks();
});

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-1",
    channelId: "ch-1",
    senderId: "bot-1",
    content: "Summary",
    type: "tracking",
    isPinned: false,
    isEdited: false,
    isDeleted: false,
    createdAt: "2026-03-27T12:00:00Z",
    updatedAt: "2026-03-27T12:00:00Z",
    metadata: { trackingChannelId: "tracking-1" },
    sender: {
      id: "bot-1",
      email: "bot@example.com",
      username: "helper-bot",
      displayName: "Helper Bot",
      avatarUrl: undefined,
      status: "online",
      isActive: true,
      userType: "bot",
      createdAt: "2026-03-27T12:00:00Z",
      updatedAt: "2026-03-27T12:00:00Z",
    },
    ...overrides,
  } as Message;
}

function callMeta(
  toolCallId = "tc-1",
  overrides: Partial<AgentEventMetadata> = {},
): AgentEventMetadata {
  return {
    agentEventType: "tool_call",
    status: "completed",
    toolName: "SearchFiles",
    toolCallId,
    ...overrides,
  };
}

function resultMeta(
  toolCallId = "tc-1",
  overrides: Partial<AgentEventMetadata> = {},
): AgentEventMetadata {
  return {
    agentEventType: "tool_result",
    status: "completed",
    toolCallId,
    success: true,
    ...overrides,
  };
}

function writingMeta(
  status: AgentEventMetadata["status"] = "completed",
): AgentEventMetadata {
  return { agentEventType: "writing", status };
}

// --- Pure function tests for buildRenderItems ---
describe("buildRenderItems", () => {
  it("merges consecutive tool_call + tool_result with matching toolCallId into a single toolCall item", () => {
    const items: TrackingDisplayItem[] = [
      {
        id: "a",
        content: "",
        metadata: callMeta("tc-1"),
        isStreaming: false,
      },
      {
        id: "b",
        content: "result",
        metadata: resultMeta("tc-1"),
        isStreaming: false,
      },
    ];

    const out = buildRenderItems(items);

    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      type: "toolCall",
      callItem: items[0],
      resultItem: items[1],
    });
  });

  it("does NOT merge when tool_call and tool_result have different toolCallIds", () => {
    const items: TrackingDisplayItem[] = [
      {
        id: "a",
        content: "",
        metadata: callMeta("tc-1"),
        isStreaming: false,
      },
      {
        id: "b",
        content: "result",
        metadata: resultMeta("tc-DIFFERENT"),
        isStreaming: false,
      },
    ];

    const out = buildRenderItems(items);

    expect(out).toHaveLength(2);
    expect(out[0].type).toBe("event");
    expect(out[1].type).toBe("event");
  });

  it("does NOT merge when a non-result item sits between the call and the result", () => {
    const items: TrackingDisplayItem[] = [
      {
        id: "a",
        content: "",
        metadata: callMeta("tc-1"),
        isStreaming: false,
      },
      {
        id: "mid",
        content: "thinking...",
        metadata: { agentEventType: "thinking", status: "running" },
        isStreaming: false,
      },
      {
        id: "b",
        content: "result",
        metadata: resultMeta("tc-1"),
        isStreaming: false,
      },
    ];

    const out = buildRenderItems(items);

    // Call stays as standalone event, middle stays as event, trailing result
    // also stays as event because it isn't preceded by its call anymore.
    expect(out).toHaveLength(3);
    expect(out.every((ri) => ri.type === "event")).toBe(true);
  });

  it("leaves a tool_call with no following tool_result as a plain event item (arm still running)", () => {
    const items: TrackingDisplayItem[] = [
      {
        id: "a",
        content: "",
        metadata: callMeta("tc-1"),
        isStreaming: false,
      },
    ];

    const out = buildRenderItems(items);

    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ type: "event", item: items[0] });
  });

  it("does NOT merge when the tool_call has no toolCallId (defensive)", () => {
    const items: TrackingDisplayItem[] = [
      {
        id: "a",
        content: "",
        metadata: {
          agentEventType: "tool_call",
          status: "completed",
          toolName: "Mystery",
        },
        isStreaming: false,
      },
      {
        id: "b",
        content: "result",
        metadata: {
          agentEventType: "tool_result",
          status: "completed",
          success: true,
        },
        isStreaming: false,
      },
    ];

    const out = buildRenderItems(items);

    // Without toolCallIds we do not merge.
    expect(out).toHaveLength(2);
    expect(out.every((ri) => ri.type === "event")).toBe(true);
  });

  it("merges multiple pairs in sequence and keeps unrelated events as-is", () => {
    const items: TrackingDisplayItem[] = [
      {
        id: "w",
        content: "thinking",
        metadata: { agentEventType: "thinking", status: "completed" },
        isStreaming: false,
      },
      {
        id: "c1",
        content: "",
        metadata: callMeta("tc-1"),
        isStreaming: false,
      },
      {
        id: "r1",
        content: "r1",
        metadata: resultMeta("tc-1"),
        isStreaming: false,
      },
      {
        id: "c2",
        content: "",
        metadata: callMeta("tc-2"),
        isStreaming: false,
      },
      {
        id: "r2",
        content: "r2",
        metadata: resultMeta("tc-2"),
        isStreaming: false,
      },
    ];

    const out = buildRenderItems(items);

    expect(out.map((ri) => ri.type)).toEqual(["event", "toolCall", "toolCall"]);
  });
});

// --- TrackingCard integration tests ---
describe("TrackingCard", () => {
  beforeEach(() => {
    mockUseTrackingChannel.mockReturnValue({
      isActivated: true,
      latestMessages: [],
      totalMessageCount: 0,
      isLoading: false,
      activeStream: null,
    });
  });

  it("renders a ToolCallBlock when latestMessages contain a tool_call + tool_result pair", () => {
    mockUseTrackingChannel.mockReturnValue({
      isActivated: true,
      latestMessages: [
        {
          id: "a",
          content: "",
          metadata: callMeta("tc-1"),
          createdAt: "2026-03-27T12:00:00Z",
        },
        {
          id: "b",
          content: '{"ok": true}',
          metadata: resultMeta("tc-1"),
          createdAt: "2026-03-27T12:00:01Z",
        },
      ],
      totalMessageCount: 2,
      isLoading: false,
      activeStream: null,
    });

    render(<TrackingCard message={makeMessage()} />);

    expect(screen.getAllByTestId("tool-call-block")).toHaveLength(1);
    expect(screen.queryByTestId("tracking-event-item")).not.toBeInTheDocument();

    // The ToolCallBlock received the call metadata, result metadata, and the
    // unwrapped result content from the tool_result message.
    expect(mockToolCallBlock).toHaveBeenCalledWith(
      expect.objectContaining({
        callMetadata: expect.objectContaining({
          agentEventType: "tool_call",
          toolCallId: "tc-1",
          toolName: "SearchFiles",
        }),
        resultMetadata: expect.objectContaining({
          agentEventType: "tool_result",
          toolCallId: "tc-1",
        }),
        resultContent: '{"ok": true}',
      }),
    );
  });

  it("pairs newest-first persisted tool_result + tool_call messages", () => {
    mockUseTrackingChannel.mockReturnValue({
      isActivated: true,
      latestMessages: [
        {
          id: "b",
          content: '{"ok": true}',
          metadata: resultMeta("tc-1"),
          createdAt: "2026-03-27T12:00:01Z",
        },
        {
          id: "a",
          content: "",
          metadata: callMeta("tc-1"),
          createdAt: "2026-03-27T12:00:00Z",
        },
      ],
      totalMessageCount: 2,
      isLoading: false,
      activeStream: null,
    });

    render(<TrackingCard message={makeMessage()} />);

    expect(screen.getAllByTestId("tool-call-block")).toHaveLength(1);
    expect(screen.queryByTestId("tracking-event-item")).not.toBeInTheDocument();
    expect(mockToolCallBlock).toHaveBeenCalledWith(
      expect.objectContaining({
        callMetadata: expect.objectContaining({ toolCallId: "tc-1" }),
        resultMetadata: expect.objectContaining({ toolCallId: "tc-1" }),
        resultContent: '{"ok": true}',
      }),
    );
  });

  it("keeps unrelated events as TrackingEventItems and still merges the paired tool call", () => {
    mockUseTrackingChannel.mockReturnValue({
      isActivated: true,
      latestMessages: [
        {
          id: "w",
          content: "thinking",
          metadata: { agentEventType: "thinking", status: "completed" },
          createdAt: "2026-03-27T12:00:00Z",
        },
        {
          id: "a",
          content: "",
          metadata: callMeta("tc-1"),
          createdAt: "2026-03-27T12:00:01Z",
        },
        {
          id: "b",
          content: "result",
          metadata: resultMeta("tc-1"),
          createdAt: "2026-03-27T12:00:02Z",
        },
      ],
      totalMessageCount: 3,
      isLoading: false,
      activeStream: null,
    });

    render(<TrackingCard message={makeMessage()} />);

    expect(screen.getAllByTestId("tool-call-block")).toHaveLength(1);
    expect(screen.getAllByTestId("tracking-event-item")).toHaveLength(1);
  });

  it("renders a lone tool_call as ToolCallBlock (no pairing yet) — execution still running", () => {
    mockUseTrackingChannel.mockReturnValue({
      isActivated: true,
      latestMessages: [
        {
          id: "a",
          content: "",
          metadata: callMeta("tc-1", { status: "running" }),
          createdAt: "2026-03-27T12:00:00Z",
        },
      ],
      totalMessageCount: 1,
      isLoading: false,
      activeStream: null,
    });

    render(<TrackingCard message={makeMessage()} />);

    expect(screen.getAllByTestId("tool-call-block")).toHaveLength(1);
    expect(screen.queryByTestId("tracking-event-item")).not.toBeInTheDocument();
    const toolCallProps = mockToolCallBlock.mock.calls[
      mockToolCallBlock.mock.calls.length - 1
    ][0] as { resultMetadata?: unknown };
    expect(mockToolCallBlock).toHaveBeenCalledWith(
      expect.objectContaining({
        callMetadata: expect.objectContaining({
          toolCallId: "tc-1",
          toolName: "SearchFiles",
        }),
        resultContent: "",
      }),
    );
    expect(toolCallProps.resultMetadata).toBeUndefined();
  });

  it("renders an active streaming tool_call as ToolCallBlock before a result arrives", () => {
    mockUseTrackingChannel.mockReturnValue({
      isActivated: true,
      latestMessages: [],
      totalMessageCount: 0,
      isLoading: false,
      activeStream: {
        streamId: "stream-tool-call",
        content: "",
        metadata: callMeta("tc-stream", {
          status: "running",
          toolName: "RunScript",
        }),
      },
    });

    render(<TrackingCard message={makeMessage()} />);

    expect(screen.getAllByTestId("tool-call-block")).toHaveLength(1);
    expect(screen.queryByTestId("tracking-event-item")).not.toBeInTheDocument();
    const toolCallProps = mockToolCallBlock.mock.calls[
      mockToolCallBlock.mock.calls.length - 1
    ][0] as { resultMetadata?: unknown };
    expect(mockToolCallBlock).toHaveBeenCalledWith(
      expect.objectContaining({
        callMetadata: expect.objectContaining({
          toolCallId: "tc-stream",
          toolName: "RunScript",
        }),
        resultContent: "",
      }),
    );
    expect(toolCallProps.resultMetadata).toBeUndefined();
  });

  it("does not merge when the tool_call and tool_result have different toolCallIds", () => {
    mockUseTrackingChannel.mockReturnValue({
      isActivated: true,
      latestMessages: [
        {
          id: "a",
          content: "",
          metadata: callMeta("tc-A"),
          createdAt: "2026-03-27T12:00:00Z",
        },
        {
          id: "b",
          content: "result",
          metadata: resultMeta("tc-B"),
          createdAt: "2026-03-27T12:00:01Z",
        },
      ],
      totalMessageCount: 2,
      isLoading: false,
      activeStream: null,
    });

    render(<TrackingCard message={makeMessage()} />);

    expect(screen.getAllByTestId("tool-call-block")).toHaveLength(1);
    expect(screen.getAllByTestId("tracking-event-item")).toHaveLength(1);
  });

  it("only shows the latest 3 render items (merged toolCall counts as 1 slot)", () => {
    // 4 standalone writing events + 1 merged toolCall = 5 original display
    // items become 5 render items; we trim to the last 3.
    mockUseTrackingChannel.mockReturnValue({
      isActivated: true,
      latestMessages: [
        {
          id: "w1",
          content: "one",
          metadata: writingMeta("completed"),
          createdAt: "2026-03-27T12:00:00Z",
        },
        {
          id: "w2",
          content: "two",
          metadata: writingMeta("completed"),
          createdAt: "2026-03-27T12:00:01Z",
        },
        {
          id: "w3",
          content: "three",
          metadata: writingMeta("completed"),
          createdAt: "2026-03-27T12:00:02Z",
        },
        {
          id: "c",
          content: "",
          metadata: callMeta("tc-1"),
          createdAt: "2026-03-27T12:00:03Z",
        },
        {
          id: "r",
          content: "ok",
          metadata: resultMeta("tc-1"),
          createdAt: "2026-03-27T12:00:04Z",
        },
      ],
      totalMessageCount: 5,
      isLoading: false,
      activeStream: null,
    });

    render(<TrackingCard message={makeMessage()} />);

    // 5 render items total -> last 3 = [writing w2, writing w3, toolCall]
    expect(screen.getAllByTestId("tracking-event-item")).toHaveLength(2);
    expect(screen.getAllByTestId("tool-call-block")).toHaveLength(1);
  });

  it("renders the active stream as an isolated TrackingEventItem (never merged with a prior tool_result)", () => {
    mockUseTrackingChannel.mockReturnValue({
      isActivated: true,
      latestMessages: [
        {
          id: "a",
          content: "",
          metadata: callMeta("tc-1"),
          createdAt: "2026-03-27T12:00:00Z",
        },
        {
          id: "b",
          content: "done",
          metadata: resultMeta("tc-1"),
          createdAt: "2026-03-27T12:00:01Z",
        },
      ],
      totalMessageCount: 2,
      isLoading: false,
      activeStream: {
        streamId: "stream-1",
        content: "writing...",
        metadata: { agentEventType: "writing", status: "running" },
      },
    });

    render(<TrackingCard message={makeMessage()} />);

    expect(screen.getAllByTestId("tool-call-block")).toHaveLength(1);
    // The active stream should render as its own TrackingEventItem.
    expect(screen.getAllByTestId("tracking-event-item")).toHaveLength(1);
    expect(mockTrackingEventItem).toHaveBeenCalledWith(
      expect.objectContaining({
        isStreaming: true,
        compact: true,
      }),
    );
  });

  it("shows the 'View N more details' frost overlay when totalMessageCount exceeds 3", () => {
    mockUseTrackingChannel.mockReturnValue({
      isActivated: true,
      latestMessages: [
        {
          id: "w1",
          content: "one",
          metadata: writingMeta("completed"),
          createdAt: "2026-03-27T12:00:00Z",
        },
        {
          id: "w2",
          content: "two",
          metadata: writingMeta("completed"),
          createdAt: "2026-03-27T12:00:01Z",
        },
        {
          id: "w3",
          content: "three",
          metadata: writingMeta("completed"),
          createdAt: "2026-03-27T12:00:02Z",
        },
      ],
      totalMessageCount: 7,
      isLoading: false,
      activeStream: null,
    });

    render(<TrackingCard message={makeMessage()} />);

    expect(screen.getByText(/View 4 more details/)).toBeInTheDocument();
  });

  it("renders the loading state when useTrackingChannel reports loading", () => {
    mockUseTrackingChannel.mockReturnValue({
      isActivated: true,
      latestMessages: [],
      totalMessageCount: 0,
      isLoading: true,
      activeStream: null,
    });

    render(<TrackingCard message={makeMessage()} />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(screen.queryByTestId("tool-call-block")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tracking-event-item")).not.toBeInTheDocument();
  });

  it("opens the TrackingModal on click and closes it via the modal's onClose handler", () => {
    mockUseTrackingChannel.mockReturnValue({
      isActivated: true,
      latestMessages: [],
      totalMessageCount: 0,
      isLoading: false,
      activeStream: null,
    });

    render(<TrackingCard message={makeMessage()} />);

    // Modal starts closed
    expect(screen.queryByTestId("tracking-modal")).not.toBeInTheDocument();

    // Click the card surface — find the bot's name text and click its
    // outer card container.
    const card = screen.getByText("Helper Bot").closest("div.cursor-pointer");
    expect(card).not.toBeNull();
    fireEvent.click(card!);

    expect(screen.getByTestId("tracking-modal")).toBeInTheDocument();

    // Close via the modal's onClose
    fireEvent.click(screen.getByTestId("close-modal"));

    expect(screen.queryByTestId("tracking-modal")).not.toBeInTheDocument();
  });

  it("renders a static elapsed timer (no live ticking) when the tracking channel is deactivated", () => {
    mockUseTrackingChannel.mockReturnValue({
      isActivated: false,
      latestMessages: [],
      totalMessageCount: 0,
      isLoading: false,
      activeStream: null,
    });

    render(
      <TrackingCard
        message={makeMessage({ metadata: { trackingChannelId: "tracking-1" } })}
      />,
    );

    // Deactivated state shows the green check (✓) instead of the pulsing dot
    // and the elapsed timer text is rendered statically.
    expect(screen.getByText("✓")).toBeInTheDocument();
    // Elapsed text follows the "Nm SSs" format produced by formatElapsed.
    expect(screen.getByText(/\d+m \d{2}s/)).toBeInTheDocument();
  });
});

// --- formatElapsed indirect tests via component rendering ---
describe("formatElapsed (indirect via TrackingCard)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockUseTrackingChannel.mockReturnValue({
      isActivated: false,
      latestMessages: [],
      totalMessageCount: 0,
      isLoading: false,
      activeStream: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats a known startTime into "Nm SSs" format', () => {
    const fixedNow = new Date("2026-04-10T10:05:00.000Z").getTime();
    vi.setSystemTime(fixedNow);

    // createdAt = 2 minutes and 30 seconds ago
    const startTime = new Date(fixedNow - 150_000).toISOString();

    render(
      <TrackingCard
        message={makeMessage({
          createdAt: startTime,
          metadata: { trackingChannelId: "tracking-1" },
        })}
      />,
    );

    expect(screen.getByText("2m 30s")).toBeInTheDocument();
  });

  it('returns "0m 00s" for an invalid date string (NaN guard)', () => {
    const fixedNow = new Date("2026-04-10T10:00:00.000Z").getTime();
    vi.setSystemTime(fixedNow);

    render(
      <TrackingCard
        message={makeMessage({
          createdAt: "not-a-valid-date",
          metadata: { trackingChannelId: "tracking-1" },
        })}
      />,
    );

    expect(screen.getByText("0m 00s")).toBeInTheDocument();
  });

  it('clamps to "0m 00s" when startTime is in the future (zero/negative elapsed)', () => {
    const fixedNow = new Date("2026-04-10T10:00:00.000Z").getTime();
    vi.setSystemTime(fixedNow);

    // createdAt is 60 seconds in the future
    const futureTime = new Date(fixedNow + 60_000).toISOString();

    render(
      <TrackingCard
        message={makeMessage({
          createdAt: futureTime,
          metadata: { trackingChannelId: "tracking-1" },
        })}
      />,
    );

    expect(screen.getByText("0m 00s")).toBeInTheDocument();
  });

  it("correctly pads single-digit seconds with leading zero", () => {
    const fixedNow = new Date("2026-04-10T10:00:00.000Z").getTime();
    vi.setSystemTime(fixedNow);

    // 1 minute and 5 seconds ago
    const startTime = new Date(fixedNow - 65_000).toISOString();

    render(
      <TrackingCard
        message={makeMessage({
          createdAt: startTime,
          metadata: { trackingChannelId: "tracking-1" },
        })}
      />,
    );

    expect(screen.getByText("1m 05s")).toBeInTheDocument();
  });

  it("formats exactly 0 seconds as 0m 00s", () => {
    const fixedNow = new Date("2026-04-10T10:00:00.000Z").getTime();
    vi.setSystemTime(fixedNow);

    // createdAt is exactly now
    const startTime = new Date(fixedNow).toISOString();

    render(
      <TrackingCard
        message={makeMessage({
          createdAt: startTime,
          metadata: { trackingChannelId: "tracking-1" },
        })}
      />,
    );

    expect(screen.getByText("0m 00s")).toBeInTheDocument();
  });
});
