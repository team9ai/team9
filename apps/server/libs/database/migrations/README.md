# Database migrations

Drizzle-kit-managed PostgreSQL migrations. Run them with the standard
workflow:

```bash
pnpm --filter @team9/database db:generate   # diff schemas → new migration
pnpm --filter @team9/database db:migrate    # apply pending migrations
```

## Snapshot history

Drizzle-kit writes one `meta/<idx>_snapshot.json` per migration. It only
diffs the **latest** snapshot against the current schema, so the
canonical baseline is `meta/<latest>_snapshot.json`.

Earlier snapshots in this directory have gaps and at least one wrong
`prevId` chain — they accumulated through partial commits and
out-of-order migration regenerations. Cleaning up the historical chain
would require replaying every migration on a clean database, which
isn't worth it: drizzle never rewinds the chain in normal use.

If you regenerate a migration and drizzle-kit complains that two
snapshots claim the same parent (collision), the fix is to delete the
broken snapshot file (the one whose `prevId` is the most recent
snapshot's `id`) and re-run `db:generate`. The latest snapshot is the
only one that needs to faithfully represent the current schema.

## Adding a new table — the actual workflow

The "Adding a New Database Table" section of the root `CLAUDE.md` calls
out steps 1-4. The catch is that step 3 (`pnpm db:generate`) will
include drift from the historical gaps — not just your new table. To
avoid landing migrations that re-create existing objects:

1. Run `pnpm db:generate` and inspect the auto-generated SQL.
2. If it contains anything besides your intended changes (drift from
   missing snapshots), discard the SQL file and write a hand-rolled
   migration containing only your changes (see `0052_hive_send_failures.sql`
   for the pattern).
3. Keep the auto-generated `meta/<idx>_snapshot.json` — it is the
   canonical baseline for the next run.
4. Rename the journal entry's `tag` to match your hand-rolled SQL
   filename (drizzle picks a random nickname; we want a descriptive one).
5. Re-run `db:generate` once more — it should report
   `No schema changes, nothing to migrate` if your snapshot is clean.

After this, drizzle's diff is faithful again until the next out-of-order
regeneration.
