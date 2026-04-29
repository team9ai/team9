// Structural helpers for Lexical serialized EditorState.
//
// Design principles:
//   - The client renders AST via React elements (no dangerouslySetInnerHTML),
//     so the JSON itself is inert — attacker-controlled `text` fields become
//     React text nodes, never executed. This lets us stay permissive about
//     the internal shape (don't fight Lexical version drift).
//   - We still do structural validation at the DB boundary so we never
//     persist non-object junk or missing the `root` container.
//   - We ALWAYS compute a plaintext fallback from the AST at write time and
//     store it in `content`. Search index, preview, notifications, and old
//     clients all read `content`; new clients read `contentAst`.
//
// DoS guards: a Lexical JSON tree is attacker-controllable, so we bound
// serialized size, total node count, and nesting depth. Numbers are generous
// relative to any realistic UI but cheap to enforce.

import { BadRequestException } from '@nestjs/common';

// Hard caps for validated AST payloads. Chosen to comfortably fit any real
// composer output while bounding cost per request.
export const MAX_AST_JSON_BYTES = 200_000; // ~2× the 100K @MaxLength content cap
export const MAX_AST_NODES = 5_000;
export const MAX_AST_DEPTH = 32;

export interface AstRoot {
  root: AstElementNode;
}

export interface AstBaseNode {
  type: string;
  version?: number;
  children?: AstNode[];
  [key: string]: unknown;
}

export interface AstTextNode extends AstBaseNode {
  type: 'text';
  text: string;
  format?: number;
}

export interface AstMentionNode extends AstBaseNode {
  type: 'mention';
  text: string;
  userId: string;
  displayName: string;
  userType?: string;
}

export interface AstElementNode extends AstBaseNode {
  children: AstNode[];
}

export type AstNode =
  | AstTextNode
  | AstMentionNode
  | AstElementNode
  | AstBaseNode;

// Validate a putative AST. Throws BadRequestException when the shape is
// clearly not a Lexical EditorState, the serialized form is too large, or the
// tree exceeds node / depth caps; stays permissive about node-type details.
export function normalizeAst(input: unknown): AstRoot {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new BadRequestException('contentAst must be an object');
  }

  // Serialized-size cap. JSON.stringify on a cyclic object throws synchronously
  // — we turn that into a 400 instead of letting it crash the request.
  let serialized: string;
  try {
    serialized = JSON.stringify(input);
  } catch {
    throw new BadRequestException('contentAst is not serializable');
  }
  if (serialized.length > MAX_AST_JSON_BYTES) {
    throw new BadRequestException(
      `contentAst exceeds ${MAX_AST_JSON_BYTES} bytes`,
    );
  }

  const obj = input as Record<string, unknown>;
  const root = obj.root;
  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    throw new BadRequestException('contentAst.root must be an object');
  }
  const rootObj = root as Record<string, unknown>;
  if (!Array.isArray(rootObj.children)) {
    throw new BadRequestException('contentAst.root.children must be an array');
  }

  // Bound recursion depth and total node count in a single traversal. This
  // also catches self-referential cycles (they'd drive `seen` through the
  // node-count cap before we ever blow the stack).
  let nodeCount = 0;
  const check = (node: unknown, depth: number): void => {
    if (depth > MAX_AST_DEPTH) {
      throw new BadRequestException(
        `contentAst exceeds depth ${MAX_AST_DEPTH}`,
      );
    }
    if (!node || typeof node !== 'object') return;
    nodeCount++;
    if (nodeCount > MAX_AST_NODES) {
      throw new BadRequestException(
        `contentAst exceeds ${MAX_AST_NODES} nodes`,
      );
    }
    const children = (node as { children?: unknown }).children;
    if (Array.isArray(children)) {
      for (const child of children) check(child, depth + 1);
    }
  };
  check(root, 1);

  return { root: root as AstElementNode };
}

// Flatten any Lexical EditorState to plaintext. Used for search indexing,
// content_snapshot, preview truncation, push notifications, and as the
// stored `content` column fallback that old clients render.
//
// Bounded by MAX_AST_DEPTH so a malicious AST that slipped past
// normalizeAst() (e.g. from an older DB row) can never blow the stack.
export function astToPlaintext(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const root = (input as { root?: unknown }).root;
  if (!root || typeof root !== 'object') return '';
  const parts: string[] = [];
  walk(root as AstBaseNode, parts, 1);
  return parts.join('').trim();
}

function walk(node: AstBaseNode, out: string[], depth: number): void {
  if (depth > MAX_AST_DEPTH) return;
  const type = node.type;
  // Lexical's `code-highlight` (CodeHighlightNode) and `tab` (TabNode) are
  // TextNode subclasses with a `text` field and no children. Treat them
  // like plain text so code blocks and tabs survive plaintext extraction.
  if (type === 'text' || type === 'code-highlight' || type === 'tab') {
    const t = (node as AstTextNode).text;
    if (typeof t === 'string') out.push(t);
    return;
  }
  if (type === 'mention') {
    // Preserve @<userId> so backend mention parsing works on the plaintext
    // fallback — matches exportToPlainText behavior on the client.
    const userId = (node as AstMentionNode).userId;
    if (typeof userId === 'string' && userId) {
      out.push(`@<${userId}>`);
      return;
    }
    const display = (node as AstMentionNode).displayName;
    if (typeof display === 'string') out.push(`@${display}`);
    return;
  }
  if (type === 'linebreak') {
    out.push('\n');
    return;
  }
  const children = node.children;
  if (Array.isArray(children)) {
    for (let i = 0; i < children.length; i++) {
      walk(children[i] as AstBaseNode, out, depth + 1);
      // Block-level separation — paragraphs, list items, headings, quotes.
      if (isBlockType(type) && i < children.length - 1) {
        // no-op — block-level wrappers handle their own spacing below
      }
    }
    if (isBlockType(type)) out.push('\n');
  }
}

function isBlockType(type: string | undefined): boolean {
  return (
    type === 'paragraph' ||
    type === 'heading' ||
    type === 'quote' ||
    type === 'list' ||
    type === 'listitem' ||
    type === 'code'
  );
}

// Wrap plaintext (bot/OpenClaw/system ingress) in a minimal Lexical AST so
// new clients can always render via the AST path — eliminates the need for
// dual rendering code in hot paths.
export function plaintextToAst(text: string): AstRoot {
  const lines = text.split('\n');
  const children: AstElementNode[] = lines.map((line) => ({
    type: 'paragraph',
    version: 1,
    direction: null,
    format: '',
    indent: 0,
    children:
      line.length === 0
        ? []
        : [
            {
              type: 'text',
              version: 1,
              text: line,
              format: 0,
              detail: 0,
              mode: 'normal',
              style: '',
            } as AstTextNode,
          ],
    // Lexical requires `textFormat` and `textStyle` on paragraph at runtime on
    // some versions; leaving them absent is fine for the renderer — it reads
    // only fields it needs. Extra fields are just ignored by React.
  }));
  // If the whole string is empty, produce one empty paragraph so the
  // EditorState is still valid.
  if (children.length === 0) {
    children.push({
      type: 'paragraph',
      version: 1,
      direction: null,
      format: '',
      indent: 0,
      children: [],
    });
  }
  return {
    root: {
      type: 'root',
      version: 1,
      direction: null,
      format: '',
      indent: 0,
      children,
    },
  };
}
