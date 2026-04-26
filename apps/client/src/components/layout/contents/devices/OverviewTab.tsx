import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Accessibility,
  ArrowUpRightFromSquare,
  HardDrive,
  Monitor,
  Terminal,
} from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { isTauriApp } from "@/lib/tauri";
import { confirmDestructive } from "@/lib/dialog";
import { WebCtaCard } from "@/components/dialog/devices/WebCtaCard";
import { useAhandLocalStatus } from "@/hooks/useAhandLocalStatus";
import type { LocalStatus } from "@/hooks/useAhandLocalStatus";
import { AHAND_DEVICES_QUERY_KEY } from "@/hooks/useAhandDevices";
import { useAhandStore } from "@/stores/useAhandStore";
import { useUser } from "@/stores/useAppStore";
import { ahandTauri } from "@/services/ahand-tauri";
import { ahandApi } from "@/services/ahand-api";

export function OverviewTab() {
  const { t } = useTranslation("ahand");
  const tauri = isTauriApp();

  if (!tauri) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {t("devicesTabs.overviewDescription")}
        </p>
        <WebCtaCard />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t("devicesTabs.overviewDescription")}
      </p>
      <MasterSwitchCard />
      <StatusCard />
      <SystemPermissionsCard />
    </div>
  );
}

function MasterSwitchCard() {
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

  const toggle = useCallback(
    async (next: boolean) => {
      if (!userId) return;
      setBusy(true);
      try {
        if (next) {
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

  const remove = useCallback(async () => {
    if (!userId || !deviceId) return;
    if (!(await confirmDestructive(t("confirmRemoveThisMac")))) return;
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
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          {t("overview.masterSwitchTitle")}
        </CardTitle>
        <CardDescription>
          {t("overview.masterSwitchDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          <Switch
            checked={enabled}
            onCheckedChange={toggle}
            disabled={busy || status.state === "connecting"}
            aria-label={t("allowLocalDevice")}
          />
          <span className="text-sm font-medium">
            {enabled
              ? t("overview.masterSwitchOn")
              : t("overview.masterSwitchOff")}
          </span>
        </div>
        {enabled && deviceId && (
          <Button
            variant="outline"
            size="sm"
            onClick={remove}
            disabled={busy}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            {t("removeThisDevice")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function StatusCard() {
  const { t } = useTranslation("ahand");
  const currentUser = useUser();
  const status = useAhandLocalStatus();
  const store = useAhandStore();
  const userId = currentUser?.id ?? null;
  const enabled = userId
    ? (store.usersEnabled[userId]?.enabled ?? false)
    : false;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t("overview.statusTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "w-2.5 h-2.5 rounded-full shrink-0",
              deriveStatusColor(status, enabled),
            )}
            aria-hidden="true"
          />
          <span className="text-sm">
            {t(deriveStatusLabelKey(status, enabled))}
          </span>
        </div>
        {status.state === "error" && "message" in status && (
          <p className="text-xs text-destructive mt-2">
            {(status as { message: string }).message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

type SystemPermissionItem = {
  key: string;
  icon: typeof Monitor;
};

const SYSTEM_PERMISSIONS: SystemPermissionItem[] = [
  { key: "screenRecording", icon: Monitor },
  { key: "accessibility", icon: Accessibility },
  { key: "automation", icon: Terminal },
  { key: "fullDiskAccess", icon: HardDrive },
];

function SystemPermissionsCard() {
  const { t } = useTranslation("ahand");

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">
            {t("overview.systemPermsTitle")}
          </CardTitle>
          <Badge
            variant="outline"
            size="sm"
            className="h-5 shrink-0 rounded-md border-border/60 bg-background/80 px-1.5 text-[10px] font-medium text-muted-foreground"
          >
            {t("comingSoon")}
          </Badge>
        </div>
        <CardDescription>
          {t("overview.systemPermsDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        {SYSTEM_PERMISSIONS.map(({ key, icon: Icon }) => (
          <div
            key={key}
            className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
          >
            <Icon className="h-5 w-5 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {t(`overview.systemPerms.${key}.label` as const)}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {t(`overview.systemPerms.${key}.description` as const)}
              </p>
            </div>
            <Badge
              variant="outline"
              size="sm"
              className="h-5 shrink-0 rounded-md border-muted bg-background/80 px-1.5 text-[10px] font-medium text-muted-foreground"
            >
              {t("overview.permNotChecked")}
            </Badge>
            <Button variant="outline" size="sm" disabled className="gap-1.5">
              {t("overview.permOpenSettings")}
              <ArrowUpRightFromSquare className="h-3 w-3" />
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
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

type StatusLabelKey =
  | "disabled"
  | "online"
  | "connecting"
  | "error.header"
  | "offline"
  | "notConnected";

function deriveStatusLabelKey(
  status: LocalStatus,
  enabled: boolean,
): StatusLabelKey {
  if (!enabled) return "disabled";
  switch (status.state) {
    case "online":
      return "online";
    case "connecting":
      return "connecting";
    case "error":
      return "error.header";
    case "offline":
      return "offline";
    default:
      return "notConnected";
  }
}

function detectPlatform(): "macos" | "windows" | "linux" {
  const ua = navigator.userAgent;
  if (/Mac/.test(ua)) return "macos";
  if (/Win/.test(ua)) return "windows";
  return "linux";
}
