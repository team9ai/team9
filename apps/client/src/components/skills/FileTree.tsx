import { useMemo, useState } from "react";
import {
  FileText,
  Folder,
  FolderOpen,
  ChevronRight,
  Plus,
  Upload,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { SkillFile } from "@/types/skill";

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
}

function buildTree(files: SkillFile[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const file of files) {
    const parts = file.path.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isLast = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join("/");

      let existing = current.find((n) => n.name === name);
      if (!existing) {
        existing = { name, path, isDir: !isLast, children: [] };
        current.push(existing);
      }
      current = existing.children;
    }
  }

  // Sort: folders first, then alphabetical
  function sortNodes(nodes: TreeNode[]) {
    nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((n) => sortNodes(n.children));
  }
  sortNodes(root);

  return root;
}

interface FileTreeProps {
  files: SkillFile[];
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  onNewFile?: () => void;
  onUploadFiles?: (files: { path: string; content: string }[]) => void;
  onDeleteFile?: (path: string) => void;
  readOnly?: boolean;
}

export function FileTree({
  files,
  selectedPath,
  onSelectFile,
  onNewFile,
  onUploadFiles,
  onDeleteFile,
  readOnly,
}: FileTreeProps) {
  const { t } = useTranslation("skills");
  const tree = useMemo(() => buildTree(files), [files]);

  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0 || !onUploadFiles) return;

    const promises = Array.from(fileList).map(
      (file) =>
        new Promise<{ path: string; content: string }>((resolve) => {
          const reader = new FileReader();
          reader.onload = () =>
            resolve({ path: file.name, content: reader.result as string });
          reader.readAsText(file);
        }),
    );

    Promise.all(promises).then((results) => {
      onUploadFiles(results);
    });

    // Reset input so the same file can be re-uploaded
    e.target.value = "";
  }

  return (
    <div className="flex flex-col h-full">
      {!readOnly && (onNewFile || onUploadFiles) && (
        <div className="p-2 border-b border-border space-y-0.5">
          {onNewFile && (
            <button
              type="button"
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full px-2 py-1 rounded hover:bg-accent"
              onClick={onNewFile}
            >
              <Plus size={14} />
              <span>{t("detail.newFile")}</span>
            </button>
          )}
          {onUploadFiles && (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full px-2 py-1 rounded hover:bg-accent cursor-pointer">
              <Upload size={14} />
              <span>{t("detail.uploadFile")}</span>
              <input
                type="file"
                multiple
                className="hidden"
                onChange={handleUpload}
              />
            </label>
          )}
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-1">
        {tree.map((node) => (
          <TreeNodeItem
            key={node.path}
            node={node}
            depth={0}
            selectedPath={selectedPath}
            onSelectFile={onSelectFile}
            onDeleteFile={!readOnly ? onDeleteFile : undefined}
          />
        ))}
      </div>
    </div>
  );
}

function TreeNodeItem({
  node,
  depth,
  selectedPath,
  onSelectFile,
  onDeleteFile,
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  onDeleteFile?: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const isSelected = selectedPath === node.path;

  if (node.isDir) {
    return (
      <div>
        <button
          type="button"
          className={cn(
            "flex items-center gap-1.5 w-full px-2 py-1 text-sm rounded hover:bg-accent transition-colors",
          )}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronRight
            size={14}
            className={cn(
              "transition-transform shrink-0",
              expanded && "rotate-90",
            )}
          />
          {expanded ? (
            <FolderOpen size={14} className="text-muted-foreground shrink-0" />
          ) : (
            <Folder size={14} className="text-muted-foreground shrink-0" />
          )}
          <span className="truncate">{node.name}</span>
        </button>
        {expanded &&
          node.children.map((child) => (
            <TreeNodeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelectFile={onSelectFile}
              onDeleteFile={onDeleteFile}
            />
          ))}
      </div>
    );
  }

  return (
    <div className="group relative">
      <button
        type="button"
        className={cn(
          "flex items-center gap-1.5 w-full px-2 py-1 text-sm rounded transition-colors",
          isSelected
            ? "bg-accent text-accent-foreground"
            : "hover:bg-accent/50",
        )}
        style={{ paddingLeft: `${depth * 12 + 22}px` }}
        onClick={() => onSelectFile(node.path)}
      >
        <FileText size={14} className="text-muted-foreground shrink-0" />
        <span className="truncate">{node.name}</span>
      </button>
      {onDeleteFile && (
        <button
          type="button"
          className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all"
          onClick={(e) => {
            e.stopPropagation();
            onDeleteFile(node.path);
          }}
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  );
}
