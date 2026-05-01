import { ChevronDown, ChevronRight, FileText, Folder } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import {
  DEFAULT_WIKI_INDEX_FILENAME,
  LEGACY_WIKI_INDEX_FILENAME,
  stripWikiPageExtension,
} from "@/lib/wiki-paths";
import {
  useSelectedPagePath,
  useWikiStore,
  wikiActions,
} from "@/stores/useWikiStore";
import type { WikiTreeNodeData } from "@/lib/wiki-tree";

interface WikiTreeNodeProps {
  node: WikiTreeNodeData;
  wikiSlug: string;
  depth: number;
}

/**
 * Recursive tree-entry row. A file row navigates to its splat URL on click.
 * A directory row toggles its expanded state; if the directory contains an
 * `index.md9` child we additionally navigate to that index so clicking a
 * folder never leaves the user on a blank pane when there's an obvious
 * landing page. Legacy `index.md` folders are still supported for existing
 * content.
 */
export function WikiTreeNode({ node, wikiSlug, depth }: WikiTreeNodeProps) {
  const navigate = useNavigate();
  // Per-key selector subscription: instead of pulling the entire Set and
  // re-rendering on ANY expansion change, we subscribe only to this node's
  // boolean. With thousands of tree nodes this limits the re-render churn
  // when the user toggles one directory to only the affected subtree.
  const isExpanded = useWikiStore((s) => s.expandedDirectories.has(node.path));
  const selectedPath = useSelectedPagePath();
  const isActive = node.type === "file" && selectedPath === node.path;
  const displayName =
    node.type === "file" ? stripWikiPageExtension(node.name) : node.name;

  const handleClick = () => {
    if (node.type === "dir") {
      const indexChild =
        node.children.find((c) => c.name === DEFAULT_WIKI_INDEX_FILENAME) ??
        node.children.find((c) => c.name === LEGACY_WIKI_INDEX_FILENAME);
      if (indexChild) {
        // Dir has an index page — expand (idempotent) and navigate. We avoid
        // `toggleDirectory` here because the splat route's useEffect will
        // re-expand the dir as an ancestor of the selected page, producing
        // a one-paint collapse flicker if the dir was already open when
        // clicked.
        wikiActions.expandDirectory(node.path);
        void navigate({
          to: "/wiki/$wikiSlug/$",
          params: { wikiSlug, _splat: indexChild.path },
        });
        return;
      }
      // No index page — clicking is a pure UI toggle, no nav.
      wikiActions.toggleDirectory(node.path);
      return;
    }

    void navigate({
      to: "/wiki/$wikiSlug/$",
      params: { wikiSlug, _splat: node.path },
    });
  };

  // WAI-ARIA tree semantics: each node is a `treeitem`. Directory nodes
  // carry `aria-expanded` (true/false) — file nodes omit the attribute so
  // AT don't announce a file as a collapsible node. `aria-level` is 1-based
  // per the spec; our parent `WikiListItem` is level 1 (the wiki row), so
  // tree nodes start at level 2 (their `depth` prop is already 1-based from
  // `WikiListItem` passing `depth={1}`), and increments from there.
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
        <span className="truncate">{displayName}</span>
      </button>
      {node.type === "dir" && isExpanded && node.children.length > 0 && (
        <div role="group">
          {node.children.map((child) => (
            <WikiTreeNode
              key={child.path}
              node={child}
              wikiSlug={wikiSlug}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
