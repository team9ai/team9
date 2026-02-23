import { useCallback, useEffect, useState } from "react";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  useDocument,
  useDocumentVersion,
  useUpdateDocument,
} from "@/hooks/useDocuments";
import { VersionHistory } from "./VersionHistory";
import { SuggestionList } from "./SuggestionList";
import { SuggestionReview } from "./SuggestionReview";

interface DocumentViewerProps {
  documentId: string;
  onClose?: () => void;
}

export function DocumentViewer({ documentId, onClose }: DocumentViewerProps) {
  const { data: doc, isLoading, error } = useDocument(documentId);
  const updateMutation = useUpdateDocument(documentId);

  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [editedContent, setEditedContent] = useState("");
  const [isDirty, setIsDirty] = useState(false);

  // For viewing a specific historical version
  const [viewingVersionIndex, setViewingVersionIndex] = useState<
    number | undefined
  >(undefined);
  const isViewingHistory = viewingVersionIndex != null;

  const { data: historyVersion } = useDocumentVersion(
    isViewingHistory ? documentId : undefined,
    viewingVersionIndex,
  );

  // For viewing a specific suggestion diff
  const [viewingSuggestionId, setViewingSuggestionId] = useState<
    string | undefined
  >(undefined);

  // Sync editor content with latest version
  useEffect(() => {
    if (doc?.currentVersion?.content != null) {
      setEditedContent(doc.currentVersion.content);
      setIsDirty(false);
    }
  }, [doc?.currentVersion?.content]);

  const handleSave = useCallback(() => {
    updateMutation.mutate(
      { content: editedContent },
      {
        onSuccess: () => {
          setIsDirty(false);
          setMode("preview");
        },
      },
    );
  }, [editedContent, updateMutation]);

  const handleClose = useCallback(() => {
    if (isDirty) {
      if (!window.confirm("You have unsaved changes. Discard them?")) return;
    }
    onClose?.();
  }, [isDirty, onClose]);

  const handleSelectVersion = useCallback(
    (versionIndex: number) => {
      // If selecting current version, go back to live view
      if (versionIndex === doc?.currentVersion?.versionIndex) {
        setViewingVersionIndex(undefined);
      } else {
        setViewingVersionIndex(versionIndex);
      }
      setMode("preview");
    },
    [doc?.currentVersion?.versionIndex],
  );

  const handleBackFromHistory = useCallback(() => {
    setViewingVersionIndex(undefined);
  }, []);

  // Content to display
  const displayContent = isViewingHistory
    ? (historyVersion?.content ?? "")
    : editedContent;

  const currentVersionIndex = doc?.currentVersion?.versionIndex;
  const displayVersionIndex = isViewingHistory
    ? viewingVersionIndex
    : currentVersionIndex;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 h-12 border-b border-border shrink-0">
        {onClose && (
          <Button variant="ghost" size="icon" onClick={handleClose}>
            <ArrowLeft size={18} />
          </Button>
        )}
        <FileText size={18} className="text-primary" />
        <span className="font-medium text-sm truncate">
          {doc?.title || "Document"}
        </span>
        {displayVersionIndex != null && (
          <span className="text-xs text-muted-foreground">
            v{displayVersionIndex}
          </span>
        )}
        {isViewingHistory && (
          <Button variant="outline" size="sm" onClick={handleBackFromHistory}>
            Back to latest
          </Button>
        )}
        <div className="flex-1" />
        {!isViewingHistory && (
          <>
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
                onClick={handleSave}
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? (
                  <Loader2 className="animate-spin mr-1" size={16} />
                ) : (
                  <Save size={16} className="mr-1" />
                )}
                Save
              </Button>
            )}
          </>
        )}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <AlertCircle className="w-10 h-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Failed to load document
          </p>
        </div>
      )}

      {/* Content + Side panels */}
      {!isLoading && !error && doc && (
        <div className="flex-1 flex min-h-0">
          {/* Main content area */}
          <div className="flex-1 min-w-0">
            {/* Suggestion review view */}
            {viewingSuggestionId ? (
              <SuggestionReview
                documentId={documentId}
                suggestionId={viewingSuggestionId}
                onBack={() => setViewingSuggestionId(undefined)}
              />
            ) : mode === "preview" || isViewingHistory ? (
              <ScrollArea className="h-full">
                <div className="prose prose-sm dark:prose-invert max-w-none p-6">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {displayContent}
                  </ReactMarkdown>
                </div>
              </ScrollArea>
            ) : (
              <textarea
                value={editedContent}
                onChange={(e) => {
                  setEditedContent(e.target.value);
                  setIsDirty(true);
                }}
                className="h-full w-full p-6 font-mono text-sm bg-background text-foreground resize-none outline-none"
                spellCheck={false}
              />
            )}
          </div>

          {/* Side panel: Versions / Suggestions */}
          {!viewingSuggestionId && (
            <div className="w-64 border-l border-border shrink-0 flex flex-col">
              <Tabs defaultValue="versions" className="flex flex-col h-full">
                <TabsList className="w-full justify-start rounded-none border-b border-border bg-transparent px-2 shrink-0">
                  <TabsTrigger value="versions" className="text-xs">
                    Versions
                  </TabsTrigger>
                  <TabsTrigger value="suggestions" className="text-xs">
                    Suggestions
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="versions" className="flex-1 min-h-0 mt-0">
                  <VersionHistory
                    documentId={documentId}
                    currentVersionIndex={displayVersionIndex}
                    onSelectVersion={handleSelectVersion}
                  />
                </TabsContent>
                <TabsContent
                  value="suggestions"
                  className="flex-1 min-h-0 mt-0"
                >
                  <SuggestionList
                    documentId={documentId}
                    onSelectSuggestion={setViewingSuggestionId}
                  />
                </TabsContent>
              </Tabs>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
