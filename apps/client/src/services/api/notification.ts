import http from "../http";
import type {
  Notification,
  NotificationCategory,
  NotificationCounts,
} from "../../stores/useNotificationStore";

// Query params for getting notifications
export interface GetNotificationsParams {
  category?: NotificationCategory;
  type?: string;
  isRead?: boolean;
  cursor?: string;
  limit?: number;
}

// Response types
export interface GetNotificationsResponse {
  notifications: Notification[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface MarkNotificationsRequest {
  notificationIds: string[];
}

export interface MarkAllReadRequest {
  category?: NotificationCategory;
}

export interface ArchiveNotificationsRequest {
  notificationIds: string[];
}

const notificationApi = {
  /**
   * Get notifications with optional filters and cursor-based pagination
   */
  getNotifications: async (
    params?: GetNotificationsParams,
  ): Promise<GetNotificationsResponse> => {
    const response = await http.get<GetNotificationsResponse>(
      "/v1/notifications",
      { params },
    );
    return response.data;
  },

  /**
   * Get unread notification counts by category
   */
  getCounts: async (): Promise<NotificationCounts> => {
    const response = await http.get<NotificationCounts>(
      "/v1/notifications/counts",
    );
    return response.data;
  },

  /**
   * Mark specific notifications as read
   */
  markAsRead: async (notificationIds: string[]): Promise<void> => {
    await http.post<void>("/v1/notifications/mark-read", { notificationIds });
  },

  /**
   * Mark all notifications as read (optionally filtered by category)
   */
  markAllAsRead: async (category?: NotificationCategory): Promise<void> => {
    await http.post<void>("/v1/notifications/mark-all-read", { category });
  },

  /**
   * Archive notifications
   */
  archive: async (notificationIds: string[]): Promise<void> => {
    await http.post<void>("/v1/notifications/archive", { notificationIds });
  },
};

export default notificationApi;
