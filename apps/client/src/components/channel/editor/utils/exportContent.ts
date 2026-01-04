import type { LexicalEditor, LexicalNode } from "lexical";
import {
  $getRoot,
  $isElementNode,
  $isLineBreakNode,
  $isTextNode,
  $isParagraphNode,
} from "lexical";
import { $isListNode, $isListItemNode } from "@lexical/list";
import { $isMentionNode } from "../nodes/MentionNode";

/**
 * Export editor content as plain text with @<userId> format for mentions.
 * This format is compatible with the backend mention parser.
 * Used for backend storage and mention parsing.
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
 * Export editor content as HTML with formatting preserved.
 * Mentions are exported with data attributes for rendering.
 * Used for displaying formatted messages.
 */
export function exportToHtml(editor: LexicalEditor): string {
  let html = "";

  editor.getEditorState().read(() => {
    const root = $getRoot();
    html = processNodeToHtml(root);
  });

  return html.trim();
}

function processNodeToHtml(node: LexicalNode): string {
  if ($isMentionNode(node)) {
    // Export mention as @<userId> format for backend parsing
    // The display name is stored in a data attribute for client-side rendering
    const userId = node.getUserId();
    const displayName = node.getDisplayName();
    return `<mention data-user-id="${userId}" data-display-name="${escapeHtml(displayName)}">@&lt;${userId}&gt;</mention>`;
  }

  if ($isTextNode(node)) {
    let text = escapeHtml(node.getTextContent());
    const format = node.getFormat();

    // Apply text formatting
    if (format & 1) {
      // Bold
      text = `<strong>${text}</strong>`;
    }
    if (format & 2) {
      // Italic
      text = `<em>${text}</em>`;
    }
    if (format & 4) {
      // Strikethrough
      text = `<s>${text}</s>`;
    }
    if (format & 8) {
      // Underline
      text = `<u>${text}</u>`;
    }
    if (format & 16) {
      // Code
      text = `<code>${text}</code>`;
    }

    return text;
  }

  if ($isLineBreakNode(node)) {
    return "<br>";
  }

  if ($isListNode(node)) {
    const listType = node.getListType();
    const tag = listType === "number" ? "ol" : "ul";
    const children = node.getChildren();
    const childrenHtml = children
      .map((child) => processNodeToHtml(child))
      .join("");
    return `<${tag}>${childrenHtml}</${tag}>`;
  }

  if ($isListItemNode(node)) {
    const children = node.getChildren();
    const childrenHtml = children
      .map((child) => processNodeToHtml(child))
      .join("");
    return `<li>${childrenHtml}</li>`;
  }

  if ($isParagraphNode(node)) {
    const children = node.getChildren();
    if (children.length === 0) {
      return "<br>";
    }
    const childrenHtml = children
      .map((child) => processNodeToHtml(child))
      .join("");
    return `<p>${childrenHtml}</p>`;
  }

  if ($isElementNode(node)) {
    const children = node.getChildren();
    return children.map((child) => processNodeToHtml(child)).join("");
  }

  return "";
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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
