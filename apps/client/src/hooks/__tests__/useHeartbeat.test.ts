import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockIsTauriApp = vi.hoisted(() => vi.fn());
const mockSendHeartbeat = vi.hoisted(() => vi.fn());

vi.mock("@/lib/tauri", () => ({
  isTauriApp: mockIsTauriApp,
}));

vi.mock("@/lib/push-notifications", () => ({
  sendHeartbeat: mockSendHeartbeat,
}));

import { useHeartbeat } from "../useHeartbeat";

describe("useHeartbeat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockIsTauriApp.mockReturnValue(false);

    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });

    Object.defineProperty(window, "location", {
      value: { pathname: "/" },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not set interval when running in Tauri app", () => {
    mockIsTauriApp.mockReturnValue(true);

    renderHook(() => useHeartbeat());

    vi.advanceTimersByTime(10_000);

    expect(mockSendHeartbeat).not.toHaveBeenCalled();
  });

  it("sets up interval that sends heartbeat every 5 seconds", () => {
    renderHook(() => useHeartbeat());

    expect(mockSendHeartbeat).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5000);

    expect(mockSendHeartbeat).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5000);

    expect(mockSendHeartbeat).toHaveBeenCalledTimes(2);
  });

  it("extracts channelId from /channels/:id URL", () => {
    Object.defineProperty(window, "location", {
      value: { pathname: "/channels/ch-abc-123" },
      configurable: true,
      writable: true,
    });

    renderHook(() => useHeartbeat());

    vi.advanceTimersByTime(5000);

    expect(mockSendHeartbeat).toHaveBeenCalledWith("ch-abc-123");
  });

  it("extracts channelId from /messages/:id URL", () => {
    Object.defineProperty(window, "location", {
      value: { pathname: "/messages/msg-channel-456" },
      configurable: true,
      writable: true,
    });

    renderHook(() => useHeartbeat());

    vi.advanceTimersByTime(5000);

    expect(mockSendHeartbeat).toHaveBeenCalledWith("msg-channel-456");
  });

  it("extracts channelId from /activity/channel/:id URL", () => {
    Object.defineProperty(window, "location", {
      value: { pathname: "/activity/channel/act-ch-789" },
      configurable: true,
      writable: true,
    });

    renderHook(() => useHeartbeat());

    vi.advanceTimersByTime(5000);

    expect(mockSendHeartbeat).toHaveBeenCalledWith("act-ch-789");
  });

  it("sends null channelId when not on a channel page", () => {
    Object.defineProperty(window, "location", {
      value: { pathname: "/settings/profile" },
      configurable: true,
      writable: true,
    });

    renderHook(() => useHeartbeat());

    vi.advanceTimersByTime(5000);

    expect(mockSendHeartbeat).toHaveBeenCalledWith(null);
  });

  it("does not send heartbeat when document is hidden", () => {
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });

    renderHook(() => useHeartbeat());

    vi.advanceTimersByTime(5000);

    expect(mockSendHeartbeat).not.toHaveBeenCalled();
  });

  it("clears interval on unmount", () => {
    const { unmount } = renderHook(() => useHeartbeat());

    vi.advanceTimersByTime(5000);

    expect(mockSendHeartbeat).toHaveBeenCalledTimes(1);

    unmount();

    vi.advanceTimersByTime(10_000);

    // Should still be 1, no new calls after unmount
    expect(mockSendHeartbeat).toHaveBeenCalledTimes(1);
  });

  it("reads current URL each tick (not cached from mount time)", () => {
    renderHook(() => useHeartbeat());

    // First tick: on root
    Object.defineProperty(window, "location", {
      value: { pathname: "/" },
      configurable: true,
      writable: true,
    });
    vi.advanceTimersByTime(5000);

    expect(mockSendHeartbeat).toHaveBeenLastCalledWith(null);

    // Second tick: navigate to a channel
    Object.defineProperty(window, "location", {
      value: { pathname: "/channels/ch-new" },
      configurable: true,
      writable: true,
    });
    vi.advanceTimersByTime(5000);

    expect(mockSendHeartbeat).toHaveBeenLastCalledWith("ch-new");
  });
});
