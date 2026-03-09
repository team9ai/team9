import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { tasksApi } from "@/services/api/tasks";

interface ManualTriggerDialogProps {
  taskId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function ManualTriggerDialog({
  taskId,
  isOpen,
  onClose,
}: ManualTriggerDialogProps) {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState("");

  const startMutation = useMutation({
    mutationFn: () =>
      tasksApi.start(taskId, { notes: notes.trim() || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["task", taskId] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      handleClose();
    },
  });

  function handleClose() {
    setNotes("");
    startMutation.reset();
    onClose();
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("manualTrigger.title")}</DialogTitle>
        </DialogHeader>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t("manualTrigger.notesPlaceholder")}
          rows={4}
          className="resize-none"
        />
        {startMutation.isError && (
          <p className="text-sm text-destructive">
            {(startMutation.error as Error)?.message ||
              t("create.errorGeneric")}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={handleClose}>
            {t("create.cancel")}
          </Button>
          <Button
            onClick={() => startMutation.mutate()}
            disabled={startMutation.isPending}
          >
            {startMutation.isPending && (
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            )}
            {t("detail.start")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
