import { BadRequestException } from '@nestjs/common';
import {
  normalizeAst,
  astToPlaintext,
  plaintextToAst,
  MAX_AST_DEPTH,
  MAX_AST_NODES,
  MAX_AST_JSON_BYTES,
} from './ast.js';

describe('normalizeAst', () => {
  it('accepts a minimal Lexical root', () => {
    const ast = { root: { type: 'root', children: [] } };
    expect(normalizeAst(ast).root.children).toEqual([]);
  });

  it('rejects non-objects with BadRequestException', () => {
    expect(() => normalizeAst('<p>hi</p>')).toThrow(BadRequestException);
    expect(() => normalizeAst(null)).toThrow(BadRequestException);
    expect(() => normalizeAst(undefined)).toThrow(BadRequestException);
    // Arrays are objects in JS but not Lexical roots.
    expect(() => normalizeAst([])).toThrow(BadRequestException);
  });

  it('rejects missing root.children array', () => {
    expect(() => normalizeAst({ root: { type: 'root' } })).toThrow(
      BadRequestException,
    );
    expect(() =>
      normalizeAst({ root: { type: 'root', children: 'oops' } }),
    ).toThrow(BadRequestException);
    // root must be a plain object, not an array.
    expect(() => normalizeAst({ root: [] })).toThrow(BadRequestException);
  });

  describe('DoS guards', () => {
    it(`rejects an AST deeper than ${MAX_AST_DEPTH} levels`, () => {
      let node: Record<string, unknown> = { type: 'text', text: 'leaf' };
      for (let i = 0; i < MAX_AST_DEPTH + 5; i++) {
        node = { type: 'paragraph', children: [node] };
      }
      const ast = { root: { type: 'root', children: [node] } };
      expect(() => normalizeAst(ast)).toThrow(/depth/);
    });

    it('accepts a tree exactly at the depth limit', () => {
      let node: Record<string, unknown> = { type: 'text', text: 'leaf' };
      // root is depth 1, so children at depth 2. Build MAX_AST_DEPTH - 1
      // nested element nodes so the deepest is exactly MAX_AST_DEPTH.
      for (let i = 0; i < MAX_AST_DEPTH - 2; i++) {
        node = { type: 'paragraph', children: [node] };
      }
      const ast = { root: { type: 'root', children: [node] } };
      expect(() => normalizeAst(ast)).not.toThrow();
    });

    it(`rejects a tree with more than ${MAX_AST_NODES} nodes`, () => {
      const children = Array.from({ length: MAX_AST_NODES + 10 }, () => ({
        type: 'text',
        text: '.',
      }));
      const ast = {
        root: {
          type: 'root',
          children: [{ type: 'paragraph', children }],
        },
      };
      expect(() => normalizeAst(ast)).toThrow(/nodes/);
    });

    it(`rejects serialized AST above ${MAX_AST_JSON_BYTES} bytes`, () => {
      // Single huge text node bypasses node-count cap but trips size cap.
      const bigText = 'x'.repeat(MAX_AST_JSON_BYTES + 100);
      const ast = {
        root: {
          type: 'root',
          children: [
            { type: 'paragraph', children: [{ type: 'text', text: bigText }] },
          ],
        },
      };
      expect(() => normalizeAst(ast)).toThrow(/bytes/);
    });

    it('rejects cyclic AST instead of crashing', () => {
      // Build a self-reference — JSON.stringify throws, we should translate.
      const root: Record<string, unknown> = { type: 'root', children: [] };
      const p: Record<string, unknown> = { type: 'paragraph', children: [] };
      (root.children as unknown[]).push(p);
      (p.children as unknown[]).push(p); // cycle
      expect(() => normalizeAst({ root })).toThrow(/serializable|bytes/);
    });
  });
});

describe('astToPlaintext', () => {
  it('extracts text from paragraph', () => {
    const ast = {
      root: {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [{ type: 'text', text: 'hello' }],
          },
        ],
      },
    };
    expect(astToPlaintext(ast)).toBe('hello');
  });

  it('preserves @<userId> for mentions (matches client exportToPlainText)', () => {
    const ast = {
      root: {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              { type: 'text', text: 'hi ' },
              {
                type: 'mention',
                text: '@Alice',
                userId: '11111111-1111-1111-1111-111111111111',
                displayName: 'Alice',
              },
            ],
          },
        ],
      },
    };
    expect(astToPlaintext(ast)).toBe(
      'hi @<11111111-1111-1111-1111-111111111111>',
    );
  });

  it('separates paragraphs with newlines', () => {
    const ast = {
      root: {
        type: 'root',
        children: [
          { type: 'paragraph', children: [{ type: 'text', text: 'a' }] },
          { type: 'paragraph', children: [{ type: 'text', text: 'b' }] },
        ],
      },
    };
    expect(astToPlaintext(ast)).toBe('a\nb');
  });

  it('never surfaces HTML — script tags in text fields are just text', () => {
    const ast = {
      root: {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [{ type: 'text', text: '<script>alert(1)</script>' }],
          },
        ],
      },
    };
    // Exactly the raw string, never parsed as HTML.
    expect(astToPlaintext(ast)).toBe('<script>alert(1)</script>');
  });

  it('extracts text from Lexical code blocks (code-highlight leaves)', () => {
    // Lexical wraps code blocks as `code` elements whose children are
    // `code-highlight` nodes (TextNode subclasses) — they carry `text` but
    // have no `children`. Without explicit handling the whole block is
    // invisible to astToPlaintext, producing an empty `content` that
    // downstream gRPC validation (im-worker) rejects with INVALID_ARGUMENT
    // → HTTP 500. See: Lexical CodeHighlightNode / code-highlight plugin.
    const ast = {
      root: {
        type: 'root',
        children: [
          {
            type: 'code',
            language: 'javascript',
            children: [
              {
                type: 'code-highlight',
                text: 'const ',
                highlightType: 'keyword',
              },
              {
                type: 'code-highlight',
                text: 'x',
              },
              { type: 'linebreak' },
              {
                type: 'code-highlight',
                text: '  return x;',
              },
            ],
          },
        ],
      },
    };
    // `code` is a block-level type so the whole block is followed by a
    // trailing newline, which `trim()` strips. Inside the block, text flows
    // line-by-line with the explicit linebreak preserved.
    expect(astToPlaintext(ast)).toBe('const x\n  return x;');
  });

  it('extracts text from Lexical tab nodes (TextNode subclass without children)', () => {
    // `tab` is another TextNode subclass (TabNode) with a `text` field and
    // no children. Same failure mode as code-highlight if not handled.
    const ast = {
      root: {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              { type: 'text', text: 'before' },
              { type: 'tab', text: '\t' },
              { type: 'text', text: 'after' },
            ],
          },
        ],
      },
    };
    expect(astToPlaintext(ast)).toBe('before\tafter');
  });

  it('stops recursing at MAX_AST_DEPTH without crashing', () => {
    // Build a pathologically deep tree that would blow a naive recursive walk.
    // Even though normalizeAst would reject this at ingress, astToPlaintext
    // runs on stored data too (search indexer reads rows that may predate the
    // validation). It must not crash the worker.
    let node: Record<string, unknown> = { type: 'text', text: 'leaf' };
    for (let i = 0; i < MAX_AST_DEPTH * 4; i++) {
      node = { type: 'paragraph', children: [node] };
    }
    const ast = { root: { type: 'root', children: [node] } };
    // Returns without throwing. May or may not include "leaf" — we only care
    // that the DoS is neutralized.
    expect(() => astToPlaintext(ast)).not.toThrow();
  });
});

describe('plaintextToAst', () => {
  it('wraps a single line into one paragraph', () => {
    const ast = plaintextToAst('hi there');
    expect(ast.root.type).toBe('root');
    expect(ast.root.children).toHaveLength(1);
    const p = ast.root.children[0];
    expect(p.type).toBe('paragraph');
    expect((p.children![0] as { text: string }).text).toBe('hi there');
  });

  it('splits newlines into separate paragraphs', () => {
    const ast = plaintextToAst('a\nb\nc');
    expect(ast.root.children).toHaveLength(3);
  });

  it('yields empty paragraph for empty string', () => {
    const ast = plaintextToAst('');
    expect(ast.root.children).toHaveLength(1);
    expect(ast.root.children[0].children).toEqual([]);
  });

  it('round-trips plaintext', () => {
    const original = 'line1\nline2';
    expect(astToPlaintext(plaintextToAst(original))).toBe(original);
  });
});
