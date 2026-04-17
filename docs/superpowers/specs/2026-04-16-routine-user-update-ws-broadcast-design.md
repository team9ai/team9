# Routine & User Update WebSocket Broadcast

**Date:** 2026-04-16
**Status:** Design approved, ready for planning
**Author:** collaborative (Winrey + Claude)

## Problem

When an AI bot edits a routine via the update tool (`PATCH /api/v1/bot/routines/:routineId`), the left-side routine list in the client does not refresh until the user manually navigates away or the periodic poll fires. Inspection shows two layered gaps:

1. **Backend never broadcasts.** `RoutineBotService.updateRoutine()` writes to the DB and returns. It does not emit any WebSocket event. The same gap exists on the user-facing REST path `PATCH /api/v1/routines/:id` (`RoutinesService.update()`) and on the trigger update endpoints.
2. **User profile has the same defect.** `PATCH /api/v1/users/me` (`users.controller.ts` `updateMe()`) writes to the DB and returns without broadcasting, so name/avatar/profile changes don't sync across devices or to other workspace members viewing that user.

The only routine-shaped events that exist today are `routine:status_changed` and `routine:execution_created`, both emitted from control endpoints (start/pause/stop). Those events are already wired on the client and invalidate `["routines"]` + `["routine", id]` React Query caches — the pattern is proven, it just doesn't cover field-level updates.

## Goals

- AI tool edits to a routine propagate to the client in real time.
- User REST edits to a routine propagate to the client in real time.
- Trigger updates on a routine propagate to the client in real time.
- User profile edits (name, avatar, etc.) propagate in real time, including multi-device self-sync for the logged-in user.
- New code reuses the existing workspace-scoped broadcast + React Query invalidation pattern; no new transport, no new room scheme.

## Non-Goals

- Optimistic UI / partial-payload merging. Events carry IDs only; clients refetch.
- Broadcasting trigger CRUD as a separate `trigger:updated` event. Triggers are a subordinate part of a routine; reusing `routine:updated` is sufficient for the left-list UI.
- Broadcasting changes to ephemeral sub-resources (routine executions, steps, deliverables) — those already have dedicated event streams.
- Reworking the existing `routine:status_changed` semantics.
- Invalidating IM user search caches (`["im-users", "search", ...]`) — too broad, low value.

## Design

### Event definitions

Add two event constants in `apps/server/libs/shared/src/events/event-names.ts`:

```ts
ROUTINE: {
  STATUS_CHANGED: 'routine:status_changed',       // existing
  EXECUTION_CREATED: 'routine:execution_created', // existing
  UPDATED: 'routine:updated',                     // NEW
},
USER: {
  ONLINE: 'user_online',                          // existing
  OFFLINE: 'user_offline',                        // existing
  STATUS_CHANGED: 'user_status_changed',          // existing
  UPDATED: 'user_updated',                        // NEW (underscore style to match siblings)
},
```

Event naming follows each namespace's existing convention: `routine:` uses colon, `user_` uses underscore. This matches what the client already does on the wire.

### Payload shape — ID-only

Both events carry the entity ID and nothing else:

```ts
interface RoutineUpdatedEvent {
  routineId: string;
}

interface UserUpdatedEvent {
  userId: string;
}
```

**Rationale.** Entity updates are infrequent; the cost of a client refetch is negligible compared to the risk of stale cache from out-of-order or partial-delivery events. DB stays the single source of truth. This matches the behavior React Query already expects from invalidate-then-refetch.

### Room scoping

Both events broadcast to `workspace:{tenantId}` rooms via `WebsocketGateway.broadcastToWorkspace(...)`.

- Routine: broadcast to `routine.tenantId`.
- User: enumerate all workspaces the user belongs to (via `WorkspaceService.getWorkspaceIdsByUserId`) and broadcast to each, mirroring the existing `updateStatus` pattern in `users.controller.ts`.

### Backend emit points

| Location                                                         | Trigger                                                                                              | Event                                                       |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `RoutineBotService.updateRoutine()` tail, after `db.update`      | AI tool `PATCH /bot/routines/:id`                                                                    | `routine:updated`                                           |
| `RoutinesService.update()` tail                                  | User REST `PATCH /routines/:id`                                                                      | `routine:updated`                                           |
| `RoutineTriggersService.create()` / `update()` / `delete()` tail | Single-trigger CRUD endpoints (`POST` / `PATCH` / `DELETE /routines/:routineId/triggers/:triggerId`) | `routine:updated` (using parent `routineId`)                |
| `RoutinesService.completeCreation()` tail                        | Draft→upcoming transition on `POST /routines/:id/complete-creation`                                  | `routine:updated`                                           |
| `RoutinesService.delete()` tail                                  | `DELETE /routines/:id`                                                                               | `routine:updated` (signals client list refetch)             |
| `UsersController.updateMe()`                                     | `PATCH /users/me`                                                                                    | `user_updated` to each `workspace:{id}` the user belongs to |

**No duplicate emits.** `RoutineTriggersService.replaceAllForRoutine()` and the private `createInternal()` helper do NOT emit — the outer caller (`RoutinesService.update`, `RoutineBotService.updateRoutine`, or `RoutinesService.create` via `createBatch`) is responsible for exactly one emit per user-visible mutation. `RoutinesService.create()` itself does not emit because creation is a distinct operation; the single-trigger `POST /routines/:routineId/triggers` endpoint does emit via `create()`, which is correct.

**Error handling.** Broadcast calls use `await` and propagate errors, matching the existing `routine:status_changed` pattern in `RoutineBotService.updateStatus()`. If the broadcast throws, the HTTP request returns 500 after the DB has already been written — surfacing the transport problem rather than silently masking it. If real-world operations show this is too harsh, we can revisit.

### Client subscription + cache invalidation

Extend `apps/client/src/services/websocket/index.ts` with two new helpers — `onRoutineUpdated(cb)` and `onUserUpdated(cb)` — following the shape of the existing `onRoutineStatusChanged` / `onUserStatusChanged` helpers.

Register handlers in `apps/client/src/hooks/useWebSocketEvents.ts`:

```ts
const handleRoutineUpdated = (event: RoutineUpdatedEvent) => {
  queryClient.invalidateQueries({ queryKey: ["routines"] });
  queryClient.invalidateQueries({ queryKey: ["routine", event.routineId] });
  queryClient.invalidateQueries({
    queryKey: ["routine-triggers", event.routineId],
  });
};

const handleUserUpdated = (event: UserUpdatedEvent) => {
  queryClient.invalidateQueries({ queryKey: ["users"] }); // prefix-matches ["users", id] too
  queryClient.invalidateQueries({ queryKey: ["im-users", event.userId] });

  // Multi-device self-sync: if the update is for the current user, refresh app store
  if (event.userId === currentUser?.id) {
    // Refetch /users/me and update app store (exact mechanism: call app store's
    // setUser from re-fetched data, or invalidate the relevant store-bound query).
  }
};

wsService.onRoutineUpdated(handleRoutineUpdated);
wsService.onUserUpdated(handleUserUpdated);
```

**Why `routine-triggers` is on the routine invalidation list.** The `RoutineTriggersTab` component uses `queryKey: ["routine-triggers", routineId]`. Since the trigger-update emit paths share the `routine:updated` event, one handler covers both list and triggers tab.

**Why not invalidate `["im-users", "search", ...]` or `["im-users", "online"]`.** Search is too broad (every keystroke has its own key); online status has dedicated events.

### Multi-device self-sync for user profile

When `event.userId === currentUser.id`, the handler additionally refreshes app-level user state (Zustand `app.user` store). The exact call site depends on which store holds the current user — either invalidate a query tied to the store, or call an explicit setter after refetching `/users/me`. Implementation plan will decide the least invasive touch.

## Data flow

```
┌────────────────────┐    PATCH /bot/routines/:id    ┌─────────────────────┐
│  AI routine update │ ────────────────────────────▶ │  RoutineBotService   │
│  tool              │                                │  .updateRoutine()    │
└────────────────────┘                                │    db.update(...)    │
                                                     │    ws.broadcast(      │
                                                     │      tenantId,        │
                                                     │      'routine:updated'│
                                                     │    )                  │
                                                     └─────────┬─────────────┘
                                                               │
                                              Socket.io        ▼
                                   ┌───────────────────────────────────────┐
                                   │ room: workspace:{tenantId}            │
                                   │ event: 'routine:updated' {routineId}  │
                                   └─────────┬─────────────────────────────┘
                                             │
                   ┌─────────────────────────┴───────────────────────────┐
                   ▼                                                     ▼
      ┌─────────────────────────┐                      ┌──────────────────────────┐
      │ useWebSocketEvents      │                      │ (any other workspace     │
      │ .handleRoutineUpdated   │                      │  member client)          │
      │   invalidate            │                      └──────────────────────────┘
      │     ["routines"]        │
      │     ["routine", id]     │
      │     ["routine-triggers",│
      │       id]               │
      └───────────┬─────────────┘
                  │
                  ▼
      ┌─────────────────────────┐
      │ RoutineList re-fetches  │
      │ via React Query,        │
      │ UI updates              │
      └─────────────────────────┘
```

User flow is symmetric, with N broadcasts (one per workspace the user belongs to) instead of one.

## Testing strategy

Per project CLAUDE.md: 100% coverage on new code, happy + bad cases, regression tests where applicable.

### Backend (Jest)

- `routine-bot.service.spec.ts`
  - `updateRoutine()` happy path emits `broadcastToWorkspace(tenantId, 'routine:updated', {routineId})` exactly once per call (acknowledge potential double-emit when `dto.triggers !== undefined` — test documents this as expected).
  - Bot ownership failure → no emit.
  - Rejected status transition → no emit.
  - `dto.triggers` only → still emits (via the triggers replace path or the outer update, whichever fires).
- `routines.service.spec.ts` (or controller spec, wherever `update()` is unit-tested)
  - Happy path emits; DB failure path does not emit.
- `routine-triggers.service.spec.ts` / controller spec
  - `replaceAllForRoutine` emits using parent routineId.
  - `PATCH /:routineId/triggers/:triggerId` emits using parent routineId.
- `users.controller.spec.ts`
  - `updateMe()` emits `user_updated` for each workspace id returned by `getWorkspaceIdsByUserId`.
  - Empty workspace list → no emit (but call returns success).
  - Service throws → no emit.

### Frontend (Vitest)

- `useWebSocketEvents.test.ts`
  - `routine:updated` handler invalidates `["routines"]`, `["routine", id]`, `["routine-triggers", id]`.
  - `user_updated` handler invalidates `["users"]` and `["im-users", id]`.
  - `user_updated` where `userId === currentUser.id` additionally refreshes the app user store.
  - `user_updated` where `userId !== currentUser.id` does NOT touch the app user store.
- `websocket/index.test.ts` (if present)
  - `onRoutineUpdated` subscribes to `'routine:updated'`.
  - `onUserUpdated` subscribes to `'user_updated'`.

## Files touched

**Modified:**

- `apps/server/libs/shared/src/events/event-names.ts`
- `apps/server/apps/gateway/src/routines/routine-bot.service.ts`
- `apps/server/apps/gateway/src/routines/routines.service.ts`
- `apps/server/apps/gateway/src/routines/routine-triggers.service.ts` (and/or controller)
- `apps/server/apps/gateway/src/im/users/users.controller.ts`
- `apps/client/src/types/ws-events.ts`
- `apps/client/src/services/websocket/index.ts`
- `apps/client/src/hooks/useWebSocketEvents.ts`

**Tests added/updated:**

- `apps/server/apps/gateway/src/routines/routine-bot.service.spec.ts`
- `apps/server/apps/gateway/src/routines/routines.service.spec.ts` (create if missing)
- `apps/server/apps/gateway/src/routines/routine-triggers.service.spec.ts` (or matching controller spec)
- `apps/server/apps/gateway/src/im/users/users.controller.spec.ts`
- `apps/client/src/hooks/__tests__/useWebSocketEvents.test.ts`
- `apps/client/src/services/websocket/__tests__/*` (if a suite exists there for helper methods)

## Open implementation details (to resolve in planning)

- Exact mechanism to update the Zustand `app.user` store on self-sync (direct setter vs invalidate a store-bound query).
- Whether `RoutinesService.update()` currently has its own spec file; create if absent.
- Whether the single-trigger-update endpoint lives in the service or controller layer — influences emit placement.
