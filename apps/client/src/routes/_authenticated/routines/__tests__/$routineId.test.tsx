import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type React from "react";
import type { JSX } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const routeUseParams = vi.fn(() => ({ routineId: "r-1" }));
const routeUseSearch = vi.fn(() => ({}) as { tab?: string });
const mockNavigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: unknown) => ({
    __config: config,
    useParams: () => routeUseParams(),
    useSearch: () => routeUseSearch(),
  }),
  useNavigate: () => mockNavigate,
  Link: ({
    to,
    children,
    "data-testid": testId,
    className,
  }: {
    to: string;
    children: React.ReactNode;
    "data-testid"?: string;
    className?: string;
  }) => (
    <a data-testid={testId} href={to} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
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

interface RoutineDetailViewMockProps {
  routine: { id: string; title: string };
  tab: string;
  onTabChange: (next: string) => void;
}

vi.mock("@/components/routines/RoutineDetailView", () => ({
  ROUTINE_DETAIL_TABS: ["overview", "triggers", "documents", "runs"] as const,
  RoutineDetailView: (props: RoutineDetailViewMockProps) => (
    <div
      data-testid="routine-detail-view"
      data-routine-id={props.routine.id}
      data-tab={props.tab}
    >
      <button
        data-testid="trigger-tab-change"
        onClick={() => props.onTabChange("triggers")}
      />
    </div>
  ),
}));

const mockGetById = vi.fn();
vi.mock("@/services/api/routines", () => ({
  routinesApi: {
    getById: (...args: unknown[]) => mockGetById(...args),
  },
}));

import { Route as DetailRoute } from "../$routineId.index";

type RouteHandle = {
  __config: {
    component: () => JSX.Element;
    validateSearch: (search: Record<string, unknown>) => unknown;
  };
};

function renderRoute() {
  const Component = (DetailRoute as unknown as RouteHandle).__config.component;
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <Component />
    </QueryClientProvider>,
  );
}

describe("/_authenticated/routines/$routineId route", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockGetById.mockReset();
    routeUseSearch.mockReturnValue({});
  });

  it("renders sidebar with the URL routineId and a loading spinner while routine is fetching", () => {
    let resolveGet: (value: unknown) => void = () => {};
    mockGetById.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveGet = resolve;
        }),
    );
    const { container } = renderRoute();

    const sidebar = screen.getByTestId("routines-sidebar");
    expect(sidebar.getAttribute("data-routine-id")).toBe("r-1");
    expect(sidebar.getAttribute("data-execution-id")).toBe("null");
    expect(container.querySelector(".animate-spin")).not.toBeNull();

    resolveGet(null);
  });

  it("renders RoutineDetailView with the fetched routine and default 'overview' tab", async () => {
    mockGetById.mockResolvedValue({ id: "r-1", title: "Loaded" });
    renderRoute();

    const view = await screen.findByTestId("routine-detail-view");
    expect(view.getAttribute("data-routine-id")).toBe("r-1");
    expect(view.getAttribute("data-tab")).toBe("overview");
  });

  it("forwards the URL ?tab= search param to RoutineDetailView", async () => {
    routeUseSearch.mockReturnValue({ tab: "documents" });
    mockGetById.mockResolvedValue({ id: "r-1", title: "Loaded" });
    renderRoute();

    const view = await screen.findByTestId("routine-detail-view");
    expect(view.getAttribute("data-tab")).toBe("documents");
  });

  it("calls navigate with replace=true when the view requests a tab change", async () => {
    mockGetById.mockResolvedValue({ id: "r-1", title: "Loaded" });
    renderRoute();

    fireEvent.click(await screen.findByTestId("trigger-tab-change"));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/routines/$routineId",
        params: { routineId: "r-1" },
        search: { tab: "triggers" },
        replace: true,
      });
    });
  });

  it("renders 'Routine not found' with back link when the routine query returns nothing after loading", async () => {
    mockGetById.mockResolvedValue(null);
    renderRoute();

    await waitFor(() => {
      expect(screen.getByTestId("routine-not-found")).toBeInTheDocument();
    });
    expect(screen.getByTestId("routine-not-found")).toHaveTextContent(
      "Routine not found",
    );
    const backLink = screen.getByTestId("back-to-routines");
    expect(backLink).toBeInTheDocument();
    expect(backLink).toHaveAttribute("href", "/routines");
  });

  it("renders the load-error message with back link and stops polling when getById rejects", async () => {
    mockGetById.mockRejectedValue(new Error("boom"));
    renderRoute();

    // Settle the error state under real timers so testing-library's waitFor
    // polling works.
    await waitFor(() => {
      expect(screen.getByTestId("routine-not-found")).toHaveTextContent(
        "Couldn't load this routine",
      );
    });
    expect(screen.getByTestId("back-to-routines")).toBeInTheDocument();
    expect(mockGetById).toHaveBeenCalledTimes(1);

    // Now switch to fake timers and advance well past the 5s refetchInterval
    // window. The refetchInterval function returns `false` while the query is
    // in error state, so no further refetches must fire.
    vi.useFakeTimers();
    try {
      await vi.advanceTimersByTimeAsync(10_000);
      expect(mockGetById).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("validateSearch keeps allowed tab values", () => {
    const validate = (DetailRoute as unknown as RouteHandle).__config
      .validateSearch;
    expect(validate({ tab: "overview" })).toEqual({ tab: "overview" });
    expect(validate({ tab: "triggers" })).toEqual({ tab: "triggers" });
    expect(validate({ tab: "documents" })).toEqual({ tab: "documents" });
    expect(validate({ tab: "runs" })).toEqual({ tab: "runs" });
  });

  it("validateSearch strips unknown / missing tab values", () => {
    const validate = (DetailRoute as unknown as RouteHandle).__config
      .validateSearch;
    expect(validate({ tab: "settings" })).toEqual({});
    expect(validate({ tab: undefined })).toEqual({});
    expect(validate({})).toEqual({});
  });
});
