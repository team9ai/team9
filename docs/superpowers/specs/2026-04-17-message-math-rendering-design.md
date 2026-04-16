# Message Math Rendering (KaTeX) — Design

**Date:** 2026-04-17
**Scope:** `apps/client` (web + Tauri desktop)
**Status:** Approved — ready for implementation plan

## Goal

Render LaTeX math formulas (`$…$` inline, `$$…$$` block) inside chat messages. Display-only: no editor input changes, no server changes.

Both message render paths must work identically so users don't notice which source a message came from:

- **Markdown path** — `MarkdownMessageContent` (bot / API / generated messages)
- **HTML path** — `HtmlMessageContent` (user-composed messages from the Lexical editor)

## Non-goals

- No changes to the Lexical editor (no live preview, no math node, no toolbar).
- No changes to the server, storage, or wire format. Math lives as plain `$…$` text in the stored message content.
- No lazy-loading of the KaTeX bundle for v1.

## Library choice

**KaTeX** + `remark-math` + `rehype-katex`. Rationale:

- Fast synchronous render, no layout shift (important for a virtualized message list).
- Small enough bundle (~290 KB JS + ~180 KB fonts) for the current web/desktop target.
- Covers all math in realistic chat content (sums, fractions, matrices, exponents, integrals).
- Battle-tested in Notion / Discord / GitHub chat surfaces.

MathJax was rejected on bundle + async-render grounds. A common-AST refactor of both paths was rejected as out-of-scope (YAGNI).

## Delimiters

Mirror Pandoc / `remark-math` defaults:

- **Block:** `$$ … $$` — non-greedy, may span lines.
- **Inline:** `$ … $` under strict rules:
  - Opening `$` not preceded by `\` or another `$`.
  - Non-space character immediately after opening `$`.
  - Non-space character immediately before closing `$`.
  - Character immediately after closing `$` is not a digit.
  - No newline inside.
- Literal `\$` is an escape and contributes nothing.

This set avoids the `"$5 for lunch, $10 for dinner"` false positive while supporting the screenshot's content (`$\sum_{k=1}^{n} k^3$`, `$$…$$` on its own line).

`\(…\)` / `\[…\]` delimiters are enabled for free via `remark-math` on the Markdown path; on the HTML path they're not implemented in v1 (can be added later; no current need).

## Architecture

### Dependencies

Added to `apps/client/package.json`:

- `katex` ^0.16
- `remark-math` ^6
- `rehype-katex` ^7
- `@types/katex` (dev)

### Files

- **`apps/client/src/main.tsx`** — add `import "katex/dist/katex.min.css"`.
- **`apps/client/src/lib/math.ts`** — new helper; exports `renderMathInHtml(html: string): string`.
- **`apps/client/src/lib/math.test.ts`** — new unit tests.
- **`apps/client/src/components/channel/MessageContent.tsx`**:
  - Markdown path: add `remarkMath` to `remarkPlugins`, add `rehypeKatex` to `rehypePlugins` with KaTeX options.
  - HTML path: insert `renderMathInHtml` into the `processedContent` pipeline between code-block highlighting and `linkifyHtml`.
- **`apps/client/src/components/channel/__tests__/message-math.integration.test.tsx`** — new integration tests.
- **CSS** — overrides added alongside existing message content styles: `.katex { font-size: 1em; }` (default 1.21em is too large in chat); `.math-block { display: block; margin: 0.25em 0; }` (HTML-path block wrapper); trim `.katex-display` margins to match paragraph spacing. Placed alongside existing message content styles.

### Markdown path wiring

```tsx
<ReactMarkdown
  remarkPlugins={[remarkGfm, remarkMath]}
  rehypePlugins={[
    [
      rehypeKatex,
      {
        throwOnError: false,
        strict: "ignore",
        output: "htmlAndMathml",
        trust: false,
      },
    ],
  ]}
  components={{ ...existing }}
>
  {content}
</ReactMarkdown>
```

No other changes. `components.code` stays as-is; `remark-math` skips `code` nodes so fenced-block math syntax is untouched.

### HTML path wiring

Existing pipeline in `HtmlMessageContent.processedContent`:

```
1. Replace <mention> tags  →  <span class="mention-tag" data-mention-user-id="…">
2. Backward-compat @<userId>  →  <span class="mention-tag">
3. Highlight <pre><code class="language-…">  →  <div class="code-block-wrapper">…</div>
4. linkifyHtml
```

New order (single insertion):

```
1. Replace <mention> tags
2. Backward-compat @<userId>
3. Highlight code blocks
4. ➕ renderMathInHtml   ← NEW
5. linkifyHtml
```

Inserted after step 3 so `$` inside `<code>`/`<pre>` is already nested and safely skipped. Inserted before step 4 so `linkifyHtml` doesn't mangle URLs that legitimately appear inside a formula.

### `renderMathInHtml` algorithm

```
renderMathInHtml(html):
  if html does not contain '$': return html   // fast path
  doc = DOMParser().parseFromString('<div>' + html + '</div>', 'text/html')
  root = doc.body.firstElementChild
  walk(root)
  return root.innerHTML

walk(node):
  if node is ELEMENT:
    if tag ∈ {CODE, PRE, A, SCRIPT, STYLE}:          return
    if node has attribute data-mention-user-id:       return
    for each child of node (snapshot first):
      walk(child)
    return
  if node is TEXT:
    transformTextNode(node)

transformTextNode(textNode):
  segments = parseMath(textNode.nodeValue)
  if segments contains only plain text: return
  frag = new DocumentFragment
  for seg in segments:
    if seg.kind == 'text':
      frag.append(textNode(seg.value))
    else:
      span = <span class="math-block"> if seg.kind == 'block' else <span>
      span.innerHTML = katex.renderToString(seg.latex, {
        displayMode: seg.kind == 'block',
        throwOnError: false,
        strict: 'ignore',
        output: 'htmlAndMathml',
        trust: false,
      })
      frag.append(span)
  textNode.replaceWith(frag)

parseMath(str):
  // Scanner walking str once.
  // Recognizes in order: \$ escape, $$…$$ block, $…$ inline per strict rules above.
  // Returns list of { kind: 'text' | 'inline' | 'block', value | latex }.
```

Why DOM walk and not regex on raw HTML: regex miscounts `<code>` boundaries, breaks on nested tags, and produces malformed output when math spans tag boundaries. `DOMParser` is available in both the browser and the Tauri webview.

## Error handling & security

- **`throwOnError: false`** — bad LaTeX renders as `.katex-error` span showing the source in red. Never crashes the virtualized list.
- **`trust: false`** — blocks `\href`, `\url`, `\includegraphics`, `\htmlData`, `\htmlClass`, and the other known LaTeX → XSS vectors.
- **`strict: "ignore"`** — silences per-message warnings; no console spam.
- **`output: "htmlAndMathml"`** — accessibility + copy-paste fidelity (see below).

No user-provided HTML reaches KaTeX; we only hand it LaTeX source strings, which it escapes in its own output.

## Edge cases (explicitly handled)

| Input                             | Behavior                                                                  |
| --------------------------------- | ------------------------------------------------------------------------- |
| `"$5 for lunch, $10 for dinner"`  | Plain text (digit-after rule).                                            |
| ``"use `$PATH` env var"``         | Plain text (inside `<code>`).                                             |
| `"https://example.com/$id"`       | Plain text (no closing `$`).                                              |
| Math inside `<a>`                 | Plain text (skipped subtree).                                             |
| Math inside mention span          | Plain text (skipped subtree).                                             |
| `"$ foo$"` / `"$foo $"`           | Plain text (space-adjacent rule).                                         |
| `"\\$100"`                        | Literal `$100` (escape).                                                  |
| Empty `$ $` / `$$ $$`             | Plain text.                                                               |
| Invalid LaTeX `$\frac{1}{$`       | `.katex-error` span; no throw.                                            |
| `$\href{javascript:alert(1)}{x}$` | Error span or inert; no `href="javascript:"` in output.                   |
| Multi-line inline `$a\nb$`        | Plain text (newline rule).                                                |
| Very long formula                 | Rendered; no artificial length cap (upstream message-size limit applies). |

## Selection, copy, dark mode, font

- **Copy/paste:** `htmlAndMathml` output embeds `<annotation encoding="application/x-tex">` — copying rendered math yields the original LaTeX source.
- **Dark mode:** KaTeX inherits `color` from its parent; existing dark-mode rules apply.
- **Font size:** override `.katex { font-size: 1em; }` so formulas match surrounding message text. Block-math margin trimmed to match paragraph spacing.

## Streaming messages

`StreamingMessageItem.tsx` already routes through `MessageContent` for final rendering. During implementation, confirm that the streaming chunk path also terminates in `MessageContent`; if it instead renders partial text in-place, document and skip math rendering for in-flight partials (rendering half of `$\frac{` would be noisy). Final committed message always goes through `MessageContent` and therefore always renders math.

## Testing plan

100% coverage on new code; happy + bad + boundary cases; unit + integration layers. Aligned with project CLAUDE.md requirements.

### Unit tests — `apps/client/src/lib/math.test.ts`

Covers `renderMathInHtml` and its internal `parseMath`.

- Fast path: string without `$` returns unchanged.
- Happy path:
  - Inline `text $x+y$ text` → output contains `<span class="katex">` with `x+y`.
  - Block `$$\sum_{k=1}^n k$$` → output contains `.katex-display` inside `<span class="math-block">` (which is CSS `display: block`).
  - Multiple formulas in one string preserve text order.
  - Exact match of the spec screenshot's content (sums / fractions / exponents).
- Skipped subtrees (delimiters preserved, no KaTeX output):
  - `<code>`, `<pre>`, `<a>`, `<script>`, `<style>`.
  - `<span data-mention-user-id="…">`.
  - Nested: math inside `<strong>` inside `<code>` is skipped.
- Bad / boundary (plain text):
  - `"$5 for lunch, $10 for dinner"`.
  - `"$ hello$"` / `"$hello $"`.
  - `"\\$100"`.
  - Empty `$ $`, `$$ $$`.
  - Newline inside inline: `"$a\nb$"`.
- Error path: invalid LaTeX returns `.katex-error` span; function does not throw.
- Security: `$\href{javascript:alert(1)}{x}$` output contains no `href="javascript:`.

### Integration tests — `apps/client/src/components/channel/__tests__/message-math.integration.test.tsx`

- Markdown message (bot) with `$\sum k$` → rendered KaTeX node in DOM.
- Lexical HTML message with inline + block math → both rendered.
- Message with fenced code block and math → code block untouched, math rendered.
- Message with mention and math → mention still has `data-mention-user-id`, math rendered.

### E2E

Not blocking. If the repo already has Playwright coverage for chat, add one case sending a math message and asserting `.katex` appears in the receiver's DOM; otherwise skip.

## Rollout

Single PR on `dev`. No feature flag (display-only, opt-in by author via `$` syntax).

## Out of scope (future)

- Lexical editor integration (math node, live preview, toolbar button).
- `\(…\)` / `\[…\]` delimiters in the HTML path (easy to add later).
- Lazy-loading the KaTeX bundle.
- Server-side pre-rendering (e.g., for notification previews).
