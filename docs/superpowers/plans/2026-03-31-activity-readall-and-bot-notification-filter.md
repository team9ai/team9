# Activity Read All and Bot Notification Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tab-scoped `Read All` action to Activity and stop generating Activity notifications for tracking-channel noise and bot-sent DMs.

**Architecture:** The gateway notification API gains an optional `types` query filter so one endpoint can mark either all notifications or only the types represented by the active Activity tab. The client derives the current tab’s notification types and updates both remote state and the local Zustand store consistently. Separately, the IM worker keeps normal message delivery intact but short-circuits notification task publication for tracking channels and bot-authored direct messages.

**Tech Stack:** NestJS, Jest, React, TypeScript, Zustand, TanStack React Query, Vitest

**Spec:** `docs/superpowers/specs/2026-03-31-activity-readall-and-bot-notification-filter-design.md`

---

## File Structure

| Action | File                                                                               | Responsibility                                                       |
| ------ | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Modify | `apps/server/apps/gateway/src/notification/notification.controller.ts`             | Accept `types` filter on `mark-all-read`                             |
| Modify | `apps/server/apps/gateway/src/notification/notification.service.ts`                | Apply `types` filter in bulk read update                             |
| Create | `apps/server/apps/gateway/src/notification/notification.service.spec.ts`           | Regression tests for `markAllAsRead(..., types)`                     |
| Modify | `apps/client/src/services/api/notification.ts`                                     | Send `types` as query params instead of request body                 |
| Modify | `apps/client/src/hooks/useNotifications.ts`                                        | Thread `types` through the mutation and store update                 |
| Modify | `apps/client/src/stores/useNotificationStore.ts`                                   | Support scoped `markAllAsRead` and correct count recomputation       |
| Modify | `apps/client/src/components/layout/sidebars/ActivitySubSidebar.tsx`                | Add `Read All` button beside `Unread` and derive current tab types   |
| Create | `apps/client/src/stores/__tests__/useNotificationStore.test.ts`                    | Unit tests for scoped store updates                                  |
| Create | `apps/client/src/components/layout/sidebars/__tests__/ActivitySubSidebar.test.tsx` | UI tests for `Read All` tab behavior                                 |
| Modify | `apps/server/apps/im-worker/src/post-broadcast/post-broadcast.service.ts`          | Skip notification task publication for tracking channels and bot DMs |
| Modify | `apps/server/apps/im-worker/src/post-broadcast/post-broadcast.service.spec.ts`     | Regression tests for the new notification guards                     |

---

## Task 1: Gateway notification API supports `types[]` filtering

**Files:**

- Modify: `apps/server/apps/gateway/src/notification/notification.controller.ts`
- Modify: `apps/server/apps/gateway/src/notification/notification.service.ts`
- Create: `apps/server/apps/gateway/src/notification/notification.service.spec.ts`

- [ ] **Step 1: Write the failing service tests**

Create `apps/server/apps/gateway/src/notification/notification.service.spec.ts` with focused coverage for the new filter behavior:

```typescript
import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { NotificationService } from "./notification.service.js";
import * as database from "@team9/database";
import * as schema from "@team9/database/schemas";

type MockFn = jest.Mock<(...args: any[]) => any>;

function mockDb() {
  const chain: Record<string, MockFn> = {
    update: jest.fn<any>(),
    set: jest.fn<any>(),
    where: jest.fn<any>(),
  };

  chain.update.mockReturnValue(chain);
  chain.set.mockReturnValue(chain);
  chain.where.mockResolvedValue([]);

  return chain;
}

describe("NotificationService.markAllAsRead", () => {
  let service: NotificationService;
  let db: ReturnType<typeof mockDb>;
  let inArraySpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    db = mockDb();
    inArraySpy = jest.spyOn(database, "inArray");
    service = new NotificationService(db as any);
  });

  it("marks all unread notifications when no filters are provided", async () => {
    await service.markAllAsRead("user-1");

    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.where).toHaveBeenCalledTimes(1);
  });

  it("supports filtering by notification types", async () => {
    await service.markAllAsRead("user-1", undefined, ["mention", "reply"]);

    expect(inArraySpy).toHaveBeenCalledWith(schema.notifications.type, [
      "mention",
      "reply",
    ]);
  });

  it("supports category and type filters together", async () => {
    await service.markAllAsRead("user-1", "message", ["thread_reply"]);

    expect(inArraySpy).toHaveBeenCalledWith(schema.notifications.type, [
      "thread_reply",
    ]);
  });
});
```

- [ ] **Step 2: Run the gateway test to verify RED**

Run:

```bash
cd apps/server/apps/gateway
NODE_OPTIONS='--experimental-vm-modules' pnpm test -- src/notification/notification.service.spec.ts
```

Expected: FAIL because `markAllAsRead` ignores the third argument, so the new assertions that `inArray(...)` is used for `types` filtering should fail.

- [ ] **Step 3: Implement `types` parsing in the controller and service**

Update `apps/server/apps/gateway/src/notification/notification.controller.ts` so `mark-all-read` accepts a comma-separated `types` query and forwards a typed array:

```typescript
import type { NotificationType } from "@team9/database/schemas";

// inside markAllAsRead()
const parsedTypes = types
  ? (types
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean) as NotificationType[])
  : undefined;

await this.notificationService.markAllAsRead(userId, category, parsedTypes);
```

The full method signature should become:

```typescript
async markAllAsRead(
  @CurrentUser('sub') userId: string,
  @Query('category') category?: string,
  @Query('types') types?: string,
): Promise<{ success: boolean }> {
  const parsedTypes = types
    ? types
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean) as NotificationType[]
    : undefined;

  await this.notificationService.markAllAsRead(
    userId,
    category,
    parsedTypes,
  );

  const counts = await this.notificationService.getUnreadCounts(userId);
  await this.deliveryService.broadcastCountsUpdate(userId, counts);

  return { success: true };
}
```

Update `apps/server/apps/gateway/src/notification/notification.service.ts` so the method accepts the optional filter and applies it to the `and(...)` clause:

```typescript
async markAllAsRead(
  userId: string,
  category?: string,
  types?: NotificationType[],
): Promise<void> {
  const conditions = [
    eq(schema.notifications.userId, userId),
    eq(schema.notifications.isRead, false),
  ];

  if (category) {
    conditions.push(
      eq(schema.notifications.category, category as NotificationCategory),
    );
  }

  if (types?.length) {
    conditions.push(inArray(schema.notifications.type, types));
  }

  await this.db
    .update(schema.notifications)
    .set({
      isRead: true,
      readAt: new Date(),
    })
    .where(and(...conditions));
}
```

- [ ] **Step 4: Run the gateway test to verify GREEN**

Run:

```bash
cd apps/server/apps/gateway
NODE_OPTIONS='--experimental-vm-modules' pnpm test -- src/notification/notification.service.spec.ts
```

Expected: PASS with all `NotificationService.markAllAsRead` tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/server/apps/gateway/src/notification/notification.controller.ts \
        apps/server/apps/gateway/src/notification/notification.service.ts \
        apps/server/apps/gateway/src/notification/notification.service.spec.ts
git commit -m "feat(notification): add type-scoped mark-all-read support"
```

---

## Task 2: Client notification API and store support tab-scoped `Read All`

**Files:**

- Modify: `apps/client/src/services/api/notification.ts`
- Modify: `apps/client/src/hooks/useNotifications.ts`
- Modify: `apps/client/src/stores/useNotificationStore.ts`
- Create: `apps/client/src/stores/__tests__/useNotificationStore.test.ts`

- [ ] **Step 1: Write the failing store tests**

Create `apps/client/src/stores/__tests__/useNotificationStore.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import {
  useNotificationStore,
  notificationActions,
  type Notification,
} from "../useNotificationStore";

const base = (overrides: Partial<Notification>): Notification => ({
  id: crypto.randomUUID(),
  category: "message",
  type: "mention",
  priority: "normal",
  title: "Title",
  body: null,
  actor: null,
  tenantId: null,
  channelId: "channel-1",
  messageId: "message-1",
  actionUrl: null,
  isRead: false,
  readAt: null,
  createdAt: new Date().toISOString(),
  ...overrides,
});

describe("useNotificationStore.markAllAsRead", () => {
  beforeEach(() => {
    notificationActions.reset();
  });

  it("marks only the requested types as read", () => {
    notificationActions.setNotifications([
      base({ id: "n1", type: "mention" }),
      base({ id: "n2", type: "reply" }),
      base({ id: "n3", type: "dm_received" }),
    ]);
    notificationActions.setCounts({
      total: 3,
      byCategory: { message: 3, system: 0, workspace: 0 },
      byType: {
        mention: 1,
        channel_mention: 0,
        everyone_mention: 0,
        here_mention: 0,
        reply: 1,
        thread_reply: 0,
        dm_received: 1,
        system_announcement: 0,
        maintenance_notice: 0,
        version_update: 0,
        workspace_invitation: 0,
        role_changed: 0,
        member_joined: 0,
        member_left: 0,
        channel_invite: 0,
      },
    });

    useNotificationStore.getState().markAllAsRead(undefined, ["mention"]);

    const state = useNotificationStore.getState();
    expect(state.notifications.find((n) => n.id === "n1")?.isRead).toBe(true);
    expect(state.notifications.find((n) => n.id === "n2")?.isRead).toBe(false);
    expect(state.counts.total).toBe(2);
    expect(state.counts.byType.mention).toBe(0);
    expect(state.counts.byType.reply).toBe(1);
  });

  it("still supports the existing category-wide behavior", () => {
    notificationActions.setNotifications([
      base({ id: "n1", category: "message", type: "mention" }),
      base({ id: "n2", category: "system", type: "system_announcement" }),
    ]);

    useNotificationStore.getState().markAllAsRead("message");

    const state = useNotificationStore.getState();
    expect(state.notifications.find((n) => n.id === "n1")?.isRead).toBe(true);
    expect(state.notifications.find((n) => n.id === "n2")?.isRead).toBe(false);
  });
});
```

- [ ] **Step 2: Run the client store test to verify RED**

Run:

```bash
cd apps/client
pnpm test -- src/stores/__tests__/useNotificationStore.test.ts
```

Expected: FAIL because `markAllAsRead` does not accept a second `types` argument and the count recalculation logic only understands category-wide updates.

- [ ] **Step 3: Thread `types` through API, mutation, and store**

Update `apps/client/src/services/api/notification.ts`:

```typescript
import type {
  Notification,
  NotificationCategory,
  NotificationCounts,
  NotificationType,
} from "../../stores/useNotificationStore";

export interface MarkAllReadRequest {
  category?: NotificationCategory;
  types?: NotificationType[];
}

markAllAsRead: async (
  category?: NotificationCategory,
  types?: NotificationType[],
): Promise<void> => {
  await http.post<void>(
    "/v1/notifications/mark-all-read",
    {},
    {
      params: {
        ...(category ? { category } : {}),
        ...(types?.length ? { types: types.join(",") } : {}),
      },
    },
  );
},
```

Update `apps/client/src/hooks/useNotifications.ts` so the mutation accepts an object payload:

```typescript
type MarkAllAsReadInput = {
  category?: NotificationCategory;
  types?: NotificationType[];
};

return useMutation({
  mutationFn: async ({ category, types }: MarkAllAsReadInput) => {
    await notificationApi.markAllAsRead(category, types);
    return { category, types };
  },
  onSuccess: ({ category, types }) => {
    notificationActions.markAllAsRead(category, types);
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
    queryClient.invalidateQueries({ queryKey: ["notificationCounts"] });
  },
});
```

Update `apps/client/src/stores/useNotificationStore.ts` so both the store API and exported action accept `types?: NotificationType[]`. Replace the `markAllAsRead` implementation with a count-safe recomputation based on the notifications that were actually transitioned from unread to read:

```typescript
markAllAsRead: (category, types) =>
  set(
    (state) => {
      const now = new Date().toISOString();
      const shouldMark = (notification: Notification) =>
        (!category || notification.category === category) &&
        (!types?.length || types.includes(notification.type));

      const affected = state.notifications.filter(
        (notification) => !notification.isRead && shouldMark(notification),
      );

      if (affected.length === 0) {
        return state;
      }

      const nextByType = { ...state.counts.byType };
      const nextByCategory = { ...state.counts.byCategory };

      for (const notification of affected) {
        nextByType[notification.type] = Math.max(
          0,
          nextByType[notification.type] - 1,
        );
        nextByCategory[notification.category] = Math.max(
          0,
          nextByCategory[notification.category] - 1,
        );
      }

      return {
        notifications: state.notifications.map((notification) =>
          shouldMark(notification) && !notification.isRead
            ? { ...notification, isRead: true, readAt: now }
            : notification,
        ),
        counts: {
          total: Math.max(0, state.counts.total - affected.length),
          byCategory: nextByCategory,
          byType: nextByType,
        },
      };
    },
    false,
    "markAllAsRead",
  ),
```

Also update the action export:

```typescript
markAllAsRead: (category?: NotificationCategory, types?: NotificationType[]) =>
  useNotificationStore.getState().markAllAsRead(category, types),
```

- [ ] **Step 4: Run the client store test to verify GREEN**

Run:

```bash
cd apps/client
pnpm test -- src/stores/__tests__/useNotificationStore.test.ts
```

Expected: PASS with both scoped and category-wide behaviors green.

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/services/api/notification.ts \
        apps/client/src/hooks/useNotifications.ts \
        apps/client/src/stores/useNotificationStore.ts \
        apps/client/src/stores/__tests__/useNotificationStore.test.ts
git commit -m "feat(activity): support scoped read-all notification updates"
```

---

## Task 3: Activity sidebar exposes the tab-scoped `Read All` button

**Files:**

- Modify: `apps/client/src/components/layout/sidebars/ActivitySubSidebar.tsx`
- Create: `apps/client/src/components/layout/sidebars/__tests__/ActivitySubSidebar.test.tsx`

- [ ] **Step 1: Write the failing Activity sidebar tests**

Create `apps/client/src/components/layout/sidebars/__tests__/ActivitySubSidebar.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ActivitySubSidebar } from "../ActivitySubSidebar";
import { notificationActions } from "@/stores/useNotificationStore";

const markAllAsRead = vi.fn();

vi.mock("@/hooks/useNotifications", () => ({
  useNotifications: () => ({ isLoading: false }),
  useMarkNotificationsAsRead: () => ({ mutate: vi.fn() }),
  useMarkAllNotificationsAsRead: () => ({ mutate: markAllAsRead }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        activity: "Activity",
        activityAll: "All",
        activityMentions: "Mentions",
        activityThreads: "Threads",
        activityUnread: "Unread",
        markAllAsRead: "Mark all as read",
        noActivity: "No activity yet",
      })[key] ?? key,
  }),
}));

describe("ActivitySubSidebar", () => {
  beforeEach(() => {
    markAllAsRead.mockReset();
    notificationActions.reset();
    notificationActions.setNotifications([
      {
        id: "mention-1",
        category: "message",
        type: "mention",
        priority: "normal",
        title: "Mention",
        body: null,
        actor: null,
        tenantId: null,
        channelId: "channel-1",
        messageId: "message-1",
        actionUrl: null,
        isRead: false,
        readAt: null,
        createdAt: new Date().toISOString(),
      },
      {
        id: "reply-1",
        category: "message",
        type: "reply",
        priority: "normal",
        title: "Reply",
        body: null,
        actor: null,
        tenantId: null,
        channelId: "channel-1",
        messageId: "message-2",
        actionUrl: null,
        isRead: false,
        readAt: null,
        createdAt: new Date().toISOString(),
      },
    ]);
  });

  it("marks all notifications when All tab is active", () => {
    render(<ActivitySubSidebar />);

    fireEvent.click(screen.getByText("Mark all as read"));

    expect(markAllAsRead).toHaveBeenCalledWith({});
  });

  it("marks only mention notification types when Mentions tab is active", () => {
    render(<ActivitySubSidebar />);

    fireEvent.click(screen.getByText("Mentions"));
    fireEvent.click(screen.getByText("Mark all as read"));

    expect(markAllAsRead).toHaveBeenCalledWith({
      types: ["mention", "channel_mention", "everyone_mention", "here_mention"],
    });
  });

  it("disables the button when the current filtered tab has no unread notifications", () => {
    notificationActions.reset();
    notificationActions.setNotifications([
      {
        id: "dm-1",
        category: "message",
        type: "dm_received",
        priority: "normal",
        title: "DM",
        body: null,
        actor: null,
        tenantId: null,
        channelId: "channel-1",
        messageId: "message-3",
        actionUrl: null,
        isRead: false,
        readAt: null,
        createdAt: new Date().toISOString(),
      },
    ]);

    render(<ActivitySubSidebar />);
    fireEvent.click(screen.getByText("Threads"));

    expect(screen.getByText("Mark all as read")).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run the sidebar test to verify RED**

Run:

```bash
cd apps/client
pnpm test -- src/components/layout/sidebars/__tests__/ActivitySubSidebar.test.tsx
```

Expected: FAIL because the sidebar does not render a `Read All` button and does not call the bulk mutation at all.

- [ ] **Step 3: Implement the Activity sidebar behavior**

Update `apps/client/src/components/layout/sidebars/ActivitySubSidebar.tsx`:

```tsx
import {
  useMarkAllNotificationsAsRead,
  useMarkNotificationsAsRead,
} from "@/hooks/useNotifications";
import {
  useNotifications as useNotificationsFromStore,
  useActivityTab,
  useShowUnreadOnly,
  notificationActions,
  filterNotifications,
  MENTION_TYPES,
  THREAD_TYPES,
  type ActivityTab,
  type NotificationType,
} from "@/stores/useNotificationStore";

const tabTypes: Record<ActivityTab, NotificationType[] | undefined> = {
  all: undefined,
  mentions: MENTION_TYPES,
  threads: THREAD_TYPES,
};

const { mutate: markAllAsRead, isPending: isMarkingAllAsRead } =
  useMarkAllNotificationsAsRead();

const unreadInCurrentTab = notifications.some(
  (notification) => !notification.isRead,
);

const handleReadAll = () => {
  const types = tabTypes[activeTab];
  markAllAsRead(types?.length ? { types } : {});
};
```

Render the new button immediately next to the existing `Unread` toggle:

```tsx
<div className="flex items-center gap-2">
  <Button
    variant="ghost"
    size="sm"
    onClick={toggleUnreadOnly}
    className={cn(
      "h-7 px-2 text-xs",
      showUnreadOnly
        ? "bg-accent/30 text-nav-foreground hover:bg-accent/40"
        : "text-nav-foreground-subtle hover:text-nav-foreground hover:bg-nav-hover",
    )}
  >
    {t("activityUnread")}
  </Button>
  <Button
    variant="ghost"
    size="sm"
    onClick={handleReadAll}
    disabled={!unreadInCurrentTab || isMarkingAllAsRead}
    className="h-7 px-2 text-xs text-nav-foreground-subtle hover:text-nav-foreground hover:bg-nav-hover"
  >
    {t("markAllAsRead", { ns: "message" })}
  </Button>
</div>
```

- [ ] **Step 4: Run the sidebar test to verify GREEN**

Run:

```bash
cd apps/client
pnpm test -- src/components/layout/sidebars/__tests__/ActivitySubSidebar.test.tsx
```

Expected: PASS with the button rendered beside `Unread`, the tab-specific payloads sent correctly, and the disabled state working.

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/components/layout/sidebars/ActivitySubSidebar.tsx \
        apps/client/src/components/layout/sidebars/__tests__/ActivitySubSidebar.test.tsx
git commit -m "feat(activity): add tab-scoped read-all action"
```

---

## Task 4: IM worker suppresses Activity noise from tracking channels and bot DMs

**Files:**

- Modify: `apps/server/apps/im-worker/src/post-broadcast/post-broadcast.service.ts`
- Modify: `apps/server/apps/im-worker/src/post-broadcast/post-broadcast.service.spec.ts`

- [ ] **Step 1: Write the failing notification-guard tests**

Append the following block to `apps/server/apps/im-worker/src/post-broadcast/post-broadcast.service.spec.ts`:

```typescript
describe("PostBroadcastService — notification task guards", () => {
  let service: PostBroadcastService;
  let db: ReturnType<typeof mockDb>;
  let rabbitMQEventService: { publishNotificationTask: MockFn };

  beforeEach(async () => {
    db = mockDb();
    rabbitMQEventService = {
      publishNotificationTask: jest.fn<any>().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostBroadcastService,
        { provide: DATABASE_CONNECTION, useValue: db },
        { provide: RabbitMQEventService, useValue: rabbitMQEventService },
        { provide: ClawHiveService, useValue: { sendInput: jest.fn<any>() } },
        {
          provide: MessageRouterService,
          useValue: { routeMessage: jest.fn<any>().mockResolvedValue({}) },
        },
        {
          provide: SequenceService,
          useValue: {
            generateChannelSeq: jest.fn<any>().mockResolvedValue(BigInt(1)),
          },
        },
      ],
    }).compile();

    service = module.get<PostBroadcastService>(PostBroadcastService);
  });

  it("does not publish notifications for tracking channels", async () => {
    jest.spyOn(service as any, "getMessageWithContext").mockResolvedValue({
      message: makeMessage(),
      sender: { ...makeSender(), userType: "bot" },
      channel: makeChannel("tracking"),
      mentions: [],
      parentMessage: null,
    });

    await service.processNotificationTasks(MSG_ID, CHANNEL_ID, SENDER_ID);

    expect(rabbitMQEventService.publishNotificationTask).not.toHaveBeenCalled();
  });

  it("does not publish DM notifications for bot-authored direct messages", async () => {
    jest.spyOn(service as any, "getMessageWithContext").mockResolvedValue({
      message: makeMessage(),
      sender: { ...makeSender(), userType: "bot" },
      channel: makeChannel("direct"),
      mentions: [],
      parentMessage: null,
    });
    jest
      .spyOn(service as any, "getChannelMemberIds")
      .mockResolvedValue([SENDER_ID, "recipient-1"]);

    await service.processNotificationTasks(MSG_ID, CHANNEL_ID, SENDER_ID);

    expect(rabbitMQEventService.publishNotificationTask).not.toHaveBeenCalled();
  });

  it("still publishes mention notifications for bot messages in normal channels", async () => {
    jest.spyOn(service as any, "getMessageWithContext").mockResolvedValue({
      message: makeMessage({
        content: '<mention data-user-id=\"recipient-1\">@Bob</mention>',
      }),
      sender: { ...makeSender(), userType: "bot" },
      channel: makeChannel("public"),
      mentions: [{ userId: "recipient-1", type: "mention" }],
      parentMessage: null,
    });

    await service.processNotificationTasks(MSG_ID, CHANNEL_ID, SENDER_ID);

    expect(rabbitMQEventService.publishNotificationTask).toHaveBeenCalledTimes(
      1,
    );
  });
});
```

- [ ] **Step 2: Run the IM worker test to verify RED**

Run:

```bash
cd apps/server/apps/im-worker
NODE_OPTIONS='--experimental-vm-modules' pnpm test -- src/post-broadcast/post-broadcast.service.spec.ts
```

Expected: FAIL because `processNotificationTasks` currently publishes DM and reply/mention tasks for all channel types without any tracking/bot guard.

- [ ] **Step 3: Add the notification guards**

Update `apps/server/apps/im-worker/src/post-broadcast/post-broadcast.service.ts` immediately after `const { message, sender, channel, mentions, parentMessage } = messageData;`:

```typescript
if (channel.type === "tracking") {
  this.logger.debug(
    `Skipping notification tasks for tracking channel message ${msgId}`,
  );
  return;
}

const shouldSkipBotDmNotification =
  channel.type === "direct" && sender.userType === "bot";
```

Then narrow the DM publication block:

```typescript
if (channel.type === "direct" && !shouldSkipBotDmNotification) {
  const members = await this.getChannelMemberIds(channelId);
  const recipientId = members.find((id) => id !== senderId);

  if (recipientId) {
    const dmTask: DMNotificationTask = {
      type: "dm",
      timestamp: Date.now(),
      payload: {
        messageId: msgId,
        channelId,
        senderId,
        senderUsername: sender.username,
        recipientId,
        content: message.content ?? "",
      },
    };
    await this.rabbitMQEventService.publishNotificationTask(dmTask);
  }
}
```

This keeps message delivery and unread-count updates untouched while preventing Activity creation for the noisy cases.

- [ ] **Step 4: Run the IM worker test to verify GREEN**

Run:

```bash
cd apps/server/apps/im-worker
NODE_OPTIONS='--experimental-vm-modules' pnpm test -- src/post-broadcast/post-broadcast.service.spec.ts
```

Expected: PASS with both regression tests and the existing Hive push tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/server/apps/im-worker/src/post-broadcast/post-broadcast.service.ts \
        apps/server/apps/im-worker/src/post-broadcast/post-broadcast.service.spec.ts
git commit -m "fix(notifications): skip tracking and bot-dm activity noise"
```

---

## Task 5: End-to-end verification sweep

**Files:**

- Modify: none

- [ ] **Step 1: Run the full targeted verification suite**

Run:

```bash
cd apps/server/apps/gateway
NODE_OPTIONS='--experimental-vm-modules' pnpm test -- src/notification/notification.service.spec.ts

cd ../../../client
pnpm test -- src/stores/__tests__/useNotificationStore.test.ts \
            src/components/layout/sidebars/__tests__/ActivitySubSidebar.test.tsx

cd ../server/apps/im-worker
NODE_OPTIONS='--experimental-vm-modules' pnpm test -- src/post-broadcast/post-broadcast.service.spec.ts
```

Expected:

- Gateway notification tests pass
- Client store/sidebar tests pass
- IM worker post-broadcast tests pass

- [ ] **Step 2: Run one lightweight build-time safety check per surface**

Run:

```bash
cd apps/client
pnpm build

cd ../server
pnpm build:server
```

Expected: both client and server builds succeed with no new type or import errors.

- [ ] **Step 3: Commit verification-only changes if any snapshots or test files updated**

```bash
git status --short
```

Expected: clean working tree. If non-code generated artifacts changed unexpectedly, inspect before committing.
