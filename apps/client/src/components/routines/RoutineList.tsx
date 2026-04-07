import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { Loader2, ListChecks, Plus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "@/services/api";
import { routinesApi } from "@/services/api/routines";
import { useSelectedWorkspaceId } from "@/stores/useWorkspaceStore";
import { RoutineCard } from "./RoutineCard";
import { ChatArea } from "./ChatArea";
import { RightPanel } from "./RightPanel";
import { CreateRoutineDialog } from "./CreateRoutineDialog";
import { RoutineSettingsDialog } from "./RoutineSettingsDialog";
import type { Routine, RoutineStatus } from "@/types/routine";

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

interface RoutineListProps {
  botId?: string;
}

export function RoutineList({ botId }: RoutineListProps) {
  const { t } = useTranslation("routines");
  const workspaceId = useSelectedWorkspaceId();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  // activeRoutineId tracks which routine owns the selected run
  // (set alongside selectedRunId to avoid needing cross-routine execution lookups)
  const [activeRoutineId, setActiveRoutineId] = useState<string | null>(null);
  const [expandedRoutineIds, setExpandedRoutineIds] = useState<Set<string>>(
    new Set(),
  );
  const [showSettingsRoutineId, setShowSettingsRoutineId] = useState<
    string | null
  >(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [tab, setTab] = useState<TabKey>("all");

  // Fetch all tasks
  const { data: allRoutines = [], isLoading } = useQuery({
    queryKey: ["routines", { botId }],
    queryFn: () => routinesApi.list({ botId }),
  });

  // Build botId → displayName lookup from installed apps
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

  // Filter tasks by selected tab
  const filteredRoutines = useMemo(() => {
    if (tab === "all") return allRoutines;
    const statuses = STATUS_FILTERS[tab];
    return allRoutines.filter((routine) => statuses.includes(routine.status));
  }, [allRoutines, tab]);

  // Fetch selected routine detail (for chat area + right panel)
  const { data: selectedRoutine } = useQuery({
    queryKey: ["routine", activeRoutineId],
    queryFn: () => routinesApi.getById(activeRoutineId!),
    enabled: !!activeRoutineId,
    refetchInterval: (query) =>
      query.state.data?.currentExecution?.execution.taskcastTaskId
        ? 30000
        : 5000,
  });

  // Derive active execution
  const activeExecution = selectedRoutine?.currentExecution?.execution ?? null;

  // Fetch executions for the active routine (for selectedRun lookup)
  const { data: activeRoutineExecutions = [] } = useQuery({
    queryKey: ["routine-executions", activeRoutineId],
    queryFn: () => routinesApi.getExecutions(activeRoutineId!),
    enabled: !!activeRoutineId,
    refetchInterval: 5000,
  });

  const selectedRun = useMemo(() => {
    if (!selectedRunId) return null;
    if (activeExecution?.id === selectedRunId) return activeExecution;
    return activeRoutineExecutions.find((e) => e.id === selectedRunId) ?? null;
  }, [selectedRunId, activeExecution, activeRoutineExecutions]);

  const isViewingHistory =
    !!selectedRun && !!activeExecution && selectedRunId !== activeExecution.id;

  // Handle expanding a routine
  const handleToggleExpand = useCallback(
    (routineId: string) => {
      setExpandedRoutineIds((prev) => {
        const next = new Set(prev);
        if (next.has(routineId)) {
          next.delete(routineId);
          // If collapsing the routine that owns the selected run, deselect
          if (activeRoutineId === routineId) {
            setSelectedRunId(null);
            setActiveRoutineId(null);
          }
        } else {
          next.add(routineId);
          // Set activeRoutineId immediately so the center panel renders
          // (tasks with no runs still need to show the Start button)
          setActiveRoutineId(routineId);
          setSelectedRunId(null);
          // Auto-select run will happen via ExpandableRoutineCard's useEffect
        }
        return next;
      });
    },
    [activeRoutineId],
  );

  // Handle run selection — stable ref to avoid re-triggering effects
  const handleSelectRun = useCallback((routineId: string, runId: string) => {
    setSelectedRunId(runId);
    setActiveRoutineId(routineId);
  }, []);

  const handleReturnToCurrent = useCallback(() => {
    if (activeExecution) {
      setSelectedRunId(activeExecution.id);
    } else if (activeRoutineExecutions.length > 0) {
      setSelectedRunId(activeRoutineExecutions[0].id);
    }
  }, [activeExecution, activeRoutineExecutions]);

  const handleSettingsDeleted = useCallback(() => {
    const deletedRoutineId = showSettingsRoutineId;
    setShowSettingsRoutineId(null);
    // If the deleted routine was the active one, clear selection
    if (activeRoutineId === deletedRoutineId) {
      setSelectedRunId(null);
      setActiveRoutineId(null);
    }
  }, [activeRoutineId, showSettingsRoutineId]);

  // Fetch routine detail for settings dialog (needs RoutineDetail)
  const { data: settingsRoutineDetail } = useQuery({
    queryKey: ["routine", showSettingsRoutineId],
    queryFn: () => routinesApi.getById(showSettingsRoutineId!),
    enabled: !!showSettingsRoutineId,
  });

  return (
    <div className="flex h-full">
      {/* Left column: routine list */}
      <div className="flex flex-col w-70 shrink-0 min-w-0 h-full border-r border-border">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <span className="text-sm font-semibold">{t("title", "Tasks")}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setShowCreateDialog(true)}
          >
            <Plus size={16} />
          </Button>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Empty */}
        {!isLoading && allRoutines.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 gap-2">
            <ListChecks size={24} className="text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">{t("noRoutines")}</p>
          </div>
        )}

        {/* Task list */}
        {!isLoading && allRoutines.length > 0 && (
          <>
            {/* Filter tabs */}
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

            {/* Task cards */}
            <div className="flex-1 overflow-y-auto">
              {filteredRoutines.length === 0 ? (
                <div className="flex items-center justify-center py-8">
                  <p className="text-xs text-muted-foreground">
                    {t("noRoutines")}
                  </p>
                </div>
              ) : (
                <div className="px-2 py-1 space-y-1">
                  {filteredRoutines.map((routine) => (
                    <ExpandableRoutineCard
                      key={routine.id}
                      routine={routine}
                      isExpanded={expandedRoutineIds.has(routine.id)}
                      isActive={activeRoutineId === routine.id}
                      selectedRunId={selectedRunId}
                      botNameMap={botNameMap}
                      onToggleExpand={() => handleToggleExpand(routine.id)}
                      onSelectRun={handleSelectRun}
                      onOpenSettings={() =>
                        setShowSettingsRoutineId(routine.id)
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Center + Right: shown when a run is selected */}
      {activeRoutineId && selectedRoutine && (
        <>
          <ChatArea
            routine={selectedRoutine}
            selectedRun={selectedRun}
            activeExecution={activeExecution}
            isViewingHistory={isViewingHistory}
            onReturnToCurrent={handleReturnToCurrent}
          />
          <RightPanel routineId={activeRoutineId} selectedRun={selectedRun} />
        </>
      )}

      <CreateRoutineDialog
        isOpen={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
      />

      <RoutineSettingsDialog
        routine={settingsRoutineDetail ?? null}
        open={!!showSettingsRoutineId}
        onClose={() => setShowSettingsRoutineId(null)}
        onDeleted={handleSettingsDeleted}
      />
    </div>
  );
}

// --- Inner component: fetches executions for each expanded routine ---

interface ExpandableRoutineCardProps {
  routine: Routine;
  isExpanded: boolean;
  isActive: boolean;
  selectedRunId: string | null;
  botNameMap: Map<string, string>;
  onToggleExpand: () => void;
  onSelectRun: (routineId: string, runId: string) => void;
  onOpenSettings: () => void;
}

function ExpandableRoutineCard({
  routine,
  isExpanded,
  isActive,
  selectedRunId,
  botNameMap,
  onToggleExpand,
  onSelectRun,
  onOpenSettings,
}: ExpandableRoutineCardProps) {
  // Fetch executions only when expanded
  const { data: executions = [] } = useQuery({
    queryKey: ["routine-executions", routine.id],
    queryFn: () => routinesApi.getExecutions(routine.id),
    enabled: isExpanded,
    // Poll only for the active (selected) routine
    refetchInterval: isActive ? 5000 : false,
  });

  // Auto-select run when first expanded — use ref to keep onSelectRun stable
  const onSelectRunRef = useRef(onSelectRun);
  onSelectRunRef.current = onSelectRun;
  const [hasAutoSelected, setHasAutoSelected] = useState(false);

  useEffect(() => {
    if (isExpanded && !hasAutoSelected && executions.length > 0) {
      // Find active run or pick most recent
      const activeRun = executions.find((e) =>
        ACTIVE_STATUSES.includes(e.status),
      );
      onSelectRunRef.current(routine.id, activeRun?.id ?? executions[0].id);
      setHasAutoSelected(true);
    }
    if (!isExpanded) {
      setHasAutoSelected(false);
    }
  }, [isExpanded, executions, hasAutoSelected, routine.id]);

  // Stable callback for TaskCard — wraps routineId into onSelectRun
  const handleSelectRun = useCallback(
    (runId: string) => onSelectRun(routine.id, runId),
    [onSelectRun, routine.id],
  );

  return (
    <RoutineCard
      routine={routine}
      isExpanded={isExpanded}
      isActive={isActive}
      selectedRunId={selectedRunId}
      executions={executions}
      botName={routine.botId ? botNameMap.get(routine.botId) : null}
      onToggleExpand={onToggleExpand}
      onSelectRun={handleSelectRun}
      onOpenSettings={onOpenSettings}
    />
  );
}
