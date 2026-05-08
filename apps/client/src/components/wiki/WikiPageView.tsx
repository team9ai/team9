import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useWikiImageUpload } from "@/hooks/useWikiImageUpload";
import { useWikiPage } from "@/hooks/useWikiPage";
import { useWikis, wikiKeys } from "@/hooks/useWikis";
import { queryClient } from "@/lib/query-client";
import { serializeFrontmatter } from "@/lib/wiki-frontmatter";
import {
  DEFAULT_WIKI_INDEX_FILENAME,
  DEFAULT_WIKI_INDEX_PATH,
  LEGACY_WIKI_INDEX_FILENAME,
} from "@/lib/wiki-paths";
import { wikisApi } from "@/services/api/wikis";
import { useSubmittedProposal, wikiActions } from "@/stores/useWikiStore";
import type { CommitFileInput, PageDto, TreeEntryDto } from "@/types/wiki";
import { WikiCover } from "./WikiCover";
import { WikiEmptyState } from "./WikiEmptyState";
import { WikiPageHeader } from "./WikiPageHeader";
import { WikiPageEditor } from "./WikiPageEditor";
import { WikiProposalBanner } from "./WikiProposalBanner";

export interface WikiPageViewProps {
  wikiId: string;
  path: string;
}

function isFolderIndexPath(path: string): boolean {
  const parts = path.split("/");
  if (parts.length < 2) return false;
  const filename = parts[parts.length - 1];
  return (
    filename === DEFAULT_WIKI_INDEX_FILENAME ||
    filename === LEGACY_WIKI_INDEX_FILENAME
  );
}

function getTitleText(frontmatter: Record<string, unknown>): string {
  return typeof frontmatter.title === "string" ? frontmatter.title.trim() : "";
}

function sanitizeFolderSegment(title: string): string {
  return title
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .split("")
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .replace(/^\.+$/g, "")
    .replace(/^-+/, "")
    .trim();
}

function getFolderRenameTarget(
  path: string,
  nextFrontmatter: Record<string, unknown>,
  currentFrontmatter: Record<string, unknown>,
): { oldPrefix: string; newPrefixBase: string } | null {
  if (!isFolderIndexPath(path)) return null;

  const nextTitle = getTitleText(nextFrontmatter);
  if (!nextTitle || nextTitle === getTitleText(currentFrontmatter)) {
    return null;
  }

  const nextSegment = sanitizeFolderSegment(nextTitle);
  if (!nextSegment) return null;

  const parts = path.split("/");
  parts.pop();
  const oldSegment = parts[parts.length - 1];
  if (nextSegment === oldSegment) return null;

  const parentPrefix = parts.slice(0, -1).join("/");
  const oldPrefix = parts.join("/");
  const newPrefixBase = parentPrefix
    ? `${parentPrefix}/${nextSegment}`
    : nextSegment;

  return { oldPrefix, newPrefixBase };
}

function isUnderPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function uniqueRenamePrefix(
  tree: TreeEntryDto[],
  oldPrefix: string,
  newPrefixBase: string,
  oldFilePaths: string[],
): string {
  const existingPaths = new Set(
    tree.filter((entry) => entry.type === "file").map((entry) => entry.path),
  );
  const slashIndex = newPrefixBase.lastIndexOf("/");
  const parentPrefix =
    slashIndex === -1 ? "" : newPrefixBase.slice(0, slashIndex);
  const baseSegment =
    slashIndex === -1 ? newPrefixBase : newPrefixBase.slice(slashIndex + 1);

  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const candidateSegment =
      suffix === 0 ? baseSegment : `${baseSegment}-${suffix + 1}`;
    const candidatePrefix = parentPrefix
      ? `${parentPrefix}/${candidateSegment}`
      : candidateSegment;
    const hasConflict = oldFilePaths.some((oldPath) => {
      const nextPath = `${candidatePrefix}${oldPath.slice(oldPrefix.length)}`;
      return existingPaths.has(nextPath) && !isUnderPrefix(nextPath, oldPrefix);
    });
    if (!hasConflict) return candidatePrefix;
  }

  throw new Error("Could not find an available folder name");
}

function pageToCreateFile(path: string, page: PageDto): CommitFileInput {
  if (page.encoding === "base64") {
    return {
      path,
      content: page.content,
      encoding: "base64",
      action: "create",
    };
  }

  return {
    path,
    content: serializeFrontmatter({
      frontmatter: page.frontmatter,
      body: page.content,
    }),
    encoding: "text",
    action: "create",
  };
}

async function buildFolderRenameFiles({
  wikiId,
  path,
  page,
  nextFrontmatter,
  oldPrefix,
  newPrefixBase,
}: {
  wikiId: string;
  path: string;
  page: PageDto;
  nextFrontmatter: Record<string, unknown>;
  oldPrefix: string;
  newPrefixBase: string;
}): Promise<{ files: CommitFileInput[]; newPrefix: string; newPath: string }> {
  const tree = await wikisApi.getTree(wikiId, { path: "/", recursive: true });
  const oldFilePaths = tree
    .filter(
      (entry) => entry.type === "file" && isUnderPrefix(entry.path, oldPrefix),
    )
    .map((entry) => entry.path)
    .sort((a, b) => {
      if (a === path) return -1;
      if (b === path) return 1;
      return a.localeCompare(b);
    });

  if (!oldFilePaths.includes(path)) {
    oldFilePaths.unshift(path);
  }

  const newPrefix = uniqueRenamePrefix(
    tree,
    oldPrefix,
    newPrefixBase,
    oldFilePaths,
  );
  const newPath = `${newPrefix}${path.slice(oldPrefix.length)}`;
  const createFiles: CommitFileInput[] = [];

  for (const oldPath of oldFilePaths) {
    const nextPath = `${newPrefix}${oldPath.slice(oldPrefix.length)}`;
    if (oldPath === path) {
      createFiles.push({
        path: nextPath,
        content: serializeFrontmatter({
          frontmatter: nextFrontmatter,
          body: page.content,
        }),
        encoding: "text",
        action: "create",
      });
      continue;
    }

    const childPage = await wikisApi.getPage(wikiId, oldPath);
    createFiles.push(pageToCreateFile(nextPath, childPage));
  }

  const deleteFiles: CommitFileInput[] = oldFilePaths.map((oldPath) => ({
    path: oldPath,
    content: "",
    action: "delete",
  }));

  return { files: [...createFiles, ...deleteFiles], newPrefix, newPath };
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
  const [isSavingMetadata, setIsSavingMetadata] = useState(false);
  const canEditMetadata = Boolean(wiki && wiki.humanPermission !== "read");
  const coverUpload = useWikiImageUpload(wikiId);

  const handleFrontmatterChange = useCallback(
    async (nextFrontmatter: Record<string, unknown>) => {
      if (!canEditMetadata || !page || page.encoding !== "text") return;
      setIsSavingMetadata(true);
      const nextSource = serializeFrontmatter({
        frontmatter: nextFrontmatter,
        body: page.content,
      });
      try {
        const renameTarget = getFolderRenameTarget(
          path,
          nextFrontmatter,
          page.frontmatter,
        );
        const commitInput = renameTarget
          ? await buildFolderRenameFiles({
              wikiId,
              path,
              page,
              nextFrontmatter,
              oldPrefix: renameTarget.oldPrefix,
              newPrefixBase: renameTarget.newPrefixBase,
            })
          : null;
        const result = await wikisApi.commit(
          wikiId,
          commitInput
            ? {
                message: `Rename ${renameTarget!.oldPrefix} to ${commitInput.newPrefix}`,
                files: commitInput.files,
              }
            : {
                message: `Update ${path}`,
                files: [
                  {
                    path,
                    content: nextSource,
                    encoding: "text",
                    action: "update",
                  },
                ],
              },
        );
        if (result.proposal) {
          wikiActions.setSubmittedProposal(wikiId, path, result.proposal.id);
        } else if (commitInput) {
          queryClient.setQueryData(wikiKeys.page(wikiId, commitInput.newPath), {
            ...page,
            path: commitInput.newPath,
            frontmatter: nextFrontmatter,
          });
          queryClient.removeQueries({
            queryKey: wikiKeys.page(wikiId, path),
            exact: true,
          });
          void queryClient.invalidateQueries({
            queryKey: wikiKeys.trees(wikiId),
          });
          void queryClient.invalidateQueries({
            queryKey: wikiKeys.pages(wikiId),
          });
          wikiActions.setSelectedPage(commitInput.newPath);
          if (wiki?.slug) {
            void navigate({
              to: "/wiki/$wikiSlug/$",
              params: { wikiSlug: wiki.slug, _splat: commitInput.newPath },
              replace: true,
            });
          }
        } else {
          queryClient.setQueryData(wikiKeys.page(wikiId, path), {
            ...page,
            frontmatter: nextFrontmatter,
          });
          void queryClient.invalidateQueries({
            queryKey: wikiKeys.page(wikiId, path),
          });
        }
      } catch (error) {
        window.alert(error instanceof Error ? error.message : "Save failed");
      } finally {
        setIsSavingMetadata(false);
      }
    },
    [canEditMetadata, navigate, page, path, wiki?.slug, wikiId],
  );

  const handleCoverChange = useCallback(
    (cover: string) => {
      if (!page) return;
      const nextFrontmatter = { ...page.frontmatter };
      const trimmed = cover.trim();
      if (trimmed.length > 0) {
        nextFrontmatter.cover = trimmed;
      } else {
        delete nextFrontmatter.cover;
      }
      void handleFrontmatterChange(nextFrontmatter);
    },
    [handleFrontmatterChange, page],
  );

  const handleCoverUpload = useCallback(
    (file: File) => coverUpload.upload(file, "covers"),
    [coverUpload],
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
        <WikiCover
          wikiId={wikiId}
          coverPath={coverPath}
          editable={canEditMetadata}
          isSaving={isSavingMetadata || coverUpload.uploading}
          onChangeCover={handleCoverChange}
          onUploadCover={handleCoverUpload}
        />
        <WikiPageHeader
          wikiSlug={wiki.slug}
          wikiName={wiki.name}
          path={path}
          frontmatter={page.frontmatter}
          body={page.content}
          readOnly={!canEditMetadata}
          isSavingMetadata={isSavingMetadata}
          onFrontmatterChange={handleFrontmatterChange}
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
      <WikiCover
        wikiId={wikiId}
        coverPath={coverPath}
        editable={canEditMetadata}
        isSaving={isSavingMetadata || coverUpload.uploading}
        onChangeCover={handleCoverChange}
        onUploadCover={handleCoverUpload}
      />
      <WikiPageHeader
        wikiSlug={wiki.slug}
        wikiName={wiki.name}
        path={path}
        frontmatter={page.frontmatter}
        body={page.content}
        readOnly={!canEditMetadata}
        isSavingMetadata={isSavingMetadata}
        onFrontmatterChange={handleFrontmatterChange}
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
