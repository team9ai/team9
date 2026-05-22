import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HOME_ENTRY_PATH, useAppStore } from "@/stores";
import type { TaskRun } from "@/types/task";

const mockNavigate = vi.fn();
const mockListTasks = vi.fn();
const mockCreateTask = vi.fn();
const mockUpdateTask = vi.fn();
const mockHideTask = vi.fn();
const mockArchiveTask = vi.fn();
const mockDeleteTask = vi.fn();
let pathname = HOME_ENTRY_PATH;
let params: { taskId?: string } = {};

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
    mockNavigate.mockClear();
    mockUpdateTask.mockReset();
    mockHideTask.mockReset();
    mockArchiveTask.mockReset();
    mockDeleteTask.mockReset();
    mockListTasks.mockResolvedValue([]);
    mockCreateTask.mockResolvedValue({ id: "run-1" });
    mockUpdateTask.mockResolvedValue({ id: "run-1" });
    mockHideTask.mockResolvedValue({ id: "run-1" });
    mockArchiveTask.mockResolvedValue({ id: "run-1" });
    mockDeleteTask.mockResolvedValue(undefined);
    useAppStore.getState().reset();
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
    expect(mockNavigate).toHaveBeenCalledWith({
      to: HOME_ENTRY_PATH,
    });
  });

  it("opens a task draft page when starting a new task", () => {
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

    renderTasksSubSidebar();

    expect(screen.getByText("新任务").closest("button")).toHaveClass(
      "bg-nav-active",
    );
    expect(screen.getByText("新对话").closest("button")).not.toHaveClass(
      "bg-nav-active",
    );
  });

  it("constrains long task titles to the sidebar width before truncating", async () => {
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
    expect(screen.getByText("已超时")).toBeInTheDocument();
    expect(screen.queryByText("待执行不显示")).not.toBeInTheDocument();
    expect(screen.queryByText("草稿不显示")).not.toBeInTheDocument();
    expect(screen.queryByText("隐藏不显示")).not.toBeInTheDocument();
    expect(screen.queryByText("手动归档不显示")).not.toBeInTheDocument();
  });

  it("offers task row actions from the hover menu", async () => {
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
