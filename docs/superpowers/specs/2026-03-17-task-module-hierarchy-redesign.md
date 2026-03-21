# Task Module Hierarchy Redesign

## Problem

The current three-tab right panel (Run / Settings / History) creates a flat hierarchy that obscures the parent-child relationship between Tasks and their Runs. History items are Runs belonging to a Task but are displayed in a separate tab disconnected from the Task list. Settings is a Task-level concern but lives alongside Run-level information.

## Design

### Layout Change

**Before:** Three-column layout with right panel containing Run | Settings | History tabs.

**After:** Three-column layout with:

- **Left panel:** Expandable Task list (Tasks contain their Runs inline)
- **Middle panel:** Chat area (unchanged)
- **Right panel:** Run details only (no tabs)

Settings moves to a Modal dialog triggered from each Task card.

### 1. Left Panel — Expandable Task List

#### Task Card

- Click the entire card → expand/collapse the Run list
- Hover → show ⚙ settings icon in top-right corner
- Clicking the ⚙ icon opens the settings modal and does NOT toggle expand/collapse (use `stopPropagation`)
- Show ▼ when expanded, ▶ when collapsed
- Multiple Tasks can be expanded simultaneously
- When one of its Runs is the globally selected Run, the Task card shows a distinct active/selected style (e.g., highlighted border) in addition to being expanded

#### Run Sub-items (Two Lines)

Each Run item displays:

- **Line 1:** Status dot + version (e.g., "v3") + timestamp
- **Line 2:** Trigger type + duration

Interaction:

- Click a Run → middle chat switches to that Run's channel, right panel shows that Run's details
- Only one Run can be selected at a time across all tasks. Selecting a Run in a different Task switches the active task context (chat + right panel)
- Currently selected Run is highlighted

#### Default Selection Behavior

- Expanding a Task auto-selects the active Run (or most recent Run if none active)
- If a Task has no Runs, show an empty hint (e.g., "No runs yet")

#### Handling Many Runs

- Show the **most recent 3 Runs** inline by default
- If more exist, display a collapsed row at the bottom: "↓ N earlier runs"
- Clicking it expands the area with a **fixed max-height (~300px) and internal scrolling**
- Keeps the sidebar clean while allowing full history browsing
- All executions are fetched when a task is expanded (single `getExecutions(taskId)` call), then the UI slices to show the first 3. Clicking "N earlier runs" reveals the rest from the already-fetched data — no additional API call needed

### 2. Settings — Modal Dialog

#### Trigger

- Hover over a Task card → ⚙ gear icon appears in top-right corner
- Click ⚙ → open centered Modal overlay

#### Content

Reuses all existing TaskSettingsTab functionality:

- Task title + description editing
- Bot assignment dropdown
- Trigger management (TaskTriggersTab)
- Document editor (TaskDocumentTab)
- Delete button (only when task is not active)

#### Size

Wide modal (`max-w-2xl` or `max-w-3xl`) to accommodate the document editor.

### 3. Right Panel — Run Details Only

#### Layout

No tabs. Directly displays the selected Run's information:

- **Top section:** Execution info summary — status badge, version, trigger type, timestamp, duration, token usage
- **Bottom section:** Timeline (ExecutionTimeline) — steps, interventions, deliverables, status changes
- Vertical scrolling for the entire panel

#### Interventions

Pending interventions remain in the timeline with action buttons (approve/reject/custom response).

#### Empty State

When no Run is selected (e.g., Task has no executions), show an empty placeholder.

## Components Affected

| Component                     | Change                                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TaskList.tsx`                | Remove `rightPanelTab` state, add expand/collapse state per task, add Run sub-items rendering                                                          |
| `TaskCard.tsx`                | Add expand/collapse arrow, hover ⚙ icon, expandable Run list                                                                                           |
| `TaskRightPanel.tsx`          | Remove tab navigation, render Run details directly                                                                                                     |
| `TaskSettingsTab.tsx`         | Move content into a new `TaskSettingsDialog.tsx` modal                                                                                                 |
| `TaskHistoryTab.tsx`          | Remove — functionality absorbed into Task card expansion                                                                                               |
| `TaskRunTab.tsx`              | Content becomes the sole right panel content                                                                                                           |
| New: `TaskSettingsDialog.tsx` | Modal wrapper around settings content. Two callbacks: `onClose` (dismiss modal) and `onDeleted` (dismiss modal + clear selection + invalidate queries) |
| New: `TaskRunItem.tsx`        | Two-line Run sub-item component for left panel                                                                                                         |

## Data Fetching

- **Task list:** `useQuery(["tasks"])` — unchanged, fetches all tasks
- **Executions per expanded task:** Each expanded task triggers its own `useQuery(["task-executions", taskId])`. Only fires when the task is in `expandedTaskIds`
- **Polling strategy:**
  - Selected task's executions: poll at 5s (or 30s if TaskCast SSE is active)
  - Expanded-but-not-selected tasks: no polling (stale until next expand or manual refetch)
  - Task detail + execution entries: unchanged, fetched for `selectedRunId` only
- **Collapse cleanup:** Collapsing a task does NOT clear its cached executions (React Query retains them with normal GC)

## Selection Lifecycle

- `selectedTaskId` is **derived** from the currently selected Run's `taskId` — not stored independently
- `selectedRunId` is the single source of truth for what's displayed in chat + right panel
- Collapsing a task that owns the currently selected Run → deselects the Run (clears chat + right panel)
- Expanding a task → auto-selects the active Run (or most recent), which sets `selectedRunId` and derives `selectedTaskId`

## State Changes

```
// Remove
rightPanelTab: "run" | "settings" | "history"  // no longer needed

// Add
expandedTaskIds: Set<string>                     // which tasks are expanded
showSettingsTaskId: string | null                 // which task's settings modal is open
```

Selection flow:

1. Click Task card → toggle expand, if expanding: auto-select active/latest Run
2. Click Run sub-item → set selectedRunId, update chat + right panel
3. Click ⚙ on Task → open settings modal (does not affect Run selection)
