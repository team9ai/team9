/**
 * E2E-only side-effect module: exposes Zustand stores on
 * `window.__team9Stores` so Playwright tests can read/seed app state
 * deterministically.
 *
 * Wired in via `vite.config.ts` only when `VITE_E2E_MOCK=1`. The original
 * sources are not modified.
 */
import { useAppStore } from "@/stores/useAppStore";
import { useAhandStore } from "@/stores/useAhandStore";

interface Team9TestHooks {
  app: typeof useAppStore;
  ahand: typeof useAhandStore;
  /**
   * Seed the current user — a stand-in for the /v1/auth/me round trip.
   * Tests call this synchronously before issuing UI actions that read
   * `useUser()` (e.g. ThisMacSection's toggle).
   */
  setUser: (user: {
    id: string;
    name: string;
    email: string;
    avatarUrl?: string | null;
    createdAt?: string;
  }) => void;
}

const w = window as unknown as { __team9Stores?: Team9TestHooks };

w.__team9Stores = {
  app: useAppStore,
  ahand: useAhandStore,
  setUser(user) {
    useAppStore.getState().setUser(user);
  },
};

// Auto-seed from a sentinel localStorage key the harness writes (avoids
// races where the test's `evaluate()` call runs before the React tree
// has mounted — and saves every spec from having to do this manually).
try {
  const raw = localStorage.getItem("__e2e_seed_user");
  if (raw) {
    const seeded = JSON.parse(raw) as Parameters<Team9TestHooks["setUser"]>[0];
    useAppStore.getState().setUser(seeded);
  }
} catch {
  /* ignore */
}

export {};
