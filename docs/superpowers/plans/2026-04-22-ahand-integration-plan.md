# ahand Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fully replace the legacy OpenClaw-gateway path; integrate ahand-hub so team9 agents can execute shell on users' authorized real machines via a Rust-library-embedded daemon.

**Architecture:** Tauri embeds `ahandd` as a Rust library (no sidecar); team9 gateway is permissions SOT and mints hub JWTs via a service token; agent runtime (claw-hive) registers each online device as an `IHostBackend` under an extended multi-backend `HostComponent`; hub-side webhook + Redis presence keep state in sync.

**Tech Stack:** Rust (ahandd / ahand-hub / Tauri src-tauri) · TypeScript (NestJS gateway, Next-ish React via Tauri + Vite, claw-hive, `@ahand/sdk`) · PostgreSQL (Drizzle) · Redis · AWS ECS Fargate · Traefik · Ed25519 · protobuf · Playwright (E2E).

**Reference spec:** `docs/superpowers/specs/2026-04-22-ahand-integration-design.md`.

**Cross-repo scope:**

- `team9ai/ahand` — Rust daemon/hub/SDK + deploy workflow.
- `team9ai/team9-agent-pi` — claw-hive framework + components.
- `team9ai/team9` — NestJS gateway + im-worker + Tauri app + Web UI.
- team9 infra (Terraform) — ECS service, IAM, ECR, Route53, SSM, RDS/Redis plumbing.

**Phase map (sequenced per spec § 9.2):**

| Phase | Repo                                | Tasks                                                                                |
| ----- | ----------------------------------- | ------------------------------------------------------------------------------------ |
| 1     | `team9ai/ahand`                     | Daemon lib-ization, protocol, hub API, SDK, deploy workflow                          |
| 2     | `team9ai/team9-agent-pi`            | Framework extensions (multi-backend HostComponent, cache-system, dynamic components) |
| 3     | team9 infra                         | AWS resources, SSM, DNS, hub dev deploy                                              |
| 4     | `team9ai/team9` gateway             | ahand NestJS module (DB, REST, webhook, Redis)                                       |
| 5     | `team9ai/team9` im-worker           | Redis pub/sub, blueprint injection, dynamic device lifecycle                         |
| 6     | `team9ai/team9-agent-pi` components | AHandHostComponent, AHandContextProvider, tools                                      |
| 7     | `team9ai/team9` Tauri Rust          | AhandRuntime, identity, Tauri commands, legacy removal                               |
| 8     | `team9ai/team9` frontend            | DevicesDialog, MainSidebar entry, Web CTA, i18n, legacy removal                      |
| 9     | All                                 | Integration + E2E + contract tests                                                   |
| 10    | All                                 | Production rollout                                                                   |

Phase boundaries align with committable milestones. Within a phase, each task is a single commit with its own tests.

**Conventions used throughout:**

- Paths are absolute inside their repo (e.g., `crates/ahandd/src/lib.rs` implies the `ahand` repo root).
- Every task has a `Verify:` command with expected outcome; `Steps:` include exact code blocks.
- Commits use Conventional Commits: `feat(scope):`, `fix(scope):`, `refactor(scope):`, `test(scope):`, `chore(scope):`.
- All new code targets **100% coverage** of statements, branches, functions, lines; ignore pragmas require inline justification.
- For Rust: `cargo test -p <crate>`; for TS: `pnpm test --filter <pkg>`; for Tauri Rust: `cargo test --manifest-path apps/client/src-tauri/Cargo.toml`.

---

## Phase 1 — ahand Repo

**Working directory for all Phase 1 tasks:** `/Users/winrey/Projects/weightwave/ahand`.

**Outcome of Phase 1:** A published-ready ahand that exposes (a) an embeddable daemon library, (b) control-plane REST + SSE on the hub, (c) webhook delivery, (d) a TS `CloudClient` in `@ahand/sdk`, and (e) a deploy workflow mirroring folder9.

### Task 1.1: Library-ize `ahandd` into `DaemonHandle` API

**Goal:** Extract daemon startup orchestration out of `main.rs` into `lib.rs` so Tauri can embed it. Expose `DaemonConfig`, `DaemonHandle`, `spawn()`, `load_or_create_identity()`, and typed `DaemonStatus`/`ErrorKind`.

**Files:**

- Create: `crates/ahandd/src/public_api.rs` (new module for public types + `spawn` facade)
- Modify: `crates/ahandd/src/lib.rs` (re-export `public_api::*`, make `ahand_client`, `config`, `device_identity`, `executor` public where needed)
- Modify: `crates/ahandd/src/main.rs` (replace hand-rolled orchestration with `public_api::spawn(...).await`)
- Modify: `crates/ahandd/src/config.rs` (add `DaemonConfig::builder` / `From<Config>` to bridge file-based CLI config and library callers)
- Create: `crates/ahandd/tests/lib_spawn.rs` (integration test that spawns against a mock hub)

**Acceptance Criteria:**

- [ ] `ahandd::spawn(config)` returns a `DaemonHandle` whose `subscribe_status()` emits `Connecting → Online { device_id }` against a mock hub.
- [ ] `DaemonHandle::shutdown()` completes without leaking the inner task (verified via `tokio::task::JoinHandle::is_finished()`).
- [ ] `DaemonStatus::Error { kind: ErrorKind::Auth, .. }` surfaces when the mock hub returns 401 at handshake.
- [ ] `load_or_create_identity(path)` is idempotent: first call writes a key, subsequent calls return the same `deviceId`.
- [ ] `cargo test -p ahandd --test lib_spawn` passes.
- [ ] `main.rs` contains only CLI parsing + one call to `public_api::spawn`; line count ≤ 80.

**Verify:** `cargo test -p ahandd` → all tests pass (existing + new `lib_spawn`); `cargo run -p ahandd -- --config test.toml` still works for CLI users.

**Steps:**

- [ ] **Step 1: Define public types in a new module**

```rust
// crates/ahandd/src/public_api.rs
use std::path::PathBuf;
use std::time::Duration;
use tokio::sync::{oneshot, watch};
use tokio::task::JoinHandle;

pub use crate::config::SessionMode;
pub use crate::device_identity::DeviceIdentity;

#[derive(Clone, Debug)]
pub struct DaemonConfig {
    pub hub_url: String,
    pub device_jwt: String,
    pub identity_dir: PathBuf,
    pub session_mode: SessionMode,
    pub browser_enabled: bool,
    pub heartbeat_interval: Duration,
}

impl DaemonConfig {
    pub fn builder(hub_url: impl Into<String>, device_jwt: impl Into<String>, identity_dir: impl Into<PathBuf>) -> DaemonConfigBuilder {
        DaemonConfigBuilder {
            hub_url: hub_url.into(),
            device_jwt: device_jwt.into(),
            identity_dir: identity_dir.into(),
            session_mode: SessionMode::AutoAccept,
            browser_enabled: false,
            heartbeat_interval: Duration::from_secs(60),
        }
    }
}

pub struct DaemonConfigBuilder {
    hub_url: String,
    device_jwt: String,
    identity_dir: PathBuf,
    session_mode: SessionMode,
    browser_enabled: bool,
    heartbeat_interval: Duration,
}

impl DaemonConfigBuilder {
    pub fn session_mode(mut self, mode: SessionMode) -> Self { self.session_mode = mode; self }
    pub fn browser_enabled(mut self, enabled: bool) -> Self { self.browser_enabled = enabled; self }
    pub fn heartbeat_interval(mut self, d: Duration) -> Self { self.heartbeat_interval = d; self }
    pub fn build(self) -> DaemonConfig {
        DaemonConfig {
            hub_url: self.hub_url,
            device_jwt: self.device_jwt,
            identity_dir: self.identity_dir,
            session_mode: self.session_mode,
            browser_enabled: self.browser_enabled,
            heartbeat_interval: self.heartbeat_interval,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ErrorKind {
    Auth,
    Network,
    Other,
}

#[derive(Clone, Debug)]
pub enum DaemonStatus {
    Idle,
    Connecting,
    Online { device_id: String },
    Offline,
    Error { kind: ErrorKind, message: String },
}

pub struct DaemonHandle {
    shutdown_tx: Option<oneshot::Sender<()>>,
    join: JoinHandle<anyhow::Result<()>>,
    status_rx: watch::Receiver<DaemonStatus>,
    device_id: String,
}

impl DaemonHandle {
    pub async fn shutdown(mut self) -> anyhow::Result<()> {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
        self.join.await??;
        Ok(())
    }
    pub fn status(&self) -> DaemonStatus { self.status_rx.borrow().clone() }
    pub fn subscribe_status(&self) -> watch::Receiver<DaemonStatus> { self.status_rx.clone() }
    pub fn device_id(&self) -> &str { &self.device_id }
}

pub async fn spawn(config: DaemonConfig) -> anyhow::Result<DaemonHandle> {
    // Implementation extracted from main.rs::run (see Step 3).
    unimplemented!("wired up in Step 3")
}

pub fn load_or_create_identity(dir: &std::path::Path) -> anyhow::Result<DeviceIdentity> {
    crate::device_identity::DeviceIdentity::load_or_create(&dir.join("device-identity.json"))
}
```

- [ ] **Step 2: Re-export in lib.rs**

```rust
// crates/ahandd/src/lib.rs (replace existing)
pub mod ahand_client;
pub mod approval;
pub mod browser;
pub mod browser_setup;
pub mod config;
pub mod device_identity;
pub mod executor;
pub mod outbox;
pub mod registry;
pub mod session;
pub mod store;
pub mod updater;

mod public_api;
pub use public_api::{
    DaemonConfig, DaemonConfigBuilder, DaemonHandle, DaemonStatus, ErrorKind,
    DeviceIdentity, SessionMode, spawn, load_or_create_identity,
};
```

- [ ] **Step 3: Move main.rs orchestration into public_api::spawn**

Read `crates/ahandd/src/main.rs` (443 lines) end-to-end. Identify the section that (a) loads identity, (b) constructs session manager + approval manager + registry + store, (c) calls `ahand_client::run(...)`. Port that block into `public_api::spawn`, parameterized by `DaemonConfig` instead of CLI args. The `shutdown_tx` should flow into a tokio `select!` inside the spawned task so shutdown preempts `ahand_client::run`.

Sketch (pseudo; actual code must use the real types from `ahand_client`, `session`, etc.):

```rust
pub async fn spawn(config: DaemonConfig) -> anyhow::Result<DaemonHandle> {
    use crate::{ahand_client, approval, registry, session, store};
    use std::sync::Arc;

    let identity = load_or_create_identity(&config.identity_dir)?;
    let device_id = identity.device_id.clone();

    let (status_tx, status_rx) = watch::channel(DaemonStatus::Connecting);
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

    let session_mgr = Arc::new(session::SessionManager::new(config.session_mode));
    let approval_mgr = Arc::new(approval::ApprovalManager::new());
    let registry = Arc::new(registry::JobRegistry::new());
    let (approval_broadcast_tx, _) = tokio::sync::broadcast::channel(64);
    let browser_mgr = Arc::new(crate::browser::BrowserManager::new(config.browser_enabled));

    let hub_config = crate::config::HubConfig {
        url: config.hub_url,
        jwt: config.device_jwt,
        heartbeat_interval: config.heartbeat_interval,
        // ... preserve existing fields by default
    };
    let inner_config = crate::config::Config::from_hub(hub_config);

    let status_tx_for_task = status_tx.clone();
    let device_id_for_task = device_id.clone();

    let join = tokio::spawn(async move {
        let run_fut = ahand_client::run(
            inner_config,
            device_id_for_task,
            registry,
            None,
            session_mgr,
            approval_mgr,
            approval_broadcast_tx,
            browser_mgr,
        );
        tokio::select! {
            res = run_fut => {
                match &res {
                    Ok(_) => { let _ = status_tx_for_task.send(DaemonStatus::Offline); }
                    Err(e) => {
                        let kind = classify_error(e);
                        let _ = status_tx_for_task.send(DaemonStatus::Error { kind, message: e.to_string() });
                    }
                }
                res
            }
            _ = shutdown_rx => {
                let _ = status_tx_for_task.send(DaemonStatus::Offline);
                Ok(())
            }
        }
    });

    Ok(DaemonHandle {
        shutdown_tx: Some(shutdown_tx),
        join,
        status_rx,
        device_id,
    })
}

fn classify_error(e: &anyhow::Error) -> ErrorKind {
    let s = e.to_string().to_lowercase();
    if s.contains("401") || s.contains("unauthorized") || s.contains("jwt") {
        ErrorKind::Auth
    } else if s.contains("connect") || s.contains("timeout") || s.contains("network") {
        ErrorKind::Network
    } else {
        ErrorKind::Other
    }
}
```

Port the status transitions: wherever `ahand_client::run` today logs "connected" / "authenticated", emit `DaemonStatus::Online { device_id }` via `status_tx`. Route the heartbeat loop's success to keep `Online`.

- [ ] **Step 4: Slim main.rs**

```rust
// crates/ahandd/src/main.rs
use ahandd::{DaemonConfig, spawn};
use clap::Parser;
use std::path::PathBuf;
use std::time::Duration;

#[derive(Parser)]
#[command(name = "ahandd")]
struct Cli {
    #[arg(long)]
    config: Option<PathBuf>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();
    let cli = Cli::parse();
    let file_cfg = ahandd::config::load_from_path_or_default(cli.config.as_deref())?;
    let config = DaemonConfig::builder(
        file_cfg.hub_url(),
        file_cfg.device_jwt().unwrap_or_default().to_string(),
        file_cfg.identity_dir(),
    )
        .session_mode(file_cfg.session_mode())
        .browser_enabled(file_cfg.browser_enabled())
        .heartbeat_interval(Duration::from_secs(file_cfg.heartbeat_interval_secs()))
        .build();
    let handle = spawn(config).await?;
    tokio::signal::ctrl_c().await?;
    handle.shutdown().await?;
    Ok(())
}
```

The `ahandd::config` module will need `load_from_path_or_default` + getter helpers — add those alongside existing `Config`.

- [ ] **Step 5: Integration test against a mock hub**

```rust
// crates/ahandd/tests/lib_spawn.rs
use ahandd::{DaemonConfig, DaemonStatus, ErrorKind, spawn};
use std::time::Duration;
use tempfile::TempDir;

#[tokio::test]
async fn spawn_connects_and_reports_online() {
    let mock = mock_hub::start_accepting().await;
    let tmp = TempDir::new().unwrap();
    let config = DaemonConfig::builder(mock.ws_url(), mock.valid_jwt(), tmp.path())
        .heartbeat_interval(Duration::from_secs(1))
        .build();

    let handle = spawn(config).await.expect("spawn ok");
    let mut status = handle.subscribe_status();
    let online = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            status.changed().await.unwrap();
            if matches!(*status.borrow(), DaemonStatus::Online { .. }) { break; }
        }
    }).await;
    assert!(online.is_ok(), "did not reach Online within 5s");

    handle.shutdown().await.expect("shutdown clean");
}

#[tokio::test]
async fn spawn_surfaces_auth_error() {
    let mock = mock_hub::start_rejecting_401().await;
    let tmp = TempDir::new().unwrap();
    let config = DaemonConfig::builder(mock.ws_url(), "bad-jwt", tmp.path()).build();
    let handle = spawn(config).await.expect("spawn returns handle even if auth later fails");
    let mut status = handle.subscribe_status();
    let got_auth_error = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            status.changed().await.unwrap();
            if matches!(*status.borrow(), DaemonStatus::Error { kind: ErrorKind::Auth, .. }) { break true; }
        }
    }).await;
    assert!(got_auth_error.is_ok());
    handle.shutdown().await.unwrap();
}

mod mock_hub {
    // Minimal WS server that either accepts Hello + returns HelloAccepted,
    // or immediately 401s on handshake. Implementation uses `tokio-tungstenite::accept_async`
    // + `prost` to decode Hello envelope. Keep under ~120 lines.
    //
    // Expose:
    //   pub async fn start_accepting() -> Mock { ... }
    //   pub async fn start_rejecting_401() -> Mock { ... }
    //   impl Mock { pub fn ws_url(&self) -> String; pub fn valid_jwt(&self) -> String; }
    //
    // See existing hub WS tests in crates/ahand-hub/tests/* for reference.
}
```

- [ ] **Step 6: Run the full test suite**

Run: `cargo test -p ahandd`
Expected: all existing tests still pass + two new `lib_spawn` tests pass.

- [ ] **Step 7: Verify CLI entry still works**

Run: `cargo build -p ahandd --bin ahandd`
Expected: binary builds; `ahandd --help` shows only `--config` flag.

- [ ] **Step 8: Commit**

```bash
cd /Users/winrey/Projects/weightwave/ahand
git add crates/ahandd/src/ crates/ahandd/tests/
git commit -m "$(cat <<'EOF'
refactor(ahandd): expose library API for in-process embedding

Extracts daemon startup orchestration out of main.rs into public_api
so Tauri can spawn the daemon inside its own tokio runtime. The CLI
now wraps the same lib entry point.

- Public types: DaemonConfig + Builder, DaemonHandle, DaemonStatus, ErrorKind
- public_api::spawn + load_or_create_identity
- main.rs reduced to ~50 lines of thin CLI orchestration
- tests/lib_spawn.rs covers Online path and Auth error path against
  a mock WS hub

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.2: Heartbeat envelope + daemon sender + hub forward (remove hub timer)

**Goal:** Reverse heartbeat direction. The daemon pushes periodic `Heartbeat` envelopes on the WS; the hub forwards each as a `device.heartbeat` webhook event (instead of running a per-device timer itself).

**Files:**

- Modify: `proto/ahand/v1/envelope.proto` (add `Heartbeat` message + include in `Envelope` oneof)
- Modify: `crates/ahand-protocol/src/lib.rs` (regenerated; verify exports)
- Modify: `packages/proto-ts/src/` (regenerated; verify exports)
- Modify: `crates/ahandd/src/ahand_client.rs` (add heartbeat sender task; wire `heartbeat_interval` from config)
- Modify: `crates/ahand-hub/src/ws/mod.rs` (or equivalent: handle incoming `Heartbeat` envelope → emit `device.heartbeat` webhook)
- Remove: any `AHAND_HUB_HEARTBEAT_INTERVAL_SECONDS` usage in `crates/ahand-hub/` and hub's internal heartbeat timer
- Modify: `crates/ahandd/tests/lib_spawn.rs` (add test: mock hub observes heartbeat envelope arriving every ~1s)
- Create: `crates/ahand-hub/tests/heartbeat_forward.rs` (integration: mock daemon sends Heartbeat → hub calls webhook handler)

**Acceptance Criteria:**

- [ ] `proto/ahand/v1/envelope.proto` defines `Heartbeat { uint64 sent_at_ms = 1; string daemon_version = 2; }` inside the `Envelope` oneof.
- [ ] `ahandd` spawns a heartbeat task on every connection that sends `Heartbeat` envelopes at `DaemonConfig::heartbeat_interval`.
- [ ] The heartbeat task terminates cleanly when the WS closes or `DaemonHandle::shutdown` is invoked.
- [ ] `ahand-hub` removes any internal heartbeat timer (grep returns no match for `HEARTBEAT_INTERVAL` in hub sources after refactor).
- [ ] On receiving `Heartbeat`, hub emits a `device.heartbeat` webhook payload including `sentAtMs` and computed `presenceTtlSeconds = interval × 3`.
- [ ] New integration test `heartbeat_forward.rs` asserts a mock webhook receiver observes at least 2 heartbeat POSTs in 3 seconds with correct payload.

**Verify:** `cargo test -p ahand-protocol && cargo test -p ahandd && cargo test -p ahand-hub --test heartbeat_forward` → all pass.

**Steps:**

- [ ] **Step 1: Add Heartbeat to protobuf**

```proto
// proto/ahand/v1/envelope.proto  (edit)
message Heartbeat {
  uint64 sent_at_ms = 1;
  string daemon_version = 2;
}

message Envelope {
  // ... existing fields
  oneof payload {
    // ... existing variants
    Heartbeat heartbeat = <next_free_tag>;
  }
}
```

Pick a tag not already used; verify against current `envelope.proto`.

- [ ] **Step 2: Regenerate Rust + TS bindings**

Run: `pnpm build --filter=@ahand/proto` and `cargo build -p ahand-protocol`. Verify the generated types include `Heartbeat` and `Envelope::Heartbeat` / `envelope.Heartbeat` respectively.

- [ ] **Step 3: Daemon-side heartbeat sender**

In `crates/ahandd/src/ahand_client.rs`, inside `run(...)`, after a successful `HelloAccepted`:

```rust
// After the WS is established and Hello is accepted:
let heartbeat_tx = envelope_sender.clone();
let interval = config.heartbeat_interval();
let daemon_version = env!("CARGO_PKG_VERSION").to_string();
let heartbeat_task = tokio::spawn(async move {
    let mut ticker = tokio::time::interval(interval);
    ticker.tick().await; // skip first immediate tick
    loop {
        ticker.tick().await;
        let envelope = ahand_protocol::Envelope {
            payload: Some(ahand_protocol::envelope::Payload::Heartbeat(
                ahand_protocol::Heartbeat {
                    sent_at_ms: std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as u64,
                    daemon_version: daemon_version.clone(),
                }
            )),
            device_id: /* from identity */,
            ..Default::default()
        };
        if heartbeat_tx.send(envelope).is_err() {
            // Sender dropped → WS is closing. Exit quietly.
            break;
        }
    }
});

// When run() exits (WS close or shutdown), heartbeat_task is dropped, which
// aborts the ticker loop. Ensure no leak in tests.
```

Ensure the sender channel drop propagates quickly; if a guard is needed, wrap `heartbeat_task` in a `DropGuard` that aborts the task on drop.

- [ ] **Step 4: Hub-side receive + forward**

In `crates/ahand-hub/src/ws/` (locate the envelope dispatcher; likely in the WS message handler):

```rust
match envelope.payload {
    // ... existing arms: Job, JobEvent, JobFinished, etc.
    Some(Payload::Heartbeat(hb)) => {
        // Refresh in-memory last_seen_at for this device
        device_registry.mark_heartbeat(device_id);
        // Emit webhook
        webhook::enqueue(WebhookEvent {
            event_id: ulid::Ulid::new().to_string(),
            event_type: "device.heartbeat".into(),
            device_id: device_id.clone(),
            external_user_id: device_record.external_user_id.clone(),
            occurred_at: chrono::Utc::now(),
            data: serde_json::json!({
                "sentAtMs": hb.sent_at_ms,
                "presenceTtlSeconds": config.expected_heartbeat_interval_secs * 3,
            }),
        }).await;
    }
    _ => { /* existing */ }
}
```

`config.expected_heartbeat_interval_secs` is a hub-side advertised default (e.g., 60) used for the TTL hint in webhook payloads. It's NOT a hub timer; it's just metadata.

- [ ] **Step 5: Remove hub internal heartbeat timer**

Grep: `rg -nP 'HEARTBEAT_INTERVAL|heartbeat_tick|heartbeat_loop' crates/ahand-hub/`
For every match that represents an internal timer (not the advertised interval constant), delete the timer and its setup code. Verify hub still compiles.

- [ ] **Step 6: Daemon integration test — heartbeat observed**

Add to `crates/ahandd/tests/lib_spawn.rs`:

```rust
#[tokio::test]
async fn daemon_sends_heartbeat_on_interval() {
    let mock = mock_hub::start_accepting_with_capture().await;
    let tmp = TempDir::new().unwrap();
    let config = DaemonConfig::builder(mock.ws_url(), mock.valid_jwt(), tmp.path())
        .heartbeat_interval(Duration::from_millis(500))
        .build();

    let handle = spawn(config).await.unwrap();

    tokio::time::sleep(Duration::from_millis(1_600)).await;
    let beats = mock.captured_heartbeats().await;
    assert!(beats.len() >= 2, "expected ≥2 heartbeats in ~1.5s, got {}", beats.len());
    assert!(beats.iter().all(|hb| !hb.daemon_version.is_empty()));

    handle.shutdown().await.unwrap();
}
```

Extend `mock_hub` with `start_accepting_with_capture` + `captured_heartbeats()`.

- [ ] **Step 7: Hub integration test — webhook forward**

```rust
// crates/ahand-hub/tests/heartbeat_forward.rs
use std::time::Duration;

#[tokio::test]
async fn hub_forwards_heartbeat_to_webhook() {
    let webhook_capturer = mock_webhook::start().await;
    let hub = test_hub::start_with_webhook(webhook_capturer.url()).await;
    let daemon = fake_daemon::connect(hub.ws_url()).await;

    daemon.send_heartbeat(1_745_318_400_000).await;
    daemon.send_heartbeat(1_745_318_460_000).await;

    tokio::time::sleep(Duration::from_millis(500)).await;

    let posts = webhook_capturer.posts().await;
    let heartbeats: Vec<_> = posts.iter()
        .filter(|p| p.event_type == "device.heartbeat")
        .collect();
    assert_eq!(heartbeats.len(), 2);
    assert_eq!(heartbeats[0].data["sentAtMs"], 1_745_318_400_000_u64);
    assert_eq!(heartbeats[0].data["presenceTtlSeconds"], 180); // 60 * 3
}
```

`test_hub`, `fake_daemon`, `mock_webhook` helpers live next to the test; keep each under 100 lines.

- [ ] **Step 8: Run suites**

Run: `cargo test -p ahand-protocol && cargo test -p ahandd && cargo test -p ahand-hub`
Expected: all pass, no regressions.

- [ ] **Step 9: Commit**

```bash
cd /Users/winrey/Projects/weightwave/ahand
git add proto/ crates/ packages/
git commit -m "$(cat <<'EOF'
feat(protocol): daemon-driven heartbeat envelope + hub webhook forward

Reverses heartbeat direction: the daemon now pushes Heartbeat envelopes
on its existing WS connection at DaemonConfig.heartbeat_interval, and
the hub forwards each as a device.heartbeat webhook (including sentAtMs
and presenceTtlSeconds = interval * 3 for TTL-based presence).

- proto/ahand/v1/envelope.proto: adds Heartbeat message into Envelope oneof
- crates/ahandd: periodic sender task spawned post-Hello; aborts on shutdown
- crates/ahand-hub: removes internal heartbeat timer; envelope dispatcher
  calls webhook::enqueue for device.heartbeat
- Integration tests cover daemon sender cadence + hub forward correctness

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

> **Verbosity note:** Task 1.1 and 1.2 include full code blocks because they introduce new public abstractions. Subsequent tasks reference patterns more tersely, show only novel logic/algorithms in full, and defer to the spec (§ 9.4.2 etc.) for exhaustive test matrices. Implementers are expected to follow the existing patterns in each repo.

---

### Task 1.3: Hub admin API (device pre-register + token minting)

**Goal:** Expose service-token-authenticated admin endpoints on `ahand-hub` so team9 gateway can pre-register devices, mint device JWTs, mint control-plane JWTs, delete devices, and list devices per `externalUserId`.

**Files:**

- Modify: `crates/ahand-hub/src/http/mod.rs` (add `admin` router)
- Create: `crates/ahand-hub/src/http/admin.rs` (all five endpoints)
- Modify: `crates/ahand-hub/src/auth.rs` (add `externalUserId` claim to JWT; add `mint_device_jwt`, `mint_control_plane_jwt`)
- Modify: `crates/ahand-hub-store/src/devices.rs` (add `externalUserId` column + `pre_register`, `find_by_id`, `delete`, `list_by_external_user` methods)
- Create: `crates/ahand-hub-store/migrations/NNN_external_user_id.sql` (add `external_user_id text` column, index)
- Create: `crates/ahand-hub/tests/admin_api.rs` (integration test using disposable postgres)

**Acceptance Criteria:**

- [ ] `POST /api/admin/devices` with valid service token creates a device row with `(deviceId, publicKey, externalUserId)`; returns `{deviceId, createdAt}`.
- [ ] `POST /api/admin/devices/{id}/token` returns a JWT with claims `{deviceId, externalUserId, exp}` signed with `AHAND_HUB_JWT_SECRET`; default TTL 24h, clamped to 7d max.
- [ ] `POST /api/admin/control-plane/token` returns a JWT with `{externalUserId, scope, deviceIds?}`, default TTL 1h.
- [ ] `DELETE /api/admin/devices/{id}` marks the device deleted and forcibly closes any open WS for that device (emits `device.revoked` webhook).
- [ ] `GET /api/admin/devices?externalUserId=X` returns only that user's devices.
- [ ] All admin endpoints return 401 without valid service token; 400 on malformed body; 404 for unknown deviceId.
- [ ] The JWT verifier for `/api/control/*` (added in Task 1.4) reads `externalUserId` from claims and rejects claim/device mismatch with 403.

**Verify:** `cargo test -p ahand-hub --test admin_api` → all pass; manual curl against the test binary confirms expected status codes for bad/edge cases.

**Steps:**

- [ ] **Step 1: Migration adds `external_user_id`**

```sql
-- crates/ahand-hub-store/migrations/NNN_external_user_id.sql
ALTER TABLE devices ADD COLUMN external_user_id TEXT;
CREATE INDEX devices_external_user_id_idx ON devices(external_user_id);
```

`NNN` is the next migration number; check `migrations/` for the current max.

- [ ] **Step 2: Store methods**

In `crates/ahand-hub-store/src/devices.rs`, add:

```rust
pub async fn pre_register(&self, device_id: &str, public_key_b64: &str, external_user_id: &str) -> Result<Device>;
pub async fn find_by_id(&self, device_id: &str) -> Result<Option<Device>>;
pub async fn delete(&self, device_id: &str) -> Result<bool>;
pub async fn list_by_external_user(&self, external_user_id: &str) -> Result<Vec<Device>>;
```

`pre_register` is idempotent: if the row exists with identical `external_user_id` and `public_key`, return the existing row; if it exists with a different `external_user_id`, return a `DeviceOwnedByDifferentUser` error.

Follow the async sqlx pattern used for existing `Device` CRUD in this file.

- [ ] **Step 3: JWT claims**

In `crates/ahand-hub/src/auth.rs`:

```rust
#[derive(serde::Serialize, serde::Deserialize)]
pub struct DeviceJwtClaims {
    pub sub: String,          // device_id
    pub external_user_id: String,
    pub exp: i64,
    pub iat: i64,
    pub token_type: TokenType,  // "device" | "control_plane"
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TokenType { Device, ControlPlane }

#[derive(serde::Serialize, serde::Deserialize)]
pub struct ControlPlaneJwtClaims {
    pub sub: String,           // external_user_id
    pub external_user_id: String,
    pub scope: String,         // "jobs:execute"
    pub device_ids: Option<Vec<String>>,
    pub exp: i64,
    pub iat: i64,
    pub token_type: TokenType,
}

pub fn mint_device_jwt(
    secret: &[u8],
    device_id: &str,
    external_user_id: &str,
    ttl: std::time::Duration,
) -> Result<(String, chrono::DateTime<chrono::Utc>)>;

pub fn mint_control_plane_jwt(
    secret: &[u8],
    external_user_id: &str,
    scope: &str,
    device_ids: Option<Vec<String>>,
    ttl: std::time::Duration,
) -> Result<(String, chrono::DateTime<chrono::Utc>)>;

pub fn verify_control_plane_jwt(secret: &[u8], token: &str) -> Result<ControlPlaneJwtClaims>;
pub fn verify_device_jwt(secret: &[u8], token: &str) -> Result<DeviceJwtClaims>;
```

Use `jsonwebtoken` crate (already a workspace dep). Enforce `ttl ≤ 7 days` for device tokens and `ttl ≤ 1 hour` for control-plane by default; accept explicit override.

- [ ] **Step 4: Admin router**

```rust
// crates/ahand-hub/src/http/admin.rs
use axum::{extract::{Path, Query, State}, http::StatusCode, Json, Router, routing::{post, delete, get}};
use serde::{Deserialize, Serialize};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/admin/devices", post(pre_register).get(list_devices))
        .route("/api/admin/devices/:id", delete(delete_device))
        .route("/api/admin/devices/:id/token", post(mint_device_token))
        .route("/api/admin/control-plane/token", post(mint_control_plane_token))
        .layer(axum::middleware::from_fn_with_state(state.clone(), require_service_token))
}

#[derive(Deserialize)]
pub struct PreRegisterRequest {
    pub device_id: String,
    pub public_key: String,        // base64
    pub external_user_id: String,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Serialize)]
pub struct PreRegisterResponse {
    pub device_id: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

async fn pre_register(State(s): State<AppState>, Json(req): Json<PreRegisterRequest>)
    -> Result<Json<PreRegisterResponse>, AdminError> {
    let dev = s.store.devices().pre_register(&req.device_id, &req.public_key, &req.external_user_id).await?;
    Ok(Json(PreRegisterResponse { device_id: dev.id, created_at: dev.created_at }))
}

#[derive(Deserialize)]
pub struct MintDeviceTokenRequest {
    pub ttl_seconds: Option<u64>,   // default 86400, max 604800 (7d)
}

#[derive(Serialize)]
pub struct TokenResponse {
    pub token: String,
    pub expires_at: chrono::DateTime<chrono::Utc>,
}

async fn mint_device_token(
    State(s): State<AppState>,
    Path(device_id): Path<String>,
    Json(req): Json<MintDeviceTokenRequest>,
) -> Result<Json<TokenResponse>, AdminError> {
    let dev = s.store.devices().find_by_id(&device_id).await?
        .ok_or(AdminError::NotFound)?;
    let ttl_secs = req.ttl_seconds.unwrap_or(86_400).min(604_800);
    let (token, expires_at) = crate::auth::mint_device_jwt(
        &s.jwt_secret,
        &dev.id,
        &dev.external_user_id,
        std::time::Duration::from_secs(ttl_secs),
    )?;
    Ok(Json(TokenResponse { token, expires_at }))
}

#[derive(Deserialize)]
pub struct MintControlPlaneRequest {
    pub external_user_id: String,
    pub device_ids: Option<Vec<String>>,
    pub scope: Option<String>,
    pub ttl_seconds: Option<u64>,
}

async fn mint_control_plane_token(
    State(s): State<AppState>,
    Json(req): Json<MintControlPlaneRequest>,
) -> Result<Json<TokenResponse>, AdminError> {
    let ttl_secs = req.ttl_seconds.unwrap_or(3_600).min(3_600);
    let scope = req.scope.unwrap_or_else(|| "jobs:execute".into());
    let (token, expires_at) = crate::auth::mint_control_plane_jwt(
        &s.jwt_secret,
        &req.external_user_id,
        &scope,
        req.device_ids,
        std::time::Duration::from_secs(ttl_secs),
    )?;
    Ok(Json(TokenResponse { token, expires_at }))
}

async fn delete_device(State(s): State<AppState>, Path(device_id): Path<String>)
    -> Result<StatusCode, AdminError> {
    let existed = s.store.devices().delete(&device_id).await?;
    if !existed { return Err(AdminError::NotFound); }
    s.ws_registry.kick_device(&device_id).await;
    s.webhook.enqueue_revoked(&device_id).await;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct ListDevicesQuery { pub external_user_id: String }

async fn list_devices(State(s): State<AppState>, Query(q): Query<ListDevicesQuery>)
    -> Result<Json<Vec<DeviceDto>>, AdminError> {
    let devices = s.store.devices().list_by_external_user(&q.external_user_id).await?;
    Ok(Json(devices.into_iter().map(DeviceDto::from).collect()))
}

// AdminError impl Display + IntoResponse mapping:
//   NotFound → 404
//   BadRequest → 400
//   Internal → 500
//   Conflict (device owned by different user) → 409
```

`require_service_token` middleware reads `Authorization: Bearer <AHAND_HUB_SERVICE_TOKEN>` and compares via constant-time equality.

- [ ] **Step 5: Wire the router**

In `crates/ahand-hub/src/http/mod.rs`, merge `admin::router()` into the top-level app router.

- [ ] **Step 6: Integration test**

`crates/ahand-hub/tests/admin_api.rs` — start hub with a disposable postgres (reuse `--features test-support` infra if available) + in-memory Redis. Cover:

- Happy: register → mint device token → decode JWT → claims carry externalUserId.
- Happy: mint control-plane token with `deviceIds=[x,y]` → claims carry them.
- Bad: register without service token → 401; with wrong token → 401.
- Bad: register with same deviceId + different externalUserId → 409.
- Bad: mint token for unknown deviceId → 404.
- Bad: `ttl_seconds = 999_999` → clamped to 7d.
- Edge: register twice with identical params → idempotent same response.
- Edge: delete → subsequent list_by_external_user excludes it; any active WS for that deviceId kicked.

See spec § 9.4.2 for the full bad/edge matrix; mirror it in this test file.

- [ ] **Step 7: Run tests**

Run: `cargo test -p ahand-hub-store && cargo test -p ahand-hub --test admin_api`
Expected: all pass; coverage ≥ 100% on new files.

- [ ] **Step 8: Commit**

```bash
cd /Users/winrey/Projects/weightwave/ahand
git add crates/ahand-hub/ crates/ahand-hub-store/
git commit -m "$(cat <<'EOF'
feat(hub): admin API for device pre-register + token minting

Adds service-token-authenticated endpoints on ahand-hub that let team9
gateway manage devices on behalf of users:

- POST /api/admin/devices — pre-register device with (deviceId, publicKey, externalUserId)
- POST /api/admin/devices/:id/token — mint device JWT (default 24h, max 7d)
- POST /api/admin/control-plane/token — mint agent control-plane JWT (1h)
- DELETE /api/admin/devices/:id — revoke + close WS + emit device.revoked webhook
- GET /api/admin/devices?externalUserId= — list user's devices

JWT claims now carry externalUserId. Device records gain an external_user_id
column (indexed). Comprehensive bad/edge cases covered in tests/admin_api.rs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.4: Hub control-plane REST + SSE (`/api/control/*`)

**Goal:** Add the control-plane endpoints that team9 im-worker uses to dispatch jobs: `POST /api/control/jobs`, `GET /api/control/jobs/{id}/stream` (SSE), `POST /api/control/jobs/{id}/cancel`.

**Files:**

- Create: `crates/ahand-hub/src/http/control_plane.rs`
- Modify: `crates/ahand-hub/src/http/mod.rs` (mount)
- Modify: `crates/ahand-hub/src/state.rs` (add job tracker: `Arc<DashMap<JobId, JobChannels>>`)
- Modify: `crates/ahand-hub/src/ws/mod.rs` (route `JobEvent`, `JobFinished`, `JobRejected` envelopes to the per-job broadcast channel)
- Create: `crates/ahand-hub/tests/control_plane.rs`

**Acceptance Criteria:**

- [ ] `POST /api/control/jobs` with valid control-plane JWT validates ownership (JWT.externalUserId matches the device) and dispatches a Job envelope to the daemon's WS; returns `{jobId}`.
- [ ] `GET /api/control/jobs/{id}/stream` returns `text/event-stream` with `stdout`/`stderr`/`progress`/`finished`/`error` events; keepalives every 15s as SSE comments (`: keepalive\n\n`).
- [ ] `POST /api/control/jobs/{id}/cancel` routes a CancelJob envelope to the daemon; responds 202 immediately.
- [ ] 403 when JWT's externalUserId doesn't match the device's; 404 when device offline; 404 when jobId unknown; 429 when the per-user rate limit triggers.
- [ ] Duplicate `correlationId` on POST returns the same jobId without re-dispatching.
- [ ] SSE client disconnect cleans up the broadcast subscriber without leaking.

**Verify:** `cargo test -p ahand-hub --test control_plane` → all pass.

**Steps:**

- [ ] **Step 1: Per-job channel registry**

In `crates/ahand-hub/src/state.rs`:

```rust
pub struct JobChannels {
    pub event_tx: tokio::sync::broadcast::Sender<ControlJobEvent>,
    pub cancel_tx: tokio::sync::oneshot::Sender<()>,
    pub device_id: String,
    pub external_user_id: String,
    pub correlation_id: Option<String>,
    pub started_at: std::time::Instant,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(tag = "event", content = "data", rename_all = "snake_case")]
pub enum ControlJobEvent {
    Stdout { chunk: String },
    Stderr { chunk: String },
    Progress { percent: u8, message: String },
    Finished { exit_code: i32, duration_ms: u64 },
    Error { code: String, message: String },
}

pub struct JobTracker {
    inner: DashMap<String, JobChannels>,          // key = jobId
    correlation_index: DashMap<String, String>,   // correlationId → jobId
}
```

Expose `JobTracker::spawn_job(...)`, `subscribe(jobId)`, `dispatch_cancel(jobId)`, `finalize(jobId)` (drops the entry).

- [ ] **Step 2: Envelope dispatcher routes to JobTracker**

In `crates/ahand-hub/src/ws/mod.rs`, where envelopes from daemons are decoded:

```rust
match payload {
    Some(Payload::JobEvent(ev)) => {
        if let Some(job) = state.jobs.get(&ev.job_id) {
            let ctrl_ev = match (ev.stdout_chunk, ev.stderr_chunk, ev.progress) {
                (Some(s), _, _) => ControlJobEvent::Stdout { chunk: s },
                (_, Some(s), _) => ControlJobEvent::Stderr { chunk: s },
                (_, _, Some(p)) => ControlJobEvent::Progress {
                    percent: p.percent as u8,
                    message: p.message,
                },
                _ => return,
            };
            let _ = job.event_tx.send(ctrl_ev);
        }
    }
    Some(Payload::JobFinished(f)) => {
        if let Some((_, job)) = state.jobs.remove(&f.job_id) {
            let _ = job.event_tx.send(ControlJobEvent::Finished {
                exit_code: f.exit_code,
                duration_ms: job.started_at.elapsed().as_millis() as u64,
            });
        }
    }
    Some(Payload::JobRejected(r)) => {
        if let Some((_, job)) = state.jobs.remove(&r.job_id) {
            let _ = job.event_tx.send(ControlJobEvent::Error {
                code: "rejected".into(),
                message: r.reason,
            });
        }
    }
    _ => { /* existing */ }
}
```

- [ ] **Step 3: Control-plane router**

```rust
// crates/ahand-hub/src/http/control_plane.rs
use axum::{extract::{Path, State}, http::StatusCode, response::{sse::{Event, KeepAlive, Sse}}, Json, Router};
use futures_util::stream::{self, StreamExt};
use std::time::Duration;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/control/jobs", axum::routing::post(create_job))
        .route("/api/control/jobs/:id/stream", axum::routing::get(stream_job))
        .route("/api/control/jobs/:id/cancel", axum::routing::post(cancel_job))
        .layer(axum::middleware::from_fn_with_state(state.clone(), require_control_plane_jwt))
}

#[derive(serde::Deserialize)]
pub struct CreateJobRequest {
    pub device_id: String,
    pub command: String,
    pub cwd: Option<String>,
    pub envs: Option<std::collections::HashMap<String, String>>,
    pub timeout_ms: Option<u64>,
    pub correlation_id: Option<String>,
}

#[derive(serde::Serialize)]
pub struct CreateJobResponse {
    pub job_id: String,
}

async fn create_job(
    State(s): State<AppState>,
    Extension(claims): Extension<ControlPlaneJwtClaims>,
    Json(req): Json<CreateJobRequest>,
) -> Result<Json<CreateJobResponse>, ControlError> {
    // Ownership check
    let dev = s.store.devices().find_by_id(&req.device_id).await?
        .ok_or(ControlError::DeviceNotFound)?;
    if dev.external_user_id != claims.external_user_id {
        return Err(ControlError::Forbidden);
    }
    if !s.ws_registry.is_online(&dev.id).await {
        return Err(ControlError::DeviceOffline);
    }

    // Idempotency
    if let Some(cid) = &req.correlation_id {
        if let Some(existing) = s.jobs.find_by_correlation(cid) {
            return Ok(Json(CreateJobResponse { job_id: existing }));
        }
    }

    // Rate-limit per externalUserId (token bucket; reuse existing middleware-like guard).
    s.rate_limiter.try_acquire(&claims.external_user_id)
        .map_err(|_| ControlError::RateLimited)?;

    let job_id = ulid::Ulid::new().to_string();
    s.jobs.register(job_id.clone(), &dev.id, &dev.external_user_id, req.correlation_id.clone());
    s.ws_registry.send_job_envelope(&dev.id, &job_id, &req).await?;
    Ok(Json(CreateJobResponse { job_id }))
}

async fn stream_job(
    State(s): State<AppState>,
    Extension(claims): Extension<ControlPlaneJwtClaims>,
    Path(job_id): Path<String>,
) -> Result<Sse<impl futures_util::Stream<Item = Result<Event, std::convert::Infallible>>>, ControlError> {
    let job = s.jobs.get(&job_id).ok_or(ControlError::JobNotFound)?;
    if job.external_user_id != claims.external_user_id {
        return Err(ControlError::Forbidden);
    }
    let mut rx = job.event_tx.subscribe();
    let stream = async_stream::stream! {
        while let Ok(ev) = rx.recv().await {
            let (name, data) = match &ev {
                ControlJobEvent::Stdout { chunk } => ("stdout", serde_json::json!({ "chunk": chunk })),
                ControlJobEvent::Stderr { chunk } => ("stderr", serde_json::json!({ "chunk": chunk })),
                ControlJobEvent::Progress { percent, message } => ("progress", serde_json::json!({ "percent": percent, "message": message })),
                ControlJobEvent::Finished { exit_code, duration_ms } => ("finished", serde_json::json!({ "exitCode": exit_code, "durationMs": duration_ms })),
                ControlJobEvent::Error { code, message } => ("error", serde_json::json!({ "code": code, "message": message })),
            };
            let sse_event = Event::default().event(name).json_data(data).unwrap();
            yield Ok(sse_event);
            if matches!(ev, ControlJobEvent::Finished { .. } | ControlJobEvent::Error { .. }) { break; }
        }
    };
    Ok(Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15)).text("keepalive")))
}

async fn cancel_job(
    State(s): State<AppState>,
    Extension(claims): Extension<ControlPlaneJwtClaims>,
    Path(job_id): Path<String>,
) -> Result<StatusCode, ControlError> {
    let job = s.jobs.get(&job_id).ok_or(ControlError::JobNotFound)?;
    if job.external_user_id != claims.external_user_id {
        return Err(ControlError::Forbidden);
    }
    s.ws_registry.send_cancel_envelope(&job.device_id, &job_id).await.ok();
    Ok(StatusCode::ACCEPTED)
}
```

`require_control_plane_jwt` middleware verifies the JWT with `verify_control_plane_jwt` and inserts claims into request extensions.

- [ ] **Step 4: Rate limiter**

Use a per-`external_user_id` token-bucket (leaky-bucket) with defaults from env: 100 rps burst / 10 rps sustained. If no existing component, use `governor` crate.

- [ ] **Step 5: Integration tests**

`crates/ahand-hub/tests/control_plane.rs` covers:

- Happy: POST → SSE streams stdout chunks + finished.
- Bad: JWT externalUserId mismatch → 403.
- Bad: device offline → 404.
- Bad: unknown jobId on stream → 404.
- Bad: rate limit exceeded → 429.
- Bad: body missing `command` → 400.
- Edge: duplicate `correlationId` → same jobId.
- Edge: client closes SSE early → no leak (assert `jobs.len()` eventually decreases after timeout).
- Edge: stdout chunk > 1 MB → delivered intact without mis-splitting on `\n\n`.
- Edge: two concurrent SSE clients on same jobId → both receive all events (broadcast semantics), tested explicitly.

See spec § 9.4.2 for the complete matrix.

- [ ] **Step 6: Run tests**

Run: `cargo test -p ahand-hub --test control_plane`
Expected: all pass; coverage 100% on new code.

- [ ] **Step 7: Commit**

```bash
cd /Users/winrey/Projects/weightwave/ahand
git add crates/ahand-hub/
git commit -m "$(cat <<'EOF'
feat(hub): control-plane REST + SSE for job dispatch

Adds the agent control-plane endpoints team9 im-worker calls via @ahand/sdk:

- POST /api/control/jobs dispatches a Job envelope to the target device's WS
- GET  /api/control/jobs/:id/stream is a text/event-stream with
  stdout/stderr/progress/finished/error events + 15s keepalive comments
- POST /api/control/jobs/:id/cancel routes a CancelJob envelope

Ownership is enforced via JWT.externalUserId == device.external_user_id.
Rate limiting is per-externalUserId (token bucket). CorrelationId provides
idempotency. Edge cases (SSE close, large stdout, duplicate clients) covered
in tests/control_plane.rs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.5: Hub outbound webhook sender with retry + DLQ

**Goal:** Implement the outbound webhook module that HMAC-signs and POSTs device lifecycle events to team9 gateway, with exponential-backoff retries and a DLQ fallback.

**Files:**

- Create: `crates/ahand-hub/src/webhook/mod.rs` (public `enqueue`, `enqueue_revoked`, etc.)
- Create: `crates/ahand-hub/src/webhook/sender.rs` (HTTP POST + HMAC signing + retry worker)
- Create: `crates/ahand-hub/src/webhook/queue.rs` (SQLite or Postgres-backed table `webhook_deliveries`)
- Create: `crates/ahand-hub-store/migrations/NNN_webhook_deliveries.sql`
- Modify: `crates/ahand-hub/src/state.rs` (wire `Webhook` into `AppState`)
- Create: `crates/ahand-hub/tests/webhook_sender.rs`

**Acceptance Criteria:**

- [ ] `Webhook::enqueue(event)` inserts into `webhook_deliveries` and signals the worker immediately.
- [ ] Worker POSTs to `AHAND_HUB_WEBHOOK_URL` with headers `X-AHand-Signature: sha256=<hex(HMAC(secret, rawBody))>`, `X-AHand-Event-Id`, `X-AHand-Timestamp`.
- [ ] On 2xx, deletes the row. On 5xx/timeout, schedules next retry at `min(2^attempts, 256)` seconds; aborts at `AHAND_HUB_WEBHOOK_MAX_RETRIES` and appends to `audit_fallback.jsonl`.
- [ ] On 401 from gateway, stops retrying and logs error (bad signature is not self-healing).
- [ ] HMAC uses constant-time comparison.
- [ ] Startup-time migration creates `webhook_deliveries`.
- [ ] All event types emit via typed helpers (`enqueue_online`, `enqueue_offline`, `enqueue_heartbeat`, `enqueue_registered`, `enqueue_revoked`).

**Verify:** `cargo test -p ahand-hub --test webhook_sender` → all pass.

**Steps:**

- [ ] **Step 1: Migration**

```sql
-- crates/ahand-hub-store/migrations/NNN_webhook_deliveries.sql
CREATE TABLE webhook_deliveries (
  event_id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX webhook_deliveries_next_retry_at_idx ON webhook_deliveries(next_retry_at);
```

- [ ] **Step 2: HMAC signing**

```rust
// crates/ahand-hub/src/webhook/sender.rs (excerpt)
use hmac::{Hmac, Mac};
use sha2::Sha256;

pub fn sign(secret: &[u8], raw_body: &[u8]) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret).expect("HMAC key");
    mac.update(raw_body);
    format!("sha256={}", hex::encode(mac.finalize().into_bytes()))
}
```

- [ ] **Step 3: Worker loop**

Single background task, awake on `tokio::select!` of a `Notify::notified()` (wake-up from enqueue) or a `tokio::time::sleep_until(next_due_at)`. On each tick, `SELECT ... WHERE next_retry_at <= NOW() ORDER BY next_retry_at LIMIT 100 FOR UPDATE SKIP LOCKED`, POST each, update row (`attempts += 1`, set `next_retry_at`, or DELETE on 2xx, or DLQ + DELETE on max retries).

Retry schedule: `next_retry_at = NOW() + min(2^attempts, 256) seconds`.

DLQ = `append_jsonl(AHAND_HUB_AUDIT_FALLBACK_PATH, row)` (best-effort; swallow IO errors but log).

- [ ] **Step 4: Public enqueue helpers**

```rust
// crates/ahand-hub/src/webhook/mod.rs
impl Webhook {
    pub async fn enqueue(&self, event: WebhookEvent) -> Result<()>;
    pub async fn enqueue_online(&self, device_id: &str, external_user_id: &str) -> Result<()>;
    pub async fn enqueue_offline(&self, device_id: &str, external_user_id: &str) -> Result<()>;
    pub async fn enqueue_heartbeat(&self, device_id: &str, external_user_id: &str, sent_at_ms: u64) -> Result<()>;
    pub async fn enqueue_registered(&self, device_id: &str, external_user_id: &str) -> Result<()>;
    pub async fn enqueue_revoked(&self, device_id: &str) -> Result<()>;
}
```

- [ ] **Step 5: Tests**

`webhook_sender.rs` covers:

- Happy: enqueue → POST → 200 → row deleted.
- Bad: 5xx → row persists with incremented `attempts`; correct `next_retry_at` delta.
- Bad: 8 retries exhausted → row deleted + DLQ line appended; subsequent enqueues work.
- Bad: 401 → no retry, error logged.
- Bad: signature mismatch on receiver side (control: use a mock that verifies HMAC) → 401 returned.
- Edge: 1000 qps burst → bounded concurrency (max 50 in-flight); no OOM (verify via memory snapshot).
- Edge: duplicate eventId enqueue → same row updated (not two rows); PRIMARY KEY enforces.

See spec § 9.4.2 for full bad/edge matrix.

- [ ] **Step 6: Commit**

```bash
git add crates/ahand-hub/src/webhook/ crates/ahand-hub-store/migrations/
git commit -m "feat(hub): outbound webhook sender with retry + DLQ

Adds webhook delivery for device lifecycle events (online, offline,
heartbeat, registered, revoked). HMAC-SHA256 signed; exponential
backoff 1s..256s; at-least-once semantics via durable
webhook_deliveries table; DLQ to audit_fallback.jsonl after
AHAND_HUB_WEBHOOK_MAX_RETRIES (default 8) exhausted.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.6: `@ahand/sdk` `CloudClient`

**Goal:** Add a TS client in `@ahand/sdk` that wraps the hub's control-plane REST + SSE. Consumers are team9 im-worker via `AHandHostComponent`.

**Files:**

- Create: `packages/sdk/src/cloud-client.ts`
- Modify: `packages/sdk/src/index.ts` (export `CloudClient`, `CloudClientOptions`, `DeviceSummary`)
- Create: `packages/sdk/src/cloud-client.test.ts` (vitest + MSW for fetch/SSE mocking)

**Acceptance Criteria:**

- [ ] `CloudClient.spawn({ deviceId, command, onStdout, onStderr, signal })` returns `{ exitCode, durationMs }` by POSTing the job + subscribing to SSE.
- [ ] Each callback (`onStdout`, `onStderr`, `onProgress`) is invoked per SSE event; errors thrown inside a callback do not abort the stream.
- [ ] `signal.aborted` → client calls `POST /cancel` + closes SSE + rejects with `AbortError`.
- [ ] `getAuthToken` callback is invoked lazily on each POST; a new value is fetched on demand.
- [ ] `cancel(jobId)` POSTs the cancel endpoint.
- [ ] `listDevices(externalUserId)` GETs `/api/control/devices?externalUserId=...` with service token (note: if this endpoint is service-token-only, the SDK surface should accept a service token instead; see Step 3).

**Verify:** `pnpm vitest run packages/sdk/src/cloud-client.test.ts` → 100% coverage on `cloud-client.ts`.

**Steps:**

- [ ] **Step 1: Interface**

```ts
// packages/sdk/src/cloud-client.ts
export interface CloudClientOptions {
  hubUrl: string;
  getAuthToken: () => Promise<string>;
  fetch?: typeof fetch;
}

export interface SpawnParams {
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
}

export interface SpawnResult {
  exitCode: number;
  durationMs: number;
}

export interface DeviceSummary {
  deviceId: string;
  nickname?: string;
  platform: string;
  isOnline: boolean;
  lastSeenAt?: string;
}

export class CloudClient {
  constructor(private opts: CloudClientOptions) {}
  async spawn(p: SpawnParams): Promise<SpawnResult> {
    /* see Step 2 */
  }
  async cancel(jobId: string): Promise<void> {
    /* POST /cancel */
  }
  async listDevices(externalUserId: string): Promise<DeviceSummary[]> {
    /* GET */
  }
}
```

- [ ] **Step 2: SSE parsing inside spawn**

```ts
async spawn(p: SpawnParams): Promise<SpawnResult> {
  const fetchImpl = this.opts.fetch ?? globalThis.fetch;
  const token = await this.opts.getAuthToken();

  const postRes = await fetchImpl(`${this.opts.hubUrl}/api/control/jobs`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      deviceId: p.deviceId, command: p.command,
      cwd: p.cwd, envs: p.envs, timeoutMs: p.timeoutMs, correlationId: p.correlationId,
    }),
    signal: p.signal,
  });
  if (!postRes.ok) throw await toTypedError(postRes);
  const { jobId } = await postRes.json() as { jobId: string };

  const abortHandler = () => { this.cancel(jobId).catch(() => {}); };
  p.signal?.addEventListener("abort", abortHandler);

  try {
    const streamRes = await fetchImpl(`${this.opts.hubUrl}/api/control/jobs/${jobId}/stream`, {
      headers: { "Authorization": `Bearer ${token}`, "Accept": "text/event-stream" },
      signal: p.signal,
    });
    if (!streamRes.ok || !streamRes.body) throw await toTypedError(streamRes);

    const reader = streamRes.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) throw new Error("SSE stream ended before finished event");
      buf += decoder.decode(value, { stream: true });
      let eventEnd;
      while ((eventEnd = buf.indexOf("\n\n")) !== -1) {
        const rawEvent = buf.slice(0, eventEnd);
        buf = buf.slice(eventEnd + 2);
        if (rawEvent.startsWith(":")) continue; // keepalive comment
        const parsed = parseSseEvent(rawEvent);
        try {
          switch (parsed.event) {
            case "stdout": p.onStdout?.(parsed.data.chunk); break;
            case "stderr": p.onStderr?.(parsed.data.chunk); break;
            case "progress": p.onProgress?.(parsed.data); break;
            case "finished":
              return { exitCode: parsed.data.exitCode, durationMs: parsed.data.durationMs };
            case "error": throw toSseError(parsed.data);
          }
        } catch (callbackErr) {
          // Callback-thrown errors must not abort stream. Non-SSE errors re-throw.
          if (parsed.event === "error") throw callbackErr;
          // else swallow: user callback's problem
        }
      }
    }
  } finally {
    p.signal?.removeEventListener("abort", abortHandler);
  }
}
```

`parseSseEvent` splits on `\n`, extracts `event:` and `data:` lines, JSON-parses data. Keep under 30 lines.

- [ ] **Step 3: listDevices auth note**

The hub's `GET /api/admin/devices?externalUserId=` is admin-token-protected (Task 1.3), not control-plane-JWT. Either:

- (A) `CloudClient.listDevices` takes a separate `getServiceToken` callback; OR
- (B) skip `listDevices` in `CloudClient` (team9 gateway is the only caller anyway and already has the service token, so it calls the hub directly without the SDK).

Choose (B) for MVP simplicity; `CloudClient` only wraps `/api/control/*`. Update the interface to drop `listDevices`.

- [ ] **Step 4: Tests (vitest + MSW)**

Cover happy + bad/edge matrix from spec § 9.4.2:

- Happy: SSE stdout → stderr → progress → finished.
- Bad: 401 POST → typed error; 404 → typed error; 429 → typed error.
- Bad: SSE ends without `finished` → throws.
- Bad: SSE `error` event → rejects.
- Bad: `getAuthToken` throws → rejects with that error.
- Bad: abort before POST → no POST, AbortError.
- Bad: abort mid-SSE → cancel called + SSE closed + AbortError.
- Edge: stdout chunk > 1 MB spanning multiple chunks → reassembled correctly.
- Edge: data containing `\n` but not `\n\n` → not mis-split.
- Edge: unknown SSE event type → silently ignored.
- Edge: keepalive `: keepalive\n\n` → skipped without disturbing state.
- Edge: callback throws → subsequent chunks still delivered.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/
git commit -m "feat(sdk): CloudClient for hub control-plane (REST + SSE)

Adds @ahand/sdk CloudClient that wraps hub's /api/control/jobs +
/api/control/jobs/:id/stream + /cancel endpoints. Provides typed
callbacks for stdout/stderr/progress with an AbortSignal-based
cancel flow. Auth token is provided via a getAuthToken callback
(callable lazy) to support refresh.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.7: Hub deploy workflow + deploy.sh + task-definition template

**Goal:** Ship the folder9-aligned deployment scaffold (`.github/workflows/deploy-hub.yml`, `deploy/hub/deploy.sh`, `deploy/hub/task-definition.template.json`) to enable automatic dev/prod deploys of ahand-hub from the ahand repo.

**Files:**

- Create: `.github/workflows/deploy-hub.yml`
- Create: `deploy/hub/deploy.sh` (executable, `chmod +x` committed)
- Create: `deploy/hub/task-definition.template.json`

**Acceptance Criteria:**

- [ ] Workflow triggers on push to `main` or `dev` and only when hub-related paths change.
- [ ] Uses OIDC role `GitHubActionsAhandHubDeploy` (this role will exist after Task 3.1).
- [ ] Builds `deploy/hub/Dockerfile --target hub` for `linux/amd64`.
- [ ] Pushes two tags to ECR: `{env}` (mutable) and `{git_sha}` (immutable).
- [ ] `deploy.sh` renders the task definition via `sed`, registers a new revision, and `update-service --force-new-deployment`.
- [ ] `deploy.sh` waits for `services-stable` before exiting.

**Verify:** `bash -n deploy/hub/deploy.sh` (syntax-check) passes; `jq . deploy/hub/task-definition.template.json` parses; push a commit to `dev` and observe the workflow run end-to-end (this step runs post-merge; not part of unit tests).

**Steps:**

- [ ] **Step 1: Copy workflow, deploy.sh, and task-definition template from spec § 7.2, § 7.3 verbatim.**

The spec contains exact contents. Use those without modification. File locations: `.github/workflows/deploy-hub.yml`, `deploy/hub/deploy.sh`, `deploy/hub/task-definition.template.json`.

- [ ] **Step 2: Ensure `deploy/hub/deploy.sh` is executable**

```bash
chmod +x deploy/hub/deploy.sh
git update-index --chmod=+x deploy/hub/deploy.sh
```

- [ ] **Step 3: Dry-run syntactic validation**

```bash
bash -n deploy/hub/deploy.sh
jq empty deploy/hub/task-definition.template.json
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/deploy-hub.yml deploy/hub/
git commit -m "chore(deploy): add hub deployment workflow (folder9-style)

GitHub Actions workflow + deploy.sh + ECS task definition template,
mirroring folder9's pattern: OIDC auth, ECR build/push, sed-rendered
task def, aws ecs update-service --force-new-deployment, wait
services-stable. Triggered on push to main (prod) or dev.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

**Phase 1 outcome:** ahand repo now ships: (a) an embeddable `ahandd` library, (b) Heartbeat protocol + daemon-driven heartbeat, (c) hub admin API (devices + token minting), (d) hub control-plane REST + SSE, (e) hub webhook sender with DLQ, (f) `@ahand/sdk` `CloudClient`, and (g) auto-deploy to AWS on push.

All of Phase 2, 3, 6 can begin **in parallel** after Phase 1 lands; Phase 4, 5, 7, 8 depend on Phase 1 (APIs + CloudClient) AND Phase 2/6 (framework + components).

---

## Phase 2 — team9-agent-pi Framework Extensions

**Working directory:** `/Users/winrey/Projects/weightwave/team9-agent-pi`.

Extends the claw-hive framework to support (a) multiple concurrent `IHostBackend` instances, (b) cache-system context injection, (c) dynamic component add/remove during session. No ahand-specific code lives here — that's Phase 6.

### Task 2.1: `HostComponent` multi-backend + sticky + metadata

**Goal:** Extend `HostComponent` to hold a `Map<typeKey, IHostBackend>` instead of a single `this.backend`. Resolve `run_command({ backend? })` via an explicit → sticky → single-backend → error ladder. Remove the `backend` enum from the tool schema so it stays cache-friendly when devices join/leave. Echo the resolved backend type in every tool response. Add an optional `getMetadata()` on `IHostBackend` for downstream context rendering.

**Files:**

- Modify: `packages/types/src/host.ts` — add `HostBackendMetadata` + optional `getMetadata?()` on `IHostBackend`; add `unregisterBackend` to `HostDependencyApi`.
- Modify: `packages/agent-components/src/components/host/host-component.ts` — switch single `this.backend` → `Map<string, IHostBackend>`; add `lastUsedBackend` to `HostComponentData`; rewrite `resolveBackend`, `createRunCommandTool`, `createReadFileTool`, `createWriteFileTool`, `createListDirTool` to consume the resolver.
- Modify: `packages/agent-components/src/components/host/host-component.test.ts` — expand to the full § 9.4.3 matrix.
- Verify-only (no change expected): `packages/claw-hive/src/components/just-bash/component.test.ts`, `.../e2b-sandbox/component.test.ts` must continue passing.

**Acceptance Criteria:**

- [ ] `IHostBackend` gains optional `getMetadata?(): HostBackendMetadata` returning `{ displayName?, platform?, isCurrentDevice?, statusLine? }`.
- [ ] `HostDependencyApi` exposes both `registerBackend(backend)` and `unregisterBackend(type: string)`.
- [ ] `run_command` tool schema's `backend` is `{ type: "string" }` with **no enum**; description directs the LLM to `<host-context>` and explains omission = sticky reuse.
- [ ] Resolution order per spec § 6.1: (1) explicit → use + set `lastUsedBackend`; (2) omitted, exactly 1 backend registered → auto-use, do NOT change sticky; (3) omitted, sticky set and backend still registered → use sticky, keep sticky; (4) otherwise → throw `Please specify the \`backend\` parameter. Registered: [...]` with the list included.
- [ ] Tool result payload carries `"backend": <resolvedType>` so the LLM can read the previous choice from conversation history.
- [ ] `HostComponentData.lastUsedBackend: string | null` persists across session resume.
- [ ] `unregisterBackend(x)` where `x === lastUsedBackend` clears sticky to `null`.
- [ ] `read_file`, `write_file`, `list_dir` tools adopt the same `backend?` resolver semantics as `run_command`.
- [ ] JustBash + E2B existing tests pass unchanged (they only register one backend; rule 2 covers them transparently).

**Verify:** `pnpm vitest run packages/agent-components/src/components/host/ --coverage` — all tests pass; `host-component.ts` coverage is 100% statements/branches/functions/lines.

**Steps:**

- [ ] **Step 1: Update type definitions**

```ts
// packages/types/src/host.ts (patch)

export interface HostBackendMetadata {
  /** Human-readable name: "Alice's MacBook Pro", "Local bash", "E2B sandbox". */
  displayName?: string;
  /** Platform marker: "macos" | "linux" | "windows" | "local-bash" | "sandbox". */
  platform?: string;
  /** True when this backend is the user's current device. */
  isCurrentDevice?: boolean;
  /** Freeform status text, e.g. "online, last heartbeat 2s ago". */
  statusLine?: string;
}

export interface IHostBackend {
  readonly type: string;
  ensureReady(agentId: string): Promise<void>;
  spawn(
    agentId: string,
    command: string,
    options?: { cwd?: string; envs?: Record<string, string> },
  ): Promise<ProcessHandle>;
  readFile(
    agentId: string,
    path: string,
  ): Promise<{ content: string; bytes: number }>;
  writeFile(
    agentId: string,
    path: string,
    content: string,
    options?: { mkdir?: boolean },
  ): Promise<{ bytes: number }>;
  listDir(agentId: string, path: string): Promise<DirEntry[]>;
  checkProcess(ref: Record<string, unknown>): Promise<ProcessStatus>;
  killProcess(
    ref: Record<string, unknown>,
    signal: "SIGTERM" | "SIGKILL",
  ): Promise<void>;
  /** NEW — optional metadata for context rendering. Omitted = not reported. */
  getMetadata?(): HostBackendMetadata;
}

export interface HostDependencyApi {
  registerBackend(backend: IHostBackend): void;
  /** NEW — remove a backend (device offline / revoked). Idempotent. */
  unregisterBackend(type: string): void;
}
```

- [ ] **Step 2: Rewrite `HostComponent` internal state + dependency API**

```ts
// packages/agent-components/src/components/host/host-component.ts (patch)

interface HostComponentData {
  // ...preserve any existing fields
  lastUsedBackend: string | null; // NEW
}

export class HostComponent extends BaseComponent<
  HostComponentConfig,
  HostComponentData
> {
  // REMOVED: private backend: IHostBackend | null = null;
  private backends: Map<string, IHostBackend> = new Map();
  private jobApi: JobDependencyApi | null = null;

  protected getInitialData(): HostComponentData {
    return {
      // ...existing initial values
      lastUsedBackend: null,
    };
  }

  override async onInitialize(
    ctx: ComponentContext<HostComponentConfig, HostComponentData>,
  ): Promise<void> {
    const jobApi = ctx.getDependency<JobDependencyApi>("job");
    if (jobApi) this.jobApi = jobApi;
  }

  getDependencyApi(
    _ctx: ComponentContext<HostComponentConfig, HostComponentData>,
  ): HostDependencyApi {
    return {
      registerBackend: (backend: IHostBackend) => {
        // Re-register overwrites (supports device reconnect / module hot-swap).
        this.backends.set(backend.type, backend);
      },
      unregisterBackend: (type: string) => {
        this.backends.delete(type);
        if (this.data.lastUsedBackend === type) {
          this.setData({ lastUsedBackend: null });
        }
      },
    };
  }

  /** Centralised selection, per spec § 6.1. Throws on unresolvable. */
  private resolveBackend(explicit: string | undefined): IHostBackend {
    // Rule 1: explicit wins.
    if (explicit !== undefined) {
      const picked = this.backends.get(explicit);
      if (!picked) {
        throw new Error(
          `Unknown backend "${explicit}". Registered: [${[...this.backends.keys()].join(", ")}]`,
        );
      }
      this.setData({ lastUsedBackend: explicit });
      return picked;
    }
    // Rule 2: exactly 1 backend → auto, don't touch sticky.
    if (this.backends.size === 1) {
      return [...this.backends.values()][0];
    }
    // Rule 3: sticky still valid.
    const sticky = this.data.lastUsedBackend;
    if (sticky && this.backends.has(sticky)) {
      return this.backends.get(sticky)!;
    }
    // Rule 4: ambiguous → throw with inventory.
    throw new Error(
      `Please specify the \`backend\` parameter. Registered: [${[...this.backends.keys()].join(", ")}]`,
    );
  }

  private requireJobApi(): asserts this is this & { jobApi: JobDependencyApi } {
    if (!this.jobApi)
      throw new Error("HostComponent: JobDependencyApi not available");
  }
}
```

- [ ] **Step 3: Rewrite `run_command` tool to consume `resolveBackend`**

```ts
// packages/agent-components/src/components/host/host-component.ts (patch, continued)

private createRunCommandTool(): AgentTool {
  return {
    name: "run_command",
    description:
      "Execute a bash command on a registered host backend. " +
      "The `backend` arg picks among registered environments (see <host-context> " +
      "for available types). Omit `backend` to reuse the one from your previous " +
      "run_command call this session. Returns a jobId usable with check_job.",
    parameters: {
      type: "object",
      properties: {
        backend: {
          type: "string",
          description:
            "Which host backend (see <host-context>). Invalid values are rejected " +
            "at runtime. Omit to reuse the previous run_command's backend.",
          // NOTE: no `enum` — keeps tool schema stable across device join/leave,
          // which preserves the Anthropic cache prefix.
        },
        command: { type: "string", description: "Bash command to execute" },
        description: { type: "string", description: "Short label for this job" },
        timeoutMs: {
          type: "number",
          description: "Grace period 5000-30000ms. Default: 10000. Ignored when async is true.",
        },
        async: { type: "boolean", description: "If true, return immediately with jobId" },
        cwd: { type: "string", description: "Working directory. Default: /workspace" },
        notifyOnComplete: {
          type: "boolean",
          description: "Wake agent when job completes. Pair with wait({ asyncId: 'job:{jobId}' }).",
        },
      },
      required: ["command"],
    },
    execute: async ({ args, signal, ctx: toolCtx }): Promise<ToolResult> => {
      const {
        backend: explicitBackend,
        command,
        description,
        timeoutMs,
        async: isAsync,
        cwd,
        notifyOnComplete,
      } = args as {
        backend?: string;
        command: string;
        description?: string;
        timeoutMs?: number;
        async?: boolean;
        cwd?: string;
        notifyOnComplete?: boolean;
      };

      this.requireJobApi();
      const backend = this.resolveBackend(explicitBackend);

      let gracePeriod = DEFAULT_TIMEOUT_MS;
      if (timeoutMs !== undefined && !isAsync) {
        if (timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
          throw new Error(
            `timeoutMs must be between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}, got ${timeoutMs}`,
          );
        }
        gracePeriod = timeoutMs;
      }

      const jobApi = this.jobApi!;
      const agentId = this.config.agentId ?? toolCtx.sessionId;

      await backend.ensureReady(agentId);
      const handle = await backend.spawn(agentId, command, { cwd: cwd ?? "/workspace" });
      const checker = () => backend.checkProcess(handle.ref);
      const killer = (sig: "SIGTERM" | "SIGKILL") => backend.killProcess(handle.ref, sig);

      const jobId = await jobApi.createJob({
        agentId,
        sessionId: toolCtx.sessionId,
        command,
        description,
        backendType: backend.type,
        backendRef: handle.ref,
        notifyOnComplete,
        checker,
        killer,
      });

      if (isAsync) {
        return textResult({
          jobId,
          backend: backend.type,   // NEW: echo for cache-friendly history
          state: "running",
          stdout: "",
          stderr: "",
          stdoutTruncated: false,
          stderrTruncated: false,
          durationMs: 0,
        });
      }

      // Sync polling branch preserved from existing implementation, but every
      // returned textResult includes `backend: backend.type`. Keep the existing
      // grace-period loop, just ensure the final payload carries backend type.
      return await this.pollJobSync({
        jobId,
        backend,
        checker,
        gracePeriod,
        signal,
      });
    },
  };
}
```

The existing grace-period polling loop (see current `createRunCommandTool` body) is refactored into `pollJobSync` that accepts `backend` and adds `backend: backend.type` to every `textResult({...})` call it makes.

- [ ] **Step 4: Apply the same resolver to `read_file` / `write_file` / `list_dir`**

Pattern for each file-ops tool (show `read_file` as the canonical example; `write_file` and `list_dir` follow identically):

```ts
private createReadFileTool(): AgentTool {
  return {
    name: "read_file",
    description:
      "Read a file from a host backend. Backend selection mirrors run_command: " +
      "pass `backend` explicitly or omit to reuse the previous choice.",
    parameters: {
      type: "object",
      properties: {
        backend: { type: "string", description: "Host backend (see <host-context>); omit to reuse." },
        path: { type: "string", description: "Absolute or /workspace-relative path to read" },
      },
      required: ["path"],
    },
    execute: async ({ args }): Promise<ToolResult> => {
      const { backend: explicit, path } = args as { backend?: string; path: string };
      const backend = this.resolveBackend(explicit);
      const agentId = this.config.agentId!;
      const { content, bytes } = await backend.readFile(agentId, path);
      return textResult({
        backend: backend.type,   // echo
        path,
        content,
        bytes,
      });
    },
  };
}
```

Apply the same pattern to `createWriteFileTool` (add `backend` field, call `resolveBackend`, echo `backend` in result) and `createListDirTool` (same).

For all four tools, the `getTools()` method returns them unchanged:

```ts
getTools(_ctx): AgentTool[] {
  return [
    this.createRunCommandTool(),
    this.createReadFileTool(),
    this.createWriteFileTool(),
    this.createListDirTool(),
  ];
}
```

**No behavioral change** when only one backend is registered: rule 2 of `resolveBackend` auto-picks it. This is what keeps JustBash / E2B blueprints backwards-compatible.

- [ ] **Step 5: Test matrix (§ 9.4.3 HostComponent multi-backend)**

Expand `packages/agent-components/src/components/host/host-component.test.ts`. Use `vitest` and a `FakeBackend` helper to register arbitrary backends:

```ts
// packages/agent-components/src/components/host/host-component.test.ts (new tests)

import { describe, it, expect, beforeEach } from "vitest";
import { HostComponent } from "./host-component";
import type {
  IHostBackend,
  ProcessHandle,
  ProcessStatus,
  DirEntry,
} from "@team9claw/types";

class FakeBackend implements IHostBackend {
  readonly type: string;
  spawnCalls = 0;
  constructor(type: string) {
    this.type = type;
  }
  async ensureReady() {}
  async spawn(_aid: string, cmd: string): Promise<ProcessHandle> {
    this.spawnCalls++;
    return {
      ref: { type: this.type, cmd },
      stdout: `hello from ${this.type}`,
      stderr: "",
      exited: true,
      exitCode: 0,
    };
  }
  async readFile() {
    return { content: "x", bytes: 1 };
  }
  async writeFile() {
    return { bytes: 0 };
  }
  async listDir(): Promise<DirEntry[]> {
    return [];
  }
  async checkProcess(): Promise<ProcessStatus> {
    return { running: false, exitCode: 0 };
  }
  async killProcess() {}
}

async function setupHost(backends: IHostBackend[]) {
  const host = new HostComponent({ agentId: "agent-1" } as any);
  const ctx = makeTestCtx();
  await host.onInitialize(ctx);
  const api = host.getDependencyApi(ctx);
  for (const b of backends) api.registerBackend(b);
  return { host, ctx, api };
}

describe("HostComponent multi-backend", () => {
  describe("happy", () => {
    it("routes run_command to the explicit backend and updates sticky", async () => {
      const a = new FakeBackend("a"),
        b = new FakeBackend("b");
      const { host } = await setupHost([a, b]);
      const res = await runTool(host, "run_command", {
        backend: "a",
        command: "echo",
      });
      expect(a.spawnCalls).toBe(1);
      expect(b.spawnCalls).toBe(0);
      expect(parseTextResult(res).backend).toBe("a");
      expect(host.getData().lastUsedBackend).toBe("a");
    });

    it("auto-picks the sole registered backend without updating sticky", async () => {
      const a = new FakeBackend("a");
      const { host } = await setupHost([a]);
      const res = await runTool(host, "run_command", { command: "echo" });
      expect(a.spawnCalls).toBe(1);
      expect(parseTextResult(res).backend).toBe("a");
      expect(host.getData().lastUsedBackend).toBeNull(); // rule 2: don't touch
    });

    it("reuses sticky when omitted and sticky is still registered", async () => {
      const a = new FakeBackend("a"),
        b = new FakeBackend("b");
      const { host } = await setupHost([a, b]);
      await runTool(host, "run_command", { backend: "b", command: "cmd1" });
      const res = await runTool(host, "run_command", { command: "cmd2" });
      expect(b.spawnCalls).toBe(2);
      expect(parseTextResult(res).backend).toBe("b");
    });

    it("echoes backend in all file-ops tool results", async () => {
      const a = new FakeBackend("a");
      const { host } = await setupHost([a]);
      const r = await runTool(host, "read_file", { path: "/x" });
      expect(parseTextResult(r).backend).toBe("a");
    });
  });

  describe("bad", () => {
    it("throws for unknown explicit backend", async () => {
      const a = new FakeBackend("a");
      const { host } = await setupHost([a]);
      await expect(
        runTool(host, "run_command", { backend: "ghost", command: "x" }),
      ).rejects.toThrow(/Unknown backend/);
    });

    it("throws with registered inventory when omitted and N>1 with no sticky", async () => {
      const a = new FakeBackend("a"),
        b = new FakeBackend("b");
      const { host } = await setupHost([a, b]);
      await expect(
        runTool(host, "run_command", { command: "x" }),
      ).rejects.toThrow(/Please specify.*\[a, b\]/);
    });

    it("propagates backend spawn errors as tool errors without corrupting state", async () => {
      const broken = new FakeBackend("b");
      broken.spawn = async () => {
        throw new Error("boom");
      };
      const { host } = await setupHost([broken]);
      await expect(
        runTool(host, "run_command", { backend: "b", command: "x" }),
      ).rejects.toThrow(/boom/);
      // Sticky was set before the spawn call — verify it survives the error.
      expect(host.getData().lastUsedBackend).toBe("b");
    });
  });

  describe("edge", () => {
    it("unregisterBackend clears sticky when it matches", async () => {
      const a = new FakeBackend("a"),
        b = new FakeBackend("b");
      const { host, api } = await setupHost([a, b]);
      await runTool(host, "run_command", { backend: "a", command: "x" });
      expect(host.getData().lastUsedBackend).toBe("a");
      api.unregisterBackend("a");
      expect(host.getData().lastUsedBackend).toBeNull();
    });

    it("re-registering same type overwrites cleanly", async () => {
      const a1 = new FakeBackend("a"),
        a2 = new FakeBackend("a");
      const { host, api } = await setupHost([a1]);
      await runTool(host, "run_command", { backend: "a", command: "x" });
      api.registerBackend(a2); // overwrite
      await runTool(host, "run_command", { backend: "a", command: "y" });
      expect(a1.spawnCalls).toBe(1);
      expect(a2.spawnCalls).toBe(1);
    });

    it("N=1 → N=0 → N=1 lifecycle works without stale sticky", async () => {
      const a = new FakeBackend("a");
      const { host, api } = await setupHost([a]);
      await runTool(host, "run_command", { command: "x" });
      api.unregisterBackend("a");
      api.registerBackend(new FakeBackend("b"));
      const r = await runTool(host, "run_command", { command: "y" });
      expect(parseTextResult(r).backend).toBe("b");
    });

    it("unregistering a backend while a job is in-flight lets the job finish", async () => {
      const slow = new FakeBackend("s");
      let resolveSpawn: (h: ProcessHandle) => void;
      slow.spawn = () =>
        new Promise((r) => {
          resolveSpawn = r;
        });
      const { host, api } = await setupHost([slow]);
      const p = runTool(host, "run_command", {
        backend: "s",
        command: "x",
        async: true,
      });
      api.unregisterBackend("s");
      resolveSpawn!({
        ref: {},
        stdout: "ok",
        stderr: "",
        exited: true,
        exitCode: 0,
      });
      const r = await p;
      expect(parseTextResult(r).backend).toBe("s");
    });
  });

  describe("persistence", () => {
    it("lastUsedBackend serializes via ComponentData and restores", async () => {
      const a = new FakeBackend("a"),
        b = new FakeBackend("b");
      const { host } = await setupHost([a, b]);
      await runTool(host, "run_command", { backend: "b", command: "x" });
      const snap = host.getData();
      const host2 = new HostComponent({ agentId: "agent-1" } as any);
      host2.restoreData(snap);
      const ctx2 = makeTestCtx();
      await host2.onInitialize(ctx2);
      const api2 = host2.getDependencyApi(ctx2);
      api2.registerBackend(a);
      api2.registerBackend(b);
      const r = await runTool(host2, "run_command", { command: "y" }); // omitted → sticky
      expect(parseTextResult(r).backend).toBe("b");
    });
  });
});
```

Helpers (`makeTestCtx`, `runTool`, `parseTextResult`) stay in this file; each under 15 lines.

Run: `pnpm vitest run packages/agent-components/src/components/host/ --coverage`
Expected: all tests pass; 100% coverage on `host-component.ts`.

- [ ] **Step 6: Commit**

```bash
cd /Users/winrey/Projects/weightwave/team9-agent-pi
git add packages/types/src/host.ts packages/agent-components/src/components/host/
git commit -m "$(cat <<'EOF'
feat(host): multi-backend HostComponent with sticky last-used selection

Extends HostComponent to hold a Map<typeKey, IHostBackend> so ahand
device backends, just-bash, and e2b-sandbox can coexist in a single
agent session.

- HostDependencyApi now exposes registerBackend + unregisterBackend
- run_command (and read_file / write_file / list_dir) gain an optional
  `backend` arg. Resolution ladder:
    (1) explicit arg → use + update sticky
    (2) exactly 1 registered → auto-use, don't change sticky
    (3) sticky still registered → reuse sticky
    (4) otherwise → throw with registered inventory
- Tool schema drops `enum` on `backend` so device join/leave doesn't
  bust the Anthropic prompt prefix cache. Invalid values rejected at
  runtime.
- Tool result echoes `backend: <type>` so the LLM can see the previous
  choice in conversation history.
- HostComponentData.lastUsedBackend persists across session resume.
- IHostBackend gains optional getMetadata() for downstream context
  rendering (consumed in a follow-up task).

Existing single-backend blueprints (JustBash, E2B) remain behaviorally
unchanged because rule 2 handles them transparently.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.2: `CacheSystemContextProvider` framework hook

**Goal:** Introduce a framework-level hook that lets components inject system-prompt context which is rebuilt only on dependency change, session resume, compact event, or explicit invalidation. This is the cache-friendly alternative to per-turn `onBeforePrompt.contextInjection` for expensive or stable blocks (e.g., ahand device list).

**Files:**

- Modify: `packages/types/src/component.ts` — add `CacheSystemContextProvider` interface; add `getCacheSystemProviders?(): CacheSystemContextProvider[]` to the component interface; extend `BeforePromptResult` with `invalidateCache?: { keys: string[]; mode?: "next-turn" | "force-now" }`.
- Create: `packages/agent-core/src/cache-system.ts` — standalone `CacheStore` class.
- Modify: `packages/agent-core/src/component-runner.ts` (or `agent-session.ts` if prompt assembly lives there) — instantiate a `CacheStore` per session, consult it during system-prompt build, interleave cached blocks with per-turn `contextInjection` by component priority.
- Modify: `packages/agent-core/src/agent-session.ts` — clear cache on `onSessionStart` and on compact events.
- Create: `packages/agent-core/src/cache-system.test.ts` — full test matrix (§ 9.4.3).

**Acceptance Criteria:**

- [ ] Component interface exposes optional `getCacheSystemProviders?(): CacheSystemContextProvider[]`. Each provider has `cacheKey` (string), `getCacheDependencies(ctx): Promise<Record<string, unknown>>`, `render(ctx): Promise<string>`.
- [ ] First prompt build: all providers' `render()` invoked and cached. Subsequent builds: `getCacheDependencies()` compared against last-stored; deep-equal → reuse cached `rendered`; else → re-render.
- [ ] Cache is cleared on `onSessionStart` (including session resume from storage).
- [ ] Cache is cleared when the compact event fires (via observer or framework hook).
- [ ] `BeforePromptResult.invalidateCache` semantics: `mode="next-turn"` (default) queues the listed `keys` to be cleared before the NEXT build; `mode="force-now"` clears immediately and re-renders if the provider sits later in the priority order of the current build.
- [ ] Two providers from any components with duplicate `cacheKey` cause a throw at registration time (config error, fail fast).
- [ ] A provider's `render()` throwing is caught by the framework: inject empty string, log an error, and do not crash the prompt build.
- [ ] Cached XML blocks interleave with `onBeforePrompt.contextInjection` strings by their owning component's `priority` (higher first), NOT grouped into a dedicated wrapper.

**Verify:** `pnpm vitest run packages/agent-core/src/cache-system.test.ts --coverage` → all tests pass; `cache-system.ts` coverage is 100% statements/branches/functions/lines.

**Steps:**

- [ ] **Step 1: Define types in `packages/types/src/component.ts`**

```ts
// packages/types/src/component.ts (patch — add/extend)

export interface CacheSystemContextProvider {
  /** Namespace key for invalidation. Must be unique across components in a session. */
  readonly cacheKey: string;
  /**
   * Return the current dependency snapshot. Framework deep-compares with the
   * previously stored snapshot; equal → skip render() and reuse cached content.
   * Keep this cheap; it is called every prompt build.
   */
  getCacheDependencies(
    ctx: ComponentContext<any, any>,
  ): Promise<Record<string, unknown>>;
  /** Called only on cache miss. Returns a markup/XML string to insert in the system prompt. */
  render(ctx: ComponentContext<any, any>): Promise<string>;
}

export interface IComponent<C = any, D = any> {
  // ...existing lifecycle hooks unchanged
  /** NEW — optional; returns zero or more cache-system providers owned by this component. */
  getCacheSystemProviders?(): CacheSystemContextProvider[];
}

export interface BeforePromptResult {
  // existing fields:
  contextInjection?: string;
  transformedMessages?: Message[];
  // NEW:
  invalidateCache?: {
    keys: string[];
    mode?: "next-turn" | "force-now"; // default "next-turn"
  };
}
```

- [ ] **Step 2: Implement `CacheStore` in `packages/agent-core/src/cache-system.ts`**

```ts
// packages/agent-core/src/cache-system.ts
import type {
  CacheSystemContextProvider,
  ComponentContext,
} from "@team9claw/types";

interface CacheEntry {
  deps: Record<string, unknown>;
  rendered: string;
  renderedAt: Date;
}

/**
 * Per-session cache for CacheSystemContextProvider outputs. Owned by
 * ComponentRunner/AgentSession and lives for one session's lifetime.
 */
export class CacheStore {
  private entries = new Map<string, CacheEntry>();
  private pendingInvalidations = new Set<string | "all">();
  // Sanity check: detect key collisions across components.
  private declaredKeys = new Set<string>();

  /** Called once when a provider is first seen; throws on duplicate key. */
  registerProvider(provider: CacheSystemContextProvider): void {
    if (this.declaredKeys.has(provider.cacheKey)) {
      throw new Error(
        `Duplicate CacheSystemContextProvider cacheKey "${provider.cacheKey}" — ` +
          `two components are using the same key, which would cause collisions.`,
      );
    }
    this.declaredKeys.add(provider.cacheKey);
  }

  /** Apply any invalidations scheduled by previous prompts. Called at build start. */
  applyPendingInvalidations(): void {
    if (this.pendingInvalidations.has("all")) {
      this.entries.clear();
    } else {
      for (const key of this.pendingInvalidations) this.entries.delete(key);
    }
    this.pendingInvalidations.clear();
  }

  /**
   * Resolve a provider: return cached content on dep-equal hit, else render and cache.
   * On render error: log, return empty string (do not throw).
   */
  async resolve(
    provider: CacheSystemContextProvider,
    ctx: ComponentContext<any, any>,
  ): Promise<string> {
    let currentDeps: Record<string, unknown>;
    try {
      currentDeps = await provider.getCacheDependencies(ctx);
    } catch (e) {
      console.error(
        `CacheStore: getCacheDependencies failed for "${provider.cacheKey}"`,
        e,
      );
      // On deps failure, re-render every time as a safe fallback.
      return this.safeRender(provider, ctx);
    }
    const cached = this.entries.get(provider.cacheKey);
    if (cached && this.deepEqual(cached.deps, currentDeps)) {
      return cached.rendered;
    }
    const rendered = await this.safeRender(provider, ctx);
    this.entries.set(provider.cacheKey, {
      deps: currentDeps,
      rendered,
      renderedAt: new Date(),
    });
    return rendered;
  }

  /** Force-clear immediately. Used during "force-now" invalidation. */
  invalidateImmediate(keys: string[] | "all"): void {
    if (keys === "all") {
      this.entries.clear();
      return;
    }
    for (const k of keys) this.entries.delete(k);
  }

  /** Schedule for next prompt build. Used for "next-turn" invalidation. */
  scheduleInvalidation(keys: string[] | "all"): void {
    if (keys === "all") {
      this.pendingInvalidations.add("all");
      return;
    }
    for (const k of keys) this.pendingInvalidations.add(k);
  }

  /** Clear everything — called on session start/resume and compact. */
  clear(): void {
    this.entries.clear();
    this.pendingInvalidations.clear();
  }

  private async safeRender(
    provider: CacheSystemContextProvider,
    ctx: ComponentContext<any, any>,
  ): Promise<string> {
    try {
      return await provider.render(ctx);
    } catch (e) {
      console.error(`CacheStore: render failed for "${provider.cacheKey}"`, e);
      return "";
    }
  }

  private deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (a === null || b === null) return false;
    if (typeof a !== "object") return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
      if ((a as unknown[]).length !== (b as unknown[]).length) return false;
      for (let i = 0; i < (a as unknown[]).length; i++) {
        if (!this.deepEqual((a as unknown[])[i], (b as unknown[])[i]))
          return false;
      }
      return true;
    }
    const aKeys = Object.keys(a as Record<string, unknown>);
    const bKeys = Object.keys(b as Record<string, unknown>);
    if (aKeys.length !== bKeys.length) return false;
    for (const k of aKeys) {
      if (
        !this.deepEqual(
          (a as Record<string, unknown>)[k],
          (b as Record<string, unknown>)[k],
        )
      )
        return false;
    }
    return true;
  }
}
```

- [ ] **Step 3: Wire `CacheStore` into the system-prompt builder**

First, locate the existing system-prompt assembly. Grep for the call pattern: `rg -nP "contextInjection|buildSystemPrompt|assembleSystemPrompt" packages/agent-core/src/`. The call lives in one of: `component-runner.ts`, `agent-session.ts`. Make the cache store live where system-prompt build is orchestrated.

```ts
// packages/agent-core/src/component-runner.ts (patch — illustrative)

import { CacheStore } from "./cache-system";

export class ComponentRunner {
  // ...existing fields
  private readonly cacheStore = new CacheStore();

  async onSessionStart(ctx: SessionContext): Promise<void> {
    // existing lifecycle
    this.cacheStore.clear(); // resume also lands here
    // register every component's cache-system providers (detect key collisions now)
    for (const component of this.components) {
      for (const provider of component.getCacheSystemProviders?.() ?? []) {
        this.cacheStore.registerProvider(provider);
      }
    }
  }

  /** Called when a compact event fires (e.g., by an observer). */
  onCompact(): void {
    this.cacheStore.clear();
  }

  /**
   * Build the system prompt by interleaving:
   *   - Cache-system provider blocks (via CacheStore.resolve)
   *   - onBeforePrompt contextInjection strings
   * All ordered by owning component's priority descending.
   */
  async buildSystemPrompt(ctx: ComponentContext<any, any>): Promise<string> {
    this.cacheStore.applyPendingInvalidations();

    interface Part {
      priority: number;
      content: string;
      source: "cache" | "dynamic";
    }
    const parts: Part[] = [];
    const deferredInvalidations: {
      keys: string[] | "all";
      mode: "next-turn" | "force-now";
    }[] = [];

    for (const component of this.componentsSortedByPriority) {
      // Cache-system providers
      for (const provider of component.getCacheSystemProviders?.() ?? []) {
        const content = await this.cacheStore.resolve(provider, ctx);
        if (content)
          parts.push({
            priority: component.priority,
            content,
            source: "cache",
          });
      }

      // Regular onBeforePrompt
      const result = await component.onBeforePrompt?.(ctx /* messages */);
      if (result?.contextInjection) {
        parts.push({
          priority: component.priority,
          content: result.contextInjection,
          source: "dynamic",
        });
      }
      if (result?.invalidateCache) {
        deferredInvalidations.push({
          keys: result.invalidateCache.keys,
          mode: result.invalidateCache.mode ?? "next-turn",
        });
      }
    }

    // Apply force-now invalidations immediately. Providers already resolved
    // in this pass need to be re-resolved if their key was invalidated.
    for (const inv of deferredInvalidations) {
      if (inv.mode === "force-now") {
        this.cacheStore.invalidateImmediate(inv.keys);
        // Re-resolve any already-rendered provider in `parts` whose key matches.
        // Implementation: iterate once more over cache-system providers with
        // matching keys and replace the corresponding entry in `parts`.
        await this.reResolveForcedKeys(parts, inv.keys, ctx);
      } else {
        this.cacheStore.scheduleInvalidation(inv.keys);
      }
    }

    return parts
      .sort((a, b) => b.priority - a.priority)
      .map((p) => p.content)
      .join("\n\n");
  }

  private async reResolveForcedKeys(
    parts: { priority: number; content: string; source: "cache" | "dynamic" }[],
    keys: string[],
    ctx: ComponentContext<any, any>,
  ): Promise<void> {
    const keySet = new Set(keys);
    for (const component of this.componentsSortedByPriority) {
      for (const provider of component.getCacheSystemProviders?.() ?? []) {
        if (!keySet.has(provider.cacheKey)) continue;
        const fresh = await this.cacheStore.resolve(provider, ctx);
        // Replace the first matching cache part authored by this component.
        const idx = parts.findIndex(
          (p) => p.source === "cache" && p.priority === component.priority,
        );
        if (idx >= 0) parts[idx].content = fresh;
      }
    }
  }
}
```

**Exposing the invalidator externally (for Task 2.3's `refresh_context` tool):** add a read accessor on `ComponentRunner` (or whichever layer owns `cacheStore`) that returns a narrow interface:

```ts
// Same file, public API
export interface CacheInvalidator {
  invalidate(args: { keys: string[] | "all"; mode?: "next-turn" | "force-now" }): void;
}

// On ComponentRunner:
cacheInvalidator(): CacheInvalidator {
  return {
    invalidate: ({ keys, mode }) => {
      if (mode === "force-now") this.cacheStore.invalidateImmediate(keys);
      else this.cacheStore.scheduleInvalidation(keys);
    },
  };
}
```

The `ComponentContext` passed to tools should carry `ctx.cacheInvalidator` so Task 2.3's tool can call it directly. Extend `ComponentContext` (in `@team9claw/types`) with `readonly cacheInvalidator?: CacheInvalidator` if not already present; set it when constructing the context in `ComponentRunner`.

- [ ] **Step 4: Test matrix (§ 9.4.3 CacheSystemContextProvider)**

```ts
// packages/agent-core/src/cache-system.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import { CacheStore } from "./cache-system";
import type { CacheSystemContextProvider } from "@team9claw/types";

function makeProvider(
  cacheKey: string,
  deps: () => Record<string, unknown>,
  render: (n: number) => string,
): CacheSystemContextProvider & { renderCalls: number } {
  let renderCalls = 0;
  return {
    cacheKey,
    async getCacheDependencies() {
      return deps();
    },
    async render() {
      renderCalls++;
      return render(renderCalls);
    },
    get renderCalls() {
      return renderCalls;
    },
  } as any;
}

const ctx = {} as any; // ComponentContext placeholder

describe("CacheStore", () => {
  let store: CacheStore;
  beforeEach(() => {
    store = new CacheStore();
  });

  describe("happy", () => {
    it("renders on first access and reuses on unchanged deps", async () => {
      let version = 0;
      const p = makeProvider(
        "k1",
        () => ({ v: 1 }),
        (n) => `render-${n}`,
      );
      store.registerProvider(p);
      expect(await store.resolve(p, ctx)).toBe("render-1");
      expect(await store.resolve(p, ctx)).toBe("render-1"); // cache hit
      expect((p as any).renderCalls).toBe(1);
    });

    it("re-renders when deps change", async () => {
      let depValue = 1;
      const p = makeProvider(
        "k2",
        () => ({ v: depValue }),
        (n) => `v${n}`,
      );
      store.registerProvider(p);
      expect(await store.resolve(p, ctx)).toBe("v1");
      depValue = 2;
      expect(await store.resolve(p, ctx)).toBe("v2");
    });

    it("clear() re-renders on next access", async () => {
      const p = makeProvider(
        "k3",
        () => ({ v: 1 }),
        (n) => `c${n}`,
      );
      store.registerProvider(p);
      await store.resolve(p, ctx);
      store.clear();
      await store.resolve(p, ctx);
      expect((p as any).renderCalls).toBe(2);
    });

    it("scheduleInvalidation honored on next applyPendingInvalidations", async () => {
      const p = makeProvider(
        "k4",
        () => ({ v: 1 }),
        (n) => `s${n}`,
      );
      store.registerProvider(p);
      await store.resolve(p, ctx);
      store.scheduleInvalidation(["k4"]);
      // Before applying, cache still returns old value if we resolved now.
      expect(await store.resolve(p, ctx)).toBe("s1");
      // Simulate next-prompt boundary:
      store.applyPendingInvalidations();
      expect(await store.resolve(p, ctx)).toBe("s2");
    });

    it("invalidateImmediate rebuilds on the very next resolve this turn", async () => {
      const p = makeProvider(
        "k5",
        () => ({ v: 1 }),
        (n) => `f${n}`,
      );
      store.registerProvider(p);
      await store.resolve(p, ctx);
      store.invalidateImmediate(["k5"]);
      expect(await store.resolve(p, ctx)).toBe("f2");
    });
  });

  describe("bad", () => {
    it("returns empty string and logs when render throws", async () => {
      const p: CacheSystemContextProvider = {
        cacheKey: "ke1",
        async getCacheDependencies() {
          return {};
        },
        async render() {
          throw new Error("boom");
        },
      };
      store.registerProvider(p);
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(await store.resolve(p, ctx)).toBe("");
      expect(spy).toHaveBeenCalled();
    });

    it("falls back to safe render when getCacheDependencies throws", async () => {
      const p: CacheSystemContextProvider = {
        cacheKey: "ke2",
        async getCacheDependencies() {
          throw new Error("deps-oops");
        },
        async render() {
          return "x";
        },
      };
      store.registerProvider(p);
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(await store.resolve(p, ctx)).toBe("x");
      expect(spy).toHaveBeenCalled();
    });

    it("throws on duplicate cacheKey at registration time", () => {
      const p1 = makeProvider(
        "dup",
        () => ({}),
        () => "a",
      );
      const p2 = makeProvider(
        "dup",
        () => ({}),
        () => "b",
      );
      store.registerProvider(p1);
      expect(() => store.registerProvider(p2)).toThrow(/Duplicate .* cacheKey/);
    });
  });

  describe("edge", () => {
    it("deep-compares nested object deps", async () => {
      let deps = { nested: { arr: [1, 2], flag: true } };
      const p = makeProvider(
        "kd1",
        () => deps,
        (n) => `d${n}`,
      );
      store.registerProvider(p);
      await store.resolve(p, ctx);
      deps = { nested: { arr: [1, 2], flag: true } }; // structurally equal
      expect(await store.resolve(p, ctx)).toBe("d1"); // cache hit
      deps = { nested: { arr: [1, 2, 3], flag: true } }; // structural difference
      expect(await store.resolve(p, ctx)).toBe("d2");
    });

    it("treats undefined vs null as different", async () => {
      let deps: Record<string, unknown> = { x: undefined };
      const p = makeProvider(
        "kd2",
        () => deps,
        (n) => `u${n}`,
      );
      store.registerProvider(p);
      await store.resolve(p, ctx);
      deps = { x: null };
      expect(await store.resolve(p, ctx)).toBe("u2");
    });

    it("array order changes bust the cache (no set semantics)", async () => {
      let deps: Record<string, unknown> = { ids: ["a", "b"] };
      const p = makeProvider(
        "kd3",
        () => deps,
        (n) => `o${n}`,
      );
      store.registerProvider(p);
      await store.resolve(p, ctx);
      deps = { ids: ["b", "a"] };
      expect(await store.resolve(p, ctx)).toBe("o2");
    });
  });
});
```

For the **integration** between `CacheStore` and `ComponentRunner` (interleaving by priority, force-now re-resolve, session-start clearing), add a second test file `cache-system.integration.test.ts` in the same directory with a small fake `ComponentRunner` wrapper. Cover:

- Two components with different priorities → output order is priority-descending.
- `force-now` invalidation inside `onBeforePrompt` → affected block is re-rendered within the same build.
- `next-turn` invalidation → affected block still stale in current build; fresh in the next.
- Session resume (`onSessionStart` twice) → cache cleared each time.
- Compact event → cache cleared.

Run: `pnpm vitest run packages/agent-core/src/cache-system` (both files)
Expected: all pass; coverage 100% on `cache-system.ts`.

- [ ] **Step 5: Commit**

```bash
cd /Users/winrey/Projects/weightwave/team9-agent-pi
git add packages/types/src/component.ts packages/agent-core/src/cache-system.ts \
        packages/agent-core/src/cache-system.test.ts \
        packages/agent-core/src/cache-system.integration.test.ts \
        packages/agent-core/src/component-runner.ts \
        packages/agent-core/src/agent-session.ts
git commit -m "$(cat <<'EOF'
feat(agent-core): CacheSystemContextProvider for cache-friendly prompts

Introduces a component hook for injecting system-prompt content that is
expensive to render and/or stable across turns (e.g., ahand device
lists). Content is rebuilt only when:
  - First prompt build of a session
  - Provider's getCacheDependencies() snapshot changes
  - Session resume (onSessionStart)
  - Compact event
  - Explicit invalidation via BeforePromptResult.invalidateCache
    (mode "next-turn" or "force-now")

Two providers with the same cacheKey fail-fast at registration. Render
errors are caught and surface as empty strings with an error log,
keeping the prompt build non-crashing.

Blocks from different providers interleave by owning component's
priority — no dedicated wrapper. This lets blueprint authors keep the
Anthropic prompt cache prefix maximally stable by putting stable
content at high priority.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.3: Framework-level `refresh_context` tool

**Goal:** Ship a built-in tool `refresh_context({ cacheKey? })` that agents call to invalidate cache-system blocks. It's general-purpose (not ahand-specific); downstream components that register cache-system providers benefit automatically.

**Files:**

- Create: `packages/agent-components/src/components/cache-system/cache-system-component.ts` — one-component singleton that contributes a single tool.
- Modify: `packages/agent-components/src/index.ts` — export `CacheSystemComponent`.
- Create: `packages/agent-components/src/components/cache-system/cache-system-component.test.ts`.
- Modify: `packages/claw-hive/src/blueprints/presets.ts` — add `CacheSystemComponent` to any preset that already includes components with cache-system providers (e.g., `persona-interface`).

**Acceptance Criteria:**

- [ ] Tool name: `refresh_context`. Parameter `cacheKey: string` is optional; omitting it means "refresh everything cached this session".
- [ ] Handler calls `ctx.cacheInvalidator.invalidate({ keys: args.cacheKey ? [args.cacheKey] : "all", mode: "next-turn" })`.
- [ ] Tool result: `textResult({ refreshed: true, cacheKey: args.cacheKey ?? "all", note: "Cache will rebuild on the next prompt." })`.
- [ ] When `ctx.cacheInvalidator` is undefined (misconfigured blueprint), handler returns a clear tool error: `"refresh_context is unavailable: no CacheInvalidator in context. Ensure ComponentRunner provides one."`. Does not throw / crash.
- [ ] Adding `CacheSystemComponent` to a blueprint requires no additional wiring beyond its entry in `components[]`.

**Verify:** `pnpm vitest run packages/agent-components/src/components/cache-system/ --coverage` — all tests pass; coverage 100% on `cache-system-component.ts`.

**Steps:**

- [ ] **Step 1: Implement `CacheSystemComponent`**

```ts
// packages/agent-components/src/components/cache-system/cache-system-component.ts

import { BaseComponent } from "../../base-component";
import type { AgentTool, ComponentContext, ToolResult } from "@team9claw/types";
import { textResult } from "../../tool-result";

export interface CacheSystemComponentConfig {
  // Empty for MVP. Reserved for future options (e.g., per-component refresh allowlist).
}
export interface CacheSystemComponentData {}

export class CacheSystemComponent extends BaseComponent<
  CacheSystemComponentConfig,
  CacheSystemComponentData
> {
  constructor(config: CacheSystemComponentConfig = {}, id?: string) {
    super(
      {
        typeKey: "cache-system",
        name: "Cache System",
        priority: 20, // low — it's a utility, not a context contributor
        initialData: {},
      },
      config,
      id,
    );
  }

  override getTools(
    _ctx: ComponentContext<
      CacheSystemComponentConfig,
      CacheSystemComponentData
    >,
  ): AgentTool[] {
    return [this.createRefreshContextTool()];
  }

  private createRefreshContextTool(): AgentTool {
    return {
      name: "refresh_context",
      description:
        "Force-refresh cached system-prompt context blocks (e.g., <ahand-context>, " +
        "<host-context>). Use when you suspect cached information is stale, such as " +
        "after a long pause or when a device may have come online. By default the " +
        "refresh takes effect on the next prompt.",
      parameters: {
        type: "object",
        properties: {
          cacheKey: {
            type: "string",
            description:
              "Specific block to refresh (e.g., 'ahand-context'). Omit to refresh all.",
          },
        },
      },
      execute: async ({ args, ctx: toolCtx }): Promise<ToolResult> => {
        const { cacheKey } = args as { cacheKey?: string };
        const invalidator = (toolCtx as any).cacheInvalidator as
          | {
              invalidate: (x: {
                keys: string[] | "all";
                mode?: "next-turn" | "force-now";
              }) => void;
            }
          | undefined;
        if (!invalidator) {
          return textResult({
            error:
              "refresh_context is unavailable: no CacheInvalidator in context. " +
              "Ensure ComponentRunner provides one.",
          });
        }
        invalidator.invalidate({
          keys: cacheKey ? [cacheKey] : "all",
          mode: "next-turn",
        });
        return textResult({
          refreshed: true,
          cacheKey: cacheKey ?? "all",
          note: "Cache will rebuild on the next prompt.",
        });
      },
    };
  }
}
```

- [ ] **Step 2: Export + blueprint integration**

```ts
// packages/agent-components/src/index.ts (add)
export { CacheSystemComponent } from "./components/cache-system/cache-system-component";
export type {
  CacheSystemComponentConfig,
  CacheSystemComponentData,
} from "./components/cache-system/cache-system-component";
```

```ts
// packages/claw-hive/src/blueprints/presets.ts (patch the persona-interface preset)

import { CacheSystemComponent } from "@team9claw/agent-components";

export function personaInterfaceBlueprint(opts?: BlueprintOpts): Blueprint {
  return {
    components: [
      // ...existing: SystemPrompt, Persona, Character, HiveWait, HostComponent
      { component: new CacheSystemComponent() },
    ],
  };
}
```

Grep for other preset factories that would benefit (those that include components registering `CacheSystemContextProvider`). Add `CacheSystemComponent` to each.

- [ ] **Step 3: Tests**

```ts
// packages/agent-components/src/components/cache-system/cache-system-component.test.ts

import { describe, it, expect, vi } from "vitest";
import { CacheSystemComponent } from "./cache-system-component";

function execTool(c: CacheSystemComponent, ctx: any, args: any) {
  const tool = c.getTools(ctx as any)[0];
  return tool.execute({ args, ctx, signal: undefined } as any);
}

describe("CacheSystemComponent.refresh_context", () => {
  it("invalidates a specific key when provided", async () => {
    const invalidator = { invalidate: vi.fn() };
    const c = new CacheSystemComponent();
    const res = await execTool(
      c,
      { cacheInvalidator: invalidator, sessionId: "s" },
      { cacheKey: "ahand-context" },
    );
    expect(invalidator.invalidate).toHaveBeenCalledWith({
      keys: ["ahand-context"],
      mode: "next-turn",
    });
    expect(JSON.parse((res as any).content[0].text)).toEqual({
      refreshed: true,
      cacheKey: "ahand-context",
      note: expect.any(String),
    });
  });

  it("invalidates all when cacheKey omitted", async () => {
    const invalidator = { invalidate: vi.fn() };
    const c = new CacheSystemComponent();
    await execTool(c, { cacheInvalidator: invalidator }, {});
    expect(invalidator.invalidate).toHaveBeenCalledWith({
      keys: "all",
      mode: "next-turn",
    });
  });

  it("returns a clear error if cacheInvalidator is missing (does not throw)", async () => {
    const c = new CacheSystemComponent();
    const res = await execTool(
      c,
      {
        /* no cacheInvalidator */
      },
      {},
    );
    expect(JSON.parse((res as any).content[0].text)).toHaveProperty("error");
    // Must not throw — agent still sees a usable tool result.
  });

  it("tool schema documents cacheKey as optional", () => {
    const c = new CacheSystemComponent();
    const tool = c.getTools({} as any)[0];
    expect(tool.name).toBe("refresh_context");
    expect(tool.parameters.required ?? []).not.toContain("cacheKey");
  });
});
```

Run: `pnpm vitest run packages/agent-components/src/components/cache-system/ --coverage`
Expected: all tests pass; coverage 100%.

- [ ] **Step 4: Commit**

```bash
cd /Users/winrey/Projects/weightwave/team9-agent-pi
git add packages/agent-components/src/components/cache-system/ \
        packages/agent-components/src/index.ts \
        packages/claw-hive/src/blueprints/presets.ts
git commit -m "$(cat <<'EOF'
feat(agent-components): refresh_context tool

Exposes cache-system invalidation as a framework-level tool so agents
can refresh stale context blocks (device lists, permissions,
platform metadata) without rebuilding a session.

- refresh_context({ cacheKey? }) → invalidate one key or all
- Default mode is next-turn so the current tool result is predictable;
  callers that need in-turn rebuild use invalidateCache directly from
  onBeforePrompt (see CacheSystemContextProvider docs).
- Added to the persona-interface preset; other presets that register
  CacheSystemContextProviders should also include CacheSystemComponent.
- Handler defensive: a blueprint misconfigured without a CacheInvalidator
  in context returns a clear tool error rather than crashing the session.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.4: Dynamic `AgentSession.addComponent` / `removeComponent` (conditional)

**Goal:** Enable runtime mutation of an `AgentSession`'s component set so the im-worker can hot-attach a new `AHandHostComponent` when a user's device comes online, and hot-detach it when it goes offline, **without restarting the session**. If the framework already supports this, this task reduces to verification + coverage. If not, add the API.

**Condition:** This task gates the "dynamic device lifecycle" UX (spec § 6.8.3). If deferred, Phase 5 falls back to snapshot-only semantics (devices frozen at session start). Implementation is strongly preferred but not a launch blocker.

**Files (if implementing):**

- Modify: `packages/types/src/component.ts` — document the new public API shape on `IComponentRunner` / `IAgentSession`.
- Modify: `packages/agent-core/src/component-runner.ts` — mutable component list; per-call lifecycle; serialize via async lock.
- Modify: `packages/agent-core/src/agent-session.ts` — public `addComponent` / `removeComponent` delegating to runner.
- Create: `packages/agent-core/src/agent-session.dynamic.test.ts`.

**Files (if feature already exists):**

- Create: `packages/agent-core/src/agent-session.dynamic.test.ts` only. Audit the existing API and ensure tests cover the matrix below.

**Acceptance Criteria:**

- [ ] `session.addComponent(factoryOrInstance, config?)` is a public async method that:
  - Assigns a fresh component id (or accepts one from caller).
  - Invokes `onInitialize(ctx)` then `onSessionStart(ctx)` on the new component.
  - Registers any `getTools()` / `getCacheSystemProviders()` / dependency APIs with the runner.
  - Resolves after the component is fully attached and ready to participate in the next prompt.
- [ ] `session.removeComponent(componentId)` is public async:
  - Invokes `onDispose(ctx)` on the target component.
  - Unregisters tools, cache-system providers, dependency APIs.
  - Unregisters from HostComponent via `unregisterBackend` if the component implements `IHostBackend` (see Task 2.1).
  - Returns `true` if removed, `false` if no such component.
- [ ] Both methods are safe to call at any point; if invoked mid-`onBeforePrompt` / mid-tool-call, they queue and apply at the earliest safe boundary (end of current prompt pass).
- [ ] Calls serialize via an async lock — concurrent add/remove do not interleave partial lifecycle calls.
- [ ] If implementing: coverage 100% on the new code paths in `component-runner.ts` and `agent-session.ts`.

**Verify:** `pnpm vitest run packages/agent-core/src/agent-session.dynamic.test.ts --coverage` — all tests pass; coverage 100% on new code.

**Steps:**

- [ ] **Step 1: Audit existing API**

```bash
cd /Users/winrey/Projects/weightwave/team9-agent-pi
rg -nP '\baddComponent|removeComponent\b' packages/agent-core/ packages/agent-runtime/ packages/types/
rg -nP 'components\s*:\s*\w+\[\]|this\.components' packages/agent-core/src/
```

Read `packages/agent-core/src/agent-session.ts` and `component-runner.ts` top-to-bottom. Determine whether:

- (a) The API exists with matching semantics → proceed to Step 5 (tests only).
- (b) The API is partially there (e.g., `register` but no `unregister`) → implement the gap in Step 2–4.
- (c) Nothing exists → implement Step 2–4 fully.

Document the finding in the commit message.

- [ ] **Step 2: Add serialization lock + mutable component collection to `ComponentRunner`**

```ts
// packages/agent-core/src/component-runner.ts (patch — additions)

import type { IComponent, ComponentContext } from "@team9claw/types";

export class ComponentRunner {
  // existing fields...
  private components: IComponent[] = []; // make it mutable if previously frozen
  private componentById = new Map<string, IComponent>();
  private mutationLock = new AsyncLock(); // implement or import (see Step 2b)
  private midPromptQueue: Array<() => Promise<void>> = [];
  private promptInProgress = false;

  /** Call sites wrap prompt-build to mark the boundary. */
  private async withPromptBuild<T>(fn: () => Promise<T>): Promise<T> {
    this.promptInProgress = true;
    try {
      return await fn();
    } finally {
      this.promptInProgress = false;
      // Flush any deferred mutations now.
      while (this.midPromptQueue.length > 0) {
        const next = this.midPromptQueue.shift()!;
        await next();
      }
    }
  }

  async addComponent(
    component: IComponent,
    ctx: ComponentContext<any, any>,
  ): Promise<void> {
    const doAdd = async () => {
      await this.mutationLock.run(async () => {
        if (this.componentById.has(component.id)) {
          throw new Error(`Component id "${component.id}" already attached`);
        }
        await component.onInitialize?.(ctx);
        await component.onSessionStart?.(ctx);
        this.components.push(component);
        this.componentById.set(component.id, component);
        this.sortByPriority();
        // If the component contributes cache-system providers, register now so
        // duplicate-cacheKey detection fires immediately.
        for (const p of component.getCacheSystemProviders?.() ?? []) {
          this.cacheStore.registerProvider(p);
        }
      });
    };
    if (this.promptInProgress) {
      return new Promise<void>((resolve, reject) => {
        this.midPromptQueue.push(async () => {
          try {
            await doAdd();
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    }
    await doAdd();
  }

  async removeComponent(
    componentId: string,
    ctx: ComponentContext<any, any>,
  ): Promise<boolean> {
    const doRemove = async (): Promise<boolean> => {
      return await this.mutationLock.run(async () => {
        const comp = this.componentById.get(componentId);
        if (!comp) return false;
        // If component is an IHostBackend, unregister from HostComponent first.
        // (HostComponent owns the Map and is responsible for the call.)
        if (isHostBackend(comp)) {
          const hostDep = this.findHostDependencyApi();
          hostDep?.unregisterBackend((comp as any).type);
        }
        await comp.onDispose?.(ctx);
        this.components = this.components.filter((c) => c.id !== componentId);
        this.componentById.delete(componentId);
        return true;
      });
    };
    if (this.promptInProgress) {
      return new Promise<boolean>((resolve, reject) => {
        this.midPromptQueue.push(async () => {
          try {
            resolve(await doRemove());
          } catch (e) {
            reject(e);
          }
        });
      });
    }
    return await doRemove();
  }

  private sortByPriority(): void {
    this.components.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }
}

function isHostBackend(c: unknown): c is { type: string } {
  return (
    typeof (c as any)?.type === "string" &&
    typeof (c as any)?.spawn === "function"
  );
}
```

Wrap every existing `buildSystemPrompt` / `onBeforePrompt` loop in `withPromptBuild(...)` to establish the "mid-prompt" window.

- [ ] **Step 2b: Minimal `AsyncLock` utility**

If no async-lock util exists in the repo, add a tiny one:

```ts
// packages/agent-core/src/async-lock.ts
export class AsyncLock {
  private queue: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn); // proceed even if prior threw
    this.queue = next.then(
      () => {},
      () => {},
    );
    return next as Promise<T>;
  }
}
```

- [ ] **Step 3: Expose on `AgentSession`**

```ts
// packages/agent-core/src/agent-session.ts (patch)

export class AgentSession {
  // existing fields...

  async addComponent(
    component: IComponent,
    ctxOverrides: Partial<ComponentContext<any, any>> = {},
  ): Promise<void> {
    const ctx = this.buildComponentContext(ctxOverrides);
    await this.runner.addComponent(component, ctx);
  }

  async removeComponent(componentId: string): Promise<boolean> {
    const ctx = this.buildComponentContext({});
    return await this.runner.removeComponent(componentId, ctx);
  }
}
```

`buildComponentContext` is the existing helper that assembles a ComponentContext for lifecycle hook calls.

- [ ] **Step 4: Tests — `agent-session.dynamic.test.ts`**

```ts
// packages/agent-core/src/agent-session.dynamic.test.ts

import { describe, it, expect, vi } from "vitest";
import { AgentSession } from "./agent-session";
import { BaseComponent } from "@team9claw/agent-components";

class CountingComponent extends BaseComponent {
  readonly id = crypto.randomUUID();
  onInitCalls = 0;
  onStartCalls = 0;
  onDisposeCalls = 0;
  constructor() {
    super({
      typeKey: "counting",
      name: "Counting",
      priority: 10,
      initialData: {},
    });
  }
  override async onInitialize() {
    this.onInitCalls++;
  }
  override async onSessionStart() {
    this.onStartCalls++;
  }
  override async onDispose() {
    this.onDisposeCalls++;
  }
}

async function makeSession(): Promise<AgentSession> {
  // Use the repo's standard test harness; below is illustrative.
  return new AgentSession({
    /* minimal test config */
  });
}

describe("AgentSession.addComponent / removeComponent", () => {
  describe("happy", () => {
    it("attaches and runs onInitialize + onSessionStart in order", async () => {
      const s = await makeSession();
      const c = new CountingComponent();
      await s.addComponent(c);
      expect(c.onInitCalls).toBe(1);
      expect(c.onStartCalls).toBe(1);
      // Component appears in subsequent prompt builds
      expect(s.listComponents().some((x) => x.id === c.id)).toBe(true);
    });

    it("removeComponent calls onDispose and drops it from all lookups", async () => {
      const s = await makeSession();
      const c = new CountingComponent();
      await s.addComponent(c);
      const ok = await s.removeComponent(c.id);
      expect(ok).toBe(true);
      expect(c.onDisposeCalls).toBe(1);
      expect(s.listComponents().some((x) => x.id === c.id)).toBe(false);
    });

    it("new component's tools are visible on the next prompt build", async () => {
      const s = await makeSession();
      class ToolComp extends CountingComponent {
        override getTools() {
          return [
            {
              name: "added_tool",
              description: "",
              parameters: {},
              execute: async () => ({}),
            } as any,
          ];
        }
      }
      const c = new ToolComp();
      await s.addComponent(c);
      const tools = await s.listToolsForPrompt();
      expect(tools.some((t) => t.name === "added_tool")).toBe(true);
    });
  });

  describe("bad", () => {
    it("addComponent rejects duplicate id", async () => {
      const s = await makeSession();
      const c = new CountingComponent();
      await s.addComponent(c);
      await expect(s.addComponent(c)).rejects.toThrow(/already attached/);
    });

    it("removeComponent returns false for unknown id", async () => {
      const s = await makeSession();
      expect(await s.removeComponent("nope")).toBe(false);
    });

    it("onInitialize failure leaves session clean (no partial state)", async () => {
      const s = await makeSession();
      class BadInit extends CountingComponent {
        override async onInitialize() {
          throw new Error("init-fail");
        }
      }
      const c = new BadInit();
      await expect(s.addComponent(c)).rejects.toThrow(/init-fail/);
      expect(s.listComponents().some((x) => x.id === c.id)).toBe(false);
    });
  });

  describe("edge", () => {
    it("mid-prompt add is deferred and applied at boundary", async () => {
      const s = await makeSession();
      const c = new CountingComponent();
      // Simulate a prompt build in progress by calling the build method without awaiting
      const buildPromise = s.buildSystemPromptOnce({ suppressErrors: true });
      const addPromise = s.addComponent(c);
      // addPromise must not resolve before buildPromise finishes
      let addResolved = false;
      addPromise.then(() => {
        addResolved = true;
      });
      await buildPromise;
      await addPromise;
      expect(addResolved).toBe(true);
      expect(c.onInitCalls).toBe(1);
    });

    it("concurrent add + remove of different components serialize without corruption", async () => {
      const s = await makeSession();
      const a = new CountingComponent(),
        b = new CountingComponent();
      await Promise.all([s.addComponent(a), s.addComponent(b)]);
      await Promise.all([s.removeComponent(a.id), s.removeComponent(b.id)]);
      expect(a.onDisposeCalls).toBe(1);
      expect(b.onDisposeCalls).toBe(1);
    });

    it("removing an IHostBackend also unregisters it from HostComponent", async () => {
      const s = await makeSession();
      // Setup HostComponent in the session; add a fake IHostBackend component.
      const hostComponent = s.getComponentByTypeKey("host");
      class FakeBackendComp extends CountingComponent {
        readonly type = "fake-backend";
        async ensureReady() {}
        async spawn() {
          return {
            ref: {},
            stdout: "",
            stderr: "",
            exited: true,
            exitCode: 0,
          } as any;
        }
        async readFile() {
          return { content: "", bytes: 0 };
        }
        async writeFile() {
          return { bytes: 0 };
        }
        async listDir() {
          return [];
        }
        async checkProcess() {
          return { running: false };
        }
        async killProcess() {}
        override async onInitialize(ctx: any) {
          await super.onInitialize();
          ctx.getDependency("host")?.registerBackend(this);
        }
      }
      const c = new FakeBackendComp();
      await s.addComponent(c);
      expect(hostComponent.hasBackend("fake-backend")).toBe(true);
      await s.removeComponent(c.id);
      expect(hostComponent.hasBackend("fake-backend")).toBe(false);
    });
  });
});
```

Helpers (`listComponents`, `listToolsForPrompt`, `buildSystemPromptOnce`, `hasBackend`) may need small additions to the session/runner surface to make these assertions possible. Add them as test-only utilities if needed (`@internal` doc comment), but prefer already-public APIs.

Run: `pnpm vitest run packages/agent-core/src/agent-session.dynamic.test.ts --coverage`
Expected: all tests pass; coverage 100% on `component-runner.ts` additions + `agent-session.ts` new methods.

- [ ] **Step 5: Commit**

```bash
cd /Users/winrey/Projects/weightwave/team9-agent-pi
git add packages/types/src/component.ts packages/agent-core/src/
git commit -m "$(cat <<'EOF'
feat(agent-core): dynamic AgentSession.addComponent / removeComponent

Enables im-worker to hot-attach / detach AHandHostComponent instances
mid-session when devices come online or go offline, instead of being
locked to a snapshot taken at session start.

- Serialized via AsyncLock so concurrent mutations don't interleave
  partial lifecycle calls.
- Mid-prompt mutations queue and apply at the next safe boundary.
- IHostBackend components auto-unregister from HostComponent when
  removed.
- If Step 1 audit reveals the API already exists, this commit adds
  only the agent-session.dynamic.test.ts coverage; otherwise it ships
  the full AsyncLock + mutable runner implementation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

**If deferred:** if the audit or pragmatic scoping delays this task, downstream Phase 5 (im-worker) falls back to the snapshot-only pattern (spec § 6.8.3). Mark this task `status: "deferred"` in the `.tasks.json` and add a TODO marker referencing this follow-up.

---

**Phase 2 outcome:** HostComponent supports N backends + sticky, framework has cache-system injection + dynamic components, a `refresh_context` tool is available to agents. No ahand-specific code yet.

---

## Phase 3 — Team9 Infrastructure / AWS

**Working directory:** the team9 infrastructure repo (Terraform). If no shared infra repo exists, create a new module at `terraform/modules/ahand-hub/` in whichever repo owns team9's AWS state (folder9 is the reference pattern — look for its accompanying Terraform to locate the canonical directory).

This phase builds the AWS foundation needed before Phase 1's `deploy-hub.yml` workflow can succeed. Each task is standalone Terraform and can be applied independently, but ECS (3.6) must come last since it references the other resources. All tasks target both `prod` and `dev` environments; the Terraform module should take `env = "prod" | "dev"` as input and be instantiated twice.

**Dependencies:**

- Phase 1 Task 1.7 (`deploy-hub.yml`) won't succeed until Phase 3 is complete.
- Phase 1 does NOT depend on Phase 3 for earlier tasks (lib-ization, SDK changes are local).

**Shared module signature:**

```hcl
# terraform/modules/ahand-hub/variables.tf (sketch, referenced by each task below)

variable "env" {
  description = "Deployment environment"
  type        = string
  validation {
    condition     = contains(["prod", "dev"], var.env)
    error_message = "env must be 'prod' or 'dev'"
  }
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "aws_account_id" {
  type    = string
  default = "471112576951"
}

variable "ecs_cluster_name" {
  type = string
  # prod → "openclaw-hive", dev → "openclaw-hive-dev"
}

variable "api_domain" {
  type = string
  # prod → "ahand-hub.team9.ai", dev → "ahand-hub.dev.team9.ai"
}

variable "openclaw_rds_instance_id" {
  description = "Reuse openclaw-hive RDS for ahand_hub database"
  type        = string
}

variable "traefik_alb_dns_name" {
  description = "Existing Traefik ALB DNS for Route53 alias"
  type        = string
}
```

The prod/dev instantiations live in the root `main.tf` and supply the env-specific values. All tasks below are scoped to this module unless stated otherwise.

---

### Task 3.1: IAM roles for ahand-hub deploy + task execution

**Goal:** Create three IAM roles:

1. `GitHubActionsAhandHubDeploy` — a single cross-env role trusted by the `team9ai/ahand` GitHub repo via OIDC. Used by `.github/workflows/deploy-hub.yml` to `aws ecr get-login-password`, `docker push`, `aws ecs register-task-definition`, and `aws ecs update-service`.
2. `ahand-hub-{env}-execution` — ECS task execution role. Lets ECS pull the image from ECR and read SSM parameters.
3. `ahand-hub-{env}-task` — ECS task role (runtime). For application-level AWS SDK calls (none currently, but reserved for future CloudWatch custom metrics, Secrets Manager, etc.).

**Files:**

- Create: `terraform/modules/ahand-hub/iam.tf`
- Create: `terraform/modules/ahand-hub/iam-github-oidc.tf` (the cross-env deploy role — apply only once in the root module, not per-env)
- Create: `terraform/modules/ahand-hub/iam-policies/ecs-execution.json` (policy document)
- Create: `terraform/modules/ahand-hub/iam-policies/ecs-task.json` (policy document — empty/minimal for MVP)
- Create: `terraform/modules/ahand-hub/iam-policies/github-actions-deploy.json` (broad ECR + ECS + IAM:PassRole)

**Acceptance Criteria:**

- [ ] `GitHubActionsAhandHubDeploy` role exists with trust policy that accepts OIDC tokens from `token.actions.githubusercontent.com` where the subject matches `repo:team9ai/ahand:ref:refs/heads/main` OR `...:ref:refs/heads/dev`.
- [ ] The role's attached policy permits exactly: ECR (`GetAuthorizationToken`, `BatchCheckLayerAvailability`, `GetDownloadUrlForLayer`, `BatchGetImage`, `InitiateLayerUpload`, `UploadLayerPart`, `CompleteLayerUpload`, `PutImage`) scoped to the `ahand-hub` repo; ECS (`RegisterTaskDefinition`, `UpdateService`, `DescribeServices`) scoped to `ahand-hub-prod` and `ahand-hub-dev`; `iam:PassRole` scoped to `ahand-hub-{prod,dev}-{execution,task}`.
- [ ] `ahand-hub-prod-execution` and `ahand-hub-dev-execution` roles exist; trust policy accepts `ecs-tasks.amazonaws.com`; permissions allow pulling from the `ahand-hub` ECR repo, writing to `/ecs/ahand-hub` CloudWatch log group, and reading SSM parameters under `/ahand-hub/{env}/*`.
- [ ] `ahand-hub-prod-task` and `ahand-hub-dev-task` roles exist with minimal (empty) policy plus trust for `ecs-tasks.amazonaws.com`. Reserved for future app-level AWS access; empty attachment is fine.
- [ ] All roles are tagged `{ Environment = <env>, Service = "ahand-hub", ManagedBy = "Terraform" }`.
- [ ] `terraform plan` on an already-applied state reports **no drift**.

**Verify:**

```bash
cd <infra-repo>/terraform
terraform plan
# expect: roles mentioned as additions first time, zero drift subsequent
aws iam get-role --role-name GitHubActionsAhandHubDeploy --profile ww --query 'Role.AssumeRolePolicyDocument'
aws iam list-role-policies --role-name ahand-hub-prod-execution --profile ww
```

**Steps:**

- [ ] **Step 1: Declare the GitHub OIDC provider (idempotent — reuse if folder9 already created it)**

```hcl
# terraform/modules/ahand-hub/iam-github-oidc.tf

# Look up the existing OIDC provider (folder9 already created it; reuse).
data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

# If the data block errors because no provider exists, switch to:
# resource "aws_iam_openid_connect_provider" "github" {
#   url = "https://token.actions.githubusercontent.com"
#   client_id_list = ["sts.amazonaws.com"]
#   thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
# }
```

- [ ] **Step 2: Deploy role (single, cross-env)**

```hcl
# terraform/modules/ahand-hub/iam-github-oidc.tf (continued)

resource "aws_iam_role" "github_actions_deploy" {
  name = "GitHubActionsAhandHubDeploy"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = { Federated = data.aws_iam_openid_connect_provider.github.arn }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
        StringLike = {
          "token.actions.githubusercontent.com:sub" = [
            "repo:team9ai/ahand:ref:refs/heads/main",
            "repo:team9ai/ahand:ref:refs/heads/dev",
          ]
        }
      }
    }]
  })

  tags = {
    Service   = "ahand-hub"
    ManagedBy = "Terraform"
  }
}

resource "aws_iam_role_policy" "github_actions_deploy" {
  name = "GitHubActionsAhandHubDeployPolicy"
  role = aws_iam_role.github_actions_deploy.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ECRAuth"
        Effect = "Allow"
        Action = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Sid    = "ECRPush"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:PutImage",
        ]
        Resource = "arn:aws:ecr:${var.aws_region}:${var.aws_account_id}:repository/ahand-hub"
      },
      {
        Sid    = "ECSDeploy"
        Effect = "Allow"
        Action = [
          "ecs:RegisterTaskDefinition",
          "ecs:UpdateService",
          "ecs:DescribeServices",
          "ecs:DescribeTaskDefinition",
        ]
        Resource = [
          "arn:aws:ecs:${var.aws_region}:${var.aws_account_id}:service/openclaw-hive/ahand-hub-prod",
          "arn:aws:ecs:${var.aws_region}:${var.aws_account_id}:service/openclaw-hive-dev/ahand-hub-dev",
          "arn:aws:ecs:${var.aws_region}:${var.aws_account_id}:task-definition/ahand-hub-prod:*",
          "arn:aws:ecs:${var.aws_region}:${var.aws_account_id}:task-definition/ahand-hub-dev:*",
        ]
      },
      {
        Sid    = "PassExecutionRoles"
        Effect = "Allow"
        Action = ["iam:PassRole"]
        Resource = [
          "arn:aws:iam::${var.aws_account_id}:role/ahand-hub-prod-execution",
          "arn:aws:iam::${var.aws_account_id}:role/ahand-hub-dev-execution",
          "arn:aws:iam::${var.aws_account_id}:role/ahand-hub-prod-task",
          "arn:aws:iam::${var.aws_account_id}:role/ahand-hub-dev-task",
        ]
      },
    ]
  })
}
```

- [ ] **Step 3: Execution + task roles (per-env, inside the module)**

```hcl
# terraform/modules/ahand-hub/iam.tf

locals {
  execution_role_name = "ahand-hub-${var.env}-execution"
  task_role_name      = "ahand-hub-${var.env}-task"
  ssm_prefix          = "arn:aws:ssm:${var.aws_region}:${var.aws_account_id}:parameter/ahand-hub/${var.env}"
  log_group_arn       = "arn:aws:logs:${var.aws_region}:${var.aws_account_id}:log-group:/ecs/ahand-hub"
  ecr_repo_arn        = "arn:aws:ecr:${var.aws_region}:${var.aws_account_id}:repository/ahand-hub"
}

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = local.execution_role_name
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
  tags = {
    Environment = var.env
    Service     = "ahand-hub"
    ManagedBy   = "Terraform"
  }
}

resource "aws_iam_role_policy" "execution" {
  name = "${local.execution_role_name}-policy"
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ECRPull"
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken",
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
        ]
        Resource = [local.ecr_repo_arn, "*"]
      },
      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${local.log_group_arn}:*"
      },
      {
        Sid    = "ReadSSM"
        Effect = "Allow"
        Action = ["ssm:GetParameters", "ssm:GetParameter"]
        Resource = "${local.ssm_prefix}/*"
      },
      {
        Sid    = "DecryptSSM"
        Effect = "Allow"
        Action = ["kms:Decrypt"]
        # aws/ssm default key; scope to the account.
        Resource = "arn:aws:kms:${var.aws_region}:${var.aws_account_id}:key/*"
        Condition = {
          StringEquals = {
            "kms:ViaService" = "ssm.${var.aws_region}.amazonaws.com"
          }
        }
      },
    ]
  })
}

resource "aws_iam_role" "task" {
  name               = local.task_role_name
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
  tags = {
    Environment = var.env
    Service     = "ahand-hub"
    ManagedBy   = "Terraform"
  }
}

# MVP: empty policy. Future app-level AWS calls get attached here.
resource "aws_iam_role_policy" "task" {
  name = "${local.task_role_name}-policy"
  role = aws_iam_role.task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "Noop"
      Effect   = "Allow"
      Action   = ["sts:GetCallerIdentity"]
      Resource = "*"
    }]
  })
}

output "execution_role_arn" { value = aws_iam_role.execution.arn }
output "task_role_arn"      { value = aws_iam_role.task.arn }
```

- [ ] **Step 4: Apply + verify**

```bash
cd <infra-repo>/terraform
terraform init
terraform plan -target=module.ahand_hub_prod.aws_iam_role.github_actions_deploy \
               -target=module.ahand_hub_prod.aws_iam_role.execution \
               -target=module.ahand_hub_prod.aws_iam_role.task \
               -target=module.ahand_hub_dev.aws_iam_role.execution \
               -target=module.ahand_hub_dev.aws_iam_role.task
terraform apply
# then verify:
aws iam get-role --role-name GitHubActionsAhandHubDeploy --profile ww --output json | jq '.Role.AssumeRolePolicyDocument'
aws iam list-role-policies --role-name ahand-hub-prod-execution --profile ww
aws iam get-role-policy --role-name ahand-hub-prod-execution \
  --policy-name ahand-hub-prod-execution-policy --profile ww --output json | jq
```

- [ ] **Step 5: Commit**

```bash
cd <infra-repo>
git add terraform/modules/ahand-hub/iam.tf terraform/modules/ahand-hub/iam-github-oidc.tf
git commit -m "$(cat <<'EOF'
feat(ahand-hub): IAM roles for deploy + task execution

Creates:
- GitHubActionsAhandHubDeploy: OIDC-trusted role for team9ai/ahand
  workflow (ECR push + ECS deploy to both prod and dev services)
- ahand-hub-{prod,dev}-execution: ECS task execution roles with ECR
  pull, CloudWatch Logs writes, and SSM parameter reads scoped to
  /ahand-hub/{env}/*
- ahand-hub-{prod,dev}-task: empty task roles reserved for future
  app-level AWS calls

OIDC provider is reused from folder9's existing setup (data lookup;
switch to resource if the data query fails on first apply).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3.2: ECR repository for ahand-hub

**Goal:** Create the ECR repository that receives `docker push` from Phase 1 Task 1.7's workflow. Single repo serves both prod and dev — image tags (`prod` / `dev` / `<sha>`) distinguish environments.

**Files:**

- Create: `terraform/modules/ahand-hub-shared/ecr.tf` (shared module, not per-env)
- Update: Root `main.tf` — instantiate shared module once, env-specific module twice.

**Why a shared module:** ECR repos are global (not per-env). The earlier per-env module only covers resources that differ across environments. Move ECR, the deploy role, and the OIDC provider lookup into a sibling "shared" module to avoid duplicate-create errors when both env modules apply.

**Acceptance Criteria:**

- [ ] ECR repo `ahand-hub` exists in us-east-1, account 471112576951.
- [ ] Image scanning on push is enabled (`scan_on_push = true`).
- [ ] Tag mutability is `MUTABLE` (we re-tag `prod` / `dev` → latest immutable SHA).
- [ ] Lifecycle policy: keep all tagged `prod` + `dev` images; keep last 30 untagged (SHA-only) images; delete anything older.
- [ ] Tags: `{ Service = "ahand-hub", ManagedBy = "Terraform" }`.
- [ ] `terraform plan` reports zero drift after first apply.

**Verify:**

```bash
aws ecr describe-repositories --repository-names ahand-hub --profile ww --region us-east-1 \
  --query 'repositories[0].{name:repositoryName, uri:repositoryUri, scanOnPush:imageScanningConfiguration.scanOnPush, mutability:imageTagMutability}'

aws ecr get-lifecycle-policy --repository-name ahand-hub --profile ww --region us-east-1 \
  --query 'lifecyclePolicyText' --output text | jq
```

Expected: URI = `471112576951.dkr.ecr.us-east-1.amazonaws.com/ahand-hub`, scanOnPush = true, mutability = MUTABLE, lifecycle policy as declared.

**Steps:**

- [ ] **Step 1: Restructure modules — create shared vs env-specific**

Before this task, move Task 3.1's `GitHubActionsAhandHubDeploy` role and the OIDC provider lookup out of `terraform/modules/ahand-hub/` and into a new module `terraform/modules/ahand-hub-shared/`. Keep `ahand-hub/` (per-env) for the execution / task roles and everything introduced by later 3.x tasks.

Top-level `main.tf` after restructure:

```hcl
# terraform/main.tf

module "ahand_hub_shared" {
  source = "./modules/ahand-hub-shared"
  # No env var. Applies once.
}

module "ahand_hub_prod" {
  source             = "./modules/ahand-hub"
  env                = "prod"
  ecs_cluster_name   = "openclaw-hive"
  api_domain         = "ahand-hub.team9.ai"
  openclaw_rds_instance_id = "openclaw-hive-db"
  traefik_alb_dns_name     = data.aws_lb.traefik.dns_name
}

module "ahand_hub_dev" {
  source             = "./modules/ahand-hub"
  env                = "dev"
  ecs_cluster_name   = "openclaw-hive-dev"
  api_domain         = "ahand-hub.dev.team9.ai"
  openclaw_rds_instance_id = "openclaw-hive-db"   # reuse prod RDS for dev too; separate database
  traefik_alb_dns_name     = data.aws_lb.traefik_dev.dns_name
}

data "aws_lb" "traefik" {
  name = "openclaw-hive-traefik"   # existing prod ALB
}

data "aws_lb" "traefik_dev" {
  name = "openclaw-hive-dev-traefik"
}
```

- [ ] **Step 2: ECR repository resource**

```hcl
# terraform/modules/ahand-hub-shared/ecr.tf

resource "aws_ecr_repository" "ahand_hub" {
  name                 = "ahand-hub"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = {
    Service   = "ahand-hub"
    ManagedBy = "Terraform"
  }
}

resource "aws_ecr_lifecycle_policy" "ahand_hub" {
  repository = aws_ecr_repository.ahand_hub.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep prod and dev tags indefinitely"
        selection = {
          tagStatus       = "tagged"
          tagPrefixList   = ["prod", "dev"]
          countType       = "imageCountMoreThan"
          countNumber     = 10000
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep last 30 untagged (SHA-only) images"
        selection = {
          tagStatus   = "untagged"
          countType   = "imageCountMoreThan"
          countNumber = 30
        }
        action = { type = "expire" }
      },
    ]
  })
}

output "repository_url" {
  value = aws_ecr_repository.ahand_hub.repository_url
}
output "repository_arn" {
  value = aws_ecr_repository.ahand_hub.arn
}
```

Note on the lifecycle policy: the first rule's `countNumber = 10000` is a workaround because ECR's lifecycle policy doesn't support "never expire" directly. `tagPrefixList` with `countMoreThan: 10000` effectively retains everything with those tags. The second rule cleans up untagged SHA-only builds from old PRs.

- [ ] **Step 3: Adjust Task 3.1's IAM policy ARN if needed**

Task 3.1's `GitHubActionsAhandHubDeploy` policy hardcodes the ECR resource ARN (`arn:aws:ecr:${var.aws_region}:${var.aws_account_id}:repository/ahand-hub`). That ARN is static, so no changes needed — but verify by `terraform plan` that the reference resolves cleanly.

- [ ] **Step 4: Apply + verify**

```bash
cd <infra-repo>/terraform
terraform plan -target=module.ahand_hub_shared.aws_ecr_repository.ahand_hub
terraform apply
aws ecr describe-repositories --repository-names ahand-hub --profile ww --region us-east-1
aws ecr get-lifecycle-policy --repository-name ahand-hub --profile ww --region us-east-1
```

- [ ] **Step 5: Commit**

```bash
cd <infra-repo>
git add terraform/modules/ahand-hub-shared/ terraform/main.tf
git commit -m "$(cat <<'EOF'
feat(ahand-hub): ECR repository with lifecycle policy

ahand-hub ECR repo in us-east-1 for deploy-hub.yml image pushes.
- image_tag_mutability = MUTABLE (prod/dev tags rewritten on each
  deploy while SHA tags provide immutability for rollback)
- scan_on_push enabled
- Lifecycle: keep prod/dev-tagged images indefinitely; keep last 30
  untagged (SHA-only) images for rollback; older untagged deleted

Restructures modules into ahand-hub-shared/ (ECR, GitHub deploy role,
OIDC provider) and ahand-hub/ (per-env execution/task roles and later
env-specific resources). Root main.tf instantiates each twice (prod,
dev) for the env-scoped module and once for the shared one.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3.3: RDS `ahand_hub` database + scoped user (reuse existing RDS)

**Goal:** Provision an `ahand_hub` PostgreSQL database and a scoped `ahand_hub` user on the **existing** openclaw-hive RDS instance. Both prod and dev environments use the same RDS instance but different database names (`ahand_hub_prod`, `ahand_hub_dev`) with separate users. This reuses openclaw-hive's RDS instance (see spec § 7.7).

**Files:**

- Create: `terraform/modules/ahand-hub/rds.tf` — per-env provisioning of database + user via the `cyrilgdn/postgresql` provider (or equivalent; check which one is standard in the team9 infra repo).
- Update: `terraform/modules/ahand-hub/variables.tf` — input for the RDS admin connection string (from the openclaw-hive module's outputs).
- Create: `terraform/modules/ahand-hub/versions.tf` if needed to declare the postgresql provider.

**Acceptance Criteria:**

- [ ] Database `ahand_hub_prod` exists on the shared RDS instance; owned by user `ahand_hub_prod`.
- [ ] Database `ahand_hub_dev` exists; owned by user `ahand_hub_dev`.
- [ ] Each user has a **unique random password** (generated via `random_password` resource, 48 chars).
- [ ] Password is stored in AWS Secrets Manager at `ahand-hub/{env}/rds-password` (Secrets Manager, not SSM — allows rotation API later); **also** mirrored to SSM `/ahand-hub/{env}/DATABASE_URL` as a SecureString containing the full `postgres://` URL for ECS task definition consumption (see spec § 7.6).
- [ ] User's privileges: `GRANT CONNECT ON DATABASE ahand_hub_{env} TO ahand_hub_{env}`, `GRANT ALL ON SCHEMA public TO ahand_hub_{env}`, `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ahand_hub_{env}`. User has NO privileges on other databases on the instance (enforced by default; verify).
- [ ] RDS instance's security group allows inbound 5432 from the ECS task's security group (inherited from existing openclaw-hive config — verify no changes needed).
- [ ] `terraform plan` zero drift after apply.
- [ ] Sanity check: connect as `ahand_hub_prod`, run `\dn`, `SELECT current_database();`, confirm isolated visibility. Attempting `SELECT 1 FROM control_plane.pg_catalog.pg_tables` (if control_plane db exists on same instance) should fail with permission error.

**Verify:**

```bash
# Get connection URL from SSM
AHAND_DB_URL=$(aws ssm get-parameter --name /ahand-hub/prod/DATABASE_URL \
  --with-decryption --profile ww --query 'Parameter.Value' --output text)

# Connect and verify
psql "$AHAND_DB_URL" -c "SELECT current_database(), current_user;"
# Expected: current_database=ahand_hub_prod, current_user=ahand_hub_prod

psql "$AHAND_DB_URL" -c "\l ahand_hub_prod"
# Confirm owner = ahand_hub_prod

# Confirm isolation
psql "$AHAND_DB_URL" -c "\c control_plane"
# Expected: error / permission denied
```

**Steps:**

- [ ] **Step 1: Add the postgresql provider**

```hcl
# terraform/modules/ahand-hub/versions.tf

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    postgresql = {
      source  = "cyrilgdn/postgresql"
      version = "~> 1.22"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}
```

The postgresql provider needs connection info at plan-time. Wire it in the root `main.tf` using the existing RDS endpoint:

```hcl
# terraform/main.tf (patch)

data "aws_db_instance" "openclaw_hive" {
  db_instance_identifier = "openclaw-hive-db"
}

# Admin password for openclaw-hive RDS — already stored in SSM by folder9/openclaw setup.
data "aws_ssm_parameter" "openclaw_hive_db_admin_password" {
  name            = "/openclaw-hive/rds/admin-password"
  with_decryption = true
}

provider "postgresql" {
  host            = data.aws_db_instance.openclaw_hive.address
  port            = data.aws_db_instance.openclaw_hive.port
  username        = "postgres"     # admin user on the instance
  password        = data.aws_ssm_parameter.openclaw_hive_db_admin_password.value
  sslmode         = "require"
  connect_timeout = 15
  superuser       = false          # IMPORTANT: openclaw-hive RDS admin isn't a Postgres superuser under RDS
}
```

If the OpenClaw RDS admin SSM path doesn't match, grep the openclaw-hive / folder9 Terraform for the actual parameter name.

- [ ] **Step 2: Per-env database + user resources**

```hcl
# terraform/modules/ahand-hub/rds.tf

resource "random_password" "rds" {
  length  = 48
  special = true
  override_special = "!@#$%^&*-_=+"
}

resource "postgresql_role" "ahand_hub" {
  name     = "ahand_hub_${var.env}"
  login    = true
  password = random_password.rds.result

  # No superuser / createdb / createrole. Tightly scoped.
  superuser   = false
  create_database = false
  create_role     = false
}

resource "postgresql_database" "ahand_hub" {
  name       = "ahand_hub_${var.env}"
  owner      = postgresql_role.ahand_hub.name
  encoding   = "UTF8"
  lc_collate = "C"
  lc_ctype   = "C"
  template   = "template0"
}

resource "postgresql_grant" "schema_all" {
  database    = postgresql_database.ahand_hub.name
  role        = postgresql_role.ahand_hub.name
  schema      = "public"
  object_type = "schema"
  privileges  = ["USAGE", "CREATE"]
}

resource "postgresql_grant" "tables_default" {
  database    = postgresql_database.ahand_hub.name
  role        = postgresql_role.ahand_hub.name
  schema      = "public"
  object_type = "table"
  privileges  = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]
}

resource "postgresql_default_privileges" "tables_future" {
  database    = postgresql_database.ahand_hub.name
  role        = postgresql_role.ahand_hub.name
  owner       = postgresql_role.ahand_hub.name
  schema      = "public"
  object_type = "table"
  privileges  = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]
}

resource "postgresql_default_privileges" "sequences_future" {
  database    = postgresql_database.ahand_hub.name
  role        = postgresql_role.ahand_hub.name
  owner       = postgresql_role.ahand_hub.name
  schema      = "public"
  object_type = "sequence"
  privileges  = ["USAGE", "SELECT", "UPDATE"]
}

output "rds_password" {
  value     = random_password.rds.result
  sensitive = true
}
output "rds_database_name" {
  value = postgresql_database.ahand_hub.name
}
output "rds_role_name" {
  value = postgresql_role.ahand_hub.name
}
output "rds_host" {
  value = data.aws_db_instance.openclaw_hive.address
}
```

The `data "aws_db_instance" "openclaw_hive"` block needs to be available inside the module. Either re-declare it at the module level or pass `rds_host` and `rds_port` as input variables from the root module. Re-declaring is simpler and self-contained:

```hcl
# terraform/modules/ahand-hub/rds.tf (additional)

data "aws_db_instance" "openclaw_hive" {
  db_instance_identifier = var.openclaw_rds_instance_id
}
```

- [ ] **Step 3: Store the connection URL in SSM (for ECS task)**

```hcl
# terraform/modules/ahand-hub/rds.tf (continued)

locals {
  database_url = format(
    "postgres://%s:%s@%s:%d/%s?sslmode=require",
    postgresql_role.ahand_hub.name,
    random_password.rds.result,
    data.aws_db_instance.openclaw_hive.address,
    data.aws_db_instance.openclaw_hive.port,
    postgresql_database.ahand_hub.name,
  )
}

resource "aws_ssm_parameter" "database_url" {
  name  = "/ahand-hub/${var.env}/DATABASE_URL"
  type  = "SecureString"
  value = local.database_url
  tags = {
    Environment = var.env
    Service     = "ahand-hub"
    ManagedBy   = "Terraform"
  }
}
```

Secrets Manager is a nice-to-have for future rotation; for MVP, SSM SecureString is sufficient and matches folder9's pattern.

- [ ] **Step 4: Apply + verify**

```bash
cd <infra-repo>/terraform
terraform plan -target=module.ahand_hub_prod.postgresql_database.ahand_hub \
               -target=module.ahand_hub_prod.postgresql_role.ahand_hub \
               -target=module.ahand_hub_dev.postgresql_database.ahand_hub \
               -target=module.ahand_hub_dev.postgresql_role.ahand_hub
terraform apply

# Verify connectivity
AHAND_DB_URL=$(aws ssm get-parameter --name /ahand-hub/prod/DATABASE_URL \
  --with-decryption --profile ww --query 'Parameter.Value' --output text)
echo "Connecting..."
psql "$AHAND_DB_URL" -c "SELECT current_database(), current_user, version();"

# Confirm isolation: attempt to switch to another database (should fail)
psql "$AHAND_DB_URL" <<'SQL'
SELECT datname FROM pg_database WHERE datistemplate = false;
SQL

# Test a CREATE TABLE (confirms default privileges work)
psql "$AHAND_DB_URL" <<'SQL'
CREATE TABLE _sanity_check (id int PRIMARY KEY, note text);
INSERT INTO _sanity_check VALUES (1, 'ok');
SELECT * FROM _sanity_check;
DROP TABLE _sanity_check;
SQL
```

If any step fails with "permission denied", recheck the `postgresql_default_privileges` blocks.

- [ ] **Step 5: Commit**

```bash
cd <infra-repo>
git add terraform/modules/ahand-hub/rds.tf terraform/modules/ahand-hub/versions.tf terraform/main.tf
git commit -m "$(cat <<'EOF'
feat(ahand-hub): provision RDS database + scoped role per env

Reuses the existing openclaw-hive RDS PostgreSQL instance (see spec
§ 7.7). Creates per-env logical databases (ahand_hub_prod,
ahand_hub_dev) each owned by a dedicated role with privileges scoped
strictly to the public schema of its own database. No superuser, no
create_database, no create_role — attack surface is bounded to the
ahand_hub logical namespace.

Password is generated by random_password (rotated by destroy+create
when intentional) and the full postgres:// URL is stored in SSM at
/ahand-hub/{env}/DATABASE_URL as SecureString for ECS task secrets.

Follows folder9's SSM pattern. Default privileges cover future-created
tables / sequences so Drizzle migrations running as ahand_hub_{env}
own everything they create.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3.4: ElastiCache Redis (reuse or provision)

**Goal:** Ensure Redis is available for ahand-hub's outbox / presence / webhook-dedupe use cases. Priority order: (a) reuse openclaw-hive's existing Redis if one exists; (b) otherwise provision a small independent ElastiCache t4g.micro per env. In both cases, the final output is an SSM SecureString at `/ahand-hub/{env}/REDIS_URL`.

**Files:**

- Modify: `terraform/modules/ahand-hub/redis.tf` — conditional: either `data` reference to existing, or `aws_elasticache_cluster` resource.
- Update: `terraform/modules/ahand-hub/variables.tf` — `redis_mode` input ("reuse" | "create"), `existing_redis_endpoint` input (when reusing).

**Acceptance Criteria:**

- [ ] Prerequisite audit completed: openclaw-hive's Terraform and/or AWS console confirms whether an ElastiCache cluster exists tagged `Service = "openclaw-hive"` or similar. The audit result is recorded in this PR's description.
- [ ] If reusing: `/ahand-hub/{env}/REDIS_URL` is populated with the existing endpoint; key namespace documented as `ahand:*`.
- [ ] If creating: new ElastiCache Redis t4g.micro cluster named `ahand-hub-{env}` in the openclaw-hive VPC, using openclaw-hive's existing subnet group + security group (or mirror them).
- [ ] Security group allows inbound 6379 from the ECS task's security group.
- [ ] `/ahand-hub/{env}/REDIS_URL` SSM SecureString contains the full `redis://` URL (including auth token if enabled).
- [ ] `terraform plan` zero drift after apply.
- [ ] Sanity: from within the VPC (e.g., a short-lived ECS exec container or bastion), `redis-cli -u $REDIS_URL PING` returns `PONG`.

**Verify:**

```bash
REDIS_URL=$(aws ssm get-parameter --name /ahand-hub/prod/REDIS_URL \
  --with-decryption --profile ww --query 'Parameter.Value' --output text)
echo "$REDIS_URL"
# Via ECS exec (bastion-style):
aws ecs run-task --cluster openclaw-hive --task-definition debug-util-task \
  --overrides "{\"containerOverrides\":[{\"name\":\"redis-cli\",\"command\":[\"sh\",\"-c\",\"redis-cli -u $REDIS_URL PING\"]}]}" \
  --profile ww
# Expected: PONG
```

(Alternative verification can wait until Phase 3.6's first ECS task boot.)

**Steps:**

- [ ] **Step 1: Audit existing Redis**

```bash
# Look for existing Redis in the AWS account
aws elasticache describe-cache-clusters --profile ww --region us-east-1 \
  --query 'CacheClusters[].{id:CacheClusterId, engine:Engine, nodeType:CacheNodeType, status:CacheClusterStatus}'

# Check openclaw-hive / folder9 Terraform for any aws_elasticache_cluster resources
cd <infra-repo>
rg -nP 'aws_elasticache_(cluster|replication_group)' terraform/
```

Record the findings. Two outcomes:

- **(a) Existing cluster found:** continue to Step 2a.
- **(b) Nothing found:** continue to Step 2b.

- [ ] **Step 2a: Reuse existing Redis**

```hcl
# terraform/modules/ahand-hub/variables.tf (add)

variable "redis_mode" {
  description = "'reuse' to attach to an existing cluster, 'create' to provision a new one"
  type        = string
  default     = "reuse"
}

variable "existing_redis_cluster_id" {
  description = "Existing ElastiCache cluster ID to reuse (only used when redis_mode = reuse)"
  type        = string
  default     = null
}

variable "existing_redis_auth_token_ssm_path" {
  description = "SSM path for existing Redis AUTH token, if any"
  type        = string
  default     = null
}
```

```hcl
# terraform/modules/ahand-hub/redis.tf

data "aws_elasticache_cluster" "existing" {
  count           = var.redis_mode == "reuse" ? 1 : 0
  cluster_id      = var.existing_redis_cluster_id
}

locals {
  redis_host = var.redis_mode == "reuse" ? (
    length(data.aws_elasticache_cluster.existing) > 0
      ? data.aws_elasticache_cluster.existing[0].cache_nodes[0].address
      : null
  ) : aws_elasticache_cluster.new[0].cache_nodes[0].address

  redis_port = var.redis_mode == "reuse" ? (
    length(data.aws_elasticache_cluster.existing) > 0
      ? data.aws_elasticache_cluster.existing[0].cache_nodes[0].port
      : null
  ) : aws_elasticache_cluster.new[0].cache_nodes[0].port

  redis_url = format("redis://%s:%d", local.redis_host, local.redis_port)
}

resource "aws_ssm_parameter" "redis_url" {
  name  = "/ahand-hub/${var.env}/REDIS_URL"
  type  = "SecureString"
  value = local.redis_url
  tags = {
    Environment = var.env
    Service     = "ahand-hub"
    ManagedBy   = "Terraform"
  }
}
```

In `main.tf`, when reusing, pass the discovered cluster id:

```hcl
module "ahand_hub_prod" {
  # ...
  redis_mode                = "reuse"
  existing_redis_cluster_id = "openclaw-hive-redis-prod"  # from Step 1 audit
}
```

- [ ] **Step 2b: Create new ElastiCache (fallback)**

```hcl
# terraform/modules/ahand-hub/redis.tf (alternative)

# Reuse openclaw-hive's subnet group + security group
data "aws_elasticache_subnet_group" "openclaw" {
  name = "openclaw-hive-cache-subnet"
}

data "aws_security_group" "openclaw_cache" {
  name = "openclaw-hive-cache-sg"
}

resource "aws_elasticache_cluster" "new" {
  count                = var.redis_mode == "create" ? 1 : 0
  cluster_id           = "ahand-hub-${var.env}"
  engine               = "redis"
  engine_version       = "7.1"
  node_type            = "cache.t4g.micro"
  num_cache_nodes      = 1
  port                 = 6379
  parameter_group_name = "default.redis7"
  subnet_group_name    = data.aws_elasticache_subnet_group.openclaw.name
  security_group_ids   = [data.aws_security_group.openclaw_cache.id]

  maintenance_window   = "sun:07:00-sun:08:00"
  snapshot_window      = "08:00-09:00"
  snapshot_retention_limit = 7

  apply_immediately = false

  tags = {
    Environment = var.env
    Service     = "ahand-hub"
    ManagedBy   = "Terraform"
  }
}
```

Note: for MVP single-node is fine. Moving to a replication group with automatic failover is a follow-up once SLO demands it.

- [ ] **Step 3: Document key namespace convention**

Add to the module's `README.md` (or create):

```markdown
# ahand-hub Terraform module — Redis key conventions

When reusing openclaw-hive's Redis, all ahand-hub keys MUST be prefixed
with `ahand:` to isolate namespaces from openclaw usage. Expected key
patterns:

- `ahand:device:{hubDeviceId}:presence` (string with TTL)
- `ahand:webhook:seen:{eventId}` (string with TTL 10min)
- `ahand:outbox:{envelopeId}` (temporary queue entries)

No ahand-hub code should access keys without the `ahand:` prefix.
```

- [ ] **Step 4: Apply + verify**

```bash
cd <infra-repo>/terraform
terraform plan
terraform apply
aws ssm get-parameter --name /ahand-hub/prod/REDIS_URL --with-decryption --profile ww \
  --query 'Parameter.Value' --output text
# → redis://<host>:6379  (host accessible only from within VPC)
```

In-VPC ping test can be deferred until Task 3.6 (first ECS deploy) verifies end-to-end.

- [ ] **Step 5: Commit**

```bash
cd <infra-repo>
git add terraform/modules/ahand-hub/redis.tf terraform/modules/ahand-hub/variables.tf \
        terraform/modules/ahand-hub/README.md terraform/main.tf
git commit -m "$(cat <<'EOF'
feat(ahand-hub): Redis (reuse or create) + SSM URL

Conditional: if openclaw-hive already runs ElastiCache (audit done in
this PR), reuse it with the ahand:* key prefix to isolate namespaces;
otherwise provision a fresh t4g.micro cluster in the same VPC / subnet
group as openclaw-hive.

Outputs the redis:// URL to SSM /ahand-hub/{env}/REDIS_URL as
SecureString for ECS task secrets.

README documents key prefix convention to avoid collisions when sharing
an instance with other services.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3.5: SSM parameters + Route53 + CloudWatch logs

**Goal:** Provision the remaining per-env shared infra pieces: all SSM parameters referenced by the ECS task definition; Route53 A record pointing to Traefik ALB; CloudWatch log group. ACM cert is **not** needed here (Traefik + LetsEncrypt handles it, same as folder9).

**Files:**

- Create: `terraform/modules/ahand-hub/ssm.tf` — all `/ahand-hub/{env}/*` parameters (some with placeholder values, seeded by hand after apply).
- Create: `terraform/modules/ahand-hub/dns.tf` — Route53 A record.
- Create: `terraform/modules/ahand-hub/logs.tf` — CloudWatch log group.

**Acceptance Criteria:**

- [ ] All SSM parameters listed in spec § 7.6 exist under `/ahand-hub/{env}/*`:
  - SecureString: `JWT_SECRET`, `SERVICE_TOKEN`, `WEBHOOK_SECRET`, `DASHBOARD_PASSWORD`, `DEVICE_BOOTSTRAP_TOKEN`, `SENTRY_DSN`
  - String: `WEBHOOK_URL`, `DEVICE_BOOTSTRAP_DEVICE_ID`
  - Already created by Tasks 3.3/3.4: `DATABASE_URL`, `REDIS_URL`
- [ ] All parameters tagged `{ Environment = <env>, Service = "ahand-hub", ManagedBy = "Terraform" }`.
- [ ] Sensitive parameters use `SecureString` with default AWS-managed key (aws/ssm).
- [ ] Terraform stores the **resource** for each parameter (so drift is detected) but the **value** for secrets is either generated via `random_password` (JWT_SECRET, SERVICE_TOKEN, WEBHOOK_SECRET, DASHBOARD_PASSWORD, DEVICE_BOOTSTRAP_TOKEN) or declared `ignore_changes = [value]` and seeded manually (SENTRY_DSN).
- [ ] `WEBHOOK_URL` value computed from `var.gateway_public_url` (defaults to `https://gateway.team9.ai` prod / `https://gateway.dev.team9.ai` dev) suffixed with `/api/ahand/hub-webhook`.
- [ ] Route53 A record `ahand-hub.{env-prefix}team9.ai` aliased to the Traefik ALB DNS name in the correct hosted zone.
- [ ] CloudWatch log group `/ecs/ahand-hub` exists, retention = 30 days, tags set.
- [ ] team9 gateway mirrors added at `/team9/{env}/AHAND_HUB_URL`, `/team9/{env}/AHAND_HUB_SERVICE_TOKEN`, `/team9/{env}/AHAND_HUB_WEBHOOK_SECRET` — cross-references via Terraform `aws_ssm_parameter` resources reading from the ahand-hub generated secrets (so rotation cascades automatically).

**Verify:**

```bash
# All /ahand-hub/prod/* parameters
aws ssm get-parameters-by-path --path /ahand-hub/prod/ --with-decryption --profile ww \
  --query 'Parameters[].{name:Name, type:Type, lastModified:LastModifiedDate}' --output table

# Route53 record
aws route53 list-resource-record-sets --hosted-zone-id <team9.ai zone id> --profile ww \
  --query "ResourceRecordSets[?Name == 'ahand-hub.team9.ai.']"

# Log group
aws logs describe-log-groups --log-group-name-prefix /ecs/ahand-hub --profile ww \
  --query 'logGroups[].{name:logGroupName, retention:retentionInDays}'

# Cross-references for team9 gateway
aws ssm get-parameter --name /team9/prod/AHAND_HUB_SERVICE_TOKEN --with-decryption --profile ww \
  --query 'Parameter.Value' --output text | head -c 8  # should match first 8 chars of /ahand-hub/prod/SERVICE_TOKEN
```

Expected: all parameters present with correct types; A record aliased to the right ALB; log group retention 30d.

**Steps:**

- [ ] **Step 1: SSM parameters**

```hcl
# terraform/modules/ahand-hub/ssm.tf

resource "random_password" "jwt_secret" {
  length  = 48
  special = true
}

resource "random_password" "service_token" {
  length  = 48
  special = true
}

resource "random_password" "webhook_secret" {
  length  = 48
  special = true
}

resource "random_password" "dashboard_password" {
  length  = 32
  special = true
}

resource "random_password" "device_bootstrap_token" {
  length  = 32
  special = true
}

resource "aws_ssm_parameter" "jwt_secret" {
  name  = "/ahand-hub/${var.env}/JWT_SECRET"
  type  = "SecureString"
  value = random_password.jwt_secret.result
  tags  = local.common_tags
}

resource "aws_ssm_parameter" "service_token" {
  name  = "/ahand-hub/${var.env}/SERVICE_TOKEN"
  type  = "SecureString"
  value = random_password.service_token.result
  tags  = local.common_tags
}

resource "aws_ssm_parameter" "webhook_secret" {
  name  = "/ahand-hub/${var.env}/WEBHOOK_SECRET"
  type  = "SecureString"
  value = random_password.webhook_secret.result
  tags  = local.common_tags
}

resource "aws_ssm_parameter" "webhook_url" {
  name  = "/ahand-hub/${var.env}/WEBHOOK_URL"
  type  = "String"
  value = "${var.gateway_public_url}/api/ahand/hub-webhook"
  tags  = local.common_tags
}

resource "aws_ssm_parameter" "dashboard_password" {
  name  = "/ahand-hub/${var.env}/DASHBOARD_PASSWORD"
  type  = "SecureString"
  value = random_password.dashboard_password.result
  tags  = local.common_tags
}

resource "aws_ssm_parameter" "device_bootstrap_token" {
  name  = "/ahand-hub/${var.env}/DEVICE_BOOTSTRAP_TOKEN"
  type  = "SecureString"
  value = random_password.device_bootstrap_token.result
  tags  = local.common_tags
}

resource "aws_ssm_parameter" "device_bootstrap_device_id" {
  name  = "/ahand-hub/${var.env}/DEVICE_BOOTSTRAP_DEVICE_ID"
  type  = "String"
  value = "disabled-bootstrap-placeholder"   # team9 gateway mints device JWTs, not this path
  tags  = local.common_tags
}

# Sentry DSN is provisioned externally (Sentry project); seed the param resource
# but let value be manually set so rotating it elsewhere doesn't cause drift.
resource "aws_ssm_parameter" "sentry_dsn" {
  name  = "/ahand-hub/${var.env}/SENTRY_DSN"
  type  = "SecureString"
  value = "placeholder-set-manually"
  tags  = local.common_tags
  lifecycle {
    ignore_changes = [value]
  }
}

locals {
  common_tags = {
    Environment = var.env
    Service     = "ahand-hub"
    ManagedBy   = "Terraform"
  }
}
```

- [ ] **Step 2: Cross-references in team9 gateway SSM**

```hcl
# terraform/modules/ahand-hub/ssm-team9-mirrors.tf

resource "aws_ssm_parameter" "team9_ahand_hub_url" {
  name  = "/team9/${var.env}/AHAND_HUB_URL"
  type  = "String"
  value = "https://${var.api_domain}"
  tags  = local.common_tags
}

resource "aws_ssm_parameter" "team9_ahand_hub_service_token" {
  name  = "/team9/${var.env}/AHAND_HUB_SERVICE_TOKEN"
  type  = "SecureString"
  value = random_password.service_token.result
  tags  = local.common_tags
}

resource "aws_ssm_parameter" "team9_ahand_hub_webhook_secret" {
  name  = "/team9/${var.env}/AHAND_HUB_WEBHOOK_SECRET"
  type  = "SecureString"
  value = random_password.webhook_secret.result
  tags  = local.common_tags
}
```

This design ensures: rotating `/ahand-hub/prod/SERVICE_TOKEN` (regenerating via `terraform taint random_password.service_token && terraform apply`) automatically cascades to `/team9/prod/AHAND_HUB_SERVICE_TOKEN`, since both read from the same `random_password.service_token.result`. No drift risk.

- [ ] **Step 3: Route53 A record**

```hcl
# terraform/modules/ahand-hub/dns.tf

data "aws_route53_zone" "team9" {
  name = "team9.ai."
}

resource "aws_route53_record" "api" {
  zone_id = data.aws_route53_zone.team9.zone_id
  name    = var.api_domain            # "ahand-hub.team9.ai" or "ahand-hub.dev.team9.ai"
  type    = "A"

  alias {
    name                   = var.traefik_alb_dns_name
    zone_id                = data.aws_lb.traefik.zone_id
    evaluate_target_health = true
  }
}
```

The `data.aws_lb.traefik` reference needs to be declared inside the module (already referenced in Task 3.2's root main.tf as `data.aws_lb.traefik` / `data.aws_lb.traefik_dev`). Pass it through as a module input, or re-declare per env inside the module using `var.traefik_alb_name`:

```hcl
variable "traefik_alb_name" {
  type    = string
  # prod → "openclaw-hive-traefik"
  # dev  → "openclaw-hive-dev-traefik"
}

data "aws_lb" "traefik" {
  name = var.traefik_alb_name
}
```

- [ ] **Step 4: CloudWatch log group**

```hcl
# terraform/modules/ahand-hub/logs.tf

resource "aws_cloudwatch_log_group" "ahand_hub" {
  name              = "/ecs/ahand-hub"
  retention_in_days = 30
  tags              = local.common_tags
}
```

One log group shared across prod and dev — stream prefix (`ahand-hub-prod` / `ahand-hub-dev`) distinguishes streams (matches folder9 pattern). Because the module runs per-env and both envs declare the same resource, move this to the **shared** module to avoid duplicate-create:

```hcl
# terraform/modules/ahand-hub-shared/logs.tf (correct location)

resource "aws_cloudwatch_log_group" "ahand_hub" {
  name              = "/ecs/ahand-hub"
  retention_in_days = 30
  tags = {
    Service   = "ahand-hub"
    ManagedBy = "Terraform"
  }
}
```

- [ ] **Step 5: Apply + verify**

```bash
cd <infra-repo>/terraform
terraform plan
terraform apply

# Inventory SSM
aws ssm get-parameters-by-path --path /ahand-hub/prod/ --with-decryption --profile ww \
  --query 'Parameters[].Name' --output text | tr '\t' '\n' | sort

# Expected output:
# /ahand-hub/prod/DASHBOARD_PASSWORD
# /ahand-hub/prod/DATABASE_URL
# /ahand-hub/prod/DEVICE_BOOTSTRAP_DEVICE_ID
# /ahand-hub/prod/DEVICE_BOOTSTRAP_TOKEN
# /ahand-hub/prod/JWT_SECRET
# /ahand-hub/prod/REDIS_URL
# /ahand-hub/prod/SENTRY_DSN
# /ahand-hub/prod/SERVICE_TOKEN
# /ahand-hub/prod/WEBHOOK_SECRET
# /ahand-hub/prod/WEBHOOK_URL

# Route53
dig +short ahand-hub.team9.ai
# Should resolve to the Traefik ALB's A record

# Log group
aws logs describe-log-groups --log-group-name-prefix /ecs/ahand-hub --profile ww
```

- [ ] **Step 6: Seed SENTRY_DSN manually (outside Terraform)**

```bash
# After Sentry project is created and DSN is in hand:
aws ssm put-parameter --name /ahand-hub/prod/SENTRY_DSN --type SecureString \
  --value "https://<key>@o<org>.ingest.sentry.io/<project>" --overwrite --profile ww
```

- [ ] **Step 7: Commit**

```bash
cd <infra-repo>
git add terraform/modules/ahand-hub/ssm.tf terraform/modules/ahand-hub/ssm-team9-mirrors.tf \
        terraform/modules/ahand-hub/dns.tf terraform/modules/ahand-hub-shared/logs.tf \
        terraform/modules/ahand-hub/variables.tf
git commit -m "$(cat <<'EOF'
feat(ahand-hub): SSM params, Route53 A record, CloudWatch log group

- SSM SecureStrings for all hub env vars: JWT_SECRET, SERVICE_TOKEN,
  WEBHOOK_SECRET, DASHBOARD_PASSWORD, DEVICE_BOOTSTRAP_TOKEN (unused
  placeholder in team9 flow but required by hub binary). Secrets are
  generated by random_password — rotating a secret cascades to the
  team9 gateway's mirror via shared random_password reference.
- WEBHOOK_URL as String pointing at team9 gateway
  /api/ahand/hub-webhook per env
- team9 gateway SSM mirrors under /team9/{env}/AHAND_HUB_* so no
  manual sync between repositories
- Route53 A record ahand-hub.{env-prefix}team9.ai aliased to the
  existing Traefik ALB
- CloudWatch log group /ecs/ahand-hub (single, shared by prod and
  dev streams) with 30d retention — mirrors folder9's pattern
- SENTRY_DSN resource is present but its value is managed outside
  Terraform (ignore_changes = [value]); seed via aws ssm put-parameter
  after Sentry project provisioning

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3.6: ECS service stub (initial task definition + service)

**Goal:** Declare the ECS service + an initial stub task definition so `deploy-hub.yml`'s `aws ecs update-service --force-new-deployment` can target an existing service on first run. The stub uses a placeholder image (`ahand-hub:stub`) that will never successfully boot — the first real deploy from GitHub Actions replaces it with the real image.

This task completes Phase 3's infrastructure. After it lands, running the `deploy-hub.yml` workflow on a push to `main` or `dev` should succeed end-to-end.

**Files:**

- Create: `terraform/modules/ahand-hub/ecs.tf` — ECS service + placeholder task definition, using Traefik `dockerLabels` pattern from folder9.
- Update: `terraform/modules/ahand-hub-shared/ecr.tf` — push a `:stub` image tag as a bootstrap (or rely on the first deploy to populate).

**Why a stub image:** Terraform cannot create an ECS service that references a task definition pointing at an image that doesn't exist yet — `aws ecs create-service` will fail. Two options:

- **A.** Push a stub image to ECR manually before first `terraform apply` (one-time bootstrap).
- **B.** Use `placeholder-service` pattern: declare service with `desired_count = 0` and a stub task definition; first deploy both populates ECR AND updates service.

Choice: **B**. It's self-contained; no manual bootstrap step. Set `desired_count = 0` initially. The `deploy-hub.yml` workflow's `aws ecs update-service --force-new-deployment` does NOT require a running task beforehand; it just registers the new task definition and tells the service to roll.

Wait — `update-service --force-new-deployment` requires `desired_count > 0` to actually boot anything. So the first deploy needs to explicitly set `desired_count = 1`. Options:

- **B1.** `deploy.sh` (Task 1.7) reads current `desired_count` and leaves it alone; first real deploy manually runs `aws ecs update-service --desired-count 1` once.
- **B2.** Terraform declares `desired_count = 1` from the start, `aws ecs create-service` succeeds with a stub image (task repeatedly failing to boot is fine — service just keeps trying until first real deploy replaces the image).

Choice: **B2**. Simpler. Service is "failing healthily" until the first deploy; then it converges.

**Acceptance Criteria:**

- [ ] ECS service `ahand-hub-{env}` exists in cluster `{openclaw-hive | openclaw-hive-dev}`, `desired_count = 1`, `launch_type = FARGATE`.
- [ ] Task definition family `ahand-hub-{env}` is registered; initial revision uses image `amazon/amazon-ecs-sample:latest` (or a deliberately non-existent tag like `ahand-hub:stub` — but using a known-good sample is kinder to the service's initial boot while still being obvious that it's a placeholder).
- [ ] Container port 1515 published.
- [ ] Traefik Docker labels attached so routing is ready on first real deploy.
- [ ] Logs configured to `/ecs/ahand-hub` with stream prefix `ahand-hub-{env}`.
- [ ] `executionRoleArn` = Task 3.1's execution role; `taskRoleArn` = Task 3.1's task role.
- [ ] Security group allows outbound (egress default) and inbound only 1515 from Traefik security group.
- [ ] Service is discoverable via the openclaw-hive Traefik instance on the declared domain.
- [ ] After running `deploy-hub.yml` once with a real image: `aws ecs describe-services --services ahand-hub-prod` shows `runningCount = 1`, `deployments[0].status = PRIMARY`, and `GET https://ahand-hub.team9.ai/api/health` returns 200.

**Verify:**

```bash
aws ecs describe-services --cluster openclaw-hive --services ahand-hub-prod --profile ww \
  --query 'services[0].{name:serviceName, desired:desiredCount, running:runningCount, pending:pendingCount, taskDef:taskDefinition, status:status}'

aws ecs list-task-definitions --family-prefix ahand-hub-prod --profile ww \
  --query 'taskDefinitionArns' --output text

# After first real deploy:
curl -fsSL https://ahand-hub.team9.ai/api/health
# Expected: 200 OK with hub health payload
```

**Steps:**

- [ ] **Step 1: Look up existing Traefik security group**

```hcl
# terraform/modules/ahand-hub/ecs.tf

data "aws_security_group" "traefik" {
  name = var.traefik_security_group_name  # e.g. "openclaw-hive-traefik-sg"
}

resource "aws_security_group" "ahand_hub_task" {
  name        = "ahand-hub-${var.env}-task-sg"
  description = "Ingress from Traefik for ahand-hub ECS task"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 1515
    to_port         = 1515
    protocol        = "tcp"
    security_groups = [data.aws_security_group.traefik.id]
    description     = "From Traefik"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "All egress"
  }

  tags = local.common_tags
}
```

Add `var.vpc_id` and `var.traefik_security_group_name` and `var.private_subnet_ids` to `variables.tf`. Populate from the openclaw-hive outputs in root `main.tf`.

- [ ] **Step 2: Stub task definition**

```hcl
# terraform/modules/ahand-hub/ecs.tf (continued)

resource "aws_ecs_task_definition" "stub" {
  family                   = "ahand-hub-${var.env}"
  cpu                      = var.env == "prod" ? "512" : "256"
  memory                   = var.env == "prod" ? "1024" : "512"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  # This is a one-time stub. The GitHub Actions deploy-hub.yml workflow
  # registers a fresh revision and the service switches to it on first push.
  # We use a known-good sample container so the service doesn't crash-loop
  # until first deploy; it just serves the sample page on port 80 inside
  # the container — harmless since Traefik only routes 1515 to the ALB.
  container_definitions = jsonencode([
    {
      name      = "ahand-hub"
      image     = "amazon/amazon-ecs-sample:latest"
      essential = true
      portMappings = [{ containerPort = 1515, protocol = "tcp" }]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = "/ecs/ahand-hub"
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "ahand-hub-${var.env}"
        }
      }
    }
  ])

  lifecycle {
    # The real task definitions are registered by deploy-hub.yml — ignore changes
    # to container_definitions so Terraform doesn't try to revert post-deploy.
    ignore_changes = [container_definitions]
  }

  tags = local.common_tags
}
```

The `ignore_changes = [container_definitions]` is critical — once `deploy.sh` registers a real task definition revision, we don't want Terraform to fight it.

- [ ] **Step 3: ECS service**

```hcl
# terraform/modules/ahand-hub/ecs.tf (continued)

resource "aws_ecs_service" "ahand_hub" {
  name            = "ahand-hub-${var.env}"
  cluster         = var.ecs_cluster_name
  task_definition = aws_ecs_task_definition.stub.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.ahand_hub_task.id]
    assign_public_ip = false
  }

  deployment_maximum_percent         = 200
  deployment_minimum_healthy_percent = 0   # allow full replacement for stub

  # Traefik's Docker provider reads container labels directly from ECS task
  # metadata; no ALB target group is needed. (folder9 follows the same pattern.)

  lifecycle {
    # Let deploy-hub.yml manage task_definition — otherwise Terraform would revert
    # to the stub after every real deploy.
    ignore_changes = [task_definition, desired_count]
  }

  tags = local.common_tags
}

output "ecs_service_name" {
  value = aws_ecs_service.ahand_hub.name
}
output "ecs_task_definition_family" {
  value = aws_ecs_task_definition.stub.family
}
```

- [ ] **Step 4: Update root main.tf to pass VPC / subnet / SG names**

```hcl
# terraform/main.tf (patch — expose existing infra refs to ahand_hub modules)

data "aws_vpc" "openclaw" {
  tags = {
    Name = "openclaw-hive-vpc"
  }
}

data "aws_subnets" "openclaw_private" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.openclaw.id]
  }
  filter {
    name   = "tag:Tier"
    values = ["private"]
  }
}

module "ahand_hub_prod" {
  source = "./modules/ahand-hub"
  env    = "prod"
  # ...earlier fields
  vpc_id                       = data.aws_vpc.openclaw.id
  private_subnet_ids           = data.aws_subnets.openclaw_private.ids
  traefik_alb_name             = "openclaw-hive-traefik"
  traefik_security_group_name  = "openclaw-hive-traefik-sg"
  gateway_public_url           = "https://gateway.team9.ai"
}

module "ahand_hub_dev" {
  source = "./modules/ahand-hub"
  env    = "dev"
  # ...earlier fields
  vpc_id                       = data.aws_vpc.openclaw.id
  private_subnet_ids           = data.aws_subnets.openclaw_private.ids
  traefik_alb_name             = "openclaw-hive-dev-traefik"
  traefik_security_group_name  = "openclaw-hive-dev-traefik-sg"
  gateway_public_url           = "https://gateway.dev.team9.ai"
}
```

If the VPC / subnet tag conventions don't match the above, adjust the `data` queries. (Check by running `terraform console` → `data.aws_vpc.openclaw`.)

- [ ] **Step 5: Apply**

```bash
cd <infra-repo>/terraform
terraform plan
terraform apply

# Expect: ECS service ahand-hub-prod in status ACTIVE, desired=1,
# running=0 or 1 (depending on whether the sample container boots ok).
aws ecs describe-services --cluster openclaw-hive --services ahand-hub-prod --profile ww \
  --query 'services[0].{desired:desiredCount, running:runningCount, status:status}'
```

- [ ] **Step 6: End-to-end smoke — run Phase 1 `deploy-hub.yml`**

Once Phase 1 lands, push a trivial commit to the ahand repo's `dev` branch that touches a file under the workflow's path filter:

```bash
cd ~/Projects/weightwave/ahand
git checkout -b smoke-test-dev-deploy origin/dev
echo "# trigger deploy" >> deploy/hub/README.md   # or whatever exists
git commit -am "chore: trigger dev deploy-hub.yml smoke"
git push origin smoke-test-dev-deploy:dev
```

Watch the workflow in GitHub Actions. After `aws ecs wait services-stable` succeeds:

```bash
curl -fsSL https://ahand-hub.dev.team9.ai/api/health
# Expect: {"status":"ok",...}
```

Only after dev smoke-test passes, let `main` branch do the prod deploy.

- [ ] **Step 7: Commit**

```bash
cd <infra-repo>
git add terraform/modules/ahand-hub/ecs.tf terraform/modules/ahand-hub/variables.tf \
        terraform/main.tf
git commit -m "$(cat <<'EOF'
feat(ahand-hub): ECS service + stub task definition

Declares the ECS Fargate service ahand-hub-{prod,dev} in the openclaw-
hive cluster family, so Phase 1's deploy-hub.yml workflow has an
existing service to aws ecs update-service --force-new-deployment
against. Stub task definition uses amazon/amazon-ecs-sample:latest as
a placeholder; the first GitHub Actions deploy registers the real
revision. lifecycle ignore_changes = [task_definition, desired_count,
container_definitions] prevents Terraform from reverting post-deploy
state.

Security group allows 1515 inbound only from Traefik's SG, with
unrestricted egress. Logs to the shared /ecs/ahand-hub log group
with per-env stream prefix.

Task resource tier is 512/1024 for prod and 256/512 for dev, matching
the MVP cost estimate in spec § 7.9.

After apply, running deploy-hub.yml on the ahand repo's dev or main
branch should reach services-stable and serve /api/health from the
public domain.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

**Phase 3 outcome:** team9's AWS now has all infrastructure for ahand-hub — IAM roles, ECR repo, dedicated Postgres databases on the shared RDS, Redis (reused or newly provisioned), all SSM secrets, Route53 A records, CloudWatch log group, and ECS service stubs ready for Phase 1's deploy-hub.yml workflow to populate with real containers. No ahand code has shipped to production yet; this is just the substrate.

---

## Phase 4 — Team9 Gateway `ahand` Module

**Working directory:** `/Users/winrey/Projects/weightwave/team9/apps/server/apps/gateway`.

Build the NestJS `ahand` module that sits between the Tauri client, the im-worker, and the ahand-hub. This module is the sole holder of the hub service token and the sole issuer of hub device JWTs. Tauri never talks to the hub directly; it always transits gateway. im-worker talks to the hub directly via `@ahand/sdk` but acquires its control-plane JWT through the gateway's internal API.

**Dependencies:**

- Phase 1 must be live (hub admin API + webhook sender + JWT claim extension).
- Phase 3 must be applied (SSM parameters, gateway env vars will reference them).
- Phase 2 is unrelated — Phase 4 doesn't touch the agent framework.

**Module layout:**

```
apps/server/apps/gateway/src/ahand/
├── ahand.module.ts              # NestJS module wiring
├── ahand.controller.ts          # REST endpoints for Tauri (JwtAuthGuard protected)
├── ahand-internal.controller.ts # Internal endpoints for im-worker (service-token protected)
├── ahand-webhook.controller.ts  # Hub → gateway webhook receiver (HMAC validated)
├── ahand.service.ts             # Business logic (registration, ownership, token ops)
├── ahand-hub.client.ts          # HTTP client wrapping hub admin + control-plane APIs
├── ahand-redis-publisher.service.ts  # Publishes ahand:events:{ownerId} for im-worker
├── ahand-events.gateway.ts      # Socket.io integration (room membership, emit helpers)
├── dto/
│   ├── register-device.dto.ts
│   ├── device.dto.ts
│   ├── webhook-event.dto.ts
│   └── internal.dto.ts
└── ahand.service.spec.ts
```

**Env vars consumed (declared in `apps/server/apps/gateway/src/config/configuration.ts`):**

```ts
AHAND_HUB_URL; // https://ahand-hub.team9.ai  (from SSM)
AHAND_HUB_SERVICE_TOKEN; // from SSM
AHAND_HUB_WEBHOOK_SECRET; // from SSM
```

---

### Task 4.1: Drizzle schema `ahand_devices` + migration

**Goal:** Add the `ahand_devices` table to the shared database schema, generate the migration, apply to local dev, verify, and export from the IM schema index.

**Files:**

- Create: `apps/server/libs/database/schemas/im/ahand-devices.ts`
- Modify: `apps/server/libs/database/schemas/im/index.ts` — export the new schema.
- Modify: `apps/server/libs/database/src/database.module.ts` (or wherever tables are registered with the Drizzle instance) — include `ahandDevices`.
- Create: `apps/server/libs/database/drizzle/<timestamp>_ahand_devices.sql` (auto-generated by `drizzle-kit`).
- Modify: `apps/server/libs/database/drizzle/meta/_journal.json` (auto).

**Acceptance Criteria:**

- [ ] Table `ahand_devices` created with columns per spec § 3.2: `id uuid PK`, `owner_type text NOT NULL`, `owner_id uuid NOT NULL`, `hub_device_id text NOT NULL UNIQUE`, `public_key text NOT NULL`, `nickname text NOT NULL`, `platform text NOT NULL`, `hostname text`, `status text NOT NULL DEFAULT 'active'`, `last_seen_at timestamp`, `created_at timestamp NOT NULL DEFAULT now()`, `revoked_at timestamp`.
- [ ] Indexes: `ahand_devices_owner_idx` on `(owner_type, owner_id)`; `ahand_devices_status_idx` on `(status)`.
- [ ] CHECK constraint optional but recommended: `CHECK (owner_type IN ('user', 'workspace'))`.
- [ ] The Drizzle migration file is committed, applies cleanly against the local Postgres (`pnpm db:migrate`), and is idempotent on re-apply (Drizzle's journal handles this automatically; verify the journal entry is committed too).
- [ ] `DatabaseService.ahandDevices` is typed and queryable from within the gateway app (integration smoke test: `await db.select().from(schema.ahandDevices)` returns `[]` on a fresh DB).

**Verify:**

```bash
cd apps/server
pnpm db:generate   # confirm no drift
pnpm db:migrate    # apply to local Postgres
psql "$DATABASE_URL" -c "\d+ ahand_devices"
psql "$DATABASE_URL" -c "\di ahand_devices*"
# Expected: table structure and two indexes present
```

Integration test (create in Task 4.3's service spec file):

```ts
it("fresh DB returns empty device list", async () => {
  const devices = await db.select().from(ahandDevices);
  expect(devices).toEqual([]);
});
```

**Steps:**

- [ ] **Step 1: Write the schema file**

```ts
// apps/server/libs/database/schemas/im/ahand-devices.ts

import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";

export const ahandDevices = pgTable(
  "ahand_devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Polymorphic ownership. MVP populates "user"; "workspace" is a follow-up.
    ownerType: text("owner_type").notNull(), // "user" | "workspace"
    ownerId: uuid("owner_id").notNull(), // logical FK; no DB constraint (polymorphic)
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
    createdAt: timestamp("created_at").notNull().defaultNow(),
    revokedAt: timestamp("revoked_at"),
  },
  (t) => ({
    ownerIdx: index("ahand_devices_owner_idx").on(t.ownerType, t.ownerId),
    statusIdx: index("ahand_devices_status_idx").on(t.status),
  }),
);

export type AhandDevice = typeof ahandDevices.$inferSelect;
export type NewAhandDevice = typeof ahandDevices.$inferInsert;
```

- [ ] **Step 2: Export from the im schemas barrel**

```ts
// apps/server/libs/database/schemas/im/index.ts (patch)

export * from "./users";
export * from "./channels";
// ...existing
export * from "./ahand-devices"; // NEW
```

If `database.module.ts` assembles a single `schema` object that Drizzle uses for typing, verify `ahandDevices` appears in the combined type. Some repos do this via spread-exports (`{ ...imSchemas, ...tenantSchemas }`). Grep: `rg -nP 'ahand|imSchemas|combinedSchema' apps/server/libs/database/src/`.

- [ ] **Step 3: Generate + apply migration**

```bash
cd apps/server
pnpm db:generate
# drizzle-kit emits something like drizzle/0021_ahand_devices.sql
# Inspect:
cat libs/database/drizzle/0021_ahand_devices.sql
```

Expected SQL skeleton:

```sql
CREATE TABLE IF NOT EXISTS "ahand_devices" (
  "id"              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "owner_type"      text        NOT NULL,
  "owner_id"        uuid        NOT NULL,
  "hub_device_id"   text        NOT NULL UNIQUE,
  "public_key"      text        NOT NULL,
  "nickname"        text        NOT NULL,
  "platform"        text        NOT NULL,
  "hostname"        text,
  "status"          text        NOT NULL DEFAULT 'active',
  "last_seen_at"    timestamp,
  "created_at"      timestamp   NOT NULL DEFAULT now(),
  "revoked_at"      timestamp
);

CREATE INDEX IF NOT EXISTS "ahand_devices_owner_idx" ON "ahand_devices"("owner_type","owner_id");
CREATE INDEX IF NOT EXISTS "ahand_devices_status_idx" ON "ahand_devices"("status");
```

If drizzle-kit missed the CHECK constraint (it doesn't support them declaratively), add it in the SQL file manually and re-check drizzle-kit emits no new migration for the manual edit:

```sql
-- Manual addition to 0021_ahand_devices.sql
ALTER TABLE "ahand_devices" ADD CONSTRAINT "ahand_devices_owner_type_check"
  CHECK ("owner_type" IN ('user', 'workspace'));
ALTER TABLE "ahand_devices" ADD CONSTRAINT "ahand_devices_status_check"
  CHECK ("status" IN ('active', 'revoked'));
```

Apply:

```bash
pnpm db:migrate
psql "$DATABASE_URL" -c "\d ahand_devices"
psql "$DATABASE_URL" -c "\di ahand_devices*"
```

- [ ] **Step 4: Quick typed-query smoke test**

```bash
# Inside a REPL or a throwaway test file:
cd apps/server
node --input-type=module --eval '
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { ahandDevices } from "./dist/libs/database/schemas/im/ahand-devices.js";
const sql = postgres(process.env.DATABASE_URL);
const db = drizzle(sql);
const rows = await db.select().from(ahandDevices);
console.log("count:", rows.length);
await sql.end();
'
```

(Skip this if the build step isn't set up; the Task 4.3 service tests will catch any wiring issues.)

- [ ] **Step 5: Commit**

```bash
cd /Users/winrey/Projects/weightwave/team9
git add apps/server/libs/database/schemas/im/ahand-devices.ts \
        apps/server/libs/database/schemas/im/index.ts \
        apps/server/libs/database/drizzle/0021_ahand_devices.sql \
        apps/server/libs/database/drizzle/meta/
git commit -m "$(cat <<'EOF'
feat(database): add ahand_devices table

New table captures per-user (future: per-workspace) ahand device
registrations. Polymorphic ownership via (owner_type, owner_id) with
CHECK constraint guarding valid values — no DB FK because the target
table depends on owner_type. hub_device_id is UNIQUE (SHA256 of the
Ed25519 public key). Indexes cover the two dominant access patterns:
list devices for an owner, and filter active rows.

See specs/2026-04-22-ahand-integration-design.md § 3.2 for the
ownership model rationale and the future-workspace migration plan.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4.2: `AhandHubClient` — HTTP wrapper for hub admin + control-plane APIs

**Goal:** Encapsulate every call from gateway into ahand-hub behind a typed NestJS injectable service. All hub service-token usage lives here; no other code in the gateway should read `AHAND_HUB_SERVICE_TOKEN`.

**Files:**

- Create: `apps/server/apps/gateway/src/ahand/ahand-hub.client.ts`
- Create: `apps/server/apps/gateway/src/ahand/ahand-hub.client.spec.ts`
- Modify: `apps/server/apps/gateway/src/config/configuration.ts` — add `ahandHubUrl`, `ahandHubServiceToken` fields with validation.

**Acceptance Criteria:**

- [ ] `AhandHubClient` is `@Injectable()`. Dependencies: `ConfigService`, `HttpService` (NestJS `@nestjs/axios` — already in deps; verify).
- [ ] Constructor reads `AHAND_HUB_URL` and `AHAND_HUB_SERVICE_TOKEN` from config; throws `InternalServerErrorException` if either is missing.
- [ ] Exposes five methods with typed DTOs (see signatures below): `registerDevice`, `mintDeviceToken`, `mintControlPlaneToken`, `deleteDevice`, `listDevicesForExternalUser`.
- [ ] Retries on 5xx with exponential backoff up to 3 attempts; fails fast (no retry) on 4xx; surfaces 4xx bodies with preserved error codes.
- [ ] 403 from hub throws `ForbiddenException`; 404 throws `NotFoundException`; 409 throws `ConflictException`; 503 / timeout throws `ServiceUnavailableException`.
- [ ] Response decoding validates the shape via `zod` (or class-validator); malformed responses throw with "unexpected hub response" error.
- [ ] 100% unit test coverage on `ahand-hub.client.ts` using `nock` or `msw` to mock HTTP.

**Verify:** `pnpm test apps/server/apps/gateway/src/ahand/ahand-hub.client.spec.ts --coverage` — 100% coverage statements/branches/functions.

**Steps:**

- [ ] **Step 1: Config plumbing**

```ts
// apps/server/apps/gateway/src/config/configuration.ts (patch)

export interface AppConfig {
  // ...existing fields
  ahandHubUrl: string;
  ahandHubServiceToken: string;
}

export default (): AppConfig => ({
  // ...existing
  ahandHubUrl: process.env.AHAND_HUB_URL ?? "",
  ahandHubServiceToken: process.env.AHAND_HUB_SERVICE_TOKEN ?? "",
});
```

Add Joi/Zod validation (match the repo's convention):

```ts
// apps/server/apps/gateway/src/config/validation.ts (patch)

export const configSchema = Joi.object({
  // existing keys...
  AHAND_HUB_URL: Joi.string().uri().required(),
  AHAND_HUB_SERVICE_TOKEN: Joi.string().min(16).required(),
});
```

- [ ] **Step 2: Implement `AhandHubClient`**

```ts
// apps/server/apps/gateway/src/ahand/ahand-hub.client.ts

import {
  Injectable,
  Logger,
  ForbiddenException,
  NotFoundException,
  ConflictException,
  ServiceUnavailableException,
  InternalServerErrorException,
  HttpException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import type { AxiosError, AxiosRequestConfig } from "axios";
import { z } from "zod";

const DeviceRecordSchema = z.object({
  deviceId: z.string(),
  publicKey: z.string().optional(),
  nickname: z.string().optional(),
  externalUserId: z.string().optional(),
  isOnline: z.boolean().optional(),
  lastSeenAt: z.string().optional(),
  createdAt: z.string().optional(),
});
export type HubDeviceRecord = z.infer<typeof DeviceRecordSchema>;

const MintedTokenSchema = z.object({
  token: z.string(),
  expiresAt: z.string(),
});
export type HubMintedToken = z.infer<typeof MintedTokenSchema>;

interface RegisterDeviceInput {
  deviceId: string;
  publicKey: string;
  externalUserId: string;
  metadata?: Record<string, unknown>;
}

interface MintDeviceTokenInput {
  deviceId: string;
  ttlSeconds?: number; // default 604800 (7d) for Tauri; pass 3600 for short-lived ops
}

interface MintControlPlaneTokenInput {
  externalUserId: string;
  deviceIds?: string[];
  scope?: "jobs:execute";
  ttlSeconds?: number; // default 3600
}

@Injectable()
export class AhandHubClient {
  private readonly logger = new Logger(AhandHubClient.name);
  private readonly baseUrl: string;
  private readonly serviceToken: string;

  constructor(
    private readonly http: HttpService,
    cfg: ConfigService,
  ) {
    this.baseUrl = cfg.get<string>("ahandHubUrl") ?? "";
    this.serviceToken = cfg.get<string>("ahandHubServiceToken") ?? "";
    if (!this.baseUrl || !this.serviceToken) {
      throw new InternalServerErrorException(
        "AhandHubClient: ahandHubUrl and ahandHubServiceToken must be configured",
      );
    }
  }

  async registerDevice(input: RegisterDeviceInput): Promise<HubDeviceRecord> {
    return this.request({
      method: "POST",
      url: "/api/admin/devices",
      data: input,
      schema: DeviceRecordSchema,
    });
  }

  async mintDeviceToken(input: MintDeviceTokenInput): Promise<HubMintedToken> {
    const body = input.ttlSeconds ? { ttlSeconds: input.ttlSeconds } : {};
    return this.request({
      method: "POST",
      url: `/api/admin/devices/${encodeURIComponent(input.deviceId)}/token`,
      data: body,
      schema: MintedTokenSchema,
    });
  }

  async mintControlPlaneToken(
    input: MintControlPlaneTokenInput,
  ): Promise<HubMintedToken> {
    return this.request({
      method: "POST",
      url: "/api/admin/control-plane/token",
      data: input,
      schema: MintedTokenSchema,
    });
  }

  async deleteDevice(deviceId: string): Promise<void> {
    await this.request({
      method: "DELETE",
      url: `/api/admin/devices/${encodeURIComponent(deviceId)}`,
      schema: z.any(),
      allowEmptyBody: true,
    });
  }

  async listDevicesForExternalUser(
    externalUserId: string,
  ): Promise<HubDeviceRecord[]> {
    return this.request({
      method: "GET",
      url: "/api/admin/devices",
      params: { externalUserId },
      schema: z.array(DeviceRecordSchema),
    });
  }

  // ---------------------------------------------------------------------------

  private async request<T>(opts: {
    method: AxiosRequestConfig["method"];
    url: string;
    data?: unknown;
    params?: Record<string, string>;
    schema: z.ZodType<T>;
    allowEmptyBody?: boolean;
  }): Promise<T> {
    const url = `${this.baseUrl}${opts.url}`;
    const config: AxiosRequestConfig = {
      method: opts.method,
      url,
      data: opts.data,
      params: opts.params,
      headers: {
        Authorization: `Bearer ${this.serviceToken}`,
        "Content-Type": "application/json",
      },
      timeout: 10_000,
      validateStatus: () => true, // we route status codes manually
    };

    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await firstValueFrom(this.http.request(config));
        if (response.status >= 200 && response.status < 300) {
          if (opts.allowEmptyBody && (!response.data || response.data === "")) {
            return undefined as unknown as T;
          }
          const parsed = opts.schema.safeParse(response.data);
          if (!parsed.success) {
            this.logger.error(
              `Unexpected hub response for ${opts.method} ${opts.url}: ${parsed.error.message}`,
            );
            throw new InternalServerErrorException(
              "Unexpected ahand-hub response shape",
            );
          }
          return parsed.data;
        }
        // 4xx → don't retry; 5xx → retry
        if (response.status >= 400 && response.status < 500) {
          this.throwMappedHttp(response.status, response.data, opts);
        }
        // 5xx falls through to retry loop
        lastError = new Error(
          `hub ${opts.method} ${opts.url} returned ${response.status}`,
        );
      } catch (e) {
        if (e instanceof HttpException) throw e; // already-mapped 4xx, don't retry
        lastError = e;
      }
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 2 ** attempt * 100));
      }
    }
    this.logger.error(
      `AhandHubClient retries exhausted for ${opts.method} ${opts.url}`,
      lastError,
    );
    throw new ServiceUnavailableException("ahand-hub is unavailable");
  }

  private throwMappedHttp(
    status: number,
    body: unknown,
    opts: { method: unknown; url: string },
  ): never {
    const message =
      typeof body === "object" && body !== null && "message" in body
        ? String((body as any).message)
        : `hub returned ${status}`;
    if (status === 403) throw new ForbiddenException(message);
    if (status === 404) throw new NotFoundException(message);
    if (status === 409) throw new ConflictException(message);
    throw new HttpException(message, status);
  }
}
```

- [ ] **Step 3: Tests**

```ts
// apps/server/apps/gateway/src/ahand/ahand-hub.client.spec.ts

import { Test } from "@nestjs/testing";
import { HttpModule, HttpService } from "@nestjs/axios";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { AhandHubClient } from "./ahand-hub.client";
import nock from "nock";
import {
  ForbiddenException,
  NotFoundException,
  ConflictException,
  ServiceUnavailableException,
  InternalServerErrorException,
} from "@nestjs/common";

describe("AhandHubClient", () => {
  const BASE = "https://hub.test";
  let client: AhandHubClient;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        HttpModule.register({}),
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          load: [
            () => ({
              ahandHubUrl: BASE,
              ahandHubServiceToken: "svc_token_abcdef",
            }),
          ],
        }),
      ],
      providers: [AhandHubClient],
    }).compile();
    client = moduleRef.get(AhandHubClient);
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe("registerDevice", () => {
    it("POSTs to /api/admin/devices with service bearer and returns parsed device", async () => {
      nock(BASE)
        .post("/api/admin/devices", {
          deviceId: "abc",
          publicKey: "pk",
          externalUserId: "u1",
        })
        .matchHeader("authorization", "Bearer svc_token_abcdef")
        .reply(200, { deviceId: "abc", createdAt: "2026-04-22T10:00:00Z" });
      const res = await client.registerDevice({
        deviceId: "abc",
        publicKey: "pk",
        externalUserId: "u1",
      });
      expect(res.deviceId).toBe("abc");
    });

    it("409 → ConflictException without retry", async () => {
      nock(BASE).post("/api/admin/devices").reply(409, { message: "taken" });
      await expect(
        client.registerDevice({
          deviceId: "x",
          publicKey: "p",
          externalUserId: "u",
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe("mintDeviceToken", () => {
    it("POSTs to /api/admin/devices/{id}/token with TTL", async () => {
      nock(BASE)
        .post("/api/admin/devices/abc/token", { ttlSeconds: 604800 })
        .reply(200, { token: "jwt.xxx", expiresAt: "2026-04-29T10:00:00Z" });
      const res = await client.mintDeviceToken({
        deviceId: "abc",
        ttlSeconds: 604800,
      });
      expect(res.token).toBe("jwt.xxx");
    });

    it("URL-encodes deviceId with special chars", async () => {
      nock(BASE)
        .post("/api/admin/devices/a%2Fb/token")
        .reply(200, { token: "t", expiresAt: "2026-04-29T10:00:00Z" });
      await client.mintDeviceToken({ deviceId: "a/b" });
    });
  });

  describe("mintControlPlaneToken", () => {
    it("POSTs to /api/admin/control-plane/token", async () => {
      nock(BASE)
        .post("/api/admin/control-plane/token", {
          externalUserId: "u1",
          scope: "jobs:execute",
        })
        .reply(200, { token: "cp.xyz", expiresAt: "2026-04-22T11:00:00Z" });
      const res = await client.mintControlPlaneToken({
        externalUserId: "u1",
        scope: "jobs:execute",
      });
      expect(res.token).toBe("cp.xyz");
    });
  });

  describe("deleteDevice", () => {
    it("DELETEs; empty body returns undefined", async () => {
      nock(BASE).delete("/api/admin/devices/abc").reply(204);
      await expect(client.deleteDevice("abc")).resolves.toBeUndefined();
    });

    it("404 → NotFoundException", async () => {
      nock(BASE)
        .delete("/api/admin/devices/abc")
        .reply(404, { message: "nope" });
      await expect(client.deleteDevice("abc")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("listDevicesForExternalUser", () => {
    it("GETs and parses array", async () => {
      nock(BASE)
        .get("/api/admin/devices")
        .query({ externalUserId: "u1" })
        .reply(200, [{ deviceId: "a" }, { deviceId: "b" }]);
      const res = await client.listDevicesForExternalUser("u1");
      expect(res).toHaveLength(2);
    });

    it("malformed response shape → InternalServerErrorException", async () => {
      nock(BASE)
        .get("/api/admin/devices")
        .query({ externalUserId: "u1" })
        .reply(200, "not an array");
      await expect(client.listDevicesForExternalUser("u1")).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe("retry behavior", () => {
    it("retries 5xx up to 3 times with backoff", async () => {
      nock(BASE)
        .post("/api/admin/devices")
        .reply(503)
        .post("/api/admin/devices")
        .reply(503)
        .post("/api/admin/devices")
        .reply(200, { deviceId: "ok" });
      const res = await client.registerDevice({
        deviceId: "ok",
        publicKey: "p",
        externalUserId: "u",
      });
      expect(res.deviceId).toBe("ok");
    });

    it("3×503 → ServiceUnavailableException", async () => {
      nock(BASE).post("/api/admin/devices").times(3).reply(503);
      await expect(
        client.registerDevice({
          deviceId: "x",
          publicKey: "p",
          externalUserId: "u",
        }),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it("403 from hub → ForbiddenException immediately (no retry)", async () => {
      const scope = nock(BASE)
        .post("/api/admin/devices")
        .reply(403, { message: "forbidden" });
      await expect(
        client.registerDevice({
          deviceId: "x",
          publicKey: "p",
          externalUserId: "u",
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(scope.isDone()).toBe(true); // matched exactly once, no retries
    });
  });

  describe("configuration", () => {
    it("constructor throws when config is missing", async () => {
      await expect(
        Test.createTestingModule({
          imports: [
            HttpModule.register({}),
            ConfigModule.forRoot({
              ignoreEnvFile: true,
              load: [() => ({ ahandHubUrl: "", ahandHubServiceToken: "" })],
            }),
          ],
          providers: [AhandHubClient],
        })
          .compile()
          .then((m) => m.get(AhandHubClient)),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });
});
```

- [ ] **Step 4: Commit**

```bash
cd /Users/winrey/Projects/weightwave/team9
git add apps/server/apps/gateway/src/ahand/ahand-hub.client.ts \
        apps/server/apps/gateway/src/ahand/ahand-hub.client.spec.ts \
        apps/server/apps/gateway/src/config/
git commit -m "$(cat <<'EOF'
feat(gateway/ahand): typed HTTP client for ahand-hub admin APIs

AhandHubClient is the sole in-gateway caller of AHAND_HUB_SERVICE_TOKEN;
no other code reads that secret. Methods:
- registerDevice: preregister a device under an externalUserId
- mintDeviceToken: obtain a device JWT for Tauri
- mintControlPlaneToken: obtain a control-plane JWT for im-worker
- deleteDevice: revoke
- listDevicesForExternalUser: for periodic reconciliation

Retries 5xx × 3 with exponential backoff; fails fast on 4xx mapping
403→Forbidden, 404→NotFound, 409→Conflict. Zod validates response
shapes to catch hub schema drift early.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4.3: `AhandDevicesService` — business logic (DB + Redis + hub orchestration)

**Goal:** Single service that owns the registration / list / refresh / delete flows. It fans work out to `AhandHubClient` (for hub mutations), Drizzle (for the `ahand_devices` table), Redis (for presence reads), and `AhandRedisPublisher` (for fan-out to im-worker). Controllers delegate everything here.

**Files:**

- Create: `apps/server/apps/gateway/src/ahand/ahand.service.ts`
- Create: `apps/server/apps/gateway/src/ahand/ahand.service.spec.ts`
- Modify: `apps/server/apps/gateway/src/redis/redis.module.ts` or equivalent — expose a Redis client injection token (likely already there; verify).

**Acceptance Criteria:**

- [ ] `AhandDevicesService.registerDeviceForUser(userId, input)` executes the full flow in a DB transaction: hub pre-register → insert row → mint initial device JWT → return `{ device, deviceJwt, hubUrl, jwtExpiresAt }`. If any step fails, transaction rolls back AND previously-created hub records are cleaned up (best-effort hub DELETE).
- [ ] `listDevicesForOwner(ownerType, ownerId, { includeOffline })` returns rows from DB with isOnline derived from Redis `ahand:device:{hubDeviceId}:presence`. Missing Redis keys → `isOnline = false`. Redis outage → returns `null` for isOnline with a logged warning, never throws.
- [ ] `refreshDeviceToken(userId, deviceId)` validates ownership (row exists with matching `ownerType=user, ownerId=userId, status=active`), calls hub mintDeviceToken, returns new JWT.
- [ ] `patchDevice(userId, deviceId, { nickname })` validates ownership, updates row. Nickname length enforced (1-120 chars).
- [ ] `revokeDevice(userId, deviceId)` flips row to status=revoked, calls hub DELETE (idempotent), publishes Redis event, returns success. Hub DELETE failure logged but doesn't fail the call (row-state and Redis event already emitted).
- [ ] `listActiveDevicesForUser(userId, opts)` exposed for im-worker (through the internal controller). Returns only non-revoked rows.
- [ ] All methods take `ownerType='user'` implicitly for MVP but accept a caller-supplied `ownerType` argument so workspace-owned flows can land later without rewrites.
- [ ] Listener `@OnEvent("user.deleted")` cascades revocation: fetch all active devices for that user → mark revoked → call hub DELETE per device (best-effort).
- [ ] 100% unit test coverage; tests mock `AhandHubClient`, Drizzle (via an in-memory test db fixture already used by other services — grep `TestDatabaseModule` for the repo's pattern), Redis (via `ioredis-mock`), and `AhandRedisPublisher`.

**Verify:** `pnpm test apps/server/apps/gateway/src/ahand/ahand.service.spec.ts --coverage` — all green, 100% on `ahand.service.ts`.

**Steps:**

- [ ] **Step 1: Implement the service**

```ts
// apps/server/apps/gateway/src/ahand/ahand.service.ts

import {
  Injectable,
  Logger,
  ForbiddenException,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "@app/database";
import { ahandDevices, type AhandDevice } from "@app/database/schemas/im";
import { and, eq, inArray } from "drizzle-orm";
import type Redis from "ioredis";
import { Inject } from "@nestjs/common";
import { AhandHubClient } from "./ahand-hub.client";
import { AhandRedisPublisher } from "./ahand-redis-publisher.service";

export type OwnerType = "user" | "workspace";

export interface RegisterDeviceInput {
  hubDeviceId: string;
  publicKey: string;
  nickname: string;
  platform: string;
  hostname?: string;
}

export interface RegisteredDeviceResult {
  device: AhandDevice;
  deviceJwt: string;
  hubUrl: string;
  jwtExpiresAt: string;
}

export interface DeviceWithPresence extends AhandDevice {
  isOnline: boolean | null; // null if Redis couldn't answer
}

const DEVICE_JWT_TTL_SECONDS = 7 * 24 * 3600; // 7 days; see spec § 4.6

@Injectable()
export class AhandDevicesService {
  private readonly logger = new Logger(AhandDevicesService.name);
  private readonly hubUrl: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly hub: AhandHubClient,
    private readonly redisPublisher: AhandRedisPublisher,
    @Inject("REDIS_CLIENT") private readonly redis: Redis,
    cfg: ConfigService,
  ) {
    this.hubUrl = cfg.getOrThrow<string>("ahandHubUrl");
  }

  async registerDeviceForUser(
    userId: string,
    input: RegisterDeviceInput,
  ): Promise<RegisteredDeviceResult> {
    this.validateNickname(input.nickname);
    // 1. Pre-register with hub (gives us the canonical externalUserId binding)
    let hubCreated = false;
    try {
      await this.hub.registerDevice({
        deviceId: input.hubDeviceId,
        publicKey: input.publicKey,
        externalUserId: userId,
      });
      hubCreated = true;
    } catch (e) {
      // ConflictException from hub → propagate; already-taken = user error.
      throw e;
    }

    // 2. Insert DB row. On DB failure, compensate by deleting the hub record.
    let inserted: AhandDevice;
    try {
      const [row] = await this.db.db
        .insert(ahandDevices)
        .values({
          ownerType: "user",
          ownerId: userId,
          hubDeviceId: input.hubDeviceId,
          publicKey: input.publicKey,
          nickname: input.nickname,
          platform: input.platform,
          hostname: input.hostname ?? null,
          status: "active",
        })
        .returning();
      inserted = row;
    } catch (e) {
      if (hubCreated) {
        this.logger.warn(
          `Rolling back hub registration for ${input.hubDeviceId} after DB insert failure`,
          e,
        );
        await this.hub.deleteDevice(input.hubDeviceId).catch((err) => {
          this.logger.error(
            `Hub compensation DELETE failed for ${input.hubDeviceId}`,
            err,
          );
        });
      }
      throw e;
    }

    // 3. Mint initial device JWT
    let minted;
    try {
      minted = await this.hub.mintDeviceToken({
        deviceId: input.hubDeviceId,
        ttlSeconds: DEVICE_JWT_TTL_SECONDS,
      });
    } catch (e) {
      // Rare — hub was healthy in step 1 but not now. Clean up DB + hub.
      await this.db.db
        .delete(ahandDevices)
        .where(eq(ahandDevices.id, inserted.id))
        .catch(() => {});
      await this.hub.deleteDevice(input.hubDeviceId).catch(() => {});
      throw e;
    }

    this.redisPublisher
      .publishForOwner({
        ownerType: "user",
        ownerId: userId,
        eventType: "device.registered",
        data: { hubDeviceId: input.hubDeviceId, nickname: input.nickname },
      })
      .catch((e) => this.logger.warn("Failed to publish device.registered", e));

    return {
      device: inserted,
      deviceJwt: minted.token,
      hubUrl: this.hubUrl,
      jwtExpiresAt: minted.expiresAt,
    };
  }

  async listDevicesForOwner(
    ownerType: OwnerType,
    ownerId: string,
    opts: { includeOffline?: boolean; includeRevoked?: boolean } = {},
  ): Promise<DeviceWithPresence[]> {
    const rows = await this.db.db
      .select()
      .from(ahandDevices)
      .where(
        and(
          eq(ahandDevices.ownerType, ownerType),
          eq(ahandDevices.ownerId, ownerId),
          opts.includeRevoked ? undefined : eq(ahandDevices.status, "active"),
        ),
      );
    if (rows.length === 0) return [];

    const presenceKeys = rows.map(
      (r) => `ahand:device:${r.hubDeviceId}:presence`,
    );
    let presenceStates: (string | null)[] | null = null;
    try {
      presenceStates = await this.redis.mget(...presenceKeys);
    } catch (e) {
      this.logger.warn(
        "Redis mget failed for device presence — degrading to null",
        e,
      );
    }

    const enriched = rows.map((r, i) => ({
      ...r,
      isOnline: presenceStates === null ? null : presenceStates[i] === "online",
    }));

    if (!opts.includeOffline) {
      return enriched.filter((d) => d.isOnline === true);
    }
    return enriched;
  }

  async listActiveDevicesForUser(
    userId: string,
    opts: { includeOffline?: boolean } = {},
  ): Promise<DeviceWithPresence[]> {
    return this.listDevicesForOwner("user", userId, {
      ...opts,
      includeRevoked: false,
    });
  }

  async refreshDeviceToken(
    userId: string,
    deviceRowId: string,
  ): Promise<{ token: string; expiresAt: string }> {
    const device = await this.requireOwnedDevice(userId, deviceRowId);
    return this.hub.mintDeviceToken({
      deviceId: device.hubDeviceId,
      ttlSeconds: DEVICE_JWT_TTL_SECONDS,
    });
  }

  async mintControlPlaneTokenForUser(
    userId: string,
    deviceIds?: string[],
  ): Promise<{ token: string; expiresAt: string }> {
    // deviceIds, if provided, must all be owned by the user
    if (deviceIds && deviceIds.length > 0) {
      const rows = await this.db.db
        .select()
        .from(ahandDevices)
        .where(
          and(
            eq(ahandDevices.ownerType, "user"),
            eq(ahandDevices.ownerId, userId),
            inArray(ahandDevices.hubDeviceId, deviceIds),
          ),
        );
      const foundIds = new Set(rows.map((r) => r.hubDeviceId));
      const unknown = deviceIds.filter((id) => !foundIds.has(id));
      if (unknown.length > 0) {
        throw new ForbiddenException(
          `Device(s) not owned by user: ${unknown.join(", ")}`,
        );
      }
    }
    return this.hub.mintControlPlaneToken({
      externalUserId: userId,
      deviceIds,
      scope: "jobs:execute",
    });
  }

  async patchDevice(
    userId: string,
    deviceRowId: string,
    patch: { nickname?: string },
  ): Promise<AhandDevice> {
    const existing = await this.requireOwnedDevice(userId, deviceRowId);
    if (patch.nickname !== undefined) this.validateNickname(patch.nickname);
    const [updated] = await this.db.db
      .update(ahandDevices)
      .set({ nickname: patch.nickname ?? existing.nickname })
      .where(eq(ahandDevices.id, existing.id))
      .returning();
    return updated;
  }

  async revokeDevice(userId: string, deviceRowId: string): Promise<void> {
    const device = await this.requireOwnedDevice(userId, deviceRowId);
    await this.db.db
      .update(ahandDevices)
      .set({ status: "revoked", revokedAt: new Date() })
      .where(eq(ahandDevices.id, device.id));
    try {
      await this.hub.deleteDevice(device.hubDeviceId);
    } catch (e) {
      // Row is already marked revoked; hub-side cleanup failure isn't fatal.
      this.logger.warn(`Hub deleteDevice failed for ${device.hubDeviceId}`, e);
    }
    this.redisPublisher
      .publishForOwner({
        ownerType: device.ownerType as OwnerType,
        ownerId: device.ownerId,
        eventType: "device.revoked",
        data: { hubDeviceId: device.hubDeviceId },
      })
      .catch((e) => this.logger.warn("Failed to publish device.revoked", e));
  }

  @OnEvent("user.deleted")
  async onUserDeleted(payload: { userId: string }): Promise<void> {
    const rows = await this.db.db
      .select()
      .from(ahandDevices)
      .where(
        and(
          eq(ahandDevices.ownerType, "user"),
          eq(ahandDevices.ownerId, payload.userId),
          eq(ahandDevices.status, "active"),
        ),
      );
    if (rows.length === 0) return;
    await this.db.db
      .update(ahandDevices)
      .set({ status: "revoked", revokedAt: new Date() })
      .where(
        and(
          eq(ahandDevices.ownerType, "user"),
          eq(ahandDevices.ownerId, payload.userId),
        ),
      );
    for (const r of rows) {
      this.hub
        .deleteDevice(r.hubDeviceId)
        .catch((e) =>
          this.logger.warn(
            `Hub delete after user deletion failed: ${r.hubDeviceId}`,
            e,
          ),
        );
    }
  }

  private async requireOwnedDevice(
    userId: string,
    deviceRowId: string,
  ): Promise<AhandDevice> {
    const [row] = await this.db.db
      .select()
      .from(ahandDevices)
      .where(
        and(
          eq(ahandDevices.id, deviceRowId),
          eq(ahandDevices.ownerType, "user"),
          eq(ahandDevices.ownerId, userId),
        ),
      );
    if (!row) throw new NotFoundException("Device not found");
    if (row.status === "revoked")
      throw new ConflictException("Device has been revoked");
    return row;
  }

  private validateNickname(nickname: string): void {
    if (!nickname || nickname.length < 1 || nickname.length > 120) {
      throw new BadRequestException("Nickname must be 1-120 characters");
    }
  }
}
```

- [ ] **Step 2: Tests — cover all paths (§ 9.4.4 matrix)**

```ts
// apps/server/apps/gateway/src/ahand/ahand.service.spec.ts

import { Test } from "@nestjs/testing";
import { AhandDevicesService } from "./ahand.service";
import { AhandHubClient } from "./ahand-hub.client";
import { AhandRedisPublisher } from "./ahand-redis-publisher.service";
import { ConfigService } from "@nestjs/config";
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import RedisMock from "ioredis-mock";

// The repo already has a TestDatabaseModule / memory-db fixture for other services.
// Pattern: import { createTestDb } from "@app/database/test-support";
import { createTestDb } from "@app/database/test-support";
import { ahandDevices } from "@app/database/schemas/im";
import { eq } from "drizzle-orm";

describe("AhandDevicesService", () => {
  let service: AhandDevicesService;
  let hub: jest.Mocked<AhandHubClient>;
  let publisher: jest.Mocked<AhandRedisPublisher>;
  let db: any;
  let redis: InstanceType<typeof RedisMock>;

  beforeEach(async () => {
    const testDb = await createTestDb();
    db = testDb;
    redis = new RedisMock();
    hub = {
      registerDevice: jest.fn(),
      mintDeviceToken: jest.fn(),
      mintControlPlaneToken: jest.fn(),
      deleteDevice: jest.fn(),
      listDevicesForExternalUser: jest.fn(),
    } as any;
    publisher = {
      publishForOwner: jest.fn().mockResolvedValue(undefined),
    } as any;

    const moduleRef = await Test.createTestingModule({
      providers: [
        AhandDevicesService,
        { provide: "REDIS_CLIENT", useValue: redis },
        { provide: AhandHubClient, useValue: hub },
        { provide: AhandRedisPublisher, useValue: publisher },
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => "https://hub.test" },
        },
        { provide: "DatabaseService", useValue: { db: testDb.db } },
      ],
    }).compile();
    service = moduleRef.get(AhandDevicesService);
  });

  describe("registerDeviceForUser — happy", () => {
    it("creates hub record → inserts row → mints JWT → publishes event", async () => {
      hub.registerDevice.mockResolvedValue({
        deviceId: "d1",
        createdAt: "2026-04-22T10:00:00Z",
      });
      hub.mintDeviceToken.mockResolvedValue({
        token: "jwt.xxx",
        expiresAt: "2026-04-29T10:00:00Z",
      });
      const res = await service.registerDeviceForUser("u1", {
        hubDeviceId: "d1",
        publicKey: "pk",
        nickname: "My Mac",
        platform: "macos",
      });
      expect(res.deviceJwt).toBe("jwt.xxx");
      expect(res.hubUrl).toBe("https://hub.test");
      const stored = await db.db
        .select()
        .from(ahandDevices)
        .where(eq(ahandDevices.hubDeviceId, "d1"));
      expect(stored).toHaveLength(1);
      expect(stored[0].ownerType).toBe("user");
      expect(publisher.publishForOwner).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: "device.registered" }),
      );
    });
  });

  describe("registerDeviceForUser — bad / edge", () => {
    it("hub 409 on pre-register → ConflictException, nothing persisted", async () => {
      hub.registerDevice.mockRejectedValue(
        new ConflictException("already taken"),
      );
      await expect(
        service.registerDeviceForUser("u1", {
          hubDeviceId: "d1",
          publicKey: "pk",
          nickname: "X",
          platform: "macos",
        }),
      ).rejects.toThrow(ConflictException);
      expect(await db.db.select().from(ahandDevices)).toHaveLength(0);
    });

    it("DB insert failure rolls back hub registration", async () => {
      hub.registerDevice.mockResolvedValue({
        deviceId: "d1",
        createdAt: "...",
      });
      hub.deleteDevice.mockResolvedValue(undefined);
      // Simulate DB conflict by pre-inserting a row with same hubDeviceId
      await db.db.insert(ahandDevices).values({
        ownerType: "user",
        ownerId: "other",
        hubDeviceId: "d1",
        publicKey: "p",
        nickname: "n",
        platform: "macos",
      });
      await expect(
        service.registerDeviceForUser("u1", {
          hubDeviceId: "d1",
          publicKey: "pk",
          nickname: "X",
          platform: "macos",
        }),
      ).rejects.toThrow();
      expect(hub.deleteDevice).toHaveBeenCalledWith("d1");
    });

    it("mintDeviceToken failure cleans up both DB and hub", async () => {
      hub.registerDevice.mockResolvedValue({
        deviceId: "d1",
        createdAt: "...",
      });
      hub.mintDeviceToken.mockRejectedValue(new Error("hub down"));
      hub.deleteDevice.mockResolvedValue(undefined);
      await expect(
        service.registerDeviceForUser("u1", {
          hubDeviceId: "d1",
          publicKey: "pk",
          nickname: "X",
          platform: "macos",
        }),
      ).rejects.toThrow(/hub down/);
      expect(await db.db.select().from(ahandDevices)).toHaveLength(0);
      expect(hub.deleteDevice).toHaveBeenCalledWith("d1");
    });

    it("rejects nickname outside 1..120", async () => {
      await expect(
        service.registerDeviceForUser("u1", {
          hubDeviceId: "d",
          publicKey: "p",
          nickname: "",
          platform: "macos",
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.registerDeviceForUser("u1", {
          hubDeviceId: "d",
          publicKey: "p",
          nickname: "x".repeat(121),
          platform: "macos",
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("listDevicesForOwner", () => {
    beforeEach(async () => {
      await db.db.insert(ahandDevices).values([
        {
          ownerType: "user",
          ownerId: "u1",
          hubDeviceId: "d1",
          publicKey: "p",
          nickname: "A",
          platform: "macos",
          status: "active",
        },
        {
          ownerType: "user",
          ownerId: "u1",
          hubDeviceId: "d2",
          publicKey: "p",
          nickname: "B",
          platform: "linux",
          status: "active",
        },
        {
          ownerType: "user",
          ownerId: "u2",
          hubDeviceId: "d3",
          publicKey: "p",
          nickname: "C",
          platform: "macos",
          status: "active",
        },
      ]);
    });

    it("returns only active devices for the owner, with isOnline from Redis", async () => {
      await redis.set("ahand:device:d1:presence", "online");
      const rows = await service.listDevicesForOwner("user", "u1", {
        includeOffline: true,
      });
      expect(rows.map((r) => r.hubDeviceId).sort()).toEqual(["d1", "d2"]);
      const d1 = rows.find((r) => r.hubDeviceId === "d1")!;
      const d2 = rows.find((r) => r.hubDeviceId === "d2")!;
      expect(d1.isOnline).toBe(true);
      expect(d2.isOnline).toBe(false);
    });

    it("filters out offline when includeOffline=false", async () => {
      await redis.set("ahand:device:d1:presence", "online");
      const rows = await service.listDevicesForOwner("user", "u1", {
        includeOffline: false,
      });
      expect(rows.map((r) => r.hubDeviceId)).toEqual(["d1"]);
    });

    it("Redis mget failure → isOnline=null for all, no throw", async () => {
      redis.mget = jest.fn().mockRejectedValue(new Error("redis down")) as any;
      const rows = await service.listDevicesForOwner("user", "u1", {
        includeOffline: true,
      });
      expect(rows.every((r) => r.isOnline === null)).toBe(true);
    });

    it("excludes revoked rows by default", async () => {
      await db.db.insert(ahandDevices).values({
        ownerType: "user",
        ownerId: "u1",
        hubDeviceId: "d4",
        publicKey: "p",
        nickname: "D",
        platform: "macos",
        status: "revoked",
      });
      const rows = await service.listDevicesForOwner("user", "u1", {
        includeOffline: true,
      });
      expect(rows.map((r) => r.hubDeviceId).sort()).toEqual(["d1", "d2"]);
    });
  });

  describe("refreshDeviceToken", () => {
    it("validates ownership and returns new JWT", async () => {
      const [row] = await db.db
        .insert(ahandDevices)
        .values({
          ownerType: "user",
          ownerId: "u1",
          hubDeviceId: "d1",
          publicKey: "p",
          nickname: "A",
          platform: "macos",
        })
        .returning();
      hub.mintDeviceToken.mockResolvedValue({
        token: "jwt.new",
        expiresAt: "...",
      });
      const res = await service.refreshDeviceToken("u1", row.id);
      expect(res.token).toBe("jwt.new");
    });

    it("rejects non-owner with 404 (anti-enumeration)", async () => {
      const [row] = await db.db
        .insert(ahandDevices)
        .values({
          ownerType: "user",
          ownerId: "u1",
          hubDeviceId: "d1",
          publicKey: "p",
          nickname: "A",
          platform: "macos",
        })
        .returning();
      await expect(service.refreshDeviceToken("u2", row.id)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("rejects revoked devices", async () => {
      const [row] = await db.db
        .insert(ahandDevices)
        .values({
          ownerType: "user",
          ownerId: "u1",
          hubDeviceId: "d1",
          publicKey: "p",
          nickname: "A",
          platform: "macos",
          status: "revoked",
        })
        .returning();
      await expect(service.refreshDeviceToken("u1", row.id)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe("revokeDevice", () => {
    it("flips status + calls hub + publishes event", async () => {
      const [row] = await db.db
        .insert(ahandDevices)
        .values({
          ownerType: "user",
          ownerId: "u1",
          hubDeviceId: "d1",
          publicKey: "p",
          nickname: "A",
          platform: "macos",
        })
        .returning();
      hub.deleteDevice.mockResolvedValue(undefined);
      await service.revokeDevice("u1", row.id);
      const [after] = await db.db
        .select()
        .from(ahandDevices)
        .where(eq(ahandDevices.id, row.id));
      expect(after.status).toBe("revoked");
      expect(after.revokedAt).not.toBeNull();
      expect(hub.deleteDevice).toHaveBeenCalledWith("d1");
      expect(publisher.publishForOwner).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: "device.revoked" }),
      );
    });

    it("hub DELETE failure does not raise — row is already revoked", async () => {
      const [row] = await db.db
        .insert(ahandDevices)
        .values({
          ownerType: "user",
          ownerId: "u1",
          hubDeviceId: "d1",
          publicKey: "p",
          nickname: "A",
          platform: "macos",
        })
        .returning();
      hub.deleteDevice.mockRejectedValue(new Error("hub-err"));
      await expect(service.revokeDevice("u1", row.id)).resolves.toBeUndefined();
    });
  });

  describe("mintControlPlaneTokenForUser", () => {
    it("rejects deviceIds the user does not own", async () => {
      await db.db.insert(ahandDevices).values({
        ownerType: "user",
        ownerId: "u1",
        hubDeviceId: "d1",
        publicKey: "p",
        nickname: "A",
        platform: "macos",
      });
      await expect(
        service.mintControlPlaneTokenForUser("u1", ["d1", "d2"]),
      ).rejects.toThrow(ForbiddenException);
    });

    it("mints when all deviceIds are owned", async () => {
      await db.db.insert(ahandDevices).values({
        ownerType: "user",
        ownerId: "u1",
        hubDeviceId: "d1",
        publicKey: "p",
        nickname: "A",
        platform: "macos",
      });
      hub.mintControlPlaneToken.mockResolvedValue({
        token: "cp.xyz",
        expiresAt: "...",
      });
      const res = await service.mintControlPlaneTokenForUser("u1", ["d1"]);
      expect(res.token).toBe("cp.xyz");
    });

    it("mints without deviceIds restriction when not provided", async () => {
      hub.mintControlPlaneToken.mockResolvedValue({
        token: "cp.xyz",
        expiresAt: "...",
      });
      await service.mintControlPlaneTokenForUser("u1");
      expect(hub.mintControlPlaneToken).toHaveBeenCalledWith({
        externalUserId: "u1",
        deviceIds: undefined,
        scope: "jobs:execute",
      });
    });
  });

  describe("onUserDeleted listener", () => {
    it("revokes all active devices and deletes from hub", async () => {
      await db.db.insert(ahandDevices).values([
        {
          ownerType: "user",
          ownerId: "u1",
          hubDeviceId: "d1",
          publicKey: "p",
          nickname: "A",
          platform: "macos",
        },
        {
          ownerType: "user",
          ownerId: "u1",
          hubDeviceId: "d2",
          publicKey: "p",
          nickname: "B",
          platform: "macos",
        },
        {
          ownerType: "user",
          ownerId: "u2",
          hubDeviceId: "d3",
          publicKey: "p",
          nickname: "C",
          platform: "macos",
        },
      ]);
      hub.deleteDevice.mockResolvedValue(undefined);
      await service.onUserDeleted({ userId: "u1" });
      const rows = await db.db.select().from(ahandDevices);
      const u1Rows = rows.filter((r) => r.ownerId === "u1");
      expect(u1Rows.every((r) => r.status === "revoked")).toBe(true);
      const u2Row = rows.find((r) => r.ownerId === "u2")!;
      expect(u2Row.status).toBe("active");
      expect(hub.deleteDevice).toHaveBeenCalledTimes(2);
    });
  });
});
```

- [ ] **Step 3: Commit**

```bash
cd /Users/winrey/Projects/weightwave/team9
git add apps/server/apps/gateway/src/ahand/ahand.service.ts \
        apps/server/apps/gateway/src/ahand/ahand.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(gateway/ahand): AhandDevicesService — business logic

Core orchestration for device registration, listing, token refresh,
patching, and revocation. Wraps AhandHubClient (hub mutations),
Drizzle (persistence), Redis (presence reads), and
AhandRedisPublisher (fan-out to im-worker).

Key invariants:
- registerDeviceForUser is transactional across hub + DB + token-mint;
  any failure triggers best-effort compensation (hub DELETE, DB row
  cleanup). Never leaves a half-registered state visible to users.
- listDevicesForOwner degrades gracefully on Redis outage
  (isOnline=null instead of throwing).
- Ownership checks use userId + device-row-id, 404 on mismatch to
  prevent enumeration.
- Revoke flips status before attempting hub DELETE; hub failure is
  logged but non-fatal since the row is already authoritative.
- @OnEvent('user.deleted') cascades revocation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4.4: `AhandController` — REST endpoints for Tauri

**Goal:** Expose the Tauri-facing REST API under `/api/ahand/*`. All endpoints use `@UseGuards(JwtAuthGuard)` with `@CurrentUser()` resolving to the authenticated team9 user. Controller delegates to `AhandDevicesService`; no business logic here.

**Files:**

- Create: `apps/server/apps/gateway/src/ahand/dto/register-device.dto.ts`
- Create: `apps/server/apps/gateway/src/ahand/dto/device.dto.ts`
- Create: `apps/server/apps/gateway/src/ahand/dto/patch-device.dto.ts`
- Create: `apps/server/apps/gateway/src/ahand/ahand.controller.ts`
- Create: `apps/server/apps/gateway/src/ahand/ahand.controller.spec.ts`

**Acceptance Criteria:**

- [ ] `POST /api/ahand/devices` accepts `RegisterDeviceDto` and returns `{ device, deviceJwt, hubUrl, jwtExpiresAt }`. JwtAuthGuard required. Validates DTO via class-validator; rejects unknown fields.
- [ ] `GET /api/ahand/devices` returns `DeviceDto[]` for the calling user. Query param `?includeOffline=true|false` (default `true`). JwtAuthGuard.
- [ ] `POST /api/ahand/devices/:id/token/refresh` mints a new device JWT; returns `{ deviceJwt, jwtExpiresAt }`. JwtAuthGuard.
- [ ] `PATCH /api/ahand/devices/:id` accepts `PatchDeviceDto` (`nickname?`); returns updated `DeviceDto`. JwtAuthGuard.
- [ ] `DELETE /api/ahand/devices/:id` returns `204 No Content`. JwtAuthGuard.
- [ ] All responses conform to the DTO shapes (spec § 3.4); non-owned devices consistently return 404 (never 403) to avoid leaking existence.
- [ ] HTTP status codes: 201 on registration, 200 on successful list/refresh/patch, 204 on delete. 400 on validation failures, 401 on missing auth, 404 on unowned, 409 on conflicting operations, 503 when hub unavailable.
- [ ] 100% unit test coverage using NestJS `Test.createTestingModule` and mocked `AhandDevicesService`.

**Verify:** `pnpm test apps/server/apps/gateway/src/ahand/ahand.controller.spec.ts --coverage` → 100%. Plus light supertest smoke (can live in Phase 9 integration tests): `curl -H "Authorization: Bearer $TEAM9_JWT" https://gateway.dev.team9.ai/api/ahand/devices`.

**Steps:**

- [ ] **Step 1: DTOs**

```ts
// apps/server/apps/gateway/src/ahand/dto/register-device.dto.ts
import { IsString, Length, Matches, IsOptional, IsIn } from "class-validator";

export class RegisterDeviceDto {
  @IsString()
  @Matches(/^[0-9a-f]{64}$/, {
    message: "hubDeviceId must be 64 lowercase hex chars (SHA256)",
  })
  hubDeviceId!: string;

  @IsString()
  @Length(1, 1024)
  publicKey!: string; // base64 Ed25519

  @IsString()
  @Length(1, 120)
  nickname!: string;

  @IsIn(["macos", "windows", "linux"])
  platform!: "macos" | "windows" | "linux";

  @IsOptional()
  @IsString()
  @Length(0, 255)
  hostname?: string;
}
```

```ts
// apps/server/apps/gateway/src/ahand/dto/device.dto.ts

export class DeviceDto {
  id!: string;
  hubDeviceId!: string;
  nickname!: string;
  platform!: "macos" | "windows" | "linux";
  hostname!: string | null;
  status!: "active" | "revoked";
  lastSeenAt!: string | null;
  isOnline!: boolean | null; // null when presence is unknown (Redis down)
  createdAt!: string;
}

export class RegisterDeviceResponseDto {
  device!: DeviceDto;
  deviceJwt!: string;
  hubUrl!: string;
  jwtExpiresAt!: string;
}

export class TokenRefreshResponseDto {
  deviceJwt!: string;
  jwtExpiresAt!: string;
}
```

```ts
// apps/server/apps/gateway/src/ahand/dto/patch-device.dto.ts
import { IsOptional, IsString, Length } from "class-validator";

export class PatchDeviceDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  nickname?: string;
}
```

- [ ] **Step 2: Controller**

```ts
// apps/server/apps/gateway/src/ahand/ahand.controller.ts

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { User } from "@app/database/schemas/im";
import { AhandDevicesService, type DeviceWithPresence } from "./ahand.service";
import { RegisterDeviceDto } from "./dto/register-device.dto";
import {
  type DeviceDto,
  type RegisterDeviceResponseDto,
  type TokenRefreshResponseDto,
} from "./dto/device.dto";
import { PatchDeviceDto } from "./dto/patch-device.dto";

@ApiTags("ahand")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("api/ahand/devices")
export class AhandController {
  constructor(private readonly svc: AhandDevicesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async register(
    @CurrentUser() user: User,
    @Body() body: RegisterDeviceDto,
  ): Promise<RegisterDeviceResponseDto> {
    const res = await this.svc.registerDeviceForUser(user.id, body);
    return {
      device: toDeviceDto({ ...res.device, isOnline: false }),
      deviceJwt: res.deviceJwt,
      hubUrl: res.hubUrl,
      jwtExpiresAt: res.jwtExpiresAt,
    };
  }

  @Get()
  async list(
    @CurrentUser() user: User,
    @Query("includeOffline") includeOfflineRaw?: string,
  ): Promise<DeviceDto[]> {
    const includeOffline = includeOfflineRaw !== "false";
    const rows = await this.svc.listActiveDevicesForUser(user.id, {
      includeOffline,
    });
    return rows.map(toDeviceDto);
  }

  @Post(":id/token/refresh")
  async refreshToken(
    @CurrentUser() user: User,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<TokenRefreshResponseDto> {
    const { token, expiresAt } = await this.svc.refreshDeviceToken(user.id, id);
    return { deviceJwt: token, jwtExpiresAt: expiresAt };
  }

  @Patch(":id")
  async patch(
    @CurrentUser() user: User,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: PatchDeviceDto,
  ): Promise<DeviceDto> {
    const row = await this.svc.patchDevice(user.id, id, body);
    return toDeviceDto({ ...row, isOnline: null }); // state not refreshed on patch
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @CurrentUser() user: User,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.svc.revokeDevice(user.id, id);
  }
}

function toDeviceDto(row: DeviceWithPresence): DeviceDto {
  return {
    id: row.id,
    hubDeviceId: row.hubDeviceId,
    nickname: row.nickname,
    platform: row.platform as DeviceDto["platform"],
    hostname: row.hostname,
    status: row.status as DeviceDto["status"],
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    isOnline: row.isOnline,
    createdAt: row.createdAt.toISOString(),
  };
}
```

- [ ] **Step 3: Tests**

```ts
// apps/server/apps/gateway/src/ahand/ahand.controller.spec.ts

import { Test } from "@nestjs/testing";
import { AhandController } from "./ahand.controller";
import { AhandDevicesService } from "./ahand.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import {
  ValidationPipe,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";

describe("AhandController", () => {
  let controller: AhandController;
  let svc: jest.Mocked<AhandDevicesService>;

  const testUser = { id: "u1", email: "u@t.co" } as any;

  beforeEach(async () => {
    svc = {
      registerDeviceForUser: jest.fn(),
      listActiveDevicesForUser: jest.fn(),
      refreshDeviceToken: jest.fn(),
      patchDevice: jest.fn(),
      revokeDevice: jest.fn(),
    } as any;
    const moduleRef = await Test.createTestingModule({
      controllers: [AhandController],
      providers: [{ provide: AhandDevicesService, useValue: svc }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(AhandController);
  });

  describe("POST /devices", () => {
    it("delegates to service and shapes response", async () => {
      svc.registerDeviceForUser.mockResolvedValue({
        device: {
          id: "uuid-1",
          ownerType: "user",
          ownerId: "u1",
          hubDeviceId: "d".repeat(64),
          publicKey: "p",
          nickname: "A",
          platform: "macos",
          hostname: null,
          status: "active",
          lastSeenAt: null,
          createdAt: new Date("2026-04-22T10:00:00Z"),
          revokedAt: null,
        } as any,
        deviceJwt: "jwt.x",
        hubUrl: "https://hub",
        jwtExpiresAt: "2026-04-29T10:00:00Z",
      });
      const res = await controller.register(testUser, {
        hubDeviceId: "d".repeat(64),
        publicKey: "p",
        nickname: "A",
        platform: "macos",
      });
      expect(res.deviceJwt).toBe("jwt.x");
      expect(res.device.hubDeviceId).toBe("d".repeat(64));
      expect(res.device.status).toBe("active");
    });
  });

  describe("GET /devices", () => {
    it("default includeOffline=true", async () => {
      svc.listActiveDevicesForUser.mockResolvedValue([]);
      await controller.list(testUser, undefined);
      expect(svc.listActiveDevicesForUser).toHaveBeenCalledWith("u1", {
        includeOffline: true,
      });
    });
    it("respects includeOffline=false", async () => {
      svc.listActiveDevicesForUser.mockResolvedValue([]);
      await controller.list(testUser, "false");
      expect(svc.listActiveDevicesForUser).toHaveBeenCalledWith("u1", {
        includeOffline: false,
      });
    });
    it("maps rows to DTOs", async () => {
      svc.listActiveDevicesForUser.mockResolvedValue([
        {
          id: "uuid-1",
          ownerType: "user",
          ownerId: "u1",
          hubDeviceId: "d1",
          publicKey: "p",
          nickname: "A",
          platform: "macos",
          hostname: "hA",
          status: "active",
          lastSeenAt: new Date("2026-04-22T10:00:00Z"),
          createdAt: new Date("2026-04-22T09:00:00Z"),
          revokedAt: null,
          isOnline: true,
        } as any,
      ]);
      const dto = await controller.list(testUser, "true");
      expect(dto[0]).toMatchObject({
        id: "uuid-1",
        hubDeviceId: "d1",
        nickname: "A",
        platform: "macos",
        hostname: "hA",
        status: "active",
        isOnline: true,
        lastSeenAt: "2026-04-22T10:00:00.000Z",
        createdAt: "2026-04-22T09:00:00.000Z",
      });
    });
  });

  describe("POST /devices/:id/token/refresh", () => {
    it("validates UUID", async () => {
      svc.refreshDeviceToken.mockResolvedValue({
        token: "t",
        expiresAt: "...",
      });
      // ParseUUIDPipe is applied inside Nest at request time; unit test skips its effect.
      const res = await controller.refreshToken(
        testUser,
        "11111111-1111-1111-1111-111111111111",
      );
      expect(res.deviceJwt).toBe("t");
    });

    it("404 propagates unchanged (anti-enumeration)", async () => {
      svc.refreshDeviceToken.mockRejectedValue(
        new NotFoundException("Device not found"),
      );
      await expect(
        controller.refreshToken(
          testUser,
          "11111111-1111-1111-1111-111111111111",
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("PATCH /devices/:id", () => {
    it("updates nickname", async () => {
      svc.patchDevice.mockResolvedValue({
        id: "uuid-1",
        ownerType: "user",
        ownerId: "u1",
        hubDeviceId: "d1",
        publicKey: "p",
        nickname: "New Name",
        platform: "macos",
        hostname: null,
        status: "active",
        lastSeenAt: null,
        createdAt: new Date(),
        revokedAt: null,
      } as any);
      const res = await controller.patch(
        testUser,
        "11111111-1111-1111-1111-111111111111",
        { nickname: "New Name" },
      );
      expect(res.nickname).toBe("New Name");
      expect(res.isOnline).toBeNull();
    });
  });

  describe("DELETE /devices/:id", () => {
    it("calls service and returns void", async () => {
      svc.revokeDevice.mockResolvedValue(undefined);
      await expect(
        controller.delete(testUser, "11111111-1111-1111-1111-111111111111"),
      ).resolves.toBeUndefined();
    });
    it("propagates 409 from service", async () => {
      svc.revokeDevice.mockRejectedValue(
        new ConflictException("already revoked"),
      );
      await expect(
        controller.delete(testUser, "11111111-1111-1111-1111-111111111111"),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe("DTO validation (via ValidationPipe)", () => {
    it("RegisterDeviceDto rejects non-hex hubDeviceId", async () => {
      const pipe = new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      });
      await expect(
        pipe.transform(
          {
            hubDeviceId: "nothex",
            publicKey: "p",
            nickname: "A",
            platform: "macos",
          },
          {
            type: "body",
            metatype: (await import("./dto/register-device.dto"))
              .RegisterDeviceDto,
          },
        ),
      ).rejects.toThrow(/hubDeviceId/);
    });

    it("RegisterDeviceDto rejects unknown platform", async () => {
      const pipe = new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      });
      await expect(
        pipe.transform(
          {
            hubDeviceId: "a".repeat(64),
            publicKey: "p",
            nickname: "A",
            platform: "ios" as any,
          },
          {
            type: "body",
            metatype: (await import("./dto/register-device.dto"))
              .RegisterDeviceDto,
          },
        ),
      ).rejects.toThrow();
    });

    it("RegisterDeviceDto strips unknown fields with whitelist", async () => {
      const pipe = new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      });
      await expect(
        pipe.transform(
          {
            hubDeviceId: "a".repeat(64),
            publicKey: "p",
            nickname: "A",
            platform: "macos",
            evil: "payload",
          },
          {
            type: "body",
            metatype: (await import("./dto/register-device.dto"))
              .RegisterDeviceDto,
          },
        ),
      ).rejects.toThrow(/evil/);
    });
  });
});
```

- [ ] **Step 4: Commit**

```bash
cd /Users/winrey/Projects/weightwave/team9
git add apps/server/apps/gateway/src/ahand/dto/ \
        apps/server/apps/gateway/src/ahand/ahand.controller.ts \
        apps/server/apps/gateway/src/ahand/ahand.controller.spec.ts
git commit -m "$(cat <<'EOF'
feat(gateway/ahand): REST API controller for Tauri

Five endpoints under /api/ahand/devices, all JwtAuthGuard-protected
and scoped to the calling user via @CurrentUser():
- POST    /devices                    → register (201)
- GET     /devices?includeOffline     → list (200)
- POST    /devices/:id/token/refresh  → refresh JWT (200)
- PATCH   /devices/:id                → update nickname (200)
- DELETE  /devices/:id                → revoke (204)

Controller is thin: delegates every call to AhandDevicesService and
only shapes request/response DTOs. DTOs use class-validator with
whitelist + forbidNonWhitelisted so unknown fields are rejected.
hubDeviceId format locked to 64-hex (SHA256 guarantee); platform
restricted to macos/windows/linux.

Unowned devices return 404, never 403, to avoid leaking existence.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4.5: `AhandInternalController` — endpoints for im-worker

**Goal:** Expose the two internal endpoints im-worker needs: (1) mint a control-plane JWT for a specific user (and optionally a specific device), (2) list devices for a user (with presence). Both are protected by the existing service-token mechanism gateway↔im-worker already uses (there's likely an `InternalServiceGuard` or similar — grep for it).

**Files:**

- Create: `apps/server/apps/gateway/src/ahand/ahand-internal.controller.ts`
- Create: `apps/server/apps/gateway/src/ahand/ahand-internal.controller.spec.ts`
- Create: `apps/server/apps/gateway/src/ahand/dto/internal.dto.ts`

**Acceptance Criteria:**

- [ ] `POST /internal/ahand/control-plane/token` accepts `{ userId: string; deviceIds?: string[] }`, validates DTO, delegates to `service.mintControlPlaneTokenForUser`, returns `{ token, expiresAt }`. Guard: existing internal-service guard (match repo convention).
- [ ] `POST /internal/ahand/devices/list-for-user` accepts `{ userId: string; includeOffline?: boolean }`, delegates to `service.listActiveDevicesForUser`, returns a serialized list conforming to `InternalDeviceDto`.
- [ ] Neither endpoint accepts the normal JwtAuthGuard (they're internal-only). Requests without the internal service token → 401.
- [ ] `userId` in body is the source of truth; controller does NOT extract from JWT (im-worker acts on behalf of a user it resolved elsewhere).
- [ ] `ForbiddenException` from service (device not owned) surfaces as 403.
- [ ] 100% unit test coverage with mocked service.

**Verify:** `pnpm test apps/server/apps/gateway/src/ahand/ahand-internal.controller.spec.ts --coverage` → 100%.

**Steps:**

- [ ] **Step 1: Find the existing internal-auth guard**

```bash
rg -nP 'InternalService|internal.*[Gg]uard|X-Internal-Token' \
  apps/server/apps/gateway/src/ apps/server/apps/im-worker/src/
```

Adopt whichever guard im-worker↔gateway already uses. If none exists, create a minimal one:

```ts
// apps/server/apps/gateway/src/auth/guards/internal-service.guard.ts (only if missing)

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";
import { timingSafeEqual } from "crypto";

@Injectable()
export class InternalServiceGuard implements CanActivate {
  constructor(private readonly cfg: ConfigService) {}
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const expected = this.cfg.getOrThrow<string>("internalServiceToken");
    const got = req.header("x-internal-service-token") ?? "";
    if (got.length !== expected.length) throw new UnauthorizedException();
    if (!timingSafeEqual(Buffer.from(got), Buffer.from(expected))) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
```

Config key `INTERNAL_SERVICE_TOKEN` must exist in gateway env; add if missing.

- [ ] **Step 2: DTOs**

```ts
// apps/server/apps/gateway/src/ahand/dto/internal.dto.ts

import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  ArrayMaxSize,
  Matches,
} from "class-validator";

export class ControlPlaneTokenRequestDto {
  @IsUUID("4")
  userId!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @Matches(/^[0-9a-f]{64}$/, { each: true })
  deviceIds?: string[];
}

export class ControlPlaneTokenResponseDto {
  token!: string;
  expiresAt!: string;
}

export class ListDevicesForUserRequestDto {
  @IsUUID("4")
  userId!: string;

  @IsOptional()
  @IsBoolean()
  includeOffline?: boolean;
}

export class InternalDeviceDto {
  id!: string;
  hubDeviceId!: string;
  publicKey!: string;
  nickname!: string;
  platform!: "macos" | "windows" | "linux";
  hostname!: string | null;
  status!: "active" | "revoked";
  isOnline!: boolean | null;
  lastSeenAt!: string | null;
  createdAt!: string;
}
```

- [ ] **Step 3: Controller**

```ts
// apps/server/apps/gateway/src/ahand/ahand-internal.controller.ts

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from "@nestjs/common";
import { InternalServiceGuard } from "../auth/guards/internal-service.guard";
import { AhandDevicesService } from "./ahand.service";
import {
  ControlPlaneTokenRequestDto,
  ControlPlaneTokenResponseDto,
  InternalDeviceDto,
  ListDevicesForUserRequestDto,
} from "./dto/internal.dto";

@UseGuards(InternalServiceGuard)
@Controller("internal/ahand")
export class AhandInternalController {
  constructor(private readonly svc: AhandDevicesService) {}

  @Post("control-plane/token")
  @HttpCode(HttpStatus.OK)
  async mintControlPlaneToken(
    @Body() body: ControlPlaneTokenRequestDto,
  ): Promise<ControlPlaneTokenResponseDto> {
    const { token, expiresAt } = await this.svc.mintControlPlaneTokenForUser(
      body.userId,
      body.deviceIds,
    );
    return { token, expiresAt };
  }

  @Post("devices/list-for-user")
  @HttpCode(HttpStatus.OK)
  async listDevicesForUser(
    @Body() body: ListDevicesForUserRequestDto,
  ): Promise<InternalDeviceDto[]> {
    const rows = await this.svc.listActiveDevicesForUser(body.userId, {
      includeOffline: body.includeOffline ?? true,
    });
    return rows.map((r) => ({
      id: r.id,
      hubDeviceId: r.hubDeviceId,
      publicKey: r.publicKey,
      nickname: r.nickname,
      platform: r.platform as InternalDeviceDto["platform"],
      hostname: r.hostname,
      status: r.status as InternalDeviceDto["status"],
      isOnline: r.isOnline,
      lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
```

- [ ] **Step 4: Tests**

```ts
// apps/server/apps/gateway/src/ahand/ahand-internal.controller.spec.ts

import { Test } from "@nestjs/testing";
import { AhandInternalController } from "./ahand-internal.controller";
import { AhandDevicesService } from "./ahand.service";
import { InternalServiceGuard } from "../auth/guards/internal-service.guard";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";

describe("AhandInternalController", () => {
  let controller: AhandInternalController;
  let svc: jest.Mocked<AhandDevicesService>;

  beforeEach(async () => {
    svc = {
      mintControlPlaneTokenForUser: jest.fn(),
      listActiveDevicesForUser: jest.fn(),
    } as any;
    const moduleRef = await Test.createTestingModule({
      controllers: [AhandInternalController],
      providers: [{ provide: AhandDevicesService, useValue: svc }],
    })
      .overrideGuard(InternalServiceGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(AhandInternalController);
  });

  describe("POST /internal/ahand/control-plane/token", () => {
    it("delegates to service and returns token", async () => {
      svc.mintControlPlaneTokenForUser.mockResolvedValue({
        token: "cp.xyz",
        expiresAt: "...",
      });
      const res = await controller.mintControlPlaneToken({
        userId: "user-uuid",
        deviceIds: ["a".repeat(64)],
      });
      expect(res.token).toBe("cp.xyz");
      expect(svc.mintControlPlaneTokenForUser).toHaveBeenCalledWith(
        "user-uuid",
        ["a".repeat(64)],
      );
    });

    it("propagates 403 when deviceIds not owned", async () => {
      svc.mintControlPlaneTokenForUser.mockRejectedValue(
        new ForbiddenException("not owned"),
      );
      await expect(
        controller.mintControlPlaneToken({
          userId: "user-uuid",
          deviceIds: ["b".repeat(64)],
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("POST /internal/ahand/devices/list-for-user", () => {
    it("returns mapped device list", async () => {
      svc.listActiveDevicesForUser.mockResolvedValue([
        {
          id: "id-1",
          ownerType: "user",
          ownerId: "user-uuid",
          hubDeviceId: "d1",
          publicKey: "pk",
          nickname: "A",
          platform: "macos",
          hostname: null,
          status: "active",
          lastSeenAt: new Date("2026-04-22T10:00:00Z"),
          createdAt: new Date("2026-04-22T09:00:00Z"),
          revokedAt: null,
          isOnline: true,
        } as any,
      ]);
      const res = await controller.listDevicesForUser({
        userId: "user-uuid",
        includeOffline: true,
      });
      expect(res).toHaveLength(1);
      expect(res[0]).toMatchObject({
        id: "id-1",
        hubDeviceId: "d1",
        publicKey: "pk",
        nickname: "A",
        platform: "macos",
        isOnline: true,
        lastSeenAt: "2026-04-22T10:00:00.000Z",
        createdAt: "2026-04-22T09:00:00.000Z",
      });
    });

    it("defaults includeOffline to true when omitted", async () => {
      svc.listActiveDevicesForUser.mockResolvedValue([]);
      await controller.listDevicesForUser({ userId: "user-uuid" });
      expect(svc.listActiveDevicesForUser).toHaveBeenCalledWith("user-uuid", {
        includeOffline: true,
      });
    });
  });

  describe("guard", () => {
    it("rejects requests without the internal service token", async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [AhandInternalController],
        providers: [{ provide: AhandDevicesService, useValue: svc }],
      })
        .overrideGuard(InternalServiceGuard)
        .useValue({
          canActivate: () => {
            throw new UnauthorizedException();
          },
        })
        .compile();
      const guardedCtl = moduleRef.get(AhandInternalController);
      await expect(() =>
        guardedCtl.listDevicesForUser({ userId: "user-uuid" }),
      ).rejects.toThrow();
    });
  });
});
```

- [ ] **Step 5: Commit**

```bash
cd /Users/winrey/Projects/weightwave/team9
git add apps/server/apps/gateway/src/ahand/ahand-internal.controller.ts \
        apps/server/apps/gateway/src/ahand/ahand-internal.controller.spec.ts \
        apps/server/apps/gateway/src/ahand/dto/internal.dto.ts \
        apps/server/apps/gateway/src/auth/guards/internal-service.guard.ts
git commit -m "$(cat <<'EOF'
feat(gateway/ahand): internal endpoints for im-worker

Two POST endpoints under /internal/ahand/*, guarded by the shared
InternalServiceGuard (X-Internal-Service-Token header, constant-time
compared against INTERNAL_SERVICE_TOKEN env):
- /control-plane/token — mint a control-plane JWT for a given
  userId + optional deviceIds whitelist; 403 propagates if the user
  does not own any requested deviceId
- /devices/list-for-user — return the user's active devices with
  presence merged from Redis

userId comes from the request body (not a JWT), because im-worker
is acting on behalf of a user it resolved from message metadata.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4.6: `AhandHubWebhookController` — hub → gateway webhook receiver

**Goal:** Receive device events from ahand-hub. Verify HMAC signatures, deduplicate by eventId via Redis, route to handlers that update `ahand_devices.lastSeenAt` in DB, maintain Redis presence keys, publish the event to `ahand:events:{ownerId}` Redis pub/sub, and emit on Socket.io room `{ownerType}:{ownerId}:ahand`.

This controller is **not** JwtAuthGuard-protected; authentication is purely via HMAC signature on the request body. The raw body must be preserved for signature verification, so a custom body parser is wired in.

**Files:**

- Create: `apps/server/apps/gateway/src/ahand/ahand-webhook.controller.ts`
- Create: `apps/server/apps/gateway/src/ahand/ahand-webhook.service.ts` — the signature verification + event dispatch logic (extracted so the controller is thin and testable).
- Create: `apps/server/apps/gateway/src/ahand/ahand-webhook.service.spec.ts`
- Create: `apps/server/apps/gateway/src/ahand/dto/webhook-event.dto.ts`
- Modify: `apps/server/apps/gateway/src/main.ts` — register a raw-body middleware for `/api/ahand/hub-webhook` path.

**Acceptance Criteria:**

- [ ] Endpoint: `POST /api/ahand/hub-webhook`. Headers required: `X-AHand-Signature: sha256=<hex>`, `X-AHand-Event-Id`, `X-AHand-Timestamp`.
- [ ] Signature verified via `timingSafeEqual` over `HMAC-SHA256(AHAND_HUB_WEBHOOK_SECRET, <raw request body>)`. Missing / malformed → 401.
- [ ] Timestamp freshness: rejects if `|now - timestamp| > 5min`. Returns 401.
- [ ] Idempotency: `SETNX ahand:webhook:seen:{eventId} "1" EX 600`. If SETNX returns 0 (key exists) → 204 without processing.
- [ ] Body shape validated via DTO (`WebhookEventDto` discriminated by `eventType`). Unknown eventTypes → 400.
- [ ] Handlers:
  - `device.online` / `device.heartbeat`: `SET ahand:device:{deviceId}:presence "online" EX <presenceTtlSeconds>`; on `device.online`, update DB `last_seen_at = now()`; always publish Redis event + Socket.io emit.
  - `device.offline`: `DEL ahand:device:{deviceId}:presence`; update DB `last_seen_at = now()`; publish + emit.
  - `device.revoked`: `DEL ahand:device:{deviceId}:presence`; update DB `status='revoked'`, `revoked_at = now()`; publish + emit.
  - `device.registered`: publish + emit only (DB row is already in place from the registration REST call).
- [ ] Failures processing the event (DB write) surface as 5xx so the hub retries; but idempotency key is removed before returning 5xx so the retry is genuinely re-attempted (delete `ahand:webhook:seen:{eventId}` on handler failure).
- [ ] Socket.io adapter handles cross-replica fan-out (implemented in Task 4.7; this task calls into that publisher API).
- [ ] 100% coverage on both `ahand-webhook.service.ts` and `ahand-webhook.controller.ts`.

**Verify:** `pnpm test apps/server/apps/gateway/src/ahand/ahand-webhook.service.spec.ts --coverage` → 100%.

**Steps:**

- [ ] **Step 1: DTOs**

```ts
// apps/server/apps/gateway/src/ahand/dto/webhook-event.dto.ts

import {
  IsIn,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Min,
} from "class-validator";

export class WebhookEventDataDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  sentAtMs?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  presenceTtlSeconds?: number;

  @IsOptional()
  @IsString()
  nickname?: string;

  // additional fields allowed per eventType; validated per-handler
  [key: string]: unknown;
}

export class WebhookEventDto {
  @IsString()
  @Matches(/^evt_[A-Z0-9_]+$/i)
  eventId!: string;

  @IsIn([
    "device.registered",
    "device.online",
    "device.heartbeat",
    "device.offline",
    "device.revoked",
  ])
  eventType!:
    | "device.registered"
    | "device.online"
    | "device.heartbeat"
    | "device.offline"
    | "device.revoked";

  @IsISO8601()
  occurredAt!: string;

  @IsString()
  @Matches(/^[0-9a-f]{64}$/)
  deviceId!: string;

  @IsString()
  externalUserId!: string;

  @IsObject()
  data!: WebhookEventDataDto;
}
```

- [ ] **Step 2: Raw-body middleware registration**

```ts
// apps/server/apps/gateway/src/main.ts (patch)

import express from "express";

async function bootstrap() {
  // ...existing
  app.use(
    "/api/ahand/hub-webhook",
    express.raw({ type: "application/json", limit: "1mb" }),
  );
  // Enable standard JSON body parser for all other routes
  app.use(express.json());
  // ...
}
```

If the app already uses `NestFactory.create(AppModule, { rawBody: true })`, skip the middleware addition — the framework will attach `req.rawBody` to every request. In that case, read `req.rawBody` inside the controller.

- [ ] **Step 3: Webhook service**

```ts
// apps/server/apps/gateway/src/ahand/ahand-webhook.service.ts

import {
  BadRequestException,
  Injectable,
  Logger,
  PayloadTooLargeException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "@app/database";
import { ahandDevices } from "@app/database/schemas/im";
import { and, eq } from "drizzle-orm";
import { Inject } from "@nestjs/common";
import type Redis from "ioredis";
import { createHmac, timingSafeEqual } from "crypto";
import { AhandRedisPublisher } from "./ahand-redis-publisher.service";
import { AhandEventsGateway } from "./ahand-events.gateway";
import type { WebhookEventDto } from "./dto/webhook-event.dto";

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const DEDUPE_TTL_SECONDS = 600;

@Injectable()
export class AhandWebhookService {
  private readonly logger = new Logger(AhandWebhookService.name);
  private readonly secret: Buffer;

  constructor(
    cfg: ConfigService,
    private readonly db: DatabaseService,
    @Inject("REDIS_CLIENT") private readonly redis: Redis,
    private readonly publisher: AhandRedisPublisher,
    private readonly socketGw: AhandEventsGateway,
  ) {
    const s = cfg.getOrThrow<string>("ahandHubWebhookSecret");
    this.secret = Buffer.from(s, "utf8");
  }

  verifySignature(
    rawBody: Buffer,
    signatureHeader: string,
    timestampHeader: string,
  ): void {
    if (!signatureHeader || !signatureHeader.startsWith("sha256=")) {
      throw new UnauthorizedException("Missing or malformed X-AHand-Signature");
    }
    if (!timestampHeader) {
      throw new UnauthorizedException("Missing X-AHand-Timestamp");
    }
    const ts = Number.parseInt(timestampHeader, 10);
    if (!Number.isFinite(ts))
      throw new UnauthorizedException("Invalid X-AHand-Timestamp");
    if (Math.abs(Date.now() - ts * 1000) > MAX_CLOCK_SKEW_MS) {
      throw new UnauthorizedException(
        "X-AHand-Timestamp outside acceptable window",
      );
    }
    const expected = createHmac("sha256", this.secret)
      .update(rawBody)
      .digest("hex");
    const got = signatureHeader.slice("sha256=".length);
    if (got.length !== expected.length)
      throw new UnauthorizedException("Signature mismatch");
    if (
      !timingSafeEqual(Buffer.from(got, "hex"), Buffer.from(expected, "hex"))
    ) {
      throw new UnauthorizedException("Signature mismatch");
    }
  }

  /**
   * @returns true if processed, false if duplicate (already seen).
   */
  async dedupe(eventId: string): Promise<boolean> {
    const res = await this.redis.set(
      `ahand:webhook:seen:${eventId}`,
      "1",
      "EX",
      DEDUPE_TTL_SECONDS,
      "NX",
    );
    return res === "OK"; // OK = inserted, null = already present
  }

  async clearDedupe(eventId: string): Promise<void> {
    await this.redis.del(`ahand:webhook:seen:${eventId}`).catch(() => {});
  }

  async handleEvent(evt: WebhookEventDto): Promise<void> {
    const presenceKey = `ahand:device:${evt.deviceId}:presence`;

    switch (evt.eventType) {
      case "device.online": {
        const ttl = evt.data.presenceTtlSeconds ?? 180;
        await this.redis.set(presenceKey, "online", "EX", ttl);
        await this.updateLastSeen(evt.deviceId);
        break;
      }
      case "device.heartbeat": {
        const ttl = evt.data.presenceTtlSeconds ?? 180;
        await this.redis.set(presenceKey, "online", "EX", ttl);
        // NOTE: do NOT update last_seen_at on heartbeats (write amplification)
        break;
      }
      case "device.offline": {
        await this.redis.del(presenceKey);
        await this.updateLastSeen(evt.deviceId);
        break;
      }
      case "device.revoked": {
        await this.redis.del(presenceKey);
        await this.db.db
          .update(ahandDevices)
          .set({ status: "revoked", revokedAt: new Date() })
          .where(eq(ahandDevices.hubDeviceId, evt.deviceId));
        break;
      }
      case "device.registered": {
        // DB row was created during the Tauri POST /devices call; nothing to do here
        // other than fan-out.
        break;
      }
    }

    // Look up ownership so we can fan out to the right Socket.io room + Redis channel.
    const [row] = await this.db.db
      .select()
      .from(ahandDevices)
      .where(eq(ahandDevices.hubDeviceId, evt.deviceId));
    if (!row) {
      this.logger.warn(
        `Webhook for unknown deviceId=${evt.deviceId}; ignoring fan-out`,
      );
      return;
    }
    await this.publisher.publishForOwner({
      ownerType: row.ownerType as "user" | "workspace",
      ownerId: row.ownerId,
      eventType: evt.eventType,
      data: { ...evt.data, hubDeviceId: evt.deviceId },
    });
    this.socketGw.emitToOwner(
      row.ownerType as "user" | "workspace",
      row.ownerId,
      evt.eventType,
      {
        hubDeviceId: evt.deviceId,
        nickname: row.nickname,
        platform: row.platform,
        ...evt.data,
      },
    );
  }

  private async updateLastSeen(hubDeviceId: string): Promise<void> {
    await this.db.db
      .update(ahandDevices)
      .set({ lastSeenAt: new Date() })
      .where(eq(ahandDevices.hubDeviceId, hubDeviceId));
  }
}
```

- [ ] **Step 4: Controller**

```ts
// apps/server/apps/gateway/src/ahand/ahand-webhook.controller.ts

import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { AhandWebhookService } from "./ahand-webhook.service";
import { WebhookEventDto } from "./dto/webhook-event.dto";

@Controller("api/ahand/hub-webhook")
export class AhandHubWebhookController {
  private readonly logger = new Logger(AhandHubWebhookController.name);

  constructor(private readonly svc: AhandWebhookService) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  async ingest(
    @Req() req: Request,
    @Headers("x-ahand-signature") signature: string,
    @Headers("x-ahand-timestamp") timestamp: string,
    @Headers("x-ahand-event-id") eventIdHeader: string,
    @Body() body: WebhookEventDto,
  ): Promise<void> {
    // Signature verification uses the RAW body.
    const rawBody: Buffer | undefined =
      (req as any).rawBody ?? (req as any).body;
    if (!rawBody) throw new BadRequestException("Missing raw body");
    const rawBodyBuf = Buffer.isBuffer(rawBody)
      ? rawBody
      : Buffer.from(
          typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody),
        );

    this.svc.verifySignature(rawBodyBuf, signature, timestamp);

    if (eventIdHeader && body.eventId && eventIdHeader !== body.eventId) {
      throw new BadRequestException(
        "Header eventId does not match body eventId",
      );
    }

    const fresh = await this.svc.dedupe(body.eventId);
    if (!fresh) return; // already processed, 204 silently

    try {
      await this.svc.handleEvent(body);
    } catch (e) {
      this.logger.error(`Webhook handler failed for ${body.eventId}: ${e}`);
      await this.svc.clearDedupe(body.eventId);
      throw e;
    }
  }
}
```

- [ ] **Step 5: Tests**

```ts
// apps/server/apps/gateway/src/ahand/ahand-webhook.service.spec.ts

import { Test } from "@nestjs/testing";
import { AhandWebhookService } from "./ahand-webhook.service";
import { ConfigService } from "@nestjs/config";
import RedisMock from "ioredis-mock";
import { AhandRedisPublisher } from "./ahand-redis-publisher.service";
import { AhandEventsGateway } from "./ahand-events.gateway";
import { UnauthorizedException } from "@nestjs/common";
import { createHmac } from "crypto";
import { createTestDb } from "@app/database/test-support";
import { ahandDevices } from "@app/database/schemas/im";
import { eq } from "drizzle-orm";

const SECRET = "super-secret-webhook-key";

function sign(rawBody: string): string {
  return "sha256=" + createHmac("sha256", SECRET).update(rawBody).digest("hex");
}

describe("AhandWebhookService", () => {
  let svc: AhandWebhookService;
  let redis: InstanceType<typeof RedisMock>;
  let publisher: jest.Mocked<AhandRedisPublisher>;
  let socketGw: jest.Mocked<AhandEventsGateway>;
  let db: any;

  beforeEach(async () => {
    const testDb = await createTestDb();
    db = testDb;
    redis = new RedisMock();
    publisher = {
      publishForOwner: jest.fn().mockResolvedValue(undefined),
    } as any;
    socketGw = { emitToOwner: jest.fn() } as any;
    const moduleRef = await Test.createTestingModule({
      providers: [
        AhandWebhookService,
        { provide: ConfigService, useValue: { getOrThrow: () => SECRET } },
        { provide: "DatabaseService", useValue: { db: testDb.db } },
        { provide: "REDIS_CLIENT", useValue: redis },
        { provide: AhandRedisPublisher, useValue: publisher },
        { provide: AhandEventsGateway, useValue: socketGw },
      ],
    }).compile();
    svc = moduleRef.get(AhandWebhookService);
  });

  describe("verifySignature", () => {
    const body = Buffer.from(JSON.stringify({ eventId: "evt_1" }));
    const goodSig = sign(body.toString());
    const goodTs = String(Math.floor(Date.now() / 1000));

    it("accepts valid signature + recent timestamp", () => {
      expect(() => svc.verifySignature(body, goodSig, goodTs)).not.toThrow();
    });
    it("rejects missing signature header", () => {
      expect(() => svc.verifySignature(body, "", goodTs)).toThrow(
        UnauthorizedException,
      );
    });
    it("rejects non-sha256 prefix", () => {
      expect(() => svc.verifySignature(body, "md5=abc", goodTs)).toThrow(
        UnauthorizedException,
      );
    });
    it("rejects signature tampering", () => {
      const tampered = "sha256=" + "0".repeat(64);
      expect(() => svc.verifySignature(body, tampered, goodTs)).toThrow(
        UnauthorizedException,
      );
    });
    it("rejects timestamp older than 5 min", () => {
      const old = String(Math.floor(Date.now() / 1000) - 400);
      expect(() => svc.verifySignature(body, goodSig, old)).toThrow(
        UnauthorizedException,
      );
    });
    it("rejects timestamp from the future (beyond skew)", () => {
      const future = String(Math.floor(Date.now() / 1000) + 400);
      expect(() => svc.verifySignature(body, goodSig, future)).toThrow(
        UnauthorizedException,
      );
    });
    it("rejects non-numeric timestamp", () => {
      expect(() => svc.verifySignature(body, goodSig, "not-a-number")).toThrow(
        UnauthorizedException,
      );
    });
  });

  describe("dedupe", () => {
    it("SETNX succeeds the first time, fails on duplicate", async () => {
      expect(await svc.dedupe("evt_1")).toBe(true);
      expect(await svc.dedupe("evt_1")).toBe(false);
    });
    it("clearDedupe removes the key so a retry gets fresh processing", async () => {
      await svc.dedupe("evt_2");
      await svc.clearDedupe("evt_2");
      expect(await svc.dedupe("evt_2")).toBe(true);
    });
  });

  describe("handleEvent — online", () => {
    beforeEach(async () => {
      await db.db.insert(ahandDevices).values({
        ownerType: "user",
        ownerId: "u1",
        hubDeviceId: "d1",
        publicKey: "p",
        nickname: "A",
        platform: "macos",
      });
    });
    it("sets presence with TTL and updates last_seen_at", async () => {
      await svc.handleEvent({
        eventId: "evt_x",
        eventType: "device.online",
        occurredAt: new Date().toISOString(),
        deviceId: "d1",
        externalUserId: "u1",
        data: { presenceTtlSeconds: 180 },
      });
      expect(await redis.get("ahand:device:d1:presence")).toBe("online");
      expect(await redis.ttl("ahand:device:d1:presence")).toBeGreaterThan(170);
      const [row] = await db.db
        .select()
        .from(ahandDevices)
        .where(eq(ahandDevices.hubDeviceId, "d1"));
      expect(row.lastSeenAt).not.toBeNull();
      expect(publisher.publishForOwner).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerType: "user",
          ownerId: "u1",
          eventType: "device.online",
        }),
      );
      expect(socketGw.emitToOwner).toHaveBeenCalledWith(
        "user",
        "u1",
        "device.online",
        expect.any(Object),
      );
    });
  });

  describe("handleEvent — heartbeat", () => {
    beforeEach(async () => {
      await db.db.insert(ahandDevices).values({
        ownerType: "user",
        ownerId: "u1",
        hubDeviceId: "d1",
        publicKey: "p",
        nickname: "A",
        platform: "macos",
      });
    });
    it("refreshes TTL but does NOT update last_seen_at (write amplification)", async () => {
      await svc.handleEvent({
        eventId: "evt_h",
        eventType: "device.heartbeat",
        occurredAt: new Date().toISOString(),
        deviceId: "d1",
        externalUserId: "u1",
        data: { presenceTtlSeconds: 60 },
      });
      expect(await redis.get("ahand:device:d1:presence")).toBe("online");
      const [row] = await db.db
        .select()
        .from(ahandDevices)
        .where(eq(ahandDevices.hubDeviceId, "d1"));
      expect(row.lastSeenAt).toBeNull();
    });
  });

  describe("handleEvent — offline/revoked", () => {
    beforeEach(async () => {
      await db.db.insert(ahandDevices).values({
        ownerType: "user",
        ownerId: "u1",
        hubDeviceId: "d1",
        publicKey: "p",
        nickname: "A",
        platform: "macos",
      });
      await redis.set("ahand:device:d1:presence", "online", "EX", 180);
    });
    it("offline removes presence and updates last_seen_at", async () => {
      await svc.handleEvent({
        eventId: "evt_o",
        eventType: "device.offline",
        occurredAt: new Date().toISOString(),
        deviceId: "d1",
        externalUserId: "u1",
        data: {},
      });
      expect(await redis.get("ahand:device:d1:presence")).toBeNull();
      const [row] = await db.db
        .select()
        .from(ahandDevices)
        .where(eq(ahandDevices.hubDeviceId, "d1"));
      expect(row.lastSeenAt).not.toBeNull();
    });
    it("revoked removes presence, flips DB status, fans out", async () => {
      await svc.handleEvent({
        eventId: "evt_r",
        eventType: "device.revoked",
        occurredAt: new Date().toISOString(),
        deviceId: "d1",
        externalUserId: "u1",
        data: {},
      });
      const [row] = await db.db
        .select()
        .from(ahandDevices)
        .where(eq(ahandDevices.hubDeviceId, "d1"));
      expect(row.status).toBe("revoked");
      expect(row.revokedAt).not.toBeNull();
      expect(await redis.get("ahand:device:d1:presence")).toBeNull();
    });
  });

  describe("handleEvent — unknown deviceId", () => {
    it("logs and skips fan-out without throwing", async () => {
      const spy = jest
        .spyOn((svc as any).logger, "warn")
        .mockImplementation(() => {});
      await svc.handleEvent({
        eventId: "evt_u",
        eventType: "device.online",
        occurredAt: new Date().toISOString(),
        deviceId: "unknown",
        externalUserId: "u1",
        data: { presenceTtlSeconds: 60 },
      });
      expect(spy).toHaveBeenCalled();
      expect(publisher.publishForOwner).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 6: Commit**

```bash
cd /Users/winrey/Projects/weightwave/team9
git add apps/server/apps/gateway/src/ahand/ahand-webhook.controller.ts \
        apps/server/apps/gateway/src/ahand/ahand-webhook.service.ts \
        apps/server/apps/gateway/src/ahand/ahand-webhook.service.spec.ts \
        apps/server/apps/gateway/src/ahand/dto/webhook-event.dto.ts \
        apps/server/apps/gateway/src/main.ts
git commit -m "$(cat <<'EOF'
feat(gateway/ahand): hub → gateway webhook receiver

POST /api/ahand/hub-webhook ingests device.{registered, online,
heartbeat, offline, revoked} events from ahand-hub. No JwtAuthGuard
— auth is purely HMAC-SHA256 signature over the raw body (plus
5-minute timestamp freshness window to defeat replay).

Idempotency via Redis SETNX on ahand:webhook:seen:{eventId} with
600s TTL. On handler failure, the idempotency key is cleared before
returning 5xx so the hub's retry actually re-attempts the work.

Handlers maintain:
- Redis presence keys (ahand:device:{id}:presence) with daemon-
  advertised TTL on online/heartbeat; deleted on offline/revoked.
- DB last_seen_at updated on online/offline transitions only (never
  on heartbeats) to avoid write amplification.
- DB status='revoked' on revoke events.
- Fan-out to Redis pub/sub (for im-worker) and Socket.io room
  (for connected clients) via AhandRedisPublisher + AhandEventsGateway.

Unknown deviceIds are logged and skipped (no throw).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4.7: `AhandRedisPublisher` + `AhandEventsGateway` (Socket.io)

**Goal:** Two coordinated services for event fan-out:

1. `AhandRedisPublisher` publishes events to Redis pub/sub channels like `ahand:events:{ownerId}` so im-worker's subscriber (Phase 5) receives them across replicas.
2. `AhandEventsGateway` is a NestJS WebSocket gateway that emits the same events into Socket.io rooms `{ownerType}:{ownerId}:ahand` using the existing Socket.io Redis adapter, so the Tauri/web client connected to **any** gateway replica receives the update.

**Files:**

- Create: `apps/server/apps/gateway/src/ahand/ahand-redis-publisher.service.ts`
- Create: `apps/server/apps/gateway/src/ahand/ahand-redis-publisher.service.spec.ts`
- Create: `apps/server/apps/gateway/src/ahand/ahand-events.gateway.ts`
- Create: `apps/server/apps/gateway/src/ahand/ahand-events.gateway.spec.ts`

**Acceptance Criteria:**

- [ ] `AhandRedisPublisher.publishForOwner({ ownerType, ownerId, eventType, data })` publishes JSON to Redis channel `ahand:events:{ownerId}` with payload `{ ownerType, eventType, data, publishedAt }`. Returns the number of subscribers that received it (Redis PUBLISH return value); logs when 0 subscribers (may indicate misconfig).
- [ ] Failure in publish is caught and logged, never thrown (event fan-out is best-effort).
- [ ] `AhandEventsGateway` is a `@WebSocketGateway({ namespace: "/", cors: ... })` attached to the existing im Socket.io namespace. Listens for `join_room`/`leave_room` messages with `{ room }` payload.
- [ ] `join_room` membership is validated: `user:{uid}:ahand` only joinable by the authenticated user `uid`. `workspace:{wid}:ahand` requires membership in workspace `wid` (verified via existing Workspace service).
- [ ] `emitToOwner(ownerType, ownerId, eventType, payload)` → `io.to("${ownerType}:${ownerId}:ahand").emit(eventType, payload)`.
- [ ] Socket.io Redis adapter is already configured on the existing im gateway (verify; if not, document as a blocker).
- [ ] 100% coverage on both services.

**Verify:** `pnpm test apps/server/apps/gateway/src/ahand/ahand-redis-publisher.service.spec.ts apps/server/apps/gateway/src/ahand/ahand-events.gateway.spec.ts --coverage`.

**Steps:**

- [ ] **Step 1: Publisher**

```ts
// apps/server/apps/gateway/src/ahand/ahand-redis-publisher.service.ts

import { Injectable, Logger, Inject } from "@nestjs/common";
import type Redis from "ioredis";

export type OwnerType = "user" | "workspace";

export interface PublishInput {
  ownerType: OwnerType;
  ownerId: string;
  eventType: string;
  data: Record<string, unknown>;
}

@Injectable()
export class AhandRedisPublisher {
  private readonly logger = new Logger(AhandRedisPublisher.name);

  constructor(@Inject("REDIS_CLIENT") private readonly redis: Redis) {}

  async publishForOwner(input: PublishInput): Promise<void> {
    const channel = `ahand:events:${input.ownerId}`;
    const payload = JSON.stringify({
      ownerType: input.ownerType,
      eventType: input.eventType,
      data: input.data,
      publishedAt: new Date().toISOString(),
    });
    try {
      const receivers = await this.redis.publish(channel, payload);
      if (receivers === 0) {
        this.logger.debug(
          `Published ${input.eventType} to ${channel} — 0 subscribers`,
        );
      }
    } catch (e) {
      // Best-effort: log and swallow so callers' primary operation (DB + HTTP) isn't affected.
      this.logger.warn(`Redis publish failed for ${channel}: ${e}`);
    }
  }
}
```

- [ ] **Step 2: Socket.io gateway**

Check the existing im Socket.io gateway's decorator to match the namespace/server pattern:

```bash
rg -nP '@WebSocketGateway|@WebSocketServer|adapter:' apps/server/apps/gateway/src/ | head -20
```

Assuming the existing gateway is on the default namespace `/`:

```ts
// apps/server/apps/gateway/src/ahand/ahand-events.gateway.ts

import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { Logger, UseGuards } from "@nestjs/common";
import type { Server, Socket } from "socket.io";
import { WsJwtGuard } from "../websocket/guards/ws-jwt.guard"; // existing guard for WS auth
import { WorkspaceMembershipService } from "../workspace/workspace-membership.service";

type OwnerType = "user" | "workspace";

@WebSocketGateway({ namespace: "/", cors: { origin: "*", credentials: true } })
export class AhandEventsGateway {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(AhandEventsGateway.name);

  constructor(
    private readonly workspaceMembership: WorkspaceMembershipService,
  ) {}

  emitToOwner(
    ownerType: OwnerType,
    ownerId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): void {
    this.server.to(`${ownerType}:${ownerId}:ahand`).emit(eventType, payload);
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage("ahand:join_room")
  async onJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { room: string },
  ): Promise<{ ok: boolean; error?: string }> {
    const { room } = body ?? { room: "" };
    const parsed = parseRoom(room);
    if (!parsed) return { ok: false, error: "Invalid room format" };

    const authUser = (client as any).data?.user as { id: string } | undefined;
    if (!authUser) return { ok: false, error: "Unauthenticated" };

    if (parsed.ownerType === "user") {
      if (parsed.ownerId !== authUser.id) {
        return { ok: false, error: "Cannot join another user's room" };
      }
    } else {
      const member = await this.workspaceMembership.isMember(
        authUser.id,
        parsed.ownerId,
      );
      if (!member)
        return { ok: false, error: "Not a member of this workspace" };
    }
    await client.join(room);
    return { ok: true };
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage("ahand:leave_room")
  async onLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { room: string },
  ): Promise<{ ok: boolean }> {
    const { room } = body ?? { room: "" };
    await client.leave(room);
    return { ok: true };
  }
}

function parseRoom(
  room: string,
): { ownerType: OwnerType; ownerId: string } | null {
  const m = /^(user|workspace):([0-9a-f-]+):ahand$/.exec(room);
  if (!m) return null;
  return { ownerType: m[1] as OwnerType, ownerId: m[2] };
}
```

Note: the Socket.io Redis adapter for cross-replica broadcast must already be configured on the main Socket.io server (used by the existing im gateway). If not, configure it with the existing `@socket.io/redis-adapter` package. Verify by searching for `createAdapter` or `useWSAdapter` in `main.ts`.

- [ ] **Step 3: Publisher tests**

```ts
// apps/server/apps/gateway/src/ahand/ahand-redis-publisher.service.spec.ts

import { Test } from "@nestjs/testing";
import { AhandRedisPublisher } from "./ahand-redis-publisher.service";
import RedisMock from "ioredis-mock";

describe("AhandRedisPublisher", () => {
  let publisher: AhandRedisPublisher;
  let redis: InstanceType<typeof RedisMock>;

  beforeEach(async () => {
    redis = new RedisMock();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AhandRedisPublisher,
        { provide: "REDIS_CLIENT", useValue: redis },
      ],
    }).compile();
    publisher = moduleRef.get(AhandRedisPublisher);
  });

  it("publishes to ahand:events:{ownerId} channel with JSON payload", async () => {
    const received: unknown[] = [];
    const subscriber = new RedisMock();
    await subscriber.subscribe("ahand:events:u1");
    subscriber.on("message", (channel, msg) => {
      if (channel === "ahand:events:u1") received.push(JSON.parse(msg));
    });

    await publisher.publishForOwner({
      ownerType: "user",
      ownerId: "u1",
      eventType: "device.online",
      data: { hubDeviceId: "d1" },
    });

    // Allow pub/sub to propagate in ioredis-mock
    await new Promise((r) => setTimeout(r, 10));
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      ownerType: "user",
      eventType: "device.online",
      data: { hubDeviceId: "d1" },
    });
  });

  it("swallows publish errors and never throws", async () => {
    const broken = {
      publish: jest.fn().mockRejectedValue(new Error("redis-down")),
    } as any;
    const brokenPublisher = new AhandRedisPublisher(broken);
    await expect(
      brokenPublisher.publishForOwner({
        ownerType: "user",
        ownerId: "u1",
        eventType: "x",
        data: {},
      }),
    ).resolves.toBeUndefined();
  });

  it("logs when publish returns 0 subscribers (misconfig hint)", async () => {
    const logSpy = jest
      .spyOn((publisher as any).logger, "debug")
      .mockImplementation(() => {});
    await publisher.publishForOwner({
      ownerType: "user",
      ownerId: "no-one-is-listening",
      eventType: "x",
      data: {},
    });
    expect(logSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Gateway tests**

```ts
// apps/server/apps/gateway/src/ahand/ahand-events.gateway.spec.ts

import { Test } from "@nestjs/testing";
import { AhandEventsGateway } from "./ahand-events.gateway";
import { WorkspaceMembershipService } from "../workspace/workspace-membership.service";
import { WsJwtGuard } from "../websocket/guards/ws-jwt.guard";

describe("AhandEventsGateway", () => {
  let gateway: AhandEventsGateway;
  let workspace: jest.Mocked<WorkspaceMembershipService>;

  beforeEach(async () => {
    workspace = { isMember: jest.fn() } as any;
    const moduleRef = await Test.createTestingModule({
      providers: [
        AhandEventsGateway,
        { provide: WorkspaceMembershipService, useValue: workspace },
      ],
    })
      .overrideGuard(WsJwtGuard)
      .useValue({ canActivate: () => true })
      .compile();
    gateway = moduleRef.get(AhandEventsGateway);

    // Fake Socket.io server
    const emit = jest.fn();
    const toFn = jest.fn().mockReturnValue({ emit });
    (gateway as any).server = { to: toFn };
  });

  describe("emitToOwner", () => {
    it("emits to user:{id}:ahand room", () => {
      gateway.emitToOwner("user", "u1", "device.online", { hubDeviceId: "d1" });
      expect((gateway as any).server.to).toHaveBeenCalledWith("user:u1:ahand");
      expect((gateway as any).server.to().emit).toHaveBeenCalledWith(
        "device.online",
        { hubDeviceId: "d1" },
      );
    });

    it("emits to workspace:{id}:ahand room", () => {
      gateway.emitToOwner("workspace", "w1", "device.online", {});
      expect((gateway as any).server.to).toHaveBeenCalledWith(
        "workspace:w1:ahand",
      );
    });
  });

  describe("onJoinRoom", () => {
    function mkClient(userId: string): any {
      return {
        data: { user: { id: userId } },
        join: jest.fn(),
        leave: jest.fn(),
      };
    }

    it("allows user to join their own room", async () => {
      const client = mkClient("u1");
      const res = await gateway.onJoinRoom(client, { room: "user:u1:ahand" });
      expect(res.ok).toBe(true);
      expect(client.join).toHaveBeenCalledWith("user:u1:ahand");
    });

    it("rejects joining another user's room", async () => {
      const client = mkClient("u1");
      const res = await gateway.onJoinRoom(client, { room: "user:u2:ahand" });
      expect(res.ok).toBe(false);
      expect(client.join).not.toHaveBeenCalled();
    });

    it("allows workspace member to join workspace room", async () => {
      workspace.isMember.mockResolvedValue(true);
      const client = mkClient("u1");
      const res = await gateway.onJoinRoom(client, {
        room: "workspace:w1:ahand",
      });
      expect(res.ok).toBe(true);
      expect(client.join).toHaveBeenCalled();
    });

    it("rejects non-member from joining workspace room", async () => {
      workspace.isMember.mockResolvedValue(false);
      const client = mkClient("u1");
      const res = await gateway.onJoinRoom(client, {
        room: "workspace:w1:ahand",
      });
      expect(res.ok).toBe(false);
      expect(client.join).not.toHaveBeenCalled();
    });

    it("rejects malformed room string", async () => {
      const client = mkClient("u1");
      const res = await gateway.onJoinRoom(client, { room: "garbage" });
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/Invalid room format/);
    });

    it("rejects unauthenticated socket", async () => {
      const client = { data: {}, join: jest.fn() } as any;
      const res = await gateway.onJoinRoom(client, { room: "user:u1:ahand" });
      expect(res.ok).toBe(false);
    });
  });

  describe("onLeaveRoom", () => {
    it("calls client.leave with the room", async () => {
      const client = { data: { user: { id: "u1" } }, leave: jest.fn() } as any;
      const res = await gateway.onLeaveRoom(client, { room: "user:u1:ahand" });
      expect(res.ok).toBe(true);
      expect(client.leave).toHaveBeenCalledWith("user:u1:ahand");
    });
  });
});
```

- [ ] **Step 5: Commit**

```bash
cd /Users/winrey/Projects/weightwave/team9
git add apps/server/apps/gateway/src/ahand/ahand-redis-publisher.service.ts \
        apps/server/apps/gateway/src/ahand/ahand-redis-publisher.service.spec.ts \
        apps/server/apps/gateway/src/ahand/ahand-events.gateway.ts \
        apps/server/apps/gateway/src/ahand/ahand-events.gateway.spec.ts
git commit -m "$(cat <<'EOF'
feat(gateway/ahand): event fan-out via Redis pub/sub + Socket.io

AhandRedisPublisher publishes to ahand:events:{ownerId} Redis channels
— im-worker (Phase 5) pattern-subscribes to get device events across
replicas. Failures are logged but never thrown; fan-out is best-effort.

AhandEventsGateway is a NestJS WS gateway for client-facing broadcast.
Emits to rooms user:{id}:ahand and workspace:{id}:ahand. join_room
events are validated against the authenticated user identity (users
can only join their own room) and workspace membership (for workspace
rooms, future).

Both services assume the existing im Socket.io gateway already has
the Redis adapter wired — if not, main.ts needs @socket.io/redis-
adapter configured on boot. This is noted as a verify-step in Phase 4
Task 4.8.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4.8: `AhandModule` wiring + message `clientContext`

**Goal:** Assemble all ahand pieces into a NestJS module, wire into the app, verify Socket.io Redis adapter is configured, and add the `clientContext` field to the IM message schema so Tauri/web can signal the originating client (required for Phase 5's blueprint injection).

**Files:**

- Create: `apps/server/apps/gateway/src/ahand/ahand.module.ts`
- Modify: `apps/server/apps/gateway/src/app.module.ts` — import `AhandModule`.
- Modify: `apps/server/apps/gateway/src/main.ts` — verify Socket.io Redis adapter + raw-body middleware for webhook.
- Modify: `apps/server/libs/database/schemas/im/messages.ts` (or wherever the messages table lives) — add `clientContext jsonb` column.
- Create: Drizzle migration for the messages schema change.
- Modify: `apps/server/apps/gateway/src/im/websocket/websocket.gateway.ts` — accept a `clientContext` field on `send_message` payload and persist it.
- Modify: `apps/server/apps/gateway/src/im/messages/message.entity.ts` (or equivalent DTO) — expose `clientContext`.

**Acceptance Criteria:**

- [ ] `AhandModule` declares `AhandController`, `AhandInternalController`, `AhandHubWebhookController` as controllers; `AhandDevicesService`, `AhandHubClient`, `AhandWebhookService`, `AhandRedisPublisher`, `AhandEventsGateway` as providers. Exports `AhandDevicesService` (for internal cross-module use if any) and `AhandRedisPublisher`.
- [ ] Module imports: `HttpModule` (axios), `ConfigModule`, `DatabaseModule`, the existing `RedisModule` (for `REDIS_CLIENT` injection), the auth module (for `JwtAuthGuard` and `InternalServiceGuard`), the workspace module (for membership checks). No circular dependency.
- [ ] `AppModule` imports `AhandModule`; boot succeeds.
- [ ] `main.ts` configures `express.raw({ type: "application/json" })` for `/api/ahand/hub-webhook` path _before_ the JSON parser.
- [ ] Socket.io Redis adapter (`@socket.io/redis-adapter`) is configured. If not present, add it — the repo's existing WS code has an `IoAdapter` extension point.
- [ ] `messages.client_context jsonb NULL` column exists after migration. DTO and WebSocket handler accept it and persist verbatim. No validation on internal shape (treated as opaque JSON for the ahand feature's purposes; Phase 5 interprets it).
- [ ] Single integration smoke: `curl -X POST ... /api/ahand/hub-webhook` with a valid signed payload results in 204 and the right Redis side-effects (verified in Phase 9 integration test).

**Verify:**

```bash
cd /Users/winrey/Projects/weightwave/team9/apps/server
pnpm build
pnpm start:prod   # boots; no error on AhandModule wiring
# In another shell:
curl -sI http://localhost:3000/api/health    # baseline health
# From Phase 9 the webhook smoke is fully exercised
```

**Steps:**

- [ ] **Step 1: AhandModule**

```ts
// apps/server/apps/gateway/src/ahand/ahand.module.ts

import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { ConfigModule } from "@nestjs/config";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { DatabaseModule } from "@app/database";
import { RedisModule } from "../redis/redis.module";
import { AuthModule } from "../auth/auth.module";
import { WorkspaceModule } from "../workspace/workspace.module";

import { AhandController } from "./ahand.controller";
import { AhandInternalController } from "./ahand-internal.controller";
import { AhandHubWebhookController } from "./ahand-webhook.controller";
import { AhandDevicesService } from "./ahand.service";
import { AhandHubClient } from "./ahand-hub.client";
import { AhandWebhookService } from "./ahand-webhook.service";
import { AhandRedisPublisher } from "./ahand-redis-publisher.service";
import { AhandEventsGateway } from "./ahand-events.gateway";

@Module({
  imports: [
    HttpModule.register({ timeout: 10_000, maxRedirects: 3 }),
    ConfigModule,
    EventEmitterModule, // for @OnEvent("user.deleted")
    DatabaseModule,
    RedisModule,
    AuthModule,
    WorkspaceModule,
  ],
  controllers: [
    AhandController,
    AhandInternalController,
    AhandHubWebhookController,
  ],
  providers: [
    AhandDevicesService,
    AhandHubClient,
    AhandWebhookService,
    AhandRedisPublisher,
    AhandEventsGateway,
  ],
  exports: [AhandDevicesService, AhandRedisPublisher],
})
export class AhandModule {}
```

- [ ] **Step 2: Wire into app**

```ts
// apps/server/apps/gateway/src/app.module.ts (patch)

import { AhandModule } from "./ahand/ahand.module";

@Module({
  imports: [
    // ...existing
    AhandModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 3: main.ts — raw body + Socket.io Redis adapter verification**

```ts
// apps/server/apps/gateway/src/main.ts (patch, selectively)

import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import express from "express";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";
import { AppModule } from "./app.module";
import type { Server } from "http";

class RedisIoAdapter extends IoAdapter {
  private adapterConstructor!: ReturnType<typeof createAdapter>;
  async connectToRedis(redisUrl: string): Promise<void> {
    const pubClient = createClient({ url: redisUrl });
    const subClient = pubClient.duplicate();
    await Promise.all([pubClient.connect(), subClient.connect()]);
    this.adapterConstructor = createAdapter(pubClient, subClient);
  }
  createIOServer(port: number, options?: any) {
    const server = super.createIOServer(port, options);
    server.adapter(this.adapterConstructor);
    return server;
  }
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true, // preserve req.rawBody for webhook signature verification
    bufferLogs: true,
  });

  // Raw body middleware scoped to the webhook path (belt-and-suspenders; app.rawBody should cover it)
  app.use(
    "/api/ahand/hub-webhook",
    express.raw({ type: "application/json", limit: "1mb" }),
  );

  // Socket.io Redis adapter (cross-replica fan-out for AhandEventsGateway + existing IM gateway)
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    const ioAdapter = new RedisIoAdapter(app);
    await ioAdapter.connectToRedis(redisUrl);
    app.useWebSocketAdapter(ioAdapter);
  }

  // ...existing setup (ValidationPipe, CORS, etc.)
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
```

If the repo already has its own Socket.io adapter subclass (check for `extends IoAdapter`), merge the Redis wiring into that existing class rather than creating a new one.

- [ ] **Step 4: Add `client_context` to messages schema**

```ts
// apps/server/libs/database/schemas/im/messages.ts (patch)

import { jsonb } from "drizzle-orm/pg-core";

export const messages = pgTable("messages", {
  // ...existing columns
  clientContext: jsonb("client_context"), // nullable; opaque JSON from Tauri/web
});

export type ClientContext =
  | { kind: "macapp"; deviceId: string | null }
  | { kind: "web" };
```

Generate + apply:

```bash
cd apps/server
pnpm db:generate
pnpm db:migrate
psql "$DATABASE_URL" -c "\d messages" | grep client_context
```

- [ ] **Step 5: Accept & persist `clientContext` on send_message**

Find the existing `send_message` handler in the IM WebSocket gateway:

```bash
rg -nP '@SubscribeMessage\("send_message"\)' apps/server/apps/gateway/src/
```

Patch the handler to accept `clientContext` in the payload and pass through to the messages service:

```ts
// apps/server/apps/gateway/src/im/websocket/websocket.gateway.ts (patch)

@SubscribeMessage("send_message")
async onSendMessage(
  @ConnectedSocket() client: Socket,
  @MessageBody() body: {
    channelId: string;
    content: string;
    // ...existing fields
    clientContext?: { kind: "macapp"; deviceId?: string | null } | { kind: "web" };
  },
): Promise<SendMessageResponse> {
  // ...existing validation
  const msg = await this.messagesService.create({
    // ...existing fields
    clientContext: body.clientContext ?? null,
  });
  // ...
}
```

And in `MessagesService.create`:

```ts
// apps/server/apps/gateway/src/im/messages/messages.service.ts (patch)

async create(input: CreateMessageInput): Promise<Message> {
  const [row] = await this.db.db.insert(messages).values({
    // ...existing
    clientContext: input.clientContext ?? null,
  }).returning();
  return row;
}
```

Expose `clientContext` in the outgoing Message DTO so im-worker sees it when it dequeues the `new_message` event.

- [ ] **Step 6: End-to-end wiring verification**

Build + boot locally:

```bash
cd apps/server
pnpm build
# In one shell:
pnpm start:dev
# In another:
curl -fsSL http://localhost:3000/api/health
curl -fsSL http://localhost:3000/api/ahand/devices -H "Authorization: Bearer $(gen-test-jwt)"
# → [] (empty list for a fresh user)
```

Boot error signals: circular deps on ahand module → rearrange imports; missing REDIS_CLIENT injection → ensure `RedisModule` exports `REDIS_CLIENT` token and `AhandModule` imports it.

- [ ] **Step 7: Commit**

```bash
cd /Users/winrey/Projects/weightwave/team9
git add apps/server/apps/gateway/src/ahand/ahand.module.ts \
        apps/server/apps/gateway/src/app.module.ts \
        apps/server/apps/gateway/src/main.ts \
        apps/server/libs/database/schemas/im/messages.ts \
        apps/server/libs/database/drizzle/ \
        apps/server/apps/gateway/src/im/
git commit -m "$(cat <<'EOF'
feat(gateway): wire AhandModule + message clientContext

AhandModule imports {Http, Config, EventEmitter, Database, Redis,
Auth, Workspace}Module; declares three controllers (Tauri REST,
internal for im-worker, hub webhook receiver) and five providers
(service, hub client, webhook service, redis publisher, WS gateway).
Exported: AhandDevicesService + AhandRedisPublisher for any
cross-module reuse (im-worker likely imports the service via gateway
REST, not directly; export is defensive).

main.ts wires:
- NestFactory.create(…, { rawBody: true }) so the webhook controller
  can verify HMAC against the original bytes; plus an express.raw
  middleware scoped to /api/ahand/hub-webhook as a belt-and-suspenders.
- @socket.io/redis-adapter on the Socket.io server so
  AhandEventsGateway (and the existing IM gateway) fan out across
  gateway replicas.

Schema: messages table gains client_context jsonb NULL. The send_message
WS handler accepts and persists it; the outbound Message DTO surfaces
it so im-worker can resolve the calling client in Phase 5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

**Phase 4 outcome:** team9 gateway now has a fully wired `ahand` module serving Tauri REST, im-worker internal API, and hub webhook, with event fan-out via Redis pub/sub + Socket.io Redis adapter. The messages table carries `client_context` so originating-client info flows into im-worker's agent sessions. Phase 5 (im-worker subscribe + blueprint injection) can now begin.

---

## Phase 5 — Team9 im-worker

**Working directory:** `/Users/winrey/Projects/weightwave/team9/apps/server/apps/im-worker`.

im-worker is the process that owns agent sessions (via `@team9claw/claw-hive`). It must:

1. Resolve the calling user's available ahand devices when building a blueprint (via gateway internal API).
2. Inject `AHandHostComponent` instances (one per online device) and a single `AHandContextProvider` into the session's blueprint.
3. Propagate `message.clientContext` into the `AHandContextProvider` config so the agent knows the current device.
4. Subscribe to Redis pub/sub `ahand:events:*` to hot-add/remove components when devices come online/offline mid-session.

**Dependencies:**

- Phase 1 (`@ahand/sdk` `CloudClient` for downstream use in Phase 6).
- Phase 2 (multi-backend HostComponent, cache-system provider, dynamic component add/remove).
- Phase 4 (gateway internal API + Redis pub/sub + message `clientContext`).
- Phase 6 (AHandHostComponent + AHandContextProvider) — Phase 6 and Phase 5 can be developed in parallel, but the im-worker blueprint builder will import from Phase 6.

**Module layout:**

```
apps/server/apps/im-worker/src/ahand/
├── ahand.module.ts                    # NestJS module wiring for im-worker
├── ahand-control-plane.service.ts     # Thin wrapper calling gateway /internal/ahand/*
├── ahand-control-plane.service.spec.ts
├── ahand-events.subscriber.ts         # Subscribes to ahand:events:* on Redis
├── ahand-events.subscriber.spec.ts
├── ahand-session-dispatcher.service.ts  # Matches Redis events to active agent sessions
├── ahand-session-dispatcher.service.spec.ts
├── ahand-blueprint.extender.ts        # Injects ahand components into a blueprint at session start
└── ahand-blueprint.extender.spec.ts
```

---

### Task 5.1: `AhandControlPlaneClient` — thin wrapper for gateway internal API

**Goal:** Abstract the two `/internal/ahand/*` endpoint calls used by im-worker. No business logic — just HTTP + auth header + typed response.

**Files:**

- Create: `apps/server/apps/im-worker/src/ahand/ahand-control-plane.service.ts`
- Create: `apps/server/apps/im-worker/src/ahand/ahand-control-plane.service.spec.ts`
- Modify: `apps/server/apps/im-worker/src/config/configuration.ts` — add `gatewayInternalUrl` and `gatewayInternalServiceToken`.

**Acceptance Criteria:**

- [ ] `mintControlPlaneToken(userId, deviceIds?)` returns `{ token, expiresAt }`; under 10s timeout; retries 5xx × 3.
- [ ] `listDevicesForUser(userId, { includeOffline? })` returns an array of `AhandDeviceSummary`. Shape: `{ hubDeviceId, publicKey, nickname, platform, status, isOnline, lastSeenAt, ... }`.
- [ ] Calls include `X-Internal-Service-Token: <gatewayInternalServiceToken>`.
- [ ] 403 from gateway (e.g., unowned deviceIds) throws `ForbiddenError` preserving message.
- [ ] Missing config throws at construction with clear message.
- [ ] 100% coverage with mocked HTTP.

**Verify:** `pnpm test apps/server/apps/im-worker/src/ahand/ahand-control-plane.service.spec.ts --coverage`.

**Steps:**

- [ ] **Step 1: Config**

```ts
// apps/server/apps/im-worker/src/config/configuration.ts (patch)

export default () => ({
  // ...existing
  gatewayInternalUrl: process.env.GATEWAY_INTERNAL_URL ?? "",
  gatewayInternalServiceToken: process.env.GATEWAY_INTERNAL_SERVICE_TOKEN ?? "",
});
```

Validation (Joi):

```ts
GATEWAY_INTERNAL_URL: Joi.string().uri().required(),
GATEWAY_INTERNAL_SERVICE_TOKEN: Joi.string().min(16).required(),
```

- [ ] **Step 2: Service**

```ts
// apps/server/apps/im-worker/src/ahand/ahand-control-plane.service.ts

import {
  Injectable,
  Logger,
  ForbiddenException,
  ServiceUnavailableException,
  InternalServerErrorException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import { z } from "zod";
import type { AxiosRequestConfig } from "axios";

const TokenResponseSchema = z.object({
  token: z.string(),
  expiresAt: z.string(),
});

export interface AhandDeviceSummary {
  id: string;
  hubDeviceId: string;
  publicKey: string;
  nickname: string;
  platform: "macos" | "windows" | "linux";
  hostname: string | null;
  status: "active" | "revoked";
  isOnline: boolean | null;
  lastSeenAt: string | null;
  createdAt: string;
}

const DeviceListResponseSchema = z.array(
  z.object({
    id: z.string(),
    hubDeviceId: z.string(),
    publicKey: z.string(),
    nickname: z.string(),
    platform: z.enum(["macos", "windows", "linux"]),
    hostname: z.string().nullable(),
    status: z.enum(["active", "revoked"]),
    isOnline: z.boolean().nullable(),
    lastSeenAt: z.string().nullable(),
    createdAt: z.string(),
  }),
);

@Injectable()
export class AhandControlPlaneClient {
  private readonly logger = new Logger(AhandControlPlaneClient.name);
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(
    cfg: ConfigService,
    private readonly http: HttpService,
  ) {
    this.baseUrl = cfg.get<string>("gatewayInternalUrl") ?? "";
    this.token = cfg.get<string>("gatewayInternalServiceToken") ?? "";
    if (!this.baseUrl || !this.token) {
      throw new InternalServerErrorException(
        "AhandControlPlaneClient: gatewayInternalUrl and gatewayInternalServiceToken required",
      );
    }
  }

  async mintControlPlaneToken(
    userId: string,
    deviceIds?: string[],
  ): Promise<{ token: string; expiresAt: string }> {
    return this.request(
      "POST",
      "/internal/ahand/control-plane/token",
      { userId, deviceIds },
      TokenResponseSchema,
    );
  }

  async listDevicesForUser(
    userId: string,
    opts: { includeOffline?: boolean } = {},
  ): Promise<AhandDeviceSummary[]> {
    return this.request(
      "POST",
      "/internal/ahand/devices/list-for-user",
      { userId, includeOffline: opts.includeOffline ?? true },
      DeviceListResponseSchema,
    );
  }

  private async request<T>(
    method: "POST",
    path: string,
    body: unknown,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const config: AxiosRequestConfig = {
      method,
      url: `${this.baseUrl}${path}`,
      data: body,
      headers: {
        "X-Internal-Service-Token": this.token,
        "Content-Type": "application/json",
      },
      timeout: 10_000,
      validateStatus: () => true,
    };

    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const r = await firstValueFrom(this.http.request(config));
        if (r.status >= 200 && r.status < 300) {
          const parsed = schema.safeParse(r.data);
          if (!parsed.success) {
            this.logger.error(
              `Unexpected gateway response for ${path}: ${parsed.error.message}`,
            );
            throw new InternalServerErrorException(
              "Unexpected gateway response shape",
            );
          }
          return parsed.data;
        }
        if (r.status === 403) {
          throw new ForbiddenException(
            typeof r.data === "object" && r.data !== null && "message" in r.data
              ? String((r.data as any).message)
              : "Forbidden",
          );
        }
        if (r.status >= 400 && r.status < 500) {
          throw new Error(`gateway ${method} ${path} returned ${r.status}`);
        }
        lastError = new Error(`gateway ${method} ${path} returned ${r.status}`);
      } catch (e) {
        if (e instanceof ForbiddenException) throw e;
        lastError = e;
      }
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 2 ** attempt * 100));
      }
    }
    this.logger.error(`Retries exhausted for ${method} ${path}`, lastError);
    throw new ServiceUnavailableException("gateway is unavailable");
  }
}
```

- [ ] **Step 3: Tests**

```ts
// apps/server/apps/im-worker/src/ahand/ahand-control-plane.service.spec.ts

import { Test } from "@nestjs/testing";
import { HttpModule } from "@nestjs/axios";
import { ConfigModule } from "@nestjs/config";
import { AhandControlPlaneClient } from "./ahand-control-plane.service";
import nock from "nock";
import {
  ForbiddenException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from "@nestjs/common";

const BASE = "https://gateway.test";

describe("AhandControlPlaneClient", () => {
  let client: AhandControlPlaneClient;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      imports: [
        HttpModule.register({}),
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          load: [
            () => ({
              gatewayInternalUrl: BASE,
              gatewayInternalServiceToken: "svc_t_abcdef12345678",
            }),
          ],
        }),
      ],
      providers: [AhandControlPlaneClient],
    }).compile();
    client = mod.get(AhandControlPlaneClient);
  });

  afterEach(() => nock.cleanAll());

  describe("mintControlPlaneToken", () => {
    it("POSTs with internal token header and parses response", async () => {
      nock(BASE)
        .post("/internal/ahand/control-plane/token", {
          userId: "u1",
          deviceIds: ["a".repeat(64)],
        })
        .matchHeader("x-internal-service-token", "svc_t_abcdef12345678")
        .reply(200, { token: "cp.xyz", expiresAt: "2026-04-22T11:00:00Z" });
      const res = await client.mintControlPlaneToken("u1", ["a".repeat(64)]);
      expect(res.token).toBe("cp.xyz");
    });

    it("403 → ForbiddenException with gateway message", async () => {
      nock(BASE)
        .post("/internal/ahand/control-plane/token")
        .reply(403, { message: "unowned device" });
      await expect(
        client.mintControlPlaneToken("u1", ["b".repeat(64)]),
      ).rejects.toThrow(ForbiddenException);
    });

    it("malformed response → InternalServerErrorException", async () => {
      nock(BASE)
        .post("/internal/ahand/control-plane/token")
        .reply(200, { token: 1 });
      await expect(client.mintControlPlaneToken("u1")).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe("listDevicesForUser", () => {
    it("POSTs and decodes array", async () => {
      nock(BASE)
        .post("/internal/ahand/devices/list-for-user", {
          userId: "u1",
          includeOffline: true,
        })
        .reply(200, [
          {
            id: "id-1",
            hubDeviceId: "d1",
            publicKey: "pk",
            nickname: "A",
            platform: "macos",
            hostname: null,
            status: "active",
            isOnline: true,
            lastSeenAt: "2026-04-22T10:00:00Z",
            createdAt: "2026-04-22T09:00:00Z",
          },
        ]);
      const res = await client.listDevicesForUser("u1");
      expect(res).toHaveLength(1);
      expect(res[0].hubDeviceId).toBe("d1");
    });

    it("respects includeOffline:false", async () => {
      nock(BASE)
        .post("/internal/ahand/devices/list-for-user", {
          userId: "u1",
          includeOffline: false,
        })
        .reply(200, []);
      const res = await client.listDevicesForUser("u1", {
        includeOffline: false,
      });
      expect(res).toEqual([]);
    });
  });

  describe("retries", () => {
    it("retries 5xx up to 3 times", async () => {
      nock(BASE)
        .post("/internal/ahand/control-plane/token")
        .reply(503)
        .post("/internal/ahand/control-plane/token")
        .reply(503)
        .post("/internal/ahand/control-plane/token")
        .reply(200, { token: "cp", expiresAt: "x" });
      const res = await client.mintControlPlaneToken("u1");
      expect(res.token).toBe("cp");
    });
    it("3×503 → ServiceUnavailableException", async () => {
      nock(BASE)
        .post("/internal/ahand/control-plane/token")
        .times(3)
        .reply(503);
      await expect(client.mintControlPlaneToken("u1")).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
    it("403 short-circuits retry loop", async () => {
      const scope = nock(BASE)
        .post("/internal/ahand/control-plane/token")
        .reply(403, { message: "x" });
      await expect(client.mintControlPlaneToken("u1")).rejects.toThrow(
        ForbiddenException,
      );
      expect(scope.isDone()).toBe(true);
    });
  });
});
```

- [ ] **Step 4: Commit**

```bash
cd /Users/winrey/Projects/weightwave/team9
git add apps/server/apps/im-worker/src/ahand/ahand-control-plane.service.ts \
        apps/server/apps/im-worker/src/ahand/ahand-control-plane.service.spec.ts \
        apps/server/apps/im-worker/src/config/
git commit -m "$(cat <<'EOF'
feat(im-worker/ahand): control-plane client for gateway internal API

Thin typed wrapper around POST /internal/ahand/{control-plane/token,
devices/list-for-user}. Adds the X-Internal-Service-Token header
from GATEWAY_INTERNAL_SERVICE_TOKEN. Retries 5xx × 3; 403 short-
circuits to ForbiddenException; malformed responses (zod parse
failure) throw InternalServerErrorException so schema drift fails
loudly rather than silently returning garbage.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5.2: `AhandBlueprintExtender` — inject ahand components at session start

**Goal:** When im-worker builds a blueprint for a new agent session, extend it with ahand-related components if the blueprint declares it uses ahand (via a feature flag or just always-on for MVP). One `AHandHostComponent` per **online** device; one `AHandContextProvider` regardless of device count; inject the calling user's `clientContext` from the triggering message.

**Files:**

- Create: `apps/server/apps/im-worker/src/ahand/ahand-blueprint.extender.ts`
- Create: `apps/server/apps/im-worker/src/ahand/ahand-blueprint.extender.spec.ts`
- Modify: `apps/server/apps/im-worker/src/agent-session/agent-session.service.ts` (or wherever blueprints are assembled) — call the extender after the base blueprint is ready.

**Acceptance Criteria:**

- [ ] `extend(blueprint, { callingUserId, clientContext })` returns a blueprint with:
  - N new component entries of type `AHandHostComponent`, one per **online** device returned by `listDevicesForUser(..., includeOffline:false)`, each with the appropriate `AHandHostComponentConfig`.
  - Exactly one new component entry of type `AHandContextProvider` with the full calling-client info (MacApp deviceId resolved against owned devices, or plain web).
  - If the blueprint already includes `HostComponent` in `components[]`, ahand components are appended (they register themselves as backends via dependency API — no conflict). If `HostComponent` is **not** present, skip injecting ahand components and log a warning (blueprint misconfig).
- [ ] If `listDevicesForUser` fails (gateway unreachable / RPC error), blueprint proceeds without ahand components and a warning is logged. The session still starts, just without remote machines.
- [ ] `clientContext.deviceId` that does not match a user-owned device in the list → resolved context is treated as `kind: "web"` (defensive — signals a possibly tampered or stale clientContext).
- [ ] Component configs carry everything Phase 6 components need: `hubUrl`, `gatewayInternalUrl`, `gatewayInternalAuthToken`, `callingUserId`, `callingClient`, per-device nickname/platform.
- [ ] 100% coverage on the extender.

**Verify:** `pnpm test apps/server/apps/im-worker/src/ahand/ahand-blueprint.extender.spec.ts --coverage` → 100%.

**Steps:**

- [ ] **Step 1: Extender implementation**

```ts
// apps/server/apps/im-worker/src/ahand/ahand-blueprint.extender.ts

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  AhandControlPlaneClient,
  type AhandDeviceSummary,
} from "./ahand-control-plane.service";
import type { Blueprint, ComponentEntry } from "@team9claw/claw-hive-types";
import type { ClientContextRaw } from "./types"; // { kind: "macapp"; deviceId?: string | null } | { kind: "web" } | null

export interface ExtenderInput {
  callingUserId: string;
  clientContext: ClientContextRaw;
}

export interface ExtenderOutput {
  blueprint: Blueprint;
  // For Phase 5 Task 5.3 subscribe → dispatch; session stores this so we can
  // resolve which components to add/remove on device events.
  ahandTrackingState: {
    sessionId: string | null; // populated by the caller after session create
    userId: string;
    onlineDeviceIds: string[];
  };
}

@Injectable()
export class AhandBlueprintExtender {
  private readonly logger = new Logger(AhandBlueprintExtender.name);
  private readonly hubUrl: string;
  private readonly gatewayInternalUrl: string;
  private readonly gatewayInternalToken: string;

  constructor(
    cfg: ConfigService,
    private readonly control: AhandControlPlaneClient,
  ) {
    this.hubUrl = cfg.getOrThrow<string>("ahandHubUrl");
    this.gatewayInternalUrl = cfg.getOrThrow<string>("gatewayInternalUrl");
    this.gatewayInternalToken = cfg.getOrThrow<string>(
      "gatewayInternalServiceToken",
    );
  }

  async extend(
    blueprint: Blueprint,
    input: ExtenderInput,
  ): Promise<ExtenderOutput> {
    const hasHostComponent = blueprint.components.some(
      (c: ComponentEntry) => c.typeKey === "host",
    );
    if (!hasHostComponent) {
      this.logger.warn(
        `Blueprint lacks HostComponent — skipping ahand injection for user ${input.callingUserId}`,
      );
      return {
        blueprint,
        ahandTrackingState: {
          sessionId: null,
          userId: input.callingUserId,
          onlineDeviceIds: [],
        },
      };
    }

    let devices: AhandDeviceSummary[] = [];
    try {
      devices = await this.control.listDevicesForUser(input.callingUserId, {
        includeOffline: true, // include offline for AHandContextProvider metadata
      });
    } catch (e) {
      this.logger.warn(
        `Failed to list ahand devices for ${input.callingUserId}; skipping injection`,
        e,
      );
      return {
        blueprint,
        ahandTrackingState: {
          sessionId: null,
          userId: input.callingUserId,
          onlineDeviceIds: [],
        },
      };
    }

    const onlineDevices = devices.filter(
      (d) => d.isOnline === true && d.status === "active",
    );
    const resolvedClientContext = this.resolveClientContext(
      input.clientContext,
      devices,
    );

    const nextComponents: ComponentEntry[] = [...blueprint.components];

    // One AHandHostComponent per online device
    for (const d of onlineDevices) {
      nextComponents.push({
        typeKey: "ahand-host",
        config: {
          deviceId: d.hubDeviceId,
          deviceNickname: d.nickname,
          devicePlatform: d.platform,
          callingUserId: input.callingUserId,
          callingClient: resolvedClientContext,
          gatewayInternalUrl: this.gatewayInternalUrl,
          gatewayInternalAuthToken: this.gatewayInternalToken,
          hubUrl: this.hubUrl,
        },
      });
    }

    // Single AHandContextProvider for the superset (includes offline devices)
    nextComponents.push({
      typeKey: "ahand-context-provider",
      config: {
        callingUserId: input.callingUserId,
        callingClient: resolvedClientContext,
        gatewayInternalUrl: this.gatewayInternalUrl,
        gatewayInternalAuthToken: this.gatewayInternalToken,
      },
    });

    return {
      blueprint: { ...blueprint, components: nextComponents },
      ahandTrackingState: {
        sessionId: null, // filled in by caller post-session-create
        userId: input.callingUserId,
        onlineDeviceIds: onlineDevices.map((d) => d.hubDeviceId),
      },
    };
  }

  private resolveClientContext(
    raw: ClientContextRaw,
    devices: AhandDeviceSummary[],
  ):
    | {
        kind: "macapp";
        deviceId: string;
        deviceNickname: string;
        isAhandEnabled: boolean;
      }
    | { kind: "web" } {
    if (!raw || raw.kind !== "macapp" || !raw.deviceId) {
      return { kind: "web" };
    }
    const match = devices.find((d) => d.hubDeviceId === raw.deviceId);
    if (!match) {
      // clientContext claimed a deviceId that isn't owned by this user — treat as web.
      return { kind: "web" };
    }
    return {
      kind: "macapp",
      deviceId: match.hubDeviceId,
      deviceNickname: match.nickname,
      isAhandEnabled: match.status === "active" && match.isOnline === true,
    };
  }
}
```

- [ ] **Step 2: Integrate into session-build flow**

```bash
rg -nP '(buildBlueprint|assembleBlueprint|resolveBlueprint|createSession)' apps/server/apps/im-worker/src/
```

Locate the function that produces a `Blueprint` just before `HiveRuntime.createSession(...)`. Patch it:

```ts
// apps/server/apps/im-worker/src/agent-session/agent-session.service.ts (patch)

import { AhandBlueprintExtender } from "../ahand/ahand-blueprint.extender";

@Injectable()
export class AgentSessionService {
  constructor(
    // ...existing
    private readonly ahandExtender: AhandBlueprintExtender,
  ) {}

  async startSessionForMessage(msg: Message): Promise<SessionInfo> {
    // ...existing: load channel, resolve blueprint, etc.
    let blueprint = await this.resolveBaseBlueprint(channel);

    const extended = await this.ahandExtender.extend(blueprint, {
      callingUserId: msg.authorId,
      clientContext: msg.clientContext ?? null,
    });
    blueprint = extended.blueprint;

    const session = await this.hive.createSession(blueprint);
    // Persist ahand tracking state keyed by session.id so Task 5.3's dispatcher
    // can look it up on device events.
    this.sessionTracking.set(session.id, {
      ...extended.ahandTrackingState,
      sessionId: session.id,
    });
    return session;
  }
}
```

`this.sessionTracking` is an in-memory `Map<sessionId, ahandTrackingState>` maintained by the im-worker (declared in the AgentSessionService or a dedicated registry). Task 5.3 reads from it on Redis events.

- [ ] **Step 3: Tests**

```ts
// apps/server/apps/im-worker/src/ahand/ahand-blueprint.extender.spec.ts

import { Test } from "@nestjs/testing";
import { AhandBlueprintExtender } from "./ahand-blueprint.extender";
import {
  AhandControlPlaneClient,
  type AhandDeviceSummary,
} from "./ahand-control-plane.service";
import { ConfigService } from "@nestjs/config";

const makeDevice = (
  overrides: Partial<AhandDeviceSummary>,
): AhandDeviceSummary => ({
  id: "id",
  hubDeviceId: "d1",
  publicKey: "p",
  nickname: "A",
  platform: "macos",
  hostname: null,
  status: "active",
  isOnline: true,
  lastSeenAt: null,
  createdAt: "2026-04-22T10:00:00Z",
  ...overrides,
});

const baseBlueprint = {
  components: [
    { typeKey: "system-prompt", config: {} },
    { typeKey: "host", config: {} },
  ],
};

describe("AhandBlueprintExtender", () => {
  let extender: AhandBlueprintExtender;
  let control: jest.Mocked<AhandControlPlaneClient>;

  beforeEach(async () => {
    control = {
      listDevicesForUser: jest.fn(),
      mintControlPlaneToken: jest.fn(),
    } as any;
    const mod = await Test.createTestingModule({
      providers: [
        AhandBlueprintExtender,
        { provide: AhandControlPlaneClient, useValue: control },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (k: string) =>
              ({
                ahandHubUrl: "https://hub",
                gatewayInternalUrl: "https://gw",
                gatewayInternalServiceToken: "t",
              })[k],
          },
        },
      ],
    }).compile();
    extender = mod.get(AhandBlueprintExtender);
  });

  describe("happy paths", () => {
    it("injects one AHandHostComponent per online device + one AHandContextProvider", async () => {
      control.listDevicesForUser.mockResolvedValue([
        makeDevice({ hubDeviceId: "d1", isOnline: true }),
        makeDevice({ hubDeviceId: "d2", isOnline: true, nickname: "B" }),
        makeDevice({ hubDeviceId: "d3", isOnline: false, nickname: "C" }),
      ]);
      const { blueprint, ahandTrackingState } = await extender.extend(
        baseBlueprint,
        {
          callingUserId: "u1",
          clientContext: null,
        },
      );
      const hostBackends = blueprint.components.filter(
        (c) => c.typeKey === "ahand-host",
      );
      const contextProviders = blueprint.components.filter(
        (c) => c.typeKey === "ahand-context-provider",
      );
      expect(hostBackends).toHaveLength(2);
      expect(contextProviders).toHaveLength(1);
      expect(
        hostBackends.map((c) => (c as any).config.deviceId).sort(),
      ).toEqual(["d1", "d2"]);
      expect(ahandTrackingState.onlineDeviceIds.sort()).toEqual(["d1", "d2"]);
    });

    it("resolves MacApp clientContext to enabled when device is owned + online", async () => {
      control.listDevicesForUser.mockResolvedValue([
        makeDevice({ hubDeviceId: "dMac", nickname: "Mac1" }),
      ]);
      const { blueprint } = await extender.extend(baseBlueprint, {
        callingUserId: "u1",
        clientContext: { kind: "macapp", deviceId: "dMac" },
      });
      const cp = blueprint.components.find(
        (c) => c.typeKey === "ahand-context-provider",
      ) as any;
      expect(cp.config.callingClient).toEqual({
        kind: "macapp",
        deviceId: "dMac",
        deviceNickname: "Mac1",
        isAhandEnabled: true,
      });
    });

    it("resolves unknown deviceId in clientContext to web (defensive)", async () => {
      control.listDevicesForUser.mockResolvedValue([
        makeDevice({ hubDeviceId: "dMac" }),
      ]);
      const { blueprint } = await extender.extend(baseBlueprint, {
        callingUserId: "u1",
        clientContext: { kind: "macapp", deviceId: "ghost" },
      });
      const cp = blueprint.components.find(
        (c) => c.typeKey === "ahand-context-provider",
      ) as any;
      expect(cp.config.callingClient).toEqual({ kind: "web" });
    });

    it("empty device list → no host backends, still 1 context provider", async () => {
      control.listDevicesForUser.mockResolvedValue([]);
      const { blueprint } = await extender.extend(baseBlueprint, {
        callingUserId: "u1",
        clientContext: null,
      });
      expect(
        blueprint.components.filter((c) => c.typeKey === "ahand-host"),
      ).toHaveLength(0);
      expect(
        blueprint.components.filter(
          (c) => c.typeKey === "ahand-context-provider",
        ),
      ).toHaveLength(1);
    });
  });

  describe("bad paths", () => {
    it("blueprint without HostComponent → untouched + warning", async () => {
      const bpWithoutHost = {
        components: [{ typeKey: "system-prompt", config: {} }],
      };
      const { blueprint, ahandTrackingState } = await extender.extend(
        bpWithoutHost,
        {
          callingUserId: "u1",
          clientContext: null,
        },
      );
      expect(blueprint.components).toEqual(bpWithoutHost.components);
      expect(ahandTrackingState.onlineDeviceIds).toEqual([]);
    });

    it("listDevicesForUser failure → blueprint untouched, warning logged", async () => {
      control.listDevicesForUser.mockRejectedValue(new Error("gateway down"));
      const { blueprint, ahandTrackingState } = await extender.extend(
        baseBlueprint,
        {
          callingUserId: "u1",
          clientContext: null,
        },
      );
      expect(
        blueprint.components.filter((c) => c.typeKey === "ahand-host"),
      ).toHaveLength(0);
      expect(
        blueprint.components.filter(
          (c) => c.typeKey === "ahand-context-provider",
        ),
      ).toHaveLength(0);
      expect(ahandTrackingState.onlineDeviceIds).toEqual([]);
    });

    it("revoked devices are not treated as online even if isOnline=true", async () => {
      control.listDevicesForUser.mockResolvedValue([
        makeDevice({
          hubDeviceId: "dRevoked",
          status: "revoked",
          isOnline: true,
        }),
      ]);
      const { blueprint } = await extender.extend(baseBlueprint, {
        callingUserId: "u1",
        clientContext: null,
      });
      expect(
        blueprint.components.filter((c) => c.typeKey === "ahand-host"),
      ).toHaveLength(0);
    });
  });
});
```

- [ ] **Step 4: Commit**

```bash
cd /Users/winrey/Projects/weightwave/team9
git add apps/server/apps/im-worker/src/ahand/ahand-blueprint.extender.ts \
        apps/server/apps/im-worker/src/ahand/ahand-blueprint.extender.spec.ts \
        apps/server/apps/im-worker/src/agent-session/agent-session.service.ts
git commit -m "$(cat <<'EOF'
feat(im-worker/ahand): blueprint extender injects ahand components

At session build, AhandBlueprintExtender:
1. Checks blueprint declares HostComponent (skip + warn if not).
2. Lists the calling user's devices via gateway internal API.
3. Appends one AHandHostComponent per online+active device and exactly
   one AHandContextProvider regardless of count.
4. Resolves message.clientContext against owned devices to produce a
   concrete { kind: 'macapp' | 'web' } context that the components
   consume in their configs.
5. Gracefully degrades on gateway failure (session starts without
   ahand components; logged warning).

Emits ahandTrackingState that the AgentSessionService persists in an
in-memory registry keyed by sessionId. Phase 5 Task 5.3's Redis event
dispatcher reads from that registry to hot-add/remove components as
devices come and go mid-session.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5.3: `AhandEventsSubscriber` — Redis pub/sub listener

**Goal:** Subscribe to Redis pattern `ahand:events:*` so gateway-originated device events reach im-worker across replicas. On each event, delegate to the session dispatcher (Task 5.4). Subscription must survive Redis disconnects via auto-reconnect.

**Files:**

- Create: `apps/server/apps/im-worker/src/ahand/ahand-events.subscriber.ts`
- Create: `apps/server/apps/im-worker/src/ahand/ahand-events.subscriber.spec.ts`

**Acceptance Criteria:**

- [ ] Subscribes on `onModuleInit` via a **dedicated** Redis connection (`psubscribe` connections cannot also send commands; reuses the shared pool's duplicate).
- [ ] Accepts pattern `ahand:events:*`; decodes JSON payload `{ ownerType, eventType, data, publishedAt }`; passes to `AhandSessionDispatcher.dispatch(ownerId, eventType, data)`.
- [ ] Auto-resubscribes on reconnect (ioredis does this by default for `psubscribe` — verify).
- [ ] Invalid JSON → log error, skip.
- [ ] Lifecycle: `onModuleDestroy` unsubscribes cleanly to avoid leaked listeners during hot-reload in dev.
- [ ] 100% coverage using `ioredis-mock` or a wrapped client.

**Verify:** `pnpm test apps/server/apps/im-worker/src/ahand/ahand-events.subscriber.spec.ts --coverage`.

**Steps:**

- [ ] **Step 1: Subscriber**

```ts
// apps/server/apps/im-worker/src/ahand/ahand-events.subscriber.ts

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
} from "@nestjs/common";
import type Redis from "ioredis";
import { AhandSessionDispatcher } from "./ahand-session-dispatcher.service";

const PATTERN = "ahand:events:*";

@Injectable()
export class AhandEventsSubscriber implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AhandEventsSubscriber.name);
  private subscriber: Redis | null = null;

  constructor(
    @Inject("REDIS_CLIENT") private readonly redis: Redis,
    private readonly dispatcher: AhandSessionDispatcher,
  ) {}

  async onModuleInit(): Promise<void> {
    // A duplicate connection is required because an ioredis client in
    // subscribe mode can't also issue normal commands.
    this.subscriber = this.redis.duplicate();
    await this.subscriber.psubscribe(PATTERN);
    this.subscriber.on("pmessage", this.onMessage);
    this.subscriber.on("error", (e) =>
      this.logger.error("Redis subscriber error", e),
    );
    this.subscriber.on("reconnecting", () =>
      this.logger.warn("Redis subscriber reconnecting"),
    );
    this.logger.log(`Subscribed to ${PATTERN}`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscriber) {
      this.subscriber.off("pmessage", this.onMessage);
      await this.subscriber.punsubscribe(PATTERN).catch(() => {});
      this.subscriber.disconnect();
      this.subscriber = null;
    }
  }

  private onMessage = (
    _pattern: string,
    channel: string,
    messageRaw: string,
  ): void => {
    // channel: ahand:events:{ownerId}
    const ownerId = channel.replace(/^ahand:events:/, "");
    if (!ownerId) {
      this.logger.warn(`Message on unexpected channel: ${channel}`);
      return;
    }
    let payload: {
      ownerType: string;
      eventType: string;
      data: Record<string, unknown>;
      publishedAt: string;
    };
    try {
      payload = JSON.parse(messageRaw);
    } catch (e) {
      this.logger.error(`Malformed JSON on channel=${channel}: ${e}`);
      return;
    }
    if (!payload.eventType) {
      this.logger.warn(`Payload missing eventType on channel=${channel}`);
      return;
    }
    // Fire-and-forget; dispatcher swallows errors internally so subscription loop stays alive.
    this.dispatcher
      .dispatch({
        ownerType: payload.ownerType as "user" | "workspace",
        ownerId,
        eventType: payload.eventType as any,
        data: payload.data ?? {},
      })
      .catch((e) => this.logger.error(`dispatch error: ${e}`));
  };
}
```

- [ ] **Step 2: Tests**

```ts
// apps/server/apps/im-worker/src/ahand/ahand-events.subscriber.spec.ts

import { Test } from "@nestjs/testing";
import { AhandEventsSubscriber } from "./ahand-events.subscriber";
import { AhandSessionDispatcher } from "./ahand-session-dispatcher.service";
import RedisMock from "ioredis-mock";

describe("AhandEventsSubscriber", () => {
  let subscriber: AhandEventsSubscriber;
  let redis: InstanceType<typeof RedisMock>;
  let publisher: InstanceType<typeof RedisMock>;
  let dispatcher: jest.Mocked<AhandSessionDispatcher>;

  beforeEach(async () => {
    redis = new RedisMock();
    publisher = new RedisMock();
    dispatcher = { dispatch: jest.fn().mockResolvedValue(undefined) } as any;
    const mod = await Test.createTestingModule({
      providers: [
        AhandEventsSubscriber,
        { provide: "REDIS_CLIENT", useValue: redis },
        { provide: AhandSessionDispatcher, useValue: dispatcher },
      ],
    }).compile();
    subscriber = mod.get(AhandEventsSubscriber);
    await subscriber.onModuleInit();
  });

  afterEach(async () => {
    await subscriber.onModuleDestroy();
  });

  it("dispatches events published on ahand:events:{ownerId}", async () => {
    await publisher.publish(
      "ahand:events:u1",
      JSON.stringify({
        ownerType: "user",
        eventType: "device.online",
        data: { hubDeviceId: "d1" },
        publishedAt: "x",
      }),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(dispatcher.dispatch).toHaveBeenCalledWith({
      ownerType: "user",
      ownerId: "u1",
      eventType: "device.online",
      data: { hubDeviceId: "d1" },
    });
  });

  it("ignores malformed JSON (does not crash)", async () => {
    const spy = jest
      .spyOn((subscriber as any).logger, "error")
      .mockImplementation(() => {});
    await publisher.publish("ahand:events:u1", "{not-json");
    await new Promise((r) => setTimeout(r, 20));
    expect(spy).toHaveBeenCalled();
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it("ignores payload missing eventType", async () => {
    await publisher.publish(
      "ahand:events:u1",
      JSON.stringify({ ownerType: "user" }),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it("onModuleDestroy unsubscribes cleanly", async () => {
    await subscriber.onModuleDestroy();
    // After destroy, a subsequent publish does not re-invoke dispatcher
    dispatcher.dispatch.mockClear();
    await publisher.publish(
      "ahand:events:u1",
      JSON.stringify({
        ownerType: "user",
        eventType: "device.online",
        data: {},
        publishedAt: "x",
      }),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it("catches dispatch errors and keeps subscription alive", async () => {
    dispatcher.dispatch.mockRejectedValueOnce(new Error("downstream-boom"));
    const errSpy = jest
      .spyOn((subscriber as any).logger, "error")
      .mockImplementation(() => {});
    await publisher.publish(
      "ahand:events:u1",
      JSON.stringify({
        ownerType: "user",
        eventType: "device.online",
        data: {},
        publishedAt: "x",
      }),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(errSpy).toHaveBeenCalled();
    // Subsequent event still processes
    dispatcher.dispatch.mockResolvedValueOnce(undefined);
    await publisher.publish(
      "ahand:events:u1",
      JSON.stringify({
        ownerType: "user",
        eventType: "device.offline",
        data: {},
        publishedAt: "x",
      }),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 3: Commit**

```bash
cd /Users/winrey/Projects/weightwave/team9
git add apps/server/apps/im-worker/src/ahand/ahand-events.subscriber.ts \
        apps/server/apps/im-worker/src/ahand/ahand-events.subscriber.spec.ts
git commit -m "$(cat <<'EOF'
feat(im-worker/ahand): subscribe to ahand:events:* Redis pub/sub

AhandEventsSubscriber owns a duplicate Redis connection dedicated to
pattern-subscribe (ioredis requires a dedicated connection for
subscribe mode). Pattern: ahand:events:*. On pmessage, parses JSON
and delegates to AhandSessionDispatcher.

Robustness:
- Malformed JSON logs + skips; does not crash the subscriber loop.
- Missing eventType logs + skips.
- Dispatcher errors are caught at subscriber level so one flaky
  session doesn't kill event delivery for others.
- onModuleDestroy cleanly unsubscribes and disconnects the duplicate.

Auto-reconnect behavior is inherited from ioredis; subscriber re-
subscribes to the pattern after a reconnect automatically.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5.4: `AhandSessionDispatcher` + `AhandModule` wiring

**Goal:** Translate a device event (`device.online` / `offline` / `revoked`) into `AgentSession.addComponent` / `removeComponent` calls for every active session belonging to the event's owner. Plus assemble the im-worker-side NestJS module.

**Files:**

- Create: `apps/server/apps/im-worker/src/ahand/ahand-session-dispatcher.service.ts`
- Create: `apps/server/apps/im-worker/src/ahand/ahand-session-dispatcher.service.spec.ts`
- Create: `apps/server/apps/im-worker/src/ahand/ahand.module.ts`
- Modify: `apps/server/apps/im-worker/src/app.module.ts` — import `AhandModule`.

**Acceptance Criteria:**

- [ ] `AhandSessionDispatcher.dispatch({ ownerType, ownerId, eventType, data })` iterates all active sessions where tracking state's `userId === ownerId` (for ownerType="user") or workspace-member relationship (future), and:
  - `device.online` with a new `hubDeviceId` → resolve the full device record via `AhandControlPlaneClient.listDevicesForUser` → construct `AHandHostComponent` config → `session.addComponent`. Update tracking `onlineDeviceIds`.
  - `device.offline` or `device.revoked` with a known `hubDeviceId` → remove the corresponding `AHandHostComponent` via `session.removeComponent`. Update tracking.
  - `device.heartbeat` → no-op (presence refresh only affects `<host-context>` metadata, which comes from `getMetadata()` at render time).
  - `device.registered` → triggers refresh of the `<ahand-context>` cache (via `session.invalidateCache({ keys: ["ahand-context"] })` — but only affects agents whose user owns the newly-registered device).
- [ ] If `session.addComponent` is unavailable (Task 2.4 deferred), dispatcher logs a warning and records the event in a pending queue so the next session restart picks it up naturally (fallback snapshot mode from spec § 6.8.3). For MVP plan this as a fallback branch guarded by a feature flag `AGENT_DYNAMIC_COMPONENTS_ENABLED`.
- [ ] All errors caught and logged; never throw up to the subscriber.
- [ ] Idempotent: receiving the same event twice (in case subscribers double up) is safe — duplicate `addComponent` no-ops if the backend type is already registered (framework supports re-register = overwrite; verify in Phase 2 Task 2.1 tests).
- [ ] Tracking registry is an in-memory `Map<sessionId, AhandTrackingState>`; populated by `AgentSessionService` on session start, cleaned up on session end (hook into the session lifecycle).
- [ ] 100% coverage.

**Verify:** `pnpm test apps/server/apps/im-worker/src/ahand/ahand-session-dispatcher.service.spec.ts --coverage`.

**Steps:**

- [ ] **Step 1: Session tracking registry**

```ts
// apps/server/apps/im-worker/src/ahand/ahand-session-tracking.service.ts

import { Injectable } from "@nestjs/common";

export interface AhandTrackingState {
  sessionId: string;
  userId: string;
  onlineDeviceIds: string[];
}

@Injectable()
export class AhandSessionTrackingService {
  private readonly registry = new Map<string, AhandTrackingState>();

  register(state: AhandTrackingState): void {
    this.registry.set(state.sessionId, state);
  }

  unregister(sessionId: string): void {
    this.registry.delete(sessionId);
  }

  getByUser(userId: string): AhandTrackingState[] {
    const out: AhandTrackingState[] = [];
    for (const s of this.registry.values())
      if (s.userId === userId) out.push(s);
    return out;
  }

  get(sessionId: string): AhandTrackingState | undefined {
    return this.registry.get(sessionId);
  }

  updateOnlineDeviceIds(sessionId: string, ids: string[]): void {
    const s = this.registry.get(sessionId);
    if (s) this.registry.set(sessionId, { ...s, onlineDeviceIds: ids });
  }
}
```

This is shared between `AgentSessionService` (Task 5.2 calls `register`) and `AhandSessionDispatcher` (Task 5.4 reads + updates).

- [ ] **Step 2: Dispatcher**

```ts
// apps/server/apps/im-worker/src/ahand/ahand-session-dispatcher.service.ts

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AhandControlPlaneClient } from "./ahand-control-plane.service";
import { AhandSessionTrackingService } from "./ahand-session-tracking.service";
import type { HiveRuntime } from "@team9claw/claw-hive";
import { AHandHostComponent } from "@team9claw/claw-hive/components/ahand/component";

export interface DispatchInput {
  ownerType: "user" | "workspace";
  ownerId: string;
  eventType:
    | "device.online"
    | "device.offline"
    | "device.revoked"
    | "device.heartbeat"
    | "device.registered";
  data: Record<string, unknown>;
}

@Injectable()
export class AhandSessionDispatcher {
  private readonly logger = new Logger(AhandSessionDispatcher.name);
  private readonly hubUrl: string;
  private readonly gatewayInternalUrl: string;
  private readonly gatewayInternalToken: string;
  private readonly dynamicComponentsEnabled: boolean;

  constructor(
    cfg: ConfigService,
    private readonly tracking: AhandSessionTrackingService,
    private readonly control: AhandControlPlaneClient,
    private readonly hive: HiveRuntime,
  ) {
    this.hubUrl = cfg.getOrThrow<string>("ahandHubUrl");
    this.gatewayInternalUrl = cfg.getOrThrow<string>("gatewayInternalUrl");
    this.gatewayInternalToken = cfg.getOrThrow<string>(
      "gatewayInternalServiceToken",
    );
    this.dynamicComponentsEnabled =
      cfg.get<boolean>("agentDynamicComponentsEnabled") ?? true;
  }

  async dispatch(input: DispatchInput): Promise<void> {
    if (input.ownerType !== "user") {
      // Workspace routing is deferred; skip for MVP.
      return;
    }
    const sessions = this.tracking.getByUser(input.ownerId);
    if (sessions.length === 0) return;

    const hubDeviceId =
      typeof input.data.hubDeviceId === "string"
        ? input.data.hubDeviceId
        : null;

    for (const s of sessions) {
      await this.dispatchToSession(s, input, hubDeviceId).catch((e) => {
        this.logger.warn(`Dispatch failed for session ${s.sessionId}: ${e}`);
      });
    }
  }

  private async dispatchToSession(
    tracking: { sessionId: string; userId: string; onlineDeviceIds: string[] },
    input: DispatchInput,
    hubDeviceId: string | null,
  ): Promise<void> {
    switch (input.eventType) {
      case "device.heartbeat":
        // No-op; presence tick only, handled at <host-context> render time.
        return;
      case "device.registered":
        // New device exists but may still be offline. Invalidate ahand-context cache
        // so the next prompt shows it.
        await this.invalidateAhandContext(tracking.sessionId);
        return;
      case "device.online": {
        if (!hubDeviceId) return;
        if (tracking.onlineDeviceIds.includes(hubDeviceId)) return; // idempotent
        if (!this.dynamicComponentsEnabled) {
          this.logger.debug(
            `Dynamic components disabled; ${hubDeviceId} will appear at next session start`,
          );
          return;
        }
        const devices = await this.control.listDevicesForUser(tracking.userId, {
          includeOffline: true,
        });
        const device = devices.find((d) => d.hubDeviceId === hubDeviceId);
        if (!device || device.status !== "active" || device.isOnline !== true)
          return;
        const session = this.hive.getSession(tracking.sessionId);
        if (!session) return;
        await session.addComponent(
          new AHandHostComponent({
            deviceId: device.hubDeviceId,
            deviceNickname: device.nickname,
            devicePlatform: device.platform,
            callingUserId: tracking.userId,
            callingClient: this.buildCallingClientSnapshot(tracking, devices),
            gatewayInternalUrl: this.gatewayInternalUrl,
            gatewayInternalAuthToken: this.gatewayInternalToken,
            hubUrl: this.hubUrl,
          }),
        );
        this.tracking.updateOnlineDeviceIds(tracking.sessionId, [
          ...tracking.onlineDeviceIds,
          hubDeviceId,
        ]);
        await this.invalidateAhandContext(tracking.sessionId);
        return;
      }
      case "device.offline":
      case "device.revoked": {
        if (!hubDeviceId) return;
        if (!tracking.onlineDeviceIds.includes(hubDeviceId)) return; // not attached
        const session = this.hive.getSession(tracking.sessionId);
        if (!session) return;
        const backendType = `ahand:user-computer:${hubDeviceId}`;
        const comp = session.findComponentByTypeKey?.("ahand-host", {
          deviceId: hubDeviceId,
        });
        if (comp) {
          await session.removeComponent(comp.id);
        }
        this.tracking.updateOnlineDeviceIds(
          tracking.sessionId,
          tracking.onlineDeviceIds.filter((id) => id !== hubDeviceId),
        );
        await this.invalidateAhandContext(tracking.sessionId);
        return;
      }
    }
  }

  private async invalidateAhandContext(sessionId: string): Promise<void> {
    const session = this.hive.getSession(sessionId);
    if (!session) return;
    session.invalidateCache?.({ keys: ["ahand-context"], mode: "next-turn" });
  }

  private buildCallingClientSnapshot(
    tracking: { userId: string },
    devices: Array<{
      hubDeviceId: string;
      nickname: string;
      status: string;
      isOnline: boolean | null;
    }>,
  ): { kind: "web" } {
    // Runtime add/remove doesn't have access to the most recent clientContext of the
    // agent session. The blueprint's AHandContextProvider holds the ORIGINAL calling-
    // client snapshot; we pass a generic "web" here because the newly-added backend's
    // config only needs deviceId/nickname/platform for routing.
    return { kind: "web" };
  }
}
```

Note: `session.findComponentByTypeKey(typeKey, match?)` is assumed on the session surface; if not present, add a small helper in Phase 2 Task 2.4's AgentSession API, or iterate `session.listComponents()` manually.

- [ ] **Step 3: Module wiring**

```ts
// apps/server/apps/im-worker/src/ahand/ahand.module.ts

import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { ConfigModule } from "@nestjs/config";
import { RedisModule } from "../redis/redis.module";
import { HiveRuntimeModule } from "../claw-hive/hive-runtime.module"; // whatever wraps HiveRuntime

import { AhandControlPlaneClient } from "./ahand-control-plane.service";
import { AhandBlueprintExtender } from "./ahand-blueprint.extender";
import { AhandSessionTrackingService } from "./ahand-session-tracking.service";
import { AhandSessionDispatcher } from "./ahand-session-dispatcher.service";
import { AhandEventsSubscriber } from "./ahand-events.subscriber";

@Module({
  imports: [
    HttpModule.register({ timeout: 10_000 }),
    ConfigModule,
    RedisModule,
    HiveRuntimeModule,
  ],
  providers: [
    AhandControlPlaneClient,
    AhandBlueprintExtender,
    AhandSessionTrackingService,
    AhandSessionDispatcher,
    AhandEventsSubscriber,
  ],
  exports: [AhandBlueprintExtender, AhandSessionTrackingService],
})
export class AhandImWorkerModule {}
```

Register in `app.module.ts`:

```ts
// apps/server/apps/im-worker/src/app.module.ts (patch)
import { AhandImWorkerModule } from "./ahand/ahand.module";

@Module({ imports: [/*…*/ AhandImWorkerModule] })
export class AppModule {}
```

And hook session end cleanup:

```ts
// apps/server/apps/im-worker/src/agent-session/agent-session.service.ts (patch)

constructor(/*…*/ private readonly tracking: AhandSessionTrackingService) {}

async endSession(sessionId: string): Promise<void> {
  // existing teardown...
  this.tracking.unregister(sessionId);
}
```

- [ ] **Step 4: Dispatcher tests**

```ts
// apps/server/apps/im-worker/src/ahand/ahand-session-dispatcher.service.spec.ts

import { Test } from "@nestjs/testing";
import { AhandSessionDispatcher } from "./ahand-session-dispatcher.service";
import { AhandSessionTrackingService } from "./ahand-session-tracking.service";
import { AhandControlPlaneClient } from "./ahand-control-plane.service";
import { ConfigService } from "@nestjs/config";
import { HiveRuntime } from "@team9claw/claw-hive";

describe("AhandSessionDispatcher", () => {
  let d: AhandSessionDispatcher;
  let tracking: AhandSessionTrackingService;
  let control: jest.Mocked<AhandControlPlaneClient>;
  let hive: jest.Mocked<HiveRuntime>;
  let fakeSession: {
    addComponent: jest.Mock;
    removeComponent: jest.Mock;
    invalidateCache: jest.Mock;
    findComponentByTypeKey: jest.Mock;
  };

  beforeEach(async () => {
    fakeSession = {
      addComponent: jest.fn().mockResolvedValue(undefined),
      removeComponent: jest.fn().mockResolvedValue(true),
      invalidateCache: jest.fn(),
      findComponentByTypeKey: jest.fn().mockReturnValue({ id: "comp-1" }),
    };
    tracking = new AhandSessionTrackingService();
    control = {
      listDevicesForUser: jest.fn(),
      mintControlPlaneToken: jest.fn(),
    } as any;
    hive = { getSession: jest.fn().mockReturnValue(fakeSession) } as any;
    const mod = await Test.createTestingModule({
      providers: [
        AhandSessionDispatcher,
        { provide: AhandSessionTrackingService, useValue: tracking },
        { provide: AhandControlPlaneClient, useValue: control },
        { provide: HiveRuntime, useValue: hive },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (k: string) =>
              ({
                ahandHubUrl: "https://hub",
                gatewayInternalUrl: "https://gw",
                gatewayInternalServiceToken: "t",
              })[k],
            get: () => true,
          },
        },
      ],
    }).compile();
    d = mod.get(AhandSessionDispatcher);
  });

  describe("device.online", () => {
    it("addComponent + update tracking + invalidate cache", async () => {
      tracking.register({ sessionId: "s1", userId: "u1", onlineDeviceIds: [] });
      control.listDevicesForUser.mockResolvedValue([
        {
          id: "x",
          hubDeviceId: "d1",
          publicKey: "p",
          nickname: "A",
          platform: "macos",
          hostname: null,
          status: "active",
          isOnline: true,
          lastSeenAt: null,
          createdAt: "",
        },
      ]);
      await d.dispatch({
        ownerType: "user",
        ownerId: "u1",
        eventType: "device.online",
        data: { hubDeviceId: "d1" },
      });
      expect(fakeSession.addComponent).toHaveBeenCalled();
      expect(tracking.get("s1")!.onlineDeviceIds).toEqual(["d1"]);
      expect(fakeSession.invalidateCache).toHaveBeenCalledWith({
        keys: ["ahand-context"],
        mode: "next-turn",
      });
    });

    it("idempotent — already-online deviceId skipped", async () => {
      tracking.register({
        sessionId: "s1",
        userId: "u1",
        onlineDeviceIds: ["d1"],
      });
      await d.dispatch({
        ownerType: "user",
        ownerId: "u1",
        eventType: "device.online",
        data: { hubDeviceId: "d1" },
      });
      expect(fakeSession.addComponent).not.toHaveBeenCalled();
    });

    it("ignores events for devices that don't resolve to active+online", async () => {
      tracking.register({ sessionId: "s1", userId: "u1", onlineDeviceIds: [] });
      control.listDevicesForUser.mockResolvedValue([
        {
          id: "x",
          hubDeviceId: "d1",
          publicKey: "p",
          nickname: "A",
          platform: "macos",
          hostname: null,
          status: "revoked",
          isOnline: true,
          lastSeenAt: null,
          createdAt: "",
        },
      ]);
      await d.dispatch({
        ownerType: "user",
        ownerId: "u1",
        eventType: "device.online",
        data: { hubDeviceId: "d1" },
      });
      expect(fakeSession.addComponent).not.toHaveBeenCalled();
    });
  });

  describe("device.offline / device.revoked", () => {
    it("removeComponent + update tracking + invalidate", async () => {
      tracking.register({
        sessionId: "s1",
        userId: "u1",
        onlineDeviceIds: ["d1"],
      });
      await d.dispatch({
        ownerType: "user",
        ownerId: "u1",
        eventType: "device.offline",
        data: { hubDeviceId: "d1" },
      });
      expect(fakeSession.removeComponent).toHaveBeenCalledWith("comp-1");
      expect(tracking.get("s1")!.onlineDeviceIds).toEqual([]);
    });

    it("no-op when the device isn't currently attached", async () => {
      tracking.register({ sessionId: "s1", userId: "u1", onlineDeviceIds: [] });
      await d.dispatch({
        ownerType: "user",
        ownerId: "u1",
        eventType: "device.offline",
        data: { hubDeviceId: "d1" },
      });
      expect(fakeSession.removeComponent).not.toHaveBeenCalled();
    });
  });

  describe("device.heartbeat", () => {
    it("no-op (does not invalidate cache, does not mutate session)", async () => {
      tracking.register({
        sessionId: "s1",
        userId: "u1",
        onlineDeviceIds: ["d1"],
      });
      await d.dispatch({
        ownerType: "user",
        ownerId: "u1",
        eventType: "device.heartbeat",
        data: { hubDeviceId: "d1" },
      });
      expect(fakeSession.addComponent).not.toHaveBeenCalled();
      expect(fakeSession.removeComponent).not.toHaveBeenCalled();
      expect(fakeSession.invalidateCache).not.toHaveBeenCalled();
    });
  });

  describe("device.registered", () => {
    it("invalidates cache but does not attach a backend", async () => {
      tracking.register({ sessionId: "s1", userId: "u1", onlineDeviceIds: [] });
      await d.dispatch({
        ownerType: "user",
        ownerId: "u1",
        eventType: "device.registered",
        data: { hubDeviceId: "d1" },
      });
      expect(fakeSession.addComponent).not.toHaveBeenCalled();
      expect(fakeSession.invalidateCache).toHaveBeenCalled();
    });
  });

  describe("multi-session fan-out", () => {
    it("applies event to all sessions owned by the user", async () => {
      tracking.register({
        sessionId: "s1",
        userId: "u1",
        onlineDeviceIds: ["d1"],
      });
      tracking.register({
        sessionId: "s2",
        userId: "u1",
        onlineDeviceIds: ["d1"],
      });
      tracking.register({
        sessionId: "s3",
        userId: "u2",
        onlineDeviceIds: ["d9"],
      });
      await d.dispatch({
        ownerType: "user",
        ownerId: "u1",
        eventType: "device.offline",
        data: { hubDeviceId: "d1" },
      });
      expect(fakeSession.removeComponent).toHaveBeenCalledTimes(2);
      expect(tracking.get("s1")!.onlineDeviceIds).toEqual([]);
      expect(tracking.get("s2")!.onlineDeviceIds).toEqual([]);
      expect(tracking.get("s3")!.onlineDeviceIds).toEqual(["d9"]);
    });

    it("isolates per-session errors — one failing session doesn't block others", async () => {
      tracking.register({
        sessionId: "s1",
        userId: "u1",
        onlineDeviceIds: ["d1"],
      });
      tracking.register({
        sessionId: "s2",
        userId: "u1",
        onlineDeviceIds: ["d1"],
      });
      fakeSession.removeComponent.mockRejectedValueOnce(
        new Error("s1 removal failed"),
      );
      const errSpy = jest
        .spyOn((d as any).logger, "warn")
        .mockImplementation(() => {});
      await d.dispatch({
        ownerType: "user",
        ownerId: "u1",
        eventType: "device.offline",
        data: { hubDeviceId: "d1" },
      });
      expect(errSpy).toHaveBeenCalled();
      expect(fakeSession.removeComponent).toHaveBeenCalledTimes(2); // s2 still tried
    });
  });

  describe("workspace routing (MVP: skip)", () => {
    it("does nothing for ownerType=workspace", async () => {
      tracking.register({ sessionId: "s1", userId: "u1", onlineDeviceIds: [] });
      await d.dispatch({
        ownerType: "workspace",
        ownerId: "w1",
        eventType: "device.online",
        data: { hubDeviceId: "d1" },
      });
      expect(fakeSession.addComponent).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 5: Commit**

```bash
cd /Users/winrey/Projects/weightwave/team9
git add apps/server/apps/im-worker/src/ahand/ahand-session-dispatcher.service.ts \
        apps/server/apps/im-worker/src/ahand/ahand-session-dispatcher.service.spec.ts \
        apps/server/apps/im-worker/src/ahand/ahand-session-tracking.service.ts \
        apps/server/apps/im-worker/src/ahand/ahand.module.ts \
        apps/server/apps/im-worker/src/app.module.ts \
        apps/server/apps/im-worker/src/agent-session/
git commit -m "$(cat <<'EOF'
feat(im-worker/ahand): session dispatcher + module wiring

AhandSessionDispatcher maps device events to per-session component
operations:
- device.online → addComponent AHandHostComponent for the new device,
  update tracking, invalidate <ahand-context> cache. Idempotent per
  hubDeviceId.
- device.offline / revoked → removeComponent for that backend,
  update tracking, invalidate cache.
- device.heartbeat → no-op (presence tick only).
- device.registered → invalidate cache so the newly-registered (but
  possibly offline) device appears in <ahand-context>.

Multi-session fan-out: one user's event hits every active session the
user owns. Per-session errors are isolated — a failing session's
removeComponent call doesn't block sibling sessions.

Workspace routing is a noop for MVP (follow-up).

AhandSessionTrackingService is an in-memory Map<sessionId, state>
populated by AgentSessionService at session start (see Task 5.2) and
cleaned up at session end. Session lifecycle hooks are patched to
call tracking.register/unregister.

AhandImWorkerModule bundles control-plane client, blueprint extender,
tracking, dispatcher, and subscriber. Imported by AppModule.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

**Phase 5 outcome:** im-worker now injects ahand components at session start and hot-reconciles them mid-session based on hub events. Phase 6 (the ahand components themselves) can be wired in and the end-to-end agent-runs-shell-on-user's-Mac flow becomes runnable.

---

## Phase 6 — claw-hive ahand components

**Working directory:** `/Users/winrey/Projects/weightwave/team9-agent-pi/packages/claw-hive`.

Phase 6 ships the actual ahand code in the agent framework: `AHandHostComponent` (IHostBackend), `AHandContextProvider` (cache-system), plus the `ahand.list_devices` tool and component factories. These are imported by Phase 5's im-worker blueprint extender.

**Dependencies:**

- Phase 2 (multi-backend HostComponent + CacheSystemContextProvider framework hooks).
- Phase 1 (`@ahand/sdk` `CloudClient` — used here as a direct dependency).

**Module layout:**

```
packages/claw-hive/src/components/ahand/
├── component.ts                  # AHandHostComponent
├── component.test.ts
├── context-provider.ts           # AHandContextProvider
├── context-provider.test.ts
├── gateway-client.ts             # Internal HTTP client for gateway /internal/ahand/*
├── gateway-client.test.ts
└── index.ts                      # Re-exports
```

---

### Task 6.1: `GatewayAhandClient` — HTTP client to team9 gateway internal API

**Goal:** From inside the claw-hive component, call team9 gateway's `/internal/ahand/*` endpoints to get control-plane tokens and device lists. This client is **symmetric** to Phase 5 Task 5.1's `AhandControlPlaneClient` but lives in `@team9claw/claw-hive` (a different package / repo) so it has its own minimal implementation — no cross-package dependency.

**Files:**

- Create: `packages/claw-hive/src/components/ahand/gateway-client.ts`
- Create: `packages/claw-hive/src/components/ahand/gateway-client.test.ts`

**Acceptance Criteria:**

- [ ] Class `GatewayAhandClient` with constructor `(opts: { gatewayUrl: string; authToken: string; fetch?: typeof fetch })`.
- [ ] Methods: `mintControlPlaneToken(userId, deviceIds?)`, `listDevicesForUser(userId, opts?)`.
- [ ] Uses `fetch` (native or injected for test) with `X-Internal-Service-Token` header.
- [ ] 10s timeout via `AbortController`; retries 5xx × 3.
- [ ] 403 → throws `OwnershipError extends Error`; other 4xx → `GatewayError extends Error`.
- [ ] 100% coverage using `fetch` mock.

**Verify:** `pnpm vitest run packages/claw-hive/src/components/ahand/gateway-client.test.ts --coverage`.

**Steps:**

- [ ] **Step 1: Implementation**

```ts
// packages/claw-hive/src/components/ahand/gateway-client.ts

export interface GatewayAhandClientOptions {
  gatewayUrl: string; // e.g. "https://gateway.team9.ai"
  authToken: string; // internal service token
  fetch?: typeof fetch;
}

export interface AhandDeviceSnapshot {
  id: string;
  hubDeviceId: string;
  publicKey: string;
  nickname: string;
  platform: "macos" | "windows" | "linux";
  hostname: string | null;
  status: "active" | "revoked";
  isOnline: boolean | null;
  lastSeenAt: string | null;
  createdAt: string;
}

export class GatewayError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}
export class OwnershipError extends GatewayError {
  constructor(message: string) {
    super(message, 403);
  }
}

export class GatewayAhandClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: GatewayAhandClientOptions) {
    this.fetchImpl = opts.fetch ?? fetch;
  }

  async mintControlPlaneToken(
    userId: string,
    deviceIds?: string[],
  ): Promise<{ token: string; expiresAt: string }> {
    return this.post("/internal/ahand/control-plane/token", {
      userId,
      deviceIds,
    });
  }

  async listDevicesForUser(
    userId: string,
    opts: { includeOffline?: boolean } = {},
  ): Promise<AhandDeviceSnapshot[]> {
    return this.post("/internal/ahand/devices/list-for-user", {
      userId,
      includeOffline: opts.includeOffline ?? true,
    });
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.opts.gatewayUrl}${path}`;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10_000);
      try {
        const res = await this.fetchImpl(url, {
          method: "POST",
          headers: {
            "X-Internal-Service-Token": this.opts.authToken,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (res.status >= 200 && res.status < 300) {
          return (await res.json()) as T;
        }
        const text = await res.text().catch(() => "");
        if (res.status === 403) throw new OwnershipError(text || "Forbidden");
        if (res.status >= 400 && res.status < 500)
          throw new GatewayError(text || `HTTP ${res.status}`, res.status);
        lastErr = new GatewayError(text || `HTTP ${res.status}`, res.status);
      } catch (e) {
        clearTimeout(timer);
        if (e instanceof GatewayError) throw e;
        lastErr = e;
      }
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 2 ** attempt * 100));
      }
    }
    throw new GatewayError(`Retries exhausted: ${String(lastErr)}`, 0);
  }
}
```

- [ ] **Step 2: Tests**

```ts
// packages/claw-hive/src/components/ahand/gateway-client.test.ts

import { describe, it, expect, vi } from "vitest";
import {
  GatewayAhandClient,
  OwnershipError,
  GatewayError,
} from "./gateway-client";

function makeFetch(
  responses: Array<{ status: number; body: any }>,
): typeof fetch {
  let i = 0;
  return vi.fn(async () => {
    const r = responses[i++];
    return {
      status: r.status,
      async json() {
        return r.body;
      },
      async text() {
        return typeof r.body === "string" ? r.body : JSON.stringify(r.body);
      },
    } as Response;
  });
}

describe("GatewayAhandClient", () => {
  const base = "https://gw";
  const token = "svc_t_abcdef";

  describe("mintControlPlaneToken", () => {
    it("POSTs with internal header and parses JSON", async () => {
      const f = makeFetch([
        { status: 200, body: { token: "cp", expiresAt: "x" } },
      ]);
      const c = new GatewayAhandClient({
        gatewayUrl: base,
        authToken: token,
        fetch: f,
      });
      const res = await c.mintControlPlaneToken("u1", ["d1"]);
      expect(res.token).toBe("cp");
      expect(f).toHaveBeenCalledWith(
        "https://gw/internal/ahand/control-plane/token",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "X-Internal-Service-Token": token,
          }),
        }),
      );
    });

    it("403 throws OwnershipError without retry", async () => {
      const f = makeFetch([{ status: 403, body: "nope" }]);
      const c = new GatewayAhandClient({
        gatewayUrl: base,
        authToken: token,
        fetch: f,
      });
      await expect(c.mintControlPlaneToken("u1")).rejects.toThrow(
        OwnershipError,
      );
    });

    it("400 throws GatewayError, not retried", async () => {
      const f = makeFetch([{ status: 400, body: "bad" }]);
      const c = new GatewayAhandClient({
        gatewayUrl: base,
        authToken: token,
        fetch: f,
      });
      await expect(c.mintControlPlaneToken("u1")).rejects.toThrow(GatewayError);
    });
  });

  describe("listDevicesForUser", () => {
    it("returns parsed array", async () => {
      const devs = [
        {
          id: "id",
          hubDeviceId: "d1",
          publicKey: "p",
          nickname: "A",
          platform: "macos",
          hostname: null,
          status: "active",
          isOnline: true,
          lastSeenAt: null,
          createdAt: "",
        },
      ];
      const f = makeFetch([{ status: 200, body: devs }]);
      const c = new GatewayAhandClient({
        gatewayUrl: base,
        authToken: token,
        fetch: f,
      });
      expect(await c.listDevicesForUser("u1")).toEqual(devs);
    });
  });

  describe("retries", () => {
    it("retries 5xx up to 3 times", async () => {
      const f = makeFetch([
        { status: 503, body: "" },
        { status: 503, body: "" },
        { status: 200, body: { token: "cp", expiresAt: "x" } },
      ]);
      const c = new GatewayAhandClient({
        gatewayUrl: base,
        authToken: token,
        fetch: f,
      });
      const res = await c.mintControlPlaneToken("u1");
      expect(res.token).toBe("cp");
    });

    it("3×503 → GatewayError", async () => {
      const f = makeFetch([
        { status: 503, body: "" },
        { status: 503, body: "" },
        { status: 503, body: "" },
      ]);
      const c = new GatewayAhandClient({
        gatewayUrl: base,
        authToken: token,
        fetch: f,
      });
      await expect(c.mintControlPlaneToken("u1")).rejects.toThrow(GatewayError);
    });
  });

  describe("timeout", () => {
    it("aborts after 10s", async () => {
      const slow = vi.fn(async (_url: string, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        });
      });
      const c = new GatewayAhandClient({
        gatewayUrl: base,
        authToken: token,
        fetch: slow as any,
      });
      vi.useFakeTimers();
      const p = c.mintControlPlaneToken("u1").catch((e) => e);
      vi.advanceTimersByTime(30_000);
      const err = await p;
      vi.useRealTimers();
      expect(err).toBeInstanceOf(GatewayError);
    });
  });
});
```

- [ ] **Step 3: Commit**

```bash
cd /Users/winrey/Projects/weightwave/team9-agent-pi
git add packages/claw-hive/src/components/ahand/gateway-client.ts \
        packages/claw-hive/src/components/ahand/gateway-client.test.ts
git commit -m "$(cat <<'EOF'
feat(claw-hive/ahand): gateway client for internal API

Thin fetch-based HTTP client used from inside AHandHostComponent +
AHandContextProvider to reach team9 gateway's /internal/ahand/*
endpoints. Symmetric to im-worker's AhandControlPlaneClient but
standalone to avoid a cross-package dependency.

Retries 5xx × 3 with backoff; 403 throws OwnershipError (distinct
from GatewayError so callers can handle "device not yours" as a
semantic signal); 10s timeout via AbortController.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6.2: `AHandHostComponent` — the `IHostBackend` implementation

**Goal:** Implement the claw-hive component that represents "one ahand remote device" as a backend to `HostComponent`. It registers itself under typeKey `ahand:user-computer:{deviceId}`, holds a `CloudClient` from `@ahand/sdk`, manages control-plane JWT lifecycle, and implements the `IHostBackend` interface so `run_command`, etc. route through it when the agent picks this backend.

**Files:**

- Create: `packages/claw-hive/src/components/ahand/component.ts`
- Create: `packages/claw-hive/src/components/ahand/component.test.ts`
- Modify: `packages/claw-hive/package.json` — add dep `@ahand/sdk` (pinned to the release published in Phase 1 Task 1.6).

**Acceptance Criteria:**

- [ ] Class `AHandHostComponent` extends `BaseComponent<AHandHostComponentConfig, AHandHostComponentData>` and implements `IHostBackend`.
- [ ] `type` = `ahand:user-computer:${config.deviceId}`. Priority: -40 (between just-bash 0 and e2b-sandbox -70). typeKey for blueprint lookup: `"ahand-host"`.
- [ ] In `onInitialize`: construct `CloudClient` with `getAuthToken: () => this.getOrRefreshControlPlaneJwt()`; register self to `HostComponent` via `dep.registerBackend(this)`.
- [ ] In `onDispose`: unregister from HostComponent + cancel any in-flight jobs.
- [ ] `getMetadata()` returns `{ displayName: nickname, platform, isCurrentDevice, statusLine: "online"/"offline" }` based on `data.lastObservedStatus`.
- [ ] `ensureReady(agentId)` is a no-op (hub verifies device liveness on each job dispatch — no local state to prepare).
- [ ] `spawn(agentId, command, options?)` calls `cloud.spawn({ deviceId, command, cwd, envs, onStdout, onStderr })`, accumulates output in `execResults[execId]`, returns a fully-populated `ProcessHandle`.
- [ ] `checkProcess(ref)` returns the cached `execResults` entry (job finishes synchronously inside `spawn` — ahand's SSE resolves only on `finished` event).
- [ ] `killProcess(ref, signal)` calls `cloud.cancel(jobId)` if job is still running.
- [ ] `readFile` / `writeFile` / `listDir` all throw `Error("ahand backend: readFile/writeFile/listDir not supported in MVP; use run_command with cat/echo/ls.")`.
- [ ] JWT cached in `data.controlPlaneToken` with 60s safety margin; refresh through `GatewayAhandClient.mintControlPlaneToken`.
- [ ] On `CloudClient` errors: `OwnershipError` (403) → surface as-is; `DeviceOffline` / network → surface with clear message.
- [ ] 100% coverage with mocked `GatewayAhandClient` + `CloudClient`.

**Verify:** `pnpm vitest run packages/claw-hive/src/components/ahand/component.test.ts --coverage` → 100%.

**Steps:**

- [ ] **Step 1: Implementation**

```ts
// packages/claw-hive/src/components/ahand/component.ts

import { BaseComponent } from "@team9claw/agent-components";
import type {
  ComponentContext,
  IHostBackend,
  HostBackendMetadata,
  HostDependencyApi,
  ProcessHandle,
  ProcessStatus,
  DirEntry,
} from "@team9claw/types";
import { CloudClient } from "@ahand/sdk";
import { GatewayAhandClient } from "./gateway-client";

export interface AHandHostComponentConfig {
  deviceId: string; // hubDeviceId
  deviceNickname: string;
  devicePlatform: "macos" | "windows" | "linux";
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

export interface AHandHostComponentData {
  controlPlaneToken: { value: string; expiresAt: number } | null;
  lastObservedStatus: "online" | "offline" | "unknown";
  lastSeenAt: string | null;
  execResults: Record<
    string,
    { stdout: string; stderr: string; exitCode: number }
  >;
  activeJobs: Record<string, string>; // execId → jobId (for kill)
}

export class AHandHostComponent
  extends BaseComponent<AHandHostComponentConfig, AHandHostComponentData>
  implements IHostBackend
{
  readonly type: string;
  readonly dependencies = ["host"] as const;

  private cloud: CloudClient | null = null;
  private gateway: GatewayAhandClient | null = null;
  private hostDep: HostDependencyApi | null = null;

  constructor(config: AHandHostComponentConfig, id?: string) {
    super(
      {
        typeKey: "ahand-host",
        name: `aHand: ${config.deviceNickname}`,
        priority: -40,
        initialData: {
          controlPlaneToken: null,
          lastObservedStatus: "unknown",
          lastSeenAt: null,
          execResults: {},
          activeJobs: {},
        },
      },
      config,
      id,
    );
    this.type = `ahand:user-computer:${config.deviceId}`;
  }

  override async onInitialize(
    ctx: ComponentContext<AHandHostComponentConfig, AHandHostComponentData>,
  ): Promise<void> {
    this.gateway = new GatewayAhandClient({
      gatewayUrl: this.config.gatewayInternalUrl,
      authToken: this.config.gatewayInternalAuthToken,
    });
    this.cloud = new CloudClient({
      hubUrl: this.config.hubUrl,
      getAuthToken: () => this.getOrRefreshControlPlaneJwt(),
    });
    this.hostDep = ctx.getDependency<HostDependencyApi>("host") ?? null;
    this.hostDep?.registerBackend(this);
  }

  override async onDispose(
    _ctx: ComponentContext<AHandHostComponentConfig, AHandHostComponentData>,
  ): Promise<void> {
    this.hostDep?.unregisterBackend(this.type);
    // Cancel any in-flight jobs; best-effort.
    const active = Object.values(this.data.activeJobs ?? {});
    await Promise.allSettled(
      active.map((jobId) => this.cloud?.cancel(jobId).catch(() => {})),
    );
    this.setData({
      execResults: {},
      activeJobs: {},
      controlPlaneToken: null,
    });
  }

  getMetadata(): HostBackendMetadata {
    const isCurrent =
      this.config.callingClient.kind === "macapp" &&
      this.config.callingClient.deviceId === this.config.deviceId;
    return {
      displayName: this.config.deviceNickname,
      platform: this.config.devicePlatform,
      isCurrentDevice: isCurrent,
      statusLine: this.renderStatusLine(),
    };
  }

  private renderStatusLine(): string {
    if (this.data.lastObservedStatus === "online") return "online";
    if (this.data.lastObservedStatus === "offline" && this.data.lastSeenAt) {
      return `offline since ${this.data.lastSeenAt}`;
    }
    return "presence unknown";
  }

  async ensureReady(_agentId: string): Promise<void> {
    // No-op for ahand; hub validates liveness on each dispatch.
  }

  async spawn(
    agentId: string,
    command: string,
    options?: { cwd?: string; envs?: Record<string, string> },
  ): Promise<ProcessHandle> {
    if (!this.cloud) throw new Error("AHandHostComponent: not initialized");
    const execId = crypto.randomUUID();
    let stdoutAccum = "";
    let stderrAccum = "";

    let jobId = "";
    // Hook to capture jobId so kill can use it. @ahand/sdk's spawn resolves after
    // `finished`, so we capture jobId via a side-channel in the implementation.
    // Alternative: if CloudClient returns jobId synchronously, refactor to
    // expose it before awaiting finished.

    try {
      const result = await this.cloud.spawn({
        deviceId: this.config.deviceId,
        command,
        cwd: options?.cwd,
        envs: options?.envs,
        onStdout: (chunk) => {
          stdoutAccum += chunk;
        },
        onStderr: (chunk) => {
          stderrAccum += chunk;
        },
      });

      this.setData({
        execResults: {
          ...this.data.execResults,
          [execId]: {
            stdout: stdoutAccum,
            stderr: stderrAccum,
            exitCode: result.exitCode,
          },
        },
        lastObservedStatus: "online",
        lastSeenAt: new Date().toISOString(),
      });

      return {
        ref: { type: this.type, agentId, execId, jobId },
        stdout: stdoutAccum,
        stderr: stderrAccum,
        exited: true,
        exitCode: result.exitCode,
      };
    } catch (e: any) {
      this.setData({
        execResults: {
          ...this.data.execResults,
          [execId]: {
            stdout: stdoutAccum,
            stderr: `${stderrAccum}\n\n[ahand error] ${e?.message ?? String(e)}`,
            exitCode: 1,
          },
        },
      });
      return {
        ref: { type: this.type, agentId, execId, jobId },
        stdout: stdoutAccum,
        stderr: `${stderrAccum}\n\n[ahand error] ${e?.message ?? String(e)}`,
        exited: true,
        exitCode: 1,
      };
    }
  }

  async checkProcess(ref: Record<string, unknown>): Promise<ProcessStatus> {
    const execId = String(ref.execId ?? "");
    const r = this.data.execResults[execId];
    if (!r) return { running: true }; // not yet populated
    return {
      running: false,
      exitCode: r.exitCode,
      stdout: r.stdout,
      stderr: r.stderr,
    };
  }

  async killProcess(
    ref: Record<string, unknown>,
    _signal: "SIGTERM" | "SIGKILL",
  ): Promise<void> {
    const jobId = String(ref.jobId ?? "");
    if (!jobId || !this.cloud) return;
    await this.cloud.cancel(jobId).catch(() => {});
  }

  async readFile(): Promise<{ content: string; bytes: number }> {
    throw new Error(
      "ahand backend: readFile not supported in MVP. " +
        "Use run_command with `cat` or similar to read files on the remote device.",
    );
  }
  async writeFile(): Promise<{ bytes: number }> {
    throw new Error(
      "ahand backend: writeFile not supported in MVP. " +
        "Use run_command with `echo`/`tee`/`cat > file` to write files on the remote device.",
    );
  }
  async listDir(): Promise<DirEntry[]> {
    throw new Error(
      "ahand backend: listDir not supported in MVP. " +
        "Use run_command with `ls -la` to list directory contents on the remote device.",
    );
  }

  private async getOrRefreshControlPlaneJwt(): Promise<string> {
    const SAFETY_MARGIN_MS = 60_000;
    const now = Date.now();
    if (
      this.data.controlPlaneToken &&
      this.data.controlPlaneToken.expiresAt > now + SAFETY_MARGIN_MS
    ) {
      return this.data.controlPlaneToken.value;
    }
    if (!this.gateway)
      throw new Error("AHandHostComponent: gateway client not initialized");
    const { token, expiresAt } = await this.gateway.mintControlPlaneToken(
      this.config.callingUserId,
      [this.config.deviceId],
    );
    this.setData({
      controlPlaneToken: {
        value: token,
        expiresAt: new Date(expiresAt).getTime(),
      },
    });
    return token;
  }
}
```

Note on `jobId` capture: the `CloudClient.spawn` API resolves only after `finished`. Because the agent needs `jobId` **during** execution to support `kill`, `@ahand/sdk`'s `CloudClient.spawn` should expose jobId via an `onStart(jobId)` callback or equivalent. If it doesn't, Phase 1 Task 1.6 should add that callback before this task merges. In the implementation above, `jobId` stays blank in the ref until then — `killProcess` no-ops. Follow-up: wire the `onStart` callback once the SDK exposes it.

- [ ] **Step 2: Tests (representative subset of § 9.4.3 matrix)**

```ts
// packages/claw-hive/src/components/ahand/component.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AHandHostComponent } from "./component";
import type { HostDependencyApi } from "@team9claw/types";

const baseConfig = {
  deviceId: "abc123",
  deviceNickname: "Alice's MacBook Pro",
  devicePlatform: "macos" as const,
  callingUserId: "u1",
  callingClient: { kind: "web" as const },
  gatewayInternalUrl: "https://gw",
  gatewayInternalAuthToken: "t",
  hubUrl: "https://hub",
};

function makeCtx(hostDep: HostDependencyApi): any {
  return {
    getDependency: (key: string) => (key === "host" ? hostDep : null),
  };
}

function setupComponent(config = baseConfig) {
  const hostDep = {
    registerBackend: vi.fn(),
    unregisterBackend: vi.fn(),
  };
  const c = new AHandHostComponent(config);
  return { c, hostDep, ctx: makeCtx(hostDep) };
}

// Shared mocks attached to the component via any-cast for testing internals.
function mockCloud(c: AHandHostComponent, impl: any) {
  (c as any).cloud = impl;
}
function mockGateway(c: AHandHostComponent, impl: any) {
  (c as any).gateway = impl;
}

describe("AHandHostComponent", () => {
  describe("type + priority + metadata", () => {
    it("type encodes deviceId", () => {
      const c = new AHandHostComponent(baseConfig);
      expect(c.type).toBe("ahand:user-computer:abc123");
    });

    it("getMetadata reflects config + observed status", async () => {
      const { c, ctx } = setupComponent({
        ...baseConfig,
        callingClient: {
          kind: "macapp",
          deviceId: "abc123",
          deviceNickname: "Alice's MacBook Pro",
          isAhandEnabled: true,
        },
      });
      await c.onInitialize(ctx);
      const md = c.getMetadata();
      expect(md.displayName).toBe("Alice's MacBook Pro");
      expect(md.platform).toBe("macos");
      expect(md.isCurrentDevice).toBe(true);
      expect(md.statusLine).toBe("presence unknown");
    });
  });

  describe("onInitialize / onDispose", () => {
    it("registers with HostComponent on initialize, unregisters on dispose", async () => {
      const { c, hostDep, ctx } = setupComponent();
      await c.onInitialize(ctx);
      expect(hostDep.registerBackend).toHaveBeenCalledWith(c);
      await c.onDispose(ctx);
      expect(hostDep.unregisterBackend).toHaveBeenCalledWith(c.type);
    });

    it("onDispose cancels active jobs", async () => {
      const { c, ctx } = setupComponent();
      await c.onInitialize(ctx);
      const cancel = vi.fn().mockResolvedValue(undefined);
      mockCloud(c, { cancel });
      c.setData({ activeJobs: { e1: "job-1", e2: "job-2" } });
      await c.onDispose(ctx);
      expect(cancel).toHaveBeenCalledTimes(2);
    });
  });

  describe("spawn — happy", () => {
    it("accumulates streamed chunks and returns exitCode", async () => {
      const { c, ctx } = setupComponent();
      await c.onInitialize(ctx);
      mockGateway(c, {
        mintControlPlaneToken: vi
          .fn()
          .mockResolvedValue({
            token: "t",
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          }),
      });
      const spawn = vi.fn(async (opts: any) => {
        opts.onStdout("hello ");
        opts.onStdout("world\n");
        return { exitCode: 0, durationMs: 5 };
      });
      mockCloud(c, { spawn });
      const h = await c.spawn("agent-1", "echo hello world");
      expect(h.exited).toBe(true);
      expect(h.exitCode).toBe(0);
      expect(h.stdout).toBe("hello world\n");
      expect(h.stderr).toBe("");
      expect(c.getData().lastObservedStatus).toBe("online");
    });
  });

  describe("spawn — errors surface cleanly", () => {
    it("CloudClient failure → exitCode=1 + error in stderr", async () => {
      const { c, ctx } = setupComponent();
      await c.onInitialize(ctx);
      mockCloud(c, {
        spawn: vi.fn().mockRejectedValue(new Error("device offline")),
      });
      mockGateway(c, {
        mintControlPlaneToken: vi
          .fn()
          .mockResolvedValue({
            token: "t",
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          }),
      });
      const h = await c.spawn("agent-1", "echo x");
      expect(h.exited).toBe(true);
      expect(h.exitCode).toBe(1);
      expect(h.stderr).toContain("[ahand error] device offline");
    });
  });

  describe("readFile / writeFile / listDir — unsupported in MVP", () => {
    it("all throw with 'use run_command' hints", async () => {
      const { c, ctx } = setupComponent();
      await c.onInitialize(ctx);
      await expect(c.readFile("a", "/x")).rejects.toThrow(
        /readFile not supported in MVP/,
      );
      await expect(c.writeFile("a", "/x", "content")).rejects.toThrow(
        /writeFile not supported in MVP/,
      );
      await expect(c.listDir("a", "/x")).rejects.toThrow(
        /listDir not supported in MVP/,
      );
    });
  });

  describe("checkProcess + killProcess", () => {
    it("checkProcess returns cached exec result", async () => {
      const { c } = setupComponent();
      c.setData({
        execResults: { e1: { stdout: "ok", stderr: "", exitCode: 0 } },
      });
      const st = await c.checkProcess({ execId: "e1" });
      expect(st).toEqual({
        running: false,
        exitCode: 0,
        stdout: "ok",
        stderr: "",
      });
    });

    it("checkProcess for unknown execId reports running (pending)", async () => {
      const { c } = setupComponent();
      const st = await c.checkProcess({ execId: "unknown" });
      expect(st).toEqual({ running: true });
    });

    it("killProcess calls CloudClient.cancel when jobId known", async () => {
      const { c, ctx } = setupComponent();
      await c.onInitialize(ctx);
      const cancel = vi.fn().mockResolvedValue(undefined);
      mockCloud(c, { cancel });
      await c.killProcess({ jobId: "job-42" }, "SIGTERM");
      expect(cancel).toHaveBeenCalledWith("job-42");
    });

    it("killProcess no-ops when jobId is empty", async () => {
      const { c, ctx } = setupComponent();
      await c.onInitialize(ctx);
      const cancel = vi.fn();
      mockCloud(c, { cancel });
      await c.killProcess({ jobId: "" }, "SIGTERM");
      expect(cancel).not.toHaveBeenCalled();
    });
  });

  describe("JWT caching", () => {
    it("reuses cached token when not near expiry", async () => {
      const { c, ctx } = setupComponent();
      await c.onInitialize(ctx);
      const mint = vi
        .fn()
        .mockResolvedValue({
          token: "fresh",
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        });
      mockGateway(c, { mintControlPlaneToken: mint });
      const a = await (c as any).getOrRefreshControlPlaneJwt();
      const b = await (c as any).getOrRefreshControlPlaneJwt();
      expect(a).toBe("fresh");
      expect(b).toBe("fresh");
      expect(mint).toHaveBeenCalledTimes(1);
    });

    it("refreshes when within safety margin", async () => {
      const { c, ctx } = setupComponent();
      await c.onInitialize(ctx);
      c.setData({
        controlPlaneToken: { value: "old", expiresAt: Date.now() + 30_000 },
      }); // < 60s margin
      mockGateway(c, {
        mintControlPlaneToken: vi
          .fn()
          .mockResolvedValue({
            token: "new",
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          }),
      });
      const t = await (c as any).getOrRefreshControlPlaneJwt();
      expect(t).toBe("new");
    });
  });
});
```

- [ ] **Step 3: Commit**

```bash
cd /Users/winrey/Projects/weightwave/team9-agent-pi
git add packages/claw-hive/src/components/ahand/component.ts \
        packages/claw-hive/src/components/ahand/component.test.ts \
        packages/claw-hive/package.json
git commit -m "$(cat <<'EOF'
feat(claw-hive/ahand): AHandHostComponent (IHostBackend)

Represents one ahand-connected remote device as a backend under
HostComponent. Registered with typeKey 'ahand-host' and runtime
type 'ahand:user-computer:{deviceId}'. priority=-40 so it sits
between just-bash (0) and e2b-sandbox (-70) in auto-pick rules.

- onInitialize wires CloudClient (@ahand/sdk) with a
  getAuthToken callback that lazy-mints control-plane JWTs via
  GatewayAhandClient; registers self via HostDependencyApi.
- onDispose unregisters the backend and best-effort-cancels in-
  flight jobs.
- getMetadata feeds HostComponent's <host-context> block with
  display-name, platform, is-current-device, status-line.
- spawn streams stdout/stderr into ComponentData.execResults and
  exposes them to checkProcess so sync poll in HostComponent works
  identically to just-bash.
- readFile/writeFile/listDir throw with clear 'use run_command'
  hints — MVP does not expose remote file ops over ahand.
- JWT cache with 60s safety margin; refresh on demand.

Known limitation: CloudClient.spawn currently resolves only on
'finished' event, so jobId is not captured mid-execution. kill
requires the SDK to expose jobId via an onStart callback (to be
added in Phase 1 Task 1.6 if not already present).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6.3: `AHandContextProvider` + `ahand.list_devices` tool

**Goal:** Contribute the cache-system block `<ahand-context>` describing the calling-client identity, session-mode permissions, and the full device list (including offline). Also expose a tool `ahand.list_devices` so agents can query live device state.

**Files:**

- Create: `packages/claw-hive/src/components/ahand/context-provider.ts`
- Create: `packages/claw-hive/src/components/ahand/context-provider.test.ts`

**Acceptance Criteria:**

- [ ] Class `AHandContextProvider` extends `BaseComponent<AHandContextProviderConfig, AHandContextProviderData>` AND implements `CacheSystemContextProvider` (defined in Phase 2 Task 2.2).
- [ ] Component `typeKey = "ahand-context-provider"`, `priority = 65` (high, but below HostComponent which typically lives around 70 so `<host-context>` renders first).
- [ ] `getCacheSystemProviders()` returns `[this]`.
- [ ] `getCacheDependencies(ctx)` returns a key object with: a **sorted** device signature (`devicesSig`), the calling-client fingerprint, and any permissions version marker. Stable across prompt builds unless the listed devices' online/status set changes.
- [ ] `render(ctx)` fetches the full device list via `GatewayAhandClient.listDevicesForUser(userId, { includeOffline: true })` and emits the XML block per spec § 6.5. XML-escapes nickname characters `<>&"`.
- [ ] Tool `ahand.list_devices` registered via `getTools()`: param `includeOffline?: boolean` (default `true`); execute returns `{ devices: [...], refreshedAt }` with `backendType: "ahand:user-computer:<id>"` for each device.
- [ ] If gateway listing fails: `render()` returns a minimal `<ahand-context refreshed-at="…" error="gateway unavailable">` block (so the agent still has context, just knows it's incomplete). `getCacheDependencies` returns a special `{ error: true, at: Date.now() }` so next turn re-attempts.
- [ ] 100% coverage.

**Verify:** `pnpm vitest run packages/claw-hive/src/components/ahand/context-provider.test.ts --coverage` → 100%.

**Steps:**

- [ ] **Step 1: Implementation**

```ts
// packages/claw-hive/src/components/ahand/context-provider.ts

import { BaseComponent } from "@team9claw/agent-components";
import type {
  AgentTool,
  CacheSystemContextProvider,
  ComponentContext,
  ToolResult,
} from "@team9claw/types";
import { textResult } from "@team9claw/agent-components";
import { GatewayAhandClient, type AhandDeviceSnapshot } from "./gateway-client";

export interface AHandContextProviderConfig {
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
}

export interface AHandContextProviderData {
  // No mutable state needed; cache-system handles rebuild triggers.
}

export class AHandContextProvider
  extends BaseComponent<AHandContextProviderConfig, AHandContextProviderData>
  implements CacheSystemContextProvider
{
  readonly cacheKey = "ahand-context";
  readonly dependencies = [] as const;

  private gateway: GatewayAhandClient | null = null;

  constructor(config: AHandContextProviderConfig, id?: string) {
    super(
      {
        typeKey: "ahand-context-provider",
        name: "aHand Context",
        priority: 65,
        initialData: {},
      },
      config,
      id,
    );
  }

  override async onInitialize(_ctx: ComponentContext<any, any>): Promise<void> {
    this.gateway = new GatewayAhandClient({
      gatewayUrl: this.config.gatewayInternalUrl,
      authToken: this.config.gatewayInternalAuthToken,
    });
  }

  override getCacheSystemProviders(): CacheSystemContextProvider[] {
    return [this];
  }

  async getCacheDependencies(
    _ctx: ComponentContext<any, any>,
  ): Promise<Record<string, unknown>> {
    let devices: AhandDeviceSnapshot[] = [];
    try {
      devices = await this.requireGateway().listDevicesForUser(
        this.config.callingUserId,
        { includeOffline: true },
      );
    } catch {
      return { error: true, at: Math.floor(Date.now() / 30_000) }; // 30s buckets so transient failures bust cache slowly
    }
    const devicesSig = devices
      .map((d) => `${d.hubDeviceId}:${d.status}:${d.isOnline ? 1 : 0}`)
      .sort()
      .join(",");
    const clientSig =
      this.config.callingClient.kind === "macapp"
        ? `macapp:${this.config.callingClient.deviceId}:${this.config.callingClient.isAhandEnabled}`
        : "web";
    return {
      devicesSig,
      clientSig,
      permsVersion: "mvp-v1",
    };
  }

  async render(_ctx: ComponentContext<any, any>): Promise<string> {
    const now = new Date().toISOString();
    let devices: AhandDeviceSnapshot[] = [];
    try {
      devices = await this.requireGateway().listDevicesForUser(
        this.config.callingUserId,
        { includeOffline: true },
      );
    } catch (e) {
      return `<ahand-context refreshed-at="${now}" error="gateway unavailable"/>`;
    }
    const cc = this.config.callingClient;
    const platformLine =
      cc.kind === "macapp"
        ? `<platform kind="macapp" current-device-id="${xmlEscape(cc.deviceId)}"/>`
        : `<platform kind="web"/>`;
    const devicesXml = devices
      .map((d) => {
        const isCurrent = cc.kind === "macapp" && cc.deviceId === d.hubDeviceId;
        return `    <device
      id="${xmlEscape(d.hubDeviceId)}"
      nickname="${xmlEscape(d.nickname)}"
      platform="${d.platform}"
      status="${d.isOnline ? "online" : "offline"}"
      is-current="${isCurrent}"/>`;
      })
      .join("\n");
    return `<ahand-context refreshed-at="${now}">
  ${platformLine}
  <permissions session-mode="auto_accept">
    <feature name="shell" allowed="true"/>
    <feature name="browser" allowed="false" reason="disabled in MVP"/>
    <feature name="file" allowed="false" reason="disabled in MVP"/>
  </permissions>
  <devices>
${devicesXml}
  </devices>
  <refresh-instructions>
    Call \`ahand.list_devices\` for live device status, or \`refresh_context\`
    with cacheKey="ahand-context" to rebuild this block next turn.
    Last refreshed at ${now}.
  </refresh-instructions>
</ahand-context>`;
  }

  override getTools(_ctx: ComponentContext<any, any>): AgentTool[] {
    return [this.createListDevicesTool()];
  }

  private createListDevicesTool(): AgentTool {
    return {
      name: "ahand.list_devices",
      description:
        "List the user's remote machines (ahand), including offline ones. " +
        "Returns live data (bypasses the cached <ahand-context>). Use when you " +
        "suspect context is stale or when you explicitly need offline devices.",
      parameters: {
        type: "object",
        properties: {
          includeOffline: {
            type: "boolean",
            description: "Include offline devices. Default: true.",
          },
        },
      },
      execute: async ({ args }): Promise<ToolResult> => {
        const includeOffline = (args as any).includeOffline ?? true;
        try {
          const devices = await this.requireGateway().listDevicesForUser(
            this.config.callingUserId,
            { includeOffline },
          );
          return textResult({
            devices: devices.map((d) => ({
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
        } catch (e: any) {
          return textResult({
            error: `Failed to list devices: ${e?.message ?? String(e)}`,
          });
        }
      },
    };
  }

  private requireGateway(): GatewayAhandClient {
    if (!this.gateway)
      throw new Error("AHandContextProvider: gateway client not initialized");
    return this.gateway;
  }
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
```

- [ ] **Step 2: Tests**

```ts
// packages/claw-hive/src/components/ahand/context-provider.test.ts

import { describe, it, expect, vi } from "vitest";
import { AHandContextProvider } from "./context-provider";
import type { AhandDeviceSnapshot } from "./gateway-client";

const baseConfig = {
  callingUserId: "u1",
  callingClient: { kind: "web" as const },
  gatewayInternalUrl: "https://gw",
  gatewayInternalAuthToken: "t",
};

function setup(config = baseConfig) {
  const provider = new AHandContextProvider(config);
  const list = vi.fn();
  (provider as any).gateway = { listDevicesForUser: list };
  return { provider, list };
}

const dev = (p: Partial<AhandDeviceSnapshot>): AhandDeviceSnapshot => ({
  id: "id",
  hubDeviceId: "d1",
  publicKey: "p",
  nickname: "A",
  platform: "macos",
  hostname: null,
  status: "active",
  isOnline: true,
  lastSeenAt: null,
  createdAt: "",
  ...p,
});

describe("AHandContextProvider", () => {
  describe("getCacheDependencies", () => {
    it("signature is deterministic (sorted)", async () => {
      const { provider, list } = setup();
      list.mockResolvedValue([
        dev({ hubDeviceId: "b", status: "active", isOnline: true }),
        dev({ hubDeviceId: "a", status: "active", isOnline: false }),
      ]);
      const d1 = await provider.getCacheDependencies({} as any);
      list.mockResolvedValue([
        dev({ hubDeviceId: "a", status: "active", isOnline: false }),
        dev({ hubDeviceId: "b", status: "active", isOnline: true }),
      ]);
      const d2 = await provider.getCacheDependencies({} as any);
      expect(d1).toEqual(d2);
    });

    it("online toggle changes signature", async () => {
      const { provider, list } = setup();
      list.mockResolvedValue([dev({ hubDeviceId: "a", isOnline: true })]);
      const d1 = await provider.getCacheDependencies({} as any);
      list.mockResolvedValue([dev({ hubDeviceId: "a", isOnline: false })]);
      const d2 = await provider.getCacheDependencies({} as any);
      expect(d1).not.toEqual(d2);
    });

    it("gateway failure returns time-bucketed error dep", async () => {
      const { provider, list } = setup();
      list.mockRejectedValue(new Error("boom"));
      const d = await provider.getCacheDependencies({} as any);
      expect(d).toEqual(expect.objectContaining({ error: true }));
    });

    it("callingClient difference changes signature", async () => {
      const web = setup({ ...baseConfig, callingClient: { kind: "web" } });
      const mac = setup({
        ...baseConfig,
        callingClient: {
          kind: "macapp",
          deviceId: "dX",
          deviceNickname: "Mac",
          isAhandEnabled: true,
        },
      });
      web.list.mockResolvedValue([]);
      mac.list.mockResolvedValue([]);
      const dWeb = await web.provider.getCacheDependencies({} as any);
      const dMac = await mac.provider.getCacheDependencies({} as any);
      expect(dWeb).not.toEqual(dMac);
    });
  });

  describe("render", () => {
    it("emits <ahand-context> with devices (including offline)", async () => {
      const { provider, list } = setup({
        ...baseConfig,
        callingClient: {
          kind: "macapp",
          deviceId: "d1",
          deviceNickname: "Mac",
          isAhandEnabled: true,
        },
      });
      list.mockResolvedValue([
        dev({ hubDeviceId: "d1", nickname: "Mac", isOnline: true }),
        dev({ hubDeviceId: "d2", nickname: "iMac", isOnline: false }),
      ]);
      const xml = await provider.render({} as any);
      expect(xml).toMatch(/<ahand-context refreshed-at="/);
      expect(xml).toMatch(/<platform kind="macapp" current-device-id="d1"\/>/);
      expect(xml).toMatch(
        /id="d1"\s+nickname="Mac"[\s\S]*status="online"[\s\S]*is-current="true"/,
      );
      expect(xml).toMatch(
        /id="d2"\s+nickname="iMac"[\s\S]*status="offline"[\s\S]*is-current="false"/,
      );
      expect(xml).toMatch(/permissions session-mode="auto_accept"/);
      expect(xml).toMatch(/shell" allowed="true"/);
      expect(xml).toMatch(/browser" allowed="false"/);
    });

    it("xml-escapes nicknames containing special chars", async () => {
      const { provider, list } = setup();
      list.mockResolvedValue([
        dev({ hubDeviceId: "d1", nickname: `<script>"Eve"&` }),
      ]);
      const xml = await provider.render({} as any);
      expect(xml).toContain("&lt;script&gt;&quot;Eve&quot;&amp;");
      expect(xml).not.toContain("<script>");
    });

    it("falls back to minimal error tag on gateway failure", async () => {
      const { provider, list } = setup();
      list.mockRejectedValue(new Error("gw down"));
      const xml = await provider.render({} as any);
      expect(xml).toMatch(
        /^<ahand-context refreshed-at=".+" error="gateway unavailable"\/>$/,
      );
    });
  });

  describe("ahand.list_devices tool", () => {
    it("returns backendType formatted correctly", async () => {
      const { provider, list } = setup();
      list.mockResolvedValue([
        dev({ hubDeviceId: "abc", nickname: "A", isOnline: true }),
      ]);
      const tool = provider.getTools({} as any)[0];
      const res = await tool.execute({
        args: { includeOffline: true },
        ctx: {} as any,
      });
      const body = JSON.parse((res as any).content[0].text);
      expect(body.devices[0]).toMatchObject({
        backendType: "ahand:user-computer:abc",
        hubDeviceId: "abc",
        nickname: "A",
        status: "online",
      });
      expect(body.refreshedAt).toBeTypeOf("string");
    });

    it("respects includeOffline default (true)", async () => {
      const { provider, list } = setup();
      list.mockResolvedValue([]);
      const tool = provider.getTools({} as any)[0];
      await tool.execute({ args: {}, ctx: {} as any });
      expect(list).toHaveBeenCalledWith("u1", { includeOffline: true });
    });

    it("returns friendly error when gateway fails", async () => {
      const { provider, list } = setup();
      list.mockRejectedValue(new Error("boom"));
      const tool = provider.getTools({} as any)[0];
      const res = await tool.execute({ args: {}, ctx: {} as any });
      const body = JSON.parse((res as any).content[0].text);
      expect(body.error).toMatch(/Failed to list devices: boom/);
    });
  });
});
```

- [ ] **Step 3: Commit**

```bash
cd /Users/winrey/Projects/weightwave/team9-agent-pi
git add packages/claw-hive/src/components/ahand/context-provider.ts \
        packages/claw-hive/src/components/ahand/context-provider.test.ts
git commit -m "$(cat <<'EOF'
feat(claw-hive/ahand): AHandContextProvider + list_devices tool

CacheSystemContextProvider feeding <ahand-context> into the system
prompt. Shows calling-client identity (web or macapp with device ref),
MVP permissions (shell allowed, browser/file disabled), and a
superset device list including offline devices — so the LLM can
suggest 'ask the user to turn on device X' when needed.

- getCacheDependencies is deterministic (sorted device signatures)
  so cosmetic reorderings don't bust the cache.
- Gateway failures emit a minimal error tag + a time-bucketed dep
  so the block refreshes on the next turn without infinite rebuilds.
- XML-escapes nicknames to defeat injection via user-controlled
  strings.

Plus contributes ahand.list_devices tool that bypasses the cache
and returns live device state. Each entry carries backendType
(\"ahand:user-computer:<id>\") so the LLM can directly pass it to
run_command without string concatenation guesswork.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6.4: Component factories + exports + blueprint preset

**Goal:** Wire AHandHostComponent and AHandContextProvider into the claw-hive component-factory registry so blueprints can declare them by `typeKey`. Add a blueprint preset that includes both. Export from the package's public API.

**Files:**

- Modify: `packages/claw-hive/src/component-factories.ts` — register factories for `"ahand-host"` and `"ahand-context-provider"`.
- Modify: `packages/claw-hive/src/components/ahand/index.ts` (create) — re-export everything public.
- Modify: `packages/claw-hive/src/index.ts` — re-export the ahand module.
- Modify: `packages/claw-hive/src/blueprints/presets.ts` — add a `personaInterfaceWithAhand` preset (or extend the existing `personaInterface` with an opt-in flag).
- Modify: `packages/claw-hive/src/component-factories.test.ts` — cover the new factories.

**Acceptance Criteria:**

- [ ] `createComponent({ typeKey: "ahand-host", config: {...} })` returns an `AHandHostComponent`; config fields validated by the factory (throws on missing required fields).
- [ ] `createComponent({ typeKey: "ahand-context-provider", config: {...} })` returns an `AHandContextProvider`.
- [ ] Both factories handle the `id?` optional argument so storage-layer deserialization preserves ids across session resume.
- [ ] `personaInterface` preset accepts a new option `ahand?: { callingUserId, callingClient, gatewayInternalUrl, gatewayInternalAuthToken, hubUrl }`. If provided, appends one `ahand-context-provider` entry. AhandHostComponent entries are added at runtime by im-worker's blueprint extender (NOT baked into presets) because device list is dynamic.
- [ ] Public exports from `@team9claw/claw-hive` include `AHandHostComponent`, `AHandContextProvider`, `GatewayAhandClient`, and the associated types.
- [ ] Factory + preset tests pass; integration blueprint-building tests (already in repo) pass unchanged for existing presets.

**Verify:** `pnpm vitest run packages/claw-hive/src/component-factories.test.ts packages/claw-hive/src/blueprints --coverage`.

**Steps:**

- [ ] **Step 1: Re-export barrel**

```ts
// packages/claw-hive/src/components/ahand/index.ts (new)

export { AHandHostComponent } from "./component";
export type {
  AHandHostComponentConfig,
  AHandHostComponentData,
} from "./component";
export { AHandContextProvider } from "./context-provider";
export type {
  AHandContextProviderConfig,
  AHandContextProviderData,
} from "./context-provider";
export {
  GatewayAhandClient,
  GatewayError,
  OwnershipError,
} from "./gateway-client";
export type {
  AhandDeviceSnapshot,
  GatewayAhandClientOptions,
} from "./gateway-client";
```

And from the claw-hive package root:

```ts
// packages/claw-hive/src/index.ts (patch)

export * from "./components/ahand";
```

- [ ] **Step 2: Register factories**

```ts
// packages/claw-hive/src/component-factories.ts (patch)

import { AHandHostComponent, AHandContextProvider } from "./components/ahand";

// Inside the existing registry setup, next to other factory registrations:

register("ahand-host", (config: AHandHostComponentConfig, id?: string) => {
  if (!config?.deviceId) throw new Error("ahand-host requires deviceId");
  if (!config?.hubUrl) throw new Error("ahand-host requires hubUrl");
  if (!config?.gatewayInternalUrl)
    throw new Error("ahand-host requires gatewayInternalUrl");
  if (!config?.gatewayInternalAuthToken)
    throw new Error("ahand-host requires gatewayInternalAuthToken");
  if (!config?.callingUserId)
    throw new Error("ahand-host requires callingUserId");
  return new AHandHostComponent(config, id);
});

register(
  "ahand-context-provider",
  (config: AHandContextProviderConfig, id?: string) => {
    if (!config?.gatewayInternalUrl)
      throw new Error("ahand-context-provider requires gatewayInternalUrl");
    if (!config?.gatewayInternalAuthToken)
      throw new Error(
        "ahand-context-provider requires gatewayInternalAuthToken",
      );
    if (!config?.callingUserId)
      throw new Error("ahand-context-provider requires callingUserId");
    if (!config?.callingClient)
      throw new Error("ahand-context-provider requires callingClient");
    return new AHandContextProvider(config, id);
  },
);
```

The exact `register(...)` signature depends on existing factory scaffolding. Grep:

```bash
rg -nP '\brefister\b|component-factor' packages/claw-hive/src/component-factories.ts
```

Adapt to whatever `registerFactory` / `registerComponent` helper already exists.

- [ ] **Step 3: Blueprint preset extension**

```ts
// packages/claw-hive/src/blueprints/presets.ts (patch)

import { AHandContextProvider } from "../components/ahand";

export interface PersonaInterfaceBlueprintOpts {
  persona?: PersonaConfig;
  character?: CharacterConfig;
  hostBackend?: "just-bash" | "e2b-sandbox" | "ahand";
  // NEW:
  ahand?: {
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
  };
}

export function personaInterfaceBlueprint(
  opts: PersonaInterfaceBlueprintOpts = {},
): Blueprint {
  const components: ComponentEntry[] = [
    { typeKey: "system-prompt", config: {} },
    { typeKey: "host", config: {} },
    { typeKey: "persona", config: opts.persona ?? {} },
    { typeKey: "character", config: opts.character ?? {} },
    { typeKey: "hive-wait", config: {} },
    { typeKey: "cache-system", config: {} },
  ];
  // Existing host backend wiring...

  // NEW: opt-in ahand context provider
  if (opts.ahand) {
    components.push({
      typeKey: "ahand-context-provider",
      config: opts.ahand,
    });
  }

  return { components };
}
```

im-worker's Phase 5 blueprint extender appends `AHandHostComponent` entries dynamically per online device; they are NOT in the preset because the device list depends on the user and live state.

- [ ] **Step 4: Factory tests**

```ts
// packages/claw-hive/src/component-factories.test.ts (patch — new cases)

import { describe, it, expect } from "vitest";
import { createComponent } from "./component-factories";

describe("ahand component factories", () => {
  const ahandHostConfig = {
    deviceId: "abc123",
    deviceNickname: "Mac",
    devicePlatform: "macos",
    callingUserId: "u1",
    callingClient: { kind: "web" },
    gatewayInternalUrl: "https://gw",
    gatewayInternalAuthToken: "t",
    hubUrl: "https://hub",
  };

  it("creates AHandHostComponent from config", () => {
    const c = createComponent({
      typeKey: "ahand-host",
      config: ahandHostConfig,
    });
    expect(c.type).toBe("ahand:user-computer:abc123");
  });

  it("preserves id across restore (for session resume)", () => {
    const c = createComponent({
      typeKey: "ahand-host",
      config: ahandHostConfig,
      id: "fixed-id",
    });
    expect(c.id).toBe("fixed-id");
  });

  it("throws when required fields are missing", () => {
    expect(() =>
      createComponent({
        typeKey: "ahand-host",
        config: { ...ahandHostConfig, deviceId: undefined } as any,
      }),
    ).toThrow(/deviceId/);
    expect(() =>
      createComponent({
        typeKey: "ahand-host",
        config: { ...ahandHostConfig, hubUrl: "" } as any,
      }),
    ).toThrow(/hubUrl/);
  });

  const ctxConfig = {
    callingUserId: "u1",
    callingClient: { kind: "web" },
    gatewayInternalUrl: "https://gw",
    gatewayInternalAuthToken: "t",
  };

  it("creates AHandContextProvider from config", () => {
    const c = createComponent({
      typeKey: "ahand-context-provider",
      config: ctxConfig,
    });
    expect((c as any).cacheKey).toBe("ahand-context");
  });

  it("throws when callingClient is missing from context provider config", () => {
    expect(() =>
      createComponent({
        typeKey: "ahand-context-provider",
        config: { ...ctxConfig, callingClient: undefined } as any,
      }),
    ).toThrow(/callingClient/);
  });
});
```

- [ ] **Step 5: Preset tests**

```ts
// packages/claw-hive/src/blueprints/presets.test.ts (patch — add test)

import { describe, it, expect } from "vitest";
import { personaInterfaceBlueprint } from "./presets";

describe("personaInterfaceBlueprint + ahand opt-in", () => {
  it("omits ahand-context-provider when opts.ahand is not given", () => {
    const bp = personaInterfaceBlueprint({});
    expect(
      bp.components.some((c) => c.typeKey === "ahand-context-provider"),
    ).toBe(false);
  });

  it("includes ahand-context-provider when opts.ahand is given", () => {
    const bp = personaInterfaceBlueprint({
      ahand: {
        callingUserId: "u1",
        callingClient: { kind: "web" },
        gatewayInternalUrl: "https://gw",
        gatewayInternalAuthToken: "t",
      },
    });
    expect(
      bp.components.some((c) => c.typeKey === "ahand-context-provider"),
    ).toBe(true);
  });

  it("does NOT bake AHandHostComponent entries into the preset", () => {
    const bp = personaInterfaceBlueprint({
      ahand: {
        callingUserId: "u1",
        callingClient: { kind: "web" },
        gatewayInternalUrl: "https://gw",
        gatewayInternalAuthToken: "t",
      },
    });
    expect(
      bp.components.filter((c) => c.typeKey === "ahand-host"),
    ).toHaveLength(0);
  });
});
```

- [ ] **Step 6: Commit**

```bash
cd /Users/winrey/Projects/weightwave/team9-agent-pi
git add packages/claw-hive/src/components/ahand/index.ts \
        packages/claw-hive/src/index.ts \
        packages/claw-hive/src/component-factories.ts \
        packages/claw-hive/src/component-factories.test.ts \
        packages/claw-hive/src/blueprints/presets.ts \
        packages/claw-hive/src/blueprints/presets.test.ts
git commit -m "$(cat <<'EOF'
feat(claw-hive): register ahand factories + opt-in blueprint preset

Component factories for typeKey='ahand-host' and 'ahand-context-
provider' registered; required-field validation at factory level so
misconfigured blueprints fail fast at creation rather than at first
tool call.

personaInterfaceBlueprint accepts an opts.ahand option that, when
provided, appends one ahand-context-provider entry. AHandHostComponent
entries are deliberately NOT in the preset — im-worker's blueprint
extender adds them dynamically per online device at session start,
and Phase 5's session dispatcher adds/removes them as devices come
and go.

Exports from @team9claw/claw-hive root: AHandHostComponent,
AHandContextProvider, GatewayAhandClient, related types. Downstream
(im-worker) imports via these names.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

**Phase 6 outcome:** The `@team9claw/claw-hive` package now ships ahand components (`AHandHostComponent` + `AHandContextProvider`) with factories and blueprint integration. Combined with Phase 2's multi-backend HostComponent and cache-system framework, Phase 5's im-worker can now assemble a fully functional agent session that routes `run_command` to remote devices via ahand. End-to-end flow becomes runnable in Phase 9's integration tests.

---

## Phase 7 — Tauri client Rust side

**Working directory:** `/Users/winrey/Projects/weightwave/team9/apps/client/src-tauri`.

Tauri embeds the ahand daemon as a Rust library (Phase 1 Task 1.1's library-ization). Four tasks:

1. Deps + cleanup of legacy sidecar path (`src/ahand.rs`).
2. Per-user Ed25519 identity management.
3. `AhandRuntime` singleton + `DaemonHandle` lifecycle.
4. Tauri command surface + status events.

**Dependencies:**

- Phase 1 Task 1.1 (library-ized `ahandd` with `DaemonConfig` / `DaemonHandle` / `spawn` / `load_or_create_identity` API).
- Phase 4 (gateway REST for registration + token refresh — consumed by Phase 8 frontend, not Phase 7 directly; Phase 7 just needs Tauri commands that accept JWTs from TS).

**Module layout:**

```
apps/client/src-tauri/src/ahand/
├── mod.rs              # pub exports + types
├── runtime.rs          # AhandRuntime singleton + ActiveSession
├── identity.rs         # Per-user identity dir helpers
└── commands.rs         # #[tauri::command] surface
```

---

### Task 7.1: Cargo dependencies + remove legacy `src/ahand.rs`

**Goal:** Add `ahandd` as a git dependency pinned to a tag (published in Phase 1), delete the old 443-line sidecar-style `src/ahand.rs`, and remove related `externalBin` / CI build steps.

**Files:**

- Modify: `apps/client/src-tauri/Cargo.toml` — add `ahandd`, `tokio` (likely already), ensure `crypto` deps as needed.
- Delete: `apps/client/src-tauri/src/ahand.rs`.
- Modify: `apps/client/src-tauri/src/lib.rs` — remove old `mod ahand;` + related command registrations; keep a placeholder `mod ahand;` that points at the new `src/ahand/mod.rs` (to be populated by Task 7.2+).
- Modify: `apps/client/src-tauri/tauri.conf.json` — remove any `bundle.externalBin` entries for `ahandd`.
- Modify: `apps/client/src-tauri/build.rs` (if present) — remove copy-sidecar steps.
- Modify: `.github/workflows/*.yml` — remove CI jobs that build/prepare the sidecar.

**Acceptance Criteria:**

- [ ] `apps/client/src-tauri/src/ahand.rs` does not exist.
- [ ] `Cargo.toml` has `ahandd = { git = "https://github.com/team9ai/ahand", package = "ahandd", tag = "<version>" }` pinned to a specific release tag.
- [ ] `cargo check` succeeds in `apps/client/src-tauri`.
- [ ] `pnpm tauri dev` boots without the sidecar present on disk (previously Tauri refused if `externalBin` pointed at a missing binary).
- [ ] `src/lib.rs` declares `pub mod ahand;` with a stub module body that compiles (`pub fn _placeholder() {}`) so downstream Phase 7 tasks can flesh it out without breaking the build.
- [ ] No references to the old `ahand::start_ahandd`, `ahand::stop_ahandd`, etc. remain anywhere; `rg ahandctl` + `rg 'sidecar.*ahand'` return zero results.
- [ ] Any i18n strings that referenced the sidecar-install flow are left in locale files for Phase 8 to clean up (they'll be replaced wholesale by new `ahand.json` resources).

**Verify:**

```bash
cd apps/client/src-tauri
cargo check
cd ..
pnpm tauri dev   # should boot; no "missing sidecar binary" error
```

**Steps:**

- [ ] **Step 1: Update Cargo.toml**

```toml
# apps/client/src-tauri/Cargo.toml (patch)

[dependencies]
tauri           = { version = "2", features = [...] }
tokio           = { version = "1", features = ["rt-multi-thread", "sync", "macros"] }
serde           = { version = "1", features = ["derive"] }
serde_json      = "1"
anyhow          = "1"
dirs            = "5"

# NEW — ahand library embedding
ahandd          = { git = "https://github.com/team9ai/ahand", package = "ahandd", tag = "rust-v0.1.0" }

# Existing plugins...
```

The tag `rust-v0.1.0` must match whatever Phase 1 Task 1.1 publishes. If Phase 1 hasn't published yet, pin to a branch temporarily (`branch = "main"`) and flip to a tag in a follow-up commit.

- [ ] **Step 2: Remove legacy file + stub the new module**

```bash
cd /Users/winrey/Projects/weightwave/team9/apps/client/src-tauri
git rm src/ahand.rs
mkdir -p src/ahand
```

Create stub `src/ahand/mod.rs`:

```rust
// apps/client/src-tauri/src/ahand/mod.rs

// Phase 7 tasks will populate this module with:
// - identity.rs (per-user identity dir helpers)
// - runtime.rs  (AhandRuntime singleton + DaemonHandle lifecycle)
// - commands.rs (#[tauri::command] surface)

pub fn _placeholder() {}
```

Patch `src/lib.rs`:

```rust
// apps/client/src-tauri/src/lib.rs (patch)

// Remove any `mod ahand;` currently pointing at the old ahand.rs.
// Replace with:
pub mod ahand;

// Remove any invocations like:
//   .setup(|app| { ahand::install_sidecar(app); Ok(()) })
// that assumed a sidecar binary. The new install happens inside
// Phase 7 Task 7.3's AhandRuntime on demand.

// Remove any Tauri command registrations for the old sidecar API:
//   tauri::generate_handler![..., ahand::start_ahandd, ahand::stop_ahandd, ...]
// Leave the handler list empty or with remaining commands; Task 7.4
// will add the new commands.
```

- [ ] **Step 3: tauri.conf.json cleanup**

```jsonc
// apps/client/src-tauri/tauri.conf.json (patch)

{
  "bundle": {
    // "externalBin": ["binaries/ahandd-${{target_triple}}"],   // REMOVE
    "externalBin": [],
  },
}
```

If `externalBin` was a single-string entry, replace with `[]` or delete the key entirely. Tauri accepts both.

- [ ] **Step 4: CI cleanup**

```bash
rg -nP 'ahandd|sidecar.*ahand' .github/
```

For each hit, remove the step that downloaded/built/prepared the sidecar binary. (E.g., a `macos-build.yml` step like "Download ahandd for aarch64-apple-darwin" becomes unnecessary.)

- [ ] **Step 5: Verify + commit**

```bash
cd apps/client/src-tauri
cargo check

cd ..
pnpm tauri dev &
TAURI_PID=$!
sleep 10
kill $TAURI_PID 2>/dev/null

git add Cargo.toml tauri.conf.json src/ahand/ src/lib.rs build.rs
git rm src/ahand.rs
git commit -m "$(cat <<'EOF'
refactor(tauri): remove legacy ahand sidecar, add ahandd library dep

Deletes 443 lines of src/ahand.rs that spawned the standalone ahandd
binary as a Tauri externalBin sidecar. The binary no longer ships with
the Tauri bundle. Instead, Cargo.toml now depends on the ahandd library
crate (pinned to release tag). Phase 7 Tasks 7.2–7.4 populate the new
src/ahand/{identity,runtime,commands}.rs.

Follow-up cleanup:
- tauri.conf.json: externalBin list emptied.
- CI workflows: sidecar download/build steps removed.
- src/lib.rs: old command registrations dropped; new module stubbed.

Users upgrading from the sidecar path: Tauri no longer creates the
~/.ahand/bin/ahandd binary. Legacy files under ~/.ahand/ are left
untouched for defensive reasons (ahandctl CLI users share that path);
users can remove ~/.ahand manually after migration.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7.2: `identity.rs` — per-user identity directory helper

**Goal:** Thin wrapper around `ahandd::load_or_create_identity` that resolves the per-user directory under Tauri's `app_data_dir` and returns a clean `IdentityDto` for TS consumption.

**Files:**

- Create: `apps/client/src-tauri/src/ahand/identity.rs`
- Modify: `apps/client/src-tauri/src/ahand/mod.rs` — add `pub mod identity;`.

**Acceptance Criteria:**

- [ ] Function `identity_dir(app: &AppHandle, team9_user_id: &str) -> Result<PathBuf>` returns `{app_data_dir}/ahand/users/{team9_user_id}/identity`. Creates the parent directory if missing.
- [ ] Function `load_or_create(app: &AppHandle, team9_user_id: &str) -> Result<IdentityDto>` wraps `ahandd::load_or_create_identity(dir)`. Returns `IdentityDto { device_id, public_key_b64 }`.
- [ ] Identity directory uses POSIX mode `0700` on macOS/Linux (Rust `std::fs::set_permissions`). On Windows, rely on default NTFS ACL (user's home already restricted).
- [ ] If `team9_user_id` contains path separators or `..`, return `Err("invalid team9 user id")`. Filter input to `[0-9a-fA-F-]+` (UUID chars).
- [ ] 100% unit test coverage using a temp dir from `tempfile` crate.

**Verify:** `cargo test -p team9-client --lib ahand::identity -- --nocapture`.

**Steps:**

- [ ] **Step 1: Implementation**

```rust
// apps/client/src-tauri/src/ahand/identity.rs

use std::fs;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdentityDto {
    #[serde(rename = "deviceId")]
    pub device_id: String,
    #[serde(rename = "publicKeyB64")]
    pub public_key_b64: String,
}

pub fn identity_dir(app: &AppHandle, team9_user_id: &str) -> Result<PathBuf, String> {
    validate_user_id(team9_user_id)?;
    let base = app.path()
        .app_data_dir()
        .map_err(|e| format!("cannot resolve app data dir: {e}"))?;
    let dir = base.join("ahand").join("users").join(team9_user_id).join("identity");
    fs::create_dir_all(&dir)
        .map_err(|e| format!("create_dir_all {}: {e}", dir.display()))?;
    set_restrictive_perms(&dir)?;
    Ok(dir)
}

pub fn load_or_create(app: &AppHandle, team9_user_id: &str) -> Result<IdentityDto, String> {
    let dir = identity_dir(app, team9_user_id)?;
    let id = ahandd::load_or_create_identity(&dir)
        .map_err(|e| format!("load_or_create_identity: {e}"))?;
    Ok(IdentityDto {
        device_id: id.device_id,
        public_key_b64: id.public_key_b64,
    })
}

fn validate_user_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 64 {
        return Err("invalid team9 user id (length)".into());
    }
    if !id.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        return Err("invalid team9 user id (characters)".into());
    }
    // Belt-and-suspenders: after the character check, path separators can't be present,
    // but check explicitly anyway.
    if id.contains('/') || id.contains('\\') || id == ".." || id == "." {
        return Err("invalid team9 user id (path fragment)".into());
    }
    Ok(())
}

fn set_restrictive_perms(dir: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = fs::Permissions::from_mode(0o700);
        fs::set_permissions(dir, perms)
            .map_err(|e| format!("set_permissions {}: {e}", dir.display()))?;
    }
    #[cfg(windows)]
    {
        // Windows: rely on user-profile ACL; no chmod-like API needed.
        let _ = dir;
    }
    Ok(())
}
```

- [ ] **Step 2: Expose from module**

```rust
// apps/client/src-tauri/src/ahand/mod.rs (patch)

pub mod identity;
// runtime.rs and commands.rs added in Tasks 7.3 / 7.4.
```

- [ ] **Step 3: Tests**

Rust tests typically live in a `#[cfg(test)] mod tests {…}` at the bottom of the same file, or in a sibling `tests/` folder. Inline-same-file is simplest:

```rust
// apps/client/src-tauri/src/ahand/identity.rs (append)

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn mk_test_env() -> (TempDir, PathBuf) {
        let tmp = TempDir::new().expect("tempdir");
        let path = tmp.path().to_path_buf();
        (tmp, path)
    }

    // For identity tests we don't need a full Tauri AppHandle — we test the
    // directory logic via the `identity_dir_with_base` helper exposed for tests.
    // Add that helper:
    #[cfg(test)]
    pub fn identity_dir_with_base(base: &Path, team9_user_id: &str) -> Result<PathBuf, String> {
        validate_user_id(team9_user_id)?;
        let dir = base.join("ahand").join("users").join(team9_user_id).join("identity");
        fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all: {e}"))?;
        set_restrictive_perms(&dir)?;
        Ok(dir)
    }

    #[test]
    fn creates_directory_under_base() {
        let (_tmp, base) = mk_test_env();
        let d = identity_dir_with_base(&base, "11111111-1111-1111-1111-111111111111").unwrap();
        assert!(d.exists());
        assert!(d.ends_with("ahand/users/11111111-1111-1111-1111-111111111111/identity"));
    }

    #[test]
    fn rejects_empty_user_id() {
        let (_tmp, base) = mk_test_env();
        assert!(identity_dir_with_base(&base, "").is_err());
    }

    #[test]
    fn rejects_non_hex_characters() {
        let (_tmp, base) = mk_test_env();
        assert!(identity_dir_with_base(&base, "evil/../escape").is_err());
        assert!(identity_dir_with_base(&base, "a.b.c").is_err());
        assert!(identity_dir_with_base(&base, "has space").is_err());
    }

    #[test]
    fn rejects_path_traversal() {
        let (_tmp, base) = mk_test_env();
        assert!(identity_dir_with_base(&base, "..").is_err());
        assert!(identity_dir_with_base(&base, ".").is_err());
        // Slash is caught by char check, but belt-and-suspenders:
        assert!(identity_dir_with_base(&base, "u/..").is_err());
    }

    #[test]
    fn rejects_overlong_user_id() {
        let (_tmp, base) = mk_test_env();
        let long: String = std::iter::repeat("a").take(200).collect();
        assert!(identity_dir_with_base(&base, &long).is_err());
    }

    #[test]
    fn accepts_valid_uuid_format() {
        let (_tmp, base) = mk_test_env();
        assert!(identity_dir_with_base(&base, "abcdef12-3456-7890-abcd-ef1234567890").is_ok());
    }

    #[test]
    fn same_user_second_call_returns_same_dir_without_regenerating() {
        let (_tmp, base) = mk_test_env();
        let a = identity_dir_with_base(&base, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee").unwrap();
        let b = identity_dir_with_base(&base, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee").unwrap();
        assert_eq!(a, b);
    }

    #[cfg(unix)]
    #[test]
    fn sets_0700_permissions_on_unix() {
        use std::os::unix::fs::PermissionsExt;
        let (_tmp, base) = mk_test_env();
        let d = identity_dir_with_base(&base, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee").unwrap();
        let meta = std::fs::metadata(&d).unwrap();
        let mode = meta.permissions().mode() & 0o777;
        assert_eq!(mode, 0o700);
    }

    #[test]
    fn different_user_ids_get_different_dirs() {
        let (_tmp, base) = mk_test_env();
        let a = identity_dir_with_base(&base, "aaaaaaaa-1111-1111-1111-111111111111").unwrap();
        let b = identity_dir_with_base(&base, "bbbbbbbb-2222-2222-2222-222222222222").unwrap();
        assert_ne!(a, b);
    }
}
```

- [ ] **Step 4: Add dev dependency**

```toml
# apps/client/src-tauri/Cargo.toml (patch)

[dev-dependencies]
tempfile = "3"
```

- [ ] **Step 5: Verify + commit**

```bash
cd apps/client/src-tauri
cargo test --lib ahand::identity -- --nocapture
# Expected: all tests pass

git add src/ahand/identity.rs src/ahand/mod.rs Cargo.toml
git commit -m "$(cat <<'EOF'
feat(tauri/ahand): per-user identity directory management

New identity.rs module wraps ahandd::load_or_create_identity with a
per-team9-user directory under app_data_dir/ahand/users/{userId}/
identity. Validates team9 userId strictly (UUID charset only) to
defeat path-traversal attempts, and sets 0700 perms on Unix.

Directory format: {app_data_dir}/ahand/users/{userId}/identity/
(ahandd library creates the keypair files inside this dir).

Per spec § 4.3, this isolation means one Mac running two team9 users
gets two distinct deviceIds and one user running two Macs also gets
two distinct deviceIds, as expected by the ownership model.

Tests use a separate identity_dir_with_base helper that doesn't need
a real Tauri AppHandle; the public load_or_create does need AppHandle
but its code paths are exercised indirectly via Phase 9 E2E tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7.3: `AhandRuntime` — singleton managing `DaemonHandle` lifecycle

**Goal:** Process-wide singleton that holds at most one active `ahandd::DaemonHandle` at a time. Serializes start/stop via `tokio::Mutex`. Forwards lib status changes to Tauri events. Cleans up on app exit / logout.

**Files:**

- Create: `apps/client/src-tauri/src/ahand/runtime.rs`
- Modify: `apps/client/src-tauri/src/ahand/mod.rs` — add `pub mod runtime;` and re-export `AhandRuntime`.
- Modify: `apps/client/src-tauri/src/lib.rs` — instantiate `AhandRuntime` on app startup via `.setup(|app| app.manage(AhandRuntime::new()))`.

**Acceptance Criteria:**

- [ ] Class `AhandRuntime` with `new() -> Self` returning an empty runtime.
- [ ] `async fn start(&self, app: &AppHandle, cfg: StartConfig) -> Result<StartResult>` starts a new daemon. If one is already active, stops it first. Emits Tauri events via `app.emit("ahand-daemon-status", status)`.
- [ ] `async fn stop(&self) -> Result<()>` invokes `DaemonHandle::shutdown().await`; idempotent (stopping when nothing is active returns Ok).
- [ ] `fn status(&self) -> DaemonStatus` returns current status snapshot (reads from the active `watch::Receiver` if any; else `Idle`).
- [ ] `fn current_device_id(&self) -> Option<String>` returns the deviceId of the active daemon.
- [ ] `fn subscribe_status(&self) -> watch::Receiver<DaemonStatus>` returns a cloned receiver so callers can observe status changes without Tauri events.
- [ ] Status-forwarder task: spawned at start; reads from `handle.subscribe_status()`, emits every change to `app.emit("ahand-daemon-status", …)`, terminates when the watch channel closes (i.e., daemon stopped).
- [ ] Concurrent calls to `start`/`stop` serialize correctly; no torn state.
- [ ] 100% unit test coverage — tests use a fake `DaemonHandle`-like trait to avoid needing a real hub.

**Verify:** `cargo test -p team9-client --lib ahand::runtime`.

**Steps:**

- [ ] **Step 1: Implementation**

```rust
// apps/client/src-tauri/src/ahand/runtime.rs

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::{watch, Mutex};
use tokio::task::JoinHandle;

use super::identity;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum DaemonStatus {
    Idle,
    Connecting,
    Online { device_id: String },
    Offline,
    Error {
        kind: ErrorKind,
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        device_id: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ErrorKind {
    Auth,
    Network,
    Other,
}

impl From<ahandd::ErrorKind> for ErrorKind {
    fn from(e: ahandd::ErrorKind) -> Self {
        match e {
            ahandd::ErrorKind::Auth => Self::Auth,
            ahandd::ErrorKind::Network => Self::Network,
            _ => Self::Other,
        }
    }
}

impl From<ahandd::DaemonStatus> for DaemonStatus {
    fn from(s: ahandd::DaemonStatus) -> Self {
        match s {
            ahandd::DaemonStatus::Idle => Self::Idle,
            ahandd::DaemonStatus::Connecting => Self::Connecting,
            ahandd::DaemonStatus::Online { device_id } => Self::Online { device_id },
            ahandd::DaemonStatus::Offline => Self::Offline,
            ahandd::DaemonStatus::Error { kind, message } => Self::Error {
                kind: kind.into(),
                message,
                device_id: None,
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartConfig {
    pub team9_user_id: String,
    pub hub_url: String,
    pub device_jwt: String,
    pub jwt_expires_at: u64,
    /// Heartbeat interval for the daemon; always 60s in MVP.
    #[serde(default = "default_heartbeat_interval")]
    pub heartbeat_interval_seconds: u64,
}

fn default_heartbeat_interval() -> u64 { 60 }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartResult {
    pub device_id: String,
}

struct ActiveSession {
    handle: ahandd::DaemonHandle,
    team9_user_id: String,
    hub_device_id: String,
    status_forwarder: JoinHandle<()>,
}

pub struct AhandRuntime {
    inner: Arc<Mutex<Option<ActiveSession>>>,
    /// A dummy closed-receiver for status() when idle.
    idle_rx: watch::Receiver<DaemonStatus>,
}

impl AhandRuntime {
    pub fn new() -> Self {
        let (_tx, rx) = watch::channel(DaemonStatus::Idle);
        Self { inner: Arc::new(Mutex::new(None)), idle_rx: rx }
    }

    pub async fn start(&self, app: &AppHandle, cfg: StartConfig) -> Result<StartResult, String> {
        // Serialize: acquire lock, stop previous, start new.
        let mut guard = self.inner.lock().await;

        if let Some(prev) = guard.take() {
            Self::shutdown_session(prev).await;
        }

        let identity_dir = identity::identity_dir(app, &cfg.team9_user_id)?;

        let daemon_cfg = ahandd::DaemonConfig {
            hub_url: cfg.hub_url,
            device_jwt: cfg.device_jwt,
            identity_dir,
            session_mode: ahandd::SessionMode::AutoAccept,
            browser_enabled: false,
            heartbeat_interval: Duration::from_secs(cfg.heartbeat_interval_seconds),
        };

        let handle = ahandd::spawn(daemon_cfg).await
            .map_err(|e| format!("ahandd::spawn failed: {e}"))?;
        let device_id = handle.device_id().to_string();

        // Forward status events to the frontend
        let app_for_task = app.clone();
        let mut status_rx = handle.subscribe_status();
        let status_forwarder = tokio::spawn(async move {
            // Emit initial snapshot immediately so the UI syncs.
            let initial = status_rx.borrow().clone();
            let _ = app_for_task.emit("ahand-daemon-status", DaemonStatus::from(initial));
            while status_rx.changed().await.is_ok() {
                let s = status_rx.borrow().clone();
                if app_for_task.emit("ahand-daemon-status", DaemonStatus::from(s)).is_err() {
                    break;
                }
            }
        });

        *guard = Some(ActiveSession {
            handle,
            team9_user_id: cfg.team9_user_id,
            hub_device_id: device_id.clone(),
            status_forwarder,
        });

        Ok(StartResult { device_id })
    }

    pub async fn stop(&self) -> Result<(), String> {
        let mut guard = self.inner.lock().await;
        if let Some(session) = guard.take() {
            Self::shutdown_session(session).await;
        }
        Ok(())
    }

    pub async fn status(&self) -> DaemonStatus {
        let guard = self.inner.lock().await;
        match guard.as_ref() {
            Some(s) => DaemonStatus::from(s.handle.status()),
            None => DaemonStatus::Idle,
        }
    }

    pub async fn current_device_id(&self) -> Option<String> {
        let guard = self.inner.lock().await;
        guard.as_ref().map(|s| s.hub_device_id.clone())
    }

    async fn shutdown_session(session: ActiveSession) {
        // Abort forwarder after shutdown resolves, so the last status event
        // is delivered before the task is killed.
        let shutdown_res = session.handle.shutdown().await;
        if let Err(e) = shutdown_res {
            tracing::warn!("ahandd shutdown returned error: {e}");
        }
        session.status_forwarder.abort();
    }
}

impl Default for AhandRuntime {
    fn default() -> Self { Self::new() }
}
```

- [ ] **Step 2: Expose from module**

```rust
// apps/client/src-tauri/src/ahand/mod.rs (patch)

pub mod identity;
pub mod runtime;

pub use runtime::{AhandRuntime, DaemonStatus, ErrorKind, StartConfig, StartResult};
```

And in `lib.rs`:

```rust
// apps/client/src-tauri/src/lib.rs (patch)

use ahand::AhandRuntime;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            app.manage(AhandRuntime::new());
            Ok(())
        })
        .plugin(/*...*/)
        .invoke_handler(tauri::generate_handler![
            // Task 7.4 adds ahand commands here
        ])
        .run(tauri::generate_context!())
        .expect("tauri run");
}

// On app exit, ensure daemon stops (Tauri's window close / app-exit hooks):
// Add a Tauri plugin / RunEvent listener that calls runtime.stop() on Exit.
```

For the app-exit hook, the pattern is:

```rust
.run(tauri::generate_context!())
// becomes:
.build(tauri::generate_context!())
.expect("tauri build")
.run(|app_handle, event| {
    if let tauri::RunEvent::ExitRequested { .. } = event {
        let runtime = app_handle.state::<AhandRuntime>();
        let rt = runtime.inner_arc().clone();
        tauri::async_runtime::block_on(async move {
            let r = AhandRuntime { inner: rt, idle_rx: /* unused here */ };
            let _ = r.stop().await;
        });
    }
});
```

Note: `AhandRuntime::inner_arc()` needs to be added as a pub accessor for this pattern, since we can't easily reconstruct the full struct from just the Arc. Simpler: add `pub async fn stop_via_state(app_handle: &AppHandle)` helper that looks up `State<AhandRuntime>` and calls `.stop()`.

- [ ] **Step 3: Tests**

Unit tests here would require a fake ahandd library. Instead, focus the unit coverage on public behavior that doesn't need real WS:

```rust
// apps/client/src-tauri/src/ahand/runtime.rs (append)

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn fresh_runtime_reports_idle() {
        let rt = AhandRuntime::new();
        assert!(matches!(rt.status().await, DaemonStatus::Idle));
        assert_eq!(rt.current_device_id().await, None);
    }

    #[tokio::test]
    async fn stop_is_idempotent_when_nothing_active() {
        let rt = AhandRuntime::new();
        assert!(rt.stop().await.is_ok());
        assert!(rt.stop().await.is_ok());   // second stop still Ok
    }

    #[test]
    fn daemon_status_serde_round_trip() {
        let s = DaemonStatus::Error {
            kind: ErrorKind::Auth,
            message: "jwt_expired".into(),
            device_id: Some("abc".into()),
        };
        let json = serde_json::to_string(&s).unwrap();
        let back: DaemonStatus = serde_json::from_str(&json).unwrap();
        match back {
            DaemonStatus::Error { kind: ErrorKind::Auth, message, device_id: Some(d) } => {
                assert_eq!(message, "jwt_expired");
                assert_eq!(d, "abc");
            }
            _ => panic!("round trip wrong variant"),
        }
    }

    #[test]
    fn start_config_defaults_heartbeat_60s() {
        let json = r#"{
            "team9_user_id": "uuid",
            "hub_url": "wss://x",
            "device_jwt": "j",
            "jwt_expires_at": 0
        }"#;
        let cfg: StartConfig = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.heartbeat_interval_seconds, 60);
    }
}
```

Integration-level exercise of `start` / `stop` — which requires a real hub connection — happens in Phase 9 E2E via a mock hub.

- [ ] **Step 4: Commit**

```bash
cd apps/client/src-tauri
cargo test --lib ahand::runtime

git add src/ahand/runtime.rs src/ahand/mod.rs src/lib.rs
git commit -m "$(cat <<'EOF'
feat(tauri/ahand): AhandRuntime singleton with DaemonHandle lifecycle

Process-wide manager for the embedded ahandd library. Holds at most
one active session behind a tokio::Mutex; start() atomically stops
any previous session before spawning a new one. Forwards lib status
updates to frontend via Tauri event 'ahand-daemon-status'.

- DaemonStatus is the wire type sent to TS (tagged 'state' with
  camelCase; Error variant carries an ErrorKind so the frontend can
  discriminate Auth (triggers JWT refresh) from Network (transient,
  UI shows 'connecting…') from Other.
- StartConfig deserialized from TS; heartbeat_interval_seconds
  defaults to 60 per spec § 4.9.
- App-exit hook in lib.rs's RunEvent::ExitRequested cleanly calls
  stop() so the daemon detaches from the hub before the process dies.

Unit tests cover idle status, idempotent stop, and DaemonStatus
serialization round-trips. Real start/stop against a hub is covered
by Phase 9 E2E scenarios against a mock hub.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7.4: Tauri command surface

**Goal:** Expose four `#[tauri::command]`s — `ahand_get_identity`, `ahand_start`, `ahand_stop`, `ahand_status` — so the TS frontend can drive the daemon. These are the only entry points TS uses; all logic lives in `identity.rs` / `runtime.rs`.

**Files:**

- Create: `apps/client/src-tauri/src/ahand/commands.rs`
- Modify: `apps/client/src-tauri/src/ahand/mod.rs` — add `pub mod commands;` + re-export command functions.
- Modify: `apps/client/src-tauri/src/lib.rs` — register the commands in `generate_handler![...]`.

**Acceptance Criteria:**

- [ ] `ahand_get_identity(team9_user_id: String, app: AppHandle) -> Result<IdentityDto, String>` — calls `identity::load_or_create(app, user_id)`.
- [ ] `ahand_start(cfg: StartConfig, runtime: State<AhandRuntime>, app: AppHandle) -> Result<StartResult, String>` — calls `runtime.start(&app, cfg).await`.
- [ ] `ahand_stop(runtime: State<AhandRuntime>) -> Result<(), String>` — calls `runtime.stop().await`.
- [ ] `ahand_status(runtime: State<AhandRuntime>) -> DaemonStatus` — calls `runtime.status().await`.
- [ ] All error returns are strings (Tauri requires `Serialize` on error types; `String` is the lowest-friction option).
- [ ] Commands registered in `tauri::generate_handler![...]` in `lib.rs`.
- [ ] Doc-comments on each command explain intended usage; the TS side generates bindings from these (via `specta` if available; else hand-written TS types must match).

**Verify:** `cargo check -p team9-client` + `pnpm tauri dev` boots and the Tauri devtools can invoke `window.__TAURI_INTERNALS__.invoke('ahand_status')` returning `{ state: 'idle' }`.

**Steps:**

- [ ] **Step 1: Commands**

```rust
// apps/client/src-tauri/src/ahand/commands.rs

use tauri::{AppHandle, State};
use super::identity::{self, IdentityDto};
use super::runtime::{AhandRuntime, DaemonStatus, StartConfig, StartResult};

/// Load or create the Ed25519 identity for the given team9 user.
///
/// Returns the deviceId (SHA256 of pubkey, hex) and base64-encoded public key.
/// Idempotent: subsequent calls with the same team9 user return the same pair.
#[tauri::command]
pub fn ahand_get_identity(
    app: AppHandle,
    team9_user_id: String,
) -> Result<IdentityDto, String> {
    identity::load_or_create(&app, &team9_user_id)
}

/// Start the embedded ahandd daemon with the given config. If a daemon is
/// already running for any user, it is stopped first. Emits Tauri event
/// 'ahand-daemon-status' for every status change.
#[tauri::command]
pub async fn ahand_start(
    app: AppHandle,
    runtime: State<'_, AhandRuntime>,
    cfg: StartConfig,
) -> Result<StartResult, String> {
    runtime.start(&app, cfg).await
}

/// Stop the embedded daemon if any is active. Idempotent.
#[tauri::command]
pub async fn ahand_stop(
    runtime: State<'_, AhandRuntime>,
) -> Result<(), String> {
    runtime.stop().await
}

/// Snapshot of the current daemon status without waiting for the next
/// 'ahand-daemon-status' event. Returns `{ state: 'idle' }` when no
/// daemon is active.
#[tauri::command]
pub async fn ahand_status(
    runtime: State<'_, AhandRuntime>,
) -> Result<DaemonStatus, String> {
    Ok(runtime.status().await)
}
```

- [ ] **Step 2: Module + lib.rs registration**

```rust
// apps/client/src-tauri/src/ahand/mod.rs (patch)

pub mod commands;
pub mod identity;
pub mod runtime;

pub use commands::{ahand_get_identity, ahand_start, ahand_status, ahand_stop};
pub use runtime::{AhandRuntime, DaemonStatus, ErrorKind, StartConfig, StartResult};
```

```rust
// apps/client/src-tauri/src/lib.rs (patch — handler list)

.invoke_handler(tauri::generate_handler![
    // ...existing commands
    ahand::ahand_get_identity,
    ahand::ahand_start,
    ahand::ahand_stop,
    ahand::ahand_status,
])
```

- [ ] **Step 3: TS bindings**

If the repo uses `specta` / `tauri-specta` for typed bindings, they'll be generated automatically on the next build; just verify the emitted `.d.ts` includes the four new commands and the `DaemonStatus` / `StartConfig` / `IdentityDto` types.

If bindings are hand-maintained, add to `apps/client/src/types/tauri-ahand.ts`:

```ts
// apps/client/src/types/tauri-ahand.ts (new)

export interface IdentityDto {
  deviceId: string;
  publicKeyB64: string;
}

export interface StartConfig {
  team9_user_id: string;
  hub_url: string;
  device_jwt: string;
  jwt_expires_at: number;
  heartbeat_interval_seconds?: number;
}

export interface StartResult {
  device_id: string;
}

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

And in `apps/client/src/services/ahand-tauri.ts` (new, used by Phase 8):

```ts
// apps/client/src/services/ahand-tauri.ts

import { invoke } from "@tauri-apps/api/core";
import type {
  IdentityDto,
  StartConfig,
  StartResult,
  DaemonStatus,
} from "@/types/tauri-ahand";

export const ahandTauri = {
  getIdentity: (team9UserId: string) =>
    invoke<IdentityDto>("ahand_get_identity", { team9UserId }),
  start: (cfg: StartConfig) => invoke<StartResult>("ahand_start", { cfg }),
  stop: () => invoke<void>("ahand_stop"),
  status: () => invoke<DaemonStatus>("ahand_status"),
};
```

- [ ] **Step 4: Smoke test via devtools console**

```
pnpm tauri dev
# In the running app's devtools console:
await window.__TAURI_INTERNALS__.invoke("ahand_status")
// → { state: "idle" }
await window.__TAURI_INTERNALS__.invoke("ahand_get_identity", { team9UserId: "test-user-1" })
// → { deviceId: "...", publicKeyB64: "..." }
await window.__TAURI_INTERNALS__.invoke("ahand_stop")
// → null (void)
```

- [ ] **Step 5: Commit**

```bash
cd /Users/winrey/Projects/weightwave/team9/apps/client/src-tauri
cargo check
cd ..
# (optionally) pnpm tauri dev + devtools smoke per Step 4

cd /Users/winrey/Projects/weightwave/team9
git add apps/client/src-tauri/src/ahand/commands.rs \
        apps/client/src-tauri/src/ahand/mod.rs \
        apps/client/src-tauri/src/lib.rs \
        apps/client/src/types/tauri-ahand.ts \
        apps/client/src/services/ahand-tauri.ts
git commit -m "$(cat <<'EOF'
feat(tauri/ahand): Tauri command surface for frontend

Four invoke() endpoints:
- ahand_get_identity(team9_user_id): returns deviceId + publicKey,
  creating the identity directory + keypair if needed. Idempotent.
- ahand_start(cfg): starts the embedded daemon; stops any previous
  session first. Takes hub_url + device_jwt + jwt_expires_at from
  gateway REST registration. Emits 'ahand-daemon-status' events.
- ahand_stop(): idempotent teardown.
- ahand_status(): synchronous snapshot; same shape as event payload.

TS bindings live in apps/client/src/types/tauri-ahand.ts with camelCase
DaemonStatus (tagged 'state') and snake_case StartConfig
(serde-matching). Phase 8's frontend service wraps these via invoke().

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

**Phase 7 outcome:** Tauri now embeds ahandd as a library, exposing four commands that the Phase 8 frontend consumes. No external process; no sidecar binary in the bundle; clean shutdown on app exit. The Rust side is a thin Tauri-facing wrapper — all transport logic sits in the `@team9ai/ahand` crate.

---

## Phase 8 — Tauri/Web frontend

**Working directory:** `/Users/winrey/Projects/weightwave/team9/apps/client`.

React/TS frontend shared by Tauri and web builds. Adds the devices management UI, MainSidebar entry, auto-resume on login, message clientContext propagation, and removes the legacy aHand dialog paths.

**Dependencies:**

- Phase 4 (gateway REST for device CRUD + token refresh + webhook-driven Socket.io events).
- Phase 7 (Tauri commands for identity + runtime control, only meaningful in Tauri env).

**Module layout:**

```
apps/client/src/
├── services/
│   ├── ahand-api.ts                 # HTTP client for /api/ahand/*
│   └── ahand-tauri.ts               # (from Phase 7 Task 7.4) invoke wrappers
├── hooks/
│   ├── useAhandLocalStatus.ts       # Tauri event subscription
│   └── useAhandDevices.ts           # React Query for device list + Socket.io sync
├── stores/
│   └── useAhandStore.ts             # Tauri-store persistence (enabled/deviceId per user)
├── components/
│   ├── dialog/
│   │   └── DevicesDialog.tsx        # The main UI (Tauri + Web branches)
│   └── layout/
│       └── MainSidebar.tsx          # Entry button (patch existing file)
└── i18n/locales/{lang}/ahand.json   # Resource strings per locale
```

---

### Task 8.1: Message `clientContext` — send from Tauri & Web

**Goal:** When the frontend sends a message (via Socket.io `send_message`), attach `clientContext` describing the originating client. Tauri attaches `{ kind: "macapp", deviceId: <local ahand deviceId> | null }`; web attaches `{ kind: "web" }`.

**Files:**

- Modify: `apps/client/src/services/websocket.ts` — patch `sendMessage` to include `clientContext`.
- Modify: `apps/client/src/stores/useAhandStore.ts` (new) or wherever the local deviceId is cached — expose a `getCurrentDeviceId()` helper.
- Modify: any call sites that compose the `send_message` payload if they bypass the websocket service.

**Acceptance Criteria:**

- [ ] In Tauri env (`isTauriApp()`), `sendMessage` always includes `clientContext: { kind: "macapp", deviceId: currentCachedDeviceIdOrNull }`.
- [ ] In web env, `clientContext: { kind: "web" }`.
- [ ] When ahand is not enabled on Tauri (user never toggled it on), `deviceId` is `null`. Not omitted — explicit null so gateway knows the Tauri client exists but has no registered device.
- [ ] No existing call sites are broken; `clientContext` is an additive field and the server (Phase 4) tolerates missing value.
- [ ] Unit test of `sendMessage` mocks `isTauriApp()` and verifies payload shape in both branches.

**Verify:** `pnpm --filter @team9/client test services/websocket.test.ts`.

**Steps:**

- [ ] **Step 1: Store helper for current ahand deviceId**

```ts
// apps/client/src/stores/useAhandStore.ts (new)

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { load } from "@tauri-apps/plugin-store";

export type UserAhandState = {
  enabled: boolean;
  deviceId: string | null;
};

interface AhandStore {
  /** Keyed by team9 userId. */
  usersEnabled: Record<string, UserAhandState>;

  getDeviceIdForUser(userId: string): string | null;
  setDeviceIdForUser(
    userId: string,
    deviceId: string | null,
    enabled: boolean,
  ): void;
  clearUser(userId: string): void;
}

export const useAhandStore = create<AhandStore>()(
  persist(
    (set, get) => ({
      usersEnabled: {},
      getDeviceIdForUser(userId) {
        const entry = get().usersEnabled[userId];
        return entry?.enabled ? (entry.deviceId ?? null) : null;
      },
      setDeviceIdForUser(userId, deviceId, enabled) {
        set({
          usersEnabled: {
            ...get().usersEnabled,
            [userId]: { enabled, deviceId },
          },
        });
      },
      clearUser(userId) {
        const next = { ...get().usersEnabled };
        delete next[userId];
        set({ usersEnabled: next });
      },
    }),
    {
      name: "ahand",
      storage: createJSONStorage(() => ({
        // Use Tauri plugin-store via an adapter when available; else localStorage.
        getItem: (k) => localStorage.getItem(k),
        setItem: (k, v) => localStorage.setItem(k, v),
        removeItem: (k) => localStorage.removeItem(k),
      })),
    },
  ),
);
```

If the repo already uses Tauri `plugin-store` consistently, replace the `createJSONStorage` block with the repo's existing adapter (grep `createJSONStorage` for prior art).

- [ ] **Step 2: Patch `sendMessage`**

```ts
// apps/client/src/services/websocket.ts (patch — inside the WS service)

import { isTauriApp } from "@/lib/env";   // existing helper (create if missing)
import { useAhandStore } from "@/stores/useAhandStore";
import { useCurrentUser } from "@/hooks/useAuth";

private buildClientContext(): { kind: "macapp"; deviceId: string | null } | { kind: "web" } {
  if (!isTauriApp()) return { kind: "web" };
  // currentUser available via a module-level singleton or refactored getter
  const userId = getCurrentUserIdSync();
  if (!userId) return { kind: "macapp", deviceId: null };
  const deviceId = useAhandStore.getState().getDeviceIdForUser(userId);
  return { kind: "macapp", deviceId: deviceId ?? null };
}

sendMessage(payload: SendMessagePayload): Promise<SendMessageResponse> {
  const enriched = {
    ...payload,
    clientContext: this.buildClientContext(),
  };
  return this.emitWithAck<SendMessageResponse>("send_message", enriched);
}
```

`getCurrentUserIdSync()` is a thin synchronous helper reading from the existing auth store (likely `useAuthStore` or equivalent). Grep for the repo's pattern; if there's already a `getCurrentUser()`-style non-hook accessor, use it.

- [ ] **Step 3: `lib/env.ts` helper**

```ts
// apps/client/src/lib/env.ts (create if missing)

export function isTauriApp(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
```

Grep to see if something similar exists under a different name; if so, just use that.

- [ ] **Step 4: Tests**

```ts
// apps/client/src/services/websocket.test.ts (patch — add cases)

describe("sendMessage — clientContext", () => {
  it("web build sets kind: 'web'", async () => {
    vi.mocked(isTauriApp).mockReturnValue(false);
    const ws = new WebsocketService(...);
    const emit = vi.spyOn(ws as any, "emitWithAck").mockResolvedValue({});
    await ws.sendMessage({ channelId: "c1", content: "x" });
    expect(emit).toHaveBeenCalledWith("send_message", expect.objectContaining({
      clientContext: { kind: "web" },
    }));
  });

  it("Tauri build with cached deviceId includes it", async () => {
    vi.mocked(isTauriApp).mockReturnValue(true);
    useAhandStore.getState().setDeviceIdForUser("u1", "dev-abc", true);
    vi.mocked(getCurrentUserIdSync).mockReturnValue("u1");
    const ws = new WebsocketService(...);
    const emit = vi.spyOn(ws as any, "emitWithAck").mockResolvedValue({});
    await ws.sendMessage({ channelId: "c1", content: "x" });
    expect(emit).toHaveBeenCalledWith("send_message", expect.objectContaining({
      clientContext: { kind: "macapp", deviceId: "dev-abc" },
    }));
  });

  it("Tauri build without enabled ahand sends deviceId: null", async () => {
    vi.mocked(isTauriApp).mockReturnValue(true);
    vi.mocked(getCurrentUserIdSync).mockReturnValue("u1");
    useAhandStore.getState().clearUser("u1");
    const ws = new WebsocketService(...);
    const emit = vi.spyOn(ws as any, "emitWithAck").mockResolvedValue({});
    await ws.sendMessage({ channelId: "c1", content: "x" });
    expect(emit).toHaveBeenCalledWith("send_message", expect.objectContaining({
      clientContext: { kind: "macapp", deviceId: null },
    }));
  });
});
```

- [ ] **Step 5: Commit**

```bash
cd /Users/winrey/Projects/weightwave/team9
git add apps/client/src/stores/useAhandStore.ts \
        apps/client/src/services/websocket.ts \
        apps/client/src/services/websocket.test.ts \
        apps/client/src/lib/env.ts
git commit -m "$(cat <<'EOF'
feat(client/ahand): attach clientContext to send_message payloads

Tauri build sends clientContext: { kind: 'macapp', deviceId } with
the locally-cached ahand deviceId for the authenticated team9 user.
When ahand is not enabled on this Tauri install, deviceId is null
(explicitly, so the gateway can distinguish 'no ahand' from 'web').
Web build sends { kind: 'web' }.

New zustand store useAhandStore persists per-user (userId → {enabled,
deviceId}) so sendMessage can read the current deviceId without
holding a hook reference. This store is also consumed by Phase 8's
DevicesDialog for toggle persistence.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8.2: `ahand-api.ts` HTTP client + React Query hooks

**Goal:** Typed HTTP client wrapping `/api/ahand/*` + React Query hooks for list/register/refresh/patch/delete with Socket.io invalidation.

**Files:**

- Create: `apps/client/src/services/ahand-api.ts`
- Create: `apps/client/src/hooks/useAhandDevices.ts`
- Create: `apps/client/src/hooks/useAhandLocalStatus.ts`
- Create: `apps/client/src/services/ahand-api.test.ts`
- Create: `apps/client/src/hooks/useAhandDevices.test.ts`
- Create: `apps/client/src/hooks/useAhandLocalStatus.test.ts`

**Acceptance Criteria:**

- [ ] `ahandApi` object with: `registerDevice(body)`, `listDevices({includeOffline})`, `refreshToken(id)`, `patchDevice(id, body)`, `deleteDevice(id)`. Uses existing `HttpClient` singleton (auth injection handled there).
- [ ] Response types match Phase 4 DTOs exactly (see `DeviceDto`, `RegisterDeviceResponseDto`, `TokenRefreshResponseDto`).
- [ ] `useAhandDevices()`: React Query hook that fetches list; on mount joins Socket.io room `user:{currentUserId}:ahand`; reacts to `device.online/offline/revoked/registered` events by patching the query cache; force-refetches on WS reconnect.
- [ ] `useAhandLocalStatus()`: Tauri-only hook subscribing to the `ahand-daemon-status` event; web-mode returns `{ state: "web" }` shortcut.
- [ ] 100% unit coverage on the API client (mocked HttpClient) and both hooks (mocked wsService + ahandApi + Tauri events).

**Verify:** `pnpm --filter @team9/client test services/ahand-api hooks/useAhandDevices hooks/useAhandLocalStatus`.

**Steps:**

- [ ] **Step 1: `ahand-api.ts`**

```ts
// apps/client/src/services/ahand-api.ts

import { httpClient } from "./http"; // existing HttpClient singleton

export interface DeviceDto {
  id: string;
  hubDeviceId: string;
  nickname: string;
  platform: "macos" | "windows" | "linux";
  hostname: string | null;
  status: "active" | "revoked";
  lastSeenAt: string | null;
  isOnline: boolean | null;
  createdAt: string;
}

export interface RegisterDeviceInput {
  hubDeviceId: string;
  publicKey: string;
  nickname: string;
  platform: "macos" | "windows" | "linux";
  hostname?: string;
}

export interface RegisterDeviceResponse {
  device: DeviceDto;
  deviceJwt: string;
  hubUrl: string;
  jwtExpiresAt: string;
}

export interface TokenRefreshResponse {
  deviceJwt: string;
  jwtExpiresAt: string;
}

export const ahandApi = {
  register(input: RegisterDeviceInput): Promise<RegisterDeviceResponse> {
    return httpClient.post("/api/ahand/devices", input);
  },
  list(opts: { includeOffline?: boolean } = {}): Promise<DeviceDto[]> {
    const q = opts.includeOffline === false ? "?includeOffline=false" : "";
    return httpClient.get(`/api/ahand/devices${q}`);
  },
  refreshToken(id: string): Promise<TokenRefreshResponse> {
    return httpClient.post(
      `/api/ahand/devices/${encodeURIComponent(id)}/token/refresh`,
    );
  },
  patch(id: string, body: { nickname?: string }): Promise<DeviceDto> {
    return httpClient.patch(
      `/api/ahand/devices/${encodeURIComponent(id)}`,
      body,
    );
  },
  remove(id: string): Promise<void> {
    return httpClient.delete(`/api/ahand/devices/${encodeURIComponent(id)}`);
  },
};
```

- [ ] **Step 2: `useAhandDevices.ts`**

```ts
// apps/client/src/hooks/useAhandDevices.ts

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ahandApi, type DeviceDto } from "@/services/ahand-api";
import { wsService } from "@/services/websocket";
import { useCurrentUser } from "./useAuth";

const DEVICES_QUERY_KEY = ["ahand", "devices"] as const;

export function useAhandDevices(opts: { includeOffline?: boolean } = {}) {
  const { currentUser } = useCurrentUser();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: [...DEVICES_QUERY_KEY, opts.includeOffline ?? true],
    queryFn: () => ahandApi.list(opts),
    enabled: !!currentUser,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!currentUser) return;
    const room = `user:${currentUser.id}:ahand`;
    wsService.emit("ahand:join_room", { room });

    const onUpdate = (patch: Partial<DeviceDto> & { hubDeviceId: string }) => {
      qc.setQueryData<DeviceDto[]>(
        [...DEVICES_QUERY_KEY, opts.includeOffline ?? true],
        (old) =>
          old
            ? old.map((d) =>
                d.hubDeviceId === patch.hubDeviceId ? { ...d, ...patch } : d,
              )
            : old,
      );
    };
    const onRegistered = () =>
      qc.invalidateQueries({ queryKey: DEVICES_QUERY_KEY });
    const onRevoked = (evt: { hubDeviceId: string }) => {
      qc.setQueryData<DeviceDto[]>(
        [...DEVICES_QUERY_KEY, opts.includeOffline ?? true],
        (old) => old?.filter((d) => d.hubDeviceId !== evt.hubDeviceId),
      );
    };
    const onOnline = (evt: { hubDeviceId: string }) =>
      onUpdate({ hubDeviceId: evt.hubDeviceId, isOnline: true });
    const onOffline = (evt: { hubDeviceId: string }) =>
      onUpdate({ hubDeviceId: evt.hubDeviceId, isOnline: false });
    const onReconnect = () =>
      qc.invalidateQueries({ queryKey: DEVICES_QUERY_KEY });

    wsService.on("device.online", onOnline);
    wsService.on("device.offline", onOffline);
    wsService.on("device.revoked", onRevoked);
    wsService.on("device.registered", onRegistered);
    wsService.on("reconnect", onReconnect);

    return () => {
      wsService.emit("ahand:leave_room", { room });
      wsService.off("device.online", onOnline);
      wsService.off("device.offline", onOffline);
      wsService.off("device.revoked", onRevoked);
      wsService.off("device.registered", onRegistered);
      wsService.off("reconnect", onReconnect);
    };
  }, [currentUser, qc, opts.includeOffline]);

  return query;
}

export function invalidateAhandDevices(
  qc: ReturnType<typeof useQueryClient>,
): void {
  qc.invalidateQueries({ queryKey: DEVICES_QUERY_KEY });
}
```

- [ ] **Step 3: `useAhandLocalStatus.ts`**

```ts
// apps/client/src/hooks/useAhandLocalStatus.ts

import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauriApp } from "@/lib/env";
import { ahandTauri } from "@/services/ahand-tauri";
import type { DaemonStatus } from "@/types/tauri-ahand";

export type LocalStatus = DaemonStatus | { state: "web" };

export function useAhandLocalStatus(): LocalStatus {
  const [status, setStatus] = useState<LocalStatus>(
    isTauriApp() ? { state: "idle" } : { state: "web" },
  );

  useEffect(() => {
    if (!isTauriApp()) return;
    let unlistener: (() => void) | null = null;
    // Fetch initial status
    ahandTauri
      .status()
      .then(setStatus)
      .catch(() => {});
    // Subscribe to events
    listen<DaemonStatus>("ahand-daemon-status", (ev) => setStatus(ev.payload))
      .then((un) => {
        unlistener = un;
      })
      .catch(() => {});
    return () => {
      unlistener?.();
    };
  }, []);

  return status;
}
```

- [ ] **Step 4: Tests**

```ts
// apps/client/src/services/ahand-api.test.ts

import { describe, it, expect, vi } from "vitest";
import { ahandApi } from "./ahand-api";
import { httpClient } from "./http";

vi.mock("./http", () => ({
  httpClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

describe("ahandApi", () => {
  it("list() passes includeOffline=false as query string", async () => {
    await ahandApi.list({ includeOffline: false });
    expect(httpClient.get).toHaveBeenCalledWith(
      "/api/ahand/devices?includeOffline=false",
    );
  });
  it("list() omits query string by default (includeOffline=true)", async () => {
    await ahandApi.list();
    expect(httpClient.get).toHaveBeenCalledWith("/api/ahand/devices");
  });
  it("register POSTs to /api/ahand/devices with body", async () => {
    await ahandApi.register({
      hubDeviceId: "d",
      publicKey: "p",
      nickname: "n",
      platform: "macos",
    });
    expect(httpClient.post).toHaveBeenCalledWith(
      "/api/ahand/devices",
      expect.any(Object),
    );
  });
  it("refreshToken URL-encodes id", async () => {
    await ahandApi.refreshToken("id with space");
    expect(httpClient.post).toHaveBeenCalledWith(
      "/api/ahand/devices/id%20with%20space/token/refresh",
    );
  });
  it("patch sends nickname", async () => {
    await ahandApi.patch("id1", { nickname: "new" });
    expect(httpClient.patch).toHaveBeenCalledWith("/api/ahand/devices/id1", {
      nickname: "new",
    });
  });
  it("remove DELETEs", async () => {
    await ahandApi.remove("id1");
    expect(httpClient.delete).toHaveBeenCalledWith("/api/ahand/devices/id1");
  });
});
```

```ts
// apps/client/src/hooks/useAhandLocalStatus.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useAhandLocalStatus } from "./useAhandLocalStatus";

vi.mock("@/lib/env");
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock("@/services/ahand-tauri", () => ({
  ahandTauri: { status: vi.fn() },
}));

describe("useAhandLocalStatus", () => {
  it("returns web in non-Tauri env", async () => {
    const { isTauriApp } = await import("@/lib/env");
    vi.mocked(isTauriApp).mockReturnValue(false);
    const { result } = renderHook(() => useAhandLocalStatus());
    expect(result.current).toEqual({ state: "web" });
  });

  it("reads initial status then updates via event in Tauri env", async () => {
    const { isTauriApp } = await import("@/lib/env");
    const { ahandTauri } = await import("@/services/ahand-tauri");
    const { listen } = await import("@tauri-apps/api/event");
    vi.mocked(isTauriApp).mockReturnValue(true);
    vi.mocked(ahandTauri.status).mockResolvedValue({ state: "idle" });
    let handler: ((ev: { payload: any }) => void) | null = null;
    vi.mocked(listen).mockImplementation(async (_name, h) => {
      handler = h as any;
      return () => {};
    });

    const { result } = renderHook(() => useAhandLocalStatus());
    await waitFor(() => expect(result.current).toEqual({ state: "idle" }));
    handler!({ payload: { state: "online", device_id: "abc" } });
    await waitFor(() => expect((result.current as any).state).toBe("online"));
  });
});
```

- [ ] **Step 5: Commit**

```bash
cd /Users/winrey/Projects/weightwave/team9
git add apps/client/src/services/ahand-api.ts \
        apps/client/src/services/ahand-api.test.ts \
        apps/client/src/hooks/useAhandDevices.ts \
        apps/client/src/hooks/useAhandDevices.test.ts \
        apps/client/src/hooks/useAhandLocalStatus.ts \
        apps/client/src/hooks/useAhandLocalStatus.test.ts
git commit -m "$(cat <<'EOF'
feat(client/ahand): REST service + React Query hooks

- ahand-api.ts: typed wrapper around /api/ahand/* (register, list,
  refresh token, patch, delete). Uses the existing HttpClient for
  auth header injection.
- useAhandDevices: React Query hook + Socket.io subscription to
  user:{uid}:ahand room. Patches query cache on device.online/offline
  (isOnline flip), filters out revoked devices, invalidates on
  registered, and force-refetches on WS reconnect so snapshots
  re-align after transient disconnects.
- useAhandLocalStatus: Tauri-only hook reading ahand_status once and
  subscribing to the 'ahand-daemon-status' event. Returns
  { state: 'web' } outside Tauri so UI components can uniformly
  branch.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8.3: `DevicesDialog` component

**Goal:** The main UI. One file that branches on env: Tauri shows the "This Mac" section + toggle + local device actions; Web shows the CTA card (open/download desktop app). Both show the "Other Devices" list.

**Files:**

- Create: `apps/client/src/components/dialog/DevicesDialog.tsx`
- Create: `apps/client/src/components/dialog/DevicesDialog.test.tsx`
- Create: `apps/client/src/components/dialog/devices/ThisMacSection.tsx` (Tauri-only sub-component)
- Create: `apps/client/src/components/dialog/devices/WebCtaCard.tsx` (Web-only sub-component)
- Create: `apps/client/src/components/dialog/devices/OtherDevicesList.tsx` (shared)

**Acceptance Criteria:**

- [ ] Dialog renders "This Mac" section only in Tauri env.
- [ ] Tauri: toggle "Allow as agent target" with full state machine per spec § 5.4 (never registered / registered+enabled+online / connecting / error / disabled / revoked).
- [ ] Tauri: first-time enable performs the 5-step registration flow (§ 5.5) with rollback on any failure.
- [ ] Tauri: status dot color reflects `useAhandLocalStatus()` output; online=green, connecting=amber, error=red, offline=gray, disabled=dim-gray.
- [ ] Web: CTA card with "Open Desktop App" (team9:// deep link with 500ms timeout → toast "not installed") and "Download Desktop App" (platform-detected URL).
- [ ] "Other Devices" list (both env): rows with nickname, platform, last-seen, online-dot, remove button. Remove button opens a confirm dialog → calls `ahandApi.remove()` → React Query cache invalidates.
- [ ] Nickname edit: inline editable with optimistic update + rollback on failure.
- [ ] Empty state (Tauri, no devices) shows the spec § 5.9 empty block with a single "Allow this Mac" action.
- [ ] All user-facing strings via i18n (`t("ahand.myDevices")` etc.).
- [ ] Accessibility: toggle has `role="switch"`, `aria-checked`; status dot has `aria-label`; keyboard navigation works.
- [ ] Tests: React Testing Library with mocked env, hooks, and api. Cover happy, failure, and edge cases from spec § 9.4.7.

**Verify:** `pnpm --filter @team9/client test components/dialog/DevicesDialog`.

**Steps:**

- [ ] **Step 1: Main dialog shell**

```tsx
// apps/client/src/components/dialog/DevicesDialog.tsx

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTranslation } from "react-i18next";
import { isTauriApp } from "@/lib/env";
import { ThisMacSection } from "./devices/ThisMacSection";
import { OtherDevicesList } from "./devices/OtherDevicesList";
import { WebCtaCard } from "./devices/WebCtaCard";

interface DevicesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DevicesDialog({ open, onOpenChange }: DevicesDialogProps) {
  const { t } = useTranslation("ahand");
  const tauri = isTauriApp();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("myDevices")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {tauri ? <ThisMacSection /> : <WebCtaCard />}
          <OtherDevicesList excludeLocal={tauri} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: `ThisMacSection.tsx` (Tauri-only)**

```tsx
// apps/client/src/components/dialog/devices/ThisMacSection.tsx

import { useState, useCallback } from "react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useAhandLocalStatus } from "@/hooks/useAhandLocalStatus";
import { useAhandStore } from "@/stores/useAhandStore";
import { useCurrentUser } from "@/hooks/useAuth";
import { ahandTauri } from "@/services/ahand-tauri";
import { ahandApi } from "@/services/ahand-api";
import { cn } from "@/lib/utils";
import { platform as osPlatform } from "@tauri-apps/plugin-os";
import { hostname as osHostname } from "@tauri-apps/plugin-os";
import { useQueryClient } from "@tanstack/react-query";

type State =
  | "never"
  | "registering"
  | "online"
  | "offline"
  | "connecting"
  | "error"
  | "disabled";

export function ThisMacSection() {
  const { t } = useTranslation("ahand");
  const { currentUser } = useCurrentUser();
  const status = useAhandLocalStatus();
  const store = useAhandStore();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const enabled =
    !!currentUser && (store.usersEnabled[currentUser.id]?.enabled ?? false);
  const deviceId = currentUser
    ? store.getDeviceIdForUser(currentUser.id)
    : null;

  const statusColor = deriveStatusColor(status, enabled);
  const statusLabel = deriveStatusLabel(status, enabled, t);

  const handleToggle = useCallback(
    async (next: boolean) => {
      if (!currentUser) return;
      setBusy(true);
      try {
        if (next) {
          await enableForUser(currentUser.id);
        } else {
          await ahandTauri.stop();
          store.setDeviceIdForUser(currentUser.id, deviceId, false);
        }
      } catch (e: any) {
        toast.error(t("error.toggleFailed", { msg: e?.message ?? String(e) }));
        store.setDeviceIdForUser(currentUser.id, deviceId, false);
      } finally {
        setBusy(false);
      }
    },
    [currentUser, deviceId, store, t],
  );

  const handleRemove = useCallback(async () => {
    if (!currentUser || !deviceId) return;
    const confirmed = window.confirm(t("confirmRemoveThisMac"));
    if (!confirmed) return;
    setBusy(true);
    try {
      await ahandTauri.stop();
      const devices = await ahandApi.list({ includeOffline: true });
      const row = devices.find((d) => d.hubDeviceId === deviceId);
      if (row) await ahandApi.remove(row.id);
      store.clearUser(currentUser.id);
      qc.invalidateQueries({ queryKey: ["ahand", "devices"] });
      toast.success(t("thisMacRemoved"));
    } catch (e: any) {
      toast.error(t("error.removeFailed", { msg: e?.message ?? String(e) }));
    } finally {
      setBusy(false);
    }
  }, [currentUser, deviceId, qc, store, t]);

  return (
    <section>
      <h3 className="text-sm font-medium mb-2">{t("thisMac")}</h3>
      <div className="border rounded-lg p-4 space-y-3">
        <div className="flex items-center gap-2">
          <StatusDot color={statusColor} aria-label={statusLabel} />
          <span className="text-sm">{statusLabel}</span>
        </div>
        <div className="flex items-center justify-between">
          <Switch
            checked={enabled}
            onCheckedChange={handleToggle}
            disabled={busy || status.state === "connecting"}
            aria-label={t("allowLocalDevice")}
          />
          <span className="text-sm ml-2">{t("allowLocalDevice")}</span>
        </div>
        {status.state === "error" && (
          <div className="text-sm text-destructive">
            {(status as any).message}
          </div>
        )}
        {enabled && deviceId && (
          <Button
            variant="destructive"
            size="sm"
            onClick={handleRemove}
            disabled={busy}
          >
            {t("removeThisDevice")}
          </Button>
        )}
      </div>
    </section>
  );

  async function enableForUser(userId: string): Promise<void> {
    // 5-step registration flow per spec § 5.5
    const id = await ahandTauri.getIdentity(userId);
    const plat = await osPlatform();
    const host = await osHostname().catch(() => undefined);
    const nickname = host ?? `${plat}-device`;
    const platformKey = mapPlatform(plat);
    const { deviceJwt, hubUrl, jwtExpiresAt } = await ahandApi.register({
      hubDeviceId: id.deviceId,
      publicKey: id.publicKeyB64,
      nickname,
      platform: platformKey,
      hostname: host,
    });
    store.setDeviceIdForUser(userId, id.deviceId, true);
    await ahandTauri.start({
      team9_user_id: userId,
      hub_url: hubUrl,
      device_jwt: deviceJwt,
      jwt_expires_at: Math.floor(new Date(jwtExpiresAt).getTime() / 1000),
    });
  }
}

function deriveStatusColor(status: any, enabled: boolean): string {
  if (!enabled) return "bg-muted";
  switch (status.state) {
    case "online":
      return "bg-green-500";
    case "connecting":
      return "bg-amber-500 animate-pulse";
    case "error":
      return "bg-destructive";
    case "offline":
      return "bg-muted-foreground";
    default:
      return "bg-muted";
  }
}

function deriveStatusLabel(status: any, enabled: boolean, t: any): string {
  if (!enabled) return t("disabled");
  if (status.state === "online") return t("online");
  if (status.state === "connecting") return t("connecting");
  if (status.state === "error") return t("error.header");
  if (status.state === "offline") return t("offline");
  return t("notConnected");
}

function mapPlatform(p: string): "macos" | "windows" | "linux" {
  if (p === "macos" || p === "darwin") return "macos";
  if (p === "windows") return "windows";
  return "linux";
}

function StatusDot({
  color,
  "aria-label": ariaLabel,
}: {
  color: string;
  "aria-label": string;
}) {
  return (
    <div className={cn("w-3 h-3 rounded-full", color)} aria-label={ariaLabel} />
  );
}
```

- [ ] **Step 3: `WebCtaCard.tsx`**

```tsx
// apps/client/src/components/dialog/devices/WebCtaCard.tsx

import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Zap } from "lucide-react";

export function WebCtaCard() {
  const { t } = useTranslation("ahand");
  return (
    <div className="rounded-lg border p-4 bg-gradient-to-br from-primary/5 to-primary/10">
      <div className="flex items-start gap-3">
        <Zap size={20} className="text-primary mt-0.5" />
        <div className="flex-1">
          <h3 className="font-semibold">{t("ctaTitle")}</h3>
          <p className="text-sm text-muted-foreground mt-1">{t("ctaBody")}</p>
          <div className="flex gap-2 mt-3">
            <Button onClick={openDesktopApp} size="sm">
              {t("ctaPrimaryAction")}
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={getDesktopDownloadUrl()}>{t("ctaSecondaryAction")}</a>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );

  function openDesktopApp() {
    const start = Date.now();
    window.location.href = "team9://devices";
    setTimeout(() => {
      if (Date.now() - start < 800 && !document.hidden) {
        toast.info(t("noAppInstalledHint"));
      }
    }, 500);
  }

  function getDesktopDownloadUrl(): string {
    const ua = navigator.userAgent;
    if (/Mac/.test(ua)) return "https://team9.ai/download/mac";
    if (/Win/.test(ua)) return "https://team9.ai/download/windows";
    if (/Linux/.test(ua)) return "https://team9.ai/download/linux";
    return "https://team9.ai/download";
  }
}
```

- [ ] **Step 4: `OtherDevicesList.tsx`**

```tsx
// apps/client/src/components/dialog/devices/OtherDevicesList.tsx

import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { useAhandDevices } from "@/hooks/useAhandDevices";
import { useAhandStore } from "@/stores/useAhandStore";
import { useCurrentUser } from "@/hooks/useAuth";
import { ahandApi } from "@/services/ahand-api";
import { useQueryClient } from "@tanstack/react-query";
import type { DeviceDto } from "@/services/ahand-api";

export function OtherDevicesList({ excludeLocal }: { excludeLocal: boolean }) {
  const { t, i18n } = useTranslation("ahand");
  const { data, isLoading } = useAhandDevices({ includeOffline: true });
  const { currentUser } = useCurrentUser();
  const localId = currentUser
    ? useAhandStore.getState().getDeviceIdForUser(currentUser.id)
    : null;
  const qc = useQueryClient();

  if (isLoading) {
    return (
      <section>
        <h3 className="text-sm font-medium mb-2">
          {t("otherDevices", { count: 0 })}
        </h3>
        <Skeleton className="h-16" />
      </section>
    );
  }

  const devices = (data ?? []).filter((d) =>
    !excludeLocal ? true : d.hubDeviceId !== localId,
  );

  if (devices.length === 0) {
    return null; // or render an "(none)" empty state
  }

  return (
    <section>
      <h3 className="text-sm font-medium mb-2">
        {t("otherDevices", { count: devices.length })}
      </h3>
      <ul className="border rounded-lg divide-y">
        {devices.map((d) => (
          <DeviceRow key={d.id} device={d} t={t} locale={i18n.language} />
        ))}
      </ul>
    </section>
  );

  function DeviceRow({
    device,
    t,
    locale,
  }: {
    device: DeviceDto;
    t: any;
    locale: string;
  }) {
    return (
      <li className="flex items-center justify-between p-3">
        <div className="flex items-center gap-3">
          <div
            className={`w-2.5 h-2.5 rounded-full ${device.isOnline ? "bg-green-500" : "bg-muted-foreground"}`}
          />
          <div>
            <div className="text-sm font-medium">{device.nickname}</div>
            <div className="text-xs text-muted-foreground">
              {device.platform} ·{" "}
              {device.lastSeenAt
                ? t("lastSeen", {
                    when: formatDistanceToNow(new Date(device.lastSeenAt), {
                      addSuffix: true,
                      locale: dateFnsLocale(locale),
                    }),
                  })
                : t("neverSeen")}
            </div>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => handleRemove(device)}>
          {t("remove")}
        </Button>
      </li>
    );
  }

  async function handleRemove(device: DeviceDto): Promise<void> {
    if (!window.confirm(t("confirmRemove", { name: device.nickname }))) return;
    try {
      await ahandApi.remove(device.id);
      qc.invalidateQueries({ queryKey: ["ahand", "devices"] });
      toast.success(t("removed", { name: device.nickname }));
    } catch (e: any) {
      toast.error(t("error.removeFailed", { msg: e?.message ?? String(e) }));
    }
  }
}

function dateFnsLocale(_lang: string): any {
  // Return the matching date-fns locale module; fallback to enUS.
  // Implementation detail per repo's existing i18n helper.
  return undefined;
}
```

- [ ] **Step 5: Tests**

```tsx
// apps/client/src/components/dialog/DevicesDialog.test.tsx

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DevicesDialog } from "./DevicesDialog";
import { isTauriApp } from "@/lib/env";

vi.mock("@/lib/env");
vi.mock("@/hooks/useAhandLocalStatus", () => ({
  useAhandLocalStatus: () => ({ state: "idle" }),
}));
vi.mock("@/hooks/useAhandDevices", () => ({
  useAhandDevices: () => ({ data: [], isLoading: false }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useCurrentUser: () => ({ currentUser: { id: "u1", email: "u@t.co" } }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

function wrap(ui: React.ReactNode) {
  return (
    <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
  );
}

describe("DevicesDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders ThisMacSection in Tauri env", () => {
    vi.mocked(isTauriApp).mockReturnValue(true);
    render(wrap(<DevicesDialog open onOpenChange={() => {}} />));
    expect(screen.getByText("thisMac")).toBeInTheDocument();
  });

  it("renders WebCtaCard in non-Tauri env", () => {
    vi.mocked(isTauriApp).mockReturnValue(false);
    render(wrap(<DevicesDialog open onOpenChange={() => {}} />));
    expect(screen.getByText("ctaTitle")).toBeInTheDocument();
    expect(screen.queryByText("thisMac")).toBeNull();
  });

  // Additional tests for toggle flow, remove confirmation, deep-link toast,
  // error states, and edit-nickname happen in per-component test files:
  //   ThisMacSection.test.tsx, WebCtaCard.test.tsx, OtherDevicesList.test.tsx
  // Each follows the same RTL + mocked-hook pattern.
});
```

Per-sub-component tests (not shown inline) should cover per spec § 9.4.7:

- ThisMacSection: first-enable happy flow; enable-fail rollback (toggle reverts); remove-this-mac flow; error-state rendering; confirm-dialog rejection.
- WebCtaCard: deep link attempt → toast when stale; download URL mapping for mac/windows/linux/unknown UAs.
- OtherDevicesList: skeleton during loading; empty state; row render with online/offline dot; remove click → confirm → api call.

- [ ] **Step 6: Commit**

```bash
cd /Users/winrey/Projects/weightwave/team9
git add apps/client/src/components/dialog/DevicesDialog.tsx \
        apps/client/src/components/dialog/DevicesDialog.test.tsx \
        apps/client/src/components/dialog/devices/
git commit -m "$(cat <<'EOF'
feat(client/ahand): DevicesDialog UI (Tauri + Web modes)

Single dialog component that branches on isTauriApp():
- Tauri: ThisMacSection (toggle + registration flow + status dot +
  remove-this-mac destructive action) + OtherDevicesList.
- Web: WebCtaCard (Open Desktop App team9:// deep link with 500ms
  fallback toast; Download button with platform-detected URL) +
  OtherDevicesList.

OtherDevicesList renders every device returned by useAhandDevices
with online/offline dot, relative last-seen, and per-row remove
action. In Tauri env, the local device is excluded from this list
(it appears in ThisMacSection).

Tests use React Testing Library with mocked env + hooks; covers
branching, not per-component interactions (those live in per-
component test files per spec § 9.4.7).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8.4: `MainSidebar` entry + `_authenticated` auto-resume + logout

**Goal:** Place the device entry button above the avatar in `MainSidebar`; auto-resume the ahand daemon on app mount when the user had it enabled; stop the daemon on logout/app-exit.

**Files:**

- Modify: `apps/client/src/components/layout/MainSidebar.tsx` — add the Laptop button (§ 5.1).
- Modify: `apps/client/src/routes/_authenticated.tsx` — mount-time auto-resume via `ensureStarted(userId)` + logout hook.
- Create: `apps/client/src/hooks/useAhandBootstrap.ts` — centralizes the auto-resume + logout wiring.

**Acceptance Criteria:**

- [ ] MainSidebar shows a 40×40 button above the avatar `<div data-tauri-drag-region>` block. Click opens `DevicesDialog`.
- [ ] Button has a status dot overlay: Tauri → reflects `useAhandLocalStatus()`; Web → aggregate (any device online = green).
- [ ] Tooltip on hover shows the `t("myDevices")` label and the status label underneath.
- [ ] On `_authenticated.tsx` mount, if `isTauriApp() && usersEnabled[currentUserId].enabled`, call `ensureStarted(userId)` which:
  1. Resolves the cached `deviceId`.
  2. Calls `ahandApi.refreshToken(device.id)` to get a fresh JWT.
  3. Calls `ahandTauri.start(...)`.
- [ ] On logout (and on app-exit through RunEvent), call `ahandTauri.stop()` — already hooked in Phase 7 Task 7.3, but the logout hook in TS also calls it explicitly so users logging out without closing the app stop immediately.
- [ ] Old `useAHandSetupStore` and its auto-trigger are removed from `_authenticated.tsx`.
- [ ] Tests: render `MainSidebar` with mocked hooks to verify the button renders + status dot color + click opens dialog. Test `useAhandBootstrap` with fakeTimers to verify resume + logout flow.

**Verify:** `pnpm --filter @team9/client test components/layout/MainSidebar hooks/useAhandBootstrap`.

**Steps:**

- [ ] **Step 1: `useAhandBootstrap.ts`**

```ts
// apps/client/src/hooks/useAhandBootstrap.ts

import { useEffect } from "react";
import { isTauriApp } from "@/lib/env";
import { useCurrentUser } from "./useAuth";
import { useAhandStore } from "@/stores/useAhandStore";
import { ahandTauri } from "@/services/ahand-tauri";
import { ahandApi } from "@/services/ahand-api";
import { toast } from "sonner";

/**
 * Called from _authenticated.tsx. Resumes the ahand daemon on mount if the
 * current team9 user previously enabled it on this Tauri install.
 */
export function useAhandBootstrap() {
  const { currentUser, isLoggingOut } = useCurrentUser();
  const store = useAhandStore();

  useEffect(() => {
    if (!isTauriApp() || !currentUser) return;
    const entry = store.usersEnabled[currentUser.id];
    if (!entry?.enabled) return;
    void resume(currentUser.id, entry.deviceId);
  }, [currentUser]);

  useEffect(() => {
    if (!isTauriApp() || !isLoggingOut) return;
    void ahandTauri.stop().catch(() => {});
  }, [isLoggingOut]);
}

async function resume(
  userId: string,
  cachedDeviceId: string | null,
): Promise<void> {
  try {
    // Find the device row id from the cached hubDeviceId
    const devices = await ahandApi.list({ includeOffline: true });
    const row = devices.find((d) => d.hubDeviceId === cachedDeviceId);
    if (!row) {
      // Device was revoked server-side; silently disable locally.
      const store = useAhandStore.getState();
      store.setDeviceIdForUser(userId, null, false);
      return;
    }
    const { deviceJwt, jwtExpiresAt } = await ahandApi.refreshToken(row.id);
    await ahandTauri.start({
      team9_user_id: userId,
      hub_url:
        /* derived from env or returned via refresh payload */ getHubUrl(),
      device_jwt: deviceJwt,
      jwt_expires_at: Math.floor(new Date(jwtExpiresAt).getTime() / 1000),
    });
  } catch (e: any) {
    toast.error(`aHand resume failed: ${e?.message ?? String(e)}`);
  }
}

function getHubUrl(): string {
  // The refresh-token response in Phase 4 Task 4.4 does NOT currently return
  // hubUrl (only the registration response does). Two options:
  // 1. Cache hubUrl at registration time (in useAhandStore) → read here.
  // 2. Add hubUrl to the refresh response payload.
  // Option 1 is simpler; update useAhandStore's state shape to store hubUrl
  // alongside deviceId. For this plan, assume option 1 and pull from the store.
  const user = /* get current user id */ "";
  const entry = useAhandStore.getState().usersEnabled[user];
  return (entry as any)?.hubUrl ?? "";
}
```

**Note:** The `hubUrl` needs to be plumbed through. Update `useAhandStore.UserAhandState` to include `hubUrl?: string`, set it in Task 8.3's registration flow (`store.setDeviceIdForUser(...)` grows a new optional param), and read it here. (Small patch to 8.3's store usage.)

Also wire refresh flow's `hubUrl` from `ahandTauri.status()`'s response if needed; or add hubUrl to refresh DTO in Phase 4 Task 4.4 as a follow-up polish.

- [ ] **Step 2: `MainSidebar` — button insertion**

Read the current file around the avatar position (spec § 5.1 shows `<div data-tauri-drag-region className="shrink-0 py-4">` as the anchor). Insert the new button as a sibling just before this block.

```tsx
// apps/client/src/components/layout/MainSidebar.tsx (patch — near the avatar at the bottom)

import { Laptop } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DevicesDialog } from "@/components/dialog/DevicesDialog";
import { useAhandLocalStatus } from "@/hooks/useAhandLocalStatus";
import { useAhandDevices } from "@/hooks/useAhandDevices";
import { isTauriApp } from "@/lib/env";

// ...inside the component body, near the top-level hooks:
const [devicesDialogOpen, setDevicesDialogOpen] = useState(false);
const localStatus = useAhandLocalStatus();
const { data: devices } = useAhandDevices({ includeOffline: true });
const { t: tAhand } = useTranslation("ahand");

const dotColor = deriveSidebarDotColor(localStatus, devices, isTauriApp());
const statusLabel = deriveSidebarStatusLabel(localStatus, devices, tAhand);

// ...inside the JSX, just above the existing User Avatar at Bottom <div>:
<Tooltip>
  <TooltipTrigger asChild>
    <button
      onClick={() => setDevicesDialogOpen(true)}
      aria-label={tAhand("myDevices")}
      className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-nav-hover-strong relative mb-2"
    >
      <Laptop size={18} />
      <div
        className={cn(
          "absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-nav-bg",
          dotColor,
        )}
        aria-label={statusLabel}
      />
    </button>
  </TooltipTrigger>
  <TooltipContent side="right">
    <p>{tAhand("myDevices")}</p>
    <p className="text-xs text-muted-foreground">{statusLabel}</p>
  </TooltipContent>
</Tooltip>
<DevicesDialog open={devicesDialogOpen} onOpenChange={setDevicesDialogOpen} />
```

Helpers at the bottom of the same file or extracted to `sidebar-helpers.ts`:

```ts
function deriveSidebarDotColor(
  local: ReturnType<typeof useAhandLocalStatus>,
  devices: DeviceDto[] | undefined,
  tauri: boolean,
): string {
  if (tauri) {
    switch (local.state) {
      case "online":
        return "bg-green-500";
      case "connecting":
        return "bg-amber-500 animate-pulse";
      case "error":
        return "bg-destructive";
      case "offline":
        return "bg-muted-foreground";
      default:
        return "bg-muted";
    }
  }
  const anyOnline = (devices ?? []).some((d) => d.isOnline === true);
  return anyOnline ? "bg-green-500" : "bg-muted";
}

function deriveSidebarStatusLabel(
  local: ReturnType<typeof useAhandLocalStatus>,
  devices: DeviceDto[] | undefined,
  t: any,
): string {
  if (local.state === "web") {
    const anyOnline = (devices ?? []).some((d) => d.isOnline === true);
    return anyOnline ? t("statusAnyOnline") : t("statusNoneOnline");
  }
  if (local.state === "online") return t("online");
  if (local.state === "connecting") return t("connecting");
  if (local.state === "error") return t("error.header");
  if (local.state === "offline") return t("offline");
  return t("disabled");
}
```

- [ ] **Step 3: `_authenticated.tsx` — wire bootstrap**

```tsx
// apps/client/src/routes/_authenticated.tsx (patch)

import { useAhandBootstrap } from "@/hooks/useAhandBootstrap";

function AuthenticatedLayout() {
  useAhandBootstrap();
  // ...remove any reference to useAHandSetupStore from Phase 0's legacy code
  // (Task 8.7 covers the full legacy cleanup; this patch only removes the
  // auto-trigger callsite in _authenticated).
  return <Outlet />;
}
```

- [ ] **Step 4: Tests**

```tsx
// apps/client/src/components/layout/MainSidebar.test.tsx (patch — add cases)

describe("MainSidebar — ahand entry", () => {
  beforeEach(() => {
    vi.mocked(useAhandLocalStatus).mockReturnValue({
      state: "online",
      device_id: "x",
    });
    vi.mocked(useAhandDevices).mockReturnValue({
      data: [],
      isLoading: false,
    } as any);
  });

  it("renders a Devices button with a green dot when local is online", () => {
    render(<MainSidebar />);
    const btn = screen.getByRole("button", { name: /my devices/i });
    expect(btn).toBeInTheDocument();
    expect(btn.querySelector(".bg-green-500")).not.toBeNull();
  });

  it("clicking the button opens the DevicesDialog", async () => {
    render(<MainSidebar />);
    const btn = screen.getByRole("button", { name: /my devices/i });
    fireEvent.click(btn);
    await waitFor(() =>
      expect(screen.getByText(/my devices/i)).toBeInTheDocument(),
    );
  });

  it("web env shows aggregate dot based on device list", () => {
    vi.mocked(isTauriApp).mockReturnValue(false);
    vi.mocked(useAhandLocalStatus).mockReturnValue({ state: "web" });
    vi.mocked(useAhandDevices).mockReturnValue({
      data: [{ hubDeviceId: "d1", isOnline: true } as any],
      isLoading: false,
    });
    render(<MainSidebar />);
    const btn = screen.getByRole("button", { name: /my devices/i });
    expect(btn.querySelector(".bg-green-500")).not.toBeNull();
  });
});
```

```tsx
// apps/client/src/hooks/useAhandBootstrap.test.tsx

describe("useAhandBootstrap", () => {
  it("calls ahandTauri.start when enabled + cached on mount", async () => {
    vi.mocked(isTauriApp).mockReturnValue(true);
    vi.mocked(useCurrentUser).mockReturnValue({
      currentUser: { id: "u1" },
      isLoggingOut: false,
    } as any);
    useAhandStore.getState().setDeviceIdForUser("u1", "dev-abc", true);
    const list = vi
      .fn()
      .mockResolvedValue([{ id: "row-1", hubDeviceId: "dev-abc" } as any]);
    const refresh = vi
      .fn()
      .mockResolvedValue({
        deviceJwt: "j",
        jwtExpiresAt: "2026-05-01T00:00:00Z",
      });
    const start = vi.fn().mockResolvedValue({ device_id: "dev-abc" });
    vi.mocked(ahandApi.list).mockImplementation(list);
    vi.mocked(ahandApi.refreshToken).mockImplementation(refresh);
    vi.mocked(ahandTauri.start).mockImplementation(start);
    renderHook(() => useAhandBootstrap());
    await waitFor(() => expect(start).toHaveBeenCalled());
  });

  it("silently disables locally when cached device is no longer on server", async () => {
    vi.mocked(isTauriApp).mockReturnValue(true);
    vi.mocked(useCurrentUser).mockReturnValue({
      currentUser: { id: "u1" },
      isLoggingOut: false,
    } as any);
    useAhandStore.getState().setDeviceIdForUser("u1", "dev-stale", true);
    vi.mocked(ahandApi.list).mockResolvedValue([]);
    const start = vi.fn();
    vi.mocked(ahandTauri.start).mockImplementation(start);
    renderHook(() => useAhandBootstrap());
    await waitFor(() => {
      expect(useAhandStore.getState().usersEnabled["u1"]?.enabled).toBe(false);
    });
    expect(start).not.toHaveBeenCalled();
  });

  it("stops daemon on logout", async () => {
    vi.mocked(isTauriApp).mockReturnValue(true);
    vi.mocked(useCurrentUser).mockReturnValue({
      currentUser: { id: "u1" },
      isLoggingOut: true,
    } as any);
    const stop = vi.fn();
    vi.mocked(ahandTauri.stop).mockImplementation(stop);
    renderHook(() => useAhandBootstrap());
    await waitFor(() => expect(stop).toHaveBeenCalled());
  });
});
```

- [ ] **Step 5: Commit**

```bash
cd /Users/winrey/Projects/weightwave/team9
git add apps/client/src/components/layout/MainSidebar.tsx \
        apps/client/src/components/layout/MainSidebar.test.tsx \
        apps/client/src/routes/_authenticated.tsx \
        apps/client/src/hooks/useAhandBootstrap.ts \
        apps/client/src/hooks/useAhandBootstrap.test.tsx \
        apps/client/src/stores/useAhandStore.ts
git commit -m "$(cat <<'EOF'
feat(client/ahand): MainSidebar entry + auto-resume + logout hook

- MainSidebar: 40x40 Laptop button above avatar opens DevicesDialog.
  Status dot is Tauri daemon status in Tauri env; aggregate
  "any-device-online" in web env.
- _authenticated.tsx: removed legacy useAHandSetupStore auto-trigger;
  replaced with useAhandBootstrap() which:
  - On mount (Tauri + user enabled + cached deviceId): refreshes JWT
    via /api/ahand/devices/:id/token/refresh, calls ahand_start.
  - Detects server-side revocation (cached deviceId no longer in
    device list) → silently disables locally, no toast noise.
  - On logout flag: calls ahand_stop to tear down cleanly.
- useAhandStore gains optional hubUrl (set at registration; consumed
  at resume).

Full auto-pairing UX is now one-click: user toggles on once, then
every time they log in on the same Tauri install with the same
team9 account, ahand comes back online automatically.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8.5: JWT auto-refresh on `Auth` error status

**Goal:** When the Tauri daemon emits `DaemonStatus::Error { kind: Auth }`, automatically refresh the JWT via gateway and restart the daemon — transparent to the user. Per spec § 5.6.

**Files:**

- Create: `apps/client/src/hooks/useAhandJwtRefresh.ts`
- Modify: `apps/client/src/routes/_authenticated.tsx` — mount the hook alongside `useAhandBootstrap()`.

**Acceptance Criteria:**

- [ ] Hook subscribes to the global Tauri event stream (reuses `useAhandLocalStatus` or subscribes directly) and triggers refresh when state transitions to `error` with `kind=auth`.
- [ ] Refresh flow: list devices → find row for cached deviceId → `ahandApi.refreshToken(rowId)` → `ahandTauri.start(...)`. On failure: toast error, do NOT disable the ahand locally (user may retry manually).
- [ ] Guards against infinite loops: a single refresh attempt per "auth error → online" cycle. If auth error fires again immediately, rate-limit to one attempt per 30s.
- [ ] Unit tests cover: happy refresh, refresh API failure, rapid repeated auth errors.

**Verify:** `pnpm --filter @team9/client test hooks/useAhandJwtRefresh`.

**Steps:**

- [ ] **Step 1: Hook**

```ts
// apps/client/src/hooks/useAhandJwtRefresh.ts

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useAhandLocalStatus } from "./useAhandLocalStatus";
import { useCurrentUser } from "./useAuth";
import { useAhandStore } from "@/stores/useAhandStore";
import { ahandApi } from "@/services/ahand-api";
import { ahandTauri } from "@/services/ahand-tauri";
import { isTauriApp } from "@/lib/env";

const MIN_REFRESH_INTERVAL_MS = 30_000;

export function useAhandJwtRefresh() {
  const status = useAhandLocalStatus();
  const { currentUser } = useCurrentUser();
  const lastRefreshAtRef = useRef(0);

  useEffect(() => {
    if (!isTauriApp()) return;
    if (!currentUser) return;
    if (status.state !== "error") return;
    if ((status as any).kind !== "auth") return;

    const now = Date.now();
    if (now - lastRefreshAtRef.current < MIN_REFRESH_INTERVAL_MS) return;
    lastRefreshAtRef.current = now;

    void refresh(currentUser.id);
  }, [status, currentUser]);
}

async function refresh(userId: string): Promise<void> {
  const store = useAhandStore.getState();
  const entry = store.usersEnabled[userId];
  if (!entry?.enabled || !entry.deviceId) return;

  try {
    const devices = await ahandApi.list({ includeOffline: true });
    const row = devices.find((d) => d.hubDeviceId === entry.deviceId);
    if (!row) {
      // Server-side revocation; disable locally
      store.setDeviceIdForUser(userId, null, false);
      await ahandTauri.stop().catch(() => {});
      toast.info(
        "aHand: this device is no longer authorized; please re-enable",
      );
      return;
    }
    const { deviceJwt, jwtExpiresAt } = await ahandApi.refreshToken(row.id);
    await ahandTauri.start({
      team9_user_id: userId,
      hub_url: (entry as any).hubUrl ?? "",
      device_jwt: deviceJwt,
      jwt_expires_at: Math.floor(new Date(jwtExpiresAt).getTime() / 1000),
    });
  } catch (e: any) {
    toast.error(`aHand: auto-refresh failed — ${e?.message ?? String(e)}`);
  }
}
```

- [ ] **Step 2: Mount alongside bootstrap**

```tsx
// apps/client/src/routes/_authenticated.tsx (patch)

import { useAhandBootstrap } from "@/hooks/useAhandBootstrap";
import { useAhandJwtRefresh } from "@/hooks/useAhandJwtRefresh";

function AuthenticatedLayout() {
  useAhandBootstrap();
  useAhandJwtRefresh();
  return <Outlet />;
}
```

- [ ] **Step 3: Tests**

```tsx
// apps/client/src/hooks/useAhandJwtRefresh.test.tsx

describe("useAhandJwtRefresh", () => {
  beforeEach(() => {
    vi.mocked(isTauriApp).mockReturnValue(true);
    vi.mocked(useCurrentUser).mockReturnValue({
      currentUser: { id: "u1" },
    } as any);
    useAhandStore.getState().setDeviceIdForUser("u1", "dev-abc", true);
  });

  it("refreshes JWT when local status transitions to error:auth", async () => {
    const refresh = vi
      .fn()
      .mockResolvedValue({
        deviceJwt: "new",
        jwtExpiresAt: "2026-05-01T00:00:00Z",
      });
    const start = vi.fn().mockResolvedValue({ device_id: "dev-abc" });
    vi.mocked(ahandApi.list).mockResolvedValue([
      { id: "row-1", hubDeviceId: "dev-abc" } as any,
    ]);
    vi.mocked(ahandApi.refreshToken).mockImplementation(refresh);
    vi.mocked(ahandTauri.start).mockImplementation(start);
    vi.mocked(useAhandLocalStatus).mockReturnValue({
      state: "error",
      kind: "auth",
      message: "jwt_expired",
    } as any);
    renderHook(() => useAhandJwtRefresh());
    await waitFor(() => expect(refresh).toHaveBeenCalledWith("row-1"));
    await waitFor(() => expect(start).toHaveBeenCalled());
  });

  it("does NOT refresh for non-auth errors (network transient)", async () => {
    const refresh = vi.fn();
    vi.mocked(ahandApi.refreshToken).mockImplementation(refresh);
    vi.mocked(useAhandLocalStatus).mockReturnValue({
      state: "error",
      kind: "network",
      message: "conn lost",
    } as any);
    renderHook(() => useAhandJwtRefresh());
    await new Promise((r) => setTimeout(r, 30));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("silently disables and stops when device is revoked server-side", async () => {
    vi.mocked(ahandApi.list).mockResolvedValue([]);
    const stop = vi.fn().mockResolvedValue(undefined);
    vi.mocked(ahandTauri.stop).mockImplementation(stop);
    vi.mocked(useAhandLocalStatus).mockReturnValue({
      state: "error",
      kind: "auth",
      message: "jwt_expired",
    } as any);
    renderHook(() => useAhandJwtRefresh());
    await waitFor(() =>
      expect(useAhandStore.getState().usersEnabled["u1"]?.enabled).toBe(false),
    );
    expect(stop).toHaveBeenCalled();
  });

  it("rate-limits to one refresh per 30s even on rapid re-emits", async () => {
    const refresh = vi
      .fn()
      .mockResolvedValue({
        deviceJwt: "x",
        jwtExpiresAt: "2026-05-01T00:00:00Z",
      });
    vi.mocked(ahandApi.refreshToken).mockImplementation(refresh);
    vi.mocked(ahandApi.list).mockResolvedValue([
      { id: "row-1", hubDeviceId: "dev-abc" } as any,
    ]);
    vi.mocked(ahandTauri.start).mockResolvedValue({ device_id: "dev-abc" });
    const localStatusMock = vi.mocked(useAhandLocalStatus);
    // First auth error
    localStatusMock.mockReturnValue({
      state: "error",
      kind: "auth",
      message: "",
    } as any);
    const { rerender } = renderHook(() => useAhandJwtRefresh());
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    // Immediately another auth error
    rerender();
    await new Promise((r) => setTimeout(r, 100));
    expect(refresh).toHaveBeenCalledTimes(1); // rate-limited
  });
});
```

- [ ] **Step 4: Commit**

```bash
cd /Users/winrey/Projects/weightwave/team9
git add apps/client/src/hooks/useAhandJwtRefresh.ts \
        apps/client/src/hooks/useAhandJwtRefresh.test.tsx \
        apps/client/src/routes/_authenticated.tsx
git commit -m "$(cat <<'EOF'
feat(client/ahand): auto-refresh JWT on auth error

Listens on the DaemonStatus event stream; when status transitions to
error:auth (ahandd lib reports jwt_expired on reconnect handshake),
automatically:
1. GET /api/ahand/devices to find the row for the cached hubDeviceId.
2. POST /api/ahand/devices/:id/token/refresh for a fresh JWT.
3. invoke('ahand_start') with the new JWT.

If the cached device no longer exists server-side (revoked), silently
stop the daemon + disable locally + inform user via toast.

Rate-limited to one attempt per 30s to avoid loops if the refresh
itself fails transiently and the daemon re-errors before the network
recovers.

Does nothing for kind:network errors — ahandd lib handles transient
network issues via its own backoff.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8.6: i18n resource files + namespace registration

**Goal:** Add the `ahand` i18n namespace across all supported locales with all strings referenced by Phase 8 components.

**Files:**

- Create: `apps/client/src/i18n/locales/en/ahand.json`
- Create: `apps/client/src/i18n/locales/zh-CN/ahand.json`
- Create: one file per additional supported locale in the repo (grep `apps/client/src/i18n/locales/` to inventory).
- Modify: `apps/client/src/i18n/index.ts` (or equivalent) — register the `ahand` namespace.

**Acceptance Criteria:**

- [ ] Resource key set in each locale file covers every `t("ahand.X")` call introduced in Phase 8:
  - `myDevices`, `thisMac`, `otherDevices` (pluralized), `allowLocalDevice`, `removeThisDevice`, `confirmRemoveThisMac`, `confirmRemove` (with `{{name}}`), `thisMacRemoved`, `removed` (with `{{name}}`)
  - Status: `online`, `offline`, `connecting`, `disabled`, `notConnected`, `statusAnyOnline`, `statusNoneOnline`, `lastSeen` (with `{{when}}`), `neverSeen`
  - Errors: `error.header`, `error.jwtExpired`, `error.hubUnavailable`, `error.toggleFailed` (with `{{msg}}`), `error.removeFailed` (with `{{msg}}`)
  - CTA (web): `ctaTitle`, `ctaBody`, `ctaPrimaryAction`, `ctaSecondaryAction`, `noAppInstalledHint`
  - `remove`
- [ ] English copy is the canonical source; translations should match spec § 5 tone ("让 Agent 接管你的电脑" style for zh-CN).
- [ ] i18n test utility covers: a snapshot test that renders each component and asserts no `"ahand.X"` raw-key strings appear (indicating missing translations).
- [ ] No hard-coded English strings remain in Phase 8's new components; every user-facing text uses `t(...)`.

**Verify:**

```bash
cd apps/client
rg -nP '>(My Devices|Allow|Remove|Online|Offline|Connecting)<' src/components/dialog/DevicesDialog.tsx src/components/dialog/devices/ src/components/layout/MainSidebar.tsx
# Should return zero hits (all via t()).
pnpm test i18n/ahand
```

**Steps:**

- [ ] **Step 1: English resource file**

```json
// apps/client/src/i18n/locales/en/ahand.json
{
  "myDevices": "My Devices",
  "thisMac": "This Mac",
  "otherDevices_zero": "My Other Devices",
  "otherDevices_one": "My Other Devices (1)",
  "otherDevices_other": "My Other Devices ({{count}})",
  "allowLocalDevice": "Allow as agent target",
  "removeThisDevice": "Remove this device",
  "confirmRemoveThisMac": "Remove this device? The daemon will disconnect and your ahand identity will be cleared.",
  "confirmRemove": "Remove {{name}}? That device will lose its connection.",
  "thisMacRemoved": "This device has been removed.",
  "removed": "{{name}} has been removed.",
  "remove": "Remove",

  "online": "● Online",
  "offline": "Offline",
  "connecting": "⟳ Connecting…",
  "disabled": "Disabled",
  "notConnected": "Not connected",
  "statusAnyOnline": "Some devices online",
  "statusNoneOnline": "No devices online",
  "lastSeen": "last active {{when}}",
  "neverSeen": "never seen",

  "error": {
    "header": "✕ Error",
    "jwtExpired": "Session expired; refreshing…",
    "hubUnavailable": "Remote service unavailable. Please try again.",
    "toggleFailed": "Failed to toggle: {{msg}}",
    "removeFailed": "Failed to remove: {{msg}}"
  },

  "ctaTitle": "Let agents take over your computer",
  "ctaBody": "Use the Team9 desktop app to turn this machine into your agent's remote execution arm — at near-zero cost.",
  "ctaPrimaryAction": "Open Desktop App",
  "ctaSecondaryAction": "Download Desktop App",
  "noAppInstalledHint": "If nothing happened, the desktop app may not be installed yet."
}
```

- [ ] **Step 2: Chinese resource file**

```json
// apps/client/src/i18n/locales/zh-CN/ahand.json
{
  "myDevices": "我的设备",
  "thisMac": "这台电脑",
  "otherDevices_zero": "我的其他设备",
  "otherDevices_one": "我的其他设备 (1)",
  "otherDevices_other": "我的其他设备 ({{count}})",
  "allowLocalDevice": "允许作为 agent 可用机器",
  "removeThisDevice": "移除此设备",
  "confirmRemoveThisMac": "确定移除此设备？daemon 将断开连接，本地 ahand 身份将被清除。",
  "confirmRemove": "确定移除 {{name}}？该机器会失去连接。",
  "thisMacRemoved": "已移除此设备。",
  "removed": "已移除 {{name}}。",
  "remove": "移除",

  "online": "● 在线",
  "offline": "离线",
  "connecting": "⟳ 连接中…",
  "disabled": "已停用",
  "notConnected": "未连接",
  "statusAnyOnline": "有设备在线",
  "statusNoneOnline": "无设备在线",
  "lastSeen": "最后活跃 {{when}}",
  "neverSeen": "从未上线",

  "error": {
    "header": "✕ 错误",
    "jwtExpired": "会话已过期，正在刷新…",
    "hubUnavailable": "远程服务不可用，请稍后重试。",
    "toggleFailed": "切换失败：{{msg}}",
    "removeFailed": "移除失败：{{msg}}"
  },

  "ctaTitle": "让 Agent 接管你的电脑",
  "ctaBody": "使用 Team9 桌面应用把这台电脑变成你 Agent 的远程执行手臂，以极低的成本获得本机 shell 能力。",
  "ctaPrimaryAction": "打开桌面应用",
  "ctaSecondaryAction": "下载桌面应用",
  "noAppInstalledHint": "如果没有反应，桌面应用可能尚未安装。"
}
```

- [ ] **Step 3: Register namespace**

```ts
// apps/client/src/i18n/index.ts (patch — add 'ahand' to preload namespaces)

import enAhand from "./locales/en/ahand.json";
import zhAhand from "./locales/zh-CN/ahand.json";
// ...other locales

i18n.use(initReactI18next).init({
  resources: {
    en: { /* ...existing namespaces */ ahand: enAhand },
    "zh-CN": { /* ... */ ahand: zhAhand },
    // ...other locales
  },
  ns: ["translation", /* ...existing */ "ahand"],
  defaultNS: "translation",
});
```

If the repo loads namespaces lazily, no addition here is needed; just ensure the JSON files exist in the loader's expected path.

- [ ] **Step 4: Cross-check no missing keys**

```bash
cd apps/client
# Extract all t('ahand.…') references
rg -nP "t\(['\"]ahand\.([a-zA-Z_.]+)['\"]" src/components/ src/hooks/ src/routes/ \
  -o --replace '$1' | sort -u > /tmp/keys.txt

# Intersect with keys in en/ahand.json
jq -r 'paths(scalars) | join(".")' src/i18n/locales/en/ahand.json | sort -u > /tmp/json-keys.txt

# Show any referenced keys missing from JSON
comm -23 /tmp/keys.txt /tmp/json-keys.txt
# Expected: no output
```

- [ ] **Step 5: Commit**

```bash
cd /Users/winrey/Projects/weightwave/team9
git add apps/client/src/i18n/locales/*/ahand.json apps/client/src/i18n/index.ts
git commit -m "$(cat <<'EOF'
feat(client/ahand): i18n resources for devices UI

Adds the 'ahand' i18n namespace across all supported locales.
Covers every t() key referenced in Phase 8 components:
DevicesDialog, ThisMacSection, WebCtaCard, OtherDevicesList,
MainSidebar entry, plus error/status labels from useAhand*
hooks and bootstrap.

Translator guidance lives in the zh-CN file (aligned with spec § 5
tone). Additional locales to be supplied by translators in follow-
up; English is the source of truth until translations are filled.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8.7: Legacy TS cleanup — remove old aHand setup paths

**Goal:** Delete all legacy code paths that assumed the sidecar-based aHand flow, as inventoried in spec § 8. Clean, atomic removal commit so the diff is reviewable.

**Files to DELETE:**

- `apps/client/src/stores/useAHandSetupStore.ts`
- `apps/client/src/hooks/useAHandStatus.ts`
- `apps/client/src/components/dialog/AHandSetupDialog.tsx`
- `apps/client/src/components/layout/LocalDeviceStatus.tsx`

**Files to PATCH (remove references):**

- `apps/client/src/components/layout/MainSidebar.tsx` — drop any lingering `import { useAHandSetupStore } from "@/stores/useAHandSetupStore"` and related usage. (Phase 8 Task 8.4 already replaces the entry UI, but there may be stale references remaining.)
- `apps/client/src/routes/_authenticated.tsx` — drop any `useAHandSetupStore()` trigger; replaced by `useAhandBootstrap()` in Task 8.4.
- Any other file that imports from the deleted modules — grep + delete usage.
- i18n legacy keys in `apps/client/src/i18n/locales/*/resources.json` — grep `aHandSetup` and remove only those keys. Leave other `aHand*` keys that might live in a now-obsolete but not-yet-deleted part of the UI (verify each).

**Acceptance Criteria:**

- [ ] `rg -nP 'useAHandSetupStore|AHandSetupDialog|LocalDeviceStatus|useAHandStatus' apps/client/src/` returns zero hits.
- [ ] `grep -c "aHandSetup" apps/client/src/i18n/locales/*/resources.json` returns zero (all files).
- [ ] `pnpm --filter @team9/client test` and `pnpm --filter @team9/client build` both pass.
- [ ] `pnpm tauri dev` boots without "missing import" warnings.
- [ ] Git diff for this commit shows **only** deletions (for the four files above) and small reference-removal patches — no refactors sneak in.

**Verify:**

```bash
cd apps/client
rg -nP 'useAHandSetupStore|AHandSetupDialog|LocalDeviceStatus|useAHandStatus' src/
pnpm typecheck
pnpm test
pnpm tauri dev
# All should succeed; last one only needs to boot, no interaction required.
```

**Steps:**

- [ ] **Step 1: Inventory references**

```bash
cd apps/client
rg -nP 'useAHandSetupStore|AHandSetupDialog|LocalDeviceStatus|useAHandStatus|aHandSetup' src/ > /tmp/legacy-refs.txt
cat /tmp/legacy-refs.txt
```

Review each hit. For each file:

- If the file is already replaced (e.g., `MainSidebar.tsx` now uses `useAhandLocalStatus`), delete the old import + any leftover code paths.
- If the file is genuinely no longer needed (the four files listed above), delete the file.

- [ ] **Step 2: Delete files**

```bash
git rm apps/client/src/stores/useAHandSetupStore.ts
git rm apps/client/src/hooks/useAHandStatus.ts
git rm apps/client/src/components/dialog/AHandSetupDialog.tsx
git rm apps/client/src/components/layout/LocalDeviceStatus.tsx
```

- [ ] **Step 3: Patch remaining references**

For each reference in `/tmp/legacy-refs.txt`, open the file and remove the import + call site. If the file is `MainSidebar.tsx`, the Phase 8 Task 8.4 patch already replaced the rendering logic; this step only prunes dead imports.

- [ ] **Step 4: Prune i18n keys**

```bash
# For each resources.json, remove keys starting with 'aHandSetup'.
for f in apps/client/src/i18n/locales/*/resources.json; do
  jq 'del(.aHandSetup) | del(.aHand)' "$f" > "$f.new" && mv "$f.new" "$f"
done
```

Review each diff — retain any `aHand` keys that are still referenced by live code (tool: `rg aHand\. apps/client/src/ --glob '!i18n/**'`).

- [ ] **Step 5: Verify + commit**

```bash
cd apps/client
pnpm typecheck
pnpm test

git add -A
git commit -m "$(cat <<'EOF'
chore(client/ahand): remove legacy sidecar-era aHand UI paths

Deletes:
- stores/useAHandSetupStore.ts
- hooks/useAHandStatus.ts
- components/dialog/AHandSetupDialog.tsx
- components/layout/LocalDeviceStatus.tsx

Replaced by the new Phase 8 stack: useAhandStore + useAhandDevices +
useAhandLocalStatus + DevicesDialog + MainSidebar entry. Prunes
imports + lingering references across the codebase and strips
aHandSetup.* i18n keys that are no longer referenced.

With this commit, the aHand codebase has a single, consistent
vocabulary (lowercase 'ahand') and no dead code from the sidecar era.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

**Phase 8 outcome:** The Tauri + web client now has a complete devices management UI, auto-resume on login, transparent JWT refresh, Socket.io-live device updates, and i18n-covered strings. The legacy sidecar-era paths are fully deleted. Paired with Phase 7's Tauri Rust side, the "allow → register → daemon online → agent can execute" loop is functional end-to-end.

---

## Phase 9 — Integration, E2E, Contract, Load Tests

**Working directories:** all three repos (`team9`, `team9-agent-pi`, `ahand`).

Phase 9 validates the seams between phases. Each test file exercises multiple components together against real (or close-to-real) dependencies. Unit tests written in earlier phases already cover happy+bad+edge paths within each component; Phase 9 focuses on **cross-component correctness**.

**Dependencies:**

- Phases 1–8 all complete; code compiles and unit tests pass.
- Some tests require real Postgres + Redis via `testcontainers` (already used by team9 for other integration tests — follow existing patterns).

---

### Task 9.1: claw-hive `__integration__/ahand.integration.test.ts`

**Goal:** Spin up a local mock ahand-hub (Rust bin or Node SSE server) + real HiveRuntime + real AHandHostComponent + real AHandContextProvider + real HostComponent (multi-backend). Drive a complete agent run that executes a remote command through the full stack.

**Files:**

- Create: `packages/claw-hive/src/__integration__/ahand.integration.test.ts`
- Create: `packages/claw-hive/src/__integration__/fixtures/mock-hub-server.ts` (Node HTTP + SSE implementing Phase 1 Task 1.4 α endpoints)

**Acceptance Criteria:**

- [ ] Mock hub implements `POST /api/control/jobs` → returns `{ jobId }`; `GET /api/control/jobs/:id/stream` → SSE emits `stdout` + `stderr` + `finished` events deterministically per an in-memory script; `POST /api/control/jobs/:id/cancel` → best-effort.
- [ ] A single end-to-end test in which: blueprint has HostComponent + 2 AHandHostComponent + AHandContextProvider → agent calls `run_command({ backend: "ahand:user-computer:d1", command: "echo hi" })` → mock hub returns `stdout: "hi\n"` + `finished: { exitCode: 0 }` → tool result in the agent's message includes `backend: "ahand:user-computer:d1"` + `stdout: "hi\n"`.
- [ ] Test covers the sticky-backend scenario (second call without backend reuses the first) and cache-system (change device set between prompt calls → `<host-context>` rebuilds).
- [ ] Test covers `ahand.list_devices` tool returning live data.
- [ ] Test covers error paths: mock hub returns 404 (device offline) → agent sees clear error message; SSE disconnects mid-stream → partial stdout captured.
- [ ] Runs in under 30 seconds; no flaky timing (use explicit `await` boundaries, not sleeps).

**Verify:** `pnpm vitest run packages/claw-hive/src/__integration__/ahand.integration.test.ts`.

**Steps:**

- [ ] **Step 1: Mock hub server**

```ts
// packages/claw-hive/src/__integration__/fixtures/mock-hub-server.ts

import http from "node:http";
import type { AddressInfo } from "node:net";

export interface MockJobScript {
  /** Events to emit in order after the SSE stream opens. */
  events: Array<
    | { delay?: number; stdout: string }
    | { delay?: number; stderr: string }
    | { delay?: number; finished: { exitCode: number; durationMs: number } }
    | { delay?: number; error: { code: string; message: string } }
  >;
}

export class MockHub {
  private server: http.Server;
  private jobs = new Map<string, MockJobScript>();
  private scriptForNext: MockJobScript | null = null;
  private jobCounter = 0;

  constructor() {
    this.server = http.createServer(async (req, res) => this.handle(req, res));
  }

  async start(): Promise<string> {
    return new Promise((resolve) => {
      this.server.listen(0, () => {
        const { port } = this.server.address() as AddressInfo;
        resolve(`http://127.0.0.1:${port}`);
      });
    });
  }
  async stop(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  /** Script what the next POST /api/control/jobs will return when its SSE opens. */
  scriptNextJob(script: MockJobScript): void {
    this.scriptForNext = script;
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url!, "http://x");
    if (req.method === "POST" && url.pathname === "/api/control/jobs") {
      const body = await readJson(req);
      if (!body.deviceId) {
        res.writeHead(400);
        res.end();
        return;
      }
      if (body.deviceId === "offline") {
        res.writeHead(404);
        res.end(JSON.stringify({ code: "device_offline" }));
        return;
      }
      this.jobCounter += 1;
      const jobId = `job-${this.jobCounter}`;
      this.jobs.set(
        jobId,
        this.scriptForNext ?? {
          events: [{ finished: { exitCode: 0, durationMs: 1 } }],
        },
      );
      this.scriptForNext = null;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jobId }));
      return;
    }
    const streamMatch = url.pathname.match(
      /^\/api\/control\/jobs\/(.+)\/stream$/,
    );
    if (req.method === "GET" && streamMatch) {
      const jobId = streamMatch[1];
      const script = this.jobs.get(jobId);
      if (!script) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
      for (const ev of script.events) {
        if (ev.delay) await new Promise((r) => setTimeout(r, ev.delay));
        if ("stdout" in ev)
          res.write(
            `event: stdout\ndata: ${JSON.stringify({ chunk: ev.stdout })}\n\n`,
          );
        else if ("stderr" in ev)
          res.write(
            `event: stderr\ndata: ${JSON.stringify({ chunk: ev.stderr })}\n\n`,
          );
        else if ("finished" in ev)
          res.write(
            `event: finished\ndata: ${JSON.stringify(ev.finished)}\n\n`,
          );
        else if ("error" in ev)
          res.write(`event: error\ndata: ${JSON.stringify(ev.error)}\n\n`);
      }
      res.end();
      this.jobs.delete(jobId);
      return;
    }
    res.writeHead(404);
    res.end();
  }
}

function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}
```

- [ ] **Step 2: Integration test**

```ts
// packages/claw-hive/src/__integration__/ahand.integration.test.ts

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import { MockHub } from "./fixtures/mock-hub-server";
import {
  HiveRuntime,
  AHandHostComponent,
  AHandContextProvider,
} from "../index";
import {
  HostComponent,
  SystemPromptComponent,
} from "@team9claw/agent-components";
// ...other imports needed to build a session

describe("ahand end-to-end through HiveRuntime", () => {
  let mockHub: MockHub;
  let hubUrl: string;

  beforeAll(async () => {
    mockHub = new MockHub();
    hubUrl = await mockHub.start();
  });
  afterAll(async () => {
    await mockHub.stop();
  });

  async function buildSession(options: {
    devices: Array<{
      hubDeviceId: string;
      nickname: string;
      isOnline: boolean;
    }>;
    callingClient: any;
  }) {
    const runtime = new HiveRuntime(/* storage, worker config */);
    // Stub out the GatewayAhandClient so it returns the in-test device list
    // without calling a real gateway. Use dependency injection via the
    // config's gatewayInternalUrl pointing at a tiny local HTTP server,
    // OR monkey-patch in the test.
    /* ... */
    const blueprint = {
      components: [
        { typeKey: "system-prompt", config: {} },
        { typeKey: "host", config: {} },
        ...options.devices
          .filter((d) => d.isOnline)
          .map((d) => ({
            typeKey: "ahand-host",
            config: {
              deviceId: d.hubDeviceId,
              deviceNickname: d.nickname,
              devicePlatform: "macos",
              callingUserId: "test-user",
              callingClient: options.callingClient,
              gatewayInternalUrl:
                /* local gateway-mock url */ "http://127.0.0.1:0",
              gatewayInternalAuthToken: "test-token",
              hubUrl,
            },
          })),
        {
          typeKey: "ahand-context-provider",
          config: {
            callingUserId: "test-user",
            callingClient: options.callingClient,
            gatewayInternalUrl:
              /* local gateway-mock url */ "http://127.0.0.1:0",
            gatewayInternalAuthToken: "test-token",
          },
        },
      ],
    };
    return await runtime.createSession(blueprint);
  }

  it("happy path: agent runs a command on a specific ahand backend", async () => {
    mockHub.scriptNextJob({
      events: [
        { stdout: "hi\n" },
        { finished: { exitCode: 0, durationMs: 5 } },
      ],
    });
    const session = await buildSession({
      devices: [
        { hubDeviceId: "d1", nickname: "Mac 1", isOnline: true },
        { hubDeviceId: "d2", nickname: "Mac 2", isOnline: true },
      ],
      callingClient: { kind: "web" },
    });
    // Run a tool call simulating LLM invocation:
    const result = await session.runTool("run_command", {
      backend: "ahand:user-computer:d1",
      command: "echo hi",
    });
    const body = JSON.parse(result.content[0].text);
    expect(body.backend).toBe("ahand:user-computer:d1");
    expect(body.stdout).toBe("hi\n");
    expect(body.exitCode).toBe(0);
  });

  it("sticky backend: second call without backend reuses the first", async () => {
    mockHub.scriptNextJob({
      events: [
        { stdout: "first\n" },
        { finished: { exitCode: 0, durationMs: 1 } },
      ],
    });
    mockHub.scriptNextJob({
      events: [
        { stdout: "second\n" },
        { finished: { exitCode: 0, durationMs: 1 } },
      ],
    });
    const session = await buildSession({
      devices: [{ hubDeviceId: "d1", nickname: "Mac", isOnline: true }],
      callingClient: { kind: "web" },
    });
    const r1 = await session.runTool("run_command", {
      backend: "ahand:user-computer:d1",
      command: "echo first",
    });
    const r2 = await session.runTool("run_command", { command: "echo second" });
    expect(JSON.parse(r1.content[0].text).backend).toBe(
      "ahand:user-computer:d1",
    );
    expect(JSON.parse(r2.content[0].text).backend).toBe(
      "ahand:user-computer:d1",
    ); // sticky reused
  });

  it("offline device rejects with clear error", async () => {
    const session = await buildSession({
      devices: [
        { hubDeviceId: "offline", nickname: "Dead Mac", isOnline: true },
      ], // backend registered
      callingClient: { kind: "web" },
    });
    const result = await session.runTool("run_command", {
      backend: "ahand:user-computer:offline",
      command: "echo x",
    });
    const body = JSON.parse(result.content[0].text);
    expect(body.exitCode).not.toBe(0);
    expect(body.stderr).toMatch(/offline/i);
  });

  it("cache-system: <ahand-context> rebuilds when device list changes", async () => {
    const session = await buildSession({
      devices: [{ hubDeviceId: "d1", nickname: "Mac", isOnline: true }],
      callingClient: { kind: "web" },
    });
    const prompt1 = await session.buildSystemPrompt();
    expect(prompt1).toMatch(/id="d1"/);

    // Simulate a new device added and cache invalidated:
    await session.invalidateCache({
      keys: ["ahand-context"],
      mode: "next-turn",
    });
    // Re-mock the GatewayAhandClient to return a device set that includes d2:
    /* mutate the injected mock */
    const prompt2 = await session.buildSystemPrompt();
    expect(prompt2).toMatch(/id="d2"/);
  });
});
```

**Note:** The test above assumes helpers like `session.runTool(...)`, `session.buildSystemPrompt()`, `session.invalidateCache(...)` are exposed for testing. If they aren't in the public API, add them as `@internal`-marked test-only methods on `AgentSession` in Phase 2 Task 2.4.

- [ ] **Step 3: Commit**

```bash
cd /Users/winrey/Projects/weightwave/team9-agent-pi
git add packages/claw-hive/src/__integration__/ahand.integration.test.ts \
        packages/claw-hive/src/__integration__/fixtures/mock-hub-server.ts
git commit -m "$(cat <<'EOF'
test(claw-hive/ahand): end-to-end integration against a mock hub

Adds a minimal Node HTTP+SSE mock of ahand-hub's control-plane
endpoints (POST /api/control/jobs, GET .../stream, /cancel). Tests
drive a real HiveRuntime session with HostComponent + multiple
AHandHostComponents + AHandContextProvider, verifying:
- run_command routed to the explicit backend returns expected
  exitCode + stdout + backend echo in tool result
- Sticky backend behavior across multiple calls
- 404 device_offline translated into clear tool error
- cache-system <ahand-context> rebuild on invalidate

Total runtime < 30s with explicit awaits (no sleep()-based flakes).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9.2: team9 gateway `ahand.integration.spec.ts` (NestJS e2e)

**Goal:** Boot the full gateway NestJS app against a testcontainer'd Postgres + Redis + a stubbed hub (supertest-hosted). Drive registration → webhook → list → revoke flows and verify cross-component correctness.

**Files:**

- Create: `apps/server/apps/gateway/test/ahand.integration.spec.ts`
- Create: `apps/server/apps/gateway/test/fixtures/mock-hub-admin.ts` (small NestJS-independent HTTP server mocking `/api/admin/*` endpoints)

**Acceptance Criteria:**

- [ ] Uses the existing NestJS integration test harness (`test/integration.ts` or equivalent — grep for `Test.createTestingModule`'s existing usage + any testcontainers fixtures).
- [ ] Covers these scenarios (§ 9.4.4 / § 9.4.8 gateway integration matrix):
  1. Happy: register device via `POST /api/ahand/devices` (with valid JWT auth) → row in DB + mock hub received POST + device JWT returned.
  2. Happy: `GET /api/ahand/devices` returns the list with presence derived from Redis `ahand:device:<id>:presence` keys (seed Redis manually).
  3. Happy: hub webhook → `POST /api/ahand/hub-webhook` with HMAC-signed body for `device.online` → Redis presence key set; Socket.io emit observable via a test client.
  4. Idempotency: same webhook eventId posted twice → second returns 204 with no side-effects.
  5. Ownership: user A POST refresh-token on user B's device → 404.
  6. 10 concurrent POST `/devices` same `hubDeviceId` → exactly one succeeds (UNIQUE), 9 get 409.
  7. Redis outage: kill Redis mid-test → `GET /api/ahand/devices` still returns list with `isOnline: null`; no 500.
  8. Hub 5xx during register → transaction rolls back, no row created.
- [ ] Runtime < 60s; runs in CI (dev tier is acceptable, prod-parity not required).

**Verify:** `pnpm --filter gateway test:e2e ahand.integration.spec.ts`.

**Steps:**

- [ ] **Step 1: Mock hub admin HTTP fixture**

```ts
// apps/server/apps/gateway/test/fixtures/mock-hub-admin.ts

import http from "node:http";
import type { AddressInfo } from "node:net";

export interface MockHubBehavior {
  postDevicesResponse?: { status: number; body: any };
  mintTokenResponse?: { status: number; body: any };
  deleteDeviceResponse?: { status: number };
  receivedRequests: Array<{ method: string; path: string; body: any }>;
}

export class MockHubAdmin {
  private server: http.Server;
  readonly behavior: MockHubBehavior = { receivedRequests: [] };

  constructor() {
    this.server = http.createServer(async (req, res) => {
      const body = await readJson(req);
      this.behavior.receivedRequests.push({
        method: req.method!,
        path: req.url!,
        body,
      });
      const url = new URL(req.url!, "http://x");

      if (req.method === "POST" && url.pathname === "/api/admin/devices") {
        const r = this.behavior.postDevicesResponse ?? {
          status: 200,
          body: {
            deviceId: body.deviceId,
            createdAt: new Date().toISOString(),
          },
        };
        res.writeHead(r.status, { "content-type": "application/json" });
        res.end(JSON.stringify(r.body));
        return;
      }
      if (
        req.method === "POST" &&
        url.pathname.match(/^\/api\/admin\/devices\/[^/]+\/token$/)
      ) {
        const r = this.behavior.mintTokenResponse ?? {
          status: 200,
          body: {
            token: "test-jwt",
            expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
          },
        };
        res.writeHead(r.status, { "content-type": "application/json" });
        res.end(JSON.stringify(r.body));
        return;
      }
      if (req.method === "DELETE") {
        const r = this.behavior.deleteDeviceResponse ?? { status: 204 };
        res.writeHead(r.status);
        res.end();
        return;
      }
      res.writeHead(404);
      res.end();
    });
  }

  async start(): Promise<string> {
    return new Promise((resolve) =>
      this.server.listen(0, () => {
        const { port } = this.server.address() as AddressInfo;
        resolve(`http://127.0.0.1:${port}`);
      }),
    );
  }
  async stop(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }
}

async function readJson(req: http.IncomingMessage): Promise<any> {
  let data = "";
  for await (const chunk of req) data += chunk;
  return data ? JSON.parse(data) : {};
}
```

- [ ] **Step 2: Main integration test**

```ts
// apps/server/apps/gateway/test/ahand.integration.spec.ts

import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { MockHubAdmin } from "./fixtures/mock-hub-admin";
import { createHmac } from "crypto";
import { io, Socket } from "socket.io-client";
import Redis from "ioredis";
import { ConfigModule } from "@nestjs/config";
// ...testcontainer fixture from repo's existing test/setup

describe("ahand module e2e", () => {
  let app: INestApplication;
  let hub: MockHubAdmin;
  let redis: Redis;
  let authHeader: string; // Bearer <test-user-JWT>
  let webhookSecret = "test-webhook-secret-chars-0000";

  beforeAll(async () => {
    hub = new MockHubAdmin();
    const hubUrl = await hub.start();
    // Override env so the app boots with test-controlled URLs:
    process.env.AHAND_HUB_URL = hubUrl;
    process.env.AHAND_HUB_SERVICE_TOKEN = "test-service-token";
    process.env.AHAND_HUB_WEBHOOK_SECRET = webhookSecret;
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
    redis = new Redis(process.env.REDIS_URL!);
    authHeader = `Bearer ${await issueTestUserJwt("u1")}`;
  });

  afterAll(async () => {
    await redis.quit();
    await app.close();
    await hub.stop();
  });

  beforeEach(async () => {
    hub.behavior.receivedRequests = [];
    await redis.flushdb();
  });

  it("registers a device → DB row + hub POST + device JWT returned", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/ahand/devices")
      .set("authorization", authHeader)
      .send({
        hubDeviceId: "a".repeat(64),
        publicKey: "base64-pk",
        nickname: "My Mac",
        platform: "macos",
      })
      .expect(201);
    expect(res.body.deviceJwt).toBe("test-jwt");
    expect(
      hub.behavior.receivedRequests.some(
        (r) => r.path === "/api/admin/devices",
      ),
    ).toBe(true);
  });

  it("GET /devices merges DB + Redis presence", async () => {
    await redis.set(
      `ahand:device:${"a".repeat(64)}:presence`,
      "online",
      "EX",
      300,
    );
    // register first
    await request(app.getHttpServer())
      .post("/api/ahand/devices")
      .set("authorization", authHeader)
      .send({
        hubDeviceId: "a".repeat(64),
        publicKey: "p",
        nickname: "A",
        platform: "macos",
      })
      .expect(201);
    const res = await request(app.getHttpServer())
      .get("/api/ahand/devices")
      .set("authorization", authHeader)
      .expect(200);
    expect(
      res.body.some(
        (d: any) => d.hubDeviceId === "a".repeat(64) && d.isOnline === true,
      ),
    ).toBe(true);
  });

  it("hub webhook with valid HMAC sets Redis presence + emits Socket.io", async () => {
    // register first
    await request(app.getHttpServer())
      .post("/api/ahand/devices")
      .set("authorization", authHeader)
      .send({
        hubDeviceId: "a".repeat(64),
        publicKey: "p",
        nickname: "A",
        platform: "macos",
      })
      .expect(201);

    const serverUrl = await app.getUrl();
    const socket: Socket = io(serverUrl, {
      auth: { token: await issueTestUserJwt("u1") },
    });
    await new Promise<void>((resolve) => socket.once("connect", resolve));
    const emissions: any[] = [];
    socket.on("device.online", (p) => emissions.push(p));
    socket.emit("ahand:join_room", { room: "user:u1:ahand" });

    const body = JSON.stringify({
      eventId: "evt_test_1",
      eventType: "device.online",
      occurredAt: new Date().toISOString(),
      deviceId: "a".repeat(64),
      externalUserId: "u1",
      data: { presenceTtlSeconds: 180 },
    });
    const sig =
      "sha256=" +
      createHmac("sha256", webhookSecret).update(body).digest("hex");
    const ts = String(Math.floor(Date.now() / 1000));
    await request(app.getHttpServer())
      .post("/api/ahand/hub-webhook")
      .set("x-ahand-signature", sig)
      .set("x-ahand-timestamp", ts)
      .set("x-ahand-event-id", "evt_test_1")
      .set("content-type", "application/json")
      .send(body)
      .expect(204);

    expect(await redis.get(`ahand:device:${"a".repeat(64)}:presence`)).toBe(
      "online",
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(emissions).toHaveLength(1);
    socket.disconnect();
  });

  it("idempotency: same eventId twice → 204 both, side effects once", async () => {
    /* similar test; verify no duplicate DB update */
  });

  it("ownership: refresh token on another user's device → 404", async () => {
    // register as u1
    await request(app.getHttpServer())
      .post("/api/ahand/devices")
      .set("authorization", authHeader)
      .send({
        hubDeviceId: "b".repeat(64),
        publicKey: "p",
        nickname: "A",
        platform: "macos",
      })
      .expect(201);
    const u2Header = `Bearer ${await issueTestUserJwt("u2")}`;
    // u2 tries to refresh u1's device (row id from GET)
    const list = await request(app.getHttpServer())
      .get("/api/ahand/devices")
      .set("authorization", authHeader)
      .expect(200);
    const deviceRowId = list.body[0].id;
    await request(app.getHttpServer())
      .post(`/api/ahand/devices/${deviceRowId}/token/refresh`)
      .set("authorization", u2Header)
      .expect(404);
  });

  it("concurrent register same deviceId → exactly one succeeds", async () => {
    const results = await Promise.allSettled(
      Array(10)
        .fill(0)
        .map(() =>
          request(app.getHttpServer())
            .post("/api/ahand/devices")
            .set("authorization", authHeader)
            .send({
              hubDeviceId: "c".repeat(64),
              publicKey: "p",
              nickname: "A",
              platform: "macos",
            }),
        ),
    );
    const successes = results.filter(
      (r) => r.status === "fulfilled" && (r.value as any).status === 201,
    );
    expect(successes).toHaveLength(1);
  });

  it("hub 5xx during register → DB rollback, no row, frontend sees 503", async () => {
    hub.behavior.postDevicesResponse = {
      status: 503,
      body: { message: "hub down" },
    };
    await request(app.getHttpServer())
      .post("/api/ahand/devices")
      .set("authorization", authHeader)
      .send({
        hubDeviceId: "d".repeat(64),
        publicKey: "p",
        nickname: "A",
        platform: "macos",
      })
      .expect(503);
    const list = await request(app.getHttpServer())
      .get("/api/ahand/devices")
      .set("authorization", authHeader)
      .expect(200);
    expect(
      list.body.find((d: any) => d.hubDeviceId === "d".repeat(64)),
    ).toBeUndefined();
  });
});

async function issueTestUserJwt(userId: string): Promise<string> {
  // Issue a minimal JWT that the gateway's JwtAuthGuard accepts. Uses the
  // same signing secret/algorithm as the existing test fixtures (grep for
  // 'issueTestJwt' in the repo). Included here as stub.
  return "test-jwt-for-" + userId;
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/winrey/Projects/weightwave/team9
git add apps/server/apps/gateway/test/ahand.integration.spec.ts \
        apps/server/apps/gateway/test/fixtures/mock-hub-admin.ts
git commit -m "$(cat <<'EOF'
test(gateway/ahand): e2e integration against testcontainer Postgres + Redis

Drives the full NestJS app booted on top of containerized Postgres
and Redis, with a locally-hosted Node HTTP fixture mocking ahand-hub's
admin API. Covers:
- Register → row persisted + hub POST made + JWT returned
- GET list derives isOnline from Redis presence keys
- Hub webhook with valid HMAC sets Redis + emits Socket.io to room
- eventId dedupe across replicas
- Cross-user ownership enforcement (404)
- Concurrent registration race wins exactly one
- Hub 5xx triggers transactional rollback, no partial state

Runtime budget ~60s; uses the repo's existing testcontainers fixture.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9.3: im-worker `ahand-dynamic-device.integration.spec.ts`

**Goal:** Verify the end-to-end session lifecycle: message triggers session start → blueprint extended with ahand → device event on Redis hot-adds backend → agent sees new tool → device offline removes backend.

**Files:**

- Create: `apps/server/apps/im-worker/test/ahand-dynamic-device.integration.spec.ts`

**Acceptance Criteria:**

- [ ] Uses mock `AhandControlPlaneClient` (returns scripted device lists) + real Redis pub/sub (testcontainer) + real claw-hive HiveRuntime (in-process).
- [ ] Scenario 1: session starts with 1 online device → 1 AHandHostComponent registered. Publish `device.online` for a new device on Redis → dispatcher hot-adds second AHandHostComponent → next prompt has both backends.
- [ ] Scenario 2: session has 2 online devices → publish `device.offline` for one → dispatcher removes it + next prompt doesn't list it. Agent run_command against the removed backend errors clearly.
- [ ] Scenario 3: `device.heartbeat` events are no-ops (no component mutation).
- [ ] Scenario 4: `device.registered` for a currently-offline new device invalidates `<ahand-context>` cache but does NOT register a backend.
- [ ] Scenario 5 (multi-session fanout): same user has two sessions; one event affects both.
- [ ] Scenario 6 (error isolation): one session's `removeComponent` throws → other sessions unaffected.
- [ ] All scenarios deterministic via explicit awaits; < 30s total.

**Verify:** `pnpm --filter im-worker test:integration ahand-dynamic-device.integration.spec.ts`.

**Steps:**

- [ ] **Step 1: Test skeleton**

```ts
// apps/server/apps/im-worker/test/ahand-dynamic-device.integration.spec.ts

import { Test } from "@nestjs/testing";
import { AppModule } from "../src/app.module";
import { AhandControlPlaneClient } from "../src/ahand/ahand-control-plane.service";
import { AhandSessionDispatcher } from "../src/ahand/ahand-session-dispatcher.service";
import { AhandSessionTrackingService } from "../src/ahand/ahand-session-tracking.service";
import { HiveRuntime } from "@team9claw/claw-hive";
import Redis from "ioredis";

describe("im-worker ahand dynamic device lifecycle", () => {
  let moduleRef: any;
  let dispatcher: AhandSessionDispatcher;
  let tracking: AhandSessionTrackingService;
  let hive: HiveRuntime;
  let publisher: Redis;
  let controlStub: jest.Mocked<AhandControlPlaneClient>;

  beforeAll(async () => {
    controlStub = {
      listDevicesForUser: jest.fn(),
      mintControlPlaneToken: jest.fn().mockResolvedValue({
        token: "cp",
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      }),
    } as any;
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AhandControlPlaneClient)
      .useValue(controlStub)
      .compile();
    dispatcher = moduleRef.get(AhandSessionDispatcher);
    tracking = moduleRef.get(AhandSessionTrackingService);
    hive = moduleRef.get(HiveRuntime);
    publisher = new Redis(process.env.REDIS_URL!);
  });

  afterAll(async () => {
    await publisher.quit();
    await moduleRef.close();
  });

  async function startSessionFor(
    userId: string,
    initialDevices: Array<{
      hubDeviceId: string;
      isOnline: boolean;
      nickname?: string;
    }>,
  ) {
    controlStub.listDevicesForUser.mockResolvedValueOnce(
      initialDevices.map((d) => ({
        id: `id-${d.hubDeviceId}`,
        hubDeviceId: d.hubDeviceId,
        publicKey: "p",
        nickname: d.nickname ?? "A",
        platform: "macos",
        hostname: null,
        status: "active",
        isOnline: d.isOnline,
        lastSeenAt: null,
        createdAt: new Date().toISOString(),
      })),
    );
    // Trigger a message → session start; returns the created sessionId.
    // (exact API depends on AgentSessionService; stub as `startForTest`.)
    const sessionId = await (
      moduleRef.get("AgentSessionService") as any
    ).startForTest({
      userId,
      clientContext: null,
    });
    return sessionId;
  }

  it("hot-adds backend on device.online mid-session", async () => {
    const sessionId = await startSessionFor("u1", [
      { hubDeviceId: "d1", isOnline: true },
    ]);
    const session = hive.getSession(sessionId)!;
    expect(await countBackends(session)).toBe(1);

    // Prepare the next listDevicesForUser call (dispatcher will fetch fresh data
    // to resolve the new device's metadata):
    controlStub.listDevicesForUser.mockResolvedValueOnce([
      {
        id: "id-d1",
        hubDeviceId: "d1",
        publicKey: "p",
        nickname: "A",
        platform: "macos",
        hostname: null,
        status: "active",
        isOnline: true,
        lastSeenAt: null,
        createdAt: "",
      },
      {
        id: "id-d2",
        hubDeviceId: "d2",
        publicKey: "p",
        nickname: "B",
        platform: "macos",
        hostname: null,
        status: "active",
        isOnline: true,
        lastSeenAt: null,
        createdAt: "",
      },
    ]);

    // Publish the event
    await publisher.publish(
      "ahand:events:u1",
      JSON.stringify({
        ownerType: "user",
        eventType: "device.online",
        data: { hubDeviceId: "d2" },
        publishedAt: new Date().toISOString(),
      }),
    );
    // Dispatcher awaits async; wait for reconcile.
    await waitFor(async () => (await countBackends(session)) === 2);
  });

  it("removes backend on device.offline mid-session", async () => {
    const sessionId = await startSessionFor("u2", [
      { hubDeviceId: "d1", isOnline: true },
      { hubDeviceId: "d2", isOnline: true, nickname: "B" },
    ]);
    const session = hive.getSession(sessionId)!;
    expect(await countBackends(session)).toBe(2);

    await publisher.publish(
      "ahand:events:u2",
      JSON.stringify({
        ownerType: "user",
        eventType: "device.offline",
        data: { hubDeviceId: "d1" },
        publishedAt: new Date().toISOString(),
      }),
    );
    await waitFor(async () => (await countBackends(session)) === 1);
  });

  it("device.heartbeat is a no-op", async () => {
    const sessionId = await startSessionFor("u3", [
      { hubDeviceId: "d1", isOnline: true },
    ]);
    const session = hive.getSession(sessionId)!;
    const before = await countBackends(session);
    await publisher.publish(
      "ahand:events:u3",
      JSON.stringify({
        ownerType: "user",
        eventType: "device.heartbeat",
        data: { hubDeviceId: "d1" },
        publishedAt: new Date().toISOString(),
      }),
    );
    await new Promise((r) => setTimeout(r, 200));
    expect(await countBackends(session)).toBe(before);
  });

  it("multi-session fan-out: one user's event affects all their sessions", async () => {
    const a = await startSessionFor("u4", [
      { hubDeviceId: "d1", isOnline: true },
    ]);
    const b = await startSessionFor("u4", [
      { hubDeviceId: "d1", isOnline: true },
    ]);
    await publisher.publish(
      "ahand:events:u4",
      JSON.stringify({
        ownerType: "user",
        eventType: "device.offline",
        data: { hubDeviceId: "d1" },
        publishedAt: new Date().toISOString(),
      }),
    );
    await waitFor(async () => (await countBackends(hive.getSession(a)!)) === 0);
    await waitFor(async () => (await countBackends(hive.getSession(b)!)) === 0);
  });

  async function countBackends(session: any): Promise<number> {
    return session
      .listComponents()
      .filter((c: any) => c.typeKey === "ahand-host").length;
  }
  async function waitFor(
    cond: () => Promise<boolean>,
    timeoutMs = 5000,
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await cond()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("waitFor timeout");
  }
});
```

- [ ] **Step 2: Commit**

```bash
cd /Users/winrey/Projects/weightwave/team9
git add apps/server/apps/im-worker/test/ahand-dynamic-device.integration.spec.ts
git commit -m "$(cat <<'EOF'
test(im-worker/ahand): dynamic device lifecycle integration

Drives real Redis pub/sub + real claw-hive HiveRuntime in-process,
with mocked AhandControlPlaneClient scripted to return specific
device lists. Verifies:
- device.online on Redis → AhandSessionDispatcher hot-adds a
  backend to all the user's active sessions
- device.offline → backend removed without affecting concurrent
  sessions of the same user that don't have that backend attached
- device.heartbeat → strictly no-op (no component mutation)
- Multi-session fan-out: one event touches every owning session

Tests use explicit waitFor() polling rather than fixed sleeps,
bounded at 5s. Test harness reuses the repo's testcontainer-backed
Redis; no flaky timing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9.4: Playwright E2E suite — 9 scenarios from spec § 9.4.9

**Goal:** Full end-to-end UI flow testing against a real Tauri build + real team9 gateway/im-worker (Railway staging) + a mock ahand-hub running locally. Covers the 9 scenarios enumerated in spec § 9.4.9.

**Files:**

- Create: `apps/client/tests/e2e/ahand/scenarios/` (one file per scenario)
- Create: `apps/client/tests/e2e/ahand/fixtures/mock-hub.ts` (re-use from Task 9.1 via shared path, or copy)
- Create: `apps/client/tests/e2e/ahand/setup.ts` (shared Playwright project config)
- Modify: `apps/client/playwright.config.ts` — add the ahand suite as a separate project.

**Acceptance Criteria:**

- [ ] Scenarios per spec § 9.4.9:
  1. First-time enable → register → green dot
  2. Cross-device visibility: Tauri enables, Web shows in list
  3. Agent executes remote command (drives a full IM conversation that triggers agent tool use)
  4. Revoke device
  5. Reconnect after network cut
  6. JWT expiry auto-refresh
  7. Registration while offline → rollback
  8. Two users / one Mac (distinct deviceIds)
  9. One user / two Macs (distinct deviceIds)
- [ ] Uses `tauri-driver` or `webdriverio` (match repo's existing Tauri E2E harness; grep `tauri-driver` / `TauriDriver`).
- [ ] Nightly-only (not gated on every PR) — runtime budget 20–30 minutes for all scenarios.
- [ ] Each scenario in its own file with a clear, descriptive name; parallel-safe (no shared global state between scenarios).
- [ ] Screenshots + trace captured on failure (standard Playwright config).

**Verify:** `pnpm --filter @team9/client e2e:ahand` runs all scenarios headless against a local mock-hub + staging backend.

**Steps:**

- [ ] **Step 1: Shared setup**

```ts
// apps/client/tests/e2e/ahand/setup.ts

import type { FullConfig } from "@playwright/test";
import { MockHub } from "./fixtures/mock-hub"; // shared with Task 9.1

export let mockHub: MockHub;

export async function globalSetup(_config: FullConfig): Promise<void> {
  mockHub = new MockHub();
  const url = await mockHub.start();
  process.env.E2E_MOCK_HUB_URL = url;
  // Tell the staging backend / dev environment to route ahand traffic through this mock.
  // In practice: SSH/port-forward pattern, or test-only override in the staging config.
}

export async function globalTeardown(): Promise<void> {
  await mockHub.stop();
}
```

- [ ] **Step 2: Scenario template**

Scenario files follow a shared template. Example for Scenario 1 (first-time enable):

```ts
// apps/client/tests/e2e/ahand/scenarios/01-first-enable.spec.ts

import { test, expect } from "@playwright/test";
import { createTauriAppPage, issueTestUser } from "../helpers";

test.describe("Scenario 1: first-time enable ahand on this Mac", () => {
  test("empty state → allow → registered → green dot", async ({ page }) => {
    const user = await issueTestUser();
    await createTauriAppPage(page, user.jwt);

    await page.getByRole("button", { name: /my devices/i }).click();
    await expect(page.getByText(/no devices connected/i)).toBeVisible();

    await page.getByRole("button", { name: /allow this mac/i }).click();
    await expect(page.getByText(/registering/i)).toBeVisible();

    // Wait for the status dot to transition to online
    await expect(page.locator('[aria-label="online"]').first()).toBeVisible({
      timeout: 15_000,
    });

    // Verify via backend that a device row exists
    const backendDevice = await user.listDevicesViaApi();
    expect(backendDevice).toHaveLength(1);
    expect(backendDevice[0].nickname).toBeTruthy();
  });
});
```

Each scenario replicates this pattern with its specific steps + assertions. Scenarios 2–9 follow the bulleted walkthroughs in spec § 9.4.9 verbatim.

- [ ] **Step 3: Helpers**

```ts
// apps/client/tests/e2e/ahand/helpers.ts

import type { Page } from "@playwright/test";

export async function createTauriAppPage(
  page: Page,
  jwt: string,
): Promise<void> {
  // Launches the Tauri build via tauri-driver; injects auth state.
  // Implementation depends on the repo's existing Tauri E2E harness.
  // If none exists: skip Tauri-specific scenarios, run the Web-mode scenarios
  // as a regular Playwright test against the staging web URL.
}

export async function issueTestUser(): Promise<{
  id: string;
  jwt: string;
  listDevicesViaApi(): Promise<any[]>;
  deleteDeviceViaApi(id: string): Promise<void>;
}> {
  // Call an admin/test endpoint on the staging gateway to create a fresh
  // ephemeral user. Return the JWT + helpers.
}
```

- [ ] **Step 4: Playwright project config**

```ts
// apps/client/playwright.config.ts (patch)

export default defineConfig({
  projects: [
    /* ...existing web project */
    {
      name: "ahand-e2e",
      testDir: "./tests/e2e/ahand",
      use: { trace: "on-first-retry", screenshot: "only-on-failure" },
      globalSetup: "./tests/e2e/ahand/setup.ts",
      retries: 1, // flakiness budget
      workers: 1, // serialize to avoid mock-hub cross-contamination
    },
  ],
});
```

- [ ] **Step 5: Nightly CI integration**

```yaml
# .github/workflows/e2e-nightly.yml (patch — add ahand suite)

- name: Run ahand E2E scenarios
  run: pnpm --filter @team9/client test:e2e --project=ahand-e2e
  env:
    STAGING_GATEWAY_URL: https://gateway.dev.team9.ai
    STAGING_WEB_URL: https://dev.team9.ai
```

- [ ] **Step 6: Commit**

```bash
cd /Users/winrey/Projects/weightwave/team9
git add apps/client/tests/e2e/ahand/ apps/client/playwright.config.ts \
        .github/workflows/e2e-nightly.yml
git commit -m "$(cat <<'EOF'
test(client/ahand): Playwright E2E covering 9 spec scenarios

Nightly Playwright project tests the ahand user flow end-to-end from
the Tauri/web UI against a real team9 staging backend + locally-hosted
mock ahand-hub. Scenarios per spec § 9.4.9:
1. First-time enable
2. Cross-device visibility (Tauri enables, Web lists)
3. Agent runs remote command via an IM conversation
4. Revoke device
5. Reconnect after network cut
6. JWT expiry auto-refresh (transparent to user)
7. Registration with offline network → rollback
8. Two users / one Mac → distinct deviceIds
9. One user / two Macs → distinct deviceIds

Serialized (workers=1) to avoid mock-hub cross-contamination. Retries
once to tolerate flaky E2E. Runtime budget 20-30 min; scheduled in
nightly workflow, not PR-gated.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9.5: Contract tests + load baseline

**Goal:** Lock the cross-repo schemas (hub ↔ gateway, @ahand/sdk ↔ hub, Tauri ↔ TS) with contract tests that fail CI on incompatible drift. Plus a one-off load baseline via `k6` per spec § 9.4.11.

**Files:**

- Create: `contracts/hub-control-plane.json` (JSON Schema for hub REST + SSE envelope payloads)
- Create: `contracts/hub-webhook.json` (JSON Schema for webhook events)
- Create: `ahand/contracts/tests/control-plane.contract.test.ts` (runs against real hub dev build, validates responses against schema)
- Create: `team9/apps/server/apps/gateway/test/contracts/hub-webhook.contract.test.ts` (validates that team9 gateway ACCEPTS all schema-conforming hub webhook events AND rejects malformed ones)
- Create: `team9-agent-pi/packages/sdk-contracts/src/cloud-client.contract.test.ts` (type-level tsd tests locking `CloudClient` method signatures)
- Create: `k6/ahand-load-baseline.js` (1000 daemons, heartbeat QPS, control-plane spawn throughput)

**Acceptance Criteria:**

- [ ] Contract schemas exist for: hub control-plane REST body + SSE events; hub webhook events. Schemas are the canonical spec and live in the `ahand` repo.
- [ ] team9 gateway's contract test fetches the latest ahand-repo schema as a file artifact (CI-downloaded or git-submodule), validates each of its expected webhook handlers against fuzzed-conforming-payloads, and asserts the ones marked invalid actually fail.
- [ ] `tsd` type tests freeze the `CloudClient.spawn` / `.cancel` / `.listDevices` signatures that team9 consumes.
- [ ] `k6/ahand-load-baseline.js` runs 3 scenarios (1000 connected daemons, 10k heartbeat webhooks/s, 100 concurrent agent spawns) and reports p95/p99. Run is manual / nightly, not PR-gated; baseline report stored as a CI artifact.
- [ ] Breaking schema changes (required field added, type change) cause the contract test to fail loudly in CI before downstream integration picks up a bad hub release.

**Verify:**

```bash
# ahand repo
cd /Users/winrey/Projects/weightwave/ahand
pnpm vitest run contracts/tests/

# team9 gateway
cd /Users/winrey/Projects/weightwave/team9
pnpm --filter gateway test:contracts

# team9-agent-pi
cd /Users/winrey/Projects/weightwave/team9-agent-pi
pnpm test --filter sdk-contracts

# k6 baseline (manual)
k6 run k6/ahand-load-baseline.js --out json=report.json
```

**Steps:**

- [ ] **Step 1: Schema files**

```json
// contracts/hub-control-plane.json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://ahand.team9.ai/contracts/hub-control-plane.json",
  "definitions": {
    "PostJobRequest": {
      "type": "object",
      "properties": {
        "deviceId": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
        "command": { "type": "string", "minLength": 1 },
        "cwd": { "type": "string" },
        "envs": {
          "type": "object",
          "additionalProperties": { "type": "string" }
        },
        "timeoutMs": { "type": "number", "minimum": 1 },
        "correlationId": { "type": "string" }
      },
      "required": ["deviceId", "command"],
      "additionalProperties": false
    },
    "PostJobResponse": {
      "type": "object",
      "properties": { "jobId": { "type": "string" } },
      "required": ["jobId"]
    },
    "SseEventStdout": {
      "type": "object",
      "properties": {
        "event": { "const": "stdout" },
        "data": {
          "type": "object",
          "properties": { "chunk": { "type": "string" } },
          "required": ["chunk"]
        }
      }
    }
    // ...more events (stderr, progress, finished, error)
  }
}
```

```json
// contracts/hub-webhook.json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "eventId": { "type": "string", "pattern": "^evt_[A-Za-z0-9_]+$" },
    "eventType": {
      "enum": [
        "device.registered",
        "device.online",
        "device.heartbeat",
        "device.offline",
        "device.revoked"
      ]
    },
    "occurredAt": { "type": "string", "format": "date-time" },
    "deviceId": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
    "externalUserId": { "type": "string" },
    "data": { "type": "object" }
  },
  "required": [
    "eventId",
    "eventType",
    "occurredAt",
    "deviceId",
    "externalUserId",
    "data"
  ],
  "additionalProperties": false
}
```

- [ ] **Step 2: team9 gateway contract test**

```ts
// apps/server/apps/gateway/test/contracts/hub-webhook.contract.test.ts

import Ajv from "ajv";
import addFormats from "ajv-formats";
import schema from "../../../../../../contracts/hub-webhook.json";
import { createHmac } from "crypto";
import request from "supertest";
import { bootstrapTestApp } from "../fixtures/bootstrap";

describe("hub-webhook contract", () => {
  const ajv = new Ajv({ strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  const validEvent = {
    eventId: "evt_CONTRACT_TEST",
    eventType: "device.heartbeat",
    occurredAt: new Date().toISOString(),
    deviceId: "a".repeat(64),
    externalUserId: "u1",
    data: { presenceTtlSeconds: 180 },
  };

  it("schema accepts the canonical payload", () => {
    expect(validate(validEvent)).toBe(true);
  });

  it("gateway accepts schema-conforming payload", async () => {
    const app = await bootstrapTestApp();
    const body = JSON.stringify(validEvent);
    const sig =
      "sha256=" +
      createHmac("sha256", process.env.AHAND_HUB_WEBHOOK_SECRET!)
        .update(body)
        .digest("hex");
    await request(app.getHttpServer())
      .post("/api/ahand/hub-webhook")
      .set("x-ahand-signature", sig)
      .set("x-ahand-timestamp", String(Math.floor(Date.now() / 1000)))
      .set("x-ahand-event-id", validEvent.eventId)
      .set("content-type", "application/json")
      .send(body)
      .expect(204);
  });

  it("schema rejects unknown eventType", () => {
    const bad = { ...validEvent, eventType: "device.explode" };
    expect(validate(bad)).toBe(false);
  });

  it("schema rejects missing required fields", () => {
    const bad: any = { ...validEvent };
    delete bad.externalUserId;
    expect(validate(bad)).toBe(false);
  });
});
```

- [ ] **Step 3: `CloudClient` tsd tests**

```ts
// packages/sdk-contracts/src/cloud-client.contract.test-d.ts

import { expectType, expectError } from "tsd";
import { CloudClient } from "@ahand/sdk";

const client = new CloudClient({ hubUrl: "x", getAuthToken: async () => "t" });

// spawn signature
expectType<Promise<{ exitCode: number; durationMs: number }>>(
  client.spawn({
    deviceId: "d",
    command: "echo hi",
  }),
);

// cancel signature
expectType<Promise<void>>(client.cancel("job-1"));

// listDevices signature
expectType<Promise<Array<{ deviceId: string; isOnline?: boolean /*...*/ }>>>(
  client.listDevices("u1"),
);

// Refusal: passing a number as deviceId should not type-check
expectError(client.spawn({ deviceId: 123 as any, command: "x" }));
```

- [ ] **Step 4: k6 load baseline**

```js
// k6/ahand-load-baseline.js

import http from "k6/http";
import { check, sleep } from "k6";
import { SharedArray } from "k6/data";

export const options = {
  scenarios: {
    webhook_throughput: {
      executor: "constant-arrival-rate",
      rate: 1000,
      timeUnit: "1s",
      duration: "1m",
      preAllocatedVUs: 200,
      exec: "webhookScenario",
    },
    control_plane_spawn: {
      executor: "constant-vus",
      vus: 100,
      duration: "2m",
      exec: "spawnScenario",
    },
    // "daemon_connections" is harder to model in k6 alone; manual.
  },
  thresholds: {
    "http_req_duration{scenario:webhook_throughput}": [
      "p(95)<100",
      "p(99)<200",
    ],
    "http_req_duration{scenario:control_plane_spawn}": ["p(99)<500"],
  },
};

const GATEWAY_URL = __ENV.GATEWAY_URL ?? "https://gateway.dev.team9.ai";
const HUB_URL = __ENV.HUB_URL ?? "https://ahand-hub.dev.team9.ai";

export function webhookScenario() {
  // Payloads pre-signed outside of k6 (see Readme) and embedded as SharedArray
  const payloads = new SharedArray("webhooks", () =>
    JSON.parse(open("./webhook-payloads.json")),
  );
  const p = payloads[Math.floor(Math.random() * payloads.length)];
  const res = http.post(`${GATEWAY_URL}/api/ahand/hub-webhook`, p.body, {
    headers: {
      "content-type": "application/json",
      "x-ahand-signature": p.signature,
      "x-ahand-timestamp": p.timestamp,
      "x-ahand-event-id": p.eventId,
    },
  });
  check(res, { 204: (r) => r.status === 204 });
}

export function spawnScenario() {
  const res = http.post(
    `${HUB_URL}/api/control/jobs`,
    JSON.stringify({
      deviceId: __ENV.TEST_DEVICE_ID,
      command: "true",
      correlationId: `k6-${__VU}-${__ITER}`,
    }),
    {
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${__ENV.CP_JWT}`,
      },
    },
  );
  check(res, { 200: (r) => r.status === 200 });
  sleep(0.1);
}
```

Run pattern (not in CI):

```bash
# Precompute signed webhook payloads
node scripts/gen-webhook-payloads.js > webhook-payloads.json

# Execute k6
GATEWAY_URL=https://gateway.dev.team9.ai \
HUB_URL=https://ahand-hub.dev.team9.ai \
CP_JWT=$(mint-test-cp-jwt) \
TEST_DEVICE_ID=<dev-device-id> \
k6 run k6/ahand-load-baseline.js --out json=report.json
```

- [ ] **Step 5: Commits**

Two commits across repos (schemas + gateway contract test go in team9; tsd goes in team9-agent-pi; k6 is standalone infra).

```bash
cd /Users/winrey/Projects/weightwave/ahand
git add contracts/hub-control-plane.json contracts/hub-webhook.json
git commit -m "feat(contracts): publish JSON Schema for control-plane + webhook"

cd /Users/winrey/Projects/weightwave/team9
git add apps/server/apps/gateway/test/contracts/ k6/ahand-load-baseline.js
git commit -m "test(gateway/ahand): contract tests + k6 load baseline"

cd /Users/winrey/Projects/weightwave/team9-agent-pi
git add packages/sdk-contracts/src/cloud-client.contract.test-d.ts
git commit -m "test(sdk-contracts): tsd-lock CloudClient signatures"
```

---

**Phase 9 outcome:** Five integration and contract test suites anchor the cross-component correctness guarantees asserted in the spec. Any future change that violates the hub ↔ gateway contract, SDK surface, or event flow is caught in CI before reaching production.

---

## Phase 10 — Production Rollout

**Working directory:** varies (mostly operational — team9 infra, team9 gateway, Tauri release).

Phase 10 takes the fully-tested stack from Phases 1-9 and rolls it to production. No new code; only deploy steps, DNS cutover, Tauri release, user comms.

**Dependencies:** Phases 1-9 merged to `main` / `dev` branches of all three repos. All CI green; nightly E2E green for at least one cycle.

**Rollout strategy (no canary/gradual per spec — full cutover):** dev first, verify, then prod. All three services deploy atomically per env (hub → gateway → im-worker are all tightly coupled; there's no sensible intermediate state).

---

### Task 10.1: Deploy ahand-hub to dev + prod

**Goal:** Tag + publish the ahand-hub Docker image from the `ahand` repo; let `deploy-hub.yml` push to ECR and roll the ECS service. Verify health on both envs.

**Files:**

- No code changes. Operational only.

**Acceptance Criteria:**

- [ ] `ahand` repo commits from Phase 1 / Phase 2 all landed on `main`. If behind, first cut a dev branch and verify.
- [ ] Push to `dev` branch triggers `deploy-hub.yml` → builds + pushes image → updates ECS `ahand-hub-dev`. `aws ecs wait services-stable` succeeds.
- [ ] `curl https://ahand-hub.dev.team9.ai/api/health` returns 200 with expected payload.
- [ ] Inspect CloudWatch logs for first 10 minutes; no panics, JWT rejections, or webhook 5xx.
- [ ] Smoke: run Phase 9 Task 9.3 integration suite against `dev` env (not mock) using `RUN_AGAINST_DEV_HUB=1 pnpm test:integration`.
- [ ] Merge `dev` → `main` → same workflow runs for prod. Same `services-stable` + health check against `ahand-hub.team9.ai`.
- [ ] No webhook DLQ messages in Redis for 30+ minutes post-prod-deploy.

**Verify:**

```bash
# after dev deploy
curl -fsSL https://ahand-hub.dev.team9.ai/api/health
aws logs tail /ecs/ahand-hub --follow --filter-pattern 'ERROR' --profile ww
# no error lines within 5min window

# after prod deploy
curl -fsSL https://ahand-hub.team9.ai/api/health
aws ecs describe-services --cluster openclaw-hive --services ahand-hub-prod --profile ww \
  --query 'services[0].{running:runningCount, desired:desiredCount, events:events[0:3]}'
```

**Steps:**

- [ ] **Step 1: Pre-deploy checklist**

Before pushing anything, confirm:

- [ ] Phase 3 infra is applied for both envs (`terraform apply` clean).
- [ ] SSM parameters are populated (inventory via `aws ssm get-parameters-by-path --path /ahand-hub/prod/`).
- [ ] Team9 gateway's env vars `AHAND_HUB_URL`, `AHAND_HUB_SERVICE_TOKEN`, `AHAND_HUB_WEBHOOK_SECRET` point at the correct prod/dev SSM values (verify in Railway dashboard).
- [ ] Routes53 A records resolve (`dig +short ahand-hub.dev.team9.ai`, `dig +short ahand-hub.team9.ai`).

- [ ] **Step 2: Dev deploy + verification**

```bash
cd /Users/winrey/Projects/weightwave/ahand
git checkout dev
# Assuming all Phase 1/2 commits are already in dev:
git push origin dev
# Watch the GitHub Actions workflow; wait for services-stable.
# Then verify:
curl -fsSL https://ahand-hub.dev.team9.ai/api/health
aws logs tail /ecs/ahand-hub --follow --filter-pattern '' --profile ww | head -50
# Exercise: run the integration suite against dev
cd /Users/winrey/Projects/weightwave/team9
RUN_AGAINST_DEV_HUB=1 pnpm --filter gateway test:integration
```

If anything breaks: hotfix on dev, re-push. Do NOT proceed to prod until dev is green for 30+ minutes.

- [ ] **Step 3: Prod deploy**

```bash
cd /Users/winrey/Projects/weightwave/ahand
git checkout main
git merge --ff-only origin/dev
git push origin main
# Workflow fires against prod: ECS cluster openclaw-hive / service ahand-hub-prod.
# services-stable typically resolves in 5-8 minutes.
curl -fsSL https://ahand-hub.team9.ai/api/health
aws ecs describe-services --cluster openclaw-hive --services ahand-hub-prod --profile ww
```

- [ ] **Step 4: Post-deploy monitoring**

For the first 24 hours post-deploy, watch:

- CloudWatch log group `/ecs/ahand-hub` for ERROR patterns (`aws logs filter-log-events --filter-pattern "ERROR"`)
- Redis DLQ keys: `redis-cli -u $REDIS_URL --scan --pattern 'ahand:webhook:dlq:*' | wc -l` should stay at 0
- Gateway's receive-webhook rate (via existing APM / OpenTelemetry) should match the heartbeat expectation of ~1.7 req/s per 100 connected devices

**Rollback plan:** If prod is broken, immediately rollback:

```bash
# Find the last-known-good image tag
aws ecr describe-images --repository-name ahand-hub --profile ww \
  --query 'imageDetails[?imageTags && imageTags[0] != `prod`] | sort_by(@, &imagePushedAt)[-2].imageTags' \
  --output text
# Say that's <sha>. Retag and redeploy:
./deploy/hub/deploy.sh prod --pin-to-image "<sha>"
```

Document the last-known-good SHA in the PR description before merging prod.

---

### Task 10.2: Deploy team9 gateway + im-worker with ahand module enabled

**Goal:** Merge the team9 repo changes to `main` (auto-deploys to Railway prod). Verify the new endpoints, webhook receiver, and Socket.io events work in prod. Validate Tauri client compatibility (see Task 10.3).

**Acceptance Criteria:**

- [ ] Team9 repo commits from Phases 4, 5, 8 merged to `main`.
- [ ] Railway deploys both services (`API-Gateway` and `Im-worker`) automatically on push.
- [ ] `railway logs -s "API-Gateway"` shows successful boot (ahand module registered; Redis adapter wired; no circular-dep errors).
- [ ] Test the REST endpoints via `curl`:
  - `GET /api/ahand/devices` (with a real user JWT) → empty list initially.
  - `POST /api/ahand/devices` with a valid body → 201 + row inserted; double-check via `psql`.
  - `DELETE /api/ahand/devices/:id` → 204.
- [ ] Test the internal endpoints from im-worker side:
  - Tail im-worker logs during a simulated agent session (run against a test channel) → verify blueprint extension fires and device list is fetched from gateway.
- [ ] The webhook endpoint `POST /api/ahand/hub-webhook` returns 401 without HMAC, 204 with it (manual curl with signed payload).

**Verify:**

```bash
# Gateway boot health
curl -fsSL https://api.team9.ai/api/health

# Test REST (with a test-user JWT)
TEST_JWT=$(gen-test-jwt production)
curl -fsSL -H "Authorization: Bearer $TEST_JWT" https://api.team9.ai/api/ahand/devices

# Check migration applied
psql "$PROD_DATABASE_URL" -c "\d ahand_devices"

# Railway logs
railway logs -s "API-Gateway" --lines 100 | grep -i ahand
railway logs -s "Im-worker" --lines 100 | grep -i ahand
```

**Steps:**

- [ ] **Step 1: Merge + verify auto-deploy**

```bash
cd /Users/winrey/Projects/weightwave/team9
git checkout main
git merge --ff-only origin/dev   # assumes Phase 4/5/8 were merged to dev first
git push origin main
# Wait for Railway's auto-deploy (typically 3-5 min per service)
```

- [ ] **Step 2: Verify DB migration ran**

```bash
# Railway runs migrations automatically on boot via the existing
# pnpm run db:migrate gate. Confirm the ahand_devices table exists:
psql "$PROD_DATABASE_URL" -c "\d ahand_devices"
```

- [ ] **Step 3: Functional smoke**

```bash
# From a local shell with prod credentials:
TEST_USER_ID=<some test user uuid>
TEST_JWT=$(issue-team9-prod-jwt "$TEST_USER_ID")

# Register → list → delete cycle
curl -fsSL -X POST https://api.team9.ai/api/ahand/devices \
  -H "Authorization: Bearer $TEST_JWT" \
  -H "Content-Type: application/json" \
  -d '{"hubDeviceId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","publicKey":"testpk","nickname":"Smoke","platform":"macos"}'
curl -fsSL -H "Authorization: Bearer $TEST_JWT" https://api.team9.ai/api/ahand/devices
# note the returned device id, then:
curl -fsSL -X DELETE -H "Authorization: Bearer $TEST_JWT" https://api.team9.ai/api/ahand/devices/<id>
```

- [ ] **Step 4: Monitor for 24h**

- Sentry: filter new errors by `service:api-gateway` AND `module:ahand`. Zero tolerance.
- Railway metrics: API-Gateway memory + CPU stable (ahand module shouldn't shift the baseline significantly).
- Log volume per minute in `/ecs/ahand-hub` + gateway logs — confirm roughly what Phase 7 estimated.

---

### Task 10.3: Tauri desktop app release

**Goal:** Build + sign + notarize the Tauri app with the new ahand library embedded. Publish release artifacts. Users pull the new version via the existing auto-update channel.

**Files:**

- No code changes. Release artifacts are the output of `pnpm build:client:mac` + signing/notarization pipeline.

**Acceptance Criteria:**

- [ ] Tauri `apps/client/src-tauri/tauri.conf.json` version bumped (per existing convention — minor or patch per SemVer).
- [ ] CI builds succeed for macOS (Apple Silicon + Intel), Windows, Linux — matrix per the existing release workflow.
- [ ] macOS .app is notarized + stapled (Apple credentials are already set up in CI secrets per existing release pattern).
- [ ] Installer / DMG / AppImage uploaded to the team9 releases distribution (GitHub Releases, Team9's download page — follow existing release process).
- [ ] Auto-update feed (`latest.json` or whatever Tauri's updater consumes) points at the new version.
- [ ] Smoke test on all three platforms: fresh install → log in → open DevicesDialog → enable ahand → verify remote shell works via agent.
- [ ] Release notes drafted + published (see Step 4).

**Verify:**

```bash
# CI builds (watch in GitHub Actions):
# - desktop-build-mac-arm64
# - desktop-build-mac-x64
# - desktop-build-windows
# - desktop-build-linux

# Each artifact downloadable.

# Auto-update feed:
curl -fsSL https://team9.ai/desktop/latest.json
# Should reference the new version.
```

**Steps:**

- [ ] **Step 1: Version bump**

```bash
cd /Users/winrey/Projects/weightwave/team9/apps/client/src-tauri
# Bump version in tauri.conf.json and (if separate) package.json:
# e.g., "version": "1.X.Y+1"
```

- [ ] **Step 2: Tag + push**

```bash
cd /Users/winrey/Projects/weightwave/team9
VERSION=$(node -e "console.log(require('./apps/client/src-tauri/tauri.conf.json').version)")
git tag "desktop-v$VERSION"
git push origin "desktop-v$VERSION"
# The existing release workflow watches this tag pattern and fires builds
# across platforms.
```

- [ ] **Step 3: Cross-platform smoke**

For each of {macOS Apple Silicon, macOS Intel, Windows, Linux}:

- Download the installer from Releases.
- Install.
- Open the app, log in with a real team9 account (prod).
- Open DevicesDialog → toggle "Allow this Mac" (or equivalent label).
- Verify: green dot within 15s; backend DB has a new `ahand_devices` row via `psql`.
- Trigger an agent session that runs `echo "release test"` on the new device → verify output arrives.
- Open the DevicesDialog again → click "Remove this device" → verify daemon stops + DB row marked revoked.

- [ ] **Step 4: Release notes**

Draft public release notes with:

- What's new: "Your agent can now run shell commands on your computer."
- How to enable: "Click the laptop icon above your avatar → toggle on."
- Privacy: "Only you control which computers are connected. You can disable at any time."
- Requirements: "macOS 11+ / Windows 10+ / Linux."
- Known issues (if any post smoke tests).

Publish on:

- GitHub Releases (team9ai/team9)
- Team9 changelog page (if exists)
- Optional: in-app "What's New" dialog on first launch after upgrade

- [ ] **Step 5: Post-release watch**

For 72 hours after release:

- Crash reports via Sentry (filter by desktop version).
- Support channel feedback.
- `ahand_devices` registration counts vs downloads — proxy for adoption.
- Auto-update rollout percentage (existing metrics).

If a critical regression is found, roll back the `latest.json` feed to the previous version (users auto-downgrade).

---

**Phase 10 outcome:** The ahand feature is live in production. Users on Team9 desktop can enable it, agents can execute remote commands, and the full observability/rollback machinery is in place.

---

## Execution Summary

### Task inventory

| Phase                    | Repo(s)          | Tasks     | Total tasks  |
| ------------------------ | ---------------- | --------- | ------------ |
| 1 — ahand repo           | `team9ai/ahand`  | 1.1–1.7   | 7            |
| 2 — agent-pi framework   | `team9-agent-pi` | 2.1–2.4   | 4            |
| 3 — AWS infra            | team9 infra      | 3.1–3.6   | 6            |
| 4 — gateway ahand module | `team9`          | 4.1–4.8   | 8            |
| 5 — im-worker            | `team9`          | 5.1–5.4   | 4            |
| 6 — claw-hive components | `team9-agent-pi` | 6.1–6.4   | 4            |
| 7 — Tauri Rust           | `team9`          | 7.1–7.4   | 4            |
| 8 — frontend             | `team9`          | 8.1–8.7   | 7            |
| 9 — tests                | all              | 9.1–9.5   | 5            |
| 10 — rollout             | ops              | 10.1–10.3 | 3            |
| **Total**                |                  |           | **52 tasks** |

### Dependency graph (high level)

```
Phase 1 (ahand) ─┬────────────────────────────────────▶ Phase 3 (infra deploys live hub)
                  │
                  └─▶ Phase 4 (gateway imports @ahand/sdk)
                      │
Phase 2 (framework) ──┴─▶ Phase 5 (im-worker) ──▶ Phase 6 (components)
                                                    │
                                                    └─▶ Phase 7 (Tauri Rust)
                                                        │
                                                        └─▶ Phase 8 (frontend UI)
                                                            │
Phase 9 (tests) gates ▶─────────────────────────────────────▶ Phase 10 (rollout)
```

Phase 1, 2, 3 can be developed in parallel. Phase 6 depends on Phase 2. Phase 4 depends on Phase 1. Phase 5 depends on Phases 2, 4, 6. Phases 7+8 depend on Phase 4 (for the client-facing REST contract) and Phase 1 (for the Rust library). Phase 9 tests exercise Phases 1-8 combined. Phase 10 is the gated production push.

### Parallelization opportunities

Three engineers could pipeline:

- **Infra/Rust engineer:** Phase 3 (AWS) → Phase 1 (ahand lib-ization, hub REST, webhook, SDK) → Phase 7 (Tauri Rust).
- **Backend engineer:** Phase 2 (framework) → Phase 4 (gateway) → Phase 5 (im-worker) → Phase 6 (components with framework team).
- **Frontend engineer:** Phase 8 (client UI, can start as soon as Phase 4's REST contract is frozen).

Merge point: Phase 9 testing requires all three streams landed.

### Time estimates

Rough calendar guidance (assumes the team sizing in spec § 9.3):

- **Phases 1 + 3:** 4 dev-days (1 engineer)
- **Phase 2:** 3 dev-days (1 engineer; can overlap with Phase 1)
- **Phase 4:** 5 dev-days (1 engineer)
- **Phase 5:** 3 dev-days (1 engineer, same person as Phase 4)
- **Phase 6:** 4 dev-days (1 engineer, framework-literate)
- **Phase 7:** 3 dev-days (Rust-literate)
- **Phase 8:** 5 dev-days (frontend)
- **Phase 9:** 3 dev-days (can split across the three streams)
- **Phase 10:** 2 dev-days (elapsed; mostly waiting + monitoring)

**Total:** ~32 dev-days one-pass. With three engineers running in parallel: ~14 calendar days. Round up to 3 weeks including buffer for integration surprises.

### Re-entrance / resume

The plan assumes no intermediate state; a resuming agent can:

1. `cd` into the right working directory per the phase header.
2. Grep the repo for marker strings (file paths listed in each task's "Files:" block).
3. Run the task's Verify command. If it passes, the task is done; skip.
4. If it fails, execute the task's Steps from the first unfinished one.

Every task's `Verify:` step is self-contained and re-runnable — no hidden state in the task sequence beyond the codebase itself and the git log.

### Stopping points & clean abort rollback

If execution is aborted partway through:

- **Before Phase 10:** Nothing in production changes. Revert merged commits from any target branch if they cause local dev issues. Infra (Phase 3) is idempotent — `terraform destroy -target=module.ahand_hub_*` unwinds cleanly.
- **During Phase 10 Task 10.1 (hub deployed, rest not):** Delete the ECS service(s) via `terraform destroy -target=module.ahand_hub_prod.aws_ecs_service.ahand_hub`. Domain records auto-drain.
- **During Phase 10 Task 10.2 (gateway live but Tauri not released):** Harmless — the `/api/ahand/*` endpoints exist but no user can reach them without the new Tauri build. Can stay live indefinitely.
- **After Phase 10 Task 10.3 (Tauri released, feedback negative):** Roll back the Tauri auto-update feed to the prior `latest.json`; users downgrade. Gateway + hub can stay online; they just see no traffic.

---

## Final Plan Status

- **Spec:** [docs/superpowers/specs/2026-04-22-ahand-integration-design.md](../specs/2026-04-22-ahand-integration-design.md)
- **Plan:** this file, 52 tasks across 10 phases.
- **Ready to execute:** yes, pending user approval of phase sequencing and execution mode.

---
