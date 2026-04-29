import { ChevronDown, ChevronRight, FileText, Folder } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FolderTreeNodeData } from "@/lib/folder-tree";

export interface FolderTreeNodeProps {
  node: FolderTreeNodeData;
  depth: number;
  /**
   * Path of the file currently selected in the editor (file rows highlight
   * iff `node.path === selectedPath`). `null` means nothing is selected.
   */
  selectedPath: string | null;
  /**
   * Set of expanded directory paths. Per-node identity is checked via
   * `expandedDirs.has(node.path)`. The shell owns this Set and updates
   * it via `onToggleExpand`.
   */
  expandedDirs: ReadonlySet<string>;
  /**
   * Fired when the user clicks a file row. The shell should treat this
   * as "load + show this file in the editor". The argument is the full
   * path from the folder root (matches the folder9 entry's `path`).
   */
  onSelect: (path: string) => void;
  /**
   * Fired when the user clicks a directory row. `hasIndex` is true when
   * the directory contains an `index.md` child (the wiki convention for
   * landing pages). The shell uses this to decide whether to navigate
   * to the index file in addition to flipping expansion state.
   *
   * Implementations that don't care about index navigation (e.g. routine
   * SKILL folders, where there's no convention of folder-index files)
   * can ignore the `hasIndex` flag.
   */
  onToggleExpand: (dirPath: string, hasIndex: boolean) => void;
}

/**
 * Recursive tree-entry row for a folder9-backed editor.
 *
 * This is the source-agnostic counterpart of the wiki sidebar's
 * `WikiTreeNode`. It carries no knowledge of routes, stores, or product
 * surfaces — instead, the selected-path / expansion state and click
 * handling are passed in as props by `<Folder9FolderEditor>`.
 *
 * WAI-ARIA tree semantics: each node is a `treeitem`. Directory nodes
 * carry `aria-expanded` (true/false); file nodes omit the attribute so
 * AT don't announce a file as a collapsible node. `aria-level` is
 * 1-based per the spec; the caller is expected to start at `depth=0`
 * for top-level nodes (we add 1 for the level attribute).
 */
export function FolderTreeNode({
  node,
  depth,
  selectedPath,
  expandedDirs,
  onSelect,
  onToggleExpand,
}: FolderTreeNodeProps) {
  const isExpanded = expandedDirs.has(node.path);
  const isActive = node.type === "file" && selectedPath === node.path;

  const handleClick = () => {
    if (node.type === "dir") {
      const hasIndex = node.children.some((c) => c.name === "index.md");
      onToggleExpand(node.path, hasIndex);
      return;
    }
    onSelect(node.path);
  };

  const ariaLevel = depth + 1;
  return (
    <div>
      <button
        role="treeitem"
        aria-level={ariaLevel}
        aria-expanded={node.type === "dir" ? isExpanded : undefined}
        aria-selected={isActive || undefined}
        type="button"
        onClick={handleClick}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        className={cn(
          "flex items-center gap-1 px-2 py-1 text-xs w-full text-left hover:bg-accent",
          isActive && "bg-primary/10 text-primary font-medium",
        )}
      >
        {node.type === "dir" ? (
          isExpanded ? (
            <ChevronDown size={12} />
          ) : (
            <ChevronRight size={12} />
          )
        ) : (
          <span style={{ width: 12 }} />
        )}
        {node.type === "dir" ? <Folder size={12} /> : <FileText size={12} />}
        <span className="truncate">{node.name}</span>
      </button>
      {node.type === "dir" && isExpanded && node.children.length > 0 && (
        <div role="group">
          {node.children.map((child) => (
            <FolderTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              expandedDirs={expandedDirs}
              onSelect={onSelect}
              onToggleExpand={onToggleExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
}
