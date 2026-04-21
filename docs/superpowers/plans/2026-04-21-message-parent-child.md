# Message Parent-Child Relations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Notion-style `parentMessage` (single) + `relatedMessages` (multi) relationships between messages, backed by a new `im_message_relations` table and surfaced in table hierarchy view + chat bubble chips.

**Architecture:** Extend `message_ref` property type with `config.scope` / `config.cardinality` / `config.relationKind`. A new `message-relations.service` owns edge CRUD, cycle detection (WITH RECURSIVE), and subtree queries. `message-properties.service` routes writes of `relationKind` properties to the relations service. Effective parent = COALESCE(stored relation, thread `parentId`). Frontend adds hierarchy mode to TableView and chip rendering to MessageItem.

**Tech Stack:** NestJS 11, Drizzle ORM (PostgreSQL), Socket.io, React 19, TanStack Query, Tailwind, Jest (backend), Vitest (frontend).

**Spec:** [docs/superpowers/specs/2026-04-21-message-parent-child-design.md](../specs/2026-04-21-message-parent-child-design.md)

---

## Phases and Task Map

- **Phase 1 — DB + shared types** (Tasks 1–2)
- **Phase 2 — Backend relations core** (Tasks 3–5)
- **Phase 3 — Backend integration (properties, endpoints, WS)** (Tasks 6–9)
- **Phase 4 — Frontend foundation** (Tasks 10–11)
- **Phase 5 — Frontend UI** (Tasks 12–18)

Each task is a coherent, independently testable, single-commit unit. Unless noted, tasks within a phase can share the same branch but should be committed individually.

---

## Task 1: DB migration + Drizzle schema for `im_message_relations`

**Goal:** Add the relation-kind enum, the new table with indexes/constraints, and the Drizzle schema exports.

**Files:**

- Create: `apps/server/libs/database/src/schemas/im/message-relations.ts`
- Modify: `apps/server/libs/database/src/schemas/im/index.ts` (export new schema)
- Modify: `apps/server/libs/database/src/schemas/im/relations.ts` (drizzle relations for join)
- Generated: `apps/server/libs/database/migrations/0043_message_relations.sql` (via `pnpm db:generate` — rename from auto-generated name)

**Acceptance Criteria:**

- [ ] Enum `relation_kind_enum` with `parent`, `related`.
- [ ] Table `im_message_relations` with columns per spec §2.1.
- [ ] Unique constraint `(source_message_id, property_definition_id, target_message_id)`.
- [ ] Check constraint `source_message_id <> target_message_id`.
- [ ] FKs cascade-delete on messages / channels / property definitions.
- [ ] Four indexes created.
- [ ] `pnpm -C apps/server db:generate` emits a clean migration file.
- [ ] `pnpm -C apps/server test --filter=@team9/database` passes.

**Verify:** `pnpm -C apps/server db:generate` followed by inspecting the generated SQL matches the schema; run migration in a scratch DB, then `SELECT * FROM im_message_relations LIMIT 0;` succeeds.

**Steps:**

- [ ] **Step 1: Create schema file**

```ts
// apps/server/libs/database/src/schemas/im/message-relations.ts
import {
  pgTable,
  uuid,
  timestamp,
  pgEnum,
  index,
  unique,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { messages } from "./messages.js";
import { channels } from "./channels.js";
import { channelPropertyDefinitions } from "./channel-property-definitions.js";
import { tenants } from "../tenant/tenants.js";
import { users } from "./users.js";

export const relationKindEnum = pgEnum("relation_kind", ["parent", "related"]);

export const messageRelations = pgTable(
  "im_message_relations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id, {
      onDelete: "cascade",
    }),
    channelId: uuid("channel_id")
      .references(() => channels.id, { onDelete: "cascade" })
      .notNull(),
    sourceMessageId: uuid("source_message_id")
      .references(() => messages.id, { onDelete: "cascade" })
      .notNull(),
    targetMessageId: uuid("target_message_id")
      .references(() => messages.id, { onDelete: "cascade" })
      .notNull(),
    propertyDefinitionId: uuid("property_definition_id")
      .references(() => channelPropertyDefinitions.id, { onDelete: "cascade" })
      .notNull(),
    relationKind: relationKindEnum("relation_kind").notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("uq_message_relation_edge").on(
      table.sourceMessageId,
      table.propertyDefinitionId,
      table.targetMessageId,
    ),
    check(
      "chk_message_relation_no_self",
      sql`${table.sourceMessageId} <> ${table.targetMessageId}`,
    ),
    index("idx_mr_source_kind").on(table.sourceMessageId, table.relationKind),
    index("idx_mr_target_kind").on(table.targetMessageId, table.relationKind),
    index("idx_mr_channel_kind").on(table.channelId, table.relationKind),
    index("idx_mr_propdef").on(table.propertyDefinitionId),
  ],
);

export type MessageRelation = typeof messageRelations.$inferSelect;
export type NewMessageRelation = typeof messageRelations.$inferInsert;
```

- [ ] **Step 2: Export from index**

```ts
// apps/server/libs/database/src/schemas/im/index.ts  (add line)
export * from "./message-relations.js";
```

- [ ] **Step 3: Add Drizzle relations**

Append to `apps/server/libs/database/src/schemas/im/relations.ts`:

```ts
import { messageRelations } from "./message-relations.js";

export const messageRelationsRelations = relations(
  messageRelations,
  ({ one }) => ({
    source: one(messages, {
      fields: [messageRelations.sourceMessageId],
      references: [messages.id],
      relationName: "relation_source",
    }),
    target: one(messages, {
      fields: [messageRelations.targetMessageId],
      references: [messages.id],
      relationName: "relation_target",
    }),
    definition: one(channelPropertyDefinitions, {
      fields: [messageRelations.propertyDefinitionId],
      references: [channelPropertyDefinitions.id],
    }),
    channel: one(channels, {
      fields: [messageRelations.channelId],
      references: [channels.id],
    }),
  }),
);
```

- [ ] **Step 4: Generate migration**

```bash
pnpm -C apps/server db:generate
```

Expected: a new SQL file under `apps/server/libs/database/migrations/`. Rename it (both the `.sql` and its entry in `_journal.json`) to `0043_message_relations.sql` / `"tag": "0043_message_relations"` so ordering is explicit.

- [ ] **Step 5: Verify migration SQL**

Open the generated file; confirm it contains:

```
CREATE TYPE "public"."relation_kind" AS ENUM('parent', 'related');
CREATE TABLE IF NOT EXISTS "im_message_relations" ( ... );
ALTER TABLE ... ADD CONSTRAINT "im_message_relations_..._fk" FOREIGN KEY ... ON DELETE cascade;
CREATE UNIQUE INDEX "uq_message_relation_edge" ...;
CREATE INDEX "idx_mr_source_kind" ...;
... (all four indexes)
```

- [ ] **Step 6: Run against a scratch DB**

```bash
DATABASE_URL=postgres://... pnpm -C apps/server db:migrate
psql "$DATABASE_URL" -c "\d im_message_relations"
```

Expected: table exists with all columns + indexes + FKs.

- [ ] **Step 7: Commit**

```bash
git add apps/server/libs/database/src/schemas/im/message-relations.ts \
        apps/server/libs/database/src/schemas/im/index.ts \
        apps/server/libs/database/src/schemas/im/relations.ts \
        apps/server/libs/database/migrations/0043_message_relations.sql \
        apps/server/libs/database/migrations/meta/
git commit -m "feat(db): add im_message_relations table for parent-child message links"
```

---

## Task 2: Extend `MessageRefConfig` + shared types for relation kind

**Goal:** Add typed config schema for `message_ref` properties in the shared types package so both server and client import a single source.

**Files:**

- Modify: `apps/server/libs/shared/src/types/property.types.ts`
- Modify: `apps/server/libs/shared/src/events/domains/property.events.ts` (extend `MessagePropertyChangedEvent`; add new event types)
- Modify: `apps/server/libs/shared/src/events/index.ts` (register new event)
- Modify: `apps/server/libs/shared/src/events/event-names.ts` (add event name constants)
- Test: `apps/server/libs/shared/src/types/property.types.spec.ts` (new; type-only smoke test)

**Acceptance Criteria:**

- [ ] `MessageRefConfig` exported with `scope`, `cardinality`, `relationKind` (optional).
- [ ] `MessagePropertyChangedEvent` carries optional `relationKind` and `explicitlyCleared`.
- [ ] New event types `MessageRelationChangedEvent` and `MessageRelationsPurgedEvent` exported.
- [ ] `WS_EVENTS.PROPERTY.RELATION_CHANGED = 'message_relation_changed'` and `WS_EVENTS.PROPERTY.RELATIONS_PURGED = 'message_relations_purged'` added.
- [ ] Type spec compiles: `pnpm -C apps/server tsc -p libs/shared/tsconfig.json --noEmit`.

**Verify:** `pnpm -C apps/server tsc -p libs/shared --noEmit` shows zero errors.

**Steps:**

- [ ] **Step 1: Add `MessageRefConfig` in property.types.ts**

Append after the existing `SelectOption` interface (~line 42):

```ts
export type MessageRefScope = "same_channel" | "any";
export type MessageRefCardinality = "single" | "multi";
export type RelationKind = "parent" | "related";

export interface MessageRefConfig {
  scope: MessageRefScope;
  cardinality: MessageRefCardinality;
  relationKind?: RelationKind;
}

export const DEFAULT_MESSAGE_REF_CONFIG: MessageRefConfig = {
  scope: "any",
  cardinality: "multi",
};
```

- [ ] **Step 2: Extend WS event payloads**

In `property.events.ts`, edit `MessagePropertyChangedEvent`:

```ts
export interface MessagePropertyChangedEvent {
  channelId: string;
  messageId: string;
  properties: {
    set?: Record<string, unknown>;
    removed?: string[];
  };
  /** When the changed property is a relationKind property, this is set so clients skip jsonValue diffing. */
  relationKind?: "parent" | "related";
  /** True when the user explicitly cleared the property (suppresses thread-parentId fallback). */
  explicitlyCleared?: boolean;
  performedBy: string;
}
```

Append two new interfaces:

```ts
export interface MessageRelationChangedEvent {
  channelId: string;
  sourceMessageId: string;
  propertyDefinitionId: string;
  propertyKey: string;
  relationKind: "parent" | "related";
  action: "added" | "removed" | "replaced";
  addedTargetIds: string[];
  removedTargetIds: string[];
  currentTargetIds: string[];
  performedBy: string;
  timestamp: string;
}

export interface MessageRelationsPurgedEvent {
  channelId: string;
  deletedMessageId: string;
  affectedSourceIds: string[];
}
```

- [ ] **Step 3: Register in events index**

Add to the event map in `apps/server/libs/shared/src/events/index.ts` (near the existing `message_property_changed` line):

```ts
message_relation_changed: MessageRelationChangedEvent;
message_relations_purged: MessageRelationsPurgedEvent;
```

Also re-export the interfaces from that file.

- [ ] **Step 4: Add event name constants**

In `apps/server/libs/shared/src/events/event-names.ts`, in the `PROPERTY` section:

```ts
RELATION_CHANGED: 'message_relation_changed',
RELATIONS_PURGED: 'message_relations_purged',
```

- [ ] **Step 5: Type-only smoke test**

```ts
// apps/server/libs/shared/src/types/property.types.spec.ts
import { describe, it, expect } from "@jest/globals";
import {
  DEFAULT_MESSAGE_REF_CONFIG,
  type MessageRefConfig,
} from "./property.types.js";

describe("MessageRefConfig", () => {
  it("defaults are backward-compatible with legacy message_ref", () => {
    expect(DEFAULT_MESSAGE_REF_CONFIG).toEqual({
      scope: "any",
      cardinality: "multi",
    });
    expect(DEFAULT_MESSAGE_REF_CONFIG.relationKind).toBeUndefined();
  });

  it("accepts a same-channel parent shortcut config", () => {
    const config: MessageRefConfig = {
      scope: "same_channel",
      cardinality: "single",
      relationKind: "parent",
    };
    expect(config.relationKind).toBe("parent");
  });
});
```

- [ ] **Step 6: Run tests + typecheck**

```bash
pnpm -C apps/server tsc -p libs/shared/tsconfig.json --noEmit
pnpm -C apps/server test --filter=@team9/shared
```

Expected: compile clean, test passes.

- [ ] **Step 7: Commit**

```bash
git add apps/server/libs/shared/src/types/property.types.ts \
        apps/server/libs/shared/src/events/domains/property.events.ts \
        apps/server/libs/shared/src/events/index.ts \
        apps/server/libs/shared/src/events/event-names.ts \
        apps/server/libs/shared/src/types/property.types.spec.ts
git commit -m "feat(shared): MessageRefConfig + relation WS event types"
```

---

## Task 3: `message-relations.service` — CRUD + scope + cardinality

**Goal:** Introduce a service that owns relation-edge reads/writes inside the gateway, with full validation of scope, cardinality, self-reference, and target existence/permissions. Cycle detection is deferred to Task 4.

**Files:**

- Create: `apps/server/apps/gateway/src/im/properties/message-relations.service.ts`
- Create: `apps/server/apps/gateway/src/im/properties/message-relations.service.spec.ts`
- Create: `apps/server/apps/gateway/src/im/properties/message-relations.errors.ts` (error code constants + NestJS exception classes)
- Modify: `apps/server/apps/gateway/src/im/properties/properties.module.ts` (provide + export new service)

**Acceptance Criteria:**

- [ ] `setRelationTargets(params)` accepts full target list, computes diff, writes INSERTs + DELETEs in one transaction.
- [ ] Cardinality `single` truncates to the last target in input; additional targets rejected with `RELATION_CARDINALITY_EXCEEDED`.
- [ ] `scope='same_channel'` rejects any target whose `channelId` differs from source's `channelId`.
- [ ] Self-reference rejected with `RELATION_SELF_REFERENCE`.
- [ ] Missing / unreadable target rejected with `RELATION_TARGET_NOT_FOUND`.
- [ ] `getOutgoingTargets(sourceId, definitionId)` returns target ids in insertion order.
- [ ] `getIncomingSources(targetId, relationKind)` returns sources sorted by `createdAt` desc.
- [ ] 100% line coverage on service and error classes.

**Verify:** `pnpm -C apps/server test -- --testPathPattern=message-relations.service.spec.ts` passes with full coverage.

**Steps:**

- [ ] **Step 1: Define error module**

```ts
// apps/server/apps/gateway/src/im/properties/message-relations.errors.ts
import { BadRequestException, NotFoundException } from "@nestjs/common";

export const RELATION_ERROR_CODES = {
  CYCLE_DETECTED: "RELATION_CYCLE_DETECTED",
  DEPTH_EXCEEDED: "RELATION_DEPTH_EXCEEDED",
  SCOPE_VIOLATION: "RELATION_SCOPE_VIOLATION",
  CARDINALITY_EXCEEDED: "RELATION_CARDINALITY_EXCEEDED",
  SELF_REFERENCE: "RELATION_SELF_REFERENCE",
  TARGET_NOT_FOUND: "RELATION_TARGET_NOT_FOUND",
  DEFINITION_CONFLICT: "RELATION_DEFINITION_CONFLICT",
} as const;

export class RelationError extends BadRequestException {
  constructor(
    public readonly code: keyof typeof RELATION_ERROR_CODES,
    message?: string,
  ) {
    super({ code: RELATION_ERROR_CODES[code], message: message ?? code });
  }
}

export class RelationTargetNotFoundError extends NotFoundException {
  constructor(messageId: string) {
    super({
      code: RELATION_ERROR_CODES.TARGET_NOT_FOUND,
      message: `Target ${messageId} not found or not accessible`,
    });
  }
}
```

- [ ] **Step 2: Write the failing spec first (TDD)**

```ts
// apps/server/apps/gateway/src/im/properties/message-relations.service.spec.ts
import { Test } from "@nestjs/testing";
import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { MessageRelationsService } from "./message-relations.service.js";
import { DATABASE_CONNECTION } from "../../database/database.module.js";
import {
  RelationError,
  RELATION_ERROR_CODES,
} from "./message-relations.errors.js";

// Minimal fluent-chain DB mock matching existing message-properties.service.spec style
const createDbMock = () => {
  const state: any = {
    relations: [],
    messages: new Map(),
    definitions: new Map(),
  };
  const chain = (rows: any[] = []) => ({
    where: () => chain(rows),
    values: (v: any) => chain([v]),
    returning: () => Promise.resolve(rows),
    set: () => chain(rows),
    limit: () => chain(rows),
    orderBy: () => chain(rows),
    innerJoin: () => chain(rows),
    leftJoin: () => chain(rows),
    then: (r: any) => Promise.resolve(rows).then(r),
  });
  return {
    state,
    select: jest.fn(() => ({ from: () => chain([]) })),
    insert: jest.fn(() => chain([])),
    delete: jest.fn(() => chain([])),
    transaction: jest.fn((fn: any) =>
      fn(
        /* tx */ {
          select: jest.fn(() => ({ from: () => chain([]) })),
          insert: jest.fn(() => chain([])),
          delete: jest.fn(() => chain([])),
        },
      ),
    ),
  };
};

describe("MessageRelationsService", () => {
  let service: MessageRelationsService;
  let db: ReturnType<typeof createDbMock>;

  beforeEach(async () => {
    db = createDbMock();
    const mod = await Test.createTestingModule({
      providers: [
        MessageRelationsService,
        { provide: DATABASE_CONNECTION, useValue: db },
      ],
    }).compile();
    service = mod.get(MessageRelationsService);
  });

  describe("setRelationTargets", () => {
    it("rejects self-reference", async () => {
      await expect(
        service.setRelationTargets({
          sourceMessageId: "m1",
          targetMessageIds: ["m1"],
          definition: {
            id: "d1",
            channelId: "c1",
            config: {
              scope: "same_channel",
              cardinality: "single",
              relationKind: "parent",
            },
          },
          actorId: "u1",
        }),
      ).rejects.toMatchObject({
        response: { code: RELATION_ERROR_CODES.SELF_REFERENCE },
      });
    });

    it("rejects cross-channel target when scope=same_channel", async () => {
      // arrange: mock select for target to return channelId='c2'
      // ... (fill in)
    });

    it("enforces single cardinality by rejecting multiple targets", async () => {
      /* ... */
    });
    it("writes diff (inserts new, deletes removed) in one transaction", async () => {
      /* ... */
    });
    it("no-op when new targets match existing exactly", async () => {
      /* ... */
    });
    it("respects insertion order when reading back", async () => {
      /* ... */
    });
  });

  describe("getOutgoingTargets", () => {
    it("returns target ids for a single property", async () => {
      /* ... */
    });
  });

  describe("getIncomingSources", () => {
    it("filters by relation kind and excludes deleted source messages", async () => {
      /* ... */
    });
  });
});
```

Fill each `/* ... */` with concrete mock arrangement and assertion.

- [ ] **Step 3: Run — should fail because service not implemented**

```bash
pnpm -C apps/server jest -- --testPathPattern=message-relations.service.spec.ts
```

Expected: module not found / class undefined.

- [ ] **Step 4: Implement service**

```ts
// apps/server/apps/gateway/src/im/properties/message-relations.service.ts
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@team9/database";
import { messageRelations, messages } from "@team9/database";
import type { MessageRefConfig } from "@team9/shared";
import { DATABASE_CONNECTION } from "../../database/database.module.js";
import {
  RelationError,
  RelationTargetNotFoundError,
} from "./message-relations.errors.js";

export interface SetRelationTargetsParams {
  sourceMessageId: string;
  targetMessageIds: string[];
  definition: {
    id: string;
    channelId: string;
    config: MessageRefConfig;
  };
  actorId: string;
}

export interface SetRelationTargetsResult {
  addedTargetIds: string[];
  removedTargetIds: string[];
  currentTargetIds: string[];
}

@Injectable()
export class MessageRelationsService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async setRelationTargets(
    params: SetRelationTargetsParams,
  ): Promise<SetRelationTargetsResult> {
    const { sourceMessageId, targetMessageIds, definition, actorId } = params;
    const { config } = definition;

    // self-reference
    if (targetMessageIds.includes(sourceMessageId)) {
      throw new RelationError("SELF_REFERENCE");
    }

    // cardinality
    if (config.cardinality === "single" && targetMessageIds.length > 1) {
      throw new RelationError("CARDINALITY_EXCEEDED");
    }

    // dedupe
    const desired = Array.from(new Set(targetMessageIds));

    return this.db.transaction(async (tx) => {
      // Load source channel
      const [source] = await tx
        .select({ channelId: messages.channelId, tenantId: messages.tenantId })
        .from(messages)
        .where(eq(messages.id, sourceMessageId))
        .limit(1);
      if (!source) throw new RelationTargetNotFoundError(sourceMessageId);

      // Load targets + scope check
      if (desired.length > 0) {
        const targets = await tx
          .select({ id: messages.id, channelId: messages.channelId })
          .from(messages)
          .where(inArray(messages.id, desired));
        const seen = new Set(targets.map((t) => t.id));
        for (const id of desired) {
          if (!seen.has(id)) throw new RelationTargetNotFoundError(id);
        }
        if (config.scope === "same_channel") {
          for (const t of targets) {
            if (t.channelId !== source.channelId) {
              throw new RelationError("SCOPE_VIOLATION");
            }
          }
        }
      }

      // Load existing edges
      const existing = await tx
        .select({ targetMessageId: messageRelations.targetMessageId })
        .from(messageRelations)
        .where(
          and(
            eq(messageRelations.sourceMessageId, sourceMessageId),
            eq(messageRelations.propertyDefinitionId, definition.id),
          ),
        );
      const existingIds = new Set(existing.map((e) => e.targetMessageId));
      const desiredSet = new Set(desired);

      const toAdd = desired.filter((id) => !existingIds.has(id));
      const toRemove = [...existingIds].filter((id) => !desiredSet.has(id));

      // delete removed
      if (toRemove.length > 0) {
        await tx
          .delete(messageRelations)
          .where(
            and(
              eq(messageRelations.sourceMessageId, sourceMessageId),
              eq(messageRelations.propertyDefinitionId, definition.id),
              inArray(messageRelations.targetMessageId, toRemove),
            ),
          );
      }

      // insert added
      if (toAdd.length > 0) {
        await tx.insert(messageRelations).values(
          toAdd.map((targetId) => ({
            tenantId: source.tenantId,
            channelId: source.channelId,
            sourceMessageId,
            targetMessageId: targetId,
            propertyDefinitionId: definition.id,
            relationKind: config.relationKind!, // caller has ensured relationKind is set
            createdBy: actorId,
          })),
        );
      }

      return {
        addedTargetIds: toAdd,
        removedTargetIds: toRemove,
        currentTargetIds: desired,
      };
    });
  }

  async getOutgoingTargets(
    sourceMessageId: string,
    definitionId: string,
  ): Promise<string[]> {
    const rows = await this.db
      .select({ targetMessageId: messageRelations.targetMessageId })
      .from(messageRelations)
      .where(
        and(
          eq(messageRelations.sourceMessageId, sourceMessageId),
          eq(messageRelations.propertyDefinitionId, definitionId),
        ),
      )
      .orderBy(messageRelations.createdAt);
    return rows.map((r) => r.targetMessageId);
  }

  async getIncomingSources(
    targetMessageId: string,
    relationKind: "parent" | "related",
  ): Promise<{ sourceMessageId: string; propertyDefinitionId: string }[]> {
    const rows = await this.db
      .select({
        sourceMessageId: messageRelations.sourceMessageId,
        propertyDefinitionId: messageRelations.propertyDefinitionId,
        createdAt: messageRelations.createdAt,
      })
      .from(messageRelations)
      .innerJoin(messages, eq(messages.id, messageRelations.sourceMessageId))
      .where(
        and(
          eq(messageRelations.targetMessageId, targetMessageId),
          eq(messageRelations.relationKind, relationKind),
          eq(messages.isDeleted, false),
        ),
      )
      .orderBy(messageRelations.createdAt);
    return rows.map(({ sourceMessageId, propertyDefinitionId }) => ({
      sourceMessageId,
      propertyDefinitionId,
    }));
  }
}
```

- [ ] **Step 5: Provide in module**

Edit `apps/server/apps/gateway/src/im/properties/properties.module.ts`:

```ts
import { MessageRelationsService } from "./message-relations.service.js";

@Module({
  providers: [
    // ... existing providers
    MessageRelationsService,
  ],
  exports: [
    // ... existing exports
    MessageRelationsService,
  ],
})
export class PropertiesModule {}
```

- [ ] **Step 6: Make all tests pass**

```bash
pnpm -C apps/server jest -- --testPathPattern=message-relations.service.spec.ts --coverage
```

Expected: all tests pass, coverage = 100% for service + errors file.

- [ ] **Step 7: Commit**

```bash
git add apps/server/apps/gateway/src/im/properties/message-relations.service.ts \
        apps/server/apps/gateway/src/im/properties/message-relations.service.spec.ts \
        apps/server/apps/gateway/src/im/properties/message-relations.errors.ts \
        apps/server/apps/gateway/src/im/properties/properties.module.ts
git commit -m "feat(gateway): message-relations service with scope/cardinality validation"
```

---

## Task 4: Cycle detection + depth limit (WITH RECURSIVE)

**Goal:** Before any parent-kind INSERT, run a recursive CTE that walks the effective-parent chain of the proposed target and rejects if the source appears in that chain or if depth would exceed 10.

**Files:**

- Modify: `apps/server/apps/gateway/src/im/properties/message-relations.service.ts` (add `assertNoCycle` private method + wire into `setRelationTargets`)
- Modify: `apps/server/apps/gateway/src/im/properties/message-relations.service.spec.ts` (new describe block)

**Acceptance Criteria:**

- [ ] `assertNoCycle(sourceId, newTargetIds, tx)` emits one SQL query per target via `db.execute(sql`...`)`.
- [ ] Direct cycle A→B→A rejected with `RELATION_CYCLE_DETECTED`.
- [ ] Indirect A→B→C→A rejected.
- [ ] Thread-derived cycle rejected: A is thread reply of B; attempt to set A.parent=B's descendant.
- [ ] Chain that reaches depth 10 rejected with `RELATION_DEPTH_EXCEEDED`.
- [ ] Cycle check skipped when `relationKind !== 'parent'` (related edges don't form a tree).

**Verify:** `pnpm -C apps/server jest -- --testPathPattern=message-relations.service.spec.ts` passes, including five new cycle tests.

**Steps:**

- [ ] **Step 1: Add failing tests**

Insert into the spec:

```ts
describe("cycle detection", () => {
  it("rejects direct A→B→A cycle", async () => {
    // Arrange: existing relation B→A (parent). Attempt A→B.
    //   db.execute mock returns [{ m: sourceId, depth: 1 }]
    db.execute = jest.fn().mockResolvedValue([{ m: "A", depth: 1 }]);
    await expect(
      service.setRelationTargets({
        sourceMessageId: "A",
        targetMessageIds: ["B"],
        definition: {
          id: "d",
          channelId: "c",
          config: {
            scope: "same_channel",
            cardinality: "single",
            relationKind: "parent",
          },
        },
        actorId: "u",
      }),
    ).rejects.toMatchObject({ response: { code: "RELATION_CYCLE_DETECTED" } });
  });

  it("rejects depth-10 ancestor chain", async () => {
    db.execute = jest.fn().mockResolvedValue([{ m: "X", depth: 10 }]);
    await expect(/* same */).rejects.toMatchObject({
      response: { code: "RELATION_DEPTH_EXCEEDED" },
    });
  });

  it("allows legal parent assignment (CTE returns empty)", async () => {
    db.execute = jest.fn().mockResolvedValue([]);
    const result = await service.setRelationTargets({
      /* valid */
    });
    expect(result.addedTargetIds).toEqual(["B"]);
  });

  it("skips cycle check for relationKind=related", async () => {
    db.execute = jest.fn();
    await service.setRelationTargets({
      sourceMessageId: "A",
      targetMessageIds: ["B"],
      definition: {
        id: "d",
        channelId: "c",
        config: {
          scope: "same_channel",
          cardinality: "multi",
          relationKind: "related",
        },
      },
      actorId: "u",
    });
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("detects thread-derived cycle (CTE traverses messages.parent_id)", async () => {
    // We rely on the SQL's UNION over messages.parent_id; mock returns source id.
    db.execute = jest.fn().mockResolvedValue([{ m: "A", depth: 2 }]);
    await expect(/* ... */).rejects.toMatchObject({
      response: { code: "RELATION_CYCLE_DETECTED" },
    });
  });
});
```

- [ ] **Step 2: Implement `assertNoCycle`**

```ts
import { sql } from 'drizzle-orm';

private async assertNoCycle(
  tx: PostgresJsDatabase<typeof schema>,
  sourceMessageId: string,
  newTargetIds: string[],
  relationKind: 'parent' | 'related',
): Promise<void> {
  if (relationKind !== 'parent') return;
  for (const targetId of newTargetIds) {
    if (targetId === sourceMessageId) continue; // caught earlier
    const rows: Array<{ m: string; depth: number }> = await tx.execute(sql`
      WITH RECURSIVE ancestors(m, depth) AS (
        SELECT target_message_id, 1
          FROM im_message_relations
          WHERE source_message_id = ${targetId} AND relation_kind = 'parent'
        UNION ALL
        SELECT parent_id, 1
          FROM im_messages
          WHERE id = ${targetId} AND parent_id IS NOT NULL
        UNION ALL
        SELECT r.target_message_id, a.depth + 1
          FROM im_message_relations r
          JOIN ancestors a ON r.source_message_id = a.m
          WHERE r.relation_kind = 'parent' AND a.depth < 10
        UNION ALL
        SELECT msg.parent_id, a.depth + 1
          FROM im_messages msg
          JOIN ancestors a ON msg.id = a.m
          WHERE msg.parent_id IS NOT NULL AND a.depth < 10
      )
      SELECT m, depth FROM ancestors
      WHERE m = ${sourceMessageId} OR depth >= 10
      LIMIT 1;
    `);
    if (rows.length === 0) continue;
    const { m, depth } = rows[0];
    if (m === sourceMessageId) throw new RelationError('CYCLE_DETECTED');
    if (depth >= 10) throw new RelationError('DEPTH_EXCEEDED');
  }
}
```

- [ ] **Step 3: Wire into `setRelationTargets`**

Inside the transaction, after scope/target validation and before INSERT:

```ts
if (config.relationKind === "parent" && toAdd.length > 0) {
  await this.assertNoCycle(tx, sourceMessageId, toAdd, "parent");
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm -C apps/server jest -- --testPathPattern=message-relations.service.spec.ts
```

Expected: all cycle tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/server/apps/gateway/src/im/properties/message-relations.service.ts \
        apps/server/apps/gateway/src/im/properties/message-relations.service.spec.ts
git commit -m "feat(gateway): cycle detection + depth guard for parent relations"
```

---

## Task 5: Effective-parent helper + subtree query

**Goal:** Add two graph-query capabilities to `message-relations.service`:

1. `getEffectiveParent(messageId, parentDefId)` — implements COALESCE(stored relation, thread parentId, null) and respects the `explicitlyCleared` flag stored in `im_message_properties`.
2. `getSubtree({ rootIds, maxDepth, parentDefId })` — returns flat node list with depth, used by the tree endpoint.

**Files:**

- Modify: `apps/server/apps/gateway/src/im/properties/message-relations.service.ts`
- Modify: `apps/server/apps/gateway/src/im/properties/message-relations.service.spec.ts`

**Acceptance Criteria:**

- [ ] `getEffectiveParent` returns `{ id, source: 'relation' | 'thread' }` or `null`.
- [ ] `explicitlyCleared: true` on `im_message_properties.jsonValue` yields `null` regardless of thread parentId.
- [ ] `getSubtree` returns flat `{ messageId, effectiveParentId, depth, hasChildren }` list, capped at `maxDepth`.
- [ ] `hasChildren` correct for leaves at the requested depth (lookahead one level).

**Verify:** Same jest pattern test command; new `describe('effective parent')` and `describe('subtree query')` blocks.

**Steps:**

- [ ] **Step 1: Failing tests**

```ts
describe("getEffectiveParent", () => {
  it("returns null when no relation, no parentId, no explicit clear", async () => {
    /* mock */
  });
  it("returns thread source when only parentId present", async () => {
    /* ... */
  });
  it("returns relation source when explicit relation present, parentId ignored", async () => {
    /* ... */
  });
  it("returns null when explicitlyCleared flag is true even if parentId exists", async () => {
    /* ... */
  });
});

describe("getSubtree", () => {
  it("returns root plus descendants up to maxDepth=2", async () => {
    /* ... */
  });
  it("sets hasChildren=true when descendants exist beyond maxDepth", async () => {
    /* ... */
  });
  it("merges thread-derived edges with explicit relation edges", async () => {
    /* ... */
  });
});
```

- [ ] **Step 2: Implement `getEffectiveParent`**

```ts
import { messageProperties } from '@team9/database';

async getEffectiveParent(
  messageId: string,
  parentDefinitionId: string,
): Promise<{ id: string; source: 'relation' | 'thread' } | null> {
  // 1) check explicit clear
  const [prop] = await this.db
    .select({ jsonValue: messageProperties.jsonValue })
    .from(messageProperties)
    .where(
      and(
        eq(messageProperties.messageId, messageId),
        eq(messageProperties.propertyDefinitionId, parentDefinitionId),
      ),
    )
    .limit(1);
  if (prop && (prop.jsonValue as any)?.explicitlyCleared === true) return null;

  // 2) check stored relation
  const [rel] = await this.db
    .select({ targetMessageId: messageRelations.targetMessageId })
    .from(messageRelations)
    .where(
      and(
        eq(messageRelations.sourceMessageId, messageId),
        eq(messageRelations.propertyDefinitionId, parentDefinitionId),
        eq(messageRelations.relationKind, 'parent'),
      ),
    )
    .limit(1);
  if (rel) return { id: rel.targetMessageId, source: 'relation' };

  // 3) fall back to thread parentId
  const [msg] = await this.db
    .select({ parentId: messages.parentId })
    .from(messages)
    .where(eq(messages.id, messageId))
    .limit(1);
  if (msg?.parentId) return { id: msg.parentId, source: 'thread' };
  return null;
}
```

- [ ] **Step 3: Implement `getSubtree`**

```ts
export interface SubtreeNode {
  messageId: string;
  effectiveParentId: string | null;
  parentSource: 'relation' | 'thread' | null;
  depth: number;
  hasChildren: boolean;
}

async getSubtree(params: {
  channelId: string;
  rootIds: string[];
  maxDepth: number;
  parentDefinitionId: string;
}): Promise<SubtreeNode[]> {
  const { channelId, rootIds, maxDepth, parentDefinitionId } = params;
  if (rootIds.length === 0) return [];

  // One CTE covers all roots; we fetch maxDepth+1 to compute hasChildren, then drop the extra level.
  const rows: Array<{
    id: string;
    parent_id: string | null;
    parent_source: 'relation' | 'thread' | null;
    depth: number;
  }> = await this.db.execute(sql`
    WITH RECURSIVE tree(id, parent_id, parent_source, depth) AS (
      SELECT id, NULL::uuid, NULL::text, 0
        FROM im_messages
        WHERE id = ANY(${rootIds}::uuid[]) AND is_deleted = false
      UNION ALL
      SELECT child.id,
             COALESCE(rel.target_message_id, child.parent_id) AS parent_id,
             CASE
               WHEN rel.target_message_id IS NOT NULL THEN 'relation'
               WHEN child.parent_id IS NOT NULL THEN 'thread'
             END AS parent_source,
             tree.depth + 1
        FROM tree
        JOIN im_messages child
          ON (child.parent_id = tree.id OR child.id IN (
                SELECT source_message_id FROM im_message_relations
                WHERE target_message_id = tree.id
                  AND relation_kind = 'parent'
                  AND property_definition_id = ${parentDefinitionId}
              ))
        LEFT JOIN im_message_relations rel
          ON rel.source_message_id = child.id
         AND rel.relation_kind = 'parent'
         AND rel.property_definition_id = ${parentDefinitionId}
        WHERE child.channel_id = ${channelId}
          AND child.is_deleted = false
          AND tree.depth < ${maxDepth + 1}
    )
    SELECT id, parent_id, parent_source, depth FROM tree;
  `);

  // Compute hasChildren by checking which ids appear as parent_id at depth > ours.
  const byId = new Map(rows.map((r) => [r.id, r]));
  const parentsAtDeeperLevel = new Set(
    rows.filter((r) => r.parent_id && r.depth > 0).map((r) => r.parent_id as string),
  );

  // Drop the probe level (depth > maxDepth); they exist only to signal hasChildren.
  const visible = rows.filter((r) => r.depth <= maxDepth);

  return visible.map((r) => ({
    messageId: r.id,
    effectiveParentId: r.parent_id,
    parentSource: r.parent_source,
    depth: r.depth,
    hasChildren: parentsAtDeeperLevel.has(r.id),
  }));
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm -C apps/server jest -- --testPathPattern=message-relations.service.spec.ts --coverage
```

Expected: all new and existing tests pass; coverage stays at 100%.

- [ ] **Step 5: Commit**

```bash
git add apps/server/apps/gateway/src/im/properties/message-relations.service.ts \
        apps/server/apps/gateway/src/im/properties/message-relations.service.spec.ts
git commit -m "feat(gateway): effective-parent helper + subtree CTE"
```

---

## Task 6: Route `relationKind` property writes through the relations service

**Goal:** Hook `MessagePropertiesService.setProperty` / `removeProperty` to detect `relationKind`-configured definitions and delegate to `MessageRelationsService`. Keep jsonb path intact for legacy `message_ref`.

**Files:**

- Modify: `apps/server/apps/gateway/src/im/properties/message-properties.service.ts`
- Modify: `apps/server/apps/gateway/src/im/properties/message-properties.service.spec.ts`

**Acceptance Criteria:**

- [ ] When definition config has `relationKind`, writes go to `message_relations` and `message_properties.jsonValue` is set to `null`.
- [ ] When value is `null` on a `relationKind` property, `message_properties.jsonValue = { explicitlyCleared: true }` is upserted and any existing edges are removed.
- [ ] Reading a `relationKind` property assembles `jsonValue` from relation table.
- [ ] Legacy `message_ref` (no `relationKind`) behavior unchanged — a regression test asserts the jsonValue round-trip.
- [ ] Audit log records `addedTargetIds` / `removedTargetIds` in `changes`.

**Verify:** `pnpm -C apps/server jest -- --testPathPattern=message-properties.service.spec.ts` passes, including three new behavior blocks and a grandfather test.

**Steps:**

- [ ] **Step 1: Update failing tests**

Add to `message-properties.service.spec.ts`:

```ts
describe("relationKind property routing", () => {
  it("delegates writes to MessageRelationsService.setRelationTargets", async () => {
    // arrange: definition.config.relationKind = 'parent'
    // act: setProperty('parentMessage', 'm-target')
    // assert: relationsService.setRelationTargets called; db.update to message_properties.jsonValue = null
  });

  it("stores explicitlyCleared flag when value=null on relationKind property", async () => {
    // arrange: setProperty('parentMessage', null)
    // assert: relations removed + jsonValue upsert with { explicitlyCleared: true }
  });

  it("returns target ids from relation table on read", async () => {
    // arrange: relationsService.getOutgoingTargets returns ['m-a']
    // act: getProperty('parentMessage')
    // assert: value === 'm-a'
  });

  it("legacy message_ref (no relationKind) still writes to jsonValue", async () => {
    // regression
  });

  it("audit log carries addedTargetIds and removedTargetIds on relation write", async () => {
    // assert auditService.log called with expected changes
  });
});
```

- [ ] **Step 2: Modify `setProperty`**

Before the existing jsonValue write, inside the method after `definition` is resolved:

```ts
if (definition.valueType === 'message_ref' && (definition.config as MessageRefConfig)?.relationKind) {
  const config = definition.config as MessageRefConfig;
  const targetIds: string[] =
    value == null ? [] : Array.isArray(value) ? (value as string[]) : [value as string];
  const explicitClear = value == null;

  const diff = await this.relationsService.setRelationTargets({
    sourceMessageId: messageId,
    targetMessageIds: targetIds,
    definition: { id: definition.id, channelId: message.channelId, config },
    actorId: userId,
  });

  // upsert message_properties row (jsonValue mirrors clear flag or null)
  await this.db
    .insert(messageProperties)
    .values({
      messageId,
      propertyDefinitionId: definition.id,
      jsonValue: explicitClear ? { explicitlyCleared: true } : null,
      updatedBy: userId,
    })
    .onConflictDoUpdate({
      target: [messageProperties.messageId, messageProperties.propertyDefinitionId],
      set: {
        jsonValue: explicitClear ? { explicitlyCleared: true } : null,
        updatedBy: userId,
        updatedAt: new Date(),
      },
    });

  await this.auditService.log({
    channelId: message.channelId,
    entityType: 'message',
    entityId: messageId,
    action: 'message_property_changed',
    changes: {
      [definition.key]: {
        added: diff.addedTargetIds,
        removed: diff.removedTargetIds,
      },
    },
    performedBy: userId,
    metadata: { definitionId: definition.id, valueType: 'message_ref', relationKind: config.relationKind },
  });

  // Emit relation + property events (see Task 9 for emit helpers)
  await this.emitRelationChanged({ ... });
  return;
}

// else: existing legacy jsonValue path
```

Inject `MessageRelationsService` in the constructor.

- [ ] **Step 3: Modify `getProperty` / `getProperties`**

Wrap the existing read. For each returned definition, branch on `relationKind`:

```ts
const value =
  relationKind != null
    ? await this.relationsService.getOutgoingTargets(messageId, definition.id)
    : row?.jsonValue ?? /* existing primitive reads */;
```

For single-cardinality properties, collapse a 0/1-length array to `string | null`.

- [ ] **Step 4: Run tests**

```bash
pnpm -C apps/server jest -- --testPathPattern=message-properties.service.spec.ts --coverage
```

Expected: all tests pass; grandfather test unaffected.

- [ ] **Step 5: Commit**

```bash
git add apps/server/apps/gateway/src/im/properties/message-properties.service.ts \
        apps/server/apps/gateway/src/im/properties/message-properties.service.spec.ts
git commit -m "feat(gateway): route relationKind properties through relations service"
```

---

## Task 7: Enforce at-most-one `relationKind='parent'` definition per channel

**Goal:** When creating a channel property definition, if config carries `relationKind: 'parent'`, validate no existing definition on the same channel has the same relationKind. Also validate config shape.

**Files:**

- Modify: `apps/server/apps/gateway/src/im/properties/property-definitions.service.ts`
- Modify: `apps/server/apps/gateway/src/im/properties/property-definitions.service.spec.ts`

**Acceptance Criteria:**

- [ ] `createDefinition` rejects a second `relationKind='parent'` definition in the same channel with `RELATION_DEFINITION_CONFLICT`.
- [ ] `relationKind='related'` allowed multiple times per channel (distinct keys).
- [ ] `config.scope` defaults to `'any'`, `config.cardinality` to `'multi'` when not provided (backward compat).
- [ ] `updateDefinition` rejects attempts to change `relationKind` or `scope` on a definition that already has rows in `im_message_relations` (prevents semantic drift).

**Verify:** `pnpm -C apps/server jest -- --testPathPattern=property-definitions.service.spec.ts`.

**Steps:**

- [ ] **Step 1: Failing tests**

```ts
describe("relationKind config rules", () => {
  it("rejects second parent definition on same channel", async () => {
    /* arrange existing row; expect RELATION_DEFINITION_CONFLICT */
  });
  it("allows multiple related definitions on same channel", async () => {
    /* ok */
  });
  it("applies default scope=any / cardinality=multi for legacy message_ref", async () => {
    /* ... */
  });
  it("rejects changing relationKind on a definition with existing edges", async () => {
    /* arrange SELECT COUNT > 0; expect BadRequestException */
  });
});
```

- [ ] **Step 2: Implement validation**

In `createDefinition`:

```ts
if (input.valueType === "message_ref") {
  const cfg: MessageRefConfig = {
    scope: input.config?.scope ?? "any",
    cardinality: input.config?.cardinality ?? "multi",
    ...(input.config?.relationKind
      ? { relationKind: input.config.relationKind }
      : {}),
  };
  input.config = cfg;

  if (cfg.relationKind === "parent") {
    const [existing] = await this.db
      .select({ id: channelPropertyDefinitions.id })
      .from(channelPropertyDefinitions)
      .where(
        and(
          eq(channelPropertyDefinitions.channelId, input.channelId),
          sql`${channelPropertyDefinitions.config}->>'relationKind' = 'parent'`,
        ),
      )
      .limit(1);
    if (existing) throw new RelationError("DEFINITION_CONFLICT");
  }
}
```

In `updateDefinition`, if attempting to change `relationKind` or `scope`:

```ts
const [edgeCount] = await this.db
  .select({ n: sql<number>`count(*)` })
  .from(messageRelations)
  .where(eq(messageRelations.propertyDefinitionId, id));
if (edgeCount.n > 0) {
  throw new BadRequestException(
    "Cannot change scope/relationKind on a definition with existing edges",
  );
}
```

- [ ] **Step 3: Run tests + commit**

```bash
pnpm -C apps/server jest -- --testPathPattern=property-definitions.service.spec.ts
git add apps/server/apps/gateway/src/im/properties/property-definitions.service.ts \
        apps/server/apps/gateway/src/im/properties/property-definitions.service.spec.ts
git commit -m "feat(gateway): validate relationKind definitions (one-parent-per-channel, immutable scope)"
```

---

## Task 8: REST endpoints for relation inspection + hierarchy tree

**Goal:** Expose two new HTTP endpoints:

- `GET /channels/:channelId/messages/:messageId/relations`
- `GET /channels/:channelId/views/:viewId/tree`

**Files:**

- Modify: `apps/server/apps/gateway/src/im/properties/message-properties.controller.ts` (add relations endpoint)
- Modify: `apps/server/apps/gateway/src/im/views/views.controller.ts` (add tree endpoint)
- Modify: `apps/server/apps/gateway/src/im/views/views.service.ts` (implement `getTreeSnapshot`)
- Modify: matching `*.spec.ts` for both

**Acceptance Criteria:**

- [ ] `GET /messages/:id/relations` returns the spec §3.2 shape with sane defaults.
- [ ] `GET /views/:id/tree` honours `filter`, `sort`, `maxDepth ≤ 5`, `expandedIds`, `cursor`, `limit ≤ 100`.
- [ ] Unauthorized or cross-tenant access returns 404 (consistent with existing guards).
- [ ] Both endpoints covered by controller + service specs.

**Verify:** `pnpm -C apps/server jest -- --testPathPattern='(message-properties.controller|views).spec'`.

**Steps:**

- [ ] **Step 1: Controller tests**

```ts
// message-properties.controller.spec.ts  (append)
describe("GET /messages/:id/relations", () => {
  it("returns outgoing parent + related and incoming reverse lookups", async () => {
    /* ... */
  });
  it("respects depth parameter (clamps to 10)", async () => {
    /* ... */
  });
});

// views.controller.spec.ts  (append)
describe("GET /views/:id/tree", () => {
  it("returns nodes with effectiveParentId and ancestorsIncluded set", async () => {
    /* ... */
  });
  it("paginates root matches by cursor + limit", async () => {
    /* ... */
  });
  it("rejects maxDepth > 5 with 400", async () => {
    /* ... */
  });
});
```

- [ ] **Step 2: Service `getTreeSnapshot` in `views.service.ts`**

```ts
async getTreeSnapshot(params: {
  channelId: string; viewId: string;
  filter?: ViewFilter; sort?: ViewSort;
  maxDepth: number; expandedIds: string[];
  cursor: string | null; limit: number;
}) {
  // 1) fetch parent definition (relationKind='parent') for this channel
  const [parentDef] = await this.db.select(/* ... */).from(channelPropertyDefinitions).where(/* channelId + config->>'relationKind'='parent' */);
  if (!parentDef) return { nodes: [], nextCursor: null, ancestorsIncluded: [] };

  // 2) apply filter to get hit set (reuse existing filter DSL)
  const hitIds = await this.messageQueryService.findMessageIdsMatchingFilter(params.channelId, params.filter, params.sort, params.cursor, params.limit);

  // 3) walk ancestors for each hit (in-memory while depth small)
  const ancestorSet = new Set<string>();
  for (const id of hitIds) {
    let cur: string | null = id;
    while (cur) {
      const parent = await this.relationsService.getEffectiveParent(cur, parentDef.id);
      if (!parent) break;
      if (ancestorSet.has(parent.id)) break;
      ancestorSet.add(parent.id);
      cur = parent.id;
    }
  }

  // 4) determine roots = effective_parent null among hits∪ancestors
  const universe = [...new Set([...hitIds, ...ancestorSet])];
  const roots: string[] = [];
  for (const id of universe) {
    const p = await this.relationsService.getEffectiveParent(id, parentDef.id);
    if (!p) roots.push(id);
  }

  // 5) subtree up to maxDepth
  const nodes = await this.relationsService.getSubtree({
    channelId: params.channelId, rootIds: roots, maxDepth: params.maxDepth, parentDefinitionId: parentDef.id,
  });

  // 6) expandedIds extra level
  for (const id of params.expandedIds) {
    const extra = await this.relationsService.getSubtree({
      channelId: params.channelId, rootIds: [id], maxDepth: 1, parentDefinitionId: parentDef.id,
    });
    for (const n of extra) {
      if (!nodes.find((x) => x.messageId === n.messageId)) nodes.push(n);
    }
  }

  return {
    nodes,
    nextCursor: hitIds.length === params.limit ? hitIds[hitIds.length - 1] : null,
    ancestorsIncluded: [...ancestorSet].filter((id) => !hitIds.includes(id)),
  };
}
```

The ancestor walk is O(hits × depth). For MVP (depth ≤ 10, hits ≤ 100) this is ~1000 DB reads worst-case — acceptable but flagged for later optimization.

- [ ] **Step 3: Controllers**

```ts
// message-properties.controller.ts
@Get('relations')
async getRelations(
  @Param('messageId') messageId: string,
  @Query('kind') kind: 'parent' | 'related' | 'all' = 'all',
  @Query('direction') direction: 'outgoing' | 'incoming' | 'both' = 'both',
  @Query('depth', new DefaultValuePipe(1), ParseIntPipe) depth: number,
) {
  return this.messagePropertiesService.getRelationsInspection(messageId, { kind, direction, depth: Math.min(depth, 10) });
}
```

```ts
// views.controller.ts
@Get(':viewId/tree')
async getTree(
  @Param('channelId') channelId: string,
  @Param('viewId') viewId: string,
  @Query('maxDepth', new DefaultValuePipe(3), ParseIntPipe) maxDepth: number,
  @Query('expandedIds') expandedIdsRaw?: string,
  @Query('cursor') cursor?: string,
  @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  @Query('filter') filterRaw?: string,
  @Query('sort') sortRaw?: string,
) {
  if (maxDepth > 5) throw new BadRequestException('maxDepth must be <= 5');
  if (limit > 100) throw new BadRequestException('limit must be <= 100');
  return this.viewsService.getTreeSnapshot({
    channelId, viewId, maxDepth, limit,
    cursor: cursor ?? null,
    expandedIds: expandedIdsRaw ? expandedIdsRaw.split(',') : [],
    filter: filterRaw ? JSON.parse(filterRaw) : undefined,
    sort: sortRaw ? JSON.parse(sortRaw) : undefined,
  });
}
```

- [ ] **Step 4: Run tests + commit**

```bash
pnpm -C apps/server jest -- --testPathPattern='(message-properties.controller|views).spec'
git add apps/server/apps/gateway/src/im/properties/message-properties.controller.ts \
        apps/server/apps/gateway/src/im/views/views.controller.ts \
        apps/server/apps/gateway/src/im/views/views.service.ts \
        apps/server/apps/gateway/src/im/properties/message-properties.controller.spec.ts \
        apps/server/apps/gateway/src/im/views/views.controller.spec.ts \
        apps/server/apps/gateway/src/im/views/views.service.spec.ts
git commit -m "feat(gateway): relation inspection + hierarchy tree endpoints"
```

---

## Task 9: WebSocket events + delete cascade purge event

**Goal:** Emit `message_relation_changed` whenever relation edges change, and `message_relations_purged` when a message is soft-deleted. Extend existing `message_property_changed` with `relationKind` / `explicitlyCleared`. Ensure event ordering (relation → property).

**Files:**

- Modify: `apps/server/apps/gateway/src/im/websocket/websocket.gateway.ts` (new emit helpers)
- Modify: `apps/server/apps/gateway/src/im/properties/message-properties.service.ts` (call the new helpers at the end of relation writes)
- Modify: `apps/server/apps/gateway/src/im/messages/messages.service.ts` (emit purged event inside `softDelete` transaction)
- Modify: associated `*.spec.ts` files.

**Acceptance Criteria:**

- [ ] `emitRelationChanged(payload)` broadcasts the event to all channel members via existing `sendToChannelMembers`.
- [ ] `emitRelationsPurged(payload)` same.
- [ ] `message_relation_changed` is emitted before `message_property_changed` for the same change (verified in spec by capturing call order).
- [ ] Soft-deleting a message:
  - Computes `affectedSourceIds = SELECT DISTINCT source_message_id FROM im_message_relations WHERE target_message_id = :id`.
  - Emits one `message_relations_purged` event.
  - Relies on FK CASCADE to remove edges.

**Verify:** `pnpm -C apps/server jest -- --testPathPattern='(message-properties|messages).service.spec'`.

**Steps:**

- [ ] **Step 1: Failing tests**

In `websocket.gateway.spec.ts`:

```ts
describe("relation event helpers", () => {
  it("emitRelationChanged broadcasts to channel members with event name from WS_EVENTS", async () => {
    /* ... */
  });
  it("emitRelationsPurged carries affectedSourceIds", async () => {
    /* ... */
  });
});
```

In `message-properties.service.spec.ts`:

```ts
it("emits message_relation_changed before message_property_changed", async () => {
  const order: string[] = [];
  wsGateway.emitRelationChanged.mockImplementation(() =>
    order.push("relation"),
  );
  wsGateway.emitMessagePropertyChanged.mockImplementation(() =>
    order.push("property"),
  );
  await service.setProperty(/* relationKind property */);
  expect(order).toEqual(["relation", "property"]);
});
```

In `messages.service.spec.ts`:

```ts
it("emits message_relations_purged on soft delete with affected source ids", async () => {
  db.select.mockResolvedValueOnce([
    { sourceMessageId: "a" },
    { sourceMessageId: "b" },
  ]);
  await service.softDelete("m1");
  expect(wsGateway.emitRelationsPurged).toHaveBeenCalledWith({
    channelId: "c1",
    deletedMessageId: "m1",
    affectedSourceIds: ["a", "b"],
  });
});
```

- [ ] **Step 2: Add emit helpers in websocket.gateway.ts**

```ts
async emitRelationChanged(payload: MessageRelationChangedEvent): Promise<void> {
  await this.sendToChannelMembers(payload.channelId, WS_EVENTS.PROPERTY.RELATION_CHANGED, payload);
}

async emitRelationsPurged(payload: MessageRelationsPurgedEvent): Promise<void> {
  await this.sendToChannelMembers(payload.channelId, WS_EVENTS.PROPERTY.RELATIONS_PURGED, payload);
}

async emitMessagePropertyChanged(payload: MessagePropertyChangedEvent): Promise<void> {
  await this.sendToChannelMembers(payload.channelId, WS_EVENTS.PROPERTY.MESSAGE_CHANGED, payload);
}
```

(If `emitMessagePropertyChanged` already exists, just extend its signature to pass through the new fields.)

- [ ] **Step 3: Wire into `message-properties.service.ts`**

Inside the `relationKind` branch, after the audit log and before `return`:

```ts
await this.wsGateway.emitRelationChanged({
  channelId: message.channelId,
  sourceMessageId: messageId,
  propertyDefinitionId: definition.id,
  propertyKey: definition.key,
  relationKind: config.relationKind!,
  action:
    diff.removedTargetIds.length > 0 && diff.addedTargetIds.length > 0
      ? "replaced"
      : diff.addedTargetIds.length > 0
        ? "added"
        : "removed",
  addedTargetIds: diff.addedTargetIds,
  removedTargetIds: diff.removedTargetIds,
  currentTargetIds: diff.currentTargetIds,
  performedBy: userId,
  timestamp: new Date().toISOString(),
});

await this.wsGateway.emitMessagePropertyChanged({
  channelId: message.channelId,
  messageId,
  properties: { set: { [definition.key]: null } }, // signal; targets live in relation event
  relationKind: config.relationKind!,
  ...(explicitClear ? { explicitlyCleared: true } : {}),
  performedBy: userId,
});
```

- [ ] **Step 4: Emit cascade purge in `messages.service.ts`**

In `softDeleteMessage` (the code path touched during exploration at line ~960):

```ts
// Before the UPDATE that sets isDeleted=true, capture affected sources.
const affected = await this.db
  .selectDistinct({ sourceMessageId: messageRelations.sourceMessageId })
  .from(messageRelations)
  .where(eq(messageRelations.targetMessageId, messageId));

// ... existing UPDATE ...

if (affected.length > 0) {
  await this.wsGateway.emitRelationsPurged({
    channelId: message.channelId,
    deletedMessageId: messageId,
    affectedSourceIds: affected.map((r) => r.sourceMessageId),
  });
}
```

FK cascade on the new table removes the edges automatically when the row is hard-deleted; for soft delete we keep edges (design C from spec — preserve reference) but the purged event still lets clients invalidate. **Note:** on soft delete, edges are _not_ removed. The event carries `affectedSourceIds` so clients know to refetch; the current edges remain so undelete restores structure naturally.

- [ ] **Step 5: Run tests + commit**

```bash
pnpm -C apps/server jest -- --testPathPattern='(websocket.gateway|message-properties|messages).spec'
git add apps/server/apps/gateway/src/im/websocket/websocket.gateway.ts \
        apps/server/apps/gateway/src/im/properties/message-properties.service.ts \
        apps/server/apps/gateway/src/im/messages/messages.service.ts \
        apps/server/apps/gateway/src/im/websocket/websocket.gateway.spec.ts \
        apps/server/apps/gateway/src/im/properties/message-properties.service.spec.ts \
        apps/server/apps/gateway/src/im/messages/messages.service.spec.ts
git commit -m "feat(gateway): WS events for relation change + cascade purge"
```

---

## Task 10: Frontend API client + WS listener registration

**Goal:** Add typed client functions for the two new endpoints and WebSocket listeners that invalidate React Query caches. No UI yet — this lets subsequent frontend tasks call into ready hooks.

**Files:**

- Modify: `apps/client/src/services/api.ts` (add `getMessageRelations`, `getViewTree`)
- Modify: `apps/client/src/services/websocket/index.ts` (register `onRelationChanged`, `onRelationsPurged`)
- Create: `apps/client/src/hooks/useMessageRelations.ts`
- Create: `apps/client/src/hooks/useViewTree.ts`
- Create: `apps/client/src/hooks/__tests__/useMessageRelations.test.tsx`
- Create: `apps/client/src/hooks/__tests__/useViewTree.test.tsx`
- Modify: `apps/client/src/providers/query-client.ts` (add relation query keys namespace)

**Acceptance Criteria:**

- [ ] `getMessageRelations(messageId, params)` returns typed result matching `spec §3.2`.
- [ ] `getViewTree(channelId, viewId, params)` matches `spec §3.3`.
- [ ] Two WS listeners wire to React Query invalidation:
  - `message_relation_changed` → invalidate `['relations', sourceId]`, `['relations-inbound', ...targetIds]`, `['view-tree', channelId]`.
  - `message_relations_purged` → invalidate `['relations', deletedMessageId]`, `['relations-inbound', deletedMessageId]`, `['view-tree', channelId]`, plus each `affectedSourceIds` entry in `['relations']`.
- [ ] Hook tests pass via Vitest.

**Verify:** `pnpm -C apps/client test -- useMessageRelations useViewTree`.

**Steps:**

- [ ] **Step 1: Types (co-located)**

```ts
// apps/client/src/types/relations.ts (new)
export type RelationKind = "parent" | "related";
export interface RelationInspectionResult {
  outgoing: {
    parent: Array<{
      messageId: string;
      depth: number;
      propertyDefinitionId: string;
      parentSource: "relation" | "thread";
    }>;
    related: Array<{ messageId: string; propertyDefinitionId: string }>;
  };
  incoming: {
    children: Array<{
      messageId: string;
      depth: number;
      propertyDefinitionId: string;
      parentSource: "relation" | "thread";
    }>;
    relatedBy: Array<{ messageId: string; propertyDefinitionId: string }>;
  };
}
export interface TreeNode {
  messageId: string;
  effectiveParentId: string | null;
  parentSource: "relation" | "thread" | null;
  depth: number;
  hasChildren: boolean;
  childrenLoaded: boolean;
}
export interface TreeSnapshot {
  nodes: TreeNode[];
  nextCursor: string | null;
  ancestorsIncluded: string[];
}
```

- [ ] **Step 2: API client functions**

```ts
// apps/client/src/services/api.ts (append)
export async function getMessageRelations(
  messageId: string,
  params: {
    kind?: "parent" | "related" | "all";
    direction?: "outgoing" | "incoming" | "both";
    depth?: number;
  } = {},
): Promise<RelationInspectionResult> {
  const qs = new URLSearchParams();
  if (params.kind) qs.set("kind", params.kind);
  if (params.direction) qs.set("direction", params.direction);
  if (params.depth != null) qs.set("depth", String(params.depth));
  return http.get(
    `/im/messages/${messageId}/properties/relations?${qs.toString()}`,
  );
}

export async function getViewTree(
  channelId: string,
  viewId: string,
  params: {
    maxDepth?: number;
    expandedIds?: string[];
    cursor?: string | null;
    limit?: number;
    filter?: unknown;
    sort?: unknown;
  } = {},
): Promise<TreeSnapshot> {
  const qs = new URLSearchParams();
  if (params.maxDepth != null) qs.set("maxDepth", String(params.maxDepth));
  if (params.expandedIds?.length)
    qs.set("expandedIds", params.expandedIds.join(","));
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.limit != null) qs.set("limit", String(params.limit));
  if (params.filter) qs.set("filter", JSON.stringify(params.filter));
  if (params.sort) qs.set("sort", JSON.stringify(params.sort));
  return http.get(
    `/im/channels/${channelId}/views/${viewId}/tree?${qs.toString()}`,
  );
}
```

- [ ] **Step 3: Query key namespace**

```ts
// apps/client/src/providers/query-client.ts (append)
export const relationKeys = {
  all: ["relations"] as const,
  byMessage: (messageId: string) => ["relations", messageId] as const,
  inbound: (messageId: string) => ["relations-inbound", messageId] as const,
  viewTree: (channelId: string, viewId: string) =>
    ["view-tree", channelId, viewId] as const,
};
```

- [ ] **Step 4: Hooks**

```tsx
// apps/client/src/hooks/useMessageRelations.ts
import { useQuery } from "@tanstack/react-query";
import { getMessageRelations } from "../services/api";
import { relationKeys } from "../providers/query-client";

export function useMessageRelations(messageId: string | undefined, depth = 1) {
  return useQuery({
    queryKey: messageId
      ? relationKeys.byMessage(messageId)
      : ["relations", "noop"],
    queryFn: () => getMessageRelations(messageId!, { depth }),
    enabled: !!messageId,
    staleTime: 30_000,
  });
}
```

```tsx
// apps/client/src/hooks/useViewTree.ts
import { useQuery } from "@tanstack/react-query";
import { getViewTree } from "../services/api";
import { relationKeys } from "../providers/query-client";

export function useViewTree(
  channelId: string,
  viewId: string,
  opts: {
    filter?: unknown;
    sort?: unknown;
    maxDepth?: number;
    limit?: number;
    expandedIds: string[];
  },
) {
  return useQuery({
    queryKey: [
      ...relationKeys.viewTree(channelId, viewId),
      opts.filter,
      opts.sort,
      opts.maxDepth,
      opts.expandedIds.join(","),
    ],
    queryFn: () => getViewTree(channelId, viewId, opts),
    enabled: !!channelId && !!viewId,
  });
}
```

- [ ] **Step 5: WS listeners + invalidation**

```ts
// apps/client/src/services/websocket/index.ts (append listeners)
onRelationChanged(callback: (e: MessageRelationChangedEvent) => void): void {
  this.on<MessageRelationChangedEvent>(WS_EVENTS.PROPERTY.RELATION_CHANGED, callback);
}
onRelationsPurged(callback: (e: MessageRelationsPurgedEvent) => void): void {
  this.on<MessageRelationsPurgedEvent>(WS_EVENTS.PROPERTY.RELATIONS_PURGED, callback);
}
```

Wire in the central app bootstrap (`apps/client/src/App.tsx` or wherever websocket listeners are registered today — grep for `onMessageUpdated` for precedent). Minimal snippet:

```tsx
useEffect(() => {
  ws.onRelationChanged((e) => {
    queryClient.invalidateQueries({
      queryKey: relationKeys.byMessage(e.sourceMessageId),
    });
    for (const tid of [...e.addedTargetIds, ...e.removedTargetIds]) {
      queryClient.invalidateQueries({ queryKey: relationKeys.inbound(tid) });
    }
    queryClient.invalidateQueries({ queryKey: ["view-tree", e.channelId] });
  });
  ws.onRelationsPurged((e) => {
    queryClient.invalidateQueries({
      queryKey: relationKeys.byMessage(e.deletedMessageId),
    });
    queryClient.invalidateQueries({
      queryKey: relationKeys.inbound(e.deletedMessageId),
    });
    for (const sid of e.affectedSourceIds) {
      queryClient.invalidateQueries({ queryKey: relationKeys.byMessage(sid) });
    }
    queryClient.invalidateQueries({ queryKey: ["view-tree", e.channelId] });
  });
}, []);
```

- [ ] **Step 6: Hook tests**

```tsx
// apps/client/src/hooks/__tests__/useMessageRelations.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMessageRelations } from "../useMessageRelations";
import * as api from "../../services/api";

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

describe("useMessageRelations", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("does not fetch when messageId is undefined", () => {
    const spy = vi.spyOn(api, "getMessageRelations");
    renderHook(() => useMessageRelations(undefined), { wrapper });
    expect(spy).not.toHaveBeenCalled();
  });
  it("fetches with given depth", async () => {
    vi.spyOn(api, "getMessageRelations").mockResolvedValue({
      outgoing: { parent: [], related: [] },
      incoming: { children: [], relatedBy: [] },
    });
    const { result } = renderHook(() => useMessageRelations("m1", 2), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.getMessageRelations).toHaveBeenCalledWith("m1", { depth: 2 });
  });
});
```

Mirror pattern for `useViewTree`.

- [ ] **Step 7: Run + commit**

```bash
pnpm -C apps/client test -- useMessageRelations useViewTree
git add apps/client/src/types/relations.ts \
        apps/client/src/services/api.ts \
        apps/client/src/services/websocket/index.ts \
        apps/client/src/providers/query-client.ts \
        apps/client/src/hooks/useMessageRelations.ts \
        apps/client/src/hooks/useViewTree.ts \
        apps/client/src/hooks/__tests__/useMessageRelations.test.tsx \
        apps/client/src/hooks/__tests__/useViewTree.test.tsx
git commit -m "feat(client): relation API client + WS listeners + React Query hooks"
```

---

## Task 11: Extend `MessageRefPicker` with scope + self-exclusion

**Goal:** Make the existing `MessageRefPicker` honour `config.scope='same_channel'` by constraining its search to the current channel, and never offer the current message as a candidate.

**Files:**

- Modify: `apps/client/src/components/channel/properties/editors/MessageRefPicker.tsx`
- Modify: `apps/client/src/components/channel/properties/editors/__tests__/MessageRefPicker.test.tsx`

**Acceptance Criteria:**

- [ ] When `definition.config.scope === 'same_channel'`, the search API is invoked with `channelId` filter.
- [ ] The current message id is excluded from suggestions.
- [ ] When `cardinality === 'single'`, selecting a new target replaces (rather than appends) the prior value, and the dropdown closes on selection.
- [ ] When `cardinality === 'multi'`, behavior matches today's multi-select chip editor.

**Verify:** `pnpm -C apps/client test -- MessageRefPicker`.

**Steps:**

- [ ] **Step 1: Add failing tests**

```tsx
// MessageRefPicker.test.tsx (append)
it("passes channelId when scope=same_channel", async () => {
  const searchSpy = vi.spyOn(api, "searchMessages").mockResolvedValue([]);
  render(
    <MessageRefPicker
      definition={{ config: { scope: "same_channel", cardinality: "single" } }}
      currentMessageId="m1"
      channelId="c1"
      {...rest}
    />,
  );
  await userEvent.type(screen.getByRole("combobox"), "hello");
  await waitFor(() =>
    expect(searchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: "c1" }),
    ),
  );
});

it("excludes current message from results", async () => {
  vi.spyOn(api, "searchMessages").mockResolvedValue([
    { id: "m1", content: "self" },
    { id: "m2", content: "other" },
  ]);
  render(<MessageRefPicker currentMessageId="m1" {...rest} />);
  await userEvent.type(screen.getByRole("combobox"), "anything");
  expect(await screen.findByText("other")).toBeInTheDocument();
  expect(screen.queryByText("self")).not.toBeInTheDocument();
});

it("single cardinality replaces value on selection and closes", async () => {
  /* ... */
});
```

- [ ] **Step 2: Implement**

Pass `config` + `currentMessageId` through. Inside the component:

```tsx
const searchParams = useMemo(
  () => ({
    q: query,
    channelId:
      definition.config.scope === "same_channel" ? channelId : undefined,
  }),
  [query, definition.config.scope, channelId],
);

const { data: rawResults } = useQuery({
  queryKey: ["messageRefSearch", searchParams],
  queryFn: () => searchMessages(searchParams),
  enabled: query.length > 0,
});

const results = useMemo(
  () => (rawResults ?? []).filter((m) => m.id !== currentMessageId),
  [rawResults, currentMessageId],
);
```

For selection:

```tsx
const onSelect = (m: MessageSearchResult) => {
  if (definition.config.cardinality === "single") {
    onChange(m.id);
    setOpen(false);
  } else {
    onChange([...(value ?? []), m.id]);
  }
};
```

- [ ] **Step 3: Run + commit**

```bash
pnpm -C apps/client test -- MessageRefPicker
git add apps/client/src/components/channel/properties/editors/MessageRefPicker.tsx \
        apps/client/src/components/channel/properties/editors/__tests__/MessageRefPicker.test.tsx
git commit -m "feat(client): scope-aware + self-excluding message ref picker"
```

---

## Task 12: `PropertyPanel` shortcut entries for 父任务 / 关联任务

**Goal:** Add two quick-create entries in the "add property" menu that create pre-configured `message_ref` definitions.

**Files:**

- Modify: `apps/client/src/components/channel/properties/PropertyPanel.tsx`
- Modify: corresponding `*.test.tsx` (create if missing)

**Acceptance Criteria:**

- [ ] Menu shows a new grouped section "任务关系" with entries "父任务" and "关联任务".
- [ ] Clicking "父任务" calls `createPropertyDefinition` with:
  ```ts
  { key: 'parentMessage', valueType: 'message_ref',
    config: { scope: 'same_channel', cardinality: 'single', relationKind: 'parent' } }
  ```
- [ ] Clicking "关联任务" calls it with `{ key: 'relatedMessages', ..., cardinality: 'multi', relationKind: 'related' }`.
- [ ] If a parent-type definition already exists on the channel, the "父任务" entry is disabled with a tooltip.
- [ ] If the key `parentMessage` or `relatedMessages` already exists, auto-suffix `-2`, `-3`, ….

**Verify:** `pnpm -C apps/client test -- PropertyPanel`.

**Steps:**

- [ ] **Step 1: Failing test**

```tsx
it("creates a parent-message definition with expected config on click", async () => {
  const createSpy = vi
    .spyOn(api, "createPropertyDefinition")
    .mockResolvedValue(/* def */);
  render(<PropertyPanel channelId="c1" existingDefinitions={[]} />);
  await userEvent.click(screen.getByRole("button", { name: "添加属性" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "父任务" }));
  expect(createSpy).toHaveBeenCalledWith("c1", {
    key: "parentMessage",
    valueType: "message_ref",
    config: {
      scope: "same_channel",
      cardinality: "single",
      relationKind: "parent",
    },
  });
});

it("disables 父任务 entry when a parent definition already exists", () => {
  /* ... */
});
```

- [ ] **Step 2: Implement menu entries**

In `PropertyPanel.tsx`, within the "add property" dropdown:

```tsx
const hasParentDef = existingDefinitions.some(
  (d) => d.valueType === "message_ref" && d.config?.relationKind === "parent",
);

const handleAddParent = () => {
  const key = resolveUniqueKey("parentMessage", existingDefinitions);
  createDefinition({
    channelId,
    key,
    valueType: "message_ref",
    config: {
      scope: "same_channel",
      cardinality: "single",
      relationKind: "parent",
    },
  });
};
const handleAddRelated = () => {
  const key = resolveUniqueKey("relatedMessages", existingDefinitions);
  createDefinition({
    channelId,
    key,
    valueType: "message_ref",
    config: {
      scope: "same_channel",
      cardinality: "multi",
      relationKind: "related",
    },
  });
};

// In menu:
<MenuSection label="任务关系">
  <MenuItem
    onClick={handleAddParent}
    disabled={hasParentDef}
    tooltip={hasParentDef ? "此频道已有父任务属性" : undefined}
  >
    父任务
  </MenuItem>
  <MenuItem onClick={handleAddRelated}>关联任务</MenuItem>
</MenuSection>;
```

Helper:

```ts
function resolveUniqueKey(base: string, defs: { key: string }[]): string {
  if (!defs.some((d) => d.key === base)) return base;
  for (let n = 2; n < 100; n++)
    if (!defs.some((d) => d.key === `${base}-${n}`)) return `${base}-${n}`;
  return `${base}-${Date.now()}`;
}
```

- [ ] **Step 3: Run + commit**

```bash
pnpm -C apps/client test -- PropertyPanel
git add apps/client/src/components/channel/properties/PropertyPanel.tsx \
        apps/client/src/components/channel/properties/__tests__/PropertyPanel.test.tsx
git commit -m "feat(client): add 父任务/关联任务 shortcuts in property menu"
```

---

## Task 13: `MessageRefChip` — deleted, no-permission, thread-source states

**Goal:** Render three variants clearly so broken or derived references are visually distinct.

**Files:**

- Modify: `apps/client/src/components/channel/properties/MessageRefChip.tsx` (create if naming differs — grep for the component that renders message_ref values inline)
- Modify: corresponding test file

**Acceptance Criteria:**

- [ ] Normal target: avatar + first-line snippet, click jumps to message.
- [ ] `isDeleted: true` target: strike-through + gray + text "[已删除]", not clickable (or clickable but shows placeholder overlay).
- [ ] Target lookup returns 403/not-in-channel: text "[无权限]", not clickable.
- [ ] When `parentSource === 'thread'`, a 🧵 corner badge is rendered; otherwise no badge.
- [ ] Keyboard: `Tab` focuses the chip, `Enter` triggers navigation on clickable chips only.

**Verify:** `pnpm -C apps/client test -- MessageRefChip`.

**Steps:**

- [ ] **Step 1: Failing tests**

```tsx
it('renders strike-through and "[已删除]" when target isDeleted', () => {
  render(<MessageRefChip target={{ id: "m1", isDeleted: true }} />);
  const chip = screen.getByTestId("message-ref-chip");
  expect(chip).toHaveTextContent("[已删除]");
  expect(chip.className).toMatch(/line-through/);
  expect(chip).toHaveAttribute("aria-disabled", "true");
});

it('renders "[无权限]" when forbidden=true', () => {
  /* ... */
});
it("renders thread badge when parentSource=thread", () => {
  /* ... */
});
it("fires navigate callback on click for normal target", () => {
  /* ... */
});
```

- [ ] **Step 2: Implement variants**

```tsx
export interface MessageRefChipProps {
  target: {
    id: string;
    snippet?: string;
    avatarUrl?: string;
    isDeleted?: boolean;
    forbidden?: boolean;
  } | null;
  parentSource?: "relation" | "thread" | null;
  onNavigate?: (messageId: string) => void;
}

export function MessageRefChip({
  target,
  parentSource,
  onNavigate,
}: MessageRefChipProps) {
  if (!target) return null;
  const disabled = target.isDeleted || target.forbidden;
  const label = target.forbidden
    ? "[无权限]"
    : target.isDeleted
      ? "[已删除]"
      : (target.snippet ?? target.id.slice(0, 8));

  return (
    <button
      data-testid="message-ref-chip"
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs relative",
        disabled
          ? "text-gray-400 line-through cursor-default"
          : "hover:bg-gray-100",
      )}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={() => !disabled && onNavigate?.(target.id)}
    >
      {target.avatarUrl && !disabled && (
        <img src={target.avatarUrl} className="h-4 w-4 rounded-full" alt="" />
      )}
      <span className="truncate max-w-[14rem]">{label}</span>
      {parentSource === "thread" && (
        <span
          aria-label="thread-derived"
          className="absolute -bottom-0.5 -right-0.5 text-[10px]"
        >
          🧵
        </span>
      )}
    </button>
  );
}
```

- [ ] **Step 3: Run + commit**

```bash
pnpm -C apps/client test -- MessageRefChip
git add apps/client/src/components/channel/properties/MessageRefChip.tsx \
        apps/client/src/components/channel/properties/__tests__/MessageRefChip.test.tsx
git commit -m "feat(client): MessageRefChip states (deleted / forbidden / thread)"
```

---

## Task 14: `MessageItem` chip bar for parent / children / related

**Goal:** Below the bubble body, render a one-line row of chips reflecting direct relations. Shows only when the message has any relation. Overflow collapses to `+N` with a popover for the full list.

**Files:**

- Modify: `apps/client/src/components/channel/MessageItem.tsx`
- Create: `apps/client/src/components/channel/MessageRelationBar.tsx`
- Create: `apps/client/src/components/channel/__tests__/MessageRelationBar.test.tsx`

**Acceptance Criteria:**

- [ ] `MessageRelationBar` receives `messageId` and fetches via `useMessageRelations`.
- [ ] Renders up to 3 chips per row (parent / children / related / relatedBy); surplus collapses to `+N` with a popover.
- [ ] No render when the message has zero relations.
- [ ] Thread-derived parent uses `MessageRefChip` with `parentSource='thread'` badge.
- [ ] MessageItem integrates the bar below content, above reactions/actions.

**Verify:** `pnpm -C apps/client test -- MessageRelationBar`.

**Steps:**

- [ ] **Step 1: Failing test**

```tsx
it("renders parent, children, related, relatedBy chips when present", async () => {
  vi.spyOn(api, "getMessageRelations").mockResolvedValue({
    outgoing: {
      parent: [
        {
          messageId: "p1",
          depth: 1,
          propertyDefinitionId: "d",
          parentSource: "relation",
        },
      ],
      related: [{ messageId: "r1", propertyDefinitionId: "d" }],
    },
    incoming: {
      children: [
        {
          messageId: "c1",
          depth: 1,
          propertyDefinitionId: "d",
          parentSource: "relation",
        },
      ],
      relatedBy: [{ messageId: "r2", propertyDefinitionId: "d" }],
    },
  });
  render(<MessageRelationBar messageId="m1" />, { wrapper });
  expect(await screen.findByText(/父/)).toBeInTheDocument();
  expect(screen.getByText(/子/)).toBeInTheDocument();
  expect(screen.getByText(/关联/)).toBeInTheDocument();
  expect(screen.getByText(/被关联/)).toBeInTheDocument();
});

it("renders nothing when all four buckets are empty", () => {
  /* ... */
});
it('collapses children past 3 into "+N" popover', async () => {
  /* ... */
});
```

- [ ] **Step 2: Implement**

```tsx
export function MessageRelationBar({ messageId }: { messageId: string }) {
  const { data } = useMessageRelations(messageId, 1);
  if (!data) return null;
  const empty =
    data.outgoing.parent.length === 0 &&
    data.outgoing.related.length === 0 &&
    data.incoming.children.length === 0 &&
    data.incoming.relatedBy.length === 0;
  if (empty) return null;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-600">
      {data.outgoing.parent.length > 0 && (
        <RelationRow label="↑ 父" items={data.outgoing.parent} sourceHint />
      )}
      {data.incoming.children.length > 0 && (
        <RelationRow label="↓ 子" items={data.incoming.children} />
      )}
      {data.outgoing.related.length > 0 && (
        <RelationRow label="↔ 关联" items={data.outgoing.related} />
      )}
      {data.incoming.relatedBy.length > 0 && (
        <RelationRow label="← 被关联" items={data.incoming.relatedBy} />
      )}
    </div>
  );
}

function RelationRow({
  label,
  items,
  sourceHint,
}: {
  label: string;
  items: Array<{ messageId: string; parentSource?: "relation" | "thread" }>;
  sourceHint?: boolean;
}) {
  const visible = items.slice(0, 3);
  const overflow = items.length - visible.length;
  return (
    <span className="inline-flex items-center gap-1">
      <span className="opacity-70">{label}:</span>
      {visible.map((it) => (
        <MessageRefChip
          key={it.messageId}
          target={{ id: it.messageId }}
          parentSource={sourceHint ? (it.parentSource ?? null) : null}
        />
      ))}
      {overflow > 0 && <OverflowPopover items={items.slice(3)} />}
    </span>
  );
}
```

`OverflowPopover` renders `+N` button that opens a small popover listing the remaining chips.

- [ ] **Step 3: Integrate into MessageItem**

Locate the existing reactions/footer area in `MessageItem.tsx`; insert `<MessageRelationBar messageId={message.id} />` just above it (grep for the className of the actions row).

- [ ] **Step 4: Run + commit**

```bash
pnpm -C apps/client test -- MessageRelationBar MessageItem
git add apps/client/src/components/channel/MessageRelationBar.tsx \
        apps/client/src/components/channel/MessageItem.tsx \
        apps/client/src/components/channel/__tests__/MessageRelationBar.test.tsx
git commit -m "feat(client): MessageItem chip bar for parent/children/related relations"
```

---

## Task 15: `TableView` hierarchy mode — toggle + toolbar controls

**Goal:** Add a user-visible toggle that enables hierarchy mode on a table view. The toggle is mutually exclusive with `groupBy`.

**Files:**

- Modify: `apps/client/src/components/channel/views/TableView.tsx`
- Create: `apps/client/src/components/channel/views/TableHierarchyToolbar.tsx`
- Create test for the toolbar.
- Modify: server view config DTO (gateway side) to persist `hierarchyMode` + `hierarchyDefaultDepth`.

**Acceptance Criteria:**

- [ ] Toolbar toggle "层级视图" persists to view config (`hierarchyMode: boolean`).
- [ ] When `hierarchyMode=true`, `groupBy` controls are disabled (vice versa).
- [ ] Default-depth selector (0–5, default 3) persists to `hierarchyDefaultDepth`.
- [ ] "展开全部 / 折叠全部" buttons fire callbacks (their effect is implemented in Task 17).
- [ ] View config update invalidates `view-tree` cache.

**Verify:** `pnpm -C apps/client test -- TableHierarchyToolbar` and `pnpm -C apps/server test -- views`.

**Steps:**

- [ ] **Step 1: Server-side DTO tweak**

In `apps/server/apps/gateway/src/im/views/dto/view-config.dto.ts` (or equivalent):

```ts
export class ViewConfigDto {
  // ... existing
  @IsOptional()
  @IsBoolean()
  hierarchyMode?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5)
  hierarchyDefaultDepth?: number;
}
```

Add validation: `if hierarchyMode, groupBy must be undefined`.

Spec test: reject `{ hierarchyMode: true, groupBy: 'x' }` with 400.

- [ ] **Step 2: Client toolbar**

```tsx
// TableHierarchyToolbar.tsx
export function TableHierarchyToolbar({
  config,
  onChange,
  onExpandAll,
  onCollapseAll,
}: Props) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <label className="inline-flex items-center gap-1">
        <input
          type="checkbox"
          checked={!!config.hierarchyMode}
          disabled={!!config.groupBy}
          onChange={(e) =>
            onChange({
              ...config,
              hierarchyMode: e.target.checked,
              groupBy: undefined,
            })
          }
        />{" "}
        层级视图
      </label>
      {config.hierarchyMode && (
        <>
          <label className="inline-flex items-center gap-1">
            展开深度:
            <select
              value={config.hierarchyDefaultDepth ?? 3}
              onChange={(e) =>
                onChange({
                  ...config,
                  hierarchyDefaultDepth: Number(e.target.value),
                })
              }
            >
              {[0, 1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button onClick={onExpandAll}>展开全部</button>
          <button onClick={onCollapseAll}>折叠全部</button>
        </>
      )}
    </div>
  );
}
```

Wire into `TableView.tsx`'s existing toolbar area. Reuse `updateView` mutation; on success, invalidate `view-tree` key.

- [ ] **Step 3: Tests**

```tsx
it("toggling hierarchy mode clears groupBy and persists config", async () => {
  /* ... */
});
it("disables groupBy picker when hierarchy active", async () => {
  /* ... */
});
```

Server spec:

```ts
it("rejects view config that enables hierarchyMode alongside groupBy", async () => {
  /* ... */
});
```

- [ ] **Step 4: Run + commit**

```bash
pnpm -C apps/server jest -- --testPathPattern='views.service.spec'
pnpm -C apps/client test -- TableHierarchyToolbar
git add apps/server/apps/gateway/src/im/views/dto/view-config.dto.ts \
        apps/server/apps/gateway/src/im/views/views.service.ts \
        apps/server/apps/gateway/src/im/views/views.service.spec.ts \
        apps/client/src/components/channel/views/TableView.tsx \
        apps/client/src/components/channel/views/TableHierarchyToolbar.tsx \
        apps/client/src/components/channel/views/__tests__/TableHierarchyToolbar.test.tsx
git commit -m "feat(views): hierarchy mode toggle + toolbar"
```

---

## Task 16: `TableView` rendering — indent, expand, ancestor-dim

**Goal:** When `hierarchyMode=true`, render rows indented by `depth`, with expand/collapse arrows, ancestor-only rows visually dimmed. Uses `useTreeLoader` (Task 17) as data source.

**Files:**

- Modify: `apps/client/src/components/channel/views/TableView.tsx`
- Modify: `apps/client/src/components/channel/views/TableRow.tsx` (extract if not already split)
- Test: `apps/client/src/components/channel/views/__tests__/TableHierarchy.test.tsx`

**Acceptance Criteria:**

- [ ] Row's first cell has `padding-left = depth * 16px`.
- [ ] Row with `hasChildren=true` shows ▸ when collapsed, ▾ when expanded; click toggles.
- [ ] Keyboard: `→` expands, `←` collapses a focused row.
- [ ] Ancestor rows (from `ancestorsIncluded`) render with `bg-gray-50` and left `border-l-2 border-gray-300`.
- [ ] Collapsed subtrees are hidden from DOM (not just CSS-hidden) to keep the rendered tree small.

**Verify:** `pnpm -C apps/client test -- TableHierarchy`.

**Steps:**

- [ ] **Step 1: Failing tests**

```tsx
it("indents rows by depth", () => {
  /* ... */
});
it("shows expand arrow only when hasChildren", () => {
  /* ... */
});
it("dims ancestor-only rows", () => {
  /* ... */
});
it("collapses a subtree when ▾ is clicked", async () => {
  /* ... */
});
it("keyboard arrow keys expand and collapse", async () => {
  /* ... */
});
```

- [ ] **Step 2: Implement**

```tsx
function HierarchyRow({
  node,
  expanded,
  onToggle,
  isAncestor,
  onKeyDown,
}: Props) {
  return (
    <tr
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={cn(isAncestor && "bg-gray-50 border-l-2 border-gray-300")}
    >
      <td style={{ paddingLeft: `${node.depth * 16 + 8}px` }}>
        {node.hasChildren ? (
          <button
            aria-label={expanded ? "collapse" : "expand"}
            onClick={() => onToggle(node.messageId)}
          >
            {expanded ? "▾" : "▸"}
          </button>
        ) : (
          <span className="inline-block w-4" />
        )}
        {renderPrimaryCell(node)}
      </td>
      {/* other cells */}
    </tr>
  );
}

function HierarchyTable({
  nodes,
  ancestorsIncluded,
  expandedSet,
  onToggle,
}: HProps) {
  const ancestorSet = useMemo(
    () => new Set(ancestorsIncluded),
    [ancestorsIncluded],
  );
  // Tree walk honouring expandedSet; collapsed branches are not rendered.
  const visibleNodes = useMemo(
    () => walkVisible(nodes, expandedSet),
    [nodes, expandedSet],
  );
  return (
    <table>
      {visibleNodes.map((n) => (
        <HierarchyRow
          key={n.messageId}
          node={n}
          expanded={expandedSet.has(n.messageId)}
          onToggle={onToggle}
          isAncestor={ancestorSet.has(n.messageId)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") onToggle(n.messageId, true);
            if (e.key === "ArrowLeft") onToggle(n.messageId, false);
          }}
        />
      ))}
    </table>
  );
}

function walkVisible(allNodes: TreeNode[], expanded: Set<string>): TreeNode[] {
  const byParent = new Map<string | null, TreeNode[]>();
  for (const n of allNodes) {
    const list = byParent.get(n.effectiveParentId) ?? [];
    list.push(n);
    byParent.set(n.effectiveParentId, list);
  }
  const out: TreeNode[] = [];
  const walk = (parentId: string | null) => {
    for (const n of byParent.get(parentId) ?? []) {
      out.push(n);
      if (expanded.has(n.messageId)) walk(n.messageId);
    }
  };
  walk(null);
  return out;
}
```

- [ ] **Step 3: Run + commit**

```bash
pnpm -C apps/client test -- TableHierarchy
git add apps/client/src/components/channel/views/TableView.tsx \
        apps/client/src/components/channel/views/TableRow.tsx \
        apps/client/src/components/channel/views/__tests__/TableHierarchy.test.tsx
git commit -m "feat(client): TableView hierarchy rendering (indent / expand / ancestor dim)"
```

---

## Task 17: `useTreeLoader` hook — initial fetch, expand, ws invalidation

**Goal:** Provide a single hook that drives the table hierarchy view: initial tree fetch, on-demand expand of a node, and local merge of returned nodes. Expands and WS invalidations are reflected in the same in-memory tree.

**Files:**

- Create: `apps/client/src/hooks/useTreeLoader.ts`
- Create: `apps/client/src/hooks/__tests__/useTreeLoader.test.tsx`
- Modify: `TableView.tsx` to consume this hook in place of the current loader.

**Acceptance Criteria:**

- [ ] Initial query: `getViewTree({ maxDepth: config.hierarchyDefaultDepth ?? 3, limit: 50 })`.
- [ ] `expand(nodeId)` fetches additional level for that node and merges nodes; sets `childrenLoaded=true` on the affected nodes.
- [ ] `loadMoreRoots()` fetches the next page of root-level nodes (cursor).
- [ ] On `message_relation_changed` for the current channel: re-fetch the changed source's subtree (single level).
- [ ] On `message_relations_purged`: re-fetch the whole tree.
- [ ] Returns `{ nodes, ancestorsIncluded, expand, collapse, loadMoreRoots, isLoading, expandedSet }`.

**Verify:** `pnpm -C apps/client test -- useTreeLoader`.

**Steps:**

- [ ] **Step 1: Failing tests**

```tsx
it("loads initial tree with default depth 3", async () => {
  /* vi.spyOn(api, 'getViewTree') */
});
it("expand merges one extra level for the given node", async () => {
  /* ... */
});
it("loadMoreRoots appends next cursor page", async () => {
  /* ... */
});
it("invalidates on message_relation_changed for same channel", async () => {
  /* ... */
});
```

- [ ] **Step 2: Implement**

```tsx
export function useTreeLoader(params: {
  channelId: string;
  viewId: string;
  filter?: unknown;
  sort?: unknown;
  defaultDepth: number;
}) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState<string | null>(null);
  const [extraExpands, setExtraExpands] = useState<string[]>([]);

  const { data, isLoading, refetch } = useQuery({
    queryKey: [
      ...relationKeys.viewTree(params.channelId, params.viewId),
      params.filter,
      params.sort,
      params.defaultDepth,
      cursor,
      extraExpands.join(","),
    ],
    queryFn: () =>
      getViewTree(params.channelId, params.viewId, {
        filter: params.filter,
        sort: params.sort,
        maxDepth: params.defaultDepth,
        limit: 50,
        cursor,
        expandedIds: extraExpands,
      }),
  });

  useEffect(() => {
    const offChange = ws.onRelationChanged((e) => {
      if (e.channelId !== params.channelId) return;
      refetch();
    });
    const offPurge = ws.onRelationsPurged((e) => {
      if (e.channelId !== params.channelId) return;
      refetch();
    });
    return () => {
      offChange();
      offPurge();
    };
  }, [params.channelId, refetch]);

  const expand = useCallback((nodeId: string) => {
    setExpanded((s) => new Set([...s, nodeId]));
    setExtraExpands((xs) => [...new Set([...xs, nodeId])]);
  }, []);
  const collapse = useCallback((nodeId: string) => {
    setExpanded((s) => {
      const n = new Set(s);
      n.delete(nodeId);
      return n;
    });
  }, []);
  const loadMoreRoots = useCallback(() => {
    if (data?.nextCursor) setCursor(data.nextCursor);
  }, [data?.nextCursor]);

  return {
    nodes: data?.nodes ?? [],
    ancestorsIncluded: data?.ancestorsIncluded ?? [],
    expand,
    collapse,
    loadMoreRoots,
    isLoading,
    expandedSet: expanded,
  };
}
```

- [ ] **Step 3: Integrate into `TableView`**

Replace current data source when `hierarchyMode` is on:

```tsx
const tree = useTreeLoader({
  channelId,
  viewId,
  filter: view.config.filters,
  sort: view.config.sorts,
  defaultDepth: view.config.hierarchyDefaultDepth ?? 3,
});
<HierarchyTable
  nodes={tree.nodes}
  ancestorsIncluded={tree.ancestorsIncluded}
  expandedSet={tree.expandedSet}
  onToggle={(id, force) =>
    force === false ? tree.collapse(id) : tree.expand(id)
  }
/>;
```

- [ ] **Step 4: Run + commit**

```bash
pnpm -C apps/client test -- useTreeLoader TableView
git add apps/client/src/hooks/useTreeLoader.ts \
        apps/client/src/hooks/__tests__/useTreeLoader.test.tsx \
        apps/client/src/components/channel/views/TableView.tsx
git commit -m "feat(client): useTreeLoader hook + hierarchy integration"
```

---

## Task 18: End-to-end manual smoke + regression sweep

**Goal:** Validate the feature works end-to-end across browser + backend + websocket. Not a coded test; this is a required verification task before marking the plan complete.

**Files:**

- Create: `docs/superpowers/plans/2026-04-21-message-parent-child.smoke.md` (checklist document; committed alongside)

**Acceptance Criteria:**

- [ ] Walk through the smoke checklist against `pnpm dev` (server + client running locally).
- [ ] All items pass or are documented as known issues in the smoke doc.

**Verify:** Human inspection; checklist all green.

**Steps:**

- [ ] **Step 1: Start local stack**

```bash
pnpm dev
```

- [ ] **Step 2: Write the smoke doc with these checks**

```md
# Smoke checklist — Message parent-child relations

- [ ] Property menu shows 父任务 / 关联任务 entries in a fresh channel.
- [ ] Creating 父任务 creates a single-cardinality, same-channel, parent definition.
- [ ] Attempting to create a second 父任务 shows the disabled tooltip.
- [ ] Setting a reply's parentMessage to its thread parent shows the 🧵 badge and no explicit override.
- [ ] Setting a reply's parentMessage to a different message overrides thread (chip shows no 🧵 badge).
- [ ] Clearing parentMessage sets explicitlyCleared; chat bar no longer shows parent.
- [ ] Table hierarchy mode indents children correctly; groupBy disabled while active.
- [ ] Ancestor auto-inclusion: filter to a grandchild, see grandparent as dim row.
- [ ] Expand arrow loads another level; child count matches server.
- [ ] Soft-deleting a parent message shows `[已删除]` placeholder in children's chip bar and table tree.
- [ ] WebSocket: change from another browser tab updates both chip bar and table without refresh.
- [ ] Cycle attempt (A→B, then B→A) shows error toast with `RELATION_CYCLE_DETECTED`.
- [ ] Cross-channel attempt blocked with `RELATION_SCOPE_VIOLATION`.
- [ ] Depth-10 chain passes; depth 11 rejected with `RELATION_DEPTH_EXCEEDED`.
```

- [ ] **Step 3: Commit smoke doc**

```bash
git add docs/superpowers/plans/2026-04-21-message-parent-child.smoke.md
git commit -m "docs(plans): smoke checklist for message parent-child"
```

---

## Self-Review Summary

**Spec coverage check:**

- [x] DB table + schema → Task 1
- [x] Property config extension → Tasks 2 + 7
- [x] Edge CRUD / scope / cardinality → Task 3
- [x] Cycle + depth → Task 4
- [x] Effective parent + subtree → Task 5
- [x] message-properties routing → Task 6
- [x] At-most-one parent def per channel → Task 7
- [x] Relation + tree endpoints → Task 8
- [x] WS events + cascade purge → Task 9
- [x] Client API + hooks + WS → Task 10
- [x] MessageRefPicker scope/self-excl → Task 11
- [x] PropertyPanel shortcuts → Task 12
- [x] MessageRefChip states → Task 13
- [x] MessageItem chip bar → Task 14
- [x] Hierarchy mode toggle → Task 15
- [x] Hierarchy rendering → Task 16
- [x] useTreeLoader + invalidation → Task 17
- [x] Smoke verification → Task 18

**Deliberately out of MVP (from spec non-goals):** AI auto-fill for parentMessage, closure-table optimization, move-to-thread API. Not in this plan.

**Explicitly left behind:** the `getRelationsInspection` backend method (used by Task 8 controller) is assembled from `MessageRelationsService.getOutgoingTargets` + `getIncomingSources` + `getEffectiveParent`. If the exploring subagent can't find it wired in the controller after Task 8, it must add a thin composition method in `message-properties.service.ts`.
