import { useTranslation } from "react-i18next";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RunTab } from "./RunTab";
import type { RoutineExecution } from "@/types/routine";

interface RightPanelProps {
  routineId: string;
  selectedRun: RoutineExecution | null;
}

export function RightPanel({ routineId, selectedRun }: RightPanelProps) {
  const { t } = useTranslation("routines");

  return (
    <div className="w-65 border-l border-border bg-background flex flex-col h-full shrink-0">
      <div className="px-3 py-2 border-b border-border shrink-0">
        <span className="text-sm font-semibold">{t("tabs.run", "Run")}</span>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3">
          <RunTab routineId={routineId} execution={selectedRun} />
        </div>
      </ScrollArea>
    </div>
  );
}
