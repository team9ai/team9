# Task → Routine Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the "Task" concept to "Routine" across database, backend, and frontend layers, following the semantic judgment principle in the [design spec](../specs/2026-04-07-task-to-routine-rename-design.md).

**Architecture:** This is a naming refactor organized in dependency order: database schemas first, then backend (shared libs → gateway module → task-worker internals), then frontend (types → services → components → routes → i18n). Each layer builds on the previous.

**Tech Stack:** Drizzle ORM (PostgreSQL), NestJS, React + TypeScript, TanStack Router, TanStack React Query, Socket.io, i18next, RabbitMQ

---

## File Structure

### Database Layer

- **Modify:** `apps/server/libs/database/src/schemas/task/*.ts` → rename to `schemas/routine/*.ts` (6 schema files + relations + index)
- **Modify:** `apps/server/libs/database/src/schemas/index.ts` (re-export path)
- **Create:** Migration file via `pnpm db:generate`

### Shared Libraries

- **Modify:** `apps/server/libs/shared/src/events/domains/task.events.ts` → `routine.events.ts`
- **Modify:** `apps/server/libs/shared/src/events/domains/index.ts` (re-export path)
- **Modify:** `apps/server/libs/shared/src/events/event-names.ts` (WS_EVENTS.TASK → ROUTINE)
- **Modify:** `apps/server/libs/shared/src/events/index.ts` (type imports + ServerToClientEvents)

### Backend Gateway

- **Modify:** All files in `apps/server/apps/gateway/src/tasks/` → move to `gateway/src/routines/`
- **Modify:** `apps/server/apps/gateway/src/app.module.ts` (import path)

### Backend Task-Worker

- **Modify:** Internal `taskId` references in `apps/server/apps/task-worker/src/` (variable names only, not directory)

### Frontend

- **Modify:** `apps/client/src/types/task.ts` → `types/routine.ts`
- **Modify:** `apps/client/src/services/api/tasks.ts` → `services/api/routines.ts`
- **Modify:** `apps/client/src/services/api/index.ts`
- **Modify:** All files in `apps/client/src/components/tasks/` → move to `components/routines/`
- **Modify:** `apps/client/src/routes/_authenticated/tasks/` → `routes/_authenticated/routines/`
- **Modify:** `apps/client/src/lib/task-trigger-keys.ts` → `lib/routine-trigger-keys.ts`
- **Modify:** `apps/client/src/i18n/locales/en/tasks.json` → `en/routines.json`
- **Modify:** `apps/client/src/i18n/locales/zh/tasks.json` → `zh/routines.json`
- **Modify:** `apps/client/src/i18n/locales/en/navigation.json` + `zh/navigation.json`
- **Modify:** `apps/client/src/i18n/index.ts`
- **Modify:** `apps/client/src/hooks/useWebSocketEvents.ts`
- **Modify:** `apps/client/src/types/ws-events.ts`
- **Modify:** `apps/client/src/services/websocket/index.ts`

---

### Task 0: Database Schema Rename (Drizzle definitions)

**Goal:** Rename all Drizzle schema definitions from `agentTask*` to `routine*`, move directory from `task/` to `routine/`.

**Files:**

- Rename dir: `apps/server/libs/database/src/schemas/task/` → `schemas/routine/`
- Rename files: `tasks.ts` → `routines.ts`, `task-executions.ts` → `routine-executions.ts`, `task-steps.ts` → `routine-steps.ts`, `task-deliverables.ts` → `routine-deliverables.ts`, `task-interventions.ts` → `routine-interventions.ts`, `task-triggers.ts` → `routine-triggers.ts`
- Modify: `relations.ts`, `index.ts`, `schemas/index.ts`

**Acceptance Criteria:**

- [ ] All Drizzle table variables renamed (`agentTasks` → `routines`, etc.)
- [ ] All table name strings updated (`'agent_task__tasks'` → `'routine__routines'`, etc.)
- [ ] All enum name strings updated (`'agent_task__status'` → `'routine__status'`, etc.)
- [ ] All `taskId` fields → `routineId`, `taskVersion` → `routineVersion`, column strings updated
- [ ] All index/constraint names updated
- [ ] All exported types renamed (`AgentTask` → `Routine`, `AgentTaskExecution` → `RoutineExecution`, etc.)
- [ ] `taskcastTaskId` / `taskcast_task_id` unchanged
- [ ] Relations file updated with new variable names
- [ ] Re-exports updated in `routine/index.ts` and `schemas/index.ts`

**Verify:** `pnpm build:server` → compiles without errors

**Steps:**

- [ ] **Step 1: Rename directory and files**

```bash
cd apps/server/libs/database/src/schemas
git mv task routine
cd routine
git mv tasks.ts routines.ts
git mv task-executions.ts routine-executions.ts
git mv task-steps.ts routine-steps.ts
git mv task-deliverables.ts routine-deliverables.ts
git mv task-interventions.ts routine-interventions.ts
git mv task-triggers.ts routine-triggers.ts
```

- [ ] **Step 2: Update `routines.ts`**

Rename all identifiers in the file:

- Enums: `agentTaskStatusEnum` → `routineStatusEnum`, enum DB name `'agent_task__status'` → `'routine__status'`
- `agentTaskScheduleTypeEnum` → `routineScheduleTypeEnum`, DB name `'agent_task__schedule_type'` → `'routine__schedule_type'`
- Table: `agentTasks` → `routines`, DB table name `'agent_task__tasks'` → `'routine__routines'`
- Index names: `idx_agent_task__tasks_*` → `idx_routine__routines_*`
- Types: `AgentTask` → `Routine`, `NewAgentTask` → `NewRoutine`, `AgentTaskStatus` → `RoutineStatus`, `AgentTaskScheduleType` → `RoutineScheduleType`

- [ ] **Step 3: Update `routine-executions.ts`**

- Table: `agentTaskExecutions` → `routineExecutions`, name `'agent_task__executions'` → `'routine__executions'`
- Fields: `taskId` → `routineId` (column `'task_id'` → `'routine_id'`), `taskVersion` → `routineVersion` (column `'task_version'` → `'routine_version'`)
- `taskcastTaskId` — **unchanged**
- FK reference: `agentTasks.id` → `routines.id`
- Indexes: `idx_agent_task__executions_*` → `idx_routine__executions_*`
- Unique: `uq_agent_task__executions_taskcast` → `uq_routine__executions_taskcast`
- Types: `AgentTaskExecution` → `RoutineExecution`, `NewAgentTaskExecution` → `NewRoutineExecution`

- [ ] **Step 4: Update `routine-steps.ts`**

- Enum: `agentTaskStepStatusEnum` → `routineStepStatusEnum`, name `'agent_task__step_status'` → `'routine__step_status'`
- Table: `agentTaskSteps` → `routineSteps`, name `'agent_task__steps'` → `'routine__steps'`
- Fields: `taskId` → `routineId`, FK → `routines.id`
- Indexes, types updated same pattern

- [ ] **Step 5: Update `routine-deliverables.ts`**

Same pattern: `agentTaskDeliverables` → `routineDeliverables`, `taskId` → `routineId`, table/index/type names updated.

- [ ] **Step 6: Update `routine-interventions.ts`**

Enum: `agentTaskInterventionStatusEnum` → `routineInterventionStatusEnum`. Table: `agentTaskInterventions` → `routineInterventions`. Fields: `taskId` → `routineId`. All names updated.

- [ ] **Step 7: Update `routine-triggers.ts`**

Enum: `agentTaskTriggerTypeEnum` → `routineTriggerTypeEnum`. Table: `agentTaskTriggers` → `routineTriggers`. Fields: `taskId` → `routineId`. All names updated.

- [ ] **Step 8: Update `relations.ts`**

- Update imports from renamed files
- `agentTasksRelations` → `routinesRelations`, etc. for all 6 relation definitions
- All `fields: [xxx.taskId]` → `fields: [xxx.routineId]`
- All table references updated

- [ ] **Step 9: Update `routine/index.ts`**

```typescript
export * from "./routines.js";
export * from "./routine-executions.js";
export * from "./routine-steps.js";
export * from "./routine-deliverables.js";
export * from "./routine-interventions.js";
export * from "./routine-triggers.js";
export * from "./relations.js";
```

- [ ] **Step 10: Update `schemas/index.ts`**

```diff
- export * from './task/index.js';
+ export * from './routine/index.js';
```

- [ ] **Step 11: Commit**

```bash
git add -A apps/server/libs/database/src/schemas/
git commit -m "refactor(db): rename task schema to routine"
```

---

### Task 1: Database Migration

**Goal:** Generate and verify the Drizzle migration that renames tables, columns, enums, and indexes in PostgreSQL.

**Files:**

- Create: Migration file generated by `pnpm db:generate`

**Acceptance Criteria:**

- [ ] Migration file contains `ALTER TABLE ... RENAME TO` for all 6 tables
- [ ] Migration renames columns `task_id` → `routine_id` and `task_version` → `routine_version`
- [ ] Migration renames enums with `ALTER TYPE ... RENAME TO`
- [ ] Migration renames indexes
- [ ] `taskcast_task_id` column unchanged
- [ ] Migration applies cleanly on a fresh DB

**Verify:** `pnpm db:generate && pnpm db:migrate` → succeeds

**Steps:**

- [ ] **Step 1: Generate migration**

```bash
pnpm db:generate
```

Review the generated SQL. Drizzle may generate DROP/CREATE instead of RENAME. If so, manually edit the migration to use RENAME operations:

```sql
-- Tables
ALTER TABLE "agent_task__tasks" RENAME TO "routine__routines";
ALTER TABLE "agent_task__executions" RENAME TO "routine__executions";
ALTER TABLE "agent_task__steps" RENAME TO "routine__steps";
ALTER TABLE "agent_task__deliverables" RENAME TO "routine__deliverables";
ALTER TABLE "agent_task__interventions" RENAME TO "routine__interventions";
ALTER TABLE "agent_task__triggers" RENAME TO "routine__triggers";

-- Columns (routine_id)
ALTER TABLE "routine__executions" RENAME COLUMN "task_id" TO "routine_id";
ALTER TABLE "routine__executions" RENAME COLUMN "task_version" TO "routine_version";
ALTER TABLE "routine__steps" RENAME COLUMN "task_id" TO "routine_id";
ALTER TABLE "routine__deliverables" RENAME COLUMN "task_id" TO "routine_id";
ALTER TABLE "routine__interventions" RENAME COLUMN "task_id" TO "routine_id";
ALTER TABLE "routine__triggers" RENAME COLUMN "task_id" TO "routine_id";

-- Enums
ALTER TYPE "agent_task__status" RENAME TO "routine__status";
ALTER TYPE "agent_task__schedule_type" RENAME TO "routine__schedule_type";
ALTER TYPE "agent_task__step_status" RENAME TO "routine__step_status";
ALTER TYPE "agent_task__intervention_status" RENAME TO "routine__intervention_status";
ALTER TYPE "agent_task__trigger_type" RENAME TO "routine__trigger_type";
```

Index renames use `ALTER INDEX ... RENAME TO` syntax.

- [ ] **Step 2: Apply migration locally**

```bash
pnpm db:migrate
```

- [ ] **Step 3: Verify with Drizzle Studio**

```bash
pnpm db:studio
```

Confirm all table names, column names, and enum types are correct.

- [ ] **Step 4: Commit**

```bash
git add -A apps/server/libs/database/
git commit -m "refactor(db): add migration for task-to-routine rename"
```

---

### Task 2: Shared Libraries (Events, WS constants, RabbitMQ)

**Goal:** Rename task-related event types, WebSocket event names, and constants in shared libs.

**Files:**

- Rename: `apps/server/libs/shared/src/events/domains/task.events.ts` → `routine.events.ts`
- Modify: `apps/server/libs/shared/src/events/domains/index.ts`
- Modify: `apps/server/libs/shared/src/events/event-names.ts`
- Modify: `apps/server/libs/shared/src/events/index.ts`

**Acceptance Criteria:**

- [ ] `TaskStatusChangedEvent` → `RoutineStatusChangedEvent` with `taskId` → `routineId`
- [ ] `TaskExecutionCreatedEvent` → `RoutineExecutionCreatedEvent` with `taskId` → `routineId`
- [ ] `WS_EVENTS.TASK` → `WS_EVENTS.ROUTINE`
- [ ] Event strings: `'task:status_changed'` → `'routine:status_changed'`, `'task:execution_created'` → `'routine:execution_created'`
- [ ] `ServerToClientEvents` updated with new event names and types
- [ ] RabbitMQ constants (`TASK_COMMANDS`, `TASK_WORKER_COMMANDS`, `TASK_COMMAND`, etc.) — **unchanged**
- [ ] All re-exports updated

**Verify:** `pnpm build:server` → compiles without errors

**Steps:**

- [ ] **Step 1: Rename and update event types file**

Rename `task.events.ts` → `routine.events.ts`. Update content:

```typescript
export interface RoutineStatusChangedEvent {
  routineId: string;
  executionId: string;
  status: string;
  previousStatus: string;
}

export interface RoutineExecutionCreatedEvent {
  routineId: string;
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

- [ ] **Step 2: Update `domains/index.ts`**

```diff
- export * from './task.events.js';
+ export * from './routine.events.js';
```

- [ ] **Step 3: Update `event-names.ts`**

```diff
- TASK: {
-   STATUS_CHANGED: 'task:status_changed',
-   EXECUTION_CREATED: 'task:execution_created',
- },
+ ROUTINE: {
+   STATUS_CHANGED: 'routine:status_changed',
+   EXECUTION_CREATED: 'routine:execution_created',
+ },
```

Also update `WsEventName` type:

```diff
- | (typeof WS_EVENTS.TASK)[keyof typeof WS_EVENTS.TASK]
+ | (typeof WS_EVENTS.ROUTINE)[keyof typeof WS_EVENTS.ROUTINE]
```

- [ ] **Step 4: Update `events/index.ts`**

Update imports:

```diff
- TaskStatusChangedEvent,
- TaskExecutionCreatedEvent,
+ RoutineStatusChangedEvent,
+ RoutineExecutionCreatedEvent,
```

Update `ServerToClientEvents`:

```diff
- 'task:status_changed': TaskStatusChangedEvent;
- 'task:execution_created': TaskExecutionCreatedEvent;
+ 'routine:status_changed': RoutineStatusChangedEvent;
+ 'routine:execution_created': RoutineExecutionCreatedEvent;
```

- [ ] **Step 5: Commit**

```bash
git add -A apps/server/libs/shared/
git commit -m "refactor(shared): rename task events to routine events"
```

---

### Task 3: Backend Gateway Module Rename

**Goal:** Rename the gateway `tasks` module directory, all controllers, services, DTOs, and route paths to `routines`.

**Files:**

- Rename dir: `apps/server/apps/gateway/src/tasks/` → `gateway/src/routines/`
- Rename files:
  - `tasks.module.ts` → `routines.module.ts`
  - `tasks.controller.ts` → `routines.controller.ts`
  - `tasks.service.ts` → `routines.service.ts`
  - `tasks-stream.controller.ts` → `routines-stream.controller.ts`
  - `task-bot.controller.ts` → `routine-bot.controller.ts`
  - `task-bot.service.ts` → `routine-bot.service.ts`
  - `taskcast.service.ts` → keep name (TaskCast is external)
  - `triggers.service.ts` → `routine-triggers.service.ts`
  - DTOs: `create-task.dto.ts` → `create-routine.dto.ts`, `update-task.dto.ts` → `update-routine.dto.ts`, `task-control.dto.ts` → `routine-control.dto.ts`
  - Execution DTOs unchanged: `report-steps.dto.ts`, `create-intervention.dto.ts`, `resolve-intervention.dto.ts`, `update-status.dto.ts`, `add-deliverable.dto.ts`
  - Spec files: rename to match new source names
- Modify: `apps/server/apps/gateway/src/app.module.ts`

**Acceptance Criteria:**

- [ ] Route prefix changed: `@Controller('v1/tasks')` → `@Controller('v1/routines')`
- [ ] Bot route: `@Controller('v1/bot/tasks')` → `@Controller('v1/bot/routines')`
- [ ] All class names: `TasksController` → `RoutinesController`, `TasksService` → `RoutinesService`, `TasksModule` → `RoutinesModule`, `TaskBotController` → `RoutineBotController`, `TaskBotService` → `RoutineBotService`, `TriggersService` → `RoutineTriggersService`, `TasksStreamController` → `RoutinesStreamController`
- [ ] DTO classes: `CreateTaskDto` → `CreateRoutineDto`, `UpdateTaskDto` → `UpdateRoutineDto`, `StartTaskDto` → `StartRoutineDto`, etc.
- [ ] Internal `taskId` params → `routineId` where referring to routine entity
- [ ] All imports updated (schema, shared events)
- [ ] `app.module.ts` import updated
- [ ] TaskCastService class name — **unchanged**

**Verify:** `pnpm build:server` → compiles without errors

**Steps:**

- [ ] **Step 1: Rename directory and files**

```bash
cd apps/server/apps/gateway/src
git mv tasks routines
cd routines
git mv tasks.module.ts routines.module.ts
git mv tasks.controller.ts routines.controller.ts
git mv tasks.service.ts routines.service.ts
git mv tasks-stream.controller.ts routines-stream.controller.ts
git mv task-bot.controller.ts routine-bot.controller.ts
git mv task-bot.service.ts routine-bot.service.ts
git mv triggers.service.ts routine-triggers.service.ts
# Spec files
git mv tasks.controller.spec.ts routines.controller.spec.ts
git mv tasks.service.spec.ts routines.service.spec.ts
git mv tasks-stream.controller.spec.ts routines-stream.controller.spec.ts
git mv task-bot.controller.spec.ts routine-bot.controller.spec.ts
git mv task-bot.service.spec.ts routine-bot.service.spec.ts
git mv triggers.service.spec.ts routine-triggers.service.spec.ts
# DTOs
cd dto
git mv create-task.dto.ts create-routine.dto.ts
git mv update-task.dto.ts update-routine.dto.ts
git mv task-control.dto.ts routine-control.dto.ts
```

- [ ] **Step 2: Update `routines.module.ts`**

- Class: `TasksModule` → `RoutinesModule`
- Controller refs: `TasksController` → `RoutinesController`, `TaskBotController` → `RoutineBotController`, `TasksStreamController` → `RoutinesStreamController`
- Provider refs: `TasksService` → `RoutinesService`, `TaskBotService` → `RoutineBotService`, `TriggersService` → `RoutineTriggersService`
- Exports updated
- All import paths updated to new file names

- [ ] **Step 3: Update `routines.controller.ts`**

- `@Controller('v1/tasks')` → `@Controller('v1/routines')`
- Class: `TasksController` → `RoutinesController`
- Constructor: inject `RoutinesService`, `RoutineTriggersService`
- All method parameter names: `taskId` → `routineId` in `@Param('id')` decorators
- Trigger endpoints: `:taskId` → `:routineId` in param decorators
- All schema type imports updated

- [ ] **Step 4: Update `routines.service.ts`**

- Class: `TasksService` → `RoutinesService`
- All internal `taskId` variables/params → `routineId`
- Schema references: `agentTasks` → `routines`, `agentTaskExecutions` → `routineExecutions`, etc.
- Private method `getTaskOrThrow()` → `getRoutineOrThrow()`
- `publishTaskCommand` name — keep as-is (refers to RabbitMQ task command, execution scope)
- Event types: `TaskStatusChangedEvent` → `RoutineStatusChangedEvent`, etc.
- `WS_EVENTS.TASK` → `WS_EVENTS.ROUTINE`
- Dependency injection: `TriggersService` → `RoutineTriggersService`

- [ ] **Step 5: Update `routine-bot.controller.ts` and `routine-bot.service.ts`**

- Route: `@Controller('v1/bot/tasks')` → `@Controller('v1/bot/routines')`
- Class names: `TaskBotController` → `RoutineBotController`, `TaskBotService` → `RoutineBotService`
- Param `:taskId` → `:routineId`
- Schema references updated

- [ ] **Step 6: Update `routines-stream.controller.ts`**

- Class: `TasksStreamController` → `RoutinesStreamController`
- Route params updated
- Schema/type references updated

- [ ] **Step 7: Update `routine-triggers.service.ts`**

- Class: `TriggersService` → `RoutineTriggersService`
- All `taskId` → `routineId` where referring to routine
- Schema refs updated
- `getTaskOrThrow()` → `getRoutineOrThrow()`

- [ ] **Step 8: Update DTOs**

- `create-routine.dto.ts`: `CreateTaskDto` → `CreateRoutineDto`, `ScheduleConfigDto` stays
- `update-routine.dto.ts`: `UpdateTaskDto` → `UpdateRoutineDto`
- `routine-control.dto.ts`: `StartTaskDto` → `StartRoutineDto`, `ResumeTaskDto` → `ResumeRoutineDto`, `StopTaskDto` → `StopRoutineDto`
- `trigger.dto.ts`: `StartTaskNewDto` → `StartRoutineNewDto`, `RestartTaskDto` → `RestartRoutineDto`
- `dto/index.ts`: update all re-exports and import paths

- [ ] **Step 9: Update `app.module.ts`**

```diff
- import { TasksModule } from './tasks/tasks.module.js';
+ import { RoutinesModule } from './routines/routines.module.js';
```

In imports array: `TasksModule` → `RoutinesModule`

- [ ] **Step 10: Update spec files**

Update all test files to use new class names, import paths, and variable names. Ensure test descriptions reflect "routine" naming.

- [ ] **Step 11: Commit**

```bash
git add -A apps/server/apps/gateway/
git commit -m "refactor(gateway): rename tasks module to routines"
```

---

### Task 4: Task-Worker Internal References

**Goal:** Update `taskId` → `routineId` variable names inside task-worker where they refer to the routine entity. Directory name stays `task-worker`.

**Files:**

- Modify: `apps/server/apps/task-worker/src/consumer/task-command.consumer.ts`
- Modify: `apps/server/apps/task-worker/src/executor/executor.service.ts`
- Modify: `apps/server/apps/task-worker/src/executor/executor.module.ts`
- Modify: `apps/server/apps/task-worker/src/scheduler/scheduler.service.ts`
- Modify: `apps/server/apps/task-worker/src/channel-trigger/channel-trigger.service.ts`
- Modify: `apps/server/apps/task-worker/src/executor/strategies/*.ts`
- Modify: `apps/server/apps/task-worker/src/consumer/task-command.consumer.spec.ts`

**Acceptance Criteria:**

- [ ] `TaskCommand` interface: `taskId` → `routineId`
- [ ] `ExecutorService` methods: `taskId` params → `routineId` where referring to routine
- [ ] `SchedulerService`: schema references updated (`agentTaskTriggers` → `routineTriggers`, etc.)
- [ ] `ChannelTriggerService`: schema references updated
- [ ] Schema imports updated to new names
- [ ] Event type imports updated (`TaskStatusChangedEvent` → `RoutineStatusChangedEvent`, etc.)
- [ ] `WS_EVENTS.TASK` → `WS_EVENTS.ROUTINE` in emit calls
- [ ] Service class names (ExecutorService, SchedulerService, etc.) — **unchanged**
- [ ] RabbitMQ exchange/queue/routing key names — **unchanged**
- [ ] Directory name `task-worker` — **unchanged**

**Verify:** `pnpm build:server` → compiles without errors

**Steps:**

- [ ] **Step 1: Update `task-command.consumer.ts`**

- `TaskCommand` interface: `taskId` → `routineId`
- Handler method references updated
- Import paths for schema types updated

- [ ] **Step 2: Update `executor.service.ts`**

- All `taskId` params/variables → `routineId` (where referring to routine entity)
- Schema references: `agentTasks` → `routines`, `agentTaskExecutions` → `routineExecutions`, etc.
- Event types updated
- `WS_EVENTS.TASK` → `WS_EVENTS.ROUTINE`

- [ ] **Step 3: Update `scheduler.service.ts`**

- Schema references updated (`agentTaskTriggers` → `routineTriggers`, etc.)
- `taskId` → `routineId` in trigger processing

- [ ] **Step 4: Update `channel-trigger.service.ts`**

- Schema references updated
- `taskId` → `routineId` where applicable

- [ ] **Step 5: Update execution strategies**

- Update `taskId` → `routineId` in strategy interfaces and implementations
- Schema type imports updated

- [ ] **Step 6: Update spec files**

- All test files in task-worker updated for new names

- [ ] **Step 7: Commit**

```bash
git add -A apps/server/apps/task-worker/
git commit -m "refactor(task-worker): update internal references for routine rename"
```

---

### Task 5: Frontend Types & API Service

**Goal:** Rename frontend type definitions and API service from task to routine.

**Files:**

- Rename: `apps/client/src/types/task.ts` → `types/routine.ts`
- Rename: `apps/client/src/services/api/tasks.ts` → `services/api/routines.ts`
- Modify: `apps/client/src/services/api/index.ts`
- Rename: `apps/client/src/lib/task-trigger-keys.ts` → `lib/routine-trigger-keys.ts`

**Acceptance Criteria:**

- [ ] All type names renamed: `AgentTask` → `Routine`, `AgentTaskExecution` → `RoutineExecution`, `AgentTaskStatus` → `RoutineStatus`, etc.
- [ ] All DTO types: `CreateTaskDto` → `CreateRoutineDto`, `UpdateTaskDto` → `UpdateRoutineDto`
- [ ] API object: `tasksApi` → `routinesApi`
- [ ] All API paths: `/v1/tasks` → `/v1/routines`
- [ ] `TaskListParams` → `RoutineListParams`
- [ ] Trigger key constants: `TASK_TRIGGER_*` → `ROUTINE_TRIGGER_*`
- [ ] API index re-export updated

**Verify:** `npx tsc --noEmit` in client dir → no type errors (some import errors expected until components updated)

**Steps:**

- [ ] **Step 1: Rename files**

```bash
cd apps/client/src
git mv types/task.ts types/routine.ts
git mv services/api/tasks.ts services/api/routines.ts
git mv lib/task-trigger-keys.ts lib/routine-trigger-keys.ts
```

- [ ] **Step 2: Update `types/routine.ts`**

Rename all exported types:

- `AgentTaskStatus` → `RoutineStatus`
- `AgentTaskScheduleType` → `RoutineScheduleType`
- `AgentTaskStepStatus` → `RoutineStepStatus`
- `AgentTaskInterventionStatus` → `RoutineInterventionStatus`
- `AgentTaskTriggerType` → `RoutineTriggerType`
- `AgentTask` → `Routine`
- `AgentTaskExecution` → `RoutineExecution`
- `AgentTaskExecutionDetail` → `RoutineExecutionDetail`
- `AgentTaskStep` → `RoutineStep`
- `AgentTaskDeliverable` → `RoutineDeliverable`
- `AgentTaskIntervention` → `RoutineIntervention`
- `AgentTaskDetail` → `RoutineDetail`
- `AgentTaskTrigger` → `RoutineTrigger`
- `CreateTaskDto` → `CreateRoutineDto`
- `UpdateTaskDto` → `UpdateRoutineDto`
- `ExecutionEntry`, `StatusChangeData` — keep as-is (execution scope)
- `ResolveInterventionDto`, `RetryExecutionDto` — keep as-is (execution scope)
- Internal field `taskId` in interfaces → `routineId` where referring to routine

- [ ] **Step 3: Update `services/api/routines.ts`**

- `tasksApi` → `routinesApi`
- `TaskListParams` → `RoutineListParams`
- All route paths: `/v1/tasks` → `/v1/routines`
- All type imports: `from '@/types/task'` → `from '@/types/routine'`
- Param names: `taskId` → `routineId`

- [ ] **Step 4: Update `services/api/index.ts`**

```diff
- export { tasksApi } from './tasks.js';
+ export { routinesApi } from './routines.js';
```

(Or similar — update the re-export)

- [ ] **Step 5: Update `lib/routine-trigger-keys.ts`**

- Constants: `TASK_TRIGGER_TYPE_LABEL_KEYS` → `ROUTINE_TRIGGER_TYPE_LABEL_KEYS`, etc.
- i18n key references: `tasks:triggers.*` → `routines:triggers.*` (will match after i18n rename)
- Type guard functions: `isHistoryTriggerType` — keep name (not task-specific)
- Import path in consumers will need updating

- [ ] **Step 6: Commit**

```bash
git add -A apps/client/src/types/ apps/client/src/services/api/ apps/client/src/lib/
git commit -m "refactor(client): rename task types and API service to routine"
```

---

### Task 6: Frontend Components Rename

**Goal:** Rename the `components/tasks/` directory to `components/routines/`, rename component files and their internal names.

**Files:**

- Rename dir: `apps/client/src/components/tasks/` → `components/routines/`
- Rename files per spec:
  - Routine scope: `TaskList.tsx` → `RoutineList.tsx`, `TaskCard.tsx` → `RoutineCard.tsx`, `CreateTaskDialog.tsx` → `CreateRoutineDialog.tsx`, `TaskSettingsTab.tsx` → `RoutineSettingsTab.tsx`, `TaskSettingsDialog.tsx` → `RoutineSettingsDialog.tsx`, `TaskDocumentTab.tsx` → `RoutineDocumentTab.tsx`, `TaskTriggersTab.tsx` → `RoutineTriggersTab.tsx`
  - Execution scope (remove Task prefix): `TaskRunItem.tsx` → `RunItem.tsx`, `TaskRunTab.tsx` → `RunTab.tsx`, `TaskChatArea.tsx` → `ChatArea.tsx`, `TaskChatPlaceholder.tsx` → `ChatPlaceholder.tsx`, `TaskRightPanel.tsx` → `RightPanel.tsx`, `TaskInterventionCard.tsx` → `InterventionCard.tsx`, `TaskDeliverableList.tsx` → `DeliverableList.tsx`, `TaskStepTimeline.tsx` → `StepTimeline.tsx`
  - Unchanged: `ExecutionTimeline.tsx`, `ScheduleConfigForm.tsx`, `AddTriggerDialog.tsx`, `ManualTriggerDialog.tsx`

**Acceptance Criteria:**

- [ ] All component files renamed per spec
- [ ] All component function/export names updated to match file names
- [ ] All internal type imports: `from '@/types/task'` → `from '@/types/routine'`
- [ ] All API imports: `tasksApi` → `routinesApi`
- [ ] All React Query keys: `["tasks"]` → `["routines"]`, `["task", id]` → `["routine", id]`, etc.
- [ ] All i18n references: `t('tasks:...')` → `t('routines:...')`
- [ ] All trigger key imports updated from `routine-trigger-keys`
- [ ] Internal variable names: `task` → `routine`, `tasks` → `routines` where referring to routine entity
- [ ] Props interfaces updated: `task: AgentTask` → `routine: Routine`, etc.
- [ ] Cross-component imports updated

**Verify:** `pnpm dev:client` → no compile errors, UI renders

**Steps:**

- [ ] **Step 1: Rename directory and files**

```bash
cd apps/client/src/components
git mv tasks routines
cd routines
# Routine scope
git mv TaskList.tsx RoutineList.tsx
git mv TaskCard.tsx RoutineCard.tsx
git mv CreateTaskDialog.tsx CreateRoutineDialog.tsx
git mv TaskSettingsTab.tsx RoutineSettingsTab.tsx
git mv TaskSettingsDialog.tsx RoutineSettingsDialog.tsx
git mv TaskDocumentTab.tsx RoutineDocumentTab.tsx
git mv TaskTriggersTab.tsx RoutineTriggersTab.tsx
# Execution scope (remove Task prefix)
git mv TaskRunItem.tsx RunItem.tsx
git mv TaskRunTab.tsx RunTab.tsx
git mv TaskChatArea.tsx ChatArea.tsx
git mv TaskChatPlaceholder.tsx ChatPlaceholder.tsx
git mv TaskRightPanel.tsx RightPanel.tsx
git mv TaskInterventionCard.tsx InterventionCard.tsx
git mv TaskDeliverableList.tsx DeliverableList.tsx
git mv TaskStepTimeline.tsx StepTimeline.tsx
```

- [ ] **Step 2: Update each component file**

For each file, update:

1. Component function name (e.g., `TaskList` → `RoutineList`)
2. Type imports from `@/types/routine`
3. API imports from `@/services/api/routines` (`routinesApi`)
4. i18n namespace: `tasks:` → `routines:`
5. React Query keys
6. Props interfaces
7. Internal variable names (`task` → `routine` where it means routine)
8. Cross-component imports within the directory

Work through files in dependency order: leaf components first (RunItem, InterventionCard, etc.), then containers (RoutineCard, RoutineList).

- [ ] **Step 3: Commit**

```bash
git add -A apps/client/src/components/
git commit -m "refactor(client): rename task components to routine"
```

---

### Task 7: Frontend Route, i18n, Navigation, WebSocket

**Goal:** Update the route path, i18n files, navigation labels, and WebSocket event handlers.

**Files:**

- Rename dir: `apps/client/src/routes/_authenticated/tasks/` → `routes/_authenticated/routines/`
- Rename: `apps/client/src/i18n/locales/en/tasks.json` → `en/routines.json`
- Rename: `apps/client/src/i18n/locales/zh/tasks.json` → `zh/routines.json`
- Modify: `apps/client/src/i18n/index.ts`
- Modify: `apps/client/src/i18n/locales/en/navigation.json`
- Modify: `apps/client/src/i18n/locales/zh/navigation.json`
- Modify: `apps/client/src/hooks/useWebSocketEvents.ts`
- Modify: `apps/client/src/hooks/__tests__/useWebSocketEvents.test.ts`
- Modify: `apps/client/src/types/ws-events.ts`
- Modify: `apps/client/src/services/websocket/index.ts`
- Regenerate: `apps/client/src/routeTree.gen.ts` (auto-generated by TanStack Router)

**Acceptance Criteria:**

- [ ] Route path: `/_authenticated/tasks/` → `/_authenticated/routines/`
- [ ] URL: `/tasks` → `/routines`
- [ ] Route file imports `RoutineList` from `@/components/routines/RoutineList`
- [ ] i18n namespace: `tasks` → `routines` in i18n config
- [ ] UI copy: "Tasks" → "Routines", "任务" → "日常"
- [ ] Navigation key: `"tasks"` → `"routines"` in both en/zh
- [ ] WebSocket handlers: `onTaskStatusChanged` → `onRoutineStatusChanged`, etc.
- [ ] WS event strings: `'task:status_changed'` → `'routine:status_changed'`
- [ ] React Query invalidation keys updated in WS handlers
- [ ] `routeTree.gen.ts` regenerated
- [ ] Run-related i18n copy unchanged

**Verify:** `pnpm dev:client` → app loads, Routines tab navigable, real-time events work

**Steps:**

- [ ] **Step 1: Rename route directory**

```bash
cd apps/client/src/routes/_authenticated
git mv tasks routines
```

- [ ] **Step 2: Update route file**

In `routines/index.tsx`:

- `createFileRoute('/_authenticated/tasks/')` → `createFileRoute('/_authenticated/routines/')`
- Import: `TaskList` → `RoutineList` from `@/components/routines/RoutineList`

- [ ] **Step 3: Regenerate route tree**

```bash
cd apps/client && npx tsr generate
```

This regenerates `routeTree.gen.ts` with the new `/routines` path.

- [ ] **Step 4: Rename and update i18n files**

```bash
cd apps/client/src/i18n/locales
git mv en/tasks.json en/routines.json
git mv zh/tasks.json zh/routines.json
```

In both files, update top-level strings that say "Task"/"任务":

- English: "Create Task" → "Create Routine", "No tasks" → "No routines", etc.
- Chinese: "创建任务" → "创建日常", "暂无任务" → "暂无日常", etc.
- Run-related strings stay unchanged

- [ ] **Step 5: Update i18n config**

In `apps/client/src/i18n/index.ts`:

- Change namespace registration from `tasks` → `routines`
- Update import paths from `./locales/en/tasks.json` → `./locales/en/routines.json`
- Same for zh

- [ ] **Step 6: Update navigation.json**

English:

```diff
- "tasks": "Tasks"
+ "routines": "Routines"
```

Chinese:

```diff
- "tasks": "任务"
+ "routines": "日常"
```

Also update any sidebar/nav component that references the `tasks` navigation key.

- [ ] **Step 7: Update WebSocket handlers**

In `apps/client/src/services/websocket/index.ts`:

- Event listeners: `'task:status_changed'` → `'routine:status_changed'`
- Method names: `onTaskStatusChanged` → `onRoutineStatusChanged`, `onTaskExecutionCreated` → `onRoutineExecutionCreated`

In `apps/client/src/types/ws-events.ts`:

- Update event type imports and event name strings

In `apps/client/src/hooks/useWebSocketEvents.ts`:

- `wsService.onTaskStatusChanged` → `wsService.onRoutineStatusChanged`
- `wsService.onTaskExecutionCreated` → `wsService.onRoutineExecutionCreated`
- Query invalidation keys: `['tasks']` → `['routines']`, `['task', taskId]` → `['routine', routineId]`
- Event type: `TaskStatusChangedEvent` → `RoutineStatusChangedEvent`, etc.

- [ ] **Step 8: Update WS test file**

In `useWebSocketEvents.test.ts`: update event names, handler names, query keys, and type references.

- [ ] **Step 9: Commit**

```bash
git add -A apps/client/
git commit -m "refactor(client): rename route, i18n, nav, and websocket for routine"
```

---

### Task 8: Full Build Verification & Cleanup

**Goal:** Verify the entire project builds, fix any remaining broken imports or references, run tests.

**Files:**

- Any files with stale references found during verification

**Acceptance Criteria:**

- [ ] `pnpm build` succeeds (both server and client)
- [ ] `pnpm dev` starts without errors
- [ ] All existing tests pass
- [ ] No remaining references to old names in active code (grep verification)
- [ ] Routines tab loads in UI
- [ ] WebSocket events fire correctly

**Verify:** `pnpm build && pnpm test` → all pass

**Steps:**

- [ ] **Step 1: Build server**

```bash
pnpm build:server
```

Fix any compilation errors. Common issues: missed import path updates, stale type references.

- [ ] **Step 2: Build client**

```bash
pnpm build:client
```

Fix any compilation errors.

- [ ] **Step 3: Grep for stale references**

```bash
# In active source code (exclude node_modules, dist, .git, generated files)
grep -r "agentTask\|AgentTask\|TasksService\|TasksController\|TasksModule\|tasksApi\|TaskListParams" \
  --include="*.ts" --include="*.tsx" --include="*.json" \
  apps/ \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.turbo \
  | grep -v "routeTree.gen" \
  | grep -v "taskcast\|TaskCast\|task-worker\|TASK_COMMANDS\|TASK_WORKER\|TASK_COMMAND"
```

This should return no results. Fix any found references.

- [ ] **Step 4: Run tests**

```bash
pnpm test
```

Fix any failing tests.

- [ ] **Step 5: Manual smoke test**

```bash
pnpm dev
```

Verify:

1. Navigate to `/routines` — page loads
2. Create a routine — works
3. Start a routine — execution triggers
4. WebSocket events update UI in real-time

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "refactor: complete task-to-routine rename, fix remaining references"
```
