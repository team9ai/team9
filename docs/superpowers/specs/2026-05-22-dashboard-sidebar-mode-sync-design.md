# Dashboard Sidebar Mode Sync — Design

**Date:** 2026-05-22
**Status:** Approved for implementation planning
**Author:** Codex (brainstorming)

## 1. Background

The Home navigation entry currently opens the task-oriented sub-sidebar implemented by `TasksSubSidebar`. That sidebar shows `新对话`, `新任务`, `任务看板`, and recent task runs. The Dashboard composer on the right is implemented by `HomeMainContent` and has its own centered mode switch for `对话模式` and `任务模式`.

AI agent topic sessions are currently grouped through `useAgentGroupsForSidebar` and rendered by `AgentGroupList` in the Workspace and Messages sidebars. The requested change is to make the Home/Dashboard left sidebar own the conversation/task switch: conversation mode should show the AI Agents grouping, while task mode should show the task list. The left sidebar switch must stay synchronized with Dashboard mode and with the `新对话` / `新任务` entry points.

## 2. Goals

- Add a centered `对话` / `任务` tab switch to the Home/Dashboard sub-sidebar.
- In `对话`, render AI Agents and their topic sessions using the existing `useAgentGroupsForSidebar` and `AgentGroupList` behavior.
- In `任务`, keep the existing task list, status badges, task row actions, and task board entry.
- Keep left sidebar mode, `新对话` / `新任务`, and the Dashboard `对话模式` / `任务模式` switch synchronized.
- Preserve existing topic-session behavior: agent header navigation, quick new topic, rename, archive, delete, unread badges, and load-more.
- Avoid backend changes.

## 3. Non-Goals

- Removing AI Agents from the Workspace or Messages sidebar in this change. This design only adds the Dashboard-owned conversation view.
- Redesigning the Dashboard composer layout beyond navigation synchronization.
- Changing task execution, task status filtering, or task board behavior.
- Changing topic-session API contracts.

## 4. User Experience

The Home sub-sidebar keeps the `首页` title. Under the title, it shows a centered segmented control:

- `对话`
- `任务`

When `对话` is active, the action row includes `新对话`, and the content area shows the AI Agents section. Each agent can be expanded to show recent topic sessions. The existing new-topic button routes back to the Dashboard composer with that agent preselected.

When `任务` is active, the action row includes `新任务` and `任务看板`, and the content area shows the same grouped task list that exists today.

The selected state is route-derived:

- `/tasks/new-conversation` means conversation mode.
- `/tasks/new-task` means task mode.
- `/tasks` and `/tasks/:taskId` mean task mode.
- `/channels?agentId=...` remains valid for agent preselection, but Home/Dashboard entry points should prefer `/tasks/new-conversation` so the Home sidebar is visible.

## 5. Synchronization Rules

Mode should have a single durable source of truth: the route.

- Clicking left `对话` tab navigates to `/tasks/new-conversation`.
- Clicking left `任务` tab navigates to `/tasks/new-task`.
- Clicking `新对话` navigates to `/tasks/new-conversation`.
- Clicking `新任务` navigates to `/tasks/new-task`.
- Switching `HomeMainContent` to conversation mode updates the route to `/tasks/new-conversation`.
- Switching `HomeMainContent` to task mode updates the route to `/tasks/new-task`.

`HomeMainContent` may still keep local mode state for immediate render behavior, but it must update when `initialMode` changes and must call the appropriate navigation when a user changes mode from the Dashboard switch.

## 6. Component Design

### `TasksSubSidebar`

Keep `TasksSubSidebar` as the Home/Dashboard sidebar component to avoid a larger routing refactor. Internally, split its render into two mode bodies:

- `ConversationSidebarBody`
- `TaskSidebarBody`

The component derives `activeMode` from `location.pathname`. It renders the segmented control above the mode-specific content.

The task body reuses the existing task query, grouping, row actions, and rename dialog. The conversation body wires:

- `useAgentGroupsForSidebar(5)`
- `useRenameTopicSession`
- `useDeleteTopicSession` for archive/delete
- `AgentGroupList` with `linkPrefix="/channels"` unless route support is expanded to open topic channels under Home directly

If the selected channel is unavailable from task routes, `selectedChannelId` remains undefined in the Dashboard sidebar. That is acceptable for the new Dashboard entry view because active channel highlighting is not expected there.

### `HomeMainContent`

Add an optional mode-change navigation path. When the mode switch changes:

- update local mode
- navigate to `HOME_ENTRY_PATH` or `TASK_ENTRY_PATH` when the current route is one of the Dashboard entry routes

This keeps the right-side switch and left-side segmented control synchronized without adding a global mode store.

### `AgentGroupList` / `navigateToNewTopic`

The current `navigateToNewTopic` routes to `/channels?agentId=...`. For the Dashboard sidebar, the desired destination is `/tasks/new-conversation?agentId=...` if the route supports search params. This can be handled by extending `AgentGroupList` with an optional `newTopicTarget` prop or callback, rather than changing all existing callers.

Recommended option:

- Add `onNewTopic?: (agentUserId: string) => void` to `AgentGroupList`.
- Existing sidebars omit it and keep current behavior.
- `TasksSubSidebar` passes a handler that navigates to `/tasks/new-conversation` with `agentId`.

## 7. Route/Search Design

`/_authenticated/tasks/new-conversation` should accept optional search:

```ts
type TaskNewConversationSearch = {
  agentId?: string;
};
```

It passes `agentId` into `HomeMainContent`, matching the existing `/channels` dashboard route behavior. This lets the Dashboard sidebar's AI Agents quick-new-topic action preselect the correct agent while staying under the Home sidebar.

## 8. Testing

Frontend tests should cover:

- `TasksSubSidebar` renders the centered `对话` / `任务` switch.
- `/tasks/new-conversation` selects `对话` and renders AI Agents.
- `/tasks/new-task` selects `任务` and renders task actions/list.
- Clicking `对话`, `任务`, `新对话`, and `新任务` navigates to the expected route.
- Dashboard `HomeMainContent` mode switch navigates to the matching route.
- `AgentGroupList` optional new-topic callback is used when provided and preserves default behavior when omitted.
- `tasks/new-conversation` search `agentId` preselects an agent in `HomeMainContent`.

## 9. Risks

- `AgentGroupList` is shared by multiple sidebars, so new props must be optional and default to current behavior.
- Dashboard mode currently uses local state, so route synchronization must avoid loops by only navigating on explicit user mode changes.
- Topic session channels still open under `/channels/$channelId`; that is acceptable because the actual conversation view lives in the Workspace channel route today.
