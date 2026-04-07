mod ahand;
mod health_server;

use std::sync::Mutex;
use std::time::Duration;

#[cfg(target_os = "macos")]
use objc2::msg_send;
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSView, NSWindow, NSWindowButton};
use serde::Serialize;
use tauri::{Emitter, Manager, State};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_updater::{Error as UpdaterError, Update, UpdaterExt};
use time::format_description::well_known::Rfc3339;

const UPDATE_DOWNLOAD_TIMEOUT_SECS: u64 = 600; // 10 minutes

const DESKTOP_UPDATER_NOT_CONFIGURED: &str = "Desktop updates are not configured for this build.";

#[derive(Default)]
struct PendingUpdate(Mutex<Option<Update>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopUpdateInfo {
    current_version: String,
    version: String,
    notes: Option<String>,
    pub_date: Option<String>,
}

fn configured_updater_target() -> Option<String> {
    option_env!("TEAM9_TAURI_UPDATE_TARGET")
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn build_updater(app: &tauri::AppHandle) -> Result<tauri_plugin_updater::Updater, String> {
    app.updater().map_err(|err| match err {
        UpdaterError::EmptyEndpoints => DESKTOP_UPDATER_NOT_CONFIGURED.to_string(),
        _ => format!("Failed to initialize desktop updater: {err}"),
    })
}

fn map_update(update: &Update) -> DesktopUpdateInfo {
    DesktopUpdateInfo {
        current_version: update.current_version.to_string(),
        version: update.version.to_string(),
        notes: update.body.clone(),
        pub_date: update
            .date
            .as_ref()
            .and_then(|date| date.format(&Rfc3339).ok()),
    }
}

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

#[tauri::command]
fn desktop_get_app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
async fn desktop_check_for_update(
    app: tauri::AppHandle,
    pending_update: State<'_, PendingUpdate>,
) -> Result<Option<DesktopUpdateInfo>, String> {
    let update = build_updater(&app)?
        .check()
        .await
        .map_err(|err| format!("Failed to check for updates: {err}"))?;

    let next_update = update.as_ref().map(map_update);

    let mut pending = pending_update
        .0
        .lock()
        .map_err(|_| "Failed to access pending update state.".to_string())?;
    *pending = update;

    Ok(next_update)
}

#[tauri::command]
async fn desktop_install_update(
    app: tauri::AppHandle,
    pending_update: State<'_, PendingUpdate>,
) -> Result<(), String> {
    let update = {
        let mut pending = pending_update
            .0
            .lock()
            .map_err(|_| "Failed to access pending update state.".to_string())?;
        pending.take()
    };

    let Some(update) = update else {
        return Err("Check for updates before installing a new version.".to_string());
    };

    let app_for_progress = app.clone();
    let app_for_finish = app.clone();
    let mut downloaded: usize = 0;

    let result = tokio::time::timeout(
        Duration::from_secs(UPDATE_DOWNLOAD_TIMEOUT_SECS),
        update.download_and_install(
            move |chunk_length, content_length| {
                downloaded += chunk_length;
                let _ = app_for_progress.emit(
                    "update-download-progress",
                    serde_json::json!({
                        "downloaded": downloaded,
                        "contentLength": content_length,
                    }),
                );
            },
            move || {
                let _ = app_for_finish.emit("update-download-finished", ());
            },
        ),
    )
    .await;

    match result {
        Ok(Ok(())) => app.restart(),
        Ok(Err(err)) => Err(format!("Failed to install update: {err}")),
        Err(_) => Err(
            "Update download timed out. Please check your network connection and try again. You can also download the latest version manually from https://github.com/team9ai/team9/releases/latest"
                .to_string(),
        ),
    }
}

#[tauri::command]
fn desktop_align_traffic_lights(
    window: tauri::WebviewWindow,
    x: f64,
    title_bar_height: f64,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let title_bar_height = title_bar_height.max(0.0);
        let window_for_main = window.clone();

        window
            .run_on_main_thread(move || {
                let result = (|| {
                    // Mirror Tao's traffic-light handling, but also center the buttons
                    // vertically inside our custom top bar height.
                    let ns_window_ptr = window_for_main
                        .ns_window()
                        .map_err(|err| format!("Failed to access native window: {err}"))?;
                    let ns_window: &NSWindow = unsafe { &*ns_window_ptr.cast() };

                    let close = ns_window
                        .standardWindowButton(NSWindowButton::CloseButton)
                        .ok_or_else(|| "Failed to find close button.".to_string())?;
                    let miniaturize = ns_window
                        .standardWindowButton(NSWindowButton::MiniaturizeButton)
                        .ok_or_else(|| "Failed to find minimize button.".to_string())?;
                    let zoom = ns_window
                        .standardWindowButton(NSWindowButton::ZoomButton)
                        .ok_or_else(|| "Failed to find zoom button.".to_string())?;

                    let title_bar_container_view = unsafe {
                        close
                            .superview()
                            .and_then(|view| view.superview())
                            .ok_or_else(|| "Failed to find title bar container.".to_string())?
                    };

                    let close_rect = NSView::frame(&close);
                    let effective_height = title_bar_height.max(close_rect.size.height);

                    let mut title_bar_rect = NSView::frame(&title_bar_container_view);
                    title_bar_rect.size.height = effective_height;
                    title_bar_rect.origin.y = ns_window.frame().size.height - effective_height;
                    let _: () = unsafe { msg_send![&title_bar_container_view, setFrame: title_bar_rect] };

                    let space_between =
                        NSView::frame(&miniaturize).origin.x - close_rect.origin.x;
                    let button_origin_y =
                        ((effective_height - close_rect.size.height) / 2.0).max(0.0);

                    let window_buttons = vec![close, miniaturize.clone(), zoom];
                    for (i, button) in window_buttons.into_iter().enumerate() {
                        let mut rect = NSView::frame(&button);
                        rect.origin.x = x + (i as f64 * space_between);
                        rect.origin.y = button_origin_y;
                        button.setFrameOrigin(rect.origin);
                    }

                    Ok::<(), String>(())
                })();

                if let Err(err) = result {
                    eprintln!("Failed to align macOS traffic lights: {err}");
                }
            })
            .map_err(|err| format!("Failed to schedule traffic light alignment: {err}"))?;

        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, x, title_bar_height);
        Ok(())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut updater_plugin = tauri_plugin_updater::Builder::new();
    if let Some(target) = configured_updater_target() {
        updater_plugin = updater_plugin.target(target);
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(updater_plugin.build())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_notification::init())
        .manage(PendingUpdate::default())
        .setup(|app| {
            tauri::async_runtime::spawn(health_server::start_health_server());

            #[cfg(debug_assertions)]
            let _ = &app;

            #[cfg(not(debug_assertions))]
            {
                let config_dir = app.path().app_config_dir().ok();
                let marker = config_dir
                    .as_ref()
                    .map(|d: &std::path::PathBuf| d.join(".autostart_initialized"));

                // Use the same executable path that tauri-plugin-autostart
                // registers. On Linux AppImage builds the plugin passes
                // the raw APPIMAGE path to auto-launch without canonicalizing,
                // so we must store the raw path to keep the marker aligned.
                #[cfg(target_os = "linux")]
                let current_exe = app
                    .env()
                    .appimage
                    .as_ref()
                    .and_then(|p| p.to_str().map(|s| s.to_string()))
                    .or_else(|| {
                        std::env::current_exe()
                            .ok()
                            .and_then(|p| p.canonicalize().ok().or(Some(p)))
                            .map(|p| p.display().to_string())
                    });

                #[cfg(not(target_os = "linux"))]
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

                // Enable autostart on first run.
                // On path change (reinstall / relocation), refresh the OS
                // startup entry only if autostart is currently enabled — this
                // ensures the entry targets the new executable while
                // respecting the user's choice when they turned it off.
                // Note: is_enabled() only checks whether a startup entry
                // exists, not whether it points at the right binary, so we
                // must call enable() to overwrite the stale entry.
                let autostart_active = app.autolaunch().is_enabled().unwrap_or(false);
                let needs_enable = is_first_run || (path_changed && autostart_active);

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
                    // Path changed but user has autostart disabled — just
                    // update the marker so we don't recheck every launch.
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
            desktop_get_app_version,
            desktop_check_for_update,
            desktop_install_update,
            desktop_align_traffic_lights,
        ])
        .on_window_event(|_win, event| {
            if let tauri::WindowEvent::Destroyed = event {
                ahand::stop();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
