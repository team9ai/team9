import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface UserAhandState {
  enabled: boolean;
  deviceId: string | null;
}

interface AhandStore {
  /** Keyed by team9 userId. */
  usersEnabled: Record<string, UserAhandState>;

  getDeviceIdForUser(userId: string): string | null;
  setDeviceIdForUser(
    userId: string,
    deviceId: string | null,
    enabled: boolean,
  ): void;
  clearUser(userId: string): void;
}

export const useAhandStore = create<AhandStore>()(
  persist(
    (set, get) => ({
      usersEnabled: {},
      getDeviceIdForUser(userId) {
        const entry = get().usersEnabled[userId];
        return entry?.enabled ? (entry.deviceId ?? null) : null;
      },
      setDeviceIdForUser(userId, deviceId, enabled) {
        set({
          usersEnabled: {
            ...get().usersEnabled,
            [userId]: { enabled, deviceId },
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
