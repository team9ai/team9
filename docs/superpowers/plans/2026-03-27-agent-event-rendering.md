# Agent Event Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render bot messages with `agentEventType` metadata using structured `TrackingEventItem` in DM/task channels instead of plain text.

**Architecture:** Add an agent event detection branch in `MessageItem` that renders `TrackingEventItem` with collapsible support for thinking/tool_result. Pass `prevMessage` from `MessageList` for tight grouping of consecutive agent events. No backend changes.

**Tech Stack:** React, TypeScript, Tailwind CSS, Vitest, @testing-library/react

---

### File Structure

| File                                                                      | Action | Responsibility                                                                                   |
| ------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------ |
| `apps/client/src/components/channel/TrackingEventItem.tsx`                | Modify | Add `collapsible` prop, expand/collapse state, chevron, thinking purple label, alignment classes |
| `apps/client/src/components/channel/MessageItem.tsx`                      | Modify | Add `getAgentMeta()` helper, `prevMessage` prop, agent event rendering branch                    |
| `apps/client/src/components/channel/MessageList.tsx`                      | Modify | Pass `prevMessage` to `ChannelMessageItem` and read-only `MessageItem`                           |
| `apps/client/src/components/channel/__tests__/TrackingEventItem.test.tsx` | Modify | Add tests for collapsible behavior                                                               |

---

### Task 1: Add collapsible support to TrackingEventItem

**Files:**

- Modify: `apps/client/src/components/channel/TrackingEventItem.tsx`
- Modify: `apps/client/src/components/channel/__tests__/TrackingEventItem.test.tsx`

- [ ] **Step 1: Write failing tests for collapsible behavior**

Add to `apps/client/src/components/channel/__tests__/TrackingEventItem.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TrackingEventItem } from "../TrackingEventItem";
import type { AgentEventMetadata } from "@/types/im";

// ... existing tests remain ...

describe("TrackingEventItem - collapsible", () => {
  it("should show truncated content with ... when collapsible", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "tool_result",
      status: "completed",
    };
    render(
      <TrackingEventItem
        metadata={meta}
        content='{"results": [1,2,3], "count": 42}'
        collapsible
      />,
    );

    expect(screen.getByText(/\.\.\./)).toBeInTheDocument();
  });

  it("should not show expanded content by default", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "tool_result",
      status: "completed",
    };
    render(
      <TrackingEventItem
        metadata={meta}
        content='{"full": "content"}'
        collapsible
      />,
    );

    // The full content should not be visible in an expanded block
    const expandedBlocks = document.querySelectorAll(
      "[data-testid='expanded-content']",
    );
    expect(expandedBlocks).toHaveLength(0);
  });

  it("should expand content on click", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "tool_result",
      status: "completed",
    };
    render(
      <TrackingEventItem
        metadata={meta}
        content='{"full": "content"}'
        collapsible
      />,
    );

    fireEvent.click(screen.getByText("Result"));
    expect(screen.getByTestId("expanded-content")).toBeInTheDocument();
  });

  it("should use purple label for thinking type", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "completed",
    };
    const { container } = render(
      <TrackingEventItem metadata={meta} content="thinking..." />,
    );

    const label = container.querySelector(".text-purple-400");
    expect(label).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/client && npx vitest run src/components/channel/__tests__/TrackingEventItem.test.tsx`

Expected: 4 new tests fail (collapsible prop doesn't exist, no purple class, no expanded-content testid)

- [ ] **Step 3: Implement collapsible TrackingEventItem**

Replace `apps/client/src/components/channel/TrackingEventItem.tsx` with:

```tsx
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentEventMetadata } from "@/types/im";

interface TrackingEventItemProps {
  metadata: AgentEventMetadata;
  content: string;
  /** Whether this item is actively streaming */
  isStreaming?: boolean;
  /** Whether to show in compact mode (inline card) vs full mode (modal) */
  compact?: boolean;
  /** Whether content is collapsible (for thinking/tool_result) */
  collapsible?: boolean;
}

const STATUS_DOT_CLASSES: Record<AgentEventMetadata["status"], string> = {
  running: "bg-emerald-500 animate-pulse",
  completed: "bg-emerald-500",
  failed: "bg-red-500",
};

const LABEL_CLASSES: Record<AgentEventMetadata["status"], string> = {
  running: "text-yellow-400",
  completed: "text-emerald-500",
  failed: "text-red-500",
};

const EVENT_LABELS: Record<AgentEventMetadata["agentEventType"], string> = {
  thinking: "Thinking",
  writing: "Writing",
  tool_call: "Calling",
  tool_result: "Result",
  agent_start: "Started",
  agent_end: "Completed",
  error: "Error",
  turn_separator: "Turn",
};

function truncateLine(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen);
}

export function TrackingEventItem({
  metadata,
  content,
  isStreaming = false,
  compact = true,
  collapsible = false,
}: TrackingEventItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const status = isStreaming ? "running" : metadata.status;
  const label =
    EVENT_LABELS[metadata.agentEventType] ?? metadata.agentEventType;

  const isThinking = metadata.agentEventType === "thinking";
  const labelColorClass =
    isThinking && status !== "failed"
      ? "text-purple-400"
      : LABEL_CLASSES[status];

  const displayContent =
    metadata.agentEventType === "tool_call" && metadata.toolName
      ? metadata.toolName
      : content;

  const summaryContent = collapsible
    ? truncateLine(displayContent, 60) + " ..."
    : displayContent;

  return (
    <div>
      {/* Main row */}
      <div
        className={cn(
          "flex items-center min-h-6",
          collapsible && "cursor-pointer group",
        )}
        onClick={collapsible ? () => setIsExpanded(!isExpanded) : undefined}
      >
        {/* Status dot */}
        <div
          className={cn(
            "w-2 h-2 rounded-full shrink-0 mr-[26px]",
            STATUS_DOT_CLASSES[status],
          )}
        />
        {/* Label */}
        <span
          className={cn(
            "text-xs font-semibold shrink-0 w-[72px]",
            labelColorClass,
          )}
        >
          {label}
        </span>
        {/* Content */}
        <span
          className={cn(
            "text-xs truncate flex-1 min-w-0 ml-2",
            metadata.agentEventType === "tool_call" ||
              metadata.agentEventType === "tool_result"
              ? "font-mono text-foreground/80"
              : isThinking
                ? "text-muted-foreground italic"
                : "text-muted-foreground",
          )}
        >
          {summaryContent}
          {isStreaming && (
            <span className="inline-block w-0.5 h-3.5 bg-yellow-400 animate-pulse ml-0.5 align-text-bottom" />
          )}
        </span>
        {/* Chevron for collapsible items */}
        {collapsible && (
          <ChevronRight
            size={12}
            className={cn(
              "shrink-0 ml-2 text-muted-foreground transition-transform duration-200",
              "group-hover:text-foreground",
              isExpanded && "rotate-90",
            )}
          />
        )}
      </div>
      {/* Expanded content */}
      {collapsible && isExpanded && (
        <div
          data-testid="expanded-content"
          className={cn(
            "mt-1 mb-1.5 p-2 rounded-md text-xs leading-relaxed max-h-44 overflow-y-auto whitespace-pre-wrap break-all",
            isThinking
              ? "bg-purple-500/5 border border-purple-500/20 text-muted-foreground italic"
              : "bg-black/30 border border-border font-mono text-muted-foreground",
          )}
        >
          {displayContent}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/client && npx vitest run src/components/channel/__tests__/TrackingEventItem.test.tsx`

Expected: All tests pass (existing 8 + new 4 = 12 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/components/channel/TrackingEventItem.tsx apps/client/src/components/channel/__tests__/TrackingEventItem.test.tsx
git commit -m "feat: add collapsible support and purple thinking label to TrackingEventItem"
```

---

### Task 2: Add agent event rendering branch in MessageItem

**Files:**

- Modify: `apps/client/src/components/channel/MessageItem.tsx`

- [ ] **Step 1: Add imports and getAgentMeta helper**

At the top of `apps/client/src/components/channel/MessageItem.tsx`, add the import for `TrackingEventItem` and `AgentEventMetadata`, and add the helper function:

```tsx
// Add to imports (line 12, after TrackingCard import):
import { TrackingEventItem } from "./TrackingEventItem";

// Change the type import (line 15):
import type { Message, AgentEventMetadata } from "@/types/im";

// Add helper function before MessageItemProps interface (after line 15):
/** Check if a message has agent event metadata */
function getAgentMeta(message: Message): AgentEventMetadata | undefined {
  const meta = message.metadata as Record<string, unknown> | undefined;
  if (meta && typeof meta.agentEventType === "string") {
    return meta as unknown as AgentEventMetadata;
  }
  return undefined;
}
```

- [ ] **Step 2: Add prevMessage prop to interface and destructuring**

Add `prevMessage` to the `MessageItemProps` interface:

```tsx
// Add after line 19 (currentUserId):
  /** Previous message in the list — used for agent event grouping */
  prevMessage?: Message;
```

Add to destructuring (after `currentUserId`):

```tsx
  prevMessage,
```

- [ ] **Step 3: Add agent event rendering branch**

Insert after the tracking message block (after line 82 `}`), before the system message check:

```tsx
// Agent event message display (no avatar, compact, grouped)
const agentMeta = getAgentMeta(message);
if (agentMeta) {
  const prevIsAgentEvent = prevMessage ? !!getAgentMeta(prevMessage) : false;
  const isFirstInGroup = !prevIsAgentEvent;

  return (
    <div
      id={`message-${message.id}`}
      className={cn(
        "ml-4 border-l-2 border-emerald-500/15 bg-emerald-500/[0.03] rounded-r-md pr-4",
        isFirstInGroup ? "mt-1 pt-1.5" : "",
        "pb-0.5",
      )}
      style={{ paddingLeft: "13px" }}
    >
      <TrackingEventItem
        metadata={agentMeta}
        content={message.content ?? ""}
        collapsible={
          agentMeta.agentEventType === "tool_result" ||
          agentMeta.agentEventType === "thinking"
        }
      />
    </div>
  );
}
```

- [ ] **Step 4: Build to verify no TypeScript errors**

Run: `pnpm build:client 2>&1 | tail -5`

Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/components/channel/MessageItem.tsx
git commit -m "feat: render agent event messages with TrackingEventItem in DM/task channels"
```

---

### Task 3: Wire prevMessage from MessageList

**Files:**

- Modify: `apps/client/src/components/channel/MessageList.tsx`

- [ ] **Step 1: Add prevMessage prop to ChannelMessageItem**

In `apps/client/src/components/channel/MessageList.tsx`, add `prevMessage` to the `ChannelMessageItem` function parameter type (around line 447-462):

```tsx
function ChannelMessageItem({
  message,
  prevMessage,  // ADD THIS
  currentUserId,
  showReplyCount,
  onReplyCountClick,
  isHighlighted,
  channelId,
  isDirect,
}: {
  message: Message;
  prevMessage?: Message;  // ADD THIS
  currentUserId?: string;
  showReplyCount?: boolean;
  onReplyCountClick?: () => void;
  isHighlighted?: boolean;
  channelId: string;
  isDirect: boolean;
}) {
```

Then pass it through to `MessageItem` (around line 514):

```tsx
return (
  <MessageItem
    message={message}
    prevMessage={prevMessage} // ADD THIS
    currentUserId={currentUserId}
    // ... rest of props unchanged
  />
);
```

- [ ] **Step 2: Compute and pass prevMessage in the itemContent callback**

In the `itemContent` callback (around line 301), compute the previous message from `listData` and pass it:

```tsx
  const itemContent = useCallback(
    (index: number, item: ChannelListItem) => {
      if (item.type === "stream") {
        return (
          <div className="py-2">
            <StreamingMessageItem stream={item.stream} members={members} />
          </div>
        );
      }

      if (item.type === "thinking") {
        return (
          <BotThinkingIndicator
            thinkingBotIds={thinkingBotIds}
            members={members}
          />
        );
      }

      const message = item.message;
      const hasReplies =
        !message.parentId && message.replyCount && message.replyCount > 0;
      const isHighlighted = highlightMessageId === message.id;
      const chronoIndex = index - firstItemIndex;
      const showUnreadDivider =
        firstUnreadIndex >= 0 && chronoIndex === firstUnreadIndex;

      // Get previous message for agent event grouping
      const prevItem = listData[index - firstItemIndex - 1];
      const prevMessage = prevItem?.type === "message" ? prevItem.message : undefined;

      if (readOnly) {
        return (
          <div className="py-0.5">
            {showUnreadDivider && <UnreadDivider />}
            <MessageItem
              key={message.id}
              message={message}
              prevMessage={prevMessage}
              isRootMessage={true}
              isHighlighted={isHighlighted}
            />
          </div>
        );
      }

      return (
        <div className="py-0.5">
          {showUnreadDivider && <UnreadDivider />}
          <ChannelMessageItem
            key={message.id}
            message={message}
            prevMessage={prevMessage}
            currentUserId={currentUser?.id}
            showReplyCount={Boolean(hasReplies)}
            onReplyCountClick={() => openThread(message.id)}
            isHighlighted={isHighlighted}
            channelId={channelId}
            isDirect={channelType === "direct"}
          />
        </div>
      );
    },
```

Make sure `listData` and `firstItemIndex` are in the dependency array of the `useCallback`. `listData` should already be there; `firstItemIndex` is `START_INDEX` (a constant), so it doesn't need to be a dep.

- [ ] **Step 3: Build to verify no TypeScript errors**

Run: `pnpm build:client 2>&1 | tail -5`

Expected: Build succeeds

- [ ] **Step 4: Run all frontend tests**

Run: `cd apps/client && npx vitest run`

Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/components/channel/MessageList.tsx
git commit -m "feat: pass prevMessage for agent event grouping in message list"
```

---

### Task 4: Final verification

- [ ] **Step 1: Full build**

Run: `pnpm build:client 2>&1 | tail -5`

Expected: Build succeeds

- [ ] **Step 2: Run all tests**

Run: `cd apps/client && npx vitest run`

Expected: All tests pass

- [ ] **Step 3: Visual verification**

Start dev server: `pnpm dev:client`

Open a DM channel with a bot. Send a message that triggers agent execution. Verify:

- Agent events render with status dots, labels, content (no avatar/name/time)
- Consecutive agent events are tightly grouped with green left border
- Thinking events show purple label, collapsible with purple-tinted expansion
- Tool results show green label, collapsible with mono-font expansion
- Normal messages (user text, bot final response) still render with avatar/name/time
- Clicking collapsed items expands them, clicking again collapses
