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
  const next: TaskStreamState = { ...state, lastSeq: ev.seq };
  switch (ev.event) {
    case "interaction.start": {
      try {
        const d = JSON.parse(ev.data) as { interaction_id?: string };
        next.startMeta = { interactionId: d.interaction_id };
      } catch {
        // Ignore malformed start payload; still mark as running.
      }
      next.status = "running";
      return next;
    }
    case "content.delta": {
      let parsed: { type?: string; text?: string } = {};
      try {
        parsed = JSON.parse(ev.data) as { type?: string; text?: string };
      } catch {
        // Treat malformed content.delta as unknown to aid debugging.
      }
      if (parsed.type === "thought_summary" && parsed.text) {
        // Append thought and enforce cap; excess is counted in truncatedThoughts.
        const appended = [
          ...state.thoughts,
          { seq: ev.seq, text: parsed.text },
        ];
        if (appended.length > THOUGHT_CAP) {
          const drop = appended.length - THOUGHT_CAP;
          next.thoughts = appended.slice(drop);
          next.truncatedThoughts = state.truncatedThoughts + drop;
        } else {
          next.thoughts = appended;
        }
        return next;
      }
      if (parsed.type === "text" && parsed.text) {
        // Merge incremental text deltas into a single accumulated markdown string.
        next.markdownAccum = state.markdownAccum + parsed.text;
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
