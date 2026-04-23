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
        let device_id = identity::device_id_from_dir(&identity_dir);

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
            hub_device_id: device_id.clone(),
            status_forwarder,
        });

        Ok(StartResult { device_id })
    }

    /// Stop the active session. Idempotent — returns Ok when nothing is running.
    pub async fn stop(&self) -> Result<(), String> {
        let mut guard = self.inner.lock().await;
        if let Some(session) = guard.take() {
            Self::shutdown_session(session).await;
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
        assert!(rt.stop().await.is_ok());
        assert!(rt.stop().await.is_ok());
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
