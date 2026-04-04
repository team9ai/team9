import { useState, useCallback, useEffect } from "react";
import { getServiceWorkerRegistration } from "@/lib/push-notifications";
import { isTauriApp } from "@/lib/tauri";
import * as pushSubscriptionApi from "@/services/api/push-subscription";

export type PushStatus =
  | "unsupported"
  | "denied"
  | "prompt"
  | "subscribed"
  | "unsubscribed"
  | "loading";

// Helper: convert VAPID key from base64url to Uint8Array
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function usePushSubscription() {
  const [status, setStatus] = useState<PushStatus>("loading");

  const checkStatus = useCallback(async () => {
    if (
      isTauriApp() ||
      !("PushManager" in window) ||
      !("Notification" in window)
    ) {
      setStatus("unsupported");
      return;
    }

    if (Notification.permission === "denied") {
      setStatus("denied");
      return;
    }

    const reg = getServiceWorkerRegistration();
    if (!reg) {
      setStatus("unsubscribed");
      return;
    }

    const sub = await reg.pushManager.getSubscription();
    setStatus(sub ? "subscribed" : "unsubscribed");
  }, []);

  // Check current status on mount
  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const subscribe = useCallback(async (): Promise<boolean> => {
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus("denied");
        return false;
      }

      const reg = getServiceWorkerRegistration();
      if (!reg) return false;

      // Get VAPID public key from server
      const { publicKey } = await pushSubscriptionApi.getVapidPublicKey();
      if (!publicKey) return false;

      // Subscribe to push
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      // Send subscription to server
      await pushSubscriptionApi.subscribe(subscription.toJSON());
      setStatus("subscribed");
      return true;
    } catch (error) {
      console.error("Push subscription failed:", error);
      return false;
    }
  }, []);

  const unsubscribe = useCallback(async (): Promise<boolean> => {
    try {
      const reg = getServiceWorkerRegistration();
      if (!reg) return false;

      const subscription = await reg.pushManager.getSubscription();
      if (!subscription) {
        setStatus("unsubscribed");
        return true;
      }

      // Remove from server first — if this fails, the browser subscription
      // stays intact so the user can retry. Reversing the order would leave
      // the server with a stale subscription pointing to an invalidated endpoint.
      await pushSubscriptionApi.unsubscribe(subscription.endpoint);

      // Then unsubscribe from browser
      await subscription.unsubscribe();

      setStatus("unsubscribed");
      return true;
    } catch (error) {
      console.error("Push unsubscribe failed:", error);
      return false;
    }
  }, []);

  return { status, subscribe, unsubscribe, checkStatus };
}
