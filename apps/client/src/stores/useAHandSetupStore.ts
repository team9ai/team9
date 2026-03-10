import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { applicationsApi } from "../services/api/applications.js";
import wsService from "../services/websocket/index.js";

const isTauriApp = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// --- Types ---

export type StepGroup = "ahand" | "browser" | "activation";
export type StepStatus = "pending" | "running" | "completed" | "error";

export interface SetupStep {
  id: string;
  group: StepGroup;
  label: string;
  status: StepStatus;
  error?: string;
}

/** Shared context passed between step handlers to carry data forward. */
interface StepContext {
  appId?: string;
  gatewayUrl?: string;
  authToken?: string;
  nodeId?: string;
}

// --- Step definitions ---

const createInitialSteps = (): SetupStep[] => [
  {
    id: "find-app",
    group: "ahand",
    label: "Find OpenClaw app",
    status: "pending",
  },
  {
    id: "wait-for-bot",
    group: "ahand",
    label: "Wait for bot instance",
    status: "pending",
  },
  {
    id: "gateway-info",
    group: "ahand",
    label: "Get gateway info",
    status: "pending",
  },
  {
    id: "node-id",
    group: "ahand",
    label: "Get device node ID",
    status: "pending",
  },
  {
    id: "start-daemon",
    group: "ahand",
    label: "Start daemon",
    status: "pending",
  },
  {
    id: "device-pairing",
    group: "ahand",
    label: "Device pairing",
    status: "pending",
  },
  {
    id: "browser-node",
    group: "browser",
    label: "Check Node.js",
    status: "pending",
  },
  {
    id: "browser-cli",
    group: "browser",
    label: "Download CLI tool",
    status: "pending",
  },
  {
    id: "browser-daemon",
    group: "browser",
    label: "Download daemon bundle",
    status: "pending",
  },
  {
    id: "browser-socket",
    group: "browser",
    label: "Create socket directory",
    status: "pending",
  },
  {
    id: "browser-chromium",
    group: "browser",
    label: "Detect browser",
    status: "pending",
  },
  {
    id: "browser-config",
    group: "browser",
    label: "Generate runtime config",
    status: "pending",
  },
  {
    id: "restart-daemon",
    group: "activation",
    label: "Restart daemon",
    status: "pending",
  },
  {
    id: "verify-connection",
    group: "activation",
    label: "Verify connection",
    status: "pending",
  },
];

// --- Step handlers (ahand group only) ---

type StepHandler = (ctx: StepContext) => Promise<void>;

const stepHandlers: Record<string, StepHandler> = {
  "find-app": async (ctx) => {
    let apps;
    try {
      apps = await applicationsApi.getInstalledApplications();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to fetch installed applications: ${msg}`);
    }
    const openclawApp = apps.find(
      (app) => app.applicationId === "openclaw" && app.isActive,
    );
    if (!openclawApp) {
      const existing = apps.find((app) => app.applicationId === "openclaw");
      if (existing) {
        switch (existing.status) {
          case "inactive":
            throw new Error(
              "OpenClaw app is installed but inactive. Please activate it first.",
            );
          case "pending":
            throw new Error(
              "OpenClaw app is still being set up. Please wait for the installation to complete.",
            );
          case "error":
            throw new Error(
              "OpenClaw app is in an error state. Please check the application settings or reinstall it.",
            );
          default:
            throw new Error(
              `OpenClaw app found but not usable (status: ${existing.status}, isActive: ${existing.isActive}).`,
            );
        }
      }
      throw new Error(
        "No OpenClaw app found in this workspace. Please install OpenClaw first.",
      );
    }
    ctx.appId = openclawApp.id;
  },

  "wait-for-bot": async (ctx) => {
    if (!ctx.appId) throw new Error("Missing app ID from previous step");

    const BOT_STARTUP_DURATION = 150;
    const POLL_INTERVAL_MS = 5000;

    // Check current instance status
    try {
      const status = await applicationsApi.getOpenClawStatus(ctx.appId);
      console.log(
        `==============Initial OpenClaw status===========: ${status.status}`,
      );
      switch (status.status) {
        case "running":
          return;
        case "stopped":
          throw new Error(
            "OpenClaw instance is stopped. Please start it from the admin panel.",
          );
        case "error":
          throw new Error(
            "OpenClaw instance is in an error state. Please check the instance logs or restart it.",
          );
        // "creating" — proceed to wait
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to check OpenClaw instance status: ${msg}`);
    }

    // Try to get bot userId for WebSocket early-exit
    let botUserId: string | null = null;
    try {
      const bots = await applicationsApi.getOpenClawBots(ctx.appId);
      botUserId = bots[0]?.userId ?? null;
    } catch {
      // Bots may not be available yet
    }

    const store = useAHandSetupStore.getState;

    return new Promise<void>((resolve, reject) => {
      let remaining = BOT_STARTUP_DURATION;
      let settled = false;
      store().setBotCountdown(remaining);

      const countdownTimer = setInterval(() => {
        remaining -= 1;
        store().setBotCountdown(remaining);
        if (remaining <= 0) {
          cleanup();
          reject(
            new Error(
              "Bot instance did not start within the expected time. Please retry.",
            ),
          );
        }
      }, 1000);

      const pollTimer = setInterval(async () => {
        try {
          const status = await applicationsApi.getOpenClawStatus(ctx.appId!);
          switch (status.status) {
            case "running":
              cleanup();
              resolve();
              return;
            case "stopped":
              cleanup();
              reject(
                new Error(
                  "OpenClaw instance is stopped. Please start it from the admin panel.",
                ),
              );
              return;
            case "error":
              cleanup();
              reject(
                new Error(
                  "OpenClaw instance is in an error state. Please check the instance logs or restart it.",
                ),
              );
              return;
            // "creating" — keep polling
          }
        } catch {
          // Keep polling
        }
      }, POLL_INTERVAL_MS);

      const handleUserOnline = (event: { userId: string }) => {
        if (botUserId && event.userId === botUserId) {
          cleanup();
          resolve();
        }
      };
      if (botUserId) {
        wsService.onUserOnline(handleUserOnline);
      }

      function cleanup() {
        if (settled) return;
        settled = true;
        abortWaitForBot = null;
        clearInterval(countdownTimer);
        clearInterval(pollTimer);
        store().setBotCountdown(0);
        if (botUserId) {
          wsService.off("user_online", handleUserOnline);
        }
      }

      // Expose cleanup for external abort (e.g. reset on workspace switch)
      abortWaitForBot = () => {
        cleanup();
        reject(new Error("Aborted"));
      };
    });
  },

  "gateway-info": async (ctx) => {
    if (!ctx.appId) throw new Error("Missing app ID from previous step");
    let info;
    try {
      info = await applicationsApi.getOpenClawGatewayInfo(ctx.appId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("404") || msg.includes("Not Found")) {
        throw new Error(
          "No OpenClaw instance configured. The instance may not have been provisioned yet.",
        );
      }
      if (msg.includes("503") || msg.includes("Service Unavailable")) {
        throw new Error(
          "OpenClaw instance is not running. Please start it from the admin panel.",
        );
      }
      throw new Error(`Failed to get gateway info: ${msg}`);
    }
    if (!info.gatewayUrl) {
      throw new Error(
        "Gateway URL is empty. The OpenClaw instance may still be starting up.",
      );
    }
    ctx.gatewayUrl = info.gatewayUrl;
    // Extract auth token from URL query param. The server appends :port after token.
    const tokenMatch = info.gatewayUrl.match(/[?&]token=([^:/?&#]+)/);
    ctx.authToken = tokenMatch ? tokenMatch[1] : undefined;
    if (!ctx.authToken) {
      console.warn(
        "[ahand-setup] No auth token found in gateway URL — daemon may fail to authenticate.",
        info.gatewayUrl,
      );
    }
  },

  "node-id": async (ctx) => {
    try {
      ctx.nodeId = await invoke<string>("ahand_get_node_id");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Failed to get or create device node ID. Check ~/.ahand/ directory permissions: ${msg}`,
      );
    }
  },

  "start-daemon": async (ctx) => {
    if (!ctx.gatewayUrl || !ctx.nodeId) {
      throw new Error(
        `Missing daemon startup parameters (gatewayUrl: ${ctx.gatewayUrl ? "ok" : "missing"}, nodeId: ${ctx.nodeId ? "ok" : "missing"})`,
      );
    }
    try {
      await invoke("ahand_start_daemon_only", {
        gatewayUrl: ctx.gatewayUrl,
        authToken: ctx.authToken ?? null,
        nodeId: ctx.nodeId,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not installed")) {
        throw new Error(
          "aHand daemon (ahandd) not found. Checked: app sidecar, ~/.ahand/bin/, and PATH.",
        );
      }
      if (msg.includes("spawn")) {
        throw new Error(`Failed to start daemon process: ${msg}`);
      }
      throw new Error(`Daemon startup failed: ${msg}`);
    }
    // Brief health check — wait a moment then verify the process didn't crash immediately
    await new Promise<void>((r) => setTimeout(r, 500));
    const alive = await invoke<boolean>("ahand_is_running").catch(() => false);
    if (!alive) {
      throw new Error(
        "Daemon process exited immediately after starting. Check ~/.ahand/config.toml and gateway URL.",
      );
    }
  },

  "device-pairing": async (ctx) => {
    if (!ctx.appId) throw new Error("Missing app ID from previous step");

    // Read the local cryptographic device ID so we can detect if it's
    // already approved without needing a new pending request.
    let localDeviceId: string | null = null;
    try {
      localDeviceId = await invoke<string | null>("ahand_get_device_id");
    } catch {
      // Identity file may not exist yet on first run — that's fine.
    }

    const maxAttempts = 15;
    const intervalMs = 2000;
    let deviceIdAcquiredAt = localDeviceId ? 0 : -1;
    let lastApiError: string | null = null;

    for (let i = 0; i < maxAttempts; i++) {
      // Check daemon is still alive — if it crashed, pairing will never succeed
      const alive = await invoke<boolean>("ahand_is_running").catch(
        () => false,
      );
      if (!alive) {
        throw new Error(
          "Daemon process has exited. It may have crashed due to invalid config or network issues. Check ~/.ahand/config.toml.",
        );
      }

      // Re-read device ID if we didn't get it initially (daemon may
      // have generated it after starting).
      if (!localDeviceId) {
        try {
          localDeviceId = await invoke<string | null>("ahand_get_device_id");
          if (localDeviceId) deviceIdAcquiredAt = i;
        } catch {
          // ignore — daemon may still be generating the identity file
        }
      }

      let devices;
      try {
        devices = await applicationsApi.getOpenClawDevices(ctx.appId);
        lastApiError = null;
      } catch (err) {
        lastApiError = err instanceof Error ? err.message : String(err);
        // Keep retrying — transient API errors shouldn't abort immediately
        if (i < maxAttempts - 1) {
          await new Promise<void>((r) => setTimeout(r, intervalMs));
          continue;
        }
        throw new Error(
          `Failed to fetch device list from server: ${lastApiError}`,
        );
      }

      // Check if this device is already approved (e.g. from a previous session).
      if (localDeviceId) {
        const approved = devices.find(
          (d) => d.deviceId === localDeviceId && d.status === "approved",
        );
        if (approved) return;
      }

      // Look for a pending pairing request to auto-approve.
      // Only match by deviceId to avoid accidentally approving a different
      // machine's request when multiple devices pair concurrently.
      // If localDeviceId is not yet available, keep retrying — the daemon
      // may still be generating the identity file.
      if (localDeviceId) {
        const pending = devices.find(
          (d) => d.deviceId === localDeviceId && d.status === "pending",
        );
        if (pending) {
          try {
            await applicationsApi.selfApproveOpenClawDevice(
              ctx.appId,
              pending.request_id,
            );
            return;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new Error(
              `Found pending request but auto-approve failed: ${msg}`,
            );
          }
        }
      }
      if (i < maxAttempts - 1) {
        await new Promise<void>((r) => setTimeout(r, intervalMs));
      }
    }

    // Build a detailed timeout error based on what we observed
    const details: string[] = [];
    if (deviceIdAcquiredAt < 0) {
      details.push(
        "Device identity was never generated — daemon may not have connected to the gateway.",
      );
      if (!ctx.authToken) {
        details.push(
          "No auth token was found in the gateway URL — the daemon cannot authenticate.",
        );
      }
    } else {
      details.push(
        `Device ID acquired (attempt ${deviceIdAcquiredAt + 1}/${maxAttempts}), but no matching pairing request appeared on the gateway.`,
      );
      details.push(
        "The daemon may be failing WebSocket authentication, or the gateway rejected the connection.",
      );
    }
    if (lastApiError) {
      details.push(`Last API error: ${lastApiError}`);
    }
    throw new Error(`Pairing timed out.\n${details.join("\n")}`);
  },

  "restart-daemon": async (ctx) => {
    if (!ctx.gatewayUrl || !ctx.nodeId) {
      throw new Error(
        `Missing daemon startup parameters (gatewayUrl: ${ctx.gatewayUrl ? "ok" : "missing"}, nodeId: ${ctx.nodeId ? "ok" : "missing"})`,
      );
    }
    // Restart the daemon so it picks up browser dependencies and auto_accept mode
    try {
      await invoke("ahand_start_daemon_only", {
        gatewayUrl: ctx.gatewayUrl,
        authToken: ctx.authToken ?? null,
        nodeId: ctx.nodeId,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Daemon restart failed: ${msg}`);
    }
    // Brief health check
    await new Promise<void>((r) => setTimeout(r, 500));
    const alive = await invoke<boolean>("ahand_is_running").catch(() => false);
    if (!alive) {
      throw new Error(
        "Daemon exited immediately after restart. The process may have crashed.",
      );
    }
  },

  "verify-connection": async (ctx) => {
    // 1. Check daemon is running
    const running = await invoke<boolean>("ahand_is_running");
    if (!running) {
      throw new Error("Daemon is not running after restart");
    }

    // 2. Check browser dependencies are ready
    const browserReady = await invoke<boolean>("ahand_browser_is_ready");
    if (!browserReady) {
      throw new Error("Browser dependencies are not ready");
    }

    // 3. Verify device is still approved (daemon restart triggers reconnect,
    //    may take a moment for the gateway to see the device again)
    if (!ctx.appId) throw new Error("Missing app ID");

    let localDeviceId: string | null = null;
    try {
      localDeviceId = await invoke<string | null>("ahand_get_device_id");
    } catch {
      // ignore
    }

    const maxAttempts = 10;
    const intervalMs = 1500;

    for (let i = 0; i < maxAttempts; i++) {
      // Re-read device ID if we didn't get it — daemon restart may have
      // regenerated the identity file.
      if (!localDeviceId) {
        try {
          localDeviceId = await invoke<string | null>("ahand_get_device_id");
        } catch {
          // ignore — retry next iteration
        }
      }

      if (localDeviceId) {
        const devices = await applicationsApi.getOpenClawDevices(ctx.appId);
        const approved = devices.find(
          (d) => d.deviceId === localDeviceId && d.status === "approved",
        );
        if (approved) return;
      }
      // If localDeviceId is still null, keep retrying instead of
      // accepting any approved device (which could be a different machine).
      if (i < maxAttempts - 1) {
        await new Promise<void>((r) => setTimeout(r, intervalMs));
      }
    }
    throw new Error(
      "Device not recognized by gateway after restart. Please retry.",
    );
  },
};

// --- Tauri event listener for browser-init step progress ---

let unlisten: UnlistenFn | null = null;
let abortWaitForBot: (() => void) | null = null;

async function setupBrowserInitEventListener(): Promise<void> {
  if (!isTauriApp() || unlisten) return;

  unlisten = await listen<{ step: string; status: string; error?: string }>(
    "ahand-setup-step",
    (event) => {
      const { step, status, error } = event.payload;
      useAHandSetupStore
        .getState()
        .setStepStatus(step, status as StepStatus, error);
    },
  );
}

// --- Store ---

interface AHandSetupState {
  // State
  steps: SetupStep[];
  dialogOpen: boolean;
  isRunning: boolean;
  hasRun: boolean;
  stepContext: StepContext;
  botCountdown: number;
  /** Incremented on reset to abort any in-flight run(). */
  _runGeneration: number;

  // Actions
  setBotCountdown: (seconds: number) => void;
  reset: () => void;
  openDialog: () => void;
  closeDialog: () => void;
  setStepStatus: (stepId: string, status: StepStatus, error?: string) => void;
  run: () => Promise<void>;
  retryFrom: (stepId: string) => Promise<void>;
}

export const useAHandSetupStore = create<AHandSetupState>()(
  devtools(
    (set, get) => ({
      steps: createInitialSteps(),
      dialogOpen: false,
      isRunning: false,
      hasRun: false,
      stepContext: {},
      botCountdown: 0,
      _runGeneration: 0,

      setBotCountdown: (seconds) =>
        set({ botCountdown: seconds }, false, "setBotCountdown"),

      reset: () => {
        // Abort in-flight wait-for-bot if running
        if (abortWaitForBot) {
          abortWaitForBot();
          abortWaitForBot = null;
        }
        // Clean up browser event listener
        if (unlisten) {
          unlisten();
          unlisten = null;
        }
        set(
          (s) => ({
            steps: createInitialSteps(),
            isRunning: false,
            hasRun: false,
            stepContext: {},
            botCountdown: 0,
            dialogOpen: false,
            _runGeneration: s._runGeneration + 1,
          }),
          false,
          "reset",
        );
      },

      openDialog: () => set({ dialogOpen: true }, false, "openDialog"),

      closeDialog: () => set({ dialogOpen: false }, false, "closeDialog"),

      setStepStatus: (stepId, status, error) =>
        set(
          (state) => ({
            steps: state.steps.map((step) =>
              step.id === stepId ? { ...step, status, error } : step,
            ),
          }),
          false,
          "setStepStatus",
        ),

      run: async () => {
        const state = get();
        if (state.isRunning) return;

        const generation = state._runGeneration;
        const isStale = () => get()._runGeneration !== generation;

        set({ isRunning: true, hasRun: true }, false, "run/start");

        const ctx: StepContext = { ...get().stepContext };

        for (const step of get().steps) {
          // Abort if reset() was called (workspace switch).
          if (isStale()) return;

          // Skip already completed steps
          if (step.status === "completed") continue;

          const handler = stepHandlers[step.id];

          if (handler) {
            // Steps with handlers (ahand + activation groups)
            get().setStepStatus(step.id, "running");
            try {
              await handler(ctx);
              // Abort if reset() was called while handler was running.
              if (isStale()) return;
              set({ stepContext: { ...ctx } }, false, "run/updateContext");
              get().setStepStatus(step.id, "completed");
            } catch (err) {
              // Abort silently if reset during handler execution.
              if (isStale()) return;
              const message = err instanceof Error ? err.message : String(err);
              get().setStepStatus(step.id, "error", message);
              set({ isRunning: false }, false, "run/error");
              return;
            }
          } else {
            // Browser group steps — check if already installed before downloading.
            const browserReady = await invoke<boolean>(
              "ahand_browser_is_ready",
            ).catch(() => false);
            if (browserReady) {
              // All browser dependencies already present — skip the entire group.
              set(
                (s) => ({
                  steps: s.steps.map((st) =>
                    st.group === "browser"
                      ? { ...st, status: "completed" as StepStatus }
                      : st,
                  ),
                }),
                false,
                "run/browser-cached",
              );
              continue;
            }

            // Not ready — kick off batch init and let Tauri events
            // update individual step statuses.
            get().setStepStatus(step.id, "running");
            try {
              // Ensure the event listener is set up before starting the command
              await setupBrowserInitEventListener();
              await invoke("ahand_browser_init_with_progress");
              if (isStale()) return;
              // After the invoke resolves, mark any remaining browser steps
              // that are still "running" as completed.
              set(
                (s) => ({
                  steps: s.steps.map((st) =>
                    st.group === "browser" && st.status === "running"
                      ? { ...st, status: "completed" }
                      : st,
                  ),
                }),
                false,
                "run/browser-batch-done",
              );
            } catch (err) {
              if (isStale()) return;
              const message = err instanceof Error ? err.message : String(err);
              // Find the first non-completed browser step and mark it as error
              const currentSteps = get().steps;
              const firstFailedStep = currentSteps.find(
                (st) => st.group === "browser" && st.status !== "completed",
              );
              set(
                (s) => ({
                  steps: s.steps.map((st) => {
                    if (firstFailedStep && st.id === firstFailedStep.id)
                      return {
                        ...st,
                        status: "error" as StepStatus,
                        error: message,
                      };
                    if (st.group === "browser" && st.status === "running")
                      return { ...st, status: "pending" as StepStatus };
                    return st;
                  }),
                  isRunning: false,
                }),
                false,
                "run/browser-error",
              );
              return;
            }
            // All browser steps handled as a batch — continue to activation steps
            continue;
          }
        }

        set({ isRunning: false }, false, "run/done");
      },

      retryFrom: async (stepId) => {
        const state = get();
        if (state.isRunning) return;

        // Find the index of the step to retry from
        const stepIndex = state.steps.findIndex((s) => s.id === stepId);
        if (stepIndex === -1) return;

        // Clean up the browser event listener so it can be re-set up on retry
        if (unlisten) {
          unlisten();
          unlisten = null;
        }

        // Reset the target step and all subsequent steps to pending.
        // Do NOT reset hasRun — it guards the auto-trigger in _authenticated.tsx.
        set(
          (s) => ({
            steps: s.steps.map((step, i) =>
              i >= stepIndex
                ? { ...step, status: "pending" as StepStatus, error: undefined }
                : step,
            ),
          }),
          false,
          "retryFrom/reset",
        );

        // Re-run from the beginning (run() skips completed steps)
        await get().run();
      },
    }),
    { name: "AHandSetupStore" },
  ),
);
