import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { JSX, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskRun } from "@/types/task";

const mockNavigate = vi.fn();
const mockListTasks = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: unknown) => ({ __config: config }),
  useNavigate: () => mockNavigate,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock("@/services/api/tasks", () => ({
  tasksApi: {
    list: () => mockListTasks(),
  },
}));

import { Route as TasksRoute } from "../index";

function makeTask(overrides: Partial<TaskRun>): TaskRun {
  return {
    id: "run-1",
    tenantId: "tenant-1",
    routineId: null,
    routineVersion: null,
    botId: "bot-1",
    creatorId: "user-1",
    title: "Task",
    description: null,
    status: "upcoming",
    channelId: "channel-1",
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
    createdAt: "2026-05-14T00:00:00.000Z",
    updatedAt: "2026-05-14T00:00:00.000Z",
    ...overrides,
  };
}

function renderRoute() {
  const Component = (
    TasksRoute as unknown as { __config: { component: () => JSX.Element } }
  ).__config.component;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return render(<Component />, { wrapper });
}

describe("/_authenticated/tasks/ index route", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockListTasks.mockResolvedValue([
      makeTask({
        id: "pending-1",
        title: "确定 618 营销任务 Brief",
        status: "upcoming",
      }),
      makeTask({
        id: "running-1",
        title: "东鹏特饮找20位 KOC",
        status: "in_progress",
      }),
      makeTask({
        id: "done-1",
        title: "整理上周投放复盘",
        status: "completed",
      }),
      makeTask({
        id: "archived-1",
        title: "已停止任务",
        status: "stopped",
      }),
    ]);
  });

  it("renders routine-backed tasks in kanban status columns", async () => {
    renderRoute();

    expect(screen.getByTestId("tasks-board-page")).toHaveClass("bg-background");

    const pendingColumn = await screen.findByTestId("task-column-pending");
    const runningColumn = screen.getByTestId("task-column-running");
    const completedColumn = screen.getByTestId("task-column-completed");
    const archivedColumn = screen.getByTestId("task-column-archived");

    expect(within(pendingColumn).getByText("待执行")).toBeInTheDocument();
    expect(within(pendingColumn).getByText("1")).toBeInTheDocument();
    expect(
      within(pendingColumn).getByText("确定 618 营销任务 Brief"),
    ).toBeInTheDocument();
    expect(within(runningColumn).getByText("执行中")).toBeInTheDocument();
    expect(
      within(runningColumn).getByText("东鹏特饮找20位 KOC"),
    ).toBeInTheDocument();
    expect(within(completedColumn).getByText("执行完毕")).toBeInTheDocument();
    expect(within(archivedColumn).getByText("归档")).toBeInTheDocument();
  });

  it("opens the task detail route instead of navigating into routines", async () => {
    renderRoute();

    fireEvent.click(await screen.findByText("东鹏特饮找20位 KOC"));

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/tasks/$taskId",
      params: { taskId: "running-1" },
    });
  });
});
