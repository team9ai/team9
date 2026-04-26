import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { routinesApi } from "@/services/api/routines";
import { RoutineTriggersTab } from "./RoutineTriggersTab";
import { RoutineDocumentTab } from "./RoutineDocumentTab";
import { RoutineOverviewTab } from "./tabs/RoutineOverviewTab";
import { RoutineRunsTab } from "./tabs/RoutineRunsTab";
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

const DELETABLE_STATUSES: RoutineStatus[] = [
  "upcoming",
  "completed",
  "failed",
  "stopped",
  "timeout",
];

export const ROUTINE_DETAIL_TABS = [
  "overview",
  "triggers",
  "documents",
  "runs",
] as const;
export type RoutineDetailTabKey = (typeof ROUTINE_DETAIL_TABS)[number];

interface RoutineDetailViewProps {
  routine: RoutineDetail;
  tab: RoutineDetailTabKey;
  onTabChange: (tab: RoutineDetailTabKey) => void;
}

export function RoutineDetailView({
  routine,
  tab,
  onTabChange,
}: RoutineDetailViewProps) {
  const { t } = useTranslation("routines");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: () => routinesApi.delete(routine.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["routines"] });
      void navigate({ to: "/routines" });
    },
  });

  const canDelete = DELETABLE_STATUSES.includes(routine.status);

  return (
    <div className="flex-1 flex flex-col h-full min-w-0">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
        <span
          className={cn(
            "inline-block w-2 h-2 rounded-full shrink-0",
            STATUS_COLORS[routine.status],
          )}
          aria-label={t(`status.${routine.status}`)}
        />
        <h1 className="text-base font-semibold truncate">{routine.title}</h1>
        <div className="ml-auto">
          {canDelete && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("detail.more", "More")}
                >
                  <MoreHorizontal size={16} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 size={14} className="mr-2" />
                  {t("detail.delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </header>

      <Tabs
        value={tab}
        onValueChange={(v) => onTabChange(v as RoutineDetailTabKey)}
        className="flex-1 flex flex-col min-h-0"
      >
        <TabsList className="px-4 shrink-0">
          <TabsTrigger value="overview">
            {t("detail.tabs.overview", "Overview")}
          </TabsTrigger>
          <TabsTrigger value="triggers">
            {t("detail.tabs.triggers", "Triggers")}
          </TabsTrigger>
          <TabsTrigger value="documents">
            {t("detail.tabs.documents", "Documents")}
          </TabsTrigger>
          <TabsTrigger value="runs">
            {t("detail.tabs.runs", "Runs")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="flex-1 min-h-0 mt-0">
          <RoutineOverviewTab routine={routine} onSwitchTab={onTabChange} />
        </TabsContent>
        <TabsContent value="triggers" className="flex-1 min-h-0 mt-0">
          <ScrollArea className="h-full">
            <div className="p-4">
              <RoutineTriggersTab routineId={routine.id} />
            </div>
          </ScrollArea>
        </TabsContent>
        <TabsContent value="documents" className="flex-1 min-h-0 mt-0">
          <ScrollArea className="h-full">
            <div className="p-4">
              <RoutineDocumentTab routine={routine} />
            </div>
          </ScrollArea>
        </TabsContent>
        <TabsContent value="runs" className="flex-1 min-h-0 mt-0">
          <RoutineRunsTab
            routineId={routine.id}
            selectedExecutionId={null}
            active={tab === "runs"}
          />
        </TabsContent>
      </Tabs>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settingsTab.deleteTitle", "Delete this routine?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settingsTab.deleteConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("detail.cancel", "Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("detail.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
