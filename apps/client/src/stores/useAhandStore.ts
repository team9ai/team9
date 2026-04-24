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
        const entry = get().usersEnabled[userId];
        return entry?.enabled ? (entry.deviceId ?? null) : null;
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
