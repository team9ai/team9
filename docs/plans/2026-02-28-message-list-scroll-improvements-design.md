# Message List Scroll Improvements Design

## Problem

The channel MessageList has six issues compared to Slack-style chat behavior:

1. **P0**: New messages force-scroll to bottom regardless of user's scroll position
2. **P0**: No "jump to bottom" button when scrolled up
3. **P1**: No unread message separator line
4. **P1**: Load-more scroll position preservation has race conditions with real-time updates
5. **P2**: `[...messages].reverse()` runs on every render without memoization
6. **P2**: Each `ChannelMessageItem` calls `useChannel(channelId)` independently (50 messages = 50 hook subscriptions)

## Approach: Lightweight State Tracking

Use simple `isNearBottom` boolean + `newMessageCount` counter in MessageList. No formal state machine — the channel context doesn't need `jumpingToLatest` refetch behavior since new messages arrive via WebSocket and are always in cache.

## Design

### P0-1: Scroll position detection + conditional auto-scroll

Add scroll listener on the Radix ScrollArea viewport:

```
isNearBottom = scrollHeight - scrollTop - clientHeight < 150
```

On new messages: only auto-scroll when `isNearBottom`. Otherwise increment `newMessageCount`.

**Files changed:** `MessageList.tsx`

### P0-2: Floating "jump to bottom" button

Reuse ThreadPanel's existing button pattern:

- Show "↓" when `!isNearBottom`
- Show "↓ X new messages" when `!isNearBottom && newMessageCount > 0`
- Click: smooth scroll to bottom, reset counter

**Files changed:** `MessageList.tsx`

### P1-1: Unread message separator

- `ChannelView` passes `lastReadMessageId` from `ChannelWithUnread` to `MessageList`
- During render, insert a red "New" divider before the first message after `lastReadMessageId`
- On initial load: if separator is in current page, scroll to it instead of bottom
- Fallback: if `lastReadMessageId` is not in loaded messages (too many unread), scroll to bottom

**Files changed:** `ChannelView.tsx`, `MessageList.tsx`

### P1-2: Load-more scroll preservation race fix

- Introduce `isLoadingMore` ref, set `true` only when IntersectionObserver triggers `onLoadMore`
- Scroll position adjustment effect depends on this explicit flag
- Real-time message updates / reaction changes no longer trigger the adjustment

**Files changed:** `MessageList.tsx`

### P2-1: Memoize reversed messages

```ts
const sortedMessages = useMemo(() => [...messages].reverse(), [messages]);
```

**Files changed:** `MessageList.tsx`

### P2-2: Deduplicate useChannel calls

Move `useChannel(channelId)` from `ChannelMessageItem` (per-message) to `MessageList` parent. Pass `isDirect` boolean as prop.

**Files changed:** `MessageList.tsx`

## i18n

New translation keys needed in `channel` namespace:

- `newMessages` (already exists in thread namespace, reuse pattern): "{{count}} new messages"
- `jumpToBottom`: "Jump to latest"
