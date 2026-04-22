import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useAhandLocalStatus } from "./useAhandLocalStatus";
import { useAppStore } from "@/stores/useAppStore";
import { useAhandStore } from "@/stores/useAhandStore";
import { ahandApi } from "@/services/ahand-api";
import { ahandTauri } from "@/services/ahand-tauri";
import { isTauriApp } from "@/lib/tauri";

const MIN_REFRESH_INTERVAL_MS = 30_000;

export function useAhandJwtRefresh() {
  const status = useAhandLocalStatus();
  const userId = useAppStore((s) => s.user?.id ?? null);
  const lastRefreshAtRef = useRef(0);

  useEffect(() => {
    if (!isTauriApp()) return;
    if (!userId) return;
    if (status.state !== "error") return;
    if (!("kind" in status) || status.kind !== "auth") return;
    const now = Date.now();
    if (now - lastRefreshAtRef.current < MIN_REFRESH_INTERVAL_MS) return;
    lastRefreshAtRef.current = now;
    void doRefresh(userId);
  }, [status, userId]);
}

async function doRefresh(userId: string): Promise<void> {
  const store = useAhandStore.getState();
  const entry = store.usersEnabled[userId];
  if (!entry?.enabled || !entry.deviceId) return;
  try {
    const devices = await ahandApi.list({ includeOffline: true });
    const row = devices.find((d) => d.hubDeviceId === entry.deviceId);
    if (!row) {
      store.setDeviceIdForUser(userId, null, false);
      await ahandTauri.stop().catch(() => {});
      toast.info(
        "aHand: this device is no longer authorized; please re-enable",
      );
      return;
    }
    const { deviceJwt, jwtExpiresAt } = await ahandApi.refreshToken(row.id);
    await ahandTauri.start({
      team9_user_id: userId,
      hub_url: "",
      device_jwt: deviceJwt,
      jwt_expires_at: Math.floor(new Date(jwtExpiresAt).getTime() / 1000),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    toast.error(`aHand: auto-refresh failed — ${msg}`);
  }
}
