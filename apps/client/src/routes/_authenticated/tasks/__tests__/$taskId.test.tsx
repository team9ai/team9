import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { JSX, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetTaskById = vi.fn();
const mockStartTaskRun = vi.fn();
const mockUnhideTask = vi.fn();
const mockActivateTask = vi.fn();
let taskId = "task-1";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
  createFileRoute: () => (config: unknown) => ({
    __config: config,
    useParams: () => ({ taskId }),
  }),
}));

vi.mock("@/services/api/tasks", () => ({
  tasksApi: {
    getById: (id: string) => mockGetTaskById(id),
    start: (id: string, dto: unknown) => mockStartTaskRun(id, dto),
    unhide: (id: string) => mockUnhideTask(id),
    activate: (id: string) => mockActivateTask(id),
  },
}));

vi.mock("@/components/layout/contents/HomeMainContent", () => ({
  HomeMainContent: ({ mode }: { mode?: string }) => (
    <div data-testid="home-main-content" data-mode={mode} />
  ),
}));

vi.mock("@/components/channel/ChannelView", () => ({
  ChannelView: ({
    channelId,
    readOnly,
    readOnlyAction,
    isAgentSessionPanelOpen,
  }: {
    channelId: string;
    readOnly?: boolean;
    readOnlyAction?: ReactNode;
    isAgentSessionPanelOpen?: boolean;
  }) => (
    <div>
      <div
        data-testid="channel-view"
        data-read-only={readOnly ? "true" : "false"}
      >
        {channelId}
      </div>
      {readOnlyAction ? <div>{readOnlyAction}</div> : null}
      {isAgentSessionPanelOpen ? <aside>Agent Session Panel</aside> : null}
    </div>
  ),
}));

import { Route as TaskDetailRoute } from "../$taskId";
import type { TaskRunDetail } from "@/types/task";

function makeTaskRunDetail(
  overrides: Partial<TaskRunDetail> = {},
): TaskRunDetail {
  return {
    id: "task-1",
    tenantId: "tenant-1",
    routineId: null,
    routineVersion: null,
    botId: "bot-1",
    creatorId: "user-1",
    title: "测试",
    description: "测试",
    status: "in_progress",
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
    hiddenAt: null,
    archivedAt: null,
    deliverables: [],
    createdAt: "2026-05-20T00:00:00.000Z",
    updatedAt: "2026-05-20T00:00:00.000Z",
    ...overrides,
  };
}

function renderRoute({
  initialTasks,
}: { initialTasks?: TaskRunDetail[] } = {}) {
  const Component = (
    TaskDetailRoute as unknown as { __config: { component: () => JSX.Element } }
  ).__config.component;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (initialTasks) {
    queryClient.setQueryData(["tasks"], initialTasks);
  }

  const renderResult = render(
    <QueryClientProvider client={queryClient}>
      <Component />
    </QueryClientProvider>,
  );

  return { ...renderResult, queryClient };
}

describe("/_authenticated/tasks/$taskId route", () => {
  beforeEach(() => {
    taskId = "task-1";
    mockGetTaskById.mockReset();
    mockStartTaskRun.mockReset();
    mockUnhideTask.mockReset();
    mockActivateTask.mockReset();
    mockUnhideTask.mockResolvedValue({ id: "task-1" });
    mockActivateTask.mockResolvedValue(makeTaskRunDetail());
  });

  it("renders the task creation composer when the reserved new-task slug reaches the dynamic route", () => {
    taskId = "new-task";

    renderRoute();

    expect(screen.getByTestId("home-main-content")).toHaveAttribute(
      "data-mode",
      "task",
    );
    expect(mockGetTaskById).not.toHaveBeenCalled();
  });

  it("starts a pending task from editable execution info when no execution channel exists", async () => {
    mockGetTaskById.mockResolvedValue(
      makeTaskRunDetail({
        title: "找 30 个 YouTube 达人",
        description: "请根据需求找达人并整理联系方式",
        status: "upcoming",
        channelId: null,
      }),
    );
    mockStartTaskRun.mockResolvedValueOnce({ id: "task-1" });

    renderRoute();

    const executionInfo = await screen.findByLabelText("本次执行信息");
    expect(executionInfo).toHaveValue("请根据需求找达人并整理联系方式");
    expect(screen.queryByText("暂无执行频道")).not.toBeInTheDocument();

    fireEvent.change(executionInfo, {
      target: { value: "请优先找户外生活类 YouTube 达人" },
    });
    fireEvent.click(screen.getByRole("button", { name: "开始执行" }));

    await waitFor(() => {
      expect(mockStartTaskRun).toHaveBeenCalledWith("task-1", {
        message: "请优先找户外生活类 YouTube 达人",
      });
    });
  });

  it("opens and closes the session side panel from the task header", async () => {
    mockGetTaskById.mockResolvedValue(
      makeTaskRunDetail({
        title: "找 30 个 YouTube 达人",
        description: "请根据需求找达人并整理联系方式",
        status: "in_progress",
        channelId: "channel-1",
      }),
    );

    renderRoute();

    await screen.findByTestId("channel-view");
    expect(screen.queryByText("Agent Session Panel")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "打开 Session 面板" }));

    expect(screen.getByText("Agent Session Panel")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "关闭 Session 面板" }));

    expect(screen.queryByText("Agent Session Panel")).not.toBeInTheDocument();
  });

  it("unhides a hidden task when its detail route is opened", async () => {
    mockGetTaskById.mockResolvedValue(
      makeTaskRunDetail({
        title: "隐藏过的任务",
        description: "点开后恢复显示",
        status: "completed",
        channelId: "channel-1",
        hiddenAt: "2026-05-21T00:00:00.000Z",
        archivedAt: null,
      }),
    );

    renderRoute();

    await screen.findByText("隐藏过的任务");

    await waitFor(() => {
      expect(mockUnhideTask).toHaveBeenCalledWith("task-1");
    });
  });

  it("keeps timed-out but unarchived task channels editable", async () => {
    mockGetTaskById.mockResolvedValue(
      makeTaskRunDetail({
        title: "超时任务",
        status: "timeout",
        archivedAt: null,
      }),
    );

    renderRoute();

    expect(await screen.findByText("超时任务")).toBeInTheDocument();
    expect(screen.getByTestId("channel-view")).toHaveAttribute(
      "data-read-only",
      "false",
    );
    expect(
      screen.queryByRole("button", { name: "激活任务" }),
    ).not.toBeInTheDocument();
  });

  it("shows an activation action for archived task channels", async () => {
    mockGetTaskById.mockResolvedValue(
      makeTaskRunDetail({
        title: "已归档任务",
        archivedAt: "2026-05-21T00:00:00.000Z",
      }),
    );
    mockActivateTask.mockResolvedValueOnce(
      makeTaskRunDetail({
        title: "已归档任务",
        archivedAt: null,
      }),
    );

    renderRoute();

    expect(await screen.findByText("已归档任务")).toBeInTheDocument();
    expect(screen.getByTestId("channel-view")).toHaveAttribute(
      "data-read-only",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "激活任务" }));

    await waitFor(() => {
      expect(mockActivateTask).toHaveBeenCalledWith("task-1");
    });
    await waitFor(() => {
      expect(screen.getByTestId("channel-view")).toHaveAttribute(
        "data-read-only",
        "false",
      );
    });
  });

  it("syncs the loaded task status back into the task list cache", async () => {
    mockGetTaskById.mockResolvedValue(
      makeTaskRunDetail({
        title: "测试",
        status: "timeout",
      }),
    );

    const { queryClient } = renderRoute({
      initialTasks: [
        makeTaskRunDetail({
          id: "task-1",
          status: "in_progress",
        }),
      ],
    });

    await screen.findByText("已超时");

    await waitFor(() => {
      expect(
        queryClient.getQueryData<TaskRunDetail[]>(["tasks"])?.[0],
      ).toMatchObject({
        id: "task-1",
        status: "timeout",
      });
    });
  });
});
