import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface UserAhandState {
  enabled: boolean;
  deviceId: string | null;
  hubUrl: string;
}

interface AhandStore {
  /** Keyed by team9 userId. */
  usersEnabled: Record<string, UserAhandState>;

  getDeviceIdForUser(userId: string): string | null;
  getHubUrlForUser(userId: string): string;
  setDeviceIdForUser(
    userId: string,
    deviceId: string | null,
    enabled: boolean,
    hubUrl?: string,
  ): void;
  clearUser(userId: string): void;
}

export const useAhandStore = create<AhandStore>()(
  persist(
    (set, get) => ({
      usersEnabled: {},
      getDeviceIdForUser(userId) {
        // Return the stored deviceId regardless of `enabled`. A disabled
        // device (toggle off) is still "this Mac" from the UI's point of
        // view — the daemon is just stopped. Gating on `enabled` here
        // broke OtherDevicesList's excludeLocal filter after toggle-off,
        // making the local device incorrectly appear under "My Other
        // Devices".
        return get().usersEnabled[userId]?.deviceId ?? null;
      },
      getHubUrlForUser(userId) {
        return get().usersEnabled[userId]?.hubUrl ?? "";
      },
      setDeviceIdForUser(userId, deviceId, enabled, hubUrl) {
        const prev = get().usersEnabled[userId];
        set({
          usersEnabled: {
            ...get().usersEnabled,
            [userId]: {
              enabled,
              deviceId,
              hubUrl: hubUrl ?? prev?.hubUrl ?? "",
            },
          },
        });
      },
      clearUser(userId) {
        const next = { ...get().usersEnabled };
        delete next[userId];
        set({ usersEnabled: next });
      },
    }),
    { name: "ahand" },
  ),
);
