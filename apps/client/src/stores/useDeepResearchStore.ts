import { create } from "zustand";
import { devtools } from "zustand/middleware";

export interface ThoughtSummary {
  seq: string;
  text: string;
}

export interface TaskStreamState {
  status: "idle" | "running" | "completed" | "failed";
  startMeta?: { interactionId?: string };
  thoughts: ThoughtSummary[];
  truncatedThoughts: number;
  markdownAccum: string;
  reportUrl?: string | null;
  error?: { code: string; message: string; details?: unknown };
  lastSeq: string | null;
  // Wall-clock ms of the most recent upstream heartbeat (status_update or
  // content event). UI uses this to reassure the user that work is active
  // during the several-minute silent planning phase of Deep Research.
  lastHeartbeatAt?: number;
  unknownCount: number;
  unknownSamples: { event: string; data: string }[];
}

export interface RawEvent {
  seq: string;
  event?: string;
  data: string;
}

interface State {
  byTaskId: Record<string, TaskStreamState>;
  ingest: (taskId: string, ev: RawEvent) => void;
  getLastSeq: (taskId: string) => string | null;
  reset: (taskId?: string) => void;
}

// Maximum number of thought_summary entries to keep in memory per task.
const THOUGHT_CAP = 200;
// Maximum number of unknown event samples to retain for debugging.
const UNKNOWN_SAMPLE_CAP = 10;

function emptyState(): TaskStreamState {
  return {
    status: "idle",
    thoughts: [],
    truncatedThoughts: 0,
    markdownAccum: "",
    lastSeq: null,
    unknownCount: 0,
    unknownSamples: [],
  };
}

/**
 * Pure reducer: applies a single raw SSE event to a task's stream state.
 * Returns a new state object (no mutation).
 */
function applyEvent(state: TaskStreamState, ev: RawEvent): TaskStreamState {
  const next: TaskStreamState = {
    ...state,
    lastSeq: ev.seq,
    lastHeartbeatAt: Date.now(),
  };
  switch (ev.event) {
    case "interaction.start": {
      try {
        // Google's SSE nests the id under `interaction.id`; tolerate the
        // legacy flat shape too for forwards compatibility.
        const d = JSON.parse(ev.data) as {
          interaction?: { id?: string };
          interaction_id?: string;
        };
        next.startMeta = {
          interactionId: d.interaction?.id ?? d.interaction_id,
        };
      } catch {
        // Ignore malformed start payload; still mark as running.
      }
      next.status = "running";
      return next;
    }
    case "interaction.status_update": {
      // Heartbeat ping — timestamp already bumped above. No payload to surface.
      return next;
    }
    case "content.delta": {
      // Google's real payload nests differently than the legacy flat shape:
      //   { index, delta: { content: { text }, type: "text" }, type: "thought_summary" | "text" }
      // The OUTER `type` distinguishes a thinking step vs final report content;
      // the actual text always lives at `delta.content.text` (preferred) or
      // `delta.text` for older shapes.
      let parsed: {
        type?: string;
        text?: string;
        delta?: { text?: string; content?: { text?: string }; type?: string };
      } = {};
      try {
        parsed = JSON.parse(ev.data) as typeof parsed;
      } catch {
        // Treat malformed content.delta as unknown to aid debugging.
      }
      const text =
        parsed.delta?.content?.text ?? parsed.delta?.text ?? parsed.text;
      if (parsed.type === "thought_summary" && text) {
        const appended = [...state.thoughts, { seq: ev.seq, text }];
        if (appended.length > THOUGHT_CAP) {
          const drop = appended.length - THOUGHT_CAP;
          next.thoughts = appended.slice(drop);
          next.truncatedThoughts = state.truncatedThoughts + drop;
        } else {
          next.thoughts = appended;
        }
        return next;
      }
      if (parsed.type === "text" && text) {
        next.markdownAccum = state.markdownAccum + text;
        return next;
      }
      // content.delta with unrecognized shape: record as unknown for debug.
      next.unknownCount = state.unknownCount + 1;
      if (state.unknownSamples.length < UNKNOWN_SAMPLE_CAP) {
        next.unknownSamples = [
          ...state.unknownSamples,
          { event: "content.delta", data: ev.data },
        ];
      }
      return next;
    }
    case "content.start": {
      // Marks the start of a content block. Heartbeat already updated above.
      return next;
    }
    case "interaction.complete": {
      let d: { reportUrl?: string | null } = {};
      try {
        d = JSON.parse(ev.data) as { reportUrl?: string | null };
      } catch {
        // Malformed complete payload: still transition to completed state.
      }
      next.status = "completed";
      next.reportUrl = d.reportUrl ?? null;
      return next;
    }
    case "error": {
      try {
        const d = JSON.parse(ev.data) as {
          code?: string;
          message?: string;
          details?: unknown;
        };
        next.error = {
          code: d.code ?? "UNKNOWN",
          message: d.message ?? "",
          details: d.details,
        };
      } catch {
        next.error = { code: "UNKNOWN", message: ev.data };
      }
      next.status = "failed";
      return next;
    }
    default: {
      // Unrecognized event type: count and sample for observability.
      next.unknownCount = state.unknownCount + 1;
      if (state.unknownSamples.length < UNKNOWN_SAMPLE_CAP) {
        next.unknownSamples = [
          ...state.unknownSamples,
          { event: ev.event ?? "(none)", data: ev.data },
        ];
      }
      return next;
    }
  }
}

export const useDeepResearchStore = create<State>()(
  devtools(
    (set, get) => ({
      byTaskId: {},
      ingest: (taskId, ev) => {
        const cur = get().byTaskId[taskId] ?? emptyState();
        set(
          { byTaskId: { ...get().byTaskId, [taskId]: applyEvent(cur, ev) } },
          false,
          "ingest",
        );
      },
      getLastSeq: (taskId) => get().byTaskId[taskId]?.lastSeq ?? null,
      reset: (taskId) => {
        if (!taskId) {
          set({ byTaskId: {} }, false, "reset-all");
        } else {
          const copy = { ...get().byTaskId };
          delete copy[taskId];
          set({ byTaskId: copy }, false, "reset");
        }
      },
    }),
    { name: "DeepResearchStore" },
  ),
);
