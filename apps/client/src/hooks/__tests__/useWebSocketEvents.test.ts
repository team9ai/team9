import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWebSocketEvents } from "../useWebSocketEvents";
import {
  notificationActions,
  useNotificationStore,
  type NotificationCounts,
  type Notification,
} from "@/stores/useNotificationStore";

const mockIsTauriApp = vi.hoisted(() => vi.fn());
const mockShowTauriNotification = vi.hoisted(() => vi.fn());
const mockGetLocalNotificationPrefs = vi.hoisted(() => vi.fn());
const mockIsViewingCurrentChannel = vi.hoisted(() => vi.fn());

vi.mock("@/lib/tauri", () => ({
  isTauriApp: mockIsTauriApp,
}));

vi.mock("@/services/tauri-notification", () => ({
  showTauriNotification: mockShowTauriNotification,
}));

vi.mock("@/lib/notification-prefs-local", () => ({
  getLocalNotificationPrefs: mockGetLocalNotificationPrefs,
  isViewingCurrentChannel: mockIsViewingCurrentChannel,
}));

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
  onNotificationAllRead: vi.fn((callback: (...args: any[]) => void) =>
    mockWsService.on("notification_all_read", callback),
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
  offNotificationAllRead: vi.fn(),
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

    // Default: not a Tauri app
    mockIsTauriApp.mockReturnValue(false);
    mockGetLocalNotificationPrefs.mockReturnValue({
      focusSuppression: true,
      desktopEnabledLocal: true,
    });
    mockIsViewingCurrentChannel.mockReturnValue(false);
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

  it("marks filtered notifications as read for notification_all_read", () => {
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

    const callback = listeners.get("notification_all_read")?.[0];
    expect(callback).toBeDefined();

    callback?.({
      category: "message",
      types: ["mention"],
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
    expect(state.notifications[1]).toMatchObject({
      id: "notif-2",
      isRead: false,
    });
  });

  // ==================== Tauri Notification Tests ====================

  const sampleNotificationEvent = {
    id: "notif-tauri-1",
    category: "message" as const,
    type: "mention" as const,
    priority: "normal" as const,
    title: "New mention",
    body: "You were mentioned in #general",
    actor: null,
    tenantId: null,
    channelId: "ch-123",
    messageId: null,
    actionUrl: null,
    createdAt: "2026-04-01T00:00:00.000Z",
  };

  it("shows Tauri notification for new notification in Tauri app", () => {
    mockIsTauriApp.mockReturnValue(true);

    renderHook(() => useWebSocketEvents());

    const callback = listeners.get("notification_new")?.[0];
    callback?.(sampleNotificationEvent);

    expect(mockShowTauriNotification).toHaveBeenCalledWith({
      title: "New mention",
      body: "You were mentioned in #general",
    });
  });

  it("does not show Tauri notification when not in Tauri app", () => {
    mockIsTauriApp.mockReturnValue(false);

    renderHook(() => useWebSocketEvents());

    const callback = listeners.get("notification_new")?.[0];
    callback?.(sampleNotificationEvent);

    expect(mockShowTauriNotification).not.toHaveBeenCalled();
  });

  it("does not show Tauri notification when desktopEnabledLocal is false", () => {
    mockIsTauriApp.mockReturnValue(true);
    mockGetLocalNotificationPrefs.mockReturnValue({
      focusSuppression: true,
      desktopEnabledLocal: false,
    });

    renderHook(() => useWebSocketEvents());

    const callback = listeners.get("notification_new")?.[0];
    callback?.(sampleNotificationEvent);

    expect(mockShowTauriNotification).not.toHaveBeenCalled();
  });

  it("suppresses Tauri notification when user is viewing the channel", () => {
    mockIsTauriApp.mockReturnValue(true);
    mockIsViewingCurrentChannel.mockReturnValue(true);

    renderHook(() => useWebSocketEvents());

    const callback = listeners.get("notification_new")?.[0];
    callback?.(sampleNotificationEvent);

    expect(mockIsViewingCurrentChannel).toHaveBeenCalledWith("ch-123");
    expect(mockShowTauriNotification).not.toHaveBeenCalled();
  });

  it("shows Tauri notification when focus suppression is disabled even if viewing channel", () => {
    mockIsTauriApp.mockReturnValue(true);
    mockIsViewingCurrentChannel.mockReturnValue(true);
    mockGetLocalNotificationPrefs.mockReturnValue({
      focusSuppression: false,
      desktopEnabledLocal: true,
    });

    renderHook(() => useWebSocketEvents());

    const callback = listeners.get("notification_new")?.[0];
    callback?.(sampleNotificationEvent);

    expect(mockShowTauriNotification).toHaveBeenCalledWith({
      title: "New mention",
      body: "You were mentioned in #general",
    });
  });

  it("passes undefined body when notification body is null", () => {
    mockIsTauriApp.mockReturnValue(true);

    renderHook(() => useWebSocketEvents());

    const callback = listeners.get("notification_new")?.[0];
    callback?.({ ...sampleNotificationEvent, id: "notif-no-body", body: null });

    expect(mockShowTauriNotification).toHaveBeenCalledWith({
      title: "New mention",
      body: undefined,
    });
  });

  it("does not show Tauri notification for duplicate notification_new events", () => {
    mockIsTauriApp.mockReturnValue(true);

    renderHook(() => useWebSocketEvents());

    const callback = listeners.get("notification_new")?.[0];

    // First call: should show
    callback?.(sampleNotificationEvent);
    expect(mockShowTauriNotification).toHaveBeenCalledTimes(1);

    // Second call with same ID: should be skipped by idempotency check
    callback?.(sampleNotificationEvent);
    expect(mockShowTauriNotification).toHaveBeenCalledTimes(1);
  });
});
