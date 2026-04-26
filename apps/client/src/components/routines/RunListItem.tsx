import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/date-format";
import type {
  RoutineExecution,
  RoutineStatus,
  TriggerContext,
  RetryTriggerContext,
} from "@/types/routine";

type TranslateFn = TFunction<"routines">;

const STATUS_COLORS: Record<RoutineStatus, string> = {
  draft: "bg-yellow-400",
  in_progress: "bg-blue-500",
  upcoming: "bg-gray-400",
  paused: "bg-yellow-500",
  pending_action: "bg-orange-500",
  completed: "bg-green-500",
  failed: "bg-red-500",
  stopped: "bg-gray-500",
  timeout: "bg-red-400",
};

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0s";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function isRetry(ctx: TriggerContext | null): ctx is RetryTriggerContext {
  return !!ctx && "originalExecutionId" in ctx && !!ctx.originalExecutionId;
}

function triggerBadgeLabel(
  triggerType: string | null,
  triggerContext: TriggerContext | null,
  t: TranslateFn,
): string | null {
  if (isRetry(triggerContext)) return t("detail.trigger.retry", "Retry");
  switch (triggerType) {
    case "manual":
      return t("detail.trigger.manual", "Manual");
    case "schedule":
      return t("detail.trigger.scheduled", "Scheduled");
    case "interval":
      return t("detail.trigger.interval", "Interval");
    case "channel_message":
      return t("detail.trigger.channel", "Channel");
    default:
      return null;
  }
}

function durationText(
  execution: RoutineExecution,
  t: TranslateFn,
): string | null {
  if (!execution.startedAt) return null;
  if (execution.completedAt) {
    const seconds =
      execution.duration ??
      Math.max(
        0,
        Math.floor(
          (new Date(execution.completedAt).getTime() -
            new Date(execution.startedAt).getTime()) /
            1000,
        ),
      );
    return formatDuration(seconds);
  }
  const elapsed = Math.max(
    0,
    Math.floor((Date.now() - new Date(execution.startedAt).getTime()) / 1000),
  );
  return `${t("detail.runListItem.runningPrefix", "running")} ${formatDuration(elapsed)}+`;
}

interface RunListItemProps {
  execution: RoutineExecution;
  isSelected: boolean;
  onClick: () => void;
}

export function RunListItem({
  execution,
  isSelected,
  onClick,
}: RunListItemProps) {
  const { t } = useTranslation("routines");
  const badge = triggerBadgeLabel(
    execution.triggerType,
    execution.triggerContext,
    t,
  );
  const dur = durationText(execution, t);

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-3 py-2 rounded-md border transition-colors",
        isSelected
          ? "bg-primary/10 border-primary/30 ring-1 ring-primary/25"
          : "border-border hover:bg-muted/50",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "inline-block w-2 h-2 rounded-full shrink-0",
            STATUS_COLORS[execution.status] ?? "bg-gray-400",
          )}
          aria-label={t(`status.${execution.status}`)}
        />
        <span
          className={cn(
            "text-xs font-medium",
            isSelected ? "text-primary" : "text-foreground",
          )}
        >
          {t(`status.${execution.status}`)}
        </span>
        <span className="text-[11px] text-muted-foreground">
          v{execution.routineVersion}
        </span>
        {execution.startedAt && (
          <span className="text-[11px] text-muted-foreground ml-auto">
            {formatDateTime(execution.startedAt)}
          </span>
        )}
        {badge && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border shrink-0">
            {badge}
          </span>
        )}
      </div>
      {(dur || execution.tokenUsage > 0) && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-1 pl-4">
          {execution.tokenUsage > 0 && (
            <span>
              {t("detail.tokenCount", {
                count: execution.tokenUsage,
                defaultValue: `${execution.tokenUsage} tokens`,
              })}
            </span>
          )}
          {dur && execution.tokenUsage > 0 && <span>·</span>}
          {dur && <span>{dur}</span>}
        </div>
      )}
    </button>
  );
}
