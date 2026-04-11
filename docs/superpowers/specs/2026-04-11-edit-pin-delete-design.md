# Message Edit, Pin, and Delete Design

**Date:** 2026-04-11
**Status:** Approved

## Problem

The backend APIs for message editing, pinning, and deletion are fully implemented, but the frontend handlers are stubbed with `console.log` + TODO comments. Additionally:

- The edited timestamp is not displayed (only `(edited)` text)
- Pin/unpin has no React Query hooks or optimistic updates
- Delete lacks a confirmation dialog and admin permission support

## Solution Overview

Implement three features in the frontend (and minor backend changes for admin delete):

1. **Inline message editing** using the existing Lexical rich text editor
2. **Pin/unpin** with optimistic React Query cache updates
3. **Delete confirmation dialog** with admin permission to delete others' messages

## Design Decisions

| Decision                | Outcome                                                           |
| ----------------------- | ----------------------------------------------------------------- |
| Edit UI                 | Inline Lexical editor replacing message content area              |
| HTML back-fill          | New `InitialHtmlPlugin` using `$generateNodesFromDOM`             |
| Edit save trigger       | Enter to save (same as send), Esc to cancel                       |
| Edited timestamp        | `(edited at HH:mm)` or full date if not today, using `updatedAt`  |
| Pin feedback            | Silent — `isPinned` icon change is the feedback, no toast         |
| Pin optimistic update   | Modify React Query cache on mutate, rollback on error             |
| Pin WebSocket broadcast | Not adding — low frequency, eventual consistency acceptable       |
| Delete confirmation     | AlertDialog for ALL deletes (own + admin)                         |
| Admin delete            | Backend: allow owner/admin role; Frontend: show delete for admins |

## Feature 1: Inline Message Editing

### Interaction Flow

1. User right-clicks message → clicks "Edit" → message content area replaced by Lexical editor
2. Editor uses new `InitialHtmlPlugin` with `$generateNodesFromDOM` to back-fill original HTML, preserving mentions, code blocks, and other rich text
3. Editor appears in compact mode (no file upload toolbar), with "Save" / "Cancel" buttons and an Esc hint below
4. Enter saves the edit (same as normal send), Esc cancels
5. On save: calls `useUpdateMessage` hook → `PATCH /messages/:id`
6. Backend broadcasts `message_updated` WebSocket event; existing `handleMessageUpdated` handler updates cache automatically

### Edited Timestamp Display

Current `(edited)` text replaced with `(edited at HH:mm)` / `(已编辑于 HH:mm)` using `message.updatedAt`. Shows full date if not today. New i18n key `editedAt` with interpolation.

### State Management

`editingMessageId` state lifted to the `ChannelMessageList` component (the parent that renders individual `MessageListItem`s inside `MessageList.tsx`). Passed down as `isEditing` boolean and `onEditSave`/`onEditCancel` callbacks. Only one message can be in edit mode at a time. Setting a new edit ID cancels the previous one.

### Files to Modify

- `RichTextEditor.tsx` — add `initialHtml` prop and `InitialHtmlPlugin` (uses `$generateNodesFromDOM`)
- `MessageItem.tsx` — when `isEditing` is true, render Lexical editor in place of message content
- `MessageList.tsx` — manage `editingMessageId` state; `handleEdit` sets state; `handleEditSave` calls API and clears state
- i18n `message.json` (8 locales) — add `editedAt`, `editSave`, `editCancel`, `editHint` keys

## Feature 2: Pin/Unpin Messages

### Interaction Flow

1. User right-clicks message → clicks "Pin message" or "Unpin message"
2. Calls `usePinMessage` or `useUnpinMessage` hook → `POST/DELETE /messages/:id/pin`
3. Optimistic update: immediately flips `isPinned` in React Query cache; rollback on error
4. No toast — the pin icon change is the visual feedback

### Permissions

Backend already restricts pin/unpin to `owner`/`admin` roles. Frontend context menu shows pin option for all users (current behavior unchanged). If API returns 403, optimistic update rolls back.

### Optimistic Update Pattern

Follows existing `useAddReaction` pattern:

- `onMutate`: snapshot previous cache, update `isPinned` field
- `onError`: restore snapshot
- `onSettled`: invalidate queries for consistency

### WebSocket

No changes. Pin/unpin is low-frequency; other users see the update on next message load.

### Files to Modify

- `useMessages.ts` — add `usePinMessage(channelId)` and `useUnpinMessage(channelId)` hooks with optimistic update
- `MessageList.tsx` — `handlePin` calls pin or unpin hook based on `message.isPinned`

## Feature 3: Delete with Confirmation + Admin Permissions

### Interaction Flow

1. User right-clicks message → clicks "Delete message" → confirmation AlertDialog opens
2. Dialog text: "Are you sure you want to delete this message? This action cannot be undone."
3. On confirm: calls `useDeleteMessage` hook → `DELETE /messages/:id`
4. Backend broadcasts `message_deleted` WebSocket event; cache updates automatically

### Confirmation Dialog

New `DeleteMessageDialog` component using Radix UI `AlertDialog` (shadcn/ui). Props: `open`, `onConfirm`, `onCancel`. Delete button uses `destructive` variant.

### Permission Changes

**Frontend:**

- Context menu delete option visibility: `isOwnMessage` → `isOwnMessage || isAdmin || isOwner`
- Requires current user's channel role — obtained via existing `useChannelMembers` hook or a lightweight role check

**Backend (`messages.service.ts`):**

- Current: `senderId !== userId` → throw `ForbiddenException`
- New: `senderId !== userId` AND user is not `owner`/`admin` in the channel → throw `ForbiddenException`
- Inject `ChannelsService` to check role (same pattern as pin permission check)

**Backend (`messages.controller.ts`):**

- Pass `channelId` (already fetched via `getMessageChannelId`) to the updated `delete()` method

### Files to Modify

- New `DeleteMessageDialog.tsx` — confirmation dialog component
- `MessageItem.tsx` — show delete option for `isOwnMessage || isAdmin || isOwner`
- `MessageList.tsx` — `handleDelete` opens dialog; on confirm calls API; needs user channel role
- `messages.service.ts` (backend) — `delete()` accepts optional channel role, allows admin/owner
- `messages.controller.ts` (backend) — fetch role before calling `delete()`
- i18n `message.json` (8 locales) — add `deleteConfirmTitle`, `deleteConfirmDescription`, `deleteConfirm`, `deleteCancel` keys

## Out of Scope

- Pin WebSocket broadcast (can be added later if real-time pin sync is needed)
- Edit history / audit log
- Thread panel edit/pin support (thread messages don't currently pass these handlers)
- Pinned messages panel UI (listing all pinned messages in a sidebar)
