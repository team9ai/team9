import { useCallback, useRef, useEffect } from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { ListNode, ListItemNode } from "@lexical/list";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import type { EditorState, LexicalEditor } from "lexical";
import type { InitialConfigType } from "@lexical/react/LexicalComposer";

import { editorTheme } from "./themes/editorTheme";
import { MentionNode } from "./nodes/MentionNode";
import { EditorToolbar } from "./EditorToolbar";
import { MentionsPlugin, KeyboardShortcutsPlugin } from "./plugins";
import { AttachmentPreview } from "./AttachmentPreview";
import { cn } from "@/lib/utils";
import type { UploadingFile } from "@/hooks/useFileUpload";

interface RichTextEditorProps {
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
}

function Placeholder({ text }: { text: string }) {
  return (
    <div className="absolute top-0 left-0 text-slate-400 pointer-events-none select-none text-sm">
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

export function RichTextEditor({
  onSubmit,
  disabled = false,
  placeholder = "Type a message... (Enter to send, Shift+Enter for new line)",
  className,
  compact = false,
  onFileSelect,
  uploadingFiles = [],
  onRemoveFile,
  onRetryFile,
}: RichTextEditorProps) {
  const editorRef = useRef<LexicalEditor | null>(null);

  const initialConfig: InitialConfigType = {
    namespace: "MessageEditor",
    theme: editorTheme,
    nodes: [MentionNode, ListNode, ListItemNode] as InitialConfigType["nodes"],
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
          <OnChangePlugin onChange={handleChange} />
          <AutoFocusPlugin />
          <EditorRefPlugin editorRef={editorRef} />

          {/* Mentions dropdown container */}
          <MentionsPlugin />
        </div>

        {/* Attachment previews */}
        {uploadingFiles.length > 0 && onRemoveFile && (
          <AttachmentPreview
            files={uploadingFiles}
            onRemove={onRemoveFile}
            onRetry={onRetryFile}
          />
        )}

        <KeyboardShortcutsPlugin
          onSubmit={onSubmit}
          disabled={disabled}
          hasAttachments={uploadingFiles.some((f) => f.status === "completed")}
        />
      </div>
    </LexicalComposer>
  );
}
