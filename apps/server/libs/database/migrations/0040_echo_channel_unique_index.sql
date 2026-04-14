-- Echo channel hardening: drop orphans + enforce 1-per-(owner, tenant)
--
-- Background: getOrCreateEchoChannel had a TOCTOU race where two concurrent
-- self-chat creates from the same user could both miss the existence check
-- and both INSERT a new im_channels row. There was no DB constraint to
-- serialize them, so duplicate echo channels could accumulate. The earlier
-- application-level fix (commit 7a8a974f) made each individual call atomic
-- and self-healing, but did not prevent the race; this migration closes
-- that gap with a partial unique index.
--
-- Step 1: delete orphaned active echo channels (no active member row).
--   These are leftovers from the pre-fix bug where addMember failed
--   mid-flight and left a channel row with no membership. The
--   `is_archived = false` filter prevents accidentally deleting any
--   archived rows that happen to also have no active members — even
--   though the application currently blocks archiving echo channels,
--   keeping the DELETE scope tight matches the index scope and stays
--   safe under future application changes.
--
-- Step 2: add a partial unique index on (created_by, tenant_id) for
--   active echo channels. NULLS NOT DISTINCT (PG15+) treats NULL
--   tenants as equal, so a user without a workspace also gets exactly
--   one echo channel. The index excludes archived rows so a user can
--   re-create their echo channel after archiving the old one (should
--   the application policy ever change to permit echo archive).
--
-- Both statements are wrapped in the drizzle migration runner's
-- per-migration transaction, so a failure in step 2 rolls back step 1.
-- If you ever apply this file with raw `psql -f`, you must wrap it in
-- BEGIN/COMMIT yourself to preserve atomicity.

DELETE FROM im_channels c
WHERE c.type = 'echo'
  AND c.is_archived = false
  AND NOT EXISTS (
    SELECT 1 FROM im_channel_members cm
    WHERE cm.channel_id = c.id AND cm.left_at IS NULL
  );
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_echo_unique_owner_tenant"
  ON "im_channels" USING btree ("created_by", "tenant_id") NULLS NOT DISTINCT
  WHERE "type" = 'echo' AND "is_archived" = false;
