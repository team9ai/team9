# Task System Foundation Fixes — Design Spec

**Date:** 2026-03-19
**Scope:** Fix three structural invariants the Task system currently violates
**Repos:** Team9 (primary), OpenClaw (task-bridge only)

## Problem Statement

A code review identified 9 issues in the Task system. Three are foundational — all other issues compound on top of them:

1. **No single-active-execution guarantee.** Multiple paths (manual start, scheduler, channel trigger, retry) can concurrently call `triggerExecution()` with no mutual exclusion. The worker blindly inserts a new execution and overwrites `currentExecutionId`, orphaning any in-flight execution.

2. **Bot callbacks are task-scoped, not execution-scoped.** OpenClaw's task-bridge calls `PATCH /bot/tasks/:taskId/status` — the gateway resolves the target execution via `task.currentExecutionId`. If a stale run reports back after a new execution has started, its data lands on the wrong execution.

3. **Event schema mismatch.** The task-bridge expects `phase === "invoke"` and checks `data.error`, but the OpenClaw runtime emits `phase: "start"` and `data.isError`. Steps never enter `in_progress`; failed tools are recorded as `completed`.

## Design

### Fix 1: Single-Active-Execution via Worker-Side CAS

#### Gateway Layer (read-only validation only)

In `tasks.service.ts`, the `start()`, `restart()`, and `retry()` methods read the task status, validate via `validateStatusTransition()`, then publish to RabbitMQ.

**Decision:** The Gateway does NOT perform CAS writes. It uses the existing `validateStatusTransition()` read-only check to give users fast feedback on invalid transitions, then publishes to RabbitMQ. The Worker-side CAS (below) is the single atomic guard that prevents concurrent executions.

**Why not Gateway CAS?** An earlier design used dual-layer CAS (Gateway sets `status='in_progress'` before publishing). This caused a self-blocking regression: the Worker CAS excludes `in_progress`, so the Worker would always reject tasks that the Gateway had already marked `in_progress`. Worker-only CAS is sufficient because all execution trigger paths (manual start, scheduler, channel trigger, retry) converge at the Worker's `triggerExecution()`.

Pre-publish checks (unchanged from original code):

- `start()`: verify `task.botId` exists (throw `BadRequestException` if missing), then `validateStatusTransition(status, 'start')` — allowed source: `['upcoming']`
- `restart()`: `validateStatusTransition(status, 'restart')` — allowed source: `['completed', 'failed', 'timeout', 'stopped']`
- `retry()`: verify source execution exists and is in terminal status, then `validateStatusTransition(status, 'retry')` — allowed source: `['completed', 'failed', 'timeout', 'stopped']`

The `validateStatusTransition()` helper is used by all six actions: `start`, `restart`, `retry`, `pause`, `resume`, and `stop`.

#### Worker Layer (the single atomic guard)

In `executor.service.ts`, `triggerExecution()` currently creates channels, TaskCast tasks, and execution records before updating the task status — with no guard at all.

**Change:** CAS-occupy the task as the very first step, before creating any resources:

```typescript
// executor.service.ts — triggerExecution(), new step 1
const [claimed] = await this.db
  .update(schema.agentTasks)
  .set({ status: "in_progress", updatedAt: new Date() })
  .where(
    and(
      eq(schema.agentTasks.id, taskId),
      notInArray(schema.agentTasks.status, [
        "in_progress",
        "paused",
        "pending_action",
      ]),
    ),
  )
  .returning({
    id: schema.agentTasks.id,
    botId: schema.agentTasks.botId,
    tenantId: schema.agentTasks.tenantId,
    documentId: schema.agentTasks.documentId,
    creatorId: schema.agentTasks.creatorId,
    title: schema.agentTasks.title,
    version: schema.agentTasks.version,
  });

if (!claimed) {
  this.logger.warn(`Task ${taskId} already has an active execution, skipping`);
  return;
}

// Use `claimed` fields instead of a separate SELECT — one fewer round trip
// Proceed to create channel, execution, delegate to strategy...
```

After creating the execution record:

```typescript
await this.db
  .update(schema.agentTasks)
  .set({ currentExecutionId: executionId })
  .where(eq(schema.agentTasks.id, taskId));
```

**Resource leak prevention:** Because the CAS runs before any resource creation (channel, TaskCast task, execution record), a failed CAS produces zero side effects.

**Error path:** If resource creation or strategy delegation fails after the CAS succeeds, the existing `markExecutionFailed()` already sets the task status to `failed`, which releases the CAS lock for future retries.

### Fix 2: Execution-Scoped Bot API

#### Team9 Gateway — Route Changes

Replace task-scoped routes in `task-bot.controller.ts` with execution-scoped routes:

| Before                   | After                                                |
| ------------------------ | ---------------------------------------------------- |
| `POST :id/steps`         | `POST :taskId/executions/:executionId/steps`         |
| `PATCH :id/status`       | `PATCH :taskId/executions/:executionId/status`       |
| `POST :id/interventions` | `POST :taskId/executions/:executionId/interventions` |
| `POST :id/deliverables`  | `POST :taskId/executions/:executionId/deliverables`  |
| `GET :id/document`       | `GET :taskId/executions/:executionId/document`       |

Old routes are deleted (no other callers exist).

#### Team9 Gateway — Service Changes

In `task-bot.service.ts`, replace `getActiveExecution(taskId, botUserId)` with `getExecutionDirect(taskId, executionId, botUserId)`:

```typescript
private async getExecutionDirect(
  taskId: string,
  executionId: string,
  botUserId?: string,
) {
  // 1. Direct lookup by executionId + taskId (no currentExecutionId indirection)
  const [execution] = await this.db
    .select()
    .from(schema.agentTaskExecutions)
    .where(
      and(
        eq(schema.agentTaskExecutions.id, executionId),
        eq(schema.agentTaskExecutions.taskId, taskId),
      ),
    )
    .limit(1);

  if (!execution) {
    throw new NotFoundException('Execution not found for this task');
  }

  // 2. Reject writes to terminal executions
  const terminalStatuses = ['completed', 'failed', 'timeout', 'stopped'];
  if (terminalStatuses.includes(execution.status)) {
    throw new ConflictException(
      `Cannot write to execution in terminal status: ${execution.status}`,
    );
  }

  // 3. Load task for bot ownership check
  const [task] = await this.db
    .select()
    .from(schema.agentTasks)
    .where(eq(schema.agentTasks.id, taskId))
    .limit(1);

  if (!task) {
    throw new NotFoundException('Task not found');
  }

  // 4. Verify bot ownership
  if (botUserId && task.botId) {
    const [bot] = await this.db
      .select({ userId: schema.bots.userId })
      .from(schema.bots)
      .where(eq(schema.bots.id, task.botId))
      .limit(1);

    if (!bot || bot.userId !== botUserId) {
      throw new ForbiddenException('Bot does not own this task');
    }
  }

  return { task, execution };
}
```

All public methods (`reportSteps`, `updateStatus`, `createIntervention`, `addDeliverable`) gain an `executionId` parameter and call `getExecutionDirect` instead of `getActiveExecution`.

**Exception: `getTaskDocument`** — This method is read-only and must work for completed executions (the bot may need to read the document after finishing). It uses a separate `getExecutionReadOnly(taskId, executionId, botUserId)` helper that performs the same `(taskId, executionId)` lookup and bot ownership check, but does NOT reject terminal statuses.

#### OpenClaw — task-bridge.ts Changes

Update all API call paths to include `executionId`:

```typescript
// Before:
void callBotApiWithRetry(baseUrl, token, "PATCH", `/${taskId}/status`, { ... });

// After:
void callBotApiWithRetry(baseUrl, token, "PATCH",
  `/${taskId}/executions/${state.executionId}/status`, { ... });
```

Applied to all five call sites in `handleTaskEvent()` (lines 99, 114, 129, 145, and the `callBotApi` base URL construction).

### Fix 3: Event Schema Alignment

Three changes in `task-bridge.ts`, all within `handleTaskEvent()`:

| Line | Current                                  | Fixed                                   | Reason                                             |
| ---- | ---------------------------------------- | --------------------------------------- | -------------------------------------------------- |
| L124 | `phase === "invoke"`                     | `phase === "start"`                     | Runtime emits `"start"`, not `"invoke"`            |
| L125 | `data?.tool \|\| data?.name \|\| "tool"` | `data?.name \|\| "tool"`                | Runtime only emits `name` field                    |
| L143 | `const failed = data?.error != null`     | `const failed = data?.isError === true` | Runtime uses `isError` boolean, not `error` object |

## Files Changed

| Repository | File                                                            | Change Summary                                                                                                                                     |
| ---------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Team9      | `apps/server/apps/gateway/src/tasks/tasks.service.ts`           | Add `retry` to validateStatusTransition allowed map; no CAS (Worker-only CAS)                                                                      |
| Team9      | `apps/server/apps/task-worker/src/executor/executor.service.ts` | CAS at triggerExecution entry; use RETURNING to eliminate extra SELECT                                                                             |
| Team9      | `apps/server/apps/gateway/src/tasks/task-bot.controller.ts`     | Routes become execution-scoped; delete old task-scoped routes                                                                                      |
| Team9      | `apps/server/apps/gateway/src/tasks/task-bot.service.ts`        | Replace getActiveExecution with getExecutionDirect + getExecutionReadOnly; add ConflictException import; all public methods gain executionId param |
| OpenClaw   | `extensions/team9/src/task-bridge.ts`                           | API paths include executionId; phase "invoke"→"start"; error check uses isError                                                                    |

### Documentation to Update (deferred)

These files reference the old `/bot/tasks/:id/...` routes and should be updated separately:

- `docs/design/tasks-module.md`
- `docs/design/tasks-module-zh.md`
- `docs/superpowers/specs/2026-03-17-openclaw-task-execute-design.md`

## Files NOT Changed

- Database schema (no migration needed)
- RabbitMQ topology
- TaskCast integration (taskcast.service.ts, taskcast.client.ts)
- Frontend code
- SSE streaming

## Edge Cases

### Gateway→Worker window (no status gap)

The Gateway does NOT write status — it only validates and publishes to RabbitMQ. The Worker CAS is the first operation that changes status to `in_progress`. This eliminates any status gap between Gateway and Worker.

Between Gateway validation and Worker CAS, a concurrent request could pass Gateway validation for the same task. The Worker CAS guarantees only one succeeds — the loser gets a silent `return` (no error, no side effects).

### Stale OpenClaw run writes after execution terminates

With Fix 2, `getExecutionDirect` rejects writes to terminal executions (409 Conflict). The stale run's remaining callbacks fail harmlessly. The task-bridge uses fire-and-forget (`void callBotApi(...)`) so these rejections don't crash the bridge — they log errors on the Team9 side.

### Scheduler/channel-trigger races

All trigger paths converge at the Worker's `triggerExecution()`. The Worker CAS (`UPDATE WHERE status NOT IN ('in_progress', 'paused', 'pending_action')`) ensures only one execution can start. Concurrent triggers for the same task silently return with no side effects.
