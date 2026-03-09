# Tasks Module Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an AI Staff (Bot) task management system where users create tasks, bots execute them autonomously, and users monitor progress in real-time via TaskCast SSE.

**Architecture:** Gateway adds a `tasks` module for CRUD/control/bot-API. A new `task-worker` service (port 3002) handles scheduling, execution lifecycle, and timeout fallback. TaskCast (external, port 3721) provides SSE event streaming, state machine, and TTL timeout. Frontend uses `@taskcast/react` for real-time detail views and Socket.io for list-level notifications.

**Tech Stack:** NestJS 11, Drizzle ORM (PostgreSQL), Socket.io, RabbitMQ, TaskCast (`@taskcast/server-sdk`, `@taskcast/react`), React 19, TanStack Router/Query, Zustand.

**Design Doc:** `docs/design/tasks-module-zh.md` (v1.1) — the authoritative reference for all data models, APIs, and UI specs.

**Key Adaptation:** The document system is NOT new — reuse the existing `documents` + `document_versions` tables and `DocumentsModule`. Agent tasks associate with documents via `document_id` FK. The existing `task-tracker` service (port 3002) is replaced by TaskCast; the new `task-worker` service takes its port.

---

## Phase 1: Foundation

### Task 1: Database Schema — Enums & Tasks Main Table

**Files:**

- Create: `apps/server/libs/database/src/schemas/task/tasks.ts`

**Step 1: Create the task enums and main table**

```typescript
import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  index,
  pgEnum,
} from "drizzle-orm/pg-core";
import { tenants } from "../tenant/tenants.js";
import { bots } from "../im/bots.js";
import { users } from "../im/users.js";
import { documents } from "../document/documents.js";

export const agentTaskStatusEnum = pgEnum("agent_task__status", [
  "upcoming",
  "in_progress",
  "paused",
  "pending_action",
  "completed",
  "failed",
  "stopped",
  "timeout",
]);

export const agentTaskScheduleTypeEnum = pgEnum("agent_task__schedule_type", [
  "once",
  "recurring",
]);

export interface ScheduleConfig {
  frequency?: "daily" | "weekly" | "monthly";
  time?: string;
  timezone?: string;
  dayOfWeek?: number;
  dayOfMonth?: number;
  cron?: string;
}

export const agentTasks = pgTable(
  "agent_task__tasks",
  {
    id: uuid("id").primaryKey().notNull(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    botId: uuid("bot_id")
      .references(() => bots.id, { onDelete: "cascade" })
      .notNull(),
    creatorId: uuid("creator_id")
      .references(() => users.id)
      .notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    description: text("description"),
    status: agentTaskStatusEnum("status").default("upcoming").notNull(),
    scheduleType: agentTaskScheduleTypeEnum("schedule_type")
      .default("once")
      .notNull(),
    scheduleConfig: jsonb("schedule_config").$type<ScheduleConfig>(),
    nextRunAt: timestamp("next_run_at"),
    documentId: uuid("document_id").references(() => documents.id),
    currentExecutionId: uuid("current_execution_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_agent_task__tasks_tenant_id").on(table.tenantId),
    index("idx_agent_task__tasks_bot_id").on(table.botId),
    index("idx_agent_task__tasks_creator_id").on(table.creatorId),
    index("idx_agent_task__tasks_status").on(table.status),
    index("idx_agent_task__tasks_next_run_at").on(table.nextRunAt),
    index("idx_agent_task__tasks_tenant_status").on(
      table.tenantId,
      table.status,
    ),
  ],
);

export type AgentTask = typeof agentTasks.$inferSelect;
export type NewAgentTask = typeof agentTasks.$inferInsert;
export type AgentTaskStatus = (typeof agentTaskStatusEnum.enumValues)[number];
export type AgentTaskScheduleType =
  (typeof agentTaskScheduleTypeEnum.enumValues)[number];
```

**Step 2: Verify the file compiles**

Run: `cd apps/server && npx tsc --noEmit --pretty 2>&1 | head -20`

---

### Task 2: Database Schema — Executions, Steps, Deliverables, Interventions

**Files:**

- Create: `apps/server/libs/database/src/schemas/task/task-executions.ts`
- Create: `apps/server/libs/database/src/schemas/task/task-steps.ts`
- Create: `apps/server/libs/database/src/schemas/task/task-deliverables.ts`
- Create: `apps/server/libs/database/src/schemas/task/task-interventions.ts`

**Step 1: Create task-executions.ts**

```typescript
import {
  pgTable,
  uuid,
  integer,
  varchar,
  timestamp,
  jsonb,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { agentTasks, agentTaskStatusEnum } from "./tasks.js";
import { channels } from "../im/channels.js";

export const agentTaskExecutions = pgTable(
  "agent_task__executions",
  {
    id: uuid("id").primaryKey().notNull(),
    taskId: uuid("task_id")
      .references(() => agentTasks.id, { onDelete: "cascade" })
      .notNull(),
    version: integer("version").notNull(),
    status: agentTaskStatusEnum("status").default("in_progress").notNull(),
    channelId: uuid("channel_id").references(() => channels.id),
    taskcastTaskId: varchar("taskcast_task_id", { length: 128 }),
    tokenUsage: integer("token_usage").default(0).notNull(),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    duration: integer("duration"),
    error: jsonb("error").$type<{
      code?: string;
      message: string;
      details?: unknown;
    }>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_agent_task__executions_task_id").on(table.taskId),
    index("idx_agent_task__executions_status").on(table.status),
    index("idx_agent_task__executions_task_version").on(
      table.taskId,
      table.version,
    ),
    unique("uq_agent_task__executions_taskcast").on(table.taskcastTaskId),
  ],
);

export type AgentTaskExecution = typeof agentTaskExecutions.$inferSelect;
export type NewAgentTaskExecution = typeof agentTaskExecutions.$inferInsert;
```

**Step 2: Create task-steps.ts**

```typescript
import {
  pgTable,
  uuid,
  integer,
  varchar,
  timestamp,
  index,
  pgEnum,
} from "drizzle-orm/pg-core";
import { agentTaskExecutions } from "./task-executions.js";
import { agentTasks } from "./tasks.js";

export const agentTaskStepStatusEnum = pgEnum("agent_task__step_status", [
  "pending",
  "in_progress",
  "completed",
  "failed",
]);

export const agentTaskSteps = pgTable(
  "agent_task__steps",
  {
    id: uuid("id").primaryKey().notNull(),
    executionId: uuid("execution_id")
      .references(() => agentTaskExecutions.id, { onDelete: "cascade" })
      .notNull(),
    taskId: uuid("task_id")
      .references(() => agentTasks.id, { onDelete: "cascade" })
      .notNull(),
    orderIndex: integer("order_index").notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    status: agentTaskStepStatusEnum("status").default("pending").notNull(),
    tokenUsage: integer("token_usage").default(0).notNull(),
    duration: integer("duration"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_agent_task__steps_execution_id").on(table.executionId),
    index("idx_agent_task__steps_task_id").on(table.taskId),
  ],
);

export type AgentTaskStep = typeof agentTaskSteps.$inferSelect;
export type NewAgentTaskStep = typeof agentTaskSteps.$inferInsert;
export type AgentTaskStepStatus =
  (typeof agentTaskStepStatusEnum.enumValues)[number];
```

**Step 3: Create task-deliverables.ts**

```typescript
import {
  pgTable,
  uuid,
  varchar,
  bigint,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { agentTaskExecutions } from "./task-executions.js";
import { agentTasks } from "./tasks.js";

export const agentTaskDeliverables = pgTable(
  "agent_task__deliverables",
  {
    id: uuid("id").primaryKey().notNull(),
    executionId: uuid("execution_id")
      .references(() => agentTaskExecutions.id, { onDelete: "cascade" })
      .notNull(),
    taskId: uuid("task_id")
      .references(() => agentTasks.id, { onDelete: "cascade" })
      .notNull(),
    fileName: varchar("file_name", { length: 500 }).notNull(),
    fileSize: bigint("file_size", { mode: "number" }),
    mimeType: varchar("mime_type", { length: 128 }),
    fileUrl: text("file_url").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_agent_task__deliverables_execution_id").on(table.executionId),
    index("idx_agent_task__deliverables_task_id").on(table.taskId),
  ],
);

export type AgentTaskDeliverable = typeof agentTaskDeliverables.$inferSelect;
export type NewAgentTaskDeliverable = typeof agentTaskDeliverables.$inferInsert;
```

**Step 4: Create task-interventions.ts**

```typescript
import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  pgEnum,
} from "drizzle-orm/pg-core";
import { agentTaskExecutions } from "./task-executions.js";
import { agentTasks } from "./tasks.js";
import { agentTaskSteps } from "./task-steps.js";
import { users } from "../im/users.js";

export const agentTaskInterventionStatusEnum = pgEnum(
  "agent_task__intervention_status",
  ["pending", "resolved", "expired"],
);

export interface InterventionAction {
  label: string;
  value: string;
}

export interface InterventionResponse {
  action: string;
  message?: string;
}

export const agentTaskInterventions = pgTable(
  "agent_task__interventions",
  {
    id: uuid("id").primaryKey().notNull(),
    executionId: uuid("execution_id")
      .references(() => agentTaskExecutions.id, { onDelete: "cascade" })
      .notNull(),
    taskId: uuid("task_id")
      .references(() => agentTasks.id, { onDelete: "cascade" })
      .notNull(),
    stepId: uuid("step_id").references(() => agentTaskSteps.id),
    prompt: text("prompt").notNull(),
    actions: jsonb("actions").$type<InterventionAction[]>().notNull(),
    response: jsonb("response").$type<InterventionResponse>(),
    status: agentTaskInterventionStatusEnum("status")
      .default("pending")
      .notNull(),
    resolvedBy: uuid("resolved_by").references(() => users.id),
    resolvedAt: timestamp("resolved_at"),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_agent_task__interventions_execution_id").on(table.executionId),
    index("idx_agent_task__interventions_task_id").on(table.taskId),
    index("idx_agent_task__interventions_status").on(table.status),
  ],
);

export type AgentTaskIntervention = typeof agentTaskInterventions.$inferSelect;
export type NewAgentTaskIntervention =
  typeof agentTaskInterventions.$inferInsert;
export type AgentTaskInterventionStatus =
  (typeof agentTaskInterventionStatusEnum.enumValues)[number];
```

**Step 5: Verify compilation**

Run: `cd apps/server && npx tsc --noEmit --pretty 2>&1 | head -20`

---

### Task 3: Database Schema — Relations, Index & Exports

**Files:**

- Create: `apps/server/libs/database/src/schemas/task/relations.ts`
- Create: `apps/server/libs/database/src/schemas/task/index.ts`
- Modify: `apps/server/libs/database/src/schemas/index.ts`

**Step 1: Create relations.ts**

```typescript
import { relations } from "drizzle-orm";
import { agentTasks } from "./tasks.js";
import { agentTaskExecutions } from "./task-executions.js";
import { agentTaskSteps } from "./task-steps.js";
import { agentTaskDeliverables } from "./task-deliverables.js";
import { agentTaskInterventions } from "./task-interventions.js";
import { tenants } from "../tenant/tenants.js";
import { bots } from "../im/bots.js";
import { users } from "../im/users.js";
import { documents } from "../document/documents.js";
import { channels } from "../im/channels.js";

export const agentTasksRelations = relations(agentTasks, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [agentTasks.tenantId],
    references: [tenants.id],
  }),
  bot: one(bots, {
    fields: [agentTasks.botId],
    references: [bots.id],
  }),
  creator: one(users, {
    fields: [agentTasks.creatorId],
    references: [users.id],
  }),
  document: one(documents, {
    fields: [agentTasks.documentId],
    references: [documents.id],
  }),
  currentExecution: one(agentTaskExecutions, {
    fields: [agentTasks.currentExecutionId],
    references: [agentTaskExecutions.id],
    relationName: "taskCurrentExecution",
  }),
  executions: many(agentTaskExecutions),
}));

export const agentTaskExecutionsRelations = relations(
  agentTaskExecutions,
  ({ one, many }) => ({
    task: one(agentTasks, {
      fields: [agentTaskExecutions.taskId],
      references: [agentTasks.id],
    }),
    channel: one(channels, {
      fields: [agentTaskExecutions.channelId],
      references: [channels.id],
    }),
    steps: many(agentTaskSteps),
    deliverables: many(agentTaskDeliverables),
    interventions: many(agentTaskInterventions),
  }),
);

export const agentTaskStepsRelations = relations(agentTaskSteps, ({ one }) => ({
  execution: one(agentTaskExecutions, {
    fields: [agentTaskSteps.executionId],
    references: [agentTaskExecutions.id],
  }),
  task: one(agentTasks, {
    fields: [agentTaskSteps.taskId],
    references: [agentTasks.id],
  }),
}));

export const agentTaskDeliverablesRelations = relations(
  agentTaskDeliverables,
  ({ one }) => ({
    execution: one(agentTaskExecutions, {
      fields: [agentTaskDeliverables.executionId],
      references: [agentTaskExecutions.id],
    }),
    task: one(agentTasks, {
      fields: [agentTaskDeliverables.taskId],
      references: [agentTasks.id],
    }),
  }),
);

export const agentTaskInterventionsRelations = relations(
  agentTaskInterventions,
  ({ one }) => ({
    execution: one(agentTaskExecutions, {
      fields: [agentTaskInterventions.executionId],
      references: [agentTaskExecutions.id],
    }),
    task: one(agentTasks, {
      fields: [agentTaskInterventions.taskId],
      references: [agentTasks.id],
    }),
    step: one(agentTaskSteps, {
      fields: [agentTaskInterventions.stepId],
      references: [agentTaskSteps.id],
    }),
    resolvedByUser: one(users, {
      fields: [agentTaskInterventions.resolvedBy],
      references: [users.id],
    }),
  }),
);
```

**Step 2: Create index.ts**

```typescript
export * from "./tasks.js";
export * from "./task-executions.js";
export * from "./task-steps.js";
export * from "./task-deliverables.js";
export * from "./task-interventions.js";
export * from "./relations.js";
```

**Step 3: Add task schema export to schemas/index.ts**

Add to `apps/server/libs/database/src/schemas/index.ts`:

```typescript
export * from "./task/index.js";
```

**Step 4: Verify compilation**

Run: `cd apps/server && npx tsc --noEmit --pretty 2>&1 | head -20`

**Step 5: Commit**

```bash
git add apps/server/libs/database/src/schemas/task/ apps/server/libs/database/src/schemas/index.ts
git commit -m "feat(db): add agent_task schema tables (tasks, executions, steps, deliverables, interventions)"
```

---

### Task 4: Channel Type Extension & Migration

**Files:**

- Modify: `apps/server/libs/database/src/schemas/im/channels.ts`

**Step 1: Add 'task' to channelTypeEnum**

In `apps/server/libs/database/src/schemas/im/channels.ts`, change:

```typescript
export const channelTypeEnum = pgEnum("channel_type", [
  "direct",
  "public",
  "private",
]);
```

to:

```typescript
export const channelTypeEnum = pgEnum("channel_type", [
  "direct",
  "public",
  "private",
  "task",
]);
```

**Step 2: Generate migration**

Run: `pnpm db:generate`

**Step 3: Apply migration**

Run: `pnpm db:migrate`

**Step 4: Commit**

```bash
git add apps/server/libs/database/
git commit -m "feat(db): add 'task' channel type and generate agent_task migrations"
```

---

### Task 5: Gateway Tasks Module — DTOs

**Files:**

- Create: `apps/server/apps/gateway/src/tasks/dto/create-task.dto.ts`
- Create: `apps/server/apps/gateway/src/tasks/dto/update-task.dto.ts`
- Create: `apps/server/apps/gateway/src/tasks/dto/task-control.dto.ts`
- Create: `apps/server/apps/gateway/src/tasks/dto/report-steps.dto.ts`
- Create: `apps/server/apps/gateway/src/tasks/dto/create-intervention.dto.ts`
- Create: `apps/server/apps/gateway/src/tasks/dto/resolve-intervention.dto.ts`
- Create: `apps/server/apps/gateway/src/tasks/dto/index.ts`

**Step 1: Create create-task.dto.ts**

```typescript
import {
  IsString,
  IsOptional,
  IsEnum,
  IsObject,
  MaxLength,
  IsUUID,
} from "class-validator";
import type { ScheduleConfig } from "@team9/database/schemas";

export class CreateTaskDto {
  @IsString()
  @MaxLength(500)
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsUUID()
  botId: string;

  @IsOptional()
  @IsEnum(["once", "recurring"])
  scheduleType?: "once" | "recurring";

  @IsOptional()
  @IsObject()
  scheduleConfig?: ScheduleConfig;

  /** Initial document content (Markdown). Auto-creates a document if provided. */
  @IsOptional()
  @IsString()
  documentContent?: string;
}
```

**Step 2: Create update-task.dto.ts**

```typescript
import {
  IsString,
  IsOptional,
  IsEnum,
  IsObject,
  MaxLength,
} from "class-validator";
import type { ScheduleConfig } from "@team9/database/schemas";

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(["once", "recurring"])
  scheduleType?: "once" | "recurring";

  @IsOptional()
  @IsObject()
  scheduleConfig?: ScheduleConfig;
}
```

**Step 3: Create task-control.dto.ts**

```typescript
import { IsOptional, IsString } from "class-validator";

export class StartTaskDto {
  /** Optional message to provide context when starting */
  @IsOptional()
  @IsString()
  message?: string;
}

export class ResumeTaskDto {
  @IsOptional()
  @IsString()
  message?: string;
}

export class StopTaskDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
```

**Step 4: Create report-steps.dto.ts**

```typescript
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

export class StepReportItem {
  @IsInt()
  orderIndex: number;

  @IsString()
  @MaxLength(500)
  title: string;

  @IsEnum(["pending", "in_progress", "completed", "failed"])
  status: "pending" | "in_progress" | "completed" | "failed";

  @IsOptional()
  @IsInt()
  tokenUsage?: number;

  @IsOptional()
  @IsInt()
  duration?: number;
}

export class ReportStepsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StepReportItem)
  steps: StepReportItem[];
}
```

**Step 5: Create create-intervention.dto.ts**

```typescript
import { IsArray, IsOptional, IsString, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

export class InterventionActionItem {
  @IsString()
  label: string;

  @IsString()
  value: string;
}

export class CreateInterventionDto {
  @IsString()
  prompt: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InterventionActionItem)
  actions: InterventionActionItem[];

  /** Optional: link to a specific step */
  @IsOptional()
  @IsString()
  stepId?: string;
}
```

**Step 6: Create resolve-intervention.dto.ts**

```typescript
import { IsOptional, IsString } from "class-validator";

export class ResolveInterventionDto {
  @IsString()
  action: string;

  @IsOptional()
  @IsString()
  message?: string;
}
```

**Step 7: Create dto/index.ts**

```typescript
export * from "./create-task.dto.js";
export * from "./update-task.dto.js";
export * from "./task-control.dto.js";
export * from "./report-steps.dto.js";
export * from "./create-intervention.dto.js";
export * from "./resolve-intervention.dto.js";
```

**Step 8: Commit**

```bash
git add apps/server/apps/gateway/src/tasks/dto/
git commit -m "feat(tasks): add task DTOs for CRUD, control, bot API"
```

---

### Task 6: Gateway Tasks Module — Service (CRUD)

**Files:**

- Create: `apps/server/apps/gateway/src/tasks/tasks.service.ts`

**Ref:** See `apps/server/apps/gateway/src/documents/documents.service.ts` for pattern.

**Step 1: Create tasks.service.ts with CRUD methods**

The service should inject `DatabaseService` and implement:

```typescript
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { DatabaseService } from "@team9/database";
import {
  agentTasks,
  agentTaskExecutions,
  agentTaskSteps,
  agentTaskInterventions,
  agentTaskDeliverables,
} from "@team9/database/schemas";
import { eq, and, inArray, desc, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { CreateTaskDto, UpdateTaskDto } from "./dto/index.js";
import { DocumentsService } from "../documents/documents.service.js";

@Injectable()
export class TasksService {
  constructor(
    private readonly db: DatabaseService,
    private readonly documentsService: DocumentsService,
  ) {}

  /** Create a new task. Optionally creates a linked document. */
  async create(dto: CreateTaskDto, userId: string, tenantId: string) {
    const taskId = uuidv4();

    // Auto-create document if content provided
    let documentId: string | undefined;
    if (dto.documentContent) {
      const doc = await this.documentsService.create(
        {
          documentType: "task_instruction",
          content: dto.documentContent,
          title: dto.title,
        },
        { type: "user", id: userId },
        tenantId,
      );
      documentId = doc.id;
    }

    const [task] = await this.db.drizzle
      .insert(agentTasks)
      .values({
        id: taskId,
        tenantId,
        botId: dto.botId,
        creatorId: userId,
        title: dto.title,
        description: dto.description,
        scheduleType: dto.scheduleType ?? "once",
        scheduleConfig: dto.scheduleConfig,
        documentId,
      })
      .returning();

    return task;
  }

  /** List tasks with optional filters */
  async list(
    tenantId: string,
    filters?: {
      botId?: string;
      status?: string[];
      scheduleType?: string;
    },
  ) {
    const conditions = [eq(agentTasks.tenantId, tenantId)];

    if (filters?.botId) {
      conditions.push(eq(agentTasks.botId, filters.botId));
    }
    if (filters?.status?.length) {
      conditions.push(inArray(agentTasks.status, filters.status as any));
    }
    if (filters?.scheduleType) {
      conditions.push(eq(agentTasks.scheduleType, filters.scheduleType as any));
    }

    return this.db.drizzle
      .select()
      .from(agentTasks)
      .where(and(...conditions))
      .orderBy(desc(agentTasks.updatedAt));
  }

  /** Get task by ID with current execution and steps */
  async getById(taskId: string) {
    const task = await this.db.drizzle.query.agentTasks.findFirst({
      where: eq(agentTasks.id, taskId),
      with: {
        currentExecution: {
          with: {
            steps: true,
            interventions: true,
            deliverables: true,
          },
        },
      },
    });
    if (!task) throw new NotFoundException("Task not found");
    return task;
  }

  /** Update task metadata */
  async update(taskId: string, dto: UpdateTaskDto, userId: string) {
    const task = await this.getTaskOrThrow(taskId);
    // Only creator can edit
    if (task.creatorId !== userId) {
      throw new ForbiddenException("Only task creator can update");
    }

    const [updated] = await this.db.drizzle
      .update(agentTasks)
      .set({
        ...dto,
        updatedAt: new Date(),
      })
      .where(eq(agentTasks.id, taskId))
      .returning();
    return updated;
  }

  /** Delete task */
  async delete(taskId: string, userId: string) {
    const task = await this.getTaskOrThrow(taskId);
    if (task.creatorId !== userId) {
      throw new ForbiddenException("Only task creator can delete");
    }
    await this.db.drizzle.delete(agentTasks).where(eq(agentTasks.id, taskId));
  }

  /** Get executions for a task */
  async getExecutions(taskId: string) {
    return this.db.drizzle
      .select()
      .from(agentTaskExecutions)
      .where(eq(agentTaskExecutions.taskId, taskId))
      .orderBy(desc(agentTaskExecutions.version));
  }

  /** Get a specific execution with steps */
  async getExecution(taskId: string, executionId: string) {
    const execution = await this.db.drizzle.query.agentTaskExecutions.findFirst(
      {
        where: and(
          eq(agentTaskExecutions.id, executionId),
          eq(agentTaskExecutions.taskId, taskId),
        ),
        with: {
          steps: true,
          deliverables: true,
          interventions: true,
        },
      },
    );
    if (!execution) throw new NotFoundException("Execution not found");
    return execution;
  }

  /** Get deliverables, optionally filtered by executionId */
  async getDeliverables(taskId: string, executionId?: string) {
    const conditions = [eq(agentTaskDeliverables.taskId, taskId)];
    if (executionId) {
      conditions.push(eq(agentTaskDeliverables.executionId, executionId));
    }
    return this.db.drizzle
      .select()
      .from(agentTaskDeliverables)
      .where(and(...conditions));
  }

  /** Get pending interventions */
  async getInterventions(taskId: string) {
    return this.db.drizzle
      .select()
      .from(agentTaskInterventions)
      .where(
        and(
          eq(agentTaskInterventions.taskId, taskId),
          eq(agentTaskInterventions.status, "pending"),
        ),
      );
  }

  // ── Helpers ──

  private async getTaskOrThrow(taskId: string) {
    const [task] = await this.db.drizzle
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.id, taskId))
      .limit(1);
    if (!task) throw new NotFoundException("Task not found");
    return task;
  }
}
```

**Step 2: Verify compilation**

---

### Task 7: Gateway Tasks Module — Controller & Module

**Files:**

- Create: `apps/server/apps/gateway/src/tasks/tasks.controller.ts`
- Create: `apps/server/apps/gateway/src/tasks/tasks.module.ts`
- Modify: `apps/server/apps/gateway/src/app.module.ts` — import TasksModule

**Step 1: Create tasks.controller.ts**

```typescript
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard, CurrentUser } from "@team9/auth";
import { TasksService } from "./tasks.service.js";
import { CreateTaskDto, UpdateTaskDto } from "./dto/index.js";

@Controller({ path: "tasks", version: "1" })
@UseGuards(AuthGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  create(
    @Body() dto: CreateTaskDto,
    @CurrentUser("sub") userId: string,
    @CurrentUser("tenantId") tenantId: string,
  ) {
    return this.tasksService.create(dto, userId, tenantId);
  }

  @Get()
  list(
    @CurrentUser("tenantId") tenantId: string,
    @Query("botId") botId?: string,
    @Query("status") status?: string,
    @Query("scheduleType") scheduleType?: string,
  ) {
    const statusArr = status?.split(",").filter(Boolean);
    return this.tasksService.list(tenantId, {
      botId,
      status: statusArr,
      scheduleType,
    });
  }

  @Get(":id")
  getById(@Param("id") id: string) {
    return this.tasksService.getById(id);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateTaskDto,
    @CurrentUser("sub") userId: string,
  ) {
    return this.tasksService.update(id, dto, userId);
  }

  @Delete(":id")
  delete(@Param("id") id: string, @CurrentUser("sub") userId: string) {
    return this.tasksService.delete(id, userId);
  }

  // ── Executions ──

  @Get(":id/executions")
  getExecutions(@Param("id") id: string) {
    return this.tasksService.getExecutions(id);
  }

  @Get(":id/executions/:execId")
  getExecution(@Param("id") id: string, @Param("execId") execId: string) {
    return this.tasksService.getExecution(id, execId);
  }

  // ── Deliverables & Interventions ──

  @Get(":id/deliverables")
  getDeliverables(
    @Param("id") id: string,
    @Query("executionId") executionId?: string,
  ) {
    return this.tasksService.getDeliverables(id, executionId);
  }

  @Get(":id/interventions")
  getInterventions(@Param("id") id: string) {
    return this.tasksService.getInterventions(id);
  }
}
```

**Step 2: Create tasks.module.ts**

```typescript
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { DocumentsModule } from "../documents/documents.module.js";
import { TasksController } from "./tasks.controller.js";
import { TasksService } from "./tasks.service.js";

@Module({
  imports: [AuthModule, DocumentsModule],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
```

**Step 3: Import TasksModule in app.module.ts**

Add `TasksModule` to the `imports` array in `apps/server/apps/gateway/src/app.module.ts`, alongside the other modules (DocumentsModule, BotModule, etc.).

**Step 4: Verify compilation and start server**

Run: `cd apps/server && npx tsc --noEmit --pretty 2>&1 | head -20`
Run: `pnpm dev:server` — verify it starts without errors.

**Step 5: Commit**

```bash
git add apps/server/apps/gateway/src/tasks/ apps/server/apps/gateway/src/app.module.ts
git commit -m "feat(tasks): add Gateway tasks module with CRUD API"
```

---

### Task 8: Frontend Types for Tasks

**Files:**

- Create: `apps/client/src/types/task.ts`
- Modify: `apps/client/src/types/index.ts` — export task types (if index exists)

**Step 1: Create task.ts types**

```typescript
// ── Enums ──

export type AgentTaskStatus =
  | "upcoming"
  | "in_progress"
  | "paused"
  | "pending_action"
  | "completed"
  | "failed"
  | "stopped"
  | "timeout";

export type AgentTaskScheduleType = "once" | "recurring";

export type AgentTaskStepStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed";

export type AgentTaskInterventionStatus = "pending" | "resolved" | "expired";

// ── Interfaces ──

export interface ScheduleConfig {
  frequency?: "daily" | "weekly" | "monthly";
  time?: string;
  timezone?: string;
  dayOfWeek?: number;
  dayOfMonth?: number;
  cron?: string;
}

export interface AgentTask {
  id: string;
  tenantId: string;
  botId: string;
  creatorId: string;
  title: string;
  description: string | null;
  status: AgentTaskStatus;
  scheduleType: AgentTaskScheduleType;
  scheduleConfig: ScheduleConfig | null;
  nextRunAt: string | null;
  documentId: string | null;
  currentExecutionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentTaskExecution {
  id: string;
  taskId: string;
  version: number;
  status: AgentTaskStatus;
  channelId: string | null;
  taskcastTaskId: string | null;
  tokenUsage: number;
  startedAt: string | null;
  completedAt: string | null;
  duration: number | null;
  error: { code?: string; message: string; details?: unknown } | null;
  createdAt: string;
}

export interface AgentTaskStep {
  id: string;
  executionId: string;
  taskId: string;
  orderIndex: number;
  title: string;
  status: AgentTaskStepStatus;
  tokenUsage: number;
  duration: number | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface AgentTaskDeliverable {
  id: string;
  executionId: string;
  taskId: string;
  fileName: string;
  fileSize: number | null;
  mimeType: string | null;
  fileUrl: string;
  createdAt: string;
}

export interface InterventionAction {
  label: string;
  value: string;
}

export interface InterventionResponse {
  action: string;
  message?: string;
}

export interface AgentTaskIntervention {
  id: string;
  executionId: string;
  taskId: string;
  stepId: string | null;
  prompt: string;
  actions: InterventionAction[];
  response: InterventionResponse | null;
  status: AgentTaskInterventionStatus;
  resolvedBy: string | null;
  resolvedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

// ── Task with relations (from GET /v1/tasks/:id) ──

export interface AgentTaskDetail extends AgentTask {
  currentExecution:
    | (AgentTaskExecution & {
        steps: AgentTaskStep[];
        interventions: AgentTaskIntervention[];
        deliverables: AgentTaskDeliverable[];
      })
    | null;
}

// ── DTOs ──

export interface CreateTaskDto {
  title: string;
  botId: string;
  description?: string;
  scheduleType?: AgentTaskScheduleType;
  scheduleConfig?: ScheduleConfig;
  documentContent?: string;
}

export interface UpdateTaskDto {
  title?: string;
  description?: string;
  scheduleType?: AgentTaskScheduleType;
  scheduleConfig?: ScheduleConfig;
}

export interface ResolveInterventionDto {
  action: string;
  message?: string;
}
```

**Step 2: Commit**

```bash
git add apps/client/src/types/task.ts
git commit -m "feat(client): add task module TypeScript types"
```

---

### Task 9: Frontend API Client for Tasks

**Files:**

- Create: `apps/client/src/services/api/tasks.ts`
- Modify: `apps/client/src/services/api/index.ts` — export tasksApi

**Step 1: Create tasks.ts API client**

Follow the pattern from `apps/client/src/services/api/documents.ts`:

```typescript
import { http } from "../http.js";
import type {
  AgentTask,
  AgentTaskDetail,
  AgentTaskExecution,
  AgentTaskDeliverable,
  AgentTaskIntervention,
  CreateTaskDto,
  UpdateTaskDto,
  ResolveInterventionDto,
} from "../../types/task.js";

export const tasksApi = {
  // ── CRUD ──

  create(dto: CreateTaskDto): Promise<AgentTask> {
    return http.post("/v1/tasks", dto);
  },

  list(params?: {
    botId?: string;
    status?: string;
    scheduleType?: string;
  }): Promise<AgentTask[]> {
    return http.get("/v1/tasks", { params });
  },

  getById(id: string): Promise<AgentTaskDetail> {
    return http.get(`/v1/tasks/${id}`);
  },

  update(id: string, dto: UpdateTaskDto): Promise<AgentTask> {
    return http.patch(`/v1/tasks/${id}`, dto);
  },

  delete(id: string): Promise<void> {
    return http.delete(`/v1/tasks/${id}`);
  },

  // ── Control ──

  start(id: string, message?: string): Promise<void> {
    return http.post(`/v1/tasks/${id}/start`, { message });
  },

  pause(id: string): Promise<void> {
    return http.post(`/v1/tasks/${id}/pause`);
  },

  resume(id: string, message?: string): Promise<void> {
    return http.post(`/v1/tasks/${id}/resume`, { message });
  },

  stop(id: string, reason?: string): Promise<void> {
    return http.post(`/v1/tasks/${id}/stop`, { reason });
  },

  restart(id: string): Promise<void> {
    return http.post(`/v1/tasks/${id}/restart`);
  },

  // ── Executions ──

  getExecutions(id: string): Promise<AgentTaskExecution[]> {
    return http.get(`/v1/tasks/${id}/executions`);
  },

  getExecution(id: string, execId: string): Promise<AgentTaskExecution> {
    return http.get(`/v1/tasks/${id}/executions/${execId}`);
  },

  // ── Deliverables & Interventions ──

  getDeliverables(
    id: string,
    executionId?: string,
  ): Promise<AgentTaskDeliverable[]> {
    return http.get(`/v1/tasks/${id}/deliverables`, {
      params: executionId ? { executionId } : undefined,
    });
  },

  getInterventions(id: string): Promise<AgentTaskIntervention[]> {
    return http.get(`/v1/tasks/${id}/interventions`);
  },

  resolveIntervention(
    taskId: string,
    interventionId: string,
    dto: ResolveInterventionDto,
  ): Promise<void> {
    return http.post(
      `/v1/tasks/${taskId}/interventions/${interventionId}/resolve`,
      dto,
    );
  },
};
```

**Step 2: Export from api/index.ts**

Add to `apps/client/src/services/api/index.ts`:

```typescript
export { tasksApi } from "./tasks.js";
```

And add `tasks: tasksApi` to the aggregated `api` object.

**Step 3: Commit**

```bash
git add apps/client/src/services/api/tasks.ts apps/client/src/services/api/index.ts
git commit -m "feat(client): add tasks API client"
```

---

### Task 10: Basic Task List UI (Stub)

**Files:**

- Create: `apps/client/src/components/tasks/TaskList.tsx`
- Create: `apps/client/src/components/tasks/TaskCard.tsx`
- Wire into route (Bot detail tab or standalone page — see design doc section 9.1)

**Step 1: Create TaskList component**

Build a basic task list with three filter tabs (In progress / Upcoming / Finished) per design doc section 9.2. Use TanStack Query to fetch tasks:

```tsx
import { useQuery } from "@tanstack/react-query";
import { tasksApi } from "../../services/api/tasks";
import { useState } from "react";
import { TaskCard } from "./TaskCard";
import type { AgentTaskStatus } from "../../types/task";

const STATUS_GROUPS = {
  active: ["in_progress", "paused", "pending_action"] as AgentTaskStatus[],
  upcoming: ["upcoming"] as AgentTaskStatus[],
  finished: ["completed", "failed", "stopped", "timeout"] as AgentTaskStatus[],
};

interface TaskListProps {
  botId?: string; // optional — if provided, filter by bot
}

export function TaskList({ botId }: TaskListProps) {
  const [tab, setTab] = useState<"active" | "upcoming" | "finished">("active");

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["tasks", { botId, status: STATUS_GROUPS[tab].join(",") }],
    queryFn: () =>
      tasksApi.list({
        botId,
        status: STATUS_GROUPS[tab].join(","),
      }),
  });

  return (
    <div className="flex flex-col h-full">
      {/* Filter tabs */}
      <div className="flex gap-2 p-4 border-b">
        {(["active", "upcoming", "finished"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium ${
              tab === t
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {t === "active"
              ? "In progress"
              : t === "upcoming"
                ? "Upcoming"
                : "Finished"}
          </button>
        ))}
      </div>

      {/* Task cards */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {isLoading ? (
          <div className="text-muted-foreground text-sm">Loading...</div>
        ) : tasks.length === 0 ? (
          <div className="text-muted-foreground text-sm">No tasks</div>
        ) : (
          tasks.map((task) => <TaskCard key={task.id} task={task} />)
        )}
      </div>
    </div>
  );
}
```

**Step 2: Create TaskCard component**

Build per design doc section 9.2 (task card layouts for each status group).

```tsx
import type { AgentTask } from "../../types/task";

interface TaskCardProps {
  task: AgentTask;
  onClick?: () => void;
}

export function TaskCard({ task, onClick }: TaskCardProps) {
  return (
    <div
      onClick={onClick}
      className="p-4 rounded-lg border bg-card cursor-pointer hover:border-primary/50 transition-colors"
    >
      <div className="flex items-center gap-2">
        <StatusIndicator status={task.status} />
        <span className="font-medium text-sm truncate">{task.title}</span>
      </div>
      {task.description && (
        <p className="text-xs text-muted-foreground mt-1 truncate">
          {task.description}
        </p>
      )}
      <div className="text-xs text-muted-foreground mt-2">
        {new Date(task.createdAt).toLocaleDateString()}
      </div>
    </div>
  );
}

function StatusIndicator({ status }: { status: string }) {
  const colors: Record<string, string> = {
    in_progress: "bg-blue-500",
    upcoming: "bg-gray-400",
    paused: "bg-yellow-500",
    pending_action: "bg-orange-500",
    completed: "bg-green-500",
    failed: "bg-red-500",
    stopped: "bg-gray-500",
    timeout: "bg-red-400",
  };
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${colors[status] ?? "bg-gray-400"}`}
    />
  );
}
```

**Step 3: Wire into route**

Create or modify the appropriate route file to render TaskList. This depends on existing routing structure — check `apps/client/src/routes/` for the bot detail page pattern.

**Step 4: Commit**

```bash
git add apps/client/src/components/tasks/
git commit -m "feat(client): add basic TaskList and TaskCard components"
```

---

## Phase 2: Execution Engine

### Task 11: task-worker Service Scaffold

**Files:**

- Create: `apps/server/apps/task-worker/src/main.ts`
- Create: `apps/server/apps/task-worker/src/app.module.ts`
- Create: `apps/server/apps/task-worker/tsconfig.app.json`
- Modify: `apps/server/nest-cli.json` — register task-worker as a NestJS application

**Ref:** Copy structure from `apps/server/apps/task-tracker/` but strip its task-specific logic.

**Step 1: Create main.ts**

```typescript
import "./load-env.js";
import { NestFactory } from "@nestjs/core";
import { VersioningType } from "@nestjs/common";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.setGlobalPrefix("api");
  app.enableVersioning({ type: VersioningType.URI });
  const port = process.env.TASK_WORKER_PORT ?? 3002;
  await app.listen(port);
  console.log(`task-worker running on port ${port}`);
}
bootstrap();
```

**Step 2: Create app.module.ts**

```typescript
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { DatabaseModule } from "@team9/database";
import { RedisModule } from "@team9/redis";
import { RabbitmqModule } from "@team9/rabbitmq";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env.local", ".env"],
    }),
    DatabaseModule,
    RedisModule,
    RabbitmqModule,
  ],
})
export class AppModule {}
```

**Step 3: Create load-env.ts** (copy from task-tracker)

**Step 4: Register in nest-cli.json**

Add `task-worker` project entry following the `task-tracker` pattern in `apps/server/nest-cli.json`.

**Step 5: Add dev script**

In root `package.json`, add:

```json
"dev:task-worker": "cd apps/server && nest start task-worker --watch"
```

**Step 6: Verify it starts**

Run: `pnpm dev:task-worker`
Expected: `task-worker running on port 3002`

**Step 7: Commit**

```bash
git add apps/server/apps/task-worker/ apps/server/nest-cli.json package.json
git commit -m "feat(task-worker): scaffold new task-worker service on port 3002"
```

---

### Task 12: Executor Service & Strategy Interface

**Files:**

- Create: `apps/server/apps/task-worker/src/executor/execution-strategy.interface.ts`
- Create: `apps/server/apps/task-worker/src/executor/executor.service.ts`
- Create: `apps/server/apps/task-worker/src/executor/executor.module.ts`

**Step 1: Create execution strategy interface**

```typescript
export interface ExecutionContext {
  taskId: string;
  executionId: string;
  botId: string;
  channelId: string;
  documentContent?: string;
  taskcastTaskId: string;
}

export interface ExecutionStrategy {
  /** Start execution of a task */
  execute(context: ExecutionContext): Promise<void>;
  /** Pause an in-progress execution */
  pause(context: ExecutionContext): Promise<void>;
  /** Resume a paused execution */
  resume(context: ExecutionContext): Promise<void>;
  /** Stop an execution */
  stop(context: ExecutionContext): Promise<void>;
}
```

**Step 2: Create executor.service.ts**

The executor manages execution lifecycle:

1. Create execution record in DB
2. Create TaskCast task via `@taskcast/server-sdk`
3. Create task channel (im_channels type='task')
4. Add members (creator + bot's shadow userId)
5. Update task status to `in_progress`
6. Transition TaskCast task to `running`
7. Delegate to ExecutionStrategy (OpenClaw)
8. Emit Socket.io events

```typescript
import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "@team9/database";
import {
  agentTasks,
  agentTaskExecutions,
  channels,
} from "@team9/database/schemas";
import { eq, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import type {
  ExecutionStrategy,
  ExecutionContext,
} from "./execution-strategy.interface.js";

@Injectable()
export class ExecutorService {
  private readonly logger = new Logger(ExecutorService.name);
  private strategies = new Map<string, ExecutionStrategy>();

  constructor(private readonly db: DatabaseService) {}

  registerStrategy(botType: string, strategy: ExecutionStrategy) {
    this.strategies.set(botType, strategy);
  }

  async triggerExecution(taskId: string): Promise<void> {
    // 1. Load task
    const [task] = await this.db.drizzle
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.id, taskId))
      .limit(1);
    if (!task) throw new Error(`Task ${taskId} not found`);

    // 2. Determine next version
    const [maxVersion] = await this.db.drizzle
      .select({
        max: sql<number>`COALESCE(MAX(${agentTaskExecutions.version}), 0)`,
      })
      .from(agentTaskExecutions)
      .where(eq(agentTaskExecutions.taskId, taskId));
    const version = (maxVersion?.max ?? 0) + 1;

    // 3. Create execution record
    const executionId = uuidv4();
    const channelId = uuidv4();

    // 4. Create task channel
    await this.db.drizzle.insert(channels).values({
      id: channelId,
      tenantId: task.tenantId,
      name: `Task: ${task.title}`,
      type: "task",
      createdBy: task.creatorId,
    });

    // 5. Add members to channel (creator + bot's shadow userId)
    // TODO: Look up bot's userId from im_bots, insert channel_members

    // 6. Create TaskCast task
    // TODO: POST to TaskCast via @taskcast/server-sdk
    const taskcastTaskId = ""; // placeholder

    // 7. Insert execution record
    await this.db.drizzle.insert(agentTaskExecutions).values({
      id: executionId,
      taskId,
      version,
      status: "in_progress",
      channelId,
      taskcastTaskId: taskcastTaskId || null,
      startedAt: new Date(),
    });

    // 8. Update task
    await this.db.drizzle
      .update(agentTasks)
      .set({
        status: "in_progress",
        currentExecutionId: executionId,
        updatedAt: new Date(),
      })
      .where(eq(agentTasks.id, taskId));

    // 9. Delegate to strategy
    // TODO: Determine bot type, get strategy, call execute()

    // 10. Emit Socket.io events
    // TODO: task:status_changed, task:execution_created

    this.logger.log(
      `Execution ${executionId} (v${version}) triggered for task ${taskId}`,
    );
  }
}
```

**Step 3: Create executor.module.ts**

```typescript
import { Module } from "@nestjs/common";
import { ExecutorService } from "./executor.service.js";

@Module({
  providers: [ExecutorService],
  exports: [ExecutorService],
})
export class ExecutorModule {}
```

**Step 4: Import ExecutorModule in task-worker's AppModule**

**Step 5: Commit**

```bash
git add apps/server/apps/task-worker/src/executor/
git commit -m "feat(task-worker): add executor service with strategy pattern"
```

---

### Task 13: OpenClaw Execution Strategy

**Files:**

- Create: `apps/server/apps/task-worker/src/executor/strategies/openclaw.strategy.ts`

**Step 1: Implement OpenClaw strategy**

```typescript
import { Injectable, Logger } from "@nestjs/common";
import type {
  ExecutionStrategy,
  ExecutionContext,
} from "../execution-strategy.interface.js";

@Injectable()
export class OpenclawStrategy implements ExecutionStrategy {
  private readonly logger = new Logger(OpenclawStrategy.name);

  // Inject OpenClaw HTTP client (from existing @team9/openclaw or similar)

  async execute(context: ExecutionContext): Promise<void> {
    this.logger.log(`Starting OpenClaw agent for task ${context.taskId}`);
    // POST {openclaw_url}/api/agents/{agentId}/execute
    // Body: { taskId, executionId, documentContent, channelId }
    // TODO: Get agentId from bot's extra.openclaw.agentId
  }

  async pause(context: ExecutionContext): Promise<void> {
    this.logger.log(`Pausing OpenClaw agent for task ${context.taskId}`);
    // Send pause signal to OpenClaw
  }

  async resume(context: ExecutionContext): Promise<void> {
    this.logger.log(`Resuming OpenClaw agent for task ${context.taskId}`);
    // Send resume signal to OpenClaw
  }

  async stop(context: ExecutionContext): Promise<void> {
    this.logger.log(`Stopping OpenClaw agent for task ${context.taskId}`);
    // Send stop signal to OpenClaw
  }
}
```

**Step 2: Register strategy in ExecutorModule**

**Step 3: Commit**

```bash
git add apps/server/apps/task-worker/src/executor/strategies/
git commit -m "feat(task-worker): add OpenClaw execution strategy"
```

---

### Task 14: Bot API Controller & Service (Gateway)

**Files:**

- Create: `apps/server/apps/gateway/src/tasks/task-bot.controller.ts`
- Create: `apps/server/apps/gateway/src/tasks/task-bot.service.ts`
- Modify: `apps/server/apps/gateway/src/tasks/tasks.module.ts` — register new providers

**Step 1: Create task-bot.service.ts**

This service handles Bot-reported progress. Each method writes to DB AND publishes a TaskCast event.

```typescript
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { DatabaseService } from "@team9/database";
import {
  agentTasks,
  agentTaskExecutions,
  agentTaskSteps,
  agentTaskInterventions,
  agentTaskDeliverables,
} from "@team9/database/schemas";
import { eq, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import type { ReportStepsDto, CreateInterventionDto } from "./dto/index.js";

@Injectable()
export class TaskBotService {
  constructor(private readonly db: DatabaseService) {}

  /** Report step progress (create or update steps) */
  async reportSteps(taskId: string, botUserId: string, dto: ReportStepsDto) {
    const { task, execution } = await this.getActiveExecution(taskId);

    for (const step of dto.steps) {
      // Upsert by (executionId, orderIndex)
      const existing = await this.db.drizzle
        .select()
        .from(agentTaskSteps)
        .where(
          and(
            eq(agentTaskSteps.executionId, execution.id),
            eq(agentTaskSteps.orderIndex, step.orderIndex),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        // Update existing step
        await this.db.drizzle
          .update(agentTaskSteps)
          .set({
            title: step.title,
            status: step.status as any,
            tokenUsage: step.tokenUsage ?? existing[0].tokenUsage,
            duration: step.duration ?? existing[0].duration,
            startedAt:
              step.status === "in_progress" && !existing[0].startedAt
                ? new Date()
                : existing[0].startedAt,
            completedAt:
              step.status === "completed" || step.status === "failed"
                ? new Date()
                : existing[0].completedAt,
          })
          .where(eq(agentTaskSteps.id, existing[0].id));

        // TODO: Publish TaskCast event: step.updated
      } else {
        // Create new step
        await this.db.drizzle.insert(agentTaskSteps).values({
          id: uuidv4(),
          executionId: execution.id,
          taskId,
          orderIndex: step.orderIndex,
          title: step.title,
          status: step.status as any,
          tokenUsage: step.tokenUsage ?? 0,
          duration: step.duration,
          startedAt: step.status === "in_progress" ? new Date() : undefined,
        });

        // TODO: Publish TaskCast event: step.created
      }
    }

    // Update execution token usage (sum of all steps)
    // TODO: aggregate and update agentTaskExecutions.tokenUsage
  }

  /** Update execution status */
  async updateStatus(
    taskId: string,
    botUserId: string,
    status: string,
    error?: { code?: string; message: string },
  ) {
    const { task, execution } = await this.getActiveExecution(taskId);

    const updateData: Record<string, any> = { status };
    if (status === "completed" || status === "failed" || status === "timeout") {
      updateData.completedAt = new Date();
      if (execution.startedAt) {
        updateData.duration = Math.floor(
          (Date.now() - new Date(execution.startedAt).getTime()) / 1000,
        );
      }
    }
    if (error) updateData.error = error;

    await this.db.drizzle
      .update(agentTaskExecutions)
      .set(updateData)
      .where(eq(agentTaskExecutions.id, execution.id));

    await this.db.drizzle
      .update(agentTasks)
      .set({ status: status as any, updatedAt: new Date() })
      .where(eq(agentTasks.id, taskId));

    // TODO: PATCH TaskCast status
    // TODO: Emit Socket.io task:status_changed
  }

  /** Raise an intervention request */
  async createIntervention(
    taskId: string,
    botUserId: string,
    dto: CreateInterventionDto,
  ) {
    const { task, execution } = await this.getActiveExecution(taskId);

    const interventionId = uuidv4();
    const [intervention] = await this.db.drizzle
      .insert(agentTaskInterventions)
      .values({
        id: interventionId,
        executionId: execution.id,
        taskId,
        stepId: dto.stepId,
        prompt: dto.prompt,
        actions: dto.actions,
      })
      .returning();

    // Update task status to pending_action
    await this.db.drizzle
      .update(agentTasks)
      .set({ status: "pending_action", updatedAt: new Date() })
      .where(eq(agentTasks.id, taskId));

    await this.db.drizzle
      .update(agentTaskExecutions)
      .set({ status: "pending_action" })
      .where(eq(agentTaskExecutions.id, execution.id));

    // TODO: Publish TaskCast event: intervention.requested
    // TODO: PATCH TaskCast status → blocked
    // TODO: Emit Socket.io task:status_changed

    return intervention;
  }

  /** Upload a deliverable */
  async addDeliverable(
    taskId: string,
    botUserId: string,
    data: {
      fileName: string;
      fileSize?: number;
      mimeType?: string;
      fileUrl: string;
    },
  ) {
    const { execution } = await this.getActiveExecution(taskId);

    const deliverableId = uuidv4();
    const [deliverable] = await this.db.drizzle
      .insert(agentTaskDeliverables)
      .values({
        id: deliverableId,
        executionId: execution.id,
        taskId,
        ...data,
      })
      .returning();

    // TODO: Publish TaskCast event: deliverable.added

    return deliverable;
  }

  /** Get task document content for the bot to read */
  async getTaskDocument(taskId: string) {
    const [task] = await this.db.drizzle
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.id, taskId))
      .limit(1);
    if (!task) throw new NotFoundException("Task not found");
    if (!task.documentId) return null;
    // Return document via DocumentsService
    return { documentId: task.documentId };
  }

  // ── Helpers ──

  private async getActiveExecution(taskId: string) {
    const [task] = await this.db.drizzle
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.id, taskId))
      .limit(1);
    if (!task) throw new NotFoundException("Task not found");
    if (!task.currentExecutionId) {
      throw new BadRequestException("No active execution");
    }

    const [execution] = await this.db.drizzle
      .select()
      .from(agentTaskExecutions)
      .where(eq(agentTaskExecutions.id, task.currentExecutionId))
      .limit(1);
    if (!execution) throw new NotFoundException("Execution not found");

    return { task, execution };
  }
}
```

**Step 2: Create task-bot.controller.ts**

```typescript
import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard, CurrentUser } from "@team9/auth";
import { TaskBotService } from "./task-bot.service.js";
import { ReportStepsDto, CreateInterventionDto } from "./dto/index.js";

@Controller({ path: "bot/tasks", version: "1" })
@UseGuards(AuthGuard)
export class TaskBotController {
  constructor(private readonly taskBotService: TaskBotService) {}

  @Post(":id/steps")
  reportSteps(
    @Param("id") taskId: string,
    @CurrentUser("sub") botUserId: string,
    @Body() dto: ReportStepsDto,
  ) {
    return this.taskBotService.reportSteps(taskId, botUserId, dto);
  }

  @Patch(":id/status")
  updateStatus(
    @Param("id") taskId: string,
    @CurrentUser("sub") botUserId: string,
    @Body()
    body: { status: string; error?: { code?: string; message: string } },
  ) {
    return this.taskBotService.updateStatus(
      taskId,
      botUserId,
      body.status,
      body.error,
    );
  }

  @Post(":id/interventions")
  createIntervention(
    @Param("id") taskId: string,
    @CurrentUser("sub") botUserId: string,
    @Body() dto: CreateInterventionDto,
  ) {
    return this.taskBotService.createIntervention(taskId, botUserId, dto);
  }

  @Post(":id/deliverables")
  addDeliverable(
    @Param("id") taskId: string,
    @CurrentUser("sub") botUserId: string,
    @Body()
    body: {
      fileName: string;
      fileSize?: number;
      mimeType?: string;
      fileUrl: string;
    },
  ) {
    return this.taskBotService.addDeliverable(taskId, botUserId, body);
  }

  @Get(":id/document")
  getDocument(@Param("id") taskId: string) {
    return this.taskBotService.getTaskDocument(taskId);
  }
}
```

**Step 3: Update tasks.module.ts to include bot controller/service**

Add `TaskBotController` to controllers and `TaskBotService` to providers.

**Step 4: Commit**

```bash
git add apps/server/apps/gateway/src/tasks/
git commit -m "feat(tasks): add Bot API endpoints for step reporting, status, interventions, deliverables"
```

---

### Task 15: Socket.io Task Events

**Files:**

- Modify: `apps/server/libs/shared/src/events/event-names.ts` — add TASK events
- Modify: `apps/server/libs/shared/src/events/index.ts` — add event types and server/client mappings
- Modify: `apps/client/src/types/ws-events.ts` — add task event types
- Modify: `apps/client/src/services/websocket/index.ts` — add task event listeners

**Step 1: Add TASK events to server event-names.ts**

```typescript
TASK: {
  STATUS_CHANGED: 'task:status_changed',
  EXECUTION_CREATED: 'task:execution_created',
},
```

**Step 2: Add event type interfaces**

```typescript
export interface TaskStatusChangedEvent {
  taskId: string;
  executionId: string;
  status: string;
  previousStatus: string;
}

export interface TaskExecutionCreatedEvent {
  taskId: string;
  execution: {
    id: string;
    version: number;
    status: string;
    channelId: string | null;
    taskcastTaskId: string | null;
    startedAt: string | null;
    createdAt: string;
  };
}
```

**Step 3: Add to ServerToClientEvents mapping**

```typescript
[WS_EVENTS.TASK.STATUS_CHANGED]: (data: TaskStatusChangedEvent) => void;
[WS_EVENTS.TASK.EXECUTION_CREATED]: (data: TaskExecutionCreatedEvent) => void;
```

**Step 4: Mirror types in client ws-events.ts**

**Step 5: Add listeners in websocket service**

In the client WebSocket service, add handlers that invalidate task-related React Query caches:

```typescript
socket.on(WS_EVENTS.TASK.STATUS_CHANGED, (data) => {
  queryClient.invalidateQueries({ queryKey: ["tasks"] });
  queryClient.invalidateQueries({ queryKey: ["task", data.taskId] });
});
```

**Step 6: Commit**

```bash
git add apps/server/libs/shared/src/events/ apps/client/src/types/ws-events.ts apps/client/src/services/websocket/
git commit -m "feat(ws): add task:status_changed and task:execution_created Socket.io events"
```

---

### Task 16: RabbitMQ Task Command Consumer

**Files:**

- Create: `apps/server/apps/task-worker/src/consumer/task-command.consumer.ts`
- Create: `apps/server/apps/task-worker/src/consumer/consumer.module.ts`

**Step 1: Create consumer that processes start/pause/stop/resume commands**

The Gateway sends commands to RabbitMQ; task-worker consumes them and delegates to ExecutorService.

```typescript
import { Injectable, Logger } from "@nestjs/common";
import { RabbitSubscribe } from "@golevelup/nestjs-rabbitmq";
import { ExecutorService } from "../executor/executor.service.js";

export interface TaskCommand {
  type: "start" | "pause" | "resume" | "stop" | "restart";
  taskId: string;
  userId: string;
  message?: string;
}

@Injectable()
export class TaskCommandConsumer {
  private readonly logger = new Logger(TaskCommandConsumer.name);

  constructor(private readonly executor: ExecutorService) {}

  @RabbitSubscribe({
    exchange: "task-commands",
    routingKey: "task.command",
    queue: "task-worker-commands",
  })
  async handleCommand(command: TaskCommand) {
    this.logger.log(
      `Received command: ${command.type} for task ${command.taskId}`,
    );

    switch (command.type) {
      case "start":
      case "restart":
        await this.executor.triggerExecution(command.taskId);
        break;
      case "pause":
        // TODO: delegate to executor.pauseExecution
        break;
      case "resume":
        // TODO: delegate to executor.resumeExecution
        break;
      case "stop":
        // TODO: delegate to executor.stopExecution
        break;
    }
  }
}
```

**Step 2: Create consumer.module.ts, import in AppModule**

**Step 3: Commit**

```bash
git add apps/server/apps/task-worker/src/consumer/
git commit -m "feat(task-worker): add RabbitMQ task command consumer"
```

---

## Phase 3: Interactive Features

### Task 17: Task Control API (Gateway)

**Files:**

- Modify: `apps/server/apps/gateway/src/tasks/tasks.service.ts` — add control methods
- Modify: `apps/server/apps/gateway/src/tasks/tasks.controller.ts` — add control endpoints

**Step 1: Add control methods to TasksService**

```typescript
/** Start / trigger a task (sends command to task-worker via RabbitMQ) */
async start(taskId: string, userId: string, message?: string) {
  const task = await this.getTaskOrThrow(taskId);
  this.validateStatusTransition(task.status, 'start');
  // Publish RabbitMQ command: { type: 'start', taskId, userId, message }
  // TODO: inject RabbitMQ publisher
}

async pause(taskId: string, userId: string) { /* similar pattern */ }
async resume(taskId: string, userId: string, message?: string) { /* ... */ }
async stop(taskId: string, userId: string, reason?: string) { /* ... */ }
async restart(taskId: string, userId: string) { /* ... */ }

private validateStatusTransition(currentStatus: string, action: string) {
  const allowed: Record<string, string[]> = {
    start: ['upcoming', 'paused'],
    pause: ['in_progress'],
    resume: ['paused', 'stopped'],
    stop: ['in_progress', 'paused', 'pending_action'],
    restart: ['completed', 'failed', 'timeout', 'stopped'],
  };
  if (!allowed[action]?.includes(currentStatus)) {
    throw new BadRequestException(
      `Cannot ${action} task in ${currentStatus} status`,
    );
  }
}
```

**Step 2: Add control endpoints to TasksController**

```typescript
@Post(':id/start')
start(@Param('id') id: string, @CurrentUser('sub') userId: string, @Body() dto: StartTaskDto) {
  return this.tasksService.start(id, userId, dto.message);
}

@Post(':id/pause')
pause(@Param('id') id: string, @CurrentUser('sub') userId: string) {
  return this.tasksService.pause(id, userId);
}

@Post(':id/resume')
resume(@Param('id') id: string, @CurrentUser('sub') userId: string, @Body() dto: ResumeTaskDto) {
  return this.tasksService.resume(id, userId, dto.message);
}

@Post(':id/stop')
stop(@Param('id') id: string, @CurrentUser('sub') userId: string, @Body() dto: StopTaskDto) {
  return this.tasksService.stop(id, userId, dto.reason);
}

@Post(':id/restart')
restart(@Param('id') id: string, @CurrentUser('sub') userId: string) {
  return this.tasksService.restart(id, userId);
}
```

**Step 3: Add intervention resolve endpoint**

```typescript
@Post(':id/interventions/:intId/resolve')
resolveIntervention(
  @Param('id') taskId: string,
  @Param('intId') interventionId: string,
  @CurrentUser('sub') userId: string,
  @Body() dto: ResolveInterventionDto,
) {
  return this.tasksService.resolveIntervention(taskId, interventionId, userId, dto);
}
```

**Step 4: Implement resolveIntervention in service**

Update `agentTaskInterventions` record, transition task status back to `in_progress`, publish TaskCast events (`intervention.resolved`, status → running).

**Step 5: Commit**

```bash
git add apps/server/apps/gateway/src/tasks/
git commit -m "feat(tasks): add task control endpoints (start, pause, resume, stop, restart, resolve)"
```

---

### Task 18: TaskCast Integration Service

**Files:**

- Create: `apps/server/apps/gateway/src/tasks/taskcast.service.ts`

**Step 1: Install @taskcast/server-sdk**

Run: `cd apps/server && pnpm add @taskcast/server-sdk`

**Step 2: Create taskcast.service.ts**

Wraps `@taskcast/server-sdk` calls:

```typescript
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
// import { TaskCastClient } from '@taskcast/server-sdk';

@Injectable()
export class TaskCastService {
  private readonly logger = new Logger(TaskCastService.name);
  // private client: TaskCastClient;

  constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>(
      "TASKCAST_URL",
      "http://localhost:3721",
    );
    // this.client = new TaskCastClient({ baseUrl: url });
  }

  /** Create a TaskCast task for an execution */
  async createTask(params: {
    taskId: string;
    executionId: string;
    botId: string;
    tenantId: string;
    ttl?: number;
  }): Promise<string> {
    // POST {taskcast_url}/tasks
    // Body: { type: 'agent_task', params, ttl: params.ttl ?? 86400, tags: [`tenant:${tenantId}`] }
    // Return taskcast_task_id
    this.logger.log(
      `Creating TaskCast task for execution ${params.executionId}`,
    );
    return ""; // placeholder
  }

  /** Transition TaskCast task status */
  async updateStatus(taskcastTaskId: string, status: string): Promise<void> {
    // PATCH {taskcast_url}/tasks/{taskcastTaskId}/status { status }
    this.logger.log(`TaskCast status → ${status} for ${taskcastTaskId}`);
  }

  /** Publish an event to TaskCast */
  async publishEvent(
    taskcastTaskId: string,
    event: {
      type: string;
      data: Record<string, unknown>;
      seriesId?: string;
    },
  ): Promise<void> {
    // POST {taskcast_url}/tasks/{taskcastTaskId}/events
    this.logger.log(`TaskCast event: ${event.type} for ${taskcastTaskId}`);
  }
}
```

**Step 3: Register in TasksModule, inject in TaskBotService and TasksService**

**Step 4: Wire TaskCast calls into existing TODO comments** in TaskBotService

Replace all `// TODO: Publish TaskCast event` and `// TODO: PATCH TaskCast status` with actual calls to TaskCastService.

**Step 5: Commit**

```bash
git add apps/server/apps/gateway/src/tasks/taskcast.service.ts
git commit -m "feat(tasks): add TaskCast integration service"
```

---

### Task 19: Task Details Panel UI

**Files:**

- Create: `apps/client/src/components/tasks/TaskDetailPanel.tsx`
- Create: `apps/client/src/components/tasks/TaskStepTimeline.tsx`
- Create: `apps/client/src/components/tasks/TaskInterventionCard.tsx`
- Create: `apps/client/src/components/tasks/TaskDeliverableList.tsx`

**Step 1: Install @taskcast/react**

Run: `cd apps/client && pnpm add @taskcast/client @taskcast/react`

**Step 2: Create TaskDetailPanel.tsx**

Main panel that opens when clicking a task card. Uses `useTaskEvents` for SSE.

```tsx
import { useQuery } from "@tanstack/react-query";
import { tasksApi } from "../../services/api/tasks";
// import { useTaskEvents } from '@taskcast/react';
import { TaskStepTimeline } from "./TaskStepTimeline";
import { TaskInterventionCard } from "./TaskInterventionCard";
import { TaskDeliverableList } from "./TaskDeliverableList";

interface TaskDetailPanelProps {
  taskId: string;
  onClose: () => void;
}

export function TaskDetailPanel({ taskId, onClose }: TaskDetailPanelProps) {
  const { data: task, isLoading } = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => tasksApi.getById(taskId),
  });

  // SSE via TaskCast for real-time updates
  // const { events } = useTaskEvents(task?.currentExecution?.taskcastTaskId, {
  //   baseUrl: import.meta.env.VITE_TASKCAST_URL,
  //   token: authToken,
  // });

  if (isLoading || !task) return <div>Loading...</div>;

  const execution = task.currentExecution;

  return (
    <div className="flex flex-col h-full border-l bg-background">
      {/* Header */}
      <div className="p-4 border-b">
        <button onClick={onClose} className="text-sm text-muted-foreground">
          Close
        </button>
        <h2 className="text-lg font-semibold mt-2">{task.title}</h2>
        <div className="text-sm text-muted-foreground">
          {task.status} {execution && `· v${execution.version}`}
        </div>
      </div>

      {/* Steps timeline */}
      {execution && (
        <div className="flex-1 overflow-y-auto p-4">
          <TaskStepTimeline steps={execution.steps} />

          {/* Pending interventions */}
          {execution.interventions
            .filter((i) => i.status === "pending")
            .map((i) => (
              <TaskInterventionCard
                key={i.id}
                intervention={i}
                taskId={taskId}
              />
            ))}

          {/* Deliverables */}
          {execution.deliverables.length > 0 && (
            <TaskDeliverableList deliverables={execution.deliverables} />
          )}
        </div>
      )}

      {/* Message input — Task channel */}
      {/* TODO: Reuse existing message input component, pointing to execution.channelId */}
    </div>
  );
}
```

**Step 3: Create TaskStepTimeline, TaskInterventionCard, TaskDeliverableList components**

Follow the design doc section 9.3 for layout. Each component is a presentational component rendering the data.

**Step 4: Wire TaskDetailPanel into TaskList (open on card click)**

**Step 5: Commit**

```bash
git add apps/client/src/components/tasks/
git commit -m "feat(client): add task detail panel with steps timeline, interventions, deliverables"
```

---

### Task 20: Task Channel Message Input

**Files:**

- Modify: `apps/client/src/components/tasks/TaskDetailPanel.tsx` — add message input at bottom

**Step 1: Reuse existing message input component**

The project has an existing message composer/input component. Reuse it with the task channel's `channelId`:

```tsx
{
  execution?.channelId && (
    <div className="border-t">
      <MessageInput channelId={execution.channelId} />
    </div>
  );
}
```

Find the existing message input component path (likely in `apps/client/src/components/channel/`) and import it.

**Step 2: Commit**

```bash
git add apps/client/src/components/tasks/
git commit -m "feat(client): integrate message input in task detail panel"
```

---

## Phase 4: Scheduling & Deliverables

### Task 21: Recurring Task Scheduler (task-worker)

**Files:**

- Create: `apps/server/apps/task-worker/src/scheduler/scheduler.service.ts`
- Create: `apps/server/apps/task-worker/src/scheduler/scheduler.module.ts`

**Step 1: Create scheduler.service.ts**

Uses NestJS `@Cron` or `@Interval` decorator to scan every 30 seconds:

```typescript
import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { DatabaseService } from "@team9/database";
import { agentTasks } from "@team9/database/schemas";
import { eq, and, lte, notInArray } from "drizzle-orm";
import { ExecutorService } from "../executor/executor.service.js";

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly executor: ExecutorService,
  ) {}

  @Interval(30_000)
  async scanRecurringTasks() {
    const now = new Date();

    const dueTasks = await this.db.drizzle
      .select()
      .from(agentTasks)
      .where(
        and(
          eq(agentTasks.scheduleType, "recurring"),
          lte(agentTasks.nextRunAt, now),
          notInArray(agentTasks.status, ["stopped", "paused"]),
        ),
      );

    for (const task of dueTasks) {
      try {
        await this.executor.triggerExecution(task.id);
        // Calculate and update next_run_at based on scheduleConfig
        // TODO: implement calculateNextRunAt(task.scheduleConfig)
        this.logger.log(`Triggered recurring task ${task.id}`);
      } catch (err) {
        this.logger.error(`Failed to trigger task ${task.id}`, err);
      }
    }
  }
}
```

**Step 2: Install @nestjs/schedule if not present**

Run: `cd apps/server && pnpm add @nestjs/schedule`

**Step 3: Create scheduler.module.ts, import ScheduleModule.forRoot() and ExecutorModule**

**Step 4: Import SchedulerModule in task-worker AppModule**

**Step 5: Commit**

```bash
git add apps/server/apps/task-worker/src/scheduler/
git commit -m "feat(task-worker): add recurring task scheduler (30s interval scan)"
```

---

### Task 22: Schedule Configuration UI

**Files:**

- Create: `apps/client/src/components/tasks/ScheduleConfigForm.tsx`
- Modify: create-task dialog/form to include schedule options

**Step 1: Create ScheduleConfigForm**

A form component for configuring task schedules (once/recurring, frequency, time, timezone).

```tsx
import type { ScheduleConfig, AgentTaskScheduleType } from "../../types/task";

interface ScheduleConfigFormProps {
  scheduleType: AgentTaskScheduleType;
  scheduleConfig?: ScheduleConfig;
  onScheduleTypeChange: (type: AgentTaskScheduleType) => void;
  onConfigChange: (config: ScheduleConfig) => void;
}

export function ScheduleConfigForm({
  scheduleType,
  scheduleConfig,
  onScheduleTypeChange,
  onConfigChange,
}: ScheduleConfigFormProps) {
  return (
    <div className="space-y-3">
      {/* Schedule type toggle */}
      <div className="flex gap-2">
        <button onClick={() => onScheduleTypeChange("once")}>One-time</button>
        <button onClick={() => onScheduleTypeChange("recurring")}>
          Recurring
        </button>
      </div>

      {scheduleType === "recurring" && (
        <>
          {/* Frequency selector */}
          <select
            value={scheduleConfig?.frequency ?? "daily"}
            onChange={(e) =>
              onConfigChange({
                ...scheduleConfig,
                frequency: e.target.value as any,
              })
            }
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>

          {/* Time picker */}
          <input
            type="time"
            value={scheduleConfig?.time ?? "09:00"}
            onChange={(e) =>
              onConfigChange({ ...scheduleConfig, time: e.target.value })
            }
          />

          {/* Day of week (for weekly) */}
          {scheduleConfig?.frequency === "weekly" && (
            <select
              value={scheduleConfig?.dayOfWeek ?? 1}
              onChange={(e) =>
                onConfigChange({
                  ...scheduleConfig,
                  dayOfWeek: Number(e.target.value),
                })
              }
            >
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => (
                <option key={i} value={i}>
                  {d}
                </option>
              ))}
            </select>
          )}
        </>
      )}
    </div>
  );
}
```

**Step 2: Integrate into task creation flow**

**Step 3: Commit**

```bash
git add apps/client/src/components/tasks/
git commit -m "feat(client): add schedule configuration form for recurring tasks"
```

---

### Task 23: Deliverable Upload & Display

**Bot-side upload is already handled by Task 14** (TaskBotController.addDeliverable).

**Files:**

- The `TaskDeliverableList` component was stubbed in Task 19. Flesh it out.

**Step 1: Complete TaskDeliverableList.tsx**

```tsx
import type { AgentTaskDeliverable } from "../../types/task";
import { FileIcon, ImageIcon, FileTextIcon } from "lucide-react";

interface Props {
  deliverables: AgentTaskDeliverable[];
}

export function TaskDeliverableList({ deliverables }: Props) {
  if (deliverables.length === 0) return null;

  return (
    <div className="mt-4">
      <h4 className="text-sm font-medium mb-2">
        Deliverables ({deliverables.length} files)
      </h4>
      <div className="space-y-2">
        {deliverables.map((d) => (
          <a
            key={d.id}
            href={d.fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 p-3 rounded-md border hover:bg-muted transition-colors"
          >
            <DeliverableIcon mimeType={d.mimeType} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{d.fileName}</div>
              {d.fileSize && (
                <div className="text-xs text-muted-foreground">
                  {formatFileSize(d.fileSize)}
                </div>
              )}
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

function DeliverableIcon({ mimeType }: { mimeType: string | null }) {
  if (mimeType?.startsWith("image/")) return <ImageIcon className="w-5 h-5" />;
  if (mimeType?.includes("pdf") || mimeType?.includes("document"))
    return <FileTextIcon className="w-5 h-5" />;
  return <FileIcon className="w-5 h-5" />;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
```

**Step 2: Commit**

```bash
git add apps/client/src/components/tasks/
git commit -m "feat(client): complete deliverable list component with file icons and size formatting"
```

---

### Task 24: Finished Task View with History Replay

**Step 1: No extra work needed for backend**

TaskCast automatically replays historical events when `useTaskEvents` connects to a completed task's `taskcastTaskId`. The `TaskDetailPanel` already handles this.

**Step 2: Enhance TaskDetailPanel for finished states**

Add conditional rendering for completed/failed/timeout tasks:

- Show completion time and duration
- Show "Restart" button
- Show error details for failed tasks
- Deliverables are already shown

**Step 3: Commit**

```bash
git add apps/client/src/components/tasks/
git commit -m "feat(client): enhance task detail panel for finished task states"
```

---

## Phase 5: Polish

### Task 25: Timeout Detection

**Files:**

- Create: `apps/server/apps/task-worker/src/timeout/timeout.service.ts`
- Create: `apps/server/apps/task-worker/src/timeout/timeout.module.ts`
- Create: `apps/server/apps/task-worker/src/webhook/webhook.controller.ts` (for TaskCast webhook callback)

**Step 1: Create timeout.service.ts (fallback scanner)**

```typescript
import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { DatabaseService } from "@team9/database";
import { agentTaskExecutions, agentTasks } from "@team9/database/schemas";
import { eq, and, lt, sql } from "drizzle-orm";

@Injectable()
export class TimeoutService {
  private readonly logger = new Logger(TimeoutService.name);

  constructor(private readonly db: DatabaseService) {}

  /** Fallback scan every 5 minutes */
  @Interval(300_000)
  async scanTimeouts() {
    const timedOut = await this.db.drizzle
      .select()
      .from(agentTaskExecutions)
      .where(
        and(
          eq(agentTaskExecutions.status, "in_progress"),
          lt(agentTaskExecutions.startedAt, sql`NOW() - INTERVAL '24 hours'`),
        ),
      );

    for (const execution of timedOut) {
      try {
        await this.db.drizzle
          .update(agentTaskExecutions)
          .set({ status: "timeout", completedAt: new Date() })
          .where(eq(agentTaskExecutions.id, execution.id));

        await this.db.drizzle
          .update(agentTasks)
          .set({ status: "timeout", updatedAt: new Date() })
          .where(eq(agentTasks.id, execution.taskId));

        // TODO: Sync TaskCast status if not already timeout
        // TODO: Emit Socket.io task:status_changed
        // TODO: Notify OpenClaw to stop agent

        this.logger.warn(`Execution ${execution.id} timed out (fallback scan)`);
      } catch (err) {
        this.logger.error(`Failed to timeout execution ${execution.id}`, err);
      }
    }
  }
}
```

**Step 2: Create webhook controller for TaskCast TTL callback**

```typescript
import { Controller, Post, Body, Logger } from "@nestjs/common";

@Controller({ path: "webhooks/taskcast", version: "1" })
export class TaskCastWebhookController {
  private readonly logger = new Logger(TaskCastWebhookController.name);

  @Post("timeout")
  async handleTimeout(@Body() body: { taskId: string; status: string }) {
    this.logger.log(`TaskCast webhook: timeout for ${body.taskId}`);
    // Same logic as fallback scanner: update DB, emit events
  }
}
```

**Step 3: Create modules, import in task-worker AppModule**

**Step 4: Commit**

```bash
git add apps/server/apps/task-worker/src/timeout/ apps/server/apps/task-worker/src/webhook/
git commit -m "feat(task-worker): add timeout detection (TaskCast webhook + fallback scan)"
```

---

### Task 26: Error Handling & Retry

**Step 1: Add error handling in ExecutorService**

Wrap execution trigger in try/catch. On failure:

- Update execution status to `failed`
- Update task status to `failed`
- Store error in execution record
- Emit Socket.io event
- Publish TaskCast error event

**Step 2: Add retry logic**

If execution fails, check if auto-retry is configured. If so, create a new execution.

**Step 3: Commit**

```bash
git commit -m "feat(task-worker): add error handling and retry logic for failed executions"
```

---

### Task 27: Token Usage Tracking & Display

**Step 1: Backend — aggregate token usage in TaskBotService.reportSteps**

After updating steps, sum all step token usage and update `agentTaskExecutions.tokenUsage`:

```typescript
const totalTokens = await this.db.drizzle
  .select({
    total: sql<number>`COALESCE(SUM(${agentTaskSteps.tokenUsage}), 0)`,
  })
  .from(agentTaskSteps)
  .where(eq(agentTaskSteps.executionId, execution.id));

await this.db.drizzle
  .update(agentTaskExecutions)
  .set({ tokenUsage: totalTokens[0].total })
  .where(eq(agentTaskExecutions.id, execution.id));

// Publish TaskCast event: token_usage
```

**Step 2: Frontend — display token usage in TaskCard and TaskDetailPanel**

Add token count display (e.g., "248 Tokens") per design doc section 9.2-9.3.

**Step 3: Commit**

```bash
git commit -m "feat(tasks): add token usage tracking and display"
```

---

### Task 28: Document Version History UI

**Step 1: The document API already exists** (`/v1/documents/:id/versions`)

**Step 2: Create a DocumentVersionHistory component** in the task detail panel

```tsx
import { useQuery } from "@tanstack/react-query";
import { documentsApi } from "../../services/api/documents";

interface Props {
  documentId: string;
}

export function DocumentVersionHistory({ documentId }: Props) {
  const { data: versions = [] } = useQuery({
    queryKey: ["document-versions", documentId],
    queryFn: () => documentsApi.getVersions(documentId),
  });

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium">Document Versions</h4>
      {versions.map((v) => (
        <div key={v.id} className="text-xs p-2 border rounded">
          <span className="font-medium">v{v.versionIndex}</span>
          {v.summary && (
            <span className="text-muted-foreground"> — {v.summary}</span>
          )}
          <div className="text-muted-foreground mt-1">
            {new Date(v.createdAt).toLocaleString()}
          </div>
        </div>
      ))}
    </div>
  );
}
```

**Step 3: Wire into TaskDetailPanel (show when task has documentId)**

**Step 4: Commit**

```bash
git add apps/client/src/components/tasks/
git commit -m "feat(client): add document version history in task detail panel"
```

---

## Summary of All Tasks

| Phase | Task | Description                                                |
| ----- | ---- | ---------------------------------------------------------- |
| 1     | 1    | DB Schema — Enums & Tasks table                            |
| 1     | 2    | DB Schema — Executions, Steps, Deliverables, Interventions |
| 1     | 3    | DB Schema — Relations, index & exports                     |
| 1     | 4    | Channel type extension ('task') & migration                |
| 1     | 5    | Gateway DTOs for tasks                                     |
| 1     | 6    | Gateway Tasks Service (CRUD)                               |
| 1     | 7    | Gateway Tasks Controller & Module                          |
| 1     | 8    | Frontend types for tasks                                   |
| 1     | 9    | Frontend API client for tasks                              |
| 1     | 10   | Basic TaskList & TaskCard UI                               |
| 2     | 11   | task-worker service scaffold                               |
| 2     | 12   | Executor service & strategy interface                      |
| 2     | 13   | OpenClaw execution strategy                                |
| 2     | 14   | Bot API controller & service (Gateway)                     |
| 2     | 15   | Socket.io task events (server + client)                    |
| 2     | 16   | RabbitMQ task command consumer                             |
| 3     | 17   | Task control API (start/pause/resume/stop/restart)         |
| 3     | 18   | TaskCast integration service                               |
| 3     | 19   | Task detail panel UI (SSE + timeline)                      |
| 3     | 20   | Task channel message input                                 |
| 4     | 21   | Recurring task scheduler                                   |
| 4     | 22   | Schedule configuration UI                                  |
| 4     | 23   | Deliverable upload & display                               |
| 4     | 24   | Finished task view with history replay                     |
| 5     | 25   | Timeout detection (webhook + fallback)                     |
| 5     | 26   | Error handling & retry                                     |
| 5     | 27   | Token usage tracking & display                             |
| 5     | 28   | Document version history UI                                |
