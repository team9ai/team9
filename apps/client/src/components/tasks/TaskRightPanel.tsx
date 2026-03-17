import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TaskRunTab } from "./TaskRunTab";
import { TaskSettingsTab } from "./TaskSettingsTab";
import { TaskHistoryTab } from "./TaskHistoryTab";
import type { AgentTaskDetail, AgentTaskExecution } from "@/types/task";

interface TaskRightPanelProps {
  task: AgentTaskDetail;
  selectedRun: AgentTaskExecution | null;
  selectedRunId: string | null;
  onSelectRun: (runId: string) => void;
  onClose: () => void;
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export function TaskRightPanel({
  task,
  selectedRun,
  selectedRunId,
  onSelectRun,
  onClose,
  activeTab,
  onTabChange,
}: TaskRightPanelProps) {
  const { t } = useTranslation("tasks");

  const currentExecutionId = task.currentExecution?.execution.id ?? null;

  return (
    <div className="w-[260px] border-l border-border bg-background flex flex-col h-full shrink-0">
      <Tabs
        value={activeTab}
        onValueChange={onTabChange}
        className="flex-1 flex flex-col overflow-hidden"
      >
        <TabsList className="mx-2 mt-2 shrink-0">
          <TabsTrigger value="run">{t("tabs.run")}</TabsTrigger>
          <TabsTrigger value="settings">{t("tabs.settings")}</TabsTrigger>
          <TabsTrigger value="history">{t("tabs.history")}</TabsTrigger>
        </TabsList>
        <ScrollArea className="flex-1 min-h-0">
          <TabsContent value="run" className="p-3 mt-0">
            <TaskRunTab taskId={task.id} execution={selectedRun} />
          </TabsContent>
          <TabsContent value="settings" className="p-3 mt-0">
            <TaskSettingsTab task={task} onClose={onClose} />
          </TabsContent>
          <TabsContent value="history" className="p-3 mt-0">
            <TaskHistoryTab
              taskId={task.id}
              selectedRunId={selectedRunId}
              currentExecutionId={currentExecutionId}
              onSelectRun={onSelectRun}
            />
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </div>
  );
}
