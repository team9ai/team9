// commands.rs (#[tauri::command] surface) added in Task 7.4

pub mod identity;
pub mod runtime;

pub use runtime::{AhandRuntime, DaemonStatus, ErrorKind, StartConfig, StartResult};
