import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";

const mockNavigate = vi.fn();
const mockGetExecutions = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/services/api/routines", () => ({
  routinesApi: {
    getExecutions: (...args: unknown[]) => mockGetExecutions(...args),
  },
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../RunListItem", () => ({
  RunListItem: ({
    execution,
    isSelected,
    onClick,
  }: {
    execution: { id: string };
    isSelected: boolean;
    onClick: () => void;
  }) => (
    <button
      data-testid={`run-${execution.id}`}
      data-selected={isSelected ? "true" : "false"}
      onClick={onClick}
    >
      run-{execution.id}
    </button>
  ),
}));

import { RoutineRunsTab } from "../RoutineRunsTab";
import type { RoutineExecution } from "@/types/routine";

function makeExecutions(n: number): RoutineExecution[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `e${i}`,
    routineId: "r1",
    routineVersion: 1,
    status: "completed" as const,
    channelId: null,
    taskcastTaskId: null,
    tokenUsage: 0,
    triggerId: null,
    triggerType: null,
    triggerContext: null,
    documentVersionId: null,
    sourceExecutionId: null,
    startedAt: "2026-04-26T08:00:00Z",
    completedAt: "2026-04-26T08:01:00Z",
    duration: 60,
    error: null,
    createdAt: "2026-04-26T08:00:00Z",
  }));
}

function renderTab(
  props: { active?: boolean; selectedExecutionId?: string | null } = {},
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <RoutineRunsTab
        routineId="r1"
        selectedExecutionId={props.selectedExecutionId ?? null}
        active={props.active ?? true}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetExecutions.mockReset();
});

describe("RoutineRunsTab", () => {
  it("renders empty state when no executions", async () => {
    mockGetExecutions.mockResolvedValue([]);
    renderTab();
    await waitFor(() => {
      expect(screen.getByText("historyTab.empty")).toBeInTheDocument();
    });
    expect(screen.queryByText("detail.showMore")).toBeNull();
  });

  it("renders all executions and no Show-more when count <= 20", async () => {
    mockGetExecutions.mockResolvedValue(makeExecutions(20));
    renderTab();
    await waitFor(() => {
      expect(screen.getByTestId("run-e0")).toBeInTheDocument();
      expect(screen.getByTestId("run-e19")).toBeInTheDocument();
    });
    expect(screen.queryByText("detail.showMore")).toBeNull();
  });

  it("shows first 20 and 'Show 20 more' when more exist; appends in batches of 20", async () => {
    mockGetExecutions.mockResolvedValue(makeExecutions(45));
    renderTab();
    await waitFor(() => {
      expect(screen.getByTestId("run-e0")).toBeInTheDocument();
      expect(screen.getByTestId("run-e19")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("run-e20")).toBeNull();
    expect(screen.getByText("detail.showMore")).toBeInTheDocument();

    fireEvent.click(screen.getByText("detail.showMore"));
    await waitFor(() => {
      expect(screen.getByTestId("run-e39")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("run-e40")).toBeNull();
    expect(screen.getByText("detail.showMore")).toBeInTheDocument();

    fireEvent.click(screen.getByText("detail.showMore"));
    await waitFor(() => {
      expect(screen.getByTestId("run-e44")).toBeInTheDocument();
    });
    expect(screen.queryByText("detail.showMore")).toBeNull();
  });

  it("does not query executions when inactive", () => {
    mockGetExecutions.mockResolvedValue(makeExecutions(3));
    renderTab({ active: false });
    expect(mockGetExecutions).not.toHaveBeenCalled();
    // Inactive tab still shows the empty state because executions defaults to []
    expect(screen.getByText("historyTab.empty")).toBeInTheDocument();
    expect(screen.queryByText("detail.showMore")).toBeNull();
  });

  it("queries executions for the given routineId when active", async () => {
    mockGetExecutions.mockResolvedValue(makeExecutions(1));
    renderTab({ active: true });
    await waitFor(() => {
      expect(mockGetExecutions).toHaveBeenCalledWith("r1");
    });
  });

  it("highlights the selected execution row", async () => {
    mockGetExecutions.mockResolvedValue(makeExecutions(2));
    renderTab({ selectedExecutionId: "e1" });
    await waitFor(() => {
      expect(screen.getByTestId("run-e1")).toHaveAttribute(
        "data-selected",
        "true",
      );
    });
    expect(screen.getByTestId("run-e0")).toHaveAttribute(
      "data-selected",
      "false",
    );
  });

  it("navigates with correct routineId + executionId on row click", async () => {
    mockGetExecutions.mockResolvedValue(makeExecutions(2));
    renderTab();
    const row = await screen.findByTestId("run-e0");
    fireEvent.click(row);
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/routines/$routineId/runs/$executionId",
      params: { routineId: "r1", executionId: "e0" },
    });
  });
});
