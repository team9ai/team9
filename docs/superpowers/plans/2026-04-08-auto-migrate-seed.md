# Auto Migrate & Seed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in `AUTO_MIGRATE` / `AUTO_SEED` env flags so the Team9 gateway self-bootstraps its Postgres schema and idempotent seed before accepting traffic.

**Architecture:** Two new boolean env getters in `@team9/shared` (parsed with `yn`), a refactored `runSeed()` in `@team9/database` that uses a `__seed_status` table + `pg_advisory_xact_lock` for idempotency and rolling-deploy safety, and a gateway `bootstrap()` hook that runs migrate → seed → Nest init in fail-fast order. im-worker / task-worker are unchanged.

**Tech Stack:** NestJS 11, Drizzle ORM (postgres-js driver), Jest 30 + ts-jest 29 (ESM mode via `NODE_OPTIONS='--experimental-vm-modules'`), `yn` 5.1.0.

**Spec:** [docs/superpowers/specs/2026-04-08-auto-migrate-seed-design.md](../specs/2026-04-08-auto-migrate-seed-design.md)

---

## Preflight: Context for the Implementer

You are a skilled engineer who does not know this codebase. Read this before touching files.

1. **Workspace layout.** This is a pnpm + Turborepo monorepo. The server lives under `apps/server/`. Inside `apps/server` there are:
   - `apps/` — runnable NestJS apps (`gateway`, `im-worker`, `task-worker`). Each has its own `jest.config.cjs`.
   - `libs/` — shared packages (`shared`, `database`, `claw-hive`, …). Only `claw-hive` currently has jest set up. **You will be adding jest to `shared` and `database`.**
2. **ESM-only.** Every `package.json` under `apps/server` sets `"type": "module"`. All `.ts` files import with `.js` extensions (Node ESM resolution). Jest runs in ESM mode — see `libs/claw-hive/jest.config.cjs` as a reference.
3. **Env vars.** `@team9/shared/src/env.ts` exports a frozen `env` object full of getters. Read from it (never `process.env.XXX` directly outside env.ts) so tests can stub `process.env` and re-evaluate.
4. **Test commands.** Unit tests are run with `NODE_OPTIONS='--experimental-vm-modules' pnpm --dir <server-root> exec jest --config <path>/jest.config.cjs`. See `apps/im-worker/package.json` for the exact incantation.
5. **Mocking ESM.** Use `jest.unstable_mockModule('@team9/shared', () => …)` **before** `await import('…')` — this is the only way to mock ESM modules. See `libs/claw-hive/src/claw-hive.service.spec.ts` for a working example.
6. **Fail-fast philosophy.** Nothing in this plan wraps failing operations in swallowing `try/catch`. If migration or seed fails, the process exits non-zero and the deploy platform restarts / rolls back.
7. **No uncommitted commits from hooks.** The repo runs `lint-staged` + `prettier --write` on commit. Expect whitespace changes to staged files — that's normal.

## Branching & Commit Guidance

- Work on the current branch (`dev`) or a feature branch — your call.
- Every task in this plan ends with a commit. Keep commits atomic (one per task).
- Follow the repo's commit style: `<type>(<scope>): <subject>` (e.g., `feat(shared): …`, `refactor(database): …`).
- Include the Claude co-author footer as seen in recent commits.

---

## Task 1: Truthy env parsing — `AUTO_MIGRATE` / `AUTO_SEED` in `@team9/shared`

**Goal:** New `env.AUTO_MIGRATE` and `env.AUTO_SEED` boolean getters that return `true` for any lenient truthy value (`1`/`true`/`yes`/`on`/`y`/`t`, case-insensitive), `false` for everything else. Also bootstraps Jest on `libs/shared` and updates `.env.example`.

**Files:**

- Modify: `apps/server/libs/shared/package.json` (add `yn` dep, `@jest/globals` devDep, `test` script)
- Create: `apps/server/libs/shared/jest.config.cjs`
- Modify: `apps/server/libs/shared/src/env.ts` (import `yn`, add two getters)
- Create: `apps/server/libs/shared/src/env.spec.ts`
- Modify: `apps/server/.env.example` (document new vars)
- Modify: `apps/server/package.json` (extend `test` turbo filter to include `@team9/shared`)

**Acceptance Criteria:**

- [ ] `yn@^5.1.0` appears in `libs/shared/package.json` dependencies
- [ ] `env.AUTO_MIGRATE` and `env.AUTO_SEED` return `boolean` (strictly typed)
- [ ] Both return `false` when the env var is unset, empty, or has an unknown value
- [ ] Both return `true` for `1`, `TRUE`, `yes`, `ON`, `y`, `t`, `  true  ` (padded)
- [ ] Both return `false` for `0`, `no`, `off`, `bogus`, `' '`, `''`
- [ ] Unit tests cover all cases and pass via `pnpm --filter @team9/shared test`
- [ ] `pnpm test` (from `apps/server`) runs `@team9/shared` tests

**Verify:**

```bash
cd /Users/winrey/Projects/weightwave/team9/apps/server/libs/shared && pnpm test
```

Expected: env.spec.ts suite passes with all cases green.

**Steps:**

- [ ] **Step 1.1: Install `yn` and jest dev-dep**

Edit `apps/server/libs/shared/package.json`. Add `yn` to dependencies and `@jest/globals` to devDependencies, plus a `test` script.

Result should look like:

```json
{
  "name": "@team9/shared",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "source": "./src/index.ts",
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./interfaces": {
      "source": "./src/interfaces/index.ts",
      "types": "./dist/interfaces/index.d.ts",
      "default": "./dist/interfaces/index.js"
    }
  },
  "scripts": {
    "build": "tsc && copyfiles -u 1 \"src/proto/*.proto\" dist",
    "test": "NODE_OPTIONS='--experimental-vm-modules' pnpm --dir ../.. exec jest --config libs/shared/jest.config.cjs"
  },
  "dependencies": {
    "yn": "^5.1.0"
  },
  "devDependencies": {
    "@jest/globals": "^30.0.0",
    "typescript": "^5.7.3"
  }
}
```

Then run (from repo root):

```bash
pnpm install
```

Expected: `yn` resolved and added to `pnpm-lock.yaml`. No version conflicts.

- [ ] **Step 1.2: Create jest config for the shared lib**

Create `apps/server/libs/shared/jest.config.cjs`:

```js
/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: ".",
  testMatch: ["<rootDir>/src/**/*.spec.ts"],
  transform: {
    "^.+\\.(t|j)s$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: "<rootDir>/tsconfig.json",
      },
    ],
  },
  collectCoverageFrom: ["src/**/*.(t|j)s"],
  coverageDirectory: "coverage",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transformIgnorePatterns: ["node_modules/(?!(@team9|yn)/)"],
};
```

Note: `yn` ships ESM-only and must not be transform-ignored, hence the `yn` entry in `transformIgnorePatterns`.

- [ ] **Step 1.3: Write the failing spec**

Create `apps/server/libs/shared/src/env.spec.ts`:

```ts
import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";

// env.ts is pure getters over process.env — no module-level capture,
// so we can import it once and mutate process.env between cases.
const originalEnv = { ...process.env };

describe("env.AUTO_MIGRATE / env.AUTO_SEED", () => {
  beforeEach(() => {
    delete process.env.AUTO_MIGRATE;
    delete process.env.AUTO_SEED;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  const truthyCases: Array<[string, string]> = [
    ["1", "1"],
    ["true", "true"],
    ["TRUE uppercase", "TRUE"],
    ["yes", "yes"],
    ["YES uppercase", "YES"],
    ["on", "on"],
    ["ON uppercase", "ON"],
    ["y", "y"],
    ["t", "t"],
    ["padded true", "  true  "],
  ];

  const falsyCases: Array<[string, string | undefined]> = [
    ["0", "0"],
    ["false", "false"],
    ["no", "no"],
    ["off", "off"],
    ["n", "n"],
    ["f", "f"],
    ["empty string", ""],
    ["whitespace only", "   "],
    ["unknown token", "bogus"],
    ["undefined", undefined],
  ];

  describe("AUTO_MIGRATE", () => {
    it.each(truthyCases)("returns true for %s", async (_label, value) => {
      process.env.AUTO_MIGRATE = value;
      const { env } = await import("./env.js");
      expect(env.AUTO_MIGRATE).toBe(true);
    });

    it.each(falsyCases)("returns false for %s", async (_label, value) => {
      if (value === undefined) {
        delete process.env.AUTO_MIGRATE;
      } else {
        process.env.AUTO_MIGRATE = value;
      }
      const { env } = await import("./env.js");
      expect(env.AUTO_MIGRATE).toBe(false);
    });
  });

  describe("AUTO_SEED", () => {
    it.each(truthyCases)("returns true for %s", async (_label, value) => {
      process.env.AUTO_SEED = value;
      const { env } = await import("./env.js");
      expect(env.AUTO_SEED).toBe(true);
    });

    it.each(falsyCases)("returns false for %s", async (_label, value) => {
      if (value === undefined) {
        delete process.env.AUTO_SEED;
      } else {
        process.env.AUTO_SEED = value;
      }
      const { env } = await import("./env.js");
      expect(env.AUTO_SEED).toBe(false);
    });
  });
});
```

- [ ] **Step 1.4: Run the spec — expect failure**

```bash
cd /Users/winrey/Projects/weightwave/team9/apps/server/libs/shared && pnpm test
```

Expected: the test file is picked up but fails at the `import './env.js'` level (TypeError: `env.AUTO_MIGRATE` is undefined, or similar). If you instead see "Cannot find module `yn`", go back to Step 1.1.

- [ ] **Step 1.5: Add the getters + yn import to `env.ts`**

Edit `apps/server/libs/shared/src/env.ts`. At the top of the file, after the existing imports / helper functions, add:

```ts
import yn from "yn";
```

Inside the `env` object, **immediately after `POSTGRES_DB`** (around line 70), add:

```ts
  // Database Auto-Init (opt-in)
  // When truthy, gateway runs migrations / seed at bootstrap before
  // listening for traffic. See docs/superpowers/specs/2026-04-08-auto-migrate-seed-design.md.
  get AUTO_MIGRATE() {
    return yn(process.env.AUTO_MIGRATE, { default: false });
  },
  get AUTO_SEED() {
    return yn(process.env.AUTO_SEED, { default: false });
  },
```

Do NOT delete or reorder any existing getter. The order inside `env` is intentionally grouped.

- [ ] **Step 1.6: Run the spec — expect pass**

```bash
cd /Users/winrey/Projects/weightwave/team9/apps/server/libs/shared && pnpm test
```

Expected: all `describe('env.AUTO_MIGRATE / env.AUTO_SEED', …)` cases green. Exit code 0.

If a truthy case fails: check that you imported `yn` (not `yn/lenient`) and passed `{ default: false }`.

- [ ] **Step 1.7: Update `.env.example`**

Edit `apps/server/.env.example`. Find the `DB_PORT=5432` line and **append directly after it**:

```bash

# Database Auto-Init (dev/staging — leave unset in production unless you
# want each gateway deploy to auto-apply pending migrations).
# Accepted truthy values (case-insensitive): 1, true, yes, on, y, t
# Anything else (or unset) means "off".
# Seed is idempotent: it only runs on a fresh DB (tracked via the
# __seed_status table).
AUTO_MIGRATE=
AUTO_SEED=
```

- [ ] **Step 1.8: Wire shared lib into the server's root `test` script**

Edit `apps/server/package.json`. Change the `test` and `test:cov` scripts to add `@team9/shared` to the turbo filter:

Before:

```json
"test": "turbo run test --filter=@team9/gateway --filter=@team9/im-worker --filter=@team9/task-worker",
"test:cov": "turbo run test:cov --filter=@team9/gateway --filter=@team9/im-worker --filter=@team9/task-worker",
```

After:

```json
"test": "turbo run test --filter=@team9/gateway --filter=@team9/im-worker --filter=@team9/task-worker --filter=@team9/shared",
"test:cov": "turbo run test:cov --filter=@team9/gateway --filter=@team9/im-worker --filter=@team9/task-worker --filter=@team9/shared",
```

- [ ] **Step 1.9: Run the full server test script as a smoke test**

```bash
cd /Users/winrey/Projects/weightwave/team9/apps/server && pnpm test
```

Expected: turbo runs tests for gateway, im-worker, task-worker, AND `@team9/shared`. The shared suite is the new one; others should be unchanged. All green.

- [ ] **Step 1.10: Commit**

```bash
cd /Users/winrey/Projects/weightwave/team9
git add apps/server/libs/shared/package.json \
        apps/server/libs/shared/jest.config.cjs \
        apps/server/libs/shared/src/env.ts \
        apps/server/libs/shared/src/env.spec.ts \
        apps/server/.env.example \
        apps/server/package.json \
        pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(shared): add AUTO_MIGRATE / AUTO_SEED env flags

Two opt-in booleans parsed with yn (lenient truthy: 1/true/yes/on/y/t,
case-insensitive). Bootstraps Jest infrastructure for @team9/shared and
wires it into the server's test script. Documents both flags in
.env.example.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Idempotent `runSeed()` with advisory lock — `@team9/database`

**Goal:** Refactor `libs/database/src/seed.ts` to export a reusable `runSeed()` function that (a) self-bootstraps a `__seed_status` table, (b) uses `pg_advisory_xact_lock` for concurrent-instance safety, (c) skips if already seeded, and (d) still works as a standalone CLI via `pnpm db:seed`. Also bootstraps Jest on `libs/database`.

**Files:**

- Modify: `apps/server/libs/database/package.json` (add `@jest/globals` devDep + `test` script)
- Create: `apps/server/libs/database/jest.config.cjs`
- Modify: `apps/server/libs/database/src/seed.ts` (full rewrite — see Step 2.4)
- Modify: `apps/server/libs/database/src/index.ts` (export `runSeed`)
- Create: `apps/server/libs/database/src/seed.spec.ts`
- Modify: `apps/server/package.json` (extend `test` turbo filter to include `@team9/database`)

**Acceptance Criteria:**

- [ ] `runSeed` is exported from `@team9/database`
- [ ] First call creates `__seed_status` table via `CREATE TABLE IF NOT EXISTS`
- [ ] First call acquires `pg_advisory_xact_lock(9172034501)` inside a transaction
- [ ] First call inserts a `'default'` key row and resolves successfully
- [ ] Second call sees the existing row and skips (no second INSERT)
- [ ] Errors in the transaction body propagate out of `runSeed` (fail-fast)
- [ ] `client.end()` runs in both success and failure paths
- [ ] CLI invocation (`node dist/seed.js`) still works via `isDirectRun` guard
- [ ] Unit tests pass via `pnpm --filter @team9/database test`
- [ ] `pnpm test` (from `apps/server`) runs `@team9/database` tests

**Verify:**

```bash
cd /Users/winrey/Projects/weightwave/team9/apps/server/libs/database && pnpm test
```

Expected: `seed.spec.ts` suite passes with all cases green.

**Steps:**

- [ ] **Step 2.1: Add jest dev-dep + test script to the database package**

Edit `apps/server/libs/database/package.json`. Add `@jest/globals` to devDependencies and a `test` script. The final file:

```json
{
  "name": "@team9/database",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "source": "./src/index.ts",
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./schemas": {
      "source": "./src/schemas/index.ts",
      "types": "./dist/schemas/index.d.ts",
      "default": "./dist/schemas/index.js"
    },
    "./config": {
      "source": "./src/config.service.ts",
      "types": "./dist/config.service.d.ts",
      "default": "./dist/config.service.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "build:schemas": "tsc -p tsconfig.schemas.json",
    "test": "NODE_OPTIONS='--experimental-vm-modules' pnpm --dir ../.. exec jest --config libs/database/jest.config.cjs",
    "db:generate": "rm -rf dist tsconfig.schemas.tsbuildinfo && pnpm build:schemas && dotenv -e ../../.env -- drizzle-kit generate --config=drizzle.config.mjs",
    "db:migrate": "dotenv -e ../../.env -- drizzle-kit migrate --config=drizzle.config.mjs",
    "db:push": "rm -rf dist tsconfig.schemas.tsbuildinfo && pnpm build:schemas && dotenv -e ../../.env -- drizzle-kit push --config=drizzle.config.mjs",
    "db:studio": "dotenv -e ../../.env -- drizzle-kit studio --config=drizzle.config.mjs"
  },
  "dependencies": {
    "drizzle-orm": "^0.45.1",
    "postgres": "^3.4.7",
    "@team9/shared": "workspace:*"
  },
  "devDependencies": {
    "@jest/globals": "^30.0.0",
    "dotenv-cli": "^8.0.0",
    "drizzle-kit": "^0.31.8",
    "typescript": "^5.7.3"
  }
}
```

Then:

```bash
pnpm install
```

- [ ] **Step 2.2: Create jest config for the database lib**

Create `apps/server/libs/database/jest.config.cjs`:

```js
/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: ".",
  testMatch: ["<rootDir>/src/**/*.spec.ts"],
  transform: {
    "^.+\\.(t|j)s$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: "<rootDir>/tsconfig.json",
      },
    ],
  },
  collectCoverageFrom: ["src/**/*.(t|j)s", "!src/scripts/**"],
  coverageDirectory: "coverage",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "^@team9/shared$": "<rootDir>/../shared/src/index.ts",
  },
  transformIgnorePatterns: ["node_modules/(?!(@team9|yn)/)"],
};
```

The `src/scripts/**` exclusion from coverage matches the one-off migration scripts already in the repo (e.g. `fix-application-tenant-ids.ts`) — they are not part of this feature and don't need unit tests.

- [ ] **Step 2.3: Write the failing spec**

Create `apps/server/libs/database/src/seed.spec.ts`:

```ts
import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";

// ── Mock @team9/shared env ──────────────────────────────────────────────
jest.unstable_mockModule("@team9/shared", () => ({
  env: {
    DB_HOST: "localhost",
    DB_PORT: 5432,
    POSTGRES_DB: "team9_test",
    POSTGRES_USER: "postgres",
    POSTGRES_PASSWORD: "postgres",
  },
}));

// ── Mock postgres driver ────────────────────────────────────────────────
const mockClientEnd = jest.fn<() => Promise<void>>().mockResolvedValue();
const mockPostgresFactory = jest.fn(() => ({
  end: mockClientEnd,
}));
jest.unstable_mockModule("postgres", () => ({
  default: mockPostgresFactory,
}));

// ── Mock drizzle-orm/postgres-js ────────────────────────────────────────
type ExecuteResult = ReadonlyArray<Record<string, unknown>>;
type ExecuteFn = jest.Mock<(query: unknown) => Promise<ExecuteResult>>;

// Each test provides its own execute responses in-order via an array.
let executeResponses: ExecuteResult[] = [];
const mockExecute: ExecuteFn = jest.fn(async () => {
  const next = executeResponses.shift();
  return next ?? [];
});

const mockTxExecute: ExecuteFn = jest.fn(async () => {
  const next = executeResponses.shift();
  return next ?? [];
});

// Transaction runner: by default runs the callback with a tx object that
// exposes `execute`. Tests can override this to throw.
let mockTransactionImpl: (
  cb: (tx: { execute: ExecuteFn }) => Promise<unknown>,
) => Promise<unknown> = async (cb) => cb({ execute: mockTxExecute });

const mockDb = {
  execute: mockExecute,
  transaction: jest.fn((cb: (tx: { execute: ExecuteFn }) => Promise<unknown>) =>
    mockTransactionImpl(cb),
  ),
};

jest.unstable_mockModule("drizzle-orm/postgres-js", () => ({
  drizzle: jest.fn(() => mockDb),
}));

// drizzle-orm's sql template tag — we don't care about the actual
// parameterisation, only that the right SQL text is produced. Keep the
// real import for sql.
const { sql: _sql } = await import("drizzle-orm");

// ── Import the module under test AFTER all mocks are registered ────────
const { runSeed } = await import("./seed.js");

// ── Helpers ─────────────────────────────────────────────────────────────

function extractSqlText(call: unknown): string {
  // drizzle's sql`` returns an object with a `.queryChunks` or similar
  // internal shape. For assertion purposes we toString it — good enough
  // to match the fragment we care about (CREATE TABLE, SELECT, INSERT,
  // pg_advisory_xact_lock).
  return String(call);
}

function sqlCallsContaining(spy: ExecuteFn, fragment: string): number {
  return spy.mock.calls.filter(([q]) =>
    extractSqlText(q).toUpperCase().includes(fragment.toUpperCase()),
  ).length;
}

// ── Tests ───────────────────────────────────────────────────────────────

describe("runSeed", () => {
  beforeEach(() => {
    executeResponses = [];
    mockExecute.mockClear();
    mockTxExecute.mockClear();
    mockDb.transaction.mockClear();
    mockClientEnd.mockClear();
    mockPostgresFactory.mockClear();
    // Default: normal transaction runner
    mockTransactionImpl = async (cb) => cb({ execute: mockTxExecute });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("creates the status table, seeds on fresh DB, inserts marker row", async () => {
    // SELECT returns empty → not yet seeded
    executeResponses = [
      [], // pg_advisory_xact_lock → irrelevant
      [], // SELECT key FROM __seed_status → empty
      [], // INSERT INTO __seed_status
    ];

    await runSeed();

    // 1. CREATE TABLE ran on top-level db.execute (before transaction)
    expect(sqlCallsContaining(mockExecute, "CREATE TABLE IF NOT EXISTS")).toBe(
      1,
    );
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);

    // 2. Advisory lock acquired
    expect(sqlCallsContaining(mockTxExecute, "pg_advisory_xact_lock")).toBe(1);

    // 3. Status SELECT + INSERT both issued inside the transaction
    expect(sqlCallsContaining(mockTxExecute, "SELECT key FROM")).toBe(1);
    expect(sqlCallsContaining(mockTxExecute, "INSERT INTO")).toBe(1);

    // 4. client.end() called exactly once
    expect(mockClientEnd).toHaveBeenCalledTimes(1);
  });

  it("is idempotent: skips seed when status row already exists", async () => {
    executeResponses = [
      [], // CREATE TABLE (top-level)
      [], // pg_advisory_xact_lock
      [{ key: "default" }], // SELECT returns existing row
    ];

    await runSeed();

    // INSERT INTO __seed_status must NOT have been called
    expect(sqlCallsContaining(mockTxExecute, "INSERT INTO")).toBe(0);
    expect(mockClientEnd).toHaveBeenCalledTimes(1);
  });

  it("propagates errors and still closes the client (failure path)", async () => {
    // Arrange: transaction callback throws.
    const boom = new Error("connection reset");
    mockTransactionImpl = async () => {
      throw boom;
    };

    await expect(runSeed()).rejects.toThrow("connection reset");

    // client.end must still run from the finally block
    expect(mockClientEnd).toHaveBeenCalledTimes(1);
  });

  it("closes the client even when transaction succeeds immediately", async () => {
    executeResponses = [[], [], []];
    await runSeed();
    expect(mockClientEnd).toHaveBeenCalledTimes(1);
  });
});
```

Notes for the implementer:

- `jest.unstable_mockModule` must be called **before** `await import('./seed.js')`. This is an ESM-jest requirement.
- The `extractSqlText` helper uses `String(call)` — crude but sufficient to match SQL fragments. If drizzle's SQL chunks ever change shape, update this helper.
- Status responses (`executeResponses`) are consumed in arrival order. Each top-level `db.execute` AND each `tx.execute` pulls from the same array in the order they are called in `runSeed`. The implementation in Step 2.4 calls them in this order: top-level `CREATE TABLE` → `pg_advisory_xact_lock` → `SELECT` → `INSERT`.

- [ ] **Step 2.4: Run the spec — expect failure**

```bash
cd /Users/winrey/Projects/weightwave/team9/apps/server/libs/database && pnpm test
```

Expected: the spec imports `./seed.js` and fails because `runSeed` is not exported yet. Error message: "The requested module './seed.js' does not provide an export named 'runSeed'" or similar.

- [ ] **Step 2.5: Rewrite `seed.ts`**

Replace the **entire contents** of `apps/server/libs/database/src/seed.ts` with:

```ts
import "dotenv/config";
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

/**
 * Idempotently seeds the Team9 database.
 *
 * - Self-bootstraps a `__seed_status` tracking table on first run.
 * - Uses `pg_advisory_xact_lock` to serialise concurrent gateway
 *   instances during a rolling deploy.
 * - Skips entirely if the `'default'` key already exists in the
 *   status table (idempotent).
 * - Fails fast on any error — caller must handle the rejection.
 */
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
    // 1. Ensure status table exists (self-bootstrapping). Runs outside
    //    any transaction so a concurrent instance's CREATE TABLE IF NOT
    //    EXISTS does not deadlock against our advisory lock.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "__seed_status" (
        "key"          text        PRIMARY KEY,
        "completed_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    // 2. Serialise on a transaction-scoped advisory lock + check status
    //    atomically. The lock is released automatically when the
    //    transaction commits or rolls back.
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(${SEED_LOCK_KEY}::bigint)`,
      );

      const rows = await tx.execute<{ key: string }>(
        sql`SELECT key FROM "__seed_status" WHERE key = ${SEED_KEY} LIMIT 1`,
      );
      if (rows.length > 0) {
        logger.log(`Seed '${SEED_KEY}' already completed, skipping`);
        return;
      }

      logger.log(`Running seed '${SEED_KEY}'...`);

      // ── Future seed data inserts go here, inside this transaction. ──

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

- [ ] **Step 2.6: Export `runSeed` from the library index**

Edit `apps/server/libs/database/src/index.ts`. Add the new export:

Before:

```ts
export * from "./database.module.js";
export * from "./config.service.js";
export * from "./database.constants.js";
export * from "./schemas/index.js";
export * from "./drizzle.js";
export * from "./migrate.js";
```

After:

```ts
export * from "./database.module.js";
export * from "./config.service.js";
export * from "./database.constants.js";
export * from "./schemas/index.js";
export * from "./drizzle.js";
export * from "./migrate.js";
export { runSeed } from "./seed.js";
```

(A targeted named export is used instead of `export *` because `seed.ts` has a module-level side-effect block — the `isDirectRun` check. Re-exporting named symbols only makes the tree-shaking intent explicit.)

- [ ] **Step 2.7: Run the spec — expect pass**

```bash
cd /Users/winrey/Projects/weightwave/team9/apps/server/libs/database && pnpm test
```

Expected: all four `describe('runSeed', …)` cases green. Exit code 0.

Troubleshooting:

- **"Cannot find module '@team9/shared'"** → verify `jest.config.cjs` `moduleNameMapper` has the `@team9/shared` entry (Step 2.2).
- **SQL fragment assertions failing** → the `extractSqlText` helper relies on the default `toString()` of drizzle's sql template. If drizzle changed shape, inspect `mockTxExecute.mock.calls[N][0]` in a failing test and adjust the helper to pull out `.queryChunks` / `.sql` / whatever drizzle now exposes.
- **`client.end` not called in the error case** → confirm the `try { … } finally { await client.end(); }` wraps BOTH the top-level `CREATE TABLE` and the transaction.

- [ ] **Step 2.8: Wire database lib into root `test` script**

Edit `apps/server/package.json`. Change `test` and `test:cov` to add `@team9/database` to the filter list:

Before (already includes `@team9/shared` from Task 1):

```json
"test": "turbo run test --filter=@team9/gateway --filter=@team9/im-worker --filter=@team9/task-worker --filter=@team9/shared",
"test:cov": "turbo run test:cov --filter=@team9/gateway --filter=@team9/im-worker --filter=@team9/task-worker --filter=@team9/shared",
```

After:

```json
"test": "turbo run test --filter=@team9/gateway --filter=@team9/im-worker --filter=@team9/task-worker --filter=@team9/shared --filter=@team9/database",
"test:cov": "turbo run test:cov --filter=@team9/gateway --filter=@team9/im-worker --filter=@team9/task-worker --filter=@team9/shared --filter=@team9/database",
```

- [ ] **Step 2.9: Smoke test the existing CLI shim**

The refactor must not break `pnpm db:seed` (even though that script is not defined today — the existing `seed.ts` was invoked via `node dist/seed.js`). Verify the CLI guard still fires when the file is run directly:

```bash
cd /Users/winrey/Projects/weightwave/team9/apps/server/libs/database
pnpm build
# The compiled file exists under dist/. A dry smoke test:
node -e "import('./dist/seed.js').then(() => console.log('imported without auto-running'))"
```

Expected output: `imported without auto-running`. If instead it tries to connect to Postgres, the `isDirectRun` guard is mis-evaluated — check that `import.meta.url` comparison in seed.ts matches the pattern used in Step 2.5.

(Do NOT actually run `node dist/seed.js` against a live DB in this step — that would seed whatever DB your `.env` points to.)

- [ ] **Step 2.10: Commit**

```bash
cd /Users/winrey/Projects/weightwave/team9
git add apps/server/libs/database/package.json \
        apps/server/libs/database/jest.config.cjs \
        apps/server/libs/database/src/seed.ts \
        apps/server/libs/database/src/index.ts \
        apps/server/libs/database/src/seed.spec.ts \
        apps/server/package.json \
        pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
refactor(database): export idempotent runSeed with advisory lock

Refactor seed.ts to export runSeed() as a library function guarded by
a self-bootstrapping __seed_status table and pg_advisory_xact_lock, so
it is safe to call from gateway bootstrap or repeatedly from the CLI.
Bootstraps Jest infrastructure for @team9/database and wires it into
the server's test script.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Gateway bootstrap hook — auto-migrate + auto-seed

**Goal:** Modify the gateway's `bootstrap()` to conditionally run `runMigrations()` and/or `runSeed()` before `NestFactory.create()`, based on `env.AUTO_MIGRATE` / `env.AUTO_SEED`. Export `bootstrap` and guard the top-level invocation so the function is unit-testable. Create `main.spec.ts` covering all bootstrap branches.

**Depends on:** Task 1 (env getters) and Task 2 (`runSeed` export).

**Files:**

- Modify: `apps/server/apps/gateway/src/main.ts`
- Create: `apps/server/apps/gateway/src/main.spec.ts`

**Acceptance Criteria:**

- [ ] `bootstrap` is exported from `main.ts`
- [ ] Top-level invocation is gated by `isDirectRun` so `import('./main.js')` does not trigger a real boot
- [ ] When both flags are unset, neither `runMigrations` nor `runSeed` is called
- [ ] When `AUTO_MIGRATE=1`, `runMigrations` is called exactly once, before `NestFactory.create`
- [ ] When `AUTO_SEED=yes`, `runSeed` is called exactly once, before `NestFactory.create`
- [ ] When both truthy, call order is `runMigrations` → `runSeed` → `NestFactory.create`
- [ ] When `runMigrations` throws, `bootstrap` rejects, `runSeed` is not called, `NestFactory.create` is not called
- [ ] When `runSeed` throws (after successful migrate), `bootstrap` rejects, `NestFactory.create` is not called
- [ ] `main.spec.ts` passes via `pnpm --filter @team9/gateway test main.spec`
- [ ] Existing gateway tests still pass (no regression)

**Verify:**

```bash
cd /Users/winrey/Projects/weightwave/team9/apps/server/apps/gateway && pnpm test
```

Expected: all gateway tests green, including the new `main.spec.ts`.

**Steps:**

- [ ] **Step 3.1: Write the failing spec**

Create `apps/server/apps/gateway/src/main.spec.ts`:

```ts
import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";

// ── Mocks must be registered BEFORE importing main.ts ─────────────────

// We vary env between cases by mutating process.env directly BEFORE
// each dynamic import — the `env` getters in @team9/shared read
// process.env on every access, so this works without re-mocking.

const mockRunMigrations = jest.fn<() => Promise<void>>();
const mockRunSeed = jest.fn<() => Promise<void>>();

jest.unstable_mockModule("@team9/database", () => ({
  runMigrations: mockRunMigrations,
  runSeed: mockRunSeed,
  // Re-export anything else main.ts transitively imports via @team9/database.
  // Keep this list minimal — only runMigrations/runSeed are called in
  // main.ts. App module imports come via AppModule, which is also mocked.
}));

// Stub the Nest app instance returned by NestFactory.create
const mockNestApp = {
  enableCors: jest.fn(),
  useGlobalPipes: jest.fn(),
  setGlobalPrefix: jest.fn(),
  enableVersioning: jest.fn(),
  listen: jest.fn<() => Promise<void>>().mockResolvedValue(),
  useLogger: jest.fn(),
  get: jest.fn(),
};

const mockNestFactoryCreate = jest
  .fn<() => Promise<typeof mockNestApp>>()
  .mockResolvedValue(mockNestApp);

jest.unstable_mockModule("@nestjs/core", () => ({
  NestFactory: {
    create: mockNestFactoryCreate,
  },
}));

// Stub the AppModule import so we don't pull the entire gateway DI graph.
jest.unstable_mockModule("./app.module.js", () => ({
  AppModule: class MockAppModule {},
}));

// Stub the side-effect imports at the top of main.ts — they must not
// throw when re-imported during tests.
jest.unstable_mockModule("./load-env.js", () => ({}));
jest.unstable_mockModule("./instrument.js", () => ({}));
jest.unstable_mockModule("./otel.js", () => ({}));

// Stub socket adapter + websocket gateway so `app.get(...)` calls do
// not blow up. main.ts wraps these in try/catch today, but we still
// need the module imports to succeed.
jest.unstable_mockModule(
  "./cluster/adapter/socket-redis-adapter.service.js",
  () => ({
    SocketRedisAdapterService: class {},
  }),
);
jest.unstable_mockModule("./im/websocket/websocket.gateway.js", () => ({
  WebsocketGateway: class {},
}));

// ── Helper: dynamic import with a clean env + module registry ───────

const originalEnv = { ...process.env };

async function importBootstrap(
  envOverrides: Record<string, string | undefined>,
) {
  // Reset the module registry so env getters re-evaluate.
  jest.resetModules();

  // Reset env
  process.env = { ...originalEnv };
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  const mod = await import("./main.js");
  return mod.bootstrap;
}

describe("gateway bootstrap", () => {
  beforeEach(() => {
    mockRunMigrations.mockReset().mockResolvedValue();
    mockRunSeed.mockReset().mockResolvedValue();
    mockNestFactoryCreate.mockClear();
    mockNestApp.listen.mockClear();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("does not call runMigrations or runSeed when both flags are unset", async () => {
    const bootstrap = await importBootstrap({
      AUTO_MIGRATE: undefined,
      AUTO_SEED: undefined,
    });

    await bootstrap();

    expect(mockRunMigrations).not.toHaveBeenCalled();
    expect(mockRunSeed).not.toHaveBeenCalled();
    expect(mockNestFactoryCreate).toHaveBeenCalledTimes(1);
  });

  it("calls runMigrations when AUTO_MIGRATE=1, before NestFactory.create", async () => {
    const bootstrap = await importBootstrap({
      AUTO_MIGRATE: "1",
      AUTO_SEED: undefined,
    });

    await bootstrap();

    expect(mockRunMigrations).toHaveBeenCalledTimes(1);
    expect(mockRunSeed).not.toHaveBeenCalled();
    expect(mockNestFactoryCreate).toHaveBeenCalledTimes(1);

    // Ordering: migrations must have been called before NestFactory.create
    const migrateOrder = mockRunMigrations.mock.invocationCallOrder[0];
    const createOrder = mockNestFactoryCreate.mock.invocationCallOrder[0];
    expect(migrateOrder).toBeLessThan(createOrder);
  });

  it("calls runSeed when AUTO_SEED=yes", async () => {
    const bootstrap = await importBootstrap({
      AUTO_MIGRATE: undefined,
      AUTO_SEED: "yes",
    });

    await bootstrap();

    expect(mockRunMigrations).not.toHaveBeenCalled();
    expect(mockRunSeed).toHaveBeenCalledTimes(1);

    const seedOrder = mockRunSeed.mock.invocationCallOrder[0];
    const createOrder = mockNestFactoryCreate.mock.invocationCallOrder[0];
    expect(seedOrder).toBeLessThan(createOrder);
  });

  it("runs migrate → seed → NestFactory.create in order when both truthy", async () => {
    const bootstrap = await importBootstrap({
      AUTO_MIGRATE: "on",
      AUTO_SEED: "TRUE",
    });

    await bootstrap();

    expect(mockRunMigrations).toHaveBeenCalledTimes(1);
    expect(mockRunSeed).toHaveBeenCalledTimes(1);
    expect(mockNestFactoryCreate).toHaveBeenCalledTimes(1);

    const migrateOrder = mockRunMigrations.mock.invocationCallOrder[0];
    const seedOrder = mockRunSeed.mock.invocationCallOrder[0];
    const createOrder = mockNestFactoryCreate.mock.invocationCallOrder[0];
    expect(migrateOrder).toBeLessThan(seedOrder);
    expect(seedOrder).toBeLessThan(createOrder);
  });

  it("fails fast when runMigrations throws: no seed, no Nest app, no HTTP listen", async () => {
    mockRunMigrations.mockRejectedValueOnce(new Error("migration failed"));

    const bootstrap = await importBootstrap({
      AUTO_MIGRATE: "1",
      AUTO_SEED: "1",
    });

    await expect(bootstrap()).rejects.toThrow("migration failed");

    expect(mockRunMigrations).toHaveBeenCalledTimes(1);
    expect(mockRunSeed).not.toHaveBeenCalled();
    expect(mockNestFactoryCreate).not.toHaveBeenCalled();
    expect(mockNestApp.listen).not.toHaveBeenCalled();
  });

  it("fails fast when runSeed throws after successful migrate", async () => {
    mockRunSeed.mockRejectedValueOnce(new Error("seed failed"));

    const bootstrap = await importBootstrap({
      AUTO_MIGRATE: "1",
      AUTO_SEED: "1",
    });

    await expect(bootstrap()).rejects.toThrow("seed failed");

    expect(mockRunMigrations).toHaveBeenCalledTimes(1);
    expect(mockRunSeed).toHaveBeenCalledTimes(1);
    expect(mockNestFactoryCreate).not.toHaveBeenCalled();
    expect(mockNestApp.listen).not.toHaveBeenCalled();
  });
});
```

Note on the mocks: the existing gateway `main.ts` also calls `app.get(SocketRedisAdapterService)` and `app.get(WebsocketGateway)` wrapped in a try/catch. The `mockNestApp.get` is `jest.fn()` that returns `undefined` by default, which will make `adapterService.isInitialized()` throw — but the wrapping try/catch in `main.ts` swallows the error and logs a warning. That is acceptable for tests. If the suite flakes on this branch, update `mockNestApp.get` to return `{ isInitialized: () => false }` for the adapter service.

- [ ] **Step 3.2: Run the spec — expect failure**

```bash
cd /Users/winrey/Projects/weightwave/team9/apps/server/apps/gateway && pnpm test -- main.spec
```

Expected failures:

- `import('./main.js')` likely throws because `bootstrap` is not exported today.
- The dynamic import may also trigger the existing `void bootstrap()` side effect, which will call the real (un-mocked) boot path.

Both of these are fixed in the next step.

- [ ] **Step 3.3: Modify `main.ts` — export bootstrap, add auto-migrate/seed block, gate top-level call**

Edit `apps/server/apps/gateway/src/main.ts`. Three changes:

**Change A.** Add the new import for `runMigrations` / `runSeed` at the top of the import block (after the existing `@team9/shared` import):

```ts
import { env } from "@team9/shared";
import { runMigrations, runSeed } from "@team9/database";
```

**Change B.** Change `async function bootstrap()` to `export async function bootstrap()` **and** insert the auto-migrate / auto-seed block as the first thing inside the function body (before `const app = await NestFactory.create(AppModule)`).

Before:

```ts
async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule);
```

After:

```ts
export async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Run DB migrations / seeds before creating the Nest app (fail-fast).
  // Controlled by AUTO_MIGRATE / AUTO_SEED env vars; default off.
  if (env.AUTO_MIGRATE) {
    logger.log('AUTO_MIGRATE enabled — running migrations');
    await runMigrations();
  }
  if (env.AUTO_SEED) {
    logger.log('AUTO_SEED enabled — running seed (idempotent)');
    await runSeed();
  }

  const app = await NestFactory.create(AppModule);
```

**Change C.** Replace the trailing `void bootstrap();` with an `isDirectRun`-guarded invocation so imports (from tests) do not trigger a real boot.

Before:

```ts
void bootstrap();
```

After:

```ts
// Entry point: only executes when the file is run directly, not when
// imported (e.g. by unit tests).
const isDirectRun =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.endsWith(process.argv[1] ?? "");

if (isDirectRun) {
  void bootstrap();
}
```

Do not touch any other code in `main.ts`. The socket adapter setup, CORS, versioning, etc. remain as-is.

- [ ] **Step 3.4: Run the spec — expect pass**

```bash
cd /Users/winrey/Projects/weightwave/team9/apps/server/apps/gateway && pnpm test -- main.spec
```

Expected: all six `describe('gateway bootstrap', …)` cases green.

Troubleshooting:

- **Test hangs or tries to bind a real port** → the `isDirectRun` guard is evaluating truthy during `jest.import`. Double-check the guard matches Step 3.3 exactly. Jest's `process.argv[1]` will typically be a jest runner path like `.../jest-worker/.../index.js`, and `import.meta.url` will be the compiled `main.js`, so the equality check returns false and the `endsWith` branch also returns false. Good.
- **`Cannot read properties of undefined (reading 'AUTO_MIGRATE')`** → verify Task 1 is landed and the getters exist in `libs/shared/src/env.ts`.
- **`runMigrations is not a function`** → the `jest.unstable_mockModule('@team9/database', …)` block is registering mocks for the functions, but if TypeScript types for `runMigrations`/`runSeed` aren't found, verify Task 2 is landed and `libs/database/src/index.ts` re-exports `runSeed`.

- [ ] **Step 3.5: Run the full gateway suite — regression check**

```bash
cd /Users/winrey/Projects/weightwave/team9/apps/server/apps/gateway && pnpm test
```

Expected: all gateway tests (including pre-existing `app.controller.spec.ts`, `health.controller.spec.ts`, and the new `main.spec.ts`) green.

- [ ] **Step 3.6: Smoke the server-wide test script**

```bash
cd /Users/winrey/Projects/weightwave/team9/apps/server && pnpm test
```

Expected: turbo runs tests across `@team9/gateway`, `@team9/im-worker`, `@team9/task-worker`, `@team9/shared`, and `@team9/database`. All green.

- [ ] **Step 3.7: Manual end-to-end sanity check (local Postgres only)**

Only run this step if you have a local Postgres + .env set up. Skip otherwise — the unit tests above are the blocking gate.

```bash
# Ensure a clean(-ish) dev DB state
cd /Users/winrey/Projects/weightwave/team9/apps/server
AUTO_MIGRATE=1 AUTO_SEED=1 pnpm dev:gateway
```

Expected in the gateway logs:

1. `[Bootstrap] AUTO_MIGRATE enabled — running migrations`
2. `[DatabaseMigration] Running migrations on <host>:<port>/<db>`
3. `[DatabaseMigration] Migrations completed successfully`
4. `[Bootstrap] AUTO_SEED enabled — running seed (idempotent)`
5. Either `[DatabaseSeed] Running seed 'default'...` then `[DatabaseSeed] Seed 'default' completed successfully`, OR `[DatabaseSeed] Seed 'default' already completed, skipping` on a DB that has been seeded before.
6. `[Bootstrap] Application is running on port 3000`

Stop the server. Verify via psql:

```bash
psql -h localhost -U postgres -d team9 -c 'SELECT * FROM "__seed_status";'
```

Expected: one row with `key = 'default'` and a non-null `completed_at`.

- [ ] **Step 3.8: Commit**

```bash
cd /Users/winrey/Projects/weightwave/team9
git add apps/server/apps/gateway/src/main.ts \
        apps/server/apps/gateway/src/main.spec.ts
git commit -m "$(cat <<'EOF'
feat(gateway): run AUTO_MIGRATE / AUTO_SEED at bootstrap

Before NestFactory.create, the gateway now optionally runs Drizzle
migrations and idempotent seed when AUTO_MIGRATE / AUTO_SEED env vars
are truthy. Exports bootstrap and gates the top-level invocation behind
an isDirectRun check so main.ts is unit-testable without triggering a
real boot.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Post-implementation

- [ ] **Final verification — full server test suite**

```bash
cd /Users/winrey/Projects/weightwave/team9/apps/server && pnpm test
```

Expected: all 5 packages pass (`gateway`, `im-worker`, `task-worker`, `shared`, `database`).

- [ ] **Optional: coverage check on touched files**

```bash
cd /Users/winrey/Projects/weightwave/team9/apps/server && pnpm test:cov
```

Verify that the three changed code files (`env.ts`, `seed.ts`, `main.ts`) hit ~100% line coverage. The added getter lines, runSeed branches, and bootstrap if-blocks should all be exercised.

- [ ] **Code review handoff**

Per project policy (`CLAUDE.md` "Code Review Requirements"), after all tasks are done, dispatch an independent code-reviewer agent. Follow up on any Critical / Important findings before opening the PR.

---

## Self-review notes (for the plan author)

- **Spec coverage:** all 8 sections of `2026-04-08-auto-migrate-seed-design.md` are represented: §1 env (Task 1), §2 seed refactor (Task 2), §3 gateway bootstrap (Task 3), §4 .env.example (Task 1 step 1.7), §5 testing (per-task), §6 risks/rollout (informational — no task), §7 non-goals (none), §8 open questions (resolved during plan: jest infra via Options 2, no existing main.spec.ts → creating fresh).
- **Type consistency:** `runSeed`, `runMigrations`, `bootstrap` — names match between source diffs and test mocks throughout. `SEED_KEY = 'default'`, `SEED_LOCK_KEY = 9172034501` — values match between spec and plan.
- **No placeholders:** every code step has actual code; every test step has actual assertions; every commit step has the final commit message.
- **Open questions from the spec:** resolved in the plan — Task 1 and Task 2 add Jest config to libs/shared and libs/database respectively, gateway's missing main.spec.ts is a fresh create in Task 3, `bootstrap` export + isDirectRun guard implemented in Task 3 Step 3.3.
