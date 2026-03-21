# TaskCast Integration Design Spec

> Date: 2026-03-13
> Status: Draft

## Background

Team9's Task Module lets users assign tasks to AI Bots. Bots execute autonomously and report progress in real-time. Previously, a standalone `task-tracker` microservice (port 3002) existed for generic task tracking but was never integrated. It has been removed.

TaskCast is our own open-source SSE + task management library. A Rust instance (`mwr1998/taskcast-rs`) is now deployed on Railway dev:

- **Internal:** `http://taskcast.railway.internal:3721`
- **Public (test):** `https://team9-taskcast-development.up.railway.app`
- **Storage:** Shared Redis (broadcast + short-term) + Dedicated Postgres (long-term)
- **Auth:** `none` (internal network only)

## Goals

1. Replace TODO stubs in `TaskCastService` with real `@taskcast/server-sdk` calls
2. Create a real TaskCast task per execution (not UUID placeholder)
3. Publish step/intervention/deliverable events to TaskCast during execution
4. Add Gateway SSE proxy endpoint for frontend consumption
5. Replace 5s polling in frontend with TaskCast SSE via custom hook + `@taskcast/client`

## Non-Goals

- TaskCast auth (internal network, no auth needed for now)
- Custom state machine configuration (TaskCast already supports `paused`/`blocked` natively)
- Removing WebSocket events (keep `task:status_changed` and `task:execution_created` for task list notifications)
- Implementing `task:execution_created` WebSocket emission (tracked separately)

---

## Design Principles

- **DB is source of truth.** TaskCast is a best-effort real-time view. If TaskCast events are lost, the 5s polling fallback ensures frontend eventually converges.
- **Fire-and-forget publishing.** All TaskCast calls are wrapped with internal error handling in `TaskCastService`. Callers never need try/catch. TaskCast failures never block execution flow.
- **Graceful degradation.** If `taskcastTaskId` is null (legacy executions or TaskCast creation failure), frontend falls back to 5s polling.

---

## Architecture

```
Frontend (React)
├── REST API ──────────────── Gateway (CRUD, control)
├── Socket.io ─────────────── Gateway (task list notifications)
└── SSE ───────────────────── Gateway /api/v1/tasks/:taskId/executions/:execId/stream
                                 │ (proxy)
                                 ▼
                              TaskCast (taskcast.railway.internal:3721)
                                 │
                              Redis (broadcast + short-term)
                              Postgres (long-term archive)

task-worker
├── Creates TaskCast task via @taskcast/server-sdk
└── Bot reports progress → TaskBotService → publishes events to TaskCast
```

### Responsibility Separation

| Channel          | Purpose                                                                          | Scope                    |
| ---------------- | -------------------------------------------------------------------------------- | ------------------------ |
| **REST**         | Task CRUD, execution control, intervention resolution                            | Request-response         |
| **Socket.io**    | Task list status notifications (`task:status_changed`, `task:execution_created`) | Workspace-wide broadcast |
| **TaskCast SSE** | Real-time execution progress (steps, interventions, deliverables)                | Per-execution stream     |

---

## Backend Design

### 1. Install `@taskcast/server-sdk`

`@taskcast/server-sdk` is published on npm. Add to both gateway and task-worker:

```bash
pnpm --filter @team9/gateway add @taskcast/server-sdk
pnpm --filter @team9/task-worker add @taskcast/server-sdk
```

### 2. TaskCastService (Gateway)

**File:** `apps/server/apps/gateway/src/tasks/taskcast.service.ts`

Replace TODO stubs with `TaskcastServerClient`. All methods catch errors internally so callers never need try/catch:

```typescript
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TaskcastServerClient } from "@taskcast/server-sdk";
import type { TaskStatus } from "@taskcast/core";

const STATUS_MAP: Record<string, TaskStatus> = {
  in_progress: "running",
  paused: "paused",
  pending_action: "blocked",
  completed: "completed",
  failed: "failed",
  timeout: "timeout",
  stopped: "cancelled",
};

@Injectable()
export class TaskCastService {
  private readonly logger = new Logger(TaskCastService.name);
  private readonly client: TaskcastServerClient;

  constructor(config: ConfigService) {
    this.client = new TaskcastServerClient({
      baseUrl: config.get<string>("TASKCAST_URL", "http://localhost:3721"),
    });
  }

  async createTask(params: {
    taskId: string;
    executionId: string;
    botId: string;
    tenantId: string;
    ttl?: number;
  }): Promise<string | null> {
    try {
      const task = await this.client.createTask({
        type: `agent_task.${params.taskId}`,
        ttl: params.ttl ?? 86400,
        metadata: {
          taskId: params.taskId,
          executionId: params.executionId,
          botId: params.botId,
          tenantId: params.tenantId,
        },
      });
      return task.id;
    } catch (error) {
      this.logger.error(`Failed to create TaskCast task: ${error}`);
      return null;
    }
  }

  async transitionStatus(
    taskcastTaskId: string,
    status: string,
  ): Promise<void> {
    const mapped = STATUS_MAP[status];
    if (!mapped) {
      this.logger.warn(`No TaskCast mapping for status: ${status}`);
      return;
    }
    try {
      await this.client.transitionTask(taskcastTaskId, mapped);
    } catch (error) {
      this.logger.error(`Failed to transition TaskCast status: ${error}`);
    }
  }

  async publishEvent(
    taskcastTaskId: string,
    event: {
      type: string;
      data: Record<string, unknown>;
      seriesId?: string;
      seriesMode?: "accumulate" | "latest" | "keep-all";
    },
  ): Promise<void> {
    try {
      await this.client.publishEvent(taskcastTaskId, {
        type: event.type,
        level: "info",
        data: event.data,
        seriesId: event.seriesId,
        seriesMode: event.seriesMode,
      });
    } catch (error) {
      this.logger.error(`Failed to publish TaskCast event: ${error}`);
    }
  }

  /** No-op — TaskCast cleanup rules handle expiration via TTL. */
  async deleteTask(_taskcastTaskId: string): Promise<void> {}
}
```

**Note:** Method is renamed from `updateStatus` → `transitionStatus` to better reflect the TaskCast API. All callsites must be updated (currently none exist since all were TODOs).

### 3. Status Mapping

| Team9 Status     | TaskCast Status | Notes                   |
| ---------------- | --------------- | ----------------------- |
| `in_progress`    | `running`       |                         |
| `paused`         | `paused`        | User-initiated pause    |
| `pending_action` | `blocked`       | Awaiting intervention   |
| `completed`      | `completed`     | Terminal                |
| `failed`         | `failed`        | Terminal                |
| `timeout`        | `timeout`       | Terminal                |
| `stopped`        | `cancelled`     | Terminal                |
| `upcoming`       | —               | No execution exists yet |

Non-terminal status transitions (`paused`, `pending_action`, `in_progress`) are driven by `TasksService` control actions (pause/resume/stop), not by `TaskBotService`. The bot API (`TaskBotService.updateStatus()`) only allows terminal statuses (`completed`/`failed`/`timeout`).

### 4. TaskCast Client in task-worker

Since `TaskCastService` lives in gateway and task-worker is a separate process, create a standalone client in task-worker:

**New file:** `apps/server/apps/task-worker/src/taskcast/taskcast.client.ts`

```typescript
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TaskcastServerClient } from "@taskcast/server-sdk";

@Injectable()
export class TaskCastClient {
  private readonly logger = new Logger(TaskCastClient.name);
  private readonly client: TaskcastServerClient;

  constructor(config: ConfigService) {
    this.client = new TaskcastServerClient({
      baseUrl: config.get<string>("TASKCAST_URL", "http://localhost:3721"),
    });
  }

  async createTask(params: {
    taskId: string;
    executionId: string;
    botId: string;
    tenantId: string;
    ttl?: number;
  }): Promise<string | null> {
    try {
      const task = await this.client.createTask({
        type: `agent_task.${params.taskId}`,
        ttl: params.ttl ?? 86400,
        metadata: {
          taskId: params.taskId,
          executionId: params.executionId,
          botId: params.botId,
          tenantId: params.tenantId,
        },
      });
      return task.id;
    } catch (error) {
      this.logger.error(`Failed to create TaskCast task: ${error}`);
      return null;
    }
  }
}
```

**New file:** `apps/server/apps/task-worker/src/taskcast/taskcast.module.ts`

```typescript
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TaskCastClient } from "./taskcast.client.js";

@Module({
  imports: [ConfigModule],
  providers: [TaskCastClient],
  exports: [TaskCastClient],
})
export class TaskCastModule {}
```

**Update:** `apps/server/apps/task-worker/src/executor/executor.module.ts` — add `TaskCastModule` to imports.

**Update:** `apps/server/apps/task-worker/src/executor/executor.service.ts` — inject `TaskCastClient`:

```diff
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
+   private readonly taskCastClient: TaskCastClient,
  ) {}
```

In `triggerExecution()`, replace the UUID placeholder:

```diff
- const taskcastTaskId = uuidv7(); // Placeholder
+ const taskcastTaskId = await this.taskCastClient.createTask({
+   taskId,
+   executionId,
+   botId: task.botId,
+   tenantId: task.tenantId,
+   ttl: 86400,
+ });
```

If `createTask` returns `null` (TaskCast failure), the execution proceeds without TaskCast tracking. `taskcastTaskId` will be null in the DB and frontend falls back to polling.

### 5. TaskBotService Integration (Gateway)

**File:** `apps/server/apps/gateway/src/tasks/task-bot.service.ts`

**Constructor change:**

```diff
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: ...,
    @Inject(WEBSOCKET_GATEWAY) private readonly wsGateway: ...,
+   private readonly taskCastService: TaskCastService,
  ) {}
```

`TaskCastService` is already registered as a provider in `TasksModule` (`tasks.module.ts`), so DI will resolve it.

Publish events after each DB write:

**`reportSteps()`** — after returning `steps`:

```typescript
if (execution.taskcastTaskId) {
  await this.taskCastService.publishEvent(execution.taskcastTaskId, {
    type: "step",
    data: { steps },
    seriesId: "steps",
    seriesMode: "latest",
  });
}
```

**`updateStatus()`** — after DB write (terminal statuses only):

```typescript
if (execution.taskcastTaskId) {
  await this.taskCastService.transitionStatus(execution.taskcastTaskId, status);
}
```

**`createIntervention()`** — after DB write:

```typescript
if (execution.taskcastTaskId) {
  await this.taskCastService.transitionStatus(
    execution.taskcastTaskId,
    "pending_action",
  );
  await this.taskCastService.publishEvent(execution.taskcastTaskId, {
    type: "intervention",
    data: { intervention },
    seriesId: `intervention:${intervention.id}`,
    seriesMode: "latest",
  });
}
```

**`addDeliverable()`** — after DB write:

```typescript
if (execution.taskcastTaskId) {
  await this.taskCastService.publishEvent(execution.taskcastTaskId, {
    type: "deliverable",
    data: { deliverable },
  });
}
```

### 6. TasksService Integration (Gateway)

**File:** `apps/server/apps/gateway/src/tasks/tasks.service.ts`

**Constructor change:** Add `TaskCastService` injection.

**Control action handlers** (pause/resume/stop) — sync status to TaskCast:

```typescript
// In pause handler:
if (execution.taskcastTaskId) {
  await this.taskCastService.transitionStatus(
    execution.taskcastTaskId,
    "paused",
  );
}

// In resume handler:
if (execution.taskcastTaskId) {
  await this.taskCastService.transitionStatus(
    execution.taskcastTaskId,
    "in_progress",
  );
}

// In stop handler:
if (execution.taskcastTaskId) {
  await this.taskCastService.transitionStatus(
    execution.taskcastTaskId,
    "stopped",
  );
}

// In resolveIntervention:
if (execution.taskcastTaskId) {
  await this.taskCastService.transitionStatus(
    execution.taskcastTaskId,
    "in_progress",
  );
}
```

### 7. Gateway SSE Proxy Endpoint

**New file:** `apps/server/apps/gateway/src/tasks/tasks-stream.controller.ts`

```
GET /api/v1/tasks/:taskId/executions/:execId/stream
```

- Authenticated via `JwtAuthGuard`
- Looks up execution to get `taskcastTaskId`
- Verifies user is a member of the task's workspace
- Forwards `Last-Event-ID` request header for SSE resumability
- Uses raw `Response` object with `Content-Type: text/event-stream` to pipe upstream TaskCast SSE
- On client disconnect, aborts the upstream fetch to clean up

**Implementation approach:** Use `fetch()` to open SSE connection to `${TASKCAST_URL}/tasks/${taskcastTaskId}/events/stream`, then pipe the response body through to the client response. NestJS `@Sse()` decorator is not suitable here since we need raw stream proxying, not RxJS Observable-based SSE.

**Register** in `TasksModule` as a controller.

### 8. WebhookController Update (task-worker)

**File:** `apps/server/apps/task-worker/src/webhook/webhook.controller.ts`

TaskCast sends its own task ID in the webhook payload, not Team9's task ID. Update lookup:

```diff
- const [task] = await this.db.select().from(schema.agentTasks)
-   .where(eq(schema.agentTasks.id, taskId));
+ const { taskId: taskcastId } = payload;
+ const [execution] = await this.db.select().from(schema.agentTaskExecutions)
+   .where(eq(schema.agentTaskExecutions.taskcastTaskId, taskcastId));
+ if (!execution) {
+   this.logger.error(`Execution not found for TaskCast task: ${taskcastId}`);
+   return;
+ }
+ const [task] = await this.db.select().from(schema.agentTasks)
+   .where(eq(schema.agentTasks.id, execution.taskId));
```

### 9. Legacy `taskcastTaskId` Cleanup

Existing executions may have UUID placeholder values (format `tc_${executionId}` or raw UUIDs) as `taskcastTaskId`. These are not real TaskCast task IDs and would cause API errors.

**Solution:** The `if (execution.taskcastTaskId)` guard already protects against `null`. For non-null placeholder values, the TaskCast API call will fail, but since all calls are wrapped with internal error handling, this is safe — it will log a warning and the frontend falls back to polling. No migration needed. New executions will have real TaskCast IDs (ULID format `01KK...`), which are easily distinguishable from UUIDs.

---

## Frontend Design

### 1. Install Package

```bash
pnpm --filter @team9/client add @taskcast/client
```

We use `@taskcast/client` directly (not `@taskcast/react`) because our SSE goes through a gateway proxy with a custom URL structure that doesn't match `useTaskEvents`'s expected format.

### 2. Custom SSE Hook

**New file:** `apps/client/src/hooks/useExecutionStream.ts`

```typescript
import { useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

function useExecutionStream(
  taskId: string,
  execId: string,
  taskcastTaskId: string | null,
  enabled: boolean,
) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled || !taskcastTaskId) return;

    const url = `${API_BASE_URL}/api/v1/tasks/${taskId}/executions/${execId}/stream`;
    const eventSource = new EventSource(url, { withCredentials: true });
    // Or pass JWT via URL param if EventSource doesn't support headers

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      // Invalidate relevant query cache based on event type
      if (
        data.type === "step" ||
        data.type === "intervention" ||
        data.type === "deliverable"
      ) {
        queryClient.invalidateQueries({
          queryKey: ["task-execution-entries", taskId, execId],
        });
      }
    };

    eventSource.onerror = () => {
      // EventSource auto-reconnects; no action needed
    };

    return () => eventSource.close();
  }, [taskId, execId, taskcastTaskId, enabled, queryClient]);
}
```

**Auth consideration:** `EventSource` does not support custom headers. Options:

- Pass JWT as query param: `?token=${jwt}` (proxy endpoint accepts both header and query)
- Use cookie-based auth if available
- Use `fetch()` with `ReadableStream` instead of `EventSource` for header support

### 3. React Query Cache Integration

On receiving SSE events, invalidate relevant queries rather than manually updating cache (simpler, avoids data transformation):

| SSE Event Type       | Cache Invalidation                                                                      |
| -------------------- | --------------------------------------------------------------------------------------- |
| `step`               | `invalidateQueries(['task-execution-entries', taskId, execId])`                         |
| `intervention`       | `invalidateQueries(['task-execution-entries', taskId, execId])`                         |
| `deliverable`        | `invalidateQueries(['task-execution-entries', taskId, execId])`                         |
| SSE close (terminal) | `invalidateQueries(['task', taskId])`, `invalidateQueries(['task-executions', taskId])` |

This triggers a refetch of the full entries list from the REST API, which returns properly formatted `ExecutionEntry[]` objects. No SSE-to-ExecutionEntry transformation needed.

### 4. Remove Polling

| Component              | Current                                        | After Integration                                                                 |
| ---------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------- |
| `TaskDetailPanel.tsx`  | `refetchInterval: 5000` on `["task", taskId]`  | Keep interval only when no active SSE                                             |
| `TaskBasicInfoTab.tsx` | `refetchInterval: 5000` on entries             | SSE invalidation replaces polling; disable interval when `taskcastTaskId` present |
| `TaskRunsTab.tsx`      | `refetchInterval: 5000` on executions          | WebSocket `task:execution_created` + SSE terminal event invalidates               |
| `RunDetailView.tsx`    | `refetchInterval: 5000` on execution + entries | SSE invalidation replaces polling                                                 |

**Fallback:** If `taskcastTaskId` is null (legacy executions or TaskCast failure), keep 5s polling.

---

## Event Schema

Events published to TaskCast:

### `step` (series: `steps`, mode: `latest`)

```json
{
  "type": "step",
  "level": "info",
  "seriesId": "steps",
  "seriesMode": "latest",
  "data": {
    "steps": [
      {
        "orderIndex": 0,
        "title": "Analyzing requirements",
        "status": "completed",
        "duration": 12
      },
      { "orderIndex": 1, "title": "Writing code", "status": "in_progress" }
    ]
  }
}
```

### `intervention` (series: `intervention:{id}`, mode: `latest`)

```json
{
  "type": "intervention",
  "level": "warn",
  "seriesId": "intervention:abc123",
  "seriesMode": "latest",
  "data": {
    "intervention": {
      "id": "abc123",
      "prompt": "Which database should I use?",
      "actions": ["PostgreSQL", "MySQL", "SQLite"],
      "status": "pending"
    }
  }
}
```

### `deliverable`

```json
{
  "type": "deliverable",
  "level": "info",
  "data": {
    "deliverable": {
      "id": "def456",
      "fileName": "report.pdf",
      "fileSize": 102400,
      "mimeType": "application/pdf",
      "fileUrl": "https://..."
    }
  }
}
```

---

## TTL & Task Lifecycle

- Default TTL: 86400 seconds (24 hours)
- TaskCast automatically transitions to `timeout` when TTL expires
- TaskCast sends timeout webhook → `WebhookController` marks execution + task as `timeout`
- For tasks expected to run >24h, the TTL can be configured per-task at creation time
- When a Team9 task is deleted while an execution is running, `TasksService` should transition the TaskCast task to `cancelled` before deleting

---

## Deployment & Configuration

### Environment Variables

Already configured on Railway dev:

| Service     | Variable                | Value                                                              |
| ----------- | ----------------------- | ------------------------------------------------------------------ |
| TaskCast    | `TASKCAST_PORT`         | `3721`                                                             |
| TaskCast    | `TASKCAST_STORAGE`      | `redis`                                                            |
| TaskCast    | `TASKCAST_REDIS_URL`    | `redis://:***@redis.railway.internal:6379`                         |
| TaskCast    | `TASKCAST_POSTGRES_URL` | `postgresql://***@postgres-taskcast.railway.internal:5432/railway` |
| TaskCast    | `TASKCAST_AUTH_MODE`    | `none`                                                             |
| API-Gateway | `TASKCAST_URL`          | `http://taskcast.railway.internal:3721`                            |
| Task-worker | `TASKCAST_URL`          | `http://taskcast.railway.internal:3721`                            |

### Cleanup

- Remove old `TaskcastPostgres` empty service from Railway
- Remove old `Task-tracker` service from Railway
