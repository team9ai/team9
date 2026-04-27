import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { extractTitle, WikiPageHeader } from "../WikiPageHeader";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    className,
  }: {
    children: React.ReactNode;
    to: string;
    params?: Record<string, string>;
    className?: string;
  }) => (
    <a
      href={`${to}${params ? `?p=${JSON.stringify(params)}` : ""}`}
      className={className}
    >
      {children}
    </a>
  ),
}));

describe("extractTitle", () => {
  it("prefers frontmatter.title when it is a non-empty string", () => {
    expect(extractTitle("f.md", { title: "Hello" }, "# Body H1")).toBe("Hello");
  });

  it("ignores empty/whitespace frontmatter.title", () => {
    expect(extractTitle("f.md", { title: "   " }, "# Body H1")).toBe("Body H1");
  });

  it("falls back to first H1 in body when no frontmatter title", () => {
    expect(extractTitle("f.md", {}, "intro\n# Heading One\n## sub")).toBe(
      "Heading One",
    );
  });

  it("falls back to filename minus .md when no title and no H1", () => {
    expect(extractTitle("docs/guide.md", {}, "just prose")).toBe("guide");
  });

  it("handles uppercase .MD", () => {
    expect(extractTitle("docs/GUIDE.MD", {}, "")).toBe("GUIDE");
  });

  it("handles empty path gracefully", () => {
    expect(extractTitle("", {}, "")).toBe("");
  });

  it("ignores non-string frontmatter.title", () => {
    expect(extractTitle("x.md", { title: 123 }, "")).toBe("x");
  });
});

describe("WikiPageHeader", () => {
  it("renders the default icon when frontmatter.icon is missing", () => {
    render(
      <WikiPageHeader
        wikiSlug="public"
        path="index.md"
        frontmatter={{}}
        body=""
      />,
    );
    expect(screen.getByTestId("wiki-page-icon")).toHaveTextContent("📄");
  });

  it("renders a custom emoji icon from frontmatter", () => {
    render(
      <WikiPageHeader
        wikiSlug="public"
        path="index.md"
        frontmatter={{ icon: "🚀" }}
        body=""
      />,
    );
    expect(screen.getByTestId("wiki-page-icon")).toHaveTextContent("🚀");
  });

  it("ignores a non-string icon value and falls back to default", () => {
    render(
      <WikiPageHeader
        wikiSlug="public"
        path="index.md"
        frontmatter={{ icon: 42 }}
        body=""
      />,
    );
    expect(screen.getByTestId("wiki-page-icon")).toHaveTextContent("📄");
  });

  it("renders the wiki slug link and all parent directory segments in breadcrumb", () => {
    render(
      <WikiPageHeader
        wikiSlug="public"
        path="api/docs/auth.md"
        frontmatter={{}}
        body="# Auth"
      />,
    );
    // Wiki slug link
    expect(screen.getByRole("link", { name: "public" })).toBeInTheDocument();
    // Parent dir segments shown; filename omitted (title takes its place).
    expect(screen.getByText("api")).toBeInTheDocument();
    expect(screen.getByText("docs")).toBeInTheDocument();
    // Filename shouldn't be in the breadcrumb, but "auth.md" has .md stripped
    // and the title is "Auth" (from body H1).
    expect(screen.queryByText("auth.md")).toBeNull();
  });

  it("renders an empty breadcrumb for root pages without crashing", () => {
    render(
      <WikiPageHeader
        wikiSlug="public"
        path="index.md"
        frontmatter={{ title: "Home" }}
        body=""
      />,
    );
    // Only the wiki slug link, no segments.
    const nav = screen.getByRole("navigation", { name: "breadcrumb" });
    const links = nav.querySelectorAll("a");
    expect(links.length).toBe(1);
    expect(links[0]).toHaveTextContent("public");
  });

  it("handles an empty path gracefully", () => {
    render(
      <WikiPageHeader
        wikiSlug="public"
        path=""
        frontmatter={{}}
        body="# Root"
      />,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Root");
  });

  it("renders the derived title as an H1", () => {
    render(
      <WikiPageHeader
        wikiSlug="public"
        path="docs/getting-started.md"
        frontmatter={{}}
        body=""
      />,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "getting-started",
    );
  });
});
