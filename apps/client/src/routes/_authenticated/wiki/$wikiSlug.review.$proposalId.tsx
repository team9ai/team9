import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { ProposalDiffView } from "@/components/wiki/ProposalDiffView";
import { useWikis } from "@/hooks/useWikis";
import { wikiActions } from "@/stores/useWikiStore";

/**
 * `/wiki/:wikiSlug/review/:proposalId` — per-proposal diff + approve/reject.
 * The component owns the data-fetching (proposal list + diff); the route
 * file stays minimal so deep-links behave deterministically.
 */
export const Route = createFileRoute(
  "/_authenticated/wiki/$wikiSlug/review/$proposalId",
)({
  component: WikiReviewDetailPage,
});

function WikiReviewDetailPage() {
  const { wikiSlug, proposalId } = Route.useParams();
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
        data-testid="wiki-review-detail-route-missing"
      >
        Wiki not found.
      </div>
    );
  }

  return <ProposalDiffView wiki={wiki} proposalId={proposalId} />;
}
