import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@/stores";

const mockNavigate = vi.fn();
const mockListTasks = vi.fn();
const mockCreateTask = vi.fn();
let pathname = "/tasks";
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
    pathname = "/tasks";
    params = {};
    mockNavigate.mockClear();
    mockListTasks.mockResolvedValue([]);
    mockCreateTask.mockResolvedValue({ id: "run-1" });
    useAppStore.getState().reset();
    useAppStore.getState().setActiveSidebar("tasks");
  });

  it("keeps the task sidebar when starting a new conversation", () => {
    renderTasksSubSidebar();

    fireEvent.click(screen.getByText("新对话"));

    expect(useAppStore.getState().activeSidebar).toBe("tasks");
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/tasks/new-conversation",
    });
  });

  it("marks the in-task new conversation view as selected", () => {
    pathname = "/tasks/new-conversation";
    renderTasksSubSidebar();

    expect(screen.getByText("新对话").closest("button")).toHaveClass(
      "bg-nav-active",
    );
    expect(screen.getByText("任务看板").closest("button")).not.toHaveClass(
      "bg-nav-active",
    );
  });
});
