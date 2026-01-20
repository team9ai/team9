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

  // Actions
  setNotifications: (notifications: Notification[]) => void;
  addNotification: (notification: Notification) => void;
  addNotifications: (notifications: Notification[]) => void;
  markAsRead: (notificationIds: string[]) => void;
  markAllAsRead: (category?: NotificationCategory) => void;
  setCounts: (counts: NotificationCounts) => void;
  decrementCount: (category: NotificationCategory, amount?: number) => void;
  incrementCount: (category: NotificationCategory, amount?: number) => void;
  setLoading: (isLoading: boolean) => void;
  setHasMore: (hasMore: boolean) => void;
  setNextCursor: (cursor: string | null) => void;
  setFilter: (filter: Partial<NotificationState["filter"]>) => void;
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
  },
  isLoading: false,
  hasMore: true,
  nextCursor: null as string | null,
  filter: {
    category: null as NotificationCategory | null,
    isRead: null as boolean | null,
  },
};

// Store
export const useNotificationStore = create<NotificationState>()(
  devtools(
    (set) => ({
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

      markAllAsRead: (category) =>
        set(
          (state) => ({
            notifications: state.notifications.map((n) =>
              !category || n.category === category
                ? { ...n, isRead: true, readAt: new Date().toISOString() }
                : n,
            ),
            counts: {
              ...state.counts,
              total: category
                ? state.counts.total - state.counts.byCategory[category]
                : 0,
              byCategory: category
                ? {
                    ...state.counts.byCategory,
                    [category]: 0,
                  }
                : { message: 0, system: 0, workspace: 0 },
            },
          }),
          false,
          "markAllAsRead",
        ),

      setCounts: (counts) => set({ counts }, false, "setCounts"),

      decrementCount: (category, amount = 1) =>
        set(
          (state) => ({
            counts: {
              total: Math.max(0, state.counts.total - amount),
              byCategory: {
                ...state.counts.byCategory,
                [category]: Math.max(
                  0,
                  state.counts.byCategory[category] - amount,
                ),
              },
            },
          }),
          false,
          "decrementCount",
        ),

      incrementCount: (category, amount = 1) =>
        set(
          (state) => ({
            counts: {
              total: state.counts.total + amount,
              byCategory: {
                ...state.counts.byCategory,
                [category]: state.counts.byCategory[category] + amount,
              },
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

// Actions (can be used outside React components)
export const notificationActions = {
  setNotifications: (notifications: Notification[]) =>
    useNotificationStore.getState().setNotifications(notifications),
  addNotification: (notification: Notification) =>
    useNotificationStore.getState().addNotification(notification),
  addNotifications: (notifications: Notification[]) =>
    useNotificationStore.getState().addNotifications(notifications),
  markAsRead: (notificationIds: string[]) =>
    useNotificationStore.getState().markAsRead(notificationIds),
  markAllAsRead: (category?: NotificationCategory) =>
    useNotificationStore.getState().markAllAsRead(category),
  setCounts: (counts: NotificationCounts) =>
    useNotificationStore.getState().setCounts(counts),
  decrementCount: (category: NotificationCategory, amount?: number) =>
    useNotificationStore.getState().decrementCount(category, amount),
  incrementCount: (category: NotificationCategory, amount?: number) =>
    useNotificationStore.getState().incrementCount(category, amount),
  setLoading: (isLoading: boolean) =>
    useNotificationStore.getState().setLoading(isLoading),
  setHasMore: (hasMore: boolean) =>
    useNotificationStore.getState().setHasMore(hasMore),
  setNextCursor: (cursor: string | null) =>
    useNotificationStore.getState().setNextCursor(cursor),
  setFilter: (filter: Partial<NotificationState["filter"]>) =>
    useNotificationStore.getState().setFilter(filter),
  reset: () => useNotificationStore.getState().reset(),
};
