-- Make workspace_wikis.(workspace_id, slug) unique ONLY for non-archived
-- rows. Previously the full unique index forced archived wikis to permanently
-- reserve their slug, so a user who archived `team-handbook` could never
-- create another wiki with that slug — even though from the product's
-- perspective the name is free again.
--
-- The partial index releases the slug on archive: multiple archived rows may
-- share (workspace_id, slug), but at most one active (archived_at IS NULL)
-- row may hold it at any time.
--
-- Matches the logic in wikis.service.ts#createWiki, which now filters the
-- pre-check by `archived_at IS NULL` so the API and the DB constraint agree.
DROP INDEX IF EXISTS "workspace_wikis_workspace_slug_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_wikis_workspace_slug_unique"
  ON "workspace_wikis" ("workspace_id", "slug")
  WHERE "archived_at" IS NULL;
