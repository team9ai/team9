import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DocumentEditor } from "@/components/documents/DocumentEditor";
import { useWikiDraft } from "@/hooks/useWikiDraft";
import { useWikiImageUpload } from "@/hooks/useWikiImageUpload";
import { useCurrentUser } from "@/hooks/useAuth";
import { useCommitWikiPage } from "@/hooks/useWikiPage";
import { resolveClientPermission } from "@/lib/wiki-permission";
import { serializeFrontmatter } from "@/lib/wiki-frontmatter";
import { getHttpErrorStatus } from "@/lib/http-error";
import i18n from "@/i18n";
import { wikiActions } from "@/stores/useWikiStore";
import { IconPickerPopover } from "./IconPickerPopover";
import { CoverPickerPopover } from "./CoverPickerPopover";
import { WikiStatusBar } from "./WikiStatusBar";
import {
  SubmitForReviewDialog,
  type SubmitForReviewInput,
} from "./SubmitForReviewDialog";
import type { PageDto, WikiDto } from "@/types/wiki";

/**
 * Translate a commit-mutation error into a user-facing message. 409 means
 * the server's copy moved under us; 403 means the permission check failed
 * server-side (shouldn't happen for write/propose users but we defend in
 * depth). Anything else is a generic failure.
 *
 * Uses the shared `i18n.t` accessor (rather than the hook's bound `t`) so
 * the helper can stay a plain function outside the component closure — the
 * wiki namespace is eagerly registered in `@/i18n`, so `t` is safe to call
 * at module scope. Matches the `CreateWikiDialog` pattern for consistency.
 */
function saveErrorMessage(error: unknown): string {
  const status = getHttpErrorStatus(error);
  if (status === 409) {
    return i18n.t("wiki:editor.errors.saveConflict");
  }
  if (status === 403) {
    return i18n.t("wiki:editor.errors.saveForbidden");
  }
  return i18n.t("wiki:editor.errors.saveFailed");
}

export interface WikiPageEditorProps {
  wikiId: string;
  path: string;
  serverPage: PageDto;
  wiki: WikiDto;
}

/**
 * Composite Wiki page editor.
 *
 * Responsibilities:
 *  - Derive the effective permission (read / propose / write) from
 *    `wiki` + current user; flip DocumentEditor + both pickers into
 *    read-only when the user is a viewer.
 *  - Hold local `body` + `frontmatter` state. Seed from the persisted
 *    draft (when present; `useWikiDraft` does the stale-check first) or
 *    from the server page otherwise. If the server refreshes the page
 *    (new commit, another user) and we're *not* dirty, re-seed — otherwise
 *    keep the user's edits in place.
 *  - Mirror every edit into `useWikiDraft.setDraft`. The hook debounces
 *    the localStorage write for us.
 *  - Surface the stale-alert banner when the hook reports a newer local
 *    draft than the server copy (the hook only raises this on mount /
 *    key change — we trust it to clear the flag once the user decides).
 *  - Drive the commit mutation. Auto-mode commits inline; review-mode
 *    opens `SubmitForReviewDialog` first. On success, clear the draft
 *    (auto) or record the proposal id (review). On failure, surface an
 *    actionable message via `alert()` (the project's current
 *    notification convention — see `HomeMainContent.tsx`).
 *  - Listen for Cmd/Ctrl+S while the editor is mounted and trigger the
 *    save flow exactly like clicking the Save button would.
 */
export function WikiPageEditor({
  wikiId,
  path,
  serverPage,
  wiki,
}: WikiPageEditorProps) {
  const { t } = useTranslation("wiki");
  const { data: currentUser } = useCurrentUser();
  const perm = resolveClientPermission(wiki, currentUser ?? null);
  const readOnly = perm === "read";
  const isReview = wiki.approvalMode === "review";

  const {
    draft,
    setDraft,
    clearDraft,
    isDirty,
    hasStaleAlert,
    dismissStaleAlert,
  } = useWikiDraft(wikiId, path, {
    body: serverPage.content,
    frontmatter: serverPage.frontmatter,
    lastCommitTime: serverPage.lastCommit?.timestamp ?? null,
  });

  // Seed from draft when present (useWikiDraft has already decided the
  // draft is worth keeping), else from the server page.
  const [body, setBody] = useState<string>(
    () => draft?.body ?? serverPage.content,
  );
  const [frontmatter, setFrontmatter] = useState<Record<string, unknown>>(
    () => draft?.frontmatter ?? serverPage.frontmatter,
  );

  // Monotonic re-seed generation. Bumped ONLY on explicit re-seed events
  // AFTER the initial mount (async draft arrival, server commit while
  // clean). Combined with `path`, this drives a `key` on `DocumentEditor`
  // so its one-shot `InitialContentPlugin` re-ingests `initialContent`
  // on seed events. User typing must NOT bump this (or the editor would
  // remount on every keystroke and lose focus).
  //
  // The initial mount is already correctly seeded via `useState(() =>
  // draft?.body ?? serverPage.content)`, so both effects below skip their
  // first invocation to avoid a spurious remount on mount.
  const [seedGen, setSeedGen] = useState(0);
  const draftSeededRef = useRef(!!draft);
  const serverSeededRef = useRef(true);

  // When useWikiDraft finishes its async reconciliation and surfaces a
  // draft (e.g. the stale-alert path), hydrate local state from the draft
  // so the edit view reflects the user's last work. Gate with a ref so we
  // seed exactly once per draft lifecycle — subsequent `draft` object
  // identity changes (e.g. debounced setDraft from user typing) must not
  // re-trigger the seed or remount the editor.
  useEffect(() => {
    if (!draft) {
      // Draft cleared (e.g. clearDraft after commit). Reset the flag so a
      // later draft re-arrival (e.g. user types again) can seed again.
      draftSeededRef.current = false;
      return;
    }
    if (draftSeededRef.current) return;
    draftSeededRef.current = true;
    setBody(draft.body);
    setFrontmatter(draft.frontmatter);
    setSeedGen((g) => g + 1);
  }, [draft]);

  // Remote-update reset: if the server page changes (e.g. another user
  // committed) and we're not dirty, reflect the new truth AND remount the
  // editor (via seedGen bump) so its Lexical state picks up the new
  // `initialContent`. Dirty users keep their local edits; Task 19 offers
  // a reconcile UI when they save. Skip on mount — the initial useState
  // already handled seeding.
  useEffect(() => {
    if (serverSeededRef.current) {
      serverSeededRef.current = false;
      return;
    }
    if (isDirty) return;
    setBody(serverPage.content);
    setFrontmatter(serverPage.frontmatter);
    setSeedGen((g) => g + 1);
  }, [serverPage, isDirty]);

  // Remount key. Changes when:
  //   - `path` changes (defense in depth; the parent already re-mounts
  //     WikiPageEditor on path change via the splat route).
  //   - `seedGen` bumps (explicit re-seed: server commit while clean, or
  //     async draft arrival — the two effects above batch the `setBody`
  //     / `setFrontmatter` / `setSeedGen` updates so a single remount
  //     picks up the fresh `initialContent`).
  // Stable across user typing: `setDraft` firing on every keystroke does
  // not bump `seedGen` (the `draftSeededRef` gate holds), so the editor
  // stays mounted and the Lexical cursor/focus is preserved.
  const editorKey = `${path}-${seedGen}`;

  function handleBodyChange(md: string) {
    if (readOnly) return;
    setBody(md);
    setDraft({ body: md, frontmatter });
  }

  function handleFrontmatterChange(next: Record<string, unknown>) {
    if (readOnly) return;
    setFrontmatter(next);
    setDraft({ body, frontmatter: next });
  }

  const handleIconChange = (icon: string) => {
    handleFrontmatterChange({ ...frontmatter, icon });
  };

  const handleCoverChange = (cover: string) => {
    if (cover.length === 0) {
      // Explicit remove — drop the key so the serialized frontmatter
      // stays tidy (no trailing `cover: ""`).
      const next = { ...frontmatter };
      delete next.cover;
      handleFrontmatterChange(next);
      return;
    }
    handleFrontmatterChange({ ...frontmatter, cover });
  };

  // --- Image paste / drop upload (Task 22) -------------------------------
  //
  // We attach paste + drop handlers to a wrapper `<div>` around the
  // `DocumentEditor`. React synthetic events bubble through Lexical's own
  // internal handling well enough for the common case: native paste/drop
  // events on the contenteditable root are dispatched to the React tree, and
  // we preventDefault()-gate so Lexical never sees the image payload itself.
  //
  // MVP deviation from the plan: the resulting markdown is appended to the
  // END of the body, not inserted at the cursor. The plan calls out cursor-
  // position insertion via Lexical's imperative API; that requires plumbing
  // a ref through `DocumentEditor` which is outside this task's scope. End-
  // append is still dirty-flag-correct and round-trips through the usual
  // save flow, so the committed page always gets the image reference.

  const imageUpload = useWikiImageUpload(wikiId);

  // Latest-body ref so the async upload completion can compose the new body
  // on top of whatever the user has typed since we started the upload
  // (handlePaste captures `body` at the moment of paste; we want the latest).
  const latestBodyRef = useRef(body);
  useEffect(() => {
    latestBodyRef.current = body;
  }, [body]);

  const handleImageUpload = useCallback(
    async (file: File) => {
      try {
        const path = await imageUpload.upload(file, "attachments");
        const markdown = `![${file.name}](${path})`;
        const current = latestBodyRef.current;
        const newBody = current
          ? `${current}\n\n${markdown}\n`
          : `${markdown}\n`;
        handleBodyChange(newBody);
      } catch (err) {
        notify(
          err instanceof Error ? err.message : t("editor.notifyUploadFailed"),
        );
      }
    },
    // `handleBodyChange` is a stable-enough reference (it reads the latest
    // frontmatter from closure, which is fine for our usage). We intentionally
    // omit it from deps to keep the callback identity stable across renders;
    // the functional path via `latestBodyRef` is the source of truth for
    // body composition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [imageUpload],
  );

  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    if (readOnly) return;
    const items = e.clipboardData?.items;
    if (!items || items.length === 0) return;
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (item.kind === "file" && item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) void handleImageUpload(file);
      }
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    if (readOnly) return;
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    const imageFiles = Array.from(files).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (imageFiles.length === 0) return;
    e.preventDefault();
    for (const file of imageFiles) {
      void handleImageUpload(file);
    }
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (readOnly) return;
    // Required to make the element a valid drop target in HTML5.
    e.preventDefault();
  }

  // --- Save flow ---------------------------------------------------------

  const commit = useCommitWikiPage(wikiId);
  const [isReviewDialogOpen, setReviewDialogOpen] = useState(false);

  const canSave = !readOnly;

  // Notify the user via the project's current toast surface — plain
  // window.alert (see HomeMainContent.tsx, members.tsx). This is a React
  // component so we only ever execute in a browser environment; no SSR
  // guard needed. When/if a real toast component lands, swap the two call
  // sites inside runCommit one-for-one.
  function notify(message: string) {
    window.alert(message);
  }

  // Perform the actual commit. `reviewInput` is present only for review-
  // mode submissions (the dialog collects it first). We serialize the
  // current frontmatter + body back into a markdown source the server
  // understands.
  const runCommit = useCallback(
    async (reviewInput?: SubmitForReviewInput) => {
      const propose = !!reviewInput;
      const content = serializeFrontmatter({ frontmatter, body });
      const message = reviewInput?.title.trim() || `Update ${path}`;
      try {
        const result = await commit.mutateAsync({
          message,
          files: [{ path, content, action: "update" }],
          propose,
        });
        if (result.proposal) {
          // Review mode: keep the draft so the user can iterate on
          // reviewer feedback without losing their edits.
          wikiActions.setSubmittedProposal(wikiId, path, result.proposal.id);
          setReviewDialogOpen(false);
          notify(t("editor.notifySubmitted"));
          return;
        }
        // Auto mode: draft is now part of the server copy.
        clearDraft();
        setReviewDialogOpen(false);
        notify(t("editor.notifySaved"));
      } catch (error) {
        // Keep the dialog open so the user can retry without re-typing.
        notify(saveErrorMessage(error));
      }
    },
    [body, frontmatter, path, wikiId, commit, clearDraft, t],
  );

  // Top-level save trigger. Routes through the dialog when the Wiki is in
  // review mode and the user hasn't supplied proposal metadata yet.
  const handleSave = useCallback(
    (reviewInput?: SubmitForReviewInput) => {
      if (!canSave) return;
      if (commit.isPending) return;
      if (!reviewInput && !isDirty) return;
      if (isReview && !reviewInput) {
        setReviewDialogOpen(true);
        return;
      }
      void runCommit(reviewInput);
    },
    [canSave, commit.isPending, isDirty, isReview, runCommit],
  );

  // Cmd+S / Ctrl+S shortcut. Mirrors the Save button's behaviour so power
  // users never have to reach for the mouse. We stop the browser's default
  // "save page as…" dialog regardless of dirty state so a clean doc doesn't
  // suddenly offer a download; only *triggering* the save is gated.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isSaveShortcut =
        (e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "S");
      if (!isSaveShortcut) return;
      e.preventDefault();
      handleSave();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSave]);

  return (
    <div
      data-testid="wiki-page-editor"
      className="flex-1 flex flex-col min-h-0"
    >
      <WikiStatusBar
        lastSavedAt={serverPage.lastCommit?.timestamp ?? null}
        isDirty={isDirty}
        isSaving={commit.isPending}
        canSave={canSave}
        onSave={() => handleSave()}
      />

      <div
        className="flex items-center gap-2 px-12 py-2"
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

      {hasStaleAlert && (
        <div
          role="alert"
          data-testid="wiki-page-stale-alert"
          className="mx-12 mb-2 px-3 py-2 flex items-start gap-2 text-xs border border-yellow-400/60 bg-yellow-50 dark:bg-yellow-500/10 rounded"
        >
          <AlertTriangle
            size={14}
            className="mt-0.5 shrink-0 text-yellow-600"
          />
          <div className="flex-1">{t("editor.staleAlert")}</div>
          <button
            type="button"
            aria-label={t("editor.staleDismissAria")}
            onClick={dismissStaleAlert}
            data-testid="wiki-page-stale-alert-dismiss"
            className="text-muted-foreground hover:text-foreground"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <div
        className="flex-1 px-12 pb-8 min-h-0"
        data-testid="wiki-page-editor-drop-zone"
        onPaste={handlePaste}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        <DocumentEditor
          key={editorKey}
          initialContent={body}
          onChange={handleBodyChange}
          readOnly={readOnly}
        />
      </div>

      <SubmitForReviewDialog
        open={isReviewDialogOpen}
        onOpenChange={setReviewDialogOpen}
        onSubmit={(input) => handleSave(input)}
        isSubmitting={commit.isPending}
      />
    </div>
  );
}
