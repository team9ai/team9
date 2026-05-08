import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  MoreHorizontal,
  Plus,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useWikiPage } from "@/hooks/useWikiPage";
import { cn } from "@/lib/utils";
import {
  DEFAULT_WIKI_INDEX_FILENAME,
  LEGACY_WIKI_INDEX_FILENAME,
  stripWikiPageExtension,
} from "@/lib/wiki-paths";
import {
  useSelectedWikiId,
  useSelectedPagePath,
  useWikiStore,
  wikiActions,
} from "@/stores/useWikiStore";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { WikiTreeNodeData } from "@/lib/wiki-tree";

interface WikiTreeNodeProps {
  node: WikiTreeNodeData;
  wikiId?: string;
  wikiSlug: string;
  depth: number;
  onCreatePage?: (parentPath: string) => void;
}

function findFolderIndexChild(node: WikiTreeNodeData): WikiTreeNodeData | null {
  return (
    node.children.find((child) => child.name === DEFAULT_WIKI_INDEX_FILENAME) ??
    node.children.find((child) => child.name === LEGACY_WIKI_INDEX_FILENAME) ??
    null
  );
}

function isFolderIndexNode(node: WikiTreeNodeData): boolean {
  return (
    node.type === "file" &&
    (node.name === DEFAULT_WIKI_INDEX_FILENAME ||
      node.name === LEGACY_WIKI_INDEX_FILENAME)
  );
}

/**
 * Recursive tree-entry row. A file row navigates to its splat URL on click.
 * A directory row toggles its expanded state; if the directory contains an
 * `index.md9` child we additionally navigate to that index so clicking a
 * folder never leaves the user on a blank pane when there's an obvious
 * landing page. Legacy `index.md` folders are still supported for existing
 * content.
 */
export function WikiTreeNode({
  node,
  wikiId,
  wikiSlug,
  depth,
  onCreatePage,
}: WikiTreeNodeProps) {
  const { t } = useTranslation("wiki");
  const navigate = useNavigate();
  const [actionsOpen, setActionsOpen] = useState(false);
  // Per-key selector subscription: instead of pulling the entire Set and
  // re-rendering on ANY expansion change, we subscribe only to this node's
  // boolean. With thousands of tree nodes this limits the re-render churn
  // when the user toggles one directory to only the affected subtree.
  const isExpanded = useWikiStore((s) => s.expandedDirectories.has(node.path));
  const selectedWikiId = useSelectedWikiId();
  const selectedPath = useSelectedPagePath();
  const indexChild = node.type === "dir" ? findFolderIndexChild(node) : null;
  const { data: indexPage } = useWikiPage(
    wikiId ?? null,
    indexChild?.path ?? null,
  );
  const visibleChildren =
    node.type === "dir"
      ? node.children.filter((child) => !isFolderIndexNode(child))
      : [];
  const isIndexedDirectory = node.type === "dir" && indexChild !== null;
  const isIndexOnlyDirectory =
    isIndexedDirectory && visibleChildren.length === 0;
  const isSelectedWiki = wikiId === undefined || selectedWikiId === wikiId;
  const isActive =
    isSelectedWiki &&
    ((node.type === "file" && selectedPath === node.path) ||
      (isIndexedDirectory && selectedPath === indexChild.path));
  const displayName =
    node.type === "file" ? stripWikiPageExtension(node.name) : node.name;
  const indexIcon =
    typeof indexPage?.frontmatter.icon === "string" &&
    indexPage.frontmatter.icon.trim().length > 0
      ? indexPage.frontmatter.icon.trim()
      : "📄";
  const createParentPath =
    node.type === "dir"
      ? node.path
      : node.path.split("/").slice(0, -1).join("/");

  const handleCreatePage = () => {
    if (!onCreatePage) return;
    onCreatePage(createParentPath);
  };

  const actionMenu = (itemTestId: string) => (
    <DropdownMenuItem data-testid={itemTestId} onSelect={handleCreatePage}>
      <Plus size={14} />
      {t("listItem.newPage")}
    </DropdownMenuItem>
  );

  const selectPage = (path: string) => {
    if (wikiId) {
      wikiActions.setSelectedWiki(wikiId);
    }
    wikiActions.setSelectedPage(path);
  };

  const handleClick = () => {
    if (node.type === "dir") {
      if (indexChild) {
        // Dir has an index page — navigate to it. Only folders with visible
        // children expand; index-only folders behave like ordinary pages.
        if (visibleChildren.length > 0) {
          wikiActions.expandDirectory(node.path);
        }
        selectPage(indexChild.path);
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

    selectPage(node.path);
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
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={cn(
              "group/wiki-tree-node flex items-center hover:bg-muted/50",
              isActive &&
                "bg-[var(--nav-active)] text-[var(--nav-foreground-strong)] font-medium",
            )}
          >
            <button
              role="treeitem"
              aria-level={ariaLevel}
              aria-expanded={
                node.type === "dir" && !isIndexOnlyDirectory
                  ? isExpanded
                  : undefined
              }
              aria-selected={isActive || undefined}
              type="button"
              onClick={handleClick}
              style={{ paddingLeft: `${8 + depth * 14}px` }}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-1 px-2 py-1 text-xs text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isActive &&
                  "bg-[var(--nav-active)] text-[var(--nav-foreground-strong)] font-medium",
              )}
            >
              {node.type === "dir" && !isIndexOnlyDirectory ? (
                isExpanded ? (
                  <ChevronDown size={12} />
                ) : (
                  <ChevronRight size={12} />
                )
              ) : (
                <span style={{ width: 12 }} />
              )}
              {isIndexedDirectory ? (
                <span
                  data-testid={`wiki-tree-node-icon-${node.path}`}
                  className="flex h-3 w-3 items-center justify-center text-[12px] leading-none"
                >
                  {indexIcon}
                </span>
              ) : node.type === "dir" ? (
                <Folder size={12} />
              ) : (
                <FileText size={12} />
              )}
              <span className="truncate">{displayName}</span>
            </button>
            {onCreatePage && (
              <>
                <button
                  type="button"
                  aria-label={t("listItem.newPage")}
                  title={t("listItem.newPage")}
                  data-testid={`wiki-tree-node-create-${node.path}`}
                  onClick={handleCreatePage}
                  className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover/wiki-tree-node:opacity-100"
                >
                  <Plus size={14} />
                </button>
                <DropdownMenu open={actionsOpen} onOpenChange={setActionsOpen}>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={t("listItem.actionsLabel", {
                        name: displayName,
                      })}
                      data-testid={`wiki-tree-node-actions-${node.path}`}
                      className={cn(
                        "mr-2 flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        actionsOpen
                          ? "opacity-100"
                          : "opacity-0 group-hover/wiki-tree-node:opacity-100 focus-visible:opacity-100",
                      )}
                    >
                      <MoreHorizontal size={14} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40">
                    {actionMenu(`wiki-tree-node-menu-create-${node.path}`)}
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
        </ContextMenuTrigger>
        {onCreatePage && (
          <ContextMenuContent className="w-40">
            <ContextMenuItem
              data-testid={`wiki-tree-node-context-create-${node.path}`}
              onSelect={handleCreatePage}
            >
              <Plus size={14} className="mr-2" />
              {t("listItem.newPage")}
            </ContextMenuItem>
          </ContextMenuContent>
        )}
      </ContextMenu>
      {node.type === "dir" && isExpanded && visibleChildren.length > 0 && (
        <div role="group">
          {visibleChildren.map((child) => (
            <WikiTreeNode
              key={child.path}
              node={child}
              wikiId={wikiId}
              wikiSlug={wikiSlug}
              depth={depth + 1}
              onCreatePage={onCreatePage}
            />
          ))}
        </div>
      )}
    </div>
  );
}
