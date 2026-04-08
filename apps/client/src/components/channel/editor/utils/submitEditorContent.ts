import { $createParagraphNode, $getRoot } from "lexical";
import type { LexicalEditor } from "lexical";
import { exportToHtml, hasContent } from "./exportContent";

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

export async function submitEditorContent({
  editor,
  onSubmit,
  disabled,
  hasAttachments,
}: {
  editor: LexicalEditor;
  onSubmit: (content: string) => Promise<void>;
  disabled?: boolean;
  hasAttachments?: boolean;
}) {
  if (disabled) return false;

  const editorHasContent = hasContent(editor);
  if (!editorHasContent && !hasAttachments) return false;

  const content = editorHasContent ? exportToHtml(editor) : "";
  const previousEditorState = editor.getEditorState().clone(null);

  clearEditor(editor);

  try {
    await onSubmit(content);
  } catch (error) {
    if (!hasContent(editor)) {
      editor.setEditorState(previousEditorState);
    }

    throw error;
  }

  return true;
}
