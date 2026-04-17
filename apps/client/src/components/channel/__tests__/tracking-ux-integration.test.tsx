/**
 * End-to-end integration test for the Team9 Agent tracking UX (Task 1–10).
 *
 * Goal: simulate the full agent execution loop inside a DM channel and assert
 * that the round auto-fold + tracking rendering pipeline behaves correctly
 * across all UX phases:
 *
 *   Phase 1 — Round 1 is in progress (no final reply yet) → latest round stays
 *             fully expanded with real TrackingEventItem + ToolCallBlock rows.
 *   Phase 2 — Round 1 finishes with a final text reply → events and reply all
 *             visible (the round is still the latest because nothing follows).
 *   Phase 3 — Round 2 starts → Round 1 auto-folds into a RoundCollapseSummary,
 *             while its text reply stays visible and Round 2 stays expanded.
 *   Phase 4 — User clicks Round 1's RoundCollapseSummary → Round 1 expands
 *             again, summary row disappears.
 *   Phase 5 — Round 2 finishes with a final text reply → Round 1 remains
 *             user-expanded (explicit user preference is preserved), Round 2
 *             is now the latest and stays expanded.
 *
 * Plus a non-DM channel sanity test ensuring tracking channels never fold.
 *
 * The test deliberately uses REAL TrackingEventItem / ToolCallBlock /
 * RoundCollapseSummary / real i18n so we verify the actual localized copy a
 * user sees ("Thought for 2m 3s", "... Show execution (3 steps)",
 * "Tool call completed", etc.). Only the periphery (virtuoso, zustand stores,
 * query hooks, MessageContextMenu / MessageContent / UserAvatar) is stubbed —
 * those collaborators are not what Task 1–10 changed and they pull in heavy
 * tree dependencies that would drown out the assertions.
 */

import type { PropsWithChildren } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import i18n from "@/i18n";

import type { Message, MessageType } from "@/types/im";

// ---------------------------------------------------------------------------
// Mocks — external collaborators we don't care about for this suite.
// ---------------------------------------------------------------------------
//
// NOTE: We intentionally do NOT mock `react-i18next` — the test relies on the
// real English resources to assert the exact user-visible copy emitted by
// TrackingEventItem / ToolCallBlock / RoundCollapseSummary.

// Virtuoso: synchronous flat list, no virtualization, honour firstItemIndex.
vi.mock("react-virtuoso", () => {
  const Virtuoso = ({
    data,
    itemContent,
    computeItemKey,
    firstItemIndex = 0,
  }: {
    data: unknown[];
    itemContent: (index: number, item: unknown) => React.ReactNode;
    computeItemKey?: (index: number, item: unknown) => string | number;
    firstItemIndex?: number;
  }) => {
    return (
      <div data-testid="virtuoso-mock">
        {data.map((item, i) => {
          const absoluteIndex = firstItemIndex + i;
          const key = computeItemKey
            ? computeItemKey(absoluteIndex, item)
            : absoluteIndex;
          return (
            <div data-virtuoso-item-key={String(key)} key={key}>
              {itemContent(absoluteIndex, item)}
            </div>
          );
        })}
      </div>
    );
  };
  return { Virtuoso };
});

// Current user — stable identity for any ownership-aware branches.
vi.mock("@/hooks/useAuth", () => ({
  useCurrentUser: () => ({ data: { id: "current-user" } }),
}));

// Channel members — only consumed by the empty state.
vi.mock("@/hooks/useChannels", () => ({
  useChannelMembers: () => ({ data: [] }),
}));

// Thread store — MessageList reads only `openThread`.
vi.mock("@/hooks/useThread", () => ({
  useThreadStore: (
    selector: (state: { openThread: (id: string) => void }) => unknown,
  ) => selector({ openThread: vi.fn() }),
}));

// React Query client
vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual("@tanstack/react-query");
  return {
    ...actual,
    useQueryClient: () => ({ removeQueries: vi.fn() }),
  };
});

// Message mutation hooks — inert no-ops.
vi.mock("@/hooks/useMessages", () => ({
  useDeleteMessage: () => ({ mutate: vi.fn() }),
  useRetryMessage: () => ({ mutate: vi.fn() }),
  useRemoveFailedMessage: () => vi.fn(),
  useAddReaction: () => ({ mutate: vi.fn() }),
  useRemoveReaction: () => ({ mutate: vi.fn() }),
  usePinMessage: () => ({ mutate: vi.fn() }),
  useUnpinMessage: () => ({ mutate: vi.fn() }),
  useUpdateMessage: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  }),
  useFullContent: () => ({ data: undefined, isLoading: false, isError: false }),
}));

// Channel scroll state machine — no indicators, no interactions.
vi.mock("@/hooks/useChannelScrollState", () => {
  const store = {
    getChannelState: () => ({ context: { newMessageCount: 0 } }),
    shouldShowIndicator: () => false,
    send: vi.fn(),
  };
  return {
    useChannelScrollStore: () => store,
  };
});

// Streaming store — no in-flight streams for this test.
vi.mock("@/stores/useStreamingStore", () => ({
  useStreamingStore: () => [],
}));

// zustand shallow selector helper — return-as-is so downstream selectors keep
// working against our plain objects.
vi.mock("zustand/react/shallow", () => ({
  useShallow: <T,>(x: T) => x,
}));

// Use real agent-events helpers (getAgentMeta + pairToolEvents).
vi.mock("@/lib/agent-events", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/agent-events")>(
      "@/lib/agent-events",
    );
  return actual;
});

// ---------------------------------------------------------------------------
// Stub MessageItem: render the real TrackingEventItem for agent events, and a
// minimal <div> carrying the text content for regular messages. This keeps
// the integration test focused on the tracking render path (Task 1–10) while
// avoiding the ContextMenu / MessageContent / UserAvatar tree that MessageItem
// normally drags in.
// ---------------------------------------------------------------------------
vi.mock("../MessageItem", async () => {
  const { TrackingEventItem } = await vi.importActual<
    typeof import("../TrackingEventItem")
  >("../TrackingEventItem");
  const { getAgentMeta } =
    await vi.importActual<typeof import("@/lib/agent-events")>(
      "@/lib/agent-events",
    );
  return {
    MessageItem: ({ message }: { message: Message }) => {
      const meta = getAgentMeta(message);
      if (meta) {
        return (
          <div data-testid="agent-event-item" data-id={message.id}>
            <TrackingEventItem
              metadata={meta}
              content={message.content ?? ""}
              collapsible={
                meta.agentEventType === "tool_result" ||
                meta.agentEventType === "thinking"
              }
            />
          </div>
        );
      }
      return (
        <div
          data-testid="text-message"
          data-id={message.id}
          className="text-message"
        >
          {message.content}
        </div>
      );
    },
  };
});

// Streaming message item — unused by this test but still imported by MessageList.
vi.mock("../StreamingMessageItem", () => ({
  StreamingMessageItem: () => <div data-testid="streaming-item" />,
}));

// The A2UI surface / response blocks are not under test here.
vi.mock("../A2UISurfaceBlock", () => ({
  A2UISurfaceBlock: () => <div data-testid="a2ui-surface" />,
}));

vi.mock("../A2UIResponseItem", () => ({
  A2UIResponseItem: () => <div data-testid="a2ui-response" />,
}));

vi.mock("../BotThinkingIndicator", () => ({
  BotThinkingIndicator: () => <div data-testid="bot-thinking" />,
}));

vi.mock("../NewMessagesIndicator", () => ({
  NewMessagesIndicator: () => <div data-testid="new-messages-indicator" />,
}));

vi.mock("../UnreadDivider", () => ({
  UnreadDivider: () => <div data-testid="unread-divider" />,
}));

// ---------------------------------------------------------------------------
// After mocks: import the component under test.
// ---------------------------------------------------------------------------
import { MessageList } from "../MessageList";

// ---------------------------------------------------------------------------
// Test-data factories — mimic real agent events the backend emits.
// ---------------------------------------------------------------------------

let _timeCursor = 0;
function nextCreatedAt(): string {
  // Each event gets a strictly-increasing timestamp so MessageList's reverse()
  // path doesn't shuffle events when we insert them in chronological order.
  _timeCursor += 1;
  return new Date(1_700_000_000_000 + _timeCursor * 1_000).toISOString();
}

function baseMessage(id: string, overrides: Partial<Message> = {}): Message {
  return {
    id,
    channelId: "ch-1",
    senderId: "bot-1",
    content: `Message ${id}`,
    type: "text" as MessageType,
    isPinned: false,
    isEdited: false,
    isDeleted: false,
    createdAt: nextCreatedAt(),
    updatedAt: nextCreatedAt(),
    ...overrides,
  };
}

function makeThinkingEvent(
  id: string,
  thinking: string,
  tokens: number,
  durationMs: number,
): Message {
  return baseMessage(id, {
    content: "",
    metadata: {
      agentEventType: "thinking",
      status: "completed",
      thinking,
      totalTokens: tokens,
      durationMs,
    },
  });
}

function makeToolCallEvent(
  id: string,
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>,
): Message {
  return baseMessage(id, {
    content: "",
    metadata: {
      agentEventType: "tool_call",
      status: "completed",
      toolName,
      toolCallId,
      toolArgs: args,
    },
  });
}

function makeToolResultEvent(
  id: string,
  toolCallId: string,
  toolName: string,
  result: string,
  success: boolean,
): Message {
  return baseMessage(id, {
    content: result,
    metadata: {
      agentEventType: "tool_result",
      status: success ? "completed" : "failed",
      toolName,
      toolCallId,
      success,
    },
  });
}

function makeAgentReply(id: string, content: string): Message {
  return baseMessage(id, {
    type: "text",
    content,
  });
}

// MessageList expects messages in DESC order (newest first) and reverses
// internally. Tests build chronological lists and convert here for clarity.
function asProps(chronoMessages: Message[]) {
  return {
    messages: [...chronoMessages].reverse(),
    isLoading: false,
    onLoadMore: vi.fn(),
    channelId: "ch-1",
  };
}

function ProvidersWrapper({ children }: PropsWithChildren) {
  return <>{children}</>;
}

function renderList(
  chronoMessages: Message[],
  extra: Partial<Parameters<typeof MessageList>[0]> = {},
) {
  return render(
    <ProvidersWrapper>
      <MessageList {...asProps(chronoMessages)} {...extra} />
    </ProvidersWrapper>,
  );
}

function rerenderList(
  rerender: (ui: React.ReactElement) => void,
  chronoMessages: Message[],
  extra: Partial<Parameters<typeof MessageList>[0]> = {},
) {
  rerender(
    <ProvidersWrapper>
      <MessageList {...asProps(chronoMessages)} {...extra} />
    </ProvidersWrapper>,
  );
}

// ---------------------------------------------------------------------------
// Global test setup — real i18n in English so the assertions match the
// strings users actually see.
// ---------------------------------------------------------------------------

beforeEach(async () => {
  _timeCursor = 0;
  if (i18n.language !== "en") {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  }
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Tracking UX end-to-end integration", () => {
  describe("DM channel multi-round execution", () => {
    it("phase 1: round 1 in progress — latest round is fully expanded with real tracking rows", () => {
      // Round 1 so far: thinking → tool_call → tool_result (no final reply).
      // Since nothing follows this round it is still the latest → expanded.
      const round1Chrono = [
        makeThinkingEvent("r1-think", "Analyzing the request", 1200, 123_000),
        makeToolCallEvent("r1-call", "call-1", "send_message", {
          text: "hi",
        }),
        makeToolResultEvent("r1-result", "call-1", "send_message", "ok", true),
      ];

      renderList(round1Chrono, { channelType: "direct" });

      // Real TrackingEventItem renders the thinking stats label.
      expect(screen.getByText("Thought for 2m 3s")).toBeInTheDocument();

      // Real ToolCallBlock renders the friendly tool label for send_message.
      // Because the tool finished successfully, the label is "Message sent".
      expect(screen.getByText("Message sent")).toBeInTheDocument();

      // The combined tool_call+tool_result block displays the tool
      // invocation on a single line: `send_message({"text":"hi"})`.
      // (Since send_message is not registered in toolParamConfig, the args
      // fall back to JSON.stringify.)
      expect(screen.getByText(/send_message\(\{/)).toBeInTheDocument();

      // Because Round 1 is still the latest round, there must NOT be a
      // RoundCollapseSummary button.
      expect(
        screen.queryByRole("button", { name: /Expand execution process/i }),
      ).not.toBeInTheDocument();
    });

    it("phase 2: round 1 complete with final reply — round auto-folds, reply stays visible, click re-expands", () => {
      // Once round 1's text reply is appended, the agent-event round is no
      // longer the trailing (latest) round — per `groupMessagesByRound` the
      // text reply makes the preceding round `isLatest=false`, so the fold
      // logic collapses it automatically. That's intentional: there's no
      // in-between "reply arrived but round still expanded" state, the fold
      // happens as soon as the reply lands. The reply itself is never
      // folded (only agent events are), so both the summary row AND the
      // reply are visible at this point.
      const round1WithReply = [
        makeThinkingEvent("r1-think", "Analyzing", 800, 30_000),
        makeToolCallEvent("r1-call", "call-1", "send_message", {
          text: "hi",
        }),
        makeToolResultEvent("r1-result", "call-1", "send_message", "ok", true),
        makeAgentReply("r1-reply", "Hi there — how can I help?"),
      ];

      renderList(round1WithReply, { channelType: "direct" });

      // Round 1 is auto-folded → summary button visible with 2 steps
      // (thinking + the paired tool_call/tool_result collapse to a single
      // ToolCallBlock card, so the visible row count is 2 not 3).
      expect(
        screen.getByRole("button", {
          name: /Expand execution process \(2 steps\)/i,
        }),
      ).toBeInTheDocument();

      // Thinking rows stay visible even inside a folded round — the
      // round still collapses, but "Thought for Xs" reads as the round's
      // preview line (the primary signal of what the agent did) while
      // tool calls and other steps hide behind the summary.
      expect(screen.getByText("Thought for 30s")).toBeInTheDocument();
      expect(screen.queryByText("Message sent")).not.toBeInTheDocument();

      // The text reply is always visible regardless of fold state.
      expect(
        screen.getByText("Hi there — how can I help?"),
      ).toBeInTheDocument();

      // Clicking the summary expands Round 1 and reveals its full execution
      // steps — real TrackingEventItem renders the thinking label, real
      // ToolCallBlock renders the friendly tool label.
      fireEvent.click(
        screen.getByRole("button", {
          name: /Expand execution process \(2 steps\)/i,
        }),
      );

      expect(screen.getByText("Thought for 30s")).toBeInTheDocument();
      expect(screen.getByText("Message sent")).toBeInTheDocument();
      // Summary button is gone now.
      expect(
        screen.queryByRole("button", { name: /Expand execution process/i }),
      ).not.toBeInTheDocument();
      // Reply is still there after expansion.
      expect(
        screen.getByText("Hi there — how can I help?"),
      ).toBeInTheDocument();
    });

    it("phase 3: round 2 in progress — round 1 is auto-folded, round 2 stays expanded", () => {
      // Round 1 (thinking + tool call) + reply + Round 2 (thinking + tool
      // call, NO reply yet). Round 1 is non-latest → folded. Round 2 is the
      // trailing agent-event round → still expanded.
      const round1 = [
        makeThinkingEvent("r1-think", "Round 1 thinking", 500, 10_000),
        makeToolCallEvent("r1-call", "call-1", "send_message", { text: "hi" }),
        makeToolResultEvent("r1-result", "call-1", "send_message", "ok", true),
      ];
      const round1Reply = makeAgentReply("r1-reply", "First round reply text");
      const round2 = [
        makeThinkingEvent("r2-think", "Round 2 thinking", 700, 20_000),
        makeToolCallEvent("r2-call", "call-2", "search_docs", {
          query: "team9",
        }),
        makeToolResultEvent(
          "r2-result",
          "call-2",
          "search_docs",
          "3 results",
          true,
        ),
      ];

      const chrono = [...round1, round1Reply, ...round2];
      renderList(chrono, { channelType: "direct" });

      // Round 1 is folded → RoundCollapseSummary button with step count.
      // Round 1 has 3 agent-event messages (thinking + tool_call +
      // tool_result) but only 2 visible rows once rendered: the paired
      // tool_call/tool_result collapse into a single ToolCallBlock card,
      // so stepCount on the summary is 2, not 3.
      const foldButton = screen.getByRole("button", {
        name: /Expand execution process \(2 steps\)/i,
      });
      expect(foldButton).toBeInTheDocument();

      // Round 1's thinking row stays visible even inside the fold — it
      // reads as the round's preview line so the user still sees what
      // the agent was doing. Round 1's tool call (send_message) stays
      // hidden; only Round 2's search_docs is visible below.
      expect(screen.getByText("Thought for 10s")).toBeInTheDocument();
      expect(screen.queryByText(/send_message\(\{/)).not.toBeInTheDocument();

      // Round 1's reply text is still visible (replies are NEVER folded).
      expect(screen.getByText("First round reply text")).toBeInTheDocument();

      // Round 2 is expanded → its thinking label is visible.
      expect(screen.getByText("Thought for 20s")).toBeInTheDocument();

      // Round 2's tool call is the search_docs tool → localized "Documents
      // found" label for the completed state.
      expect(screen.getByText("Documents found")).toBeInTheDocument();
      expect(screen.getByText(/search_docs\(\{/)).toBeInTheDocument();
    });

    it("phase 4: clicking the round 1 summary button re-expands round 1", () => {
      const round1 = [
        makeThinkingEvent("r1-think", "Round 1 thinking", 500, 10_000),
        makeToolCallEvent("r1-call", "call-1", "send_message", { text: "hi" }),
        makeToolResultEvent("r1-result", "call-1", "send_message", "ok", true),
      ];
      const round1Reply = makeAgentReply("r1-reply", "Round 1 reply");
      const round2 = [
        makeThinkingEvent("r2-think", "Round 2 thinking", 700, 20_000),
        makeToolCallEvent("r2-call", "call-2", "search_docs", {
          query: "team9",
        }),
      ];

      const chrono = [...round1, round1Reply, ...round2];
      renderList(chrono, { channelType: "direct" });

      // Sanity: Round 1 starts folded. Thinking row stays visible as
      // the preview; the summary button surfaces the hidden steps.
      expect(screen.getByText("Thought for 10s")).toBeInTheDocument();
      const summary = screen.getByRole("button", {
        name: /Expand execution process \(2 steps\)/i,
      });

      // Click to expand.
      fireEvent.click(summary);

      // Summary button is gone.
      expect(
        screen.queryByRole("button", { name: /Expand execution process/i }),
      ).not.toBeInTheDocument();

      // Round 1's tracking rows are now visible alongside round 2's.
      expect(screen.getByText("Thought for 10s")).toBeInTheDocument();
      expect(screen.getByText("Thought for 20s")).toBeInTheDocument();

      // Round 1 reply is also still there.
      expect(screen.getByText("Round 1 reply")).toBeInTheDocument();
    });

    it("phase 5: after user expansion, round 1 stays expanded when round 2 finishes (user preference preserved)", () => {
      const round1 = [
        makeThinkingEvent("r1-think", "Round 1 thinking", 500, 10_000),
        makeToolCallEvent("r1-call", "call-1", "send_message", { text: "hi" }),
        makeToolResultEvent("r1-result", "call-1", "send_message", "ok", true),
      ];
      const round1Reply = makeAgentReply("r1-reply", "Round 1 reply");
      const round2Running = [
        makeThinkingEvent("r2-think", "Round 2 thinking", 700, 20_000),
        makeToolCallEvent("r2-call", "call-2", "search_docs", {
          query: "team9",
        }),
      ];

      const { rerender } = renderList(
        [...round1, round1Reply, ...round2Running],
        { channelType: "direct" },
      );

      // Expand round 1 manually.
      fireEvent.click(
        screen.getByRole("button", {
          name: /Expand execution process \(2 steps\)/i,
        }),
      );
      expect(screen.getByText("Thought for 10s")).toBeInTheDocument();

      // Round 2 finishes: append its result + reply.
      const round2Result = makeToolResultEvent(
        "r2-result",
        "call-2",
        "search_docs",
        "3 results",
        true,
      );
      const round2Reply = makeAgentReply("r2-reply", "Round 2 reply text");

      const finalChrono = [
        ...round1,
        round1Reply,
        ...round2Running,
        round2Result,
        round2Reply,
      ];
      rerenderList(rerender, finalChrono, { channelType: "direct" });

      // Round 1 stays expanded — the user's explicit expansion choice
      // persists across re-renders.
      expect(screen.getByText("Thought for 10s")).toBeInTheDocument();

      // Round 2 is now non-latest (it's followed by its reply). Since the
      // user did NOT manually expand Round 2, it collapses. The summary
      // button for Round 2 is rendered with 2 visible steps (the paired
      // tool_call/tool_result render as a single combined card).
      expect(
        screen.getByRole("button", {
          name: /Expand execution process \(2 steps\)/i,
        }),
      ).toBeInTheDocument();

      // Round 2's reply is still visible.
      expect(screen.getByText("Round 2 reply text")).toBeInTheDocument();
      // Round 1's reply is also still visible.
      expect(screen.getByText("Round 1 reply")).toBeInTheDocument();
    });
  });

  describe("non-DM channel (tracking) does not fold", () => {
    it("shows all events regardless of rounds", () => {
      // Same fold-prone data as phase 3 but in a tracking channel → every
      // event must render in full, no summary button anywhere.
      const round1 = [
        makeThinkingEvent("r1-think", "Round 1 thinking", 500, 10_000),
        makeToolCallEvent("r1-call", "call-1", "send_message", { text: "hi" }),
        makeToolResultEvent("r1-result", "call-1", "send_message", "ok", true),
      ];
      const round1Reply = makeAgentReply("r1-reply", "Round 1 reply");
      const round2 = [
        makeThinkingEvent("r2-think", "Round 2 thinking", 700, 20_000),
        makeToolCallEvent("r2-call", "call-2", "search_docs", {
          query: "team9",
        }),
      ];
      const chrono = [...round1, round1Reply, ...round2];

      renderList(chrono, { channelType: "tracking" });

      // No fold button anywhere in tracking channels.
      expect(
        screen.queryByRole("button", { name: /Expand execution process/i }),
      ).not.toBeInTheDocument();

      // All tracking rows are visible simultaneously.
      expect(screen.getByText("Thought for 10s")).toBeInTheDocument();
      expect(screen.getByText("Thought for 20s")).toBeInTheDocument();

      // Both tool call blocks render inline (send_message + search_docs).
      expect(screen.getByText("Message sent")).toBeInTheDocument();
      expect(screen.getByText("Documents found")).toBeInTheDocument();

      // The reply text is also still visible.
      expect(screen.getByText("Round 1 reply")).toBeInTheDocument();
    });
  });
});
