# Dedicated Routine Creation Channel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Phase 1 DM reuse for routine creation with a dedicated `routine-session` channel that surfaces only inside the Routines page as a "special run" entry, archives on completion, and hard-deletes on draft deletion.

**Architecture:** Add a new `routine-session` channel type (purpose stored in `propertySettings`). Backend exposes a new lazy materialization endpoint `POST /v1/routines/:id/start-creation-session`; the existing `with-creation-task` endpoint is refactored into a thin wrapper that calls `create + startCreationSession`. Frontend stops navigating to `/messages/:id` and instead expands the draft routine card and selects a synthetic creation run that renders the channel inside `ChatArea`.

**Tech Stack:** NestJS 11, Drizzle ORM (PostgreSQL 15+), Vitest (client), Jest (server), React 19, TanStack Router 1.141, TanStack React Query 5.90.

**Spec:** [`docs/superpowers/specs/2026-04-14-dedicated-routine-creation-channel-design.md`](../specs/2026-04-14-dedicated-routine-creation-channel-design.md)

---

## File Map

### Backend — created

- `apps/server/libs/database/migrations/0040_routine_session_channel_type.sql` — Postgres `ALTER TYPE channel_type ADD VALUE 'routine-session'`

### Backend — modified

- `apps/server/libs/database/src/schemas/im/channels.ts` — add `'routine-session'` to `channelTypeEnum`
- `apps/server/libs/database/migrations/meta/_journal.json` — drizzle journal entry for migration 0040
- `apps/server/libs/database/migrations/meta/0040_snapshot.json` — drizzle snapshot (auto-generated)
- `apps/server/apps/gateway/src/im/channels/channels.service.ts` — extend type union; add `createRoutineSessionChannel` and `hardDeleteRoutineSessionChannel`
- `apps/server/apps/gateway/src/im/channels/channels.service.spec.ts` — new tests for both methods
- `apps/server/apps/gateway/src/routines/routines.service.ts` — add `startCreationSession`; refactor `createWithCreationTask`; wire `completeCreation` archive and `delete` hard-delete
- `apps/server/apps/gateway/src/routines/routines.service.spec.ts` — new tests + reverse Phase 1 archive assertions
- `apps/server/apps/gateway/src/routines/routines.controller.ts` — add `POST /:id/start-creation-session`
- `apps/server/apps/gateway/src/routines/routines.controller.spec.ts` — new endpoint wiring test
- `apps/server/apps/gateway/src/routines/__tests__/routines-creation-flow.integration.spec.ts` — assert channel type/property settings, archive on complete, hard delete on delete

### Frontend — created

- `apps/client/src/components/routines/CreationSessionRunItem.tsx` — special run pseudo-item for the routine card runs list
- `apps/client/src/components/routines/__tests__/CreationSessionRunItem.test.tsx`

### Frontend — modified

- `apps/client/src/types/im.ts` — add `'routine-session'` to `ChannelType` union
- `apps/client/src/services/api/routines.ts` — add `startCreationSession(routineId)` client
- `apps/client/src/components/routines/RoutineList.tsx` — discriminated `selectedRun` state, `onOpenCreationSession` handler threaded down
- `apps/client/src/components/routines/RoutineCard.tsx` — accept `creationRunSelected` prop; render `CreationSessionRunItem` at the bottom of the runs list when applicable
- `apps/client/src/components/routines/ChatArea.tsx` — accept `creationMode` prop; channel id override; hide execution controls
- `apps/client/src/components/routines/DraftRoutineCard.tsx` — call `api.routines.startCreationSession` lazily; invoke `onOpenCreationSession`
- `apps/client/src/components/routines/AgenticAgentPicker.tsx` — stop calling `navigate`; call `onOpenCreationSession(newRoutineId)` after success
- `apps/client/src/components/routines/DraftRoutineBanner.tsx` — same change as DraftRoutineCard
- `apps/client/src/components/routines/__tests__/AgenticAgentPicker.test.tsx` — extend with new flow assertion
- `apps/client/src/hooks/__tests__/useChannels.test.ts` — assert `routine-session` excluded from grouped outputs (create file if missing)

---

## Task Dependency Graph

```
T1 (migration + enum) ─┬─→ T2 (createRoutineSessionChannel) ─→ T5 (startCreationSession)
                       └─→ T3 (hardDeleteRoutineSessionChannel) ─→ T7 (delete wiring)

T5 ─→ T6 (createWithCreationTask refactor) ─→ T8 (controller endpoint + integration)
T5 ─→ T7 (completeCreation archive wiring)

T8 ─→ T9 (frontend: ChannelType + api client)
T9 ─→ T10 (CreationSessionRunItem)
T10 ─→ T11 (RoutineList state refactor) ─→ T12 (RoutineCard render special run)
T11 ─→ T13 (ChatArea creation mode)
T11 ─→ T14 (DraftRoutineCard lazy create) ─→ T15 (DraftRoutineBanner same change)
T11 ─→ T16 (AgenticAgentPicker stop navigate)
```

T1 → T8 form a backend chain. T9 → T16 form a frontend chain. Backend can ship independently of frontend; frontend assumes backend deployed.

---

### Task 1: Add `routine-session` to channel type enum + migration

**Goal:** Land the schema change. Database, drizzle metadata, and TypeScript schema all carry the new enum value.

**Files:**

- Modify: `apps/server/libs/database/src/schemas/im/channels.ts:29-36`
- Create: `apps/server/libs/database/migrations/0040_routine_session_channel_type.sql`
- Modify: `apps/server/libs/database/migrations/meta/_journal.json` (drizzle auto-update)
- Create: `apps/server/libs/database/migrations/meta/0040_snapshot.json` (drizzle auto-generate)

**Acceptance Criteria:**

- [ ] `channelTypeEnum` array contains `'routine-session'` as the seventh value
- [ ] `pnpm db:generate` produces a migration file with `ALTER TYPE "channel_type" ADD VALUE 'routine-session'`
- [ ] `pnpm db:migrate` runs cleanly against the local dev database
- [ ] `psql -c "SELECT unnest(enum_range(NULL::channel_type))"` includes `routine-session`

**Verify:** `pnpm --filter @team9/database db:migrate && psql "$DATABASE_URL" -c "SELECT unnest(enum_range(NULL::channel_type));"` → output includes `routine-session`

**Steps:**

- [ ] **Step 1: Edit the drizzle enum**

```typescript
// apps/server/libs/database/src/schemas/im/channels.ts:29-36
export const channelTypeEnum = pgEnum("channel_type", [
  "direct",
  "public",
  "private",
  "task",
  "tracking",
  "echo",
  "routine-session",
]);
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm db:generate`
Expected: drizzle creates `0040_<name>.sql` and updates `meta/_journal.json`.

- [ ] **Step 3: Rename the generated file for clarity**

```bash
mv apps/server/libs/database/migrations/0040_*.sql \
   apps/server/libs/database/migrations/0040_routine_session_channel_type.sql
```

Update the corresponding `tag` in `meta/_journal.json` to `0040_routine_session_channel_type`.

- [ ] **Step 4: Inspect the SQL**

The file should contain (exact text may vary slightly):

```sql
ALTER TYPE "public"."channel_type" ADD VALUE 'routine-session';
```

If drizzle generates an `--> statement-breakpoint` separator before/after, leave it.

- [ ] **Step 5: Apply the migration**

Run: `pnpm db:migrate`
Expected: migration `0040_routine_session_channel_type` applied without error.

- [ ] **Step 6: Verify in Postgres**

Run: `psql "$DATABASE_URL" -c "SELECT unnest(enum_range(NULL::channel_type));"`
Expected: output contains `routine-session`.

- [ ] **Step 7: Commit**

```bash
git add apps/server/libs/database/src/schemas/im/channels.ts \
        apps/server/libs/database/migrations/0040_routine_session_channel_type.sql \
        apps/server/libs/database/migrations/meta/_journal.json \
        apps/server/libs/database/migrations/meta/0040_snapshot.json
git commit -m "feat(db): add routine-session channel type"
```

---

### Task 2: `ChannelsService.createRoutineSessionChannel`

**Goal:** Implement the channel-creation primitive used by every routine-session purpose. Stores `propertySettings.routineSession.{purpose,routineId}` and adds creator + bot user as members.

**Files:**

- Modify: `apps/server/apps/gateway/src/im/channels/channels.service.ts:43` (extend type union) and append the new method
- Modify: `apps/server/apps/gateway/src/im/channels/channels.service.spec.ts` — new `describe('createRoutineSessionChannel')` block

**Acceptance Criteria:**

- [ ] Method inserts an `im_channels` row with `type='routine-session'`, `name=null`, `created_by=creatorId`, `propertySettings.routineSession = { purpose, routineId }`, and the tenant id
- [ ] Both creator and bot user are added via `addMember(channelId, userId, 'member')`
- [ ] Returned object is the new channel row (matching `ChannelResponse`)
- [ ] Unit tests cover the happy path and assert exact insert + member calls

**Verify:** `pnpm --filter gateway test channels.service.spec.ts -t createRoutineSessionChannel` → all green

**Steps:**

- [ ] **Step 1: Extend the local type union**

```typescript
// apps/server/apps/gateway/src/im/channels/channels.service.ts:43
type ChannelTypeName =
  | "direct"
  | "public"
  | "private"
  | "task"
  | "tracking"
  | "echo"
  | "routine-session";
```

(If the existing union is inline as a parameter type rather than a named alias, edit it in place — there is exactly one occurrence at L43 in the current file.)

- [ ] **Step 2: Write the failing test**

Append to `channels.service.spec.ts` (use the existing `describe('ChannelsService', ...)` and `beforeEach` setup as the template):

```typescript
describe("createRoutineSessionChannel", () => {
  it("inserts a routine-session channel with purpose metadata and adds both members", async () => {
    const insertReturning = jest.fn<any>().mockResolvedValue([
      {
        id: "ch-1",
        type: "routine-session",
        tenantId: "tenant-1",
        createdBy: "user-1",
        propertySettings: {
          routineSession: { purpose: "creation", routineId: "routine-1" },
        },
      },
    ]);
    const insertValues = jest.fn<any>().mockReturnValue({
      returning: insertReturning,
    });
    db.insert.mockReturnValue({ values: insertValues } as any);

    const addMemberSpy = jest
      .spyOn(service, "addMember")
      .mockResolvedValue(undefined as any);

    const result = await service.createRoutineSessionChannel({
      creatorId: "user-1",
      botUserId: "bot-user-1",
      tenantId: "tenant-1",
      routineId: "routine-1",
      purpose: "creation",
    });

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "routine-session",
        tenantId: "tenant-1",
        createdBy: "user-1",
        name: null,
        propertySettings: {
          routineSession: { purpose: "creation", routineId: "routine-1" },
        },
      }),
    );
    expect(addMemberSpy).toHaveBeenCalledWith("ch-1", "user-1", "member");
    expect(addMemberSpy).toHaveBeenCalledWith("ch-1", "bot-user-1", "member");
    expect(result.id).toBe("ch-1");
  });
});
```

- [ ] **Step 3: Run the test, confirm it fails**

Run: `pnpm --filter gateway test channels.service.spec.ts -t createRoutineSessionChannel`
Expected: FAIL — `service.createRoutineSessionChannel is not a function`

- [ ] **Step 4: Implement the method**

Append to `channels.service.ts` (place after `createDirectChannelsBatch`, before `getOrCreateEchoChannel`):

```typescript
async createRoutineSessionChannel(params: {
  creatorId: string;
  botUserId: string;
  tenantId: string;
  routineId: string;
  purpose: 'creation';
}): Promise<ChannelResponse> {
  const { creatorId, botUserId, tenantId, routineId, purpose } = params;

  const [channel] = await this.db
    .insert(schema.channels)
    .values({
      id: uuidv7(),
      tenantId,
      type: 'routine-session',
      name: null,
      createdBy: creatorId,
      propertySettings: {
        routineSession: { purpose, routineId },
      },
    } as any)
    .returning();

  await this.addMember(channel.id, creatorId, 'member');
  await this.addMember(channel.id, botUserId, 'member');

  return channel;
}
```

- [ ] **Step 5: Run the test, confirm it passes**

Run: `pnpm --filter gateway test channels.service.spec.ts -t createRoutineSessionChannel`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/apps/gateway/src/im/channels/channels.service.ts \
        apps/server/apps/gateway/src/im/channels/channels.service.spec.ts
git commit -m "feat(channels): add createRoutineSessionChannel"
```

---

### Task 3: `ChannelsService.hardDeleteRoutineSessionChannel`

**Goal:** Hard delete a routine-session channel safely. Pre-cleans `im_audit_logs` rows (whose FK has no cascade) inside a single transaction.

**Files:**

- Modify: `apps/server/apps/gateway/src/im/channels/channels.service.ts` — append new method
- Modify: `apps/server/apps/gateway/src/im/channels/channels.service.spec.ts` — new `describe('hardDeleteRoutineSessionChannel')` block

**Acceptance Criteria:**

- [ ] Throws `NotFoundException` when the channel does not exist
- [ ] Throws `ForbiddenException` when the channel exists but `type !== 'routine-session'`
- [ ] Honors `tenantId` if provided (channel.tenantId mismatch → not found)
- [ ] Inside a single `db.transaction`, deletes from `im_audit_logs WHERE channel_id = $1`, then deletes the `im_channels` row
- [ ] Invalidates `REDIS_KEYS.CHANNEL_CACHE(channelId)` after the transaction commits

**Verify:** `pnpm --filter gateway test channels.service.spec.ts -t hardDeleteRoutineSessionChannel` → all green

**Steps:**

- [ ] **Step 1: Write the failing tests**

Append to `channels.service.spec.ts`:

```typescript
describe("hardDeleteRoutineSessionChannel", () => {
  function mockTransaction(deleteSpy: jest.Mock) {
    db.transaction = jest.fn(async (cb: any) => {
      return cb({
        delete: deleteSpy,
      });
    }) as any;
  }

  it("throws NotFoundException when channel missing", async () => {
    db.select.mockReturnValue({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve([]) }),
      }),
    } as any);

    await expect(
      service.hardDeleteRoutineSessionChannel("missing-id"),
    ).rejects.toThrow(NotFoundException);
  });

  it("throws ForbiddenException when channel is not routine-session", async () => {
    db.select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve([{ id: "ch-1", type: "direct", tenantId: "t-1" }]),
        }),
      }),
    } as any);

    await expect(
      service.hardDeleteRoutineSessionChannel("ch-1"),
    ).rejects.toThrow(ForbiddenException);
  });

  it("deletes audit logs and channel inside a transaction, then invalidates cache", async () => {
    db.select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve([
              { id: "ch-1", type: "routine-session", tenantId: "t-1" },
            ]),
        }),
      }),
    } as any);

    const auditDeleteWhere = jest.fn().mockResolvedValue(undefined);
    const channelsDeleteWhere = jest.fn().mockResolvedValue(undefined);
    const txDelete = jest.fn((table: any) => {
      const tableName = (table?.[Symbol.for("drizzle:Name")] as string) ?? "";
      if (tableName === "im_audit_logs") {
        return { where: auditDeleteWhere };
      }
      return { where: channelsDeleteWhere };
    });
    mockTransaction(txDelete);

    const invalidateSpy = jest.spyOn(redis, "invalidate");

    await service.hardDeleteRoutineSessionChannel("ch-1", "t-1");

    expect(auditDeleteWhere).toHaveBeenCalled();
    expect(channelsDeleteWhere).toHaveBeenCalled();
    expect(invalidateSpy).toHaveBeenCalledWith(
      REDIS_KEYS.CHANNEL_CACHE("ch-1"),
    );
  });

  it("rejects when tenantId provided does not match channel tenant", async () => {
    db.select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve([
              { id: "ch-1", type: "routine-session", tenantId: "other" },
            ]),
        }),
      }),
    } as any);

    await expect(
      service.hardDeleteRoutineSessionChannel("ch-1", "t-1"),
    ).rejects.toThrow(NotFoundException);
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail**

Run: `pnpm --filter gateway test channels.service.spec.ts -t hardDeleteRoutineSessionChannel`
Expected: FAIL — method does not exist.

- [ ] **Step 3: Implement the method**

Append to `channels.service.ts`:

```typescript
/**
 * Hard delete a routine-session channel.
 *
 * Cleans up audit log rows first (their FK has no cascade — see migration
 * notes), then deletes the channel inside a single transaction. The other
 * FKs (members, messages, search index, etc.) all use `onDelete: 'cascade'`
 * and are removed automatically by the channel delete.
 */
async hardDeleteRoutineSessionChannel(
  channelId: string,
  tenantId?: string,
): Promise<void> {
  const [channel] = await this.db
    .select({
      id: schema.channels.id,
      type: schema.channels.type,
      tenantId: schema.channels.tenantId,
    })
    .from(schema.channels)
    .where(eq(schema.channels.id, channelId))
    .limit(1);

  if (!channel) {
    throw new NotFoundException(
      `Channel ${channelId} not found`,
    );
  }
  if (tenantId && channel.tenantId !== tenantId) {
    throw new NotFoundException(
      `Channel ${channelId} not found in tenant ${tenantId}`,
    );
  }
  if (channel.type !== 'routine-session') {
    throw new ForbiddenException(
      `hardDeleteRoutineSessionChannel only allowed on routine-session channels (got ${channel.type})`,
    );
  }

  await this.db.transaction(async (tx) => {
    await tx
      .delete(schema.auditLogs)
      .where(eq(schema.auditLogs.channelId, channelId));
    await tx
      .delete(schema.channels)
      .where(eq(schema.channels.id, channelId));
  });

  await this.redis.invalidate(REDIS_KEYS.CHANNEL_CACHE(channelId));
}
```

- [ ] **Step 4: Run tests, confirm they pass**

Run: `pnpm --filter gateway test channels.service.spec.ts -t hardDeleteRoutineSessionChannel`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/apps/gateway/src/im/channels/channels.service.ts \
        apps/server/apps/gateway/src/im/channels/channels.service.spec.ts
git commit -m "feat(channels): add hardDeleteRoutineSessionChannel with audit cleanup"
```

---

### Task 4: `RoutinesService.startCreationSession` (lazy materialization)

**Goal:** New service method that materializes a creation channel + sends the kickoff event for an existing draft. Idempotent on `creationChannelId` already set.

**Files:**

- Modify: `apps/server/apps/gateway/src/routines/routines.service.ts` — append `startCreationSession`
- Modify: `apps/server/apps/gateway/src/routines/routines.service.spec.ts` — new `describe('startCreationSession')` block

**Acceptance Criteria:**

- [ ] Throws `NotFoundException` when routine missing or tenant mismatch
- [ ] Throws `ForbiddenException` when caller is not the creator
- [ ] Throws `BadRequestException` when status is not `'draft'`
- [ ] Throws `BadRequestException` when bound bot has no `managedMeta.agentId`
- [ ] When `creationChannelId` is already set: returns existing `{creationChannelId, creationSessionId}` without recreating channel or sending another kickoff event
- [ ] Otherwise: creates a `routine-session` channel, derives `sessionId = team9/{tenantId}/{agentId}/dm/{channelId}`, persists both ids on the routine, sends `team9:routine-creation.start` via `clawHive.sendInput`
- [ ] On any failure after channel insert: hard-deletes the new channel before rethrowing; routine row is left untouched

**Verify:** `pnpm --filter gateway test routines.service.spec.ts -t startCreationSession` → all green

**Steps:**

- [ ] **Step 1: Write the failing tests**

Append to `routines.service.spec.ts` (use the existing test setup that already provides `service`, `db`, `channelsService`, `botsService`, `clawHiveService` mocks):

```typescript
describe("startCreationSession", () => {
  const ROUTINE_ID = "routine-1";
  const USER_ID = "user-1";
  const TENANT_ID = "tenant-1";
  const BOT_ID = "bot-1";
  const BOT_USER_ID = "bot-user-1";
  const AGENT_ID = "agent-1";
  const CHANNEL_ID = "channel-1";

  function mockGetRoutine(overrides: Partial<schema.Routine> = {}) {
    const routine = {
      id: ROUTINE_ID,
      tenantId: TENANT_ID,
      creatorId: USER_ID,
      botId: BOT_ID,
      status: "draft" as const,
      title: "Test",
      creationChannelId: null,
      creationSessionId: null,
      ...overrides,
    } as schema.Routine;
    db.select.mockReturnValueOnce({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([routine]),
        }),
      }),
    } as any);
    return routine;
  }

  beforeEach(() => {
    botsService.getBotById = jest.fn().mockResolvedValue({
      id: BOT_ID,
      userId: BOT_USER_ID,
      managedMeta: { agentId: AGENT_ID },
    });
    channelsService.createRoutineSessionChannel = jest
      .fn()
      .mockResolvedValue({ id: CHANNEL_ID });
    channelsService.hardDeleteRoutineSessionChannel = jest
      .fn()
      .mockResolvedValue(undefined);
    clawHiveService.sendInput = jest.fn().mockResolvedValue(undefined);
    db.update = jest.fn().mockReturnValue({
      set: () => ({ where: () => Promise.resolve(undefined) }),
    });
  });

  it("creates channel, derives session id, persists, and sends kickoff event", async () => {
    mockGetRoutine();

    const result = await service.startCreationSession(
      ROUTINE_ID,
      USER_ID,
      TENANT_ID,
    );

    expect(channelsService.createRoutineSessionChannel).toHaveBeenCalledWith({
      creatorId: USER_ID,
      botUserId: BOT_USER_ID,
      tenantId: TENANT_ID,
      routineId: ROUTINE_ID,
      purpose: "creation",
    });
    expect(result.creationChannelId).toBe(CHANNEL_ID);
    expect(result.creationSessionId).toBe(
      `team9/${TENANT_ID}/${AGENT_ID}/dm/${CHANNEL_ID}`,
    );
    expect(clawHiveService.sendInput).toHaveBeenCalledWith(
      result.creationSessionId,
      expect.objectContaining({
        type: "team9:routine-creation.start",
        payload: expect.objectContaining({
          routineId: ROUTINE_ID,
          creatorUserId: USER_ID,
          tenantId: TENANT_ID,
        }),
      }),
      TENANT_ID,
    );
  });

  it("is idempotent when creationChannelId already set", async () => {
    mockGetRoutine({
      creationChannelId: "existing-channel",
      creationSessionId: "existing-session",
    });

    const result = await service.startCreationSession(
      ROUTINE_ID,
      USER_ID,
      TENANT_ID,
    );

    expect(channelsService.createRoutineSessionChannel).not.toHaveBeenCalled();
    expect(clawHiveService.sendInput).not.toHaveBeenCalled();
    expect(result).toEqual({
      creationChannelId: "existing-channel",
      creationSessionId: "existing-session",
    });
  });

  it("rejects non-draft routines with BadRequestException", async () => {
    mockGetRoutine({ status: "upcoming" });
    await expect(
      service.startCreationSession(ROUTINE_ID, USER_ID, TENANT_ID),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects non-creator with ForbiddenException", async () => {
    mockGetRoutine({ creatorId: "someone-else" });
    await expect(
      service.startCreationSession(ROUTINE_ID, USER_ID, TENANT_ID),
    ).rejects.toThrow(ForbiddenException);
  });

  it("rejects bots without managedMeta.agentId", async () => {
    mockGetRoutine();
    botsService.getBotById = jest.fn().mockResolvedValue({
      id: BOT_ID,
      userId: BOT_USER_ID,
      managedMeta: null,
    });
    await expect(
      service.startCreationSession(ROUTINE_ID, USER_ID, TENANT_ID),
    ).rejects.toThrow(BadRequestException);
  });

  it("rolls back the channel when sendInput fails", async () => {
    mockGetRoutine();
    clawHiveService.sendInput = jest
      .fn()
      .mockRejectedValue(new Error("hive down"));

    await expect(
      service.startCreationSession(ROUTINE_ID, USER_ID, TENANT_ID),
    ).rejects.toThrow("hive down");
    expect(
      channelsService.hardDeleteRoutineSessionChannel,
    ).toHaveBeenCalledWith(CHANNEL_ID, TENANT_ID);
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail**

Run: `pnpm --filter gateway test routines.service.spec.ts -t startCreationSession`
Expected: FAIL — method missing.

- [ ] **Step 3: Implement the method**

Append to `routines.service.ts` after `createWithCreationTask` (will be refactored next task to call this):

```typescript
async startCreationSession(
  routineId: string,
  userId: string,
  tenantId: string,
): Promise<{ creationChannelId: string; creationSessionId: string }> {
  const routine = await this.getRoutineOrThrow(routineId, tenantId);
  this.assertCreatorOwnership(routine, userId);

  if (routine.status !== 'draft') {
    throw new BadRequestException(
      `Cannot start creation session for routine in '${routine.status}' status`,
    );
  }

  if (routine.creationChannelId && routine.creationSessionId) {
    return {
      creationChannelId: routine.creationChannelId,
      creationSessionId: routine.creationSessionId,
    };
  }

  if (!routine.botId) {
    throw new BadRequestException(
      'Draft routine has no botId — cannot start creation session',
    );
  }
  const bot = await this.botsService.getBotById(routine.botId);
  if (!bot) {
    throw new BadRequestException(
      'The executing agent no longer exists. Reassign or delete this draft.',
    );
  }
  const agentId = (bot.managedMeta as Record<string, unknown> | null)
    ?.agentId as string | undefined;
  if (!agentId) {
    throw new BadRequestException(
      'Bot is not a managed hive agent (no agentId in managedMeta)',
    );
  }

  const channel = await this.channelsService.createRoutineSessionChannel({
    creatorId: userId,
    botUserId: bot.userId,
    tenantId,
    routineId,
    purpose: 'creation',
  });

  try {
    const sessionId = `team9/${tenantId}/${agentId}/dm/${channel.id}`;

    await this.db
      .update(schema.routines)
      .set({
        creationChannelId: channel.id,
        creationSessionId: sessionId,
        updatedAt: new Date(),
      } as Record<string, unknown>)
      .where(eq(schema.routines.id, routineId));

    await this.clawHiveService.sendInput(
      sessionId,
      {
        type: 'team9:routine-creation.start',
        source: 'team9',
        timestamp: new Date().toISOString(),
        payload: {
          routineId,
          creatorUserId: userId,
          tenantId,
          title: routine.title,
        },
      },
      tenantId,
    );

    return { creationChannelId: channel.id, creationSessionId: sessionId };
  } catch (error) {
    try {
      await this.channelsService.hardDeleteRoutineSessionChannel(
        channel.id,
        tenantId,
      );
    } catch (cleanupError) {
      this.logger.error(
        `startCreationSession: failed to roll back channel ${channel.id}: ${cleanupError}`,
      );
    }
    throw error;
  }
}
```

- [ ] **Step 4: Run tests, confirm they pass**

Run: `pnpm --filter gateway test routines.service.spec.ts -t startCreationSession`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/apps/gateway/src/routines/routines.service.ts \
        apps/server/apps/gateway/src/routines/routines.service.spec.ts
git commit -m "feat(routines): add startCreationSession lazy materializer"
```

---

### Task 5: Refactor `createWithCreationTask` to compose `create + startCreationSession`

**Goal:** Single source of truth for "build channel + send kickoff event + persist ids". The compound endpoint exists only as a convenience for AgenticAgentPicker.

**Files:**

- Modify: `apps/server/apps/gateway/src/routines/routines.service.ts:849-992` — replace body
- Modify: `apps/server/apps/gateway/src/routines/routines.service.spec.ts` — swap inner assertion (`createDirectChannel` → `createRoutineSessionChannel`) and verify it now delegates to `startCreationSession`

**Acceptance Criteria:**

- [ ] No call to `createDirectChannel` anywhere in `routines.service.ts`
- [ ] Method validates bot/tenant/draft-conflict pre-flight, then calls `this.create(...)`, then calls `this.startCreationSession(draft.id, userId, tenantId)`
- [ ] If `startCreationSession` throws, the draft routine row is rolled back (matches existing rollback semantics)
- [ ] Response shape unchanged: `{ routineId, creationChannelId, creationSessionId }`
- [ ] Existing `createWithCreationTask` tests pass after asserting on the new collaborator chain

**Verify:** `pnpm --filter gateway test routines.service.spec.ts -t createWithCreationTask` → all green

**Steps:**

- [ ] **Step 1: Update existing tests to reflect refactor**

Edit `routines.service.spec.ts` `describe('createWithCreationTask')`:

- Replace any assertion `expect(channelsService.createDirectChannel).toHaveBeenCalled...` with `expect(channelsService.createRoutineSessionChannel).toHaveBeenCalledWith(...)` (or assert a spy on `service.startCreationSession`)
- Add a new assertion: `const startSpy = jest.spyOn(service, 'startCreationSession').mockResolvedValue({ creationChannelId, creationSessionId }); ... expect(startSpy).toHaveBeenCalledWith(draftId, userId, tenantId);`
- Keep the rollback test, but assert that on `startCreationSession` rejection the draft row delete is invoked

- [ ] **Step 2: Run tests, confirm they fail**

Run: `pnpm --filter gateway test routines.service.spec.ts -t createWithCreationTask`
Expected: FAIL — old behavior still calls `createDirectChannel`.

- [ ] **Step 3: Replace the method body**

Replace `createWithCreationTask` body in `routines.service.ts` (the entire method block at L849-992) with:

```typescript
async createWithCreationTask(
  dto: CreateWithCreationTaskDto,
  userId: string,
  tenantId: string,
): Promise<{
  routineId: string;
  creationChannelId: string;
  creationSessionId: string;
}> {
  // Step 1: validate source bot exists
  const sourceBot = await this.botsService.getBotById(dto.agentId);
  if (!sourceBot) {
    throw new NotFoundException(`Bot not found: ${dto.agentId}`);
  }

  // Step 2: validate bot belongs to tenant via bots JOIN installed_applications
  const [botTenantRow] = await this.db
    .select({ tenantId: schema.installedApplications.tenantId })
    .from(schema.bots)
    .leftJoin(
      schema.installedApplications,
      eq(schema.bots.installedApplicationId, schema.installedApplications.id),
    )
    .where(eq(schema.bots.id, dto.agentId))
    .limit(1);
  if (!botTenantRow || botTenantRow.tenantId !== tenantId) {
    throw new BadRequestException(
      'Bot does not belong to the current tenant',
    );
  }

  // Step 3: validate managedMeta.agentId exists (early fail)
  const agentId = (sourceBot.managedMeta as Record<string, unknown> | null)
    ?.agentId as string | undefined;
  if (!agentId) {
    throw new BadRequestException(
      'Bot is not a managed hive agent (no agentId in managedMeta)',
    );
  }

  // Step 4: auto title (count existing routines)
  const [countRow] = await this.db
    .select({ count: sql<number>`count(*)` })
    .from(schema.routines)
    .where(eq(schema.routines.tenantId, tenantId));
  const count = Number(countRow?.count ?? 0);
  const title = `Routine #${count + 1}`;

  // Step 5: prevent two in-progress drafts with the same bot
  const [existingDraft] = await this.db
    .select({ id: schema.routines.id })
    .from(schema.routines)
    .where(
      and(
        eq(schema.routines.botId, dto.agentId),
        eq(schema.routines.creatorId, userId),
        eq(schema.routines.status, 'draft'),
        sql`${schema.routines.creationSessionId} IS NOT NULL`,
      ),
    )
    .limit(1);
  if (existingDraft) {
    throw new BadRequestException(
      'You already have a draft routine being created with this agent. Complete or delete it first.',
    );
  }

  // Step 6: create draft routine
  const draft = await this.create(
    { title, botId: dto.agentId, status: 'draft' },
    userId,
    tenantId,
  );

  // Step 7: materialize creation session (channel + event + persist)
  try {
    const session = await this.startCreationSession(draft.id, userId, tenantId);
    return {
      routineId: draft.id,
      creationChannelId: session.creationChannelId,
      creationSessionId: session.creationSessionId,
    };
  } catch (error) {
    // Rollback the draft row. The draft document is intentionally not deleted.
    try {
      await this.db
        .delete(schema.routines)
        .where(eq(schema.routines.id, draft.id));
    } catch (rollbackErr) {
      this.logger.error(
        `createWithCreationTask: failed to roll back draft ${draft.id}: ${rollbackErr}`,
      );
    }
    throw error;
  }
}
```

- [ ] **Step 4: Run tests, confirm they pass**

Run: `pnpm --filter gateway test routines.service.spec.ts -t createWithCreationTask`
Expected: PASS.

- [ ] **Step 5: Run the full routines + channels test files**

Run: `pnpm --filter gateway test routines.service.spec.ts channels.service.spec.ts`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add apps/server/apps/gateway/src/routines/routines.service.ts \
        apps/server/apps/gateway/src/routines/routines.service.spec.ts
git commit -m "refactor(routines): createWithCreationTask delegates to startCreationSession"
```

---

### Task 6: Wire `completeCreation` to archive + `delete` to hard-delete

**Goal:** Reverse the Phase 1 decision that left `archiveCreationChannel` orphaned. Wire both lifecycle terminations.

**Files:**

- Modify: `apps/server/apps/gateway/src/routines/routines.service.ts:278-309` (delete) and `:764-845` (completeCreation)
- Modify: `apps/server/apps/gateway/src/routines/routines.service.spec.ts` — reverse Phase 1 negation assertions

**Acceptance Criteria:**

- [ ] `completeCreation` calls `channelsService.archiveCreationChannel(routine.creationChannelId, tenantId)` after the status update succeeds, only when `creationChannelId` is set
- [ ] `archiveCreationChannel` failure is caught and logged as warning (non-fatal; status transition stays committed)
- [ ] `delete` calls `channelsService.hardDeleteRoutineSessionChannel(routine.creationChannelId, tenantId)` before deleting the routine row, only when `creationChannelId` is set
- [ ] `hardDeleteRoutineSessionChannel` failure is caught and logged; routine deletion still proceeds
- [ ] Old test assertions `expect(archiveCreationChannel).not.toHaveBeenCalled()` are reversed to `.toHaveBeenCalled...`

**Verify:** `pnpm --filter gateway test routines.service.spec.ts -t completeCreation routines.service.spec.ts -t 'delete'` → green

**Steps:**

- [ ] **Step 1: Update spec assertions**

In `routines.service.spec.ts`, find every occurrence of:

```typescript
expect(channelsService.archiveCreationChannel).not.toHaveBeenCalled();
```

and replace with the appropriate positive assertion. There are 4 known occurrences listed by Grep at lines 1796, 1811, 1864, 1982. Each lives inside a different test:

- The `completeCreation` happy-path test → expect called with `(routine.creationChannelId, tenantId)`
- The `completeCreation` "no creationChannelId" test → keep negative (channel id is null)
- Add a new test case: `delete` with `creationChannelId` set should call `hardDeleteRoutineSessionChannel(channelId, tenantId)`
- Add another: `delete` without `creationChannelId` should NOT call `hardDeleteRoutineSessionChannel`

Example for the happy-path completeCreation:

```typescript
it("archives the creation channel after transitioning to upcoming", async () => {
  // ...existing setup that produces a draft routine with creationChannelId='ch-1'...
  channelsService.archiveCreationChannel = jest
    .fn()
    .mockResolvedValue(undefined);

  await service.completeCreation(routineId, dto, userId, tenantId);

  expect(channelsService.archiveCreationChannel).toHaveBeenCalledWith(
    "ch-1",
    tenantId,
  );
});

it("logs but does not throw when archiveCreationChannel fails", async () => {
  // ...same setup...
  channelsService.archiveCreationChannel = jest
    .fn()
    .mockRejectedValue(new Error("disk full"));

  const result = await service.completeCreation(
    routineId,
    dto,
    userId,
    tenantId,
  );

  expect(result.status).toBe("upcoming");
});
```

Example for delete:

```typescript
it("hard-deletes the creation channel when deleting a draft with a session", async () => {
  // ...setup draft routine with creationChannelId='ch-1'...
  channelsService.hardDeleteRoutineSessionChannel = jest
    .fn()
    .mockResolvedValue(undefined);

  await service.delete(routineId, userId, tenantId);

  expect(channelsService.hardDeleteRoutineSessionChannel).toHaveBeenCalledWith(
    "ch-1",
    tenantId,
  );
});

it("does not call hardDeleteRoutineSessionChannel when creationChannelId is null", async () => {
  // ...setup draft routine with creationChannelId=null...
  channelsService.hardDeleteRoutineSessionChannel = jest.fn();

  await service.delete(routineId, userId, tenantId);

  expect(
    channelsService.hardDeleteRoutineSessionChannel,
  ).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run, confirm tests fail**

Run: `pnpm --filter gateway test routines.service.spec.ts -t completeCreation`
Expected: FAIL — service does not yet call `archiveCreationChannel`.

- [ ] **Step 3: Wire `completeCreation`**

Append after line 837 (after `.returning()` of the status update) in `routines.service.ts`:

```typescript
// Step 7a: archive the creation channel (best-effort, non-fatal)
if (routine.creationChannelId) {
  try {
    await this.channelsService.archiveCreationChannel(
      routine.creationChannelId,
      tenantId,
    );
  } catch (e) {
    this.logger.warn(
      `completeCreation: failed to archive creation channel ${routine.creationChannelId} for routine ${routineId}: ${e}`,
    );
  }
}
```

- [ ] **Step 4: Wire `delete`**

In the draft branch of `delete` (currently at L283-289), and also in the non-draft branch (L304-306), wrap with the hard-delete attempt. Replace the entire `delete` method body with:

```typescript
async delete(routineId: string, userId: string, tenantId: string) {
  const routine = await this.getRoutineOrThrow(routineId, tenantId);
  this.assertCreatorOwnership(routine, userId);

  if ((routine.status as string) === 'draft') {
    this.logger.debug(`Deleting draft routine ${routineId}`);
    if (routine.creationChannelId) {
      try {
        await this.channelsService.hardDeleteRoutineSessionChannel(
          routine.creationChannelId,
          tenantId,
        );
      } catch (e) {
        this.logger.warn(
          `delete: failed to hard-delete creation channel ${routine.creationChannelId} for routine ${routineId}: ${e}`,
        );
      }
    }
    await this.db
      .delete(schema.routines)
      .where(eq(schema.routines.id, routineId));
    return { success: true };
  }

  const activeStatuses: string[] = ['in_progress', 'paused', 'pending_action'];
  if (activeStatuses.includes(routine.status)) {
    throw new BadRequestException(
      `Cannot delete routine in ${routine.status} status. Stop the routine first.`,
    );
  }

  // Non-draft routine: archived creation channel may still be linked. We
  // do NOT hard-delete because the channel is part of the audit trail for
  // the (now upcoming/completed) routine. The FK is set null on routine
  // delete so the channel row simply loses its back-reference.
  await this.db
    .delete(schema.routines)
    .where(eq(schema.routines.id, routineId));

  return { success: true };
}
```

- [ ] **Step 5: Run tests, confirm they pass**

Run: `pnpm --filter gateway test routines.service.spec.ts -t completeCreation routines.service.spec.ts -t 'delete'`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/apps/gateway/src/routines/routines.service.ts \
        apps/server/apps/gateway/src/routines/routines.service.spec.ts
git commit -m "feat(routines): archive on completeCreation, hard-delete on draft delete"
```

---

### Task 7: Add `POST /v1/routines/:id/start-creation-session` controller endpoint

**Goal:** Expose `startCreationSession` over HTTP for the frontend lazy path.

**Files:**

- Modify: `apps/server/apps/gateway/src/routines/routines.controller.ts` — new method, declared **before** any `@Get(':id')` / `@Patch(':id')` to avoid route shadowing
- Modify: `apps/server/apps/gateway/src/routines/routines.controller.spec.ts` — wiring test

**Acceptance Criteria:**

- [ ] Endpoint matches `POST /v1/routines/:id/start-creation-session`
- [ ] Wrapped in `JwtAuthGuard` (the controller-level `@UseGuards(AuthGuard)` already handles this)
- [ ] Returns the service result directly
- [ ] `id` parameter validated by `ParseUUIDPipe`

**Verify:** `pnpm --filter gateway test routines.controller.spec.ts -t start-creation-session` → green

**Steps:**

- [ ] **Step 1: Write the controller test**

Append to `routines.controller.spec.ts` inside the existing controller describe:

```typescript
describe("POST :id/start-creation-session", () => {
  it("delegates to RoutinesService.startCreationSession", async () => {
    const expected = {
      creationChannelId: "ch-1",
      creationSessionId: "team9/t/a/dm/ch-1",
    };
    routinesService.startCreationSession = jest
      .fn()
      .mockResolvedValue(expected);

    const result = await controller.startCreationSession(
      "routine-1",
      "user-1",
      "tenant-1",
    );

    expect(routinesService.startCreationSession).toHaveBeenCalledWith(
      "routine-1",
      "user-1",
      "tenant-1",
    );
    expect(result).toEqual(expected);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `pnpm --filter gateway test routines.controller.spec.ts -t start-creation-session`
Expected: FAIL — controller method missing.

- [ ] **Step 3: Add the controller method**

In `routines.controller.ts`, place the new handler **immediately after** `createWithCreationTask` (around L65) so it sits with the other `:id`-pattern POSTs and before any wildcard routes:

```typescript
@Post(':id/start-creation-session')
async startCreationSession(
  @Param('id', ParseUUIDPipe) id: string,
  @CurrentUser('sub') userId: string,
  @CurrentTenantId() tenantId: string,
) {
  return this.routinesService.startCreationSession(id, userId, tenantId);
}
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `pnpm --filter gateway test routines.controller.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/apps/gateway/src/routines/routines.controller.ts \
        apps/server/apps/gateway/src/routines/routines.controller.spec.ts
git commit -m "feat(routines): add POST /:id/start-creation-session endpoint"
```

---

### Task 8: Backend integration tests

**Goal:** End-to-end coverage of the new flows against an in-memory mocked DB (matching the existing `routines-creation-flow.integration.spec.ts` pattern).

**Files:**

- Modify: `apps/server/apps/gateway/src/routines/__tests__/routines-creation-flow.integration.spec.ts`

**Acceptance Criteria:**

- [ ] `with-creation-task` integration test asserts the inserted channel has `type='routine-session'` and `propertySettings.routineSession = { purpose: 'creation', routineId }`
- [ ] New test: `start-creation-session` from a draft with `creationChannelId=null` produces a routine-session channel + sends the kickoff event + persists ids
- [ ] New test: `complete-creation` calls `archiveCreationChannel(channelId)` (using existing channel mock spy)
- [ ] New test: `delete` of a draft with `creationChannelId` calls `hardDeleteRoutineSessionChannel(channelId, tenantId)`

**Verify:** `pnpm --filter gateway test routines-creation-flow.integration.spec.ts` → all green

**Steps:**

- [ ] **Step 1: Update existing `with-creation-task` test**

In the existing integration test, locate the assertion that inspects the channel insert call (the test currently expects `createDirectChannel`). Replace it with:

```typescript
expect(channelsService.createRoutineSessionChannel).toHaveBeenCalledWith(
  expect.objectContaining({
    purpose: "creation",
    routineId: expect.any(String),
    tenantId: TENANT_ID,
  }),
);
```

- [ ] **Step 2: Add `start-creation-session` integration test**

```typescript
describe("POST /:id/start-creation-session", () => {
  it("materializes a routine-session channel for an existing draft", async () => {
    // Seed: a draft routine with creationChannelId=null
    db.select.mockReturnValueOnce({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve([
              {
                id: "r-1",
                tenantId: TENANT_ID,
                creatorId: USER_ID,
                botId: BOT_ID,
                status: "draft",
                title: "Test",
                creationChannelId: null,
                creationSessionId: null,
              },
            ]),
        }),
      }),
    } as any);

    channelsService.createRoutineSessionChannel.mockResolvedValueOnce({
      id: "ch-1",
    });

    const result = await routinesService.startCreationSession(
      "r-1",
      USER_ID,
      TENANT_ID,
    );

    expect(result.creationChannelId).toBe("ch-1");
    expect(clawHiveService.sendInput).toHaveBeenCalledWith(
      result.creationSessionId,
      expect.objectContaining({ type: "team9:routine-creation.start" }),
      TENANT_ID,
    );
  });
});
```

- [ ] **Step 3: Add complete + delete integration tests**

```typescript
it("complete-creation archives the creation channel", async () => {
  // Seed routine with creationChannelId='ch-1', status='draft'
  // ... existing pattern from completeCreation tests ...
  await routinesService.completeCreation(
    "r-1",
    { notes: "" },
    USER_ID,
    TENANT_ID,
  );

  expect(channelsService.archiveCreationChannel).toHaveBeenCalledWith(
    "ch-1",
    TENANT_ID,
  );
});

it("delete on a draft hard-deletes the creation channel", async () => {
  // Seed draft routine with creationChannelId='ch-1'
  await routinesService.delete("r-1", USER_ID, TENANT_ID);

  expect(channelsService.hardDeleteRoutineSessionChannel).toHaveBeenCalledWith(
    "ch-1",
    TENANT_ID,
  );
});
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter gateway test routines-creation-flow.integration.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/apps/gateway/src/routines/__tests__/routines-creation-flow.integration.spec.ts
git commit -m "test(routines): integration coverage for routine-session channel flows"
```

---

### Task 9: Frontend `ChannelType` union + `api.routines.startCreationSession` client

**Goal:** Wire the new type and API method on the frontend, no UI behavior change yet.

**Files:**

- Modify: `apps/client/src/types/im.ts:3-9` — extend the `ChannelType` union
- Modify: `apps/client/src/services/api/routines.ts:177-202` — add `startCreationSession`
- Create or modify: `apps/client/src/hooks/__tests__/useChannels.test.ts` — assert `routine-session` channels are excluded from grouped outputs

**Acceptance Criteria:**

- [ ] `ChannelType` includes `'routine-session'`
- [ ] `api.routines.startCreationSession(routineId)` posts to `/v1/routines/:id/start-creation-session` and returns `{ creationChannelId, creationSessionId }`
- [ ] Test asserts `useChannelsByType` excludes a `routine-session` channel from `directChannels`, `publicChannels`, `privateChannels`, `allDirectChannels`

**Verify:** `pnpm --filter client test src/hooks/__tests__/useChannels.test.ts -t routine-session` → green

**Steps:**

- [ ] **Step 1: Edit the type union**

```typescript
// apps/client/src/types/im.ts:3-9
export type ChannelType =
  | "direct"
  | "public"
  | "private"
  | "task"
  | "tracking"
  | "echo"
  | "routine-session";
```

- [ ] **Step 2: Add the API client method**

Append inside the `routinesApi` object in `apps/client/src/services/api/routines.ts` (place after `completeCreation`):

```typescript
startCreationSession: async (
  routineId: string,
): Promise<{
  creationChannelId: string;
  creationSessionId: string;
}> => {
  const response = await http.post<{
    creationChannelId: string;
    creationSessionId: string;
  }>(`/v1/routines/${routineId}/start-creation-session`);
  return response.data;
},
```

Also re-export from `api.routines` aggregate if applicable (mirror the existing `createWithCreationTask` export pattern).

- [ ] **Step 3: Write the useChannels test**

If `apps/client/src/hooks/__tests__/useChannels.test.ts` does not exist, create it:

```typescript
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(),
}));

import { useQuery } from "@tanstack/react-query";
import { useChannelsByType } from "@/hooks/useChannels";

describe("useChannelsByType", () => {
  it("excludes routine-session channels from every grouped output", () => {
    (useQuery as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [
        {
          id: "ch-rs",
          type: "routine-session",
          isArchived: false,
          showInDmSidebar: true,
        },
        {
          id: "ch-direct",
          type: "direct",
          isArchived: false,
          showInDmSidebar: true,
        },
      ],
      isLoading: false,
    });

    const { result } = renderHook(() => useChannelsByType());

    expect(
      result.current.directChannels.find((c) => c.id === "ch-rs"),
    ).toBeUndefined();
    expect(
      result.current.publicChannels.find((c) => c.id === "ch-rs"),
    ).toBeUndefined();
    expect(
      result.current.privateChannels.find((c) => c.id === "ch-rs"),
    ).toBeUndefined();
    expect(
      result.current.allDirectChannels.find((c) => c.id === "ch-rs"),
    ).toBeUndefined();
    // sanity: regular direct channel still appears
    expect(
      result.current.directChannels.find((c) => c.id === "ch-direct"),
    ).toBeDefined();
  });
});
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `pnpm --filter client test src/hooks/__tests__/useChannels.test.ts -t routine-session`
Expected: PASS — the type is excluded by the existing filter rules without any code change.

- [ ] **Step 5: Run typecheck on touched files**

Run: `cd apps/client && pnpm exec tsc --noEmit 2>&1 | grep -E 'im\.ts|routines\.ts|useChannels' || echo 'clean'`
Expected: `clean`.

- [ ] **Step 6: Commit**

```bash
git add apps/client/src/types/im.ts \
        apps/client/src/services/api/routines.ts \
        apps/client/src/hooks/__tests__/useChannels.test.ts
git commit -m "feat(client): add routine-session channel type and startCreationSession API"
```

---

### Task 10: `CreationSessionRunItem` component + tests

**Goal:** Build the visual pseudo-run entry that sits at the bottom of an expanded routine card.

**Files:**

- Create: `apps/client/src/components/routines/CreationSessionRunItem.tsx`
- Create: `apps/client/src/components/routines/__tests__/CreationSessionRunItem.test.tsx`

**Acceptance Criteria:**

- [ ] Renders a `MessageSquare` icon and an i18n label `t('creation.runLabel', 'Routine Creation')`
- [ ] Yellow accent background that distinguishes it from `RunItem`
- [ ] Selected and hover states match `RunItem`'s visual rhythm
- [ ] Clicking calls the `onClick` prop

**Verify:** `pnpm --filter client test src/components/routines/__tests__/CreationSessionRunItem.test.tsx` → green

**Steps:**

- [ ] **Step 1: Write the failing test**

```typescript
// apps/client/src/components/routines/__tests__/CreationSessionRunItem.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

import { CreationSessionRunItem } from "../CreationSessionRunItem";

describe("CreationSessionRunItem", () => {
  it("renders the creation label and responds to clicks", () => {
    const onClick = vi.fn();
    render(<CreationSessionRunItem isSelected={false} onClick={onClick} />);

    expect(screen.getByText("Routine Creation")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("applies the selected style when isSelected=true", () => {
    const { container } = render(
      <CreationSessionRunItem isSelected={true} onClick={() => {}} />,
    );
    expect(container.querySelector("button")?.className).toMatch(/ring|primary/);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `pnpm --filter client test src/components/routines/__tests__/CreationSessionRunItem.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the component**

```tsx
// apps/client/src/components/routines/CreationSessionRunItem.tsx
import { useTranslation } from "react-i18next";
import { MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

interface CreationSessionRunItemProps {
  isSelected: boolean;
  onClick: () => void;
}

export function CreationSessionRunItem({
  isSelected,
  onClick,
}: CreationSessionRunItemProps) {
  const { t } = useTranslation("routines");

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-2 py-1.5 rounded-md transition-colors",
        "border border-yellow-200/60 dark:border-yellow-800/40",
        "bg-yellow-50/60 dark:bg-yellow-900/15",
        isSelected
          ? "ring-1 ring-primary/30 bg-primary/10"
          : "hover:bg-yellow-100/70 dark:hover:bg-yellow-900/25",
      )}
    >
      <div className="flex items-center gap-1.5">
        <MessageSquare
          size={12}
          className="shrink-0 text-yellow-700 dark:text-yellow-400"
        />
        <span
          className={cn(
            "text-xs font-medium",
            isSelected ? "text-primary" : "text-foreground",
          )}
        >
          {t("creation.runLabel", "Routine Creation")}
        </span>
      </div>
    </button>
  );
}
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `pnpm --filter client test src/components/routines/__tests__/CreationSessionRunItem.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/components/routines/CreationSessionRunItem.tsx \
        apps/client/src/components/routines/__tests__/CreationSessionRunItem.test.tsx
git commit -m "feat(client): add CreationSessionRunItem component"
```

---

### Task 11: `RoutineList` discriminated `selectedRun` state + `onOpenCreationSession` handler

**Goal:** Extend `RoutineList` state to support a creation-run selection sentinel and a handler that any child can call to open a routine's creation session.

**Files:**

- Modify: `apps/client/src/components/routines/RoutineList.tsx`

**Acceptance Criteria:**

- [ ] `selectedRunId: string | null` is replaced by a discriminated union: `type SelectedRun = { kind: 'execution'; routineId: string; executionId: string } | { kind: 'creation'; routineId: string } | null`
- [ ] `handleOpenCreationSession(routineId)` exists and: expands the routine, sets `activeRoutineId`, sets `selectedRun` to `{ kind: 'creation', routineId }`
- [ ] `handleSelectRun(routineId, executionId)` updated to use the new discriminated form
- [ ] `selectedRun` derivation feeds `ChatArea` with either `selectedRunExecution` (existing behavior) **or** `creationChannelId` from the routine when `selectedRun.kind === 'creation'`
- [ ] `handleOpenCreationSession` is passed to `DraftRoutineCard`, `AgenticAgentPicker`, and (via `ExpandableRoutineCard`) to `RoutineCard`

**Verify:** `cd apps/client && pnpm exec tsc --noEmit 2>&1 | grep RoutineList || echo clean` → `clean`. Tests added in subsequent tasks exercise the runtime behavior.

**Steps:**

- [ ] **Step 1: Define the discriminated type at the top of the file**

```typescript
type SelectedRun =
  | { kind: "execution"; routineId: string; executionId: string }
  | { kind: "creation"; routineId: string }
  | null;
```

- [ ] **Step 2: Replace state declarations**

```typescript
const [selectedRun, setSelectedRun] = useState<SelectedRun>(null);
```

(remove the existing `selectedRunId` and `activeRoutineId` separate `useState` calls; derive `activeRoutineId` from `selectedRun?.routineId`. If a separate `activeRoutineId` is needed for the empty-card-expanded case, keep it as a separate state and update it alongside.)

- [ ] **Step 3: Add `handleOpenCreationSession`**

```typescript
const handleOpenCreationSession = useCallback((routineId: string) => {
  setExpandedRoutineIds((prev) => {
    const next = new Set(prev);
    next.add(routineId);
    return next;
  });
  setActiveRoutineId(routineId);
  setSelectedRun({ kind: "creation", routineId });
}, []);
```

- [ ] **Step 4: Update `handleSelectRun` to the new shape**

```typescript
const handleSelectRun = useCallback(
  (routineId: string, executionId: string) => {
    setActiveRoutineId(routineId);
    setSelectedRun({ kind: "execution", routineId, executionId });
  },
  [],
);
```

- [ ] **Step 5: Derive ChatArea inputs from `selectedRun`**

```typescript
const isCreationMode = selectedRun?.kind === "creation";

const selectedRunExecution = useMemo(() => {
  if (!selectedRun || selectedRun.kind !== "execution") return null;
  if (activeExecution?.id === selectedRun.executionId) return activeExecution;
  return (
    activeRoutineExecutions.find((e) => e.id === selectedRun.executionId) ??
    null
  );
}, [selectedRun, activeExecution, activeRoutineExecutions]);

const creationChannelOverride =
  isCreationMode && selectedRoutine ? selectedRoutine.creationChannelId : null;
```

- [ ] **Step 6: Pass props through**

In the `ChatArea` JSX block:

```tsx
<ChatArea
  routine={selectedRoutine}
  selectedRun={selectedRunExecution}
  activeExecution={activeExecution}
  isViewingHistory={isViewingHistory && !isCreationMode}
  onReturnToCurrent={handleReturnToCurrent}
  creationChannelId={creationChannelOverride}
/>
```

In the `<DraftRoutineCard>` JSX:

```tsx
<DraftRoutineCard
  key={routine.id}
  routine={routine}
  onOpenCreationSession={handleOpenCreationSession}
/>
```

In the `<ExpandableRoutineCard>` JSX:

```tsx
<ExpandableRoutineCard
  key={routine.id}
  routine={routine}
  isExpanded={expandedRoutineIds.has(routine.id)}
  isActive={activeRoutineId === routine.id}
  selectedRun={selectedRun}
  botNameMap={botNameMap}
  onToggleExpand={() => handleToggleExpand(routine.id)}
  onSelectRun={handleSelectRun}
  onOpenCreationSession={handleOpenCreationSession}
  onOpenSettings={() => setShowSettingsRoutineId(routine.id)}
/>
```

In the `<AgenticAgentPicker>` JSX:

```tsx
<AgenticAgentPicker
  open={agenticPickerOpen}
  onClose={() => setAgenticPickerOpen(false)}
  onManualCreate={() => {
    setAgenticPickerOpen(false);
    setShowCreateDialog(true);
  }}
  onOpenCreationSession={handleOpenCreationSession}
/>
```

- [ ] **Step 7: Update `ExpandableRoutineCard` props type to receive the new props (just plumbing — the rendering itself is in Task 12)**

```typescript
interface ExpandableRoutineCardProps {
  routine: Routine;
  isExpanded: boolean;
  isActive: boolean;
  selectedRun: SelectedRun;
  botNameMap: Map<string, string>;
  onToggleExpand: () => void;
  onSelectRun: (routineId: string, runId: string) => void;
  onOpenCreationSession: (routineId: string) => void;
  onOpenSettings: () => void;
}
```

(`SelectedRun` is exported from RoutineList or moved to a shared types file — keep it co-located in `RoutineList.tsx` and `export` it.)

- [ ] **Step 8: Typecheck**

Run: `cd apps/client && pnpm exec tsc --noEmit 2>&1 | grep -E 'RoutineList|ExpandableRoutineCard|RoutineCard|DraftRoutineCard|AgenticAgentPicker|ChatArea' || echo clean`
Expected: many cascading errors (good — they pin the next tasks). At minimum, `RoutineList.tsx` itself should typecheck after this step. Errors in `RoutineCard`, `ChatArea`, `DraftRoutineCard`, `AgenticAgentPicker` are expected and resolved by the next tasks.

- [ ] **Step 9: Commit**

```bash
git add apps/client/src/components/routines/RoutineList.tsx
git commit -m "refactor(routines): discriminated selectedRun + onOpenCreationSession handler"
```

---

### Task 12: `RoutineCard` renders `CreationSessionRunItem` at bottom of runs list

**Goal:** Inject the special run entry conditionally and forward selection to `RoutineList` via `onOpenCreationSession`.

**Files:**

- Modify: `apps/client/src/components/routines/RoutineCard.tsx`
- Modify: `apps/client/src/components/routines/RoutineList.tsx` — `ExpandableRoutineCard` forwards new props

**Acceptance Criteria:**

- [ ] When `routine.status === 'draft' && routine.creationChannelId`, a `CreationSessionRunItem` appears as the **last** item in the expanded runs list
- [ ] `selectedRun.kind === 'creation' && selectedRun.routineId === routine.id` highlights the special run
- [ ] Clicking the special run triggers `onOpenCreationSession(routine.id)`
- [ ] When `routine.status !== 'draft'`, the special run is **not** rendered (defensive even if `creationChannelId` lingers briefly)

**Verify:** `pnpm --filter client test src/components/routines/__tests__/CreationSessionRunItem.test.tsx` and any RoutineCard tests if present → green; manual sanity in `RoutineList`.

**Steps:**

- [ ] **Step 1: Update `RoutineCardProps`**

```typescript
import type { SelectedRun } from "./RoutineList";
import { CreationSessionRunItem } from "./CreationSessionRunItem";

interface RoutineCardProps {
  routine: Routine;
  isExpanded: boolean;
  isActive: boolean;
  selectedRun: SelectedRun;
  executions: RoutineExecution[];
  botName?: string | null;
  onToggleExpand: () => void;
  onSelectRun: (runId: string) => void;
  onOpenCreationSession: (routineId: string) => void;
  onOpenSettings: () => void;
}
```

- [ ] **Step 2: Render the special run inside the runs list block**

Locate the JSX that maps `executions` into `<RunItem>` rows. After the `.map`, append:

```tsx
{
  routine.status === "draft" && routine.creationChannelId && (
    <CreationSessionRunItem
      isSelected={
        selectedRun?.kind === "creation" && selectedRun.routineId === routine.id
      }
      onClick={() => onOpenCreationSession(routine.id)}
    />
  );
}
```

The existing `RunItem` selection check uses `selectedRunId` (string). Update it to derive from `selectedRun`:

```tsx
<RunItem
  execution={execution}
  isSelected={
    selectedRun?.kind === "execution" &&
    selectedRun.executionId === execution.id
  }
  onClick={() => onSelectRun(execution.id)}
/>
```

- [ ] **Step 3: Update `ExpandableRoutineCard` in `RoutineList.tsx` to forward `selectedRun` and `onOpenCreationSession` to `RoutineCard`**

```tsx
return (
  <RoutineCard
    routine={routine}
    isExpanded={isExpanded}
    isActive={isActive}
    selectedRun={selectedRun}
    executions={executions}
    botName={botName}
    onToggleExpand={onToggleExpand}
    onSelectRun={(runId) => onSelectRun(routine.id, runId)}
    onOpenCreationSession={onOpenCreationSession}
    onOpenSettings={onOpenSettings}
  />
);
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/client && pnpm exec tsc --noEmit 2>&1 | grep -E 'RoutineCard|RoutineList' || echo clean`
Expected: `clean`.

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/components/routines/RoutineCard.tsx \
        apps/client/src/components/routines/RoutineList.tsx
git commit -m "feat(routines): render creation session run on draft routine cards"
```

---

### Task 13: `ChatArea` creation mode

**Goal:** Render `routine.creationChannelId` when `creationChannelId` prop is provided, hiding execution-specific controls.

**Files:**

- Modify: `apps/client/src/components/routines/ChatArea.tsx`

**Acceptance Criteria:**

- [ ] `ChatArea` accepts a new optional prop `creationChannelId: string | null`
- [ ] When `creationChannelId` is set, `selectedRun` and `activeExecution` are ignored for the channel-id derivation; `ChannelView` receives `creationChannelId`
- [ ] Run controls (rerun, pause, play, restart, history banner) are hidden in creation mode
- [ ] A draft mode banner shows `routine.title`, draft badge, and "In Creation" status indicator

**Verify:** `cd apps/client && pnpm exec tsc --noEmit 2>&1 | grep ChatArea || echo clean` → `clean`

**Steps:**

- [ ] **Step 1: Extend `ChatAreaProps`**

```typescript
interface ChatAreaProps {
  routine: RoutineDetail;
  selectedRun: RoutineExecution | null;
  activeExecution: RoutineExecution | null;
  isViewingHistory: boolean;
  onReturnToCurrent: () => void;
  creationChannelId?: string | null;
}
```

- [ ] **Step 2: Branch on `creationChannelId`**

Inside the component body:

```typescript
const isCreationMode = !!creationChannelId;
const channelId = isCreationMode
  ? creationChannelId
  : (selectedRun?.channelId ?? activeExecution?.channelId ?? null);
```

(The exact existing `channelId` derivation should be preserved for the non-creation branch — adapt the line above to wherever `channelId` is currently computed in the file.)

- [ ] **Step 3: Hide execution-specific UI in creation mode**

Wrap the existing run header / controls block:

```tsx
{
  !isCreationMode && (
    <>{/* existing run header, badge, controls, history banner */}</>
  );
}
{
  isCreationMode && (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-yellow-200/60 dark:border-yellow-800/40 bg-yellow-50/40 dark:bg-yellow-900/10">
      <Badge
        variant="outline"
        className="text-yellow-700 dark:text-yellow-400 border-yellow-300 dark:border-yellow-800"
      >
        {t("draft.badge")}
      </Badge>
      <span className="text-sm font-medium truncate">{routine.title}</span>
      <span className="ml-auto text-xs text-yellow-700 dark:text-yellow-400">
        {t("creation.bannerStatus", "In Creation")}
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Pass `channelId` to `ChannelView` once**

The existing `ChannelView` block at L327-335 is already in the right place. Make sure it now reads from the unified `channelId` variable computed in Step 2.

- [ ] **Step 5: Typecheck**

Run: `cd apps/client && pnpm exec tsc --noEmit 2>&1 | grep ChatArea || echo clean`
Expected: `clean`.

- [ ] **Step 6: Commit**

```bash
git add apps/client/src/components/routines/ChatArea.tsx
git commit -m "feat(routines): ChatArea creation mode renders routine-session channel"
```

---

### Task 14: `DraftRoutineCard` lazy `startCreationSession` + open creation run

**Goal:** Replace router navigation with the lazy-create-then-select flow. The button is always enabled for drafts (no more "no channel" tooltip).

**Files:**

- Modify: `apps/client/src/components/routines/DraftRoutineCard.tsx`
- Modify: `apps/client/src/components/routines/__tests__/` — new test file `DraftRoutineCard.test.tsx`

**Acceptance Criteria:**

- [ ] `DraftRoutineCard` accepts `onOpenCreationSession: (routineId: string) => void` prop
- [ ] Click handler:
  - If `routine.creationChannelId` is set → call `onOpenCreationSession(routine.id)` directly
  - If null → call `api.routines.startCreationSession(routine.id)`, invalidate `['routines']`, then call `onOpenCreationSession(routine.id)`
- [ ] Button is always enabled for drafts (remove the disabled tooltip branch)
- [ ] Loading state covers the API call (spinner inside the button)
- [ ] Errors are surfaced via toast or inline text (use existing `toast` if the file already imports one; otherwise log + leave card usable)

**Verify:** `pnpm --filter client test src/components/routines/__tests__/DraftRoutineCard.test.tsx` → green

**Steps:**

- [ ] **Step 1: Write the test**

```tsx
// apps/client/src/components/routines/__tests__/DraftRoutineCard.test.tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Routine } from "@/types/routine";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, fb?: string) => fb ?? k }),
}));

const startCreationSession = vi.fn();
vi.mock("@/services/api", () => ({
  api: {
    routines: {
      startCreationSession: (...args: any[]) => startCreationSession(...args),
      delete: vi.fn(),
    },
  },
}));

import { DraftRoutineCard } from "../DraftRoutineCard";

function renderCard(routine: Partial<Routine>, onOpen = vi.fn()) {
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <DraftRoutineCard
        routine={
          {
            id: "r-1",
            title: "Test Draft",
            status: "draft",
            creationChannelId: null,
            ...routine,
          } as Routine
        }
        onOpenCreationSession={onOpen}
      />
    </QueryClientProvider>,
  );
  return { onOpen };
}

describe("DraftRoutineCard", () => {
  beforeEach(() => {
    startCreationSession.mockReset();
  });

  it("with existing creationChannelId, clicking complete does NOT call API and opens session", () => {
    const { onOpen } = renderCard({ creationChannelId: "ch-1" });
    fireEvent.click(screen.getByText("draft.completeCreation"));
    expect(startCreationSession).not.toHaveBeenCalled();
    expect(onOpen).toHaveBeenCalledWith("r-1");
  });

  it("with null creationChannelId, clicking complete calls API then opens session", async () => {
    startCreationSession.mockResolvedValueOnce({
      creationChannelId: "new-ch",
      creationSessionId: "team9/t/a/dm/new-ch",
    });
    const { onOpen } = renderCard({ creationChannelId: null });

    fireEvent.click(screen.getByText("draft.completeCreation"));

    await waitFor(() =>
      expect(startCreationSession).toHaveBeenCalledWith("r-1"),
    );
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("r-1"));
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `pnpm --filter client test src/components/routines/__tests__/DraftRoutineCard.test.tsx`
Expected: FAIL — prop missing or button disabled path.

- [ ] **Step 3: Edit `DraftRoutineCard.tsx`**

Replace lines 1-50 (imports + props + handlers) with:

```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2, MessageSquare, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { api } from "@/services/api";
import type { Routine } from "@/types/routine";

interface DraftRoutineCardProps {
  routine: Routine;
  onOpenCreationSession: (routineId: string) => void;
}

export function DraftRoutineCard({
  routine,
  onOpenCreationSession,
}: DraftRoutineCardProps) {
  const { t } = useTranslation("routines");
  const queryClient = useQueryClient();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: () => api.routines.delete(routine.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["routines"] });
    },
  });

  const startMutation = useMutation({
    mutationFn: () => api.routines.startCreationSession(routine.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["routines"] });
      onOpenCreationSession(routine.id);
    },
  });

  function handleCompleteCreation() {
    if (routine.creationChannelId) {
      onOpenCreationSession(routine.id);
      return;
    }
    startMutation.mutate();
  }
```

Then replace the JSX block that previously rendered the disabled tooltip with a single always-enabled button (remove the entire `<Tooltip>` branch and its `else`). The button:

```tsx
<Button
  variant="ghost"
  size="sm"
  className="h-6 px-2 text-xs shrink-0"
  onClick={handleCompleteCreation}
  disabled={startMutation.isPending}
>
  {startMutation.isPending ? (
    <Loader2 size={12} className="mr-1 animate-spin" />
  ) : (
    <MessageSquare size={12} className="mr-1" />
  )}
  {t("draft.completeCreation")}
</Button>
```

Also remove the now-unused `useNavigate` import and the `Tooltip*` imports.

- [ ] **Step 4: Run tests, confirm pass**

Run: `pnpm --filter client test src/components/routines/__tests__/DraftRoutineCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `cd apps/client && pnpm exec tsc --noEmit 2>&1 | grep DraftRoutineCard || echo clean`
Expected: `clean`.

- [ ] **Step 6: Commit**

```bash
git add apps/client/src/components/routines/DraftRoutineCard.tsx \
        apps/client/src/components/routines/__tests__/DraftRoutineCard.test.tsx
git commit -m "feat(routines): DraftRoutineCard lazy startCreationSession flow"
```

---

### Task 15: `DraftRoutineBanner` same lazy-flow update

**Goal:** Stop banner navigation to `/messages/:id`. Use `onOpenCreationSession` (passed via closest parent) or fall back to direct API call + invalidate. The banner lives on routine detail pages outside `RoutineList`, so it cannot reuse the same handler — instead, it accepts a callback prop.

**Files:**

- Modify: `apps/client/src/components/routines/DraftRoutineBanner.tsx`
- Modify: any caller(s) of `DraftRoutineBanner` to pass the new prop

**Acceptance Criteria:**

- [ ] `DraftRoutineBanner` accepts `onOpenCreationSession?: (routineId: string) => void`
- [ ] If `creationChannelId` is set, clicking the button calls `onOpenCreationSession?.(routine.id)` (router navigation removed)
- [ ] If `creationChannelId` is null, the button calls `api.routines.startCreationSession(routine.id)` then `onOpenCreationSession?.(routine.id)`
- [ ] When `onOpenCreationSession` is undefined (e.g., banner used somewhere it cannot drive a session), the button hides and the message text remains as a passive notice
- [ ] No `useNavigate` import remains in the file

**Verify:** `cd apps/client && pnpm exec tsc --noEmit 2>&1 | grep DraftRoutineBanner || echo clean` → `clean`

**Steps:**

- [ ] **Step 1: Edit `DraftRoutineBanner.tsx`**

Replace its body with:

```tsx
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, MessageSquare, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/services/api";
import type { Routine } from "@/types/routine";

interface DraftRoutineBannerProps {
  routine: Routine;
  onOpenCreationSession?: (routineId: string) => void;
}

export function DraftRoutineBanner({
  routine,
  onOpenCreationSession,
}: DraftRoutineBannerProps) {
  const { t } = useTranslation("routines");
  const queryClient = useQueryClient();

  const startMutation = useMutation({
    mutationFn: () => api.routines.startCreationSession(routine.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["routines"] });
      onOpenCreationSession?.(routine.id);
    },
  });

  if (routine.status !== "draft") return null;

  function handleClick() {
    if (routine.creationChannelId) {
      onOpenCreationSession?.(routine.id);
      return;
    }
    startMutation.mutate();
  }

  const showButton = !!onOpenCreationSession;

  return (
    <div className="flex items-center gap-3 rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2.5 text-sm dark:border-yellow-800/50 dark:bg-yellow-900/20">
      <AlertTriangle
        size={16}
        className="shrink-0 text-yellow-600 dark:text-yellow-400"
      />
      <span className="flex-1 text-yellow-800 dark:text-yellow-200">
        {t("draft.bannerMessage")}
      </span>
      {showButton && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs shrink-0 border-yellow-300 bg-yellow-100 hover:bg-yellow-200 text-yellow-800 dark:border-yellow-700 dark:bg-yellow-900/40 dark:hover:bg-yellow-900/60 dark:text-yellow-200"
          onClick={handleClick}
          disabled={startMutation.isPending}
        >
          {startMutation.isPending ? (
            <Loader2 size={12} className="mr-1.5 animate-spin" />
          ) : (
            <MessageSquare size={12} className="mr-1.5" />
          )}
          {t("draft.completeCreation")}
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Update banner callers**

Run: `grep -rn "DraftRoutineBanner" apps/client/src` to find any `<DraftRoutineBanner ... />` usages. For each, decide whether the surrounding component can supply an `onOpenCreationSession` callback. If yes, thread one through (typically the same `handleOpenCreationSession` from `RoutineList`). If no, leave it unset — the button hides and the banner remains informational.

- [ ] **Step 3: Typecheck**

Run: `cd apps/client && pnpm exec tsc --noEmit 2>&1 | grep DraftRoutineBanner || echo clean`
Expected: `clean`.

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/components/routines/DraftRoutineBanner.tsx
git commit -m "feat(routines): DraftRoutineBanner lazy creation flow"
```

---

### Task 16: `AgenticAgentPicker` stops navigating, calls `onOpenCreationSession`

**Goal:** The agent picker confirm flow no longer navigates to `/messages/:id`. After `createWithCreationTask` resolves, it closes the modal and asks `RoutineList` to open the freshly-built creation session.

**Files:**

- Modify: `apps/client/src/components/routines/AgenticAgentPicker.tsx`
- Modify: `apps/client/src/components/routines/__tests__/AgenticAgentPicker.test.tsx` — add a flow test for the new behavior

**Acceptance Criteria:**

- [ ] `AgenticAgentPicker` accepts `onOpenCreationSession: (routineId: string) => void` prop
- [ ] On `createMutation.onSuccess`: closes the modal, invalidates `['routines']`, calls `onOpenCreationSession(data.routineId)`
- [ ] No `useNavigate` import remains in the file
- [ ] Existing 3 picker tests still pass; new test verifies the `onOpenCreationSession` callback is invoked with the new routine id

**Verify:** `pnpm --filter client test src/components/routines/__tests__/AgenticAgentPicker.test.tsx` → green

**Steps:**

- [ ] **Step 1: Add the test case**

Append to `AgenticAgentPicker.test.tsx`:

```typescript
it("calls onOpenCreationSession after createWithCreationTask succeeds and stops navigating", async () => {
  const onOpen = vi.fn();
  const onClose = vi.fn();

  const createWithCreationTask = vi.fn().mockResolvedValue({
    routineId: "new-routine",
    creationChannelId: "ch-1",
    creationSessionId: "team9/t/a/dm/ch-1",
  });

  // Override the api mock so the picker's mutation hits a resolving fn
  // (the existing module mock at the top of the file already provides
  // api.routines.createWithCreationTask — point it at this fn here)
  // ... wire via vi.mocked(...) or restore the module mock as needed ...

  mockCacheWithApps([
    installedApp({
      bots: [
        {
          botId: "bot-1",
          userId: "u-bot-1",
          username: "u",
          displayName: "Bot",
          // ... other required fields ...
        } as any,
      ],
    }),
  ]);

  // Capture mutate invocations from useMutation mock
  let onSuccess: ((data: any) => void) | undefined;
  mockUseMutation.mockImplementation((opts: any) => {
    onSuccess = opts?.onSuccess;
    return {
      mutate: () => onSuccess?.({
        routineId: "new-routine",
        creationChannelId: "ch-1",
        creationSessionId: "team9/t/a/dm/ch-1",
      }),
      reset: vi.fn(),
      isPending: false,
    };
  });

  render(
    <AgenticAgentPicker
      open
      onClose={onClose}
      onOpenCreationSession={onOpen}
    />,
  );

  fireEvent.click(screen.getByText("agentic.confirm"));

  expect(onOpen).toHaveBeenCalledWith("new-routine");
  expect(mockNavigate).not.toHaveBeenCalled();
});
```

(Adapt the mocking pattern to match the file's existing `vi.mock` structure — the key assertion is `onOpen` called with the new routine id and `mockNavigate` never called.)

- [ ] **Step 2: Run, confirm fail**

Run: `pnpm --filter client test src/components/routines/__tests__/AgenticAgentPicker.test.tsx -t onOpenCreationSession`
Expected: FAIL — picker still navigates.

- [ ] **Step 3: Edit `AgenticAgentPicker.tsx`**

Remove `useNavigate` import and the existing `onSuccess` navigation. Add the new prop and callback wiring:

```typescript
interface AgenticAgentPickerProps {
  open: boolean;
  onClose: () => void;
  onManualCreate?: () => void;
  onOpenCreationSession: (routineId: string) => void;
}

export function AgenticAgentPicker({
  open,
  onClose,
  onManualCreate,
  onOpenCreationSession,
}: AgenticAgentPickerProps) {
  // ...existing setup, remove `const navigate = useNavigate();` ...

  const createMutation = useMutation({
    mutationFn: () =>
      api.routines.createWithCreationTask({ agentId: effectiveAgentId }),
    onSuccess: (data) => {
      handleClose();
      onOpenCreationSession(data.routineId);
    },
    onError: (err) => {
      setError(
        (err as Error)?.message ??
          t("agentic.errorGeneric", "Failed to start creation"),
      );
    },
  });
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `pnpm --filter client test src/components/routines/__tests__/AgenticAgentPicker.test.tsx`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Typecheck**

Run: `cd apps/client && pnpm exec tsc --noEmit 2>&1 | grep AgenticAgentPicker || echo clean`
Expected: `clean`.

- [ ] **Step 6: Commit**

```bash
git add apps/client/src/components/routines/AgenticAgentPicker.tsx \
        apps/client/src/components/routines/__tests__/AgenticAgentPicker.test.tsx
git commit -m "feat(routines): AgenticAgentPicker opens creation session in-page"
```

---

## Final Verification

After all 16 tasks land, run the full backend + client test suites once:

```bash
pnpm --filter gateway test
pnpm --filter client test
cd apps/client && pnpm exec tsc --noEmit
```

Then perform a manual smoke test against the dev environment:

1. **Picker flow:** open Routines page → click "+" → pick a bot → click "Start Creation" → verify the modal closes, the new draft appears in the Draft group, the card auto-expands, and the Routine Creation special run is selected with `ChatArea` showing the routine-session channel
2. **Onboarding flow:** delete any draft and re-trigger onboarding (or use a draft from `provisionRoutines`) → click "Complete Creation" on the draft card → verify the same in-page transition
3. **Complete flow:** finish a creation conversation (agent calls `complete-creation`) → verify the routine moves to Upcoming, the special run disappears, the underlying `im_channels` row is `is_archived=true`
4. **Delete flow:** delete a draft → verify the underlying `im_channels` row is gone and `im_audit_logs` / `im_messages` for it are also gone
5. **Sidebar isolation:** create a draft → switch to Messages and Home sub-sidebars → verify the routine-session channel does NOT appear in either list

---

## Out of Scope

See [spec §Out of Scope](../specs/2026-04-14-dedicated-routine-creation-channel-design.md). This plan does not implement self-reflection / retrospective purposes, archived creation channel history viewer, onboarding agent swap, AI-generated starter document content, or the 4-step manual form.
