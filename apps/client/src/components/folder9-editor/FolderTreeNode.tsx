import {
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FileText,
  Folder,
  FolderPlus,
  Trash2,
  Upload,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
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
  readOnly?: boolean;
  onCreateFileInDirectory?: (dirPath: string) => void;
  onCreateFolderInDirectory?: (dirPath: string) => void;
  onUploadInDirectory?: (dirPath: string) => void;
  onDeleteEntry?: (path: string, type: "file" | "dir") => void;
  onDropFilesInDirectory?: (dirPath: string, files: File[]) => void;
  onMoveFileToDirectory?: (sourcePath: string, dirPath: string) => void;
  onMoveEntryToDirectory?: (
    sourcePath: string,
    sourceType: "file" | "dir",
    dirPath: string,
  ) => void;
  dropTargetKey?: string | null;
  onDropTargetChange?: (key: string | null) => void;
}

const INTERNAL_FILE_DRAG_TYPE = "application/x-team9-folder-file";
const INTERNAL_ENTRY_DRAG_TYPE = "application/x-team9-folder-entry";

function parentDirectory(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join("/");
}

function readInternalDrag(
  dataTransfer: DataTransfer,
): { path: string; type: "file" | "dir" } | null {
  const raw = dataTransfer.getData(INTERNAL_ENTRY_DRAG_TYPE);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { path?: unknown; type?: unknown };
      if (
        typeof parsed.path === "string" &&
        (parsed.type === "file" || parsed.type === "dir")
      ) {
        return { path: parsed.path, type: parsed.type };
      }
    } catch {
      return null;
    }
  }

  const legacyFilePath = dataTransfer.getData(INTERNAL_FILE_DRAG_TYPE);
  if (legacyFilePath) return { path: legacyFilePath, type: "file" };
  return null;
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
  readOnly,
  onCreateFileInDirectory,
  onCreateFolderInDirectory,
  onUploadInDirectory,
  onDeleteEntry,
  onDropFilesInDirectory,
  onMoveFileToDirectory,
  onMoveEntryToDirectory,
  dropTargetKey,
  onDropTargetChange,
}: FolderTreeNodeProps) {
  const { t } = useTranslation("wiki");
  const isExpanded = expandedDirs.has(node.path);
  const isActive = node.type === "file" && selectedPath === node.path;
  const targetDirectory =
    node.type === "dir" ? node.path : parentDirectory(node.path);
  const rowDropKey = `row:${node.path}`;
  const groupDropKey = `group:${node.path}`;
  const isRowDropTarget = dropTargetKey === rowDropKey;
  const isGroupDropTarget = dropTargetKey === groupDropKey;
  const hasActions =
    !readOnly &&
    (onCreateFileInDirectory ||
      onCreateFolderInDirectory ||
      onUploadInDirectory ||
      onDeleteEntry);

  const handleClick = () => {
    if (node.type === "dir") {
      const hasIndex = node.children.some((c) => c.name === "index.md");
      onToggleExpand(node.path, hasIndex);
      return;
    }
    onSelect(node.path);
  };

  function acceptsDrop(e: React.DragEvent<HTMLElement>): boolean {
    if (readOnly) return false;
    const types = Array.from(e.dataTransfer.types);
    const hasExternalFiles = types.includes("Files");
    const hasInternalEntry =
      types.includes(INTERNAL_ENTRY_DRAG_TYPE) ||
      types.includes(INTERNAL_FILE_DRAG_TYPE);
    return (
      (hasExternalFiles && !!onDropFilesInDirectory) ||
      (hasInternalEntry &&
        (!!onMoveEntryToDirectory || !!onMoveFileToDirectory))
    );
  }

  function markDropTarget(
    e: React.DragEvent<HTMLElement>,
    key: string,
    dropEffect: "copy" | "move",
  ) {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = dropEffect;
    onDropTargetChange?.(key);
  }

  function handleDragOver(e: React.DragEvent<HTMLButtonElement>) {
    if (!acceptsDrop(e)) return;
    const types = Array.from(e.dataTransfer.types);
    const hasInternalEntry =
      types.includes(INTERNAL_ENTRY_DRAG_TYPE) ||
      types.includes(INTERNAL_FILE_DRAG_TYPE);
    markDropTarget(e, rowDropKey, hasInternalEntry ? "move" : "copy");
  }

  function handleDragLeave(e: React.DragEvent<HTMLElement>) {
    const related = e.relatedTarget;
    if (related instanceof Node && e.currentTarget.contains(related)) return;
    onDropTargetChange?.(null);
  }

  function moveInternalEntry(
    source: { path: string; type: "file" | "dir" },
    dirPath: string,
  ) {
    if (onMoveEntryToDirectory) {
      onMoveEntryToDirectory(source.path, source.type, dirPath);
      return;
    }
    if (source.type === "file" && onMoveFileToDirectory) {
      onMoveFileToDirectory(source.path, dirPath);
    }
  }

  function dropIntoDirectory(e: React.DragEvent<HTMLElement>, dirPath: string) {
    if (readOnly) return;

    const internal = readInternalDrag(e.dataTransfer);
    if (internal && (onMoveEntryToDirectory || onMoveFileToDirectory)) {
      e.preventDefault();
      e.stopPropagation();
      onDropTargetChange?.(null);
      moveInternalEntry(internal, dirPath);
      return;
    }

    if (!onDropFilesInDirectory) return;
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    onDropTargetChange?.(null);
    onDropFilesInDirectory(dirPath, files);
  }

  function handleDragStart(e: React.DragEvent<HTMLButtonElement>) {
    if (readOnly) return;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(
      INTERNAL_ENTRY_DRAG_TYPE,
      JSON.stringify({ path: node.path, type: node.type }),
    );
    if (node.type === "file") {
      e.dataTransfer.setData(INTERNAL_FILE_DRAG_TYPE, node.path);
    }
    e.dataTransfer.setData("text/plain", node.path);
  }

  function handleDrop(e: React.DragEvent<HTMLButtonElement>) {
    dropIntoDirectory(e, targetDirectory);
  }

  function handleGroupDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (!acceptsDrop(e)) return;
    const types = Array.from(e.dataTransfer.types);
    const hasInternalEntry =
      types.includes(INTERNAL_ENTRY_DRAG_TYPE) ||
      types.includes(INTERNAL_FILE_DRAG_TYPE);
    markDropTarget(e, groupDropKey, hasInternalEntry ? "move" : "copy");
  }

  function handleGroupDrop(e: React.DragEvent<HTMLDivElement>) {
    dropIntoDirectory(e, node.path);
  }

  const ariaLevel = depth + 1;
  const row = (
    <button
      role="treeitem"
      aria-level={ariaLevel}
      aria-expanded={node.type === "dir" ? isExpanded : undefined}
      aria-selected={isActive || undefined}
      type="button"
      draggable={!readOnly}
      onClick={handleClick}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{ paddingLeft: `${8 + depth * 14}px` }}
      className={cn(
        "flex items-center gap-1 px-2 py-1 text-xs w-full text-left border-l-2 border-transparent hover:bg-muted/50",
        isActive && "bg-muted/60 text-foreground font-medium border-l-primary",
        isRowDropTarget &&
          "bg-primary/10 border-l-primary text-foreground ring-1 ring-inset ring-primary/25",
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
  );

  return (
    <div>
      {hasActions ? (
        <ContextMenu>
          <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
          <ContextMenuContent className="w-44">
            {onCreateFileInDirectory && (
              <ContextMenuItem
                onSelect={() => onCreateFileInDirectory(targetDirectory)}
                className="gap-2"
              >
                <FilePlus2 className="size-4 text-muted-foreground" />
                {t("tree.newFile", { defaultValue: "New file" })}
              </ContextMenuItem>
            )}
            {onCreateFolderInDirectory && (
              <ContextMenuItem
                onSelect={() => onCreateFolderInDirectory(targetDirectory)}
                className="gap-2"
              >
                <FolderPlus className="size-4 text-muted-foreground" />
                {t("tree.newFolder", { defaultValue: "New folder" })}
              </ContextMenuItem>
            )}
            {onUploadInDirectory && (
              <ContextMenuItem
                onSelect={() => onUploadInDirectory(targetDirectory)}
                className="gap-2"
              >
                <Upload className="size-4 text-muted-foreground" />
                {t("tree.uploadFile", { defaultValue: "Upload file" })}
              </ContextMenuItem>
            )}
            {onDeleteEntry &&
              (onCreateFileInDirectory ||
                onCreateFolderInDirectory ||
                onUploadInDirectory) && <ContextMenuSeparator />}
            {onDeleteEntry && (
              <ContextMenuItem
                onSelect={() => onDeleteEntry(node.path, node.type)}
                className="gap-2 text-destructive focus:text-destructive"
              >
                <Trash2 className="size-4" />
                {t("tree.delete", { defaultValue: "Delete" })}
              </ContextMenuItem>
            )}
          </ContextMenuContent>
        </ContextMenu>
      ) : (
        row
      )}
      {node.type === "dir" && isExpanded && (
        <div
          role="group"
          onDragOver={handleGroupDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleGroupDrop}
          className={cn(
            "min-h-2",
            isGroupDropTarget &&
              "bg-primary/5 ring-1 ring-inset ring-primary/20",
          )}
        >
          {node.children.map((child) => (
            <FolderTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              expandedDirs={expandedDirs}
              onSelect={onSelect}
              onToggleExpand={onToggleExpand}
              readOnly={readOnly}
              onCreateFileInDirectory={onCreateFileInDirectory}
              onCreateFolderInDirectory={onCreateFolderInDirectory}
              onUploadInDirectory={onUploadInDirectory}
              onDeleteEntry={onDeleteEntry}
              onDropFilesInDirectory={onDropFilesInDirectory}
              onMoveFileToDirectory={onMoveFileToDirectory}
              onMoveEntryToDirectory={onMoveEntryToDirectory}
              dropTargetKey={dropTargetKey}
              onDropTargetChange={onDropTargetChange}
            />
          ))}
        </div>
      )}
    </div>
  );
}
