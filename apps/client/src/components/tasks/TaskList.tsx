import { useMemo, useState, useCallback, useEffect } from "react";
import { Loader2, ListChecks, Plus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { tasksApi } from "@/services/api/tasks";
import { TaskCard } from "./TaskCard";
import { TaskChatArea } from "./TaskChatArea";
import { TaskRightPanel } from "./TaskRightPanel";
import { CreateTaskDialog } from "./CreateTaskDialog";
import type { AgentTaskStatus } from "@/types/task";

const STATUS_GROUPS: { key: string; statuses: AgentTaskStatus[] }[] = [
  { key: "active", statuses: ["in_progress", "paused", "pending_action"] },
  { key: "upcoming", statuses: ["upcoming"] },
  {
    key: "finished",
    statuses: ["completed", "failed", "stopped", "timeout"],
  },
];

const ACTIVE_STATUSES: AgentTaskStatus[] = [
  "in_progress",
  "pending_action",
  "paused",
];

interface TaskListProps {
  botId?: string;
}

export function TaskList({ botId }: TaskListProps) {
  const { t } = useTranslation("tasks");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [rightPanelTab, setRightPanelTab] = useState("run");
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const { data: allTasks = [], isLoading } = useQuery({
    queryKey: ["tasks", { botId }],
    queryFn: () => tasksApi.list({ botId }),
  });

  // Fetch selected task detail
  const { data: selectedTask } = useQuery({
    queryKey: ["task", selectedTaskId],
    queryFn: () => tasksApi.getById(selectedTaskId!),
    enabled: !!selectedTaskId,
    refetchInterval: (query) =>
      query.state.data?.currentExecution?.execution.taskcastTaskId
        ? 30000
        : 5000,
  });

  // Fetch executions for the selected task (needed to find run by ID)
  const { data: executions = [] } = useQuery({
    queryKey: ["task-executions", selectedTaskId],
    queryFn: () => tasksApi.getExecutions(selectedTaskId!),
    enabled: !!selectedTaskId,
    refetchInterval: 5000,
  });

  // Derive active execution
  const activeExecution = selectedTask?.currentExecution?.execution ?? null;

  // Auto-select run when task changes
  useEffect(() => {
    if (!selectedTask) {
      setSelectedRunId(null);
      return;
    }
    if (activeExecution && ACTIVE_STATUSES.includes(activeExecution.status)) {
      setSelectedRunId(activeExecution.id);
    } else if (executions.length > 0) {
      setSelectedRunId(executions[0].id);
    } else if (activeExecution) {
      setSelectedRunId(activeExecution.id);
    } else {
      setSelectedRunId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTaskId]);

  // Find the selected run data
  const selectedRun = useMemo(() => {
    if (!selectedRunId) return null;
    if (activeExecution?.id === selectedRunId) return activeExecution;
    return executions.find((e) => e.id === selectedRunId) ?? null;
  }, [selectedRunId, activeExecution, executions]);

  const isViewingHistory =
    !!selectedRun && !!activeExecution && selectedRunId !== activeExecution.id;

  // Group tasks by status
  const groupedTasks = useMemo(() => {
    return STATUS_GROUPS.map((group) => ({
      ...group,
      tasks: allTasks.filter((task) => group.statuses.includes(task.status)),
    })).filter((group) => group.tasks.length > 0);
  }, [allTasks]);

  const handleSelectRun = useCallback((runId: string) => {
    setSelectedRunId(runId);
    setRightPanelTab("run");
  }, []);

  const handleReturnToCurrent = useCallback(() => {
    if (activeExecution) {
      setSelectedRunId(activeExecution.id);
    } else if (executions.length > 0) {
      setSelectedRunId(executions[0].id);
    }
    setRightPanelTab("run");
  }, [activeExecution, executions]);

  const handleCloseTask = useCallback(() => {
    setSelectedTaskId(null);
    setSelectedRunId(null);
  }, []);

  return (
    <div className="flex h-full">
      {/* Left column: task list */}
      <div className="flex flex-col w-70 shrink-0 min-w-0 h-full border-r border-border">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <span className="text-sm font-semibold">{t("title", "Tasks")}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setShowCreateDialog(true)}
          >
            <Plus size={16} />
          </Button>
        </div>

        {/* Task list */}
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && allTasks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 gap-2">
            <ListChecks size={24} className="text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">{t("noTasks")}</p>
          </div>
        )}

        {!isLoading && allTasks.length > 0 && (
          <div className="flex-1 overflow-y-auto">
            {groupedTasks.map((group) => (
              <div key={group.key}>
                <div className="px-3 pt-3 pb-1">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    {t(`tabs.${group.key}`, group.key)}
                  </span>
                </div>
                <div className="px-2 space-y-1 pb-1">
                  {group.tasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onClick={() => setSelectedTaskId(task.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Center + Right: only shown when a task is selected */}
      {selectedTaskId && selectedTask && (
        <>
          {/* Center column: chat */}
          <TaskChatArea
            task={selectedTask}
            selectedRun={selectedRun}
            activeExecution={activeExecution}
            isViewingHistory={isViewingHistory}
            onReturnToCurrent={handleReturnToCurrent}
          />

          {/* Right column: panel */}
          <TaskRightPanel
            task={selectedTask}
            selectedRun={selectedRun}
            selectedRunId={selectedRunId}
            onSelectRun={handleSelectRun}
            onClose={handleCloseTask}
            activeTab={rightPanelTab}
            onTabChange={setRightPanelTab}
          />
        </>
      )}

      <CreateTaskDialog
        isOpen={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
      />
    </div>
  );
}
