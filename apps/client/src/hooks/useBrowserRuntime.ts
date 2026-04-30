import { useCallback, useEffect, useReducer, useRef } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { isTauriApp } from "@/lib/tauri";

// ---------------------------------------------------------------------------
// Wire types — MUST match apps/client/src-tauri/src/ahand/browser_runtime.rs.
// `ErrorCode` is intentionally snake_case here because the Rust `ErrorCode`
// enum serialises as snake_case strings (e.g. "permission_denied"). The plan
// document used camelCase by mistake; the wire shape is the source of truth.
// ---------------------------------------------------------------------------

export type TauriStepStatus = "ok" | "skipped" | "failed" | "notRun";
export type TauriLogStream = "stdout" | "stderr" | "info";

export type ErrorCode =
  | "permission_denied"
  | "network"
  | "no_system_browser"
  | "node_missing"
  | "version_mismatch"
  | "unknown";

export interface StepError {
  code: ErrorCode | string; // accept unknown future codes without crashing
  message: string;
}

export type ReloadFailureKind =
  | "shutdownTimeout"
  | "spawnFailedRolledBack"
  | "spawnFailedNoRollback";

export type BrowserProgressEvent =
  | { type: "stepStarted"; name: string; label: string }
  | { type: "stepLog"; name: string; line: string; stream: TauriLogStream }
  | {
      type: "stepFinished";
      name: string;
      status: TauriStepStatus;
      error?: StepError;
      durationMs: number;
    }
  | { type: "allFinished"; overall: TauriStepStatus; totalDurationMs: number }
  | { type: "reloadStarted" }
  | { type: "reloadOnline" }
  | { type: "reloadFailed"; kind: ReloadFailureKind; message: string };

export interface BrowserStepStatus {
  name: string;
  label: string;
  status: TauriStepStatus;
  detail?: string;
  error?: StepError;
}

export interface BrowserStatus {
  overall: TauriStepStatus;
  steps: BrowserStepStatus[];
  enabled: boolean;
  agentVisible: boolean;
  queriedAt: string;
}

// ---------------------------------------------------------------------------
// In-flight per-step accumulator. Lives only while the install/reload runs.
// ---------------------------------------------------------------------------

export interface StepFeedEntry {
  label: string;
  status: TauriStepStatus;
  logs: { line: string; stream: TauriLogStream }[];
  error?: StepError;
}

export interface StepFeed {
  [stepName: string]: StepFeedEntry;
}

// ---------------------------------------------------------------------------
// UI state machine
// ---------------------------------------------------------------------------

export type RuntimeUiState =
  | { kind: "loading" }
  | { kind: "idle"; status: BrowserStatus }
  | { kind: "installing"; steps: StepFeed }
  | { kind: "reloading"; steps: StepFeed }
  | {
      kind: "error";
      status: BrowserStatus | null;
      message: string;
      steps: StepFeed;
    };

type Action =
  | { type: "loaded"; status: BrowserStatus }
  | { type: "loadFailed"; message: string }
  | { type: "progress"; event: BrowserProgressEvent }
  | { type: "installStarted" }
  | { type: "installDone"; status: BrowserStatus }
  | {
      type: "installFailed";
      message: string;
      status: BrowserStatus | null;
      steps: StepFeed;
    }
  | { type: "setEnabledStarted" }
  | { type: "setEnabledDone"; status: BrowserStatus }
  | {
      type: "setEnabledFailed";
      message: string;
      status: BrowserStatus | null;
      steps: StepFeed;
    };

function emptyFeed(): StepFeed {
  return {};
}

function currentSteps(state: RuntimeUiState): StepFeed {
  if (state.kind === "installing" || state.kind === "reloading") {
    return state.steps;
  }
  if (state.kind === "error") return state.steps;
  return emptyFeed();
}

export function applyProgress(
  steps: StepFeed,
  event: BrowserProgressEvent,
): StepFeed {
  switch (event.type) {
    case "stepStarted": {
      const existing = steps[event.name];
      return {
        ...steps,
        [event.name]: {
          label: event.label,
          status: "notRun",
          logs: existing?.logs ?? [],
          error: undefined,
        },
      };
    }
    case "stepLog": {
      const existing: StepFeedEntry = steps[event.name] ?? {
        label: event.name,
        status: "notRun",
        logs: [],
      };
      return {
        ...steps,
        [event.name]: {
          ...existing,
          logs: [...existing.logs, { line: event.line, stream: event.stream }],
        },
      };
    }
    case "stepFinished": {
      const existing: StepFeedEntry = steps[event.name] ?? {
        label: event.name,
        status: "notRun",
        logs: [],
      };
      return {
        ...steps,
        [event.name]: {
          ...existing,
          status: event.status,
          error: event.error,
        },
      };
    }
    default:
      return steps;
  }
}

function reducer(state: RuntimeUiState, action: Action): RuntimeUiState {
  switch (action.type) {
    case "loaded":
      return { kind: "idle", status: action.status };

    case "loadFailed":
      return {
        kind: "error",
        status: null,
        message: action.message,
        steps: emptyFeed(),
      };

    case "installStarted":
      return { kind: "installing", steps: emptyFeed() };

    case "progress": {
      // We may receive progress events from a setEnabled call when the state
      // is still "idle" (the very first reloadStarted arrives before our
      // setEnabledStarted action lands in some races) — treat it as a
      // transition into reloading so the log drawer keeps streaming.
      if (action.event.type === "reloadStarted") {
        return { kind: "reloading", steps: currentSteps(state) };
      }
      if (action.event.type === "reloadOnline") {
        // Stay in current state; the awaited command resolves and flips us.
        return state;
      }
      if (action.event.type === "reloadFailed") {
        // Surface as an error toast; reducer keeps current steps so the user
        // can still inspect logs. installDone/setEnabledDone never arrives in
        // this path — the awaited promise still resolves with a final status.
        return state;
      }
      if (action.event.type === "allFinished") {
        return state;
      }
      // stepStarted / stepLog / stepFinished
      if (state.kind !== "installing" && state.kind !== "reloading") {
        return state;
      }
      return { ...state, steps: applyProgress(state.steps, action.event) };
    }

    case "installDone":
      return { kind: "idle", status: action.status };

    case "installFailed":
      return {
        kind: "error",
        status: action.status,
        message: action.message,
        steps: action.steps,
      };

    case "setEnabledStarted":
      return { kind: "reloading", steps: currentSteps(state) };

    case "setEnabledDone":
      return { kind: "idle", status: action.status };

    case "setEnabledFailed":
      return {
        kind: "error",
        status: action.status,
        message: action.message,
        steps: action.steps,
      };
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseBrowserRuntimeResult {
  state: RuntimeUiState;
  install: (force: boolean) => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useBrowserRuntime(): UseBrowserRuntimeResult {
  const [state, dispatch] = useReducer(reducer, {
    kind: "loading",
  } as RuntimeUiState);

  // Track latest steps via a ref so install/setEnabled callbacks can read the
  // current per-step accumulator without re-creating themselves on every
  // reducer update (which would re-fire the useEffect that triggers refresh).
  const stepsRef = useRef<StepFeed>(emptyFeed());
  if (state.kind === "installing" || state.kind === "reloading") {
    stepsRef.current = state.steps;
  } else if (state.kind === "error") {
    stepsRef.current = state.steps;
  }

  const refresh = useCallback(async () => {
    if (!isTauriApp()) {
      // Web shell — no Tauri commands available. Surface as an idle state
      // with an unavailable status so the UI can render a graceful fallback.
      dispatch({
        type: "loadFailed",
        message: "browser_runtime_unavailable_in_web",
      });
      return;
    }
    try {
      const status = await invoke<BrowserStatus>("browser_status");
      dispatch({ type: "loaded", status });
    } catch (err) {
      dispatch({
        type: "loadFailed",
        message: typeof err === "string" ? err : String(err),
      });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const install = useCallback(async (force: boolean) => {
    if (!isTauriApp()) return;
    dispatch({ type: "installStarted" });
    stepsRef.current = emptyFeed();

    const channel = new Channel<BrowserProgressEvent>();
    channel.onmessage = (event) => dispatch({ type: "progress", event });

    try {
      const status = await invoke<BrowserStatus>("browser_install", {
        force,
        onProgress: channel,
      });
      dispatch({ type: "installDone", status });
    } catch (err) {
      const message = typeof err === "string" ? err : String(err);
      // Best-effort: re-fetch status so the UI shows whatever made it to
      // disk before the failure (e.g. partial install).
      let status: BrowserStatus | null = null;
      try {
        status = await invoke<BrowserStatus>("browser_status");
      } catch {
        status = null;
      }
      dispatch({
        type: "installFailed",
        message,
        status,
        steps: stepsRef.current,
      });
    }
  }, []);

  const setEnabled = useCallback(async (enabled: boolean) => {
    if (!isTauriApp()) return;
    dispatch({ type: "setEnabledStarted" });

    const channel = new Channel<BrowserProgressEvent>();
    channel.onmessage = (event) => dispatch({ type: "progress", event });

    try {
      const status = await invoke<BrowserStatus>("browser_set_enabled", {
        enabled,
        onProgress: channel,
      });
      dispatch({ type: "setEnabledDone", status });
    } catch (err) {
      const message = typeof err === "string" ? err : String(err);
      let status: BrowserStatus | null = null;
      try {
        status = await invoke<BrowserStatus>("browser_status");
      } catch {
        status = null;
      }
      dispatch({
        type: "setEnabledFailed",
        message,
        status,
        steps: stepsRef.current,
      });
    }
  }, []);

  return { state, install, setEnabled, refresh };
}
