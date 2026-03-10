# Task Document Editor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the read-only Document tab in TaskDetailPanel with a WYSIWYG Lexical editor supporting editing, version switching, and AI suggestion diff review.

**Architecture:** New `DocumentEditor` component using Lexical with markdown import/export, composed into a rewritten `TaskDocumentTab`. Version switching via Radix Select dropdown, suggestions via collapsible list + diff modal. localStorage drafts for unsaved changes.

**Tech Stack:** Lexical (existing v0.39.0), @lexical/markdown, Radix UI Select/Dialog, `diff` npm package (new client dep), React Query, Zustand, i18next.

---

### Task 1: Install `diff` package in client

The `diff` package is needed for rendering suggestion diffs in the modal. Currently only installed in server/gateway.

**Files:**

- Modify: `apps/client/package.json`

**Step 1: Install the package**

Run: `cd /Users/winrey/Projects/weightwave/team9 && pnpm add diff @types/diff --filter client`

**Step 2: Verify installation**

Run: `ls apps/client/node_modules/diff/lib/index.mjs`
Expected: file exists

**Step 3: Commit**

```bash
git add apps/client/package.json pnpm-lock.yaml
git commit -m "chore: add diff package to client for suggestion diff view"
```

---

### Task 2: Add i18n keys for document editor

Add translation keys for all new UI elements in both English and Chinese locale files.

**Files:**

- Modify: `apps/client/src/i18n/locales/en/tasks.json`
- Modify: `apps/client/src/i18n/locales/zh/tasks.json`

**Step 1: Add English keys**

In `en/tasks.json`, replace the `detail.versionHistory` block and add new keys under `detail`:

```json
"document": {
  "save": "Save",
  "saving": "Saving...",
  "unsavedChanges": "Unsaved changes",
  "viewingVersion": "Viewing version {{version}}",
  "backToCurrent": "Back to current",
  "currentLabel": "Version {{version}} (current)",
  "versionLabel": "Version {{version}} — {{time}}",
  "discardTitle": "Unsaved changes",
  "discardMessage": "You have unsaved changes. Discard them?",
  "discardConfirm": "Discard",
  "discardCancel": "Keep editing",
  "saveSummaryPlaceholder": "Describe your changes (optional)...",
  "placeholder": "Start writing...",
  "createPlaceholder": "Start writing to create a document...",
  "suggestions": {
    "title": "AI Suggestions",
    "count": "AI Suggestions ({{count}})",
    "view": "View",
    "approve": "Approve",
    "reject": "Reject",
    "current": "Current",
    "suggested": "Suggested",
    "outdated": "This suggestion is based on an older version",
    "empty": "No pending suggestions"
  },
  "versionHistory": {
    "loadError": "Failed to load versions",
    "noVersions": "No versions yet"
  }
}
```

**Step 2: Add Chinese keys**

In `zh/tasks.json`, add the same structure:

```json
"document": {
  "save": "保存",
  "saving": "保存中...",
  "unsavedChanges": "有未保存的修改",
  "viewingVersion": "正在查看版本 {{version}}",
  "backToCurrent": "返回当前版本",
  "currentLabel": "版本 {{version}}（当前）",
  "versionLabel": "版本 {{version}} — {{time}}",
  "discardTitle": "未保存的修改",
  "discardMessage": "你有未保存的修改，确定放弃吗？",
  "discardConfirm": "放弃",
  "discardCancel": "继续编辑",
  "saveSummaryPlaceholder": "描述你的修改（可选）...",
  "placeholder": "开始编写...",
  "createPlaceholder": "开始编写以创建文档...",
  "suggestions": {
    "title": "AI 建议",
    "count": "AI 建议 ({{count}})",
    "view": "查看",
    "approve": "采纳",
    "reject": "拒绝",
    "current": "当前内容",
    "suggested": "建议内容",
    "outdated": "此建议基于旧版本",
    "empty": "暂无待处理建议"
  },
  "versionHistory": {
    "loadError": "加载版本失败",
    "noVersions": "暂无版本"
  }
}
```

**Step 3: Remove old keys**

Remove `detail.noDocument` and `detail.versionHistory` from both locale files (replaced by `detail.document.*`).

**Step 4: Commit**

```bash
git add apps/client/src/i18n/locales/en/tasks.json apps/client/src/i18n/locales/zh/tasks.json
git commit -m "feat(i18n): add document editor translation keys"
```

---

### Task 3: Create markdown transformers for documents

Create a document-specific markdown transformer set that includes headings (unlike the chat transformers).

**Files:**

- Create: `apps/client/src/components/documents/markdownTransformers.ts`

**Step 1: Create the transformer file**

```typescript
import {
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  INLINE_CODE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  STRIKETHROUGH,
  ORDERED_LIST,
  UNORDERED_LIST,
  CODE,
  QUOTE,
  HEADING,
} from "@lexical/markdown";
import type { Transformer } from "@lexical/markdown";

// Document-appropriate markdown transformers
// Includes HEADING (unlike chat transformers)
export const DOCUMENT_MARKDOWN_TRANSFORMERS: Transformer[] = [
  HEADING,
  CODE,
  QUOTE,
  UNORDERED_LIST,
  ORDERED_LIST,
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  STRIKETHROUGH,
  INLINE_CODE,
];
```

**Step 2: Commit**

```bash
git add apps/client/src/components/documents/markdownTransformers.ts
git commit -m "feat: add document markdown transformers with heading support"
```

---

### Task 4: Create DocumentToolbar component

A compact formatting toolbar for the document editor. Similar to `EditorToolbar` but without emoji/file/mention, and adding code/quote toggles.

**Files:**

- Create: `apps/client/src/components/documents/DocumentToolbar.tsx`

**Reference:** `apps/client/src/components/channel/editor/EditorToolbar.tsx` (lines 1-270) — reuse the same pattern for Lexical command dispatching and selection state tracking.

**Step 1: Create the toolbar**

```typescript
import { useCallback, useEffect, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
  SELECTION_CHANGE_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
} from "lexical";
import {
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND,
  $isListNode,
  ListNode,
} from "@lexical/list";
import { $getNearestNodeOfType, mergeRegister } from "@lexical/utils";
import {
  $isQuoteNode,
  $createQuoteNode,
} from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import { $createParagraphNode } from "lexical";
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Code,
  Quote,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function DocumentToolbar() {
  const [editor] = useLexicalComposerContext();
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [listType, setListType] = useState<"bullet" | "number" | null>(null);
  const [isQuote, setIsQuote] = useState(false);

  const updateToolbar = useCallback(() => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      setIsBold(selection.hasFormat("bold"));
      setIsItalic(selection.hasFormat("italic"));

      const anchorNode = selection.anchor.getNode();
      const topElement =
        anchorNode.getKey() === "root"
          ? anchorNode
          : anchorNode.getTopLevelElementOrThrow();

      // Check list
      const parentList = $getNearestNodeOfType(anchorNode, ListNode);
      if ($isListNode(parentList)) {
        setListType(parentList.getListType() === "number" ? "number" : "bullet");
      } else {
        setListType(null);
      }

      // Check quote
      setIsQuote($isQuoteNode(topElement));
    }
  }, [editor]);

  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => updateToolbar());
      }),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          updateToolbar();
          return false;
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
    );
  }, [editor, updateToolbar]);

  const formatBold = () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold");
  const formatItalic = () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic");

  const formatBulletList = () => {
    if (listType === "bullet") {
      editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
    } else {
      editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
    }
  };

  const formatNumberedList = () => {
    if (listType === "number") {
      editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
    } else {
      editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
    }
  };

  const formatCode = () => {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, "code");
  };

  const toggleQuote = () => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        if (isQuote) {
          $setBlocksType(selection, () => $createParagraphNode());
        } else {
          $setBlocksType(selection, () => $createQuoteNode());
        }
      }
    });
  };

  return (
    <div className="flex items-center gap-0.5 pb-2 border-b border-border">
      <Button type="button" variant="ghost" size="sm"
        onClick={formatBold}
        className={cn("h-7 w-7 p-0", isBold && "bg-primary/10 text-primary")}
        title="Bold (Ctrl+B)">
        <Bold size={14} />
      </Button>
      <Button type="button" variant="ghost" size="sm"
        onClick={formatItalic}
        className={cn("h-7 w-7 p-0", isItalic && "bg-primary/10 text-primary")}
        title="Italic (Ctrl+I)">
        <Italic size={14} />
      </Button>
      <div className="w-px h-4 bg-muted mx-0.5" />
      <Button type="button" variant="ghost" size="sm"
        onClick={formatBulletList}
        className={cn("h-7 w-7 p-0", listType === "bullet" && "bg-primary/10 text-primary")}
        title="Bullet List">
        <List size={14} />
      </Button>
      <Button type="button" variant="ghost" size="sm"
        onClick={formatNumberedList}
        className={cn("h-7 w-7 p-0", listType === "number" && "bg-primary/10 text-primary")}
        title="Numbered List">
        <ListOrdered size={14} />
      </Button>
      <div className="w-px h-4 bg-muted mx-0.5" />
      <Button type="button" variant="ghost" size="sm"
        onClick={formatCode}
        className="h-7 w-7 p-0"
        title="Inline Code">
        <Code size={14} />
      </Button>
      <Button type="button" variant="ghost" size="sm"
        onClick={toggleQuote}
        className={cn("h-7 w-7 p-0", isQuote && "bg-primary/10 text-primary")}
        title="Quote">
        <Quote size={14} />
      </Button>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add apps/client/src/components/documents/DocumentToolbar.tsx
git commit -m "feat: add DocumentToolbar component for document editor"
```

---

### Task 5: Create DocumentEditor component

The core Lexical editor for document editing with markdown import/export and draft support.

**Files:**

- Create: `apps/client/src/components/documents/DocumentEditor.tsx`

**Reference:**

- `apps/client/src/components/channel/editor/RichTextEditor.tsx` (lines 1-282) — reuse Lexical setup pattern
- `apps/client/src/components/channel/editor/themes/editorTheme.ts` — reuse theme
- `apps/client/src/components/documents/markdownTransformers.ts` — document transformers

**Step 1: Create the editor component**

```typescript
import { useCallback, useEffect, useRef } from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ListNode, ListItemNode } from "@lexical/list";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import {
  CodeNode,
  CodeHighlightNode,
  registerCodeHighlighting,
} from "@lexical/code";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from "@lexical/markdown";
import type { EditorState, LexicalEditor } from "lexical";
import type { InitialConfigType } from "@lexical/react/LexicalComposer";
import { editorTheme } from "@/components/channel/editor/themes/editorTheme";
import { DOCUMENT_MARKDOWN_TRANSFORMERS } from "./markdownTransformers";
import { DocumentToolbar } from "./DocumentToolbar";
import { cn } from "@/lib/utils";

interface DocumentEditorProps {
  /** Initial markdown content to load into the editor */
  initialContent?: string;
  /** Called when editor content changes — receives markdown string */
  onChange?: (markdown: string) => void;
  /** Whether editor is read-only */
  readOnly?: boolean;
  /** Placeholder text */
  placeholder?: string;
  /** Additional class name for the editor wrapper */
  className?: string;
}

function Placeholder({ text }: { text: string }) {
  return (
    <div className="absolute top-0 left-0 text-muted-foreground pointer-events-none select-none text-sm">
      {text}
    </div>
  );
}

function CodeHighlightPlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    return registerCodeHighlighting(editor);
  }, [editor]);
  return null;
}

/** Plugin that loads initial markdown content into the editor */
function InitialContentPlugin({
  content,
  transformers,
}: {
  content?: string;
  transformers: typeof DOCUMENT_MARKDOWN_TRANSFORMERS;
}) {
  const [editor] = useLexicalComposerContext();
  const hasLoaded = useRef(false);

  useEffect(() => {
    if (hasLoaded.current) return;
    hasLoaded.current = true;

    if (content) {
      editor.update(() => {
        $convertFromMarkdownString(content, transformers);
      });
    }
  }, [editor, content, transformers]);

  return null;
}

/** Plugin to expose editor ref externally */
function EditorRefPlugin({
  editorRef,
}: {
  editorRef: React.RefObject<LexicalEditor | null>;
}) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    editorRef.current = editor;
  }, [editor, editorRef]);
  return null;
}

export function DocumentEditor({
  initialContent,
  onChange,
  readOnly = false,
  placeholder = "Start writing...",
  className,
}: DocumentEditorProps) {
  const editorRef = useRef<LexicalEditor | null>(null);

  const initialConfig: InitialConfigType = {
    namespace: "DocumentEditor",
    theme: editorTheme,
    nodes: [
      HeadingNode,
      ListNode,
      ListItemNode,
      CodeNode,
      CodeHighlightNode,
      QuoteNode,
    ] as InitialConfigType["nodes"],
    onError: (error: Error) => {
      console.error("DocumentEditor error:", error);
    },
    editable: !readOnly,
  };

  const handleChange = useCallback(
    (_editorState: EditorState, editor: LexicalEditor) => {
      if (!onChange) return;
      editor.read(() => {
        const markdown = $convertToMarkdownString(
          DOCUMENT_MARKDOWN_TRANSFORMERS,
        );
        onChange(markdown);
      });
    },
    [onChange],
  );

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className={cn("flex flex-col", className)}>
        {!readOnly && <DocumentToolbar />}
        <div
          className={cn(
            "relative flex-1 overflow-y-auto mt-2",
            readOnly && "bg-muted/30 rounded-md p-2",
          )}
        >
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                className={cn(
                  "outline-none text-sm leading-relaxed min-h-[120px]",
                  readOnly && "cursor-default",
                )}
                aria-placeholder={placeholder}
                placeholder={<Placeholder text={placeholder} />}
              />
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
          <HistoryPlugin />
          <ListPlugin />
          <MarkdownShortcutPlugin
            transformers={DOCUMENT_MARKDOWN_TRANSFORMERS}
          />
          <CodeHighlightPlugin />
          <OnChangePlugin onChange={handleChange} />
          <InitialContentPlugin
            content={initialContent}
            transformers={DOCUMENT_MARKDOWN_TRANSFORMERS}
          />
          <EditorRefPlugin editorRef={editorRef} />
        </div>
      </div>
    </LexicalComposer>
  );
}

/**
 * Helper: get current markdown from an editor ref.
 * Use this to read content on save without needing onChange.
 */
export function getEditorMarkdown(editor: LexicalEditor): string {
  let markdown = "";
  editor.read(() => {
    markdown = $convertToMarkdownString(DOCUMENT_MARKDOWN_TRANSFORMERS);
  });
  return markdown;
}
```

**Step 2: Commit**

```bash
git add apps/client/src/components/documents/DocumentEditor.tsx
git commit -m "feat: add DocumentEditor component with Lexical + markdown"
```

---

### Task 6: Create SuggestionsList component

Collapsible list of pending AI suggestions shown below the editor.

**Files:**

- Create: `apps/client/src/components/documents/SuggestionsList.tsx`

**Step 1: Create the component**

```typescript
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDocumentSuggestions } from "@/hooks/useDocuments";
import type { SuggestionResponse } from "@/types/document";

interface SuggestionsListProps {
  documentId: string;
  onViewSuggestion: (suggestion: SuggestionResponse) => void;
}

export function SuggestionsList({
  documentId,
  onViewSuggestion,
}: SuggestionsListProps) {
  const { t } = useTranslation("tasks");
  const [expanded, setExpanded] = useState(false);

  const { data: suggestions } = useDocumentSuggestions(documentId, "pending");

  if (!suggestions || suggestions.length === 0) return null;

  return (
    <div className="border-t border-border pt-3">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full text-left text-sm font-medium hover:text-foreground/80"
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Sparkles size={14} className="text-amber-500" />
        {t("detail.document.suggestions.count", {
          count: suggestions.length,
        })}
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          {suggestions.map((suggestion) => (
            <div
              key={suggestion.id}
              className="flex items-center justify-between gap-2 rounded-md border border-border bg-card p-2"
            >
              <p className="text-xs text-muted-foreground line-clamp-1 flex-1">
                {suggestion.summary || t("detail.document.suggestions.title")}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-xs shrink-0"
                onClick={() => onViewSuggestion(suggestion)}
              >
                {t("detail.document.suggestions.view")}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add apps/client/src/components/documents/SuggestionsList.tsx
git commit -m "feat: add SuggestionsList component for AI suggestions"
```

---

### Task 7: Create SuggestionDiffModal component

Modal dialog showing two-column diff view for an AI suggestion with approve/reject actions.

**Files:**

- Create: `apps/client/src/components/documents/SuggestionDiffModal.tsx`

**Reference:**

- `apps/client/src/types/document.ts` — `SuggestionDetailResponse`, `DiffChange` types
- `apps/client/src/components/ui/dialog.tsx` — existing Radix Dialog component

**Step 1: Create the diff modal**

```typescript
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSuggestionDetail, useReviewSuggestion } from "@/hooks/useDocuments";
import type { SuggestionResponse, DiffChange } from "@/types/document";
import { cn } from "@/lib/utils";

interface SuggestionDiffModalProps {
  documentId: string;
  suggestion: SuggestionResponse | null;
  onClose: () => void;
}

function DiffView({ changes }: { changes: DiffChange[] }) {
  return (
    <pre className="text-xs leading-relaxed whitespace-pre-wrap break-words font-mono p-3 bg-muted/30 rounded-md overflow-auto max-h-[60vh]">
      {changes.map((change, i) => (
        <span
          key={i}
          className={cn(
            change.added && "bg-green-500/20 text-green-700 dark:text-green-400",
            change.removed && "bg-red-500/20 text-red-700 dark:text-red-400 line-through",
          )}
        >
          {change.value}
        </span>
      ))}
    </pre>
  );
}

export function SuggestionDiffModal({
  documentId,
  suggestion,
  onClose,
}: SuggestionDiffModalProps) {
  const { t } = useTranslation("tasks");

  const { data: detail, isLoading } = useSuggestionDetail(
    suggestion ? documentId : undefined,
    suggestion?.id,
  );

  const reviewMutation = useReviewSuggestion(documentId);

  const handleReview = async (action: "approve" | "reject") => {
    if (!suggestion) return;
    await reviewMutation.mutateAsync({ sugId: suggestion.id, action });
    onClose();
  };

  return (
    <Dialog open={!!suggestion} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-base">
            {suggestion?.summary || t("detail.document.suggestions.title")}
          </DialogTitle>
          {detail?.isOutdated && (
            <Badge variant="outline" className="w-fit text-amber-600 border-amber-300">
              {t("detail.document.suggestions.outdated")}
            </Badge>
          )}
        </DialogHeader>

        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : detail ? (
            <DiffView changes={detail.diff} />
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleReview("reject")}
            disabled={reviewMutation.isPending}
          >
            {t("detail.document.suggestions.reject")}
          </Button>
          <Button
            onClick={() => handleReview("approve")}
            disabled={reviewMutation.isPending}
          >
            {reviewMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : null}
            {t("detail.document.suggestions.approve")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 2: Commit**

```bash
git add apps/client/src/components/documents/SuggestionDiffModal.tsx
git commit -m "feat: add SuggestionDiffModal with diff view and approve/reject"
```

---

### Task 8: Rewrite TaskDocumentTab

Replace the old read-only preview with the new document editor, version selector, save button, and suggestions integration.

**Files:**

- Modify: `apps/client/src/components/tasks/TaskDocumentTab.tsx` (full rewrite)
- Delete: `apps/client/src/components/tasks/DocumentVersionHistory.tsx` (no longer needed)

**Reference:**

- `apps/client/src/hooks/useDocuments.ts` — `useDocument`, `useDocumentVersions`, `useDocumentVersion`, `useUpdateDocument`
- `apps/client/src/components/ui/select.tsx` — Radix Select component
- `apps/client/src/components/ui/dialog.tsx` — for discard confirmation

**Step 1: Rewrite TaskDocumentTab**

```typescript
import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Save, Loader2, AlertTriangle } from "lucide-react";
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
  const { data: doc, isLoading: docLoading } = useDocument(documentId ?? undefined);
  const { data: versions } = useDocumentVersions(documentId ?? undefined);
  const currentVersionIndex = doc?.currentVersion?.versionIndex;

  // ── Local state ─────────────────────────────────────────
  const [selectedVersion, setSelectedVersion] = useState<number | "current">("current");
  const [draftContent, setDraftContent] = useState<string | null>(null);
  const [showSummaryInput, setShowSummaryInput] = useState(false);
  const [summary, setSummary] = useState("");
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const [pendingVersionSwitch, setPendingVersionSwitch] = useState<number | "current" | null>(null);
  const [activeSuggestion, setActiveSuggestion] = useState<SuggestionResponse | null>(null);

  // ── Fetch historical version content ────────────────────
  const viewingHistorical = selectedVersion !== "current";
  const historicalVersionIndex = viewingHistorical ? selectedVersion as number : undefined;
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
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── No document yet ─────────────────────────────────────
  if (!documentId) {
    return (
      <div className="space-y-3">
        <DocumentEditor
          placeholder={t("detail.document.createPlaceholder")}
          onChange={handleEditorChange}
        />
        {/* TODO: save creates document and links to task */}
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
          value={selectedVersion === "current" ? "current" : String(selectedVersion)}
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
            {showSummaryInput ? (
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
            ) : null}
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
            <AlertDialogCancel onClick={() => {
              setPendingVersionSwitch(null);
              setShowDiscardDialog(false);
            }}>
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
```

**Step 2: Delete DocumentVersionHistory**

Run: `rm apps/client/src/components/tasks/DocumentVersionHistory.tsx`

**Step 3: Verify no other imports of DocumentVersionHistory exist**

Run: `grep -r "DocumentVersionHistory" apps/client/src/`
Expected: no results (TaskDocumentTab was the only consumer)

**Step 4: Commit**

```bash
git add apps/client/src/components/tasks/TaskDocumentTab.tsx
git rm apps/client/src/components/tasks/DocumentVersionHistory.tsx
git commit -m "feat: rewrite TaskDocumentTab with WYSIWYG editor, version switching, and suggestions"
```

---

### Task 9: Add AlertDialog UI component (if missing)

The `TaskDocumentTab` uses `AlertDialog` for the discard confirmation. Check if it exists; if not, add it.

**Files:**

- Possibly create: `apps/client/src/components/ui/alert-dialog.tsx`

**Step 1: Check if AlertDialog exists**

Run: `ls apps/client/src/components/ui/alert-dialog.tsx 2>/dev/null && echo "exists" || echo "missing"`

**Step 2: If missing, install and generate via shadcn**

Run: `cd /Users/winrey/Projects/weightwave/team9/apps/client && npx shadcn@latest add alert-dialog`

If shadcn is not configured, create the component manually following the same Radix UI pattern as `dialog.tsx`.

**Step 3: Commit if new file was created**

```bash
git add apps/client/src/components/ui/alert-dialog.tsx
git commit -m "feat: add AlertDialog UI component"
```

---

### Task 10: Add Badge UI component (if missing)

The `SuggestionDiffModal` uses `Badge` for the "outdated" indicator. Check if it exists.

**Files:**

- Possibly create: `apps/client/src/components/ui/badge.tsx`

**Step 1: Check if Badge exists**

Run: `ls apps/client/src/components/ui/badge.tsx 2>/dev/null && echo "exists" || echo "missing"`

**Step 2: If missing, add it**

Run: `cd /Users/winrey/Projects/weightwave/team9/apps/client && npx shadcn@latest add badge`

Or create a minimal badge component:

```typescript
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground",
        outline: "text-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
```

**Step 3: Commit if new file was created**

```bash
git add apps/client/src/components/ui/badge.tsx
git commit -m "feat: add Badge UI component"
```

---

### Task 11: Smoke test the full flow

**Step 1: Start the dev server**

Run: `cd /Users/winrey/Projects/weightwave/team9 && pnpm dev:client`

**Step 2: Manual verification checklist**

1. Navigate to Tasks page, select a task with a document
2. Click Document tab — verify editor loads with current content (no "No content")
3. Edit text — verify "Unsaved changes" indicator appears
4. Click Save — verify summary input appears, then saves
5. Check version dropdown — verify new version appears
6. Switch to historical version — verify editor becomes read-only with yellow banner
7. Click "Back to current" — verify editor becomes editable again
8. If task has AI suggestions — verify collapsible suggestions list shows
9. Click View on a suggestion — verify diff modal opens with approve/reject

**Step 3: Verify build succeeds**

Run: `cd /Users/winrey/Projects/weightwave/team9 && pnpm build:client`
Expected: build completes without errors

**Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address smoke test issues in document editor"
```

---

### Summary

| Task | Component             | Type          |
| ---- | --------------------- | ------------- |
| 1    | `diff` package        | Dependency    |
| 2    | i18n keys             | Translation   |
| 3    | Markdown transformers | Utility       |
| 4    | DocumentToolbar       | New component |
| 5    | DocumentEditor        | New component |
| 6    | SuggestionsList       | New component |
| 7    | SuggestionDiffModal   | New component |
| 8    | TaskDocumentTab       | Rewrite       |
| 9    | AlertDialog UI        | UI primitive  |
| 10   | Badge UI              | UI primitive  |
| 11   | Smoke test            | Verification  |
