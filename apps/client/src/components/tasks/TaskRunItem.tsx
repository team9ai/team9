import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { AgentTaskExecution, AgentTaskStatus } from "@/types/task";

const STATUS_COLORS: Record<AgentTaskStatus, string> = {
  in_progress: "bg-blue-500",
  upcoming: "bg-gray-400",
  paused: "bg-yellow-500",
  pending_action: "bg-orange-500",
  completed: "bg-green-500",
  failed: "bg-red-500",
  stopped: "bg-gray-500",
  timeout: "bg-red-400",
};

const TRIGGER_TYPE_KEYS: Record<string, string> = {
  manual: "historyTab.manual",
  interval: "historyTab.interval",
  schedule: "historyTab.schedule",
  channel_message: "historyTab.channelMessage",
  retry: "historyTab.retry",
};

interface TaskRunItemProps {
  execution: AgentTaskExecution;
  isSelected: boolean;
  onClick: () => void;
}

export function TaskRunItem({
  execution,
  isSelected,
  onClick,
}: TaskRunItemProps) {
  const { t } = useTranslation("tasks");

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-2 py-1.5 rounded-md border transition-colors",
        isSelected
          ? "border-primary bg-accent text-accent-foreground"
          : "border-transparent hover:bg-muted/50",
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
        <span className="text-xs font-medium">v{execution.taskVersion}</span>
        {execution.startedAt && (
          <span
            className={cn(
              "text-[10px] ml-auto",
              isSelected
                ? "text-accent-foreground/70"
                : "text-muted-foreground",
            )}
          >
            {new Date(execution.startedAt).toLocaleString()}
          </span>
        )}
      </div>
      {/* Line 2: trigger type + duration */}
      <div
        className={cn(
          "flex items-center gap-2 text-[10px] mt-0.5 pl-3",
          isSelected ? "text-accent-foreground/70" : "text-muted-foreground",
        )}
      >
        {execution.triggerType && (
          <span>
            {TRIGGER_TYPE_KEYS[execution.triggerType]
              ? t(TRIGGER_TYPE_KEYS[execution.triggerType])
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
