import { useEffect } from "react";
import { isTauriApp } from "@/lib/tauri";
import { useAppStore } from "@/stores/useAppStore";
import { useAhandStore } from "@/stores/useAhandStore";
import { ahandTauri } from "@/services/ahand-tauri";
import { ahandApi } from "@/services/ahand-api";
import { toast } from "sonner";

export function useAhandBootstrap() {
  const userId = useAppStore((s) => s.user?.id ?? null);

  // Resume daemon when user logs in
  useEffect(() => {
    if (!isTauriApp() || !userId) return;
    const store = useAhandStore.getState();
    const entry = store.usersEnabled[userId];
    if (!entry?.enabled || !entry.deviceId) return;
    void resume(userId, entry.deviceId);
  }, [userId]);

  // Stop daemon when user logs out (userId transitions to null)
  useEffect(() => {
    if (!isTauriApp()) return;
    if (userId !== null) return;
    void ahandTauri.stop().catch(() => {});
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
    toast.error(`aHand resume failed: ${msg}`);
  }
}
