import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const mockIsTauriApp = vi.hoisted(() => vi.fn<() => boolean>());
vi.mock("@/lib/tauri", () => ({ isTauriApp: mockIsTauriApp }));
const mockList = vi.hoisted(() => vi.fn());
const mockRefreshToken = vi.hoisted(() => vi.fn());
vi.mock("@/services/ahand-api", () => ({
  ahandApi: { list: mockList, refreshToken: mockRefreshToken },
}));
const mockStart = vi.hoisted(() => vi.fn());
const mockStop = vi.hoisted(() => vi.fn());
vi.mock("@/services/ahand-tauri", () => ({
  ahandTauri: { start: mockStart, stop: mockStop },
}));
const mockUseAppStore = vi.hoisted(() => vi.fn());
vi.mock("@/stores/useAppStore", () => ({ useAppStore: mockUseAppStore }));
const mockToastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: { error: mockToastError, success: vi.fn(), info: vi.fn() },
}));

import { useAhandStore } from "@/stores/useAhandStore";
import { useAhandBootstrap } from "../useAhandBootstrap";

describe("useAhandBootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsTauriApp.mockReturnValue(true);
    mockUseAppStore.mockImplementation(
      (sel: (s: { user: { id: string } | null }) => unknown) =>
        sel({ user: { id: "u1" } }),
    );
  });

  it("does nothing in web env", () => {
    mockIsTauriApp.mockReturnValue(false);
    renderHook(() => useAhandBootstrap());
    expect(mockList).not.toHaveBeenCalled();
  });

  it("does nothing when ahand not enabled for user", () => {
    useAhandStore.getState().clearUser("u1");
    renderHook(() => useAhandBootstrap());
    expect(mockList).not.toHaveBeenCalled();
  });

  it("calls refreshToken + start when enabled and device found", async () => {
    useAhandStore.getState().setDeviceIdForUser("u1", "dev-abc", true);
    mockList.mockResolvedValue([{ id: "row-1", hubDeviceId: "dev-abc" }]);
    mockRefreshToken.mockResolvedValue({
      deviceJwt: "jwt-new",
      jwtExpiresAt: "2026-06-01T00:00:00Z",
    });
    mockStart.mockResolvedValue({ device_id: "dev-abc" });
    renderHook(() => useAhandBootstrap());
    await waitFor(() => expect(mockStart).toHaveBeenCalled());
    expect(mockRefreshToken).toHaveBeenCalledWith("row-1");
  });

  it("silently disables when device revoked server-side", async () => {
    useAhandStore.getState().setDeviceIdForUser("u1", "dev-stale", true);
    mockList.mockResolvedValue([]);
    renderHook(() => useAhandBootstrap());
    await waitFor(() =>
      expect(useAhandStore.getState().usersEnabled["u1"]?.enabled).toBe(false),
    );
    expect(mockStart).not.toHaveBeenCalled();
  });

  it("shows toast on resume error", async () => {
    useAhandStore.getState().setDeviceIdForUser("u1", "dev-abc", true);
    mockList.mockRejectedValue(new Error("network fail"));
    renderHook(() => useAhandBootstrap());
    await waitFor(() => expect(mockToastError).toHaveBeenCalled());
  });

  it("stops daemon when userId transitions to null (logout)", async () => {
    mockStop.mockResolvedValue(undefined);
    mockUseAppStore.mockImplementation((sel: (s: { user: null }) => unknown) =>
      sel({ user: null }),
    );
    renderHook(() => useAhandBootstrap());
    await waitFor(() => expect(mockStop).toHaveBeenCalled());
  });

  it("uses stored hubUrl when resuming", async () => {
    useAhandStore
      .getState()
      .setDeviceIdForUser("u1", "dev-abc", true, "wss://hub.example.com");
    mockList.mockResolvedValue([{ id: "row-1", hubDeviceId: "dev-abc" }]);
    mockRefreshToken.mockResolvedValue({
      deviceJwt: "jwt-new",
      jwtExpiresAt: "2026-06-01T00:00:00Z",
    });
    mockStart.mockResolvedValue({ device_id: "dev-abc" });
    renderHook(() => useAhandBootstrap());
    await waitFor(() => expect(mockStart).toHaveBeenCalled());
    expect(mockStart).toHaveBeenCalledWith(
      expect.objectContaining({ hub_url: "wss://hub.example.com" }),
    );
  });
});
