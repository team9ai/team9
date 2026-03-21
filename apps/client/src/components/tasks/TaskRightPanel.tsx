import { useTranslation } from "react-i18next";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TaskRunTab } from "./TaskRunTab";
import type { AgentTaskExecution } from "@/types/task";

interface TaskRightPanelProps {
  taskId: string;
  selectedRun: AgentTaskExecution | null;
}

export function TaskRightPanel({ taskId, selectedRun }: TaskRightPanelProps) {
  const { t } = useTranslation("tasks");

  return (
    <div className="w-65 border-l border-border bg-background flex flex-col h-full shrink-0">
      <div className="px-3 py-2 border-b border-border shrink-0">
        <span className="text-sm font-semibold">{t("tabs.run", "Run")}</span>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3">
          <TaskRunTab taskId={taskId} execution={selectedRun} />
        </div>
      </ScrollArea>
    </div>
  );
}
