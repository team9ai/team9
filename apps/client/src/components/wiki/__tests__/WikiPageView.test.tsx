import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PageDto, WikiDto } from "@/types/wiki";

const mockUseWikiPage = vi.hoisted(() => vi.fn());
const mockUseWikis = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useWikiPage", () => ({
  useWikiPage: (...args: unknown[]) => mockUseWikiPage(...args),
}));

vi.mock("@/hooks/useWikis", () => ({
  useWikis: (...args: unknown[]) => mockUseWikis(...args),
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

import { WikiPageView } from "../WikiPageView";

const wiki: WikiDto = {
  id: "wiki-1",
  workspaceId: "ws-1",
  name: "Handbook",
  slug: "handbook",
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
  frontmatter: {},
  lastCommit: null,
};

beforeEach(() => {
  mockUseWikiPage.mockReset();
  mockUseWikis.mockReset();
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

  it("shows loading cue when the wiki id isn't in the fetched list yet", () => {
    mockUseWikiPage.mockReturnValue({ data: page, isLoading: false });
    mockUseWikis.mockReturnValue({ data: [], isLoading: false });
    render(<WikiPageView wikiId="wiki-1" path="index.md" />);
    expect(screen.getByTestId("wiki-page-loading")).toBeInTheDocument();
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
});
