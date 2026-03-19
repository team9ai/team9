# Task System Foundation Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three structural invariants: single-active-execution guarantee, execution-scoped bot callbacks, and event schema alignment.

**Architecture:** Worker-only CAS for execution mutual exclusion (Gateway uses read-only `validateStatusTransition`); new execution-scoped Bot API routes replacing task-scoped routes; event phase/error field alignment in OpenClaw task-bridge.

**Tech Stack:** NestJS, Drizzle ORM (PostgreSQL), TypeScript

**Spec:** `docs/superpowers/specs/2026-03-19-task-system-foundation-fixes-design.md`

---

## File Map

| Action | File                                                            | Responsibility                                                                                                                 |
| ------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Modify | `apps/server/apps/gateway/src/tasks/tasks.service.ts`           | Add `retry` to `validateStatusTransition` allowed map (no CAS — Worker-only CAS)                                               |
| Modify | `apps/server/apps/task-worker/src/executor/executor.service.ts` | Add CAS guard at triggerExecution entry; use RETURNING to skip extra SELECT                                                    |
| Modify | `apps/server/apps/gateway/src/tasks/task-bot.controller.ts`     | Replace task-scoped routes with execution-scoped routes                                                                        |
| Modify | `apps/server/apps/gateway/src/tasks/task-bot.service.ts`        | Replace `getActiveExecution` with `getExecutionDirect` + `getExecutionReadOnly`; add `executionId` param to all public methods |
| Modify | `(OpenClaw) extensions/team9/src/task-bridge.ts`                | API paths include executionId; fix phase/error schema                                                                          |

---

### Task 1: Gateway Read-Only Validation — `tasks.service.ts`

**Files:**

- Modify: `apps/server/apps/gateway/src/tasks/tasks.service.ts`

**Note:** The Gateway does NOT perform CAS writes. The Worker-side CAS (Task 2) is the single atomic guard. The Gateway uses `validateStatusTransition()` for fast user feedback only.

- [x] **Step 1: Add `retry` to `validateStatusTransition` allowed map**

In the `validateStatusTransition()` method, add `retry` with the same allowed source states as `restart`:

```typescript
const allowed: Record<string, string[]> = {
  start: ["upcoming"],
  pause: ["in_progress"],
  resume: ["paused"],
  stop: ["in_progress", "paused", "pending_action"],
  restart: ["completed", "failed", "timeout", "stopped"],
  retry: ["completed", "failed", "timeout", "stopped"],
};
```

- [x] **Step 2: Add `validateStatusTransition` call to `retry()`**

After source execution validation and bot check, add:

```typescript
this.validateStatusTransition(task.status, "retry");
```

- [x] **Step 3: Verify build**

Run: `cd /Users/jiangtao/Desktop/shenjingyuan/team9 && pnpm build:server`
Expected: BUILD SUCCESS (no tasks-related type errors)

---

### Task 2: CAS Guard in Worker — `executor.service.ts`

**Files:**

- Modify: `apps/server/apps/task-worker/src/executor/executor.service.ts`

- [ ] **Step 1: Add `notInArray` import**

At line 6, add `notInArray` to the database import:

```typescript
import {
  DATABASE_CONNECTION,
  eq,
  and,
  notInArray,
  type PostgresJsDatabase,
} from "@team9/database";
```

- [ ] **Step 2: Replace triggerExecution with CAS-first approach**

Replace the entire `triggerExecution()` method (lines 47-244) with:

```typescript
async triggerExecution(
  taskId: string,
  opts?: {
    triggerId?: string;
    triggerType?: string;
    triggerContext?: Record<string, unknown>;
    sourceExecutionId?: string;
    documentVersionId?: string;
  },
): Promise<void> {
  // ── 1. CAS: claim the task (must be first — before any resource creation) ──
  const claimed = await this.db
    .update(schema.agentTasks)
    .set({ status: 'in_progress', updatedAt: new Date() })
    .where(
      and(
        eq(schema.agentTasks.id, taskId),
        notInArray(schema.agentTasks.status, [
          'in_progress',
          'paused',
          'pending_action',
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

  if (claimed.length === 0) {
    this.logger.warn(
      `Task ${taskId} cannot start execution — status not eligible or already active`,
    );
    return;
  }

  const task = claimed[0]!;
  this.logger.log(
    `Starting execution for task ${taskId} ("${task.title}")`,
  );

  if (!task.botId) {
    this.logger.error(`Task ${taskId} has no bot assigned, cannot execute`);
    // Release CAS — mark as failed so it can be retried
    await this.db
      .update(schema.agentTasks)
      .set({ status: 'failed', updatedAt: new Date() })
      .where(eq(schema.agentTasks.id, taskId));
    return;
  }

  // ── 2. Create task channel (type='task') ──────────────────────────
  const channelId = uuidv7();
  await this.db.insert(schema.channels).values({
    id: channelId,
    tenantId: task.tenantId,
    name: `task-${task.title.slice(0, 60).replace(/\s+/g, '-').toLowerCase()}-${channelId.slice(-6)}`,
    type: 'task',
    createdBy: task.creatorId,
  });

  // Add the task creator as a channel member
  await this.db.insert(schema.channelMembers).values({
    id: uuidv7(),
    channelId,
    userId: task.creatorId,
    role: 'owner',
  });

  // ── 3. Fetch document content (if linked) ─────────────────────────
  let documentContent: string | undefined;
  let documentVersionId: string | undefined;
  if (task.documentId) {
    const [docVersion] = await this.db
      .select({
        content: schema.documentVersions.content,
        versionId: schema.documentVersions.id,
      })
      .from(schema.documents)
      .innerJoin(
        schema.documentVersions,
        eq(schema.documentVersions.id, schema.documents.currentVersionId),
      )
      .where(eq(schema.documents.id, task.documentId))
      .limit(1);

    documentContent = docVersion?.content;
    documentVersionId = docVersion?.versionId;
  }

  if (opts?.documentVersionId) {
    documentVersionId = opts.documentVersionId;
  }

  // ── 4. Create execution record ────────────────────────────────────
  const executionId = uuidv7();
  const taskcastTaskId = await this.taskCastClient.createTask({
    taskId,
    executionId,
    botId: task.botId,
    tenantId: task.tenantId,
    ttl: 86400,
  });

  await this.db.insert(schema.agentTaskExecutions).values({
    id: executionId,
    taskId,
    taskVersion: task.version,
    status: 'in_progress',
    channelId,
    taskcastTaskId,
    triggerId: opts?.triggerId ?? null,
    triggerType: opts?.triggerType ?? null,
    triggerContext:
      (opts?.triggerContext as unknown as schema.TriggerContext) ?? null,
    documentVersionId: documentVersionId ?? null,
    sourceExecutionId: opts?.sourceExecutionId ?? null,
    startedAt: new Date(),
  });

  // ── 5. Update task with currentExecutionId ────────────────────────
  await this.db
    .update(schema.agentTasks)
    .set({ currentExecutionId: executionId })
    .where(eq(schema.agentTasks.id, taskId));

  // ── 6. Look up bot's shadow userId ────────────────────────────────
  const [bot] = await this.db
    .select({ userId: schema.bots.userId, type: schema.bots.type })
    .from(schema.bots)
    .where(eq(schema.bots.id, task.botId))
    .limit(1);

  if (!bot) {
    this.logger.error(`Bot not found: ${task.botId}`);
    await this.markExecutionFailed(executionId, taskId, {
      code: 'BOT_NOT_FOUND',
      message: `Bot ${task.botId} not found`,
    });
    return;
  }

  // Add the bot's shadow user to the task channel
  await this.db.insert(schema.channelMembers).values({
    id: uuidv7(),
    channelId,
    userId: bot.userId,
    role: 'member',
  });

  // ── 7. Delegate to strategy ───────────────────────────────────────
  const strategy = this.strategies.get(bot.type);
  const context: ExecutionContext = {
    taskId,
    executionId,
    botId: task.botId,
    channelId,
    documentContent,
    taskcastTaskId,
  };

  if (strategy) {
    try {
      await strategy.execute(context);
      this.logger.log(
        `Execution ${executionId} delegated to ${bot.type} strategy`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      this.logger.error(
        `Strategy execution failed for task ${taskId}: ${errorMessage}`,
        errorStack,
      );

      const now = new Date();
      await this.db
        .update(schema.agentTaskExecutions)
        .set({
          status: 'failed',
          completedAt: now,
          error: { message: errorMessage, details: errorStack },
        })
        .where(eq(schema.agentTaskExecutions.id, executionId));

      await this.db
        .update(schema.agentTasks)
        .set({ status: 'failed', updatedAt: now })
        .where(eq(schema.agentTasks.id, taskId));

      return;
    }
  } else {
    this.logger.error(`No strategy registered for bot type "${bot.type}"`);
    await this.markExecutionFailed(executionId, taskId, {
      code: 'NO_STRATEGY',
      message: `No execution strategy registered for bot type "${bot.type}"`,
    });
    return;
  }

  // ── 8. Log completion ──────────────────────────────────────────────
  this.logger.log(`Execution ${executionId} initiated for task ${taskId}`);
}
```

- [ ] **Step 3: Verify build**

Run: `cd /Users/jiangtao/Desktop/shenjingyuan/team9 && pnpm build:server`
Expected: BUILD SUCCESS

---

### Task 3: Execution-Scoped Bot API — Controller

**Files:**

- Modify: `apps/server/apps/gateway/src/tasks/task-bot.controller.ts`

- [ ] **Step 1: Rewrite controller with execution-scoped routes**

Replace the entire file content with:

```typescript
import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
} from "@nestjs/common";
import { AuthGuard, CurrentUser } from "@team9/auth";
import { TaskBotService } from "./task-bot.service.js";
import {
  ReportStepsDto,
  CreateInterventionDto,
  UpdateStatusDto,
  AddDeliverableDto,
} from "./dto/index.js";

@Controller({
  path: "bot/tasks",
  version: "1",
})
@UseGuards(AuthGuard)
export class TaskBotController {
  constructor(private readonly taskBotService: TaskBotService) {}

  @Post(":taskId/executions/:executionId/steps")
  async reportSteps(
    @Param("taskId", ParseUUIDPipe) taskId: string,
    @Param("executionId", ParseUUIDPipe) executionId: string,
    @Body() dto: ReportStepsDto,
    @CurrentUser("sub") botUserId: string,
  ) {
    return this.taskBotService.reportSteps(taskId, executionId, botUserId, dto);
  }

  @Patch(":taskId/executions/:executionId/status")
  async updateStatus(
    @Param("taskId", ParseUUIDPipe) taskId: string,
    @Param("executionId", ParseUUIDPipe) executionId: string,
    @Body() dto: UpdateStatusDto,
    @CurrentUser("sub") botUserId: string,
  ) {
    return this.taskBotService.updateStatus(
      taskId,
      executionId,
      botUserId,
      dto.status,
      dto.error,
    );
  }

  @Post(":taskId/executions/:executionId/interventions")
  async createIntervention(
    @Param("taskId", ParseUUIDPipe) taskId: string,
    @Param("executionId", ParseUUIDPipe) executionId: string,
    @Body() dto: CreateInterventionDto,
    @CurrentUser("sub") botUserId: string,
  ) {
    return this.taskBotService.createIntervention(
      taskId,
      executionId,
      botUserId,
      dto,
    );
  }

  @Post(":taskId/executions/:executionId/deliverables")
  async addDeliverable(
    @Param("taskId", ParseUUIDPipe) taskId: string,
    @Param("executionId", ParseUUIDPipe) executionId: string,
    @Body() dto: AddDeliverableDto,
    @CurrentUser("sub") botUserId: string,
  ) {
    return this.taskBotService.addDeliverable(
      taskId,
      executionId,
      botUserId,
      dto,
    );
  }

  @Get(":taskId/executions/:executionId/document")
  async getDocument(
    @Param("taskId", ParseUUIDPipe) taskId: string,
    @Param("executionId", ParseUUIDPipe) executionId: string,
    @CurrentUser("sub") botUserId: string,
  ) {
    return this.taskBotService.getTaskDocument(taskId, executionId, botUserId);
  }
}
```

- [ ] **Step 2: Verify build (will fail until Task 4 completes)**

This step will have type errors because `task-bot.service.ts` method signatures haven't been updated yet. Proceed to Task 4.

---

### Task 4: Execution-Scoped Bot API — Service

**Files:**

- Modify: `apps/server/apps/gateway/src/tasks/task-bot.service.ts`

- [ ] **Step 1: Add `ConflictException` import and clean up unused imports**

Update the `@nestjs/common` import at line 1-7:

```typescript
import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from "@nestjs/common";
```

Remove unused `desc` from the `@team9/database` import at line 9-16 (it is not used anywhere in this file):

```typescript
import {
  DATABASE_CONNECTION,
  eq,
  and,
  sql,
  type PostgresJsDatabase,
} from "@team9/database";
```

- [ ] **Step 2: Update `reportSteps` signature and call**

Replace line 39-40:

```typescript
// Before:
async reportSteps(taskId: string, botUserId: string, dto: ReportStepsDto) {
  const { execution } = await this.getActiveExecution(taskId, botUserId);

// After:
async reportSteps(taskId: string, executionId: string, botUserId: string, dto: ReportStepsDto) {
  const { execution } = await this.getExecutionDirect(taskId, executionId, botUserId);
```

- [ ] **Step 3: Update `updateStatus` signature and call**

Replace lines 136-145:

```typescript
// Before:
async updateStatus(
  taskId: string,
  botUserId: string,
  status: string,
  error?: { code?: string; message: string },
) {
  const { task, execution } = await this.getActiveExecution(
    taskId,
    botUserId,
  );

// After:
async updateStatus(
  taskId: string,
  executionId: string,
  botUserId: string,
  status: string,
  error?: { code?: string; message: string },
) {
  const { task, execution } = await this.getExecutionDirect(
    taskId,
    executionId,
    botUserId,
  );
```

- [ ] **Step 4: Update `createIntervention` signature and call**

Replace lines 213-221:

```typescript
// Before:
async createIntervention(
  taskId: string,
  botUserId: string,
  dto: CreateInterventionDto,
) {
  const { task, execution } = await this.getActiveExecution(
    taskId,
    botUserId,
  );

// After:
async createIntervention(
  taskId: string,
  executionId: string,
  botUserId: string,
  dto: CreateInterventionDto,
) {
  const { task, execution } = await this.getExecutionDirect(
    taskId,
    executionId,
    botUserId,
  );
```

- [ ] **Step 5: Update `addDeliverable` signature and call**

Replace lines 277-287:

```typescript
// Before:
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
  const { execution } = await this.getActiveExecution(taskId, botUserId);

// After:
async addDeliverable(
  taskId: string,
  executionId: string,
  botUserId: string,
  data: {
    fileName: string;
    fileSize?: number;
    mimeType?: string;
    fileUrl: string;
  },
) {
  const { execution } = await this.getExecutionDirect(taskId, executionId, botUserId);
```

- [ ] **Step 6: Update `getTaskDocument` to accept executionId**

Replace lines 317-388 (the entire `getTaskDocument` method) with:

```typescript
async getTaskDocument(taskId: string, executionId: string, botUserId: string) {
  const { task } = await this.getExecutionReadOnly(taskId, executionId, botUserId);

  if (!task.documentId) {
    return null;
  }

  const [document] = await this.db
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.id, task.documentId))
    .limit(1);

  if (!document) {
    throw new NotFoundException('Document not found');
  }

  let currentVersion: {
    id: string;
    versionIndex: number;
    content: string;
    summary: string | null;
    createdAt: Date;
  } | null = null;

  if (document.currentVersionId) {
    const [ver] = await this.db
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.id, document.currentVersionId))
      .limit(1);

    if (ver) {
      currentVersion = {
        id: ver.id,
        versionIndex: ver.versionIndex,
        content: ver.content,
        summary: ver.summary,
        createdAt: ver.createdAt,
      };
    }
  }

  return {
    id: document.id,
    title: document.title,
    documentType: document.documentType,
    currentVersion,
  };
}
```

- [ ] **Step 7: Replace `getActiveExecution` with `getExecutionDirect` and `getExecutionReadOnly`**

Delete the existing `getActiveExecution` method (lines 392-431) and replace with:

```typescript
// ── Private helpers ──────────────────────────────────────────────

private async verifyBotOwnership(botId: string, botUserId: string) {
  const [bot] = await this.db
    .select({ userId: schema.bots.userId })
    .from(schema.bots)
    .where(eq(schema.bots.id, botId))
    .limit(1);

  if (!bot || bot.userId !== botUserId) {
    throw new ForbiddenException('Bot does not own this task');
  }
}

private async getExecutionDirect(
  taskId: string,
  executionId: string,
  botUserId?: string,
) {
  // 1. Direct lookup by executionId + taskId
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

  // 3. Load task
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
    await this.verifyBotOwnership(task.botId, botUserId);
  }

  return { task, execution };
}

private async getExecutionReadOnly(
  taskId: string,
  executionId: string,
  botUserId?: string,
) {
  // Same as getExecutionDirect but without terminal status rejection
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

  const [task] = await this.db
    .select()
    .from(schema.agentTasks)
    .where(eq(schema.agentTasks.id, taskId))
    .limit(1);

  if (!task) {
    throw new NotFoundException('Task not found');
  }

  if (botUserId && task.botId) {
    await this.verifyBotOwnership(task.botId, botUserId);
  }

  return { task, execution };
}
```

- [ ] **Step 8: Verify build**

Run: `cd /Users/jiangtao/Desktop/shenjingyuan/team9 && pnpm build:server`
Expected: BUILD SUCCESS (Tasks 3 + 4 together should compile)

---

### Task 5: OpenClaw task-bridge — Execution-Scoped Paths + Schema Fix

**Files:**

- Modify: `/Users/jiangtao/Desktop/shenjingyuan/openclaw-hive/openclaw/extensions/team9/src/task-bridge.ts`

- [ ] **Step 1: Update `handleTaskEvent` — lifecycle:end path**

Replace lines 98-103:

```typescript
// Before:
if (phase === "end") {
  void callBotApiWithRetry(baseUrl, token, "PATCH", `/${taskId}/status`, {
    status: "completed",
  });
  runStates.delete(runId);
  return;
}

// After:
if (phase === "end") {
  void callBotApiWithRetry(
    baseUrl,
    token,
    "PATCH",
    `/${taskId}/executions/${state.executionId}/status`,
    {
      status: "completed",
    },
  );
  runStates.delete(runId);
  return;
}
```

- [ ] **Step 2: Update `handleTaskEvent` — lifecycle:error path**

Replace lines 106-120:

```typescript
// Before:
if (phase === "error") {
  const errorMessage =
    typeof data?.error === "string"
      ? data.error
      : typeof data?.message === "string"
        ? data.message
        : "Agent execution failed";

  void callBotApiWithRetry(baseUrl, token, "PATCH", `/${taskId}/status`, {
    status: "failed",
    error: { message: errorMessage },
  });
  runStates.delete(runId);
  return;
}

// After:
if (phase === "error") {
  const errorMessage =
    typeof data?.error === "string"
      ? data.error
      : typeof data?.message === "string"
        ? data.message
        : "Agent execution failed";

  void callBotApiWithRetry(
    baseUrl,
    token,
    "PATCH",
    `/${taskId}/executions/${state.executionId}/status`,
    {
      status: "failed",
      error: { message: errorMessage },
    },
  );
  runStates.delete(runId);
  return;
}
```

- [ ] **Step 3: Fix tool:invoke phase and update path**

Replace lines 123-138:

```typescript
// Before:
if (stream === "tool") {
  if (phase === "invoke") {
    const toolName = (data?.tool as string) || (data?.name as string) || "tool";
    state.stepIndex += 1;
    state.currentToolName = toolName;

    void callBotApi(baseUrl, token, "POST", `/${taskId}/steps`, {
      steps: [
        {
          orderIndex: state.stepIndex,
          title: toolName,
          status: "in_progress",
        },
      ],
    });
    return;
  }

// After:
if (stream === "tool") {
  if (phase === "start") {
    const toolName = (data?.name as string) || "tool";
    state.stepIndex += 1;
    state.currentToolName = toolName;

    void callBotApi(baseUrl, token, "POST",
      `/${taskId}/executions/${state.executionId}/steps`, {
      steps: [
        {
          orderIndex: state.stepIndex,
          title: toolName,
          status: "in_progress",
        },
      ],
    });
    return;
  }
```

- [ ] **Step 4: Fix tool:result error check and update path**

Replace lines 141-156:

```typescript
// Before:
  if (phase === "result") {
    const toolName = state.currentToolName || "tool";
    const failed = data?.error != null;

    void callBotApi(baseUrl, token, "POST", `/${taskId}/steps`, {
      steps: [
        {
          orderIndex: state.stepIndex,
          title: toolName,
          status: failed ? "failed" : "completed",
        },
      ],
    });
    state.currentToolName = undefined;
    return;
  }
}

// After:
  if (phase === "result") {
    const toolName = state.currentToolName || "tool";
    const failed = data?.isError === true;

    void callBotApi(baseUrl, token, "POST",
      `/${taskId}/executions/${state.executionId}/steps`, {
      steps: [
        {
          orderIndex: state.stepIndex,
          title: toolName,
          status: failed ? "failed" : "completed",
        },
      ],
    });
    state.currentToolName = undefined;
    return;
  }
}
```

- [ ] **Step 5: Verify OpenClaw build**

Run: `cd /Users/jiangtao/Desktop/shenjingyuan/openclaw-hive/openclaw && pnpm build`
Expected: BUILD SUCCESS (or equivalent typecheck command)

---

### Task 6: Final Verification

- [ ] **Step 1: Build Team9 server**

Run: `cd /Users/jiangtao/Desktop/shenjingyuan/team9 && pnpm build:server`
Expected: BUILD SUCCESS

- [ ] **Step 2: Build OpenClaw**

Run: `cd /Users/jiangtao/Desktop/shenjingyuan/openclaw-hive/openclaw && pnpm build`
Expected: BUILD SUCCESS

- [ ] **Step 3: Review all changes**

Run: `cd /Users/jiangtao/Desktop/shenjingyuan/team9 && git diff`
Run: `cd /Users/jiangtao/Desktop/shenjingyuan/openclaw-hive/openclaw && git diff`

Verify:

- No stray `getActiveExecution` references remain in `task-bot.service.ts`
- No old task-scoped routes remain in `task-bot.controller.ts`
- All `callBotApi` paths in `task-bridge.ts` include `/executions/${state.executionId}/`
- `validateStatusTransition` is still called by `pause()`, `resume()`, `stop()`
