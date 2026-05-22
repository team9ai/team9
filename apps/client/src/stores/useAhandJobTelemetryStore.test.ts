import { describe, expect, it, beforeEach } from "vitest";
import { useAhandJobTelemetryStore } from "./useAhandJobTelemetryStore";

describe("useAhandJobTelemetryStore", () => {
  beforeEach(() => {
    useAhandJobTelemetryStore.getState().clearAll();
  });

  it("accumulates stdout, stderr, progress, and terminal state for a job", () => {
    const store = useAhandJobTelemetryStore.getState();

    store.applyEvent("hub-job-1", "job.stdout", { chunk: "hello\n" }, "1");
    store.applyEvent("hub-job-1", "job.stderr", { chunk: "warn\n" }, "2");
    store.applyEvent(
      "hub-job-1",
      "job.progress",
      { percent: 50, message: "halfway" },
      "3",
    );
    store.applyEvent("hub-job-1", "job.finished", { exitCode: 0 }, "4");

    expect(useAhandJobTelemetryStore.getState().jobs["hub-job-1"]).toEqual(
      expect.objectContaining({
        hubJobId: "hub-job-1",
        stdout: "hello\n",
        stderr: "warn\n",
        progress: { percent: 50, message: "halfway" },
        exitCode: 0,
        status: "finished",
        lastEventId: "4",
      }),
    );
  });

  it("marks a job as needing resync when history is incomplete", () => {
    useAhandJobTelemetryStore
      .getState()
      .applyEvent("hub-job-1", "job.resync", "history_trimmed");

    expect(useAhandJobTelemetryStore.getState().jobs["hub-job-1"]).toEqual(
      expect.objectContaining({
        status: "resync",
        resyncReason: "history_trimmed",
      }),
    );
  });

  it("accepts native aHand output stream progress and terminal payloads", () => {
    const store = useAhandJobTelemetryStore.getState();

    store.applyEvent("hub-job-1", "job.progress", 25, "1");
    store.applyEvent(
      "hub-job-1",
      "job.finished",
      { exit_code: 7, error: "script failed" },
      "2",
    );

    expect(useAhandJobTelemetryStore.getState().jobs["hub-job-1"]).toEqual(
      expect.objectContaining({
        progress: { percent: 25 },
        exitCode: 7,
        errorMessage: "script failed",
        status: "error",
        lastEventId: "2",
      }),
    );
  });
});
