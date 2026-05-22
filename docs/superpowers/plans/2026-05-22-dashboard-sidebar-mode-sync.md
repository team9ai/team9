# Dashboard Sidebar Mode Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Home/Dashboard left sidebar switch between AI Agent conversations and task runs, synchronized with Dashboard conversation/task mode.

**Architecture:** Keep `TasksSubSidebar` as the Home sub-sidebar and split its render into route-derived conversation/task views. Reuse `AgentGroupList` for AI Agents, extend it with an optional new-topic callback for Dashboard-specific routing, and make `HomeMainContent` navigate when its mode switch changes.

**Tech Stack:** React 19, TypeScript, TanStack Router, TanStack React Query, Vitest, Testing Library, Tailwind CSS.

---

## File Structure

- Modify `apps/client/src/components/layout/sidebars/TasksSubSidebar.tsx`: add centered `对话` / `任务` tabs, move the current task list into task mode, add AI Agents conversation mode, and route actions through `HOME_ENTRY_PATH` / `TASK_ENTRY_PATH`.
- Modify `apps/client/src/components/layout/sidebars/__tests__/TasksSubSidebar.test.tsx`: mock agent topic hooks and cover mode tabs, conversation content, task content, and navigation.
- Modify `apps/client/src/components/sidebar/AgentGroupList.tsx`: add optional `onNewTopic(agentUserId)` callback while preserving existing default navigation.
- Modify `apps/client/src/components/sidebar/__tests__/AgentGroupList.test.tsx`: verify the optional callback and the default behavior.
- Modify `apps/client/src/routes/_authenticated/tasks/new-conversation.tsx`: accept optional `agentId` search and pass it to `HomeMainContent`.
- Modify `apps/client/src/components/layout/contents/HomeMainContent.tsx`: import `HOME_ENTRY_PATH` / `TASK_ENTRY_PATH`, add a mode-change handler, and navigate on explicit Dashboard mode changes.
- Modify `apps/client/src/components/layout/contents/__tests__/HomeMainContent.test.tsx`: update the mode-switch test to expect route synchronization.

## Baseline

- [x] **Step 0: Verify existing related tests pass**

Run:

```bash
pnpm --filter @team9/client test -- src/components/layout/sidebars/__tests__/TasksSubSidebar.test.tsx src/components/sidebar/__tests__/AgentGroupList.test.tsx src/components/layout/contents/__tests__/HomeMainContent.test.tsx
```

Expected: PASS. Observed before implementation: 3 files, 39 tests passed.

## Task 1: AgentGroupList New-Topic Callback

**Files:**

- Modify: `apps/client/src/components/sidebar/AgentGroupList.tsx`
- Modify: `apps/client/src/components/sidebar/__tests__/AgentGroupList.test.tsx`

- [ ] **Step 1.1: Write the failing callback test**

Add this test inside `describe("AgentGroupList", ...)`:

```tsx
it("uses the provided new-topic callback instead of default navigation", () => {
  const onNewTopic = vi.fn();

  render(
    <AgentGroupList
      linkPrefix="/channels"
      groups={[
        makeGroup({
          agentUserId: "agent-user-1",
          agentDisplayName: "Agent",
        }),
      ]}
      onNewTopic={onNewTopic}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "新建话题" }));

  expect(onNewTopic).toHaveBeenCalledWith("agent-user-1");
});
```

- [ ] **Step 1.2: Run the failing test**

Run:

```bash
pnpm --filter @team9/client test -- src/components/sidebar/__tests__/AgentGroupList.test.tsx
```

Expected: FAIL because `AgentGroupListProps` does not have `onNewTopic` and the callback is never called.

- [ ] **Step 1.3: Implement optional callback**

In `AgentGroupListProps`, add:

```ts
/** Optional override for the header new-topic action. */
onNewTopic?: (agentUserId: string) => void;
```

Pass it from `AgentGroupList` into `AgentGroup`, add it to the `AgentGroup` parameter type, and update `handleNewTopic`:

```ts
const handleNewTopic = (event: MouseEvent<HTMLButtonElement>) => {
  event.stopPropagation();
  if (onNewTopic) {
    onNewTopic(group.agentUserId);
    return;
  }
  navigateToNewTopic(navigate, group.agentUserId);
};
```

- [ ] **Step 1.4: Verify AgentGroupList tests pass**

Run:

```bash
pnpm --filter @team9/client test -- src/components/sidebar/__tests__/AgentGroupList.test.tsx
```

Expected: PASS.

## Task 2: TasksSubSidebar Conversation/Task Views

**Files:**

- Modify: `apps/client/src/components/layout/sidebars/TasksSubSidebar.tsx`
- Modify: `apps/client/src/components/layout/sidebars/__tests__/TasksSubSidebar.test.tsx`

- [ ] **Step 2.1: Write failing sidebar mode tests**

In `TasksSubSidebar.test.tsx`, add mocks for `useAgentGroupsForSidebar` and `useTopicSessions` near the existing mocks:

```ts
const mockLoadMoreTopicSessions = vi.fn();
const mockRenameTopicSession = vi.fn();
const mockArchiveTopicSession = vi.fn();
const mockDeleteTopicSession = vi.fn();

vi.mock("@/hooks/useAgentGroupsForSidebar", () => ({
  useAgentGroupsForSidebar: () => ({
    groups: [
      {
        agentUserId: "agent-user-1",
        agentId: "agent-1",
        agentDisplayName: "Lia",
        agentSubtitle: "Winrey Ma助理",
        agentAvatarUrl: null,
        legacyDirectChannelId: null,
        totalCount: 1,
        recentSessions: [
          {
            channelId: "topic-channel-1",
            sessionId: "session-1",
            title: "P2 AI Agent topic",
            lastMessageAt: "2026-05-22T00:00:00.000Z",
            unreadCount: 0,
            createdAt: "2026-05-22T00:00:00.000Z",
          },
        ],
      },
    ],
    isLoading: false,
    loadMoreTopicSessions: mockLoadMoreTopicSessions,
    isLoadingMoreTopicSessions: false,
  }),
}));

vi.mock("@/hooks/useTopicSessions", () => ({
  useRenameTopicSession: () => ({
    mutateAsync: mockRenameTopicSession,
    isPending: false,
  }),
  useDeleteTopicSession: () => ({
    mutateAsync: mockArchiveTopicSession,
    isPending: false,
  }),
}));
```

Then add these tests:

```tsx
it("renders centered conversation and task tabs", () => {
  renderTasksSubSidebar();

  const tablist = screen.getByRole("tablist", { name: "首页模式" });

  expect(tablist).toHaveClass("mx-auto", "grid", "grid-cols-2");
  expect(screen.getByRole("tab", { name: "对话" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.getByRole("tab", { name: "任务" })).toHaveAttribute(
    "aria-selected",
    "false",
  );
});

it("shows AI Agents in conversation mode", () => {
  renderTasksSubSidebar();

  expect(screen.getByText("AI Agents")).toBeInTheDocument();
  expect(screen.getByText("Lia")).toBeInTheDocument();
  fireEvent.click(screen.getByText("Lia"));
  expect(screen.getByText("P2 AI Agent topic")).toBeInTheDocument();
  expect(screen.queryByText("暂无任务")).not.toBeInTheDocument();
});

it("switches left sidebar mode through routes", () => {
  renderTasksSubSidebar();

  fireEvent.click(screen.getByRole("tab", { name: "任务" }));
  expect(mockNavigate).toHaveBeenCalledWith({ to: "/tasks/new-task" });

  fireEvent.click(screen.getByText("新对话"));
  expect(mockNavigate).toHaveBeenCalledWith({ to: HOME_ENTRY_PATH });
});

it("shows task actions and task list in task mode", async () => {
  pathname = "/tasks/new-task";
  mockListTasks.mockResolvedValue([
    makeTaskRun({
      id: "task-1",
      title: "任务模式里的任务",
      status: "completed",
    }),
  ]);

  renderTasksSubSidebar();

  expect(screen.getByRole("tab", { name: "任务" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.getByText("新任务")).toBeInTheDocument();
  expect(screen.getByText("任务看板")).toBeInTheDocument();
  expect(await screen.findByText("任务模式里的任务")).toBeInTheDocument();
  expect(screen.queryByText("AI Agents")).not.toBeInTheDocument();
});
```

- [ ] **Step 2.2: Run the failing sidebar tests**

Run:

```bash
pnpm --filter @team9/client test -- src/components/layout/sidebars/__tests__/TasksSubSidebar.test.tsx
```

Expected: FAIL because the mode tabs and conversation body do not exist.

- [ ] **Step 2.3: Implement route-derived sidebar mode**

In `TasksSubSidebar.tsx`, add imports:

```ts
import { useAgentGroupsForSidebar } from "@/hooks/useAgentGroupsForSidebar";
import {
  useDeleteTopicSession,
  useRenameTopicSession,
} from "@/hooks/useTopicSessions";
import { AgentGroupList } from "@/components/sidebar/AgentGroupList";
```

Add helpers:

```ts
type DashboardSidebarMode = "conversation" | "task";

function getDashboardSidebarMode(pathname: string): DashboardSidebarMode {
  return pathname === HOME_ENTRY_PATH ? "conversation" : "task";
}
```

Inside `TasksSubSidebar`, derive:

```ts
const activeMode = getDashboardSidebarMode(location.pathname);
const isConversationMode = activeMode === "conversation";
const isTaskMode = activeMode === "task";
```

Add handlers:

```ts
const openConversationMode = () => {
  appActions.setActiveSidebar("home");
  void navigate({ to: HOME_ENTRY_PATH });
};

const openTaskMode = () => {
  appActions.setActiveSidebar("home");
  void navigate({ to: TASK_ENTRY_PATH });
};
```

Render a `role="tablist"` segmented control under the header and conditionally render conversation or task content.

- [ ] **Step 2.4: Implement conversation body with AgentGroupList**

Wire:

```ts
const {
  groups: agentGroups,
  isLoading: isLoadingAgents,
  loadMoreTopicSessions,
  isLoadingMoreTopicSessions,
} = useAgentGroupsForSidebar(5);
const renameTopicSession = useRenameTopicSession();
const archiveTopicSession = useDeleteTopicSession();
const deleteTopicSession = useDeleteTopicSession();
```

In conversation mode, render:

```tsx
<div className="px-2 py-1 text-[0.7rem] font-semibold uppercase tracking-wide text-nav-foreground-faint">
  AI Agents
</div>
<AgentGroupList
  groups={agentGroups}
  linkPrefix="/channels"
  isLoading={isLoadingAgents}
  onLoadMoreTopicSessions={loadMoreTopicSessions}
  isLoadingMoreTopicSessions={isLoadingMoreTopicSessions}
  onRenameTopicSession={(channelId, title) =>
    renameTopicSession.mutateAsync({ channelId, title })
  }
  onArchiveTopicSession={(channelId) =>
    archiveTopicSession.mutateAsync({ channelId })
  }
  onDeleteTopicSession={(channelId) =>
    deleteTopicSession.mutateAsync({ channelId, permanent: true })
  }
  isTopicSessionActionPending={
    renameTopicSession.isPending ||
    archiveTopicSession.isPending ||
    deleteTopicSession.isPending
  }
  onNewTopic={(agentId) => {
    appActions.setActiveSidebar("home");
    void navigate({
      to: HOME_ENTRY_PATH,
      search: { agentId },
    });
  }}
/>
```

Keep the existing task query, grouping, task rows, rename dialog, and task actions in task mode.

- [ ] **Step 2.5: Verify sidebar tests pass**

Run:

```bash
pnpm --filter @team9/client test -- src/components/layout/sidebars/__tests__/TasksSubSidebar.test.tsx
```

Expected: PASS.

## Task 3: Dashboard Mode Route Synchronization

**Files:**

- Modify: `apps/client/src/routes/_authenticated/tasks/new-conversation.tsx`
- Modify: `apps/client/src/components/layout/contents/HomeMainContent.tsx`
- Modify: `apps/client/src/components/layout/contents/__tests__/HomeMainContent.test.tsx`

- [ ] **Step 3.1: Write failing route-sync test**

Update the existing `"animates mode switching in place while preserving the composer draft"` test by replacing both `expect(mockNavigate).not.toHaveBeenCalled()` assertions with:

```tsx
expect(mockNavigate).toHaveBeenCalledWith({ to: "/tasks/new-task" });
```

after clicking task mode, and:

```tsx
expect(mockNavigate).toHaveBeenCalledWith({
  to: "/tasks/new-conversation",
});
```

after clicking conversation mode.

- [ ] **Step 3.2: Run the failing HomeMainContent test**

Run:

```bash
pnpm --filter @team9/client test -- src/components/layout/contents/__tests__/HomeMainContent.test.tsx
```

Expected: FAIL because mode switching currently updates local state without navigating.

- [ ] **Step 3.3: Implement Dashboard mode navigation**

In `HomeMainContent.tsx`, change the store import:

```ts
import {
  HOME_ENTRY_PATH,
  TASK_ENTRY_PATH,
  useSelectedWorkspaceId,
} from "@/stores";
```

Add handler near other event handlers:

```ts
const handleModeChange = useCallback(
  (nextMode: DashboardMode) => {
    setMode(nextMode);
    void navigate({
      to: nextMode === "task" ? TASK_ENTRY_PATH : HOME_ENTRY_PATH,
    });
  },
  [navigate],
);
```

Pass it to the switch:

```tsx
<DashboardModeSwitch mode={mode} onModeChange={handleModeChange} />
```

- [ ] **Step 3.4: Add `agentId` search to tasks/new-conversation route**

Replace `apps/client/src/routes/_authenticated/tasks/new-conversation.tsx` with:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { HomeMainContent } from "@/components/layout/contents/HomeMainContent";

type TaskNewConversationSearch = {
  agentId?: string;
};

export const Route = createFileRoute("/_authenticated/tasks/new-conversation")({
  component: TaskNewConversationPage,
  validateSearch: (
    search: Record<string, unknown>,
  ): TaskNewConversationSearch => ({
    agentId:
      typeof search.agentId === "string" && search.agentId.length > 0
        ? search.agentId
        : undefined,
  }),
});

function TaskNewConversationPage() {
  const { agentId } = Route.useSearch();

  return <HomeMainContent agentId={agentId ?? null} />;
}
```

- [ ] **Step 3.5: Verify HomeMainContent tests pass**

Run:

```bash
pnpm --filter @team9/client test -- src/components/layout/contents/__tests__/HomeMainContent.test.tsx
```

Expected: PASS.

## Task 4: Integrated Verification

**Files:**

- All modified frontend files.

- [ ] **Step 4.1: Run all targeted tests**

Run:

```bash
pnpm --filter @team9/client test -- src/components/layout/sidebars/__tests__/TasksSubSidebar.test.tsx src/components/sidebar/__tests__/AgentGroupList.test.tsx src/components/layout/contents/__tests__/HomeMainContent.test.tsx
```

Expected: PASS.

- [ ] **Step 4.2: Run client typecheck**

Run:

```bash
pnpm --filter @team9/client typecheck
```

Expected: PASS.

- [ ] **Step 4.3: Run client lint in CI mode**

Run:

```bash
pnpm --filter @team9/client lint:ci
```

Expected: PASS.

- [ ] **Step 4.4: Commit implementation**

Run:

```bash
git add apps/client/src/components/layout/sidebars/TasksSubSidebar.tsx \
        apps/client/src/components/layout/sidebars/__tests__/TasksSubSidebar.test.tsx \
        apps/client/src/components/sidebar/AgentGroupList.tsx \
        apps/client/src/components/sidebar/__tests__/AgentGroupList.test.tsx \
        apps/client/src/routes/_authenticated/tasks/new-conversation.tsx \
        apps/client/src/components/layout/contents/HomeMainContent.tsx \
        apps/client/src/components/layout/contents/__tests__/HomeMainContent.test.tsx \
        docs/superpowers/plans/2026-05-22-dashboard-sidebar-mode-sync.md
git commit -m "feat(dashboard): sync sidebar task and conversation modes"
```

Expected: commit succeeds.
