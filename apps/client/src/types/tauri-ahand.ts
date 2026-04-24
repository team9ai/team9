// Hand-maintained TS bindings for the ahand Tauri command surface.
// Rust serde field names:
//   - DaemonStatus: tagged "state", camelCase variants (from #[serde(rename_all = "camelCase")])
//   - StartConfig:  snake_case fields (serde default, matching Rust struct field names)
//   - StartResult:  snake_case fields
//   - IdentityDto:  camelCase fields (explicit #[serde(rename = "...")])

export interface IdentityDto {
  deviceId: string;
  publicKeyB64: string;
}

export interface StartConfig {
  team9_user_id: string;
  hub_url: string;
  device_jwt: string;
  jwt_expires_at: number;
  heartbeat_interval_seconds?: number;
}

export interface StartResult {
  device_id: string;
}

export type DaemonStatus =
  | { state: "idle" }
  | { state: "connecting" }
  | { state: "online"; device_id: string }
  | { state: "offline" }
  | {
      state: "error";
      kind: "auth" | "network" | "other";
      message: string;
      device_id?: string;
    };
