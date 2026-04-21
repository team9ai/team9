import { useWikiPage } from "@/hooks/useWikiPage";
import { useWikis } from "@/hooks/useWikis";
import { WikiCover } from "./WikiCover";
import { WikiPageHeader } from "./WikiPageHeader";
import { WikiPageEditor } from "./WikiPageEditor";

export interface WikiPageViewProps {
  wikiId: string;
  path: string;
}

/**
 * Top-level wiki page view.
 *
 * Fetches the page (content + frontmatter) and the wiki list in parallel
 * (both share React Query caches, so revisiting a page hits the cache) and
 * lays them out Notion-style:
 *
 *   ┌──────────────── Cover band ────────────────┐
 *   │ ┌──┐                                        │
 *   │ │🚀│  breadcrumb: wiki / parent / ...       │
 *   │ └──┘  # Title                               │
 *   │                                             │
 *   │ --- status bar (from Task 19) ---           │
 *   │ editor body (Task 18)                       │
 *   └─────────────────────────────────────────────┘
 *
 * While either query is pending we render a lightweight "Loading…" cue so
 * the caller's layout stays stable (no layout shift once the real content
 * lands). Status bar wiring is deferred to Task 19 because it requires the
 * draft+commit loop that's built there.
 */
export function WikiPageView({ wikiId, path }: WikiPageViewProps) {
  const { data: page, isLoading: pageLoading } = useWikiPage(wikiId, path);
  const { data: wikis, isLoading: wikisLoading } = useWikis();
  const wiki = wikis?.find((w) => w.id === wikiId);

  if (pageLoading || wikisLoading || !page || !wiki) {
    return (
      <div data-testid="wiki-page-loading" className="p-8">
        Loading…
      </div>
    );
  }

  const coverPath =
    typeof page.frontmatter.cover === "string" &&
    page.frontmatter.cover.length > 0
      ? page.frontmatter.cover
      : null;

  return (
    <main
      data-testid="wiki-page-view"
      className="h-full flex flex-col bg-background overflow-auto"
    >
      <WikiCover wikiId={wikiId} coverPath={coverPath} />
      <WikiPageHeader
        wikiSlug={wiki.slug}
        path={path}
        frontmatter={page.frontmatter}
        body={page.content}
      />
      <WikiPageEditor
        wikiId={wikiId}
        path={path}
        serverPage={page}
        wiki={wiki}
      />
    </main>
  );
}
