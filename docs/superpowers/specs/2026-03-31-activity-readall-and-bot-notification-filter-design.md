# Activity Read All & Bot Notification Filter

## Overview

Two improvements to the Activity notification system:

1. **Read All button** — Mark all notifications as read within the current Activity tab
2. **Bot notification filter** — Suppress Activity notifications for bot messages in tracking channels and bot DMs

## Requirement 1: Activity "Read All" Button

### Problem

No way to bulk-mark Activity notifications as read. Users must click each notification individually.

### Design

Add a "Read All" button next to the existing "Unread" toggle in `ActivitySubSidebar`. The button marks all unread notifications as read, scoped to the current tab.

**Tab-to-parameter mapping:**

| Tab      | API parameter                                                      |
| -------- | ------------------------------------------------------------------ |
| All      | no filter (marks everything)                                       |
| Mentions | `types=[mention, channel_mention, everyone_mention, here_mention]` |
| Threads  | `types=[reply, thread_reply]`                                      |

### Backend Changes

**`POST /v1/notifications/mark-all-read`** — add optional `types` query parameter.

File: `apps/server/apps/gateway/src/notification/notification.controller.ts`

- Accept `types` as comma-separated query parameter (e.g. `?types=mention,reply`)
- Pass to service method

File: `apps/server/apps/gateway/src/notification/notification.service.ts`

- `markAllAsRead(userId, category?, types?)` — add `inArray(notifications.type, types)` condition when `types` is provided

### Frontend Changes

File: `apps/client/src/services/api/notification.ts`

- `markAllAsRead(category?, types?)` — pass `types` as query parameter

File: `apps/client/src/hooks/useNotifications.ts`

- `useMarkAllNotificationsAsRead` — accept `types` parameter, pass to API and store

File: `apps/client/src/stores/useNotificationStore.ts`

- `markAllAsRead(category?, types?)` — when `types` provided, only mark matching notifications as read in local state; update counts accordingly

File: `apps/client/src/components/layout/sidebars/ActivitySubSidebar.tsx`

- Add "Read All" button next to "Unread" toggle
- On click: derive `types` from current `activeTab` using `MENTION_TYPES` / `THREAD_TYPES` constants, call `markAllAsRead` mutation

## Requirement 2: Bot Notification Filter

### Problem

Bot messages in tracking channels and bot DMs generate Activity notifications (dm_received, reply, thread_reply), flooding the Activity panel with execution process noise.

### Design

Skip the notification pipeline for two specific scenarios. Message delivery (WebSocket `new_message` push) and unread count updates are unaffected.

**Filter rules:**

| Condition                                                | Notifications skipped           |
| -------------------------------------------------------- | ------------------------------- |
| `channel.type === 'tracking'`                            | All (mention, reply, DM)        |
| `channel.type === 'direct' && sender.userType === 'bot'` | DM notification (`dm_received`) |

Bots that want to intentionally notify users call reply/mention APIs directly — those notifications are triggered through separate code paths and remain unaffected.

### Backend Changes

File: `apps/server/apps/im-worker/src/post-broadcast/post-broadcast.service.ts`

In `processNotificationTasks`, after fetching `messageData`, add two guards:

```typescript
// Tracking channels: no Activity notifications (execution process noise)
if (channel.type === "tracking") return;

// Bot DMs: skip dm_received notification (bot uses reply API for intentional notifications)
if (channel.type === "direct" && sender.userType === "bot") return;
```

### No frontend changes needed

The frontend already renders whatever notifications exist. Fewer notifications created = fewer shown.

## Testing

### Requirement 1

- All tab: Read All marks all unread notifications as read
- Mentions tab: Read All only marks mention-type notifications as read
- Threads tab: Read All only marks reply/thread_reply notifications as read
- Button should be disabled or hidden when no unread notifications exist in current tab
- Counts update correctly after Read All (badge, store, React Query cache)

### Requirement 2

- Bot message in tracking channel: no Activity notification created
- Bot DM: no `dm_received` notification created
- Human DM: `dm_received` notification still created
- Bot @mention in group channel: mention notification still created (not filtered)
- Message WebSocket push (`new_message`) unaffected for all scenarios
- Unread count updates unaffected for all scenarios
