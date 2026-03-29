# Hive Bot Task Execution Design

**Date:** 2026-03-29

## Background

The task system currently supports only OpenClaw-backed bots (`managedProvider = 'openclaw'`).
We need to also support our own Hive bots (`managedProvider = 'hive'`), which run via the
`claw-hive` runtime (team9-agent-pi).

Constraints confirmed during design:

- Keep `type = 'task'` channel; no schema change.
- Route execution strategy by `bot.managedProvider`, not `bot.type`.
- Full lifecycle: execute / pause / resume / stop.
- Agent self-reports status via `TaskBotController` (same as OpenClaw path).
- Task context (`taskId`, `executionId`) injected into `Team9Component` only for task-channel sessions.
- Frontend: `TaskChatArea` already uses `ChannelView` for all task channels; agent events from
  `TrackingChannelObserver` render as messages — no new component needed.

---

## Architecture

```
User starts task
       │
       ▼
TasksService.start()  →  RabbitMQ (TASK_COMMANDS)
                                │
                    ┌───────────▼────────────┐
                    │  TaskCommandConsumer    │
                    │  (task-worker)          │
                    └───────────┬────────────┘
                                │
                    ┌───────────▼────────────┐
                    │  ExecutorService        │
                    │  triggerExecution()     │
                    │  1. CAS claim task      │
                    │  2. Create task channel │
                    │  3. Create execution    │
                    │  4. Route by            │
                    │     managedProvider     │
                    └───┬──────────────┬──────┘
                        │              │
              ┌─────────▼──┐   ┌───────▼────────┐
              │ OpenClaw   │   │  HiveStrategy  │
              │ Strategy   │   │  (NEW)         │
              └─────────┬──┘   └───────┬────────┘
                        │              │
              POST /api/agents/      sendInput()
              {agentId}/execute      team9:task.start
                                        │
                              ┌─────────▼──────────┐
                              │  claw-hive session  │
                              │  team9/{tenantId}/  │
                              │  {agentId}/task/    │
                              │  {taskId}           │
                              │                     │
                              │  auto-created by    │
                              │  processEvent() /   │
                              │  ensureSession()    │
                              └─────────┬──────────┘
                                        │
                              ┌─────────▼──────────┐
                              │  Team9Component     │
                              │  handles event      │
                              │  sets tracking ch   │
                              │  sets taskCtxRef    │
                              └─────────┬──────────┘
                                        │
                            TrackingChannelObserver
                            writes to task channel
                            (tool calls, thinking,
                             writing, agent_end)
                                        │
                              ┌─────────▼──────────┐
                              │  Agent runs, calls  │
                              │  TaskBotController  │
                              │  (report steps,     │
                              │   update status,    │
                              │   interventions,    │
                              │   deliverables)     │
                              └────────────────────┘
```

---

## Session ID Convention

Task sessions use the structured format parsed by `HiveRuntime.ensureSession()`:

```
team9/{tenantId}/{agentId}/task/{taskId}
```

`parseSessionId()` splits on `/` and requires ≥ 5 parts — this format produces exactly 5,
with `scope = "task"` and `scopeId = taskId`. Analogous to tracking-channel sessions
(`team9/{tenantId}/{agentId}/tracking/{channelId}`).

`processEvent()` auto-creates the session on first use via `ensureSession()` if no session
metadata exists in memory, by resolving the structured ID to an agent definition.

---

## New Event Types

### `team9:task.start`

Sent by `HiveStrategy.execute()` to initiate a task execution.

```typescript
{
  type: 'team9:task.start',
  source: 'team9',
  timestamp: string,
  payload: {
    taskId: string,          // UUID
    executionId: string,     // UUID
    channelId: string,       // task channel ID (type='task')
    title: string,
    documentContent?: string,
    location: {
      type: 'task',
      id: string,            // same as channelId
    },
  }
}
```

### `team9:task.resume`

Sent by `HiveStrategy.resume()` when the user resumes a paused task.

```typescript
{
  type: 'team9:task.resume',
  source: 'team9',
  timestamp: string,
  payload: {
    taskId: string,
    executionId: string,
    message?: string,        // optional user note from ResumeTaskDto
  }
}
```

---

## Changes by Component

### 1. `apps/server/apps/task-worker/` — ExecutorService + HiveStrategy

#### `executor/execution-strategy.interface.ts`

Add `tenantId` and `message` to `ExecutionContext`:

```typescript
export interface ExecutionContext {
  taskId: string;
  executionId: string;
  botId: string;
  channelId: string;
  title: string;
  documentContent?: string;
  taskcastTaskId: string | null;
  tenantId: string; // NEW — required for session ID construction
  message?: string; // NEW — carries resume message; undefined for start/stop/pause
}
```

#### `executor/executor.service.ts`

**All bot-loading queries** (`triggerExecution`, `stopExecution`, and the new
`pauseExecution`/`resumeExecution`) must be updated consistently:

```typescript
// Old (all three methods):
const [bot] = await this.db
  .select({ userId: schema.bots.userId, type: schema.bots.type })
  .from(schema.bots)
  .where(eq(schema.bots.id, task.botId))
  .limit(1);
const strategy = this.strategies.get(bot.type);

// New (all three methods):
const [bot] = await this.db
  .select({
    userId: schema.bots.userId,
    type: schema.bots.type,
    managedProvider: schema.bots.managedProvider,
  })
  .from(schema.bots)
  .where(eq(schema.bots.id, task.botId))
  .limit(1);
const strategyKey = bot.managedProvider === "hive" ? "hive" : bot.type;
const strategy = this.strategies.get(strategyKey);
```

Also pass `tenantId: task.tenantId` in every `ExecutionContext` construction.

**New `pauseExecution(taskId)`**:

```
1. Load task → get currentExecutionId, botId, tenantId
2. Load execution → get channelId
3. Load bot → get managedProvider, type
4. Resolve strategy key
5. Build context, call strategy.pause(context)
6. Update task status → 'paused'
```

**New `resumeExecution(taskId, message?)`**:

```
1. Load task → get currentExecutionId, botId, tenantId
2. Load execution → get channelId
3. Load bot → resolve strategy key
4. Build context with message field populated
5. Call strategy.resume(context)
6. Update task status → 'in_progress'
```

#### `consumer/task-command.consumer.ts`

Implement currently TODO cases:

```typescript
case 'pause':
  await this.executor.pauseExecution(command.taskId);
  break;
case 'resume':
  await this.executor.resumeExecution(command.taskId, command.message);
  break;
```

#### `executor/strategies/hive.strategy.ts` (NEW)

```typescript
@Injectable()
export class HiveStrategy implements ExecutionStrategy {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly clawHiveService: ClawHiveService,
  ) {}

  async execute(context: ExecutionContext): Promise<void> {
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
          documentContent: context.documentContent,
          location: { type: "task", id: context.channelId },
        },
      },
      context.tenantId,
    );
  }

  async pause(context: ExecutionContext): Promise<void> {
    const { agentId } = await this.resolveHiveConfig(context.botId);
    const sessionId = this.buildSessionId(
      context.tenantId,
      agentId,
      context.taskId,
    );
    // Note: interruptSession requires the session to be present in the
    // claw-hive-api pod's in-memory cache. In a single-pod deployment this
    // is always satisfied. In a multi-pod deployment the request may hit a
    // different pod than the one owning the session (see Known Limitations).
    await this.clawHiveService.interruptSession(sessionId, context.tenantId);
  }

  async resume(context: ExecutionContext): Promise<void> {
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
    if (!bot?.managedMeta?.agentId) {
      throw new Error(`Hive agentId not configured for bot ${botId}`);
    }
    return { agentId: bot.managedMeta.agentId };
  }
}
```

#### `executor/executor.module.ts`

Two changes: add `ClawHiveModule` to `imports`, register `HiveStrategy`:

```typescript
@Module({
  imports: [DatabaseModule, TaskCastModule, ClawHiveModule], // ClawHiveModule NEW
  providers: [ExecutorService, OpenclawStrategy, HiveStrategy], // HiveStrategy NEW
  exports: [ExecutorService],
})
export class ExecutorModule implements OnModuleInit {
  constructor(
    private readonly executorService: ExecutorService,
    private readonly openclawStrategy: OpenclawStrategy,
    private readonly hiveStrategy: HiveStrategy, // NEW
  ) {}

  onModuleInit() {
    this.executorService.registerStrategy("system", this.openclawStrategy);
    this.executorService.registerStrategy("custom", this.openclawStrategy);
    this.executorService.registerStrategy("hive", this.hiveStrategy); // NEW
  }
}
```

---

### 2. `apps/server/libs/claw-hive/src/claw-hive.service.ts`

Add two new methods:

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

Both endpoints exist in `claw-hive-api`:

- `POST /api/sessions/:sessionId/interrupt` — `session-control.ts` line 82
- `DELETE /api/sessions/:sessionId` — `sessions.ts` line 42

---

### 3. `packages/claw-hive/src/components/team9/` (team9-agent-pi)

#### `component.ts` — Handle `team9:task.start` / `team9:task.resume` + task context ref

**Why a mutable ref instead of `ComponentData`:**
`Team9ComponentData` has no persistent fields by design ("V1: no mutable runtime state").
Storing `taskContext` in `ComponentData` would also break tool caching: `getTools()` guards
with `if (!this.cachedTools)` and only runs once — but `ctx.data.taskContext` is only
available after `team9:task.start` is processed. By the time tools are first created (during
component initialization), `taskContext` is always undefined.

**Solution:** Use a mutable in-memory ref `taskContextRef` (same pattern as `eventLocationRef`).
Task tools are always created, but they read from the ref at call-time. Non-task sessions
simply never receive `team9:task.start`, so `taskContextRef` stays empty and the tools
return a clear error if invoked.

```typescript
export interface TaskContextRef {
  taskId?: string;
  executionId?: string;
}
```

Add `private readonly taskContextRef: TaskContextRef = {};` alongside `eventLocationRef`.

In `formatEventEntry()`, add handling before `team9:message.text`:

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

  // Update event location ref so the task channel is the default context
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

Pass `taskContextRef` to `createTeam9Tools`:

```typescript
const { tools, dispose } = createTeam9Tools({
  replyStreamObserver: observer,
  apiClient: this.cachedApiClient,
  botUserId: config.botUserId,
  eventLocationRef: this.eventLocationRef,
  taskContextRef: this.taskContextRef, // NEW
});
```

#### `tools.ts` — Task reporting tools

Add `taskContextRef` dep (not `taskContext` — a ref, not a snapshot):

```typescript
export function createTeam9Tools(deps: {
  replyStreamObserver: ReplyStreamObserver;
  apiClient: Team9ApiClient;
  botUserId: string;
  eventLocationRef: EventLocationRef;
  taskContextRef?: TaskContextRef; // NEW — mutable ref, read at call-time
}): { tools: AgentTool[]; dispose: () => Promise<void> };
```

Four task tools are always added when `taskContextRef` is provided. Each tool checks at
execution time:

```typescript
const ctx = deps.taskContextRef;
if (!ctx?.taskId || !ctx?.executionId) {
  return toToolResult({
    success: false,
    error: "Not in a task execution context.",
  });
}
// proceed with ctx.taskId, ctx.executionId
```

**New tools:**

| Tool                     | Method | Endpoint                                                            |
| ------------------------ | ------ | ------------------------------------------------------------------- |
| `ReportTaskSteps`        | POST   | `/api/v1/bot/tasks/{taskId}/executions/{executionId}/steps`         |
| `UpdateTaskStatus`       | PATCH  | `/api/v1/bot/tasks/{taskId}/executions/{executionId}/status`        |
| `CreateTaskIntervention` | POST   | `/api/v1/bot/tasks/{taskId}/executions/{executionId}/interventions` |
| `AddTaskDeliverable`     | POST   | `/api/v1/bot/tasks/{taskId}/executions/{executionId}/deliverables`  |

#### `team9-api-client.ts` — Task API methods

Add four methods:

```typescript
async reportTaskSteps(
  taskId: string,
  executionId: string,
  steps: Array<{ orderIndex: number; title: string; status: string; tokenUsage?: number; duration?: number }>,
): Promise<unknown>

async updateTaskStatus(
  taskId: string,
  executionId: string,
  status: 'completed' | 'failed' | 'timeout',
  error?: { message: string; details?: string },
): Promise<unknown>

async createTaskIntervention(
  taskId: string,
  executionId: string,
  prompt: string,
  actions: unknown,
  stepId?: string,
): Promise<unknown>

async addTaskDeliverable(
  taskId: string,
  executionId: string,
  data: { fileName: string; fileUrl: string; fileSize?: number; mimeType?: string },
): Promise<unknown>
```

---

### 4. `@team9claw/claw-hive-types` — New event type literals

Add `'team9:task.start'` and `'team9:task.resume'` to the `HiveInputEvent` type union
(or widen the type string if it's currently open-ended).

---

### 5. Frontend — No new components required

`TaskChatArea` already renders `ChannelView` for any `channelId` (line 307-318 of
`TaskChatArea.tsx`). When `TrackingChannelObserver` writes agent events (tool calls,
thinking, writing) as messages to the task channel, they appear in `ChannelView` naturally.

The only frontend concern is that messages with `metadata.agentEventType` render with
structured styling (status dot + event label) rather than as plain text. This is covered by
the separate `2026-03-27-agent-event-rendering-design.md` spec and applies to all channel
types including `type='task'`.

**No changes needed in `TaskChatArea.tsx` or any route file** for this feature.

---

## Lifecycle Summary

| Event        | Trigger           | HiveStrategy action                       | Result                                     |
| ------------ | ----------------- | ----------------------------------------- | ------------------------------------------ |
| Start        | User starts task  | `execute()` → `sendInput(task.start)`     | Session auto-created; agent processes task |
| Pause        | User pauses task  | `pause()` → `interruptSession()`          | Worker interrupts agent loop               |
| Resume       | User resumes      | `resume()` → `sendInput(task.resume)`     | Agent receives resume event, continues     |
| Stop         | User stops        | `stop()` → `deleteSession()`              | Session terminated                         |
| Complete     | Agent done        | Agent calls `UpdateTaskStatus(completed)` | Execution marked done; channel locked      |
| Intervention | Agent needs input | Agent calls `CreateTaskIntervention`      | Task → `pending_action`                    |

---

## Known Limitations

### Session reuse across retries

Session ID `team9/{tenantId}/{agentId}/task/{taskId}` is stable across executions of the
same task. On retry, `ensureSession()` will find and reuse the existing session, carrying
over prior message history. Consider calling `clawHiveService.deleteSession()` at the top
of `HiveStrategy.execute()` when `triggerContext?.triggerType === 'retry'` to start fresh.
(Decision deferred to implementation.)

### `interruptSession()` in distributed claw-hive deployments

`POST /api/sessions/:sessionId/interrupt` calls `runtime.getSessionInfo(sessionId)` on the
receiving pod. If claw-hive-api runs as multiple pods (distributed), the pod receiving the
interrupt may not have the session in its local `sessionInfoCache`, and will return 404.
`sendInput()` (used by execute/resume) goes through `processEvent()` which auto-creates
sessions, so it works across pods. `interrupt` does not. This is acceptable for the current
single-pod deployment; must be revisited if claw-hive-api scales horizontally.

### Token usage tracking

`TrackingChannelObserver` does not report token usage to TaskCast. Token usage is only
tracked if the agent explicitly calls `ReportTaskSteps` with `tokenUsage` per step.
