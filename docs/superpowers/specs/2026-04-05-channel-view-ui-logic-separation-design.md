# ChannelView UI/Logic Separation & TrackingModal Unification

**Date:** 2026-04-05
**Status:** Draft
**Goal:** Extract a reusable UI layer from ChannelView so that TrackingModal (and future channel-like views) can share the same message rendering pipeline without duplicating logic.

## Problem

TrackingModal has its own independent message rendering stack:

- Custom `<div>` + `map` loop with `TrackingEventItem` (not `MessageList` + `MessageItem`)
- Manual WS event listeners for streaming (duplicates `useChannelMessages`'s streaming handling)
- Custom scroll management (no Virtuoso)
- Simple `<input>` instead of `MessageInput`

This means tracking channel messages miss features like: Virtuoso virtual scrolling, agent event grouping (`ToolCallBlock`), reactions, context menus, thread indicators, rich text input, file attachments, and any future enhancements to the standard message pipeline.

TaskChatArea already solved this by embedding `ChannelView` directly, but ChannelView is a monolith that bundles channel-specific logic (bot startup detection, thread panels, read status tracking, DM detection) that TrackingModal doesn't need — and lacks tracking-specific logic (channel observation, deactivation events) that it does need.

## Design

### New Component: `ChannelContent`

Extract the inner rendering portion of ChannelView into a standalone component that accepts all data as props.

```typescript
interface ChannelContentProps {
  // Message list
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

  // Input
  onSend?: (content: string, attachments?: AttachmentDto[]) => Promise<void>;
  isSendDisabled?: boolean;
  inputPlaceholder?: string;

  // Optional UI customization
  hasMoreUnsynced?: boolean;
  showReadOnlyBar?: boolean;
}
```

`ChannelContent` renders:

- Unsynced messages banner (if `hasMoreUnsynced`)
- `MessageList` (Virtuoso, with all agent event rendering, streaming, tool call blocks)
- `MessageInput` (if `onSend` is provided and not `readOnly`)
- Read-only bar (if `readOnly` or `showReadOnlyBar`)

`ChannelContent` does NOT handle:

- Channel/member data fetching
- WS subscription or observation
- Message fetching or syncing
- Thread panels
- Bot startup detection
- Read status tracking

### Refactored ChannelView

ChannelView becomes a thin orchestration wrapper:

```
ChannelView(channelId, ...)
├── useChannel(channelId)           // channel metadata
├── useChannelMembers(channelId)    // member list
├── useChannelMessages(channelId)   // messages + WS listeners
├── useSyncChannel(channelId)       // missed message sync
├── useSendMessage(channelId)       // optimistic send
├── useMarkAsRead()                 // read status
├── useBotStartupCountdown(...)     // bot startup overlay
├── useOpenClawBotInstanceStatus()  // bot instance status
├── Thread state management         // useThreadStore
│
├── ChannelHeader (if !hideHeader)
├── BotStartupOverlay (if needed)
├── ChannelContent(messages, onSend, ...)   // <-- extracted component
├── BotInstanceStoppedBanner (if needed)
└── ThreadPanel(s)
```

ChannelView's external API remains unchanged — this is a purely internal refactor.

### Refactored TrackingModal

TrackingModal uses the same `ChannelContent` with tracking-specific logic:

```
TrackingModal(trackingChannelId, isActivated, ...)
├── useChannelObserver(trackingChannelId)     // WS room subscription
├── useChannelMessages(trackingChannelId)     // messages + WS listeners (reused!)
├── useSyncChannel(trackingChannelId)         // missed message sync
├── useSendMessage(trackingChannelId)         // send guidance
├── useChannel(trackingChannelId)             // channel metadata (isActivated, snapshot)
├── Tracking-specific WS listeners:
│   ├── tracking:deactivated → update isActivated state, capture snapshot
│   └── tracking:activated → update isActivated state
│
├── Modal shell (backdrop, container)
├── Modal header (bot avatar, name, Running badge, close button)
├── ChannelContent(messages, onSend, readOnly=!isActivated, ...)
```

Key points:

- `useChannelObserver` makes the server push tracking channel events to this client
- `useChannelMessages` provides messages and registers WS listeners for `new_message`, streaming, reactions — all already built-in
- Tracking-specific events (deactivated/activated) handled by a small useEffect in TrackingModal
- When deactivated: `readOnly=true`, no send handler
- The snapshot mechanism (for deactivated channels) can be simplified — `useChannelMessages` already has the messages cached; deactivation just needs to set `readOnly` and stop the observation

### What Gets Deleted

- **TrackingModal's custom message rendering loop** — replaced by `ChannelContent` → `MessageList` → `MessageItem`
- **TrackingModal's manual WS listeners** for streaming (START/CONTENT/END) — handled by `useChannelMessages`
- **TrackingModal's manual scroll management** (`scrollRef`, auto-scroll effect) — handled by Virtuoso in `MessageList`
- **TrackingModal's simple `<input>`** — replaced by `MessageInput`

### What Gets Kept

- **`TrackingCard`** (inline card in parent channel) — unchanged, still uses `useTrackingChannel` for compact preview
- **`useTrackingChannel` hook** — still needed for `TrackingCard`'s compact display (latest 3 messages, active stream indicator)
- **`TrackingEventItem`** — still used by `MessageItem` for agent event rendering (it's already part of the standard pipeline)
- **TrackingModal's outer shell** — modal backdrop, header with bot info and Running badge, close button

### TaskChatArea Impact

TaskChatArea already uses `ChannelView` directly (with `hideHeader` and `readOnly`). No changes needed. It could optionally migrate to `ChannelContent` in the future to avoid the overhead of ChannelView's bot-specific hooks, but this is not in scope.

## Data Flow Comparison

### Before (TrackingModal)

```
TrackingModal
├── useQuery(getMessages, limit=100)      // one-shot fetch, no pagination
├── useEffect: wsService.on(new_message)  // manual WS listener
├── useEffect: wsService.on(streaming_*)  // manual streaming listener
├── useState: messages[], activeStream    // local state management
├── custom <div> scroll container
└── messages.map(msg => <TrackingEventItem>)
```

### After (TrackingModal)

```
TrackingModal
├── useChannelObserver(channelId)         // WS room subscription
├── useChannelMessages(channelId)         // paginated fetch + built-in WS listeners
├── useSyncChannel(channelId)             // catch-up sync
├── useSendMessage(channelId)             // optimistic send
├── useEffect: tracking-specific events   // deactivated/activated only
└── <ChannelContent messages={...} onSend={...} />
    ├── <MessageList> (Virtuoso, virtual scroll, agent events, streaming)
    └── <MessageInput> (rich text, mentions, attachments)
```

## Edge Cases

### Deactivated Tracking Channels

When a tracking channel is deactivated:

1. Server emits `tracking:deactivated` with a snapshot
2. TrackingModal sets `readOnly=true`, hides MessageInput
3. Messages already in `useChannelMessages` cache remain visible
4. The snapshot in the server response is used only by `TrackingCard` (compact preview) — the modal shows the full cached message list

### Modal Open/Close Lifecycle

- On open: `useChannelObserver` subscribes to WS room, `useChannelMessages` fetches & listens
- On close: cleanup functions unsubscribe from WS room and remove listeners
- React Query cache persists across open/close cycles (staleTime-based)

### Channel Observation vs Membership

Normal channels: user is a member → server auto-broadcasts events to user's socket room.
Tracking channels: user may not be a traditional "member" in the sidebar sense → `useChannelObserver` explicitly subscribes via `channel:observe` event. This is the critical difference that requires keeping the observation hook.

## Testing Strategy

Target: 100% coverage on all new/modified code. Existing tests in `apps/client/src/components/channel/__tests__/` and `apps/client/src/hooks/__tests__/` establish the patterns to follow.

### ChannelContent Component Tests

**File:** `apps/client/src/components/channel/__tests__/ChannelContent.test.tsx`

Happy cases:

- Renders `MessageList` with provided messages and all required props
- Renders `MessageInput` when `onSend` is provided and `readOnly=false`
- Renders read-only bar when `readOnly=true`
- Renders unsynced messages banner when `hasMoreUnsynced=true`
- Passes `inputPlaceholder` through to `MessageInput`

Bad cases / edge cases:

- Empty messages array → shows empty state (delegates to MessageList)
- `onSend` undefined → no MessageInput rendered
- `readOnly=true` with `onSend` provided → still no MessageInput, shows read-only bar
- `messages` prop update → MessageList re-renders with new data
- All optional props omitted → renders with safe defaults

### ChannelView Refactor Tests

**File:** Update existing tests or create `apps/client/src/components/channel/__tests__/ChannelView.test.tsx`

Regression tests to ensure the refactor preserves behavior:

- ChannelView still renders ChannelHeader, MessageList, MessageInput, ThreadPanel
- `hideHeader` prop still hides header
- `readOnly` prop still shows read-only bar
- `previewChannel` mode still shows JoinChannelPrompt
- Bot startup overlay still renders when applicable
- Thread panel open/close behavior unchanged

### TrackingModal Refactor Tests

**File:** `apps/client/src/components/channel/__tests__/TrackingModal.test.tsx`

Happy cases:

- Modal renders with ChannelContent when `isOpen=true` and `trackingChannelId` is provided
- `useChannelObserver` is called with `trackingChannelId` when open
- Messages from `useChannelMessages` are passed to ChannelContent
- Send handler works when channel is activated
- Bot avatar, name, and "Running" badge render in header

Bad cases / edge cases:

- `isOpen=false` → returns null, no hooks fire
- `trackingChannelId` undefined → graceful empty state
- Channel deactivated (`isActivated=false`) → ChannelContent receives `readOnly=true`, no MessageInput
- `tracking:deactivated` WS event → transitions to readOnly state
- `tracking:activated` WS event → transitions back to active state
- Modal close → `useChannelObserver` unsubscribes (cleanup)
- Modal re-open → re-subscribes and refetches messages
- Rapid open/close → no leaked subscriptions or stale listeners

### TrackingCard Tests

**File:** Existing `apps/client/src/components/channel/__tests__/TrackingEventItem.test.tsx` + new tests if TrackingCard behavior changes

Regression tests:

- TrackingCard still renders inline preview with latest 3 messages
- Click on TrackingCard still opens TrackingModal
- Deactivated channel still shows snapshot data in card
- Active stream indicator still works in card

### Integration Considerations

- Verify that `useChannelMessages` + `useChannelObserver` together correctly receive real-time messages for tracking channels (WS observer subscribes to room, then new_message listener picks up events)
- Verify that streaming messages appear via `useStreamingStore` when observation is active
- Verify message deduplication works (optimistic send + WS resolution) in tracking channel context

## Out of Scope

- Refactoring TaskChatArea to use `ChannelContent` instead of `ChannelView`
- Adding tracking channels to the sidebar
- Changing `TrackingCard` (inline card) rendering
- Modifying server-side tracking channel logic
