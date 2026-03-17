import { useMemo, useState, useCallback, useEffect, useRef } from "react";
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
import { TaskSettingsDialog } from "./TaskSettingsDialog";
import type { AgentTask, AgentTaskStatus } from "@/types/task";

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
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  // activeTaskId tracks which task owns the selected run
  // (set alongside selectedRunId to avoid needing cross-task execution lookups)
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(
    new Set(),
  );
  const [showSettingsTaskId, setShowSettingsTaskId] = useState<string | null>(
    null,
  );
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [tab, setTab] = useState<TabKey>("all");

  // Fetch all tasks
  const { data: allTasks = [], isLoading } = useQuery({
    queryKey: ["tasks", { botId }],
    queryFn: () => tasksApi.list({ botId }),
  });

  // Filter tasks by selected tab
  const filteredTasks = useMemo(() => {
    if (tab === "all") return allTasks;
    const statuses = STATUS_FILTERS[tab];
    return allTasks.filter((task) => statuses.includes(task.status));
  }, [allTasks, tab]);

  // Fetch selected task detail (for chat area + right panel)
  const { data: selectedTask } = useQuery({
    queryKey: ["task", activeTaskId],
    queryFn: () => tasksApi.getById(activeTaskId!),
    enabled: !!activeTaskId,
    refetchInterval: (query) =>
      query.state.data?.currentExecution?.execution.taskcastTaskId
        ? 30000
        : 5000,
  });

  // Derive active execution
  const activeExecution = selectedTask?.currentExecution?.execution ?? null;

  // Fetch executions for the active task (for selectedRun lookup)
  const { data: activeTaskExecutions = [] } = useQuery({
    queryKey: ["task-executions", activeTaskId],
    queryFn: () => tasksApi.getExecutions(activeTaskId!),
    enabled: !!activeTaskId,
    refetchInterval: 5000,
  });

  const selectedRun = useMemo(() => {
    if (!selectedRunId) return null;
    if (activeExecution?.id === selectedRunId) return activeExecution;
    return activeTaskExecutions.find((e) => e.id === selectedRunId) ?? null;
  }, [selectedRunId, activeExecution, activeTaskExecutions]);

  const isViewingHistory =
    !!selectedRun && !!activeExecution && selectedRunId !== activeExecution.id;

  // Handle expanding a task
  const handleToggleExpand = useCallback(
    (taskId: string) => {
      setExpandedTaskIds((prev) => {
        const next = new Set(prev);
        if (next.has(taskId)) {
          next.delete(taskId);
          // If collapsing the task that owns the selected run, deselect
          if (activeTaskId === taskId) {
            setSelectedRunId(null);
            setActiveTaskId(null);
          }
        } else {
          next.add(taskId);
          // Auto-select will happen via ExpandableTaskCard's useEffect
        }
        return next;
      });
    },
    [activeTaskId],
  );

  // Handle run selection — stable ref to avoid re-triggering effects
  const handleSelectRun = useCallback((taskId: string, runId: string) => {
    setSelectedRunId(runId);
    setActiveTaskId(taskId);
  }, []);

  const handleReturnToCurrent = useCallback(() => {
    if (activeExecution) {
      setSelectedRunId(activeExecution.id);
    } else if (activeTaskExecutions.length > 0) {
      setSelectedRunId(activeTaskExecutions[0].id);
    }
  }, [activeExecution, activeTaskExecutions]);

  const handleSettingsDeleted = useCallback(() => {
    const deletedTaskId = showSettingsTaskId;
    setShowSettingsTaskId(null);
    // If the deleted task was the active one, clear selection
    if (activeTaskId === deletedTaskId) {
      setSelectedRunId(null);
      setActiveTaskId(null);
    }
  }, [activeTaskId, showSettingsTaskId]);

  // Fetch task detail for settings dialog (needs AgentTaskDetail)
  const { data: settingsTaskDetail } = useQuery({
    queryKey: ["task", showSettingsTaskId],
    queryFn: () => tasksApi.getById(showSettingsTaskId!),
    enabled: !!showSettingsTaskId,
  });

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

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Empty */}
        {!isLoading && allTasks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 gap-2">
            <ListChecks size={24} className="text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">{t("noTasks")}</p>
          </div>
        )}

        {/* Task list */}
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

            {/* Task cards */}
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
                    <ExpandableTaskCard
                      key={task.id}
                      task={task}
                      isExpanded={expandedTaskIds.has(task.id)}
                      isActive={activeTaskId === task.id}
                      selectedRunId={selectedRunId}
                      onToggleExpand={() => handleToggleExpand(task.id)}
                      onSelectRun={handleSelectRun}
                      onOpenSettings={() => setShowSettingsTaskId(task.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Center + Right: shown when a run is selected */}
      {activeTaskId && selectedTask && (
        <>
          <TaskChatArea
            task={selectedTask}
            selectedRun={selectedRun}
            activeExecution={activeExecution}
            isViewingHistory={isViewingHistory}
            onReturnToCurrent={handleReturnToCurrent}
          />
          <TaskRightPanel taskId={activeTaskId} selectedRun={selectedRun} />
        </>
      )}

      <CreateTaskDialog
        isOpen={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
      />

      <TaskSettingsDialog
        task={settingsTaskDetail ?? null}
        open={!!showSettingsTaskId}
        onClose={() => setShowSettingsTaskId(null)}
        onDeleted={handleSettingsDeleted}
      />
    </div>
  );
}

// --- Inner component: fetches executions for each expanded task ---

interface ExpandableTaskCardProps {
  task: AgentTask;
  isExpanded: boolean;
  isActive: boolean;
  selectedRunId: string | null;
  onToggleExpand: () => void;
  onSelectRun: (taskId: string, runId: string) => void;
  onOpenSettings: () => void;
}

function ExpandableTaskCard({
  task,
  isExpanded,
  isActive,
  selectedRunId,
  onToggleExpand,
  onSelectRun,
  onOpenSettings,
}: ExpandableTaskCardProps) {
  // Fetch executions only when expanded
  const { data: executions = [] } = useQuery({
    queryKey: ["task-executions", task.id],
    queryFn: () => tasksApi.getExecutions(task.id),
    enabled: isExpanded,
    // Poll only for the active (selected) task
    refetchInterval: isActive ? 5000 : false,
  });

  // Auto-select run when first expanded — use ref to keep onSelectRun stable
  const onSelectRunRef = useRef(onSelectRun);
  onSelectRunRef.current = onSelectRun;
  const [hasAutoSelected, setHasAutoSelected] = useState(false);

  useEffect(() => {
    if (isExpanded && !hasAutoSelected && executions.length > 0) {
      // Find active run or pick most recent
      const activeRun = executions.find((e) =>
        ACTIVE_STATUSES.includes(e.status),
      );
      onSelectRunRef.current(task.id, activeRun?.id ?? executions[0].id);
      setHasAutoSelected(true);
    }
    if (!isExpanded) {
      setHasAutoSelected(false);
    }
  }, [isExpanded, executions, hasAutoSelected, task.id]);

  // Stable callback for TaskCard — wraps taskId into onSelectRun
  const handleSelectRun = useCallback(
    (runId: string) => onSelectRun(task.id, runId),
    [onSelectRun, task.id],
  );

  return (
    <TaskCard
      task={task}
      isExpanded={isExpanded}
      isActive={isActive}
      selectedRunId={selectedRunId}
      executions={executions}
      onToggleExpand={onToggleExpand}
      onSelectRun={handleSelectRun}
      onOpenSettings={onOpenSettings}
    />
  );
}
