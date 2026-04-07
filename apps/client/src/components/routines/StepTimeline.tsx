import { useTranslation } from "react-i18next";
import { Check, X, Loader2, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RoutineStep, RoutineStepStatus } from "@/types/routine";

interface StepTimelineProps {
  steps: RoutineStep[];
}

function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return remainingSeconds > 0
    ? `${minutes}m ${remainingSeconds}s`
    : `${minutes}m`;
}

function StepIcon({ status }: { status: RoutineStepStatus }) {
  switch (status) {
    case "completed":
      return (
        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-green-500/15 text-green-500">
          <Check size={14} />
        </div>
      );
    case "in_progress":
      return (
        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-500/15 text-blue-500">
          <Loader2 size={14} className="animate-spin" />
        </div>
      );
    case "failed":
      return (
        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-red-500/15 text-red-500">
          <X size={14} />
        </div>
      );
    case "pending":
    default:
      return (
        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-muted text-muted-foreground">
          <Circle size={10} />
        </div>
      );
  }
}

export function StepTimeline({ steps }: StepTimelineProps) {
  const { t } = useTranslation("routines");
  const sorted = [...steps].sort((a, b) => a.orderIndex - b.orderIndex);

  if (sorted.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{t("detail.noSteps")}</p>
    );
  }

  return (
    <div className="relative space-y-0">
      {sorted.map((step, idx) => (
        <div key={step.id} className="flex gap-3 relative">
          {/* Vertical connector line */}
          {idx < sorted.length - 1 && (
            <div className="absolute left-3 top-6 w-px h-[calc(100%-6px)] bg-border" />
          )}

          {/* Step icon */}
          <div className="relative z-10 shrink-0">
            <StepIcon status={step.status} />
          </div>

          {/* Step content */}
          <div
            className={cn("flex-1 pb-4", idx === sorted.length - 1 && "pb-0")}
          >
            <div className="flex items-center justify-between gap-2">
              <span
                className={cn(
                  "text-sm font-medium",
                  step.status === "pending" && "text-muted-foreground",
                )}
              >
                {step.orderIndex + 1}. {step.title}
              </span>
              {step.duration != null && (
                <span className="text-xs text-muted-foreground shrink-0">
                  {formatDuration(step.duration)}
                </span>
              )}
            </div>
            <span className="text-xs text-muted-foreground">
              {t(`stepStatus.${step.status}`)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
