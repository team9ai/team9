import { beforeEach, describe, expect, it } from "vitest";
import {
  notificationActions,
  useNotificationStore,
  type Notification,
  type NotificationCounts,
} from "../useNotificationStore";

const paginatedCounts: NotificationCounts = {
  total: 7,
  byCategory: {
    message: 6,
    system: 1,
    workspace: 0,
  },
  byType: {
    mention: 4,
    channel_mention: 0,
    everyone_mention: 0,
    here_mention: 0,
    reply: 2,
    thread_reply: 0,
    dm_received: 0,
    system_announcement: 1,
    maintenance_notice: 0,
    version_update: 0,
    workspace_invitation: 0,
    role_changed: 0,
    member_joined: 0,
    member_left: 0,
    channel_invite: 0,
  },
};

const notifications: Notification[] = [
  {
    id: "n-1",
    category: "message",
    type: "mention",
    priority: "normal",
    title: "Mention",
    body: null,
    actor: null,
    tenantId: null,
    channelId: null,
    messageId: null,
    actionUrl: null,
    isRead: false,
    readAt: null,
    createdAt: "2026-03-31T00:00:00.000Z",
  },
  {
    id: "n-2",
    category: "message",
    type: "reply",
    priority: "normal",
    title: "Reply",
    body: null,
    actor: null,
    tenantId: null,
    channelId: null,
    messageId: null,
    actionUrl: null,
    isRead: false,
    readAt: null,
    createdAt: "2026-03-31T00:00:00.000Z",
  },
  {
    id: "n-3",
    category: "message",
    type: "mention",
    priority: "normal",
    title: "Already read mention",
    body: null,
    actor: null,
    tenantId: null,
    channelId: null,
    messageId: null,
    actionUrl: null,
    isRead: true,
    readAt: "2026-03-31T00:00:00.000Z",
    createdAt: "2026-03-31T00:00:00.000Z",
  },
  {
    id: "n-4",
    category: "system",
    type: "system_announcement",
    priority: "normal",
    title: "System",
    body: null,
    actor: null,
    tenantId: null,
    channelId: null,
    messageId: null,
    actionUrl: null,
    isRead: false,
    readAt: null,
    createdAt: "2026-03-31T00:00:00.000Z",
  },
];

describe("useNotificationStore", () => {
  beforeEach(() => {
    useNotificationStore.getState().reset();
  });

  it("keeps byType in sync after a single read and scoped read all", () => {
    notificationActions.setNotifications(notifications);
    notificationActions.setCounts(paginatedCounts);

    notificationActions.decrementCount("message", 1, "mention");
    notificationActions.markAsRead(["n-1"]);
    notificationActions.markAllAsRead(undefined, ["mention"]);

    const state = useNotificationStore.getState();

    expect(state.notifications).toEqual([
      expect.objectContaining({ id: "n-1", isRead: true }),
      expect.objectContaining({ id: "n-2", isRead: false }),
      expect.objectContaining({ id: "n-3", isRead: true }),
      expect.objectContaining({ id: "n-4", isRead: false }),
    ]);
    expect(state.counts.total).toBe(3);
    expect(state.counts.byCategory).toEqual({
      message: 2,
      system: 1,
      workspace: 0,
    });
    expect(state.counts.byType).toMatchObject({
      mention: 0,
      reply: 2,
      system_announcement: 1,
    });
  });

  it("keeps byType in sync when incrementing a notification", () => {
    notificationActions.setCounts({
      total: 0,
      byCategory: {
        message: 0,
        system: 0,
        workspace: 0,
      },
      byType: {
        mention: 0,
        channel_mention: 0,
        everyone_mention: 0,
        here_mention: 0,
        reply: 0,
        thread_reply: 0,
        dm_received: 0,
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

    notificationActions.incrementCount("message", 1, "mention");

    const state = useNotificationStore.getState();

    expect(state.counts.total).toBe(1);
    expect(state.counts.byCategory).toEqual({
      message: 1,
      system: 0,
      workspace: 0,
    });
    expect(state.counts.byType).toMatchObject({
      mention: 1,
    });
  });

  it("still supports category-wide read all", () => {
    notificationActions.setNotifications(notifications);
    notificationActions.setCounts(paginatedCounts);

    notificationActions.markAllAsRead("message");

    const state = useNotificationStore.getState();

    expect(state.notifications).toEqual([
      expect.objectContaining({ id: "n-1", isRead: true }),
      expect.objectContaining({ id: "n-2", isRead: true }),
      expect.objectContaining({ id: "n-3", isRead: true }),
      expect.objectContaining({ id: "n-4", isRead: false }),
    ]);
    expect(state.counts.total).toBe(1);
    expect(state.counts.byCategory).toEqual({
      message: 0,
      system: 1,
      workspace: 0,
    });
    expect(state.counts.byType).toMatchObject({
      mention: 0,
      reply: 0,
      system_announcement: 1,
    });
  });
});
