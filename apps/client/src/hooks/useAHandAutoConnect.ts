import { useEffect, useRef } from "react";
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
 *    If no pending request is found, the device was likely already approved
 *    from a previous session — this is normal and not an error.
 *
 * This hook is a no-op when not running inside the Tauri desktop app.
 */

// Tauri v2 uses __TAURI_INTERNALS__ instead of Tauri v1's __TAURI__.
const isTauriApp = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

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

async function startLocalDevice(): Promise<void> {
  try {
    // 1. Find the OpenClaw installed app in this workspace.
    const installedAppId = await findOpenClawAppId();
    if (!installedAppId) {
      console.info(
        "[aHand] No active OpenClaw app found in this workspace — skipping",
      );
      return;
    }

    // 2. Get gateway URL from Team9 API.
    const info = await applicationsApi.getOpenClawGatewayInfo(installedAppId);

    // 3. Get the stable node ID for this device (persisted across restarts).
    const nodeId = await invoke<string>("ahand_get_node_id");

    // 4. Start the daemon.
    await invoke("ahand_start", {
      gatewayUrl: info.gatewayUrl,
      authToken: null,
      nodeId,
    });
    console.info("[aHand] daemon started, connecting to", info.gatewayUrl);

    // 5. Poll for a pending pairing request (up to 30s) and auto-approve.
    //    If the device was already approved in a previous session, no pending
    //    request will appear — that is expected and not an error.
    let approved = false;
    for (let i = 0; i < 15; i++) {
      await new Promise<void>((r) => setTimeout(r, 2000));
      const devices = await applicationsApi.getOpenClawDevices(installedAppId);
      const pending = devices.find((d) => d.status === "pending");
      if (pending) {
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
    }

    if (!approved) {
      // No pending request within 30s — device is likely already paired.
      console.info(
        "[aHand] No pending pairing request found — device may already be paired",
      );
    }
  } catch (err) {
    // Non-fatal — app works without local device.
    console.warn("[aHand] failed to start local device:", err);
  }
}
