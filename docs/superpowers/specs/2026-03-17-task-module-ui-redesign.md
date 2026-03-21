# Task Module UI Redesign

## Problem

The current task module frontend mixes task-level and run-level concerns, creating a confusing user experience. The core insight: **Task = class (template), Run = instance**. Each run creates its own IM channel, so chat should follow the run, not the task. The current UI fails to reflect this mental model.

## Goals

- Make the Task/Run relationship intuitive: Task is configuration, Run is execution
- Chat follows the Run — selecting a different run switches the conversation
- Prioritize real-time monitoring (primary use case) while keeping task configuration accessible
- Clean, harmonious layout inspired by the existing IM module's three-column pattern

## Non-Goals

- Backend API changes (reuse existing endpoints)
- New features beyond the UI restructure
- Mobile/responsive layout

---

## Layout

Three-column layout: **Task List | Chat | Right Panel**

```
┌──────────┬─────────────────────────────────┬──────────────┐
│          │  Chat Top Bar (status, controls) │  Run │設置│歴史│
│  Tasks   │                                  │              │
│  (list)  │  Chat Messages                   │  Panel       │
│          │  (follows selected Run)          │  Content     │
│          │                                  │              │
│          │  Message Input                   │              │
└──────────┴─────────────────────────────────┴──────────────┘
```

### Left Column: Task List (w-70 / 280px)

- Grouped by status: **运行中** (in_progress, paused, pending_action) → **待运行** (upcoming) → **已结束** (completed, failed, stopped, timeout)
- Each card shows: title, status indicator, brief context (duration / next trigger time)
- "+" button at top to create new task
- Clicking a task selects it and loads the center + right columns

### Center Column: Chat Area (flex, dominant)

The chat area displays the conversation from the **currently selected Run's channel**. It is wrapped by the new `TaskChatArea` component, which provides a custom top bar and contextual banners.

**ChannelView integration:** `ChannelView` renders its own `ChannelHeader` and `MessageInput` internally. To avoid a double-header, pass `hideHeader={true}` prop to `ChannelView` (requires adding this prop). For read-only states, pass `readOnly={true}` prop (requires adding this prop — hides `MessageInput` and shows a static "历史对话（只读）" bar instead). These are minimal, non-breaking additions to `ChannelView`.

**Custom top bar** (rendered by `TaskChatArea`, above `ChannelView`) contains:

- Task title + Run status badge + metadata (version, token count, duration)
- Control buttons contextual to status:
  - `in_progress`: Pause, Stop
  - `paused`: Resume, Stop
  - `pending_action`: Stop
  - `upcoming` (no active run): Start
  - Finished states: "Rerun" button (opens `ManualTriggerDialog`, uses `tasksApi.restart()` for fresh re-run)

**Three display states:**

1. **Active Run** — Full interactive chat with message input. `ChannelView` renders with `hideHeader` but default input.
2. **Viewing Historical Run** — Blue banner below top bar: "📜 正在查看历史 Run · {date} · {status}" with a "↩ 返回当前 Run" button. `ChannelView` renders with `hideHeader` and `readOnly`.
3. **No Active Run (task finished)** — Shows the most recent Run's chat (read-only). Status-colored banner: "✅ 上次运行已完成" (or failed/stopped/timeout variant) with "▶ 重新运行" button. `ChannelView` renders with `hideHeader` and `readOnly`. If no runs exist at all (upcoming task never run), show `TaskChatPlaceholder` with "Start" CTA instead of `ChannelView`.

**Auto-switch on new run:** If a new execution starts (detected via polling `getById`) while the user is viewing a historical run, a toast notification appears: "新的 Run 已开始". The user is NOT auto-switched — they click "返回当前 Run" or the toast to navigate.

### Right Column: Panel (~260px)

Three tabs: **Run | 设置 | 历史**

#### Run Tab

- Status, duration, trigger type, task version, token usage
- Execution timeline (reuse `ExecutionTimeline` component)
- Pending interventions displayed prominently with approve/reject buttons

#### 设置 (Settings) Tab

- Task title, description (editable)
- Bot assignment (Select dropdown, reuse existing)
- Triggers section (reuse `TaskTriggersTab` component inline)
- Document section (reuse `TaskDocumentTab` component inline — receives full `AgentTaskDetail` as prop)
- Delete task button (with confirmation)

Note: `TaskSettingsTab` receives the full `AgentTaskDetail` object as a prop to pass down to child components that need it (e.g., `TaskDocumentTab`).

#### 历史 (History) Tab

- List of all runs, newest first
- Each entry shows: status icon, timestamp, trigger type, duration, task version
- Currently viewed run highlighted with accent border
- Clicking a run:
  1. Switches center chat to that run's channel
  2. Switches right panel to Run tab (to show selected run's details)
  3. If switching to a non-current run, shows blue "viewing history" banner in chat

---

## State Management

### Selected Run Logic

```
selectedRunId: string | null

When user selects a Task:
  - If task has active execution (in_progress/paused/pending_action):
      selectedRunId = currentExecution.id
  - Else if task has any executions:
      selectedRunId = most recent execution id
  - Else:
      selectedRunId = null (show empty state)

When user clicks a run in History tab:
  selectedRunId = clicked run id

"Return to current" button:
  selectedRunId = currentExecution.id (or most recent)
```

### Derived State

```
isViewingHistory = selectedRun && activeExecution && selectedRunId !== activeExecution.id
isReadOnly = !activeExecution || isViewingHistory
channelId = selectedRun?.channelId ?? null
```

**Data source for `selectedRun`:** When `selectedRunId` matches the current execution, use data from `tasksApi.getById()` response (`task.currentExecution.execution`). For historical runs, `tasksApi.getExecutions()` returns `AgentTaskExecution[]` which includes `channelId`, `status`, `startedAt`, `duration`, `tokenUsage` — sufficient for both the history list and deriving `channelId` without an extra API call. Detailed run data (timeline entries, interventions) is fetched on-demand via `getExecution()` and `getExecutionEntries()` when the Run tab is active.

---

## Component Architecture

### New/Modified Components

| Component             | Status                        | Description                                                   |
| --------------------- | ----------------------------- | ------------------------------------------------------------- |
| `TaskList`            | **Modify**                    | Refactor to new three-column layout with run-aware chat       |
| `TaskDetailPanel`     | **Remove**                    | Replaced by inline right panel in TaskList                    |
| `TaskBasicInfoTab`    | **Remove**                    | Split into Chat top bar + Settings tab + Run tab              |
| `TaskRunsTab`         | **Modify** → `TaskHistoryTab` | Simplified run list, click switches chat                      |
| `RunDetailView`       | **Remove**                    | Run details now shown in Run tab of right panel               |
| `TaskRightPanel`      | **New**                       | Container for the three-tab right panel                       |
| `TaskRunTab`          | **New**                       | Run tab content (status, timeline, interventions)             |
| `TaskSettingsTab`     | **New**                       | Settings tab (title, bot, triggers, document, delete)         |
| `TaskChatArea`        | **New**                       | Wraps ChannelView with top bar, banners, and read-only states |
| `TaskChatPlaceholder` | **Keep**                      | Empty state when no runs exist                                |

### Reused Components (no changes)

- `ChannelView` — renders chat for a given channelId (add `hideHeader` and `readOnly` props)
- `ExecutionTimeline` — execution step timeline
- `TaskInterventionCard` — intervention approve/reject UI
- `TaskTriggersTab` — trigger CRUD (embedded in Settings tab)
- `TaskDocumentTab` — document editor (embedded in Settings tab)
- `ManualTriggerDialog` — dialog for manual task start
- `TaskCard` — individual task card in the list

---

## Interaction Flows

### Flow 1: Monitor Active Run

1. User opens Task module → sees task list
2. Clicks a task with active run → chat loads with live conversation, Run tab shows timeline
3. User types message → sends to bot via ChannelView
4. Intervention appears → Run tab shows intervention card with approve/reject
5. User clicks Pause → Run pauses, chat input disabled with "已暂停" indicator

### Flow 2: Review Historical Run

1. User clicks "历史" tab in right panel
2. Sees list of all runs → clicks an older run
3. Chat switches to that run's channel (read-only), blue banner appears
4. Run tab updates to show that run's details
5. User clicks "↩ 返回当前 Run" → returns to active/latest run

### Flow 3: Configure Task

1. User clicks "设置" tab in right panel
2. Edits title, changes bot assignment, modifies triggers
3. Changes save immediately (existing mutation pattern)
4. Chat remains visible alongside settings

### Flow 4: Start Task (upcoming, no active run)

1. User selects an upcoming task → empty state or last run shown
2. Top bar shows "▶ 开始" button
3. Clicks start → ManualTriggerDialog opens
4. Confirms → new run starts, chat begins showing live conversation

### Flow 5: Rerun After Completion

1. User sees finished banner: "✅ 上次运行已完成"
2. Clicks "▶ 重新运行" in banner
3. ManualTriggerDialog opens → confirms → new run starts

---

## Data Fetching

Reuse existing React Query hooks and API calls:

- `tasksApi.list()` — task list (left column)
- `tasksApi.getById(taskId)` — task detail + current execution
- `tasksApi.getExecutions(taskId)` — all executions (history tab, `refetchInterval: 5000` to detect new runs)
- `tasksApi.getExecution(taskId, execId)` — single execution detail (run tab)
- `tasksApi.getExecutionEntries(taskId, execId)` — timeline entries (run tab)
- `useExecutionStream()` — SSE streaming for active run updates
- `ChannelView` handles its own data fetching internally via channelId prop

---

## Visual Design Notes

- Follow existing design system: Radix UI components, Tailwind CSS, Lucide icons
- Task list status groups use subtle uppercase labels (font-size 9px, muted color)
- Active run indicator: green dot + "运行中" badge
- History viewing banner: blue-tinted background with border
- Finished state banner: color matches status (green=completed, red=failed, orange=timeout, gray=stopped)
- Control buttons in chat top bar use existing Button variants (default, outline, destructive)
- Right panel tabs use existing Tabs component from Radix UI
