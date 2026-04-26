import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { JSX, ReactNode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const routeParams: { routineId: string; executionId: string } = {
  routineId: "r-1",
  executionId: "exec-1",
};
const mockNavigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: unknown) => ({
    __config: config,
    useParams: () => routeParams,
  }),
  useNavigate: () => mockNavigate,
  Link: ({
    to,
    params,
    className,
    children,
  }: {
    to: string;
    params: Record<string, string>;
    className?: string;
    children: ReactNode;
  }) => (
    <a
      data-testid="back-link"
      data-to={to}
      data-params={JSON.stringify(params)}
      className={className}
    >
      {children}
    </a>
  ),
}));

const mockGetById = vi.fn();
const mockGetExecutions = vi.fn();
vi.mock("@/services/api/routines", () => ({
  routinesApi: {
    getById: (...args: unknown[]) => mockGetById(...args),
    getExecutions: (...args: unknown[]) => mockGetExecutions(...args),
  },
}));

vi.mock("@/components/routines/RoutinesSidebar", () => ({
  RoutinesSidebar: (props: {
    selectedRoutineId: string | null;
    selectedExecutionId: string | null;
  }) => (
    <div
      data-testid="routines-sidebar"
      data-routine-id={String(props.selectedRoutineId)}
      data-execution-id={String(props.selectedExecutionId)}
    />
  ),
}));

type ChatAreaProps = {
  routine: { id: string; status: string };
  selectedRun: { id: string } | null;
  activeExecution: { id: string } | null;
  isViewingHistory: boolean;
  onReturnToCurrent: () => void;
  creationChannelId: string | null;
};

vi.mock("@/components/routines/ChatArea", () => ({
  ChatArea: (props: ChatAreaProps) => (
    <div
      data-testid="chat-area"
      data-routine-id={props.routine.id}
      data-selected-run={props.selectedRun?.id ?? "null"}
      data-active-id={props.activeExecution?.id ?? "null"}
      data-history={String(props.isViewingHistory)}
      data-creation-channel={String(props.creationChannelId)}
    >
      <button
        data-testid="return-to-current"
        onClick={props.onReturnToCurrent}
      />
    </div>
  ),
}));

vi.mock("@/components/routines/RightPanel", () => ({
  RightPanel: (props: {
    routineId: string;
    selectedRun: { id: string } | null;
  }) => (
    <div
      data-testid="right-panel"
      data-routine-id={props.routineId}
      data-selected-run={props.selectedRun?.id ?? "null"}
    />
  ),
}));

import { Route as RunRoute } from "../$routineId.runs.$executionId";

type RouteHandle = { __config: { component: () => JSX.Element } };

function renderWithQuery(component: JSX.Element) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>{component}</QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  routeParams.routineId = "r-1";
  routeParams.executionId = "exec-1";
});

describe("/_authenticated/routines/$routineId/runs/$executionId run route", () => {
  it("renders only the sidebar + filler while routine is still loading", async () => {
    mockGetById.mockImplementation(() => new Promise(() => {}));
    mockGetExecutions.mockResolvedValue([]);

    const Component = (RunRoute as unknown as RouteHandle).__config.component;
    renderWithQuery(<Component />);

    const sidebar = await screen.findByTestId("routines-sidebar");
    expect(sidebar.getAttribute("data-routine-id")).toBe("r-1");
    expect(sidebar.getAttribute("data-execution-id")).toBe("exec-1");
    expect(screen.queryByTestId("chat-area")).not.toBeInTheDocument();
    expect(screen.queryByTestId("right-panel")).not.toBeInTheDocument();
  });

  it("renders ChatArea with the selected execution from the executions list", async () => {
    mockGetById.mockResolvedValue({
      id: "r-1",
      status: "in_progress",
      currentExecution: {
        execution: { id: "exec-active", status: "in_progress" },
      },
      creationChannelId: null,
    });
    mockGetExecutions.mockResolvedValue([
      { id: "exec-1", status: "completed" },
      { id: "exec-active", status: "in_progress" },
    ]);

    const Component = (RunRoute as unknown as RouteHandle).__config.component;
    renderWithQuery(<Component />);

    const chat = await screen.findByTestId("chat-area");
    expect(chat.getAttribute("data-selected-run")).toBe("exec-1");
    expect(chat.getAttribute("data-active-id")).toBe("exec-active");
    expect(chat.getAttribute("data-history")).toBe("true");
    expect(chat.getAttribute("data-creation-channel")).toBe("null");
  });

  it("treats executionId='creation' as draft sentinel, passes creationChannelId override", async () => {
    routeParams.executionId = "creation";
    mockGetById.mockResolvedValue({
      id: "r-1",
      status: "draft",
      currentExecution: null,
      creationChannelId: "ch-creation",
    });
    mockGetExecutions.mockResolvedValue([]);

    const Component = (RunRoute as unknown as RouteHandle).__config.component;
    renderWithQuery(<Component />);

    const chat = await screen.findByTestId("chat-area");
    expect(chat.getAttribute("data-selected-run")).toBe("null");
    expect(chat.getAttribute("data-creation-channel")).toBe("ch-creation");
    expect(chat.getAttribute("data-history")).toBe("false");
  });

  it("returnToCurrent navigates to the active execution", async () => {
    mockGetById.mockResolvedValue({
      id: "r-1",
      status: "in_progress",
      currentExecution: {
        execution: { id: "exec-active", status: "in_progress" },
      },
      creationChannelId: null,
    });
    mockGetExecutions.mockResolvedValue([
      { id: "exec-1", status: "completed" },
      { id: "exec-active", status: "in_progress" },
    ]);

    const Component = (RunRoute as unknown as RouteHandle).__config.component;
    renderWithQuery(<Component />);

    const btn = await screen.findByTestId("return-to-current");
    fireEvent.click(btn);

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/routines/$routineId/runs/$executionId",
      params: { routineId: "r-1", executionId: "exec-active" },
    });
  });

  it("returnToCurrent is a no-op when there is no active execution", async () => {
    mockGetById.mockResolvedValue({
      id: "r-1",
      status: "completed",
      currentExecution: null,
      creationChannelId: null,
    });
    mockGetExecutions.mockResolvedValue([
      { id: "exec-1", status: "completed" },
    ]);

    const Component = (RunRoute as unknown as RouteHandle).__config.component;
    renderWithQuery(<Component />);

    const btn = await screen.findByTestId("return-to-current");
    fireEvent.click(btn);

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("uses currentExecution when its id matches the URL executionId", async () => {
    routeParams.executionId = "exec-active";
    mockGetById.mockResolvedValue({
      id: "r-1",
      status: "in_progress",
      currentExecution: {
        execution: {
          id: "exec-active",
          status: "in_progress",
          extra: "from-current",
        },
      },
      creationChannelId: null,
    });
    mockGetExecutions.mockResolvedValue([]);

    const Component = (RunRoute as unknown as RouteHandle).__config.component;
    renderWithQuery(<Component />);

    const chat = await screen.findByTestId("chat-area");
    expect(chat.getAttribute("data-selected-run")).toBe("exec-active");
    expect(chat.getAttribute("data-active-id")).toBe("exec-active");
    expect(chat.getAttribute("data-history")).toBe("false");
  });

  it("renders run-not-found fallback when executionId is unknown and not the creation sentinel", async () => {
    routeParams.executionId = "00000000-0000-0000-0000-000000000404";
    mockGetById.mockResolvedValue({
      id: "r-1",
      status: "in_progress",
      currentExecution: {
        execution: { id: "exec-active", status: "in_progress" },
      },
      creationChannelId: null,
    });
    mockGetExecutions.mockResolvedValue([
      { id: "exec-1", status: "completed" },
      { id: "exec-active", status: "in_progress" },
    ]);

    const Component = (RunRoute as unknown as RouteHandle).__config.component;
    renderWithQuery(<Component />);

    const fallback = await screen.findByTestId("run-not-found");
    expect(fallback).toBeInTheDocument();
    expect(screen.queryByTestId("chat-area")).not.toBeInTheDocument();
    expect(screen.queryByTestId("right-panel")).not.toBeInTheDocument();

    const backLink = await screen.findByTestId("back-link");
    expect(backLink.getAttribute("data-to")).toBe("/routines/$routineId");
    expect(backLink.getAttribute("data-params")).toBe(
      JSON.stringify({ routineId: "r-1" }),
    );
  });

  it("does not render run-not-found while executions are still loading", async () => {
    routeParams.executionId = "00000000-0000-0000-0000-000000000404";
    mockGetById.mockResolvedValue({
      id: "r-1",
      status: "in_progress",
      currentExecution: {
        execution: { id: "exec-active", status: "in_progress" },
      },
      creationChannelId: null,
    });
    // Pending — executionsLoading stays true.
    mockGetExecutions.mockImplementation(() => new Promise(() => {}));

    const Component = (RunRoute as unknown as RouteHandle).__config.component;
    renderWithQuery(<Component />);

    // Wait long enough for the routine query to settle, then assert that the
    // not-found panel did not render while executions are still loading.
    await screen.findByTestId("routines-sidebar");
    expect(screen.queryByTestId("run-not-found")).not.toBeInTheDocument();
  });
});
