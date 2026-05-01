import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useWikiPage } from "@/hooks/useWikiPage";
import { useWikis, wikiKeys } from "@/hooks/useWikis";
import { queryClient } from "@/lib/query-client";
import { DEFAULT_WIKI_INDEX_PATH } from "@/lib/wiki-paths";
import { wikisApi } from "@/services/api/wikis";
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
  const bootstrapKey = `${wikiId}:${path}`;
  const [bootstrappingKey, setBootstrappingKey] = useState<string | null>(null);
  const [bootstrapFailedKey, setBootstrapFailedKey] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (
      !wiki ||
      page ||
      pageLoading ||
      wikisLoading ||
      path !== DEFAULT_WIKI_INDEX_PATH ||
      wiki.humanPermission !== "write" ||
      bootstrappingKey === bootstrapKey ||
      bootstrapFailedKey === bootstrapKey
    ) {
      return;
    }

    let cancelled = false;
    setBootstrappingKey(bootstrapKey);
    void wikisApi
      .commit(wiki.id, {
        message: `Create ${DEFAULT_WIKI_INDEX_PATH}`,
        files: [
          {
            path: DEFAULT_WIKI_INDEX_PATH,
            content: `# ${wiki.name}\n\n`,
            encoding: "text",
            action: "create",
          },
        ],
      })
      .then(() => {
        queryClient.setQueryData(wikiKeys.page(wiki.id, path), {
          path,
          content: `# ${wiki.name}\n\n`,
          encoding: "text",
          frontmatter: {},
          lastCommit: null,
        });
        void queryClient.invalidateQueries({
          queryKey: wikiKeys.trees(wiki.id),
        });
        void queryClient.invalidateQueries({
          queryKey: wikiKeys.page(wiki.id, path),
        });
      })
      .catch(() => {
        if (!cancelled) setBootstrapFailedKey(bootstrapKey);
      })
      .finally(() => {
        if (!cancelled) setBootstrappingKey(null);
      });

    return () => {
      cancelled = true;
    };
  }, [
    bootstrapFailedKey,
    bootstrapKey,
    bootstrappingKey,
    page,
    pageLoading,
    path,
    wiki,
    wikiId,
    wikisLoading,
  ]);

  // Split the loading / missing-wiki / missing-page checks.
  //
  // Previously the combined `|| !wiki` condition would render the loading
  // spinner forever whenever the wikis query had finished but the selected
  // wiki wasn't in the response (e.g. it was archived by another user
  // mid-session). Now we surface an explicit "not found" empty state
  // when the wikis list has resolved without the target id, so the user
  // can recover by picking another wiki from the sidebar.
  if (pageLoading || wikisLoading || bootstrappingKey === bootstrapKey) {
    return (
      <div
        data-testid="wiki-page-loading"
        role="status"
        aria-live="polite"
        className="h-full flex flex-col items-center justify-center gap-3 bg-background text-muted-foreground"
      >
        <Loader2 className="size-5 animate-spin" aria-hidden="true" />
        <span className="text-sm">{t("page.loading")}</span>
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
