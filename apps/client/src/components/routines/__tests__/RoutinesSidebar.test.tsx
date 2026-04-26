import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockNavigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  useParams: () => ({}),
  useRouter: () => ({
    navigate: mockNavigate,
    state: { location: { pathname: "/" } },
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock("@/services/api", () => ({
  api: {
    applications: {
      getInstalledApplicationsWithBots: vi.fn(async () => []),
    },
    routines: {
      delete: vi.fn(async () => ({ success: true })),
      startCreationSession: vi.fn(async () => ({})),
    },
  },
}));

const mockList = vi.fn();
const mockGetById = vi.fn();
const mockGetExecutions = vi.fn();
vi.mock("@/services/api/routines", () => ({
  routinesApi: {
    list: (...args: unknown[]) => mockList(...args),
    getById: (...args: unknown[]) => mockGetById(...args),
    getExecutions: (...args: unknown[]) => mockGetExecutions(...args),
  },
}));

vi.mock("@/stores/useWorkspaceStore", () => ({
  useSelectedWorkspaceId: () => "ws-1",
}));

import { RoutinesSidebar } from "../RoutinesSidebar";

function renderSidebar(props: {
  selectedRoutineId: string | null;
  selectedExecutionId: string | null;
}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <RoutinesSidebar {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockList.mockResolvedValue([]);
  mockGetExecutions.mockResolvedValue([]);
});

describe("RoutinesSidebar", () => {
  it("renders empty state when no routines", async () => {
    renderSidebar({ selectedRoutineId: null, selectedExecutionId: null });
    await waitFor(() =>
      expect(screen.getByText("noRoutines")).toBeInTheDocument(),
    );
  });

  it("auto-expands the URL-selected routine", async () => {
    mockList.mockResolvedValue([
      {
        id: "r1",
        title: "First",
        status: "in_progress",
        createdAt: new Date().toISOString(),
        botId: null,
        tokenUsage: 0,
        creationChannelId: null,
      },
    ]);
    mockGetExecutions.mockResolvedValue([]);

    renderSidebar({ selectedRoutineId: "r1", selectedExecutionId: null });

    await waitFor(() => {
      expect(mockGetExecutions).toHaveBeenCalledWith("r1");
    });
  });

  it("navigates to /routines/$id/runs/creation for draft click", async () => {
    mockList.mockResolvedValue([
      {
        id: "draft1",
        title: "Draft",
        status: "draft",
        createdAt: new Date().toISOString(),
        botId: "bot-1",
        tokenUsage: 0,
        creationChannelId: "ch-creation-1",
      },
    ]);

    renderSidebar({ selectedRoutineId: null, selectedExecutionId: null });

    // The DraftRoutineCard renders a CreationSessionRunItem button — clicking
    // it routes through onOpenCreationSession → handleOpenRoutine → navigate.
    const creationBtn = await screen.findByRole("button", {
      name: /creation\.runLabel|Routine Creation/,
    });
    fireEvent.click(creationBtn);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/routines/$routineId/runs/$executionId",
        params: { routineId: "draft1", executionId: "creation" },
      });
    });
  });

  it("filters routines by tab — clicking 'finished' hides in_progress routines", async () => {
    mockList.mockResolvedValue([
      {
        id: "r-active",
        title: "Active task",
        status: "in_progress",
        createdAt: new Date().toISOString(),
        botId: null,
        tokenUsage: 0,
        creationChannelId: null,
      },
      {
        id: "r-done",
        title: "Done task",
        status: "completed",
        createdAt: new Date().toISOString(),
        botId: null,
        tokenUsage: 0,
        creationChannelId: null,
      },
    ]);

    renderSidebar({ selectedRoutineId: null, selectedExecutionId: null });

    await screen.findByText("Active task");
    expect(screen.getByText("Done task")).toBeInTheDocument();

    const finishedTab = screen.getByRole("button", { name: "finished" });
    fireEvent.click(finishedTab);

    await waitFor(() => {
      expect(screen.queryByText("Active task")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Done task")).toBeInTheDocument();
  });

  it("clicking a non-draft routine card navigates to active or first execution", async () => {
    mockList.mockResolvedValue([
      {
        id: "r1",
        title: "Has runs",
        status: "in_progress",
        createdAt: new Date().toISOString(),
        botId: null,
        tokenUsage: 0,
        creationChannelId: null,
      },
    ]);
    mockGetExecutions.mockResolvedValue([
      {
        id: "exec-old",
        status: "completed",
      },
      {
        id: "exec-active",
        status: "in_progress",
      },
    ]);

    renderSidebar({ selectedRoutineId: "r1", selectedExecutionId: null });

    const card = await screen.findByText("Has runs");
    // wait for executions query to settle so onOpenRoutine sees them
    await waitFor(() => expect(mockGetExecutions).toHaveBeenCalledWith("r1"));
    fireEvent.click(card);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/routines/$routineId/runs/$executionId",
        params: { routineId: "r1", executionId: "exec-active" },
      });
    });
  });

  it("clicking a non-draft routine with no executions only toggles expand (no navigate)", async () => {
    mockList.mockResolvedValue([
      {
        id: "r-empty",
        title: "Empty",
        status: "upcoming",
        createdAt: new Date().toISOString(),
        botId: null,
        tokenUsage: 0,
        creationChannelId: null,
      },
    ]);
    mockGetExecutions.mockResolvedValue([]);

    renderSidebar({ selectedRoutineId: null, selectedExecutionId: null });

    const card = await screen.findByText("Empty");
    fireEvent.click(card);

    // Wait a microtask cycle; navigation must not happen because there is no
    // active or recent execution to land on.
    await new Promise((r) => setTimeout(r, 0));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("clicking the settings button navigates to detail route with ?tab=overview", async () => {
    mockList.mockResolvedValue([
      {
        id: "r-settings",
        title: "Has settings",
        status: "in_progress",
        createdAt: new Date().toISOString(),
        botId: null,
        tokenUsage: 0,
        creationChannelId: null,
      },
    ]);
    mockGetExecutions.mockResolvedValue([]);

    renderSidebar({ selectedRoutineId: null, selectedExecutionId: null });

    // The settings button uses aria-label "settingsTab.title" (translation
    // mock returns the key when no fallback is provided in t() call).
    const settingsBtn = await screen.findByRole("button", {
      name: "Settings",
    });
    fireEvent.click(settingsBtn);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/routines/$routineId",
        params: { routineId: "r-settings" },
        search: { tab: "overview" },
      });
    });
  });

  it("shows loading spinner while routines query is pending", () => {
    let resolveList: (value: unknown) => void = () => {};
    mockList.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveList = resolve;
        }),
    );
    const { container } = renderSidebar({
      selectedRoutineId: null,
      selectedExecutionId: null,
    });
    // Spinner has the animate-spin class — empty state must not render yet.
    expect(container.querySelector(".animate-spin")).not.toBeNull();
    expect(screen.queryByText("noRoutines")).not.toBeInTheDocument();
    // Resolve to clean up the pending promise.
    resolveList([]);
  });
});
