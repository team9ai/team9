import { createFileRoute } from "@tanstack/react-router";
import { RoutinesSidebar } from "@/components/routines/RoutinesSidebar";

interface RoutineDetailSearch {
  tab?: "overview" | "triggers" | "documents" | "runs";
}

export const Route = createFileRoute("/_authenticated/routines/$routineId")({
  component: RoutineDetailPage,
  validateSearch: (search: Record<string, unknown>): RoutineDetailSearch => {
    const tab = search.tab;
    if (
      tab === "overview" ||
      tab === "triggers" ||
      tab === "documents" ||
      tab === "runs"
    ) {
      return { tab };
    }
    return {};
  },
});

function RoutineDetailPage() {
  const { routineId } = Route.useParams();
  return (
    <div className="flex h-full">
      <RoutinesSidebar
        selectedRoutineId={routineId}
        selectedExecutionId={null}
      />
      <div data-testid="routine-detail-placeholder" className="flex-1" />
    </div>
  );
}
