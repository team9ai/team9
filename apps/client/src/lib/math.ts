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
  const root = doc.getElementById("__root__")!;
  walk(root);
  return root.innerHTML;
}

function walk(node: Node): void {
  switch (node.nodeType) {
    case Node.ELEMENT_NODE: {
      const el = node as Element;
      if (SKIP_TAGS.has(el.tagName)) return;
      if (el.hasAttribute("data-mention-user-id")) return;
      const children = Array.from(el.childNodes);
      for (const child of children) walk(child);
      return;
    }
    case Node.TEXT_NODE:
      transformTextNode(node as Text);
      return;
  }
}

function transformTextNode(textNode: Text): void {
  const raw = textNode.data;
  if (!raw.includes("$")) return;

  const segments = parseMath(raw);
  if (segments.every((s) => s.kind === "text")) return;

  const doc = textNode.ownerDocument!;
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
 * Scan `str` once, emitting text / inline / block segments.
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
      buf += "$$";
      i += 2;
      continue;
    }

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
  if (str[openIdx - 1] === "$") return null;
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
      const prev = str[j - 1];
      if (prev === " " || prev === "\t") return null;
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
