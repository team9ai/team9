import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { RoutinesSidebar } from "@/components/routines/RoutinesSidebar";
import { RoutineDetailView } from "@/components/routines/RoutineDetailView";
import { routinesApi } from "@/services/api/routines";

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
  const { tab = "overview" } = Route.useSearch();
  const navigate = useNavigate();

  const { data: routine, isLoading } = useQuery({
    queryKey: ["routine", routineId],
    queryFn: () => routinesApi.getById(routineId),
    refetchInterval: 5000,
  });

  return (
    <div className="flex h-full">
      <RoutinesSidebar
        selectedRoutineId={routineId}
        selectedExecutionId={null}
      />
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
      ) : routine ? (
        <RoutineDetailView
          routine={routine}
          tab={tab}
          onTabChange={(newTab) =>
            void navigate({
              to: "/routines/$routineId",
              params: { routineId },
              search: { tab: newTab },
              replace: true,
            })
          }
        />
      ) : (
        <div
          data-testid="routine-not-found"
          className="flex-1 flex items-center justify-center text-sm text-muted-foreground"
        >
          Routine not found
        </div>
      )}
    </div>
  );
}
