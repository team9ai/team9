import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateWeixinQrImageSrc = vi.hoisted(() => vi.fn());
const mockGetWeixinLoginStatus = vi.hoisted(() => vi.fn());
const mockListWeixinConnections = vi.hoisted(() => vi.fn());
const mockStartWeixinLogin = vi.hoisted(() => vi.fn());

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock("@/services/api/external-im-gateway", () => ({
  createWeixinQrImageSrc: mockCreateWeixinQrImageSrc,
  externalImGatewayApi: {
    getWeixinIlinkLoginStatus: mockGetWeixinLoginStatus,
    listWeixinIlinkConnections: mockListWeixinConnections,
    startWeixinIlinkLogin: mockStartWeixinLogin,
  },
}));

import { useWeixinIlinkConnection } from "../useWeixinIlinkConnection";

const session = {
  sessionKey: "session-1",
  qrcode: "qr",
  qrcodeUrl: "qr-url",
  status: "wait" as const,
  expiresAt: "2026-05-25T00:05:00.000Z",
};

const connection = {
  id: "conn-1",
  provider: "weixin-ilink" as const,
  externalTenantId: "wx-user-1",
  baseUrl: "https://ilinkai.weixin.qq.com",
  team9UserId: "team9-user-1",
  team9TenantId: "tenant-1",
  status: "active" as const,
  createdAt: "2026-05-25T00:00:00.000Z",
  updatedAt: "2026-05-25T00:00:00.000Z",
  polling: true,
};

function renderConnectionHook() {
  return renderHook(() =>
    useWeixinIlinkConnection({
      enabled: true,
      team9TenantId: "tenant-1",
      team9UserId: "team9-user-1",
    }),
  );
}

async function startLogin(
  result: ReturnType<typeof renderConnectionHook>["result"],
) {
  await act(async () => {
    await result.current.startLogin();
  });
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useWeixinIlinkConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateWeixinQrImageSrc.mockResolvedValue("data:image/png;base64,qr");
    mockListWeixinConnections.mockResolvedValue([]);
    mockStartWeixinLogin.mockResolvedValue(session);
    mockGetWeixinLoginStatus.mockResolvedValue({
      status: "wait",
      connected: false,
    });
  });

  afterEach(() => {
    if (vi.isFakeTimers()) vi.useRealTimers();
  });

  it("polls from scanned status to a confirmed connection", async () => {
    vi.useFakeTimers();
    let statusResult: {
      status: "scaned" | "confirmed";
      connected: boolean;
      connection?: typeof connection;
    } = { status: "scaned", connected: false };
    mockGetWeixinLoginStatus.mockImplementation(() =>
      Promise.resolve(statusResult),
    );

    const { result } = renderConnectionHook();
    await startLogin(result);
    await flushAsyncWork();

    expect(mockGetWeixinLoginStatus).toHaveBeenCalled();
    expect(result.current.statusLabel).toBe("Scanned, waiting for confirm");

    statusResult = {
      status: "confirmed",
      connected: true,
      connection,
    };
    const callCountBeforeInterval = mockGetWeixinLoginStatus.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    await flushAsyncWork();

    expect(mockGetWeixinLoginStatus.mock.calls.length).toBeGreaterThan(
      callCountBeforeInterval,
    );
    expect(result.current.connection).toEqual(connection);
    expect(result.current.loginSession).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("stops polling and surfaces the gateway message when the QR expires", async () => {
    vi.useFakeTimers();
    mockGetWeixinLoginStatus.mockResolvedValueOnce({
      status: "expired",
      connected: false,
      message: "QR expired",
    });

    const { result } = renderConnectionHook();
    await startLogin(result);
    await flushAsyncWork();

    expect(result.current.error).toBe("QR expired");
    expect(result.current.loginSession).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });

    expect(mockGetWeixinLoginStatus).toHaveBeenCalledTimes(1);
  });

  it("stops polling when a status request fails", async () => {
    vi.useFakeTimers();
    mockGetWeixinLoginStatus.mockRejectedValueOnce(new Error("gateway down"));

    const { result } = renderConnectionHook();
    await startLogin(result);
    await flushAsyncWork();

    expect(result.current.error).toBe("gateway down");
    expect(result.current.loginSession).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });

    expect(mockGetWeixinLoginStatus).toHaveBeenCalledTimes(1);
  });

  it("stops polling when iLink reports connected without returning a connection", async () => {
    vi.useFakeTimers();
    mockGetWeixinLoginStatus.mockResolvedValueOnce({
      status: "confirmed",
      connected: true,
    });

    const { result } = renderConnectionHook();
    await startLogin(result);
    await flushAsyncWork();

    expect(result.current.error).toBe(
      "We could not start Weixin login right now.",
    );
    expect(result.current.loginSession).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });

    expect(mockGetWeixinLoginStatus).toHaveBeenCalledTimes(1);
  });

  it("clears the polling interval on unmount", async () => {
    vi.useFakeTimers();
    const { result, unmount } = renderConnectionHook();
    await startLogin(result);
    await flushAsyncWork();

    expect(mockGetWeixinLoginStatus).toHaveBeenCalled();
    const callCountBeforeUnmount = mockGetWeixinLoginStatus.mock.calls.length;
    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });

    expect(mockGetWeixinLoginStatus).toHaveBeenCalledTimes(
      callCountBeforeUnmount,
    );
  });
});
