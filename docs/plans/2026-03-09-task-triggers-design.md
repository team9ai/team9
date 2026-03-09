# Task Trigger System Design

**Date:** 2026-03-09
**Status:** Approved

## Overview

Extend the agent task system with a flexible trigger mechanism. A Task can have multiple independent triggers, each capable of initiating a Run (execution). Restructure the UI to clearly separate Task configuration from Run history.

## Trigger Types

| Type              | Description                                                                            |
| ----------------- | -------------------------------------------------------------------------------------- |
| `manual`          | User clicks Start, inputs optional notes via dialog                                    |
| `interval`        | Repeats every N units (minutes/hours/days/weeks/months/years)                          |
| `schedule`        | Cron-like: daily, weekly, monthly, yearly, weekdays at specific time                   |
| `channel_message` | Fires when any new message arrives in a watched channel                                |
| Retry             | User retries a failed/timed-out Run (modeled as triggerType on Run, not a trigger row) |

## Core Concepts

- **Task** = definition (title, description, document, bot, triggers)
- **Run** = one execution instance (triggered by a trigger, records document version snapshot, trigger context)
- **Trigger** = independent configuration attached to a Task; multiple triggers per Task allowed
- Each trigger fires independently, creating a separate Run
- Retry is a Run-level action (not a persistent trigger)

## Database Schema Changes

### New Table: `agent_task__triggers`

```sql
agent_task__triggers (
  id            UUID PRIMARY KEY,
  task_id       UUID NOT NULL REFERENCES agent_task__tasks(id) ON DELETE CASCADE,
  type          agent_task__trigger_type NOT NULL,  -- enum: manual, interval, schedule, channel_message
  config        JSONB,          -- type-specific configuration
  enabled       BOOLEAN NOT NULL DEFAULT true,
  next_run_at   TIMESTAMP,      -- interval/schedule only
  last_run_at   TIMESTAMP,
  created_at    TIMESTAMP NOT NULL DEFAULT now(),
  updated_at    TIMESTAMP NOT NULL DEFAULT now()
)

-- Indexes
CREATE INDEX idx_triggers_task_id ON agent_task__triggers(task_id);
CREATE INDEX idx_triggers_scan ON agent_task__triggers(type, enabled, next_run_at);
```

**New enum:** `agent_task__trigger_type` = `['manual', 'interval', 'schedule', 'channel_message']`

### Config Schemas by Type

```typescript
// manual — no persistent config needed
interface ManualTriggerConfig {}

// interval — every N units
interface IntervalTriggerConfig {
  every: number;
  unit: "minutes" | "hours" | "days" | "weeks" | "months" | "years";
}

// schedule — cron-like recurring
interface ScheduleTriggerConfig {
  frequency: "daily" | "weekly" | "monthly" | "yearly" | "weekdays";
  time: string; // "HH:mm"
  timezone: string; // IANA timezone
  dayOfWeek?: number; // 0-6 (Sunday=0), for weekly
  dayOfMonth?: number; // 1-31, for monthly
}

// channel_message — watch a channel
interface ChannelMessageTriggerConfig {
  channelId: string;
}
```

### Modified Table: `agent_task__executions`

New columns:

| Column                | Type                             | Description                                                                |
| --------------------- | -------------------------------- | -------------------------------------------------------------------------- |
| `trigger_id`          | UUID NULL FK → triggers          | Which trigger fired this Run                                               |
| `trigger_type`        | VARCHAR NULL                     | Denormalized: 'manual', 'interval', 'schedule', 'channel_message', 'retry' |
| `trigger_context`     | JSONB NULL                       | Trigger-specific context (see below)                                       |
| `document_version_id` | UUID NULL FK → document_versions | Document version snapshot at execution time                                |
| `source_execution_id` | UUID NULL FK → self              | For retry: points to the original Run                                      |

### Trigger Context Schemas

```typescript
// Manual trigger
interface ManualTriggerContext {
  triggeredAt: string; // ISO timestamp
  triggeredBy: string; // userId
  notes?: string; // user-entered notes
}

// Interval / Schedule trigger
interface ScheduleTriggerContext {
  triggeredAt: string; // actual trigger time
  scheduledAt: string; // originally planned time (nextRunAt)
}

// Channel message trigger
interface ChannelMessageTriggerContext {
  triggeredAt: string;
  channelId: string;
  messageId: string;
  messageContent?: string; // message preview
  senderId: string;
}

// Retry
interface RetryTriggerContext {
  triggeredAt: string;
  triggeredBy: string;
  notes?: string;
  originalExecutionId: string;
  originalFailReason?: string;
}
```

### Deprecated Fields on `agent_task__tasks`

The following fields are superseded by the triggers table and should no longer be used for new logic. Keep in schema to avoid risky migration; mark deprecated in code:

- `schedule_type`
- `schedule_config`
- `next_run_at`

## Backend API Changes

### New Endpoints — Trigger CRUD

```
POST   /v1/tasks/:taskId/triggers          Create trigger
GET    /v1/tasks/:taskId/triggers          List triggers for task
PATCH  /v1/tasks/:taskId/triggers/:id      Update trigger (config, enabled)
DELETE /v1/tasks/:taskId/triggers/:id      Delete trigger
```

### Modified Endpoints

**`POST /v1/tasks`** — Create task with optional triggers:

```typescript
{
  title: string;
  botId?: string;
  description?: string;
  documentContent?: string;
  triggers?: CreateTriggerDto[];  // optional inline trigger creation
}
```

**`POST /v1/tasks/:id/start`** — Manual trigger, extended body:

```typescript
{
  notes?: string;       // execution notes
  triggerId?: string;   // optional: specify which manual trigger
}
```

**`POST /v1/tasks/:id/retry`** — New endpoint, retry a Run:

```typescript
{
  executionId: string;   // Run to retry
  notes?: string;
}
```

### Task-Worker — Scheduler Refactor

`SchedulerService.doScan()` changes to query `agent_task__triggers`:

```sql
SELECT * FROM agent_task__triggers
WHERE enabled = true
  AND type IN ('interval', 'schedule')
  AND next_run_at <= now()
```

After triggering:

1. Call `ExecutorService.triggerExecution(taskId, { triggerId, triggerType, triggerContext })`
2. Calculate and update trigger's `next_run_at` and `last_run_at`

### Task-Worker — New: ChannelMessageTriggerService

- On startup: load all enabled `channel_message` triggers from DB
- Subscribe to RabbitMQ message events (reuse existing `new_message` pipeline)
- On matching channelId: trigger Run with message context
- Dynamic refresh via RabbitMQ notifications when triggers are added/removed/toggled

### ExecutorService — Extended Signature

```typescript
async triggerExecution(taskId: string, context?: {
  triggerId?: string;
  triggerType?: string;
  triggerContext?: Record<string, unknown>;
  sourceExecutionId?: string;
  documentVersionId?: string;  // for retry: reuse original version
}): Promise<void>
```

Automatically snapshots current document version ID into execution record.

## Frontend UI Changes

### Task Detail Page — Tab Restructure

Replace current single-panel layout with tabs:

| Tab            | Content                                                           |
| -------------- | ----------------------------------------------------------------- |
| **Basic Info** | Title, description, status, creator, created time, associated Bot |
| **Triggers**   | Trigger list cards; add/edit/delete/enable/disable                |
| **Document**   | Linked document markdown preview, version history                 |
| **Runs**       | Run list ordered by trigger time descending                       |

### Triggers Tab

Each trigger renders as a card showing:

- **Manual** — "Manual trigger" label
- **Interval** — "Every N minutes/hours/days/weeks/months/years", next run time + countdown
- **Schedule** — "Daily/Weekly on X/Monthly on Nth/Weekdays at HH:mm (TZ)", next run time + countdown
- **Channel message** — Watched channel name

Add trigger dialog: select type first, then type-specific config form.

### Runs Tab

List items show:

- Version number (v1, v2, ...)
- Trigger type badge (manual/schedule/message/retry)
- Status badge
- Start time, duration
- Notes preview (if any)

**Run detail** (click to expand/navigate):

- **Basic info** — Agent, document version snapshot, trigger type, trigger context, notes
- **Execution process** — Step timeline + human interventions/guidance
- **Deliverables** — File/output list
- **Reflection** — Optional section
- **Chat box** — Bottom input for continuing the task

### Manual Trigger Dialog

On Start button click:

- Text area for notes/context
- Confirm / Cancel
- Submits `POST /v1/tasks/:id/start` with notes

### Retry Button

Shown on failed/timeout Run detail:

- Optional notes input
- Calls `POST /v1/tasks/:id/retry` with `executionId`

## Migration Strategy

1. Create `agent_task__triggers` table and new enum
2. Add new columns to `agent_task__executions`
3. Migrate existing tasks: for each task with `schedule_type = 'recurring'`, create a corresponding `schedule` trigger row with the task's `schedule_config`, copy `next_run_at`
4. For each task with `schedule_type = 'once'`, create a `manual` trigger row
5. Refactor scheduler to read from triggers table
6. Mark old fields as deprecated in code
