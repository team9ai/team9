import { useRef, useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

const TAP_COUNT = 10;
const TAP_WINDOW_MS = 3000;
const TOAST_DURATION_MS = 2000;

/**
 * Returns an onClick handler that toggles DevTools after 10 rapid taps
 * (within 3 seconds), similar to Android's developer mode easter egg.
 * Also returns a message string for displaying a brief toast notification.
 */
export function useDevtools() {
  const tapsRef = useRef<number[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const showMessage = (msg: string) => {
    clearTimeout(timerRef.current);
    setMessage(msg);
    timerRef.current = setTimeout(() => setMessage(null), TOAST_DURATION_MS);
  };

  const handleTap = useCallback(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;

    const now = Date.now();
    tapsRef.current.push(now);

    // Keep only taps within the time window
    tapsRef.current = tapsRef.current.filter((t) => now - t < TAP_WINDOW_MS);

    if (tapsRef.current.length >= TAP_COUNT) {
      tapsRef.current = [];
      invoke("toggle_devtools");
      showMessage("DevTools toggled");
    }
  }, []);

  return { handleTap, message };
}
