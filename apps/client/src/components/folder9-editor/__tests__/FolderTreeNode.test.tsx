import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FolderTreeNode } from "../FolderTreeNode";
import type { FolderTreeNodeData } from "@/lib/folder-tree";

function fileNode(
  path: string,
  children: FolderTreeNodeData[] = [],
): FolderTreeNodeData {
  return { name: path.split("/").pop()!, path, type: "file", children };
}

function dirNode(
  path: string,
  children: FolderTreeNodeData[] = [],
): FolderTreeNodeData {
  return { name: path.split("/").pop() ?? path, path, type: "dir", children };
}

describe("FolderTreeNode", () => {
  it("calls onSelect with the file path when a file row is clicked", () => {
    const onSelect = vi.fn();
    render(
      <FolderTreeNode
        node={fileNode("api/auth.md")}
        depth={0}
        selectedPath={null}
        expandedDirs={new Set()}
        onSelect={onSelect}
        onToggleExpand={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("treeitem", { name: /auth\.md/ }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("api/auth.md");
  });

  it("does not call onSelect when a directory is clicked", () => {
    const onSelect = vi.fn();
    render(
      <FolderTreeNode
        node={dirNode("api", [fileNode("api/x.md")])}
        depth={0}
        selectedPath={null}
        expandedDirs={new Set()}
        onSelect={onSelect}
        onToggleExpand={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("treeitem", { name: /api/ }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("calls onToggleExpand with hasIndex=false for a dir without index.md", () => {
    const onToggleExpand = vi.fn();
    render(
      <FolderTreeNode
        node={dirNode("api", [fileNode("api/other.md")])}
        depth={0}
        selectedPath={null}
        expandedDirs={new Set()}
        onSelect={vi.fn()}
        onToggleExpand={onToggleExpand}
      />,
    );
    fireEvent.click(screen.getByRole("treeitem", { name: /api/ }));
    expect(onToggleExpand).toHaveBeenCalledWith("api", false);
  });

  it("calls onToggleExpand with hasIndex=true when the dir has an index.md", () => {
    const onToggleExpand = vi.fn();
    render(
      <FolderTreeNode
        node={dirNode("api", [fileNode("api/index.md")])}
        depth={0}
        selectedPath={null}
        expandedDirs={new Set()}
        onSelect={vi.fn()}
        onToggleExpand={onToggleExpand}
      />,
    );
    fireEvent.click(screen.getByRole("treeitem", { name: /api/ }));
    expect(onToggleExpand).toHaveBeenCalledWith("api", true);
  });

  it("button carries role=treeitem (not a wrapper div)", () => {
    render(
      <FolderTreeNode
        node={fileNode("api/auth.md")}
        depth={0}
        selectedPath={null}
        expandedDirs={new Set()}
        onSelect={vi.fn()}
        onToggleExpand={vi.fn()}
      />,
    );
    const btn = screen.getByRole("treeitem");
    expect(btn.tagName).toBe("BUTTON");
  });

  it("button has correct aria-level (depth + 1)", () => {
    render(
      <FolderTreeNode
        node={fileNode("auth.md")}
        depth={2}
        selectedPath={null}
        expandedDirs={new Set()}
        onSelect={vi.fn()}
        onToggleExpand={vi.fn()}
      />,
    );
    expect(screen.getByRole("treeitem")).toHaveAttribute("aria-level", "3");
  });

  it("directory button has aria-expanded=false when collapsed", () => {
    render(
      <FolderTreeNode
        node={dirNode("api", [fileNode("api/x.md")])}
        depth={0}
        selectedPath={null}
        expandedDirs={new Set()}
        onSelect={vi.fn()}
        onToggleExpand={vi.fn()}
      />,
    );
    expect(screen.getByRole("treeitem")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("directory button has aria-expanded=true when path is in expandedDirs", () => {
    render(
      <FolderTreeNode
        node={dirNode("api", [fileNode("api/x.md")])}
        depth={0}
        selectedPath={null}
        expandedDirs={new Set(["api"])}
        onSelect={vi.fn()}
        onToggleExpand={vi.fn()}
      />,
    );
    expect(screen.getByRole("treeitem", { name: /api/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("file button does not have aria-expanded", () => {
    render(
      <FolderTreeNode
        node={fileNode("auth.md")}
        depth={0}
        selectedPath={null}
        expandedDirs={new Set()}
        onSelect={vi.fn()}
        onToggleExpand={vi.fn()}
      />,
    );
    expect(screen.getByRole("treeitem")).not.toHaveAttribute("aria-expanded");
  });

  it("active file button has aria-selected=true when selectedPath matches", () => {
    render(
      <FolderTreeNode
        node={fileNode("api/auth.md")}
        depth={0}
        selectedPath="api/auth.md"
        expandedDirs={new Set()}
        onSelect={vi.fn()}
        onToggleExpand={vi.fn()}
      />,
    );
    expect(screen.getByRole("treeitem")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("does not highlight a non-matching file", () => {
    render(
      <FolderTreeNode
        node={fileNode("api/auth.md")}
        depth={0}
        selectedPath="api/other.md"
        expandedDirs={new Set()}
        onSelect={vi.fn()}
        onToggleExpand={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("treeitem", { name: /auth\.md/ }).className,
    ).not.toMatch(/border-l-primary/);
  });

  it("does not highlight a directory even when its path matches selectedPath", () => {
    // Directory rows never carry the active highlight — only files do.
    render(
      <FolderTreeNode
        node={dirNode("api")}
        depth={0}
        selectedPath="api"
        expandedDirs={new Set()}
        onSelect={vi.fn()}
        onToggleExpand={vi.fn()}
      />,
    );
    expect(screen.getByRole("treeitem", { name: /api/ }).className).not.toMatch(
      /border-l-primary/,
    );
  });

  it("highlights the active file with a subtle row and primary left edge", () => {
    render(
      <FolderTreeNode
        node={fileNode("api/auth.md")}
        depth={0}
        selectedPath="api/auth.md"
        expandedDirs={new Set()}
        onSelect={vi.fn()}
        onToggleExpand={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("treeitem", { name: /auth\.md/ }).className,
    ).toMatch(/border-l-primary/);
  });

  it("makes file rows draggable and writes their path to dataTransfer", () => {
    const setData = vi.fn();
    render(
      <FolderTreeNode
        node={fileNode("api/auth.md")}
        depth={0}
        selectedPath={null}
        expandedDirs={new Set()}
        onSelect={vi.fn()}
        onToggleExpand={vi.fn()}
      />,
    );

    const row = screen.getByRole("treeitem", { name: /auth\.md/ });
    expect(row).toHaveAttribute("draggable", "true");
    fireEvent.dragStart(row, {
      dataTransfer: {
        effectAllowed: "none",
        setData,
      },
    });

    expect(setData).toHaveBeenCalledWith(
      "application/x-team9-folder-entry",
      JSON.stringify({ path: "api/auth.md", type: "file" }),
    );
    expect(setData).toHaveBeenCalledWith(
      "application/x-team9-folder-file",
      "api/auth.md",
    );
    expect(setData).toHaveBeenCalledWith("text/plain", "api/auth.md");
  });

  it("makes directory rows draggable and writes their path to dataTransfer", () => {
    const setData = vi.fn();
    render(
      <FolderTreeNode
        node={dirNode("api")}
        depth={0}
        selectedPath={null}
        expandedDirs={new Set()}
        onSelect={vi.fn()}
        onToggleExpand={vi.fn()}
      />,
    );

    const row = screen.getByRole("treeitem", { name: /api/ });
    expect(row).toHaveAttribute("draggable", "true");
    fireEvent.dragStart(row, {
      dataTransfer: {
        effectAllowed: "none",
        setData,
      },
    });

    expect(setData).toHaveBeenCalledWith(
      "application/x-team9-folder-entry",
      JSON.stringify({ path: "api", type: "dir" }),
    );
    expect(setData).not.toHaveBeenCalledWith(
      "application/x-team9-folder-file",
      "api",
    );
    expect(setData).toHaveBeenCalledWith("text/plain", "api");
  });

  it("moves an internal file when dropped on a directory", () => {
    const onMoveFileToDirectory = vi.fn();
    render(
      <FolderTreeNode
        node={dirNode("docs")}
        depth={0}
        selectedPath={null}
        expandedDirs={new Set()}
        onSelect={vi.fn()}
        onToggleExpand={vi.fn()}
        onMoveFileToDirectory={onMoveFileToDirectory}
      />,
    );

    fireEvent.drop(screen.getByRole("treeitem", { name: /docs/ }), {
      dataTransfer: {
        getData: (type: string) =>
          type === "application/x-team9-folder-file" ? "api/auth.md" : "",
        files: [],
      },
    });

    expect(onMoveFileToDirectory).toHaveBeenCalledWith("api/auth.md", "docs");
  });

  it("moves an internal folder when dropped on a directory", () => {
    const onMoveEntryToDirectory = vi.fn();
    render(
      <FolderTreeNode
        node={dirNode("archive")}
        depth={0}
        selectedPath={null}
        expandedDirs={new Set()}
        onSelect={vi.fn()}
        onToggleExpand={vi.fn()}
        onMoveEntryToDirectory={onMoveEntryToDirectory}
      />,
    );

    fireEvent.drop(screen.getByRole("treeitem", { name: /archive/ }), {
      dataTransfer: {
        getData: (type: string) =>
          type === "application/x-team9-folder-entry"
            ? JSON.stringify({ path: "docs", type: "dir" })
            : "",
        files: [],
      },
    });

    expect(onMoveEntryToDirectory).toHaveBeenCalledWith(
      "docs",
      "dir",
      "archive",
    );
  });

  it("drops internal entries into an expanded directory group", () => {
    const onMoveEntryToDirectory = vi.fn();
    render(
      <FolderTreeNode
        node={dirNode("api", [fileNode("api/index.md")])}
        depth={0}
        selectedPath={null}
        expandedDirs={new Set(["api"])}
        onSelect={vi.fn()}
        onToggleExpand={vi.fn()}
        onMoveEntryToDirectory={onMoveEntryToDirectory}
      />,
    );

    fireEvent.drop(screen.getByRole("group"), {
      dataTransfer: {
        getData: (type: string) =>
          type === "application/x-team9-folder-entry"
            ? JSON.stringify({ path: "docs", type: "dir" })
            : "",
        files: [],
      },
    });

    expect(onMoveEntryToDirectory).toHaveBeenCalledWith("docs", "dir", "api");
  });

  it("applies depth-based paddingLeft as an inline style", () => {
    render(
      <FolderTreeNode
        node={fileNode("auth.md")}
        depth={3}
        selectedPath={null}
        expandedDirs={new Set()}
        onSelect={vi.fn()}
        onToggleExpand={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("treeitem", { name: /auth\.md/ }).getAttribute("style"),
    ).toMatch(/padding-left: 50px/);
  });

  it("renders children only when the dir is in expandedDirs", () => {
    const node = dirNode("api", [fileNode("api/auth.md")]);
    const { rerender } = render(
      <FolderTreeNode
        node={node}
        depth={0}
        selectedPath={null}
        expandedDirs={new Set()}
        onSelect={vi.fn()}
        onToggleExpand={vi.fn()}
      />,
    );
    expect(screen.queryByRole("treeitem", { name: /auth\.md/ })).toBeNull();

    rerender(
      <FolderTreeNode
        node={node}
        depth={0}
        selectedPath={null}
        expandedDirs={new Set(["api"])}
        onSelect={vi.fn()}
        onToggleExpand={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("treeitem", { name: /auth\.md/ }),
    ).toBeInTheDocument();
  });

  it("recursively renders nested children when expanded", () => {
    const tree = dirNode("api", [
      dirNode("api/v1", [fileNode("api/v1/auth.md")]),
    ]);

    render(
      <FolderTreeNode
        node={tree}
        depth={0}
        selectedPath={null}
        expandedDirs={new Set(["api", "api/v1"])}
        onSelect={vi.fn()}
        onToggleExpand={vi.fn()}
      />,
    );

    expect(screen.getByRole("treeitem", { name: /api$/ })).toBeInTheDocument();
    expect(screen.getByRole("treeitem", { name: /v1/ })).toBeInTheDocument();
    expect(
      screen.getByRole("treeitem", { name: /auth\.md/ }),
    ).toBeInTheDocument();
  });

  it("renders a chevron-down when expanded, chevron-right when collapsed", () => {
    const node = dirNode("api", [fileNode("api/x.md")]);
    const { container, rerender } = render(
      <FolderTreeNode
        node={node}
        depth={0}
        selectedPath={null}
        expandedDirs={new Set()}
        onSelect={vi.fn()}
        onToggleExpand={vi.fn()}
      />,
    );
    expect(container.querySelector(".lucide-chevron-right")).not.toBeNull();

    rerender(
      <FolderTreeNode
        node={node}
        depth={0}
        selectedPath={null}
        expandedDirs={new Set(["api"])}
        onSelect={vi.fn()}
        onToggleExpand={vi.fn()}
      />,
    );
    expect(container.querySelector(".lucide-chevron-down")).not.toBeNull();
  });

  it("renders no chevron icon for files (only a spacer)", () => {
    const { container } = render(
      <FolderTreeNode
        node={fileNode("auth.md")}
        depth={0}
        selectedPath={null}
        expandedDirs={new Set()}
        onSelect={vi.fn()}
        onToggleExpand={vi.fn()}
      />,
    );
    expect(container.querySelector(".lucide-chevron-right")).toBeNull();
    expect(container.querySelector(".lucide-chevron-down")).toBeNull();
  });

  it("keeps an empty expanded group as a drop target without extra rows", () => {
    const { container } = render(
      <FolderTreeNode
        node={dirNode("api")}
        depth={0}
        selectedPath={null}
        expandedDirs={new Set(["api"])}
        onSelect={vi.fn()}
        onToggleExpand={vi.fn()}
      />,
    );
    expect(screen.getByRole("group")).toBeInTheDocument();
    expect(container.querySelectorAll("[role='treeitem']")).toHaveLength(1);
  });
});
