# Task → Routine Rename Design

## Background

The current "Task" tab in Team9 has naming ambiguity: "task" is used for both the top-level reusable entity (a configured automation unit) and the execution instance. Additionally, "Task Channel" uses the same word for a different concept. To resolve this:

- **Routine** = the top-level reusable entity (formerly "Task")
- **Execution / Run** = an instance of a routine being executed (unchanged)
- **Task Channel** = the channel associated with an execution (unchanged, "task" here refers to the execution instance)

Chinese translation: "Routine" = "日常"

## Naming Judgment Principle

Naming is determined by **code substance**, not mechanical replacement:

1. **Routine scope**: top-level entity CRUD, execution lifecycle control (start/pause/stop/restart), settings, documents, triggers
2. **Execution scope**: execution detail viewing, timeline, steps, deliverables, interventions, SSE streaming
3. **Task Channel**: keep "Task" — refers to execution instance communication channel
4. **TaskCast**: keep unchanged — external service integration
5. **task-worker**: directory name unchanged — it is the execution engine

## Database Changes

### Table Renames

| Old Table                   | New Table                |
| --------------------------- | ------------------------ |
| `agent_task__tasks`         | `routine__routines`      |
| `agent_task__executions`    | `routine__executions`    |
| `agent_task__steps`         | `routine__steps`         |
| `agent_task__deliverables`  | `routine__deliverables`  |
| `agent_task__interventions` | `routine__interventions` |
| `agent_task__triggers`      | `routine__triggers`      |

### Column Renames

All `task_id` foreign key columns → `routine_id` in:

- `routine__executions.task_id` → `routine__executions.routine_id`
- `routine__executions.task_version` → `routine__executions.routine_version`
- `routine__steps.task_id` → `routine__steps.routine_id`
- `routine__deliverables.task_id` → `routine__deliverables.routine_id`
- `routine__interventions.task_id` → `routine__interventions.routine_id`
- `routine__triggers.task_id` → `routine__triggers.routine_id`

**Unchanged columns in executions:**

- `taskcast_task_id` — external TaskCast reference, not related to routine rename

### Drizzle Schema Variables

| Old                      | New                    |
| ------------------------ | ---------------------- |
| `agentTasks`             | `routines`             |
| `agentTaskExecutions`    | `routineExecutions`    |
| `agentTaskSteps`         | `routineSteps`         |
| `agentTaskDeliverables`  | `routineDeliverables`  |
| `agentTaskInterventions` | `routineInterventions` |
| `agentTaskTriggers`      | `routineTriggers`      |
| `taskId` (field)         | `routineId`            |
| `taskVersion` (field)    | `routineVersion`       |

### Enum Renames

| Old                               | New                                    |
| --------------------------------- | -------------------------------------- |
| `agentTaskStatusEnum`             | `routineStatusEnum`                    |
| `agentTaskScheduleTypeEnum`       | `routineScheduleTypeEnum` (deprecated) |
| `agentTaskTriggerTypeEnum`        | `routineTriggerTypeEnum`               |
| `agentTaskStepStatusEnum`         | `routineStepStatusEnum`                |
| `agentTaskInterventionStatusEnum` | `routineInterventionStatusEnum`        |

### Index Renames

All indexes follow the pattern: `idx_agent_task__<table>_<col>` → `idx_routine__<table>_<col>` with `task_id` → `routine_id`.

### Schema Directory

`apps/server/libs/database/src/schemas/task/` → `apps/server/libs/database/src/schemas/routine/`

### Migration Strategy

Single migration file using `ALTER TABLE ... RENAME TO`, `ALTER TABLE ... RENAME COLUMN`, and `ALTER TYPE ... RENAME TO`. DDL-only, no data migration needed.

## Backend Changes

### API Routes

| Old                                                             | New                                                  |
| --------------------------------------------------------------- | ---------------------------------------------------- |
| `POST /v1/tasks`                                                | `POST /v1/routines`                                  |
| `GET /v1/tasks`                                                 | `GET /v1/routines`                                   |
| `GET /v1/tasks/:id`                                             | `GET /v1/routines/:id`                               |
| `PATCH /v1/tasks/:id`                                           | `PATCH /v1/routines/:id`                             |
| `DELETE /v1/tasks/:id`                                          | `DELETE /v1/routines/:id`                            |
| `POST /v1/tasks/:id/start\|pause\|resume\|stop\|restart\|retry` | `POST /v1/routines/:id/...`                          |
| `GET /v1/tasks/:id/executions`                                  | `GET /v1/routines/:id/executions`                    |
| `GET /v1/tasks/:id/executions/:execId`                          | `GET /v1/routines/:id/executions/:execId`            |
| `GET /v1/tasks/:id/executions/:execId/entries`                  | `GET /v1/routines/:id/executions/:execId/entries`    |
| `GET /v1/tasks/:id/deliverables`                                | `GET /v1/routines/:id/deliverables`                  |
| `GET /v1/tasks/:id/interventions`                               | `GET /v1/routines/:id/interventions`                 |
| `POST /v1/tasks/:id/interventions/:intId/resolve`               | `POST /v1/routines/:id/interventions/:intId/resolve` |
| `POST /v1/tasks/:id/triggers`                                   | `POST /v1/routines/:id/triggers`                     |
| `GET /v1/tasks/:id/triggers`                                    | `GET /v1/routines/:id/triggers`                      |
| `PATCH /v1/tasks/:id/triggers/:triggerId`                       | `PATCH /v1/routines/:id/triggers/:triggerId`         |
| `DELETE /v1/tasks/:id/triggers/:triggerId`                      | `DELETE /v1/routines/:id/triggers/:triggerId`        |
| `POST /bot/tasks/:taskId/...`                                   | `POST /bot/routines/:routineId/...`                  |
| `GET /tasks/:taskId/executions/:execId/stream`                  | `GET /routines/:routineId/executions/:execId/stream` |

### Gateway Module

Directory: `gateway/src/tasks/` → `gateway/src/routines/`

| Old Class               | New Class                  |
| ----------------------- | -------------------------- |
| `TasksController`       | `RoutinesController`       |
| `TasksService`          | `RoutinesService`          |
| `TasksModule`           | `RoutinesModule`           |
| `TriggersService`       | `RoutineTriggersService`   |
| `TaskBotController`     | `RoutineBotController`     |
| `TasksStreamController` | `RoutinesStreamController` |

### DTOs

**Renamed (routine scope):**

| Old                                     | New                                          |
| --------------------------------------- | -------------------------------------------- |
| `create-task.dto.ts` / `CreateTaskDto`  | `create-routine.dto.ts` / `CreateRoutineDto` |
| `update-task.dto.ts` / `UpdateTaskDto`  | `update-routine.dto.ts` / `UpdateRoutineDto` |
| `task-control.dto.ts` / related classes | `routine-control.dto.ts` / related classes   |

**Unchanged (execution scope):** `report-steps.dto.ts`, `create-intervention.dto.ts`, `resolve-intervention.dto.ts`, `add-deliverable.dto.ts`, `update-status.dto.ts`

### WebSocket Events

| Old                      | New                         |
| ------------------------ | --------------------------- |
| `task:status_changed`    | `routine:status_changed`    |
| `task:execution_created` | `routine:execution_created` |

### RabbitMQ

`TASK_COMMANDS` exchange — **unchanged**. The exchange carries execution control commands; "task" here refers to the execution instance.

### Shared Events File

`apps/server/libs/shared/src/events/domains/task.events.ts` → `routine.events.ts`

### task-worker

- Directory `apps/server/apps/task-worker/` — **unchanged**
- Internal references: `taskId` → `routineId` where referring to the routine entity
- Service class names (ExecutorService, SchedulerService, etc.) — **unchanged**, they are execution engine

## Frontend Changes

### Route

`routes/_authenticated/tasks/index.tsx` → `routes/_authenticated/routines/index.tsx`

URL: `/tasks` → `/routines`

### Component Directory

`components/tasks/` → `components/routines/`

**Routine scope (add Routine prefix):**

| Old                      | New                         |
| ------------------------ | --------------------------- |
| `TaskList.tsx`           | `RoutineList.tsx`           |
| `TaskCard.tsx`           | `RoutineCard.tsx`           |
| `CreateTaskDialog.tsx`   | `CreateRoutineDialog.tsx`   |
| `TaskSettingsTab.tsx`    | `RoutineSettingsTab.tsx`    |
| `TaskSettingsDialog.tsx` | `RoutineSettingsDialog.tsx` |
| `TaskDocumentTab.tsx`    | `RoutineDocumentTab.tsx`    |
| `TaskTriggersTab.tsx`    | `RoutineTriggersTab.tsx`    |

**Execution scope (remove Task prefix):**

| Old                        | New                    |
| -------------------------- | ---------------------- |
| `TaskRunItem.tsx`          | `RunItem.tsx`          |
| `TaskRunTab.tsx`           | `RunTab.tsx`           |
| `TaskChatArea.tsx`         | `ChatArea.tsx`         |
| `TaskChatPlaceholder.tsx`  | `ChatPlaceholder.tsx`  |
| `TaskRightPanel.tsx`       | `RightPanel.tsx`       |
| `TaskInterventionCard.tsx` | `InterventionCard.tsx` |
| `TaskDeliverableList.tsx`  | `DeliverableList.tsx`  |
| `TaskStepTimeline.tsx`     | `StepTimeline.tsx`     |

**Unchanged:** `ExecutionTimeline.tsx`, `ScheduleConfigForm.tsx`, `AddTriggerDialog.tsx`, `ManualTriggerDialog.tsx`

### TypeScript Types

File: `types/task.ts` → `types/routine.ts`

| Old Type                   | New Type                           |
| -------------------------- | ---------------------------------- |
| `AgentTask`                | `Routine`                          |
| `AgentTaskDetail`          | `RoutineDetail`                    |
| `AgentTaskStatus`          | `RoutineStatus`                    |
| `AgentTaskScheduleType`    | `RoutineScheduleType` (deprecated) |
| `AgentTaskExecution`       | `RoutineExecution`                 |
| `AgentTaskExecutionDetail` | `RoutineExecutionDetail`           |
| `AgentTaskStep`            | `RoutineStep`                      |
| `AgentTaskIntervention`    | `RoutineIntervention`              |
| `AgentTaskDeliverable`     | `RoutineDeliverable`               |
| `AgentTaskTrigger`         | `RoutineTrigger`                   |

### API Service

`services/api/tasks.ts` → `services/api/routines.ts`

`tasksApi` → `routinesApi`. Method names (create, list, start, etc.) unchanged.

### i18n

| Old                     | New                        |
| ----------------------- | -------------------------- |
| `locales/en/tasks.json` | `locales/en/routines.json` |
| `locales/zh/tasks.json` | `locales/zh/routines.json` |

Namespace: `tasks:` → `routines:`

UI copy changes:

- "Tasks" → "Routines"
- "任务" → "日常"
- "Create Task" → "Create Routine"
- "创建任务" → "创建日常"
- Run-related copy unchanged

### React Query Keys

| Old                       | New                          |
| ------------------------- | ---------------------------- |
| `["tasks"]`               | `["routines"]`               |
| `["task", id]`            | `["routine", id]`            |
| `["task-executions", id]` | `["routine-executions", id]` |
| `["task-triggers", id]`   | `["routine-triggers", id]`   |

### Lib

`lib/task-trigger-keys.ts` → `lib/routine-trigger-keys.ts`

Constants: `TASK_TRIGGER_*` → `ROUTINE_TRIGGER_*`

### Navigation

`navigation.json`: `"tasks"` key → `"routines"`

## Out of Scope

- **task-worker directory name** — unchanged, it is the execution engine
- **TaskCast integration** — external service, names unchanged
- **Task Channel concept** — "task" refers to execution instance, unchanged
- **Controller/service splitting** — not part of this rename effort
- **Run/Execution rename** — UI "Run" tab copy stays as-is
