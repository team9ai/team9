import { useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Save, Loader2, AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useDocument,
  useDocumentVersions,
  useDocumentVersion,
  useUpdateDocument,
} from "@/hooks/useDocuments";
import { DocumentEditor } from "@/components/documents/DocumentEditor";
import { SuggestionsList } from "@/components/documents/SuggestionsList";
import { SuggestionDiffModal } from "@/components/documents/SuggestionDiffModal";
import { formatMessageTime } from "@/lib/date-utils";
import type { AgentTaskDetail } from "@/types/task";
import type { SuggestionResponse } from "@/types/document";

interface TaskDocumentTabProps {
  task: AgentTaskDetail;
}

const DRAFT_KEY = (id: string) => `doc-draft-${id}`;

export function TaskDocumentTab({ task }: TaskDocumentTabProps) {
  const { t } = useTranslation("tasks");
  const documentId = task.documentId;

  // ── Data fetching ───────────────────────────────────────
  const { data: doc, isLoading: docLoading } = useDocument(
    documentId ?? undefined,
  );
  const { data: versions } = useDocumentVersions(documentId ?? undefined);
  const currentVersionIndex = doc?.currentVersion?.versionIndex;

  // ── Local state ─────────────────────────────────────────
  const [selectedVersion, setSelectedVersion] = useState<number | "current">(
    "current",
  );
  const [draftContent, setDraftContent] = useState<string | null>(null);
  const [showSummaryInput, setShowSummaryInput] = useState(false);
  const [summary, setSummary] = useState("");
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const [pendingVersionSwitch, setPendingVersionSwitch] = useState<
    number | "current" | null
  >(null);
  const [activeSuggestion, setActiveSuggestion] =
    useState<SuggestionResponse | null>(null);

  // ── Fetch historical version content ────────────────────
  const viewingHistorical = selectedVersion !== "current";
  const historicalVersionIndex = viewingHistorical
    ? (selectedVersion as number)
    : undefined;
  const { data: historicalVersion } = useDocumentVersion(
    documentId ?? undefined,
    historicalVersionIndex,
  );

  // ── Derived state ───────────────────────────────────────
  const savedContent = doc?.currentVersion?.content ?? "";
  const isEditing = selectedVersion === "current";
  const hasDraft = draftContent !== null && draftContent !== savedContent;

  // ── Load draft from localStorage on mount ───────────────
  useEffect(() => {
    if (!documentId) return;
    const stored = localStorage.getItem(DRAFT_KEY(documentId));
    if (stored !== null && stored !== savedContent) {
      setDraftContent(stored);
    }
  }, [documentId, savedContent]);

  // ── Save draft to localStorage on change ────────────────
  const handleEditorChange = useCallback(
    (markdown: string) => {
      if (!documentId) return;
      setDraftContent(markdown);
      localStorage.setItem(DRAFT_KEY(documentId), markdown);
    },
    [documentId],
  );

  // ── Save mutation ───────────────────────────────────────
  const updateDoc = useUpdateDocument(documentId ?? "");

  const handleSave = async () => {
    if (!documentId || !draftContent) return;
    await updateDoc.mutateAsync({
      content: draftContent,
      summary: summary || undefined,
    });
    localStorage.removeItem(DRAFT_KEY(documentId));
    setDraftContent(null);
    setShowSummaryInput(false);
    setSummary("");
  };

  // ── Version switching ───────────────────────────────────
  const handleVersionChange = (value: string) => {
    const target = value === "current" ? "current" : parseInt(value, 10);
    if (hasDraft) {
      setPendingVersionSwitch(target);
      setShowDiscardDialog(true);
    } else {
      setSelectedVersion(target);
    }
  };

  const confirmDiscard = () => {
    if (documentId) localStorage.removeItem(DRAFT_KEY(documentId));
    setDraftContent(null);
    if (pendingVersionSwitch !== null) {
      setSelectedVersion(pendingVersionSwitch);
      setPendingVersionSwitch(null);
    }
    setShowDiscardDialog(false);
  };

  // ── Determine content to display ────────────────────────
  const displayContent = viewingHistorical
    ? (historicalVersion?.content ?? "")
    : (draftContent ?? savedContent);

  // ── Loading state ───────────────────────────────────────
  if (docLoading) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 flex-1" />
          <Skeleton className="h-8 w-16" />
        </div>
        <Skeleton className="h-[120px] w-full" />
      </div>
    );
  }

  // ── No document yet ─────────────────────────────────────
  // Note: In practice, tasks always have a documentId (created by backend).
  // This fallback is a safety net for edge cases.
  if (!documentId) {
    return (
      <div className="space-y-3">
        <DocumentEditor
          placeholder={t("detail.document.createPlaceholder")}
          onChange={handleEditorChange}
        />
      </div>
    );
  }

  // ── Sorted versions for dropdown ────────────────────────
  const sortedVersions = [...(versions ?? [])].sort(
    (a, b) => b.versionIndex - a.versionIndex,
  );

  return (
    <div className="flex flex-col gap-3">
      {/* Top bar: version selector + save */}
      <div className="flex items-center gap-2">
        <Select
          value={
            selectedVersion === "current" ? "current" : String(selectedVersion)
          }
          onValueChange={handleVersionChange}
        >
          <SelectTrigger className="h-8 text-xs flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {currentVersionIndex != null && (
              <SelectItem value="current">
                {t("detail.document.currentLabel", {
                  version: currentVersionIndex + 1,
                })}
              </SelectItem>
            )}
            {sortedVersions.map((v) =>
              v.versionIndex === currentVersionIndex ? null : (
                <SelectItem key={v.id} value={String(v.versionIndex)}>
                  {t("detail.document.versionLabel", {
                    version: v.versionIndex + 1,
                    time: formatMessageTime(new Date(v.createdAt)),
                  })}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>

        {isEditing && (
          <>
            {showSummaryInput && (
              <Input
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder={t("detail.document.saveSummaryPlaceholder")}
                className="h-8 text-xs flex-1"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSave();
                  if (e.key === "Escape") setShowSummaryInput(false);
                }}
              />
            )}
            <Button
              size="sm"
              className="h-8 shrink-0"
              disabled={!hasDraft || updateDoc.isPending}
              onClick={() => {
                if (!showSummaryInput && hasDraft) {
                  setShowSummaryInput(true);
                } else {
                  handleSave();
                }
              }}
            >
              {updateDoc.isPending ? (
                <Loader2 className="w-3 h-3 animate-spin mr-1" />
              ) : (
                <Save className="w-3 h-3 mr-1" />
              )}
              {t("detail.document.save")}
            </Button>
          </>
        )}
      </div>

      {/* Unsaved changes indicator */}
      {hasDraft && isEditing && (
        <div className="flex items-center gap-1 text-xs text-amber-600">
          <AlertTriangle size={12} />
          {t("detail.document.unsavedChanges")}
        </div>
      )}

      {/* Historical version banner */}
      {viewingHistorical && (
        <div className="flex items-center justify-between bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-1.5 text-xs">
          <span>
            {t("detail.document.viewingVersion", {
              version: (selectedVersion as number) + 1,
            })}
          </span>
          <button
            type="button"
            className="text-primary hover:underline font-medium"
            onClick={() => setSelectedVersion("current")}
          >
            {t("detail.document.backToCurrent")}
          </button>
        </div>
      )}

      {/* Editor */}
      <DocumentEditor
        key={`${documentId}-${selectedVersion}`}
        initialContent={displayContent}
        onChange={isEditing ? handleEditorChange : undefined}
        readOnly={viewingHistorical}
        placeholder={t("detail.document.placeholder")}
      />

      {/* AI Suggestions */}
      {isEditing && documentId && (
        <SuggestionsList
          documentId={documentId}
          onViewSuggestion={setActiveSuggestion}
        />
      )}

      {/* Suggestion diff modal */}
      {documentId && (
        <SuggestionDiffModal
          documentId={documentId}
          suggestion={activeSuggestion}
          onClose={() => setActiveSuggestion(null)}
        />
      )}

      {/* Discard confirmation dialog */}
      <AlertDialog open={showDiscardDialog} onOpenChange={setShowDiscardDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("detail.document.discardTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("detail.document.discardMessage")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setPendingVersionSwitch(null);
                setShowDiscardDialog(false);
              }}
            >
              {t("detail.document.discardCancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmDiscard}>
              {t("detail.document.discardConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
