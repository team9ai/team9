import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Play,
  Pause,
  Square,
  RotateCcw,
  PlayCircle,
  CheckCircle2,
  XCircle,
  Clock,
  Ban,
  AlertTriangle,
  Coins,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { tasksApi } from "@/services/api/tasks";
import { api } from "@/services/api";
import { useSelectedWorkspaceId } from "@/stores/useWorkspaceStore";
import type { OpenClawBotInfo } from "@/services/api/applications";
import { TaskStepTimeline } from "./TaskStepTimeline";
import { TaskInterventionCard } from "./TaskInterventionCard";
import { TaskDeliverableList } from "./TaskDeliverableList";
import { ManualTriggerDialog } from "./ManualTriggerDialog";
import type { AgentTaskDetail, AgentTaskStatus } from "@/types/task";

interface TaskBasicInfoTabProps {
  task: AgentTaskDetail;
  onClose: () => void;
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

const FINISHED_STATUSES: AgentTaskStatus[] = [
  "completed",
  "failed",
  "stopped",
  "timeout",
];

function isFinishedStatus(status: AgentTaskStatus): boolean {
  return FINISHED_STATUSES.includes(status);
}

/**
 * Format a duration in seconds to a human-readable string.
 * Examples: "2h 15m", "45s", "1d 3h"
 */
function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const minutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remainingHours = hours % 24;
    return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
  }
  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0
      ? `${hours}h ${remainingMinutes}m`
      : `${hours}h`;
  }
  const remainingSeconds = totalSeconds % 60;
  return remainingSeconds > 0
    ? `${minutes}m ${remainingSeconds}s`
    : `${minutes}m`;
}

function getFinishedBannerConfig(status: AgentTaskStatus) {
  switch (status) {
    case "completed":
      return {
        icon: CheckCircle2,
        bgClass: "bg-green-500/10 border-green-500/20",
        textClass: "text-green-600 dark:text-green-400",
        iconClass: "text-green-500",
      };
    case "failed":
      return {
        icon: XCircle,
        bgClass: "bg-red-500/10 border-red-500/20",
        textClass: "text-red-600 dark:text-red-400",
        iconClass: "text-red-500",
      };
    case "timeout":
      return {
        icon: Clock,
        bgClass: "bg-orange-500/10 border-orange-500/20",
        textClass: "text-orange-600 dark:text-orange-400",
        iconClass: "text-orange-500",
      };
    case "stopped":
      return {
        icon: Ban,
        bgClass: "bg-gray-500/10 border-gray-500/20",
        textClass: "text-gray-600 dark:text-gray-400",
        iconClass: "text-gray-500",
      };
    default:
      return null;
  }
}

export { STATUS_BADGE_VARIANT };

export function TaskBasicInfoTab({ task, onClose }: TaskBasicInfoTabProps) {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();
  const taskId = task.id;

  // Manual trigger dialog state
  const [showStartDialog, setShowStartDialog] = useState(false);

  // Control mutations
  const pauseMutation = useMutation({
    mutationFn: () => tasksApi.pause(taskId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["task", taskId] }),
  });

  const resumeMutation = useMutation({
    mutationFn: () => tasksApi.resume(taskId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["task", taskId] }),
  });

  const stopMutation = useMutation({
    mutationFn: () => tasksApi.stop(taskId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["task", taskId] }),
  });

  const restartMutation = useMutation({
    mutationFn: () => tasksApi.restart(taskId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["task", taskId] }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => tasksApi.delete(taskId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      onClose();
    },
  });

  const updateBotMutation = useMutation({
    mutationFn: (botId: string | null) => tasksApi.update(taskId, { botId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["task", taskId] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const isMutating =
    pauseMutation.isPending ||
    resumeMutation.isPending ||
    stopMutation.isPending ||
    restartMutation.isPending;

  // Fetch bots for assignment
  const workspaceId = useSelectedWorkspaceId();
  const { data: installedApps } = useQuery({
    queryKey: ["installed-applications", workspaceId],
    queryFn: () => api.applications.getInstalledApplications(),
    enabled: !!workspaceId,
  });

  const openClawApps =
    installedApps?.filter(
      (a) => a.applicationId === "openclaw" && a.status === "active",
    ) ?? [];

  const { data: allBots = [] } = useQuery({
    queryKey: ["openclaw-bots-all", workspaceId, openClawApps.map((a) => a.id)],
    queryFn: async () => {
      const results = await Promise.all(
        openClawApps.map((app) => api.applications.getOpenClawBots(app.id)),
      );
      return results.flat();
    },
    enabled: openClawApps.length > 0,
  });

  // Derive execution data
  const execution = task.currentExecution?.execution ?? null;
  const steps = task.currentExecution?.steps ?? [];
  const interventions = task.currentExecution?.interventions ?? [];
  const deliverables = task.currentExecution?.deliverables ?? [];

  // Pending interventions shown prominently at the top
  const pendingInterventions = useMemo(
    () => interventions.filter((i) => i.status === "pending"),
    [interventions],
  );

  const resolvedInterventions = useMemo(
    () => interventions.filter((i) => i.status !== "pending"),
    [interventions],
  );

  const handleStartTask = () => {
    setShowStartDialog(true);
  };

  return (
    <div className="space-y-5">
      {/* Task info */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge
            variant={STATUS_BADGE_VARIANT[task.status]}
            className="text-xs"
          >
            {t(`status.${task.status}`)}
          </Badge>
          {execution && (
            <span className="text-xs text-muted-foreground">
              v{execution.version}
            </span>
          )}
          {execution && execution.tokenUsage > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Coins size={12} />
              {t("detail.tokenCount", {
                count: execution.tokenUsage,
              })}
            </span>
          )}
        </div>
        <h2 className="text-base font-semibold leading-tight">{task.title}</h2>
        {task.description && (
          <p className="text-sm text-muted-foreground">{task.description}</p>
        )}

        {/* Bot assignment */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground shrink-0">
            {t("detail.assignBot")}
          </span>
          <Select
            value={task.botId ?? "__none__"}
            onValueChange={(val) =>
              updateBotMutation.mutate(val === "__none__" ? null : val)
            }
          >
            <SelectTrigger className="h-7 text-xs flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">
                <span className="text-muted-foreground">
                  {t("detail.noBot")}
                </span>
              </SelectItem>
              {allBots.map((bot: OpenClawBotInfo) => (
                <SelectItem key={bot.botId} value={bot.botId}>
                  {bot.displayName || bot.username}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Finished state banner */}
      {isFinishedStatus(task.status) &&
        (() => {
          const config = getFinishedBannerConfig(task.status);
          if (!config) return null;
          const BannerIcon = config.icon;
          return (
            <div
              className={`flex items-start gap-3 rounded-lg border p-3 ${config.bgClass}`}
            >
              <BannerIcon
                size={18}
                className={`shrink-0 mt-0.5 ${config.iconClass}`}
              />
              <div className="flex-1 min-w-0 space-y-1">
                <p className={`text-sm font-medium ${config.textClass}`}>
                  {t(`detail.finishedBanner.${task.status}`)}
                </p>

                {/* Completion time */}
                {execution?.completedAt && (
                  <p className="text-xs text-muted-foreground">
                    {t("detail.completedAt", {
                      time: new Date(execution.completedAt).toLocaleString(),
                    })}
                  </p>
                )}

                {/* Duration */}
                {execution?.duration != null && execution.duration > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t("detail.duration", {
                      duration: formatDuration(execution.duration),
                    })}
                  </p>
                )}

                {/* Error details for failed / timeout */}
                {execution?.error && (
                  <div className="mt-2 rounded-md bg-background/50 border border-border p-2">
                    <div className="flex items-center gap-1.5 mb-1">
                      <AlertTriangle
                        size={12}
                        className="text-muted-foreground shrink-0"
                      />
                      <span className="text-xs font-medium text-muted-foreground">
                        {execution.error.code
                          ? t("detail.errorWithCode", {
                              code: execution.error.code,
                            })
                          : t("detail.error")}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground break-words">
                      {execution.error.message}
                    </p>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

      {/* Control buttons */}
      <div className="flex flex-wrap gap-2">
        {task.status === "upcoming" && (
          <Button
            variant="default"
            size="sm"
            disabled={isMutating}
            onClick={handleStartTask}
          >
            <Play size={14} />
            {t("detail.start")}
          </Button>
        )}
        {task.status === "in_progress" && (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={isMutating}
              onClick={() => pauseMutation.mutate()}
            >
              <Pause size={14} />
              {t("detail.pause")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={isMutating}
              onClick={() => stopMutation.mutate()}
            >
              <Square size={14} />
              {t("detail.stop")}
            </Button>
          </>
        )}
        {task.status === "paused" && (
          <>
            <Button
              variant="default"
              size="sm"
              disabled={isMutating}
              onClick={() => resumeMutation.mutate()}
            >
              <PlayCircle size={14} />
              {t("detail.resume")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={isMutating}
              onClick={() => stopMutation.mutate()}
            >
              <Square size={14} />
              {t("detail.stop")}
            </Button>
          </>
        )}
        {(task.status === "completed" ||
          task.status === "failed" ||
          task.status === "stopped" ||
          task.status === "timeout") && (
          <Button
            variant="outline"
            size="sm"
            disabled={isMutating}
            onClick={() => restartMutation.mutate()}
          >
            <RotateCcw size={14} />
            {t("detail.restart")}
          </Button>
        )}
        {task.status === "pending_action" && (
          <Button
            variant="destructive"
            size="sm"
            disabled={isMutating}
            onClick={() => stopMutation.mutate()}
          >
            <Square size={14} />
            {t("detail.stop")}
          </Button>
        )}
        {/* Delete — only for non-active tasks */}
        {(task.status === "upcoming" ||
          task.status === "completed" ||
          task.status === "failed" ||
          task.status === "stopped" ||
          task.status === "timeout") && (
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            disabled={isMutating || deleteMutation.isPending}
            onClick={() => {
              if (window.confirm(t("detail.deleteConfirm"))) {
                deleteMutation.mutate();
              }
            }}
          >
            <Trash2 size={14} />
            {t("detail.delete")}
          </Button>
        )}
      </div>

      <Separator />

      {/* Pending interventions (prominently shown) */}
      {pendingInterventions.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-orange-500">
            {t("detail.pendingInterventions")}
          </h4>
          {pendingInterventions.map((intervention) => (
            <TaskInterventionCard
              key={intervention.id}
              intervention={intervention}
              taskId={taskId}
            />
          ))}
          <Separator />
        </div>
      )}

      {/* Steps timeline */}
      <div className="space-y-2">
        <h4 className="text-sm font-semibold">{t("detail.steps")}</h4>
        <TaskStepTimeline steps={steps} />
      </div>

      <Separator />

      {/* Deliverables */}
      <div className="space-y-2">
        <h4 className="text-sm font-semibold">{t("detail.deliverables")}</h4>
        <TaskDeliverableList deliverables={deliverables} />
      </div>

      {/* Past interventions */}
      {resolvedInterventions.length > 0 && (
        <>
          <Separator />
          <div className="space-y-2">
            <h4 className="text-sm font-semibold">
              {t("detail.pastInterventions")}
            </h4>
            {resolvedInterventions.map((intervention) => (
              <TaskInterventionCard
                key={intervention.id}
                intervention={intervention}
                taskId={taskId}
              />
            ))}
          </div>
        </>
      )}

      <ManualTriggerDialog
        taskId={task.id}
        isOpen={showStartDialog}
        onClose={() => setShowStartDialog(false)}
      />
    </div>
  );
}
