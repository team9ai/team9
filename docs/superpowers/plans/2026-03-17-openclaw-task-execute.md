# OpenClaw Task Execute Integration — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the task execution pipeline functional end-to-end — Team9 triggers agent execution on OpenClaw, receives structured progress updates via event bridge, and supports stop.

**Architecture:** Team9 task-worker sends a POST to OpenClaw's new `/api/agents/:agentId/execute` endpoint. OpenClaw runs the agent via `agentCommand()` and emits events. The Team9 plugin's task bridge listens for events and translates them into Team9 Bot API calls (steps, status). A separate active-runs registry + stop endpoint enables aborting runs.

**Tech Stack:** TypeScript (ESM) on OpenClaw side, TypeScript (NestJS/CJS) on Team9 side. Node.js `fetch` for HTTP. Jest for Team9 tests.

**Spec:** `docs/superpowers/specs/2026-03-17-openclaw-task-execute-design.md`

**Two codebases:**

- OpenClaw: `/Users/jiangtao/Desktop/shenjingyuan/openclaw-hive/openclaw/`
- Team9: `/Users/jiangtao/Desktop/shenjingyuan/team9/`

---

## File Map

### OpenClaw side (all paths relative to `/Users/jiangtao/Desktop/shenjingyuan/openclaw-hive/openclaw/`)

| File                                  | Action | Responsibility                                                                     |
| ------------------------------------- | ------ | ---------------------------------------------------------------------------------- |
| `src/infra/agent-events.ts`           | Modify | Add `metadata` field to `AgentRunContext`, update merge logic                      |
| `src/plugin-sdk/index.ts`             | Modify | Export `onAgentEvent`, `getAgentRunContext`, `AgentEventPayload` for plugin access |
| `src/gateway/active-runs.ts`          | Create | Registry mapping runId/sessionKey to AbortController                               |
| `src/gateway/execute-http.ts`         | Create | `POST /api/agents/:agentId/execute` handler                                        |
| `src/gateway/stop-http.ts`            | Create | `POST /api/agents/:agentId/stop` handler                                           |
| `src/gateway/server-http.ts`          | Modify | Register execute + stop handlers in request chain                                  |
| `extensions/team9/src/task-bridge.ts` | Create | Event listener that translates agent events → Team9 Bot API                        |
| `extensions/team9/src/channel.ts`     | Modify | Initialize task bridge on account start                                            |

### Team9 side (all paths relative to `/Users/jiangtao/Desktop/shenjingyuan/team9/`)

| File                                                                             | Action  | Responsibility                                                                       |
| -------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------ |
| `apps/server/apps/task-worker/src/executor/strategies/openclaw.strategy.ts`      | Rewrite | Proper execute() with body/auth/timeout, add stop(), extract resolveOpenclawConfig() |
| `apps/server/apps/task-worker/src/executor/strategies/openclaw.strategy.spec.ts` | Update  | Update tests for new execute() signature, add stop() tests                           |
| `apps/server/apps/task-worker/src/executor/executor.service.ts`                  | Modify  | Add stopExecution() method                                                           |
| `apps/server/apps/task-worker/src/consumer/task-command.consumer.ts`             | Modify  | Wire stop command to executor                                                        |

---

## Task 1: AgentRunContext metadata extension (OpenClaw)

**Files:**

- Modify: `/Users/jiangtao/Desktop/shenjingyuan/openclaw-hive/openclaw/src/infra/agent-events.ts`

- [ ] **Step 1: Add `metadata` field to `AgentRunContext` type**

In `src/infra/agent-events.ts`, find the type definition (around line 14-18):

```typescript
// BEFORE:
export type AgentRunContext = {
  sessionKey?: string;
  verboseLevel?: VerboseLevel;
  isHeartbeat?: boolean;
};

// AFTER:
export type AgentRunContext = {
  sessionKey?: string;
  verboseLevel?: VerboseLevel;
  isHeartbeat?: boolean;
  metadata?: Record<string, unknown>;
};
```

- [ ] **Step 2: Update `registerAgentRunContext()` to preserve metadata on re-register**

The current implementation (around line 25-41) does field-by-field merge with truthiness + equality checks. **Do NOT rewrite the existing merge logic** — only add one line for `metadata` after the existing `isHeartbeat` handling:

```typescript
// ADD this single line after the existing isHeartbeat guard:
if (context.metadata !== undefined) existing.metadata = context.metadata;
```

Key: When `agentCommand()` internally re-registers the context without metadata, the existing metadata is preserved because `context.metadata` will be `undefined` and the `if` guard skips it.

**Note:** `src/commands/agent/types.ts` also has a type named `AgentRunContext` — that is a different type (message channel context). The modification target here is only `src/infra/agent-events.ts`.

- [ ] **Step 3: Export agent event APIs from plugin-sdk**

In `src/plugin-sdk/index.ts`, add these exports so extensions can import them via `openclaw/plugin-sdk`:

```typescript
// Only expose read/subscribe APIs to extensions — emitAgentEvent and registerAgentRunContext are internal-only
export { onAgentEvent, getAgentRunContext } from "../infra/agent-events.js";
export type {
  AgentRunContext,
  AgentEventPayload,
} from "../infra/agent-events.js";
```

- [ ] **Step 4: Verify no compilation errors**

Run: `cd /Users/jiangtao/Desktop/shenjingyuan/openclaw-hive/openclaw && npx tsc --noEmit src/infra/agent-events.ts src/plugin-sdk/index.ts` (or the project's type-check command)

- [ ] **Step 5: Commit**

```bash
cd /Users/jiangtao/Desktop/shenjingyuan/openclaw-hive/openclaw
git add src/infra/agent-events.ts src/plugin-sdk/index.ts
git commit -m "feat: add metadata field to AgentRunContext, export agent event APIs from plugin-sdk"
```

---

## Task 2: Active Runs Registry (OpenClaw)

**Files:**

- Create: `/Users/jiangtao/Desktop/shenjingyuan/openclaw-hive/openclaw/src/gateway/active-runs.ts`

- [ ] **Step 1: Create active-runs.ts**

```typescript
// src/gateway/active-runs.ts

export type ActiveRun = {
  runId: string;
  sessionKey: string;
  abortController: AbortController;
  startedAt: number;
};

const activeRuns = new Map<string, ActiveRun>();
const sessionKeyIndex = new Map<string, string>();

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

// Stale entry cleanup — safety net for runs that never complete
const STALE_THRESHOLD_MS = 25 * 60 * 60 * 1000; // 25 hours

export function startActiveRunsSweep(): NodeJS.Timeout {
  return setInterval(
    () => {
      const now = Date.now();
      for (const [runId, run] of activeRuns) {
        if (now - run.startedAt > STALE_THRESHOLD_MS) {
          removeActiveRun(runId);
        }
      }
    },
    5 * 60 * 1000,
  ); // every 5 minutes
}
```

- [ ] **Step 2: Verify no compilation errors**

Run: `cd /Users/jiangtao/Desktop/shenjingyuan/openclaw-hive/openclaw && npx tsc --noEmit src/gateway/active-runs.ts`

- [ ] **Step 3: Commit**

```bash
cd /Users/jiangtao/Desktop/shenjingyuan/openclaw-hive/openclaw
git add src/gateway/active-runs.ts
git commit -m "feat: add active runs registry for execute/stop lifecycle"
```

---

## Task 3: Execute HTTP Endpoint (OpenClaw)

**Files:**

- Create: `/Users/jiangtao/Desktop/shenjingyuan/openclaw-hive/openclaw/src/gateway/execute-http.ts`

- [ ] **Step 1: Create execute-http.ts**

```typescript
// src/gateway/execute-http.ts

import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { agentCommand } from "../commands/agent.js";
import { createDefaultDeps } from "../cli/deps.js";
import { defaultRuntime } from "../runtime.js";
import { registerAgentRunContext } from "../infra/agent-events.js";
import { authorizeGatewayConnect, type ResolvedGatewayAuth } from "./auth.js";
import {
  sendJson,
  sendUnauthorized,
  sendInvalidRequest,
  sendMethodNotAllowed,
  readJsonBodyOrError,
} from "./http-common.js";
import { getBearerToken } from "./http-utils.js";
import { registerActiveRun, removeActiveRun } from "./active-runs.js";

// Idempotency cache (10 min TTL)
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
const idempotencyCache = new Map<
  string,
  { runId: string; acceptedAt: number }
>();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of idempotencyCache) {
    if (now - entry.acceptedAt > IDEMPOTENCY_TTL_MS) {
      idempotencyCache.delete(key);
    }
  }
}, 60 * 1000);

type ExecuteRequestBody = {
  message: string;
  idempotencyKey: string;
  sessionKey: string;
  channelId: string;
  timeout?: number;
  extraSystemPrompt?: string;
  task: {
    taskId: string;
    executionId: string;
  };
};

export async function handleExecuteHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: { auth: ResolvedGatewayAuth; trustedProxies?: string[] },
): Promise<boolean> {
  const url = new URL(
    req.url ?? "/",
    `http://${req.headers.host || "localhost"}`,
  );

  // Match: POST /api/agents/:agentId/execute
  const match = url.pathname.match(/^\/api\/agents\/([^/]+)\/execute$/);
  if (!match) return false;

  if (req.method !== "POST") {
    sendMethodNotAllowed(res, "POST");
    return true;
  }

  // Auth (same pattern as openresponses-http.ts line 331)
  const token = getBearerToken(req);
  const authResult = await authorizeGatewayConnect({
    auth: opts.auth,
    connectAuth: { token, password: token },
    req,
    trustedProxies: opts.trustedProxies,
  });
  if (!authResult.ok) {
    sendUnauthorized(res);
    return true;
  }

  const agentId = decodeURIComponent(match[1]);

  // Read body
  const rawBody = await readJsonBodyOrError(req, res, 1024 * 1024); // 1MB max
  if (rawBody === undefined) return true; // readJsonBodyOrError already sent error

  const body = rawBody as ExecuteRequestBody;

  // Validate required fields
  if (
    !body.message ||
    !body.idempotencyKey ||
    !body.channelId ||
    !body.task?.taskId ||
    !body.task?.executionId
  ) {
    sendInvalidRequest(
      res,
      "Missing required fields: message, idempotencyKey, channelId, task.taskId, task.executionId",
    );
    return true;
  }

  // Idempotency check
  const cached = idempotencyCache.get(body.idempotencyKey);
  if (cached) {
    sendJson(res, 202, {
      runId: cached.runId,
      status: "accepted",
      acceptedAt: cached.acceptedAt,
    });
    return true;
  }

  const runId = randomUUID();
  const acceptedAt = Date.now();
  const sessionKey =
    body.sessionKey || `agent:${agentId}:task:${body.task.taskId}`;

  // Register run context with task metadata
  registerAgentRunContext(runId, {
    sessionKey,
    metadata: {
      source: "team9-task",
      taskId: body.task.taskId,
      executionId: body.task.executionId,
    },
  });

  // Register active run for stop support
  const abortController = new AbortController();
  registerActiveRun({
    runId,
    sessionKey,
    abortController,
    startedAt: acceptedAt,
  });

  // Fire-and-forget agent execution
  const deps = createDefaultDeps();
  void agentCommand(
    {
      message: body.message,
      sessionKey,
      runId,
      deliver: true,
      channel: "team9",
      to: `team9:${body.channelId}`,
      timeout: body.timeout?.toString(), // AgentCommandOpts.timeout is string type
      extraSystemPrompt: body.extraSystemPrompt,
      abortSignal: abortController.signal,
    },
    defaultRuntime,
    deps,
  )
    .catch((err: unknown) => {
      console.error(
        `[execute-http] agentCommand failed for run ${runId}:`,
        err,
      );
    })
    .finally(() => {
      removeActiveRun(runId);
    });

  // Cache idempotency entry
  idempotencyCache.set(body.idempotencyKey, { runId, acceptedAt });

  // Return 202 immediately
  sendJson(res, 202, { runId, status: "accepted", acceptedAt });
  return true;
}
```

**Key references for implementer:**

- Import patterns match `openresponses-http.ts`: `agentCommand` (line 14), `defaultRuntime` (line 16), `createDefaultDeps` (line 13), `authorizeGatewayConnect` (line 17)
- `AgentCommandOpts.timeout` is `string` type (see `src/commands/agent/types.ts` line 44) — hence `.toString()` conversion
- `authorizeGatewayConnect` takes a single object param (see `src/gateway/auth.ts` line 204) — NOT positional args
- If `abortSignal` is not in `AgentCommandOpts`, check if `agentCommand` accepts it as a separate parameter or if it needs to be passed via a different mechanism

- [ ] **Step 2: Verify no compilation errors**

Run: `cd /Users/jiangtao/Desktop/shenjingyuan/openclaw-hive/openclaw && npx tsc --noEmit src/gateway/execute-http.ts`

If there are type errors, check `src/commands/agent/types.ts` for the exact field names and types.

- [ ] **Step 3: Commit**

```bash
cd /Users/jiangtao/Desktop/shenjingyuan/openclaw-hive/openclaw
git add src/gateway/execute-http.ts
git commit -m "feat: add POST /api/agents/:agentId/execute HTTP endpoint"
```

---

## Task 4: Stop HTTP Endpoint (OpenClaw)

**Files:**

- Create: `/Users/jiangtao/Desktop/shenjingyuan/openclaw-hive/openclaw/src/gateway/stop-http.ts`

- [ ] **Step 1: Create stop-http.ts**

```typescript
// src/gateway/stop-http.ts

import type { IncomingMessage, ServerResponse } from "node:http";
import { authorizeGatewayConnect, type ResolvedGatewayAuth } from "./auth.js";
import {
  sendJson,
  sendUnauthorized,
  sendInvalidRequest,
  sendMethodNotAllowed,
  readJsonBodyOrError,
} from "./http-common.js";
import { getBearerToken } from "./http-utils.js";
import { abortBySessionKey } from "./active-runs.js";

export async function handleStopHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: { auth: ResolvedGatewayAuth; trustedProxies?: string[] },
): Promise<boolean> {
  const url = new URL(
    req.url ?? "/",
    `http://${req.headers.host || "localhost"}`,
  );

  // Match: POST /api/agents/:agentId/stop
  const match = url.pathname.match(/^\/api\/agents\/([^/]+)\/stop$/);
  if (!match) return false;

  if (req.method !== "POST") {
    sendMethodNotAllowed(res, "POST");
    return true;
  }

  // Auth
  const token = getBearerToken(req);
  const authResult = await authorizeGatewayConnect({
    auth: opts.auth,
    connectAuth: { token, password: token },
    req,
    trustedProxies: opts.trustedProxies,
  });
  if (!authResult.ok) {
    sendUnauthorized(res);
    return true;
  }

  // Read body
  const rawBody = await readJsonBodyOrError(req, res, 64 * 1024); // 64KB max
  if (rawBody === undefined) return true;

  const body = rawBody as { sessionKey?: string };
  if (!body.sessionKey) {
    sendInvalidRequest(res, "Missing required field: sessionKey");
    return true;
  }

  const aborted = abortBySessionKey(body.sessionKey);
  if (aborted) {
    sendJson(res, 200, { status: "stopped" });
  } else {
    sendJson(res, 404, { error: "No active run found for this session" });
  }

  return true;
}
```

- [ ] **Step 2: Verify no compilation errors**

Run: `cd /Users/jiangtao/Desktop/shenjingyuan/openclaw-hive/openclaw && npx tsc --noEmit src/gateway/stop-http.ts`

- [ ] **Step 3: Commit**

```bash
cd /Users/jiangtao/Desktop/shenjingyuan/openclaw-hive/openclaw
git add src/gateway/stop-http.ts
git commit -m "feat: add POST /api/agents/:agentId/stop HTTP endpoint"
```

---

## Task 5: Register endpoints in server-http.ts (OpenClaw)

**Files:**

- Modify: `/Users/jiangtao/Desktop/shenjingyuan/openclaw-hive/openclaw/src/gateway/server-http.ts`

- [ ] **Step 1: Add imports at the top of server-http.ts**

Near the existing imports (around lines 29-32):

```typescript
import { handleExecuteHttpRequest } from "./execute-http.js";
import { handleStopHttpRequest } from "./stop-http.js";
import { startActiveRunsSweep } from "./active-runs.js";
```

- [ ] **Step 2: Start the active runs sweep**

Near the server initialization (find where the HTTP server is created/started), add:

```typescript
startActiveRunsSweep();
```

- [ ] **Step 3: Add handlers to the request chain**

In the `handleRequest` function (around lines 234-299), add the execute and stop handlers **before** the OpenResponses handler but after plugin requests. Find the line with `if (openResponsesEnabled)` (around line 251) and add before it:

```typescript
// Task execute/stop endpoints
if (
  await handleExecuteHttpRequest(req, res, {
    auth: resolvedAuth,
    trustedProxies,
  })
)
  return;
if (
  await handleStopHttpRequest(req, res, { auth: resolvedAuth, trustedProxies })
)
  return;
```

- [ ] **Step 4: Verify no compilation errors**

Run: `cd /Users/jiangtao/Desktop/shenjingyuan/openclaw-hive/openclaw && npx tsc --noEmit src/gateway/server-http.ts`

- [ ] **Step 5: Commit**

```bash
cd /Users/jiangtao/Desktop/shenjingyuan/openclaw-hive/openclaw
git add src/gateway/server-http.ts
git commit -m "feat: register execute and stop HTTP handlers in gateway request chain"
```

---

## Task 6: Team9 Plugin Task Event Bridge (OpenClaw)

**Files:**

- Create: `/Users/jiangtao/Desktop/shenjingyuan/openclaw-hive/openclaw/extensions/team9/src/task-bridge.ts`
- Modify: `/Users/jiangtao/Desktop/shenjingyuan/openclaw-hive/openclaw/extensions/team9/src/channel.ts`

- [ ] **Step 1: Create task-bridge.ts**

```typescript
// extensions/team9/src/task-bridge.ts

import {
  onAgentEvent,
  getAgentRunContext,
  type AgentEventPayload,
} from "openclaw/plugin-sdk";

type TaskRunState = {
  taskId: string;
  executionId: string;
  stepIndex: number;
  currentToolName?: string;
};

type TaskMetadata = {
  source: string;
  taskId: string;
  executionId: string;
};

const RETRY_DELAY_MS = 1000;

async function callBotApi(
  baseUrl: string,
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/v1/bot/tasks${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      console.error(
        `[task-bridge] Bot API ${method} ${path} failed: ${res.status} ${res.statusText}`,
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[task-bridge] Bot API ${method} ${path} error:`, err);
    return false;
  }
}

async function callBotApiWithRetry(
  baseUrl: string,
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<void> {
  const ok = await callBotApi(baseUrl, token, method, path, body);
  if (!ok) {
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    await callBotApi(baseUrl, token, method, path, body);
  }
}

function handleTaskEvent(
  runStates: Map<string, TaskRunState>,
  metadata: TaskMetadata,
  event: AgentEventPayload,
  baseUrl: string,
  token: string,
): void {
  const { taskId } = metadata;
  const { runId, stream, data } = event;
  const phase = data?.phase as string | undefined;

  // Initialize run state on first event
  if (!runStates.has(runId)) {
    runStates.set(runId, {
      taskId: metadata.taskId,
      executionId: metadata.executionId,
      stepIndex: 0,
    });
  }

  const state = runStates.get(runId)!;

  if (stream === "lifecycle") {
    if (phase === "start") {
      // No-op — task is already in_progress
      return;
    }

    if (phase === "end") {
      void callBotApiWithRetry(baseUrl, token, "PATCH", `/${taskId}/status`, {
        status: "completed",
      });
      runStates.delete(runId);
      return;
    }

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
  }

  if (stream === "tool") {
    if (phase === "invoke") {
      const toolName =
        (data?.tool as string) || (data?.name as string) || "tool";
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
}

export function startTaskBridge(baseUrl: string, token: string): () => void {
  const runStates = new Map<string, TaskRunState>();

  const unsubscribe = onAgentEvent((event) => {
    const ctx = getAgentRunContext(event.runId);
    if (!ctx?.metadata) return;
    if (ctx.metadata.source !== "team9-task") return;

    handleTaskEvent(
      runStates,
      ctx.metadata as TaskMetadata,
      event,
      baseUrl,
      token,
    );
  });

  console.log("[task-bridge] Task event bridge started");
  return unsubscribe;
}
```

- [ ] **Step 2: Initialize task bridge in channel.ts**

In `/Users/jiangtao/Desktop/shenjingyuan/openclaw-hive/openclaw/extensions/team9/src/channel.ts`, add import at the top:

```typescript
import { startTaskBridge } from "./task-bridge.js";
```

Find the `startAccount` method (around line 557-581). Add the task bridge initialization after the connection is established. The bridge should be started once per plugin lifecycle, not per account. Add a module-level variable:

```typescript
// Near the top of channel.ts, after other module-level variables
let taskBridgeCleanup: (() => void) | null = null;
```

Inside `startAccount`, after `await getConnection(account, cfg)` succeeds (around line 576):

```typescript
// Start task bridge once (first account to start)
if (!taskBridgeCleanup && account.token && account.baseUrl) {
  taskBridgeCleanup = startTaskBridge(account.baseUrl, account.token);
}
```

In `stopAccount` (around line 583), after `if (activeConnections.size === 0)`:

```typescript
if (activeConnections.size === 0) {
  stopWatchdog();
  if (taskBridgeCleanup) {
    taskBridgeCleanup();
    taskBridgeCleanup = null;
  }
}
```

- [ ] **Step 3: Verify no compilation errors**

Run: `cd /Users/jiangtao/Desktop/shenjingyuan/openclaw-hive/openclaw && npx tsc --noEmit extensions/team9/src/task-bridge.ts extensions/team9/src/channel.ts`

- [ ] **Step 4: Commit**

```bash
cd /Users/jiangtao/Desktop/shenjingyuan/openclaw-hive/openclaw
git add extensions/team9/src/task-bridge.ts extensions/team9/src/channel.ts
git commit -m "feat: add task event bridge in Team9 plugin to translate agent events to Bot API"
```

---

## Task 7: OpenclawStrategy rewrite (Team9)

**Files:**

- Rewrite: `/Users/jiangtao/Desktop/shenjingyuan/team9/apps/server/apps/task-worker/src/executor/strategies/openclaw.strategy.ts`
- Update: `/Users/jiangtao/Desktop/shenjingyuan/team9/apps/server/apps/task-worker/src/executor/strategies/openclaw.strategy.spec.ts`

- [ ] **Step 1: Update existing tests — adjust execute() expectations**

The existing tests mock `fetch` and verify the POST URL. Update them to also expect a JSON body, Content-Type header, and Authorization header. Open `openclaw.strategy.spec.ts` and update the relevant test helpers and assertions.

Key changes to existing tests:

**a) Update `baseContext`** to include `taskcastTaskId` (now used by the implementation):

```typescript
const baseContext: ExecutionContext = {
  taskId: "task-001",
  executionId: "exec-001",
  botId: "bot-001",
  channelId: "ch-001",
  taskcastTaskId: "agent_task_exec_exec-001",
};
```

**b) Update `makeBot` helper** to include `gateway_token` in secrets:

```typescript
function makeBot(opts: {
  agentId?: string;
  accessUrl?: string;
  nestedAccessUrl?: string;
  gatewayToken?: string;
}) {
  const extra = opts.agentId ? { openclaw: { agentId: opts.agentId } } : {};
  const secrets: Record<string, any> = {};
  if (opts.accessUrl) {
    secrets.instanceResult = {
      access_url: opts.accessUrl,
      gateway_token: opts.gatewayToken ?? "test-gw-token",
    };
  } else if (opts.nestedAccessUrl) {
    secrets.instanceResult = {
      instance: { access_url: opts.nestedAccessUrl },
      gateway_token: opts.gatewayToken ?? "test-gw-token",
    };
  }
  return { extra, secrets };
}
```

**c) Update error message assertions** — the new implementation drops agent name from error:

```typescript
// BEFORE:
"OpenClaw execute failed for agent default (502): upstream timeout";
// AFTER:
"OpenClaw execute failed (502): upstream timeout";

// BEFORE:
"OpenClaw execute failed for agent default (500): Internal Server Error";
// AFTER:
"OpenClaw execute failed (500): Internal Server Error";
```

**d) Update fetch call assertions** — the new implementation sends body, headers, and signal:

```typescript
// BEFORE (tests checking just method):
expect(mockFetch).toHaveBeenCalledWith(expect.anything(), {
  method: "POST",
});

// AFTER (verify full options):
expect(mockFetch).toHaveBeenCalledWith(
  expect.anything(),
  expect.objectContaining({
    method: "POST",
    headers: expect.objectContaining({
      "Content-Type": "application/json",
      Authorization: "Bearer test-gw-token",
    }),
    body: expect.any(String),
    signal: expect.any(AbortSignal),
  }),
);
```

**e) Verify body content** in at least one test:

```typescript
const callOpts = mockFetch.mock.calls[0]![1] as RequestInit;
const parsedBody = JSON.parse(callOpts.body as string);
expect(parsedBody).toEqual(
  expect.objectContaining({
    channelId: "ch-001",
    task: { taskId: "task-001", executionId: "exec-001" },
  }),
);
```

- [ ] **Step 2: Add new tests for stop()**

Add to the test file:

```typescript
describe("stop()", () => {
  it("should POST to /api/agents/{agentId}/stop with sessionKey", async () => {
    resetDbChain([makeBot({ accessUrl: "https://oc.test", agentId: "mybot" })]);
    mockFetch.mockResolvedValueOnce(new Response("", { status: 200 }));

    await strategy.stop(baseContext);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        href: "https://oc.test/api/agents/mybot/stop",
      }),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"sessionKey"'),
      }),
    );
  });

  it("should not throw if stop returns 404 (run already finished)", async () => {
    resetDbChain([makeBot({ accessUrl: "https://oc.test" })]);
    mockFetch.mockResolvedValueOnce(new Response("Not found", { status: 404 }));

    // stop() should not throw on 404 — the run is already done
    await expect(strategy.stop(baseContext)).resolves.not.toThrow();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /Users/jiangtao/Desktop/shenjingyuan/team9 && pnpm --filter task-worker test -- --testPathPattern=openclaw.strategy`

Expected: Tests fail because the implementation hasn't been updated yet.

- [ ] **Step 4: Rewrite openclaw.strategy.ts**

Replace the entire file content:

```typescript
import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  DATABASE_CONNECTION,
  eq,
  type PostgresJsDatabase,
} from "@team9/database";
import * as schema from "@team9/database/schemas";
import type {
  ExecutionStrategy,
  ExecutionContext,
} from "../execution-strategy.interface.js";

type OpenclawConfig = {
  agentId: string;
  openclawUrl: string;
  gatewayToken: string | undefined;
};

@Injectable()
export class OpenclawStrategy implements ExecutionStrategy {
  private readonly logger = new Logger(OpenclawStrategy.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async execute(context: ExecutionContext): Promise<void> {
    this.logger.log(`Starting OpenClaw agent for task ${context.taskId}`);

    const { agentId, openclawUrl, gatewayToken } =
      await this.resolveOpenclawConfig(context.botId);

    const body = {
      message: context.documentContent ?? "Execute this task",
      idempotencyKey: context.taskcastTaskId ?? `exec_${context.executionId}`,
      sessionKey: `agent:${agentId}:task:${context.taskId}`,
      channelId: context.channelId,
      timeout: 86400,
      task: {
        taskId: context.taskId,
        executionId: context.executionId,
      },
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (gatewayToken) {
      headers["Authorization"] = `Bearer ${gatewayToken}`;
    } else {
      this.logger.warn(
        `No gateway token for bot ${context.botId}, sending without auth`,
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);

    try {
      const response = await fetch(
        new URL(
          `/api/agents/${encodeURIComponent(agentId)}/execute`,
          openclawUrl,
        ),
        {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `OpenClaw execute failed (${response.status}): ${errorText || response.statusText}`,
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }

  async pause(context: ExecutionContext): Promise<void> {
    this.logger.warn(
      `Pause not yet supported for task ${context.taskId} — OpenClaw does not support agent checkpointing`,
    );
  }

  async resume(context: ExecutionContext): Promise<void> {
    this.logger.warn(
      `Resume not yet supported for task ${context.taskId} — OpenClaw does not support agent checkpointing`,
    );
  }

  async stop(context: ExecutionContext): Promise<void> {
    this.logger.log(`Stopping OpenClaw agent for task ${context.taskId}`);

    const { agentId, openclawUrl, gatewayToken } =
      await this.resolveOpenclawConfig(context.botId);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (gatewayToken) {
      headers["Authorization"] = `Bearer ${gatewayToken}`;
    }

    try {
      await fetch(
        new URL(`/api/agents/${encodeURIComponent(agentId)}/stop`, openclawUrl),
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            sessionKey: `agent:${agentId}:task:${context.taskId}`,
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );
      // Don't throw on non-2xx — the run may have already finished
    } catch (error) {
      this.logger.warn(
        `Failed to stop OpenClaw agent for task ${context.taskId}: ${error}`,
      );
    }
  }

  private async resolveOpenclawConfig(botId: string): Promise<OpenclawConfig> {
    const [bot] = await this.db
      .select({
        extra: schema.bots.extra,
        secrets: schema.installedApplications.secrets,
      })
      .from(schema.bots)
      .leftJoin(
        schema.installedApplications,
        eq(schema.installedApplications.id, schema.bots.installedApplicationId),
      )
      .where(eq(schema.bots.id, botId))
      .limit(1);

    if (!bot) {
      throw new Error(`OpenClaw bot not found: ${botId}`);
    }

    const agentId =
      (bot.extra as Record<string, any>)?.openclaw?.agentId ?? "default";

    const secrets = bot.secrets as Record<string, any> | null;
    const instanceResult = secrets?.instanceResult;
    const openclawUrl =
      instanceResult?.access_url ?? instanceResult?.instance?.access_url;

    if (!openclawUrl) {
      throw new Error(`OpenClaw URL not configured for bot ${botId}`);
    }

    const gatewayToken: string | undefined =
      instanceResult?.gateway_token ?? instanceResult?.instance?.gateway_token;

    return { agentId, openclawUrl, gatewayToken };
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/jiangtao/Desktop/shenjingyuan/team9 && pnpm --filter task-worker test -- --testPathPattern=openclaw.strategy`

Expected: All tests pass. If some fail, adjust the test expectations to match the new implementation (e.g., the `makeBot` helper producing the right secrets shape).

- [ ] **Step 6: Commit**

```bash
cd /Users/jiangtao/Desktop/shenjingyuan/team9
git add apps/server/apps/task-worker/src/executor/strategies/openclaw.strategy.ts apps/server/apps/task-worker/src/executor/strategies/openclaw.strategy.spec.ts
git commit -m "feat: rewrite OpenclawStrategy with proper body, auth, timeout, and stop support"
```

---

## Task 8: ExecutorService.stopExecution + Consumer wiring (Team9)

**Files:**

- Modify: `/Users/jiangtao/Desktop/shenjingyuan/team9/apps/server/apps/task-worker/src/executor/executor.service.ts`
- Modify: `/Users/jiangtao/Desktop/shenjingyuan/team9/apps/server/apps/task-worker/src/consumer/task-command.consumer.ts`

- [ ] **Step 1: Add stopExecution() to ExecutorService**

In `executor.service.ts`, add this method after `triggerExecution()` (before `markExecutionFailed()`):

```typescript
  /**
   * Stop the currently active execution for the given task.
   */
  async stopExecution(taskId: string): Promise<void> {
    // 1. Load task
    const [task] = await this.db
      .select()
      .from(schema.agentTasks)
      .where(eq(schema.agentTasks.id, taskId))
      .limit(1);

    if (!task) {
      this.logger.error(`Task not found for stop: ${taskId}`);
      return;
    }

    if (!task.currentExecutionId) {
      this.logger.warn(`Task ${taskId} has no active execution to stop`);
      return;
    }

    if (!task.botId) {
      this.logger.error(`Task ${taskId} has no bot assigned`);
      return;
    }

    // 2. Load execution
    const [execution] = await this.db
      .select()
      .from(schema.agentTaskExecutions)
      .where(eq(schema.agentTaskExecutions.id, task.currentExecutionId))
      .limit(1);

    if (!execution) {
      this.logger.error(`Execution ${task.currentExecutionId} not found`);
      return;
    }

    // 3. Look up bot type → get strategy
    const [bot] = await this.db
      .select({ type: schema.bots.type })
      .from(schema.bots)
      .where(eq(schema.bots.id, task.botId))
      .limit(1);

    if (!bot) {
      this.logger.error(`Bot not found: ${task.botId}`);
      return;
    }

    const strategy = this.strategies.get(bot.type);
    if (!strategy) {
      this.logger.error(`No strategy for bot type "${bot.type}"`);
      return;
    }

    // 4. Call strategy.stop()
    const context: ExecutionContext = {
      taskId,
      executionId: execution.id,
      botId: task.botId,
      channelId: execution.channelId,
      taskcastTaskId: execution.taskcastTaskId,
    };

    try {
      await strategy.stop(context);
    } catch (error) {
      this.logger.warn(
        `Strategy stop failed for task ${taskId}: ${error}`,
      );
    }

    // 5. Update execution + task status to stopped
    const now = new Date();

    await this.db
      .update(schema.agentTaskExecutions)
      .set({
        status: 'stopped',
        completedAt: now,
        ...(execution.startedAt
          ? {
              duration: Math.round(
                (now.getTime() - execution.startedAt.getTime()) / 1000,
              ),
            }
          : {}),
      })
      .where(eq(schema.agentTaskExecutions.id, execution.id));

    await this.db
      .update(schema.agentTasks)
      .set({
        status: 'stopped',
        updatedAt: now,
      })
      .where(eq(schema.agentTasks.id, taskId));

    this.logger.log(`Execution ${execution.id} stopped for task ${taskId}`);
  }
```

- [ ] **Step 2: Wire stop command in TaskCommandConsumer**

In `task-command.consumer.ts`, replace the stop case (around line 91-95):

```typescript
        case 'stop':
          await this.executor.stopExecution(command.taskId);
          break;
```

Leave pause and resume as warnings (unchanged).

- [ ] **Step 3: Verify compilation**

Run: `cd /Users/jiangtao/Desktop/shenjingyuan/team9 && pnpm --filter task-worker build`

If the `execution.channelId` field doesn't exist on the execution type, check the schema. It should be present based on `agentTaskExecutions` schema. If `execution.taskcastTaskId` causes a type error, check the field name in the schema.

- [ ] **Step 4: Run all task-worker tests**

Run: `cd /Users/jiangtao/Desktop/shenjingyuan/team9 && pnpm --filter task-worker test`

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/jiangtao/Desktop/shenjingyuan/team9
git add apps/server/apps/task-worker/src/executor/executor.service.ts apps/server/apps/task-worker/src/consumer/task-command.consumer.ts
git commit -m "feat: add stopExecution to ExecutorService, wire stop command in consumer"
```

---

## Task 9: Smoke test and final verification

- [ ] **Step 1: Verify OpenClaw builds**

Run: `cd /Users/jiangtao/Desktop/shenjingyuan/openclaw-hive/openclaw && pnpm build` (or the project's build command)

Fix any compilation errors.

- [ ] **Step 2: Verify Team9 builds**

Run: `cd /Users/jiangtao/Desktop/shenjingyuan/team9 && pnpm build:server`

Fix any compilation errors.

- [ ] **Step 3: Verify Team9 tests pass**

Run: `cd /Users/jiangtao/Desktop/shenjingyuan/team9 && pnpm --filter task-worker test`

- [ ] **Step 4: Final commit (if any fixes needed)**

```bash
git add -A && git commit -m "fix: address build/test issues from integration"
```
