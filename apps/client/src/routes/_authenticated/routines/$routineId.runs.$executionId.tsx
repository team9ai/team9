import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { RoutinesSidebar } from "@/components/routines/RoutinesSidebar";
import { ChatArea } from "@/components/routines/ChatArea";
import { RightPanel } from "@/components/routines/RightPanel";
import { routinesApi } from "@/services/api/routines";

export const Route = createFileRoute(
  "/_authenticated/routines/$routineId/runs/$executionId",
)({
  component: RoutineRunPage,
});

function RoutineRunPage() {
  const { routineId, executionId } = Route.useParams();
  const navigate = useNavigate();
  const { t } = useTranslation("routines");

  const { data: routine } = useQuery({
    queryKey: ["routine", routineId],
    queryFn: () => routinesApi.getById(routineId),
    refetchInterval: (query) =>
      query.state.data?.currentExecution?.execution.taskcastTaskId
        ? 30000
        : 5000,
  });

  const { data: executions = [], isLoading: executionsLoading } = useQuery({
    queryKey: ["routine-executions", routineId],
    queryFn: () => routinesApi.getExecutions(routineId),
    refetchInterval: 5000,
  });

  const isCreation = executionId === "creation";

  const selectedRunExecution = useMemo(() => {
    if (isCreation) return null;
    if (routine?.currentExecution?.execution.id === executionId) {
      return routine.currentExecution.execution;
    }
    return executions.find((e) => e.id === executionId) ?? null;
  }, [executionId, executions, isCreation, routine]);

  const activeExecution = routine?.currentExecution?.execution ?? null;
  const isViewingHistory =
    !isCreation &&
    !!selectedRunExecution &&
    !!activeExecution &&
    selectedRunExecution.id !== activeExecution.id;

  const handleReturnToCurrent = useCallback(() => {
    if (!activeExecution) return;
    void navigate({
      to: "/routines/$routineId/runs/$executionId",
      params: { routineId, executionId: activeExecution.id },
    });
  }, [activeExecution, navigate, routineId]);

  if (!routine) {
    return (
      <div className="flex h-full">
        <RoutinesSidebar
          selectedRoutineId={routineId}
          selectedExecutionId={executionId}
        />
        <div className="flex-1" />
      </div>
    );
  }

  if (
    !isCreation &&
    !executionsLoading &&
    routine.currentExecution?.execution.id !== executionId &&
    selectedRunExecution === null
  ) {
    return (
      <div className="flex h-full">
        <RoutinesSidebar
          selectedRoutineId={routineId}
          selectedExecutionId={executionId}
        />
        <div
          data-testid="run-not-found"
          className="flex-1 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground"
        >
          <span>{t("detail.runNotFound", "Run not found")}</span>
          <Link
            to="/routines/$routineId"
            params={{ routineId }}
            className="text-primary hover:underline"
          >
            {t("detail.backToRoutine", "Back to routine")}
          </Link>
        </div>
      </div>
    );
  }

  // `routine` is defined below this line — the early-return guards it.
  const creationChannelOverride = isCreation
    ? (routine.creationChannelId ?? null)
    : null;

  return (
    <div className="flex h-full">
      <RoutinesSidebar
        selectedRoutineId={routineId}
        selectedExecutionId={executionId}
      />
      <ChatArea
        routine={routine}
        selectedRun={selectedRunExecution}
        activeExecution={activeExecution}
        isViewingHistory={isViewingHistory}
        onReturnToCurrent={handleReturnToCurrent}
        creationChannelId={creationChannelOverride}
      />
      <RightPanel routineId={routineId} selectedRun={selectedRunExecution} />
    </div>
  );
}
