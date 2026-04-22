# Stream E Completion Report

**Branch:** `feat/ahand-stream-e` → `dev`  
**PR:** [#51](https://github.com/team9ai/team9/pull/51)  
**Completed:** 2026-04-22  
**Scope:** `apps/client/**` (Tauri Rust + React/TS frontend)

---

## 1. Task Completion

### Phase I — i18n Resources (Task 8.6) ✅

- Added `ahand` i18n namespace across all 12 locales (en/zh-CN/zh-TW/ja/ko/es/pt/fr/de/it/nl/ru)
- **35 keys** covering: device management actions, status labels, error messages (`resumeFailed`, `deviceRevoked`, `autoRefreshFailed`, `nicknameSaveFailed`), and web CTA copy
- Registered in `loadLanguage.ts` NAMESPACES, `index.ts` preload, and `i18next.d.ts` type declaration
- 38 tests enforce cross-locale key parity and interpolation placeholder consistency

### Phase II — Tauri Rust Embedding (Tasks 7.1–7.4) ✅

| Task | Commit     | Description                                                                                                                                                                               |
| ---- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.1  | `615a8635` | Delete legacy `src/ahand.rs` (513-line sidecar code), remove `externalBin`, remove sidecar download from CI, add `ahandd` git dep to Cargo.toml                                           |
| 7.2  | `a4cf5cb8` | `identity.rs`: per-user identity directory (`{app_data_dir}/ahand/users/{userId}/identity`), UUID charset validation, Unix 0700 perms, `device_id_from_dir()` matching ahandd's algorithm |
| 7.3  | `e3693a0d` | `AhandRuntime` singleton (`tokio::Mutex`), `start/stop/status/current_device_id`, status forwarder task, app-exit cleanup hook                                                            |
| 7.4  | `8b553d80` | 5 Tauri commands: `ahand_get_identity`/`ahand_start`/`ahand_stop`/`ahand_status`/`ahand_clear_identity`; TS bindings (`tauri-ahand.ts`); invoke wrapper (`ahand-tauri.ts`)                |

**Rust tests:** 24 passing.

### Phase III — Frontend API/Hook Layer (Tasks 8.1–8.2) ✅

| Task | Commit     | Description                                                                                                                                                    |
| ---- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8.1  | `b52c5abd` | `useAhandStore` (persisted Zustand, per-user `{enabled, deviceId, hubUrl}`); `buildClientContext()` auto-injected into all `sendMessage` HTTP calls            |
| 8.2  | `0137aa12` | `ahand-api.ts` (`/ahand/*` REST wrapper); `useAhandDevices` (React Query + WS room join with reconnect replay); `useAhandLocalStatus` (Tauri event subscriber) |

### Phase IV — UI + Auto-Resume + Cleanup (Tasks 8.3–8.5, 8.7) ✅

| Task | Commit     | Description                                                                                                                                                                                   |
| ---- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8.3  | `1bfdf10e` | `DevicesDialog` (env branch), `ThisMacSection` (5-step registration/remove/status), `OtherDevicesList` (device list + inline nickname edit + remove), `WebCtaCard` (deep-link + platform URL) |
| 8.4  | `82c3965a` | `useAhandBootstrap` (login resume + logout stop), `MainSidebar` Laptop button + status dot, `_authenticated.tsx` mount wiring                                                                 |
| 8.5  | `4a3a3dc5` | `useAhandJwtRefresh` (auth error triggers JWT refresh, 30s rate limit)                                                                                                                        |
| 8.7  | `ff81bc38` | Deleted `useAHandSetupStore`/`useAHandStatus`/`AHandSetupDialog`/`LocalDeviceStatus` and all other legacy sidecar-era code                                                                    |

### Reviews and Fixes

- **Claude review-loop (2 rounds):** Fixed WS event name mismatch, missing room join, `hubUrl` not persisted, daemon not stopped on logout, wrong i18n key for nickname save error, stale mock in MainSidebar test
- **Codex review (2 rounds):** Fixed Tauri commands not registered, double `/api` URL prefix, identity not cleared from disk on remove, WS room not re-joined after reconnect
- **Copilot review:** 2 fixes (identity test helper, misleading test name); 3 declined with documented reasoning

**Final test count: 1310 TS + 24 Rust = 1334 tests, all passing.**

---

## 2. Key Implementation Decisions

### ahandd Cargo Dependency

```toml
ahandd = { git = "https://github.com/team9ai/ahand", package = "ahandd", branch = "feat/ahand-stream-a" }
```

**Action needed:** After Stream A merges to dev, update to `tag = "rust-v0.1.2"`.

### clientContext Wire Format

- Field name: `clientContext` (top-level in HTTP body, camelCase)
- Shape: `{ kind: "macapp"; deviceId: string | null } | { kind: "web" }`
- Injection point: `buildClientContext()` inside `messagesApi.sendMessage` — automatic, no call-site changes needed
- **Note:** Stream D Task 4.8 must add `clientContext` to `CreateMessageDto` for the field to be persisted and forwarded to im-worker. The client implementation is complete; it activates automatically once Stream D ships.

### device_id Derivation

- Tauri shell computes via `device_id_from_dir(identity_dir)`: SHA256(`"ahandd-device-id:" + identity_dir_path`), prefixed with `"dev-"`
- Matches `ahandd` library's own `default_device_id()` algorithm exactly
- **Note:** device_id is bound to the identity directory path. If `app_data_dir` changes (e.g., macOS app migration), device_id changes and re-registration is required.

### isTauriApp Location

- **Actual path:** `@/lib/tauri` (plan referred to `@/lib/env` which does not exist)

### useCurrentUser Replacement

- `useCurrentUser()` from `@/hooks/useAuth` returns a React Query result object (`{ data, isLoading, ... }`), not a user directly
- All places needing a synchronous userId use `useAppStore((s) => s.user)` instead

---

## 3. Integration Notes

### Stream A (ahandd library)

1. **Cargo.toml pin update needed:** After Stream A PR merges to dev, change the dependency from `branch = "feat/ahand-stream-a"` to `tag = "rust-v0.1.2"`.

2. **DaemonStatus TS binding contract:**

   ```ts
   export type DaemonStatus =
     | { state: "idle" }
     | { state: "connecting" }
     | { state: "online"; device_id: string }
     | { state: "offline" }
     | {
         state: "error";
         kind: "auth" | "network" | "other";
         message: string;
         device_id?: string;
       };
   ```

   Rust serde: `#[serde(tag = "state", rename_all = "camelCase")]`. `Online.device_id` stays snake_case via explicit `#[serde(rename = "device_id")]`.

3. **spawn() API contract:**
   ```rust
   DaemonConfig::builder(hub_url, device_jwt, identity_dir)
     .device_id(id)
     .session_mode(SessionMode::AutoAccept)
     .browser_enabled(false)   // disabled in MVP per spec
     .heartbeat_interval(Duration::from_secs(60))
     .build()
   ```

### Stream D (gateway REST + DB schema)

1. **API path prefix:** Client calls `/ahand/*` — HttpClient `baseURL` already includes `/api`, so do **not** add `/api` again in route paths.
   - `POST /ahand/devices` → register device
   - `GET /ahand/devices` → list devices
   - `POST /ahand/devices/:id/token/refresh` → refresh JWT (**must return `hubUrl`** — see point 2)
   - `PATCH /ahand/devices/:id` → rename device
   - `DELETE /ahand/devices/:id` → remove device

2. **`hubUrl` in `RegisterDeviceResponse` is critical:** `useAhandBootstrap` and `useAhandJwtRefresh` read `hubUrl` from the store on every resume/refresh cycle. The value is stored at registration time. If `refreshToken` also returns `hubUrl`, the bootstrap logic can be simplified; currently it reads from the store (set at registration).

3. **WS event names:** Server emits `device.online` / `device.offline` / `device.revoked` / `device.registered` — **no `ahand:` prefix**. Client `useAhandDevices` subscribes to these exact names.

4. **WS room join:** Client emits `ahand:join_room` with `{ room: "user:{userId}:ahand" }` on mount and on every reconnect. `AhandEventsGateway` must handle this event and add the socket to the named room. Without this, `server.to(room).emit(...)` reaches no clients.

5. **`clientContext` DB column:** Task 4.8 adds `client_context jsonb NULL` to the `messages` table and accepts the field in the `send_message` handler. Client sends `clientContext` (camelCase) in the HTTP body; server DTO field name should match.

6. **Room name format:** `user:{userId}:ahand` (userId is the team9 user UUID).

### Phase 9 (Integration Tests)

- **Prerequisites met:** All Phase IV code shipped, legacy cleanup complete
- **DaemonStatus TS binding** documented above — use for claw-hive contract alignment (Task 9.1)
- **Playwright E2E** can begin (Task 9.4 precondition satisfied)

---

## 4. Known Pending Items (non-blocking for merge)

| Item                                    | Description                                                         | Owner                            |
| --------------------------------------- | ------------------------------------------------------------------- | -------------------------------- |
| Cargo.toml tag update                   | `branch = "feat/ahand-stream-a"` → `tag = "rust-v0.1.2"`            | Stream E (after Stream A merges) |
| `clientContext` server-side persistence | Add `clientContext` field to `CreateMessageDto` and persist         | Stream D Task 4.8                |
| `hubUrl` in `refreshToken` response     | Would simplify bootstrap logic; current workaround reads from store | Stream D Task 4.4 (follow-up)    |
| `ahand_clear_identity` command test     | Tauri State injection not unit-testable; covered by Phase 9 E2E     | Phase 9                          |

---

## 5. Key File Map

```
apps/client/
├── src-tauri/src/ahand/
│   ├── mod.rs              # module re-exports
│   ├── identity.rs         # per-user identity directory management
│   ├── runtime.rs          # AhandRuntime singleton
│   └── commands.rs         # 5 Tauri commands
├── src/
│   ├── types/tauri-ahand.ts        # hand-maintained TS type bindings
│   ├── services/
│   │   ├── ahand-tauri.ts          # invoke() wrappers
│   │   └── ahand-api.ts            # REST client
│   ├── stores/useAhandStore.ts     # persisted Zustand store
│   ├── hooks/
│   │   ├── useAhandLocalStatus.ts  # Tauri event subscriber
│   │   ├── useAhandDevices.ts      # React Query + WS room
│   │   ├── useAhandBootstrap.ts    # login resume + logout stop
│   │   └── useAhandJwtRefresh.ts   # auth-error JWT refresh
│   └── components/
│       ├── dialog/DevicesDialog.tsx
│       ├── dialog/devices/
│       │   ├── ThisMacSection.tsx
│       │   ├── OtherDevicesList.tsx
│       │   └── WebCtaCard.tsx
│       └── layout/MainSidebar.tsx  # patched: +Laptop button
```
