import { useMemo } from "react";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { tasksApi } from "@/services/api/tasks";
import { TaskStepTimeline } from "./TaskStepTimeline";
import { TaskInterventionCard } from "./TaskInterventionCard";
import { TaskDeliverableList } from "./TaskDeliverableList";
import type { AgentTaskStatus } from "@/types/task";

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
    </div>
  );
}
