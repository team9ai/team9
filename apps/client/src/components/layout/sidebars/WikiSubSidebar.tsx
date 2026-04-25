import { useState } from "react";
import { Library, MessageSquareText, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useQueries } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { NotificationBadge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useWikis, wikiKeys } from "@/hooks/useWikis";
import { useSelectedWikiId } from "@/stores/useWikiStore";
import { wikisApi } from "@/services/api/wikis";
import { WikiListItem } from "@/components/wiki/WikiListItem";
import { CreateWikiDialog } from "@/components/wiki/CreateWikiDialog";
import type { ProposalDto, WikiDto } from "@/types/wiki";

/**
 * Sub-sidebar for the Wiki tab. Renders a list of the user's wikis and
 * lazily fetches each wiki's tree when the row is expanded. Creation is
 * surfaced via the `+` button in the header — the dialog itself is a stub
 * until Task 20, but the wiring is stable.
 *
 * Archived wikis are filtered server-side by `wikisApi.list` (the gateway's
 * `WikisService.listWikis` excludes rows where `archivedAt is not null`), so
 * this component renders every wiki it receives.
 */
export function WikiSubSidebar() {
  const { t } = useTranslation("navigation");
  const { t: tWiki } = useTranslation("wiki");
  const { data: wikis, isLoading } = useWikis();
  const [showCreate, setShowCreate] = useState(false);
  const navigate = useNavigate();
  const selectedWikiId = useSelectedWikiId();

  // Aggregate the pending-proposal count across every wiki the user can
  // see. `useQueries` is the idiomatic React Query pattern for a variable-
  // length batch of sibling queries — hook rules permit it because the
  // hook itself is called unconditionally with a queries array whose
  // *contents* vary. Each sub-query shares the same key factory as the
  // dedicated `useWikiProposals` hook, so invalidations from approve /
  // reject mutations flush the badge instantly.
  const proposalQueries = useQueries({
    queries: (wikis ?? []).map((w: WikiDto) => ({
      queryKey: wikiKeys.proposals(w.id, "pending"),
      queryFn: () => wikisApi.listProposals(w.id, "pending"),
      // Re-fetch when the tab/window regains focus so a reviewer who just
      // saw a proposal land on the main pane sees the badge update.
      refetchOnWindowFocus: true,
      enabled: !!w.id,
    })),
  });

  const totalPending = proposalQueries.reduce(
    (sum, q) => sum + ((q.data as ProposalDto[] | undefined)?.length ?? 0),
    0,
  );

  // Target slug for the Review icon. Prefer the currently-selected wiki
  // (so the user lands on the one they were just editing) and fall back
  // to the first wiki in the list. When the user has zero wikis the icon
  // is hidden entirely — there's nothing to review and no sensible
  // destination route.
  const selectedWiki = wikis?.find((w) => w.id === selectedWikiId);
  const reviewTargetSlug = selectedWiki?.slug ?? wikis?.[0]?.slug ?? null;

  // Capture a non-nullable handler only when we have a target. The
  // sibling guard on the JSX (`reviewTargetSlug && …`) means this
  // handler only ever exists alongside a rendered button, so we don't
  // need an in-function null-check.
  const handleOpenReview = reviewTargetSlug
    ? () =>
        void navigate({
          to: "/wiki/$wikiSlug/-/review",
          params: { wikiSlug: reviewTargetSlug },
        })
    : undefined;

  return (
    <div className="flex flex-col h-full bg-background">
      <header className="h-14 flex items-center justify-between px-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Library size={18} className="text-primary" />
          <h2 className="font-semibold text-sm">{t("wiki")}</h2>
        </div>
        <div className="flex items-center gap-1">
          {reviewTargetSlug && (
            <Button
              size="sm"
              variant="ghost"
              aria-label={t("reviewProposals")}
              title={t("reviewProposals")}
              onClick={handleOpenReview}
              data-testid="wiki-sub-sidebar-review"
              className="relative"
            >
              <MessageSquareText size={14} />
              <NotificationBadge count={totalPending} />
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            aria-label={t("createWiki")}
            title={t("createWiki")}
            onClick={() => setShowCreate(true)}
          >
            <Plus size={14} />
          </Button>
        </div>
      </header>
      <Separator />
      <ScrollArea className="flex-1 py-2">
        {isLoading && (
          <p className="px-4 py-2 text-xs text-muted-foreground">
            {tWiki("sidebar.loading")}
          </p>
        )}
        {!isLoading && (!wikis || wikis.length === 0) && (
          <p className="px-4 py-2 text-xs text-muted-foreground">
            {tWiki("sidebar.empty")}
          </p>
        )}
        {wikis && wikis.length > 0 && (
          <div
            role="tree"
            aria-label={t("wiki")}
            data-testid="wiki-sub-sidebar-tree"
          >
            {wikis.map((wiki) => (
              <WikiListItem key={wiki.id} wiki={wiki} />
            ))}
          </div>
        )}
      </ScrollArea>
      <CreateWikiDialog open={showCreate} onOpenChange={setShowCreate} />
    </div>
  );
}
