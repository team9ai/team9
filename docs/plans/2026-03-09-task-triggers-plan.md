# Task Trigger System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a flexible trigger system where each Task can have multiple independent triggers (manual, interval, schedule, channel_message), restructure the UI with tabs (Basic Info, Triggers, Document, Runs), and clearly separate Task from Run (execution) concepts.

**Architecture:** New `agent_task__triggers` table stores trigger definitions. Each trigger independently creates Runs (executions). The task-worker scheduler scans triggers instead of tasks. A new ChannelMessageTriggerService subscribes to message events. The frontend is restructured with a tab-based Task detail panel.

**Tech Stack:** NestJS, Drizzle ORM, PostgreSQL, RabbitMQ, React, TanStack Query, Radix UI Tabs, i18next

**Design Doc:** `docs/plans/2026-03-09-task-triggers-design.md`

---

## Task 1: Database Schema — Triggers Table

**Files:**

- Create: `apps/server/libs/database/src/schemas/task/task-triggers.ts`
- Modify: `apps/server/libs/database/src/schemas/task/index.ts`
- Modify: `apps/server/libs/database/src/schemas/task/relations.ts`

**Step 1: Create the trigger enum and table schema**

Create `apps/server/libs/database/src/schemas/task/task-triggers.ts`:

```typescript
import {
  pgTable,
  uuid,
  boolean,
  timestamp,
  jsonb,
  index,
  pgEnum,
} from "drizzle-orm/pg-core";
import { agentTasks } from "./tasks.js";

export const agentTaskTriggerTypeEnum = pgEnum("agent_task__trigger_type", [
  "manual",
  "interval",
  "schedule",
  "channel_message",
]);

// ── Config types ────────────────────────────────────────────────────

export interface ManualTriggerConfig {}

export interface IntervalTriggerConfig {
  every: number;
  unit: "minutes" | "hours" | "days" | "weeks" | "months" | "years";
}

export interface ScheduleTriggerConfig {
  frequency: "daily" | "weekly" | "monthly" | "yearly" | "weekdays";
  time: string;
  timezone: string;
  dayOfWeek?: number;
  dayOfMonth?: number;
}

export interface ChannelMessageTriggerConfig {
  channelId: string;
}

export type TriggerConfig =
  | ManualTriggerConfig
  | IntervalTriggerConfig
  | ScheduleTriggerConfig
  | ChannelMessageTriggerConfig;

// ── Table ───────────────────────────────────────────────────────────

export const agentTaskTriggers = pgTable(
  "agent_task__triggers",
  {
    id: uuid("id").primaryKey().notNull(),

    taskId: uuid("task_id")
      .references(() => agentTasks.id, { onDelete: "cascade" })
      .notNull(),

    type: agentTaskTriggerTypeEnum("type").notNull(),

    config: jsonb("config").$type<TriggerConfig>(),

    enabled: boolean("enabled").default(true).notNull(),

    nextRunAt: timestamp("next_run_at"),
    lastRunAt: timestamp("last_run_at"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_agent_task__triggers_task_id").on(table.taskId),
    index("idx_agent_task__triggers_scan").on(
      table.type,
      table.enabled,
      table.nextRunAt,
    ),
  ],
);

export type AgentTaskTrigger = typeof agentTaskTriggers.$inferSelect;
export type NewAgentTaskTrigger = typeof agentTaskTriggers.$inferInsert;
export type AgentTaskTriggerType =
  (typeof agentTaskTriggerTypeEnum.enumValues)[number];
```

**Step 2: Export from index**

Add to `apps/server/libs/database/src/schemas/task/index.ts`:

```typescript
export * from "./task-triggers.js";
```

**Step 3: Add relations**

Add to `apps/server/libs/database/src/schemas/task/relations.ts`:

```typescript
import { agentTaskTriggers } from "./task-triggers.js";

// Add to agentTasksRelations:
//   triggers: many(agentTaskTriggers),

// New relation block:
export const agentTaskTriggersRelations = relations(
  agentTaskTriggers,
  ({ one }) => ({
    task: one(agentTasks, {
      fields: [agentTaskTriggers.taskId],
      references: [agentTasks.id],
    }),
  }),
);
```

**Step 4: Generate and run migration**

```bash
cd apps/server && pnpm db:generate
pnpm db:push  # dev environment
```

**Step 5: Commit**

```bash
git add apps/server/libs/database/src/schemas/task/
git commit -m "feat(db): add agent_task__triggers table and trigger type enum"
```

---

## Task 2: Database Schema — Extend Executions Table

**Files:**

- Modify: `apps/server/libs/database/src/schemas/task/task-executions.ts`
- Modify: `apps/server/libs/database/src/schemas/task/relations.ts`

**Step 1: Add trigger context columns to executions table**

In `apps/server/libs/database/src/schemas/task/task-executions.ts`, add these columns to `agentTaskExecutions`:

```typescript
import { agentTaskTriggers } from './task-triggers.js';
import { documentVersions } from '../document/document-versions.js';

// Add these columns inside the table definition:
triggerId: uuid('trigger_id').references(() => agentTaskTriggers.id),
triggerType: varchar('trigger_type', { length: 32 }),  // manual|interval|schedule|channel_message|retry
triggerContext: jsonb('trigger_context').$type<TriggerContext>(),
documentVersionId: uuid('document_version_id').references(() => documentVersions.id),
sourceExecutionId: uuid('source_execution_id'),  // self-ref for retry
```

Add the TriggerContext types above the table:

```typescript
export interface ManualTriggerContext {
  triggeredAt: string;
  triggeredBy: string;
  notes?: string;
}

export interface ScheduleTriggerContext {
  triggeredAt: string;
  scheduledAt: string;
}

export interface ChannelMessageTriggerContext {
  triggeredAt: string;
  channelId: string;
  messageId: string;
  messageContent?: string;
  senderId: string;
}

export interface RetryTriggerContext {
  triggeredAt: string;
  triggeredBy: string;
  notes?: string;
  originalExecutionId: string;
  originalFailReason?: string;
}

export type TriggerContext =
  | ManualTriggerContext
  | ScheduleTriggerContext
  | ChannelMessageTriggerContext
  | RetryTriggerContext;
```

**Step 2: Add execution→trigger relation**

In `relations.ts`, add to `agentTaskExecutionsRelations`:

```typescript
trigger: one(agentTaskTriggers, {
  fields: [agentTaskExecutions.triggerId],
  references: [agentTaskTriggers.id],
}),
documentVersion: one(documentVersions, {
  fields: [agentTaskExecutions.documentVersionId],
  references: [documentVersions.id],
}),
```

**Step 3: Generate and run migration**

```bash
cd apps/server && pnpm db:generate && pnpm db:push
```

**Step 4: Commit**

```bash
git add apps/server/libs/database/src/schemas/task/
git commit -m "feat(db): add trigger context, document version, and source execution to executions table"
```

---

## Task 3: Backend — Trigger DTOs and Validation

**Files:**

- Create: `apps/server/apps/gateway/src/tasks/dto/trigger.dto.ts`
- Modify: `apps/server/apps/gateway/src/tasks/dto/index.ts`
- Modify: `apps/server/apps/gateway/src/tasks/dto/create-task.dto.ts`

**Step 1: Create trigger DTOs**

Create `apps/server/apps/gateway/src/tasks/dto/trigger.dto.ts`:

```typescript
import {
  IsString,
  IsOptional,
  IsIn,
  IsInt,
  IsBoolean,
  Min,
  Max,
  Matches,
  IsUUID,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import type { AgentTaskTriggerType } from "@team9/database/schemas";

export class IntervalConfigDto {
  @IsInt()
  @Min(1)
  every: number;

  @IsIn(["minutes", "hours", "days", "weeks", "months", "years"] as const)
  unit: string;
}

export class ScheduleConfigNewDto {
  @IsIn(["daily", "weekly", "monthly", "yearly", "weekdays"] as const)
  frequency: string;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: "time must be in HH:mm format",
  })
  time: string;

  @IsString()
  timezone: string;

  @IsInt()
  @Min(0)
  @Max(6)
  @IsOptional()
  dayOfWeek?: number;

  @IsInt()
  @Min(1)
  @Max(31)
  @IsOptional()
  dayOfMonth?: number;
}

export class ChannelMessageConfigDto {
  @IsUUID()
  channelId: string;
}

export class CreateTriggerDto {
  @IsIn(["manual", "interval", "schedule", "channel_message"] as const)
  type: AgentTaskTriggerType;

  @IsOptional()
  @ValidateNested()
  @Type(() => Object) // validated manually based on type
  config?: Record<string, unknown>;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
}

export class UpdateTriggerDto {
  @IsOptional()
  config?: Record<string, unknown>;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
}

export class StartTaskNewDto {
  @IsString()
  @IsOptional()
  notes?: string;

  @IsUUID()
  @IsOptional()
  triggerId?: string;

  @IsString()
  @IsOptional()
  message?: string;
}

export class RetryExecutionDto {
  @IsUUID()
  executionId: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
```

**Step 2: Export from dto/index.ts**

Add to `apps/server/apps/gateway/src/tasks/dto/index.ts`:

```typescript
export * from "./trigger.dto.js";
```

**Step 3: Add triggers to CreateTaskDto**

In `apps/server/apps/gateway/src/tasks/dto/create-task.dto.ts`, add:

```typescript
import { CreateTriggerDto } from './trigger.dto.js';

// Add to CreateTaskDto class:
@ValidateNested({ each: true })
@Type(() => CreateTriggerDto)
@IsOptional()
triggers?: CreateTriggerDto[];
```

**Step 4: Commit**

```bash
git add apps/server/apps/gateway/src/tasks/dto/
git commit -m "feat(tasks): add trigger DTOs and validation classes"
```

---

## Task 4: Backend — Trigger CRUD Service & Controller

**Files:**

- Create: `apps/server/apps/gateway/src/tasks/triggers.service.ts`
- Modify: `apps/server/apps/gateway/src/tasks/tasks.controller.ts`
- Modify: `apps/server/apps/gateway/src/tasks/tasks.service.ts`
- Modify: `apps/server/apps/gateway/src/tasks/tasks.module.ts`

**Step 1: Create TriggersService**

Create `apps/server/apps/gateway/src/tasks/triggers.service.ts` with CRUD operations:

- `create(taskId, dto, tenantId)` — insert trigger, calculate nextRunAt for interval/schedule
- `listByTask(taskId, tenantId)` — return all triggers for a task
- `update(triggerId, dto, tenantId)` — update config/enabled, recalculate nextRunAt
- `delete(triggerId, tenantId)` — delete trigger
- `createBatch(taskId, dtos, tenantId)` — bulk create for task creation flow

Key logic: when creating interval/schedule triggers, calculate initial `nextRunAt` using the existing `calculateNextRunAt` logic (extract and extend from scheduler.service.ts for interval support).

**Step 2: Add trigger endpoints to TasksController**

Add to `apps/server/apps/gateway/src/tasks/tasks.controller.ts`:

```typescript
// Trigger CRUD
@Post(':taskId/triggers')
async createTrigger(
  @Param('taskId', ParseUUIDPipe) taskId: string,
  @Body() dto: CreateTriggerDto,
  @CurrentTenantId() tenantId: string,
) { return this.triggersService.create(taskId, dto, tenantId); }

@Get(':taskId/triggers')
async listTriggers(
  @Param('taskId', ParseUUIDPipe) taskId: string,
  @CurrentTenantId() tenantId: string,
) { return this.triggersService.listByTask(taskId, tenantId); }

@Patch(':taskId/triggers/:triggerId')
async updateTrigger(
  @Param('taskId', ParseUUIDPipe) taskId: string,
  @Param('triggerId', ParseUUIDPipe) triggerId: string,
  @Body() dto: UpdateTriggerDto,
  @CurrentTenantId() tenantId: string,
) { return this.triggersService.update(triggerId, dto, tenantId); }

@Delete(':taskId/triggers/:triggerId')
async deleteTrigger(
  @Param('taskId', ParseUUIDPipe) taskId: string,
  @Param('triggerId', ParseUUIDPipe) triggerId: string,
  @CurrentTenantId() tenantId: string,
) { return this.triggersService.delete(triggerId, tenantId); }

// Retry endpoint
@Post(':id/retry')
async retry(
  @Param('id', ParseUUIDPipe) id: string,
  @CurrentUser('sub') userId: string,
  @CurrentTenantId() tenantId: string,
  @Body() dto: RetryExecutionDto,
) { return this.tasksService.retry(id, dto, userId, tenantId); }
```

**Step 3: Modify TasksService.create to handle inline triggers**

In `tasks.service.ts`, after creating the task, if `dto.triggers` is provided, call `triggersService.createBatch(taskId, dto.triggers, tenantId)`.

**Step 4: Modify TasksService.start to accept notes and trigger context**

Update the `start` method to include `notes` and `triggerId` in the RabbitMQ command payload.

**Step 5: Add TasksService.retry method**

```typescript
async retry(taskId: string, dto: RetryExecutionDto, userId: string, tenantId: string) {
  const task = await this.getTaskOrThrow(taskId, tenantId);
  // Validate source execution exists and is in a terminal state
  // Publish retry command to RabbitMQ with sourceExecutionId + notes
}
```

**Step 6: Register TriggersService in TasksModule**

Add `TriggersService` to providers and exports in `tasks.module.ts`.

**Step 7: Commit**

```bash
git add apps/server/apps/gateway/src/tasks/
git commit -m "feat(tasks): add trigger CRUD service, controller endpoints, and retry"
```

---

## Task 5: Backend — Task-Worker Scheduler Refactor

**Files:**

- Modify: `apps/server/apps/task-worker/src/scheduler/scheduler.service.ts`
- Modify: `apps/server/apps/task-worker/src/executor/executor.service.ts`
- Modify: `apps/server/apps/task-worker/src/consumer/task-command.consumer.ts`

**Step 1: Refactor SchedulerService to scan triggers table**

Replace `doScan()` to query `agent_task__triggers` instead of `agent_task__tasks`:

```typescript
const dueTriggers = await this.db
  .select({
    trigger: schema.agentTaskTriggers,
    taskStatus: schema.agentTasks.status,
  })
  .from(schema.agentTaskTriggers)
  .innerJoin(
    schema.agentTasks,
    eq(schema.agentTaskTriggers.taskId, schema.agentTasks.id),
  )
  .where(
    and(
      eq(schema.agentTaskTriggers.enabled, true),
      inArray(schema.agentTaskTriggers.type, ["interval", "schedule"]),
      lte(schema.agentTaskTriggers.nextRunAt, now),
      notInArray(schema.agentTasks.status, EXCLUDED_STATUSES),
    ),
  );
```

After triggering each, update `trigger.nextRunAt` and `trigger.lastRunAt`.

**Step 2: Extend calculateNextRunAt for interval triggers**

Add interval support:

```typescript
function calculateNextRunAtForInterval(config: IntervalTriggerConfig): Date {
  const now = new Date();
  const ms = intervalToMs(config.every, config.unit);
  return new Date(now.getTime() + ms);
}

function intervalToMs(every: number, unit: string): number {
  switch (unit) {
    case "minutes":
      return every * 60_000;
    case "hours":
      return every * 3_600_000;
    case "days":
      return every * 86_400_000;
    case "weeks":
      return every * 604_800_000;
    case "months":
      return every * 30 * 86_400_000; // approximate
    case "years":
      return every * 365 * 86_400_000; // approximate
    default:
      return every * 86_400_000;
  }
}
```

Also add `weekdays` frequency support to the existing `calculateNextRunAt`:

```typescript
case 'weekdays':
  return nextWeekday(now, hours, minutes, tz);
```

Where `nextWeekday` finds the next Mon-Fri occurrence.

**Step 3: Extend ExecutorService.triggerExecution**

Add optional context parameter:

```typescript
async triggerExecution(taskId: string, opts?: {
  triggerId?: string;
  triggerType?: string;
  triggerContext?: Record<string, unknown>;
  sourceExecutionId?: string;
  documentVersionId?: string;
}): Promise<void>
```

When creating the execution record, include the new fields. Automatically snapshot `documentVersionId` from the task's current document version.

**Step 4: Update TaskCommandConsumer**

Extend the `TaskCommand` interface to include trigger fields:

```typescript
export interface TaskCommand {
  type: "start" | "pause" | "resume" | "stop" | "restart" | "retry";
  taskId: string;
  userId: string;
  message?: string;
  notes?: string;
  triggerId?: string;
  sourceExecutionId?: string;
}
```

Pass trigger context when calling `executor.triggerExecution()`.

**Step 5: Commit**

```bash
git add apps/server/apps/task-worker/src/
git commit -m "feat(task-worker): refactor scheduler to scan triggers table, extend executor with trigger context"
```

---

## Task 6: Backend — Channel Message Trigger Service

**Files:**

- Create: `apps/server/apps/task-worker/src/channel-trigger/channel-trigger.service.ts`
- Create: `apps/server/apps/task-worker/src/channel-trigger/channel-trigger.module.ts`
- Modify: `apps/server/apps/task-worker/src/app.module.ts`
- Modify: `apps/server/libs/rabbitmq/src/constants/queues.ts`

**Step 1: Add RabbitMQ routing key for message events**

In `apps/server/libs/rabbitmq/src/constants/queues.ts`, add:

```typescript
// In RABBITMQ_ROUTING_KEYS:
MESSAGE_CREATED: 'message.created',

// In RABBITMQ_QUEUES:
TASK_WORKER_MESSAGE_EVENTS: 'task-worker-message-events',
```

**Note:** The gateway's WebSocket handler or im-worker must publish `message.created` events to the existing exchange. Verify this exists or add the publish call in the message creation flow.

**Step 2: Create ChannelTriggerService**

Create `apps/server/apps/task-worker/src/channel-trigger/channel-trigger.service.ts`:

- On module init: load all enabled `channel_message` triggers from DB, build a `Map<channelId, trigger[]>`
- Subscribe to `message.created` RabbitMQ events
- On message: check if channelId matches any trigger, if so call `executor.triggerExecution()`
- Provide `refresh()` method to reload triggers from DB (called when triggers are created/deleted)

```typescript
@Injectable()
export class ChannelTriggerService implements OnModuleInit {
  private channelTriggerMap = new Map<string, schema.AgentTaskTrigger[]>();

  async onModuleInit() {
    await this.refresh();
  }

  async refresh() {
    const triggers = await this.db
      .select()
      .from(schema.agentTaskTriggers)
      .where(
        and(
          eq(schema.agentTaskTriggers.type, "channel_message"),
          eq(schema.agentTaskTriggers.enabled, true),
        ),
      );
    this.channelTriggerMap.clear();
    for (const t of triggers) {
      const config = t.config as ChannelMessageTriggerConfig;
      const list = this.channelTriggerMap.get(config.channelId) ?? [];
      list.push(t);
      this.channelTriggerMap.set(config.channelId, list);
    }
  }

  @RabbitSubscribe({
    /* message.created subscription */
  })
  async handleMessage(msg: {
    channelId: string;
    messageId: string;
    content: string;
    senderId: string;
  }) {
    const triggers = this.channelTriggerMap.get(msg.channelId);
    if (!triggers?.length) return;
    for (const trigger of triggers) {
      await this.executor.triggerExecution(trigger.taskId, {
        triggerId: trigger.id,
        triggerType: "channel_message",
        triggerContext: {
          triggeredAt: new Date().toISOString(),
          channelId: msg.channelId,
          messageId: msg.messageId,
          messageContent: msg.content?.slice(0, 500),
          senderId: msg.senderId,
        },
      });
    }
  }
}
```

**Step 3: Create ChannelTriggerModule and register in AppModule**

Create `channel-trigger.module.ts`, import in `app.module.ts`.

**Step 4: Commit**

```bash
git add apps/server/apps/task-worker/src/channel-trigger/ apps/server/libs/rabbitmq/ apps/server/apps/task-worker/src/app.module.ts
git commit -m "feat(task-worker): add channel message trigger service"
```

---

## Task 7: Frontend — Update Types and API Client

**Files:**

- Modify: `apps/client/src/types/task.ts`
- Modify: `apps/client/src/services/api/tasks.ts`

**Step 1: Add trigger types**

In `apps/client/src/types/task.ts`, add:

```typescript
export type AgentTaskTriggerType =
  | "manual"
  | "interval"
  | "schedule"
  | "channel_message";

export interface AgentTaskTrigger {
  id: string;
  taskId: string;
  type: AgentTaskTriggerType;
  config: Record<string, unknown> | null;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ManualTriggerContext {
  triggeredAt: string;
  triggeredBy: string;
  notes?: string;
}

export interface ScheduleTriggerContext {
  triggeredAt: string;
  scheduledAt: string;
}

export interface ChannelMessageTriggerContext {
  triggeredAt: string;
  channelId: string;
  messageId: string;
  messageContent?: string;
  senderId: string;
}

export interface RetryTriggerContext {
  triggeredAt: string;
  triggeredBy: string;
  notes?: string;
  originalExecutionId: string;
  originalFailReason?: string;
}

export type TriggerContext =
  | ManualTriggerContext
  | ScheduleTriggerContext
  | ChannelMessageTriggerContext
  | RetryTriggerContext;

// Add to CreateTaskDto:
//   triggers?: CreateTriggerDto[];

export interface CreateTriggerDto {
  type: AgentTaskTriggerType;
  config?: Record<string, unknown>;
  enabled?: boolean;
}

export interface UpdateTriggerDto {
  config?: Record<string, unknown>;
  enabled?: boolean;
}

export interface RetryExecutionDto {
  executionId: string;
  notes?: string;
}
```

Extend `AgentTaskExecution` with new fields:

```typescript
triggerId: string | null;
triggerType: string | null;
triggerContext: TriggerContext | null;
documentVersionId: string | null;
sourceExecutionId: string | null;
```

**Step 2: Add trigger API methods**

In `apps/client/src/services/api/tasks.ts`, add:

```typescript
// Trigger CRUD
createTrigger: async (taskId: string, dto: CreateTriggerDto) => { ... },
listTriggers: async (taskId: string) => { ... },
updateTrigger: async (taskId: string, triggerId: string, dto: UpdateTriggerDto) => { ... },
deleteTrigger: async (taskId: string, triggerId: string) => { ... },

// Retry
retry: async (taskId: string, dto: RetryExecutionDto) => { ... },

// Update start to accept notes
start: async (id: string, opts?: { notes?: string; triggerId?: string; message?: string }) => { ... },
```

**Step 3: Commit**

```bash
git add apps/client/src/types/task.ts apps/client/src/services/api/tasks.ts
git commit -m "feat(client): add trigger types and API methods"
```

---

## Task 8: Frontend — Task Detail Tab Restructure

**Files:**

- Modify: `apps/client/src/components/tasks/TaskDetailPanel.tsx`
- Create: `apps/client/src/components/tasks/TaskBasicInfoTab.tsx`
- Create: `apps/client/src/components/tasks/TaskTriggersTab.tsx`
- Create: `apps/client/src/components/tasks/TaskDocumentTab.tsx`
- Create: `apps/client/src/components/tasks/TaskRunsTab.tsx`

**Step 1: Extract current content into TaskBasicInfoTab**

Move the task info section (title, description, status badge, bot assignment, control buttons) from `TaskDetailPanel.tsx` into a new `TaskBasicInfoTab.tsx` component.

**Step 2: Create TaskTriggersTab**

Create `apps/client/src/components/tasks/TaskTriggersTab.tsx`:

- Fetch triggers with `useQuery(['task-triggers', taskId], () => tasksApi.listTriggers(taskId))`
- Render each trigger as a card with type icon, config summary, enabled toggle, next run countdown
- "Add Trigger" button opens a dialog:
  - Step 1: Select trigger type (manual/interval/schedule/channel_message)
  - Step 2: Type-specific config form
- Edit/delete per trigger
- For interval/schedule: show "Next run: {time} ({countdown})" using a `useCountdown` hook

**Step 3: Create TaskDocumentTab**

Extract the document preview and version history sections from `TaskDetailPanel.tsx` into `TaskDocumentTab.tsx`.

**Step 4: Create TaskRunsTab**

Create `apps/client/src/components/tasks/TaskRunsTab.tsx`:

- Fetch all executions: `useQuery(['task-executions', taskId], () => tasksApi.getExecutions(taskId))`
- Render as a list ordered by `createdAt` desc
- Each item shows: version badge, trigger type badge, status badge, start time, duration, notes preview
- Click to expand/drill into Run detail (see Task 9)

**Step 5: Restructure TaskDetailPanel with Radix Tabs**

Replace the current monolithic layout with:

```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

<Tabs defaultValue="info">
  <TabsList>
    <TabsTrigger value="info">{t("tabs.info")}</TabsTrigger>
    <TabsTrigger value="triggers">{t("tabs.triggers")}</TabsTrigger>
    <TabsTrigger value="document">{t("tabs.document")}</TabsTrigger>
    <TabsTrigger value="runs">{t("tabs.runs")}</TabsTrigger>
  </TabsList>
  <TabsContent value="info"><TaskBasicInfoTab task={task} ... /></TabsContent>
  <TabsContent value="triggers"><TaskTriggersTab taskId={taskId} /></TabsContent>
  <TabsContent value="document"><TaskDocumentTab task={task} /></TabsContent>
  <TabsContent value="runs"><TaskRunsTab taskId={taskId} /></TabsContent>
</Tabs>
```

**Step 6: Commit**

```bash
git add apps/client/src/components/tasks/
git commit -m "feat(client): restructure task detail panel with tabs (info, triggers, document, runs)"
```

---

## Task 9: Frontend — Run Detail View

**Files:**

- Create: `apps/client/src/components/tasks/RunDetailView.tsx`
- Modify: `apps/client/src/components/tasks/TaskRunsTab.tsx`

**Step 1: Create RunDetailView component**

Create `apps/client/src/components/tasks/RunDetailView.tsx`:

- Props: `taskId`, `executionId`, `onBack` (to return to runs list)
- Fetch execution detail: `tasksApi.getExecution(taskId, executionId)`
- Sections:
  1. **Header** — Back button, version badge, status badge, trigger type badge
  2. **Basic info** — Agent name, document version, trigger context display:
     - Manual: show notes
     - Schedule/Interval: show scheduled vs actual time
     - Channel message: show message preview with channel name
     - Retry: show "Retry of v{N}" with original failure reason
  3. **Execution process** — `TaskStepTimeline` + `TaskInterventionCard` (reuse existing)
  4. **Deliverables** — `TaskDeliverableList` (reuse existing)
  5. **Reflection** — Placeholder section (optional, for future)
  6. **Chat box** — `MessageInput` at bottom for continuing the task

**Step 2: Wire up drill-down from TaskRunsTab**

In `TaskRunsTab`, add state for selected execution. When an execution is clicked, render `RunDetailView` instead of the list.

Add retry button on failed/timeout runs:

- Opens a small dialog with optional notes input
- Calls `tasksApi.retry(taskId, { executionId, notes })`

**Step 3: Commit**

```bash
git add apps/client/src/components/tasks/RunDetailView.tsx apps/client/src/components/tasks/TaskRunsTab.tsx
git commit -m "feat(client): add run detail view with trigger context display and retry"
```

---

## Task 10: Frontend — Manual Trigger Dialog

**Files:**

- Create: `apps/client/src/components/tasks/ManualTriggerDialog.tsx`
- Modify: `apps/client/src/components/tasks/TaskBasicInfoTab.tsx`

**Step 1: Create ManualTriggerDialog**

```tsx
interface ManualTriggerDialogProps {
  taskId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function ManualTriggerDialog({
  taskId,
  isOpen,
  onClose,
}: ManualTriggerDialogProps) {
  const [notes, setNotes] = useState("");
  const startMutation = useMutation({
    mutationFn: () =>
      tasksApi.start(taskId, { notes: notes.trim() || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["task", taskId] });
      onClose();
    },
  });

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("manualTrigger.title")}</DialogTitle>
        </DialogHeader>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t("manualTrigger.notesPlaceholder")}
          rows={4}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("create.cancel")}
          </Button>
          <Button onClick={() => startMutation.mutate()}>
            {startMutation.isPending && (
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            )}
            {t("detail.start")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 2: Wire up in TaskBasicInfoTab**

Replace the direct `startMutation.mutate()` call on the Start button to instead open `ManualTriggerDialog`.

**Step 3: Commit**

```bash
git add apps/client/src/components/tasks/ManualTriggerDialog.tsx apps/client/src/components/tasks/TaskBasicInfoTab.tsx
git commit -m "feat(client): add manual trigger dialog with notes input"
```

---

## Task 11: Frontend — Add Trigger Dialog

**Files:**

- Create: `apps/client/src/components/tasks/AddTriggerDialog.tsx`
- Modify: `apps/client/src/components/tasks/TaskTriggersTab.tsx`

**Step 1: Create AddTriggerDialog**

A multi-step dialog:

1. **Step 1:** Select trigger type (4 cards: Manual, Interval, Schedule, Channel Message)
2. **Step 2:** Type-specific config form:
   - **Manual:** No config needed, just confirm
   - **Interval:** Number input (every) + unit dropdown (minutes/hours/days/weeks/months/years)
   - **Schedule:** Frequency dropdown + time picker + timezone select + conditional day pickers
   - **Channel Message:** Channel selector (reuse existing channel list from workspace)

On submit: call `tasksApi.createTrigger(taskId, dto)`, invalidate triggers query.

**Step 2: Wire into TaskTriggersTab**

Add "Add Trigger" button that opens `AddTriggerDialog`.

**Step 3: Commit**

```bash
git add apps/client/src/components/tasks/AddTriggerDialog.tsx apps/client/src/components/tasks/TaskTriggersTab.tsx
git commit -m "feat(client): add trigger creation dialog with type-specific forms"
```

---

## Task 12: Frontend — Update CreateTaskDialog with Triggers

**Files:**

- Modify: `apps/client/src/components/tasks/CreateTaskDialog.tsx`

**Step 1: Add optional trigger section to CreateTaskDialog**

Add an expandable "Add Triggers" section at the bottom of the create dialog. Users can add one or more triggers inline before creating the task:

- "Add Trigger" button shows a simplified trigger form (type select + config)
- Triggers are stored in local state as `CreateTriggerDto[]`
- On submit, pass to `api.tasks.create({ ...dto, triggers })`

**Step 2: Commit**

```bash
git add apps/client/src/components/tasks/CreateTaskDialog.tsx
git commit -m "feat(client): add inline trigger creation to CreateTaskDialog"
```

---

## Task 13: i18n — Add Trigger Translation Keys

**Files:**

- Modify: `apps/client/src/i18n/locales/en/tasks.json`
- Modify: `apps/client/src/i18n/locales/zh/tasks.json`

**Step 1: Add all new translation keys**

Keys needed:

```json
{
  "tabs": {
    "info": "Info",
    "triggers": "Triggers",
    "document": "Document",
    "runs": "Runs"
  },
  "triggers": {
    "title": "Triggers",
    "add": "Add Trigger",
    "empty": "No triggers configured",
    "types": {
      "manual": "Manual",
      "interval": "Interval",
      "schedule": "Schedule",
      "channel_message": "Channel Message"
    },
    "enabled": "Enabled",
    "disabled": "Disabled",
    "nextRun": "Next run: {{time}}",
    "countdown": "in {{duration}}",
    "lastRun": "Last run: {{time}}",
    "interval": {
      "every": "Every",
      "units": {
        "minutes": "minutes",
        "hours": "hours",
        "days": "days",
        "weeks": "weeks",
        "months": "months",
        "years": "years"
      }
    },
    "schedule": {
      "frequencies": {
        "daily": "Daily",
        "weekly": "Weekly",
        "monthly": "Monthly",
        "yearly": "Yearly",
        "weekdays": "Weekdays"
      },
      "time": "At",
      "timezone": "Timezone",
      "dayOfWeek": "Day",
      "dayOfMonth": "Day of month"
    },
    "channelMessage": {
      "channel": "Channel",
      "selectChannel": "Select channel..."
    },
    "deleteConfirm": "Delete this trigger?"
  },
  "runs": {
    "title": "Runs",
    "empty": "No runs yet",
    "version": "v{{version}}",
    "triggerType": {
      "manual": "Manual",
      "interval": "Interval",
      "schedule": "Scheduled",
      "channel_message": "Message",
      "retry": "Retry"
    },
    "notes": "Notes",
    "retry": "Retry",
    "retryNotes": "Add notes for retry (optional)",
    "back": "Back to runs"
  },
  "manualTrigger": {
    "title": "Start Task",
    "notesPlaceholder": "Add notes or context for this run (optional)..."
  }
}
```

Add corresponding Chinese translations in `zh/tasks.json`.

**Step 2: Commit**

```bash
git add apps/client/src/i18n/locales/
git commit -m "feat(i18n): add trigger and run translation keys (en + zh)"
```

---

## Task 14: Data Migration — Existing Tasks

**Files:**

- Create: `apps/server/libs/database/src/migrations/migrate-task-triggers.ts` (or use Drizzle migration)

**Step 1: Write migration script**

For each existing task:

- If `scheduleType = 'recurring'` and `scheduleConfig` exists: create a `schedule` trigger with the config, copy `nextRunAt`
- For all tasks: create a default `manual` trigger (so every task has at least one manual trigger)

This can be a one-time script or a Drizzle custom migration.

**Step 2: Run migration**

```bash
cd apps/server && npx tsx libs/database/src/migrations/migrate-task-triggers.ts
```

**Step 3: Verify migration**

Query the triggers table to confirm triggers were created correctly.

**Step 4: Commit**

```bash
git add apps/server/libs/database/src/migrations/
git commit -m "feat(db): migrate existing task schedules to triggers table"
```

---

## Task 15: Integration Testing & Cleanup

**Step 1: Test the full flow end-to-end**

1. Create a task with inline triggers via the UI
2. Verify triggers appear in the Triggers tab
3. Click Start → verify ManualTriggerDialog opens → enter notes → confirm
4. Verify Run appears in Runs tab with correct trigger context
5. Add an interval trigger → verify nextRunAt is calculated
6. Add a channel_message trigger → send a message in the watched channel → verify Run is created
7. Test retry on a failed Run

**Step 2: Verify scheduler works with triggers**

```bash
pnpm dev:server:all  # start gateway + task-worker
```

Create a task with an interval trigger (every 1 minute) and verify runs are created.

**Step 3: Clean up deprecated code**

- Mark `scheduleType`, `scheduleConfig`, `nextRunAt` on the tasks table as `@deprecated` in TypeScript types
- Remove old schedule-related UI from CreateTaskDialog (replaced by trigger system)
- Update list filters if needed (remove `scheduleType` filter or adapt to trigger-based filtering)

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: integration testing fixes and deprecated field cleanup"
```
