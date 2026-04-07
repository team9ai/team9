import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RoutineSettingsTab } from "./RoutineSettingsTab";
import type { RoutineDetail } from "@/types/routine";

interface RoutineSettingsDialogProps {
  routine: RoutineDetail | null;
  open: boolean;
  onClose: () => void;
  onDeleted: () => void;
}

export function RoutineSettingsDialog({
  routine,
  open,
  onClose,
  onDeleted,
}: RoutineSettingsDialogProps) {
  const { t } = useTranslation("routines");

  if (!routine) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t("settingsTab.title", "Task Settings")}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="flex-1 min-h-0 pr-4">
          <RoutineSettingsTab routine={routine} onClose={onDeleted} />
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
