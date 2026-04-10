# Intelligent Routine Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build two-path intelligent routine creation (DM lightweight + Routine UI structured with draft state), enabling users to create routines via multi-turn conversation with AI agents.

**Architecture:** Add `draft` status and creation metadata columns to `routine__routines`. New backend endpoints orchestrate draft creation with dedicated creation channels. A new claw-hive component `team9-routine-creation` provides `createRoutine`, `getRoutine`, `updateRoutine` tools. Frontend integrates "Create with Agentic" into existing Routine list UI and adds draft-specific affordances.

**Tech Stack:** NestJS 11 + Drizzle ORM + PostgreSQL (backend), Team9 Agent PI / claw-hive components (agent layer), React 19 + TanStack Query + TanStack Router (frontend), Jest/Vitest (testing).

**Design Doc:** [2026-04-09-intelligent-routine-creation-design.md](../specs/2026-04-09-intelligent-routine-creation-design.md)

---

## File Structure

### Database Layer

- Modify: `apps/server/libs/database/src/schemas/routine/routines.ts` — add `draft` to enum + 3 new columns
- Create: `apps/server/libs/database/migrations/NNNN_routine_draft_creation.sql` — migration

### Backend (Gateway)

- Modify: `apps/server/apps/gateway/src/routines/routines.service.ts` — add `completeCreation`, `createWithCreationTask`; enhance `create`/`update` for draft
- Modify: `apps/server/apps/gateway/src/routines/routines.controller.ts` — add new endpoints
- Modify: `apps/server/apps/gateway/src/routines/dto/create-routine.dto.ts` — add `status` field
- Create: `apps/server/apps/gateway/src/routines/dto/create-with-creation-task.dto.ts` — new DTO
- Create: `apps/server/apps/gateway/src/routines/dto/complete-creation.dto.ts` — new DTO
- Modify: `apps/server/apps/gateway/src/routines/routines.service.spec.ts` — extended tests
- Modify: `apps/server/apps/gateway/src/routines/routines.controller.spec.ts` — extended tests

### Claw-Hive Component (team9-agent-pi)

- Create: `packages/claw-hive/src/components/team9-routine-creation/component.ts`
- Create: `packages/claw-hive/src/components/team9-routine-creation/tools.ts` — tool implementations
- Create: `packages/claw-hive/src/components/team9-routine-creation/types.ts` — config types
- Create: `packages/claw-hive/src/components/team9-routine-creation/component.test.ts`
- Create: `packages/claw-hive/src/components/team9-routine-creation/tools.test.ts`
- Modify: `packages/claw-hive-types/src/component-configs.ts` — add `Team9RoutineCreationComponentConfig`
- Modify: `packages/claw-hive/src/component-factories.ts` — register factory
- Modify: `packages/claw-hive/src/blueprints/presets.ts` — optionally reference in staff blueprints

### Gateway ↔ Claw-Hive Bridge (Team9 side)

- Modify: `apps/server/apps/gateway/src/claw-hive/claw-hive.service.ts` — add routine creation tool dispatch handlers
- Create: `apps/server/apps/gateway/src/claw-hive/handlers/routine-creation-handlers.ts`
- Create: `apps/server/apps/gateway/src/claw-hive/handlers/routine-creation-handlers.spec.ts`

### Frontend (Client)

- Modify: `apps/client/src/components/routines/RoutineList.tsx` — add Draft group, agentic button
- Modify: `apps/client/src/components/routines/CreateRoutineDialog.tsx` — add mode selector + form steps
- Create: `apps/client/src/components/routines/CreateRoutineModeDialog.tsx` — mode chooser (Form vs Agentic)
- Create: `apps/client/src/components/routines/AgenticRoutineAgentPicker.tsx` — agent selector popup
- Create: `apps/client/src/components/routines/DraftRoutineBanner.tsx` — draft warning banner
- Modify: `apps/client/src/services/api/routines.ts` — add new API methods
- Modify: `apps/client/src/types/routine.ts` — add draft status + creation fields
- Modify: `apps/client/src/i18n/locales/{zh,en}/routines.json` — new strings

---

## Task 0: Database Migration — Add Draft Status and Creation Metadata

**Goal:** Extend `routine__routines` table with `draft` status enum value and three new creation-tracking columns.

**Files:**

- Modify: `apps/server/libs/database/src/schemas/routine/routines.ts`
- Create: `apps/server/libs/database/migrations/NNNN_routine_draft_creation.sql` (via `pnpm db:generate`)

**Acceptance Criteria:**

- [ ] `routineStatusEnum` includes `'draft'` value
- [ ] Three new nullable columns: `creation_task_id`, `creation_session_id`, `creation_channel_id`
- [ ] `creation_channel_id` has FK to `channels` with `ON DELETE SET NULL`
- [ ] Migration file generated and applied
- [ ] TypeScript types updated (`Routine` type reflects new fields)

**Verify:** `pnpm db:migrate && pnpm typecheck` → both succeed with no errors

**Steps:**

- [ ] **Step 1: Update enum and schema**

Edit `apps/server/libs/database/src/schemas/routine/routines.ts`:

```typescript
export const routineStatusEnum = pgEnum("routine__status", [
  "draft",
  "upcoming",
  "in_progress",
  "paused",
  "pending_action",
  "completed",
  "failed",
  "stopped",
  "timeout",
]);
```

And in the `routines` table definition, add:

```typescript
// Creation metadata — only populated for Routine UI path
creationTaskId: uuid('creation_task_id'),
creationSessionId: varchar('creation_session_id', { length: 255 }),
creationChannelId: uuid('creation_channel_id').references(
  () => channels.id,
  { onDelete: 'set null' },
),
```

Import `channels` from `../im/channels.js` at the top.

Also add an index:

```typescript
index('idx_routine__routines_creation_channel_id').on(table.creationChannelId),
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm db:generate`
Expected: new migration file in `apps/server/libs/database/migrations/`

Review the generated SQL to confirm it:

1. Adds `'draft'` to the enum
2. Adds three columns as nullable
3. Adds FK + index for `creation_channel_id`

- [ ] **Step 3: Apply and test migration**

Run: `pnpm db:migrate`
Expected: Migration applied successfully.

Run: `pnpm typecheck`
Expected: No TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add apps/server/libs/database/src/schemas/routine/routines.ts \
        apps/server/libs/database/migrations/
git commit -m "feat(db): add draft status and creation metadata to routines"
```

---

## Task 1: Extend DTOs and Service for Draft Status

**Goal:** Allow `RoutinesService.create` and `update` to accept `status: 'draft' | 'upcoming'` so draft routines can be created and transitioned.

**Files:**

- Modify: `apps/server/apps/gateway/src/routines/dto/create-routine.dto.ts`
- Modify: `apps/server/apps/gateway/src/routines/dto/update-routine.dto.ts`
- Modify: `apps/server/apps/gateway/src/routines/routines.service.ts:65-105` (create method) + update method
- Modify: `apps/server/apps/gateway/src/routines/routines.service.spec.ts`

**Acceptance Criteria:**

- [ ] `CreateRoutineDto` has optional `status?: 'draft' | 'upcoming'` field, default `'upcoming'`
- [ ] `UpdateRoutineDto` can set `status` (validated against allowed transitions)
- [ ] `RoutinesService.create` persists status from DTO
- [ ] `RoutinesService.update` refuses to move routine out of `draft` except via `completeCreation` (new method in Task 2)
- [ ] Draft routines do not auto-start triggers on creation
- [ ] Unit tests cover all branches

**Verify:** `pnpm --filter server test -- routines.service.spec` → all tests pass, 100% coverage on new lines

**Steps:**

- [ ] **Step 1: Write failing test for draft creation**

Edit `apps/server/apps/gateway/src/routines/routines.service.spec.ts`, add:

```typescript
describe("create with draft status", () => {
  it("creates routine with draft status when specified", async () => {
    const dto: CreateRoutineDto = {
      title: "Test Routine",
      status: "draft",
    };
    const routine = await service.create(dto, userId, tenantId);
    expect(routine.status).toBe("draft");
  });

  it("defaults status to upcoming when omitted", async () => {
    const dto: CreateRoutineDto = { title: "Test Routine" };
    const routine = await service.create(dto, userId, tenantId);
    expect(routine.status).toBe("upcoming");
  });

  it("does not register triggers for draft routines", async () => {
    const dto: CreateRoutineDto = {
      title: "Test",
      status: "draft",
      triggers: [{ type: "manual", config: {}, enabled: true }],
    };
    const createBatchSpy = jest.spyOn(routineTriggersService, "createBatch");
    await service.create(dto, userId, tenantId);
    expect(createBatchSpy).not.toHaveBeenCalled();
  });
});
```

Run: `pnpm --filter server test -- routines.service.spec -t "create with draft status"`
Expected: FAIL (status field not recognized, triggers still registered)

- [ ] **Step 2: Update `CreateRoutineDto`**

Edit `apps/server/apps/gateway/src/routines/dto/create-routine.dto.ts`, add to `CreateRoutineDto`:

```typescript
import { IsIn, IsOptional } from 'class-validator';

// inside CreateRoutineDto class:
@IsIn(['draft', 'upcoming'] as const)
@IsOptional()
status?: 'draft' | 'upcoming';
```

- [ ] **Step 3: Update `RoutinesService.create`**

Edit `apps/server/apps/gateway/src/routines/routines.service.ts` in the `create` method:

```typescript
async create(dto: CreateRoutineDto, userId: string, tenantId: string) {
  const routineId = uuidv7();

  // Always create a linked document for the routine
  const doc = await this.documentsService.create(
    {
      documentType: 'task',
      content: dto.documentContent ?? '',
      title: dto.title,
    },
    { type: 'user', id: userId },
    tenantId,
  );
  const documentId = doc.id;

  const status = dto.status ?? 'upcoming';

  const [routine] = await this.db
    .insert(schema.routines)
    .values({
      id: routineId,
      tenantId,
      botId: dto.botId ?? null,
      creatorId: userId,
      title: dto.title,
      description: dto.description ?? null,
      status,
      scheduleType: dto.scheduleType ?? 'once',
      scheduleConfig: (dto.scheduleConfig as ScheduleConfig) ?? null,
      documentId,
    })
    .returning();

  // Do not register triggers for draft routines — they'll be added on completion
  if (status !== 'draft' && dto.triggers?.length) {
    await this.routineTriggersService.createBatch(
      routineId,
      dto.triggers,
      tenantId,
    );
  }

  return routine;
}
```

- [ ] **Step 4: Update `UpdateRoutineDto`**

Edit `apps/server/apps/gateway/src/routines/dto/update-routine.dto.ts`:

```typescript
import { IsIn, IsOptional } from 'class-validator';

// Add to UpdateRoutineDto:
@IsIn(['draft', 'upcoming'] as const)
@IsOptional()
status?: 'draft' | 'upcoming';
```

- [ ] **Step 5: Add draft-aware transitions to `update`**

Edit `apps/server/apps/gateway/src/routines/routines.service.ts` in `update`:

```typescript
async update(
  routineId: string,
  dto: UpdateRoutineDto,
  userId: string,
  tenantId: string,
) {
  const routine = await this.getRoutineOrThrow(routineId, tenantId);
  this.assertCreatorOwnership(routine, userId);

  // Draft routines cannot be transitioned out of draft via generic update.
  // Use completeCreation() instead.
  if (dto.status && dto.status !== routine.status) {
    throw new BadRequestException(
      'Cannot change routine status via update. Use completeCreation or dedicated control endpoints.',
    );
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };

  if (dto.title !== undefined) updateData.title = dto.title;
  if (dto.botId !== undefined) updateData.botId = dto.botId;
  if (dto.description !== undefined) updateData.description = dto.description;
  if (dto.scheduleType !== undefined) updateData.scheduleType = dto.scheduleType;
  if (dto.scheduleConfig !== undefined)
    updateData.scheduleConfig = dto.scheduleConfig;

  const [updated] = await this.db
    .update(schema.routines)
    .set(updateData)
    .where(eq(schema.routines.id, routineId))
    .returning();

  return updated;
}
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter server test -- routines.service.spec`
Expected: All tests pass, including new draft tests.

- [ ] **Step 7: Commit**

```bash
git add apps/server/apps/gateway/src/routines/
git commit -m "feat(routines): support draft status in create and update"
```

---

## Task 2: Add `completeCreation` Service Method + Endpoint

**Goal:** Implement the `draft → upcoming` transition. The method applies pending trigger configuration, archives the creation channel, and updates creation task status.

**Files:**

- Create: `apps/server/apps/gateway/src/routines/dto/complete-creation.dto.ts`
- Modify: `apps/server/apps/gateway/src/routines/routines.service.ts` — add `completeCreation`
- Modify: `apps/server/apps/gateway/src/routines/routines.controller.ts` — add endpoint
- Modify: `apps/server/apps/gateway/src/routines/routines.service.spec.ts`
- Modify: `apps/server/apps/gateway/src/routines/routines.controller.spec.ts`

**Acceptance Criteria:**

- [ ] `POST /v1/routines/:id/complete-creation` returns 200 with updated routine
- [ ] Only creator can complete
- [ ] Routine must be in `draft` state; otherwise 400
- [ ] Validation: must have `title`, `botId`, `documentContent`; otherwise 400 with field list
- [ ] Transitions `status` to `upcoming`
- [ ] If `creationChannelId` present, archives channel (uses `ChannelsService.archive`)
- [ ] Idempotent when already completed (returns current routine)
- [ ] Unit tests cover: happy path, permission denied, missing fields, double-complete

**Verify:** `pnpm --filter server test -- routines` → all pass

**Steps:**

- [ ] **Step 1: Create the DTO**

Create `apps/server/apps/gateway/src/routines/dto/complete-creation.dto.ts`:

```typescript
import { IsOptional, IsString, MaxLength } from "class-validator";

export class CompleteCreationDto {
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  notes?: string;
}
```

- [ ] **Step 2: Write failing tests**

Add to `apps/server/apps/gateway/src/routines/routines.service.spec.ts`:

```typescript
describe("completeCreation", () => {
  it("transitions draft routine to upcoming and archives channel", async () => {
    const draftRoutine = await createDraftFixture({
      title: "Test",
      botId: botFixture.id,
      documentContent: "Do stuff",
      creationChannelId: channelFixture.id,
    });

    const archiveSpy = jest.spyOn(channelsService, "archive");

    const result = await service.completeCreation(
      draftRoutine.id,
      { notes: "ready" },
      userId,
      tenantId,
    );

    expect(result.status).toBe("upcoming");
    expect(archiveSpy).toHaveBeenCalledWith(channelFixture.id, tenantId);
  });

  it("rejects non-draft routines", async () => {
    const routine = await createRoutineFixture({ status: "upcoming" });
    await expect(
      service.completeCreation(routine.id, {}, userId, tenantId),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects when required fields are missing", async () => {
    const draft = await createDraftFixture({ title: null });
    await expect(
      service.completeCreation(draft.id, {}, userId, tenantId),
    ).rejects.toThrow(/title/);
  });

  it("rejects when caller is not the creator", async () => {
    const draft = await createDraftFixture({ creatorId: otherUserId });
    await expect(
      service.completeCreation(draft.id, {}, userId, tenantId),
    ).rejects.toThrow(ForbiddenException);
  });

  it("is idempotent when routine is already upcoming", async () => {
    const routine = await createRoutineFixture({ status: "upcoming" });
    const result = await service.completeCreation(
      routine.id,
      {},
      userId,
      tenantId,
      { idempotent: true },
    );
    expect(result.status).toBe("upcoming");
  });
});
```

Run tests — expect FAIL (method does not exist).

- [ ] **Step 3: Implement `completeCreation`**

Edit `apps/server/apps/gateway/src/routines/routines.service.ts`, add:

```typescript
async completeCreation(
  routineId: string,
  dto: CompleteCreationDto,
  userId: string,
  tenantId: string,
): Promise<schema.Routine> {
  const routine = await this.getRoutineOrThrow(routineId, tenantId);
  this.assertCreatorOwnership(routine, userId);

  // Idempotency: if already transitioned, return as-is
  if (routine.status === 'upcoming') {
    return routine;
  }

  if (routine.status !== 'draft') {
    throw new BadRequestException(
      `Cannot complete creation: routine is in ${routine.status} status`,
    );
  }

  // Validate required fields
  const missing: string[] = [];
  if (!routine.title?.trim()) missing.push('title');
  if (!routine.botId) missing.push('botId');

  // Check the associated document has content
  const doc = routine.documentId
    ? await this.documentsService.getById(routine.documentId, tenantId)
    : null;
  if (!doc?.content?.trim()) missing.push('documentContent');

  if (missing.length > 0) {
    throw new BadRequestException(
      `Missing required fields: ${missing.join(', ')}`,
    );
  }

  // Transition to upcoming
  const [updated] = await this.db
    .update(schema.routines)
    .set({ status: 'upcoming', updatedAt: new Date() })
    .where(eq(schema.routines.id, routineId))
    .returning();

  // Archive creation channel if present
  if (routine.creationChannelId) {
    try {
      await this.channelsService.archive(
        routine.creationChannelId,
        tenantId,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to archive creation channel ${routine.creationChannelId}: ${err}`,
      );
    }
  }

  this.logger.log(
    `Routine ${routineId} creation completed${dto.notes ? `: ${dto.notes}` : ''}`,
  );

  return updated;
}
```

Inject `ChannelsService` in the constructor (add to imports and constructor signature).

- [ ] **Step 4: Add controller endpoint**

Edit `apps/server/apps/gateway/src/routines/routines.controller.ts`:

```typescript
@Post(':id/complete-creation')
@HttpCode(HttpStatus.OK)
async completeCreation(
  @Param('id', ParseUUIDPipe) id: string,
  @Body() dto: CompleteCreationDto,
  @CurrentUser() user: AuthUser,
  @CurrentTenant() tenantId: string,
) {
  return this.routinesService.completeCreation(id, dto, user.id, tenantId);
}
```

- [ ] **Step 5: Write controller test**

Add to `routines.controller.spec.ts`:

```typescript
it("POST /:id/complete-creation calls service", async () => {
  const spy = jest
    .spyOn(service, "completeCreation")
    .mockResolvedValue(mockRoutine);
  const result = await controller.completeCreation(
    "routine-id",
    { notes: "done" },
    mockUser,
    "tenant-id",
  );
  expect(spy).toHaveBeenCalledWith(
    "routine-id",
    { notes: "done" },
    mockUser.id,
    "tenant-id",
  );
  expect(result).toEqual(mockRoutine);
});
```

- [ ] **Step 6: Run tests and confirm coverage**

Run: `pnpm --filter server test -- routines`
Expected: all pass, 100% coverage on new code.

- [ ] **Step 7: Commit**

```bash
git add apps/server/apps/gateway/src/routines/
git commit -m "feat(routines): add completeCreation service and endpoint"
```

---
