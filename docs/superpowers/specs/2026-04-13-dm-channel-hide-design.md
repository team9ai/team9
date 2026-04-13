# DM Channel Hide/Show in Sidebar — Design Spec

## Overview

Add the ability for users to hide DM (direct) and echo channels from the sidebar via right-click context menu. Hidden channels reappear automatically when a new message arrives or the user manually opens the conversation. This is a per-user, unilateral operation — the other party is not affected.

Additionally, optimize large workspace behavior by skipping batch DM creation for workspaces with 10+ members.

## Scope

- Channel types affected: `direct`, `echo`
- Other channel types (`public`, `private`, `task`, `tracking`) are not affected.

## Data Layer

### Schema Change: `channel_members` table

Add a new column to `im_channel_members`:

```sql
ALTER TABLE im_channel_members
ADD COLUMN show_in_dm_sidebar BOOLEAN NOT NULL DEFAULT true;
```

This field is per-user, per-channel. It only has semantic meaning for `direct` and `echo` channel types, but exists on all rows for schema simplicity.

### State Transition Rules

| Trigger                                | Transition     | Where                   |
| -------------------------------------- | -------------- | ----------------------- |
| User right-clicks and hides channel    | `true → false` | Frontend calls API      |
| New message arrives in channel         | `false → true` | IM Worker (server-side) |
| User searches and opens conversation   | `false → true` | Frontend calls API      |
| DM channel created (auto, <10 members) | default `true` | On creation             |
| DM channel created (user-initiated)    | default `true` | On creation             |

## API Changes

### New Endpoint

```
PATCH /v1/im/channels/:id/sidebar-visibility
```

**Request body:**

```json
{ "show": true | false }
```

**Behavior:**

- Updates `show_in_dm_sidebar` on the current user's `channel_members` record
- Only allowed for `direct` and `echo` channel types (returns 400 otherwise)
- Requires JWT auth (JwtAuthGuard)

### Existing Endpoint Changes

**`GET /v1/im/channels` (getUserChannels):**

- Returns all DM/echo channels regardless of `showInDMSidebar` value
- Includes `showInDMSidebar: boolean` field in the response for each channel

## Backend Changes

### IM Worker: Auto-unhide on New Message

In `MessageService.processUpstreamMessage()`, after persisting the message, update `show_in_dm_sidebar = true` for all channel members where it is currently `false`:

```sql
UPDATE im_channel_members
SET show_in_dm_sidebar = true
WHERE channel_id = :channelId
  AND show_in_dm_sidebar = false;
```

This runs only for `direct`/`echo` channels (check channel type before executing). The cost is one additional UPDATE per message in DM channels, but only when there are hidden members (the WHERE clause makes it a no-op otherwise).

### Workspace Join: Conditional Batch DM Creation

In `WorkspaceService.acceptInvitation()`:

1. Count current workspace members
2. If `< 10`: keep existing behavior (batch create DM channels)
3. If `>= 10`: skip `createDirectChannelsBatch()` call entirely

DM channels for large workspaces are created on-demand via the existing `createDirectChannel()` endpoint, which is already idempotent (checks for existing channel via `GROUP BY / HAVING COUNT = 2`).

## Frontend Changes

### Right-Click Context Menu

- Add `onContextMenu` handler to `UserListItem` in `MessagesSubSidebar`
- Reuse existing context menu component style (same pattern as `MessageContextMenu`)
- Single menu item: "隐藏对话" (Hide Conversation)
- On click: call `PATCH /v1/im/channels/:id/sidebar-visibility` with `{ show: false }`
- Optimistic update: immediately remove channel from sidebar in React Query cache

### Sidebar Filtering

In `useChannelsByType()`:

```typescript
const directChannels = channels.filter(
  (ch) =>
    (ch.type === "direct" || ch.type === "echo") &&
    ch.showInDMSidebar !== false,
);
```

Optionally expose `hiddenDirectChannels` for search functionality.

### WebSocket: Auto-unhide on New Message

In `useWebSocketEvents` → `handleNewMessage()`:

- When a `new_message` event arrives for a channel where `showInDMSidebar === false`
- Update the React Query cache to set `showInDMSidebar = true`
- Channel immediately appears in sidebar without waiting for API response
- This is a double-safety alongside the IM Worker server-side unhide

### Search: Unhide on Open

When a user searches for someone and opens a DM conversation:

- If the DM channel exists but is hidden: call `PATCH sidebar-visibility` with `{ show: true }`
- If the DM channel doesn't exist: create via existing `createDirectChannel`, which defaults to `showInDMSidebar = true`

## Type Changes

### Backend Response Type

Add `showInDMSidebar` to channel response DTOs for DM/echo channels.

### Frontend Type

Update `ChannelWithUnread` interface:

```typescript
// Add to existing ChannelWithUnread interface in apps/client/src/types/im.ts
showInDMSidebar?: boolean; // only present for direct/echo channels
```

## Migration

- Add `show_in_dm_sidebar` column with `DEFAULT true` — all existing channels remain visible (no behavior change for existing users)
- No data backfill needed

## Testing

- Hide a DM channel → verify it disappears from sidebar
- Send a message to a hidden DM → verify it reappears
- Search and open a hidden DM → verify it reappears
- Hide does not affect the other party's sidebar
- Large workspace (>=10 members) join → verify no batch DM creation
- Small workspace (<10 members) join → verify batch DM creation still works
- Concurrent hide/unhide operations → verify no race conditions
- Echo channel hiding works the same as DM
