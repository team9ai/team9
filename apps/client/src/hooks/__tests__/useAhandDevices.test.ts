import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";

const mockList = vi.hoisted(() => vi.fn());
const mockOn = vi.hoisted(() => vi.fn());
const mockOff = vi.hoisted(() => vi.fn());
vi.mock("@/services/ahand-api", () => ({ ahandApi: { list: mockList } }));
vi.mock("@/services/websocket", () => ({
  default: { on: mockOn, off: mockOff },
}));

// Mock useUser to return a user or null
const mockUseUser = vi.hoisted(() => vi.fn());
vi.mock("@/stores/useAppStore", () => ({ useUser: mockUseUser }));

import { useAhandDevices, AHAND_DEVICES_QUERY_KEY } from "../useAhandDevices";

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    qc,
    wrapper: ({ children }: { children: React.ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children),
  };
}

describe("useAhandDevices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue([]);
    mockUseUser.mockReturnValue({ id: "u1", name: "Alice" });
  });

  it("fetches device list when user is present", async () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useAhandDevices(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockList).toHaveBeenCalled();
  });

  it("does not fetch when user is null", () => {
    mockUseUser.mockReturnValue(null);
    const { wrapper } = makeWrapper();
    renderHook(() => useAhandDevices(), { wrapper });
    expect(mockList).not.toHaveBeenCalled();
  });

  it("registers WS listeners on mount", () => {
    const { wrapper } = makeWrapper();
    renderHook(() => useAhandDevices(), { wrapper });
    expect(mockOn).toHaveBeenCalledWith("device.online", expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith("device.offline", expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith("device.revoked", expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith(
      "device.registered",
      expect.any(Function),
    );
    expect(mockOn).toHaveBeenCalledWith("reconnect", expect.any(Function));
  });

  it("deregisters WS listeners on unmount", () => {
    const { wrapper } = makeWrapper();
    const { unmount } = renderHook(() => useAhandDevices(), { wrapper });
    unmount();
    expect(mockOff).toHaveBeenCalledWith("device.online", expect.any(Function));
    expect(mockOff).toHaveBeenCalledWith(
      "device.offline",
      expect.any(Function),
    );
    expect(mockOff).toHaveBeenCalledWith(
      "device.revoked",
      expect.any(Function),
    );
  });

  it("patches isOnline to true on device.online event", async () => {
    const initialDevices = [
      {
        id: "1",
        hubDeviceId: "hub-1",
        nickname: "My Mac",
        platform: "macos" as const,
        hostname: null,
        status: "active" as const,
        lastSeenAt: null,
        isOnline: false,
        createdAt: "2026-01-01",
      },
    ];
    mockList.mockResolvedValue(initialDevices);
    const { wrapper, qc } = makeWrapper();
    renderHook(() => useAhandDevices(), { wrapper });
    await waitFor(() => expect(mockOn).toHaveBeenCalled());

    // Find the device.online handler
    const onlineCall = vi
      .mocked(mockOn)
      .mock.calls.find(([evt]) => evt === "device.online");
    const onOnline = onlineCall?.[1] as (evt: { hubDeviceId: string }) => void;

    act(() => {
      onOnline({ hubDeviceId: "hub-1" });
    });

    const cached = qc.getQueryData<typeof initialDevices>([
      ...AHAND_DEVICES_QUERY_KEY,
      true,
    ]);
    expect(cached?.[0].isOnline).toBe(true);
  });

  it("filters out revoked device on device.revoked event", async () => {
    const initialDevices = [
      {
        id: "1",
        hubDeviceId: "hub-1",
        nickname: "My Mac",
        platform: "macos" as const,
        hostname: null,
        status: "active" as const,
        lastSeenAt: null,
        isOnline: true,
        createdAt: "2026-01-01",
      },
    ];
    mockList.mockResolvedValue(initialDevices);
    const { wrapper, qc } = makeWrapper();
    renderHook(() => useAhandDevices(), { wrapper });
    await waitFor(() => expect(mockOn).toHaveBeenCalled());

    const revokedCall = vi
      .mocked(mockOn)
      .mock.calls.find(([evt]) => evt === "device.revoked");
    const onRevoked = revokedCall?.[1] as (evt: {
      hubDeviceId: string;
    }) => void;

    act(() => {
      onRevoked({ hubDeviceId: "hub-1" });
    });

    const cached = qc.getQueryData<typeof initialDevices>([
      ...AHAND_DEVICES_QUERY_KEY,
      true,
    ]);
    expect(cached).toHaveLength(0);
  });
});
