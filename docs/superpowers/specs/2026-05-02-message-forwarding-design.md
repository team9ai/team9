# Message Forwarding (Single + Multi-Select Bundle)

**Date:** 2026-05-02
**Status:** Design — ready for plan
**Author:** Winrey + Claude
**Scope:** Team9 IM (gateway + im-worker + Tauri client)

## 1. Goals

Allow a user to forward an existing message — or a hand-picked group of messages — into another channel inside the same workspace, in a way that:

1. Visibly marks the new message as "forwarded" (not authored by the forwarder).
2. For multi-select, packs N messages into a single bundle "chat record" message at the destination.
3. Carries enough source-context metadata that an **agent** can later locate the original channel and the position of the original message(s) — even if the source has been edited or soft-deleted.
4. Reuses the existing message pipeline (`createMessage` → `im_messages` → WS broadcast → outbox) instead of inventing a parallel path.

### Non-goals (V1)

- Multi-target send (one forward call → multiple destination channels at once).
- Cross-workspace forwarding.
- Cross-channel bundle (mixing sources from different channels into one bundle).
- Forward with a comment (附言). The forwarder may follow up with a separate normal message if they want to comment.
- Carrying reactions, read state, properties, or thread structure across the forward.
- Re-running AI auto-fill on the destination side based on forwarded content.
- Webhook / external surfacing (PostHog, search index updates beyond the standard message-created path).

## 2. User-facing Behavior

### 2.1 Entry points

- **Hover toolbar** on a message gains a "Forward" icon (paper-plane). Click → opens the forward dialog with that single message preselected.
- **Hover toolbar** also gains a "Select" icon (checkmark). Click → enters channel-wide **selection mode**.
- **Right-click context menu** gains "Forward" and "Select" items mirroring the hover toolbar.
- **In selection mode**:
  - A checkbox appears on the left of every message row in the channel.
  - A floating action bar appears at the **bottom** of the channel pane, anchored above the message composer, showing `N selected · Forward · Cancel`.
  - Clicking another message toggles its checkbox; `Shift+click` selects a range.
  - `Esc` or `Cancel` exits selection mode without forwarding.
  - Switching channels / opening another route auto-exits selection mode.
  - Selection is constrained to the **same channel** — switching channels clears selection.
- Selection cap: **100 messages**. UI prevents adding the 101st with a toast (`forward.tooManySelected`).

### 2.2 Forward dialog

A modal with:

- Title: `Forward message` / `Forward N messages`.
- Search box + scrollable list of channels in the current workspace where the user has **write access** (`assertWriteAccess`-equivalent). Channels are grouped: `Direct messages` / `Channels`. Archived / deactivated channels are excluded server-side and not shown.
- Single selection — clicking a channel highlights it. Confirming with `Forward` button sends.
- Below the channel list, a small **preview** panel shows what will be sent (single quote card, or bundle card with first 3 message previews + "…and N more").
- No comment / 附言 input in V1.
- Loading state on confirm; close on success.
- Errors are shown inline (e.g. "You no longer have access to this channel").

### 2.3 Forwarded message rendering

A new message of `type: 'forward'` renders with:

- A subtle "Forwarded from #source-channel-name" header line above the body.
- **Single forward**: a quote card showing the original sender's avatar + display name + relative timestamp + content snapshot (Lexical-rendered when `contentAstSnapshot` is present, plaintext fallback otherwise) + attachment chips.
- **Bundle forward**: a stacked-paper card showing:
  - Header: `Chat record · N messages from #source-channel-name`.
  - Up to 3 preview rows: `@user · "first 80 chars of content…"`.
  - Footer: `Click to view all` (when N > 3).
  - Click anywhere → opens a **bundle viewer modal** with all N items rendered in their original order, each showing original sender + timestamp + full content (Lexical AST or HTML/Markdown fallback) + attachments.
- Both cards expose a `Jump to original` link **only when** the user still has read access to the source channel and the source message has not been hard-deleted. Otherwise the link is hidden and a small dimmed note `Source no longer available` is shown.
- Soft-deleted source: snapshot is rendered (it was captured at forward time); `Jump to original` is hidden.

### 2.4 What can be forwarded

Allowed source `messageType` values: `text`, `long_text`, `file`, `image`.

Disallowed (silently filtered out of selection, with a tooltip on the disabled checkbox):

- `system` — auto-generated context, semantically meaningless out of channel.
- `tracking` — tied to a tracking channel's structured data.
- `forward` itself **is allowed** — forwarding a forward is permitted; see §6.4.
- A message currently being streamed (`metadata.streaming === true` or the in-memory streaming message store says so). UI disables the checkbox.
- A message marked `isDeleted`. Already not visible.

### 2.5 i18n

All new strings go in `apps/client/src/i18n/locales/{en,zh-CN}/channel.json` under a `forward.*` namespace:

```
forward.toolbar.forward          "Forward" / "转发"
forward.toolbar.select           "Select"  / "选择"
forward.contextMenu.forward      "Forward" / "转发"
forward.contextMenu.select       "Select"  / "选择"
forward.dialog.titleSingle       "Forward message" / "转发消息"
forward.dialog.titleBundle       "Forward {{count}} messages" / "转发 {{count}} 条消息"
forward.dialog.searchPlaceholder "Search channels…" / "搜索频道…"
forward.dialog.confirm           "Forward" / "发送"
forward.dialog.cancel            "Cancel"  / "取消"
forward.selection.bar            "{{count}} selected" / "已选 {{count}} 条"
forward.selection.cancel         "Cancel"  / "取消"
forward.tooManySelected          "You can forward up to 100 messages at once." / "一次最多转发 100 条消息"
forward.card.fromChannel         "Forwarded from #{{channelName}}" / "转自 #{{channelName}}"
forward.bundle.title             "Chat record · {{count}} messages" / "聊天记录 · {{count}} 条"
forward.bundle.viewAll           "View all" / "查看全部"
forward.bundle.modalTitle        "Chat record from #{{channelName}}" / "来自 #{{channelName}} 的聊天记录"
forward.source.unavailable       "Source no longer available" / "原消息已不可访问"
forward.source.jumpTo            "Jump to original" / "跳转到原消息"
forward.error.notAllowed         "This message can't be forwarded." / "此消息不可转发"
forward.error.noWriteAccess      "You can't forward to this channel." / "你没有该频道的发送权限"
forward.error.mixedChannels      "All selected messages must come from the same channel." / "多选转发的消息必须来自同一频道"
```

Existing locale files are merged additively — no key removal.

## 3. Data Model

### 3.1 Enum extension

`apps/server/libs/database/src/schemas/im/messages.ts` — add `'forward'` to `messageTypeEnum`:

```ts
export const messageTypeEnum = pgEnum("message_type", [
  "text",
  "file",
  "image",
  "system",
  "tracking",
  "long_text",
  "forward",
]);
```

Client mirror: `apps/client/src/types/im.ts` `MessageType` union adds `'forward'`.

### 3.2 New table — `im_message_forwards`

```ts
// apps/server/libs/database/src/schemas/im/message-forwards.ts
import {
  pgTable,
  uuid,
  integer,
  timestamp,
  jsonb,
  varchar,
  bigint,
  index,
} from "drizzle-orm/pg-core";
import { messages } from "./messages.js";
import { channels } from "./channels.js";
import { tenants } from "../tenant/tenants.js";
import { users } from "./users.js";

export interface ForwardAttachmentSnapshot {
  originalAttachmentId: string; // id of the source im_message_attachments row at forward time
  fileName: string;
  fileUrl: string;
  fileKey: string | null;
  fileSize: number;
  mimeType: string;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
}

export const messageForwards = pgTable(
  "im_message_forwards",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // The newly created forward-type message that holds this row(s).
    forwardedMessageId: uuid("forwarded_message_id")
      .references(() => messages.id, { onDelete: "cascade" })
      .notNull(),

    // Order inside a bundle (0 for single-forward, 0..N-1 for bundle).
    position: integer("position").notNull(),

    // Pointer to the original message. Set null if the source row is hard-deleted
    // (we keep snapshot fields intact so rendering still works).
    sourceMessageId: uuid("source_message_id").references(() => messages.id, {
      onDelete: "set null",
    }),

    // Denormalized source location — survives source deletion. Used by agents to
    // locate the original channel + workspace + sender + position.
    // FK action is RESTRICT (default) because the column is NOT NULL and
    // channels are soft-archived in this product, never hard-deleted.
    sourceChannelId: uuid("source_channel_id")
      .references(() => channels.id)
      .notNull(),
    sourceWorkspaceId: uuid("source_workspace_id").references(
      () => tenants.id,
      {
        onDelete: "set null",
      },
    ),
    sourceSenderId: uuid("source_sender_id").references(() => users.id, {
      onDelete: "set null",
    }),
    sourceCreatedAt: timestamp("source_created_at").notNull(),
    sourceSeqId: bigint("source_seq_id", { mode: "bigint" }),

    // Snapshot at forward time — guarantees we can render even if original is
    // edited or hard-deleted. AST is the canonical render path; plaintext is
    // search/preview fallback. Attachments are stored ONLY here (the forward
    // message itself has no rows in im_message_attachments) — see Notes #5.
    contentSnapshot: varchar("content_snapshot", { length: 100_000 }),
    contentAstSnapshot: jsonb("content_ast_snapshot").$type<
      Record<string, unknown>
    >(),
    attachmentsSnapshot: jsonb("attachments_snapshot").$type<
      ForwardAttachmentSnapshot[]
    >(),
    sourceType: varchar("source_type", { length: 32 }).notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_mf_forwarded").on(table.forwardedMessageId),
    index("idx_mf_source_msg").on(table.sourceMessageId),
    index("idx_mf_source_channel").on(table.sourceChannelId),
    index("idx_mf_source_workspace").on(table.sourceWorkspaceId),
  ],
);

export type MessageForward = typeof messageForwards.$inferSelect;
export type NewMessageForward = typeof messageForwards.$inferInsert;
```

Notes:

1. One forward = exactly 1 row for `kind: 'single'`, exactly N rows for `kind: 'bundle'` (sharing the same `forwardedMessageId`, `position` 0..N-1).
2. `sourceChannelId` is `NOT NULL` so the agent-traceability invariant always holds. The FK uses default action (`NO ACTION` / `RESTRICT`) — channels in this product are soft-archived, never hard-deleted (verified against `channels.ts` — no destructive cascade configured). If a future migration starts hard-deleting channels, this column would need to become nullable.
3. `contentSnapshot` capped at 100 000 chars (matches `long_text` upper bound + headroom). Anything longer is truncated server-side at forward time and a `truncated: true` flag is added both to that row and to `metadata.forward`.
4. `sourceType` records what the original `messageType` was at forward time (so the renderer knows whether to draw an image preview / file row / text body / nested forward).
5. **Attachments are stored only inside `attachmentsSnapshot` JSON.** The forward message itself has zero rows in `im_message_attachments`. Reasons: (a) avoids "ghost" attachment rows pointing at a forward message they don't logically belong to; (b) bundle forwards aggregate N items so per-position attachment ownership cannot be expressed via the existing `im_message_attachments(messageId)` shape; (c) the underlying S3 / file-keeper blob is referenced by the same `fileUrl` / `fileKey` snapshot, so download still works without a row duplication. The forward renderer reads attachments from the snapshot instead of via `getMessageAttachments`.

### 3.3 Forwarded-message metadata

The new top-level forward message stores in `messages.metadata.forward`:

```ts
metadata.forward = {
  kind: 'single' | 'bundle',
  count: number,            // 1 for single, N for bundle
  sourceChannelId: string,  // duplicated from rows for cheap reads
  sourceChannelName: string, // snapshot for header rendering when source channel is renamed/inaccessible
  truncated?: boolean,      // any item snapshot was truncated
};
```

`messages.content` for a forward message is set to a plaintext digest:

- Single: `[Forwarded] {original sender display name}: {first 200 chars of content}`.
- Bundle: `[Forwarded chat record · N messages from #channel] {first sender}: {first 80 chars}; …`.

This keeps preview / notification / search-index paths working without needing forward-specific code in those layers.

`messages.contentAst` is `null` for forward messages. Renderer dispatches on `type === 'forward'` and reads the relational rows.

### 3.4 Migration

Generated via `pnpm db:generate`. Migration file lives under `apps/server/libs/database/migrations/` following the existing numbering. Migration is forward-only (we do not write a `down`); rollback strategy is restore-from-backup as per existing project convention.

## 4. Backend API

### 4.1 New endpoint

`POST /api/v1/im/channels/:targetChannelId/forward`

Request body:

```ts
{
  sourceChannelId: string;     // must equal channel of every sourceMessageId
  sourceMessageIds: string[];  // 1..100
  clientMsgId?: string;        // dedup key for the new forward message
}
```

Response: `MessageResponse` (the new forward-type message, in standard preview-truncated form).

Behavior:

1. `assertReadAccess(sourceChannelId, userId)` — must be able to read the source.
2. `assertWriteAccess(targetChannelId, userId)` — equivalent of `isMember` + `!isArchived` + `!isDeactivated` + bot-DM policy. (Reuse the same checks `MessagesController.createChannelMessage` runs today; extract to `channelsService.assertWriteAccess` if not already public — see §4.4.)
3. Validate `sourceMessageIds.length` is `1..100`. Reject `0` (`BadRequest`) and `>100` (`BadRequest forward.tooManySelected`).
4. Load all source messages in one query. Validate:
   - Each exists, is not `isDeleted`.
   - Each `channelId === sourceChannelId` (`BadRequest forward.error.mixedChannels`).
   - Each `type ∈ {text, long_text, file, image, forward}` (`BadRequest forward.error.notAllowed`).
   - None has `metadata.streaming === true` (`BadRequest forward.error.notAllowed`).
   - Re-forward case (`type === 'forward'`): allowed; we **do not flatten** the chain. The new forward row's `sourceMessageId` points at the previous forward message; the snapshot is captured from that forward message's plaintext digest + its first attachment set. Agents can walk back one hop via the relational table; deeper chains require deeper queries.
5. Load attachments for all source messages (read-only; we are snapshotting, not duplicating).
6. Decide `kind`: `'single'` if `length === 1`, else `'bundle'`.
7. Build the new forward message via the existing `createMessage` gRPC path (reuses outbox, dedup, seq-id). Pass `type: 'forward'`, `metadata.forward`, computed plaintext `content`, and an empty attachments list (forward messages own no `im_message_attachments` rows — see §3.2 Note 5).
8. After the new message is persisted, insert N `im_message_forwards` rows in one batch insert. If this insert fails, the new forward message is soft-deleted (`isDeleted = true`) by the controller's catch handler and a 500 is surfaced. Risk is bounded: forward-row insert is a simple multi-row INSERT with no FK back-pressure aside from the freshly created `forwardedMessageId`.
9. Broadcast via `WS_EVENTS.MESSAGE.NEW` (no new event type needed — client renders by `type`).
10. Skip `triggerAiAutoFill` for forwarded messages (gated on `type !== 'forward'`).
11. Skip `RABBITMQ_ROUTING_KEYS.MESSAGE_CREATED` for `type === 'forward'` so we don't trigger agent reactions on forwarded chatter.
12. Emit a search-index event `message.created` as today, with `content` = the digest.

### 4.2 Read path changes

`MessagesService.getMessageWithDetails` (and the bulk equivalents used by `getChannelMessages` / `getThread`) — when assembling a `MessageResponse`, if `type === 'forward'`, also load:

- All `im_message_forwards` rows for that message (`forwardedMessageId = $`), ordered by `position ASC`.
- For each row, hydrate a `ForwardItemResponse`:
  ```ts
  {
    position: number;
    sourceMessageId: string | null;
    sourceChannelId: string;
    sourceChannelName: string | null;     // resolved at read time, may be null if user lacks access
    sourceWorkspaceId: string | null;
    sourceSender: { id, username, displayName, avatarUrl } | null; // null if user deleted
    sourceCreatedAt: string;
    sourceSeqId: string | null;
    sourceType: 'text' | 'long_text' | 'file' | 'image' | 'forward';
    contentSnapshot: string | null;
    contentAstSnapshot: unknown | null;
    attachmentsSnapshot: ForwardAttachmentSnapshot[];
    canJumpToOriginal: boolean;           // true iff sourceMessageId still exists AND user has read access to sourceChannelId
    truncated: boolean;
  }
  ```
- `sourceChannelName` is resolved per-request via the existing channel-name cache (Redis-backed). On miss → DB lookup.
- `canJumpToOriginal` is computed by batching `assertReadAccess` checks across all distinct source channels in the page (one membership check per channel, not per row).
- The `MessageResponse` adds an optional `forward?: { kind, count, sourceChannelId, sourceChannelName, items: ForwardItemResponse[], truncated }` field. Existing consumers that ignore unknown fields are unaffected.

### 4.3 Truncation

`MessagesService.truncateForPreview` — for `type === 'forward'`, do **not** truncate the relational items (already snapshot-shaped); only truncate the top-level `content` digest as today. The bundle viewer modal calls a separate full endpoint:

`GET /api/v1/im/messages/:id/forward-items` → returns the full untruncated `ForwardItemResponse[]`.

(For the channel list view we send only the truncated digest + first 3 items; bundle viewer fetches the full set on open. This keeps the channel scroll payload bounded.)

### 4.4 Channel access helper

`ChannelsService.assertReadAccess` exists. We add a peer:

```ts
async assertWriteAccess(channelId: string, userId: string): Promise<void>
```

Implementation lifts the existing checks scattered in `createChannelMessage`:

- `isMember`
- channel `!isArchived`
- reject when `channel.isActivated === false` (tracking / one-shot channels that have been deactivated)
- bot-DM outbound policy (mirrors `assertMentionsAllowed`-style restrictions if applicable)

Existing call sites in `MessagesController.createChannelMessage` are refactored to call this helper (small refactor, in scope per "improve code we're working in").

### 4.5 Error matrix

| Condition                                     | HTTP                      | Error code                |
| --------------------------------------------- | ------------------------- | ------------------------- |
| User not a member of source                   | 403                       | `forward.noSourceAccess`  |
| User not a member of target / target archived | 403                       | `forward.noWriteAccess`   |
| Empty `sourceMessageIds`                      | 400                       | `forward.empty`           |
| `sourceMessageIds.length > 100`               | 400                       | `forward.tooManySelected` |
| Mixed source channels                         | 400                       | `forward.mixedChannels`   |
| Disallowed source type / streaming / deleted  | 400                       | `forward.notAllowed`      |
| Source message not found                      | 404                       | `forward.notFound`        |
| Self-forward to same channel                  | allowed (no special-case) | —                         |

## 5. WebSocket

No new event names. The new forward message is broadcast via the existing `WS_EVENTS.MESSAGE.NEW` payload. Clients render by `type === 'forward'`.

If a forwarded message is later edited (allowed: only `messages.content`/digest can be edited — but in V1 we **disallow edits on forward messages**; controller rejects `PATCH /messages/:id` with 400 `forward.editDisabled` when target is type forward) or deleted, existing `MESSAGE.UPDATED` / `MESSAGE.DELETED` events fire as today.

## 6. Frontend

### 6.1 New components

- `apps/client/src/components/channel/forward/`
  - `ForwardDialog.tsx` — modal, channel picker, preview pane, confirm.
  - `ForwardChannelList.tsx` — scrollable list with search; data via `useChannels()` (existing hook) filtered to write-accessible.
  - `ForwardPreviewSingle.tsx` — single-quote preview.
  - `ForwardPreviewBundle.tsx` — bundle preview (first 3).
  - `ForwardedMessageCard.tsx` — replaces normal message body when `message.type === 'forward'`. Branches into single vs bundle.
  - `ForwardBundleViewer.tsx` — modal listing all bundle items; opens on bundle-card click.
  - `forward-selection-store.ts` — Zustand store (matches existing `useAppStore` / `useWorkspaceStore` pattern) holding `{ active: boolean, channelId: string | null, selectedIds: Set<string> }`. Only ever active for one channel at a time.
  - `__tests__/` — unit tests per component.

### 6.2 Modifications

- `MessageHoverToolbar.tsx` — add Forward + Select icons (ordered after Reply, before Copy).
- `MessageContextMenu.tsx` — add `forward` and `select` items.
- `MessageItem.tsx` — when selection mode is active and the row is in the active selection-mode channel, render a left-side checkbox; clicking the row toggles selection (block existing actions like opening thread). Disable checkbox for ineligible types with tooltip.
- `MessageList.tsx` — when selection mode is active for this channel, render a sticky bottom action bar with `N selected · Forward · Cancel`. Listen for route changes to clear selection.
- `MessageContent.tsx` — when `message.type === 'forward'`, render `<ForwardedMessageCard message={message} />` instead of normal content.
- `apps/client/src/services/api.ts` — add `forwardMessages({ targetChannelId, sourceChannelId, sourceMessageIds })` and `getForwardItems(messageId)`.
- `apps/client/src/types/im.ts` — `MessageType` adds `'forward'`; `Message` adds optional `forward?: ForwardPayload`.
- `apps/client/src/stores/` — selection store registered.
- WS handler in `apps/client/src/services/websocket.ts` — no change (existing `new_message` listener handles it; React Query cache invalidation is already keyed by channelId).

### 6.3 Keyboard

- In selection mode: `Esc` cancels; `Enter` opens the forward dialog if `selectedIds.size >= 1`; `Shift+click` extends.
- In hover toolbar: `F` shortcut wired in `MessageContextMenu` shortcuts (matches existing T/L/E pattern).

### 6.4 Re-forward chain rendering

Forwarding a forward yields a forward message whose snapshot is just the previous forward's plaintext digest + the first attachment set, **not** a recursively expanded chain. The card shows `Forwarded from #X` per usual; `Jump to original` (if accessible) lands the user on the previous forward message. Walking deeper is the user's responsibility (one hop at a time). This keeps storage bounded and avoids infinite-recursion edge cases.

## 7. Agent Integration

The `im_message_forwards` table is the contract. Agents (and the search/index layer if it ever needs it) can:

- `WHERE source_message_id = ?` — find every forward of a specific message.
- `WHERE source_channel_id = ?` — find every forward whose source is in a given channel.
- `WHERE forwarded_message_id = ?` — load all source pointers for one forward message.
- Join `forwarded_message_id` back to `im_messages` to find the destination channel + sender + time.

The denormalized `sourceChannelId`, `sourceWorkspaceId`, `sourceSenderId`, `sourceCreatedAt`, `sourceSeqId` are explicitly there so agents can locate the original conversation **position** even if the original message row is gone (`sourceMessageId` is null) — they can fetch a slice of `im_messages` around `sourceCreatedAt` / `sourceSeqId` in `sourceChannelId`.

No new MCP tool, no new gRPC method in V1. If agents need a higher-level "trace this forward back to its origin" tool later, it goes on top of these columns.

## 8. Permissions Recap

- **Forward action**: requires read on source channel + write on target channel.
- **Bundle viewer modal**: any user who can read the forward message can view the snapshot. They do NOT need access to the source channel.
- **Jump to original**: requires read access to source channel at click time (re-checked server-side via `assertReadAccess`; otherwise 403 → UI shows "Source no longer available").
- **Edit / delete forward message**: edit disabled (V1). Delete allowed for own message + admins/owners (matches existing message delete policy).

## 9. Testing

Per project CLAUDE.md (100% coverage on new code).

### 9.1 Backend unit

- `messages.service.spec.ts`:
  - `forward()` happy path — single text, single image, single file, single long_text.
  - `forward()` happy path — bundle of 5 mixed types.
  - Mixed-channel rejection.
  - Disallowed type rejection (system, tracking, streaming, deleted).
  - Empty / >100 selection rejection.
  - Re-forward chain — snapshot capture from a previous forward message.
  - Truncation flag set when content > 100k.
  - Attachment snapshot capture: `attachmentsSnapshot` arrays carry `originalAttachmentId` + identical `fileUrl` / `fileKey`; no rows are added to `im_message_attachments` for the forward message.
  - Race: source deleted between read and insert → either succeeds with snapshot or returns 404 deterministically.
- `channels.service.spec.ts`:
  - `assertWriteAccess` happy + each rejection branch (not member, archived, deactivated, bot-DM blocked).
- New `message-forwards.spec.ts`:
  - Schema-level: `position` ordering, cascade on `forwardedMessageId` delete, `set null` on `sourceMessageId` delete.

### 9.2 Backend e2e (gateway)

`forward.e2e-spec.ts` (under existing test harness):

- Create channels A, B; user member of both; post 3 messages in A; forward all 3 to B; assert WS broadcast to B subscribers; assert `GET /messages/:id` on the new forward returns hydrated `forward.items` length 3 with correct positions; assert `GET /forward-items` returns same.
- Forward a single image; assert no row is created in `im_message_attachments` for the new forward message; assert `attachmentsSnapshot[0].fileUrl` matches the original; assert downloading via that URL succeeds.
- Forward across channels you have read but not write on target → 403.
- Forward from channel you can't read → 403.
- Re-forward the resulting forward into channel C; assert chain depth 1 (no recursive expansion).
- Source message hard-deleted later: `forward-items` still renders snapshot, `canJumpToOriginal === false`.

### 9.3 Frontend unit

Each new component gets `__tests__/Component.test.tsx`:

- `ForwardDialog` — opens preselected, channel filter, confirm calls API, error toast on failure.
- `ForwardChannelList` — search filter, write-access filter, archived hidden.
- `ForwardedMessageCard` — single vs bundle branch, jump link visibility honors `canJumpToOriginal`, source-unavailable note.
- `ForwardBundleViewer` — fetches items lazily on open, handles 404, renders all positions in order.
- `forward-selection-store` — selection enter/exit, cap enforcement, channel-switch clears.
- `MessageContextMenu` — new items appear with right callbacks.
- `MessageHoverToolbar` — new icons appear, click handlers wired.
- `MessageList` — selection bar appears at the right time, Esc cancels.

### 9.4 Coverage gates

`pnpm --filter @team9/server test:cov` and `pnpm --filter @team9/client test:cov` must show 100% line + branch coverage for the new files. Files needing `coverage ignore` must be confirmed with the user (none expected).

## 10. Open Questions / Future Work

- **Multi-target send** — deferred. Adds N forward messages per call; trivial extension once V1 lands (loop the API on the client; or accept `targetChannelIds: string[]` server-side). Current shape is forward-compatible.
- **附言 (comment)** — deferred. Easiest extension: optional `comment` field on the request that becomes a separate sibling message immediately following the forward, posted in the same transaction. Or, change `messages.content` of the forward message itself to be the user's comment with the digest pushed to `metadata`. Decide at extension time.
- **Bundle viewer pagination** — V1 caps at 100 items, no pagination needed. If we ever raise the cap, paginate `GET /forward-items?cursor=`.
- **Permission decay** — if user A forwards channel X content to channel Y, and later user A is removed from X, the forward message in Y still shows the snapshot. This is intentional: snapshots are point-in-time and the user already had access when forwarding. Document in the UI footer of the bundle viewer if user feedback flags it.
- **Audit log** — should forwarding be recorded in `im_audit_logs`? Currently no — neither `pin`/`copy`/`reaction` are. If compliance later needs it, add a single audit row on `forward` per call (target + source ids).
