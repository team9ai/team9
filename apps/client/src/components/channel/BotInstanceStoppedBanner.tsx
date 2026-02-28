import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Loader2, Play, PowerOff } from "lucide-react";

interface BotInstanceStoppedBannerProps {
  onStart: () => void;
  isStarting: boolean;
  canStart: boolean;
  isInstanceStarting?: boolean;
}

export function BotInstanceStoppedBanner({
  onStart,
  isStarting,
  canStart,
  isInstanceStarting = false,
}: BotInstanceStoppedBannerProps) {
  const { t } = useTranslation("channel");

  if (isInstanceStarting) {
    return (
      <div className="mx-4 mb-3 flex items-center gap-3 rounded-lg border border-primary/40 bg-primary/10 px-4 py-3">
        <Loader2 size={16} className="shrink-0 animate-spin text-primary" />
        <p className="flex-1 text-sm text-foreground/80">
          {t("botInstanceStartingMessage")}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-4 mb-3 flex items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3">
      <PowerOff size={16} className="shrink-0 text-warning" />
      <p className="flex-1 text-sm text-foreground/80">
        {canStart
          ? t("botInstanceStoppedMessage")
          : t("botInstanceStoppedMemberMessage")}
      </p>
      {canStart && (
        <Button
          size="sm"
          onClick={onStart}
          disabled={isStarting}
          className="shrink-0"
        >
          {isStarting ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Play size={14} />
          )}
          {isStarting ? t("botInstanceStarting") : t("botInstanceStart")}
        </Button>
      )}
    </div>
  );
}
