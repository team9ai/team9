import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HOME_ENTRY_PATH, useAppStore } from "@/stores";
import type { TaskRun } from "@/types/task";

const mockNavigate = vi.fn();
const mockListTasks = vi.fn();
const mockCreateTask = vi.fn();
let pathname = HOME_ENTRY_PATH;
let params: { taskId?: string } = {};

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    onClick,
    className,
  }: {
    children: ReactNode;
    onClick?: () => void;
    className?: string;
  }) => (
    <button type="button" onClick={onClick} className={className}>
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
  },
}));

import { TasksSubSidebar } from "../TasksSubSidebar";

function makeTaskRun(overrides: Partial<TaskRun> = {}): TaskRun {
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
    mockListTasks.mockResolvedValue([]);
    mockCreateTask.mockResolvedValue({ id: "run-1" });
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

    const { container } = renderTasksSubSidebar();

    const taskTitle = await screen.findByText(longTitle);
    const taskRow = taskTitle.closest("button");
    const scrollArea = container.querySelector("[data-slot='scroll-area']");

    expect(scrollArea).toHaveClass(
      "[&>[data-slot=scroll-area-viewport]>div]:block!",
    );
    expect(taskRow).toHaveClass("max-w-full", "overflow-hidden");
    expect(taskTitle).toHaveClass("min-w-0", "flex-1", "truncate");
  });
});
