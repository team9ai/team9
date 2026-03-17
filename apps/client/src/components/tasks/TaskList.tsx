import { useMemo, useState, useCallback, useEffect } from "react";
import { Loader2, ListChecks, Plus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { tasksApi } from "@/services/api/tasks";
import { TaskCard } from "./TaskCard";
import { TaskChatArea } from "./TaskChatArea";
import { TaskRightPanel } from "./TaskRightPanel";
import { CreateTaskDialog } from "./CreateTaskDialog";
import type { AgentTaskStatus } from "@/types/task";

const STATUS_FILTERS: Record<string, AgentTaskStatus[]> = {
  active: ["in_progress", "paused", "pending_action"],
  upcoming: ["upcoming"],
  finished: ["completed", "failed", "stopped", "timeout"],
};

const TAB_KEYS = ["all", "active", "upcoming", "finished"] as const;
type TabKey = (typeof TAB_KEYS)[number];

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
  const [tab, setTab] = useState<TabKey>("all");

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

  // Filter tasks by selected tab
  const filteredTasks = useMemo(() => {
    if (tab === "all") return allTasks;
    const statuses = STATUS_FILTERS[tab];
    return allTasks.filter((task) => statuses.includes(task.status));
  }, [allTasks, tab]);

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
          <>
            {/* Filter tabs */}
            <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border">
              {TAB_KEYS.map((key) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={cn(
                    "px-2 py-0.5 text-[11px] rounded-md transition-colors",
                    tab === key
                      ? "bg-accent text-accent-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
                  )}
                >
                  {t(`tabs.${key}`, key)}
                </button>
              ))}
            </div>

            {/* Task list */}
            <div className="flex-1 overflow-y-auto">
              {filteredTasks.length === 0 ? (
                <div className="flex items-center justify-center py-8">
                  <p className="text-xs text-muted-foreground">
                    {t("noTasks")}
                  </p>
                </div>
              ) : (
                <div className="px-2 py-1 space-y-1">
                  {filteredTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onClick={() => setSelectedTaskId(task.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
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
