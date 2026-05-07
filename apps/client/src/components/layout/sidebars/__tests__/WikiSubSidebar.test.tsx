import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WikiSubSidebar } from "../WikiSubSidebar";
import { useWikiStore } from "@/stores/useWikiStore";
import type { WikiDto } from "@/types/wiki";

const mockUseWikis = vi.hoisted(() => vi.fn());
const mockOnOpenChange = vi.hoisted(() => vi.fn());

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

describe("WikiSubSidebar", () => {
  beforeEach(() => {
    mockUseWikis.mockReset();
    mockOnOpenChange.mockReset();
    useWikiStore.getState().reset();
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

  it("does not render the review shortcut in the sidebar header", () => {
    mockUseWikis.mockReturnValue({ data: [], isLoading: false });
    render(<WikiSubSidebar />);
    expect(screen.queryByTestId("wiki-sub-sidebar-review")).toBeNull();
  });
});
