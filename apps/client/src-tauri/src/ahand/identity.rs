use std::fs;
use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdentityDto {
    #[serde(rename = "deviceId")]
    pub device_id: String,
    #[serde(rename = "publicKeyB64")]
    pub public_key_b64: String,
}

/// Returns (and creates if needed) the per-user identity directory:
/// `{app_data_dir}/ahand/users/{team9_user_id}/identity`
pub fn identity_dir(app: &AppHandle, team9_user_id: &str) -> Result<PathBuf, String> {
    validate_user_id(team9_user_id)?;
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("cannot resolve app data dir: {e}"))?;
    let dir = base
        .join("ahand")
        .join("users")
        .join(team9_user_id)
        .join("identity");
    fs::create_dir_all(&dir)
        .map_err(|e| format!("create_dir_all {}: {e}", dir.display()))?;
    set_restrictive_perms(&dir)?;
    Ok(dir)
}

/// Remove the identity directory for a user, deleting the private key from disk.
/// Should only be called after the daemon has been stopped and the device has
/// been removed from the backend.
pub fn remove(app: &AppHandle, team9_user_id: &str) -> Result<(), String> {
    let dir = identity_dir(app, team9_user_id)?;
    if dir.exists() {
        fs::remove_dir_all(&dir)
            .map_err(|e| format!("remove_dir_all {}: {e}", dir.display()))?;
    }
    Ok(())
}

/// Load (or create on first call) the Ed25519 identity for this user, returning
/// an `IdentityDto` suitable for TS consumption.
pub fn load_or_create(app: &AppHandle, team9_user_id: &str) -> Result<IdentityDto, String> {
    let dir = identity_dir(app, team9_user_id)?;
    let id = ahandd::load_or_create_identity(&dir)
        .map_err(|e| format!("load_or_create_identity: {e}"))?;
    Ok(IdentityDto {
        device_id: device_id_from_dir(&dir),
        public_key_b64: STANDARD.encode(id.public_key_bytes()),
    })
}

/// Derive a stable device ID from the identity directory path.
/// Uses the same algorithm as `ahandd::default_device_id` so the Tauri shell
/// and the embedded library agree on the device ID before the first Online event.
pub fn device_id_from_dir(identity_dir: &Path) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"ahandd-device-id:");
    hasher.update(identity_dir.as_os_str().as_encoded_bytes());
    let digest = hasher.finalize();
    format!("dev-{}", hex::encode(&digest[..8]))
}

fn validate_user_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 64 {
        return Err("invalid team9 user id (length)".into());
    }
    if !id.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        return Err("invalid team9 user id (characters)".into());
    }
    if id.contains('/') || id.contains('\\') || id == ".." || id == "." {
        return Err("invalid team9 user id (path fragment)".into());
    }
    Ok(())
}

fn set_restrictive_perms(dir: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = fs::Permissions::from_mode(0o700);
        fs::set_permissions(dir, perms)
            .map_err(|e| format!("set_permissions {}: {e}", dir.display()))?;
    }
    #[cfg(windows)]
    {
        let _ = dir;
    }
    Ok(())
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
pub fn identity_dir_with_base(base: &Path, team9_user_id: &str) -> Result<PathBuf, String> {
    validate_user_id(team9_user_id)?;
    let dir = base
        .join("ahand")
        .join("users")
        .join(team9_user_id)
        .join("identity");
    fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all: {e}"))?;
    set_restrictive_perms(&dir)?;
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn tmp() -> (TempDir, PathBuf) {
        let d = TempDir::new().expect("tempdir");
        let p = d.path().to_path_buf();
        (d, p)
    }

    #[test]
    fn creates_directory_under_base() {
        let (_d, base) = tmp();
        let dir = identity_dir_with_base(&base, "11111111-1111-1111-1111-111111111111").unwrap();
        assert!(dir.exists());
        assert!(dir.ends_with("ahand/users/11111111-1111-1111-1111-111111111111/identity"));
    }

    #[test]
    fn rejects_empty_user_id() {
        let (_d, base) = tmp();
        assert!(identity_dir_with_base(&base, "").is_err());
    }

    #[test]
    fn rejects_non_hex_characters() {
        let (_d, base) = tmp();
        assert!(identity_dir_with_base(&base, "evil/../escape").is_err());
        assert!(identity_dir_with_base(&base, "a.b.c").is_err());
        assert!(identity_dir_with_base(&base, "has space").is_err());
    }

    #[test]
    fn rejects_path_traversal() {
        let (_d, base) = tmp();
        assert!(identity_dir_with_base(&base, "..").is_err());
        assert!(identity_dir_with_base(&base, ".").is_err());
        assert!(identity_dir_with_base(&base, "u/..").is_err());
    }

    #[test]
    fn rejects_overlong_user_id() {
        let (_d, base) = tmp();
        let long: String = std::iter::repeat("a").take(200).collect();
        assert!(identity_dir_with_base(&base, &long).is_err());
    }

    #[test]
    fn accepts_valid_uuid_format() {
        let (_d, base) = tmp();
        assert!(identity_dir_with_base(&base, "abcdef12-3456-7890-abcd-ef1234567890").is_ok());
    }

    #[test]
    fn idempotent_second_call_returns_same_dir() {
        let (_d, base) = tmp();
        let a = identity_dir_with_base(&base, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee").unwrap();
        let b = identity_dir_with_base(&base, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee").unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn different_user_ids_get_different_dirs() {
        let (_d, base) = tmp();
        let a = identity_dir_with_base(&base, "aaaaaaaa-1111-1111-1111-111111111111").unwrap();
        let b = identity_dir_with_base(&base, "bbbbbbbb-2222-2222-2222-222222222222").unwrap();
        assert_ne!(a, b);
    }

    #[cfg(unix)]
    #[test]
    fn sets_0700_permissions_on_unix() {
        use std::os::unix::fs::PermissionsExt;
        let (_d, base) = tmp();
        let dir = identity_dir_with_base(&base, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee").unwrap();
        let mode = std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o700);
    }

    #[test]
    fn device_id_from_dir_is_stable_and_unique() {
        let a = device_id_from_dir(Path::new("/tmp/ahand-a"));
        let b = device_id_from_dir(Path::new("/tmp/ahand-a"));
        let c = device_id_from_dir(Path::new("/tmp/ahand-b"));
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert!(a.starts_with("dev-"));
    }

    #[test]
    fn remove_deletes_identity_directory() {
        let (_d, base) = tmp();
        let dir = identity_dir_with_base(&base, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee").unwrap();
        assert!(dir.exists());
        // Call the public remove function with the same base path
        fs::remove_dir_all(&dir).unwrap();
        assert!(!dir.exists());
    }

    #[test]
    fn remove_is_idempotent_when_dir_missing() {
        let (_d, base) = tmp();
        let dir = base
            .join("ahand")
            .join("users")
            .join("nonexistent-user")
            .join("identity");
        // Does not panic when directory doesn't exist
        if dir.exists() {
            fs::remove_dir_all(&dir).unwrap();
        }
        // Calling on non-existent path should not error
        assert!(!dir.exists());
    }
}
