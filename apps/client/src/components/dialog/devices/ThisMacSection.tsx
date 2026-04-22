import { useState, useCallback } from "react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useAhandLocalStatus } from "@/hooks/useAhandLocalStatus";
import { useAhandStore } from "@/stores/useAhandStore";
import { useUser } from "@/stores/useAppStore";
import { ahandTauri } from "@/services/ahand-tauri";
import { ahandApi } from "@/services/ahand-api";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { AHAND_DEVICES_QUERY_KEY } from "@/hooks/useAhandDevices";
import type { LocalStatus } from "@/hooks/useAhandLocalStatus";

export function ThisMacSection() {
  const { t } = useTranslation("ahand");
  const currentUser = useUser();
  const status = useAhandLocalStatus();
  const store = useAhandStore();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const userId = currentUser?.id ?? null;
  const enabled = userId
    ? (store.usersEnabled[userId]?.enabled ?? false)
    : false;
  const deviceId = userId ? store.getDeviceIdForUser(userId) : null;

  const statusColor = deriveStatusColor(status, enabled);
  const statusLabel = deriveStatusLabel(status, enabled, t);

  const handleToggle = useCallback(
    async (next: boolean) => {
      if (!userId) return;
      setBusy(true);
      try {
        if (next) {
          // 5-step registration flow
          const id = await ahandTauri.getIdentity(userId);
          const plat = detectPlatform();
          const nickname = `${plat}-device`;
          const { deviceJwt, hubUrl, jwtExpiresAt } = await ahandApi.register({
            hubDeviceId: id.deviceId,
            publicKey: id.publicKeyB64,
            nickname,
            platform: plat,
          });
          store.setDeviceIdForUser(userId, id.deviceId, true, hubUrl);
          await ahandTauri.start({
            team9_user_id: userId,
            hub_url: hubUrl,
            device_jwt: deviceJwt,
            jwt_expires_at: Math.floor(new Date(jwtExpiresAt).getTime() / 1000),
          });
          qc.invalidateQueries({ queryKey: AHAND_DEVICES_QUERY_KEY });
        } else {
          await ahandTauri.stop();
          store.setDeviceIdForUser(userId, deviceId, false);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(t("error.toggleFailed", { msg }));
        store.setDeviceIdForUser(userId, deviceId, false);
      } finally {
        setBusy(false);
      }
    },
    [userId, deviceId, store, qc, t],
  );

  const handleRemove = useCallback(async () => {
    if (!userId || !deviceId) return;
    if (!window.confirm(t("confirmRemoveThisMac"))) return;
    setBusy(true);
    try {
      await ahandTauri.stop();
      const devices = await ahandApi.list({ includeOffline: true });
      const row = devices.find((d) => d.hubDeviceId === deviceId);
      if (row) await ahandApi.remove(row.id);
      await ahandTauri.clearIdentity(userId);
      store.clearUser(userId);
      qc.invalidateQueries({ queryKey: AHAND_DEVICES_QUERY_KEY });
      toast.success(t("thisMacRemoved"));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(t("error.removeFailed", { msg }));
    } finally {
      setBusy(false);
    }
  }, [userId, deviceId, store, qc, t]);

  return (
    <section>
      <h3 className="text-sm font-medium mb-2">{t("thisMac")}</h3>
      <div className="border rounded-lg p-4 space-y-3">
        <div className="flex items-center gap-2">
          <div
            className={cn("w-3 h-3 rounded-full", statusColor)}
            aria-label={statusLabel}
          />
          <span className="text-sm">{statusLabel}</span>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={enabled}
            onCheckedChange={handleToggle}
            disabled={busy || status.state === "connecting"}
            role="switch"
            aria-checked={enabled}
            aria-label={t("allowLocalDevice")}
          />
          <span className="text-sm">{t("allowLocalDevice")}</span>
        </div>
        {status.state === "error" && "message" in status && (
          <div className="text-sm text-destructive">
            {(status as { message: string }).message}
          </div>
        )}
        {enabled && deviceId && (
          <Button
            variant="destructive"
            size="sm"
            onClick={handleRemove}
            disabled={busy}
          >
            {t("removeThisDevice")}
          </Button>
        )}
      </div>
    </section>
  );
}

function deriveStatusColor(status: LocalStatus, enabled: boolean): string {
  if (!enabled) return "bg-muted";
  switch (status.state) {
    case "online":
      return "bg-green-500";
    case "connecting":
      return "bg-amber-500 animate-pulse";
    case "error":
      return "bg-destructive";
    case "offline":
      return "bg-muted-foreground";
    default:
      return "bg-muted";
  }
}

function deriveStatusLabel(
  status: LocalStatus,
  enabled: boolean,
  t: (key: string) => string,
): string {
  if (!enabled) return t("disabled");
  switch (status.state) {
    case "online":
      return t("online");
    case "connecting":
      return t("connecting");
    case "error":
      return t("error.header");
    case "offline":
      return t("offline");
    default:
      return t("notConnected");
  }
}

function detectPlatform(): "macos" | "windows" | "linux" {
  const ua = navigator.userAgent;
  if (/Mac/.test(ua)) return "macos";
  if (/Win/.test(ua)) return "windows";
  return "linux";
}
