# ahand Browser Runtime Install & Self-Check — Design

> **Status:** Design (approved via brainstorming on 2026-04-29).
> **Scope:** team9 Tauri desktop app + aHand `ahandd` library crate.
> **Owners:** team9-client, aHand.
> **Related / depends on:** PR #97 (team9-agent-pi browser tool), PR #87 (team9 gateway capabilities flow), PR #26 (aHand hub webhook caps). Those PRs delivered the end-to-end `capabilities` pipeline; this spec wires up the user-facing install + self-check UI that feeds it.

---

## 1 · Goal

End users sitting in the team9 Tauri client should be able to:

1. **See, at a glance, whether their local ahand device can do browser automation** — with per-component granularity (Node.js, Playwright CLI, a system browser).
2. **One-click install** the browser runtime dependencies on demand.
3. **One-toggle enable/disable** whether the agent is allowed to use the browser tool (without uninstalling anything).
4. **Get actionable self-help when something goes wrong** — per-step error diagnostics with concrete remediation instructions.

The ahand daemon already implements all the heavy lifting (`crates/ahandd/src/browser_setup/` has `inspect_all`, `run_all`, `run_step`). The Tauri desktop app already ships a `BrowserConfigTab` with a disabled "Coming Soon" install button. The gap this spec fills is wiring these together, adding progress-streaming, and making the capability live in the UI.

---

## 2 · Non-goals

- **Cross-device visibility.** "See my Mac's install state from my iPhone" is out of scope. The tab is a local desktop operation panel.
- **Playwright uninstall.** Enabling/disabling is a config flag (~bytes). Actually removing the 50-MB `@playwright/cli` npm install is not offered. Users who need this can run `npm uninstall -g --prefix ~/.ahand/node @playwright/cli` manually.
- **Changing the install mechanism itself.** The `ahandd::browser_setup` module is treated as a black-box dependency (small API additions only — see §4.1). We do not redesign how Playwright gets installed.
- **Changes to** `team9-agent-pi` **or the team9 server/gateway.** This feature is entirely team9-client + aHand. The caps/browser-tool pipeline downstream is already live.
- **Windows / Linux parity work.** `browser_setup` already handles these; we do not add platform-specific install logic. UI strings may need polish, but not in this spec.

---

## 3 · High-level architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Tauri renderer (React)                                      │
│  BrowserConfigTab.tsx → RuntimeCard                          │
│    ├─ overall status                                         │
│    ├─ per-step rows (Node / Playwright / System Browser)     │
│    ├─ Install / Retry button                                 │
│    ├─ Agent-visible toggle                                   │
│    └─ Log drawer (streaming)                                 │
└──────────────────────────────────┬───────────────────────────┘
                                   │ invoke() + Channel<T>
┌──────────────────────────────────▼───────────────────────────┐
│  Tauri backend (Rust)                                        │
│  src-tauri/src/ahand/browser_runtime.rs (NEW)                │
│    ├─ #[command] browser_status()                            │
│    │     → ahandd::browser_setup::inspect_all()              │
│    ├─ #[command] browser_install(force, on_progress)         │
│    │     → ahandd::browser_setup::run_all(progress_cb)       │
│    │     → Config::set_browser_enabled(true) + save          │
│    │     → AhandRuntime::reload()                            │
│    └─ #[command] browser_set_enabled(enabled, on_progress)   │
│          → Config::set_browser_enabled(enabled) + save       │
│          → AhandRuntime::reload()                            │
│                                                              │
│  src-tauri/src/ahand/runtime.rs (EXTEND)                     │
│    ├─ owns DaemonHandle                                      │
│    ├─ NEW: reload() — shutdown + respawn with fresh Config   │
│    └─ NEW: rollback-on-respawn-failure                       │
└──────────────────────────────────┬───────────────────────────┘
                                   │
                                   │ (single in-process Tokio task;
                                   │  no sidecar binary, no IPC, no UDS)
                                   ▼
      ahandd library ── WebSocket ──→ aHand hub
```

### Key invariants

- **Single source of truth for install state:** `ahandd::browser_setup` (library). Tauri backend is a pass-through — no duplicated install logic, no forked state.
- **Single source of truth for `browser_enabled`:** `~/.ahand/config.toml`. Tauri reads it via `ahandd::config::Config`; ahandd (re-)reads it at spawn time.
- **Progress is unidirectional:** ahandd callback → Tauri `Channel<BrowserProgressEvent>` → renderer subscriber. Renderer never polls.
- **"Agent-visible" is computed locally in Tauri**, not fetched from the team9 gateway. It equals `browser_enabled` (from config) **AND** daemon status is `Online` at query time. (Whether the most recent Hello carried `"browser"` is implied by these two conditions because `ahandd::spawn` freezes `browser_enabled` at spawn time, and `reload()` respawns on every enabled-toggle.)

### Cross-repo ownership

| Repo    | What changes                                                     | PR branch (suggested)             |
| ------- | ---------------------------------------------------------------- | --------------------------------- |
| `aHand` | `ahandd` library: progress-callback API + config mutation helper | `feat/browser-setup-progress-api` |
| `team9` | Tauri client: commands, runtime reload, UI                       | `feat/browser-runtime-install-ui` |

The team9 PR bumps `ahandd` git `rev` to pick up the aHand PR. Strict ordering (aHand merges first). See §9 for the full sequence.

---

## 4 · aHand (ahandd) library changes

### 4.1 `browser_setup` progress callback — extend, don't replace

**Current signatures** (`crates/ahandd/src/browser_setup/mod.rs`):

```rust
pub async fn run_all(
    force: bool,
    progress: impl Fn(ProgressEvent) + Send + Sync + 'static,
) -> Result<Vec<CheckReport>>;

pub async fn run_step(
    name: &str,
    force: bool,
    progress: impl Fn(ProgressEvent) + Send + Sync + 'static,
) -> Result<CheckReport>;

pub async fn inspect_all() -> Vec<CheckReport>;
pub async fn inspect(name: &str) -> Option<CheckReport>;
```

The callback already exists, but today's `ProgressEvent` is _phase-granular_ — it emits `Starting`/`Downloading`/`Extracting`/`Installing`/`Verifying`/`Done` with a human-readable `message` field. That's enough for a high-level status bar but **not** enough for the log-drawer requirement (§6.3: "verbatim stdout/stderr as lines arrive").

**Current `ProgressEvent` shape** (`crates/ahandd/src/browser_setup/types.rs`):

```rust
#[derive(Debug, Clone, Serialize)]
pub struct ProgressEvent {
    pub step: &'static str,              // "node" / "playwright"
    pub phase: Phase,                    // Starting / Downloading / ...
    pub message: String,
    pub percent: Option<u8>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Starting,
    Downloading,
    Extracting,
    Installing,
    Verifying,
    Done,
}
```

**Change: add a `Log` phase that carries line-granular child-process output, plus an `ErrorCode` sibling type for structured failures.** No new top-level enum; keep the `ProgressEvent` shape.

**New types** (append to `crates/ahandd/src/browser_setup/types.rs`):

```rust
/// Which stream a log line originated from, for lines emitted with
/// `Phase::Log`. `Info` is synthesized by Rust code; `Stdout`/`Stderr`
/// are forwarded verbatim from child processes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LogStream {
    Stdout,
    Stderr,
    Info,
}

/// Machine-readable classification of an install step failure. Lives on
/// `CheckStatus::Failed` (new variant, §4.3) and on the terminal
/// `ProgressEvent` for a failing step. The UI uses `code` to pick a
/// targeted help popover.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    PermissionDenied,
    Network,
    NoSystemBrowser,
    NodeMissing,
    VersionMismatch,
    Unknown,
}
```

**Extend `Phase`** (modify the existing enum in the same file) — add one variant:

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Starting,
    Downloading,
    Extracting,
    Installing,
    Verifying,
    Done,
    /// A raw log line from the running step. Look at `ProgressEvent.stream`
    /// to disambiguate stdout / stderr / synthesized info messages.
    /// `message` carries the line content; `percent` is always `None`.
    Log,
}
```

**Extend `ProgressEvent`** (same file) — add an optional `stream` field:

```rust
#[derive(Debug, Clone, Serialize)]
pub struct ProgressEvent {
    pub step: &'static str,
    pub phase: Phase,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub percent: Option<u8>,
    /// Set when `phase == Log`, absent otherwise.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream: Option<LogStream>,
}
```

**Signatures stay the same.** Only the payload gets richer. `run_all` / `run_step` already take the callback; we're just feeding them new `Phase::Log` events alongside the existing phase events.

**Invariant for callers:** `phase == Log` ⇒ `stream` is `Some(_)` and `message` is a single line (no trailing newline). For all other phases, `stream` is `None` and `message` is a human summary.

`inspect_all` / `inspect` remain unchanged (pure read, no progress).

### 4.2 Streaming child-process output

`crates/ahandd/src/browser_setup/playwright.rs` (and `node.rs`) currently use `Command::output().await` to collect stdout/stderr after the child exits. Replace with piped I/O that forwards each line as a `ProgressEvent { phase: Phase::Log, stream: Some(...) }`:

```rust
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use std::process::Stdio;
use std::sync::Arc;

let cb: Arc<dyn Fn(ProgressEvent) + Send + Sync> = Arc::new(progress);

let mut child = Command::new("npm")
    .args(&["install", "-g", "--prefix", &prefix, &format!("@playwright/cli@{PLAYWRIGHT_CLI_VERSION}")])
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()?;

let stdout = child.stdout.take().unwrap();
let stderr = child.stderr.take().unwrap();

// Two tokio tasks forwarding lines to the callback.
let cb_stdout = cb.clone();
let stdout_forwarder = tokio::spawn(async move {
    let mut lines = BufReader::new(stdout).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        cb_stdout(ProgressEvent {
            step: "playwright",
            phase: Phase::Log,
            message: line,
            percent: None,
            stream: Some(LogStream::Stdout),
        });
    }
});

let cb_stderr = cb.clone();
let stderr_forwarder = tokio::spawn(async move {
    let mut lines = BufReader::new(stderr).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        cb_stderr(ProgressEvent {
            step: "playwright",
            phase: Phase::Log,
            message: line,
            percent: None,
            stream: Some(LogStream::Stderr),
        });
    }
});

let status = child.wait().await?;
stdout_forwarder.await.ok();
stderr_forwarder.await.ok();
```

Rust-side status messages (e.g. `"Installing playwright-cli"`, `"playwright-cli {ver} already installed"`) continue to be emitted through the **existing** `Phase::Installing` / `Phase::Done` events (that's what they're for — high-level status). Raw per-line logs always use `Phase::Log` with a `stream`.

**Ownership note:** the callback is wrapped in `Arc<dyn Fn>` (not cloned directly) because `impl Fn` is `?Sized` and the two forwarder tasks each need a persistent reference. Any existing `impl Fn(ProgressEvent) + Send + Sync + 'static` caller (e.g. `ahandctl`) is compatible — we just wrap internally.

### 4.3 Error classification

Today, `playwright::ensure` and `node::ensure` return `Result<CheckReport>` — on failure they bubble up `anyhow::Error` via `bail!` (see `playwright.rs` lines ~135, 146, 157, 171 for the bail sites). The Tauri layer gets a string and would need to grep it. Fix this by adding a `Failed` variant to `CheckStatus` and classifying before the `bail!` disappears into prose.

**Extend `CheckStatus`** (`crates/ahandd/src/browser_setup/types.rs`):

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CheckStatus {
    Ok { version: String, path: PathBuf, source: CheckSource },
    Missing,
    Outdated { current: String, required: String, path: PathBuf },
    NoneDetected { tried: Vec<String> },
    /// An install step ran and failed. Only produced by the mutating
    /// (`run_all` / `run_step`) paths; `inspect_*` never returns this.
    Failed {
        code: ErrorCode,
        /// Full `anyhow::Error` stringification — for the log drawer.
        message: String,
    },
}
```

**Add a classifier** at the top of `crates/ahandd/src/browser_setup/mod.rs`:

```rust
/// Classify an `anyhow::Error` produced by an install step into a
/// machine-readable `ErrorCode`. The patterns match the `bail!` call
/// sites in `playwright.rs` / `node.rs` and the `no system browser`
/// message from `inspect_browser`.
pub fn classify_error(err: &anyhow::Error) -> ErrorCode {
    let s = format!("{err:#}"); // chain-format includes causes
    if s.contains("Permission denied") || s.contains("EACCES") {
        ErrorCode::PermissionDenied
    } else if s.contains("Network error")
        || s.contains("ECONNRESET")
        || s.contains("ETIMEDOUT")
        || s.contains("getaddrinfo")
    {
        ErrorCode::Network
    } else if s.contains("no system browser") {
        ErrorCode::NoSystemBrowser
    } else if s.contains("npm not found") || s.contains("Node") && s.contains("not installed") {
        ErrorCode::NodeMissing
    } else if s.contains("version") && (s.contains("mismatch") || s.contains("required")) {
        ErrorCode::VersionMismatch
    } else {
        ErrorCode::Unknown
    }
}
```

**Wire it into `run_all` / `run_step`** — the existing flow is:

```rust
// today — error bubbles up, no structured failure is reported:
let node_report = node::ensure(force, progress_ref).await?;
```

Replace with the catch-and-classify pattern:

```rust
// new — on failure, build a Failed CheckReport, emit a terminal
// ProgressEvent with the classification, and halt.
let node_report = match node::ensure(force, progress_ref).await {
    Ok(r) => r,
    Err(e) => {
        let code = classify_error(&e);
        let message = format!("{e:#}");
        progress_ref(ProgressEvent {
            step: "node",
            phase: Phase::Done,
            message: message.clone(),
            percent: None,
            stream: None,
        });
        let failed = CheckReport {
            name: "node",
            label: "Node.js",
            status: CheckStatus::Failed { code, message: message.clone() },
            fix_hint: Some(FixHint::RunStep {
                command: "ahandd browser-init --step node".into(),
            }),
        };
        // Preserve the old `Result<...>` return shape so ahandctl CLI
        // continues to print the error — but attach the classified
        // report on the anyhow error chain via a typed extension.
        return Err(e.context(FailedStepReport(failed)));
    }
};
```

Where `FailedStepReport` is a tiny newtype wrapper:

```rust
/// Attached to `anyhow::Error` via `.context()` so callers (notably
/// Tauri's `browser_runtime`) can downcast and get the classified
/// `CheckReport` without re-parsing the error string.
pub struct FailedStepReport(pub CheckReport);

impl std::fmt::Display for FailedStepReport {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "step `{}` failed", self.0.name)
    }
}

impl std::fmt::Debug for FailedStepReport {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "FailedStepReport({})", self.0.name)
    }
}
```

**Why this shape:** keeping `run_all` / `run_step` returning `Result<...>` preserves the CLI behavior exactly (ahandctl prints the error chain). The typed context lets the Tauri layer do `err.chain().find_map(|e| e.downcast_ref::<FailedStepReport>())` and get the classified `CheckReport` for UI rendering, without grepping error strings.

`inspect_browser` (lines 89-113 of `mod.rs`) does NOT need a `Failed` variant — it uses `CheckStatus::NoneDetected` and the existing `FixHint::ManualCommand`. That UI path is already good.

### 4.4 Config mutation helper

**Current** (`crates/ahandd/src/config.rs`):

```rust
impl Config {
    pub fn load(path: &Path) -> anyhow::Result<Self>;
    pub fn save(&self, path: &Path) -> anyhow::Result<()>;
    pub fn browser_config(&self) -> BrowserConfig;
}
```

**New:**

```rust
impl Config {
    /// Toggle the `[browser].enabled` flag in memory and persist to `path`.
    /// Returns the *previous* value so callers can detect no-ops.
    ///
    /// Semantics:
    /// - If `[browser]` section is absent, a default section is inserted
    ///   before writing.
    /// - All other fields of `[browser]` (e.g. `playwright_cli_path`) are
    ///   preserved.
    /// - The write is atomic: `config.toml.tmp` is written first, then
    ///   renamed into place.
    pub fn set_browser_enabled(&mut self, path: &Path, enabled: bool) -> anyhow::Result<bool>;
}
```

Atomic write is important because the Tauri backend may be competing with a daemon process that's reading the file at spawn time.

### 4.5 DaemonHandle — no changes

`DaemonHandle` stays immutable. No new methods. The team9 side's `AhandRuntime::reload()` does shutdown-and-respawn (§5.2). This keeps the library's contract simple: _"construct me with a config, destroy me when you want a different one"_.

### 4.6 Backwards compatibility

- `run_all` / `run_step` signatures are **unchanged**. The existing `ahandctl browser-init` call site keeps working without modification — it already passes a callback.
- `ProgressEvent` gains two optional fields (`stream`, via the existing `percent` slot pattern). Existing callers that don't inspect `stream` keep working; callers that match on `phase` need one extra arm for the new `Phase::Log` variant if they want per-line logs (CLI can choose to print them or ignore them).
- `CheckStatus` gains a `Failed` variant. Callers that exhaustively match need one new arm. The CLI already prints errors via the returned `anyhow::Error`, so no `CheckStatus::Failed` handling is strictly required there.
- `classify_error` and `FailedStepReport` are pure additions (`pub`). No removals.
- All existing unit tests continue to pass; the serde assertions in `types.rs` need two new tests asserting the `Log`-phase + `Failed`-status shapes (§7.1).

### 4.7 PR change summary

| File                                                | Change                                                                                                                                                     |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `crates/ahandd/src/browser_setup/types.rs`          | Add `LogStream` / `ErrorCode` enums; add `Phase::Log`; add `stream: Option<LogStream>` to `ProgressEvent`; add `CheckStatus::Failed { code, message }`.    |
| `crates/ahandd/src/browser_setup/mod.rs`            | Add `classify_error()`; add `FailedStepReport` newtype; wrap `node::ensure` / `playwright::ensure` calls in `run_all` / `run_step` with classify-on-error. |
| `crates/ahandd/src/browser_setup/playwright.rs`     | Piped I/O for `npm install` — emit `Phase::Log` events with `LogStream::Stdout`/`Stderr` per line.                                                         |
| `crates/ahandd/src/browser_setup/node.rs`           | Piped I/O for Node installer — same `Phase::Log` forwarding.                                                                                               |
| `crates/ahandd/src/browser_setup/browser_detect.rs` | No changes (inspect_browser already returns `NoneDetected` with `FixHint`).                                                                                |
| `crates/ahandd/src/config.rs`                       | Add `Config::set_browser_enabled(path, enabled)` with atomic write via `config.toml.tmp` + rename.                                                         |
| `crates/ahandctl/src/main.rs`                       | No required change; optionally pretty-print `Phase::Log` lines in the callback.                                                                            |
| Test files in `browser_setup/`                      | New unit tests: `classify_error` for each `ErrorCode` variant; `Phase::Log` serde; atomic config write.                                                    |

**Estimated size:** ~180-240 LoC incl. tests (smaller than original spec estimate because we're extending existing types rather than introducing a parallel enum).

---

## 5 · team9 Tauri backend changes

### 5.1 Existing `AhandRuntime`

Today's shape (`apps/client/src-tauri/src/ahand/runtime.rs`):

```rust
pub struct AhandRuntime {
    handle: ahandd::DaemonHandle,
    config_path: PathBuf,
    /* … other fields … */
}
```

`ahandd::spawn(config)` returns a `DaemonHandle` with no reconnect API. To pick up changes to `[browser].enabled`, the runtime must be **torn down and re-spawned**.

### 5.2 `AhandRuntime::reload()` — new method

```rust
#[derive(Debug, thiserror::Error)]
pub enum ReloadError {
    #[error("shutdown of previous daemon timed out")]
    ShutdownTimeout,
    #[error("spawn failed; rolled back to previous config: {0}")]
    SpawnFailedRolledBack(String),
    #[error("spawn failed and rollback also failed: primary={primary}, rollback={rollback}")]
    SpawnFailedNoRollback { primary: String, rollback: String },
    #[error("config reload failed: {0}")]
    ConfigLoad(#[from] anyhow::Error),
}

impl AhandRuntime {
    /// Gracefully tear down the running daemon and re-spawn with the
    /// current on-disk config. Used after `Config` mutations.
    ///
    /// The `on_event` callback receives `ReloadStarted`,
    /// `ReloadOnline`, or `ReloadFailed` so the UI can render progress.
    pub async fn reload<F>(&mut self, on_event: F) -> Result<(), ReloadError>
    where
        F: Fn(ReloadEvent) + Send + Sync + 'static;
}

#[derive(Debug, Clone)]
pub enum ReloadEvent {
    Started,
    /// Daemon reached Online state (hub handshake complete).
    Online,
    /// Daemon failed to reach Online within the grace period, or spawn
    /// itself failed.
    Failed { message: String },
}
```

**Algorithm:**

1. Clone the currently-in-use `DaemonConfig` as `rollback_config` (kept in memory, not written to disk).
2. `Config::load(&self.config_path)?` to get the latest persisted state.
3. Build `new_daemon_config = build_daemon_config(&loaded, runtime_context)` — the non-file fields (auth token, hub URL override, identity dir) are preserved from `self`, not re-read.
4. Emit `ReloadEvent::Started`.
5. `let old_handle = std::mem::replace(&mut self.handle, placeholder)`.
6. `timeout(Duration::from_secs(5), old_handle.shutdown()).await` — timeout → `ReloadError::ShutdownTimeout` (log + drop forcefully).
7. `match ahandd::spawn(new_daemon_config).await`:
   - `Ok(h)` → assign to `self.handle`; subscribe to status; wait up to 10 s for `Online` (otherwise emit `Failed { message: "handshake timeout" }` but keep the new handle); emit `ReloadEvent::Online` on handshake.
   - `Err(primary)` → try `ahandd::spawn(rollback_config)`:
     - `Ok(rolled_back)` → assign; return `Err(SpawnFailedRolledBack(...))`.
     - `Err(rollback_err)` → runtime is Offline; return `Err(SpawnFailedNoRollback { primary, rollback })`.

**Concurrency:** `AhandRuntime` is wrapped in a `tokio::sync::Mutex<Inner>` at the Tauri `State` layer. `reload()` takes `&mut self`; concurrent commands are serialized. Since reload can take seconds, other commands that try to grab the lock get a fast-fail error message (`"operation in progress"`), not a queue.

### 5.3 Three new `#[tauri::command]`

All three live in the new `apps/client/src-tauri/src/ahand/browser_runtime.rs`.

#### 5.3.1 `browser_status`

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserStatus {
    /// Aggregate across all steps: Ok if all Ok, Failed if any Failed, else Skipped.
    pub overall: StepStatus,
    /// Per-step detail.
    pub steps: Vec<BrowserStepStatus>,
    /// Is `[browser].enabled` currently true in config.toml?
    pub enabled: bool,
    /// Is the agent currently able to use the browser tool?
    /// Equals: `enabled` AND daemon status is `Online`.
    pub agent_visible: bool,
    /// Timestamp of this snapshot (ISO 8601).
    pub queried_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserStepStatus {
    /// "node" | "playwright" | "systemBrowser"
    pub name: String,
    /// Stable i18n key base, e.g. "browser.steps.node".
    pub label_key: String,
    pub status: StepStatus,
    /// e.g. installed version, or detected browser path.
    pub detail: Option<String>,
}

#[tauri::command]
pub async fn browser_status(
    state: State<'_, tokio::sync::Mutex<AhandRuntime>>,
) -> Result<BrowserStatus, String>;
```

Implementation:

1. Acquire lock.
2. `let checks = ahandd::browser_setup::inspect_all().await;` — produces per-step `CheckReport`.
3. Map each `CheckReport` → `BrowserStepStatus`.
4. Aggregate: `overall = if all Ok { Ok } else if any Failed { Failed } else { Skipped }`.
5. `let enabled = Config::load(&rt.config_path)?.browser_config().enabled.unwrap_or(false);`.
6. `let agent_visible = enabled && matches!(rt.handle.status(), DaemonStatus::Online { .. });`.
7. Return.

This command is idempotent + read-only — the renderer calls it on tab mount and after every mutating operation completes.

#### 5.3.2 `browser_install`

```rust
#[derive(Serialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum BrowserProgressEvent {
    StepStarted { name: String, label_key: String },
    StepLog { name: String, line: String, stream: LogStream },
    StepFinished {
        name: String,
        status: StepStatus,
        error: Option<StepError>,
        duration_ms: u64,
    },
    AllFinished { overall: StepStatus, total_duration_ms: u64 },
    ReloadStarted,
    ReloadOnline,
    ReloadFailed { message: String, kind: ReloadFailureKind },
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub enum ReloadFailureKind {
    ShutdownTimeout,
    SpawnFailedRolledBack,
    SpawnFailedNoRollback,
}

#[tauri::command]
pub async fn browser_install(
    state: State<'_, tokio::sync::Mutex<AhandRuntime>>,
    force: bool,
    on_progress: tauri::ipc::Channel<BrowserProgressEvent>,
) -> Result<BrowserStatus, String>;
```

Implementation:

1. Acquire lock (fast-fail if held).
2. Wrap `on_progress.send(...)` in an `Arc<dyn Fn(ahandd::browser_setup::ProgressEvent) + Send + Sync>`. The adapter converts each ahandd `ProgressEvent` into exactly one Tauri `BrowserProgressEvent`:

   | ahandd `ProgressEvent`                                             | Tauri `BrowserProgressEvent`                                                       |
   | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
   | `phase: Starting`                                                  | `StepStarted { name, label_key }` (first time per step)                            |
   | `phase: Downloading / Extracting / Installing / Verifying`         | `StepLog { name, line: message, stream: Info }` (progress messages)                |
   | `phase: Log, stream: Some(s)`                                      | `StepLog { name, line: message, stream: s }` (raw child output)                    |
   | `phase: Done`                                                      | `StepFinished { name, status: Ok, error: None, duration_ms }`                      |
   | (classify_error + FailedStepReport downcast on `Err` from run_all) | `StepFinished { name, status: Failed, error: Some({code, message}), duration_ms }` |
   | (synthesized by adapter after run_all returns)                     | `AllFinished { overall, total_duration_ms }`                                       |

   Per-step duration is tracked by the adapter (`Instant::now()` at `Starting`, delta at `Done`/`Err`).

3. Open a tee log writer at `~/.ahand/logs/browser-setup-{YYYYMMDD-HHMMSS}.log` — every converted `StepLog` event appends here as well (see §6.5).
4. `let result = ahandd::browser_setup::run_all(force, callback).await;` — no `Some(_)` wrapping; the callback type is the existing `impl Fn(ProgressEvent) + Send + Sync + 'static`.
5. If `result` is `Ok(reports)` and no report has `CheckStatus::Failed { .. }`:
   - `Config::load(&path) → set_browser_enabled(path, true) → save` (combined inside `set_browser_enabled`).
   - `rt.reload(|ev| on_progress.send(ev.into()).ok())` — forwards reload events to the same channel.
6. If `result` is `Err(e)`: downcast the chain for `FailedStepReport(report)` (§4.3). Emit `StepFinished { status: Failed, error: Some({ code, message }) }` where `code` comes from the report's `CheckStatus::Failed.code` (or `classify_error(&e)` as a fallback if no `FailedStepReport` was attached). Emit `AllFinished { overall: Failed }`. Do NOT touch config, do NOT reload.
7. Re-compute `browser_status()` and return it.

If step 5 hits `ReloadError`: the function returns `Err(error_message)` (i.e. the command itself fails), but the channel has already received structured `ReloadFailed { kind }` — the renderer has enough info to render without consulting the `Err`.

#### 5.3.3 `browser_set_enabled`

```rust
#[tauri::command]
pub async fn browser_set_enabled(
    state: State<'_, tokio::sync::Mutex<AhandRuntime>>,
    enabled: bool,
    on_progress: tauri::ipc::Channel<BrowserProgressEvent>,
) -> Result<BrowserStatus, String>;
```

Implementation:

1. Acquire lock.
2. If `enabled == true`, gate on `inspect_all()` reporting all steps Ok. If not installed → return `Err("browser_not_installed")`. (The renderer should disable this toggle in UI; this is defense-in-depth.)
3. `Config::load → set_browser_enabled(path, enabled) → save`. If the value is already `enabled`, skip the reload (no-op — log it).
4. `rt.reload(|ev| on_progress.send(...).ok())`.
5. Return `browser_status()`.

This command does NOT emit `StepStarted` / `StepFinished` — only `ReloadStarted` / `ReloadOnline` / `ReloadFailed` on the channel.

### 5.4 Log file

`apps/client/src-tauri/src/ahand/install_log.rs` (new, small module):

```rust
pub struct InstallLogWriter {
    path: PathBuf,
    file: tokio::fs::File,
}

impl InstallLogWriter {
    pub async fn create(dir: &Path) -> anyhow::Result<Self>;
    pub async fn write_line(&mut self, line: &str) -> anyhow::Result<()>;
    pub fn path(&self) -> &Path;
}

/// Prune logs older than 7 days to avoid disk bloat.
pub async fn rotate(dir: &Path) -> anyhow::Result<()>;
```

The writer is created at the start of `browser_install` and closed on return. Old logs (mtime > 7d) are pruned on each install invocation.

A companion command exposes the latest log for the renderer's "open log file" button:

```rust
#[tauri::command]
pub async fn browser_open_last_log(state: State<'_, ...>) -> Result<(), String>;
```

Uses `tauri-plugin-opener` to open the file in the OS default handler.

### 5.5 Command registration

`src-tauri/src/lib.rs` (or `main.rs`) — in the `.invoke_handler(tauri::generate_handler![...])` list:

```rust
browser_runtime::browser_status,
browser_runtime::browser_install,
browser_runtime::browser_set_enabled,
browser_runtime::browser_open_last_log,
```

And ensure `AhandRuntime` is registered as a `tokio::sync::Mutex`-wrapped Tauri state during setup.

### 5.6 `Cargo.toml` bump

```toml
# Before
ahandd = { git = "https://github.com/team9ai/aHand", package = "ahandd", rev = "ab5290c2dd8d2d8ec18b8959af37d415dedbfc77" }

# After (pointing at the merge commit of the aHand PR from §4)
ahandd = { git = "https://github.com/team9ai/aHand", package = "ahandd", rev = "<NEW_SHA_FROM_AHAND_PR>" }
```

### 5.7 PR change summary (backend portion)

| File                                                       | Change                       |
| ---------------------------------------------------------- | ---------------------------- |
| `apps/client/src-tauri/src/ahand/browser_runtime.rs` (NEW) | 3 commands + log tee wiring. |
| `apps/client/src-tauri/src/ahand/install_log.rs` (NEW)     | Log file helper.             |
| `apps/client/src-tauri/src/ahand/runtime.rs` (EXTEND)      | `reload()` + rollback.       |
| `apps/client/src-tauri/src/lib.rs`                         | Register commands + state.   |
| `apps/client/src-tauri/Cargo.toml`                         | Bump `ahandd` rev.           |
| Tests (co-located)                                         | See §7.2.                    |

**Estimated backend size:** ~350-450 LoC incl. tests.

---

## 6 · team9 Tauri renderer (React) changes

### 6.1 Scope

The work is entirely inside `BrowserConfigTab.tsx` → `RuntimeCard` subcomponent. `BrowserBinaryCard` (the "pick which browser" card) is not touched — that's a separate feature.

### 6.2 UI state model

Single-card internal FSM:

```
loading
   │   (first status fetch)
   ▼
idle ──── click Install ────→ installing
 │  ↑                            │
 │  │                            │ steps finish (all ok)
 │  │                            ▼
 │  └──── daemon Online ──── reloading
 │                               │
 │                               │ steps finish (any failed) OR
 │                               │  reload failed
 │                               ▼
 │   ←────────────────────── error
 │                               │
 │                               │ click Retry
 │                               │
 └───── toggle Enable ───────→ reloading
```

React state type:

```ts
type RuntimeUiState =
  | { kind: "loading" }
  | { kind: "idle"; status: BrowserStatus }
  | { kind: "installing"; progress: LogLine[]; steps: PerStepState }
  | { kind: "reloading"; frozenSteps: PerStepState }
  | {
      kind: "error";
      status: BrowserStatus;
      reason: ErrorReason;
      steps: PerStepState;
    };

type PerStepState = {
  node: { status: StepStatus; error?: StepError };
  playwright: { status: StepStatus; error?: StepError };
  systemBrowser: { status: StepStatus; error?: StepError };
};

type ErrorReason =
  | { kind: "installStepFailed"; stepName: string }
  | { kind: "reloadFailed"; failureKind: ReloadFailureKind; message: string }
  | { kind: "configWriteFailed"; message: string };
```

### 6.3 Visual layout

```
┌─ Card: 浏览器控制运行时 ────────────────────────────────────────┐
│ 📦 Playwright                   [● 已安装 / ○ 未安装]           │
│    Agent 打开和控制网页需要装它        [安装 / 重试 / 安装中…]  │
│                                                                  │
│ ───────── 分步状态（安装后或点 ▾ 展开） ───────────────────────  │
│ 🟢 Node.js                      已安装 (v20.10.0)                │
│ 🟢 Playwright CLI               已安装 (v1.48.0)                 │
│ 🔴 系统浏览器                   未检测到 Chrome/Edge  [帮助 ↗]  │
│                                                                  │
│ ───────── Agent 可见性 ───────────────────────────────────────  │
│ Agent 可以使用:  [切换开关 ——●——]   （设备已连接，操作即时生效）│
│                                                                  │
│ ▾ 查看日志 (42 lines)     [📁 打开日志文件]                     │
└──────────────────────────────────────────────────────────────────┘
```

Key interactions:

- **`[Install]` button:**
  - All steps `Ok` → button hidden.
  - Any step `NotRun` / `Failed` → shows `Install` (fresh) or `Retry` (partial-failure).
  - `installing` state → becomes `Installing…` with spinner + disabled.
- **Per-step `[帮助 ↗]`:** only shown when step `status === "failed"`. Opens a popover / dialog with:
  - Recommended shell commands for the error code (copy button).
  - External link (e.g. `https://google.com/chrome` for `NoSystemBrowser`).
  - Popover content keyed by `error.code` — see §6.4.
- **Agent-visible toggle:**
  - `overall !== Ok` → disabled, tooltip `"先完成安装"`.
  - `reloading` → disabled, spinner.
  - `installing` → disabled (the subsequent auto-enable will flip it).
- **Log drawer:**
  - Collapsed by default.
  - Auto-expanded during `installing` state.
  - Line-level log with `stdout` / `stderr` / `info` icons (outlined differently for color-blind users).
  - Auto-scroll to bottom during streaming, unless the user has manually scrolled up.
  - "打开日志文件" button invokes `browser_open_last_log`.

### 6.4 Error code → help content mapping

| ErrorCode          | i18n help key                   | Primary remediation                                                                      |
| ------------------ | ------------------------------- | ---------------------------------------------------------------------------------------- |
| `PermissionDenied` | `browser.help.permissionDenied` | Copy-to-clipboard command: `sudo chown -R $(whoami) ~/.ahand`                            |
| `Network`          | `browser.help.network`          | Text: check connection / proxy. If corporate network, suggests `npm config set proxy …`. |
| `NoSystemBrowser`  | `browser.help.noSystemBrowser`  | Button opening `https://google.com/chrome`.                                              |
| `NodeMissing`      | `browser.help.nodeMissing`      | Text: Node step should have run first; suggests re-running Install with force.           |
| `VersionMismatch`  | `browser.help.versionMismatch`  | Button: "Retry with --force".                                                            |
| `Unknown`          | `browser.help.unknown`          | Text: "查看完整日志" — opens log drawer.                                                 |

### 6.5 `useBrowserRuntime` hook

New file: `apps/client/src/hooks/useBrowserRuntime.ts`.

```ts
export function useBrowserRuntime() {
  const [state, setState] = useState<RuntimeUiState>({ kind: "loading" });

  const refresh = useCallback(async () => {
    try {
      const status = await invoke<BrowserStatus>("browser_status");
      setState({ kind: "idle", status });
    } catch (e) {
      setState({ kind: "error" /* … */ });
    }
  }, []);

  const install = useCallback(
    async (force: boolean) => {
      const channel = new Channel<BrowserProgressEvent>();
      channel.onmessage = (evt) => setState((prev) => applyProgress(prev, evt));
      setState({
        kind: "installing",
        progress: [],
        steps: initialSteps(state),
      });
      try {
        const final = await invoke<BrowserStatus>("browser_install", {
          force,
          onProgress: channel,
        });
        setState({ kind: "idle", status: final });
      } catch (e) {
        // Channel has already surfaced the structured reason; use it.
        setState((prev) => finalizeError(prev, String(e)));
      }
    },
    [state],
  );

  const setEnabled = useCallback(async (enabled: boolean) => {
    /* analogous — no install events, only reload events */
  }, []);

  const openLastLog = useCallback(async () => {
    await invoke("browser_open_last_log");
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { state, install, setEnabled, refresh, openLastLog };
}
```

- `applyProgress` is a pure reducer — testable in isolation.
- One `Channel` per invocation — not reused.
- `Channel.onmessage` handlers close over `setState`, which is React-stable; no stale closure risk.

### 6.6 i18n keys

Reuse existing `browser.*` keys where possible. New keys (zh-CN; en-US mirrored):

```json
{
  "browser": {
    "retry": "重试",
    "installing": "安装中…",
    "reloading": "应用中…",
    "steps": {
      "node": "Node.js",
      "playwright": "Playwright CLI",
      "systemBrowser": "系统浏览器"
    },
    "stepStatus": {
      "ok": "已安装",
      "skipped": "已跳过",
      "failed": "失败",
      "notRun": "未运行"
    },
    "help": {
      "buttonLabel": "帮助",
      "permissionDenied": {
        "title": "权限不足",
        "body": "installer 没有写入 ~/.ahand 的权限。请在终端运行：",
        "command": "sudo chown -R $(whoami) ~/.ahand"
      },
      "network": {
        "title": "网络错误",
        "body": "下载失败。检查网络连接；如在公司网内可能需要配置 npm 代理。"
      },
      "noSystemBrowser": {
        "title": "未检测到浏览器",
        "body": "没有找到 Chrome 或 Edge。请先安装一个。",
        "linkLabel": "下载 Chrome",
        "linkHref": "https://www.google.com/chrome/"
      },
      "nodeMissing": {
        "title": "Node.js 未安装",
        "body": "Playwright 依赖 Node.js。请先完成 Node.js 步骤，或点击 Retry 重新全量安装。"
      },
      "versionMismatch": {
        "title": "版本不匹配",
        "body": "已安装的版本与要求不符。请用 --force 选项重装。"
      },
      "unknown": {
        "title": "安装失败",
        "body": "请查看完整日志以获取详细信息。"
      }
    },
    "agentVisibility": {
      "toggleLabel": "Agent 可以使用",
      "tooltipEnabled": "关闭后 Agent 不会把 browser 工具列入可用工具。已装好的 Playwright 保留。",
      "tooltipDisabledNotInstalled": "先完成安装",
      "tooltipReloading": "正在应用更改…"
    },
    "agentVisibleStatus": {
      "yes": "Agent 可见",
      "yesDetail": "设备在线，browser 已启用",
      "noNotInstalled": "Agent 不可见（未安装）",
      "noDisabled": "Agent 不可见（已关闭）",
      "noOffline": "Agent 不可见（设备离线）"
    },
    "logDrawer": {
      "expand": "查看日志",
      "collapse": "收起日志",
      "empty": "暂无日志",
      "openFile": "打开日志文件",
      "lineCount": "{{count}} 行"
    },
    "banner": {
      "rollbackApplied": "已回滚到上次配置。你的更改未生效。",
      "noRollbackCritical": "Daemon 未运行，请重启应用。"
    },
    "errors": {
      "installFailed": "安装失败",
      "reloadFailed": "Daemon 重启失败",
      "operationInProgress": "操作进行中，请等待当前任务完成",
      "installGateEnableBlocked": "先完成安装再启用"
    }
  }
}
```

Remove (or demote to unused) the `comingSoon` badge usage in RuntimeCard.

### 6.7 `OverviewTab` + `MyDevicesTab` coupling (optional polish)

If these tabs display device-level capability summaries (e.g. "Browser: on"), they read the same `browser_status()` command — keeping UI consistent. This is a one-liner per tab and can ship in the same PR.

### 6.8 PR change summary (renderer portion)

| File                                                                      | Change                                   |
| ------------------------------------------------------------------------- | ---------------------------------------- |
| `apps/client/src/components/layout/contents/devices/BrowserConfigTab.tsx` | Rewrite `RuntimeCard` subcomponent.      |
| `apps/client/src/hooks/useBrowserRuntime.ts` (NEW)                        | Hook + reducer.                          |
| `apps/client/src/i18n/locales/zh-CN/ahand.json`, `.../en-US/ahand.json`   | New keys.                                |
| `apps/client/src/components/layout/contents/devices/OverviewTab.tsx`      | Optional — coupling to `browser_status`. |
| Tests                                                                     | See §7.3.                                |

**Estimated renderer size:** ~400-500 LoC incl. new hook + tests.

---

## 7 · Error handling

### 7.1 Three severity tiers

| Tier                    | Origin                                                       | Impact                         | UX response                                                                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Install-step error**  | `browser_setup` child process (npm / download / permissions) | Local to one step              | Step row turns red + `[帮助 ↗]` popover + top-level `[Retry]`. No reload. Successful preceding steps keep their checkmarks (not re-run on retry unless `force=true`).                            |
| **Tauri-backend error** | `Config::load` / `save` / file permission / poisoned mutex   | Blocks the operation           | Red toast + log drawer auto-expands with error detail. Button returns to `Retry`.                                                                                                                |
| **Reload error**        | `DaemonHandle::shutdown` timeout or `ahandd::spawn` failure  | Heavy — daemon state uncertain | Install itself stays marked successful (Playwright installed, config written). Agent-visibility panel shows a red banner with recovery instructions per `ReloadFailureKind`. No automatic retry. |

### 7.2 Error-code → UX mapping

The classification done in aHand (§4.3) maps to the renderer help popovers (§6.4). Summary:

| Scenario                                                 | Detection                                                                             | UX                                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Network down / slow                                      | `ErrorCode::Network`                                                                  | Step red + popover with check-network / proxy-config guidance.            |
| No system browser                                        | `ErrorCode::NoSystemBrowser`                                                          | Step red + external-link button to Chrome download.                       |
| `npm install` needs sudo                                 | `ErrorCode::PermissionDenied`                                                         | Step red + copy-to-clipboard `sudo chown …` command.                      |
| Node installed but npm reports version mismatch          | `ErrorCode::VersionMismatch`                                                          | Step red + "Retry with --force" button (wired to `install(force: true)`). |
| `config.toml` unwritable (e.g. external lock on Windows) | `Config::save` returns `Err` — mapped to `ErrorCode::PermissionDenied` at Tauri layer | Red toast + log drawer shows file path + errno.                           |
| `ahandd` shutdown timed out                              | `ReloadError::ShutdownTimeout`                                                        | Banner red + "daemon 重启超时，请重启应用". No force-kill.                |
| New `spawn` fails, rollback succeeds                     | `ReloadError::SpawnFailedRolledBack`                                                  | Banner yellow + "已回滚到上次配置".                                       |
| New `spawn` fails, rollback also fails                   | `ReloadError::SpawnFailedNoRollback`                                                  | Banner red + "Daemon 未运行，请重启应用".                                 |

### 7.3 Reload rollback (recap of §5.2)

The rollback path is load-bearing for the UX contract — a failed respawn must not leave the user with a dead daemon. §5.2 has the algorithm; repeating the invariants here for spec completeness:

- `rollback_config` is held in memory only (never persisted).
- If primary spawn fails, we try rollback spawn; both success/failure paths surface distinct `ReloadFailureKind`.
- In the `SpawnFailedNoRollback` case, `AhandRuntime::handle` is left in a placeholder/closed state; subsequent commands return `"daemon_offline"` until the app is restarted.

### 7.4 Concurrency gate

`AhandRuntime` is wrapped in `tokio::sync::Mutex`. The three Tauri commands acquire the lock:

- **First caller wins;** the lock is held for the full operation.
- **Subsequent callers fast-fail** with i18n key `browser.errors.operationInProgress` — they do NOT queue (a queue would encourage double-clicks from impatient users).
- The renderer also guards against double-click via FSM state (`installing` / `reloading` both disable the button), so the backend lock is defense-in-depth.

### 7.5 Log tee

Every `StepLog` line (stdout / stderr / info) is written to both the streaming channel AND a timestamped log file under `~/.ahand/logs/browser-setup-{timestamp}.log`. See §5.4. The UI's "open log file" button maps to `browser_open_last_log` which uses `tauri-plugin-opener`.

Log rotation: on each install, prune files older than 7 days. Not configurable in this spec.

---

## 8 · Testing strategy

Four layers. aHand and team9 tested separately; manual E2E only after both merge.

### 8.1 aHand — `browser_setup` progress API

**Unit tests** (mock child processes):

```rust
#[tokio::test]
async fn run_all_emits_step_lifecycle_events();

#[tokio::test]
async fn run_all_emits_stdout_and_stderr_logs();

#[tokio::test]
async fn run_all_halts_on_step_failure();
// After one step's Failed event, later steps should NOT emit Started.

#[tokio::test]
async fn run_all_maps_permission_denied_to_error_code();

#[tokio::test]
async fn run_all_maps_network_error_to_error_code();

#[tokio::test]
async fn run_all_maps_no_system_browser_to_error_code();

#[tokio::test]
async fn run_step_single_runs_only_that_step();

#[tokio::test]
async fn run_all_without_callback_still_works();
// Backwards compatibility — None::<fn(_)> path.

#[tokio::test]
async fn config_set_browser_enabled_roundtrip();
// Write config.toml, flip true, reload, assert; flip false, reload, assert;
// assert other [hub], [openclaw] sections untouched.

#[tokio::test]
async fn config_set_browser_enabled_atomic();
// Simulate a crash mid-write: assert config.toml either holds old or new,
// never partial content.
```

**Integration tests** (`#[ignore]`, opt-in via `cargo test --ignored`; require npm + network):

```rust
#[tokio::test]
#[ignore]
async fn run_all_happy_path_real_npm();
// Requires internet. Validates that piped stdout lines reach the callback.
```

### 8.2 team9 Tauri backend — commands + reload

Mock `ahandd::browser_setup` and `ahandd::spawn` via a trait-object injection point in `AhandRuntime` (behind `#[cfg(test)]`). Alternatively, introduce a `trait BrowserSetupAdapter` with a prod impl that defers to `ahandd::browser_setup::run_all` and a test impl that emits scripted progress events.

**Command tests:**

```rust
#[tokio::test]
async fn browser_install_streams_events_to_channel();
// Mock emits StepStarted(node), StepFinished(node, Ok), AllFinished(Ok);
// assert 3 events received by the test channel in order.

#[tokio::test]
async fn browser_install_success_writes_enabled_and_reloads();
// Post-call: config.toml has [browser].enabled=true; channel received
// ReloadStarted then ReloadOnline.

#[tokio::test]
async fn browser_install_failure_does_not_touch_config();
// Mock fails at step 2; config.toml unchanged; no reload attempted;
// channel has StepFinished(Failed) + AllFinished(Failed), no ReloadStarted.

#[tokio::test]
async fn browser_status_reports_enabled_and_visible();
// Mock inspect_all all Ok; daemon status Online; enabled=true;
// expect agent_visible=true.

#[tokio::test]
async fn browser_status_reports_not_visible_when_offline();
// Mock inspect_all all Ok; daemon status Offline;
// expect agent_visible=false despite enabled=true.

#[tokio::test]
async fn browser_set_enabled_true_when_not_installed_errors();
// Mock inspect_all has node Failed; invoke set_enabled(true);
// expect Err("browser_not_installed").

#[tokio::test]
async fn browser_set_enabled_no_op_when_already_enabled();
// Config already [browser].enabled=true; invoke set_enabled(true);
// assert reload NOT performed.

#[tokio::test]
async fn concurrent_install_rejected();
// Start install (mock hangs); invoke browser_set_enabled concurrently;
// second call returns Err("operationInProgress") immediately.
```

**Reload tests:**

```rust
#[tokio::test]
async fn reload_happy_path();
// Old shutdown Ok; new spawn Ok; status transitions to Online within grace;
// ReloadEvent::Started then Online emitted.

#[tokio::test]
async fn reload_rollback_on_spawn_failure();
// Old shutdown Ok; new spawn fails; rollback spawn Ok;
// returns SpawnFailedRolledBack; runtime still has working handle.

#[tokio::test]
async fn reload_fails_hard_when_rollback_fails();
// Both spawns fail; returns SpawnFailedNoRollback; runtime Offline.

#[tokio::test]
async fn reload_shutdown_timeout_forces_drop();
// Old shutdown hangs past 5s; assert timeout error; new spawn still attempted.
```

### 8.3 Renderer — React components & hook

Vitest + React Testing Library. `invoke` and `Channel` mocked.

**Component tests:**

```ts
it("renders NotInstalled state when all steps are NotRun", () => {
  render(<BrowserConfigTab />, { status: mockStatus({ overall: "notRun" }) });
  expect(screen.getByText(/未安装/)).toBeVisible();
  expect(screen.getByRole("button", { name: /安装/ })).toBeEnabled();
  expect(screen.getByRole("switch")).toBeDisabled();
});

it("renders partial success when systemBrowser failed", () => {
  render(<BrowserConfigTab />, {
    status: mockStatus({ steps: { node: "ok", playwright: "ok", systemBrowser: "failed" } }),
  });
  expect(screen.getByRole("button", { name: /重试/ })).toBeEnabled();
  // Help icon visible on systemBrowser row only.
});

it("appends step log lines as they arrive", async () => {
  // Fake Channel emits StepLog events with stdout/stderr/info streams;
  // assert all three lines with distinct icons.
});

it("agent-visible status reflects enabled + online matrix", () => {
  // Matrix: (enabled, online) → expected status label.
});

it("disables agent-visible toggle during reloading state", async () => {
  // Trigger install; receive ReloadStarted — switch disabled;
  // receive ReloadOnline — switch enabled.
});

it("shows rollback banner after SpawnFailedRolledBack", () => {
  render(<BrowserConfigTab />, { lastReloadError: "SpawnFailedRolledBack" });
  expect(screen.getByText(/已回滚到上次配置/)).toBeVisible();
});

it("error popover content matches error code", async () => {
  // StepFinished with errorCode=PermissionDenied;
  // click help icon; popover shows chown command + copy button.
});

it("hides Install button when all steps Ok", () => {
  // Coming-Soon removed; button hidden when overall=Ok.
});
```

**`useBrowserRuntime` hook tests:**

```ts
it("applyProgress merges StepStarted/Log/Finished correctly", () => {
  // Pure reducer — feed event sequence, assert state transitions.
});

it("refresh is called after install completes", async () => {
  // Mock invoke resolves after N events; assert browser_status invoked once after.
});

it("enable-toggle does not emit step events", async () => {
  // Mock channel receives only ReloadStarted + ReloadOnline (no StepStarted).
});
```

### 8.4 Manual E2E (smoke checklist)

Run after both PRs merge. Not automated.

- [ ] Fresh dev env (no `~/.ahand/node`): click Install → see all steps turn green → log drawer shows live output → after install, Agent-visible toggle flips to ON automatically → no user action needed.
- [ ] Already-installed env: Install button hidden; toggle Enable off → daemon reconnects → next agent turn sees no browser tool. Toggle on → agent sees browser tool again.
- [ ] Disconnect network → click Install → Network step fails → popover offers proxy-config guidance.
- [ ] Uninstall Chrome → click Install → system-browser step fails → Chrome-download button works.
- [ ] Install succeeds → in another agent chat, ask "帮我截图 google.com" → agent invokes browser tool, returns screenshot.
- [ ] Toggle Enable off → agent chat: "帮我访问 …" → agent responds "I don't have a browser tool" (browser tool disappears from its tool list).
- [ ] `chmod 444 ~/.ahand/config.toml` → click Enable toggle → error toast + log drawer shows path + errno.
- [ ] Double-click Install → second click returns "operation in progress" error; first install continues.
- [ ] Kill `ahandd` tokio task externally (force drop handle) → runtime reports Offline → Install button still works (inspect_all doesn't require online daemon).

### 8.5 CI integration

- aHand PR: `cargo test -p ahandd` (default, fast tests); ignored integration tests opt-in.
- team9 backend: `cargo test --manifest-path apps/client/src-tauri/Cargo.toml` (existing workflow).
- team9 renderer: `pnpm --filter client test` (existing Vitest).

All three run in their respective repos' existing CI — no new workflow files needed.

---

## 9 · Build sequence & cross-repo coordination

### 9.1 Order

**Phase A — aHand PR first** (branch `feat/browser-setup-progress-api`):

1. Extend `types.rs`: add `LogStream`, `ErrorCode`; add `Phase::Log`; add `stream` to `ProgressEvent`; add `CheckStatus::Failed { code, message }`.
2. Add `classify_error()` + `FailedStepReport` newtype in `browser_setup/mod.rs`; wrap `ensure()` calls in `run_all` / `run_step` to produce structured failures.
3. Piped I/O in `playwright.rs` / `node.rs` — emit `Phase::Log` events line-by-line.
4. `Config::set_browser_enabled` with atomic write (config.toml.tmp + rename).
5. `ahandctl` call-site: no signature change required; optionally pretty-print `Phase::Log` lines.
6. All unit tests from §8.1.
7. Merge to `dev`; note merge SHA.

**Phase B — team9 PR bumps `rev` + implements UI** (branch `feat/browser-runtime-install-ui`):

1. Bump `apps/client/src-tauri/Cargo.toml` `ahandd = { git = ..., rev = "<PHASE_A_SHA>" }`.
2. Implement `browser_runtime.rs` (3 commands + log-file writer + error-classification passthrough).
3. Add `AhandRuntime::reload()` with rollback (§5.2).
4. Register commands in `src-tauri/src/lib.rs`.
5. New `install_log.rs` module.
6. Renderer: `useBrowserRuntime` hook + `BrowserConfigTab.tsx` rewrite.
7. i18n keys added (zh-CN + en-US).
8. Tests from §8.2 + §8.3.
9. Merge to `dev`.

**Phase C — Manual E2E** (from §8.4). Run on Tauri dev build once both PRs merge.

### 9.2 Parallel development option

Technically possible — team9 can use a `path = "../../aHand/crates/ahandd"` override locally during development, then switch to `rev = "..."` once the aHand PR merges. I recommend **not doing this** because:

- §4 is small (~250-350 LoC); review likely one day.
- Parallel-dev risks rework if aHand reviewer requests API changes.
- The serial path has clean fallback points.

### 9.3 Rollback

Either PR can be reverted independently:

- aHand PR revert → team9 rolls back its `rev` one commit. Install UI stays disabled until a new aHand version surfaces.
- team9 PR revert → UI reverts to "Coming Soon"; ahandd library additions remain inert (nobody calls the new APIs).

Caveat: if aHand gets subsequent commits after the browser-setup PR, reverting cleanly becomes harder. This is standard git hygiene — team9 should follow up quickly after the aHand PR merges.

### 9.4 Deploy impact

| Service                                 | Changes                                                                      | Redeploy needed?             |
| --------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------- |
| `team9-agent-pi` (claw-hive)            | None                                                                         | No                           |
| team9 gateway / im-worker / task-worker | None                                                                         | No                           |
| aHand hub                               | None (protocol unchanged, webhook payload unchanged, browser tool unchanged) | No                           |
| team9 Tauri desktop app                 | All UI + backend changes                                                     | **Yes — new .dmg release**   |
| ahandd daemon (embedded in Tauri)       | API additions                                                                | Yes (bundled into Tauri app) |

Only the team9 Tauri app needs re-packaging + release. No server-side rollout.

---

## 10 · Open questions

None at spec time — all major decisions were made during brainstorming (see meta-section below). Minor implementation choices (exact timeout values, popover styling specifics, log rotation frequency beyond "7 days") will be resolved during implementation planning.

---

## 11 · Meta — decisions made during brainstorming

Captured here for future readers who want to know why the spec looks like this:

1. **Availability detection granularity (§6):** Per-step (Node / Playwright / SystemBrowser), not just overall. Rationale: actionable diagnostics when something fails.
2. **Install mechanism (§4-5):** Function call into embedded `ahandd` library — NOT IPC, NOT subprocess. Rationale: Tauri already embeds `ahandd` as a Cargo dependency; IPC/subprocess would have been a wrong turn (discovered mid-design).
3. **Enable-after-install (§5.3.2):** Automatic — install success → config flip → runtime reload. Rationale: aligns with user intent ("install = I want to use it").
4. **Status data source (§5.3.1):** Entirely local ahandd + in-memory daemon status. Rationale: single source of truth; no network dependency for a local operation.
5. **Failure self-help scope (§6.4, §7.2):** Per-step, with copy-command and external-link primitives. Rationale: user should never need to Google the error message.
6. **Enable/disable vs uninstall (§5.3.3):** Enable/disable supported; uninstall deliberately not supported. Rationale: YAGNI — playwright-cli is small, leaving it installed is cheap; a simple toggle covers 95% of use cases.

---
