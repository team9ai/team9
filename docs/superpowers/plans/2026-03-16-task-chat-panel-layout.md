# Task Chat Panel Layout Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the tasks module from a single detail panel into a three-column layout (task list | chat | detail), reusing the existing `ChannelView` component for task channel conversations.

**Architecture:** The task channel created by executor on each run is a standard IM channel (`type='task'`). We pass its `channelId` directly to the existing `ChannelView` component in the center column. The right-side detail panel is stripped of chat-related code (ExecutionTimeline, message input) and becomes a pure configuration/status panel. When no execution exists (upcoming tasks), the center column shows a placeholder.

**Tech Stack:** React, TypeScript, TanStack React Query, ChannelView (existing IM component), Zustand

---

## File Structure

| File                                                       | Action | Responsibility                                                        |
| ---------------------------------------------------------- | ------ | --------------------------------------------------------------------- |
| `apps/client/src/components/tasks/TaskList.tsx`            | Modify | Three-column layout: task cards \| chat \| detail                     |
| `apps/client/src/components/tasks/TaskChatPlaceholder.tsx` | Create | Empty state for center column when no channel exists                  |
| `apps/client/src/components/tasks/TaskDetailPanel.tsx`     | Modify | Remove message input, sentMessages state, shrink to config-only panel |
| `apps/client/src/components/tasks/TaskBasicInfoTab.tsx`    | Modify | Remove ExecutionTimeline, userMessages prop                           |
| `apps/client/src/components/tasks/TaskRunsTab.tsx`         | Modify | Remove userMessages prop                                              |
| `apps/client/src/components/tasks/RunDetailView.tsx`       | Modify | Remove userMessages prop                                              |

---

## Chunk 1: Create TaskChatPlaceholder and Refactor TaskList Layout

### Task 1: Create TaskChatPlaceholder component

**Files:**

- Create: `apps/client/src/components/tasks/TaskChatPlaceholder.tsx`

- [ ] **Step 1: Create the placeholder component**

```tsx
import { useTranslation } from "react-i18next";
import { MessageSquare } from "lucide-react";

export function TaskChatPlaceholder() {
  const { t } = useTranslation("tasks");

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
      <MessageSquare size={40} strokeWidth={1.5} className="opacity-50" />
      <p className="text-sm">{t("chat.placeholder")}</p>
    </div>
  );
}
```

- [ ] **Step 2: Add i18n key for the placeholder text**

In the tasks translation file, add under an appropriate key:

```json
"chat": {
  "placeholder": "Start the task to chat with the bot"
}
```

Find the tasks i18n file (likely `apps/client/src/locales/en/tasks.json` or similar) and add the key.

- [ ] **Step 3: Commit**

```bash
git add apps/client/src/components/tasks/TaskChatPlaceholder.tsx
git commit -m "feat(tasks): add TaskChatPlaceholder for empty chat state"
```

### Task 2: Refactor TaskList to three-column layout

**Files:**

- Modify: `apps/client/src/components/tasks/TaskList.tsx`

The current layout is:

```
<div className="flex h-full">
  <div>task cards</div>
  {selectedTaskId && <TaskDetailPanel />}
</div>
```

Change to:

```
<div className="flex h-full">
  <div>task cards</div>
  {selectedTaskId && (
    <>
      <center column: ChannelView or placeholder>
      <TaskDetailPanel />
    </>
  )}
</div>
```

- [ ] **Step 1: Update TaskList to fetch task detail for channel info**

We need the selected task's `currentExecution.execution.channelId` to pass to `ChannelView`. The detail is already fetched inside `TaskDetailPanel`, but now `TaskList` needs it too for the center column. Two approaches:

**Chosen approach:** Lift the task detail query into `TaskList` and pass it down to both the chat area and `TaskDetailPanel`. This avoids duplicate queries.

- [ ] **Step 2: Implement the three-column layout**

```tsx
import { useMemo, useState } from "react";
import { Loader2, ListChecks } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { tasksApi } from "@/services/api/tasks";
import { cn } from "@/lib/utils";
import { TaskCard } from "./TaskCard";
import { TaskDetailPanel } from "./TaskDetailPanel";
import { TaskChatPlaceholder } from "./TaskChatPlaceholder";
import { ChannelView } from "@/components/channel/ChannelView";
import type { AgentTaskStatus } from "@/types/task";

const STATUS_GROUPS: Record<string, AgentTaskStatus[]> = {
  active: ["in_progress", "paused", "pending_action"],
  upcoming: ["upcoming"],
  finished: ["completed", "failed", "stopped", "timeout"],
};

const TAB_KEYS = ["all", "active", "upcoming", "finished"] as const;

type TabKey = (typeof TAB_KEYS)[number];

interface TaskListProps {
  botId?: string;
}

export function TaskList({ botId }: TaskListProps) {
  const [tab, setTab] = useState<TabKey>("all");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const { t } = useTranslation("tasks");

  const { data: allTasks = [], isLoading } = useQuery({
    queryKey: ["tasks", { botId }],
    queryFn: () => tasksApi.list({ botId }),
  });

  // Fetch selected task detail (for channelId)
  const { data: selectedTask } = useQuery({
    queryKey: ["task", selectedTaskId],
    queryFn: () => tasksApi.getById(selectedTaskId!),
    enabled: !!selectedTaskId,
  });

  const channelId = selectedTask?.currentExecution?.execution.channelId ?? null;

  const tasks = useMemo(
    () =>
      tab === "all"
        ? allTasks
        : allTasks.filter((task) => STATUS_GROUPS[tab].includes(task.status)),
    [allTasks, tab],
  );

  return (
    <div className="flex h-full">
      {/* Left column: task list */}
      <div className="flex flex-col w-[280px] shrink-0 min-w-0 h-full border-r border-border">
        {/* Filter tabs */}
        <div
          className="flex gap-1 px-3 py-2 border-b border-border"
          role="tablist"
        >
          {TAB_KEYS.map((key) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cn(
                "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                tab === key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent",
              )}
            >
              {t(`tabs.${key}`)}
            </button>
          ))}
        </div>

        {/* Task list */}
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && tasks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 gap-2">
            <ListChecks size={24} className="text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">{t("noTasks")}</p>
          </div>
        )}

        {!isLoading && tasks.length > 0 && (
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onClick={() => setSelectedTaskId(task.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Center column: chat */}
      {selectedTaskId && (
        <div className="flex-1 flex flex-col min-w-0 h-full">
          {channelId ? (
            <ChannelView key={channelId} channelId={channelId} />
          ) : (
            <TaskChatPlaceholder />
          )}
        </div>
      )}

      {/* Right column: detail panel */}
      {selectedTaskId && (
        <TaskDetailPanel
          taskId={selectedTaskId}
          onClose={() => setSelectedTaskId(null)}
        />
      )}
    </div>
  );
}
```

Key changes:

- Left column gets fixed `w-[280px]` and `border-r`
- Center column uses `flex-1` to fill remaining space
- `ChannelView` receives `channelId` from `selectedTask.currentExecution.execution.channelId`
- `key={channelId}` on `ChannelView` forces remount when execution changes (new channel)
- `TaskDetailPanel` stays on the right (already has `border-l` and `w-[400px]`)

- [ ] **Step 3: Commit**

```bash
git add apps/client/src/components/tasks/TaskList.tsx
git commit -m "feat(tasks): refactor TaskList to three-column layout with ChannelView"
```

---

## Chunk 2: Strip Chat Code from Detail Panel and Info Tab

### Task 3: Simplify TaskDetailPanel (remove chat code)

**Files:**

- Modify: `apps/client/src/components/tasks/TaskDetailPanel.tsx`

Remove:

- `useState` for `message`, `sentMessages`
- `useRef` for `sendingRef`
- `useCallback` for `handleSend`
- `useAppStore` import (only used for `user` in fake send)
- `Send` icon import
- `Textarea` import
- `TimelineUserMessage` type import
- `viewingActiveRun` state and `showMessageInput` logic
- The entire message input `<div>` at the bottom
- The `userMessages={sentMessages}` prop on `TaskBasicInfoTab`
- The `userMessages={sentMessages}` prop on `TaskRunsTab`
- The `onViewingChannelChange` prop on `TaskRunsTab`

The simplified component:

```tsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { tasksApi } from "@/services/api/tasks";
import { useExecutionStream } from "@/hooks/useExecutionStream";
import { TaskBasicInfoTab } from "./TaskBasicInfoTab";
import { TaskDocumentTab } from "./TaskDocumentTab";
import { TaskRunsTab } from "./TaskRunsTab";
import type { AgentTaskStatus } from "@/types/task";

const ACTIVE_STATUSES: AgentTaskStatus[] = [
  "in_progress",
  "pending_action",
  "paused",
];

interface TaskDetailPanelProps {
  taskId: string;
  onClose: () => void;
}

export function TaskDetailPanel({ taskId, onClose }: TaskDetailPanelProps) {
  const { t } = useTranslation("tasks");

  const {
    data: task,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => tasksApi.getById(taskId),
    refetchInterval: (query) =>
      query.state.data?.currentExecution?.execution.taskcastTaskId
        ? 30000
        : 5000,
  });

  const taskIsActive = task ? ACTIVE_STATUSES.includes(task.status) : false;

  useExecutionStream(
    taskId,
    task?.currentExecution?.execution.id,
    task?.currentExecution?.execution.taskcastTaskId,
    taskIsActive,
  );

  return (
    <div className="border-l bg-background flex flex-col h-full w-[400px]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <h3 className="text-sm font-semibold truncate">{t("detail.title")}</h3>
        <Button variant="ghost" size="icon-sm" onClick={onClose}>
          <X size={16} />
        </Button>
      </div>

      {/* Content */}
      {isLoading && (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {isError && (
        <div className="flex-1 flex items-center justify-center px-4">
          <p className="text-sm text-muted-foreground">
            {t("detail.loadError")}
          </p>
        </div>
      )}

      {task && !isLoading && (
        <Tabs
          defaultValue="info"
          className="flex-1 flex flex-col overflow-hidden"
        >
          <TabsList className="mx-4 mt-2 shrink-0">
            <TabsTrigger value="info">{t("tabs.info")}</TabsTrigger>
            <TabsTrigger value="document">{t("tabs.document")}</TabsTrigger>
            <TabsTrigger value="runs">{t("tabs.runs")}</TabsTrigger>
          </TabsList>
          <ScrollArea className="flex-1 min-h-0">
            <TabsContent value="info" className="p-4 mt-0">
              <TaskBasicInfoTab task={task} onClose={onClose} />
            </TabsContent>
            <TabsContent value="document" className="p-4 mt-0">
              <TaskDocumentTab task={task} />
            </TabsContent>
            <TabsContent value="runs" className="p-4 mt-0">
              <TaskRunsTab taskId={taskId} />
            </TabsContent>
          </ScrollArea>
        </Tabs>
      )}
    </div>
  );
}
```

- [ ] **Step 1: Apply the changes to TaskDetailPanel.tsx**

Replace the full file content with the simplified version above.

- [ ] **Step 2: Commit**

```bash
git add apps/client/src/components/tasks/TaskDetailPanel.tsx
git commit -m "refactor(tasks): remove chat code from TaskDetailPanel"
```

### Task 4: Remove ExecutionTimeline from TaskBasicInfoTab

**Files:**

- Modify: `apps/client/src/components/tasks/TaskBasicInfoTab.tsx`

Changes:

1. Remove `userMessages` from `TaskBasicInfoTabProps` interface
2. Remove `userMessages` param from destructured props
3. Remove the entire `ExecutionTimeline` section (the `{execution && ( <> <Separator /> ... <ExecutionTimeline /> </> )}` block)
4. Remove `ExecutionTimeline` and `TimelineUserMessage` imports
5. Remove `entries` query (`useQuery` for `task-execution-entries`)
6. Remove the second `useExecutionStream` call (the one inside this component — the parent `TaskDetailPanel` already has one)
7. Keep everything else: status badge, bot assignment, control buttons, triggers, interventions, finished banner

- [ ] **Step 1: Remove imports**

Remove these imports:

```tsx
import {
  ExecutionTimeline,
  type TimelineUserMessage,
} from "./ExecutionTimeline";
```

Remove `useExecutionStream` import.

- [ ] **Step 2: Remove userMessages from props**

Change interface:

```tsx
interface TaskBasicInfoTabProps {
  task: AgentTaskDetail;
  onClose: () => void;
}
```

Change destructuring:

```tsx
export function TaskBasicInfoTab({ task, onClose }: TaskBasicInfoTabProps) {
```

- [ ] **Step 3: Remove entries query and SSE hook**

Remove:

```tsx
const { data: entries = [] } = useQuery({
  queryKey: ["task-execution-entries", taskId, execution?.id],
  queryFn: () => tasksApi.getExecutionEntries(taskId, execution!.id),
  enabled: !!execution,
  refetchInterval: execution?.taskcastTaskId ? 30000 : 5000,
});

useExecutionStream(
  taskId,
  execution?.id,
  execution?.taskcastTaskId,
  !!execution &&
    ["in_progress", "pending_action", "paused"].includes(task.status),
);
```

- [ ] **Step 4: Remove ExecutionTimeline rendering block**

Remove the entire block starting after the interventions section:

```tsx
{
  /* Unified timeline */
}
<ExecutionTimeline
  entries={entries}
  taskId={taskId}
  userMessages={userMessages}
/>;
```

Keep the `<Separator />` before triggers, but remove the one before the timeline. Keep the interventions section as it belongs to the detail panel (actionable UI, not chat).

- [ ] **Step 5: Clean up unused imports**

After removing above code, check if `useExecutionStream` import is still needed. If not used anywhere in this file, remove it.

- [ ] **Step 6: Commit**

```bash
git add apps/client/src/components/tasks/TaskBasicInfoTab.tsx
git commit -m "refactor(tasks): remove ExecutionTimeline from TaskBasicInfoTab"
```

### Task 5: Remove userMessages from TaskRunsTab and RunDetailView

**Files:**

- Modify: `apps/client/src/components/tasks/TaskRunsTab.tsx`
- Modify: `apps/client/src/components/tasks/RunDetailView.tsx`

- [ ] **Step 1: Simplify TaskRunsTab props**

In `TaskRunsTab.tsx`:

- Remove `onViewingChannelChange` and `userMessages` from `TaskRunsTabProps`
- Remove `TimelineUserMessage` import
- Remove passing `userMessages` and `onChannelChange` to `RunDetailView`

```tsx
interface TaskRunsTabProps {
  taskId: string;
}

export function TaskRunsTab({ taskId }: TaskRunsTabProps) {
```

Update `RunDetailView` call:

```tsx
<RunDetailView
  taskId={taskId}
  executionId={selectedExecId}
  onBack={() => setSelectedExecId(null)}
/>
```

- [ ] **Step 2: Simplify RunDetailView props**

In `RunDetailView.tsx`:

- Remove `onChannelChange` and `userMessages` from props interface
- Remove `TimelineUserMessage` import
- Remove any `useEffect` that calls `onChannelChange`
- Remove passing `userMessages` to any child component

Read the file first to confirm exact changes needed.

- [ ] **Step 3: Commit**

```bash
git add apps/client/src/components/tasks/TaskRunsTab.tsx apps/client/src/components/tasks/RunDetailView.tsx
git commit -m "refactor(tasks): remove userMessages prop from TaskRunsTab and RunDetailView"
```
