import { useEffect, useCallback } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  COMMAND_PRIORITY_LOW,
  KEY_ENTER_COMMAND,
  $getSelection,
  $isRangeSelection,
} from "lexical";
import { CodeNode } from "@lexical/code";
import { $getNearestNodeOfType } from "@lexical/utils";
import { hasContent } from "../utils/exportContent";
import { submitEditorContent } from "../utils/submitEditorContent";

interface KeyboardShortcutsPluginProps {
  onSubmit: (content: string) => Promise<void>;
  disabled?: boolean;
  hasAttachments?: boolean;
}

export function KeyboardShortcutsPlugin({
  onSubmit,
  disabled,
  hasAttachments = false,
}: KeyboardShortcutsPluginProps) {
  const [editor] = useLexicalComposerContext();

  const handleSubmit = useCallback(() => {
    if (disabled) return false;

    // Check for actual text content (not just HTML tags like <br>) or attachments
    const editorHasContent = hasContent(editor);
    if (!editorHasContent && !hasAttachments) return false;

    void submitEditorContent({
      editor,
      onSubmit,
      disabled,
      hasAttachments,
    }).catch((error) => {
      console.error("Failed to send message:", error);
    });

    return true;
  }, [editor, onSubmit, disabled, hasAttachments]);

  useEffect(() => {
    // Handle Enter key for sending messages
    // Shift+Enter will be handled by default Lexical behavior (insert line break)
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent | null) => {
        if (event?.shiftKey || event?.ctrlKey) {
          // Let default behavior handle Shift+Enter / Ctrl+Enter (line break)
          return false;
        }

        // Inside a code block, Enter should insert newline instead of sending
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          const anchorNode = selection.anchor.getNode();
          const codeNode = $getNearestNodeOfType(anchorNode, CodeNode);
          if (codeNode) {
            return false;
          }
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
