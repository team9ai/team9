import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { tasksApi } from "@/services/api/tasks";
import { RunDetailView } from "./RunDetailView";
import type { AgentTaskStatus } from "@/types/task";
import type { TimelineUserMessage } from "./ExecutionTimeline";

interface TaskRunsTabProps {
  taskId: string;
  onViewingChannelChange?: (channelId: string | null) => void;
  userMessages?: TimelineUserMessage[];
}

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

export function TaskRunsTab({
  taskId,
  onViewingChannelChange,
  userMessages,
}: TaskRunsTabProps) {
  const { t } = useTranslation("tasks");

  const { data: executions = [], isLoading } = useQuery({
    queryKey: ["task-executions", taskId],
    queryFn: () => tasksApi.getExecutions(taskId),
    refetchInterval: 5000,
  });

  const [selectedExecId, setSelectedExecId] = useState<string | null>(null);

  if (selectedExecId) {
    return (
      <RunDetailView
        taskId={taskId}
        executionId={selectedExecId}
        onBack={() => setSelectedExecId(null)}
        onChannelChange={onViewingChannelChange}
        userMessages={userMessages}
      />
    );
  }

  if (isLoading) {
    return (
      <div className="flex justify-center p-4">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (executions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground p-4">{t("runs.empty")}</p>
    );
  }

  return (
    <div className="space-y-2">
      {executions.map((exec) => (
        <button
          key={exec.id}
          onClick={() => setSelectedExecId(exec.id)}
          className="w-full text-left p-3 rounded-md border border-border hover:bg-muted/50 transition-colors space-y-1"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium">
              {t("runs.version", { version: exec.version })}
            </span>
            {exec.triggerType && (
              <Badge variant="outline" className="text-xs">
                {(() => {
                  const TRIGGER_TYPE_KEYS = {
                    manual: "runs.triggerType.manual",
                    interval: "runs.triggerType.interval",
                    schedule: "runs.triggerType.schedule",
                    channel_message: "runs.triggerType.channel_message",
                    retry: "runs.triggerType.retry",
                  } as const;
                  const key =
                    TRIGGER_TYPE_KEYS[
                      exec.triggerType as keyof typeof TRIGGER_TYPE_KEYS
                    ];
                  return key ? t(key) : exec.triggerType;
                })()}
              </Badge>
            )}
            <Badge
              variant={STATUS_BADGE_VARIANT[exec.status]}
              className="text-xs"
            >
              {t(`status.${exec.status}`)}
            </Badge>
          </div>
          {exec.startedAt && (
            <p className="text-xs text-muted-foreground">
              {new Date(exec.startedAt).toLocaleString()}
            </p>
          )}
          {/* Show notes preview if available */}
          {exec.triggerContext &&
            "notes" in exec.triggerContext &&
            exec.triggerContext.notes && (
              <p className="text-xs text-muted-foreground truncate">
                {t("runs.notes")}:{" "}
                {(exec.triggerContext as { notes: string }).notes}
              </p>
            )}
        </button>
      ))}
    </div>
  );
}
