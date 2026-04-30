use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

use super::identity;

/// Default 5s budget for a graceful daemon shutdown during reload. The
/// timeout is enforced via `tokio::time::timeout`; when it fires we drop
/// the in-flight shutdown future and surface `ReloadError::ShutdownTimeout`
/// to the caller. We do NOT force-kill the underlying task — the
/// `DaemonHandle::Drop` impl cancels the inner oneshot, which in practice
/// terminates the daemon shortly after.
const RELOAD_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);

// ── Public wire types ──────────────────────────────────────────────────────

/// Lifecycle status emitted to TS via Tauri event `ahand-daemon-status`.
/// Tagged union with `state` discriminant (camelCase for TS).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum DaemonStatus {
    Idle,
    Connecting,
    Online {
        #[serde(rename = "device_id")]
        device_id: String,
    },
    Offline,
    Error {
        kind: ErrorKind,
        message: String,
        /// Present when the error occurs while a session is active (carries
        /// the device_id that was online before the error).
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

/// Configuration supplied by the frontend to start the embedded daemon.
/// snake_case matches Tauri's serde deserialization from the TS `invoke()` call.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartConfig {
    pub team9_user_id: String,
    pub hub_url: String,
    pub device_jwt: String,
    pub jwt_expires_at: u64,
    #[serde(default = "default_heartbeat_interval")]
    pub heartbeat_interval_seconds: u64,
    /// Optional path to an ahandd `config.toml` on disk.
    ///
    /// When supplied, `AhandRuntime::reload()` re-reads this file via
    /// `ahandd::config::Config::load()` to pick up changes (e.g. the
    /// `[browser].enabled` flag flipped by the install UI). When `None`,
    /// `reload()` rebuilds the daemon config purely from the in-memory
    /// `StartupInputs` captured at `start()` time — useful for tests and
    /// for callers who don't expose a config-on-disk surface.
    #[serde(default)]
    pub config_path: Option<PathBuf>,
}

fn default_heartbeat_interval() -> u64 {
    60
}

/// Return value of `ahand_start` — carries the daemon's device_id so the
/// frontend can store it without waiting for the first Online event.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartResult {
    pub device_id: String,
}

/// Failure modes for `AhandRuntime::reload()`. Each variant captures a
/// distinct recovery posture so the UI can pick the right banner:
///
/// * `ShutdownTimeout` — the previous daemon failed to exit within
///   [`RELOAD_SHUTDOWN_TIMEOUT`]. The reload is aborted before any
///   respawn. The runtime is left in a session-less state (handle was
///   dropped); a follow-up `start()` is required to recover. We do NOT
///   force-kill — the `DaemonHandle::Drop` impl cancels the worker task.
/// * `SpawnFailedRolledBack` — the new spawn failed but a rollback spawn
///   with the previous `DaemonConfig` succeeded. The runtime is fully
///   functional, just with the old config; the user's intended change
///   didn't take effect.
/// * `SpawnFailedNoRollback` — both spawns failed. The runtime has no
///   active daemon; the app needs to call `start()` again (or restart).
#[derive(Debug, Serialize, thiserror::Error)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ReloadError {
    #[error("daemon shutdown timed out after 5s")]
    ShutdownTimeout,

    /// Wrapped as a struct variant rather than a newtype because
    /// `#[serde(tag = "kind")]` does not support tagging a newtype variant
    /// that contains a primitive — it would have to wrap the inner value in
    /// an extra envelope. Using a single named field (`primary`) keeps the
    /// TS-side shape uniform across all variants:
    /// `{ kind, primary[, rollback] }`.
    #[error("respawn failed, rolled back to previous config: {primary}")]
    SpawnFailedRolledBack { primary: String },

    #[error("respawn failed and rollback also failed; daemon is offline")]
    SpawnFailedNoRollback { primary: String, rollback: String },
}

// ── Internal state ─────────────────────────────────────────────────────────

/// Inputs supplied at `start()` time that aren't represented in the
/// on-disk `config.toml`. Captured on the active session so `reload()`
/// can rebuild a fresh `DaemonConfig` without re-asking the renderer.
#[derive(Clone, Debug)]
struct StartupInputs {
    hub_url: String,
    device_jwt: String,
    identity_dir: PathBuf,
    device_id: String,
    heartbeat_interval: Duration,
}

struct ActiveSession {
    handle: ahandd::DaemonHandle,
    team9_user_id: String,
    hub_url: String,
    hub_device_id: String,
    status_forwarder: JoinHandle<()>,
    /// Captured at `start()` time. Used by `reload()` to reconstruct a
    /// `DaemonConfig` from the current on-disk `Config` without going
    /// back to the renderer.
    startup_inputs: StartupInputs,
    /// Snapshot of the most recently-applied `DaemonConfig`. Cloned for
    /// rollback inside `reload()` before we attempt a respawn.
    current_daemon_config: ahandd::DaemonConfig,
    /// Optional `config.toml` path to read in `reload()`. Mirrors the
    /// `StartConfig::config_path` field; `None` means reload reuses the
    /// in-memory inputs only (no on-disk overlay).
    config_path: Option<PathBuf>,
}

pub struct AhandRuntime {
    inner: Arc<Mutex<Option<ActiveSession>>>,
}

impl AhandRuntime {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(None)),
        }
    }

    /// Start a new daemon session, stopping any existing one first.
    pub async fn start(&self, app: &AppHandle, cfg: StartConfig) -> Result<StartResult, String> {
        let mut guard = self.inner.lock().await;

        if let Some(prev) = guard.take() {
            Self::shutdown_session(prev).await;
        }

        let identity_dir = identity::identity_dir(app, &cfg.team9_user_id)?;
        // Load the Ed25519 identity so we can compute `SHA256(pubkey)` — the
        // canonical device_id per ahand protocol § 2.1 (matches
        // `ahandd::DeviceIdentity::device_id` and the gateway's register DTO).
        let id = ahandd::load_or_create_identity(&identity_dir)
            .map_err(|e| format!("load_or_create_identity: {e}"))?;
        let device_id = identity::device_id_from_pubkey(&id.public_key_bytes());

        if let Some(prev) = guard.as_ref() {
            if should_reuse_active_session(prev, &cfg.team9_user_id, &cfg.hub_url, &device_id) {
                return Ok(StartResult {
                    device_id: prev.hub_device_id.clone(),
                });
            }
        }

        let startup_inputs = StartupInputs {
            hub_url: cfg.hub_url.clone(),
            device_jwt: cfg.device_jwt.clone(),
            identity_dir: identity_dir.clone(),
            device_id: device_id.clone(),
            heartbeat_interval: Duration::from_secs(cfg.heartbeat_interval_seconds),
        };

        // Optionally overlay the on-disk Config (mainly for browser.enabled).
        // Failures to read are non-fatal during start() — we fall back to
        // pure in-memory defaults so the daemon can still spawn.
        let on_disk = cfg
            .config_path
            .as_deref()
            .and_then(|p| ahandd::config::Config::load(p).ok());
        let daemon_cfg = build_daemon_config(on_disk.as_ref(), &startup_inputs);

        let handle = ahandd::spawn(daemon_cfg.clone())
            .await
            .map_err(|e| format!("ahandd::spawn failed: {e}"))?;

        let app_clone = app.clone();
        let mut status_rx = handle.subscribe_status();
        let initial = DaemonStatus::from(status_rx.borrow().clone());
        let _ = app_clone.emit("ahand-daemon-status", &initial);

        let status_forwarder = tokio::spawn(async move {
            while status_rx.changed().await.is_ok() {
                let s = DaemonStatus::from(status_rx.borrow().clone());
                if app_clone.emit("ahand-daemon-status", &s).is_err() {
                    break;
                }
            }
        });

        *guard = Some(ActiveSession {
            handle,
            team9_user_id: cfg.team9_user_id,
            hub_url: cfg.hub_url,
            hub_device_id: device_id.clone(),
            status_forwarder,
            startup_inputs,
            current_daemon_config: daemon_cfg,
            config_path: cfg.config_path,
        });

        Ok(StartResult { device_id })
    }

    /// Stop the active session. Idempotent — returns Ok when nothing is running.
    ///
    /// When `app` is provided, emits a final `DaemonStatus::Idle` to the
    /// frontend so the UI status indicator (sidebar dot, ThisMacSection
    /// label) reliably reflects the stopped state, even when the ahandd
    /// watch channel's Offline event races the forwarder abort in
    /// `shutdown_session`. Tests pass `None`.
    pub async fn stop(&self, app: Option<&AppHandle>) -> Result<(), String> {
        let mut guard = self.inner.lock().await;
        if let Some(session) = guard.take() {
            Self::shutdown_session(session).await;
        }
        if let Some(app) = app {
            let _ = app.emit("ahand-daemon-status", &DaemonStatus::Idle);
        }
        Ok(())
    }

    /// Snapshot of current status without blocking on a status change.
    pub async fn status(&self) -> DaemonStatus {
        let guard = self.inner.lock().await;
        match guard.as_ref() {
            Some(s) => DaemonStatus::from(s.handle.status()),
            None => DaemonStatus::Idle,
        }
    }

    /// Device ID of the active session, if any.
    pub async fn current_device_id(&self) -> Option<String> {
        let guard = self.inner.lock().await;
        guard.as_ref().map(|s| s.hub_device_id.clone())
    }

    /// Hot-reload the embedded daemon. Reads the on-disk config fresh
    /// (when `StartConfig::config_path` was supplied), shuts the running
    /// daemon down with a 5-second timeout, and spawns a new instance
    /// with the new config. On primary-spawn failure, attempts a rollback
    /// spawn with the previous `DaemonConfig`.
    ///
    /// Serialization: this method takes `&self` and uses interior
    /// mutability via `Arc<Mutex<Option<ActiveSession>>>`. The mutex is
    /// held for the entire reload — including both the shutdown wait and
    /// the spawn — so concurrent calls to `reload()` (or `start()` /
    /// `stop()`) are serialized at the AhandRuntime level. A second
    /// reload waits for the first one to commit (or fail) before
    /// observing the post-reload state.
    ///
    /// Failure modes are described on [`ReloadError`].
    ///
    /// Pre-condition: a session must be active (`start()` has succeeded).
    /// Calling `reload()` when no session is active returns
    /// `SpawnFailedNoRollback` describing the precondition violation —
    /// the caller is expected to call `start()` instead.
    pub async fn reload(&self) -> Result<(), ReloadError> {
        let mut guard = self.inner.lock().await;

        // 1. Take ownership of the active session (so we can move the
        //    handle into shutdown()). If absent, there's nothing to
        //    reload — surface a NoRollback failure so the caller knows
        //    to call start() instead.
        let Some(session) = guard.take() else {
            return Err(ReloadError::SpawnFailedNoRollback {
                primary: "reload called with no active session".into(),
                rollback: "not attempted — no previous config to roll back to".into(),
            });
        };

        let ActiveSession {
            handle: old_handle,
            team9_user_id,
            hub_url,
            hub_device_id,
            status_forwarder,
            startup_inputs,
            current_daemon_config: rollback_daemon_cfg,
            config_path,
        } = session;

        // 2. Read fresh on-disk config (when applicable). Failures here
        //    mean we can't compute a new DaemonConfig — surface
        //    NoRollback rather than tear down the still-running daemon.
        //    Restore the session into `*guard` so the runtime stays
        //    healthy.
        let new_on_disk = match config_path.clone() {
            Some(path) => match ahandd::config::Config::load(&path) {
                Ok(c) => Some(c),
                Err(e) => {
                    let path_display = path.display().to_string();
                    *guard = Some(ActiveSession {
                        handle: old_handle,
                        team9_user_id,
                        hub_url,
                        hub_device_id,
                        status_forwarder,
                        startup_inputs,
                        current_daemon_config: rollback_daemon_cfg,
                        config_path,
                    });
                    return Err(ReloadError::SpawnFailedNoRollback {
                        primary: format!("load new config from {path_display}: {e:#}"),
                        rollback: "not attempted — old daemon left running".into(),
                    });
                }
            },
            None => None,
        };

        // 3. Build the new DaemonConfig and pre-clone for spawn (the
        //    builder consumes by value).
        let new_daemon_cfg = build_daemon_config(new_on_disk.as_ref(), &startup_inputs);

        // 4. Stop forwarding status events from the dying handle. We
        //    abort the forwarder before shutdown so the renderer doesn't
        //    momentarily see Idle/Offline transitions before the new
        //    handle's status arrives. The new spawn below will register
        //    its own forwarder.
        status_forwarder.abort();
        let _ = status_forwarder.await;

        // 5. Shutdown old daemon with timeout. On timeout we drop the
        //    in-flight future; the handle's Drop will cancel the worker.
        match tokio::time::timeout(RELOAD_SHUTDOWN_TIMEOUT, old_handle.shutdown()).await {
            Ok(Ok(())) => {}
            Ok(Err(_e)) => {
                // shutdown returned Err but within timeout. The daemon
                // is gone either way — proceed to spawn.
            }
            Err(_timeout) => {
                // *guard is already None (we took the session out). The
                // runtime now has no active daemon; the caller can
                // recover by calling start() again.
                return Err(ReloadError::ShutdownTimeout);
            }
        }

        // 6. Spawn primary; on failure, attempt rollback.
        match ahandd::spawn(new_daemon_cfg.clone()).await {
            Ok(handle) => {
                let session = build_active_session(
                    self.app_emitter_for_session(&team9_user_id),
                    handle,
                    team9_user_id,
                    hub_url,
                    hub_device_id,
                    startup_inputs,
                    new_daemon_cfg,
                    config_path,
                );
                *guard = Some(session);
                Ok(())
            }
            Err(primary_err) => {
                match ahandd::spawn(rollback_daemon_cfg.clone()).await {
                    Ok(handle) => {
                        let session = build_active_session(
                            self.app_emitter_for_session(&team9_user_id),
                            handle,
                            team9_user_id,
                            hub_url,
                            hub_device_id,
                            startup_inputs,
                            rollback_daemon_cfg,
                            config_path,
                        );
                        *guard = Some(session);
                        Err(ReloadError::SpawnFailedRolledBack {
                            primary: format!("{primary_err:#}"),
                        })
                    }
                    Err(rollback_err) => {
                        // *guard remains None — runtime is offline.
                        Err(ReloadError::SpawnFailedNoRollback {
                            primary: format!("{primary_err:#}"),
                            rollback: format!("{rollback_err:#}"),
                        })
                    }
                }
            }
        }
    }

    /// Hook that returns the `AppHandle` used to forward status events
    /// from the new daemon spawned during `reload()`. The current
    /// implementation has no `AppHandle` cached on `AhandRuntime` (it's
    /// passed per-call to `start()`/`stop()`), so the reload path emits
    /// no status events directly — the new daemon's own status watch
    /// will be subscribed to once a Tauri command resolves the handle
    /// again. Tests pass `None`.
    ///
    /// NOTE for Task 14: when wiring up the `browser_install` Tauri
    /// command, the caller is expected to also `state.app_handle()` and
    /// re-emit the new daemon's status. A future iteration may cache
    /// the `AppHandle` inside `AhandRuntime` so reload() forwards
    /// transparently.
    fn app_emitter_for_session(&self, _team9_user_id: &str) -> Option<AppHandle> {
        None
    }

    async fn shutdown_session(session: ActiveSession) {
        let _ = session.handle.shutdown().await;
        // Abort then await so the forwarder finishes its current poll (delivering
        // the final Offline status event) before we return.
        session.status_forwarder.abort();
        let _ = session.status_forwarder.await;
    }
}

/// Construct a fresh `ahandd::DaemonConfig` from the given startup
/// inputs, optionally overlaying values from an on-disk
/// `ahandd::config::Config`.
///
/// Today the only on-disk field that affects the embedded daemon is
/// `[browser].enabled`. If `on_disk` is `None` (no `config_path` was
/// supplied at start, or the file failed to load), the daemon is spawned
/// with `browser_enabled = false` (the historical default).
///
/// All other fields (`hub_url`, `device_jwt`, `identity_dir`,
/// `device_id`, `heartbeat_interval`) come from the startup inputs.
/// Future on-disk overlays should extend this helper rather than the
/// inline call sites.
fn build_daemon_config(
    on_disk: Option<&ahandd::config::Config>,
    inputs: &StartupInputs,
) -> ahandd::DaemonConfig {
    let browser_enabled = on_disk
        .and_then(|c| c.browser.as_ref())
        .and_then(|b| b.enabled)
        .unwrap_or(false);

    ahandd::DaemonConfig::builder(
        &inputs.hub_url,
        &inputs.device_jwt,
        inputs.identity_dir.clone(),
    )
    .device_id(&inputs.device_id)
    .session_mode(ahandd::SessionMode::AutoAccept)
    .browser_enabled(browser_enabled)
    .heartbeat_interval(inputs.heartbeat_interval)
    .build()
}

/// Stitch a freshly-spawned `DaemonHandle` plus the carried-over session
/// metadata back into an `ActiveSession`. Used by `reload()` after both
/// primary and rollback spawns. The optional `app` is the Tauri
/// `AppHandle` used to forward status events; when `None` (current
/// behavior — see `app_emitter_for_session`) no forwarder task is
/// spawned and the renderer must consult `runtime.status()` to discover
/// the new state.
#[allow(clippy::too_many_arguments)]
fn build_active_session(
    app: Option<AppHandle>,
    handle: ahandd::DaemonHandle,
    team9_user_id: String,
    hub_url: String,
    hub_device_id: String,
    startup_inputs: StartupInputs,
    current_daemon_config: ahandd::DaemonConfig,
    config_path: Option<PathBuf>,
) -> ActiveSession {
    let status_forwarder = match app {
        Some(app_clone) => {
            let mut status_rx = handle.subscribe_status();
            let initial = DaemonStatus::from(status_rx.borrow().clone());
            let _ = app_clone.emit("ahand-daemon-status", &initial);
            tokio::spawn(async move {
                while status_rx.changed().await.is_ok() {
                    let s = DaemonStatus::from(status_rx.borrow().clone());
                    if app_clone.emit("ahand-daemon-status", &s).is_err() {
                        break;
                    }
                }
            })
        }
        None => tokio::spawn(async {}),
    };
    ActiveSession {
        handle,
        team9_user_id,
        hub_url,
        hub_device_id,
        status_forwarder,
        startup_inputs,
        current_daemon_config,
        config_path,
    }
}

fn should_reuse_active_session(
    session: &ActiveSession,
    requested_user_id: &str,
    requested_hub_url: &str,
    requested_device_id: &str,
) -> bool {
    should_reuse_session_keys_and_status(
        &session.team9_user_id,
        &session.hub_url,
        &session.hub_device_id,
        requested_user_id,
        requested_hub_url,
        requested_device_id,
        &session.handle.status(),
    )
}

fn should_reuse_session_keys_and_status(
    existing_user_id: &str,
    existing_hub_url: &str,
    existing_device_id: &str,
    requested_user_id: &str,
    requested_hub_url: &str,
    requested_device_id: &str,
    status: &ahandd::DaemonStatus,
) -> bool {
    existing_user_id == requested_user_id
        && existing_hub_url == requested_hub_url
        && existing_device_id == requested_device_id
        && matches!(
            status,
            ahandd::DaemonStatus::Connecting | ahandd::DaemonStatus::Online { .. }
        )
}

impl Default for AhandRuntime {
    fn default() -> Self {
        Self::new()
    }
}

// ── Tests ──────────────────────────────────────────────────────────────────

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
        assert!(rt.stop(None).await.is_ok());
        assert!(rt.stop(None).await.is_ok());
    }

    #[test]
    fn daemon_status_serde_round_trip() {
        let s = DaemonStatus::Error {
            kind: ErrorKind::Auth,
            message: "jwt_expired".into(),
            device_id: Some("abc".into()),
        };
        let json = serde_json::to_string(&s).unwrap();
        // Verify serialized shape
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["state"], "error");
        assert_eq!(v["kind"], "auth");
        assert_eq!(v["message"], "jwt_expired");
        assert_eq!(v["device_id"], "abc");
        // Verify full deserialization round-trip
        let back: DaemonStatus = serde_json::from_str(&json).unwrap();
        match back {
            DaemonStatus::Error {
                kind: ErrorKind::Auth,
                message,
                device_id: Some(d),
            } => {
                assert_eq!(message, "jwt_expired");
                assert_eq!(d, "abc");
            }
            _ => panic!("wrong variant after round-trip"),
        }
    }

    #[test]
    fn daemon_status_all_variants_deserialize() {
        let cases = [
            (r#"{"state":"idle"}"#, "idle"),
            (r#"{"state":"connecting"}"#, "connecting"),
            (r#"{"state":"online","device_id":"dev-1"}"#, "online"),
            (r#"{"state":"offline"}"#, "offline"),
            (
                r#"{"state":"error","kind":"network","message":"x"}"#,
                "error",
            ),
        ];
        for (json, label) in &cases {
            let result: Result<DaemonStatus, _> = serde_json::from_str(json);
            assert!(
                result.is_ok(),
                "failed to deserialize {label}: {:?}",
                result.err()
            );
        }
    }

    #[test]
    fn daemon_status_error_no_device_id_omitted() {
        let s = DaemonStatus::Error {
            kind: ErrorKind::Network,
            message: "timeout".into(),
            device_id: None,
        };
        let json = serde_json::to_string(&s).unwrap();
        assert!(!json.contains("device_id"));
    }

    #[test]
    fn daemon_status_online_serializes_device_id() {
        let s = DaemonStatus::Online {
            device_id: "dev-abc123".into(),
        };
        let json = serde_json::to_string(&s).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["state"], "online");
        assert_eq!(v["device_id"], "dev-abc123");
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

    #[test]
    fn start_config_custom_heartbeat() {
        let json = r#"{
            "team9_user_id": "uuid",
            "hub_url": "wss://x",
            "device_jwt": "j",
            "jwt_expires_at": 0,
            "heartbeat_interval_seconds": 30
        }"#;
        let cfg: StartConfig = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.heartbeat_interval_seconds, 30);
    }

    #[test]
    fn duplicate_start_reuses_live_matching_session() {
        assert!(should_reuse_session_keys_and_status(
            "user-1",
            "wss://hub/ws",
            "device-1",
            "user-1",
            "wss://hub/ws",
            "device-1",
            &ahandd::DaemonStatus::Connecting,
        ));
        assert!(should_reuse_session_keys_and_status(
            "user-1",
            "wss://hub/ws",
            "device-1",
            "user-1",
            "wss://hub/ws",
            "device-1",
            &ahandd::DaemonStatus::Online {
                device_id: "device-1".into(),
            },
        ));
    }

    #[test]
    fn duplicate_start_does_not_reuse_mismatched_or_terminal_session() {
        assert!(!should_reuse_session_keys_and_status(
            "user-1",
            "wss://hub/ws",
            "device-1",
            "user-2",
            "wss://hub/ws",
            "device-1",
            &ahandd::DaemonStatus::Online {
                device_id: "device-1".into(),
            },
        ));
        assert!(!should_reuse_session_keys_and_status(
            "user-1",
            "wss://hub/ws",
            "device-1",
            "user-1",
            "wss://other/ws",
            "device-1",
            &ahandd::DaemonStatus::Connecting,
        ));
        assert!(!should_reuse_session_keys_and_status(
            "user-1",
            "wss://hub/ws",
            "device-1",
            "user-1",
            "wss://hub/ws",
            "device-1",
            &ahandd::DaemonStatus::Error {
                kind: ahandd::ErrorKind::Auth,
                message: "jwt expired".into(),
            },
        ));
    }

    #[test]
    fn error_kind_from_ahandd_auth() {
        let k: ErrorKind = ahandd::ErrorKind::Auth.into();
        assert!(matches!(k, ErrorKind::Auth));
    }

    #[test]
    fn error_kind_from_ahandd_network() {
        let k: ErrorKind = ahandd::ErrorKind::Network.into();
        assert!(matches!(k, ErrorKind::Network));
    }

    #[test]
    fn error_kind_from_ahandd_other() {
        let k: ErrorKind = ahandd::ErrorKind::Other.into();
        assert!(matches!(k, ErrorKind::Other));
    }

    #[test]
    fn reload_error_serialize_shape() {
        // Verify the camelCase tagged-union shape expected by the TS side.
        let e = ReloadError::ShutdownTimeout;
        let json = serde_json::to_string(&e).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["kind"], "shutdownTimeout");

        let e = ReloadError::SpawnFailedRolledBack {
            primary: "primary boom".into(),
        };
        let v: serde_json::Value =
            serde_json::from_value(serde_json::to_value(&e).unwrap()).unwrap();
        assert_eq!(v["kind"], "spawnFailedRolledBack");
        assert_eq!(v["primary"], "primary boom");

        let e = ReloadError::SpawnFailedNoRollback {
            primary: "p".into(),
            rollback: "r".into(),
        };
        let v: serde_json::Value =
            serde_json::from_value(serde_json::to_value(&e).unwrap()).unwrap();
        assert_eq!(v["kind"], "spawnFailedNoRollback");
        assert_eq!(v["primary"], "p");
        assert_eq!(v["rollback"], "r");
    }

    #[test]
    fn reload_error_display_messages_match_thiserror() {
        assert_eq!(
            format!("{}", ReloadError::ShutdownTimeout),
            "daemon shutdown timed out after 5s"
        );
        assert_eq!(
            format!(
                "{}",
                ReloadError::SpawnFailedRolledBack {
                    primary: "boom".into()
                }
            ),
            "respawn failed, rolled back to previous config: boom"
        );
        assert_eq!(
            format!(
                "{}",
                ReloadError::SpawnFailedNoRollback {
                    primary: "p".into(),
                    rollback: "r".into(),
                }
            ),
            "respawn failed and rollback also failed; daemon is offline"
        );
    }

    #[tokio::test]
    async fn reload_with_no_active_session_returns_no_rollback_error() {
        // Calling reload() before start() is a precondition violation.
        // We surface SpawnFailedNoRollback rather than a panic so the
        // command layer can render the same banner as a real failure.
        let rt = AhandRuntime::new();
        match rt.reload().await {
            Err(ReloadError::SpawnFailedNoRollback { primary, .. }) => {
                assert!(primary.contains("no active session"));
            }
            other => panic!("expected SpawnFailedNoRollback, got {other:?}"),
        }
    }

    #[test]
    fn start_config_config_path_optional_and_round_trips() {
        // Without config_path
        let json = r#"{
            "team9_user_id": "uuid",
            "hub_url": "wss://x",
            "device_jwt": "j",
            "jwt_expires_at": 0
        }"#;
        let cfg: StartConfig = serde_json::from_str(json).unwrap();
        assert!(cfg.config_path.is_none());

        // With config_path
        let json = r#"{
            "team9_user_id": "uuid",
            "hub_url": "wss://x",
            "device_jwt": "j",
            "jwt_expires_at": 0,
            "config_path": "/tmp/ahandd/config.toml"
        }"#;
        let cfg: StartConfig = serde_json::from_str(json).unwrap();
        assert_eq!(
            cfg.config_path
                .as_ref()
                .map(|p| p.to_string_lossy().to_string()),
            Some("/tmp/ahandd/config.toml".to_string())
        );
    }

    #[test]
    fn build_daemon_config_browser_enabled_defaults_false_without_overlay() {
        let inputs = StartupInputs {
            hub_url: "wss://hub/ws".into(),
            device_jwt: "jwt".into(),
            identity_dir: PathBuf::from("/tmp/id"),
            device_id: "dev1".into(),
            heartbeat_interval: Duration::from_secs(30),
        };
        let cfg = build_daemon_config(None, &inputs);
        assert!(!cfg.browser_enabled);
        assert_eq!(cfg.hub_url, "wss://hub/ws");
        assert_eq!(cfg.device_jwt, "jwt");
        assert_eq!(cfg.device_id.as_deref(), Some("dev1"));
        assert_eq!(cfg.heartbeat_interval, Duration::from_secs(30));
    }

    // ── reload() integration tests ──────────────────────────────────────
    //
    // These four tests cover the happy path and three failure modes for
    // `AhandRuntime::reload()`. They require either:
    //   (a) a real ahandd daemon (heavy, requires WebSocket hub fixture), OR
    //   (b) injection of a mock `DaemonHandle` / `spawn` boundary.
    //
    // ahandd does not currently expose a mocking surface, and introducing
    // a local `trait DaemonAdapter` wrapper would touch every call site in
    // start()/stop()/reload() with non-trivial blast radius. Per Phase C
    // plan §Task 13 Step 6, leaving these as `#[ignore]`'d todos is the
    // accepted fallback — real bodies will land in a follow-up after the
    // mock-DaemonHandle infrastructure is decided. The non-ignored tests
    // above (`reload_with_no_active_session_returns_no_rollback_error`,
    // `reload_error_serialize_shape`, `reload_error_display_messages_match_thiserror`,
    // `build_daemon_config_browser_enabled_defaults_false_without_overlay`,
    // and `start_config_config_path_optional_and_round_trips`) cover the
    // contract surface that doesn't depend on a live daemon.
    //
    // TODO(task-13-followup): blocked on mock-DaemonHandle test infrastructure.

    #[tokio::test]
    #[ignore = "blocked on mock-DaemonHandle test infrastructure (Phase C plan §Task 13 Step 6)"]
    async fn reload_happy_path_respawns_with_new_config() {
        todo!("implement after deciding on mock strategy for ahandd::spawn / DaemonHandle");
    }

    #[tokio::test]
    #[ignore = "blocked on mock-DaemonHandle test infrastructure (Phase C plan §Task 13 Step 6)"]
    async fn reload_shutdown_timeout_surfaces_error() {
        todo!("implement after deciding on mock strategy for ahandd::spawn / DaemonHandle");
    }

    #[tokio::test]
    #[ignore = "blocked on mock-DaemonHandle test infrastructure (Phase C plan §Task 13 Step 6)"]
    async fn reload_rollback_on_spawn_failure() {
        todo!("implement after deciding on mock strategy for ahandd::spawn / DaemonHandle");
    }

    #[tokio::test]
    #[ignore = "blocked on mock-DaemonHandle test infrastructure (Phase C plan §Task 13 Step 6)"]
    async fn reload_hard_fail_when_rollback_also_fails() {
        todo!("implement after deciding on mock strategy for ahandd::spawn / DaemonHandle");
    }
}
