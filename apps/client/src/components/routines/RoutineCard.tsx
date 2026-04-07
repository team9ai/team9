import { useState, type KeyboardEvent, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronRight,
  ChevronDown,
  Settings,
  Coins,
  Play,
  Bot,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMessageTime } from "@/lib/date-utils";
import { RunItem } from "./RunItem";
import { ManualTriggerDialog } from "./ManualTriggerDialog";
import type { Routine, RoutineExecution, RoutineStatus } from "@/types/routine";

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

const SHOW_TOKEN_STATUSES: RoutineStatus[] = [
  "in_progress",
  "completed",
  "failed",
  "paused",
  "pending_action",
  "stopped",
  "timeout",
];

const DEFAULT_VISIBLE_RUNS = 3;

interface RoutineCardProps {
  routine: Routine;
  isExpanded: boolean;
  isActive: boolean;
  selectedRunId: string | null;
  executions: RoutineExecution[];
  botName?: string | null;
  onToggleExpand: () => void;
  onSelectRun: (runId: string) => void;
  onOpenSettings: () => void;
}

function StatusIndicator({ status }: { status: RoutineStatus }) {
  const { t } = useTranslation("routines");
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

export function RoutineCard({
  routine,
  isExpanded,
  isActive,
  selectedRunId,
  executions,
  botName,
  onToggleExpand,
  onSelectRun,
  onOpenSettings,
}: RoutineCardProps) {
  const { t } = useTranslation("routines");
  const [showAllRuns, setShowAllRuns] = useState(false);
  const [showStartDialog, setShowStartDialog] = useState(false);

  const showTokens =
    SHOW_TOKEN_STATUSES.includes(routine.status) &&
    routine.tokenUsage != null &&
    routine.tokenUsage > 0;

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggleExpand();
    }
  };

  const handleSettingsClick = (e: MouseEvent) => {
    e.stopPropagation();
    onOpenSettings();
  };

  const handleStartClick = (e: MouseEvent) => {
    e.stopPropagation();
    setShowStartDialog(true);
  };

  const visibleRuns = showAllRuns
    ? executions
    : executions.slice(0, DEFAULT_VISIBLE_RUNS);
  const hiddenCount = executions.length - DEFAULT_VISIBLE_RUNS;

  return (
    <div
      className={cn(
        "rounded-lg border bg-card transition-colors",
        isActive && "border-primary",
        !isActive && "hover:border-primary/50",
      )}
    >
      {/* Task header — clickable to expand/collapse */}
      <div
        onClick={onToggleExpand}
        role="button"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="p-3 cursor-pointer group"
      >
        <div className="flex items-center gap-2">
          {/* Expand/collapse arrow */}
          <span className="text-muted-foreground shrink-0">
            {isExpanded ? (
              <ChevronDown size={14} />
            ) : (
              <ChevronRight size={14} />
            )}
          </span>
          <StatusIndicator status={routine.status} />
          <span className="font-medium text-sm truncate flex-1">
            {routine.title}
          </span>
          {/* Action buttons — visible on hover */}
          <button
            onClick={handleStartClick}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted"
            aria-label={t("detail.start", "Start")}
          >
            <Play size={14} className="text-muted-foreground" />
          </button>
          <button
            onClick={handleSettingsClick}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted"
            aria-label={t("settingsTab.title", "Settings")}
          >
            <Settings size={14} className="text-muted-foreground" />
          </button>
        </div>
        {routine.description && (
          <p className="text-xs text-muted-foreground mt-1 truncate pl-6">
            {routine.description}
          </p>
        )}
        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1.5 pl-6">
          <span>{formatMessageTime(new Date(routine.createdAt))}</span>
          {botName && (
            <span className="inline-flex items-center gap-1 truncate">
              <Bot size={12} className="shrink-0" />
              {botName}
            </span>
          )}
          {showTokens && (
            <span className="inline-flex items-center gap-1">
              <Coins size={12} />
              {t("detail.tokenCount", { count: routine.tokenUsage })}
            </span>
          )}
        </div>
      </div>

      <ManualTriggerDialog
        routineId={routine.id}
        isOpen={showStartDialog}
        mode={
          ["completed", "failed", "stopped", "timeout"].includes(routine.status)
            ? "restart"
            : "start"
        }
        onClose={() => setShowStartDialog(false)}
      />

      {/* Expanded: Run list */}
      {isExpanded && (
        <div className="px-3 pb-3">
          <div
            className={cn(
              "ml-3 pl-2 border-l-2 border-border space-y-0.5",
              showAllRuns &&
                executions.length > 6 &&
                "max-h-75 overflow-y-auto",
            )}
          >
            {executions.length === 0 ? (
              <p className="text-xs text-muted-foreground py-1">
                {t("historyTab.empty", "No runs yet")}
              </p>
            ) : (
              <>
                {visibleRuns.map((exec) => (
                  <RunItem
                    key={exec.id}
                    execution={exec}
                    isSelected={exec.id === selectedRunId}
                    onClick={() => onSelectRun(exec.id)}
                  />
                ))}
                {!showAllRuns && hiddenCount > 0 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowAllRuns(true);
                    }}
                    className="w-full text-xs text-muted-foreground hover:text-foreground py-1 transition-colors"
                  >
                    {t("historyTab.showMore", {
                      count: hiddenCount,
                      defaultValue: `↓ ${hiddenCount} earlier runs`,
                    })}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
