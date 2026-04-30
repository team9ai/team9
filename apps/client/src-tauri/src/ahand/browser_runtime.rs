//! Tauri commands that wire the renderer's "我的设备 → 浏览器控制"
//! install/toggle UI to the embedded `ahandd::browser_setup` library.
//!
//! See team9/docs/superpowers/specs/2026-04-29-ahand-browser-runtime-install-design.md
//! §5 for the full design.
//!
//! ## Concurrency
//!
//! Only one mutating browser operation (`browser_install` /
//! `browser_set_enabled`) may run at a time. We gate via a process-wide
//! `AtomicBool` (`INSTALL_IN_PROGRESS`) — a second invocation while one
//! is in flight returns `Err("operation_in_progress")` synchronously and
//! does not touch the daemon. The flag is cleared by the `InstallGuard`
//! RAII type on every exit path (success, error, or panic-via-drop).
//!
//! `AhandRuntime::reload()` is independently serialised by its own internal
//! `Mutex<Option<ActiveSession>>`, so we don't need a second outer lock.
//!
//! ## Logging
//!
//! Each `browser_install` invocation opens a fresh
//! `~/.ahand/logs/browser-setup-{YYYYMMDD-HHMMSS}.log` and tee's every
//! `ProgressEvent` (verbatim) to it. At the start of each install we prune
//! files in that directory older than 7 days. Failures to write the log
//! are swallowed — they must never fail the install path.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;

use ahandd::browser_setup::{
    self, CheckReport, CheckStatus, ErrorCode, FailedStepReport, LogStream, Phase, ProgressEvent,
};
use ahandd::config::Config;

use super::runtime::{AhandRuntime, ReloadError};

// ============================================================================
// Concurrency gate
// ============================================================================

/// Process-wide flag: only one mutating browser operation may run at once.
/// `compare_exchange` makes the swap-and-test atomic; we never block on
/// another caller. RAII via `InstallGuard` ensures the flag is cleared
/// even on panic / early-return.
static INSTALL_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

struct InstallGuard;

impl InstallGuard {
    fn try_acquire() -> Option<Self> {
        match INSTALL_IN_PROGRESS.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        {
            Ok(_) => Some(Self),
            Err(_) => None,
        }
    }
}

impl Drop for InstallGuard {
    fn drop(&mut self) {
        INSTALL_IN_PROGRESS.store(false, Ordering::Release);
    }
}

// ============================================================================
// Wire types — shape consumed by the renderer's Channel
// ============================================================================

/// Streaming progress events emitted on the `Channel<BrowserProgressEvent>`
/// passed by the renderer. Tagged with `type` so TS can discriminate.
#[derive(Debug, Serialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum BrowserProgressEvent {
    StepStarted {
        name: String,
        label: String,
    },
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
    ReloadFailed {
        kind: ReloadFailureKind,
        message: String,
    },
}

/// Renderer-visible step status. A superset of ahandd's `CheckStatus` —
/// flattens `Missing`/`Outdated`/`NoneDetected` into `NotRun`.
#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TauriStepStatus {
    Ok,
    Skipped,
    Failed,
    NotRun,
}

/// Origin of a streamed log line. `Info` is synthesised by the adapter
/// (e.g. for `Phase::Starting`/`Downloading`/...); `Stdout`/`Stderr` are
/// forwarded verbatim from child processes via `Phase::Log`.
#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TauriLogStream {
    Stdout,
    Stderr,
    Info,
}

impl From<LogStream> for TauriLogStream {
    fn from(s: LogStream) -> Self {
        match s {
            LogStream::Stdout => TauriLogStream::Stdout,
            LogStream::Stderr => TauriLogStream::Stderr,
            LogStream::Info => TauriLogStream::Info,
        }
    }
}

/// Classified failure reason for a step. `code` is the snake_case form of
/// `ahandd::browser_setup::ErrorCode` (e.g. `"permission_denied"`); the
/// renderer matches on it to pick a help popover.
#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StepError {
    pub code: String,
    pub message: String,
}

impl From<(ErrorCode, String)> for StepError {
    fn from((code, message): (ErrorCode, String)) -> Self {
        // ErrorCode serialises as a snake_case string under serde. Round-trip
        // through serde_json so the wire shape stays consistent with the rest
        // of ahandd's surface area instead of hand-mapping each variant.
        let code_str = serde_json::to_value(code)
            .ok()
            .and_then(|v| v.as_str().map(|s| s.to_string()))
            .unwrap_or_else(|| "unknown".into());
        Self {
            code: code_str,
            message,
        }
    }
}

#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ReloadFailureKind {
    ShutdownTimeout,
    SpawnFailedRolledBack,
    SpawnFailedNoRollback,
}

// ============================================================================
// BrowserStatus — return type of the 3 commands
// ============================================================================

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BrowserStatus {
    pub overall: TauriStepStatus,
    pub steps: Vec<BrowserStepStatus>,
    pub enabled: bool,
    pub agent_visible: bool,
    pub queried_at: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
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

fn step_status_from_check(
    cs: &CheckStatus,
) -> (TauriStepStatus, Option<String>, Option<StepError>) {
    match cs {
        CheckStatus::Ok { version, path, .. } => {
            let detail = if version.is_empty() {
                Some(path.display().to_string())
            } else {
                Some(format!("{} ({})", version, path.display()))
            };
            (TauriStepStatus::Ok, detail, None)
        }
        CheckStatus::Missing => (TauriStepStatus::NotRun, None, None),
        CheckStatus::Outdated {
            current, required, ..
        } => (
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

fn to_browser_status(
    reports: Vec<CheckReport>,
    enabled: bool,
    agent_visible: bool,
) -> BrowserStatus {
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

// ============================================================================
// Adapter — translate ahandd ProgressEvent → Tauri BrowserProgressEvent
// ============================================================================
//
// Notes on threading:
// * The progress callback passed to `browser_setup::run_all` is a sync
//   `Fn(ProgressEvent)`, invoked from inside the async install loop.
// * We must NEVER call `tokio::sync::Mutex::blocking_lock()` here — it
//   panics inside a tokio runtime.
// * Therefore we use `std::sync::Mutex` for both the adapter state and
//   the log writer. These mutexes are short-lived: never held across
//   `.await`, so they don't deadlock the executor.

#[derive(Default)]
struct AdapterState {
    steps: std::collections::HashMap<&'static str, StepTracker>,
}

#[derive(Clone)]
struct StepTracker {
    started_at: Instant,
    announced: bool,
    label: String,
}

fn step_label(name: &str) -> String {
    match name {
        "node" => "Node.js".into(),
        "playwright" => "Playwright CLI".into(),
        "browser" => "System Browser".into(),
        other => other.into(),
    }
}

impl AdapterState {
    fn translate(&mut self, ev: &ProgressEvent) -> Vec<BrowserProgressEvent> {
        let mut out = Vec::new();
        let tracker = self.steps.entry(ev.step).or_insert_with(|| StepTracker {
            started_at: Instant::now(),
            announced: false,
            label: step_label(ev.step),
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
            Phase::Starting
            | Phase::Downloading
            | Phase::Extracting
            | Phase::Installing
            | Phase::Verifying => {
                out.push(BrowserProgressEvent::StepLog {
                    name: ev.step.to_string(),
                    line: ev.message.clone(),
                    stream: TauriLogStream::Info,
                });
            }
            Phase::Done => {
                // Phase::Done is emitted on BOTH success and failure paths
                // (see `wrap_failure` in ahandd). We can't tell which here,
                // so we surface the message as an Info log line and leave
                // StepFinished emission to the post-pass after `run_all`
                // returns (which has the authoritative Result + reports).
                out.push(BrowserProgressEvent::StepLog {
                    name: ev.step.to_string(),
                    line: ev.message.clone(),
                    stream: TauriLogStream::Info,
                });
            }
        }
        out
    }
}

// ============================================================================
// Tauri commands
// ============================================================================

/// Read-only diagnostic. Never mutates anything. Returns the current
/// install + config + daemon-online state.
#[tauri::command]
pub async fn browser_status(state: State<'_, AhandRuntime>) -> Result<BrowserStatus, String> {
    let reports = browser_setup::inspect_all().await;
    let config_path = state
        .config_path()
        .await
        .ok_or_else(|| "ahand runtime not started — call ahand_start first".to_string())?;
    let config = Config::load(&config_path).map_err(|e| format!("config load: {e:#}"))?;
    let enabled = config.browser_config().enabled.unwrap_or(false);
    let daemon_online = matches!(
        state.status().await,
        super::runtime::DaemonStatus::Online { .. }
    );
    let agent_visible = enabled && daemon_online;
    Ok(to_browser_status(reports, enabled, agent_visible))
}

/// Run `browser_setup::run_all`, stream progress to the renderer, tee logs
/// to disk, flip `[browser].enabled = true` on success, and reload the
/// daemon. Returns the final `BrowserStatus` after reload.
///
/// Concurrency: a second invocation while one is in flight returns
/// `Err("operation_in_progress")` synchronously.
#[tauri::command]
pub async fn browser_install(
    state: State<'_, AhandRuntime>,
    force: bool,
    on_progress: Channel<BrowserProgressEvent>,
) -> Result<BrowserStatus, String> {
    let _guard = InstallGuard::try_acquire().ok_or_else(|| "operation_in_progress".to_string())?;

    let config_path = state
        .config_path()
        .await
        .ok_or_else(|| "ahand runtime not started — call ahand_start first".to_string())?;

    // Best-effort: prune log files older than 7 days. Failures are logged
    // to stderr but never abort the install.
    tokio::task::spawn_blocking(|| {
        if let Err(e) = prune_old_logs(7) {
            eprintln!("browser_runtime: prune_old_logs failed: {e}");
        }
    });

    // Open the per-install log file. Failures are non-fatal — we log to
    // stderr and proceed without tee'ing.
    let log_writer: Option<Arc<Mutex<std::fs::File>>> = match prepare_log_file() {
        Ok(f) => Some(Arc::new(Mutex::new(f))),
        Err(e) => {
            eprintln!("browser_runtime: open log file failed: {e:#}");
            None
        }
    };

    // Wrap the channel in Arc so the sync callback can move a clone in.
    let channel_cb = Arc::new(on_progress);
    let adapter_state = Arc::new(Mutex::new(AdapterState::default()));

    let cb_state = adapter_state.clone();
    let cb_channel = channel_cb.clone();
    let cb_log = log_writer.clone();
    let cb = move |e: ProgressEvent| {
        // 1. Translate via adapter and emit to channel. Fire-and-forget:
        //    if the renderer dropped the channel, send returns Err and
        //    we just silently stop forwarding to it.
        let translated = {
            // Poison-recovery: an `unwrap()` here would crash the daemon
            // worker on a poisoned mutex. `lock()` only fails when a panic
            // happened while holding the lock; in that case fall back to
            // emitting nothing rather than aborting the install.
            match cb_state.lock() {
                Ok(mut st) => st.translate(&e),
                Err(_) => Vec::new(),
            }
        };
        for ev in translated {
            let _ = cb_channel.send(ev);
        }
        // 2. Tee the raw event to the log file. Best-effort — never fails.
        if let Some(ref writer) = cb_log {
            let _ = write_log_line(writer, &e);
        }
    };

    let overall_start = Instant::now();
    let result = browser_setup::run_all(force, cb).await;

    // ── Reconciliation pass: emit StepFinished for each known report ──
    //
    // `Phase::Done` is emitted by ahandd on both success and failure
    // paths, so we cannot reliably emit StepFinished from inside the
    // adapter. Do it here where we have the authoritative
    // `Result<Vec<CheckReport>>`.
    let reports_for_status: Vec<CheckReport> = match &result {
        Ok(reports) => {
            for r in reports {
                emit_step_finished(&channel_cb, &adapter_state, r);
            }
            reports.clone()
        }
        Err(e) => {
            // Recover the classified report (if any) from the FailedStepReport
            // context attached by `wrap_failure`.
            if let Some(failed) = e.downcast_ref::<FailedStepReport>() {
                emit_step_finished(&channel_cb, &adapter_state, &failed.0);
            }
            // No partial-report set is exposed by ahandd on Err; the
            // post-install `inspect_all` below gives the renderer a fresh
            // snapshot.
            Vec::new()
        }
    };

    let overall_status = match &result {
        Ok(reports)
            if reports
                .iter()
                .any(|r| matches!(r.status, CheckStatus::Failed { .. })) =>
        {
            TauriStepStatus::Failed
        }
        Ok(reports)
            if reports
                .iter()
                .all(|r| matches!(r.status, CheckStatus::Ok { .. })) =>
        {
            TauriStepStatus::Ok
        }
        Ok(_) => TauriStepStatus::Skipped,
        Err(_) => TauriStepStatus::Failed,
    };

    let _ = channel_cb.send(BrowserProgressEvent::AllFinished {
        overall: overall_status,
        total_duration_ms: overall_start.elapsed().as_millis() as u64,
    });

    // On success, flip the config flag and reload the daemon so the new
    // [browser].enabled value takes effect for the embedded ahandd.
    if matches!(overall_status, TauriStepStatus::Ok) {
        match Config::load(&config_path) {
            Ok(mut cfg) => {
                if let Err(e) = cfg.set_browser_enabled(&config_path, true) {
                    eprintln!("browser_runtime: config write failed: {e:#}");
                } else {
                    let _ = channel_cb.send(BrowserProgressEvent::ReloadStarted);
                    match state.reload().await {
                        Ok(()) => {
                            let _ = channel_cb.send(BrowserProgressEvent::ReloadOnline);
                        }
                        Err(re) => {
                            let _ = channel_cb.send(BrowserProgressEvent::ReloadFailed {
                                kind: reload_error_kind(&re),
                                message: format!("{re}"),
                            });
                        }
                    }
                }
            }
            Err(e) => {
                eprintln!("browser_runtime: config reload failed: {e:#}");
            }
        }
    }

    // Final status snapshot — re-inspect since reports above may be empty
    // on the Err path, and the daemon state may have changed via reload().
    let reports_after = if reports_for_status.is_empty() || result.is_err() {
        browser_setup::inspect_all().await
    } else {
        reports_for_status
    };
    let config_after =
        Config::load(&config_path).map_err(|e| format!("config final load: {e:#}"))?;
    let enabled_after = config_after.browser_config().enabled.unwrap_or(false);
    let agent_visible = enabled_after
        && matches!(
            state.status().await,
            super::runtime::DaemonStatus::Online { .. }
        );
    Ok(to_browser_status(
        reports_after,
        enabled_after,
        agent_visible,
    ))
}

/// Flip `[browser].enabled` and reload the daemon. Does NOT run
/// `run_all` — the caller is expected to have already installed via
/// `browser_install` (or by other means). Only emits `ReloadStarted`/
/// `ReloadOnline`/`ReloadFailed` events.
#[tauri::command]
pub async fn browser_set_enabled(
    state: State<'_, AhandRuntime>,
    enabled: bool,
    on_progress: Channel<BrowserProgressEvent>,
) -> Result<BrowserStatus, String> {
    let _guard = InstallGuard::try_acquire().ok_or_else(|| "operation_in_progress".to_string())?;

    let config_path = state
        .config_path()
        .await
        .ok_or_else(|| "ahand runtime not started — call ahand_start first".to_string())?;

    // Guard: refuse to enable when not all components are installed —
    // otherwise the agent would advertise a capability that immediately
    // fails to drive a browser session.
    if enabled {
        let reports = browser_setup::inspect_all().await;
        let installed = reports
            .iter()
            .all(|r| matches!(r.status, CheckStatus::Ok { .. }));
        if !installed {
            return Err("browser_not_installed".into());
        }
    }

    let mut cfg = Config::load(&config_path).map_err(|e| format!("config load: {e:#}"))?;
    let old = cfg
        .set_browser_enabled(&config_path, enabled)
        .map_err(|e| format!("config write: {e:#}"))?;

    // No-op optimisation: skip the reload if the value didn't actually
    // change. Saves ~3-5s of daemon shutdown/respawn time.
    if old == enabled {
        let reports = browser_setup::inspect_all().await;
        let agent_visible = enabled
            && matches!(
                state.status().await,
                super::runtime::DaemonStatus::Online { .. }
            );
        return Ok(to_browser_status(reports, enabled, agent_visible));
    }

    let _ = on_progress.send(BrowserProgressEvent::ReloadStarted);
    match state.reload().await {
        Ok(()) => {
            let _ = on_progress.send(BrowserProgressEvent::ReloadOnline);
        }
        Err(re) => {
            let _ = on_progress.send(BrowserProgressEvent::ReloadFailed {
                kind: reload_error_kind(&re),
                message: format!("{re}"),
            });
        }
    }

    let reports = browser_setup::inspect_all().await;
    let config_after =
        Config::load(&config_path).map_err(|e| format!("config final load: {e:#}"))?;
    let enabled_after = config_after.browser_config().enabled.unwrap_or(false);
    let agent_visible = enabled_after
        && matches!(
            state.status().await,
            super::runtime::DaemonStatus::Online { .. }
        );
    Ok(to_browser_status(reports, enabled_after, agent_visible))
}

fn reload_error_kind(re: &ReloadError) -> ReloadFailureKind {
    match re {
        ReloadError::ShutdownTimeout => ReloadFailureKind::ShutdownTimeout,
        ReloadError::SpawnFailedRolledBack { .. } => ReloadFailureKind::SpawnFailedRolledBack,
        ReloadError::SpawnFailedNoRollback { .. } => ReloadFailureKind::SpawnFailedNoRollback,
    }
}

fn emit_step_finished(
    channel: &Channel<BrowserProgressEvent>,
    adapter: &Arc<Mutex<AdapterState>>,
    report: &CheckReport,
) {
    let (tauri_status, _detail, error) = step_status_from_check(&report.status);
    let duration_ms = match adapter.lock() {
        Ok(st) => st
            .steps
            .get(report.name)
            .map(|t| t.started_at.elapsed().as_millis() as u64)
            .unwrap_or(0),
        Err(_) => 0,
    };
    let _ = channel.send(BrowserProgressEvent::StepFinished {
        name: report.name.to_string(),
        status: tauri_status,
        error,
        duration_ms,
    });
}

// ============================================================================
// Log-file helpers
// ============================================================================

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
    let f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)?;
    Ok(f)
}

fn write_log_line(writer: &Arc<Mutex<std::fs::File>>, ev: &ProgressEvent) -> std::io::Result<()> {
    use std::io::Write;
    let mut f = match writer.lock() {
        Ok(g) => g,
        Err(_) => {
            // Mutex was poisoned by a panic; the file may still be writable
            // but we don't have a recovery path here without unwinding. Drop
            // the line silently rather than re-panic.
            return Ok(());
        }
    };
    let ts = chrono::Local::now().format("%H:%M:%S%.3f");
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
    let cutoff = std::time::SystemTime::now() - Duration::from_secs(max_age_days * 24 * 60 * 60);
    for entry in std::fs::read_dir(&dir)? {
        let entry = entry?;
        let name = entry.file_name();
        let Some(name_str) = name.to_str() else {
            continue;
        };
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

// ============================================================================
// Tests
// ============================================================================

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
        assert!(events.iter().any(
            |e| matches!(e, BrowserProgressEvent::StepStarted { name, label }
                if name == "node" && label == "Node.js")
        ));

        // Subsequent events for the same step do NOT re-announce.
        let events2 = st.translate(&ProgressEvent {
            step: "node",
            phase: Phase::Downloading,
            message: "downloading…".into(),
            percent: Some(50),
            stream: None,
        });
        assert!(
            !events2
                .iter()
                .any(|e| matches!(e, BrowserProgressEvent::StepStarted { .. })),
            "StepStarted must be emitted at most once per step"
        );

        // A different step gets its own StepStarted.
        let events3 = st.translate(&ProgressEvent {
            step: "playwright",
            phase: Phase::Starting,
            message: "Starting Playwright install".into(),
            percent: None,
            stream: None,
        });
        assert!(events3.iter().any(
            |e| matches!(e, BrowserProgressEvent::StepStarted { name, label }
                if name == "playwright" && label == "Playwright CLI")
        ));
    }

    #[test]
    fn adapter_forwards_stdout_log_lines_with_stream_tag() {
        let mut st = AdapterState::default();
        // Prime the step so StepStarted fires once and doesn't pollute later events.
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
            BrowserProgressEvent::StepLog {
                line,
                stream: TauriLogStream::Stdout,
                name,
            } if name == "playwright" => Some(line.clone()),
            _ => None,
        });
        assert_eq!(log, Some("npm notice".into()));

        // Stderr lines are forwarded too.
        let events_err = st.translate(&ProgressEvent {
            step: "playwright",
            phase: Phase::Log,
            message: "warn deprecated".into(),
            percent: None,
            stream: Some(LogStream::Stderr),
        });
        assert!(events_err.iter().any(|e| matches!(
            e,
            BrowserProgressEvent::StepLog {
                stream: TauriLogStream::Stderr,
                ..
            }
        )));

        // Phase::Log without a stream is dropped (defensive: spec requires
        // stream to be set when phase==Log, but the runtime should not
        // panic if it isn't).
        let events_no_stream = st.translate(&ProgressEvent {
            step: "playwright",
            phase: Phase::Log,
            message: "shouldn't appear".into(),
            percent: None,
            stream: None,
        });
        assert!(
            !events_no_stream
                .iter()
                .any(|e| matches!(e, BrowserProgressEvent::StepLog { .. })),
            "Log phase without stream tag should be dropped"
        );
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
        assert_eq!(overall_from_reports(&reports), TauriStepStatus::Failed);

        // All Ok → Ok.
        let all_ok = vec![CheckReport {
            name: "browser",
            label: "System Browser",
            status: CheckStatus::Ok {
                version: "".into(),
                path: "/Applications/Chrome".into(),
                source: ahandd::browser_setup::CheckSource::System,
            },
            fix_hint: None,
        }];
        assert_eq!(overall_from_reports(&all_ok), TauriStepStatus::Ok);

        // Some Missing but no Failed → NotRun.
        let mixed = vec![
            CheckReport {
                name: "node",
                label: "Node.js",
                status: CheckStatus::Missing,
                fix_hint: None,
            },
            CheckReport {
                name: "playwright",
                label: "Playwright CLI",
                status: CheckStatus::Ok {
                    version: "0.1.0".into(),
                    path: "/x".into(),
                    source: ahandd::browser_setup::CheckSource::Managed,
                },
                fix_hint: None,
            },
        ];
        assert_eq!(overall_from_reports(&mixed), TauriStepStatus::NotRun);
    }

    #[test]
    fn step_error_serializes_code_as_snake_case_string() {
        let e = StepError::from((ErrorCode::PermissionDenied, "EACCES".into()));
        assert_eq!(e.code, "permission_denied");
        assert_eq!(e.message, "EACCES");

        let e2 = StepError::from((ErrorCode::NoSystemBrowser, "x".into()));
        assert_eq!(e2.code, "no_system_browser");

        // Round-trip through serde to verify the wire shape.
        let json = serde_json::to_value(&e).unwrap();
        assert_eq!(json["code"], "permission_denied");
        assert_eq!(json["message"], "EACCES");
    }

    #[test]
    fn reload_failure_kind_serializes_camel_case() {
        assert_eq!(
            serde_json::to_value(ReloadFailureKind::ShutdownTimeout).unwrap(),
            serde_json::json!("shutdownTimeout")
        );
        assert_eq!(
            serde_json::to_value(ReloadFailureKind::SpawnFailedRolledBack).unwrap(),
            serde_json::json!("spawnFailedRolledBack")
        );
        assert_eq!(
            serde_json::to_value(ReloadFailureKind::SpawnFailedNoRollback).unwrap(),
            serde_json::json!("spawnFailedNoRollback")
        );
    }

    #[test]
    fn reload_error_kind_maps_all_variants() {
        assert_eq!(
            reload_error_kind(&ReloadError::ShutdownTimeout),
            ReloadFailureKind::ShutdownTimeout
        );
        assert_eq!(
            reload_error_kind(&ReloadError::SpawnFailedRolledBack {
                primary: "x".into()
            }),
            ReloadFailureKind::SpawnFailedRolledBack
        );
        assert_eq!(
            reload_error_kind(&ReloadError::SpawnFailedNoRollback {
                primary: "p".into(),
                rollback: "r".into(),
            }),
            ReloadFailureKind::SpawnFailedNoRollback
        );
    }

    #[test]
    fn install_guard_serializes_concurrent_acquire() {
        // Two acquisitions back-to-back: the second must fail until the
        // first guard is dropped.
        let g1 = InstallGuard::try_acquire();
        assert!(g1.is_some(), "first acquire should succeed");
        let g2 = InstallGuard::try_acquire();
        assert!(
            g2.is_none(),
            "second acquire while the first is held must fail"
        );
        drop(g1);
        let g3 = InstallGuard::try_acquire();
        assert!(g3.is_some(), "after drop, acquire should succeed again");
    }

    #[test]
    fn browser_progress_event_step_started_serializes_with_tag() {
        let ev = BrowserProgressEvent::StepStarted {
            name: "node".into(),
            label: "Node.js".into(),
        };
        let v = serde_json::to_value(&ev).unwrap();
        assert_eq!(v["type"], "stepStarted");
        assert_eq!(v["name"], "node");
        assert_eq!(v["label"], "Node.js");
    }

    #[test]
    fn browser_progress_event_reload_failed_includes_kind_and_message() {
        let ev = BrowserProgressEvent::ReloadFailed {
            kind: ReloadFailureKind::SpawnFailedRolledBack,
            message: "boom".into(),
        };
        let v = serde_json::to_value(&ev).unwrap();
        assert_eq!(v["type"], "reloadFailed");
        assert_eq!(v["kind"], "spawnFailedRolledBack");
        assert_eq!(v["message"], "boom");
    }

    #[test]
    fn step_status_from_check_ok_with_empty_version_only_shows_path() {
        // Browser detection returns version = "" because there's no cheap
        // way to query Chrome's version. Verify we don't render "()".
        let cs = CheckStatus::Ok {
            version: "".into(),
            path: "/Applications/Google Chrome.app".into(),
            source: ahandd::browser_setup::CheckSource::System,
        };
        let (status, detail, error) = step_status_from_check(&cs);
        assert_eq!(status, TauriStepStatus::Ok);
        assert_eq!(detail, Some("/Applications/Google Chrome.app".into()));
        assert!(error.is_none());
    }

    #[test]
    fn step_status_from_check_failed_carries_error_code_and_message() {
        let cs = CheckStatus::Failed {
            code: ErrorCode::Network,
            message: "ECONNRESET".into(),
        };
        let (status, detail, error) = step_status_from_check(&cs);
        assert_eq!(status, TauriStepStatus::Failed);
        assert!(detail.is_none());
        let err = error.expect("must surface a StepError");
        assert_eq!(err.code, "network");
        assert_eq!(err.message, "ECONNRESET");
    }

    #[test]
    fn to_browser_status_emits_camel_case_wire_shape() {
        let reports = vec![CheckReport {
            name: "node",
            label: "Node.js",
            status: CheckStatus::Ok {
                version: "20.10".into(),
                path: "/usr/bin/node".into(),
                source: ahandd::browser_setup::CheckSource::Managed,
            },
            fix_hint: None,
        }];
        let s = to_browser_status(reports, true, true);
        let v = serde_json::to_value(&s).unwrap();
        assert!(
            v.get("agentVisible").is_some(),
            "agent_visible → agentVisible"
        );
        assert!(v.get("queriedAt").is_some(), "queried_at → queriedAt");
        assert_eq!(v["overall"], "ok");
        assert_eq!(v["enabled"], true);
        assert_eq!(v["agentVisible"], true);
    }

    #[test]
    fn step_label_handles_known_and_unknown_steps() {
        assert_eq!(step_label("node"), "Node.js");
        assert_eq!(step_label("playwright"), "Playwright CLI");
        assert_eq!(step_label("browser"), "System Browser");
        assert_eq!(step_label("future-step"), "future-step");
    }
}
