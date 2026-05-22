import { create } from "zustand";

export type AhandJobTelemetryStatus =
  | "running"
  | "finished"
  | "error"
  | "resync";

export interface AhandJobProgress {
  percent?: number;
  phase?: string;
  message?: string;
}

export interface AhandJobTelemetry {
  hubJobId: string;
  stdout: string;
  stderr: string;
  status: AhandJobTelemetryStatus;
  progress?: AhandJobProgress;
  exitCode?: number;
  errorMessage?: string;
  resyncReason?: string;
  lastEventId?: string;
  updatedAt: number;
}

interface AhandJobTelemetryState {
  jobs: Record<string, AhandJobTelemetry>;
  applyEvent: (
    hubJobId: string,
    eventName: string,
    data: unknown,
    lastEventId?: string,
  ) => void;
  clearJob: (hubJobId: string) => void;
  clearAll: () => void;
}

export const useAhandJobTelemetryStore = create<AhandJobTelemetryState>(
  (set) => ({
    jobs: {},

    applyEvent: (hubJobId, eventName, data, lastEventId) => {
      set((state) => {
        const current = state.jobs[hubJobId] ?? createEmptyJob(hubJobId);
        const next: AhandJobTelemetry = {
          ...current,
          status: current.status === "finished" ? "finished" : "running",
          updatedAt: Date.now(),
          ...(lastEventId ? { lastEventId } : {}),
        };

        switch (normalizeEventName(eventName)) {
          case "stdout":
            next.stdout += textFromData(data);
            break;
          case "stderr":
            next.stderr += textFromData(data);
            break;
          case "progress":
            next.progress = progressFromData(data);
            break;
          case "finished":
            next.status = "finished";
            next.exitCode = numberFromField(data, "exitCode");
            break;
          case "error":
            next.status = "error";
            next.errorMessage = messageFromData(data);
            break;
          case "resync":
            next.status = "resync";
            next.resyncReason = reasonFromData(data);
            break;
        }

        return { jobs: { ...state.jobs, [hubJobId]: next } };
      });
    },

    clearJob: (hubJobId) => {
      set((state) => {
        const { [hubJobId]: _removed, ...jobs } = state.jobs;
        return { jobs };
      });
    },

    clearAll: () => set({ jobs: {} }),
  }),
);

function createEmptyJob(hubJobId: string): AhandJobTelemetry {
  return {
    hubJobId,
    stdout: "",
    stderr: "",
    status: "running",
    updatedAt: Date.now(),
  };
}

function normalizeEventName(eventName: string): string {
  return eventName.startsWith("job.")
    ? eventName.slice("job.".length)
    : eventName;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function textFromData(data: unknown): string {
  if (typeof data === "string") return data;
  if (!isRecord(data)) return "";
  const value = data.chunk ?? data.text ?? data.data;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function numberFromField(data: unknown, field: string): number | undefined {
  if (!isRecord(data)) return undefined;
  const value = data[field];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function stringFromField(data: unknown, field: string): string | undefined {
  if (!isRecord(data)) return undefined;
  const value = data[field];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function progressFromData(data: unknown): AhandJobProgress {
  return {
    ...(numberFromField(data, "percent") !== undefined
      ? { percent: numberFromField(data, "percent") }
      : {}),
    ...(stringFromField(data, "phase")
      ? { phase: stringFromField(data, "phase") }
      : {}),
    ...(stringFromField(data, "message")
      ? { message: stringFromField(data, "message") }
      : {}),
  };
}

function messageFromData(data: unknown): string | undefined {
  return stringFromField(data, "message") ?? stringFromField(data, "error");
}

function reasonFromData(data: unknown): string | undefined {
  return stringFromField(data, "reason") ?? messageFromData(data);
}
