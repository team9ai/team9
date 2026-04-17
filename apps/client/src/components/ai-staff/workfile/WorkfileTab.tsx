import { useMemo, useState } from "react";
import { ArrowLeft, FileText } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileManager } from "@cubone/react-file-manager";
import "@cubone/react-file-manager/dist/style.css";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import styles from "@/components/layout/contents/WorkspaceFileBrowser.module.scss";
import { MOCK_WORKFILES, type WorkfileEntry } from "./mock-files";

interface CuboneFile {
  name: string;
  isDirectory: boolean;
  path: string;
  updatedAt?: string;
  size?: number;
}

function toCuboneFile(entry: WorkfileEntry): CuboneFile {
  return {
    name: entry.name,
    isDirectory: entry.isDirectory,
    path: entry.path,
    updatedAt: entry.updatedAt,
    size: entry.size,
  };
}

export function WorkfileTab() {
  const [openFile, setOpenFile] = useState<WorkfileEntry | null>(null);

  const files = useMemo(() => MOCK_WORKFILES.map(toCuboneFile), []);
  const entriesByPath = useMemo(() => {
    const map = new Map<string, WorkfileEntry>();
    for (const e of MOCK_WORKFILES) map.set(e.path, e);
    return map;
  }, []);

  const handleFileOpen = (file: CuboneFile) => {
    if (file.isDirectory) return;
    const entry = entriesByPath.get(file.path);
    if (entry?.markdown) {
      setOpenFile(entry);
    }
  };

  if (openFile) {
    return (
      <div className="flex h-[560px] flex-col overflow-hidden rounded-md border border-border bg-background">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setOpenFile(null)}
          >
            <ArrowLeft size={15} />
          </Button>
          <FileText size={14} className="text-primary" />
          <span className="truncate text-sm font-medium">{openFile.name}</span>
          <span className="ml-auto shrink-0 text-[10px] font-mono text-muted-foreground">
            {openFile.path}
          </span>
        </div>
        <ScrollArea className="flex-1 min-h-0">
          <div className="prose prose-sm dark:prose-invert max-w-none p-5">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {openFile.markdown ?? ""}
            </ReactMarkdown>
          </div>
        </ScrollArea>
        <div className="border-t border-border bg-muted/30 px-3 py-1.5 text-[10px] text-muted-foreground">
          Demo preview — read-only. The agent owns and auto-rewrites files in
          this folder.
        </div>
      </div>
    );
  }

  return (
    <div className="h-[560px] overflow-hidden rounded-md border border-border bg-background">
      <FileManager
        files={files}
        layout="list"
        height="100%"
        className={styles.hideNavPane}
        defaultNavExpanded={false}
        onFileOpen={handleFileOpen}
        permissions={{
          upload: false,
          download: false,
          delete: false,
          create: false,
          rename: false,
          move: false,
          copy: false,
        }}
      />
    </div>
  );
}
