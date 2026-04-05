/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;

// Workbox precache manifest — vite-plugin-pwa injectManifest replaces this at build time.
// Using console.debug to prevent tree-shaking.
console.debug("SW precache entries:", self.__WB_MANIFEST);

import {
  probeTauri,
  isViewingChannel,
  buildNotificationOptions,
} from "./lib/sw-utils";

// === Tauri desktop app detection ===
let tauriActive = false;

// Probe on start and every 30 seconds
probeTauri().then((v) => {
  tauriActive = v;
});
setInterval(async () => {
  tauriActive = await probeTauri();
}, 30_000);

// === Focus suppression via heartbeat from active tab ===
let activeChannelId: string | null = null;
let lastHeartbeat = 0;

self.addEventListener("message", (event) => {
  if (event.data?.type === "HEARTBEAT") {
    activeChannelId = event.data.channelId || null;
    lastHeartbeat = Date.now();
  }
});

// === Push event handler ===
self.addEventListener("push", (event) => {
  const data = event.data?.json();
  if (!data) return;

  // Suppress if Tauri desktop app is active on this device
  // or if user is viewing this channel (focus suppression).
  // Must still call event.waitUntil() to satisfy the Web Push spec —
  // omitting it causes browsers to show a generic "updated in background" notification.
  if (
    tauriActive ||
    isViewingChannel(data.channelId, activeChannelId, lastHeartbeat)
  ) {
    event.waitUntil(Promise.resolve());
    return;
  }

  event.waitUntil(
    self.registration.showNotification(
      data.title,
      buildNotificationOptions(data),
    ),
  );
});

// === Notification click handler ===
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.actionUrl;
  if (!url) return;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        // Focus existing tab if available
        for (const client of clients) {
          if (new URL(client.url).origin === self.location.origin) {
            client.focus();
            client.postMessage({ type: "NOTIFICATION_CLICK", actionUrl: url });
            return;
          }
        }
        // Otherwise open new window
        return self.clients.openWindow(url);
      }),
  );
});
