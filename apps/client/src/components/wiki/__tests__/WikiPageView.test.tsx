import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PageDto, WikiDto } from "@/types/wiki";

const mockUseWikiPage = vi.hoisted(() => vi.fn());
const mockUseWikis = vi.hoisted(() => vi.fn());
const mockUseSubmittedProposal = vi.hoisted(() => vi.fn());
const mockNavigate = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useWikiPage", () => ({
  useWikiPage: (...args: unknown[]) => mockUseWikiPage(...args),
}));

vi.mock("@/hooks/useWikis", () => ({
  useWikis: (...args: unknown[]) => mockUseWikis(...args),
}));

vi.mock("@/stores/useWikiStore", () => ({
  useSubmittedProposal: (...args: unknown[]) =>
    mockUseSubmittedProposal(...args),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

// Child components are covered by their own tests; stub them here so we
// can focus on the composite's own branching logic (loading, cover-or-
// fallback, wired-up props).
vi.mock("../WikiCover", () => ({
  WikiCover: ({
    wikiId,
    coverPath,
  }: {
    wikiId: string;
    coverPath: string | null;
  }) => (
    <div
      data-testid="cover-stub"
      data-wiki-id={wikiId}
      data-cover-path={coverPath ?? ""}
    />
  ),
}));

vi.mock("../WikiPageHeader", () => ({
  WikiPageHeader: ({ wikiSlug, path }: { wikiSlug: string; path: string }) => (
    <div data-testid="header-stub" data-slug={wikiSlug} data-path={path} />
  ),
}));

vi.mock("../WikiPageEditor", () => ({
  WikiPageEditor: ({ wikiId, path }: { wikiId: string; path: string }) => (
    <div data-testid="editor-stub" data-wiki-id={wikiId} data-path={path} />
  ),
}));

vi.mock("../WikiProposalBanner", () => ({
  WikiProposalBanner: ({
    proposalId,
    onView,
  }: {
    proposalId: string;
    onView: (id: string) => void;
  }) => (
    <button
      type="button"
      data-testid="banner-stub"
      data-proposal-id={proposalId}
      onClick={() => onView(proposalId)}
    >
      banner
    </button>
  ),
}));

import { WikiPageView } from "../WikiPageView";

const wiki: WikiDto = {
  id: "wiki-1",
  workspaceId: "ws-1",
  name: "Handbook",
  slug: "handbook",
  icon: null,
  approvalMode: "auto",
  humanPermission: "write",
  agentPermission: "read",
  createdBy: "user-1",
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
  archivedAt: null,
};

const page: PageDto = {
  path: "index.md",
  content: "# Welcome",
  encoding: "text",
  frontmatter: {},
  lastCommit: null,
};

beforeEach(() => {
  mockUseWikiPage.mockReset();
  mockUseWikis.mockReset();
  mockUseSubmittedProposal.mockReset();
  mockUseSubmittedProposal.mockReturnValue(null);
  mockNavigate.mockReset();
});

describe("WikiPageView", () => {
  it("shows loading cue while the page is fetching", () => {
    mockUseWikiPage.mockReturnValue({ data: undefined, isLoading: true });
    mockUseWikis.mockReturnValue({ data: [wiki], isLoading: false });
    render(<WikiPageView wikiId="wiki-1" path="index.md" />);
    expect(screen.getByTestId("wiki-page-loading")).toBeInTheDocument();
  });

  it("shows loading cue while the wikis list is fetching", () => {
    mockUseWikiPage.mockReturnValue({ data: page, isLoading: false });
    mockUseWikis.mockReturnValue({ data: undefined, isLoading: true });
    render(<WikiPageView wikiId="wiki-1" path="index.md" />);
    expect(screen.getByTestId("wiki-page-loading")).toBeInTheDocument();
  });

  it("shows the not-found empty state when the wikis list resolves without the selected wiki (e.g. archived mid-session)", () => {
    mockUseWikiPage.mockReturnValue({ data: page, isLoading: false });
    mockUseWikis.mockReturnValue({ data: [], isLoading: false });
    render(<WikiPageView wikiId="wiki-1" path="index.md" />);
    // The loading cue must NOT render — previously this condition produced
    // an infinite loading state; now we render the empty-state copy so the
    // user can recover.
    expect(screen.queryByTestId("wiki-page-loading")).toBeNull();
    expect(
      screen.getByText(/not found/i, { exact: false }),
    ).toBeInTheDocument();
  });

  it("shows an empty state when the selected page is missing after the query settles", () => {
    mockUseWikiPage.mockReturnValue({ data: undefined, isLoading: false });
    mockUseWikis.mockReturnValue({ data: [wiki], isLoading: false });
    render(<WikiPageView wikiId="wiki-1" path="index.md" />);
    expect(screen.queryByTestId("wiki-page-loading")).toBeNull();
    expect(
      screen.getByText(/page doesn't exist/i, { exact: false }),
    ).toBeInTheDocument();
  });

  it("renders the composite when both queries resolve", () => {
    mockUseWikiPage.mockReturnValue({ data: page, isLoading: false });
    mockUseWikis.mockReturnValue({ data: [wiki], isLoading: false });
    render(<WikiPageView wikiId="wiki-1" path="index.md" />);

    expect(screen.getByTestId("wiki-page-view")).toBeInTheDocument();
    expect(screen.getByTestId("cover-stub")).toBeInTheDocument();
    expect(screen.getByTestId("header-stub").dataset.slug).toBe("handbook");
    expect(screen.getByTestId("editor-stub").dataset.path).toBe("index.md");
  });

  it("passes coverPath=null when frontmatter.cover is missing", () => {
    mockUseWikiPage.mockReturnValue({ data: page, isLoading: false });
    mockUseWikis.mockReturnValue({ data: [wiki], isLoading: false });
    render(<WikiPageView wikiId="wiki-1" path="index.md" />);
    expect(screen.getByTestId("cover-stub").dataset.coverPath).toBe("");
  });

  it("forwards a string cover path to WikiCover", () => {
    mockUseWikiPage.mockReturnValue({
      data: { ...page, frontmatter: { cover: "assets/banner.png" } },
      isLoading: false,
    });
    mockUseWikis.mockReturnValue({ data: [wiki], isLoading: false });
    render(<WikiPageView wikiId="wiki-1" path="index.md" />);
    expect(screen.getByTestId("cover-stub").dataset.coverPath).toBe(
      "assets/banner.png",
    );
  });

  it("ignores non-string frontmatter.cover values", () => {
    mockUseWikiPage.mockReturnValue({
      data: { ...page, frontmatter: { cover: 123 } },
      isLoading: false,
    });
    mockUseWikis.mockReturnValue({ data: [wiki], isLoading: false });
    render(<WikiPageView wikiId="wiki-1" path="index.md" />);
    expect(screen.getByTestId("cover-stub").dataset.coverPath).toBe("");
  });

  it("ignores an empty-string frontmatter.cover (treats as no cover)", () => {
    mockUseWikiPage.mockReturnValue({
      data: { ...page, frontmatter: { cover: "" } },
      isLoading: false,
    });
    mockUseWikis.mockReturnValue({ data: [wiki], isLoading: false });
    render(<WikiPageView wikiId="wiki-1" path="index.md" />);
    expect(screen.getByTestId("cover-stub").dataset.coverPath).toBe("");
  });

  it("does not render the proposal banner when no proposal is pending", () => {
    mockUseWikiPage.mockReturnValue({ data: page, isLoading: false });
    mockUseWikis.mockReturnValue({ data: [wiki], isLoading: false });
    mockUseSubmittedProposal.mockReturnValue(null);
    render(<WikiPageView wikiId="wiki-1" path="index.md" />);
    expect(screen.queryByTestId("banner-stub")).toBeNull();
  });

  it("renders the proposal banner when a proposal id is recorded for this page", () => {
    mockUseWikiPage.mockReturnValue({ data: page, isLoading: false });
    mockUseWikis.mockReturnValue({ data: [wiki], isLoading: false });
    mockUseSubmittedProposal.mockReturnValue("prop-42");
    render(<WikiPageView wikiId="wiki-1" path="index.md" />);
    const banner = screen.getByTestId("banner-stub");
    expect(banner).toBeInTheDocument();
    expect(banner.dataset.proposalId).toBe("prop-42");
  });

  it("queries useSubmittedProposal with the page-specific (wikiId, path)", () => {
    mockUseWikiPage.mockReturnValue({ data: page, isLoading: false });
    mockUseWikis.mockReturnValue({ data: [wiki], isLoading: false });
    mockUseSubmittedProposal.mockReturnValue(null);
    render(<WikiPageView wikiId="wiki-1" path="docs/intro.md" />);
    expect(mockUseSubmittedProposal).toHaveBeenCalledWith(
      "wiki-1",
      "docs/intro.md",
    );
  });

  it("banner onView navigates to the review route with wikiSlug and proposalId", () => {
    mockUseWikiPage.mockReturnValue({ data: page, isLoading: false });
    mockUseWikis.mockReturnValue({ data: [wiki], isLoading: false });
    mockUseSubmittedProposal.mockReturnValue("prop-42");
    render(<WikiPageView wikiId="wiki-1" path="index.md" />);
    fireEvent.click(screen.getByTestId("banner-stub"));
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    const arg = mockNavigate.mock.calls[0][0] as {
      to: string;
      params: { wikiSlug: string; proposalId: string };
    };
    expect(arg.to).toBe("/wiki/$wikiSlug/-/review/$proposalId");
    expect(arg.params).toEqual({ wikiSlug: "handbook", proposalId: "prop-42" });
  });

  it("renders the binary-file placeholder instead of the editor when encoding is base64", () => {
    mockUseWikiPage.mockReturnValue({
      data: { ...page, encoding: "base64" },
      isLoading: false,
    });
    mockUseWikis.mockReturnValue({ data: [wiki], isLoading: false });
    render(<WikiPageView wikiId="wiki-1" path="image.png" />);

    const placeholder = screen.getByTestId("wiki-page-binary");
    expect(placeholder).toBeInTheDocument();
    expect(placeholder).toHaveTextContent("Binary file — not editable here.");
    expect(screen.queryByTestId("editor-stub")).toBeNull();
  });
});
