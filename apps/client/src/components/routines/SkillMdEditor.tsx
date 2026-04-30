import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DocumentEditor } from "@/components/documents/DocumentEditor";
import { parseFrontmatter, serializeFrontmatter } from "@/lib/wiki-frontmatter";
import { routinesApi } from "@/services/api/routines";
import type { RoutineDetail } from "@/types/routine";

/**
 * First two segments of a UUID (mirrors the server-side helper at
 * `apps/server/apps/task-worker/src/folder9/provision-routine-folder.ts`).
 *
 * Example: `slugifyUuid("7f3a2b1c-1111-2222-3333-444455556666")` →
 * `"7f3a2b1c-1111"`.
 *
 * Inlined here (rather than imported) because the server-side helper
 * lives in a different package and the conversion is trivial; both
 * sides MUST stay in lockstep — change one and update the other.
 */
export function slugifyUuid(id: string): string {
  return id.split("-").slice(0, 2).join("-");
}

/**
 * Compute the canonical SKILL.md `name` frontmatter value for a routine.
 * Always derived from the routine id — never trusted from frontmatter,
 * which could have been edited by the model and gone stale.
 */
export function expectedSkillName(routineId: string): string {
  return `routine-${slugifyUuid(routineId)}`;
}

export interface SkillMdEditorProps {
  /**
   * Routine the SKILL.md belongs to. We use `routine.id` to compute the
   * (read-only) skill name and `routine.description` as the source of
   * truth for the editable description field — these two are kept in
   * sync on save: PATCH /v1/routines/:id followed by a folder commit.
   */
  routine: RoutineDetail;
  /**
   * Current SKILL.md body as the shell stores it (frontmatter fence
   * + markdown body). The editor parses this into frontmatter +
   * body on render and re-serializes on save.
   */
  content: string;
  /**
   * Read-only when `true`. All edit affordances are disabled and the
   * Save button is hidden. Tracks the shell's `permission === "read"`.
   */
  readOnly: boolean;
  /**
   * Push a new SKILL.md body up into the shell's draft state. The
   * shell handles localStorage persistence + commit pipeline; this
   * editor only emits the rebuilt source after a successful PATCH.
   */
  onChange: (next: string) => void;
}

/**
 * Composite editor for a routine's `SKILL.md`.
 *
 * The file has two pieces of state that live in different places:
 *
 *  - `frontmatter.name` is fully derived from the routine id. We render
 *    it as a read-only label (`routine-${slugifyUuid(routine.id)}`).
 *  - `frontmatter.description` is the source-of-truth mirror of
 *    `routines.description` in the database. Saving here PATCHes the
 *    routines row first, then commits the regenerated SKILL.md so the
 *    two stay in lockstep. PATCH-first ordering means a PATCH failure
 *    leaves both copies untouched, while a commit failure leaves
 *    routines.description ahead of the file (next save reconciles).
 *  - The body is plain markdown, edited via `<DocumentEditor>` like
 *    every other `.md` file in the folder.
 */
export function SkillMdEditor({
  routine,
  content,
  readOnly,
  onChange,
}: SkillMdEditorProps) {
  const { t } = useTranslation("routines");
  const queryClient = useQueryClient();

  const expectedName = useMemo(
    () => expectedSkillName(routine.id),
    [routine.id],
  );

  const parsed = useMemo(() => {
    try {
      return parseFrontmatter(content);
    } catch {
      // Malformed frontmatter → fall back to the raw content as the
      // body so the user can at least see and edit it.
      return { frontmatter: {} as Record<string, unknown>, body: content };
    }
  }, [content]);

  const fileFrontmatterDescription =
    typeof parsed.frontmatter.description === "string"
      ? parsed.frontmatter.description
      : "";

  // Local form state. Description seeded from the server-side routine
  // record (the source of truth) — falling back to the file-side copy
  // for routines that were created before the sync rule existed.
  const [description, setDescription] = useState<string>(
    routine.description ?? fileFrontmatterDescription,
  );
  const [bodyText, setBodyText] = useState<string>(parsed.body);

  // The shell hands us `content` as it loads — initially the empty
  // string, then the fetched blob body. Track whether the user has
  // touched either field so we don't clobber in-flight edits when
  // the shell hydrates a server snapshot. `bodyDirtyRef` is set the
  // first time the user types into the body editor; from then on
  // we leave `bodyText` alone even if `content` changes underneath.
  const descriptionDirtyRef = useRef(false);
  const bodyDirtyRef = useRef(false);

  // Re-seed description when routine row updates (different routine,
  // or the routine.description column changed). Leave user-in-flight
  // edits alone.
  useEffect(() => {
    if (descriptionDirtyRef.current) return;
    setDescription(routine.description ?? "");
  }, [routine.id, routine.description]);

  // Re-seed bodyText when the shell hands us a new server snapshot
  // (typical sequence: empty → loaded blob → maybe-refetch). Leave
  // user-in-flight edits alone.
  useEffect(() => {
    if (bodyDirtyRef.current) return;
    setBodyText(parsed.body);
  }, [parsed.body, routine.id]);

  const handleDescriptionChange = useCallback((value: string) => {
    descriptionDirtyRef.current = true;
    setDescription(value);
  }, []);

  const handleBodyChange = useCallback((value: string) => {
    bodyDirtyRef.current = true;
    setBodyText(value);
  }, []);

  const updateRoutine = useMutation({
    mutationFn: (next: { description: string }) =>
      routinesApi.update(routine.id, next),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["routine", routine.id] });
      void queryClient.invalidateQueries({ queryKey: ["routines"] });
    },
  });

  const isDirty =
    description !== (routine.description ?? "") || bodyText !== parsed.body;

  const handleSave = useCallback(async () => {
    if (readOnly) return;
    if (updateRoutine.isPending) return;

    // PATCH first so the routines row becomes the source of truth
    // before we cement the change in the file. If PATCH fails, the
    // commit never fires and the user can retry without diverging.
    if (description !== (routine.description ?? "")) {
      try {
        await updateRoutine.mutateAsync({ description });
      } catch {
        // mutation surfaces its own error state via React Query; we
        // bail without committing so the file copy doesn't drift
        // ahead of the routines row.
        return;
      }
    }

    const nextFrontmatter: Record<string, unknown> = {
      ...parsed.frontmatter,
      name: expectedName,
      description,
    };
    const nextSource = serializeFrontmatter({
      frontmatter: nextFrontmatter,
      body: bodyText,
    });
    onChange(nextSource);
  }, [
    bodyText,
    description,
    expectedName,
    onChange,
    parsed.frontmatter,
    readOnly,
    routine.description,
    updateRoutine,
  ]);

  return (
    <div
      className="flex flex-col gap-3 h-full min-h-0"
      data-testid="routine-skill-md-editor"
    >
      <div className="flex flex-col gap-1">
        <Label className="text-xs text-muted-foreground">
          {t("settingsTab.skillNameLabel", { defaultValue: "Skill name" })}
        </Label>
        <Input
          data-testid="routine-skill-name"
          value={expectedName}
          readOnly
          aria-readonly="true"
          className="h-8 text-xs font-mono bg-muted/50"
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label
          htmlFor="routine-skill-description"
          className="text-xs text-muted-foreground"
        >
          {t("settingsTab.skillDescriptionLabel", {
            defaultValue: "Description",
          })}
        </Label>
        <Input
          id="routine-skill-description"
          data-testid="routine-skill-description"
          value={description}
          disabled={readOnly}
          onChange={(e) => handleDescriptionChange(e.target.value)}
          className="h-8 text-xs"
        />
      </div>

      {!readOnly && (
        <div className="flex justify-end">
          <Button
            size="sm"
            data-testid="routine-skill-save"
            disabled={!isDirty || updateRoutine.isPending}
            onClick={() => void handleSave()}
          >
            <Save className="w-3 h-3 mr-1" />
            {t("settingsTab.skillSave", { defaultValue: "Save" })}
          </Button>
        </div>
      )}

      <div className="flex-1 min-h-0">
        <DocumentEditor
          key={routine.id}
          initialContent={bodyText}
          onChange={readOnly ? undefined : handleBodyChange}
          readOnly={readOnly}
        />
      </div>
    </div>
  );
}
