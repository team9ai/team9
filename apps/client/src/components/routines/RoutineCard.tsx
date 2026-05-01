import { useState, type MouseEvent } from "react";
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
import { STATUS_COLORS } from "@/lib/routine-status";
import { RunItem } from "./RunItem";
import { CreationSessionRunItem } from "./CreationSessionRunItem";
import { ManualTriggerDialog } from "./ManualTriggerDialog";
import type { Routine, RoutineExecution, RoutineStatus } from "@/types/routine";
import type { SelectedRun } from "./RoutinesSidebar";

const SHOW_TOKEN_STATUSES: RoutineStatus[] = [
  "in_progress",
  "completed",
  "failed",
  "paused",
  "pending_action",
  "stopped",
  "timeout",
];

// Sidebar expansion only surfaces runs that the user can still influence.
// Terminal-state runs live on the detail page's Runs tab, not in the sidebar.
const ACTIVE_STATUSES: RoutineStatus[] = [
  "in_progress",
  "paused",
  "pending_action",
];

interface RoutineCardProps {
  routine: Routine;
  isExpanded: boolean;
  isActive: boolean;
  selectedRun: SelectedRun;
  executions: RoutineExecution[];
  botName?: string | null;
  onToggleExpand: () => void;
  onOpenRoutine: () => void;
  onSelectRun: (runId: string) => void;
  onOpenCreationSession: (routineId: string) => void;
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
  selectedRun,
  executions,
  botName,
  onToggleExpand,
  onOpenRoutine,
  onSelectRun,
  onOpenCreationSession,
  onOpenSettings,
}: RoutineCardProps) {
  const { t } = useTranslation("routines");
  const [showStartDialog, setShowStartDialog] = useState(false);

  const showTokens =
    SHOW_TOKEN_STATUSES.includes(routine.status) &&
    routine.tokenUsage != null &&
    routine.tokenUsage > 0;

  // Body click navigates to the detail page; chevron toggles expansion.
  // The two are intentionally split so the user can preview active runs
  // (chevron) without leaving the current page.
  const handleHeaderClick = (event?: MouseEvent) => {
    event?.stopPropagation();
    onOpenRoutine();
  };

  const handleChevronClick = (event: MouseEvent) => {
    event.stopPropagation();
    onToggleExpand();
  };

  const handleSettingsClick = (event: MouseEvent) => {
    event.stopPropagation();
    onOpenSettings();
  };

  const handleStartClick = (event: MouseEvent) => {
    event.stopPropagation();
    setShowStartDialog(true);
  };

  // Pre-compute whether the expanded body would render anything, so the
  // chevron icon only flips to the open glyph when there is actual content
  // to reveal. Routines with no active runs and no creation row keep the
  // closed glyph even after the user clicks the chevron — otherwise the
  // visual state contradicts the empty body that follows.
  const activeRuns = executions.filter((e) =>
    ACTIVE_STATUSES.includes(e.status),
  );
  const showCreationRow =
    routine.status === "draft" && !!routine.creationChannelId;
  const hasExpandableContent = activeRuns.length > 0 || showCreationRow;

  return (
    <div
      onClick={() => handleHeaderClick()}
      className={cn(
        "rounded-lg border bg-card transition-colors cursor-pointer",
        isActive && "border-primary",
        !isActive && "hover:border-primary/50",
      )}
    >
      {/* Task header — title button navigates; chevron, start, settings are siblings. */}
      <div className="p-3 group">
        <div className="flex items-center gap-2">
          {/* Chevron: toggles expansion without navigating. */}
          <button
            type="button"
            onClick={handleChevronClick}
            className="text-muted-foreground shrink-0 p-0.5 -m-0.5 rounded hover:bg-muted"
            aria-label={t("detail.toggleExpand")}
          >
            {isExpanded && hasExpandableContent ? (
              <ChevronDown size={14} />
            ) : (
              <ChevronRight size={14} />
            )}
          </button>
          {/* Title button: navigates to the detail page. */}
          <button
            type="button"
            onClick={handleHeaderClick}
            className="flex items-center gap-2 min-w-0 flex-1 text-left hover:opacity-80 transition-opacity"
          >
            <StatusIndicator status={routine.status} />
            <span className="font-medium text-sm truncate">
              {routine.title}
            </span>
          </button>
          {/* Action buttons — visible on hover */}
          <button
            type="button"
            onClick={handleStartClick}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted"
            aria-label={t("detail.start", "Start")}
          >
            <Play size={14} className="text-muted-foreground" />
          </button>
          <button
            type="button"
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

      {/* Expanded: active-only run list (terminal runs live on the detail
          page's Runs tab; the sidebar surface is reserved for runs the user
          can act on). Empty active list collapses to header only — no
          "no runs yet" placeholder. */}
      {isExpanded && hasExpandableContent && (
        <div className="px-3 pb-3" onClick={(event) => event.stopPropagation()}>
          <div className="ml-3 pl-2 border-l-2 border-border space-y-0.5">
            {activeRuns.map((exec) => (
              <RunItem
                key={exec.id}
                execution={exec}
                isSelected={
                  selectedRun?.kind === "execution" &&
                  selectedRun.executionId === exec.id
                }
                onClick={() => onSelectRun(exec.id)}
              />
            ))}
            {showCreationRow && (
              <CreationSessionRunItem
                isSelected={
                  selectedRun?.kind === "creation" &&
                  selectedRun.routineId === routine.id
                }
                onClick={() => onOpenCreationSession(routine.id)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
