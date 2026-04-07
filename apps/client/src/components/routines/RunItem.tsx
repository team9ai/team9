import { useTranslation } from "react-i18next";
import {
  HISTORY_TRIGGER_TYPE_LABEL_KEYS,
  isHistoryTriggerType,
} from "@/lib/routine-trigger-keys";
import { cn } from "@/lib/utils";
import type { RoutineExecution, RoutineStatus } from "@/types/routine";

const STATUS_COLORS: Record<RoutineStatus, string> = {
  in_progress: "bg-blue-500",
  upcoming: "bg-gray-400",
  paused: "bg-yellow-500",
  pending_action: "bg-orange-500",
  completed: "bg-green-500",
  failed: "bg-red-500",
  stopped: "bg-gray-500",
  timeout: "bg-red-400",
};

interface RunItemProps {
  execution: RoutineExecution;
  isSelected: boolean;
  onClick: () => void;
}

export function RunItem({ execution, isSelected, onClick }: RunItemProps) {
  const { t } = useTranslation("routines");

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-2 py-1.5 rounded-md transition-colors",
        isSelected
          ? "bg-primary/10 ring-1 ring-primary/25"
          : "hover:bg-muted/50",
      )}
    >
      {/* Line 1: status dot + version + timestamp */}
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            "inline-block w-1.5 h-1.5 rounded-full shrink-0",
            STATUS_COLORS[execution.status] ?? "bg-gray-400",
          )}
        />
        <span
          className={cn(
            "text-xs font-medium",
            isSelected ? "text-primary" : "text-foreground",
          )}
        >
          v{execution.routineVersion}
        </span>
        {execution.startedAt && (
          <span className="text-[10px] text-muted-foreground ml-auto">
            {new Date(execution.startedAt).toLocaleString()}
          </span>
        )}
      </div>
      {/* Line 2: trigger type + duration */}
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5 pl-3">
        {execution.triggerType && (
          <span>
            {isHistoryTriggerType(execution.triggerType)
              ? t(HISTORY_TRIGGER_TYPE_LABEL_KEYS[execution.triggerType])
              : execution.triggerType}
          </span>
        )}
        {execution.duration != null && execution.duration > 0 && (
          <span>{execution.duration}s</span>
        )}
      </div>
    </button>
  );
}
