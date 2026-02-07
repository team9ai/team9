import { useCallback, useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowLeft,
  FileText,
  Pencil,
  Eye,
  Save,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/services/api";
import type { FileKeeperTokenResponse } from "@/services/api/applications";

interface MarkdownViewerProps {
  file: {
    name: string;
    path: string;
  };
  tokenData: FileKeeperTokenResponse;
  workspaceName: string;
  onClose: () => void;
}

export function MarkdownViewer({
  file,
  tokenData,
  workspaceName,
  onClose,
}: MarkdownViewerProps) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [editedContent, setEditedContent] = useState("");
  const [isDirty, setIsDirty] = useState(false);

  const relativePath = file.path.startsWith("/")
    ? file.path.slice(1)
    : file.path;

  const {
    data: content,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["workspace-file-content", workspaceName, file.path],
    queryFn: async () => {
      const blob = await api.applications.downloadWorkspaceFile(
        tokenData,
        workspaceName,
        relativePath,
      );
      return blob.text();
    },
  });

  useEffect(() => {
    if (content !== undefined) {
      setEditedContent(content);
      setIsDirty(false);
    }
  }, [content]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const blob = new Blob([editedContent], { type: "text/markdown" });
      const uploadFile = new File([blob], file.name);
      await api.applications.uploadWorkspaceFile(
        tokenData,
        workspaceName,
        relativePath,
        uploadFile,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["workspace-file-content", workspaceName, file.path],
      });
      setIsDirty(false);
    },
  });

  const handleClose = useCallback(() => {
    if (isDirty) {
      if (!window.confirm("You have unsaved changes. Discard them?")) return;
    }
    onClose();
  }, [isDirty, onClose]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 h-12 border-b border-border shrink-0">
        <Button variant="ghost" size="icon" onClick={handleClose}>
          <ArrowLeft size={18} />
        </Button>
        <FileText size={18} className="text-primary" />
        <span className="font-medium text-sm truncate">{file.name}</span>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setMode(mode === "preview" ? "edit" : "preview")}
        >
          {mode === "preview" ? (
            <Pencil size={16} className="mr-1" />
          ) : (
            <Eye size={16} className="mr-1" />
          )}
          {mode === "preview" ? "Edit" : "Preview"}
        </Button>
        {isDirty && (
          <Button
            size="sm"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <Loader2 className="animate-spin mr-1" size={16} />
            ) : (
              <Save size={16} className="mr-1" />
            )}
            Save
          </Button>
        )}
      </div>

      {/* Content */}
      {isLoading && (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {error && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <AlertCircle className="w-10 h-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Failed to load file content
          </p>
        </div>
      )}

      {!isLoading && !error && mode === "preview" && (
        <ScrollArea className="flex-1 min-h-0">
          <div className="prose prose-sm dark:prose-invert max-w-none p-6">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {editedContent}
            </ReactMarkdown>
          </div>
        </ScrollArea>
      )}

      {!isLoading && !error && mode === "edit" && (
        <textarea
          value={editedContent}
          onChange={(e) => {
            setEditedContent(e.target.value);
            setIsDirty(true);
          }}
          className="flex-1 w-full p-6 font-mono text-sm bg-background text-foreground resize-none outline-none"
          spellCheck={false}
        />
      )}
    </div>
  );
}
