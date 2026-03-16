import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ChevronLeft, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { tasksApi } from "@/services/api/tasks";
import { useExecutionStream } from "@/hooks/useExecutionStream";
import {
  ExecutionTimeline,
  type TimelineUserMessage,
} from "./ExecutionTimeline";
import type { AgentTaskStatus, TriggerContext } from "@/types/task";

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

const RETRIABLE_STATUSES: AgentTaskStatus[] = ["failed", "timeout", "stopped"];

interface RunDetailViewProps {
  taskId: string;
  executionId: string;
  onBack: () => void;
  onChannelChange?: (channelId: string | null) => void;
  userMessages?: TimelineUserMessage[];
}

const ACTIVE_STATUSES: AgentTaskStatus[] = [
  "in_progress",
  "pending_action",
  "paused",
];

export function RunDetailView({
  taskId,
  executionId,
  onBack,
  onChannelChange,
  userMessages,
}: RunDetailViewProps) {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();
  const [showRetryForm, setShowRetryForm] = useState(false);
  const [retryNotes, setRetryNotes] = useState("");

  const { data: execution, isLoading: execLoading } = useQuery({
    queryKey: ["task-execution", taskId, executionId],
    queryFn: () => tasksApi.getExecution(taskId, executionId),
    refetchInterval: (query) =>
      query.state.data?.taskcastTaskId ? 30000 : 5000,
  });

  // Notify parent of this run's channelId for the message input
  const channelId = execution?.channelId ?? null;
  const isActive = execution
    ? ACTIVE_STATUSES.includes(execution.status)
    : false;

  useExecutionStream(taskId, executionId, execution?.taskcastTaskId, isActive);

  useEffect(() => {
    onChannelChange?.(isActive ? channelId : null);
    return () => onChannelChange?.(null);
  }, [channelId, isActive, onChannelChange]);

  const { data: entries = [] } = useQuery({
    queryKey: ["task-execution-entries", taskId, executionId],
    queryFn: () => tasksApi.getExecutionEntries(taskId, executionId),
    refetchInterval: execution?.taskcastTaskId ? 30000 : 5000,
  });

  const retryMutation = useMutation({
    mutationFn: () =>
      tasksApi.retry(taskId, {
        executionId,
        notes: retryNotes.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["task-executions", taskId],
      });
      queryClient.invalidateQueries({ queryKey: ["task", taskId] });
      setShowRetryForm(false);
      setRetryNotes("");
      onBack();
    },
  });

  if (execLoading || !execution) {
    return (
      <div className="flex justify-center p-4">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const triggerCtx = execution.triggerContext as TriggerContext | null;
  const canRetry = RETRIABLE_STATUSES.includes(execution.status);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon-sm" onClick={onBack}>
          <ChevronLeft size={16} />
        </Button>
        <span className="text-sm font-medium">v{execution.taskVersion}</span>
        {execution.triggerType && (
          <Badge variant="outline" className="text-xs">
            {t(`runs.triggerType.${execution.triggerType}`)}
          </Badge>
        )}
        <Badge
          variant={STATUS_BADGE_VARIANT[execution.status]}
          className="text-xs"
        >
          {t(`status.${execution.status}`)}
        </Badge>
      </div>

      {/* Trigger context */}
      {triggerCtx && (
        <div className="rounded-md border border-border bg-muted/30 p-3 space-y-1 text-xs">
          {"notes" in triggerCtx && triggerCtx.notes && (
            <p>
              <span className="font-medium">{t("runs.notes")}:</span>{" "}
              {triggerCtx.notes}
            </p>
          )}
          {"scheduledAt" in triggerCtx && (
            <p>
              {t("runs.scheduledAt", {
                time: new Date(triggerCtx.scheduledAt).toLocaleString(),
              })}
            </p>
          )}
          {"messageContent" in triggerCtx && triggerCtx.messageContent && (
            <p className="truncate">{triggerCtx.messageContent}</p>
          )}
          {"senderId" in triggerCtx && (
            <p className="text-muted-foreground">
              {t("runs.messageFrom", { user: triggerCtx.senderId })}
            </p>
          )}
          {"originalExecutionId" in triggerCtx && (
            <p>
              {t("runs.retryOf", { version: "?" })}
              {"originalFailReason" in triggerCtx &&
                triggerCtx.originalFailReason && (
                  <span className="text-muted-foreground">
                    {" "}
                    — {triggerCtx.originalFailReason}
                  </span>
                )}
            </p>
          )}
          <p className="text-muted-foreground">
            {t("runs.triggeredAt", {
              time: new Date(triggerCtx.triggeredAt).toLocaleString(),
            })}
          </p>
        </div>
      )}

      {/* Execution info */}
      {execution.startedAt && (
        <p className="text-xs text-muted-foreground">
          {new Date(execution.startedAt).toLocaleString()}
          {execution.duration != null &&
            execution.duration > 0 &&
            ` · ${execution.duration}s`}
          {execution.tokenUsage > 0 && ` · ${execution.tokenUsage} tokens`}
        </p>
      )}

      <Separator />

      {/* Unified timeline */}
      <ExecutionTimeline
        entries={entries}
        taskId={taskId}
        userMessages={userMessages}
      />

      {/* Retry */}
      {canRetry && (
        <>
          <Separator />
          {showRetryForm ? (
            <div className="space-y-2">
              <Textarea
                value={retryNotes}
                onChange={(e) => setRetryNotes(e.target.value)}
                placeholder={t("runs.retryNotes")}
                rows={3}
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => retryMutation.mutate()}
                  disabled={retryMutation.isPending}
                >
                  {retryMutation.isPending && (
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  )}
                  {t("runs.retry")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowRetryForm(false)}
                >
                  {t("create.cancel")}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowRetryForm(true)}
            >
              <RotateCcw size={14} />
              {t("runs.retry")}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
