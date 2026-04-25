import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { WikiMainContent } from "@/components/layout/contents/WikiMainContent";
import { useWikis } from "@/hooks/useWikis";
import { wikiActions } from "@/stores/useWikiStore";

/**
 * `/wiki/:wikiSlug` — a Wiki is selected but no specific page was requested.
 * We resolve the slug to an id (client-side — the list is already cached by
 * `useWikis`) and default the page to `index.md`. If the Wiki doesn't have
 * an `index.md`, the page view will surface that as a 404; we still set the
 * path so deep-linking from the address bar behaves deterministically.
 */
export const Route = createFileRoute("/_authenticated/wiki/$wikiSlug")({
  component: WikiSlugPage,
});

function WikiSlugPage() {
  const { wikiSlug } = Route.useParams();
  const { data: wikis } = useWikis();

  useEffect(() => {
    const wiki = wikis?.find((w) => w.slug === wikiSlug);
    if (wiki) {
      wikiActions.setSelectedWiki(wiki.id);
      wikiActions.setSelectedPage("index.md");
    }
  }, [wikis, wikiSlug]);

  return <WikiMainContent />;
}
