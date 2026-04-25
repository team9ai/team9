import type { TreeEntryDto } from "@/types/wiki";

/**
 * Public shape of a wiki tree node as rendered by the sub-sidebar. `children`
 * is always an array (empty for files). `path` is the full path from the wiki
 * root — for directories this is the concatenation of every ancestor segment,
 * for files it matches the folder9 entry's `path` verbatim.
 */
export interface WikiTreeNodeData {
  name: string;
  path: string;
  type: "file" | "dir";
  children: WikiTreeNodeData[];
}

/**
 * Internal structure used while building the tree. We keep children in a Map
 * keyed by segment name so we can look up / upsert dir nodes in O(1) without
 * stashing mutable map data on the public `WikiTreeNodeData` shape. The final
 * pass converts this into the public `children: WikiTreeNodeData[]` form,
 * sorted dirs-first then alphabetically.
 */
interface InnerNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children: Map<string, InnerNode>;
}

/**
 * Returns true if any segment of the path starts with a dot. Filters out
 * folder9 control directories (`.team9/*`) and any hidden-style entries at
 * any depth (e.g. `foo/.cache/bar.md`). This is stricter than a naive
 * `startsWith(".") || includes("/.")` check, which would miss arbitrarily
 * nested hidden segments.
 */
function isDotPath(path: string): boolean {
  return path.split("/").some((segment) => segment.startsWith("."));
}

/**
 * Convert folder9's flat file list into a nested tree.
 *
 * folder9 (with `recursive=true`) returns files only — directory nodes don't
 * appear explicitly, so we derive them by walking each file's path segments.
 * Any non-file entry that sneaks through (defensive: folder9 shouldn't emit
 * them in recursive mode, but the DTO allows them) is skipped so the rendered
 * tree always mirrors the user-visible files.
 *
 * Dot-prefixed paths (at any depth) are filtered so control directories stay
 * hidden from the sidebar UI.
 */
export function buildTree(entries: TreeEntryDto[]): WikiTreeNodeData[] {
  const root = new Map<string, InnerNode>();

  for (const entry of entries) {
    if (entry.type !== "file") continue;
    // Defensive: folder9 should never emit empty / trailing-slash / doubled-
    // slash paths, but an empty path would split to `[""]` and trip the
    // file-at-root case with an empty name, while a trailing slash would
    // create a phantom empty-named file under a real dir. Skip them rather
    // than produce a corrupt tree.
    if (!entry.path || entry.path.endsWith("/")) continue;
    if (entry.path.split("/").some((s) => s === "")) continue;
    if (isDotPath(entry.path)) continue;

    const parts = entry.path.split("/");
    let cursor = root;
    let accumulated = "";

    // Walk every path segment except the last one, creating dir nodes as we go.
    for (let i = 0; i < parts.length - 1; i++) {
      const segment = parts[i];
      accumulated = accumulated ? `${accumulated}/${segment}` : segment;

      let dir = cursor.get(segment);
      if (!dir) {
        dir = {
          name: segment,
          path: accumulated,
          type: "dir",
          children: new Map(),
        };
        cursor.set(segment, dir);
      }
      cursor = dir.children;
    }

    // Last segment is the file itself. If an entry with the same full path
    // appears twice we just overwrite — folder9 should never emit duplicates,
    // but overwriting beats producing a corrupt tree if it did.
    const fileName = parts[parts.length - 1];
    cursor.set(fileName, {
      name: fileName,
      path: entry.path,
      type: "file",
      children: new Map(),
    });
  }

  return freeze(root);
}

/**
 * Convert the mutable Map-based tree into the public array-based shape,
 * sorting at every level: directories first, then files, alphabetically
 * within each group (case-insensitive via `localeCompare`).
 */
function freeze(map: Map<string, InnerNode>): WikiTreeNodeData[] {
  const result: WikiTreeNodeData[] = [];
  for (const node of map.values()) {
    result.push({
      name: node.name,
      path: node.path,
      type: node.type,
      children: freeze(node.children),
    });
  }
  return result.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
