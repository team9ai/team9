import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WikiSubSidebar } from "../WikiSubSidebar";
import { useWikiStore } from "@/stores/useWikiStore";
import type { WikiDto } from "@/types/wiki";

const mockUseWikis = vi.hoisted(() => vi.fn());
const mockOnOpenChange = vi.hoisted(() => vi.fn());
const mockNavigate = vi.hoisted(() => vi.fn());
const mockUseQueries = vi.hoisted(() => vi.fn());
const mockListProposals = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useWikis", async () => {
  const actual =
    await vi.importActual<typeof import("@/hooks/useWikis")>(
      "@/hooks/useWikis",
    );
  return {
    ...actual,
    useWikis: () => mockUseWikis(),
  };
});

vi.mock("@/services/api/wikis", () => ({
  wikisApi: {
    listProposals: (...args: unknown[]) => mockListProposals(...args),
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useQueries: (args: unknown) => mockUseQueries(args),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("@/components/wiki/WikiListItem", () => ({
  WikiListItem: ({ wiki }: { wiki: WikiDto }) => (
    <div data-testid={`wiki-list-item-${wiki.id}`}>{wiki.name}</div>
  ),
}));

vi.mock("@/components/wiki/CreateWikiDialog", () => ({
  CreateWikiDialog: ({
    open,
    onOpenChange,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) => {
    // Register the callback so the test can observe open-state propagation.
    mockOnOpenChange.mockImplementation(onOpenChange);
    return (
      <div
        data-testid="create-wiki-dialog"
        data-open={open ? "true" : "false"}
      />
    );
  },
}));

function buildWiki(overrides: Partial<WikiDto> = {}): WikiDto {
  return {
    id: "wiki-1",
    workspaceId: "ws-1",
    name: "Public Wiki",
    slug: "public",
    approvalMode: "auto",
    humanPermission: "write",
    agentPermission: "read",
    createdBy: "user-1",
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    archivedAt: null,
    ...overrides,
  };
}

/**
 * Shortcut for the common "no pending proposals across N wikis" case —
 * returns one `{ data: [] }` result per wiki.
 */
function queriesWithCounts(counts: number[]) {
  return counts.map((n) => ({
    data: Array.from({ length: n }, (_, i) => ({ id: `p-${i}` })),
  }));
}

describe("WikiSubSidebar", () => {
  beforeEach(() => {
    mockUseWikis.mockReset();
    mockOnOpenChange.mockReset();
    mockNavigate.mockReset();
    mockUseQueries.mockReset();
    mockListProposals.mockReset();
    useWikiStore.getState().reset();
    // Default: zero proposals so the badge stays hidden unless the test
    // overrides it.
    mockUseQueries.mockReturnValue([]);
  });

  it("shows a loading placeholder while the wiki list is fetching", () => {
    mockUseWikis.mockReturnValue({ data: undefined, isLoading: true });
    mockUseQueries.mockReturnValue([]);
    render(<WikiSubSidebar />);
    expect(screen.getByText(/Loading…/)).toBeInTheDocument();
  });

  it("shows the empty state when there are no wikis", () => {
    mockUseWikis.mockReturnValue({ data: [], isLoading: false });
    mockUseQueries.mockReturnValue([]);
    render(<WikiSubSidebar />);
    expect(screen.getByText(/No wikis yet/)).toBeInTheDocument();
  });

  it("shows the empty state when the response is undefined after loading", () => {
    mockUseWikis.mockReturnValue({ data: undefined, isLoading: false });
    mockUseQueries.mockReturnValue([]);
    render(<WikiSubSidebar />);
    expect(screen.getByText(/No wikis yet/)).toBeInTheDocument();
  });

  it("renders one WikiListItem per wiki returned by the hook", () => {
    mockUseWikis.mockReturnValue({
      data: [
        buildWiki({ id: "wiki-1", name: "Public" }),
        buildWiki({ id: "wiki-2", name: "Engineering", slug: "eng" }),
      ],
      isLoading: false,
    });
    mockUseQueries.mockReturnValue(queriesWithCounts([0, 0]));

    render(<WikiSubSidebar />);

    expect(screen.getByTestId("wiki-list-item-wiki-1")).toBeInTheDocument();
    expect(screen.getByTestId("wiki-list-item-wiki-2")).toBeInTheDocument();
    // The empty-state copy must not leak through when wikis exist.
    expect(screen.queryByText(/No wikis yet/)).toBeNull();
  });

  it("opens the CreateWikiDialog when the + button is clicked", () => {
    mockUseWikis.mockReturnValue({ data: [], isLoading: false });
    mockUseQueries.mockReturnValue([]);
    render(<WikiSubSidebar />);

    expect(screen.getByTestId("create-wiki-dialog")).toHaveAttribute(
      "data-open",
      "false",
    );

    const plusButton = screen.getByRole("button", { name: /create wiki/i });
    fireEvent.click(plusButton);

    expect(screen.getByTestId("create-wiki-dialog")).toHaveAttribute(
      "data-open",
      "true",
    );
  });

  it("forwards onOpenChange so the dialog can close itself", () => {
    mockUseWikis.mockReturnValue({ data: [], isLoading: false });
    mockUseQueries.mockReturnValue([]);
    render(<WikiSubSidebar />);

    const plusButton = screen.getByRole("button", { name: /create wiki/i });
    fireEvent.click(plusButton);
    expect(screen.getByTestId("create-wiki-dialog")).toHaveAttribute(
      "data-open",
      "true",
    );

    act(() => {
      mockOnOpenChange(false);
    });
    expect(screen.getByTestId("create-wiki-dialog")).toHaveAttribute(
      "data-open",
      "false",
    );
  });

  it("renders the Wiki label from the navigation i18n namespace", () => {
    mockUseWikis.mockReturnValue({ data: [], isLoading: false });
    mockUseQueries.mockReturnValue([]);
    render(<WikiSubSidebar />);
    expect(
      screen.getByRole("heading", { name: /Library/ }),
    ).toBeInTheDocument();
  });

  // ─── Review icon + badge ────────────────────────────────────────────

  it("hides the Review icon entirely when the user has no wikis", () => {
    mockUseWikis.mockReturnValue({ data: [], isLoading: false });
    mockUseQueries.mockReturnValue([]);
    render(<WikiSubSidebar />);
    expect(screen.queryByTestId("wiki-sub-sidebar-review")).toBeNull();
  });

  it("renders the Review icon once at least one wiki exists", () => {
    mockUseWikis.mockReturnValue({
      data: [buildWiki()],
      isLoading: false,
    });
    mockUseQueries.mockReturnValue(queriesWithCounts([0]));
    render(<WikiSubSidebar />);
    expect(screen.getByTestId("wiki-sub-sidebar-review")).toBeInTheDocument();
  });

  it("omits the badge when there are zero pending proposals", () => {
    mockUseWikis.mockReturnValue({
      data: [buildWiki({ id: "w1" }), buildWiki({ id: "w2", slug: "w2" })],
      isLoading: false,
    });
    mockUseQueries.mockReturnValue(queriesWithCounts([0, 0]));

    render(<WikiSubSidebar />);
    const reviewBtn = screen.getByTestId("wiki-sub-sidebar-review");
    // NotificationBadge returns null when count <= 0 — so the count text
    // "0" must not appear inside the review button.
    expect(reviewBtn.textContent).not.toMatch(/\d/);
  });

  it("aggregates the pending-proposal counts across wikis into the badge", () => {
    mockUseWikis.mockReturnValue({
      data: [
        buildWiki({ id: "w1", slug: "w1" }),
        buildWiki({ id: "w2", slug: "w2" }),
        buildWiki({ id: "w3", slug: "w3" }),
      ],
      isLoading: false,
    });
    mockUseQueries.mockReturnValue(queriesWithCounts([2, 0, 5]));

    render(<WikiSubSidebar />);
    const reviewBtn = screen.getByTestId("wiki-sub-sidebar-review");
    expect(reviewBtn).toHaveTextContent("7");
  });

  it("wires useQueries with one query per wiki using the pending status", () => {
    const wikis = [
      buildWiki({ id: "w1", slug: "w1" }),
      buildWiki({ id: "w2", slug: "w2" }),
    ];
    mockUseWikis.mockReturnValue({ data: wikis, isLoading: false });
    mockUseQueries.mockReturnValue(queriesWithCounts([0, 0]));

    render(<WikiSubSidebar />);

    expect(mockUseQueries).toHaveBeenCalledTimes(1);
    const arg = mockUseQueries.mock.calls[0]![0] as {
      queries: Array<{ queryKey: readonly unknown[]; enabled: boolean }>;
    };
    expect(arg.queries).toHaveLength(2);
    expect(arg.queries[0].queryKey).toEqual([
      "wikis",
      "w1",
      "proposals",
      "pending",
    ]);
    expect(arg.queries[1].queryKey).toEqual([
      "wikis",
      "w2",
      "proposals",
      "pending",
    ]);
    expect(arg.queries[0].enabled).toBe(true);
  });

  it("invokes wikisApi.listProposals when useQueries fires the queryFn", () => {
    mockUseWikis.mockReturnValue({
      data: [buildWiki({ id: "wiki-x" })],
      isLoading: false,
    });
    mockUseQueries.mockReturnValue(queriesWithCounts([0]));

    render(<WikiSubSidebar />);

    // Pull the queryFn out of the configuration and execute it to prove
    // it wires through to the API layer.
    const arg = mockUseQueries.mock.calls[0]![0] as {
      queries: Array<{ queryFn: () => unknown }>;
    };
    arg.queries[0].queryFn();
    expect(mockListProposals).toHaveBeenCalledWith("wiki-x", "pending");
  });

  it("navigates to the first wiki's review route when none is selected", () => {
    mockUseWikis.mockReturnValue({
      data: [buildWiki({ id: "w1", slug: "first" })],
      isLoading: false,
    });
    mockUseQueries.mockReturnValue(queriesWithCounts([1]));

    render(<WikiSubSidebar />);
    fireEvent.click(screen.getByTestId("wiki-sub-sidebar-review"));

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/wiki/$wikiSlug/-/review",
      params: { wikiSlug: "first" },
    });
  });

  it("counts undefined proposal queries as zero (data not loaded yet)", () => {
    mockUseWikis.mockReturnValue({
      data: [
        buildWiki({ id: "w1", slug: "w1" }),
        buildWiki({ id: "w2", slug: "w2" }),
      ],
      isLoading: false,
    });
    // Two sibling queries — one resolved with 3 items, one still loading
    // (data: undefined). The badge must treat the pending one as 0 rather
    // than crashing on the optional chain.
    mockUseQueries.mockReturnValue([
      { data: [{ id: "a" }, { id: "b" }, { id: "c" }] },
      { data: undefined },
    ]);

    render(<WikiSubSidebar />);
    expect(screen.getByTestId("wiki-sub-sidebar-review")).toHaveTextContent(
      "3",
    );
  });

  it("prefers the currently-selected wiki's slug for the review target", () => {
    useWikiStore.getState().setSelectedWiki("w2");
    mockUseWikis.mockReturnValue({
      data: [
        buildWiki({ id: "w1", slug: "first" }),
        buildWiki({ id: "w2", slug: "second" }),
      ],
      isLoading: false,
    });
    mockUseQueries.mockReturnValue(queriesWithCounts([0, 3]));

    render(<WikiSubSidebar />);
    fireEvent.click(screen.getByTestId("wiki-sub-sidebar-review"));

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/wiki/$wikiSlug/-/review",
      params: { wikiSlug: "second" },
    });
  });
});
