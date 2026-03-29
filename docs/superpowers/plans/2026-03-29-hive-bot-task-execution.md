# Hive Bot Task Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable tasks assigned to Hive bots (`managedProvider = 'hive'`) to execute via the claw-hive session runtime, with full pause/resume/stop lifecycle and agent-driven status reporting via TaskBotController.

**Architecture:** `HiveStrategy` (new) in `task-worker` calls `ClawHiveService.sendInput()` with a `team9:task.start` event; the claw-hive runtime auto-creates the session and delivers it to `Team9Component`, which sets the task channel as the tracking target, stores task context in a mutable ref, and exposes new `ReportTaskSteps`/`UpdateTaskStatus`/`CreateTaskIntervention`/`AddTaskDeliverable` tools. Pause maps to session interrupt, stop maps to session delete, resume re-sends a `team9:task.resume` event.

**Tech Stack:** NestJS / Jest (task-worker), Vitest (team9-agent-pi), Drizzle ORM, ClawHiveService HTTP client, TypeScript ESM throughout.

**Spec:** `docs/superpowers/specs/2026-03-29-hive-bot-task-execution-design.md`

---

## Phase A — Server side (repo: `team9`)

Tests run from: `apps/server/apps/task-worker/`

```bash
cd apps/server/apps/task-worker && NODE_OPTIONS='--experimental-vm-modules' pnpm test
```

ClawHiveService tests run from: `apps/server/libs/claw-hive/`

```bash
cd apps/server/libs/claw-hive && NODE_OPTIONS='--experimental-vm-modules' pnpm test
```

---

### Task A1: Extend `ExecutionContext` and update `ExecutorService` strategy routing

**Files:**

- Modify: `apps/server/apps/task-worker/src/executor/execution-strategy.interface.ts`
- Modify: `apps/server/apps/task-worker/src/executor/executor.service.ts`
- Modify: `apps/server/apps/task-worker/src/executor/executor.service.spec.ts`

- [ ] **Step 1: Add `tenantId` and `message` to `ExecutionContext`**

Replace the entire file `apps/server/apps/task-worker/src/executor/execution-strategy.interface.ts`:

```typescript
export interface ExecutionContext {
  taskId: string;
  executionId: string;
  botId: string;
  channelId: string;
  title: string;
  documentContent?: string;
  taskcastTaskId: string | null;
  tenantId: string; // required for session ID construction
  message?: string; // carries resume message; undefined for start/stop/pause
}

export interface ExecutionStrategy {
  execute(context: ExecutionContext): Promise<void>;
  pause(context: ExecutionContext): Promise<void>;
  resume(context: ExecutionContext): Promise<void>;
  stop(context: ExecutionContext): Promise<void>;
}
```

- [ ] **Step 2: Update bot query helper in `executor.service.ts`**

In `triggerExecution()`, find the bot-loading select (around line 179):

```typescript
// OLD
const [bot] = await this.db
  .select({ userId: schema.bots.userId, type: schema.bots.type })
  .from(schema.bots)
  .where(eq(schema.bots.id, task.botId))
  .limit(1);
```

Replace with:

```typescript
// NEW
const [bot] = await this.db
  .select({
    userId: schema.bots.userId,
    type: schema.bots.type,
    managedProvider: schema.bots.managedProvider,
  })
  .from(schema.bots)
  .where(eq(schema.bots.id, task.botId))
  .limit(1);
```

Then update the strategy lookup (around line 202):

```typescript
// OLD
const strategy = this.strategies.get(bot.type);
```

```typescript
// NEW
const strategyKey = bot.managedProvider === "hive" ? "hive" : bot.type;
const strategy = this.strategies.get(strategyKey);
```

Also update the `ExecutionContext` construction (around line 203) to add `tenantId`:

```typescript
const context: ExecutionContext = {
  taskId,
  executionId,
  botId: task.botId,
  channelId,
  title: task.title,
  documentContent,
  taskcastTaskId,
  tenantId: task.tenantId, // NEW
};
```

- [ ] **Step 3: Apply same bot-query fix to `stopExecution()`**

In `stopExecution()`, find the bot select (around line 297):

```typescript
// OLD
const [bot] = await this.db
  .select({ type: schema.bots.type })
  .from(schema.bots)
  .where(eq(schema.bots.id, task.botId))
  .limit(1);
const strategy = this.strategies.get(bot.type);
```

```typescript
// NEW
const [bot] = await this.db
  .select({
    type: schema.bots.type,
    managedProvider: schema.bots.managedProvider,
  })
  .from(schema.bots)
  .where(eq(schema.bots.id, task.botId))
  .limit(1);
const strategyKey = bot.managedProvider === "hive" ? "hive" : bot.type;
const strategy = this.strategies.get(strategyKey);
```

Also update the `ExecutionContext` construction inside `stopExecution()` to add `tenantId`:

```typescript
const context: ExecutionContext = {
  taskId,
  executionId: execution.id,
  botId: task.botId,
  channelId: execution.channelId,
  title: task.title,
  taskcastTaskId: execution.taskcastTaskId,
  tenantId: task.tenantId, // NEW
};
```

Note: `task` already has `tenantId` from the initial `db.select().from(schema.agentTasks)` query in `stopExecution()`.

- [ ] **Step 4: Update `sampleBot` in tests and add `tenantId` assertions**

In `executor.service.spec.ts`, update `sampleBot` to include `managedProvider`:

```typescript
const sampleBot = {
  userId: "bot-user-001",
  type: "system",
  managedProvider: null, // null = unmanaged, routes by type
};
```

Add a test for hive bot routing:

```typescript
it('should route to "hive" strategy when managedProvider is "hive"', async () => {
  const hiveBot = {
    userId: "bot-user-001",
    type: "custom",
    managedProvider: "hive",
  };
  selectResultQueue = [[sampleTask], [hiveBot]];

  const hiveStrategy = {
    execute: jest.fn<any>().mockResolvedValue(undefined),
    pause: jest.fn<any>().mockResolvedValue(undefined),
    resume: jest.fn<any>().mockResolvedValue(undefined),
    stop: jest.fn<any>().mockResolvedValue(undefined),
  };
  service.registerStrategy("hive", hiveStrategy);

  await service.triggerExecution("task-001");

  expect(hiveStrategy.execute).toHaveBeenCalledWith(
    expect.objectContaining({
      taskId: "task-001",
      tenantId: "tenant-001",
    }),
  );
});

it("should pass tenantId in ExecutionContext", async () => {
  selectResultQueue = [
    [{ ...sampleTask, tenantId: "tenant-xyz" }],
    [sampleBot],
  ];
  service.registerStrategy("system", mockStrategy);

  await service.triggerExecution("task-001");

  expect(mockStrategy.execute).toHaveBeenCalledWith(
    expect.objectContaining({ tenantId: "tenant-xyz" }),
  );
});
```

Also update `baseContext` in `openclaw.strategy.spec.ts` to add `tenantId`:

```typescript
const baseContext: ExecutionContext = {
  taskId: "task-001",
  executionId: "exec-001",
  botId: "bot-001",
  channelId: "ch-001",
  title: "Test task",
  taskcastTaskId: "agent_task_exec_exec-001",
  tenantId: "tenant-001", // NEW
};
```

- [ ] **Step 5: Run tests and verify they pass**

```bash
cd /Users/winrey/Projects/weightwave/team9/apps/server/apps/task-worker
NODE_OPTIONS='--experimental-vm-modules' pnpm test
```

Expected: all existing tests pass + 2 new tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/winrey/Projects/weightwave/team9
git add apps/server/apps/task-worker/src/executor/execution-strategy.interface.ts \
        apps/server/apps/task-worker/src/executor/executor.service.ts \
        apps/server/apps/task-worker/src/executor/executor.service.spec.ts \
        apps/server/apps/task-worker/src/executor/strategies/openclaw.strategy.spec.ts
git commit -m "feat(task-worker): add tenantId+message to ExecutionContext, route by managedProvider"
```

---

### Task A2: Add `ClawHiveService` session control methods

**Files:**

- Modify: `apps/server/libs/claw-hive/src/claw-hive.service.ts`
- Modify: `apps/server/libs/claw-hive/src/claw-hive.service.spec.ts`

- [ ] **Step 1: Write failing tests for `interruptSession` and `deleteSession`**

Add to `claw-hive.service.spec.ts` (after the existing test blocks):

```typescript
describe("interruptSession", () => {
  it("sends POST to /api/sessions/{id}/interrupt with auth headers", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ status: "interrupted" }));

    await service.interruptSession("my-session-id", "tenant-abc");

    expect(mockFetch).toHaveBeenCalledWith(
      "http://test-hive:9999/api/sessions/my-session-id/interrupt",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-Hive-Auth": "test-token",
          "X-Hive-Tenant": "tenant-abc",
        }),
      }),
    );
  });

  it("URL-encodes session IDs containing slashes", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}));

    await service.interruptSession("team9/t1/agent/task/task-1");

    const calledUrl = (mockFetch.mock.calls[0] as any[])[0] as string;
    expect(calledUrl).toBe(
      "http://test-hive:9999/api/sessions/team9%2Ft1%2Fagent%2Ftask%2Ftask-1/interrupt",
    );
  });

  it("throws when response is not ok", async () => {
    mockFetch.mockResolvedValueOnce(textResponse("Session not found", 404));

    await expect(service.interruptSession("bad-session")).rejects.toThrow(
      "Failed to interrupt session: 404",
    );
  });
});

describe("deleteSession", () => {
  it("sends DELETE to /api/sessions/{id}", async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await service.deleteSession("sess-abc", "tenant-xyz");

    expect(mockFetch).toHaveBeenCalledWith(
      "http://test-hive:9999/api/sessions/sess-abc",
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({ "X-Hive-Tenant": "tenant-xyz" }),
      }),
    );
  });

  it("does not throw on 404 (session already gone)", async () => {
    mockFetch.mockResolvedValueOnce(new Response("Not Found", { status: 404 }));

    await expect(
      service.deleteSession("gone-session"),
    ).resolves.toBeUndefined();
  });

  it("throws on non-404 error responses", async () => {
    mockFetch.mockResolvedValueOnce(textResponse("Server error", 500));

    await expect(service.deleteSession("sess-abc")).rejects.toThrow(
      "Failed to delete session: 500",
    );
  });

  it("does not include X-Hive-Tenant header when tenantId is omitted", async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await service.deleteSession("sess-no-tenant");

    const headers = (mockFetch.mock.calls[0] as any[])[1]?.headers ?? {};
    expect(headers["X-Hive-Tenant"]).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/winrey/Projects/weightwave/team9/apps/server/libs/claw-hive
NODE_OPTIONS='--experimental-vm-modules' pnpm test
```

Expected: new tests fail with "service.interruptSession is not a function" or similar.

- [ ] **Step 3: Implement `interruptSession` and `deleteSession` in `claw-hive.service.ts`**

Add these two methods before the private `headers()` method:

```typescript
/** Interrupt (pause) a running session. */
async interruptSession(sessionId: string, tenantId?: string): Promise<void> {
  const res = await fetch(
    `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/interrupt`,
    { method: 'POST', headers: this.headers(tenantId) },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to interrupt session: ${res.status} ${text}`);
  }
}

/** Delete (terminate) a session. Swallows 404 (session already gone). */
async deleteSession(sessionId: string, tenantId?: string): Promise<void> {
  const res = await fetch(
    `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`,
    { method: 'DELETE', headers: this.headers(tenantId) },
  );
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`Failed to delete session: ${res.status} ${text}`);
  }
}
```

- [ ] **Step 4: Run tests and verify they pass**

```bash
cd /Users/winrey/Projects/weightwave/team9/apps/server/libs/claw-hive
NODE_OPTIONS='--experimental-vm-modules' pnpm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/winrey/Projects/weightwave/team9
git add apps/server/libs/claw-hive/src/claw-hive.service.ts \
        apps/server/libs/claw-hive/src/claw-hive.service.spec.ts
git commit -m "feat(claw-hive): add interruptSession and deleteSession methods"
```

---

### Task A3: Implement `HiveStrategy`

**Files:**

- Create: `apps/server/apps/task-worker/src/executor/strategies/hive.strategy.ts`
- Create: `apps/server/apps/task-worker/src/executor/strategies/hive.strategy.spec.ts`

- [ ] **Step 1: Write the failing test file**

Create `apps/server/apps/task-worker/src/executor/strategies/hive.strategy.spec.ts`:

```typescript
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { ExecutionContext } from "../execution-strategy.interface.js";

// ── DB mock ────────────────────────────────────────────────────────────

const mockDb: any = {
  select: jest.fn<any>(),
  from: jest.fn<any>(),
  where: jest.fn<any>(),
  limit: jest.fn<any>(),
};
mockDb.select.mockReturnValue(mockDb);
mockDb.from.mockReturnValue(mockDb);
mockDb.where.mockReturnValue(mockDb);

// ── ClawHiveService mock ───────────────────────────────────────────────

const mockClawHive = {
  sendInput: jest.fn<any>().mockResolvedValue({ messages: [] }),
  interruptSession: jest.fn<any>().mockResolvedValue(undefined),
  deleteSession: jest.fn<any>().mockResolvedValue(undefined),
};

// ── Base context ───────────────────────────────────────────────────────

const baseContext: ExecutionContext = {
  taskId: "task-001",
  executionId: "exec-001",
  botId: "bot-001",
  channelId: "ch-task-001",
  title: "Write a report",
  documentContent: "Research and write about AI trends",
  taskcastTaskId: "agent_task_exec_exec-001",
  tenantId: "tenant-abc",
};

function makeBot(agentId: string) {
  return { managedMeta: { agentId } };
}

function resetDbChain(result: any[] = []) {
  mockDb.select.mockReturnValue(mockDb);
  mockDb.from.mockReturnValue(mockDb);
  mockDb.where.mockReturnValue(mockDb);
  mockDb.limit.mockReturnValue(Promise.resolve(result));
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("HiveStrategy", () => {
  let HiveStrategy: any;
  let strategy: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    resetDbChain([makeBot("my-agent")]);
    ({ HiveStrategy } = await import("./hive.strategy.js"));
    strategy = new HiveStrategy(mockDb, mockClawHive);
  });

  // ── execute() ──────────────────────────────────────────────────────

  describe("execute()", () => {
    it("calls sendInput with team9:task.start and correct session ID", async () => {
      await strategy.execute(baseContext);

      expect(mockClawHive.sendInput).toHaveBeenCalledWith(
        "team9/tenant-abc/my-agent/task/task-001",
        expect.objectContaining({
          type: "team9:task.start",
          source: "team9",
          payload: expect.objectContaining({
            taskId: "task-001",
            executionId: "exec-001",
            channelId: "ch-task-001",
            title: "Write a report",
            documentContent: "Research and write about AI trends",
          }),
        }),
        "tenant-abc",
      );
    });

    it("throws when bot has no managedMeta.agentId", async () => {
      resetDbChain([{ managedMeta: {} }]);

      await expect(strategy.execute(baseContext)).rejects.toThrow(
        "Hive agentId not configured for bot bot-001",
      );
      expect(mockClawHive.sendInput).not.toHaveBeenCalled();
    });

    it("throws when bot is not found", async () => {
      resetDbChain([]);

      await expect(strategy.execute(baseContext)).rejects.toThrow(
        "Hive agentId not configured for bot bot-001",
      );
    });

    it('includes location with type "task" in payload', async () => {
      await strategy.execute(baseContext);

      const payload = (mockClawHive.sendInput.mock.calls[0] as any[])[1]
        .payload;
      expect(payload.location).toEqual({ type: "task", id: "ch-task-001" });
    });

    it("omits documentContent from payload when undefined", async () => {
      const ctxNoDoc: ExecutionContext = {
        ...baseContext,
        documentContent: undefined,
      };
      await strategy.execute(ctxNoDoc);

      const payload = (mockClawHive.sendInput.mock.calls[0] as any[])[1]
        .payload;
      expect(payload.documentContent).toBeUndefined();
    });
  });

  // ── pause() ────────────────────────────────────────────────────────

  describe("pause()", () => {
    it("calls interruptSession with correct session ID and tenantId", async () => {
      await strategy.pause(baseContext);

      expect(mockClawHive.interruptSession).toHaveBeenCalledWith(
        "team9/tenant-abc/my-agent/task/task-001",
        "tenant-abc",
      );
    });

    it("throws when bot has no agentId", async () => {
      resetDbChain([{ managedMeta: null }]);
      await expect(strategy.pause(baseContext)).rejects.toThrow();
    });
  });

  // ── resume() ───────────────────────────────────────────────────────

  describe("resume()", () => {
    it("sends team9:task.resume event", async () => {
      await strategy.resume({ ...baseContext, message: "Please continue" });

      expect(mockClawHive.sendInput).toHaveBeenCalledWith(
        "team9/tenant-abc/my-agent/task/task-001",
        expect.objectContaining({
          type: "team9:task.resume",
          payload: expect.objectContaining({
            taskId: "task-001",
            executionId: "exec-001",
            message: "Please continue",
          }),
        }),
        "tenant-abc",
      );
    });

    it("resume message is undefined when not provided", async () => {
      await strategy.resume(baseContext); // no message field

      const payload = (mockClawHive.sendInput.mock.calls[0] as any[])[1]
        .payload;
      expect(payload.message).toBeUndefined();
    });
  });

  // ── stop() ─────────────────────────────────────────────────────────

  describe("stop()", () => {
    it("calls deleteSession with correct session ID and tenantId", async () => {
      await strategy.stop(baseContext);

      expect(mockClawHive.deleteSession).toHaveBeenCalledWith(
        "team9/tenant-abc/my-agent/task/task-001",
        "tenant-abc",
      );
    });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /Users/winrey/Projects/weightwave/team9/apps/server/apps/task-worker
NODE_OPTIONS='--experimental-vm-modules' pnpm test -- --testPathPattern=hive.strategy
```

Expected: FAIL — "Cannot find module './hive.strategy.js'"

- [ ] **Step 3: Implement `HiveStrategy`**

Create `apps/server/apps/task-worker/src/executor/strategies/hive.strategy.ts`:

```typescript
import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  DATABASE_CONNECTION,
  eq,
  type PostgresJsDatabase,
} from "@team9/database";
import * as schema from "@team9/database/schemas";
import { ClawHiveService } from "@team9/claw-hive";
import type {
  ExecutionStrategy,
  ExecutionContext,
} from "../execution-strategy.interface.js";

@Injectable()
export class HiveStrategy implements ExecutionStrategy {
  private readonly logger = new Logger(HiveStrategy.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly clawHiveService: ClawHiveService,
  ) {}

  async execute(context: ExecutionContext): Promise<void> {
    this.logger.log(`Starting Hive agent for task ${context.taskId}`);
    const { agentId } = await this.resolveHiveConfig(context.botId);
    const sessionId = this.buildSessionId(
      context.tenantId,
      agentId,
      context.taskId,
    );

    await this.clawHiveService.sendInput(
      sessionId,
      {
        type: "team9:task.start",
        source: "team9",
        timestamp: new Date().toISOString(),
        payload: {
          taskId: context.taskId,
          executionId: context.executionId,
          channelId: context.channelId,
          title: context.title,
          ...(context.documentContent !== undefined
            ? { documentContent: context.documentContent }
            : {}),
          location: { type: "task", id: context.channelId },
        },
      },
      context.tenantId,
    );
  }

  async pause(context: ExecutionContext): Promise<void> {
    this.logger.log(`Pausing Hive agent for task ${context.taskId}`);
    const { agentId } = await this.resolveHiveConfig(context.botId);
    const sessionId = this.buildSessionId(
      context.tenantId,
      agentId,
      context.taskId,
    );
    await this.clawHiveService.interruptSession(sessionId, context.tenantId);
  }

  async resume(context: ExecutionContext): Promise<void> {
    this.logger.log(`Resuming Hive agent for task ${context.taskId}`);
    const { agentId } = await this.resolveHiveConfig(context.botId);
    const sessionId = this.buildSessionId(
      context.tenantId,
      agentId,
      context.taskId,
    );
    await this.clawHiveService.sendInput(
      sessionId,
      {
        type: "team9:task.resume",
        source: "team9",
        timestamp: new Date().toISOString(),
        payload: {
          taskId: context.taskId,
          executionId: context.executionId,
          message: context.message,
        },
      },
      context.tenantId,
    );
  }

  async stop(context: ExecutionContext): Promise<void> {
    this.logger.log(`Stopping Hive agent for task ${context.taskId}`);
    const { agentId } = await this.resolveHiveConfig(context.botId);
    const sessionId = this.buildSessionId(
      context.tenantId,
      agentId,
      context.taskId,
    );
    await this.clawHiveService.deleteSession(sessionId, context.tenantId);
  }

  private buildSessionId(
    tenantId: string,
    agentId: string,
    taskId: string,
  ): string {
    return `team9/${tenantId}/${agentId}/task/${taskId}`;
  }

  private async resolveHiveConfig(botId: string): Promise<{ agentId: string }> {
    const [bot] = await this.db
      .select({ managedMeta: schema.bots.managedMeta })
      .from(schema.bots)
      .where(eq(schema.bots.id, botId))
      .limit(1);

    const agentId = (bot?.managedMeta as Record<string, unknown> | null)
      ?.agentId as string | undefined;

    if (!agentId) {
      throw new Error(`Hive agentId not configured for bot ${botId}`);
    }
    return { agentId };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/winrey/Projects/weightwave/team9/apps/server/apps/task-worker
NODE_OPTIONS='--experimental-vm-modules' pnpm test -- --testPathPattern=hive.strategy
```

Expected: all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/winrey/Projects/weightwave/team9
git add apps/server/apps/task-worker/src/executor/strategies/hive.strategy.ts \
        apps/server/apps/task-worker/src/executor/strategies/hive.strategy.spec.ts
git commit -m "feat(task-worker): implement HiveStrategy for claw-hive task execution"
```

---

### Task A4: Add `pauseExecution`/`resumeExecution` to `ExecutorService`, wire everything in module

**Files:**

- Modify: `apps/server/apps/task-worker/src/executor/executor.service.ts`
- Modify: `apps/server/apps/task-worker/src/executor/executor.service.spec.ts`
- Modify: `apps/server/apps/task-worker/src/executor/executor.module.ts`
- Modify: `apps/server/apps/task-worker/src/consumer/task-command.consumer.ts`

- [ ] **Step 1: Add `pauseExecution` and `resumeExecution` to `executor.service.ts`**

Add after `stopExecution()`:

```typescript
/**
 * Pause the currently active execution for the given task.
 */
async pauseExecution(taskId: string): Promise<void> {
  const [task] = await this.db
    .select()
    .from(schema.agentTasks)
    .where(eq(schema.agentTasks.id, taskId))
    .limit(1);

  if (!task || !task.currentExecutionId || !task.botId) {
    this.logger.warn(`Task ${taskId} cannot be paused — no active execution or bot`);
    return;
  }

  const [execution] = await this.db
    .select()
    .from(schema.agentTaskExecutions)
    .where(eq(schema.agentTaskExecutions.id, task.currentExecutionId))
    .limit(1);

  if (!execution) {
    this.logger.error(`Execution ${task.currentExecutionId} not found`);
    return;
  }

  const [bot] = await this.db
    .select({
      type: schema.bots.type,
      managedProvider: schema.bots.managedProvider,
    })
    .from(schema.bots)
    .where(eq(schema.bots.id, task.botId))
    .limit(1);

  if (!bot) {
    this.logger.error(`Bot not found: ${task.botId}`);
    return;
  }

  const strategyKey = bot.managedProvider === 'hive' ? 'hive' : bot.type;
  const strategy = this.strategies.get(strategyKey);
  if (!strategy) {
    this.logger.error(`No strategy for bot type "${strategyKey}"`);
    return;
  }

  if (!execution.channelId) {
    this.logger.warn(`Execution ${execution.id} has no channelId; skipping pause`);
    return;
  }

  const context: ExecutionContext = {
    taskId,
    executionId: execution.id,
    botId: task.botId,
    channelId: execution.channelId,
    title: task.title,
    taskcastTaskId: execution.taskcastTaskId,
    tenantId: task.tenantId,
  };

  try {
    await strategy.pause(context);
  } catch (error) {
    this.logger.warn(`Strategy pause failed for task ${taskId}: ${error}`);
  }

  await this.db
    .update(schema.agentTasks)
    .set({ status: 'paused', updatedAt: new Date() })
    .where(eq(schema.agentTasks.id, taskId));

  this.logger.log(`Execution ${execution.id} paused for task ${taskId}`);
}

/**
 * Resume the paused execution for the given task.
 */
async resumeExecution(taskId: string, message?: string): Promise<void> {
  const [task] = await this.db
    .select()
    .from(schema.agentTasks)
    .where(eq(schema.agentTasks.id, taskId))
    .limit(1);

  if (!task || !task.currentExecutionId || !task.botId) {
    this.logger.warn(`Task ${taskId} cannot be resumed — no active execution or bot`);
    return;
  }

  const [execution] = await this.db
    .select()
    .from(schema.agentTaskExecutions)
    .where(eq(schema.agentTaskExecutions.id, task.currentExecutionId))
    .limit(1);

  if (!execution) {
    this.logger.error(`Execution ${task.currentExecutionId} not found`);
    return;
  }

  const [bot] = await this.db
    .select({
      type: schema.bots.type,
      managedProvider: schema.bots.managedProvider,
    })
    .from(schema.bots)
    .where(eq(schema.bots.id, task.botId))
    .limit(1);

  if (!bot) {
    this.logger.error(`Bot not found: ${task.botId}`);
    return;
  }

  const strategyKey = bot.managedProvider === 'hive' ? 'hive' : bot.type;
  const strategy = this.strategies.get(strategyKey);
  if (!strategy) {
    this.logger.error(`No strategy for bot type "${strategyKey}"`);
    return;
  }

  if (!execution.channelId) {
    this.logger.warn(`Execution ${execution.id} has no channelId; skipping resume`);
    return;
  }

  const context: ExecutionContext = {
    taskId,
    executionId: execution.id,
    botId: task.botId,
    channelId: execution.channelId,
    title: task.title,
    taskcastTaskId: execution.taskcastTaskId,
    tenantId: task.tenantId,
    message,
  };

  try {
    await strategy.resume(context);
  } catch (error) {
    this.logger.warn(`Strategy resume failed for task ${taskId}: ${error}`);
  }

  await this.db
    .update(schema.agentTasks)
    .set({ status: 'in_progress', updatedAt: new Date() })
    .where(eq(schema.agentTasks.id, taskId));

  this.logger.log(`Execution ${execution.id} resumed for task ${taskId}`);
}
```

- [ ] **Step 2: Add tests for `pauseExecution` and `resumeExecution` in `executor.service.spec.ts`**

Add after the existing describe block:

```typescript
describe("pauseExecution", () => {
  it("calls strategy.pause and sets task status to paused", async () => {
    const taskWithExec = {
      ...sampleTask,
      currentExecutionId: "exec-001",
      tenantId: "tenant-001",
    };
    const execution = {
      id: "exec-001",
      channelId: "ch-001",
      taskcastTaskId: null,
    };
    selectResultQueue = [[taskWithExec], [execution], [sampleBot]];
    service.registerStrategy("system", mockStrategy);

    await service.pauseExecution("task-001");

    expect(mockStrategy.pause).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "task-001", tenantId: "tenant-001" }),
    );
    const pausedSet = updateSets.find((s) => s.status === "paused");
    expect(pausedSet).toBeDefined();
  });

  it("returns early when task has no currentExecutionId", async () => {
    selectResultQueue = [[{ ...sampleTask, currentExecutionId: null }]];

    await service.pauseExecution("task-001");

    expect(mockStrategy.pause).not.toHaveBeenCalled();
  });
});

describe("resumeExecution", () => {
  it("calls strategy.resume with message and sets status to in_progress", async () => {
    const taskWithExec = {
      ...sampleTask,
      currentExecutionId: "exec-001",
      tenantId: "tenant-001",
    };
    const execution = {
      id: "exec-001",
      channelId: "ch-001",
      taskcastTaskId: null,
    };
    selectResultQueue = [[taskWithExec], [execution], [sampleBot]];
    service.registerStrategy("system", mockStrategy);

    await service.resumeExecution("task-001", "please continue");

    expect(mockStrategy.resume).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-001",
        message: "please continue",
      }),
    );
    const inProgressSet = updateSets.find((s) => s.status === "in_progress");
    expect(inProgressSet).toBeDefined();
  });
});
```

- [ ] **Step 3: Update `task-command.consumer.ts` to implement pause/resume**

Replace the two TODO cases:

```typescript
case 'pause':
  // OLD: this.logger.warn(`Pause not yet implemented for task ${command.taskId}`);
  await this.executor.pauseExecution(command.taskId);
  break;
case 'resume':
  // OLD: this.logger.warn(`Resume not yet implemented for task ${command.taskId}`);
  await this.executor.resumeExecution(command.taskId, command.message);
  break;
```

- [ ] **Step 4: Wire `HiveStrategy` and `ClawHiveModule` in `executor.module.ts`**

Replace the entire file:

```typescript
import { Module, OnModuleInit } from "@nestjs/common";
import { DatabaseModule } from "@team9/database";
import { ClawHiveModule } from "@team9/claw-hive";
import { ExecutorService } from "./executor.service.js";
import { OpenclawStrategy } from "./strategies/openclaw.strategy.js";
import { HiveStrategy } from "./strategies/hive.strategy.js";
import { TaskCastModule } from "../taskcast/taskcast.module.js";

@Module({
  imports: [DatabaseModule, TaskCastModule, ClawHiveModule],
  providers: [ExecutorService, OpenclawStrategy, HiveStrategy],
  exports: [ExecutorService],
})
export class ExecutorModule implements OnModuleInit {
  constructor(
    private readonly executorService: ExecutorService,
    private readonly openclawStrategy: OpenclawStrategy,
    private readonly hiveStrategy: HiveStrategy,
  ) {}

  onModuleInit() {
    this.executorService.registerStrategy("system", this.openclawStrategy);
    this.executorService.registerStrategy("custom", this.openclawStrategy);
    this.executorService.registerStrategy("hive", this.hiveStrategy);
  }
}
```

- [ ] **Step 5: Run all task-worker tests**

```bash
cd /Users/winrey/Projects/weightwave/team9/apps/server/apps/task-worker
NODE_OPTIONS='--experimental-vm-modules' pnpm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/winrey/Projects/weightwave/team9
git add apps/server/apps/task-worker/src/executor/executor.service.ts \
        apps/server/apps/task-worker/src/executor/executor.service.spec.ts \
        apps/server/apps/task-worker/src/executor/executor.module.ts \
        apps/server/apps/task-worker/src/consumer/task-command.consumer.ts
git commit -m "feat(task-worker): add pauseExecution/resumeExecution, wire HiveStrategy in ExecutorModule"
```

---

## Phase B — Agent side (repo: `team9-agent-pi`)

Tests run from the repo root:

```bash
cd /Users/winrey/Projects/weightwave/team9-agent-pi
pnpm test
```

Or for a single package:

```bash
pnpm vitest run packages/claw-hive/src/components/team9/tools.test.ts
```

---

### Task B1: Add task event type literals to `claw-hive-types`

**Files:**

- Modify: `/Users/winrey/Projects/weightwave/team9-agent-pi/packages/claw-hive-types/src/input-event.ts`

- [ ] **Step 1: Add JSDoc comment for new event types**

`HiveInputEvent` already has `type: string` (inherited from `InputEvent`) — no union type to extend. Add documentation only:

In `input-event.ts`, update the payload doc comment to include the new event types:

```typescript
/**
 * Hive-specific input event with source and structured payload.
 */
export interface HiveInputEvent extends InputEvent {
  /** Event source platform, e.g. "team9", "dashboard" */
  source: string;
  /**
   * Event payload, varies by type.
   *
   * For team9:message.* events, may include:
   * - `trackingChannelId?: string` — ID of the tracking channel for this execution.
   *   When present, the agent should stream execution events to this channel.
   *   For DM/task channels, this is the channel itself.
   *   For group channels, this is a newly created tracking channel.
   *
   * For team9:task.start events:
   * - `taskId: string` — UUID of the task
   * - `executionId: string` — UUID of the execution
   * - `channelId: string` — task channel ID (type='task')
   * - `title: string` — task title
   * - `documentContent?: string` — full task document content
   * - `location: { type: 'task'; id: string }` — location context
   *
   * For team9:task.resume events:
   * - `taskId: string`
   * - `executionId: string`
   * - `message?: string` — optional user note on resume
   */
  payload: Record<string, unknown>;
}
```

Also add `"task"` to the `MessageLocation` type union so agents can format task locations:

```typescript
export interface MessageLocation {
  type: "channel" | "dm" | "thread" | "tracking" | "task"; // added "task"
  id: string;
  name?: string;
  content?: string;
  parent?: MessageLocation;
}
```

- [ ] **Step 2: Build the package to verify no TypeScript errors**

```bash
cd /Users/winrey/Projects/weightwave/team9-agent-pi
pnpm --filter @team9claw/claw-hive-types build
```

Expected: exits 0, no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/winrey/Projects/weightwave/team9-agent-pi
git add packages/claw-hive-types/src/input-event.ts
git commit -m "feat(claw-hive-types): document task event types, add 'task' to MessageLocation"
```

---

### Task B2: Add task API methods to `Team9ApiClient`

**Files:**

- Modify: `packages/claw-hive/src/components/team9/team9-api-client.ts`
- Modify: `packages/claw-hive/src/components/team9/team9-api-client.test.ts`

- [ ] **Step 1: Write failing tests**

Open `packages/claw-hive/src/components/team9/team9-api-client.test.ts` and add a new `describe` block after the existing tests:

```typescript
describe("task API methods", () => {
  let client: Team9ApiClient;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    client = new Team9ApiClient("http://localhost:3000", "bot-token");
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("reportTaskSteps posts to correct endpoint", async () => {
    await client.reportTaskSteps("task-1", "exec-1", [
      { orderIndex: 0, title: "Research", status: "completed" },
    ]);

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:3000/api/v1/bot/tasks/task-1/executions/exec-1/steps",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer bot-token" }),
      }),
    );
    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.steps).toHaveLength(1);
    expect(body.steps[0].title).toBe("Research");
  });

  it("updateTaskStatus patches to correct endpoint", async () => {
    await client.updateTaskStatus("task-1", "exec-1", "completed");

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:3000/api/v1/bot/tasks/task-1/executions/exec-1/status",
      expect.objectContaining({ method: "PATCH" }),
    );
    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.status).toBe("completed");
  });

  it("updateTaskStatus includes error when provided", async () => {
    await client.updateTaskStatus("task-1", "exec-1", "failed", {
      message: "Timeout",
      details: "stack trace",
    });

    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.error).toEqual({ message: "Timeout", details: "stack trace" });
  });

  it("createTaskIntervention posts to correct endpoint", async () => {
    await client.createTaskIntervention(
      "task-1",
      "exec-1",
      "Need approval for budget",
      [{ label: "Approve", value: "approve" }],
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:3000/api/v1/bot/tasks/task-1/executions/exec-1/interventions",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.prompt).toBe("Need approval for budget");
    expect(body.stepId).toBeUndefined();
  });

  it("createTaskIntervention includes stepId when provided", async () => {
    await client.createTaskIntervention("t", "e", "prompt", [], "step-123");

    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.stepId).toBe("step-123");
  });

  it("addTaskDeliverable posts to correct endpoint", async () => {
    await client.addTaskDeliverable("task-1", "exec-1", {
      fileName: "report.pdf",
      fileUrl: "https://files.example.com/report.pdf",
      fileSize: 12345,
      mimeType: "application/pdf",
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:3000/api/v1/bot/tasks/task-1/executions/exec-1/deliverables",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.fileName).toBe("report.pdf");
    expect(body.mimeType).toBe("application/pdf");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /Users/winrey/Projects/weightwave/team9-agent-pi
pnpm vitest run packages/claw-hive/src/components/team9/team9-api-client.test.ts
```

Expected: FAIL — "client.reportTaskSteps is not a function"

- [ ] **Step 3: Implement the four methods in `team9-api-client.ts`**

Add before the closing brace of `Team9ApiClient`:

```typescript
/** Report task step progress */
async reportTaskSteps(
  taskId: string,
  executionId: string,
  steps: Array<{
    orderIndex: number;
    title: string;
    status: string;
    tokenUsage?: number;
    duration?: number;
  }>,
): Promise<unknown> {
  const res = await this.request(
    `/api/v1/bot/tasks/${taskId}/executions/${executionId}/steps`,
    {
      method: 'POST',
      body: JSON.stringify({ steps }),
    },
  );
  return res.json();
}

/** Update task execution status (completed / failed / timeout) */
async updateTaskStatus(
  taskId: string,
  executionId: string,
  status: 'completed' | 'failed' | 'timeout',
  error?: { message: string; details?: string },
): Promise<unknown> {
  const res = await this.request(
    `/api/v1/bot/tasks/${taskId}/executions/${executionId}/status`,
    {
      method: 'PATCH',
      body: JSON.stringify({ status, ...(error ? { error } : {}) }),
    },
  );
  return res.json();
}

/** Create a human-intervention request */
async createTaskIntervention(
  taskId: string,
  executionId: string,
  prompt: string,
  actions: unknown,
  stepId?: string,
): Promise<unknown> {
  const res = await this.request(
    `/api/v1/bot/tasks/${taskId}/executions/${executionId}/interventions`,
    {
      method: 'POST',
      body: JSON.stringify({ prompt, actions, ...(stepId ? { stepId } : {}) }),
    },
  );
  return res.json();
}

/** Add a deliverable artifact to the execution */
async addTaskDeliverable(
  taskId: string,
  executionId: string,
  data: { fileName: string; fileUrl: string; fileSize?: number; mimeType?: string },
): Promise<unknown> {
  const res = await this.request(
    `/api/v1/bot/tasks/${taskId}/executions/${executionId}/deliverables`,
    {
      method: 'POST',
      body: JSON.stringify(data),
    },
  );
  return res.json();
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/winrey/Projects/weightwave/team9-agent-pi
pnpm vitest run packages/claw-hive/src/components/team9/team9-api-client.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/winrey/Projects/weightwave/team9-agent-pi
git add packages/claw-hive/src/components/team9/team9-api-client.ts \
        packages/claw-hive/src/components/team9/team9-api-client.test.ts
git commit -m "feat(team9): add task reporting methods to Team9ApiClient"
```

---

### Task B3: Add task tools to `createTeam9Tools`

**Files:**

- Modify: `packages/claw-hive/src/components/team9/tools.ts`
- Modify: `packages/claw-hive/src/components/team9/tools.test.ts`

- [ ] **Step 1: Write failing tests for task tools**

In `tools.test.ts`, add after the last existing `describe` block:

```typescript
describe("task tools (when taskContextRef provided)", () => {
  let observer: ReplyStreamObserver;
  let apiClient: Team9ApiClient;
  let taskContextRef: { taskId?: string; executionId?: string };

  beforeEach(() => {
    observer = makeObserver();
    apiClient = makeApiClient();
    taskContextRef = { taskId: "task-001", executionId: "exec-001" };
    vi.spyOn(apiClient, "reportTaskSteps").mockResolvedValue({ ok: true });
    vi.spyOn(apiClient, "updateTaskStatus").mockResolvedValue({ ok: true });
    vi.spyOn(apiClient, "createTaskIntervention").mockResolvedValue({
      id: "int-1",
    });
    vi.spyOn(apiClient, "addTaskDeliverable").mockResolvedValue({
      id: "del-1",
    });
  });

  function makeTools() {
    const { tools } = createTeam9Tools({
      replyStreamObserver: observer,
      apiClient,
      botUserId: "bot-1",
      eventLocationRef: {},
      taskContextRef,
    });
    return tools;
  }

  it("includes ReportTaskSteps, UpdateTaskStatus, CreateTaskIntervention, AddTaskDeliverable tools", () => {
    const tools = makeTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("ReportTaskSteps");
    expect(names).toContain("UpdateTaskStatus");
    expect(names).toContain("CreateTaskIntervention");
    expect(names).toContain("AddTaskDeliverable");
  });

  it("does not include task tools when taskContextRef is not provided", () => {
    const { tools } = createTeam9Tools({
      replyStreamObserver: observer,
      apiClient,
      botUserId: "bot-1",
      eventLocationRef: {},
    });
    const names = tools.map((t) => t.name);
    expect(names).not.toContain("ReportTaskSteps");
    expect(names).not.toContain("UpdateTaskStatus");
  });

  it("ReportTaskSteps calls apiClient.reportTaskSteps", async () => {
    const tools = makeTools();
    const tool = tools.find((t) => t.name === "ReportTaskSteps")!;

    const result = await tool.execute({
      args: {
        steps: [{ orderIndex: 0, title: "Step 1", status: "completed" }],
      },
      ctx: mockCtx,
    });

    expect(apiClient.reportTaskSteps).toHaveBeenCalledWith(
      "task-001",
      "exec-001",
      [{ orderIndex: 0, title: "Step 1", status: "completed" }],
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
  });

  it("UpdateTaskStatus calls apiClient.updateTaskStatus", async () => {
    const tools = makeTools();
    const tool = tools.find((t) => t.name === "UpdateTaskStatus")!;

    await tool.execute({
      args: { status: "completed" },
      ctx: mockCtx,
    });

    expect(apiClient.updateTaskStatus).toHaveBeenCalledWith(
      "task-001",
      "exec-001",
      "completed",
      undefined,
    );
  });

  it("UpdateTaskStatus passes error when provided", async () => {
    const tools = makeTools();
    const tool = tools.find((t) => t.name === "UpdateTaskStatus")!;

    await tool.execute({
      args: { status: "failed", error: { message: "Crashed" } },
      ctx: mockCtx,
    });

    expect(apiClient.updateTaskStatus).toHaveBeenCalledWith(
      "task-001",
      "exec-001",
      "failed",
      { message: "Crashed" },
    );
  });

  it("CreateTaskIntervention calls apiClient.createTaskIntervention", async () => {
    const tools = makeTools();
    const tool = tools.find((t) => t.name === "CreateTaskIntervention")!;

    await tool.execute({
      args: {
        prompt: "Need approval",
        actions: [{ label: "OK", value: "ok" }],
      },
      ctx: mockCtx,
    });

    expect(apiClient.createTaskIntervention).toHaveBeenCalledWith(
      "task-001",
      "exec-001",
      "Need approval",
      [{ label: "OK", value: "ok" }],
      undefined,
    );
  });

  it("AddTaskDeliverable calls apiClient.addTaskDeliverable", async () => {
    const tools = makeTools();
    const tool = tools.find((t) => t.name === "AddTaskDeliverable")!;

    await tool.execute({
      args: {
        fileName: "result.pdf",
        fileUrl: "https://cdn.example.com/result.pdf",
      },
      ctx: mockCtx,
    });

    expect(apiClient.addTaskDeliverable).toHaveBeenCalledWith(
      "task-001",
      "exec-001",
      expect.objectContaining({ fileName: "result.pdf" }),
    );
  });

  it("returns error result when taskContextRef is empty at call-time", async () => {
    const emptyRef = {}; // no taskId/executionId
    const { tools } = createTeam9Tools({
      replyStreamObserver: observer,
      apiClient,
      botUserId: "bot-1",
      eventLocationRef: {},
      taskContextRef: emptyRef,
    });
    const tool = tools.find((t) => t.name === "ReportTaskSteps")!;

    const result = await tool.execute({
      args: { steps: [] },
      ctx: mockCtx,
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toMatch(/task execution context/);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /Users/winrey/Projects/weightwave/team9-agent-pi
pnpm vitest run packages/claw-hive/src/components/team9/tools.test.ts
```

Expected: FAIL — task tools not found in tool list.

- [ ] **Step 3: Add `TaskContextRef` type and task tools to `tools.ts`**

At the top of `tools.ts`, add the interface:

```typescript
export interface TaskContextRef {
  taskId?: string;
  executionId?: string;
}
```

Update the `createTeam9Tools` deps type:

```typescript
export function createTeam9Tools(deps: {
  replyStreamObserver: ReplyStreamObserver;
  apiClient: Team9ApiClient;
  botUserId: string;
  eventLocationRef: EventLocationRef;
  taskContextRef?: TaskContextRef; // NEW
}): { tools: AgentTool[]; dispose: () => Promise<void> };
```

Inside `createTeam9Tools`, after the existing tools array, add task tools when `taskContextRef` is provided:

```typescript
const {
  replyStreamObserver,
  apiClient,
  botUserId,
  eventLocationRef,
  taskContextRef,
} = deps;

// ... existing tools array ...

if (taskContextRef) {
  tools.push(
    {
      name: "ReportTaskSteps",
      description:
        "Report the current progress of the task execution as structured steps. " +
        "Each step has an orderIndex (0-based), title, status (completed/in_progress/failed), " +
        "and optional tokenUsage and duration (seconds).",
      parameters: {
        type: "object",
        properties: {
          steps: {
            type: "array",
            items: {
              type: "object",
              properties: {
                orderIndex: { type: "number" },
                title: { type: "string" },
                status: {
                  type: "string",
                  enum: ["completed", "in_progress", "failed"],
                },
                tokenUsage: { type: "number" },
                duration: { type: "number" },
              },
              required: ["orderIndex", "title", "status"],
            },
          },
        },
        required: ["steps"],
      },
      execute: async ({ args }: ToolExecuteParams): Promise<ToolResult> => {
        const { taskId, executionId } = taskContextRef;
        if (!taskId || !executionId) {
          return toToolResult({
            success: false,
            error: "Not in a task execution context.",
          });
        }
        const params = args as Record<string, unknown>;
        await apiClient.reportTaskSteps(
          taskId,
          executionId,
          params["steps"] as Parameters<typeof apiClient.reportTaskSteps>[2],
        );
        return toToolResult({ success: true });
      },
    },
    {
      name: "UpdateTaskStatus",
      description:
        "Update the task execution status to completed, failed, or timeout. " +
        "Call this when the task is fully done or has encountered an unrecoverable error.",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["completed", "failed", "timeout"],
            description: "Final status of the execution.",
          },
          error: {
            type: "object",
            properties: {
              message: { type: "string" },
              details: { type: "string" },
            },
            required: ["message"],
            description:
              "Error details (required when status is failed or timeout).",
          },
        },
        required: ["status"],
      },
      execute: async ({ args }: ToolExecuteParams): Promise<ToolResult> => {
        const { taskId, executionId } = taskContextRef;
        if (!taskId || !executionId) {
          return toToolResult({
            success: false,
            error: "Not in a task execution context.",
          });
        }
        const params = args as Record<string, unknown>;
        await apiClient.updateTaskStatus(
          taskId,
          executionId,
          params["status"] as "completed" | "failed" | "timeout",
          params["error"] as { message: string; details?: string } | undefined,
        );
        return toToolResult({ success: true });
      },
    },
    {
      name: "CreateTaskIntervention",
      description:
        "Request a human to take an action before the task can continue. " +
        "This will pause the task and notify the user. Provide a clear prompt " +
        "and a list of action choices.",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "Question or instruction for the human reviewer.",
          },
          actions: {
            type: "array",
            description:
              'Possible response actions, e.g. [{"label":"Approve","value":"approve"}]',
          },
          stepId: {
            type: "string",
            description: "Optional: step ID this intervention relates to.",
          },
        },
        required: ["prompt", "actions"],
      },
      execute: async ({ args }: ToolExecuteParams): Promise<ToolResult> => {
        const { taskId, executionId } = taskContextRef;
        if (!taskId || !executionId) {
          return toToolResult({
            success: false,
            error: "Not in a task execution context.",
          });
        }
        const params = args as Record<string, unknown>;
        const result = await apiClient.createTaskIntervention(
          taskId,
          executionId,
          params["prompt"] as string,
          params["actions"],
          params["stepId"] as string | undefined,
        );
        return toToolResult({ success: true, intervention: result });
      },
    },
    {
      name: "AddTaskDeliverable",
      description:
        "Add a file deliverable to the task execution result. " +
        "Use this to attach output files, reports, or artifacts.",
      parameters: {
        type: "object",
        properties: {
          fileName: { type: "string", description: "Original file name." },
          fileUrl: {
            type: "string",
            description: "Publicly accessible URL to the file.",
          },
          fileSize: {
            type: "number",
            description: "File size in bytes (optional).",
          },
          mimeType: {
            type: "string",
            description: 'MIME type, e.g. "application/pdf" (optional).',
          },
        },
        required: ["fileName", "fileUrl"],
      },
      execute: async ({ args }: ToolExecuteParams): Promise<ToolResult> => {
        const { taskId, executionId } = taskContextRef;
        if (!taskId || !executionId) {
          return toToolResult({
            success: false,
            error: "Not in a task execution context.",
          });
        }
        const params = args as Record<string, unknown>;
        const result = await apiClient.addTaskDeliverable(taskId, executionId, {
          fileName: params["fileName"] as string,
          fileUrl: params["fileUrl"] as string,
          fileSize: params["fileSize"] as number | undefined,
          mimeType: params["mimeType"] as string | undefined,
        });
        return toToolResult({ success: true, deliverable: result });
      },
    },
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/winrey/Projects/weightwave/team9-agent-pi
pnpm vitest run packages/claw-hive/src/components/team9/tools.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/winrey/Projects/weightwave/team9-agent-pi
git add packages/claw-hive/src/components/team9/tools.ts \
        packages/claw-hive/src/components/team9/tools.test.ts
git commit -m "feat(team9): add task reporting tools (ReportTaskSteps, UpdateTaskStatus, etc.)"
```

---

### Task B4: Update `Team9Component` to handle `team9:task.start` / `team9:task.resume`

**Files:**

- Modify: `packages/claw-hive/src/components/team9/component.ts`
- Modify: `packages/claw-hive/src/components/team9/component.test.ts`

- [ ] **Step 1: Write failing tests**

In `component.test.ts`, add after the existing describe blocks:

```typescript
describe("formatEventEntry — team9:task.start", () => {
  it("returns a user message with task content", () => {
    const comp = new Team9Component(defaultConfig);
    const ctx = createMockComponentContext(defaultConfig);

    const event: HiveInputEvent = {
      type: "team9:task.start",
      source: "team9",
      timestamp: new Date().toISOString(),
      payload: {
        taskId: "task-001",
        executionId: "exec-001",
        channelId: "ch-task-001",
        title: "Write quarterly report",
        documentContent: "Research AI trends and write a 5-page summary.",
        location: { type: "task", id: "ch-task-001" },
      },
    };

    const result = comp.formatEventEntry(ctx, event);

    expect(result).not.toBeNull();
    expect(result?.role).toBe("user");
    expect(result?.content).toContain("Research AI trends");
  });

  it("falls back to title when documentContent is absent", () => {
    const comp = new Team9Component(defaultConfig);
    const ctx = createMockComponentContext(defaultConfig);

    const event: HiveInputEvent = {
      type: "team9:task.start",
      source: "team9",
      timestamp: new Date().toISOString(),
      payload: {
        taskId: "task-001",
        executionId: "exec-001",
        channelId: "ch-task-001",
        title: "Write quarterly report",
        location: { type: "task", id: "ch-task-001" },
      },
    };

    const result = comp.formatEventEntry(ctx, event);

    expect(result?.content).toContain("Write quarterly report");
  });

  it("sets trackingChannelId on TrackingChannelObserver when provided", () => {
    const setTrackingChannelId = vi.fn();
    const configWithObserver = {
      ...defaultConfig,
      trackingChannelObserver: { setTrackingChannelId, setSenderId: vi.fn() },
    };
    const comp = new Team9Component(configWithObserver);
    const ctx = createMockComponentContext(configWithObserver);

    const event: HiveInputEvent = {
      type: "team9:task.start",
      source: "team9",
      timestamp: new Date().toISOString(),
      payload: {
        taskId: "task-001",
        executionId: "exec-001",
        channelId: "ch-task-001",
        title: "My task",
        location: { type: "task", id: "ch-task-001" },
      },
    };

    comp.formatEventEntry(ctx, event);

    expect(setTrackingChannelId).toHaveBeenCalledWith("ch-task-001", false);
  });

  it("populates taskContextRef so task tools can read taskId/executionId", () => {
    const comp = new Team9Component(defaultConfig) as any;
    const ctx = createMockComponentContext(defaultConfig);

    const event: HiveInputEvent = {
      type: "team9:task.start",
      source: "team9",
      timestamp: new Date().toISOString(),
      payload: {
        taskId: "task-42",
        executionId: "exec-99",
        channelId: "ch-task-001",
        title: "My task",
        location: { type: "task", id: "ch-task-001" },
      },
    };

    comp.formatEventEntry(ctx, event);

    expect(comp.taskContextRef.taskId).toBe("task-42");
    expect(comp.taskContextRef.executionId).toBe("exec-99");
  });
});

describe("formatEventEntry — team9:task.resume", () => {
  it("returns a user message indicating resumption", () => {
    const comp = new Team9Component(defaultConfig);
    const ctx = createMockComponentContext(defaultConfig);

    const event: HiveInputEvent = {
      type: "team9:task.resume",
      source: "team9",
      timestamp: new Date().toISOString(),
      payload: {
        taskId: "task-001",
        executionId: "exec-001",
        message: "please continue",
      },
    };

    const result = comp.formatEventEntry(ctx, event);

    expect(result?.role).toBe("user");
    expect(result?.content).toContain("please continue");
  });

  it("returns generic resume message when no message provided", () => {
    const comp = new Team9Component(defaultConfig);
    const ctx = createMockComponentContext(defaultConfig);

    const event: HiveInputEvent = {
      type: "team9:task.resume",
      source: "team9",
      timestamp: new Date().toISOString(),
      payload: { taskId: "task-001", executionId: "exec-001" },
    };

    const result = comp.formatEventEntry(ctx, event);

    expect(result?.content).toBe("[Task resumed]");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /Users/winrey/Projects/weightwave/team9-agent-pi
pnpm vitest run packages/claw-hive/src/components/team9/component.test.ts
```

Expected: new tests FAIL.

- [ ] **Step 3: Update `component.ts`**

Add `TaskContextRef` import from `./tools.js` (it's exported in Task B3):

```typescript
import type { EventLocationRef, TaskContextRef } from "./tools.js";
```

Add `private readonly taskContextRef: TaskContextRef = {};` after the `eventLocationRef` line:

```typescript
private cachedApiClient?: Team9ApiClient;
private cachedTools?: AgentTool[];
private cachedToolsDispose?: () => Promise<void>;
private readonly eventLocationRef: EventLocationRef = {};
private readonly taskContextRef: TaskContextRef = {};  // NEW
```

In `formatEventEntry()`, add these two blocks before the `team9:message.text` check:

```typescript
if (hiveEvent.type === "team9:task.start") {
  const taskId = payload["taskId"] as string;
  const executionId = payload["executionId"] as string;
  const channelId = payload["channelId"] as string;
  const title = payload["title"] as string;
  const documentContent = payload["documentContent"] as string | undefined;

  // Populate mutable ref so task tools can read taskId/executionId at call-time
  this.taskContextRef.taskId = taskId;
  this.taskContextRef.executionId = executionId;

  // Activate tracking channel observer to write to the task channel
  if (channelId && ctx.config?.trackingChannelObserver) {
    (
      ctx.config.trackingChannelObserver as TrackingChannelObserver
    ).setTrackingChannelId(channelId, false);
  }

  // Update event location ref
  this.eventLocationRef.channelId = channelId;
  this.eventLocationRef.channelType = "channel";
  this.eventLocationRef.isTracking = true;

  const content = documentContent?.trim() || title;
  return { role: "user", content: `[Task] ${content}` };
}

if (hiveEvent.type === "team9:task.resume") {
  const message = payload["message"] as string | undefined;
  return {
    role: "user",
    content: message ? `[Task resumed] ${message}` : "[Task resumed]",
  };
}
```

Update the `getTools()` call inside the `if (!this.cachedTools)` block to pass `taskContextRef`:

```typescript
const { tools, dispose } = createTeam9Tools({
  replyStreamObserver: observer,
  apiClient: this.cachedApiClient,
  botUserId: config.botUserId,
  eventLocationRef: this.eventLocationRef,
  taskContextRef: this.taskContextRef, // NEW — mutable ref, read at call-time
});
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/winrey/Projects/weightwave/team9-agent-pi
pnpm vitest run packages/claw-hive/src/components/team9/component.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
cd /Users/winrey/Projects/weightwave/team9-agent-pi
pnpm test
```

Expected: all tests pass, no regressions.

- [ ] **Step 6: Commit**

```bash
cd /Users/winrey/Projects/weightwave/team9-agent-pi
git add packages/claw-hive/src/components/team9/component.ts \
        packages/claw-hive/src/components/team9/component.test.ts
git commit -m "feat(team9): handle task.start/task.resume events, inject task context ref"
```

---

### Task B5: Build and typecheck both packages

- [ ] **Step 1: Build `claw-hive` package**

```bash
cd /Users/winrey/Projects/weightwave/team9-agent-pi
pnpm --filter @team9claw/claw-hive build
```

Expected: exits 0, `packages/claw-hive/dist/` updated.

- [ ] **Step 2: Typecheck**

```bash
cd /Users/winrey/Projects/weightwave/team9-agent-pi
pnpm typecheck
```

Expected: no TypeScript errors.

- [ ] **Step 3: Build server-side claw-hive lib**

```bash
cd /Users/winrey/Projects/weightwave/team9/apps/server/libs/claw-hive
pnpm build
```

Expected: exits 0.

- [ ] **Step 4: Commit if any build artifact changes**

```bash
cd /Users/winrey/Projects/weightwave/team9-agent-pi
git add packages/claw-hive/dist packages/claw-hive-types/dist
git diff --cached --quiet || git commit -m "build: update claw-hive dist after task execution feature"

cd /Users/winrey/Projects/weightwave/team9
git add apps/server/libs/claw-hive/dist
git diff --cached --quiet || git commit -m "build: update claw-hive lib dist after adding session control methods"
```

---

## Self-review checklist

Spec section → Task coverage:

| Spec requirement                                                             | Task                |
| ---------------------------------------------------------------------------- | ------------------- |
| `tenantId` + `message` in `ExecutionContext`                                 | A1                  |
| Bot query selects `managedProvider`; routing by `managedProvider === 'hive'` | A1 (trigger + stop) |
| `ClawHiveService.interruptSession()`                                         | A2                  |
| `ClawHiveService.deleteSession()`                                            | A2                  |
| `HiveStrategy` (execute/pause/resume/stop)                                   | A3                  |
| `ClawHiveModule` in `ExecutorModule` imports                                 | A4                  |
| `pauseExecution` / `resumeExecution` in `ExecutorService`                    | A4                  |
| Task command consumer implements pause/resume                                | A4                  |
| `MessageLocation` type gains `"task"`                                        | B1                  |
| `Team9ApiClient` task methods                                                | B2                  |
| `TaskContextRef` type + task tools in `createTeam9Tools`                     | B3                  |
| `Team9Component` handles `team9:task.start`                                  | B4                  |
| `Team9Component` handles `team9:task.resume`                                 | B4                  |
| `taskContextRef` populated and passed to `createTeam9Tools`                  | B4                  |
| Frontend — no changes needed (ChannelView already used)                      | ✓ n/a               |
