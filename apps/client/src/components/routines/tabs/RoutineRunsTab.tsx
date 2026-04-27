import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { routinesApi } from "@/services/api/routines";
import { RunListItem } from "../RunListItem";

const PAGE_SIZE = 20;

interface RoutineRunsTabProps {
  routineId: string;
  selectedExecutionId: string | null;
  active: boolean;
}

export function RoutineRunsTab({
  routineId,
  selectedExecutionId,
  active,
}: RoutineRunsTabProps) {
  const { t } = useTranslation("routines");
  const navigate = useNavigate();
  // State resets on tab switch — Radix unmounts inactive TabsContent. Intentional: keeps memory bounded; user re-opens at first 20.
  const [visible, setVisible] = useState(PAGE_SIZE);

  const { data: executions = [] } = useQuery({
    queryKey: ["routine-executions", routineId],
    queryFn: () => routinesApi.getExecutions(routineId),
    refetchInterval: active ? 5000 : false,
    enabled: active,
  });

  const visibleExecutions = executions.slice(0, visible);
  const hasMore = executions.length > visible;

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-2 max-w-2xl">
        {executions.length === 0 ? (
          <p className="text-xs text-muted-foreground py-8 text-center">
            {t("historyTab.empty")}
          </p>
        ) : (
          <>
            <div className="space-y-1.5">
              {visibleExecutions.map((exec) => (
                <RunListItem
                  key={exec.id}
                  execution={exec}
                  isSelected={exec.id === selectedExecutionId}
                  onClick={() =>
                    void navigate({
                      to: "/routines/$routineId/runs/$executionId",
                      params: { routineId, executionId: exec.id },
                    })
                  }
                />
              ))}
            </div>
            {hasMore && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setVisible((v) => v + PAGE_SIZE)}
                className="w-full"
              >
                {t("detail.showMore", { count: PAGE_SIZE })}
              </Button>
            )}
          </>
        )}
      </div>
    </ScrollArea>
  );
}
