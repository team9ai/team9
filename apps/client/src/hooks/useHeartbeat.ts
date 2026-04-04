import { useEffect } from "react";
import { sendHeartbeat } from "@/lib/push-notifications";
import { isTauriApp } from "@/lib/tauri";

/**
 * Sends periodic heartbeat messages to the Service Worker with
 * the currently viewed channelId for focus suppression.
 *
 * Skipped in Tauri desktop apps (they handle focus suppression in-process).
 */
export function useHeartbeat() {
  useEffect(() => {
    if (isTauriApp()) return;

    const interval = setInterval(() => {
      // Extract channelId from the current URL path
      const match = window.location.pathname.match(
        /\/(?:channels|messages|activity\/channel)\/([^/?]+)/,
      );
      const channelId = match ? match[1] : null;
      const visible = document.visibilityState === "visible";

      if (visible) {
        sendHeartbeat(channelId);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, []);
}
