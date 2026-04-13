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
  NotificationAllReadEvent,
  RoutineStatusChangedEvent,
  RoutineExecutionCreatedEvent,
  TrackingDeactivatedEvent,
  MessagePropertyChangedEvent,
} from "@/types/ws-events";
import { useSelectedWorkspaceId, useUser } from "@/stores";
import {
  useNotificationStore,
  notificationActions,
  type Notification,
  type NotificationCounts,
} from "@/stores/useNotificationStore";
import { isTauriApp } from "@/lib/tauri";
import { showTauriNotification } from "@/services/tauri-notification";
import {
  getLocalNotificationPrefs,
  isViewingCurrentChannel,
} from "@/lib/notification-prefs-local";

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
    if (!workspaceId) {
      return;
    }

    // ==================== Channel Events ====================

    // Debounce channel invalidation to prevent request storms.
    // After reconnection the server may push many channel lifecycle events
    // (channel_joined, channel_created, etc.) in rapid succession. Without
    // debouncing, each event triggers a separate HTTP refetch which can
    // overwhelm the browser (ERR_INSUFFICIENT_RESOURCES).
    let channelInvalidateTimer: ReturnType<typeof setTimeout> | null = null;
    const invalidateChannels = () => {
      if (channelInvalidateTimer) clearTimeout(channelInvalidateTimer);
      channelInvalidateTimer = setTimeout(() => {
        channelInvalidateTimer = null;
        queryClient.invalidateQueries({ queryKey: ["channels", workspaceId] });
        queryClient.invalidateQueries({
          queryKey: ["publicChannels", workspaceId],
        });
        // Also refresh the installed-applications-with-bots query so the
        // routine agent dropdown picks up newly created bot agents.
        queryClient.invalidateQueries({
          queryKey: ["installed-applications-with-bots", workspaceId],
        });
      }, 500);
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
                showInDmSidebar: true,
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
      // Check if the query cache exists
      const existingData = queryClient.getQueryData<Record<string, string>>([
        "im-users",
        "online",
      ]);

      if (existingData === undefined) {
        // Query hasn't been initialized yet, trigger a fresh fetch
        queryClient.invalidateQueries({ queryKey: ["im-users", "online"] });
        return;
      }

      // Update cache optimistically
      queryClient.setQueryData(
        ["im-users", "online"],
        (old: Record<string, string> | undefined) => {
          return { ...(old || {}), [userId]: "online" };
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
      // Idempotency check: skip if notification already exists
      // This protects against duplicate WebSocket events (e.g., reconnection replays)
      if (notificationActions.hasNotification(event.id)) {
        if (import.meta.env.DEV) {
          console.debug(
            `[WS] Duplicate notification ignored: ${event.id} (${event.type})`,
          );
        }
        return;
      }

      // 1. Increment count in Zustand store
      notificationActions.incrementCount(event.category, 1, event.type);

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

      // 4. Show Tauri system notification (desktop app only)
      if (isTauriApp()) {
        const localPrefs = getLocalNotificationPrefs();
        if (localPrefs.desktopEnabledLocal) {
          // Focus suppression: skip notification if user is viewing this channel
          const shouldSuppress =
            localPrefs.focusSuppression &&
            isViewingCurrentChannel(event.channelId);

          if (!shouldSuppress) {
            showTauriNotification({
              title: event.title,
              body: event.body || undefined,
            });
          }
        }
      }
    };

    // Handle notification read event
    const handleNotificationRead = (event: NotificationReadEvent) => {
      const notifications = useNotificationStore.getState().notifications;
      const readNotifications = notifications.filter(
        (notification) =>
          event.notificationIds.includes(notification.id) &&
          !notification.isRead,
      );

      for (const notification of readNotifications) {
        notificationActions.decrementCount(
          notification.category,
          1,
          notification.type,
        );
      }

      notificationActions.markAsRead(event.notificationIds);
    };

    const handleNotificationAllRead = (event: NotificationAllReadEvent) => {
      notificationActions.markAllAsRead(event.category, event.types);
    };

    // ==================== Routine Events ====================

    const handleRoutineStatusChanged = (event: RoutineStatusChangedEvent) => {
      queryClient.invalidateQueries({ queryKey: ["routines"] });
      queryClient.invalidateQueries({ queryKey: ["routine", event.routineId] });
    };

    const handleRoutineExecutionCreated = (
      event: RoutineExecutionCreatedEvent,
    ) => {
      queryClient.invalidateQueries({ queryKey: ["routines"] });
      queryClient.invalidateQueries({ queryKey: ["routine", event.routineId] });
    };

    // ==================== Tracking Events ====================

    // Handle tracking channel deactivation
    const handleTrackingDeactivated = (event: TrackingDeactivatedEvent) => {
      // Invalidate channel cache to update isActivated status
      queryClient.invalidateQueries({
        queryKey: ["channels", event.channelId],
      });
      // Invalidate tracking messages cache
      queryClient.invalidateQueries({
        queryKey: ["trackingMessages", event.channelId],
      });
      queryClient.invalidateQueries({
        queryKey: ["trackingModalMessages", event.channelId],
      });
    };

    // ==================== Property Events ====================

    // When a message property changes, invalidate messages for that channel
    // so properties are refreshed in the chat view and any active view queries.
    const handleMessagePropertyChanged = (
      event: MessagePropertyChangedEvent,
    ) => {
      queryClient.invalidateQueries({
        queryKey: ["messages", event.channelId],
      });
      queryClient.invalidateQueries({
        queryKey: ["channel", event.channelId, "views"],
      });
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
    wsService.onNotificationAllRead(handleNotificationAllRead);

    // Routine events
    wsService.onRoutineStatusChanged(handleRoutineStatusChanged);
    wsService.onRoutineExecutionCreated(handleRoutineExecutionCreated);

    // Tracking events
    wsService.onTrackingDeactivated(handleTrackingDeactivated);

    // Property events
    wsService.onMessagePropertyChanged(handleMessagePropertyChanged);

    // ==================== Cleanup ====================

    return () => {
      // Clear debounce timer
      if (channelInvalidateTimer) {
        clearTimeout(channelInvalidateTimer);
      }

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
      wsService.offNotificationAllRead(handleNotificationAllRead);

      // Routine events
      wsService.offRoutineStatusChanged(handleRoutineStatusChanged);
      wsService.offRoutineExecutionCreated(handleRoutineExecutionCreated);

      // Tracking events
      wsService.offTrackingDeactivated(handleTrackingDeactivated);

      // Property events
      wsService.offMessagePropertyChanged(handleMessagePropertyChanged);
    };
  }, [queryClient, workspaceId, currentUser?.id]);
}
