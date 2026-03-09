import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { applicationsApi } from "../services/api/applications.js";

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
    const apps = await applicationsApi.getInstalledApplications();
    const openclawApp = apps.find(
      (app) => app.applicationId === "openclaw" && app.isActive,
    );
    if (!openclawApp) {
      throw new Error("No active OpenClaw app found in this workspace");
    }
    ctx.appId = openclawApp.id;
  },

  "gateway-info": async (ctx) => {
    if (!ctx.appId) throw new Error("Missing app ID");
    const info = await applicationsApi.getOpenClawGatewayInfo(ctx.appId);
    ctx.gatewayUrl = info.gatewayUrl;
    // Extract auth token from URL query param. The server appends :port after token.
    const tokenMatch = info.gatewayUrl.match(/[?&]token=([^:/?&#]+)/);
    ctx.authToken = tokenMatch ? tokenMatch[1] : undefined;
  },

  "node-id": async (ctx) => {
    ctx.nodeId = await invoke<string>("ahand_get_node_id");
  },

  "start-daemon": async (ctx) => {
    if (!ctx.gatewayUrl || !ctx.nodeId) {
      throw new Error("Missing daemon startup parameters");
    }
    await invoke("ahand_start_daemon_only", {
      gatewayUrl: ctx.gatewayUrl,
      authToken: ctx.authToken ?? null,
      nodeId: ctx.nodeId,
    });
  },

  "device-pairing": async (ctx) => {
    if (!ctx.appId) throw new Error("Missing app ID");

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

    for (let i = 0; i < maxAttempts; i++) {
      // Re-read device ID if we didn't get it initially (daemon may
      // have generated it after starting).
      if (!localDeviceId) {
        try {
          localDeviceId = await invoke<string | null>("ahand_get_device_id");
        } catch {
          // ignore
        }
      }

      const devices = await applicationsApi.getOpenClawDevices(ctx.appId);

      // Check if this device is already approved (e.g. from a previous session).
      if (localDeviceId) {
        const approved = devices.find(
          (d) => d.deviceId === localDeviceId && d.status === "approved",
        );
        if (approved) return;
      }

      // Look for a pending pairing request to auto-approve.
      // Prefer matching by deviceId to avoid accidentally approving a
      // different machine's request when multiple devices pair concurrently.
      const pending = localDeviceId
        ? devices.find(
            (d) => d.deviceId === localDeviceId && d.status === "pending",
          )
        : devices.find((d) => d.status === "pending");
      if (pending) {
        await applicationsApi.selfApproveOpenClawDevice(
          ctx.appId,
          pending.request_id,
        );
        return;
      }
      if (i < maxAttempts - 1) {
        await new Promise<void>((r) => setTimeout(r, intervalMs));
      }
    }
    throw new Error(
      "Pairing timed out. Please ensure the OpenClaw instance is running.",
    );
  },

  "restart-daemon": async (ctx) => {
    if (!ctx.gatewayUrl || !ctx.nodeId) {
      throw new Error("Missing daemon startup parameters");
    }
    // Restart the daemon so it picks up browser dependencies and auto_accept mode
    await invoke("ahand_start_daemon_only", {
      gatewayUrl: ctx.gatewayUrl,
      authToken: ctx.authToken ?? null,
      nodeId: ctx.nodeId,
    });
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
      const devices = await applicationsApi.getOpenClawDevices(ctx.appId);
      if (localDeviceId) {
        const approved = devices.find(
          (d) => d.deviceId === localDeviceId && d.status === "approved",
        );
        if (approved) return;
      } else {
        // Fallback: any approved device means success
        const approved = devices.find((d) => d.status === "approved");
        if (approved) return;
      }
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

  // Actions
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

        set({ isRunning: true, hasRun: true }, false, "run/start");

        const ctx: StepContext = { ...get().stepContext };

        for (const step of get().steps) {
          // Skip already completed steps
          if (step.status === "completed") continue;

          const handler = stepHandlers[step.id];

          if (handler) {
            // Steps with handlers (ahand + activation groups)
            get().setStepStatus(step.id, "running");
            try {
              await handler(ctx);
              set({ stepContext: { ...ctx } }, false, "run/updateContext");
              get().setStepStatus(step.id, "completed");
            } catch (err) {
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
