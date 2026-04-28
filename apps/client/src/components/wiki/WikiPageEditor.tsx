import { useCallback, useMemo, useState } from "react";
import {
  Folder9FolderEditor,
  type Folder9RenderFileArgs,
  type ProposeReviewInput,
} from "@/components/folder9-editor/Folder9FolderEditor";
import { useCurrentUser } from "@/hooks/useAuth";
import { useWikiImageUpload } from "@/hooks/useWikiImageUpload";
import { resolveClientPermission } from "@/lib/wiki-permission";
import { parseFrontmatter, serializeFrontmatter } from "@/lib/wiki-frontmatter";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { wikiActions } from "@/stores/useWikiStore";
import { wikiFolderApi } from "@/services/api/folder9-folder";
import type {
  CommitRequest,
  CommitResult,
  Folder9FolderApi,
} from "@/services/api/folder9-folder";
import { IconPickerPopover } from "./IconPickerPopover";
import { CoverPickerPopover } from "./CoverPickerPopover";
import {
  SubmitForReviewDialog,
  type SubmitForReviewInput,
} from "./SubmitForReviewDialog";
import { DocumentEditor } from "@/components/documents/DocumentEditor";
import type { PageDto, WikiDto } from "@/types/wiki";

export interface WikiPageEditorProps {
  wikiId: string;
  path: string;
  /**
   * Server-side page DTO fetched by `WikiPageView` via `useWikiPage`. The
   * shell does its own blob fetch through `wikiFolderApi`, so this prop
   * is no longer the source of truth for the editor body — it survives
   * only so the parent's existing data flow stays untouched.
   */
  serverPage: PageDto;
  wiki: WikiDto;
}

/**
 * Wiki page editor — wiki-flavoured wrapper around `<Folder9FolderEditor>`.
 *
 * Responsibilities kept on this side of the shell boundary:
 *
 *  - Permission resolution from `wiki` × current user (humans get
 *    `wiki.humanPermission`; agents/bots/system actors get
 *    `wiki.agentPermission`). The result is fed into the shell as the
 *    coarse `read | propose | write` value the shell understands.
 *  - Image upload — `useWikiImageUpload(wikiId)` is wired into the
 *    shell's `imageUpload` slot.
 *  - Review-mode dialog — when the user clicks Save in review mode the
 *    shell calls `onProposeReview(proceed)`; we open
 *    `<SubmitForReviewDialog>` and call `proceed({message})` with the
 *    `${title}\n\n${description}` (or just `${title}`) once the user
 *    submits.
 *  - Wiki frontmatter (icon + cover popovers) — embedded in the
 *    `renderFile` slot so the picker UI lives at the top of the editor
 *    pane. Edits round-trip through `parseFrontmatter` /
 *    `serializeFrontmatter` so the body the shell commits already
 *    carries the YAML fence.
 *  - Proposal id mirroring — the shell's `api.commit` adapter records
 *    the returned proposal id into `wikiActions.setSubmittedProposal`
 *    so the proposal banner (rendered above the editor by
 *    `WikiPageView`) lights up the moment a review-mode save lands.
 */
export function WikiPageEditor({
  wikiId,
  path,
  serverPage,
  wiki,
}: WikiPageEditorProps) {
  void serverPage;
  const { data: currentUser } = useCurrentUser();
  const permission = resolveClientPermission(wiki, currentUser ?? null);
  const imageUpload = useWikiImageUpload(wikiId);
  const workspaceId = useWorkspaceStore((s) => s.selectedWorkspaceId);

  // Wrap `wikiFolderApi` so a successful proposal commit pings the wiki
  // store. The shell otherwise drops the proposal id on the floor (it
  // only knows about the generic `Folder9FolderApi` surface).
  const api = useMemo<Folder9FolderApi>(() => {
    const base = wikiFolderApi(wikiId);
    return {
      ...base,
      commit: async (req: CommitRequest): Promise<CommitResult> => {
        const result = await base.commit(req);
        if (result.proposalId && req.files.length > 0) {
          wikiActions.setSubmittedProposal(
            wikiId,
            req.files[0].path,
            result.proposalId,
          );
        }
        return result;
      },
    };
  }, [wikiId]);

  // Match the wiki's pre-refactor draft-key layout so users opening the
  // editor against an existing draft don't lose their work after
  // upgrade. `useFolderDraft` will base64-encode the path component on
  // top of this prefix.
  const userId = currentUser?.id ?? null;
  const draftKey =
    workspaceId && userId ? `${workspaceId}.${wikiId}.${userId}` : null;

  // Review-mode hand-off: the shell calls `onProposeReview(proceed)`,
  // we open the dialog, and once the user submits we call `proceed`
  // with the composed commit message. Holding the continuation in
  // state keeps the dialog's onSubmit decoupled from the shell's
  // internal closure identity.
  const [pendingProceed, setPendingProceed] = useState<
    ((input: ProposeReviewInput) => void) | null
  >(null);

  const handleProposeReview = useCallback(
    (proceed: (input: ProposeReviewInput) => void) => {
      // Wrap in an arrow so the React state setter doesn't try to
      // invoke `proceed` as the functional updater.
      setPendingProceed(() => proceed);
    },
    [],
  );

  const handleReviewDialogSubmit = useCallback(
    (input: SubmitForReviewInput) => {
      const title = input.title.trim();
      const description = input.description?.trim() ?? "";
      const message = title
        ? description
          ? `${title}\n\n${description}`
          : title
        : `Update ${path}`;
      pendingProceed?.({ message });
      setPendingProceed(null);
    },
    [pendingProceed, path],
  );

  const handleReviewDialogOpenChange = useCallback((open: boolean) => {
    if (!open) setPendingProceed(null);
  }, []);

  const renderFile = useCallback(
    (args: Folder9RenderFileArgs) => {
      // Only the markdown body editor needs the wiki-flavoured
      // frontmatter pickers. Other text or binary files fall through
      // to the shell's default renderer.
      if (
        args.encoding !== "text" ||
        !args.path.toLowerCase().endsWith(".md")
      ) {
        return undefined;
      }
      return (
        <WikiMarkdownFile
          wikiId={wikiId}
          path={args.path}
          content={args.content}
          readOnly={args.readOnly}
          onChange={args.onChange}
        />
      );
    },
    [wikiId],
  );

  // The shell's `permission` prop is the same coarse triple the wiki
  // already uses, so this is a straight pass-through.
  if (!draftKey) {
    // Either the workspace context or the current user hasn't loaded
    // yet. Render nothing so the (mounted) shell doesn't claim the
    // selection / draft slot before we know who to namespace under.
    return null;
  }

  return (
    <div
      data-testid="wiki-page-editor"
      className="flex-1 flex flex-col min-h-0"
    >
      <Folder9FolderEditor
        folderId={wikiId}
        permission={permission}
        approvalMode={wiki.approvalMode}
        api={api}
        draftKey={draftKey}
        initialPath={path}
        imageUpload={imageUpload}
        onProposeReview={handleProposeReview}
        renderFile={renderFile}
      />
      <SubmitForReviewDialog
        open={pendingProceed !== null}
        onOpenChange={handleReviewDialogOpenChange}
        onSubmit={handleReviewDialogSubmit}
        isSubmitting={false}
      />
    </div>
  );
}

interface WikiMarkdownFileProps {
  wikiId: string;
  path: string;
  /**
   * The raw file body (frontmatter fence + markdown), as the shell
   * stores it. We split it on render so the icon/cover popovers
   * can edit just the YAML fence without disturbing the markdown
   * underneath.
   */
  content: string;
  readOnly: boolean;
  onChange: (next: string) => void;
}

/**
 * Markdown body renderer for wiki pages.
 *
 * Wraps the icon + cover popovers around `<DocumentEditor>` and
 * round-trips the YAML frontmatter through `parseFrontmatter` /
 * `serializeFrontmatter` on every edit so the shell — which only
 * knows about raw text — always commits the rebuilt source.
 *
 * Lives inside `WikiPageEditor` (rather than as a standalone
 * component) because nothing else needs this stitching today.
 */
function WikiMarkdownFile({
  wikiId,
  path,
  content,
  readOnly,
  onChange,
}: WikiMarkdownFileProps) {
  // `parseFrontmatter` is forgiving: missing / malformed frontmatter
  // collapses to `{}`. We fall back to the raw content as the body
  // in that case so users can still edit markdown that was authored
  // without a fence.
  const parsed = useMemo(() => {
    try {
      return parseFrontmatter(content);
    } catch {
      return { frontmatter: {} as Record<string, unknown>, body: content };
    }
  }, [content]);

  const frontmatter = parsed.frontmatter;
  const body = parsed.body;

  const writeFrontmatter = useCallback(
    (next: Record<string, unknown>) => {
      if (readOnly) return;
      const merged = serializeFrontmatter({ frontmatter: next, body });
      onChange(merged);
    },
    [body, onChange, readOnly],
  );

  const handleIconChange = useCallback(
    (icon: string) => {
      writeFrontmatter({ ...frontmatter, icon });
    },
    [frontmatter, writeFrontmatter],
  );

  const handleCoverChange = useCallback(
    (cover: string) => {
      if (cover.length === 0) {
        const next = { ...frontmatter };
        delete next.cover;
        writeFrontmatter(next);
        return;
      }
      writeFrontmatter({ ...frontmatter, cover });
    },
    [frontmatter, writeFrontmatter],
  );

  const handleBodyChange = useCallback(
    (md: string) => {
      if (readOnly) return;
      const merged = serializeFrontmatter({ frontmatter, body: md });
      onChange(merged);
    },
    [frontmatter, onChange, readOnly],
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <div
        className="flex items-center gap-2 py-2"
        data-testid="wiki-page-editor-controls"
      >
        <IconPickerPopover
          value={
            typeof frontmatter.icon === "string" ? frontmatter.icon : undefined
          }
          onChange={handleIconChange}
          disabled={readOnly}
        />
        <CoverPickerPopover
          wikiId={wikiId}
          value={
            typeof frontmatter.cover === "string"
              ? frontmatter.cover
              : undefined
          }
          onChange={handleCoverChange}
          disabled={readOnly}
        />
      </div>
      <div className="flex-1 min-h-0">
        <DocumentEditor
          key={path}
          initialContent={body}
          onChange={handleBodyChange}
          readOnly={readOnly}
        />
      </div>
    </div>
  );
}
