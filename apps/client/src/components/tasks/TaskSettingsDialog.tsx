import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TaskSettingsTab } from "./TaskSettingsTab";
import type { AgentTaskDetail } from "@/types/task";

interface TaskSettingsDialogProps {
  task: AgentTaskDetail | null;
  open: boolean;
  onClose: () => void;
  onDeleted: () => void;
}

export function TaskSettingsDialog({
  task,
  open,
  onClose,
  onDeleted,
}: TaskSettingsDialogProps) {
  const { t } = useTranslation("tasks");

  if (!task) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t("settingsTab.title", "Task Settings")}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="flex-1 min-h-0 pr-4">
          <TaskSettingsTab task={task} onClose={onDeleted} />
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
