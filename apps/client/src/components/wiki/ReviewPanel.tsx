import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { useWikiProposals } from "@/hooks/useWikiProposals";
import type { ProposalDto, ProposalStatus, WikiDto } from "@/types/wiki";

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
  const kind = proposal.authorType === "agent" ? "Agent" : "User";
  return `${kind} ${proposal.authorId}`;
}

/**
 * Proposal list rendered at `/wiki/:wikiSlug/review`.
 *
 * Only shows pending proposals — users who want historical entries can
 * filter via the URL once we surface that. Rows are `<Link>`s to the
 * detail route so Cmd/Ctrl+click opens in a new tab naturally. The empty
 * state ("No pending proposals") is rendered whenever the list resolves
 * to zero entries, regardless of permission — a read-only user still
 * sees an empty review queue rather than a permission error.
 */
export function ReviewPanel({ wiki }: ReviewPanelProps) {
  const { data: proposals, isLoading, isError } = useWikiProposals(wiki.id);

  return (
    <div
      className="flex-1 flex flex-col min-h-0"
      data-testid="wiki-review-panel"
    >
      <header className="px-6 pt-6 pb-4 border-b border-border">
        <h1 className="text-lg font-semibold">Review – {wiki.name}</h1>
        <p className="text-xs text-muted-foreground mt-1">
          Pending proposals awaiting review.
        </p>
      </header>

      <div className="flex-1 overflow-auto">
        {isLoading && (
          <p
            className="px-6 py-4 text-xs text-muted-foreground"
            data-testid="wiki-review-panel-loading"
          >
            Loading…
          </p>
        )}

        {isError && (
          <p
            className="px-6 py-4 text-xs text-destructive"
            role="alert"
            data-testid="wiki-review-panel-error"
          >
            Failed to load proposals.
          </p>
        )}

        {!isLoading && !isError && proposals && proposals.length === 0 && (
          <p
            className="px-6 py-4 text-xs text-muted-foreground"
            data-testid="wiki-review-panel-empty"
          >
            No pending proposals.
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
                  to="/wiki/$wikiSlug/review/$proposalId"
                  params={{
                    wikiSlug: wiki.slug,
                    proposalId: proposal.id,
                  }}
                  className="block px-6 py-3 hover:bg-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  data-testid={`wiki-review-panel-row-${proposal.id}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="flex-1 truncate text-sm font-medium">
                      {proposal.title || "Untitled proposal"}
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
                    <span>{new Date(proposal.createdAt).toLocaleString()}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
