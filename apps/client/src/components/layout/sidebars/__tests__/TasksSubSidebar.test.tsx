import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HOME_ENTRY_PATH, useAppStore, useHomeStore } from "@/stores";
import type { TaskRun } from "@/types/task";

const mockNavigate = vi.fn();
const mockListTasks = vi.fn();
const mockCreateTask = vi.fn();
const mockUpdateTask = vi.fn();
const mockHideTask = vi.fn();
const mockArchiveTask = vi.fn();
const mockDeleteTask = vi.fn();
const mockLoadMoreTopicSessions = vi.fn();
const mockRenameTopicSession = vi.fn();
const mockArchiveTopicSession = vi.fn();
const mockDeleteTopicSession = vi.fn();
let pathname = HOME_ENTRY_PATH;
let params: { taskId?: string; channelId?: string } = {};

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div role="menu">{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onSelect,
    className,
  }: {
    children: ReactNode;
    onSelect?: () => void;
    className?: string;
  }) => (
    <button
      type="button"
      role="menuitem"
      className={className}
      onClick={onSelect}
    >
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr role="separator" />,
}));

vi.mock("@/components/ui/context-menu", () => ({
  ContextMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  ContextMenuTrigger: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  ContextMenuContent: () => null,
  ContextMenuItem: () => null,
  ContextMenuSeparator: () => null,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    onClick,
    className,
    ...props
  }: {
    children: ReactNode;
    onClick?: () => void;
    className?: string;
  } & Record<string, unknown>) => (
    <button type="button" onClick={onClick} className={className} {...props}>
      {children}
    </button>
  ),
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname }),
  useParams: () => params,
}));

vi.mock("@/services/api/tasks", () => ({
  tasksApi: {
    list: () => mockListTasks(),
    create: () => mockCreateTask(),
    update: (id: string, dto: unknown) => mockUpdateTask(id, dto),
    hide: (id: string) => mockHideTask(id),
    archive: (id: string) => mockArchiveTask(id),
    delete: (id: string) => mockDeleteTask(id),
  },
}));

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

import {
  TASK_SIDEBAR_MAX_VISIBLE_TASKS,
  TasksSubSidebar,
} from "../TasksSubSidebar";

function makeTaskRun(
  overrides: Partial<TaskRun> & {
    hiddenAt?: string | null;
    archivedAt?: string | null;
  } = {},
): TaskRun {
  return {
    id: "task-1",
    tenantId: "tenant-1",
    routineId: null,
    routineVersion: null,
    botId: null,
    creatorId: "user-1",
    title: "Task",
    description: null,
    status: "in_progress",
    channelId: null,
    taskcastTaskId: null,
    tokenUsage: 0,
    startedAt: null,
    completedAt: null,
    duration: null,
    error: null,
    triggerId: null,
    triggerType: null,
    triggerContext: null,
    documentVersionId: null,
    sourceRunId: null,
    hiddenAt: null,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderTasksSubSidebar() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <TasksSubSidebar />
    </QueryClientProvider>,
  );
}

describe("TasksSubSidebar", () => {
  beforeEach(() => {
    pathname = HOME_ENTRY_PATH;
    params = {};
    window.history.replaceState(null, "", HOME_ENTRY_PATH);
    mockNavigate.mockClear();
    mockUpdateTask.mockReset();
    mockHideTask.mockReset();
    mockArchiveTask.mockReset();
    mockDeleteTask.mockReset();
    mockLoadMoreTopicSessions.mockReset();
    mockRenameTopicSession.mockReset();
    mockArchiveTopicSession.mockReset();
    mockDeleteTopicSession.mockReset();
    mockListTasks.mockResolvedValue([]);
    mockCreateTask.mockResolvedValue({ id: "run-1" });
    mockUpdateTask.mockResolvedValue({ id: "run-1" });
    mockHideTask.mockResolvedValue({ id: "run-1" });
    mockArchiveTask.mockResolvedValue({ id: "run-1" });
    mockDeleteTask.mockResolvedValue(undefined);
    useAppStore.getState().reset();
    useHomeStore.getState().reset();
  });

  it("labels the former task sidebar as Home", () => {
    renderTasksSubSidebar();

    expect(screen.getByText("首页")).toBeInTheDocument();
  });

  it("keeps the task conversation controls under the home section", () => {
    useAppStore.getState().setActiveSidebar("tasks");
    renderTasksSubSidebar();

    fireEvent.click(screen.getByText("新对话"));

    expect(useAppStore.getState().activeSidebar).toBe("home");
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe(HOME_ENTRY_PATH);
  });

  it("renders compact conversation and task tabs below the dashboard actions", () => {
    renderTasksSubSidebar();

    const tablist = screen.getByRole("tablist", { name: "首页模式" });
    const taskBoardAction = screen.getByText("任务看板");

    expect(taskBoardAction.compareDocumentPosition(tablist)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(tablist).toHaveClass(
      "mx-auto",
      "grid",
      "grid-cols-2",
      "max-w-36",
      "rounded-xl",
      "p-0.5",
      "text-xs",
    );
    expect(screen.getByRole("tab", { name: "对话" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "任务" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("animates the sidebar mode switch affordance and content", () => {
    renderTasksSubSidebar();

    expect(screen.getByTestId("dashboard-sidebar-mode-indicator")).toHaveClass(
      "left-0.5",
      "transition-[left]",
      "duration-200",
    );
    expect(screen.getByTestId("dashboard-sidebar-mode-content")).toHaveClass(
      "animate-in",
      "fade-in-0",
      "slide-in-from-top-1",
      "duration-150",
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

  it("stays in conversation mode when viewing an agent channel from Home", () => {
    // Opening a topic session or agent DM navigates to /channels/$channelId.
    // The Home sidebar must remain in conversation mode (AI Agents list)
    // instead of flipping to the task list.
    pathname = "/channels/agent-channel-1";
    params = { channelId: "agent-channel-1" };

    renderTasksSubSidebar();

    expect(useHomeStore.getState().dashboardMode).toBe("conversation");
    expect(screen.getByText("AI Agents")).toBeInTheDocument();
    expect(screen.queryByText("暂无任务")).not.toBeInTheDocument();
  });

  it("switches left sidebar mode without remounting the dashboard route", async () => {
    renderTasksSubSidebar();

    fireEvent.click(screen.getByRole("tab", { name: "任务" }));
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(useHomeStore.getState().dashboardMode).toBe("task");
    expect(
      screen.queryByRole("tablist", { name: "首页模式" }),
    ).not.toBeInTheDocument();
    expect(await screen.findByText("暂无任务")).toBeInTheDocument();
    expect(screen.getByText("新对话").closest("button")).not.toHaveClass(
      "bg-nav-active",
    );

    fireEvent.click(screen.getByText("新对话"));
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(useHomeStore.getState().dashboardMode).toBe("conversation");
    expect(screen.getByRole("tab", { name: "对话" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("新对话").closest("button")).toHaveClass(
      "bg-nav-active",
    );
    expect(screen.getByText("AI Agents")).toBeInTheDocument();
  });

  it("switches to the task draft entry through pseudo-routing when already on the dashboard", () => {
    renderTasksSubSidebar();

    fireEvent.click(screen.getByText("新任务"));

    expect(mockCreateTask).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(useHomeStore.getState().dashboardMode).toBe("task");
    expect(window.location.pathname).toBe("/tasks/new-task");
  });

  it("navigates to the task draft entry when starting from another task page", () => {
    pathname = "/tasks/task-1";
    window.history.replaceState(null, "", "/tasks/task-1");

    renderTasksSubSidebar();

    fireEvent.click(screen.getByText("新任务"));

    expect(mockCreateTask).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/tasks/new-task",
    });
  });

  it("marks the home conversation entry as selected", () => {
    renderTasksSubSidebar();

    expect(screen.getByText("新对话").closest("button")).toHaveClass(
      "bg-nav-active",
    );
    expect(screen.getByText("任务看板").closest("button")).not.toHaveClass(
      "bg-nav-active",
    );
  });

  it("marks the task draft entry as selected", () => {
    pathname = "/tasks/new-task";
    window.history.replaceState(null, "", "/tasks/new-task");

    renderTasksSubSidebar();

    expect(
      screen.queryByRole("tablist", { name: "首页模式" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "任务" })).not.toBeInTheDocument();
    expect(screen.getByText("新任务").closest("button")).toHaveClass(
      "bg-nav-active",
    );
    expect(screen.getByText("新对话").closest("button")).not.toHaveClass(
      "bg-nav-active",
    );
  });

  it("constrains long task titles to the sidebar width before truncating", async () => {
    pathname = "/tasks/new-task";
    const longTitle =
      "请你根据下面这个要求给我找youtube平台的 30 个竞品账号并输出完整分析报告";
    mockListTasks.mockResolvedValue([
      makeTaskRun({
        id: "task-long",
        routineId: "routine-1",
        title: longTitle,
      }),
    ]);

    renderTasksSubSidebar();

    const taskTitle = await screen.findByText(longTitle);
    const taskRow = taskTitle.closest('[data-testid="task-sidebar-row"]');
    const taskScroller = screen.getByTestId("tasks-sub-sidebar-scroll");

    expect(taskScroller).toHaveClass("overflow-y-auto");
    expect(taskScroller.querySelector("[data-slot='scroll-area']")).toBeNull();
    expect(taskRow).toHaveClass("max-w-full", "overflow-hidden");
    expect(taskTitle).toHaveClass("min-w-0", "flex-1", "truncate");
  });

  it("only shows normal unhidden task rows in the sidebar", async () => {
    pathname = "/tasks/new-task";
    mockListTasks.mockResolvedValue([
      makeTaskRun({
        id: "running-1",
        title: "正在执行的任务",
        status: "in_progress",
      }),
      makeTaskRun({
        id: "completed-1",
        title: "待查收结果",
        status: "completed",
      }),
      makeTaskRun({
        id: "upcoming-1",
        title: "待执行不显示",
        status: "upcoming",
      }),
      makeTaskRun({
        id: "draft-1",
        title: "草稿不显示",
        status: "draft",
      }),
      makeTaskRun({
        id: "failed-1",
        title: "失败任务显示",
        status: "failed",
      }),
      makeTaskRun({
        id: "timeout-1",
        title: "超时任务显示",
        status: "timeout",
      }),
      makeTaskRun({
        id: "hidden-1",
        title: "隐藏不显示",
        status: "in_progress",
        hiddenAt: "2026-01-02T00:00:00.000Z",
      }),
      makeTaskRun({
        id: "archived-1",
        title: "手动归档不显示",
        status: "completed",
        archivedAt: "2026-01-02T00:00:00.000Z",
      }),
    ]);

    renderTasksSubSidebar();

    expect(await screen.findByText("正在执行的任务")).toBeInTheDocument();
    expect(screen.getByText("待查收结果")).toBeInTheDocument();
    expect(screen.getByText("失败任务显示")).toBeInTheDocument();
    expect(screen.getByText("失败")).toBeInTheDocument();
    expect(screen.getByText("超时任务显示")).toBeInTheDocument();
    expect(screen.queryByText("已超时")).not.toBeInTheDocument();
    expect(screen.queryByText("待执行不显示")).not.toBeInTheDocument();
    expect(screen.queryByText("草稿不显示")).not.toBeInTheDocument();
    expect(screen.queryByText("隐藏不显示")).not.toBeInTheDocument();
    expect(screen.queryByText("手动归档不显示")).not.toBeInTheDocument();
  });

  it("renders task group labels with the subdued section heading style", async () => {
    pathname = "/tasks/new-task";
    mockListTasks.mockResolvedValue([
      makeTaskRun({
        id: "personal-task",
        title: "个人任务",
        routineId: null,
        status: "in_progress",
      }),
      makeTaskRun({
        id: "routine-task",
        title: "日常任务",
        routineId: "routine-1",
        status: "timeout",
      }),
    ]);

    renderTasksSubSidebar();

    await screen.findByText("个人任务");

    for (const label of ["我的任务", "@日常"]) {
      expect(screen.getByText(label)).toHaveClass(
        "text-[0.7rem]",
        "font-semibold",
        "uppercase",
        "tracking-wide",
        "text-nav-foreground-faint",
      );
    }
  });

  it("omits the extra task section heading above task groups", async () => {
    pathname = "/tasks/new-task";
    mockListTasks.mockResolvedValue([
      makeTaskRun({
        id: "personal-task",
        title: "个人任务",
        routineId: null,
        status: "in_progress",
      }),
    ]);

    renderTasksSubSidebar();

    await screen.findByText("个人任务");

    const modeContent = screen.getByTestId("dashboard-sidebar-mode-content");
    expect(
      screen.queryByRole("tablist", { name: "首页模式" }),
    ).not.toBeInTheDocument();
    expect(within(modeContent).queryByText("任务")).not.toBeInTheDocument();
    expect(within(modeContent).getByText("我的任务")).toBeInTheDocument();
  });

  it("offers task row actions from the hover menu", async () => {
    pathname = "/tasks/new-task";
    mockListTasks.mockResolvedValue([
      makeTaskRun({
        id: "task-actions",
        title: "可操作任务",
        status: "in_progress",
      }),
    ]);

    renderTasksSubSidebar();

    await screen.findByText("可操作任务");

    expect(
      screen.getByRole("button", { name: "可操作任务更多操作" }),
    ).toHaveClass("absolute", "opacity-0", "group-hover:opacity-100");
    expect(screen.getByText("进行中")).toHaveClass(
      "group-hover:mr-7",
      "group-focus-within:mr-7",
    );
    expect(
      screen.getByRole("menuitem", { name: "重命名" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "隐藏" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "归档" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "删除" })).toBeInTheDocument();
  });

  it("keeps the rename dialog open and explains when saving fails", async () => {
    pathname = "/tasks/new-task";
    mockListTasks.mockResolvedValue([
      makeTaskRun({
        id: "task-actions",
        title: "可操作任务",
        status: "in_progress",
      }),
    ]);
    mockUpdateTask.mockRejectedValue(
      new Error("Request failed with status 404"),
    );

    renderTasksSubSidebar();

    await screen.findByText("可操作任务");
    fireEvent.click(screen.getByRole("menuitem", { name: "重命名" }));
    fireEvent.change(screen.getByLabelText("任务标题"), {
      target: { value: "可操作任务 123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(screen.getByText("保存失败，请稍后重试。")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("dialog", { name: "重命名任务" }),
    ).toBeInTheDocument();
  });

  it("caps rendered task rows so the Mac sidebar does not lay out every normal task", async () => {
    pathname = "/tasks/new-task";
    const tasks = Array.from(
      { length: TASK_SIDEBAR_MAX_VISIBLE_TASKS + 3 },
      (_, index) =>
        makeTaskRun({
          id: `task-${index + 1}`,
          title: `Task ${index + 1}`,
          status: index % 2 === 0 ? "completed" : "in_progress",
        }),
    );
    mockListTasks.mockResolvedValue(tasks);

    renderTasksSubSidebar();

    await screen.findByText("Task 1");

    expect(screen.getAllByTestId("task-sidebar-row")).toHaveLength(
      TASK_SIDEBAR_MAX_VISIBLE_TASKS,
    );
    expect(
      screen.queryByText(`Task ${TASK_SIDEBAR_MAX_VISIBLE_TASKS + 1}`),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("还有 3 个任务，可在任务看板查看。"),
    ).toBeInTheDocument();
  });
});
