import { describe, it, expect, vi } from "vitest";
import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));
vi.mock("@/hooks/useMessages", () => ({
  useFullContent: () => ({ data: undefined }),
}));
vi.mock("@/hooks/useChannels", () => ({
  useCreateDirectChannel: () => ({ mutateAsync: vi.fn() }),
}));

import { MessageContent } from "../MessageContent";

function renderWithProviders(ui: ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("MessageContent — math integration", () => {
  it("renders math in a Markdown (bot) message via remark-math + rehype-katex", () => {
    const { container } = renderWithProviders(
      <MessageContent content={"See $\\sum_{k=1}^{n} k$ below."} />,
    );
    expect(container.querySelector(".katex")).not.toBeNull();
  });

  it("renders a Markdown block formula with .katex-display", () => {
    // Block math requires `$$` on its own line (flow-level fence), with
    // content on the inner lines — matching remark-math's mathFlow rule.
    const content = [
      "Proof:",
      "",
      "$$",
      "\\sum_{k=1}^{n} k^3 = \\left(\\frac{n(n+1)}{2}\\right)^2",
      "$$",
      "",
      "as claimed.",
    ].join("\n");
    const { container } = renderWithProviders(
      <MessageContent content={content} />,
    );
    expect(container.querySelector(".katex")).not.toBeNull();
    expect(container.querySelector(".katex-display")).not.toBeNull();
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

  it("HTML path: preserves code block and mention while rendering adjacent math", () => {
    const html =
      '<p><span class="mention-tag" data-mention-user-id="u1" data-mention-display-name="Alice">@Alice</span></p>' +
      '<pre><code class="language-js">const a = $x$;</code></pre>' +
      "<p>and $y+1$ here</p>";
    const { container } = renderWithProviders(
      <MessageContent content={html} />,
    );

    // Mention span preserved (with its data attribute).
    expect(
      container.querySelector("[data-mention-user-id='u1']"),
    ).not.toBeNull();

    // Code block intact — the `$x$` inside <code> must stay as literal text.
    const codeText = container.querySelector("pre code")?.textContent ?? "";
    expect(codeText).toContain("$x$");

    // Math outside the code block IS rendered.
    const katexNodes = container.querySelectorAll(".katex");
    expect(katexNodes.length).toBeGreaterThan(0);
  });

  it("HTML path: renders the spec-screenshot content end-to-end", () => {
    // Mirrors the mathematical-induction proof from the original screenshot:
    // inline formulas for n=1 sides plus a $$…$$ block for the induction step.
    const html =
      "<p>📌 <strong>题目（我自己出的）</strong></p>" +
      "<p>$$\\sum_{k=1}^{n} k^3 = \\left(\\frac{n(n+1)}{2}\\right)^2$$</p>" +
      "<p>左边：$\\sum_{k=1}^{1} k^3 = 1^3 = 1$</p>" +
      "<p>右边：$\\left(\\frac{1 \\cdot 2}{2}\\right)^2 = 1^2 = 1$</p>";
    const { container } = renderWithProviders(
      <MessageContent content={html} />,
    );

    // The proof contains one block formula + two inline formulas, so at
    // minimum three .katex nodes should render.
    expect(container.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(
      3,
    );
    expect(container.querySelector(".katex-display")).not.toBeNull();
  });

  // Note: the Markdown path relies on remark-math / micromark-extension-math,
  // whose inline rule is slightly laxer than Pandoc — it does not enforce the
  // "closing $ not followed by a digit" rule. So a message like
  // "$5 for lunch, $10 for dinner" would accidentally render as math on the
  // Markdown path. The HTML path (which applies our own strict rules) covers
  // the common user-typed case below. Bot-authored content in Markdown should
  // escape $ as \$ for money amounts.
  it("does not render '$5 vs $10' as math (HTML path)", () => {
    const html = "<p>I paid $5 for lunch, $10 for dinner</p>";
    const { container } = renderWithProviders(
      <MessageContent content={html} />,
    );
    expect(container.querySelector(".katex")).toBeNull();
    expect(container.textContent).toContain("$5 for lunch, $10 for dinner");
  });
});
