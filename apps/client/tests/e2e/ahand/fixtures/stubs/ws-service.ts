/**
 * E2E-only stub for `@/services/websocket` (default export `wsService`).
 *
 * The real service wraps a socket.io client; in mock mode we replace it
 * with an in-memory event bus so the test fixture can push
 * `device.online` etc. without a live backend. The harness exposes
 * `window.__WS_SERVICE_STUB__` containing the methods the app uses.
 *
 * Aliased in via `vite.config.ts` only when `VITE_E2E_MOCK=1`.
 */
type Listener = (payload: unknown) => void;
type ConnectionListener = (status: string) => void;

interface WsHarness {
  on: (event: string, cb: Listener) => void;
  off: (event: string, cb: Listener) => void;
  joinAhandRoom: (room: string) => void;
  leaveAhandRoom: (room: string) => void;
  onConnectionChange: (cb: ConnectionListener) => () => void;
}

function getHarness(): WsHarness | null {
  const w = globalThis as unknown as { __WS_SERVICE_STUB__?: WsHarness };
  return w.__WS_SERVICE_STUB__ ?? null;
}

const wsService = new Proxy({} as Record<string, unknown>, {
  get(_target, prop: string) {
    if (prop === "then") return undefined;

    const harness = getHarness();
    const known =
      harness && (harness as unknown as Record<string, unknown>)[prop];
    if (typeof known === "function") return known.bind(harness);

    if (prop === "isConnected" || prop === "getSocket") return () => false;
    if (prop === "getConnectionStatus") return () => "disconnected";
    if (prop === "onConnectionChange") return () => () => {};

    // Default: no-op function for everything else (onUserOnline,
    // onMessageNew, joinChannel, ...). The app calls dozens of these and
    // we don't need any of them for ahand specs.
    return () => undefined;
  },
});

export default wsService;
