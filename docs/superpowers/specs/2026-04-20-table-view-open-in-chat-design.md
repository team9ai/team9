# Table View: "Open in Chat" Button — Design

**Date:** 2026-04-20
**Status:** Approved

## Goal

Add a Notion-style "OPEN" button inside each table row's Content cell. Hovering the row reveals the button on the right side of the cell. Clicking it switches the channel to its messages (chat) tab and scrolls + highlights the corresponding message, reusing the existing `highlightMessageId` mechanism.

## User Experience

- Trigger: mouse hover over any table row.
- Button sits at the right edge of the leftmost `Content` cell, inline with the text (same visual pattern as Notion's "Open in side peek").
- Icon: `PanelRight` (lucide) + tooltip "Open in chat" (i18n).
- Click → frontend switches the active tab to the channel's `messages` tab, then `MessageList` auto-scrolls to the target message and applies the existing highlight styling.
- No side-peek panel is introduced. Chat view is the "detail" view.

## Architecture

Tab type enum (from [apps/client/src/types/properties.ts](apps/client/src/types/properties.ts)): `"messages" | "files" | "table_view" | "board_view" | "calendar_view"`. The chat tab has `type === "messages"`.

Existing highlight path: router passes `initialMessageId` → `ChannelView` → `ChannelContent` → `MessageList.initialTopMostItemIndex` (scrolls) + `isHighlighted` style.

### Data flow

```
TableRow (hover button click)
  → onJumpToMessage(messageId)            // prop
  → TableView (forwards)
  → ChannelView.handleJumpToMessage
       → find messages tab
       → setActiveTabId(messagesTabId)
       → setJumpHighlight({ id, seq })
  → ChannelContent highlightMessageId = jumpHighlight.id ?? initialMessageId
  → MessageList scrolls & highlights
```

## Component Changes

### 1. [apps/client/src/components/channel/ChannelView.tsx](apps/client/src/components/channel/ChannelView.tsx)

- Add state: `const [jumpHighlight, setJumpHighlight] = useState<{ id: string; seq: number } | undefined>()`.
- Add callback:
  ```ts
  const handleJumpToMessage = useCallback(
    (messageId: string) => {
      const messagesTab = channelTabs.find((t) => t.type === "messages");
      if (!messagesTab) return;
      setActiveTabId(messagesTab.id);
      setJumpHighlight((prev) => ({
        id: messageId,
        seq: (prev?.seq ?? 0) + 1,
      }));
    },
    [channelTabs],
  );
  ```
- Compute effective highlight id: `const effectiveHighlightId = jumpHighlight?.id ?? initialMessageId;`
- Pass `highlightMessageId={effectiveHighlightId}` to `<ChannelContent />`.
- Key the chat branch on `jumpHighlight?.seq` so repeat jumps to the same id re-trigger scroll: `<div key={jumpHighlight?.seq ?? "initial"}>...<ChannelContent .../></div>` — wrapping div keeps the existing tree; alternative is putting `key` on `ChannelContent`. The `seq` guarantees that tapping OPEN twice on the same row re-scrolls.
- Where the table view branch renders `<TableView ... />`, pass `onJumpToMessage={handleJumpToMessage}`.
- When `activeTabId` changes to something other than the messages tab, we keep `jumpHighlight` (harmless, only read in the messages branch).

### 2. [apps/client/src/components/channel/views/TableView.tsx](apps/client/src/components/channel/views/TableView.tsx)

- `TableViewProps`: add `onJumpToMessage?: (messageId: string) => void`.
- Forward to every `<TableRow />`.

### 3. `TableRow` (inside TableView)

- Content cell: wrap text + button in a flex container.
  ```tsx
  <td ...>
    <div className="flex items-center justify-between gap-2">
      <span className="line-clamp-2 flex-1">{contentPreview || "..."}</span>
      {onJumpToMessage && (
        <button
          type="button"
          aria-label={t("channel.table.openInChat")}
          title={t("channel.table.openInChat")}
          className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border border-border rounded px-1.5 py-0.5 bg-background"
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
- Row already has `className="group"`, so hover reveal works.

### 4. i18n

- Add key `channel.table.openInChat` in locale files under `apps/client/src/locales/*` (both zh and en, following existing expansion pattern from 2026-04-10-frontend-i18n-expansion-design.md).
  - en: "Open in chat"
  - zh: "打开消息"

## Edge Cases

- **No messages tab:** Defensive `if (!messagesTab) return;` — silently ignores. Should not happen for normal channels, but Files-only or atypical channel shapes are tolerated.
- **Repeat click same message:** `seq` bump on state + `key` on the content wrapper remounts the chat branch so Virtuoso re-initializes and re-scrolls. Acceptable UX cost: any in-flight typing draft state inside `ChannelContent` is preserved by it being above the keyed node — keep the `key` on an inner wrapper around Virtuoso, NOT the composer. During implementation, place the key on the element wrapping `<MessageList />`, not on the outer flex container that includes the composer.
- **Message not yet loaded (outside cached window):** Existing `MessageList` behavior applies — if id isn't in current `chronoMessages`, `initialTopMostItemIndex` falls back to unread or bottom. This is a pre-existing limitation; not expanding scope here.
- **Route-level `initialMessageId` present simultaneously:** `jumpHighlight` takes precedence by virtue of `?? initialMessageId`.

## Testing

Follow existing test conventions (Vitest, React Testing Library — discover patterns during implementation).

- `TableView.test.tsx` (or row-level test): hover row → OPEN button rendered; click → `onJumpToMessage` called with `message.id`; clicking does not trigger cell edit.
- `ChannelView.test.tsx`: given a `messages` tab and a `table_view` tab, invoking the jump callback sets `activeTabId` to the messages tab id and passes the target id down as `highlightMessageId`; calling twice with same id bumps `seq` and causes the chat wrapper to remount (assert via a spy on a child's mount or a key-driven render counter).
- Regression: rendering with route-level `initialMessageId` still forwards it when no jump has occurred.

## Non-Goals

- Side peek panel.
- Deep-link URL updates (no route change on jump).
- Jump targeting threads.
- Any server-side change.

## Open Follow-ups (not this spec)

- When jump target is outside current message window, fetch around the id. Separate design.
- Auto-fade highlight after N seconds once user scrolls.
