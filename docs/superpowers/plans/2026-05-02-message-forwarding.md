# Message Forwarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship single-message forward + multi-select bundle forward across the Team9 IM stack (gateway + im-worker contract + Tauri client) per [docs/superpowers/specs/2026-05-02-message-forwarding-design.md](../specs/2026-05-02-message-forwarding-design.md).

**Architecture:** New `im_message_forwards` table (one row per single, N rows per bundle) holding source pointers + content/attachment snapshots, joined to a new `messageType = 'forward'` row in `im_messages`. New REST endpoints under `/api/v1/im` for create + bundle-item fetch. Existing WS `MESSAGE.NEW` event is reused; clients dispatch on `type === 'forward'` to render quote / bundle cards. Multi-select mode is a per-channel Zustand store; entry from hover toolbar + right-click; floating action bar in `MessageList`.

**Tech Stack:** NestJS 11, Drizzle ORM (Postgres), Socket.io, Tauri 2 + React 19, TanStack Query, Zustand, Tailwind, Jest, Vitest.

---

## File map

**Server**

- Create `apps/server/libs/database/src/schemas/im/message-forwards.ts`
- Modify `apps/server/libs/database/src/schemas/im/messages.ts` (enum)
- Modify `apps/server/libs/database/src/schemas/im/index.ts` (re-export)
- Migration file auto-generated under `apps/server/libs/database/drizzle/`
- Modify `apps/server/apps/gateway/src/im/channels/channels.service.ts` + `.spec.ts` (`assertWriteAccess`)
- Create `apps/server/apps/gateway/src/im/messages/forwards/forwards.service.ts` + `.spec.ts`
- Create `apps/server/apps/gateway/src/im/messages/forwards/forwards.controller.ts` + `.spec.ts`
- Create `apps/server/apps/gateway/src/im/messages/forwards/dto/create-forward.dto.ts`
- Create `apps/server/apps/gateway/src/im/messages/forwards/types.ts` (response shapes)
- Modify `apps/server/apps/gateway/src/im/messages/messages.module.ts`
- Modify `apps/server/apps/gateway/src/im/messages/messages.service.ts` + `.spec.ts` (forward hydration)
- Modify `apps/server/apps/gateway/src/im/messages/messages.controller.ts` (use `assertWriteAccess`; reject PATCH on forward)
- Create `apps/server/apps/gateway/test/forward.e2e-spec.ts`

**Client**

- Modify `apps/client/src/types/im.ts` (`MessageType`, `ForwardPayload`)
- Modify `apps/client/src/services/api.ts` (forwardMessages, getForwardItems)
- Create `apps/client/src/stores/useForwardSelectionStore.ts` + `__tests__/useForwardSelectionStore.test.ts`
- Create `apps/client/src/components/channel/forward/ForwardDialog.tsx`
- Create `apps/client/src/components/channel/forward/ForwardChannelList.tsx`
- Create `apps/client/src/components/channel/forward/ForwardPreview.tsx` (single-quote + bundle preview)
- Create `apps/client/src/components/channel/forward/ForwardedMessageCard.tsx`
- Create `apps/client/src/components/channel/forward/ForwardBundleViewer.tsx`
- Create `apps/client/src/components/channel/forward/SelectionActionBar.tsx`
- Create `apps/client/src/components/channel/forward/__tests__/*.test.tsx` for each component
- Modify `apps/client/src/components/channel/MessageHoverToolbar.tsx`
- Modify `apps/client/src/components/channel/MessageContextMenu.tsx`
- Modify `apps/client/src/components/channel/MessageItem.tsx`
- Modify `apps/client/src/components/channel/MessageList.tsx`
- Modify `apps/client/src/components/channel/MessageContent.tsx`
- Modify `apps/client/src/i18n/locales/{en,zh-CN}/channel.json`

---

## Task 0: i18n strings

**Goal:** Add all `forward.*` keys to English + Simplified Chinese locale bundles. No code consumers yet — this lands first so subsequent tasks can reference final keys.

**Files:**

- Modify: `apps/client/src/i18n/locales/en/channel.json`
- Modify: `apps/client/src/i18n/locales/zh-CN/channel.json`

**Acceptance Criteria:**

- [ ] All keys from spec §2.5 present in both locale files
- [ ] JSON is well-formed (Prettier passes)
- [ ] No unrelated key changes

**Verify:** `pnpm --filter @team9/client lint` → no errors; `node -e "require('./apps/client/src/i18n/locales/en/channel.json')"` → no parse error.

**Steps:**

- [ ] **Step 1: Inspect current shape**

```bash
grep -c '"' apps/client/src/i18n/locales/en/channel.json
head -5 apps/client/src/i18n/locales/en/channel.json
```

Look at the existing top-level structure (flat keys vs. nested objects). Match what's there.

- [ ] **Step 2: Add forward namespace block to `en/channel.json`**

Insert at the end of the JSON object (or merge into existing structure):

```json
"forward": {
  "toolbar": {
    "forward": "Forward",
    "select": "Select"
  },
  "contextMenu": {
    "forward": "Forward",
    "select": "Select"
  },
  "dialog": {
    "titleSingle": "Forward message",
    "titleBundle": "Forward {{count}} messages",
    "searchPlaceholder": "Search channels…",
    "confirm": "Forward",
    "cancel": "Cancel"
  },
  "selection": {
    "bar": "{{count}} selected",
    "cancel": "Cancel"
  },
  "tooManySelected": "You can forward up to 100 messages at once.",
  "card": {
    "fromChannel": "Forwarded from #{{channelName}}"
  },
  "bundle": {
    "title": "Chat record · {{count}} messages",
    "viewAll": "View all",
    "modalTitle": "Chat record from #{{channelName}}"
  },
  "source": {
    "unavailable": "Source no longer available",
    "jumpTo": "Jump to original"
  },
  "error": {
    "notAllowed": "This message can't be forwarded.",
    "noWriteAccess": "You can't forward to this channel.",
    "noSourceAccess": "You no longer have access to the original channel.",
    "mixedChannels": "All selected messages must come from the same channel.",
    "empty": "Pick at least one message to forward.",
    "notFound": "Original message could not be found."
  }
}
```

- [ ] **Step 3: Add the same block to `zh-CN/channel.json`** with translations

```json
"forward": {
  "toolbar": { "forward": "转发", "select": "选择" },
  "contextMenu": { "forward": "转发", "select": "选择" },
  "dialog": {
    "titleSingle": "转发消息",
    "titleBundle": "转发 {{count}} 条消息",
    "searchPlaceholder": "搜索频道…",
    "confirm": "发送",
    "cancel": "取消"
  },
  "selection": { "bar": "已选 {{count}} 条", "cancel": "取消" },
  "tooManySelected": "一次最多转发 100 条消息",
  "card": { "fromChannel": "转自 #{{channelName}}" },
  "bundle": {
    "title": "聊天记录 · {{count}} 条",
    "viewAll": "查看全部",
    "modalTitle": "来自 #{{channelName}} 的聊天记录"
  },
  "source": { "unavailable": "原消息已不可访问", "jumpTo": "跳转到原消息" },
  "error": {
    "notAllowed": "此消息不可转发",
    "noWriteAccess": "你没有该频道的发送权限",
    "noSourceAccess": "你已无法访问原频道",
    "mixedChannels": "多选转发的消息必须来自同一频道",
    "empty": "请至少选择一条消息进行转发",
    "notFound": "找不到原消息"
  }
}
```

- [ ] **Step 4: Verify both files parse**

```bash
node -e "JSON.parse(require('fs').readFileSync('apps/client/src/i18n/locales/en/channel.json','utf8'))"
node -e "JSON.parse(require('fs').readFileSync('apps/client/src/i18n/locales/zh-CN/channel.json','utf8'))"
```

Expected: both commands exit 0 silently.

- [ ] **Step 5: Run client lint**

```bash
pnpm --filter @team9/client lint
```

Expected: PASS (or no new errors vs. pre-change baseline).

- [ ] **Step 6: Commit**

```bash
git add apps/client/src/i18n/locales/en/channel.json apps/client/src/i18n/locales/zh-CN/channel.json
git commit -m "feat(im): add forward.* i18n strings for en + zh-CN"
```

---

## Task 1: DB schema — `forward` enum value + `im_message_forwards` table

**Goal:** Land the schema and migration for forward storage. After this task, the table exists in the dev DB and the enum has the new value, but no code uses them yet.

**Files:**

- Modify: `apps/server/libs/database/src/schemas/im/messages.ts`
- Create: `apps/server/libs/database/src/schemas/im/message-forwards.ts`
- Modify: `apps/server/libs/database/src/schemas/im/index.ts`
- Generated: `apps/server/libs/database/drizzle/<NNNN>_<name>.sql` (drizzle output)
- Test: `apps/server/libs/database/src/schemas/im/message-forwards.spec.ts`

**Acceptance Criteria:**

- [ ] `messageTypeEnum` includes `'forward'` as the last value (preserves existing ordinals).
- [ ] `messageForwards` table compiles with the exact columns + indexes from spec §3.2.
- [ ] `pnpm db:generate` produces a single forward-only migration; `pnpm db:migrate` applies it cleanly to a fresh DB.
- [ ] Schema unit test verifies `position`, FK actions, and the cascade behavior on `forwardedMessageId` delete.

**Verify:**

```bash
pnpm db:generate                                # should produce ONE new SQL file
pnpm --filter @team9/database test               # spec passes
```

**Steps:**

- [ ] **Step 1: Extend the enum**

Edit `apps/server/libs/database/src/schemas/im/messages.ts:16-23`:

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

- [ ] **Step 2: Create the schema file**

Create `apps/server/libs/database/src/schemas/im/message-forwards.ts`:

```ts
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
  originalAttachmentId: string;
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
    forwardedMessageId: uuid("forwarded_message_id")
      .references(() => messages.id, { onDelete: "cascade" })
      .notNull(),
    position: integer("position").notNull(),
    sourceMessageId: uuid("source_message_id").references(() => messages.id, {
      onDelete: "set null",
    }),
    sourceChannelId: uuid("source_channel_id")
      .references(() => channels.id)
      .notNull(),
    sourceWorkspaceId: uuid("source_workspace_id").references(
      () => tenants.id,
      { onDelete: "set null" },
    ),
    sourceSenderId: uuid("source_sender_id").references(() => users.id, {
      onDelete: "set null",
    }),
    sourceCreatedAt: timestamp("source_created_at").notNull(),
    sourceSeqId: bigint("source_seq_id", { mode: "bigint" }),
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

- [ ] **Step 3: Re-export from the IM schema index**

Edit `apps/server/libs/database/src/schemas/im/index.ts` — add the line in alphabetical order with the other exports:

```ts
export * from "./message-forwards.js";
```

- [ ] **Step 4: Generate the migration**

```bash
pnpm db:generate
```

Expected: one new file under `apps/server/libs/database/drizzle/` (the next sequential number) containing:

- `ALTER TYPE "message_type" ADD VALUE 'forward';`
- `CREATE TABLE "im_message_forwards" (...);`
- The four `CREATE INDEX` statements.

Inspect the file. If drizzle splits the enum alter and the table create into separate files, that's fine — they must apply in order.

- [ ] **Step 5: Apply the migration locally**

```bash
pnpm db:migrate
```

Expected: clean apply, no errors. Verify in psql:

```bash
psql "$DATABASE_URL" -c "\d im_message_forwards"
psql "$DATABASE_URL" -c "SELECT unnest(enum_range(NULL::message_type));"
```

Expected: table present with all columns; enum includes `forward`.

- [ ] **Step 6: Write the schema spec**

Create `apps/server/libs/database/src/schemas/im/message-forwards.spec.ts`. Mirror the style of `message-relations.spec.ts` (read it first for harness conventions):

```ts
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { setupTestDb, teardownTestDb, type TestDb } from "../../test-utils.js";
import { messageForwards } from "./message-forwards.js";
import { messages } from "./messages.js";
import { channels } from "./channels.js";
import { users } from "./users.js";

describe("im_message_forwards schema", () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await teardownTestDb(db);
  });

  async function seedChannelAndUser() {
    const userId = uuidv7();
    const channelId = uuidv7();
    await db.client.insert(users).values({
      id: userId,
      username: `u-${userId}`,
      displayName: "U",
      email: `${userId}@x.test`,
      passwordHash: "x",
    });
    await db.client.insert(channels).values({
      id: channelId,
      name: "src",
      type: "public",
      createdBy: userId,
    });
    return { userId, channelId };
  }

  async function seedMessage(channelId: string, senderId: string) {
    const id = uuidv7();
    await db.client.insert(messages).values({
      id,
      channelId,
      senderId,
      content: "hi",
      type: "text",
    });
    return id;
  }

  it("inserts a single forward row with position 0", async () => {
    const { userId, channelId } = await seedChannelAndUser();
    const sourceId = await seedMessage(channelId, userId);
    const forwardMsgId = await seedMessage(channelId, userId);
    await db.client
      .update(messages)
      .set({ type: "forward" })
      .where(sql`${messages.id} = ${forwardMsgId}`);
    const [row] = await db.client
      .insert(messageForwards)
      .values({
        forwardedMessageId: forwardMsgId,
        position: 0,
        sourceMessageId: sourceId,
        sourceChannelId: channelId,
        sourceSenderId: userId,
        sourceCreatedAt: new Date(),
        contentSnapshot: "hi",
        sourceType: "text",
      })
      .returning();
    expect(row.position).toBe(0);
    expect(row.sourceMessageId).toBe(sourceId);
  });

  it("cascades on forwarded_message delete", async () => {
    const { userId, channelId } = await seedChannelAndUser();
    const sourceId = await seedMessage(channelId, userId);
    const fwdId = await seedMessage(channelId, userId);
    await db.client
      .update(messages)
      .set({ type: "forward" })
      .where(sql`${messages.id} = ${fwdId}`);
    await db.client.insert(messageForwards).values({
      forwardedMessageId: fwdId,
      position: 0,
      sourceMessageId: sourceId,
      sourceChannelId: channelId,
      sourceSenderId: userId,
      sourceCreatedAt: new Date(),
      sourceType: "text",
    });
    await db.client.delete(messages).where(sql`${messages.id} = ${fwdId}`);
    const remaining = await db.client
      .select()
      .from(messageForwards)
      .where(sql`${messageForwards.forwardedMessageId} = ${fwdId}`);
    expect(remaining).toHaveLength(0);
  });

  it("sets sourceMessageId NULL when source is deleted", async () => {
    const { userId, channelId } = await seedChannelAndUser();
    const sourceId = await seedMessage(channelId, userId);
    const fwdId = await seedMessage(channelId, userId);
    await db.client
      .update(messages)
      .set({ type: "forward" })
      .where(sql`${messages.id} = ${fwdId}`);
    await db.client.insert(messageForwards).values({
      forwardedMessageId: fwdId,
      position: 0,
      sourceMessageId: sourceId,
      sourceChannelId: channelId,
      sourceSenderId: userId,
      sourceCreatedAt: new Date(),
      sourceType: "text",
    });
    await db.client.delete(messages).where(sql`${messages.id} = ${sourceId}`);
    const [row] = await db.client
      .select()
      .from(messageForwards)
      .where(sql`${messageForwards.forwardedMessageId} = ${fwdId}`);
    expect(row.sourceMessageId).toBeNull();
    expect(row.sourceChannelId).toBe(channelId); // denorm survives
  });

  it("rejects insert when sourceChannelId is null", async () => {
    const { userId, channelId } = await seedChannelAndUser();
    const fwdId = await seedMessage(channelId, userId);
    await db.client
      .update(messages)
      .set({ type: "forward" })
      .where(sql`${messages.id} = ${fwdId}`);
    await expect(
      db.client.insert(messageForwards).values({
        forwardedMessageId: fwdId,
        position: 0,
        sourceChannelId: null as unknown as string,
        sourceCreatedAt: new Date(),
        sourceType: "text",
      }),
    ).rejects.toThrow();
  });
});
```

If `setupTestDb`/`teardownTestDb` helpers don't exist in this repo, **first** check `apps/server/libs/database/src/` for the existing test bootstrap pattern (e.g. a Testcontainers wrapper used by `message-relations.spec.ts`) and adapt the imports accordingly. Do not invent a parallel harness — use what's there.

- [ ] **Step 7: Run the schema spec**

```bash
pnpm --filter @team9/database test -- message-forwards
```

Expected: 4 specs pass.

- [ ] **Step 8: Commit**

```bash
git add apps/server/libs/database/src/schemas/im/messages.ts \
        apps/server/libs/database/src/schemas/im/message-forwards.ts \
        apps/server/libs/database/src/schemas/im/index.ts \
        apps/server/libs/database/src/schemas/im/message-forwards.spec.ts \
        apps/server/libs/database/drizzle/
git commit -m "feat(db): add im_message_forwards table and 'forward' message type"
```

---

## Task 2: `ChannelsService.assertWriteAccess`

**Goal:** Extract the inline write-access checks currently buried inside `MessagesController.createChannelMessage` into a reusable `assertWriteAccess(channelId, userId)` method on `ChannelsService`. Refactor the existing call site to use it. After this, both `createMessage` and (later) `forward` share one path for "can this user post here right now".

**Files:**

- Modify: `apps/server/apps/gateway/src/im/channels/channels.service.ts`
- Modify: `apps/server/apps/gateway/src/im/channels/channels.service.spec.ts`
- Modify: `apps/server/apps/gateway/src/im/messages/messages.controller.ts`
- Modify: `apps/server/apps/gateway/src/im/messages/messages.controller.spec.ts` (if existing tests cover the rejection paths)

**Acceptance Criteria:**

- [ ] `assertWriteAccess` throws `ForbiddenException('forward.noWriteAccess')`-equivalent string when user is not a member.
- [ ] Throws when channel `isArchived` (`'Channel is archived ...'`).
- [ ] Throws when channel `isActivated === false` (`'Channel is deactivated ...'`).
- [ ] Existing `createChannelMessage` flow still works (regression: existing controller spec passes).
- [ ] New unit tests cover happy + each rejection branch.

**Verify:**

```bash
pnpm --filter @team9/server test -- channels.service
pnpm --filter @team9/server test -- messages.controller
```

Both expected to pass.

**Steps:**

- [ ] **Step 1: Read existing logic and decide error strings**

Read `apps/server/apps/gateway/src/im/messages/messages.controller.ts:78-114` for the four current rejection strings (`'Access denied'`, `'Channel is deactivated — execution has completed'`, `'Channel is archived and no longer accepts new messages'`). Keep the **same human-readable strings** to avoid breaking any client that parses them — we are refactoring, not redesigning the messages.

- [ ] **Step 2: Add `assertWriteAccess` to `ChannelsService`**

In `apps/server/apps/gateway/src/im/channels/channels.service.ts`, immediately after `assertReadAccess` (around line 1792), add:

```ts
/**
 * Asserts the user can post a new message to this channel.
 * Throws ForbiddenException with the same human-readable strings the
 * messages controller has been throwing inline since the project started.
 */
async assertWriteAccess(channelId: string, userId: string): Promise<void> {
  const isMember = await this.isMember(channelId, userId);
  if (!isMember) {
    throw new ForbiddenException('Access denied');
  }
  const channel = await this.findById(channelId);
  if (!channel) {
    throw new ForbiddenException('Access denied');
  }
  if (!channel.isActivated) {
    throw new ForbiddenException(
      'Channel is deactivated — execution has completed',
    );
  }
  if (channel.isArchived) {
    throw new ForbiddenException(
      'Channel is archived and no longer accepts new messages',
    );
  }
}
```

If `ForbiddenException` is not yet imported in this file, add it to the existing `@nestjs/common` import line.

- [ ] **Step 3: Refactor `createChannelMessage`**

In `apps/server/apps/gateway/src/im/messages/messages.controller.ts:85-114`, replace:

```ts
const isMember = await this.channelsService.isMember(channelId, userId);
const t1 = Date.now();

if (!isMember) {
  throw new ForbiddenException("Access denied");
}

const clientMsgId = dto.clientMsgId || uuidv7();

const channel = await this.channelsService.findById(channelId);
const t2 = Date.now();
const workspaceId = channel?.tenantId ?? undefined;

if (channel && !channel.isActivated) {
  throw new ForbiddenException(
    "Channel is deactivated — execution has completed",
  );
}

if (channel && channel.isArchived) {
  throw new ForbiddenException(
    "Channel is archived and no longer accepts new messages",
  );
}
```

with:

```ts
await this.channelsService.assertWriteAccess(channelId, userId);
const t1 = Date.now();

const clientMsgId = dto.clientMsgId || uuidv7();

const channel = await this.channelsService.findById(channelId);
const t2 = Date.now();
const workspaceId = channel?.tenantId ?? undefined;
```

The two timing markers `t1`/`t2` are preserved (they feed the existing slow-log warning). Note the `channel` lookup remains because the rest of the function uses `workspaceId`, `channel.type`, etc.

- [ ] **Step 4: Add unit tests**

Append to `apps/server/apps/gateway/src/im/channels/channels.service.spec.ts` (after the `assertReadAccess` describe block):

```ts
describe("assertWriteAccess", () => {
  it("passes for member of an active, non-archived channel", async () => {
    mockIsMember.mockResolvedValueOnce(true);
    mockFindById.mockResolvedValueOnce({
      id: "ch-1",
      isActivated: true,
      isArchived: false,
    } as Channel);
    await expect(
      service.assertWriteAccess("ch-1", "u-1"),
    ).resolves.toBeUndefined();
  });

  it("throws for non-member", async () => {
    mockIsMember.mockResolvedValueOnce(false);
    await expect(service.assertWriteAccess("ch-1", "u-1")).rejects.toThrow(
      "Access denied",
    );
  });

  it("throws when channel not found", async () => {
    mockIsMember.mockResolvedValueOnce(true);
    mockFindById.mockResolvedValueOnce(null);
    await expect(service.assertWriteAccess("ch-1", "u-1")).rejects.toThrow(
      "Access denied",
    );
  });

  it("throws for deactivated channel", async () => {
    mockIsMember.mockResolvedValueOnce(true);
    mockFindById.mockResolvedValueOnce({
      id: "ch-1",
      isActivated: false,
      isArchived: false,
    } as Channel);
    await expect(service.assertWriteAccess("ch-1", "u-1")).rejects.toThrow(
      "deactivated",
    );
  });

  it("throws for archived channel", async () => {
    mockIsMember.mockResolvedValueOnce(true);
    mockFindById.mockResolvedValueOnce({
      id: "ch-1",
      isActivated: true,
      isArchived: true,
    } as Channel);
    await expect(service.assertWriteAccess("ch-1", "u-1")).rejects.toThrow(
      "archived",
    );
  });
});
```

Reuse whatever mocks (`mockIsMember`, `mockFindById`, etc.) the existing `assertReadAccess` describe block uses — read it first to match the pattern. If the spec uses `jest.spyOn(service, 'isMember')` instead of mock variables, follow that style.

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @team9/server test -- channels.service
pnpm --filter @team9/server test -- messages.controller
```

Expected: all pass, including the new `assertWriteAccess` describe block.

- [ ] **Step 6: Commit**

```bash
git add apps/server/apps/gateway/src/im/channels/channels.service.ts \
        apps/server/apps/gateway/src/im/channels/channels.service.spec.ts \
        apps/server/apps/gateway/src/im/messages/messages.controller.ts
git commit -m "refactor(im): extract assertWriteAccess into ChannelsService"
```

---

## Task 3: `ForwardsService` — core business logic

**Goal:** Build the service that takes `(targetChannelId, sourceChannelId, sourceMessageIds, userId)`, validates everything, builds the snapshot rows, creates the new `forward`-type message via the existing `imWorkerGrpcClientService.createMessage` path, and inserts the `im_message_forwards` rows. Includes `getForwardItems(messageId, userId)` for the bundle-viewer endpoint and a `hydrateForward(messageId)` helper consumed by `MessagesService` in Task 5.

**Files:**

- Create: `apps/server/apps/gateway/src/im/messages/forwards/forwards.service.ts`
- Create: `apps/server/apps/gateway/src/im/messages/forwards/forwards.service.spec.ts`
- Create: `apps/server/apps/gateway/src/im/messages/forwards/types.ts`

**Acceptance Criteria:**

- [ ] `forward()` happy paths: single text, single image (with attachment), single long_text, single forward (re-forward), bundle of 5 mixed types — all return a `MessageResponse` with `type === 'forward'` and `forward.items.length === N`.
- [ ] Rejection paths return the right error codes from spec §4.5: empty, >100, mixed channels, disallowed type, streaming, not found.
- [ ] On forward-row insert failure the new message is soft-deleted and a 500 (`InternalServerErrorException`) is thrown.
- [ ] `getForwardItems(messageId, userId)` enforces read access on the forward message's channel and returns ordered `ForwardItemResponse[]`.
- [ ] Snapshot truncation: when source `content` exceeds 100k chars, snapshot is truncated and `truncated: true` is set on both the row and `metadata.forward.truncated`.
- [ ] No row is inserted in `im_message_attachments` for the forward message; attachments live only in `attachmentsSnapshot`.
- [ ] 100% line + branch coverage for `forwards.service.ts`.

**Verify:**

```bash
pnpm --filter @team9/server test -- forwards.service --coverage
```

Coverage report shows 100/100 for the new file.

**Steps:**

- [ ] **Step 1: Write the response/types module first**

Create `apps/server/apps/gateway/src/im/messages/forwards/types.ts`:

```ts
import type { ForwardAttachmentSnapshot } from "@team9/database";

export type ForwardKind = "single" | "bundle";

export interface ForwardSourceUser {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface ForwardItemResponse {
  position: number;
  sourceMessageId: string | null;
  sourceChannelId: string;
  sourceChannelName: string | null;
  sourceWorkspaceId: string | null;
  sourceSender: ForwardSourceUser | null;
  sourceCreatedAt: string;
  sourceSeqId: string | null;
  sourceType: "text" | "long_text" | "file" | "image" | "forward";
  contentSnapshot: string | null;
  contentAstSnapshot: Record<string, unknown> | null;
  attachmentsSnapshot: ForwardAttachmentSnapshot[];
  canJumpToOriginal: boolean;
  truncated: boolean;
}

export interface ForwardPayload {
  kind: ForwardKind;
  count: number;
  sourceChannelId: string;
  sourceChannelName: string | null;
  truncated: boolean;
  items: ForwardItemResponse[];
}

export interface ForwardMetadata {
  kind: ForwardKind;
  count: number;
  sourceChannelId: string;
  sourceChannelName: string;
  truncated?: boolean;
}

export const FORWARD_CONTENT_SNAPSHOT_LIMIT = 100_000;
export const FORWARD_BUNDLE_LIMIT = 100;
export const FORWARDABLE_SOURCE_TYPES = new Set([
  "text",
  "long_text",
  "file",
  "image",
  "forward",
]);
```

- [ ] **Step 2: Write failing service skeleton + first test**

Create `apps/server/apps/gateway/src/im/messages/forwards/forwards.service.ts` (stub) and `forwards.service.spec.ts`. Start with the test for "rejects empty selection":

```ts
// forwards.service.spec.ts
import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { ForwardsService } from "./forwards.service.js";
import { ChannelsService } from "../../channels/channels.service.js";
import { MessagesService } from "../messages.service.js";
import { ImWorkerGrpcClientService } from "../../services/im-worker-grpc-client.service.js";
import { DatabaseService } from "@team9/database";

describe("ForwardsService", () => {
  let service: ForwardsService;
  let channels: jest.Mocked<ChannelsService>;
  let messages: jest.Mocked<MessagesService>;
  let grpc: jest.Mocked<ImWorkerGrpcClientService>;
  let db: jest.Mocked<DatabaseService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ForwardsService,
        {
          provide: ChannelsService,
          useValue: {
            assertReadAccess: jest.fn(),
            assertWriteAccess: jest.fn(),
            findById: jest.fn(),
          },
        },
        {
          provide: MessagesService,
          useValue: {
            findManyByIds: jest.fn(),
            getMessageWithDetails: jest.fn(),
            softDelete: jest.fn(),
            truncateForPreview: jest.fn((m) => m),
            getAttachmentsForMessages: jest.fn(),
          },
        },
        {
          provide: ImWorkerGrpcClientService,
          useValue: { createMessage: jest.fn() },
        },
        {
          provide: DatabaseService,
          useValue: {
            db: {
              insert: jest
                .fn()
                .mockReturnValue({ values: jest.fn().mockResolvedValue([]) }),
            },
          },
        },
      ],
    }).compile();
    service = module.get(ForwardsService);
    channels = module.get(ChannelsService);
    messages = module.get(MessagesService);
    grpc = module.get(ImWorkerGrpcClientService);
    db = module.get(DatabaseService);
  });

  it("rejects empty sourceMessageIds", async () => {
    await expect(
      service.forward({
        targetChannelId: "ch-target",
        sourceChannelId: "ch-src",
        sourceMessageIds: [],
        userId: "u-1",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
```

Run:

```bash
pnpm --filter @team9/server test -- forwards.service
```

Expected: FAIL with "ForwardsService is not defined" (or similar).

- [ ] **Step 3: Implement the service**

Create the full `forwards.service.ts`:

```ts
import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  ForbiddenException,
  Inject,
  forwardRef,
} from "@nestjs/common";
import { v7 as uuidv7 } from "uuid";
import { sql, inArray, eq } from "drizzle-orm";
import {
  DatabaseService,
  messageForwards,
  messages as messagesTable,
  type ForwardAttachmentSnapshot,
  type NewMessageForward,
} from "@team9/database";
import { ChannelsService } from "../../channels/channels.service.js";
import { MessagesService, type MessageResponse } from "../messages.service.js";
import { ImWorkerGrpcClientService } from "../../services/im-worker-grpc-client.service.js";
import {
  FORWARD_BUNDLE_LIMIT,
  FORWARD_CONTENT_SNAPSHOT_LIMIT,
  FORWARDABLE_SOURCE_TYPES,
  type ForwardItemResponse,
  type ForwardKind,
  type ForwardMetadata,
  type ForwardPayload,
} from "./types.js";

interface ForwardInput {
  targetChannelId: string;
  sourceChannelId: string;
  sourceMessageIds: string[];
  clientMsgId?: string;
  userId: string;
}

@Injectable()
export class ForwardsService {
  private readonly logger = new Logger(ForwardsService.name);

  constructor(
    private readonly channelsService: ChannelsService,
    @Inject(forwardRef(() => MessagesService))
    private readonly messagesService: MessagesService,
    private readonly grpc: ImWorkerGrpcClientService,
    private readonly databaseService: DatabaseService,
  ) {}

  async forward(input: ForwardInput): Promise<MessageResponse> {
    const { targetChannelId, sourceChannelId, sourceMessageIds, userId } =
      input;

    if (sourceMessageIds.length === 0) {
      throw new BadRequestException("forward.empty");
    }
    if (sourceMessageIds.length > FORWARD_BUNDLE_LIMIT) {
      throw new BadRequestException("forward.tooManySelected");
    }

    await this.channelsService
      .assertReadAccess(sourceChannelId, userId)
      .catch((e) => {
        throw new ForbiddenException("forward.noSourceAccess");
      });
    await this.channelsService
      .assertWriteAccess(targetChannelId, userId)
      .catch((e) => {
        throw new ForbiddenException("forward.noWriteAccess");
      });

    const sourceMessages =
      await this.messagesService.findManyByIds(sourceMessageIds);
    if (sourceMessages.length !== sourceMessageIds.length) {
      throw new NotFoundException("forward.notFound");
    }
    for (const m of sourceMessages) {
      if (m.channelId !== sourceChannelId)
        throw new BadRequestException("forward.mixedChannels");
      if (m.isDeleted) throw new BadRequestException("forward.notAllowed");
      if (!FORWARDABLE_SOURCE_TYPES.has(m.type))
        throw new BadRequestException("forward.notAllowed");
      const meta = (m.metadata ?? {}) as Record<string, unknown>;
      if (meta.streaming === true)
        throw new BadRequestException("forward.notAllowed");
    }

    const ordered = sourceMessageIds.map((id) => {
      const m = sourceMessages.find((s) => s.id === id);
      if (!m) throw new NotFoundException("forward.notFound");
      return m;
    });

    const attachmentsByMessage =
      await this.messagesService.getAttachmentsForMessages(
        ordered.map((m) => m.id),
      );

    const sourceChannel = await this.channelsService.findById(sourceChannelId);
    const sourceChannelName = sourceChannel?.name ?? null;

    const kind: ForwardKind = ordered.length === 1 ? "single" : "bundle";

    const items: Array<{ row: NewMessageForward; truncated: boolean }> =
      ordered.map((m, position) => {
        const attachments = (attachmentsByMessage.get(m.id) ?? []).map(
          (a): ForwardAttachmentSnapshot => ({
            originalAttachmentId: a.id,
            fileName: a.fileName,
            fileUrl: a.fileUrl,
            fileKey: a.fileKey,
            fileSize: a.fileSize,
            mimeType: a.mimeType,
            thumbnailUrl: a.thumbnailUrl,
            width: a.width,
            height: a.height,
          }),
        );

        let snapshot = m.content ?? null;
        let truncated = false;
        if (snapshot && snapshot.length > FORWARD_CONTENT_SNAPSHOT_LIMIT) {
          snapshot = snapshot.slice(0, FORWARD_CONTENT_SNAPSHOT_LIMIT);
          truncated = true;
        }

        return {
          truncated,
          row: {
            forwardedMessageId: "__placeholder__", // patched after createMessage
            position,
            sourceMessageId: m.id,
            sourceChannelId,
            sourceWorkspaceId: sourceChannel?.tenantId ?? null,
            sourceSenderId: m.senderId,
            sourceCreatedAt: m.createdAt,
            sourceSeqId: m.seqId ?? null,
            contentSnapshot: snapshot,
            contentAstSnapshot:
              (m.contentAst as Record<string, unknown> | null) ?? null,
            attachmentsSnapshot: attachments,
            sourceType: m.type,
          },
        };
      });

    const anyTruncated = items.some((i) => i.truncated);
    const digest = this.buildDigest(kind, ordered, sourceChannelName);
    const metadataForward: ForwardMetadata = {
      kind,
      count: ordered.length,
      sourceChannelId,
      sourceChannelName: sourceChannelName ?? "",
      ...(anyTruncated && { truncated: true }),
    };

    const targetChannel = await this.channelsService.findById(targetChannelId);
    const created = await this.grpc.createMessage({
      clientMsgId: input.clientMsgId ?? uuidv7(),
      channelId: targetChannelId,
      senderId: userId,
      content: digest,
      contentAst: undefined,
      type: "forward",
      workspaceId: targetChannel?.tenantId ?? undefined,
      attachments: undefined,
      metadata: { forward: metadataForward },
    });

    const forwardedMessageId = created.msgId;
    try {
      await this.databaseService.db
        .insert(messageForwards)
        .values(items.map((i) => ({ ...i.row, forwardedMessageId })));
    } catch (err) {
      this.logger.error(
        `Failed to insert forward rows for ${forwardedMessageId}: ${String(err)}`,
      );
      await this.messagesService.softDelete(forwardedMessageId, userId);
      throw new InternalServerErrorException("forward.insertFailed");
    }

    const message =
      await this.messagesService.getMessageWithDetails(forwardedMessageId);
    return this.messagesService.truncateForPreview(message);
  }

  async getForwardItems(
    forwardedMessageId: string,
    userId: string,
  ): Promise<ForwardItemResponse[]> {
    const channelId =
      await this.messagesService.getMessageChannelId(forwardedMessageId);
    await this.channelsService.assertReadAccess(channelId, userId);
    return this.hydrate(forwardedMessageId, userId);
  }

  async hydrate(
    forwardedMessageId: string,
    userId: string,
  ): Promise<ForwardItemResponse[]> {
    const rows = await this.databaseService.db
      .select()
      .from(messageForwards)
      .where(eq(messageForwards.forwardedMessageId, forwardedMessageId))
      .orderBy(messageForwards.position);
    if (rows.length === 0) return [];

    const distinctChannelIds = Array.from(
      new Set(rows.map((r) => r.sourceChannelId)),
    );
    const distinctSenderIds = Array.from(
      new Set(
        rows.map((r) => r.sourceSenderId).filter((x): x is string => !!x),
      ),
    );
    const distinctSourceMsgIds = rows
      .map((r) => r.sourceMessageId)
      .filter((x): x is string => !!x);

    const [channels, senders, liveSources] = await Promise.all([
      this.channelsService.findManyByIds(distinctChannelIds),
      this.messagesService.findUsersByIds(distinctSenderIds),
      distinctSourceMsgIds.length
        ? this.messagesService.findManyByIds(distinctSourceMsgIds)
        : Promise.resolve([]),
    ]);
    const channelMap = new Map(channels.map((c) => [c.id, c]));
    const senderMap = new Map(senders.map((u) => [u.id, u]));
    const liveSourceIds = new Set(
      liveSources.filter((m) => !m.isDeleted).map((m) => m.id),
    );

    const accessByChannel = new Map<string, boolean>();
    await Promise.all(
      distinctChannelIds.map(async (cid) => {
        const ok = await this.channelsService.canRead(cid, userId);
        accessByChannel.set(cid, ok);
      }),
    );

    return rows.map((r): ForwardItemResponse => {
      const ch = channelMap.get(r.sourceChannelId);
      const sender = r.sourceSenderId ? senderMap.get(r.sourceSenderId) : null;
      const userCanReadSource = accessByChannel.get(r.sourceChannelId) ?? false;
      const sourceStillExists =
        !!r.sourceMessageId && liveSourceIds.has(r.sourceMessageId);
      const truncated =
        !!r.contentSnapshot &&
        r.contentSnapshot.length === FORWARD_CONTENT_SNAPSHOT_LIMIT;

      return {
        position: r.position,
        sourceMessageId: r.sourceMessageId,
        sourceChannelId: r.sourceChannelId,
        sourceChannelName: userCanReadSource ? (ch?.name ?? null) : null,
        sourceWorkspaceId: r.sourceWorkspaceId,
        sourceSender: sender
          ? {
              id: sender.id,
              username: sender.username,
              displayName: sender.displayName,
              avatarUrl: sender.avatarUrl ?? null,
            }
          : null,
        sourceCreatedAt: r.sourceCreatedAt.toISOString(),
        sourceSeqId: r.sourceSeqId !== null ? r.sourceSeqId.toString() : null,
        sourceType: r.sourceType as ForwardItemResponse["sourceType"],
        contentSnapshot: r.contentSnapshot,
        contentAstSnapshot: r.contentAstSnapshot,
        attachmentsSnapshot: r.attachmentsSnapshot ?? [],
        canJumpToOriginal: sourceStillExists && userCanReadSource,
        truncated,
      };
    });
  }

  async hydratePayload(
    forwardedMessageId: string,
    userId: string,
    metadataForward: ForwardMetadata,
  ): Promise<ForwardPayload> {
    const items = await this.hydrate(forwardedMessageId, userId);
    return {
      kind: metadataForward.kind,
      count: metadataForward.count,
      sourceChannelId: metadataForward.sourceChannelId,
      sourceChannelName: metadataForward.sourceChannelName || null,
      truncated: metadataForward.truncated ?? items.some((i) => i.truncated),
      items,
    };
  }

  private buildDigest(
    kind: ForwardKind,
    sources: { content: string | null; senderId: string | null }[],
    channelName: string | null,
  ): string {
    if (kind === "single") {
      const m = sources[0];
      const head = (m.content ?? "").slice(0, 200);
      return `[Forwarded] ${head}`;
    }
    const previews = sources
      .slice(0, 3)
      .map((m) => (m.content ?? "").slice(0, 80))
      .join("; ");
    return `[Forwarded chat record · ${sources.length} messages from #${channelName ?? "channel"}] ${previews}`;
  }
}
```

Note: this depends on three small new helpers on `MessagesService` (`findManyByIds`, `getAttachmentsForMessages`, `findUsersByIds`, `softDelete`, `getMessageChannelId`) and one on `ChannelsService` (`canRead`, `findManyByIds`). Some of those already exist (e.g. `getMessageChannelId`). Add the missing ones in this same task — they're trivial wrappers. After writing the service, scan it for any calls that don't exist yet and add minimal implementations to the corresponding services with no behavior change risk (each helper is a thin DB query). Each new helper should also gain a one-line spec assertion in the corresponding existing `*.service.spec.ts` for coverage.

- [ ] **Step 4: Expand the spec to cover every branch**

In `forwards.service.spec.ts`, add `describe` blocks for each scenario in the Acceptance Criteria. Use the same Test module pattern from Step 2. For each test, set up the mocks to drive the target branch and assert either the resolved `MessageResponse` shape or the rejection. Cover, at minimum:

- empty selection → `BadRequestException('forward.empty')`
- `sourceMessageIds.length > 100` → `BadRequestException('forward.tooManySelected')`
- mixed source channels → `BadRequestException('forward.mixedChannels')`
- disallowed type (`system`) → `BadRequestException('forward.notAllowed')`
- streaming source → `BadRequestException('forward.notAllowed')`
- isDeleted source → `BadRequestException('forward.notAllowed')`
- missing source → `NotFoundException('forward.notFound')`
- read-access missing → `ForbiddenException('forward.noSourceAccess')`
- write-access missing → `ForbiddenException('forward.noWriteAccess')`
- single happy path: text, image (with one attachment in `attachmentsByMessage`), long_text, re-forward (`type === 'forward'`)
- bundle of 5 mixed types — assert positions 0..4, `kind === 'bundle'`, `count === 5`
- snapshot truncation when `content.length > 100_000`
- forward-row insert failure → `softDelete` is called and `InternalServerErrorException` is thrown
- `getForwardItems` enforces read access; returns ordered items
- `hydrate` builds `canJumpToOriginal === false` when source is hard-deleted, and `false` when user has no access to source channel
- `hydrate` returns `[]` for an unknown id

For attachments, assert that `grpc.createMessage` is called with `attachments: undefined` (the forward message owns no attachment rows).

- [ ] **Step 5: Run with coverage**

```bash
pnpm --filter @team9/server test -- forwards.service --coverage --collectCoverageFrom='**/forwards/**'
```

Expected: 100% line + branch on `forwards.service.ts` and `types.ts`. Iterate until each red branch has a test.

- [ ] **Step 6: Commit**

```bash
git add apps/server/apps/gateway/src/im/messages/forwards/ \
        apps/server/apps/gateway/src/im/channels/channels.service.ts \
        apps/server/apps/gateway/src/im/messages/messages.service.ts
git commit -m "feat(im): add ForwardsService with snapshot capture and hydration"
```

---

## Task 4: `ForwardsController` — REST endpoints

**Goal:** Expose `POST /api/v1/im/channels/:targetChannelId/forward` and `GET /api/v1/im/messages/:id/forward-items`. Wire the controller into `MessagesModule`.

**Files:**

- Create: `apps/server/apps/gateway/src/im/messages/forwards/forwards.controller.ts`
- Create: `apps/server/apps/gateway/src/im/messages/forwards/forwards.controller.spec.ts`
- Create: `apps/server/apps/gateway/src/im/messages/forwards/dto/create-forward.dto.ts`
- Modify: `apps/server/apps/gateway/src/im/messages/messages.module.ts`

**Acceptance Criteria:**

- [ ] `POST` accepts `{ sourceChannelId, sourceMessageIds, clientMsgId? }`, returns the new `MessageResponse`.
- [ ] DTO validation rejects non-UUID strings, missing fields, `sourceMessageIds.length === 0` (class-validator).
- [ ] `GET /messages/:id/forward-items` returns the full `ForwardItemResponse[]`.
- [ ] Both endpoints guarded by `AuthGuard` and pull `userId` via `@CurrentUser('sub')`.
- [ ] Controller spec covers happy + each error path mirrored from the service.

**Verify:**

```bash
pnpm --filter @team9/server test -- forwards.controller
```

**Steps:**

- [ ] **Step 1: Write the DTO**

Create `apps/server/apps/gateway/src/im/messages/forwards/dto/create-forward.dto.ts`:

```ts
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
} from "class-validator";

export class CreateForwardDto {
  @IsUUID()
  sourceChannelId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID("all", { each: true })
  sourceMessageIds!: string[];

  @IsOptional()
  @IsString()
  clientMsgId?: string;
}
```

- [ ] **Step 2: Write the controller**

Create `apps/server/apps/gateway/src/im/messages/forwards/forwards.controller.ts`:

```ts
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard, CurrentUser } from "@team9/auth";
import { ForwardsService } from "./forwards.service.js";
import { CreateForwardDto } from "./dto/create-forward.dto.js";
import type { MessageResponse } from "../messages.service.js";
import type { ForwardItemResponse } from "./types.js";

@Controller({ path: "im", version: "1" })
@UseGuards(AuthGuard)
export class ForwardsController {
  constructor(private readonly forwardsService: ForwardsService) {}

  @Post("channels/:targetChannelId/forward")
  async forward(
    @CurrentUser("sub") userId: string,
    @Param("targetChannelId", ParseUUIDPipe) targetChannelId: string,
    @Body() dto: CreateForwardDto,
  ): Promise<MessageResponse> {
    return this.forwardsService.forward({
      targetChannelId,
      sourceChannelId: dto.sourceChannelId,
      sourceMessageIds: dto.sourceMessageIds,
      clientMsgId: dto.clientMsgId,
      userId,
    });
  }

  @Get("messages/:id/forward-items")
  async getItems(
    @CurrentUser("sub") userId: string,
    @Param("id", ParseUUIDPipe) messageId: string,
  ): Promise<ForwardItemResponse[]> {
    return this.forwardsService.getForwardItems(messageId, userId);
  }
}
```

- [ ] **Step 3: Register in `MessagesModule`**

Edit `apps/server/apps/gateway/src/im/messages/messages.module.ts`:

```ts
import { ForwardsController } from "./forwards/forwards.controller.js";
import { ForwardsService } from "./forwards/forwards.service.js";

@Module({
  imports: [
    /* existing */
  ],
  controllers: [, /* existing */ ForwardsController],
  providers: [, /* existing */ ForwardsService],
  exports: [, /* existing */ ForwardsService],
})
export class MessagesModule {}
```

(Match the file's exact existing decorator shape — likely already has `controllers` and `providers` arrays. Append, don't replace.)

- [ ] **Step 4: Write controller spec**

Create `forwards.controller.spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { ForwardsController } from "./forwards.controller.js";
import { ForwardsService } from "./forwards.service.js";
import { AuthGuard } from "@team9/auth";

describe("ForwardsController", () => {
  let controller: ForwardsController;
  let svc: jest.Mocked<ForwardsService>;

  beforeEach(async () => {
    const m = await Test.createTestingModule({
      controllers: [ForwardsController],
      providers: [
        {
          provide: ForwardsService,
          useValue: { forward: jest.fn(), getForwardItems: jest.fn() },
        },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = m.get(ForwardsController);
    svc = m.get(ForwardsService);
  });

  it("POST forward delegates to service", async () => {
    svc.forward.mockResolvedValueOnce({ id: "m1", type: "forward" } as any);
    const res = await controller.forward("u-1", "ch-target", {
      sourceChannelId: "ch-src",
      sourceMessageIds: ["m-a"],
      clientMsgId: "cid",
    });
    expect(svc.forward).toHaveBeenCalledWith({
      targetChannelId: "ch-target",
      sourceChannelId: "ch-src",
      sourceMessageIds: ["m-a"],
      clientMsgId: "cid",
      userId: "u-1",
    });
    expect(res.id).toBe("m1");
  });

  it("GET items delegates to service", async () => {
    svc.getForwardItems.mockResolvedValueOnce([] as any);
    const res = await controller.getItems("u-1", "msg-1");
    expect(svc.getForwardItems).toHaveBeenCalledWith("msg-1", "u-1");
    expect(res).toEqual([]);
  });
});
```

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @team9/server test -- forwards.controller
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/apps/gateway/src/im/messages/forwards/ \
        apps/server/apps/gateway/src/im/messages/messages.module.ts
git commit -m "feat(im): add forward REST endpoints"
```

---

## Task 5: `MessagesService` — hydrate `forward` field on reads

**Goal:** When a message of `type === 'forward'` is loaded by `getMessageWithDetails` or any of its bulk siblings, attach a `forward: ForwardPayload` field. Update the response interface so the client receives it on `GET /messages/:id`, `GET /channels/:id/messages`, and `GET /messages/:id/thread`. Also reject `PATCH /messages/:id` when the target is a forward message.

**Files:**

- Modify: `apps/server/apps/gateway/src/im/messages/messages.service.ts`
- Modify: `apps/server/apps/gateway/src/im/messages/messages.service.spec.ts`
- Modify: `apps/server/apps/gateway/src/im/messages/messages.controller.ts` (PATCH guard)
- Modify: `apps/server/apps/gateway/src/im/messages/messages.controller.spec.ts`

**Acceptance Criteria:**

- [ ] `MessageResponse` type includes optional `forward?: ForwardPayload`.
- [ ] For `type === 'forward'` rows, `getMessageWithDetails` populates `forward` via `ForwardsService.hydratePayload`.
- [ ] Bulk paths (`getChannelMessages`, `getChannelMessagesPaginated`, `getThread`, `getSubReplies`) hydrate forwards in batch — one query per page, not per message.
- [ ] `truncateForPreview` returns the message untouched for `type === 'forward'` (digest is already short; relational items are not preview-truncated).
- [ ] `PATCH /messages/:id` returns 400 `forward.editDisabled` when target is a forward.
- [ ] All existing message-fetch tests still pass.
- [ ] New tests cover the hydration branch and the PATCH rejection.

**Verify:**

```bash
pnpm --filter @team9/server test -- messages.service messages.controller
```

**Steps:**

- [ ] **Step 1: Add `forward?` to the response type**

In `messages.service.ts`, wherever `MessageResponse` is declared, add:

```ts
import type { ForwardPayload } from "./forwards/types.js";

export interface MessageResponse {
  // ...existing fields
  forward?: ForwardPayload;
}
```

- [ ] **Step 2: Inject `ForwardsService` into `MessagesService`**

Use `@Inject(forwardRef(...))` (mirrors how `MessagesController` already pulls `WebsocketGateway`). Then in `getMessageWithDetails`, after building the base response:

```ts
if (message.type === "forward") {
  const meta = (message.metadata ?? {}) as { forward?: ForwardMetadata };
  if (meta.forward) {
    response.forward = await this.forwardsService.hydratePayload(
      message.id,
      requesterUserId,
      meta.forward,
    );
  }
}
```

`requesterUserId` must thread through. If `getMessageWithDetails` doesn't currently take a `userId`, add an optional `userId?: string` parameter and update callers (controller already has `userId`). Pass undefined → `canJumpToOriginal` defaults to `false` for the row (treat unknown user as no access).

- [ ] **Step 3: Bulk hydration**

Add a private helper:

```ts
private async hydrateForwardsBatch(
  messages: MessageResponse[],
  userId: string | undefined,
): Promise<void> {
  const fwdMessages = messages.filter((m) => m.type === 'forward');
  if (fwdMessages.length === 0 || !userId) return;
  await Promise.all(fwdMessages.map(async (m) => {
    const meta = (m.metadata ?? {}) as { forward?: ForwardMetadata };
    if (meta.forward) {
      m.forward = await this.forwardsService.hydratePayload(m.id, userId, meta.forward);
    }
  }));
}
```

Call it inside the bulk fetch methods after assembling the array. (Per-message Promise.all is fine — V1 expects ≤ 50 messages per page; we can batch into a single SQL fetch later if it shows up in profiling.)

- [ ] **Step 4: Pass `userId` through controller calls**

In `messages.controller.ts`, every place that calls `getMessageWithDetails`, `getChannelMessages`, `getChannelMessagesPaginated`, `getThread`, `getSubReplies`, pass the current `userId`. Update the service signatures accordingly.

- [ ] **Step 5: Reject PATCH on forward type**

In `messages.controller.ts:updateMessage`, before calling `messagesService.update`, fetch the existing message type:

```ts
const existing = await this.messagesService.getMessageWithDetails(messageId);
if (existing.type === "forward") {
  throw new BadRequestException("forward.editDisabled");
}
```

(If the existing service `update` already loads the row first, you can move the check inside `MessagesService.update` to avoid a double-fetch — pick whichever matches the file's existing pattern.)

- [ ] **Step 6: Tests**

In `messages.service.spec.ts`:

```ts
describe("forward hydration", () => {
  it("attaches forward payload for type=forward messages", async () => {
    forwardsService.hydratePayload.mockResolvedValueOnce({
      kind: "single",
      count: 1,
      items: [],
    } as any);
    const m = await service.getMessageWithDetails("m-fwd", "u-1");
    expect(m.forward?.kind).toBe("single");
  });

  it("skips hydration for non-forward messages", async () => {
    const m = await service.getMessageWithDetails("m-text", "u-1");
    expect(m.forward).toBeUndefined();
    expect(forwardsService.hydratePayload).not.toHaveBeenCalled();
  });

  it("hydrates each forward in a paginated page", async () => {
    forwardsService.hydratePayload.mockResolvedValue({
      kind: "single",
      count: 1,
      items: [],
    } as any);
    const page = await service.getChannelMessagesPaginated(
      "ch-1",
      50,
      {},
      "u-1",
    );
    const fwdCount = page.messages.filter((m) => m.type === "forward").length;
    expect(forwardsService.hydratePayload).toHaveBeenCalledTimes(fwdCount);
  });
});
```

In `messages.controller.spec.ts`:

```ts
it("rejects PATCH on forward-type message", async () => {
  messagesService.getMessageWithDetails.mockResolvedValueOnce({
    id: "m",
    type: "forward",
  } as any);
  await expect(
    controller.updateMessage("u-1", "m", { content: "x" }),
  ).rejects.toThrow("forward.editDisabled");
});
```

- [ ] **Step 7: Run tests**

```bash
pnpm --filter @team9/server test -- messages.service messages.controller
```

Expected: PASS, including all pre-existing tests.

- [ ] **Step 8: Commit**

```bash
git add apps/server/apps/gateway/src/im/messages/
git commit -m "feat(im): hydrate forward payload on message reads; reject PATCH on forwards"
```

---

## Task 6: Backend e2e — `forward.e2e-spec.ts`

**Goal:** End-to-end coverage that exercises the full request → DB → WS broadcast → read-back loop, mirroring the scenarios in spec §9.2. Uses the existing gateway e2e harness (Postgres + Redis + RabbitMQ via Docker as already configured).

**Files:**

- Create: `apps/server/apps/gateway/test/forward.e2e-spec.ts`

**Acceptance Criteria:**

- [ ] Two-channel happy path: post 3 messages in A, forward all 3 to B as a bundle, assert WS `new_message` is observed by a B subscriber, assert `GET /messages/:id` returns hydrated `forward.items.length === 3`, assert `GET /messages/:id/forward-items` returns the same 3.
- [ ] Single-image forward: assert `im_message_attachments` row count for the new forward message is `0`, assert `forward.items[0].attachmentsSnapshot[0].fileUrl` matches original.
- [ ] Forward to a channel where you have read but no write → 403.
- [ ] Forward from a channel you can't read → 403.
- [ ] Re-forward chain: forward a forward into channel C, assert chain depth 1.
- [ ] Soft-deleted source after forwarding: `forward-items` still renders snapshot, `canJumpToOriginal === false`.
- [ ] Sending >100 in `sourceMessageIds` → 400 `forward.tooManySelected`.
- [ ] Mixed-channel selection → 400 `forward.mixedChannels`.

**Verify:**

```bash
pnpm --filter @team9/server test:e2e -- forward
```

**Steps:**

- [ ] **Step 1: Read existing e2e harness**

```bash
ls apps/server/apps/gateway/test/
head -60 apps/server/apps/gateway/test/messages.e2e-spec.ts 2>/dev/null \
  || head -60 apps/server/apps/gateway/test/im.e2e-spec.ts 2>/dev/null
```

Identify the existing fixture helpers (login, create-channel, post-message, WS-connect). Mirror their style. Do not invent a parallel harness.

- [ ] **Step 2: Scaffold `forward.e2e-spec.ts`**

Create the file using the existing harness's `beforeAll`/`afterAll` shape. Provide:

```ts
describe("Forward e2e", () => {
  let app: INestApplication;
  let userA: { id: string; token: string };
  let userB: { id: string; token: string };
  let chSource: string;
  let chTarget: string;

  beforeAll(async () => {
    app = await bootstrapTestApp(); // existing helper
    userA = await registerAndLogin(app, "a@x.test");
    userB = await registerAndLogin(app, "b@x.test");
    chSource = await createChannel(app, userA.token, {
      name: "src",
      type: "public",
    });
    chTarget = await createChannel(app, userA.token, {
      name: "dst",
      type: "public",
    });
    await joinChannel(app, userB.token, chSource);
    await joinChannel(app, userB.token, chTarget);
  });
  afterAll(async () => {
    await app.close();
  });

  // ...individual `it(...)` blocks for each scenario above...
});
```

- [ ] **Step 3: Implement each scenario block**

For each scenario in Acceptance Criteria, write an `it(...)` that:

1. Posts whatever fixture messages it needs.
2. Calls `POST /api/v1/im/channels/:targetChannelId/forward` with the right body.
3. Asserts response shape, then re-fetches via `GET /messages/:id` to assert hydration.
4. For the WS test: connect a Socket.io client as user B before calling forward, await the `new_message` event with a 2s timeout, assert `payload.type === 'forward'`.

For the soft-delete scenario, hit `DELETE /messages/:sourceId` between the forward and the read-back, then assert `forward.items[0].canJumpToOriginal === false` and `contentSnapshot` is still populated.

For the attachment scenario, use the existing image-upload helper (or post a message with `attachments: [{ fileName, fileUrl, ... }]` in the create-message DTO if the harness supports synthesized attachments). After forwarding, query `im_message_attachments WHERE message_id = $forwardId` directly via the test DB connection and assert the count is 0.

- [ ] **Step 4: Run the suite**

```bash
pnpm --filter @team9/server test:e2e -- forward
```

Expected: all `it(...)` blocks pass. Iterate on flakiness (e.g. WS race) by extending timeouts or awaiting an explicit `socket.connected === true` before triggering the forward.

- [ ] **Step 5: Commit**

```bash
git add apps/server/apps/gateway/test/forward.e2e-spec.ts
git commit -m "test(im): e2e coverage for forward + bundle + re-forward"
```

---

## Task 7: Frontend — types, API client, selection store

**Goal:** Land the type extensions, the two new API methods, and the Zustand store that drives selection mode. No UI yet. After this task, the data plumbing is ready for the components in Tasks 8–11.

**Files:**

- Modify: `apps/client/src/types/im.ts`
- Modify: `apps/client/src/services/api.ts`
- Create: `apps/client/src/stores/useForwardSelectionStore.ts`
- Create: `apps/client/src/stores/__tests__/useForwardSelectionStore.test.ts`

**Acceptance Criteria:**

- [ ] `MessageType` union includes `'forward'`.
- [ ] `Message` interface includes optional `forward?: ForwardPayload`.
- [ ] `ForwardPayload`, `ForwardItem`, `ForwardAttachmentSnapshot` exported from `@/types/im`.
- [ ] `api.forward.create({ targetChannelId, sourceChannelId, sourceMessageIds, clientMsgId? })` posts to the right URL and returns `Message`.
- [ ] `api.forward.getItems(messageId)` returns `ForwardItem[]`.
- [ ] Selection store: `enter(channelId)`, `exit()`, `toggle(messageId)`, `addRange(messageIds)`, `clear()`. Cap enforcement (`add` past 100 returns false and emits no state change). Switching `channelId` clears `selectedIds`. Store unit-tested at 100% coverage.

**Verify:**

```bash
pnpm --filter @team9/client test -- useForwardSelectionStore
pnpm --filter @team9/client lint
```

**Steps:**

- [ ] **Step 1: Extend types**

Edit `apps/client/src/types/im.ts:12-18`:

```ts
export type MessageType =
  | "text"
  | "file"
  | "image"
  | "system"
  | "tracking"
  | "long_text"
  | "forward";
```

Append to the same file (after the existing exports):

```ts
export interface ForwardAttachmentSnapshot {
  originalAttachmentId: string;
  fileName: string;
  fileUrl: string;
  fileKey: string | null;
  fileSize: number;
  mimeType: string;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
}

export interface ForwardItem {
  position: number;
  sourceMessageId: string | null;
  sourceChannelId: string;
  sourceChannelName: string | null;
  sourceWorkspaceId: string | null;
  sourceSender: {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  } | null;
  sourceCreatedAt: string;
  sourceSeqId: string | null;
  sourceType: "text" | "long_text" | "file" | "image" | "forward";
  contentSnapshot: string | null;
  contentAstSnapshot: Record<string, unknown> | null;
  attachmentsSnapshot: ForwardAttachmentSnapshot[];
  canJumpToOriginal: boolean;
  truncated: boolean;
}

export interface ForwardPayload {
  kind: "single" | "bundle";
  count: number;
  sourceChannelId: string;
  sourceChannelName: string | null;
  truncated: boolean;
  items: ForwardItem[];
}
```

Find the `Message` interface (around line 199) and add:

```ts
forward?: ForwardPayload;
```

- [ ] **Step 2: Add API methods**

In `apps/client/src/services/api.ts`, append a `forward` namespace:

```ts
export const forwardApi = {
  async create(input: {
    targetChannelId: string;
    sourceChannelId: string;
    sourceMessageIds: string[];
    clientMsgId?: string;
  }): Promise<Message> {
    return http.post<Message>(
      `/api/v1/im/channels/${input.targetChannelId}/forward`,
      {
        sourceChannelId: input.sourceChannelId,
        sourceMessageIds: input.sourceMessageIds,
        clientMsgId: input.clientMsgId,
      },
    );
  },
  async getItems(messageId: string): Promise<ForwardItem[]> {
    return http.get<ForwardItem[]>(
      `/api/v1/im/messages/${messageId}/forward-items`,
    );
  },
};
```

Match the file's existing pattern — if `api.ts` exports a single object (e.g. `export const api = { ... }`), nest `forward: forwardApi` inside it. If it exports per-feature consts, follow that style.

- [ ] **Step 3: Write the selection store**

Create `apps/client/src/stores/useForwardSelectionStore.ts`:

```ts
import { create } from "zustand";

const MAX_SELECTED = 100;

interface ForwardSelectionState {
  active: boolean;
  channelId: string | null;
  selectedIds: Set<string>;
  enter: (channelId: string) => void;
  exit: () => void;
  toggle: (messageId: string) => boolean; // returns true on success, false when capped
  addRange: (messageIds: string[]) => number; // returns count actually added
  clear: () => void;
  isSelected: (messageId: string) => boolean;
}

export const useForwardSelectionStore = create<ForwardSelectionState>(
  (set, get) => ({
    active: false,
    channelId: null,
    selectedIds: new Set(),
    enter: (channelId) =>
      set({ active: true, channelId, selectedIds: new Set() }),
    exit: () => set({ active: false, channelId: null, selectedIds: new Set() }),
    toggle: (messageId) => {
      const state = get();
      if (!state.active) return false;
      const next = new Set(state.selectedIds);
      if (next.has(messageId)) {
        next.delete(messageId);
        set({ selectedIds: next });
        return true;
      }
      if (next.size >= MAX_SELECTED) return false;
      next.add(messageId);
      set({ selectedIds: next });
      return true;
    },
    addRange: (messageIds) => {
      const state = get();
      if (!state.active) return 0;
      const next = new Set(state.selectedIds);
      let added = 0;
      for (const id of messageIds) {
        if (next.size >= MAX_SELECTED) break;
        if (!next.has(id)) {
          next.add(id);
          added += 1;
        }
      }
      set({ selectedIds: next });
      return added;
    },
    clear: () => set({ selectedIds: new Set() }),
    isSelected: (messageId) => get().selectedIds.has(messageId),
  }),
);

export const FORWARD_SELECTION_MAX = MAX_SELECTED;
```

- [ ] **Step 4: Test the store**

Create `apps/client/src/stores/__tests__/useForwardSelectionStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  useForwardSelectionStore,
  FORWARD_SELECTION_MAX,
} from "../useForwardSelectionStore";

beforeEach(() => {
  useForwardSelectionStore.getState().exit();
});

describe("useForwardSelectionStore", () => {
  it("enters mode for a channel", () => {
    useForwardSelectionStore.getState().enter("ch-1");
    expect(useForwardSelectionStore.getState().active).toBe(true);
    expect(useForwardSelectionStore.getState().channelId).toBe("ch-1");
  });

  it("exit resets state", () => {
    useForwardSelectionStore.getState().enter("ch-1");
    useForwardSelectionStore.getState().toggle("m-1");
    useForwardSelectionStore.getState().exit();
    expect(useForwardSelectionStore.getState().active).toBe(false);
    expect(useForwardSelectionStore.getState().selectedIds.size).toBe(0);
  });

  it("toggle adds and removes ids", () => {
    useForwardSelectionStore.getState().enter("ch-1");
    expect(useForwardSelectionStore.getState().toggle("m-1")).toBe(true);
    expect(useForwardSelectionStore.getState().isSelected("m-1")).toBe(true);
    expect(useForwardSelectionStore.getState().toggle("m-1")).toBe(true);
    expect(useForwardSelectionStore.getState().isSelected("m-1")).toBe(false);
  });

  it("toggle returns false when inactive", () => {
    expect(useForwardSelectionStore.getState().toggle("m-1")).toBe(false);
  });

  it("toggle enforces cap", () => {
    useForwardSelectionStore.getState().enter("ch-1");
    for (let i = 0; i < FORWARD_SELECTION_MAX; i += 1) {
      useForwardSelectionStore.getState().toggle(`m-${i}`);
    }
    expect(useForwardSelectionStore.getState().toggle("m-overflow")).toBe(
      false,
    );
    expect(useForwardSelectionStore.getState().selectedIds.size).toBe(
      FORWARD_SELECTION_MAX,
    );
  });

  it("addRange respects cap and returns added count", () => {
    useForwardSelectionStore.getState().enter("ch-1");
    const ids = Array.from({ length: 150 }, (_, i) => `m-${i}`);
    const added = useForwardSelectionStore.getState().addRange(ids);
    expect(added).toBe(FORWARD_SELECTION_MAX);
    expect(useForwardSelectionStore.getState().selectedIds.size).toBe(
      FORWARD_SELECTION_MAX,
    );
  });

  it("addRange returns 0 when inactive", () => {
    expect(useForwardSelectionStore.getState().addRange(["m-1"])).toBe(0);
  });

  it("clear empties selection without exiting", () => {
    useForwardSelectionStore.getState().enter("ch-1");
    useForwardSelectionStore.getState().toggle("m-1");
    useForwardSelectionStore.getState().clear();
    expect(useForwardSelectionStore.getState().selectedIds.size).toBe(0);
    expect(useForwardSelectionStore.getState().active).toBe(true);
  });

  it("entering a different channel clears selection", () => {
    useForwardSelectionStore.getState().enter("ch-1");
    useForwardSelectionStore.getState().toggle("m-1");
    useForwardSelectionStore.getState().enter("ch-2");
    expect(useForwardSelectionStore.getState().channelId).toBe("ch-2");
    expect(useForwardSelectionStore.getState().selectedIds.size).toBe(0);
  });
});
```

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @team9/client test -- useForwardSelectionStore
```

Expected: 9 specs pass at 100% coverage on the store file.

- [ ] **Step 6: Commit**

```bash
git add apps/client/src/types/im.ts \
        apps/client/src/services/api.ts \
        apps/client/src/stores/useForwardSelectionStore.ts \
        apps/client/src/stores/__tests__/useForwardSelectionStore.test.ts
git commit -m "feat(client): add forward types, API methods, selection store"
```

---

## Task 8: `ForwardDialog` + channel picker + preview

**Goal:** Build the modal that lets the user pick a target channel and confirm the forward. Used by both single-message (hover toolbar / context menu) and multi-select (selection action bar) flows. Triggers `api.forward.create(...)` and closes on success.

**Files:**

- Create: `apps/client/src/components/channel/forward/ForwardDialog.tsx`
- Create: `apps/client/src/components/channel/forward/ForwardChannelList.tsx`
- Create: `apps/client/src/components/channel/forward/ForwardPreview.tsx`
- Create: `apps/client/src/components/channel/forward/__tests__/ForwardDialog.test.tsx`
- Create: `apps/client/src/components/channel/forward/__tests__/ForwardChannelList.test.tsx`
- Create: `apps/client/src/components/channel/forward/__tests__/ForwardPreview.test.tsx`

**Acceptance Criteria:**

- [ ] `ForwardDialog` accepts `{ open, onOpenChange, sourceChannelId, sourceMessages: Message[] }`. Shows single-quote preview when `sourceMessages.length === 1`, bundle preview otherwise.
- [ ] Channel list excludes archived/deactivated channels and the source channel itself (UX hint, not a hard block — server still validates).
- [ ] Search box filters channels by name (case-insensitive substring).
- [ ] Confirm button is disabled until a channel is selected; shows spinner while the API call is in flight.
- [ ] On success: closes dialog, shows success toast (`forward.success` — add this i18n key in this task), invalidates the destination channel's message-list query.
- [ ] On error: shows error toast with the server's error code mapped to an i18n string.
- [ ] All three component tests at 100% line + branch coverage.

**Verify:**

```bash
pnpm --filter @team9/client test -- forward/__tests__
```

**Steps:**

- [ ] **Step 1: Add the missing i18n key**

In both `en/channel.json` and `zh-CN/channel.json`, add under the existing `forward` block:

```json
"success": "Forwarded.",  // en
"success": "已转发"        // zh-CN
```

- [ ] **Step 2: Build `ForwardChannelList.tsx`**

```tsx
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useChannels } from "@/hooks/useChannels"; // or whichever existing hook
import type { Channel } from "@/types/im";

interface Props {
  excludeChannelId?: string;
  selectedChannelId: string | null;
  onSelect: (channelId: string) => void;
}

export function ForwardChannelList({
  excludeChannelId,
  selectedChannelId,
  onSelect,
}: Props) {
  const { t } = useTranslation("channel");
  const { data: channels = [] } = useChannels();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    return channels.filter((c) => {
      if (c.id === excludeChannelId) return false;
      if (c.isArchived) return false;
      if (c.isActivated === false) return false;
      if (!query) return true;
      return c.name.toLowerCase().includes(query.toLowerCase());
    });
  }, [channels, query, excludeChannelId]);

  return (
    <div className="flex flex-col gap-2">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("forward.dialog.searchPlaceholder")}
        className="w-full rounded border px-3 py-2"
        aria-label={t("forward.dialog.searchPlaceholder")}
      />
      <ul role="listbox" className="max-h-80 overflow-y-auto rounded border">
        {filtered.map((c) => (
          <li
            key={c.id}
            role="option"
            aria-selected={selectedChannelId === c.id}
            onClick={() => onSelect(c.id)}
            className={`cursor-pointer px-3 py-2 hover:bg-accent ${selectedChannelId === c.id ? "bg-accent" : ""}`}
          >
            #{c.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

If the project's existing channel hook is named differently (e.g. `useWorkspaceChannels`), substitute. Verify by grepping `apps/client/src/hooks/`.

- [ ] **Step 3: Build `ForwardPreview.tsx`**

```tsx
import { useTranslation } from "react-i18next";
import type { Message } from "@/types/im";
import { UserAvatar } from "@/components/ui/user-avatar";

interface Props {
  messages: Message[];
}

export function ForwardPreview({ messages }: Props) {
  const { t } = useTranslation("channel");
  if (messages.length === 1) {
    const m = messages[0];
    return (
      <div className="rounded border-l-4 border-muted-foreground/30 bg-muted/30 p-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <UserAvatar user={m.sender} size="xs" />
          <span>{m.sender?.displayName ?? m.sender?.username}</span>
        </div>
        <div className="mt-1 line-clamp-3 text-sm text-muted-foreground">
          {m.content}
        </div>
      </div>
    );
  }
  return (
    <div className="rounded border bg-muted/30 p-3">
      <div className="text-sm font-medium">
        {t("forward.bundle.title", { count: messages.length })}
      </div>
      <ul className="mt-2 space-y-1 text-sm">
        {messages.slice(0, 3).map((m) => (
          <li key={m.id} className="flex items-center gap-2">
            <UserAvatar user={m.sender} size="xs" />
            <span className="font-medium">
              {m.sender?.displayName ?? m.sender?.username}
            </span>
            <span className="line-clamp-1 text-muted-foreground">
              {m.content?.slice(0, 80)}
            </span>
          </li>
        ))}
        {messages.length > 3 && (
          <li className="text-xs text-muted-foreground">
            …{t("forward.bundle.viewAll")}
          </li>
        )}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Build `ForwardDialog.tsx`**

```tsx
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast"; // or whatever toast util exists
import { forwardApi } from "@/services/api";
import { ForwardChannelList } from "./ForwardChannelList";
import { ForwardPreview } from "./ForwardPreview";
import type { Message } from "@/types/im";

const ERROR_TO_KEY: Record<string, string> = {
  "forward.tooManySelected": "forward.tooManySelected",
  "forward.mixedChannels": "forward.error.mixedChannels",
  "forward.noWriteAccess": "forward.error.noWriteAccess",
  "forward.noSourceAccess": "forward.error.noSourceAccess",
  "forward.notAllowed": "forward.error.notAllowed",
  "forward.notFound": "forward.error.notFound",
  "forward.empty": "forward.error.empty",
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceChannelId: string;
  sourceMessages: Message[];
  onSuccess?: () => void;
}

export function ForwardDialog({
  open,
  onOpenChange,
  sourceChannelId,
  sourceMessages,
  onSuccess,
}: Props) {
  const { t } = useTranslation("channel");
  const queryClient = useQueryClient();
  const [targetChannelId, setTargetChannelId] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => {
      if (!targetChannelId) throw new Error("no target");
      return forwardApi.create({
        targetChannelId,
        sourceChannelId,
        sourceMessageIds: sourceMessages.map((m) => m.id),
      });
    },
    onSuccess: (_msg, _vars) => {
      toast({ description: t("forward.success") });
      if (targetChannelId) {
        queryClient.invalidateQueries({
          queryKey: ["channelMessages", targetChannelId],
        });
      }
      setTargetChannelId(null);
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (err: unknown) => {
      const code = err instanceof Error ? err.message : String(err);
      const key = ERROR_TO_KEY[code] ?? "forward.error.notAllowed";
      toast({ description: t(key), variant: "destructive" });
    },
  });

  const title =
    sourceMessages.length === 1
      ? t("forward.dialog.titleSingle")
      : t("forward.dialog.titleBundle", { count: sourceMessages.length });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <ForwardChannelList
            excludeChannelId={sourceChannelId}
            selectedChannelId={targetChannelId}
            onSelect={setTargetChannelId}
          />
          <ForwardPreview messages={sourceMessages} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("forward.dialog.cancel")}
          </Button>
          <Button
            disabled={!targetChannelId || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {t("forward.dialog.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

If the project's HTTP client surfaces the server's error string differently (e.g. the body's `message` field on the response), inspect `services/http.ts` to confirm and adjust the `onError` extraction.

- [ ] **Step 5: Tests**

For each component, write a vitest + @testing-library/react file. Example for `ForwardDialog`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ForwardDialog } from "../ForwardDialog";
import { forwardApi } from "@/services/api";

vi.mock("@/services/api", () => ({
  forwardApi: { create: vi.fn(), getItems: vi.fn() },
}));
vi.mock("@/hooks/useChannels", () => ({
  useChannels: () => ({
    data: [
      {
        id: "ch-1",
        name: "general",
        type: "public",
        isArchived: false,
        isActivated: true,
      },
      {
        id: "ch-2",
        name: "src",
        type: "public",
        isArchived: false,
        isActivated: true,
      },
    ],
  }),
}));

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("ForwardDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("disables confirm until a channel is selected", () => {
    wrap(
      <ForwardDialog
        open
        onOpenChange={() => {}}
        sourceChannelId="ch-2"
        sourceMessages={[{ id: "m-1", content: "hi" } as any]}
      />,
    );
    expect(screen.getByRole("button", { name: /forward/i })).toBeDisabled();
  });

  it("calls API on confirm and closes on success", async () => {
    (forwardApi.create as any).mockResolvedValueOnce({ id: "new-msg" });
    const onOpenChange = vi.fn();
    wrap(
      <ForwardDialog
        open
        onOpenChange={onOpenChange}
        sourceChannelId="ch-2"
        sourceMessages={[{ id: "m-1", content: "hi" } as any]}
      />,
    );
    fireEvent.click(screen.getByRole("option", { name: /general/i }));
    fireEvent.click(screen.getByRole("button", { name: /forward/i }));
    await waitFor(() =>
      expect(forwardApi.create).toHaveBeenCalledWith({
        targetChannelId: "ch-1",
        sourceChannelId: "ch-2",
        sourceMessageIds: ["m-1"],
      }),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("shows error toast on API failure", async () => {
    (forwardApi.create as any).mockRejectedValueOnce(
      new Error("forward.noWriteAccess"),
    );
    wrap(
      <ForwardDialog
        open
        onOpenChange={() => {}}
        sourceChannelId="ch-2"
        sourceMessages={[{ id: "m-1", content: "hi" } as any]}
      />,
    );
    fireEvent.click(screen.getByRole("option", { name: /general/i }));
    fireEvent.click(screen.getByRole("button", { name: /forward/i }));
    await waitFor(() => expect(forwardApi.create).toHaveBeenCalled());
  });
});
```

For `ForwardChannelList`: assert search filters, archived/deactivated/excluded channels are hidden.

For `ForwardPreview`: assert single render + bundle render (with truncation indicator when >3).

- [ ] **Step 6: Run tests + coverage**

```bash
pnpm --filter @team9/client test -- forward/__tests__ --coverage
```

Expected: 100% on the three new files.

- [ ] **Step 7: Commit**

```bash
git add apps/client/src/components/channel/forward/ \
        apps/client/src/i18n/locales/
git commit -m "feat(client): add ForwardDialog with channel picker and preview"
```

---

## Task 9: `ForwardedMessageCard` + `ForwardBundleViewer`

**Goal:** Render forward messages on the receiving end. Quote card for single, stacked bundle card for multi (with click-to-expand modal).

**Files:**

- Create: `apps/client/src/components/channel/forward/ForwardedMessageCard.tsx`
- Create: `apps/client/src/components/channel/forward/ForwardBundleViewer.tsx`
- Create: `apps/client/src/components/channel/forward/__tests__/ForwardedMessageCard.test.tsx`
- Create: `apps/client/src/components/channel/forward/__tests__/ForwardBundleViewer.test.tsx`

**Acceptance Criteria:**

- [ ] `ForwardedMessageCard` branches on `message.forward.kind`. Single → quote-style card. Bundle → stacked card with header + first 3 previews + "View all".
- [ ] Both render the "Forwarded from #X" header (or "Source no longer available" when `sourceChannelName` is null and `canJumpToOriginal` is false everywhere).
- [ ] Single quote card supports clicking through to the original (via `Jump to original` link) when `canJumpToOriginal === true`. The link uses the existing message-deep-link route (pattern: `/{workspaceSlug}/channel/{channelId}?message={messageId}`).
- [ ] Bundle card opens `ForwardBundleViewer` modal on click; modal lazy-fetches full items via `forwardApi.getItems(messageId)`.
- [ ] Modal renders all items in `position` order: original sender header + relative timestamp + content (Lexical when `contentAstSnapshot` is non-null, plaintext otherwise) + attachment chips.
- [ ] Both components tested at 100%.

**Verify:**

```bash
pnpm --filter @team9/client test -- ForwardedMessageCard ForwardBundleViewer
```

**Steps:**

- [ ] **Step 1: Inspect existing renderer for AST and attachments**

```bash
grep -n "contentAst\|MessageAttachments\|AstRenderer" apps/client/src/components/channel/MessageContent.tsx
```

Find how `MessageContent` dispatches between AST and HTML/Markdown, and how attachments are rendered. Reuse those primitives (likely `<AstRenderer />` and `<MessageAttachments />`) inside the forward card so styling stays consistent.

- [ ] **Step 2: Build `ForwardedMessageCard.tsx`**

```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import type { Message, ForwardItem } from "@/types/im";
import { UserAvatar } from "@/components/ui/user-avatar";
import { AstRenderer } from "../AstRenderer";
import { ForwardBundleViewer } from "./ForwardBundleViewer";

interface Props {
  message: Message;
}

export function ForwardedMessageCard({ message }: Props) {
  const { t } = useTranslation("channel");
  const navigate = useNavigate();
  const [bundleOpen, setBundleOpen] = useState(false);

  const fwd = message.forward;
  if (!fwd) return null;

  const headerText = fwd.sourceChannelName
    ? t("forward.card.fromChannel", { channelName: fwd.sourceChannelName })
    : t("forward.source.unavailable");

  if (fwd.kind === "single") {
    const item = fwd.items[0];
    return (
      <div className="space-y-2">
        <div className="text-xs text-muted-foreground">{headerText}</div>
        <div className="rounded border-l-4 border-muted-foreground/30 bg-muted/30 p-3">
          <ForwardItemBody item={item} />
          {item.canJumpToOriginal && item.sourceMessageId && (
            <button
              type="button"
              className="mt-2 text-xs text-primary underline"
              onClick={() =>
                navigate({
                  to: `/channel/${item.sourceChannelId}`,
                  search: { message: item.sourceMessageId! },
                } as any)
              }
            >
              {t("forward.source.jumpTo")}
            </button>
          )}
        </div>
      </div>
    );
  }

  const previews = fwd.items.slice(0, 3);
  return (
    <>
      <div className="space-y-2">
        <div className="text-xs text-muted-foreground">{headerText}</div>
        <button
          type="button"
          onClick={() => setBundleOpen(true)}
          className="block w-full rounded border bg-muted/30 p-3 text-left hover:bg-muted/50"
        >
          <div className="text-sm font-medium">
            {t("forward.bundle.title", { count: fwd.count })}
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {previews.map((it) => (
              <li key={it.position} className="flex items-center gap-2">
                <UserAvatar user={it.sourceSender as any} size="xs" />
                <span className="font-medium">
                  {it.sourceSender?.displayName ??
                    it.sourceSender?.username ??
                    "?"}
                </span>
                <span className="line-clamp-1 text-muted-foreground">
                  {it.contentSnapshot?.slice(0, 80)}
                </span>
              </li>
            ))}
          </ul>
          {fwd.count > previews.length && (
            <div className="mt-2 text-xs text-muted-foreground">
              {t("forward.bundle.viewAll")}
            </div>
          )}
        </button>
      </div>
      {bundleOpen && (
        <ForwardBundleViewer
          messageId={message.id}
          channelName={fwd.sourceChannelName}
          onOpenChange={setBundleOpen}
        />
      )}
    </>
  );
}

function ForwardItemBody({ item }: { item: ForwardItem }) {
  return (
    <>
      <div className="flex items-center gap-2 text-sm font-medium">
        <UserAvatar user={item.sourceSender as any} size="xs" />
        <span>
          {item.sourceSender?.displayName ?? item.sourceSender?.username ?? "?"}
        </span>
        <span className="text-xs text-muted-foreground">
          {new Date(item.sourceCreatedAt).toLocaleString()}
        </span>
      </div>
      <div className="mt-1 text-sm">
        {item.contentAstSnapshot ? (
          <AstRenderer ast={item.contentAstSnapshot} />
        ) : (
          <span className="whitespace-pre-wrap">
            {item.contentSnapshot ?? ""}
          </span>
        )}
      </div>
      {item.attachmentsSnapshot.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {item.attachmentsSnapshot.map((a) => (
            <li key={a.originalAttachmentId}>
              <a
                href={a.fileUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs underline"
              >
                {a.fileName}
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
```

- [ ] **Step 3: Build `ForwardBundleViewer.tsx`**

```tsx
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { forwardApi } from "@/services/api";
import { ForwardItemBodyExport as ForwardItemBody } from "./ForwardedMessageCard";
// (export ForwardItemBody from ForwardedMessageCard.tsx for reuse, or duplicate the small render block here)

interface Props {
  messageId: string;
  channelName: string | null;
  onOpenChange: (open: boolean) => void;
}

export function ForwardBundleViewer({
  messageId,
  channelName,
  onOpenChange,
}: Props) {
  const { t } = useTranslation("channel");
  const { data, isLoading, isError } = useQuery({
    queryKey: ["forwardItems", messageId],
    queryFn: () => forwardApi.getItems(messageId),
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {channelName
              ? t("forward.bundle.modalTitle", { channelName })
              : t("forward.source.unavailable")}
          </DialogTitle>
        </DialogHeader>
        {isLoading && (
          <div className="p-4 text-sm text-muted-foreground">…</div>
        )}
        {isError && (
          <div className="p-4 text-sm text-destructive">
            {t("forward.error.notFound")}
          </div>
        )}
        {data && (
          <ul className="max-h-[60vh] space-y-3 overflow-y-auto">
            {data.map((item) => (
              <li key={item.position} className="rounded border p-3">
                <ForwardItemBody item={item} />
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

(Export `ForwardItemBody` from `ForwardedMessageCard.tsx` so this file can reuse it; alternatively, lift it into its own `ForwardItemBody.tsx` — pick whichever keeps the diff small.)

- [ ] **Step 4: Tests**

`ForwardedMessageCard.test.tsx`:

- Single forward renders sender + content + jump link when `canJumpToOriginal`.
- Single forward hides jump link when `canJumpToOriginal === false`.
- Bundle forward renders preview rows + "View all" indicator when count > 3.
- Bundle click opens viewer (assert `forwardApi.getItems` is called).
- Source unavailable header shown when `sourceChannelName === null`.

`ForwardBundleViewer.test.tsx`:

- Loading state, success state (renders all items), error state.
- Renders attachments as links.

```bash
pnpm --filter @team9/client test -- ForwardedMessageCard ForwardBundleViewer --coverage
```

Expected: 100% on both files.

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/components/channel/forward/
git commit -m "feat(client): render forwarded message cards and bundle viewer"
```

---

## Task 10: `SelectionActionBar` + `MessageList` integration + `MessageItem` checkbox

**Goal:** Wire the selection-mode UI into the channel: per-row checkboxes (with eligibility tooltips), the bottom action bar, route-change exit, Esc cancel.

**Files:**

- Create: `apps/client/src/components/channel/forward/SelectionActionBar.tsx`
- Create: `apps/client/src/components/channel/forward/__tests__/SelectionActionBar.test.tsx`
- Modify: `apps/client/src/components/channel/MessageItem.tsx`
- Modify: `apps/client/src/components/channel/MessageList.tsx`
- Modify: `apps/client/src/components/channel/__tests__/MessageList.test.tsx` (or create if absent)

**Acceptance Criteria:**

- [ ] When `useForwardSelectionStore.active === true && channelId === currentChannelId`, every eligible message row shows a checkbox; ineligible rows show a disabled checkbox with a tooltip explaining why.
- [ ] Clicking a checkbox toggles selection; clicking the row body in selection mode also toggles (and disables thread/quote/reactions).
- [ ] `Shift+click` selects the contiguous range from the previous click anchor.
- [ ] Sticky action bar appears at the bottom of the message list while in mode, showing `"{count} selected"` + Forward + Cancel.
- [ ] Forward button opens `ForwardDialog` with the selected messages preloaded (resolved via current page's message map; if a selected id is no longer in cache, drop it silently).
- [ ] Esc cancels selection mode. Switching channels (route change) calls `exit()`.
- [ ] > 100 selection attempt shows toast `forward.tooManySelected` and rejects the click.

**Verify:**

```bash
pnpm --filter @team9/client test -- SelectionActionBar MessageList
```

**Steps:**

- [ ] **Step 1: Build `SelectionActionBar.tsx`**

```tsx
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useForwardSelectionStore } from "@/stores/useForwardSelectionStore";

interface Props {
  onForward: () => void;
}

export function SelectionActionBar({ onForward }: Props) {
  const { t } = useTranslation("channel");
  const { active, selectedIds, exit } = useForwardSelectionStore();
  if (!active) return null;
  return (
    <div
      role="region"
      aria-label="Selection actions"
      className="sticky bottom-0 z-10 flex items-center justify-between border-t bg-background p-3 shadow"
    >
      <span className="text-sm">
        {t("forward.selection.bar", { count: selectedIds.size })}
      </span>
      <div className="flex gap-2">
        <Button variant="outline" onClick={exit}>
          {t("forward.selection.cancel")}
        </Button>
        <Button disabled={selectedIds.size === 0} onClick={onForward}>
          {t("forward.toolbar.forward")}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the eligibility helper**

Create `apps/client/src/components/channel/forward/eligibility.ts`:

```ts
import type { Message } from "@/types/im";

const ALLOWED_TYPES = new Set([
  "text",
  "long_text",
  "file",
  "image",
  "forward",
]);

export function isForwardable(message: Message): boolean {
  if (message.isDeleted) return false;
  if (!ALLOWED_TYPES.has(message.type)) return false;
  const meta = message.metadata as Record<string, unknown> | undefined;
  if (meta?.streaming === true) return false;
  return true;
}

/** Build the range of message ids between two anchors (inclusive), filtered to forwardable. */
export function computeForwardableRange(
  visibleMessages: Message[],
  fromId: string,
  toId: string,
): string[] {
  const fromIdx = visibleMessages.findIndex((m) => m.id === fromId);
  const toIdx = visibleMessages.findIndex((m) => m.id === toId);
  if (fromIdx === -1 || toIdx === -1) return [];
  const [lo, hi] = fromIdx <= toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
  return visibleMessages
    .slice(lo, hi + 1)
    .filter(isForwardable)
    .map((m) => m.id);
}
```

- [ ] **Step 3: Modify `MessageItem.tsx`**

Read the current file end-to-end first (`MessageItem.tsx` is 580 lines). The component receives `visibleMessages: Message[]` (the current rendered page) — if the prop doesn't exist yet, add it from `MessageList` in Step 4 below. Then in `MessageItem`:

```tsx
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { useForwardSelectionStore } from "@/stores/useForwardSelectionStore";
import { isForwardable, computeForwardableRange } from "./forward/eligibility";
import { toast } from "@/components/ui/use-toast";

const { t } = useTranslation("channel");
const selection = useForwardSelectionStore();
const inSelectionMode =
  selection.active && selection.channelId === message.channelId;
const isEligible = isForwardable(message);
const isSelected = inSelectionMode && selection.isSelected(message.id);
const lastAnchorRef = useRef<string | null>(null);

const toggleSelection = (shiftKey: boolean) => {
  if (!isEligible) return;
  if (shiftKey && lastAnchorRef.current) {
    const range = computeForwardableRange(
      visibleMessages,
      lastAnchorRef.current,
      message.id,
    );
    const added = selection.addRange(range);
    if (added < range.length) {
      toast({
        description: t("forward.tooManySelected"),
        variant: "destructive",
      });
    }
  } else {
    const ok = selection.toggle(message.id);
    if (!ok)
      toast({
        description: t("forward.tooManySelected"),
        variant: "destructive",
      });
    lastAnchorRef.current = message.id;
  }
};

const handleRowClick = (e: React.MouseEvent) => {
  if (inSelectionMode) {
    e.preventDefault();
    e.stopPropagation();
    toggleSelection(e.shiftKey);
    return;
  }
  existingClickHandler?.(e);
};
```

Render the checkbox on the row's left rail when `inSelectionMode`:

```tsx
{
  inSelectionMode && (
    <input
      type="checkbox"
      aria-label={`Select message ${message.id}`}
      checked={isSelected}
      disabled={!isEligible}
      title={!isEligible ? t("forward.error.notAllowed") : undefined}
      onChange={(e) =>
        toggleSelection(
          e.nativeEvent instanceof MouseEvent && e.nativeEvent.shiftKey,
        )
      }
      onClick={(e) => e.stopPropagation()}
      className="mr-2"
    />
  );
}
```

Disable the existing hover toolbar / context menu wrappers when `inSelectionMode` is true (they shouldn't fire while the user is in selection mode) by gating their render on `!inSelectionMode`.

- [ ] **Step 4: Modify `MessageList.tsx`**

Append the `SelectionActionBar` to the bottom of the list container. Wire its `onForward` to local state opening `ForwardDialog`:

```tsx
const selection = useForwardSelectionStore();
const [forwardOpen, setForwardOpen] = useState(false);
const messagesById = useMemo(
  () => new Map(messages.map((m) => [m.id, m])),
  [messages],
);
const selectedMessages = useMemo(
  () =>
    Array.from(selection.selectedIds)
      .map((id) => messagesById.get(id))
      .filter((m): m is Message => !!m),
  [selection.selectedIds, messagesById],
);

useEffect(() => {
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape" && selection.active) selection.exit();
  }
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, [selection]);

useEffect(() => {
  // Exit selection mode when the route channel changes
  return () => {
    if (selection.active && selection.channelId !== channelId) selection.exit();
  };
}, [channelId, selection]);

return (
  <>
    {/* existing message list JSX */}
    <SelectionActionBar onForward={() => setForwardOpen(true)} />
    {forwardOpen && selectedMessages.length > 0 && (
      <ForwardDialog
        open={forwardOpen}
        onOpenChange={setForwardOpen}
        sourceChannelId={channelId}
        sourceMessages={selectedMessages}
        onSuccess={() => selection.exit()}
      />
    )}
  </>
);
```

- [ ] **Step 5: Tests**

`SelectionActionBar.test.tsx`:

- Renders nothing when not active.
- Renders count + buttons when active.
- Cancel button calls `exit()`.
- Forward button disabled when nothing selected.

`MessageList.test.tsx` (extend):

- When selection store is active for the channel, checkboxes appear on rows.
- Esc keypress calls `exit()`.
- Switching channels calls `exit()`.
- Toggling >100 messages emits the `forward.tooManySelected` toast.

A new test for the eligibility helper (`__tests__/eligibility.test.ts`):

- `isForwardable` true for text/long_text/file/image/forward; false for system/tracking/streaming/deleted.
- `computeForwardableRange` returns the inclusive slice and filters out ineligible ids.

```bash
pnpm --filter @team9/client test -- SelectionActionBar MessageList eligibility --coverage
```

- [ ] **Step 6: Commit**

```bash
git add apps/client/src/components/channel/forward/SelectionActionBar.tsx \
        apps/client/src/components/channel/forward/eligibility.ts \
        apps/client/src/components/channel/forward/__tests__/SelectionActionBar.test.tsx \
        apps/client/src/components/channel/forward/__tests__/eligibility.test.ts \
        apps/client/src/components/channel/MessageItem.tsx \
        apps/client/src/components/channel/MessageList.tsx \
        apps/client/src/components/channel/__tests__/MessageList.test.tsx
git commit -m "feat(client): selection mode + action bar in MessageList"
```

---

## Task 11: Hover toolbar + context menu wiring

**Goal:** Add Forward + Select entry points on the per-message hover toolbar and right-click menu. Forward opens `ForwardDialog` preloaded with the single message; Select calls `selection.enter(channelId)` and immediately toggles the clicked message.

**Files:**

- Modify: `apps/client/src/components/channel/MessageHoverToolbar.tsx`
- Modify: `apps/client/src/components/channel/MessageContextMenu.tsx`
- Modify: `apps/client/src/components/channel/__tests__/MessageHoverToolbar.test.tsx` (create if absent)
- Modify: `apps/client/src/components/channel/__tests__/MessageContextMenu.test.tsx` (create if absent)

**Acceptance Criteria:**

- [ ] Hover toolbar shows new icons in this order: Reply (existing) → Forward (new, paper-plane) → Select (new, checkmark) → existing actions (Copy, etc.).
- [ ] Context menu adds `Forward` and `Select` items in the corresponding positions.
- [ ] Forward callback opens the dialog through a new `onForward` prop on both components, plumbed from `MessageItem` upward.
- [ ] Select callback calls `selection.enter(channelId)` then `selection.toggle(messageId)`.
- [ ] Both new items are hidden / disabled for ineligible messages (use `isForwardable`).
- [ ] New tests cover the click handlers + visibility rules.

**Verify:**

```bash
pnpm --filter @team9/client test -- MessageHoverToolbar MessageContextMenu
```

**Steps:**

- [ ] **Step 1: Add icons + props to `MessageHoverToolbar.tsx`**

```tsx
import { Forward, CheckSquare } from "lucide-react";

interface Props {
  // existing
  onForward?: () => void;
  onSelect?: () => void;
  forwardable?: boolean;
}

// inside the toolbar JSX, after Reply button:
{
  forwardable && onForward && (
    <Tooltip content={t("forward.toolbar.forward")}>
      <Button
        size="icon"
        variant="ghost"
        onClick={onForward}
        aria-label={t("forward.toolbar.forward")}
      >
        <Forward className="h-4 w-4" />
      </Button>
    </Tooltip>
  );
}
{
  forwardable && onSelect && (
    <Tooltip content={t("forward.toolbar.select")}>
      <Button
        size="icon"
        variant="ghost"
        onClick={onSelect}
        aria-label={t("forward.toolbar.select")}
      >
        <CheckSquare className="h-4 w-4" />
      </Button>
    </Tooltip>
  );
}
```

- [ ] **Step 2: Add items to `MessageContextMenu.tsx`**

After the existing Reply/Copy/Pin section, add (gated on `forwardable`):

```tsx
{
  onForward && (
    <ContextMenuItem onClick={onForward} disabled={!forwardable}>
      <Forward className="mr-2 h-4 w-4" />
      {t("forward.contextMenu.forward")}
      <ContextMenuShortcut>F</ContextMenuShortcut>
    </ContextMenuItem>
  );
}
{
  onSelect && (
    <ContextMenuItem onClick={onSelect} disabled={!forwardable}>
      <CheckSquare className="mr-2 h-4 w-4" />
      {t("forward.contextMenu.select")}
    </ContextMenuItem>
  );
}
```

Update the `MessageContextMenuProps` interface to include `onForward?`, `onSelect?`, `forwardable?: boolean`.

- [ ] **Step 3: Wire up from `MessageItem.tsx`**

In `MessageItem`, after computing `isEligible` (Task 10), wire:

```tsx
const [forwardOpen, setForwardOpen] = useState(false);
const handleForward = () => setForwardOpen(true);
const handleSelect = () => {
  selection.enter(message.channelId);
  selection.toggle(message.id);
};

<MessageContextMenu
  /* existing props */
  forwardable={isEligible}
  onForward={handleForward}
  onSelect={handleSelect}
>
  ...
  <MessageHoverToolbar
    /* existing props */
    forwardable={isEligible}
    onForward={handleForward}
    onSelect={handleSelect}
  />
  ...
</MessageContextMenu>;

{
  forwardOpen && (
    <ForwardDialog
      open={forwardOpen}
      onOpenChange={setForwardOpen}
      sourceChannelId={message.channelId}
      sourceMessages={[message]}
    />
  );
}
```

- [ ] **Step 4: Tests**

`MessageHoverToolbar.test.tsx`:

```tsx
it("shows Forward and Select icons when forwardable + handlers provided", () => {
  const onForward = vi.fn();
  const onSelect = vi.fn();
  render(
    <MessageHoverToolbar
      message={textMessage}
      forwardable
      onForward={onForward}
      onSelect={onSelect}
    />,
  );
  fireEvent.click(screen.getByLabelText("Forward"));
  expect(onForward).toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText("Select"));
  expect(onSelect).toHaveBeenCalled();
});

it("hides Forward icon when not forwardable", () => {
  render(
    <MessageHoverToolbar
      message={textMessage}
      forwardable={false}
      onForward={vi.fn()}
      onSelect={vi.fn()}
    />,
  );
  expect(screen.queryByLabelText("Forward")).toBeNull();
});
```

`MessageContextMenu.test.tsx`: parallel coverage — items appear/disappear, click handlers fire.

```bash
pnpm --filter @team9/client test -- MessageHoverToolbar MessageContextMenu --coverage
```

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/components/channel/MessageHoverToolbar.tsx \
        apps/client/src/components/channel/MessageContextMenu.tsx \
        apps/client/src/components/channel/MessageItem.tsx \
        apps/client/src/components/channel/__tests__/
git commit -m "feat(client): wire forward+select into hover toolbar and context menu"
```

---

## Task 12: `MessageContent` dispatch — render forward card when type='forward'

**Goal:** When a message arrives over the wire with `type === 'forward'`, replace the normal content body with `<ForwardedMessageCard />`. Make sure the channel scroll keeps working (no sudden layout jumps; React Query cache holds the new payload).

**Files:**

- Modify: `apps/client/src/components/channel/MessageContent.tsx`
- Modify: `apps/client/src/components/channel/__tests__/MessageContent.test.tsx` (or create)

**Acceptance Criteria:**

- [ ] `MessageContent` short-circuits to `<ForwardedMessageCard message={message} />` when `message.type === 'forward'`.
- [ ] Existing rendering paths for text/file/image/long_text/system/tracking unchanged.
- [ ] Test verifies the dispatch.

**Verify:**

```bash
pnpm --filter @team9/client test -- MessageContent
```

**Steps:**

- [ ] **Step 1: Edit `MessageContent.tsx`**

Near the top of the render function:

```tsx
if (message.type === "forward") {
  return <ForwardedMessageCard message={message} />;
}
```

Import:

```tsx
import { ForwardedMessageCard } from "./forward/ForwardedMessageCard";
```

- [ ] **Step 2: Test**

```tsx
it("renders ForwardedMessageCard for type=forward messages", () => {
  const m = { id: "m", type: "forward", forward: { kind: "single", count: 1, items: [{ position: 0, ... }] } } as any;
  render(<MessageContent message={m} />);
  expect(screen.getByText(/Forwarded from/i)).toBeInTheDocument();
});
```

- [ ] **Step 3: Run + commit**

```bash
pnpm --filter @team9/client test -- MessageContent
git add apps/client/src/components/channel/MessageContent.tsx \
        apps/client/src/components/channel/__tests__/MessageContent.test.tsx
git commit -m "feat(client): dispatch MessageContent to ForwardedMessageCard for type=forward"
```

---

## Task 13: Manual smoke + final integration verification

**Goal:** Boot the dev stack, exercise both single and multi-select flows in the browser, verify WS broadcast lands instantly on a second logged-in window, verify bundle viewer + jump-to-original both work, capture any regressions in adjacent features (thread, reactions, properties).

**Files:** None (verification-only).

**Acceptance Criteria:**

- [ ] `pnpm dev` starts without errors.
- [ ] Single-message forward from channel A to channel B: card renders correctly, `Jump to original` lands on the original.
- [ ] Multi-select forward (5 messages) from A to B: bundle card renders with first 3 previews + "View all"; modal shows all 5 in order with attachments.
- [ ] Re-forward the bundle from B to C: chain depth 1; attempting to "Jump to original" lands on the bundle in B (the previous hop), not the original A messages.
- [ ] Source soft-delete: open A, delete one of the source messages, refresh B → snapshot still rendered, jump link hidden, "Source no longer available" footer shown when applicable.
- [ ] Try forward to an archived channel via direct API call (e.g. via curl) → 403.
- [ ] Try forwarding `>100` ids via curl → 400.
- [ ] Hover toolbar Forward shortcut (`F` while hovering) opens dialog.
- [ ] Esc exits selection mode without losing the channel scroll position.
- [ ] No regressions: thread reply still works, message edit still works on non-forward messages, reactions still work on forward messages.
- [ ] Run full suites: `pnpm --filter @team9/server test:cov && pnpm --filter @team9/client test:cov` → both 100% on new files; no drop on existing files.

**Verify:** Manual + the two coverage commands above.

**Steps:**

- [ ] **Step 1: Boot dev stack**

```bash
pnpm dev
```

Confirm gateway, im-worker, and Vite are all healthy.

- [ ] **Step 2: Walk the golden paths in the browser**

Use two browser windows (incognito for the second user). Run the scenarios in Acceptance Criteria one at a time, fixing any UI issues before moving on. Use the IDE to grep for unexpected console errors or React warnings.

- [ ] **Step 3: Hit edge cases via curl**

```bash
TOKEN=...; SRC=...; TGT=...
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  "http://localhost:3000/api/v1/im/channels/$TGT/forward" \
  -d "{\"sourceChannelId\":\"$SRC\",\"sourceMessageIds\":$(node -e 'console.log(JSON.stringify(Array.from({length:101},()=>"00000000-0000-0000-0000-000000000000")))')}"
```

Expected: 400 with `forward.tooManySelected`.

- [ ] **Step 4: Run coverage suites**

```bash
pnpm --filter @team9/server test:cov 2>&1 | tail -40
pnpm --filter @team9/client test:cov 2>&1 | tail -40
```

Expected: 100% on new files, no regressions on existing.

- [ ] **Step 5: Final commit (if any fix-ups)**

If the manual pass surfaced anything, commit fixes with focused messages. Otherwise this task ends with no commit.

- [ ] **Step 6: Open PR**

Confirm with the user what target branch is wanted (per their CLAUDE.md: "PR 代码前要和用户确认目标分支。一般是 dev、个人分支，少数情况是 main"). Default suggestion: `dev`.

```bash
gh pr create --base dev --title "feat(im): message forwarding (single + bundle)" --body "$(cat <<'EOF'
## Summary
- Adds single-message forwarding and multi-select bundle forwarding
- Carries source-location metadata (channel + workspace + sender + position) so agents can trace forwards back to origin

See [docs/superpowers/specs/2026-05-02-message-forwarding-design.md](docs/superpowers/specs/2026-05-02-message-forwarding-design.md) for the full design and [docs/superpowers/plans/2026-05-02-message-forwarding.md](docs/superpowers/plans/2026-05-02-message-forwarding.md) for the implementation plan.

## Test plan
- [ ] Backend unit + e2e suites pass at 100% coverage on new files
- [ ] Frontend unit suite passes at 100% coverage on new files
- [ ] Manual: single forward A→B, jump-to-original works
- [ ] Manual: bundle forward of 5 messages, viewer modal renders all
- [ ] Manual: re-forward chain depth limited to 1 hop
- [ ] Manual: snapshot still renders after source soft-delete

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---
