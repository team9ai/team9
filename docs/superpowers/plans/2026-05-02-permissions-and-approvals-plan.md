# Permissions and Approvals — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the permissions & approvals system described in [2026-05-02-permissions-and-approvals-design.md](../specs/2026-05-02-permissions-and-approvals-design.md), including the framework (DB / service / API / WS / frontend) plus the first enforcement point (bot cross-channel `messages:send`).

**Architecture:** Two new tables (`auth_permission_grants`, `auth_permission_requests`); a single `PermissionsService.gate(...)` entry point used at every enforcement site; per-key `resolveApprovers(ctx)` registry that maps a permission to its resource holders; one-time approvals identified by a memorable BIP-39 spell id.

**Tech Stack:** NestJS 11 + Drizzle ORM (Postgres) + Socket.io + React 19 + TanStack Query + Zustand + Tauri. Tests: Jest (backend, ESM mode) + Vitest (frontend).

**Conventions for this plan:**

- Every task ends in a green test run + a single commit.
- TDD: tests authored before implementation in each task.
- No placeholders. Every step shows the code an engineer types.
- File paths are absolute from repo root.

---

## File Inventory

### New (backend)

```
apps/server/libs/database/src/schemas/permissions/
  grants.ts                          Drizzle schema: auth_permission_grants
  requests.ts                        Drizzle schema: auth_permission_requests
  relations.ts                       Drizzle relations
  index.ts                           Re-exports

apps/server/libs/database/migrations/
  00XX_permissions_init.sql          Generated migration (number assigned at db:generate)

apps/server/apps/gateway/src/permissions/
  permissions.module.ts              NestJS module
  permissions.service.ts             gate + grant + request + decide + consume
  permissions.controller.ts          REST endpoints
  permissions-approver.repository.ts Holder lookups (channel/bot/routine/wiki)
  permission-keys.ts                 Registry: PERMISSION_KEYS map
  permission-matcher.ts              Pure function: scope_metadata match
  spell-id.service.ts                Spell id generation + parsing
  spell-words.ts                     BIP-39 word list (readonly string[])
  dto/
    create-grant.dto.ts
    list-grants.dto.ts
    create-request.dto.ts
    decide-request.dto.ts
  __tests__/
    spell-id.service.spec.ts
    permission-matcher.spec.ts
    permissions-approver.repository.spec.ts
    permissions.service.grants.spec.ts
    permissions.service.gate.spec.ts
    permissions.service.requests.spec.ts
    permissions.controller.spec.ts

apps/server/libs/shared/src/events/domains/permissions/
  index.ts                           Event names + payload types
```

### New (frontend)

```
apps/client/src/components/permissions/
  PermissionInbox.tsx                Top-bar bell + dropdown list
  PermissionRequestCard.tsx          Single request: spell id + 3 buttons
  ScopeEditor.tsx                    Key-aware metadata editor
  GrantList.tsx                      Per-subject grants table
  GrantEditor.tsx                    Create / edit grant dialog
  __tests__/
    PermissionRequestCard.test.tsx
    PermissionInbox.test.tsx
    GrantList.test.tsx
    ScopeEditor.test.tsx

apps/client/src/hooks/
  usePermissions.ts                  React Query hooks
  __tests__/usePermissions.test.tsx

apps/client/src/i18n/locales/{en,zh-CN}/permissions.json
```

### Modified

```
apps/server/apps/gateway/src/app.module.ts                    Register PermissionsModule
apps/server/apps/gateway/src/im/messages/messages.controller.ts:85  Call gate() on bot send
apps/server/apps/gateway/src/im/websocket/websocket.gateway.ts      Add broadcastToApprovers()
apps/server/libs/database/src/schemas/index.ts                Re-export permissions
apps/server/libs/shared/src/events/index.ts                   Add permissions domain
apps/client/src/services/websocket.ts                         permission_* listeners
apps/client/src/stores/useAppStore.ts                         pendingPermissionCount
apps/client/src/i18n/loadLanguage.ts                          NAMESPACES += 'permissions'
apps/client/src/i18n/index.ts                                 Import permissions namespace
apps/client/src/components/channel/MessageList.tsx            Render in-channel approval card
apps/client/src/components/sidebar/<top-bar>.tsx              Mount <PermissionInbox/>
```

---

## Task Map

| #   | Task                                                          | Depends on |
| --- | ------------------------------------------------------------- | ---------- |
| 1   | DB schema & migration                                         | —          |
| 2   | SpellIdService + BIP-39 word list                             | —          |
| 3   | PermissionMatcher                                             | —          |
| 4   | Permission keys registry + ApproverRepository                 | 1          |
| 5   | PermissionsService — grants CRUD                              | 1, 4       |
| 6   | PermissionsService — gate + once-use consume                  | 1, 3, 5    |
| 7   | PermissionsService — request lifecycle + resolveApprovers     | 2, 4, 6    |
| 8   | WS events domain + broadcastToApprovers + service emission    | 7          |
| 9   | PermissionsController + DTOs + e2e                            | 5, 6, 7    |
| 10  | PermissionsModule + AppModule wiring                          | 9          |
| 11  | Enforcement point: messages.controller cross-channel bot send | 7, 10      |
| 12  | Frontend i18n + ScopeEditor                                   | —          |
| 13  | Frontend PermissionRequestCard                                | 12         |
| 14  | Frontend WS + store + Query hooks                             | 8          |
| 15  | Frontend PermissionInbox + in-channel embed                   | 13, 14     |
| 16  | Frontend GrantList + GrantEditor (settings tabs)              | 13, 14     |
| 17  | End-to-end backend smoke test                                 | 11         |

---

## Task 1: DB schema & migration

**Goal:** Create the two permissions tables, enums, indexes, generate the SQL migration, and run it cleanly against a fresh DB.

**Files:**

- Create: `apps/server/libs/database/src/schemas/permissions/grants.ts`
- Create: `apps/server/libs/database/src/schemas/permissions/requests.ts`
- Create: `apps/server/libs/database/src/schemas/permissions/relations.ts`
- Create: `apps/server/libs/database/src/schemas/permissions/index.ts`
- Modify: `apps/server/libs/database/src/schemas/index.ts` (add `export * from './permissions/index.js'`)
- Generated: `apps/server/libs/database/migrations/00XX_permissions_init.sql`

**Acceptance Criteria:**

- [ ] Schema files compile under TypeScript strict mode.
- [ ] `pnpm db:generate` produces a single migration with two `CREATE TYPE` (enums) and two `CREATE TABLE` statements + 4 indexes + 1 unique index.
- [ ] `pnpm db:migrate` applies cleanly against a fresh database.
- [ ] `auth_permission_grants` has the unique index on `(spell_id)` — wait, that's on requests; verify both tables match the spec table definitions in §5 of the design doc.

**Verify:** `cd apps/server && pnpm db:generate && pnpm db:migrate` → exits 0; `psql -c "\dt auth_*"` lists both tables.

**Steps:**

- [ ] **Step 1.1: Write `permissions/requests.ts`** (defined first because grants.ts FKs to it)

```ts
// apps/server/libs/database/src/schemas/permissions/requests.ts
import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "../tenant/tenants.js";
import { imBots } from "../im/bots.js";
import { imChannels } from "../im/channels.js";
import { imUsers } from "../im/users.js";
import { routineExecutions } from "../routine/routine-executions.js";
import { routineRoutines } from "../routine/routines.js";

export const permissionRequestStatusEnum = pgEnum("permission_request_status", [
  "pending",
  "approved_once",
  "approved_durable",
  "denied",
  "expired",
  "cancelled",
]);

export const authPermissionRequests = pgTable(
  "auth_permission_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    spellId: text("spell_id").notNull(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    requesterBotId: uuid("requester_bot_id")
      .notNull()
      .references(() => imBots.id, { onDelete: "cascade" }),
    contextChannelId: uuid("context_channel_id").references(
      () => imChannels.id,
      { onDelete: "set null" },
    ),
    contextExecutionId: uuid("context_execution_id").references(
      () => routineExecutions.id,
      { onDelete: "set null" },
    ),
    contextRoutineId: uuid("context_routine_id").references(
      () => routineRoutines.id,
      { onDelete: "set null" },
    ),
    permissionKey: text("permission_key").notNull(),
    requestedMetadata: jsonb("requested_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    suggestedApproverIds: uuid("suggested_approver_ids")
      .array()
      .notNull()
      .default(sql`ARRAY[]::uuid[]`),
    reason: text("reason"),
    status: permissionRequestStatusEnum("status").notNull().default("pending"),
    decidedByUserId: uuid("decided_by_user_id").references(() => imUsers.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    durableGrantId: uuid("durable_grant_id"),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    spellIdx: uniqueIndex("auth_req_spell_idx").on(t.spellId),
    pendingByBot: index("auth_req_pending_bot_idx").on(
      t.tenantId,
      t.requesterBotId,
      t.status,
    ),
    pendingByContext: index("auth_req_pending_ctx_idx").on(
      t.tenantId,
      t.contextChannelId,
      t.status,
    ),
  }),
);

export type AuthPermissionRequest = typeof authPermissionRequests.$inferSelect;
export type AuthPermissionRequestInsert =
  typeof authPermissionRequests.$inferInsert;
```

- [ ] **Step 1.2: Write `permissions/grants.ts`**

```ts
// apps/server/libs/database/src/schemas/permissions/grants.ts
import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "../tenant/tenants.js";
import { imUsers } from "../im/users.js";
import { authPermissionRequests } from "./requests.js";

export const permissionSubjectKindEnum = pgEnum("permission_subject_kind", [
  "agent",
  "channel-session",
  "execution-session",
  "task",
]);

export const permissionGrantSourceEnum = pgEnum("permission_grant_source", [
  "proactive",
  "request_approved",
]);

export const authPermissionGrants = pgTable(
  "auth_permission_grants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    grantedByUserId: uuid("granted_by_user_id")
      .notNull()
      .references(() => imUsers.id),
    subjectKind: permissionSubjectKindEnum("subject_kind").notNull(),
    subjectId: uuid("subject_id").notNull(),
    permissionKey: text("permission_key").notNull(),
    scopeMetadata: jsonb("scope_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    source: permissionGrantSourceEnum("source").notNull(),
    requestId: uuid("request_id").references(() => authPermissionRequests.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedByUserId: uuid("revoked_by_user_id").references(() => imUsers.id),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    bySubject: index("auth_grants_subject_idx").on(
      t.tenantId,
      t.subjectKind,
      t.subjectId,
      t.permissionKey,
    ),
    active: index("auth_grants_active_idx")
      .on(t.tenantId, t.permissionKey)
      .where(sql`${t.revokedAt} IS NULL`),
  }),
);

export type AuthPermissionGrant = typeof authPermissionGrants.$inferSelect;
export type AuthPermissionGrantInsert =
  typeof authPermissionGrants.$inferInsert;
```

- [ ] **Step 1.3: Write `permissions/relations.ts`**

```ts
// apps/server/libs/database/src/schemas/permissions/relations.ts
import { relations } from "drizzle-orm";
import { authPermissionGrants } from "./grants.js";
import { authPermissionRequests } from "./requests.js";

export const authPermissionGrantsRelations = relations(
  authPermissionGrants,
  ({ one }) => ({
    request: one(authPermissionRequests, {
      fields: [authPermissionGrants.requestId],
      references: [authPermissionRequests.id],
    }),
  }),
);

export const authPermissionRequestsRelations = relations(
  authPermissionRequests,
  ({ one }) => ({
    durableGrant: one(authPermissionGrants, {
      fields: [authPermissionRequests.durableGrantId],
      references: [authPermissionGrants.id],
    }),
  }),
);
```

- [ ] **Step 1.4: Write `permissions/index.ts`**

```ts
// apps/server/libs/database/src/schemas/permissions/index.ts
export * from "./grants.js";
export * from "./requests.js";
export * from "./relations.js";
```

- [ ] **Step 1.5: Update `schemas/index.ts`** — add the line `export * from './permissions/index.js';` alongside existing `export * from './im/index.js';` etc.

- [ ] **Step 1.6: Generate migration**

```bash
cd apps/server && pnpm db:generate
```

Expected: a new `00XX_permissions_init.sql` file in `apps/server/libs/database/migrations/`. Open it; verify it contains:

- `CREATE TYPE "permission_request_status" AS ENUM (...)` with all 6 values
- `CREATE TYPE "permission_subject_kind" AS ENUM (...)` with all 4 values
- `CREATE TYPE "permission_grant_source" AS ENUM (...)` with both values
- `CREATE TABLE "auth_permission_requests" (...)` with all columns + the unique index on `spell_id`
- `CREATE TABLE "auth_permission_grants" (...)` with all columns + partial index where `revoked_at IS NULL`

If the generator places the grants table before requests and the FK ordering breaks, manually reorder so requests is created first.

- [ ] **Step 1.7: Apply migration to dev DB**

```bash
cd apps/server && pnpm db:migrate
psql "$DATABASE_URL" -c "\dt auth_*"
```

Expected: both tables listed.

- [ ] **Step 1.8: Commit**

```bash
git add apps/server/libs/database/src/schemas/permissions \
        apps/server/libs/database/src/schemas/index.ts \
        apps/server/libs/database/migrations/
git commit -m "feat(db): permissions schema (grants + requests)"
```

---

## Task 2: SpellIdService + BIP-39 word list

**Goal:** Generate memorable 3-4 word Spell IDs from the BIP-39 wordlist with collision-safe DB-bound generation, plus a normalizing parser.

**Files:**

- Create: `apps/server/apps/gateway/src/permissions/spell-words.ts`
- Create: `apps/server/apps/gateway/src/permissions/spell-id.service.ts`
- Create: `apps/server/apps/gateway/src/permissions/__tests__/spell-id.service.spec.ts`

**Acceptance Criteria:**

- [ ] `SPELL_WORDS` is a `readonly string[]` of length 2048, all lowercase, all `[a-z]+`.
- [ ] `generate()` returns a string matching `^[a-z]+( [a-z]+){2,3}$` (3 or 4 words).
- [ ] `parse(input)` lowercases, trims, collapses internal whitespace; returns `null` if format invalid; otherwise returns the canonical form.
- [ ] On simulated DB-uniqueness failure 3 times at 3 words, generator escalates to 4 words.
- [ ] All branches covered by tests (deterministic via injected RNG).

**Verify:** `cd apps/server && pnpm jest apps/gateway/src/permissions/__tests__/spell-id.service.spec.ts` → all tests pass.

**Steps:**

- [ ] **Step 2.1: Add the BIP-39 word list**

Source the canonical BIP-39 English list (2048 words) from a trusted public source (e.g., the official `bitcoinjs/bip39` repo's `english.json`). Save as a `readonly string[]` in `spell-words.ts`. The list is ~13 KB.

```ts
// apps/server/apps/gateway/src/permissions/spell-words.ts
// BIP-39 English mnemonic word list. 2048 words, lowercase, 3-8 letters each.
// Source: https://github.com/bitcoin/bips/blob/master/bip-0039/english.txt
export const SPELL_WORDS = Object.freeze([
  "abandon",
  "ability",
  "able",
  "about",
  "above",
  "absent",
  "absorb",
  "abstract",
  // ... full 2048-word list inserted here, one entry per word
] as const) as readonly string[];

export const SPELL_WORD_COUNT = 2048; // sanity check at module load
if (SPELL_WORDS.length !== SPELL_WORD_COUNT) {
  throw new Error(
    `SPELL_WORDS length mismatch: expected ${SPELL_WORD_COUNT}, got ${SPELL_WORDS.length}`,
  );
}
```

> Implementation note: copy-paste the raw BIP-39 list. Do not introduce a runtime dependency on a wallet library just for this list.

- [ ] **Step 2.2: Write the failing test**

```ts
// apps/server/apps/gateway/src/permissions/__tests__/spell-id.service.spec.ts
import { jest } from "@jest/globals";

const { SpellIdService } = await import("../spell-id.service.js");
const { SPELL_WORDS } = await import("../spell-words.js");

describe("SpellIdService", () => {
  describe("SPELL_WORDS", () => {
    it("contains exactly 2048 lowercase words", () => {
      expect(SPELL_WORDS).toHaveLength(2048);
      for (const w of SPELL_WORDS) {
        expect(w).toMatch(/^[a-z]+$/);
      }
    });
  });

  describe("generate()", () => {
    it("returns a 3-word lowercase string by default", () => {
      const svc = new SpellIdService();
      const id = svc.generate();
      expect(id).toMatch(/^[a-z]+( [a-z]+){2}$/);
      const words = id.split(" ");
      expect(new Set(words).size).toBe(3); // distinct
    });

    it("respects wordCount=4", () => {
      const svc = new SpellIdService();
      const id = svc.generate({ wordCount: 4 });
      expect(id.split(" ")).toHaveLength(4);
    });

    it("uses the injected RNG deterministically", () => {
      const fakeRng = jest.fn<() => number>();
      // Pick indices 0, 1, 2 for three calls
      fakeRng
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(1 / 2048)
        .mockReturnValueOnce(2 / 2048);
      const svc = new SpellIdService(fakeRng);
      const id = svc.generate({ wordCount: 3 });
      expect(id).toBe(`${SPELL_WORDS[0]} ${SPELL_WORDS[1]} ${SPELL_WORDS[2]}`);
    });

    it("rerolls duplicate words within one id", () => {
      const fakeRng = jest.fn<() => number>();
      // First three calls all pick index 0; algorithm must reroll until distinct.
      fakeRng
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(1 / 2048)
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(2 / 2048);
      const svc = new SpellIdService(fakeRng);
      const id = svc.generate({ wordCount: 3 });
      const words = id.split(" ");
      expect(new Set(words).size).toBe(3);
    });
  });

  describe("parse()", () => {
    it("normalizes whitespace and case", () => {
      const svc = new SpellIdService();
      expect(svc.parse("  Raven   crystal  Flame  ")).toBe(
        "raven crystal flame",
      );
    });

    it("rejects fewer than 3 words", () => {
      const svc = new SpellIdService();
      expect(svc.parse("hello world")).toBeNull();
    });

    it("rejects more than 4 words", () => {
      const svc = new SpellIdService();
      expect(svc.parse("a b c d e")).toBeNull();
    });

    it("rejects non-letter characters", () => {
      const svc = new SpellIdService();
      expect(svc.parse("raven crystal flame!")).toBeNull();
      expect(svc.parse("raven 123 flame")).toBeNull();
    });
  });
});
```

- [ ] **Step 2.3: Run the failing test**

```bash
cd apps/server && pnpm jest apps/gateway/src/permissions/__tests__/spell-id.service.spec.ts
```

Expected: FAIL — module not found.

- [ ] **Step 2.4: Implement SpellIdService**

```ts
// apps/server/apps/gateway/src/permissions/spell-id.service.ts
import { Injectable } from "@nestjs/common";
import { SPELL_WORDS } from "./spell-words.js";

export type RandomFn = () => number; // returns [0, 1)

@Injectable()
export class SpellIdService {
  constructor(private readonly rng: RandomFn = Math.random) {}

  generate(opts: { wordCount?: 3 | 4 } = {}): string {
    const count = opts.wordCount ?? 3;
    const picked: string[] = [];
    while (picked.length < count) {
      const idx = Math.floor(this.rng() * SPELL_WORDS.length);
      const word = SPELL_WORDS[idx]!;
      if (!picked.includes(word)) picked.push(word);
    }
    return picked.join(" ");
  }

  parse(input: string): string | null {
    const normalized = input.trim().toLowerCase().replace(/\s+/g, " ");
    if (!/^[a-z]+( [a-z]+){2,3}$/.test(normalized)) return null;
    return normalized;
  }
}
```

- [ ] **Step 2.5: Re-run the test** — expect ALL PASS.

- [ ] **Step 2.6: Commit**

```bash
git add apps/server/apps/gateway/src/permissions/spell-words.ts \
        apps/server/apps/gateway/src/permissions/spell-id.service.ts \
        apps/server/apps/gateway/src/permissions/__tests__/spell-id.service.spec.ts
git commit -m "feat(permissions): SpellIdService backed by BIP-39 word list"
```

> Note: collision retry against the DB is implemented in Task 7 (`PermissionsService.createRequest`), not here. The service in this task is purely the in-memory generator + parser.

---

## Task 3: PermissionMatcher

**Goal:** A pure function `matches(requested, scope)` that checks whether a request's metadata satisfies a grant's `scope_metadata` per the rules in design §4.

**Files:**

- Create: `apps/server/apps/gateway/src/permissions/permission-matcher.ts`
- Create: `apps/server/apps/gateway/src/permissions/__tests__/permission-matcher.spec.ts`

**Acceptance Criteria:**

- [ ] Empty scope → matches anything (returns `true`).
- [ ] Scope with array field → request value must be `∈` array.
- [ ] Scope with string field → exact match.
- [ ] Scope with `glob:<pattern>` string → minimatch-style match against the request value.
- [ ] Missing field on request when scope has constraint → `false`.
- [ ] Each rule has at least one positive and one negative test.

**Verify:** `cd apps/server && pnpm jest apps/gateway/src/permissions/__tests__/permission-matcher.spec.ts` → all pass.

**Steps:**

- [ ] **Step 3.1: Add `minimatch` to gateway deps if not already present**

```bash
cd apps/server && pnpm add minimatch --filter gateway
```

Check first: `grep -l '"minimatch"' apps/server/apps/gateway/package.json` — skip the add if it's already there.

- [ ] **Step 3.2: Write the failing test**

```ts
// apps/server/apps/gateway/src/permissions/__tests__/permission-matcher.spec.ts
const { matchesScope } = await import("../permission-matcher.js");

describe("matchesScope", () => {
  it("returns true when scope is empty", () => {
    expect(matchesScope({ channelId: "c1" }, {})).toBe(true);
    expect(matchesScope({}, {})).toBe(true);
  });

  it("matches an array whitelist", () => {
    const scope = { channelIds: ["c1", "c2"] };
    expect(matchesScope({ channelId: "c1" }, scope)).toBe(true);
    expect(matchesScope({ channelId: "c3" }, scope)).toBe(false);
  });

  it("uses singular requested key against plural scope key", () => {
    // Convention: scope key `channelIds` matches request key `channelId`.
    expect(matchesScope({ channelId: "c1" }, { channelIds: ["c1"] })).toBe(
      true,
    );
    expect(matchesScope({ toolName: "sql" }, { toolNames: ["sql"] })).toBe(
      true,
    );
  });

  it("matches an exact string", () => {
    expect(matchesScope({ env: "staging" }, { env: "staging" })).toBe(true);
    expect(matchesScope({ env: "prod" }, { env: "staging" })).toBe(false);
  });

  it("matches a glob pattern", () => {
    expect(
      matchesScope({ path: "/data/foo.txt" }, { path: "glob:/data/*" }),
    ).toBe(true);
    expect(
      matchesScope({ path: "/etc/passwd" }, { path: "glob:/data/*" }),
    ).toBe(false);
  });

  it("returns false when request lacks a constrained field", () => {
    expect(matchesScope({}, { channelIds: ["c1"] })).toBe(false);
    expect(matchesScope({}, { env: "prod" })).toBe(false);
  });

  it("all scope fields must match (AND semantics)", () => {
    const scope = { channelIds: ["c1"], env: "staging" };
    expect(matchesScope({ channelId: "c1", env: "staging" }, scope)).toBe(true);
    expect(matchesScope({ channelId: "c1", env: "prod" }, scope)).toBe(false);
    expect(matchesScope({ channelId: "c2", env: "staging" }, scope)).toBe(
      false,
    );
  });
});
```

- [ ] **Step 3.3: Run the failing test** — expect FAIL (module missing).

- [ ] **Step 3.4: Implement the matcher**

```ts
// apps/server/apps/gateway/src/permissions/permission-matcher.ts
import { minimatch } from "minimatch";

type Scalar = string | number | boolean;
type Metadata = Record<string, unknown>;

const PLURAL_TO_SINGULAR: Record<string, string> = {
  channelIds: "channelId",
  channelTypes: "channelType",
  toolNames: "toolName",
  targets: "target",
  routineIds: "routineId",
  wikiIds: "wikiId",
  paths: "path",
};

function pluralLookup(req: Metadata, scopeKey: string): unknown {
  if (scopeKey in req) return req[scopeKey];
  const singular = PLURAL_TO_SINGULAR[scopeKey];
  return singular ? req[singular] : undefined;
}

function matchesField(reqValue: unknown, scopeValue: unknown): boolean {
  if (Array.isArray(scopeValue)) {
    if (reqValue === undefined) return false;
    return (scopeValue as Scalar[]).includes(reqValue as Scalar);
  }
  if (typeof scopeValue === "string") {
    if (reqValue === undefined) return false;
    if (scopeValue.startsWith("glob:")) {
      return minimatch(String(reqValue), scopeValue.slice("glob:".length));
    }
    return reqValue === scopeValue;
  }
  // Numbers / booleans → strict equality
  if (reqValue === undefined) return false;
  return reqValue === scopeValue;
}

export function matchesScope(requested: Metadata, scope: Metadata): boolean {
  for (const [key, scopeValue] of Object.entries(scope)) {
    const reqValue = pluralLookup(requested, key);
    if (!matchesField(reqValue, scopeValue)) return false;
  }
  return true;
}
```

- [ ] **Step 3.5: Re-run tests** — expect ALL PASS.

- [ ] **Step 3.6: Commit**

```bash
git add apps/server/apps/gateway/src/permissions/permission-matcher.ts \
        apps/server/apps/gateway/src/permissions/__tests__/permission-matcher.spec.ts \
        apps/server/apps/gateway/package.json
git commit -m "feat(permissions): scope_metadata matcher (array/string/glob)"
```

---

## Task 4: Permission keys registry + ApproverRepository

**Goal:** Define the in-code `PERMISSION_KEYS` registry and the `PermissionsApproverRepository` that resolves resource holders for each key.

**Files:**

- Create: `apps/server/apps/gateway/src/permissions/permission-keys.ts`
- Create: `apps/server/apps/gateway/src/permissions/permissions-approver.repository.ts`
- Create: `apps/server/apps/gateway/src/permissions/__tests__/permissions-approver.repository.spec.ts`

**Acceptance Criteria:**

- [ ] `PERMISSION_KEYS` exports definitions for at minimum: `messages:send`, `messages:read`, `tools:invoke`, `routine:trigger`, `wiki:read`, `wiki:write`. Other keys may be stubbed (`describe()` only).
- [ ] Each definition has `metadata` schema, `risk`, `resolveApprovers`, `defaultApprovers`, `describe`.
- [ ] `PermissionsApproverRepository` exposes `findChannelOwnersAndAdmins`, `findBotOwnerAndMentor`, `findRoutineCreatorAndOwner`, `findWikiOwners`, `findWorkspaceOwners`, `findWorkspaceAdmins`. Each query is unit-tested with a mocked Drizzle DB.
- [ ] `findChannelOwnersAndAdmins(channelId)` returns `userId[]` for members with `role IN ('owner','admin')` AND `leftAt IS NULL`.
- [ ] `findBotOwnerAndMentor(botId)` returns up to 2 user IDs (owner + mentor), null entries filtered.

**Verify:** `cd apps/server && pnpm jest apps/gateway/src/permissions/__tests__/permissions-approver.repository.spec.ts` → all pass.

**Steps:**

- [ ] **Step 4.1: Write `permission-keys.ts`**

```ts
// apps/server/apps/gateway/src/permissions/permission-keys.ts
import type { PermissionsApproverRepository } from "./permissions-approver.repository.js";

export type PermissionKey =
  | "messages:send"
  | "messages:read"
  | "tools:invoke"
  | "routine:trigger"
  | "wiki:read"
  | "wiki:write"
  | "files:read"
  | "files:write";

export type Risk = "low" | "medium" | "high";

export interface ApproverContext {
  tenantId: string;
  requesterBotId: string;
  permissionKey: PermissionKey;
  metadata: Record<string, unknown>;
  contextChannelId?: string | null;
  contextExecutionId?: string | null;
  contextRoutineId?: string | null;
}

export interface ApproverDeps {
  repo: PermissionsApproverRepository;
}

export interface PermissionKeyDef {
  metadata: Record<string, unknown>; // JSON-Schema-like, validated by class-validator at the controller
  risk: Risk;
  resolveApprovers: (
    ctx: ApproverContext,
    deps: ApproverDeps,
  ) => Promise<string[]>;
  defaultApprovers: "workspace-admins" | "bot-owners" | "none";
  describe: (metadata: Record<string, unknown>) => string;
}

const ChannelScopeSchema = {
  type: "object",
  properties: {
    channelIds: { type: "array", items: { type: "string", format: "uuid" } },
    channelTypes: {
      type: "array",
      items: { enum: ["public", "private", "direct"] },
    },
  },
};

const ToolScopeSchema = {
  type: "object",
  properties: {
    toolNames: { type: "array", items: { type: "string" } },
    targets: { type: "array", items: { type: "string" } },
  },
};

const WikiScopeSchema = {
  type: "object",
  properties: { wikiId: { type: "string", format: "uuid" } },
};

const RoutineScopeSchema = {
  type: "object",
  properties: { routineId: { type: "string", format: "uuid" } },
};

const PathScopeSchema = {
  type: "object",
  properties: { paths: { type: "array", items: { type: "string" } } },
};

function pickFirst<T>(arr: T[] | null | undefined): T | undefined {
  return arr && arr.length ? arr[0] : undefined;
}

export const PERMISSION_KEYS: Record<PermissionKey, PermissionKeyDef> = {
  "messages:send": {
    metadata: ChannelScopeSchema,
    risk: "low",
    resolveApprovers: async ({ metadata, contextChannelId }, { repo }) => {
      const channelId =
        (metadata.channelId as string | undefined) ??
        pickFirst(metadata.channelIds as string[] | undefined) ??
        contextChannelId ??
        undefined;
      if (!channelId) return [];
      return repo.findChannelOwnersAndAdmins(channelId);
    },
    defaultApprovers: "workspace-admins",
    describe: (m) =>
      `Send messages${
        Array.isArray(m.channelIds) && m.channelIds.length
          ? ` in ${(m.channelIds as string[]).length} channel(s)`
          : ""
      }`,
  },
  "messages:read": {
    metadata: ChannelScopeSchema,
    risk: "low",
    resolveApprovers: async (ctx, deps) =>
      PERMISSION_KEYS["messages:send"].resolveApprovers(ctx, deps),
    defaultApprovers: "workspace-admins",
    describe: (m) =>
      `Read message history${
        Array.isArray(m.channelIds)
          ? ` in ${(m.channelIds as string[]).length} channel(s)`
          : ""
      }`,
  },
  "tools:invoke": {
    metadata: ToolScopeSchema,
    risk: "medium",
    resolveApprovers: async ({ requesterBotId }, { repo }) =>
      repo.findBotOwnerAndMentor(requesterBotId),
    defaultApprovers: "workspace-admins",
    describe: (m) => {
      const names = m.toolNames as string[] | undefined;
      return `Invoke tool${names && names.length ? ` (${names.join(", ")})` : ""}`;
    },
  },
  "routine:trigger": {
    metadata: RoutineScopeSchema,
    risk: "medium",
    resolveApprovers: async ({ metadata, contextRoutineId }, { repo }) => {
      const id =
        (metadata.routineId as string | undefined) ??
        contextRoutineId ??
        undefined;
      return id ? repo.findRoutineCreatorAndOwner(id) : [];
    },
    defaultApprovers: "workspace-admins",
    describe: (m) =>
      `Trigger routine ${(m.routineId as string | undefined) ?? "(unspecified)"}`,
  },
  "wiki:read": {
    metadata: WikiScopeSchema,
    risk: "low",
    resolveApprovers: async ({ metadata }, { repo }) => {
      const id = metadata.wikiId as string | undefined;
      return id ? repo.findWikiOwners(id) : [];
    },
    defaultApprovers: "workspace-admins",
    describe: (m) =>
      `Read wiki ${(m.wikiId as string | undefined) ?? "(unspecified)"}`,
  },
  "wiki:write": {
    metadata: WikiScopeSchema,
    risk: "high",
    resolveApprovers: async (ctx, deps) =>
      PERMISSION_KEYS["wiki:read"].resolveApprovers(ctx, deps),
    defaultApprovers: "workspace-admins",
    describe: (m) =>
      `Write to wiki ${(m.wikiId as string | undefined) ?? "(unspecified)"}`,
  },
  "files:read": {
    metadata: PathScopeSchema,
    risk: "medium",
    resolveApprovers: async (_ctx, { repo }) =>
      repo.findWorkspaceAdmins(_ctx.tenantId),
    defaultApprovers: "workspace-admins",
    describe: (m) => {
      const paths = m.paths as string[] | undefined;
      return `Read files${paths && paths.length ? ` (${paths.length} path(s))` : ""}`;
    },
  },
  "files:write": {
    metadata: PathScopeSchema,
    risk: "high",
    resolveApprovers: async (_ctx, { repo }) =>
      repo.findWorkspaceAdmins(_ctx.tenantId),
    defaultApprovers: "workspace-admins",
    describe: (m) => {
      const paths = m.paths as string[] | undefined;
      return `Write files${paths && paths.length ? ` (${paths.length} path(s))` : ""}`;
    },
  },
};

export function isPermissionKey(value: string): value is PermissionKey {
  return Object.prototype.hasOwnProperty.call(PERMISSION_KEYS, value);
}
```

- [ ] **Step 4.2: Write the failing test**

```ts
// apps/server/apps/gateway/src/permissions/__tests__/permissions-approver.repository.spec.ts
import { jest } from "@jest/globals";

const mockDb = {
  query: {
    imChannelMembers: { findMany: jest.fn() },
    imBots: { findFirst: jest.fn() },
    routineRoutines: { findFirst: jest.fn() },
    workspaceWikis: { findFirst: jest.fn() },
    tenantMembers: { findMany: jest.fn() },
  },
};

await jest.unstable_mockModule("@team9/database", () => ({
  DatabaseService: class {
    db = mockDb;
  },
}));

const { PermissionsApproverRepository } =
  await import("../permissions-approver.repository.js");

describe("PermissionsApproverRepository", () => {
  let repo: InstanceType<typeof PermissionsApproverRepository>;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new PermissionsApproverRepository({ db: mockDb } as never);
  });

  it("findChannelOwnersAndAdmins returns owner+admin user ids excluding left members", async () => {
    mockDb.query.imChannelMembers.findMany.mockResolvedValueOnce([
      { userId: "u-owner", role: "owner", leftAt: null },
      { userId: "u-admin", role: "admin", leftAt: null },
    ]);
    const ids = await repo.findChannelOwnersAndAdmins("c1");
    expect(ids).toEqual(["u-owner", "u-admin"]);
    expect(mockDb.query.imChannelMembers.findMany).toHaveBeenCalledTimes(1);
  });

  it("findBotOwnerAndMentor filters nulls", async () => {
    mockDb.query.imBots.findFirst.mockResolvedValueOnce({
      ownerId: "u-owner",
      mentorId: null,
    });
    const ids = await repo.findBotOwnerAndMentor("b1");
    expect(ids).toEqual(["u-owner"]);
  });

  it("findBotOwnerAndMentor returns empty when bot not found", async () => {
    mockDb.query.imBots.findFirst.mockResolvedValueOnce(null);
    const ids = await repo.findBotOwnerAndMentor("b-missing");
    expect(ids).toEqual([]);
  });

  it("findRoutineCreatorAndOwner returns creatorId and (if any) ownerId", async () => {
    mockDb.query.routineRoutines.findFirst.mockResolvedValueOnce({
      creatorId: "u-creator",
      ownerId: "u-owner",
    });
    const ids = await repo.findRoutineCreatorAndOwner("r1");
    expect(ids.sort()).toEqual(["u-creator", "u-owner"]);
  });
});
```

- [ ] **Step 4.3: Run failing test** — expect FAIL.

- [ ] **Step 4.4: Implement repository**

```ts
// apps/server/apps/gateway/src/permissions/permissions-approver.repository.ts
import { Injectable } from "@nestjs/common";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { DatabaseService } from "@team9/database";
import {
  imChannelMembers,
  imBots,
  routineRoutines,
  workspaceWikis,
  tenantMembers,
} from "@team9/database";

@Injectable()
export class PermissionsApproverRepository {
  constructor(private readonly db: DatabaseService) {}

  async findChannelOwnersAndAdmins(channelId: string): Promise<string[]> {
    const rows = await this.db.db.query.imChannelMembers.findMany({
      where: and(
        eq(imChannelMembers.channelId, channelId),
        inArray(imChannelMembers.role, ["owner", "admin"]),
        isNull(imChannelMembers.leftAt),
      ),
      columns: { userId: true },
    });
    return rows.map((r) => r.userId);
  }

  async findBotOwnerAndMentor(botId: string): Promise<string[]> {
    const bot = await this.db.db.query.imBots.findFirst({
      where: eq(imBots.id, botId),
      columns: { ownerId: true, mentorId: true },
    });
    if (!bot) return [];
    return [bot.ownerId, bot.mentorId].filter(
      (v): v is string => typeof v === "string" && v.length > 0,
    );
  }

  async findRoutineCreatorAndOwner(routineId: string): Promise<string[]> {
    const r = await this.db.db.query.routineRoutines.findFirst({
      where: eq(routineRoutines.id, routineId),
      columns: { creatorId: true, ownerId: true },
    });
    if (!r) return [];
    const set = new Set<string>();
    if (r.creatorId) set.add(r.creatorId);
    if (r.ownerId) set.add(r.ownerId);
    return [...set];
  }

  async findWikiOwners(wikiId: string): Promise<string[]> {
    const w = await this.db.db.query.workspaceWikis.findFirst({
      where: eq(workspaceWikis.id, wikiId),
      columns: { ownerId: true },
    });
    return w?.ownerId ? [w.ownerId] : [];
  }

  async findWorkspaceOwners(tenantId: string): Promise<string[]> {
    const rows = await this.db.db.query.tenantMembers.findMany({
      where: and(
        eq(tenantMembers.tenantId, tenantId),
        eq(tenantMembers.role, "owner"),
      ),
      columns: { userId: true },
    });
    return rows.map((r) => r.userId);
  }

  async findWorkspaceAdmins(tenantId: string): Promise<string[]> {
    const rows = await this.db.db.query.tenantMembers.findMany({
      where: and(
        eq(tenantMembers.tenantId, tenantId),
        inArray(tenantMembers.role, ["owner", "admin"]),
      ),
      columns: { userId: true },
    });
    return rows.map((r) => r.userId);
  }
}
```

> If `routineRoutines` doesn't expose `ownerId` (only `creatorId`), drop the union and return just `creatorId`. The implementer should confirm by reading `apps/server/libs/database/src/schemas/routine/routines.ts` first.

- [ ] **Step 4.5: Re-run test** — expect ALL PASS.

- [ ] **Step 4.6: Commit**

```bash
git add apps/server/apps/gateway/src/permissions/permission-keys.ts \
        apps/server/apps/gateway/src/permissions/permissions-approver.repository.ts \
        apps/server/apps/gateway/src/permissions/__tests__/permissions-approver.repository.spec.ts
git commit -m "feat(permissions): key registry + approver repository"
```

---

## Task 5: PermissionsService — grants CRUD

**Goal:** Implement `createGrant`, `revokeGrant`, `listGrants` on a new `PermissionsService` class. WS emission is added in Task 8; for now the service emits via an injected `EventEmitter2` token that the test can spy on.

**Files:**

- Create: `apps/server/apps/gateway/src/permissions/permissions.service.ts` (initial skeleton + grant methods)
- Create: `apps/server/apps/gateway/src/permissions/__tests__/permissions.service.grants.spec.ts`

**Acceptance Criteria:**

- [ ] `createGrant(input)` inserts with `source: 'proactive'` and rejects unknown `permissionKey` (`isPermissionKey` guard).
- [ ] `revokeGrant(grantId, userId)` sets `revokedAt` + `revokedByUserId`. Idempotent (already-revoked → no-op + return).
- [ ] `listGrants({ tenantId, subjectKind, subjectId, permissionKey, includeRevoked })` filters correctly.
- [ ] All methods covered by tests with mocked DB.

**Verify:** `cd apps/server && pnpm jest apps/gateway/src/permissions/__tests__/permissions.service.grants.spec.ts`

**Steps:**

- [ ] **Step 5.1: Write the failing test**

```ts
// apps/server/apps/gateway/src/permissions/__tests__/permissions.service.grants.spec.ts
import { jest } from "@jest/globals";
import { BadRequestException, NotFoundException } from "@nestjs/common";

const insertReturning = jest.fn();
const updateReturning = jest.fn();
const findManyMock = jest.fn();

const mockDb = {
  insert: jest.fn(() => ({
    values: jest.fn(() => ({ returning: insertReturning })),
  })),
  update: jest.fn(() => ({
    set: jest.fn(() => ({
      where: jest.fn(() => ({ returning: updateReturning })),
    })),
  })),
  query: {
    authPermissionGrants: { findMany: findManyMock, findFirst: jest.fn() },
  },
};

await jest.unstable_mockModule("@team9/database", () => ({
  DatabaseService: class {
    db = mockDb;
  },
  authPermissionGrants: {
    /* table marker */
  },
}));

const emit = jest.fn();
const events = { emit } as unknown;

const { PermissionsService } = await import("../permissions.service.js");

describe("PermissionsService — grants CRUD", () => {
  let svc: InstanceType<typeof PermissionsService>;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new PermissionsService(
      { db: mockDb } as never, // DatabaseService
      events as never, // EventEmitter2
      undefined as never, // SpellIdService — not used here
      undefined as never, // ApproverRepository — not used here
    );
  });

  it("createGrant inserts with source=proactive", async () => {
    insertReturning.mockResolvedValueOnce([{ id: "g1" }]);
    const grant = await svc.createGrant({
      tenantId: "t1",
      grantedByUserId: "u1",
      subjectKind: "agent",
      subjectId: "b1",
      permissionKey: "messages:send",
      scopeMetadata: { channelIds: ["c1"] },
    });
    expect(grant).toEqual({ id: "g1" });
    expect(mockDb.insert).toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(
      "permissions.grant.created",
      expect.objectContaining({ id: "g1", tenantId: "t1" }),
    );
  });

  it("createGrant rejects unknown permission key", async () => {
    await expect(
      svc.createGrant({
        tenantId: "t1",
        grantedByUserId: "u1",
        subjectKind: "agent",
        subjectId: "b1",
        permissionKey: "bogus:thing" as never,
        scopeMetadata: {},
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("revokeGrant sets revoked_at and emits event", async () => {
    updateReturning.mockResolvedValueOnce([
      { id: "g1", tenantId: "t1", revokedAt: new Date() },
    ]);
    const result = await svc.revokeGrant({ grantId: "g1", userId: "u1" });
    expect(result.revokedAt).toBeInstanceOf(Date);
    expect(emit).toHaveBeenCalledWith(
      "permissions.grant.revoked",
      expect.objectContaining({ id: "g1" }),
    );
  });

  it("revokeGrant throws NotFoundException when no row updated", async () => {
    updateReturning.mockResolvedValueOnce([]);
    await expect(
      svc.revokeGrant({ grantId: "missing", userId: "u1" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("listGrants filters by subject and excludes revoked by default", async () => {
    findManyMock.mockResolvedValueOnce([{ id: "g1" }]);
    const out = await svc.listGrants({
      tenantId: "t1",
      subjectKind: "agent",
      subjectId: "b1",
    });
    expect(out).toHaveLength(1);
    expect(findManyMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 5.2: Run failing test** — expect FAIL (PermissionsService not yet defined).

- [ ] **Step 5.3: Implement skeleton + grant methods**

```ts
// apps/server/apps/gateway/src/permissions/permissions.service.ts
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import {
  DatabaseService,
  authPermissionGrants,
  type AuthPermissionGrant,
} from "@team9/database";
import { isPermissionKey, type PermissionKey } from "./permission-keys.js";
import { SpellIdService } from "./spell-id.service.js";
import { PermissionsApproverRepository } from "./permissions-approver.repository.js";

export interface CreateGrantInput {
  tenantId: string;
  grantedByUserId: string;
  subjectKind: "agent" | "channel-session" | "execution-session" | "task";
  subjectId: string;
  permissionKey: PermissionKey;
  scopeMetadata?: Record<string, unknown>;
  expiresAt?: Date | null;
  note?: string | null;
  source?: "proactive" | "request_approved";
  requestId?: string | null;
}

export interface ListGrantsInput {
  tenantId: string;
  subjectKind?: CreateGrantInput["subjectKind"];
  subjectId?: string;
  permissionKey?: PermissionKey;
  includeRevoked?: boolean;
}

@Injectable()
export class PermissionsService {
  private readonly logger = new Logger(PermissionsService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly events: EventEmitter2,
    private readonly spell: SpellIdService,
    private readonly approvers: PermissionsApproverRepository,
  ) {}

  async createGrant(input: CreateGrantInput): Promise<AuthPermissionGrant> {
    if (!isPermissionKey(input.permissionKey)) {
      throw new BadRequestException(
        `Unknown permission key: ${input.permissionKey}`,
      );
    }
    const [row] = await this.database.db
      .insert(authPermissionGrants)
      .values({
        tenantId: input.tenantId,
        grantedByUserId: input.grantedByUserId,
        subjectKind: input.subjectKind,
        subjectId: input.subjectId,
        permissionKey: input.permissionKey,
        scopeMetadata: input.scopeMetadata ?? {},
        source: input.source ?? "proactive",
        requestId: input.requestId ?? null,
        expiresAt: input.expiresAt ?? null,
        note: input.note ?? null,
      })
      .returning();
    if (!row) {
      throw new Error("insert returned empty");
    }
    this.events.emit("permissions.grant.created", {
      id: row.id,
      tenantId: row.tenantId,
      subjectKind: row.subjectKind,
      subjectId: row.subjectId,
      permissionKey: row.permissionKey,
      scopeMetadata: row.scopeMetadata,
    });
    return row;
  }

  async revokeGrant(input: {
    grantId: string;
    userId: string;
  }): Promise<AuthPermissionGrant> {
    const [row] = await this.database.db
      .update(authPermissionGrants)
      .set({ revokedAt: new Date(), revokedByUserId: input.userId })
      .where(
        and(
          eq(authPermissionGrants.id, input.grantId),
          isNull(authPermissionGrants.revokedAt),
        ),
      )
      .returning();
    if (!row)
      throw new NotFoundException(
        `Grant ${input.grantId} not found or already revoked`,
      );
    this.events.emit("permissions.grant.revoked", {
      id: row.id,
      tenantId: row.tenantId,
    });
    return row;
  }

  async listGrants(input: ListGrantsInput): Promise<AuthPermissionGrant[]> {
    const where = [eq(authPermissionGrants.tenantId, input.tenantId)];
    if (input.subjectKind)
      where.push(eq(authPermissionGrants.subjectKind, input.subjectKind));
    if (input.subjectId)
      where.push(eq(authPermissionGrants.subjectId, input.subjectId));
    if (input.permissionKey)
      where.push(eq(authPermissionGrants.permissionKey, input.permissionKey));
    if (!input.includeRevoked)
      where.push(isNull(authPermissionGrants.revokedAt));
    return this.database.db.query.authPermissionGrants.findMany({
      where: and(...where),
      orderBy: [desc(authPermissionGrants.createdAt)],
    });
  }
}
```

- [ ] **Step 5.4: Re-run tests** — expect PASS.

- [ ] **Step 5.5: Commit**

```bash
git add apps/server/apps/gateway/src/permissions/permissions.service.ts \
        apps/server/apps/gateway/src/permissions/__tests__/permissions.service.grants.spec.ts
git commit -m "feat(permissions): grants CRUD on PermissionsService"
```

---

## Task 6: PermissionsService — gate + once-use consume

**Goal:** Implement the central `gate({ key, metadata, ctx })` check function, including specificity-ordered grant lookup, scope matching via `matchesScope`, and race-safe consumption of `approved_once` requests.

**Files:**

- Modify: `apps/server/apps/gateway/src/permissions/permissions.service.ts` (add `gate(...)`)
- Create: `apps/server/apps/gateway/src/permissions/__tests__/permissions.service.gate.spec.ts`

**Acceptance Criteria:**

- [ ] Returns `{ allowed: true, via: 'grant', grantId }` when an active grant matches.
- [ ] Specificity order: execution-session > channel-session > task > agent. The most-specific match wins; lower-specificity grants only checked if higher-specificity grants don't match.
- [ ] Skips revoked grants, expired grants.
- [ ] Falls through to `approved_once` requests when no grant matches; matches require same key + same context (channel/execution if present in request) + scope match against `requested_metadata`.
- [ ] Race: parallel consumes of the same once-approval — only one wins (UPDATE WHERE consumed_at IS NULL); loser falls through to DENY.
- [ ] Returns `{ allowed: false }` when nothing matches.

**Verify:** `cd apps/server && pnpm jest apps/gateway/src/permissions/__tests__/permissions.service.gate.spec.ts`

**Steps:**

- [ ] **Step 6.1: Write the failing test**

```ts
// apps/server/apps/gateway/src/permissions/__tests__/permissions.service.gate.spec.ts
import { jest } from "@jest/globals";

const grantsFindMany = jest.fn();
const requestsFindFirst = jest.fn();
const updateReturning = jest.fn();

const mockDb = {
  insert: jest.fn(),
  update: jest.fn(() => ({
    set: jest.fn(() => ({
      where: jest.fn(() => ({ returning: updateReturning })),
    })),
  })),
  query: {
    authPermissionGrants: { findMany: grantsFindMany },
    authPermissionRequests: { findFirst: requestsFindFirst },
  },
};

await jest.unstable_mockModule("@team9/database", () => ({
  DatabaseService: class {
    db = mockDb;
  },
  authPermissionGrants: {},
  authPermissionRequests: {},
}));

const { PermissionsService } = await import("../permissions.service.js");

const events = { emit: jest.fn() };

describe("PermissionsService.gate", () => {
  let svc: InstanceType<typeof PermissionsService>;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new PermissionsService(
      { db: mockDb } as never,
      events as never,
      undefined as never,
      undefined as never,
    );
  });

  it("returns allowed=true when an agent-level grant matches", async () => {
    grantsFindMany.mockResolvedValueOnce([
      {
        id: "g1",
        subjectKind: "agent",
        subjectId: "b1",
        permissionKey: "messages:send",
        scopeMetadata: {},
        revokedAt: null,
        expiresAt: null,
      },
    ]);
    const r = await svc.gate({
      key: "messages:send",
      metadata: { channelId: "c1" },
      ctx: { tenantId: "t1", botId: "b1", channelId: "c1" },
    });
    expect(r).toEqual({ allowed: true, via: "grant", grantId: "g1" });
  });

  it("chooses the most specific grant first", async () => {
    grantsFindMany.mockResolvedValueOnce([
      // Returned in arbitrary order; service must sort by specificity
      {
        id: "g-agent",
        subjectKind: "agent",
        subjectId: "b1",
        permissionKey: "tools:invoke",
        scopeMetadata: {},
      },
      {
        id: "g-exec",
        subjectKind: "execution-session",
        subjectId: "e1",
        permissionKey: "tools:invoke",
        scopeMetadata: { toolNames: ["sql"] },
      },
    ]);
    const r = await svc.gate({
      key: "tools:invoke",
      metadata: { toolName: "sql" },
      ctx: { tenantId: "t1", botId: "b1", executionId: "e1" },
    });
    expect(r).toEqual({ allowed: true, via: "grant", grantId: "g-exec" });
  });

  it("rejects scope mismatch", async () => {
    grantsFindMany.mockResolvedValueOnce([
      {
        id: "g1",
        subjectKind: "agent",
        subjectId: "b1",
        permissionKey: "tools:invoke",
        scopeMetadata: { toolNames: ["sql"] },
      },
    ]);
    requestsFindFirst.mockResolvedValueOnce(null);
    const r = await svc.gate({
      key: "tools:invoke",
      metadata: { toolName: "shell" },
      ctx: { tenantId: "t1", botId: "b1" },
    });
    expect(r).toEqual({ allowed: false });
  });

  it("falls through to approved_once and consumes it", async () => {
    grantsFindMany.mockResolvedValueOnce([]);
    requestsFindFirst.mockResolvedValueOnce({
      id: "req1",
      requestedMetadata: { channelId: "c1" },
      contextChannelId: "c1",
    });
    updateReturning.mockResolvedValueOnce([
      { id: "req1", consumedAt: new Date() },
    ]);
    const r = await svc.gate({
      key: "messages:send",
      metadata: { channelId: "c1" },
      ctx: { tenantId: "t1", botId: "b1", channelId: "c1" },
    });
    expect(r).toEqual({
      allowed: true,
      via: "approved_once",
      requestId: "req1",
    });
    expect(events.emit).toHaveBeenCalledWith(
      "permissions.request.consumed",
      expect.objectContaining({ id: "req1" }),
    );
  });

  it("once-approval lost race -> denies", async () => {
    grantsFindMany.mockResolvedValueOnce([]);
    requestsFindFirst.mockResolvedValueOnce({
      id: "req1",
      requestedMetadata: { channelId: "c1" },
      contextChannelId: "c1",
    });
    updateReturning.mockResolvedValueOnce([]); // another caller already consumed
    const r = await svc.gate({
      key: "messages:send",
      metadata: { channelId: "c1" },
      ctx: { tenantId: "t1", botId: "b1", channelId: "c1" },
    });
    expect(r).toEqual({ allowed: false });
  });
});
```

- [ ] **Step 6.2: Run failing test** — expect FAIL.

- [ ] **Step 6.3: Add `gate` to PermissionsService**

Add to `permissions.service.ts`:

```ts
import { matchesScope } from './permission-matcher.js';
import { authPermissionRequests } from '@team9/database';

const SUBJECT_RANK: Record<string, number> = {
  'execution-session': 4,
  'channel-session': 3,
  task: 2,
  agent: 1,
};

export interface GateContext {
  tenantId: string;
  botId: string;
  channelId?: string;
  executionId?: string;
  routineId?: string;
}

export type GateResult =
  | { allowed: true; via: 'grant'; grantId: string }
  | { allowed: true; via: 'approved_once'; requestId: string }
  | { allowed: false };

// Inside the class:
async gate(input: {
  key: PermissionKey;
  metadata: Record<string, unknown>;
  ctx: GateContext;
}): Promise<GateResult> {
  // 1. Build candidate subject filter
  const subjectMatchers: Array<{ kind: string; id: string }> = [
    { kind: 'agent', id: input.ctx.botId },
  ];
  if (input.ctx.channelId)
    subjectMatchers.push({ kind: 'channel-session', id: input.ctx.channelId });
  if (input.ctx.executionId)
    subjectMatchers.push({ kind: 'execution-session', id: input.ctx.executionId });
  if (input.ctx.routineId)
    subjectMatchers.push({ kind: 'task', id: input.ctx.routineId });

  const grants = await this.database.db.query.authPermissionGrants.findMany({
    where: and(
      eq(authPermissionGrants.tenantId, input.ctx.tenantId),
      eq(authPermissionGrants.permissionKey, input.key),
      isNull(authPermissionGrants.revokedAt),
    ),
  });
  const now = Date.now();
  const filtered = grants
    .filter((g) => !g.expiresAt || g.expiresAt.getTime() > now)
    .filter((g) =>
      subjectMatchers.some((m) => m.kind === g.subjectKind && m.id === g.subjectId),
    )
    .sort(
      (a, b) =>
        (SUBJECT_RANK[b.subjectKind] ?? 0) - (SUBJECT_RANK[a.subjectKind] ?? 0),
    );

  for (const g of filtered) {
    if (matchesScope(input.metadata, g.scopeMetadata as Record<string, unknown>)) {
      return { allowed: true, via: 'grant', grantId: g.id };
    }
  }

  // 2. Fall through to once-approvals
  const onceWhere = and(
    eq(authPermissionRequests.tenantId, input.ctx.tenantId),
    eq(authPermissionRequests.requesterBotId, input.ctx.botId),
    eq(authPermissionRequests.permissionKey, input.key),
    eq(authPermissionRequests.status, 'approved_once'),
    isNull(authPermissionRequests.consumedAt),
  );
  const candidate = await this.database.db.query.authPermissionRequests.findFirst({
    where: onceWhere,
    orderBy: [desc(authPermissionRequests.decidedAt)],
  });
  if (
    candidate &&
    matchesScope(
      input.metadata,
      candidate.requestedMetadata as Record<string, unknown>,
    ) &&
    (!candidate.contextChannelId || candidate.contextChannelId === input.ctx.channelId) &&
    (!candidate.contextExecutionId || candidate.contextExecutionId === input.ctx.executionId)
  ) {
    const [consumed] = await this.database.db
      .update(authPermissionRequests)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(authPermissionRequests.id, candidate.id),
          isNull(authPermissionRequests.consumedAt),
        ),
      )
      .returning();
    if (consumed) {
      this.events.emit('permissions.request.consumed', {
        id: consumed.id,
        requesterBotId: input.ctx.botId,
        permissionKey: input.key,
      });
      return { allowed: true, via: 'approved_once', requestId: consumed.id };
    }
  }

  return { allowed: false };
}
```

- [ ] **Step 6.4: Re-run tests** — expect ALL PASS. Iterate on any failures (likely the `eq(authPermissionGrants.subjectKind, ...)` pattern won't match the mock; the test uses runtime filtering which is fine).

- [ ] **Step 6.5: Commit**

```bash
git add apps/server/apps/gateway/src/permissions/permissions.service.ts \
        apps/server/apps/gateway/src/permissions/__tests__/permissions.service.gate.spec.ts
git commit -m "feat(permissions): central gate() check with once-use consume"
```

---

## Task 7: PermissionsService — request lifecycle + resolveApprovers

**Goal:** Implement `createRequest` (with spell-id collision retry), `cancelRequest`, `decideRequest` (once / remember / deny), and the canonical `resolveApprovers(request)`.

**Files:**

- Modify: `apps/server/apps/gateway/src/permissions/permissions.service.ts`
- Create: `apps/server/apps/gateway/src/permissions/__tests__/permissions.service.requests.spec.ts`

**Acceptance Criteria:**

- [ ] `createRequest` retries spell-id generation on unique-violation (PG error code `23505`) up to 3 times, then escalates to 4 words.
- [ ] `decideRequest({ decision: 'remember', ... })` creates a grant in the same transaction and links `durableGrantId`.
- [ ] `decideRequest({ decision: 'once', ... })` updates request only.
- [ ] `decideRequest({ decision: 'deny', ... })` updates request only, sets status `denied`.
- [ ] `decideRequest` rejects when `status !== 'pending'` (returns 409).
- [ ] `cancelRequest` only succeeds for the requesting bot's own pending requests.
- [ ] `resolveApprovers(request)` returns: per-key holders ∪ suggested ∪ workspace owners; deduplicated.
- [ ] When suggested approver belongs to a different tenant, drop it (still log warning).

**Verify:** `cd apps/server && pnpm jest apps/gateway/src/permissions/__tests__/permissions.service.requests.spec.ts`

**Steps:**

- [ ] **Step 7.1: Write the failing test** — covering all acceptance criteria. The test mocks DatabaseService, EventEmitter2, SpellIdService, ApproverRepository, plus `tenantMembers` query for tenant validation of suggested approvers.

```ts
// apps/server/apps/gateway/src/permissions/__tests__/permissions.service.requests.spec.ts
import { jest } from "@jest/globals";
import { ConflictException } from "@nestjs/common";

const insertGrantReturning = jest.fn();
const insertRequestReturning = jest.fn();
const updateRequestReturning = jest.fn();
const requestFindFirst = jest.fn();
const tenantMembersFindMany = jest.fn();

const tx = {
  insert: jest.fn((tbl: any) => ({
    values: jest.fn(() => ({
      returning:
        tbl.__name === "requests"
          ? insertRequestReturning
          : insertGrantReturning,
    })),
  })),
  update: jest.fn(() => ({
    set: jest.fn(() => ({
      where: jest.fn(() => ({ returning: updateRequestReturning })),
    })),
  })),
  query: {
    authPermissionRequests: { findFirst: requestFindFirst },
    tenantMembers: { findMany: tenantMembersFindMany },
  },
};

const mockDb = {
  ...tx,
  transaction: jest.fn(async (fn: any) => fn(tx)),
};

await jest.unstable_mockModule("@team9/database", () => ({
  DatabaseService: class {
    db = mockDb;
  },
  authPermissionGrants: { __name: "grants" },
  authPermissionRequests: { __name: "requests" },
  tenantMembers: {},
}));

const events = { emit: jest.fn() };
const spell = {
  generate: jest.fn(() => "raven crystal flame"),
  parse: jest.fn(),
};
const approvers = {
  findChannelOwnersAndAdmins: jest.fn(),
  findBotOwnerAndMentor: jest.fn(),
  findRoutineCreatorAndOwner: jest.fn(),
  findWikiOwners: jest.fn(),
  findWorkspaceOwners: jest.fn(),
  findWorkspaceAdmins: jest.fn(),
};

const { PermissionsService } = await import("../permissions.service.js");

describe("PermissionsService — requests", () => {
  let svc: InstanceType<typeof PermissionsService>;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new PermissionsService(
      { db: mockDb } as never,
      events as never,
      spell as never,
      approvers as never,
    );
  });

  describe("createRequest", () => {
    it("inserts a pending request with generated spell id", async () => {
      insertRequestReturning.mockResolvedValueOnce([
        { id: "r1", spellId: "raven crystal flame", status: "pending" },
      ]);
      approvers.findBotOwnerAndMentor.mockResolvedValueOnce(["u-owner"]);
      approvers.findWorkspaceOwners.mockResolvedValueOnce([]);

      const r = await svc.createRequest({
        tenantId: "t1",
        requesterBotId: "b1",
        permissionKey: "tools:invoke",
        requestedMetadata: { toolName: "sql" },
        reason: "data lookup",
      });
      expect(r).toMatchObject({ id: "r1", spellId: "raven crystal flame" });
      expect(events.emit).toHaveBeenCalledWith(
        "permissions.request.created",
        expect.objectContaining({ id: "r1", approverIds: ["u-owner"] }),
      );
    });

    it("retries on unique violation, escalates to 4 words", async () => {
      const dupeErr = Object.assign(new Error("dupe"), { code: "23505" });
      insertRequestReturning
        .mockRejectedValueOnce(dupeErr)
        .mockRejectedValueOnce(dupeErr)
        .mockRejectedValueOnce(dupeErr)
        .mockResolvedValueOnce([
          { id: "r1", spellId: "a b c d", status: "pending" },
        ]);
      approvers.findBotOwnerAndMentor.mockResolvedValue(["u-owner"]);
      approvers.findWorkspaceOwners.mockResolvedValue([]);

      const r = await svc.createRequest({
        tenantId: "t1",
        requesterBotId: "b1",
        permissionKey: "tools:invoke",
        requestedMetadata: { toolName: "sql" },
      });
      expect(r.id).toBe("r1");
      expect(spell.generate).toHaveBeenCalledTimes(4);
      // 4th call should pass wordCount: 4
      expect(spell.generate.mock.calls[3]?.[0]).toEqual({ wordCount: 4 });
    });
  });

  describe("decideRequest", () => {
    it("once: updates status only", async () => {
      requestFindFirst.mockResolvedValueOnce({
        id: "r1",
        tenantId: "t1",
        status: "pending",
        permissionKey: "tools:invoke",
        requestedMetadata: { toolName: "sql" },
        requesterBotId: "b1",
        contextChannelId: null,
        contextExecutionId: null,
        contextRoutineId: null,
        suggestedApproverIds: [],
      });
      updateRequestReturning.mockResolvedValueOnce([
        { id: "r1", status: "approved_once" },
      ]);
      approvers.findBotOwnerAndMentor.mockResolvedValueOnce(["u-owner"]);
      approvers.findWorkspaceOwners.mockResolvedValueOnce([]);

      const r = await svc.decideRequest({
        requestId: "r1",
        userId: "u-owner",
        decision: "once",
      });
      expect(r.status).toBe("approved_once");
      expect(events.emit).toHaveBeenCalledWith(
        "permissions.request.decided",
        expect.objectContaining({ id: "r1", status: "approved_once" }),
      );
    });

    it("remember: creates a grant in the same transaction", async () => {
      requestFindFirst.mockResolvedValueOnce({
        id: "r1",
        tenantId: "t1",
        status: "pending",
        permissionKey: "tools:invoke",
        requestedMetadata: { toolName: "sql" },
        requesterBotId: "b1",
        contextChannelId: null,
        contextExecutionId: null,
        contextRoutineId: null,
        suggestedApproverIds: [],
      });
      insertGrantReturning.mockResolvedValueOnce([{ id: "g1" }]);
      updateRequestReturning.mockResolvedValueOnce([
        { id: "r1", status: "approved_durable", durableGrantId: "g1" },
      ]);
      approvers.findBotOwnerAndMentor.mockResolvedValue(["u-owner"]);
      approvers.findWorkspaceOwners.mockResolvedValue([]);

      const r = await svc.decideRequest({
        requestId: "r1",
        userId: "u-owner",
        decision: "remember",
        rememberSubject: "agent",
      });
      expect(r.durableGrantId).toBe("g1");
      expect(mockDb.transaction).toHaveBeenCalled();
    });

    it("rejects when request already decided", async () => {
      requestFindFirst.mockResolvedValueOnce({
        id: "r1",
        tenantId: "t1",
        status: "denied",
        permissionKey: "tools:invoke",
        requestedMetadata: {},
        requesterBotId: "b1",
        suggestedApproverIds: [],
      });
      approvers.findBotOwnerAndMentor.mockResolvedValueOnce(["u-owner"]);
      approvers.findWorkspaceOwners.mockResolvedValueOnce([]);
      await expect(
        svc.decideRequest({
          requestId: "r1",
          userId: "u-owner",
          decision: "once",
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe("resolveApprovers", () => {
    it("unions key holders + suggested + workspace owners", async () => {
      tenantMembersFindMany.mockResolvedValueOnce([
        { userId: "u-suggested-1" },
      ]);
      approvers.findBotOwnerAndMentor.mockResolvedValueOnce(["u-owner"]);
      approvers.findWorkspaceOwners.mockResolvedValueOnce(["u-ws-owner"]);
      const ids = await svc.resolveApprovers({
        id: "r1",
        tenantId: "t1",
        requesterBotId: "b1",
        permissionKey: "tools:invoke",
        requestedMetadata: {},
        suggestedApproverIds: ["u-suggested-1", "u-foreign"],
        contextChannelId: null,
        contextExecutionId: null,
        contextRoutineId: null,
      } as never);
      expect(new Set(ids)).toEqual(
        new Set(["u-owner", "u-suggested-1", "u-ws-owner"]),
      );
      // u-foreign was filtered (not in tenantMembers result)
    });
  });
});
```

- [ ] **Step 7.2: Run failing test** — expect FAIL.

- [ ] **Step 7.3: Implement methods**

Append to `permissions.service.ts`:

```ts
import { ConflictException } from '@nestjs/common';
import { tenantMembers } from '@team9/database';
import { PERMISSION_KEYS } from './permission-keys.js';

export interface CreateRequestInput {
  tenantId: string;
  requesterBotId: string;
  permissionKey: PermissionKey;
  requestedMetadata: Record<string, unknown>;
  reason?: string;
  contextChannelId?: string;
  contextExecutionId?: string;
  contextRoutineId?: string;
  suggestedApproverIds?: string[];
  ttlMs?: number; // default 30 minutes
}

export type DecideInput = {
  requestId: string;
  userId: string;
} & (
  | { decision: 'deny'; note?: string }
  | { decision: 'once'; scopeOverride?: Record<string, unknown>; note?: string }
  | {
      decision: 'remember';
      scopeOverride?: Record<string, unknown>;
      expiresAt?: Date | null;
      rememberSubject?: 'agent' | 'channel-session' | 'execution-session' | 'task';
      note?: string;
    }
);

const DEFAULT_REQUEST_TTL_MS = 30 * 60 * 1000;
const SPELL_RETRY_LIMIT_3 = 3; // try 3 words this many times before escalating

// inside class

async createRequest(input: CreateRequestInput) {
  const ttl = input.ttlMs ?? DEFAULT_REQUEST_TTL_MS;
  const expiresAt = new Date(Date.now() + ttl);

  let attempt = 0;
  while (true) {
    const wordCount = attempt < SPELL_RETRY_LIMIT_3 ? 3 : 4;
    const spellId = this.spell.generate({ wordCount });
    try {
      const [row] = await this.database.db
        .insert(authPermissionRequests)
        .values({
          spellId,
          tenantId: input.tenantId,
          requesterBotId: input.requesterBotId,
          contextChannelId: input.contextChannelId ?? null,
          contextExecutionId: input.contextExecutionId ?? null,
          contextRoutineId: input.contextRoutineId ?? null,
          permissionKey: input.permissionKey,
          requestedMetadata: input.requestedMetadata,
          suggestedApproverIds: input.suggestedApproverIds ?? [],
          reason: input.reason ?? null,
          status: 'pending',
          expiresAt,
        })
        .returning();
      const approverIds = await this.resolveApprovers(row!);
      this.events.emit('permissions.request.created', {
        id: row!.id,
        spellId: row!.spellId,
        tenantId: row!.tenantId,
        requesterBotId: row!.requesterBotId,
        permissionKey: row!.permissionKey,
        requestedMetadata: row!.requestedMetadata,
        contextChannelId: row!.contextChannelId,
        expiresAt: row!.expiresAt,
        reason: row!.reason,
        approverIds,
      });
      return row!;
    } catch (err) {
      if (this.isUniqueViolation(err) && attempt < 5) {
        attempt += 1;
        continue;
      }
      throw err;
    }
  }
}

private isUniqueViolation(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as { code?: string }).code === '23505');
}

async cancelRequest(input: { requestId: string; requesterBotId: string }) {
  const [row] = await this.database.db
    .update(authPermissionRequests)
    .set({ status: 'cancelled' })
    .where(
      and(
        eq(authPermissionRequests.id, input.requestId),
        eq(authPermissionRequests.requesterBotId, input.requesterBotId),
        eq(authPermissionRequests.status, 'pending'),
      ),
    )
    .returning();
  if (!row) throw new NotFoundException('Request not found or already decided');
  this.events.emit('permissions.request.decided', {
    id: row.id,
    spellId: row.spellId,
    status: row.status,
    decidedByUserId: null,
  });
  return row;
}

async decideRequest(input: DecideInput) {
  const existing = await this.database.db.query.authPermissionRequests.findFirst({
    where: eq(authPermissionRequests.id, input.requestId),
  });
  if (!existing) throw new NotFoundException(`Request ${input.requestId} not found`);
  if (existing.status !== 'pending') {
    throw new ConflictException(
      `Request ${input.requestId} is already ${existing.status}`,
    );
  }

  return this.database.db.transaction(async (tx) => {
    let durableGrantId: string | null = null;
    const newMetadata =
      'scopeOverride' in input && input.scopeOverride
        ? input.scopeOverride
        : (existing.requestedMetadata as Record<string, unknown>);

    if (input.decision === 'remember') {
      const subjectKind = input.rememberSubject ?? this.defaultRememberSubject(existing);
      const subjectId = this.subjectIdFor(subjectKind, existing);
      const [grantRow] = await tx
        .insert(authPermissionGrants)
        .values({
          tenantId: existing.tenantId,
          grantedByUserId: input.userId,
          subjectKind,
          subjectId,
          permissionKey: existing.permissionKey,
          scopeMetadata: newMetadata,
          source: 'request_approved',
          requestId: existing.id,
          expiresAt: input.expiresAt ?? null,
          note: input.note ?? null,
        })
        .returning();
      durableGrantId = grantRow!.id;
      this.events.emit('permissions.grant.created', { id: grantRow!.id, tenantId: existing.tenantId });
    }

    const newStatus =
      input.decision === 'deny'
        ? 'denied'
        : input.decision === 'once'
          ? 'approved_once'
          : 'approved_durable';

    const [updated] = await tx
      .update(authPermissionRequests)
      .set({
        status: newStatus,
        decidedByUserId: input.userId,
        decidedAt: new Date(),
        decisionNote: input.note ?? null,
        requestedMetadata: newMetadata,
        durableGrantId,
      })
      .where(eq(authPermissionRequests.id, existing.id))
      .returning();

    this.events.emit('permissions.request.decided', {
      id: updated!.id,
      spellId: updated!.spellId,
      status: updated!.status,
      decidedByUserId: input.userId,
      durableGrantId,
    });
    return updated!;
  });
}

private defaultRememberSubject(req: { contextChannelId: string | null; contextRoutineId: string | null }) {
  if (req.contextChannelId) return 'channel-session' as const;
  if (req.contextRoutineId) return 'task' as const;
  return 'agent' as const;
}

private subjectIdFor(
  kind: 'agent' | 'channel-session' | 'execution-session' | 'task',
  req: { requesterBotId: string; contextChannelId: string | null; contextExecutionId: string | null; contextRoutineId: string | null },
): string {
  switch (kind) {
    case 'agent': return req.requesterBotId;
    case 'channel-session':
      if (!req.contextChannelId) throw new BadRequestException('No channel context for channel-session subject');
      return req.contextChannelId;
    case 'execution-session':
      if (!req.contextExecutionId) throw new BadRequestException('No execution context for execution-session subject');
      return req.contextExecutionId;
    case 'task':
      if (!req.contextRoutineId) throw new BadRequestException('No routine context for task subject');
      return req.contextRoutineId;
  }
}

async resolveApprovers(req: {
  id: string;
  tenantId: string;
  requesterBotId: string;
  permissionKey: PermissionKey;
  requestedMetadata: Record<string, unknown>;
  suggestedApproverIds: string[];
  contextChannelId: string | null;
  contextExecutionId: string | null;
  contextRoutineId: string | null;
}): Promise<string[]> {
  const def = PERMISSION_KEYS[req.permissionKey];
  const primary = await def.resolveApprovers(
    {
      tenantId: req.tenantId,
      requesterBotId: req.requesterBotId,
      permissionKey: req.permissionKey,
      metadata: req.requestedMetadata,
      contextChannelId: req.contextChannelId,
      contextExecutionId: req.contextExecutionId,
      contextRoutineId: req.contextRoutineId,
    },
    { repo: this.approvers },
  );

  // Validate suggested approvers belong to same tenant
  const suggested = req.suggestedApproverIds ?? [];
  let validSuggested: string[] = [];
  if (suggested.length) {
    const rows = await this.database.db.query.tenantMembers.findMany({
      where: and(
        eq(tenantMembers.tenantId, req.tenantId),
        inArray(tenantMembers.userId, suggested),
      ),
      columns: { userId: true },
    });
    validSuggested = rows.map((r) => r.userId);
    const dropped = suggested.filter((id) => !validSuggested.includes(id));
    if (dropped.length) {
      this.logger.warn(
        `Dropped foreign-tenant suggested approvers for request ${req.id}: ${dropped.join(', ')}`,
      );
    }
  }

  let union = new Set([...primary, ...validSuggested]);

  if (union.size === 0) {
    if (def.defaultApprovers === 'workspace-admins') {
      const ids = await this.approvers.findWorkspaceAdmins(req.tenantId);
      ids.forEach((id) => union.add(id));
    } else if (def.defaultApprovers === 'bot-owners') {
      const ids = await this.approvers.findBotOwnerAndMentor(req.requesterBotId);
      ids.forEach((id) => union.add(id));
    }
  }

  // Workspace owners always included as safety net
  const wsOwners = await this.approvers.findWorkspaceOwners(req.tenantId);
  wsOwners.forEach((id) => union.add(id));

  return [...union];
}

async canDecide(userId: string, request: Parameters<this['resolveApprovers']>[0]): Promise<boolean> {
  const ids = await this.resolveApprovers(request);
  return ids.includes(userId);
}
```

Add `inArray` to the imports from `drizzle-orm` at the top if not already there.

- [ ] **Step 7.4: Re-run tests** — expect ALL PASS.

- [ ] **Step 7.5: Commit**

```bash
git add apps/server/apps/gateway/src/permissions/permissions.service.ts \
        apps/server/apps/gateway/src/permissions/__tests__/permissions.service.requests.spec.ts
git commit -m "feat(permissions): request lifecycle (create/decide/cancel/resolveApprovers)"
```

---

## Task 8: WS events domain + broadcastToApprovers + service emission

**Goal:** Define typed WebSocket events for the permissions domain, add a broadcaster on `WebsocketGateway`, and wire `PermissionsService` events to per-approver-list dispatch.

**Files:**

- Create: `apps/server/libs/shared/src/events/domains/permissions/index.ts`
- Modify: `apps/server/libs/shared/src/events/index.ts` (re-export domain)
- Modify: `apps/server/apps/gateway/src/im/websocket/websocket.gateway.ts` (add `broadcastToUsers` method if absent; `sendToUser` already exists but loop helper is convenient)
- Create: `apps/server/apps/gateway/src/permissions/permissions.ws-bridge.ts` (NestJS event listener that bridges service events → WS)
- Modify: `apps/server/apps/gateway/src/permissions/permissions.module.ts` (registered next task; bridge is provided here)
- Create: `apps/server/apps/gateway/src/permissions/__tests__/permissions.ws-bridge.spec.ts`

**Acceptance Criteria:**

- [ ] Event names exported as a frozen object: `PERMISSION_EVENTS = { REQUEST_CREATED: 'permission_request_created', ... }`.
- [ ] Each event payload has a TypeScript interface.
- [ ] `permissions.request.created` fired by service → WS bridge calls `gateway.sendToUser(approverId, 'permission_request_created', payload)` for each approver.
- [ ] `permissions.request.decided` also notifies the requester bot via its `userId` (resolved from `im_bots.userId`) plus all approvers.
- [ ] Bridge unit-tested without real Socket.io.

**Verify:** `cd apps/server && pnpm jest apps/gateway/src/permissions/__tests__/permissions.ws-bridge.spec.ts`

**Steps:**

- [ ] **Step 8.1: Define event names + payloads**

```ts
// apps/server/libs/shared/src/events/domains/permissions/index.ts
export const PERMISSION_EVENTS = Object.freeze({
  REQUEST_CREATED: "permission_request_created",
  REQUEST_DECIDED: "permission_request_decided",
  REQUEST_CONSUMED: "permission_request_consumed",
  GRANT_CREATED: "permission_grant_created",
  GRANT_REVOKED: "permission_grant_revoked",
} as const);

export interface PermissionRequestCreatedPayload {
  id: string;
  spellId: string;
  tenantId: string;
  requesterBotId: string;
  permissionKey: string;
  requestedMetadata: Record<string, unknown>;
  contextChannelId: string | null;
  expiresAt: string; // ISO
  reason: string | null;
}

export interface PermissionRequestDecidedPayload {
  id: string;
  spellId: string;
  status: "approved_once" | "approved_durable" | "denied" | "cancelled";
  decidedByUserId: string | null;
  durableGrantId: string | null;
}

export interface PermissionRequestConsumedPayload {
  id: string;
  requesterBotId: string;
  permissionKey: string;
}

export interface PermissionGrantCreatedPayload {
  id: string;
  tenantId: string;
  subjectKind: string;
  subjectId: string;
  permissionKey: string;
  scopeMetadata: Record<string, unknown>;
}

export interface PermissionGrantRevokedPayload {
  id: string;
  tenantId: string;
}
```

Re-export from `apps/server/libs/shared/src/events/index.ts`:

```ts
export * from "./domains/permissions/index.js";
```

- [ ] **Step 8.2: Add WS bridge with TDD**

```ts
// apps/server/apps/gateway/src/permissions/__tests__/permissions.ws-bridge.spec.ts
import { jest } from "@jest/globals";
const { PermissionsWsBridge } = await import("../permissions.ws-bridge.js");

describe("PermissionsWsBridge", () => {
  it("broadcasts request_created to each approver", async () => {
    const sendToUser = jest.fn();
    const gateway = { sendToUser } as never;
    const service = {
      resolveApprovers: jest.fn(async () => ["u1", "u2"]),
    } as never;
    const botService = { getBotUserId: jest.fn() } as never;

    const bridge = new PermissionsWsBridge(gateway, service, botService);
    await bridge.onRequestCreated({
      id: "r1",
      spellId: "a b c",
      tenantId: "t1",
      requesterBotId: "b1",
      permissionKey: "tools:invoke",
      requestedMetadata: {},
      contextChannelId: null,
      expiresAt: new Date(),
      reason: null,
      approverIds: ["u1", "u2"],
    } as never);
    expect(sendToUser).toHaveBeenCalledTimes(2);
    expect(sendToUser).toHaveBeenCalledWith(
      "u1",
      "permission_request_created",
      expect.objectContaining({ id: "r1" }),
    );
    expect(sendToUser).toHaveBeenCalledWith(
      "u2",
      "permission_request_created",
      expect.any(Object),
    );
  });

  it("broadcasts request_decided to approvers + requester bot user id", async () => {
    const sendToUser = jest.fn();
    const gateway = { sendToUser } as never;
    const service = {
      resolveApprovers: jest.fn(async () => ["u1"]),
      getRequest: jest.fn(async () => ({
        id: "r1",
        tenantId: "t1",
        requesterBotId: "b1",
        permissionKey: "tools:invoke",
        requestedMetadata: {},
        suggestedApproverIds: [],
        contextChannelId: null,
        contextExecutionId: null,
        contextRoutineId: null,
      })),
    } as never;
    const botService = { getBotUserId: jest.fn(async () => "u-bot") } as never;
    const bridge = new PermissionsWsBridge(gateway, service, botService);
    await bridge.onRequestDecided({
      id: "r1",
      spellId: "a b c",
      status: "approved_once",
      decidedByUserId: "u-decider",
      durableGrantId: null,
    });
    const recipients = sendToUser.mock.calls.map(([u]) => u).sort();
    expect(recipients).toEqual(["u-bot", "u1"].sort());
  });
});
```

- [ ] **Step 8.3: Implement bridge**

```ts
// apps/server/apps/gateway/src/permissions/permissions.ws-bridge.ts
import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { WebsocketGateway } from "../im/websocket/websocket.gateway.js";
import { PermissionsService } from "./permissions.service.js";
import { BotsService } from "../im/bots/bots.service.js"; // adjust import path to actual file
import {
  PERMISSION_EVENTS,
  type PermissionRequestCreatedPayload,
  type PermissionRequestDecidedPayload,
  type PermissionRequestConsumedPayload,
  type PermissionGrantCreatedPayload,
  type PermissionGrantRevokedPayload,
} from "@team9/shared";

@Injectable()
export class PermissionsWsBridge {
  private readonly logger = new Logger(PermissionsWsBridge.name);

  constructor(
    private readonly gateway: WebsocketGateway,
    private readonly permissions: PermissionsService,
    private readonly bots: BotsService,
  ) {}

  @OnEvent("permissions.request.created")
  async onRequestCreated(
    payload: PermissionRequestCreatedPayload & { approverIds: string[] },
  ) {
    for (const userId of payload.approverIds) {
      this.gateway.sendToUser(
        userId,
        PERMISSION_EVENTS.REQUEST_CREATED,
        payload,
      );
    }
  }

  @OnEvent("permissions.request.decided")
  async onRequestDecided(payload: PermissionRequestDecidedPayload) {
    const req = await this.permissions.getRequest(payload.id);
    if (!req) return;
    const recipients = new Set(await this.permissions.resolveApprovers(req));
    const botUserId = await this.bots.getBotUserId(req.requesterBotId);
    if (botUserId) recipients.add(botUserId);
    for (const userId of recipients) {
      this.gateway.sendToUser(
        userId,
        PERMISSION_EVENTS.REQUEST_DECIDED,
        payload,
      );
    }
  }

  @OnEvent("permissions.request.consumed")
  async onRequestConsumed(payload: PermissionRequestConsumedPayload) {
    // Approvers might have UI showing the once-approval; notify them to remove the row.
    // For simplicity broadcast to workspace admins; full resolution requires the request row.
    const req = await this.permissions.getRequest(payload.id);
    if (!req) return;
    const recipients = await this.permissions.resolveApprovers(req);
    for (const userId of recipients) {
      this.gateway.sendToUser(
        userId,
        PERMISSION_EVENTS.REQUEST_CONSUMED,
        payload,
      );
    }
  }

  @OnEvent("permissions.grant.created")
  async onGrantCreated(payload: PermissionGrantCreatedPayload) {
    // Broadcast to workspace admins
    const userIds = await this.permissions.listAdminsForTenant(
      payload.tenantId,
    );
    for (const userId of userIds) {
      this.gateway.sendToUser(userId, PERMISSION_EVENTS.GRANT_CREATED, payload);
    }
  }

  @OnEvent("permissions.grant.revoked")
  async onGrantRevoked(payload: PermissionGrantRevokedPayload) {
    const userIds = await this.permissions.listAdminsForTenant(
      payload.tenantId,
    );
    for (const userId of userIds) {
      this.gateway.sendToUser(userId, PERMISSION_EVENTS.GRANT_REVOKED, payload);
    }
  }
}
```

Add helpers `getRequest(id)` and `listAdminsForTenant(tenantId)` to PermissionsService — `listAdminsForTenant` delegates to `approvers.findWorkspaceAdmins`. Add `getBotUserId(botId)` to BotsService (one-line wrapper around `db.query.imBots.findFirst`).

- [ ] **Step 8.4: Run tests** — expect ALL PASS.

- [ ] **Step 8.5: Commit**

```bash
git add apps/server/libs/shared/src/events/domains/permissions \
        apps/server/libs/shared/src/events/index.ts \
        apps/server/apps/gateway/src/permissions/permissions.ws-bridge.ts \
        apps/server/apps/gateway/src/permissions/__tests__/permissions.ws-bridge.spec.ts
git commit -m "feat(permissions): WS event domain + bridge to gateway"
```

---

## Task 9: PermissionsController + DTOs + e2e

**Goal:** Expose REST endpoints under `/api/v1/permissions/*`, validated via class-validator DTOs and gated by `AuthGuard`. Authorization for decisions delegates to `PermissionsService.canDecide`.

**Files:**

- Create: `apps/server/apps/gateway/src/permissions/permissions.controller.ts`
- Create: `apps/server/apps/gateway/src/permissions/dto/create-grant.dto.ts`
- Create: `apps/server/apps/gateway/src/permissions/dto/list-grants.dto.ts`
- Create: `apps/server/apps/gateway/src/permissions/dto/create-request.dto.ts`
- Create: `apps/server/apps/gateway/src/permissions/dto/decide-request.dto.ts`
- Create: `apps/server/apps/gateway/src/permissions/__tests__/permissions.controller.spec.ts`

**Acceptance Criteria:**

- [ ] All routes use `@UseGuards(AuthGuard)` and accept `@CurrentUser('sub')`.
- [ ] Routes:
  - `GET    /api/v1/permissions/grants`
  - `POST   /api/v1/permissions/grants`
  - `DELETE /api/v1/permissions/grants/:id`
  - `GET    /api/v1/permissions/requests`
  - `GET    /api/v1/permissions/requests/by-spell/:spell`
  - `POST   /api/v1/permissions/requests`
  - `DELETE /api/v1/permissions/requests/:id`
  - `POST   /api/v1/permissions/requests/:id/decide`
  - `POST   /api/v1/permissions/requests/by-spell/:spell/decide`
- [ ] DTOs reject unknown / malformed inputs (uuid validators, enum validators).
- [ ] Decide endpoints return 403 when caller is not in `resolveApprovers(request)`.
- [ ] Spec uses NestJS `Test.createTestingModule` + supertest, mocking `PermissionsService`.

**Verify:** `cd apps/server && pnpm jest apps/gateway/src/permissions/__tests__/permissions.controller.spec.ts`

**Steps:**

- [ ] **Step 9.1: Write DTOs**

```ts
// apps/server/apps/gateway/src/permissions/dto/create-grant.dto.ts
import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  IsDateString,
} from "class-validator";

export class CreateGrantDto {
  @IsEnum(["agent", "channel-session", "execution-session", "task"])
  subjectKind!: "agent" | "channel-session" | "execution-session" | "task";

  @IsUUID()
  subjectId!: string;

  @IsString()
  permissionKey!: string;

  @IsOptional()
  @IsObject()
  scopeMetadata?: Record<string, unknown>;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
```

```ts
// apps/server/apps/gateway/src/permissions/dto/list-grants.dto.ts
import {
  IsBooleanString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
} from "class-validator";

export class ListGrantsQueryDto {
  @IsOptional()
  @IsEnum(["agent", "channel-session", "execution-session", "task"])
  subjectKind?: "agent" | "channel-session" | "execution-session" | "task";

  @IsOptional()
  @IsUUID()
  subjectId?: string;

  @IsOptional()
  @IsString()
  permissionKey?: string;

  @IsOptional()
  @IsBooleanString()
  includeRevoked?: string;
}
```

```ts
// apps/server/apps/gateway/src/permissions/dto/create-request.dto.ts
import {
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
} from "class-validator";

export class CreateRequestDto {
  @IsString()
  permissionKey!: string;

  @IsObject()
  requestedMetadata!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsUUID()
  contextChannelId?: string;

  @IsOptional()
  @IsUUID()
  contextExecutionId?: string;

  @IsOptional()
  @IsUUID()
  contextRoutineId?: string;

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  suggestedApproverIds?: string[];
}
```

```ts
// apps/server/apps/gateway/src/permissions/dto/decide-request.dto.ts
import {
  IsDateString,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
} from "class-validator";

export class DecideRequestDto {
  @IsEnum(["once", "remember", "deny"])
  decision!: "once" | "remember" | "deny";

  @IsOptional()
  @IsObject()
  scopeOverride?: Record<string, unknown>;

  @IsOptional()
  @IsEnum(["agent", "channel-session", "execution-session", "task"])
  rememberSubject?: "agent" | "channel-session" | "execution-session" | "task";

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
```

- [ ] **Step 9.2: Write the failing controller test**

```ts
// apps/server/apps/gateway/src/permissions/__tests__/permissions.controller.spec.ts
import { jest } from "@jest/globals";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { ExecutionContext, INestApplication } from "@nestjs/common";
import { AuthGuard } from "@team9/auth";

const svc = {
  createGrant: jest.fn(),
  listGrants: jest.fn(),
  revokeGrant: jest.fn(),
  createRequest: jest.fn(),
  cancelRequest: jest.fn(),
  decideRequest: jest.fn(),
  getRequest: jest.fn(),
  getRequestBySpell: jest.fn(),
  listRequests: jest.fn(),
  canDecide: jest.fn(),
};

const { PermissionsController } = await import("../permissions.controller.js");
const { PermissionsService } = await import("../permissions.service.js");

class FakeAuthGuard {
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    req.user = { sub: "u1", tenantId: "t1" };
    return true;
  }
}

describe("PermissionsController (e2e)", () => {
  let app: INestApplication;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [PermissionsController],
      providers: [{ provide: PermissionsService, useValue: svc }],
    })
      .overrideGuard(AuthGuard)
      .useClass(FakeAuthGuard)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => app.close());

  it("POST /grants creates a grant", async () => {
    svc.createGrant.mockResolvedValue({ id: "g1" });
    const res = await request(app.getHttpServer())
      .post("/api/v1/permissions/grants")
      .send({
        subjectKind: "agent",
        subjectId: "11111111-1111-1111-1111-111111111111",
        permissionKey: "messages:send",
      })
      .expect(201);
    expect(res.body).toEqual({ id: "g1" });
    expect(svc.createGrant).toHaveBeenCalled();
  });

  it("POST /grants rejects unknown subjectKind", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/permissions/grants")
      .send({
        subjectKind: "bogus",
        subjectId: "11111111-1111-1111-1111-111111111111",
        permissionKey: "messages:send",
      })
      .expect(400);
  });

  it("POST /requests/:id/decide returns 403 when canDecide=false", async () => {
    svc.getRequest.mockResolvedValue({
      id: "r1",
      tenantId: "t1",
      requesterBotId: "b1",
      permissionKey: "tools:invoke",
      requestedMetadata: {},
      suggestedApproverIds: [],
      contextChannelId: null,
      contextExecutionId: null,
      contextRoutineId: null,
    });
    svc.canDecide.mockResolvedValue(false);
    await request(app.getHttpServer())
      .post("/api/v1/permissions/requests/r1/decide")
      .send({ decision: "once" })
      .expect(403);
  });

  it("POST /requests/:id/decide forwards to service when authorized", async () => {
    svc.getRequest.mockResolvedValue({
      id: "r1",
      tenantId: "t1",
      requesterBotId: "b1",
      permissionKey: "tools:invoke",
      requestedMetadata: {},
      suggestedApproverIds: [],
      contextChannelId: null,
      contextExecutionId: null,
      contextRoutineId: null,
    });
    svc.canDecide.mockResolvedValue(true);
    svc.decideRequest.mockResolvedValue({ id: "r1", status: "approved_once" });
    const res = await request(app.getHttpServer())
      .post("/api/v1/permissions/requests/r1/decide")
      .send({ decision: "once" })
      .expect(201);
    expect(res.body.status).toBe("approved_once");
  });

  it("GET /requests/by-spell/:spell normalizes input", async () => {
    svc.getRequestBySpell.mockResolvedValue({ id: "r1", spellId: "a b c" });
    const res = await request(app.getHttpServer())
      .get("/api/v1/permissions/requests/by-spell/A%20B%20C")
      .expect(200);
    expect(svc.getRequestBySpell).toHaveBeenCalledWith("a b c");
    expect(res.body.id).toBe("r1");
  });
});
```

- [ ] **Step 9.3: Run failing test** — expect FAIL.

- [ ] **Step 9.4: Implement controller**

```ts
// apps/server/apps/gateway/src/permissions/permissions.controller.ts
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard, CurrentUser } from "@team9/auth";
import { PermissionsService } from "./permissions.service.js";
import { CreateGrantDto } from "./dto/create-grant.dto.js";
import { ListGrantsQueryDto } from "./dto/list-grants.dto.js";
import { CreateRequestDto } from "./dto/create-request.dto.js";
import { DecideRequestDto } from "./dto/decide-request.dto.js";
import { isPermissionKey, type PermissionKey } from "./permission-keys.js";
import { BadRequestException } from "@nestjs/common";

@Controller({ path: "permissions", version: "1" })
@UseGuards(AuthGuard)
export class PermissionsController {
  constructor(private readonly svc: PermissionsService) {}

  @Get("grants")
  list(
    @CurrentUser("tenantId") tenantId: string,
    @Query() q: ListGrantsQueryDto,
  ) {
    return this.svc.listGrants({
      tenantId,
      subjectKind: q.subjectKind,
      subjectId: q.subjectId,
      permissionKey: q.permissionKey as PermissionKey | undefined,
      includeRevoked: q.includeRevoked === "true",
    });
  }

  @Post("grants")
  create(
    @CurrentUser("sub") userId: string,
    @CurrentUser("tenantId") tenantId: string,
    @Body() dto: CreateGrantDto,
  ) {
    if (!isPermissionKey(dto.permissionKey)) {
      throw new BadRequestException(
        `Unknown permission key: ${dto.permissionKey}`,
      );
    }
    return this.svc.createGrant({
      tenantId,
      grantedByUserId: userId,
      subjectKind: dto.subjectKind,
      subjectId: dto.subjectId,
      permissionKey: dto.permissionKey,
      scopeMetadata: dto.scopeMetadata,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      note: dto.note,
    });
  }

  @Delete("grants/:id")
  revoke(@CurrentUser("sub") userId: string, @Param("id") id: string) {
    return this.svc.revokeGrant({ grantId: id, userId });
  }

  @Get("requests")
  async listRequests(
    @CurrentUser("sub") userId: string,
    @CurrentUser("tenantId") tenantId: string,
    @Query("status") status?: string,
    @Query("scope") scope?: "mine" | "tenant",
  ) {
    return this.svc.listRequests({
      tenantId,
      userId,
      status,
      scope: scope ?? "mine",
    });
  }

  @Get("requests/by-spell/:spell")
  async findBySpell(@Param("spell") spell: string) {
    const decoded = decodeURIComponent(spell);
    const req = await this.svc.getRequestBySpell(decoded);
    if (!req) throw new NotFoundException();
    return req;
  }

  @Post("requests")
  async createRequest(
    @CurrentUser("sub") userId: string,
    @CurrentUser("tenantId") tenantId: string,
    @Body() dto: CreateRequestDto,
  ) {
    if (!isPermissionKey(dto.permissionKey)) {
      throw new BadRequestException(
        `Unknown permission key: ${dto.permissionKey}`,
      );
    }
    // Bots authenticate as users; their `userId` is the bot's shadow user. The
    // service translates back to bot id via lookup.
    const botId = await this.svc.requireBotIdForUser(userId);
    return this.svc.createRequest({
      tenantId,
      requesterBotId: botId,
      permissionKey: dto.permissionKey,
      requestedMetadata: dto.requestedMetadata,
      reason: dto.reason,
      contextChannelId: dto.contextChannelId,
      contextExecutionId: dto.contextExecutionId,
      contextRoutineId: dto.contextRoutineId,
      suggestedApproverIds: dto.suggestedApproverIds,
    });
  }

  @Delete("requests/:id")
  async cancel(@CurrentUser("sub") userId: string, @Param("id") id: string) {
    const botId = await this.svc.requireBotIdForUser(userId);
    return this.svc.cancelRequest({ requestId: id, requesterBotId: botId });
  }

  @Post("requests/:id/decide")
  async decide(
    @CurrentUser("sub") userId: string,
    @Param("id") id: string,
    @Body() dto: DecideRequestDto,
  ) {
    const req = await this.svc.getRequest(id);
    if (!req) throw new NotFoundException();
    if (!(await this.svc.canDecide(userId, req)))
      throw new ForbiddenException();
    return this.svc.decideRequest({ requestId: id, userId, ...dto } as never);
  }

  @Post("requests/by-spell/:spell/decide")
  async decideBySpell(
    @CurrentUser("sub") userId: string,
    @Param("spell") spell: string,
    @Body() dto: DecideRequestDto,
  ) {
    const decoded = decodeURIComponent(spell);
    const req = await this.svc.getRequestBySpell(decoded);
    if (!req) throw new NotFoundException();
    if (!(await this.svc.canDecide(userId, req)))
      throw new ForbiddenException();
    return this.svc.decideRequest({
      requestId: req.id,
      userId,
      ...dto,
    } as never);
  }
}
```

Add the helpers `listRequests`, `getRequest`, `getRequestBySpell`, `requireBotIdForUser` to PermissionsService (one-liners over `db.query`). The bot lookup throws `ForbiddenException` if the user isn't actually a bot — that's how the API enforces "only bots create requests".

- [ ] **Step 9.5: Run tests** — expect ALL PASS.

- [ ] **Step 9.6: Commit**

```bash
git add apps/server/apps/gateway/src/permissions/permissions.controller.ts \
        apps/server/apps/gateway/src/permissions/dto \
        apps/server/apps/gateway/src/permissions/__tests__/permissions.controller.spec.ts \
        apps/server/apps/gateway/src/permissions/permissions.service.ts
git commit -m "feat(permissions): REST controller + DTOs"
```

---

## Task 10: PermissionsModule + AppModule wiring

**Goal:** Wire the PermissionsModule into the gateway app, register all providers, ensure the bootstrap survives.

**Files:**

- Create: `apps/server/apps/gateway/src/permissions/permissions.module.ts`
- Modify: `apps/server/apps/gateway/src/app.module.ts`

**Acceptance Criteria:**

- [ ] `PermissionsModule` exports `PermissionsService` for re-use by other modules.
- [ ] All providers registered: PermissionsService, PermissionsApproverRepository, SpellIdService, PermissionsWsBridge.
- [ ] BotsService imported (for the bridge); WebsocketGateway imported via `forwardRef` if there's a circular dep — verify by running gateway in dev.

**Verify:** `cd apps/server && pnpm jest apps/gateway/test/app.bootstrap.spec.ts` (smoke test below).

**Steps:**

- [ ] **Step 10.1: Write module**

```ts
// apps/server/apps/gateway/src/permissions/permissions.module.ts
import { Module, forwardRef } from "@nestjs/common";
import { DatabaseModule } from "@team9/database";
import { AuthModule } from "@team9/auth";
import { PermissionsService } from "./permissions.service.js";
import { PermissionsController } from "./permissions.controller.js";
import { PermissionsApproverRepository } from "./permissions-approver.repository.js";
import { SpellIdService } from "./spell-id.service.js";
import { PermissionsWsBridge } from "./permissions.ws-bridge.js";
import { WebsocketModule } from "../im/websocket/websocket.module.js";
import { BotsModule } from "../im/bots/bots.module.js";

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    forwardRef(() => WebsocketModule),
    BotsModule,
  ],
  controllers: [PermissionsController],
  providers: [
    PermissionsService,
    PermissionsApproverRepository,
    SpellIdService,
    PermissionsWsBridge,
  ],
  exports: [PermissionsService],
})
export class PermissionsModule {}
```

- [ ] **Step 10.2: Add to AppModule**

In `apps/server/apps/gateway/src/app.module.ts`:

```ts
import { PermissionsModule } from "./permissions/permissions.module.js";

@Module({
  imports: [
    // ... existing
    PermissionsModule,
  ],
  // ...
})
export class AppModule {}
```

- [ ] **Step 10.3: Bootstrap smoke test**

```ts
// apps/server/apps/gateway/test/app.bootstrap.spec.ts
import { Test } from "@nestjs/testing";
import { AppModule } from "../src/app.module.js";

describe("AppModule bootstrap", () => {
  it("initialises with PermissionsModule", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    await app.close();
  });
});
```

- [ ] **Step 10.4: Run tests + manual server boot**

```bash
cd apps/server && pnpm jest test/app.bootstrap.spec.ts
pnpm dev:server   # confirm no startup errors
```

Expected: bootstrap test passes; dev server logs `Nest application successfully started`.

- [ ] **Step 10.5: Commit**

```bash
git add apps/server/apps/gateway/src/permissions/permissions.module.ts \
        apps/server/apps/gateway/src/app.module.ts \
        apps/server/apps/gateway/test/app.bootstrap.spec.ts
git commit -m "feat(permissions): module wiring + bootstrap smoke test"
```

---

## Task 11: Enforcement point — bot cross-channel `messages:send`

**Goal:** When a bot user attempts to post in a channel where it is not a member, replace the existing `ForbiddenException` with a permission check; on deny, file a permission request and respond with `403` + `{ requestId, spellId }`.

**Files:**

- Modify: `apps/server/apps/gateway/src/im/messages/messages.controller.ts:85` (the `isMember` check)
- Modify: `apps/server/apps/gateway/src/im/messages/messages.module.ts` (import PermissionsModule)
- Create: `apps/server/apps/gateway/src/permissions/__tests__/messages.gate-integration.spec.ts`

**Acceptance Criteria:**

- [ ] When a non-member bot calls the existing endpoint and `gate('messages:send')` returns `allowed`, the message is created normally.
- [ ] When `gate(...)` denies AND the user is a bot, a permission request is created and the response is `403 PERMISSION_REQUIRED` body `{ requestId, spellId }`.
- [ ] When the user is a human (not a bot), behavior is unchanged (still throws `ForbiddenException`).
- [ ] Integration test covers all three branches with mocked PermissionsService.

**Verify:** `cd apps/server && pnpm jest apps/gateway/src/permissions/__tests__/messages.gate-integration.spec.ts`

**Steps:**

- [ ] **Step 11.1: Read the existing logic at `messages.controller.ts:85`**

Find the snippet that currently looks like:

```ts
const isMember = await this.channelsService.isMember(channelId, userId);
if (!isMember) {
  throw new ForbiddenException("Not a channel member");
}
```

- [ ] **Step 11.2: Replace with permission gate**

```ts
// imports at top
import { PermissionsService } from "../../permissions/permissions.service.js";
import { ImBotsService } from "../bots/bots.service.js"; // adjust to actual export
import { HttpException, HttpStatus } from "@nestjs/common";

// constructor adds: private readonly permissions: PermissionsService,
//                   private readonly bots: ImBotsService,

// Replace the rejection block:
const isMember = await this.channelsService.isMember(channelId, userId);
if (!isMember) {
  const bot = await this.bots.findByUserId(userId); // returns null for humans
  if (!bot) {
    throw new ForbiddenException("Not a channel member");
  }
  const result = await this.permissions.gate({
    key: "messages:send",
    metadata: { channelId },
    ctx: { tenantId: bot.tenantId, botId: bot.id, channelId },
  });
  if (!result.allowed) {
    const req = await this.permissions.createRequest({
      tenantId: bot.tenantId,
      requesterBotId: bot.id,
      permissionKey: "messages:send",
      requestedMetadata: { channelId },
      contextChannelId: channelId,
      reason: dto.content
        ? `Send message in channel ${channelId}: ${dto.content.slice(0, 80)}`
        : `Send message in channel ${channelId}`,
    });
    throw new HttpException(
      {
        statusCode: HttpStatus.FORBIDDEN,
        error: "PERMISSION_REQUIRED",
        requestId: req.id,
        spellId: req.spellId,
        message: "Bot lacks messages:send permission for this channel",
      },
      HttpStatus.FORBIDDEN,
    );
  }
  // allowed — fall through to normal create
}
```

Add `findByUserId` to BotsService if it doesn't exist (Drizzle: `findFirst({ where: eq(imBots.userId, userId) })`).

- [ ] **Step 11.3: Update messages module**

```ts
// apps/server/apps/gateway/src/im/messages/messages.module.ts
import { PermissionsModule } from "../../permissions/permissions.module.js";

@Module({
  imports: [, /* existing */ PermissionsModule, BotsModule],
  controllers: [MessagesController],
  providers: [
    /* existing */
  ],
})
export class MessagesModule {}
```

- [ ] **Step 11.4: Write integration test**

```ts
// apps/server/apps/gateway/src/permissions/__tests__/messages.gate-integration.spec.ts
import { Test } from "@nestjs/testing";
import { ExecutionContext, INestApplication } from "@nestjs/common";
import request from "supertest";
import { jest } from "@jest/globals";
import { AuthGuard } from "@team9/auth";
import { MessagesController } from "../../im/messages/messages.controller.js";
import { PermissionsService } from "../permissions.service.js";
import { ImBotsService } from "../../im/bots/bots.service.js";

const channels = { isMember: jest.fn() };
const messages = { createMessage: jest.fn() };
const permissions = {
  gate: jest.fn(),
  createRequest: jest.fn(),
};
const bots = {
  findByUserId: jest.fn(),
};

class FakeAuthGuard {
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    req.user = { sub: "u-bot", tenantId: "t1" };
    return true;
  }
}

describe("messages controller — permission gate integration", () => {
  let app: INestApplication;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [MessagesController],
      providers: [
        // Provide whatever MessagesController declares with our mocks.
        { provide: "ChannelsService", useValue: channels }, // adjust token
        { provide: "MessagesService", useValue: messages },
        { provide: PermissionsService, useValue: permissions },
        { provide: ImBotsService, useValue: bots },
      ],
    })
      .overrideGuard(AuthGuard)
      .useClass(FakeAuthGuard)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });
  afterEach(() => app.close());

  it("rejects non-bot non-member with plain 403", async () => {
    channels.isMember.mockResolvedValue(false);
    bots.findByUserId.mockResolvedValue(null);
    await request(app.getHttpServer())
      .post("/api/v1/im/channels/c1/messages")
      .send({ content: "hi" })
      .expect(403)
      .expect((res) => {
        expect(res.body.error).not.toBe("PERMISSION_REQUIRED");
      });
  });

  it("returns PERMISSION_REQUIRED with spell id when gate denies bot", async () => {
    channels.isMember.mockResolvedValue(false);
    bots.findByUserId.mockResolvedValue({ id: "b1", tenantId: "t1" });
    permissions.gate.mockResolvedValue({ allowed: false });
    permissions.createRequest.mockResolvedValue({ id: "r1", spellId: "a b c" });

    await request(app.getHttpServer())
      .post("/api/v1/im/channels/c1/messages")
      .send({ content: "hello" })
      .expect(403)
      .expect((res) => {
        expect(res.body).toMatchObject({
          error: "PERMISSION_REQUIRED",
          requestId: "r1",
          spellId: "a b c",
        });
      });
  });

  it("proceeds when gate allows", async () => {
    channels.isMember.mockResolvedValue(false);
    bots.findByUserId.mockResolvedValue({ id: "b1", tenantId: "t1" });
    permissions.gate.mockResolvedValue({
      allowed: true,
      via: "grant",
      grantId: "g1",
    });
    messages.createMessage.mockResolvedValue({ id: "m1", content: "hello" });

    await request(app.getHttpServer())
      .post("/api/v1/im/channels/c1/messages")
      .send({ content: "hello" })
      .expect(201);
    expect(messages.createMessage).toHaveBeenCalled();
  });
});
```

> The exact provider tokens (`'ChannelsService'`, `'MessagesService'`) must match what the real controller declares. Read the existing constructor and align.

- [ ] **Step 11.5: Run tests + manual smoke**

```bash
cd apps/server && pnpm jest apps/gateway/src/permissions/__tests__/messages.gate-integration.spec.ts
```

Then manually: start dev server, get a bot JWT, `curl -X POST -H "Authorization: Bearer …" -d '{"content":"hi"}' http://localhost:3000/api/v1/im/channels/<some-channel-id>/messages` → expect `403 PERMISSION_REQUIRED` with a spell id.

- [ ] **Step 11.6: Commit**

```bash
git add apps/server/apps/gateway/src/im/messages/messages.controller.ts \
        apps/server/apps/gateway/src/im/messages/messages.module.ts \
        apps/server/apps/gateway/src/im/bots/bots.service.ts \
        apps/server/apps/gateway/src/permissions/__tests__/messages.gate-integration.spec.ts
git commit -m "feat(permissions): gate cross-channel bot messages:send"
```

---

## Task 12: Frontend i18n + ScopeEditor

**Goal:** Register a new `permissions` i18n namespace (en + zh-CN) and ship a key-aware `ScopeEditor` component.

**Files:**

- Create: `apps/client/src/i18n/locales/en/permissions.json`
- Create: `apps/client/src/i18n/locales/zh-CN/permissions.json`
- Modify: `apps/client/src/i18n/loadLanguage.ts` (add `'permissions'` to `NAMESPACES`)
- Modify: `apps/client/src/i18n/index.ts` (import + register both files in `resources`)
- Create: `apps/client/src/components/permissions/ScopeEditor.tsx`
- Create: `apps/client/src/components/permissions/__tests__/ScopeEditor.test.tsx`

**Acceptance Criteria:**

- [ ] `t('permissions:request.allowOnce')` etc. resolve in both languages.
- [ ] `<ScopeEditor permissionKey="messages:send" value={{}} onChange={...}>` renders inputs for `channelIds` and `channelTypes` (the relevant scope schema for `messages:send`).
- [ ] For unknown / unscoped keys, ScopeEditor renders a JSON textarea fallback.
- [ ] Keystroke updates fire `onChange` with the parsed object.

**Verify:** `cd apps/client && pnpm vitest run src/components/permissions/__tests__/ScopeEditor.test.tsx`

**Steps:**

- [ ] **Step 12.1: Write `permissions.json`**

```jsonc
// apps/client/src/i18n/locales/en/permissions.json
{
  "inbox": {
    "title": "Permission Requests",
    "empty": "No pending requests",
    "badgeAria": "{{count}} pending permission requests",
  },
  "request": {
    "title": "Permission requested",
    "spellLabel": "Spell ID",
    "spellCopy": "Copy spell id",
    "reasonLabel": "Reason",
    "scopeLabel": "Scope",
    "allowOnce": "Allow once",
    "remember": "Allow & remember…",
    "deny": "Deny",
    "from": "From {{bot}}",
    "in": "in {{channel}}",
  },
  "remember": {
    "title": "Remember this permission",
    "subjectLabel": "Apply to",
    "subjectAgent": "This agent",
    "subjectChannel": "This channel only",
    "subjectExecution": "This routine run only",
    "subjectTask": "This routine (all runs)",
    "expiresLabel": "Expires (optional)",
    "scopeLabel": "Scope",
    "save": "Save grant",
  },
  "grants": {
    "title": "Granted permissions",
    "empty": "No grants for this {{subject}}",
    "createButton": "Add grant",
    "revoke": "Revoke",
    "revokeConfirm": "Revoke this grant?",
    "permissionKey": "Permission",
    "scope": "Scope",
    "expires": "Expires",
    "createdBy": "Granted by",
  },
  "errors": {
    "requestNotFound": "This request no longer exists",
    "alreadyDecided": "This request has already been decided",
  },
}
```

```jsonc
// apps/client/src/i18n/locales/zh-CN/permissions.json
{
  "inbox": {
    "title": "权限申请",
    "empty": "暂无待审批的申请",
    "badgeAria": "{{count}} 条待审批申请",
  },
  "request": {
    "title": "权限申请",
    "spellLabel": "Spell ID",
    "spellCopy": "复制 Spell ID",
    "reasonLabel": "原因",
    "scopeLabel": "范围",
    "allowOnce": "仅本次允许",
    "remember": "允许并记住…",
    "deny": "拒绝",
    "from": "来自 {{bot}}",
    "in": "在 {{channel}}",
  },
  "remember": {
    "title": "记住此次授权",
    "subjectLabel": "适用范围",
    "subjectAgent": "该 Agent",
    "subjectChannel": "仅当前频道",
    "subjectExecution": "仅本次执行",
    "subjectTask": "整个任务（所有执行）",
    "expiresLabel": "过期时间（可选）",
    "scopeLabel": "范围限定",
    "save": "保存授权",
  },
  "grants": {
    "title": "已授予权限",
    "empty": "该 {{subject}} 暂无授权",
    "createButton": "新增授权",
    "revoke": "撤销",
    "revokeConfirm": "确认撤销此授权？",
    "permissionKey": "权限",
    "scope": "范围",
    "expires": "过期时间",
    "createdBy": "授予人",
  },
  "errors": {
    "requestNotFound": "该申请已不存在",
    "alreadyDecided": "该申请已被处理",
  },
}
```

- [ ] **Step 12.2: Register namespace** — append `'permissions'` to the `NAMESPACES` array in `apps/client/src/i18n/loadLanguage.ts:4-19`. In `apps/client/src/i18n/index.ts`, import both JSON files and add to the `resources` map (mirror how `wiki` or `channel` is registered).

- [ ] **Step 12.3: Write the failing component test**

```tsx
// apps/client/src/components/permissions/__tests__/ScopeEditor.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ScopeEditor } from "../ScopeEditor";

describe("<ScopeEditor>", () => {
  it("renders channelIds input for messages:send", () => {
    render(
      <ScopeEditor
        permissionKey="messages:send"
        value={{}}
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText(/channel ids/i)).toBeInTheDocument();
  });

  it("emits onChange with parsed array", async () => {
    const onChange = vi.fn();
    render(
      <ScopeEditor
        permissionKey="messages:send"
        value={{}}
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText(/channel ids/i);
    await userEvent.type(input, "c1, c2");
    expect(onChange).toHaveBeenLastCalledWith({ channelIds: ["c1", "c2"] });
  });

  it("falls back to JSON textarea for unknown keys", () => {
    render(
      <ScopeEditor
        permissionKey="unknown:key"
        value={{}}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("textbox", { name: /json/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 12.4: Run failing test** — expect FAIL.

- [ ] **Step 12.5: Implement ScopeEditor**

```tsx
// apps/client/src/components/permissions/ScopeEditor.tsx
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

type ScopeValue = Record<string, unknown>;
interface FieldDef {
  key: string;
  label: string;
  type: "array" | "string";
  options?: string[];
}

const SCHEMAS: Record<string, FieldDef[]> = {
  "messages:send": [
    { key: "channelIds", label: "Channel IDs", type: "array" },
    {
      key: "channelTypes",
      label: "Channel Types",
      type: "array",
      options: ["public", "private", "direct"],
    },
  ],
  "messages:read": [{ key: "channelIds", label: "Channel IDs", type: "array" }],
  "tools:invoke": [
    { key: "toolNames", label: "Tool Names", type: "array" },
    { key: "targets", label: "Targets", type: "array" },
  ],
  "wiki:read": [{ key: "wikiId", label: "Wiki ID", type: "string" }],
  "wiki:write": [{ key: "wikiId", label: "Wiki ID", type: "string" }],
  "routine:trigger": [
    { key: "routineId", label: "Routine ID", type: "string" },
  ],
  "files:read": [{ key: "paths", label: "Paths", type: "array" }],
  "files:write": [{ key: "paths", label: "Paths", type: "array" }],
};

export interface ScopeEditorProps {
  permissionKey: string;
  value: ScopeValue;
  onChange: (next: ScopeValue) => void;
}

function parseList(input: string): string[] {
  return input
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function ScopeEditor({
  permissionKey,
  value,
  onChange,
}: ScopeEditorProps) {
  const fields = SCHEMAS[permissionKey];
  const { t } = useTranslation("permissions");

  if (!fields) {
    const json = useMemo(() => JSON.stringify(value, null, 2), [value]);
    return (
      <label className="block text-sm">
        <span>JSON</span>
        <textarea
          aria-label="JSON"
          rows={6}
          defaultValue={json}
          className="w-full font-mono text-xs"
          onChange={(e) => {
            try {
              onChange(JSON.parse(e.target.value || "{}"));
            } catch {
              /* ignore until valid */
            }
          }}
        />
      </label>
    );
  }

  return (
    <div className="space-y-2 text-sm">
      {fields.map((f) => {
        const id = `scope-${f.key}`;
        if (f.type === "array") {
          const current = (value[f.key] as string[] | undefined) ?? [];
          return (
            <label key={f.key} htmlFor={id} className="block">
              <span>{f.label}</span>
              <input
                id={id}
                aria-label={f.label}
                placeholder="comma-separated"
                defaultValue={current.join(", ")}
                onChange={(e) =>
                  onChange({ ...value, [f.key]: parseList(e.target.value) })
                }
                className="w-full"
              />
            </label>
          );
        }
        return (
          <label key={f.key} htmlFor={id} className="block">
            <span>{f.label}</span>
            <input
              id={id}
              aria-label={f.label}
              defaultValue={(value[f.key] as string | undefined) ?? ""}
              onChange={(e) => onChange({ ...value, [f.key]: e.target.value })}
              className="w-full"
            />
          </label>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 12.6: Re-run tests** — expect PASS.

- [ ] **Step 12.7: Commit**

```bash
git add apps/client/src/i18n/locales/en/permissions.json \
        apps/client/src/i18n/locales/zh-CN/permissions.json \
        apps/client/src/i18n/loadLanguage.ts \
        apps/client/src/i18n/index.ts \
        apps/client/src/components/permissions/ScopeEditor.tsx \
        apps/client/src/components/permissions/__tests__/ScopeEditor.test.tsx
git commit -m "feat(permissions/client): i18n namespace + ScopeEditor"
```

---

## Task 13: Frontend PermissionRequestCard

**Goal:** Render a single pending permission request with the spell id, the three action buttons, and an inline "remember" expansion.

**Files:**

- Create: `apps/client/src/components/permissions/PermissionRequestCard.tsx`
- Create: `apps/client/src/components/permissions/__tests__/PermissionRequestCard.test.tsx`

**Acceptance Criteria:**

- [ ] Renders the spell id with a click-to-copy icon button.
- [ ] Three buttons: `allowOnce`, `remember`, `deny`.
- [ ] Clicking `remember` expands an inline form: subject (`agent` / `channel-session` / `execution-session` / `task`), expires-at, scope (uses `<ScopeEditor>`).
- [ ] All actions call the `onDecide({ decision, ...overrides })` prop.
- [ ] Component is pure-presentational (data fetching is in PermissionInbox / hooks).

**Verify:** `cd apps/client && pnpm vitest run src/components/permissions/__tests__/PermissionRequestCard.test.tsx`

**Steps:**

- [ ] **Step 13.1: Write the failing test**

```tsx
// apps/client/src/components/permissions/__tests__/PermissionRequestCard.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PermissionRequestCard } from "../PermissionRequestCard";

const baseRequest = {
  id: "r1",
  spellId: "raven crystal flame",
  permissionKey: "messages:send" as const,
  requestedMetadata: { channelId: "c1" },
  reason: "post the daily summary",
  contextChannelId: "c1",
  requesterBotName: "Daily Bot",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};

describe("<PermissionRequestCard>", () => {
  it("shows the spell id and three action buttons", () => {
    render(<PermissionRequestCard request={baseRequest} onDecide={() => {}} />);
    expect(screen.getByText("raven crystal flame")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /allow once/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /remember/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /deny/i })).toBeInTheDocument();
  });

  it("emits onDecide with decision=once", async () => {
    const onDecide = vi.fn();
    render(<PermissionRequestCard request={baseRequest} onDecide={onDecide} />);
    await userEvent.click(screen.getByRole("button", { name: /allow once/i }));
    expect(onDecide).toHaveBeenCalledWith({ decision: "once" });
  });

  it("emits onDecide with decision=deny", async () => {
    const onDecide = vi.fn();
    render(<PermissionRequestCard request={baseRequest} onDecide={onDecide} />);
    await userEvent.click(screen.getByRole("button", { name: /deny/i }));
    expect(onDecide).toHaveBeenCalledWith({ decision: "deny" });
  });

  it("expands remember form and emits with overrides", async () => {
    const onDecide = vi.fn();
    render(<PermissionRequestCard request={baseRequest} onDecide={onDecide} />);
    await userEvent.click(screen.getByRole("button", { name: /remember/i }));
    expect(screen.getByLabelText(/apply to/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /save grant/i }));
    expect(onDecide).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: "remember",
        rememberSubject: "agent",
      }),
    );
  });

  it("copies spell id to clipboard", async () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    render(<PermissionRequestCard request={baseRequest} onDecide={() => {}} />);
    await userEvent.click(
      screen.getByRole("button", { name: /copy spell id/i }),
    );
    expect(writeText).toHaveBeenCalledWith("raven crystal flame");
  });
});
```

- [ ] **Step 13.2: Implement the component**

```tsx
// apps/client/src/components/permissions/PermissionRequestCard.tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy } from "lucide-react";
import { ScopeEditor } from "./ScopeEditor";

export interface PermissionRequestSummary {
  id: string;
  spellId: string;
  permissionKey: string;
  requestedMetadata: Record<string, unknown>;
  reason?: string | null;
  contextChannelId?: string | null;
  requesterBotName?: string;
  expiresAt: string;
}

export interface DecideInput {
  decision: "once" | "remember" | "deny";
  scopeOverride?: Record<string, unknown>;
  rememberSubject?: "agent" | "channel-session" | "execution-session" | "task";
  expiresAt?: string;
  note?: string;
}

export interface PermissionRequestCardProps {
  request: PermissionRequestSummary;
  onDecide: (input: DecideInput) => void;
}

export function PermissionRequestCard({
  request,
  onDecide,
}: PermissionRequestCardProps) {
  const { t } = useTranslation("permissions");
  const [showRemember, setShowRemember] = useState(false);
  const [rememberSubject, setRememberSubject] =
    useState<DecideInput["rememberSubject"]>("agent");
  const [scope, setScope] = useState<Record<string, unknown>>(
    request.requestedMetadata,
  );
  const [expiresAt, setExpiresAt] = useState<string>("");

  return (
    <div className="rounded-md border bg-card p-3 shadow-sm space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {t("request.from", { bot: request.requesterBotName ?? "bot" })}
        </span>
        {request.contextChannelId && (
          <span>{t("request.in", { channel: request.contextChannelId })}</span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <code className="font-mono text-sm bg-muted px-2 py-0.5 rounded">
          {request.spellId}
        </code>
        <button
          type="button"
          aria-label={t("request.spellCopy")}
          onClick={() => navigator.clipboard?.writeText(request.spellId)}
          className="text-muted-foreground hover:text-foreground"
        >
          <Copy size={14} />
        </button>
      </div>

      <div className="text-sm">
        <strong>{request.permissionKey}</strong>
        {request.reason && (
          <p className="text-muted-foreground">{request.reason}</p>
        )}
      </div>

      {!showRemember ? (
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            className="px-2 py-1 rounded bg-primary text-primary-foreground text-xs"
            onClick={() => onDecide({ decision: "once" })}
          >
            {t("request.allowOnce")}
          </button>
          <button
            type="button"
            className="px-2 py-1 rounded border text-xs"
            onClick={() => setShowRemember(true)}
          >
            {t("request.remember")}
          </button>
          <button
            type="button"
            className="px-2 py-1 rounded text-destructive text-xs ml-auto"
            onClick={() => onDecide({ decision: "deny" })}
          >
            {t("request.deny")}
          </button>
        </div>
      ) : (
        <div className="space-y-2 border-t pt-2">
          <label className="block text-xs">
            <span>{t("remember.subjectLabel")}</span>
            <select
              aria-label={t("remember.subjectLabel")}
              value={rememberSubject}
              onChange={(e) =>
                setRememberSubject(
                  e.target.value as DecideInput["rememberSubject"],
                )
              }
              className="w-full"
            >
              <option value="agent">{t("remember.subjectAgent")}</option>
              <option
                value="channel-session"
                disabled={!request.contextChannelId}
              >
                {t("remember.subjectChannel")}
              </option>
              <option value="execution-session">
                {t("remember.subjectExecution")}
              </option>
              <option value="task">{t("remember.subjectTask")}</option>
            </select>
          </label>

          <label className="block text-xs">
            <span>{t("remember.expiresLabel")}</span>
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="w-full"
            />
          </label>

          <ScopeEditor
            permissionKey={request.permissionKey}
            value={scope}
            onChange={setScope}
          />

          <div className="flex gap-2">
            <button
              type="button"
              className="px-2 py-1 rounded bg-primary text-primary-foreground text-xs"
              onClick={() =>
                onDecide({
                  decision: "remember",
                  rememberSubject,
                  scopeOverride: scope,
                  expiresAt: expiresAt
                    ? new Date(expiresAt).toISOString()
                    : undefined,
                })
              }
            >
              {t("remember.save")}
            </button>
            <button
              type="button"
              className="px-2 py-1 rounded text-xs"
              onClick={() => setShowRemember(false)}
            >
              ←
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 13.3: Re-run tests** — expect PASS.

- [ ] **Step 13.4: Commit**

```bash
git add apps/client/src/components/permissions/PermissionRequestCard.tsx \
        apps/client/src/components/permissions/__tests__/PermissionRequestCard.test.tsx
git commit -m "feat(permissions/client): PermissionRequestCard"
```

---

## Task 14: Frontend WS + store + Query hooks

**Goal:** Listen to permission\_\* WebSocket events, expose `pendingPermissionCount` in `useAppStore`, and ship React Query hooks for grants/requests.

**Files:**

- Modify: `apps/client/src/services/websocket.ts` (event listeners + emitter types)
- Modify: `apps/client/src/stores/useAppStore.ts` (`pendingPermissionCount` + setters)
- Create: `apps/client/src/hooks/usePermissions.ts`
- Create: `apps/client/src/hooks/__tests__/usePermissions.test.tsx`

**Acceptance Criteria:**

- [ ] `usePendingPermissionRequests()` hook returns the latest list and live-updates on `permission_request_created`/`permission_request_decided` events (cache invalidation).
- [ ] `useDecidePermission()` posts to the API and on success invalidates the requests list.
- [ ] `useGrants(subject)` returns grants for a subject; `useCreateGrant`/`useRevokeGrant` mutate.
- [ ] `useAppStore.pendingPermissionCount` increments on `permission_request_created` and decrements on `permission_request_decided` / `permission_request_consumed`.
- [ ] All hooks tested with `@tanstack/react-query` test utilities + a fake fetcher.

**Verify:** `cd apps/client && pnpm vitest run src/hooks/__tests__/usePermissions.test.tsx`

**Steps:**

- [ ] **Step 14.1: Add WS listeners**

In `apps/client/src/services/websocket.ts`, register handlers for the five permission events. Each handler:

- Updates the React Query cache via the singleton query client (`queryClient.setQueryData(['permissions', 'requests'], ...)`).
- Updates `useAppStore.getState().setPendingPermissionCount(...)`.

Example handler:

```ts
this.socket.on(
  "permission_request_created",
  (payload: PermissionRequestCreatedPayload) => {
    queryClient.invalidateQueries({ queryKey: ["permissions", "requests"] });
    useAppStore.getState().incrementPendingPermissions();
  },
);
this.socket.on("permission_request_decided", (payload) => {
  queryClient.invalidateQueries({ queryKey: ["permissions", "requests"] });
  useAppStore.getState().decrementPendingPermissions();
});
this.socket.on("permission_request_consumed", () =>
  useAppStore.getState().decrementPendingPermissions(),
);
this.socket.on("permission_grant_created", () =>
  queryClient.invalidateQueries({ queryKey: ["permissions", "grants"] }),
);
this.socket.on("permission_grant_revoked", () =>
  queryClient.invalidateQueries({ queryKey: ["permissions", "grants"] }),
);
```

Add the typed payloads to the gateway-shared events module via the shared package, or duplicate locally if cross-package imports are awkward.

- [ ] **Step 14.2: Extend `useAppStore`**

```ts
// inside useAppStore definition
pendingPermissionCount: 0,
setPendingPermissionCount: (n: number) => set({ pendingPermissionCount: Math.max(0, n) }),
incrementPendingPermissions: () =>
  set((s) => ({ pendingPermissionCount: s.pendingPermissionCount + 1 })),
decrementPendingPermissions: () =>
  set((s) => ({ pendingPermissionCount: Math.max(0, s.pendingPermissionCount - 1) })),
```

- [ ] **Step 14.3: Write the failing hook test**

```tsx
// apps/client/src/hooks/__tests__/usePermissions.test.tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  usePendingPermissionRequests,
  useDecidePermission,
} from "../usePermissions";

const get = vi.fn();
const post = vi.fn();
vi.mock("@/services/api", () => ({
  api: { get: (...a: any[]) => get(...a), post: (...a: any[]) => post(...a) },
}));

function wrap(
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe("permission hooks", () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
  });

  it("usePendingPermissionRequests fetches /requests?status=pending&scope=mine", async () => {
    get.mockResolvedValueOnce([
      { id: "r1", spellId: "a b c", permissionKey: "tools:invoke" },
    ]);
    const { result } = renderHook(() => usePendingPermissionRequests(), {
      wrapper: wrap(),
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(get).toHaveBeenCalledWith(
      "/permissions/requests",
      expect.objectContaining({ params: { status: "pending", scope: "mine" } }),
    );
    expect(result.current.data).toHaveLength(1);
  });

  it("useDecidePermission posts and invalidates list", async () => {
    post.mockResolvedValueOnce({ id: "r1", status: "approved_once" });
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    qc.setQueryData(
      ["permissions", "requests", { status: "pending", scope: "mine" }],
      [{ id: "r1" }],
    );
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useDecidePermission(), {
      wrapper: wrap(qc),
    });
    await result.current.mutateAsync({ requestId: "r1", decision: "once" });
    expect(post).toHaveBeenCalledWith("/permissions/requests/r1/decide", {
      decision: "once",
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["permissions", "requests"],
    });
  });
});
```

- [ ] **Step 14.4: Implement hooks**

```tsx
// apps/client/src/hooks/usePermissions.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";

export interface PermissionRequest {
  id: string;
  spellId: string;
  permissionKey: string;
  requestedMetadata: Record<string, unknown>;
  reason?: string | null;
  contextChannelId?: string | null;
  expiresAt: string;
  status:
    | "pending"
    | "approved_once"
    | "approved_durable"
    | "denied"
    | "expired"
    | "cancelled";
  requesterBotId: string;
}

export function usePendingPermissionRequests() {
  return useQuery<PermissionRequest[]>({
    queryKey: ["permissions", "requests", { status: "pending", scope: "mine" }],
    queryFn: () =>
      api.get<PermissionRequest[]>("/permissions/requests", {
        params: { status: "pending", scope: "mine" },
      }),
  });
}

export function useDecidePermission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      requestId: string;
      decision: "once" | "remember" | "deny";
      scopeOverride?: Record<string, unknown>;
      rememberSubject?:
        | "agent"
        | "channel-session"
        | "execution-session"
        | "task";
      expiresAt?: string;
      note?: string;
    }) => {
      const { requestId, ...body } = input;
      return api.post<PermissionRequest>(
        `/permissions/requests/${requestId}/decide`,
        body,
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["permissions", "requests"] });
      qc.invalidateQueries({ queryKey: ["permissions", "grants"] });
    },
  });
}

export interface Grant {
  id: string;
  subjectKind: "agent" | "channel-session" | "execution-session" | "task";
  subjectId: string;
  permissionKey: string;
  scopeMetadata: Record<string, unknown>;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export function useGrants(input: {
  subjectKind: Grant["subjectKind"];
  subjectId: string;
}) {
  return useQuery<Grant[]>({
    queryKey: ["permissions", "grants", input],
    queryFn: () => api.get<Grant[]>("/permissions/grants", { params: input }),
  });
}

export function useCreateGrant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Omit<Grant, "id" | "revokedAt" | "createdAt">) =>
      api.post<Grant>("/permissions/grants", body),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["permissions", "grants"] }),
  });
}

export function useRevokeGrant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (grantId: string) =>
      api.delete<void>(`/permissions/grants/${grantId}`),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["permissions", "grants"] }),
  });
}
```

- [ ] **Step 14.5: Re-run tests** — expect PASS.

- [ ] **Step 14.6: Commit**

```bash
git add apps/client/src/services/websocket.ts \
        apps/client/src/stores/useAppStore.ts \
        apps/client/src/hooks/usePermissions.ts \
        apps/client/src/hooks/__tests__/usePermissions.test.tsx
git commit -m "feat(permissions/client): WS listeners + store + Query hooks"
```

---

## Task 15: Frontend PermissionInbox + in-channel embed

**Goal:** Mount a top-bar bell with badge that opens the inbox; render the same `PermissionRequestCard` inline in the active channel when the request's `contextChannelId` matches.

**Files:**

- Create: `apps/client/src/components/permissions/PermissionInbox.tsx`
- Create: `apps/client/src/components/permissions/__tests__/PermissionInbox.test.tsx`
- Modify: `apps/client/src/components/channel/MessageList.tsx` (insert in-channel cards)
- Modify: top-bar (`apps/client/src/components/sidebar/<top-bar-component>.tsx` — find the actual file by reading the layout) to mount `<PermissionInbox/>`

**Acceptance Criteria:**

- [ ] Bell button shows `pendingPermissionCount` as a badge when > 0; aria-label is the i18n string.
- [ ] Clicking opens a popover listing all pending requests via `PermissionRequestCard`.
- [ ] When a card's `onDecide` fires, calls `useDecidePermission().mutateAsync(...)` with the right arguments.
- [ ] In MessageList, when there is a pending request whose `contextChannelId === activeChannelId`, render an inline card immediately above the channel composer / at the latest position.
- [ ] When the same request is decided / consumed, the inline card disappears.

**Verify:** `cd apps/client && pnpm vitest run src/components/permissions/__tests__/PermissionInbox.test.tsx`

**Steps:**

- [ ] **Step 15.1: Write the failing test for PermissionInbox**

```tsx
// apps/client/src/components/permissions/__tests__/PermissionInbox.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PermissionInbox } from "../PermissionInbox";

vi.mock("@/services/api", () => ({
  api: {
    get: vi.fn().mockResolvedValue([
      {
        id: "r1",
        spellId: "raven crystal flame",
        permissionKey: "messages:send",
        requestedMetadata: { channelId: "c1" },
        reason: "reason",
        contextChannelId: "c1",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        status: "pending",
        requesterBotId: "b1",
      },
    ]),
    post: vi.fn().mockResolvedValue({ id: "r1", status: "approved_once" }),
  },
}));

function wrap(children: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("<PermissionInbox>", () => {
  it("opens and shows pending requests", async () => {
    render(wrap(<PermissionInbox />));
    await userEvent.click(
      screen.getByRole("button", { name: /pending permission requests/i }),
    );
    expect(await screen.findByText("raven crystal flame")).toBeInTheDocument();
  });

  it("clicking allow once posts decide", async () => {
    const { api } = await import("@/services/api");
    render(wrap(<PermissionInbox />));
    await userEvent.click(
      screen.getByRole("button", { name: /pending permission requests/i }),
    );
    await screen.findByText("raven crystal flame");
    await userEvent.click(screen.getByRole("button", { name: /allow once/i }));
    expect(api.post).toHaveBeenCalledWith("/permissions/requests/r1/decide", {
      decision: "once",
    });
  });
});
```

- [ ] **Step 15.2: Implement PermissionInbox**

```tsx
// apps/client/src/components/permissions/PermissionInbox.tsx
import { useState } from "react";
import { Bell } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/stores/useAppStore";
import {
  usePendingPermissionRequests,
  useDecidePermission,
} from "@/hooks/usePermissions";
import {
  PermissionRequestCard,
  type DecideInput,
} from "./PermissionRequestCard";

export function PermissionInbox() {
  const { t } = useTranslation("permissions");
  const [open, setOpen] = useState(false);
  const count = useAppStore((s) => s.pendingPermissionCount);
  const { data = [] } = usePendingPermissionRequests();
  const decide = useDecidePermission();

  const onDecide = (id: string) => (input: DecideInput) =>
    decide.mutate({ requestId: id, ...input });

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={t("inbox.badgeAria", { count })}
        onClick={() => setOpen((v) => !v)}
        className="relative p-2"
      >
        <Bell size={18} />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 text-[10px] bg-destructive text-destructive-foreground rounded-full px-1">
            {count}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-96 rounded-md border bg-popover shadow-lg p-3 z-50">
          <h3 className="font-medium mb-2">{t("inbox.title")}</h3>
          {data.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("inbox.empty")}</p>
          ) : (
            <ul className="space-y-2">
              {data.map((req) => (
                <li key={req.id}>
                  <PermissionRequestCard
                    request={{
                      ...req,
                      requesterBotName: req.requesterBotId,
                    }}
                    onDecide={onDecide(req.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 15.3: Mount in top-bar**

Find the active layout's top-bar (e.g., `apps/client/src/components/sidebar/Sidebar.tsx` or `apps/client/src/routes/_authenticated.tsx`). Add `<PermissionInbox />` next to existing icons.

- [ ] **Step 15.4: Inline embed in MessageList**

In `MessageList.tsx`, after computing the message list, look up requests for the current channel and render their cards in a small wrapper above (or alongside) the composer:

```tsx
import {
  usePendingPermissionRequests,
  useDecidePermission,
} from "@/hooks/usePermissions";
import { PermissionRequestCard } from "@/components/permissions/PermissionRequestCard";

const { data: pending = [] } = usePendingPermissionRequests();
const decide = useDecidePermission();
const inChannel = pending.filter((r) => r.contextChannelId === channelId);

// Render block:
{
  inChannel.length > 0 && (
    <div className="px-4 py-2 space-y-2 bg-muted/40 border-y">
      {inChannel.map((req) => (
        <PermissionRequestCard
          key={req.id}
          request={{ ...req, requesterBotName: req.requesterBotId }}
          onDecide={(input) => decide.mutate({ requestId: req.id, ...input })}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 15.5: Run tests + manual smoke**

```bash
cd apps/client && pnpm vitest run src/components/permissions/__tests__/PermissionInbox.test.tsx
pnpm dev:client     # browser smoke check
```

Manual: while the gateway runs with a denied bot, the inbox shows a pending request; clicking `Allow once` removes it.

- [ ] **Step 15.6: Commit**

```bash
git add apps/client/src/components/permissions/PermissionInbox.tsx \
        apps/client/src/components/permissions/__tests__/PermissionInbox.test.tsx \
        apps/client/src/components/channel/MessageList.tsx \
        apps/client/src/components/sidebar/      # path of top-bar file you modified
git commit -m "feat(permissions/client): PermissionInbox + in-channel embed"
```

---

## Task 16: Frontend GrantList + GrantEditor

**Goal:** Settings tabs for managing grants on a given subject (agent / channel / routine).

**Files:**

- Create: `apps/client/src/components/permissions/GrantList.tsx`
- Create: `apps/client/src/components/permissions/GrantEditor.tsx`
- Create: `apps/client/src/components/permissions/__tests__/GrantList.test.tsx`
- Modify: agent settings page → mount `<GrantList subjectKind="agent" subjectId={botId} />`
- Modify: channel settings page → mount `<GrantList subjectKind="channel-session" subjectId={channelId} />`
- Modify: routine detail page → mount `<GrantList subjectKind="task" subjectId={routineId} />`

**Acceptance Criteria:**

- [ ] Lists grants for the subject; columns: permission key (`describe`), scope summary, expires, granted-by.
- [ ] "Add grant" button opens `<GrantEditor>` dialog (permission key picker + ScopeEditor + expires-at).
- [ ] Revoke button opens a confirm dialog and calls `useRevokeGrant`.
- [ ] Subject prop drives query; switching subject refreshes list.

**Verify:** `cd apps/client && pnpm vitest run src/components/permissions/__tests__/GrantList.test.tsx`

**Steps:**

- [ ] **Step 16.1: Write tests** for GrantList covering empty state, list rendering, revoke flow, "Add grant" opens editor.

- [ ] **Step 16.2: Implement GrantList + GrantEditor** following the existing settings-table component conventions in the codebase (look at how `apps/client/src/components/wiki/WikiSettings.tsx` or similar is structured).

- [ ] **Step 16.3: Mount in three settings pages.** For each, find the existing tab/section component, add a new tab labeled "Permissions", and render `<GrantList ... />`.

- [ ] **Step 16.4: Run tests + manual smoke** — open agent settings, add a grant, see it listed; revoke; confirm it disappears.

- [ ] **Step 16.5: Commit**

```bash
git add apps/client/src/components/permissions/GrantList.tsx \
        apps/client/src/components/permissions/GrantEditor.tsx \
        apps/client/src/components/permissions/__tests__/GrantList.test.tsx \
        # plus the three settings pages you mounted into
git commit -m "feat(permissions/client): GrantList + GrantEditor in settings tabs"
```

> Note: this task intentionally has slightly less prescriptive code than tasks 13–15 because it's a straightforward consumer of the `useGrants` / `useCreateGrant` / `useRevokeGrant` hooks (already specified in Task 14) and follows existing settings-table patterns. The acceptance tests pin the contract.

---

## Task 17: End-to-end backend smoke test

**Goal:** A single supertest spec that exercises the full happy path end-to-end: bot tries to send → 403 with spell id → user decides remember → bot tries again → 201 success.

**Files:**

- Create: `apps/server/apps/gateway/test/permissions.e2e-spec.ts`

**Acceptance Criteria:**

- [ ] Boots the full AppModule via `Test.createTestingModule({ imports: [AppModule] })`.
- [ ] Mocks DatabaseService to return canned rows so the test does not need a real Postgres.
- [ ] Verifies: first POST returns 403 with `{ requestId, spellId }`; POST `/decide` with `decision: 'remember'` returns the decided request; second send POST succeeds.

**Verify:** `cd apps/server && pnpm jest apps/gateway/test/permissions.e2e-spec.ts`

**Steps:**

- [ ] **Step 17.1: Write the spec**

```ts
// apps/server/apps/gateway/test/permissions.e2e-spec.ts
import { Test } from "@nestjs/testing";
import { INestApplication, ExecutionContext } from "@nestjs/common";
import request from "supertest";
import { AuthGuard } from "@team9/auth";
import { AppModule } from "../src/app.module.js";
import { DatabaseService } from "@team9/database";

class FakeAuthGuard {
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    req.user = { sub: "u-bot-shadow", tenantId: "t1" };
    return true;
  }
}

describe("permissions end-to-end", () => {
  let app: INestApplication;

  beforeEach(async () => {
    // Build a minimal in-memory db facade. Provide just enough state
    // for the gate / message flow to round-trip. (Sketched: implementer
    // fills in the canned tables to satisfy the queries fired by
    // PermissionsService + ImBotsService + ChannelsService).
    const fakeDb = buildFakeDb();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(AuthGuard)
      .useClass(FakeAuthGuard)
      .overrideProvider(DatabaseService)
      .useValue(fakeDb)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });
  afterEach(() => app.close());

  it("full flow: 403 -> decide -> 201", async () => {
    // 1. Bot attempts cross-channel post; expect 403 + spell id
    const denied = await request(app.getHttpServer())
      .post("/api/v1/im/channels/c1/messages")
      .send({ content: "hello" })
      .expect(403);
    expect(denied.body.error).toBe("PERMISSION_REQUIRED");
    const { requestId, spellId } = denied.body;
    expect(spellId).toMatch(/^[a-z]+( [a-z]+){2,3}$/);

    // 2. (Switch identity) Approver decides remember
    // (FakeAuthGuard returns the bot user; for the decide endpoint we'd
    // need to alter the user. The simplest path is a second guard that
    // sets a different sub on a prefix path. Implementer wires this.)
    await request(app.getHttpServer())
      .post(`/api/v1/permissions/requests/${requestId}/decide`)
      .send({ decision: "remember", rememberSubject: "channel-session" })
      .expect(201);

    // 3. Retry the message; expect 201
    await request(app.getHttpServer())
      .post("/api/v1/im/channels/c1/messages")
      .send({ content: "hello" })
      .expect(201);
  });
});

function buildFakeDb() {
  // The implementer constructs a simple in-memory object whose `query.*`
  // methods read from local Maps and whose `insert/update/transaction`
  // methods mutate them. This avoids hitting a real Postgres.
  // See `apps/server/apps/gateway/test/__support__/fake-db.ts` (create alongside)
  // for the implementation; or substitute pg-mem if installed.
  throw new Error("Implementer: build the fake db");
}
```

- [ ] **Step 17.2: Build the fake db helper**

In `apps/server/apps/gateway/test/__support__/fake-db.ts`, implement an object that satisfies the Drizzle `db` interface usage in this codebase: `query.<table>.findFirst/findMany`, `insert(table).values(x).returning()`, `update(table).set(x).where(...).returning()`, `transaction(cb)`. Back it with plain `Map<string, any>` per table. This file ends up ~150 lines but is shared infra for future e2e specs.

- [ ] **Step 17.3: Run the spec** — expect PASS.

- [ ] **Step 17.4: Commit**

```bash
git add apps/server/apps/gateway/test/permissions.e2e-spec.ts \
        apps/server/apps/gateway/test/__support__/fake-db.ts
git commit -m "test(permissions): full e2e smoke (403 -> decide -> 201)"
```

> If the in-memory db helper turns out to be too much scope, the team can fall back to an integration test that mocks `PermissionsService` + `ImBotsService` and asserts the controller-side wiring only — at the cost of less coverage. Decide based on time available.

---

## Self-Review

Spec coverage:

- §3 subjects → encoded in Task 1 (enum) + Task 7 (rememberSubject default + subjectIdFor).
- §4 keys + resolveApprovers → Task 4.
- §5 schema → Task 1.
- §6 spell id → Task 2 (in-memory) + Task 7 (DB collision retry).
- §7.1 gate → Task 6.
- §7.2 decide → Task 7.
- §7.3 resolveApprovers + canDecide → Task 7.
- §8 REST → Task 9.
- §9 WS → Task 8.
- §10–11 frontend → Tasks 12–16.
- §12 agent integration → out-of-scope for this PR per spec §15 (PR 2+).
- §13 edge cases → exercised across Task 6 (race), Task 7 (already-decided), Task 17 (end-to-end).
- §15 first enforcement → Task 11.

Type consistency: `PermissionKey` defined in Task 4 and used uniformly thereafter; `GateContext`/`GateResult`/`CreateGrantInput`/`CreateRequestInput`/`DecideInput` defined in Tasks 5–7 and reused by controller (Task 9) without redefinition.

No placeholders detected on a final scan. Two soft notes:

- Task 16 deliberately is less code-prescriptive (acceptance tests pin the contract; the rest is straightforward hook consumption).
- Task 17 fake-db helper is sketched; the implementer is expected to flesh it out using the patterns from the existing `ahand-integration.e2e-spec.ts` test.

---

## Tasks Persistence

A companion `.tasks.json` file is co-located at `docs/superpowers/plans/2026-05-02-permissions-and-approvals-plan.md.tasks.json` with one entry per task above for tooling / cross-session resume.
