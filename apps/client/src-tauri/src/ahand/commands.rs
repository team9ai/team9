use tauri::{AppHandle, State};

use super::{
    identity::IdentityDto,
    runtime::{AhandRuntime, DaemonStatus, StartConfig, StartResult},
};

/// Get (or create) the Ed25519 identity for a team9 user.
/// Idempotent — repeated calls return the same key.
/// Runs on a blocking thread because key generation and filesystem I/O are synchronous.
#[tauri::command]
pub async fn ahand_get_identity(
    app: AppHandle,
    team9_user_id: String,
) -> Result<IdentityDto, String> {
    tokio::task::spawn_blocking(move || {
        super::identity::load_or_create(&app, &team9_user_id)
    })
    .await
    .map_err(|e| format!("identity task panicked: {e}"))?
}

/// Start the embedded daemon for this user.
/// Stops any previously active session first.
#[tauri::command]
pub async fn ahand_start(
    app: AppHandle,
    runtime: State<'_, AhandRuntime>,
    cfg: StartConfig,
) -> Result<StartResult, String> {
    runtime.start(&app, cfg).await
}

/// Stop the embedded daemon. Idempotent.
#[tauri::command]
pub async fn ahand_stop(
    app: AppHandle,
    runtime: State<'_, AhandRuntime>,
) -> Result<(), String> {
    runtime.stop(Some(&app)).await
}

/// Snapshot of the current daemon status. Does not wait for a change.
#[tauri::command]
pub async fn ahand_status(runtime: State<'_, AhandRuntime>) -> Result<DaemonStatus, String> {
    Ok(runtime.status().await)
}

/// Delete the on-disk identity directory for a user.
/// Must only be called after the daemon is stopped and the device removed from the backend.
#[tauri::command]
pub async fn ahand_clear_identity(
    app: AppHandle,
    team9_user_id: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        super::identity::remove(&app, &team9_user_id)
    })
    .await
    .map_err(|e| format!("clear-identity task panicked: {e}"))?
}
