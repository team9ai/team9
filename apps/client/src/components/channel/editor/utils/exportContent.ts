import type { LexicalEditor } from "lexical";
import {
  $getRoot,
  $isElementNode,
  $isLineBreakNode,
  $isTextNode,
} from "lexical";
import { $isListNode, $isListItemNode } from "@lexical/list";
import { $isMentionNode } from "../nodes/MentionNode";

/**
 * Export editor content as plain text with @<userId> format for mentions.
 * This format is compatible with the backend mention parser.
 */
export function exportToPlainText(editor: LexicalEditor): string {
  let content = "";

  editor.getEditorState().read(() => {
    const root = $getRoot();

    function processNode(node: ReturnType<typeof $getRoot>): void {
      const children = node.getChildren();

      children.forEach((child, index) => {
        if ($isMentionNode(child)) {
          // Export mention as @<userId> format for backend parsing
          content += `@<${child.getUserId()}>`;
        } else if ($isTextNode(child)) {
          content += child.getTextContent();
        } else if ($isLineBreakNode(child)) {
          content += "\n";
        } else if ($isListNode(child)) {
          // Process list items
          const listChildren = child.getChildren();
          listChildren.forEach((listItem) => {
            if ($isListItemNode(listItem)) {
              const listType = child.getListType();
              const prefix = listType === "number" ? "• " : "• ";
              content += prefix;
              processNode(listItem as unknown as ReturnType<typeof $getRoot>);
              content += "\n";
            }
          });
        } else if ($isElementNode(child)) {
          // Recursively process element nodes (paragraphs, etc.)
          processNode(child as unknown as ReturnType<typeof $getRoot>);
          // Add newline after block elements (except the last one)
          if (index < children.length - 1) {
            content += "\n";
          }
        }
      });
    }

    processNode(root);
  });

  return content.trim();
}

/**
 * Check if the editor has any content
 */
export function hasContent(editor: LexicalEditor): boolean {
  let hasText = false;

  editor.getEditorState().read(() => {
    const root = $getRoot();
    const text = root.getTextContent();
    hasText = text.trim().length > 0;
  });

  return hasText;
}
