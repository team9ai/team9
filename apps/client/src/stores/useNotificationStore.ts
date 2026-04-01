import { create } from "zustand";
import { devtools } from "zustand/middleware";

// Types
export type NotificationCategory = "message" | "system" | "workspace";
export type NotificationType =
  | "mention"
  | "channel_mention"
  | "everyone_mention"
  | "here_mention"
  | "reply"
  | "thread_reply"
  | "dm_received"
  | "system_announcement"
  | "maintenance_notice"
  | "version_update"
  | "workspace_invitation"
  | "role_changed"
  | "member_joined"
  | "member_left"
  | "channel_invite";
export type NotificationPriority = "low" | "normal" | "high" | "urgent";
export type ActivityTab = "all" | "mentions" | "threads";

// Notification types for each activity tab
export const MENTION_TYPES: NotificationType[] = [
  "mention",
  "channel_mention",
  "everyone_mention",
  "here_mention",
];
export const THREAD_TYPES: NotificationType[] = ["reply", "thread_reply"];
const SYSTEM_TYPES: NotificationType[] = [
  "system_announcement",
  "maintenance_notice",
  "version_update",
];
const WORKSPACE_TYPES: NotificationType[] = [
  "workspace_invitation",
  "role_changed",
  "member_joined",
  "member_left",
  "channel_invite",
];
export const ACTIVITY_TYPES: NotificationType[] = [
  ...MENTION_TYPES,
  ...THREAD_TYPES,
  ...SYSTEM_TYPES,
  ...WORKSPACE_TYPES,
];

const ALL_TYPES_BY_CATEGORY: Record<NotificationCategory, NotificationType[]> =
  {
    message: [...MENTION_TYPES, ...THREAD_TYPES, "dm_received"],
    system: SYSTEM_TYPES,
    workspace: WORKSPACE_TYPES,
  };

const getCategoryForType = (type: NotificationType): NotificationCategory => {
  if (SYSTEM_TYPES.includes(type)) return "system";
  if (WORKSPACE_TYPES.includes(type)) return "workspace";
  return "message";
};

export interface NotificationActor {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface Notification {
  id: string;
  category: NotificationCategory;
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  body: string | null;
  actor: NotificationActor | null;
  tenantId: string | null;
  channelId: string | null;
  messageId: string | null;
  actionUrl: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationCounts {
  total: number;
  byCategory: {
    message: number;
    system: number;
    workspace: number;
  };
  byType: {
    // Message category
    mention: number;
    channel_mention: number;
    everyone_mention: number;
    here_mention: number;
    reply: number;
    thread_reply: number;
    dm_received: number;
    // System category
    system_announcement: number;
    maintenance_notice: number;
    version_update: number;
    // Workspace category
    workspace_invitation: number;
    role_changed: number;
    member_joined: number;
    member_left: number;
    channel_invite: number;
  };
}

interface NotificationState {
  // State
  notifications: Notification[];
  counts: NotificationCounts;
  isLoading: boolean;
  hasMore: boolean;
  nextCursor: string | null;
  filter: {
    category: NotificationCategory | null;
    isRead: boolean | null;
  };
  // Activity UI state
  activeTab: ActivityTab;
  showUnreadOnly: boolean;

  // Actions
  setNotifications: (notifications: Notification[]) => void;
  addNotification: (notification: Notification) => void;
  addNotifications: (notifications: Notification[]) => void;
  markAsRead: (notificationIds: string[]) => void;
  markAllAsRead: (
    category?: NotificationCategory,
    types?: NotificationType[],
  ) => void;
  setCounts: (counts: NotificationCounts) => void;
  decrementCount: (
    category: NotificationCategory,
    amount?: number,
    type?: NotificationType,
  ) => void;
  incrementCount: (
    category: NotificationCategory,
    amount?: number,
    type?: NotificationType,
  ) => void;
  setLoading: (isLoading: boolean) => void;
  setHasMore: (hasMore: boolean) => void;
  setNextCursor: (cursor: string | null) => void;
  setFilter: (filter: Partial<NotificationState["filter"]>) => void;
  setActiveTab: (tab: ActivityTab) => void;
  setShowUnreadOnly: (showUnreadOnly: boolean) => void;
  reset: () => void;
}

// Initial state
const initialState = {
  notifications: [] as Notification[],
  counts: {
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
  },
  isLoading: false,
  hasMore: true,
  nextCursor: null as string | null,
  filter: {
    category: null as NotificationCategory | null,
    isRead: null as boolean | null,
  },
  activeTab: "all" as ActivityTab,
  showUnreadOnly: false,
};

// Store
export const useNotificationStore = create<NotificationState>()(
  devtools(
    (set, get) => ({
      ...initialState,

      setNotifications: (notifications) =>
        set({ notifications }, false, "setNotifications"),

      addNotification: (notification) =>
        set(
          (state) => ({
            notifications: [notification, ...state.notifications],
          }),
          false,
          "addNotification",
        ),

      addNotifications: (notifications) =>
        set(
          (state) => ({
            notifications: [...state.notifications, ...notifications],
          }),
          false,
          "addNotifications",
        ),

      markAsRead: (notificationIds) =>
        set(
          (state) => ({
            notifications: state.notifications.map((n) =>
              notificationIds.includes(n.id)
                ? { ...n, isRead: true, readAt: new Date().toISOString() }
                : n,
            ),
          }),
          false,
          "markAsRead",
        ),

      markAllAsRead: (category, types) => {
        const state = get();
        const now = new Date().toISOString();
        const normalizedTypes = types?.length ? types : undefined;
        const typeSet = normalizedTypes ? new Set(normalizedTypes) : null;

        const shouldMark = (notification: Notification) =>
          (!category || notification.category === category) &&
          (!typeSet || typeSet.has(notification.type));

        const selectedTypes = normalizedTypes
          ? normalizedTypes.filter(
              (type) => !category || getCategoryForType(type) === category,
            )
          : category
            ? ALL_TYPES_BY_CATEGORY[category]
            : ([
                ...ALL_TYPES_BY_CATEGORY.message,
                ...ALL_TYPES_BY_CATEGORY.system,
                ...ALL_TYPES_BY_CATEGORY.workspace,
              ] as NotificationType[]);

        const decrementedByCategory: NotificationCounts["byCategory"] = {
          message: 0,
          system: 0,
          workspace: 0,
        };
        const decrementedByType: NotificationCounts["byType"] = {
          ...state.counts.byType,
        };

        let totalDecrement = 0;

        for (const type of selectedTypes) {
          const amount = state.counts.byType[type];
          if (amount === 0) continue;

          totalDecrement += amount;
          decrementedByType[type] = Math.max(
            0,
            decrementedByType[type] - amount,
          );
          decrementedByCategory[getCategoryForType(type)] += amount;
        }

        const nextCounts = {
          ...state.counts,
          total: Math.max(0, state.counts.total - totalDecrement),
          byCategory: category
            ? {
                ...state.counts.byCategory,
                [category]: Math.max(
                  0,
                  state.counts.byCategory[category] -
                    decrementedByCategory[category],
                ),
              }
            : {
                message: Math.max(
                  0,
                  state.counts.byCategory.message -
                    decrementedByCategory.message,
                ),
                system: Math.max(
                  0,
                  state.counts.byCategory.system - decrementedByCategory.system,
                ),
                workspace: Math.max(
                  0,
                  state.counts.byCategory.workspace -
                    decrementedByCategory.workspace,
                ),
              },
          byType: normalizedTypes
            ? decrementedByType
            : category
              ? {
                  ...state.counts.byType,
                  ...Object.fromEntries(
                    ALL_TYPES_BY_CATEGORY[category].map((type) => [type, 0]),
                  ),
                }
              : (Object.fromEntries(
                  Object.keys(state.counts.byType).map((type) => [type, 0]),
                ) as NotificationCounts["byType"]),
        };

        set(
          {
            notifications: state.notifications.map((notification) =>
              notification.isRead || !shouldMark(notification)
                ? notification
                : { ...notification, isRead: true, readAt: now },
            ),
            counts: nextCounts,
          },
          false,
          "markAllAsRead",
        );
      },

      setCounts: (counts) => set({ counts }, false, "setCounts"),

      decrementCount: (category, amount = 1, type) =>
        set(
          (state) => ({
            counts: {
              ...state.counts,
              total: Math.max(0, state.counts.total - amount),
              byCategory: {
                ...state.counts.byCategory,
                [category]: Math.max(
                  0,
                  state.counts.byCategory[category] - amount,
                ),
              },
              byType: type
                ? {
                    ...state.counts.byType,
                    [type]: Math.max(0, state.counts.byType[type] - amount),
                  }
                : state.counts.byType,
            },
          }),
          false,
          "decrementCount",
        ),

      incrementCount: (category, amount = 1, type) =>
        set(
          (state) => ({
            counts: {
              ...state.counts,
              total: state.counts.total + amount,
              byCategory: {
                ...state.counts.byCategory,
                [category]: state.counts.byCategory[category] + amount,
              },
              byType: type
                ? {
                    ...state.counts.byType,
                    [type]: state.counts.byType[type] + amount,
                  }
                : state.counts.byType,
            },
          }),
          false,
          "incrementCount",
        ),

      setLoading: (isLoading) => set({ isLoading }, false, "setLoading"),

      setHasMore: (hasMore) => set({ hasMore }, false, "setHasMore"),

      setNextCursor: (nextCursor) =>
        set({ nextCursor }, false, "setNextCursor"),

      setFilter: (filter) =>
        set(
          (state) => ({
            filter: { ...state.filter, ...filter },
            // Reset pagination when filter changes
            notifications: [],
            nextCursor: null,
            hasMore: true,
          }),
          false,
          "setFilter",
        ),

      setActiveTab: (activeTab) => set({ activeTab }, false, "setActiveTab"),

      setShowUnreadOnly: (showUnreadOnly) =>
        set({ showUnreadOnly }, false, "setShowUnreadOnly"),

      reset: () => set(initialState, false, "reset"),
    }),
    { name: "NotificationStore" },
  ),
);

// Selectors
export const useNotifications = () =>
  useNotificationStore((state) => state.notifications);
export const useNotificationCounts = () =>
  useNotificationStore((state) => state.counts);
export const useUnreadCount = () =>
  useNotificationStore((state) => state.counts.total);
export const useNotificationFilter = () =>
  useNotificationStore((state) => state.filter);
export const useNotificationLoading = () =>
  useNotificationStore((state) => state.isLoading);
export const useActivityTab = () =>
  useNotificationStore((state) => state.activeTab);
export const useShowUnreadOnly = () =>
  useNotificationStore((state) => state.showUnreadOnly);

// Helper function to filter notifications (pure function, no hooks)
export const filterNotifications = (
  notifications: Notification[],
  activeTab: ActivityTab,
  showUnreadOnly: boolean,
): Notification[] => {
  let filtered =
    activeTab === "all"
      ? notifications.filter((n) => ACTIVITY_TYPES.includes(n.type))
      : notifications;

  // Filter by tab
  if (activeTab === "mentions") {
    filtered = filtered.filter((n) => MENTION_TYPES.includes(n.type));
  } else if (activeTab === "threads") {
    filtered = filtered.filter((n) => THREAD_TYPES.includes(n.type));
  }

  // Filter by unread
  if (showUnreadOnly) {
    filtered = filtered.filter((n) => !n.isRead);
  }

  return filtered;
};

// Actions (can be used outside React components)
export const notificationActions = {
  setNotifications: (notifications: Notification[]) =>
    useNotificationStore.getState().setNotifications(notifications),
  addNotification: (notification: Notification) =>
    useNotificationStore.getState().addNotification(notification),
  /**
   * Check if a notification with the given ID already exists in the store
   * Used for idempotency protection against duplicate WebSocket events
   */
  hasNotification: (notificationId: string) =>
    useNotificationStore
      .getState()
      .notifications.some((n) => n.id === notificationId),
  addNotifications: (notifications: Notification[]) =>
    useNotificationStore.getState().addNotifications(notifications),
  markAsRead: (notificationIds: string[]) =>
    useNotificationStore.getState().markAsRead(notificationIds),
  markAllAsRead: (
    category?: NotificationCategory,
    types?: NotificationType[],
  ) => useNotificationStore.getState().markAllAsRead(category, types),
  setCounts: (counts: NotificationCounts) =>
    useNotificationStore.getState().setCounts(counts),
  decrementCount: (
    category: NotificationCategory,
    amount?: number,
    type?: NotificationType,
  ) => useNotificationStore.getState().decrementCount(category, amount, type),
  incrementCount: (
    category: NotificationCategory,
    amount?: number,
    type?: NotificationType,
  ) => useNotificationStore.getState().incrementCount(category, amount, type),
  setLoading: (isLoading: boolean) =>
    useNotificationStore.getState().setLoading(isLoading),
  setHasMore: (hasMore: boolean) =>
    useNotificationStore.getState().setHasMore(hasMore),
  setNextCursor: (cursor: string | null) =>
    useNotificationStore.getState().setNextCursor(cursor),
  setFilter: (filter: Partial<NotificationState["filter"]>) =>
    useNotificationStore.getState().setFilter(filter),
  setActiveTab: (tab: ActivityTab) =>
    useNotificationStore.getState().setActiveTab(tab),
  setShowUnreadOnly: (showUnreadOnly: boolean) =>
    useNotificationStore.getState().setShowUnreadOnly(showUnreadOnly),
  reset: () => useNotificationStore.getState().reset(),
};
