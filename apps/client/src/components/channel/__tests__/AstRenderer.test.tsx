import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { AstRenderer } from "../AstRenderer";

// TanStack Router's useNavigate needs a router provider; AST renderer only
// calls it on mention click, so stubbing the module is enough for pure
// render tests.
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@/hooks/useChannels", () => ({
  useCreateDirectChannel: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("../UserProfileCard", () => ({
  UserProfileCard: () => null,
}));

function ast(children: unknown[]) {
  return {
    root: {
      type: "root",
      version: 1,
      direction: null,
      format: "",
      indent: 0,
      children,
    },
  };
}

function paragraph(children: unknown[]) {
  return {
    type: "paragraph",
    version: 1,
    direction: null,
    format: "",
    indent: 0,
    children,
  };
}

function text(s: string, format = 0) {
  return {
    type: "text",
    version: 1,
    text: s,
    format,
    detail: 0,
    mode: "normal",
    style: "",
  };
}

describe("AstRenderer — XSS safety", () => {
  it("renders a script-shaped string as plain text, never as HTML", () => {
    const payload = ast([paragraph([text("<script>alert(1)</script>")])]);
    const { container } = render(<AstRenderer ast={payload} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toBe("<script>alert(1)</script>");
  });

  it("ignores an onerror-style payload smuggled into a text node", () => {
    const payload = ast([paragraph([text('<img src=x onerror="alert(1)">')])]);
    const { container } = render(<AstRenderer ast={payload} />);
    // No <img> element exists — the payload is text-encoded into a text node,
    // so the literal `<` becomes `&lt;` in the rendered markup. The substring
    // "onerror" appears in the escaped HTML but not as a live attribute.
    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML).toContain("&lt;img");
    expect(container.textContent).toBe('<img src=x onerror="alert(1)">');
  });

  it("drops javascript: URLs from link nodes instead of emitting an <a>", () => {
    const payload = ast([
      paragraph([
        {
          type: "link",
          version: 1,
          url: "javascript:alert(1)",
          rel: null,
          target: null,
          children: [text("click me")],
        },
      ]),
    ]);
    const { container } = render(<AstRenderer ast={payload} />);
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("click me");
  });

  it("renders unknown node types as children-only (no HTML sink)", () => {
    const payload = ast([
      paragraph([
        {
          type: "totally-made-up",
          version: 1,
          html: "<script>alert(1)</script>",
          children: [text("hello")],
        },
      ]),
    ]);
    const { container } = render(<AstRenderer ast={payload} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.innerHTML).not.toContain("<script");
    expect(container.textContent).toContain("hello");
  });
});

describe("AstRenderer — broader XSS vectors", () => {
  // These all target text nodes — since the renderer only reaches strings via
  // React text children, the payload is HTML-escaped by React before hitting
  // the DOM. We assert the malicious DOM never materializes.
  const vectors: Array<[string, string]> = [
    ["svg onload", '<svg onload="alert(1)">'],
    ["svg nested script", "<svg><script>alert(1)</script></svg>"],
    ["math mi href", '<math><mi href="javascript:alert(1)">x</mi></math>'],
    ["iframe srcdoc", '<iframe srcdoc="<script>alert(1)</script>"></iframe>'],
    ["vbscript URL via text", "vbscript:msgbox(1)"],
    ["data URI HTML", "data:text/html,<script>alert(1)</script>"],
    ["double-encoded script", "&lt;script&gt;alert(1)&lt;/script&gt;"],
    [
      "unicode-escaped script",
      "\\u003cscript\\u003ealert(1)\\u003c/script\\u003e",
    ],
    ["noscript mutation", '<noscript><p title="a>"><script>alert(1)</script>'],
    ["null byte split", "<\0script>alert(1)</script>"],
  ];

  it.each(vectors)("neutralizes %s payload in text", (_name, payload) => {
    const doc = ast([paragraph([text(payload)])]);
    const { container } = render(<AstRenderer ast={doc} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector("object")).toBeNull();
    expect(container.querySelector("embed")).toBeNull();
    // Text content preserves the exact input — React renders it as a text
    // node, so the payload ends up as characters, not DOM structure.
    expect(container.textContent).toBe(payload);
  });
});

describe("AstRenderer — malicious AST fields", () => {
  it("strips leading whitespace bypass on javascript: URLs", () => {
    // "  javascript:alert(1)" — leading-space trick that has bypassed naive
    // startsWith checks in the past. Our isSafeHref trims + lowercases first.
    const payload = ast([
      paragraph([
        {
          type: "link",
          version: 1,
          url: "   javascript:alert(1)",
          children: [text("click")],
        },
      ]),
    ]);
    const { container } = render(<AstRenderer ast={payload} />);
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("click");
  });

  it("rejects mixed-case JavaScript: URL (case-insensitive check)", () => {
    const payload = ast([
      paragraph([
        {
          type: "link",
          version: 1,
          url: "JaVaScRiPt:alert(1)",
          children: [text("click")],
        },
      ]),
    ]);
    const { container } = render(<AstRenderer ast={payload} />);
    expect(container.querySelector("a")).toBeNull();
  });

  it("ignores unexpected `children` on a text node (text nodes are leaves)", () => {
    // Prototype-pollution-style payload: attach `children` containing a fake
    // "script" node to a text node. renderTextNode only reads `text`, so the
    // bogus children are silently dropped.
    const payload = ast([
      paragraph([
        {
          type: "text",
          version: 1,
          text: "plain",
          format: 0,
          children: [{ type: "script", text: "alert(1)" }],
        },
      ]),
    ]);
    const { container } = render(<AstRenderer ast={payload} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toBe("plain");
  });

  it("ignores object/function/boolean in text field", () => {
    const payload = ast([
      paragraph([
        {
          type: "text",
          version: 1,
          // Non-string text field should render as nothing, not crash
          text: { toString: () => "<script>" } as unknown as string,
          format: 0,
        },
      ]),
    ]);
    const { container } = render(<AstRenderer ast={payload} />);
    expect(container.querySelector("script")).toBeNull();
  });

  it("survives an AST deeper than MAX_RENDER_DEPTH without crashing", () => {
    // Rendering a pathologically deep tree should stop at the depth guard,
    // not blow the stack.
    let node: Record<string, unknown> = { type: "text", text: "leaf" };
    for (let i = 0; i < 200; i++) {
      node = { type: "paragraph", children: [node] };
    }
    const payload = ast([node]);
    expect(() => render(<AstRenderer ast={payload} />)).not.toThrow();
  });

  it("tolerates missing root / null / malformed input", () => {
    // Should render nothing rather than crash.
    expect(() => render(<AstRenderer ast={null} />)).not.toThrow();
    expect(() => render(<AstRenderer ast={{}} />)).not.toThrow();
    expect(() => render(<AstRenderer ast={{ root: null }} />)).not.toThrow();
    expect(() =>
      render(<AstRenderer ast={{ root: { children: "nope" } }} />),
    ).not.toThrow();
  });
});

describe("AstRenderer — formatting", () => {
  it("applies bold/italic via React elements", () => {
    // format: bold=1, italic=2 → combined = 3
    const payload = ast([paragraph([text("hey", 3)])]);
    const { container } = render(<AstRenderer ast={payload} />);
    expect(container.querySelector("strong em, em strong")).not.toBeNull();
  });

  it("auto-links http(s) URLs from text content", () => {
    const payload = ast([paragraph([text("see https://example.com now")])]);
    const { container } = render(<AstRenderer ast={payload} />);
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.com");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toContain("noopener");
  });

  it("renders mention as an interactive span with data attributes", () => {
    const payload = ast([
      paragraph([
        {
          type: "mention",
          version: 1,
          text: "@Alice",
          userId: "11111111-1111-1111-1111-111111111111",
          displayName: "Alice",
          format: 0,
          detail: 0,
          mode: "segmented",
          style: "",
        },
      ]),
    ]);
    const { container } = render(<AstRenderer ast={payload} />);
    const span = container.querySelector(".mention-tag");
    expect(span?.getAttribute("data-mention-user-id")).toBe(
      "11111111-1111-1111-1111-111111111111",
    );
    expect(span?.textContent).toBe("@Alice");
  });
});
