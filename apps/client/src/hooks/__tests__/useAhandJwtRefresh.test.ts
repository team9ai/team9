import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const mockIsTauriApp = vi.hoisted(() => vi.fn<() => boolean>());
vi.mock("@/lib/tauri", () => ({ isTauriApp: mockIsTauriApp }));
const mockLocalStatus = vi.hoisted(() => vi.fn());
vi.mock("../useAhandLocalStatus", () => ({
  useAhandLocalStatus: mockLocalStatus,
}));
const mockList = vi.hoisted(() => vi.fn());
const mockRefresh = vi.hoisted(() => vi.fn());
vi.mock("@/services/ahand-api", () => ({
  ahandApi: { list: mockList, refreshToken: mockRefresh },
}));
const mockStart = vi.hoisted(() => vi.fn());
const mockStop = vi.hoisted(() => vi.fn());
vi.mock("@/services/ahand-tauri", () => ({
  ahandTauri: { start: mockStart, stop: mockStop },
}));
const mockUseAppStore = vi.hoisted(() => vi.fn());
vi.mock("@/stores/useAppStore", () => ({ useAppStore: mockUseAppStore }));
const mockToastError = vi.hoisted(() => vi.fn());
const mockToastInfo = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: { error: mockToastError, success: vi.fn(), info: mockToastInfo },
}));

import { useAhandStore } from "@/stores/useAhandStore";
import { useAhandJwtRefresh } from "../useAhandJwtRefresh";

describe("useAhandJwtRefresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsTauriApp.mockReturnValue(true);
    mockUseAppStore.mockImplementation(
      (sel: (s: { user: { id: string } | null }) => unknown) =>
        sel({ user: { id: "u1" } }),
    );
    mockLocalStatus.mockReturnValue({
      state: "error",
      kind: "auth",
      message: "jwt expired",
    });
    useAhandStore.getState().setDeviceIdForUser("u1", "dev-abc", true);
    mockList.mockResolvedValue([{ id: "row-1", hubDeviceId: "dev-abc" }]);
    mockRefresh.mockResolvedValue({
      deviceJwt: "new-jwt",
      jwtExpiresAt: "2026-06-01T00:00:00Z",
    });
    mockStart.mockResolvedValue({ device_id: "dev-abc" });
  });

  it("refreshes JWT on auth error", async () => {
    renderHook(() => useAhandJwtRefresh());
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledWith("row-1"));
    await waitFor(() => expect(mockStart).toHaveBeenCalled());
  });

  it("does NOT refresh for network errors", async () => {
    mockLocalStatus.mockReturnValue({
      state: "error",
      kind: "network",
      message: "conn lost",
    });
    renderHook(() => useAhandJwtRefresh());
    await new Promise((r) => setTimeout(r, 30));
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("does nothing in web env", () => {
    mockIsTauriApp.mockReturnValue(false);
    renderHook(() => useAhandJwtRefresh());
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("disables + stops when device revoked server-side", async () => {
    mockList.mockResolvedValue([]);
    mockStop.mockResolvedValue(undefined);
    renderHook(() => useAhandJwtRefresh());
    await waitFor(() =>
      expect(useAhandStore.getState().usersEnabled["u1"]?.enabled).toBe(false),
    );
    expect(mockStop).toHaveBeenCalled();
  });

  it("rate-limits multiple rapid auth errors to one refresh per 30s", async () => {
    const { rerender } = renderHook(() => useAhandJwtRefresh());
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
    // Immediate re-render simulating another auth error
    rerender();
    await new Promise((r) => setTimeout(r, 50));
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("does NOT refresh for error.kind=other", async () => {
    mockLocalStatus.mockReturnValue({
      state: "error",
      kind: "other",
      message: "unexpected",
    });
    renderHook(() => useAhandJwtRefresh());
    await new Promise((r) => setTimeout(r, 30));
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("does nothing when ahand not enabled for user", async () => {
    useAhandStore.getState().clearUser("u1");
    renderHook(() => useAhandJwtRefresh());
    await new Promise((r) => setTimeout(r, 30));
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("shows error toast when refreshToken API call fails", async () => {
    mockRefresh.mockRejectedValue(new Error("api down"));
    renderHook(() => useAhandJwtRefresh());
    await waitFor(() => expect(mockToastError).toHaveBeenCalled());
    expect(mockStart).not.toHaveBeenCalled();
  });
});
