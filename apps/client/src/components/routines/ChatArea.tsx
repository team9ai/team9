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
import { ChatPlaceholder } from "./ChatPlaceholder";
import { ManualTriggerDialog } from "./ManualTriggerDialog";
import { routinesApi } from "@/services/api/routines";
import { formatDateTime } from "@/lib/date-format";
import type {
  RoutineStatus,
  RoutineDetail,
  RoutineExecution,
} from "@/types/routine";

const STATUS_BADGE_VARIANT: Record<
  RoutineStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  draft: "outline",
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
    RoutineStatus,
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

interface ChatAreaProps {
  routine: RoutineDetail;
  selectedRun: RoutineExecution | null;
  activeExecution: RoutineExecution | null;
  isViewingHistory: boolean;
  onReturnToCurrent: () => void;
  creationChannelId?: string | null;
}

export function ChatArea({
  routine,
  selectedRun,
  activeExecution,
  isViewingHistory,
  onReturnToCurrent,
  creationChannelId,
}: ChatAreaProps) {
  const { t } = useTranslation("routines");
  const queryClient = useQueryClient();
  const [dialogMode, setDialogMode] = useState<"start" | "restart" | null>(
    null,
  );

  const isCreationMode = !!creationChannelId;
  const channelId = isCreationMode
    ? creationChannelId!
    : (selectedRun?.channelId ?? null);
  const isReadOnly = isCreationMode
    ? false
    : !activeExecution || isViewingHistory;
  const displayStatus = selectedRun?.status ?? routine.status;

  // Control mutations
  const pauseMutation = useMutation({
    mutationFn: () => routinesApi.pause(routine.id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["routine", routine.id] }),
  });
  const resumeMutation = useMutation({
    mutationFn: () => routinesApi.resume(routine.id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["routine", routine.id] }),
  });
  const stopMutation = useMutation({
    mutationFn: () => routinesApi.stop(routine.id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["routine", routine.id] }),
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
            <span className="text-sm font-semibold truncate">
              {routine.title}
            </span>
            <Badge
              variant={STATUS_BADGE_VARIANT[routine.status]}
              className="text-xs"
            >
              {t(`status.${routine.status}`)}
            </Badge>
          </div>
          {routine.status === "upcoming" && (
            <Button
              variant="default"
              size="sm"
              disabled={isMutating}
              onClick={() => setDialogMode("start")}
            >
              <Play size={14} />
              {t("chatArea.start")}
            </Button>
          )}
        </div>
        <ChatPlaceholder />
        <ManualTriggerDialog
          routineId={routine.id}
          isOpen={!!dialogMode}
          mode={dialogMode ?? "start"}
          onClose={() => setDialogMode(null)}
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
          <span className="text-sm font-semibold truncate">
            {routine.title}
          </span>
          <Badge
            variant={
              isCreationMode ? "outline" : STATUS_BADGE_VARIANT[displayStatus]
            }
            className={
              isCreationMode
                ? "text-xs shrink-0 border-yellow-300 bg-yellow-100 text-yellow-800 dark:border-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-200"
                : "text-xs shrink-0"
            }
          >
            {isCreationMode
              ? t("creation.bannerStatus", "In Creation")
              : t(`status.${displayStatus}`)}
          </Badge>
          {!isCreationMode && selectedRun && (
            <span className="text-xs text-muted-foreground shrink-0">
              v{selectedRun.routineVersion}
              {selectedRun.tokenUsage > 0 &&
                ` · ${selectedRun.tokenUsage} tokens`}
              {selectedRun.duration != null &&
                selectedRun.duration > 0 &&
                ` · ${selectedRun.duration}s`}
            </span>
          )}
        </div>
        {!isCreationMode && (
          <div className="flex gap-1 shrink-0">
            {routine.status === "in_progress" && !isViewingHistory && (
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
            {routine.status === "paused" && !isViewingHistory && (
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
            {routine.status === "pending_action" && !isViewingHistory && (
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
            {routine.status === "upcoming" && !isViewingHistory && (
              <Button
                variant="default"
                size="sm"
                disabled={isMutating}
                onClick={() => setDialogMode("start")}
              >
                <Play size={14} />
                {t("chatArea.start")}
              </Button>
            )}
            {["completed", "failed", "stopped", "timeout"].includes(
              routine.status,
            ) &&
              !isViewingHistory && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDialogMode("restart")}
                >
                  <RotateCcw size={14} />
                  {t("chatArea.rerun")}
                </Button>
              )}
          </div>
        )}
      </div>

      {/* History viewing banner */}
      {!isCreationMode && isViewingHistory && selectedRun && (
        <div className="px-4 py-2 bg-blue-500/10 border-b border-blue-500/20 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-sm">
            <History size={14} className="text-blue-500" />
            <span className="text-blue-600 dark:text-blue-400">
              {t("chatArea.viewingHistory")}
            </span>
            <span className="text-xs text-muted-foreground">
              {selectedRun.startedAt && formatDateTime(selectedRun.startedAt)}
              {" · "}
              {t(`status.${selectedRun.status}`)}
              {" · v"}
              {selectedRun.routineVersion}
            </span>
          </div>
          <Button variant="outline" size="sm" onClick={onReturnToCurrent}>
            <ArrowLeft size={14} />
            {t("chatArea.returnToCurrent")}
          </Button>
        </div>
      )}

      {/* Finished state banner */}
      {!isCreationMode && finishedConfig && selectedRun && (
        <div
          className={`px-4 py-2 border-b flex items-center justify-between shrink-0 ${finishedConfig.bgClass}`}
        >
          <div className="flex items-center gap-2">
            <span className={`text-sm font-medium ${finishedConfig.textClass}`}>
              {t(`chatArea.${finishedConfig.key}`)}
            </span>
            <span className="text-xs text-muted-foreground">
              {selectedRun.completedAt &&
                formatDateTime(selectedRun.completedAt)}
              {selectedRun.duration != null &&
                selectedRun.duration > 0 &&
                ` · ${selectedRun.duration}s`}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDialogMode("restart")}
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
        <ChatPlaceholder />
      )}

      <ManualTriggerDialog
        routineId={routine.id}
        isOpen={!!dialogMode}
        mode={dialogMode ?? "start"}
        onClose={() => setDialogMode(null)}
      />
    </div>
  );
}
