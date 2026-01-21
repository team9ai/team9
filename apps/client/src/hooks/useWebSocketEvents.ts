import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import wsService from "@/services/websocket";
import type { ChannelWithUnread, Message } from "@/types/im";
import type {
  ReadStatusUpdatedEvent,
  UserOnlineEvent,
  UserOfflineEvent,
  UserStatusChangedEvent,
  NotificationNewEvent,
  NotificationCountsUpdatedEvent,
  NotificationReadEvent,
} from "@/types/ws-events";
import { useSelectedWorkspaceId, useUser } from "@/stores";
import {
  notificationActions,
  type Notification,
  type NotificationCounts,
} from "@/stores/useNotificationStore";

/**
 * Centralized WebSocket event handler hook.
 *
 * This hook should be called ONCE at the app level (in _authenticated layout)
 * to avoid duplicate event listeners from multiple hook calls.
 *
 * It handles:
 * - Channel lifecycle events (joined, left, created, deleted, archived)
 * - Message events (new_message, read_status_updated) for unread counts
 * - User status events (online, offline, status_changed)
 * - Notification events (counts_updated, new, read)
 *
 * Note: Per-channel message listeners (for message list updates) remain in
 * useMessages.ts because they need the channelId context.
 */
export function useWebSocketEvents() {
  const queryClient = useQueryClient();
  const workspaceId = useSelectedWorkspaceId();
  const currentUser = useUser();

  useEffect(() => {
    if (!workspaceId) return;

    // ==================== Channel Events ====================

    const invalidateChannels = () => {
      queryClient.invalidateQueries({ queryKey: ["channels", workspaceId] });
      queryClient.invalidateQueries({
        queryKey: ["publicChannels", workspaceId],
      });
    };

    // Handle new message - immediately increment unread count
    const handleNewMessage = (message: Message) => {
      // Skip if message is from current user or is a reply (thread message)
      if (message.senderId === currentUser?.id || message.parentId) {
        return;
      }

      // Immediately update the unread count in cache
      queryClient.setQueryData(
        ["channels", workspaceId],
        (old: ChannelWithUnread[] | undefined) => {
          if (!old) return old;

          return old.map((channel) => {
            if (channel.id === message.channelId) {
              return {
                ...channel,
                unreadCount: (channel.unreadCount || 0) + 1,
              };
            }
            return channel;
          });
        },
      );
    };

    // Handle read status updated - reset unread count for current user
    const handleReadStatusUpdated = (event: ReadStatusUpdatedEvent) => {
      // Only handle if it's the current user's read status
      if (event.userId !== currentUser?.id) {
        return;
      }

      // Immediately set unread count to 0 for this channel
      queryClient.setQueryData(
        ["channels", workspaceId],
        (old: ChannelWithUnread[] | undefined) => {
          if (!old) return old;

          return old.map((channel) => {
            if (channel.id === event.channelId) {
              return {
                ...channel,
                unreadCount: 0,
                lastReadMessageId: event.lastReadMessageId,
              };
            }
            return channel;
          });
        },
      );
    };

    // ==================== User Status Events ====================

    const handleUserOnline = ({ userId }: UserOnlineEvent) => {
      queryClient.setQueryData(
        ["im-users", "online"],
        (old: Record<string, string> | undefined) => {
          return { ...old, [userId]: "online" };
        },
      );
    };

    const handleUserOffline = ({ userId }: UserOfflineEvent) => {
      queryClient.setQueryData(
        ["im-users", "online"],
        (old: Record<string, string> | undefined) => {
          if (!old) return old;
          const newData = { ...old };
          delete newData[userId];
          return newData;
        },
      );
    };

    const handleUserStatusChanged = ({
      userId,
      status,
    }: UserStatusChangedEvent) => {
      queryClient.setQueryData(
        ["im-users", "online"],
        (old: Record<string, string> | undefined) => {
          return { ...old, [userId]: status };
        },
      );
    };

    // ==================== Notification Events ====================

    // Handle notification counts updated (full counts from server)
    const handleNotificationCountsUpdated = (
      event: NotificationCountsUpdatedEvent,
    ) => {
      notificationActions.setCounts(event);
      queryClient.setQueryData(["notificationCounts"], event);
    };

    // Handle new notification - increment count AND add to notification list
    const handleNotificationNew = (event: NotificationNewEvent) => {
      // 1. Increment count in Zustand store
      notificationActions.incrementCount(event.category);

      // 2. Update React Query cache for notification counts
      queryClient.setQueryData(
        ["notificationCounts"],
        (oldData: NotificationCounts | undefined) => {
          if (!oldData) return oldData;
          return {
            total: oldData.total + 1,
            byCategory: {
              ...oldData.byCategory,
              [event.category]: (oldData.byCategory[event.category] || 0) + 1,
            },
            byType: {
              ...oldData.byType,
              [event.type]: (oldData.byType[event.type] || 0) + 1,
            },
          };
        },
      );

      // 3. Add the notification to Zustand store
      const notification: Notification = {
        ...event,
        isRead: false,
        readAt: null,
      };
      notificationActions.addNotification(notification);
    };

    // Handle notification read event
    const handleNotificationRead = (event: NotificationReadEvent) => {
      notificationActions.markAsRead(event.notificationIds);
    };

    // ==================== Register All Listeners ====================

    // Channel lifecycle events
    wsService.on("channel_joined", invalidateChannels);
    wsService.on("channel_left", invalidateChannels);
    wsService.on("channel_created", invalidateChannels);
    wsService.on("channel_deleted", invalidateChannels);
    wsService.on("channel_archived", invalidateChannels);
    wsService.on("channel_unarchived", invalidateChannels);

    // Message events for unread counts
    wsService.on("new_message", handleNewMessage);
    wsService.on("read_status_updated", handleReadStatusUpdated);

    // User status events
    wsService.onUserOnline(handleUserOnline);
    wsService.onUserOffline(handleUserOffline);
    wsService.onUserStatusChanged(handleUserStatusChanged);

    // Notification events
    wsService.onNotificationCountsUpdated(handleNotificationCountsUpdated);
    wsService.onNotificationNew(handleNotificationNew);
    wsService.onNotificationRead(handleNotificationRead);

    // ==================== Cleanup ====================

    return () => {
      // Channel events
      wsService.off("channel_joined", invalidateChannels);
      wsService.off("channel_left", invalidateChannels);
      wsService.off("channel_created", invalidateChannels);
      wsService.off("channel_deleted", invalidateChannels);
      wsService.off("channel_archived", invalidateChannels);
      wsService.off("channel_unarchived", invalidateChannels);

      // Message events
      wsService.off("new_message", handleNewMessage);
      wsService.off("read_status_updated", handleReadStatusUpdated);

      // User status events
      wsService.off("user_online", handleUserOnline);
      wsService.off("user_offline", handleUserOffline);
      wsService.off("user_status_changed", handleUserStatusChanged);

      // Notification events
      wsService.offNotificationCountsUpdated(handleNotificationCountsUpdated);
      wsService.offNotificationNew(handleNotificationNew);
      wsService.offNotificationRead(handleNotificationRead);
    };
  }, [queryClient, workspaceId, currentUser?.id]);
}
