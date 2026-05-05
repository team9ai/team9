import { beforeEach, describe, expect, it, vi } from "vitest";

type MockSocket = {
  connected: boolean;
  disconnect: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  removeAllListeners: ReturnType<typeof vi.fn>;
  trigger: (event: string, ...args: unknown[]) => void;
};

const { ioMock, sockets, sentryMock, queryClientMock, appStoreMock } =
  vi.hoisted(() => {
    const sockets: MockSocket[] = [];

    // Typed as `(...args: unknown[]) => MockSocket` so `mock.calls[i][1]`
    // (the options arg the production code passes) is reachable.
    const ioMock = vi.fn((..._args: unknown[]): MockSocket => {
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

    const incrementPendingPermissions = vi.fn();
    const decrementPendingPermissions = vi.fn();

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
      appStoreMock: {
        getState: vi.fn(() => ({
          incrementPendingPermissions,
          decrementPendingPermissions,
        })),
        incrementPendingPermissions,
        decrementPendingPermissions,
      },
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

vi.mock("@/stores/useAppStore", () => ({
  useAppStore: appStoreMock,
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

describe("WebSocketService routine/user updated helpers", () => {
  beforeEach(() => {
    vi.resetModules();
    ioMock.mockClear();
    sentryMock.addBreadcrumb.mockClear();
    sentryMock.captureException.mockClear();
    queryClientMock.invalidateQueries.mockClear();
    sockets.length = 0;
    localStorage.clear();
  });

  it("registers onRoutineUpdated/onUserUpdated on the socket once connected, and offRoutineUpdated/offUserUpdated removes them", async () => {
    const { default: wsService } = await import("../index");

    // Mark the underlying socket as connected so the service registers handlers
    // directly via socket.on rather than queueing them.
    const socket = sockets[0];
    expect(socket).toBeDefined();
    if (!socket) return;
    socket.connected = true;

    const routineCb = vi.fn();
    const userCb = vi.fn();

    wsService.onRoutineUpdated(routineCb);
    wsService.onUserUpdated(userCb);

    expect(socket.on).toHaveBeenCalledWith("routine:updated", routineCb);
    expect(socket.on).toHaveBeenCalledWith("user_updated", userCb);

    wsService.offRoutineUpdated(routineCb);
    wsService.offUserUpdated(userCb);

    expect(socket.off).toHaveBeenCalledWith("routine:updated", routineCb);
    expect(socket.off).toHaveBeenCalledWith("user_updated", userCb);
  });

  it("invokes the registered callback when the server broadcasts routine:updated and user_updated", async () => {
    const { default: wsService } = await import("../index");

    const socket = sockets[0];
    expect(socket).toBeDefined();
    if (!socket) return;
    socket.connected = true;

    const routineCb = vi.fn();
    const userCb = vi.fn();

    wsService.onRoutineUpdated(routineCb);
    wsService.onUserUpdated(userCb);

    socket.trigger("routine:updated", { routineId: "r-1" });
    socket.trigger("user_updated", { userId: "u-1" });

    expect(routineCb).toHaveBeenCalledWith({ routineId: "r-1" });
    expect(userCb).toHaveBeenCalledWith({ userId: "u-1" });
  });
});

describe("permissions events", () => {
  beforeEach(() => {
    vi.resetModules();
    ioMock.mockClear();
    sentryMock.addBreadcrumb.mockClear();
    sentryMock.captureException.mockClear();
    queryClientMock.invalidateQueries.mockClear();
    appStoreMock.incrementPendingPermissions.mockClear();
    appStoreMock.decrementPendingPermissions.mockClear();
    appStoreMock.getState.mockClear();
    sockets.length = 0;
    localStorage.clear();
  });

  it("REQUEST_CREATED increments badge and invalidates requests", async () => {
    await import("../index");

    const socket = sockets[0];
    expect(socket).toBeDefined();
    if (!socket) return;

    socket.trigger("permission_request_created", { id: "req-1" });

    expect(
      appStoreMock.getState().incrementPendingPermissions,
    ).toHaveBeenCalled();
    expect(queryClientMock.invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["permissions", "requests"] }),
    );
  });

  it("REQUEST_CONSUMED decrements badge and invalidates requests", async () => {
    await import("../index");

    const socket = sockets[0];
    expect(socket).toBeDefined();
    if (!socket) return;

    socket.trigger("permission_request_consumed", { id: "req-1" });

    expect(
      appStoreMock.getState().decrementPendingPermissions,
    ).toHaveBeenCalled();
    expect(queryClientMock.invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["permissions", "requests"] }),
    );
  });

  it("REQUEST_DECIDED decrements badge and invalidates requests", async () => {
    await import("../index");

    const socket = sockets[0];
    expect(socket).toBeDefined();
    if (!socket) return;

    socket.trigger("permission_request_decided", { id: "req-1" });

    expect(
      appStoreMock.getState().decrementPendingPermissions,
    ).toHaveBeenCalled();
    expect(queryClientMock.invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["permissions", "requests"] }),
    );
  });

  it("GRANT_CREATED invalidates grants", async () => {
    await import("../index");

    const socket = sockets[0];
    expect(socket).toBeDefined();
    if (!socket) return;

    socket.trigger("permission_grant_created", { id: "g-1" });

    expect(queryClientMock.invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["permissions", "grants"] }),
    );
  });

  it("GRANT_REVOKED invalidates grants", async () => {
    await import("../index");

    const socket = sockets[0];
    expect(socket).toBeDefined();
    if (!socket) return;

    socket.trigger("permission_grant_revoked", { id: "g-1" });

    expect(queryClientMock.invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["permissions", "grants"] }),
    );
  });
});
