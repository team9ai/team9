import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Routine } from "@/types/routine";

interface DraftRoutineBannerProps {
  routine: Routine;
}

export function DraftRoutineBanner({ routine }: DraftRoutineBannerProps) {
  const { t } = useTranslation("routines");
  const navigate = useNavigate();

  if (routine.status !== "draft") {
    return null;
  }

  function handleCompleteCreation() {
    if (!routine.creationChannelId) return;
    void navigate({
      to: "/messages/$channelId",
      params: { channelId: routine.creationChannelId },
    });
  }

  const hasChannel = !!routine.creationChannelId;

  return (
    <div className="flex items-center gap-3 rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2.5 text-sm dark:border-yellow-800/50 dark:bg-yellow-900/20">
      <AlertTriangle
        size={16}
        className="shrink-0 text-yellow-600 dark:text-yellow-400"
      />
      <span className="flex-1 text-yellow-800 dark:text-yellow-200">
        {t("draft.bannerMessage")}
      </span>
      {hasChannel && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs shrink-0 border-yellow-300 bg-yellow-100 hover:bg-yellow-200 text-yellow-800 dark:border-yellow-700 dark:bg-yellow-900/40 dark:hover:bg-yellow-900/60 dark:text-yellow-200"
          onClick={handleCompleteCreation}
        >
          <MessageSquare size={12} className="mr-1.5" />
          {t("draft.completeCreation")}
        </Button>
      )}
    </div>
  );
}
