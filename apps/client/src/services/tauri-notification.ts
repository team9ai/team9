import { isTauriApp } from "@/lib/tauri";

export type TauriNotificationPermission = "granted" | "denied" | "default";

type NotificationModule = typeof import("@tauri-apps/plugin-notification");

// Cache the import *promise* (not just the resolved value) so concurrent
// callers share a single dynamic import. Caching the resolved value instead
// would let two near-simultaneous callers each start their own import, which
// is both wasteful and — in some mock/bundler environments — can produce
// distinct module instances that race to overwrite a shared cache variable.
let notificationModulePromise: Promise<NotificationModule> | null = null;

async function getNotificationModule(): Promise<NotificationModule | null> {
  if (!isTauriApp()) return null;
  if (!notificationModulePromise) {
    notificationModulePromise = import("@tauri-apps/plugin-notification");
  }
  return notificationModulePromise;
}

// Coalesce concurrent permission requests. When a burst of messages arrives
// before the user has granted permission, we must not fire multiple OS prompts
// — the behavior is platform-defined and typically produces duplicate dialogs
// or silently drops notifications on some platforms.
let permissionRequestInFlight: Promise<TauriNotificationPermission> | null =
  null;

async function requestPermissionCoalesced(
  mod: NotificationModule,
): Promise<TauriNotificationPermission> {
  if (!permissionRequestInFlight) {
    permissionRequestInFlight = (async () => {
      try {
        return (await mod.requestPermission()) as TauriNotificationPermission;
      } finally {
        permissionRequestInFlight = null;
      }
    })();
  }
  return permissionRequestInFlight;
}

/**
 * Query whether Tauri notification permission is currently granted.
 * Side-effect free — does not trigger any system prompt.
 * Returns false outside Tauri or on any plugin failure.
 */
export async function isTauriNotificationGranted(): Promise<boolean> {
  try {
    const mod = await getNotificationModule();
    if (!mod) return false;
    return await mod.isPermissionGranted();
  } catch {
    return false;
  }
}

/**
 * Request Tauri notification permission. Resolves to the final permission state.
 * If the current state is "default" this triggers the OS permission prompt;
 * on "granted" or "denied" it resolves without prompting. Concurrent calls
 * share the same in-flight request, so duplicate prompts cannot occur.
 * Returns "default" outside Tauri or on any plugin failure.
 */
export async function requestTauriNotificationPermission(): Promise<TauriNotificationPermission> {
  try {
    const mod = await getNotificationModule();
    if (!mod) return "default";
    if (await mod.isPermissionGranted()) return "granted";
    return await requestPermissionCoalesced(mod);
  } catch {
    return "default";
  }
}

/**
 * Show a Tauri system notification. If permission has not yet been granted,
 * attempts to request it first — this triggers the OS prompt on the user's
 * first notification, so permission can be asked in-context rather than at
 * startup. If the user has already denied, requestPermission resolves to
 * "denied" without re-prompting, and we silently return. Bursts of
 * simultaneous calls share a single permission request via coalescing.
 * Any plugin/import failure degrades to a no-op.
 */
export async function showTauriNotification(notification: {
  title: string;
  body?: string;
}): Promise<void> {
  try {
    const mod = await getNotificationModule();
    if (!mod) return;

    let granted = await mod.isPermissionGranted();
    if (!granted) {
      const permission = await requestPermissionCoalesced(mod);
      granted = permission === "granted";
    }
    if (!granted) return;

    mod.sendNotification({
      title: notification.title,
      body: notification.body,
    });
  } catch {
    // Degrade to no-op on any plugin failure.
  }
}
