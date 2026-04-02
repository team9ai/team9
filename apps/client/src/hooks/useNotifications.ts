import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import notificationApi, {
  type GetNotificationsParams,
} from "@/services/api/notification";
import {
  useNotificationStore,
  notificationActions,
  type NotificationCategory,
  type NotificationType,
} from "@/stores/useNotificationStore";

/**
 * Hook to fetch notification counts
 *
 * Note: WebSocket event listeners for real-time updates are now centralized
 * in useWebSocketEvents hook (called once in _authenticated layout).
 */
export function useNotificationCounts() {
  const query = useQuery({
    queryKey: ["notificationCounts"],
    queryFn: async () => {
      const counts = await notificationApi.getCounts();
      notificationActions.setCounts(counts);
      return counts;
    },
  });

  return query;
}

/**
 * Hook to fetch notifications with pagination
 *
 * Note: WebSocket event listeners for real-time updates are now centralized
 * in useWebSocketEvents hook (called once in _authenticated layout).
 */
export function useNotifications(params?: GetNotificationsParams) {
  // Use specific selectors to avoid re-renders from unrelated store updates
  const nextCursor = useNotificationStore((state) => state.nextCursor);
  const hasMore = useNotificationStore((state) => state.hasMore);
  const filterCategory = useNotificationStore((state) => state.filter.category);
  const filterIsRead = useNotificationStore((state) => state.filter.isRead);

  const query = useQuery({
    queryKey: ["notifications", params?.category, params?.isRead],
    queryFn: async () => {
      const response = await notificationApi.getNotifications({
        ...params,
        category: params?.category ?? filterCategory ?? undefined,
        isRead: params?.isRead ?? filterIsRead ?? undefined,
      });
      // Update store after successful fetch (outside of render cycle)
      notificationActions.setNotifications(response.notifications);
      notificationActions.setNextCursor(response.nextCursor);
      notificationActions.setHasMore(response.hasMore);
      return response;
    },
  });

  // Load more notifications
  const loadMore = useCallback(async () => {
    if (!hasMore || !nextCursor) return;

    const response = await notificationApi.getNotifications({
      ...params,
      category: params?.category ?? filterCategory ?? undefined,
      isRead: params?.isRead ?? filterIsRead ?? undefined,
      cursor: nextCursor,
    });
    notificationActions.addNotifications(response.notifications);
    notificationActions.setNextCursor(response.nextCursor);
    notificationActions.setHasMore(response.hasMore);
  }, [hasMore, nextCursor, params, filterCategory, filterIsRead]);

  return {
    ...query,
    loadMore,
    hasMore,
  };
}

/**
 * Hook to mark notifications as read
 */
export function useMarkNotificationsAsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (notificationIds: string[]) => {
      await notificationApi.markAsRead(notificationIds);
      return notificationIds;
    },
    onSuccess: (notificationIds) => {
      // Update local state
      const notifications = useNotificationStore.getState().notifications;
      const unreadNotifications = notifications.filter(
        (n) => notificationIds.includes(n.id) && !n.isRead,
      );

      for (const notification of unreadNotifications) {
        notificationActions.decrementCount(
          notification.category,
          1,
          notification.type,
        );
      }

      notificationActions.markAsRead(notificationIds);

      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notificationCounts"] });
    },
  });
}

/**
 * Hook to mark all notifications as read
 */
export function useMarkAllNotificationsAsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      category,
      types,
    }: {
      category?: NotificationCategory;
      types?: NotificationType[];
    } = {}) => {
      await notificationApi.markAllAsRead(category, types);
      return { category, types };
    },
    onSuccess: (_, variables) => {
      notificationActions.markAllAsRead(variables?.category, variables?.types);
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notificationCounts"] });
    },
  });
}

/**
 * Hook to archive notifications
 */
export function useArchiveNotifications() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (notificationIds: string[]) => {
      await notificationApi.archive(notificationIds);
      return notificationIds;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notificationCounts"] });
    },
  });
}
