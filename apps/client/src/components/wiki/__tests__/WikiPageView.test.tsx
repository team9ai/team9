import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PageDto, WikiDto } from "@/types/wiki";

const mockUseWikiPage = vi.hoisted(() => vi.fn());
const mockUseWikis = vi.hoisted(() => vi.fn());
const mockUseSubmittedProposal = vi.hoisted(() => vi.fn());
const mockNavigate = vi.hoisted(() => vi.fn());
const mockCommit = vi.hoisted(() => vi.fn());
const mockSetSubmittedProposal = vi.hoisted(() => vi.fn());
const mockUploadCover = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useWikiPage", () => ({
  useWikiPage: (...args: unknown[]) => mockUseWikiPage(...args),
}));

vi.mock("@/hooks/useWikis", () => ({
  useWikis: (...args: unknown[]) => mockUseWikis(...args),
}));

vi.mock("@/hooks/useWikiImageUpload", () => ({
  useWikiImageUpload: () => ({
    upload: (...args: unknown[]) => mockUploadCover(...args),
    uploading: false,
  }),
}));

vi.mock("@/stores/useWikiStore", () => ({
  useSubmittedProposal: (...args: unknown[]) =>
    mockUseSubmittedProposal(...args),
  wikiActions: {
    setSubmittedProposal: (...args: unknown[]) =>
      mockSetSubmittedProposal(...args),
  },
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("@/services/api/wikis", () => ({
  wikisApi: {
    commit: (...args: unknown[]) => mockCommit(...args),
  },
}));

// Child components are covered by their own tests; stub them here so we
// can focus on the composite's own branching logic (loading, cover-or-
// fallback, wired-up props).
vi.mock("../WikiCover", () => ({
  WikiCover: ({
    wikiId,
    coverPath,
    editable,
    onChangeCover,
    onUploadCover,
  }: {
    wikiId: string;
    coverPath: string | null;
    editable?: boolean;
    onChangeCover?: (cover: string) => void;
    onUploadCover?: (file: File) => Promise<string>;
  }) => {
    const uploadAndApply = async () => {
      const path = await onUploadCover?.(
        new File(["image"], "cover.png", { type: "image/png" }),
      );
      if (path) onChangeCover?.(path);
    };
    return (
      <div
        data-testid="cover-stub"
        data-wiki-id={wikiId}
        data-cover-path={coverPath ?? ""}
        data-editable={editable ? "true" : "false"}
      >
        <button
          type="button"
          data-testid="cover-change-stub"
          onClick={() => onChangeCover?.("covers/manual.png")}
        />
        <button
          type="button"
          data-testid="cover-upload-stub"
          onClick={() => {
            void uploadAndApply();
          }}
        />
      </div>
    );
  },
}));

vi.mock("../WikiPageHeader", () => ({
  WikiPageHeader: ({
    wikiSlug,
    path,
    onFrontmatterChange,
  }: {
    wikiSlug: string;
    path: string;
    onFrontmatterChange?: (next: Record<string, unknown>) => void;
  }) => (
    <button
      type="button"
      data-testid="header-stub"
      data-slug={wikiSlug}
      data-path={path}
      onClick={() => onFrontmatterChange?.({ title: "Renamed", icon: "🎨" })}
    />
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
  mockCommit.mockReset();
  mockSetSubmittedProposal.mockReset();
  mockUploadCover.mockReset();
  mockUploadCover.mockResolvedValue("covers/uploaded.png");
  mockCommit.mockResolvedValue({ commit: { sha: "sha-1" }, proposal: null });
  vi.spyOn(window, "alert").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WikiPageView", () => {
  it("shows loading cue while the page is fetching", () => {
    mockUseWikiPage.mockReturnValue({ data: undefined, isLoading: true });
    mockUseWikis.mockReturnValue({ data: [wiki], isLoading: false });
    render(<WikiPageView wikiId="wiki-1" path="index.md" />);
    expect(screen.getByTestId("wiki-page-loading")).toBeInTheDocument();
  });

  it("centers the loading cue in the content pane with a spinner", () => {
    mockUseWikiPage.mockReturnValue({ data: undefined, isLoading: true });
    mockUseWikis.mockReturnValue({ data: [wiki], isLoading: false });
    const { container } = render(
      <WikiPageView wikiId="wiki-1" path="index.md" />,
    );

    const loading = screen.getByTestId("wiki-page-loading");
    expect(loading).toHaveClass("h-full", "items-center", "justify-center");
    expect(container.querySelector("svg.animate-spin")).not.toBeNull();
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

  it("creates the default md9 homepage when it is missing and the user can write", async () => {
    mockUseWikiPage.mockReturnValue({ data: undefined, isLoading: false });
    mockUseWikis.mockReturnValue({ data: [wiki], isLoading: false });
    render(<WikiPageView wikiId="wiki-1" path="index.md9" />);

    expect(screen.getByTestId("wiki-page-loading")).toBeInTheDocument();
    await waitFor(() => {
      expect(mockCommit).toHaveBeenCalledWith("wiki-1", {
        message: "Create index.md9",
        files: [
          {
            path: "index.md9",
            content: "# Handbook\n\n",
            encoding: "text",
            action: "create",
          },
        ],
      });
    });
  });

  it("does not auto-create non-index missing pages", () => {
    mockUseWikiPage.mockReturnValue({ data: undefined, isLoading: false });
    mockUseWikis.mockReturnValue({ data: [wiki], isLoading: false });
    render(<WikiPageView wikiId="wiki-1" path="docs/missing.md9" />);

    expect(mockCommit).not.toHaveBeenCalled();
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

  it("commits title and emoji metadata changes from the page header", async () => {
    mockUseWikiPage.mockReturnValue({
      data: {
        ...page,
        path: "index.md9",
        content: "Body",
        frontmatter: { title: "Old", icon: "📄" },
      },
      isLoading: false,
    });
    mockUseWikis.mockReturnValue({ data: [wiki], isLoading: false });
    render(<WikiPageView wikiId="wiki-1" path="index.md9" />);

    fireEvent.click(screen.getByTestId("header-stub"));

    await waitFor(() => {
      expect(mockCommit).toHaveBeenCalledWith("wiki-1", {
        message: "Update index.md9",
        files: [
          {
            path: "index.md9",
            content: "---\ntitle: Renamed\nicon: 🎨\n---\n\nBody",
            encoding: "text",
            action: "update",
          },
        ],
      });
    });
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

  it("commits cover metadata changes from the cover band", async () => {
    mockUseWikiPage.mockReturnValue({
      data: {
        ...page,
        path: "index.md9",
        content: "# Body",
        frontmatter: { title: "Home" },
      },
      isLoading: false,
    });
    mockUseWikis.mockReturnValue({ data: [wiki], isLoading: false });
    render(<WikiPageView wikiId="wiki-1" path="index.md9" />);

    fireEvent.click(screen.getByTestId("cover-change-stub"));

    await waitFor(() => {
      expect(mockCommit).toHaveBeenCalledWith("wiki-1", {
        message: "Update index.md9",
        files: [
          {
            path: "index.md9",
            content:
              "---\ntitle: Home\ncover: covers/manual.png\n---\n\n# Body",
            encoding: "text",
            action: "update",
          },
        ],
      });
    });
  });

  it("uploads a local cover image and commits the uploaded path", async () => {
    mockUseWikiPage.mockReturnValue({
      data: { ...page, path: "index.md9", content: "Body" },
      isLoading: false,
    });
    mockUseWikis.mockReturnValue({ data: [wiki], isLoading: false });
    render(<WikiPageView wikiId="wiki-1" path="index.md9" />);

    fireEvent.click(screen.getByTestId("cover-upload-stub"));

    await waitFor(() => {
      expect(mockUploadCover).toHaveBeenCalledWith(expect.any(File), "covers");
    });
    await waitFor(() => {
      expect(mockCommit).toHaveBeenCalledWith("wiki-1", {
        message: "Update index.md9",
        files: [
          {
            path: "index.md9",
            content: "---\ncover: covers/uploaded.png\n---\n\nBody",
            encoding: "text",
            action: "update",
          },
        ],
      });
    });
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
