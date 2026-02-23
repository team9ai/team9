import { useState } from "react";
import {
  Library,
  Loader2,
  AlertCircle,
  Plus,
  FileText,
  Bot,
  User,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useTranslation } from "react-i18next";
import { useDocuments, useCreateDocument } from "@/hooks/useDocuments";
import { DocumentViewer } from "@/components/document/DocumentViewer";
import type { DocumentIdentity, DocumentListItem } from "@/types/document";

function formatIdentity(identity: DocumentIdentity): string {
  if (identity.type === "bot") return "Bot";
  if (identity.type === "workspace") return "Workspace";
  return "User";
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleString();
}

// ── Document Card ───────────────────────────────────────────────────

function DocumentCard({
  doc,
  onClick,
}: {
  doc: DocumentListItem;
  onClick: () => void;
}) {
  return (
    <Card
      onClick={onClick}
      className="p-4 cursor-pointer hover:shadow-md transition-all"
    >
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <FileText size={18} className="text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">
            {doc.title || "Untitled"}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="outline" className="text-[10px]">
              {doc.documentType}
            </Badge>
            <div className="flex items-center gap-1">
              {doc.createdBy.type === "bot" ? (
                <Bot size={10} className="text-primary" />
              ) : (
                <User size={10} className="text-muted-foreground" />
              )}
              <span className="text-[10px] text-muted-foreground">
                {formatIdentity(doc.createdBy)}
              </span>
            </div>
          </div>
          <span className="text-[10px] text-muted-foreground/60 mt-1 block">
            Updated {formatDate(doc.updatedAt)}
          </span>
        </div>
      </div>
    </Card>
  );
}

// ── Create Document Dialog ──────────────────────────────────────────

interface CreateDocumentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}

function CreateDocumentDialog({
  open,
  onOpenChange,
  onCreated,
}: CreateDocumentDialogProps) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const createMutation = useCreateDocument();

  const canSubmit = !!title.trim() && !createMutation.isPending;

  const handleCreate = () => {
    createMutation.mutate(
      {
        documentType: "general",
        content: content,
        title: title.trim(),
      },
      {
        onSuccess: (doc) => {
          setTitle("");
          setContent("");
          onOpenChange(false);
          onCreated(doc.id);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Document</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">Title</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Document title..."
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Content{" "}
              <span className="text-muted-foreground font-normal">
                (Markdown)
              </span>
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Write document content here..."
              className="w-full min-h-[160px] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
              spellCheck={false}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleCreate} disabled={!canSubmit}>
            {createMutation.isPending ? (
              <Loader2 size={14} className="mr-1 animate-spin" />
            ) : (
              <Plus size={14} className="mr-1" />
            )}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Component ──────────────────────────────────────────────────

export function LibraryMainContent() {
  const { t } = useTranslation("navigation");
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const { data: documents, isLoading, error } = useDocuments();

  // If a document is selected, show the DocumentViewer full-screen
  if (selectedDocId) {
    return (
      <main className="h-full flex flex-col bg-background overflow-hidden">
        <DocumentViewer
          documentId={selectedDocId}
          onClose={() => setSelectedDocId(null)}
        />
      </main>
    );
  }

  return (
    <main className="h-full flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <header className="h-14 bg-background flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <Library size={18} className="text-primary" />
          <h2 className="font-semibold text-lg text-foreground">
            {t("library")}
          </h2>
        </div>
        <Button size="sm" onClick={() => setShowCreateDialog(true)}>
          <Plus size={14} className="mr-1" />
          New Document
        </Button>
      </header>

      <Separator />

      {/* Content */}
      <ScrollArea className="flex-1 min-h-0 bg-secondary/50">
        <div className="p-4">
          {/* Loading */}
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Error */}
          {error && (
            <Card className="p-6 text-center">
              <AlertCircle className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Failed to load documents
              </p>
            </Card>
          )}

          {/* Empty state */}
          {!isLoading && !error && documents && documents.length === 0 && (
            <Card className="p-6 text-center">
              <div className="w-16 h-16 mx-auto mb-4 bg-primary/10 rounded-full flex items-center justify-center">
                <Library size={32} className="text-primary" />
              </div>
              <h3 className="font-medium text-foreground mb-1">
                No documents yet
              </h3>
              <p className="text-sm text-muted-foreground">
                Create versioned documents for task instructions, AI memory, and
                more.
              </p>
            </Card>
          )}

          {/* Document list */}
          {!isLoading && !error && documents && documents.length > 0 && (
            <div className="max-w-md space-y-2">
              {documents.map((doc) => (
                <DocumentCard
                  key={doc.id}
                  doc={doc}
                  onClick={() => setSelectedDocId(doc.id)}
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      <CreateDocumentDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onCreated={(id) => setSelectedDocId(id)}
      />
    </main>
  );
}
