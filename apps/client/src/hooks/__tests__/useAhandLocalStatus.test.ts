import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const mockIsTauriApp = vi.hoisted(() => vi.fn<() => boolean>());
const mockStatus = vi.hoisted(() => vi.fn());
const mockListen = vi.hoisted(() => vi.fn());

vi.mock("@/lib/tauri", () => ({ isTauriApp: mockIsTauriApp }));
vi.mock("@/services/ahand-tauri", () => ({
  ahandTauri: { status: mockStatus },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: mockListen }));

import { useAhandLocalStatus } from "../useAhandLocalStatus";

describe("useAhandLocalStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListen.mockResolvedValue(() => {});
    mockStatus.mockResolvedValue({ state: "idle" });
  });

  it("returns { state: 'web' } in non-Tauri env", () => {
    mockIsTauriApp.mockReturnValue(false);
    const { result } = renderHook(() => useAhandLocalStatus());
    expect(result.current).toEqual({ state: "web" });
    expect(mockStatus).not.toHaveBeenCalled();
    expect(mockListen).not.toHaveBeenCalled();
  });

  it("starts with idle in Tauri env and transitions via initial status fetch", async () => {
    mockIsTauriApp.mockReturnValue(true);
    mockStatus.mockResolvedValue({ state: "connecting" });
    const { result } = renderHook(() => useAhandLocalStatus());
    // Initial state is idle while fetch is in flight
    expect(result.current).toEqual({ state: "idle" });
    await waitFor(() =>
      expect(result.current).toEqual({ state: "connecting" }),
    );
  });

  it("subscribes to ahand-daemon-status event in Tauri env", async () => {
    mockIsTauriApp.mockReturnValue(true);
    let handler: ((ev: { payload: unknown }) => void) | null = null;
    mockListen.mockImplementation(async (_name: string, h: unknown) => {
      handler = h as (ev: { payload: unknown }) => void;
      return () => {};
    });
    const { result } = renderHook(() => useAhandLocalStatus());
    await waitFor(() => expect(handler).not.toBeNull());
    act(() => {
      handler!({ payload: { state: "online", device_id: "dev-abc" } });
    });
    expect(result.current).toEqual({ state: "online", device_id: "dev-abc" });
  });

  it("calls the unlistener on unmount", async () => {
    mockIsTauriApp.mockReturnValue(true);
    const unlistener = vi.fn();
    mockListen.mockResolvedValue(unlistener);
    const { unmount } = renderHook(() => useAhandLocalStatus());
    await waitFor(() => expect(mockListen).toHaveBeenCalled());
    unmount();
    expect(unlistener).toHaveBeenCalled();
  });

  it("silently ignores status() errors in Tauri env", async () => {
    mockIsTauriApp.mockReturnValue(true);
    mockStatus.mockRejectedValue(new Error("invoke failed"));
    // Should not throw
    const { result } = renderHook(() => useAhandLocalStatus());
    await waitFor(() => expect(result.current).toEqual({ state: "idle" }));
  });
});
