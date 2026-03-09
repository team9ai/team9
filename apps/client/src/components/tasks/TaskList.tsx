import { useMemo, useState } from "react";
import { Loader2, ListChecks } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { tasksApi } from "@/services/api/tasks";
import { cn } from "@/lib/utils";
import { TaskCard } from "./TaskCard";
import { TaskDetailPanel } from "./TaskDetailPanel";
import type { AgentTaskStatus } from "@/types/task";

const STATUS_GROUPS: Record<string, AgentTaskStatus[]> = {
  active: ["in_progress", "paused", "pending_action"],
  upcoming: ["upcoming"],
  finished: ["completed", "failed", "stopped", "timeout"],
};

const TAB_KEYS = ["all", "active", "upcoming", "finished"] as const;

type TabKey = (typeof TAB_KEYS)[number];

interface TaskListProps {
  botId?: string;
}

export function TaskList({ botId }: TaskListProps) {
  const [tab, setTab] = useState<TabKey>("all");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const { t } = useTranslation("tasks");

  const { data: allTasks = [], isLoading } = useQuery({
    queryKey: ["tasks", { botId }],
    queryFn: () => tasksApi.list({ botId }),
  });

  const tasks = useMemo(
    () =>
      tab === "all"
        ? allTasks
        : allTasks.filter((task) => STATUS_GROUPS[tab].includes(task.status)),
    [allTasks, tab],
  );

  return (
    <div className="flex h-full">
      <div className="flex flex-col flex-1 min-w-0 h-full">
        {/* Filter tabs */}
        <div
          className="flex gap-1 px-3 py-2 border-b border-border"
          role="tablist"
        >
          {TAB_KEYS.map((key) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cn(
                "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                tab === key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent",
              )}
            >
              {t(`tabs.${key}`)}
            </button>
          ))}
        </div>

        {/* Task list */}
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && tasks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 gap-2">
            <ListChecks size={24} className="text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">{t("noTasks")}</p>
          </div>
        )}

        {!isLoading && tasks.length > 0 && (
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onClick={() => setSelectedTaskId(task.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Detail panel */}
      {selectedTaskId && (
        <TaskDetailPanel
          taskId={selectedTaskId}
          onClose={() => setSelectedTaskId(null)}
        />
      )}
    </div>
  );
}
