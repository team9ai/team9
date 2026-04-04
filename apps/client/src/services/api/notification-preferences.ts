import http from "../http";

export interface NotificationPreferencesResponse {
  mentionsEnabled: boolean;
  repliesEnabled: boolean;
  dmsEnabled: boolean;
  systemEnabled: boolean;
  workspaceEnabled: boolean;
  desktopEnabled: boolean;
  soundEnabled: boolean;
  dndEnabled: boolean;
  dndStart: string | null;
  dndEnd: string | null;
}

export interface UpdateNotificationPreferencesRequest {
  mentionsEnabled?: boolean;
  repliesEnabled?: boolean;
  dmsEnabled?: boolean;
  systemEnabled?: boolean;
  workspaceEnabled?: boolean;
  desktopEnabled?: boolean;
  soundEnabled?: boolean;
  dndEnabled?: boolean;
  dndStart?: string | null;
  dndEnd?: string | null;
}

/**
 * Get the current user's notification preferences.
 */
export async function getPreferences(): Promise<NotificationPreferencesResponse> {
  const response = await http.get<NotificationPreferencesResponse>(
    "/v1/notification-preferences",
  );
  return response.data;
}

/**
 * Update the current user's notification preferences (partial update).
 */
export async function updatePreferences(
  dto: UpdateNotificationPreferencesRequest,
): Promise<NotificationPreferencesResponse> {
  const response = await http.patch<NotificationPreferencesResponse>(
    "/v1/notification-preferences",
    dto,
  );
  return response.data;
}
