import { useCallback, useMemo } from "react";
import {
  Folder9FolderEditor,
  type Folder9Permission,
  type Folder9RenderFileArgs,
} from "@/components/folder9-editor/Folder9FolderEditor";
import { DocumentEditor } from "@/components/documents/DocumentEditor";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentUser } from "@/hooks/useAuth";
import { useSelectedWorkspaceId } from "@/stores/useWorkspaceStore";
import { routineFolderApi } from "@/services/api/folder9-folder";
import type { RoutineDetail } from "@/types/routine";
import { SkillMdEditor } from "./SkillMdEditor";

export interface RoutineSkillFolderTabProps {
  /**
   * Routine the editor is bound to. Must have `folderId` populated;
   * routines created before the folder9 migration have a null
   * `folderId` and surface a placeholder until the backfill runs.
   */
  routine: RoutineDetail;
}

/**
 * Routine settings → skill folder tab.
 *
 * Mounts the generic `<Folder9FolderEditor>` shell over a routine's
 * `/v1/routines/:id/folder/*` proxy and provides a routine-flavoured
 * `renderFile` slot:
 *
 *  - `SKILL.md` → composite editor (`<SkillMdEditor>`) with read-only
 *    name, description input synced to `routines.description`, and a
 *    `<DocumentEditor>` for the markdown body.
 *  - `references/*.md` → `<DocumentEditor>` (Lexical) — the same
 *    editor every other markdown surface uses.
 *  - `scripts/*` → monospace `<Textarea>` for shell / Python content.
 *  - other text → falls through to the shell's textarea fallback,
 *    which stays readOnly when permission==="read".
 *  - binary → falls through to the shell's "Binary file" placeholder.
 *
 * Permission resolution: v1 is tenant-membership-only — any member of
 * `routine.tenantId` can write, everyone else gets read. This matches
 * the Phase A.6 server-side gate exactly so the UI never offers an
 * affordance the server would reject.
 *
 * Approval mode: routines don't carry a per-folder approval flag yet,
 * so we hard-code `"auto"` until the schema acquires one. The shell
 * still goes through the propose pipeline if a future routine row
 * sets `approvalMode: "review"`.
 */
export function RoutineSkillFolderTab({ routine }: RoutineSkillFolderTabProps) {
  const { data: currentUser, isLoading: isCurrentUserLoading } =
    useCurrentUser();
  const workspaceId = useSelectedWorkspaceId();

  // v1 permission: tenant membership ↔ write permission. The current
  // User DTO doesn't expose `tenantId` to the client, but routines
  // can only be fetched (and therefore reach this component) when the
  // current user is a member of the routine's tenant — the server
  // enforces this on every routine endpoint. Authenticated user is
  // therefore equivalent to tenant member for this surface.
  //
  // I12 — flicker guard: while `useCurrentUser` is still loading
  // (data: undefined), the old code dropped to read-mode for one
  // render, mounted the editor, then re-rendered into write-mode once
  // the user resolved. That's expensive (DocumentEditor's mount path
  // is non-trivial) AND visibly jittery. Defer mounting the editor
  // until we've actually resolved the user — see `if
  // (isCurrentUserLoading)` below.
  const canEdit = !!currentUser;
  const permission: Folder9Permission = canEdit ? "write" : "read";

  const api = useMemo(() => routineFolderApi(routine.id), [routine.id]);

  const userId = currentUser?.id ?? null;
  // Compose a workspace-scoped layout so the user's in-flight drafts
  // survive a tab close. `useFolderDraft` base64-encodes the path
  // component on top of this prefix.
  //
  // Anonymous viewers (no user, e.g. the read-only mode test path)
  // can't have drafts but still need the shell to render — fall back
  // to a stable read-only key in that case so the shell mounts.
  const draftKey =
    workspaceId && userId
      ? `routine.${workspaceId}.${routine.id}.${userId}`
      : workspaceId
        ? `routine.${workspaceId}.${routine.id}.anon`
        : null;

  const renderFile = useCallback(
    (args: Folder9RenderFileArgs) => {
      // Binary files: fall through to the shell's placeholder.
      if (args.encoding !== "text") return undefined;

      if (args.path === "SKILL.md") {
        return (
          <SkillMdEditor
            routine={routine}
            content={args.content}
            readOnly={args.readOnly}
            onChange={args.onChange}
          />
        );
      }

      if (
        args.path.startsWith("references/") &&
        args.path.toLowerCase().endsWith(".md")
      ) {
        return (
          <DocumentEditor
            key={args.path}
            initialContent={args.content}
            onChange={args.readOnly ? undefined : args.onChange}
            readOnly={args.readOnly}
          />
        );
      }

      if (args.path.startsWith("scripts/")) {
        return (
          <Textarea
            data-testid="routine-script-editor"
            className="w-full h-full font-mono text-sm bg-background"
            value={args.content}
            readOnly={args.readOnly}
            onChange={(e) => args.onChange(e.target.value)}
          />
        );
      }

      // Other text files (e.g. random `.txt` someone dropped in) — let
      // the shell render its textarea fallback, but we make it
      // explicitly read-only here so users don't think arbitrary text
      // edits are part of the SKILL contract.
      if (args.path.toLowerCase().endsWith(".md")) {
        // Stray markdown outside `references/` falls through to the
        // shell's default DocumentEditor renderer.
        return undefined;
      }

      return (
        <Textarea
          data-testid="routine-readonly-text"
          className="w-full h-full font-mono text-xs bg-muted/30"
          value={args.content}
          readOnly
          aria-readonly="true"
        />
      );
    },
    [routine],
  );

  // Routine doesn't have a folder yet — surface a stable placeholder
  // instead of mounting the shell with a fake folder id (which would
  // pop a 404 on every render). The migration backfills this column
  // for legacy rows; once that lands every routine has one.
  if (!routine.folderId) {
    return (
      <div
        className="p-4 text-xs text-muted-foreground"
        data-testid="routine-skill-folder-empty"
      >
        Skill folder is not yet provisioned.
      </div>
    );
  }

  // I12 — defer the editor mount while currentUser is loading.
  // Rendering with `canEdit = false` here would briefly mount the
  // DocumentEditor in read-mode, then re-mount it in write-mode once
  // the user query resolves. That's flicker-y AND expensive. Render a
  // lightweight placeholder until we know what permission to mount
  // with.
  if (isCurrentUserLoading) {
    return (
      <div
        className="p-4 text-xs text-muted-foreground"
        data-testid="routine-skill-folder-loading"
      >
        Loading…
      </div>
    );
  }

  if (!draftKey) {
    // Wait for the workspace + user identity to load so we don't
    // namespace drafts under a stale (or missing) key.
    return null;
  }

  return (
    <div
      className="flex flex-col h-full min-h-0"
      data-testid="routine-skill-folder-tab"
    >
      <Folder9FolderEditor
        folderId={routine.folderId}
        permission={permission}
        approvalMode="auto"
        api={api}
        draftKey={draftKey}
        initialPath="SKILL.md"
        renderFile={renderFile}
        // Routines have no external file tree (unlike the wiki workspace
        // sub-sidebar), so we keep the shell's built-in tree.
        hideTree={false}
      />
    </div>
  );
}
