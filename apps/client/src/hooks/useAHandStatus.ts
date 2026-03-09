import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { applicationsApi } from "../services/api/applications.js";

export type AHandStatus =
  | "not-desktop" // Not running inside Tauri desktop app
  | "no-daemon" // Tauri app but ahandd process is not running
  | "connecting" // ahandd running, but device not yet approved by OpenClaw
  | "connected"; // ahandd running AND device is approved — OpenClaw can use local tools

// Tauri v2 uses __TAURI_INTERNALS__ instead of Tauri v1's __TAURI__.
const isTauriApp = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function findOpenClawAppId(): Promise<string | null> {
  const apps = await applicationsApi.getInstalledApplications();
  return (
    apps.find((a) => a.applicationId === "openclaw" && a.isActive)?.id ?? null
  );
}

/**
 * Polls the aHand daemon status using two independent layers:
 *
 * Fast (5s): checks if the ahandd process is alive via `ahand_is_running`.
 *   A dead process immediately transitions to "no-daemon".
 *
 * Slow (30s): checks the OpenClaw gateway device list via Team9 API and
 *   matches this device's cryptographic ID (`deviceId`) against the approved
 *   list. This is the authoritative "connected" signal.
 *
 * The slow check also runs immediately on mount so the status is accurate
 * from the first render.
 */
export function useAHandStatus(): AHandStatus {
  const [status, setStatus] = useState<AHandStatus>("not-desktop");

  // Cache API lookups across poll intervals to avoid redundant network calls.
  // undefined = not yet fetched / last attempt failed (will retry).
  // string    = successfully resolved (permanent cache, value is stable).
  // appId: null means no active OpenClaw app in this workspace (cache forever).
  const appIdRef = useRef<string | null | undefined>(undefined);
  const deviceIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!isTauriApp()) return;

    setStatus("no-daemon");

    let cancelled = false;

    // Fast check: only cares about process liveness.
    // - Dead process → immediately "no-daemon".
    // - Process alive after being "no-daemon" → immediately "connecting", so the
    //   user sees a response right away instead of waiting up to 30s for slowCheck.
    //   slowCheck will later promote to "connected" once the device is approved.
    const fastCheck = async () => {
      if (cancelled) return;
      try {
        const running = await invoke<boolean>("ahand_is_running");
        if (!running) {
          setStatus("no-daemon");
        } else {
          setStatus((prev) => (prev === "no-daemon" ? "connecting" : prev));
        }
      } catch {
        setStatus("no-daemon");
      }
    };

    // Slow check: authoritative status from the gateway device list.
    const slowCheck = async () => {
      if (cancelled) return;
      try {
        const running = await invoke<boolean>("ahand_is_running");
        if (!running) {
          setStatus("no-daemon");
          return;
        }

        // Resolve and cache the OpenClaw installed app ID.
        if (appIdRef.current === undefined) {
          appIdRef.current = await findOpenClawAppId();
        }

        // Resolve and cache the cryptographic device ID from ahandd's identity file.
        // Only cache on success (string). Leave as undefined when the file does not
        // exist yet (daemon just started) or the invoke throws — so we retry next poll.
        if (deviceIdRef.current === undefined) {
          const id = await invoke<string | null>("ahand_get_device_id").catch(
            () => undefined,
          );
          if (typeof id === "string") deviceIdRef.current = id;
        }

        const appId = appIdRef.current;
        const deviceId = deviceIdRef.current;

        if (!appId || !deviceId) {
          // No OpenClaw app installed, or identity file not yet written by daemon.
          setStatus("connecting");
          return;
        }

        const devices = await applicationsApi.getOpenClawDevices(appId);
        const isApproved = devices.some(
          (d) => d.status === "approved" && d.deviceId === deviceId,
        );
        setStatus(isApproved ? "connected" : "connecting");
      } catch {
        // Remote check failed (network/API error). Fall back to process-only check.
        // Don't downgrade "connected" on transient failures.
        try {
          const running = await invoke<boolean>("ahand_is_running");
          if (!running) setStatus("no-daemon");
        } catch {
          setStatus("no-daemon");
        }
      }
    };

    void slowCheck();
    const fastId = setInterval(fastCheck, 5_000);
    const slowId = setInterval(slowCheck, 30_000);

    return () => {
      cancelled = true;
      clearInterval(fastId);
      clearInterval(slowId);
    };
  }, []);

  return status;
}
