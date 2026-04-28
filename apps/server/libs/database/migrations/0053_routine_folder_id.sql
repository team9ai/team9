-- routine__routines.folder_id: forward link from a routine to its folder9
-- managed skill folder (Anthropic SKILL.md convention). Phase A.1 of the
-- routine→folder9-skill migration (see
-- docs/superpowers/specs/2026-04-27-routine-skill-folder-design.md in the
-- team9-agent-pi repo).
--
-- Nullable because:
--   1) Existing rows start NULL until Layer 1 batch migrates or Layer 2
--      lazy-provisions them via ensureRoutineFolder.
--   2) New rows are momentarily NULL inside the creation transaction
--      between the routine INSERT and the post-folder9 UPDATE.
--
-- The legacy document_content / document_id columns stay as-is. They are
-- marked @deprecated in the ORM schema and will be dropped in a follow-up
-- PR after rollout stabilizes.
ALTER TABLE "routine__routines"
  ADD COLUMN IF NOT EXISTS "folder_id" uuid;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_routines_folder_id"
  ON "routine__routines" ("folder_id")
  WHERE "folder_id" IS NOT NULL;
