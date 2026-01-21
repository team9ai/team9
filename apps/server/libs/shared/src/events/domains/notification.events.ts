/**
 * Notification Center WebSocket event type definitions
 *
 * Events for the unified notification center including message notifications,
 * system notifications, and workspace notifications.
 *
 * @module events/domains/notification
 */

// ==================== Notification Types ====================

/**
 * Notification category
 */
export type NotificationCategory = 'message' | 'system' | 'workspace';

/**
 * Notification type (detailed type within each category)
 */
export type NotificationType =
  // Message category
  | 'mention'
  | 'channel_mention'
  | 'everyone_mention'
  | 'here_mention'
  | 'reply'
  | 'thread_reply'
  | 'dm_received'
  // System category
  | 'system_announcement'
  | 'maintenance_notice'
  | 'version_update'
  // Workspace category
  | 'workspace_invitation'
  | 'role_changed'
  | 'member_joined'
  | 'member_left'
  | 'channel_invite';

/**
 * Notification priority
 */
export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';

// ==================== Notification Events ====================

/**
 * Actor information in a notification
 */
export interface NotificationActor {
  /** User ID */
  id: string;
  /** Username */
  username: string;
  /** Display name */
  displayName: string | null;
  /** Avatar URL */
  avatarUrl: string | null;
}

/**
 * New notification event
 *
 * Sent by the server when a new notification is created for the user.
 *
 * @event notification_new
 * @direction Server -> Client
 *
 * @example
 * ```typescript
 * socket.on('notification_new', (event: NotificationNewEvent) => {
 *   // Add to notification list
 *   addNotification(event);
 *   // Show toast notification
 *   showToast(event.title, event.body);
 *   // Update badge count
 *   incrementNotificationCount(event.category);
 * });
 * ```
 */
export interface NotificationNewEvent {
  /** Notification ID */
  id: string;
  /** Notification category */
  category: NotificationCategory;
  /** Notification type */
  type: NotificationType;
  /** Notification priority */
  priority: NotificationPriority;
  /** Notification title */
  title: string;
  /** Notification body (optional) */
  body: string | null;
  /** Actor who triggered the notification (optional for system notifications) */
  actor: NotificationActor | null;
  /** Workspace ID (optional) */
  tenantId: string | null;
  /** Channel ID (optional) */
  channelId: string | null;
  /** Message ID (optional) */
  messageId: string | null;
  /** Action URL for navigation */
  actionUrl: string | null;
  /** Created timestamp (ISO 8601) */
  createdAt: string;
}

/**
 * Notification counts updated event
 *
 * Sent by the server when the user's notification counts change
 * (e.g., after marking as read, archiving, or receiving new notifications).
 *
 * @event notification_counts_updated
 * @direction Server -> Client
 *
 * @example
 * ```typescript
 * socket.on('notification_counts_updated', (event: NotificationCountsUpdatedEvent) => {
 *   // Update notification badge
 *   updateBadge(event.total);
 *   // Update category counts in UI
 *   updateCategoryCounts(event.byCategory);
 * });
 * ```
 */
export interface NotificationCountsUpdatedEvent {
  /** Total unread notification count */
  total: number;
  /** Unread counts by category */
  byCategory: {
    message: number;
    system: number;
    workspace: number;
  };
  /** Unread counts by notification type */
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

/**
 * Notification read event
 *
 * Sent by the server when notifications are marked as read.
 * Used for multi-device sync - when user marks notifications as read on one device,
 * other devices receive this event to sync the read state.
 *
 * @event notification_read
 * @direction Server -> Client
 *
 * @example
 * ```typescript
 * socket.on('notification_read', (event: NotificationReadEvent) => {
 *   // Mark notifications as read in local state
 *   for (const id of event.notificationIds) {
 *     markAsReadLocally(id);
 *   }
 * });
 * ```
 */
export interface NotificationReadEvent {
  /** IDs of notifications that were marked as read */
  notificationIds: string[];
}
