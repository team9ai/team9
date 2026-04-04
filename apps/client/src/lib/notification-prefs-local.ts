const FOCUS_SUPPRESSION_KEY = "notification_focus_suppression";
const DESKTOP_ENABLED_LOCAL_KEY = "notification_desktop_enabled_local";

export interface LocalNotificationPrefs {
  focusSuppression: boolean; // default: true
  desktopEnabledLocal: boolean; // mirrors the server-side desktopEnabled for Tauri use
}

export function getLocalNotificationPrefs(): LocalNotificationPrefs {
  return {
    focusSuppression: localStorage.getItem(FOCUS_SUPPRESSION_KEY) !== "false", // default true
    desktopEnabledLocal:
      localStorage.getItem(DESKTOP_ENABLED_LOCAL_KEY) !== "false", // default true
  };
}

export function setFocusSuppression(enabled: boolean): void {
  localStorage.setItem(FOCUS_SUPPRESSION_KEY, String(enabled));
}

export function setDesktopEnabledLocal(enabled: boolean): void {
  localStorage.setItem(DESKTOP_ENABLED_LOCAL_KEY, String(enabled));
}

/**
 * Check whether the user is currently viewing a specific channel.
 * Used for focus suppression: if the user is already looking at the channel,
 * there is no need to show a desktop notification.
 */
export function isViewingCurrentChannel(
  channelId: string | null | undefined,
): boolean {
  if (!channelId) return false;
  if (document.visibilityState !== "visible") return false;
  const pathname = window.location.pathname;
  return (
    pathname.includes(`/channels/${channelId}`) ||
    pathname.includes(`/messages/${channelId}`) ||
    pathname.includes(`/activity/channel/${channelId}`)
  );
}
