import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Hoisted mocks ---
const mockNavigate = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

import { useServiceWorkerMessages } from "../useServiceWorkerMessages";

describe("useServiceWorkerMessages", () => {
  let addEventListenerSpy: ReturnType<typeof vi.fn>;
  let removeEventListenerSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    addEventListenerSpy = vi.fn();
    removeEventListenerSpy = vi.fn();

    // Set up a mock serviceWorker on navigator
    Object.defineProperty(navigator, "serviceWorker", {
      value: {
        addEventListener: addEventListenerSpy,
        removeEventListener: removeEventListenerSpy,
      },
      configurable: true,
      writable: true,
    });
  });

  it("registers message event listener on mount", () => {
    renderHook(() => useServiceWorkerMessages());

    expect(addEventListenerSpy).toHaveBeenCalledTimes(1);
    expect(addEventListenerSpy).toHaveBeenCalledWith(
      "message",
      expect.any(Function),
    );
  });

  it("navigates when NOTIFICATION_CLICK message is received", () => {
    renderHook(() => useServiceWorkerMessages());

    const handler = addEventListenerSpy.mock.calls[0][1] as (
      event: MessageEvent,
    ) => void;

    handler({
      data: { type: "NOTIFICATION_CLICK", actionUrl: "/channels/abc-123" },
    } as MessageEvent);

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/channels/abc-123",
    });
  });

  it("does NOT navigate for other message types", () => {
    renderHook(() => useServiceWorkerMessages());

    const handler = addEventListenerSpy.mock.calls[0][1] as (
      event: MessageEvent,
    ) => void;

    handler({
      data: { type: "HEARTBEAT", channelId: "ch-1" },
    } as MessageEvent);

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("does NOT navigate when NOTIFICATION_CLICK lacks actionUrl", () => {
    renderHook(() => useServiceWorkerMessages());

    const handler = addEventListenerSpy.mock.calls[0][1] as (
      event: MessageEvent,
    ) => void;

    handler({
      data: { type: "NOTIFICATION_CLICK" },
    } as MessageEvent);

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("does NOT navigate when event.data is null", () => {
    renderHook(() => useServiceWorkerMessages());

    const handler = addEventListenerSpy.mock.calls[0][1] as (
      event: MessageEvent,
    ) => void;

    handler({ data: null } as MessageEvent);

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("cleans up listener on unmount", () => {
    const { unmount } = renderHook(() => useServiceWorkerMessages());

    const registeredHandler = addEventListenerSpy.mock.calls[0][1];

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledTimes(1);
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "message",
      registeredHandler,
    );
  });

  it("does nothing when serviceWorker is not in navigator", () => {
    // Save the original descriptor so we can restore it
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      navigator,
      "serviceWorker",
    );

    // Delete serviceWorker so that `"serviceWorker" in navigator` returns false

    delete (navigator as any).serviceWorker;

    // Reset spy call counts since we deleted the mock
    addEventListenerSpy.mockClear();
    removeEventListenerSpy.mockClear();

    // Should not throw
    const { unmount } = renderHook(() => useServiceWorkerMessages());

    expect(addEventListenerSpy).not.toHaveBeenCalled();

    // Cleanup should also not throw
    unmount();
    expect(removeEventListenerSpy).not.toHaveBeenCalled();

    // Restore for other tests
    if (originalDescriptor) {
      Object.defineProperty(navigator, "serviceWorker", originalDescriptor);
    }
  });
});
