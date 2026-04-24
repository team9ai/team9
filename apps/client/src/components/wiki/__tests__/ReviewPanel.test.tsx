import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewPanel } from "../ReviewPanel";
import type { ProposalDto, WikiDto } from "@/types/wiki";

const mockUseWikiProposals = vi.hoisted(() => vi.fn());
const mockUseWikiWebSocketSync = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useWikiProposals", () => ({
  useWikiProposals: (...args: unknown[]) => mockUseWikiProposals(...args),
}));

vi.mock("@/hooks/useWikiWebSocketSync", () => ({
  useWikiWebSocketSync: (...args: unknown[]) =>
    mockUseWikiWebSocketSync(...args),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    children,
    ...rest
  }: {
    to: string;
    params?: Record<string, string>;
    children: React.ReactNode;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a
      href={to}
      data-to={to}
      data-params={JSON.stringify(params ?? {})}
      {...rest}
    >
      {children}
    </a>
  ),
}));

function buildWiki(overrides: Partial<WikiDto> = {}): WikiDto {
  return {
    id: "wiki-1",
    workspaceId: "ws-1",
    name: "Public Wiki",
    slug: "public",
    approvalMode: "review",
    humanPermission: "write",
    agentPermission: "read",
    createdBy: "user-1",
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    archivedAt: null,
    ...overrides,
  };
}

function buildProposal(overrides: Partial<ProposalDto> = {}): ProposalDto {
  return {
    id: "prop-1",
    wikiId: "wiki-1",
    title: "Update README",
    description: "",
    status: "pending",
    authorId: "user-2",
    authorType: "user",
    createdAt: "2026-04-02T00:00:00.000Z",
    reviewedBy: null,
    reviewedAt: null,
    ...overrides,
  };
}

describe("ReviewPanel", () => {
  beforeEach(() => {
    mockUseWikiProposals.mockReset();
    mockUseWikiWebSocketSync.mockReset();
  });

  it("subscribes to the wiki WebSocket sync hook when mounted", () => {
    mockUseWikiProposals.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    });
    render(<ReviewPanel wiki={buildWiki()} />);
    expect(mockUseWikiWebSocketSync).toHaveBeenCalled();
  });

  it("renders the wiki name in the heading", () => {
    mockUseWikiProposals.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    });
    render(<ReviewPanel wiki={buildWiki()} />);
    expect(
      screen.getByRole("heading", { name: /Review – Public Wiki/ }),
    ).toBeInTheDocument();
  });

  it("shows a loading placeholder while the query is pending", () => {
    mockUseWikiProposals.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });
    render(<ReviewPanel wiki={buildWiki()} />);
    expect(screen.getByTestId("wiki-review-panel-loading")).toBeInTheDocument();
  });

  it("shows an error state when the query fails", () => {
    mockUseWikiProposals.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });
    render(<ReviewPanel wiki={buildWiki()} />);
    expect(screen.getByTestId("wiki-review-panel-error")).toBeInTheDocument();
  });

  it("shows the empty state when no proposals are pending", () => {
    mockUseWikiProposals.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    });
    render(<ReviewPanel wiki={buildWiki()} />);
    expect(screen.getByTestId("wiki-review-panel-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("wiki-review-panel-list")).toBeNull();
  });

  it("renders a row per proposal with author and timestamp", () => {
    mockUseWikiProposals.mockReturnValue({
      data: [
        buildProposal({ id: "prop-1", title: "First" }),
        buildProposal({
          id: "prop-2",
          title: "Second",
          authorType: "agent",
          authorId: "agent-1",
          status: "pending",
        }),
      ],
      isLoading: false,
      isError: false,
    });
    render(<ReviewPanel wiki={buildWiki()} />);

    const list = screen.getByTestId("wiki-review-panel-list");
    expect(list.querySelectorAll("li")).toHaveLength(2);

    const row1 = screen.getByTestId("wiki-review-panel-row-prop-1");
    expect(row1).toHaveTextContent("First");
    expect(row1).toHaveTextContent(/User user-2/);

    const row2 = screen.getByTestId("wiki-review-panel-row-prop-2");
    expect(row2).toHaveTextContent("Second");
    expect(row2).toHaveTextContent(/Agent agent-1/);
    expect(row2).toHaveAttribute(
      "data-params",
      JSON.stringify({ wikiSlug: "public", proposalId: "prop-2" }),
    );
  });

  it("falls back to a placeholder title when the proposal has none", () => {
    mockUseWikiProposals.mockReturnValue({
      data: [buildProposal({ id: "prop-3", title: "" })],
      isLoading: false,
      isError: false,
    });
    render(<ReviewPanel wiki={buildWiki()} />);
    expect(
      screen.getByTestId("wiki-review-panel-row-prop-3"),
    ).toHaveTextContent(/Untitled proposal/);
  });

  it("passes the wiki id into the proposals hook", () => {
    mockUseWikiProposals.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    });
    render(<ReviewPanel wiki={buildWiki({ id: "wiki-xyz" })} />);
    expect(mockUseWikiProposals).toHaveBeenCalledWith("wiki-xyz");
  });
});
