import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { JSX, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetTaskById = vi.fn();
const mockUnhideTask = vi.fn();
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
    unhide: (id: string) => mockUnhideTask(id),
  },
}));

vi.mock("@/components/channel/ChannelView", () => ({
  ChannelView: ({ channelId }: { channelId: string }) => (
    <div data-testid="channel-view">{channelId}</div>
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
    mockUnhideTask.mockReset();
    mockUnhideTask.mockResolvedValue({ id: "task-1" });
  });

  it("unhides a hidden task when its detail route is opened", async () => {
    mockGetTaskById.mockResolvedValue({
      id: "task-1",
      title: "隐藏过的任务",
      description: "点开后恢复显示",
      status: "completed",
      channelId: "channel-1",
      hiddenAt: "2026-05-21T00:00:00.000Z",
      archivedAt: null,
    });

    renderRoute();

    await screen.findByText("隐藏过的任务");

    await waitFor(() => {
      expect(mockUnhideTask).toHaveBeenCalledWith("task-1");
    });
  });
});
