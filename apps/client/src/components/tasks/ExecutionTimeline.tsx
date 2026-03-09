import { useTranslation } from "react-i18next";
import {
  Check,
  X,
  Loader2,
  Circle,
  AlertCircle,
  FileDown,
  Play,
  Flag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ExecutionEntry, AgentTaskStepStatus } from "@/types/task";
import { TaskInterventionCard } from "./TaskInterventionCard";

interface ExecutionTimelineProps {
  entries: ExecutionEntry[];
  taskId: string;
}

// ── Icon helpers ───────────────────────────────────────────────────

function StepIcon({ status }: { status: AgentTaskStepStatus }) {
  const base = "flex items-center justify-center w-6 h-6 rounded-full";
  switch (status) {
    case "completed":
      return (
        <div className={cn(base, "bg-green-500/15 text-green-500")}>
          <Check size={14} />
        </div>
      );
    case "in_progress":
      return (
        <div className={cn(base, "bg-blue-500/15 text-blue-500")}>
          <Loader2 size={14} className="animate-spin" />
        </div>
      );
    case "failed":
      return (
        <div className={cn(base, "bg-red-500/15 text-red-500")}>
          <X size={14} />
        </div>
      );
    default:
      return (
        <div className={cn(base, "bg-muted text-muted-foreground")}>
          <Circle size={10} />
        </div>
      );
  }
}

function InterventionIcon({ pending }: { pending: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center justify-center w-6 h-6 rounded-full",
        pending
          ? "bg-orange-500/15 text-orange-500"
          : "bg-muted text-muted-foreground",
      )}
    >
      <AlertCircle size={14} />
    </div>
  );
}

function DeliverableIcon() {
  return (
    <div className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-500/15 text-purple-500">
      <FileDown size={14} />
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  const base = "flex items-center justify-center w-6 h-6 rounded-full";
  if (status === "started") {
    return (
      <div className={cn(base, "bg-blue-500/15 text-blue-500")}>
        <Play size={12} />
      </div>
    );
  }
  const isError = ["failed", "timeout", "stopped"].includes(status);
  return (
    <div
      className={cn(
        base,
        isError
          ? "bg-red-500/15 text-red-500"
          : "bg-green-500/15 text-green-500",
      )}
    >
      <Flag size={12} />
    </div>
  );
}

// ── Timestamp helper ───────────────────────────────────────────────

function EntryTime({ iso }: { iso: string | null | undefined }) {
  if (!iso) return null;
  return (
    <span className="text-xs text-muted-foreground shrink-0">
      {new Date(iso).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })}
    </span>
  );
}

// ── Duration helper ────────────────────────────────────────────────

function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return remainingSeconds > 0
    ? `${minutes}m ${remainingSeconds}s`
    : `${minutes}m`;
}

// ── Main component ─────────────────────────────────────────────────

export function ExecutionTimeline({ entries, taskId }: ExecutionTimelineProps) {
  const { t } = useTranslation("tasks");

  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{t("timeline.empty")}</p>
    );
  }

  return (
    <div className="relative space-y-0">
      {entries.map((entry, idx) => {
        const isLast = idx === entries.length - 1;

        return (
          <div key={entryKey(entry, idx)} className="flex gap-3 relative">
            {/* Vertical connector */}
            {!isLast && (
              <div className="absolute left-3 top-6 w-px h-[calc(100%-6px)] bg-border" />
            )}

            {/* Icon */}
            <div className="relative z-10 shrink-0">
              {entry.type === "step" && <StepIcon status={entry.data.status} />}
              {entry.type === "intervention" && (
                <InterventionIcon pending={entry.data.status === "pending"} />
              )}
              {entry.type === "deliverable" && <DeliverableIcon />}
              {entry.type === "status_change" && (
                <StatusIcon status={entry.data.status} />
              )}
            </div>

            {/* Content */}
            <div className={cn("flex-1 min-w-0", !isLast && "pb-4")}>
              {entry.type === "step" && <StepEntry entry={entry} />}
              {entry.type === "intervention" && (
                <TaskInterventionCard
                  intervention={entry.data}
                  taskId={taskId}
                />
              )}
              {entry.type === "deliverable" && (
                <DeliverableEntry entry={entry} />
              )}
              {entry.type === "status_change" && <StatusEntry entry={entry} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Entry renderers ────────────────────────────────────────────────

function StepEntry({
  entry,
}: {
  entry: Extract<ExecutionEntry, { type: "step" }>;
}) {
  const { t } = useTranslation("tasks");
  const step = entry.data;
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "text-sm font-medium",
            step.status === "pending" && "text-muted-foreground",
          )}
        >
          {step.title}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          {step.duration != null && (
            <span className="text-xs text-muted-foreground">
              {formatDuration(step.duration)}
            </span>
          )}
          <EntryTime iso={step.startedAt ?? step.createdAt} />
        </div>
      </div>
      <span className="text-xs text-muted-foreground">
        {t(`stepStatus.${step.status}`)}
      </span>
    </div>
  );
}

function DeliverableEntry({
  entry,
}: {
  entry: Extract<ExecutionEntry, { type: "deliverable" }>;
}) {
  const d = entry.data;
  return (
    <a
      href={d.fileUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 rounded-md border border-border p-2 hover:bg-accent/50 transition-colors text-sm"
    >
      <span className="font-medium truncate flex-1">{d.fileName}</span>
      {d.fileSize != null && d.fileSize > 0 && (
        <span className="text-xs text-muted-foreground shrink-0">
          {formatFileSize(d.fileSize)}
        </span>
      )}
      <EntryTime iso={d.createdAt} />
    </a>
  );
}

function StatusEntry({
  entry,
}: {
  entry: Extract<ExecutionEntry, { type: "status_change" }>;
}) {
  const { t } = useTranslation("tasks");
  const STATUS_KEYS: Record<string, string> = {
    started: "timeline.statusChange.started",
    completed: "timeline.statusChange.completed",
    failed: "timeline.statusChange.failed",
    stopped: "timeline.statusChange.stopped",
    timeout: "timeline.statusChange.timeout",
    paused: "timeline.statusChange.paused",
  };
  const key = STATUS_KEYS[entry.data.status];
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm text-muted-foreground italic">
        {key ? t(key as never) : entry.data.status}
      </span>
      <EntryTime iso={entry.data.at} />
    </div>
  );
}

// ── Utils ──────────────────────────────────────────────────────────

function entryKey(entry: ExecutionEntry, idx: number): string {
  if (entry.type === "status_change") return `status-${idx}`;
  return `${entry.type}-${entry.data.id}`;
}

function formatFileSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}
