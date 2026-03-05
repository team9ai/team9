import type { KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { formatMessageTime } from "@/lib/date-utils";
import type { AgentTask, AgentTaskStatus } from "@/types/task";

interface TaskCardProps {
  task: AgentTask;
  onClick?: () => void;
}

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

function StatusIndicator({ status }: { status: AgentTaskStatus }) {
  const { t } = useTranslation("tasks");
  return (
    <span
      className={cn(
        "inline-block w-2 h-2 rounded-full shrink-0",
        STATUS_COLORS[status] ?? "bg-gray-400",
      )}
      aria-label={t(`status.${status}`)}
    />
  );
}

export function TaskCard({ task, onClick }: TaskCardProps) {
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick?.();
    }
  };

  return (
    <div
      onClick={onClick}
      {...(onClick && {
        role: "button" as const,
        tabIndex: 0,
        onKeyDown: handleKeyDown,
      })}
      className={cn(
        "p-4 rounded-lg border bg-card transition-colors",
        onClick && "cursor-pointer hover:border-primary/50",
      )}
    >
      <div className="flex items-center gap-2">
        <StatusIndicator status={task.status} />
        <span className="font-medium text-sm truncate">{task.title}</span>
      </div>
      {task.description && (
        <p className="text-xs text-muted-foreground mt-1 truncate">
          {task.description}
        </p>
      )}
      <div className="text-xs text-muted-foreground mt-2">
        {formatMessageTime(new Date(task.createdAt))}
      </div>
    </div>
  );
}
