mod ahand;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .invoke_handler(tauri::generate_handler![
            ahand_start,
            ahand_stop,
            ahand_is_running,
            ahand_get_node_id,
        ])
        .on_window_event(|_win, event| {
            if let tauri::WindowEvent::Destroyed = event {
                ahand::stop();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
