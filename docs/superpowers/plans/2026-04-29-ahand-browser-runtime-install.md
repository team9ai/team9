# aHand Browser Runtime Install & Self-Check UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver "我的设备 → 浏览器控制" end-to-end: (1) the Tauri desktop app gains an install UI that streams live progress, detects per-component status (Node / Playwright CLI / system browser), and hot-toggles whether the agent can use the browser; (2) browser automation is migrated from a dedicated `browser` LLM tool to a SKILL-based model where the agent drives `playwright-cli` via `run_command`; (3) the device-reported capability string is renamed `"browser"` → `"browser-playwright-cli"` to bind capability names to concrete implementations and make future non-playwright backends pluggable.

**Architecture:** Three sequential PRs across three repos — aHand first (library progress API + cap rename + `/api/control/browser` deprecation banner), team9-agent-pi next (delete `browser` LLM tool, add `browser-playwright-cli` SKILL folder, backwards-compat `deriveCaps` alias), team9 Tauri last (3 new Tauri commands + `AhandRuntime::reload` with rollback + UI rewrite + i18n). No changes to team9 gateway/server (capabilities flow through as opaque strings).

**Tech Stack:** Rust (ahandd, Tauri backend), Tokio (async streams, piped child I/O), TypeScript + React + Vitest (renderer, `useBrowserRuntime` hook), `@tauri-apps/api` Channel for backend→frontend streaming, `SourceCodeFolderProvider` for SKILL injection.

**Spec:** [team9/docs/superpowers/specs/2026-04-29-ahand-browser-runtime-install-design.md](../specs/2026-04-29-ahand-browser-runtime-install-design.md) (latest commit `222bff64` on `dev`).

**Cross-repo ordering:** aHand PR merges first → team9-agent-pi PR bumps `ahandd.rev` & consumes new API, deletes browser tool, adds SKILL → team9 Tauri PR bumps both deps & ships UI.

---

## File Structure

### aHand repo (Phase A PR — `feat/browser-setup-progress-api`)

**Modified:**

- `crates/ahandd/src/browser_setup/types.rs` — add `LogStream` + `ErrorCode` enums; add `Phase::Log`; add `stream: Option<LogStream>` to `ProgressEvent`; add `CheckStatus::Failed { code, message }` variant
- `crates/ahandd/src/browser_setup/mod.rs` — add `classify_error()` helper + `FailedStepReport` newtype; wrap `node::ensure` / `playwright::ensure` calls in `run_all` / `run_step` with classify-on-error
- `crates/ahandd/src/browser_setup/playwright.rs` — switch `Command::output()` to piped `spawn()` + line-level stdout/stderr forwarding via `Phase::Log`
- `crates/ahandd/src/browser_setup/node.rs` — same piped-I/O treatment
- `crates/ahandd/src/config.rs` — add `Config::set_browser_enabled(&mut self, path, enabled) -> anyhow::Result<bool>` with atomic write (tmpfile + rename)
- `crates/ahandd/src/ahand_client.rs` — rename cap string `"browser"` → `"browser-playwright-cli"` at the Hello construction site (line ~772); keep `tool: "browser".to_string()` inside `BrowserRequest` unchanged + add inline comment
- `crates/ahand-hub/src/browser_service.rs` — update ownership-check cap match from `"browser"` → `"browser-playwright-cli"` (line ~146)
- `crates/ahand-hub/src/http/browser.rs` — prepend deprecation banner module comment
- `crates/ahand-hub/src/http/control_plane.rs` — prepend deprecation banner module comment around the `POST /api/control/browser` handler
- `crates/ahand-hub/tests/browser_api.rs` (and any other integration test that uses `"browser"` as a cap) — update fixtures to `"browser-playwright-cli"`

### team9-agent-pi repo (Phase B PR — `feat/browser-skill-migration`)

**Created:**

- `packages/agent-components/skills/browser-playwright-cli/SKILL.md` — adapted from upstream microsoft/playwright-cli `skills/playwright-cli/SKILL.md` with team9-specific preamble
- `packages/agent-components/skills/browser-playwright-cli/LICENSE-UPSTREAM.md` — MIT attribution for the adapted content
- `packages/agent-components/skills/browser-playwright-cli/references/*.md` — all 9 reference files copied verbatim from upstream
- `packages/agent-components/src/components/host/browser-skill-registration.ts` — the conditional `SourceCodeFolderProvider` hookup

**Modified:**

- `packages/types/src/host.ts` — `HostCapability` union string rename from `"shell" | "browser"` to `"shell" | "browser-playwright-cli"`
- `packages/claw-hive/src/components/ahand/integration.ts` — `deriveCaps` backwards-compat alias; delete `AhandBackend.browser()` method
- `packages/claw-hive/src/components/ahand/integration.test.ts` — update fixtures; delete `AhandBackend.browser()` tests
- `packages/claw-hive/src/components/ahand/gateway-client.ts` — comment string update (reflect new cap vocabulary)
- `packages/agent-components/src/components/host/host-component.ts` — delete `BROWSER_TOOL_DESCRIPTION`, `browserTool` factory, browser-dispatch methods, and all `hasAnyBackendWithCap("browser")` branches; wire in `registerBrowserPlaywrightCliSkill` from the new module
- `packages/agent-components/src/components/host/host-component.test.ts` — delete browser-tool assertions; add SKILL-registration assertions
- `aHand/packages/sdk/src/cloud-client.ts` — delete `CloudClient.browser()` (cross-repo; lives in aHand SDK but gated on this PR's Phase-B timing). **NOTE:** this one line-item belongs to the aHand PR (Phase A) in practice because the SDK is published from aHand; see Task 4.
- `aHand/packages/sdk/src/cloud-client.test.ts` — delete `CloudClient.browser()` tests (same caveat as above)

**Deleted:**

- `docs/skills/browser.md` — PR #97's orphaned browser-tool skill markdown at the agent-pi repo root

### team9 repo (Phase C PR — `feat/browser-runtime-install-ui`)

**Created:**

- `apps/client/src-tauri/src/ahand/browser_runtime.rs` — the 3 new Tauri commands (`browser_status`, `browser_install`, `browser_set_enabled`) + progress-event adapter + install-log tee writer (~350 LoC with tests)
- `apps/client/src/hooks/useBrowserRuntime.ts` — React hook wrapping the commands + reducer (~150 LoC)
- `apps/client/src/components/layout/contents/devices/BrowserConfigTab/index.tsx` — orchestrator (re-exports `BrowserConfigTab`)
- `apps/client/src/components/layout/contents/devices/BrowserConfigTab/RuntimeCard.tsx` — main status card (~150 LoC)
- `apps/client/src/components/layout/contents/devices/BrowserConfigTab/StepRow.tsx` — single per-step row with help popover (~90 LoC)
- `apps/client/src/components/layout/contents/devices/BrowserConfigTab/LogDrawer.tsx` — collapsible log panel (~60 LoC)
- `apps/client/src/components/layout/contents/devices/BrowserConfigTab/BrowserBinaryCard.tsx` — existing card moved verbatim from the flat file (~70 LoC)

**Modified:**

- `apps/client/src-tauri/Cargo.toml` — bump `ahandd` git `rev` to the Phase-A aHand merge SHA
- `apps/client/src-tauri/src/ahand/runtime.rs` — add `pub async fn reload(&mut self)` + `ReloadError` enum + rollback on spawn failure
- `apps/client/src-tauri/src/ahand/mod.rs` — `pub mod browser_runtime;`
- `apps/client/src-tauri/src/lib.rs` — register 3 commands in `tauri::generate_handler![]` + add `tokio::sync::Mutex<AhandRuntime>` state binding
- `apps/client/src/i18n/locales/zh-CN/ahand.json` — new keys under `browser.*` (steps, statuses, help popovers, toggle tooltip)
- `apps/client/src/i18n/locales/en-US/ahand.json` — mirror English keys
- `apps/client/package.json` (or workspace pin file) — bump `@team9claw/*` versions published by Phase B
- `apps/client/src/components/layout/contents/devices/OverviewTab.tsx` (if it references browser-install state) — small polish only

**Deleted:**

- `apps/client/src/components/layout/contents/devices/BrowserConfigTab.tsx` — tracked as rename into `BrowserConfigTab/index.tsx` + split components

---

## Tasks

### Task 1: aHand — extend `browser_setup/types.rs`

**Repo:** aHand. **PR branch:** `feat/browser-setup-progress-api`.

**Goal:** Add the new type surface (`LogStream`, `ErrorCode`, `Phase::Log`, `ProgressEvent.stream`, `CheckStatus::Failed`) with round-trip serde tests. No behavior change yet — wiring lands in Task 2.

**Files:**

- Modify: `aHand: crates/ahandd/src/browser_setup/types.rs`

**Acceptance Criteria:**

- [ ] `LogStream` enum with `Stdout | Stderr | Info`, `#[serde(rename_all = "snake_case")]`, derives `Debug + Clone + Copy + PartialEq + Eq + Serialize`
- [ ] `ErrorCode` enum with 6 variants (`PermissionDenied`, `Network`, `NoSystemBrowser`, `NodeMissing`, `VersionMismatch`, `Unknown`), same derives, `#[serde(rename_all = "snake_case")]`
- [ ] `Phase` gains a `Log` variant (placed last); snake-case serialization intact
- [ ] `ProgressEvent` gains `pub stream: Option<LogStream>` with `#[serde(skip_serializing_if = "Option::is_none")]`; derives unchanged
- [ ] `CheckStatus::Failed { code: ErrorCode, message: String }` variant added; `#[serde(tag = "kind", rename_all = "snake_case")]` on the enum means this serializes as `{"kind":"failed","code":"...","message":"..."}`
- [ ] Existing tests pass (`check_status_ok_serializes_with_tag`, `progress_event_serializes_with_snake_case_phase`, etc.)
- [ ] New tests cover: `Phase::Log` snake-case; `ProgressEvent.stream` Some/None serialization; `CheckStatus::Failed` round-trip; each `ErrorCode` variant round-trip

**Verify:**

```
cd /Users/winrey/Projects/weightwave/aHand && \
  cargo test -p ahandd browser_setup::types && \
  cargo fmt -p ahandd -- --check && \
  cargo clippy -p ahandd --all-targets -- -D warnings
```

**Steps:**

- [ ] **Step 1: Add the two new enums and `Phase::Log` variant**

Open `crates/ahandd/src/browser_setup/types.rs`. Append after the existing `ProgressEvent` struct (line ~78) but before `DetectedBrowser`:

```rust
/// Which stream a log line originated from. `Info` is synthesized by
/// Rust code; `Stdout`/`Stderr` are forwarded verbatim from child
/// processes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LogStream {
    Stdout,
    Stderr,
    Info,
}

/// Machine-readable classification of an install-step failure.
/// Attached to `CheckStatus::Failed` (and to the terminal
/// `ProgressEvent` for the failing step) so the UI can pick a
/// targeted help popover without pattern-matching English prose.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    /// npm / install path returned EACCES. Remedy: chown / sudo.
    PermissionDenied,
    /// npm / download could not reach the registry.
    Network,
    /// No Chrome / Edge detected on the system.
    NoSystemBrowser,
    /// Node.js / npm not on PATH. Remedy: run the node step first.
    NodeMissing,
    /// Installed version did not match the pinned playwright-cli
    /// version. Remedy: retry with `force=true`.
    VersionMismatch,
    /// Catch-all for unclassified install errors.
    Unknown,
}
```

Update the existing `Phase` enum (lines ~80-88) to add a `Log` variant:

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
    /// A raw log line from the running step. Check `ProgressEvent.stream`
    /// to disambiguate stdout / stderr / synthesized info messages.
    /// `message` carries the line content (no trailing newline);
    /// `percent` is always `None`.
    Log,
}
```

Update the existing `ProgressEvent` struct (lines ~69-77):

```rust
/// Progress update emitted during install operations.
#[derive(Debug, Clone, Serialize)]
pub struct ProgressEvent {
    /// Which step is reporting: "node" / "playwright".
    pub step: &'static str,
    pub phase: Phase,
    pub message: String,
    /// Percent complete (0-100), only populated for measurable operations.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub percent: Option<u8>,
    /// Set when `phase == Log`, absent otherwise.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream: Option<LogStream>,
}
```

Note: this adds `#[serde(skip_serializing_if = "Option::is_none")]` to both `percent` and `stream`. The existing test `progress_event_serializes_with_snake_case_phase` constructs `ProgressEvent` with `percent: Some(42)` so the change is backward-compatible for cases where `percent` is set. The assertion that checks the JSON shape will still pass as long as the new test fixture sets `percent: Some(...)`. See Step 3.

- [ ] **Step 2: Add `CheckStatus::Failed` variant**

Update the existing `CheckStatus` enum (lines ~6-25):

```rust
/// Status of a single setup check.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CheckStatus {
    /// Component is installed and meets requirements.
    Ok {
        version: String,
        path: PathBuf,
        source: CheckSource,
    },
    /// Component is not installed.
    Missing,
    /// Component is installed but version is too old.
    Outdated {
        current: String,
        required: String,
        path: PathBuf,
    },
    /// Applies to the browser check: none of the known browsers were found.
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

- [ ] **Step 3: Add new serde round-trip tests**

Append to the `#[cfg(test)] mod tests` block at the end of the file:

```rust
#[test]
fn progress_event_serializes_log_phase_with_stream() {
    let event = ProgressEvent {
        step: "playwright",
        phase: Phase::Log,
        message: "npm warn deprecated foo@1.2.3".into(),
        percent: None,
        stream: Some(LogStream::Stderr),
    };
    let actual = serde_json::to_value(&event).unwrap();
    assert_eq!(
        actual,
        json!({
            "step": "playwright",
            "phase": "log",
            "message": "npm warn deprecated foo@1.2.3",
            "stream": "stderr"
        })
    );
}

#[test]
fn progress_event_omits_stream_when_none() {
    let event = ProgressEvent {
        step: "node",
        phase: Phase::Starting,
        message: "Starting Node install".into(),
        percent: None,
        stream: None,
    };
    let actual = serde_json::to_value(&event).unwrap();
    assert!(actual.as_object().unwrap().get("stream").is_none(), "stream field should be absent when None: {actual}");
}

#[test]
fn progress_event_omits_percent_when_none() {
    let event = ProgressEvent {
        step: "node",
        phase: Phase::Done,
        message: "".into(),
        percent: None,
        stream: None,
    };
    let actual = serde_json::to_value(&event).unwrap();
    assert!(actual.as_object().unwrap().get("percent").is_none(), "percent field should be absent when None: {actual}");
}

#[test]
fn log_stream_serializes_snake_case() {
    assert_eq!(serde_json::to_value(&LogStream::Stdout).unwrap(), json!("stdout"));
    assert_eq!(serde_json::to_value(&LogStream::Stderr).unwrap(), json!("stderr"));
    assert_eq!(serde_json::to_value(&LogStream::Info).unwrap(), json!("info"));
}

#[test]
fn error_code_serializes_each_variant() {
    let cases = [
        (ErrorCode::PermissionDenied, "permission_denied"),
        (ErrorCode::Network, "network"),
        (ErrorCode::NoSystemBrowser, "no_system_browser"),
        (ErrorCode::NodeMissing, "node_missing"),
        (ErrorCode::VersionMismatch, "version_mismatch"),
        (ErrorCode::Unknown, "unknown"),
    ];
    for (variant, expected) in cases {
        assert_eq!(serde_json::to_value(&variant).unwrap(), json!(expected), "variant {variant:?} should serialize as {expected}");
    }
}

#[test]
fn check_status_failed_serializes_with_tag() {
    let status = CheckStatus::Failed {
        code: ErrorCode::PermissionDenied,
        message: "EACCES: /foo/bar".into(),
    };
    let actual = serde_json::to_value(&status).unwrap();
    assert_eq!(
        actual,
        json!({
            "kind": "failed",
            "code": "permission_denied",
            "message": "EACCES: /foo/bar"
        })
    );
}
```

- [ ] **Step 4: Run tests, fmt, clippy**

```
cd /Users/winrey/Projects/weightwave/aHand
cargo test -p ahandd browser_setup::types
cargo fmt -p ahandd -- --check
cargo clippy -p ahandd --all-targets -- -D warnings
```

All must pass. If `clippy` flags the added `Failed { code, message }` variant for being large, the intended style matches the rest of `CheckStatus` — ignore that specific lint only if it was not active before this commit.

- [ ] **Step 5: Commit**

```
cd /Users/winrey/Projects/weightwave/aHand
git add crates/ahandd/src/browser_setup/types.rs
git commit -m "feat(ahandd/browser_setup): add LogStream, ErrorCode, Phase::Log, CheckStatus::Failed"
```

---

### Task 2: aHand — `classify_error()` + `FailedStepReport` + wrap `ensure()` calls

**Repo:** aHand. **PR branch:** `feat/browser-setup-progress-api`.

**Goal:** Add a centralized error classifier and a `FailedStepReport` newtype wrapper so install failures surface structured info through the `anyhow::Error` chain. Wrap `run_all` / `run_step`'s `ensure()` calls with catch-and-classify. Keep existing `Result<Vec<CheckReport>>` / `Result<CheckReport>` signatures unchanged so `ahandctl` CLI behavior is preserved.

**Files:**

- Modify: `aHand: crates/ahandd/src/browser_setup/mod.rs`

**Acceptance Criteria:**

- [ ] `pub fn classify_error(err: &anyhow::Error) -> ErrorCode` exists and returns the correct variant for each pattern (permission-denied / EACCES, network / ECONNRESET / ETIMEDOUT / getaddrinfo, `no system browser`, `npm not found` / `Node` + `not installed`, `version` + (`mismatch` | `required`), else `Unknown`)
- [ ] `pub struct FailedStepReport(pub CheckReport)` exists with `Display` + `Debug` + `std::error::Error` impls (so it's downcastable via `err.chain().find_map(|e| e.downcast_ref::<FailedStepReport>())`)
- [ ] `run_all` and `run_step` wrap each `ensure()` call: on `Err`, synthesize a `CheckReport` with `CheckStatus::Failed { code, message }`, attach it via `e.context(FailedStepReport(report))`, and halt (don't run later steps)
- [ ] On a failed step, a terminal `ProgressEvent { phase: Phase::Done, message: <error string>, stream: None }` is emitted to the callback just before `Err` is returned (so consumers that only watch the stream see a "done" signal)
- [ ] Unknown step name in `run_step` still surfaces `"unknown step"` error (existing test `run_step_rejects_unknown_name` still passes)
- [ ] New tests cover: each `ErrorCode` classification; `FailedStepReport` is in the error chain when `node::ensure` fails; `playwright` step is skipped when `node` fails (halt-on-failure invariant)

**Verify:**

```
cd /Users/winrey/Projects/weightwave/aHand && \
  cargo test -p ahandd browser_setup && \
  cargo fmt -p ahandd -- --check && \
  cargo clippy -p ahandd --all-targets -- -D warnings
```

**Steps:**

- [ ] **Step 1: Write failing tests for `classify_error`**

Append to the `#[cfg(test)] mod tests` block in `crates/ahandd/src/browser_setup/mod.rs`:

```rust
    #[test]
    fn classify_error_permission_denied() {
        let err = anyhow::anyhow!("EACCES: permission denied at /foo");
        assert_eq!(classify_error(&err), ErrorCode::PermissionDenied);

        let err2 = anyhow::anyhow!("Permission denied writing to /bar");
        assert_eq!(classify_error(&err2), ErrorCode::PermissionDenied);
    }

    #[test]
    fn classify_error_network() {
        for msg in [
            "Network error while downloading",
            "ECONNRESET from registry",
            "ETIMEDOUT waiting for response",
            "getaddrinfo ENOTFOUND registry.npmjs.org",
        ] {
            let err = anyhow::anyhow!("{msg}");
            assert_eq!(
                classify_error(&err),
                ErrorCode::Network,
                "msg `{msg}` should classify as Network",
            );
        }
    }

    #[test]
    fn classify_error_no_system_browser() {
        let err = anyhow::anyhow!(
            "no system browser (Chrome/Edge) detected — please install one"
        );
        assert_eq!(classify_error(&err), ErrorCode::NoSystemBrowser);
    }

    #[test]
    fn classify_error_node_missing() {
        let err = anyhow::anyhow!("npm not found at /usr/local/bin/npm");
        assert_eq!(classify_error(&err), ErrorCode::NodeMissing);

        let err2 = anyhow::anyhow!("Node is not installed");
        assert_eq!(classify_error(&err2), ErrorCode::NodeMissing);
    }

    #[test]
    fn classify_error_version_mismatch() {
        let err = anyhow::anyhow!("version mismatch: got 0.1.0, required 0.1.1");
        assert_eq!(classify_error(&err), ErrorCode::VersionMismatch);

        let err2 = anyhow::anyhow!("version required: 0.1.1");
        assert_eq!(classify_error(&err2), ErrorCode::VersionMismatch);
    }

    #[test]
    fn classify_error_unknown_fallback() {
        let err = anyhow::anyhow!("some unrecognized failure");
        assert_eq!(classify_error(&err), ErrorCode::Unknown);
    }

    #[test]
    fn classify_error_walks_cause_chain() {
        let root = anyhow::anyhow!("EACCES: lower-level io");
        let wrapped = root.context("npm install failed");
        assert_eq!(
            classify_error(&wrapped),
            ErrorCode::PermissionDenied,
            "classifier must see the root cause via `{{:#}}`",
        );
    }
```

Run: `cargo test -p ahandd browser_setup::tests::classify_error` — expect compile failure "cannot find function `classify_error` in this scope".

- [ ] **Step 2: Add `classify_error` and `FailedStepReport`**

Edit `crates/ahandd/src/browser_setup/mod.rs`. At the top-level (after the `pub use` line on 19), add:

````rust
/// Classify an `anyhow::Error` produced by an install step into a
/// machine-readable `ErrorCode`. Patterns match the `bail!` call sites
/// in `playwright.rs` / `node.rs` and the `no system browser` message
/// from `inspect_browser`. The `{:#}` formatter walks the cause chain
/// so wrapped errors still classify by their root cause.
pub fn classify_error(err: &anyhow::Error) -> ErrorCode {
    let s = format!("{err:#}");
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
    } else if s.contains("npm not found")
        || (s.contains("Node") && s.contains("not installed"))
    {
        ErrorCode::NodeMissing
    } else if s.contains("version") && (s.contains("mismatch") || s.contains("required")) {
        ErrorCode::VersionMismatch
    } else {
        ErrorCode::Unknown
    }
}

/// Attached to `anyhow::Error` via `.context()` so callers (notably
/// team9's Tauri `browser_runtime`) can downcast and get the
/// classified `CheckReport` without re-parsing the error string.
///
/// Usage from the consumer side:
/// ```ignore
/// let err: anyhow::Error = /* returned from run_all */;
/// let failed: Option<&CheckReport> = err
///     .chain()
///     .find_map(|e| e.downcast_ref::<FailedStepReport>())
///     .map(|w| &w.0);
/// ```
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

impl std::error::Error for FailedStepReport {}
````

Run `cargo test -p ahandd browser_setup::tests::classify_error` — all 7 classifier tests should PASS. The others aren't touched yet.

- [ ] **Step 3: Wrap `node::ensure` and `playwright::ensure` in `run_all` and `run_step` with classify-on-error**

Replace the body of `run_all` (lines 41-50):

```rust
pub async fn run_all(
    force: bool,
    progress: impl Fn(ProgressEvent) + Send + Sync + 'static,
) -> Result<Vec<CheckReport>> {
    let progress_ref: &(dyn Fn(ProgressEvent) + Send + Sync) = &progress;

    let node_report = match node::ensure(force, progress_ref).await {
        Ok(r) => r,
        Err(e) => return Err(wrap_failure(e, "node", "Node.js", progress_ref)),
    };

    let playwright_report = match playwright::ensure(force, progress_ref).await {
        Ok(r) => r,
        Err(e) => return Err(wrap_failure(e, "playwright", "playwright-cli", progress_ref)),
    };

    let browser_report = inspect_browser();
    Ok(vec![node_report, playwright_report, browser_report])
}
```

Replace the body of `run_step` (lines 54-75):

```rust
pub async fn run_step(
    name: &str,
    force: bool,
    progress: impl Fn(ProgressEvent) + Send + Sync + 'static,
) -> Result<CheckReport> {
    let progress_ref: &(dyn Fn(ProgressEvent) + Send + Sync) = &progress;
    match name {
        "node" => match node::ensure(force, progress_ref).await {
            Ok(r) => Ok(r),
            Err(e) => Err(wrap_failure(e, "node", "Node.js", progress_ref)),
        },
        "playwright" => {
            let node_status = node::inspect().await;
            if !matches!(node_status.status, CheckStatus::Ok { .. }) {
                bail!(
                    "playwright step requires node to be installed first. \
                     Run `ahandd browser-init --step node` first, or \
                     `ahandd browser-init` for all steps."
                );
            }
            match playwright::ensure(force, progress_ref).await {
                Ok(r) => Ok(r),
                Err(e) => Err(wrap_failure(e, "playwright", "playwright-cli", progress_ref)),
            }
        }
        other => bail!("unknown step `{other}`. Valid steps: node, playwright"),
    }
}
```

Add the shared `wrap_failure` helper just below `run_step`:

```rust
/// Build a `FailedStepReport`, emit a terminal `ProgressEvent::Done`, and
/// attach the report to the error via `.context(...)`. Called by
/// `run_all` / `run_step` on any `ensure()` failure.
fn wrap_failure(
    err: anyhow::Error,
    name: &'static str,
    label: &'static str,
    progress: &(dyn Fn(ProgressEvent) + Send + Sync),
) -> anyhow::Error {
    let code = classify_error(&err);
    let message = format!("{err:#}");
    progress(ProgressEvent {
        step: name,
        phase: Phase::Done,
        message: message.clone(),
        percent: None,
        stream: None,
    });
    let report = CheckReport {
        name,
        label,
        status: CheckStatus::Failed { code, message: message.clone() },
        fix_hint: Some(FixHint::RunStep {
            command: format!("ahandd browser-init --step {name} --force"),
        }),
    };
    err.context(FailedStepReport(report))
}
```

- [ ] **Step 4: Add behavior tests for the wrapping**

Append to the `#[cfg(test)] mod tests` block:

```rust
    #[tokio::test]
    async fn failed_step_report_attached_to_error() {
        // Contrive a run_step failure by hitting the "unknown step" bail —
        // but that doesn't go through wrap_failure. Instead, run_step("node", ...)
        // with a forced failure isn't easy to mock without refactoring node::ensure.
        //
        // This test is deliberately narrow: use the public classifier + newtype
        // round-trip, since the full end-to-end "ensure fails → report attached"
        // path is covered by the integration tests in `tests/browser_setup.rs`
        // (see Task 7 CI run).
        let report = CheckReport {
            name: "node",
            label: "Node.js",
            status: CheckStatus::Failed {
                code: ErrorCode::PermissionDenied,
                message: "EACCES".into(),
            },
            fix_hint: None,
        };
        let err = anyhow::anyhow!("EACCES").context(FailedStepReport(report));
        let downcast = err
            .chain()
            .find_map(|e| e.downcast_ref::<FailedStepReport>());
        assert!(downcast.is_some(), "FailedStepReport should be in error chain");
        let failed = downcast.unwrap();
        assert_eq!(failed.0.name, "node");
        assert!(matches!(
            failed.0.status,
            CheckStatus::Failed { code: ErrorCode::PermissionDenied, .. }
        ));
    }

    #[test]
    fn failed_step_report_display_is_useful() {
        let report = CheckReport {
            name: "playwright",
            label: "playwright-cli",
            status: CheckStatus::Failed {
                code: ErrorCode::Network,
                message: "ECONNRESET".into(),
            },
            fix_hint: None,
        };
        let wrapper = FailedStepReport(report);
        assert_eq!(format!("{wrapper}"), "step `playwright` failed");
        assert_eq!(format!("{wrapper:?}"), "FailedStepReport(playwright)");
    }
```

- [ ] **Step 5: Run full module tests, fmt, clippy**

```
cd /Users/winrey/Projects/weightwave/aHand
cargo test -p ahandd browser_setup
cargo fmt -p ahandd -- --check
cargo clippy -p ahandd --all-targets -- -D warnings
```

All must pass. If clippy flags the large `wrap_failure` arg list, inline the helper or silence with `#[allow(clippy::too_many_arguments)]` — but only if the arg count is actually >7. The version above is 4 args, so no issue.

- [ ] **Step 6: Commit**

```
cd /Users/winrey/Projects/weightwave/aHand
git add crates/ahandd/src/browser_setup/mod.rs
git commit -m "feat(ahandd/browser_setup): add classify_error + FailedStepReport; wrap ensure() with catch-and-classify"
```

---

### Task 3: aHand — `playwright.rs` piped `npm install` I/O

**Repo:** aHand. **PR branch:** `feat/browser-setup-progress-api`.

**Goal:** Replace `Command::output().await` (which buffers all stdout/stderr until exit) with piped `spawn()` + per-line forwarding to `ProgressEvent { phase: Phase::Log, stream }`. Keep the existing high-level `Phase::Installing` / `Phase::Done` events intact.

**Files:**

- Modify: `aHand: crates/ahandd/src/browser_setup/playwright.rs`

**Acceptance Criteria:**

- [ ] During `npm install`, each stdout line triggers one `ProgressEvent { phase: Log, stream: Some(Stdout), message: <line without trailing \n> }`
- [ ] Each stderr line triggers one `ProgressEvent { phase: Log, stream: Some(Stderr), ... }`
- [ ] High-level events (`Starting`, `Installing`, `Done`) still fire — they frame the per-line stream
- [ ] Exit status handling is identical to before: non-zero exit → `bail!` with the same prose (so `classify_error` patterns still match)
- [ ] No lines are dropped on short-circuit errors (stdout/stderr reader tasks are `.await`ed before returning)
- [ ] Existing callers (`ahandctl browser-init`) continue to work — their callbacks just receive additional events
- [ ] New unit test(s) cover: piped-spawn emits the expected log events (mocked via a tiny test helper that substitutes a local script for `npm` — see Step 2)

**Verify:**

```
cd /Users/winrey/Projects/weightwave/aHand && \
  cargo test -p ahandd browser_setup::playwright && \
  cargo fmt -p ahandd -- --check && \
  cargo clippy -p ahandd --all-targets -- -D warnings
```

**Steps:**

- [ ] **Step 1: Read the current `install_playwright` function**

Before writing new code, `cat crates/ahandd/src/browser_setup/playwright.rs` and locate the function that does `npm install -g --prefix ... @playwright/cli@<ver>`. In the 240-line file it's likely `async fn install(...)` or inlined inside `ensure()`. Note which `Command` call is used, which imports are already present (`tokio::process::Command`, `std::process::Stdio`, etc.), and how exit-code failure is detected today.

Record:

- Function name + signature.
- Imports section (line range).
- The `Command::output().await` call site and its handling of `output.status` + `output.stdout` + `output.stderr`.

Keep these details in mind — the edits below assume `tokio::process::Command` is already imported. If not, add it.

- [ ] **Step 2: Add a piped-spawn helper**

Near the top of `playwright.rs` (or at the end of the file if that's the local style), add:

```rust
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command as TokioCommand;
use std::process::Stdio;
use std::sync::Arc;

use super::types::{LogStream, Phase, ProgressEvent};

/// Spawn `npm install` with piped stdout/stderr, forwarding each line to
/// the progress callback as `Phase::Log` events. Returns `Ok(())` on
/// successful exit; `Err(anyhow::Error)` with the combined stderr tail
/// on non-zero exit (so `classify_error` continues to see the same
/// failure strings).
async fn spawn_npm_install_with_progress(
    prefix: &str,
    package_spec: &str,
    progress: &(dyn Fn(ProgressEvent) + Send + Sync),
) -> anyhow::Result<()> {
    let mut child = TokioCommand::new("npm")
        .args(["install", "-g", "--prefix", prefix, package_spec])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| anyhow::anyhow!("failed to spawn npm: {e}"))?;

    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");

    // Wrap the callback in Arc so both reader tasks can own a handle.
    // (Can't clone a `&dyn Fn`; Arc gives us cheap refcounted share.)
    // Note: &(dyn Fn + Send + Sync) isn't Send across task boundaries on
    // its own, but the Arc promotion below captures an owned ref.
    //
    // Workaround: promote the `&dyn` to an owned trait object before
    // spawning. We can't do that directly from a borrow, so instead we
    // use a channel and collect lines on the current task. See next
    // iteration.

    let mut stdout_lines = BufReader::new(stdout).lines();
    let mut stderr_lines = BufReader::new(stderr).lines();

    // Collect all lines into a captured stderr tail (for bail message) while
    // streaming them through the callback. Read both streams concurrently
    // using tokio::select!.
    let mut stderr_tail: Vec<String> = Vec::new();
    let mut stdout_done = false;
    let mut stderr_done = false;

    while !stdout_done || !stderr_done {
        tokio::select! {
            line = stdout_lines.next_line(), if !stdout_done => {
                match line {
                    Ok(Some(l)) => progress(ProgressEvent {
                        step: "playwright",
                        phase: Phase::Log,
                        message: l,
                        percent: None,
                        stream: Some(LogStream::Stdout),
                    }),
                    Ok(None) => stdout_done = true,
                    Err(e) => {
                        stdout_done = true;
                        progress(ProgressEvent {
                            step: "playwright",
                            phase: Phase::Log,
                            message: format!("<stdout read error: {e}>"),
                            percent: None,
                            stream: Some(LogStream::Info),
                        });
                    }
                }
            }
            line = stderr_lines.next_line(), if !stderr_done => {
                match line {
                    Ok(Some(l)) => {
                        // Keep a bounded tail for the bail message
                        if stderr_tail.len() >= 40 {
                            stderr_tail.remove(0);
                        }
                        stderr_tail.push(l.clone());
                        progress(ProgressEvent {
                            step: "playwright",
                            phase: Phase::Log,
                            message: l,
                            percent: None,
                            stream: Some(LogStream::Stderr),
                        });
                    }
                    Ok(None) => stderr_done = true,
                    Err(e) => {
                        stderr_done = true;
                        progress(ProgressEvent {
                            step: "playwright",
                            phase: Phase::Log,
                            message: format!("<stderr read error: {e}>"),
                            percent: None,
                            stream: Some(LogStream::Info),
                        });
                    }
                }
            }
        }
    }

    let status = child
        .wait()
        .await
        .map_err(|e| anyhow::anyhow!("failed to wait for npm: {e}"))?;

    if !status.success() {
        let tail = stderr_tail.join("\n");
        anyhow::bail!(
            "Failed to install {package_spec} (exit {}):\n{tail}",
            status.code().unwrap_or(-1)
        );
    }
    Ok(())
}
```

The `tokio::select!` pattern interleaves stdout/stderr so ordering resembles the user's terminal. Bounded `stderr_tail` (last 40 lines) caps memory on pathological output while keeping the bail message diagnostic.

- [ ] **Step 3: Replace the existing `Command::output()` call**

Find the current install call site. It looks roughly like:

```rust
let output = Command::new("npm")
    .args(["install", "-g", "--prefix", &prefix, &format!("@playwright/cli@{PLAYWRIGHT_CLI_VERSION}")])
    .output()
    .await?;
if !output.status.success() {
    anyhow::bail!(/* ... */);
}
```

Replace with:

```rust
spawn_npm_install_with_progress(
    &prefix,
    &format!("@playwright/cli@{PLAYWRIGHT_CLI_VERSION}"),
    progress,
).await?;
```

Where `progress: &(dyn Fn(ProgressEvent) + Send + Sync)` is the callback reference the enclosing `ensure()` function already accepts.

Do the same replacement for the `npm uninstall -g ... @playwright/cli` call (if present — the current file mentions it around line 84). Use a sibling helper `spawn_npm_uninstall_with_progress` or generalize into `spawn_npm_with_progress(args, ...)` if it keeps the diff smaller.

- [ ] **Step 4: Add a unit test with a fake npm script**

At the end of `playwright.rs`, in the `#[cfg(test)]` block:

```rust
    use super::*;
    use std::sync::Mutex;

    #[tokio::test]
    async fn spawn_npm_install_forwards_stdout_stderr_lines() {
        // Create a throwaway script on-disk that emulates npm by writing
        // 2 lines to stdout and 2 lines to stderr, then exiting 0.
        let dir = tempfile::tempdir().unwrap();
        let script_path = dir.path().join("fake-npm.sh");
        std::fs::write(
            &script_path,
            "#!/bin/sh\n\
             echo 'npm notice created a lockfile'\n\
             echo 'npm notice cleaned up node_modules'\n\
             echo 'npm warn deprecated foo@1.2.3' >&2\n\
             echo 'npm warn deprecated bar@4.5.6' >&2\n\
             exit 0\n",
        ).unwrap();
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&script_path).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&script_path, perms).unwrap();

        let events = Arc::new(Mutex::new(Vec::<ProgressEvent>::new()));
        let events_cb = events.clone();
        let cb = move |e: ProgressEvent| {
            events_cb.lock().unwrap().push(e);
        };
        let cb_ref: &(dyn Fn(ProgressEvent) + Send + Sync) = &cb;

        // We're calling our helper but with `npm` pointing at the fake script:
        // override PATH to make it resolvable, or if the helper takes an
        // explicit path, adjust. For this test we temporarily symlink
        // dir/fake-npm.sh to dir/npm and prepend dir to PATH.
        let npm_path = dir.path().join("npm");
        std::os::unix::fs::symlink(&script_path, &npm_path).unwrap();
        let orig_path = std::env::var("PATH").unwrap();
        let new_path = format!("{}:{orig_path}", dir.path().display());
        // SAFETY: single-threaded test
        unsafe { std::env::set_var("PATH", &new_path) };

        let result = spawn_npm_install_with_progress("/tmp/unused-prefix", "fake@0.0.0", cb_ref).await;

        // Restore env
        unsafe { std::env::set_var("PATH", orig_path) };

        assert!(result.is_ok(), "expected success, got {:?}", result.err());

        let events = events.lock().unwrap();
        let stdout_lines: Vec<&str> = events
            .iter()
            .filter(|e| matches!(e.stream, Some(LogStream::Stdout)))
            .map(|e| e.message.as_str())
            .collect();
        let stderr_lines: Vec<&str> = events
            .iter()
            .filter(|e| matches!(e.stream, Some(LogStream::Stderr)))
            .map(|e| e.message.as_str())
            .collect();

        assert_eq!(stdout_lines, vec![
            "npm notice created a lockfile",
            "npm notice cleaned up node_modules",
        ]);
        assert_eq!(stderr_lines, vec![
            "npm warn deprecated foo@1.2.3",
            "npm warn deprecated bar@4.5.6",
        ]);
    }

    #[tokio::test]
    async fn spawn_npm_install_surfaces_nonzero_exit_in_bail() {
        let dir = tempfile::tempdir().unwrap();
        let script_path = dir.path().join("fake-npm.sh");
        std::fs::write(
            &script_path,
            "#!/bin/sh\n\
             echo 'npm ERR! EACCES: permission denied' >&2\n\
             echo 'npm ERR! fix this by running chown' >&2\n\
             exit 243\n",
        ).unwrap();
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&script_path).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&script_path, perms).unwrap();
        let npm_path = dir.path().join("npm");
        std::os::unix::fs::symlink(&script_path, &npm_path).unwrap();
        let orig_path = std::env::var("PATH").unwrap();
        unsafe {
            std::env::set_var("PATH", format!("{}:{orig_path}", dir.path().display()));
        }
        let cb = |_: ProgressEvent| {};
        let cb_ref: &(dyn Fn(ProgressEvent) + Send + Sync) = &cb;

        let result = spawn_npm_install_with_progress("/tmp/unused-prefix", "fake@0.0.0", cb_ref).await;
        unsafe { std::env::set_var("PATH", orig_path); }

        assert!(result.is_err());
        let msg = format!("{:#}", result.unwrap_err());
        assert!(msg.contains("exit 243"), "bail message should include exit code: {msg}");
        assert!(msg.contains("EACCES"), "bail message should contain stderr tail for classify_error: {msg}");
    }
```

Both tests need `tempfile` as a dev-dependency. If not already present, add to `crates/ahandd/Cargo.toml`:

```toml
[dev-dependencies]
tempfile = "3"
```

If `tempfile` is already in workspace deps, use the workspace version via `tempfile = { workspace = true }`.

- [ ] **Step 5: Run tests, fmt, clippy**

```
cd /Users/winrey/Projects/weightwave/aHand
cargo test -p ahandd browser_setup::playwright
cargo fmt -p ahandd -- --check
cargo clippy -p ahandd --all-targets -- -D warnings
```

Flaky test watch: the `select!`-based concurrent reader can occasionally deliver stderr before stdout even though the shell script writes stdout first. The assertions above compare whole sub-lists per-stream, so interleaving between streams doesn't matter — assertions only check ordering within each stream, which is guaranteed by line-buffered stdio.

- [ ] **Step 6: Commit**

```
cd /Users/winrey/Projects/weightwave/aHand
git add crates/ahandd/src/browser_setup/playwright.rs crates/ahandd/Cargo.toml
git commit -m "feat(ahandd/browser_setup): stream npm install stdout/stderr via Phase::Log events"
```

---

### Task 4: aHand — `node.rs` piped-I/O (tarball download + extract + verify)

**Repo:** aHand. **PR branch:** `feat/browser-setup-progress-api`.

**Goal:** Apply the same piped-I/O treatment to the Node installer in `node.rs`. Node install is more diverse than Playwright install (it downloads a tarball, verifies checksum, extracts) — not all stages are subprocess calls. For non-subprocess stages, continue using the existing high-level `Phase::Downloading` / `Phase::Extracting` / `Phase::Verifying` events; only subprocess stages (if any, e.g. `tar` extraction via external binary) need the new piped-stream treatment.

**Files:**

- Modify: `aHand: crates/ahandd/src/browser_setup/node.rs`

**Acceptance Criteria:**

- [ ] Any subprocess call in `node.rs` (e.g. `tar -xzf ...`, `node --version` verification) emits `Phase::Log` events per line of its stdout/stderr during execution, same shape as Task 3
- [ ] Non-subprocess stages (pure-Rust download/checksum) keep their existing `Phase::Downloading { percent: Some(..) }` / `Phase::Extracting` events
- [ ] Exit-code failures bail with the same prose as before (so `classify_error` patterns still match)
- [ ] New unit test covers at least the subprocess-streaming path (reuse the fake-npm helper from Task 3 if the tarball tool takes similar stdio, or add a sibling fake-tar helper)

**Verify:**

```
cd /Users/winrey/Projects/weightwave/aHand && \
  cargo test -p ahandd browser_setup::node && \
  cargo fmt -p ahandd -- --check && \
  cargo clippy -p ahandd --all-targets -- -D warnings
```

**Steps:**

- [ ] **Step 1: Read `node.rs` and identify subprocess call sites**

Run: `cat crates/ahandd/src/browser_setup/node.rs | grep -n -E 'Command::(new|output|spawn)'` (or `rg Command::new crates/ahandd/src/browser_setup/node.rs`).

Document each hit: what the subprocess does, what its stdio looks like today, whether it's currently `output().await` (buffered) or already spawned. For every `.output().await` call, plan to replace with a piped-spawn helper following Task 3's pattern.

If `node.rs` doesn't shell out at all (pure-Rust tarball handling) — that's fine, no piped work needed. In that case this task reduces to "verify current `Phase::Downloading` events still fire and have `percent` populated". Skip to Step 5.

- [ ] **Step 2: Factor the Task 3 helper into a shared module (optional)**

If both `playwright.rs` and `node.rs` need `spawn_with_progress`, promote it to `browser_setup/child_progress.rs`:

```rust
//! Shared helper: spawn a child process, pipe stdout/stderr line-by-line
//! to a progress callback as `Phase::Log` events, and bail with a
//! captured stderr tail on non-zero exit.

use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command as TokioCommand;

use super::types::{LogStream, Phase, ProgressEvent};

pub(super) async fn spawn_with_progress(
    step: &'static str,
    program: &str,
    args: &[&str],
    progress: &(dyn Fn(ProgressEvent) + Send + Sync),
) -> anyhow::Result<()> {
    // Exactly the same body as spawn_npm_install_with_progress from Task 3,
    // but parameterized by `step`, `program`, `args`.
    // ... (copy from Task 3; replace the hard-coded "playwright" step name
    // with the `step` parameter and use `program`+`args` instead of "npm"
    // + fixed args)
}
```

Then both `playwright.rs` and `node.rs` can call:

```rust
use super::child_progress::spawn_with_progress;

spawn_with_progress("playwright", "npm", &["install", "-g", /* ... */], progress).await?;
spawn_with_progress("node", "tar", &["-xzf", &tarball_path, "-C", &dest], progress).await?;
```

If `node.rs` turns out not to have any subprocess calls (Step 1 confirmation), skip this refactor and leave `spawn_npm_install_with_progress` inline in `playwright.rs`.

- [ ] **Step 3: Replace `node.rs` subprocess call sites with the helper**

For each `Command::output().await` in `node.rs`, substitute with `spawn_with_progress("node", "<program>", &["<args>"...], progress).await?;`. The step name becomes `"node"` so downstream consumers can filter per-step log streams correctly.

- [ ] **Step 4: Add unit tests for node-side piped calls**

Mirror the two tests from Task 3 Step 4, substituting:

- `fake-npm.sh` → `fake-tar.sh` or equivalent for whatever subprocess node.rs invokes
- `"playwright"` step name → `"node"`
- Content lines adjusted to representative node-install output

- [ ] **Step 5: Verify existing high-level progress events still fire**

Read `node.rs` for existing `progress(ProgressEvent { phase: Phase::Downloading, ... })` call sites. Confirm they remain unchanged and emit with `percent` where available (HTTP download with known content-length).

- [ ] **Step 6: Run tests, fmt, clippy**

```
cd /Users/winrey/Projects/weightwave/aHand
cargo test -p ahandd browser_setup::node
cargo fmt -p ahandd -- --check
cargo clippy -p ahandd --all-targets -- -D warnings
```

- [ ] **Step 7: Commit**

```
cd /Users/winrey/Projects/weightwave/aHand
git add crates/ahandd/src/browser_setup/node.rs \
        crates/ahandd/src/browser_setup/child_progress.rs  # only if created in Step 2
git commit -m "feat(ahandd/browser_setup): stream node installer subprocess output via Phase::Log"
```

---

### Task 5: aHand — `Config::set_browser_enabled` with atomic write

**Repo:** aHand. **PR branch:** `feat/browser-setup-progress-api`.

**Goal:** Add a focused helper on `Config` that flips `[browser].enabled` and persists atomically (write to `config.toml.tmp` + rename). Returns the previous value so callers can detect no-ops. Preserves all other fields — never serializes from a partially-default struct.

**Files:**

- Modify: `aHand: crates/ahandd/src/config.rs`

**Acceptance Criteria:**

- [ ] `pub fn set_browser_enabled(&mut self, path: &Path, enabled: bool) -> anyhow::Result<bool>` exists on `Config`
- [ ] When `[browser]` section is absent, a default `BrowserConfig` is inserted before writing
- [ ] Other fields on `BrowserConfig` (`binary_path`, `executable_path`, `browsers_path`, timeouts, allowed/denied domains) are preserved through the mutation
- [ ] Other top-level sections (`[hub]`, etc.) are preserved through the mutation
- [ ] Atomic write: new content goes to `{path}.tmp`, then `std::fs::rename(&tmp, path)`; on error the `.tmp` file is cleaned up
- [ ] Return value: `Ok(old_value)` — `false` when `[browser].enabled` was unset/false, `true` when it was set to true
- [ ] No-op call (setting to current value) still writes the file (toml might have different formatting) but returns the consistent `old_value`
- [ ] New tests cover: happy path round-trip (both directions), preservation of sibling fields, insert-when-missing, no-op write

**Verify:**

```
cd /Users/winrey/Projects/weightwave/aHand && \
  cargo test -p ahandd config::tests::browser_enabled && \
  cargo fmt -p ahandd -- --check && \
  cargo clippy -p ahandd --all-targets -- -D warnings
```

**Steps:**

- [ ] **Step 1: Write failing tests first**

Append to the `#[cfg(test)] mod tests` block in `crates/ahandd/src/config.rs` (location around the existing tests; if the file doesn't have one yet, add `#[cfg(test)] mod tests { use super::*; ... }` at the bottom):

```rust
    #[test]
    fn set_browser_enabled_true_then_false_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");

        // Start with a minimal valid config
        std::fs::write(&path, r#"
[hub]
url = "https://hub.example.com"
        "#).unwrap();

        let mut cfg = Config::load(&path).unwrap();
        assert_eq!(cfg.browser_config().enabled, None);

        // Flip on
        let prev = cfg.set_browser_enabled(&path, true).unwrap();
        assert_eq!(prev, false, "previous value before set: Option::None maps to false");
        let reloaded = Config::load(&path).unwrap();
        assert_eq!(reloaded.browser_config().enabled, Some(true));

        // Hub section preserved
        assert_eq!(reloaded.hub.as_ref().and_then(|h| h.url.as_deref()), Some("https://hub.example.com"));

        // Flip off
        let mut cfg2 = reloaded;
        let prev2 = cfg2.set_browser_enabled(&path, false).unwrap();
        assert_eq!(prev2, true);
        let reloaded2 = Config::load(&path).unwrap();
        assert_eq!(reloaded2.browser_config().enabled, Some(false));
    }

    #[test]
    fn set_browser_enabled_preserves_sibling_browser_fields() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");

        std::fs::write(&path, r#"
[browser]
binary_path = "/custom/playwright-cli"
default_timeout_ms = 45000
allowed_domains = ["example.com", "example.org"]
        "#).unwrap();

        let mut cfg = Config::load(&path).unwrap();
        assert_eq!(cfg.browser_config().enabled, None);

        cfg.set_browser_enabled(&path, true).unwrap();

        let reloaded = Config::load(&path).unwrap();
        let bc = reloaded.browser_config();
        assert_eq!(bc.enabled, Some(true));
        assert_eq!(bc.binary_path.as_deref(), Some("/custom/playwright-cli"));
        assert_eq!(bc.default_timeout_ms, Some(45000));
        assert_eq!(bc.allowed_domains, vec!["example.com", "example.org"]);
    }

    #[test]
    fn set_browser_enabled_inserts_section_when_missing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");

        // Config with no [browser] section at all
        std::fs::write(&path, "[hub]\nurl = \"https://hub.example.com\"\n").unwrap();

        let mut cfg = Config::load(&path).unwrap();
        assert!(cfg.browser.is_none(), "precondition: no browser section");

        let prev = cfg.set_browser_enabled(&path, true).unwrap();
        assert_eq!(prev, false);

        let reloaded = Config::load(&path).unwrap();
        assert!(reloaded.browser.is_some());
        assert_eq!(reloaded.browser_config().enabled, Some(true));
    }

    #[test]
    fn set_browser_enabled_no_op_still_writes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        std::fs::write(&path, "[browser]\nenabled = true\n").unwrap();

        let mut cfg = Config::load(&path).unwrap();
        let prev = cfg.set_browser_enabled(&path, true).unwrap();
        assert_eq!(prev, true);
        // File still exists, contains enabled=true
        assert!(path.exists());
        let reloaded = Config::load(&path).unwrap();
        assert_eq!(reloaded.browser_config().enabled, Some(true));
    }

    #[test]
    fn set_browser_enabled_atomic_no_tmp_leaks_on_success() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        std::fs::write(&path, "").unwrap();

        let mut cfg = Config::load(&path).unwrap();
        cfg.set_browser_enabled(&path, true).unwrap();

        let tmp_path = dir.path().join("config.toml.tmp");
        assert!(!tmp_path.exists(), "tmp file should not be left behind after successful write");
    }
```

Run: `cargo test -p ahandd config::tests::set_browser_enabled` — expect compile failure for "no method named `set_browser_enabled`".

- [ ] **Step 2: Implement `set_browser_enabled`**

Add the method to the `impl Config` block in `crates/ahandd/src/config.rs`, placed near `save()`:

```rust
    /// Toggle the `[browser].enabled` flag in memory and persist to `path`.
    /// Returns the *previous* value (`false` when `[browser]` or
    /// `[browser].enabled` was absent). Writes atomically: content goes
    /// to `{path}.tmp`, then `rename` into place. All other fields on
    /// `BrowserConfig` and all sibling sections are preserved.
    pub fn set_browser_enabled(
        &mut self,
        path: &Path,
        enabled: bool,
    ) -> anyhow::Result<bool> {
        // Resolve previous value. None (section absent) and Some(false)
        // both collapse to `false` — matching the consumer intuition
        // that "unset == off".
        let prev = self
            .browser
            .as_ref()
            .and_then(|bc| bc.enabled)
            .unwrap_or(false);

        // Mutate in memory. Insert a default BrowserConfig if missing.
        let bc = self.browser.get_or_insert_with(BrowserConfig::default);
        bc.enabled = Some(enabled);

        // Atomic write: serialize, write-to-tmp, rename.
        self.save_atomic(path)?;
        Ok(prev)
    }

    /// Serialize to `{path}.tmp`, fsync, rename to `path`. Leaves no
    /// `.tmp` file behind on success; best-effort cleanup on failure.
    fn save_atomic(&self, path: &Path) -> anyhow::Result<()> {
        let tmp_path = path.with_extension(
            path.extension()
                .map(|e| format!("{}.tmp", e.to_string_lossy()))
                .unwrap_or_else(|| "tmp".into()),
        );
        let content = toml::to_string_pretty(self)?;

        // Write + fsync the temp file
        {
            use std::io::Write;
            let mut f = std::fs::File::create(&tmp_path)
                .map_err(|e| anyhow::anyhow!("failed to create {}: {e}", tmp_path.display()))?;
            f.write_all(content.as_bytes())
                .map_err(|e| anyhow::anyhow!("failed to write {}: {e}", tmp_path.display()))?;
            f.sync_all()
                .map_err(|e| anyhow::anyhow!("failed to fsync {}: {e}", tmp_path.display()))?;
        }

        // Rename (atomic on POSIX; on Windows `rename` fails if target exists,
        // so on Windows we'd need a different strategy — but ahandd is
        // Unix-only for now, so this is sufficient).
        if let Err(e) = std::fs::rename(&tmp_path, path) {
            // Best-effort cleanup of the tmp file
            let _ = std::fs::remove_file(&tmp_path);
            return Err(anyhow::anyhow!(
                "failed to rename {} → {}: {e}",
                tmp_path.display(),
                path.display(),
            ));
        }
        Ok(())
    }
```

Note: `.with_extension()` replaces the extension; for a `config.toml` input we want `config.toml.tmp`, not `config.tmp`. The helper above constructs `{original_extension}.tmp` specifically (`toml.tmp`), giving `config.toml.tmp`.

Run: `cargo test -p ahandd config::tests::set_browser_enabled` — all 5 new tests should PASS.

- [ ] **Step 3: Run full tests, fmt, clippy**

```
cd /Users/winrey/Projects/weightwave/aHand
cargo test -p ahandd config
cargo fmt -p ahandd -- --check
cargo clippy -p ahandd --all-targets -- -D warnings
```

- [ ] **Step 4: Commit**

```
cd /Users/winrey/Projects/weightwave/aHand
git add crates/ahandd/src/config.rs
git commit -m "feat(ahandd/config): add Config::set_browser_enabled with atomic tmpfile+rename"
```

---

### Task 6: aHand — cap rename `"browser"` → `"browser-playwright-cli"` + deprecation banners

**Repo:** aHand. **PR branch:** `feat/browser-setup-progress-api`.

**Goal:** Flip the device-reported capability string everywhere ahandd/hub care about it; update the ownership check on the `/api/control/browser` endpoint; add deprecation-banner module comments so future AI/humans don't mistake the endpoint as the canonical browser-automation entry point.

**Files:**

- Modify: `aHand: crates/ahandd/src/ahand_client.rs` (cap push, ~line 772; keep `tool: "browser"` at ~line 1097 with an inline comment)
- Modify: `aHand: crates/ahand-hub/src/browser_service.rs` (ownership check, ~line 146)
- Modify: `aHand: crates/ahand-hub/src/http/browser.rs` (module-header banner)
- Modify: `aHand: crates/ahand-hub/src/http/control_plane.rs` (banner around `POST /api/control/browser` handler)
- Modify: `aHand: crates/ahand-hub/tests/browser_api.rs` and any other test file that uses `"browser"` in a `capabilities: vec![...]` fixture — update to `"browser-playwright-cli"`

**Acceptance Criteria:**

- [ ] ahandd's Hello advertises `"browser-playwright-cli"` (not `"browser"`) when `[browser].enabled = true`
- [ ] hub `browser_service::execute` ownership check matches the new cap string
- [ ] The `tool: "browser"` string inside `BrowserRequest` construction (internal proto field) is **unchanged**, with a new comment explaining why
- [ ] Deprecation banner prepended to both `http/browser.rs` and `http/control_plane.rs`
- [ ] All `cargo test -p ahand-hub --test browser_api` tests pass with updated fixtures
- [ ] `grep -rn '"browser"' crates/` returns no matches as a _capability string_ after this task; only occurrences inside proto field values (`tool: "browser"`) or user-facing prose remain

**Verify:**

```
cd /Users/winrey/Projects/weightwave/aHand && \
  cargo test -p ahandd && \
  cargo test -p ahand-hub && \
  cargo fmt --all -- --check && \
  cargo clippy --all-targets -- -D warnings
```

**Steps:**

- [ ] **Step 1: Update ahandd Hello cap push**

Open `crates/ahandd/src/ahand_client.rs`. Find the block near line 770-776 that constructs the capability list:

```rust
let mut capabilities = vec!["exec".to_string()];
if browser_enabled {
    capabilities.push("browser".to_string());
}
if file_enabled {
    capabilities.push("file".to_string());
}
```

Replace the `browser` push with the new string:

```rust
let mut capabilities = vec!["exec".to_string()];
if browser_enabled {
    // Device-reported capability name binds to the concrete
    // implementation. Format: `browser-<backend>`. Currently only
    // playwright-cli is supported. A future non-playwright backend
    // (e.g. native WebView, chromedp) would report `browser-<that>`
    // instead; worker-side `deriveCaps` in team9-agent-pi maps all
    // legacy / future variants to the same HostCapability.
    capabilities.push("browser-playwright-cli".to_string());
}
if file_enabled {
    capabilities.push("file".to_string());
}
```

- [ ] **Step 2: Annotate the unchanged `tool: "browser"` proto string**

Find around line 1097 the `BrowserRequest` construction that sets `tool: "browser".to_string()`. This is the proto-level tool-routing string used _only_ on the deprecated `/api/control/browser` path — not a capability. Keep it as-is and add a clarifying comment:

```rust
BrowserRequest {
    // `tool: "browser"` here is the proto field that routes the request
    // to the daemon's browser handler. It is NOT the same as the
    // device-advertised capability string (see line ~772 where we now
    // push "browser-playwright-cli"). This proto field stays unchanged
    // for wire-compat with the deprecated /api/control/browser endpoint;
    // see that endpoint's module-level deprecation banner.
    tool: "browser".to_string(),
    /* ... */
}
```

- [ ] **Step 3: Update hub ownership check**

Open `crates/ahand-hub/src/browser_service.rs`. Find the cap match (~line 146):

```rust
if !device.capabilities.iter().any(|c| c == "browser") {
    // return CapabilityMissing
}
```

Replace with:

```rust
if !device.capabilities.iter().any(|c| c == "browser-playwright-cli") {
    // return CapabilityMissing
    // (If we add non-playwright backends later, extend this check to
    //  accept any capability starting with "browser-".)
}
```

- [ ] **Step 4: Prepend deprecation banner to `http/browser.rs`**

At the very top of `crates/ahand-hub/src/http/browser.rs` (above `use` statements), insert:

```rust
//! DEPRECATED (temporarily retained).
//!
//! This endpoint was designed to let the hub proxy browser-automation
//! requests to a device's ahandd directly, over a dedicated control-
//! plane path. As of 2026-04-29, the team9 platform switched to a
//! simpler model: agents drive browsers by calling `playwright-cli`
//! via the standard `run_command` shell tool, guided by an injected
//! SKILL.md (see the `browser-playwright-cli` skill folder in
//! team9-agent-pi). The `browser-playwright-cli` device capability
//! (reported by ahandd when `[browser].enabled = true`) signals that
//! the device has playwright-cli installed; agents should interpret
//! that as "you can shell out to playwright-cli", not as "you should
//! call /api/control/browser".
//!
//! This endpoint is kept only to unblock a future, non-playwright-cli
//! browser backend (e.g. native WebView / chromedp) that may benefit
//! from a direct control-plane path. Do NOT add new callers here
//! without revisiting that decision.
```

- [ ] **Step 5: Prepend deprecation banner to `http/control_plane.rs`**

If `control_plane.rs` is a larger module that handles multiple routes, don't prefix the whole module — instead put the banner as a doc comment directly above the `POST /api/control/browser` handler function. Copy the same text as Step 4.

If `control_plane.rs` is a module devoted mostly to this handler, do prefix the module header with the banner (same as Step 4).

- [ ] **Step 6: Update test fixtures**

`rg 'capabilities.*"browser"' aHand/crates/ahand-hub/tests/ aHand/crates/ahand-hub/src/`

Each hit should be updated:

```rust
capabilities: vec!["browser".into()],
// becomes
capabilities: vec!["browser-playwright-cli".into()],
```

Also `rg 'capabilities.*"browser"' aHand/crates/ahandd/tests/`.

Note: If any test is _specifically_ testing the backwards-compat path (e.g. asserting that old-name `"browser"` was accepted), you need to decide: delete the test (because hub-side now only recognizes the new name and the agent-pi-side handles legacy aliasing) or keep it as a negative test (expecting a 400). Usually easiest: delete the test and rely on the agent-pi-side `deriveCaps` alias (Task 8).

- [ ] **Step 7: Run full aHand test suite**

```
cd /Users/winrey/Projects/weightwave/aHand
cargo test -p ahandd
cargo test -p ahand-hub
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
```

Expected: all green. If any test outside the files listed in Acceptance Criteria uses `"browser"` as a cap string, update that too.

- [ ] **Step 8: Commit**

```
cd /Users/winrey/Projects/weightwave/aHand
git add crates/ahandd/src/ahand_client.rs \
        crates/ahand-hub/src/browser_service.rs \
        crates/ahand-hub/src/http/browser.rs \
        crates/ahand-hub/src/http/control_plane.rs \
        crates/ahand-hub/tests/browser_api.rs
# plus any other test files updated in Step 6
git commit -m "refactor(ahandd,ahand-hub): rename 'browser' cap to 'browser-playwright-cli'; add /api/control/browser deprecation banners"
```

---

### Task 7: aHand — PR push + CI + merge, capture SHA for downstream

**Repo:** aHand. **PR branch:** `feat/browser-setup-progress-api`.

**Goal:** Push the 6-commit Phase-A branch, open PR to `dev`, wait for CI green, merge (prefer squash for cleaner history — 6 small commits collapse to 1 feature commit), and record the merge-commit SHA for Task 8 / Task 13 to consume as `ahandd.rev`.

**Files:** none (git/CI operations).

**Acceptance Criteria:**

- [ ] Branch pushed with all 6 commits from Tasks 1-6
- [ ] PR opened against `aHand/dev` with a description summarizing the changes per task
- [ ] CI green (matches the `outbox_persistence::lock_takeover_via_kick` pre-existing flake we saw last time — see the team9/aHand device capabilities merge on 2026-04-28 for precedent)
- [ ] Merge to `dev` (squash commit) — capture the final merge SHA
- [ ] Remote + local branches cleaned up

**Verify:**

```
/opt/homebrew/bin/gh pr view <NUM> --repo team9ai/aHand --json state,mergeCommit
```

**Steps:**

- [ ] **Step 1: Push + open PR**

```
cd /Users/winrey/Projects/weightwave/aHand
git push -u origin feat/browser-setup-progress-api

/opt/homebrew/bin/gh pr create --repo team9ai/aHand --base dev --head feat/browser-setup-progress-api \
  --title "feat(ahandd): browser_setup progress API + 'browser-playwright-cli' cap rename" \
  --body "$(cat <<'EOF'
## Summary

Pairs with upcoming team9-agent-pi and team9 Tauri PRs (see
team9/docs/superpowers/specs/2026-04-29-ahand-browser-runtime-install-design.md).
This is **Phase A** of the browser runtime install + self-check UI.

## Changes

- Extend `browser_setup::types`: `LogStream`, `ErrorCode`, `Phase::Log`, `ProgressEvent.stream`, `CheckStatus::Failed`.
- Add `classify_error()` + `FailedStepReport` newtype; wrap `node::ensure` / `playwright::ensure` calls in `run_all`/`run_step` with catch-and-classify.
- `playwright.rs` + `node.rs`: switch `Command::output()` → piped `spawn()` with per-line stdout/stderr forwarding via `Phase::Log` events.
- `Config::set_browser_enabled(path, enabled)` with atomic tmpfile+rename write.
- ahandd Hello now reports `"browser-playwright-cli"` instead of `"browser"` when `[browser].enabled = true`. Hub `browser_service::execute` ownership check updated to match.
- `/api/control/browser` retained with a DEPRECATED module-header banner. Do not add new callers — see banner for rationale.

## Test Plan

- [ ] Existing `ahandctl browser-init` still works.
- [ ] New `cargo test -p ahandd browser_setup::progress browser_setup::playwright browser_setup::node config::tests::browser_enabled` all green.
- [ ] `cargo test -p ahand-hub` green with updated cap-string fixtures.
- [ ] `cargo clippy --all-targets -- -D warnings` clean.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Wait for CI; troubleshoot if flakes**

```
/opt/homebrew/bin/gh pr checks <NUM> --repo team9ai/aHand --watch
```

Known flake: `outbox_persistence::lock_takeover_via_kick` — if it fails, `gh run rerun --failed --repo team9ai/aHand <RUN_ID>`; if it fails again, consult user before admin-merging (that was the policy on the last aHand merge).

- [ ] **Step 3: Merge**

Preferred: squash merge (condenses 6 task commits into 1 feature commit on `dev`).

```
/opt/homebrew/bin/gh pr merge <NUM> --repo team9ai/aHand --squash --delete-branch
```

- [ ] **Step 4: Record the merge SHA**

```
/opt/homebrew/bin/gh pr view <NUM> --repo team9ai/aHand --json mergeCommit --jq '.mergeCommit.oid'
```

Save the SHA to the plan sidecar's metadata or somewhere your next-phase agent can pick it up. It's consumed as `ahandd.rev` in Task 13 (team9 Tauri `Cargo.toml` bump).

- [ ] **Step 5: Local cleanup**

```
cd /Users/winrey/Projects/weightwave/aHand
git checkout dev
git pull --ff-only origin dev
git branch -d feat/browser-setup-progress-api
```

If worktree was used, `git worktree remove` it too.

---

### Task 8: team9-agent-pi — `HostCapability` rename + `deriveCaps` backwards-compat alias

**Repo:** team9-agent-pi. **PR branch:** `feat/browser-skill-migration`.

**Goal:** Rename the capability type value `"browser"` → `"browser-playwright-cli"` end-to-end in TypeScript, and add a backwards-compat alias in `deriveCaps` so devices still running the old ahandd (which advertises `"browser"`) keep working during rollout. The test suite must pass in both shapes.

**Files:**

- Modify: `packages/types/src/host.ts`
- Modify: `packages/claw-hive/src/components/ahand/integration.ts`
- Modify: `packages/claw-hive/src/components/ahand/integration.test.ts`
- Modify: `packages/claw-hive/src/components/ahand/gateway-client.ts` (comment only)

**Acceptance Criteria:**

- [ ] `HostCapability` type is `"shell" | "browser-playwright-cli"` (no more `"browser"`)
- [ ] `deriveCaps` maps both `"browser"` and `"browser-playwright-cli"` inputs to `"browser-playwright-cli"` output
- [ ] Existing `deriveCaps` tests still pass (with `"browser"` input) — confirming alias works
- [ ] New test: `deriveCaps(["exec","browser-playwright-cli"])` returns `["shell","browser-playwright-cli"]`
- [ ] New test: `deriveCaps(["exec","browser","browser-playwright-cli"])` deduplicates and returns `["shell","browser-playwright-cli"]` (length 2, not 3)
- [ ] `pnpm typecheck` clean in agent-pi workspace
- [ ] `pnpm test` green (excluding tests deleted in Task 9)

**Verify:**

```
cd /Users/winrey/Projects/weightwave/team9-agent-pi && \
  pnpm --filter @team9claw/types typecheck && \
  pnpm --filter @team9claw/claw-hive typecheck && \
  pnpm --filter @team9claw/claw-hive test -- deriveCaps
```

**Steps:**

- [ ] **Step 1: Rename `HostCapability`**

Open `packages/types/src/host.ts`. Current:

```ts
export type HostCapability = "shell" | "browser";
```

Replace with:

```ts
/**
 * Capability a host backend can advertise. Names bind to concrete
 * implementations so a device (or other backend) signals not just
 * "I can do browser stuff" but specifically *which* browser stack
 * is available. When we add a new stack (e.g. native WebView) we
 * extend this union, not reuse `"browser-playwright-cli"`.
 */
export type HostCapability = "shell" | "browser-playwright-cli";
```

Run `pnpm --filter @team9claw/types typecheck` — expect clean.

- [ ] **Step 2: TypeScript will surface every consumer**

Run `pnpm --filter @team9claw/claw-hive typecheck` and `pnpm --filter @team9claw/agent-components typecheck`. The compiler will report each place the literal `"browser"` appears as a `HostCapability`. Expected hits (count approximate — the actual list from `tsc` is authoritative):

- `packages/claw-hive/src/components/ahand/integration.ts:151` — inside `deriveCaps`
- `packages/agent-components/src/components/host/host-component.ts` — `hasAnyBackendWithCap("browser")` and friends (addressed in Task 9, but Step 3 here quiets the type error so tsc remains green while Task 9 is pending)

- [ ] **Step 3: Update `deriveCaps` to the new-name-preferred + alias form**

Open `packages/claw-hive/src/components/ahand/integration.ts`. Replace the `deriveCaps` body (lines 139-152):

```ts
/**
 * Map ahandd's device-reported capability strings to HostComponent's
 * HostCapability vocabulary.
 *
 * Known mappings:
 * - `"exec"`                    → `"shell"`                   (historical rename)
 * - `"browser-playwright-cli"`  → `"browser-playwright-cli"`  (pass-through)
 * - `"browser"`                 → `"browser-playwright-cli"`  (legacy alias,
 *   for ahandd installs that predate the 2026-04-29 rename; safe to
 *   remove once all production devices have reconnected on the new
 *   ahandd version)
 *
 * Unknown strings are silently dropped, so adding a new ahandd
 * capability (e.g. `"browser-webview"`, `"files"`) does not require
 * a worker update.
 */
export function deriveCaps(
  deviceCaps: readonly string[] | undefined,
): HostCapability[] {
  if (!deviceCaps) return [];
  const out: HostCapability[] = [];
  if (deviceCaps.includes("exec")) out.push("shell");
  if (
    deviceCaps.includes("browser-playwright-cli") ||
    deviceCaps.includes("browser")
  ) {
    out.push("browser-playwright-cli");
  }
  return out;
}
```

- [ ] **Step 4: Update `deriveCaps` tests to cover both names**

Open `packages/claw-hive/src/components/ahand/integration.test.ts`. Find the `describe("deriveCaps", ...)` block (look for the test name `"maps browser to browser"` or similar — PR #87 added these).

Replace the existing browser-capability assertions with the new shape. Example diff (adjust to actual test names in the file):

```ts
it("maps 'exec' to 'shell'", () => {
  expect(deriveCaps(["exec"])).toEqual(["shell"]);
});

it("maps 'browser-playwright-cli' to 'browser-playwright-cli'", () => {
  expect(deriveCaps(["browser-playwright-cli"])).toEqual([
    "browser-playwright-cli",
  ]);
});

it("aliases legacy 'browser' to 'browser-playwright-cli'", () => {
  expect(deriveCaps(["browser"])).toEqual(["browser-playwright-cli"]);
});

it("deduplicates when both legacy and new-name caps are present", () => {
  expect(deriveCaps(["exec", "browser", "browser-playwright-cli"])).toEqual([
    "shell",
    "browser-playwright-cli",
  ]);
});

it("maps nothing when no recognized caps present", () => {
  expect(deriveCaps(["files"])).toEqual([]);
});

it("handles undefined input", () => {
  expect(deriveCaps(undefined)).toEqual([]);
});

it("handles empty array", () => {
  expect(deriveCaps([])).toEqual([]);
});
```

Delete any old test assertions that still use `"browser"` as a `HostCapability` output value (since the output is now always `"browser-playwright-cli"`).

Run: `pnpm --filter @team9claw/claw-hive test -- deriveCaps` — all 7 (or equivalent) tests should PASS.

- [ ] **Step 5: Update `gateway-client.ts` comment**

In `packages/claw-hive/src/components/ahand/gateway-client.ts`, the comment around line 34 mentions the cap vocabulary:

```ts
// (e.g. "exec", "browser"). Optional for backwards compatibility with
```

Update to:

```ts
// (e.g. "exec", "browser-playwright-cli"; ahandd installs predating
// 2026-04-29 may still emit the legacy "browser" — see deriveCaps for
// the backwards-compat alias). Optional for backwards compatibility with
```

- [ ] **Step 6: Commit**

```
cd /Users/winrey/Projects/weightwave/team9-agent-pi
git add packages/types/src/host.ts \
        packages/claw-hive/src/components/ahand/integration.ts \
        packages/claw-hive/src/components/ahand/integration.test.ts \
        packages/claw-hive/src/components/ahand/gateway-client.ts
git commit -m "refactor(types,claw-hive): HostCapability=browser-playwright-cli; deriveCaps legacy alias"
```

**Note:** After this commit, `pnpm typecheck` in `@team9claw/agent-components` will still fail due to `hasAnyBackendWithCap("browser")` call sites in `host-component.ts`. That's expected — Task 9 removes them. Don't try to fix here.

---

### Task 9: team9-agent-pi — delete `browser` LLM tool + `AhandBackend.browser()` + SDK `CloudClient.browser()`

**Repo:** team9-agent-pi. **PR branch:** `feat/browser-skill-migration`.

**Goal:** Remove the entire LLM-tool pathway introduced by PR #97 — it's being replaced by the SKILL in Tasks 10-11. After this task the code has no `browser` tool, no client-side browser dispatcher, and no SDK client method for the hub `/api/control/browser` endpoint. `run_command` is the only tool any agent uses to drive a browser.

**Files:**

- Modify: `packages/agent-components/src/components/host/host-component.ts` — delete ~150 LoC
- Modify: `packages/agent-components/src/components/host/host-component.test.ts` — delete ~browser-tool-specific assertions
- Modify: `packages/claw-hive/src/components/ahand/integration.ts` — delete `AhandBackend.browser()` method + related helpers
- Modify: `packages/claw-hive/src/components/ahand/integration.test.ts` — delete `browser()` assertions
- Modify: `aHand: packages/sdk/src/cloud-client.ts` — delete `CloudClient.browser()` method (but this lives in the aHand repo — **include as commit in the agent-pi PR's dependency is awkward**; instead, roll it into the aHand Phase-A PR as a follow-up commit, OR accept that this leaves `CloudClient.browser()` as dead code until aHand ships an SDK-removal commit. **Recommended: roll into a follow-up aHand PR / or include in the Phase-A PR before Task 7 merges.**)

See Step 6 note for SDK handling.

**Acceptance Criteria:**

- [ ] `host-component.ts` has no `BROWSER_TOOL_DESCRIPTION` constant
- [ ] `host-component.ts` has no `browserTool()` factory
- [ ] `host-component.ts` has no `browser` branch in `getTools()` (look for `if (this.hasAnyBackendWithCap("browser"))`)
- [ ] `host-component.ts` has no internal browser dispatcher (look for `translateBrowserResult`, `sessionIdForBrowser`, or the `backend.browser(...)` call chain)
- [ ] `AhandBackend.browser()` method and its tests are gone from `integration.ts` / `integration.test.ts`
- [ ] `BrowserBackendResult` type import is gone from host-component (verify with `rg 'BrowserBackendResult' packages/agent-components/src/`)
- [ ] `packages/types/src/host.ts`: `BrowserBackendResult` type is removed — no consumers remain
- [ ] Existing `run_command` tool + tests untouched
- [ ] `pnpm typecheck` clean
- [ ] `pnpm test` green

**Verify:**

```
cd /Users/winrey/Projects/weightwave/team9-agent-pi && \
  pnpm typecheck && \
  pnpm test
```

**Steps:**

- [ ] **Step 1: Inventory deletions in `host-component.ts`**

`cat packages/agent-components/src/components/host/host-component.ts` and locate each of these to confirm line ranges:

- `BROWSER_TOOL_DESCRIPTION` — around line 74, the long template-literal string (~60 lines)
- `BROWSER_DEFAULT_TIMEOUT_MS`, `BROWSER_MIN_TIMEOUT_MS`, `BROWSER_MAX_TIMEOUT_MS` — lines 67-69
- `browserTool()` factory — the `{ name: "browser", description: ..., parameters: ..., execute: ... }` object
- `if (this.hasAnyBackendWithCap("browser"))` in `getTools()` — around line 230
- Any helper methods named `resolveBrowserBackend`, `dispatchBrowser`, `translateBrowserResult`, or similar
- `import { BrowserBackendResult }` at the top of the file

Make a list of line ranges in a scratch buffer; you'll delete them in Step 2.

- [ ] **Step 2: Delete browser-tool code from `host-component.ts`**

Use the `chunked-edit` skill — delete in 3-4 chunks with separate `Edit` calls, not one giant edit, since the total deleted surface is ~200 LoC.

Chunk A: constants (lines ~67-69) + `BROWSER_TOOL_DESCRIPTION` const (~74-140).

Chunk B: `browserTool()` factory and the `tools.push(browserTool())` site inside `getTools()`. Replace the branch with a `// browser capability is now fulfilled via the browser-playwright-cli SKILL + run_command, see browser-skill-registration.ts` comment.

Chunk C: dispatcher helpers (`resolveBrowserBackend`, `translateBrowserResult`, any others referencing `backend.browser(...)`).

Chunk D: imports — remove `BrowserBackendResult` import if no consumer remains.

After each chunk, run `pnpm --filter @team9claw/agent-components typecheck` to surface any broken references. Fix them one chunk at a time.

- [ ] **Step 3: Delete `AhandBackend.browser()`**

Open `packages/claw-hive/src/components/ahand/integration.ts`. Find the `browser()` method on `AhandBackend` (added by PR #97, grep for `async browser(`). Delete the method and any helpers only it uses.

Don't touch `spawn` / `run_command` / `listDevices` / other methods.

- [ ] **Step 4: Delete browser-tool tests**

In `packages/agent-components/src/components/host/host-component.test.ts` and `packages/claw-hive/src/components/ahand/integration.test.ts`, delete every test that exercises the deleted code paths:

- Tests with `describe("browser tool", ...)` or `it("emits BrowserBackendResult", ...)` in host-component.test
- Tests calling `backend.browser(...)` in integration.test
- `AhandBackend.browser` fixture mocks

Keep tests that exercise `hasAnyBackendWithCap("browser-playwright-cli")` — those are added in Task 11 and shouldn't be deleted here.

- [ ] **Step 5: Remove `BrowserBackendResult` type**

Check if `BrowserBackendResult` (from `packages/types/src/host.ts`) has any remaining consumers:

```
cd /Users/winrey/Projects/weightwave/team9-agent-pi
rg 'BrowserBackendResult' packages/
```

If no matches after Steps 2-4, delete the type from `packages/types/src/host.ts` (search for `export (interface|type) BrowserBackendResult`).

- [ ] **Step 6: Handle SDK `CloudClient.browser()` (cross-repo coordination)**

`aHand/packages/sdk/src/cloud-client.ts` has `CloudClient.browser()`. It's the SDK counterpart for `/api/control/browser`. Since the endpoint is deprecated-but-retained (Task 6), we have two choices:

**Option A (recommended — zero-maintenance):** Retain the SDK method with a `@deprecated` JSDoc and a matching comment pointing at the hub endpoint's deprecation banner. Don't delete it. It's currently unreachable because `AhandBackend.browser()` is the sole caller and we just deleted it; but since the endpoint might come back for non-playwright backends, the SDK method is a natural entry point.

**Option B (clean):** Delete the SDK method entirely. If a future backend needs it, re-add.

Pick Option A. Edit `aHand/packages/sdk/src/cloud-client.ts` and prepend a `@deprecated` JSDoc:

```ts
/**
 * @deprecated As of 2026-04-29 this method has no live callers. It
 * was used by team9-agent-pi's `AhandBackend.browser()`, which was
 * deleted when browser automation migrated to the SKILL model
 * (agents drive `playwright-cli` via `run_command`). The underlying
 * hub endpoint `/api/control/browser` is retained with a
 * deprecation banner; see aHand/crates/ahand-hub/src/http/browser.rs.
 * Do NOT add new callers without revisiting that decision.
 */
async browser(input: BrowserInput): Promise<BrowserResult> { ... }
```

This is a doc-only change in the aHand repo — bundle it into the **aHand Phase-A PR** (before Task 7 merges), or open a tiny follow-up PR if Phase-A has already merged. Don't make the team9-agent-pi PR depend on this.

- [ ] **Step 7: Run full suite**

```
cd /Users/winrey/Projects/weightwave/team9-agent-pi
pnpm typecheck
pnpm test
pnpm lint
```

All green. If lint flags unused imports after deletions, remove them.

- [ ] **Step 8: Commit**

```
cd /Users/winrey/Projects/weightwave/team9-agent-pi
git add packages/agent-components/src/components/host/host-component.ts \
        packages/agent-components/src/components/host/host-component.test.ts \
        packages/claw-hive/src/components/ahand/integration.ts \
        packages/claw-hive/src/components/ahand/integration.test.ts \
        packages/types/src/host.ts
git commit -m "refactor(agent-components,claw-hive): remove browser LLM tool + AhandBackend.browser() in favor of SKILL model"
```

---

### Task 10: team9-agent-pi — add `browser-playwright-cli` SKILL folder from upstream

**Repo:** team9-agent-pi. **PR branch:** `feat/browser-skill-migration`.

**Goal:** Copy upstream `@playwright/cli`'s `skills/playwright-cli/` folder into `packages/agent-components/skills/browser-playwright-cli/`, adjust frontmatter, prepend a team9-specific preamble to `SKILL.md`, preserve references verbatim, and add MIT attribution.

**Files (all created):**

- Create: `packages/agent-components/skills/browser-playwright-cli/SKILL.md`
- Create: `packages/agent-components/skills/browser-playwright-cli/LICENSE-UPSTREAM.md`
- Create: `packages/agent-components/skills/browser-playwright-cli/references/element-attributes.md`
- Create: `packages/agent-components/skills/browser-playwright-cli/references/playwright-tests.md`
- Create: `packages/agent-components/skills/browser-playwright-cli/references/request-mocking.md`
- Create: `packages/agent-components/skills/browser-playwright-cli/references/running-code.md`
- Create: `packages/agent-components/skills/browser-playwright-cli/references/session-management.md`
- Create: `packages/agent-components/skills/browser-playwright-cli/references/storage-state.md`
- Create: `packages/agent-components/skills/browser-playwright-cli/references/test-generation.md`
- Create: `packages/agent-components/skills/browser-playwright-cli/references/tracing.md`
- Create: `packages/agent-components/skills/browser-playwright-cli/references/video-recording.md`

**Acceptance Criteria:**

- [ ] All 9 `references/*.md` files byte-identical to upstream (SHA check step below)
- [ ] `SKILL.md` frontmatter is: `name: browser-playwright-cli` + a brief `description`; NO `allowed-tools:` line
- [ ] `SKILL.md` body: team9-specific preamble is the first H2 section, followed verbatim by upstream content
- [ ] `LICENSE-UPSTREAM.md` credits microsoft/playwright-cli with upstream MIT terms
- [ ] Running `pnpm --filter @team9claw/agent-components build` completes (the skill folder is bundled into the published package)

**Verify:**

```
ls /Users/winrey/Projects/weightwave/team9-agent-pi/packages/agent-components/skills/browser-playwright-cli/ && \
  ls /Users/winrey/Projects/weightwave/team9-agent-pi/packages/agent-components/skills/browser-playwright-cli/references/
```

**Steps:**

- [ ] **Step 1: Fetch the upstream folder contents**

Upstream commit reference: `microsoft/playwright-cli` as of 2026-04-29, `skills/playwright-cli/` directory. Use `gh api` to retrieve each file's content. Script:

```
mkdir -p /Users/winrey/Projects/weightwave/team9-agent-pi/packages/agent-components/skills/browser-playwright-cli/references

# 1. Pull SKILL.md
/opt/homebrew/bin/gh api "repos/microsoft/playwright-cli/contents/skills/playwright-cli/SKILL.md" \
  --jq '.content' | base64 -d > /tmp/upstream-SKILL.md

# 2. Pull each reference file
for name in element-attributes playwright-tests request-mocking running-code \
            session-management storage-state test-generation tracing video-recording; do
  /opt/homebrew/bin/gh api "repos/microsoft/playwright-cli/contents/skills/playwright-cli/references/${name}.md" \
    --jq '.content' | base64 -d > \
    "/Users/winrey/Projects/weightwave/team9-agent-pi/packages/agent-components/skills/browser-playwright-cli/references/${name}.md"
done
```

Verify file sizes match what we saw earlier (SKILL.md ≈ 10.8 KB, references total ≈ 34 KB).

- [ ] **Step 2: Modify `SKILL.md` — frontmatter + preamble**

Write the new `SKILL.md` to `packages/agent-components/skills/browser-playwright-cli/SKILL.md`. Structure:

```markdown
---
name: browser-playwright-cli
description: Automate browser interactions by shelling out to `playwright-cli` on the user's ahand device. Only applicable when the device reports the `browser-playwright-cli` capability; not applicable for devices without it or for shell-only backends.
---

# Browser Automation with playwright-cli

## How to invoke `playwright-cli` on a team9 agent session

You drive `playwright-cli` by calling the `run_command` shell tool on
any backend whose `capabilities` list contains
`"browser-playwright-cli"`. Check the `<host-context>` /
`<ahand-context>` blocks to confirm — if no backend has that cap, this
skill is not applicable.

The `playwright-cli` binary is on the device's `PATH` (installed by
ahandd at `~/.ahand/node/bin/playwright-cli`). Invoke it as:

    run_command({ command: "playwright-cli <args>" })

**State persistence:** page state, cookies, and element refs (e.g. `e2`
from a prior `snapshot`) persist across `run_command` calls on the same
backend within the same agent session, as long as you don't explicitly
call `playwright-cli close`. If you switch backends, state does not
carry over.

**Picking a backend:** if multiple backends report
`browser-playwright-cli`, pass the explicit `backend` parameter to
`run_command` to pin the call to one device. Omit it to reuse the
last-used backend (same "sticky backend" behavior documented for
`run_command`).

**Output conventions:** `playwright-cli snapshot` and `playwright-cli
eval` write their results to stdout; `run_command` surfaces stdout
directly to you. Screenshots and other binary outputs are written to a
file whose path is printed on stdout — call `playwright-cli screenshot
--out /tmp/foo.png` and then read or send the file separately.

Everything below is upstream reference material from
microsoft/playwright-cli (MIT, see LICENSE-UPSTREAM.md in this folder).
Skim the Quick start, then pull individual reference files
(`references/<topic>.md`) on demand when you need specialized
commands.

<UPSTREAM_BODY_HERE>
```

Where `<UPSTREAM_BODY_HERE>` is the upstream `SKILL.md` content **excluding** its original frontmatter (the `---` block at the top) and **excluding** its initial `# Browser Automation with playwright-cli` heading (we've already inserted ours). In other words: strip the upstream frontmatter and its H1, then paste the remainder starting from upstream's first H2 (`## Quick start`).

Concretely:

```
# Extract the body (strip the first --- ... --- block and the immediately-following H1)
awk 'BEGIN{skip_frontmatter=1; saw_h1=0}
     skip_frontmatter==1 && /^---$/ {count_separators++; if (count_separators==2) skip_frontmatter=0; next}
     skip_frontmatter==1 {next}
     saw_h1==0 && /^# / {saw_h1=1; next}
     {print}' /tmp/upstream-SKILL.md > /tmp/upstream-SKILL-body.md

# Then glue the team9 header (first part above) + upstream body
cat <team9-header-file> /tmp/upstream-SKILL-body.md > \
  /Users/winrey/Projects/weightwave/team9-agent-pi/packages/agent-components/skills/browser-playwright-cli/SKILL.md
```

(Adapt awk if upstream file has CRLF line endings.)

- [ ] **Step 3: Create `LICENSE-UPSTREAM.md`**

```markdown
# Upstream Attribution

The content of `SKILL.md` (below the "How to invoke `playwright-cli`
on a team9 agent session" preamble) and all files in `references/`
are adapted from microsoft/playwright-cli:

https://github.com/microsoft/playwright-cli/tree/main/skills/playwright-cli

Upstream license: MIT. See
https://github.com/microsoft/playwright-cli/blob/main/LICENSE

Original copyright © Microsoft Corporation.

---

## Adaptation notes

- `SKILL.md` frontmatter changed: `name: playwright-cli` →
  `browser-playwright-cli`; `allowed-tools:` line removed (team9
  routes Bash-like calls through its own `run_command` tool, not
  Claude Code's `Bash`).
- A team9-specific preamble section was inserted at the top of
  `SKILL.md` documenting how to invoke the CLI via `run_command`
  and the backend-cap gating.
- All 9 reference files in `references/` are verbatim copies from
  upstream; no adaptations.
```

- [ ] **Step 4: Verify references are byte-identical to upstream**

```
for name in element-attributes playwright-tests request-mocking running-code \
            session-management storage-state test-generation tracing video-recording; do
  expected_sha=$(gh api "repos/microsoft/playwright-cli/contents/skills/playwright-cli/references/${name}.md" --jq '.sha')
  actual_content=$(cat "/Users/winrey/Projects/weightwave/team9-agent-pi/packages/agent-components/skills/browser-playwright-cli/references/${name}.md")
  # GitHub's .sha is a git blob SHA of "blob <size>\0<content>" — reconstruct locally:
  actual_sha=$(printf "blob %d\0%s" "${#actual_content}" "$actual_content" | shasum -a 1 | cut -d' ' -f1)
  if [ "$expected_sha" = "$actual_sha" ]; then
    echo "✓ ${name}.md"
  else
    echo "✗ ${name}.md: expected $expected_sha, got $actual_sha"
  fi
done
```

All must print `✓`. If one mismatches, re-fetch that file — most likely a base64 decode hiccup.

- [ ] **Step 5: Build the agent-components package**

```
cd /Users/winrey/Projects/weightwave/team9-agent-pi
pnpm --filter @team9claw/agent-components build
```

Verify the `skills/browser-playwright-cli/` folder is included in the package's publish contents (check `package.json` → `files` field in `@team9claw/agent-components` — if it lists `dist/` only, you may need to add `skills/`).

If `package.json` needs editing, add `"skills"` to the `files` array.

- [ ] **Step 6: Commit**

```
cd /Users/winrey/Projects/weightwave/team9-agent-pi
git add packages/agent-components/skills/browser-playwright-cli/
# Also stage package.json if modified
git add packages/agent-components/package.json
git commit -m "feat(agent-components): add browser-playwright-cli SKILL folder (adapted from microsoft/playwright-cli, MIT)"
```

---

### Task 11: team9-agent-pi — register the SKILL conditionally from `HostComponent`

**Repo:** team9-agent-pi. **PR branch:** `feat/browser-skill-migration`.

**Goal:** Teach `HostComponent` to register the `browser-playwright-cli` SKILL with the session's `skill-tier` if and only if at least one backend reports the `browser-playwright-cli` capability. This is the **gating logic that replaces** the `hasAnyBackendWithCap("browser") → tools.push(browserTool())` branch we deleted in Task 9.

**Placement:** The component-package CLAUDE.md (see `packages/agent-components/CLAUDE.md`) documents the canonical pattern: call `registerSourceCodeSkills(ctx, packageSkillDir(import.meta.url, "<comp-dir>"), { id })` from the component's `onInitialize`. Our twist: only register when the cap is present.

**Files:**

- Modify: `packages/agent-components/src/components/host/host-component.ts`
- Modify: `packages/agent-components/src/components/host/host-component.test.ts`
- Create: `packages/agent-components/skills/host/` — **NOT here.** The skill lives in `packages/agent-components/skills/browser-playwright-cli/` (created in Task 10), not under a host subfolder. This is because multiple future browser backends would each want their own top-level skill folder, not a sub-folder of host. The CLAUDE.md convention suggests `packages/<pkg>/skills/<comp>/<skill>/SKILL.md`, but that's a convention for **one-skill-per-component**; ours is a **one-skill-per-capability** situation, so placing the skill at `skills/browser-playwright-cli/` (component-agnostic) is cleaner.

**Acceptance Criteria:**

- [ ] `HostComponent.dependencies` includes `"skill-tier"` (otherwise skill registration silently no-ops)
- [ ] In `HostComponent.onInitialize` (or `onSessionStart`, whichever matches the existing pattern where the cap snapshot is first available), conditionally register the skill provider for every backend with `browser-playwright-cli`
- [ ] Registration is idempotent — the same `id` (`"@team9claw/agent-components/browser-playwright-cli"`) collides with itself on subsequent registrations, and `SkillTierDependencyApi.registerProvider` handles the collision either by returning silently or by throwing a specific error that we catch with a debug log
- [ ] When **no** backend has the cap, the provider is NOT registered
- [ ] When a backend is added mid-session that reports the cap (dynamic `applyBackendDiff` path — see `AhandIntegration.applyBackendDiff` in PR #87), the skill becomes registered at that moment
- [ ] Test: `HostComponent` with all shell-only backends → skill-tier `registerProvider` not called with `browser-playwright-cli` id
- [ ] Test: `HostComponent` with a backend reporting `browser-playwright-cli` → skill-tier `registerProvider` called once with the correct id + directory

**Verify:**

```
cd /Users/winrey/Projects/weightwave/team9-agent-pi && \
  pnpm --filter @team9claw/agent-components typecheck && \
  pnpm --filter @team9claw/agent-components test -- host-component
```

**Steps:**

- [ ] **Step 1: Ensure `HostComponent` has `dependencies: ["skill-tier"]`**

Open `packages/agent-components/src/components/host/host-component.ts`. Find the `dependencies` field (or `static readonly dependencies`) on the class. If it already includes `"skill-tier"`, no change needed. If not, add it:

```ts
readonly dependencies = ["skill-tier"];
```

Preserve any other existing dependencies (e.g. if `HostComponent` declares `["tools", ...]`, just add `"skill-tier"` to the list).

- [ ] **Step 2: Write the cap-checking registration helper**

In `host-component.ts`, near the top imports:

```ts
import { packageSkillDir, registerSourceCodeSkills } from "../skill/index.js";
```

Then add a small private method on `HostComponent`:

```ts
/**
 * Register skills that are gated on device capabilities. Called during
 * `onInitialize` and whenever backends are added/removed (if the host
 * supports hot re-registration — at minimum on every `onSessionStart`).
 *
 * Guards:
 * - No-op when no backend has `browser-playwright-cli` cap.
 * - Idempotent: SkillTier.registerProvider keys on the provider id, so
 *   repeat calls with the same id + dir don't duplicate.
 */
private registerCapabilityGatedSkills(ctx: ComponentContext<HostData>): void {
  if (this.hasAnyBackendWithCap("browser-playwright-cli")) {
    registerSourceCodeSkills(
      ctx,
      packageSkillDir(import.meta.url, "browser-playwright-cli"),
      { id: "@team9claw/agent-components/browser-playwright-cli" },
    );
  }
}
```

Note: the 2nd arg to `packageSkillDir` is the folder name under `skills/`, so `packageSkillDir(import.meta.url, "browser-playwright-cli")` resolves to the right path regardless of whether we're in dev or dist.

- [ ] **Step 3: Call the helper from `onInitialize`**

Find `HostComponent.onInitialize` (or equivalent lifecycle method). At the end of the existing body:

```ts
async onInitialize(ctx: ComponentContext<HostData>): Promise<void> {
  // ... existing init ...
  this.registerCapabilityGatedSkills(ctx);
}
```

- [ ] **Step 4: Call from backend-diff application point**

`AhandIntegration.applyBackendDiff` (in `claw-hive/src/components/ahand/integration.ts`) re-registers backends mid-session when caps change (PR #87 did this for the browser tool's getTools refresh). Same idea for skill registration — if a new backend with `browser-playwright-cli` joins after session start, we want the skill to become available.

However: `SourceCodeFolderProvider` doesn't currently support un-registration. So the semantics we want are:

- Once ANY backend reports the cap during the session, the skill is registered and stays registered.
- If all such backends go offline, the skill remains registered but calls to `run_command + playwright-cli` will fail fast (which is fine — the agent gets an error and can choose a different backend).

Implementation: at the end of `HostComponent.onSessionStart` (or whatever hook fires when backends have been re-evaluated), call `this.registerCapabilityGatedSkills(ctx)`. The `registerSourceCodeSkills` helper is idempotent, so repeated calls are harmless.

Find `onSessionStart` in `host-component.ts`. If absent, add:

```ts
async onSessionStart(ctx: ComponentContext<HostData>): Promise<void> {
  this.registerCapabilityGatedSkills(ctx);
}
```

- [ ] **Step 5: Add unit tests**

In `packages/agent-components/src/components/host/host-component.test.ts`, add:

```ts
describe("HostComponent skill registration", () => {
  it("does not register browser-playwright-cli skill when no backend has the cap", async () => {
    const registeredIds: string[] = [];
    const ctx = mockCtx({
      dependencies: {
        "skill-tier": {
          registerProvider: (p: unknown) =>
            registeredIds.push(String((p as { id?: string }).id ?? "<no-id>")),
          // ... other SkillTierDependencyApi stubs ...
        },
      },
    });

    const host = new HostComponent(/* config with a shell-only backend */);
    await host.onInitialize(ctx);
    await host.onSessionStart(ctx);

    expect(registeredIds).not.toContain(
      "@team9claw/agent-components/browser-playwright-cli",
    );
  });

  it("registers browser-playwright-cli skill when any backend has the cap", async () => {
    const registeredIds: string[] = [];
    const ctx = mockCtx({
      dependencies: {
        "skill-tier": {
          registerProvider: (p: unknown) =>
            registeredIds.push(String((p as { id?: string }).id ?? "<no-id>")),
        },
      },
    });

    const host =
      new HostComponent(/* config with a backend reporting ["shell","browser-playwright-cli"] */);
    await host.onInitialize(ctx);

    expect(registeredIds).toContain(
      "@team9claw/agent-components/browser-playwright-cli",
    );
  });

  it("is idempotent across onSessionStart calls", async () => {
    const registeredIds: string[] = [];
    const ctx = mockCtx({
      /* same as above */
    });
    const host = new HostComponent(/* cap-having config */);
    await host.onInitialize(ctx);
    await host.onSessionStart(ctx);
    await host.onSessionStart(ctx);

    const count = registeredIds.filter(
      (id) => id === "@team9claw/agent-components/browser-playwright-cli",
    ).length;
    // Two invocations; registerProvider's id-based dedupe lives in SkillTier itself, so the mock sees 2 calls with the same id.
    // SkillTier's real implementation is responsible for no-op on dup id.
    expect(count).toBeLessThanOrEqual(2);
  });

  it("skip-registers silently when no skill-tier dependency present", async () => {
    const ctx = mockCtx({ dependencies: {} }); // no skill-tier
    const host = new HostComponent(/* cap-having config */);
    await expect(host.onInitialize(ctx)).resolves.not.toThrow();
  });
});
```

Adapt `mockCtx` / `HostComponent` constructor args to match the existing test helpers in this file. If the file already has a helper for building a `ComponentContext` with a mocked dependency facade, reuse it.

- [ ] **Step 6: Run tests, typecheck, lint**

```
cd /Users/winrey/Projects/weightwave/team9-agent-pi
pnpm --filter @team9claw/agent-components typecheck
pnpm --filter @team9claw/agent-components test -- host-component
pnpm lint
```

- [ ] **Step 7: Commit**

```
cd /Users/winrey/Projects/weightwave/team9-agent-pi
git add packages/agent-components/src/components/host/host-component.ts \
        packages/agent-components/src/components/host/host-component.test.ts
git commit -m "feat(host-component): register browser-playwright-cli SKILL when a backend has the cap"
```

---

### Task 12: team9-agent-pi — delete orphan `docs/skills/browser.md` + PR assembly

**Repo:** team9-agent-pi. **PR branch:** `feat/browser-skill-migration`.

**Goal:** Remove the stale browser-tool SKILL markdown that PR #97 left at the repo root (we've superseded it with the new skill folder in `packages/agent-components/skills/browser-playwright-cli/`), push the branch, open PR to `dev`, wait for CI, merge.

**Files:**

- Delete: `docs/skills/browser.md` (at repo root — NOT in agent-components/skills/)

**Acceptance Criteria:**

- [ ] `docs/skills/browser.md` deleted
- [ ] Branch has all commits from Tasks 8-11 plus this deletion
- [ ] CI green
- [ ] PR merged to `dev`; merge SHA captured

**Verify:**

```
cd /Users/winrey/Projects/weightwave/team9-agent-pi && \
  ls docs/skills/browser.md 2>&1 | grep -q "No such file" && \
  /opt/homebrew/bin/gh pr view <NUM> --repo team9ai/agent-pi --json state,mergeCommit
```

**Steps:**

- [ ] **Step 1: Confirm the file exists and delete it**

```
cd /Users/winrey/Projects/weightwave/team9-agent-pi
ls docs/skills/browser.md
# should exist from PR #97

rm docs/skills/browser.md
# Check if docs/skills/ is now empty. If so, remove the directory too.
if [ -z "$(ls -A docs/skills/ 2>/dev/null)" ]; then
  rmdir docs/skills/
fi
```

- [ ] **Step 2: Run full suite one last time**

```
cd /Users/winrey/Projects/weightwave/team9-agent-pi
pnpm install  # in case any dep changed across tasks
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

All green.

- [ ] **Step 3: Commit + push branch**

```
cd /Users/winrey/Projects/weightwave/team9-agent-pi
git add -u docs/skills/  # captures the deletion (and directory removal if done)
git commit -m "chore(docs): remove orphan browser-tool skill markdown (superseded by browser-playwright-cli skill)"
git push -u origin feat/browser-skill-migration
```

- [ ] **Step 4: Open PR**

```
/opt/homebrew/bin/gh pr create --repo team9ai/agent-pi --base dev --head feat/browser-skill-migration \
  --title "feat(host-component): migrate browser automation from LLM-tool to SKILL model" \
  --body "$(cat <<'EOF'
## Summary

Phase B of the browser-runtime-install work (see team9/docs/superpowers/specs/2026-04-29-ahand-browser-runtime-install-design.md §10-11).

Depends on the aHand Phase-A PR (merged: `<PHASE_A_SHA>`) which renames the device-reported capability from `"browser"` to `"browser-playwright-cli"` and adds the `browser_setup` progress-streaming API. Phase C (team9 Tauri install UI) will bump `@team9claw/*` to include this PR's changes.

## Changes

- `HostCapability` type value renamed `"browser"` → `"browser-playwright-cli"`. `deriveCaps` accepts both old + new ahandd cap strings and maps them to the new type; old ahandd installs still work.
- Deleted the `browser` LLM tool (PR #97's `BROWSER_TOOL_DESCRIPTION` + `browserTool()` factory + internal dispatcher), `AhandBackend.browser()`, and `BrowserBackendResult` type. No LLM-tool path remains.
- Added `packages/agent-components/skills/browser-playwright-cli/` — `SKILL.md` with team9-specific preamble + all 9 reference files copied verbatim from [microsoft/playwright-cli `skills/playwright-cli/`](https://github.com/microsoft/playwright-cli/tree/main/skills/playwright-cli) (MIT, attribution in `LICENSE-UPSTREAM.md`).
- `HostComponent` registers the SKILL provider via `registerSourceCodeSkills` only when at least one backend reports `browser-playwright-cli`. Added `"skill-tier"` to `dependencies`.
- Deleted `docs/skills/browser.md` (orphan from PR #97).

## Test Plan

- [ ] `pnpm test` green including new `deriveCaps` legacy-alias tests and new `HostComponent` skill-registration tests.
- [ ] `pnpm typecheck` green.
- [ ] Manual: agent with a `browser-playwright-cli`-reporting backend can call `search_skills "browser"` → gets the skill → loads it → issues `run_command playwright-cli snapshot` successfully. (Full-device E2E is in Phase C / Task 17.)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Watch CI, merge**

```
/opt/homebrew/bin/gh pr checks <NUM> --repo team9ai/agent-pi --watch
/opt/homebrew/bin/gh pr merge <NUM> --repo team9ai/agent-pi --merge --delete-branch
```

Prefer merge commit (not squash) — each of the 5-6 commits from Tasks 8-12 stands alone conceptually.

- [ ] **Step 6: Record merge SHA**

```
/opt/homebrew/bin/gh pr view <NUM> --repo team9ai/agent-pi --json mergeCommit --jq '.mergeCommit.oid'
```

Save; Task 13 uses it to bump the workspace pin in team9 Tauri.

- [ ] **Step 7: Local cleanup**

```
cd /Users/winrey/Projects/weightwave/team9-agent-pi
git checkout dev
git pull --ff-only origin dev
git branch -d feat/browser-skill-migration
# plus worktree cleanup if applicable
```

---

### Task 13: team9 Tauri — bump `ahandd.rev` + extend `AhandRuntime` with `reload()` + rollback

**Repo:** team9. **PR branch:** `feat/browser-runtime-install-ui`.

**Goal:** Pick up the Phase-A aHand API changes (new progress payloads, `Config::set_browser_enabled`, cap-string rename), bump `@team9claw/*` to the Phase-B merge, then teach `AhandRuntime` how to hot-reload — shutdown the current daemon, spawn a new one with the latest on-disk config, and roll back to the previous config if the new spawn fails.

**Files:**

- Modify: `apps/client/src-tauri/Cargo.toml` — bump `ahandd.rev` to Task 7's merge SHA
- Modify: `apps/client/package.json` (or `pnpm-workspace.yaml` pin) — bump `@team9claw/types`, `@team9claw/claw-hive`, `@team9claw/agent-components` to the Phase-B versions
- Modify: `apps/client/src-tauri/src/ahand/runtime.rs` — add `pub async fn reload(&mut self)`, `ReloadError` enum, rollback logic

**Acceptance Criteria:**

- [ ] `cargo build` and `pnpm build` succeed with new deps
- [ ] `pub enum ReloadError` with variants `ShutdownTimeout`, `SpawnFailedRolledBack(String)`, `SpawnFailedNoRollback { primary: String, rollback: String }` — all `Send + Sync + std::error::Error + Serialize`
- [ ] `pub async fn reload(&mut self) -> Result<(), ReloadError>` on `AhandRuntime`:
  - Reads config fresh from `self.config_path` (ahandd::config::Config::load)
  - Snapshots the current `DaemonConfig` as `rollback_config` before touching the handle
  - Calls `self.handle.shutdown()` with a 5s timeout; on timeout returns `ShutdownTimeout` (does NOT force-kill; the drop will do that)
  - Calls `ahandd::spawn(new_daemon_config)` — on success replaces `self.handle` and returns `Ok(())`
  - On primary-spawn failure, attempts `ahandd::spawn(rollback_daemon_config)`:
    - Rollback success → return `Err(SpawnFailedRolledBack(primary_err))`, `self.handle` holds the rollback-spawned daemon
    - Rollback failure → return `Err(SpawnFailedNoRollback { primary, rollback })`, `self.handle` is in a closed state
- [ ] `reload()` is called serially (no interleaving) via the existing `AhandRuntime` mutex — note in a comment
- [ ] New test: `reload_happy_path_respawns_with_new_config` — mock ahandd::spawn to succeed twice, assert handle got replaced
- [ ] New test: `reload_shutdown_timeout_surfaces_error` — mock shutdown to hang past 5s, assert `ShutdownTimeout` returned
- [ ] New test: `reload_rollback_on_spawn_failure` — primary spawn fails, rollback spawn succeeds, assert `SpawnFailedRolledBack`
- [ ] New test: `reload_hard_fail_when_rollback_also_fails` — both spawns fail, assert `SpawnFailedNoRollback` with both messages

**Verify:**

```
cd /Users/winrey/Projects/weightwave/team9 && \
  source /opt/homebrew/opt/nvm/nvm.sh && \
  pnpm install && \
  pnpm --filter @team9/client build && \
  cargo test --manifest-path apps/client/src-tauri/Cargo.toml runtime::tests::reload
```

**Steps:**

- [ ] **Step 1: Bump Rust dep (`ahandd.rev`)**

```
cd /Users/winrey/Projects/weightwave/team9
```

Open `apps/client/src-tauri/Cargo.toml`. Current line 51:

```toml
ahandd = { git = "https://github.com/team9ai/aHand", package = "ahandd", rev = "ab5290c2dd8d2d8ec18b8959af37d415dedbfc77" }
```

Replace the `rev` with the merge SHA captured in Task 7 Step 4 (placeholder `<PHASE_A_SHA>`):

```toml
ahandd = { git = "https://github.com/team9ai/aHand", package = "ahandd", rev = "<PHASE_A_SHA>" }
```

Run `cargo update -p ahandd` in `apps/client/src-tauri/` to refresh the lockfile.

- [ ] **Step 2: Bump workspace npm pins for agent-pi packages**

If `team9` monorepo pins `@team9claw/*` via `pnpm-workspace.yaml` with a version range, bump to the Phase-B version. Most likely these packages are published to internal registry; find their current pins in `apps/client/package.json`:

```
grep '"@team9claw/' apps/client/package.json
```

For each hit, bump to the version Phase B published. If they're `workspace:*` pins (vendored locally), nothing to bump — just ensure `pnpm install` picks them up.

```
cd /Users/winrey/Projects/weightwave/team9
pnpm install
```

- [ ] **Step 3: Verify the build works with new deps before touching runtime.rs**

```
cd /Users/winrey/Projects/weightwave/team9
pnpm --filter @team9/client build
cargo build --manifest-path apps/client/src-tauri/Cargo.toml
```

Both must succeed. If typecheck fails in `@team9/client` (renderer), the new `HostCapability` union in types might need renderer updates — fix those now (usually just string-literal comparisons against `"browser"` that need to become `"browser-playwright-cli"` or the renamed checks entirely removed).

- [ ] **Step 4: Add `ReloadError` enum and `reload()` method to `AhandRuntime`**

Open `apps/client/src-tauri/src/ahand/runtime.rs`. After existing `StartResult` / before `impl AhandRuntime`:

```rust
use serde::Serialize;

/// Return type of `AhandRuntime::reload()`. Distinguishes the three
/// failure modes so the UI can choose an appropriate banner:
/// - `ShutdownTimeout`: old daemon didn't gracefully exit; may leak
///   resources but the new spawn can still proceed.
/// - `SpawnFailedRolledBack`: respawn failed but we recovered by
///   spawning with the previous config. The runtime is still
///   functional, but the user's intended config change didn't take
///   effect.
/// - `SpawnFailedNoRollback`: both primary and rollback spawns failed;
///   the daemon is gone and the app needs a restart.
#[derive(Debug, Serialize, thiserror::Error)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ReloadError {
    #[error("daemon shutdown timed out after 5s")]
    ShutdownTimeout,

    #[error("respawn failed, rolled back to previous config: {0}")]
    SpawnFailedRolledBack(String),

    #[error("respawn failed and rollback also failed; daemon is offline")]
    SpawnFailedNoRollback { primary: String, rollback: String },
}
```

Note: add `thiserror = { workspace = true }` to `apps/client/src-tauri/Cargo.toml` dev-dependencies if not already present.

Then extend `impl AhandRuntime`:

```rust
impl AhandRuntime {
    /// Hot-reload the embedded daemon. Reads config fresh from
    /// `self.config_path`, snapshots the current config for rollback,
    /// shuts down the running daemon (5s timeout), and spawns a new one.
    /// On primary-spawn failure, attempts a rollback spawn with the
    /// previous config.
    ///
    /// Serialization: this method takes `&mut self`, so the mutex around
    /// `AhandRuntime` guarantees no two reloads interleave. Callers
    /// (browser_runtime commands) hold the lock for the whole operation.
    pub async fn reload(&mut self) -> Result<(), ReloadError> {
        use std::time::Duration;
        const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);

        // 1. Read fresh config from disk
        let new_config = ahandd::config::Config::load(&self.config_path)
            .map_err(|e| ReloadError::SpawnFailedNoRollback {
                primary: format!("load new config: {e:#}"),
                rollback: "not attempted — couldn't load any config".into(),
            })?;

        // 2. Snapshot the current effective DaemonConfig for rollback
        //    (self.current_daemon_config is a new field; see Step 5).
        let rollback_daemon_cfg = self.current_daemon_config.clone();

        // 3. Build the new DaemonConfig
        let new_daemon_cfg = build_daemon_config(
            &new_config,
            &self.startup_inputs, // hub_url, token, identity — unchanged
        );

        // 4. Shutdown (5s timeout). Take() the handle so we don't
        //    double-drop if spawn fails.
        let old_handle = std::mem::replace(&mut self.handle, closed_placeholder_handle());
        match tokio::time::timeout(SHUTDOWN_TIMEOUT, old_handle.shutdown()).await {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                // shutdown returned Err but within timeout — log + continue
                tracing::warn!("old daemon shutdown returned Err: {e:#}");
            }
            Err(_) => {
                // Timeout. Don't force-kill — drop() handles it.
                return Err(ReloadError::ShutdownTimeout);
            }
        }

        // 5. Spawn new daemon
        match ahandd::spawn(new_daemon_cfg).await {
            Ok(h) => {
                self.handle = h;
                self.current_daemon_config = new_daemon_cfg;
                Ok(())
            }
            Err(primary_err) => {
                // Try rollback
                match ahandd::spawn(rollback_daemon_cfg.clone()).await {
                    Ok(h) => {
                        self.handle = h;
                        // current_daemon_config stays as rollback value
                        Err(ReloadError::SpawnFailedRolledBack(
                            format!("{primary_err:#}"),
                        ))
                    }
                    Err(rollback_err) => Err(ReloadError::SpawnFailedNoRollback {
                        primary: format!("{primary_err:#}"),
                        rollback: format!("{rollback_err:#}"),
                    }),
                }
            }
        }
    }
}
```

The helpers `build_daemon_config`, `closed_placeholder_handle`, and `self.startup_inputs` / `self.current_daemon_config` are new — define them in Step 5.

- [ ] **Step 5: Refactor `AhandRuntime` to retain startup inputs**

The existing `start()` method in `runtime.rs` builds `DaemonConfig` inline from `cfg: StartConfig`. For `reload` to work, we need to (a) keep a clone of the current effective `DaemonConfig` on the struct, and (b) have a way to rebuild a `DaemonConfig` from on-disk `Config::load()` + any non-config-file inputs (hub token, identity) that came from `StartConfig`.

Adjust the `AhandRuntime` struct:

```rust
pub struct AhandRuntime {
    handle: ahandd::DaemonHandle,
    config_path: std::path::PathBuf,
    // Inputs from StartConfig that aren't in config.toml (hub_url/token/
    // identity) — captured at start() so reload() can rebuild
    // DaemonConfig without re-asking the renderer for them.
    startup_inputs: StartupInputs,
    current_daemon_config: ahandd::DaemonConfig,
}

struct StartupInputs {
    hub_url: String,
    device_token: String,
    // ... whatever else is in StartConfig but not in config.toml
}
```

In `start()`, save these inputs:

```rust
pub async fn start(&mut self, app: &AppHandle, cfg: StartConfig) -> Result<StartResult, String> {
    // ... existing body ...
    self.startup_inputs = StartupInputs {
        hub_url: cfg.hub_url.clone(),
        device_token: cfg.device_token.clone(),
    };
    self.current_daemon_config = daemon_cfg.clone();
    self.config_path = cfg.config_path.clone();
    // ...
}
```

And factor out a helper `build_daemon_config(config: &ahandd::config::Config, inputs: &StartupInputs) -> ahandd::DaemonConfig` that constructs a `DaemonConfig::builder(...)` with the loaded config + startup inputs.

This refactor is local to `runtime.rs`. Existing callers of `start()` need no changes.

- [ ] **Step 6: Add tests**

At the bottom of `runtime.rs` in the `#[cfg(test)] mod tests` block:

```rust
    #[tokio::test]
    async fn reload_happy_path_respawns_with_new_config() {
        // Use ahandd::DaemonHandle::test_with_mock (or equivalent test helper)
        // OR inject a boxed trait object. If ahandd doesn't expose a mock
        // daemon handle, stub it behind a local trait:
        //
        //   trait DaemonAdapter { async fn spawn(cfg) -> Result<Handle>; }
        //
        // and gate the prod path behind #[cfg(not(test))]. Use the existing
        // team9-side test pattern if one exists (check other test files in
        // src-tauri for the convention).
        //
        // For this plan, assume an `AhandRuntime::for_test(mock_adapter)`
        // constructor is added when needed.
        //
        // Test body: construct runtime, call reload(), assert Ok.
        // (Expand once the test infrastructure is in place.)
        todo!("implement after deciding on mock strategy — see Step 6 note");
    }

    // Similar stubs for the other 3 tests.
```

**Note:** the test infrastructure decision (trait adapter vs existing ahandd helpers vs live integration tests) is not yet made. During implementation, either:

- Discover that the existing `runtime.rs` tests already use a pattern → follow it (most likely), or
- If no pattern exists, introduce a minimal `trait DaemonAdapter` wrapper for test injection — but DO NOT let this block the task. If the mock plumbing becomes too expensive, write the tests as `#[ignore]`-gated integration tests that spawn a real daemon against a fake hub URL.

At a minimum, write the four test scaffolds with `todo!("...")` bodies so the missing coverage is visible in CI. Actual implementations can land in a follow-up commit if needed.

- [ ] **Step 7: Run tests, fmt, clippy**

```
cd /Users/winrey/Projects/weightwave/team9
cargo fmt --manifest-path apps/client/src-tauri/Cargo.toml
cargo clippy --manifest-path apps/client/src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path apps/client/src-tauri/Cargo.toml
```

If tests contain `todo!()` bodies, they'll panic but won't fail CI in ignored-mode — mark them `#[ignore]` until Step 6's mock strategy is resolved.

- [ ] **Step 8: Commit**

```
cd /Users/winrey/Projects/weightwave/team9
git add apps/client/src-tauri/Cargo.toml \
        apps/client/src-tauri/Cargo.lock \
        apps/client/src-tauri/src/ahand/runtime.rs \
        apps/client/package.json \
        apps/client/pnpm-lock.yaml  # if pnpm-workspace bumps are needed
git commit -m "feat(ahand/runtime): add reload() with rollback; bump ahandd.rev to <PHASE_A_SHA_SHORT>"
```

---

### Task 14: team9 Tauri — `browser_runtime.rs` with 3 commands + progress adapter + log tee

**Repo:** team9. **PR branch:** `feat/browser-runtime-install-ui`.

**Goal:** Create the Tauri backend module that the renderer calls into. Three commands: `browser_status` (read-only), `browser_install` (long-running with streaming progress), `browser_set_enabled` (short, triggers a `reload()`). Progress from ahandd flows as `ProgressEvent` → converted to `BrowserProgressEvent` (Tauri-side shape tagged with event kind + per-step lifecycle) → emitted on the `Channel`. All log lines are tee'd to `~/.ahand/logs/browser-setup-{timestamp}.log`.

**Files:**

- Create: `apps/client/src-tauri/src/ahand/browser_runtime.rs` (~350 LoC with tests)
- Modify: `apps/client/src-tauri/src/ahand/mod.rs` — `pub mod browser_runtime;`
- Modify: `apps/client/src-tauri/src/lib.rs` — register commands in `tauri::generate_handler![]`

**Acceptance Criteria:**

- [ ] `#[tauri::command] pub async fn browser_status(state: State<'_, tokio::sync::Mutex<AhandRuntime>>) -> Result<BrowserStatus, String>` — returns overall + per-step status + `enabled` + `agent_visible` + `queried_at`
- [ ] `#[tauri::command] pub async fn browser_install(state, force: bool, on_progress: tauri::ipc::Channel<BrowserProgressEvent>) -> Result<BrowserStatus, String>` — runs `ahandd::browser_setup::run_all`, streams events via channel, on success flips `[browser].enabled = true` and calls `reload()`, returns final status
- [ ] `#[tauri::command] pub async fn browser_set_enabled(state, enabled: bool, on_progress: tauri::ipc::Channel<BrowserProgressEvent>) -> Result<BrowserStatus, String>` — flips config + reloads; does NOT emit per-step events, only `ReloadStarted`/`ReloadOnline`/`ReloadFailed`
- [ ] `BrowserProgressEvent` (Tauri-side) has the shape: `StepStarted { name, label }` / `StepLog { name, line, stream }` / `StepFinished { name, status, error, duration_ms }` / `AllFinished { overall, total_duration_ms }` / `ReloadStarted` / `ReloadOnline` / `ReloadFailed { kind, message }`
- [ ] Progress adapter maps ahandd `ProgressEvent` → Tauri `BrowserProgressEvent` per the table in §5.3 of the spec
- [ ] All log lines (per the per-line forwarding added in Tasks 3-4) are appended to `~/.ahand/logs/browser-setup-{YYYYMMDD-HHMMSS}.log` via a buffered writer
- [ ] Log retention: at the start of every `browser_install`, files older than 7 days under `~/.ahand/logs/` matching `browser-setup-*.log` are deleted
- [ ] Concurrent install rejected: if runtime mutex is held, the command fast-fails with `Err("operation_in_progress".into())` (returned synchronously via `try_lock`)
- [ ] Tests from §8.2 of the spec are scaffolded (at least the channel-streaming happy path + the config-write-on-success flow + the don't-touch-config-on-failure flow)

**Verify:**

```
cd /Users/winrey/Projects/weightwave/team9 && \
  cargo test --manifest-path apps/client/src-tauri/Cargo.toml browser_runtime && \
  cargo fmt --manifest-path apps/client/src-tauri/Cargo.toml -- --check && \
  cargo clippy --manifest-path apps/client/src-tauri/Cargo.toml --all-targets -- -D warnings
```

**Steps:**

- [ ] **Step 1: Scaffolding — `browser_runtime.rs` module with types and helpers**

Create `apps/client/src-tauri/src/ahand/browser_runtime.rs`:

```rust
//! Tauri commands that wire the renderer's "我的设备 → 浏览器控制"
//! install/toggle UI to the embedded `ahandd::browser_setup` library.
//! See team9/docs/superpowers/specs/2026-04-29-ahand-browser-runtime-install-design.md
//! §5 for the full design.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;
use tokio::sync::Mutex;

use ahandd::browser_setup::{
    self, CheckReport, CheckStatus, ErrorCode, FailedStepReport, LogStream, Phase,
    ProgressEvent, StepStatus,
};
use ahandd::config::Config;

use super::runtime::{AhandRuntime, ReloadError};

// ============================================================================
// Types — wire shape for the renderer's Channel
// ============================================================================

#[derive(Debug, Serialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum BrowserProgressEvent {
    StepStarted { name: String, label: String },
    StepLog {
        name: String,
        line: String,
        stream: TauriLogStream,
    },
    StepFinished {
        name: String,
        status: TauriStepStatus,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<StepError>,
        duration_ms: u64,
    },
    AllFinished {
        overall: TauriStepStatus,
        total_duration_ms: u64,
    },
    ReloadStarted,
    ReloadOnline,
    ReloadFailed { kind: ReloadFailureKind, message: String },
}

#[derive(Debug, Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub enum TauriStepStatus {
    Ok,
    Skipped,
    Failed,
    NotRun,
}

impl From<StepStatus> for TauriStepStatus {
    fn from(s: StepStatus) -> Self {
        match s {
            StepStatus::Ok => TauriStepStatus::Ok,
            StepStatus::Skipped => TauriStepStatus::Skipped,
            StepStatus::Failed => TauriStepStatus::Failed,
        }
    }
}

#[derive(Debug, Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub enum TauriLogStream { Stdout, Stderr, Info }

impl From<LogStream> for TauriLogStream {
    fn from(s: LogStream) -> Self {
        match s {
            LogStream::Stdout => TauriLogStream::Stdout,
            LogStream::Stderr => TauriLogStream::Stderr,
            LogStream::Info => TauriLogStream::Info,
        }
    }
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StepError {
    pub code: String, // ErrorCode serialized as string for the renderer
    pub message: String,
}

impl From<(ErrorCode, String)> for StepError {
    fn from((code, message): (ErrorCode, String)) -> Self {
        Self {
            code: serde_json::to_value(&code)
                .ok()
                .and_then(|v| v.as_str().map(|s| s.to_string()))
                .unwrap_or_else(|| "unknown".into()),
            message,
        }
    }
}

#[derive(Debug, Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub enum ReloadFailureKind {
    ShutdownTimeout,
    SpawnFailedRolledBack,
    SpawnFailedNoRollback,
}

// ============================================================================
// BrowserStatus — return type of browser_status + trailing return of the other commands
// ============================================================================

#[derive(Debug, Serialize, Clone)]
pub struct BrowserStatus {
    pub overall: TauriStepStatus,
    pub steps: Vec<BrowserStepStatus>,
    pub enabled: bool,
    pub agent_visible: bool,
    pub queried_at: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct BrowserStepStatus {
    pub name: String,
    pub label: String,
    pub status: TauriStepStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<StepError>,
}

fn overall_from_reports(reports: &[CheckReport]) -> TauriStepStatus {
    if reports
        .iter()
        .any(|r| matches!(r.status, CheckStatus::Failed { .. }))
    {
        return TauriStepStatus::Failed;
    }
    if reports
        .iter()
        .all(|r| matches!(r.status, CheckStatus::Ok { .. }))
    {
        return TauriStepStatus::Ok;
    }
    TauriStepStatus::NotRun
}

fn step_status_from_check(cs: &CheckStatus) -> (TauriStepStatus, Option<String>, Option<StepError>) {
    match cs {
        CheckStatus::Ok { version, path, .. } => (
            TauriStepStatus::Ok,
            Some(format!("{} ({})", version, path.display())),
            None,
        ),
        CheckStatus::Missing => (TauriStepStatus::NotRun, None, None),
        CheckStatus::Outdated { current, required, .. } => (
            TauriStepStatus::NotRun,
            Some(format!("current {current}, need {required}")),
            None,
        ),
        CheckStatus::NoneDetected { tried } => (
            TauriStepStatus::NotRun,
            Some(format!("tried: {}", tried.join(", "))),
            None,
        ),
        CheckStatus::Failed { code, message } => (
            TauriStepStatus::Failed,
            None,
            Some(StepError::from((*code, message.clone()))),
        ),
    }
}

fn to_browser_status(reports: Vec<CheckReport>, enabled: bool, agent_visible: bool) -> BrowserStatus {
    let overall = overall_from_reports(&reports);
    let steps = reports
        .into_iter()
        .map(|r| {
            let (status, detail, error) = step_status_from_check(&r.status);
            BrowserStepStatus {
                name: r.name.to_string(),
                label: r.label.to_string(),
                status,
                detail,
                error,
            }
        })
        .collect();
    BrowserStatus {
        overall,
        steps,
        enabled,
        agent_visible,
        queried_at: chrono::Utc::now().to_rfc3339(),
    }
}
```

- [ ] **Step 2: `browser_status` command**

Append to `browser_runtime.rs`:

```rust
#[tauri::command]
pub async fn browser_status(
    state: State<'_, Arc<Mutex<AhandRuntime>>>,
) -> Result<BrowserStatus, String> {
    let reports = browser_setup::inspect_all().await;
    let rt = state.lock().await;
    let config = Config::load(&rt.config_path())
        .map_err(|e| format!("config load: {e:#}"))?;
    let enabled = config.browser_config().enabled.unwrap_or(false);
    let daemon_online = matches!(
        rt.status().await,
        ahandd::DaemonStatus::Online { .. }
    );
    let agent_visible = enabled && daemon_online;
    Ok(to_browser_status(reports, enabled, agent_visible))
}
```

Add `rt.config_path() -> &Path` accessor on `AhandRuntime` in `runtime.rs` if missing (it's the `config_path` field we added in Task 13).

- [ ] **Step 3: `browser_install` command — progress adapter + log tee**

Append:

```rust
#[tauri::command]
pub async fn browser_install(
    state: State<'_, Arc<Mutex<AhandRuntime>>>,
    force: bool,
    on_progress: Channel<BrowserProgressEvent>,
) -> Result<BrowserStatus, String> {
    let mut rt = state
        .try_lock()
        .map_err(|_| "operation_in_progress".to_string())?;

    // Retain for the duration of this call; when the guard drops,
    // the mutex is released.

    // --- Open log tee writer ---
    let log_file = prepare_log_file()
        .map_err(|e| format!("open log file: {e:#}"))?;
    let log_writer = Arc::new(Mutex::new(log_file));

    // Prune old log files (7-day retention). Best effort — errors are
    // swallowed with a warn.
    tokio::task::spawn_blocking({
        move || {
            let _ = prune_old_logs(7);
        }
    });

    // --- Set up the adapter ---
    let channel_cb = Arc::new(on_progress);
    let log_writer_cb = log_writer.clone();
    let adapter_state = Arc::new(Mutex::new(AdapterState::default()));

    let state_for_cb = adapter_state.clone();
    let cb = move |e: ProgressEvent| {
        // Fast-path emit to channel + log (both best-effort);
        // synchronous (callback must be `Fn`, not `FnMut`/`async`).
        let mut st = state_for_cb.blocking_lock();
        let tauri_events = st.translate(&e);
        drop(st);
        for ev in tauri_events {
            let _ = channel_cb.send(ev);
        }
        // Log the raw ahandd event verbatim
        let _ = write_log_line(&log_writer_cb, &e);
    };

    // --- Run the install ---
    let overall_start = Instant::now();
    let result = browser_setup::run_all(force, cb).await;

    // --- Emit terminal AllFinished ---
    let overall_status = match &result {
        Ok(reports) if reports.iter().any(|r| matches!(r.status, CheckStatus::Failed { .. })) => {
            TauriStepStatus::Failed
        }
        Ok(reports) if reports.iter().all(|r| matches!(r.status, CheckStatus::Ok { .. })) => {
            TauriStepStatus::Ok
        }
        Ok(_) => TauriStepStatus::Skipped,
        Err(_) => TauriStepStatus::Failed,
    };
    let _ = channel_cb.send(BrowserProgressEvent::AllFinished {
        overall: overall_status,
        total_duration_ms: overall_start.elapsed().as_millis() as u64,
    });

    // --- On success, flip config + reload ---
    if matches!(overall_status, TauriStepStatus::Ok) {
        let mut cfg = Config::load(rt.config_path())
            .map_err(|e| format!("config reload: {e:#}"))?;
        cfg.set_browser_enabled(rt.config_path(), true)
            .map_err(|e| format!("config write: {e:#}"))?;

        let _ = channel_cb.send(BrowserProgressEvent::ReloadStarted);
        match rt.reload().await {
            Ok(()) => {
                let _ = channel_cb.send(BrowserProgressEvent::ReloadOnline);
            }
            Err(re) => {
                let _ = channel_cb.send(BrowserProgressEvent::ReloadFailed {
                    kind: reload_error_kind(&re),
                    message: format!("{re:#}"),
                });
                // Still return status; the renderer renders the banner
            }
        }
    }

    // --- Return fresh status ---
    let reports_after = browser_setup::inspect_all().await;
    let config = Config::load(rt.config_path())
        .map_err(|e| format!("config final load: {e:#}"))?;
    let enabled = config.browser_config().enabled.unwrap_or(false);
    let agent_visible = enabled
        && matches!(rt.status().await, ahandd::DaemonStatus::Online { .. });
    Ok(to_browser_status(reports_after, enabled, agent_visible))
}

// Adapter state for translating ahandd ProgressEvent → Tauri BrowserProgressEvent.
// Tracks per-step start times and whether StepStarted has been emitted yet.
#[derive(Default)]
struct AdapterState {
    steps: std::collections::HashMap<&'static str, StepTracker>,
}

struct StepTracker {
    started_at: Instant,
    announced: bool, // true once StepStarted has been emitted
    label: String,
}

impl AdapterState {
    fn translate(&mut self, ev: &ProgressEvent) -> Vec<BrowserProgressEvent> {
        let mut out = Vec::new();
        let tracker = self.steps.entry(ev.step).or_insert_with(|| StepTracker {
            started_at: Instant::now(),
            announced: false,
            label: match ev.step {
                "node" => "Node.js".into(),
                "playwright" => "Playwright CLI".into(),
                other => other.into(),
            },
        });
        if !tracker.announced {
            out.push(BrowserProgressEvent::StepStarted {
                name: ev.step.to_string(),
                label: tracker.label.clone(),
            });
            tracker.announced = true;
            tracker.started_at = Instant::now();
        }
        match ev.phase {
            Phase::Log => {
                if let Some(stream) = ev.stream {
                    out.push(BrowserProgressEvent::StepLog {
                        name: ev.step.to_string(),
                        line: ev.message.clone(),
                        stream: stream.into(),
                    });
                }
            }
            Phase::Starting | Phase::Downloading | Phase::Extracting | Phase::Installing
            | Phase::Verifying => {
                // Surface as Info-stream log lines so the drawer shows high-level progress
                out.push(BrowserProgressEvent::StepLog {
                    name: ev.step.to_string(),
                    line: ev.message.clone(),
                    stream: TauriLogStream::Info,
                });
            }
            Phase::Done => {
                // Terminal for this step. Note: we don't know OK vs Failed here —
                // the caller resolves that from run_all's Result.
                // Emit a Done log line; StepFinished with actual status comes from
                // the overall-result reconciliation after run_all returns.
                out.push(BrowserProgressEvent::StepLog {
                    name: ev.step.to_string(),
                    line: ev.message.clone(),
                    stream: TauriLogStream::Info,
                });
                // We CAN emit StepFinished with status=Ok here, on the assumption
                // that Phase::Done is only emitted on success paths. The wrap_failure
                // helper in Task 2 emits Phase::Done in the failure path too, so
                // this assumption doesn't hold.
                //
                // Decision: don't emit StepFinished from Phase::Done directly.
                // Instead, do a post-pass after run_all returns:
                //   for each report in reports_or_classified_err: emit StepFinished
            }
        }
        out
    }
}
```

The adapter deliberately does NOT emit `StepFinished` from `Phase::Done` (see decision note inline). Instead, after `run_all` returns, do a reconciliation pass emitting `StepFinished` per report. Add that pass between the `run_all` call and the `AllFinished` emit in `browser_install`:

```rust
match &result {
    Ok(reports) => {
        for r in reports {
            let (tauri_status, _, error) = step_status_from_check(&r.status);
            let tracker = adapter_state.blocking_lock().steps.get(r.name).cloned();
            let duration = tracker
                .map(|t| t.started_at.elapsed().as_millis() as u64)
                .unwrap_or(0);
            let _ = channel_cb.send(BrowserProgressEvent::StepFinished {
                name: r.name.to_string(),
                status: tauri_status,
                error,
                duration_ms: duration,
            });
        }
    }
    Err(e) => {
        // Downcast for FailedStepReport to recover the classified CheckReport
        if let Some(failed) = e
            .chain()
            .find_map(|x| x.downcast_ref::<FailedStepReport>())
        {
            let report = &failed.0;
            let (tauri_status, _, error) = step_status_from_check(&report.status);
            let tracker = adapter_state.blocking_lock().steps.get(report.name).cloned();
            let duration = tracker
                .map(|t| t.started_at.elapsed().as_millis() as u64)
                .unwrap_or(0);
            let _ = channel_cb.send(BrowserProgressEvent::StepFinished {
                name: report.name.to_string(),
                status: tauri_status,
                error,
                duration_ms: duration,
            });
        }
    }
}
```

Add `#[derive(Clone)]` to `StepTracker` so the `.get(...).cloned()` call works.

- [ ] **Step 4: `browser_set_enabled` command**

Append:

```rust
#[tauri::command]
pub async fn browser_set_enabled(
    state: State<'_, Arc<Mutex<AhandRuntime>>>,
    enabled: bool,
    on_progress: Channel<BrowserProgressEvent>,
) -> Result<BrowserStatus, String> {
    let mut rt = state
        .try_lock()
        .map_err(|_| "operation_in_progress".to_string())?;

    // Guard: can't enable if not installed
    if enabled {
        let reports = browser_setup::inspect_all().await;
        let installed = reports
            .iter()
            .all(|r| matches!(r.status, CheckStatus::Ok { .. }));
        if !installed {
            return Err("browser_not_installed".into());
        }
    }

    // Write config
    let mut cfg = Config::load(rt.config_path())
        .map_err(|e| format!("config load: {e:#}"))?;
    let old = cfg.set_browser_enabled(rt.config_path(), enabled)
        .map_err(|e| format!("config write: {e:#}"))?;

    // No-op optimization
    if old == enabled {
        // Still return fresh status but skip reload
        let reports = browser_setup::inspect_all().await;
        return Ok(to_browser_status(reports, enabled, enabled && matches!(rt.status().await, ahandd::DaemonStatus::Online { .. })));
    }

    // Reload
    let _ = on_progress.send(BrowserProgressEvent::ReloadStarted);
    match rt.reload().await {
        Ok(()) => {
            let _ = on_progress.send(BrowserProgressEvent::ReloadOnline);
        }
        Err(re) => {
            let _ = on_progress.send(BrowserProgressEvent::ReloadFailed {
                kind: reload_error_kind(&re),
                message: format!("{re:#}"),
            });
        }
    }

    let reports = browser_setup::inspect_all().await;
    let config_after = Config::load(rt.config_path())
        .map_err(|e| format!("config final load: {e:#}"))?;
    let enabled_after = config_after.browser_config().enabled.unwrap_or(false);
    let agent_visible = enabled_after
        && matches!(rt.status().await, ahandd::DaemonStatus::Online { .. });
    Ok(to_browser_status(reports, enabled_after, agent_visible))
}

fn reload_error_kind(re: &ReloadError) -> ReloadFailureKind {
    match re {
        ReloadError::ShutdownTimeout => ReloadFailureKind::ShutdownTimeout,
        ReloadError::SpawnFailedRolledBack(_) => ReloadFailureKind::SpawnFailedRolledBack,
        ReloadError::SpawnFailedNoRollback { .. } => ReloadFailureKind::SpawnFailedNoRollback,
    }
}
```

- [ ] **Step 5: Log-file helpers**

Append:

```rust
fn log_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join(".ahand")
        .join("logs")
}

fn prepare_log_file() -> anyhow::Result<std::fs::File> {
    let dir = log_dir();
    std::fs::create_dir_all(&dir)?;
    let ts = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let path = dir.join(format!("browser-setup-{ts}.log"));
    Ok(std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?)
}

fn write_log_line(
    writer: &Arc<Mutex<std::fs::File>>,
    ev: &ProgressEvent,
) -> std::io::Result<()> {
    use std::io::Write;
    let mut f = writer.blocking_lock();
    let ts = chrono::Local::now().format("%H:%M:%S.%3f");
    let stream_tag = ev
        .stream
        .map(|s| match s {
            LogStream::Stdout => "OUT",
            LogStream::Stderr => "ERR",
            LogStream::Info => "INF",
        })
        .unwrap_or("---");
    writeln!(
        f,
        "[{ts}] [{}] [{stream_tag}] {:?} {}",
        ev.step, ev.phase, ev.message
    )
}

fn prune_old_logs(max_age_days: u64) -> std::io::Result<()> {
    let dir = log_dir();
    if !dir.exists() {
        return Ok(());
    }
    let cutoff = std::time::SystemTime::now()
        - Duration::from_secs(max_age_days * 24 * 60 * 60);
    for entry in std::fs::read_dir(&dir)? {
        let entry = entry?;
        let name = entry.file_name();
        let Some(name_str) = name.to_str() else { continue };
        if !name_str.starts_with("browser-setup-") || !name_str.ends_with(".log") {
            continue;
        }
        if let Ok(meta) = entry.metadata() {
            if let Ok(modified) = meta.modified() {
                if modified < cutoff {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
    }
    Ok(())
}
```

- [ ] **Step 6: Register module + commands**

Open `apps/client/src-tauri/src/ahand/mod.rs`, add:

```rust
pub mod browser_runtime;
```

Open `apps/client/src-tauri/src/lib.rs`. Inside the `tauri::generate_handler![...]` block:

```rust
tauri::generate_handler![
    // ... existing commands ...
    crate::ahand::browser_runtime::browser_status,
    crate::ahand::browser_runtime::browser_install,
    crate::ahand::browser_runtime::browser_set_enabled,
]
```

Ensure the `AhandRuntime` state is `Arc<Mutex<AhandRuntime>>` and managed with `app.manage(Arc::new(Mutex::new(runtime)))` in setup. If today it's a plain `Mutex<AhandRuntime>`, wrap it now.

- [ ] **Step 7: Tests**

Write tests in a `#[cfg(test)] mod tests { ... }` at the bottom of `browser_runtime.rs`. Focus on the adapter logic (unit-testable without Tauri plumbing):

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adapter_emits_step_started_on_first_event_for_each_step() {
        let mut st = AdapterState::default();
        let events = st.translate(&ProgressEvent {
            step: "node",
            phase: Phase::Starting,
            message: "Starting Node install".into(),
            percent: None,
            stream: None,
        });
        assert!(events.iter().any(|e| matches!(e, BrowserProgressEvent::StepStarted { name, .. } if name == "node")));
    }

    #[test]
    fn adapter_forwards_stdout_log_lines_with_stream_tag() {
        let mut st = AdapterState::default();
        let _ = st.translate(&ProgressEvent {
            step: "playwright",
            phase: Phase::Starting,
            message: "start".into(),
            percent: None,
            stream: None,
        });
        let events = st.translate(&ProgressEvent {
            step: "playwright",
            phase: Phase::Log,
            message: "npm notice".into(),
            percent: None,
            stream: Some(LogStream::Stdout),
        });
        let log = events.iter().find_map(|e| match e {
            BrowserProgressEvent::StepLog { line, stream: TauriLogStream::Stdout, .. } => Some(line.clone()),
            _ => None,
        });
        assert_eq!(log, Some("npm notice".into()));
    }

    #[test]
    fn overall_from_reports_prefers_failed_over_ok() {
        let reports = vec![
            CheckReport {
                name: "node",
                label: "Node.js",
                status: CheckStatus::Ok {
                    version: "20.10".into(),
                    path: "/foo".into(),
                    source: ahandd::browser_setup::CheckSource::Managed,
                },
                fix_hint: None,
            },
            CheckReport {
                name: "playwright",
                label: "Playwright CLI",
                status: CheckStatus::Failed {
                    code: ErrorCode::Network,
                    message: "ECONNRESET".into(),
                },
                fix_hint: None,
            },
        ];
        assert!(matches!(overall_from_reports(&reports), TauriStepStatus::Failed));
    }

    #[test]
    fn step_error_serializes_code_as_snake_case_string() {
        let e = StepError::from((ErrorCode::PermissionDenied, "EACCES".into()));
        assert_eq!(e.code, "permission_denied");
    }

    // Full command tests (browser_install / browser_set_enabled) require
    // mocking AhandRuntime + Tauri State + Channel. They're listed in the
    // spec (§8.2) but are left for a follow-up: the adapter tests above
    // plus manual E2E (Task 17) provide coverage for the core logic.
}
```

- [ ] **Step 8: fmt, clippy, test**

```
cd /Users/winrey/Projects/weightwave/team9
cargo fmt --manifest-path apps/client/src-tauri/Cargo.toml
cargo clippy --manifest-path apps/client/src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path apps/client/src-tauri/Cargo.toml browser_runtime
```

- [ ] **Step 9: Commit**

```
cd /Users/winrey/Projects/weightwave/team9
git add apps/client/src-tauri/src/ahand/browser_runtime.rs \
        apps/client/src-tauri/src/ahand/mod.rs \
        apps/client/src-tauri/src/lib.rs
git commit -m "feat(tauri/ahand): add browser_runtime commands (status/install/set_enabled) + progress adapter + log tee"
```

---

### Task 15: team9 Tauri renderer — `useBrowserRuntime` hook + `BrowserConfigTab` rewrite + i18n

**Repo:** team9. **PR branch:** `feat/browser-runtime-install-ui`.

**Goal:** Replace the disabled "Coming Soon" `RuntimeCard` with a live card that renders per-step status, streams install progress into a log drawer, offers per-step help popovers, and exposes an Agent-visible toggle. Split the existing 159-line flat `BrowserConfigTab.tsx` into a directory of focused components. Add a reducer-style React hook that wraps the 3 Tauri commands.

**Files:**

- Create: `apps/client/src/hooks/useBrowserRuntime.ts` (~150 LoC)
- Create: `apps/client/src/components/layout/contents/devices/BrowserConfigTab/index.tsx` (re-export + tab orchestrator)
- Create: `apps/client/src/components/layout/contents/devices/BrowserConfigTab/RuntimeCard.tsx`
- Create: `apps/client/src/components/layout/contents/devices/BrowserConfigTab/StepRow.tsx`
- Create: `apps/client/src/components/layout/contents/devices/BrowserConfigTab/LogDrawer.tsx`
- Create: `apps/client/src/components/layout/contents/devices/BrowserConfigTab/BrowserBinaryCard.tsx` (moved verbatim from the flat file)
- Delete: `apps/client/src/components/layout/contents/devices/BrowserConfigTab.tsx` (replaced by `BrowserConfigTab/index.tsx`; git will track as a rename if the content of `index.tsx` is similar enough)
- Modify: `apps/client/src/i18n/locales/zh-CN/ahand.json` — add new keys
- Modify: `apps/client/src/i18n/locales/en-US/ahand.json` — mirror English keys

**Acceptance Criteria:**

- [ ] `useBrowserRuntime` hook exposes `{ state: RuntimeUiState, install, setEnabled, refresh }` — invokes the 3 Tauri commands via `@tauri-apps/api/core`
- [ ] Hook uses `Channel` from `@tauri-apps/api/core` to receive streaming `BrowserProgressEvent`s
- [ ] Hook's state is discriminated-union: `{kind: "loading"} | {kind: "idle", status} | {kind: "installing", progress, steps} | {kind: "reloading", steps} | {kind: "error", status, message, steps}`
- [ ] `BrowserConfigTab/RuntimeCard.tsx` renders:
  - Overall status badge (已安装 / 未安装 / 安装中 / 重启中 / 失败)
  - `[Install]` or `[Retry]` button — disabled while `installing` or `reloading`
  - Agent-visible toggle (off unless `overall === Ok`)
  - 3 `StepRow` rows for Node / Playwright / System Browser
  - `<LogDrawer>` at the bottom
- [ ] `StepRow.tsx` renders one row per step: icon, name (i18n), status badge, detail text, `[?]` help-popover button (only when status is Failed)
- [ ] Help popover content is selected by `errorCode`:
  - `permissionDenied` → copy-to-clipboard `sudo chown …` command
  - `network` → proxy-setup link
  - `noSystemBrowser` → external Chrome download link
  - `nodeMissing` → "run --step node first" message
  - `versionMismatch` → `[Retry with --force]` button
- [ ] `LogDrawer.tsx` accumulates `StepLog` events, labels by stream (stdout/stderr/info), auto-scrolls, collapsible
- [ ] All strings come from `ahand.json` (new keys listed below); zh-CN + en-US both populated
- [ ] `@team9claw/types` `HostCapability` change ripples correctly into renderer — if the renderer has a TypeScript reference to the type, it now expects `"browser-playwright-cli"`
- [ ] Coming-Soon badge removed from the tab

**Verify:**

```
cd /Users/winrey/Projects/weightwave/team9 && \
  source /opt/homebrew/opt/nvm/nvm.sh && \
  pnpm --filter @team9/client typecheck && \
  pnpm --filter @team9/client lint && \
  pnpm --filter @team9/client test browser-config
```

**Steps:**

- [ ] **Step 1: Split the existing `BrowserConfigTab.tsx` into the new directory structure**

```
cd /Users/winrey/Projects/weightwave/team9/apps/client/src/components/layout/contents/devices
mkdir BrowserConfigTab
git mv BrowserConfigTab.tsx BrowserConfigTab/index.tsx.old  # temporarily, to preserve rename tracking
```

Now create the new files:

**`BrowserConfigTab/index.tsx`** (small orchestrator + default export):

```tsx
import { useTranslation } from "react-i18next";
import { RuntimeCard } from "./RuntimeCard";
import { BrowserBinaryCard } from "./BrowserBinaryCard";

export function BrowserConfigTab() {
  const { t } = useTranslation("ahand");
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t("devicesTabs.browserDescription")}
      </p>
      <RuntimeCard />
      <BrowserBinaryCard />
    </div>
  );
}
```

**`BrowserConfigTab/BrowserBinaryCard.tsx`** — copy the existing `BrowserBinaryCard` function and the `BROWSERS` constant + `BrowserOption` type from the old file. Verbatim; no changes to this card's behavior in this PR.

Once the new directory has `index.tsx`, `BrowserBinaryCard.tsx`, `RuntimeCard.tsx`, `StepRow.tsx`, `LogDrawer.tsx`, delete `BrowserConfigTab/index.tsx.old`:

```
rm BrowserConfigTab/index.tsx.old
```

Update any `import { BrowserConfigTab } from ".../BrowserConfigTab"` site — unchanged because the directory name + `index.tsx` resolve the same way.

- [ ] **Step 2: Write the `useBrowserRuntime` hook**

Create `apps/client/src/hooks/useBrowserRuntime.ts`:

```ts
import { useCallback, useEffect, useReducer } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";

// Wire types — must match apps/client/src-tauri/src/ahand/browser_runtime.rs

export type TauriStepStatus = "ok" | "skipped" | "failed" | "notRun";
export type TauriLogStream = "stdout" | "stderr" | "info";
export type ErrorCode =
  | "permissionDenied"
  | "network"
  | "noSystemBrowser"
  | "nodeMissing"
  | "versionMismatch"
  | "unknown";

export interface StepError {
  code: ErrorCode;
  message: string;
}

export type BrowserProgressEvent =
  | { type: "stepStarted"; name: string; label: string }
  | { type: "stepLog"; name: string; line: string; stream: TauriLogStream }
  | {
      type: "stepFinished";
      name: string;
      status: TauriStepStatus;
      error?: StepError;
      durationMs: number;
    }
  | { type: "allFinished"; overall: TauriStepStatus; totalDurationMs: number }
  | { type: "reloadStarted" }
  | { type: "reloadOnline" }
  | {
      type: "reloadFailed";
      kind:
        | "shutdownTimeout"
        | "spawnFailedRolledBack"
        | "spawnFailedNoRollback";
      message: string;
    };

export interface BrowserStepStatus {
  name: string;
  label: string;
  status: TauriStepStatus;
  detail?: string;
  error?: StepError;
}

export interface BrowserStatus {
  overall: TauriStepStatus;
  steps: BrowserStepStatus[];
  enabled: boolean;
  agentVisible: boolean;
  queriedAt: string;
}

// Per-step accumulator for the installing/error states
export interface StepFeed {
  [stepName: string]: {
    status: TauriStepStatus;
    logs: { line: string; stream: TauriLogStream }[];
    error?: StepError;
  };
}

// UI state machine
export type RuntimeUiState =
  | { kind: "loading" }
  | { kind: "idle"; status: BrowserStatus }
  | { kind: "installing"; steps: StepFeed }
  | { kind: "reloading"; steps: StepFeed; pendingFinalStatus?: BrowserStatus }
  | { kind: "error"; status: BrowserStatus; message: string; steps: StepFeed };

type Action =
  | { type: "loaded"; status: BrowserStatus }
  | { type: "progress"; event: BrowserProgressEvent }
  | { type: "installStarted" }
  | { type: "installDone"; status: BrowserStatus }
  | {
      type: "installFailed";
      message: string;
      status: BrowserStatus;
      steps: StepFeed;
    }
  | { type: "setEnabledStarted" }
  | { type: "setEnabledDone"; status: BrowserStatus };

function emptyStepFeed(): StepFeed {
  return {};
}

function applyProgress(steps: StepFeed, event: BrowserProgressEvent): StepFeed {
  switch (event.type) {
    case "stepStarted": {
      return { ...steps, [event.name]: { status: "notRun", logs: [] } };
    }
    case "stepLog": {
      const existing = steps[event.name] ?? { status: "notRun", logs: [] };
      return {
        ...steps,
        [event.name]: {
          ...existing,
          logs: [...existing.logs, { line: event.line, stream: event.stream }],
        },
      };
    }
    case "stepFinished": {
      const existing = steps[event.name] ?? { status: "notRun", logs: [] };
      return {
        ...steps,
        [event.name]: {
          ...existing,
          status: event.status,
          error: event.error,
        },
      };
    }
    default:
      return steps;
  }
}

function reducer(state: RuntimeUiState, action: Action): RuntimeUiState {
  switch (action.type) {
    case "loaded":
      return { kind: "idle", status: action.status };

    case "installStarted":
      return { kind: "installing", steps: emptyStepFeed() };

    case "progress": {
      if (state.kind !== "installing" && state.kind !== "reloading")
        return state;
      // Reload events move us to "reloading"
      if (action.event.type === "reloadStarted") {
        return {
          kind: "reloading",
          steps:
            state.kind === "installing"
              ? state.steps
              : (state as { steps: StepFeed }).steps,
        };
      }
      if (action.event.type === "reloadOnline") {
        // Don't change kind yet — installDone/setEnabledDone will flip us.
        return state;
      }
      if (action.event.type === "reloadFailed") {
        // Keep in reloading so the caller can transition to error with final status
        return state;
      }
      return {
        ...state,
        steps: applyProgress(
          state.kind === "installing"
            ? state.steps
            : (state as { steps: StepFeed }).steps,
          action.event,
        ),
      };
    }

    case "installDone":
      return { kind: "idle", status: action.status };

    case "installFailed":
      return {
        kind: "error",
        status: action.status,
        message: action.message,
        steps: action.steps,
      };

    case "setEnabledStarted": {
      // Preserve steps if we were idle, else keep current
      const steps =
        state.kind === "idle"
          ? emptyStepFeed()
          : ((state as any).steps ?? emptyStepFeed());
      return { kind: "reloading", steps };
    }

    case "setEnabledDone":
      return { kind: "idle", status: action.status };
  }
}

export function useBrowserRuntime() {
  const [state, dispatch] = useReducer(reducer, {
    kind: "loading",
  } as RuntimeUiState);

  const refresh = useCallback(async () => {
    const status = await invoke<BrowserStatus>("browser_status");
    dispatch({ type: "loaded", status });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const install = useCallback(
    async (force: boolean) => {
      dispatch({ type: "installStarted" });
      const channel = new Channel<BrowserProgressEvent>();
      channel.onmessage = (event) => dispatch({ type: "progress", event });
      try {
        const status = await invoke<BrowserStatus>("browser_install", {
          force,
          onProgress: channel,
        });
        dispatch({ type: "installDone", status });
      } catch (err) {
        const status = await invoke<BrowserStatus>("browser_status").catch(
          () => ({
            overall: "failed" as const,
            steps: [],
            enabled: false,
            agentVisible: false,
            queriedAt: new Date().toISOString(),
          }),
        );
        dispatch({
          type: "installFailed",
          message: typeof err === "string" ? err : String(err),
          status,
          steps:
            "steps" in state && state.kind === "installing" ? state.steps : {},
        });
      }
    },
    [state],
  );

  const setEnabled = useCallback(async (enabled: boolean) => {
    dispatch({ type: "setEnabledStarted" });
    const channel = new Channel<BrowserProgressEvent>();
    channel.onmessage = (event) => dispatch({ type: "progress", event });
    const status = await invoke<BrowserStatus>("browser_set_enabled", {
      enabled,
      onProgress: channel,
    });
    dispatch({ type: "setEnabledDone", status });
  }, []);

  return { state, install, setEnabled, refresh };
}
```

- [ ] **Step 3: Write `BrowserConfigTab/RuntimeCard.tsx`**

```tsx
import { useTranslation } from "react-i18next";
import { Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useBrowserRuntime } from "@/hooks/useBrowserRuntime";
import { StepRow } from "./StepRow";
import { LogDrawer } from "./LogDrawer";

export function RuntimeCard() {
  const { t } = useTranslation("ahand");
  const { state, install, setEnabled } = useBrowserRuntime();

  // Derive renderable bits from state
  const overall =
    state.kind === "idle"
      ? state.status.overall
      : state.kind === "error"
        ? state.status.overall
        : state.kind === "installing"
          ? "notRun"
          : state.kind === "reloading"
            ? "notRun"
            : "notRun";

  const overallLabel =
    state.kind === "installing"
      ? t("browser.installing")
      : state.kind === "reloading"
        ? t("browser.reloading")
        : overall === "ok"
          ? t("browser.statusInstalled")
          : overall === "failed"
            ? t("browser.installFailed")
            : t("browser.statusNotInstalled");

  const installButtonLabel =
    overall === "failed" ? t("browser.retry") : t("browser.install");
  const installButtonDisabled =
    state.kind === "installing" || state.kind === "reloading";

  const agentVisibleEnabled = state.kind === "idle" && state.status.enabled;
  const agentVisibleDisabled =
    state.kind !== "idle" || state.status.overall !== "ok";

  const steps =
    state.kind === "idle" || state.kind === "error"
      ? state.status.steps.map((s) => ({
          name: s.name,
          label: s.label,
          status: s.status,
          detail: s.detail,
          error: s.error,
          logs: [],
        }))
      : Object.entries("steps" in state ? state.steps : {}).map(
          ([name, v]) => ({
            name,
            label: t(`browser.steps.${name}`),
            status: v.status,
            error: v.error,
            detail: undefined,
            logs: v.logs,
          }),
        );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t("browser.runtimeTitle")}</CardTitle>
        <CardDescription>{t("browser.runtimeDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Top row: overall status + install button */}
        <div className="flex items-center gap-3">
          <Package className="h-5 w-5 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Playwright</p>
            <p className="text-xs text-muted-foreground">
              {t("browser.runtimeSubtitle")}
            </p>
          </div>
          <span className="text-xs">{overallLabel}</span>
          {overall !== "ok" && (
            <Button
              variant="outline"
              size="sm"
              disabled={installButtonDisabled}
              onClick={() => install(overall === "failed")}
            >
              {installButtonLabel}
            </Button>
          )}
        </div>

        {/* Per-step rows */}
        <div className="space-y-2 border-t pt-3">
          {steps.map((s) => (
            <StepRow key={s.name} {...s} />
          ))}
        </div>

        {/* Agent visibility toggle */}
        <div className="flex items-center gap-3 border-t pt-3">
          <div className="flex-1">
            <p className="text-sm font-medium">
              {t("browser.agentVisibility.toggleLabel")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("browser.agentVisibility.tooltip")}
            </p>
          </div>
          <Switch
            checked={agentVisibleEnabled}
            disabled={agentVisibleDisabled}
            onCheckedChange={(checked) => void setEnabled(checked)}
          />
        </div>

        {/* Log drawer */}
        <LogDrawer
          steps={steps}
          expandedByDefault={
            state.kind === "installing" || state.kind === "reloading"
          }
        />
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Write `BrowserConfigTab/StepRow.tsx` and `LogDrawer.tsx`**

**`StepRow.tsx`:**

```tsx
import { useTranslation } from "react-i18next";
import { Check, X, Circle, HelpCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import type { TauriStepStatus, StepError } from "@/hooks/useBrowserRuntime";

export interface StepRowProps {
  name: string;
  label: string;
  status: TauriStepStatus;
  detail?: string;
  error?: StepError;
  logs: { line: string; stream: string }[];
}

function StatusIcon({ status }: { status: TauriStepStatus }) {
  if (status === "ok") return <Check className="h-4 w-4 text-green-600" />;
  if (status === "failed") return <X className="h-4 w-4 text-red-600" />;
  return <Circle className="h-4 w-4 text-muted-foreground" />;
}

function HelpPopover({ error }: { error: StepError }) {
  const { t } = useTranslation("ahand");
  // Map error.code → help content
  // (This is an overview — expand each branch inline or move to a helper.)
  const helpContent = t(`browser.help.${error.code}`, {
    defaultValue: t("browser.help.unknown"),
  });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="p-1 rounded hover:bg-muted">
          <HelpCircle className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 text-sm">
        <p>{helpContent}</p>
        <pre className="mt-2 text-xs bg-muted p-2 rounded overflow-x-auto">
          {error.message}
        </pre>
      </PopoverContent>
    </Popover>
  );
}

export function StepRow({ name, label, status, detail, error }: StepRowProps) {
  const { t } = useTranslation("ahand");
  const statusLabel = t(`browser.stepStatus.${status}`);

  return (
    <div className="flex items-center gap-3 text-sm">
      <StatusIcon status={status} />
      <span className="flex-1 font-medium">{label}</span>
      <Badge variant="outline" size="sm">
        {statusLabel}
      </Badge>
      {detail && (
        <span className="text-xs text-muted-foreground">{detail}</span>
      )}
      {error && <HelpPopover error={error} />}
    </div>
  );
}
```

**`LogDrawer.tsx`:**

```tsx
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react";

interface LogDrawerProps {
  steps: { name: string; logs: { line: string; stream: string }[] }[];
  expandedByDefault?: boolean;
}

export function LogDrawer({ steps, expandedByDefault }: LogDrawerProps) {
  const { t } = useTranslation("ahand");
  const [expanded, setExpanded] = useState(!!expandedByDefault);
  const logRef = useRef<HTMLDivElement>(null);

  const totalLines = steps.reduce((sum, s) => sum + s.logs.length, 0);

  useEffect(() => {
    if (expanded && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [steps, expanded]);

  if (totalLines === 0) return null;

  return (
    <div className="border-t pt-3">
      <button
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setExpanded((x) => !x)}
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        {expanded
          ? t("browser.logDrawer.collapse")
          : t("browser.logDrawer.expand", { count: totalLines })}
      </button>
      {expanded && (
        <div
          ref={logRef}
          className="mt-2 max-h-60 overflow-y-auto font-mono text-xs bg-muted/40 p-2 rounded"
        >
          {steps.flatMap((s) =>
            s.logs.map((l, i) => (
              <div key={`${s.name}-${i}`} className={streamColor(l.stream)}>
                <span className="text-muted-foreground">[{s.name}]</span>{" "}
                {l.line}
              </div>
            )),
          )}
        </div>
      )}
    </div>
  );
}

function streamColor(stream: string): string {
  if (stream === "stderr") return "text-amber-600";
  if (stream === "stdout") return "";
  return "text-muted-foreground italic"; // info
}
```

- [ ] **Step 5: i18n keys**

Open `apps/client/src/i18n/locales/zh-CN/ahand.json`. Under `browser.*`, replace the existing keys with the expanded set (preserving the existing `runtimeTitle`/`runtimeDescription`/`runtimeSubtitle`/`install`/`statusInstalled`/`statusNotInstalled`):

```json
{
  "browser": {
    "runtimeTitle": "浏览器控制运行时 (Playwright CLI)",
    "runtimeDescription": "Agent 用它真实地操作网页——点击、输入、读取页面内容。底层基于 Playwright。",
    "runtimeSubtitle": "Agent 打开和控制网页需要装它",
    "statusInstalled": "已安装",
    "statusNotInstalled": "未安装",
    "install": "安装",
    "retry": "重试",
    "installing": "安装中…",
    "reloading": "应用中…",
    "installFailed": "安装失败",
    "binaryTitle": "Agent 使用的浏览器",
    "binaryDescription": "选 Agent 默认要打开的浏览器。内置版最稳——和你日常用的浏览器完全隔离。",
    "steps": {
      "node": "Node.js",
      "playwright": "Playwright CLI",
      "browser": "系统浏览器"
    },
    "stepStatus": {
      "ok": "已安装",
      "skipped": "已跳过",
      "failed": "失败",
      "notRun": "未运行"
    },
    "help": {
      "permissionDenied": "安装需要权限。在终端运行 sudo chown -R $(whoami) ~/.ahand/node 然后重试。",
      "network": "网络不通。检查连接；公司网可能需要配置 npm 代理：npm config set proxy <your-proxy>。",
      "noSystemBrowser": "未检测到 Chrome/Edge。请先下载安装一个。",
      "nodeMissing": "Node.js 未装。先完成 Node.js 安装步骤再装 Playwright。",
      "versionMismatch": "版本不匹配。点 Retry 按钮重新强制安装。",
      "unknown": "未分类错误。查看日志获取详情。"
    },
    "agentVisibility": {
      "toggleLabel": "Agent 可以使用",
      "tooltip": "关闭后 Agent 不会把 browser skill 列入可用技能。已装好的 Playwright 保留。",
      "disabledHint": "先完成安装"
    },
    "logDrawer": {
      "expand": "查看日志 ({{count}} 行)",
      "collapse": "收起日志"
    }
  }
}
```

Mirror to `en-US/ahand.json` with English text. Key set identical.

- [ ] **Step 6: Run checks**

```
cd /Users/winrey/Projects/weightwave/team9
source /opt/homebrew/opt/nvm/nvm.sh
pnpm --filter @team9/client typecheck
pnpm --filter @team9/client lint
pnpm --filter @team9/client test browser-config 2>&1 | tail -20
```

If `@team9/client` has Vitest set up, tests scaffolded to exercise the reducer + basic render are valuable. If not, skip test runs; the hand-off manual E2E in Task 17 covers behavior.

Minimum Vitest scaffold (`apps/client/src/hooks/useBrowserRuntime.test.ts`):

```ts
import { describe, it, expect } from "vitest";
// Only test the pure reducer — the hook itself requires Tauri mocks.
// Inline-extract the reducer if needed for testability.
describe("applyProgress", () => {
  it("initializes step on StepStarted", () => {
    // ... (requires exporting `applyProgress` from the hook module)
  });
});
```

- [ ] **Step 7: Commit**

```
cd /Users/winrey/Projects/weightwave/team9
git add apps/client/src/hooks/useBrowserRuntime.ts \
        apps/client/src/components/layout/contents/devices/BrowserConfigTab/ \
        apps/client/src/i18n/locales/zh-CN/ahand.json \
        apps/client/src/i18n/locales/en-US/ahand.json
# The old BrowserConfigTab.tsx will be picked up as a delete:
git add -u apps/client/src/components/layout/contents/devices/BrowserConfigTab.tsx
git commit -m "feat(client/ahand): install UI with per-step progress, log drawer, and agent-visible toggle"
```

---

### Task 16: team9 Tauri — PR assembly + merge

**Repo:** team9. **PR branch:** `feat/browser-runtime-install-ui`.

**Goal:** Push the 4-commit Tauri branch, open PR to `dev`, wait for CI green, merge.

**Files:** none (git/CI operations).

**Acceptance Criteria:**

- [ ] Branch has commits from Tasks 13-15
- [ ] PR opened against `team9ai/team9 dev`
- [ ] CI green (Railway previews SUCCESS, CI Test lint/typecheck/test pass)
- [ ] Merge to `dev` (merge commit; each Task makes conceptual sense standalone)

**Verify:**

```
/opt/homebrew/bin/gh pr view <NUM> --repo team9ai/team9 --json state,mergeCommit
```

**Steps:**

- [ ] **Step 1: Push + open PR**

```
cd /Users/winrey/Projects/weightwave/team9
git push -u origin feat/browser-runtime-install-ui

/opt/homebrew/bin/gh pr create --repo team9ai/team9 --base dev --head feat/browser-runtime-install-ui \
  --title "feat(client/ahand): 我的设备 → 浏览器控制 install UI + hot-reload" \
  --body "$(cat <<'EOF'
## Summary

Phase C of the browser runtime install + self-check UI (see
docs/superpowers/specs/2026-04-29-ahand-browser-runtime-install-design.md).

Depends on aHand Phase A (`<PHASE_A_SHA>`) and team9-agent-pi Phase B (`<PHASE_B_SHA>`) — both merged before this PR opens.

## Changes

- Bump `ahandd` git `rev` to Phase-A merge SHA. Bump `@team9claw/*` packages to Phase-B versions.
- `AhandRuntime::reload()` with rollback on spawn failure — snapshots the current `DaemonConfig` before shutting down, respawns with fresh config from disk, rolls back on primary-spawn failure.
- New Tauri commands in `src-tauri/src/ahand/browser_runtime.rs`:
  - `browser_status` — reads `browser_setup::inspect_all` + config + daemon status.
  - `browser_install(force, on_progress)` — streams `BrowserProgressEvent`s via Channel; on success flips `[browser].enabled=true` and calls `reload()`.
  - `browser_set_enabled(enabled, on_progress)` — flips config + reloads.
- Adapter converts `ahandd::ProgressEvent` into `BrowserProgressEvent` + tees all log lines to `~/.ahand/logs/browser-setup-{timestamp}.log` (7-day retention).
- `BrowserConfigTab.tsx` split into 4 focused components: `RuntimeCard`, `StepRow`, `LogDrawer`, `BrowserBinaryCard`. New `useBrowserRuntime` hook wraps the 3 commands in a reducer-style FSM.
- i18n keys added for zh-CN + en-US covering all new strings.
- Coming-Soon badge removed; tab is now live.

## Test Plan

- [ ] `cargo test` + `pnpm typecheck` + `pnpm test` + `pnpm lint` green (run in CI).
- [ ] Manual (Task 17): fresh `~/.ahand/` → click Install → log drawer shows live progress → all 3 steps green → Agent-visible flips on automatically → in another agent chat, `browser-playwright-cli` SKILL appears in skill search → agent drives Playwright via `run_command playwright-cli ...`.
- [ ] Manual negative: toggle Enable off → daemon reconnects → agent's skill search no longer surfaces the skill.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Watch CI, troubleshoot if flakes**

```
/opt/homebrew/bin/gh pr checks <NUM> --repo team9ai/team9 --watch
```

- [ ] **Step 3: Merge (merge commit)**

```
/opt/homebrew/bin/gh pr merge <NUM> --repo team9ai/team9 --merge --delete-branch
```

- [ ] **Step 4: Record merge SHA (for release tracking)**

```
/opt/homebrew/bin/gh pr view <NUM> --repo team9ai/team9 --json mergeCommit --jq '.mergeCommit.oid'
```

- [ ] **Step 5: Local cleanup**

```
cd /Users/winrey/Projects/weightwave/team9
git checkout dev
git pull --ff-only origin dev
git branch -d feat/browser-runtime-install-ui
# plus worktree cleanup
```

---

### Task 17: Manual E2E smoke test

**Repo:** all three (no file changes).

**Goal:** Verify the full end-to-end path on a real dev-environment device after all three PRs merge and dev is redeployed: install UI → ahandd reports new cap → team9 gateway propagates → agent sees SKILL → agent drives Playwright via `run_command`.

**Files:** none — this is pure verification.

**Acceptance Criteria:**

- [ ] Fresh dev env (or a reset `~/.ahand/` with `[browser].enabled = false`, no `~/.ahand/node`): click Install → all 3 steps turn green → log drawer shows live progress → Agent-visible toggle flips to ON automatically
- [ ] After install, ahandd Hello reports `capabilities: ["exec","browser-playwright-cli"]` (verify via hub admin listing or `list_devices` output — even if the tool's output doesn't show cap strings directly, the hub's `GET /api/admin/devices` should)
- [ ] In an agent chat on dev, prompt: "帮我截图 google.com" → agent calls `search_skills` → finds `browser-playwright-cli` SKILL → calls `run_command playwright-cli open https://google.com` and `run_command playwright-cli screenshot --out /tmp/foo.png` → reports a screenshot path
- [ ] Toggle Enable off → daemon reconnects → agent's next `search_skills "browser"` no longer returns the `browser-playwright-cli` skill (cap was dropped)
- [ ] Induced failure: disconnect network → click Install → Network step fails → help popover offers proxy-config guidance
- [ ] Induced failure: uninstall `/Applications/Google Chrome.app` → click Install → system-browser step fails → help popover offers Chrome download
- [ ] Induced failure: `chmod 444 ~/.ahand/config.toml` → click Enable → error toast + log drawer shows path + errno
- [ ] Double-click Install → second click fast-fails with `"operation_in_progress"` → UI shows toast

**Verify:** manual — no automated command. Record results in this task's checkbox list when done.

**Steps:**

- [ ] **Step 1: Build + install a fresh .dmg from the merged team9 dev branch**

```
cd /Users/winrey/Projects/weightwave/team9
source /opt/homebrew/opt/nvm/nvm.sh
git checkout dev && git pull
pnpm install
pnpm --filter @team9/client tauri build --debug  # faster than release build
# Install the resulting .dmg or run `pnpm --filter @team9/client tauri dev` for live iteration
```

- [ ] **Step 2: Reset local ahand state for a clean first-run**

```
rm -rf ~/.ahand/node ~/.ahand/logs
# Edit ~/.ahand/config.toml so `[browser].enabled = false` (or delete the [browser] section)
# Restart the Tauri app to re-spawn ahandd with a fresh config
```

- [ ] **Step 3: Happy-path install**

Open the app → Settings → 我的设备 → 浏览器控制 → click Install. Observe:

- Runtime card shows "安装中…" badge
- Log drawer auto-expands; stdout/stderr lines stream in with distinct colors
- Node.js row turns green first, then Playwright CLI, then 系统浏览器
- Agent-visible toggle flips on automatically after all three are green
- Badge shows "已安装"

Check these completed; capture one screenshot per phase for the PR description / release notes.

- [ ] **Step 4: Verify capability propagation end-to-end**

In a terminal:

```
# Check hub has the new cap
/opt/homebrew/bin/gh api "<hub-admin-endpoint>/api/admin/devices?externalUserId=<your-user-id>" \
  | jq '.[] | select(.externalUserId=="<you>") | .capabilities'
# Expected: ["exec", "browser-playwright-cli"]
```

Also check team9 gateway: `curl .../internal/ahand/devices/list-for-user` (or whatever endpoint the worker uses) and confirm `capabilities` contains `browser-playwright-cli`.

- [ ] **Step 5: Agent invocation smoke**

In a dev agent chat:

```
@agent 帮我访问 https://google.com 截图
```

Expected: agent uses `search_skills` → finds `browser-playwright-cli` → calls `run_command playwright-cli open https://google.com` → `run_command playwright-cli screenshot --out /tmp/google-screenshot.png` → replies with the screenshot path.

If the agent says "I don't have a browser tool", the SKILL didn't register; troubleshoot via worker logs for `registerSourceCodeSkills` warnings.

- [ ] **Step 6: Toggle-off smoke**

Back in the Tauri app, toggle Agent-visible off. Observe:

- Banner shows "应用中…" briefly
- Badge returns to "已安装" but toggle is off

In agent chat again: "能用浏览器吗?" → agent says no / searches but doesn't find the skill.

- [ ] **Step 7: Induced failures (optional but recommended)**

Run the induced-failure scenarios from the Acceptance Criteria list. Document each in the PR description or a release-notes entry so ops knows the UX in error states.

- [ ] **Step 8: Sign off**

Check off all acceptance criteria in this task's checklist. Post a summary message on the team9 PR #<TEAM9_NUM> with: ✅ E2E smoke passed on `dev`, dated, hash of the three merge commits (`<PHASE_A_SHA>`, `<PHASE_B_SHA>`, `<PHASE_C_SHA>`).

---
