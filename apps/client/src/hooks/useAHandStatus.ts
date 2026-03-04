import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

export type AHandStatus = "connected" | "disconnected" | "not-desktop";

// Tauri v2 uses __TAURI_INTERNALS__ instead of Tauri v1's __TAURI__.
const isTauriApp = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Polls whether the aHand daemon process is alive.
 *
 * LIMITATION: 'connected' means the daemon process exists, not that it has
 * successfully paired with the OpenClaw gateway. For precise connectivity
 * status, query the Team9 devices API and look for an 'approved' device.
 */
export function useAHandStatus(): AHandStatus {
  const [status, setStatus] = useState<AHandStatus>("not-desktop");

  useEffect(() => {
    if (!isTauriApp()) return;

    const check = async () => {
      try {
        const running = await invoke<boolean>("ahand_is_running");
        setStatus(running ? "connected" : "disconnected");
      } catch {
        setStatus("disconnected");
      }
    };

    void check();
    const id = setInterval(check, 5000);
    return () => clearInterval(id);
  }, []);

  return status;
}
