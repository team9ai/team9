import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";

const isTauriApp = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export type BrowserInitStatus =
  | "unknown" // Initial state, not yet checked
  | "ready" // agent-browser installed and ready
  | "not-installed" // agent-browser not installed
  | "installing" // browser-init is running
  | "failed"; // installation failed

let status: BrowserInitStatus = "unknown";
const listeners = new Set<() => void>();

function setStatus(next: BrowserInitStatus) {
  status = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getStatus() {
  return status;
}

/** Check if browser dependencies are installed. */
export async function checkBrowserReady(): Promise<boolean> {
  if (!isTauriApp()) return false;
  try {
    const ready = await invoke<boolean>("ahand_browser_is_ready");
    setStatus(ready ? "ready" : "not-installed");
    return ready;
  } catch {
    setStatus("not-installed");
    return false;
  }
}

/** Run ahandd browser-init and update status. Throws on failure with the actual error message. */
export async function runBrowserInit(force = false): Promise<boolean> {
  if (!isTauriApp()) return false;
  setStatus("installing");
  try {
    await invoke("ahand_browser_init", { force });
    const ready = await invoke<boolean>("ahand_browser_is_ready");
    setStatus(ready ? "ready" : "failed");
    return ready;
  } catch (err) {
    setStatus("failed");
    throw err;
  }
}

/** Subscribe to browser-init status changes. */
export function useBrowserInitStatus() {
  return useSyncExternalStore(subscribe, getStatus);
}
