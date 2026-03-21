# Task Module Hierarchy Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the task module UI so Tasks are expandable with inline Runs, Settings moves to a modal, and the right panel shows only Run details.

**Architecture:** The left panel TaskCard becomes an expandable container with Run sub-items. TaskHistoryTab is removed (absorbed into TaskCard). TaskSettingsTab content moves into a new TaskSettingsDialog modal. TaskRightPanel loses its tabs and renders TaskRunTab directly. State management shifts: `selectedTaskId` is derived from `selectedRunId`, `rightPanelTab` is removed, `expandedTaskIds` and `showSettingsTaskId` are added.

**Tech Stack:** React, TypeScript, TanStack React Query, Radix UI Dialog, Tailwind CSS, Lucide icons

**Spec:** `docs/superpowers/specs/2026-03-17-task-module-hierarchy-redesign.md`

---

### Task 1: Create TaskRunItem component

**Files:**

- Create: `apps/client/src/components/tasks/TaskRunItem.tsx`

This is a self-contained presentational component with no dependencies on other new code.

- [ ] **Step 1: Create TaskRunItem component**

```tsx
// apps/client/src/components/tasks/TaskRunItem.tsx
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { AgentTaskExecution, AgentTaskStatus } from "@/types/task";

const STATUS_COLORS: Record<AgentTaskStatus, string> = {
  in_progress: "bg-blue-500",
  upcoming: "bg-gray-400",
  paused: "bg-yellow-500",
  pending_action: "bg-orange-500",
  completed: "bg-green-500",
  failed: "bg-red-500",
  stopped: "bg-gray-500",
  timeout: "bg-red-400",
};

const TRIGGER_TYPE_KEYS: Record<string, string> = {
  manual: "historyTab.manual",
  interval: "historyTab.interval",
  schedule: "historyTab.schedule",
  channel_message: "historyTab.channelMessage",
  retry: "historyTab.retry",
};

interface TaskRunItemProps {
  execution: AgentTaskExecution;
  isSelected: boolean;
  onClick: () => void;
}

export function TaskRunItem({
  execution,
  isSelected,
  onClick,
}: TaskRunItemProps) {
  const { t } = useTranslation("tasks");

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-2 py-1.5 rounded-md border transition-colors",
        isSelected
          ? "border-primary bg-accent"
          : "border-transparent hover:bg-muted/50",
      )}
    >
      {/* Line 1: status dot + version + timestamp */}
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            "inline-block w-1.5 h-1.5 rounded-full shrink-0",
            STATUS_COLORS[execution.status] ?? "bg-gray-400",
          )}
        />
        <span className="text-xs font-medium">v{execution.taskVersion}</span>
        {execution.startedAt && (
          <span className="text-[10px] text-muted-foreground ml-auto">
            {new Date(execution.startedAt).toLocaleString()}
          </span>
        )}
      </div>
      {/* Line 2: trigger type + duration */}
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5 pl-3">
        {execution.triggerType && (
          <span>
            {TRIGGER_TYPE_KEYS[execution.triggerType]
              ? t(TRIGGER_TYPE_KEYS[execution.triggerType])
              : execution.triggerType}
          </span>
        )}
        {execution.duration != null && execution.duration > 0 && (
          <span>{execution.duration}s</span>
        )}
      </div>
    </button>
  );
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd apps/client && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors related to TaskRunItem.tsx

- [ ] **Step 3: Commit**

```bash
git add apps/client/src/components/tasks/TaskRunItem.tsx
git commit -m "feat(tasks): add TaskRunItem component for inline run sub-items"
```

---

### Task 2: Create TaskSettingsDialog component

**Files:**

- Create: `apps/client/src/components/tasks/TaskSettingsDialog.tsx`
- Reference (read only): `apps/client/src/components/tasks/TaskSettingsTab.tsx`
- Reference (read only): `apps/client/src/components/tasks/CreateTaskDialog.tsx` (for Dialog pattern)

Wraps the existing TaskSettingsTab in a Radix Dialog modal.

- [ ] **Step 1: Create TaskSettingsDialog**

```tsx
// apps/client/src/components/tasks/TaskSettingsDialog.tsx
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TaskSettingsTab } from "./TaskSettingsTab";
import type { AgentTaskDetail } from "@/types/task";

interface TaskSettingsDialogProps {
  task: AgentTaskDetail | null;
  open: boolean;
  onClose: () => void;
  onDeleted: () => void;
}

export function TaskSettingsDialog({
  task,
  open,
  onClose,
  onDeleted,
}: TaskSettingsDialogProps) {
  const { t } = useTranslation("tasks");

  if (!task) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t("settingsTab.title", "Task Settings")}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="flex-1 min-h-0 pr-4">
          <TaskSettingsTab task={task} onClose={onDeleted} />
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd apps/client && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors related to TaskSettingsDialog.tsx

- [ ] **Step 3: Commit**

```bash
git add apps/client/src/components/tasks/TaskSettingsDialog.tsx
git commit -m "feat(tasks): add TaskSettingsDialog modal wrapper"
```

---

### Task 3: Rewrite TaskCard with expand/collapse and inline Runs

**Files:**

- Modify: `apps/client/src/components/tasks/TaskCard.tsx`

The card becomes an expandable container. It receives runs data, expand state, and callbacks from the parent.

- [ ] **Step 1: Rewrite TaskCard**

Replace the entire content of `apps/client/src/components/tasks/TaskCard.tsx` with:

```tsx
import { useState, type KeyboardEvent, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, ChevronDown, Settings, Coins } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMessageTime } from "@/lib/date-utils";
import { TaskRunItem } from "./TaskRunItem";
import type {
  AgentTask,
  AgentTaskExecution,
  AgentTaskStatus,
} from "@/types/task";

const STATUS_COLORS: Record<AgentTaskStatus, string> = {
  in_progress: "bg-blue-500",
  upcoming: "bg-gray-400",
  paused: "bg-yellow-500",
  pending_action: "bg-orange-500",
  completed: "bg-green-500",
  failed: "bg-red-500",
  stopped: "bg-gray-500",
  timeout: "bg-red-400",
};

const SHOW_TOKEN_STATUSES: AgentTaskStatus[] = [
  "in_progress",
  "completed",
  "failed",
  "paused",
  "pending_action",
  "stopped",
  "timeout",
];

const DEFAULT_VISIBLE_RUNS = 3;

interface TaskCardProps {
  task: AgentTask;
  isExpanded: boolean;
  isActive: boolean;
  selectedRunId: string | null;
  executions: AgentTaskExecution[];
  onToggleExpand: () => void;
  onSelectRun: (runId: string) => void;
  onOpenSettings: () => void;
}

function StatusIndicator({ status }: { status: AgentTaskStatus }) {
  const { t } = useTranslation("tasks");
  return (
    <span
      className={cn(
        "inline-block w-2 h-2 rounded-full shrink-0",
        STATUS_COLORS[status] ?? "bg-gray-400",
      )}
      aria-label={t(`status.${status}`)}
    />
  );
}

export function TaskCard({
  task,
  isExpanded,
  isActive,
  selectedRunId,
  executions,
  onToggleExpand,
  onSelectRun,
  onOpenSettings,
}: TaskCardProps) {
  const { t } = useTranslation("tasks");
  const [showAllRuns, setShowAllRuns] = useState(false);

  const showTokens =
    SHOW_TOKEN_STATUSES.includes(task.status) &&
    task.tokenUsage != null &&
    task.tokenUsage > 0;

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggleExpand();
    }
  };

  const handleSettingsClick = (e: MouseEvent) => {
    e.stopPropagation();
    onOpenSettings();
  };

  const visibleRuns = showAllRuns
    ? executions
    : executions.slice(0, DEFAULT_VISIBLE_RUNS);
  const hiddenCount = executions.length - DEFAULT_VISIBLE_RUNS;

  return (
    <div
      className={cn(
        "rounded-lg border bg-card transition-colors",
        isActive && "border-primary",
        !isActive && "hover:border-primary/50",
      )}
    >
      {/* Task header — clickable to expand/collapse */}
      <div
        onClick={onToggleExpand}
        role="button"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="p-3 cursor-pointer group"
      >
        <div className="flex items-center gap-2">
          {/* Expand/collapse arrow */}
          <span className="text-muted-foreground shrink-0">
            {isExpanded ? (
              <ChevronDown size={14} />
            ) : (
              <ChevronRight size={14} />
            )}
          </span>
          <StatusIndicator status={task.status} />
          <span className="font-medium text-sm truncate flex-1">
            {task.title}
          </span>
          {/* Settings gear — visible on hover */}
          <button
            onClick={handleSettingsClick}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted"
            aria-label={t("settingsTab.title", "Settings")}
          >
            <Settings size={14} className="text-muted-foreground" />
          </button>
        </div>
        {task.description && (
          <p className="text-xs text-muted-foreground mt-1 truncate pl-6">
            {task.description}
          </p>
        )}
        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1.5 pl-6">
          <span>{formatMessageTime(new Date(task.createdAt))}</span>
          {showTokens && (
            <span className="inline-flex items-center gap-1">
              <Coins size={12} />
              {t("detail.tokenCount", { count: task.tokenUsage })}
            </span>
          )}
        </div>
      </div>

      {/* Expanded: Run list */}
      {isExpanded && (
        <div className="px-3 pb-3">
          <div
            className={cn(
              "ml-3 pl-2 border-l-2 border-border space-y-0.5",
              showAllRuns &&
                executions.length > 6 &&
                "max-h-75 overflow-y-auto",
            )}
          >
            {executions.length === 0 ? (
              <p className="text-xs text-muted-foreground py-1">
                {t("historyTab.empty", "No runs yet")}
              </p>
            ) : (
              <>
                {visibleRuns.map((exec) => (
                  <TaskRunItem
                    key={exec.id}
                    execution={exec}
                    isSelected={exec.id === selectedRunId}
                    onClick={() => onSelectRun(exec.id)}
                  />
                ))}
                {!showAllRuns && hiddenCount > 0 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowAllRuns(true);
                    }}
                    className="w-full text-xs text-muted-foreground hover:text-foreground py-1 transition-colors"
                  >
                    {t("historyTab.showMore", {
                      count: hiddenCount,
                      defaultValue: `↓ ${hiddenCount} earlier runs`,
                    })}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

Note: When `showAllRuns` is true and there are many runs (>6), the run list container gets `max-h-75 overflow-y-auto` for internal scrolling per spec. The `border-l-2` left border visually nests runs under the task.

- [ ] **Step 2: Verify the file compiles**

Run: `cd apps/client && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: TaskCard.tsx may show errors because TaskList hasn't been updated yet to pass the new props. That's expected — we'll fix it in Task 4.

- [ ] **Step 3: Commit**

```bash
git add apps/client/src/components/tasks/TaskCard.tsx
git commit -m "feat(tasks): rewrite TaskCard with expand/collapse and inline runs"
```

---

### Task 4: Rewrite TaskRightPanel (remove tabs)

**Files:**

- Modify: `apps/client/src/components/tasks/TaskRightPanel.tsx`

Remove tabs, render TaskRunTab directly.

- [ ] **Step 1: Rewrite TaskRightPanel**

Replace the entire content of `apps/client/src/components/tasks/TaskRightPanel.tsx` with:

```tsx
import { useTranslation } from "react-i18next";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TaskRunTab } from "./TaskRunTab";
import type { AgentTaskExecution } from "@/types/task";

interface TaskRightPanelProps {
  taskId: string;
  selectedRun: AgentTaskExecution | null;
}

export function TaskRightPanel({ taskId, selectedRun }: TaskRightPanelProps) {
  const { t } = useTranslation("tasks");

  return (
    <div className="w-65 border-l border-border bg-background flex flex-col h-full shrink-0">
      <div className="px-3 py-2 border-b border-border shrink-0">
        <span className="text-sm font-semibold">{t("tabs.run", "Run")}</span>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3">
          <TaskRunTab taskId={taskId} execution={selectedRun} />
        </div>
      </ScrollArea>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/client/src/components/tasks/TaskRightPanel.tsx
git commit -m "refactor(tasks): simplify TaskRightPanel to run-only (no tabs)"
```

---

### Task 5: Rewrite TaskList (new state management + wiring)

**Files:**

- Modify: `apps/client/src/components/tasks/TaskList.tsx`

This is the main integration task. Changes:

- Remove `selectedTaskId` (derive from selectedRunId), remove `rightPanelTab`
- Add `expandedTaskIds`, `showSettingsTaskId`
- Fetch executions per expanded task
- Wire new TaskCard props
- Add TaskSettingsDialog

- [ ] **Step 1: Rewrite TaskList**

Replace the entire content of `apps/client/src/components/tasks/TaskList.tsx` with:

```tsx
import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { Loader2, ListChecks, Plus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { tasksApi } from "@/services/api/tasks";
import { TaskCard } from "./TaskCard";
import { TaskChatArea } from "./TaskChatArea";
import { TaskRightPanel } from "./TaskRightPanel";
import { CreateTaskDialog } from "./CreateTaskDialog";
import { TaskSettingsDialog } from "./TaskSettingsDialog";
import type { AgentTask, AgentTaskStatus } from "@/types/task";

const STATUS_FILTERS: Record<string, AgentTaskStatus[]> = {
  active: ["in_progress", "paused", "pending_action"],
  upcoming: ["upcoming"],
  finished: ["completed", "failed", "stopped", "timeout"],
};

const TAB_KEYS = ["all", "active", "upcoming", "finished"] as const;
type TabKey = (typeof TAB_KEYS)[number];

const ACTIVE_STATUSES: AgentTaskStatus[] = [
  "in_progress",
  "pending_action",
  "paused",
];

interface TaskListProps {
  botId?: string;
}

export function TaskList({ botId }: TaskListProps) {
  const { t } = useTranslation("tasks");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  // activeTaskId tracks which task owns the selected run
  // (set alongside selectedRunId to avoid needing cross-task execution lookups)
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(
    new Set(),
  );
  const [showSettingsTaskId, setShowSettingsTaskId] = useState<string | null>(
    null,
  );
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [tab, setTab] = useState<TabKey>("all");

  // Fetch all tasks
  const { data: allTasks = [], isLoading } = useQuery({
    queryKey: ["tasks", { botId }],
    queryFn: () => tasksApi.list({ botId }),
  });

  // Filter tasks by selected tab
  const filteredTasks = useMemo(() => {
    if (tab === "all") return allTasks;
    const statuses = STATUS_FILTERS[tab];
    return allTasks.filter((task) => statuses.includes(task.status));
  }, [allTasks, tab]);

  // Fetch selected task detail (for chat area + right panel)
  const { data: selectedTask } = useQuery({
    queryKey: ["task", activeTaskId],
    queryFn: () => tasksApi.getById(activeTaskId!),
    enabled: !!activeTaskId,
    refetchInterval: (query) =>
      query.state.data?.currentExecution?.execution.taskcastTaskId
        ? 30000
        : 5000,
  });

  // Derive active execution
  const activeExecution = selectedTask?.currentExecution?.execution ?? null;

  // Fetch executions for the active task (for selectedRun lookup)
  const { data: activeTaskExecutions = [] } = useQuery({
    queryKey: ["task-executions", activeTaskId],
    queryFn: () => tasksApi.getExecutions(activeTaskId!),
    enabled: !!activeTaskId,
    refetchInterval: 5000,
  });

  const selectedRun = useMemo(() => {
    if (!selectedRunId) return null;
    if (activeExecution?.id === selectedRunId) return activeExecution;
    return activeTaskExecutions.find((e) => e.id === selectedRunId) ?? null;
  }, [selectedRunId, activeExecution, activeTaskExecutions]);

  const isViewingHistory =
    !!selectedRun && !!activeExecution && selectedRunId !== activeExecution.id;

  // Handle expanding a task
  const handleToggleExpand = useCallback(
    (taskId: string) => {
      setExpandedTaskIds((prev) => {
        const next = new Set(prev);
        if (next.has(taskId)) {
          next.delete(taskId);
          // If collapsing the task that owns the selected run, deselect
          if (activeTaskId === taskId) {
            setSelectedRunId(null);
            setActiveTaskId(null);
          }
        } else {
          next.add(taskId);
          // Auto-select will happen via ExpandableTaskCard's useEffect
        }
        return next;
      });
    },
    [activeTaskId],
  );

  // Handle run selection — stable ref to avoid re-triggering effects
  const handleSelectRun = useCallback((taskId: string, runId: string) => {
    setSelectedRunId(runId);
    setActiveTaskId(taskId);
  }, []);

  const handleReturnToCurrent = useCallback(() => {
    if (activeExecution) {
      setSelectedRunId(activeExecution.id);
    } else if (activeTaskExecutions.length > 0) {
      setSelectedRunId(activeTaskExecutions[0].id);
    }
  }, [activeExecution, activeTaskExecutions]);

  const handleSettingsDeleted = useCallback(() => {
    const deletedTaskId = showSettingsTaskId;
    setShowSettingsTaskId(null);
    // If the deleted task was the active one, clear selection
    if (activeTaskId === deletedTaskId) {
      setSelectedRunId(null);
      setActiveTaskId(null);
    }
  }, [activeTaskId, showSettingsTaskId]);

  // Fetch task detail for settings dialog (needs AgentTaskDetail)
  const { data: settingsTaskDetail } = useQuery({
    queryKey: ["task", showSettingsTaskId],
    queryFn: () => tasksApi.getById(showSettingsTaskId!),
    enabled: !!showSettingsTaskId,
  });

  return (
    <div className="flex h-full">
      {/* Left column: task list */}
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
        {!isLoading && allTasks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 gap-2">
            <ListChecks size={24} className="text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">{t("noTasks")}</p>
          </div>
        )}

        {/* Task list */}
        {!isLoading && allTasks.length > 0 && (
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
              {filteredTasks.length === 0 ? (
                <div className="flex items-center justify-center py-8">
                  <p className="text-xs text-muted-foreground">
                    {t("noTasks")}
                  </p>
                </div>
              ) : (
                <div className="px-2 py-1 space-y-1">
                  {filteredTasks.map((task) => (
                    <ExpandableTaskCard
                      key={task.id}
                      task={task}
                      isExpanded={expandedTaskIds.has(task.id)}
                      isActive={activeTaskId === task.id}
                      selectedRunId={selectedRunId}
                      onToggleExpand={() => handleToggleExpand(task.id)}
                      onSelectRun={handleSelectRun}
                      onOpenSettings={() => setShowSettingsTaskId(task.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Center + Right: shown when a run is selected */}
      {activeTaskId && selectedTask && (
        <>
          <TaskChatArea
            task={selectedTask}
            selectedRun={selectedRun}
            activeExecution={activeExecution}
            isViewingHistory={isViewingHistory}
            onReturnToCurrent={handleReturnToCurrent}
          />
          <TaskRightPanel taskId={activeTaskId} selectedRun={selectedRun} />
        </>
      )}

      <CreateTaskDialog
        isOpen={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
      />

      <TaskSettingsDialog
        task={settingsTaskDetail ?? null}
        open={!!showSettingsTaskId}
        onClose={() => setShowSettingsTaskId(null)}
        onDeleted={handleSettingsDeleted}
      />
    </div>
  );
}

// --- Inner component: fetches executions for each expanded task ---

interface ExpandableTaskCardProps {
  task: AgentTask;
  isExpanded: boolean;
  isActive: boolean;
  selectedRunId: string | null;
  onToggleExpand: () => void;
  onSelectRun: (taskId: string, runId: string) => void;
  onOpenSettings: () => void;
}

function ExpandableTaskCard({
  task,
  isExpanded,
  isActive,
  selectedRunId,
  onToggleExpand,
  onSelectRun,
  onOpenSettings,
}: ExpandableTaskCardProps) {
  // Fetch executions only when expanded
  const { data: executions = [] } = useQuery({
    queryKey: ["task-executions", task.id],
    queryFn: () => tasksApi.getExecutions(task.id),
    enabled: isExpanded,
    // Poll only for the active (selected) task
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
      onSelectRunRef.current(task.id, activeRun?.id ?? executions[0].id);
      setHasAutoSelected(true);
    }
    if (!isExpanded) {
      setHasAutoSelected(false);
    }
  }, [isExpanded, executions, hasAutoSelected, task.id]);

  // Stable callback for TaskCard — wraps taskId into onSelectRun
  const handleSelectRun = useCallback(
    (runId: string) => onSelectRun(task.id, runId),
    [onSelectRun, task.id],
  );

  return (
    <TaskCard
      task={task}
      isExpanded={isExpanded}
      isActive={isActive}
      selectedRunId={selectedRunId}
      executions={executions}
      onToggleExpand={onToggleExpand}
      onSelectRun={handleSelectRun}
      onOpenSettings={onOpenSettings}
    />
  );
}
```

- [ ] **Step 2: Verify the full app compiles**

Run: `cd apps/client && npx tsc --noEmit --pretty 2>&1 | head -40`
Expected: No errors. If there are errors, fix them.

- [ ] **Step 3: Commit**

```bash
git add apps/client/src/components/tasks/TaskList.tsx
git commit -m "feat(tasks): rewrite TaskList with expandable tasks and settings dialog"
```

---

### Task 6: Delete TaskHistoryTab

**Files:**

- Delete: `apps/client/src/components/tasks/TaskHistoryTab.tsx`

This file is no longer imported by anything after the TaskRightPanel rewrite.

- [ ] **Step 1: Verify no remaining imports**

Run: `grep -r "TaskHistoryTab" apps/client/src/ --include="*.tsx" --include="*.ts"`
Expected: Only the file itself and possibly an index barrel export. No imports from other components.

- [ ] **Step 2: Delete the file**

```bash
rm apps/client/src/components/tasks/TaskHistoryTab.tsx
```

- [ ] **Step 3: Verify compilation**

Run: `cd apps/client && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add -u apps/client/src/components/tasks/TaskHistoryTab.tsx
git commit -m "refactor(tasks): remove TaskHistoryTab (absorbed into TaskCard)"
```

---

### Task 7: Manual testing and polish

**Files:**

- Possibly modify: `apps/client/src/components/tasks/TaskCard.tsx`
- Possibly modify: `apps/client/src/components/tasks/TaskList.tsx`

- [ ] **Step 1: Start the dev server**

Run: `pnpm dev:client`

- [ ] **Step 2: Verify the following interactions manually**

1. Left panel shows tasks with ▶ collapse arrows
2. Click a task → it expands showing up to 3 runs with the left border line
3. The most recent/active run is auto-selected, chat + right panel update
4. Click a different run → chat and right panel switch
5. Hover a task → ⚙ gear appears; click it → settings modal opens
6. Settings modal works: bot assignment, triggers, document, delete
7. Deleting a task from settings modal → modal closes, selection clears
8. Multiple tasks can be expanded simultaneously
9. Collapse a task whose run is selected → chat + right panel clear
10. "N earlier runs" link appears when > 3 runs; clicking it shows all
11. Right panel shows run details directly (no tabs)
12. Filter tabs (All/In progress/Upcoming/Finished) still work

- [ ] **Step 3: Fix any issues found during testing**

Address styling, spacing, or interaction bugs.

- [ ] **Step 4: Final commit**

```bash
git add -A apps/client/src/components/tasks/
git commit -m "fix(tasks): polish task hierarchy redesign after manual testing"
```
