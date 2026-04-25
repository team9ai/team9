import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { WikiMainContent } from "@/components/layout/contents/WikiMainContent";
import { useWikis } from "@/hooks/useWikis";
import { wikiActions } from "@/stores/useWikiStore";

/**
 * `/wiki/:wikiSlug/*` — deep link to a specific page (e.g. `api/docs/auth.md`).
 * Besides setting the store selection, we auto-expand every ancestor directory
 * so the sub-sidebar tree reveals the active node. `expandDirectory` is
 * idempotent — if the user previously expanded `api` manually, a subsequent
 * deep-link must not collapse it, so we use `expandDirectory` (not
 * `toggleDirectory`).
 */
export const Route = createFileRoute("/_authenticated/wiki/$wikiSlug/$")({
  component: WikiCatchallPage,
});

function WikiCatchallPage() {
  const { wikiSlug, _splat: pagePath } = Route.useParams() as {
    wikiSlug: string;
    _splat: string;
  };
  const { data: wikis } = useWikis();

  useEffect(() => {
    const wiki = wikis?.find((w) => w.slug === wikiSlug);
    if (!wiki || !pagePath) return;

    wikiActions.setSelectedWiki(wiki.id);
    wikiActions.setSelectedPage(pagePath);

    // Auto-expand every parent directory along the path so the sidebar
    // reveals the active node. `api/docs/auth.md` => expand `api` and
    // `api/docs`. We skip the filename (last segment).
    const parts = pagePath.split("/");
    parts.pop();
    let acc = "";
    for (const segment of parts) {
      acc = acc ? `${acc}/${segment}` : segment;
      wikiActions.expandDirectory(acc);
    }
  }, [wikis, wikiSlug, pagePath]);

  return <WikiMainContent />;
}
