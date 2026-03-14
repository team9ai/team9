# TaskCast Integration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace TODO stubs in TaskCastService with real `@taskcast/server-sdk` calls, publish events during execution, add SSE proxy, and replace frontend polling with SSE.

**Architecture:** Gateway and task-worker both use `@taskcast/server-sdk` to communicate with a deployed TaskCast Rust instance over internal network. Gateway proxies SSE streams to the frontend. Frontend receives SSE events and invalidates React Query caches instead of 5s polling.

**Tech Stack:** NestJS, `@taskcast/server-sdk`, `@taskcast/client`, React, TanStack React Query, SSE (EventSource)

---

## Chunk 1: Backend — SDK Installation + TaskCastService Rewrite + Task-Worker Client

### Task 1: Install `@taskcast/server-sdk` in gateway and task-worker

**Files:**

- Modify: `apps/server/apps/gateway/package.json`
- Modify: `apps/server/apps/task-worker/package.json`

- [ ] **Step 1: Install SDK in gateway**

```bash
cd /Users/winrey/Projects/weightwave/team9
pnpm --filter @team9/gateway add @taskcast/server-sdk
```

Note: `@taskcast/core` is a dependency of `@taskcast/server-sdk` and will be installed automatically.

- [ ] **Step 2: Install SDK in task-worker**

```bash
cd /Users/winrey/Projects/weightwave/team9
pnpm --filter @team9/task-worker add @taskcast/server-sdk
```

- [ ] **Step 3: Verify installation**

```bash
cd /Users/winrey/Projects/weightwave/team9
cat apps/server/apps/gateway/package.json | grep taskcast
cat apps/server/apps/task-worker/package.json | grep taskcast
```

Expected: Both show `"@taskcast/server-sdk"` in dependencies.

- [ ] **Step 4: Commit**

```bash
git add apps/server/apps/gateway/package.json apps/server/apps/task-worker/package.json pnpm-lock.yaml
git commit -m "chore: add @taskcast/server-sdk to gateway and task-worker"
```

---

### Task 2: Rewrite TaskCastService (Gateway)

**Files:**

- Modify: `apps/server/apps/gateway/src/tasks/taskcast.service.ts`

Current file is 56 lines with TODO stubs. Replace entirely with real `TaskcastServerClient` wrapper. All methods catch errors internally — callers never need try/catch.

- [ ] **Step 1: Rewrite taskcast.service.ts**

Replace the entire contents of `apps/server/apps/gateway/src/tasks/taskcast.service.ts` with:

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

- [ ] **Step 2: Verify compilation**

```bash
cd /Users/winrey/Projects/weightwave/team9
pnpm --filter @team9/gateway build
```

Expected: BUILD SUCCESS with no type errors.

- [ ] **Step 3: Commit**

```bash
git add apps/server/apps/gateway/src/tasks/taskcast.service.ts
git commit -m "feat(tasks): replace TaskCastService TODO stubs with real @taskcast/server-sdk calls"
```

---

### Task 3: Create TaskCast client module in task-worker

**Files:**

- Create: `apps/server/apps/task-worker/src/taskcast/taskcast.client.ts`
- Create: `apps/server/apps/task-worker/src/taskcast/taskcast.module.ts`
- Modify: `apps/server/apps/task-worker/src/executor/executor.module.ts`
- Modify: `apps/server/apps/task-worker/src/executor/executor.service.ts`
- Modify: `apps/server/apps/task-worker/src/executor/execution-strategy.interface.ts`

- [ ] **Step 1: Create taskcast.client.ts**

Create `apps/server/apps/task-worker/src/taskcast/taskcast.client.ts`:

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

- [ ] **Step 2: Create taskcast.module.ts**

Create `apps/server/apps/task-worker/src/taskcast/taskcast.module.ts`:

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

- [ ] **Step 3: Update executor.module.ts to import TaskCastModule**

In `apps/server/apps/task-worker/src/executor/executor.module.ts`, add `TaskCastModule` to imports:

```typescript
import { Module, OnModuleInit } from "@nestjs/common";
import { DatabaseModule } from "@team9/database";
import { ExecutorService } from "./executor.service.js";
import { OpenclawStrategy } from "./strategies/openclaw.strategy.js";
import { TaskCastModule } from "../taskcast/taskcast.module.js";

@Module({
  imports: [DatabaseModule, TaskCastModule],
  providers: [ExecutorService, OpenclawStrategy],
  exports: [ExecutorService],
})
export class ExecutorModule implements OnModuleInit {
  constructor(
    private readonly executorService: ExecutorService,
    private readonly openclawStrategy: OpenclawStrategy,
  ) {}

  onModuleInit() {
    this.executorService.registerStrategy("system", this.openclawStrategy);
  }
}
```

- [ ] **Step 4: Update ExecutionContext interface to allow null taskcastTaskId**

In `apps/server/apps/task-worker/src/executor/execution-strategy.interface.ts`, change `taskcastTaskId` to allow null:

```typescript
export interface ExecutionContext {
  taskId: string;
  executionId: string;
  botId: string;
  channelId: string;
  documentContent?: string;
  taskcastTaskId: string | null;
}

export interface ExecutionStrategy {
  execute(context: ExecutionContext): Promise<void>;
  pause(context: ExecutionContext): Promise<void>;
  resume(context: ExecutionContext): Promise<void>;
  stop(context: ExecutionContext): Promise<void>;
}
```

- [ ] **Step 5: Update executor.service.ts to inject TaskCastClient and create real TaskCast tasks**

In `apps/server/apps/task-worker/src/executor/executor.service.ts`:

1. Add import at top (after existing imports):

```typescript
import { TaskCastClient } from "../taskcast/taskcast.client.js";
```

2. Update constructor (lines 22-25):

```typescript
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly taskCastClient: TaskCastClient,
  ) {}
```

3. Replace line 133 (`const taskcastTaskId = uuidv7();`) with:

```typescript
const taskcastTaskId = await this.taskCastClient.createTask({
  taskId,
  executionId,
  botId: task.botId,
  tenantId: task.tenantId,
  ttl: 86400,
});
```

4. Remove the `import { v7 as uuidv7 } from 'uuid';` line (line 2) ONLY IF `uuidv7` is no longer used elsewhere in the file. Check: `uuidv7` is still used at lines 88, 98-99, 132, 178-179 — so keep it. Only the line 133 reference changes; `executionId` at line 132 still uses `uuidv7()`.

- [ ] **Step 6: Verify compilation**

```bash
cd /Users/winrey/Projects/weightwave/team9
pnpm --filter @team9/task-worker build
```

Expected: BUILD SUCCESS.

- [ ] **Step 7: Commit**

```bash
git add apps/server/apps/task-worker/src/taskcast/ apps/server/apps/task-worker/src/executor/
git commit -m "feat(task-worker): create TaskCast client and replace UUID placeholder with real task creation"
```

---

## Chunk 2: Backend — TaskBotService + TasksService Integration

### Task 4: Integrate TaskCastService into TaskBotService

**Files:**

- Modify: `apps/server/apps/gateway/src/tasks/task-bot.service.ts`

`TaskCastService` is already a provider in `TasksModule` (see `tasks.module.ts` line 15), so NestJS DI resolves it automatically.

- [ ] **Step 1: Add TaskCastService to constructor**

In `apps/server/apps/gateway/src/tasks/task-bot.service.ts`:

1. Add import after line 22:

```typescript
import { TaskCastService } from "./taskcast.service.js";
```

2. Update constructor (lines 28-33) to inject TaskCastService:

```typescript
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    @Inject(WEBSOCKET_GATEWAY)
    private readonly wsGateway: WebsocketGateway,
    private readonly taskCastService: TaskCastService,
  ) {}
```

- [ ] **Step 2: Add TaskCast event publishing to reportSteps()**

After `return steps;` at line 119, but BEFORE the return statement, add TaskCast event publishing. Replace the end of `reportSteps()` (lines 112-120):

```typescript
// Return updated steps
const steps = await this.db
  .select()
  .from(schema.agentTaskSteps)
  .where(eq(schema.agentTaskSteps.executionId, execution.id))
  .orderBy(schema.agentTaskSteps.orderIndex);

// Publish step progress to TaskCast
if (execution.taskcastTaskId) {
  await this.taskCastService.publishEvent(execution.taskcastTaskId, {
    type: "step",
    data: { steps },
    seriesId: "steps",
    seriesMode: "latest",
  });
}

return steps;
```

- [ ] **Step 3: Add TaskCast status transition to updateStatus()**

After the WebSocket broadcast (after line 186), add TaskCast transition:

```typescript
// Sync terminal status to TaskCast
if (execution.taskcastTaskId) {
  await this.taskCastService.transitionStatus(execution.taskcastTaskId, status);
}
```

- [ ] **Step 4: Add TaskCast transition + event to createIntervention()**

After the WebSocket broadcast (after line 236), add TaskCast calls:

```typescript
// Sync blocked status + intervention event to TaskCast
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

- [ ] **Step 5: Add TaskCast event to addDeliverable()**

After `return deliverable;` at line 270, but BEFORE the return, add:

```typescript
// Publish deliverable event to TaskCast
if (execution.taskcastTaskId) {
  await this.taskCastService.publishEvent(execution.taskcastTaskId, {
    type: "deliverable",
    data: { deliverable },
  });
}

return deliverable;
```

(Remove the original `return deliverable;` — it's now at the end of the block above.)

- [ ] **Step 6: Verify compilation**

```bash
cd /Users/winrey/Projects/weightwave/team9
pnpm --filter @team9/gateway build
```

Expected: BUILD SUCCESS.

- [ ] **Step 7: Commit**

```bash
git add apps/server/apps/gateway/src/tasks/task-bot.service.ts
git commit -m "feat(tasks): integrate TaskCastService into TaskBotService for event publishing"
```

---

### Task 5: Integrate TaskCastService into TasksService

**Files:**

- Modify: `apps/server/apps/gateway/src/tasks/tasks.service.ts`

The control actions (pause/resume/stop/resolveIntervention) publish commands via RabbitMQ but don't directly sync to TaskCast. We need to add TaskCast status transitions. Since these methods only publish RabbitMQ commands and don't directly update DB status (that's done by the worker), we need to fetch the current execution's `taskcastTaskId` first.

- [ ] **Step 1: Add TaskCastService import and constructor injection**

In `apps/server/apps/gateway/src/tasks/tasks.service.ts`:

1. Add import (after line 30):

```typescript
import { TaskCastService } from "./taskcast.service.js";
```

2. Update constructor (lines 54-60):

```typescript
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly documentsService: DocumentsService,
    private readonly amqpConnection: AmqpConnection,
    private readonly triggersService: TriggersService,
    private readonly taskCastService: TaskCastService,
  ) {}
```

- [ ] **Step 2: Add helper to get taskcastTaskId from a known executionId**

Add this private helper method near the other private helpers (after `getTaskOrThrow`, around line 660):

```typescript
  private async getTaskcastTaskId(
    currentExecutionId: string | null,
  ): Promise<string | null> {
    if (!currentExecutionId) return null;

    const [execution] = await this.db
      .select({ taskcastTaskId: schema.agentTaskExecutions.taskcastTaskId })
      .from(schema.agentTaskExecutions)
      .where(eq(schema.agentTaskExecutions.id, currentExecutionId))
      .limit(1);

    return execution?.taskcastTaskId ?? null;
  }
```

This accepts the `currentExecutionId` from the already-loaded task (via `getTaskOrThrow`), avoiding a redundant task query.

- [ ] **Step 3: Add TaskCast transition to pause()**

In the `pause()` method (lines 441-452), add after `publishTaskCommand` and before `return`. Note `task` is already loaded by `getTaskOrThrow` earlier in this method:

```typescript
// Sync paused status to TaskCast
const tcId = await this.getTaskcastTaskId(task.currentExecutionId);
if (tcId) {
  await this.taskCastService.transitionStatus(tcId, "paused");
}
```

- [ ] **Step 4: Add TaskCast transition to resume()**

In the `resume()` method (lines 454-471), add after `publishTaskCommand` and before `return`:

```typescript
// Sync running status to TaskCast
const tcId = await this.getTaskcastTaskId(task.currentExecutionId);
if (tcId) {
  await this.taskCastService.transitionStatus(tcId, "in_progress");
}
```

- [ ] **Step 5: Add TaskCast transition to stop()**

In the `stop()` method (lines 473-490), add after `publishTaskCommand` and before `return`:

```typescript
// Sync cancelled status to TaskCast
const tcId = await this.getTaskcastTaskId(task.currentExecutionId);
if (tcId) {
  await this.taskCastService.transitionStatus(tcId, "stopped");
}
```

- [ ] **Step 6: Add TaskCast transition to resolveIntervention()**

In `resolveIntervention()` (lines 558-633), after the execution status update back to `in_progress` (line 622) and before `publishTaskCommand`:

```typescript
// Sync running status to TaskCast (unblock)
const [resolvedExecution] = await this.db
  .select({ taskcastTaskId: schema.agentTaskExecutions.taskcastTaskId })
  .from(schema.agentTaskExecutions)
  .where(eq(schema.agentTaskExecutions.id, intervention.executionId))
  .limit(1);

if (resolvedExecution?.taskcastTaskId) {
  await this.taskCastService.transitionStatus(
    resolvedExecution.taskcastTaskId,
    "in_progress",
  );
  await this.taskCastService.publishEvent(resolvedExecution.taskcastTaskId, {
    type: "intervention",
    data: {
      intervention: {
        ...updated,
        status: "resolved",
      },
    },
    seriesId: `intervention:${interventionId}`,
    seriesMode: "latest",
  });
}
```

- [ ] **Step 7: Verify compilation**

```bash
cd /Users/winrey/Projects/weightwave/team9
pnpm --filter @team9/gateway build
```

Expected: BUILD SUCCESS.

- [ ] **Step 8: Commit**

```bash
git add apps/server/apps/gateway/src/tasks/tasks.service.ts
git commit -m "feat(tasks): integrate TaskCastService into TasksService for pause/resume/stop/resolve sync"
```

---

### Task 6: Update WebhookController to look up by taskcastTaskId

**Files:**

- Modify: `apps/server/apps/task-worker/src/webhook/webhook.controller.ts`

Currently, the timeout webhook receives `payload.taskId` which is the TaskCast task ID (not Team9's task ID). We need to look up the execution by `taskcastTaskId` first.

- [ ] **Step 1: Update the handleTimeout method**

In `apps/server/apps/task-worker/src/webhook/webhook.controller.ts`, replace the `handleTimeout` method body (lines 39-87):

```typescript
  @Post('timeout')
  @HttpCode(200)
  async handleTimeout(
    @Body() payload: TaskcastTimeoutPayload,
    @Headers('x-webhook-secret') secret?: string,
  ): Promise<void> {
    if (this.webhookSecret && secret !== this.webhookSecret) {
      throw new ForbiddenException('Invalid webhook secret');
    }
    const { taskId: taskcastId } = payload;

    this.logger.warn(`Received timeout webhook for TaskCast task ${taskcastId}`);

    // Look up execution by taskcastTaskId
    const [execution] = await this.db
      .select()
      .from(schema.agentTaskExecutions)
      .where(eq(schema.agentTaskExecutions.taskcastTaskId, taskcastId))
      .limit(1);

    if (!execution) {
      this.logger.error(
        `Execution not found for TaskCast task: ${taskcastId}`,
      );
      return;
    }

    const now = new Date();

    // Update execution status
    await this.db
      .update(schema.agentTaskExecutions)
      .set({
        status: 'timeout',
        completedAt: now,
      })
      .where(eq(schema.agentTaskExecutions.id, execution.id));

    // Update task status to timeout
    await this.db
      .update(schema.agentTasks)
      .set({
        status: 'timeout',
        updatedAt: now,
      })
      .where(eq(schema.agentTasks.id, execution.taskId));

    this.logger.warn(
      `Task ${execution.taskId} and execution ${execution.id} marked as timeout via webhook`,
    );
  }
```

- [ ] **Step 2: Verify compilation**

```bash
cd /Users/winrey/Projects/weightwave/team9
pnpm --filter @team9/task-worker build
```

Expected: BUILD SUCCESS.

- [ ] **Step 3: Commit**

```bash
git add apps/server/apps/task-worker/src/webhook/webhook.controller.ts
git commit -m "fix(webhook): look up execution by taskcastTaskId instead of Team9 task ID"
```

---

## Chunk 3: Backend — SSE Proxy Endpoint

### Task 7: Create SSE proxy controller

**Files:**

- Create: `apps/server/apps/gateway/src/tasks/tasks-stream.controller.ts`
- Modify: `apps/server/apps/gateway/src/tasks/tasks.module.ts`

The gateway proxies SSE streams from TaskCast to the frontend. Since `EventSource` doesn't support custom headers, the endpoint accepts JWT as a query parameter (`?token=`) in addition to the `Authorization` header.

- [ ] **Step 1: Create tasks-stream.controller.ts**

Create `apps/server/apps/gateway/src/tasks/tasks-stream.controller.ts`:

```typescript
import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  Res,
  Logger,
  NotFoundException,
  Inject,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";
import { JwtService } from "@nestjs/jwt";
import {
  DATABASE_CONNECTION,
  eq,
  and,
  type PostgresJsDatabase,
} from "@team9/database";
import * as schema from "@team9/database/schemas";

@Controller({ path: "tasks", version: "1" })
export class TasksStreamController {
  private readonly logger = new Logger(TasksStreamController.name);
  private readonly taskcastUrl: string;

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly jwtService: JwtService,
    configService: ConfigService,
  ) {
    this.taskcastUrl = configService.get<string>(
      "TASKCAST_URL",
      "http://localhost:3721",
    );
  }

  @Get(":taskId/executions/:execId/stream")
  async streamExecution(
    @Param("taskId") taskId: string,
    @Param("execId") execId: string,
    @Query("token") queryToken: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    // ── Auth: accept Bearer header or ?token= query param ──
    const headerToken = req.headers.authorization?.replace("Bearer ", "");
    const token = headerToken || queryToken;

    if (!token) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    let userId: string;
    try {
      const payload = this.jwtService.verify(token);
      userId = payload.sub;
    } catch {
      res.status(401).json({ error: "Invalid token" });
      return;
    }

    // ── Look up execution + task to get taskcastTaskId and tenantId ──
    const [execution] = await this.db
      .select({
        taskcastTaskId: schema.agentTaskExecutions.taskcastTaskId,
        taskId: schema.agentTaskExecutions.taskId,
      })
      .from(schema.agentTaskExecutions)
      .where(
        and(
          eq(schema.agentTaskExecutions.id, execId),
          eq(schema.agentTaskExecutions.taskId, taskId),
        ),
      )
      .limit(1);

    if (!execution?.taskcastTaskId) {
      throw new NotFoundException(
        "Execution not found or has no TaskCast tracking",
      );
    }

    // ── Verify user belongs to the task's workspace ──
    const [task] = await this.db
      .select({ tenantId: schema.agentTasks.tenantId })
      .from(schema.agentTasks)
      .where(eq(schema.agentTasks.id, taskId))
      .limit(1);

    if (task) {
      const [membership] = await this.db
        .select({ id: schema.tenantMembers.id })
        .from(schema.tenantMembers)
        .where(
          and(
            eq(schema.tenantMembers.tenantId, task.tenantId),
            eq(schema.tenantMembers.userId, userId),
          ),
        )
        .limit(1);

      if (!membership) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
    }

    // ── Proxy SSE from TaskCast ──
    const upstream = `${this.taskcastUrl}/tasks/${execution.taskcastTaskId}/events/stream`;
    const headers: Record<string, string> = {
      Accept: "text/event-stream",
    };

    const lastEventId = req.headers["last-event-id"] as string | undefined;
    if (lastEventId) {
      headers["Last-Event-ID"] = lastEventId;
    }

    const controller = new AbortController();

    // Clean up upstream when client disconnects
    req.on("close", () => controller.abort());

    try {
      const upstreamRes = await fetch(upstream, {
        headers,
        signal: controller.signal,
      });

      if (!upstreamRes.ok || !upstreamRes.body) {
        res.status(502).json({ error: "TaskCast upstream unavailable" });
        return;
      }

      // Set SSE headers
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      // Pipe upstream → client
      const reader = upstreamRes.body.getReader();
      const decoder = new TextDecoder();

      const pump = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(decoder.decode(value, { stream: true }));
          }
        } catch {
          // Client disconnected or abort — expected
        } finally {
          res.end();
        }
      };

      pump();
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      this.logger.error(`SSE proxy error: ${error}`);
      if (!res.headersSent) {
        res.status(502).json({ error: "TaskCast upstream unavailable" });
      }
    }
  }
}
```

- [ ] **Step 2: Register controller in TasksModule**

In `apps/server/apps/gateway/src/tasks/tasks.module.ts`, add the new controller:

```typescript
import { Module, forwardRef } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { DocumentsModule } from "../documents/documents.module.js";
import { WebsocketModule } from "../im/websocket/websocket.module.js";
import { TasksController } from "./tasks.controller.js";
import { TaskBotController } from "./task-bot.controller.js";
import { TasksStreamController } from "./tasks-stream.controller.js";
import { TasksService } from "./tasks.service.js";
import { TaskBotService } from "./task-bot.service.js";
import { TaskCastService } from "./taskcast.service.js";
import { TriggersService } from "./triggers.service.js";

@Module({
  imports: [AuthModule, DocumentsModule, forwardRef(() => WebsocketModule)],
  controllers: [TasksController, TaskBotController, TasksStreamController],
  providers: [TasksService, TaskBotService, TaskCastService, TriggersService],
  exports: [TasksService, TaskCastService, TriggersService],
})
export class TasksModule {}
```

- [ ] **Step 3: Verify compilation**

```bash
cd /Users/winrey/Projects/weightwave/team9
pnpm --filter @team9/gateway build
```

Expected: BUILD SUCCESS.

- [ ] **Step 4: Commit**

```bash
git add apps/server/apps/gateway/src/tasks/tasks-stream.controller.ts apps/server/apps/gateway/src/tasks/tasks.module.ts
git commit -m "feat(tasks): add SSE proxy endpoint for TaskCast event streaming"
```

---

## Chunk 4: Frontend — SSE Hook + Polling Replacement

### Task 8: Install `@taskcast/client` in frontend

**Files:**

- Modify: `apps/client/package.json`

- [ ] **Step 1: Install @taskcast/client**

```bash
cd /Users/winrey/Projects/weightwave/team9
pnpm --filter @team9/client add @taskcast/client
```

- [ ] **Step 2: Verify installation**

```bash
cat apps/client/package.json | grep taskcast
```

Expected: `"@taskcast/client"` in dependencies.

- [ ] **Step 3: Commit**

```bash
git add apps/client/package.json pnpm-lock.yaml
git commit -m "chore: add @taskcast/client to frontend"
```

---

### Task 9: Create useExecutionStream custom hook

**Files:**

- Create: `apps/client/src/hooks/useExecutionStream.ts`

This hook opens an SSE connection through the gateway proxy. On events, it invalidates React Query caches to trigger refetches. The hook is a no-op when `taskcastTaskId` is null (legacy executions or TaskCast failure).

- [ ] **Step 1: Create useExecutionStream.ts**

Create `apps/client/src/hooks/useExecutionStream.ts`:

```typescript
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3000/api";

/**
 * Opens an SSE connection to the TaskCast proxy for a specific execution.
 * Invalidates React Query caches when events arrive.
 *
 * Falls back gracefully: if taskcastTaskId is null, no SSE connection is opened
 * and the caller should keep polling enabled.
 */
export function useExecutionStream(
  taskId: string,
  execId: string | undefined,
  taskcastTaskId: string | null | undefined,
  enabled: boolean,
): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled || !execId || !taskcastTaskId) return;

    const token = localStorage.getItem("auth_token");
    if (!token) return;

    const url = `${API_BASE_URL}/v1/tasks/${taskId}/executions/${execId}/stream?token=${encodeURIComponent(token)}`;
    const eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Invalidate relevant caches based on event type
        if (
          data.type === "step" ||
          data.type === "intervention" ||
          data.type === "deliverable"
        ) {
          queryClient.invalidateQueries({
            queryKey: ["task-execution-entries", taskId, execId],
          });
        }

        // Status change events invalidate the task and execution queries
        if (data.type === "status_changed") {
          queryClient.invalidateQueries({ queryKey: ["task", taskId] });
          queryClient.invalidateQueries({
            queryKey: ["task-executions", taskId],
          });
          queryClient.invalidateQueries({
            queryKey: ["task-execution", taskId, execId],
          });
        }
      } catch {
        // Ignore parse errors (e.g. heartbeat messages)
      }
    };

    eventSource.onerror = () => {
      // EventSource auto-reconnects on error; no action needed.
    };

    return () => eventSource.close();
  }, [taskId, execId, taskcastTaskId, enabled, queryClient]);
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/client/src/hooks/useExecutionStream.ts
git commit -m "feat(client): add useExecutionStream SSE hook for TaskCast events"
```

---

### Task 10: Replace polling with SSE in TaskDetailPanel

**Files:**

- Modify: `apps/client/src/components/tasks/TaskDetailPanel.tsx`

- [ ] **Step 1: Add SSE hook to TaskDetailPanel**

In `apps/client/src/components/tasks/TaskDetailPanel.tsx`:

1. Add import (after line 14):

```typescript
import { useExecutionStream } from "@/hooks/useExecutionStream";
```

2. After the `useQuery` block (after line 40), add SSE hook:

When `taskcastTaskId` is present, SSE handles real-time updates; polling is reduced to 30s safety net. When absent (legacy/failure), 5s polling is retained.

- [ ] **Step 2: Apply the changes**

The final changes to `TaskDetailPanel.tsx`:

1. Add import:

```typescript
import { useExecutionStream } from "@/hooks/useExecutionStream";
```

2. Change `refetchInterval` (line 39) from `5000` to:

```typescript
    refetchInterval: task?.currentExecution?.execution.taskcastTaskId ? 30000 : 5000,
```

Note: `task.currentExecution` has shape `{ execution: AgentTaskExecution; steps; interventions; deliverables } | null`.

3. After the `useQuery` block and `taskIsActive` definition (after line 49), add:

```typescript
// SSE for real-time execution progress
useExecutionStream(
  taskId,
  task?.currentExecution?.execution.id,
  task?.currentExecution?.execution.taskcastTaskId,
  taskIsActive,
);
```

- [ ] **Step 3: Commit**

```bash
git add apps/client/src/components/tasks/TaskDetailPanel.tsx
git commit -m "feat(client): add SSE streaming to TaskDetailPanel, reduce polling when SSE active"
```

---

### Task 11: Replace polling with SSE in TaskBasicInfoTab

**Files:**

- Modify: `apps/client/src/components/tasks/TaskBasicInfoTab.tsx`

- [ ] **Step 1: Add SSE hook and update polling**

In `apps/client/src/components/tasks/TaskBasicInfoTab.tsx`:

1. Add import:

```typescript
import { useExecutionStream } from "@/hooks/useExecutionStream";
```

2. Find the entries query (lines 230-235) and update `refetchInterval`:

```typescript
    refetchInterval: execution?.taskcastTaskId ? 30000 : 5000,
```

3. After the entries query, add SSE hook call (the component receives `task` and `execution` as props or derived values — check the component's props to find where `execution` comes from). The `execution` comes from `task.currentExecution` passed down. The `taskId` is a prop.

Add after the entries query:

```typescript
// SSE for real-time entries updates
useExecutionStream(
  taskId,
  execution?.id,
  execution?.taskcastTaskId,
  !!execution &&
    ["in_progress", "pending_action", "paused"].includes(task.status),
);
```

- [ ] **Step 2: Commit**

```bash
git add apps/client/src/components/tasks/TaskBasicInfoTab.tsx
git commit -m "feat(client): add SSE streaming to TaskBasicInfoTab"
```

---

### Task 12: Replace polling with SSE in TaskRunsTab

**Files:**

- Modify: `apps/client/src/components/tasks/TaskRunsTab.tsx`

- [ ] **Step 1: Keep 5s polling (no change needed)**

In `apps/client/src/components/tasks/TaskRunsTab.tsx`, the executions list query (lines 38-42) uses `refetchInterval: 5000`. Keep this as-is because the `task:execution_created` WebSocket event is not yet implemented (tracked separately in spec non-goals). The 5s polling is currently the only mechanism to detect new executions. Once that WebSocket event is added, this can be reduced to 30s.

No code change needed for this task — it's a deliberate decision to document. Once `task:execution_created` WebSocket event is implemented, reduce this to 30s.

---

### Task 13: Replace polling with SSE in RunDetailView

**Files:**

- Modify: `apps/client/src/components/tasks/RunDetailView.tsx`

- [ ] **Step 1: Add SSE hook and update polling**

In `apps/client/src/components/tasks/RunDetailView.tsx`:

1. Add import:

```typescript
import { useExecutionStream } from "@/hooks/useExecutionStream";
```

2. Update execution query (lines 58-62) `refetchInterval`:

```typescript
    refetchInterval: execution?.taskcastTaskId ? 30000 : 5000,
```

3. Update entries query (lines 74-78) `refetchInterval`:

```typescript
    refetchInterval: execution?.taskcastTaskId ? 30000 : 5000,
```

4. After the entries query (after line 78), add SSE hook:

```typescript
// SSE for real-time updates on this execution
const isActive = execution ? ACTIVE_STATUSES.includes(execution.status) : false;
useExecutionStream(taskId, executionId, execution?.taskcastTaskId, isActive);
```

Note: `ACTIVE_STATUSES` is already defined at line 40, and `isActive` is already defined at lines 66-68. Since `isActive` is already computed, just add the hook after it:

```typescript
useExecutionStream(taskId, executionId, execution?.taskcastTaskId, isActive);
```

- [ ] **Step 2: Commit**

```bash
git add apps/client/src/components/tasks/RunDetailView.tsx
git commit -m "feat(client): add SSE streaming to RunDetailView, reduce polling when SSE active"
```

---

## Chunk 5: Verification + Final Commit

### Task 14: Full build verification

**Files:** None (verification only)

- [ ] **Step 1: Build gateway**

```bash
cd /Users/winrey/Projects/weightwave/team9
pnpm --filter @team9/gateway build
```

Expected: BUILD SUCCESS.

- [ ] **Step 2: Build task-worker**

```bash
cd /Users/winrey/Projects/weightwave/team9
pnpm --filter @team9/task-worker build
```

Expected: BUILD SUCCESS.

- [ ] **Step 3: Build client**

```bash
cd /Users/winrey/Projects/weightwave/team9
pnpm build:client
```

Expected: BUILD SUCCESS.

- [ ] **Step 4: Run linting**

```bash
cd /Users/winrey/Projects/weightwave/team9
pnpm lint
```

Expected: No new lint errors.

- [ ] **Step 5: Verify dev server starts**

```bash
cd /Users/winrey/Projects/weightwave/team9
pnpm dev:server &
sleep 5
curl http://localhost:3000/api/health
kill %1
```

Expected: Health check returns OK.
