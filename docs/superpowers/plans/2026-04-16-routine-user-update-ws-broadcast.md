# Routine & User Update WebSocket Broadcast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a routine or user profile is mutated through any endpoint, emit a workspace-scoped WebSocket event so all connected clients invalidate their React Query caches and reflect the change immediately.

**Architecture:** Add two new events — `routine:updated` and `user_updated` — with ID-only payloads, broadcast to `workspace:{tenantId}` Socket.io rooms. Three backend emit sites for routine (AI bot tool, user REST PATCH, trigger CRUD), one for user profile (`PATCH users/me`). Client subscribes via the existing `useWebSocketEvents` hook and invalidates the corresponding query keys; when the event's `userId` matches the logged-in user, also refresh the Zustand app store for multi-device self-sync.

**Tech Stack:** NestJS + Socket.io (server), Jest (server tests), React + TanStack Query + Zustand (client), Vitest (client tests). Uses existing `WebsocketGateway.broadcastToWorkspace(workspaceId, event, data)` helper and matches the `routine:status_changed` / `user_status_changed` patterns already in the code.

**Spec:** [docs/superpowers/specs/2026-04-16-routine-user-update-ws-broadcast-design.md](../specs/2026-04-16-routine-user-update-ws-broadcast-design.md)

---

## File Structure

Server event constants live in `apps/server/libs/shared/src/events/event-names.ts`; the client mirror lives in `apps/client/src/types/ws-events.ts`. Both need the two new constants.

Server emits happen in:

- `apps/server/apps/gateway/src/routines/routine-bot.service.ts` (AI tool, `wsGateway` already injected)
- `apps/server/apps/gateway/src/routines/routines.service.ts` (user REST, needs `wsGateway` injection)
- `apps/server/apps/gateway/src/routines/routine-triggers.service.ts` (trigger CRUD, needs `wsGateway` injection)
- `apps/server/apps/gateway/src/im/users/users.controller.ts` (updateMe, `websocketGateway` already injected)

Client subscription surface:

- `apps/client/src/services/websocket/index.ts` — add `onRoutineUpdated` / `onUserUpdated` helpers
- `apps/client/src/hooks/useWebSocketEvents.ts` — register handlers, invalidate caches, self-sync app store

Tests are co-located with sources per project convention.

---

## Task 1: Emit `routine:updated` from the AI bot tool

**Goal:** After the AI bot tool mutates a routine's row (or its triggers), broadcast `routine:updated` to the workspace so all clients refresh.

**Files:**

- Modify: `apps/server/libs/shared/src/events/event-names.ts` (add `ROUTINE.UPDATED`, extend `WsEventName` union — already includes `ROUTINE` sub-union, no union edit needed)
- Modify: `apps/server/apps/gateway/src/routines/routine-bot.service.ts:572-588` (the `updateRoutine` method tail)
- Test: `apps/server/apps/gateway/src/routines/routine-bot.service.spec.ts` (existing file, add cases)

**Acceptance Criteria:**

- [ ] `WS_EVENTS.ROUTINE.UPDATED` constant exists server-side with value `'routine:updated'`.
- [ ] `RoutineBotService.updateRoutine()` calls `wsGateway.broadcastToWorkspace(tenantId, 'routine:updated', { routineId })` once after the row update succeeds.
- [ ] When bot ownership check throws (lines 519 / 517), no broadcast fires.
- [ ] When the rejected-status-transition guard throws (lines 522-526), no broadcast fires.
- [ ] Existing `updateRoutine` tests still pass unchanged.

**Verify:** `pnpm --filter gateway test routine-bot.service.spec` → new cases pass, zero regressions.

**Steps:**

- [ ] **Step 1: Add the event constant**

Edit `apps/server/libs/shared/src/events/event-names.ts`. Locate the `ROUTINE:` block (currently around lines matching `STATUS_CHANGED: 'routine:status_changed'`). Add a third entry:

```ts
ROUTINE: {
  /** Routine execution status changed - broadcast by server */
  STATUS_CHANGED: 'routine:status_changed',
  /** Routine execution created - broadcast by server */
  EXECUTION_CREATED: 'routine:execution_created',
  /** Routine row (title/description/schedule/triggers) was updated - broadcast by server */
  UPDATED: 'routine:updated',
},
```

No `WsEventName` union edit needed — the existing `(typeof WS_EVENTS.ROUTINE)[keyof typeof WS_EVENTS.ROUTINE]` picks up the new value automatically.

- [ ] **Step 2: Write the failing tests**

Open `apps/server/apps/gateway/src/routines/routine-bot.service.spec.ts`. Find the existing `describe('updateRoutine', ...)` block (the spec already has extensive fixtures and `wsGateway.broadcastToWorkspace` mock on line 108). Add these cases inside that describe:

```ts
it("broadcasts routine:updated with routineId after a successful update", async () => {
  mockExistingRoutine({ id: routineId, tenantId, botId, status: "draft" });
  verifyBotOwnershipSucceeds(botId, botUserId);
  mockUpdateReturns({ id: routineId, tenantId, title: "new" });

  await service.updateRoutine(routineId, { title: "new" }, botUserId, tenantId);

  expect(wsGateway.broadcastToWorkspace).toHaveBeenCalledWith(
    tenantId,
    "routine:updated",
    { routineId },
  );
  expect(wsGateway.broadcastToWorkspace).toHaveBeenCalledTimes(1);
});

it("does NOT broadcast when bot ownership check fails", async () => {
  mockExistingRoutine({ id: routineId, tenantId, botId, status: "draft" });
  verifyBotOwnershipThrows(new ForbiddenException("wrong bot"));

  await expect(
    service.updateRoutine(routineId, { title: "x" }, botUserId, tenantId),
  ).rejects.toThrow(ForbiddenException);

  expect(wsGateway.broadcastToWorkspace).not.toHaveBeenCalled();
});

it("does NOT broadcast when a status transition is rejected", async () => {
  mockExistingRoutine({ id: routineId, tenantId, botId, status: "draft" });
  verifyBotOwnershipSucceeds(botId, botUserId);

  await expect(
    service.updateRoutine(
      routineId,
      { status: "in_progress" }, // different from current 'draft'
      botUserId,
      tenantId,
    ),
  ).rejects.toThrow(BadRequestException);

  expect(wsGateway.broadcastToWorkspace).not.toHaveBeenCalled();
});
```

Helper names (`mockExistingRoutine`, `verifyBotOwnershipSucceeds`, etc.) mirror the naming already in this file — use whatever fixture mechanism the surrounding describe already uses; the existing spec at line 236 already asserts `expect(wsGateway.broadcastToWorkspace).not.toHaveBeenCalled()` so the plumbing is there.

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter gateway test routine-bot.service.spec -t "broadcasts routine:updated"`

Expected: FAIL — `expect(wsGateway.broadcastToWorkspace).toHaveBeenCalledWith(...)` → received 0 calls.

- [ ] **Step 4: Add the emit to `updateRoutine`**

Edit `apps/server/apps/gateway/src/routines/routine-bot.service.ts`. In `updateRoutine` (starts at line 507), replace the tail (lines 582-588):

```ts
    const [updated] = await this.db
      .update(schema.routines)
      .set(updateData)
      .where(eq(schema.routines.id, routineId))
      .returning();

    await this.wsGateway.broadcastToWorkspace(
      routine.tenantId,
      WS_EVENTS.ROUTINE.UPDATED,
      { routineId },
    );

    return updated;
  }
```

`routine` is the row fetched at line 513 via `getRoutineOrThrow(routineId, tenantId)`, so `routine.tenantId` is in scope.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter gateway test routine-bot.service.spec`

Expected: all tests PASS, including the three new cases.

- [ ] **Step 6: Commit**

```bash
git add apps/server/libs/shared/src/events/event-names.ts apps/server/apps/gateway/src/routines/routine-bot.service.ts apps/server/apps/gateway/src/routines/routine-bot.service.spec.ts
git commit -m "feat(routines): emit routine:updated after AI bot tool updates"
```

---

## Task 2: Emit `routine:updated` from the user REST update path

**Goal:** Mirror Task 1 for the non-AI REST endpoint — when a user edits their own routine via `PATCH /routines/:id`, broadcast `routine:updated`.

**Files:**

- Modify: `apps/server/apps/gateway/src/routines/routines.service.ts:60-73` (constructor — inject `wsGateway`)
- Modify: `apps/server/apps/gateway/src/routines/routines.service.ts:220-277` (the `update` method tail)
- Modify: `apps/server/apps/gateway/src/routines/routines.module.ts` (verify `WEBSOCKET_GATEWAY` provider already wired; other services in this module already consume it, no change expected)
- Test: `apps/server/apps/gateway/src/routines/routines.service.spec.ts` (existing, 2916 lines — add cases)

**Acceptance Criteria:**

- [ ] `RoutinesService` constructor has `@Inject(WEBSOCKET_GATEWAY) private readonly wsGateway: WebsocketGateway`.
- [ ] `RoutinesService.update()` calls `broadcastToWorkspace(tenantId, 'routine:updated', { routineId })` once on success.
- [ ] Creator-ownership failure → no broadcast.
- [ ] Rejected-status-transition → no broadcast.
- [ ] Other routines.service tests still pass.

**Verify:** `pnpm --filter gateway test routines.service.spec` → added cases pass, full file green.

**Steps:**

- [ ] **Step 1: Inject `wsGateway` into `RoutinesService`**

Edit `apps/server/apps/gateway/src/routines/routines.service.ts`.

Add imports (merge with existing import block near the top):

```ts
import { WS_EVENTS } from "@team9/shared";
import { WEBSOCKET_GATEWAY } from "../shared/constants/injection-tokens.js";
import type { WebsocketGateway } from "../im/websocket/websocket.gateway.js";
```

In the constructor (currently lines 63-73), add the gateway as the first non-DB dependency — this keeps injection-token params grouped:

```ts
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    @Inject(WEBSOCKET_GATEWAY)
    private readonly wsGateway: WebsocketGateway,
    private readonly documentsService: DocumentsService,
    private readonly amqpConnection: AmqpConnection,
    private readonly routineTriggersService: RoutineTriggersService,
    private readonly taskCastService: TaskCastService,
    private readonly channelsService: ChannelsService,
    private readonly clawHiveService: ClawHiveService,
    private readonly botsService: BotService,
  ) {}
```

No module changes: `RoutinesModule` already registers `WEBSOCKET_GATEWAY` (because `RoutineBotService` already uses it — confirm by reading `routines.module.ts`, no edit if the provider is already there).

- [ ] **Step 2: Write the failing tests**

In `routines.service.spec.ts`, locate the existing describe for `update` (search for `describe('update'` or similar). Follow the existing spec's mocking style (the test file already stubs `wsGateway.broadcastToWorkspace` — confirm by grepping the file for `broadcastToWorkspace`; if the test harness doesn't mock it yet, add a mock to the existing `providers` array matching the pattern from `routine-bot.service.spec.ts:119`: `{ provide: WEBSOCKET_GATEWAY, useValue: { broadcastToWorkspace: jest.fn<any>().mockResolvedValue(undefined) } }`).

Add:

```ts
it("broadcasts routine:updated after updating a routine", async () => {
  mockExistingRoutine({
    id: routineId,
    tenantId,
    creatorId: userId,
    status: "draft",
  });
  mockUpdateReturns({ id: routineId, tenantId, title: "renamed" });

  await service.update(routineId, { title: "renamed" }, userId, tenantId);

  expect(wsGateway.broadcastToWorkspace).toHaveBeenCalledWith(
    tenantId,
    "routine:updated",
    { routineId },
  );
  expect(wsGateway.broadcastToWorkspace).toHaveBeenCalledTimes(1);
});

it("does NOT broadcast when creator ownership check fails", async () => {
  mockExistingRoutine({
    id: routineId,
    tenantId,
    creatorId: "other-user",
    status: "draft",
  });

  await expect(
    service.update(routineId, { title: "x" }, userId, tenantId),
  ).rejects.toThrow(ForbiddenException);

  expect(wsGateway.broadcastToWorkspace).not.toHaveBeenCalled();
});

it("does NOT broadcast when a status transition is rejected", async () => {
  mockExistingRoutine({
    id: routineId,
    tenantId,
    creatorId: userId,
    status: "draft",
  });

  await expect(
    service.update(routineId, { status: "in_progress" }, userId, tenantId),
  ).rejects.toThrow(BadRequestException);

  expect(wsGateway.broadcastToWorkspace).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter gateway test routines.service.spec -t "broadcasts routine:updated"`

Expected: FAIL — gateway mock has zero calls.

- [ ] **Step 4: Add the emit to `update`**

In `routines.service.ts`, replace the tail of `update` (the block ending at line 276 `return updated;`):

```ts
    const [updated] = await this.db
      .update(schema.routines)
      .set(updateData)
      .where(eq(schema.routines.id, routineId))
      .returning();

    await this.wsGateway.broadcastToWorkspace(
      routine.tenantId,
      WS_EVENTS.ROUTINE.UPDATED,
      { routineId },
    );

    return updated;
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter gateway test routines.service.spec`

Expected: all green, new cases pass.

- [ ] **Step 6: Commit**

```bash
git add apps/server/apps/gateway/src/routines/routines.service.ts apps/server/apps/gateway/src/routines/routines.service.spec.ts
git commit -m "feat(routines): emit routine:updated from REST update path"
```

---

## Task 3: Emit `routine:updated` from trigger CRUD

**Goal:** When a trigger is created, updated, or deleted through the REST endpoints, broadcast `routine:updated` on the _parent_ routine so any UI showing the routine's trigger list (or the routine row itself) refreshes. The `replaceAllForRoutine` path invoked by the AI tool / REST `update` does NOT emit — those outer paths already emit in Tasks 1–2 and a duplicate would fire twice.

**Files:**

- Modify: `apps/server/apps/gateway/src/routines/routine-triggers.service.ts` (constructor — inject `wsGateway`; methods `create`, `update`, `delete` emit after DB write)
- Test: `apps/server/apps/gateway/src/routines/routine-triggers.service.spec.ts` (existing, add cases for the three CRUD methods)

**Acceptance Criteria:**

- [ ] `RoutineTriggersService.create(routineId, dto, tenantId)` emits `broadcastToWorkspace(tenantId, 'routine:updated', { routineId })` once after insert.
- [ ] `RoutineTriggersService.update(triggerId, dto, tenantId)` emits using the parent routineId resolved from `getTriggerOrThrow` once after update.
- [ ] `RoutineTriggersService.delete(triggerId, tenantId)` emits using the parent routineId once after delete.
- [ ] `replaceAllForRoutine` does NOT emit (documented with a comment).
- [ ] Validation or not-found throws → no broadcast.

**Verify:** `pnpm --filter gateway test routine-triggers.service.spec` → new cases pass, existing stay green.

**Steps:**

- [ ] **Step 1: Inject `wsGateway` and import constants**

Edit `apps/server/apps/gateway/src/routines/routine-triggers.service.ts`.

Add imports:

```ts
import { WS_EVENTS } from "@team9/shared";
import { WEBSOCKET_GATEWAY } from "../shared/constants/injection-tokens.js";
import type { WebsocketGateway } from "../im/websocket/websocket.gateway.js";
```

Update constructor — the existing one injects `@Inject(DATABASE_CONNECTION) db`. Add the gateway:

```ts
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    @Inject(WEBSOCKET_GATEWAY)
    private readonly wsGateway: WebsocketGateway,
  ) {}
```

- [ ] **Step 2: Write the failing tests**

In `routine-triggers.service.spec.ts`, add a `broadcastToWorkspace: jest.fn<any>().mockResolvedValue(undefined)` to the gateway mock in the providers (match the pattern from `routine-bot.service.spec.ts:119`). Then add cases. Use the existing fixtures (`routineId`, `triggerId`, `tenantId`) — the spec already has setup for `create`/`update`/`delete`.

```ts
describe("create", () => {
  it("broadcasts routine:updated with parent routineId", async () => {
    mockRoutineExists({ id: routineId, tenantId });
    mockInsertReturns({ id: triggerId, routineId });

    await service.create(routineId, { type: "manual" }, tenantId);

    expect(wsGateway.broadcastToWorkspace).toHaveBeenCalledWith(
      tenantId,
      "routine:updated",
      { routineId },
    );
    expect(wsGateway.broadcastToWorkspace).toHaveBeenCalledTimes(1);
  });

  it("does NOT broadcast when validation fails", async () => {
    mockRoutineExists({ id: routineId, tenantId });

    await expect(
      service.create(routineId, { type: "cron", config: undefined }, tenantId),
    ).rejects.toThrow(BadRequestException);

    expect(wsGateway.broadcastToWorkspace).not.toHaveBeenCalled();
  });
});

describe("update", () => {
  it("broadcasts routine:updated using the parent routineId from the join", async () => {
    mockGetTriggerOrThrow({ id: triggerId, routineId, type: "manual" });
    mockUpdateTriggerReturns({ id: triggerId, routineId });

    await service.update(
      triggerId,
      { config: { cron: "*/5 * * * *" } },
      tenantId,
    );

    expect(wsGateway.broadcastToWorkspace).toHaveBeenCalledWith(
      tenantId,
      "routine:updated",
      { routineId },
    );
  });

  it("does NOT broadcast when the trigger is not found", async () => {
    mockGetTriggerOrThrowReturnsNone();

    await expect(
      service.update(triggerId, { config: {} }, tenantId),
    ).rejects.toThrow(NotFoundException);

    expect(wsGateway.broadcastToWorkspace).not.toHaveBeenCalled();
  });
});

describe("delete", () => {
  it("broadcasts routine:updated with the parent routineId", async () => {
    mockGetTriggerOrThrow({ id: triggerId, routineId, type: "manual" });

    await service.delete(triggerId, tenantId);

    expect(wsGateway.broadcastToWorkspace).toHaveBeenCalledWith(
      tenantId,
      "routine:updated",
      { routineId },
    );
  });
});

describe("replaceAllForRoutine", () => {
  it("does NOT emit — the outer caller (routines.update / bot.updateRoutine) is responsible", async () => {
    await service.replaceAllForRoutine(routineId, [{ type: "manual" }]);

    expect(wsGateway.broadcastToWorkspace).not.toHaveBeenCalled();
  });
});
```

If fixtures like `mockRoutineExists` / `mockGetTriggerOrThrow` do not exist yet in the spec, add thin helpers that stub the relevant `db.select(...).limit(1)` chain returning the shaped object — match the style already used in this spec file.

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter gateway test routine-triggers.service.spec`

Expected: new assertions on `broadcastToWorkspace` FAIL.

- [ ] **Step 4: Add emits to the three CRUD methods**

In `routine-triggers.service.ts`:

Inside `create(routineId, dto, tenantId)` — after the `.insert(...).returning()` block, before `return`:

```ts
await this.wsGateway.broadcastToWorkspace(tenantId, WS_EVENTS.ROUTINE.UPDATED, {
  routineId,
});
```

Inside `update(triggerId, dto, tenantId)` — after the `.update(...).returning()` block, before `return`. The parent routineId comes from the `trigger` fetched via `getTriggerOrThrow` at the top of the method:

```ts
await this.wsGateway.broadcastToWorkspace(tenantId, WS_EVENTS.ROUTINE.UPDATED, {
  routineId: trigger.routineId,
});
```

Inside `delete(triggerId, tenantId)` — after the `.delete(...)` call, before any return. Capture `routineId` from the trigger fetched via `getTriggerOrThrow` (the current code only calls it for existence check; save the return):

```ts
  async delete(triggerId: string, tenantId: string) {
    const trigger = await this.getTriggerOrThrow(triggerId, tenantId);

    await this.db
      .delete(schema.routineTriggers)
      .where(eq(schema.routineTriggers.id, triggerId));

    await this.wsGateway.broadcastToWorkspace(
      tenantId,
      WS_EVENTS.ROUTINE.UPDATED,
      { routineId: trigger.routineId },
    );
  }
```

Inside `replaceAllForRoutine(routineId, triggers)` — add a comment, no emit:

```ts
  async replaceAllForRoutine(
    routineId: string,
    triggers: CreateTriggerDto[],
  ) {
    // No routine:updated emit here — callers (RoutinesService.update and
    // RoutineBotService.updateRoutine) already emit once at the tail of
    // their own flow, which covers the triggers replace case.
    // ...existing body...
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter gateway test routine-triggers.service.spec`

Expected: all tests pass, including all added cases.

- [ ] **Step 6: Commit**

```bash
git add apps/server/apps/gateway/src/routines/routine-triggers.service.ts apps/server/apps/gateway/src/routines/routine-triggers.service.spec.ts
git commit -m "feat(routines): emit routine:updated from trigger CRUD endpoints"
```

---

## Task 4: Emit `user_updated` from `PATCH /users/me`

**Goal:** When a user changes their own profile (name, avatar, display preferences), broadcast `user_updated` to every workspace the user belongs to so other members' caches refresh and the user's own other devices self-sync.

**Files:**

- Modify: `apps/server/libs/shared/src/events/event-names.ts` (add `USER.UPDATED`)
- Modify: `apps/server/apps/gateway/src/im/users/users.controller.ts:60-66` (`updateMe` handler)
- Test: `apps/server/apps/gateway/src/im/users/users.controller.spec.ts` (existing, add cases)

**Acceptance Criteria:**

- [ ] `WS_EVENTS.USER.UPDATED` constant exists server-side with value `'user_updated'`.
- [ ] `updateMe` broadcasts `user_updated` with `{ userId }` to every workspace returned by `getWorkspaceIdsByUserId`.
- [ ] When `getWorkspaceIdsByUserId` returns an empty list, no broadcast fires (but the HTTP 200 is returned).
- [ ] When `usersService.update` throws, no broadcast fires and the error propagates.

**Verify:** `pnpm --filter gateway test users.controller.spec` → new cases pass.

**Steps:**

- [ ] **Step 1: Add the constant**

Edit `apps/server/libs/shared/src/events/event-names.ts`. Locate the `USER:` block:

```ts
USER: {
  /** User online - broadcast by server */
  ONLINE: 'user_online',
  /** User offline - broadcast by server */
  OFFLINE: 'user_offline',
  /** User status changed - broadcast by server */
  STATUS_CHANGED: 'user_status_changed',
  /** User profile (name, avatar, etc.) updated - broadcast by server */
  UPDATED: 'user_updated',
},
```

- [ ] **Step 2: Write the failing tests**

In `users.controller.spec.ts` (which already mocks `websocketGateway.broadcastToWorkspace` per the grep at line 54), add cases in the describe for `updateMe` (or create one):

```ts
describe("updateMe", () => {
  const userId = "user-1";
  const dto = { displayName: "new name" };

  it("broadcasts user_updated to every workspace the user belongs to", async () => {
    usersService.update = jest.fn().mockResolvedValue({ id: userId, ...dto });
    workspaceService.getWorkspaceIdsByUserId = jest
      .fn()
      .mockResolvedValue(["ws-1", "ws-2"]);

    await controller.updateMe(userId, dto);

    expect(websocketGateway.broadcastToWorkspace).toHaveBeenNthCalledWith(
      1,
      "ws-1",
      "user_updated",
      { userId },
    );
    expect(websocketGateway.broadcastToWorkspace).toHaveBeenNthCalledWith(
      2,
      "ws-2",
      "user_updated",
      { userId },
    );
    expect(websocketGateway.broadcastToWorkspace).toHaveBeenCalledTimes(2);
  });

  it("does not broadcast when the user belongs to no workspaces", async () => {
    usersService.update = jest.fn().mockResolvedValue({ id: userId, ...dto });
    workspaceService.getWorkspaceIdsByUserId = jest.fn().mockResolvedValue([]);

    await controller.updateMe(userId, dto);

    expect(websocketGateway.broadcastToWorkspace).not.toHaveBeenCalled();
  });

  it("does not broadcast when the service throws", async () => {
    usersService.update = jest.fn().mockRejectedValue(new Error("db down"));

    await expect(controller.updateMe(userId, dto)).rejects.toThrow("db down");
    expect(websocketGateway.broadcastToWorkspace).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter gateway test users.controller.spec -t "updateMe"`

Expected: FAIL — `broadcastToWorkspace` called 0 times.

- [ ] **Step 4: Update the handler**

Edit `apps/server/apps/gateway/src/im/users/users.controller.ts`. Replace the existing `updateMe` (lines 60-66) with:

```ts
  @Patch('me')
  async updateMe(
    @CurrentUser('sub') userId: string,
    @Body() dto: UpdateUserDto,
  ): Promise<UserResponse> {
    const updated = await this.usersService.update(userId, dto);

    const workspaceIds =
      await this.workspaceService.getWorkspaceIdsByUserId(userId);
    for (const workspaceId of workspaceIds) {
      await this.websocketGateway.broadcastToWorkspace(
        workspaceId,
        WS_EVENTS.USER.UPDATED,
        { userId },
      );
    }

    return updated;
  }
```

The surrounding imports for `WS_EVENTS` and the `websocketGateway` / `workspaceService` injection already exist (the `updateStatus` handler directly below this one already uses them — confirm by reading lines 68-90).

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter gateway test users.controller.spec`

Expected: all pass, including the three new updateMe cases.

- [ ] **Step 6: Commit**

```bash
git add apps/server/libs/shared/src/events/event-names.ts apps/server/apps/gateway/src/im/users/users.controller.ts apps/server/apps/gateway/src/im/users/users.controller.spec.ts
git commit -m "feat(users): emit user_updated on PATCH /users/me"
```

---

## Task 5: Client-side event types and service helpers

**Goal:** Expose the two new events to the React app — add the client mirror of the constants, add payload types, and add `onRoutineUpdated` / `onUserUpdated` subscription helpers on the singleton `wsService`.

**Files:**

- Modify: `apps/client/src/types/ws-events.ts` (add `ROUTINE.UPDATED`, `USER.UPDATED`; add `RoutineUpdatedEvent` and `UserUpdatedEvent` interfaces)
- Modify: `apps/client/src/services/websocket/index.ts` (add `onRoutineUpdated`, `offRoutineUpdated`, `onUserUpdated`, `offUserUpdated` methods)
- Test: `apps/client/src/services/websocket/__tests__/` (if a suite exists; if not, skip — the hook test in Task 6 exercises the subscription end-to-end)

**Acceptance Criteria:**

- [ ] `WS_EVENTS.ROUTINE.UPDATED === 'routine:updated'` client-side.
- [ ] `WS_EVENTS.USER.UPDATED === 'user_updated'` client-side.
- [ ] `RoutineUpdatedEvent` and `UserUpdatedEvent` interfaces are exported, each containing only the respective ID.
- [ ] `wsService.onRoutineUpdated(cb)` / `offRoutineUpdated(cb)` compile and call the underlying `on` / `off` with the correct constants. Same for `onUserUpdated` / `offUserUpdated`.
- [ ] Existing wsService tests still pass.

**Verify:** `pnpm --filter client typecheck && pnpm --filter client test services/websocket`

**Steps:**

- [ ] **Step 1: Add constants and event types**

Edit `apps/client/src/types/ws-events.ts`. Update the `ROUTINE` block (around line 114):

```ts
ROUTINE: {
  STATUS_CHANGED: "routine:status_changed",
  EXECUTION_CREATED: "routine:execution_created",
  UPDATED: "routine:updated",
},
```

And the `USER` block (around line 59):

```ts
USER: {
  ONLINE: "user_online",
  OFFLINE: "user_offline",
  STATUS_CHANGED: "user_status_changed",
  UPDATED: "user_updated",
},
```

Then add interface declarations somewhere in the event-types section (near the existing `UserStatusChangedEvent` and `RoutineStatusChangedEvent` interfaces — search for those to find the spot):

```ts
/** Routine updated event (title / description / schedule / triggers) — broadcast by server */
export interface RoutineUpdatedEvent {
  routineId: string;
}

/** User profile updated event — broadcast by server */
export interface UserUpdatedEvent {
  userId: string;
}
```

- [ ] **Step 2: Add service helpers**

Edit `apps/client/src/services/websocket/index.ts`. Locate the routine helpers section (around lines 606-641 with `onRoutineStatusChanged`, `offRoutineExecutionCreated`). Append:

```ts
  onRoutineUpdated(callback: (event: RoutineUpdatedEvent) => void): void {
    this.on<RoutineUpdatedEvent>(WS_EVENTS.ROUTINE.UPDATED, callback);
  }

  offRoutineUpdated(callback: (event: RoutineUpdatedEvent) => void): void {
    this.off<RoutineUpdatedEvent>(WS_EVENTS.ROUTINE.UPDATED, callback);
  }
```

Locate the user helpers section (around lines 508-518 with `onUserOnline` / `onUserStatusChanged`). Append:

```ts
  onUserUpdated(callback: (event: UserUpdatedEvent) => void): void {
    this.on<UserUpdatedEvent>(WS_EVENTS.USER.UPDATED, callback);
  }

  offUserUpdated(callback: (event: UserUpdatedEvent) => void): void {
    this.off<UserUpdatedEvent>(WS_EVENTS.USER.UPDATED, callback);
  }
```

Add the two new event-type imports to the `import type { ... } from "@/types/ws-events"` group at the top of the file — include `RoutineUpdatedEvent` and `UserUpdatedEvent`.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter client typecheck`

Expected: no TypeScript errors. If any, the usual cause is a missing `import type { RoutineUpdatedEvent }` at the top of `websocket/index.ts` or a stale `@team9/shared` type — fix inline.

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/types/ws-events.ts apps/client/src/services/websocket/index.ts
git commit -m "feat(client): add routine:updated and user_updated ws helpers"
```

---

## Task 6: Client-side subscription, cache invalidation, and self-sync

**Goal:** Subscribe to the two new events inside `useWebSocketEvents` and invalidate the React Query keys that drive the left-side routine list and user-profile views. When the `user_updated` event's `userId` matches the currently logged-in user, refresh the Zustand app store so multi-device profile edits propagate to this session.

**Files:**

- Modify: `apps/client/src/hooks/useWebSocketEvents.ts` (register the two new handlers, wire cache invalidation, implement self-sync)
- Test: `apps/client/src/hooks/__tests__/useWebSocketEvents.test.ts` (existing 486-line file — add cases and extend the `mockWsService` hoist)

**Acceptance Criteria:**

- [ ] Receiving `routine:updated { routineId: 'r1' }` calls `queryClient.invalidateQueries` for `["routines"]`, `["routine", "r1"]`, and `["routine-triggers", "r1"]`.
- [ ] Receiving `user_updated { userId: 'u2' }` calls `queryClient.invalidateQueries` for `["users"]` and `["im-users", "u2"]`.
- [ ] When `user_updated.userId` equals the currently logged-in user id, the handler additionally triggers an app-store refresh (assertion described below).
- [ ] When `user_updated.userId` is not the logged-in user, app-store refresh is NOT called.
- [ ] Existing handler-registration tests still pass.

**Verify:** `pnpm --filter client test useWebSocketEvents.test`

**Steps:**

- [ ] **Step 1: Extend the hoisted mocks in the test file**

Edit `apps/client/src/hooks/__tests__/useWebSocketEvents.test.ts`. In the `mockWsService` hoist (lines 33-91), add two more helpers following the existing pattern:

```ts
  onRoutineUpdated: vi.fn((callback: (...args: any[]) => void) =>
    mockWsService.on("routine:updated", callback),
  ),
  offRoutineUpdated: vi.fn(),
  onUserUpdated: vi.fn((callback: (...args: any[]) => void) =>
    mockWsService.on("user_updated", callback),
  ),
  offUserUpdated: vi.fn(),
```

The existing `mockQueryClient.invalidateQueries` (line 107) is a `vi.fn()` that already records calls — no change needed.

For the app-store mock, the test currently mocks `@/stores` with `useUser: () => ({ id: "user-1" })` (line 120). Extend this mock so the hook can access a setter for multi-device sync. Add to the mock:

```ts
const mockSetUser = vi.hoisted(() => vi.fn());
vi.mock("@/stores", () => ({
  useSelectedWorkspaceId: () => "workspace-1",
  useUser: () => ({ id: "user-1" }),
  setUser: mockSetUser, // matches the exported helper at useAppStore.ts:226
}));
```

If `@/stores/index.ts` does not re-export `setUser`, add a lightweight re-export there:

```ts
export { setUser } from "./useAppStore";
```

This is a small, additive change — `setUser` already exists as a top-level export from `useAppStore.ts:226`.

- [ ] **Step 2: Write the failing tests**

Add a new describe block near the existing routine/notification sections:

```ts
describe("routine:updated handler", () => {
  it("invalidates routines list, routine detail, and triggers", () => {
    renderHook(() => useWebSocketEvents());

    const handler = listeners.get("routine:updated")?.[0];
    handler?.({ routineId: "r-123" });

    expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["routines"],
    });
    expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["routine", "r-123"],
    });
    expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["routine-triggers", "r-123"],
    });
  });
});

describe("user_updated handler", () => {
  beforeEach(() => {
    mockQueryClient.invalidateQueries.mockClear();
    mockSetUser.mockClear();
  });

  it("invalidates users and per-user im-users caches", () => {
    renderHook(() => useWebSocketEvents());

    const handler = listeners.get("user_updated")?.[0];
    handler?.({ userId: "user-other" });

    expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["users"],
    });
    expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["im-users", "user-other"],
    });
  });

  it("does NOT refresh the app-store user when event is for a different user", () => {
    renderHook(() => useWebSocketEvents());

    const handler = listeners.get("user_updated")?.[0];
    handler?.({ userId: "user-other" });

    expect(mockSetUser).not.toHaveBeenCalled();
  });

  it("refreshes the app-store user when event targets the logged-in user", async () => {
    const fetchedUser = { id: "user-1", displayName: "New Name" };
    mockGetCurrentUser.mockResolvedValueOnce(fetchedUser);

    renderHook(() => useWebSocketEvents());

    const handler = listeners.get("user_updated")?.[0];
    await handler?.({ userId: "user-1" });

    // The handler kicks off `api.user.getCurrentUser().then(setUser)` — let
    // the microtask queue drain before asserting.
    await vi.waitFor(() =>
      expect(mockSetUser).toHaveBeenCalledWith(fetchedUser),
    );
  });
});
```

`mockGetCurrentUser` is a top-level hoist that wires `api.user.getCurrentUser`:

```ts
const mockGetCurrentUser = vi.hoisted(() => vi.fn());

vi.mock("@/services/api", () => ({
  default: {
    user: {
      getCurrentUser: mockGetCurrentUser,
      // ...spread any other `user.*` methods the hook touches; keep the mock
      // minimal — only what useWebSocketEvents calls on `api`.
    },
  },
}));
```

Put both the `vi.hoisted` and the `vi.mock` at the top of the file alongside the existing `vi.mock("@/stores", ...)`. This is the vitest-correct way to stub the api module — `vi.mock` inside a test body is not hoisted.

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter client test useWebSocketEvents.test`

Expected: three failures on the new cases — `invalidateQueries` not called with the new keys, `setUser` not called.

- [ ] **Step 4: Register handlers in the hook**

Edit `apps/client/src/hooks/useWebSocketEvents.ts`. After the existing `handleRoutineExecutionCreated` (around line 292), add:

```ts
const handleRoutineUpdated = (event: RoutineUpdatedEvent) => {
  queryClient.invalidateQueries({ queryKey: ["routines"] });
  queryClient.invalidateQueries({ queryKey: ["routine", event.routineId] });
  queryClient.invalidateQueries({
    queryKey: ["routine-triggers", event.routineId],
  });
};

const handleUserUpdated = (event: UserUpdatedEvent) => {
  queryClient.invalidateQueries({ queryKey: ["users"] });
  queryClient.invalidateQueries({
    queryKey: ["im-users", event.userId],
  });

  // Multi-device self-sync: when another device changed my own profile,
  // refetch /users/me and push the fresh row into the Zustand app store.
  if (currentUser && event.userId === currentUser.id) {
    void api.user
      .getCurrentUser()
      .then((fresh) => setUser(fresh))
      .catch(() => {
        // Swallow — the cache invalidation above still drives any
        // mounted React Query subscribers to refetch.
      });
  }
};
```

`currentUser` comes from `useUser()` (imported from `@/stores` — already referenced in the hook per the mock setup). Add the missing imports at the top of the file:

```ts
import { useUser, setUser } from "@/stores";
import api from "@/services/api";
import type {
  RoutineUpdatedEvent,
  UserUpdatedEvent,
  // ...existing imports
} from "@/types/ws-events";
```

Add a hook-scoped `const currentUser = useUser();` near the top of `useWebSocketEvents` if one doesn't already exist.

Register the handlers in the `useEffect` subscription block (around line 352 where `onRoutineStatusChanged` / `onRoutineExecutionCreated` are wired):

```ts
wsService.onRoutineUpdated(handleRoutineUpdated);
wsService.onUserUpdated(handleUserUpdated);
```

And in the cleanup return:

```ts
return () => {
  // ...existing cleanup
  wsService.offRoutineUpdated(handleRoutineUpdated);
  wsService.offUserUpdated(handleUserUpdated);
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter client test useWebSocketEvents.test`

Expected: all cases green.

- [ ] **Step 6: Smoke-test in dev**

Run: `pnpm dev` and exercise:

1. Log in on the desktop client, open the routine list.
2. From a second browser or via `curl`, `PATCH /api/v1/routines/:id` with a new title.
3. Left list should re-render with the new title within ~1 s (no manual refresh).
4. `PATCH /api/v1/im/users/me` with a new displayName — the app's user display should refresh without reload.

If either step stays stale, check the browser console for the raw socket event (use `wsService` debug output) to confirm delivery, then recheck the invalidation key matches the query key at the receiving component.

- [ ] **Step 7: Commit**

```bash
git add apps/client/src/hooks/useWebSocketEvents.ts apps/client/src/hooks/__tests__/useWebSocketEvents.test.ts apps/client/src/stores/index.ts
git commit -m "feat(client): invalidate caches and self-sync on routine/user updates"
```

---

## After all tasks

- Run the full test matrix once: `pnpm test` (server + client). All green.
- Run typecheck: `pnpm --filter client typecheck`.
- Take one more manual pass: refresh the left-side routine list via AI bot edit (the original motivating case) and confirm it updates live.
- Hand off to a review loop (per project CLAUDE.md) — expect findings on test-fixture style consistency, React hook dependency arrays in the new handler, and any missing bad-case coverage.

## Open items left to the executor

- If `routines.service.spec.ts` does not already supply a `WEBSOCKET_GATEWAY` provider in its test module, add one mirroring `routine-bot.service.spec.ts:119`.
- If `@/stores/index.ts` does not already re-export `setUser`, add the re-export (small additive change; `setUser` is already a top-level export in `useAppStore.ts:226`).
- If the client `services/api/index.ts` path or `getCurrentUser` export differs from the assumption, update the import and the test mock accordingly — the shape (a function returning `Promise<User>`) is what matters, not the exact module path.
