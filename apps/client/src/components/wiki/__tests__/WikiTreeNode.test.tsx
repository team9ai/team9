import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WikiTreeNode } from "../WikiTreeNode";
import { useWikiStore } from "@/stores/useWikiStore";
import type { WikiTreeNodeData } from "@/lib/wiki-tree";

const mockNavigate = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
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
    fireEvent.click(screen.getByRole("button", { name: /auth\.md/ }));

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/wiki/$wikiSlug/$",
      params: { wikiSlug: "public", _splat: "api/auth.md" },
    });
  });

  it("does not toggle a directory when clicking a file", () => {
    render(
      <WikiTreeNode
        node={fileNode("api/auth.md")}
        wikiSlug="public"
        depth={0}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /auth\.md/ }));

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
    fireEvent.click(screen.getByRole("button", { name: /api/ }));
    expect(useWikiStore.getState().expandedDirectories.has("api")).toBe(true);
  });

  it("does not navigate when the directory has no index.md", () => {
    render(
      <WikiTreeNode
        node={dirNode("api", [fileNode("api/other.md")])}
        wikiSlug="public"
        depth={0}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /api/ }));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("navigates to index.md when the directory has an index.md child", () => {
    render(
      <WikiTreeNode
        node={dirNode("api", [fileNode("api/index.md")])}
        wikiSlug="public"
        depth={0}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /api/ }));
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/wiki/$wikiSlug/$",
      params: { wikiSlug: "public", _splat: "api/index.md" },
    });
  });

  it("renders children only when the dir is expanded", () => {
    const node = dirNode("api", [fileNode("api/auth.md")]);
    const { rerender } = render(
      <WikiTreeNode node={node} wikiSlug="public" depth={0} />,
    );
    expect(screen.queryByRole("button", { name: /auth\.md/ })).toBeNull();

    act(() => {
      useWikiStore.getState().toggleDirectory("api");
    });
    rerender(<WikiTreeNode node={node} wikiSlug="public" depth={0} />);

    expect(
      screen.getByRole("button", { name: /auth\.md/ }),
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
    expect(screen.getByRole("button", { name: /auth\.md/ }).className).toMatch(
      /bg-primary/,
    );
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
      screen.getByRole("button", { name: /auth\.md/ }).className,
    ).not.toMatch(/bg-primary/);
  });

  it("does not highlight a directory even when its path matches selectedPagePath", () => {
    act(() => {
      useWikiStore.getState().setSelectedPage("api");
    });
    render(<WikiTreeNode node={dirNode("api")} wikiSlug="public" depth={0} />);
    expect(screen.getByRole("button", { name: /api/ }).className).not.toMatch(
      /bg-primary/,
    );
  });

  it("applies depth-based paddingLeft as an inline style", () => {
    render(
      <WikiTreeNode node={fileNode("auth.md")} wikiSlug="public" depth={3} />,
    );
    const button = screen.getByRole("button", { name: /auth\.md/ });
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

    expect(screen.getByRole("button", { name: /api$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /v1/ })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /auth\.md/ }),
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
    // Exactly one button (the dir row) — no nested wrapper div
    expect(container.querySelectorAll("button")).toHaveLength(1);
  });
});
