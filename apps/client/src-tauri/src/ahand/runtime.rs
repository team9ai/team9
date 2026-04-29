use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

use super::identity;

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

// ── Internal state ─────────────────────────────────────────────────────────

struct ActiveSession {
    handle: ahandd::DaemonHandle,
    team9_user_id: String,
    hub_url: String,
    hub_device_id: String,
    status_forwarder: JoinHandle<()>,
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
            if should_reuse_active_session(
                prev,
                &cfg.team9_user_id,
                &cfg.hub_url,
                &device_id,
            ) {
                return Ok(StartResult {
                    device_id: prev.hub_device_id.clone(),
                });
            }
        }

        let daemon_cfg = ahandd::DaemonConfig::builder(
            &cfg.hub_url,
            &cfg.device_jwt,
            identity_dir,
        )
        .device_id(&device_id)
        .session_mode(ahandd::SessionMode::AutoAccept)
        .browser_enabled(false)
        .heartbeat_interval(Duration::from_secs(cfg.heartbeat_interval_seconds))
        .build();

        let handle = ahandd::spawn(daemon_cfg)
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

    async fn shutdown_session(session: ActiveSession) {
        let _ = session.handle.shutdown().await;
        // Abort then await so the forwarder finishes its current poll (delivering
        // the final Offline status event) before we return.
        session.status_forwarder.abort();
        let _ = session.status_forwarder.await;
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
            DaemonStatus::Error { kind: ErrorKind::Auth, message, device_id: Some(d) } => {
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
            (r#"{"state":"error","kind":"network","message":"x"}"#, "error"),
        ];
        for (json, label) in &cases {
            let result: Result<DaemonStatus, _> = serde_json::from_str(json);
            assert!(result.is_ok(), "failed to deserialize {label}: {:?}", result.err());
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
}
