import { useEffect, useRef } from "react";
import { isTauriApp } from "@/lib/tauri";
import { useAppStore } from "@/stores/useAppStore";
import { useAhandStore } from "@/stores/useAhandStore";
import { ahandTauri } from "@/services/ahand-tauri";
import { ahandApi } from "@/services/ahand-api";
import { toast } from "sonner";
import i18n from "@/i18n";

export function useAhandBootstrap() {
  const userId = useAppStore((s) => s.user?.id ?? null);
  const prevUserIdRef = useRef<string | null>(undefined as unknown as null);

  // Resume daemon when user logs in
  useEffect(() => {
    if (!isTauriApp() || !userId) return;
    const store = useAhandStore.getState();
    const entry = store.usersEnabled[userId];
    if (!entry?.enabled || !entry.deviceId) return;
    void resume(userId, entry.deviceId);
  }, [userId]);

  // Stop daemon only when userId transitions from a real value to null (logout).
  // Guard against the initial render where prevUserIdRef is unset.
  useEffect(() => {
    const prev = prevUserIdRef.current;
    prevUserIdRef.current = userId;
    if (!isTauriApp()) return;
    if (userId === null && prev !== null && prev !== undefined) {
      void ahandTauri.stop().catch(() => {});
    }
  }, [userId]);
}

async function resume(userId: string, cachedDeviceId: string): Promise<void> {
  try {
    const devices = await ahandApi.list({ includeOffline: true });
    const row = devices.find((d) => d.hubDeviceId === cachedDeviceId);
    if (!row) {
      useAhandStore.getState().setDeviceIdForUser(userId, null, false);
      return;
    }
    const { deviceJwt, jwtExpiresAt } = await ahandApi.refreshToken(row.id);
    await ahandTauri.start({
      team9_user_id: userId,
      hub_url: useAhandStore.getState().getHubUrlForUser(userId),
      device_jwt: deviceJwt,
      jwt_expires_at: Math.floor(new Date(jwtExpiresAt).getTime() / 1000),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    toast.error(i18n.t("error.resumeFailed", { ns: "ahand", msg }));
  }
}
