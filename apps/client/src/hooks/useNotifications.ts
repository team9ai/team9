import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useCallback } from "react";
import notificationApi, {
  type GetNotificationsParams,
} from "@/services/api/notification";
import wsService from "@/services/websocket";
import {
  useNotificationStore,
  notificationActions,
  type Notification,
  type NotificationCategory,
} from "@/stores/useNotificationStore";
import type {
  NotificationNewEvent,
  NotificationCountsUpdatedEvent,
  NotificationReadEvent,
} from "@/types/ws-events";

/**
 * Hook to fetch notification counts
 */
export function useNotificationCounts() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["notificationCounts"],
    queryFn: async () => {
      const counts = await notificationApi.getCounts();
      notificationActions.setCounts(counts);
      return counts;
    },
  });

  // Listen for real-time count updates
  useEffect(() => {
    const handleCountsUpdated = (event: NotificationCountsUpdatedEvent) => {
      notificationActions.setCounts(event);
      queryClient.setQueryData(["notificationCounts"], event);
    };

    wsService.onNotificationCountsUpdated(handleCountsUpdated);

    return () => {
      wsService.offNotificationCountsUpdated(handleCountsUpdated);
    };
  }, [queryClient]);

  return query;
}

/**
 * Hook to fetch notifications with pagination
 */
export function useNotifications(params?: GetNotificationsParams) {
  const queryClient = useQueryClient();
  const { nextCursor, hasMore, filter } = useNotificationStore();

  const query = useQuery({
    queryKey: ["notifications", params?.category, params?.isRead],
    queryFn: async () => {
      notificationActions.setLoading(true);
      try {
        const response = await notificationApi.getNotifications({
          ...params,
          category: params?.category ?? filter.category ?? undefined,
          isRead: params?.isRead ?? filter.isRead ?? undefined,
        });
        notificationActions.setNotifications(response.notifications);
        notificationActions.setNextCursor(response.nextCursor);
        notificationActions.setHasMore(response.hasMore);
        return response;
      } finally {
        notificationActions.setLoading(false);
      }
    },
  });

  // Load more notifications
  const loadMore = useCallback(async () => {
    if (!hasMore || !nextCursor) return;

    notificationActions.setLoading(true);
    try {
      const response = await notificationApi.getNotifications({
        ...params,
        category: params?.category ?? filter.category ?? undefined,
        isRead: params?.isRead ?? filter.isRead ?? undefined,
        cursor: nextCursor,
      });
      notificationActions.addNotifications(response.notifications);
      notificationActions.setNextCursor(response.nextCursor);
      notificationActions.setHasMore(response.hasMore);
    } finally {
      notificationActions.setLoading(false);
    }
  }, [hasMore, nextCursor, params, filter]);

  // Listen for real-time new notifications
  useEffect(() => {
    const handleNewNotification = (event: NotificationNewEvent) => {
      // Add to store with isRead: false
      const notification: Notification = {
        ...event,
        isRead: false,
        readAt: null,
      };
      notificationActions.addNotification(notification);
      notificationActions.incrementCount(event.category);
    };

    const handleNotificationRead = (event: NotificationReadEvent) => {
      notificationActions.markAsRead(event.notificationIds);
    };

    wsService.onNotificationNew(handleNewNotification);
    wsService.onNotificationRead(handleNotificationRead);

    return () => {
      wsService.offNotificationNew(handleNewNotification);
      wsService.offNotificationRead(handleNotificationRead);
    };
  }, [queryClient]);

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
      const readNotifications = notifications.filter((n) =>
        notificationIds.includes(n.id),
      );

      // Decrement counts by category
      const countsByCategory = readNotifications.reduce(
        (acc, n) => {
          if (!n.isRead) {
            acc[n.category] = (acc[n.category] || 0) + 1;
          }
          return acc;
        },
        {} as Record<NotificationCategory, number>,
      );

      for (const [category, count] of Object.entries(countsByCategory)) {
        notificationActions.decrementCount(
          category as NotificationCategory,
          count,
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
    mutationFn: async (category?: NotificationCategory) => {
      await notificationApi.markAllAsRead(category);
      return category;
    },
    onSuccess: (category) => {
      notificationActions.markAllAsRead(category);
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
