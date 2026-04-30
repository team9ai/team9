import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";

const mockNavigate = vi.fn();
const mockUpdate = vi.fn();
const mockGetExecutions = vi.fn();
const mockGetApps = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown> | string) => {
      if (typeof opts === "string") return opts;
      const fallback = opts?.defaultValue as string | undefined;
      return fallback ?? key;
    },
  }),
}));

vi.mock("@/lib/date-format", () => ({
  formatDateTime: (s: string) => `formatted:${s}`,
}));

vi.mock("@/services/api/routines", () => ({
  routinesApi: {
    update: (...args: unknown[]) => mockUpdate(...args),
    getExecutions: (...args: unknown[]) => mockGetExecutions(...args),
  },
}));

vi.mock("@/services/api", () => ({
  api: {
    applications: {
      getInstalledApplicationsWithBots: (...args: unknown[]) =>
        mockGetApps(...args),
    },
  },
}));

vi.mock("@/stores/useWorkspaceStore", () => ({
  useSelectedWorkspaceId: () => "ws-1",
}));

vi.mock("../../RunListItem", () => ({
  RunListItem: ({
    execution,
    onClick,
  }: {
    execution: { id: string };
    onClick: () => void;
  }) => (
    <button data-testid={`run-${execution.id}`} onClick={onClick}>
      run-{execution.id}
    </button>
  ),
}));

// Radix Select uses pointer events that jsdom can't synthesize via fireEvent.
// Replace with minimal primitives that expose `onValueChange` through a
// React context so each <SelectItem> can fire it directly when clicked.
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const Ctx = React.createContext<{ onValueChange: (v: string) => void }>({
    onValueChange: () => {},
  });

  const Select = ({
    value: _value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    children: ReactNode;
  }) => (
    <Ctx.Provider value={{ onValueChange }}>
      <div data-testid="bot-select-root">{children}</div>
    </Ctx.Provider>
  );

  const SelectTrigger = ({ children }: { children: ReactNode }) => (
    <div data-testid="bot-select-trigger">{children}</div>
  );
  const SelectValue = () => <span data-testid="bot-select-value" />;
  const SelectContent = ({ children }: { children: ReactNode }) => (
    <div data-testid="bot-select-content">{children}</div>
  );
  const SelectItem = ({
    value,
    children,
  }: {
    value: string;
    children: ReactNode;
  }) => {
    const { onValueChange } = React.useContext(Ctx);
    return (
      <button
        type="button"
        data-testid={`bot-option-${value}`}
        data-value={value}
        onClick={() => onValueChange(value)}
      >
        {children}
      </button>
    );
  };

  return { Select, SelectTrigger, SelectValue, SelectContent, SelectItem };
});

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import { RoutineOverviewTab } from "../RoutineOverviewTab";
import type { RoutineDetail, RoutineExecution } from "@/types/routine";

const baseRoutine: RoutineDetail = {
  id: "r1",
  tenantId: "t1",
  botId: null,
  creatorId: "u1",
  title: "Daily",
  description: "Some description",
  status: "in_progress",
  scheduleType: "once",
  scheduleConfig: null,
  nextRunAt: null,
  version: 1,
  documentId: null,
  folderId: "f1",
  currentExecutionId: null,
  tokenUsage: 1500,
  creationChannelId: null,
  creationSessionId: null,
  sourceRef: null,
  createdAt: "2026-04-26T08:00:00Z",
  updatedAt: "2026-04-26T08:00:00Z",
  currentExecution: null,
};

function makeExecution(over: Partial<RoutineExecution>): RoutineExecution {
  return {
    id: "e0",
    routineId: "r1",
    routineVersion: 1,
    status: "completed",
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
    ...over,
  };
}

function renderTab(
  routineOverride: Partial<RoutineDetail> = {},
  executions: RoutineExecution[] = [],
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  mockGetExecutions.mockResolvedValue(executions);
  if (!mockGetApps.getMockImplementation()) {
    mockGetApps.mockResolvedValue([]);
  }
  const onSwitchTab = vi.fn();
  const utils = render(
    <QueryClientProvider client={qc}>
      <RoutineOverviewTab
        routine={{ ...baseRoutine, ...routineOverride }}
        onSwitchTab={onSwitchTab}
      />
    </QueryClientProvider>,
  );
  return { ...utils, onSwitchTab };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetApps.mockReset();
  mockGetExecutions.mockReset();
});

describe("RoutineOverviewTab", () => {
  it("renders description and total tokens when present", () => {
    renderTab();
    expect(screen.getByText("Some description")).toBeInTheDocument();
    expect(screen.getByText("1500")).toBeInTheDocument();
    expect(screen.getByText("detail.totalTokens")).toBeInTheDocument();
  });

  it("hides description when null and total tokens when 0", () => {
    renderTab({ description: null, tokenUsage: 0 });
    expect(screen.queryByText("Some description")).toBeNull();
    expect(screen.queryByText("detail.totalTokens")).toBeNull();
    expect(screen.queryByText("1500")).toBeNull();
  });

  it("renders formatted createdAt and last-run dash when no runs", () => {
    renderTab();
    expect(
      screen.getByText("formatted:2026-04-26T08:00:00Z"),
    ).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("uses currentExecution.startedAt as lastRunAt when present (no executions)", async () => {
    renderTab({
      currentExecution: {
        execution: makeExecution({
          id: "exec-cur",
          status: "in_progress",
          startedAt: "2026-04-26T09:00:00Z",
          completedAt: null,
        }),
        steps: [],
        interventions: [],
        deliverables: [],
      },
    });
    expect(
      screen.getByText("formatted:2026-04-26T09:00:00Z"),
    ).toBeInTheDocument();
  });

  it("picks the more recent of currentExecution.startedAt vs executions[0].startedAt", async () => {
    const executions = [
      makeExecution({
        id: "e-older",
        startedAt: "2026-04-26T07:00:00Z",
        completedAt: "2026-04-26T07:01:00Z",
      }),
    ];
    renderTab(
      {
        currentExecution: {
          execution: makeExecution({
            id: "exec-newer",
            status: "in_progress",
            startedAt: "2026-04-26T10:00:00Z",
            completedAt: null,
          }),
          steps: [],
          interventions: [],
          deliverables: [],
        },
      },
      executions,
    );
    // currentExecution is newer → should show its startedAt
    await waitFor(() => {
      expect(
        screen.getByText("formatted:2026-04-26T10:00:00Z"),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByText("formatted:2026-04-26T07:00:00Z"),
    ).not.toBeInTheDocument();
  });

  it("picks executions[0].startedAt when it is newer than currentExecution.startedAt", async () => {
    const executions = [
      makeExecution({
        id: "e-newer",
        startedAt: "2026-04-26T11:00:00Z",
        completedAt: "2026-04-26T11:01:00Z",
      }),
    ];
    renderTab(
      {
        currentExecution: {
          execution: makeExecution({
            id: "exec-older",
            status: "in_progress",
            startedAt: "2026-04-26T09:00:00Z",
            completedAt: null,
          }),
          steps: [],
          interventions: [],
          deliverables: [],
        },
      },
      executions,
    );
    // executions[0] is newer → should show its startedAt
    await waitFor(() => {
      expect(
        screen.getByText("formatted:2026-04-26T11:00:00Z"),
      ).toBeInTheDocument();
    });
  });

  it("renders current run pill + View link when present and navigates", () => {
    renderTab({
      currentExecution: {
        execution: makeExecution({
          id: "exec-current",
          status: "in_progress",
          startedAt: "2026-04-26T09:00:00Z",
          completedAt: null,
        }),
        steps: [],
        interventions: [],
        deliverables: [],
      },
    });
    fireEvent.click(screen.getByText("detail.view"));
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/routines/$routineId/runs/$executionId",
      params: { routineId: "r1", executionId: "exec-current" },
    });
  });

  it("hides current-run cell when currentExecution is null", () => {
    renderTab();
    expect(screen.queryByText("detail.currentRun")).toBeNull();
    expect(screen.queryByText("detail.view")).toBeNull();
  });

  it("renders recent up to 5 runs and switches tab on View all", async () => {
    const executions = Array.from({ length: 7 }, (_, i) =>
      makeExecution({
        id: `e${i}`,
        startedAt: `2026-04-2${i}T08:00:00Z`,
        completedAt: `2026-04-2${i}T08:01:00Z`,
      }),
    );
    const { onSwitchTab } = renderTab({}, executions);

    await waitFor(() => {
      expect(screen.getByTestId("run-e0")).toBeInTheDocument();
      expect(screen.getByTestId("run-e4")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("run-e5")).toBeNull();
    expect(screen.queryByTestId("run-e6")).toBeNull();

    fireEvent.click(screen.getByText("detail.viewAllRuns"));
    expect(onSwitchTab).toHaveBeenCalledWith("runs");
  });

  it("navigates when clicking a recent run row", async () => {
    const executions = [makeExecution({ id: "e-click" })];
    renderTab({}, executions);
    const item = await screen.findByTestId("run-e-click");
    fireEvent.click(item);
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/routines/$routineId/runs/$executionId",
      params: { routineId: "r1", executionId: "e-click" },
    });
  });

  it("shows empty state and hides View-all link when no runs", async () => {
    renderTab({}, []);
    await waitFor(() => {
      expect(screen.getByText("historyTab.empty")).toBeInTheDocument();
    });
    expect(screen.queryByText("detail.viewAllRuns")).toBeNull();
  });

  it("calls update mutation with botId when bot is changed", async () => {
    mockGetApps.mockResolvedValue([
      {
        id: "app1",
        status: "active",
        bots: [{ botId: "bot-1", displayName: "Bot One", username: "bot1" }],
      },
    ]);
    mockUpdate.mockResolvedValue(undefined);
    renderTab();
    const opt = await screen.findByTestId("bot-option-bot-1");
    fireEvent.click(opt);
    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith("r1", { botId: "bot-1" });
    });
  });

  it("calls update mutation with null when bot is set to none", async () => {
    mockGetApps.mockResolvedValue([]);
    mockUpdate.mockResolvedValue(undefined);
    renderTab({ botId: "bot-x" });
    fireEvent.click(screen.getByTestId("bot-option-__none__"));
    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith("r1", { botId: null });
    });
  });

  it("filters out non-active apps and bot rows missing botId", async () => {
    mockGetApps.mockResolvedValue([
      {
        id: "active-app",
        status: "active",
        bots: [
          { botId: "bot-good", displayName: "Good", username: "good" },
          { botId: null, displayName: "BadNoId", username: "no-id" },
        ],
      },
      {
        id: "inactive-app",
        status: "inactive",
        bots: [
          { botId: "bot-hidden", displayName: "Hidden", username: "hidden" },
        ],
      },
    ]);
    renderTab();
    await waitFor(() => {
      expect(screen.getByTestId("bot-option-bot-good")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("bot-option-bot-hidden")).toBeNull();
    expect(screen.queryByText("BadNoId")).toBeNull();
  });

  it("uses bot.username as fallback when displayName is empty", async () => {
    mockGetApps.mockResolvedValue([
      {
        id: "app1",
        status: "active",
        bots: [{ botId: "bot-2", displayName: "", username: "fallback" }],
      },
    ]);
    renderTab();
    expect(await screen.findByText("fallback")).toBeInTheDocument();
  });
});
