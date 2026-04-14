// apps/client/src/components/routines/DraftRoutineCard.tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2, MessageSquare, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { api } from "@/services/api";
import type { Routine } from "@/types/routine";

interface DraftRoutineCardProps {
  routine: Routine;
  onOpenCreationSession: (routineId: string) => void;
  /**
   * Invoked after the draft is successfully deleted. Lets the parent
   * reset any selection/polling state tied to this routine (the `['routine', id]`
   * detail query, active run, etc.) so a deleted draft doesn't keep
   * rendering in the center pane.
   */
  onDeleted?: (routineId: string) => void;
}

export function DraftRoutineCard({
  routine,
  onOpenCreationSession,
  onDeleted,
}: DraftRoutineCardProps) {
  const { t } = useTranslation("routines");
  const queryClient = useQueryClient();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: () => api.routines.delete(routine.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["routines"] });
      // Drop the detail query cache for the now-deleted routine so the
      // center pane stops polling it.
      queryClient.removeQueries({ queryKey: ["routine", routine.id] });
      onDeleted?.(routine.id);
    },
  });

  const startMutation = useMutation({
    mutationFn: () => api.routines.startCreationSession(routine.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["routines"] });
      onOpenCreationSession(routine.id);
    },
  });

  function handleCompleteCreation() {
    if (routine.creationChannelId) {
      onOpenCreationSession(routine.id);
      return;
    }
    startMutation.mutate();
  }

  function handleDeleteClick() {
    if (confirmingDelete) {
      deleteMutation.mutate();
      setConfirmingDelete(false);
    } else {
      setConfirmingDelete(true);
    }
  }

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border border-border px-2.5 py-2 text-sm",
        "bg-muted/30",
      )}
    >
      <span className="shrink-0 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300 border border-yellow-200 dark:border-yellow-800">
        {t("draft.badge")}
      </span>

      <span className="flex-1 truncate text-foreground font-medium">
        {routine.title || t("draft.untitled", "Untitled")}
      </span>

      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-2 text-xs shrink-0"
        onClick={handleCompleteCreation}
        disabled={startMutation.isPending}
      >
        {startMutation.isPending ? (
          <Loader2 size={12} className="mr-1 animate-spin" />
        ) : (
          <MessageSquare size={12} className="mr-1" />
        )}
        {t("draft.completeCreation")}
      </Button>

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
