import { create } from "zustand";
import type { ChannelInfo, ConnectionProfile } from "@/lib/types";

type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "authenticating"
  | "connected"
  | "error";

interface ConnectionStore {
  status: ConnectionStatus;
  errorMessage: string | null;
  serverUrl: string;
  token: string;
  botUserId: string | null;
  botUsername: string | null;
  channels: ChannelInfo[];
  latencyMs: number | null;
  profiles: ConnectionProfile[];
  activeProfileId: string | null;

  setStatus: (status: ConnectionStatus, error?: string) => void;
  setServerUrl: (url: string) => void;
  setToken: (token: string) => void;
  setBotIdentity: (userId: string, username: string) => void;
  setChannels: (channels: ChannelInfo[]) => void;
  setLatency: (ms: number) => void;
  reset: () => void;

  loadProfiles: () => void;
  saveProfile: (profile: Omit<ConnectionProfile, "id" | "lastUsed">) => void;
  deleteProfile: (id: string) => void;
  applyProfile: (id: string) => void;
}

const PROFILES_KEY = "debugger_profiles";
const MAX_PROFILES = 5;

export const useConnectionStore = create<ConnectionStore>((set, get) => ({
  status: "disconnected",
  errorMessage: null,
  serverUrl: "http://localhost:3000",
  token: "",
  botUserId: null,
  botUsername: null,
  channels: [],
  latencyMs: null,
  profiles: [],
  activeProfileId: null,

  setStatus: (status, error) => set({ status, errorMessage: error ?? null }),

  setServerUrl: (serverUrl) => set({ serverUrl }),
  setToken: (token) => set({ token }),

  setBotIdentity: (userId, username) =>
    set({ botUserId: userId, botUsername: username }),

  setChannels: (channels) => set({ channels }),
  setLatency: (ms) => set({ latencyMs: ms }),

  reset: () =>
    set({
      status: "disconnected",
      errorMessage: null,
      botUserId: null,
      botUsername: null,
      channels: [],
      latencyMs: null,
    }),

  loadProfiles: () => {
    try {
      const raw = localStorage.getItem(PROFILES_KEY);
      if (raw) set({ profiles: JSON.parse(raw) });
    } catch {
      // ignore corrupted localStorage
    }
  },

  saveProfile: (profile) => {
    const { profiles } = get();
    const id = crypto.randomUUID();
    const newProfile: ConnectionProfile = {
      ...profile,
      id,
      lastUsed: Date.now(),
    };
    const updated = [newProfile, ...profiles].slice(0, MAX_PROFILES);
    localStorage.setItem(PROFILES_KEY, JSON.stringify(updated));
    set({ profiles: updated, activeProfileId: id });
  },

  deleteProfile: (id) => {
    const { profiles } = get();
    const updated = profiles.filter((p) => p.id !== id);
    localStorage.setItem(PROFILES_KEY, JSON.stringify(updated));
    set({ profiles: updated });
  },

  applyProfile: (id) => {
    const { profiles } = get();
    const profile = profiles.find((p) => p.id === id);
    if (profile) {
      set({
        serverUrl: profile.serverUrl,
        token: profile.token,
        activeProfileId: id,
      });
      const updated = profiles.map((p) =>
        p.id === id ? { ...p, lastUsed: Date.now() } : p,
      );
      localStorage.setItem(PROFILES_KEY, JSON.stringify(updated));
      set({ profiles: updated });
    }
  },
}));
