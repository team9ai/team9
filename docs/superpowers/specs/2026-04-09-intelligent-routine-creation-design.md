# Intelligent Routine Creation Design

**Date:** 2026-04-09 (revised 2026-04-10)
**Status:** Design — Revision 2

## Overview

Currently, Routine creation only supports a basic form interface. This spec introduces an intelligent creation experience with two complementary paths:

1. **DM Creation (轻量)** — The user chats with any agent in a DM and asks for a routine. The agent gathers the requirements through conversation and calls a single `createRoutine` tool once it has enough information. One round trip, no temporary state.
2. **Routine UI Creation (结构化)** — The user clicks "Create with Agentic" from the Routine list, picks an executing agent, and is taken to a dedicated **creation channel**. A purpose-built agent clone walks them through multiple rounds of refinement. A `draft` routine is persisted from the start and refined via `updateRoutine` tool calls until `complete-creation` transitions it to `upcoming`.

Both paths share the same `team9-routine-creation` claw-hive component, which provides the tool suite. The difference between the two paths is **how the component is configured**, not what it does.

## Key Corrections From Initial Review

This spec is Revision 2. Revision 1 (the original 2026-04-09 draft) contained several assumptions that did not match the actual codebase:

1. **`creationTaskId` referenced a nonexistent table.** There is no `creation_tasks` table in team9; "task" is already an overloaded term (task-worker, task channel, TaskCast). This revision removes the `creationTaskId` field and collapses "creation task" into "draft routine + creation channel".
2. **`team9Context` cannot be set session-scoped from the gateway.** The initial spec assumed `clawHiveService.createSession({ team9Context })` was the delivery vehicle, but the gateway never calls `createSession` (the auto-create-via-sendInput path drops `team9Context` entirely). A parallel bug fix (commit `76294882` in team9, `4d975ba` + `933fe8d` in team9-agent-pi) switched to per-event `team9Context` in the event payload, extracted by `Team9Component.onEvent`. Routine creation cannot rely on session-level `team9Context` either.
3. **Per-routine agent clone is the correct design.** Since we cannot piggy-back on session-level context, the `routineId` and `isCreationChannel` must be baked into the agent's `extraComponentConfigs` at registration time. Each Routine-UI creation therefore registers a short-lived agent clone of the user's selected executing staff, scoped to one routine.
4. **Draft routines are creator-only.** The initial spec said "all workspace members can see drafts but only creator can edit" — that's harder to reason about and risks polluting the list view with half-built routines from other people. Revised to: drafts appear only in the creator's list view.
5. **Inline trigger UI is deferred to Phase 2.** Phase 1 uses conversational trigger configuration: the user describes "every morning at 9", the agent parses it and saves via tool call. No A2UI widgets in the first version.
6. **`ChannelsService.archive()` does not exist yet.** The `channels.isArchived` column exists on the table, but no service method wraps it. Phase 1 adds one.
7. **`createRoutine` tool signature must be precise about defaults.** In the DM path, `botId` defaults to the current agent's own bot. `documentContent` is required for the `ready` path, optional for `draft`. See §7 for the full tool contract.

## Scope

### In Scope (Phase 1)

- Two creation entry points (DM + Routine UI)
- `draft` status added to `routine__routines.status` enum
- Two new columns: `creation_channel_id`, `creation_session_id` (both nullable, FK where applicable)
- Backend endpoints: `POST /v1/routines/with-creation-task`, `POST /v1/routines/:id/complete-creation`
- Enhanced `create` / `update` / `delete` to handle `draft` state correctly
- Claw-hive `team9-routine-creation` component + `createRoutine`, `getRoutine`, `updateRoutine` tools
- Per-routine agent clone lifecycle (register on draft creation, delete on completion or draft deletion)
- `ChannelsService.archive()` helper
- Auto-archive creation channels on completion
- Frontend: "Create with Agentic" button + agent picker + draft badge + "Complete Creation" action
- Draft routines are filtered to creator-only in the list API
- Multi-turn agentic creation flow (DM one-shot + Routine UI multi-turn both work)

### Out of Scope (Phase 2+)

- 4-step form with AI assistance (the structured manual form)
- Inline trigger UI widgets (cron picker, frequency selector, A2UI-based pickers)
- "Edit Form" affordance on a draft routine detail page
- Collaborative creation (multiple users working on one draft)
- Draft sharing
- Auto-generation of trigger suggestions from NL descriptions (beyond what the agent parses itself)

## Design Decisions

### 1. Two Creation Paths

**DM Creation (one-shot):**

- User opens any agent's DM and types something like "help me create a routine that summarizes HN every morning".
- The agent clarifies over 1–3 turns, then calls `createRoutine(title, documentContent, triggers, botId?)` **once**. `botId` defaults to the calling agent's own bot if not supplied.
- The routine is created in `upcoming` status (default), ready to run.
- No draft state, no creation channel, no agent clone.
- Suitable for quick informal creation where the user already has a clear idea.

**Routine UI Creation (multi-turn):**

- User clicks "Create with Agentic" in the Routine list, picks an agent to guide creation, clicks Confirm.
- Backend provisions: draft routine → DM channel with the agent → clones the agent with `extraComponentConfigs['team9-routine-creation'] = { routineId, isCreationChannel: true }` → sends a bootstrap `team9:routine-creation.start` event.
- The cloned agent has the `team9-routine-creation` component wired to this specific routine and uses `getRoutine` / `updateRoutine` across multiple turns to refine the plan.
- When the user is satisfied, the agent calls the backend `complete-creation` endpoint (or the user clicks "Complete Creation" in the UI). This transitions the routine from `draft` to `upcoming`, archives the creation channel, and deletes the cloned agent.
- Suitable for structured, collaborative design where the user wants to iterate.

### 2. Plan Representation

When the agent proposes a plan to the user, it's shown as a **narrative summary** (readable prose), not JSON:

```
Routine Name: Daily News Digest
Executing Agent: NewsBot
Trigger: Schedule — Daily at 09:00 UTC
What it does: Fetches top AI stories from HackerNews and Twitter, summarizes the top 5, posts to #news-updates
Key steps:
1. Query HackerNews + Twitter for top AI stories
2. Rank by relevance
3. Summarize each in 2–3 lines
4. Format as a single thread post
```

The narrative lives as regular chat messages in the creation channel. The agent re-renders it after each `updateRoutine` call so the user always sees the current state.

### 3. Trigger Configuration (Phase 1: Conversational Only)

When a user says "every morning at 9", the agent:

1. Interprets the intent into a structured trigger: `{ type: "schedule", config: { frequency: "daily", time: "09:00", timezone: "<user_tz>" } }`.
2. Calls `updateRoutine` with the new `triggers` array.
3. Confirms in chat: "Set it to run every day at 09:00 UTC. Sound right?"

If the user says "change it to 10:00", the agent re-parses, calls `updateRoutine` again, confirms. No UI widgets. All negotiation is conversational.

Phase 2 will add inline trigger picker widgets (probably via A2UI).

### 4. Draft Routine Permissions & Visibility

- Only the creator can see a draft routine. List API filters `WHERE status != 'draft' OR creator_id = currentUser`.
- Only the creator can edit, complete, or delete a draft.
- Draft routines **cannot** be executed (`start` endpoint returns 400 "Complete creation first").
- If the creator leaves the workspace, their drafts are deleted along with their bot cleanup. (Alternative: orphan and let an admin clean up — deferred unless it becomes a real problem.)

### 5. Creation Channel Lifecycle

- Created when user initiates Routine UI creation (via `ChannelsService.createDirectChannel(userId, botUserId)`).
- Channel name: `routine-creation-{first 8 chars of routineId}` for easy human filtering in the sidebar. (Not used as an identifier — routes are still by channel UUID.)
- On `complete-creation`: `ChannelsService.archive(channelId)` sets `isArchived = true`. The channel is hidden from the active list but still accessible for audit.
- If the creator deletes the draft without completing, the channel is also archived (not deleted — we keep the conversation history).

### 6. Agent Clone Lifecycle

Every Routine UI creation registers a short-lived agent in claw-hive:

- Agent ID: `routine-creation-{routineId}` (deterministic, easy to clean up)
- Blueprint: same as the user-selected executing staff (so persona/model/SOUL are preserved)
- `componentConfigs`: merged — all of the source agent's configs + an added `team9-routine-creation` config with `{ routineId, isCreationChannel: true }`
- Registered at `create-with-creation-task` time
- Deleted at `complete-creation` time (or at draft deletion time)

After the routine is completed and the clone is deleted, the **user's original executing staff** (NewsBot) is what actually runs the routine — the clone was purely for the creation conversation.

### 7. Form Strategy (Phase 2)

The 4-step form is Phase 2. For reference, its planned shape:

1. **Title + Description + Executing Agent** (required)
2. **Document** (required — the prompt/instructions)
3. **Triggers** (≥1 required)
4. **Review & Save** — "Save as Draft" or "Create & Start"

Phase 1 users who want structure without agentic help will have to use the DM path and dictate a complete plan to any agent in one message.

## Data Model

### `routine__routines` Table Changes

```typescript
// drizzle schema additions
status: routineStatusEnum('status').default('draft').notNull(),
creationChannelId: uuid('creation_channel_id').references(
  () => channels.id,
  { onDelete: 'set null' },
),
creationSessionId: varchar('creation_session_id', { length: 255 }),
```

Enum additions:

```typescript
export const routineStatusEnum = pgEnum("routine__status", [
  "draft", // NEW
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

Index:

```typescript
index('idx_routine__routines_creation_channel_id').on(table.creationChannelId),
```

**`onDelete: 'set null'`** — if the creation channel is hard-deleted for any reason, the routine stays (just loses the backlink). We never want channel deletion to cascade into routine deletion.

### No `creation_tasks` Table

Revision 1 referenced a `creationTaskId` FK to a `creation_tasks` table. That table does not exist and is not added. "Creation state" is fully represented by `{ status: 'draft', creationChannelId, creationSessionId }` on the routine itself.

## Backend Services

### API Endpoints

#### `POST /v1/routines/with-creation-task`

Provisions the Routine UI creation path atomically.

- **Request:** `{ agentId: UUID }` — the `bot.id` of the executing staff to clone
- **Response:** `{ routineId, creationChannelId, creationSessionId }`
- **Behavior:**
  1. Look up the source bot via `BotsService.getBotById(agentId, tenantId)`; 404 if missing.
  2. Count existing routines in the tenant; auto-generate title `"Routine #{N+1}"`.
  3. Create a `draft` routine (via `RoutinesService.create({ title, botId: agentId, status: 'draft' })`).
  4. Create a direct channel between the user and the bot's shadow user (`ChannelsService.createDirectChannel`). Channel name prefixed with `routine-creation-`.
  5. Register a cloned claw-hive agent with ID `routine-creation-{routineId}`, inheriting the source bot's blueprint and component configs, plus `extraComponentConfigs['team9-routine-creation'] = { routineId, isCreationChannel: true }`.
  6. Persist `{ creationChannelId, creationSessionId }` on the draft routine.
  7. Send a `team9:routine-creation.start` event via `sendInput` to kick off the first agent turn.
  8. On any downstream failure, roll back: delete the clone agent, delete the draft routine. Channel may be left (will be archived if the user retries).

#### `POST /v1/routines/:id/complete-creation`

Transitions a draft routine to `upcoming`.

- **Request:** `{ notes?: string }` (optional audit note)
- **Response:** `Routine` (the updated row)
- **Behavior:**
  1. Fetch the routine. 404 if missing.
  2. Assert caller is the creator. 403 otherwise.
  3. **Idempotency:** if already `upcoming`, return current routine without side effects.
  4. Reject if status is anything other than `draft` or `upcoming`: 400.
  5. Validate required fields: `title` non-empty, `botId` set, and the linked document's `content` non-empty. 400 with `{ errors: string[] }` listing what's missing.
  6. `UPDATE routines SET status = 'upcoming', updated_at = now()`.
  7. If `creationChannelId` is set: `ChannelsService.archive(creationChannelId, tenantId)`. Failures are logged but non-fatal.
  8. If a clone agent exists (agent ID `routine-creation-{routineId}`): `ClawHiveService.deleteAgent(agentId)`. Failures are logged but non-fatal.
  9. Return the updated routine.

#### Enhanced Existing Endpoints

- `POST /v1/routines` — accepts optional `status: 'draft' | 'upcoming'` in DTO, defaults to `upcoming`. Draft routines skip trigger registration and skip scheduling. This is the path the DM `createRoutine` tool calls.
- `PATCH /v1/routines/:id` — can update draft fields but cannot transition status out of draft (returns 400 with hint to use `complete-creation`).
- `DELETE /v1/routines/:id` — if the target is a draft, also deletes the clone agent and archives the creation channel.
- `GET /v1/routines` — list filter excludes drafts unless `creator_id = currentUser`.
- `POST /v1/routines/:id/start` — rejects draft routines with 400 "Complete creation first".

### `ChannelsService.archive()` (new)

```typescript
async archive(channelId: string, tenantId?: string): Promise<void> {
  const where = tenantId
    ? and(eq(channels.id, channelId), eq(channels.tenantId, tenantId))
    : eq(channels.id, channelId);
  await this.db
    .update(channels)
    .set({ isArchived: true, updatedAt: new Date() })
    .where(where);
}
```

No additional permission check — callers (the routine completion flow) have already checked ownership.

## Claw-Hive Agent Layer

### `team9-routine-creation` Component

New component in `team9-agent-pi/packages/claw-hive/src/components/team9-routine-creation/`.

**Dependencies:** `team9` (uses the Team9 API client via dependency injection).

**Config schema (`Team9RoutineCreationComponentConfig`):**

```typescript
interface Team9RoutineCreationComponentConfig extends ComponentConfig {
  /**
   * Draft routine this clone is bound to. When set, the component operates
   * in "refine an existing draft" mode — getRoutine/updateRoutine are enabled
   * and the system prompt nudges the agent toward multi-turn refinement.
   *
   * When unset, the component operates in "DM one-shot" mode: only
   * createRoutine is offered.
   */
  routineId?: string;
  /**
   * True when the agent is running in a dedicated creation channel.
   * Nudges the system prompt toward "walk the user through creation"
   * rather than "help with general questions".
   */
  isCreationChannel?: boolean;
}
```

Both fields are set at agent-registration time via `extraComponentConfigs`. They are **static** per agent instance — exactly what we want for the per-routine clone pattern. The component does **not** use `team9Context.routineId` or any per-event dynamic state.

### Tools

The component exposes a different tool set depending on `config.routineId`:

| Tool            | DM path (`routineId` unset) | Routine UI path (`routineId` set)           |
| --------------- | --------------------------- | ------------------------------------------- |
| `createRoutine` | ✅ enabled                  | ❌ disabled (routine already exists)        |
| `getRoutine`    | ❌ disabled                 | ✅ enabled, pre-bound to `config.routineId` |
| `updateRoutine` | ❌ disabled                 | ✅ enabled, pre-bound to `config.routineId` |

#### `createRoutine` — DM path only

```typescript
createRoutine({
  title: string;                        // required
  documentContent: string;              // required
  description?: string;                 // optional
  botId?: string;                       // defaults to the calling agent's own botUserId
  triggers?: Array<{ type, config }>;   // optional, defaults to [{ type: 'manual', config: {} }]
  status?: 'ready' | 'draft';           // defaults to 'ready'
}) => { routineId: string, status: string }
```

- If `botId` is omitted, the component reads `ctx.config.botUserId` (from `team9`) and uses that bot's database row.
- If `status === 'draft'`, `documentContent` can be empty — the caller is saving a placeholder.
- If `status === 'ready'` (default), `documentContent` must be non-empty; empty document returns an error to the agent.
- Validation failures return `{ success: false, error: string }` as the tool result, letting the agent apologize and ask the user for missing info.
- Success: routine is created via `POST /v1/routines` with `status: 'upcoming' | 'draft'` mapped from the tool arg.

#### `getRoutine` — Routine UI path only

```typescript
getRoutine() => {
  id, title, description, documentContent, botId, status,
  triggers: Array<{ id, type, config, enabled }>
}
```

No arguments — the routine ID is baked into `config.routineId`. This is intentional: the agent cannot read or write any routine other than the one it was registered for.

#### `updateRoutine` — Routine UI path only

```typescript
updateRoutine({
  title?: string;
  description?: string;
  documentContent?: string;
  botId?: string;
  triggers?: Array<{ type, config, enabled? }>;
}) => {
  success: boolean;
  updated: string[];         // which fields actually changed
  error?: string;
}
```

Partial update — only the provided fields are written. `triggers`, when provided, replaces the entire trigger list (the agent is expected to read the current state via `getRoutine` first if it only wants to add or remove one).

### Bootstrap Event

When the Routine UI path starts, the gateway sends a single event to seed the session:

```typescript
{
  type: 'team9:routine-creation.start',
  source: 'team9',
  timestamp: '<ISO>',
  payload: {
    routineId: '<draft routine id>',
    creatorUserId: '<user id>',
    creatorDisplayName: '<name>',
  },
}
```

The `team9-routine-creation` component listens for this event via its `subscribedEvents` pattern and:

1. Calls `getRoutine` internally to snapshot the current state.
2. Injects a system prompt nudge: "You're guiding a user through creating a routine. The current draft is: [narrative]. Ask clarifying questions and use `updateRoutine` to refine it. When the user confirms, tell them to click 'Complete Creation' in the Routine UI."
3. Returns an assistant message that greets the user: "Hi! I'll help you set up [title]. What would you like this routine to do?"

### System Prompt Injection

The component's `onBeforePrompt` hook injects different guidance based on mode:

- **DM mode** (`routineId` unset): "You can create routines for the user. If they ask, gather `title`, `documentContent`, `triggers`, and optionally `botId`, then call `createRoutine`. Default `botId` to yourself unless the user specifies otherwise."
- **Routine UI mode** (`routineId` set): "You're refining an existing draft routine ({routineId}). Always call `getRoutine` first to see the current state before proposing changes. Use `updateRoutine` to apply edits. Present the plan as a narrative after each change so the user can confirm."

## Agentic Creation Flow

### DM Path (One-Shot)

1. User opens any agent's DM and says: "Help me create a routine that summarizes HN's top 5 AI stories every morning at 9."
2. Agent (1 turn): "Got it — what channel should I post the summary to?"
3. User: "#news-updates"
4. Agent internally calls `createRoutine({ title: 'Daily HN AI Digest', documentContent: '...', triggers: [{ type: 'schedule', config: { frequency: 'daily', time: '09:00', timezone: '<tz>' } }], botId: <self> })`.
5. Agent responds: "✅ Created! It'll run every morning at 09:00 and post to #news-updates."

Total: 3–5 turns. No draft state. No cleanup needed.

### Routine UI Path (Multi-Turn)

1. User clicks "Create with Agentic" in the Routine list.
2. Modal: "Choose an agent to guide creation". User picks NewsBot. Clicks Confirm.
3. Frontend calls `POST /v1/routines/with-creation-task` with `{ agentId: newsBot.id }`.
4. Backend provisions (atomically):
   - Draft routine with title "Routine #42", `botId: newsBot.id`, `status: 'draft'`
   - Direct channel between user and NewsBot (if it doesn't already exist)
   - Agent clone registered with ID `routine-creation-{routineId}`, based on NewsBot's blueprint, with `team9-routine-creation` config `{ routineId, isCreationChannel: true }`
   - Persists `creationChannelId`, `creationSessionId` on the draft
   - Sends `team9:routine-creation.start` event to the session
5. Frontend navigates to `/messages/{creationChannelId}`.
6. Agent greets: "Hi! I'll help you set up this routine. What would you like it to do?"
7. User describes intent. Agent asks 1–2 clarifying questions over several turns.
8. Agent calls `updateRoutine({ title, description, documentContent, triggers })` with its best understanding.
9. Agent renders the narrative plan in chat. "Does this look right?"
10. User requests a change. Agent calls `updateRoutine` with the delta. Re-renders plan.
11. Repeat 10 until the user says it looks good.
12. Agent: "✅ Looks good. Click **Complete Creation** in the Routine panel to finalize."
13. User clicks "Complete Creation" in the UI (or the agent calls the endpoint directly if we grant it that permission — deferred decision, Phase 1 has the user click).
14. Backend: `POST /v1/routines/:id/complete-creation` — validates, transitions to `upcoming`, archives channel, deletes clone agent.
15. UI shows the new routine in the active list.

Total: 6–12 turns, persistent through any interruption (user can close the tab and come back; the draft is still there with the same channel).

## Form Creation Flow (Phase 2)

Deferred. See §Scope for the planned 4-step structure.

## Frontend Integration

All changes live inside the existing Routine UI — no new top-level pages.

### Routine List

- Status groups displayed in order: **Draft** | Upcoming | In Progress | Paused | Completed | Failed
- Draft group is only rendered if the current user has any drafts (creator-only visibility enforced by the list API).
- Each draft card shows a "DRAFT" badge and two actions: "Complete Creation" (navigates to the creation channel) and "Delete" (confirms, then hard-deletes draft + clone + archives channel).
- At the top of the Draft group: a "+ Create with Agentic" button. Clicking it opens the agent picker modal.

### Agent Picker Modal

- Dropdown of all active bots in the workspace (via existing `api.applications.getInstalledApplicationsWithBots`).
- Defaults to the user's personal staff if they have one.
- Confirm button triggers `POST /v1/routines/with-creation-task` and navigates on success.
- Error states: agent no longer available → show toast, let user pick another.

### Draft Routine Detail Page

- If status is `draft`, top of the page shows a banner: "⚠️ This routine is in draft. Complete Creation to start using it."
- "Complete Creation" button links to the creation channel.
- "Edit Manually" button is Phase 2 (links to the 4-step form).

### Creation Channel

- Standard DM rendering — reuses all existing message UI.
- Channel header shows a sub-title: "Routine Creation: {Routine Name}"
- A small "Draft Routine" badge next to the header links back to the routine detail page.
- After `complete-creation`, the channel is archived and disappears from the sidebar (but is still accessible from the routine detail page as historical audit).

## Error Handling

### Validation Errors

- **`createRoutine` with missing `documentContent` (status ready):** Tool returns `{ success: false, error: "documentContent is required unless status is 'draft'" }`. The agent sees this and re-asks the user.
- **`updateRoutine` with invalid `triggers.config.time`:** Tool returns `{ success: false, error: "time must be HH:mm format (00:00–23:59)" }`. Agent apologizes and re-parses.
- **`complete-creation` with missing fields:** API returns `400 { errors: ['title is required', 'documentContent is required'] }`. Frontend shows a toast with the specific fields and keeps the user in the creation channel.

### Agent Unavailable

- **Executing agent deleted mid-creation:** the clone agent still has the snapshot of the source agent's configs, so creation can continue. On `complete-creation`, if the source agent is gone, the routine's `botId` becomes a dangling reference — validation on `complete-creation` should check this and 400 with "The executing agent no longer exists. Please reassign or delete this draft."
- **User leaves the workspace while a draft is open:** On user removal, cascade-delete their drafts. This mirrors how their personal staff is cleaned up.

### Concurrency

- **Only the creator can edit/complete/delete.** Enforced via `assertCreatorOwnership` on all mutating endpoints.
- **Last-write-wins for updates.** The creation channel is single-user (only the creator + the clone agent), so no realistic concurrent-edit scenario.
- **Double-complete.** Idempotent — returns the current routine without side effects.

### Channel & Agent Cleanup Failures

- Channel archive failures are logged as warnings. The routine still transitions to `upcoming`.
- Clone agent delete failures are also logged as warnings. The agent ID is deterministic (`routine-creation-{routineId}`), so a cleanup cron can catch orphans later if desired.

## Implementation Sequence

### Phase 1 (MVP) — In This Spec

1. **Database migration.** Add `draft` enum value + `creation_channel_id` + `creation_session_id` columns. `onDelete: set null` on the channel FK.
2. **`ChannelsService.archive()`** helper.
3. **`RoutinesService.create/update/delete` draft handling.** Accept `status` in DTO. Skip trigger registration for drafts. Reject `start` on drafts. List API filters drafts to creator-only.
4. **`POST /v1/routines/:id/complete-creation` endpoint and service method.** Validates required fields, transitions status, archives channel, deletes clone agent.
5. **`POST /v1/routines/with-creation-task` endpoint and service method.** Creates draft + channel + clone agent + session + sends bootstrap event. Rollback on partial failure.
6. **`team9-routine-creation` claw-hive component.** Config schema, `createRoutine`/`getRoutine`/`updateRoutine` tools, bootstrap event handler, system prompt injection.
7. **Component factory registration + blueprint updates** so the clone agent knows to include the new component.
8. **Frontend: "Create with Agentic" button.** In the Routine list, above the draft group (or next to the existing "+ New Routine" button).
9. **Frontend: Agent picker modal.**
10. **Frontend: Draft cards with badge + actions.** "Complete Creation" + "Delete".
11. **Frontend: Draft banner on routine detail page.** Links to creation channel.
12. **Integration tests.** End-to-end: create-with-creation-task → simulate agent calling updateRoutine → complete-creation → verify routine is `upcoming`, channel archived, clone agent deleted.

### Phase 2 (Deferred)

- 4-step form UI
- "Edit Manually" button on draft routines
- Inline trigger UI widgets (A2UI)
- Polish: error messages, i18n, empty states

## Open Questions / TBD

- **Should the clone agent be allowed to call `complete-creation` itself?** Currently the spec has the user click "Complete Creation" in the UI. Allowing the agent to self-complete would be smoother but harder to govern. Default: user-clicks in Phase 1, revisit in Phase 2.
- **Draft title auto-generation naming.** Currently "Routine #N" where N is 1 + count of all routines in tenant. Could get weird if routines are deleted (N shrinks, name collides). Alternative: use a short UUID prefix. Defer to implementation — pick whichever looks nicer.
- **Agent picker default.** Personal staff if available, else the first active common-staff bot. Needs user verification during implementation.

## Changelog

### Revision 2 (2026-04-10)

- Removed `creationTaskId` and all references to a nonexistent `creation_tasks` table.
- Replaced session-level `team9Context` as the vehicle for `routineId` with per-routine agent clone + static `extraComponentConfigs` on the clone.
- Draft routines are now creator-only in the list (was: visible to all workspace members).
- `onDelete: set null` on `creationChannelId` (was: `cascade`, which was dangerous).
- Deferred inline trigger UI to Phase 2.
- Clarified `ChannelsService.archive()` must be added (was assumed to exist).
- Clarified `createRoutine` tool signature: `botId` defaults to self, `documentContent` required only when `status !== 'draft'`.
- Added the `team9-routine-creation` component section with tools, bootstrap event, and dependency on `team9`.
- Added explicit agent clone lifecycle (register on creation, delete on completion or draft deletion).
- Referenced the parallel bug fix commits (team9 `76294882`, team9-agent-pi `4d975ba` / `933fe8d`) that this design depends on for per-event `team9Context` delivery — but **this design itself does not use per-event `team9Context`** for `routineId`; it uses static config on the clone agent.

### Revision 1 (2026-04-09)

- Original brainstorming output. See git history.

---

**Next Step:** Rewrite the implementation plan (`docs/superpowers/plans/2026-04-09-intelligent-routine-creation.md`) to reflect this revised spec.
