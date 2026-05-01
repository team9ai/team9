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
  onRoutineStatusChanged: vi.fn((callback: (...args: any[]) => void) =>
    mockWsService.on("routine:status_changed", callback),
  ),
  onRoutineExecutionCreated: vi.fn((callback: (...args: any[]) => void) =>
    mockWsService.on("routine:execution_created", callback),
  ),
  onRoutineUpdated: vi.fn((callback: (...args: any[]) => void) =>
    mockWsService.on("routine:updated", callback),
  ),
  onUserUpdated: vi.fn((callback: (...args: any[]) => void) =>
    mockWsService.on("user_updated", callback),
  ),
  onTrackingDeactivated: vi.fn((callback: (...args: any[]) => void) =>
    mockWsService.on("tracking:deactivated", callback),
  ),
  offNotificationCountsUpdated: vi.fn(),
  offNotificationNew: vi.fn(),
  offNotificationRead: vi.fn(),
  offNotificationAllRead: vi.fn(),
  offRoutineStatusChanged: vi.fn(),
  offRoutineExecutionCreated: vi.fn(),
  offRoutineUpdated: vi.fn((callback: (...args: any[]) => void) =>
    mockWsService.off("routine:updated", callback),
  ),
  offUserUpdated: vi.fn((callback: (...args: any[]) => void) =>
    mockWsService.off("user_updated", callback),
  ),
  offTrackingDeactivated: vi.fn(),
  onMessagePropertyChanged: vi.fn((callback: (...args: any[]) => void) =>
    mockWsService.on("message_property_changed", callback),
  ),
  offMessagePropertyChanged: vi.fn(),
  onRelationChanged: vi.fn((callback: (...args: any[]) => void) => {
    mockWsService.on("message_relation_changed", callback);
    return () => mockWsService.off("message_relation_changed", callback);
  }),
  offRelationChanged: vi.fn((callback: (...args: any[]) => void) =>
    mockWsService.off("message_relation_changed", callback),
  ),
  onRelationsPurged: vi.fn((callback: (...args: any[]) => void) => {
    mockWsService.on("message_relations_purged", callback);
    return () => mockWsService.off("message_relations_purged", callback);
  }),
  offRelationsPurged: vi.fn((callback: (...args: any[]) => void) =>
    mockWsService.off("message_relations_purged", callback),
  ),
}));

const mockSyncCurrentUser = vi.hoisted(() => vi.fn());
const mockGetCurrentUser = vi.hoisted(() => vi.fn());

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
  setQueriesData: vi.fn(
    (filters: { queryKey: unknown[] }, updater: unknown) => {
      const prefix = JSON.stringify(filters.queryKey).slice(0, -1);
      for (const [cacheKey, previous] of queryCache.entries()) {
        if (!cacheKey.startsWith(prefix)) continue;
        const next =
          typeof updater === "function"
            ? (updater as (value: unknown) => unknown)(previous)
            : updater;
        queryCache.set(cacheKey, next);
      }
    },
  ),
  invalidateQueries: vi.fn(),
}));

vi.mock("@/services/websocket", () => ({
  default: mockWsService,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => mockQueryClient,
}));

vi.mock("@/lib/query-client", () => ({
  queryClient: mockQueryClient,
  relationKeys: {
    all: ["relations"],
    byMessage: (messageId: string) => ["relations", messageId],
    inbound: (messageId: string) => ["relations-inbound", messageId],
    viewTree: (channelId: string, viewId: string) => [
      "view-tree",
      channelId,
      viewId,
    ],
  },
}));

const mockAppStoreState = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
}));
const mockAppStoreGetState = vi.hoisted(() => vi.fn(() => mockAppStoreState));

vi.mock("@/stores", () => ({
  useSelectedWorkspaceId: () => "workspace-1",
  useUser: () => ({ id: "user-1" }),
  useAppStore: {
    getState: mockAppStoreGetState,
  },
}));

vi.mock("@/services/api", () => {
  const apiMock = {
    auth: {
      getCurrentUser: mockGetCurrentUser,
    },
  };
  return {
    api: apiMock,
    default: apiMock,
  };
});

vi.mock("@/hooks/useAuth", () => ({
  syncCurrentUser: mockSyncCurrentUser,
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

    // Reset the app-store mock so each test starts with user-1 logged in
    mockAppStoreState.user = { id: "user-1" };

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

  // ==================== Topic Session Updated ====================

  it("patches topic-session sidebar cache immediately when title updates", () => {
    queryCache.set(
      JSON.stringify(["topic-sessions-grouped", "workspace-1", 5]),
      [
        {
          agentUserId: "bot-1",
          agentId: "agent-1",
          agentDisplayName: "Agent",
          agentAvatarUrl: null,
          legacyDirectChannelId: null,
          totalCount: 1,
          recentSessions: [
            {
              channelId: "channel-1",
              sessionId: "session-1",
              title: "临时标题",
              lastMessageAt: null,
              unreadCount: 0,
              createdAt: "2026-04-01T00:00:00.000Z",
            },
          ],
        },
      ],
    );

    renderHook(() => useWebSocketEvents());

    const callback = listeners.get("topic_session_updated")?.[0];
    expect(callback).toBeDefined();

    callback?.({ channelId: "channel-1", title: "AI总结标题" });

    const cached = queryCache.get(
      JSON.stringify(["topic-sessions-grouped", "workspace-1", 5]),
    ) as Array<{ recentSessions: Array<{ title: string | null }> }>;

    expect(cached[0].recentSessions[0].title).toBe("AI总结标题");
  });

  // ==================== Routine Updated ====================

  describe("routine:updated handler", () => {
    it("invalidates routines list, routine detail, and routine triggers", () => {
      renderHook(() => useWebSocketEvents());

      const handler = listeners.get("routine:updated")?.[0];
      expect(handler).toBeDefined();

      handler?.({ routineId: "r-123" });

      expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["routines"],
      });
      expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["routine", "r-123"],
      });
      expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["routine-triggers", "r-123"],
      });
    });
  });

  // ==================== User Updated ====================

  describe("user_updated handler", () => {
    it("invalidates users and per-user im-users caches for any user", () => {
      renderHook(() => useWebSocketEvents());
      const handler = listeners.get("user_updated")?.[0];
      expect(handler).toBeDefined();

      handler?.({ userId: "user-other" });

      expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["users"],
      });
      expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["im-users", "user-other"],
      });
    });

    it("does NOT refresh the app-store user for a different user", () => {
      renderHook(() => useWebSocketEvents());
      const handler = listeners.get("user_updated")?.[0];

      handler?.({ userId: "user-other" });

      expect(mockGetCurrentUser).not.toHaveBeenCalled();
      expect(mockSyncCurrentUser).not.toHaveBeenCalled();
    });

    it("refreshes app-store via getCurrentUser when event targets current user", async () => {
      const fetched = {
        id: "user-1",
        displayName: "Fresh Name",
      };
      mockGetCurrentUser.mockResolvedValueOnce(fetched);

      renderHook(() => useWebSocketEvents());
      const handler = listeners.get("user_updated")?.[0];

      handler?.({ userId: "user-1" });

      // Invalidation still happens synchronously
      expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["users"],
      });
      expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["im-users", "user-1"],
      });

      await vi.waitFor(() => {
        expect(mockGetCurrentUser).toHaveBeenCalledTimes(1);
        expect(mockSyncCurrentUser).toHaveBeenCalledTimes(1);
      });
      // syncCurrentUser receives the fresh user and the query client so it
      // can update ["currentUser"] and Sentry in one shot.
      expect(mockSyncCurrentUser).toHaveBeenCalledWith(
        fetched,
        mockQueryClient,
      );
    });

    it("swallows getCurrentUser errors without breaking cache invalidation", async () => {
      mockGetCurrentUser.mockRejectedValueOnce(new Error("network down"));

      renderHook(() => useWebSocketEvents());
      const handler = listeners.get("user_updated")?.[0];

      handler?.({ userId: "user-1" });

      // Invalidation happened synchronously despite the upcoming rejection
      expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["users"],
      });
      expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["im-users", "user-1"],
      });

      await vi.waitFor(() => {
        expect(mockGetCurrentUser).toHaveBeenCalledTimes(1);
      });

      // syncCurrentUser never called because the refetch failed
      expect(mockSyncCurrentUser).not.toHaveBeenCalled();
    });

    it("does NOT call syncCurrentUser when refetched user id differs from event userId (auth-swap race)", async () => {
      // Isolates guard (a): `fresh.id !== event.userId`.
      // Scenario: user-1 receives event, starts getCurrentUser, user-1 logs
      // out + user-2 logs in mid-flight. Fetched user matches the NEW
      // authoritative store (user-2) but NOT the original event (user-1).
      // Only guard (a) rejects here — guard (b) would accept because
      // fresh.id === latestUserId. If guard (a) were removed, the test
      // fails: syncCurrentUser gets called with user-2 in response to an
      // event that was about user-1.
      const fetchedSwapped = {
        id: "user-2",
        displayName: "Other",
      };
      let resolveFetch: ((value: unknown) => void) | undefined;
      mockGetCurrentUser.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve;
          }),
      );

      renderHook(() => useWebSocketEvents());
      const handler = listeners.get("user_updated")?.[0];

      handler?.({ userId: "user-1" });

      // Flip authoritative user to user-2 BEFORE the fetch resolves, so
      // guard (b) would accept fresh={id:"user-2"} as valid for the new user.
      mockAppStoreState.user = { id: "user-2" };
      resolveFetch?.(fetchedSwapped);

      await vi.waitFor(() => {
        expect(mockGetCurrentUser).toHaveBeenCalledTimes(1);
      });

      expect(mockSyncCurrentUser).not.toHaveBeenCalled();
    });

    it("does NOT call syncCurrentUser when the current user changes before getCurrentUser resolves (logout/login race)", async () => {
      // Simulates: user-1 triggers the event, but before the refetch
      // resolves, user-1 logs out and user-2 logs in. The fetched user
      // matches the event's userId, but no longer matches the authoritative
      // Zustand store -- pushing it would overwrite user-2's state.
      const fetched = {
        id: "user-1",
        displayName: "A",
      };
      let resolveFetch: ((value: unknown) => void) | undefined;
      mockGetCurrentUser.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve;
          }),
      );

      renderHook(() => useWebSocketEvents());
      const handler = listeners.get("user_updated")?.[0];

      handler?.({ userId: "user-1" });

      // The handler kicked off the request synchronously; now simulate the
      // logout/login swap before the response lands.
      mockAppStoreState.user = { id: "user-2" };
      resolveFetch?.(fetched);

      await vi.waitFor(() => {
        expect(mockGetCurrentUser).toHaveBeenCalledTimes(1);
      });

      expect(mockSyncCurrentUser).not.toHaveBeenCalled();
    });
  });

  // ==================== Cleanup ====================

  describe("useWebSocketEvents cleanup", () => {
    it("unsubscribes routine:updated and user_updated on unmount", () => {
      const { unmount } = renderHook(() => useWebSocketEvents());
      unmount();
      expect(mockWsService.offRoutineUpdated).toHaveBeenCalledTimes(1);
      expect(mockWsService.offUserUpdated).toHaveBeenCalledTimes(1);
    });

    it("passes the same handler reference to off as was registered via on", () => {
      const { unmount } = renderHook(() => useWebSocketEvents());

      const registeredRoutine =
        mockWsService.onRoutineUpdated.mock.calls[0]?.[0];
      const registeredUser = mockWsService.onUserUpdated.mock.calls[0]?.[0];

      unmount();

      expect(mockWsService.offRoutineUpdated).toHaveBeenCalledWith(
        registeredRoutine,
      );
      expect(mockWsService.offUserUpdated).toHaveBeenCalledWith(registeredUser);
    });

    it("registers each listener exactly once per mount and leaves zero subscriptions after unmount", () => {
      const { unmount } = renderHook(() => useWebSocketEvents());

      expect(mockWsService.onRoutineUpdated).toHaveBeenCalledTimes(1);
      expect(mockWsService.onUserUpdated).toHaveBeenCalledTimes(1);
      expect(listeners.get("routine:updated") ?? []).toHaveLength(1);
      expect(listeners.get("user_updated") ?? []).toHaveLength(1);

      unmount();

      expect(listeners.get("routine:updated") ?? []).toHaveLength(0);
      expect(listeners.get("user_updated") ?? []).toHaveLength(0);
    });
  });
});
