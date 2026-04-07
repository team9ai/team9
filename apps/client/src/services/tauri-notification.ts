import { isTauriApp } from "@/lib/tauri";

let notificationModule:
  | typeof import("@tauri-apps/plugin-notification")
  | null = null;

async function getNotificationModule() {
  if (!isTauriApp()) return null;
  if (!notificationModule) {
    notificationModule = await import("@tauri-apps/plugin-notification");
  }
  return notificationModule;
}

export async function requestTauriNotificationPermission(): Promise<boolean> {
  const mod = await getNotificationModule();
  if (!mod) return false;

  let granted = await mod.isPermissionGranted();
  if (!granted) {
    const permission = await mod.requestPermission();
    granted = permission === "granted";
  }
  return granted;
}

export async function showTauriNotification(notification: {
  title: string;
  body?: string;
}): Promise<void> {
  const mod = await getNotificationModule();
  if (!mod) return;

  const granted = await mod.isPermissionGranted();
  if (!granted) return;

  mod.sendNotification({
    title: notification.title,
    body: notification.body,
  });
}
