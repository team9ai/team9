# Routine Detail Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tabbed Routine detail page (Overview / Triggers / Documents / Runs) reachable at `/routines/$routineId`, replacing the gear-icon settings modal and redirecting routine clicks away from auto-jumping to the first run.

**Architecture:** Pure frontend refactor. Split the monolithic `RoutineList` into a URL-driven `RoutinesSidebar` and route-owned center/right panes. Add two new TanStack Router file routes: `$routineId.tsx` (sidebar + `RoutineDetailView` with shadcn Tabs) and `$routineId.runs.$executionId.tsx` (sidebar + existing ChatArea + RightPanel). Selection state moves from internal React state to URL params; expansion stays as sidebar-local state but auto-adds the URL-selected routine. The legacy `RoutineSettingsDialog` is deleted; its bot-assignment and delete logic move to the Overview tab and the header `[⋯]` menu respectively.

**Tech Stack:** React 19, TypeScript, TanStack Router (file-based), TanStack React Query, shadcn `<Tabs>`, shadcn `<DropdownMenu>` / `<AlertDialog>`, Vitest + @testing-library/react.

**Reference spec:** `docs/superpowers/specs/2026-04-26-routine-detail-page-design.md`

---

## File Structure

**New files:**

- `apps/client/src/routes/_authenticated/routines/$routineId.tsx` — detail page route, validates `?tab=` search param.
- `apps/client/src/routes/_authenticated/routines/$routineId.runs.$executionId.tsx` — run-view route, treats `executionId === "creation"` as draft sentinel.
- `apps/client/src/components/routines/RoutinesSidebar.tsx` — URL-driven left column extracted from `RoutineList`.
- `apps/client/src/components/routines/RoutineDetailView.tsx` — header + Tabs container.
- `apps/client/src/components/routines/RunListItem.tsx` — richer execution row used in detail page (separate from sidebar `RunItem`).
- `apps/client/src/components/routines/tabs/RoutineOverviewTab.tsx`
- `apps/client/src/components/routines/tabs/RoutineRunsTab.tsx`
- Test files colocated under `__tests__/` for each new component.

**Modified files:**

- `apps/client/src/routes/_authenticated/routines/index.tsx` — render `RoutinesSidebar` + center empty state.
- `apps/client/src/components/routines/RoutineCard.tsx` — drop `showAllRuns` / `DEFAULT_VISIBLE_RUNS`, filter to active runs, split chevron click vs body click.

**Deleted files:**

- `apps/client/src/components/routines/RoutineList.tsx`
- `apps/client/src/components/routines/RoutineSettingsDialog.tsx`
- `apps/client/src/components/routines/RoutineSettingsTab.tsx`

**Module boundaries:** `RoutinesSidebar` knows nothing about the center/right panes — it only navigates. Each route component owns its center/right composition. `RoutineDetailView` owns header + tab routing; each tab component is self-contained and only depends on `RoutineDetail` / `RoutineExecution` props.

---

## Task 1: Routes + URL-driven RoutinesSidebar

**Goal:** Move sidebar selection state from internal React state into TanStack Router URL params. Add the two new routes (`$routineId.tsx`, `$routineId.runs.$executionId.tsx`). Detail route renders a placeholder for now; run route mounts the existing ChatArea + RightPanel. Click behavior preserved — clicking a routine still auto-navigates to first/active run if one exists. Settings ⚙️ still opens modal (changes in Task 2).

**Files:**

- Create: `apps/client/src/components/routines/RoutinesSidebar.tsx` (and re-export `SelectedRun` type)
- Create: `apps/client/src/components/routines/__tests__/RoutinesSidebar.test.tsx`
- Create: `apps/client/src/routes/_authenticated/routines/$routineId.tsx`
- Create: `apps/client/src/routes/_authenticated/routines/$routineId.runs.$executionId.tsx`
- Modify: `apps/client/src/routes/_authenticated/routines/index.tsx`
- Modify: `apps/client/src/components/routines/RoutineCard.tsx` (update `SelectedRun` import path)
- Modify: `apps/client/src/components/routines/DraftRoutineCard.tsx` (update `SelectedRun` import path)
- Delete: `apps/client/src/components/routines/RoutineList.tsx`

**Acceptance Criteria:**

- [ ] Visiting `/routines` renders sidebar + the existing "Tasks" empty-state center pane (no behavior regression).
- [ ] Visiting `/routines/$routineId/runs/$executionId` renders sidebar + ChatArea + RightPanel for that execution; refreshing the page preserves selection.
- [ ] Visiting `/routines/$routineId` renders sidebar + a placeholder div with text `routine-detail-placeholder` (replaced in Task 2).
- [ ] Clicking a non-draft routine card body still expands it and navigates to the active or most recent run URL.
- [ ] Clicking a draft routine navigates to `/routines/$routineId/runs/creation`; the `creation` sentinel renders the existing creation-session ChatArea using `routine.creationChannelId`.
- [ ] No `RoutineList` references remain in the codebase.
- [ ] Existing test suite passes: `pnpm --filter client test --run`.

**Verify:** `pnpm --filter client test --run components/routines` → all sidebar / card tests pass.

**Steps:**

- [ ] **Step 1: Create `RoutinesSidebar` skeleton (extract from `RoutineList.tsx`)**

Move the entire left-column block (header, loading, empty, filter tabs, draft group, expandable cards) from `RoutineList.tsx` into a new file. Replace `useState` for `activeRoutineId` / `selectedRun` with URL-derived values; keep `expandedRoutineIds`, `tab`, `showCreateDialog`, `agenticPickerOpen`, `showSettingsRoutineId` as local state. **Move and re-export the `SelectedRun` type** from this new file (it's currently exported by `RoutineList.tsx` and imported by `RoutineCard` / `DraftRoutineCard`).

```tsx
// apps/client/src/components/routines/RoutinesSidebar.tsx
import { useMemo, useState, useCallback, useEffect } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
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
  botId?: string;
}

export function RoutinesSidebar({
  selectedRoutineId,
  selectedExecutionId,
  botId,
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

  // Auto-expand the URL-selected routine.
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
    queryKey: ["routines", { botId }],
    queryFn: () => routinesApi.list({ botId }),
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
          onClick={() => setAgenticPickerOpen(true)}
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
                    onOpenSettings={() => setShowSettingsRoutineId(routine.id)}
                  />
                ))
              )}
            </div>
          </div>
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

  const selectedRun =
    isActive && selectedExecutionId
      ? selectedExecutionId === "creation"
        ? { kind: "creation" as const, routineId: routine.id }
        : {
            kind: "execution" as const,
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
```

Note: `RoutineCard` will gain a new prop `onOpenRoutine` for "click body" — see Step 3.

- [ ] **Step 2a: Update `SelectedRun` import path in `RoutineCard.tsx` and `DraftRoutineCard.tsx`**

In both files, replace:

```tsx
import type { SelectedRun } from "./RoutineList";
```

with:

```tsx
import type { SelectedRun } from "./RoutinesSidebar";
```

Verify by:

```bash
grep -rn '"./RoutineList"' apps/client/src
```

Expected: empty output.

- [ ] **Step 2: Update `RoutineCard` to expose body-click handler (preserves expand behavior)**

In Task 1 we still want clicking the card body to expand AND navigate to first/active run, matching today's UX. The difference vs. today is the navigation now uses URL instead of internal state.

In `RoutineCard.tsx`, change the props to add `onOpenRoutine` (called in addition to expand toggle on header click). Until Task 6, the click handler runs both:

```tsx
// apps/client/src/components/routines/RoutineCard.tsx — header onClick
const handleHeaderClick = () => {
  onToggleExpand();
  onOpenRoutine();
};
```

Replace the existing `onClick={onToggleExpand}` on the header div (line 122) with `onClick={handleHeaderClick}`. Add `onOpenRoutine: () => void;` to `RoutineCardProps`. Keep all other props/behavior (chevron also calls handleHeaderClick at this stage; split happens in Task 6).

- [ ] **Step 3: Add the index route render path**

```tsx
// apps/client/src/routes/_authenticated/routines/index.tsx
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ListChecks, Sparkles } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RoutinesSidebar } from "@/components/routines/RoutinesSidebar";
import { AgenticAgentPicker } from "@/components/routines/AgenticAgentPicker";
import { CreateRoutineDialog } from "@/components/routines/CreateRoutineDialog";

export const Route = createFileRoute("/_authenticated/routines/")({
  component: RoutinesPage,
});

function RoutinesPage() {
  const { t } = useTranslation("routines");
  const [agenticPickerOpen, setAgenticPickerOpen] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  return (
    <div className="flex h-full">
      <RoutinesSidebar selectedRoutineId={null} selectedExecutionId={null} />
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
        onOpenCreationSession={() => {}}
      />
    </div>
  );
}
```

- [ ] **Step 4: Add the detail-page route (placeholder)**

```tsx
// apps/client/src/routes/_authenticated/routines/$routineId.tsx
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
```

- [ ] **Step 5: Add the run-view route (sidebar + ChatArea + RightPanel)**

```tsx
// apps/client/src/routes/_authenticated/routines/$routineId.runs.$executionId.tsx
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
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

  const { data: routine } = useQuery({
    queryKey: ["routine", routineId],
    queryFn: () => routinesApi.getById(routineId),
    refetchInterval: (query) =>
      query.state.data?.currentExecution?.execution.taskcastTaskId
        ? 30000
        : 5000,
  });

  const { data: executions = [] } = useQuery({
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

  const creationChannelOverride =
    isCreation && routine ? (routine.creationChannelId ?? null) : null;

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
        onReturnToCurrent={() => {}}
        creationChannelId={creationChannelOverride}
      />
      <RightPanel routineId={routineId} selectedRun={selectedRunExecution} />
    </div>
  );
}
```

Note: `onReturnToCurrent` is now a no-op because navigation drives selection — clicking a different run in the sidebar already navigates the URL. If the existing `ChatArea` uses this prop for a "return to current" button, the button can call `navigate({ to: '/routines/$routineId/runs/$executionId', params: { routineId, executionId: activeExecution.id } })` instead — wire that up if `ChatArea` invokes it.

- [ ] **Step 6: Delete `RoutineList.tsx`**

```bash
rm apps/client/src/components/routines/RoutineList.tsx
```

Confirm no remaining imports:

```bash
grep -rn "from.*RoutineList\|/RoutineList" apps/client/src
```

Expected: empty output.

- [ ] **Step 7: Write `RoutinesSidebar` test**

```tsx
// apps/client/src/components/routines/__tests__/RoutinesSidebar.test.tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockNavigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  useParams: () => ({}),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock("@/services/api", () => ({
  api: {
    applications: {
      getInstalledApplicationsWithBots: vi.fn(async () => []),
    },
  },
}));

const mockList = vi.fn();
const mockGetById = vi.fn();
const mockGetExecutions = vi.fn();
vi.mock("@/services/api/routines", () => ({
  routinesApi: {
    list: (...args: unknown[]) => mockList(...args),
    getById: (...args: unknown[]) => mockGetById(...args),
    getExecutions: (...args: unknown[]) => mockGetExecutions(...args),
  },
}));

vi.mock("@/stores/useWorkspaceStore", () => ({
  useSelectedWorkspaceId: () => "ws-1",
}));

import { RoutinesSidebar } from "../RoutinesSidebar";

function renderSidebar(props: {
  selectedRoutineId: string | null;
  selectedExecutionId: string | null;
}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <RoutinesSidebar {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockList.mockResolvedValue([]);
  mockGetExecutions.mockResolvedValue([]);
});

describe("RoutinesSidebar", () => {
  it("renders empty state when no routines", async () => {
    renderSidebar({ selectedRoutineId: null, selectedExecutionId: null });
    await waitFor(() =>
      expect(screen.getByText("noRoutines")).toBeInTheDocument(),
    );
  });

  it("auto-expands the URL-selected routine", async () => {
    mockList.mockResolvedValue([
      {
        id: "r1",
        title: "First",
        status: "in_progress",
        createdAt: new Date().toISOString(),
        botId: null,
        tokenUsage: 0,
        creationChannelId: null,
      },
    ]);
    mockGetExecutions.mockResolvedValue([]);

    renderSidebar({ selectedRoutineId: "r1", selectedExecutionId: null });

    await waitFor(() => {
      expect(mockGetExecutions).toHaveBeenCalledWith("r1");
    });
  });

  it("navigates to /routines/$id/runs/creation for draft click", async () => {
    mockList.mockResolvedValue([
      {
        id: "draft1",
        title: "Draft",
        status: "draft",
        createdAt: new Date().toISOString(),
        botId: null,
        tokenUsage: 0,
        creationChannelId: "ch-creation-1",
      },
    ]);

    renderSidebar({ selectedRoutineId: null, selectedExecutionId: null });

    const draftCard = await screen.findByText("Draft");
    fireEvent.click(draftCard);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/routines/$routineId/runs/$executionId",
        params: { routineId: "draft1", executionId: "creation" },
      });
    });
  });
});
```

- [ ] **Step 8: Run typecheck + tests + commit**

```bash
pnpm --filter client typecheck
pnpm --filter client test --run components/routines
pnpm --filter client test --run routes/_authenticated/routines
```

Expected: all pass. Then:

```bash
git add apps/client/src/components/routines/RoutinesSidebar.tsx \
        apps/client/src/components/routines/__tests__/RoutinesSidebar.test.tsx \
        apps/client/src/components/routines/RoutineCard.tsx \
        apps/client/src/routes/_authenticated/routines/index.tsx \
        apps/client/src/routes/_authenticated/routines/\$routineId.tsx \
        apps/client/src/routes/_authenticated/routines/\$routineId.runs.\$executionId.tsx
git add apps/client/src/components/routines/DraftRoutineCard.tsx
git rm apps/client/src/components/routines/RoutineList.tsx
git commit -m "$(cat <<'EOF'
feat(routines): add detail/run routes and URL-driven sidebar

Replaces RoutineList monolith with URL-driven RoutinesSidebar plus two new
TanStack Router file routes ($routineId.tsx detail placeholder, runs.$executionId.tsx
run view). Sidebar reads selection from URL params; expansion still local
state but auto-adds the URL-selected routine. Click behavior preserved:
clicking a routine still auto-navigates to first/active run URL.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: RoutineDetailView shell + Triggers/Documents tabs

**Goal:** Create the tabbed detail page with header (title, status pill, `[⋯]` Delete menu) and shadcn Tabs (Overview placeholder, Triggers/Documents wired to existing components, Runs placeholder). Wire the placeholder route from Task 1 to render it. Update the sidebar's ⚙️ Settings button to navigate to `?tab=overview` instead of opening the modal (modal stays available temporarily until cleanup in Task 7).

**Files:**

- Create: `apps/client/src/components/routines/RoutineDetailView.tsx`
- Create: `apps/client/src/components/routines/__tests__/RoutineDetailView.test.tsx`
- Modify: `apps/client/src/routes/_authenticated/routines/$routineId.tsx` — render `RoutineDetailView` instead of placeholder.
- Modify: `apps/client/src/components/routines/RoutinesSidebar.tsx` — settings button navigates instead of opening modal.

**Acceptance Criteria:**

- [ ] Visiting `/routines/$routineId` renders header (title, status pill, `[⋯]` menu) and 4 tabs.
- [ ] Triggers and Documents tabs render the existing `RoutineTriggersTab` / `RoutineDocumentTab` components verbatim.
- [ ] Tab selection persists in URL: `/routines/$routineId?tab=triggers` activates Triggers tab on mount.
- [ ] Switching tabs updates the URL search param via `replace` (no history spam).
- [ ] `[⋯]` menu's Delete entry is hidden when `!canDelete` (status not in `upcoming/completed/failed/stopped/timeout`).
- [ ] Confirming delete calls `routinesApi.delete`, invalidates `["routines"]`, and navigates to `/routines`.
- [ ] Clicking the sidebar ⚙️ button navigates to `/routines/$routineId?tab=overview` (verified in updated sidebar test).

**Verify:** `pnpm --filter client test --run components/routines/__tests__/RoutineDetailView` → passes.

**Steps:**

- [ ] **Step 1: Create `RoutineDetailView.tsx`**

```tsx
// apps/client/src/components/routines/RoutineDetailView.tsx
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
import type { RoutineDetail, RoutineStatus } from "@/types/routine";
import { useState } from "react";

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

type TabKey = "overview" | "triggers" | "documents" | "runs";

interface RoutineDetailViewProps {
  routine: RoutineDetail;
  tab: TabKey;
  onTabChange: (tab: TabKey) => void;
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
            STATUS_COLORS[routine.status] ?? "bg-gray-400",
          )}
          aria-label={t(`status.${routine.status}`)}
        />
        <h1 className="text-base font-semibold truncate">{routine.title}</h1>
        <div className="ml-auto">
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
              {canDelete && (
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 size={14} className="mr-2" />
                  {t("detail.delete")}
                </DropdownMenuItem>
              )}
              {!canDelete && (
                <DropdownMenuItem disabled>
                  {t("detail.noActions", "No actions available")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <Tabs
        value={tab}
        onValueChange={(v) => onTabChange(v as TabKey)}
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
          <div data-testid="overview-tab-placeholder" className="p-4" />
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
          <div data-testid="runs-tab-placeholder" className="p-4" />
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
```

- [ ] **Step 2: Wire `RoutineDetailView` into the detail route**

```tsx
// apps/client/src/routes/_authenticated/routines/$routineId.tsx
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
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          Routine not found
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Update sidebar settings button to navigate**

In `RoutinesSidebar.tsx`, replace `onOpenSettings={() => setShowSettingsRoutineId(routine.id)}` with:

```tsx
onOpenSettings={() =>
  void navigate({
    to: "/routines/$routineId",
    params: { routineId: routine.id },
    search: { tab: "overview" },
  })
}
```

Keep the `RoutineSettingsDialog` rendering and `showSettingsRoutineId` state in the file for now — they become dead code after this step but are removed in Task 7. (Reason: keeping the import alive avoids accidental breakage if some other unknown caller still triggers it; we delete cleanly in Task 7.)

- [ ] **Step 4: Write `RoutineDetailView` test**

```tsx
// apps/client/src/components/routines/__tests__/RoutineDetailView.test.tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockNavigate = vi.fn();
const mockDelete = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock("@/services/api/routines", () => ({
  routinesApi: {
    delete: (...args: unknown[]) => mockDelete(...args),
  },
}));

vi.mock("../RoutineTriggersTab", () => ({
  RoutineTriggersTab: ({ routineId }: { routineId: string }) => (
    <div data-testid="triggers-tab" data-routine-id={routineId} />
  ),
}));

vi.mock("../RoutineDocumentTab", () => ({
  RoutineDocumentTab: ({ routine }: { routine: { id: string } }) => (
    <div data-testid="documents-tab" data-routine-id={routine.id} />
  ),
}));

import { RoutineDetailView } from "../RoutineDetailView";

const baseRoutine = {
  id: "r1",
  title: "Daily summary",
  status: "completed" as const,
  description: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  botId: null,
  tokenUsage: 0,
  creationChannelId: null,
  creationSessionId: null,
  sourceRef: null,
  currentExecution: null,
};

function renderView(
  props: Partial<{
    tab: "overview" | "triggers" | "documents" | "runs";
    routine: typeof baseRoutine;
  }> = {},
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onTabChange = vi.fn();
  const utils = render(
    <QueryClientProvider client={qc}>
      <RoutineDetailView
        routine={props.routine ?? baseRoutine}
        tab={props.tab ?? "overview"}
        onTabChange={onTabChange}
      />
    </QueryClientProvider>,
  );
  return { ...utils, onTabChange };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RoutineDetailView", () => {
  it("renders title and status pill", () => {
    renderView();
    expect(screen.getByText("Daily summary")).toBeInTheDocument();
  });

  it("activates the Triggers tab when tab='triggers'", () => {
    renderView({ tab: "triggers" });
    expect(screen.getByTestId("triggers-tab")).toBeInTheDocument();
    expect(screen.getByTestId("triggers-tab")).toHaveAttribute(
      "data-routine-id",
      "r1",
    );
  });

  it("calls onTabChange when a tab is clicked", () => {
    const { onTabChange } = renderView({ tab: "overview" });
    fireEvent.click(screen.getByText("Documents"));
    expect(onTabChange).toHaveBeenCalledWith("documents");
  });

  it("hides Delete entry when status is in_progress", async () => {
    renderView({ routine: { ...baseRoutine, status: "in_progress" } });
    fireEvent.click(screen.getByLabelText("More"));
    await waitFor(() => {
      expect(screen.queryByText("detail.delete")).toBeNull();
    });
  });

  it("shows Delete entry and deletes on confirm for completed routine", async () => {
    mockDelete.mockResolvedValue(undefined);
    renderView({ routine: { ...baseRoutine, status: "completed" } });
    fireEvent.click(screen.getByLabelText("More"));
    fireEvent.click(await screen.findByText("detail.delete"));
    fireEvent.click(
      await screen.findByRole("button", { name: "detail.delete" }),
    );
    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith("r1");
    });
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({ to: "/routines" });
    });
  });
});
```

- [ ] **Step 5: Run tests + commit**

```bash
pnpm --filter client typecheck
pnpm --filter client test --run components/routines
```

```bash
git add apps/client/src/components/routines/RoutineDetailView.tsx \
        apps/client/src/components/routines/__tests__/RoutineDetailView.test.tsx \
        apps/client/src/routes/_authenticated/routines/\$routineId.tsx \
        apps/client/src/components/routines/RoutinesSidebar.tsx
git commit -m "$(cat <<'EOF'
feat(routines): add RoutineDetailView shell with tabs and delete menu

Detail route now renders header (title, status pill, [...] Delete menu) and
shadcn Tabs (Overview placeholder, Triggers/Documents wired, Runs placeholder).
Tab selection round-trips via ?tab= search param. Sidebar settings ⚙️ button
navigates to ?tab=overview instead of opening modal.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: RunListItem component

**Goal:** A new "richer" row component for the detail page that shows status pill, version, relative time, trigger badge (per spec mapping), token usage, and duration. Used by Overview tab's recent-5 list (Task 4) and Runs tab (Task 5). Existing sidebar `RunItem` is left unchanged.

**Files:**

- Create: `apps/client/src/components/routines/RunListItem.tsx`
- Create: `apps/client/src/components/routines/__tests__/RunListItem.test.tsx`

**Acceptance Criteria:**

- [ ] Renders status dot + status label + `vN` version + relative time + trigger badge in a primary row.
- [ ] Renders `<X> tokens` (if `tokenUsage > 0`) and `<duration>` (formatted, see spec) in a secondary muted row.
- [ ] Trigger badge text follows the mapping table: Retry / Manual / Scheduled / Interval / Channel / (no badge for null/unknown).
- [ ] `Retry` is detected via `triggerContext.originalExecutionId` truthiness — overrides `triggerType`.
- [ ] Duration shows `running 3m+` for in-progress runs (no `completedAt`); `Xh Ym` / `Xm Ys` / `Xs` for finished; hidden if `startedAt` is null.
- [ ] Selected state styling matches sidebar `RunItem` (primary tint + ring).
- [ ] `onClick` is invoked on click.

**Verify:** `pnpm --filter client test --run components/routines/__tests__/RunListItem` → passes.

**Steps:**

- [ ] **Step 1: Create `RunListItem.tsx`**

```tsx
// apps/client/src/components/routines/RunListItem.tsx
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/date-format";
import type {
  RoutineExecution,
  RoutineStatus,
  TriggerContext,
  RetryTriggerContext,
} from "@/types/routine";

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

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0s";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function isRetry(ctx: TriggerContext | null): ctx is RetryTriggerContext {
  return !!ctx && "originalExecutionId" in ctx && !!ctx.originalExecutionId;
}

function triggerBadgeLabel(
  triggerType: string | null,
  triggerContext: TriggerContext | null,
  t: (key: string, fallback?: string) => string,
): string | null {
  if (isRetry(triggerContext)) return t("detail.trigger.retry", "Retry");
  switch (triggerType) {
    case "manual":
      return t("detail.trigger.manual", "Manual");
    case "schedule":
      return t("detail.trigger.scheduled", "Scheduled");
    case "interval":
      return t("detail.trigger.interval", "Interval");
    case "channel_message":
      return t("detail.trigger.channel", "Channel");
    default:
      return null;
  }
}

function durationText(
  execution: RoutineExecution,
  t: (key: string, fallback?: string) => string,
): string | null {
  if (!execution.startedAt) return null;
  if (execution.completedAt) {
    const seconds =
      execution.duration ??
      Math.max(
        0,
        Math.floor(
          (new Date(execution.completedAt).getTime() -
            new Date(execution.startedAt).getTime()) /
            1000,
        ),
      );
    return formatDuration(seconds);
  }
  const elapsed = Math.max(
    0,
    Math.floor((Date.now() - new Date(execution.startedAt).getTime()) / 1000),
  );
  return `${t("detail.runListItem.runningPrefix", "running")} ${formatDuration(elapsed)}+`;
}

interface RunListItemProps {
  execution: RoutineExecution;
  isSelected: boolean;
  onClick: () => void;
}

export function RunListItem({
  execution,
  isSelected,
  onClick,
}: RunListItemProps) {
  const { t } = useTranslation("routines");
  const badge = triggerBadgeLabel(
    execution.triggerType,
    execution.triggerContext,
    t,
  );
  const dur = durationText(execution, t);

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-3 py-2 rounded-md border transition-colors",
        isSelected
          ? "bg-primary/10 border-primary/30 ring-1 ring-primary/25"
          : "border-border hover:bg-muted/50",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "inline-block w-2 h-2 rounded-full shrink-0",
            STATUS_COLORS[execution.status] ?? "bg-gray-400",
          )}
          aria-label={t(`status.${execution.status}`)}
        />
        <span
          className={cn(
            "text-xs font-medium",
            isSelected ? "text-primary" : "text-foreground",
          )}
        >
          {t(`status.${execution.status}`)}
        </span>
        <span className="text-[11px] text-muted-foreground">
          v{execution.routineVersion}
        </span>
        {execution.startedAt && (
          <span className="text-[11px] text-muted-foreground ml-auto">
            {formatDateTime(execution.startedAt)}
          </span>
        )}
        {badge && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border shrink-0">
            {badge}
          </span>
        )}
      </div>
      {(dur || execution.tokenUsage > 0) && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-1 pl-4">
          {execution.tokenUsage > 0 && (
            <span>
              {t("detail.tokenCount", {
                count: execution.tokenUsage,
                defaultValue: `${execution.tokenUsage} tokens`,
              })}
            </span>
          )}
          {dur && execution.tokenUsage > 0 && <span>·</span>}
          {dur && <span>{dur}</span>}
        </div>
      )}
    </button>
  );
}
```

- [ ] **Step 2: Write `RunListItem` test**

```tsx
// apps/client/src/components/routines/__tests__/RunListItem.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown> | string) => {
      if (typeof opts === "string") return opts;
      const fallback = opts?.defaultValue as string | undefined;
      return fallback ?? key;
    },
  }),
}));

vi.mock("@/lib/date-format", () => ({
  formatDateTime: (s: string) => `formatted:${s}`,
}));

import { RunListItem } from "../RunListItem";
import type { RoutineExecution } from "@/types/routine";

const baseExecution: RoutineExecution = {
  id: "e1",
  routineId: "r1",
  routineVersion: 3,
  status: "completed",
  channelId: null,
  taskcastTaskId: null,
  tokenUsage: 0,
  triggerId: null,
  triggerType: null,
  triggerContext: null,
  documentVersionId: null,
  sourceExecutionId: null,
  startedAt: "2026-04-26T10:00:00Z",
  completedAt: "2026-04-26T10:03:24Z",
  duration: 204,
  error: null,
  createdAt: "2026-04-26T10:00:00Z",
};

const fixedNow = new Date("2026-04-26T10:05:00Z").getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(fixedNow);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("RunListItem", () => {
  it("renders version, formatted time, token, duration", () => {
    render(
      <RunListItem
        execution={{ ...baseExecution, tokenUsage: 1200 }}
        isSelected={false}
        onClick={() => {}}
      />,
    );
    expect(screen.getByText("v3")).toBeInTheDocument();
    expect(screen.getByText(/formatted:2026-04-26/)).toBeInTheDocument();
    expect(screen.getByText("1200 tokens")).toBeInTheDocument();
    expect(screen.getByText("3m 24s")).toBeInTheDocument();
  });

  it("hides token when tokenUsage is 0", () => {
    render(
      <RunListItem
        execution={baseExecution}
        isSelected={false}
        onClick={() => {}}
      />,
    );
    expect(screen.queryByText(/tokens/)).toBeNull();
  });

  it.each([
    ["manual", "Manual"],
    ["schedule", "Scheduled"],
    ["interval", "Interval"],
    ["channel_message", "Channel"],
  ] as const)(
    "renders trigger badge for triggerType=%s",
    (triggerType, label) => {
      render(
        <RunListItem
          execution={{ ...baseExecution, triggerType }}
          isSelected={false}
          onClick={() => {}}
        />,
      );
      expect(screen.getByText(label)).toBeInTheDocument();
    },
  );

  it("renders Retry badge when triggerContext has originalExecutionId", () => {
    render(
      <RunListItem
        execution={{
          ...baseExecution,
          triggerType: "manual",
          triggerContext: {
            triggeredAt: "2026-04-26T10:00:00Z",
            triggeredBy: "u1",
            originalExecutionId: "e0",
          },
        }}
        isSelected={false}
        onClick={() => {}}
      />,
    );
    expect(screen.getByText("Retry")).toBeInTheDocument();
    expect(screen.queryByText("Manual")).toBeNull();
  });

  it("renders no badge when triggerType is null and not retry", () => {
    render(
      <RunListItem
        execution={baseExecution}
        isSelected={false}
        onClick={() => {}}
      />,
    );
    ["Manual", "Scheduled", "Interval", "Channel", "Retry"].forEach((label) => {
      expect(screen.queryByText(label)).toBeNull();
    });
  });

  it("renders running prefix for in-progress runs", () => {
    render(
      <RunListItem
        execution={{
          ...baseExecution,
          status: "in_progress",
          completedAt: null,
          duration: null,
        }}
        isSelected={false}
        onClick={() => {}}
      />,
    );
    expect(screen.getByText("running 5m 0s+")).toBeInTheDocument();
  });

  it("hides duration when startedAt is null", () => {
    const { container } = render(
      <RunListItem
        execution={{ ...baseExecution, startedAt: null, completedAt: null }}
        isSelected={false}
        onClick={() => {}}
      />,
    );
    expect(container.querySelector(".pl-4")).toBeNull();
  });

  it("applies selected styling and fires onClick", () => {
    const onClick = vi.fn();
    const { container } = render(
      <RunListItem
        execution={baseExecution}
        isSelected={true}
        onClick={onClick}
      />,
    );
    const btn = container.querySelector("button");
    expect(btn?.className).toMatch(/primary|ring/);
    fireEvent.click(btn!);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run tests + commit**

```bash
pnpm --filter client test --run components/routines/__tests__/RunListItem
```

```bash
git add apps/client/src/components/routines/RunListItem.tsx \
        apps/client/src/components/routines/__tests__/RunListItem.test.tsx
git commit -m "$(cat <<'EOF'
feat(routines): add RunListItem with trigger badge, token, duration

Richer execution row used by detail page Overview and Runs tabs. Sidebar
RunItem is unchanged. Trigger badge mapping: retry > manual/schedule/interval/
channel_message > none. Duration formats finished runs (Xh Ym / Xm Ys / Xs)
and in-progress runs as 'running Xm Ys+'.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: RoutineOverviewTab

**Goal:** Implement the Overview tab — description, metadata grid (created at, last run at, total tokens, current execution status with View link), bot assignment Select, recent 5 runs (using `RunListItem`), and "View all runs →" link that switches to the Runs tab.

**Files:**

- Create: `apps/client/src/components/routines/tabs/RoutineOverviewTab.tsx`
- Create: `apps/client/src/components/routines/tabs/__tests__/RoutineOverviewTab.test.tsx`
- Modify: `apps/client/src/components/routines/RoutineDetailView.tsx` — replace overview placeholder.

**Acceptance Criteria:**

- [ ] Description renders when present; absent when `routine.description` is empty/null.
- [ ] Metadata grid renders 4 cells; `Total tokens` is hidden when `tokenUsage <= 0`.
- [ ] Current execution row shows status pill + "View" link only when `routine.currentExecution` is not null; clicking View navigates to that run.
- [ ] Bot assignment Select changes call `routinesApi.update(id, { botId })` and invalidate `["routine", id]` + `["routines"]`.
- [ ] Recent 5 runs section: shows up to 5 most recent executions; empty state if 0.
- [ ] "View all runs →" link calls the `onSwitchTab("runs")` callback.
- [ ] Clicking a recent run row navigates to `/routines/$routineId/runs/$executionId`.

**Verify:** `pnpm --filter client test --run components/routines/tabs/__tests__/RoutineOverviewTab` → passes.

**Steps:**

- [ ] **Step 1: Create `RoutineOverviewTab.tsx`**

```tsx
// apps/client/src/components/routines/tabs/RoutineOverviewTab.tsx
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
            label={t("detail.createdAt", "Created")}
            value={formatDateTime(routine.createdAt)}
          />
          <MetaCell
            label={t("detail.lastRunAt", "Last run")}
            value={lastRunAt ? formatDateTime(lastRunAt) : "—"}
          />
          {routine.tokenUsage > 0 && (
            <MetaCell
              label={t("detail.totalTokens", "Total tokens")}
              value={String(routine.tokenUsage)}
            />
          )}
          {currentExecution && (
            <div className="space-y-1">
              <div className="text-[11px] text-muted-foreground">
                {t("detail.currentRun", "Current run")}
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
                  {t("detail.view", "View →")}
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
            <h3 className="text-sm font-semibold">
              {t("detail.recentRuns", "Recent runs")}
            </h3>
            {executions.length > 0 && (
              <button
                onClick={() => onSwitchTab("runs")}
                className="text-xs text-primary hover:underline"
              >
                {t("detail.viewAllRuns", "View all runs →")}
              </button>
            )}
          </div>
          {recent5.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4">
              {t("historyTab.empty", "No runs yet")}
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
```

- [ ] **Step 2: Wire into `RoutineDetailView`**

In `RoutineDetailView.tsx`, replace the overview `TabsContent` body:

```tsx
<TabsContent value="overview" className="flex-1 min-h-0 mt-0">
  <RoutineOverviewTab routine={routine} onSwitchTab={onTabChange} />
</TabsContent>
```

Add the import: `import { RoutineOverviewTab } from "./tabs/RoutineOverviewTab";`. The existing `data-testid="overview-tab-placeholder"` div is removed.

- [ ] **Step 3: Write `RoutineOverviewTab` test**

```tsx
// apps/client/src/components/routines/tabs/__tests__/RoutineOverviewTab.test.tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockNavigate = vi.fn();
const mockUpdate = vi.fn();
const mockGetExecutions = vi.fn();
const mockGetApps = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown> | string) => {
      if (typeof opts === "string") return opts;
      const fallback = opts?.defaultValue as string | undefined;
      return fallback ?? key;
    },
  }),
}));

vi.mock("@/lib/date-format", () => ({
  formatDateTime: (s: string) => `formatted:${s}`,
}));

vi.mock("@/services/api/routines", () => ({
  routinesApi: {
    update: (...args: unknown[]) => mockUpdate(...args),
    getExecutions: (...args: unknown[]) => mockGetExecutions(...args),
  },
}));

vi.mock("@/services/api", () => ({
  api: {
    applications: {
      getInstalledApplicationsWithBots: (...args: unknown[]) =>
        mockGetApps(...args),
    },
  },
}));

vi.mock("@/stores/useWorkspaceStore", () => ({
  useSelectedWorkspaceId: () => "ws-1",
}));

vi.mock("../../RunListItem", () => ({
  RunListItem: ({
    execution,
    onClick,
  }: {
    execution: { id: string };
    onClick: () => void;
  }) => (
    <button data-testid={`run-${execution.id}`} onClick={onClick}>
      run-{execution.id}
    </button>
  ),
}));

import { RoutineOverviewTab } from "../RoutineOverviewTab";
import type { RoutineDetail } from "@/types/routine";

const baseRoutine: RoutineDetail = {
  id: "r1",
  title: "Daily",
  status: "in_progress",
  description: "Some description",
  createdAt: "2026-04-26T08:00:00Z",
  updatedAt: "2026-04-26T08:00:00Z",
  botId: null,
  tokenUsage: 1500,
  creationChannelId: null,
  creationSessionId: null,
  sourceRef: null,
  currentExecution: null,
};

function renderTab(
  routineOverride: Partial<RoutineDetail> = {},
  executions: Array<unknown> = [],
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  mockGetExecutions.mockResolvedValue(executions);
  mockGetApps.mockResolvedValue([]);
  const onSwitchTab = vi.fn();
  const utils = render(
    <QueryClientProvider client={qc}>
      <RoutineOverviewTab
        routine={{ ...baseRoutine, ...routineOverride }}
        onSwitchTab={onSwitchTab}
      />
    </QueryClientProvider>,
  );
  return { ...utils, onSwitchTab };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RoutineOverviewTab", () => {
  it("renders description and total tokens when present", () => {
    renderTab();
    expect(screen.getByText("Some description")).toBeInTheDocument();
    expect(screen.getByText("1500")).toBeInTheDocument();
  });

  it("hides description when null and total tokens when 0", () => {
    renderTab({ description: null, tokenUsage: 0 });
    expect(screen.queryByText("Some description")).toBeNull();
    expect(screen.queryByText("Total tokens")).toBeNull();
  });

  it("renders current run pill + View link when present and navigates", () => {
    renderTab({
      currentExecution: {
        execution: {
          id: "exec-current",
          routineId: "r1",
          routineVersion: 2,
          status: "in_progress",
          channelId: null,
          taskcastTaskId: null,
          tokenUsage: 0,
          triggerId: null,
          triggerType: null,
          triggerContext: null,
          documentVersionId: null,
          sourceExecutionId: null,
          startedAt: "2026-04-26T09:00:00Z",
          completedAt: null,
          duration: null,
          error: null,
          createdAt: "2026-04-26T09:00:00Z",
        },
        steps: [],
        interventions: [],
        deliverables: [],
      },
    });
    fireEvent.click(screen.getByText("View →"));
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/routines/$routineId/runs/$executionId",
      params: { routineId: "r1", executionId: "exec-current" },
    });
  });

  it("renders recent 5 runs and switches tab on View all", async () => {
    const executions = Array.from({ length: 7 }, (_, i) => ({
      id: `e${i}`,
      routineId: "r1",
      routineVersion: 1,
      status: "completed",
      channelId: null,
      taskcastTaskId: null,
      tokenUsage: 0,
      triggerId: null,
      triggerType: null,
      triggerContext: null,
      documentVersionId: null,
      sourceExecutionId: null,
      startedAt: `2026-04-2${i}T08:00:00Z`,
      completedAt: `2026-04-2${i}T08:01:00Z`,
      duration: 60,
      error: null,
      createdAt: `2026-04-2${i}T08:00:00Z`,
    }));
    const { onSwitchTab } = renderTab({}, executions);

    await waitFor(() => {
      expect(screen.getByTestId("run-e0")).toBeInTheDocument();
      expect(screen.getByTestId("run-e4")).toBeInTheDocument();
      expect(screen.queryByTestId("run-e5")).toBeNull();
    });

    fireEvent.click(screen.getByText("View all runs →"));
    expect(onSwitchTab).toHaveBeenCalledWith("runs");
  });

  it("shows empty state when no runs", async () => {
    renderTab({}, []);
    await waitFor(() => {
      expect(screen.getByText("No runs yet")).toBeInTheDocument();
      expect(screen.queryByText("View all runs →")).toBeNull();
    });
  });

  it("calls update mutation when bot is changed", async () => {
    mockGetApps.mockResolvedValue([
      {
        appId: "app1",
        status: "active",
        bots: [{ botId: "bot-1", displayName: "Bot One", username: "bot1" }],
      },
    ]);
    mockUpdate.mockResolvedValue(undefined);
    renderTab();
    fireEvent.click(screen.getByRole("combobox"));
    const opt = await screen.findByText("Bot One");
    fireEvent.click(opt);
    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith("r1", { botId: "bot-1" });
    });
  });
});
```

- [ ] **Step 4: Run tests + commit**

```bash
pnpm --filter client typecheck
pnpm --filter client test --run components/routines/tabs/__tests__/RoutineOverviewTab
pnpm --filter client test --run components/routines/__tests__/RoutineDetailView
```

```bash
git add apps/client/src/components/routines/tabs/RoutineOverviewTab.tsx \
        apps/client/src/components/routines/tabs/__tests__/RoutineOverviewTab.test.tsx \
        apps/client/src/components/routines/RoutineDetailView.tsx
git commit -m "$(cat <<'EOF'
feat(routines): implement Overview tab with metadata + recent 5 runs

Description, metadata grid (created, last run, tokens, current execution
pill+View link), bot assignment Select (calls routinesApi.update), recent 5
runs via RunListItem, and 'View all runs ->' link that switches to Runs tab.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: RoutineRunsTab

**Goal:** Implement the Runs tab — full execution list (sorted desc by `startedAt`), 20-at-a-time progressive display ("Show 20 more"), polling enabled while this tab is active, click-to-navigate. Uses `RunListItem`.

**Files:**

- Create: `apps/client/src/components/routines/tabs/RoutineRunsTab.tsx`
- Create: `apps/client/src/components/routines/tabs/__tests__/RoutineRunsTab.test.tsx`
- Modify: `apps/client/src/components/routines/RoutineDetailView.tsx` — replace runs placeholder.

**Acceptance Criteria:**

- [ ] Shows first 20 executions; clicking "Show 20 more" appends next 20.
- [ ] "Show 20 more" hides when all executions are visible.
- [ ] Polling (`refetchInterval: 5000`) is enabled only when this tab is active (`active` prop is `true`).
- [ ] Clicking a row navigates to `/routines/$routineId/runs/$executionId`.
- [ ] Empty state shown when 0 executions.

**Verify:** `pnpm --filter client test --run components/routines/tabs/__tests__/RoutineRunsTab` → passes.

**Steps:**

- [ ] **Step 1: Create `RoutineRunsTab.tsx`**

```tsx
// apps/client/src/components/routines/tabs/RoutineRunsTab.tsx
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
            {t("historyTab.empty", "No runs yet")}
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
                {t("detail.showMore", `Show ${PAGE_SIZE} more`)}
              </Button>
            )}
          </>
        )}
      </div>
    </ScrollArea>
  );
}
```

- [ ] **Step 2: Wire into `RoutineDetailView`**

In `RoutineDetailView.tsx`, replace the runs `TabsContent` body:

```tsx
<TabsContent value="runs" className="flex-1 min-h-0 mt-0">
  <RoutineRunsTab
    routineId={routine.id}
    selectedExecutionId={null}
    active={tab === "runs"}
  />
</TabsContent>
```

Add the import: `import { RoutineRunsTab } from "./tabs/RoutineRunsTab";`. Remove the `data-testid="runs-tab-placeholder"` div.

- [ ] **Step 3: Write `RoutineRunsTab` test**

```tsx
// apps/client/src/components/routines/tabs/__tests__/RoutineRunsTab.test.tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockNavigate = vi.fn();
const mockGetExecutions = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock("@/services/api/routines", () => ({
  routinesApi: {
    getExecutions: (...args: unknown[]) => mockGetExecutions(...args),
  },
}));

vi.mock("../../RunListItem", () => ({
  RunListItem: ({
    execution,
    isSelected,
    onClick,
  }: {
    execution: { id: string };
    isSelected: boolean;
    onClick: () => void;
  }) => (
    <button
      data-testid={`run-${execution.id}`}
      data-selected={isSelected}
      onClick={onClick}
    >
      run-{execution.id}
    </button>
  ),
}));

import { RoutineRunsTab } from "../RoutineRunsTab";

function makeExecutions(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `e${i}`,
    routineId: "r1",
    routineVersion: 1,
    status: "completed" as const,
    channelId: null,
    taskcastTaskId: null,
    tokenUsage: 0,
    triggerId: null,
    triggerType: null,
    triggerContext: null,
    documentVersionId: null,
    sourceExecutionId: null,
    startedAt: "2026-04-26T08:00:00Z",
    completedAt: "2026-04-26T08:01:00Z",
    duration: 60,
    error: null,
    createdAt: "2026-04-26T08:00:00Z",
  }));
}

function renderTab(
  props: { active?: boolean; selectedExecutionId?: string | null } = {},
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <RoutineRunsTab
        routineId="r1"
        selectedExecutionId={props.selectedExecutionId ?? null}
        active={props.active ?? true}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RoutineRunsTab", () => {
  it("renders empty state when no executions", async () => {
    mockGetExecutions.mockResolvedValue([]);
    renderTab();
    await waitFor(() => {
      expect(screen.getByText("No runs yet")).toBeInTheDocument();
    });
  });

  it("shows first 20 and 'Show 20 more' when more exist", async () => {
    mockGetExecutions.mockResolvedValue(makeExecutions(45));
    renderTab();
    await waitFor(() => {
      expect(screen.getByTestId("run-e0")).toBeInTheDocument();
      expect(screen.getByTestId("run-e19")).toBeInTheDocument();
      expect(screen.queryByTestId("run-e20")).toBeNull();
    });
    expect(screen.getByText("Show 20 more")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Show 20 more"));
    await waitFor(() => {
      expect(screen.getByTestId("run-e39")).toBeInTheDocument();
      expect(screen.queryByTestId("run-e40")).toBeNull();
    });

    fireEvent.click(screen.getByText("Show 20 more"));
    await waitFor(() => {
      expect(screen.getByTestId("run-e44")).toBeInTheDocument();
      expect(screen.queryByText("Show 20 more")).toBeNull();
    });
  });

  it("does not query executions when inactive", () => {
    mockGetExecutions.mockResolvedValue(makeExecutions(3));
    renderTab({ active: false });
    expect(mockGetExecutions).not.toHaveBeenCalled();
  });

  it("highlights selected execution and navigates on click", async () => {
    mockGetExecutions.mockResolvedValue(makeExecutions(2));
    renderTab({ selectedExecutionId: "e1" });
    await waitFor(() => {
      expect(screen.getByTestId("run-e1")).toHaveAttribute(
        "data-selected",
        "true",
      );
    });
    fireEvent.click(screen.getByTestId("run-e0"));
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/routines/$routineId/runs/$executionId",
      params: { routineId: "r1", executionId: "e0" },
    });
  });
});
```

- [ ] **Step 4: Run tests + commit**

```bash
pnpm --filter client test --run components/routines/tabs/__tests__/RoutineRunsTab
pnpm --filter client test --run components/routines/__tests__/RoutineDetailView
```

```bash
git add apps/client/src/components/routines/tabs/RoutineRunsTab.tsx \
        apps/client/src/components/routines/tabs/__tests__/RoutineRunsTab.test.tsx \
        apps/client/src/components/routines/RoutineDetailView.tsx
git commit -m "$(cat <<'EOF'
feat(routines): implement Runs tab with progressive 20-at-a-time display

Full execution history sorted desc by startedAt; first 20 visible, 'Show 20
more' appends next batch. Polling (5s) enabled only while tab is active.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Sidebar simplification — chevron split + active runs only + default click → detail

**Goal:** Switch sidebar default routine click from "auto-navigate to first/active run" to "navigate to detail page" (`/routines/$routineId`). Split chevron click vs. body click on `RoutineCard`. Filter sidebar expansion to show only active runs (drop `showAllRuns`, `DEFAULT_VISIBLE_RUNS`, "Show more").

**Files:**

- Modify: `apps/client/src/components/routines/RoutineCard.tsx`
- Modify: `apps/client/src/components/routines/RoutinesSidebar.tsx`
- Modify: `apps/client/src/components/routines/__tests__/RoutinesSidebar.test.tsx`

**Acceptance Criteria:**

- [ ] Clicking a non-draft routine body navigates to `/routines/$routineId` (not the run URL).
- [ ] Clicking a draft routine body navigates to `/routines/$routineId/runs/creation` (unchanged).
- [ ] Clicking the chevron toggles `expandedRoutineIds` only and does **not** navigate.
- [ ] Expanded card body shows only executions with status `in_progress | paused | pending_action` plus the creation row (when `status === draft`).
- [ ] Empty active-run list while expanded does NOT render the "no runs yet" placeholder (collapses to header only).
- [ ] No "Show more" button anywhere in `RoutineCard`.

**Verify:** `pnpm --filter client test --run components/routines` → all sidebar/card tests pass.

**Steps:**

- [ ] **Step 1: Update `RoutineCard.tsx` — split chevron, drop showAll, filter active**

Update the props (replace existing `RoutineCardProps`):

```tsx
const ACTIVE_STATUSES: RoutineStatus[] = [
  "in_progress",
  "paused",
  "pending_action",
];

interface RoutineCardProps {
  routine: Routine;
  isExpanded: boolean;
  isActive: boolean;
  selectedRun: SelectedRun;
  executions: RoutineExecution[];
  botName?: string | null;
  onToggleExpand: () => void;
  onOpenRoutine: () => void;
  onSelectRun: (runId: string) => void;
  onOpenCreationSession: (routineId: string) => void;
  onOpenSettings: () => void;
}
```

Inside the component, drop the `showAllRuns` `useState` and the `DEFAULT_VISIBLE_RUNS` constant. Change the keyboard handler:

```tsx
const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    onOpenRoutine();
  }
};

const handleHeaderClick = () => {
  onOpenRoutine();
};

const handleChevronClick = (e: MouseEvent) => {
  e.stopPropagation();
  onToggleExpand();
};
```

Replace the header `onClick={onToggleExpand}` with `onClick={handleHeaderClick}`. Replace the chevron `<span>` with a `<button>`:

```tsx
<button
  onClick={handleChevronClick}
  className="text-muted-foreground shrink-0 p-0.5 -m-0.5 rounded hover:bg-muted"
  aria-label={t("detail.toggleExpand", "Toggle expand")}
>
  {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
</button>
```

Replace the entire `{isExpanded && ...}` block with:

```tsx
{
  isExpanded &&
    (() => {
      const activeRuns = executions.filter((e) =>
        ACTIVE_STATUSES.includes(e.status),
      );
      const showCreationRow =
        routine.status === "draft" && routine.creationChannelId;
      if (activeRuns.length === 0 && !showCreationRow) return null;
      return (
        <div className="px-3 pb-3">
          <div className="ml-3 pl-2 border-l-2 border-border space-y-0.5">
            {activeRuns.map((exec) => (
              <RunItem
                key={exec.id}
                execution={exec}
                isSelected={
                  selectedRun?.kind === "execution" &&
                  selectedRun.executionId === exec.id
                }
                onClick={() => onSelectRun(exec.id)}
              />
            ))}
            {showCreationRow && (
              <CreationSessionRunItem
                isSelected={
                  selectedRun?.kind === "creation" &&
                  selectedRun.routineId === routine.id
                }
                onClick={() => onOpenCreationSession(routine.id)}
              />
            )}
          </div>
        </div>
      );
    })();
}
```

Remove the `useState` import if no longer needed (still needed for `showStartDialog`, so leave it).

- [ ] **Step 2: Update `RoutinesSidebar.tsx` — body click → detail URL**

Change `handleOpenRoutine` (drop the `executions` parameter):

```tsx
const handleOpenRoutine = useCallback(
  (routine: Routine) => {
    if (routine.status === "draft" && routine.creationChannelId) {
      void navigate({
        to: "/routines/$routineId/runs/$executionId",
        params: { routineId: routine.id, executionId: "creation" },
      });
      return;
    }
    void navigate({
      to: "/routines/$routineId",
      params: { routineId: routine.id },
    });
  },
  [navigate],
);
```

Inside `ExpandableRoutineCard`, simplify the prop type and forwarding:

```tsx
interface ExpandableRoutineCardProps {
  routine: Routine;
  isExpanded: boolean;
  isActive: boolean;
  selectedExecutionId: string | null;
  botNameMap: Map<string, string>;
  onToggleExpand: () => void;
  onOpenRoutine: () => void;
  onSelectRun: (routineId: string, executionId: string) => void;
  onOpenSettings: () => void;
}
```

In `RoutinesSidebar`'s map call:

```tsx
<ExpandableRoutineCard
  key={routine.id}
  routine={routine}
  isExpanded={expandedRoutineIds.has(routine.id)}
  isActive={selectedRoutineId === routine.id}
  selectedExecutionId={
    selectedRoutineId === routine.id ? selectedExecutionId : null
  }
  botNameMap={botNameMap}
  onToggleExpand={() => handleToggleExpand(routine.id)}
  onOpenRoutine={() => handleOpenRoutine(routine)}
  onSelectRun={handleSelectRun}
  onOpenSettings={() =>
    void navigate({
      to: "/routines/$routineId",
      params: { routineId: routine.id },
      search: { tab: "overview" },
    })
  }
/>
```

Inside `ExpandableRoutineCard`, pass `onOpenRoutine` straight to `RoutineCard` (drop the legacy "+executions" wrapper). Also update the `DraftRoutineCard.onOpenCreationSession` and `AgenticAgentPicker.onOpenCreationSession` callsites — they should now resolve the routine and call `handleOpenRoutine(resolvedRoutine)`:

```tsx
onOpenCreationSession={(id) => {
  const r = allRoutines.find((rr) => rr.id === id);
  if (r) handleOpenRoutine(r);
}}
```

- [ ] **Step 3: Update sidebar test for new navigation target**

In `RoutinesSidebar.test.tsx`, replace the existing draft-click test with two cases:

```tsx
it("navigates to detail page on non-draft routine click", async () => {
  mockList.mockResolvedValue([
    {
      id: "r1",
      title: "First",
      status: "in_progress",
      createdAt: new Date().toISOString(),
      botId: null,
      tokenUsage: 0,
      creationChannelId: null,
    },
  ]);
  mockGetExecutions.mockResolvedValue([]);

  renderSidebar({ selectedRoutineId: null, selectedExecutionId: null });

  const card = await screen.findByText("First");
  fireEvent.click(card);

  await waitFor(() => {
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/routines/$routineId",
      params: { routineId: "r1" },
    });
  });
});

it("navigates to /routines/$id/runs/creation for draft click", async () => {
  mockList.mockResolvedValue([
    {
      id: "draft1",
      title: "Draft",
      status: "draft",
      createdAt: new Date().toISOString(),
      botId: null,
      tokenUsage: 0,
      creationChannelId: "ch-creation-1",
    },
  ]);

  renderSidebar({ selectedRoutineId: null, selectedExecutionId: null });

  const draftCard = await screen.findByText("Draft");
  fireEvent.click(draftCard);

  await waitFor(() => {
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/routines/$routineId/runs/$executionId",
      params: { routineId: "draft1", executionId: "creation" },
    });
  });
});

it("clicking chevron does not navigate", async () => {
  mockList.mockResolvedValue([
    {
      id: "r1",
      title: "First",
      status: "in_progress",
      createdAt: new Date().toISOString(),
      botId: null,
      tokenUsage: 0,
      creationChannelId: null,
    },
  ]);
  mockGetExecutions.mockResolvedValue([]);

  const { container } = renderSidebar({
    selectedRoutineId: null,
    selectedExecutionId: null,
  });

  await screen.findByText("First");
  const chevron = container.querySelector(
    '[aria-label="Toggle expand"]',
  ) as HTMLButtonElement;
  fireEvent.click(chevron);
  expect(mockNavigate).not.toHaveBeenCalled();
});
```

- [ ] **Step 4: Run tests + commit**

```bash
pnpm --filter client typecheck
pnpm --filter client test --run components/routines
```

```bash
git add apps/client/src/components/routines/RoutineCard.tsx \
        apps/client/src/components/routines/RoutinesSidebar.tsx \
        apps/client/src/components/routines/__tests__/RoutinesSidebar.test.tsx
git commit -m "$(cat <<'EOF'
feat(routines): sidebar default click lands on detail page; active runs only

Routine body click navigates to /routines/$routineId (detail page) instead
of auto-jumping to first/active run. Chevron is a separate button that
toggles expansion without navigating. Expanded card body filters to only
active runs (in_progress / paused / pending_action) plus the creation row;
'Show more' and DEFAULT_VISIBLE_RUNS are dropped.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Cleanup — delete RoutineSettingsDialog + RoutineSettingsTab

**Goal:** Remove the now-orphaned settings modal and its tab. Verify no remaining imports.

**Files:**

- Delete: `apps/client/src/components/routines/RoutineSettingsDialog.tsx`
- Delete: `apps/client/src/components/routines/RoutineSettingsTab.tsx`
- Modify: `apps/client/src/components/routines/RoutinesSidebar.tsx` — remove dialog import, render, and `showSettingsRoutineId` state.

**Acceptance Criteria:**

- [ ] No source file references `RoutineSettingsDialog` or `RoutineSettingsTab`.
- [ ] `pnpm --filter client typecheck` passes.
- [ ] `pnpm --filter client test --run components/routines` passes.

**Verify:** `grep -rn "RoutineSettingsDialog\|RoutineSettingsTab" apps/client/src` → empty output.

**Steps:**

- [ ] **Step 1: Confirm no callers besides the sidebar**

```bash
grep -rn "RoutineSettingsDialog\|RoutineSettingsTab" apps/client/src
```

Expected: only `RoutinesSidebar.tsx` matches. If anything else matches, stop and reconcile (route the caller to the detail page route instead).

- [ ] **Step 2: Remove imports + state from `RoutinesSidebar.tsx`**

Delete:

- `import { RoutineSettingsDialog } from "./RoutineSettingsDialog";`
- `const [showSettingsRoutineId, setShowSettingsRoutineId] = useState<string | null>(null);`
- The `useQuery` block that fetches `settingsRoutineDetail`.
- The `handleSettingsDeleted` callback.
- The `<RoutineSettingsDialog ... />` JSX block at the bottom.

The settings ⚙️ button's `onOpenSettings` already navigates (changed in Task 2 / Task 6), so no further edit needed there.

- [ ] **Step 3: Delete the files**

```bash
git rm apps/client/src/components/routines/RoutineSettingsDialog.tsx \
       apps/client/src/components/routines/RoutineSettingsTab.tsx
```

- [ ] **Step 4: Verify clean**

```bash
grep -rn "RoutineSettingsDialog\|RoutineSettingsTab" apps/client/src
pnpm --filter client typecheck
pnpm --filter client test --run components/routines
```

Expected: grep returns nothing; typecheck and tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/components/routines/RoutinesSidebar.tsx
git commit -m "$(cat <<'EOF'
refactor(routines): remove RoutineSettingsDialog and RoutineSettingsTab

Functionality migrated to the new detail page:
- Bot assignment + delete -> Overview tab + header [...] menu
- Triggers -> Triggers tab (reuses RoutineTriggersTab)
- Documents -> Documents tab (reuses RoutineDocumentTab)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Checklist (engineer to skim before starting)

- [ ] Spec section §3 (URL & view modes) implemented in Tasks 1–2 (routes + sidebar URL-driven).
- [ ] Spec §4 (Sidebar simplification) implemented in Tasks 1 (URL-driven) + 6 (chevron split, active runs only).
- [ ] Spec §5 (RoutineDetailView header + tabs) implemented in Task 2.
- [ ] Spec §6 (Overview tab) implemented in Task 4.
- [ ] Spec §7 (Triggers/Documents reuse) implemented in Task 2.
- [ ] Spec §8 (Runs tab) implemented in Task 5.
- [ ] Spec §9 (RunListItem) implemented in Task 3 (used by Tasks 4 + 5).
- [ ] Spec §10 (file structure) — all new/modified/deleted files mapped to tasks.
- [ ] Spec §11 (testing) — new test files for every new component plus updated sidebar test.
- [ ] Spec §13 (defer backend pagination, fixed batch size 20, fixed recent count 5) honored.
