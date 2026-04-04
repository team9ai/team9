/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;

// === Tauri desktop app detection ===
const TAURI_HEALTH_URL = "http://127.0.0.1:19876/health";
let tauriActive = false;

async function probeTauri(): Promise<boolean> {
  try {
    const res = await fetch(TAURI_HEALTH_URL, {
      signal: AbortSignal.timeout(500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

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

function isViewingChannel(channelId: string | null): boolean {
  if (!channelId) return false;
  // Heartbeat is stale after 10 seconds
  if (Date.now() - lastHeartbeat > 10_000) return false;
  return activeChannelId === channelId;
}

// === Push event handler ===
self.addEventListener("push", (event) => {
  const data = event.data?.json();
  if (!data) return;

  // Suppress if Tauri desktop app is active on this device
  // or if user is viewing this channel (focus suppression).
  // Must still call event.waitUntil() to satisfy the Web Push spec —
  // omitting it causes browsers to show a generic "updated in background" notification.
  if (tauriActive || isViewingChannel(data.channelId)) {
    event.waitUntil(Promise.resolve());
    return;
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body || "",
      icon: "/team9-block.png",
      badge: "/team9-badge.png",
      tag: data.id, // dedup by notification ID
      renotify: false,
      data: { actionUrl: data.actionUrl, id: data.id },
    }),
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
