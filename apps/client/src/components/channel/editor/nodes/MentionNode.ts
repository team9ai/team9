import {
  type DOMConversionMap,
  type DOMExportOutput,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedTextNode,
  type Spread,
  TextNode,
} from "lexical";

export type SerializedMentionNode = Spread<
  {
    userId: string;
    displayName: string;
  },
  SerializedTextNode
>;

export class MentionNode extends TextNode {
  __userId: string;
  __displayName: string;

  static getType(): string {
    return "mention";
  }

  static clone(node: MentionNode): MentionNode {
    const clone = new MentionNode(
      node.__userId,
      node.__displayName,
      node.__text,
      node.__key,
    );
    return clone;
  }

  constructor(
    userId: string,
    displayName: string,
    text?: string,
    key?: NodeKey,
  ) {
    super(text ?? `@${displayName}`, key);
    this.__userId = userId;
    this.__displayName = displayName;
  }

  getUserId(): string {
    return this.__userId;
  }

  getDisplayName(): string {
    return this.__displayName;
  }

  createDOM(config: EditorConfig): HTMLElement {
    const element = super.createDOM(config);
    element.className =
      "bg-primary/10 text-primary px-1 py-0.5 rounded-sm mx-0.5 cursor-default select-all";
    element.setAttribute("data-mention-user-id", this.__userId);
    element.setAttribute("data-mention-display-name", this.__displayName);
    return element;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("span");
    element.setAttribute("data-lexical-mention", "true");
    element.setAttribute("data-user-id", this.__userId);
    element.textContent = `@<${this.__userId}>`;
    return { element };
  }

  static importDOM(): DOMConversionMap | null {
    return {
      span: (domNode: HTMLElement) => {
        if (!domNode.hasAttribute("data-lexical-mention")) {
          return null;
        }
        return {
          conversion: (element: HTMLElement) => {
            const userId = element.getAttribute("data-user-id");
            const displayName =
              element.getAttribute("data-mention-display-name") || "User";
            if (!userId) {
              return null;
            }
            const node = $createMentionNode(userId, displayName);
            return { node };
          },
          priority: 1,
        };
      },
    };
  }

  static importJSON(serializedNode: SerializedMentionNode): MentionNode {
    const node = $createMentionNode(
      serializedNode.userId,
      serializedNode.displayName,
    );
    node.setTextContent(serializedNode.text);
    node.setFormat(serializedNode.format);
    node.setDetail(serializedNode.detail);
    node.setMode(serializedNode.mode);
    node.setStyle(serializedNode.style);
    return node;
  }

  exportJSON(): SerializedMentionNode {
    return {
      ...super.exportJSON(),
      type: "mention",
      userId: this.__userId,
      displayName: this.__displayName,
    };
  }

  isTextEntity(): true {
    return true;
  }

  canInsertTextBefore(): boolean {
    return false;
  }

  canInsertTextAfter(): boolean {
    return false;
  }
}

export function $createMentionNode(
  userId: string,
  displayName: string,
): MentionNode {
  const mentionNode = new MentionNode(userId, displayName);
  mentionNode.setMode("segmented").toggleDirectionless();
  return mentionNode;
}

export function $isMentionNode(
  node: LexicalNode | null | undefined,
): node is MentionNode {
  return node instanceof MentionNode;
}
