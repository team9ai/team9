import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { JSX, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetTaskById = vi.fn();
const mockStartTaskRun = vi.fn();
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
    isAgentSessionPanelOpen,
  }: {
    channelId: string;
    isAgentSessionPanelOpen?: boolean;
  }) => (
    <div>
      <div data-testid="channel-view">{channelId}</div>
      {isAgentSessionPanelOpen ? <aside>Agent Session Panel</aside> : null}
    </div>
  ),
}));

import { Route as TaskDetailRoute } from "../$taskId";

function renderRoute() {
  const Component = (
    TaskDetailRoute as unknown as { __config: { component: () => JSX.Element } }
  ).__config.component;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <Component />
    </QueryClientProvider>,
  );
}

describe("/_authenticated/tasks/$taskId route", () => {
  beforeEach(() => {
    taskId = "task-1";
    mockGetTaskById.mockReset();
    mockStartTaskRun.mockReset();
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
    mockGetTaskById.mockResolvedValue({
      id: "task-1",
      title: "找 30 个 YouTube 达人",
      description: "请根据需求找达人并整理联系方式",
      status: "upcoming",
      channelId: null,
    });
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
    mockGetTaskById.mockResolvedValue({
      id: "task-1",
      title: "找 30 个 YouTube 达人",
      description: "请根据需求找达人并整理联系方式",
      status: "in_progress",
      channelId: "channel-1",
    });

    renderRoute();

    await screen.findByTestId("channel-view");
    expect(screen.queryByText("Agent Session Panel")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "打开 Session 面板" }));

    expect(screen.getByText("Agent Session Panel")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "关闭 Session 面板" }));

    expect(screen.queryByText("Agent Session Panel")).not.toBeInTheDocument();
  });
});
