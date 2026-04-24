import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauriApp } from "@/lib/tauri";
import { ahandTauri } from "@/services/ahand-tauri";
import type { DaemonStatus } from "@/types/tauri-ahand";

export type LocalStatus = DaemonStatus | { state: "web" };

export function useAhandLocalStatus(): LocalStatus {
  const [status, setStatus] = useState<LocalStatus>(
    isTauriApp() ? { state: "idle" } : { state: "web" },
  );

  useEffect(() => {
    if (!isTauriApp()) return;

    let unlistener: (() => void) | null = null;

    ahandTauri
      .status()
      .then((s) => setStatus(s))
      .catch(() => {});

    listen<DaemonStatus>("ahand-daemon-status", (ev) => setStatus(ev.payload))
      .then((un) => {
        unlistener = un;
      })
      .catch(() => {});

    return () => {
      unlistener?.();
    };
  }, []);

  return status;
}
