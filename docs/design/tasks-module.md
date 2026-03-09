# Tasks Module - Requirements & Design Document

> Version: 1.0
> Date: 2026-02-23
> Status: Draft
> Scope: Task List Tab + backend tasks module + task-worker service + document system

---

## 1. Overview

Tasks module is an AI Staff (Bot) task management system for Team9. Users create one-time or recurring tasks and assign them to Bots. Bots autonomously execute tasks, report progress in real-time, and deliver results. Users can monitor execution, intervene when needed, and review deliverables.

Each Bot (currently OpenClaw-backed) appears in the UI with a "Task List" tab alongside Messages and other tabs. Additionally, there is a standalone "Tasks" page at the top level (same level as AI Staff / Apps) for managing and viewing all tasks across all Bots.

## 2. Core Concepts

| Concept            | Description                                                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**           | A work unit assigned to a Bot, with a complete lifecycle                                                                                           |
| **Task Execution** | A single run of a task (version). Recurring tasks generate multiple executions                                                                     |
| **Task Entry**     | A timeline entry during execution, including steps, interventions, deliverables, etc., stored in a unified table                                   |
| **Task Channel**   | A dedicated virtual IM channel for each execution (new `task` channel type), enabling user-bot communication in the context of a specific task run |
| **Document**       | A versioned Markdown document attached to a task, auto-created with the task, providing detailed instructions for the agent                        |

## 3. Task Lifecycle

```
                    ┌─────────┐
                    │ upcoming │  (recurring: waiting for schedule / one-time: waiting for manual start)
                    └────┬────┘
                         │ trigger / schedule fires
                         ▼
                  ┌─────────────┐
           ┌──── │ in_progress  │ ◄──── resume
           │     └──┬───┬───┬──┘
           │        │   │   │
     need_input     │   │   │ pause
           │        │   │   ▼
           ▼        │   │ ┌────────┐
   ┌──────────────┐ │   │ │ paused │ ── resume ──→ in_progress
   │pending_action│ │   │ └────────┘
   └──────┬───────┘ │   │
          │ resolve  │   │ stop / error / timeout
          └──► ──────┘   ▼
                    ┌──────────────┐
                    │ completed    │──→ restart ──→ new execution (upcoming/in_progress)
                    │ failed       │
                    │ stopped      │
                    │ timeout      │
                    └──────────────┘
```

### Status Enum

| Status           | Description                                      |
| ---------------- | ------------------------------------------------ |
| `upcoming`       | Awaiting execution (scheduled or manual trigger) |
| `in_progress`    | Currently being executed by the Bot              |
| `paused`         | Paused by user                                   |
| `pending_action` | Bot is waiting for human intervention            |
| `completed`      | Execution finished successfully                  |
| `failed`         | Execution finished with error                    |
| `stopped`        | Manually terminated by user                      |
| `timeout`        | Exceeded timeout limit                           |

### User Actions by Status

| Current Status   | Allowed Actions                  |
| ---------------- | -------------------------------- |
| `upcoming`       | Start, Edit, Delete              |
| `in_progress`    | Stop, Pause, Edit (send message) |
| `paused`         | Start (resume), Stop, Edit       |
| `pending_action` | Resolve intervention, Stop       |
| `completed`      | Restart, View deliverables       |
| `failed`         | Restart, View error              |
| `stopped`        | Restart                          |
| `timeout`        | Restart                          |

## 4. System Architecture

```
                          ┌──────────────────┐
                          │    Client (UI)    │
                          │  Task List Tab    │
                          └────┬────────┬─────┘
                               │ REST   │ WebSocket (Socket.io)
                               ▼        ▼
                          ┌──────────────────┐
                          │     Gateway      │
                          │  tasks module    │
                          │  documents module│
                          └────┬────────┬────┘
                     RabbitMQ  │        │ DB / Redis
                               ▼        ▼
┌──────────────┐      ┌──────────────┐   ┌──────────┐
│  task-worker │◄────►│  PostgreSQL  │   │  Redis   │
│  (new svc)   │      └──────────────┘   └──────────┘
└──────┬───────┘
       │ HTTP (OpenClaw API)
       ▼
┌──────────────┐
│   OpenClaw   │
│   Instance   │
└──────────────┘
```

### Component Responsibilities

**Gateway (tasks module)**

- REST API for task CRUD, control, and querying
- Bot-side API for status reporting, step updates, interventions, deliverables
- WebSocket event broadcasting for real-time UI updates
- Document management API

**task-worker (new service)**

- Recurring task scheduler: scans `nextRunAt` to trigger executions
- Execution lifecycle management: creates executions, task channels, triggers OpenClaw
- Timeout detection: periodic scan for timed-out executions
- RabbitMQ consumer: processes commands from Gateway (start, pause, stop, etc.)

**OpenClaw Integration**

- Bot type `openclaw` → execution delegated to OpenClaw agent
- Agent reports progress via Bot API (access token auth)
- Future: other bot types can implement different execution strategies

## 5. Data Model

### 5.1 `agent_task__tasks` - Task Main Table

```sql
CREATE TABLE agent_task__tasks (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    bot_id          UUID NOT NULL REFERENCES im_bots(id) ON DELETE CASCADE,
    creator_id      UUID NOT NULL REFERENCES im_users(id),
    title           VARCHAR(500) NOT NULL,
    description     TEXT,                          -- brief description (separate from document)
    status          agent_task__status NOT NULL DEFAULT 'upcoming',
    schedule_type   agent_task__schedule_type NOT NULL DEFAULT 'once',  -- 'once' | 'recurring'
    schedule_config JSONB,                         -- { frequency: 'daily', time: '09:00', timezone: 'Asia/Shanghai' } or cron
    next_run_at     TIMESTAMP,                     -- next scheduled execution time (for task-worker scanning)
    document_id     UUID REFERENCES documents(id), -- associated task document (auto-created with task)
    current_execution_id UUID,                     -- FK to current/latest execution (denormalized for fast query)
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_agent_task__tasks_tenant_id ON agent_task__tasks(tenant_id);
CREATE INDEX idx_agent_task__tasks_bot_id ON agent_task__tasks(bot_id);
CREATE INDEX idx_agent_task__tasks_creator_id ON agent_task__tasks(creator_id);
CREATE INDEX idx_agent_task__tasks_status ON agent_task__tasks(status);
CREATE INDEX idx_agent_task__tasks_next_run_at ON agent_task__tasks(next_run_at);
CREATE INDEX idx_agent_task__tasks_tenant_status ON agent_task__tasks(tenant_id, status);
```

**Enums:**

```sql
CREATE TYPE agent_task__status AS ENUM (
    'upcoming', 'in_progress', 'paused', 'pending_action',
    'completed', 'failed', 'stopped', 'timeout'
);

CREATE TYPE agent_task__schedule_type AS ENUM ('once', 'recurring');
```

### 5.2 `agent_task__executions` - Execution Records (Versions)

Each trigger (manual or scheduled) creates one execution record with a dedicated task channel.

```sql
CREATE TABLE agent_task__executions (
    id              UUID PRIMARY KEY,
    task_id         UUID NOT NULL REFERENCES agent_task__tasks(id) ON DELETE CASCADE,
    version         INTEGER NOT NULL,              -- execution version (1, 2, 3...)
    status          agent_task__status NOT NULL DEFAULT 'in_progress',
    channel_id      UUID REFERENCES im_channels(id), -- dedicated virtual channel for this execution
    token_usage     INTEGER NOT NULL DEFAULT 0,
    started_at      TIMESTAMP,
    completed_at    TIMESTAMP,
    duration        INTEGER,                       -- seconds
    error           JSONB,                         -- error details if failed
    created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_task__executions_task_id ON agent_task__executions(task_id);
CREATE INDEX idx_agent_task__executions_status ON agent_task__executions(status);
CREATE INDEX idx_agent_task__executions_task_version ON agent_task__executions(task_id, version);
```

### 5.3 `agent_task__steps` - Execution Steps

```sql
CREATE TABLE agent_task__steps (
    id              UUID PRIMARY KEY,
    execution_id    UUID NOT NULL REFERENCES agent_task__executions(id) ON DELETE CASCADE,
    task_id         UUID NOT NULL REFERENCES agent_task__tasks(id) ON DELETE CASCADE,  -- denormalized
    order_index     INTEGER NOT NULL,
    title           VARCHAR(500) NOT NULL,
    status          agent_task__step_status NOT NULL DEFAULT 'pending',
    token_usage     INTEGER NOT NULL DEFAULT 0,
    duration        INTEGER,                       -- seconds
    started_at      TIMESTAMP,
    completed_at    TIMESTAMP,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TYPE agent_task__step_status AS ENUM ('pending', 'in_progress', 'completed', 'failed');

CREATE INDEX idx_agent_task__steps_execution_id ON agent_task__steps(execution_id);
CREATE INDEX idx_agent_task__steps_task_id ON agent_task__steps(task_id);
```

### 5.4 `agent_task__deliverables` - Deliverables

```sql
CREATE TABLE agent_task__deliverables (
    id              UUID PRIMARY KEY,
    execution_id    UUID NOT NULL REFERENCES agent_task__executions(id) ON DELETE CASCADE,
    task_id         UUID NOT NULL REFERENCES agent_task__tasks(id) ON DELETE CASCADE,  -- denormalized
    file_name       VARCHAR(500) NOT NULL,
    file_size       BIGINT,                        -- bytes
    mime_type       VARCHAR(128),
    file_url        TEXT NOT NULL,                  -- storage URL
    created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_task__deliverables_execution_id ON agent_task__deliverables(execution_id);
CREATE INDEX idx_agent_task__deliverables_task_id ON agent_task__deliverables(task_id);
```

### 5.5 `agent_task__interventions` - Human Intervention Requests

```sql
CREATE TABLE agent_task__interventions (
    id              UUID PRIMARY KEY,
    execution_id    UUID NOT NULL REFERENCES agent_task__executions(id) ON DELETE CASCADE,
    task_id         UUID NOT NULL REFERENCES agent_task__tasks(id) ON DELETE CASCADE,  -- denormalized
    step_id         UUID REFERENCES agent_task__steps(id),
    prompt          TEXT NOT NULL,                  -- message shown to user
    actions         JSONB NOT NULL,                 -- [{ label: string, value: string }]
    response        JSONB,                          -- user's response { action: string, message?: string }
    status          agent_task__intervention_status NOT NULL DEFAULT 'pending',
    resolved_by     UUID REFERENCES im_users(id),
    resolved_at     TIMESTAMP,
    expires_at      TIMESTAMP,                     -- optional expiry
    created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TYPE agent_task__intervention_status AS ENUM ('pending', 'resolved', 'expired');

CREATE INDEX idx_agent_task__interventions_execution_id ON agent_task__interventions(execution_id);
CREATE INDEX idx_agent_task__interventions_task_id ON agent_task__interventions(task_id);
CREATE INDEX idx_agent_task__interventions_status ON agent_task__interventions(status);
```

### 5.6 Document System (`schemas/document/`)

Independent document system with full version history.

**`documents` - Document Main Table**

```sql
CREATE TABLE documents (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    owner_type          VARCHAR(64) NOT NULL,          -- 'task' | 'bot' | ... (extensible)
    owner_id            UUID NOT NULL,                  -- polymorphic FK
    title               VARCHAR(500),
    current_version_id  UUID,                           -- FK to latest version (denormalized)
    created_by          UUID NOT NULL REFERENCES im_users(id),
    created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_documents_tenant_id ON documents(tenant_id);
CREATE INDEX idx_documents_owner ON documents(owner_type, owner_id);
```

**`document_versions` - Version History**

```sql
CREATE TABLE document_versions (
    id              UUID PRIMARY KEY,
    document_id     UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    version         INTEGER NOT NULL,              -- auto-incrementing per document
    content         TEXT NOT NULL,                  -- Markdown content
    summary         TEXT,                          -- change summary (optional)
    updated_by      UUID NOT NULL REFERENCES im_users(id),
    created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_document_versions_document_id ON document_versions(document_id);
CREATE UNIQUE INDEX idx_document_versions_doc_version ON document_versions(document_id, version);
```

### 5.7 Channel Type Extension

Extend `im_channels.channel_type` enum:

```sql
ALTER TYPE channel_type ADD VALUE 'task';
```

Task channels:

- Auto-created per execution, not user-created
- Members: task creator + assigned bot
- Hidden from channel list sidebar (filtered by type != 'task')
- Accessible only via Task Details panel

## 6. API Design

### 6.1 Task CRUD (User-facing, JWT Auth)

```
POST   /v1/tasks                          Create a task
GET    /v1/tasks                          List tasks (query: botId, tenantId, status, scheduleType)
GET    /v1/tasks/:id                      Get task detail (includes current execution, steps, interventions)
PATCH  /v1/tasks/:id                      Update task (title, description, scheduleConfig)
DELETE /v1/tasks/:id                      Delete task
```

### 6.2 Task Control (User-facing, JWT Auth)

```
POST   /v1/tasks/:id/start               Start / trigger task
POST   /v1/tasks/:id/pause               Pause task
POST   /v1/tasks/:id/resume              Resume task
POST   /v1/tasks/:id/stop                Stop task
POST   /v1/tasks/:id/restart             Restart (creates new execution)
```

### 6.3 Executions & Steps (User-facing, JWT Auth)

```
GET    /v1/tasks/:id/executions           List all executions for a task
GET    /v1/tasks/:id/executions/:execId   Get execution detail (includes steps)
GET    /v1/tasks/:id/executions/:execId/steps   Get steps for an execution
```

### 6.4 Interventions (User-facing, JWT Auth)

```
GET    /v1/tasks/:id/interventions        List pending interventions
POST   /v1/tasks/:id/interventions/:intId/resolve   Resolve an intervention
```

### 6.5 Deliverables (User-facing, JWT Auth)

```
GET    /v1/tasks/:id/deliverables         List deliverables (optionally filter by executionId)
```

### 6.6 Documents (User-facing, JWT Auth)

```
GET    /v1/documents/:id                  Get document (latest version)
PUT    /v1/documents/:id                  Update document (creates new version)
GET    /v1/documents/:id/versions         List version history
GET    /v1/documents/:id/versions/:ver    Get specific version
```

### 6.7 Bot API (Bot Access Token Auth)

These endpoints are called by the Bot (OpenClaw agent) to report progress.

```
GET    /v1/bot/tasks/pending              Get tasks assigned to this bot awaiting execution
GET    /v1/bot/tasks/:id                  Get task detail + document
PATCH  /v1/bot/tasks/:id/status           Update execution status
POST   /v1/bot/tasks/:id/steps            Report step progress (create/update steps)
POST   /v1/bot/tasks/:id/interventions    Raise an intervention request
POST   /v1/bot/tasks/:id/deliverables     Upload deliverable file
GET    /v1/bot/tasks/:id/document         Get task document (for agent to read instructions)
```

**Bot Step Reporting Payload:**

```json
{
  "steps": [
    {
      "orderIndex": 1,
      "title": "Clean and analyze core demand pain points in competitors' user reviews",
      "status": "completed",
      "tokenUsage": 248,
      "duration": 72
    },
    {
      "orderIndex": 2,
      "title": "Automatically summarize multiple market reports and extract core viewpoints",
      "status": "in_progress"
    }
  ]
}
```

**Bot Intervention Request Payload:**

```json
{
  "prompt": "Allow us to access your server configuration?",
  "actions": [
    { "label": "Allow", "value": "allow" },
    { "label": "Deny", "value": "deny" }
  ]
}
```

## 7. WebSocket Events

All events are scoped to the tenant room (existing pattern).

| Event                         | Direction       | Payload                                                |
| ----------------------------- | --------------- | ------------------------------------------------------ |
| `task:status_changed`         | Server → Client | `{ taskId, executionId, status, previousStatus }`      |
| `task:step_updated`           | Server → Client | `{ taskId, executionId, steps: [...] }`                |
| `task:intervention_requested` | Server → Client | `{ taskId, executionId, intervention: {...} }`         |
| `task:intervention_resolved`  | Server → Client | `{ taskId, executionId, interventionId, response }`    |
| `task:deliverable_added`      | Server → Client | `{ taskId, executionId, deliverable: {...} }`          |
| `task:token_usage_updated`    | Server → Client | `{ taskId, executionId, tokenUsage, stepTokenUsage? }` |
| `task:execution_created`      | Server → Client | `{ taskId, execution: {...} }`                         |

## 8. task-worker Service

### 8.1 Directory Structure

```
apps/server/apps/task-worker/
├── src/
│   ├── main.ts                          -- Service entry point (port 3002)
│   ├── app.module.ts                    -- Root module
│   ├── scheduler/
│   │   ├── scheduler.module.ts
│   │   └── scheduler.service.ts         -- Cron-based recurring task trigger
│   ├── executor/
│   │   ├── executor.module.ts
│   │   ├── executor.service.ts          -- Execution lifecycle management
│   │   └── strategies/
│   │       ├── execution-strategy.interface.ts  -- Abstract execution interface
│   │       └── openclaw.strategy.ts     -- OpenClaw-specific execution
│   ├── timeout/
│   │   ├── timeout.module.ts
│   │   └── timeout.service.ts           -- Timeout detection
│   └── consumer/
│       ├── consumer.module.ts
│       └── task-command.consumer.ts     -- RabbitMQ: process start/pause/stop/resume commands
```

### 8.2 Scheduler Logic

```
Every 30 seconds:
  1. SELECT * FROM agent_task__tasks
     WHERE schedule_type = 'recurring'
       AND next_run_at <= NOW()
       AND status NOT IN ('stopped', 'paused')
  2. For each task:
     a. Create agent_task__executions record (version = max(version) + 1)
     b. Create task channel (type = 'task', members = [creator, bot])
     c. Trigger execution via OpenClaw API
     d. Update task: status = 'in_progress', current_execution_id, next_run_at = calculate_next(scheduleConfig)
```

### 8.3 Timeout Detection

```
Every 60 seconds:
  1. SELECT * FROM agent_task__executions
     WHERE status = 'in_progress'
       AND started_at + interval '24 hours' < NOW()   -- configurable per task
  2. For each timed-out execution:
     a. Update execution: status = 'timeout'
     b. Update parent task: status = 'timeout'
     c. Emit WebSocket event: task:status_changed
     d. Notify OpenClaw to stop agent (if applicable)
```

### 8.4 Execution Flow

```
Trigger (manual or scheduled)
  │
  ├─ 1. Create agent_task__executions record
  ├─ 2. Create task channel (im_channels type='task')
  ├─ 3. Add members to channel (creator + bot)
  ├─ 4. Update task.status = 'in_progress', task.current_execution_id
  ├─ 5. Call OpenClaw API to start agent
  │     POST {openclaw_url}/api/agents/{agentId}/execute
  │     Body: { taskId, executionId, documentContent, channelId }
  └─ 6. Emit WebSocket: task:status_changed, task:execution_created

Agent executes...
  │
  ├─ Agent calls: PATCH /v1/bot/tasks/:id/status → updates progress
  ├─ Agent calls: POST /v1/bot/tasks/:id/steps → reports step completion
  ├─ Agent calls: POST /v1/bot/tasks/:id/interventions → needs human input
  │     → Task status → pending_action
  │     → WebSocket: task:intervention_requested
  │     → User resolves → POST /v1/tasks/:id/interventions/:intId/resolve
  │     → Task status → in_progress (agent continues)
  ├─ Agent calls: POST /v1/bot/tasks/:id/deliverables → uploads files
  └─ Agent calls: PATCH /v1/bot/tasks/:id/status { status: 'completed' }
       → WebSocket: task:status_changed
```

## 9. Frontend Design (based on mockups)

### 9.1 Entry Points

There are two entry points:

1. **Bot Detail Tab**: Task List is a new tab within the Bot detail page, alongside Messages. Shows only tasks for that specific Bot.
   - Route: `/workspace/:tenantId/bot/:botId/tasks` (or rendered as tab within bot detail)

2. **Standalone Tasks Page**: A top-level page at the same level as AI Staff / Apps, showing and managing all tasks across all Bots. Supports filtering by Bot.
   - Route: `/workspace/:tenantId/tasks`

### 9.2 Task List View

**Filter Tabs:**

- **In progress** (count) — shows tasks with status: `in_progress`, `paused`, `pending_action`
- **Upcoming** (count) — shows tasks with status: `upcoming`
- **Finished** (count) — shows tasks with status: `completed`, `failed`, `stopped`, `timeout`

**Task Card (In progress):**

```
◎ [Loading spinner] Task Title
  Start: 2026-01-18 17:54 · 2m 17s · Used 248 Tokens
  ↳ Current step summary text                         [⊘ Stop] [⊙ Pause] [✎ Edit]
```

- `pending_action` tasks show a "Pending operation" badge
- `paused` tasks show a "Paused" badge on current step

**Task Card (Upcoming):**

```
◎ Task Title
  [Everyday]  Est. Start: 2026-01-18 17:54
```

- Recurring tasks show schedule badge (Everyday, Weekly, etc.)

**Task Card (Finished):**

```
● Task Title
  Start: 2026-01-18 17:54 · End: 2026-01-18 17:54 · 2m 17s · Used 248 Tokens
  📁 Deliver 3 files                                              [↻ Restart]
```

- If a recurring task's next scheduled execution is in progress, show "Scheduled Task: ◎ In progress"

### 9.3 Task Details Panel (Right Drawer)

Opens when clicking a task card. Responsive layout:

- On wider screens: side-by-side with task list
- On narrower screens: overlay panel

**Header:**

```
✕ Close
📋 Analyze the 2025 enterprise-level AI tool market size and growth trend
◎ In progress · 2m 17s · Used 496 Tokens
```

**Task Steps (timeline):**

```
──── Task Steps ────
✅ Clean and analyze core demand pain points in competitors' user reviews
   2026-01-18 17:54 · 1m 12s · Used 248 Tokens
✅ Automatically summarize multiple market reports and extract core viewpoints
   2026-01-18 17:54 · 1m 5s · Used 248 Tokens
◎  Research the impact of industry policy changes
   (in progress...)
```

**Paused State:**

```
ℹ️ Task execution has been paused.
   [⊙ Start]
```

**Intervention (pending_action):**

```
◎  Research the impact of industry policy changes
   ⚠️ Allow us to access your server configuration?
   [Action: Allow] [Action: Deny]
```

**Finished - Deliverables:**

```
──── Deliver 3 files ────
🖼️ xnip2025-07-30.png    1.16MB
📄 hello.docx             1.16MB
📊 hello.pptx             1.16MB
```

**Message Input (bottom):**

```
┌─────────────────────────────────────────┐
│ B I ≡ ≡                                │
│ Send message to adjust task             │
│ Aa 😊 @ 📎 ↗                        🔵 │
└─────────────────────────────────────────┘
```

Messages go to the task execution's dedicated channel (im_channels type='task').

## 10. Schedule Configuration

### 10.1 scheduleConfig Schema

```typescript
interface ScheduleConfig {
  // Simple presets
  frequency?: "daily" | "weekly" | "monthly";
  time?: string; // "09:00" (HH:mm)
  timezone?: string; // "Asia/Shanghai"
  dayOfWeek?: number; // 0-6 (for weekly)
  dayOfMonth?: number; // 1-31 (for monthly)

  // Advanced: raw cron expression (overrides above)
  cron?: string; // "0 9 * * *"
}
```

### 10.2 next_run_at Calculation

When a recurring task is created or an execution completes, `next_run_at` is recalculated based on `scheduleConfig`. The task-worker scans for `next_run_at <= NOW()` to trigger executions.

## 11. Relationship to Existing Systems

| Existing Component    | Relationship                                                                                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tracker_tasks` table | Existing generic task tracker. Tasks module uses **separate tables** (`agent_task__*`) due to different semantics. `tracker_tasks` remains for other internal tracking. |
| `im_bots`             | Task executor, linked via `agent_task__tasks.bot_id`                                                                                                                    |
| `im_channels`         | Extended with `task` channel type for per-execution communication                                                                                                       |
| `im_users`            | Task creator, linked via `agent_task__tasks.creator_id`                                                                                                                 |
| `im-worker`           | Unchanged. Task scheduling handled by new `task-worker` service                                                                                                         |
| WebSocket Gateway     | Reuse existing Socket.io infra, add `task:*` events                                                                                                                     |
| File module / Storage | Deliverables stored via existing storage infrastructure                                                                                                                 |
| OpenClaw module       | `task-worker` calls OpenClaw API to trigger agent execution                                                                                                             |
| Bot Access Token      | Bot API endpoints authenticated via existing `t9bot_` token mechanism                                                                                                   |

## 12. Gateway Module Structure

```
apps/server/apps/gateway/src/
├── tasks/
│   ├── tasks.module.ts
│   ├── tasks.controller.ts            -- User-facing task CRUD & control
│   ├── tasks.service.ts               -- Task business logic
│   ├── task-bot.controller.ts         -- Bot-facing API (access token auth)
│   ├── task-bot.service.ts            -- Bot API business logic
│   ├── task-execution.service.ts      -- Execution management
│   ├── task-intervention.service.ts   -- Intervention management
│   ├── task-deliverable.service.ts    -- Deliverable management
│   └── dto/
│       ├── create-task.dto.ts
│       ├── update-task.dto.ts
│       ├── task-control.dto.ts
│       ├── report-steps.dto.ts
│       ├── create-intervention.dto.ts
│       └── resolve-intervention.dto.ts
├── documents/
│   ├── documents.module.ts
│   ├── documents.controller.ts
│   └── documents.service.ts
```

## 13. Database Schema Structure

```
apps/server/libs/database/src/schemas/
├── im/          (existing)
├── tenant/      (existing)
├── tracker/     (existing)
├── task/        (new)
│   ├── index.ts
│   ├── tasks.ts
│   ├── task-executions.ts
│   ├── task-steps.ts
│   ├── task-deliverables.ts
│   ├── task-interventions.ts
│   └── relations.ts
└── document/    (new)
    ├── index.ts
    ├── documents.ts
    ├── document-versions.ts
    └── relations.ts
```

## 14. Implementation Phases (Suggested)

### Phase 1: Foundation

- [ ] Database schemas (task/, document/)
- [ ] Document module (CRUD + versioning)
- [ ] Task CRUD API (Gateway)
- [ ] Basic task list UI (Task List tab, card display)

### Phase 2: Execution Engine

- [ ] task-worker service scaffold
- [ ] Execution lifecycle (create execution, create task channel)
- [ ] OpenClaw execution strategy integration
- [ ] Bot API endpoints (status, steps reporting)
- [ ] WebSocket events for real-time updates

### Phase 3: Interactive Features

- [ ] Task control (start, pause, resume, stop, restart)
- [ ] Intervention system (request + resolve)
- [ ] Task Details panel UI (steps timeline, interventions)
- [ ] Message input in task details (task channel integration)

### Phase 4: Scheduling & Deliverables

- [ ] Recurring task scheduler in task-worker
- [ ] Schedule configuration UI
- [ ] Deliverable upload and display
- [ ] Finished task view with deliverables

### Phase 5: Polish

- [ ] Timeout detection
- [ ] Error handling and retry
- [ ] Token usage tracking and display
- [ ] Document version history UI
