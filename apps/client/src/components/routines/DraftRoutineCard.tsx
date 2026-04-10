import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Pencil, Trash2, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/services/api";
import type { Routine } from "@/types/routine";

interface DraftRoutineCardProps {
  routine: Routine;
}

export function DraftRoutineCard({ routine }: DraftRoutineCardProps) {
  const { t } = useTranslation("routines");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: () => api.routines.delete(routine.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["routines"] });
    },
  });

  function handleCompleteCreation() {
    if (!routine.creationChannelId) return;
    void navigate({
      to: "/messages/$channelId",
      params: { channelId: routine.creationChannelId },
    });
  }

  function handleDeleteClick() {
    if (confirmingDelete) {
      deleteMutation.mutate();
      setConfirmingDelete(false);
    } else {
      setConfirmingDelete(true);
    }
  }

  const hasChannel = !!routine.creationChannelId;

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border border-border px-2.5 py-2 text-sm",
        "bg-muted/30",
      )}
    >
      {/* Draft badge */}
      <span className="shrink-0 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300 border border-yellow-200 dark:border-yellow-800">
        {t("draft.badge")}
      </span>

      {/* Title */}
      <span className="flex-1 truncate text-foreground font-medium">
        {routine.title || t("draft.untitled", "Untitled")}
      </span>

      {/* Complete Creation button */}
      {hasChannel ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs shrink-0"
          onClick={handleCompleteCreation}
        >
          <MessageSquare size={12} className="mr-1" />
          {t("draft.completeCreation")}
        </Button>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs shrink-0 opacity-50 cursor-not-allowed"
                disabled
              >
                <MessageSquare size={12} className="mr-1" />
                {t("draft.completeCreation")}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t("draft.noChannelTooltip")}</p>
          </TooltipContent>
        </Tooltip>
      )}

      {/* Delete button */}
      {confirmingDelete ? (
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-xs text-destructive">
            {t("draft.deleteConfirm")}
          </span>
          <Button
            variant="destructive"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={handleDeleteClick}
            disabled={deleteMutation.isPending}
          >
            {t("draft.delete")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setConfirmingDelete(false)}
          >
            {t("agentic.cancel")}
          </Button>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground hover:text-destructive"
          onClick={handleDeleteClick}
          disabled={deleteMutation.isPending}
        >
          <Trash2 size={14} />
        </Button>
      )}
    </div>
  );
}
