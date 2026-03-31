import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWebSocketEvents } from "../useWebSocketEvents";
import {
  notificationActions,
  useNotificationStore,
  type NotificationCounts,
  type Notification,
} from "@/stores/useNotificationStore";

const listeners = vi.hoisted(
  () => new Map<string, Array<(...args: any[]) => void>>(),
);

const mockWsService = vi.hoisted(() => ({
  on: vi.fn((event: string, callback: (...args: any[]) => void) => {
    const existing = listeners.get(event) || [];
    existing.push(callback);
    listeners.set(event, existing);
  }),
  off: vi.fn((event: string, callback?: (...args: any[]) => void) => {
    if (!callback) {
      listeners.delete(event);
      return;
    }
    const existing = listeners.get(event) || [];
    listeners.set(
      event,
      existing.filter((listener) => listener !== callback),
    );
  }),
  onUserOnline: vi.fn((callback: (...args: any[]) => void) =>
    mockWsService.on("user_online", callback),
  ),
  onUserOffline: vi.fn((callback: (...args: any[]) => void) =>
    mockWsService.on("user_offline", callback),
  ),
  onUserStatusChanged: vi.fn((callback: (...args: any[]) => void) =>
    mockWsService.on("user_status_changed", callback),
  ),
  onNotificationCountsUpdated: vi.fn((callback: (...args: any[]) => void) =>
    mockWsService.on("notification_counts_updated", callback),
  ),
  onNotificationNew: vi.fn((callback: (...args: any[]) => void) =>
    mockWsService.on("notification_new", callback),
  ),
  onNotificationRead: vi.fn((callback: (...args: any[]) => void) =>
    mockWsService.on("notification_read", callback),
  ),
  onTaskStatusChanged: vi.fn((callback: (...args: any[]) => void) =>
    mockWsService.on("task:status_changed", callback),
  ),
  onTaskExecutionCreated: vi.fn((callback: (...args: any[]) => void) =>
    mockWsService.on("task:execution_created", callback),
  ),
  onTrackingDeactivated: vi.fn((callback: (...args: any[]) => void) =>
    mockWsService.on("tracking:deactivated", callback),
  ),
  offNotificationCountsUpdated: vi.fn(),
  offNotificationNew: vi.fn(),
  offNotificationRead: vi.fn(),
  offTaskStatusChanged: vi.fn(),
  offTaskExecutionCreated: vi.fn(),
  offTrackingDeactivated: vi.fn(),
}));

const queryCache = vi.hoisted(() => new Map<string, unknown>());

const mockQueryClient = vi.hoisted(() => ({
  getQueryData: vi.fn((key: unknown[]) => queryCache.get(JSON.stringify(key))),
  setQueryData: vi.fn((key: unknown[], updater: unknown) => {
    const cacheKey = JSON.stringify(key);
    const previous = queryCache.get(cacheKey);
    const next =
      typeof updater === "function"
        ? (updater as (value: unknown) => unknown)(previous)
        : updater;
    queryCache.set(cacheKey, next);
    return next;
  }),
  invalidateQueries: vi.fn(),
}));

vi.mock("@/services/websocket", () => ({
  default: mockWsService,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => mockQueryClient,
}));

vi.mock("@/stores", () => ({
  useSelectedWorkspaceId: () => "workspace-1",
  useUser: () => ({ id: "user-1" }),
}));

const baseCounts: NotificationCounts = {
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
};

const loadedNotifications: Notification[] = [
  {
    id: "notif-1",
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
    id: "notif-2",
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
];

describe("useWebSocketEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listeners.clear();
    queryCache.clear();
    useNotificationStore.getState().reset();
    notificationActions.setNotifications([]);
    notificationActions.setCounts(baseCounts);
    queryCache.set(JSON.stringify(["notificationCounts"]), baseCounts);
  });

  it("keeps total, category, and type counts in sync for notification_new", () => {
    renderHook(() => useWebSocketEvents());

    const callback = listeners.get("notification_new")?.[0];
    expect(callback).toBeDefined();

    callback?.({
      id: "notif-1",
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
    });

    const state = useNotificationStore.getState();
    const cachedCounts = queryCache.get(
      JSON.stringify(["notificationCounts"]),
    ) as NotificationCounts | undefined;

    expect(state.counts.total).toBe(1);
    expect(state.counts.byCategory).toEqual({
      message: 1,
      system: 0,
      workspace: 0,
    });
    expect(state.counts.byType).toMatchObject({
      mention: 1,
    });
    expect(state.notifications[0]).toMatchObject({
      id: "notif-1",
      isRead: false,
    });
    expect(cachedCounts).toMatchObject({
      total: 1,
      byCategory: { message: 1 },
      byType: { mention: 1 },
    });
  });

  it("keeps local counts in sync for notification_read", () => {
    notificationActions.setNotifications(loadedNotifications);
    notificationActions.setCounts({
      total: 2,
      byCategory: {
        message: 2,
        system: 0,
        workspace: 0,
      },
      byType: {
        mention: 1,
        channel_mention: 0,
        everyone_mention: 0,
        here_mention: 0,
        reply: 1,
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

    renderHook(() => useWebSocketEvents());

    const callback = listeners.get("notification_read")?.[0];
    expect(callback).toBeDefined();

    callback?.({
      notificationIds: ["notif-1"],
      readAt: "2026-03-31T00:00:00.000Z",
    });

    const state = useNotificationStore.getState();

    expect(state.counts.total).toBe(1);
    expect(state.counts.byCategory).toEqual({
      message: 1,
      system: 0,
      workspace: 0,
    });
    expect(state.counts.byType).toMatchObject({
      mention: 0,
      reply: 1,
    });
    expect(state.notifications[0]).toMatchObject({
      id: "notif-1",
      isRead: true,
    });
  });
});
