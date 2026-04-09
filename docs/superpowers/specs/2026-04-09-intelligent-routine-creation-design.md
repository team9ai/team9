# Intelligent Routine Creation Design

**Date:** 2026-04-09  
**Status:** Design

## Overview

Currently, Routine creation only supports a basic form interface. This spec introduces intelligent creation experience with two complementary paths:

1. **DM Creation (轻量)** — Users chat with an Agent in DM, AI understands intent and creates routine in one conversation. No structured task tracking.
2. **Routine UI Creation (结构化)** — Users initiate from Routine UI, triggers creation of a dedicated channel + draft routine. Multi-turn conversation to refine and complete creation.

Both paths support:

- Narrative plan confirmation (AI proposes approach, user approves or edits inline)
- Trigger configuration via conversation + inline UI
- Form fallback for manual editing
- Auto-archive of creation artifacts after completion

## Scope

### In Scope

- Two creation entry points (DM + Routine UI)
- Draft status for routines
- Multi-turn agentic creation flow
- Trigger UI helpers (cron picker, frequency selector)
- 4-step form for power users (Title+Description+Agent → Document → Triggers → Review)
- Inline plan editing (text + UI modifications)
- Auto-archive of creation channels post-completion
- claw-hive component: `team9-routine-creation`

### Out of Scope (First Phase)

- Inline form editor (modular form in conversation context)
- Collaborative creation (multiple users creating same routine)
- AI-generated trigger suggestions (user specifies, AI validates)
- Custom trigger types beyond schedule/interval/channel_message/manual

## Design Decisions

### 1. Two Creation Paths

**DM Creation:**

- User opens Agent's DM → says "help me create a routine" or triggers `/skill:routine-creation`
- Agent asks clarifying questions in conversation
- AI collects info → **directly calls `createRoutine` once** → routine created in `upcoming` status
- Minimal overhead, no creation task/channel created
- Suitable for ad-hoc, simple routines

**Routine UI Creation:**

- User clicks "Create with Agentic" from Routine list
- Selects an Agent to guide creation
- **Creates:** draft routine + creation task + creation channel + session
- Agent and user engage in multi-turn conversation in the channel
- AI calls `getRoutine` to check current state, `updateRoutine` to refine
- After completion: channel auto-archives, routine transitions from draft → upcoming
- Suitable for structured, collaborative routine design

### 2. Plan Representation

Plan is shown in **Narrative Summary** format (readable, conversational):

```
Routine Name: Daily News Digest
Executing Agent: NewsBot
Trigger: Schedule - Daily at 09:00 UTC
What it does: Fetch top AI stories from HN+Twitter, summarize, post to #news-updates
Key steps:
1. Query HackerNews + Twitter
2. Rank by relevance
3. Summarize each (2-3 lines)
4. Format as thread
```

Users can:

- Edit inline in the text (select "09:00" → change to "10:00")
- Modify via conversation ("change to 10:00")
- Show inline trigger UI ("show trigger settings" → triggers selector appears)

### 3. Trigger Configuration

When user describes "every day at 9 AM":

- AI understands and generates structured trigger: `{ type: "schedule", frequency: "daily", time: "09:00", timezone: "user_tz" }`
- Agent renders inline trigger UI in conversation: **Schedule** | **Daily** ⏰ **09:00** 🌍 **UTC**
- User can click UI to adjust fields
- System notifies AI of changes: "[User modified trigger: time 09:00 → 10:00]"
- AI confirms: "Got it, updated to 10:00 AM. Anything else?"

### 4. Draft Status Visibility & Permissions

Draft routines are **visible to all workspace members**:

- Only creator can edit/complete creation
- Other members see "DRAFT" badge, can view but cannot edit
- Cannot start/execute draft routine (validation error: "Complete creation first")
- If creator leaves workspace: draft remains, others can take over or delete

### 5. Channel Lifecycle

Creation channels (used only in Routine UI path):

- Created when user starts "Create with Agentic" from Routine UI
- Labeled "routine-creation" for easy filtering
- On completion: **auto-archived** (not deleted, preserves audit trail)
- User can view creation history by accessing archived channel

### 6. Form Strategy

4-step form for power users (no AI assistance):

**Step 1:** Title + Description + Executing Agent  
**Step 2:** Document (large textarea for instructions/prompt)  
**Step 3:** Triggers (add/remove/configure schedule/interval/channel_message/manual)  
**Step 4:** Review & Save (validate, choose "Save as Draft" or "Create & Start")

- Can be used standalone or as fallback during Agentic creation
- Pre-fills with existing draft data if editing
- Validation enforces: title, agent, document, ≥1 trigger

## Data Model

### routine\_\_routines Table Changes

New columns:

- `status` enum: Add value `'draft'` to routineStatusEnum

  ```
  'draft' | 'upcoming' | 'in_progress' | 'paused' | 'pending_action' | 'completed' | 'failed' | 'stopped' | 'timeout'
  ```

- `creationTaskId` (UUID, nullable, FK to creation_tasks)
  - Only set when routine created via Routine UI path
  - Used to link draft routine to its creation task

- `creationSessionId` (varchar, nullable)
  - claw-hive session ID for creation conversation
  - Only set during Routine UI creation

- `creationChannelId` (UUID, nullable, FK to channels)
  - Channel where creation happens (Routine UI path only)
  - On completion: channel auto-archived

Example Drizzle schema:

```typescript
status: routineStatusEnum('status').default('draft').notNull(),
creationTaskId: uuid('creation_task_id').references(() => creationTasks.id, { onDelete: 'set null' }),
creationSessionId: varchar('creation_session_id'),
creationChannelId: uuid('creation_channel_id').references(() => channels.id, { onDelete: 'cascade' }),
```

### No New Tables

Reuses existing tables:

- `channels` (creation channel is a normal channel)
- `routine_executions`, `routine_steps`, `routine_triggers` (unchanged)

## Backend Services

### API Endpoints

**Routine UI Creation (with creation task):**

`POST /v1/routines/with-creation-task`

- Request: `{ agentId: UUID }`
- Response: `{ routineId, creationTaskId, creationChannelId, creationSessionId }`
- Creates draft routine + creation task + channel + session
- Channel name: `routine-creation-{routineId}`
- Trigger condition: Only callable by workspace members

**DM Creation (no task):**

`POST /v1/routines` (existing, enhanced)

- Request: `{ title, botId, description?, documentContent?, triggers?, status?: 'draft'|'upcoming' }`
- For DM path: status defaults to 'upcoming' (ready to execute)
- Response: `{ id, status, ... }`

**Routine Management:**

`GET /v1/routines/:id` (existing)

- Returns full routine details including creation metadata

`PATCH /v1/routines/:id` (existing, enhanced)

- Update: title, description, documentContent, botId, triggers, status
- Callable during draft state to refine before completion

`POST /v1/routines/:id/complete-creation` (NEW)

- Transition routine: draft → upcoming
- Mark creation task as complete (if exists)
- Archive creation channel (if exists)
- Request: `{ notes?: string }` (optional notes for audit)
- Response: `{ success, routine }`

### Claw-Hive Component: team9-routine-creation

Implements the multi-turn creation orchestration for both paths.

**Dependencies:** Inherits from `team9-staff-profile`-like pattern (can update routine details)

**Configuration (team9Context):**

- `isCreationChannel` (boolean): True if in Routine UI creation channel
- `routineId` (UUID, optional): Set if updating existing draft routine

**Tools:**

1. **`createRoutine(title, description?, documentContent?, botId?, triggers?)`**
   - For DM path: Create routine from scratch
   - Validates: title, botId required; documentContent required
   - Creates in `upcoming` status (ready to run)
   - Returns: `{ routineId, message }`

2. **`getRoutine(routineId)`**
   - Fetch current draft routine state
   - For Routine UI path: Used before each `updateRoutine` to see current values
   - Returns: `{ routine: { id, title, description, documentContent, botId, triggers, status } }`

3. **`updateRoutine(routineId, updates)`**
   - For Routine UI path: Refine any field of draft routine
   - Updates object: `{ title?, description?, documentContent?, botId?, triggers? }`
   - Validates fields individually (allow partial updates)
   - Returns: `{ routine, updated: string[] }` (list of fields changed)

**Component Lifecycle:**

- `onInitialize`: Register tools
- `onBeforePrompt`:
  - If `isCreationChannel`, inject system prompt: "You're guiding routine creation. Ask questions, propose plans, refine details. Use tools to save progress."
  - If not `isCreationChannel`, inject: "You can help the user create a routine. Use createRoutine when ready."
- `onToolCall`: Tool results logged, displayed to user
- `onSessionEnd`: Mark creation complete if in Routine UI path

## Agentic Creation Flow

### DM Path (Lightweight)

1. **User initiates:** Opens Agent's DM, says "help me create a routine" or `/skill:routine-creation`
2. **Agent responds:** "Hi! I'll help you create a routine. What would you like it to do?"
3. **Clarification:** (1-2 turns) User describes intent. Agent asks clarifying questions (sources? frequency? audience?).
4. **Confirmation:** Agent: "So you want to [summary]. Sound right?"
5. **Create:** Agent calls `createRoutine(title, description, documentContent, botId, triggers)` with all info
6. **Done:** "✅ Routine created! It's ready to run."

**Total turns:** 3-5  
**Artifacts created:** Just the routine  
**Use case:** Quick, informal creation ("remind me to post news daily")

### Routine UI Path (Structured)

1. **User initiates:** Clicks "Create with Agentic" in Routine list
2. **Select Agent:** Popup modal, user selects an Agent from dropdown
3. **Confirm:** "Start creation with [Agent]?" → User clicks OK
4. **Backend setup:**
   - `POST /v1/routines/with-creation-task` creates:
     - Draft routine (status='draft', title auto-generated "Routine #N")
     - Creation task
     - Creation channel
     - claw-hive session
5. **Agent greets:** In creation channel, Agent: "Hi! I'll help you design this routine. Let's start: what would you like it to do?"
6. **Understand Intent:** (1-2 turns) User describes. Agent asks clarifying questions.
7. **Propose Plan:** Agent calls `updateRoutine(routineId, { title, description, ... })`, then displays:
   ```
   Routine Name: Daily News Digest
   Executing Agent: [Agent]
   Trigger: Schedule - Daily at 09:00 UTC
   ...
   ```
   Agent: "Does this plan look good? Any changes?"
8. **Refine Plan:** (0-2 turns)
   - User can edit inline (select text, change values)
   - Or say "show trigger settings" → inline UI appears
   - Or say "save and continue"
   - Agent calls `updateRoutine` for each change, confirms
9. **Generate Document:** Agent: "Now I'll generate detailed instructions for execution."
   - Calls `updateRoutine(routineId, { documentContent: "..." })`
   - Displays code block of instructions
   - Agent: "Here's the instruction the routine will follow. Good?"
10. **Final Tweaks:** User can request edits. Agent updates via `updateRoutine`.
11. **Completion:** Agent calls `POST /v1/routines/:id/complete-creation`, says "✅ Routine ready! You can start it now or let triggers handle it."
12. **Auto-archive:** Creation channel automatically archived

**Total turns:** 6-10  
**Artifacts created:** Routine + creation task + archived channel  
**Use case:** Structured, collaborative design ("let's build a data collection routine together")

## Form Creation Flow

**Entry Point:** From Routine UI create button (if user chooses Form instead of Agentic), or from draft routine "Edit Form" action.

**Step 1: Title + Description + Agent**

- `title` (required, max 500 chars): Routine name
- `description` (optional): Brief explanation of purpose
- `executingStaff` (required): Select from dropdown of available agents
- UI preview shows how it will appear in Routine list

**Step 2: Document**

- `documentContent` (required, large textarea): Actual prompt/instructions for execution
- Helper text: "This is what the agent will follow when executing the routine."
- Character counter, syntax hint
- Can paste long instructions without UI breaking

**Step 3: Triggers**

- Add multiple triggers (≥ 1 required)
- For each trigger type:
  - **Schedule:** Frequency (daily/weekly/monthly), time (HH:mm), timezone, dayOfWeek/dayOfMonth
  - **Interval:** Every N [hours/days/weeks]
  - **Channel Message:** Select channel
  - **Manual:** No config
- UI: Add trigger button, list of added triggers with edit/delete

**Step 4: Review & Save**

- Show summary: title, agent, doc preview, all triggers
- Validation errors highlighted (e.g., "Agent required", "Add at least one trigger")
- Buttons:
  - "Save as Draft" → routine status = 'draft', user can edit later
  - "Create & Start" → routine status = 'upcoming', ready to run
  - "Cancel" → discard changes, return to list

**Editing Existing Draft:**

- Form pre-fills with draft routine data
- User modifies fields
- Click "Save" to apply changes via `PATCH /v1/routines/:id`

**Validation Rules:**

- `title`: Required, non-empty string
- `executingStaff`: Required, valid agent ID
- `documentContent`: Required, non-empty
- `triggers`: At least one trigger must be configured
- Validation runs on Step 4 save (not per-step)

## Frontend Integration

All changes integrated into existing Routine UI (no new pages):

### Routine List

- Status groups: Draft | Upcoming | In Progress | Paused | Completed | Failed
- Draft section shows existing drafts + "Create with Agentic" button
- Draft routine cards show "DRAFT" badge, actions: "Complete Creation" | "Edit Form" | "Delete"

### Routine Detail Page

- If status='draft', banner at top: ⚠️ "This routine is in draft. **Complete Creation** to start using it."
- "Complete Creation" navigates to creation channel

### Sidebar/Search

- Draft routines show "DRAFT" badge
- Tooltip: "Click to complete setup"

### Creation Channel (Standard Message View)

- Channel header: "Routine Creation: [Routine Name]"
- Messages: Agent responses + Plan display + Trigger UI + Code blocks
- User can reply inline with modifications
- On completion: Agent posts final message, channel auto-archives

## Error Handling

### Validation Errors

- **Missing title/agent/document:** Form Step 4 shows field-specific error
- **Invalid trigger:** On save, display error "Time must be HH:mm format" with correction guidance
- **Agent unavailable:** During creation, warn user "Agent is no longer available. Reassign?" with agent selector

### State Errors

- **Draft not found:** If user tries to complete missing draft, show 404 "Routine not found"
- **Creation already completed:** If user tries to complete twice, show "Routine already created" (idempotent)
- **Session expired:** If creation channel dies mid-conversation, user can click "Complete Creation" again to resume in new channel

### Concurrency

- Only creator can edit/complete draft routine (permission check on API)
- Multiple edits: Last-write-wins (simple, prevents merge conflicts)

## Implementation Sequence

### Phase 1 (MVP)

1. Add `draft` status to routine schema
2. Add `creationTaskId`, `creationSessionId`, `creationChannelId` columns
3. Implement `POST /v1/routines/with-creation-task`, `POST /v1/routines/:id/complete-creation` endpoints
4. Build claw-hive component `team9-routine-creation` with `createRoutine`, `getRoutine`, `updateRoutine` tools
5. Add "Create with Agentic" button + agent selector popup to Routine UI
6. Add "DRAFT" badge + "Complete Creation" action to draft routine cards
7. Auto-archive creation channels on completion
8. Test both paths end-to-end

### Phase 2 (Form + Polish)

1. Implement 4-step form
2. Add "Edit Form" action to draft routine detail
3. Add inline trigger UI (cron picker, frequency selector)
4. Improve error messaging and validation

## Rollout Strategy

- **First:** Internal testing (two creation paths)
- **Then:** Gradual rollout to workspace (feature flag: `AGENTIC_ROUTINE_CREATION`)
- **Monitor:** Adoption, error rates, completion rates
- **Iterate:** Based on user feedback

## Open Questions / TBD

None — all major decisions finalized during design review.

---

**Next Step:** Invoke `writing-plans` skill to create detailed implementation plan with task breakdown.
