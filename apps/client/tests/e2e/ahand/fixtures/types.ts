export interface DeviceDtoFixture {
  id: string;
  hubDeviceId: string;
  nickname: string;
  platform: "macos" | "windows" | "linux";
  hostname: string | null;
  status: "active" | "revoked";
  lastSeenAt: string | null;
  isOnline: boolean | null;
  createdAt: string;
}

export type DaemonStatusFixture =
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

export interface MockUser {
  id: string;
  username: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
  isActive: boolean;
  language: string | null;
  timeZone: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MockWorkspace {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  role: "owner" | "admin" | "member";
}

export const RUN_AGAINST_DEV_HUB = process.env.RUN_AGAINST_DEV_HUB === "1";
