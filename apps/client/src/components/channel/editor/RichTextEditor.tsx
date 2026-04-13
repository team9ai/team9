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
import { KEY_ESCAPE_COMMAND, COMMAND_PRIORITY_LOW } from "lexical";
import { $generateNodesFromDOM } from "@lexical/html";
import type { EditorState, LexicalEditor } from "lexical";
import type { InitialConfigType } from "@lexical/react/LexicalComposer";
import { ArrowUp, Sparkles, ChevronDown, Loader2 } from "lucide-react";
import type { useBotModelSwitch } from "@/hooks/useBotModelSwitch";
import { COMMON_STAFF_MODELS } from "@/lib/common-staff-models";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  /** HTML content to pre-fill in the editor (for edit mode) */
  initialHtml?: string;
  /** Callback when Escape is pressed (for edit mode) */
  onCancel?: () => void;
  /**
   * Whether to clear the editor after submit (default: true).
   * Set to false for edit mode so the content is preserved if the request fails.
   */
  clearOnSubmit?: boolean;
  /** Label for the submit button (e.g. "Save" in edit mode). Shows text button instead of icon. */
  submitLabel?: string;
  /** Automatically send the initial draft once after mount */
  autoSendInitialDraft?: boolean;
  /** Called after the initial draft auto-send succeeds */
  onInitialDraftAutoSent?: () => void;
  /** Whether this is a bot DM channel - shows AI feature buttons */
  isBotDm?: boolean;
  /** Bot model switching info */
  botModelSwitch?: ReturnType<typeof useBotModelSwitch>;
}

function Placeholder({ text, compact }: { text: string; compact?: boolean }) {
  return (
    <div
      className={cn(
        "absolute top-0 left-0 text-muted-foreground/60 pointer-events-none select-none text-sm",
        compact ? "" : "px-5 pt-4",
      )}
    >
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

function EditablePlugin({ editable }: { editable: boolean }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    editor.setEditable(editable);
  }, [editor, editable]);

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

function InitialHtmlPlugin({ html }: { html?: string }) {
  const [editor] = useLexicalComposerContext();
  const hasApplied = useRef(false);

  useEffect(() => {
    if (!html || hasApplied.current) return;
    hasApplied.current = true;

    editor.update(() => {
      const root = $getRoot();
      root.clear();

      const parser = new DOMParser();
      const dom = parser.parseFromString(html, "text/html");
      const nodes = $generateNodesFromDOM(editor, dom);

      nodes.forEach((node) => root.append(node));
      root.selectEnd();
    });
  }, [editor, html]);

  return null;
}

function EscapePlugin({ onCancel }: { onCancel?: () => void }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (!onCancel) return;
    return editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      () => {
        onCancel();
        return true;
      },
      COMMAND_PRIORITY_LOW, // Lower priority so MentionsPlugin gets first chance to handle Escape
    );
  }, [editor, onCancel]);

  return null;
}

function SendButton({
  onSubmit,
  disabled,
  hasAttachments,
  clearOnSubmit = true,
  submitLabel,
}: {
  onSubmit: (content: string) => Promise<void>;
  disabled?: boolean;
  hasAttachments?: boolean;
  clearOnSubmit?: boolean;
  submitLabel?: string;
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
      clearOnSubmit,
    }).catch((error) => {
      console.error("Failed to send message:", error);
    });
  }, [editor, onSubmit, canSend, disabled, hasAttachments, clearOnSubmit]);

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!canSend}
      className={cn(
        "h-8 w-8 rounded-full flex items-center justify-center transition-all duration-200",
        canSend
          ? "bg-foreground hover:bg-foreground/80 text-background"
          : "bg-muted text-muted-foreground cursor-not-allowed",
        submitLabel && "w-auto px-3",
      )}
      title={submitLabel ?? "Send message"}
    >
      {submitLabel ? (
        <span className="text-sm font-medium px-1">{submitLabel}</span>
      ) : (
        <ArrowUp size={16} strokeWidth={2.5} />
      )}
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
  initialHtml,
  onCancel,
  clearOnSubmit = true,
  submitLabel,
  autoSendInitialDraft,
  onInitialDraftAutoSent,
  isBotDm = false,
  botModelSwitch,
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
        {/* Editor area */}
        <div
          className={cn(
            "relative overflow-y-auto",
            compact ? "min-h-10 max-h-30" : "min-h-10 max-h-40",
          )}
        >
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                className={cn(
                  "outline-none text-sm leading-relaxed",
                  compact ? "min-h-10" : "min-h-14 px-5 pt-4 pb-2",
                  disabled && "opacity-50 cursor-not-allowed",
                )}
                aria-placeholder={placeholder}
                placeholder={
                  <Placeholder text={placeholder} compact={compact} />
                }
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
          <EditablePlugin editable={!disabled} />
          <EditorRefPlugin editorRef={editorRef} />
          <InitialDraftPlugin channelId={channelId} draft={initialDraft} />
          <InitialHtmlPlugin html={initialHtml} />
          <EscapePlugin onCancel={onCancel} />
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

        {/* Bottom row: tools on left, model selector + send on right */}
        <div
          className={cn(
            "flex items-center justify-between",
            compact ? "pt-1" : "px-3 pb-3 pt-1",
          )}
        >
          {!compact ? (
            <EditorToolbar
              channelId={channelId}
              onFileSelect={onFileSelect}
              isBotDm={isBotDm}
            />
          ) : (
            <div />
          )}
          <div className="flex items-center gap-1.5">
            {isBotDm && botModelSwitch && botModelSwitch.canSwitchModel && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={botModelSwitch.isUpdating}
                    className="flex items-center gap-1.5 h-8 px-3 rounded-full border border-border/60 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {botModelSwitch.isUpdating ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Sparkles size={14} />
                    )}
                    <span>{botModelSwitch.currentModelLabel}</span>
                    <ChevronDown size={11} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-60 rounded-xl p-1.5"
                >
                  <DropdownMenuRadioGroup
                    value={
                      botModelSwitch.currentModel
                        ? `${botModelSwitch.currentModel.provider}::${botModelSwitch.currentModel.id}`
                        : undefined
                    }
                    onValueChange={(value) => {
                      const [provider, id] = value.split("::");
                      if (!provider || !id) return;
                      void botModelSwitch.updateModel({ provider, id });
                    }}
                  >
                    {COMMON_STAFF_MODELS.map((model) => (
                      <DropdownMenuRadioItem
                        key={`${model.provider}::${model.id}`}
                        value={`${model.provider}::${model.id}`}
                        className="cursor-pointer rounded-lg py-2.5"
                      >
                        {model.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {isBotDm &&
              botModelSwitch &&
              !botModelSwitch.canSwitchModel &&
              botModelSwitch.currentModelLabel && (
                <div className="flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium text-muted-foreground">
                  <Sparkles size={14} />
                  <span>{botModelSwitch.currentModelLabel}</span>
                </div>
              )}
            <SendButton
              onSubmit={onSubmit}
              disabled={disabled}
              hasAttachments={hasAttachments}
              clearOnSubmit={clearOnSubmit}
              submitLabel={submitLabel}
            />
          </div>
        </div>

        <KeyboardShortcutsPlugin
          onSubmit={onSubmit}
          disabled={disabled}
          hasAttachments={hasAttachments}
          clearOnSubmit={clearOnSubmit}
        />
      </div>
    </LexicalComposer>
  );
}
