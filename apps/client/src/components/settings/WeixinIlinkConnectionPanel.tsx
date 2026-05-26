import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  MessageCircle,
  QrCode,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useWeixinIlinkConnection } from "@/hooks/useWeixinIlinkConnection";

export function WeixinIlinkConnectionPanel({
  enabled = true,
  team9TenantId,
  team9UserId,
}: {
  enabled?: boolean;
  team9TenantId?: string | null;
  team9UserId?: string;
}) {
  const { t } = useTranslation("settings");
  const {
    canStartLogin,
    connection,
    error,
    expiresAtTime,
    isStartingLogin,
    loginSession,
    qrImageSrc,
    startLogin,
    statusLabel,
  } = useWeixinIlinkConnection({
    enabled,
    team9TenantId,
    team9UserId,
  });

  return (
    <div className="space-y-4">
      {connection ? (
        <div className="flex items-start gap-3 rounded-lg border bg-muted/20 p-4">
          <CheckCircle2 className="mt-0.5 size-4 text-emerald-600" />
          <div className="min-w-0 space-y-1 text-sm">
            <p className="font-medium">
              {t("weixinCard.connected", "Weixin connected")}
            </p>
            <p className="break-all text-xs text-muted-foreground">
              {connection.id}
            </p>
          </div>
        </div>
      ) : null}

      {!team9TenantId ? (
        <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>
            {t(
              "weixinCard.workspaceRequired",
              "Select a workspace before connecting Weixin.",
            )}
          </span>
        </div>
      ) : null}

      {qrImageSrc ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex size-48 shrink-0 items-center justify-center rounded-lg border bg-white p-3">
            <img
              src={qrImageSrc}
              alt={t("weixinCard.qrAlt", "Weixin login QR code")}
              className="size-full object-contain"
            />
          </div>
          <div className="space-y-2 text-sm">
            <div className="inline-flex items-center gap-2 rounded-full border bg-muted/30 px-3 py-1 text-xs font-medium">
              <QrCode className="size-3.5" />
              {statusLabel}
            </div>
            {expiresAtTime ? (
              <p className="text-xs text-muted-foreground">
                {t("weixinCard.expiresAt", {
                  defaultValue: "Expires at {{time}}",
                  time: expiresAtTime,
                })}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-3">
        <Button type="button" onClick={startLogin} disabled={!canStartLogin}>
          {isStartingLogin ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <MessageCircle className="mr-2 size-4" />
          )}
          {loginSession
            ? t("weixinCard.refreshQr", "Refresh QR")
            : t("weixinCard.connect", "Connect Weixin")}
        </Button>
      </div>
    </div>
  );
}
