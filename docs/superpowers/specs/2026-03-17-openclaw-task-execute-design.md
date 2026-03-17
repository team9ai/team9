# OpenClaw Task Execute Integration Design

**Date:** 2026-03-17
**Status:** Draft
**Scope:** Team9 task-worker `OpenclawStrategy` + OpenClaw HTTP execute endpoint + Team9 plugin task bridge

## Problem

The current `OpenclawStrategy` in Team9's task-worker sends an empty-body POST to a non-existent OpenClaw endpoint (`/api/agents/:agentId/execute`). pause/resume/stop are unimplemented stubs. The task execution pipeline is non-functional end-to-end.

## Solution Overview

Approach B — Event Bridge via Team9 Plugin:

1. **OpenClaw HTTP endpoint**: New `POST /api/agents/:agentId/execute` handler that accepts a task request, calls `agentCommand()`, and returns 202 Accepted immediately.
2. **AgentRunContext metadata**: Extend the existing run context to carry an optional `metadata` bag, allowing the execute handler to attach task identifiers.
3. **Team9 plugin task bridge**: A new module inside the Team9 plugin that listens to `onAgentEvent`, detects task-sourced runs via metadata, and translates agent lifecycle events into Team9 Bot API calls.
4. **Team9 OpenclawStrategy fix**: Send proper request body with auth, timeout, and task metadata. Wire up pause/resume/stop in the consumer chain.

## Architecture

```
Team9 Gateway                    Team9 Task Worker              OpenClaw Instance
─────────────                    ─────────────────              ─────────────────
User clicks Start
  → TasksService.start()
  → RabbitMQ {type:'start'}
                                 TaskCommandConsumer
                                   → ExecutorService
                                     → create channel
                                     → create execution
                                     → OpenclawStrategy.execute()
                                       → POST /api/agents/:id/execute
                                                                 ─────────────────
                                                                 Execute Handler
                                                                   → register metadata
                                                                   → agentCommand()
                                                                   → return 202

                                                                 Agent runs async...
                                                                   → emits onAgentEvent

                                                                 Task Bridge (Team9 plugin)
                                                                   → detects task metadata
                                                                   → POST /bot/tasks/:id/steps
                                                                   → PATCH /bot/tasks/:id/status
                                                                 ─────────────────

Team9 Gateway (Bot API)
  ← receives step/status updates
  ← publishes to TaskCast
  ← broadcasts WebSocket events

Frontend (SSE)
  ← receives real-time updates
```

## Module 1: OpenClaw HTTP Execute Endpoint

**File:** `src/gateway/execute-http.ts` (new), registered in `src/gateway/server-http.ts`

**Route:** `POST /api/agents/:agentId/execute`

**Request:**

```json
{
  "message": "Task document content...",
  "idempotencyKey": "agent_task_exec_{executionId}",
  "sessionKey": "agent:{agentId}:task:{taskId}",
  "channelId": "uuid (Team9 task channel for delivery)",
  "timeout": 86400,
  "extraSystemPrompt": "optional additional instructions",
  "task": {
    "taskId": "uuid",
    "executionId": "uuid"
  }
}
```

**Response:** `202 Accepted`

```json
{
  "runId": "uuid",
  "status": "accepted",
  "acceptedAt": 1710700000000
}
```

**Auth:** Standard gateway Bearer token (same as other HTTP endpoints).

**Obtaining `runtime` and `deps` for `agentCommand()`:**

`agentCommand()` requires three arguments: `(opts, runtime, deps)`. The HTTP handler obtains these the same way other HTTP endpoints do (e.g., `openresponses-http.ts`):

- `runtime`: Use `defaultRuntime` — the singleton runtime instance available at module scope in the gateway (same pattern as OpenResponses/OpenAI HTTP handlers).
- `deps`: Use `context.deps` (the `CliDeps` instance passed to all HTTP handlers via the `handleHttpRequest` closure in `server-http.ts`). The handler function signature receives `(req, res, context)` where `context` includes `deps`, `cfg`, and other shared state.

**Idempotency:**

The handler maintains a module-level `Map<string, { runId: string; acceptedAt: number }>` keyed by `idempotencyKey`. Before spawning a new run:

1. Check if `idempotencyKey` already exists in the map
2. If yes, return the cached `{ runId, status: "accepted", acceptedAt }` immediately (no duplicate agent run)
3. If no, proceed with execution and cache the result
4. Entries expire after 10 minutes (same TTL as WebSocket gateway's `context.dedupe`)

**Logic:**

1. Validate Bearer token (reuse existing auth pattern from `openresponses-http.ts`)
2. Parse `agentId` from URL path
3. Read JSON body via `readJsonBodyOrError()`
4. Check idempotency cache — return cached response if duplicate
5. Generate `runId` (UUID)
6. Register `AgentRunContext` with task metadata (see Module 2 for merge strategy)
7. Create an `AbortController` and store it in the active runs registry (see Module 6)
8. Fire-and-forget `agentCommand({ message, sessionKey, runId, deliver: true, channel: "team9", to: "team9:{channelId}", timeout, extraSystemPrompt, abortSignal: controller.signal }, runtime, deps)`
9. Cache idempotency entry
10. Return 202 immediately

**Error cases:**

- 401: Invalid/missing Bearer token
- 400: Missing required fields (`message`, `idempotencyKey`, `channelId`)
- 404: Unknown `agentId`
- 500: Internal error during setup

## Module 2: AgentRunContext Metadata Extension

**File:** `src/infra/agent-events.ts`

**Change:** Add optional `metadata` field to `AgentRunContext`:

```typescript
type AgentRunContext = {
  sessionKey?: string;
  verboseLevel?: VerboseLevel;
  isHeartbeat?: boolean;
  metadata?: Record<string, unknown>; // NEW
};
```

**Merge behavior fix:** The current `registerAgentRunContext()` implementation mutates an existing entry field-by-field. `agentCommand()` internally calls `registerAgentRunContext(runId, { sessionKey, verboseLevel })` (line ~289 of `commands/agent.ts`), which would NOT touch the `metadata` field since it only merges fields that are explicitly set. However, to be safe, the implementation must be updated to **preserve existing `metadata` if the new context does not include it**:

```typescript
export function registerAgentRunContext(
  runId: string,
  ctx: AgentRunContext,
): void {
  const existing = runContextById.get(runId);
  if (existing) {
    if (ctx.sessionKey !== undefined) existing.sessionKey = ctx.sessionKey;
    if (ctx.verboseLevel !== undefined)
      existing.verboseLevel = ctx.verboseLevel;
    if (ctx.isHeartbeat !== undefined) existing.isHeartbeat = ctx.isHeartbeat;
    if (ctx.metadata !== undefined) existing.metadata = ctx.metadata; // NEW: only overwrite if explicitly provided
  } else {
    runContextById.set(runId, { ...ctx });
  }
}
```

**Ordering:** The execute handler calls `registerAgentRunContext()` with metadata **before** calling `agentCommand()`. When `agentCommand()` calls it again (without metadata), the existing metadata is preserved.

The execute handler registers context as:

```typescript
registerAgentRunContext(runId, {
  sessionKey,
  metadata: {
    source: "team9-task",
    taskId: task.taskId,
    executionId: task.executionId,
  },
});
```

The Team9 plugin filters events:

```typescript
const ctx = getAgentRunContext(event.runId);
if (ctx?.metadata?.source !== "team9-task") return;
```

This is a generic extension — any plugin can use `metadata` for its own purposes.

## Module 3: Team9 Plugin Task Event Bridge

**File:** `extensions/team9/src/task-bridge.ts` (new)

### Initialization

Registered during plugin startup (`channel.ts` `start()` or `index.ts`):

```typescript
import {
  onAgentEvent,
  getAgentRunContext,
} from "../../src/infra/agent-events.js";

export function startTaskBridge(apiClient: Team9ApiClient): () => void {
  const runStates = new Map<string, TaskRunState>();

  const unsubscribe = onAgentEvent((event) => {
    const ctx = getAgentRunContext(event.runId);
    if (ctx?.metadata?.source !== "team9-task") return;
    handleTaskEvent(runStates, ctx.metadata, event, apiClient);
  });

  return unsubscribe;
}
```

### Internal State (per runId)

```typescript
type TaskRunState = {
  taskId: string;
  executionId: string;
  stepIndex: number; // auto-incrementing orderIndex
  currentToolName?: string; // name of in-progress tool step
};
```

Cleaned up on lifecycle end/error.

### Event Translation Rules

| Agent Event                    | Team9 Bot API Call                                                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `lifecycle` + `phase: "start"` | No-op (already in_progress)                                                                                             |
| `tool` + `phase: "invoke"`     | `POST /bot/tasks/:taskId/steps` with `{ steps: [{ orderIndex: N, title: toolName, status: "in_progress" }] }`           |
| `tool` + `phase: "result"`     | `POST /bot/tasks/:taskId/steps` with `{ steps: [{ orderIndex: N, title: toolName, status: "completed" or "failed" }] }` |
| `lifecycle` + `phase: "end"`   | `PATCH /bot/tasks/:taskId/status` with `{ status: "completed" }`                                                        |
| `lifecycle` + `phase: "error"` | `PATCH /bot/tasks/:taskId/status` with `{ status: "failed", error: { message } }`                                       |

### API Calls

Uses the plugin's existing `TEAM9_TOKEN` and `TEAM9_BASE_URL` — no additional credentials needed. The bot's JWT token is already available in the plugin environment.

Calls are made via `fetch()` with the bot token in `Authorization: Bearer` header. The base URL is `TEAM9_BASE_URL` + `/api/v1/bot/tasks/:taskId/...`.

### API Path

All Bot API calls use the full versioned path: `{TEAM9_BASE_URL}/api/v1/bot/tasks/{taskId}/...`

### Error Handling

- API call failures are logged but never thrown — must not interrupt agent execution
- Status update (lifecycle end/error) failures: retry once after 1 second delay. On second failure, log error and discard.
- Step progress API failures: log and discard (no retry — next step update will include latest state)

### Cleanup

The task bridge cleans up `TaskRunState` for a runId when it handles a terminal lifecycle event (`phase: "end"` or `phase: "error"`). This is triggered by the event itself, not by `clearAgentRunContext()` (which has no callback hook). The cleanup order is: (1) make final Bot API call, (2) delete from `runStates` map.

## Module 4: Team9 OpenclawStrategy Fix

**File:** `apps/server/apps/task-worker/src/executor/strategies/openclaw.strategy.ts`

### execute()

```typescript
async execute(context: ExecutionContext): Promise<void> {
  const { agentId, openclawUrl, gatewayToken } = await this.resolveOpenclawConfig(context.botId);

  const body = {
    message: context.documentContent ?? 'Execute this task',
    idempotencyKey: context.taskcastTaskId ?? `exec_${context.executionId}`,
    sessionKey: `agent:${agentId}:task:${context.taskId}`,
    channelId: context.channelId,
    timeout: 86400,
    task: {
      taskId: context.taskId,
      executionId: context.executionId,
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch(
      new URL(`/api/agents/${encodeURIComponent(agentId)}/execute`, openclawUrl),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${gatewayToken}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenClaw execute failed (${response.status}): ${errorText || response.statusText}`);
    }
  } finally {
    clearTimeout(timer);
  }
}
```

### resolveOpenclawConfig() — extracted helper

Queries bot + installedApplications once, returns `{ agentId, openclawUrl, gatewayToken }`. Eliminates the duplicate DB query issue.

**`gatewayToken` source:** Retrieved from `installedApplications.secrets.instanceResult.gateway_token` (or `instanceResult.instance.gateway_token`). This field is populated during OpenClaw instance provisioning by the Control Plane. If the field does not exist in the current schema, it must be added to the instance provisioning flow (Control Plane stores the gateway auth token when creating the instance and returns it in the `instanceResult`).

**Fallback:** If `gatewayToken` is not available in secrets (legacy instances), the strategy should log a warning and skip the `Authorization` header — OpenClaw instances with auth disabled will still accept the request.

### stop()

```typescript
async stop(context: ExecutionContext): Promise<void> {
  const { agentId, openclawUrl, gatewayToken } = await this.resolveOpenclawConfig(context.botId);

  await fetch(
    new URL(`/api/agents/${encodeURIComponent(agentId)}/stop`, openclawUrl),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${gatewayToken}`,
      },
      body: JSON.stringify({
        sessionKey: `agent:${agentId}:task:${context.taskId}`,
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );
}
```

### pause() / resume()

Left as TODO for v1 — OpenClaw does not currently support pausing/resuming an in-progress agent run. The agent run model is fire-and-forget; true pause/resume would require checkpointing, which is a separate feature.

## Module 5: TaskCommandConsumer + ExecutorService Wiring

### TaskCommandConsumer

Wire up stop command (pause/resume stay as warnings for v1):

```typescript
case 'stop':
  await this.executor.stopExecution(command.taskId);
  break;
case 'pause':
  this.logger.warn(`Pause not yet supported for task ${command.taskId}`);
  break;
case 'resume':
  this.logger.warn(`Resume not yet supported for task ${command.taskId}`);
  break;
```

### ExecutorService.stopExecution()

New method:

```typescript
async stopExecution(taskId: string): Promise<void> {
  // 1. Load task + current execution
  // 2. Look up bot type → get strategy
  // 3. Build ExecutionContext from execution record
  // 4. Call strategy.stop(context)
  // 5. Update execution status → stopped
  // 6. Update task status → stopped
}
```

## Module 6: Active Runs Registry (OpenClaw)

**File:** `src/gateway/active-runs.ts` (new)

The execute endpoint needs to create an `AbortController` for each run and the stop endpoint needs to look it up. This module provides the registry.

```typescript
type ActiveRun = {
  runId: string;
  sessionKey: string;
  abortController: AbortController;
  startedAt: number;
};

const activeRuns = new Map<string, ActiveRun>(); // keyed by runId
const sessionKeyIndex = new Map<string, string>(); // sessionKey → runId

export function registerActiveRun(run: ActiveRun): void {
  activeRuns.set(run.runId, run);
  sessionKeyIndex.set(run.sessionKey, run.runId);
}

export function abortBySessionKey(sessionKey: string): boolean {
  const runId = sessionKeyIndex.get(sessionKey);
  if (!runId) return false;
  const run = activeRuns.get(runId);
  if (!run) return false;
  run.abortController.abort();
  return true;
}

export function removeActiveRun(runId: string): void {
  const run = activeRuns.get(runId);
  if (run) {
    sessionKeyIndex.delete(run.sessionKey);
    activeRuns.delete(runId);
  }
}
```

**Lifecycle:**

- Execute handler: calls `registerActiveRun()` before `agentCommand()`
- `agentCommand()` completion (`.then`/`.catch`): calls `removeActiveRun(runId)`
- Stop handler: calls `abortBySessionKey(sessionKey)`

**Stale entry cleanup:** A periodic sweep (every 5 minutes) removes entries older than 25 hours (slightly more than the max 24h timeout) as a safety net.

## OpenClaw Stop Endpoint

**File:** `src/gateway/stop-http.ts` (new), registered in `src/gateway/server-http.ts`

**Route:** `POST /api/agents/:agentId/stop`

**Request:**

```json
{
  "sessionKey": "agent:{agentId}:task:{taskId}"
}
```

**Logic:**

1. Validate Bearer token
2. Read JSON body
3. Call `abortBySessionKey(sessionKey)` from the active runs registry
4. If found and aborted: return `200 { "status": "stopped" }`
5. If not found: return `404 { "error": "No active run found for this session" }`

When the `AbortController` is aborted, `agentCommand()` receives the abort signal, which terminates the agent run. The `onAgentEvent` lifecycle error event fires, and the task bridge translates it to a `failed` or `stopped` status update on Team9.

## V1 Scope Summary

| Feature                                   | V1 Status                                    |
| ----------------------------------------- | -------------------------------------------- |
| Execute endpoint (OpenClaw)               | Implemented                                  |
| AgentRunContext metadata                  | Implemented                                  |
| Active runs registry (OpenClaw)           | Implemented                                  |
| Task event bridge (Team9 plugin)          | Implemented                                  |
| OpenclawStrategy.execute() fix            | Implemented                                  |
| Stop (OpenClaw endpoint + Team9 strategy) | Implemented                                  |
| Idempotency (execute endpoint)            | Implemented                                  |
| Pause / Resume                            | TODO (needs agent checkpointing)             |
| Intervention support                      | Not in V1 (agent cannot request human input) |
| Configurable timeout per task             | Not in V1 (hardcoded 24h)                    |

## Files Changed

### OpenClaw side

| File                                        | Change                                                                       |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| `src/infra/agent-events.ts`                 | Add `metadata` to `AgentRunContext`, update merge logic to preserve metadata |
| `src/gateway/server-http.ts`                | Register execute + stop handlers in the request chain                        |
| `src/gateway/execute-http.ts` (new)         | Execute endpoint handler (~120 lines)                                        |
| `src/gateway/stop-http.ts` (new)            | Stop endpoint handler (~60 lines)                                            |
| `src/gateway/active-runs.ts` (new)          | Active runs registry with sessionKey index (~60 lines)                       |
| `extensions/team9/src/task-bridge.ts` (new) | Task event bridge (~200 lines)                                               |
| `extensions/team9/src/channel.ts`           | Initialize task bridge on startup                                            |

### Team9 side

| File                                                                        | Change                                                                 |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `apps/server/apps/task-worker/src/executor/strategies/openclaw.strategy.ts` | Full rewrite of execute(), add stop(), extract resolveOpenclawConfig() |
| `apps/server/apps/task-worker/src/executor/execution-strategy.interface.ts` | No change needed                                                       |
| `apps/server/apps/task-worker/src/executor/executor.service.ts`             | Add stopExecution() method                                             |
| `apps/server/apps/task-worker/src/consumer/task-command.consumer.ts`        | Wire stop command                                                      |
