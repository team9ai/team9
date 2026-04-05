# ChannelView UI/Logic Separation & TrackingModal Unification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract a reusable `ChannelContent` UI component from `ChannelView`, then refactor `TrackingModal` to use it — unifying the message rendering pipeline across all channel types.

**Architecture:** Extract the inner rendering (MessageList + MessageInput + banners) from `ChannelView` into a standalone `ChannelContent` component that accepts all data as props. `ChannelView` becomes a thin wrapper calling hooks → passing to `ChannelContent`. `TrackingModal` replaces its custom rendering with `ChannelContent` + tracking-specific hooks (`useChannelObserver`, `useChannelMessages`, tracking WS events).

**Tech Stack:** React 19, TypeScript 5.8+, Vitest, React Testing Library, TanStack React Query, Socket.io-client

---

## File Structure

| Action | File                                                                   | Responsibility                                |
| ------ | ---------------------------------------------------------------------- | --------------------------------------------- |
| Create | `apps/client/src/components/channel/ChannelContent.tsx`                | Pure UI: MessageList + MessageInput + banners |
| Create | `apps/client/src/components/channel/__tests__/ChannelContent.test.tsx` | Unit tests for ChannelContent                 |
| Modify | `apps/client/src/components/channel/ChannelView.tsx`                   | Thin wrapper: hooks → ChannelContent          |
| Modify | `apps/client/src/components/channel/TrackingModal.tsx`                 | Replace custom rendering with ChannelContent  |
| Create | `apps/client/src/components/channel/__tests__/TrackingModal.test.tsx`  | Unit tests for refactored TrackingModal       |

---

### Task 1: Create ChannelContent component with tests

**Goal:** Extract a pure UI component that renders MessageList + MessageInput + banners, accepting all data as props.

**Files:**

- Create: `apps/client/src/components/channel/ChannelContent.tsx`
- Create: `apps/client/src/components/channel/__tests__/ChannelContent.test.tsx`

**Acceptance Criteria:**

- [ ] `ChannelContent` renders `MessageList` with all provided message props
- [ ] `ChannelContent` renders `MessageInput` when `onSend` is provided and `readOnly` is false
- [ ] `ChannelContent` renders read-only bar when `readOnly=true`
- [ ] `ChannelContent` renders unsynced banner when `hasMoreUnsynced=true`
- [ ] No `onSend` → no `MessageInput` rendered
- [ ] `readOnly=true` with `onSend` → still no `MessageInput`, shows read-only bar
- [ ] Empty messages → delegates to `MessageList` empty state
- [ ] All optional props omitted → renders with safe defaults
- [ ] 100% test coverage

**Verify:** `cd apps/client && npx vitest run src/components/channel/__tests__/ChannelContent.test.tsx` → all pass

**Steps:**

- [ ] **Step 1: Write the ChannelContent test file**

```tsx
// apps/client/src/components/channel/__tests__/ChannelContent.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChannelContent } from "../ChannelContent";
import type { Message } from "@/types/im";

// Mock child components to isolate ChannelContent
vi.mock("../MessageList", () => ({
  MessageList: (props: Record<string, unknown>) => (
    <div
      data-testid="message-list"
      data-channel-id={props.channelId}
      data-read-only={String(props.readOnly ?? false)}
      data-messages-count={String((props.messages as unknown[])?.length ?? 0)}
    />
  ),
}));

vi.mock("../MessageInput", () => ({
  MessageInput: (props: Record<string, unknown>) => (
    <div
      data-testid="message-input"
      data-disabled={String(props.disabled ?? false)}
      data-placeholder={props.placeholder ?? ""}
    />
  ),
}));

function createMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-1",
    channelId: "ch-1",
    senderId: "user-1",
    content: "Hello",
    type: "text",
    isPinned: false,
    isEdited: false,
    isDeleted: false,
    createdAt: "2026-04-05T00:00:00Z",
    updatedAt: "2026-04-05T00:00:00Z",
    reactions: [],
    replyCount: 0,
    ...overrides,
  };
}

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const defaultProps = {
  channelId: "ch-1",
  messages: [createMessage()],
  isLoading: false,
  onLoadMore: vi.fn(),
};

describe("ChannelContent", () => {
  it("renders MessageList with provided messages", () => {
    renderWithProviders(<ChannelContent {...defaultProps} />);
    const list = screen.getByTestId("message-list");
    expect(list).toHaveAttribute("data-channel-id", "ch-1");
    expect(list).toHaveAttribute("data-messages-count", "1");
  });

  it("renders MessageInput when onSend is provided", () => {
    renderWithProviders(<ChannelContent {...defaultProps} onSend={vi.fn()} />);
    expect(screen.getByTestId("message-input")).toBeInTheDocument();
  });

  it("does not render MessageInput when onSend is omitted", () => {
    renderWithProviders(<ChannelContent {...defaultProps} />);
    expect(screen.queryByTestId("message-input")).not.toBeInTheDocument();
  });

  it("renders read-only bar when readOnly=true", () => {
    renderWithProviders(<ChannelContent {...defaultProps} readOnly />);
    expect(screen.getByText("Read-only")).toBeInTheDocument();
    expect(screen.queryByTestId("message-input")).not.toBeInTheDocument();
  });

  it("renders read-only bar even when onSend is provided if readOnly=true", () => {
    renderWithProviders(
      <ChannelContent {...defaultProps} readOnly onSend={vi.fn()} />,
    );
    expect(screen.getByText("Read-only")).toBeInTheDocument();
    expect(screen.queryByTestId("message-input")).not.toBeInTheDocument();
  });

  it("renders unsynced banner when hasMoreUnsynced=true", () => {
    renderWithProviders(<ChannelContent {...defaultProps} hasMoreUnsynced />);
    expect(screen.getByText(/older unread messages/i)).toBeInTheDocument();
  });

  it("does not render unsynced banner by default", () => {
    renderWithProviders(<ChannelContent {...defaultProps} />);
    expect(
      screen.queryByText(/older unread messages/i),
    ).not.toBeInTheDocument();
  });

  it("passes readOnly to MessageList", () => {
    renderWithProviders(<ChannelContent {...defaultProps} readOnly />);
    expect(screen.getByTestId("message-list")).toHaveAttribute(
      "data-read-only",
      "true",
    );
  });

  it("passes isSendDisabled to MessageInput as disabled", () => {
    renderWithProviders(
      <ChannelContent {...defaultProps} onSend={vi.fn()} isSendDisabled />,
    );
    expect(screen.getByTestId("message-input")).toHaveAttribute(
      "data-disabled",
      "true",
    );
  });

  it("passes inputPlaceholder to MessageInput", () => {
    renderWithProviders(
      <ChannelContent
        {...defaultProps}
        onSend={vi.fn()}
        inputPlaceholder="Send guidance..."
      />,
    );
    expect(screen.getByTestId("message-input")).toHaveAttribute(
      "data-placeholder",
      "Send guidance...",
    );
  });

  it("renders with empty messages array", () => {
    renderWithProviders(<ChannelContent {...defaultProps} messages={[]} />);
    expect(screen.getByTestId("message-list")).toHaveAttribute(
      "data-messages-count",
      "0",
    );
  });

  it("renders with all optional props omitted", () => {
    renderWithProviders(<ChannelContent {...defaultProps} />);
    expect(screen.getByTestId("message-list")).toBeInTheDocument();
    expect(screen.queryByTestId("message-input")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/older unread messages/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Read-only")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/client && npx vitest run src/components/channel/__tests__/ChannelContent.test.tsx`
Expected: FAIL — `Cannot find module '../ChannelContent'`

- [ ] **Step 3: Create the ChannelContent component**

```tsx
// apps/client/src/components/channel/ChannelContent.tsx
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import type { AttachmentDto, Message, ChannelMember } from "@/types/im";

export interface ChannelContentProps {
  // MessageList props
  channelId: string;
  channelType?: string;
  messages: Message[];
  isLoading: boolean;
  onLoadMore: () => void;
  hasMore?: boolean;
  onLoadNewer?: () => void;
  hasNewer?: boolean;
  isLoadingNewer?: boolean;
  highlightMessageId?: string;
  readOnly?: boolean;
  thinkingBotIds?: string[];
  members?: ChannelMember[];
  lastReadMessageId?: string;

  // MessageInput props
  onSend?: (content: string, attachments?: AttachmentDto[]) => Promise<void>;
  isSendDisabled?: boolean;
  inputPlaceholder?: string;
  initialDraft?: string;

  // Optional banners
  hasMoreUnsynced?: boolean;
}

export function ChannelContent({
  channelId,
  channelType,
  messages,
  isLoading,
  onLoadMore,
  hasMore,
  onLoadNewer,
  hasNewer,
  isLoadingNewer,
  highlightMessageId,
  readOnly = false,
  thinkingBotIds,
  members,
  lastReadMessageId,
  onSend,
  isSendDisabled,
  inputPlaceholder,
  initialDraft,
  hasMoreUnsynced,
}: ChannelContentProps) {
  return (
    <>
      {hasMoreUnsynced && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 px-4 py-2 text-sm text-amber-700 dark:text-amber-300">
          You have older unread messages. Scroll up to load more.
        </div>
      )}
      <MessageList
        key={channelId}
        messages={messages}
        isLoading={isLoading}
        onLoadMore={onLoadMore}
        hasMore={hasMore}
        onLoadNewer={onLoadNewer}
        hasNewer={hasNewer}
        isLoadingNewer={isLoadingNewer}
        highlightMessageId={highlightMessageId}
        channelId={channelId}
        channelType={channelType}
        readOnly={readOnly}
        thinkingBotIds={thinkingBotIds}
        members={members}
        lastReadMessageId={lastReadMessageId}
      />
      {readOnly ? (
        <div className="px-4 py-3 border-t border-border bg-muted/30 text-center">
          <span className="text-sm text-muted-foreground">Read-only</span>
        </div>
      ) : onSend ? (
        <MessageInput
          channelId={channelId}
          onSend={onSend}
          disabled={isSendDisabled}
          placeholder={inputPlaceholder}
          initialDraft={initialDraft}
        />
      ) : null}
    </>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/client && npx vitest run src/components/channel/__tests__/ChannelContent.test.tsx`
Expected: all 12 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/components/channel/ChannelContent.tsx apps/client/src/components/channel/__tests__/ChannelContent.test.tsx
git commit -m "feat(client): create ChannelContent component with tests"
```

---

### Task 2: Refactor ChannelView to use ChannelContent

**Goal:** Replace ChannelView's inline MessageList + MessageInput + banner rendering with `ChannelContent`, keeping all hooks and external API unchanged.

**Files:**

- Modify: `apps/client/src/components/channel/ChannelView.tsx:1-21,337-404`

**Acceptance Criteria:**

- [ ] ChannelView imports and renders `ChannelContent` instead of inline MessageList + MessageInput + banners
- [ ] ChannelView no longer imports `MessageList` or `MessageInput` directly
- [ ] `JoinChannelPrompt` handling moves into ChannelView (not in ChannelContent — it's channel-specific)
- [ ] All existing ChannelView behavior preserved (header, bot overlay, thread panels, read status)
- [ ] Existing tests still pass

**Verify:** `cd apps/client && npx vitest run` → all existing tests pass (no regressions)

**Steps:**

- [ ] **Step 1: Update ChannelView imports**

In `apps/client/src/components/channel/ChannelView.tsx`, replace the MessageList and MessageInput imports:

```tsx
// Remove these two imports:
// import { MessageList } from "./MessageList";
// import { MessageInput } from "./MessageInput";

// Add this import:
import { ChannelContent } from "./ChannelContent";
```

- [ ] **Step 2: Replace the inner rendering block**

In `ChannelView.tsx`, replace lines 337-403 (the `showOverlay ? ...` ternary through the `MessageInput`/`JoinChannelPrompt`/read-only block) with:

```tsx
{
  showOverlay ? (
    <BotStartupOverlay
      phase={phase as "countdown" | "ready"}
      remainingSeconds={remainingSeconds}
      onStartChatting={startChatting}
    />
  ) : messagesLoading && messages.length === 0 ? (
    <div className="flex-1 flex items-center justify-center">
      <p className="text-muted-foreground">Loading messages...</p>
    </div>
  ) : (
    <ChannelContent
      channelId={channelId}
      channelType={channel?.type}
      messages={messages}
      isLoading={isFetchingNextPage}
      onLoadMore={() => {
        if (hasNextPage) fetchNextPage();
      }}
      hasMore={hasNextPage}
      onLoadNewer={() => {
        if (hasPreviousPage) fetchPreviousPage();
      }}
      hasNewer={hasPreviousPage}
      isLoadingNewer={isFetchingPreviousPage}
      highlightMessageId={initialMessageId}
      readOnly={isPreviewMode || readOnly}
      thinkingBotIds={thinkingBotIds}
      members={members}
      lastReadMessageId={unreadAnchor}
      hasMoreUnsynced={hasMoreUnsynced}
      onSend={isPreviewMode || readOnly ? undefined : handleSendMessage}
      isSendDisabled={sendMessage.isPending || showOverlay}
      initialDraft={initialDraft}
    />
  );
}

{
  (isInstanceStopped || isInstanceStarting) && (
    <BotInstanceStoppedBanner
      onStart={startInstance}
      isStarting={isStarting}
      canStart={canStart}
      isInstanceStarting={isInstanceStarting}
    />
  );
}

{
  isPreviewMode && (
    <JoinChannelPrompt channelId={channelId} channelName={channel.name || ""} />
  );
}
```

Note: `JoinChannelPrompt` stays in ChannelView because it's a channel-membership concern, not a generic content concern. When `isPreviewMode` is true, `ChannelContent` receives `readOnly=true` (which shows the read-only bar), and `JoinChannelPrompt` is rendered below it by ChannelView.

- [ ] **Step 3: Run all existing tests to verify no regressions**

Run: `cd apps/client && npx vitest run`
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/components/channel/ChannelView.tsx
git commit -m "refactor(client): use ChannelContent in ChannelView"
```

---

### Task 3: Refactor TrackingModal to use ChannelContent with tests

**Goal:** Replace TrackingModal's custom message rendering (manual WS listeners, custom scroll, TrackingEventItem loop, simple input) with `ChannelContent` + standard hooks, keeping the modal shell and tracking-specific events.

**Files:**

- Modify: `apps/client/src/components/channel/TrackingModal.tsx`
- Create: `apps/client/src/components/channel/__tests__/TrackingModal.test.tsx`

**Acceptance Criteria:**

- [ ] TrackingModal uses `useChannelObserver` for WS subscription
- [ ] TrackingModal uses `useChannelMessages` for message fetching + real-time updates
- [ ] TrackingModal uses `useSyncChannel` for catch-up sync
- [ ] TrackingModal uses `useSendMessage` for sending messages
- [ ] TrackingModal renders `ChannelContent` for message display + input
- [ ] Tracking-specific WS events (`tracking:deactivated`, `tracking:activated`) handled in a small useEffect
- [ ] Deactivated channel → `ChannelContent` receives `readOnly=true`
- [ ] Modal header (bot avatar, name, Running badge, close button) preserved
- [ ] All manual WS listeners for streaming removed (handled by `useChannelMessages`)
- [ ] Custom scroll logic removed (handled by Virtuoso in `MessageList`)
- [ ] Simple `<input>` replaced by `MessageInput` via `ChannelContent`
- [ ] `isOpen=false` → returns null early
- [ ] 100% test coverage on new code

**Verify:** `cd apps/client && npx vitest run src/components/channel/__tests__/TrackingModal.test.tsx` → all pass

**Steps:**

- [ ] **Step 1: Write TrackingModal tests**

```tsx
// apps/client/src/components/channel/__tests__/TrackingModal.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TrackingModal } from "../TrackingModal";
import type { IMUser } from "@/types/im";

// Mock hooks
const mockObserve = vi.fn();
vi.mock("@/hooks/useChannelObserver", () => ({
  useChannelObserver: (id: string | null) => mockObserve(id),
}));

const mockMessages = {
  data: undefined,
  isLoading: false,
  isFetchingNextPage: false,
  fetchNextPage: vi.fn(),
  hasNextPage: false,
  hasPreviousPage: false,
  isFetchingPreviousPage: false,
  fetchPreviousPage: vi.fn(),
};
vi.mock("@/hooks/useMessages", () => ({
  useChannelMessages: () => mockMessages,
  useSendMessage: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/useSyncChannel", () => ({
  useSyncChannel: () => ({ hasMoreUnsynced: false }),
}));

vi.mock("@/hooks/useChannels", () => ({
  useChannel: () => ({ data: undefined }),
  useChannelMembers: () => ({ data: [] }),
}));

// Mock ChannelContent
vi.mock("../ChannelContent", () => ({
  ChannelContent: (props: Record<string, unknown>) => (
    <div
      data-testid="channel-content"
      data-channel-id={props.channelId}
      data-read-only={String(props.readOnly ?? false)}
    />
  ),
}));

// Mock wsService
vi.mock("@/services/websocket", () => ({
  default: {
    on: vi.fn(),
    off: vi.fn(),
    onTrackingDeactivated: vi.fn(),
    offTrackingDeactivated: vi.fn(),
    onTrackingActivated: vi.fn(),
    offTrackingActivated: vi.fn(),
  },
}));

const botUser: IMUser = {
  id: "bot-1",
  email: "",
  username: "test-bot",
  displayName: "Test Bot",
  status: "online",
  isActive: true,
  createdAt: "2026-04-05T00:00:00Z",
  updatedAt: "2026-04-05T00:00:00Z",
  userType: "bot",
};

function renderModal(props: Partial<Parameters<typeof TrackingModal>[0]> = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <TrackingModal
        isOpen={true}
        onClose={vi.fn()}
        trackingChannelId="track-ch-1"
        botUser={botUser}
        isActivated={true}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe("TrackingModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when isOpen=false", () => {
    const { container } = renderModal({ isOpen: false });
    expect(container.innerHTML).toBe("");
  });

  it("renders modal with header when open", () => {
    renderModal();
    expect(screen.getByText("Test Bot")).toBeInTheDocument();
    expect(screen.getByText("Tracking Channel")).toBeInTheDocument();
  });

  it("renders ChannelContent with trackingChannelId", () => {
    renderModal();
    const content = screen.getByTestId("channel-content");
    expect(content).toHaveAttribute("data-channel-id", "track-ch-1");
  });

  it("calls useChannelObserver with trackingChannelId when open", () => {
    renderModal();
    expect(mockObserve).toHaveBeenCalledWith("track-ch-1");
  });

  it("calls useChannelObserver with null when closed", () => {
    renderModal({ isOpen: false });
    expect(mockObserve).toHaveBeenCalledWith(null);
  });

  it("shows Running badge when isActivated=true", () => {
    renderModal({ isActivated: true });
    expect(screen.getByText("Running")).toBeInTheDocument();
  });

  it("does not show Running badge when isActivated=false", () => {
    renderModal({ isActivated: false });
    expect(screen.queryByText("Running")).not.toBeInTheDocument();
  });

  it("passes readOnly=true to ChannelContent when isActivated=false", () => {
    renderModal({ isActivated: false });
    expect(screen.getByTestId("channel-content")).toHaveAttribute(
      "data-read-only",
      "true",
    );
  });

  it("passes readOnly=false to ChannelContent when isActivated=true", () => {
    renderModal({ isActivated: true });
    expect(screen.getByTestId("channel-content")).toHaveAttribute(
      "data-read-only",
      "false",
    );
  });

  it("renders close button that calls onClose", async () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    const closeBtn = screen.getByRole("button");
    await userEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders with undefined trackingChannelId gracefully", () => {
    renderModal({ trackingChannelId: undefined });
    // Should still render modal shell, ChannelContent with undefined channelId
    expect(screen.getByText("Test Bot")).toBeInTheDocument();
  });

  it("falls back to username when displayName is missing", () => {
    renderModal({
      botUser: { ...botUser, displayName: undefined },
    });
    expect(screen.getByText("test-bot")).toBeInTheDocument();
  });

  it("shows bot initial in avatar", () => {
    renderModal();
    expect(screen.getByText("T")).toBeInTheDocument(); // "T" for "Test Bot"
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/client && npx vitest run src/components/channel/__tests__/TrackingModal.test.tsx`
Expected: FAIL — tests reference the new ChannelContent-based TrackingModal API, but TrackingModal still has old implementation

- [ ] **Step 3: Rewrite TrackingModal**

Replace the entire content of `apps/client/src/components/channel/TrackingModal.tsx`:

```tsx
// apps/client/src/components/channel/TrackingModal.tsx
import { useState, useEffect, useCallback } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useChannelMessages, useSendMessage } from "@/hooks/useMessages";
import { useSyncChannel } from "@/hooks/useSyncChannel";
import { useChannel, useChannelMembers } from "@/hooks/useChannels";
import { useChannelObserver } from "@/hooks/useChannelObserver";
import wsService from "@/services/websocket";
import { ChannelContent } from "./ChannelContent";
import type { IMUser, AttachmentDto } from "@/types/im";
import type {
  TrackingDeactivatedEvent,
  TrackingActivatedEvent,
} from "@/types/ws-events";

interface TrackingModalProps {
  isOpen: boolean;
  onClose: () => void;
  trackingChannelId: string | undefined;
  botUser?: IMUser;
  isActivated: boolean;
  /** @deprecated No longer used — streaming handled by useChannelMessages */
  initialActiveStream?: unknown;
}

export function TrackingModal({
  isOpen,
  onClose,
  trackingChannelId,
  botUser,
  isActivated: initialIsActivated,
}: TrackingModalProps) {
  const [isActivated, setIsActivated] = useState(initialIsActivated);

  // Sync with parent prop
  useEffect(() => {
    setIsActivated(initialIsActivated);
  }, [initialIsActivated]);

  // Observe the tracking channel's WS room (subscribe/unsubscribe)
  useChannelObserver(isOpen ? trackingChannelId : null);

  // Fetch messages + real-time WS listeners (new_message, streaming, reactions)
  const {
    data: messagesData,
    isLoading: messagesLoading,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
    hasPreviousPage,
    isFetchingPreviousPage,
    fetchPreviousPage,
  } = useChannelMessages(isOpen ? trackingChannelId : undefined);

  // Catch-up sync
  const { hasMoreUnsynced } = useSyncChannel(
    isOpen ? trackingChannelId : undefined,
  );

  // Channel members (for MessageList member display)
  const { data: members = [] } = useChannelMembers(
    isOpen ? trackingChannelId : undefined,
  );

  // Send messages
  const sendMessage = useSendMessage(trackingChannelId);

  const handleSend = useCallback(
    async (content: string, attachments?: AttachmentDto[]) => {
      if (!content.trim() && (!attachments || attachments.length === 0)) return;
      await sendMessage.mutateAsync({ content, attachments });
    },
    [sendMessage],
  );

  // Tracking-specific WS events
  useEffect(() => {
    if (!isOpen || !trackingChannelId) return;

    const handleDeactivated = (event: TrackingDeactivatedEvent) => {
      if (event.channelId !== trackingChannelId) return;
      setIsActivated(false);
    };

    const handleActivated = (event: TrackingActivatedEvent) => {
      if (event.channelId !== trackingChannelId) return;
      setIsActivated(true);
    };

    wsService.onTrackingDeactivated(handleDeactivated);
    wsService.onTrackingActivated(handleActivated);

    return () => {
      wsService.offTrackingDeactivated(handleDeactivated);
      wsService.offTrackingActivated(handleActivated);
    };
  }, [isOpen, trackingChannelId]);

  if (!isOpen) return null;

  const messages = messagesData?.pages.flatMap((p) => p.messages) ?? [];
  const displayName = botUser?.displayName ?? botUser?.username ?? "Bot";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-2xl max-h-[80vh] bg-background border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-xs text-primary-foreground font-bold">
              {displayName[0]}
            </div>
            <div>
              <div className="text-sm font-semibold">{displayName}</div>
              <div className="text-xs text-muted-foreground">
                Tracking Channel
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isActivated && (
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xs text-emerald-500">Running</span>
              </div>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-7 w-7"
            >
              <X size={16} />
            </Button>
          </div>
        </div>

        {/* Message area — uses shared ChannelContent */}
        <div className="flex-1 flex flex-col min-h-0">
          <ChannelContent
            channelId={trackingChannelId ?? ""}
            channelType="tracking"
            messages={messages}
            isLoading={isFetchingNextPage}
            onLoadMore={() => {
              if (hasNextPage) fetchNextPage();
            }}
            hasMore={hasNextPage}
            onLoadNewer={() => {
              if (hasPreviousPage) fetchPreviousPage();
            }}
            hasNewer={hasPreviousPage}
            isLoadingNewer={isFetchingPreviousPage}
            readOnly={!isActivated}
            members={members}
            hasMoreUnsynced={hasMoreUnsynced}
            onSend={isActivated ? handleSend : undefined}
            isSendDisabled={sendMessage.isPending}
            inputPlaceholder="Send guidance to agent..."
          />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run TrackingModal tests**

Run: `cd apps/client && npx vitest run src/components/channel/__tests__/TrackingModal.test.tsx`
Expected: all 13 tests PASS

- [ ] **Step 5: Run all tests to verify no regressions**

Run: `cd apps/client && npx vitest run`
Expected: all pass. If `TrackingEventItem.test.tsx` or `MessageItem.agent-event.test.tsx` break, investigate — they should be unaffected since `TrackingEventItem` is still used by `MessageItem` in the standard pipeline.

- [ ] **Step 6: Commit**

```bash
git add apps/client/src/components/channel/TrackingModal.tsx apps/client/src/components/channel/__tests__/TrackingModal.test.tsx
git commit -m "refactor(client): use ChannelContent in TrackingModal for unified rendering"
```
