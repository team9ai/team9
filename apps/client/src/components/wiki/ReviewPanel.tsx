import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { useWikiProposals } from "@/hooks/useWikiProposals";
import { useWikiWebSocketSync } from "@/hooks/useWikiWebSocketSync";
import i18n from "@/i18n";
import type { ProposalDto, ProposalStatus, WikiDto } from "@/types/wiki";
import { WikiErrorBoundary } from "./WikiErrorBoundary";

export interface ReviewPanelProps {
  wiki: WikiDto;
}

const STATUS_VARIANT: Record<ProposalStatus, "default" | "secondary"> = {
  pending: "default",
  changes_requested: "secondary",
  approved: "secondary",
  rejected: "secondary",
};

function formatAuthor(proposal: ProposalDto): string {
  const kind =
    proposal.authorType === "agent"
      ? i18n.t("wiki:review.authorAgent")
      : i18n.t("wiki:review.authorUser");
  return `${kind} ${proposal.authorId}`;
}

/**
 * Proposal list rendered at `/wiki/:wikiSlug/-/review`.
 *
 * Only shows pending proposals — users who want historical entries can
 * filter via the URL once we surface that. Rows are `<Link>`s to the
 * detail route so Cmd/Ctrl+click opens in a new tab naturally. The empty
 * state ("No pending proposals") is rendered whenever the list resolves
 * to zero entries, regardless of permission — a read-only user still
 * sees an empty review queue rather than a permission error.
 */
export function ReviewPanel({ wiki }: ReviewPanelProps) {
  // Mount WS listener for this route — the wiki list is usually rendered
  // inside WikiMainContent, but review routes don't go through that tree.
  // Mounting here keeps reviewers' list in sync with proposal events.
  // The hook installs/unmounts its socket listeners symmetrically so calling
  // it from multiple components in the same tree is fine (idempotent React
  // Query invalidations).
  useWikiWebSocketSync();
  const { t } = useTranslation("wiki");
  const { data: proposals, isLoading, isError } = useWikiProposals(wiki.id);

  return (
    <WikiErrorBoundary>
      <div
        className="flex-1 flex flex-col min-h-0"
        data-testid="wiki-review-panel"
      >
        <header className="px-6 pt-6 pb-4 border-b border-border">
          <h1 className="text-lg font-semibold">
            {t("review.heading", { name: wiki.name })}
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            {t("review.description")}
          </p>
        </header>

        <div className="flex-1 overflow-auto">
          {isLoading && (
            <p
              className="px-6 py-4 text-xs text-muted-foreground"
              data-testid="wiki-review-panel-loading"
            >
              {t("review.loading")}
            </p>
          )}

          {isError && (
            <p
              className="px-6 py-4 text-xs text-destructive"
              role="alert"
              data-testid="wiki-review-panel-error"
            >
              {t("review.loadFailed")}
            </p>
          )}

          {!isLoading && !isError && proposals && proposals.length === 0 && (
            <p
              className="px-6 py-4 text-xs text-muted-foreground"
              data-testid="wiki-review-panel-empty"
            >
              {t("review.empty")}
            </p>
          )}

          {proposals && proposals.length > 0 && (
            <ul
              className="divide-y divide-border"
              data-testid="wiki-review-panel-list"
            >
              {proposals.map((proposal) => (
                <li key={proposal.id}>
                  <Link
                    to="/wiki/$wikiSlug/-/review/$proposalId"
                    params={{
                      wikiSlug: wiki.slug,
                      proposalId: proposal.id,
                    }}
                    className="block px-6 py-3 hover:bg-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    data-testid={`wiki-review-panel-row-${proposal.id}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex-1 truncate text-sm font-medium">
                        {proposal.title || t("review.untitledProposal")}
                      </span>
                      <Badge
                        variant={STATUS_VARIANT[proposal.status]}
                        className="shrink-0 text-[10px] uppercase tracking-wide"
                      >
                        {proposal.status}
                      </Badge>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{formatAuthor(proposal)}</span>
                      <span aria-hidden>·</span>
                      <span>
                        {new Date(proposal.createdAt).toLocaleString()}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </WikiErrorBoundary>
  );
}
