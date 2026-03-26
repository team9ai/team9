import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

// vi.hoisted ensures the mock object is available when vi.mock factory runs
const mockWsService = vi.hoisted(() => ({
  observeChannel: vi.fn(),
  unobserveChannel: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
}));

vi.mock("@/services/websocket", () => ({
  default: mockWsService,
}));

import { useChannelObserver } from "../useChannelObserver";

describe("useChannelObserver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should call observeChannel on mount with a channelId", () => {
    renderHook(() => useChannelObserver("ch-1"));

    expect(mockWsService.observeChannel).toHaveBeenCalledWith("ch-1");
    expect(mockWsService.on).toHaveBeenCalledWith(
      "connect",
      expect.any(Function),
    );
  });

  it("should not call observeChannel when channelId is null", () => {
    renderHook(() => useChannelObserver(null));

    expect(mockWsService.observeChannel).not.toHaveBeenCalled();
  });

  it("should unobserve on unmount", () => {
    const { unmount } = renderHook(() => useChannelObserver("ch-1"));

    unmount();

    expect(mockWsService.unobserveChannel).toHaveBeenCalledWith("ch-1");
    expect(mockWsService.off).toHaveBeenCalledWith(
      "connect",
      expect.any(Function),
    );
  });

  it("should switch channels when channelId changes", () => {
    const { rerender } = renderHook(
      ({ id }: { id: string | null }) => useChannelObserver(id),
      { initialProps: { id: "ch-1" } },
    );

    rerender({ id: "ch-2" });

    expect(mockWsService.unobserveChannel).toHaveBeenCalledWith("ch-1");
    expect(mockWsService.observeChannel).toHaveBeenCalledWith("ch-2");
  });

  it("should re-subscribe on reconnect", () => {
    renderHook(() => useChannelObserver("ch-1"));

    // Get the reconnect handler
    const reconnectHandler = mockWsService.on.mock.calls.find(
      (call: unknown[]) => call[0] === "connect",
    )?.[1] as (() => void) | undefined;
    expect(reconnectHandler).toBeDefined();

    // Clear mocks and simulate reconnect
    mockWsService.observeChannel.mockClear();
    reconnectHandler!();

    expect(mockWsService.observeChannel).toHaveBeenCalledWith("ch-1");
  });

  it("should unobserve when channelId changes to null", () => {
    const { rerender } = renderHook(
      ({ id }: { id: string | null }) => useChannelObserver(id),
      { initialProps: { id: "ch-1" as string | null } },
    );

    rerender({ id: null });

    expect(mockWsService.unobserveChannel).toHaveBeenCalledWith("ch-1");
  });
});
