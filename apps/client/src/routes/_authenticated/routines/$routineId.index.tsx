import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { RoutinesSidebar } from "@/components/routines/RoutinesSidebar";
import {
  RoutineDetailView,
  ROUTINE_DETAIL_TABS,
  type RoutineDetailTabKey,
} from "@/components/routines/RoutineDetailView";
import { routinesApi } from "@/services/api/routines";

interface RoutineDetailSearch {
  tab?: RoutineDetailTabKey;
}

export const Route = createFileRoute("/_authenticated/routines/$routineId/")({
  component: RoutineDetailPage,
  validateSearch: (search: Record<string, unknown>): RoutineDetailSearch => {
    if (
      typeof search.tab === "string" &&
      ROUTINE_DETAIL_TABS.includes(search.tab as RoutineDetailTabKey)
    ) {
      return { tab: search.tab as RoutineDetailTabKey };
    }
    return {};
  },
});

function RoutineDetailPage() {
  const { routineId } = Route.useParams();
  const { tab = "overview" } = Route.useSearch();
  const navigate = useNavigate();
  const { t } = useTranslation("routines");

  const {
    data: routine,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["routine", routineId],
    queryFn: () => routinesApi.getById(routineId),
    refetchInterval: (query) => (query.state.error ? false : 5000),
    retry: 0,
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
          {isError
            ? t(
                "detail.loadError",
                "Couldn't load this routine — please try again.",
              )
            : t("detail.notFound", "Routine not found")}
        </div>
      )}
    </div>
  );
}
