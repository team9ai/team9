import { describe, it, expect } from "vitest";
import { renderMathInHtml, parseMath } from "./math";

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
    expect(out).not.toContain("$x+y$");
  });

  it("preserves text order with multiple inline formulas", () => {
    // Use sentinels that don't appear anywhere in KaTeX's generated markup,
    // so indexOf positions are unambiguous.
    const out = renderMathInHtml(
      "<p>SENTINEL_START $x$ mid $y$ SENTINEL_END</p>",
    );
    const xIdx = out.indexOf(">x<");
    const yIdx = out.indexOf(">y<");
    expect(xIdx).toBeGreaterThan(-1);
    expect(yIdx).toBeGreaterThan(xIdx);
    expect(out.indexOf("SENTINEL_START")).toBeLessThan(xIdx);
    expect(out.indexOf("SENTINEL_END")).toBeGreaterThan(yIdx);
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

describe("renderMathInHtml — escape coverage", () => {
  it("handles \\$ escape inside block math (findBlockClose branch)", () => {
    // $$\$5$$ — block with an escaped dollar inside; must render as block math
    const out = renderMathInHtml("<p>$$\\$5$$</p>");
    expect(out).toContain('class="math-block"');
  });

  it("handles \\$ escape inside inline math (tryInline branch)", () => {
    // $x \$5 y$ — inline with an escaped dollar inside; must render as inline math
    const out = renderMathInHtml("<p>$x \\$5 y$</p>");
    expect(out).not.toContain("$x");
  });
});

describe("renderMathInHtml — branch coverage", () => {
  it("visits text nodes without '$' without rendering (raw no-dollar early-return)", () => {
    // 'hello' has no $, so transformTextNode returns early; '$x$' in strong is rendered
    const out = renderMathInHtml("<p><strong>$x$</strong> hello</p>");
    // The strong content is rendered (formula replaced), hello text unchanged
    expect(out).not.toContain("$x$");
    expect(out).toContain("hello");
  });

  it("does not render '$$$y$' (prev-dollar guard in tryInline)", () => {
    // The third $ at index 2 is preceded by $, so tryInline returns null for it
    const html = "<p>$$$y$</p>";
    expect(renderMathInHtml(html)).toBe(html);
  });

  it("does not render '$x$5' (digit-after-close guard in tryInline)", () => {
    // Closing $ followed by digit 5 → tryInline returns null
    const html = "<p>$x$5</p>";
    expect(renderMathInHtml(html)).toBe(html);
  });

  it("does not render formula with vertical-tab-only content (tryInline latex.trim=empty)", () => {
    // Vertical tab is not caught by the space/tab/newline guards but trims to empty
    const segments = parseMath("$\v$");
    // All segments must be text (no formula rendered)
    expect(segments.every((s) => s.kind === "text")).toBe(true);
  });

  it("skips non-text, non-element nodes (e.g. HTML comments) without error", () => {
    // Comment nodes have nodeType 8, which is neither ELEMENT_NODE nor TEXT_NODE.
    // walk() should visit them but do nothing, covering the 'else' branch of
    // the TEXT_NODE check.
    // The comment node contains a $ but should be ignored (it's not a Text node).
    // Only the text node "hello $y$" is processed.
    const out = renderMathInHtml("<p><!-- $x$ -->hello $y$</p>");
    expect(out).not.toContain("$y$");
    expect(out).toContain("hello");
  });
});
