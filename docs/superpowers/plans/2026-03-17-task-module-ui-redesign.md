# Task Module UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the task module frontend so that Chat follows the Run (not the Task), with a three-column layout: Task List | Chat | Right Panel (Run/Settings/History tabs).

**Architecture:** Refactor `TaskList` as the main container with three columns. Create `TaskChatArea` to wrap `ChannelView` with a custom top bar and contextual banners. Create `TaskRightPanel` with three tabs (Run, Settings, History). Remove `TaskDetailPanel`, `TaskBasicInfoTab`, and `RunDetailView` — their functionality is redistributed into the new components.

**Tech Stack:** React 19, TypeScript, TanStack React Query, Zustand, Radix UI (Tabs, Select, Badge, Button, Separator), Tailwind CSS, Lucide icons, i18next

**Spec:** `docs/superpowers/specs/2026-03-17-task-module-ui-redesign.md`

---

## File Structure

### Files to Create

| File                                                   | Responsibility                                                                                                    |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `apps/client/src/components/tasks/TaskChatArea.tsx`    | Wraps ChannelView with custom top bar (status, controls), contextual banners (history/finished), read-only states |
| `apps/client/src/components/tasks/TaskRightPanel.tsx`  | Three-tab container (Run / Settings / History)                                                                    |
| `apps/client/src/components/tasks/TaskRunTab.tsx`      | Run tab: status info, timeline, interventions                                                                     |
| `apps/client/src/components/tasks/TaskSettingsTab.tsx` | Settings tab: title, bot, triggers, document, delete                                                              |
| `apps/client/src/components/tasks/TaskHistoryTab.tsx`  | History tab: run list, click to switch selected run                                                               |

### Files to Modify

| File                                                       | Changes                                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------------- |
| `apps/client/src/components/channel/ChannelView.tsx`       | Add `hideHeader` and `readOnly` props                               |
| `apps/client/src/components/tasks/TaskList.tsx`            | Complete rewrite — new three-column layout with run selection state |
| `apps/client/src/components/tasks/TaskChatPlaceholder.tsx` | Add "Start" CTA button for upcoming tasks                           |

### Files to Remove

| File                                                    | Reason                                                                                |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `apps/client/src/components/tasks/TaskDetailPanel.tsx`  | Replaced by TaskRightPanel inline in TaskList                                         |
| `apps/client/src/components/tasks/TaskBasicInfoTab.tsx` | Split into TaskChatArea (controls) + TaskSettingsTab (config) + TaskRunTab (run info) |
| `apps/client/src/components/tasks/RunDetailView.tsx`    | Run details now shown in TaskRunTab                                                   |
| `apps/client/src/components/tasks/TaskRunsTab.tsx`      | Replaced by TaskHistoryTab                                                            |

### i18n Files to Update

| File                                       | Changes                                          |
| ------------------------------------------ | ------------------------------------------------ |
| `apps/client/public/locales/en/tasks.json` | Add new keys for chat area, history tab, banners |
| `apps/client/public/locales/zh/tasks.json` | Same keys in Chinese                             |

---

## Chunk 1: Foundation

### Task 1: Add `hideHeader` and `readOnly` props to ChannelView

**Files:**

- Modify: `apps/client/src/components/channel/ChannelView.tsx:41-51` (props interface)
- Modify: `apps/client/src/components/channel/ChannelView.tsx:326-396` (render logic)

- [ ] **Step 1: Update ChannelViewProps interface**

In `apps/client/src/components/channel/ChannelView.tsx`, add two optional props:

```typescript
interface ChannelViewProps {
  channelId: string;
  initialThreadId?: string;
  initialMessageId?: string;
  initialDraft?: string;
  previewChannel?: PublicChannelPreview;
  /** Hide the built-in ChannelHeader (for custom headers like TaskChatArea) */
  hideHeader?: boolean;
  /** Read-only mode: hides MessageInput, shows static bar instead */
  readOnly?: boolean;
}
```

- [ ] **Step 2: Update destructuring to include new props**

In the function signature (~line 57), add `hideHeader` and `readOnly`:

```typescript
export function ChannelView({
  channelId,
  initialThreadId,
  initialMessageId,
  initialDraft,
  previewChannel,
  hideHeader,
  readOnly,
}: ChannelViewProps) {
```

- [ ] **Step 3: Conditionally render ChannelHeader**

Replace line 332:

```typescript
// Before:
<ChannelHeader channel={channel} currentUserRole={currentUserRole} />

// After:
{!hideHeader && (
  <ChannelHeader channel={channel} currentUserRole={currentUserRole} />
)}
```

- [ ] **Step 4: Handle readOnly in message input section**

Replace lines 384-396:

```typescript
// Before:
{isPreviewMode ? (
  <JoinChannelPrompt ... />
) : (
  <MessageInput ... />
)}

// After:
{isPreviewMode ? (
  <JoinChannelPrompt
    channelId={channelId}
    channelName={channel.name || ""}
  />
) : readOnly ? (
  <div className="px-4 py-3 border-t border-border bg-muted/30 text-center">
    <span className="text-sm text-muted-foreground">
      {t("channel.readOnly", "Read-only")}
    </span>
  </div>
) : (
  <MessageInput
    channelId={channelId}
    onSend={handleSendMessage}
    disabled={sendMessage.isPending || showOverlay}
    initialDraft={initialDraft}
  />
)}
```

Check if `useTranslation` is already imported in ChannelView. If not, add `const { t } = useTranslation();` — or use a plain string since this is a simple label.

- [ ] **Step 5: Verify compilation**

Run: `cd /Users/jiangtao/Desktop/shenjingyuan/team9 && pnpm build:client 2>&1 | tail -20`
Expected: Build succeeds. Existing ChannelView usages (no new props passed) should work unchanged.

- [ ] **Step 6: Commit**

```bash
git add apps/client/src/components/channel/ChannelView.tsx
git commit -m "feat(tasks): add hideHeader and readOnly props to ChannelView"
```

---

### Task 2: Add i18n keys

**Files:**

- Modify: `apps/client/public/locales/en/tasks.json`
- Modify: `apps/client/public/locales/zh/tasks.json`

- [ ] **Step 1: Find and read existing i18n files**

Read both files to understand existing key structure:

- `apps/client/public/locales/en/tasks.json`
- `apps/client/public/locales/zh/tasks.json`

- [ ] **Step 2: Add new keys to English file**

Add the following keys (merge into existing structure):

```json
{
  "chatArea": {
    "viewingHistory": "Viewing historical run",
    "returnToCurrent": "Return to current run",
    "lastRunCompleted": "Last run completed",
    "lastRunFailed": "Last run failed",
    "lastRunStopped": "Last run stopped",
    "lastRunTimeout": "Last run timed out",
    "rerun": "Rerun",
    "readOnly": "Historical conversation (read-only)",
    "finishedReadOnly": "Last run conversation (read-only)",
    "start": "Start",
    "noRunsYet": "No runs yet. Start your first run!",
    "pause": "Pause",
    "resume": "Resume",
    "stop": "Stop"
  },
  "runTab": {
    "title": "Run Details",
    "status": "Status",
    "duration": "Duration",
    "triggerType": "Trigger",
    "taskVersion": "Task Version",
    "tokenUsage": "Token Usage",
    "timeline": "Timeline",
    "noExecution": "No execution selected"
  },
  "settingsTab": {
    "title": "Settings",
    "taskTitle": "Title",
    "taskDescription": "Description",
    "deleteConfirm": "Are you sure you want to delete this task? This action cannot be undone."
  },
  "historyTab": {
    "title": "History",
    "current": "Current",
    "empty": "No runs yet",
    "manual": "Manual",
    "interval": "Interval",
    "schedule": "Schedule",
    "channelMessage": "Channel Message",
    "retry": "Retry"
  },
  "tabs": {
    "run": "Run",
    "settings": "Settings",
    "history": "History"
  }
}
```

- [ ] **Step 3: Add corresponding Chinese keys**

```json
{
  "chatArea": {
    "viewingHistory": "正在查看历史运行",
    "returnToCurrent": "返回当前运行",
    "lastRunCompleted": "上次运行已完成",
    "lastRunFailed": "上次运行失败",
    "lastRunStopped": "上次运行已停止",
    "lastRunTimeout": "上次运行超时",
    "rerun": "重新运行",
    "readOnly": "历史对话（只读）",
    "finishedReadOnly": "上次运行的对话（只读）",
    "start": "开始",
    "noRunsYet": "还没有运行记录，开始你的第一次运行吧！",
    "pause": "暂停",
    "resume": "恢复",
    "stop": "停止"
  },
  "runTab": {
    "title": "运行详情",
    "status": "状态",
    "duration": "耗时",
    "triggerType": "触发方式",
    "taskVersion": "任务版本",
    "tokenUsage": "Token 用量",
    "timeline": "时间线",
    "noExecution": "未选择执行"
  },
  "settingsTab": {
    "title": "设置",
    "taskTitle": "标题",
    "taskDescription": "描述",
    "deleteConfirm": "确定要删除此任务吗？此操作无法撤销。"
  },
  "historyTab": {
    "title": "历史",
    "current": "当前",
    "empty": "暂无运行记录",
    "manual": "手动",
    "interval": "定时",
    "schedule": "计划",
    "channelMessage": "频道消息",
    "retry": "重试"
  },
  "tabs": {
    "run": "运行",
    "settings": "设置",
    "history": "历史"
  }
}
```

Note: Merge these into the existing files. Do NOT overwrite existing keys — some existing keys like `status.*`, `detail.*`, `runs.*` may still be used by reused components (`ExecutionTimeline`, `TaskInterventionCard`, `TaskTriggersTab`, `TaskDocumentTab`). Keep all existing keys intact.

- [ ] **Step 4: Commit**

```bash
git add apps/client/public/locales/en/tasks.json apps/client/public/locales/zh/tasks.json
git commit -m "feat(tasks): add i18n keys for task module UI redesign"
```

---

## Chunk 2: New Components (Independent)

### Task 3: Create TaskChatArea

**Files:**

- Create: `apps/client/src/components/tasks/TaskChatArea.tsx`

This component wraps `ChannelView` with a custom top bar and contextual banners.

- [ ] **Step 1: Create TaskChatArea.tsx**

```typescript
import { useTranslation } from "react-i18next";
import {
  Play,
  Pause,
  Square,
  PlayCircle,
  RotateCcw,
  History,
  ArrowLeft,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChannelView } from "@/components/channel/ChannelView";
import { TaskChatPlaceholder } from "./TaskChatPlaceholder";
import { ManualTriggerDialog } from "./ManualTriggerDialog";
import { tasksApi } from "@/services/api/tasks";
import { useState } from "react";
import type {
  AgentTaskStatus,
  AgentTaskDetail,
  AgentTaskExecution,
} from "@/types/task";

const STATUS_BADGE_VARIANT: Record<
  AgentTaskStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  in_progress: "default",
  upcoming: "secondary",
  paused: "outline",
  pending_action: "default",
  completed: "secondary",
  failed: "destructive",
  stopped: "outline",
  timeout: "destructive",
};

const FINISHED_BANNER_CONFIG: Partial<
  Record<AgentTaskStatus, { key: string; bgClass: string; textClass: string }>
> = {
  completed: {
    key: "lastRunCompleted",
    bgClass: "bg-green-500/10 border-green-500/20",
    textClass: "text-green-600 dark:text-green-400",
  },
  failed: {
    key: "lastRunFailed",
    bgClass: "bg-red-500/10 border-red-500/20",
    textClass: "text-red-600 dark:text-red-400",
  },
  stopped: {
    key: "lastRunStopped",
    bgClass: "bg-gray-500/10 border-gray-500/20",
    textClass: "text-gray-600 dark:text-gray-400",
  },
  timeout: {
    key: "lastRunTimeout",
    bgClass: "bg-orange-500/10 border-orange-500/20",
    textClass: "text-orange-600 dark:text-orange-400",
  },
};

interface TaskChatAreaProps {
  task: AgentTaskDetail;
  selectedRun: AgentTaskExecution | null;
  activeExecution: AgentTaskExecution | null;
  isViewingHistory: boolean;
  onReturnToCurrent: () => void;
}

export function TaskChatArea({
  task,
  selectedRun,
  activeExecution,
  isViewingHistory,
  onReturnToCurrent,
}: TaskChatAreaProps) {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();
  const [showStartDialog, setShowStartDialog] = useState(false);

  const isReadOnly = !activeExecution || isViewingHistory;
  const channelId = selectedRun?.channelId ?? null;
  const displayStatus = selectedRun?.status ?? task.status;

  // Control mutations
  const pauseMutation = useMutation({
    mutationFn: () => tasksApi.pause(task.id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["task", task.id] }),
  });
  const resumeMutation = useMutation({
    mutationFn: () => tasksApi.resume(task.id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["task", task.id] }),
  });
  const stopMutation = useMutation({
    mutationFn: () => tasksApi.stop(task.id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["task", task.id] }),
  });
  const restartMutation = useMutation({
    mutationFn: () => tasksApi.restart(task.id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["task", task.id] }),
  });

  const isMutating =
    pauseMutation.isPending ||
    resumeMutation.isPending ||
    stopMutation.isPending ||
    restartMutation.isPending;

  // No channel — show placeholder
  if (!channelId && !selectedRun) {
    return (
      <div className="flex-1 flex flex-col min-w-0 h-full">
        {/* Top bar even with no run */}
        <div className="px-4 py-2 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold truncate">{task.title}</span>
            <Badge
              variant={STATUS_BADGE_VARIANT[task.status]}
              className="text-xs"
            >
              {t(`status.${task.status}`)}
            </Badge>
          </div>
          {task.status === "upcoming" && (
            <Button
              variant="default"
              size="sm"
              disabled={isMutating}
              onClick={() => setShowStartDialog(true)}
            >
              <Play size={14} />
              {t("chatArea.start")}
            </Button>
          )}
        </div>
        <TaskChatPlaceholder />
        <ManualTriggerDialog
          taskId={task.id}
          isOpen={showStartDialog}
          onClose={() => setShowStartDialog(false)}
        />
      </div>
    );
  }

  const finishedConfig =
    !isViewingHistory && !activeExecution && selectedRun
      ? FINISHED_BANNER_CONFIG[selectedRun.status]
      : null;

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full">
      {/* Custom top bar */}
      <div className="px-4 py-2 border-b border-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold truncate">{task.title}</span>
          <Badge
            variant={STATUS_BADGE_VARIANT[displayStatus]}
            className="text-xs shrink-0"
          >
            {t(`status.${displayStatus}`)}
          </Badge>
          {selectedRun && (
            <span className="text-xs text-muted-foreground shrink-0">
              v{selectedRun.taskVersion}
              {selectedRun.tokenUsage > 0 &&
                ` · ${selectedRun.tokenUsage} tokens`}
              {selectedRun.duration != null &&
                selectedRun.duration > 0 &&
                ` · ${selectedRun.duration}s`}
            </span>
          )}
        </div>
        {/* Control buttons */}
        <div className="flex gap-1 shrink-0">
          {task.status === "in_progress" && !isViewingHistory && (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={isMutating}
                onClick={() => pauseMutation.mutate()}
              >
                <Pause size={14} />
                {t("chatArea.pause")}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={isMutating}
                onClick={() => stopMutation.mutate()}
              >
                <Square size={14} />
                {t("chatArea.stop")}
              </Button>
            </>
          )}
          {task.status === "paused" && !isViewingHistory && (
            <>
              <Button
                variant="default"
                size="sm"
                disabled={isMutating}
                onClick={() => resumeMutation.mutate()}
              >
                <PlayCircle size={14} />
                {t("chatArea.resume")}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={isMutating}
                onClick={() => stopMutation.mutate()}
              >
                <Square size={14} />
                {t("chatArea.stop")}
              </Button>
            </>
          )}
          {task.status === "pending_action" && !isViewingHistory && (
            <Button
              variant="destructive"
              size="sm"
              disabled={isMutating}
              onClick={() => stopMutation.mutate()}
            >
              <Square size={14} />
              {t("chatArea.stop")}
            </Button>
          )}
          {task.status === "upcoming" && !isViewingHistory && (
            <Button
              variant="default"
              size="sm"
              disabled={isMutating}
              onClick={() => setShowStartDialog(true)}
            >
              <Play size={14} />
              {t("chatArea.start")}
            </Button>
          )}
        </div>
      </div>

      {/* History viewing banner */}
      {isViewingHistory && selectedRun && (
        <div className="px-4 py-2 bg-blue-500/10 border-b border-blue-500/20 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-sm">
            <History size={14} className="text-blue-500" />
            <span className="text-blue-600 dark:text-blue-400">
              {t("chatArea.viewingHistory")}
            </span>
            <span className="text-xs text-muted-foreground">
              {selectedRun.startedAt &&
                new Date(selectedRun.startedAt).toLocaleString()}
              {" · "}
              {t(`status.${selectedRun.status}`)}
              {" · v"}
              {selectedRun.taskVersion}
            </span>
          </div>
          <Button variant="outline" size="sm" onClick={onReturnToCurrent}>
            <ArrowLeft size={14} />
            {t("chatArea.returnToCurrent")}
          </Button>
        </div>
      )}

      {/* Finished state banner */}
      {finishedConfig && selectedRun && (
        <div
          className={`px-4 py-2 border-b flex items-center justify-between shrink-0 ${finishedConfig.bgClass}`}
        >
          <div className="flex items-center gap-2">
            <span className={`text-sm font-medium ${finishedConfig.textClass}`}>
              {t(`chatArea.${finishedConfig.key}`)}
            </span>
            <span className="text-xs text-muted-foreground">
              {selectedRun.completedAt &&
                new Date(selectedRun.completedAt).toLocaleString()}
              {selectedRun.duration != null &&
                selectedRun.duration > 0 &&
                ` · ${selectedRun.duration}s`}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowStartDialog(true)}
          >
            <RotateCcw size={14} />
            {t("chatArea.rerun")}
          </Button>
        </div>
      )}

      {/* ChannelView */}
      {channelId ? (
        <div className="flex-1 min-h-0">
          <ChannelView
            key={channelId}
            channelId={channelId}
            hideHeader
            readOnly={isReadOnly}
          />
        </div>
      ) : (
        <TaskChatPlaceholder />
      )}

      <ManualTriggerDialog
        taskId={task.id}
        isOpen={showStartDialog}
        onClose={() => setShowStartDialog(false)}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd /Users/jiangtao/Desktop/shenjingyuan/team9 && pnpm build:client 2>&1 | tail -20`
Expected: Build succeeds (component not yet used, but should compile).

- [ ] **Step 3: Commit**

```bash
git add apps/client/src/components/tasks/TaskChatArea.tsx
git commit -m "feat(tasks): create TaskChatArea component with top bar and banners"
```

---

### Task 4: Create TaskRunTab

**Files:**

- Create: `apps/client/src/components/tasks/TaskRunTab.tsx`

Displays details for the currently selected run: status, metadata, timeline, interventions.

- [ ] **Step 1: Create TaskRunTab.tsx**

```typescript
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { tasksApi } from "@/services/api/tasks";
import { ExecutionTimeline } from "./ExecutionTimeline";
import { TaskInterventionCard } from "./TaskInterventionCard";
import { useExecutionStream } from "@/hooks/useExecutionStream";
import type { AgentTaskStatus, AgentTaskExecution } from "@/types/task";

const STATUS_BADGE_VARIANT: Record<
  AgentTaskStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  in_progress: "default",
  upcoming: "secondary",
  paused: "outline",
  pending_action: "default",
  completed: "secondary",
  failed: "destructive",
  stopped: "outline",
  timeout: "destructive",
};

const ACTIVE_STATUSES: AgentTaskStatus[] = [
  "in_progress",
  "pending_action",
  "paused",
];

const TRIGGER_TYPE_KEYS: Record<string, string> = {
  manual: "historyTab.manual",
  interval: "historyTab.interval",
  schedule: "historyTab.schedule",
  channel_message: "historyTab.channelMessage",
  retry: "historyTab.retry",
};

interface TaskRunTabProps {
  taskId: string;
  execution: AgentTaskExecution | null;
}

export function TaskRunTab({ taskId, execution }: TaskRunTabProps) {
  const { t } = useTranslation("tasks");

  const isActive = execution
    ? ACTIVE_STATUSES.includes(execution.status)
    : false;

  // SSE streaming for active runs
  useExecutionStream(
    taskId,
    execution?.id,
    execution?.taskcastTaskId,
    isActive,
  );

  // Fetch timeline entries
  const { data: entries = [] } = useQuery({
    queryKey: ["task-execution-entries", taskId, execution?.id],
    queryFn: () => tasksApi.getExecutionEntries(taskId, execution!.id),
    enabled: !!execution,
    refetchInterval: execution?.taskcastTaskId ? 30000 : 5000,
  });

  // Fetch execution detail for interventions
  const { data: executionDetail } = useQuery({
    queryKey: ["task-execution", taskId, execution?.id],
    queryFn: () => tasksApi.getExecution(taskId, execution!.id),
    enabled: !!execution,
    refetchInterval: execution?.taskcastTaskId ? 30000 : 5000,
  });

  if (!execution) {
    return (
      <div className="flex items-center justify-center h-32">
        <p className="text-sm text-muted-foreground">
          {t("runTab.noExecution")}
        </p>
      </div>
    );
  }

  const pendingInterventions =
    executionDetail?.interventions.filter((i) => i.status === "pending") ?? [];

  return (
    <div className="space-y-4">
      {/* Status info */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Badge
            variant={STATUS_BADGE_VARIANT[execution.status]}
            className="text-xs"
          >
            {t(`status.${execution.status}`)}
          </Badge>
          <span className="text-xs text-muted-foreground">
            v{execution.taskVersion}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          {execution.triggerType && (
            <div>
              <div className="text-muted-foreground">
                {t("runTab.triggerType")}
              </div>
              <div>
                {TRIGGER_TYPE_KEYS[execution.triggerType]
                  ? t(TRIGGER_TYPE_KEYS[execution.triggerType])
                  : execution.triggerType}
              </div>
            </div>
          )}
          {execution.duration != null && execution.duration > 0 && (
            <div>
              <div className="text-muted-foreground">
                {t("runTab.duration")}
              </div>
              <div>{execution.duration}s</div>
            </div>
          )}
          {execution.tokenUsage > 0 && (
            <div>
              <div className="text-muted-foreground">
                {t("runTab.tokenUsage")}
              </div>
              <div>{execution.tokenUsage} tokens</div>
            </div>
          )}
          {execution.startedAt && (
            <div>
              <div className="text-muted-foreground">
                {t("runTab.status")}
              </div>
              <div>{new Date(execution.startedAt).toLocaleString()}</div>
            </div>
          )}
        </div>
      </div>

      {/* Pending interventions */}
      {pendingInterventions.length > 0 && (
        <>
          <Separator />
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-orange-500">
              {t("detail.pendingInterventions")}
            </h4>
            {pendingInterventions.map((intervention) => (
              <TaskInterventionCard
                key={intervention.id}
                intervention={intervention}
                taskId={taskId}
              />
            ))}
          </div>
        </>
      )}

      {/* Timeline */}
      {entries.length > 0 && (
        <>
          <Separator />
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground mb-2">
              {t("runTab.timeline")}
            </h4>
            <ExecutionTimeline entries={entries} taskId={taskId} />
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/client/src/components/tasks/TaskRunTab.tsx
git commit -m "feat(tasks): create TaskRunTab component"
```

---

### Task 5: Create TaskSettingsTab

**Files:**

- Create: `apps/client/src/components/tasks/TaskSettingsTab.tsx`

Contains: title/description display, bot assignment, triggers, document editor, delete button. Reuses existing `TaskTriggersTab` and `TaskDocumentTab`.

- [ ] **Step 1: Create TaskSettingsTab.tsx**

```typescript
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { tasksApi } from "@/services/api/tasks";
import { api } from "@/services/api";
import { useSelectedWorkspaceId } from "@/stores/useWorkspaceStore";
import { TaskTriggersTab } from "./TaskTriggersTab";
import { TaskDocumentTab } from "./TaskDocumentTab";
import type { AgentTaskDetail } from "@/types/task";
import type { OpenClawBotInfo } from "@/services/api/applications";

interface TaskSettingsTabProps {
  task: AgentTaskDetail;
  onClose: () => void;
}

export function TaskSettingsTab({ task, onClose }: TaskSettingsTabProps) {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();
  const workspaceId = useSelectedWorkspaceId();

  // Bot assignment
  const updateBotMutation = useMutation({
    mutationFn: (botId: string | null) =>
      tasksApi.update(task.id, { botId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["task", task.id] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => tasksApi.delete(task.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      onClose();
    },
  });

  // Fetch bots
  const { data: installedApps } = useQuery({
    queryKey: ["installed-applications", workspaceId],
    queryFn: () => api.applications.getInstalledApplications(),
    enabled: !!workspaceId,
  });

  const openClawApps =
    installedApps?.filter(
      (a) => a.applicationId === "openclaw" && a.status === "active",
    ) ?? [];

  const { data: allBots = [] } = useQuery({
    queryKey: [
      "openclaw-bots-all",
      workspaceId,
      openClawApps.map((a) => a.id),
    ],
    queryFn: async () => {
      const results = await Promise.all(
        openClawApps.map((app) => api.applications.getOpenClawBots(app.id)),
      );
      return results.flat();
    },
    enabled: openClawApps.length > 0,
  });

  const canDelete =
    task.status === "upcoming" ||
    task.status === "completed" ||
    task.status === "failed" ||
    task.status === "stopped" ||
    task.status === "timeout";

  return (
    <div className="space-y-5">
      {/* Task info */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{task.title}</h3>
        {task.description && (
          <p className="text-xs text-muted-foreground">{task.description}</p>
        )}
      </div>

      {/* Bot assignment */}
      <div className="space-y-1">
        <span className="text-xs text-muted-foreground">
          {t("detail.assignBot")}
        </span>
        <Select
          value={task.botId ?? "__none__"}
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
            {allBots.map((bot: OpenClawBotInfo) => (
              <SelectItem key={bot.botId} value={bot.botId}>
                {bot.displayName || bot.username}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Separator />

      {/* Triggers */}
      <TaskTriggersTab taskId={task.id} />

      <Separator />

      {/* Document */}
      <TaskDocumentTab task={task} />

      {/* Delete */}
      {canDelete && (
        <>
          <Separator />
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive w-full justify-start"
            disabled={deleteMutation.isPending}
            onClick={() => {
              if (window.confirm(t("settingsTab.deleteConfirm"))) {
                deleteMutation.mutate();
              }
            }}
          >
            <Trash2 size={14} />
            {t("detail.delete")}
          </Button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/client/src/components/tasks/TaskSettingsTab.tsx
git commit -m "feat(tasks): create TaskSettingsTab component"
```

---

### Task 6: Create TaskHistoryTab

**Files:**

- Create: `apps/client/src/components/tasks/TaskHistoryTab.tsx`

- [ ] **Step 1: Create TaskHistoryTab.tsx**

```typescript
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { tasksApi } from "@/services/api/tasks";
import type { AgentTaskStatus } from "@/types/task";

const STATUS_BADGE_VARIANT: Record<
  AgentTaskStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  in_progress: "default",
  upcoming: "secondary",
  paused: "outline",
  pending_action: "default",
  completed: "secondary",
  failed: "destructive",
  stopped: "outline",
  timeout: "destructive",
};

const TRIGGER_TYPE_KEYS: Record<string, string> = {
  manual: "historyTab.manual",
  interval: "historyTab.interval",
  schedule: "historyTab.schedule",
  channel_message: "historyTab.channelMessage",
  retry: "historyTab.retry",
};

interface TaskHistoryTabProps {
  taskId: string;
  selectedRunId: string | null;
  currentExecutionId: string | null;
  onSelectRun: (runId: string) => void;
}

export function TaskHistoryTab({
  taskId,
  selectedRunId,
  currentExecutionId,
  onSelectRun,
}: TaskHistoryTabProps) {
  const { t } = useTranslation("tasks");

  const { data: executions = [], isLoading } = useQuery({
    queryKey: ["task-executions", taskId],
    queryFn: () => tasksApi.getExecutions(taskId),
    refetchInterval: 5000,
  });

  if (isLoading) {
    return (
      <div className="flex justify-center p-4">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (executions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground p-2">
        {t("historyTab.empty")}
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {executions.map((exec) => {
        const isSelected = exec.id === selectedRunId;
        const isCurrent = exec.id === currentExecutionId;

        return (
          <button
            key={exec.id}
            onClick={() => onSelectRun(exec.id)}
            className={`w-full text-left p-3 rounded-md border transition-colors space-y-1 ${
              isSelected
                ? "border-primary bg-accent"
                : "border-border hover:bg-muted/50"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge
                  variant={STATUS_BADGE_VARIANT[exec.status]}
                  className="text-xs"
                >
                  {t(`status.${exec.status}`)}
                </Badge>
                {exec.triggerType && (
                  <span className="text-xs text-muted-foreground">
                    {TRIGGER_TYPE_KEYS[exec.triggerType]
                      ? t(TRIGGER_TYPE_KEYS[exec.triggerType])
                      : exec.triggerType}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {isCurrent && (
                  <span className="text-xs text-primary font-medium">
                    {t("historyTab.current")}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  v{exec.taskVersion}
                </span>
              </div>
            </div>
            {exec.startedAt && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{new Date(exec.startedAt).toLocaleString()}</span>
                {exec.duration != null && exec.duration > 0 && (
                  <span>· {exec.duration}s</span>
                )}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/client/src/components/tasks/TaskHistoryTab.tsx
git commit -m "feat(tasks): create TaskHistoryTab component"
```

---

### Task 7: Create TaskRightPanel

**Files:**

- Create: `apps/client/src/components/tasks/TaskRightPanel.tsx`

- [ ] **Step 1: Create TaskRightPanel.tsx**

```typescript
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TaskRunTab } from "./TaskRunTab";
import { TaskSettingsTab } from "./TaskSettingsTab";
import { TaskHistoryTab } from "./TaskHistoryTab";
import type { AgentTaskDetail, AgentTaskExecution } from "@/types/task";

interface TaskRightPanelProps {
  task: AgentTaskDetail;
  selectedRun: AgentTaskExecution | null;
  selectedRunId: string | null;
  onSelectRun: (runId: string) => void;
  onClose: () => void;
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export function TaskRightPanel({
  task,
  selectedRun,
  selectedRunId,
  onSelectRun,
  onClose,
  activeTab,
  onTabChange,
}: TaskRightPanelProps) {
  const { t } = useTranslation("tasks");

  const currentExecutionId =
    task.currentExecution?.execution.id ?? null;

  return (
    <div className="w-[260px] border-l border-border bg-background flex flex-col h-full shrink-0">
      <Tabs
        value={activeTab}
        onValueChange={onTabChange}
        className="flex-1 flex flex-col overflow-hidden"
      >
        <TabsList className="mx-2 mt-2 shrink-0">
          <TabsTrigger value="run">{t("tabs.run")}</TabsTrigger>
          <TabsTrigger value="settings">{t("tabs.settings")}</TabsTrigger>
          <TabsTrigger value="history">{t("tabs.history")}</TabsTrigger>
        </TabsList>
        <ScrollArea className="flex-1 min-h-0">
          <TabsContent value="run" className="p-3 mt-0">
            <TaskRunTab taskId={task.id} execution={selectedRun} />
          </TabsContent>
          <TabsContent value="settings" className="p-3 mt-0">
            <TaskSettingsTab task={task} onClose={onClose} />
          </TabsContent>
          <TabsContent value="history" className="p-3 mt-0">
            <TaskHistoryTab
              taskId={task.id}
              selectedRunId={selectedRunId}
              currentExecutionId={currentExecutionId}
              onSelectRun={onSelectRun}
            />
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/client/src/components/tasks/TaskRightPanel.tsx
git commit -m "feat(tasks): create TaskRightPanel component with three tabs"
```

---

## Chunk 3: Integration and Cleanup

### Task 8: Rewrite TaskList with new layout

**Files:**

- Modify: `apps/client/src/components/tasks/TaskList.tsx` (complete rewrite)

This is the main integration task. The new `TaskList` manages: selected task, selected run, and wires up all new components.

- [ ] **Step 1: Rewrite TaskList.tsx**

```typescript
import { useMemo, useState, useCallback, useEffect } from "react";
import { Loader2, ListChecks, Plus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { tasksApi } from "@/services/api/tasks";
import { cn } from "@/lib/utils";
import { TaskCard } from "./TaskCard";
import { TaskChatArea } from "./TaskChatArea";
import { TaskRightPanel } from "./TaskRightPanel";
import { CreateTaskDialog } from "./CreateTaskDialog";
import type { AgentTask, AgentTaskStatus } from "@/types/task";

const STATUS_GROUPS: { key: string; statuses: AgentTaskStatus[] }[] = [
  { key: "active", statuses: ["in_progress", "paused", "pending_action"] },
  { key: "upcoming", statuses: ["upcoming"] },
  {
    key: "finished",
    statuses: ["completed", "failed", "stopped", "timeout"],
  },
];

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
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [rightPanelTab, setRightPanelTab] = useState("run");
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const { data: allTasks = [], isLoading } = useQuery({
    queryKey: ["tasks", { botId }],
    queryFn: () => tasksApi.list({ botId }),
  });

  // Fetch selected task detail
  const { data: selectedTask } = useQuery({
    queryKey: ["task", selectedTaskId],
    queryFn: () => tasksApi.getById(selectedTaskId!),
    enabled: !!selectedTaskId,
    refetchInterval: (query) =>
      query.state.data?.currentExecution?.execution.taskcastTaskId
        ? 30000
        : 5000,
  });

  // Fetch executions for the selected task (needed to find run by ID)
  const { data: executions = [] } = useQuery({
    queryKey: ["task-executions", selectedTaskId],
    queryFn: () => tasksApi.getExecutions(selectedTaskId!),
    enabled: !!selectedTaskId,
    refetchInterval: 5000,
  });

  // Derive active execution
  const activeExecution = selectedTask?.currentExecution?.execution ?? null;

  // Auto-select run when task changes
  useEffect(() => {
    if (!selectedTask) {
      setSelectedRunId(null);
      return;
    }
    if (activeExecution && ACTIVE_STATUSES.includes(activeExecution.status)) {
      setSelectedRunId(activeExecution.id);
    } else if (executions.length > 0) {
      setSelectedRunId(executions[0].id);
    } else if (activeExecution) {
      setSelectedRunId(activeExecution.id);
    } else {
      setSelectedRunId(null);
    }
  }, [selectedTaskId]); // Only on task switch, not on every data update

  // Find the selected run data
  const selectedRun = useMemo(() => {
    if (!selectedRunId) return null;
    if (activeExecution?.id === selectedRunId) return activeExecution;
    return executions.find((e) => e.id === selectedRunId) ?? null;
  }, [selectedRunId, activeExecution, executions]);

  const isViewingHistory =
    !!selectedRun && !!activeExecution && selectedRunId !== activeExecution.id;

  // Group tasks by status
  const groupedTasks = useMemo(() => {
    return STATUS_GROUPS.map((group) => ({
      ...group,
      tasks: allTasks.filter((task) =>
        group.statuses.includes(task.status),
      ),
    })).filter((group) => group.tasks.length > 0);
  }, [allTasks]);

  const handleSelectRun = useCallback(
    (runId: string) => {
      setSelectedRunId(runId);
      setRightPanelTab("run");
    },
    [],
  );

  const handleReturnToCurrent = useCallback(() => {
    if (activeExecution) {
      setSelectedRunId(activeExecution.id);
    } else if (executions.length > 0) {
      setSelectedRunId(executions[0].id);
    }
    setRightPanelTab("run");
  }, [activeExecution, executions]);

  const handleCloseTask = useCallback(() => {
    setSelectedTaskId(null);
    setSelectedRunId(null);
  }, []);

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

        {/* Task list */}
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && allTasks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 gap-2">
            <ListChecks size={24} className="text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">{t("noTasks")}</p>
          </div>
        )}

        {!isLoading && allTasks.length > 0 && (
          <div className="flex-1 overflow-y-auto">
            {groupedTasks.map((group) => (
              <div key={group.key}>
                <div className="px-3 pt-3 pb-1">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    {t(`tabs.${group.key}`, group.key)}
                  </span>
                </div>
                <div className="px-2 space-y-1 pb-1">
                  {group.tasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onClick={() => setSelectedTaskId(task.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Center + Right: only shown when a task is selected */}
      {selectedTaskId && selectedTask && (
        <>
          {/* Center column: chat */}
          <TaskChatArea
            task={selectedTask}
            selectedRun={selectedRun}
            activeExecution={activeExecution}
            isViewingHistory={isViewingHistory}
            onReturnToCurrent={handleReturnToCurrent}
          />

          {/* Right column: panel */}
          <TaskRightPanel
            task={selectedTask}
            selectedRun={selectedRun}
            selectedRunId={selectedRunId}
            onSelectRun={handleSelectRun}
            onClose={handleCloseTask}
            activeTab={rightPanelTab}
            onTabChange={setRightPanelTab}
          />
        </>
      )}

      <CreateTaskDialog
        isOpen={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
      />
    </div>
  );
}
```

- [ ] **Step 2: Check if CreateTaskDialog exists and its props**

Read `apps/client/src/components/tasks/CreateTaskDialog.tsx` to verify the props interface. If it doesn't have `isOpen`/`onClose` props or has a different API, adjust the TaskList code accordingly. If it doesn't exist, remove the CreateTaskDialog import and the "+" button, or replace with a simple button that navigates to a create route.

- [ ] **Step 3: Verify compilation**

Run: `cd /Users/jiangtao/Desktop/shenjingyuan/team9 && pnpm build:client 2>&1 | tail -30`

Fix any type errors. Common issues to watch for:

- `CreateTaskDialog` prop mismatch
- Missing i18n keys
- Import path issues

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/components/tasks/TaskList.tsx
git commit -m "feat(tasks): rewrite TaskList with three-column run-centric layout"
```

---

### Task 9: Remove old components

**Files:**

- Remove: `apps/client/src/components/tasks/TaskDetailPanel.tsx`
- Remove: `apps/client/src/components/tasks/TaskBasicInfoTab.tsx`
- Remove: `apps/client/src/components/tasks/RunDetailView.tsx`
- Remove: `apps/client/src/components/tasks/TaskRunsTab.tsx`

- [ ] **Step 1: Check for imports of removed components**

Search the codebase for any remaining imports of `TaskDetailPanel`, `TaskBasicInfoTab`, `RunDetailView`, `TaskRunsTab` outside of the files being removed. These should only be referenced in files we've already rewritten.

Run: Search for `TaskDetailPanel`, `TaskBasicInfoTab`, `RunDetailView`, `TaskRunsTab` in `apps/client/src/`.

If any unexpected imports remain, update those files to remove the imports.

- [ ] **Step 2: Delete old files**

```bash
rm apps/client/src/components/tasks/TaskDetailPanel.tsx
rm apps/client/src/components/tasks/TaskBasicInfoTab.tsx
rm apps/client/src/components/tasks/RunDetailView.tsx
rm apps/client/src/components/tasks/TaskRunsTab.tsx
```

- [ ] **Step 3: Verify build**

Run: `cd /Users/jiangtao/Desktop/shenjingyuan/team9 && pnpm build:client 2>&1 | tail -30`
Expected: Clean build with no import errors.

- [ ] **Step 4: Commit**

```bash
git add -u apps/client/src/components/tasks/
git commit -m "refactor(tasks): remove old TaskDetailPanel, TaskBasicInfoTab, RunDetailView, TaskRunsTab"
```

---

### Task 10: Manual verification

- [ ] **Step 1: Start dev server**

Run: `cd /Users/jiangtao/Desktop/shenjingyuan/team9 && pnpm dev:client`

- [ ] **Step 2: Verify key flows**

Open the Tasks page in the browser and check:

1. **Task list** — shows grouped by status (active/upcoming/finished)
2. **Select a task** — chat area appears with top bar, right panel shows Run tab
3. **Active run** — chat is interactive, control buttons (pause/stop) visible
4. **Settings tab** — bot assignment, triggers, document editor all work
5. **History tab** — shows run list, clicking a run switches chat
6. **History banner** — blue banner appears when viewing old run, "return" button works
7. **Finished task** — shows last run (read-only) with status banner and rerun button
8. **Upcoming task** — shows placeholder with start button

- [ ] **Step 3: Fix any issues found during testing**

Address any visual glitches, missing translations, or broken interactions discovered during manual testing.

- [ ] **Step 4: Final commit if fixes were needed**

```bash
git add -A
git commit -m "fix(tasks): polish task module UI after manual testing"
```
