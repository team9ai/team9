import { beforeEach, describe, expect, it, vi } from "vitest";

type MockSocket = {
  connected: boolean;
  disconnect: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  removeAllListeners: ReturnType<typeof vi.fn>;
  trigger: (event: string, ...args: unknown[]) => void;
};

const { ioMock, sockets, sentryMock, queryClientMock } = vi.hoisted(() => {
  const sockets: MockSocket[] = [];

  const ioMock = vi.fn(() => {
    const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
    const socket: MockSocket = {
      connected: false,
      disconnect: vi.fn(),
      off: vi.fn(),
      on: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
        const current = handlers.get(event) ?? [];
        current.push(callback);
        handlers.set(event, current);
      }),
      removeAllListeners: vi.fn(() => {
        handlers.clear();
      }),
      trigger: (event: string, ...args: unknown[]) => {
        for (const callback of handlers.get(event) ?? []) {
          callback(...args);
        }
      },
    };

    sockets.push(socket);
    return socket;
  });

  return {
    ioMock,
    queryClientMock: {
      invalidateQueries: vi.fn(),
    },
    sentryMock: {
      addBreadcrumb: vi.fn(),
      captureException: vi.fn(),
    },
    sockets,
  };
});

vi.mock("socket.io-client", () => ({
  io: ioMock,
}));

vi.mock("@/services/auth-session", () => ({
  getAuthToken: vi.fn(() => "test-token"),
  getValidAccessToken: vi.fn(async () => "test-token"),
  hasStoredAuthSession: vi.fn(() => true),
  redirectToLogin: vi.fn(),
  refreshAccessToken: vi.fn(async () => "test-token"),
}));

vi.mock("@sentry/react", () => sentryMock);

vi.mock("@/lib/query-client", () => ({
  queryClient: queryClientMock,
}));

describe("WebSocketService transport fallback", () => {
  beforeEach(() => {
    vi.resetModules();
    ioMock.mockClear();
    sentryMock.addBreadcrumb.mockClear();
    sentryMock.captureException.mockClear();
    queryClientMock.invalidateQueries.mockClear();
    sockets.length = 0;
    localStorage.clear();
  });

  it("retries with polling-first after an initial websocket connect_error", async () => {
    await import("../index");

    expect(ioMock).toHaveBeenCalledTimes(1);
    expect(ioMock.mock.calls[0]?.[1]).toMatchObject({
      transports: ["websocket", "polling"],
    });

    sockets[0]?.trigger(
      "connect_error",
      new Error("WebSocket is closed before the connection is established."),
    );

    await vi.waitFor(() => {
      expect(ioMock).toHaveBeenCalledTimes(2);
    });
    expect(ioMock.mock.calls[1]?.[1]).toMatchObject({
      transports: ["polling", "websocket"],
    });
  });
});
