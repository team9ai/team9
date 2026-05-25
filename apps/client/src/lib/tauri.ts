export function isTauriApp(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function isMacTauriApp(): boolean {
  return isTauriApp() && navigator.userAgent.includes("Mac");
}
