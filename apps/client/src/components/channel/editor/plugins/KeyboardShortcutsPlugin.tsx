import { useEffect, useCallback } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  COMMAND_PRIORITY_LOW,
  KEY_ENTER_COMMAND,
  $getRoot,
  $createParagraphNode,
} from "lexical";
import { exportToPlainText } from "../utils/exportContent";

interface KeyboardShortcutsPluginProps {
  onSubmit: (content: string) => Promise<void>;
  disabled?: boolean;
}

export function KeyboardShortcutsPlugin({
  onSubmit,
  disabled,
}: KeyboardShortcutsPluginProps) {
  const [editor] = useLexicalComposerContext();

  const handleSubmit = useCallback(async () => {
    if (disabled) return false;

    const content = exportToPlainText(editor);

    if (!content.trim()) return false;

    try {
      await onSubmit(content);

      // Clear editor after successful submit
      editor.update(() => {
        const root = $getRoot();
        root.clear();
        const paragraph = $createParagraphNode();
        root.append(paragraph);
        paragraph.select();
      });

      return true;
    } catch (error) {
      console.error("Failed to send message:", error);
      return false;
    }
  }, [editor, onSubmit, disabled]);

  useEffect(() => {
    // Handle Enter key for sending messages
    // Shift+Enter will be handled by default Lexical behavior (insert line break)
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent | null) => {
        if (event?.shiftKey) {
          // Let default behavior handle Shift+Enter (line break)
          return false;
        }

        // Check if mentions popup is open by checking if there's a suggestion container
        // This is handled by MentionsPlugin with higher priority when suggestions are shown
        // So if we get here, there are no suggestions

        event?.preventDefault();
        handleSubmit();
        return true;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor, handleSubmit]);

  return null;
}
