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
  /** "start" for upcoming tasks, "restart" for terminal-state tasks. Defaults to "start". */
  mode?: "start" | "restart";
}

export function ManualTriggerDialog({
  taskId,
  isOpen,
  onClose,
  mode = "start",
}: ManualTriggerDialogProps) {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState("");

  const mutation = useMutation({
    mutationFn: () => {
      const opts = { notes: notes.trim() || undefined };
      return mode === "restart"
        ? tasksApi.restart(taskId, opts)
        : tasksApi.start(taskId, opts);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["task", taskId] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      handleClose();
    },
  });

  function handleClose() {
    setNotes("");
    mutation.reset();
    onClose();
  }

  const title =
    mode === "restart"
      ? t("manualTrigger.rerunTitle", "Rerun Task")
      : t("manualTrigger.title");
  const submitLabel =
    mode === "restart" ? t("chatArea.rerun", "Rerun") : t("detail.start");

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t("manualTrigger.notesPlaceholder")}
          rows={4}
          className="resize-none"
        />
        {mutation.isError && (
          <p className="text-sm text-destructive">
            {(mutation.error as Error)?.message || t("create.errorGeneric")}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={handleClose}>
            {t("create.cancel")}
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {mutation.isPending && (
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            )}
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
