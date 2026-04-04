import { isTauriApp } from "./tauri";

let swRegistration: ServiceWorkerRegistration | null = null;

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (isTauriApp()) return null;
  if (!("serviceWorker" in navigator)) return null;
  if (!("PushManager" in window)) return null;

  try {
    swRegistration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
    });
    return swRegistration;
  } catch (error) {
    console.error("Service Worker registration failed:", error);
    return null;
  }
}

export function getServiceWorkerRegistration(): ServiceWorkerRegistration | null {
  return swRegistration;
}

/**
 * Send heartbeat to Service Worker for focus suppression.
 * Call this periodically from the active tab.
 */
export function sendHeartbeat(channelId: string | null): void {
  navigator.serviceWorker?.controller?.postMessage({
    type: "HEARTBEAT",
    channelId,
  });
}
