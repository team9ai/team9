import { isTauriApp } from "@/lib/tauri";

/**
 * Portable "are you sure?" confirm.
 *
 * - **Tauri**: uses `@tauri-apps/plugin-dialog`'s `ask()` (native modal).
 *   `window.confirm` is a silent no-op in WKWebView, which silently
 *   dropped every destructive click in Stream E's first cut.
 * - **Web**: uses `window.confirm` (supported everywhere).
 *
 * Returns `true` if the user confirmed, `false` otherwise.
 */
export async function confirmDestructive(message: string): Promise<boolean> {
  if (isTauriApp()) {
    // Dynamic import so the plugin is tree-shaken from the web bundle.
    const { ask } = await import("@tauri-apps/plugin-dialog");
    return await ask(message, {
      kind: "warning",
      okLabel: "OK",
      cancelLabel: "Cancel",
    });
  }
  return window.confirm(message);
}
