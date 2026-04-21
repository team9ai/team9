import type { PageDto, WikiDto } from "@/types/wiki";

/**
 * Props that Task 17 settles on for the editor so the composite can render
 * without knowing the Lexical integration details. The full implementation
 * lands in Task 18 — this stub keeps the call site stable while we build
 * the shell.
 */
export interface WikiPageEditorProps {
  wikiId: string;
  path: string;
  serverPage: PageDto;
  wiki: WikiDto;
}

/**
 * Placeholder editor body. Task 18 replaces the rendered tree with a
 * Lexical-powered markdown editor + frontmatter panel; for now we render a
 * neutral placeholder so the page shell is visible end-to-end.
 */
export function WikiPageEditor(_props: WikiPageEditorProps) {
  return (
    <div
      data-testid="wiki-page-editor-stub"
      className="px-12 py-4 text-sm text-muted-foreground"
    >
      Editor coming soon…
    </div>
  );
}
