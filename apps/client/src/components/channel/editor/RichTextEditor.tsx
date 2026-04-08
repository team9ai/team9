import { useCallback, useRef, useEffect, useState } from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { ListNode, ListItemNode } from "@lexical/list";
import {
  CodeNode,
  CodeHighlightNode,
  registerCodeHighlighting,
} from "@lexical/code";
import { QuoteNode } from "@lexical/rich-text";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getRoot, $createParagraphNode, $createTextNode } from "lexical";
import type { EditorState, LexicalEditor } from "lexical";
import type { InitialConfigType } from "@lexical/react/LexicalComposer";
import { Send } from "lucide-react";
import { hasContent } from "./utils/exportContent";
import { CHAT_MARKDOWN_TRANSFORMERS } from "./utils/markdownTransformers";
import { submitEditorContent } from "./utils/submitEditorContent";

import { editorTheme } from "./themes/editorTheme";
import { MentionNode } from "./nodes/MentionNode";
import { EditorToolbar } from "./EditorToolbar";
import { MentionsPlugin, KeyboardShortcutsPlugin } from "./plugins";
import { AttachmentPreview } from "./AttachmentPreview";
import { cn } from "@/lib/utils";
import type { UploadingFile } from "@/hooks/useFileUpload";

interface RichTextEditorProps {
  /** Channel ID for bot membership check in mentions */
  channelId?: string;
  onSubmit: (content: string) => Promise<void>;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  /** Compact mode for thread panel - smaller height, no toolbar */
  compact?: boolean;
  // File upload props
  onFileSelect?: (files: FileList) => void;
  uploadingFiles?: UploadingFile[];
  onRemoveFile?: (id: string) => void;
  onRetryFile?: (id: string) => void;
  /** Draft text to pre-fill in the editor */
  initialDraft?: string;
  /** Automatically send the initial draft once after mount */
  autoSendInitialDraft?: boolean;
  /** Called after the initial draft auto-send succeeds */
  onInitialDraftAutoSent?: () => void;
}

function Placeholder({ text }: { text: string }) {
  return (
    <div className="absolute top-0 left-0 text-muted-foreground pointer-events-none select-none text-sm">
      {text}
    </div>
  );
}

function AutoFocusPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    // Focus the editor when mounted
    editor.focus();
  }, [editor]);

  return null;
}

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

function CodeHighlightPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return registerCodeHighlighting(editor);
  }, [editor]);

  return null;
}

function writeDraftToEditor(editor: LexicalEditor, draft: string) {
  editor.update(
    () => {
      const root = $getRoot();
      root.clear();
      const paragraph = $createParagraphNode();
      paragraph.append($createTextNode(draft));
      root.append(paragraph);
      paragraph.selectEnd();
    },
    { discrete: true },
  );
}

function InitialDraftPlugin({
  channelId,
  draft,
}: {
  channelId?: string;
  draft?: string;
}) {
  const [editor] = useLexicalComposerContext();
  const appliedDraftKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!draft) {
      appliedDraftKeyRef.current = null;
      return;
    }

    const draftKey = `${channelId ?? "default"}::${draft}`;

    if (appliedDraftKeyRef.current === draftKey) {
      return;
    }

    writeDraftToEditor(editor, draft);
    appliedDraftKeyRef.current = draftKey;
  }, [channelId, draft, editor]);

  return null;
}

function AutoSendDraftPlugin({
  channelId,
  draft,
  enabled,
  onSubmit,
  disabled,
  hasAttachments,
  onAutoSent,
}: {
  channelId?: string;
  draft?: string;
  enabled?: boolean;
  onSubmit: (content: string) => Promise<void>;
  disabled?: boolean;
  hasAttachments?: boolean;
  onAutoSent?: () => void;
}) {
  const [editor] = useLexicalComposerContext();
  const autoSubmittedDraftKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!draft) {
      autoSubmittedDraftKeyRef.current = null;
      return;
    }

    if (!enabled || disabled) {
      return;
    }

    const draftKey = `${channelId ?? "default"}::${draft}`;
    if (autoSubmittedDraftKeyRef.current === draftKey) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void submitEditorContent({
        editor,
        onSubmit,
        disabled,
        hasAttachments,
      })
        .then((didSubmit) => {
          if (didSubmit) {
            autoSubmittedDraftKeyRef.current = draftKey;
            onAutoSent?.();
          }
        })
        .catch((error) => {
          console.error("Failed to auto-send draft:", error);
        });
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [
    channelId,
    disabled,
    draft,
    editor,
    enabled,
    hasAttachments,
    onAutoSent,
    onSubmit,
  ]);

  return null;
}

function SendButton({
  onSubmit,
  disabled,
  hasAttachments,
}: {
  onSubmit: (content: string) => Promise<void>;
  disabled?: boolean;
  hasAttachments?: boolean;
}) {
  const [editor] = useLexicalComposerContext();
  const [editorHasContent, setEditorHasContent] = useState(false);

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        setEditorHasContent(hasContent(editor));
      });
    });
  }, [editor]);

  const canSend = !disabled && (editorHasContent || hasAttachments);

  const handleClick = useCallback(() => {
    if (!canSend) return;

    void submitEditorContent({
      editor,
      onSubmit,
      disabled,
      hasAttachments,
    }).catch((error) => {
      console.error("Failed to send message:", error);
    });
  }, [editor, onSubmit, canSend, disabled, hasAttachments]);

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!canSend}
      className={cn(
        "p-2 rounded-md transition-colors",
        canSend
          ? "bg-info hover:bg-info/90 text-primary-foreground"
          : "bg-muted text-muted-foreground cursor-not-allowed",
      )}
      title="Send message"
    >
      <Send size={18} />
    </button>
  );
}

export function RichTextEditor({
  channelId,
  onSubmit,
  disabled = false,
  placeholder = "Type a message... (Enter to send, Shift+Enter for new line)",
  className,
  compact = false,
  onFileSelect,
  uploadingFiles = [],
  onRemoveFile,
  onRetryFile,
  initialDraft,
  autoSendInitialDraft,
  onInitialDraftAutoSent,
}: RichTextEditorProps) {
  const editorRef = useRef<LexicalEditor | null>(null);
  const hasAttachments = uploadingFiles.some((f) => f.status === "completed");

  const initialConfig: InitialConfigType = {
    namespace: "MessageEditor",
    theme: editorTheme,
    nodes: [
      MentionNode,
      ListNode,
      ListItemNode,
      CodeNode,
      CodeHighlightNode,
      QuoteNode,
    ] as InitialConfigType["nodes"],
    onError: (error: Error) => {
      console.error("Lexical error:", error);
    },
    editable: !disabled,
  };

  const handleChange = useCallback(
    (_editorState: EditorState, _editor: LexicalEditor) => {
      // Can be used to track changes if needed
    },
    [],
  );

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className={cn("relative", className)}>
        {!compact && <EditorToolbar onFileSelect={onFileSelect} />}

        <div
          className={cn(
            "relative overflow-y-auto",
            compact ? "min-h-10 max-h-30" : "min-h-20 max-h-50",
          )}
        >
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                className={cn(
                  "outline-none text-sm leading-relaxed",
                  compact ? "min-h-10 px-0 py-0" : "min-h-20 px-0 py-0",
                  disabled && "opacity-50 cursor-not-allowed",
                )}
                aria-placeholder={placeholder}
                placeholder={<Placeholder text={placeholder} />}
              />
            }
            ErrorBoundary={LexicalErrorBoundary}
          />

          <HistoryPlugin />
          <ListPlugin />
          <MarkdownShortcutPlugin transformers={CHAT_MARKDOWN_TRANSFORMERS} />
          <CodeHighlightPlugin />
          <OnChangePlugin onChange={handleChange} />
          <AutoFocusPlugin />
          <EditorRefPlugin editorRef={editorRef} />
          <InitialDraftPlugin channelId={channelId} draft={initialDraft} />
          <AutoSendDraftPlugin
            channelId={channelId}
            draft={initialDraft}
            enabled={autoSendInitialDraft}
            onSubmit={onSubmit}
            disabled={disabled}
            hasAttachments={hasAttachments}
            onAutoSent={onInitialDraftAutoSent}
          />
        </div>

        {/* Mentions dropdown container - must be outside overflow-y-auto to avoid clipping */}
        <MentionsPlugin channelId={channelId} />

        {/* Attachment previews */}
        {uploadingFiles.length > 0 && onRemoveFile && (
          <AttachmentPreview
            files={uploadingFiles}
            onRemove={onRemoveFile}
            onRetry={onRetryFile}
          />
        )}

        {/* Send button */}
        <div className="flex justify-end mt-2">
          <SendButton
            onSubmit={onSubmit}
            disabled={disabled}
            hasAttachments={hasAttachments}
          />
        </div>

        <KeyboardShortcutsPlugin
          onSubmit={onSubmit}
          disabled={disabled}
          hasAttachments={hasAttachments}
        />
      </div>
    </LexicalComposer>
  );
}
