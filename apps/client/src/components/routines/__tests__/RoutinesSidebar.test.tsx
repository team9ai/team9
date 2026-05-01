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
  sessionStorage.clear();
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

  it("keeps drafts mixed with created routines in API time order on the all tab", async () => {
    mockList.mockResolvedValue([
      {
        id: "r-new",
        title: "Newest created routine",
        status: "in_progress",
        createdAt: "2026-04-29T15:00:00.000Z",
        botId: null,
        tokenUsage: 0,
        creationChannelId: null,
      },
      {
        id: "draft-middle",
        title: "Middle draft routine",
        status: "draft",
        createdAt: "2026-04-29T14:00:00.000Z",
        botId: "bot-1",
        tokenUsage: 0,
        creationChannelId: "ch-creation-1",
      },
      {
        id: "r-old",
        title: "Oldest created routine",
        status: "completed",
        createdAt: "2026-04-29T13:00:00.000Z",
        botId: null,
        tokenUsage: 0,
        creationChannelId: null,
      },
    ]);
    mockGetExecutions.mockResolvedValue([]);

    const { container } = renderSidebar({
      selectedRoutineId: null,
      selectedExecutionId: null,
    });

    await screen.findByText("Newest created routine");
    const text = container.textContent ?? "";

    expect(text.indexOf("Newest created routine")).toBeLessThan(
      text.indexOf("Middle draft routine"),
    );
    expect(text.indexOf("Middle draft routine")).toBeLessThan(
      text.indexOf("Oldest created routine"),
    );
  });

  it("navigates to detail page on non-draft routine click", async () => {
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

    renderSidebar({ selectedRoutineId: null, selectedExecutionId: null });

    const card = await screen.findByText("First");
    fireEvent.click(card);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/routines/$routineId",
        params: { routineId: "r1" },
      });
    });
  });

  it("clicking the chevron toggles expansion only — no navigate", async () => {
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

    const { container } = renderSidebar({
      selectedRoutineId: null,
      selectedExecutionId: null,
    });

    await screen.findByText("First");
    // The translation mock returns the key when no fallback is provided in
    // t() — RoutineCard uses bare-key form `t("detail.toggleExpand")`.
    const chevron = container.querySelector(
      '[aria-label="detail.toggleExpand"]',
    ) as HTMLButtonElement;
    expect(chevron).not.toBeNull();
    fireEvent.click(chevron);
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

  it("expanded card filters to active runs only and hides terminal runs", async () => {
    mockList.mockResolvedValue([
      {
        id: "r-mix",
        title: "Mix",
        status: "in_progress",
        createdAt: new Date().toISOString(),
        botId: null,
        tokenUsage: 0,
        creationChannelId: null,
      },
    ]);
    mockGetExecutions.mockResolvedValue([
      { id: "exec-active", status: "in_progress" },
      { id: "exec-paused", status: "paused" },
      { id: "exec-pending", status: "pending_action" },
      { id: "exec-completed", status: "completed" },
      { id: "exec-failed", status: "failed" },
      { id: "exec-stopped", status: "stopped" },
    ]);

    // selectedRoutineId triggers auto-expand, which fires the executions query.
    renderSidebar({
      selectedRoutineId: "r-mix",
      selectedExecutionId: null,
    });

    await screen.findByText("Mix");
    await waitFor(() =>
      expect(mockGetExecutions).toHaveBeenCalledWith("r-mix"),
    );

    // Active runs visible.
    await waitFor(() => {
      expect(screen.getByTestId("run-item-exec-active")).toBeInTheDocument();
    });
    expect(screen.getByTestId("run-item-exec-paused")).toBeInTheDocument();
    expect(screen.getByTestId("run-item-exec-pending")).toBeInTheDocument();

    // Terminal runs hidden — they live on the detail page's Runs tab.
    expect(
      screen.queryByTestId("run-item-exec-completed"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("run-item-exec-failed"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("run-item-exec-stopped"),
    ).not.toBeInTheDocument();
  });

  it("expanded card with no active runs and not a draft renders no placeholder", async () => {
    mockList.mockResolvedValue([
      {
        id: "r-done",
        title: "All done",
        status: "completed",
        createdAt: new Date().toISOString(),
        botId: null,
        tokenUsage: 0,
        creationChannelId: null,
      },
    ]);
    mockGetExecutions.mockResolvedValue([
      { id: "exec-1", status: "completed" },
      { id: "exec-2", status: "failed" },
    ]);

    renderSidebar({
      selectedRoutineId: "r-done",
      selectedExecutionId: null,
    });

    await screen.findByText("All done");
    await waitFor(() =>
      expect(mockGetExecutions).toHaveBeenCalledWith("r-done"),
    );

    // No "no runs yet" placeholder, no terminal runs in the sidebar.
    expect(screen.queryByText("No runs yet")).not.toBeInTheDocument();
    expect(screen.queryByText("historyTab.empty")).not.toBeInTheDocument();
    expect(screen.queryByTestId("run-item-exec-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("run-item-exec-2")).not.toBeInTheDocument();
  });

  it("Show more button is gone — terminal runs never offer pagination", async () => {
    mockList.mockResolvedValue([
      {
        id: "r-many",
        title: "Many runs",
        status: "in_progress",
        createdAt: new Date().toISOString(),
        botId: null,
        tokenUsage: 0,
        creationChannelId: null,
      },
    ]);
    // Six terminal runs would have triggered the legacy "Show 3 more" button
    // (DEFAULT_VISIBLE_RUNS = 3). With active-only filtering they are all
    // hidden and pagination is moot.
    mockGetExecutions.mockResolvedValue([
      { id: "e1", status: "completed" },
      { id: "e2", status: "completed" },
      { id: "e3", status: "completed" },
      { id: "e4", status: "completed" },
      { id: "e5", status: "completed" },
      { id: "e6", status: "completed" },
    ]);

    renderSidebar({
      selectedRoutineId: "r-many",
      selectedExecutionId: null,
    });

    await screen.findByText("Many runs");
    await waitFor(() =>
      expect(mockGetExecutions).toHaveBeenCalledWith("r-many"),
    );

    // Neither the i18n key nor any fallback rendering of "Show more" should
    // appear — the button is removed entirely.
    expect(
      screen.queryByText(/showMore|Show \d+ more|earlier runs/i),
    ).toBeNull();
  });

  it("chevron click does not bubble to header (stopPropagation)", async () => {
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

    const { container } = renderSidebar({
      selectedRoutineId: null,
      selectedExecutionId: null,
    });

    await screen.findByText("First");
    // The translation mock returns the key when no fallback is provided in
    // t() — RoutineCard uses bare-key form `t("detail.toggleExpand")`.
    const chevron = container.querySelector(
      '[aria-label="detail.toggleExpand"]',
    ) as HTMLButtonElement;
    // Use bubbles:true so we can verify stopPropagation actually prevents
    // the body click handler from firing.
    fireEvent.click(chevron, { bubbles: true });

    // Microtask flush — header click would have called navigate by now.
    await new Promise((r) => setTimeout(r, 0));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("activating chevron via keyboard does not trigger navigation", async () => {
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

    const { container } = renderSidebar({
      selectedRoutineId: null,
      selectedExecutionId: null,
    });

    await screen.findByText("First");
    const chevron = container.querySelector(
      '[aria-label="detail.toggleExpand"]',
    ) as HTMLButtonElement;
    expect(chevron).not.toBeNull();
    fireEvent.keyDown(chevron, { key: "Enter", bubbles: true });
    expect(mockNavigate).not.toHaveBeenCalled();
    fireEvent.keyDown(chevron, { key: " ", bubbles: true });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("expanded card with no active runs and not a draft keeps ChevronRight glyph", async () => {
    mockList.mockResolvedValue([
      {
        id: "r-done",
        title: "All done",
        status: "completed",
        createdAt: new Date().toISOString(),
        botId: null,
        tokenUsage: 0,
        creationChannelId: null,
      },
    ]);
    // Only terminal-state executions — they're filtered out of the sidebar's
    // active-only list, so hasExpandableContent is false.
    mockGetExecutions.mockResolvedValue([
      { id: "exec-1", status: "completed" },
      { id: "exec-2", status: "failed" },
    ]);

    // selectedRoutineId triggers auto-expand.
    const { container } = renderSidebar({
      selectedRoutineId: "r-done",
      selectedExecutionId: null,
    });

    await screen.findByText("All done");
    await waitFor(() =>
      expect(mockGetExecutions).toHaveBeenCalledWith("r-done"),
    );

    const chevron = container.querySelector(
      '[aria-label="detail.toggleExpand"]',
    ) as HTMLButtonElement;
    // lucide-react renders icons as SVGs with a class containing the icon
    // name, e.g. `lucide-chevron-right` / `lucide-chevron-down`. The chevron
    // must remain Right when there is no content to reveal — flipping to Down
    // with an empty body would be visually incoherent.
    const svg = chevron.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("class")).toMatch(/chevron-right/);
    expect(svg!.getAttribute("class")).not.toMatch(/chevron-down/);
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
