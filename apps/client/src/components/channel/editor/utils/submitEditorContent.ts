import { $createParagraphNode, $getRoot } from "lexical";
import type { LexicalEditor } from "lexical";
import { exportToPlainText, hasContent } from "./exportContent";

export interface EditorSubmitPayload {
  // Plaintext fallback — used by bots/old clients/search/notifications.
  content: string;
  // Lexical serialized EditorState — canonical source. Rendered directly as
  // React elements (no dangerouslySetInnerHTML); absence means the caller
  // bypassed the composer.
  contentAst?: Record<string, unknown>;
}

function clearEditor(editor: LexicalEditor) {
  editor.update(
    () => {
      const root = $getRoot();
      root.clear();
      const paragraph = $createParagraphNode();
      root.append(paragraph);
      paragraph.select();
    },
    { discrete: true },
  );
}

function serializeEditorState(editor: LexicalEditor): Record<string, unknown> {
  // Lexical's `.toJSON()` returns a JSON-serializable object matching
  // SerializedEditorState. Cast to Record<string, unknown> for our transport
  // type — we don't depend on Lexical's internal shape here.
  return editor.getEditorState().toJSON() as unknown as Record<string, unknown>;
}

export async function submitEditorContent({
  editor,
  onSubmit,
  disabled,
  hasAttachments,
  clearOnSubmit = true,
}: {
  editor: LexicalEditor;
  onSubmit: (payload: EditorSubmitPayload) => Promise<void>;
  disabled?: boolean;
  hasAttachments?: boolean;
  /** Whether to clear the editor after submit (default: true). Set to false for edit mode. */
  clearOnSubmit?: boolean;
}) {
  if (disabled) return false;

  const editorHasContent = hasContent(editor);
  if (!editorHasContent && !hasAttachments) return false;

  const content = editorHasContent ? exportToPlainText(editor) : "";
  const contentAst = editorHasContent
    ? serializeEditorState(editor)
    : undefined;

  if (clearOnSubmit) {
    const previousEditorState = editor.getEditorState().clone(null);

    clearEditor(editor);

    try {
      await onSubmit({ content, contentAst });
    } catch (error) {
      if (!hasContent(editor)) {
        editor.setEditorState(previousEditorState);
      }

      throw error;
    }
  } else {
    // In edit mode, don't clear — just submit. Content is preserved if the request fails.
    await onSubmit({ content, contentAst });
  }

  return true;
}
