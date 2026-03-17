import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { tasksApi } from "@/services/api/tasks";
import type { AgentTaskStatus } from "@/types/task";

const STATUS_BADGE_VARIANT: Record<
  AgentTaskStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  in_progress: "default",
  upcoming: "secondary",
  paused: "outline",
  pending_action: "default",
  completed: "secondary",
  failed: "destructive",
  stopped: "outline",
  timeout: "destructive",
};

const TRIGGER_TYPE_KEYS: Record<string, string> = {
  manual: "historyTab.manual",
  interval: "historyTab.interval",
  schedule: "historyTab.schedule",
  channel_message: "historyTab.channelMessage",
  retry: "historyTab.retry",
};

interface TaskHistoryTabProps {
  taskId: string;
  selectedRunId: string | null;
  currentExecutionId: string | null;
  onSelectRun: (runId: string) => void;
}

export function TaskHistoryTab({
  taskId,
  selectedRunId,
  currentExecutionId,
  onSelectRun,
}: TaskHistoryTabProps) {
  const { t } = useTranslation("tasks");

  const { data: executions = [], isLoading } = useQuery({
    queryKey: ["task-executions", taskId],
    queryFn: () => tasksApi.getExecutions(taskId),
    refetchInterval: 5000,
  });

  if (isLoading) {
    return (
      <div className="flex justify-center p-4">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (executions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground p-2">
        {t("historyTab.empty")}
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {executions.map((exec) => {
        const isSelected = exec.id === selectedRunId;
        const isCurrent = exec.id === currentExecutionId;

        return (
          <button
            key={exec.id}
            onClick={() => onSelectRun(exec.id)}
            className={`w-full text-left p-3 rounded-md border transition-colors space-y-1 ${
              isSelected
                ? "border-primary bg-accent"
                : "border-border hover:bg-muted/50"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge
                  variant={STATUS_BADGE_VARIANT[exec.status]}
                  className="text-xs"
                >
                  {t(`status.${exec.status}`)}
                </Badge>
                {exec.triggerType && (
                  <span className="text-xs text-muted-foreground">
                    {TRIGGER_TYPE_KEYS[exec.triggerType]
                      ? t(TRIGGER_TYPE_KEYS[exec.triggerType])
                      : exec.triggerType}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {isCurrent && (
                  <span className="text-xs text-primary font-medium">
                    {t("historyTab.current")}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  v{exec.taskVersion}
                </span>
              </div>
            </div>
            {exec.startedAt && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{new Date(exec.startedAt).toLocaleString()}</span>
                {exec.duration != null && exec.duration > 0 && (
                  <span>· {exec.duration}s</span>
                )}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
