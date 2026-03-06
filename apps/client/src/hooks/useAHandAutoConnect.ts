import { useEffect, useRef, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { applicationsApi } from "../services/api/applications.js";

/**
 * Automatically starts the aHand daemon after the user logs into the desktop app.
 *
 * Flow:
 * 1. Find the installed OpenClaw app in the current workspace.
 * 2. Fetch the OpenClaw gateway URL from Team9 API.
 * 3. Start aHand daemon with the gateway URL and a stable node_id.
 * 4. Poll for a pending device pairing request (up to 30s) and auto-approve it.
 *    If no pending request is found, the user can click "retry" to poll again.
 *
 * This hook is a no-op when not running inside the Tauri desktop app.
 */

// Tauri v2 uses __TAURI_INTERNALS__ instead of Tauri v1's __TAURI__.
const isTauriApp = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// --- Shared retry state (consumed by LocalDeviceStatus via useAHandRetry) ---

type RetryState = "idle" | "polling" | "timeout";

let retryState: RetryState = "idle";
const retryListeners = new Set<() => void>();

function setRetryState(next: RetryState) {
  retryState = next;
  retryListeners.forEach((l) => l());
}

function subscribeRetry(listener: () => void) {
  retryListeners.add(listener);
  return () => {
    retryListeners.delete(listener);
  };
}

function getRetryState() {
  return retryState;
}

let retryFn: (() => void) | null = null;

export function useAHandRetry() {
  const state = useSyncExternalStore(subscribeRetry, getRetryState);
  return { retryState: state, retry: retryFn };
}

// ---------------------------------------------------------------------------

export function useAHandAutoConnect() {
  const started = useRef(false);

  useEffect(() => {
    // Only run once per session and only in Tauri desktop app.
    if (started.current || !isTauriApp()) return;
    started.current = true;

    void startLocalDevice();

    return () => {
      // Stop daemon when the authenticated layout unmounts (user logs out).
      invoke("ahand_stop").catch(() => {});
    };
  }, []);
}

async function findOpenClawAppId(): Promise<string | null> {
  const apps = await applicationsApi.getInstalledApplications();
  const openclawApp = apps.find(
    (app) => app.applicationId === "openclaw" && app.isActive,
  );
  return openclawApp?.id ?? null;
}

async function pollForPairing(installedAppId: string): Promise<void> {
  if (retryState === "polling") return;
  setRetryState("polling");
  console.log("[aHand] polling for pairing request (15x 2s)...");

  let approved = false;
  try {
    for (let i = 0; i < 15; i++) {
      const devices = await applicationsApi.getOpenClawDevices(installedAppId);
      console.log(
        `[aHand] poll ${i + 1}/15: devices =`,
        JSON.stringify(devices),
      );
      const pending = devices.find((d) => d.status === "pending");
      if (pending) {
        console.log(
          "[aHand] found pending device, approving:",
          pending.request_id,
        );
        await applicationsApi.selfApproveOpenClawDevice(
          installedAppId,
          pending.request_id,
        );
        console.info(
          "[aHand] device pairing auto-approved:",
          pending.request_id,
        );
        approved = true;
        break;
      }
      await new Promise<void>((r) => setTimeout(r, 2000));
    }
  } catch (err) {
    console.warn("[aHand] polling error:", err);
  }

  setRetryState(approved ? "idle" : "timeout");
}

async function startLocalDevice(): Promise<void> {
  try {
    // 1. Find the OpenClaw installed app in this workspace.
    console.log("[aHand] step 1: looking for OpenClaw app...");
    const installedAppId = await findOpenClawAppId();
    console.log("[aHand] step 1 result: installedAppId =", installedAppId);
    if (!installedAppId) {
      console.info(
        "[aHand] No active OpenClaw app found in this workspace — skipping",
      );
      return;
    }

    // 2. Get gateway URL from Team9 API.
    console.log("[aHand] step 2: fetching gateway info...");
    const info = await applicationsApi.getOpenClawGatewayInfo(installedAppId);
    console.log("[aHand] step 2 result: gatewayUrl =", info.gatewayUrl);

    // 3. Get the stable node ID for this device (persisted across restarts).
    console.log("[aHand] step 3: getting node ID...");
    const nodeId = await invoke<string>("ahand_get_node_id");
    console.log("[aHand] step 3 result: nodeId =", nodeId);

    // 4. Extract gateway auth token from the URL query string.
    //    The server appends :18789 after the token, so stop at ':'.
    const tokenMatch = info.gatewayUrl.match(/[?&]token=([^:/?&#]+)/);
    const authToken = tokenMatch ? tokenMatch[1] : null;
    console.log(
      "[aHand] step 4: authToken =",
      authToken ? `${authToken.slice(0, 8)}...` : null,
    );

    // 5. Start the daemon.
    console.log("[aHand] step 5: invoking ahand_start...");
    await invoke("ahand_start", {
      gatewayUrl: info.gatewayUrl,
      authToken,
      nodeId,
    });
    console.info("[aHand] step 5 done: daemon started");

    // 6. Poll for a pending pairing request (up to 30s) and auto-approve.
    //    If polling times out, user can click retry in the UI.
    retryFn = () => void pollForPairing(installedAppId);
    await pollForPairing(installedAppId);
  } catch (err) {
    // Non-fatal — app works without local device.
    console.warn("[aHand] failed to start local device:", err);
  }
}
