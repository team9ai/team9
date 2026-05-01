import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useWikiPage } from "@/hooks/useWikiPage";
import { useWikis } from "@/hooks/useWikis";
import { useSubmittedProposal } from "@/stores/useWikiStore";
import { WikiCover } from "./WikiCover";
import { WikiEmptyState } from "./WikiEmptyState";
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

  // Split the loading / missing-wiki / missing-page checks.
  //
  // Previously the combined `|| !wiki` condition would render the loading
  // spinner forever whenever the wikis query had finished but the selected
  // wiki wasn't in the response (e.g. it was archived by another user
  // mid-session). Now we surface an explicit "not found" empty state
  // when the wikis list has resolved without the target id, so the user
  // can recover by picking another wiki from the sidebar.
  if (pageLoading || wikisLoading) {
    return (
      <div data-testid="wiki-page-loading" className="p-8">
        {t("page.loading")}
      </div>
    );
  }
  if (!wiki) {
    return <WikiEmptyState message={t("errors.wikiNotFound")} />;
  }
  if (!page) {
    return <WikiEmptyState message={t("page.notFound", { path })} />;
  }

  const coverPath =
    typeof page.frontmatter.cover === "string" &&
    page.frontmatter.cover.length > 0
      ? page.frontmatter.cover
      : null;

  const handleViewProposal = (proposalId: string) => {
    void navigate({
      to: "/wiki/$wikiSlug/-/review/$proposalId",
      params: { wikiSlug: wiki.slug, proposalId },
    });
  };

  if (page.encoding === "base64") {
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
        <div
          data-testid="wiki-page-binary"
          className="px-12 py-8 text-muted-foreground text-sm"
        >
          {t("page.binaryFile")}
        </div>
      </main>
    );
  }

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
