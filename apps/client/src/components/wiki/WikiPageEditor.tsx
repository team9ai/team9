import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { DocumentEditor } from "@/components/documents/DocumentEditor";
import { useWikiDraft } from "@/hooks/useWikiDraft";
import { useCurrentUser } from "@/hooks/useAuth";
import { resolveClientPermission } from "@/lib/wiki-permission";
import { IconPickerPopover } from "./IconPickerPopover";
import { CoverPickerPopover } from "./CoverPickerPopover";
import type { PageDto, WikiDto } from "@/types/wiki";

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
 *
 * The Save flow is intentionally *not* wired here. `WikiPageView` owns
 * the status bar slot and Task 19 is where the commit mutation lands —
 * it will thread a save() through to this component (or move this
 * component's state up, depending on the cleanest Task-19 shape).
 */
export function WikiPageEditor({
  wikiId,
  path,
  serverPage,
  wiki,
}: WikiPageEditorProps) {
  const { data: currentUser } = useCurrentUser();
  const perm = resolveClientPermission(wiki, currentUser ?? null);
  const readOnly = perm === "read";

  const { draft, setDraft, isDirty, hasStaleAlert, dismissStaleAlert } =
    useWikiDraft(wikiId, path, {
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

  // When useWikiDraft finishes its async reconciliation and surfaces a
  // draft (e.g. the stale-alert path), hydrate local state from the draft
  // so the edit view reflects the user's last work. We guard with `isDirty`
  // to avoid clobbering in-flight edits with a stale draft value on
  // re-render.
  useEffect(() => {
    if (!draft) return;
    setBody((prev) => (prev === draft.body ? prev : draft.body));
    setFrontmatter((prev) =>
      prev === draft.frontmatter ? prev : draft.frontmatter,
    );
    // `setBody` / `setFrontmatter` are stable from `useState`; the
    // effect's only real input is `draft`.
  }, [draft]);

  // Remote-update reset: if the server page changes (e.g. another user
  // committed) and we're not dirty, reflect the new truth. Dirty users
  // keep their local edits; Task 19 offers a reconcile UI when they save.
  useEffect(() => {
    if (isDirty) return;
    setBody(serverPage.content);
    setFrontmatter(serverPage.frontmatter);
  }, [serverPage, isDirty]);

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

  return (
    <div
      data-testid="wiki-page-editor"
      className="flex-1 flex flex-col min-h-0"
    >
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
          <div className="flex-1">
            You have unsaved local changes. Viewing your draft.
          </div>
          <button
            type="button"
            aria-label="Dismiss stale draft warning"
            onClick={dismissStaleAlert}
            data-testid="wiki-page-stale-alert-dismiss"
            className="text-muted-foreground hover:text-foreground"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <div className="flex-1 px-12 pb-8 min-h-0">
        <DocumentEditor
          initialContent={body}
          onChange={handleBodyChange}
          readOnly={readOnly}
        />
      </div>
    </div>
  );
}
