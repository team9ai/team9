import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@/stores";

const mockNavigate = vi.fn();
const mockListTasks = vi.fn();
const mockCreateTask = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  useNavigate: () => mockNavigate,
  useParams: () => ({}),
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
    mockNavigate.mockClear();
    mockListTasks.mockResolvedValue([]);
    mockCreateTask.mockResolvedValue({ id: "run-1" });
    useAppStore.getState().reset();
    useAppStore.getState().setActiveSidebar("tasks");
  });

  it("opens the home dashboard when starting a new conversation", () => {
    renderTasksSubSidebar();

    fireEvent.click(screen.getByText("新对话"));

    expect(useAppStore.getState().activeSidebar).toBe("home");
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/channels" });
  });
});
