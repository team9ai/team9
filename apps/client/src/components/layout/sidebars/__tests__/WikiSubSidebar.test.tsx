import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WikiSubSidebar } from "../WikiSubSidebar";
import { useWikiStore } from "@/stores/useWikiStore";
import type { WikiDto } from "@/types/wiki";

const mockUseWikis = vi.hoisted(() => vi.fn());
const mockUseWikiPendingCounts = vi.hoisted(() => vi.fn());
const mockOnOpenChange = vi.hoisted(() => vi.fn());
const mockNavigate = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useWikis", async () => {
  const actual =
    await vi.importActual<typeof import("@/hooks/useWikis")>(
      "@/hooks/useWikis",
    );
  return {
    ...actual,
    useWikis: () => mockUseWikis(),
    useWikiPendingCounts: () => mockUseWikiPendingCounts(),
  };
});

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
    icon: null,
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
 * Default-zero helper for the aggregated pending-counts hook. Tests
 * override via `mockUseWikiPendingCounts.mockReturnValue(...)` when a
 * non-zero badge is needed.
 */
function pendingCounts(counts: Record<string, number>) {
  return {
    data: { counts },
    isLoading: false,
    isError: false,
  };
}

describe("WikiSubSidebar", () => {
  beforeEach(() => {
    mockUseWikis.mockReset();
    mockUseWikiPendingCounts.mockReset();
    mockOnOpenChange.mockReset();
    mockNavigate.mockReset();
    useWikiStore.getState().reset();
    // Default: hook returns no counts data so the badge stays hidden unless
    // the test explicitly opts in via `mockUseWikiPendingCounts`.
    mockUseWikiPendingCounts.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });
  });

  it("shows a loading placeholder while the wiki list is fetching", () => {
    mockUseWikis.mockReturnValue({ data: undefined, isLoading: true });
    render(<WikiSubSidebar />);
    expect(screen.getByText(/Loading…/)).toBeInTheDocument();
  });

  it("shows the empty state when there are no wikis", () => {
    mockUseWikis.mockReturnValue({ data: [], isLoading: false });
    render(<WikiSubSidebar />);
    expect(screen.getByText(/No wikis yet/)).toBeInTheDocument();
  });

  it("shows the empty state when the response is undefined after loading", () => {
    mockUseWikis.mockReturnValue({ data: undefined, isLoading: false });
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
    mockUseWikiPendingCounts.mockReturnValue(
      pendingCounts({ "wiki-1": 0, "wiki-2": 0 }),
    );

    render(<WikiSubSidebar />);

    expect(screen.getByTestId("wiki-list-item-wiki-1")).toBeInTheDocument();
    expect(screen.getByTestId("wiki-list-item-wiki-2")).toBeInTheDocument();
    // The empty-state copy must not leak through when wikis exist.
    expect(screen.queryByText(/No wikis yet/)).toBeNull();
  });

  it("opens the CreateWikiDialog when the + button is clicked", () => {
    mockUseWikis.mockReturnValue({ data: [], isLoading: false });
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
    render(<WikiSubSidebar />);
    expect(
      screen.getByRole("heading", { name: /Library/ }),
    ).toBeInTheDocument();
  });

  // ─── Review icon + badge ────────────────────────────────────────────

  it("hides the Review icon entirely when the user has no wikis", () => {
    mockUseWikis.mockReturnValue({ data: [], isLoading: false });
    render(<WikiSubSidebar />);
    expect(screen.queryByTestId("wiki-sub-sidebar-review")).toBeNull();
  });

  it("renders the Review icon once at least one wiki exists", () => {
    mockUseWikis.mockReturnValue({
      data: [buildWiki()],
      isLoading: false,
    });
    mockUseWikiPendingCounts.mockReturnValue(pendingCounts({ "wiki-1": 0 }));
    render(<WikiSubSidebar />);
    expect(screen.getByTestId("wiki-sub-sidebar-review")).toBeInTheDocument();
  });

  it("omits the badge when every count is zero", () => {
    mockUseWikis.mockReturnValue({
      data: [buildWiki({ id: "w1" }), buildWiki({ id: "w2", slug: "w2" })],
      isLoading: false,
    });
    mockUseWikiPendingCounts.mockReturnValue(pendingCounts({ w1: 0, w2: 0 }));

    render(<WikiSubSidebar />);
    const reviewBtn = screen.getByTestId("wiki-sub-sidebar-review");
    // NotificationBadge returns null when count <= 0 — so the count text
    // "0" must not appear inside the review button.
    expect(reviewBtn.textContent).not.toMatch(/\d/);
  });

  it("sums the aggregated per-wiki counts into the badge", () => {
    mockUseWikis.mockReturnValue({
      data: [
        buildWiki({ id: "w1", slug: "w1" }),
        buildWiki({ id: "w2", slug: "w2" }),
        buildWiki({ id: "w3", slug: "w3" }),
      ],
      isLoading: false,
    });
    mockUseWikiPendingCounts.mockReturnValue(
      pendingCounts({ w1: 2, w2: 0, w3: 5 }),
    );

    render(<WikiSubSidebar />);
    const reviewBtn = screen.getByTestId("wiki-sub-sidebar-review");
    expect(reviewBtn).toHaveTextContent("7");
  });

  it("treats missing pending-counts data as zero (still loading)", () => {
    mockUseWikis.mockReturnValue({
      data: [buildWiki({ id: "w1", slug: "w1" })],
      isLoading: false,
    });
    // Hook hasn't resolved yet → data is undefined; the badge must fall
    // back to 0 rather than crashing on the optional chain.
    mockUseWikiPendingCounts.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });

    render(<WikiSubSidebar />);
    const reviewBtn = screen.getByTestId("wiki-sub-sidebar-review");
    expect(reviewBtn.textContent).not.toMatch(/\d/);
  });

  it("navigates to the first wiki's review route when none is selected", () => {
    mockUseWikis.mockReturnValue({
      data: [buildWiki({ id: "w1", slug: "first" })],
      isLoading: false,
    });
    mockUseWikiPendingCounts.mockReturnValue(pendingCounts({ w1: 1 }));

    render(<WikiSubSidebar />);
    fireEvent.click(screen.getByTestId("wiki-sub-sidebar-review"));

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/wiki/$wikiSlug/-/review",
      params: { wikiSlug: "first" },
    });
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
    mockUseWikiPendingCounts.mockReturnValue(pendingCounts({ w1: 0, w2: 3 }));

    render(<WikiSubSidebar />);
    fireEvent.click(screen.getByTestId("wiki-sub-sidebar-review"));

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/wiki/$wikiSlug/-/review",
      params: { wikiSlug: "second" },
    });
  });
});
