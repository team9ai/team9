# Table View "Open in Chat" Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Notion-style "OPEN" button on each TableView row that jumps the channel to its messages tab and highlights the target message.

**Architecture:** Introduce a small `useMessageJump` hook that owns the jump state (messages tab id + highlighted message id + a monotonically increasing `seq` counter). `ChannelView` wires the hook: it passes `jumpToMessage` down to `TableView` and uses the returned highlight id + `seq` to drive `ChannelContent`'s `highlightMessageId` prop and to key the chat wrapper so repeat clicks on the same message re-trigger scroll/highlight.

**Tech Stack:** React 19, TypeScript, Vitest + @testing-library/react. No backend changes.

**Reference spec:** [docs/superpowers/specs/2026-04-20-table-view-open-in-chat-design.md](../specs/2026-04-20-table-view-open-in-chat-design.md)

---

### Task 1: `useMessageJump` hook with unit tests

**Goal:** Isolated hook that exposes `jumpToMessage(id)` and current `{ highlightId, seq }`, switching `activeTabId` to the channel's messages tab when called.

**Files:**

- Create: `apps/client/src/hooks/useMessageJump.ts`
- Create: `apps/client/src/hooks/__tests__/useMessageJump.test.tsx`

**Acceptance Criteria:**

- [ ] Hook exports `useMessageJump(channelTabs, setActiveTabId)`.
- [ ] Returns `{ jumpToMessage: (id: string) => void; highlightId: string | undefined; seq: number }`.
- [ ] Calling `jumpToMessage("msg-1")` invokes `setActiveTabId` with the tab whose `type === "messages"` and sets `highlightId === "msg-1"`, `seq === 1`.
- [ ] Calling `jumpToMessage("msg-1")` a second time keeps id and bumps `seq` to `2`.
- [ ] Calling `jumpToMessage("msg-2")` sets `highlightId === "msg-2"` and bumps `seq`.
- [ ] When no tab has `type === "messages"`, `jumpToMessage` is a no-op (no state change, no `setActiveTabId` call).
- [ ] Hook reference for `jumpToMessage` is stable across renders (`useCallback`).

**Verify:** `cd apps/client && pnpm test src/hooks/__tests__/useMessageJump.test.tsx -- --run` → all tests pass.

**Steps:**

- [ ] **Step 1: Write the failing tests**

Create `apps/client/src/hooks/__tests__/useMessageJump.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useMessageJump } from "../useMessageJump";
import type { ChannelTab } from "@/types/properties";

function makeTab(overrides: Partial<ChannelTab>): ChannelTab {
  return {
    id: "tab-1",
    channelId: "ch-1",
    name: "Messages",
    type: "messages",
    viewId: null,
    isBuiltin: true,
    order: 0,
    createdBy: null,
    createdAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

describe("useMessageJump", () => {
  it("switches to messages tab and sets highlight on jump", () => {
    const setActiveTabId = vi.fn();
    const tabs: ChannelTab[] = [
      makeTab({ id: "messages-tab", type: "messages" }),
      makeTab({ id: "table-tab", type: "table_view" }),
    ];

    const { result } = renderHook(() => useMessageJump(tabs, setActiveTabId));

    expect(result.current.highlightId).toBeUndefined();
    expect(result.current.seq).toBe(0);

    act(() => {
      result.current.jumpToMessage("msg-1");
    });

    expect(setActiveTabId).toHaveBeenCalledWith("messages-tab");
    expect(result.current.highlightId).toBe("msg-1");
    expect(result.current.seq).toBe(1);
  });

  it("bumps seq on repeat click of same message", () => {
    const setActiveTabId = vi.fn();
    const tabs = [makeTab({ id: "messages-tab", type: "messages" })];

    const { result } = renderHook(() => useMessageJump(tabs, setActiveTabId));

    act(() => result.current.jumpToMessage("msg-1"));
    act(() => result.current.jumpToMessage("msg-1"));

    expect(result.current.highlightId).toBe("msg-1");
    expect(result.current.seq).toBe(2);
  });

  it("updates highlightId when jumping to a different message", () => {
    const setActiveTabId = vi.fn();
    const tabs = [makeTab({ id: "messages-tab", type: "messages" })];

    const { result } = renderHook(() => useMessageJump(tabs, setActiveTabId));

    act(() => result.current.jumpToMessage("msg-1"));
    act(() => result.current.jumpToMessage("msg-2"));

    expect(result.current.highlightId).toBe("msg-2");
    expect(result.current.seq).toBe(2);
  });

  it("is a no-op when no messages tab exists", () => {
    const setActiveTabId = vi.fn();
    const tabs = [makeTab({ id: "table-tab", type: "table_view" })];

    const { result } = renderHook(() => useMessageJump(tabs, setActiveTabId));

    act(() => result.current.jumpToMessage("msg-1"));

    expect(setActiveTabId).not.toHaveBeenCalled();
    expect(result.current.highlightId).toBeUndefined();
    expect(result.current.seq).toBe(0);
  });

  it("returns a stable jumpToMessage reference across renders", () => {
    const setActiveTabId = vi.fn();
    const tabs = [makeTab({ id: "messages-tab", type: "messages" })];

    const { result, rerender } = renderHook(
      ({ tabList }) => useMessageJump(tabList, setActiveTabId),
      { initialProps: { tabList: tabs } },
    );

    const first = result.current.jumpToMessage;
    rerender({ tabList: tabs });
    expect(result.current.jumpToMessage).toBe(first);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `cd apps/client && pnpm test src/hooks/__tests__/useMessageJump.test.tsx -- --run`
Expected: FAIL (cannot resolve `../useMessageJump`).

- [ ] **Step 3: Implement the hook**

Create `apps/client/src/hooks/useMessageJump.ts`:

```ts
import { useCallback, useState } from "react";
import type { ChannelTab } from "@/types/properties";

interface JumpState {
  id: string;
  seq: number;
}

export interface UseMessageJumpResult {
  jumpToMessage: (messageId: string) => void;
  highlightId: string | undefined;
  seq: number;
}

export function useMessageJump(
  channelTabs: ChannelTab[],
  setActiveTabId: (tabId: string) => void,
): UseMessageJumpResult {
  const [state, setState] = useState<JumpState | undefined>(undefined);

  const jumpToMessage = useCallback(
    (messageId: string) => {
      const messagesTab = channelTabs.find((t) => t.type === "messages");
      if (!messagesTab) return;
      setActiveTabId(messagesTab.id);
      setState((prev) => ({ id: messageId, seq: (prev?.seq ?? 0) + 1 }));
    },
    [channelTabs, setActiveTabId],
  );

  return {
    jumpToMessage,
    highlightId: state?.id,
    seq: state?.seq ?? 0,
  };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `cd apps/client && pnpm test src/hooks/__tests__/useMessageJump.test.tsx -- --run`
Expected: PASS (5 tests).

Note on stability: `jumpToMessage` reference stability depends on `channelTabs` reference stability from the caller. The test passes the same `tabs` array across rerenders so the callback stays stable.

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/hooks/useMessageJump.ts apps/client/src/hooks/__tests__/useMessageJump.test.tsx
git commit -m "feat(client): add useMessageJump hook for cross-tab message highlight"
```

---

### Task 2: TableView row OPEN button + prop forwarding

**Goal:** `TableView` accepts `onJumpToMessage` and renders a hover-revealed OPEN button in each row's Content cell that calls it with the message id. Tests in `Views.test.tsx` cover the new behavior.

**Files:**

- Modify: `apps/client/src/components/channel/views/TableView.tsx`
- Modify: `apps/client/src/components/channel/views/__tests__/Views.test.tsx`

**Acceptance Criteria:**

- [ ] `TableViewProps` has optional `onJumpToMessage?: (messageId: string) => void`.
- [ ] Prop is forwarded to each `TableRow`.
- [ ] Content cell renders a button with `aria-label="Open in chat"` when `onJumpToMessage` is provided.
- [ ] Clicking the button calls `onJumpToMessage` with the row's `message.id`.
- [ ] Button click does not put the row into cell-edit mode (uses `e.stopPropagation()`).
- [ ] When `onJumpToMessage` is not provided, no OPEN button is rendered.
- [ ] Button uses `opacity-0 group-hover:opacity-100` so it only appears on row hover (row `<tr>` already has `group`).

**Verify:** `cd apps/client && pnpm test src/components/channel/views/__tests__/Views.test.tsx -- --run` → all tests (existing + new) pass.

**Steps:**

- [ ] **Step 1: Write new failing tests**

Append to `apps/client/src/components/channel/views/__tests__/Views.test.tsx` inside the `describe("TableView", ...)` block, after existing tests:

```tsx
it("renders OPEN button when onJumpToMessage is provided and calls it on click", async () => {
  const { default: userEvent } = await import("@testing-library/user-event");
  const onJumpToMessage = vi.fn();
  mockViewMessagesFlat = [
    makeViewMessage({ id: "msg-abc", content: "<p>Hello</p>" }),
  ];

  render(
    <TableView
      channelId="ch-1"
      view={makeView()}
      onJumpToMessage={onJumpToMessage}
    />,
    { wrapper: Wrapper },
  );

  const btn = screen.getByRole("button", { name: "Open in chat" });
  expect(btn).toBeInTheDocument();

  await userEvent.click(btn);
  expect(onJumpToMessage).toHaveBeenCalledWith("msg-abc");
});

it("does not render OPEN button when onJumpToMessage is not provided", () => {
  mockViewMessagesFlat = [
    makeViewMessage({ id: "msg-abc", content: "<p>Hello</p>" }),
  ];

  render(<TableView channelId="ch-1" view={makeView()} />, {
    wrapper: Wrapper,
  });

  expect(
    screen.queryByRole("button", { name: "Open in chat" }),
  ).not.toBeInTheDocument();
});
```

If `@testing-library/user-event` isn't already a dependency, fall back to `fireEvent.click(btn)` from `@testing-library/react` (confirm availability in Step 2 by running the test — adjust if import fails).

- [ ] **Step 2: Run tests to confirm failures**

Run: `cd apps/client && pnpm test src/components/channel/views/__tests__/Views.test.tsx -- --run`
Expected: the two new tests FAIL (no button with name "Open in chat"); existing tests still PASS.

- [ ] **Step 3: Modify TableView — add prop, icon import, row button**

In `apps/client/src/components/channel/views/TableView.tsx`:

a) Update the lucide import to include `PanelRight`:

```ts
import {
  Loader2,
  Plus,
  ArrowUp,
  ArrowDown,
  GripVertical,
  PanelRight,
} from "lucide-react";
```

b) Extend `TableViewProps`:

```ts
export interface TableViewProps {
  channelId: string;
  view: ChannelView;
  onJumpToMessage?: (messageId: string) => void;
}
```

c) Destructure in `TableView`:

```ts
export function TableView({ channelId, view, onJumpToMessage }: TableViewProps) {
```

d) Extend `TableRow` signature and pass the prop from the mapping:

```tsx
function TableRow({
  message,
  visibleDefs,
  channelId,
  currentUserId,
  columnWidths,
  onJumpToMessage,
}: {
  message: ViewMessageItem;
  visibleDefs: PropertyDefinition[];
  channelId: string;
  currentUserId: string | undefined;
  columnWidths: Record<string, number>;
  onJumpToMessage?: (messageId: string) => void;
}) {
```

And in the `<tbody>` mapping inside `TableView`:

```tsx
{
  messages.map((msg) => (
    <TableRow
      key={msg.id}
      message={msg}
      visibleDefs={visibleDefs}
      channelId={channelId}
      currentUserId={currentUser?.id}
      columnWidths={effectiveWidths}
      onJumpToMessage={onJumpToMessage}
    />
  ));
}
```

e) Replace the Content cell body inside `TableRow` (currently `<span className="line-clamp-2">{contentPreview || "..."}</span>`) with a flex container + hover button:

```tsx
<td
  className="px-3 py-2 text-sm"
  style={{
    width: columnWidths["__content"] ?? undefined,
    maxWidth: columnWidths["__content"] ?? 320,
  }}
>
  <div className="flex items-center justify-between gap-2">
    <span className="line-clamp-2 flex-1">{contentPreview || "..."}</span>
    {onJumpToMessage && (
      <button
        type="button"
        aria-label="Open in chat"
        title="Open in chat"
        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border border-border rounded px-1.5 py-0.5 bg-background"
        onClick={(e) => {
          e.stopPropagation();
          onJumpToMessage(message.id);
        }}
      >
        <PanelRight className="h-3 w-3" />
        <span>OPEN</span>
      </button>
    )}
  </div>
</td>
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `cd apps/client && pnpm test src/components/channel/views/__tests__/Views.test.tsx -- --run`
Expected: all TableView tests PASS (existing 3 + new 2 = 5), plus BoardView/CalendarView tests unaffected.

- [ ] **Step 5: Lint & type-check**

Run: `cd apps/client && pnpm lint:ci` (or `pnpm exec tsc --noEmit` if available).
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/client/src/components/channel/views/TableView.tsx \
        apps/client/src/components/channel/views/__tests__/Views.test.tsx
git commit -m "feat(client): add OPEN button to TableView rows for jumping to chat"
```

---

### Task 3: Wire ChannelView — pass jump callback down and drive highlight

**Goal:** `ChannelView` uses `useMessageJump` and wires it so clicking OPEN on a table row switches the active tab to the messages tab and causes `MessageList` to scroll to + highlight the target message; repeat clicks on the same message re-trigger scroll via a `seq`-keyed wrapper.

**Files:**

- Modify: `apps/client/src/components/channel/ChannelView.tsx`

**Acceptance Criteria:**

- [ ] `ChannelView` imports and calls `useMessageJump(channelTabs, setActiveTabId)`.
- [ ] `<TableView ... />` (rendered inside the view-tab branch) receives `onJumpToMessage={jumpToMessage}`.
- [ ] `highlightMessageId` passed to `<ChannelContent />` is `jumpHighlightId ?? initialMessageId`.
- [ ] The element wrapping `<ChannelContent />` is keyed on `jumpSeq` so that repeat jumps to the same id remount the chat branch and re-run scroll. The composer and surrounding UI are NOT inside the keyed wrapper if avoidable; if the existing structure makes that hard, keying `<ChannelContent />` itself is acceptable.
- [ ] No visible regression when no jump has occurred: `initialMessageId` flow still works; tabs still switch normally on user click.

**Verify:** Manual — `cd apps/client && pnpm dev:client`, open a channel that has a table view tab with messages, hover a row, click OPEN. Expected: chat tab becomes active; target message scrolls into view and shows highlight styling. Click OPEN on the same row again from the table tab: chat tab re-scrolls/highlights.

Automated regression: `cd apps/client && pnpm test -- --run` → all existing tests pass.

**Steps:**

- [ ] **Step 1: Read current ChannelView structure**

Open `apps/client/src/components/channel/ChannelView.tsx`. Locate:

- The `const [activeTabId, setActiveTabId] = useState<string>("");` declaration (around line 327).
- The `channelTabs` array it operates on (derived from the tabs query).
- The block that renders `<TableView ... />` (inside the view-tab branch around line 536–562 range). Check the exact `activeTab?.type === "table_view"` path and how `view` is resolved.
- The `<ChannelContent ...>` call (around line 579) with `highlightMessageId={initialMessageId}`.

- [ ] **Step 2: Add the hook call**

Immediately after the existing `setActiveTabId` state and its related derivations (before `activeTab` is used), add:

```ts
import { useMessageJump } from "@/hooks/useMessageJump";
```

(at top with other hook imports)

```ts
const {
  jumpToMessage,
  highlightId: jumpHighlightId,
  seq: jumpSeq,
} = useMessageJump(channelTabs, setActiveTabId);
```

Place this AFTER `channelTabs` is available and AFTER `setActiveTabId` exists. Do not change the existing `activeTab` derivation.

- [ ] **Step 3: Pass `onJumpToMessage` to TableView**

Find the JSX branch where `<TableView />` is rendered (inside the view-tab path). Update the element to include the prop:

```tsx
<TableView channelId={channelId} view={view} onJumpToMessage={jumpToMessage} />
```

Preserve any other props that already exist on that element.

- [ ] **Step 4: Swap highlight source and add seq key**

Change the `<ChannelContent ... highlightMessageId={initialMessageId} ... />` line to:

```tsx
highlightMessageId={jumpHighlightId ?? initialMessageId}
```

Then wrap `<ChannelContent />` so the element is keyed on `jumpSeq` to remount on repeat jumps. Minimal change — wrap in a fragment is not keyable; use a `<div>` with `className="contents"` so it has no layout effect:

```tsx
<div key={jumpSeq} className="contents">
  <ChannelContent
    channelId={channelId}
    /* …existing props unchanged, including the updated highlightMessageId… */
  />
</div>
```

`display: contents` makes the div transparent to flex layout, preserving the existing layout of the chat branch.

- [ ] **Step 5: Type check & lint**

Run: `cd apps/client && pnpm lint:ci`
Expected: clean.

- [ ] **Step 6: Run the existing test suite (regression gate)**

Run: `cd apps/client && pnpm test -- --run`
Expected: all existing tests pass — especially `ChannelContent.test.tsx` and `Views.test.tsx`.

- [ ] **Step 7: Manual smoke test**

```bash
cd /Users/winrey/Projects/weightwave/team9
pnpm dev:client
```

In the app:

1. Open a channel with a table view tab.
2. Hover a row in the table → OPEN button appears.
3. Click OPEN → chat tab becomes active, target message scrolls into view, highlight styling visible.
4. Switch back to the table tab, click OPEN on the same row → chat re-scrolls/highlights.
5. Click OPEN on a different row → chat re-scrolls to the new target.
6. Reload the app with an existing `?messageId=...` deep link → still highlights as before.

Record findings (pass/fail for each numbered step) in the commit message body.

- [ ] **Step 8: Commit**

```bash
git add apps/client/src/components/channel/ChannelView.tsx
git commit -m "feat(client): wire TableView OPEN button to chat tab with message highlight"
```

---

## Post-Plan Checks

- [ ] All three task verify commands green.
- [ ] Manual smoke test in Task 3 Step 7 passes all 6 scenarios.
- [ ] Repo is clean: `git status` shows no leftover changes outside the committed files.

## Follow-ups (out of scope, noted in spec)

- Fetch-around-id when the jump target is outside the cached message window.
- Auto-fade highlight after user scrolls.
- Side-peek panel as an alternative detail surface.
