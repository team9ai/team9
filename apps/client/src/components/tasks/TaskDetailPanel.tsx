import { useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  X,
  Loader2,
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { tasksApi } from "@/services/api/tasks";
import { TaskStepTimeline } from "./TaskStepTimeline";
import { TaskInterventionCard } from "./TaskInterventionCard";
import { TaskDeliverableList } from "./TaskDeliverableList";
import { DocumentVersionHistory } from "./DocumentVersionHistory";
import { MessageInput } from "@/components/channel/MessageInput";
import { useSendMessage } from "@/hooks/useMessages";
import type { AgentTaskStatus } from "@/types/task";
import type { AttachmentDto } from "@/types/im";

interface TaskDetailPanelProps {
  taskId: string;
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
 * Format a duration in milliseconds to a human-readable string.
 * Examples: "2h 15m", "45s", "1d 3h", "120ms"
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
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
  if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return remainingSeconds > 0
      ? `${minutes}m ${remainingSeconds}s`
      : `${minutes}m`;
  }
  return `${seconds}s`;
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

export function TaskDetailPanel({ taskId, onClose }: TaskDetailPanelProps) {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();

  // Fetch task detail (includes current execution with steps, interventions, deliverables)
  const {
    data: task,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => tasksApi.getById(taskId),
    refetchInterval: 5000, // Poll while panel is open
  });

  // Control mutations
  const startMutation = useMutation({
    mutationFn: () => tasksApi.start(taskId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["task", taskId] }),
  });

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

  const isMutating =
    startMutation.isPending ||
    pauseMutation.isPending ||
    resumeMutation.isPending ||
    stopMutation.isPending ||
    restartMutation.isPending;

  // Derive execution data
  const execution = task?.currentExecution?.execution ?? null;
  const executionChannelId = execution?.channelId ?? undefined;

  // Send message to the task execution channel
  const sendMessage = useSendMessage(executionChannelId ?? "");
  const handleSendMessage = useCallback(
    async (content: string, attachments?: AttachmentDto[]) => {
      if (!content.trim() && (!attachments || attachments.length === 0)) return;
      await sendMessage.mutateAsync({ content, attachments });
    },
    [sendMessage],
  );
  const steps = task?.currentExecution?.steps ?? [];
  const interventions = task?.currentExecution?.interventions ?? [];
  const deliverables = task?.currentExecution?.deliverables ?? [];

  // Pending interventions shown prominently at the top
  const pendingInterventions = useMemo(
    () => interventions.filter((i) => i.status === "pending"),
    [interventions],
  );

  const resolvedInterventions = useMemo(
    () => interventions.filter((i) => i.status !== "pending"),
    [interventions],
  );

  // TODO: TaskCast SSE integration
  // When @taskcast/react is available, subscribe to real-time step/status updates
  // via SSE instead of polling. For now, we use refetchInterval above.

  return (
    <div className="border-l bg-background flex flex-col h-full w-[400px]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <h3 className="text-sm font-semibold truncate">{t("detail.title")}</h3>
        <Button variant="ghost" size="icon-sm" onClick={onClose}>
          <X size={16} />
        </Button>
      </div>

      {/* Content */}
      {isLoading && (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {isError && (
        <div className="flex-1 flex items-center justify-center px-4">
          <p className="text-sm text-muted-foreground">
            {t("detail.loadError")}
          </p>
        </div>
      )}

      {task && !isLoading && (
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-5">
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
              <h2 className="text-base font-semibold leading-tight">
                {task.title}
              </h2>
              {task.description && (
                <p className="text-sm text-muted-foreground">
                  {task.description}
                </p>
              )}
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
                            time: new Date(
                              execution.completedAt,
                            ).toLocaleString(),
                          })}
                        </p>
                      )}

                      {/* Duration */}
                      {execution?.duration != null &&
                        execution.duration > 0 && (
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
                  onClick={() => startMutation.mutate()}
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
              <h4 className="text-sm font-semibold">
                {t("detail.deliverables")}
              </h4>
              <TaskDeliverableList deliverables={deliverables} />
            </div>

            {/* Document version history */}
            {task.documentId && (
              <>
                <Separator />
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold">
                    {t("detail.versionHistory.title")}
                  </h4>
                  <DocumentVersionHistory documentId={task.documentId} />
                </div>
              </>
            )}

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
          </div>
        </ScrollArea>
      )}

      {/* Message input for the task execution channel */}
      {executionChannelId && (
        <div className="border-t shrink-0">
          <MessageInput
            channelId={executionChannelId}
            onSend={handleSendMessage}
            disabled={sendMessage.isPending}
            compact
            placeholder={t("detail.messageInputPlaceholder")}
          />
        </div>
      )}
    </div>
  );
}
