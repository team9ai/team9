import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { ReviewPanel } from "@/components/wiki/ReviewPanel";
import { useWikis } from "@/hooks/useWikis";
import { wikiActions } from "@/stores/useWikiStore";

/**
 * `/wiki/:wikiSlug/-/review` — list of pending proposals for the selected
 * wiki. Mirrors the other wiki routes by seeding `selectedWikiId` in the
 * store so the sub-sidebar stays in sync. The page itself is `ReviewPanel`.
 *
 * When the slug doesn't resolve (archived wiki, typo) we render a
 * lightweight fallback instead of blanking the pane — the sidebar's own
 * archived-wiki filtering typically prevents this, but the route can be
 * hit via a stale deep-link.
 *
 * The route lives under `/-/review` (not `/review`) so that wiki pages
 * whose path begins with "review/" are never shadowed by this route.
 */
export const Route = createFileRoute("/_authenticated/wiki/$wikiSlug/-/review")(
  {
    component: WikiReviewPage,
  },
);

function WikiReviewPage() {
  const { wikiSlug } = Route.useParams();
  const { data: wikis } = useWikis();

  const wiki = wikis?.find((w) => w.slug === wikiSlug);

  useEffect(() => {
    if (wiki) {
      wikiActions.setSelectedWiki(wiki.id);
    }
  }, [wiki]);

  if (!wiki) {
    return (
      <div
        className="flex-1 flex items-center justify-center text-xs text-muted-foreground"
        data-testid="wiki-review-route-missing"
      >
        Wiki not found.
      </div>
    );
  }

  return <ReviewPanel wiki={wiki} />;
}
