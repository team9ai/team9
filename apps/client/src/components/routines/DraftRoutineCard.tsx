// apps/client/src/components/routines/DraftRoutineCard.tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { api } from "@/services/api";
import type { Routine } from "@/types/routine";
import { CreationSessionRunItem } from "./CreationSessionRunItem";
import type { SelectedRun } from "./RoutineList";

interface DraftRoutineCardProps {
  routine: Routine;
  onOpenCreationSession: (routineId: string) => void;
  selectedRun: SelectedRun;
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
  selectedRun,
  onDeleted,
}: DraftRoutineCardProps) {
  const { t } = useTranslation("routines");
  const queryClient = useQueryClient();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: () => api.routines.delete(routine.id),
    onSuccess: () => {
      // IMPORTANT: do local cleanup FIRST, before awaiting the list
      // invalidation. If the refetch is slow or errors, we still need
      // the parent to have cleared `activeRoutineId`/`selectedRun` and
      // the `['routine', id]` detail query to have been removed — we
      // cannot let the deleted draft keep polling.
      queryClient.removeQueries({ queryKey: ["routine", routine.id] });
      onDeleted?.(routine.id);
      // Fire-and-forget the list refetch.
      void queryClient.invalidateQueries({ queryKey: ["routines"] });
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

  const isCreationSelected =
    selectedRun?.kind === "creation" && selectedRun.routineId === routine.id;

  return (
    <div
      className={cn(
        "rounded-md border border-border px-2.5 py-2 text-sm",
        "bg-muted/30 space-y-1.5",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="shrink-0 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300 border border-yellow-200 dark:border-yellow-800">
          {t("draft.badge")}
        </span>

        <span className="flex-1 truncate text-foreground font-medium">
          {routine.title || t("draft.untitled", "Untitled")}
        </span>

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

      <CreationSessionRunItem
        isSelected={isCreationSelected}
        onClick={handleCompleteCreation}
        isPending={startMutation.isPending}
        disabled={!routine.botId}
        title={
          !routine.botId
            ? t(
                "draft.noBotTooltip",
                "Assign an agent to this draft before starting creation",
              )
            : undefined
        }
      />
    </div>
  );
}
