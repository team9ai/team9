import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { Loader2, ListChecks, Sparkles, Plus } from "lucide-react";
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
import { AgenticAgentPicker } from "./AgenticAgentPicker";
import { DraftRoutineCard } from "./DraftRoutineCard";
import type { Routine, RoutineStatus } from "@/types/routine";

const STATUS_FILTERS: Record<string, RoutineStatus[]> = {
  active: ["in_progress", "paused", "pending_action"],
  upcoming: ["upcoming"],
  finished: ["completed", "failed", "stopped", "timeout"],
};

const TAB_KEYS = ["all", "active", "upcoming", "finished"] as const;
type TabKey = (typeof TAB_KEYS)[number];

export type SelectedRun =
  | { kind: "execution"; routineId: string; executionId: string }
  | { kind: "creation"; routineId: string }
  | null;

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
  const [selectedRun, setSelectedRun] = useState<SelectedRun>(null);
  // activeRoutineId tracks which routine owns the selected run
  // (set alongside selectedRun to avoid needing cross-routine execution lookups)
  const [activeRoutineId, setActiveRoutineId] = useState<string | null>(null);
  const [expandedRoutineIds, setExpandedRoutineIds] = useState<Set<string>>(
    new Set(),
  );
  const [showSettingsRoutineId, setShowSettingsRoutineId] = useState<
    string | null
  >(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [agenticPickerOpen, setAgenticPickerOpen] = useState(false);
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

  // Separate draft routines (always shown at top, not affected by tab filter)
  const draftRoutines = useMemo(
    () => allRoutines.filter((r) => r.status === "draft"),
    [allRoutines],
  );

  // Non-draft routines for tab filtering
  const nonDraftRoutines = useMemo(
    () => allRoutines.filter((r) => r.status !== "draft"),
    [allRoutines],
  );

  // Filter tasks by selected tab (excluding drafts)
  const filteredRoutines = useMemo(() => {
    if (tab === "all") return nonDraftRoutines;
    const statuses = STATUS_FILTERS[tab];
    return nonDraftRoutines.filter((routine) =>
      statuses.includes(routine.status),
    );
  }, [nonDraftRoutines, tab]);

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

  const selectedRunExecution = useMemo(() => {
    if (!selectedRun || selectedRun.kind !== "execution") return null;
    if (activeExecution?.id === selectedRun.executionId) return activeExecution;
    return (
      activeRoutineExecutions.find((e) => e.id === selectedRun.executionId) ??
      null
    );
  }, [selectedRun, activeExecution, activeRoutineExecutions]);

  // isCreationMode requires BOTH the local selection AND the fetched
  // routine still being a draft. Without the status guard, ChatArea stays
  // stuck on the archived creation channel after completeCreation flips
  // the routine to upcoming.
  const isCreationMode =
    selectedRun?.kind === "creation" && selectedRoutine?.status === "draft";

  const creationChannelOverride =
    isCreationMode && selectedRoutine
      ? (selectedRoutine.creationChannelId ?? null)
      : null;

  // When the draft leaves 'draft' (completeCreation or other transition)
  // while we're still viewing its creation run, clear the creation
  // selection so ChatArea shows the normal upcoming/start UI.
  useEffect(() => {
    if (
      selectedRun?.kind === "creation" &&
      selectedRoutine &&
      selectedRoutine.status !== "draft"
    ) {
      setSelectedRun(null);
    }
  }, [selectedRun, selectedRoutine]);

  const isViewingHistory =
    !!selectedRunExecution &&
    !!activeExecution &&
    selectedRunExecution.id !== activeExecution.id;

  // Handle expanding a routine
  const handleToggleExpand = useCallback(
    (routineId: string) => {
      setExpandedRoutineIds((prev) => {
        const next = new Set(prev);
        if (next.has(routineId)) {
          next.delete(routineId);
          // If collapsing the routine that owns the selected run, deselect
          if (activeRoutineId === routineId) {
            setSelectedRun(null);
            setActiveRoutineId(null);
          }
        } else {
          next.add(routineId);
          // Set activeRoutineId immediately so the center panel renders
          // (tasks with no runs still need to show the Start button)
          setActiveRoutineId(routineId);
          setSelectedRun(null);
          // Auto-select run will happen via ExpandableRoutineCard's useEffect
        }
        return next;
      });
    },
    [activeRoutineId],
  );

  // Handle run selection — stable ref to avoid re-triggering effects
  const handleSelectRun = useCallback(
    (routineId: string, executionId: string) => {
      setSelectedRun({ kind: "execution", routineId, executionId });
      setActiveRoutineId(routineId);
    },
    [],
  );

  const handleOpenCreationSession = useCallback((routineId: string) => {
    setExpandedRoutineIds((prev) => {
      const next = new Set(prev);
      next.add(routineId);
      return next;
    });
    setActiveRoutineId(routineId);
    setSelectedRun({ kind: "creation", routineId });
  }, []);

  const handleReturnToCurrent = useCallback(() => {
    if (!activeRoutineId) return;
    if (activeExecution) {
      setSelectedRun({
        kind: "execution",
        routineId: activeRoutineId,
        executionId: activeExecution.id,
      });
    } else if (activeRoutineExecutions.length > 0) {
      setSelectedRun({
        kind: "execution",
        routineId: activeRoutineId,
        executionId: activeRoutineExecutions[0].id,
      });
    }
  }, [activeExecution, activeRoutineExecutions, activeRoutineId]);

  const handleSettingsDeleted = useCallback(() => {
    const deletedRoutineId = showSettingsRoutineId;
    setShowSettingsRoutineId(null);
    // If the deleted routine was the active one, clear selection
    if (activeRoutineId === deletedRoutineId) {
      setSelectedRun(null);
      setActiveRoutineId(null);
    }
  }, [activeRoutineId, showSettingsRoutineId]);

  // Shared handler for any draft deletion path (draft card delete button,
  // future batch delete, etc.). Clears active selection if the deleted
  // routine was currently open so the center pane stops rendering it.
  const handleDraftDeleted = useCallback(
    (deletedRoutineId: string) => {
      setExpandedRoutineIds((prev) => {
        if (!prev.has(deletedRoutineId)) return prev;
        const next = new Set(prev);
        next.delete(deletedRoutineId);
        return next;
      });
      if (activeRoutineId === deletedRoutineId) {
        setSelectedRun(null);
        setActiveRoutineId(null);
      }
    },
    [activeRoutineId],
  );

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
            onClick={() => setAgenticPickerOpen(true)}
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
          <div className="flex flex-col items-center justify-center py-8 gap-2 px-4">
            <ListChecks size={24} className="text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">{t("noRoutines")}</p>
            <p className="text-[11px] text-muted-foreground/70 text-center leading-relaxed">
              {t("create.description")}
            </p>
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
              <div className="px-2 py-1 space-y-1">
                {/* Draft group — always shown at top */}
                {draftRoutines.length > 0 && (
                  <>
                    <p className="px-0.5 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("draft.badge")}
                    </p>
                    {draftRoutines.map((routine) => (
                      <DraftRoutineCard
                        key={routine.id}
                        routine={routine}
                        onOpenCreationSession={handleOpenCreationSession}
                        onDeleted={handleDraftDeleted}
                      />
                    ))}
                    {filteredRoutines.length > 0 && (
                      <div className="border-t border-border my-1" />
                    )}
                  </>
                )}

                {/* Non-draft routines */}
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
                      isActive={activeRoutineId === routine.id}
                      selectedRun={selectedRun}
                      botNameMap={botNameMap}
                      onToggleExpand={() => handleToggleExpand(routine.id)}
                      onSelectRun={handleSelectRun}
                      onOpenCreationSession={handleOpenCreationSession}
                      onOpenSettings={() =>
                        setShowSettingsRoutineId(routine.id)
                      }
                    />
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Center + Right: shown when a run is selected */}
      {activeRoutineId && selectedRoutine ? (
        <>
          <ChatArea
            routine={selectedRoutine}
            selectedRun={selectedRunExecution}
            activeExecution={activeExecution}
            isViewingHistory={isViewingHistory}
            onReturnToCurrent={handleReturnToCurrent}
            creationChannelId={creationChannelOverride}
          />
          <RightPanel
            routineId={activeRoutineId}
            selectedRun={selectedRunExecution}
          />
        </>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 text-center">
          <ListChecks size={40} className="text-muted-foreground/30" />
          <div className="space-y-2 max-w-sm">
            <h3 className="text-base font-medium text-foreground">
              {t("emptyState.title")}
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
              {t("emptyState.description")}
            </p>
          </div>
          <Button
            size="sm"
            className="mt-2"
            onClick={() => setAgenticPickerOpen(true)}
          >
            <Sparkles size={14} className="mr-1.5" />
            {t("emptyState.createWithAI")}
          </Button>
        </div>
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

      <AgenticAgentPicker
        open={agenticPickerOpen}
        onClose={() => setAgenticPickerOpen(false)}
        onManualCreate={() => {
          setAgenticPickerOpen(false);
          setShowCreateDialog(true);
        }}
        onOpenCreationSession={handleOpenCreationSession}
      />
    </div>
  );
}

// --- Inner component: fetches executions for each expanded routine ---

interface ExpandableRoutineCardProps {
  routine: Routine;
  isExpanded: boolean;
  isActive: boolean;
  selectedRun: SelectedRun;
  botNameMap: Map<string, string>;
  onToggleExpand: () => void;
  onSelectRun: (routineId: string, runId: string) => void;
  onOpenCreationSession: (routineId: string) => void;
  onOpenSettings: () => void;
}

function ExpandableRoutineCard({
  routine,
  isExpanded,
  isActive,
  selectedRun,
  botNameMap,
  onToggleExpand,
  onSelectRun,
  onOpenCreationSession,
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
      selectedRun={selectedRun}
      executions={executions}
      botName={routine.botId ? botNameMap.get(routine.botId) : null}
      onToggleExpand={onToggleExpand}
      onSelectRun={handleSelectRun}
      onOpenCreationSession={onOpenCreationSession}
      onOpenSettings={onOpenSettings}
    />
  );
}
