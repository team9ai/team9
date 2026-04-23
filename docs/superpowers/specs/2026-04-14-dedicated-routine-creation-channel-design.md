# Dedicated Routine Creation Channel — Design

**Date:** 2026-04-14
**Status:** Approved, pending implementation plan
**Related:** `docs/superpowers/specs/2026-04-09-intelligent-routine-creation-design.md` (Phase 1/1.5)

## Overview

Phase 1 of intelligent routine creation routes the creation conversation through the user's **existing DM** with the selected bot (via `ChannelsService.createDirectChannel`, which reuses any open DM). This produces two user-facing problems:

1. Every new draft jumps the user into the same DM they already have with the bot, mixing creation messages with normal conversation history.
2. The existing `ChannelsService.archiveCreationChannel()` helper is orphaned — archiving a reused DM would destroy the user's actual chat history, so it is never called.

This design replaces the DM reuse with a **dedicated channel** that:

- Lives as a new `routine-session` channel type with a `purpose` field stored in `propertySettings`
- Does not appear in the Home or Messages sub-sidebars — it is surfaced only as a "special run" entry at the bottom of its parent routine's RunItem list inside the Routines page
- Archives cleanly when the routine transitions from `draft` → `upcoming`
- Hard-deletes when the draft routine is deleted

The new type is deliberately named **`routine-session`** rather than `routine-creation` so the same infrastructure can later host self-reflection, retrospective, or other routine-bound agent sessions without further schema churn.

**Scope (P0):** Implement dedicated creation channels end to end. Lay the `routine-session` + `purpose` foundation so future purposes (`reflection`, `retrospective`) plug in without schema changes, but do **not** implement those use cases here.

## Design Decisions

### 1. Why a dedicated channel type and not reuse

- **Reusing `direct`**: breaks the invariant that a (user, bot) pair has at most one direct channel; sidebar dedupe logic would break
- **Reusing `private`**: pollutes the Home sub-sidebar private channel list and requires a filter rule scattered across consumers
- **Reusing `task`**: semantically mismatched — `task` is already used for agent execution tracking with its own `deactivateChannel` / `activateChannel` / snapshot lifecycle
- **New `routine-session` enum value**: one-time migration cost, clean filter semantics, natural grouping for future routine-bound session purposes

### 2. Why surface only as a "special run"

Routine-session channels are short-lived meta conversations bound to a single routine. They do not belong in the global DM / channel lists because:

- They clutter the DM list with transient entries for every draft
- Users have a single entry point mental model — the draft card on the Routines page — which already anchors access
- The Routines page left column already renders per-routine execution runs, so adding a "creation run" entry piggybacks on existing affordances
- A 1:1 relationship between draft card and creation session means sidebar redundancy adds no value

### 3. Why lazy channel creation

Onboarding Phase 1.5 provisions N draft routines at once. If each draft eagerly provisioned a channel + claw-hive kickoff event, we would:

- Occupy N channels up front that the user may never touch
- Serialize N claw-hive API calls during onboarding, increasing latency and failure surface
- Couple `provisionRoutines` to claw-hive availability

Instead, draft routines start with `creationChannelId = null`. The channel is materialized the first time the user clicks "Complete Creation" on a draft card. The Agent picker path (which builds a draft specifically to enter creation immediately) triggers the same materialization as part of a single compound action — the user experience is indistinguishable.

### 4. Why archive on completion, hard delete on draft deletion

- **Completion → archive**: the routine becomes real; the creation conversation has audit value ("how was this routine originally discussed"). Reuses the existing `archiveCreationChannel` helper.
- **Draft deletion → hard delete**: the user explicitly said "throw this away"; archiving would contradict intent. Hard delete reuses the existing cascade in `db.delete(channels)` — implementation cost is ~3 lines.

Two paths, honest to user intent, minimal code duplication.

### 5. Why a compound `with-creation-task` endpoint + a standalone `start-creation-session`

The two user flows (Agent picker / draft card) share a materialization step: "build a routine-session channel for this draft + send kickoff event + persist IDs". The standalone endpoint expresses that step cleanly. The existing `with-creation-task` endpoint becomes a compound sugar that calls `create` + `startCreationSession` internally.

This keeps:

- AgenticAgentPicker unchanged at the network level (still calls `with-creation-task`)
- DraftRoutineCard simple (calls `startCreationSession` when `creationChannelId` is null)
- Backend logic for materialization in exactly one place

## Data Model

### Channel type enum

Add a new value to the existing enum:

```typescript
// apps/server/libs/database/src/schemas/im/channels.ts
export const channelTypeEnum = pgEnum("channel_type", [
  "direct",
  "public",
  "private",
  "task",
  "tracking",
  "echo",
  "routine-session", // NEW
]);
```

### Purpose stored in `propertySettings`

No new column. The existing `im_channels.property_settings` jsonb column carries the routine-session metadata:

```typescript
// Invariant: every channel with type='routine-session' has this shape
propertySettings: {
  routineSession: {
    purpose: 'creation', // 'creation' | 'reflection' | 'retrospective' (future)
    routineId: string,   // FK-like reference, used for audit queries
  }
}
```

### Routine table — unchanged

`routine__routines.creation_channel_id` already exists from Phase 1 with `onDelete: 'set null'`. It is reused as-is.

### Migration

One new migration file:

```sql
-- apps/server/libs/database/migrations/00XX_routine_session_channel_type.sql
ALTER TYPE channel_type ADD VALUE IF NOT EXISTS 'routine-session';
```

PostgreSQL 12+ allows `ALTER TYPE ADD VALUE` inside a transaction. The drizzle migration runner executes each migration file in a transaction, so this works without special handling.

**Zero data migration.** Existing routines either have `creationChannelId = null` or point to a reused DM (which continues to exist unchanged). No backfill needed.

## Backend Changes

### `ChannelsService.createRoutineSessionChannel`

```typescript
async createRoutineSessionChannel(params: {
  creatorId: string;       // real user id
  botUserId: string;       // bot shadow user id
  tenantId: string;
  routineId: string;
  purpose: 'creation';     // extensible, but P0 only produces 'creation'
}): Promise<ChannelResponse>
```

Implementation:

1. `INSERT im_channels (id, tenant_id, type='routine-session', name=null, created_by=creatorId, property_settings=...)` where `property_settings.routineSession = { purpose, routineId }`
2. `addMember(channel.id, creatorId, 'member')`
3. `addMember(channel.id, botUserId, 'member')`
4. Return the new channel row

Channels of type `routine-session` are not routed through the DM visibility auto-unhide logic in `im-worker/message.service.ts` because that logic gates on `channel.type IN ('direct', 'echo')`. No change needed to im-worker.

### `ChannelsService.archiveCreationChannel` — tighten

Existing method already performs a soft archive by channel id. Add a guard: only channels with `type = 'routine-session'` (or the existing Phase 1 `direct`-reuse callers — which will be removed) are allowed. This prevents accidental misuse against unrelated channels.

### `ChannelsService.hardDeleteRoutineSessionChannel` — new

```typescript
async hardDeleteRoutineSessionChannel(
  channelId: string,
  tenantId?: string,
): Promise<void>
```

Implementation (single transaction):

1. `findById(channelId)` — 404 if missing
2. Assert `channel.type === 'routine-session'` and (if `tenantId` provided) `channel.tenantId === tenantId`
3. `DELETE FROM im_audit_logs WHERE channel_id = $1` — defensive: the FK on this table has no cascade (NO ACTION) so a row pointing here would block step 4. Channel CRUD does not write audit logs today, but future code paths might.
4. `db.delete(channels).where(eq(channels.id, channelId))` — FK cascades drop `im_channel_members`, `im_messages`, `im_channel_search`, `im_channel_property_definitions`, `im_channel_views`, `im_notification_preferences`, `im_channel_tabs`, `im_user_channel_read_status`, `im_notifications`. `im_files.channel_id` is set to NULL.
5. `redis.invalidate(REDIS_KEYS.CHANNEL_CACHE(channelId))`

### `RoutinesService.createWithCreationTask` — refactor to compound

Refactor into a thin wrapper around `create` + `startCreationSession`:

```typescript
async createWithCreationTask(dto, userId, tenantId) {
  // Step 1: validate bot belongs to tenant (existing logic kept here so
  // the caller fails fast before a draft row is written)
  const sourceBot = await this.botsService.getBotById(dto.agentId);
  // ... existing validation ...

  // Step 2: build draft routine
  const draft = await this.create(
    { title, botId: dto.agentId, status: 'draft' },
    userId,
    tenantId,
  );

  // Step 3: materialize the creation channel + kickoff event
  try {
    const session = await this.startCreationSession(draft.id, userId, tenantId);
    return {
      routineId: draft.id,
      creationChannelId: session.creationChannelId,
      creationSessionId: session.creationSessionId,
    };
  } catch (e) {
    // Roll back the draft — the user was promised a single atomic action
    await this.db.delete(schema.routines).where(eq(schema.routines.id, draft.id));
    throw e;
  }
}
```

The single source of truth for "build channel + send kickoff event + persist ids" is `startCreationSession`. The compound wrapper exists only for the Agent picker flow that wants both steps in a single network round-trip.

### `RoutinesService.startCreationSession` — new

```typescript
async startCreationSession(
  routineId: string,
  userId: string,
  tenantId: string,
): Promise<{ creationChannelId: string; creationSessionId: string }>
```

Implementation:

1. Load routine; validate it exists, `tenantId` matches, `creatorId === userId`, `status === 'draft'`
2. **Idempotency**: if `creationChannelId` is already set, return the existing `{ creationChannelId, creationSessionId }` without re-creating anything
3. Load the bound bot via `routine.botId`; extract `managedMeta.agentId`; 400 if missing
4. Call `channelsService.createRoutineSessionChannel({ creatorId, botUserId, tenantId, routineId, purpose: 'creation' })`
5. Derive `sessionId = team9/${tenantId}/${agentId}/dm/${channel.id}`
6. `UPDATE routine__routines SET creation_channel_id=channel.id, creation_session_id=sessionId WHERE id=routineId`
7. Send the kickoff input: `clawHiveService.sendInput(sessionId, { type: 'team9:routine-creation.start', payload: { routineId, creatorUserId, tenantId, title } }, tenantId)`
8. Return `{ creationChannelId, creationSessionId }`

Rollback on failure: if any step after channel creation fails, attempt to `hardDeleteRoutineSessionChannel` the newly-created channel row. Do not touch the draft routine — it remains a draft with `creationChannelId=null`, ready for retry.

### `RoutinesController` — new endpoint

```typescript
@Post(':id/start-creation-session')
@UseGuards(JwtAuthGuard)
async startCreationSession(
  @Param('id', ParseUUIDPipe) routineId: string,
  @CurrentUser('sub') userId: string,
  @CurrentTenantId() tenantId: string,
): Promise<{ creationChannelId: string; creationSessionId: string }>
```

Declared before any `@Get(':id')` / `@Put(':id')` wildcards to avoid route shadowing.

### `RoutinesService.completeCreation` — archive on success

Append after the status transition:

```typescript
if (routine.creationChannelId) {
  try {
    await this.channelsService.archiveCreationChannel(
      routine.creationChannelId,
      tenantId,
    );
  } catch (e) {
    this.logger.warn(
      `Failed to archive creation channel ${routine.creationChannelId} for routine ${routineId}: ${e}`,
    );
    // non-fatal
  }
}
```

### `RoutinesService.delete` — hard delete on draft deletion

Append before (or after) the routine row delete:

```typescript
if (routine.creationChannelId) {
  try {
    await this.channelsService.hardDeleteRoutineSessionChannel(
      routine.creationChannelId,
      tenantId,
    );
  } catch (e) {
    this.logger.warn(
      `Failed to hard-delete creation channel for routine ${routineId}: ${e}`,
    );
  }
}
```

Order does not matter: `creation_channel_id` has `onDelete: 'set null'`, so deleting the routine row first still works. Deleting the channel first also works because `hardDeleteRoutineSessionChannel` does not check any routine back-reference. We chain them defensively inside a single service method; no explicit transaction needed.

## Frontend Changes

### Channel type union

```typescript
// apps/client/src/types/channel.ts (or wherever ChannelType lives)
export type ChannelType =
  | "direct"
  | "public"
  | "private"
  | "task"
  | "tracking"
  | "echo"
  | "routine-session"; // NEW
```

`useChannelsByType` in [useChannels.ts:98](../../../apps/client/src/hooks/useChannels.ts#L98) naturally excludes `routine-session` because its filters match `direct | echo` for DMs and `public | private` for the channel list — no change required.

### API client

```typescript
// apps/client/src/services/api/routines.ts
startCreationSession(routineId: string): Promise<{
  creationChannelId: string;
  creationSessionId: string;
}>
```

Calls `POST /v1/routines/:id/start-creation-session`.

### `RoutineList` — creation-run rendering and selection

Extend the left column to treat a draft routine with `creationChannelId` as having one synthetic "creation run" entry at the **bottom** of its expanded RunItem list (after any real executions — currently drafts have none, but the rule is forward-compatible).

Selection:

- Replace `selectedRunId: string | null` with a discriminated shape: `{ kind: 'execution', id: string } | { kind: 'creation', routineId: string } | null`. Alternatively use a sentinel `'creation'` string tied to `activeRoutineId`. The discriminated-union form is preferred for type safety.
- When a creation run is selected, `ChatArea` receives `channelId = routine.creationChannelId` and no `selectedRun` / `activeExecution`.

A new prop `onOpenCreationSession(routineId: string)` is threaded from `RoutineList` down to both `DraftRoutineCard` and `AgenticAgentPicker` (via `RoutineList`'s state handlers). The handler:

1. `setExpandedRoutineIds(prev => new Set(prev).add(routineId))`
2. `setActiveRoutineId(routineId)`
3. `setSelectedRun({ kind: 'creation', routineId })`

### `CreationSessionRunItem` — new component

```typescript
// apps/client/src/components/routines/CreationSessionRunItem.tsx
interface CreationSessionRunItemProps {
  isSelected: boolean;
  onClick: () => void;
}
```

Presentation:

- Icon: `MessageSquare` from lucide
- Label: `t('creation.runLabel', 'Routine Creation')` (EN) / `创建日常任务会话` (ZH)
- Distinct background so users can tell it apart from real executions (yellow accent echoing the draft badge)
- Selected/hover states match `RunItem` for consistency

### `RoutineCard` — conditional injection

When `routine.status === 'draft' && routine.creationChannelId`, render a `CreationSessionRunItem` at the bottom of the expanded runs list. Selection state is owned by `RoutineList`.

Hide rule: when `routine.status !== 'draft'`, never render the creation run — even if `creationChannelId` is still present (this happens briefly between complete-creation and cache refetch; defensive consistency).

### `ChatArea` — draft / creation-session rendering mode

Current `ChatArea` renders `ChannelView` for a selected execution and layers run-specific controls on top. Extend it to accept a "creation mode" where:

- `selectedRun` / `activeExecution` are null
- `channelId` comes from `routine.creationChannelId`
- Run header controls (rerun, pause, play, restart) are hidden
- A draft-mode banner replaces them: shows the routine title + draft badge + "In Creation" status indicator
- `ChannelView` continues to render messages normally (read/write — the user is still conversing with the agent)

### `DraftRoutineCard` — "Complete Creation" behaviour

Current logic (disabled when `creationChannelId` is null) is replaced:

```typescript
async function handleCompleteCreation() {
  let channelId = routine.creationChannelId;
  if (!channelId) {
    const res = await api.routines.startCreationSession(routine.id);
    channelId = res.creationChannelId;
    await queryClient.invalidateQueries({ queryKey: ["routines"] });
  }
  onOpenCreationSession(routine.id);
}
```

The button is always enabled for drafts (no more "no creation channel" tooltip). A transient loading state covers the `startCreationSession` call.

### `AgenticAgentPicker` — "Start Creation" behaviour

Current: calls `createWithCreationTask`, then navigates to `/messages/$channelId`.

New: calls `createWithCreationTask` (backend semantics unchanged — it still returns `creationChannelId`), then:

1. Closes the modal
2. Invalidates the routines query
3. Calls `onOpenCreationSession(newRoutineId)` — no router navigation; the user is already on `/routines`

### Sidebar filter cleanup

`MessagesSubSidebar` and `HomeSubSidebar` need no code changes since `useChannelsByType` already excludes unknown types from its grouped outputs. Add a defensive unit test that asserts a `routine-session` channel does not appear in `directChannels` / `publicChannels` / `privateChannels`.

## Data Flow

### Flow A — Agent picker: "Start Creation"

```
1. User opens AgenticAgentPicker from the "+" button on the Routines page
2. Selects a bot, clicks "Start Creation"
3. Client → POST /v1/routines/with-creation-task { agentId }
4. Server (createWithCreationTask):
   a. validate bot + tenant
   b. insert draft routine (status='draft', botId, auto title)
   c. channelsService.createRoutineSessionChannel(...)
   d. derive sessionId = team9/{tenant}/{agentId}/dm/{channelId}
   e. update routine.creationChannelId / creationSessionId
   f. clawHive.sendInput(sessionId, { type: 'team9:routine-creation.start', ... })
5. Server returns { routineId, creationChannelId, creationSessionId }
6. Client:
   a. queryClient.invalidateQueries(['routines'])
   b. AgenticAgentPicker.onClose()
   c. onOpenCreationSession(routineId)
      → expand the routine card
      → setSelectedRun({ kind: 'creation', routineId })
7. ChatArea renders routine-session channel via ChannelView
```

### Flow B — Existing draft: "Complete Creation"

```
1. User clicks "Complete Creation" on a draft card
2. Client: check routine.creationChannelId
   a. null → POST /v1/routines/:id/start-creation-session
   b. set → skip to step 4
3. Server (startCreationSession):
   a. validate routine (exists, draft, creator)
   b. idempotent: if creationChannelId already set, return existing
   c. createRoutineSessionChannel + sessionId + persist + kickoff event
   d. return { creationChannelId, creationSessionId }
4. Client:
   a. queryClient.invalidateQueries(['routines'])
   b. onOpenCreationSession(routineId)
5. ChatArea renders routine-session channel via ChannelView
```

### Flow C — Complete creation

```
1. Agent or user triggers POST /v1/routines/:id/complete-creation
2. Server (completeCreation):
   a. validate (exists, draft, required fields)
   b. update status → 'upcoming'
   c. if creationChannelId: archiveCreationChannel(channelId, tenantId)  [NEW]
3. Client: invalidate ['routines']
4. RoutineList re-renders: routine.status === 'upcoming' → creation run hidden
5. If the user was viewing the creation run, ChatArea clears to empty state
```

### Flow D — Delete draft

```
1. User confirms delete on a draft card
2. Client: DELETE /v1/routines/:id
3. Server (delete):
   a. validate (creator only)
   b. if creationChannelId: hardDeleteRoutineSessionChannel(channelId, tenantId)  [NEW]
   c. db.delete(routines).where(id)
4. Client: invalidate ['routines']
5. Draft card disappears; creation run disappears with it
```

## State Transitions

```
┌────────────────────────────────────────────────────┐
│  draft routine, creationChannelId = null           │
│  (provisioned by onboarding, or just made by picker │
│   in an edge case where materialization is split)  │
└────────────────────────────────────────────────────┘
                     │
                     │ user clicks "Complete Creation"
                     │  → POST /:id/start-creation-session
                     ▼
┌────────────────────────────────────────────────────┐
│  draft routine, creationChannelId = X              │
│  channel type=routine-session, not archived        │
│  creation run visible on the routine card          │
└────────────────────────────────────────────────────┘
                     │
       ┌─────────────┴─────────────┐
       │                           │
       │ complete-creation         │ delete draft
       ▼                           ▼
┌─────────────────┐       ┌────────────────────┐
│ status=upcoming │       │ routine deleted    │
│ channel ARCHIVED│       │ channel HARD-DELETED│
│ creation run    │       │ draft card removed │
│ hidden          │       └────────────────────┘
└─────────────────┘
```

## Testing

### Backend unit tests

**`channels.service.spec.ts`**

- `createRoutineSessionChannel`: inserts channel with correct type, `propertySettings.routineSession.purpose`, `routineId`; adds both members
- `hardDeleteRoutineSessionChannel`: type guard rejects non-`routine-session` channels; happy path calls `db.delete` and invalidates cache; tenant mismatch rejected
- `archiveCreationChannel`: existing tests; add guard test for non-`routine-session` rejection if the guard is added

**`routines.service.spec.ts`**

- `createWithCreationTask`: swap assertion — `createRoutineSessionChannel` is called (not `createDirectChannel`) with expected params
- `startCreationSession`: new describe block
  - happy path: draft with `creationChannelId=null` → creates channel, derives session id, persists, sends kickoff event
  - idempotent: draft with `creationChannelId` already set → returns existing, does not re-create
  - non-draft routine → `BadRequestException`
  - non-creator → `ForbiddenException`
  - bot missing `managedMeta.agentId` → `BadRequestException`
  - channel creation succeeds but `sendInput` throws → rollback hard-deletes channel, routine stays with `creationChannelId=null`
- `completeCreation`: **reverse** the Phase 1 assertion `archiveCreationChannel.not.toHaveBeenCalled()` → assert it **is** called with `(creationChannelId, tenantId)`
- `delete`:
  - with `creationChannelId` → `hardDeleteRoutineSessionChannel` is called
  - without `creationChannelId` → `hardDeleteRoutineSessionChannel` is **not** called

**`routines.controller.spec.ts`**

- `POST /:id/start-creation-session` wiring test: returns service result, validates UUID param, passes `userId` and `tenantId`

### Backend integration tests

**`routines-creation-flow.integration.spec.ts`**

- End-to-end `with-creation-task` → assert `im_channels` row exists with `type='routine-session'`, `property_settings.routineSession = { purpose: 'creation', routineId }`, two members
- `start-creation-session` on a pre-existing draft → same assertions
- `complete-creation` → assert channel row has `is_archived=true`
- `delete routine` → assert channel row no longer exists and `im_channel_members` / `im_messages` for it are gone

### Frontend unit tests

**`CreationSessionRunItem.test.tsx`** (new)

- renders the label, icon, and responds to click

**`RoutineList.test.tsx`** (new or extended)

- draft routine with `creationChannelId` → creation run appears at the bottom of the expanded runs list
- `routine.status === 'upcoming'` → creation run is **not** rendered even if `creationChannelId` still present
- clicking the creation run sets selection to `{ kind: 'creation', routineId }` and ChatArea receives `creationChannelId`

**`DraftRoutineCard.test.tsx`** (extended)

- `creationChannelId === null`: clicking "Complete Creation" calls `api.routines.startCreationSession`, then `onOpenCreationSession(routineId)`
- `creationChannelId` already set: clicking "Complete Creation" calls `onOpenCreationSession(routineId)` without hitting the API
- `startCreationSession` rejects → error surfaced, card stays usable

**`AgenticAgentPicker.test.tsx`** (extended)

- "Start Creation" calls `createWithCreationTask`, then `onClose` and `onOpenCreationSession(newRoutineId)` — **no** router navigation

**`useChannelsByType.test.ts`** (extended or new)

- a `routine-session` channel passed into `useChannels` output is excluded from `directChannels`, `publicChannels`, `privateChannels`

### Regression coverage

- Phase 1.5 `provisionRoutines` behaviour unchanged (existing onboarding tests must still pass)
- Old assertions that `with-creation-task` navigates to `/messages/{id}` must be removed or rewritten for the new in-page selection flow

## Out of Scope

- Self-reflection and retrospective routine-session purposes (the infrastructure is laid but no product surface is added)
- Archived creation channel history viewer on the routine detail page
- Onboarding drafts letting the user change the executing agent (Phase 2 #8)
- Onboarding drafts having AI-generated starter `documentContent` (Phase 2 #7)
- Multi-user collaborative editing of a single draft
- 4-step manual form with structured validation (Phase 2 #1)

## Risks and Mitigations

| Risk                                                                                                | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ALTER TYPE ADD VALUE` fails in a drizzle migration transaction (PG version mismatch)               | Drizzle runs each migration file in its own transaction; PG 12+ supports `ADD VALUE` inside a transaction. Verify target DB version (Railway Postgres is 15+). Provide a standalone fallback migration script that can be run outside a transaction if needed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `startCreationSession` partial failure (channel created but kickoff event fails)                    | The new service method catches the event error and hard-deletes the channel before rethrowing. The draft routine is untouched, so retry works. The idempotent path (channel already set) also handles the double-click race.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Hard-delete cascade misses a FK                                                                     | All FK references to `channels.id` use `onDelete: 'cascade'` **except**: `im_audit_logs.channel_id` (no action — latent FK violation if any audit row points at a `routine-session` channel) and `im_files.channel_id` (`set null`, safe). `channels.service.ts` does not write audit logs for channel CRUD, and routine-session channels have no property definitions or files attached, so the latent path is currently unreachable. Defensive measure: `hardDeleteRoutineSessionChannel` runs `DELETE FROM im_audit_logs WHERE channel_id = $1` before deleting the channel row, inside a single transaction, to guarantee correctness even if a future code path starts logging. Integration test asserts `im_channel_members` and `im_messages` are gone after delete. |
| Consumers still expect the old `/messages/:channelId` navigation behaviour                          | Only `AgenticAgentPicker` and `DraftRoutineCard` call into the affected code paths; both are updated here. A grep for `creationChannelId` in `apps/client/src` confirms no other consumers navigate to `/messages/:id` using that field.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `selectedRunId` string sentinel causes type drift                                                   | Use a discriminated union (`{ kind: 'execution' \| 'creation', ... }`) rather than a magic string. Compiler flags any missed case.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `DraftRoutineBanner` (on the routine detail page) also references `creationChannelId` and navigates | Verify behaviour: banner lives on `/routines/:id` detail, which this design does not cover for routing changes. Banner navigation to `/messages/:channelId` still works for upcoming routines that retain the archived channel id, but the archived channel is no longer user-reachable. Decision: update the banner in the implementation plan to instead open the routine card's creation run if still a draft, or remove the CTA entirely if routine is upcoming (since the channel is archived).                                                                                                                                                                                                                                                                        |

## Changelog

### 2026-04-14 — Initial revision

- Introduced `routine-session` channel type + `propertySettings.routineSession.purpose` schema
- Replaced DM reuse in `createWithCreationTask` with `createRoutineSessionChannel`
- Added `POST /v1/routines/:id/start-creation-session` for lazy channel materialization
- Wired `completeCreation` to `archiveCreationChannel` (reversing the Phase 1 decision)
- Wired `delete` draft to `hardDeleteRoutineSessionChannel`
- Surfaced creation channel as a "special run" at the bottom of the expanded routine card
- AgenticAgentPicker and DraftRoutineCard no longer navigate to `/messages/:id`; both route through `onOpenCreationSession` to stay inside the Routines page
