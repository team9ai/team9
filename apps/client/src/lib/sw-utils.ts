/**
 * Pure utility functions extracted from sw.ts for testability.
 * The service worker imports these; they can also be unit-tested directly.
 */

export const TAURI_HEALTH_URL = "http://127.0.0.1:19876/health";

/**
 * Probe the local Tauri health endpoint.
 * Returns `true` when the Tauri desktop shell is running on this device.
 */
export async function probeTauri(
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const res = await fetchFn(TAURI_HEALTH_URL, {
      signal: AbortSignal.timeout(500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Determine whether the user is currently viewing a specific channel
 * based on the most recent heartbeat from the active browser tab.
 *
 * A heartbeat is considered stale after 10 seconds.
 */
export function isViewingChannel(
  channelId: string | null,
  activeChannelId: string | null,
  lastHeartbeat: number,
  now: number = Date.now(),
): boolean {
  if (!channelId) return false;
  if (now - lastHeartbeat > 10_000) return false;
  return activeChannelId === channelId;
}

/**
 * Build the options object for `showNotification()`.
 */
export function buildNotificationOptions(data: {
  body?: string;
  id?: string;
  actionUrl?: string;
}): NotificationOptions {
  return {
    body: data.body || "",
    icon: "/team9-block.png",
    badge: "/team9-badge.png",
    tag: data.id,
    renotify: false,
    data: { actionUrl: data.actionUrl, id: data.id },
  };
}
