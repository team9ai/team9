# Agent Session Bound Channel Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a right-side Team9 channel panel that resolves the bound agent-pi session, loads sanitized session component data, and live-patches the UI from `component_data_snapshot` SSE events.

**Architecture:** The gateway owns authorization and binding resolution, then proxies a safe projection of agent-pi session components/events. The client loads the binding and initial component snapshot through React Query, opens an authenticated EventSource to the gateway, and directly patches component rows on snapshot events.

**Tech Stack:** NestJS 11, Drizzle ORM, `@team9/claw-hive`, Express SSE proxying, React 19, TanStack React Query, Vitest, Jest.

---

## File Structure

Backend files:

- Create `apps/server/apps/gateway/src/im/agent-sessions/agent-session.types.ts`: shared response/event/component types for gateway endpoints.
- Create `apps/server/apps/gateway/src/im/agent-sessions/agent-session-redaction.ts`: recursive sensitive-key redaction and safe component projection.
- Create `apps/server/apps/gateway/src/im/agent-sessions/agent-session-redaction.spec.ts`: unit tests for redaction and event filtering.
- Create `apps/server/apps/gateway/src/im/agent-sessions/agent-session-binding.service.ts`: `channelId -> agent-pi session` resolver.
- Create `apps/server/apps/gateway/src/im/agent-sessions/agent-session-binding.service.spec.ts`: resolver unit tests.
- Create `apps/server/apps/gateway/src/im/agent-sessions/agent-session.controller.ts`: binding, components, and SSE endpoints.
- Create `apps/server/apps/gateway/src/im/agent-sessions/agent-session.controller.spec.ts`: controller/proxy tests.
- Create `apps/server/apps/gateway/src/im/agent-sessions/agent-sessions.module.ts`: Nest module wiring.
- Modify `apps/server/apps/gateway/src/im/im.module.ts`: import/export `AgentSessionsModule`.
- Modify `apps/server/libs/claw-hive/src/claw-hive.service.ts`: add typed wrappers for session status and components.
- Modify `apps/server/libs/claw-hive/src/claw-hive.service.spec.ts`: wrapper tests.

Frontend files:

- Modify `apps/client/src/types/im.ts`: add agent-session binding, component, and event types.
- Modify `apps/client/src/services/api/im.ts`: add `getAgentSession` and `getAgentSessionComponents`.
- Create `apps/client/src/hooks/useChannelAgentSession.ts`: binding/status query hook.
- Create `apps/client/src/hooks/useAgentSessionComponents.ts`: component query + authenticated SSE + direct cache patch.
- Create `apps/client/src/hooks/__tests__/useAgentSessionComponents.test.tsx`: hook tests for direct cache patch/reconnect.
- Create `apps/client/src/components/channel/agent-session/AgentSessionPanel.tsx`: panel shell.
- Create `apps/client/src/components/channel/agent-session/AgentSessionStatusHeader.tsx`: status summary.
- Create `apps/client/src/components/channel/agent-session/SessionComponentList.tsx`: component list.
- Create `apps/client/src/components/channel/agent-session/SessionComponentRow.tsx`: collapsible JSON row.
- Create `apps/client/src/components/channel/agent-session/TaskContextSection.tsx`: routine execution context.
- Create `apps/client/src/components/channel/agent-session/TrackingContextSection.tsx`: tracking context.
- Create `apps/client/src/components/channel/agent-session/__tests__/AgentSessionPanel.test.tsx`: panel rendering tests.
- Modify `apps/client/src/components/channel/ChannelView.tsx`: mount panel and include it in snap-width calculations.
- Create `apps/client/src/components/channel/__tests__/ChannelView.agentSessionPanel.test.tsx`: integration tests with mocked panel/hooks.

Do not modify the unrelated current worktree changes in `apps/client/src/hooks/useTrackingChannel.ts`, `apps/client/src/components/channel/LongTextCollapse.tsx`, or `apps/client/src/hooks/__tests__/useTrackingChannel.test.tsx` unless a later user message explicitly brings them into scope.

---

### Task 1: Add ClawHive Component/Status Wrappers

**Files:**

- Modify: `apps/server/libs/claw-hive/src/claw-hive.service.ts`
- Modify: `apps/server/libs/claw-hive/src/claw-hive.service.spec.ts`

- [ ] **Step 1: Add failing service tests**

Append tests to `apps/server/libs/claw-hive/src/claw-hive.service.spec.ts` near the existing session tests:

```ts
describe("session component and status helpers", () => {
  it("GETs session components with tenant header", async () => {
    const body = {
      sessionId: "team9/tenant/agent/dm/channel",
      components: [
        {
          id: "persona",
          typeKey: "persona",
          runtimeInjectedOnly: false,
          effectiveConfig: {},
          latestData: {
            data: { mood: "focused" },
            capturedAtCallId: "call-1",
            capturedAt: 1700000000000,
          },
        },
      ],
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await service.getSessionComponents(
      "team9/tenant/agent/dm/channel",
      "tenant-123",
    );

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://test-hive:9999/api/sessions/team9%2Ftenant%2Fagent%2Fdm%2Fchannel/components",
      {
        method: "GET",
        headers: expect.objectContaining({
          "X-Hive-Auth": "test-token",
          "X-Hive-Tenant": "tenant-123",
        }),
      },
    );
  });

  it("returns null when session components are missing", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "missing" }, 404));

    await expect(service.getSessionComponents("missing")).resolves.toBeNull();
  });

  it("GETs session status", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        sessionId: "s1",
        isStreaming: false,
        queueLength: 2,
        ownedBy: "worker-1",
      }),
    );

    await expect(service.getSessionStatus("s1")).resolves.toEqual({
      sessionId: "s1",
      isStreaming: false,
      queueLength: 2,
      ownedBy: "worker-1",
    });
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
NODE_OPTIONS='--experimental-vm-modules' pnpm --dir apps/server exec jest --config libs/claw-hive/jest.config.cjs claw-hive.service.spec.ts
```

Expected: FAIL with TypeScript errors that `getSessionComponents` and `getSessionStatus` do not exist.

- [ ] **Step 3: Add exported wrapper types and methods**

In `apps/server/libs/claw-hive/src/claw-hive.service.ts`, add near `HiveSessionDetail`:

```ts
export interface HiveSessionComponentItem {
  id: string;
  typeKey: string;
  priority?: number;
  declaredConfig?: Record<string, unknown>;
  effectiveConfig: Record<string, unknown>;
  schema?: unknown[];
  runtimeInjectedOnly: boolean;
  latestData: {
    data: Record<string, unknown>;
    capturedAtCallId: string | null;
    capturedAt: number;
  } | null;
}

export interface HiveSessionComponentsResponse {
  sessionId: string;
  components: HiveSessionComponentItem[];
}

export interface HiveSessionStatusResponse {
  sessionId: string;
  isStreaming: boolean;
  queueLength: number;
  ownedBy: string | null;
}
```

Add methods after `getSession`:

```ts
async getSessionComponents(
  sessionId: string,
  tenantId?: string,
): Promise<HiveSessionComponentsResponse | null> {
  const res = await fetch(
    `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/components`,
    { method: 'GET', headers: this.headers(tenantId) },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get session components: ${res.status} ${text}`);
  }
  return res.json() as Promise<HiveSessionComponentsResponse>;
}

async getSessionStatus(
  sessionId: string,
  tenantId?: string,
): Promise<HiveSessionStatusResponse | null> {
  const res = await fetch(
    `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/status`,
    { method: 'GET', headers: this.headers(tenantId) },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get session status: ${res.status} ${text}`);
  }
  return res.json() as Promise<HiveSessionStatusResponse>;
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
NODE_OPTIONS='--experimental-vm-modules' pnpm --dir apps/server exec jest --config libs/claw-hive/jest.config.cjs claw-hive.service.spec.ts
```

Expected: PASS for `claw-hive.service.spec.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/server/libs/claw-hive/src/claw-hive.service.ts apps/server/libs/claw-hive/src/claw-hive.service.spec.ts
git commit -m "feat: add claw hive session component helpers"
```

---

### Task 2: Add Agent Session Types and Redaction Helpers

**Files:**

- Create: `apps/server/apps/gateway/src/im/agent-sessions/agent-session.types.ts`
- Create: `apps/server/apps/gateway/src/im/agent-sessions/agent-session-redaction.ts`
- Create: `apps/server/apps/gateway/src/im/agent-sessions/agent-session-redaction.spec.ts`

- [ ] **Step 1: Write failing redaction tests**

Create `apps/server/apps/gateway/src/im/agent-sessions/agent-session-redaction.spec.ts`:

```ts
import { describe, expect, it } from "@jest/globals";
import {
  filterAgentSessionEvent,
  projectSafeComponents,
  redactSensitiveValue,
} from "./agent-session-redaction.js";

describe("agent session redaction", () => {
  it("redacts sensitive object keys recursively", () => {
    expect(
      redactSensitiveValue({
        token: "abc",
        nested: { apiKey: "def", keep: "visible" },
        list: [{ password: "ghi" }, { ok: true }],
      }),
    ).toEqual({
      token: "[redacted]",
      nested: { apiKey: "[redacted]", keep: "visible" },
      list: [{ password: "[redacted]" }, { ok: true }],
    });
  });

  it("strips component configs and keeps redacted latest data", () => {
    expect(
      projectSafeComponents({
        sessionId: "s1",
        components: [
          {
            id: "persona",
            typeKey: "persona",
            declaredConfig: { token: "secret" },
            effectiveConfig: { token: "secret" },
            runtimeInjectedOnly: false,
            latestData: {
              data: { mood: "calm", credential: "raw" },
              capturedAtCallId: "call-1",
              capturedAt: 123,
            },
          },
        ],
      }),
    ).toEqual({
      sessionId: "s1",
      components: [
        {
          id: "persona",
          typeKey: "persona",
          runtimeInjectedOnly: false,
          latestData: {
            data: { mood: "calm", credential: "[redacted]" },
            capturedAtCallId: "call-1",
            capturedAt: 123,
          },
        },
      ],
    });
  });

  it("allows component snapshots after redacting payload data", () => {
    expect(
      filterAgentSessionEvent({
        type: "component_data_snapshot",
        sessionId: "s1",
        timestamp: 456,
        turnIndex: 1,
        components: [
          { componentId: "host", data: { authorization: "Bearer x" } },
        ],
      }),
    ).toEqual({
      type: "component_data_snapshot",
      sessionId: "s1",
      timestamp: 456,
      turnIndex: 1,
      components: [
        { componentId: "host", data: { authorization: "[redacted]" } },
      ],
    });
  });

  it("drops non-allowlisted events", () => {
    expect(
      filterAgentSessionEvent({
        type: "tool_execution_start",
        sessionId: "s1",
        timestamp: 1,
        args: { token: "raw" },
      }),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm --filter @team9/gateway test -- agent-session-redaction.spec.ts
```

Expected: FAIL because the helper files do not exist.

- [ ] **Step 3: Add shared types**

Create `apps/server/apps/gateway/src/im/agent-sessions/agent-session.types.ts`:

```ts
export type AgentSessionBindingKind =
  | "dm"
  | "routine-creation"
  | "topic-session"
  | "routine-execution"
  | "tracking";

export type AgentSessionUnsupportedReason =
  | "no_bot"
  | "not_hive_managed"
  | "session_not_created";

export interface AgentSessionStatus {
  exists: boolean;
  status?: "active" | "disposed";
  ownedBy?: string | null;
  queueLength?: number;
  activityState?: "active" | "inactive";
  unavailableReason?: "not_found" | "agent_pi_unavailable";
}

export interface AgentSessionBindingResponse {
  channelId: string;
  channelType: string;
  kind: AgentSessionBindingKind | null;
  supported: boolean;
  unsupportedReason?: AgentSessionUnsupportedReason;
  tenantId: string | null;
  agentId: string | null;
  botUserId: string | null;
  sessionId: string | null;
  routineId?: string;
  executionId?: string;
  taskcastTaskId?: string | null;
  taskStatus?: string;
  status?: AgentSessionStatus;
}

export interface SafeSessionComponentItem {
  id: string;
  typeKey: string;
  priority?: number;
  runtimeInjectedOnly: boolean;
  schema?: unknown[];
  latestData: {
    data: Record<string, unknown>;
    capturedAtCallId: string | null;
    capturedAt: number;
  } | null;
}

export interface SafeSessionComponentsResponse {
  sessionId: string;
  components: SafeSessionComponentItem[];
}
```

- [ ] **Step 4: Add redaction helpers**

Create `apps/server/apps/gateway/src/im/agent-sessions/agent-session-redaction.ts`:

```ts
import type { HiveSessionComponentsResponse } from "@team9/claw-hive";
import type { SafeSessionComponentsResponse } from "./agent-session.types.js";

const SENSITIVE_KEY_PATTERN =
  /(^|[_-])(token|secret|password|apikey|api_key|authorization|credential)([_-]|$)/i;

const ALLOWED_EVENT_TYPES = new Set([
  "agent_start",
  "agent_end",
  "run_start",
  "run_end",
  "worker_release",
  "component_data_snapshot",
  "model_change",
  "thinking_level_change",
  "a2ui_surface_update",
  "a2ui_surface_delete",
]);

export function redactSensitiveValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveValue(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key)
        ? "[redacted]"
        : redactSensitiveValue(item),
    ]),
  );
}

export function projectSafeComponents(
  response: HiveSessionComponentsResponse,
): SafeSessionComponentsResponse {
  return {
    sessionId: response.sessionId,
    components: response.components.map((component) => ({
      id: component.id,
      typeKey: component.typeKey,
      ...(component.priority !== undefined && { priority: component.priority }),
      runtimeInjectedOnly: component.runtimeInjectedOnly,
      ...(component.schema !== undefined && { schema: component.schema }),
      latestData: component.latestData
        ? {
            ...component.latestData,
            data: redactSensitiveValue(component.latestData.data) as Record<
              string,
              unknown
            >,
          }
        : null,
    })),
  };
}

export function filterAgentSessionEvent(
  event: Record<string, unknown>,
): Record<string, unknown> | null {
  const type = typeof event.type === "string" ? event.type : null;
  if (!type || !ALLOWED_EVENT_TYPES.has(type)) return null;

  if (type !== "component_data_snapshot") return event;

  const components = Array.isArray(event.components)
    ? event.components.map((component) => {
        const row = component as Record<string, unknown>;
        return {
          ...row,
          data: redactSensitiveValue(row.data) as Record<string, unknown>,
        };
      })
    : [];

  return { ...event, components };
}
```

- [ ] **Step 5: Run the focused test and verify it passes**

Run:

```bash
pnpm --filter @team9/gateway test -- agent-session-redaction.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/apps/gateway/src/im/agent-sessions/agent-session.types.ts apps/server/apps/gateway/src/im/agent-sessions/agent-session-redaction.ts apps/server/apps/gateway/src/im/agent-sessions/agent-session-redaction.spec.ts
git commit -m "feat: add safe agent session projections"
```

---

### Task 3: Implement Agent Session Binding Resolver

**Files:**

- Create: `apps/server/apps/gateway/src/im/agent-sessions/agent-session-binding.service.ts`
- Create: `apps/server/apps/gateway/src/im/agent-sessions/agent-session-binding.service.spec.ts`

- [ ] **Step 1: Write resolver tests**

Create `apps/server/apps/gateway/src/im/agent-sessions/agent-session-binding.service.spec.ts` with a queue-backed mock DB so each `limit()` result can be controlled:

```ts
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, beforeEach, jest } from "@jest/globals";
import { AgentSessionBindingService } from "./agent-session-binding.service.js";

type MockFn = jest.Mock<(...args: any[]) => any>;

function createDbMock() {
  const rows: unknown[][] = [];
  const chain: Record<string, MockFn> = {};
  for (const method of [
    "select",
    "from",
    "where",
    "limit",
    "innerJoin",
    "leftJoin",
  ]) {
    chain[method] = jest.fn<any>().mockReturnValue(chain);
  }
  chain.limit.mockImplementation(() => Promise.resolve(rows.shift() ?? []));
  return {
    db: chain,
    push: (result: unknown[]) => rows.push(result),
  };
}

describe("AgentSessionBindingService", () => {
  let dbMock: ReturnType<typeof createDbMock>;
  let service: AgentSessionBindingService;

  beforeEach(() => {
    dbMock = createDbMock();
    service = new AgentSessionBindingService(dbMock.db as any);
  });

  it("throws 404 when the channel does not exist", async () => {
    dbMock.push([]);

    await expect(service.resolve("channel-1", "user-1")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("throws 403 when the user is not a channel member", async () => {
    dbMock.push([{ id: "channel-1", tenantId: "tenant-1", type: "direct" }]);
    dbMock.push([]);

    await expect(service.resolve("channel-1", "user-1")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("derives a direct bot DM session id", async () => {
    dbMock.push([{ id: "channel-1", tenantId: "tenant-1", type: "direct" }]);
    dbMock.push([{ id: "member-1" }]);
    dbMock.push([
      {
        botUserId: "bot-user-1",
        managedProvider: "hive",
        managedMeta: { agentId: "agent-1" },
      },
    ]);

    await expect(service.resolve("channel-1", "user-1")).resolves.toMatchObject(
      {
        channelId: "channel-1",
        kind: "dm",
        supported: true,
        agentId: "agent-1",
        botUserId: "bot-user-1",
        sessionId: "team9/tenant-1/agent-1/dm/channel-1",
      },
    );
  });

  it("prefers topic-session propertySettings session id", async () => {
    dbMock.push([
      {
        id: "topic-1",
        tenantId: "tenant-1",
        type: "topic-session",
        propertySettings: {
          topicSession: {
            agentId: "agent-from-settings",
            sessionId: "team9/tenant-1/agent-from-settings/dm/topic-1",
          },
        },
      },
    ]);
    dbMock.push([{ id: "member-1" }]);
    dbMock.push([
      {
        botUserId: "bot-user-1",
        managedProvider: "hive",
        managedMeta: { agentId: "agent-from-bot" },
      },
    ]);

    await expect(service.resolve("topic-1", "user-1")).resolves.toMatchObject({
      kind: "topic-session",
      agentId: "agent-from-settings",
      sessionId: "team9/tenant-1/agent-from-settings/dm/topic-1",
    });
  });

  it("resolves a Hive routine execution task channel", async () => {
    dbMock.push([{ id: "task-channel", tenantId: "tenant-1", type: "task" }]);
    dbMock.push([{ id: "member-1" }]);
    dbMock.push([
      {
        executionId: "exec-1",
        routineId: "routine-1",
        taskcastTaskId: "agent_task_exec_exec-1",
        taskStatus: "in_progress",
        botUserId: "bot-user-1",
        managedProvider: "hive",
        managedMeta: { agentId: "agent-1" },
      },
    ]);

    await expect(
      service.resolve("task-channel", "user-1"),
    ).resolves.toMatchObject({
      kind: "routine-execution",
      supported: true,
      sessionId: "team9/tenant-1/agent-1/routine/exec-1",
      routineId: "routine-1",
      executionId: "exec-1",
      taskcastTaskId: "agent_task_exec_exec-1",
    });
  });

  it("returns unsupported for OpenClaw task channel", async () => {
    dbMock.push([{ id: "task-channel", tenantId: "tenant-1", type: "task" }]);
    dbMock.push([{ id: "member-1" }]);
    dbMock.push([
      {
        executionId: "exec-1",
        routineId: "routine-1",
        taskStatus: "in_progress",
        botUserId: "bot-user-1",
        managedProvider: "openclaw",
        managedMeta: { instanceId: "instance-1" },
      },
    ]);

    await expect(
      service.resolve("task-channel", "user-1"),
    ).resolves.toMatchObject({
      supported: false,
      unsupportedReason: "not_hive_managed",
      sessionId: null,
    });
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm --filter @team9/gateway test -- agent-session-binding.service.spec.ts
```

Expected: FAIL because `AgentSessionBindingService` does not exist.

- [ ] **Step 3: Implement the resolver**

Create `apps/server/apps/gateway/src/im/agent-sessions/agent-session-binding.service.ts`:

```ts
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DATABASE_CONNECTION, schema } from "@team9/database";
import { Inject } from "@nestjs/common";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type {
  AgentSessionBindingKind,
  AgentSessionBindingResponse,
  AgentSessionUnsupportedReason,
} from "./agent-session.types.js";

type ChannelRow = Pick<
  schema.Channel,
  "id" | "tenantId" | "type" | "propertySettings"
>;

interface BotBindingRow {
  botUserId: string;
  managedProvider: string | null;
  managedMeta: schema.ManagedMeta | null;
}

@Injectable()
export class AgentSessionBindingService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async resolve(
    channelId: string,
    userId: string,
  ): Promise<AgentSessionBindingResponse> {
    const channel = await this.getChannel(channelId);
    await this.assertMembership(channelId, userId);

    switch (channel.type) {
      case "direct":
        return this.resolveBotChannel(channel, "dm");
      case "routine-session":
        return this.resolveRoutineSession(channel);
      case "topic-session":
        return this.resolveTopicSession(channel);
      case "task":
        return this.resolveTaskChannel(channel);
      case "tracking":
        return this.resolveBotChannel(channel, "tracking");
      default:
        return this.unsupported(channel, null, "no_bot");
    }
  }

  private async getChannel(channelId: string): Promise<ChannelRow> {
    const [channel] = await this.db
      .select({
        id: schema.channels.id,
        tenantId: schema.channels.tenantId,
        type: schema.channels.type,
        propertySettings: schema.channels.propertySettings,
      })
      .from(schema.channels)
      .where(eq(schema.channels.id, channelId))
      .limit(1);
    if (!channel) throw new NotFoundException("Channel not found");
    return channel;
  }

  private async assertMembership(
    channelId: string,
    userId: string,
  ): Promise<void> {
    const [member] = await this.db
      .select({ id: schema.channelMembers.id })
      .from(schema.channelMembers)
      .where(
        and(
          eq(schema.channelMembers.channelId, channelId),
          eq(schema.channelMembers.userId, userId),
        ),
      )
      .limit(1);
    if (!member) throw new ForbiddenException("Not a channel member");
  }

  private tenantSegment(channel: ChannelRow): string {
    return channel.tenantId ?? "";
  }

  private buildSessionId(
    channel: ChannelRow,
    agentId: string,
    scope: "dm" | "tracking" | "routine",
    scopeId: string,
  ): string {
    return `team9/${this.tenantSegment(channel)}/${agentId}/${scope}/${scopeId}`;
  }

  private async findHiveBot(channelId: string): Promise<BotBindingRow | null> {
    const [bot] = await this.db
      .select({
        botUserId: schema.bots.userId,
        managedProvider: schema.bots.managedProvider,
        managedMeta: schema.bots.managedMeta,
      })
      .from(schema.channelMembers)
      .innerJoin(
        schema.bots,
        eq(schema.bots.userId, schema.channelMembers.userId),
      )
      .where(eq(schema.channelMembers.channelId, channelId))
      .limit(1);
    return bot ?? null;
  }

  private botAgentId(bot: BotBindingRow | null): string | null {
    if (!bot || bot.managedProvider !== "hive") return null;
    return typeof bot.managedMeta?.agentId === "string"
      ? bot.managedMeta.agentId
      : null;
  }

  private unsupported(
    channel: ChannelRow,
    bot: BotBindingRow | null,
    reason: AgentSessionUnsupportedReason,
  ): AgentSessionBindingResponse {
    return {
      channelId: channel.id,
      channelType: channel.type,
      kind: null,
      supported: false,
      unsupportedReason: reason,
      tenantId: channel.tenantId,
      agentId: null,
      botUserId: bot?.botUserId ?? null,
      sessionId: null,
    };
  }

  private async resolveBotChannel(
    channel: ChannelRow,
    kind: Extract<AgentSessionBindingKind, "dm" | "tracking">,
  ): Promise<AgentSessionBindingResponse> {
    const bot = await this.findHiveBot(channel.id);
    const agentId = this.botAgentId(bot);
    if (!bot) return this.unsupported(channel, null, "no_bot");
    if (!agentId) return this.unsupported(channel, bot, "not_hive_managed");

    const scope = kind === "tracking" ? "tracking" : "dm";
    return {
      channelId: channel.id,
      channelType: channel.type,
      kind,
      supported: true,
      tenantId: channel.tenantId,
      agentId,
      botUserId: bot.botUserId,
      sessionId: this.buildSessionId(channel, agentId, scope, channel.id),
    };
  }

  private async resolveRoutineSession(
    channel: ChannelRow,
  ): Promise<AgentSessionBindingResponse> {
    const botBinding = await this.resolveBotChannel(channel, "dm");
    if (!botBinding.supported) return botBinding;

    const [routine] = await this.db
      .select({
        routineId: schema.routines.id,
        creationSessionId: schema.routines.creationSessionId,
      })
      .from(schema.routines)
      .where(eq(schema.routines.creationChannelId, channel.id))
      .limit(1);

    return {
      ...botBinding,
      kind: "routine-creation",
      routineId: routine?.routineId,
      sessionId: routine?.creationSessionId ?? botBinding.sessionId,
    };
  }

  private async resolveTopicSession(
    channel: ChannelRow,
  ): Promise<AgentSessionBindingResponse> {
    const botBinding = await this.resolveBotChannel(channel, "dm");
    if (!botBinding.supported) return botBinding;

    const settings = channel.propertySettings as
      | {
          topicSession?: { agentId?: string; sessionId?: string };
        }
      | null
      | undefined;

    const agentId = settings?.topicSession?.agentId ?? botBinding.agentId;
    const sessionId = settings?.topicSession?.sessionId ?? botBinding.sessionId;
    return {
      ...botBinding,
      kind: "topic-session",
      agentId,
      sessionId,
    };
  }

  private async resolveTaskChannel(
    channel: ChannelRow,
  ): Promise<AgentSessionBindingResponse> {
    const [row] = await this.db
      .select({
        executionId: schema.routineExecutions.id,
        routineId: schema.routineExecutions.routineId,
        taskcastTaskId: schema.routineExecutions.taskcastTaskId,
        taskStatus: schema.routineExecutions.status,
        botUserId: schema.bots.userId,
        managedProvider: schema.bots.managedProvider,
        managedMeta: schema.bots.managedMeta,
      })
      .from(schema.routineExecutions)
      .innerJoin(
        schema.routines,
        eq(schema.routines.id, schema.routineExecutions.routineId),
      )
      .innerJoin(schema.bots, eq(schema.bots.id, schema.routines.botId))
      .where(eq(schema.routineExecutions.channelId, channel.id))
      .limit(1);

    if (!row) return this.unsupported(channel, null, "session_not_created");

    const bot = {
      botUserId: row.botUserId,
      managedProvider: row.managedProvider,
      managedMeta: row.managedMeta,
    };
    const agentId = this.botAgentId(bot);
    if (!agentId) return this.unsupported(channel, bot, "not_hive_managed");

    return {
      channelId: channel.id,
      channelType: channel.type,
      kind: "routine-execution",
      supported: true,
      tenantId: channel.tenantId,
      agentId,
      botUserId: row.botUserId,
      sessionId: this.buildSessionId(
        channel,
        agentId,
        "routine",
        row.executionId,
      ),
      routineId: row.routineId,
      executionId: row.executionId,
      taskcastTaskId: row.taskcastTaskId,
      taskStatus: row.taskStatus,
    };
  }
}
```

- [ ] **Step 4: Run the focused test and fix query-shape issues**

Run:

```bash
pnpm --filter @team9/gateway test -- agent-session-binding.service.spec.ts
```

Expected: PASS. If a Drizzle mock call count differs because helper methods add one query, adjust only the test queue rows, not the resolver behavior.

- [ ] **Step 5: Commit**

```bash
git add apps/server/apps/gateway/src/im/agent-sessions/agent-session-binding.service.ts apps/server/apps/gateway/src/im/agent-sessions/agent-session-binding.service.spec.ts
git commit -m "feat: resolve agent sessions for channels"
```

---

### Task 4: Add Agent Session Controller and Module Wiring

**Files:**

- Create: `apps/server/apps/gateway/src/im/agent-sessions/agent-session.controller.ts`
- Create: `apps/server/apps/gateway/src/im/agent-sessions/agent-session.controller.spec.ts`
- Create: `apps/server/apps/gateway/src/im/agent-sessions/agent-sessions.module.ts`
- Modify: `apps/server/apps/gateway/src/im/im.module.ts`

- [ ] **Step 1: Write controller tests**

Create `apps/server/apps/gateway/src/im/agent-sessions/agent-session.controller.spec.ts`:

```ts
import { describe, expect, it, beforeEach, jest } from "@jest/globals";
import { NotFoundException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { AgentSessionController } from "./agent-session.controller.js";

const binding = {
  channelId: "channel-1",
  channelType: "direct",
  kind: "dm" as const,
  supported: true,
  tenantId: "tenant-1",
  agentId: "agent-1",
  botUserId: "bot-user-1",
  sessionId: "team9/tenant-1/agent-1/dm/channel-1",
};

describe("AgentSessionController", () => {
  let resolver: { resolve: jest.Mock<(...args: any[]) => any> };
  let clawHive: {
    getSessionStatus: jest.Mock<(...args: any[]) => any>;
    getSessionComponents: jest.Mock<(...args: any[]) => any>;
  };
  let jwt: JwtService;
  let controller: AgentSessionController;

  beforeEach(() => {
    resolver = { resolve: jest.fn<any>().mockResolvedValue(binding) };
    clawHive = {
      getSessionStatus: jest.fn<any>().mockResolvedValue({
        sessionId: binding.sessionId,
        isStreaming: false,
        queueLength: 1,
        ownedBy: "worker-1",
      }),
      getSessionComponents: jest.fn<any>().mockResolvedValue({
        sessionId: binding.sessionId,
        components: [
          {
            id: "persona",
            typeKey: "persona",
            declaredConfig: { token: "secret" },
            effectiveConfig: { token: "secret" },
            runtimeInjectedOnly: false,
            latestData: {
              data: { mood: "calm", token: "raw" },
              capturedAtCallId: "call-1",
              capturedAt: 123,
            },
          },
        ],
      }),
    };
    jwt = { verify: jest.fn<any>().mockReturnValue({ sub: "user-1" }) } as any;
    controller = new AgentSessionController(
      resolver as any,
      clawHive as any,
      jwt,
    );
  });

  it("returns binding with best-effort status", async () => {
    await expect(
      controller.getBinding("user-1", "channel-1"),
    ).resolves.toMatchObject({
      ...binding,
      status: {
        exists: true,
        queueLength: 1,
        ownedBy: "worker-1",
        activityState: "active",
      },
    });
  });

  it("returns sanitized components", async () => {
    await expect(
      controller.getComponents("user-1", "channel-1"),
    ).resolves.toEqual({
      sessionId: binding.sessionId,
      components: [
        {
          id: "persona",
          typeKey: "persona",
          runtimeInjectedOnly: false,
          latestData: {
            data: { mood: "calm", token: "[redacted]" },
            capturedAtCallId: "call-1",
            capturedAt: 123,
          },
        },
      ],
    });
  });

  it("throws 404 for component lookup when the binding is unsupported", async () => {
    resolver.resolve.mockResolvedValueOnce({
      ...binding,
      supported: false,
      sessionId: null,
      unsupportedReason: "not_hive_managed",
    });

    await expect(
      controller.getComponents("user-1", "channel-1"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm --filter @team9/gateway test -- agent-session.controller.spec.ts
```

Expected: FAIL because `AgentSessionController` does not exist.

- [ ] **Step 3: Implement controller snapshot endpoints**

Create `apps/server/apps/gateway/src/im/agent-sessions/agent-session.controller.ts`:

```ts
import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Request, Response } from "express";
import { AuthGuard, CurrentUser, type JwtPayload } from "@team9/auth";
import { ClawHiveService } from "@team9/claw-hive";
import { env } from "@team9/shared";
import { AgentSessionBindingService } from "./agent-session-binding.service.js";
import {
  filterAgentSessionEvent,
  projectSafeComponents,
} from "./agent-session-redaction.js";
import type {
  AgentSessionBindingResponse,
  AgentSessionStatus,
  SafeSessionComponentsResponse,
} from "./agent-session.types.js";

@Controller({ path: "im/channels", version: "1" })
export class AgentSessionController {
  private readonly hiveBaseUrl =
    env.CLAW_HIVE_API_URL ?? "http://localhost:4100";
  private readonly hiveAuthToken = env.CLAW_HIVE_AUTH_TOKEN ?? "";

  constructor(
    private readonly bindingService: AgentSessionBindingService,
    private readonly clawHive: ClawHiveService,
    private readonly jwtService: JwtService,
  ) {}

  @Get(":channelId/agent-session")
  @UseGuards(AuthGuard)
  async getBinding(
    @CurrentUser("sub") userId: string,
    @Param("channelId", ParseUUIDPipe) channelId: string,
  ): Promise<AgentSessionBindingResponse> {
    const binding = await this.bindingService.resolve(channelId, userId);
    return { ...binding, status: await this.resolveStatus(binding) };
  }

  @Get(":channelId/agent-session/components")
  @UseGuards(AuthGuard)
  async getComponents(
    @CurrentUser("sub") userId: string,
    @Param("channelId", ParseUUIDPipe) channelId: string,
  ): Promise<SafeSessionComponentsResponse> {
    const binding = await this.bindingService.resolve(channelId, userId);
    if (!binding.supported || !binding.sessionId) {
      throw new NotFoundException("Agent session is not available");
    }
    const response = await this.clawHive.getSessionComponents(
      binding.sessionId,
      binding.tenantId ?? undefined,
    );
    if (!response) throw new NotFoundException("Agent session not found");
    return projectSafeComponents(response);
  }

  private async resolveStatus(
    binding: AgentSessionBindingResponse,
  ): Promise<AgentSessionStatus | undefined> {
    if (!binding.supported || !binding.sessionId) return undefined;
    try {
      const status = await this.clawHive.getSessionStatus(
        binding.sessionId,
        binding.tenantId ?? undefined,
      );
      if (!status) {
        return { exists: false, unavailableReason: "not_found" };
      }
      const activityState =
        status.ownedBy !== null || status.queueLength > 0
          ? "active"
          : "inactive";
      return {
        exists: true,
        status: "active",
        ownedBy: status.ownedBy,
        queueLength: status.queueLength,
        activityState,
      };
    } catch {
      return { exists: false, unavailableReason: "agent_pi_unavailable" };
    }
  }
}
```

- [ ] **Step 4: Add SSE endpoint**

In the same controller, add a `streamEvents` method after `getComponents`:

```ts
@Get(':channelId/agent-session/events')
async streamEvents(
  @Param('channelId', ParseUUIDPipe) channelId: string,
  @Query('token') queryToken: string | undefined,
  @Req() req: Request,
  @Res() res: Response,
): Promise<void> {
  const headerToken = req.headers.authorization?.replace('Bearer ', '');
  const token = headerToken || queryToken;
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  let userId: string;
  try {
    const payload = this.jwtService.verify<JwtPayload>(token, {
      publicKey: env.JWT_PUBLIC_KEY,
      algorithms: ['ES256'],
    });
    userId = payload.sub;
  } catch {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }

  const binding = await this.bindingService.resolve(channelId, userId);
  if (!binding.supported || !binding.sessionId) {
    res.status(404).json({ error: 'Agent session is not available' });
    return;
  }

  const upstream = `${this.hiveBaseUrl}/api/sessions/${encodeURIComponent(
    binding.sessionId,
  )}/events`;
  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
    'X-Hive-Auth': this.hiveAuthToken,
  };
  if (binding.tenantId) headers['X-Hive-Tenant'] = binding.tenantId;

  const controller = new AbortController();
  req.on('close', () => controller.abort());

  const upstreamRes = await fetch(upstream, { headers, signal: controller.signal });
  if (!upstreamRes.ok || !upstreamRes.body) {
    res.status(502).json({ error: 'Hive upstream unavailable' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const reader = upstreamRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const flushRecord = (record: string) => {
    const forwarded = this.filterSseRecord(record);
    if (forwarded) res.write(forwarded + '\n\n');
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        flushRecord(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');
      }
    }
    if (buffer.length > 0) flushRecord(buffer);
  } catch {
    // client abort or upstream drop
  } finally {
    res.end();
  }
}

private filterSseRecord(record: string): string | null {
  const trimmed = record.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith(':')) return record;
  const lines = record.split('\n');
  const dataLine = lines.find((line) => line.startsWith('data:'));
  if (!dataLine) return record;
  const raw = dataLine.slice('data:'.length).trim();
  if (raw === '' || raw === 'ping' || raw === '"ping"') return record;

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const filtered = filterAgentSessionEvent(parsed);
    if (!filtered) return null;
    return lines
      .map((line) =>
        line.startsWith('data:')
          ? `data: ${JSON.stringify(filtered)}`
          : line,
      )
      .join('\n');
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Wire the Nest module**

Create `apps/server/apps/gateway/src/im/agent-sessions/agent-sessions.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { ClawHiveModule } from "@team9/claw-hive";
import { AuthModule } from "../../auth/auth.module.js";
import { AgentSessionBindingService } from "./agent-session-binding.service.js";
import { AgentSessionController } from "./agent-session.controller.js";

@Module({
  imports: [AuthModule, ClawHiveModule],
  controllers: [AgentSessionController],
  providers: [AgentSessionBindingService],
  exports: [AgentSessionBindingService],
})
export class AgentSessionsModule {}
```

Modify `apps/server/apps/gateway/src/im/im.module.ts`:

```ts
import { AgentSessionsModule } from "./agent-sessions/agent-sessions.module.js";

@Module({
  imports: [
    AuthModule,
    UsersModule,
    forwardRef(() => ChannelsModule),
    MessagesModule,
    WebsocketModule,
    SyncModule,
    SectionsModule,
    AuditModule,
    PropertiesModule,
    ViewsModule,
    BotMessagingModule,
    TopicSessionsModule,
    AgentSessionsModule,
  ],
  exports: [
    AuthModule,
    UsersModule,
    forwardRef(() => ChannelsModule),
    MessagesModule,
    WebsocketModule,
    SyncModule,
    SectionsModule,
    AuditModule,
    PropertiesModule,
    ViewsModule,
    TopicSessionsModule,
    AgentSessionsModule,
  ],
})
export class ImModule {}
```

- [ ] **Step 6: Run controller and module tests**

Run:

```bash
pnpm --filter @team9/gateway test -- agent-session.controller.spec.ts agent-session-binding.service.spec.ts agent-session-redaction.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/server/apps/gateway/src/im/agent-sessions apps/server/apps/gateway/src/im/im.module.ts
git commit -m "feat: expose channel agent session endpoints"
```

---

### Task 5: Add Client API Types and Methods

**Files:**

- Modify: `apps/client/src/types/im.ts`
- Modify: `apps/client/src/services/api/im.ts`
- Create: `apps/client/src/services/api/__tests__/agent-session.test.ts`

- [ ] **Step 1: Write failing API client tests**

Create `apps/client/src/services/api/__tests__/agent-session.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { channelsApi } from "../im";

const httpGet = vi.hoisted(() => vi.fn());

vi.mock("@/services/http", () => ({
  default: { get: httpGet },
}));

describe("agent session API", () => {
  beforeEach(() => {
    httpGet.mockReset();
  });

  it("fetches channel agent-session binding", async () => {
    httpGet.mockResolvedValueOnce({
      data: { channelId: "ch-1", supported: true },
    });

    await expect(channelsApi.getAgentSession("ch-1")).resolves.toEqual({
      channelId: "ch-1",
      supported: true,
    });

    expect(httpGet).toHaveBeenCalledWith("/v1/im/channels/ch-1/agent-session");
  });

  it("fetches channel agent-session components", async () => {
    httpGet.mockResolvedValueOnce({
      data: { sessionId: "s1", components: [] },
    });

    await expect(
      channelsApi.getAgentSessionComponents("ch-1"),
    ).resolves.toEqual({
      sessionId: "s1",
      components: [],
    });

    expect(httpGet).toHaveBeenCalledWith(
      "/v1/im/channels/ch-1/agent-session/components",
    );
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm --filter @team9/client test -- agent-session.test.ts
```

Expected: FAIL because `getAgentSession` and `getAgentSessionComponents` do not exist.

- [ ] **Step 3: Add TypeScript response types**

Append to `apps/client/src/types/im.ts` after channel types:

```ts
export type AgentSessionBindingKind =
  | "dm"
  | "routine-creation"
  | "topic-session"
  | "routine-execution"
  | "tracking";

export type AgentSessionUnsupportedReason =
  | "no_bot"
  | "not_hive_managed"
  | "session_not_created";

export interface AgentSessionStatus {
  exists: boolean;
  status?: "active" | "disposed";
  ownedBy?: string | null;
  queueLength?: number;
  activityState?: "active" | "inactive";
  unavailableReason?: "not_found" | "agent_pi_unavailable";
}

export interface AgentSessionBinding {
  channelId: string;
  channelType: ChannelType;
  kind: AgentSessionBindingKind | null;
  supported: boolean;
  unsupportedReason?: AgentSessionUnsupportedReason;
  tenantId: string | null;
  agentId: string | null;
  botUserId: string | null;
  sessionId: string | null;
  routineId?: string;
  executionId?: string;
  taskcastTaskId?: string | null;
  taskStatus?: string;
  status?: AgentSessionStatus;
}

export interface SafeSessionComponentItem {
  id: string;
  typeKey: string;
  priority?: number;
  runtimeInjectedOnly: boolean;
  schema?: unknown[];
  latestData: {
    data: Record<string, unknown>;
    capturedAtCallId: string | null;
    capturedAt: number;
  } | null;
}

export interface SafeSessionComponentsResponse {
  sessionId: string;
  components: SafeSessionComponentItem[];
}

export interface AgentSessionEvent {
  type: string;
  sessionId: string;
  timestamp?: number;
  [key: string]: unknown;
}

export interface ComponentDataSnapshotEvent extends AgentSessionEvent {
  type: "component_data_snapshot";
  timestamp: number;
  turnIndex: number;
  components: Array<{
    componentId: string;
    data: Record<string, unknown>;
  }>;
}
```

- [ ] **Step 4: Add API client methods**

In `apps/client/src/services/api/im.ts`, import the new types:

```ts
import type {
  AgentSessionBinding,
  SafeSessionComponentsResponse,
  // existing imports stay here
} from "@/types/im";
```

Add to `channelsApi` after the model methods:

```ts
getAgentSession: async (channelId: string): Promise<AgentSessionBinding> => {
  const response = await http.get<AgentSessionBinding>(
    `/v1/im/channels/${channelId}/agent-session`,
  );
  return response.data;
},

getAgentSessionComponents: async (
  channelId: string,
): Promise<SafeSessionComponentsResponse> => {
  const response = await http.get<SafeSessionComponentsResponse>(
    `/v1/im/channels/${channelId}/agent-session/components`,
  );
  return response.data;
},
```

- [ ] **Step 5: Run focused client API tests**

Run:

```bash
pnpm --filter @team9/client test -- agent-session.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/client/src/types/im.ts apps/client/src/services/api/im.ts apps/client/src/services/api/__tests__/agent-session.test.ts
git commit -m "feat: add agent session client api"
```

---

### Task 6: Add React Query Hooks With Direct SSE Cache Patching

**Files:**

- Create: `apps/client/src/hooks/useChannelAgentSession.ts`
- Create: `apps/client/src/hooks/useAgentSessionComponents.ts`
- Create: `apps/client/src/hooks/__tests__/useAgentSessionComponents.test.tsx`

- [ ] **Step 1: Write failing hook tests**

Create `apps/client/src/hooks/__tests__/useAgentSessionComponents.test.tsx`:

```tsx
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentType, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentSessionComponents } from "../useAgentSessionComponents";

const mockApi = vi.hoisted(() => ({
  channels: {
    getAgentSessionComponents: vi.fn(),
  },
}));

const auth = vi.hoisted(() => ({
  getValidAccessToken: vi.fn(),
}));

const eventSources = vi.hoisted(() => [] as MockEventSource[]);

class MockEventSource {
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(public readonly url: string) {
    eventSources.push(this);
  }

  close() {
    this.closed = true;
  }
}

vi.stubGlobal("EventSource", MockEventSource);

vi.mock("@/services/api", () => ({ api: { im: mockApi } }));
vi.mock("@/services/api/im", () => ({ default: mockApi }));
vi.mock("@/services/auth-session", () => auth);

function makeWrapper(
  queryClient: QueryClient,
): ComponentType<{ children: ReactNode }> {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("useAgentSessionComponents", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    eventSources.length = 0;
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    auth.getValidAccessToken.mockResolvedValue("token-1");
    mockApi.channels.getAgentSessionComponents.mockResolvedValue({
      sessionId: "session-1",
      components: [
        {
          id: "persona",
          typeKey: "persona",
          runtimeInjectedOnly: false,
          latestData: null,
        },
      ],
    });
  });

  it("loads initial components and opens authenticated SSE", async () => {
    const { result } = renderHook(
      () => useAgentSessionComponents("channel-1", true),
      { wrapper: makeWrapper(queryClient) },
    );

    await waitFor(() =>
      expect(result.current.data?.components).toHaveLength(1),
    );
    expect(eventSources[0].url).toContain(
      "/v1/im/channels/channel-1/agent-session/events?token=token-1",
    );
  });

  it("directly patches latestData from component_data_snapshot", async () => {
    const { result } = renderHook(
      () => useAgentSessionComponents("channel-1", true),
      { wrapper: makeWrapper(queryClient) },
    );
    await waitFor(() =>
      expect(result.current.data?.components).toHaveLength(1),
    );

    act(() => {
      eventSources[0].onmessage?.({
        data: JSON.stringify({
          type: "component_data_snapshot",
          sessionId: "session-1",
          timestamp: 1700000000000,
          turnIndex: 2,
          components: [{ componentId: "persona", data: { mood: "focused" } }],
        }),
      } as MessageEvent<string>);
    });

    expect(result.current.data?.components[0].latestData).toEqual({
      data: { mood: "focused" },
      capturedAtCallId: null,
      capturedAt: 1700000000000,
    });
  });

  it("inserts unknown components and refetches once", async () => {
    renderHook(() => useAgentSessionComponents("channel-1", true), {
      wrapper: makeWrapper(queryClient),
    });
    await waitFor(() =>
      expect(mockApi.channels.getAgentSessionComponents).toHaveBeenCalledTimes(
        1,
      ),
    );

    act(() => {
      eventSources[0].onmessage?.({
        data: JSON.stringify({
          type: "component_data_snapshot",
          sessionId: "session-1",
          timestamp: 1700000000100,
          turnIndex: 3,
          components: [{ componentId: "host", data: { cwd: "/tmp" } }],
        }),
      } as MessageEvent<string>);
    });

    await waitFor(() =>
      expect(mockApi.channels.getAgentSessionComponents).toHaveBeenCalledTimes(
        2,
      ),
    );
  });
});
```

- [ ] **Step 2: Run the focused hook test and verify it fails**

Run:

```bash
pnpm --filter @team9/client test -- useAgentSessionComponents.test.tsx
```

Expected: FAIL because the hook does not exist.

- [ ] **Step 3: Add binding query hook**

Create `apps/client/src/hooks/useChannelAgentSession.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import imApi from "@/services/api/im";

export function channelAgentSessionKey(channelId: string | null | undefined) {
  return ["channel-agent-session", channelId] as const;
}

export function useChannelAgentSession(
  channelId: string | null | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: channelAgentSessionKey(channelId),
    queryFn: () => imApi.channels.getAgentSession(channelId as string),
    enabled: enabled && !!channelId,
    staleTime: 15_000,
    retry: false,
  });
}
```

- [ ] **Step 4: Add components hook**

Create `apps/client/src/hooks/useAgentSessionComponents.ts`:

```ts
import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import imApi from "@/services/api/im";
import { getValidAccessToken, redirectToLogin } from "@/services/auth-session";
import { API_BASE_URL } from "@/constants/api-base-url";
import type {
  ComponentDataSnapshotEvent,
  SafeSessionComponentItem,
  SafeSessionComponentsResponse,
} from "@/types/im";

export function agentSessionComponentsKey(
  channelId: string | null | undefined,
) {
  return ["channel-agent-session-components", channelId] as const;
}

function isSnapshotEvent(value: unknown): value is ComponentDataSnapshotEvent {
  const event = value as ComponentDataSnapshotEvent;
  return (
    event?.type === "component_data_snapshot" &&
    typeof event.timestamp === "number" &&
    Array.isArray(event.components)
  );
}

function patchComponents(
  current: SafeSessionComponentsResponse | undefined,
  event: ComponentDataSnapshotEvent,
): { next: SafeSessionComponentsResponse | undefined; hasUnknown: boolean } {
  if (!current) return { next: current, hasUnknown: false };
  let hasUnknown = false;
  const byId = new Map(
    current.components.map((component) => [component.id, component]),
  );

  for (const update of event.components) {
    const existing = byId.get(update.componentId);
    const latestData = {
      data: update.data,
      capturedAtCallId: null,
      capturedAt: event.timestamp,
    };
    if (existing) {
      byId.set(update.componentId, { ...existing, latestData });
    } else {
      hasUnknown = true;
      byId.set(update.componentId, {
        id: update.componentId,
        typeKey: update.componentId,
        runtimeInjectedOnly: true,
        latestData,
      } satisfies SafeSessionComponentItem);
    }
  }

  return {
    next: { ...current, components: Array.from(byId.values()) },
    hasUnknown,
  };
}

export function useAgentSessionComponents(
  channelId: string | null | undefined,
  enabled = true,
) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => agentSessionComponentsKey(channelId),
    [channelId],
  );
  const isEnabled = enabled && !!channelId;

  const query = useQuery({
    queryKey,
    queryFn: () =>
      imApi.channels.getAgentSessionComponents(channelId as string),
    enabled: isEnabled,
    retry: false,
  });

  useEffect(() => {
    if (!isEnabled || !channelId) return;
    let source: EventSource | null = null;
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const open = async () => {
      const token = await getValidAccessToken();
      if (!token) {
        if (!disposed) redirectToLogin();
        return;
      }
      if (disposed) return;

      source = new EventSource(
        `${API_BASE_URL}/v1/im/channels/${channelId}/agent-session/events?token=${encodeURIComponent(token)}`,
      );
      source.onopen = () => {
        void queryClient.invalidateQueries({ queryKey });
      };
      source.onmessage = (message: MessageEvent<string>) => {
        try {
          const parsed = JSON.parse(message.data) as unknown;
          if (!isSnapshotEvent(parsed)) return;
          let shouldRefetch = false;
          queryClient.setQueryData<SafeSessionComponentsResponse>(
            queryKey,
            (current) => {
              const patched = patchComponents(current, parsed);
              shouldRefetch = patched.hasUnknown;
              return patched.next;
            },
          );
          if (shouldRefetch) {
            void queryClient.invalidateQueries({ queryKey });
          }
        } catch {
          // Ignore heartbeats and malformed records.
        }
      };
      source.onerror = () => {
        if (disposed) return;
        source?.close();
        source = null;
        reconnectTimer = setTimeout(() => void open(), 2_000);
      };
    };

    void open();
    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      source?.close();
    };
  }, [channelId, isEnabled, queryClient, queryKey]);

  return query;
}
```

- [ ] **Step 5: Run focused hook tests**

Run:

```bash
pnpm --filter @team9/client test -- useAgentSessionComponents.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/client/src/hooks/useChannelAgentSession.ts apps/client/src/hooks/useAgentSessionComponents.ts apps/client/src/hooks/__tests__/useAgentSessionComponents.test.tsx
git commit -m "feat: stream agent session component data"
```

---

### Task 7: Add Agent Session Panel UI

**Files:**

- Create: `apps/client/src/components/channel/agent-session/AgentSessionPanel.tsx`
- Create: `apps/client/src/components/channel/agent-session/AgentSessionStatusHeader.tsx`
- Create: `apps/client/src/components/channel/agent-session/SessionComponentList.tsx`
- Create: `apps/client/src/components/channel/agent-session/SessionComponentRow.tsx`
- Create: `apps/client/src/components/channel/agent-session/TaskContextSection.tsx`
- Create: `apps/client/src/components/channel/agent-session/TrackingContextSection.tsx`
- Create: `apps/client/src/components/channel/agent-session/__tests__/AgentSessionPanel.test.tsx`

- [ ] **Step 1: Write panel tests**

Create `apps/client/src/components/channel/agent-session/__tests__/AgentSessionPanel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentSessionPanel } from "../AgentSessionPanel";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? _key,
  }),
}));

const binding = {
  channelId: "ch-1",
  channelType: "direct" as const,
  kind: "dm" as const,
  supported: true,
  tenantId: "tenant-1",
  agentId: "agent-1",
  botUserId: "bot-user-1",
  sessionId: "session-1",
  status: { exists: true, activityState: "active" as const, queueLength: 1 },
};

describe("AgentSessionPanel", () => {
  it("renders active binding and component data", () => {
    render(
      <AgentSessionPanel
        binding={binding}
        components={{
          sessionId: "session-1",
          components: [
            {
              id: "persona",
              typeKey: "persona",
              runtimeInjectedOnly: false,
              latestData: {
                data: { mood: "focused" },
                capturedAtCallId: null,
                capturedAt: 1700000000000,
              },
            },
          ],
        }}
        isLoading={false}
        isError={false}
        width={360}
        onWidthChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Agent Session")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText("persona")).toBeInTheDocument();
    expect(screen.getByText(/focused/)).toBeInTheDocument();
  });

  it("renders unsupported fallback", () => {
    render(
      <AgentSessionPanel
        binding={{
          ...binding,
          supported: false,
          kind: null,
          sessionId: null,
          unsupportedReason: "not_hive_managed",
        }}
        components={undefined}
        isLoading={false}
        isError={false}
        width={360}
        onWidthChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Runtime details unavailable")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the focused panel test and verify it fails**

Run:

```bash
pnpm --filter @team9/client test -- AgentSessionPanel.test.tsx
```

Expected: FAIL because panel components do not exist.

- [ ] **Step 3: Add `SessionComponentRow`**

Create `apps/client/src/components/channel/agent-session/SessionComponentRow.tsx`:

```tsx
import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { SafeSessionComponentItem } from "@/types/im";

export function SessionComponentRow({
  component,
}: {
  component: SafeSessionComponentItem;
}) {
  const [open, setOpen] = useState(true);
  const data = component.latestData?.data ?? null;

  return (
    <div className="border-b border-border/60 py-2 last:border-b-0">
      <button
        type="button"
        className="flex w-full items-center gap-2 text-left"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {component.id}
        </span>
        {component.runtimeInjectedOnly && (
          <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
            injected
          </Badge>
        )}
        {open ? (
          <ChevronUp className="size-3" />
        ) : (
          <ChevronDown className="size-3" />
        )}
      </button>
      {open && (
        <pre className="mt-2 max-h-48 overflow-auto rounded border border-border/60 bg-muted/30 p-2 text-[11px] leading-4 text-muted-foreground">
          {data ? JSON.stringify(data, null, 2) : "No snapshot yet"}
        </pre>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add list, status, context, and shell components**

Create `apps/client/src/components/channel/agent-session/SessionComponentList.tsx`:

```tsx
import type { SafeSessionComponentsResponse } from "@/types/im";
import { SessionComponentRow } from "./SessionComponentRow";

export function SessionComponentList({
  components,
}: {
  components: SafeSessionComponentsResponse | undefined;
}) {
  const rows = components?.components ?? [];
  if (rows.length === 0) {
    return (
      <p className="p-3 text-xs text-muted-foreground">No component data</p>
    );
  }
  return (
    <div className="px-3">
      {rows.map((component) => (
        <SessionComponentRow key={component.id} component={component} />
      ))}
    </div>
  );
}
```

Create `apps/client/src/components/channel/agent-session/AgentSessionStatusHeader.tsx`:

```tsx
import { Activity, Circle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { AgentSessionBinding } from "@/types/im";

export function AgentSessionStatusHeader({
  binding,
}: {
  binding: AgentSessionBinding;
}) {
  const state = binding.status?.activityState ?? "inactive";
  return (
    <div className="border-b border-border px-3 py-3">
      <div className="flex items-center gap-2">
        <Activity className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Agent Session</h2>
        <Badge
          variant={state === "active" ? "default" : "outline"}
          className="ml-auto"
        >
          {state}
        </Badge>
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Circle className="size-2 fill-current" />
        <span className="truncate">{binding.kind ?? binding.channelType}</span>
      </div>
    </div>
  );
}
```

Create `apps/client/src/components/channel/agent-session/TaskContextSection.tsx`:

```tsx
import { Badge } from "@/components/ui/badge";
import type { AgentSessionBinding } from "@/types/im";

export function TaskContextSection({
  binding,
}: {
  binding: AgentSessionBinding;
}) {
  if (binding.kind !== "routine-execution") return null;
  return (
    <div className="border-t border-border px-3 py-3 text-xs">
      <div className="mb-2 font-medium">Task</div>
      <div className="space-y-1 text-muted-foreground">
        {binding.taskStatus && (
          <Badge variant="outline">{binding.taskStatus}</Badge>
        )}
        {binding.routineId && (
          <div className="truncate">Routine: {binding.routineId}</div>
        )}
        {binding.executionId && (
          <div className="truncate">Execution: {binding.executionId}</div>
        )}
      </div>
    </div>
  );
}
```

Create `apps/client/src/components/channel/agent-session/TrackingContextSection.tsx`:

```tsx
import type { AgentSessionBinding } from "@/types/im";

export function TrackingContextSection({
  binding,
}: {
  binding: AgentSessionBinding;
}) {
  if (binding.kind !== "tracking") return null;
  return (
    <div className="border-t border-border px-3 py-3 text-xs text-muted-foreground">
      <div className="mb-1 font-medium text-foreground">Tracking</div>
      <div className="truncate">Channel: {binding.channelId}</div>
    </div>
  );
}
```

Create `apps/client/src/components/channel/agent-session/AgentSessionPanel.tsx`:

```tsx
import { Loader2 } from "lucide-react";
import { ResizeHandle } from "../ResizeHandle";
import type {
  AgentSessionBinding,
  SafeSessionComponentsResponse,
} from "@/types/im";
import { AgentSessionStatusHeader } from "./AgentSessionStatusHeader";
import { SessionComponentList } from "./SessionComponentList";
import { TaskContextSection } from "./TaskContextSection";
import { TrackingContextSection } from "./TrackingContextSection";

interface AgentSessionPanelProps {
  binding: AgentSessionBinding;
  components: SafeSessionComponentsResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  width: number;
  onWidthChange: (width: number) => void;
}

export function AgentSessionPanel({
  binding,
  components,
  isLoading,
  isError,
  width,
  onWidthChange,
}: AgentSessionPanelProps) {
  return (
    <aside
      className="relative h-full shrink-0 border-l border-border bg-background"
      style={{ width }}
    >
      <ResizeHandle
        width={width}
        onWidthChange={onWidthChange}
        minWidth={300}
        maxWidth={520}
      />
      {!binding.supported ? (
        <div className="p-4">
          <h2 className="text-sm font-semibold">Runtime details unavailable</h2>
          <p className="mt-2 text-xs text-muted-foreground">
            {binding.unsupportedReason ?? "unsupported"}
          </p>
        </div>
      ) : (
        <>
          <AgentSessionStatusHeader binding={binding} />
          {isLoading && (
            <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              Loading components
            </div>
          )}
          {isError && (
            <p className="p-3 text-xs text-destructive">
              Failed to load component data
            </p>
          )}
          {!isLoading && !isError && (
            <SessionComponentList components={components} />
          )}
          <TaskContextSection binding={binding} />
          <TrackingContextSection binding={binding} />
        </>
      )}
    </aside>
  );
}
```

- [ ] **Step 5: Run panel tests**

Run:

```bash
pnpm --filter @team9/client test -- AgentSessionPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/client/src/components/channel/agent-session
git commit -m "feat: add agent session panel"
```

---

### Task 8: Integrate Panel Into ChannelView Layout

**Files:**

- Modify: `apps/client/src/components/channel/ChannelView.tsx`
- Create: `apps/client/src/components/channel/__tests__/ChannelView.agentSessionPanel.test.tsx`

- [ ] **Step 1: Write integration tests**

Create `apps/client/src/components/channel/__tests__/ChannelView.agentSessionPanel.test.tsx` using the same mock style as existing ChannelView tests:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChannelView } from "../ChannelView";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? _key,
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useCurrentUser: () => ({ data: { id: "user-1" } }),
}));

vi.mock("@/hooks/useChannels", () => ({
  useChannel: () => ({
    data: {
      id: "channel-1",
      type: "direct",
      name: "Agent",
      otherUser: { id: "bot-user-1", userType: "bot" },
    },
    isLoading: false,
  }),
  useChannelMembers: () => ({ data: [] }),
  useMarkAsRead: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/hooks/useMessages", () => ({
  useMessagesPaginated: () => ({
    messages: [],
    isLoading: false,
    hasPreviousPage: false,
  }),
  useSendMessage: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/hooks/useChannelAgentSession", () => ({
  useChannelAgentSession: () => ({
    data: {
      channelId: "channel-1",
      channelType: "direct",
      kind: "dm",
      supported: true,
      tenantId: "tenant-1",
      agentId: "agent-1",
      botUserId: "bot-user-1",
      sessionId: "session-1",
    },
  }),
}));

vi.mock("@/hooks/useAgentSessionComponents", () => ({
  useAgentSessionComponents: () => ({
    data: { sessionId: "session-1", components: [] },
    isLoading: false,
    isError: false,
  }),
}));

vi.mock("../agent-session/AgentSessionPanel", () => ({
  AgentSessionPanel: () => <aside>Agent Session Panel</aside>,
}));

vi.mock("../ChannelHeader", () => ({ ChannelHeader: () => <div /> }));
vi.mock("../MessageList", () => ({ MessageList: () => <div /> }));
vi.mock("../MessageInput", () => ({ MessageInput: () => <div /> }));
vi.mock("../JoinChannelPrompt", () => ({ JoinChannelPrompt: () => null }));
vi.mock("../BotInstanceStoppedBanner", () => ({
  BotInstanceStoppedBanner: () => null,
}));
vi.mock("@/hooks/useOpenClawBotInstanceStatus", () => ({
  useOpenClawBotInstanceStatus: () => ({
    isInstanceStopped: false,
    isInstanceStarting: false,
    startInstance: vi.fn(),
    isStarting: false,
    canStart: false,
  }),
}));
vi.mock("@/hooks/useChannelModel", () => ({
  useChannelModel: () => ({ data: null, isError: true }),
}));
vi.mock("@/hooks/useBotModelSwitch", () => ({
  useBotModelSwitch: () => undefined,
}));

describe("ChannelView agent session panel", () => {
  it("renders the session panel for a supported binding", () => {
    render(<ChannelView channelId="channel-1" />);
    expect(screen.getByText("Agent Session Panel")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the focused integration test and verify it fails**

Run:

```bash
pnpm --filter @team9/client test -- ChannelView.agentSessionPanel.test.tsx
```

Expected: FAIL because ChannelView does not mount `AgentSessionPanel`.

- [ ] **Step 3: Mount hooks and panel in ChannelView**

Modify `apps/client/src/components/channel/ChannelView.tsx` imports:

```ts
import { AgentSessionPanel } from "./agent-session/AgentSessionPanel";
import { useChannelAgentSession } from "@/hooks/useChannelAgentSession";
import { useAgentSessionComponents } from "@/hooks/useAgentSessionComponents";
```

Add state near `threadPanelWidth`:

```ts
const [agentPanelWidth, setAgentPanelWidth] = useState(360);
const agentSession = useChannelAgentSession(channelId, !isPreviewMode);
const shouldShowAgentSessionPanel =
  !!agentSession.data &&
  (agentSession.data.supported || !!agentSession.data.unsupportedReason);
const agentComponents = useAgentSessionComponents(
  channelId,
  shouldShowAgentSessionPanel && agentSession.data?.supported === true,
);
```

Adjust panel count:

```ts
const agentPanelCount = shouldShowAgentSessionPanel ? 1 : 0;
const threadPanelCount =
  agentPanelCount +
  (primaryThread.isOpen && primaryThread.rootMessageId ? 1 : 0) +
  (secondaryThread.isOpen && secondaryThread.rootMessageId ? 1 : 0);
```

Use a conservative fixed width for snap calculation:

```ts
const mainChatWidth =
  containerWidth -
  agentPanelCount * agentPanelWidth -
  (threadPanelCount - agentPanelCount) * threadPanelWidthRef.current;
```

Render the panel before thread panels:

```tsx
{
  agentSession.data && shouldShowAgentSessionPanel && (
    <AgentSessionPanel
      binding={agentSession.data}
      components={agentComponents.data}
      isLoading={agentComponents.isLoading}
      isError={agentComponents.isError}
      width={agentPanelWidth}
      onWidthChange={setAgentPanelWidth}
    />
  );
}
```

- [ ] **Step 4: Run focused integration test**

Run:

```bash
pnpm --filter @team9/client test -- ChannelView.agentSessionPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/components/channel/ChannelView.tsx apps/client/src/components/channel/__tests__/ChannelView.agentSessionPanel.test.tsx
git commit -m "feat: mount agent session panel in channels"
```

---

### Task 9: Full Verification

**Files:**

- No new files unless a previous task reveals a concrete compile/test issue.

- [ ] **Step 1: Run backend focused suite**

Run:

```bash
pnpm --filter @team9/gateway test -- agent-session
```

Expected: PASS for all agent-session gateway tests.

- [ ] **Step 2: Run client focused suite**

Run:

```bash
pnpm --filter @team9/client test -- agent-session useAgentSessionComponents ChannelView.agentSessionPanel AgentSessionPanel
```

Expected: PASS for all new client tests.

- [ ] **Step 3: Run typechecks/builds**

Run:

```bash
pnpm --filter @team9/gateway build
pnpm --filter @team9/client typecheck
```

Expected: both commands exit 0.

- [ ] **Step 4: Run lint checks**

Run:

```bash
pnpm --filter @team9/gateway lint:ci
pnpm --filter @team9/client lint:ci
```

Expected: both commands exit 0.

- [ ] **Step 5: Manual runtime check**

Start local services:

```bash
pnpm dev:server:all
pnpm dev:client
```

Open a Hive-backed bot DM, send a message, and verify:

- The right panel appears.
- Initial component rows load from the gateway.
- During/after a turn, `component_data_snapshot` updates visible JSON without waiting for manual refresh.
- Disconnecting and reconnecting the gateway stream keeps the old data visible and then refetches.

- [ ] **Step 6: Final commit if verification required fixes**

If Step 3 or Step 4 required code changes, stage the files changed during
verification. For example, if lint only changed formatting in the new
agent-session files:

```bash
git add apps/server/apps/gateway/src/im/agent-sessions apps/client/src/components/channel/agent-session apps/client/src/hooks/useAgentSessionComponents.ts
git commit -m "fix: verify agent session panel integration"
```

If verification required no code changes, do not create an empty commit.

---

## Self-Review Notes

Spec coverage:

- Binding resolver for `direct`, `routine-session`, `topic-session`, `task`, and `tracking`: Task 3.
- Agent-pi `GET /components` proxy and sanitized projection: Tasks 1, 2, 4.
- Direct UI cache patch from `component_data_snapshot`: Task 6.
- Read-only right panel with task/tracking context: Tasks 7 and 8.
- Security boundary and redaction: Tasks 2 and 4.

No database migration is included because the approved spec chose derived binding on read.
