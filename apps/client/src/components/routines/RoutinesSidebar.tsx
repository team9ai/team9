import { useMemo, useState, useCallback, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Loader2, ListChecks, Plus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "@/services/api";
import { routinesApi } from "@/services/api/routines";
import { useSelectedWorkspaceId } from "@/stores/useWorkspaceStore";
import { RoutineCard } from "./RoutineCard";
import { CreateRoutineDialog } from "./CreateRoutineDialog";
import { RoutineSettingsDialog } from "./RoutineSettingsDialog";
import { AgenticAgentPicker } from "./AgenticAgentPicker";
import { DraftRoutineCard } from "./DraftRoutineCard";
import type { Routine, RoutineStatus, RoutineExecution } from "@/types/routine";

export type SelectedRun =
  | { kind: "execution"; routineId: string; executionId: string }
  | { kind: "creation"; routineId: string }
  | null;

const STATUS_FILTERS: Record<string, RoutineStatus[]> = {
  active: ["in_progress", "paused", "pending_action"],
  upcoming: ["upcoming"],
  finished: ["completed", "failed", "stopped", "timeout"],
};

const TAB_KEYS = ["all", "active", "upcoming", "finished"] as const;
type TabKey = (typeof TAB_KEYS)[number];

const ACTIVE_STATUSES: RoutineStatus[] = [
  "in_progress",
  "pending_action",
  "paused",
];

interface RoutinesSidebarProps {
  selectedRoutineId: string | null;
  selectedExecutionId: string | null; // can be a UUID or "creation"
  /**
   * Optional callback fired when the header `+` button is clicked. When
   * provided, the sidebar delegates the open-create-flow UI to the parent
   * (parent owns the picker / create-dialog mounts) — single source of truth.
   * When omitted, the sidebar falls back to mounting its own picker and
   * create dialog and toggling them via internal state.
   */
  onRequestCreate?: () => void;
}

export function RoutinesSidebar({
  selectedRoutineId,
  selectedExecutionId,
  onRequestCreate,
}: RoutinesSidebarProps) {
  const { t } = useTranslation("routines");
  const navigate = useNavigate();
  const workspaceId = useSelectedWorkspaceId();
  const [tab, setTab] = useState<TabKey>("all");
  const [expandedRoutineIds, setExpandedRoutineIds] = useState<Set<string>>(
    new Set(),
  );
  const [showSettingsRoutineId, setShowSettingsRoutineId] = useState<
    string | null
  >(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [agenticPickerOpen, setAgenticPickerOpen] = useState(false);

  // Auto-expand the URL-selected routine. NOTE: until Task 6 splits the
  // chevron click from the body click, the URL-active routine cannot be
  // manually collapsed via header click — auto-expansion re-fires every
  // render. Task 6 introduces an explicit chevron button.
  useEffect(() => {
    if (!selectedRoutineId) return;
    setExpandedRoutineIds((prev) => {
      if (prev.has(selectedRoutineId)) return prev;
      const next = new Set(prev);
      next.add(selectedRoutineId);
      return next;
    });
  }, [selectedRoutineId]);

  const { data: allRoutines = [], isLoading } = useQuery({
    queryKey: ["routines"],
    queryFn: () => routinesApi.list(),
  });

  const { data: botNameMap = new Map<string, string>() } = useQuery({
    queryKey: ["installed-applications-with-bots", workspaceId, "bot-names"],
    queryFn: async () => {
      const apps = await api.applications.getInstalledApplicationsWithBots();
      const map = new Map<string, string>();
      for (const app of apps) {
        for (const bot of app.bots) {
          if (bot.displayName) map.set(bot.botId, bot.displayName);
        }
      }
      return map;
    },
    enabled: allRoutines.length > 0 && !!workspaceId,
    staleTime: 60_000,
  });

  const draftRoutines = useMemo(
    () => allRoutines.filter((r) => r.status === "draft"),
    [allRoutines],
  );
  const nonDraftRoutines = useMemo(
    () => allRoutines.filter((r) => r.status !== "draft"),
    [allRoutines],
  );
  const filteredRoutines = useMemo(() => {
    if (tab === "all") return nonDraftRoutines;
    const statuses = STATUS_FILTERS[tab];
    return nonDraftRoutines.filter((r) => statuses.includes(r.status));
  }, [nonDraftRoutines, tab]);

  // Settings dialog still uses the old query pattern (removed in Task 7).
  const { data: settingsRoutineDetail } = useQuery({
    queryKey: ["routine", showSettingsRoutineId],
    queryFn: () => routinesApi.getById(showSettingsRoutineId!),
    enabled: !!showSettingsRoutineId,
  });

  const handleToggleExpand = useCallback((routineId: string) => {
    setExpandedRoutineIds((prev) => {
      const next = new Set(prev);
      if (next.has(routineId)) next.delete(routineId);
      else next.add(routineId);
      return next;
    });
  }, []);

  const handleOpenRoutine = useCallback(
    (routine: Routine, executions: RoutineExecution[]) => {
      if (routine.status === "draft" && routine.creationChannelId) {
        void navigate({
          to: "/routines/$routineId/runs/$executionId",
          params: { routineId: routine.id, executionId: "creation" },
        });
        return;
      }
      const active = executions.find((e) => ACTIVE_STATUSES.includes(e.status));
      const target = active ?? executions[0];
      if (target) {
        void navigate({
          to: "/routines/$routineId/runs/$executionId",
          params: { routineId: routine.id, executionId: target.id },
        });
      }
    },
    [navigate],
  );

  const handleSelectRun = useCallback(
    (routineId: string, executionId: string) => {
      void navigate({
        to: "/routines/$routineId/runs/$executionId",
        params: { routineId, executionId },
      });
    },
    [navigate],
  );

  const handleSettingsDeleted = useCallback(() => {
    const deletedRoutineId = showSettingsRoutineId;
    setShowSettingsRoutineId(null);
    if (selectedRoutineId === deletedRoutineId) {
      void navigate({ to: "/routines" });
    }
  }, [navigate, selectedRoutineId, showSettingsRoutineId]);

  const handleDraftDeleted = useCallback(
    (deletedRoutineId: string) => {
      setExpandedRoutineIds((prev) => {
        if (!prev.has(deletedRoutineId)) return prev;
        const next = new Set(prev);
        next.delete(deletedRoutineId);
        return next;
      });
      if (selectedRoutineId === deletedRoutineId) {
        void navigate({ to: "/routines" });
      }
    },
    [navigate, selectedRoutineId],
  );

  return (
    <div className="flex flex-col w-70 shrink-0 min-w-0 h-full border-r border-border">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-sm font-semibold">{t("title", "Tasks")}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => {
            if (onRequestCreate) onRequestCreate();
            else setAgenticPickerOpen(true);
          }}
        >
          <Plus size={16} />
        </Button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
      )}

      {!isLoading && allRoutines.length === 0 && (
        <div className="flex flex-col items-center justify-center py-8 gap-2 px-4">
          <ListChecks size={24} className="text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">{t("noRoutines")}</p>
          <p className="text-[11px] text-muted-foreground/70 text-center leading-relaxed">
            {t("create.description")}
          </p>
        </div>
      )}

      {!isLoading && allRoutines.length > 0 && (
        <>
          <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border">
            {TAB_KEYS.map((key) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={cn(
                  "px-2 py-0.5 text-[11px] rounded-md transition-colors",
                  tab === key
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
                )}
              >
                {t(`tabs.${key}`, key)}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="px-2 py-1 space-y-1">
              {draftRoutines.length > 0 && (
                <>
                  <p className="px-0.5 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("draft.badge")}
                  </p>
                  {draftRoutines.map((routine) => (
                    <DraftRoutineCard
                      key={routine.id}
                      routine={routine}
                      selectedRun={
                        selectedRoutineId === routine.id &&
                        selectedExecutionId === "creation"
                          ? { kind: "creation", routineId: routine.id }
                          : null
                      }
                      onOpenCreationSession={(id) =>
                        handleOpenRoutine(
                          allRoutines.find((r) => r.id === id)!,
                          [],
                        )
                      }
                      onDeleted={handleDraftDeleted}
                    />
                  ))}
                  {filteredRoutines.length > 0 && (
                    <div className="border-t border-border my-1" />
                  )}
                </>
              )}

              {filteredRoutines.length === 0 && draftRoutines.length === 0 ? (
                <div className="flex items-center justify-center py-8">
                  <p className="text-xs text-muted-foreground">
                    {t("noRoutines")}
                  </p>
                </div>
              ) : filteredRoutines.length === 0 ? null : (
                filteredRoutines.map((routine) => (
                  <ExpandableRoutineCard
                    key={routine.id}
                    routine={routine}
                    isExpanded={expandedRoutineIds.has(routine.id)}
                    isActive={selectedRoutineId === routine.id}
                    selectedExecutionId={
                      selectedRoutineId === routine.id
                        ? selectedExecutionId
                        : null
                    }
                    botNameMap={botNameMap}
                    onToggleExpand={() => handleToggleExpand(routine.id)}
                    onOpenRoutine={handleOpenRoutine}
                    onSelectRun={handleSelectRun}
                    onOpenSettings={() =>
                      void navigate({
                        to: "/routines/$routineId",
                        params: { routineId: routine.id },
                        search: { tab: "overview" },
                      })
                    }
                  />
                ))
              )}
            </div>
          </div>
        </>
      )}

      <RoutineSettingsDialog
        routine={settingsRoutineDetail ?? null}
        open={!!showSettingsRoutineId}
        onClose={() => setShowSettingsRoutineId(null)}
        onDeleted={handleSettingsDeleted}
      />

      {/*
       * Picker / create-dialog are mounted by the sidebar ONLY when the
       * parent has not opted into owning them. The index route owns these
       * to share state with its empty-state CTA (single source of truth).
       */}
      {!onRequestCreate && (
        <>
          <CreateRoutineDialog
            isOpen={showCreateDialog}
            onClose={() => setShowCreateDialog(false)}
          />
          <AgenticAgentPicker
            open={agenticPickerOpen}
            onClose={() => setAgenticPickerOpen(false)}
            onManualCreate={() => {
              setAgenticPickerOpen(false);
              setShowCreateDialog(true);
            }}
            onOpenCreationSession={(id) =>
              handleOpenRoutine(allRoutines.find((r) => r.id === id)!, [])
            }
          />
        </>
      )}
    </div>
  );
}

interface ExpandableRoutineCardProps {
  routine: Routine;
  isExpanded: boolean;
  isActive: boolean;
  selectedExecutionId: string | null;
  botNameMap: Map<string, string>;
  onToggleExpand: () => void;
  onOpenRoutine: (routine: Routine, executions: RoutineExecution[]) => void;
  onSelectRun: (routineId: string, executionId: string) => void;
  onOpenSettings: () => void;
}

function ExpandableRoutineCard({
  routine,
  isExpanded,
  isActive,
  selectedExecutionId,
  botNameMap,
  onToggleExpand,
  onOpenRoutine,
  onSelectRun,
  onOpenSettings,
}: ExpandableRoutineCardProps) {
  const { data: executions = [] } = useQuery({
    queryKey: ["routine-executions", routine.id],
    queryFn: () => routinesApi.getExecutions(routine.id),
    enabled: isExpanded,
    refetchInterval: isActive ? 5000 : false,
  });

  const selectedRun: SelectedRun =
    isActive && selectedExecutionId
      ? selectedExecutionId === "creation"
        ? { kind: "creation", routineId: routine.id }
        : {
            kind: "execution",
            routineId: routine.id,
            executionId: selectedExecutionId,
          }
      : null;

  return (
    <RoutineCard
      routine={routine}
      isExpanded={isExpanded}
      isActive={isActive}
      selectedRun={selectedRun}
      executions={executions}
      botName={routine.botId ? botNameMap.get(routine.botId) : null}
      onToggleExpand={onToggleExpand}
      onOpenRoutine={() => onOpenRoutine(routine, executions)}
      onSelectRun={(execId) => onSelectRun(routine.id, execId)}
      onOpenCreationSession={() => onOpenRoutine(routine, executions)}
      onOpenSettings={onOpenSettings}
    />
  );
}
