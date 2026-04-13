# Auto Migrate & Seed on Gateway Startup

**Status:** Draft
**Date:** 2026-04-08
**Author:** Winrey (w/ Claude)

## Summary

Add opt-in auto-migration and auto-seed capability to the Team9 backend.
When `AUTO_MIGRATE` / `AUTO_SEED` env vars are set to a truthy value, the
gateway will run Drizzle migrations and/or database seed before it starts
listening for HTTP traffic.

Auto-seed is **idempotent** — it only runs on a fresh (un-seeded) database.

## Motivation

Currently, running migrations on deploy requires manually invoking
`pnpm db:migrate` out-of-band. For dev, staging and first-time deployments,
we want the gateway container itself to self-bootstrap its schema so that:

- Railway/ECS-style one-shot deploys just work with no manual step.
- Fresh environments (local, CI, preview) can be spun up with a single
  `docker run` + env vars.
- A dev can reset their DB and re-launch without remembering the seed step.

The flag must stay **opt-in** (default off) so production remains under
explicit migration control.

## Scope

**In scope:**

- Gateway bootstrap hook (`apps/server/apps/gateway/src/main.ts`)
- Refactor `libs/database/src/seed.ts` to export a reusable `runSeed()`
- Seed idempotency tracking table `__seed_status`
- New env vars `AUTO_MIGRATE`, `AUTO_SEED` — lenient truthy parsing via `yn`
- `.env.example` update
- Unit tests for all new code paths

**Out of scope:**

- Auto-migrate on `im-worker` / `task-worker` — they reuse the gateway's
  already-migrated schema. If im-worker boots before gateway finishes, that
  is the status quo today (manual `pnpm db:migrate` has the same race) and
  not in scope for this change.
- Populating actual seed data. `runSeed()` remains empty of business data —
  this PR only adds the idempotency plumbing so future seed inserts can be
  dropped in without redesigning the entry point.
- Forced re-seed flag. Operators can `DELETE FROM __seed_status WHERE key = 'default'`
  if they truly need to rerun.

## Design Overview

```
gateway/src/main.ts  bootstrap()
    │
    ├─ if env.AUTO_MIGRATE → runMigrations()    (fail-fast on error)
    │
    ├─ if env.AUTO_SEED    → runSeed()          (fail-fast on error)
    │                            │
    │                            └─ advisory lock + status-table check
    │
    └─ NestFactory.create(AppModule) → app.listen()
```

Both `runMigrations` and `runSeed` live in `@team9/database` and are
imported from gateway's main module. im-worker / task-worker do **not**
import them.

## 1. Truthy Env Parsing

We adopt the [`yn`](https://www.npmjs.com/package/yn) package (v5.1.0,
~6KB) instead of hand-rolling a parser.

### Why `yn`

- Natively supports `y`/`yes`/`t`/`true`/`1`/`on` and their falsy
  counterparts `n`/`no`/`f`/`false`/`0`/`off`, all case-insensitive, all
  trimmed — verified against `yn@5.1.0` source.
- Explicit `{ default: false }` returns `false` for unknown / absent
  values instead of `undefined`.
- No hand-written parser to test or maintain.

### Changes

**`apps/server/libs/shared/package.json`** — add dependency:

```json
"dependencies": {
  "yn": "^5.1.0"
}
```

**`apps/server/libs/shared/src/env.ts`** — add two getters in the
`// Database` block, right after `POSTGRES_DB`:

```ts
import yn from 'yn';

// ... inside `env` object:

// Database Auto-Init (opt-in)
get AUTO_MIGRATE() {
  return yn(process.env.AUTO_MIGRATE, { default: false });
},
get AUTO_SEED() {
  return yn(process.env.AUTO_SEED, { default: false });
},
```

Both getters return a strict `boolean`.

## 2. Seed Refactor + Idempotency

### Current state

`libs/database/src/seed.ts` is a self-executing script:

```ts
async function seed() {
  /* empty body, just logs */
}
seed()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
```

It is **not** importable as a library function and has **no**
idempotency check.

### Target state

Split into `runSeed()` (library-callable) + a thin CLI shim that only
fires when the file is executed directly.

```ts
// libs/database/src/seed.ts
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { Logger } from "@nestjs/common";
import postgres from "postgres";
import { env } from "@team9/shared";

const SEED_KEY = "default";
// Arbitrary stable constant for pg_advisory_lock. Within JS safe-integer
// range, cast to bigint server-side via `::bigint`. Hard-coded (not
// hashtext-derived) so it can be grepped in pg_locks during debugging.
const SEED_LOCK_KEY = 9172034501;

export async function runSeed(): Promise<void> {
  const logger = new Logger("DatabaseSeed");

  const client = postgres({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.POSTGRES_DB,
    username: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,
    max: 1,
  });
  const db = drizzle(client);

  try {
    // 1. Ensure status table exists (self-bootstrapping)
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "__seed_status" (
        "key"           text        PRIMARY KEY,
        "completed_at"  timestamptz NOT NULL DEFAULT now()
      )
    `);

    // 2. Acquire transaction-scoped advisory lock so concurrent gateway
    //    instances serialise on the same seed. Released automatically at
    //    transaction end.
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(${SEED_LOCK_KEY}::bigint)`,
      );

      // 3. Check if already seeded (inside the lock)
      const rows = await tx.execute<{ key: string }>(
        sql`SELECT key FROM "__seed_status" WHERE key = ${SEED_KEY} LIMIT 1`,
      );
      if (rows.length > 0) {
        logger.log(`Seed '${SEED_KEY}' already completed, skipping`);
        return;
      }

      // 4. Run actual seed inserts — currently a no-op placeholder.
      //    Future seed data goes here, inside this same transaction.
      logger.log(`Running seed '${SEED_KEY}'...`);

      // 5. Mark as completed. ON CONFLICT is defensive: if another
      //    instance squeezed in without the lock (shouldn't happen),
      //    we just no-op instead of erroring.
      await tx.execute(
        sql`
          INSERT INTO "__seed_status" ("key") VALUES (${SEED_KEY})
          ON CONFLICT ("key") DO NOTHING
        `,
      );
      logger.log(`Seed '${SEED_KEY}' completed successfully`);
    });
  } finally {
    await client.end();
  }
}

// CLI entry — only runs when file is executed directly, not when imported.
const isDirectRun =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.endsWith(process.argv[1] ?? "");

if (isDirectRun) {
  runSeed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Seed failed:", err);
      process.exit(1);
    });
}
```

### Status table schema

```sql
CREATE TABLE "__seed_status" (
  "key"          text        PRIMARY KEY,
  "completed_at" timestamptz NOT NULL DEFAULT now()
);
```

- Table is created **by `runSeed()` itself** via `CREATE TABLE IF NOT
EXISTS`, not via a Drizzle migration file. This keeps seed and migrate
  orthogonal — seed does not depend on any specific migration having run,
  and the status table cannot drift out of sync with the seed logic.
- Double-underscore prefix mirrors Drizzle's own `__drizzle_migrations`
  convention and avoids colliding with business tables.
- `key` is `text` (not enum) so future multi-phase seeds (`'users'`,
  `'demo-workspace'`, `'v2'` …) can be added without schema change.
- `completed_at` is informational only — nothing reads it today; useful
  for debugging.

### Concurrency: advisory lock

`pg_advisory_xact_lock` is a transaction-scoped Postgres lock. Taken
inside a `db.transaction()`, it is released automatically on commit or
rollback. This means:

- If two gateway instances start simultaneously (rolling deploy), the
  second one will block on the `SELECT pg_advisory_xact_lock(...)` call
  until the first transaction commits, then see the `__seed_status` row
  and skip.
- If the first instance crashes mid-seed, its transaction rolls back,
  the lock is released, and the next instance retries from scratch.
- No leaked locks possible.

The lock key is a hard-coded `bigint` literal (`9_172_034_501`). We do
**not** derive it from `hashtext(...)` — a stable constant is easier to
grep for in logs and `pg_locks`.

### Export from database lib

Add to `libs/database/src/index.ts`:

```ts
export { runSeed } from "./seed.js";
```

(`runMigrations` is already exported.)

## 3. Gateway Bootstrap Wiring

### Location

`apps/server/apps/gateway/src/main.ts` — inside `bootstrap()`, **before**
`NestFactory.create(AppModule)`. This placement means:

- If migration fails, we never construct the Nest container, never open
  DB connection pools, never start any background workers.
- Nest's own startup is not polluted with DB-bootstrap concerns.
- `./load-env.js`, `./instrument.js`, `./otel.js` side-effect imports
  still run first (unchanged), so `env.*` getters and observability are
  already wired.

### Diff

Two changes to `main.ts`:

1. Insert the auto-migrate / auto-seed block at the top of `bootstrap()`.
2. **Export** `bootstrap` (it is currently unexported) and gate the
   top-level `void bootstrap()` behind a "run only when directly
   executed" check, so unit tests can import `main.ts` without
   triggering a real boot. Same pattern used by `seed.ts`.

```ts
// apps/server/apps/gateway/src/main.ts
import "./load-env.js";
import "./instrument.js";
import "./otel.js";
import { NestFactory } from "@nestjs/core";
import { VersioningType, ValidationPipe, Logger } from "@nestjs/common";
import { AppModule } from "./app.module.js";
import { SocketRedisAdapterService } from "./cluster/adapter/socket-redis-adapter.service.js";
import { WebsocketGateway } from "./im/websocket/websocket.gateway.js";
import { env } from "@team9/shared";
import { runMigrations, runSeed } from "@team9/database"; // NEW

export async function bootstrap() {
  // was: async function bootstrap()
  const logger = new Logger("Bootstrap");

  // ---- NEW: auto-migrate & auto-seed ---------------------------------
  if (env.AUTO_MIGRATE) {
    logger.log("AUTO_MIGRATE enabled — running migrations");
    await runMigrations();
  }
  if (env.AUTO_SEED) {
    logger.log("AUTO_SEED enabled — running seed (idempotent)");
    await runSeed();
  }
  // --------------------------------------------------------------------

  const app = await NestFactory.create(AppModule);
  // ... unchanged below
}

// Entry point: only executes when file is run directly, not when imported.
const isDirectRun =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.endsWith(process.argv[1] ?? "");

if (isDirectRun) {
  void bootstrap();
}
```

The `isDirectRun` guard is identical to the one used in `seed.ts` —
consistent pattern across the codebase. The `||` branch covers the case
where `process.argv[1]` is a relative path (common in Jest runs and
some ts-node configurations).

### Failure behaviour: fail-fast

Neither step is wrapped in `try/catch`. An error will bubble out of
`bootstrap()`, causing the `void bootstrap()` at the bottom of the file
to reject and Node to exit with a non-zero code.

**Why fail-fast:**

- Railway/ECS will observe the crash and restart / rollback.
- A half-migrated DB serving traffic is worse than a container that
  visibly refuses to start.
- The existing seed.ts CLI already uses `process.exit(1)` on failure,
  so the semantics are consistent.

### Ordering guarantees

- `AUTO_MIGRATE` runs **before** `AUTO_SEED`. Seed SQL may reference
  tables created by migrations.
- Both run **before** `NestFactory.create()`. No application module is
  instantiated, no route is registered, no HTTP port is bound until
  both succeed.
- If only `AUTO_SEED=1` is set (without `AUTO_MIGRATE`), that is still
  legal — operator is saying "DB is already migrated, just reseed".
  `runSeed` will still work because `CREATE TABLE IF NOT EXISTS` for
  `__seed_status` is self-bootstrapping.

### im-worker / task-worker

Unchanged. They do not import `runMigrations` / `runSeed`. See "Scope"
above for the rationale.

## 4. `.env.example` Update

Append to `apps/server/.env.example` immediately after the `DB_PORT`
line:

```bash
# Database Auto-Init (dev/staging — leave unset in production unless
# you want each gateway deploy to auto-apply pending migrations).
# Accepted truthy values (case-insensitive): 1, true, yes, on, y, t
# Anything else (or unset) means "off".
# Seed is idempotent: it only runs on a fresh DB (tracked via the
# __seed_status table).
AUTO_MIGRATE=
AUTO_SEED=
```

## 5. Testing Strategy

Project policy (see `CLAUDE.md` / user memory): **new code must have
~100% coverage**, happy-path + bad-path, with regression tests.

### 5.1 `@team9/shared` — env getters

New file (or extend existing test):
`apps/server/libs/shared/src/env.spec.ts`

Cases:

| Case                  | `AUTO_MIGRATE` | Expected |
| --------------------- | -------------- | -------- |
| Truthy canonical      | `'1'`          | `true`   |
| Truthy uppercase      | `'TRUE'`       | `true`   |
| Truthy `yes`          | `'yes'`        | `true`   |
| Truthy `ON` uppercase | `'ON'`         | `true`   |
| Truthy with padding   | `'  true  '`   | `true`   |
| Falsy canonical       | `'0'`          | `false`  |
| Falsy `no`            | `'no'`         | `false`  |
| Unset                 | `undefined`    | `false`  |
| Empty string          | `''`           | `false`  |
| Unknown token         | `'bogus'`      | `false`  |

Same table for `AUTO_SEED`. Tests clean up `process.env` after each
case.

### 5.2 `@team9/database` — `runSeed`

New file: `apps/server/libs/database/src/seed.spec.ts`

Strategy: **mock `postgres` and `drizzle-orm/postgres-js`** so tests run
without a live DB (matching the existing `libs/database` unit-test
style). The goal is to verify control flow / SQL issuance order, not
to exercise real Postgres — that is covered by integration tests
against an actual DB when available.

Cases:

1. **Fresh DB — first run.** Mock `db.transaction` to run callback.
   Mock `tx.execute` returning `[]` for the `SELECT` and success for
   `INSERT`. Assert:
   - `CREATE TABLE IF NOT EXISTS __seed_status` is executed before the
     transaction opens.
   - `pg_advisory_xact_lock(9172034501)` is called inside the
     transaction.
   - `SELECT key FROM __seed_status WHERE key = 'default'` runs.
   - `INSERT INTO __seed_status` runs with `ON CONFLICT DO NOTHING`.
   - `client.end()` is called exactly once in `finally`.

2. **Already seeded — idempotent skip.** `SELECT` returns one row.
   Assert:
   - No `INSERT` is issued.
   - Function resolves without throwing.
   - `client.end()` still runs.

3. **Error mid-transaction.** `tx.execute` throws on the `INSERT`.
   Assert:
   - Error propagates out of `runSeed`.
   - `client.end()` still runs (finally path).

4. **`client.end()` cleanup on success.** Verify regardless of branch.

### 5.3 `@team9/database` — `runMigrations`

`runMigrations` is pre-existing and not modified by this PR. We add a
**regression test** only if the existing suite has none (to be verified
during implementation):

- Mock `drizzle-orm/postgres-js/migrator#migrate` and assert the
  `migrationsFolder` argument resolves to `<dist>/../migrations`.

If the existing file already covers this, skip.

### 5.4 Gateway bootstrap

**Create** `apps/server/apps/gateway/src/main.spec.ts` (does not exist
today — gateway currently has no bootstrap test; im-worker has one as
reference pattern).

Prerequisite: `bootstrap` must be exported from `main.ts` and the
top-level call gated by `isDirectRun` (see section 3). This is part of
the implementation, not a separate refactor.

Strategy: `jest.mock('@team9/database', ...)`, `jest.mock('@nestjs/core', ...)`,
`jest.isolateModules` + `jest.resetModules()` between cases so `env.*`
getters pick up fresh `process.env` values. Inside each case, import
`bootstrap` from `./main.js` and invoke it directly. Clean up
`process.env.AUTO_MIGRATE` / `AUTO_SEED` in `afterEach`.

Cases:

1. **Both flags unset.** Default behaviour. Assert:
   - `runMigrations` not called.
   - `runSeed` not called.
   - `NestFactory.create` called exactly once.

2. **`AUTO_MIGRATE=1` only.** Assert:
   - `runMigrations` called once, **before** `NestFactory.create`.
   - `runSeed` not called.

3. **`AUTO_SEED=yes` only.** Assert:
   - `runSeed` called once, before `NestFactory.create`.
   - `runMigrations` not called.

4. **Both flags truthy.** Assert ordering:
   `runMigrations` → `runSeed` → `NestFactory.create`. Use
   `jest.fn()` with call-order assertions (`mock.invocationCallOrder`).

5. **`AUTO_MIGRATE=1` and `runMigrations` throws.** Assert:
   - `bootstrap` rejects.
   - `runSeed` not called.
   - `NestFactory.create` not called.
   - No HTTP listener bound.

6. **`AUTO_SEED=1` and `runSeed` throws (after successful migrate).**
   Assert:
   - `bootstrap` rejects.
   - `NestFactory.create` not called.

### 5.5 Integration / smoke tests

Project does not currently have a gateway-boot E2E harness. If one
exists under `apps/server/apps/gateway/test/` (to be confirmed during
implementation), add one smoke test:

- Set `AUTO_MIGRATE=1` against an ephemeral Postgres (or the test
  container the existing suite uses), boot gateway, hit `/health`, shut
  down, assert migration ran.

If no such harness exists, do **not** add one in this PR — out of
scope. Unit tests + manual verification on dev Railway environment are
sufficient.

## 6. Risks, Rollout, Operational Notes

### Risks

| Risk                                                    | Mitigation                                                                                                     |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Prod gateway auto-migrating on deploy when not intended | Flag is **opt-in** and defaults to `false`. Prod env must explicitly set `AUTO_MIGRATE=1` to take effect.      |
| Concurrent gateway instances racing on seed             | `pg_advisory_xact_lock` serialises them; second instance sees `__seed_status` row and skips.                   |
| Migration failing and leaving a half-migrated DB        | Drizzle wraps each migration file in its own transaction. Failed migration rolls back. Gateway exits non-zero. |
| Migration succeeding but seed failing                   | Gateway exits non-zero. Operator sees it; DB is migrated (still valid state) but not seeded — rerun the boot.  |
| Forgetting to build `@team9/database` before gateway    | Turborepo `dev`/`build` pipelines already enforce dep order.                                                   |
| Operator wanting to re-seed                             | Documented: `DELETE FROM __seed_status WHERE key = 'default';` and restart gateway.                            |

### Rollout

1. Merge PR with flags **unset** in every existing `.env` / Railway
   environment. Zero behaviour change.
2. Enable `AUTO_MIGRATE=1` on the **dev** Railway environment first.
   Verify a deploy triggers migrations successfully via logs.
3. After ≥1 clean dev deploy, enable `AUTO_MIGRATE=1` on staging /
   prod at operator discretion. Note: staging has no separate env
   today, so this is a manual decision per deploy target.
4. `AUTO_SEED` is meant for fresh environments only (local, new
   preview envs, CI integration DBs). **Not** for prod — leave unset.

### Operational notes

- Logs use the `Bootstrap` logger name for the gateway hook and
  `DatabaseMigration` / `DatabaseSeed` for the library calls.
- Advisory lock key `9172034501` is hard-coded; can be grepped in
  `pg_locks` as `objid = 9172034501` when debugging stuck startups.
- To force re-seed in dev:
  ```sql
  DELETE FROM "__seed_status" WHERE key = 'default';
  ```
  Then restart gateway with `AUTO_SEED=1`.

## 7. Non-Goals

- **Auto-migrate on im-worker / task-worker.** Out of scope — they
  share the gateway's DB and today already assume the schema is ready.
- **Forced / destructive reset.** No `RESET_DB=1` flag. Operators can
  drop/recreate the DB manually.
- **Populating actual seed data.** Only the plumbing. Adding rows to
  `seed.ts` is a follow-up.
- **Rollback / down-migrations.** Drizzle migrator does not support
  them natively, and we are not adding them here.

## 8. Open Questions

None blocking. Minor items to re-confirm during implementation:

1. Whether `libs/database` already has Jest config; if not, we either
   add one or run seed unit tests via the server's existing Jest
   project mapping. Resolve during plan.
2. `apps/server/apps/gateway/src/main.spec.ts` does not exist — we are
   creating it from scratch. Can use `im-worker/src/main.spec.ts` as a
   reference for Nest/Transport mocking style.

## Appendix A: File Touchlist

| File                                                            | Action                                                                        |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `apps/server/libs/shared/package.json`                          | Add `yn` dep                                                                  |
| `apps/server/libs/shared/src/env.ts`                            | Add `AUTO_MIGRATE` / `AUTO_SEED` getters                                      |
| `apps/server/libs/shared/src/env.spec.ts`                       | New (or extend): getter tests                                                 |
| `apps/server/libs/database/src/seed.ts`                         | Refactor into `runSeed()` + idempotent status table + CLI shim                |
| `apps/server/libs/database/src/index.ts`                        | Export `runSeed`                                                              |
| `apps/server/libs/database/src/seed.spec.ts`                    | New: `runSeed` unit tests                                                     |
| `apps/server/apps/gateway/src/main.ts`                          | Export `bootstrap`; add `isDirectRun` guard; call `runMigrations` / `runSeed` |
| `apps/server/apps/gateway/src/main.spec.ts`                     | **New file** — bootstrap hook tests                                           |
| `apps/server/.env.example`                                      | Document `AUTO_MIGRATE` / `AUTO_SEED`                                         |
| `docs/superpowers/specs/2026-04-08-auto-migrate-seed-design.md` | This file                                                                     |
