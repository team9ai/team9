import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Play,
  Pause,
  Square,
  PlayCircle,
  RotateCcw,
  History,
  ArrowLeft,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChannelView } from "@/components/channel/ChannelView";
import { TaskChatPlaceholder } from "./TaskChatPlaceholder";
import { ManualTriggerDialog } from "./ManualTriggerDialog";
import { tasksApi } from "@/services/api/tasks";
import type {
  AgentTaskStatus,
  AgentTaskDetail,
  AgentTaskExecution,
} from "@/types/task";

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

const FINISHED_BANNER_CONFIG: Partial<
  Record<
    AgentTaskStatus,
    {
      key:
        | "lastRunCompleted"
        | "lastRunFailed"
        | "lastRunStopped"
        | "lastRunTimeout";
      bgClass: string;
      textClass: string;
    }
  >
> = {
  completed: {
    key: "lastRunCompleted",
    bgClass: "bg-green-500/10 border-green-500/20",
    textClass: "text-green-600 dark:text-green-400",
  },
  failed: {
    key: "lastRunFailed",
    bgClass: "bg-red-500/10 border-red-500/20",
    textClass: "text-red-600 dark:text-red-400",
  },
  stopped: {
    key: "lastRunStopped",
    bgClass: "bg-gray-500/10 border-gray-500/20",
    textClass: "text-gray-600 dark:text-gray-400",
  },
  timeout: {
    key: "lastRunTimeout",
    bgClass: "bg-orange-500/10 border-orange-500/20",
    textClass: "text-orange-600 dark:text-orange-400",
  },
};

interface TaskChatAreaProps {
  task: AgentTaskDetail;
  selectedRun: AgentTaskExecution | null;
  activeExecution: AgentTaskExecution | null;
  isViewingHistory: boolean;
  onReturnToCurrent: () => void;
}

export function TaskChatArea({
  task,
  selectedRun,
  activeExecution,
  isViewingHistory,
  onReturnToCurrent,
}: TaskChatAreaProps) {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();
  const [showStartDialog, setShowStartDialog] = useState(false);

  const isReadOnly = !activeExecution || isViewingHistory;
  const channelId = selectedRun?.channelId ?? null;
  const displayStatus = selectedRun?.status ?? task.status;

  // Control mutations
  const pauseMutation = useMutation({
    mutationFn: () => tasksApi.pause(task.id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["task", task.id] }),
  });
  const resumeMutation = useMutation({
    mutationFn: () => tasksApi.resume(task.id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["task", task.id] }),
  });
  const stopMutation = useMutation({
    mutationFn: () => tasksApi.stop(task.id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["task", task.id] }),
  });

  const isMutating =
    pauseMutation.isPending ||
    resumeMutation.isPending ||
    stopMutation.isPending;

  // No channel and no run — show placeholder
  if (!channelId && !selectedRun) {
    return (
      <div className="flex-1 flex flex-col min-w-0 h-full">
        <div className="px-4 py-2 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold truncate">{task.title}</span>
            <Badge
              variant={STATUS_BADGE_VARIANT[task.status]}
              className="text-xs"
            >
              {t(`status.${task.status}`)}
            </Badge>
          </div>
          {task.status === "upcoming" && (
            <Button
              variant="default"
              size="sm"
              disabled={isMutating}
              onClick={() => setShowStartDialog(true)}
            >
              <Play size={14} />
              {t("chatArea.start")}
            </Button>
          )}
        </div>
        <TaskChatPlaceholder />
        <ManualTriggerDialog
          taskId={task.id}
          isOpen={showStartDialog}
          onClose={() => setShowStartDialog(false)}
        />
      </div>
    );
  }

  const finishedConfig =
    !isViewingHistory && !activeExecution && selectedRun
      ? FINISHED_BANNER_CONFIG[selectedRun.status]
      : null;

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full">
      {/* Custom top bar */}
      <div className="px-4 py-2 border-b border-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold truncate">{task.title}</span>
          <Badge
            variant={STATUS_BADGE_VARIANT[displayStatus]}
            className="text-xs shrink-0"
          >
            {t(`status.${displayStatus}`)}
          </Badge>
          {selectedRun && (
            <span className="text-xs text-muted-foreground shrink-0">
              v{selectedRun.taskVersion}
              {selectedRun.tokenUsage > 0 &&
                ` · ${selectedRun.tokenUsage} tokens`}
              {selectedRun.duration != null &&
                selectedRun.duration > 0 &&
                ` · ${selectedRun.duration}s`}
            </span>
          )}
        </div>
        <div className="flex gap-1 shrink-0">
          {task.status === "in_progress" && !isViewingHistory && (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={isMutating}
                onClick={() => pauseMutation.mutate()}
              >
                <Pause size={14} />
                {t("chatArea.pause")}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={isMutating}
                onClick={() => stopMutation.mutate()}
              >
                <Square size={14} />
                {t("chatArea.stop")}
              </Button>
            </>
          )}
          {task.status === "paused" && !isViewingHistory && (
            <>
              <Button
                variant="default"
                size="sm"
                disabled={isMutating}
                onClick={() => resumeMutation.mutate()}
              >
                <PlayCircle size={14} />
                {t("chatArea.resume")}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={isMutating}
                onClick={() => stopMutation.mutate()}
              >
                <Square size={14} />
                {t("chatArea.stop")}
              </Button>
            </>
          )}
          {task.status === "pending_action" && !isViewingHistory && (
            <Button
              variant="destructive"
              size="sm"
              disabled={isMutating}
              onClick={() => stopMutation.mutate()}
            >
              <Square size={14} />
              {t("chatArea.stop")}
            </Button>
          )}
          {task.status === "upcoming" && !isViewingHistory && (
            <Button
              variant="default"
              size="sm"
              disabled={isMutating}
              onClick={() => setShowStartDialog(true)}
            >
              <Play size={14} />
              {t("chatArea.start")}
            </Button>
          )}
          {["completed", "failed", "stopped", "timeout"].includes(
            task.status,
          ) &&
            !isViewingHistory && (
              <Button
                variant="default"
                size="sm"
                onClick={() => setShowStartDialog(true)}
              >
                <Play size={14} />
                {t("chatArea.startNew", "Start New")}
              </Button>
            )}
        </div>
      </div>

      {/* History viewing banner */}
      {isViewingHistory && selectedRun && (
        <div className="px-4 py-2 bg-blue-500/10 border-b border-blue-500/20 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-sm">
            <History size={14} className="text-blue-500" />
            <span className="text-blue-600 dark:text-blue-400">
              {t("chatArea.viewingHistory")}
            </span>
            <span className="text-xs text-muted-foreground">
              {selectedRun.startedAt &&
                new Date(selectedRun.startedAt).toLocaleString()}
              {" · "}
              {t(`status.${selectedRun.status}`)}
              {" · v"}
              {selectedRun.taskVersion}
            </span>
          </div>
          <Button variant="outline" size="sm" onClick={onReturnToCurrent}>
            <ArrowLeft size={14} />
            {t("chatArea.returnToCurrent")}
          </Button>
        </div>
      )}

      {/* Finished state banner */}
      {finishedConfig && selectedRun && (
        <div
          className={`px-4 py-2 border-b flex items-center justify-between shrink-0 ${finishedConfig.bgClass}`}
        >
          <div className="flex items-center gap-2">
            <span className={`text-sm font-medium ${finishedConfig.textClass}`}>
              {t(`chatArea.${finishedConfig.key}`)}
            </span>
            <span className="text-xs text-muted-foreground">
              {selectedRun.completedAt &&
                new Date(selectedRun.completedAt).toLocaleString()}
              {selectedRun.duration != null &&
                selectedRun.duration > 0 &&
                ` · ${selectedRun.duration}s`}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowStartDialog(true)}
          >
            <RotateCcw size={14} />
            {t("chatArea.rerun")}
          </Button>
        </div>
      )}

      {/* ChannelView */}
      {channelId ? (
        <div className="flex-1 min-h-0">
          <ChannelView
            key={channelId}
            channelId={channelId}
            hideHeader
            readOnly={isReadOnly}
          />
        </div>
      ) : (
        <TaskChatPlaceholder />
      )}

      <ManualTriggerDialog
        taskId={task.id}
        isOpen={showStartDialog}
        onClose={() => setShowStartDialog(false)}
      />
    </div>
  );
}
