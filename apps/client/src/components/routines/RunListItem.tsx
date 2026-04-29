import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/date-format";
import {
  HISTORY_TRIGGER_TYPE_LABEL_KEYS,
  isHistoryTriggerType,
  type HistoryTriggerType,
} from "@/lib/routine-trigger-keys";
import { STATUS_COLORS } from "@/lib/routine-status";
import type {
  RoutineExecution,
  TriggerContext,
  RetryTriggerContext,
} from "@/types/routine";

type TranslateFn = TFunction<"routines">;

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

type HistoryTriggerLabelKey =
  (typeof HISTORY_TRIGGER_TYPE_LABEL_KEYS)[HistoryTriggerType];

function triggerBadgeKey(
  triggerType: string | null,
  triggerContext: TriggerContext | null,
): HistoryTriggerLabelKey | null {
  if (isRetry(triggerContext)) {
    return HISTORY_TRIGGER_TYPE_LABEL_KEYS.retry;
  }
  if (triggerType && isHistoryTriggerType(triggerType)) {
    return HISTORY_TRIGGER_TYPE_LABEL_KEYS[triggerType];
  }
  return null;
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
  // elapsed reads Date.now() per render; refresh cadence is driven by
  // the parent's react-query polling (5s) — no local timer needed.
  const elapsed = Math.max(
    0,
    Math.floor((Date.now() - new Date(execution.startedAt).getTime()) / 1000),
  );
  return `${t("historyTab.running", "running")} ${formatDuration(elapsed)}+`;
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
  const badgeKey = triggerBadgeKey(
    execution.triggerType,
    execution.triggerContext,
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
        {badgeKey && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border shrink-0">
            {t(badgeKey)}
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
