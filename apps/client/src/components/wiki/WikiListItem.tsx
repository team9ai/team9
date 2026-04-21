import { useMemo } from "react";
import {
  ChevronDown,
  ChevronRight,
  Library as LibraryIcon,
} from "lucide-react";
import { useWikiTree } from "@/hooks/useWikiTree";
import { useExpandedDirectories, wikiActions } from "@/stores/useWikiStore";
import { buildTree } from "@/lib/wiki-tree";
import { WikiTreeNode } from "./WikiTreeNode";
import type { WikiDto } from "@/types/wiki";

interface WikiListItemProps {
  wiki: WikiDto;
}

/**
 * One wiki row in the sub-sidebar. The wiki tree is lazy-loaded — the
 * `useWikiTree` query is disabled until the user expands this row, so
 * opening the sidebar with many wikis costs exactly one list fetch and
 * zero tree fetches.
 *
 * The expanded state lives in the shared wiki store under the `wiki:<id>`
 * key so a later navigation (e.g. coming back from a deep link) can
 * auto-expand this row without duplicating bookkeeping.
 */
export function WikiListItem({ wiki }: WikiListItemProps) {
  const expanded = useExpandedDirectories();
  const expandKey = `wiki:${wiki.id}`;
  const isOpen = expanded.has(expandKey);

  const { data: entries } = useWikiTree(isOpen ? wiki.id : null);
  const tree = useMemo(() => (entries ? buildTree(entries) : []), [entries]);

  return (
    <div>
      <button
        type="button"
        onClick={() => wikiActions.toggleDirectory(expandKey)}
        className="flex items-center gap-1 px-3 py-1.5 text-sm w-full text-left hover:bg-accent font-medium"
      >
        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <LibraryIcon size={14} className="text-primary" />
        <span className="truncate">{wiki.name}</span>
      </button>
      {isOpen &&
        tree.map((node) => (
          <WikiTreeNode
            key={node.path}
            node={node}
            wikiSlug={wiki.slug}
            depth={1}
          />
        ))}
    </div>
  );
}
