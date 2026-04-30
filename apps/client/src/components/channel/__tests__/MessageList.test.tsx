/**
 * Integration tests for MessageList's round auto-fold behavior.
 *
 * MessageList pulls in a lot of peripheral state (query client, streaming
 * store, scroll state machine, virtualiser) that isn't relevant to the fold
 * logic, so every collaborator is stubbed here. The react-virtuoso mock
 * replaces the virtualiser with a plain list that invokes `itemContent` once
 * per item — exactly what we need to see the fold decisions in the rendered
 * DOM.
 */

import type { PropsWithChildren } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

import type { Message, AgentEventMetadata, MessageType } from "@/types/im";

// ---------------------------------------------------------------------------
// Mocks — collaborators we don't care about
// ---------------------------------------------------------------------------

// Minimal `t()` stand-in: returns the key by default, but expands the
// tracking keys that MessageList's round-fold tests rely on (RoundCollapseSummary)
// so the accessible name remains human-readable. This keeps the mock narrow
// while still letting the existing /Expand execution process/i matchers work.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (key === "tracking.round.expandAriaLabel") {
        return `Expand execution process (${values?.count ?? ""} steps)`;
      }
      if (key === "tracking.round.collapseSummary") {
        return `... Show execution (${values?.count ?? ""} steps)`;
      }
      return key;
    },
  }),
}));
vi.mock("@/hooks/useMessages", () => ({
  useFullContent: () => ({ data: undefined, isLoading: false, isError: false }),
}));

// Virtuoso: render the list synchronously; ignore scrolling, headers, etc.
// We honor `firstItemIndex` so that the real MessageList's absolute-index
// arithmetic (e.g. `itemIndex = index - firstItemIndex`) produces correct
// 0-based offsets into the data array.
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

// Auth hook — return a stable current user
vi.mock("@/hooks/useAuth", () => ({
  useCurrentUser: () => ({ data: { id: "current-user" } }),
}));

// Channel members (only used by empty state)
vi.mock("@/hooks/useChannels", () => ({
  useChannelMembers: () => ({ data: [] }),
}));

// Thread store
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

// Message mutations
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

// Channel scroll state machine
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

// Streaming store — no streaming messages for these tests
vi.mock("@/stores/useStreamingStore", () => ({
  useStreamingStore: () => [],
}));

// Agent-event helpers: the real `getAgentMeta` pulls from message.metadata,
// and pairToolEvents is a no-op identity for our inputs (no tool pairs),
// so we can import the real ones.
vi.mock("@/lib/agent-events", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/agent-events")>(
      "@/lib/agent-events",
    );
  return actual;
});

// MessageItem / ChannelMessageItem are swapped for a text stub so the tests
// can assert on raw message IDs without rendering the real UI.
vi.mock("../MessageItem", () => ({
  MessageItem: ({ message }: { message: Message }) => (
    <div data-testid="message-item" data-id={message.id}>
      {message.content}
    </div>
  ),
}));

vi.mock("../StreamingMessageItem", () => ({
  StreamingMessageItem: () => <div data-testid="streaming-item" />,
}));

vi.mock("../ToolCallBlock", () => ({
  ToolCallBlock: ({
    callMetadata,
    resultMetadata,
    resultContent,
    resultMessage,
  }: {
    callMetadata?: { toolCallId?: string; toolName?: string };
    resultMetadata?: { toolCallId?: string };
    resultContent?: string;
    resultMessage?: { id?: string };
  }) => (
    <div
      data-testid="tool-call-block"
      data-tool-call-id={callMetadata?.toolCallId ?? ""}
      data-tool-name={callMetadata?.toolName ?? ""}
      data-result-tool-call-id={resultMetadata?.toolCallId ?? ""}
      data-result-content={resultContent ?? ""}
      data-result-message-id={resultMessage?.id ?? ""}
    />
  ),
}));

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

// `zustand/react/shallow` is only used for the streaming store selector which
// we short-circuit, but the import still has to resolve.
vi.mock("zustand/react/shallow", () => ({
  useShallow: <T,>(x: T) => x,
}));

// ---------------------------------------------------------------------------
// After mocks: import the component under test.
// ---------------------------------------------------------------------------
import { MessageList } from "../MessageList";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessage(id: string, overrides: Partial<Message> = {}): Message {
  return {
    id,
    channelId: "ch-1",
    senderId: "user-1",
    content: `Message ${id}`,
    type: "text" as MessageType,
    isPinned: false,
    isEdited: false,
    isDeleted: false,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeAgentEvent(
  id: string,
  agentEventType: AgentEventMetadata["agentEventType"] = "thinking",
): Message {
  return makeMessage(id, {
    senderId: "bot-1",
    content: `${agentEventType} event ${id}`,
    metadata: {
      agentEventType,
      status: "running",
    },
  });
}

function makeToolCall(
  id: string,
  toolCallId: string,
  toolName = "my_tool",
): Message {
  return makeMessage(id, {
    senderId: "bot-1",
    content: `tool_call ${toolName}`,
    metadata: {
      agentEventType: "tool_call",
      status: "running",
      toolName,
      toolCallId,
    },
  });
}

function makeToolResult(
  id: string,
  toolCallId: string,
  content = "tool result payload",
): Message {
  return makeMessage(id, {
    senderId: "bot-1",
    content,
    metadata: {
      agentEventType: "tool_result",
      status: "completed",
      toolCallId,
    },
  });
}

// MessageList receives messages in DESC order (newest first) and reverses
// internally. Tests construct chronological lists then reverse here for
// clarity.
function asProps(chronoMessages: Message[]) {
  return {
    messages: [...chronoMessages].reverse(),
    isLoading: false,
    onLoadMore: vi.fn(),
    channelId: "ch-1",
  };
}

// Strip out hidden placeholder divs to make assertions readable.
function getRenderedMessageIds(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-id]")).map(
    (el) => el.dataset.id ?? "",
  );
}

function ProvidersWrapper({ children }: PropsWithChildren) {
  // No providers needed thanks to mocks, but keep the wrapper so future
  // additions are trivial.
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MessageList — round auto-fold", () => {
  describe("direct channel (DM)", () => {
    it("renders a collapse summary for a non-latest round", () => {
      const chrono = [
        makeAgentEvent("a1", "thinking"),
        makeAgentEvent("a2", "tool_call"),
        makeAgentEvent("a3", "agent_end"),
        makeMessage("u1", { content: "reply from bot" }),
      ];

      renderList(chrono, { channelType: "direct" });

      // The summary is rendered (CJK text and step count from RoundCollapseSummary)
      const summaryButton = screen.getByRole("button", {
        name: /Expand execution process \(3 steps\)/i,
      });
      expect(summaryButton).toBeInTheDocument();

      // The reply from the bot is still visible
      expect(screen.getByText("reply from bot")).toBeInTheDocument();

      // Thinking (a1) stays visible as the round's preview line; the
      // other agent events (tool_call a2, agent_end a3) are absorbed
      // into the summary.
      const renderedIds = getRenderedMessageIds();
      expect(renderedIds).toContain("u1");
      expect(renderedIds).toContain("a1");
      expect(renderedIds).not.toContain("a2");
      expect(renderedIds).not.toContain("a3");
    });

    it("leaves the latest round expanded", () => {
      const chrono = [
        makeMessage("u1", { content: "ask" }),
        makeAgentEvent("a1", "thinking"),
        makeAgentEvent("a2", "tool_call"),
      ];

      renderList(chrono, { channelType: "direct" });

      expect(
        screen.queryByRole("button", { name: /Expand execution process/i }),
      ).not.toBeInTheDocument();

      const renderedIds = getRenderedMessageIds();
      expect(renderedIds).toEqual(expect.arrayContaining(["u1", "a1", "a2"]));
    });

    it("expands a folded round when the summary button is clicked", () => {
      const chrono = [
        makeAgentEvent("a1", "thinking"),
        makeAgentEvent("a2", "agent_end"),
        makeMessage("u1", { content: "bot reply" }),
      ];

      renderList(chrono, { channelType: "direct" });

      // Initially folded — thinking (a1) stays visible as the preview,
      // but agent_end (a2) is hidden behind the summary.
      expect(getRenderedMessageIds()).toContain("a1");
      expect(getRenderedMessageIds()).not.toContain("a2");

      fireEvent.click(
        screen.getByRole("button", {
          name: /Expand execution process \(2 steps\)/i,
        }),
      );

      // After expansion, both agent events are rendered
      const renderedIds = getRenderedMessageIds();
      expect(renderedIds).toContain("a1");
      expect(renderedIds).toContain("a2");
      expect(renderedIds).toContain("u1");

      // Summary button is gone
      expect(
        screen.queryByRole("button", { name: /Expand execution process/i }),
      ).not.toBeInTheDocument();
    });

    it("re-folds a round when the expanded summary is clicked again", () => {
      const chrono = [
        makeAgentEvent("a1", "thinking"),
        makeAgentEvent("a2", "agent_end"),
        makeMessage("u1", { content: "done" }),
      ];

      const { rerender } = renderList(chrono, { channelType: "direct" });

      // Expand
      fireEvent.click(
        screen.getByRole("button", { name: /Expand execution process/i }),
      );
      expect(getRenderedMessageIds()).toContain("a1");

      // There's no summary button any more — simulate a second round by
      // re-running the fold logic with a different non-latest round. The
      // simplest collapse trigger is a fresh click if we re-introduce the
      // summary via a re-render of the same data (expanded state is internal
      // to the component, so we rerender with different ids to reset).
      // We pick `writing` + `agent_end` for the new round so neither is a
      // "thinking" event — thinking rows stay visible even when folded, so
      // using them here would muddy the fold-behaviour assertion.
      rerender(
        <ProvidersWrapper>
          <MessageList
            {...asProps([
              makeAgentEvent("b1", "writing"),
              makeAgentEvent("b2", "agent_end"),
              makeMessage("u2"),
            ])}
            channelType="direct"
          />
        </ProvidersWrapper>,
      );

      // New round b1 is now folded again (no user expansion recorded for it)
      expect(
        screen.getByRole("button", {
          name: /Expand execution process \(2 steps\)/i,
        }),
      ).toBeInTheDocument();
      expect(getRenderedMessageIds()).not.toContain("b1");
    });

    it("auto-folds the old round when a new round arrives", () => {
      const initialChrono = [
        makeMessage("u0", { content: "hi" }),
        makeAgentEvent("a1", "thinking"),
        makeAgentEvent("a2", "agent_end"),
      ];

      const { rerender } = renderList(initialChrono, {
        channelType: "direct",
      });

      // Initially, the round is the latest → expanded
      expect(getRenderedMessageIds()).toEqual(
        expect.arrayContaining(["u0", "a1", "a2"]),
      );
      expect(
        screen.queryByRole("button", { name: /Expand execution process/i }),
      ).not.toBeInTheDocument();

      // A reply arrives, pushing the original round to non-latest
      const nextChrono = [
        ...initialChrono,
        makeMessage("u1", { content: "bot reply 1" }),
        makeAgentEvent("b1", "thinking"),
      ];

      rerender(
        <ProvidersWrapper>
          <MessageList {...asProps(nextChrono)} channelType="direct" />
        </ProvidersWrapper>,
      );

      // The old round collapses but its thinking row (a1) stays as
      // the preview; agent_end (a2) is absorbed into the summary.
      const renderedIds = getRenderedMessageIds();
      expect(renderedIds).toContain("a1");
      expect(renderedIds).not.toContain("a2");
      expect(renderedIds).toContain("u1");
      expect(renderedIds).toContain("b1");
      expect(
        screen.getByRole("button", {
          name: /Expand execution process \(2 steps\)/i,
        }),
      ).toBeInTheDocument();
    });

    it("renders nothing but the empty state for an empty DM", () => {
      renderList([], { channelType: "direct" });

      expect(screen.queryByTestId("virtuoso-mock")).not.toBeInTheDocument();
      // The empty state message is shown
      expect(screen.getByText(/noMessagesYetDefault/i)).toBeInTheDocument();
    });

    it("handles a DM with only agent events (latest round)", () => {
      const chrono = [
        makeAgentEvent("a1", "thinking"),
        makeAgentEvent("a2", "tool_call"),
      ];

      renderList(chrono, { channelType: "direct" });

      // No summary — this is still the latest round
      expect(
        screen.queryByRole("button", { name: /Expand execution process/i }),
      ).not.toBeInTheDocument();
      // Both events rendered
      expect(getRenderedMessageIds()).toEqual(
        expect.arrayContaining(["a1", "a2"]),
      );
    });
  });

  describe("direct channel — tool_call + tool_result pair in folded rounds", () => {
    it("folds a non-latest round that contains a tool_call/tool_result pair", () => {
      // A full agent round: thinking → tool_call → tool_result → agent_end.
      // The round is non-latest because a user reply follows it.
      const chrono = [
        makeAgentEvent("a1", "thinking"),
        makeToolCall("a2", "call-1", "search"),
        makeToolResult("a3", "call-1", "result body"),
        makeAgentEvent("a4", "agent_end"),
        makeMessage("u1", { content: "bot reply" }),
      ];

      renderList(chrono, { channelType: "direct" });

      // The round is collapsed — 3 visible steps are reported. The round
      // has 4 agent-event messages, but when expanded the paired
      // tool_call + tool_result collapse into a single ToolCallBlock, so
      // the summary label shows the visible row count (thinking +
      // combined tool card + agent_end = 3).
      const summary = screen.getByRole("button", {
        name: /Expand execution process \(3 steps\)/i,
      });
      expect(summary).toBeInTheDocument();

      // Neither the tool_call nor the tool_result should leak through as
      // visible content (they're part of the folded round).
      expect(screen.queryByTestId("tool-call-block")).not.toBeInTheDocument();

      // Regular bot reply is still visible
      expect(screen.getByText("bot reply")).toBeInTheDocument();

      // Thinking (a1) stays visible as the preview; everything else in
      // the round (tool_call a2, tool_result a3, agent_end a4) is
      // absorbed into the summary.
      const renderedIds = getRenderedMessageIds();
      expect(renderedIds).toContain("a1");
      expect(renderedIds).not.toContain("a2");
      expect(renderedIds).not.toContain("a3");
      expect(renderedIds).not.toContain("a4");
      expect(renderedIds).toContain("u1");
    });

    it("on expand, renders tool_call+tool_result as a single ToolCallBlock (no duplicate tool_result)", () => {
      // Chronologically: tool_result appears BEFORE tool_call. pairToolEvents
      // should reorder them so tool_result immediately follows tool_call, and
      // the combined render path should produce a single ToolCallBlock.
      const chrono = [
        makeAgentEvent("a1", "thinking"),
        makeToolResult("a3", "call-1", "final result"),
        makeToolCall("a2", "call-1", "browser"),
        makeAgentEvent("a4", "agent_end"),
        makeMessage("u1", { content: "bot reply" }),
      ];

      renderList(chrono, { channelType: "direct" });

      // Initially folded — click to expand. Visible-row count is 3
      // (thinking + combined tool_call/tool_result card + agent_end).
      const summary = screen.getByRole("button", {
        name: /Expand execution process \(3 steps\)/i,
      });
      fireEvent.click(summary);

      // Summary is gone after expansion
      expect(
        screen.queryByRole("button", { name: /Expand execution process/i }),
      ).not.toBeInTheDocument();

      // Exactly ONE ToolCallBlock is rendered — combining the tool_call and
      // tool_result into one card, not two separate items.
      const toolCallBlocks = screen.getAllByTestId("tool-call-block");
      expect(toolCallBlocks).toHaveLength(1);

      // The ToolCallBlock was given both the call and result metadata,
      // proving the combination path fired.
      const block = toolCallBlocks[0];
      expect(block.getAttribute("data-tool-call-id")).toBe("call-1");
      expect(block.getAttribute("data-tool-name")).toBe("browser");
      expect(block.getAttribute("data-result-tool-call-id")).toBe("call-1");
      expect(block.getAttribute("data-result-content")).toBe("final result");
      expect(block.getAttribute("data-result-message-id")).toBe("a3");

      // The tool_result message (a3) is NOT rendered independently as a
      // MessageItem — it was consumed by the combined block.
      const renderedIds = getRenderedMessageIds();
      expect(renderedIds).not.toContain("a3");

      // Sanity: the non-tool events in the round are now rendered as
      // individual MessageItems (thinking + agent_end), and the bot reply
      // stays visible.
      expect(renderedIds).toContain("a1");
      expect(renderedIds).toContain("a4");
      expect(renderedIds).toContain("u1");
    });

    it("renders a standalone tool_call+tool_result pair in the latest (expanded) round without duplicates", () => {
      // No non-latest round → the pair is in the latest (expanded) round and
      // must still render as a single combined ToolCallBlock. This guards
      // against accidental duplicate rendering when the fold path is not
      // exercised.
      const chrono = [
        makeMessage("u0", { content: "please search" }),
        makeToolCall("a1", "call-42", "search"),
        makeToolResult("a2", "call-42", "hit count: 3"),
      ];

      renderList(chrono, { channelType: "direct" });

      // No summary (this is the latest round)
      expect(
        screen.queryByRole("button", { name: /Expand execution process/i }),
      ).not.toBeInTheDocument();

      const toolCallBlocks = screen.getAllByTestId("tool-call-block");
      expect(toolCallBlocks).toHaveLength(1);
      expect(toolCallBlocks[0].getAttribute("data-tool-call-id")).toBe(
        "call-42",
      );
      expect(toolCallBlocks[0].getAttribute("data-result-content")).toBe(
        "hit count: 3",
      );

      // a2 (tool_result) is not independently rendered
      const renderedIds = getRenderedMessageIds();
      expect(renderedIds).not.toContain("a2");
      expect(renderedIds).toContain("u0");
    });

    it("renders an unpaired running tool_call as a ToolCallBlock", () => {
      const chrono = [makeToolCall("call-1", "tc-running", "RunScript")];
      chrono[0].metadata = {
        agentEventType: "tool_call",
        status: "running",
        toolCallId: "tc-running",
        toolName: "RunScript",
        toolArgsText: '{"cmd":"pnpm test',
      };

      renderList(chrono, { channelType: "direct" });

      const blocks = screen.getAllByTestId("tool-call-block");
      expect(blocks).toHaveLength(1);
      expect(blocks[0].getAttribute("data-tool-call-id")).toBe("tc-running");
      expect(blocks[0].getAttribute("data-result-tool-call-id")).toBe("");
      expect(blocks[0].getAttribute("data-result-content")).toBe("");
      expect(blocks[0].getAttribute("data-result-message-id")).toBe("");
      expect(screen.queryByTestId("message-item")).not.toBeInTheDocument();
    });
  });

  describe("non-DM channels", () => {
    it.each(["tracking", "task", "public", "private"] as const)(
      "does not fold rounds in %s channels",
      (channelType) => {
        const chrono = [
          makeAgentEvent("a1"),
          makeAgentEvent("a2"),
          makeMessage("u1"),
        ];

        renderList(chrono, { channelType });

        // No summary row
        expect(
          screen.queryByRole("button", { name: /Expand execution process/i }),
        ).not.toBeInTheDocument();

        // All messages rendered (a2 may be deduped by MessageItem stub but we
        // don't care about order here — just presence)
        const ids = getRenderedMessageIds();
        expect(ids).toEqual(expect.arrayContaining(["a1", "a2", "u1"]));
      },
    );

    it("does not fold rounds when channelType is undefined", () => {
      const chrono = [
        makeAgentEvent("a1"),
        makeAgentEvent("a2"),
        makeMessage("u1"),
      ];

      renderList(chrono);

      expect(
        screen.queryByRole("button", { name: /Expand execution process/i }),
      ).not.toBeInTheDocument();
      expect(getRenderedMessageIds()).toEqual(
        expect.arrayContaining(["a1", "a2", "u1"]),
      );
    });
  });

  describe("user expansion is preserved across re-renders", () => {
    it("keeps a manually-expanded round visible after a benign prop update", () => {
      const chrono = [
        makeAgentEvent("a1"),
        makeAgentEvent("a2"),
        makeMessage("u1"),
      ];

      const { rerender } = renderList(chrono, { channelType: "direct" });

      fireEvent.click(
        screen.getByRole("button", { name: /Expand execution process/i }),
      );
      expect(getRenderedMessageIds()).toContain("a1");

      // Rerender with the same messages but a different prop (e.g. thinking
      // bot ids). The expanded state should persist.
      rerender(
        <ProvidersWrapper>
          <MessageList
            {...asProps(chrono)}
            channelType="direct"
            thinkingBotIds={["bot-1"]}
          />
        </ProvidersWrapper>,
      );
      expect(getRenderedMessageIds()).toContain("a1");
      expect(
        screen.queryByRole("button", { name: /Expand execution process/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe("virtuoso item keys", () => {
    it("assigns stable keys to summary rows (first message id)", () => {
      const chrono = [
        makeAgentEvent("a1"),
        makeAgentEvent("a2"),
        makeMessage("u1"),
      ];
      renderList(chrono, { channelType: "direct" });

      const virtuoso = screen.getByTestId("virtuoso-mock");
      const items = within(virtuoso).getAllByText(
        (_, el) => el?.hasAttribute("data-virtuoso-item-key") ?? false,
      );
      // The summary row and hidden placeholder inherit the original message
      // keys (a1, a2) through `computeItemKey`.
      const keys = items.map(
        (el) => el.getAttribute("data-virtuoso-item-key") ?? "",
      );
      expect(keys).toContain("a1");
      expect(keys).toContain("a2");
      expect(keys).toContain("u1");
    });
  });
});
