import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useWikiPage } from "@/hooks/useWikiPage";
import { useWikis } from "@/hooks/useWikis";
import { useSubmittedProposal } from "@/stores/useWikiStore";
import { WikiCover } from "./WikiCover";
import { WikiPageHeader } from "./WikiPageHeader";
import { WikiPageEditor } from "./WikiPageEditor";
import { WikiProposalBanner } from "./WikiProposalBanner";

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
 *   │ [proposal banner when pending] (Task 19)    │
 *   │ [status bar + pickers + editor body]        │
 *   └─────────────────────────────────────────────┘
 *
 * While either query is pending we render a lightweight "Loading…" cue so
 * the caller's layout stays stable (no layout shift once the real content
 * lands). The proposal banner is driven by `useSubmittedProposal` — it only
 * shows when the user has submitted a proposal for *this* page and it
 * hasn't been resolved yet. Task 23 wires the WS consumer that clears that
 * entry.
 */
export function WikiPageView({ wikiId, path }: WikiPageViewProps) {
  const { t } = useTranslation("wiki");
  const navigate = useNavigate();
  const { data: page, isLoading: pageLoading } = useWikiPage(wikiId, path);
  const { data: wikis, isLoading: wikisLoading } = useWikis();
  const wiki = wikis?.find((w) => w.id === wikiId);
  const pendingProposalId = useSubmittedProposal(wikiId, path);

  if (pageLoading || wikisLoading || !page || !wiki) {
    return (
      <div data-testid="wiki-page-loading" className="p-8">
        {t("page.loading")}
      </div>
    );
  }

  const coverPath =
    typeof page.frontmatter.cover === "string" &&
    page.frontmatter.cover.length > 0
      ? page.frontmatter.cover
      : null;

  const handleViewProposal = (proposalId: string) => {
    // The `/wiki/$wikiSlug/review/$proposalId` route is owned by Task 21 and
    // doesn't exist yet. Cast keeps the typed-router from rejecting the
    // link at build time; once Task 21 lands the route, the cast can be
    // dropped without otherwise changing this call site.
    // TODO(Task 21): remove the cast once the review route exists.
    void navigate({
      to: "/wiki/$wikiSlug/review/$proposalId",
      params: { wikiSlug: wiki.slug, proposalId },
    } as unknown as Parameters<typeof navigate>[0]);
  };

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
      {pendingProposalId && (
        <WikiProposalBanner
          proposalId={pendingProposalId}
          onView={handleViewProposal}
        />
      )}
      <WikiPageEditor
        wikiId={wikiId}
        path={path}
        serverPage={page}
        wiki={wiki}
      />
    </main>
  );
}
