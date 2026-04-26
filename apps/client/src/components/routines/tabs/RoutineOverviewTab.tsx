import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/date-format";
import { routinesApi } from "@/services/api/routines";
import { api } from "@/services/api";
import { useSelectedWorkspaceId } from "@/stores/useWorkspaceStore";
import { RunListItem } from "../RunListItem";
import type { RoutineDetail, RoutineStatus } from "@/types/routine";

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

interface RoutineOverviewTabProps {
  routine: RoutineDetail;
  onSwitchTab: (tab: "overview" | "triggers" | "documents" | "runs") => void;
}

export function RoutineOverviewTab({
  routine,
  onSwitchTab,
}: RoutineOverviewTabProps) {
  const { t } = useTranslation("routines");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const workspaceId = useSelectedWorkspaceId();

  const { data: executions = [] } = useQuery({
    queryKey: ["routine-executions", routine.id],
    queryFn: () => routinesApi.getExecutions(routine.id),
    refetchInterval: 5000,
  });

  const { data: installedApps = [] } = useQuery({
    queryKey: ["installed-applications-with-bots", workspaceId],
    queryFn: () => api.applications.getInstalledApplicationsWithBots(),
    enabled: !!workspaceId,
  });

  const allBots = useMemo(
    () =>
      installedApps
        .filter((a) => a.status === "active")
        .flatMap((a) => a.bots)
        .filter((b) => b.botId),
    [installedApps],
  );

  const updateBotMutation = useMutation({
    mutationFn: (botId: string | null) =>
      routinesApi.update(routine.id, { botId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["routine", routine.id] });
      queryClient.invalidateQueries({ queryKey: ["routines"] });
    },
  });

  const lastRunAt =
    routine.currentExecution?.execution.startedAt ??
    executions[0]?.startedAt ??
    null;
  const recent5 = executions.slice(0, 5);
  const currentExecution = routine.currentExecution?.execution;
  const tokenUsage = routine.tokenUsage ?? 0;

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-5 max-w-2xl">
        {routine.description && (
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">
            {routine.description}
          </p>
        )}

        <div className="grid grid-cols-2 gap-4">
          <MetaCell
            label={t("detail.createdAt")}
            value={formatDateTime(routine.createdAt)}
          />
          <MetaCell
            label={t("detail.lastRunAt")}
            value={lastRunAt ? formatDateTime(lastRunAt) : "—"}
          />
          {tokenUsage > 0 && (
            <MetaCell
              label={t("detail.totalTokens")}
              value={String(tokenUsage)}
            />
          )}
          {currentExecution && (
            <div className="space-y-1">
              <div className="text-[11px] text-muted-foreground">
                {t("detail.currentRun")}
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "inline-block w-2 h-2 rounded-full",
                    STATUS_COLORS[currentExecution.status] ?? "bg-gray-400",
                  )}
                />
                <span className="text-sm">
                  {t(`status.${currentExecution.status}`)}
                </span>
                <button
                  className="ml-auto text-xs text-primary hover:underline"
                  onClick={() =>
                    void navigate({
                      to: "/routines/$routineId/runs/$executionId",
                      params: {
                        routineId: routine.id,
                        executionId: currentExecution.id,
                      },
                    })
                  }
                >
                  {t("detail.view")}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-1">
          <div className="text-[11px] text-muted-foreground">
            {t("detail.assignBot")}
          </div>
          <Select
            value={routine.botId ?? "__none__"}
            onValueChange={(val) =>
              updateBotMutation.mutate(val === "__none__" ? null : val)
            }
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">
                <span className="text-muted-foreground">
                  {t("detail.noBot")}
                </span>
              </SelectItem>
              {allBots.map((bot) => (
                <SelectItem key={bot.botId} value={bot.botId}>
                  {bot.displayName || bot.username}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <section className="space-y-2" data-testid="overview-recent-runs">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{t("detail.recentRuns")}</h3>
            {executions.length > 0 && (
              <button
                onClick={() => onSwitchTab("runs")}
                className="text-xs text-primary hover:underline"
              >
                {t("detail.viewAllRuns")}
              </button>
            )}
          </div>
          {recent5.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4">
              {t("historyTab.empty")}
            </p>
          ) : (
            <div className="space-y-1.5">
              {recent5.map((exec) => (
                <RunListItem
                  key={exec.id}
                  execution={exec}
                  isSelected={false}
                  onClick={() =>
                    void navigate({
                      to: "/routines/$routineId/runs/$executionId",
                      params: {
                        routineId: routine.id,
                        executionId: exec.id,
                      },
                    })
                  }
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </ScrollArea>
  );
}

function MetaCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  );
}
