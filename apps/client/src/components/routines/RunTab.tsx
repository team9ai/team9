import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  HISTORY_TRIGGER_TYPE_LABEL_KEYS,
  isHistoryTriggerType,
} from "@/lib/routine-trigger-keys";
import { routinesApi } from "@/services/api/routines";
import { ExecutionTimeline } from "./ExecutionTimeline";
import { InterventionCard } from "./InterventionCard";
import { useExecutionStream } from "@/hooks/useExecutionStream";
import type { RoutineStatus, RoutineExecution } from "@/types/routine";

const STATUS_BADGE_VARIANT: Record<
  RoutineStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  in_progress: "default",
  upcoming: "secondary",
  paused: "outline",
  pending_action: "default",
  completed: "secondary",
  failed: "destructive",
  stopped: "outline",
  timeout: "destructive",
};

const ACTIVE_STATUSES: RoutineStatus[] = [
  "in_progress",
  "pending_action",
  "paused",
];

interface RunTabProps {
  routineId: string;
  execution: RoutineExecution | null;
}

export function RunTab({ routineId, execution }: RunTabProps) {
  const { t } = useTranslation("routines");

  const isActive = execution
    ? ACTIVE_STATUSES.includes(execution.status)
    : false;

  // SSE streaming for active runs
  useExecutionStream(
    routineId,
    execution?.id,
    execution?.taskcastTaskId,
    isActive,
  );

  // Fetch timeline entries
  const { data: entries = [] } = useQuery({
    queryKey: ["routine-execution-entries", routineId, execution?.id],
    queryFn: () => routinesApi.getExecutionEntries(routineId, execution!.id),
    enabled: !!execution,
    refetchInterval: execution?.taskcastTaskId ? 30000 : 5000,
  });

  // Fetch execution detail for interventions
  const { data: executionDetail } = useQuery({
    queryKey: ["routine-execution", routineId, execution?.id],
    queryFn: () => routinesApi.getExecution(routineId, execution!.id),
    enabled: !!execution,
    refetchInterval: execution?.taskcastTaskId ? 30000 : 5000,
  });

  if (!execution) {
    return (
      <div className="flex items-center justify-center h-32">
        <p className="text-sm text-muted-foreground">
          {t("runTab.noExecution")}
        </p>
      </div>
    );
  }

  const pendingInterventions =
    executionDetail?.interventions.filter((i) => i.status === "pending") ?? [];

  return (
    <div className="space-y-4">
      {/* Status info */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Badge
            variant={STATUS_BADGE_VARIANT[execution.status]}
            className="text-xs"
          >
            {t(`status.${execution.status}`)}
          </Badge>
          <span className="text-xs text-muted-foreground">
            v{execution.taskVersion}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          {execution.triggerType && (
            <div>
              <div className="text-muted-foreground">
                {t("runTab.triggerType")}
              </div>
              <div>
                {isHistoryTriggerType(execution.triggerType)
                  ? t(HISTORY_TRIGGER_TYPE_LABEL_KEYS[execution.triggerType])
                  : execution.triggerType}
              </div>
            </div>
          )}
          {execution.duration != null && execution.duration > 0 && (
            <div>
              <div className="text-muted-foreground">
                {t("runTab.duration")}
              </div>
              <div>{execution.duration}s</div>
            </div>
          )}
          {execution.tokenUsage > 0 && (
            <div>
              <div className="text-muted-foreground">
                {t("runTab.tokenUsage")}
              </div>
              <div>{execution.tokenUsage} tokens</div>
            </div>
          )}
          {execution.startedAt && (
            <div>
              <div className="text-muted-foreground">{t("runTab.status")}</div>
              <div>{new Date(execution.startedAt).toLocaleString()}</div>
            </div>
          )}
        </div>
      </div>

      {/* Pending interventions */}
      {pendingInterventions.length > 0 && (
        <>
          <Separator />
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-orange-500">
              {t("detail.pendingInterventions")}
            </h4>
            {pendingInterventions.map((intervention) => (
              <InterventionCard
                key={intervention.id}
                intervention={intervention}
                routineId={routineId}
              />
            ))}
          </div>
        </>
      )}

      {/* Timeline */}
      {entries.length > 0 && (
        <>
          <Separator />
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground mb-2">
              {t("runTab.timeline")}
            </h4>
            <ExecutionTimeline entries={entries} routineId={routineId} />
          </div>
        </>
      )}
    </div>
  );
}
