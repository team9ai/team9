import { describe, it, expect } from "vitest";
import { sanitizeMessageHtml, sanitizeSearchHighlight } from "@/lib/sanitize";

// The AST path is now the primary render route, but the HTML fallback is
// still live for legacy messages, bot Markdown output, and any row written
// before the AST column was populated. These tests pin the DOMPurify
// allow-list so loosening it (or dropping the call entirely) fails CI.

describe("sanitizeMessageHtml — legacy HTML fallback", () => {
  it("strips <script> tags", () => {
    const out = sanitizeMessageHtml("<p>hi</p><script>alert(1)</script>");
    expect(out).not.toContain("<script");
    expect(out).toContain("<p>hi</p>");
  });

  it("removes on* event attributes", () => {
    const out = sanitizeMessageHtml('<p onclick="alert(1)">click</p>');
    expect(out).not.toMatch(/onclick=/i);
    expect(out).toContain(">click</p>");
  });

  it("blocks javascript: in href", () => {
    const out = sanitizeMessageHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain("javascript:");
  });

  it("strips <img onerror>", () => {
    const out = sanitizeMessageHtml('<img src=x onerror="alert(1)">');
    expect(out).not.toMatch(/onerror/i);
  });

  it("strips <iframe>", () => {
    const out = sanitizeMessageHtml('<iframe src="https://evil"></iframe>');
    expect(out).not.toContain("<iframe");
  });

  it("strips <svg onload>", () => {
    const out = sanitizeMessageHtml('<svg onload="alert(1)"></svg>');
    expect(out).not.toMatch(/onload/i);
  });

  it("keeps mention data-attrs (needed by the delegated click handler)", () => {
    const out = sanitizeMessageHtml(
      '<span class="mention-tag" data-mention-user-id="u1" data-mention-display-name="Alice">@Alice</span>',
    );
    expect(out).toContain("data-mention-user-id");
    expect(out).toContain('class="mention-tag"');
  });

  it("keeps Prism code-highlight spans", () => {
    const out = sanitizeMessageHtml(
      '<pre><code class="language-ts"><span class="token keyword">const</span></code></pre>',
    );
    expect(out).toContain("language-ts");
    expect(out).toContain("token keyword");
  });

  it("keeps KaTeX MathML output", () => {
    const out = sanitizeMessageHtml(
      '<span class="katex"><math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math></span>',
    );
    expect(out).toContain("<math");
    expect(out).toContain("<mi>x</mi>");
  });

  it("keeps safe https links with target+rel (tabnabbing mitigation)", () => {
    const out = sanitizeMessageHtml(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer">ok</a>',
    );
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('target="_blank"');
  });
});

describe("sanitizeSearchHighlight", () => {
  it("preserves <mark> from ts_headline", () => {
    const out = sanitizeSearchHighlight("hello <mark>world</mark>");
    expect(out).toBe("hello <mark>world</mark>");
  });

  it("drops everything else (any HTML that leaked into the message)", () => {
    const out = sanitizeSearchHighlight(
      "<mark>hit</mark> <script>alert(1)</script> <img onerror=1 src=x>",
    );
    expect(out).toContain("<mark>hit</mark>");
    expect(out).not.toContain("<script");
    expect(out).not.toContain("onerror");
    expect(out).not.toMatch(/<img/i);
  });

  it("returns empty string for null/undefined/empty", () => {
    expect(sanitizeSearchHighlight(null)).toBe("");
    expect(sanitizeSearchHighlight(undefined)).toBe("");
    expect(sanitizeSearchHighlight("")).toBe("");
  });
});
