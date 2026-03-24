mod ahand;

use tauri::Manager;
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_autostart::ManagerExt;

/// Start aHand daemon in openclaw-gateway mode.
/// Called by the React frontend after obtaining the gateway URL from Team9 API.
#[tauri::command]
fn ahand_start(
    gateway_url: String,
    auth_token: Option<String>,
    node_id: String,
) -> Result<(), String> {
    ahand::start(&gateway_url, auth_token.as_deref(), &node_id)
}

#[tauri::command]
fn ahand_stop() {
    ahand::stop();
}

/// Returns true if the daemon process is alive.
/// Does NOT guarantee gateway connectivity — use Team9 API for that.
#[tauri::command]
fn ahand_is_running() -> bool {
    ahand::is_running()
}

/// Returns the stable device ID for this machine.
/// Used by the frontend to identify our pending pairing request.
#[tauri::command]
fn ahand_get_node_id() -> String {
    ahand::get_or_create_node_id()
}

/// Toggle WebView DevTools (works in both debug and release builds).
#[tauri::command]
fn toggle_devtools(window: tauri::WebviewWindow) {
    if window.is_devtools_open() {
        window.close_devtools();
    } else {
        window.open_devtools();
    }
}

/// Returns the cryptographic device ID (SHA256 of Ed25519 public key) stored
/// in ~/.ahand/device-identity.json. This matches the `deviceId` field in the
/// OpenClaw gateway's paired device list, enabling precise approval checks.
/// Returns None if the daemon has never run on this machine.
#[tauri::command]
fn ahand_get_device_id() -> Option<String> {
    ahand::get_crypto_device_id()
}

/// Start aHand daemon without auto-installing browser dependencies.
/// Used when the frontend manages browser setup separately.
#[tauri::command]
fn ahand_start_daemon_only(
    gateway_url: String,
    auth_token: Option<String>,
    node_id: String,
) -> Result<(), String> {
    ahand::start_daemon_only(&gateway_url, auth_token.as_deref(), &node_id)
}

/// Install browser automation dependencies via ahandd browser-init.
#[tauri::command]
fn ahand_browser_init(force: bool) -> Result<(), String> {
    ahand::browser_init(force)
}

/// Install browser automation dependencies with step-by-step progress events.
/// Emits `ahand-setup-step` events to the frontend as each step completes.
#[tauri::command]
fn ahand_browser_init_with_progress(app: tauri::AppHandle) -> Result<(), String> {
    ahand::browser_init_with_progress(&app)
}

/// Check if browser automation dependencies are installed.
#[tauri::command]
fn ahand_browser_is_ready() -> bool {
    ahand::browser_is_ready()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            #[cfg(not(debug_assertions))]
            {
                let config_dir = app.path().app_config_dir().ok();
                let marker = config_dir
                    .as_ref()
                    .map(|d| d.join(".autostart_initialized"));

                let current_exe = std::env::current_exe()
                    .ok()
                    .and_then(|p| p.canonicalize().ok().or(Some(p)))
                    .map(|p| p.display().to_string());
                let stored_exe = marker
                    .as_ref()
                    .and_then(|p| std::fs::read_to_string(p).ok());

                let is_first_run = stored_exe.is_none();
                let path_changed = matches!(
                    (&stored_exe, &current_exe),
                    (Some(stored), Some(current)) if stored != current
                );

                // Enable autostart on first run. On path change (reinstall /
                // relocation), only re-enable if autostart is not currently
                // active — this avoids spuriously re-enabling when the path
                // differs only due to normalization (e.g. AppImage symlink vs
                // current_exe, or macOS canonical path differences).
                let needs_enable = is_first_run
                    || (path_changed
                        && !app.autolaunch().is_enabled().unwrap_or(true));

                if needs_enable {
                    match app.autolaunch().enable() {
                        Ok(()) => {
                            if let Some(ref dir) = config_dir {
                                let _ = std::fs::create_dir_all(dir);
                            }
                            if let Some(ref path) = marker {
                                let exe_str = current_exe.unwrap_or_default();
                                let _ = std::fs::write(path, exe_str);
                            }
                        }
                        Err(e) => {
                            eprintln!("Failed to enable autostart: {e}");
                        }
                    }
                } else if path_changed {
                    // Path changed but autostart is already active — update the
                    // marker to avoid rechecking on every launch.
                    if let Some(ref dir) = config_dir {
                        let _ = std::fs::create_dir_all(dir);
                    }
                    if let Some(ref path) = marker {
                        let exe_str = current_exe.unwrap_or_default();
                        let _ = std::fs::write(path, exe_str);
                    }
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            toggle_devtools,
            ahand_start,
            ahand_start_daemon_only,
            ahand_stop,
            ahand_is_running,
            ahand_get_node_id,
            ahand_get_device_id,
            ahand_browser_init,
            ahand_browser_init_with_progress,
            ahand_browser_is_ready,
        ])
        .on_window_event(|_win, event| {
            if let tauri::WindowEvent::Destroyed = event {
                ahand::stop();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
