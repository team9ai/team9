import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WikiTreeNode } from "../WikiTreeNode";
import { useWikiStore } from "@/stores/useWikiStore";
import type { WikiTreeNodeData } from "@/lib/wiki-tree";

const mockNavigate = vi.hoisted(() => vi.fn());
const mockUseWikiPage = vi.hoisted(() => vi.fn());
const mockCreatePage = vi.hoisted(() => vi.fn());
const mockDeletePage = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("@/hooks/useWikiPage", () => ({
  useWikiPage: (...args: unknown[]) => mockUseWikiPage(...args),
}));

function fileNode(
  path: string,
  children: WikiTreeNodeData[] = [],
): WikiTreeNodeData {
  return { name: path.split("/").pop()!, path, type: "file", children };
}

function dirNode(
  path: string,
  children: WikiTreeNodeData[] = [],
): WikiTreeNodeData {
  return { name: path.split("/").pop() ?? path, path, type: "dir", children };
}

describe("WikiTreeNode", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockUseWikiPage.mockReset();
    mockUseWikiPage.mockReturnValue({ data: undefined });
    mockCreatePage.mockReset();
    mockDeletePage.mockReset();
    act(() => {
      useWikiStore.getState().reset();
    });
  });

  afterEach(() => {
    act(() => {
      useWikiStore.getState().reset();
    });
  });

  it("navigates to the file's splat URL on file click", () => {
    render(
      <WikiTreeNode
        node={fileNode("api/auth.md")}
        wikiSlug="public"
        depth={0}
      />,
    );
    fireEvent.click(screen.getByRole("treeitem", { name: /auth\.md/ }));

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/wiki/$wikiSlug/$",
      params: { wikiSlug: "public", _splat: "api/auth.md" },
    });
  });

  it("button carries role=treeitem (not a wrapper div)", () => {
    render(
      <WikiTreeNode
        node={fileNode("api/auth.md")}
        wikiSlug="public"
        depth={0}
      />,
    );
    const btn = screen.getByRole("treeitem");
    expect(btn.tagName).toBe("BUTTON");
  });

  it("button has correct aria-level (depth + 1)", () => {
    render(
      <WikiTreeNode node={fileNode("auth.md")} wikiSlug="public" depth={2} />,
    );
    const btn = screen.getByRole("treeitem");
    expect(btn).toHaveAttribute("aria-level", "3");
  });

  it("directory button has aria-expanded=false when collapsed", () => {
    render(
      <WikiTreeNode
        node={dirNode("api", [fileNode("api/x.md")])}
        wikiSlug="public"
        depth={0}
      />,
    );
    const btn = screen.getByRole("treeitem");
    expect(btn).toHaveAttribute("aria-expanded", "false");
  });

  it("directory button has aria-expanded=true when expanded", () => {
    act(() => {
      useWikiStore.getState().toggleDirectory("api");
    });
    render(
      <WikiTreeNode
        node={dirNode("api", [fileNode("api/x.md")])}
        wikiSlug="public"
        depth={0}
      />,
    );
    const btn = screen.getByRole("treeitem", { name: /api/ });
    expect(btn).toHaveAttribute("aria-expanded", "true");
  });

  it("file button does not have aria-expanded", () => {
    render(
      <WikiTreeNode node={fileNode("auth.md")} wikiSlug="public" depth={0} />,
    );
    const btn = screen.getByRole("treeitem");
    expect(btn).not.toHaveAttribute("aria-expanded");
  });

  it("active file button has aria-selected=true", () => {
    act(() => {
      useWikiStore.getState().setSelectedPage("api/auth.md");
    });
    render(
      <WikiTreeNode
        node={fileNode("api/auth.md")}
        wikiSlug="public"
        depth={0}
      />,
    );
    const btn = screen.getByRole("treeitem");
    expect(btn).toHaveAttribute("aria-selected", "true");
  });

  it("does not toggle a directory when clicking a file", () => {
    render(
      <WikiTreeNode
        node={fileNode("api/auth.md")}
        wikiSlug="public"
        depth={0}
      />,
    );
    fireEvent.click(screen.getByRole("treeitem", { name: /auth\.md/ }));

    expect(useWikiStore.getState().expandedDirectories.has("api/auth.md")).toBe(
      false,
    );
  });

  it("toggles the store's expanded state when clicking a directory", () => {
    render(
      <WikiTreeNode
        node={dirNode("api", [fileNode("api/other.md")])}
        wikiSlug="public"
        depth={0}
      />,
    );
    fireEvent.click(screen.getByRole("treeitem", { name: /api/ }));
    expect(useWikiStore.getState().expandedDirectories.has("api")).toBe(true);
  });

  it("does not navigate when the directory has no index page", () => {
    render(
      <WikiTreeNode
        node={dirNode("api", [fileNode("api/other.md")])}
        wikiSlug="public"
        depth={0}
      />,
    );
    fireEvent.click(screen.getByRole("treeitem", { name: /api/ }));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("navigates to index.md9 when the directory has an index.md9 child", () => {
    render(
      <WikiTreeNode
        node={dirNode("api", [fileNode("api/index.md9")])}
        wikiSlug="public"
        depth={0}
      />,
    );
    fireEvent.click(screen.getByRole("treeitem", { name: /api/ }));
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/wiki/$wikiSlug/$",
      params: { wikiSlug: "public", _splat: "api/index.md9" },
    });
  });

  it("selects the folder document immediately when clicking a directory with index.md9", () => {
    render(
      <WikiTreeNode
        node={dirNode("api", [fileNode("api/index.md9")])}
        wikiId="wiki-public"
        wikiSlug="public"
        depth={0}
      />,
    );
    fireEvent.click(screen.getByRole("treeitem", { name: /api/ }));

    expect(useWikiStore.getState().selectedWikiId).toBe("wiki-public");
    expect(useWikiStore.getState().selectedPagePath).toBe("api/index.md9");
  });

  it("renders create and actions buttons for tree rows", () => {
    render(
      <WikiTreeNode
        node={dirNode("api", [fileNode("api/index.md9")])}
        wikiId="wiki-public"
        wikiSlug="public"
        depth={0}
        onCreatePage={mockCreatePage}
      />,
    );

    expect(screen.getByTestId("wiki-tree-node-create-api")).toBeInTheDocument();
    expect(
      screen.getByTestId("wiki-tree-node-actions-api"),
    ).toBeInTheDocument();
  });

  it("uses the plus button to create a child page under that tree node", () => {
    render(
      <WikiTreeNode
        node={dirNode("api", [fileNode("api/index.md9")])}
        wikiId="wiki-public"
        wikiSlug="public"
        depth={0}
        onCreatePage={mockCreatePage}
      />,
    );

    fireEvent.click(screen.getByTestId("wiki-tree-node-create-api"));

    expect(mockCreatePage).toHaveBeenCalledWith("api");
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("opens a right-click menu with page actions for tree rows", async () => {
    render(
      <WikiTreeNode
        node={dirNode("api", [fileNode("api/index.md9")])}
        wikiId="wiki-public"
        wikiSlug="public"
        depth={0}
        onCreatePage={mockCreatePage}
        onDeletePage={mockDeletePage}
      />,
    );

    fireEvent.contextMenu(screen.getByRole("treeitem", { name: /api/ }));

    expect(
      await screen.findByTestId("wiki-tree-node-context-create-api"),
    ).toBeInTheDocument();
    expect(
      await screen.findByTestId("wiki-tree-node-context-delete-api"),
    ).toBeInTheDocument();
  });

  it("uses the right-click delete action on the folder document path", async () => {
    render(
      <WikiTreeNode
        node={dirNode("api", [fileNode("api/index.md9")])}
        wikiId="wiki-public"
        wikiSlug="public"
        depth={0}
        onCreatePage={mockCreatePage}
        onDeletePage={mockDeletePage}
      />,
    );

    fireEvent.contextMenu(screen.getByRole("treeitem", { name: /api/ }));
    fireEvent.click(
      await screen.findByTestId("wiki-tree-node-context-delete-api"),
    );

    expect(mockDeletePage).toHaveBeenCalledWith("api/index.md9");
  });

  it("treats an index-only folder as a page row without expanding it", () => {
    const { container } = render(
      <WikiTreeNode
        node={dirNode("api", [fileNode("api/index.md9")])}
        wikiId="wiki-public"
        wikiSlug="public"
        depth={0}
      />,
    );
    const row = screen.getByRole("treeitem", { name: /api/ });

    expect(row).not.toHaveAttribute("aria-expanded");
    expect(container.querySelector(".lucide-chevron-right")).toBeNull();
    expect(container.querySelector(".lucide-chevron-down")).toBeNull();

    fireEvent.click(row);

    expect(useWikiStore.getState().expandedDirectories.has("api")).toBe(false);
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/wiki/$wikiSlug/$",
      params: { wikiSlug: "public", _splat: "api/index.md9" },
    });
  });

  it("uses the folder document emoji icon instead of a folder icon", () => {
    mockUseWikiPage.mockReturnValue({
      data: {
        path: "api/index.md9",
        content: "",
        encoding: "text",
        frontmatter: { icon: "📘" },
        lastCommit: null,
      },
    });
    const { container } = render(
      <WikiTreeNode
        node={dirNode("api", [fileNode("api/index.md9")])}
        wikiId="wiki-public"
        wikiSlug="public"
        depth={0}
      />,
    );

    expect(
      screen.getByRole("treeitem", { name: /📘.*api/ }),
    ).toBeInTheDocument();
    expect(container.querySelector(".lucide-folder")).toBeNull();
    expect(mockUseWikiPage).toHaveBeenCalledWith(
      "wiki-public",
      "api/index.md9",
    );
  });

  it("prefers index.md9 over legacy index.md when both exist", () => {
    render(
      <WikiTreeNode
        node={dirNode("api", [
          fileNode("api/index.md"),
          fileNode("api/index.md9"),
        ])}
        wikiSlug="public"
        depth={0}
      />,
    );
    fireEvent.click(screen.getByRole("treeitem", { name: /api/ }));
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/wiki/$wikiSlug/$",
      params: { wikiSlug: "public", _splat: "api/index.md9" },
    });
  });

  it("still navigates to legacy index.md for existing folders", () => {
    render(
      <WikiTreeNode
        node={dirNode("api", [fileNode("api/index.md")])}
        wikiSlug="public"
        depth={0}
      />,
    );
    fireEvent.click(screen.getByRole("treeitem", { name: /api/ }));
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/wiki/$wikiSlug/$",
      params: { wikiSlug: "public", _splat: "api/index.md" },
    });
  });

  it("hides the .md9 extension in the tree label", () => {
    render(
      <WikiTreeNode
        node={fileNode("api/file-title.md9")}
        wikiSlug="public"
        depth={0}
      />,
    );

    expect(
      screen.getByRole("treeitem", { name: "file-title" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("file-title.md9")).toBeNull();
  });

  it("does not render index.md9 as a child row because it is the folder document", () => {
    act(() => {
      useWikiStore.getState().toggleDirectory("api");
    });
    render(
      <WikiTreeNode
        node={dirNode("api", [
          fileNode("api/index.md9"),
          fileNode("api/overview.md9"),
        ])}
        wikiSlug="public"
        depth={0}
      />,
    );

    expect(screen.queryByRole("treeitem", { name: /^index$/ })).toBeNull();
    expect(
      screen.getByRole("treeitem", { name: /^overview$/ }),
    ).toBeInTheDocument();
  });

  it("highlights a directory when its folder document is selected", () => {
    act(() => {
      useWikiStore.getState().setSelectedPage("api/index.md9");
    });
    render(
      <WikiTreeNode
        node={dirNode("api", [fileNode("api/index.md9")])}
        wikiSlug="public"
        depth={0}
      />,
    );

    const row = screen.getByTestId("wiki-tree-node-row-api");
    expect(row).toHaveClass(
      "bg-[var(--nav-active)]",
      "text-[var(--nav-foreground-strong)]",
      "font-medium",
    );
    expect(row).not.toHaveClass("bg-primary/10", "text-primary");
  });

  it("expands (not toggles) an indexed directory with visible children so repeated clicks never collapse it", () => {
    // Regression guard against the toggle+navigate race: if clicks toggled
    // the dir, the second click would collapse it after navigating — and the
    // splat route's auto-expand would then re-open, producing a flicker.
    // Using `expandDirectory` keeps the dir open across repeated clicks.
    render(
      <WikiTreeNode
        node={dirNode("api", [
          fileNode("api/index.md9"),
          fileNode("api/overview.md9"),
        ])}
        wikiSlug="public"
        depth={0}
      />,
    );
    const button = screen.getByRole("treeitem", { name: /api/ });

    fireEvent.click(button);
    expect(useWikiStore.getState().expandedDirectories.has("api")).toBe(true);

    // Second click — if we were using toggleDirectory this would collapse.
    fireEvent.click(button);
    expect(useWikiStore.getState().expandedDirectories.has("api")).toBe(true);
  });

  it("uses toggleDirectory for a dir without index.md so clicks can collapse it", () => {
    // Counter-case to the expand-only path: a plain dir has no reason to
    // stay sticky, so clicking should flip its state.
    render(
      <WikiTreeNode
        node={dirNode("api", [fileNode("api/other.md")])}
        wikiSlug="public"
        depth={0}
      />,
    );
    const button = screen.getByRole("treeitem", { name: /api/ });

    fireEvent.click(button);
    expect(useWikiStore.getState().expandedDirectories.has("api")).toBe(true);

    // Second click collapses because there's no index to justify stickiness.
    fireEvent.click(button);
    expect(useWikiStore.getState().expandedDirectories.has("api")).toBe(false);
  });

  it("renders children only when the dir is expanded", () => {
    const node = dirNode("api", [fileNode("api/auth.md")]);
    const { rerender } = render(
      <WikiTreeNode node={node} wikiSlug="public" depth={0} />,
    );
    expect(screen.queryByRole("treeitem", { name: /auth\.md/ })).toBeNull();

    act(() => {
      useWikiStore.getState().toggleDirectory("api");
    });
    rerender(<WikiTreeNode node={node} wikiSlug="public" depth={0} />);

    expect(
      screen.getByRole("treeitem", { name: /auth\.md/ }),
    ).toBeInTheDocument();
  });

  it("highlights the active file when its path matches the store's selectedPagePath", () => {
    act(() => {
      useWikiStore.getState().setSelectedPage("api/auth.md");
    });
    render(
      <WikiTreeNode
        node={fileNode("api/auth.md")}
        wikiSlug="public"
        depth={0}
      />,
    );
    const row = screen.getByTestId("wiki-tree-node-row-api/auth.md");
    expect(row).toHaveClass(
      "bg-[var(--nav-active)]",
      "text-[var(--nav-foreground-strong)]",
      "font-medium",
    );
    expect(row).not.toHaveClass("bg-primary/10", "text-primary");
  });

  it("does not highlight a same-path file from a different selected wiki", () => {
    act(() => {
      useWikiStore.getState().setSelectedWiki("wiki-other");
      useWikiStore.getState().setSelectedPage("api/auth.md");
    });
    render(
      <WikiTreeNode
        node={fileNode("api/auth.md")}
        wikiId="wiki-current"
        wikiSlug="public"
        depth={0}
      />,
    );

    const row = screen.getByRole("treeitem", { name: /auth\.md/ });
    expect(row).not.toHaveAttribute("aria-selected");
    expect(
      screen.getByTestId("wiki-tree-node-row-api/auth.md"),
    ).not.toHaveClass("bg-[var(--nav-active)]");
  });

  it("does not highlight a non-matching file", () => {
    act(() => {
      useWikiStore.getState().setSelectedPage("api/other.md");
    });
    render(
      <WikiTreeNode
        node={fileNode("api/auth.md")}
        wikiSlug="public"
        depth={0}
      />,
    );
    expect(
      screen.getByTestId("wiki-tree-node-row-api/auth.md"),
    ).not.toHaveClass("bg-[var(--nav-active)]");
  });

  it("does not highlight a directory even when its path matches selectedPagePath", () => {
    act(() => {
      useWikiStore.getState().setSelectedPage("api");
    });
    render(<WikiTreeNode node={dirNode("api")} wikiSlug="public" depth={0} />);
    expect(screen.getByRole("treeitem", { name: /api/ }).className).not.toMatch(
      /bg-primary/,
    );
  });

  it("applies depth-based paddingLeft as an inline style", () => {
    render(
      <WikiTreeNode node={fileNode("auth.md")} wikiSlug="public" depth={3} />,
    );
    const button = screen.getByRole("treeitem", { name: /auth\.md/ });
    expect(button.getAttribute("style")).toMatch(/padding-left: 50px/);
  });

  it("recursively renders nested children when expanded", () => {
    act(() => {
      useWikiStore.getState().toggleDirectory("api");
      useWikiStore.getState().toggleDirectory("api/v1");
    });

    const tree = dirNode("api", [
      dirNode("api/v1", [fileNode("api/v1/auth.md")]),
    ]);

    render(<WikiTreeNode node={tree} wikiSlug="public" depth={0} />);

    expect(screen.getByRole("treeitem", { name: /api$/ })).toBeInTheDocument();
    expect(screen.getByRole("treeitem", { name: /v1/ })).toBeInTheDocument();
    expect(
      screen.getByRole("treeitem", { name: /auth\.md/ }),
    ).toBeInTheDocument();
  });

  it("renders a chevron-down when expanded, chevron-right when collapsed", () => {
    const node = dirNode("api", [fileNode("api/x.md")]);
    const { container, rerender } = render(
      <WikiTreeNode node={node} wikiSlug="public" depth={0} />,
    );
    // Collapsed initially — chevron-right (lucide adds class "lucide-chevron-right")
    expect(container.querySelector(".lucide-chevron-right")).not.toBeNull();

    act(() => {
      useWikiStore.getState().toggleDirectory("api");
    });
    rerender(<WikiTreeNode node={node} wikiSlug="public" depth={0} />);
    expect(container.querySelector(".lucide-chevron-down")).not.toBeNull();
  });

  it("renders a spacer icon in place of a chevron for files", () => {
    const { container } = render(
      <WikiTreeNode node={fileNode("auth.md")} wikiSlug="public" depth={0} />,
    );
    expect(container.querySelector(".lucide-chevron-right")).toBeNull();
    expect(container.querySelector(".lucide-chevron-down")).toBeNull();
  });

  it("renders nothing for children-wrapper when dir is expanded but empty", () => {
    act(() => {
      useWikiStore.getState().toggleDirectory("api");
    });
    const { container } = render(
      <WikiTreeNode node={dirNode("api")} wikiSlug="public" depth={0} />,
    );
    // Exactly one treeitem button (the dir row) — no nested wrapper div
    expect(container.querySelectorAll("[role='treeitem']")).toHaveLength(1);
  });
});
