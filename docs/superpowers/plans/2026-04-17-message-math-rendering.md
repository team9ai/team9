# Message Math Rendering (KaTeX) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render LaTeX math (`$…$` inline, `$$…$$` block) in chat messages on both Markdown and HTML (Lexical) render paths.

**Architecture:** Add KaTeX + `remark-math` + `rehype-katex` to the Markdown path; add a small DOM-walking helper `renderMathInHtml` to the HTML path. Both paths share the same KaTeX options (`throwOnError: false`, `strict: "ignore"`, `trust: false`, `output: "htmlAndMathml"`). Display-only — no editor or server changes.

**Tech Stack:** `katex` ^0.16, `remark-math` ^6, `rehype-katex` ^7, `@types/katex`, Vitest + React Testing Library (existing).

**Spec:** [docs/superpowers/specs/2026-04-17-message-math-rendering-design.md](../specs/2026-04-17-message-math-rendering-design.md)

---

## File Structure

- **`apps/client/src/lib/math.ts`** — new. Exports `renderMathInHtml(html: string): string`. Single responsibility: safely render math in an HTML string while skipping code/link/mention subtrees.
- **`apps/client/src/lib/math.test.ts`** — new. Unit tests for `renderMathInHtml` and its internal `parseMath`.
- **`apps/client/src/components/channel/MessageContent.tsx`** — modified. Wires `remarkMath`/`rehypeKatex` into the Markdown path and `renderMathInHtml` into the HTML path.
- **`apps/client/src/components/channel/__tests__/message-math.integration.test.tsx`** — new. Integration tests covering both render paths end-to-end.
- **`apps/client/src/main.tsx`** — modified. `import "katex/dist/katex.min.css"` once globally.
- **`apps/client/src/global.css`** — modified. CSS overrides for `.katex` font-size, `.math-block` block display, `.katex-display` margins.
- **`apps/client/package.json`** — modified. New deps.

---

### Task 0: Install dependencies and wire global CSS

**Goal:** Add KaTeX and friends to the client package, import the KaTeX stylesheet, and add the small CSS overrides.

**Files:**

- Modify: `apps/client/package.json`
- Modify: `apps/client/src/main.tsx`
- Modify: `apps/client/src/global.css`

**Acceptance Criteria:**

- [ ] `katex`, `remark-math`, `rehype-katex` listed in `dependencies`; `@types/katex` in `devDependencies`.
- [ ] `apps/client/src/main.tsx` imports `katex/dist/katex.min.css` after `./global.css`.
- [ ] `apps/client/src/global.css` contains overrides: `.katex { font-size: 1em; }`, `.math-block { display: block; margin: 0.25em 0; }`, `.katex-display { margin: 0.25em 0; }`.
- [ ] `pnpm -C apps/client typecheck` passes.
- [ ] `pnpm -C apps/client build` succeeds.

**Verify:** `pnpm -C apps/client typecheck && pnpm -C apps/client build` → both exit 0, build output mentions a katex chunk (or inlined in main).

**Steps:**

- [ ] **Step 1: Install deps**

Run from repo root:

```bash
pnpm --filter @team9/client add katex@^0.16 remark-math@^6 rehype-katex@^7
pnpm --filter @team9/client add -D @types/katex
```

Expected: `apps/client/package.json` updated, `pnpm-lock.yaml` updated. No install errors.

- [ ] **Step 2: Import KaTeX CSS globally**

Edit `apps/client/src/main.tsx` — add the import right after the existing `./global.css` line:

```tsx
import "./global.css";
import "katex/dist/katex.min.css";
import "./i18n";
```

- [ ] **Step 3: Append CSS overrides to `apps/client/src/global.css`**

Append at the end of the file:

```css
/* KaTeX overrides for chat messages */
.katex {
  font-size: 1em;
}
.math-block {
  display: block;
  margin: 0.25em 0;
}
.katex-display {
  margin: 0.25em 0;
}
```

- [ ] **Step 4: Typecheck and build**

```bash
pnpm -C apps/client typecheck
pnpm -C apps/client build
```

Expected: both exit 0. If typecheck errors on missing module types for `katex`, verify `@types/katex` was installed.

- [ ] **Step 5: Commit**

```bash
git add apps/client/package.json apps/client/pnpm-lock.yaml apps/client/src/main.tsx apps/client/src/global.css pnpm-lock.yaml
git commit -m "chore(client): add katex + remark-math + rehype-katex deps"
```

If `pnpm-lock.yaml` is workspace-root, adjust the path accordingly — include whichever lockfile(s) changed.

---

### Task 1: Implement `renderMathInHtml` with unit tests (TDD)

**Goal:** Pure function that takes an HTML string and returns the same HTML with math delimiters rendered via KaTeX, skipping `<code>`, `<pre>`, `<a>`, `<script>`, `<style>`, and any element with `data-mention-user-id`.

**Files:**

- Create: `apps/client/src/lib/math.ts`
- Create: `apps/client/src/lib/math.test.ts`

**Acceptance Criteria:**

- [ ] Fast path: input without `$` returned unchanged (reference-equal).
- [ ] Inline math `$x+y$` produces `<span class="katex">` output.
- [ ] Block math `$$…$$` produces `<span class="math-block">` with `.katex-display` inside, rendered via `displayMode: true`.
- [ ] Math inside `<code>`, `<pre>`, `<a>`, `<script>`, `<style>`, or `[data-mention-user-id]` is left as literal text.
- [ ] All "Bad / boundary" cases from the spec leave text as literal: `"$5 for lunch, $10 for dinner"`, `"$ hello$"`, `"$hello $"`, `"\\$100"`, empty `$ $` / `$$ $$`, inline with newline `"$a\nb$"`.
- [ ] Invalid LaTeX returns a `.katex-error` span; function does not throw.
- [ ] Security: `$\href{javascript:alert(1)}{x}$` produces no `href="javascript:"` in output.
- [ ] 100% line+branch coverage on `math.ts`.

**Verify:** `pnpm -C apps/client test src/lib/math.test.ts` → all tests pass. `pnpm -C apps/client test:cov -- src/lib/math.test.ts` → `math.ts` line and branch coverage = 100%.

**Steps:**

- [ ] **Step 1: Write the failing test file `apps/client/src/lib/math.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { renderMathInHtml } from "./math";

describe("renderMathInHtml — fast path", () => {
  it("returns input unchanged when no $ is present", () => {
    const html = "<p>hello <strong>world</strong></p>";
    expect(renderMathInHtml(html)).toBe(html);
  });
});

describe("renderMathInHtml — inline math", () => {
  it("renders inline $x+y$ as KaTeX", () => {
    const out = renderMathInHtml("<p>see $x+y$ here</p>");
    expect(out).toContain('class="katex"');
    expect(out).toContain("x");
    expect(out).toContain("y");
    // Delimiters should not appear in the rendered output
    expect(out).not.toContain("$x+y$");
  });

  it("preserves text order with multiple inline formulas", () => {
    const out = renderMathInHtml("<p>a $x$ b $y$ c</p>");
    const xIdx = out.indexOf(">x<");
    const yIdx = out.indexOf(">y<");
    expect(xIdx).toBeGreaterThan(-1);
    expect(yIdx).toBeGreaterThan(xIdx);
    expect(out.indexOf("a ")).toBeLessThan(xIdx);
    expect(out.indexOf("c")).toBeGreaterThan(yIdx);
  });
});

describe("renderMathInHtml — block math", () => {
  it("renders $$…$$ in a math-block span with katex-display", () => {
    const out = renderMathInHtml(
      "<p>$$\\sum_{k=1}^{n} k^3 = \\left(\\frac{n(n+1)}{2}\\right)^2$$</p>",
    );
    expect(out).toContain('class="math-block"');
    expect(out).toContain("katex-display");
  });

  it("renders the spec screenshot content (inline + block mixed)", () => {
    const html =
      "<p>左边：$\\sum_{k=1}^{1} k^3 = 1^3 = 1$</p>" +
      "<p>$$\\sum_{k=1}^{m+1} k^3 = \\sum_{k=1}^{m} k^3 + (m+1)^3$$</p>";
    const out = renderMathInHtml(html);
    expect(out).toContain('class="katex"');
    expect(out).toContain("katex-display");
    expect(out).not.toContain("$\\sum");
  });
});

describe("renderMathInHtml — skipped subtrees", () => {
  it("leaves math inside <code> as literal", () => {
    const html = "<p><code>use $PATH and $HOME</code></p>";
    expect(renderMathInHtml(html)).toBe(html);
  });

  it("leaves math inside <pre> as literal", () => {
    const html = "<pre>let x = $y + 1$</pre>";
    expect(renderMathInHtml(html)).toBe(html);
  });

  it("leaves math inside <a> as literal", () => {
    const html = '<p><a href="http://x">$x$</a></p>';
    expect(renderMathInHtml(html)).toBe(html);
  });

  it("leaves math inside <script> and <style> as literal", () => {
    const script = "<script>var a = $x$;</script>";
    const style = "<style>.a{content:'$x$'}</style>";
    expect(renderMathInHtml(script)).toBe(script);
    expect(renderMathInHtml(style)).toBe(style);
  });

  it("leaves math inside a mention span as literal", () => {
    const html =
      '<p><span class="mention-tag" data-mention-user-id="u1" data-mention-display-name="Alice">@Alice $x$</span></p>';
    expect(renderMathInHtml(html)).toBe(html);
  });

  it("skips nested: math inside <strong> inside <code>", () => {
    const html = "<p><code><strong>$x$</strong></code></p>";
    expect(renderMathInHtml(html)).toBe(html);
  });
});

describe("renderMathInHtml — bad / boundary cases (plain text)", () => {
  it("does not render '$5 for lunch, $10 for dinner'", () => {
    const html = "<p>$5 for lunch, $10 for dinner</p>";
    expect(renderMathInHtml(html)).toBe(html);
  });

  it("does not render space-adjacent '$ hello$' / '$hello $'", () => {
    const html1 = "<p>$ hello$</p>";
    const html2 = "<p>$hello $</p>";
    expect(renderMathInHtml(html1)).toBe(html1);
    expect(renderMathInHtml(html2)).toBe(html2);
  });

  it("treats \\$ as a literal escape", () => {
    const html = "<p>\\$100</p>";
    const out = renderMathInHtml(html);
    expect(out).not.toContain('class="katex"');
    // The literal $100 should remain (backslash may or may not be stripped; just make sure no math)
    expect(out).toContain("$100");
  });

  it("does not render empty $ $ or $$ $$", () => {
    expect(renderMathInHtml("<p>$ $</p>")).toBe("<p>$ $</p>");
    expect(renderMathInHtml("<p>$$ $$</p>")).toBe("<p>$$ $$</p>");
  });

  it("does not render inline math that spans a newline", () => {
    const html = "<p>$a\nb$</p>";
    expect(renderMathInHtml(html)).toBe(html);
  });
});

describe("renderMathInHtml — error path", () => {
  it("renders invalid LaTeX as .katex-error without throwing", () => {
    const run = () => renderMathInHtml("<p>$\\frac{1}{$</p>");
    expect(run).not.toThrow();
    expect(run()).toContain("katex-error");
  });

  it("blocks \\href with javascript: URL (trust: false)", () => {
    const out = renderMathInHtml("<p>$\\href{javascript:alert(1)}{x}$</p>");
    expect(out).not.toContain('href="javascript:');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/client test src/lib/math.test.ts`

Expected: FAIL — module `./math` does not exist.

- [ ] **Step 3: Implement `apps/client/src/lib/math.ts`**

```ts
import katex from "katex";

type Segment =
  | { kind: "text"; value: string }
  | { kind: "inline"; latex: string }
  | { kind: "block"; latex: string };

const SKIP_TAGS = new Set(["CODE", "PRE", "A", "SCRIPT", "STYLE"]);

const KATEX_OPTIONS = {
  throwOnError: false,
  strict: "ignore" as const,
  output: "htmlAndMathml" as const,
  trust: false,
};

export function renderMathInHtml(html: string): string {
  if (!html.includes("$")) return html;

  const doc = new DOMParser().parseFromString(
    `<div id="__root__">${html}</div>`,
    "text/html",
  );
  const root = doc.getElementById("__root__");
  if (!root) return html;

  walk(root);
  return root.innerHTML;
}

function walk(node: Node): void {
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as Element;
    if (SKIP_TAGS.has(el.tagName)) return;
    if (el.hasAttribute("data-mention-user-id")) return;
    // Snapshot children because we may replace text nodes while iterating
    const children = Array.from(el.childNodes);
    for (const child of children) walk(child);
    return;
  }
  if (node.nodeType === Node.TEXT_NODE) {
    transformTextNode(node as Text);
  }
}

function transformTextNode(textNode: Text): void {
  const raw = textNode.nodeValue ?? "";
  if (!raw.includes("$")) return;

  const segments = parseMath(raw);
  if (segments.every((s) => s.kind === "text")) return;

  const doc = textNode.ownerDocument;
  if (!doc) return;
  const frag = doc.createDocumentFragment();

  for (const seg of segments) {
    if (seg.kind === "text") {
      frag.appendChild(doc.createTextNode(seg.value));
      continue;
    }
    const rendered = katex.renderToString(seg.latex, {
      ...KATEX_OPTIONS,
      displayMode: seg.kind === "block",
    });
    const wrapper = doc.createElement("span");
    if (seg.kind === "block") wrapper.className = "math-block";
    wrapper.innerHTML = rendered;
    frag.appendChild(wrapper);
  }

  textNode.replaceWith(frag);
}

/**
 * Scan `str` once, left-to-right, emitting text / inline / block segments.
 * Rules mirror remark-math / Pandoc:
 *   - `\$` is an escape (emitted as literal `$`).
 *   - `$$ … $$` is block (non-greedy; may span newlines).
 *   - `$ … $` is inline when all hold:
 *       opening $ not preceded by `\` or `$`,
 *       non-space char immediately after opening $,
 *       non-space char immediately before closing $,
 *       char immediately after closing $ is not a digit,
 *       no newline inside.
 */
export function parseMath(str: string): Segment[] {
  const out: Segment[] = [];
  let buf = "";
  let i = 0;
  const n = str.length;

  const flush = () => {
    if (buf.length) {
      out.push({ kind: "text", value: buf });
      buf = "";
    }
  };

  while (i < n) {
    const ch = str[i];

    // Escape: \$
    if (ch === "\\" && str[i + 1] === "$") {
      buf += "$";
      i += 2;
      continue;
    }

    if (ch !== "$") {
      buf += ch;
      i += 1;
      continue;
    }

    // Block: $$ … $$
    if (str[i + 1] === "$") {
      const close = findBlockClose(str, i + 2);
      if (close !== -1) {
        const latex = str.slice(i + 2, close);
        if (latex.trim().length > 0) {
          flush();
          out.push({ kind: "block", latex });
          i = close + 2;
          continue;
        }
      }
      // No matching close or empty → literal
      buf += "$$";
      i += 2;
      continue;
    }

    // Inline: $ … $
    const inline = tryInline(str, i);
    if (inline) {
      flush();
      out.push({ kind: "inline", latex: inline.latex });
      i = inline.end;
      continue;
    }

    buf += "$";
    i += 1;
  }

  flush();
  return out;
}

function findBlockClose(str: string, from: number): number {
  let j = from;
  while (j < str.length - 1) {
    if (str[j] === "\\" && str[j + 1] === "$") {
      j += 2;
      continue;
    }
    if (str[j] === "$" && str[j + 1] === "$") return j;
    j += 1;
  }
  return -1;
}

function tryInline(
  str: string,
  openIdx: number,
): { latex: string; end: number } | null {
  // Opening $ must not be preceded by another $ (prev iteration handles \$ already)
  if (str[openIdx - 1] === "$") return null;
  // Non-space after opening
  const next = str[openIdx + 1];
  if (next === undefined || next === " " || next === "\t" || next === "\n")
    return null;

  let j = openIdx + 1;
  while (j < str.length) {
    const c = str[j];
    if (c === "\n") return null;
    if (c === "\\" && str[j + 1] === "$") {
      j += 2;
      continue;
    }
    if (c === "$") {
      // Non-space before closing
      const prev = str[j - 1];
      if (prev === " " || prev === "\t") return null;
      // Next char must not be a digit
      const after = str[j + 1];
      if (after !== undefined && after >= "0" && after <= "9") return null;
      const latex = str.slice(openIdx + 1, j);
      if (latex.trim().length === 0) return null;
      return { latex, end: j + 1 };
    }
    j += 1;
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -C apps/client test src/lib/math.test.ts`

Expected: all tests pass.

If a specific test fails, re-read the failing assertion in `math.test.ts` against the `parseMath` logic. Common issues:

- Block case: ensure `findBlockClose` ignores escaped `\$`.
- Inline digit-after rule: check `after >= "0" && after <= "9"` covers both `$10` and `$5...`.

- [ ] **Step 5: Check coverage**

Run: `pnpm -C apps/client test:cov -- src/lib/math.test.ts`

Expected: `math.ts` shows 100% line and branch coverage. If any branch is uncovered, add a test for it (do not delete the branch).

- [ ] **Step 6: Commit**

```bash
git add apps/client/src/lib/math.ts apps/client/src/lib/math.test.ts
git commit -m "feat(client/lib): renderMathInHtml helper with KaTeX"
```

---

### Task 2: Wire `remark-math` + `rehype-katex` into the Markdown path

**Goal:** `MarkdownMessageContent` renders LaTeX via `remark-math` + `rehype-katex` with our shared KaTeX options.

**Files:**

- Modify: `apps/client/src/components/channel/MessageContent.tsx:285-321`

**Acceptance Criteria:**

- [ ] `ReactMarkdown` receives `remarkMath` (after `remarkGfm`) and `[rehypeKatex, { throwOnError: false, strict: "ignore", output: "htmlAndMathml", trust: false }]`.
- [ ] All existing Markdown-path tests still pass.

**Verify:** `pnpm -C apps/client test src/components/channel/__tests__` → passes (no regressions). Manual: render a bot message containing `$\sum k$` — see KaTeX output in DOM.

**Steps:**

- [ ] **Step 1: Add imports near the top of `apps/client/src/components/channel/MessageContent.tsx`**

Find the existing imports block starting at [MessageContent.tsx:13](apps/client/src/components/channel/MessageContent.tsx#L13). Add after `remarkGfm`:

```tsx
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
```

- [ ] **Step 2: Update the `ReactMarkdown` call in `MarkdownMessageContent` ([MessageContent.tsx:285](apps/client/src/components/channel/MessageContent.tsx#L285))**

Replace:

```tsx
<ReactMarkdown
  remarkPlugins={[remarkGfm]}
  components={{
    code: MarkdownCodeRenderer,
    ...
  }}
>
  {content}
</ReactMarkdown>
```

With:

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
  components={{
    code: MarkdownCodeRenderer,
    // ...keep all existing component overrides unchanged
  }}
>
  {content}
</ReactMarkdown>
```

Keep the `components.code`, `a`, `img`, `p` overrides exactly as they were.

- [ ] **Step 3: Run existing channel tests to confirm no regressions**

```bash
pnpm -C apps/client test src/components/channel/__tests__
```

Expected: all existing tests pass.

- [ ] **Step 4: Typecheck**

```bash
pnpm -C apps/client typecheck
```

Expected: exit 0. If `rehype-katex` options type complains, cast the options object with `as const` on `strict` and `output` literals (or import the plugin's types).

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/components/channel/MessageContent.tsx
git commit -m "feat(client): render KaTeX math in Markdown-path messages"
```

---

### Task 3: Wire `renderMathInHtml` into the HTML (Lexical) path

**Goal:** `HtmlMessageContent` renders LaTeX math after code blocks are highlighted and before links are auto-linkified.

**Files:**

- Modify: `apps/client/src/components/channel/MessageContent.tsx:105-141`

**Acceptance Criteria:**

- [ ] `HtmlMessageContent.processedContent` applies `renderMathInHtml` between code-block highlighting and `linkifyHtml`.
- [ ] All existing HTML-path tests still pass.

**Verify:** `pnpm -C apps/client test src/components/channel/__tests__` → passes. Manual: render a Lexical HTML message containing `$\sum k$` — see KaTeX output.

**Steps:**

- [ ] **Step 1: Add import in `apps/client/src/components/channel/MessageContent.tsx`**

Near the other `@/lib/*` imports (currently `import Prism from "@/lib/prism";` at [MessageContent.tsx:16](apps/client/src/components/channel/MessageContent.tsx#L16)), add:

```tsx
import Prism from "@/lib/prism";
import { renderMathInHtml } from "@/lib/math";
```

- [ ] **Step 2: Update `processedContent` in `HtmlMessageContent` ([MessageContent.tsx:105](apps/client/src/components/channel/MessageContent.tsx#L105))**

Inside the `useMemo(() => { ... }, [content])` body, after the existing code-block highlighting block (`html = html.replace(/<pre><code class="language-([^"]*)">…/…)`) and **before** the `linkifyHtml` call, insert:

```tsx
// Render LaTeX math. Must run after code-block highlighting (so $ inside
// <code>/<pre> is safely nested and skipped) and before linkifyHtml (so
// URLs inside a formula aren't wrapped in <a>).
html = renderMathInHtml(html);

html = linkifyHtml(html, {
  target: "_blank",
  rel: "noopener noreferrer",
  className: "message-link",
});
```

- [ ] **Step 3: Run existing channel tests to confirm no regressions**

```bash
pnpm -C apps/client test src/components/channel/__tests__
```

Expected: all existing tests pass.

- [ ] **Step 4: Typecheck**

```bash
pnpm -C apps/client typecheck
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/components/channel/MessageContent.tsx
git commit -m "feat(client): render KaTeX math in HTML-path messages"
```

---

### Task 4: Integration tests across both render paths

**Goal:** End-to-end coverage that exercises `MessageContent` (Markdown + HTML paths) with math alongside code blocks and mentions.

**Files:**

- Create: `apps/client/src/components/channel/__tests__/message-math.integration.test.tsx`

**Acceptance Criteria:**

- [ ] Bot-style Markdown message with `$\sum k$` renders a `.katex` node.
- [ ] Lexical HTML message with inline **and** block math renders both — `.katex` and `.katex-display` both present.
- [ ] A message combining a fenced code block, an inline mention, and inline math renders each correctly: code block intact, mention span has `data-mention-user-id`, math rendered.
- [ ] Screenshot-style content (sums/fractions/exponents) renders without error.

**Verify:** `pnpm -C apps/client test src/components/channel/__tests__/message-math.integration.test.tsx` → all pass.

**Steps:**

- [ ] **Step 1: Check how existing integration tests mount `MessageContent`**

Look at [tracking-ux-integration.test.tsx](apps/client/src/components/channel/__tests__/tracking-ux-integration.test.tsx) to copy the test harness (QueryClient provider, Router wrapper if needed, mocks for `useCreateDirectChannel` / `useFullContent`).

Reuse the same providers and mock patterns.

- [ ] **Step 2: Create `apps/client/src/components/channel/__tests__/message-math.integration.test.tsx`**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MessageContent } from "../MessageContent";

// Mock router + hooks used by MessageContent
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));
vi.mock("@/hooks/useMessages", () => ({
  useFullContent: () => ({ data: undefined }),
}));
vi.mock("@/hooks/useChannels", () => ({
  useCreateDirectChannel: () => ({ mutateAsync: vi.fn() }),
}));

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("MessageContent — math integration", () => {
  it("renders math in a Markdown (bot) message", () => {
    const { container } = renderWithProviders(
      <MessageContent content={"See $\\sum_{k=1}^{n} k$ below."} />,
    );
    expect(container.querySelector(".katex")).not.toBeNull();
  });

  it("renders inline and block math in a Lexical HTML message", () => {
    const html =
      "<p>左边：$\\sum_{k=1}^{1} k^3 = 1^3 = 1$</p>" +
      "<p>$$\\sum_{k=1}^{m+1} k^3 = \\sum_{k=1}^{m} k^3 + (m+1)^3$$</p>";
    const { container } = renderWithProviders(
      <MessageContent content={html} />,
    );
    expect(container.querySelector(".katex")).not.toBeNull();
    expect(container.querySelector(".katex-display")).not.toBeNull();
    expect(container.querySelector(".math-block")).not.toBeNull();
  });

  it("preserves code block and mention while rendering adjacent math", () => {
    const html =
      '<p><span class="mention-tag" data-mention-user-id="u1" data-mention-display-name="Alice">@Alice</span></p>' +
      '<pre><code class="language-js">const a = $x$;</code></pre>' +
      "<p>and $y+1$ here</p>";
    const { container } = renderWithProviders(
      <MessageContent content={html} />,
    );
    // Mention preserved
    expect(
      container.querySelector("[data-mention-user-id='u1']"),
    ).not.toBeNull();
    // Code block intact — math inside NOT rendered
    const code = container.querySelector("pre code");
    expect(code?.textContent).toContain("$x$");
    // Math outside code is rendered
    expect(container.querySelector(".katex")).not.toBeNull();
  });

  it("renders the spec screenshot content end-to-end (HTML path)", () => {
    const html =
      "<p>📌 <strong>题目</strong></p>" +
      "<p>$$\\sum_{k=1}^{n} k^3 = \\left(\\frac{n(n+1)}{2}\\right)^2$$</p>" +
      "<p>左边：$\\sum_{k=1}^{1} k^3 = 1^3 = 1$</p>" +
      "<p>右边：$\\left(\\frac{1 \\cdot 2}{2}\\right)^2 = 1^2 = 1$</p>";
    const { container } = renderWithProviders(
      <MessageContent content={html} />,
    );
    expect(container.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(
      3,
    );
    expect(container.querySelector(".katex-display")).not.toBeNull();
  });
});
```

- [ ] **Step 3: Run the integration tests**

```bash
pnpm -C apps/client test src/components/channel/__tests__/message-math.integration.test.tsx
```

Expected: all tests pass.

If a mocked hook is missing and breaks `MessageContent` rendering, copy the corresponding mock from `tracking-ux-integration.test.tsx` or `MessageList.test.tsx`.

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/components/channel/__tests__/message-math.integration.test.tsx
git commit -m "test(client): integration tests for message math rendering"
```

---

### Task 5: Final verification — full suite, coverage, lint, typecheck, build, manual

**Goal:** Confirm no regressions anywhere and sanity-check the feature in the browser.

**Files:** (none — verification only)

**Acceptance Criteria:**

- [ ] Full client test suite green.
- [ ] Lint clean (project has lint-staged + ESLint).
- [ ] Typecheck clean.
- [ ] Build succeeds.
- [ ] Manual: in `pnpm dev:client`, a message with `$\sum_{k=1}^{n} k^3 = \left(\frac{n(n+1)}{2}\right)^2$` and a `$$…$$` block both render visibly as formulas, selecting the rendered math and copying it yields the original `\sum…` source, and `"$5 vs $10"` in a message stays as plain text.

**Verify:** See commands in steps.

**Steps:**

- [ ] **Step 1: Run full client test suite**

```bash
pnpm -C apps/client test
```

Expected: all tests pass.

- [ ] **Step 2: Coverage check**

```bash
pnpm -C apps/client test:cov
```

Expected: `apps/client/src/lib/math.ts` at 100% line + branch coverage.

- [ ] **Step 3: Lint and typecheck**

```bash
pnpm -C apps/client lint:ci
pnpm -C apps/client typecheck
```

Expected: both exit 0.

- [ ] **Step 4: Production build**

```bash
pnpm -C apps/client build
```

Expected: exit 0. Check build output for KaTeX CSS/font assets.

- [ ] **Step 5: Manual browser check**

```bash
pnpm dev:client
```

Then in the running app:

1. Open a direct channel.
2. Send a message containing the screenshot content (copy the three `$…$` / `$$…$$` formulas).
3. Confirm the formulas render as math (not `$…$` literals).
4. Select the rendered math, copy, paste into a plain text field → original LaTeX source appears.
5. Send `"$5 for lunch, $10 for dinner"` → it stays as plain text.
6. Send a fenced code block containing `$PATH` → code block is untouched.

If anything in the manual check fails, go back to the relevant task rather than patching here.

- [ ] **Step 6: Final commit (if any tooling-only changes accumulated)**

If Steps 1–5 produced any file changes (formatting, lockfile drift), commit them:

```bash
git status
# If anything to commit:
git add -A
git commit -m "chore(client): tidy after math rendering rollout"
```

Otherwise skip.

---

## Self-Review Checklist

Before handing off:

- **Spec coverage:** every spec section (library choice, delimiters, architecture, error handling, edge cases, testing) maps to a task. ✓
- **Placeholders:** no "TBD", "handle edge cases", or vague steps. ✓
- **Type/name consistency:** `renderMathInHtml` used identically in math.ts (export), math.test.ts (import), MessageContent.tsx (import + call), integration test (imported via MessageContent). `parseMath` only referenced internally. ✓
- **KaTeX options match spec:** `throwOnError: false`, `strict: "ignore"`, `output: "htmlAndMathml"`, `trust: false` — same object in both `KATEX_OPTIONS` (math.ts) and `rehypeKatex` config (MessageContent.tsx). ✓
