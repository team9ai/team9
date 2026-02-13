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
import { exportToHtml, hasContent } from "./utils/exportContent";
import { CHAT_MARKDOWN_TRANSFORMERS } from "./utils/markdownTransformers";

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

function InitialDraftPlugin({ draft }: { draft?: string }) {
  const [editor] = useLexicalComposerContext();
  const hasApplied = useRef(false);

  useEffect(() => {
    if (!draft || hasApplied.current) return;
    hasApplied.current = true;

    editor.update(() => {
      const root = $getRoot();
      root.clear();
      const paragraph = $createParagraphNode();
      paragraph.append($createTextNode(draft));
      root.append(paragraph);
      // Move cursor to end
      paragraph.selectEnd();
    });
  }, [editor, draft]);

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

    const content = editorHasContent ? exportToHtml(editor) : "";

    // Clear editor immediately for better UX
    editor.update(() => {
      const root = $getRoot();
      root.clear();
      const paragraph = $createParagraphNode();
      root.append(paragraph);
      paragraph.select();
    });

    // Send message asynchronously (optimistic update handles UI feedback)
    onSubmit(content).catch((error) => {
      console.error("Failed to send message:", error);
    });
  }, [editor, onSubmit, canSend, editorHasContent]);

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
}: RichTextEditorProps) {
  const editorRef = useRef<LexicalEditor | null>(null);

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
          <InitialDraftPlugin draft={initialDraft} />
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
            hasAttachments={uploadingFiles.some(
              (f) => f.status === "completed",
            )}
          />
        </div>

        <KeyboardShortcutsPlugin
          onSubmit={onSubmit}
          disabled={disabled}
          hasAttachments={uploadingFiles.some((f) => f.status === "completed")}
        />
      </div>
    </LexicalComposer>
  );
}
