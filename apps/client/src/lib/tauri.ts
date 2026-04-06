import { invoke } from "@tauri-apps/api/core";

export function isTauriApp(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function isMacTauriApp(): boolean {
  return isTauriApp() && navigator.userAgent.includes("Mac");
}

export async function alignMacTrafficLights(
  titleBarHeight: number,
  x = 14,
): Promise<void> {
  if (!isMacTauriApp()) return;

  await invoke("desktop_align_traffic_lights", {
    x,
    titleBarHeight,
  });
}
