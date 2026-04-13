# DM Channel Hide/Show Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to hide DM/echo channels from the sidebar via right-click, with auto-unhide on new messages or manual reopen.

**Architecture:** Add `show_in_dm_sidebar` boolean to `channel_members` table. Backend returns the field for all DM/echo channels; frontend filters hidden channels. IM Worker auto-unhides on new message. Large workspaces (>=10 members) skip batch DM creation on join.

**Tech Stack:** Drizzle ORM (PostgreSQL), NestJS, React, TanStack React Query, Radix UI Context Menu, Socket.io

**File Writing Tips (Claude Code Known Bug Workaround):** When writing files longer than 500 lines, split into multiple writes — create with the first portion, then Edit to append ~50 lines at a time. Do NOT attempt to Write the entire file at once.

---

### Task 1: Schema — Add `show_in_dm_sidebar` to `channel_members`

**Goal:** Add the `show_in_dm_sidebar` boolean column to the `im_channel_members` table via Drizzle schema and migration.

**Files:**

- Modify: `apps/server/libs/database/src/schemas/im/channel-members.ts`
- Create: Migration file via `pnpm db:generate`

**Acceptance Criteria:**

- [ ] `show_in_dm_sidebar` column exists in `im_channel_members` with default `true`
- [ ] Existing rows remain unaffected (default true = all channels visible)
- [ ] `ChannelMember` and `NewChannelMember` types include the new field

**Verify:** `pnpm db:push` succeeds without errors; `pnpm build:server` compiles

**Steps:**

- [ ] **Step 1: Add column to Drizzle schema**

In `apps/server/libs/database/src/schemas/im/channel-members.ts`, add the new field after `notificationsEnabled`:

```typescript
showInDmSidebar: boolean('show_in_dm_sidebar').default(true).notNull(),
```

- [ ] **Step 2: Generate and apply migration**

```bash
cd apps/server && pnpm db:generate
```

Review the generated migration SQL to confirm it adds `show_in_dm_sidebar BOOLEAN NOT NULL DEFAULT true`.

```bash
pnpm db:push
```

- [ ] **Step 3: Verify build**

```bash
pnpm build:server
```

Expected: Build succeeds with no type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/server/libs/database/src/schemas/im/channel-members.ts apps/server/libs/database/drizzle/
git commit -m "feat(db): add show_in_dm_sidebar column to channel_members"
```

---

### Task 2: Backend — Expose `showInDmSidebar` in `getUserChannels` response

**Goal:** Include `showInDmSidebar` in the channel response for DM/echo channels so the frontend can filter.

**Files:**

- Modify: `apps/server/apps/gateway/src/im/channels/channels.service.ts:36-65` (ChannelWithUnread interface)
- Modify: `apps/server/apps/gateway/src/im/channels/channels.service.ts:615-749` (getUserChannels method)
- Modify: `apps/server/apps/gateway/src/im/channels/channels.service.spec.ts`

**Acceptance Criteria:**

- [ ] `ChannelWithUnread` interface includes `showInDmSidebar?: boolean`
- [ ] `getUserChannels` returns `showInDmSidebar` for DM/echo channels by reading from `channelMembers` join
- [ ] Unit tests cover the new field in response

**Verify:** `cd apps/server && npx jest --testPathPattern channels.service.spec --passWithNoTests` passes

**Steps:**

- [ ] **Step 1: Write test for showInDmSidebar in getUserChannels response**

In `apps/server/apps/gateway/src/im/channels/channels.service.spec.ts`, add a test:

```typescript
describe("getUserChannels", () => {
  it("should include showInDmSidebar in result", async () => {
    // Mock the DB chain to return a direct channel with showInDmSidebar
    const mockChannel = {
      id: "ch-1",
      tenantId: "tenant-1",
      name: null,
      description: null,
      type: "direct",
      avatarUrl: null,
      createdBy: "user-1",
      sectionId: null,
      order: 0,
      isArchived: false,
      isActivated: true,
      snapshot: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      unreadCount: 0,
      lastReadMessageId: null,
      showInDmSidebar: true,
    };
    db.where.mockResolvedValueOnce([mockChannel]);
    // Mock the batch other-user query
    db.where.mockResolvedValueOnce([]);

    const result = await service.getUserChannels("user-1", "tenant-1");
    expect(result[0]).toHaveProperty("showInDmSidebar", true);
  });
});
```

- [ ] **Step 2: Update ChannelWithUnread interface**

In `apps/server/apps/gateway/src/im/channels/channels.service.ts`, add to the `ChannelWithUnread` interface (around line 53):

```typescript
export interface ChannelWithUnread extends ChannelResponse {
  unreadCount: number;
  lastReadMessageId: string | null;
  showInDmSidebar?: boolean;
  otherUser?: {
    // ... existing fields
  };
}
```

- [ ] **Step 3: Add showInDmSidebar to getUserChannels SELECT**

In the `getUserChannels` method (line 619), add to the select object:

```typescript
showInDmSidebar: schema.channelMembers.showInDmSidebar,
```

This is selected from the `channelMembers` table which is already the `FROM` of the query, so no additional JOIN needed.

- [ ] **Step 4: Run tests**

```bash
cd apps/server && npx jest --testPathPattern channels.service.spec
```

- [ ] **Step 5: Commit**

```bash
git add apps/server/apps/gateway/src/im/channels/channels.service.ts apps/server/apps/gateway/src/im/channels/channels.service.spec.ts
git commit -m "feat(channels): expose showInDmSidebar in getUserChannels response"
```

---

### Task 3: Backend — Add sidebar visibility API endpoint

**Goal:** Create `PATCH /v1/im/channels/:id/sidebar-visibility` endpoint for toggling `showInDmSidebar`.

**Files:**

- Modify: `apps/server/apps/gateway/src/im/channels/channels.service.ts` (add `setSidebarVisibility` method)
- Modify: `apps/server/apps/gateway/src/im/channels/channels.controller.ts` (add endpoint)
- Modify: `apps/server/apps/gateway/src/im/channels/channels.controller.spec.ts`
- Modify: `apps/server/apps/gateway/src/im/channels/channels.service.spec.ts`

**Acceptance Criteria:**

- [ ] `PATCH /v1/im/channels/:id/sidebar-visibility` with `{ show: boolean }` updates the field
- [ ] Returns 400 if channel is not `direct` or `echo` type
- [ ] Only updates the current user's `channel_members` record
- [ ] Tests cover success, wrong channel type, and non-member scenarios

**Verify:** `cd apps/server && npx jest --testPathPattern "channels\.(service|controller)\.spec" --passWithNoTests` passes

**Steps:**

- [ ] **Step 1: Write service test**

In `apps/server/apps/gateway/src/im/channels/channels.service.spec.ts`:

```typescript
describe("setSidebarVisibility", () => {
  it("should update show_in_dm_sidebar for a direct channel", async () => {
    // Mock: channel lookup returns a direct channel
    db.limit.mockResolvedValueOnce([{ id: CHANNEL_ID, type: "direct" }]);
    // Mock: update returns updated row
    db.returning.mockResolvedValueOnce([{ showInDmSidebar: false }]);

    await service.setSidebarVisibility(CHANNEL_ID, USER_ID, false);

    expect(db.update).toHaveBeenCalled();
    expect(db.set).toHaveBeenCalledWith(
      expect.objectContaining({ showInDmSidebar: false }),
    );
  });

  it("should throw BadRequestException for non-DM channel", async () => {
    db.limit.mockResolvedValueOnce([{ id: CHANNEL_ID, type: "public" }]);

    await expect(
      service.setSidebarVisibility(CHANNEL_ID, USER_ID, false),
    ).rejects.toThrow(BadRequestException);
  });
});
```

- [ ] **Step 2: Implement service method**

In `apps/server/apps/gateway/src/im/channels/channels.service.ts`, add method:

```typescript
async setSidebarVisibility(
  channelId: string,
  userId: string,
  show: boolean,
): Promise<void> {
  // Verify channel is direct or echo type
  const [channel] = await this.db
    .select({ id: schema.channels.id, type: schema.channels.type })
    .from(schema.channels)
    .where(eq(schema.channels.id, channelId))
    .limit(1);

  if (!channel) {
    throw new NotFoundException('Channel not found');
  }

  if (channel.type !== 'direct' && channel.type !== 'echo') {
    throw new BadRequestException(
      'Sidebar visibility can only be changed for direct or echo channels',
    );
  }

  await this.db
    .update(schema.channelMembers)
    .set({ showInDmSidebar: show })
    .where(
      and(
        eq(schema.channelMembers.channelId, channelId),
        eq(schema.channelMembers.userId, userId),
        isNull(schema.channelMembers.leftAt),
      ),
    );
}
```

Add `NotFoundException` and `BadRequestException` to the NestJS imports if not already present.

- [ ] **Step 3: Write controller test**

In `apps/server/apps/gateway/src/im/channels/channels.controller.spec.ts`, add:

```typescript
describe("setSidebarVisibility", () => {
  it("should call service with correct args", async () => {
    channelsService.setSidebarVisibility = jest
      .fn<any>()
      .mockResolvedValue(undefined);

    await controller.setSidebarVisibility(CHANNEL_ID, { show: false }, USER_ID);

    expect(channelsService.setSidebarVisibility).toHaveBeenCalledWith(
      CHANNEL_ID,
      USER_ID,
      false,
    );
  });
});
```

- [ ] **Step 4: Add controller endpoint**

In `apps/server/apps/gateway/src/im/channels/channels.controller.ts`, add:

```typescript
@Patch(':id/sidebar-visibility')
async setSidebarVisibility(
  @Param('id', ParseUUIDPipe) id: string,
  @Body() body: { show: boolean },
  @CurrentUser('id') userId: string,
) {
  await this.channelsService.setSidebarVisibility(id, userId, body.show);
  return { success: true };
}
```

- [ ] **Step 5: Run tests and build**

```bash
cd apps/server && npx jest --testPathPattern "channels\.(service|controller)\.spec"
pnpm build:server
```

- [ ] **Step 6: Commit**

```bash
git add apps/server/apps/gateway/src/im/channels/
git commit -m "feat(channels): add PATCH sidebar-visibility endpoint"
```

---

### Task 4: IM Worker — Auto-unhide on new message

**Goal:** When a new message is processed in a DM/echo channel, set `show_in_dm_sidebar = true` for any members who have it hidden.

**Files:**

- Modify: `apps/server/apps/im-worker/src/message/message.service.ts:54-136` (processUpstreamMessage)
- Modify: `apps/server/apps/im-worker/src/message/message.service.spec.ts`

**Acceptance Criteria:**

- [ ] After message persistence, if channel is direct/echo, update `show_in_dm_sidebar = true` for all members with `show_in_dm_sidebar = false`
- [ ] Non-DM channels are not affected (no update runs)
- [ ] Unit tests cover both DM and non-DM cases

**Verify:** `cd apps/server && npx jest --testPathPattern "im-worker.*message.service.spec" --passWithNoTests` passes

**Steps:**

- [ ] **Step 1: Write test for auto-unhide**

In `apps/server/apps/im-worker/src/message/message.service.spec.ts`, add tests:

```typescript
describe("unhideDmChannelForMembers", () => {
  it("should set showInDmSidebar=true for DM channels", async () => {
    // Mock channel type lookup → 'direct'
    db.limit.mockResolvedValueOnce([{ type: "direct" }]);
    // Mock update (no-op return)
    db.where.mockResolvedValueOnce([]);

    await (service as any).unhideDmChannelForMembers("ch-dm-1");

    expect(db.update).toHaveBeenCalled();
    expect(db.set).toHaveBeenCalledWith(
      expect.objectContaining({ showInDmSidebar: true }),
    );
  });

  it("should skip unhide for public channels", async () => {
    db.limit.mockResolvedValueOnce([{ type: "public" }]);

    await (service as any).unhideDmChannelForMembers("ch-pub-1");

    expect(db.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Add unhide method to MessageService**

In `apps/server/apps/im-worker/src/message/message.service.ts`, add a private method:

```typescript
/**
 * For DM/echo channels, ensure all members have the channel visible in sidebar.
 * This runs after message persistence to auto-unhide channels when new messages arrive.
 */
private async unhideDmChannelForMembers(channelId: string): Promise<void> {
  // Check channel type
  const [channel] = await this.db
    .select({ type: schema.channels.type })
    .from(schema.channels)
    .where(eq(schema.channels.id, channelId))
    .limit(1);

  if (!channel || (channel.type !== 'direct' && channel.type !== 'echo')) {
    return;
  }

  // Set showInDmSidebar = true for any hidden members
  await this.db
    .update(schema.channelMembers)
    .set({ showInDmSidebar: true })
    .where(
      and(
        eq(schema.channelMembers.channelId, channelId),
        eq(schema.channelMembers.showInDmSidebar, false),
      ),
    );
}
```

- [ ] **Step 3: Call unhide in processUpstreamMessage**

In `processUpstreamMessage`, after line 113 (`await this.updateUnreadCounts(...)`), add:

```typescript
// Auto-unhide DM/echo channels when new message arrives
await this.unhideDmChannelForMembers(message.targetId);
```

- [ ] **Step 4: Run tests**

```bash
cd apps/server && npx jest --testPathPattern "im-worker.*message.service.spec"
```

- [ ] **Step 5: Commit**

```bash
git add apps/server/apps/im-worker/src/message/
git commit -m "feat(im-worker): auto-unhide DM channels on new message"
```

---

### Task 5: Backend — Conditional batch DM creation on workspace join

**Goal:** Skip batch DM creation when a workspace has 10+ members.

**Files:**

- Modify: `apps/server/apps/gateway/src/workspace/workspace.service.ts:590-619`
- Modify: `apps/server/apps/gateway/src/workspace/workspace.service.spec.ts`

**Acceptance Criteria:**

- [ ] Workspaces with < 10 members: batch DM creation still runs on join
- [ ] Workspaces with >= 10 members: batch DM creation is skipped
- [ ] Tests cover both thresholds

**Verify:** `cd apps/server && npx jest --testPathPattern workspace.service.spec --passWithNoTests` passes

**Steps:**

- [ ] **Step 1: Write tests**

In `apps/server/apps/gateway/src/workspace/workspace.service.spec.ts`, add:

```typescript
describe("acceptInvitation - batch DM creation", () => {
  it("should create DM channels for workspaces with < 10 members", async () => {
    // Mock getWorkspaceMemberCount → 5
    jest.spyOn(service as any, "getWorkspaceMemberCount").mockResolvedValue(5);
    // Setup other mocks for acceptInvitation flow...
    // (invitation lookup, user lookup, tenant member insert, etc.)

    await service.acceptInvitation(USER_ID, "invite-code");

    expect(channelsService.createDirectChannelsBatch).toHaveBeenCalled();
  });

  it("should skip DM channel creation for workspaces with >= 10 members", async () => {
    jest.spyOn(service as any, "getWorkspaceMemberCount").mockResolvedValue(15);
    // Setup other mocks for acceptInvitation flow...

    await service.acceptInvitation(USER_ID, "invite-code");

    expect(channelsService.createDirectChannelsBatch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Add member count check before batch DM creation**

In `apps/server/apps/gateway/src/workspace/workspace.service.ts`, around line 591, wrap the existing batch DM creation in a count check. The `getWorkspaceMemberCount` method already exists at line 1365:

```typescript
// Create DM channels only for small workspaces (< 10 members)
const memberCount = await this.getWorkspaceMemberCount(invitation.tenantId);

if (memberCount < 10) {
  try {
    const existingMembers = await this.db;
    // ... existing batch DM creation code unchanged ...
  } catch (error) {
    this.logger.warn("Failed to create DM channels for new member", error);
  }
}
```

- [ ] **Step 3: Run tests**

```bash
cd apps/server && npx jest --testPathPattern workspace.service.spec
```

- [ ] **Step 4: Commit**

```bash
git add apps/server/apps/gateway/src/workspace/workspace.service.ts apps/server/apps/gateway/src/workspace/workspace.service.spec.ts
git commit -m "feat(workspace): skip batch DM creation for workspaces with 10+ members"
```

---

### Task 6: Frontend — Update types and API client

**Goal:** Add `showInDmSidebar` to frontend types and add the API function for toggling visibility.

**Files:**

- Modify: `apps/client/src/types/im.ts:109-122` (ChannelWithUnread)
- Modify: `apps/client/src/services/api/im.ts` (channelsApi)
- Modify: `apps/client/src/hooks/useChannels.ts` (add mutation hook)

**Acceptance Criteria:**

- [ ] `ChannelWithUnread` type includes `showInDmSidebar?: boolean`
- [ ] `channelsApi.setSidebarVisibility(channelId, show)` function exists
- [ ] `useSetSidebarVisibility` mutation hook exists with optimistic cache update

**Verify:** `pnpm build:client` succeeds

**Steps:**

- [ ] **Step 1: Update ChannelWithUnread type**

In `apps/client/src/types/im.ts`, add to `ChannelWithUnread` interface (line 109):

```typescript
export interface ChannelWithUnread extends Channel {
  unreadCount: number;
  lastReadMessageId?: string;
  lastReadAt?: string;
  showInDmSidebar?: boolean;
  otherUser?: {
    // ... existing fields unchanged
  };
}
```

- [ ] **Step 2: Add API function**

In `apps/client/src/services/api/im.ts`, add to `channelsApi` object:

```typescript
// Set sidebar visibility for DM/echo channels
setSidebarVisibility: async (
  channelId: string,
  show: boolean,
): Promise<void> => {
  await http.patch(`/v1/im/channels/${channelId}/sidebar-visibility`, {
    show,
  });
},
```

- [ ] **Step 3: Add mutation hook**

In `apps/client/src/hooks/useChannels.ts`, add:

```typescript
/**
 * Hook to toggle DM/echo channel sidebar visibility
 */
export function useSetSidebarVisibility() {
  const queryClient = useQueryClient();
  const workspaceId = useSelectedWorkspaceId();

  return useMutation({
    mutationFn: ({ channelId, show }: { channelId: string; show: boolean }) =>
      imApi.channels.setSidebarVisibility(channelId, show),
    onMutate: async ({ channelId, show }) => {
      await queryClient.cancelQueries({
        queryKey: ["channels", workspaceId],
      });

      const previous = queryClient.getQueryData<ChannelWithUnread[]>([
        "channels",
        workspaceId,
      ]);

      queryClient.setQueryData(
        ["channels", workspaceId],
        (old: ChannelWithUnread[] | undefined) => {
          if (!old) return old;
          return old.map((ch) =>
            ch.id === channelId ? { ...ch, showInDmSidebar: show } : ch,
          );
        },
      );

      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["channels", workspaceId], context.previous);
      }
    },
  });
}
```

- [ ] **Step 4: Build to verify**

```bash
pnpm build:client
```

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/types/im.ts apps/client/src/services/api/im.ts apps/client/src/hooks/useChannels.ts
git commit -m "feat(client): add showInDmSidebar type, API, and mutation hook"
```

---

### Task 7: Frontend — Right-click context menu and sidebar filtering

**Goal:** Add right-click "Hide Conversation" context menu to DM channels and filter hidden channels from sidebar.

**Files:**

- Modify: `apps/client/src/components/layout/sidebars/MessagesSubSidebar.tsx`
- Modify: `apps/client/src/hooks/useChannels.ts:97-119` (useChannelsByType filter)
- Modify: `apps/client/src/i18n/locales/en/navigation.json`
- Modify: `apps/client/src/i18n/locales/zh-CN/navigation.json`
- Modify all other locale files (`de`, `es`, `fr`, `it`, `ja`, `ko`, `nl`, `pt`, `ru`, `zh-TW`)

**Acceptance Criteria:**

- [ ] Right-clicking a DM/echo channel shows a context menu with "Hide Conversation"
- [ ] Clicking "Hide Conversation" calls `useSetSidebarVisibility` with `show: false`
- [ ] Channel immediately disappears from sidebar (optimistic update)
- [ ] `useChannelsByType` filters out channels with `showInDmSidebar === false`
- [ ] i18n keys added for all supported locales

**Verify:** `pnpm build:client` succeeds; manual test: right-click DM → "Hide Conversation" → channel disappears

**Steps:**

- [ ] **Step 1: Add i18n keys**

In `apps/client/src/i18n/locales/en/navigation.json`, add:

```json
"hideConversation": "Hide Conversation"
```

In `apps/client/src/i18n/locales/zh-CN/navigation.json`, add:

```json
"hideConversation": "隐藏对话"
```

Add equivalent translations for all other locales:

- `de`: `"hideConversation": "Konversation ausblenden"`
- `es`: `"hideConversation": "Ocultar conversación"`
- `fr`: `"hideConversation": "Masquer la conversation"`
- `it`: `"hideConversation": "Nascondi conversazione"`
- `ja`: `"hideConversation": "会話を非表示"`
- `ko`: `"hideConversation": "대화 숨기기"`
- `nl`: `"hideConversation": "Gesprek verbergen"`
- `pt`: `"hideConversation": "Ocultar conversa"`
- `ru`: `"hideConversation": "Скрыть беседу"`
- `zh-TW`: `"hideConversation": "隱藏對話"`

- [ ] **Step 2: Update useChannelsByType to filter hidden channels**

In `apps/client/src/hooks/useChannels.ts`, modify the `directChannels` filter (line 106):

```typescript
const directChannels = channels.filter(
  (ch) =>
    (ch.type === "direct" || ch.type === "echo") &&
    ch.showInDmSidebar !== false,
);
```

- [ ] **Step 3: Add context menu to MessagesSubSidebar**

In `apps/client/src/components/layout/sidebars/MessagesSubSidebar.tsx`:

Add imports:

```typescript
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { EyeOff } from "lucide-react";
import { useSetSidebarVisibility } from "@/hooks/useChannels";
```

Add the mutation hook inside the component:

```typescript
const setSidebarVisibility = useSetSidebarVisibility();
```

Wrap each DM `UserListItem` in a `ContextMenu`:

```tsx
{
  directMessageUsers.map((dm) => (
    <ContextMenu key={dm.id}>
      <ContextMenuTrigger asChild>
        <div>
          <UserListItem
            name={dm.name}
            avatarUrl={dm.avatarUrl}
            userId={dm.userId}
            isSelected={selectedChannelId === dm.channelId}
            unreadCount={dm.unreadCount}
            channelId={dm.channelId}
            linkPrefix="/messages"
            isBot={dm.isBot}
            agentType={dm.agentType}
          />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem
          onClick={() =>
            setSidebarVisibility.mutate({
              channelId: dm.channelId,
              show: false,
            })
          }
        >
          <EyeOff className="mr-2 h-4 w-4" />
          {t("hideConversation")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  ));
}
```

- [ ] **Step 4: Build and verify**

```bash
pnpm build:client
```

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/components/layout/sidebars/MessagesSubSidebar.tsx apps/client/src/hooks/useChannels.ts apps/client/src/i18n/
git commit -m "feat(client): add right-click hide for DM channels and sidebar filtering"
```

---

### Task 8: Frontend — Auto-unhide on new WebSocket message

**Goal:** When a `new_message` WebSocket event arrives for a hidden DM/echo channel, set `showInDmSidebar = true` in the React Query cache so the channel reappears immediately.

**Files:**

- Modify: `apps/client/src/hooks/useWebSocketEvents.ts:82-105` (handleNewMessage)

**Acceptance Criteria:**

- [ ] When `new_message` arrives for a channel with `showInDmSidebar === false`, it is flipped to `true` in cache
- [ ] Channel immediately appears in sidebar without API call (IM Worker handles persistence)
- [ ] Existing unread count increment logic is preserved

**Verify:** `pnpm build:client` succeeds

**Steps:**

- [ ] **Step 1: Modify handleNewMessage**

In `apps/client/src/hooks/useWebSocketEvents.ts`, update the `handleNewMessage` function (line 82). In the cache update mapper (line 94), add `showInDmSidebar: true` alongside the unread count increment:

```typescript
const handleNewMessage = (message: Message) => {
  if (message.senderId === currentUser?.id || message.parentId) {
    return;
  }

  queryClient.setQueryData(
    ["channels", workspaceId],
    (old: ChannelWithUnread[] | undefined) => {
      if (!old) return old;

      return old.map((channel) => {
        if (channel.id === message.channelId) {
          return {
            ...channel,
            unreadCount: (channel.unreadCount || 0) + 1,
            // Auto-unhide DM/echo channels when new message arrives
            showInDmSidebar: true,
          };
        }
        return channel;
      });
    },
  );
};
```

- [ ] **Step 2: Build to verify**

```bash
pnpm build:client
```

- [ ] **Step 3: Commit**

```bash
git add apps/client/src/hooks/useWebSocketEvents.ts
git commit -m "feat(client): auto-unhide DM channels on new WebSocket message"
```

---

### Task 9: Frontend — Unhide on search/open conversation

**Goal:** When a user opens a hidden DM channel (via search or direct navigation), call the API to set `showInDmSidebar = true`.

**Files:**

- Modify: `apps/client/src/hooks/useChannels.ts` (useCreateDirectChannel)
- Modify: `apps/client/src/components/layout/sidebars/MessagesSubSidebar.tsx` (handleMemberClick)

**Acceptance Criteria:**

- [ ] When user clicks a workspace member to start a DM, and that DM exists but is hidden, it is unhidden
- [ ] When user creates a new DM, it defaults to visible (no extra action needed)

**Verify:** `pnpm build:client` succeeds

**Steps:**

- [ ] **Step 1: Update handleMemberClick to unhide existing hidden channels**

In `apps/client/src/components/layout/sidebars/MessagesSubSidebar.tsx`, the `handleMemberClick` function (line 69) already creates or gets the DM channel. After creating/getting the channel, check if it was hidden and unhide it.

First, get access to all channels including hidden ones. Update the destructuring from `useChannelsByType`:

```typescript
const { directChannels = [], isLoading: isLoadingChannels } =
  useChannelsByType();
```

We need the raw channels list too. Modify `useChannelsByType` in `useChannels.ts` to also return `allDirectChannels` (unfiltered):

```typescript
const allDirectChannels = channels.filter(
  (ch) => ch.type === "direct" || ch.type === "echo",
);
const directChannels = allDirectChannels.filter(
  (ch) => ch.showInDmSidebar !== false,
);

return {
  channels,
  publicChannels,
  privateChannels,
  directChannels,
  allDirectChannels,
  archivedChannels,
  ...rest,
};
```

Then in `MessagesSubSidebar.tsx`, update `handleMemberClick`:

```typescript
const {
  directChannels = [],
  allDirectChannels = [],
  isLoading: isLoadingChannels,
} = useChannelsByType();

const handleMemberClick = async (memberId: string) => {
  try {
    const channel = await createDirectChannel.mutateAsync(memberId);

    // If channel was hidden, unhide it
    const existing = allDirectChannels.find((ch) => ch.id === channel.id);
    if (existing && existing.showInDmSidebar === false) {
      setSidebarVisibility.mutate({ channelId: channel.id, show: true });
    }

    navigate({
      to: "/messages/$channelId",
      params: { channelId: channel.id },
    });
  } catch (error) {
    console.error("Failed to create/open direct channel:", error);
  }
};
```

- [ ] **Step 2: Build to verify**

```bash
pnpm build:client
```

- [ ] **Step 3: Commit**

```bash
git add apps/client/src/hooks/useChannels.ts apps/client/src/components/layout/sidebars/MessagesSubSidebar.tsx
git commit -m "feat(client): unhide DM channel when user opens conversation"
```
