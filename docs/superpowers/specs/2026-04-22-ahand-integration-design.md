# ahand Integration Design (Re-integration)

- **Date:** 2026-04-22
- **Status:** Draft (awaiting user review)
- **Scope:** MVP — fully replace the OpenClaw-gateway path; integrate with an independently deployed ahand-hub so team9 agents can execute shell on users' authorized real machines.
- **Repos involved:** `team9ai/team9` · `team9ai/team9-agent-pi` · `team9ai/ahand` · team9 infra
- **Related specs:** (none)

---

## Summary

Re-integrate ahand's remote-control capability into team9, replacing the old "Tauri spawns `ahandd` sidecar connecting to OpenClaw gateway" flow. Under the new architecture:

- The Tauri client embeds `ahandd` as a Rust library inside its own process; no child process is spawned.
- An independent ahand-hub is deployed on AWS (same ECS cluster as openclaw-hive; deployment pattern mirrors folder9).
- team9 gateway is the permissions source of truth. It holds `AHAND_HUB_SERVICE_TOKEN` and mints hub JWTs on behalf of users.
- team9 agents (claw-hive runtime) register each of the user's online machines as a separate `IHostBackend` under an extended `HostComponent`; the agent calls `run_command({ backend, command })` to pick a machine.
- Devices use polymorphic `owner_type` / `owner_id` ownership (user for MVP; workspace later).
- Web clients see the user's devices and are prompted to install or open the desktop app.

MVP exposes only shell (with `auto_accept` session mode) and only per-user devices. Browser automation, file operations, approval prompts, workspace devices, and "request-device" flows are follow-ups.

---

## § 1 · System Topology

```
 ┌──────────────────────────────────────────────────────────────────┐
 │                          User's Mac                              │
 │  ┌─────────────────────────────────────────────────────────────┐ │
 │  │  Team9 Tauri App                                            │ │
 │  │  ┌─────────────────────┐   ┌───────────────────────────────┐│ │
 │  │  │  React/TS frontend   │   │  Rust (src-tauri)             ││ │
 │  │  │  - Entry above       │◀──│  - Embedded ahandd lib        ││ │
 │  │  │    avatar → Devices  │   │    (Ed25519 + WS client)      ││ │
 │  │  │  - Allow/disallow    │──▶│  - Tauri commands:            ││ │
 │  │  │  - Device list       │   │    start/stop/status          ││ │
 │  │  └──────────┬──────────┘   └──────────┬────────────────────┘│ │
 │  │             │ HTTP                     │ WSS                 │ │
 │  └─────────────┼──────────────────────────┼─────────────────────┘ │
 └────────────────┼──────────────────────────┼──────────────────────┘
                  │                          │
                  ▼                          ▼
 ┌──────────────────────┐         ┌────────────────────────────────┐
 │  Team9 Gateway       │◀───────▶│  ahand-hub (AWS ECS)           │
 │  (NestJS, Railway)    │  HTTP  │  - Device JWT issuance          │
 │  - /api/ahand/*       │ service│  - Job dispatch (WS)            │
 │  - ahand_devices tbl  │  token │  - Audit log                    │
 │  - @ahand/sdk (agent) │        │  - Postgres + Redis             │
 └──────────┬───────────┘         └────────────────┬───────────────┘
            │                                       │
            ▼ internal                              │ WSS (daemon ↔ hub)
 ┌──────────────────────────────┐                  │
 │  Team9 im-worker              │                  │
 │  claw-hive runtime            │                  │
 │  - AHandHostComponent         │──via @ahand/sdk──┘
 │    (IHostBackend, typeKey     │   (control plane)
 │    "ahand:user-computer:*")   │
 └──────────────────────────────┘
```

### Key Paths

- **Tauri ↔ hub (data plane):** the daemon dials hub over WS using the hub-signed device JWT; each envelope is Ed25519-signed. This channel carries job execution.
- **Tauri ↔ gateway (control plane):** Tauri only talks to gateway to obtain JWTs, register devices, and fetch device lists. Tauri never holds the hub service token.
- **gateway ↔ hub (server-to-server trust):** gateway holds `AHAND_HUB_SERVICE_TOKEN`; only gateway can mint JWTs and mutate hub device records.
- **im-worker ↔ hub (agent control plane):** the agent side uses `@ahand/sdk`'s `CloudClient` to call hub REST + SSE with a control-plane JWT minted by gateway. team9's permissions SOT is enforced by `JWT.externalUserId + device ownership check`.

**Why doesn't the agent go through gateway?** Shell output is streaming stdout/stderr over SSE/WS. Proxying through gateway would make it a tunnel, costing QPS and latency. im-worker dials hub directly; permissions come from JWT claims.

---

## § 2 · ahand Repo Changes (Cross-repo)

### 2.1 `crates/ahandd` Library-ization

Today, `ahandd` already exposes a `lib.rs` with modules like `ahand_client`, but `main.rs` (443 lines) still holds most of the startup orchestration (CLI parsing, config loading, session manager wiring). Since team9's Tauri will spawn the daemon on its own tokio runtime, that orchestration needs to move into lib-level APIs.

**New public API:**

```rust
// crates/ahandd/src/lib.rs
pub struct DaemonConfig {
    pub hub_url: String,                    // wss://ahand-hub.team9.ai
    pub device_jwt: String,                 // JWT minted by team9 gateway
    pub identity_dir: PathBuf,              // Directory holding the Ed25519 key
    pub session_mode: SessionMode,          // Fixed to AutoAccept for MVP
    pub browser_enabled: bool,              // Fixed to false for MVP
    pub heartbeat_interval: Duration,       // Default 60s
}

pub struct DaemonHandle {
    shutdown_tx: oneshot::Sender<()>,
    join: JoinHandle<Result<()>>,
    status_rx: watch::Receiver<DaemonStatus>,
}

#[derive(Clone, Debug)]
pub enum DaemonStatus {
    Idle,
    Connecting,
    Online { device_id: String },
    Offline,
    Error { kind: ErrorKind, message: String },
}

#[derive(Clone, Debug)]
pub enum ErrorKind {
    Auth,     // JWT rejected or signature issue
    Network,  // Hub unreachable or WS close
    Other,
}

impl DaemonHandle {
    pub async fn shutdown(self) -> Result<()>;
    pub fn status(&self) -> DaemonStatus;
    pub fn subscribe_status(&self) -> watch::Receiver<DaemonStatus>;
    pub fn device_id(&self) -> &str;
}

pub async fn spawn(config: DaemonConfig) -> Result<DaemonHandle>;

// Helper: load or generate an Ed25519 identity. Tauri calls this during
// registration to obtain the deviceId + public key.
pub fn load_or_create_identity(dir: &Path) -> Result<DeviceIdentity>;

pub struct DeviceIdentity {
    pub device_id: String,     // SHA256(pubkey) hex
    pub public_key_b64: String,
}
```

`main.rs` degrades into a thin CLI shim that calls `lib::spawn()`.

### 2.2 `crates/ahand-hub` Extensions

#### 2.2.1 Admin API (service-token auth)

```
POST /api/admin/devices
  body: { deviceId, publicKey, externalUserId, metadata? }
  response: { deviceId, createdAt }
  effect: Pre-register device, state=approved.

POST /api/admin/devices/{deviceId}/token
  body: { ttlSeconds?: number }      (default 86400 / 24h; supports up to 7d)
  response: { token, expiresAt }
  effect: Mint a device JWT bound to deviceId + externalUserId.

POST /api/admin/control-plane/token
  body: { externalUserId, deviceIds?: string[], scope?: "jobs:execute" }
  response: { token, expiresAt }
  effect: Mint an agent-control-plane JWT (short TTL, 1h).

DELETE /api/admin/devices/{deviceId}

GET /api/admin/devices?externalUserId=...
  response: [{ deviceId, publicKey, nickname?, isOnline, lastSeenAt, ... }]
```

#### 2.2.2 JWT Claim Extensions

Both device JWT and control-plane JWT gain an `externalUserId` claim. Device JWTs additionally carry `deviceId`; control-plane JWTs carry `scope` and optional `deviceIds` allowlist.

#### 2.2.3 Control-plane REST + SSE

```
POST /api/control/jobs
  auth: Bearer <control-plane JWT>
  body: { deviceId, command, cwd?, envs?, timeoutMs?, correlationId? }
  effect: Validate JWT → check ownership → verify device online →
          assign jobId → push Job envelope to the daemon.
  response: { jobId }
  errors: 403 ownership / 404 offline / 429 rate-limited

GET /api/control/jobs/{jobId}/stream
  auth: Bearer <control-plane JWT>
  response: text/event-stream
  events:
    event: stdout\ndata: {"chunk":"..."}\n\n
    event: stderr\ndata: {"chunk":"..."}\n\n
    event: progress\ndata: {"percent":N,"message":"..."}\n\n
    event: finished\ndata: {"exitCode":0,"durationMs":...}\n\n
    event: error\ndata: {"code":"...","message":"..."}\n\n
  keepalive: `: keepalive\n\n` every 15s to defeat proxy idle timeouts.

POST /api/control/jobs/{jobId}/cancel
  effect: Best-effort; sends CancelJob envelope to the daemon.
  response: 202
```

MVP runs hub as a single replica. Horizontal scaling requires Redis pub/sub-based cross-replica job routing — listed as a follow-up.

#### 2.2.4 Outbound Webhook Sender

A new outbound webhook module, configured via:

```
AHAND_HUB_WEBHOOK_URL=https://gateway.team9.ai/api/ahand/hub-webhook
AHAND_HUB_WEBHOOK_SECRET=<32+ chars, shared with team9 gateway>
AHAND_HUB_WEBHOOK_MAX_RETRIES=8          # exponential backoff 1s, 2s, 4s, ..., 256s
AHAND_HUB_WEBHOOK_TIMEOUT_MS=5000
```

**Event types:**

| eventType           | Trigger                                       | Frequency         |
| ------------------- | --------------------------------------------- | ----------------- |
| `device.registered` | Service token pre-registers                   | Once              |
| `device.online`     | Daemon WS connects & passes Ed25519 challenge | Per connection    |
| `device.heartbeat`  | Daemon pushes heartbeat (every 60s)           | Continuous        |
| `device.offline`    | Hub detects WS close or ping timeout          | Per disconnection |
| `device.revoked`    | Service token DELETE                          | Once              |

**Payload shape:**

```json
{
  "eventId": "evt_01HXK...",
  "eventType": "device.heartbeat",
  "occurredAt": "2026-04-22T...",
  "deviceId": "<sha256 hex>",
  "externalUserId": "<team9 userId>",
  "data": {
    "sentAtMs": 1745318400000,
    "presenceTtlSeconds": 180
  }
}
```

**Signature headers:** `X-AHand-Signature: sha256=<hex(HMAC-SHA256(secret, rawBody))>`, `X-AHand-Event-Id`, `X-AHand-Timestamp`. The gateway rejects signatures older than 5 minutes to defeat replay.

**Delivery guarantee:** at-least-once. Failures go into a local queue (`webhook_deliveries(eventId, payload, attempts, nextRetryAt, lastError)`) retried by a background worker; exhausted retries fall back to `audit_fallback.jsonl`.

#### 2.2.5 Heartbeat Direction Reversal

**Removed:** per-device heartbeat timer inside hub.

**Replaced by:** the daemon proactively sends `Heartbeat` envelopes on the WS at `heartbeat_interval` (default 60s). When hub receives one, it immediately POSTs a `device.heartbeat` webhook.

Hub's WS-layer ping/pong (a few-second interval for TCP liveness) remains, but application-layer heartbeat is decoupled from it.

`AHAND_HUB_HEARTBEAT_INTERVAL_SECONDS` is removed from hub env vars; the cadence is controlled daemon-side via `DaemonConfig::heartbeat_interval`.

#### 2.2.6 Heartbeat Envelope

Add to `crates/ahand-protocol` (if not already present):

```proto
message Heartbeat {
  uint64 sent_at_ms = 1;
  string daemon_version = 2;
}
```

Include it in the `Envelope` oneof.

### 2.3 `@ahand/sdk` Adds `CloudClient`

Today, SDK's `AHandServer.handleSocket(ws)` is the server-side API of the "build-your-own-hub" model. team9 needs a hub client to dispatch jobs, so we add:

```ts
// packages/sdk/src/cloud-client.ts
export interface CloudClientOptions {
  hubUrl: string;
  getAuthToken: () => Promise<string>;
  fetch?: typeof fetch;
}

export class CloudClient {
  constructor(opts: CloudClientOptions) {...}

  async spawn(params: {
    deviceId: string;
    command: string;
    cwd?: string;
    envs?: Record<string, string>;
    timeoutMs?: number;
    correlationId?: string;
    onStdout?: (chunk: string) => void;
    onStderr?: (chunk: string) => void;
    onProgress?: (p: { percent: number; message: string }) => void;
    signal?: AbortSignal;
  }): Promise<{ exitCode: number; durationMs: number }>;

  async cancel(jobId: string): Promise<void>;
  async listDevices(externalUserId: string): Promise<DeviceSummary[]>;
}
```

Implementation: `POST /api/control/jobs` to get a jobId → open SSE → dispatch events to callbacks → `finished` resolves, `error` rejects, `signal.aborted` cancels + closes.

`getAuthToken` is a callback (not a static string) to support lazy fetching and refresh.

Existing `AHandServer` and friends (the "build-your-own-hub" API) stay; the two modes coexist.

### 2.4 Things We Do NOT Change

- `apps/hub-dashboard`: team9 has its own devices UI; this is unused.
- `ahandctl` (CLI): irrelevant to MVP.
- Browser automation code: when `DaemonConfig::browser_enabled = false`, browser dependencies are never initialized. playwright-cli install paths are not triggered in MVP.

### 2.5 Suggested PR Breakdown

Split the cross-repo changes into separable PRs for easier review:

1. **PR-1:** `crates/ahandd` library-ize + `DaemonHandle` API + `main.rs` shim.
2. **PR-2:** `crates/ahand-protocol` add `Heartbeat` + `crates/ahandd` heartbeat sender + hub forwards heartbeat to webhook (remove hub-side timer).
3. **PR-3:** Hub admin API (device/token) + JWT claim extensions.
4. **PR-4:** Hub control-plane REST + SSE.
5. **PR-5:** Hub webhook sender + retry queue.
6. **PR-6:** `@ahand/sdk` `CloudClient`.
7. **PR-7:** Hub deploy workflow (`.github/workflows/deploy-hub.yml` + `deploy/hub/deploy.sh` + task definition template).

---

## § 3 · Team9 Gateway Backend

### 3.1 New NestJS Module

```
apps/server/apps/gateway/src/ahand/
├── ahand.module.ts
├── ahand.controller.ts              # REST endpoints for Tauri
├── ahand-internal.controller.ts     # Internal endpoints for im-worker
├── ahand-webhook.controller.ts      # hub → gateway webhook
├── ahand.service.ts
├── ahand-hub.client.ts              # HTTP client for gateway → hub admin API
├── ahand-redis-publisher.service.ts # Publishes ahand:events:{userId} pub/sub
├── dto/
│   ├── register-device.dto.ts
│   ├── device.dto.ts
│   ├── webhook-event.dto.ts
│   └── ...
└── ahand.service.spec.ts
```

The im-worker side adds a thin `ahand-control-plane.service.ts` (calls the gateway internal API rather than duplicating hub admin logic).

### 3.2 Data Model

Add to `libs/database/schemas/im/`:

```ts
// ahand_devices.ts
export const ahandDevices = pgTable(
  "ahand_devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Polymorphic ownership: MVP writes only "user"; "workspace" is a follow-up.
    ownerType: text("owner_type").notNull(), // "user" | "workspace"
    ownerId: uuid("owner_id").notNull(), // logical FK to users.id or workspaces.id
    // ahand identity
    hubDeviceId: text("hub_device_id").notNull().unique(),
    publicKey: text("public_key").notNull(), // base64 Ed25519 pubkey
    // Metadata
    nickname: text("nickname").notNull(),
    platform: text("platform").notNull(), // "macos" | "windows" | "linux"
    hostname: text("hostname"),
    // State
    status: text("status").notNull().default("active"), // "active" | "revoked"
    lastSeenAt: timestamp("last_seen_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    revokedAt: timestamp("revoked_at"),
  },
  (t) => ({
    ownerIdx: index("ahand_devices_owner_idx").on(t.ownerType, t.ownerId),
    statusIdx: index("ahand_devices_status_idx").on(t.status),
  }),
);
```

**No `connectionState` column** — that high-frequency transient state lives in Redis.

**Polymorphism (no DB FK)** is enforced in app code: `@OnEvent("user.deleted")` / `@OnEvent("workspace.deleted")` handlers hang off the ahand module to cascade-revoke and call hub DELETE.

**Agent-available devices query** (ready for workspace support later):

```sql
SELECT * FROM ahand_devices
 WHERE status = 'active'
   AND (
        (owner_type = 'user' AND owner_id = $userId)
     OR (owner_type = 'workspace' AND owner_id = ANY($workspaceIds))
   );
```

For MVP, `$workspaceIds = []`.

### 3.3 Presence in Redis

```
KEY    ahand:device:{hubDeviceId}:presence
VALUE  "online"
TTL    Uses presenceTtlSeconds from webhook payload (daemon heartbeat × 3, default 180s)
```

**Write path (webhook handler):**

- `device.online` / `device.heartbeat` → `SET ... EX <presenceTtlSeconds>`
- `device.offline` → `DEL ...`
- `device.revoked` → `DEL ...` + UPDATE DB status='revoked'

**Read path (`GET /api/ahand/devices` and internal `listDevicesForUser`):**

```ts
const keys = devices.map((d) => `ahand:device:${d.hubDeviceId}:presence`);
const states = await redis.mget(...keys);
return devices.map((d, i) => ({ ...d, isOnline: states[i] === "online" }));
```

**DB's `last_seen_at` is updated only on `device.online` and `device.offline`** (not heartbeats) to avoid write amplification. It persists "last seen 3 days ago"–style info for the UI.

### 3.4 REST API for Tauri

All protected by `JwtAuthGuard` and scoped to the calling user.

```
POST   /api/ahand/devices
  body: { hubDeviceId, publicKey, nickname, platform, hostname }
  effect:
    1. Ensure hubDeviceId is not taken (DB + hub, bidirectional).
    2. Call hub POST /api/admin/devices to pre-register.
    3. Insert ahand_devices row (ownerType=user, ownerId=callingUserId).
    4. Call hub POST /api/admin/devices/{id}/token for an initial JWT (ttl 604800 / 7d).
    5. Return { device, deviceJwt, hubUrl, jwtExpiresAt }.

GET    /api/ahand/devices
  response: [{ id, hubDeviceId, nickname, platform, status, lastSeenAt, isOnline }]
  (isOnline comes from Redis mget.)

POST   /api/ahand/devices/{id}/token/refresh
  effect: Ownership check → hub mints a new JWT → return.
  response: { deviceJwt, jwtExpiresAt }

PATCH  /api/ahand/devices/{id}
  body: { nickname? }

DELETE /api/ahand/devices/{id}
  effect: UPDATE status='revoked' → call hub DELETE → Tauri sees the kick via WS event.
```

### 3.5 Internal API (called by im-worker)

```
POST   /internal/ahand/control-plane/token
  auth: internal service token (existing gateway ↔ im-worker mechanism)
  body: { userId, deviceId? }
  effect: Validate deviceId ownership → hub mints control-plane JWT → return.
  response: { token, expiresAt }

POST   /internal/ahand/devices/list-for-user
  auth: internal service token
  body: { userId, includeOffline?: boolean }
  effect: Query ahand_devices + Redis mget presence.
  response: [{ hubDeviceId, nickname, platform, status, isOnline, lastSeenAt, ... }]
```

### 3.6 Webhook Receiver (hub → gateway)

```
POST /api/ahand/hub-webhook
  headers: X-AHand-Signature, X-AHand-Event-Id, X-AHand-Timestamp
  auth: HMAC signature check (no JwtAuthGuard)
  effect:
    1. Verify HMAC (constant-time compare) and timestamp freshness (<5min).
    2. Redis SETNX `ahand:webhook:seen:{eventId}` TTL 600s → if seen, return 204.
    3. Route by eventType:
       - device.online / device.heartbeat → Redis SET presence EX <ttl>; on online, also
         update DB last_seen_at; publish Redis `ahand:events:{ownerId}` (for im-worker)
         + emit Socket.io (for frontend).
       - device.offline → Redis DEL presence; update DB last_seen_at; publish + emit.
       - device.revoked → Redis DEL + DB UPDATE status; publish + emit.
    4. Return 204.
```

**Socket.io emit:**

```ts
io.to(`${ownerType}:${ownerId}:ahand`).emit(eventType, payload);
// e.g. user:<uid>:ahand / workspace:<wid>:ahand (future)
```

Socket.io's Redis adapter delivers the event to the gateway replica that owns the user's socket.

**Redis pub/sub (for im-worker):**

```ts
redis.publish(`ahand:events:${ownerId}`, JSON.stringify(payload));
```

im-worker pattern-subscribes `ahand:events:*` and filters by active sessions' `callingUserId`.

### 3.7 Frontend Subscription

```ts
// On DevicesDialog mount:
wsService.emit("join_room", { room: `user:${currentUserId}:ahand` });
wsService.on("device.online", handleOnline);
wsService.on("device.offline", handleOffline);
wsService.on("device.revoked", handleRevoked);
wsService.on("device.registered", handleRegistered);

// On unmount or dialog close:
wsService.emit("leave_room", { room: `user:${currentUserId}:ahand` });
```

On Socket.io reconnect, force a `GET /api/ahand/devices` to re-sync the snapshot.

### 3.8 Failure Handling

- **Hub unreachable:** registration endpoint returns 503; the frontend toasts. A database transaction prevents half-registered state.
- **Token refresh failure:** frontend degrades to "this machine offline"; Tauri stops the daemon.
- **hubDeviceId collision:** 409. UI guides the user to "remove the old device → re-register" or to clear local identity.
- **Redis outage:** presence reads return offline (graceful degradation); no crash; ops monitors alert.
- **Webhook signature / timestamp fail:** 401, rejected.
- **Webhook processing error (DB exception):** 5xx → hub retries; idempotency comes from the Redis `webhook:seen` key.

---

## § 4 · Tauri Client — Rust Side

### 4.1 Dependencies

`apps/client/src-tauri/Cargo.toml`:

```toml
[dependencies]
ahandd = { git = "https://github.com/team9ai/ahand", package = "ahandd", tag = "rust-v0.X.Y" }
tokio = { version = "1", features = ["rt-multi-thread", "sync"] }
# existing: tauri, serde, serde_json, dirs, ...
```

Pin to a tag (not a branch) to keep MVP builds immune to upstream churn.

### 4.2 File Layout

**Delete:** `src-tauri/src/ahand.rs` (443 lines of sidecar spawn code).

**Create:**

```
src-tauri/src/ahand/
├── mod.rs              # Module exports + types
├── runtime.rs          # AhandRuntime: process singleton managing DaemonHandle lifecycle
├── identity.rs         # Identity directory resolution + ahandd::load_or_create_identity
└── commands.rs         # #[tauri::command] functions
```

### 4.3 Identity Directory (per-user isolation)

```rust
fn identity_dir(app: &tauri::AppHandle, team9_user_id: &str) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap()
        .join("ahand")
        .join("users")
        .join(team9_user_id)
        .join("identity")
}
```

We stop using `~/.ahand/` (that was the ahandctl CLI convention) to avoid conflicts in either direction.

**Multi-install identity model:** The same team9 user logging into the Tauri app on two different Macs gets **two distinct identity directories** (one per `{tauri_app_data_dir}/ahand/users/{userId}/` on each Mac) → two distinct Ed25519 keypairs → two distinct `hubDeviceId`s. They appear as two rows in `ahand_devices` with the same `owner_id`. Conversely, two different team9 users on the same Mac get two separate identity directories under the same app data root → also two distinct devices. Identity is bound to `(app install, team9 user)`, never shared.

### 4.4 AhandRuntime Singleton

```rust
pub struct AhandRuntime {
    state: Mutex<Option<ActiveSession>>,
    status_tx: watch::Sender<DaemonStatus>,
}

struct ActiveSession {
    handle: ahandd::DaemonHandle,      // In-process task handle, NOT a Child process
    team9_user_id: String,
    hub_device_id: String,
    status_forwarder: JoinHandle<()>,  // Forwards lib status to Tauri events
}

impl AhandRuntime {
    pub async fn start(&self, app: &AppHandle, cfg: StartConfig) -> Result<StartResult>;
    pub async fn stop(&self) -> Result<()>;       // Internally: handle.shutdown().await
    pub fn status(&self) -> DaemonStatus;
    pub fn current_device_id(&self) -> Option<String>;
}
```

**Lifecycle rules:**

- At most one active daemon at a time; `start` first stops any predecessor.
- Logout or app exit → auto `stop()`.
- Event-driven JWT refresh (§ 4.6) triggers `stop()` + `start()`.

**Key point: no external process.** `ahandd::spawn` runs a task on Tauri's tokio runtime and returns a `DaemonHandle` (`JoinHandle` + status watch + shutdown sender). There is no `std::process::Child`.

### 4.5 Tauri Commands

```rust
#[tauri::command]
pub fn ahand_get_identity(team9_user_id: String) -> Result<IdentityDto>;
// Returns { deviceId, publicKeyB64 }. Idempotent: reads if exists, creates otherwise.

#[tauri::command]
pub async fn ahand_start(
    team9_user_id: String,
    hub_url: String,
    device_jwt: String,
    jwt_expires_at: u64,
) -> Result<()>;

#[tauri::command]
pub async fn ahand_stop() -> Result<()>;

#[tauri::command]
pub fn ahand_status() -> DaemonStatus;
```

**Status events:** AhandRuntime spawns an internal task subscribing to `DaemonHandle::subscribe_status()`, emitting `app.emit("ahand-daemon-status", status)` on every change. Local online/offline state flows through this path with zero hub involvement.

### 4.6 JWT Management (event-driven)

**Key insight:** A WebSocket's JWT is verified only at handshake. Once the connection is open, the hub does not re-validate the token per frame. Therefore:

| Scenario                                                | Needs fresh JWT? |
| ------------------------------------------------------- | ---------------- |
| JWT expires while connected                             | ❌ irrelevant    |
| ahand lib's internal reconnect (cached JWT still valid) | ❌ reuse cache   |
| Reconnect when cached JWT has expired                   | ✅ refresh       |
| User disables → re-enables                              | ✅ clean restart |

**Refresh flow:**

```
ahand lib internal reconnect fails (hub returns 401-like):
  └─ emits status = DaemonStatus::Error { kind: Auth, .. }
     └─ AhandRuntime forwards to Tauri event "ahand-daemon-status"
        └─ TS handler:
           1. POST /api/ahand/devices/:id/token/refresh
           2. invoke("ahand_start", { ..., device_jwt: newJwt })
        └─ Lib reconnects with the new JWT → status = Online
```

**JWT TTL:** 7 days (covers Mac sleep / network flakes; keeps gateway QPS down). Control-plane JWTs stay short at 1h.

**The daemon lib must expose** the error kind so Tauri can discriminate `Auth` / `Network` / `Other` (see § 2.1 `ErrorKind`). Tauri triggers refresh only for `Auth`; `Network` is left to the lib's internal retry.

### 4.7 Allow/Disallow Persistence

Tauri settings (`@tauri-apps/plugin-store`) gain a per-team9-user record:

```json
{
  "ahand": {
    "usersEnabled": {
      "<team9UserId>": {
        "enabled": true,
        "deviceId": "<hubDeviceId-cached>"
      }
    }
  }
}
```

- Enable → mint identity + call gateway to register (if no cache) or refresh token (if cached) → `ahand_start`.
- Disable → `ahand_stop`. The device record is not deleted; re-enabling later is instant.
- Explicit "Remove this device" → gateway DELETE + clear local identity + clear Tauri store.

### 4.8 Login/Logout Hooks

At the `_authenticated.tsx` layer:

```ts
onMount:
  if usersEnabled[currentUserId]?.enabled:
    await ensureStarted(currentUserId);

onLogout:
  await invoke("ahand_stop");
```

Switching workspace does not affect ahand (devices are bound to user, not workspace).

### 4.9 Heartbeat Interval

`DaemonConfig::heartbeat_interval = Duration::from_secs(60)`. Hardcoded in Tauri for MVP; per-device override can come later if a use case appears.

### 4.10 Private Key Storage Decision

**Plaintext file + 0600 permissions + FileVault reliance + one-click revocation.** No active encryption.

**Rationale:**

1. If an attacker has code execution as this user, they can hook the process and recover the decrypted key anyway. Encryption provides little additional security.
2. Encryption only helps in narrow scenarios (Time Machine exports, compromised iCloud sync), and FileVault largely covers those on user Macs.
3. Encryption increases cross-platform complexity (Keychain / DPAPI / libsecret triplicate).
4. Revocation is cheap: `gateway DELETE` → hub rejects that deviceId → the key becomes worthless.
5. Industry precedent matches (SSH private keys, Tailscale, Slack tokens).

**Follow-up:** If a security review requires it, store the Ed25519 key in macOS Keychain Services (optionally Secure Enclave-backed).

### 4.11 Error Classification

| Error                   | Rust handling                                   | UI                    |
| ----------------------- | ----------------------------------------------- | --------------------- |
| `ahandd::spawn` failure | `AhandRuntime.start` returns error              | Toast + Retry         |
| JWT rejected by hub     | status=Error(Auth) → TS triggers refresh        | Auto-retry once       |
| Hub unreachable         | ahand lib retries internally, status=Connecting | "Connecting…"         |
| Identity file corrupt   | Don't auto-regenerate; return error             | "Reset device" dialog |

---

## § 5 · Tauri / Web UI

### 5.1 Entry: Button Above Avatar in MainSidebar

Insert a button above the avatar `<div data-tauri-drag-region className="shrink-0 py-4">` in `MainSidebar.tsx`:

```tsx
<Tooltip>
  <TooltipTrigger asChild>
    <button
      onClick={() => setDevicesDialogOpen(true)}
      className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-nav-hover-strong relative"
    >
      <Laptop size={18} />
      <div
        className={cn(
          "absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-nav-bg",
          getAhandStatusColor(ahandLocalStatus),
        )}
      />
    </button>
  </TooltipTrigger>
  <TooltipContent side="right">
    <p>{tAhand("myDevices")}</p>
    <p className="text-xs text-muted-foreground">
      {getAhandStatusLabel(ahandLocalStatus)}
    </p>
  </TooltipContent>
</Tooltip>
```

**Status dot colors:**

- **Tauri mode:** `online=green` / `offline=gray` / `connecting=amber (blink)` / `error=red` / `disabled=dim-gray hollow`. Source: the Tauri event emitted from `DaemonHandle::subscribe_status()`.
- **Web mode:** aggregate state — green if any device is online, gray if none or zero devices.

### 5.2 `DevicesDialog` Component

Replaces the old `AHandSetupDialog`. Location: `components/dialog/DevicesDialog.tsx`.

Environment check: `isTauriApp() = "__TAURI_INTERNALS__" in window`.

### 5.3 Tauri Mode Layout

```
┌────────────────────────────────────────────┐
│  My Devices                            [×] │
├────────────────────────────────────────────┤
│  ▶ This Mac                                │
│  ╭──────────────────────────────────────╮  │
│  │ ● Online                              │  │
│  │ Alice's MacBook Pro  [✎]             │  │
│  │ macOS · last active just now          │  │
│  │ SHA256: 3f2a4b...                    │  │
│  │                                       │  │
│  │ [━━━━━━━━━] Allow as agent target     │  │
│  │                                       │  │
│  │ Remove this device                    │  │
│  ╰──────────────────────────────────────╯  │
│                                            │
│  ▶ My Other Devices (2)                    │
│  ╭──────────────────────────────────────╮  │
│  │ ● Office iMac        macOS           │  │
│  │   last active 3h ago   [Remove]       │  │
│  ├──────────────────────────────────────┤  │
│  │ ○ Windows Workstation windows         │  │
│  │   last active 2d ago   [Remove]       │  │
│  ╰──────────────────────────────────────╯  │
│                                            │
│  When an agent runs tasks, it can use      │
│  your enabled devices' shell. Learn more → │
└────────────────────────────────────────────┘
```

### 5.4 "This Mac" State Machine

| State                             | Display                                   | Toggle behavior                      |
| --------------------------------- | ----------------------------------------- | ------------------------------------ |
| Never registered                  | "Not connected" + toggle OFF              | Turn ON → register + start           |
| Registered + enabled + online     | "● Online" + toggle ON                    | Turn OFF → local stop (no revoke)    |
| Registered + enabled + connecting | "⟳ Connecting…" + toggle ON (disabled 3s) | Turn OFF → abort                     |
| Registered + enabled + error      | "✕ Error: [reason]" + Retry button        | Turn OFF / Retry                     |
| Registered + disabled             | "Disabled" + toggle OFF                   | Turn ON → start with cached deviceId |
| Revoked                           | Disappears from list                      | N/A                                  |

### 5.5 Registration Flow (first allow)

```
UI: toggle loading "Registering…"
  ├─ invoke("ahand_get_identity", { team9_user_id })
  │    → { deviceId, publicKeyB64 }
  ├─ POST /api/ahand/devices
  │    body: { hubDeviceId, publicKey, nickname, platform, hostname }
  │    → { device, deviceJwt, hubUrl, jwtExpiresAt }
  ├─ Write Tauri store: ahand.usersEnabled[userId] = { enabled: true, deviceId }
  ├─ invoke("ahand_start", { team9_user_id, hub_url, device_jwt, jwt_expires_at })
  └─ Wait for status event → online → UI turns green

Failure path (any step):
  ├─ UI shows error toast
  ├─ Roll back: toggle returns to OFF
  └─ Do not write store
```

### 5.6 JWT Refresh — UI-transparent

```
On ahand-daemon-status with reason="jwt_expired":
  UI dot turns amber (connecting); no dialog popup
  └─ TS auto-POSTs /api/ahand/devices/:id/token/refresh
     └─ success: invoke("ahand_start", newJwt) → online
     └─ failure: state → error; toast "Please log in again"
```

### 5.7 "Other Devices" List

- Data source: `GET /api/ahand/devices` minus the current machine's deviceId.
- Real-time updates: subscribed to Socket.io room `user:{userId}:ahand`; `device.*` events patch local state.
- Force `GET` when the dialog opens and whenever Socket.io reconnects.

### 5.8 Remove Action

```
Click → confirm dialog "Remove XX? Any signed-in instance on that device will disconnect."
  → DELETE /api/ahand/devices/:id
  → gateway: status=revoked, call hub DELETE
  → hub: forcibly close the device WS + emit device.revoked webhook
  → If the current machine: Tauri sees status=error (kicked) via WS
    → auto stop daemon + clear local identity + clear store enabled
  → If another machine: webhook-driven Socket.io event syncs all clients' lists.
```

### 5.9 Empty State

```
┌────────────────────────────────────────────┐
│  My Devices                            [×] │
├────────────────────────────────────────────┤
│            🖥                              │
│         No devices connected                │
│                                            │
│  Enable this Mac to let agents run shell   │
│  commands on it to help you get things     │
│  done.                                     │
│                                            │
│         ╭──────────────────╮               │
│         │ Allow this Mac    │              │
│         ╰──────────────────╯               │
└────────────────────────────────────────────┘
```

### 5.10 i18n

New resource file `i18n/locales/*/ahand.json` across all supported locales. Keys include: `myDevices`, `allowLocalDevice`, `thisDevice`, `otherDevices`, `remove`, `confirmRemove`, `registering`, `connecting`, `online`, `offline`, `disabled`, `error.jwtExpired`, `error.hubUnavailable`, `ctaTitle`, `ctaBody`, `ctaPrimaryAction`, `ctaSecondaryAction`, `noAppInstalledHint`, etc.

### 5.11 Web Mode Differences

```
┌────────────────────────────────────────────┐
│  My Devices                            [×] │
├────────────────────────────────────────────┤
│  ╭──────────── CTA Card ───────────────╮  │
│  │  ⚡ Let agents take over your machine │  │
│  │                                      │  │
│  │  Use the Team9 desktop app to turn   │  │
│  │  this computer into your agent's     │  │
│  │  remote execution arm — at near-     │  │
│  │  zero cost.                          │  │
│  │                                      │  │
│  │  [Open Desktop App]  [Download App]  │  │
│  ╰──────────────────────────────────────╯  │
│                                            │
│  ▶ My Devices (2)                          │
│  ╭──────────────────────────────────────╮  │
│  │ ● Alice's MacBook Pro  macOS         │  │
│  │ ○ Office iMac          macOS         │  │
│  ╰──────────────────────────────────────╯  │
└────────────────────────────────────────────┘
```

**"Open Desktop App" deep link:**

Register scheme in `tauri.conf.json`:

```json
{
  "plugins": {
    "deep-link": { "schemes": ["team9"] }
  }
}
```

`team9://devices` launches or focuses the Tauri app and routes to the devices page.

Web-side click handler:

```ts
function openDesktopApp() {
  const start = Date.now();
  window.location.href = "team9://devices";
  setTimeout(() => {
    if (Date.now() - start < 800 && !document.hidden) {
      toast.info(t("ahand.noAppInstalledHint"));
    }
  }, 500);
}
```

**"Download Desktop App":**

```ts
function getDesktopDownloadUrl() {
  const ua = navigator.userAgent;
  if (/Mac/.test(ua)) return "https://team9.ai/download/mac";
  if (/Win/.test(ua)) return "https://team9.ai/download/windows";
  if (/Linux/.test(ua)) return "https://team9.ai/download/linux";
  return "https://team9.ai/download";
}
```

Exact URLs to be finalized against team9's actual download page at integration time.

### 5.12 Non-functional Requirements

- **Accessibility:** toggle uses `role="switch"` + `aria-checked`; status dot has `aria-label`; Tab order is reasonable.
- **i18n:** all strings via i18n; relative time via `date-fns` locale-aware `formatDistanceToNow`.
- **Loading state:** skeleton rows while the list is loading.

---

## § 6 · Agent Runtime / claw-hive Integration

### 6.1 HostComponent Multi-backend Extension (framework change)

Today, `HostComponent` in `@team9claw/agent-components` holds a single backend (`this.backend`). To have multiple ahand devices co-exist with just-bash and e2b-sandbox as siblings, we extend the framework.

**Changes to `packages/agent-components/src/components/host/host-component.ts`:**

```ts
// Before:
this.backend: IHostBackend | null = null;
registerBackend: (backend) => { this.backend = backend; }

// After:
this.backends: Map<string, IHostBackend> = new Map();      // key: backend.type
registerBackend: (backend) => {
  this.backends.set(backend.type, backend);
  // Re-registering the same type overwrites (handles reconnect).
}
unregisterBackend: (type: string) => {
  this.backends.delete(type);
}
```

**Tool strategy — single tool + optional `backend` param with sticky last-used:**

```ts
{
  name: "run_command",
  parameters: {
    backend: {
      type: "string",
      description: "Which execution environment. See registered backends in "
                 + "<host-context>. Omit to reuse the backend from your previous "
                 + "run_command call. Invalid values will be rejected at runtime.",
      // No enum — keeps tool schema stable across device join/leave events (cache-friendly).
    },
    command: { type: "string", required: true },
    // ...existing fields: description, timeoutMs, async, cwd, notifyOnComplete
  }
}
```

**Resolution order (inside HostComponent):**

```
resolveBackend(args.backend):
  1. Explicit backend → use it + set lastUsedBackend = it
  2. Omitted && exactly 1 registered → auto-use (don't change lastUsedBackend)
  3. Omitted && lastUsedBackend exists and still registered → use it
  4. Omitted && lastUsedBackend missing → throw "Please specify the `backend` parameter. Registered: [...]"
```

`lastUsedBackend` is stored in `HostComponentData` for session-resume continuity.

**Auto-reset:**

- When the backend behind `lastUsedBackend` is unregistered (e.g., device goes offline), it's cleared; next `run_command` must specify `backend`.
- Session change → ComponentData resets; `lastUsedBackend` naturally clears.

**Tool result echoes backend** so the LLM can always see which environment just ran its command (append-only cache-friendly signal):

```json
{
  "jobId": "...",
  "state": "completed",
  "backend": "ahand:user-computer:abc123",
  "stdout": "...",
  "exitCode": 0,
  ...
}
```

**`IHostBackend` metadata extension:**

```ts
interface IHostBackend {
  readonly type: string;
  ensureReady(agentId: string): Promise<void>;
  spawn(...): Promise<ProcessHandle>;
  readFile(...): Promise<...>;
  writeFile(...): Promise<...>;
  listDir(...): Promise<...>;
  checkProcess(ref): Promise<ProcessStatus>;
  killProcess(ref, signal): Promise<void>;
  // NEW, optional:
  getMetadata?(): HostBackendMetadata;
}

interface HostBackendMetadata {
  displayName?: string;        // "Alice's MacBook Pro"
  platform?: string;           // "macos" | "linux" | "windows" | "local-bash" | "sandbox"
  isCurrentDevice?: boolean;   // User's currently-used device
  statusLine?: string;         // e.g. "online, last heartbeat 2s ago"
}
```

`HostComponent`'s cache-system provider renders a `<host-context>` block aggregating each backend's metadata:

```xml
<host-context refreshed-at="2026-04-22T10:30:12Z">
  <backend type="just-bash" platform="local-bash"/>
  <backend type="ahand:user-computer:abc123"
           display-name="Alice's MacBook Pro"
           platform="macos"
           is-current-device="true"
           status-line="online, last heartbeat 3s ago"/>
  <backend type="ahand:user-computer:def456"
           display-name="Office iMac"
           platform="macos"
           status-line="online, last heartbeat 12s ago"/>
</host-context>
```

This multi-backend extension is **general-purpose framework machinery**, benefiting just-bash and e2b-sandbox equally. When a blueprint registers only one backend, the sticky-single-backend auto-selection keeps existing behavior unchanged (zero breaking change).

### 6.2 CacheSystemContextProvider (framework change)

The framework currently uses `onBeforePrompt` for context injection, rebuilt every turn. Expensive or stable content (device lists, permissions, platform metadata) causes prompt-cache invalidation when injected per-turn. Add a cache-aware alternative.

**New optional hook on components:**

```ts
// packages/types/src/component.ts
export interface CacheSystemContextProvider {
  /** Namespace key, stable across sessions. Refresh tools invalidate by this key. */
  readonly cacheKey: string;

  /** Return the current dependency snapshot. Framework compares with the prior
   *  snapshot; skip render() if unchanged. */
  getCacheDependencies(
    ctx: ComponentContext<any, any>,
  ): Promise<Record<string, unknown>>;

  /** Called only on cache miss. Returns an XML string block. */
  render(ctx: ComponentContext<any, any>): Promise<string>;
}

interface IComponent {
  // ... existing hooks
  getCacheSystemProviders?(): CacheSystemContextProvider[];
}
```

**Per-session cache store** (framework-owned):

```ts
sessionCache: Map<
  cacheKey,
  {
    deps: Record<string, unknown>;
    rendered: string;
    renderedAt: Date;
  }
>;
```

**Invalidation rules:**

| Event                                        | Action                                                  |
| -------------------------------------------- | ------------------------------------------------------- |
| First `onBeforePrompt` (empty cache)         | All providers render; populate cache                    |
| Subsequent `onBeforePrompt`                  | For each provider: read deps; compare; reuse or rebuild |
| `onSessionStart` (incl. resume from storage) | Clear cache → rebuild next turn                         |
| Compact event                                | Clear cache → rebuild next turn                         |
| `cacheInvalidator.invalidate(cacheKey?)`     | Clear specified key (or all)                            |

`getCacheDependencies` is cheap and called every turn; `render()` runs only on miss — this is the performance win.

**Priority-based interleaving:** Each `CacheSystemContextProvider`'s XML fragment is inserted by its owning component's `priority`, alongside normal `onBeforePrompt` context injections. There is no dedicated `<cache-system>` wrapper; providers produce their own top-level blocks such as `<host-context>` or `<ahand-context>`.

Because Anthropic's prompt cache is a greedy prefix cache, blueprint authors should put stable high-value content at high priority and dynamic content at low priority to maximize hit rate. The framework does not enforce this, but tooling can lint it.

**Framework sketch:**

```ts
// ComponentRunner or AgentSession layer:
async buildSystemPrompt(ctx): Promise<string> {
  const parts: Array<{ priority: number; content: string }> = [];

  for (const component of componentsSortedByPriority) {
    // Cache-system providers (if any)
    for (const provider of (component.getCacheSystemProviders?.() ?? [])) {
      const content = await this.resolveCached(provider, ctx);
      parts.push({ priority: component.priority, content });
    }
    // Normal onBeforePrompt injection
    const dynamic = await component.onBeforePrompt?.(ctx, ...);
    if (dynamic?.contextInjection) {
      parts.push({ priority: component.priority, content: dynamic.contextInjection });
    }
    if (dynamic?.invalidateCache) {
      // Apply invalidation (next-turn or force-now)
    }
  }

  return parts
    .sort((a, b) => b.priority - a.priority)
    .map(p => p.content)
    .join("\n\n");
}
```

**Unified refresh control through `onBeforePrompt`:**

```ts
interface BeforePromptResult {
  contextInjection?: string;
  transformedMessages?: Message[];
  // NEW:
  invalidateCache?: {
    keys: string[];
    mode?: "next-turn" | "force-now"; // default "next-turn"
  };
}
```

- `next-turn`: clear before the next `onBeforePrompt`; current turn uses cached content.
- `force-now`: clear immediately; the current prompt uses freshly rendered content.

**Refresh tool unified at framework level:**

```ts
{
  name: "refresh_context",
  description: "Force-refresh cached system context blocks. Use when you suspect "
             + "the cached information (devices, permissions, backends) is stale.",
  parameters: {
    cacheKey: {
      type: "string",
      description: "Specific cache key to invalidate. Omit to refresh all.",
    }
  },
  execute: async ({ args }) => {
    await ctx.cacheInvalidator.invalidate(args.cacheKey);
    return { refreshed: true, cacheKey: args.cacheKey ?? "all" };
  }
}
```

Agents call `refresh_context(cacheKey?)`; framework clears the specified cache, next turn rebuilds.

### 6.3 AHand Components in claw-hive

Add a new component directory:

```
team9-agent-pi/packages/claw-hive/src/components/ahand/
├── component.ts                  # AHandHostComponent (IHostBackend)
├── component.test.ts
├── context-provider.ts           # AHandContextProvider (CacheSystemContextProvider)
├── context-provider.test.ts
├── control-plane-client.ts       # Wraps @ahand/sdk CloudClient
├── control-plane-client.test.ts
└── index.ts
```

Two components:

- **`AHandHostComponent`** — one instance per online device. Registers as an `IHostBackend` with `type = "ahand:user-computer:{deviceId}"`.
- **`AHandContextProvider`** — one instance per session. Contributes `<ahand-context>` (permissions, offline devices, calling client) via the `CacheSystemContextProvider` hook.

### 6.4 `AHandHostComponent`

```ts
export class AHandHostComponent
  extends BaseComponent<AHandHostComponentConfig, AHandHostComponentData>
  implements IHostBackend
{
  readonly type: string; // set in constructor to "ahand:user-computer:{deviceId}"
  readonly dependencies = ["host"] as const;
  private cloud: CloudClient;

  constructor(config: AHandHostComponentConfig, id?: string) {
    super({
      typeKey: "ahand-host",
      name: "aHand Host",
      priority: -40,  // above e2b-sandbox (-70), below just-bash (0)
      initialData: {},
    }, config, id);
    this.type = `ahand:user-computer:${config.deviceId}`;
  }

  override async onInitialize(ctx) {
    this.cloud = new CloudClient({
      hubUrl: this.config.hubUrl,
      getAuthToken: () => this.getOrRefreshControlPlaneJwt(),
    });
    ctx.getDependency<HostDependencyApi>("host")?.registerBackend(this);
  }

  getMetadata(): HostBackendMetadata {
    return {
      displayName: this.config.deviceNickname,
      platform: this.config.devicePlatform,
      isCurrentDevice:
        this.config.callingClient.kind === "macapp" &&
        this.config.callingClient.deviceId === this.config.deviceId,
      statusLine: /* computed from latest status; see note below */,
    };
  }

  async spawn(agentId, command, options?): Promise<ProcessHandle> {
    const deviceId = this.config.deviceId;
    const { exitCode, durationMs } = await this.cloud.spawn({
      deviceId,
      command,
      cwd: options?.cwd,
      envs: options?.envs,
      onStdout: chunk => this.accumStdout(agentId, chunk),
      onStderr: chunk => this.accumStderr(agentId, chunk),
    });
    const execId = crypto.randomUUID();
    this.execResults.set(execId, {
      stdout: this.getStdout(agentId),
      stderr: this.getStderr(agentId),
      exitCode,
    });
    return {
      ref: { type: this.type, agentId, execId },
      stdout: this.getStdout(agentId),
      stderr: this.getStderr(agentId),
      exited: true,
      exitCode,
    };
  }

  // readFile / writeFile / listDir throw with a clear message in MVP:
  async readFile(agentId, path) {
    throw new Error(
      "ahand backend: readFile not supported in MVP. " +
      "Use `run_command` with `cat` or similar for now."
    );
  }
  // (similar for writeFile/listDir)

  private async getOrRefreshControlPlaneJwt(): Promise<string> {
    if (this.data.controlPlaneToken &&
        this.data.controlPlaneToken.expiresAt > Date.now() + 60_000) {
      return this.data.controlPlaneToken.value;
    }
    const resp = await this.gatewayClient.post(
      "/internal/ahand/control-plane/token",
      { userId: this.config.callingUserId },
    );
    this.setData({
      controlPlaneToken: { value: resp.token, expiresAt: resp.expiresAt },
    });
    return resp.token;
  }
}
```

**Config (set at session start by the im-worker blueprint builder):**

```ts
interface AHandHostComponentConfig {
  deviceId: string; // hub deviceId
  deviceNickname: string;
  devicePlatform: string;
  callingUserId: string;
  callingClient:
    | {
        kind: "macapp";
        deviceId: string;
        deviceNickname: string;
        isAhandEnabled: boolean;
      }
    | { kind: "web" };
  gatewayInternalUrl: string;
  gatewayInternalAuthToken: string;
  hubUrl: string;
}
```

**Data (session-mutable):**

```ts
interface AHandHostComponentData {
  controlPlaneToken: { value: string; expiresAt: number } | null;
  // Per-agentId execution result cache for checkProcess idempotency (like JustBash)
  execResults?: Map<
    string,
    { stdout: string; stderr: string; exitCode: number }
  >;
}
```

**Why `priority: -40`?** just-bash is the cheapest default (priority 0); ahand is the user's real machine (intent signal stronger than "run it in a sandbox"); e2b-sandbox is the fallback (-70). Blueprints can override per use case.

### 6.5 `AHandContextProvider`

Contributes `<ahand-context>` via the cache-system hook. Not an IHostBackend. One instance per session regardless of device count.

```ts
export class AHandContextProvider extends BaseComponent<...>
  implements CacheSystemContextProvider {
  readonly cacheKey = "ahand-context";

  getCacheSystemProviders() { return [this]; }

  async getCacheDependencies(ctx) {
    const devices = await this.listAllDevices();
    return {
      devicesSig: devices.map(d => `${d.hubDeviceId}:${d.isOnline}`).sort().join(","),
      client: this.config.callingClient.kind + ":" +
              (this.config.callingClient.kind === "macapp"
                ? this.config.callingClient.deviceId : ""),
      permsVersion: this.config.permissionsVersion ?? "v1",
    };
  }

  async render(ctx): Promise<string> {
    const devices = await this.listAllDevices();
    const cc = this.config.callingClient;
    const refreshedAt = new Date().toISOString();
    return `
<ahand-context refreshed-at="${refreshedAt}">
  <platform kind="${cc.kind}"${cc.kind === "macapp" ? ` current-device-id="${cc.deviceId}"` : ""}/>
  <permissions session-mode="auto_accept">
    <feature name="shell" allowed="true"/>
    <feature name="browser" allowed="false" reason="disabled in MVP"/>
    <feature name="file" allowed="false" reason="disabled in MVP"/>
  </permissions>
  <devices>
    ${devices.map(d => `<device
        id="${d.hubDeviceId}"
        nickname="${xmlEscape(d.nickname)}"
        platform="${d.platform}"
        status="${d.isOnline ? "online" : "offline"}"
        is-current="${cc.kind === "macapp" && cc.deviceId === d.hubDeviceId}"/>`).join("\n    ")}
  </devices>
  <refresh-instructions>
    Call \`ahand.list_devices\` for live device status, or \`refresh_context\`
    with cacheKey="ahand-context" to rebuild this block next turn.
    Last refreshed at ${refreshedAt}.
  </refresh-instructions>
</ahand-context>`.trim();
  }
}
```

Division of responsibility:

- `<host-context>` (HostComponent): per-backend dispatch metadata — who's available RIGHT NOW as an execution target.
- `<ahand-context>` (AHandContextProvider): calling-client info, permissions, the superset including offline devices, refresh instructions.

### 6.5.1 Backend Selection Strategy (blueprint-level prompt guidance)

The framework (HostComponent multi-backend + sticky + metadata) provides the **mechanism** for an agent to pick among backends. How the LLM should **decide** is a blueprint-level prompt concern. For blueprints that include ahand, the system prompt (or persona injection) should codify the following decision tree so behavior is consistent across agents:

1. **If only 1 backend is available** (e.g., just-bash alone, or one ahand device alone), use it. Do not ask the user.
2. **If multiple backends are available:**
   - If `<ahand-context>` shows a device with `is-current="true"` AND it's online AND the task clearly fits a real-machine context (e.g., "run on my computer"), prefer that device without asking.
   - If the task is clearly sandbox-appropriate (throwaway scripts, transient computation), prefer `just-bash` or `e2b-sandbox` without asking.
   - If ambiguous (e.g., "find a file", "install a package"), ask the user which environment to use. Present the options in natural language (not raw backend types).
3. **After the first `run_command`,** rely on sticky behavior — don't re-ask unless the task context shifts (e.g., user says "now do X on my iMac instead").
4. **If the selected backend fails** (offline, rejected, error), tell the user and optionally call `ahand.list_devices` to confirm fresh state before proposing alternatives.

This is intentionally **not enforced by code** — blueprint designers need flexibility to tune wording and edge cases. But the spec encodes this as the default norm, and per-blueprint overrides should justify deviation.

### 6.6 Control-plane Integration (α + β pair)

#### α — hub control-plane endpoints (server-side)

Defined in § 2.2.3. Summary: `POST /api/control/jobs`, `GET /api/control/jobs/{id}/stream` (SSE), `POST /api/control/jobs/{id}/cancel`, `GET /api/control/devices?externalUserId=...`.

#### β — `@ahand/sdk` `CloudClient` (client-side)

Defined in § 2.3. β depends on α — both live in the ahand repo and ship together.

#### control-plane JWT acquisition

team9 gateway exposes `POST /internal/ahand/control-plane/token` (§ 3.5). `AHandHostComponent` uses a callback to obtain tokens lazily and cache with a 60s safety margin (see `getOrRefreshControlPlaneJwt` in § 6.4).

### 6.7 Ahand-specific Tools

Beyond the generic `run_command` / `read_file` / ... that `HostComponent` owns, `AHandHostComponent` contributes:

#### `ahand.list_devices`

Live query bypassing the cached `<ahand-context>`, including offline devices:

```ts
{
  name: "ahand.list_devices",
  description:
    "List the user's remote machines (ahand), including offline ones. "
    + "Returns live data (bypasses the cached <ahand-context>). Use this when "
    + "you suspect the context is stale, or when you need offline devices too.",
  parameters: {
    type: "object",
    properties: {
      includeOffline: {
        type: "boolean",
        description: "Include offline devices. Default: true.",
      },
    },
  },
  execute: async ({ args }) => {
    const devices = await this.gatewayClient.listDevicesForUser(
      this.config.callingUserId,
      { includeOffline: args.includeOffline ?? true },
    );
    return textResult({
      devices: devices.map(d => ({
        backendType: `ahand:user-computer:${d.hubDeviceId}`,
        hubDeviceId: d.hubDeviceId,
        nickname: d.nickname,
        platform: d.platform,
        status: d.isOnline ? "online" : "offline",
        lastSeenAt: d.lastSeenAt,
        isCurrentDevice:
          this.config.callingClient.kind === "macapp" &&
          this.config.callingClient.deviceId === d.hubDeviceId,
      })),
      refreshedAt: new Date().toISOString(),
    });
  },
}
```

`backendType` is returned as a ready-to-use string — the LLM passes it directly to `run_command({ backend, command })` without string-concatenation guesswork.

#### `refresh_context`

Handled by the framework-level unified tool described in § 6.2. No ahand-specific wrapper is needed if the framework provides it; otherwise, a thin ahand-specific wrapper lives here as fallback.

#### Tools NOT exposed in MVP (follow-up)

- `ahand.request_device(deviceId, reason)` — the future approval-flow trigger.
- `ahand.browser.*` — browser automation.
- `ahand.read_file` / `ahand.write_file` — remote file ops via HostComponent's generic tools once feature is enabled.

### 6.8 Gateway-side Orchestration

#### 6.8.1 clientContext on message send

Tauri and Web attach a `clientContext` field when sending an IM message:

```ts
wsService.emit("send_message", {
  channelId,
  content,
  // ...
  clientContext: isTauriApp()
    ? {
        kind: "macapp" as const,
        deviceId: ahandLocalDeviceId ?? null, // null if user has not enabled ahand on this Mac
      }
    : { kind: "web" as const },
});
```

Server-side, `messages` table gains a `client_context jsonb` column (small schema addition; otherwise embed into the existing `metadata jsonb`).

im-worker's gRPC forwarder propagates `clientContext` in the message envelope.

#### 6.8.2 Blueprint injection

im-worker's agent-session builder:

```ts
async buildBlueprint(channel, triggeringMessage, callingUser): Promise<Blueprint> {
  const blueprint = await this.resolveBlueprint(channel);

  if (blueprint.components.some(c => c.typeKey === "host")) {
    const devices = await this.ahandDeviceService.listActiveDevicesForUser(callingUser.id);
    const onlineDevices = devices.filter(d => d.isOnline);
    const clientContext = this.buildClientContext(triggeringMessage, devices);

    // One AHandHostComponent per online device
    for (const device of onlineDevices) {
      blueprint.components.push({
        typeKey: "ahand-host",
        config: {
          deviceId: device.hubDeviceId,
          deviceNickname: device.nickname,
          devicePlatform: device.platform,
          callingUserId: callingUser.id,
          callingClient: clientContext,
          gatewayInternalUrl: env.GATEWAY_INTERNAL_URL,
          gatewayInternalAuthToken: env.INTERNAL_SERVICE_TOKEN,
          hubUrl: env.AHAND_HUB_URL,
        },
      });
    }

    // Single AHandContextProvider regardless of device count
    blueprint.components.push({
      typeKey: "ahand-context-provider",
      config: {
        callingUserId: callingUser.id,
        callingClient: clientContext,
        gatewayInternalUrl: env.GATEWAY_INTERNAL_URL,
        gatewayInternalAuthToken: env.INTERNAL_SERVICE_TOKEN,
      },
    });
  }

  return blueprint;
}

private buildClientContext(msg, allDevices): ClientContext {
  const cc = msg.clientContext;
  if (cc?.kind !== "macapp" || !cc.deviceId) return { kind: "web" };
  const device = allDevices.find(d => d.hubDeviceId === cc.deviceId);
  if (!device) return { kind: "web" };     // claimed deviceId not owned by user → treat as web
  return {
    kind: "macapp",
    deviceId: device.hubDeviceId,
    deviceNickname: device.nickname,
    isAhandEnabled: device.status === "active" && device.isOnline,
  };
}
```

#### 6.8.3 Dynamic device lifecycle (during running sessions)

Agent sessions may live minutes to hours; devices can come online or go offline mid-session.

**Approach: Redis pub/sub from gateway to im-worker.**

- Gateway, on receiving a hub webhook, publishes to `ahand:events:{ownerId}`.
- im-worker pattern-subscribes `ahand:events:*` and dispatches to active sessions whose `callingUserId` matches.
- On `device.online` / `device.registered` (owned by user) → find all active sessions for that user → `AgentSession.addComponent` a new `AHandHostComponent` for the new device.
- On `device.offline` / `device.revoked` → `AgentSession.removeComponent` for matching backend + invalidate `<ahand-context>` + `<host-context>` caches.

**Framework prerequisite:** `AgentSession.addComponent(factory, config)` and `removeComponent(componentId)`. Depending on whether `team9-agent-pi` already has this:

- **If present:** use it directly.
- **If absent (MVP fallback):** snapshot the device set at session start; new/removed devices only take effect in the next session. The `<ahand-context>` block should annotate "this snapshot was taken N minutes ago; call refresh_context or start a new conversation if things changed."

**clientContext propagation for follow-up messages:** On receiving a new user message whose `clientContext` differs from the session's cached copy, `AHandContextProvider` detects the diff and invalidates the `ahand-context` cache for the next prompt. team9-agent-pi needs an `onMessageReceived` hook (check existing API).

#### 6.8.4 Multi-replica safety

Both gateway and im-worker run multi-replica. Redis pub/sub pattern-subscribe handles fan-out — each replica of im-worker receives the same event and dispatches only to sessions it owns locally. Redis's Socket.io adapter handles frontend fan-out (see § 3.6).

### 6.9 Errors & Observability

| Layer            | Scenario                                      | `AHandHostComponent` action                                                | LLM sees                                                                   |
| ---------------- | --------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **Auth**         | Control-plane JWT expired                     | `getAuthToken` auto-refreshes; refresh failure → tool error                | "Authentication failed, please try again"                                  |
| **Auth**         | JWT rejected by hub (revoked / bad signature) | No retry; surface error verbatim                                           | "… possibly the device was removed; call `ahand.list_devices` to verify"   |
| **Authz**        | 403 (device not owned by user)                | Treated as bug; surface verbatim                                           | "device ownership mismatch" (should never happen in practice)              |
| **Availability** | 404 (device offline)                          | Surface verbatim                                                           | "Device X is offline. Ask the user to turn it on, or pick another device." |
| **Availability** | Device disconnects mid-job                    | SSE error event → partial stdout + error returned                          | "Job interrupted: device disconnected. Received N bytes of output."        |
| **Rate limit**   | 429                                           | Exponential backoff × 2; still 429 → surface                               | "Rate limited by ahand hub, retry later"                                   |
| **Network**      | Hub unreachable                               | CloudClient retries × 3 with backoff                                       | "aHand service unavailable"                                                |
| **Protocol**     | Hub returns unexpected payload                | Log + surface generic error                                                | "Internal error from aHand"                                                |
| **Execution**    | Daemon exec command fails (non-zero exit)     | **Normal return** (non-zero exit is a legitimate result, not a tool error) | exitCode + stdout + stderr shown                                           |
| **Cancel**       | Agent aborts (e.g., tool timeout)             | `CloudClient.cancel(jobId)` + close SSE                                    | "Job cancelled, partial output: …"                                         |

**Observability:**

- Each job publishes TaskCast events: `agent.tool.ahand.spawn.started/progress/finished` with deviceId, exitCode, durationMs.
- claw-hive IObserver receives the same events for agent trace UI.
- Gateway ahand module writes an `ahand_audit_events` table (optional for MVP — can rely on hub's audit_fallback.jsonl + CloudWatch initially; promote to Team9 DB later).

---

## § 7 · ahand-hub AWS Deployment (folder9-aligned)

### 7.1 Target Topology

Two environments, both ECS Fargate:

```
prod:
├─ ECS cluster: openclaw-hive
├─ Service:     ahand-hub-prod
├─ Domain:      ahand-hub.team9.ai
└─ SSM prefix:  /ahand-hub/prod/*

dev:
├─ ECS cluster: openclaw-hive-dev
├─ Service:     ahand-hub-dev
├─ Domain:      ahand-hub.dev.team9.ai
└─ SSM prefix:  /ahand-hub/dev/*
```

Branch routing: `main` → prod, `dev` → dev (same as folder9).

### 7.2 Build & Push Pipeline

**Image registry: ECR** (not GHCR). `471112576951.dkr.ecr.us-east-1.amazonaws.com/ahand-hub`.

Add `.github/workflows/deploy-hub.yml` to the ahand repo (analogue of folder9's `deploy.yml`):

```yaml
name: Deploy Hub
on:
  push:
    branches: [main, dev]
    paths:
      - "crates/ahand-hub/**"
      - "crates/ahand-hub-core/**"
      - "crates/ahand-hub-store/**"
      - "crates/ahand-protocol/**"
      - "deploy/hub/Dockerfile"
      - ".github/workflows/deploy-hub.yml"

permissions:
  id-token: write
  contents: read

env:
  AWS_REGION: us-east-1
  ECR_REGISTRY: 471112576951.dkr.ecr.us-east-1.amazonaws.com
  ECR_REPO: ahand-hub

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Determine env
        run: |
          if [ "${{ github.ref }}" = "refs/heads/main" ]; then
            echo "ENV=prod" >> "$GITHUB_ENV"
            echo "ECS_CLUSTER=openclaw-hive" >> "$GITHUB_ENV"
            echo "SERVICE_NAME=ahand-hub-prod" >> "$GITHUB_ENV"
          else
            echo "ENV=dev" >> "$GITHUB_ENV"
            echo "ECS_CLUSTER=openclaw-hive-dev" >> "$GITHUB_ENV"
            echo "SERVICE_NAME=ahand-hub-dev" >> "$GITHUB_ENV"
          fi
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::471112576951:role/GitHubActionsAhandHubDeploy
          aws-region: ${{ env.AWS_REGION }}
      - uses: aws-actions/amazon-ecr-login@v2
      - name: Build image (hub target)
        run: |
          docker build --platform linux/amd64 \
            --target hub \
            -f deploy/hub/Dockerfile \
            --build-arg GIT_SHA=${{ github.sha }} \
            -t "$ECR_REGISTRY/$ECR_REPO:$ENV" \
            -t "$ECR_REGISTRY/$ECR_REPO:${{ github.sha }}" .
      - name: Push image
        run: |
          docker push "$ECR_REGISTRY/$ECR_REPO:$ENV"
          docker push "$ECR_REGISTRY/$ECR_REPO:${{ github.sha }}"
      - name: Deploy
        env:
          GIT_SHA: ${{ github.sha }}
        run: unset AWS_PROFILE && ./deploy/hub/deploy.sh "$ENV"
```

Accompanying `deploy/hub/deploy.sh` (follows folder9's deploy.sh pattern, minus EFS):

```bash
#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ENV="${1:-}"
[[ "$ENV" == "dev" || "$ENV" == "prod" ]] || { echo "Usage: $0 {dev|prod}"; exit 1; }

AWS_REGION="us-east-1"
ACCOUNT_ID="471112576951"
ECR_REGISTRY="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
ECR_REPO="ahand-hub"
GIT_SHA="${GIT_SHA:-$(git rev-parse --short HEAD)}"

if [[ "$ENV" == "prod" ]]; then
  ECS_CLUSTER="openclaw-hive"
  SERVICE_NAME="ahand-hub-prod"
  API_DOMAIN="ahand-hub.team9.ai"
else
  ECS_CLUSTER="openclaw-hive-dev"
  SERVICE_NAME="ahand-hub-dev"
  API_DOMAIN="ahand-hub.dev.team9.ai"
fi

ECR_IMAGE="${ECR_REGISTRY}/${ECR_REPO}:${ENV}"
SSM_PREFIX="arn:aws:ssm:${AWS_REGION}:${ACCOUNT_ID}:parameter/ahand-hub/${ENV}"
EXECUTION_ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/ahand-hub-${ENV}-execution"
TASK_ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/ahand-hub-${ENV}-task"

RENDERED=$(mktemp)
trap 'rm -f "$RENDERED"' EXIT

sed \
  -e "s|\${ENV}|${ENV}|g" \
  -e "s|\${ECR_IMAGE}|${ECR_IMAGE}|g" \
  -e "s|\${EXECUTION_ROLE_ARN}|${EXECUTION_ROLE_ARN}|g" \
  -e "s|\${TASK_ROLE_ARN}|${TASK_ROLE_ARN}|g" \
  -e "s|\${API_DOMAIN}|${API_DOMAIN}|g" \
  -e "s|\${SSM_PREFIX}|${SSM_PREFIX}|g" \
  -e "s|\${AWS_REGION}|${AWS_REGION}|g" \
  -e "s|\${GIT_SHA}|${GIT_SHA}|g" \
  "${SCRIPT_DIR}/task-definition.template.json" > "$RENDERED"

aws ecs register-task-definition --region "$AWS_REGION" \
  --cli-input-json "file://${RENDERED}" > /dev/null
aws ecs update-service --region "$AWS_REGION" \
  --cluster "$ECS_CLUSTER" --service "$SERVICE_NAME" \
  --task-definition "ahand-hub-${ENV}" --force-new-deployment > /dev/null
aws ecs wait services-stable --region "$AWS_REGION" \
  --cluster "$ECS_CLUSTER" --services "$SERVICE_NAME"
```

### 7.3 Task Definition Template

`deploy/hub/task-definition.template.json`:

```json
{
  "family": "ahand-hub-${ENV}",
  "requiresCompatibilities": ["FARGATE"],
  "networkMode": "awsvpc",
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "${EXECUTION_ROLE_ARN}",
  "taskRoleArn": "${TASK_ROLE_ARN}",
  "containerDefinitions": [
    {
      "name": "ahand-hub",
      "image": "${ECR_IMAGE}",
      "essential": true,
      "portMappings": [{ "containerPort": 1515, "protocol": "tcp" }],
      "environment": [
        { "name": "AHAND_HUB_BIND_ADDR", "value": "0.0.0.0:1515" },
        { "name": "AHAND_HUB_DASHBOARD_ALLOWED_ORIGINS", "value": "" },
        { "name": "AHAND_HUB_LOG_FORMAT", "value": "json" },
        { "name": "AHAND_HUB_LOG_LEVEL", "value": "info" },
        {
          "name": "AHAND_HUB_AUDIT_FALLBACK_PATH",
          "value": "/tmp/audit-fallback.jsonl"
        },
        { "name": "AHAND_HUB_WEBHOOK_MAX_RETRIES", "value": "8" },
        { "name": "AHAND_HUB_WEBHOOK_TIMEOUT_MS", "value": "5000" },
        { "name": "GIT_SHA", "value": "${GIT_SHA}" },
        { "name": "SENTRY_ENVIRONMENT", "value": "${ENV}" }
      ],
      "secrets": [
        {
          "name": "AHAND_HUB_JWT_SECRET",
          "valueFrom": "${SSM_PREFIX}/JWT_SECRET"
        },
        {
          "name": "AHAND_HUB_SERVICE_TOKEN",
          "valueFrom": "${SSM_PREFIX}/SERVICE_TOKEN"
        },
        {
          "name": "AHAND_HUB_WEBHOOK_URL",
          "valueFrom": "${SSM_PREFIX}/WEBHOOK_URL"
        },
        {
          "name": "AHAND_HUB_WEBHOOK_SECRET",
          "valueFrom": "${SSM_PREFIX}/WEBHOOK_SECRET"
        },
        {
          "name": "AHAND_HUB_DATABASE_URL",
          "valueFrom": "${SSM_PREFIX}/DATABASE_URL"
        },
        {
          "name": "AHAND_HUB_REDIS_URL",
          "valueFrom": "${SSM_PREFIX}/REDIS_URL"
        },
        {
          "name": "AHAND_HUB_DASHBOARD_PASSWORD",
          "valueFrom": "${SSM_PREFIX}/DASHBOARD_PASSWORD"
        },
        {
          "name": "AHAND_HUB_DEVICE_BOOTSTRAP_TOKEN",
          "valueFrom": "${SSM_PREFIX}/DEVICE_BOOTSTRAP_TOKEN"
        },
        {
          "name": "AHAND_HUB_DEVICE_BOOTSTRAP_DEVICE_ID",
          "valueFrom": "${SSM_PREFIX}/DEVICE_BOOTSTRAP_DEVICE_ID"
        },
        { "name": "SENTRY_DSN", "valueFrom": "${SSM_PREFIX}/SENTRY_DSN" }
      ],
      "dockerLabels": {
        "traefik.enable": "true",
        "traefik.http.routers.ahand-hub-${ENV}.rule": "Host(`${API_DOMAIN}`)",
        "traefik.http.routers.ahand-hub-${ENV}.entrypoints": "websecure",
        "traefik.http.routers.ahand-hub-${ENV}.tls": "true",
        "traefik.http.routers.ahand-hub-${ENV}.tls.certresolver": "letsencrypt",
        "traefik.http.services.ahand-hub-${ENV}.loadbalancer.server.port": "1515"
      },
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/ahand-hub",
          "awslogs-region": "${AWS_REGION}",
          "awslogs-stream-prefix": "ahand-hub-${ENV}"
        }
      },
      "healthCheck": {
        "command": [
          "CMD-SHELL",
          "wget -qO- http://localhost:1515/api/health || exit 1"
        ],
        "interval": 30,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 60
      }
    }
  ]
}
```

Differences vs. folder9:

- No `mountPoints` / `volumes` (no EFS — no durable local file needs).
- `startPeriod: 60` (vs folder9's 30) to accommodate DB migration on cold start.
- Health check uses hub's `/api/health`.

### 7.4 No EFS / Persistent Volume

`audit_fallback.jsonl` is the only local-disk artifact. Losing it on task restart is acceptable (webhook already has retry + DLQ; audit trail is duplicated in CloudWatch Logs). Set `AHAND_HUB_AUDIT_FALLBACK_PATH=/tmp/audit-fallback.jsonl` (ephemeral). If a formal audit requirement appears later, add S3 sync or EFS then.

### 7.5 Traefik Routing

- Docker labels are consumed by Traefik (same pattern as folder9).
- LetsEncrypt issues certificates automatically.
- WebSocket upgrade is default-enabled in Traefik; no extra labels needed.

Tauri dials `wss://ahand-hub.team9.ai`; gateway calls `https://ahand-hub.team9.ai/api/control/jobs`.

### 7.6 SSM Parameter Store Paths

```
/ahand-hub/prod/JWT_SECRET                     SecureString
/ahand-hub/prod/SERVICE_TOKEN                  SecureString
/ahand-hub/prod/WEBHOOK_URL                    String (= https://api.team9.ai/api/ahand/hub-webhook)
/ahand-hub/prod/WEBHOOK_SECRET                 SecureString
/ahand-hub/prod/DATABASE_URL                   SecureString
/ahand-hub/prod/REDIS_URL                      SecureString
/ahand-hub/prod/DASHBOARD_PASSWORD             SecureString  (random filler, unused)
/ahand-hub/prod/DEVICE_BOOTSTRAP_TOKEN         SecureString  (random filler, unused)
/ahand-hub/prod/DEVICE_BOOTSTRAP_DEVICE_ID     String        (random filler, unused)
/ahand-hub/prod/SENTRY_DSN                     SecureString
```

`dev` mirrors the same structure under `/ahand-hub/dev/*`.

**Corresponding team9 gateway SSM parameters:**

```
/team9/prod/AHAND_HUB_URL            = https://ahand-hub.team9.ai
/team9/prod/AHAND_HUB_SERVICE_TOKEN  = (mirrors /ahand-hub/prod/SERVICE_TOKEN)
/team9/prod/AHAND_HUB_WEBHOOK_SECRET = (mirrors /ahand-hub/prod/WEBHOOK_SECRET)
```

Shared secrets stay manually in sync; cross-reference via Secrets Manager is a later ergonomic improvement.

### 7.7 Reuse Postgres / Redis

- **Postgres:** reuse the existing openclaw-hive RDS instance; create a new database `ahand_hub` with user `ahand_hub` scoped only to that database.
  ```sql
  CREATE DATABASE ahand_hub;
  CREATE USER ahand_hub WITH PASSWORD '…';
  GRANT ALL ON DATABASE ahand_hub TO ahand_hub;
  ```
- **Redis:** reuse if openclaw-hive already has ElastiCache Redis; isolate via `ahand:*` key prefix. If not, provision a small independent ElastiCache t4g.micro.

### 7.8 First-time Terraform Resources

`deploy.sh` can only update existing services, matching folder9's convention. Terraform (or first-time manual setup) creates:

- IAM roles: `ahand-hub-{env}-execution`, `ahand-hub-{env}-task`, `GitHubActionsAhandHubDeploy` (OIDC-trusted by the ahand repo).
- ECR repo: `ahand-hub`.
- ECS service `ahand-hub-{env}` (initial task definition can be a stub).
- Route53 records `ahand-hub.team9.ai` / `ahand-hub.dev.team9.ai` → ALB/Traefik.
- CloudWatch Logs group `/ecs/ahand-hub`.
- SSM parameters (initial values).

If team9 has an infra monorepo (like folder9's accompanying tf module), add ahand-hub there; otherwise prepare a standalone tf module.

### 7.9 Rough Cost Estimate

| Resource              | Spec              | Monthly        |
| --------------------- | ----------------- | -------------- |
| ECS Fargate (prod)    | 0.5 vCPU / 1GB    | $15            |
| ECS Fargate (dev)     | 0.25 vCPU / 512MB | $7             |
| RDS (reused)          | New database      | $0 incremental |
| Redis (reused or new) | $0 or $13         | $0 or $13      |
| CloudWatch Logs       | < 1GB/mo          | $1             |
| ECR storage           | < 1GB             | $0.10          |
| **Total**             |                   | **~$23–36/mo** |

### 7.10 Deployment Delivery Checklist

- [ ] Add `.github/workflows/deploy-hub.yml` to the ahand repo.
- [ ] Add `deploy/hub/deploy.sh` + `deploy/hub/task-definition.template.json`.
- [ ] Terraform: IAM role `GitHubActionsAhandHubDeploy` (OIDC trusts ahand repo).
- [ ] Terraform: IAM roles `ahand-hub-{env}-{execution,task}`.
- [ ] Terraform: ECR repo `ahand-hub`.
- [ ] Terraform: ECS service `ahand-hub-{prod,dev}` with initial task definition.
- [ ] Terraform: Route53 `ahand-hub.team9.ai` / `ahand-hub.dev.team9.ai`.
- [ ] Terraform: CloudWatch log group `/ecs/ahand-hub`.
- [ ] RDS: `CREATE DATABASE ahand_hub; CREATE USER ahand_hub …`.
- [ ] Redis: confirm reuse strategy.
- [ ] SSM parameters: `/ahand-hub/{prod,dev}/*` and matching `/team9/{prod,dev}/AHAND_HUB_*`.
- [ ] team9 gateway ECS task definition: add `AHAND_HUB_URL` / `AHAND_HUB_SERVICE_TOKEN` / `AHAND_HUB_WEBHOOK_SECRET`.

---

## § 8 · Legacy Code Removal

### 8.1 Tauri Rust (`apps/client/src-tauri/`)

| File / code                                                           | Action                                                      |
| --------------------------------------------------------------------- | ----------------------------------------------------------- |
| `src/ahand.rs` (443 lines of sidecar spawn)                           | **Delete**                                                  |
| `src/lib.rs` references to `ahand::*` (command registration)          | **Update** to reference the new `src/ahand/mod.rs` commands |
| `tauri.conf.json` entries in `bundle.externalBin` containing `ahandd` | **Delete**                                                  |
| Build scripts packaging the `ahandd` sidecar (e.g. `build.rs` / CI)   | **Delete**                                                  |

### 8.2 Tauri TS (`apps/client/src/`)

| File                                                                                       | Action                                                            |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `stores/useAHandSetupStore.ts`                                                             | **Delete**                                                        |
| `hooks/useAHandStatus.ts`                                                                  | **Delete**                                                        |
| `components/dialog/AHandSetupDialog.tsx`                                                   | **Delete**                                                        |
| `components/layout/LocalDeviceStatus.tsx`                                                  | **Delete**                                                        |
| `components/layout/MainSidebar.tsx` — import of `useAHandSetupStore` and its trigger logic | **Replace** with the new devices entry button (§ 5.1)             |
| `routes/_authenticated.tsx` — `useAHandSetupStore` auto-triggers                           | **Replace** with the new allow/disallow auto-resume logic (§ 4.8) |

### 8.3 i18n

| Locale file                                     | Action                                                                                                                                    |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `i18n/locales/*/resources.json` — `aHand*` keys | **Remove** keys used only by the deleted `AHandSetupDialog`; the new `DevicesDialog`'s keys go into a new `locales/*/ahand.json` (§ 5.10) |

Before deletion, sweep for references: `grep -r "ahandSetup\|AHandSetup\|useAHandStatus" apps/client/src/`.

### 8.4 Database Schema

**No tables removed.** Only new: `ahand_devices` (§ 3.2).

### 8.5 `~/.ahand/` Directory

The legacy path created `~/.ahand/{config.toml,device-identity.json,team9-device-id,node/,bin/}`. The new path moves everything under the Tauri app data dir (`~/Library/Application Support/com.team9.app/ahand/`).

**Migration:**

- Tauri does **not** auto-delete `~/.ahand/` (defensive, in case the user also uses `ahandctl` CLI).
- On startup, log once: "detected legacy ~/.ahand directory; safe to remove if not using ahandctl".
- README / help page documents manual cleanup.

---

## § 9 · Delivery Summary

### 9.1 Cross-repo Change Sizing

| Repo                     | Size                      | Core work                                                                                                                                                                                                                                                                                                                            |
| ------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `team9ai/ahand`          | Medium (2–4 person-days)  | `ahandd` library-ization; hub admin API (device / token / control-plane REST + SSE); hub webhook sender; `@ahand/sdk` `CloudClient`; JWT `externalUserId` claim; daemon-driven heartbeat; deploy workflow + deploy.sh                                                                                                                |
| `team9ai/team9`          | Large (10–15 person-days) | Gateway ahand module (REST + internal API + webhook handler + DB schema + device ownership + Redis presence); Tauri AhandRuntime + commands + identity mgmt; frontend DevicesDialog + MainSidebar entry + web/Tauri branches; message `clientContext`; im-worker Redis pub/sub subscribe + blueprint ahand injection; legacy cleanup |
| `team9ai/team9-agent-pi` | Medium (4–6 person-days)  | HostComponent multi-backend extension; CacheSystemContextProvider framework hook; AgentSession addComponent / removeComponent dynamic capability (if missing); AHandHostComponent + AHandContextProvider; CloudClient integration; unit + integration tests                                                                          |
| team9 infra / terraform  | Small (1–2 person-days)   | ECS service + IAM roles + ECR repo + Route53 + SSM parameters + RDS new database                                                                                                                                                                                                                                                     |

### 9.2 Sequencing

```
┌── ahand repo ──────────────┐
│ 1. ahandd lib-ization       │
│ 2. Hub admin API            │──┐
│ 3. Hub webhook sender       │  │
│ 4. @ahand/sdk CloudClient   │  │
│ 5. JWT claim extension      │  │
│ 6. Heartbeat direction flip │  │
│ 7. Deploy workflow          │  │
└────────────────────────────┘   │
                                 ▼
┌── team9 infra ─────────────┐   │   ┌── team9-agent-pi ─────────────┐
│ 1. IAM / ECR / ECS basics  │   │   │ 1. HostComponent multi-backend │
│ 2. RDS database + user     │   │   │ 2. CacheSystemContextProvider  │
│ 3. Redis confirm / create  │   │   │ 3. AgentSession addComponent   │
│ 4. SSM parameters          │   │   │    (if missing)                │
│ 5. Route53 + Traefik       │   │   └────────────────────────────────┘
│ 6. Hub deployment (live)   │◀──┘              │
└────────────────────────────┘                  │
          │                                     │
          ▼                                     │
┌── team9 gateway ──────────────┐               │
│ 1. ahand module               │               │
│ 2. DB migration ahand_devices │               │
│ 3. Webhook handler            │               │
│ 4. REST + internal endpoints  │               │
│ 5. Redis pub/sub bridge       │               │
│ 6. message clientContext      │               │
└───────────────────────────────┘               │
          │                                     │
          ▼                                     ▼
┌── team9 im-worker ─────────────────────────────┐
│ 1. Redis pub/sub subscribe                      │
│ 2. Blueprint builder ahand injection             │
│ 3. Runtime device add/remove plumbing            │
└──────────────────────────────────────────────────┘
          │
          ▼
┌── team9 Tauri + Web ───────────────────────┐
│ 1. Rust AhandRuntime + commands            │
│ 2. Identity management                     │
│ 3. DevicesDialog + MainSidebar entry       │
│ 4. Web CTA differentiation                 │
│ 5. message clientContext                   │
│ 6. Legacy cleanup                          │
└────────────────────────────────────────────┘
          │
          ▼
        Launch ✅
```

**Blocking items:**

- Ahand repo #1–#5 must land before team9 can integrate.
- team9-agent-pi #1 and #2 must land before `AHandHostComponent` can be written.
- `AgentSession.addComponent` (#3) is not a launch blocker — if missing, use the snapshot fallback (§ 6.8.3) and add it as a follow-up.

### 9.3 Team Split Suggestion

- **ahand repo + team9 infra:** single owner/team (both infra-flavored, Rust-adjacent).
- **team9 gateway + im-worker:** backend team.
- **team9-agent-pi:** agent framework team (must coordinate with backend team on interface design).
- **Tauri Rust + Web:** frontend team.

### 9.4 Testing Strategy (comprehensive · 100% coverage target · happy + bad + edge)

#### 9.4.1 Coverage Targets

| Repo                         | Statements | Branches | Functions | Lines    |
| ---------------------------- | ---------- | -------- | --------- | -------- |
| team9-agent-pi new code      | **100%**   | **100%** | **100%**  | **100%** |
| team9 gateway new code       | **100%**   | **100%** | **100%**  | **100%** |
| team9 im-worker new code     | **100%**   | **100%** | **100%**  | **100%** |
| Tauri Rust new code          | **100%**   | **100%** | **100%**  | **100%** |
| Tauri/Web frontend new code  | **100%**   | **100%** | **100%**  | **100%** |
| ahand repo lib / hub changes | **100%**   | **100%** | **100%**  | **100%** |

Any file requiring coverage ignore (e.g., trivial OS wrappers, platform-specific dead branches) must be confirmed with the user before marking `/* istanbul ignore */`.

#### 9.4.2 Unit Tests · ahand Repo

**`crates/ahandd` lib-ized `spawn` / `shutdown`:**

- _Happy:_ boot → mock hub → HelloAccepted → Online; shutdown → clean close → Offline → task join.
- _Bad:_ hub URL unreachable → Error(Network) + internal backoff; HelloChallenge timeout → Error(Auth); JWT rejected (401) → Error(Auth, "jwt_expired"); identity file corrupt → caught and returned as error; shutdown during connect → no task leak.
- _Edge:_ consecutive `spawn` without `shutdown` → old task replaced + cleaned; `shutdown` called twice → second is no-op; hub-initiated close (graceful) → triggers internal reconnect.

**`crates/ahand-hub` control-plane REST + SSE:**

- _Happy:_ `POST /jobs` → jobId; SSE → stdout chunks → `finished`.
- _Bad:_ JWT mismatch / expired / `externalUserId` mismatch → 401/403; nonexistent deviceId → 404; offline device → 404 + `device_offline`; missing body fields → 400; rate-limit exceeded → 429; daemon disconnects mid-job → SSE `error: device_disconnected`.
- _Edge:_ client closes SSE early → hub cleans listener without leak; same jobId requested by two SSE clients → clarified semantics + tested; very large stdout (> 1MB) → chunked correctly; stdout containing `\n\n` → not mis-split at SSE boundary; duplicate `correlationId` → idempotent same jobId.

**`crates/ahand-hub` webhook sender:**

- _Happy:_ device connects → POST → 200 → queue clears.
- _Bad:_ 5xx → exponential backoff retries; after 8 retries → DLQ (audit_fallback.jsonl); 401 from gateway (signature issue) → log error, no retry; timeout → retry strategy; missing HMAC secret on boot → fail-fast.
- _Edge:_ burst traffic (1000 qps) → bounded queue + backpressure, no OOM; 301 redirect → follow once or refuse (explicit choice + test); duplicate `eventId` after crash/restart → sender does not dedupe (gateway side does).

**`@ahand/sdk` `CloudClient`:**

- _Happy:_ `spawn` → POST → SSE → callbacks → `finished` resolves with exitCode.
- _Bad:_ POST failure → typed error reject; SSE connect fails → reject; SSE `error` event → reject; `getAuthToken` throws → reject; `signal.aborted` → cancel + close + AbortError.
- _Edge:_ abort before POST → no POST; unknown SSE event type → ignored (forward-compat); callback throws → subsequent chunks still delivered; special chars in jobId → URL-encoded; token expires during SSE → SSE unaffected, next POST refreshes.

#### 9.4.3 Unit Tests · team9-agent-pi

**HostComponent multi-backend:**

- _Happy:_ N backends register; tool schema stable (no enum); `run_command({ backend })` routes; omitted `backend` uses sticky.
- _Bad:_ `run_command({ backend: "nonexistent" })` → clear tool error; `run_command()` with `lastUsedBackend=null` and N>1 → explicit "must specify" error; backend handler throws → wrapped tool error, HostComponent state intact.
- _Edge:_ unregister a backend with a running job → current job continues; duplicate `register` same type → overwrite, running job preserved; N=1 without `backend` → auto-pick, `lastUsedBackend` unchanged; N=1 → N=0 → sticky cleared; N=0 → N=1 → next call auto-picks.

**CacheSystemContextProvider:**

- _Happy:_ first prompt renders + caches; deps unchanged reuses; deps change rebuilds; `refresh_context` clears → next prompt rebuilds.
- _Bad:_ `render()` throws → caught, empty string injected with error marker; `getCacheDependencies()` throws → fallback to per-turn render (safe); two providers sharing `cacheKey` → framework errors.
- _Edge:_ nested deps objects → deep-compare correct (or hash); null/undefined in deps stable; session resume clears cache but not ComponentData; `invalidateCache({ mode: "force-now" })` during onBeforePrompt chain → current prompt uses new content.

**`AHandHostComponent.spawn`:**

- _Happy:_ CloudClient.spawn → stdout/stderr streaming → ProcessHandle with exitCode=0.
- _Bad:_ CloudClient throws DeviceOffline / Auth → clear spawn error; `ensureReady` on offline device → explicit error; ownership check failure → treated as bug marker.
- _Edge:_ stdout chunk arrives before `spawn` resolves → accumulated correctly; output exceeding MAX_OUTPUT_BYTES → truncated with flag; null byte / huge commands pass through; `onDispose` during in-flight job → cancel + cleanup; concurrent spawns same agentId → unique execIds.

**`AHandContextProvider.render` / `getCacheDependencies`:**

- _Happy:_ four `callingClient` shapes × various device sets → snapshot-tested XML.
- _Bad:_ `listDevices` RPC failure → throws → framework falls back; callingClient's deviceId not owned by user → renders as `kind=web`.
- _Edge:_ XML special chars in nickname (`<>&"`) → escaped correctly; zero devices → meaningful empty-state XML; 100+ devices → render stays fast (perf bench); `devicesSig` sort-stable to avoid false invalidation.

#### 9.4.4 Unit Tests · team9 Gateway

**`AhandDevicesController`:**

- _Happy:_ register / list (+ Redis mget) / refresh token / delete.
- _Bad:_ no token → 401; bad body → 400; deviceId collision → 409; refresh for someone else's device → 403; DELETE a non-owned device → 404 (anti-enumeration); hub unreachable → 503 with transaction rollback (no half-writes).
- _Edge:_ concurrent register same deviceId → UNIQUE + idempotent (second returns existing); 100+ devices per user still registerable; nickname with emoji / overlong → length enforcement; revoked devices excluded from list; hub reports device-exists race → idempotent success.

**`AhandHubWebhookController`:**

- _Happy:_ valid signature + new eventId → DB write + Redis set + Socket.io emit. Heartbeat refreshes TTL.
- _Bad:_ HMAC mismatch → 401; timestamp > 5min → 401; already-processed `eventId` (Redis SETNX returns 0) → 204 no-op; missing headers → 400; malformed JSON → 400; unknown `eventType` → 400 (strict rejection).
- _Edge:_ oversize payload (> 1MB) → 413; future timestamp with small skew → accept within 5s else 401; Socket.io adapter down → webhook handler still returns 200 (state is already persisted; frontend re-syncs via GET); two gateway replicas receive the same eventId after hub retry + LB switch → one SETNX wins, the other returns 204.

**`AhandHubClient` (gateway → hub HTTP client):**

- _Happy:_ register / mint token / delete admin API calls.
- _Bad:_ hub 5xx → backoff + retry 3x; hub 403 (service token lacks permission) → throw immediately, no retry; timeout → retry + eventual timeout error; non-JSON response → decode error.
- _Edge:_ connection pool exhausted → queue + timeout; keep-alive closed by peer → auto-rebuild.

**`AhandDevicesService` (business logic):**

- _Happy:_ `listActiveDevicesForUser(userId, { includeOffline })` merges DB + Redis presence correctly.
- _Bad:_ Redis mget timeout → graceful downgrade to "all offline" without throwing.
- _Edge:_ user deletion `@OnEvent("user.deleted")` cascades: large device set, concurrent hub DELETE failures → retry queue; workspace deletion parallel.

#### 9.4.5 Unit Tests · team9 im-worker

**Blueprint builder ahand injection:**

- _Happy:_ 3 online devices → 3 `AHandHostComponent` + 1 `AHandContextProvider`; callingMessage from MacApp with ahand enabled → `clientContext.kind="macapp", isAhandEnabled=true`; 0 devices → no ahand components injected.
- _Bad:_ `listDevicesForUser` RPC failure → blueprint downgrades to "no ahand" + warning logged (session still starts); clientContext's `deviceId` not owned by user → treated as web.
- _Edge:_ device list shifts during blueprint build → snapshot wins; many concurrent sessions for the same user → each snapshots independently.

**Redis pub/sub bridge (`ahand:events:{userId}`):**

- _Happy:_ `device.online` → find active sessions → `AgentSession.addComponent` new backend; `device.offline` → `removeComponent`; `device.revoked` → remove + invalidate cache.
- _Bad:_ pub/sub disconnect → auto-reconnect + resubscribe (intermediate events may be lost; heartbeat TTL eventually self-corrects); `addComponent` failure (framework bug) → log + session does not crash.
- _Edge:_ same deviceId flaps online/offline rapidly → debounce or serialize (explicit semantics); user with 10 active sessions → fan-out acceptable perf.

#### 9.4.6 Unit Tests · Tauri Rust

**`AhandRuntime.start` / `stop` / `status`:**

- _Happy:_ start with valid config → `ahandd::spawn` → ActiveSession holds handle → status=Online; stop → shutdown → state=None → Offline; consecutive starts without stop → old auto-stopped, new started.
- _Bad:_ `ahandd::spawn` error → surface to Tauri command → TS sees error; shutdown timing out → force-drop task (verified no leak); status queried while Idle → returns `Idle`.
- _Edge:_ concurrent start + stop → Mutex serializes; subscribe before start → initially `Idle` then progresses; `current_device_id` returns `None` while Idle.

**`identity.rs` (Ed25519 load/create):**

- _Happy:_ first call creates dir + keypair + file; subsequent calls read existing, return same deviceId.
- _Bad:_ dir not writable → clear error; file corrupt (bad JSON / missing fields) → **do not auto-rebuild** (avoids orphan device), return error so UI can guide "reset device"; disk full → error.
- _Edge:_ empty file → treated as corrupt; concurrent calls → second reads what first wrote (Mutex + fs race); different team9 userId → different dir (isolation verified).

**Tauri command layer:**

- _Happy:_ `ahand_get_identity` returns `{ deviceId, publicKeyB64 }`; `ahand_start` / `ahand_stop` / `ahand_status` delegate to AhandRuntime; status changes emit `"ahand-daemon-status"` Tauri events.
- _Bad:_ `ahand_start` without JWT → command error; `ahand_stop` without active session → idempotent ok.

#### 9.4.7 Unit Tests · Frontend (TS/React)

**`DevicesDialog`:**

- _Happy:_ Tauri mode renders "this Mac" + others; Web mode renders CTA + devices; toggle allow → registration flow → UI reflects online/offline; remove → confirm → DELETE → list updates.
- _Bad:_ registration network failure → toggle reverts OFF + toast; remove failure → error toast, device stays; device gone (race) → disappears gracefully.
- _Edge:_ rapid toggle → debounce / button-disable; Socket.io disconnect during dialog → indicator + GET on reconnect; multi-tab consistency; nickname edit optimistic update with rollback on failure; `team9://devices` deep link rejected → toast.

**`useAhandLocalStatus` hook:**

- _Happy:_ subscribe to Tauri event → status update → rerender.
- _Bad:_ subscription failure → defaults to Idle; invalid payload → ignored.
- _Edge:_ unmount cleanup (no leak).

**`MainSidebar` entry button:**

- _Happy:_ click opens DevicesDialog; status dot reflects aggregate (Tauri: local status; Web: any-online → green).
- _Bad / Edge:_ state stable on close; tooltip positions correctly across platforms.

#### 9.4.8 Integration Tests

**team9-agent-pi `__integration__/ahand.integration.test.ts`:** local fastify mock hub implementing α endpoints + real HiveRuntime + real AHandHostComponent/HostComponent (multi-backend).

- Full happy round-trip: blueprint injects 2 `AHandHostComponent` + 1 `AHandContextProvider` → `run_command({ backend: "ahand:user-computer:abc", command: "echo hello" })` → mock hub dispatches job + SSE stdout/finished → agent gets correct exit + stdout.
- Sticky backend: two consecutive calls, second omits `backend` → correctly reused.
- Cache-system: render → deps change → rebuild; `refresh_context` tool → cache invalidated.
- Bad: mock hub 404 → clear error; SSE mid-disconnect → partial stdout + error; AbortSignal → cancel + cleanup.
- Edge: multi-backend coexistence (just-bash + 2 ahand) with switching; dynamic add/remove → `<host-context>` and tool schema reflect latest; dispose mid-job → cancel + cleanup.

**team9 gateway `ahand.integration.spec.ts` (NestJS e2e style):** real Postgres (testcontainers) + real Redis + mock hub.

- Happy: register → refresh token → webhook drives state → GET returns correct isOnline.
- Ownership isolation: user A calling user B's device → 403.
- Webhook idempotency: same eventId twice → DB update once, single Socket.io emit.
- Edge: 10 concurrent register same deviceId → UNIQUE serializes; Redis down → graceful degrade, no crash; hub 5xx during registration → transaction rolls back.

**team9 im-worker `ahand-dynamic-device.integration.spec.ts`:** mock gateway + mock Redis pub/sub + real claw-hive runtime.

- Happy: session starts → device comes online → pub event → `addComponent` → next prompt has new backend.
- Edge: device A online at start, A offline + B online mid-run → tool surface switches; 0 devices at start, 1 online later → agent sees `<ahand-context>` update.

#### 9.4.9 E2E Tests (Playwright)

**Setup:** Playwright + local mock ahand-hub (Rust bin implementing protocol/REST/webhook) + real team9 gateway + real Tauri app (via `tauri-driver` or webdriverio).

- **Scenario 1 · First-time enable:** log in → click sidebar → empty state → "Allow" → "Registering…" → success → green dot. Verify DB row, mock hub record, `device.online` webhook fired.
- **Scenario 2 · Cross-device visibility:** enable on Mac A → open browser → CTA card + Mac A in list.
- **Scenario 3 · Agent uses remote machine:** from enabled Mac, send "run `echo hello` on this machine" → agent calls `run_command` → mock hub dispatches to mock daemon → stdout flows back → agent replies.
- **Scenario 4 · Revoke:** web UI removes device → Tauri receives kick → auto stop + cleared identity + toggle OFF. Both UIs drop the entry.
- **Scenario 5 · Reconnect:** cut mock hub network → Tauri amber "connecting…" → restore → auto-reconnect → green.
- **Scenario 6 · JWT refresh:** mock hub rejects next handshake with `jwt_expired` → daemon reconnect fails → Tauri refreshes token → restart → online.
- **Scenario 7 · Bad path · offline at registration:** disable network mid-register → API fails → toast + toggle OFF + no local identity remnant.
- **Scenario 8 · Edge · two users on one Mac:** user A enables, logs out, user B enables → each has distinct deviceId under per-user dir; hub records both separately.
- **Scenario 9 · Edge · one user on two Macs:** same team9 user logs in on Mac A (enable → deviceId_A) and Mac B (enable → deviceId_B). Verify both rows exist in `ahand_devices` with the same `owner_id`, both appear in the user's `GET /api/ahand/devices` response, agent sees both as distinct `ahand:user-computer:*` backends when both are online, and disabling on Mac A does not affect Mac B.

#### 9.4.10 Contract Tests

Freeze schemas to prevent unannounced breaking changes.

| Contract                                  | Tooling                              | Location                                     |
| ----------------------------------------- | ------------------------------------ | -------------------------------------------- |
| ahand-hub control-plane REST + SSE schema | JSON Schema / TypeBox                | ahand repo + team9 repo; CI diffs on updates |
| Webhook payload schema                    | JSON Schema                          | Same                                         |
| `@ahand/sdk` `CloudClient` signatures     | TypeScript type tests (tsd)          | team9 repo pins what it consumes             |
| Tauri Rust ↔ TS command schema            | serde + TS bindings (e.g., `specta`) | Both sides test in sync                      |
| team9 gateway REST to Tauri               | OpenAPI schema                       | Tauri generates client; CI checks drift      |

CI fails fast on breaking schema changes across repos; non-breaking additions (new optional fields) pass automatically. Breaking changes require manual approval + lockstep release.

#### 9.4.11 Load / Performance Tests

Baseline run in staging:

| Scenario                                              | Target                                         |
| ----------------------------------------------------- | ---------------------------------------------- |
| 1000 concurrent daemons to hub                        | handshake p99 < 500ms; no OOM                  |
| 10k heartbeat webhooks/sec to gateway                 | webhook handler p99 < 50ms; Redis backlog zero |
| 100 concurrent agent `run_command` via hub → daemon   | end-to-end p99 < 500ms (same region)           |
| `GET /api/ahand/devices` for a user with 1000 devices | p99 < 200ms                                    |
| Daemon local shell throughput                         | CPU < 10% idle; stdout lossless                |

Tools: `k6` for HTTP/WS; custom Rust benchmark for daemon.

#### 9.4.12 Test Execution Pipeline

Every PR must pass:

| Stage                    | Content                                | Budget  |
| ------------------------ | -------------------------------------- | ------- |
| Pre-commit hook          | Prettier + ESLint + Clippy + cargo fmt | < 10s   |
| PR CI · Unit             | All unit tests + coverage check        | < 5min  |
| PR CI · Integration      | agent-pi + gateway integration         | < 3min  |
| PR CI · Contract         | Schema diff                            | < 30s   |
| PR CI · Lint / Typecheck | pnpm typecheck + cargo check           | < 2min  |
| Nightly                  | E2E Playwright + load baseline         | < 30min |
| Release gate             | All of the above + manual QA checklist | —       |

Coverage below 100% blocks the PR. `/* istanbul ignore */` markers require PR-description justification.

### 9.5 Risks & Mitigations

| Risk                                                                  | Mitigation                                                                                                       |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `@ahand/sdk` `CloudClient` schema diverges from hub control-plane API | Joint review before launch; contract tests freeze schema                                                         |
| ahand-hub single-replica is an availability risk                      | Single replica acceptable for MVP; Redis-based cross-replica routing is a follow-up                              |
| team9-agent-pi lacks `AgentSession.addComponent`                      | Snapshot-mode fallback (§ 6.8.3) keeps launch unblocked                                                          |
| Playwright-cli install flow under lib-ized daemon                     | MVP does not enable browser; relevant code paths are never triggered; follow-up re-designs for browser feature   |
| Heartbeat QPS at scale                                                | Estimated 167 req/s at 10k devices is well within bounds; tune `heartbeat_interval` post-launch based on metrics |
| User's local private key in plaintext                                 | Accepted (see § 4.10); Keychain integration is a follow-up                                                       |
| Multi-replica gateway + Redis adapter correctness                     | Integration tests simulate dual replicas; production adds Prometheus metrics for "event routed twice / dropped"  |
| Cross-repo lockstep release (ahand + team9)                           | Contract tests + version pinning (ahand lib pinned to git tag) + dev before prod rollout                         |

### 9.6 Follow-ups Beyond MVP

- **Browser automation tools** (`ahand.browser.*`).
- **File operations** (remote `readFile` / `writeFile` via `HostComponent.read_file`).
- **Approval dialogs** (strict / trust session mode UX).
- **Workspace-owned devices** (full `ownerType='workspace'` support). Envisioned registration flow: a workspace admin requests a pair token from gateway (`POST /api/ahand/workspace-devices/pair-tokens`), gateway mints a short-lived bootstrap JWT and returns it along with a CLI command (e.g., `ahandctl connect --hub=https://... --token=... --workspace=...`). The operator runs the command on the target machine (a server, CI runner, or shared workstation); the command calls team9 gateway to register the device under `ownerType=workspace`, starts the daemon, and auto-approves on first handshake (since the bootstrap token proves workspace admin intent). After that, any workspace member's agent sessions see the device as a backend.
- **Active device request** `ahand.request_device` tool + approval flow.
- **Device push notifications** (user notified when a device comes online).
- **Multi-region hub + Redis fan-in** (cross-replica device routing).
- **Secure Enclave for Ed25519** (macOS Keychain Services storage).
- **Persistent audit logs into Team9 DB** (beyond hub's fallback + CloudWatch).
- **ahand-hub supporting the OpenClaw gateway-node protocol** (allow legacy OpenClaw product to use ahand-hub as its control plane, for a smooth migration path).

---
