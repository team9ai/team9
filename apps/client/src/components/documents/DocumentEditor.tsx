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
  initialContent?: string;
  onChange?: (markdown: string) => void;
  readOnly?: boolean;
  placeholder?: string;
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

export function getEditorMarkdown(editor: LexicalEditor): string {
  let markdown = "";
  editor.read(() => {
    markdown = $convertToMarkdownString(DOCUMENT_MARKDOWN_TRANSFORMERS);
  });
  return markdown;
}
