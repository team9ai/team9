import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAhandJobTelemetryStore } from "@/stores/useAhandJobTelemetryStore";
import { useAhandJobStream } from "../useAhandJobStream";

const auth = vi.hoisted(() => ({
  getValidAccessToken: vi.fn(),
  redirectToLogin: vi.fn(),
}));

const eventSources = vi.hoisted(() => [] as MockEventSource[]);

class MockEventSource {
  onerror: (() => void) | null = null;
  closed = false;
  private readonly listeners = new Map<
    string,
    Array<(event: MessageEvent<string>) => void>
  >();

  constructor(public readonly url: string) {
    eventSources.push(this);
  }

  addEventListener(
    type: string,
    listener: (event: MessageEvent<string>) => void,
  ) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type: string, data: string, lastEventId?: string) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data, lastEventId } as MessageEvent<string>);
    }
  }

  close() {
    this.closed = true;
  }
}

vi.stubGlobal("EventSource", MockEventSource);
vi.mock("@/services/auth-session", () => auth);
vi.mock("@/constants/api-base-url", () => ({
  API_BASE_URL: "http://localhost:3000",
}));

describe("useAhandJobStream", () => {
  beforeEach(() => {
    eventSources.length = 0;
    vi.clearAllMocks();
    auth.getValidAccessToken.mockResolvedValue("token-1");
    useAhandJobTelemetryStore.getState().clearAll();
  });

  it("opens the Team9 proxy stream and stores named job events", async () => {
    const { unmount } = renderHook(() =>
      useAhandJobStream("hub-job-1", "hub-device-1", true),
    );

    await waitFor(() => expect(eventSources).toHaveLength(1));
    expect(eventSources[0].url).toBe(
      "http://localhost:3000/v1/ahand/jobs/hub-job-1/stream?deviceId=hub-device-1&token=token-1",
    );

    act(() => {
      eventSources[0].dispatch(
        "job.stdout",
        JSON.stringify({ chunk: "hello\n" }),
        "1",
      );
    });

    expect(useAhandJobTelemetryStore.getState().jobs["hub-job-1"]?.stdout).toBe(
      "hello\n",
    );

    unmount();
    expect(eventSources[0].closed).toBe(true);
  });

  it("includes the stored lastEventId when opening a new stream", async () => {
    useAhandJobTelemetryStore
      .getState()
      .applyEvent("hub-job-1", "job.stdout", { chunk: "old\n" }, "7");

    renderHook(() => useAhandJobStream("hub-job-1", "hub-device-1", true));

    await waitFor(() => expect(eventSources).toHaveLength(1));
    expect(eventSources[0].url).toBe(
      "http://localhost:3000/v1/ahand/jobs/hub-job-1/stream?deviceId=hub-device-1&token=token-1&lastEventId=7",
    );
  });
});
