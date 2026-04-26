/**
 * In-process mock hub fixture for offline Playwright runs.
 *
 * Implements just enough of the gateway + ahand-hub surface to drive the
 * UI state machine without a real backend or Tauri daemon:
 *   - Stubs Tauri runtime (`window.__TAURI_INTERNALS__`, ipc invoke,
 *     event listeners) so `isTauriApp()` returns true and `ahand_*`
 *     commands resolve.
 *   - Pre-seeds `localStorage` (auth token + Zustand persisted state) so
 *     the `_authenticated` route guard does not redirect to /login.
 *   - Routes `page.route("**\/api/v1/...")` to in-memory state for auth,
 *     workspaces, onboarding, and `/ahand/devices`.
 *   - Lets the test push DaemonStatus events / WS device.* events into
 *     the page on demand so we can drive scenarios deterministically.
 */
import type { Page, Route } from "@playwright/test";

import type {
  DaemonStatusFixture,
  DeviceDtoFixture,
  MockUser,
  MockWorkspace,
} from "./types";

const DEFAULT_USER_ID = "00000000-0000-4000-8000-0000000000aa";
const DEFAULT_USER: MockUser = {
  id: DEFAULT_USER_ID,
  username: "tester",
  displayName: "E2E Tester",
  email: "tester@team9.local",
  avatarUrl: null,
  isActive: true,
  language: "en",
  timeZone: "UTC",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const DEFAULT_WORKSPACE: MockWorkspace = {
  id: "00000000-0000-4000-8000-0000000000bb",
  name: "E2E Workspace",
  slug: "e2e",
  ownerId: DEFAULT_USER_ID,
  role: "owner",
};

const HUB_URL = "https://hub.mock.local";
const DEVICE_JWT = "mock.device.jwt.value";
const JWT_EXPIRES_AT = new Date(Date.now() + 3600_000).toISOString();

function makeUuid(seed: string): string {
  // Deterministic, valid-looking v4 UUID per seed (used for hubDeviceId etc.)
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hex = h.toString(16).padStart(8, "0");
  return `${hex}-0000-4000-8000-${hex}${hex.slice(0, 4)}`;
}

export interface MockHubOptions {
  user?: MockUser;
  workspace?: MockWorkspace;
  initialDevices?: DeviceDtoFixture[];
  /**
   * Initial daemon status. Defaults to `idle` (toggle off).
   */
  initialDaemonStatus?: DaemonStatusFixture;
  /**
   * If `true`, register fails with a synthetic network error.
   */
  failRegister?: boolean;
}

export interface MockHubHandle {
  user: MockUser;
  workspace: MockWorkspace;

  /** Snapshot of the device list (test-only — does not push to the page). */
  getDevices(): DeviceDtoFixture[];

  /** Replace the device list (e.g. seed before navigation). */
  setDevices(next: DeviceDtoFixture[]): Promise<void>;

  /** Push an `ahand-daemon-status` event to the page. */
  emitDaemonStatus(status: DaemonStatusFixture): Promise<void>;

  /**
   * Push a `device.online` / `device.offline` / `device.revoked` /
   * `device.registered` WS event into the page-side stub. Updates the
   * mock hub's device list to keep `GET /v1/ahand/devices` consistent.
   */
  emitDeviceEvent(
    event:
      | { type: "device.online"; hubDeviceId: string }
      | { type: "device.offline"; hubDeviceId: string }
      | { type: "device.registered"; hubDeviceId: string }
      | { type: "device.revoked"; hubDeviceId: string },
  ): Promise<void>;

  /** Override the next register response (e.g. to force a duplicate id). */
  pinNextHubDeviceId(id: string): void;

  /** Toggle the synthetic "register fails" flag. */
  setFailRegister(fail: boolean): void;
}

export async function installMockHub(
  page: Page,
  opts: MockHubOptions = {},
): Promise<MockHubHandle> {
  const user = opts.user ?? DEFAULT_USER;
  const workspace = opts.workspace ?? DEFAULT_WORKSPACE;
  const devices: DeviceDtoFixture[] = [...(opts.initialDevices ?? [])];
  let pinnedNextId: string | null = null;
  let failRegister = !!opts.failRegister;

  await page.addInitScript(
    ([userJson, initialStatusJson]) => {
      const u = JSON.parse(userJson) as MockUser;
      const initialStatus = JSON.parse(
        initialStatusJson,
      ) as DaemonStatusFixture;

      // Pretend we're inside a Tauri webview so isTauriApp() returns true.
      // The actual ipc invoke + event listeners are routed through the test
      // harness below.
      type TauriInvokeArgs = Record<string, unknown>;
      type AhandHarness = {
        identityByUser: Record<
          string,
          { deviceId: string; publicKeyB64: string }
        >;
        daemonStatus: DaemonStatusFixture;
        wsListeners: Record<string, Set<(payload: unknown) => void>>;
        emitDaemonStatus: (s: DaemonStatusFixture) => void;
        emitWs: (event: string, payload: unknown) => void;
        invokeRecord: Array<{ cmd: string; args: TauriInvokeArgs }>;
      };

      const harness: AhandHarness = {
        identityByUser: {},
        daemonStatus: initialStatus,
        wsListeners: {},
        // Bound below once `emitToListeners` is in scope.
        emitDaemonStatus: () => {},
        emitWs(event, payload) {
          const set = this.wsListeners[event];
          if (set) for (const l of Array.from(set)) l(payload);
        },
        invokeRecord: [],
      };

      // Expose for test-side `page.evaluate(...)` calls.
      (
        window as unknown as { __ahandTestHarness: AhandHarness }
      ).__ahandTestHarness = harness;

      // Tauri runtime presence flags. Mirrors the surface that
      // `@tauri-apps/api/mocks::mockIPC()` installs — we inline the logic
      // because `page.addInitScript` can't import from node_modules.
      const callbacks = new Map<number, (data: unknown) => void>();
      const eventListeners = new Map<string, number[]>();

      function registerCallback(
        cb?: (data: unknown) => void,
        once = false,
      ): number {
        const id = window.crypto.getRandomValues(new Uint32Array(1))[0];
        callbacks.set(id, (data) => {
          if (once) callbacks.delete(id);
          return cb?.(data);
        });
        return id;
      }
      function runCallback(id: number, data: unknown) {
        callbacks.get(id)?.(data);
      }
      function unregisterCallback(id: number) {
        callbacks.delete(id);
      }
      function unregisterListener(event: string, id: number) {
        const list = eventListeners.get(event);
        if (list) {
          const idx = list.indexOf(id);
          if (idx !== -1) list.splice(idx, 1);
        }
        unregisterCallback(id);
      }
      function emitToListeners(event: string, payload: unknown) {
        const ids = eventListeners.get(event);
        if (!ids) return;
        for (const id of [...ids]) runCallback(id, { event, payload });
      }

      function handleEventPlugin(cmd: string, args: TauriInvokeArgs): unknown {
        switch (cmd) {
          case "plugin:event|listen": {
            const event = String(args.event ?? "");
            const handler = Number(args.handler ?? 0);
            if (!eventListeners.has(event)) eventListeners.set(event, []);
            eventListeners.get(event)!.push(handler);
            return handler;
          }
          case "plugin:event|emit": {
            const event = String(args.event ?? "");
            try {
              const payload = args.payload
                ? JSON.parse(String(args.payload))
                : undefined;
              emitToListeners(event, payload);
            } catch {
              emitToListeners(event, args.payload);
            }
            return null;
          }
          case "plugin:event|unlisten": {
            unregisterListener(String(args.event ?? ""), Number(args.id ?? 0));
            return null;
          }
          default:
            return undefined;
        }
      }

      // Expose the emitter so we can also push events synchronously from
      // the harness (for daemon-status events that aren't routed through
      // `plugin:event|emit`).
      harness.emitDaemonStatus = (next) => {
        harness.daemonStatus = next;
        emitToListeners("ahand-daemon-status", next);
      };

      Object.defineProperty(window, "__TAURI_EVENT_PLUGIN_INTERNALS__", {
        configurable: true,
        value: { unregisterListener },
      });

      Object.defineProperty(window, "__TAURI_INTERNALS__", {
        configurable: true,
        value: {
          transformCallback: registerCallback,
          unregisterCallback,
          runCallback,
          callbacks,
          convertFileSrc(path: string, protocol = "asset") {
            return `${protocol}://${path}`;
          },
          ipc: () => {},
          metadata: { currentWindow: { label: "main" } },
          invoke: async (cmd: string, args: TauriInvokeArgs = {}) => {
            harness.invokeRecord.push({ cmd, args });
            if (cmd.startsWith("plugin:event|")) {
              return handleEventPlugin(cmd, args);
            }
            switch (cmd) {
              case "ahand_get_identity": {
                const team9UserId = String(args.team9UserId ?? "");
                if (!harness.identityByUser[team9UserId]) {
                  // Generate a stable per-user identity.
                  const seed = `dev-${team9UserId}`;
                  const deviceId = makeBrowserUuid(seed);
                  harness.identityByUser[team9UserId] = {
                    deviceId,
                    publicKeyB64: btoa(`pk-${deviceId}`),
                  };
                }
                return harness.identityByUser[team9UserId];
              }
              case "ahand_start": {
                harness.emitDaemonStatus({ state: "connecting" });
                // Simulate the daemon coming online after a tick.
                setTimeout(() => {
                  const cfg = (args.cfg ?? {}) as Record<string, unknown>;
                  const userId = String(cfg.team9_user_id ?? "");
                  const ident = harness.identityByUser[userId];
                  harness.emitDaemonStatus({
                    state: "online",
                    device_id: ident?.deviceId ?? "unknown",
                  });
                }, 50);
                return {
                  device_id:
                    harness.identityByUser[String(args.team9UserId ?? "")]
                      ?.deviceId ?? "unknown",
                };
              }
              case "ahand_stop": {
                harness.emitDaemonStatus({ state: "idle" });
                return undefined;
              }
              case "ahand_status": {
                return harness.daemonStatus;
              }
              case "ahand_clear_identity": {
                const team9UserId = String(args.team9UserId ?? "");
                delete harness.identityByUser[team9UserId];
                return undefined;
              }
              case "plugin:dialog|ask":
              case "plugin:dialog|confirm": {
                // Native confirm() — auto-accept in tests so destructive
                // flows go through. Override per-test by re-stubbing.
                return true;
              }
              case "plugin:dialog|message": {
                // `ask()` from `@tauri-apps/plugin-dialog` is implemented
                // on top of `plugin:dialog|message` and compares the
                // returned label against `okLabel`. The plugin transforms
                // its `buttons` arg via `buttonsToRust(...)` before the
                // invoke, so we receive shapes like
                // `{ OkCancelCustom: ["OK", "Cancel"] }` or
                // `{ OkCustom: "OK" }` (or the bare strings 'YesNo' /
                // 'YesNoCancel' / 'OkCancel'). Echo the OK button label
                // so confirm dialogs auto-accept.
                const buttons = args.buttons as
                  | string
                  | {
                      OkCancelCustom?: [string, string];
                      OkCustom?: string;
                      YesNoCancelCustom?: [string, string, string];
                    }
                  | undefined;
                if (typeof buttons === "string") {
                  if (buttons === "YesNo" || buttons === "YesNoCancel")
                    return "Yes";
                  if (buttons === "OkCancel") return "Ok";
                  return "Ok";
                }
                if (buttons && typeof buttons === "object") {
                  if (buttons.OkCancelCustom) return buttons.OkCancelCustom[0];
                  if (buttons.OkCustom) return buttons.OkCustom;
                  if (buttons.YesNoCancelCustom)
                    return buttons.YesNoCancelCustom[0];
                }
                return "Ok";
              }
              default: {
                // Unknown commands resolve with a no-op so non-ahand callsites
                // (traffic-light alignment etc.) don't crash the page.
                return undefined;
              }
            }
          },
        },
      });

      function makeBrowserUuid(seed: string) {
        let h = 0;
        for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
        const hex = h.toString(16).padStart(8, "0");
        return `${hex}-0000-4000-8000-${hex}${hex.slice(0, 4)}`;
      }

      // ws stub: replace the team9 websocket service event API once it
      // loads. Hook the global so that wsService.on(...) calls land here.
      type WsServiceStub = {
        on: (event: string, cb: (payload: unknown) => void) => void;
        off: (event: string, cb: (payload: unknown) => void) => void;
        joinAhandRoom: (room: string) => void;
        leaveAhandRoom: (room: string) => void;
        onConnectionChange: (cb: (s: string) => void) => () => void;
        connect?: (..._a: unknown[]) => void;
        disconnect?: () => void;
        getSocket?: () => null;
      };
      const wsStub: WsServiceStub = {
        on(event, cb) {
          (harness.wsListeners[event] ??= new Set()).add(
            cb as (p: unknown) => void,
          );
        },
        off(event, cb) {
          harness.wsListeners[event]?.delete(cb as (p: unknown) => void);
        },
        joinAhandRoom() {
          /* no-op in mock */
        },
        leaveAhandRoom() {
          /* no-op in mock */
        },
        onConnectionChange() {
          return () => {};
        },
        connect() {
          /* no-op */
        },
        disconnect() {
          /* no-op */
        },
        getSocket() {
          return null;
        },
      };
      (
        window as unknown as { __WS_SERVICE_STUB__: WsServiceStub }
      ).__WS_SERVICE_STUB__ = wsStub;

      // Pre-seed localStorage so `_authenticated` does not redirect to /login.
      // The token must be a parseable JWT with a future `exp` claim because
      // `getValidAccessToken()` inspects it before any HTTP call.
      const jwtHeader = btoa(
        JSON.stringify({ alg: "none", typ: "JWT" }),
      ).replace(/=+$/, "");
      const jwtPayload = btoa(
        JSON.stringify({
          sub: "00000000-0000-4000-8000-0000000000aa",
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      ).replace(/=+$/, "");
      const fakeJwt = `${jwtHeader}.${jwtPayload}.sig`;
      localStorage.setItem("auth_token", fakeJwt);
      localStorage.setItem("refresh_token", fakeJwt);

      // Pre-seed Zustand stores. These keys come from the `persist` middleware
      // configs in src/stores/*.
      localStorage.setItem(
        "app-storage",
        JSON.stringify({
          state: {
            theme: "light",
            activeSidebar: "home",
            sidebarCollapsed: false,
            lastVisitedPaths: {},
          },
          version: 0,
        }),
      );

      // The current user is set by syncCurrentUser() after /v1/auth/me
      // resolves — but the toggle in `ThisMacSection` short-circuits when
      // `userId` is null, racing with the round trip. The E2E-only
      // `expose-stores.ts` entrypoint reads this sentinel and synchronously
      // calls `setUser` during module init, so by the time React renders
      // the toggle, `useUser()` already returns a populated user.
      localStorage.setItem(
        "__e2e_seed_user",
        JSON.stringify({
          id: u.id,
          name: u.displayName || u.username,
          email: u.email,
          avatarUrl: u.avatarUrl,
          createdAt: u.createdAt,
        }),
      );

      // Make sure we don't trip the home-redirect logic on /devices nav.
      sessionStorage.setItem("app_initialized", "true");

      // Stamp a marker so test code can verify init ran.
      (window as unknown as { __mockHubReady: boolean }).__mockHubReady = true;
      void u; // user metadata is forwarded via /api/v1/auth/me route mock
    },
    [
      JSON.stringify(user),
      JSON.stringify(opts.initialDaemonStatus ?? { state: "idle" }),
    ],
  );

  // ---- HTTP route mocks ----
  // Playwright route handlers run in **last-registered, first-matched**
  // order. Register the broad fallback first so that more specific
  // patterns added afterwards override it.
  await page.route("**/api/v1/**", (route) => {
    if (route.request().method() === "GET") {
      return fulfillJson(route, []);
    }
    return route.fulfill({ status: 204, body: "" });
  });

  await page.route("**/api/v1/auth/me", (route) => fulfillJson(route, user));

  // Match `/v1/workspaces` with optional trailing slash and any query
  // string. The bare-`workspaces` glob (no `*`) only catches the exact
  // form, so we use a regex to also catch `?` query strings cleanly.
  await page.route(/\/api\/v1\/workspaces(\?[^/]*)?$/, (route) =>
    fulfillJson(route, [workspace]),
  );

  await page.route("**/api/v1/workspaces/*/onboarding", (route) =>
    fulfillJson(route, null),
  );

  // Catch-all for other workspace bootstrap reads — return a minimal
  // workspace-shaped object so consumers don't crash.
  await page.route("**/api/v1/workspaces/*", (route) => {
    if (route.request().method() === "GET") {
      return fulfillJson(route, {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
      });
    }
    return route.continue();
  });

  await page.route(
    /\/api\/v1\/ahand\/devices(\/.*)?(\?.*)?$/,
    async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const method = req.method();

      // Token refresh: POST /v1/ahand/devices/:id/token/refresh
      if (
        method === "POST" &&
        /\/api\/v1\/ahand\/devices\/[^/]+\/token\/refresh\/?$/.test(
          url.pathname,
        )
      ) {
        return fulfillJson(route, {
          deviceJwt: DEVICE_JWT,
          jwtExpiresAt: JWT_EXPIRES_AT,
        });
      }

      if (
        method === "GET" &&
        /\/api\/v1\/ahand\/devices\/?$/.test(url.pathname)
      ) {
        const includeOffline =
          url.searchParams.get("includeOffline") !== "false";
        const visible = includeOffline
          ? devices
          : devices.filter((d) => d.isOnline === true);
        return fulfillJson(route, visible);
      }

      if (
        method === "POST" &&
        /\/api\/v1\/ahand\/devices\/?$/.test(url.pathname)
      ) {
        if (failRegister) {
          return route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ message: "registration_failed" }),
          });
        }
        const body = req.postDataJSON?.() as
          | {
              hubDeviceId: string;
              publicKey: string;
              nickname: string;
              platform: "macos" | "windows" | "linux";
              hostname?: string;
            }
          | undefined;
        const hubDeviceId =
          pinnedNextId ??
          body?.hubDeviceId ??
          makeUuid(`reg-${devices.length}`);
        pinnedNextId = null;
        const existing = devices.find((d) => d.hubDeviceId === hubDeviceId);
        const device: DeviceDtoFixture = existing ?? {
          id: makeUuid(`row-${hubDeviceId}`),
          hubDeviceId,
          nickname: body?.nickname ?? "device",
          platform: body?.platform ?? "macos",
          hostname: body?.hostname ?? null,
          status: "active",
          lastSeenAt: null,
          isOnline: false,
          createdAt: new Date().toISOString(),
        };
        if (!existing) devices.push(device);
        return fulfillJson(route, {
          device,
          deviceJwt: DEVICE_JWT,
          hubUrl: HUB_URL,
          jwtExpiresAt: JWT_EXPIRES_AT,
        });
      }

      if (method === "PATCH") {
        const id = url.pathname.split("/").pop() ?? "";
        const body = req.postDataJSON?.() as { nickname?: string } | undefined;
        const idx = devices.findIndex((d) => d.id === id);
        if (idx === -1)
          return route.fulfill({
            status: 404,
            body: "{}",
            contentType: "application/json",
          });
        if (body?.nickname)
          devices[idx] = { ...devices[idx], nickname: body.nickname };
        return fulfillJson(route, devices[idx]);
      }

      if (method === "DELETE") {
        const id = url.pathname.split("/").pop() ?? "";
        const idx = devices.findIndex((d) => d.id === id);
        if (idx !== -1) devices.splice(idx, 1);
        return route.fulfill({ status: 204, body: "" });
      }

      return route.continue();
    },
  );

  // Block external services that would otherwise time out (sentry, posthog,
  // socket.io upgrade). Scoped to remote hosts so we don't intercept
  // Vite-served modules whose paths happen to contain "sentry" or "posthog"
  // (e.g. `/node_modules/.vite/deps/@sentry_react.js`,
  //  `/src/analytics/posthog/index.ts`).
  await page.route(
    /^https?:\/\/(?!localhost|127\.0\.0\.1).*?(sentry|posthog|grafana|cloudfront|googleapis|gstatic)/,
    (route) => route.fulfill({ status: 204, body: "" }),
  );
  // Block socket.io polling/upgrade so it fails fast in mock mode. Only
  // remote hosts — Vite never serves /socket.io/ from localhost.
  await page.route(
    /^https?:\/\/(?!localhost|127\.0\.0\.1).*?\/socket\.io\//,
    (route) => route.fulfill({ status: 503, body: "mock-hub: ws disabled" }),
  );

  return {
    user,
    workspace,
    getDevices: () => devices.map((d) => ({ ...d })),
    async setDevices(next: DeviceDtoFixture[]) {
      devices.splice(0, devices.length, ...next);
    },
    async emitDaemonStatus(status: DaemonStatusFixture) {
      await page.evaluate((s) => {
        type AhandHarness = {
          emitDaemonStatus: (s: DaemonStatusFixture) => void;
        };
        const h = (window as unknown as { __ahandTestHarness?: AhandHarness })
          .__ahandTestHarness;
        h?.emitDaemonStatus(s as DaemonStatusFixture);
      }, status);
    },
    async emitDeviceEvent(event) {
      // Keep the mock-hub's device list consistent with what we tell the
      // page-side cache.
      if (event.type === "device.online") {
        const d = devices.find((x) => x.hubDeviceId === event.hubDeviceId);
        if (d) d.isOnline = true;
      } else if (event.type === "device.offline") {
        const d = devices.find((x) => x.hubDeviceId === event.hubDeviceId);
        if (d) d.isOnline = false;
      } else if (event.type === "device.revoked") {
        const idx = devices.findIndex(
          (x) => x.hubDeviceId === event.hubDeviceId,
        );
        if (idx !== -1) devices.splice(idx, 1);
      }
      await page.evaluate((ev) => {
        type AhandHarness = {
          emitWs: (event: string, payload: unknown) => void;
        };
        const h = (window as unknown as { __ahandTestHarness?: AhandHarness })
          .__ahandTestHarness;
        if (!h) return;
        if (ev.type === "device.registered") h.emitWs(ev.type, {});
        else h.emitWs(ev.type, { hubDeviceId: ev.hubDeviceId });
      }, event);
    },
    pinNextHubDeviceId(id: string) {
      pinnedNextId = id;
    },
    setFailRegister(fail: boolean) {
      failRegister = fail;
    },
  };
}

function fulfillJson(route: Route, body: unknown): Promise<void> {
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

export const FIXTURE_DEFAULTS = {
  HUB_URL,
  DEVICE_JWT,
  JWT_EXPIRES_AT,
  DEFAULT_USER,
  DEFAULT_WORKSPACE,
};
