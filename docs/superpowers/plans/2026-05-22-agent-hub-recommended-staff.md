# AgentHub Recommended Staff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build AgentHub recommended staff: cached AgentHive prefab template discovery plus one-click installation into a Team9 workspace as Common Staff.

**Architecture:** Add an `agent-hub` managed app and a dedicated gateway `AgentHubModule`. The module reads AgentHive `PrefabAgentTemplate` records through `ClawHiveService`, caches normalized Team9 staff templates in Redis, computes installed state from Team9 DB, and installs selected templates through the existing Common Staff/Hive bot path.

**Tech Stack:** NestJS 11, Drizzle ORM, Redis, `@team9/claw-hive`, Jest, React 19, TanStack Query, Vitest.

---

## File Structure

Backend files:

- Modify `apps/server/libs/claw-hive/src/claw-hive.service.ts`: add prefab template types and `listPrefabAgentTemplates()`.
- Modify `apps/server/libs/claw-hive/src/claw-hive.service.spec.ts`: add HTTP contract tests for prefab template listing.
- Modify `apps/server/libs/database/src/schemas/im/bots.ts`: add `prefabTemplateId` to `BotExtra.commonStaff`.
- Modify `apps/server/apps/gateway/src/applications/staff.service.ts`: support nullable mentor IDs and managed metadata extras.
- Create `apps/server/apps/gateway/src/applications/staff.service.spec.ts`: focused tests for the changed shared StaffService behavior.
- Modify `apps/server/apps/gateway/src/bot/bot.service.ts`: preserve explicitly-null `mentorId` and pass nullable mentor through workspace bot creation.
- Modify `apps/server/apps/gateway/src/applications/applications.service.ts`: register the managed `agent-hub` app.
- Create `apps/server/apps/gateway/src/applications/handlers/agent-hub.handler.ts`: no-op app install handler.
- Modify `apps/server/apps/gateway/src/applications/handlers/index.ts`: export/register the new handler.
- Create `apps/server/apps/gateway/src/agent-hub/dto/install-recommended-staff.dto.ts`: request DTO.
- Create `apps/server/apps/gateway/src/agent-hub/agent-hub.types.ts`: normalized template/response types and constants.
- Create `apps/server/apps/gateway/src/agent-hub/agent-hub.service.ts`: cache/list/install logic.
- Create `apps/server/apps/gateway/src/agent-hub/agent-hub.service.spec.ts`: service tests.
- Create `apps/server/apps/gateway/src/agent-hub/agent-hub.controller.ts`: REST endpoints.
- Create `apps/server/apps/gateway/src/agent-hub/agent-hub.controller.spec.ts`: controller tests.
- Create `apps/server/apps/gateway/src/agent-hub/agent-hub.module.ts`: module wiring.
- Modify `apps/server/apps/gateway/src/app.module.ts`: import `AgentHubModule`.

Frontend files:

- Modify `apps/client/src/services/api/applications.ts`: add recommended staff types and API methods.
- Create `apps/client/src/services/api/__tests__/applications.test.ts`: API route tests.
- Create `apps/client/src/components/ai-staff/RecommendedStaffSection.tsx`: query/mutation UI for recommendations.
- Create `apps/client/src/components/ai-staff/__tests__/RecommendedStaffSection.test.tsx`: UI behavior tests.
- Modify `apps/client/src/components/layout/contents/AIStaffMainContent.tsx`: mount the new section above AI Staff.
- Modify `apps/client/src/components/layout/contents/__tests__/AIStaffMainContent.test.tsx`: keep existing tests stable with the extra query/component.
- Modify `apps/client/src/i18n/locales/en/navigation.json` and `apps/client/src/i18n/locales/zh-CN/navigation.json`: add display strings.
- If type or i18n checks require full key coverage, add the same keys to the other `apps/client/src/i18n/locales/*/navigation.json` files using English fallback strings.

## Dependency Order

1. Hive client.
2. Shared bot/staff nullable mentor support.
3. AgentHub app registration and backend service/controller.
4. Frontend API client.
5. RecommendedStaffSection UI and AIStaff page wiring.
6. Full verification.

## Task 1: Hive Prefab Template Client

**Files:**

- Modify: `apps/server/libs/claw-hive/src/claw-hive.service.ts`
- Modify: `apps/server/libs/claw-hive/src/claw-hive.service.spec.ts`

- [ ] **Step 1.1: Write failing tests for listing prefab templates**

Append this `describe` block to `apps/server/libs/claw-hive/src/claw-hive.service.spec.ts` after the `registerAgents` tests or before the final closing brace:

```ts
describe("listPrefabAgentTemplates", () => {
  it("sends GET to /api/prefab-agent-templates with Hive auth headers", async () => {
    const templates = [
      {
        id: "sales-analyst",
        name: "Sales Analyst",
        description: "Analyzes pipeline health",
        blueprintId: "team9-common-staff",
        model: { provider: "openrouter", id: "anthropic/claude-sonnet-4.6" },
        componentConfigs: { "system-prompt": { prompt: "Act as sales ops." } },
        metadata: {
          team9: {
            roleTitle: "Sales Operations Analyst",
            shortRoleTitle: "Sales Ops",
            unique: true,
          },
        },
      },
    ];
    mockFetch.mockResolvedValueOnce(jsonResponse({ templates }));

    const result = await service.listPrefabAgentTemplates();

    expect(result).toEqual(templates);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://test-hive:9999/api/prefab-agent-templates",
      expect.objectContaining({ method: "GET" }),
    );
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = opts.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-Hive-Auth"]).toBe("test-token");
    expect(headers).not.toHaveProperty("X-Hive-Tenant");
  });

  it("also accepts a bare array response for compatibility", async () => {
    const templates = [
      {
        id: "support-specialist",
        name: "Support Specialist",
        blueprintId: "team9-common-staff",
        metadata: { team9: { roleTitle: "Support Specialist" } },
      },
    ];
    mockFetch.mockResolvedValueOnce(jsonResponse(templates));

    await expect(service.listPrefabAgentTemplates()).resolves.toEqual(
      templates,
    );
  });

  it("throws on non-ok responses", async () => {
    mockFetch.mockResolvedValueOnce(textResponse("Upstream down", 503));

    await expect(service.listPrefabAgentTemplates()).rejects.toThrow(
      "Failed to list prefab agent templates: 503 Upstream down",
    );
  });
});
```

- [ ] **Step 1.2: Run the failing test**

Run:

```bash
pnpm --filter @team9/claw-hive test -- claw-hive.service.spec.ts --runInBand
```

Expected: FAIL with `service.listPrefabAgentTemplates is not a function`.

- [ ] **Step 1.3: Add prefab template interfaces and method**

In `apps/server/libs/claw-hive/src/claw-hive.service.ts`, add these interfaces after `HiveAgentSnapshot`:

```ts
export interface HivePrefabAgentTemplate {
  id: string;
  name: string;
  description?: string;
  blueprintId: string;
  model?: HiveModelRef;
  componentConfigs?: Record<string, Record<string, unknown>>;
  metadata?: Record<string, unknown>;
}

interface HivePrefabAgentTemplatesResponse {
  templates?: HivePrefabAgentTemplate[];
}
```

Add this method after `healthCheck()`:

```ts
  async listPrefabAgentTemplates(): Promise<HivePrefabAgentTemplate[]> {
    const res = await fetch(`${this.baseUrl}/api/prefab-agent-templates`, {
      method: 'GET',
      headers: this.headers(),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Failed to list prefab agent templates: ${res.status} ${text}`,
      );
    }

    const body = (await res.json()) as
      | HivePrefabAgentTemplate[]
      | HivePrefabAgentTemplatesResponse;
    return Array.isArray(body) ? body : (body.templates ?? []);
  }
```

- [ ] **Step 1.4: Verify the Hive client tests pass**

Run:

```bash
pnpm --filter @team9/claw-hive test -- claw-hive.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 1.5: Commit Hive client change**

```bash
git add apps/server/libs/claw-hive/src/claw-hive.service.ts \
        apps/server/libs/claw-hive/src/claw-hive.service.spec.ts
git commit -m "feat(agent-hub): read prefab templates from hive"
```

## Task 2: Nullable Mentor Support in Shared Staff Creation

**Files:**

- Modify: `apps/server/libs/database/src/schemas/im/bots.ts`
- Modify: `apps/server/apps/gateway/src/applications/staff.service.ts`
- Create: `apps/server/apps/gateway/src/applications/staff.service.spec.ts`
- Modify: `apps/server/apps/gateway/src/bot/bot.service.ts`

- [ ] **Step 2.1: Write failing StaffService tests**

Create `apps/server/apps/gateway/src/applications/staff.service.spec.ts`:

```ts
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { StaffService } from "./staff.service.js";

type MockFn = jest.Mock<(...args: any[]) => any>;

function mockDb() {
  const chain: Record<string, MockFn> = {} as Record<string, MockFn>;
  for (const method of ["update", "set", "where"]) {
    chain[method] = jest.fn<any>().mockReturnValue(chain);
  }
  chain.then = jest.fn<any>((resolve: (value: unknown) => unknown) =>
    Promise.resolve([]).then(resolve),
  );
  return chain;
}

describe("StaffService", () => {
  let service: StaffService;
  let db: ReturnType<typeof mockDb>;
  let botService: {
    createWorkspaceBot: MockFn;
    updateBotExtra: MockFn;
    deleteBotAndCleanup: MockFn;
  };
  let clawHiveService: {
    registerAgent: MockFn;
    deleteAgent: MockFn;
  };

  beforeEach(() => {
    db = mockDb();
    botService = {
      createWorkspaceBot: jest.fn<any>().mockResolvedValue({
        bot: {
          botId: "bot-1",
          userId: "bot-user-1",
          displayName: "Analyst",
        },
        accessToken: "token-1",
      }),
      updateBotExtra: jest.fn<any>().mockResolvedValue(undefined),
      deleteBotAndCleanup: jest.fn<any>().mockResolvedValue(undefined),
    };
    clawHiveService = {
      registerAgent: jest.fn<any>().mockResolvedValue(undefined),
      deleteAgent: jest.fn<any>().mockResolvedValue(undefined),
    };

    service = new StaffService(
      db as never,
      botService as never,
      clawHiveService as never,
      { get: jest.fn<any>(), set: jest.fn<any>() } as never,
    );
  });

  it("passes nullable mentor to bot creation and Hive metadata", async () => {
    await service.createBotWithAgent({
      agentIdPrefix: "common-staff",
      blueprintId: "team9-common-staff",
      ownerId: "owner-1",
      tenantId: "tenant-1",
      displayName: "Analyst",
      installedApplicationId: "app-1",
      mentorId: null,
      model: { provider: "openrouter", id: "anthropic/claude-sonnet-4.6" },
      botExtra: { commonStaff: { roleTitle: "Analyst" } },
    });

    expect(botService.createWorkspaceBot).toHaveBeenCalledWith(
      expect.objectContaining({ mentorId: null }),
    );
    expect(clawHiveService.registerAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ mentorId: null }),
      }),
    );
  });

  it("stores managed metadata extras with the generated agent id", async () => {
    await service.createBotWithAgent({
      agentIdPrefix: "common-staff",
      blueprintId: "team9-common-staff",
      ownerId: "owner-1",
      tenantId: "tenant-1",
      displayName: "Analyst",
      installedApplicationId: "app-1",
      mentorId: null,
      model: { provider: "openrouter", id: "anthropic/claude-sonnet-4.6" },
      botExtra: {
        commonStaff: {
          roleTitle: "Analyst",
          prefabTemplateId: "template-1",
        },
      },
      managedMeta: { prefabTemplateId: "template-1" },
    });

    expect(db.set).toHaveBeenCalledWith(
      expect.objectContaining({
        managedMeta: {
          agentId: "common-staff-bot-1",
          prefabTemplateId: "template-1",
        },
      }),
    );
  });
});
```

- [ ] **Step 2.2: Run the failing StaffService test**

Run:

```bash
pnpm --filter @team9/gateway test -- applications/staff.service.spec.ts --runInBand
```

Expected: FAIL because `mentorId` and `managedMeta` types/behavior do not support this yet.

- [ ] **Step 2.3: Extend BotExtra and StaffService option types**

In `apps/server/libs/database/src/schemas/im/bots.ts`, add `prefabTemplateId?: string;` to `BotExtra.commonStaff`:

```ts
  commonStaff?: {
    roleTitle?: string;
    shortRoleTitle?: string | null;
    persona?: string;
    jobDescription?: string;
    model?: { provider: string; id: string };
    prefabTemplateId?: string;
    identity?: Record<string, unknown>;
  };
```

In `apps/server/apps/gateway/src/applications/staff.service.ts`, change `CreateStaffBotOptions`:

```ts
  /** Mentor user ID. Null means this staff has no mentor. */
  mentorId?: string | null;
  /** Extra provider metadata to store alongside managedMeta.agentId. */
  managedMeta?: Record<string, unknown>;
```

- [ ] **Step 2.4: Implement nullable mentor and managed metadata**

In `createBotWithAgent`, include `managedMeta` in destructuring:

```ts
      managedMeta,
```

Change the bot creation call to pass nullable mentor through:

```ts
      mentorId: mentorId ?? null,
```

Change the managed meta update block to:

```ts
await this.db
  .update(schema.bots)
  .set({
    managedMeta: { agentId, ...(managedMeta ?? {}) },
    updatedAt: new Date(),
  })
  .where(eq(schema.bots.id, bot.botId));
```

Keep Hive metadata including nullable mentor:

```ts
        metadata: {
          tenantId,
          botId: bot.botId,
          mentorId: mentorId ?? null,
        },
```

- [ ] **Step 2.5: Preserve explicit null mentor in BotService**

In `apps/server/apps/gateway/src/bot/bot.service.ts`, change `CreateWorkspaceBotOptions`:

```ts
  mentorId?: string | null;
```

Change the update block inside `createWorkspaceBot` from truthy spreads to explicit undefined checks:

```ts
if (
  installedApplicationId !== undefined ||
  mentorId !== undefined ||
  managedProvider !== undefined
) {
  await this.db
    .update(schema.bots)
    .set({
      ...(installedApplicationId !== undefined
        ? { installedApplicationId }
        : {}),
      ...(mentorId !== undefined ? { mentorId } : {}),
      ...(managedProvider !== undefined ? { managedProvider } : {}),
      ...(managedMeta !== undefined ? { managedMeta } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.bots.id, bot.botId));
  if (installedApplicationId) {
    this.logger.log(
      `Linked bot ${bot.botId} to application ${installedApplicationId}`,
    );
  }
}
```

- [ ] **Step 2.6: Verify StaffService tests pass**

Run:

```bash
pnpm --filter @team9/gateway test -- applications/staff.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 2.7: Run existing Common Staff and Personal Staff service tests**

Run:

```bash
pnpm --filter @team9/gateway test -- applications/common-staff.service.spec.ts applications/personal-staff.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 2.8: Commit nullable mentor support**

```bash
git add apps/server/libs/database/src/schemas/im/bots.ts \
        apps/server/apps/gateway/src/applications/staff.service.ts \
        apps/server/apps/gateway/src/applications/staff.service.spec.ts \
        apps/server/apps/gateway/src/bot/bot.service.ts
git commit -m "feat(agent-hub): allow staff without mentor"
```

## Task 3: AgentHub App Registration

**Files:**

- Modify: `apps/server/apps/gateway/src/applications/applications.service.ts`
- Create: `apps/server/apps/gateway/src/applications/handlers/agent-hub.handler.ts`
- Modify: `apps/server/apps/gateway/src/applications/handlers/index.ts`

- [ ] **Step 3.1: Write failing application registration test**

Create `apps/server/apps/gateway/src/applications/applications.service.spec.ts` if it does not exist, or append this test if it exists:

```ts
import { describe, expect, it } from "@jest/globals";
import { ApplicationsService } from "./applications.service.js";

describe("ApplicationsService", () => {
  it("auto-installs the managed Agent Hub app", () => {
    const service = new ApplicationsService();

    expect(service.findById("agent-hub")).toMatchObject({
      id: "agent-hub",
      name: "Agent Hub",
      type: "managed",
      singleton: true,
      autoInstall: true,
    });
    expect(service.findAutoInstall().map((app) => app.id)).toContain(
      "agent-hub",
    );
  });
});
```

- [ ] **Step 3.2: Run the failing registration test**

Run:

```bash
pnpm --filter @team9/gateway test -- applications/applications.service.spec.ts --runInBand
```

Expected: FAIL because `agent-hub` is not registered.

- [ ] **Step 3.3: Add application definition**

In `apps/server/apps/gateway/src/applications/applications.service.ts`, add this object after `common-staff`:

```ts
  {
    id: 'agent-hub',
    name: 'Agent Hub',
    description: 'Recommended AI staff templates powered by AgentHive',
    iconUrl: '/icons/agent-hub.svg',
    categories: ['ai', 'bot'],
    enabled: true,
    type: 'managed',
    singleton: true,
    autoInstall: true,
  },
```

- [ ] **Step 3.4: Add no-op handler**

Create `apps/server/apps/gateway/src/applications/handlers/agent-hub.handler.ts`:

```ts
import { Injectable } from "@nestjs/common";
import type {
  ApplicationHandler,
  InstallContext,
  InstallResult,
} from "./application-handler.interface.js";

@Injectable()
export class AgentHubHandler implements ApplicationHandler {
  readonly applicationId = "agent-hub";

  onInstall(_context: InstallContext): Promise<InstallResult> {
    return Promise.resolve({});
  }
}
```

- [ ] **Step 3.5: Register handler**

In `apps/server/apps/gateway/src/applications/handlers/index.ts`, add:

```ts
export * from "./agent-hub.handler.js";
```

Add import:

```ts
import { AgentHubHandler } from "./agent-hub.handler.js";
```

Append to `APPLICATION_HANDLERS`:

```ts
  AgentHubHandler,
```

- [ ] **Step 3.6: Verify registration test passes**

Run:

```bash
pnpm --filter @team9/gateway test -- applications/applications.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 3.7: Commit app registration**

```bash
git add apps/server/apps/gateway/src/applications/applications.service.ts \
        apps/server/apps/gateway/src/applications/applications.service.spec.ts \
        apps/server/apps/gateway/src/applications/handlers/agent-hub.handler.ts \
        apps/server/apps/gateway/src/applications/handlers/index.ts
git commit -m "feat(agent-hub): register managed app"
```

## Task 4: AgentHub Catalog Cache and List API

**Files:**

- Create: `apps/server/apps/gateway/src/agent-hub/agent-hub.types.ts`
- Create: `apps/server/apps/gateway/src/agent-hub/agent-hub.service.ts`
- Create: `apps/server/apps/gateway/src/agent-hub/agent-hub.service.spec.ts`

- [ ] **Step 4.1: Write failing service tests for cache/list behavior**

Create `apps/server/apps/gateway/src/agent-hub/agent-hub.service.spec.ts` with this initial content:

```ts
import { ConflictException } from "@nestjs/common";
import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { AgentHubService } from "./agent-hub.service.js";

type MockFn = jest.Mock<(...args: any[]) => any>;

const now = new Date("2026-05-22T00:00:00.000Z").getTime();

function makeTemplate(overrides: Record<string, unknown> = {}) {
  return {
    id: "sales-analyst",
    name: "Sales Analyst",
    description: "Analyzes pipeline health",
    blueprintId: "team9-common-staff",
    model: { provider: "openrouter", id: "anthropic/claude-sonnet-4.6" },
    componentConfigs: { "system-prompt": { prompt: "Analyze sales data." } },
    metadata: {
      team9: {
        displayName: "Sales Analyst",
        roleTitle: "Sales Operations Analyst",
        shortRoleTitle: "Sales Ops",
        unique: true,
      },
    },
    ...overrides,
  };
}

describe("AgentHubService catalog", () => {
  let service: AgentHubService;
  let clawHive: { listPrefabAgentTemplates: MockFn };
  let redis: { get: MockFn; set: MockFn };
  let installedApplications: {
    findByApplicationId: MockFn;
    ensureAutoInstallApps: MockFn;
  };
  let staffService: {
    createBotWithAgent: MockFn;
    generateShortRoleTitle: MockFn;
  };
  let botService: { getBotsByInstalledApplicationId: MockFn };
  let channelsService: { createDirectChannel: MockFn };
  let db: { select: MockFn };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(now);

    clawHive = { listPrefabAgentTemplates: jest.fn<any>() };
    redis = {
      get: jest.fn<any>().mockResolvedValue(null),
      set: jest.fn<any>().mockResolvedValue("OK"),
    };
    installedApplications = {
      findByApplicationId: jest.fn<any>(),
      ensureAutoInstallApps: jest.fn<any>(),
    };
    staffService = {
      createBotWithAgent: jest.fn<any>(),
      generateShortRoleTitle: jest.fn<any>(),
    };
    botService = {
      getBotsByInstalledApplicationId: jest.fn<any>().mockResolvedValue([]),
    };
    channelsService = { createDirectChannel: jest.fn<any>() };
    db = { select: jest.fn<any>() };

    service = new AgentHubService(
      clawHive as never,
      redis as never,
      installedApplications as never,
      staffService as never,
      botService as never,
      channelsService as never,
      db as never,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("filters and normalizes templates with Team9 metadata", async () => {
    clawHive.listPrefabAgentTemplates.mockResolvedValue([
      makeTemplate(),
      makeTemplate({
        id: "missing-team9",
        metadata: {},
      }),
      makeTemplate({
        id: "missing-role",
        metadata: { team9: { displayName: "No Role" } },
      }),
    ]);
    installedApplications.findByApplicationId.mockResolvedValue({
      id: "common-app-1",
    });

    const result = await service.listRecommendedStaff("tenant-1");

    expect(result).toEqual([
      expect.objectContaining({
        templateId: "sales-analyst",
        displayName: "Sales Analyst",
        roleTitle: "Sales Operations Analyst",
        shortRoleTitle: "Sales Ops",
        unique: true,
        installed: false,
      }),
    ]);
    expect(redis.set).toHaveBeenCalledWith(
      "agent-hub:team9-prefab-staff:v1",
      expect.any(String),
      24 * 60 * 60,
    );
  });

  it("uses a fresh Redis cache without calling AgentHive", async () => {
    redis.get.mockResolvedValue(
      JSON.stringify({
        cachedAt: new Date(now).toISOString(),
        templates: [
          {
            templateId: "cached-template",
            name: "Cached",
            displayName: "Cached",
            roleTitle: "Cached Role",
            shortRoleTitle: null,
            persona: null,
            jobDescription: null,
            avatarUrl: null,
            description: null,
            model: {
              provider: "openrouter",
              id: "anthropic/claude-sonnet-4.6",
            },
            blueprintId: "team9-common-staff",
            componentConfigs: {},
            unique: false,
          },
        ],
      }),
    );
    installedApplications.findByApplicationId.mockResolvedValue({
      id: "common-app-1",
    });

    const result = await service.listRecommendedStaff("tenant-1");

    expect(result[0]).toMatchObject({
      templateId: "cached-template",
      installed: false,
    });
    expect(clawHive.listPrefabAgentTemplates).not.toHaveBeenCalled();
  });

  it("returns stale cache when AgentHive refresh fails", async () => {
    redis.get.mockResolvedValue(
      JSON.stringify({
        cachedAt: new Date(now - 10 * 60 * 1000).toISOString(),
        templates: [
          {
            templateId: "stale-template",
            name: "Stale",
            displayName: "Stale",
            roleTitle: "Stale Role",
            shortRoleTitle: null,
            persona: null,
            jobDescription: null,
            avatarUrl: null,
            description: null,
            model: {
              provider: "openrouter",
              id: "anthropic/claude-sonnet-4.6",
            },
            blueprintId: "team9-common-staff",
            componentConfigs: {},
            unique: false,
          },
        ],
      }),
    );
    clawHive.listPrefabAgentTemplates.mockRejectedValue(new Error("down"));
    installedApplications.findByApplicationId.mockResolvedValue({
      id: "common-app-1",
    });

    const result = await service.listRecommendedStaff("tenant-1");

    expect(result[0]).toMatchObject({
      templateId: "stale-template",
      installed: false,
    });
  });

  it("computes installed state from Common Staff bots", async () => {
    clawHive.listPrefabAgentTemplates.mockResolvedValue([makeTemplate()]);
    installedApplications.findByApplicationId.mockResolvedValue({
      id: "common-app-1",
    });
    botService.getBotsByInstalledApplicationId.mockResolvedValue([
      {
        botId: "bot-1",
        isActive: true,
        managedMeta: { prefabTemplateId: "sales-analyst" },
        extra: {},
      },
    ]);

    const result = await service.listRecommendedStaff("tenant-1");

    expect(result[0]).toMatchObject({
      installed: true,
      installedBotId: "bot-1",
    });
  });
});
```

- [ ] **Step 4.2: Run the failing catalog tests**

Run:

```bash
pnpm --filter @team9/gateway test -- agent-hub/agent-hub.service.spec.ts --runInBand
```

Expected: FAIL because `AgentHubService` does not exist.

- [ ] **Step 4.3: Add AgentHub types**

Create `apps/server/apps/gateway/src/agent-hub/agent-hub.types.ts`:

```ts
import type { HiveModelRef } from "@team9/claw-hive";

export const AGENT_HUB_RECOMMENDED_STAFF_CACHE_KEY =
  "agent-hub:team9-prefab-staff:v1";
export const AGENT_HUB_RECOMMENDED_STAFF_CACHE_TTL_SECONDS = 24 * 60 * 60;
export const AGENT_HUB_RECOMMENDED_STAFF_FRESH_MS = 5 * 60 * 1000;
export const DEFAULT_RECOMMENDED_STAFF_MODEL: HiveModelRef = {
  provider: "openrouter",
  id: "anthropic/claude-sonnet-4.6",
};

export interface Team9PrefabStaffMetadata {
  displayName?: string;
  roleTitle: string;
  shortRoleTitle?: string;
  persona?: string;
  jobDescription?: string;
  avatarUrl?: string;
  model?: HiveModelRef;
  unique?: boolean;
}

export interface CachedRecommendedStaffTemplate {
  templateId: string;
  name: string;
  description: string | null;
  displayName: string;
  roleTitle: string;
  shortRoleTitle: string | null;
  persona: string | null;
  jobDescription: string | null;
  avatarUrl: string | null;
  model: HiveModelRef;
  blueprintId: string;
  componentConfigs: Record<string, Record<string, unknown>>;
  unique: boolean;
}

export interface RecommendedStaffTemplate {
  templateId: string;
  name: string;
  description: string | null;
  displayName: string;
  roleTitle: string;
  shortRoleTitle: string | null;
  persona: string | null;
  jobDescription: string | null;
  avatarUrl: string | null;
  model: HiveModelRef;
  unique: boolean;
  installed: boolean;
  installedBotId?: string;
}

export interface RecommendedStaffCachePayload {
  cachedAt: string;
  templates: CachedRecommendedStaffTemplate[];
}
```

- [ ] **Step 4.4: Implement catalog cache/list logic**

Create `apps/server/apps/gateway/src/agent-hub/agent-hub.service.ts` with catalog behavior first:

```ts
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  BadRequestException,
  Inject,
} from "@nestjs/common";
import {
  DATABASE_CONNECTION,
  and,
  eq,
  type PostgresJsDatabase,
} from "@team9/database";
import * as schema from "@team9/database/schemas";
import {
  ClawHiveService,
  type HivePrefabAgentTemplate,
} from "@team9/claw-hive";
import { RedisService } from "@team9/redis";
import { InstalledApplicationsService } from "../applications/installed-applications.service.js";
import {
  StaffService,
  type StaffBotResult,
} from "../applications/staff.service.js";
import { BotService } from "../bot/bot.service.js";
import { ChannelsService } from "../im/channels/channels.service.js";
import type { InstallRecommendedStaffDto } from "./dto/install-recommended-staff.dto.js";
import {
  AGENT_HUB_RECOMMENDED_STAFF_CACHE_KEY,
  AGENT_HUB_RECOMMENDED_STAFF_CACHE_TTL_SECONDS,
  AGENT_HUB_RECOMMENDED_STAFF_FRESH_MS,
  DEFAULT_RECOMMENDED_STAFF_MODEL,
  type CachedRecommendedStaffTemplate,
  type RecommendedStaffCachePayload,
  type RecommendedStaffTemplate,
  type Team9PrefabStaffMetadata,
} from "./agent-hub.types.js";

const COMMON_STAFF_APPLICATION_ID = "common-staff";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getTeam9Metadata(
  template: HivePrefabAgentTemplate,
): Team9PrefabStaffMetadata | null {
  const team9 = template.metadata?.team9;
  if (!isObject(team9)) return null;
  const roleTitle = stringOrNull(team9.roleTitle);
  if (!roleTitle) return null;
  return {
    displayName: stringOrNull(team9.displayName) ?? undefined,
    roleTitle,
    shortRoleTitle: stringOrNull(team9.shortRoleTitle) ?? undefined,
    persona: stringOrNull(team9.persona) ?? undefined,
    jobDescription: stringOrNull(team9.jobDescription) ?? undefined,
    avatarUrl: stringOrNull(team9.avatarUrl) ?? undefined,
    model: isObject(team9.model)
      ? {
          provider: String(team9.model.provider ?? ""),
          id: String(team9.model.id ?? ""),
        }
      : undefined,
    unique: team9.unique === true,
  };
}

function normalizeTemplate(
  template: HivePrefabAgentTemplate,
): CachedRecommendedStaffTemplate | null {
  const team9 = getTeam9Metadata(template);
  if (!team9) return null;
  const model =
    team9.model ?? template.model ?? DEFAULT_RECOMMENDED_STAFF_MODEL;
  if (!model.provider || !model.id) return null;
  return {
    templateId: template.id,
    name: template.name,
    description: stringOrNull(template.description),
    displayName: team9.displayName ?? template.name,
    roleTitle: team9.roleTitle,
    shortRoleTitle: team9.shortRoleTitle ?? null,
    persona: team9.persona ?? null,
    jobDescription: team9.jobDescription ?? null,
    avatarUrl: team9.avatarUrl ?? null,
    model,
    blueprintId: template.blueprintId,
    componentConfigs: template.componentConfigs ?? {},
    unique: team9.unique === true,
  };
}

@Injectable()
export class AgentHubService {
  private readonly logger = new Logger(AgentHubService.name);

  constructor(
    private readonly clawHive: ClawHiveService,
    private readonly redis: RedisService,
    private readonly installedApplications: InstalledApplicationsService,
    private readonly staff: StaffService,
    private readonly bots: BotService,
    private readonly channels: ChannelsService,
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async listRecommendedStaff(
    tenantId: string,
  ): Promise<RecommendedStaffTemplate[]> {
    const templates = await this.getCachedTemplates();
    return this.withInstalledState(tenantId, templates);
  }

  private async getCachedTemplates(): Promise<
    CachedRecommendedStaffTemplate[]
  > {
    const cached = await this.readCache();
    if (cached && this.isFresh(cached)) {
      return cached.templates;
    }

    try {
      const templates = await this.refreshTemplates();
      return templates;
    } catch (error) {
      if (cached) {
        this.logger.warn(
          `Using stale AgentHub recommended staff cache after Hive failure: ${error}`,
        );
        return cached.templates;
      }
      throw new ServiceUnavailableException(
        "AgentHub recommended staff is temporarily unavailable",
      );
    }
  }

  private async refreshTemplates(): Promise<CachedRecommendedStaffTemplate[]> {
    const raw = await this.clawHive.listPrefabAgentTemplates();
    const templates = raw
      .map((template) => normalizeTemplate(template))
      .filter((template): template is CachedRecommendedStaffTemplate =>
        Boolean(template),
      );
    await this.redis.set(
      AGENT_HUB_RECOMMENDED_STAFF_CACHE_KEY,
      JSON.stringify({ cachedAt: new Date().toISOString(), templates }),
      AGENT_HUB_RECOMMENDED_STAFF_CACHE_TTL_SECONDS,
    );
    return templates;
  }

  private async readCache(): Promise<RecommendedStaffCachePayload | null> {
    const raw = await this.redis.get(AGENT_HUB_RECOMMENDED_STAFF_CACHE_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as RecommendedStaffCachePayload;
      if (!Array.isArray(parsed.templates) || !parsed.cachedAt) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private isFresh(payload: RecommendedStaffCachePayload): boolean {
    const cachedAt = Date.parse(payload.cachedAt);
    return Number.isFinite(cachedAt)
      ? Date.now() - cachedAt <= AGENT_HUB_RECOMMENDED_STAFF_FRESH_MS
      : false;
  }

  private async withInstalledState(
    tenantId: string,
    templates: CachedRecommendedStaffTemplate[],
  ): Promise<RecommendedStaffTemplate[]> {
    const app = await this.installedApplications.findByApplicationId(
      tenantId,
      COMMON_STAFF_APPLICATION_ID,
    );
    const installed = new Map<string, string>();
    if (app) {
      const bots = await this.bots.getBotsByInstalledApplicationId(app.id);
      for (const bot of bots) {
        if (!bot.isActive) continue;
        const templateId =
          (bot.managedMeta?.prefabTemplateId as string | undefined) ??
          bot.extra?.commonStaff?.prefabTemplateId;
        if (templateId && !installed.has(templateId)) {
          installed.set(templateId, bot.botId);
        }
      }
    }

    return templates.map((template) => {
      const installedBotId = installed.get(template.templateId);
      return {
        templateId: template.templateId,
        name: template.name,
        description: template.description,
        displayName: template.displayName,
        roleTitle: template.roleTitle,
        shortRoleTitle: template.shortRoleTitle,
        persona: template.persona,
        jobDescription: template.jobDescription,
        avatarUrl: template.avatarUrl,
        model: template.model,
        unique: template.unique,
        installed: Boolean(installedBotId),
        ...(installedBotId ? { installedBotId } : {}),
      };
    });
  }
}
```

The imports include install dependencies that will be used in Task 5. TypeScript allows unused private constructor dependencies only if `noUnusedLocals` is not enforced; if lint flags them, Task 5 will use them before lint verification.

- [ ] **Step 4.5: Verify catalog tests pass**

Run:

```bash
pnpm --filter @team9/gateway test -- agent-hub/agent-hub.service.spec.ts --runInBand
```

Expected: PASS for catalog tests.

## Task 5: AgentHub Recommended Staff Install

**Files:**

- Create: `apps/server/apps/gateway/src/agent-hub/dto/install-recommended-staff.dto.ts`
- Modify: `apps/server/apps/gateway/src/agent-hub/agent-hub.service.ts`
- Modify: `apps/server/apps/gateway/src/agent-hub/agent-hub.service.spec.ts`

- [ ] **Step 5.1: Add failing install tests**

Append these tests inside `describe('AgentHubService catalog', ...)` in `apps/server/apps/gateway/src/agent-hub/agent-hub.service.spec.ts`:

```ts
it("installs a unique recommended staff template without mentor by default", async () => {
  clawHive.listPrefabAgentTemplates.mockResolvedValue([makeTemplate()]);
  installedApplications.findByApplicationId.mockResolvedValue({
    id: "common-app-1",
    applicationId: "common-staff",
  });
  staffService.createBotWithAgent.mockResolvedValue({
    botId: "bot-1",
    userId: "bot-user-1",
    agentId: "common-staff-bot-1",
    displayName: "Sales Analyst",
  });

  const result = await service.installRecommendedStaff(
    "tenant-1",
    "installer-1",
    "sales-analyst",
    {},
  );

  expect(result).toEqual({
    botId: "bot-1",
    userId: "bot-user-1",
    agentId: "common-staff-bot-1",
    displayName: "Sales Analyst",
  });
  expect(staffService.createBotWithAgent).toHaveBeenCalledWith(
    expect.objectContaining({
      blueprintId: "team9-common-staff",
      ownerId: "installer-1",
      tenantId: "tenant-1",
      installedApplicationId: "common-app-1",
      mentorId: null,
      managedMeta: { prefabTemplateId: "sales-analyst" },
      botExtra: expect.objectContaining({
        commonStaff: expect.objectContaining({
          roleTitle: "Sales Operations Analyst",
          shortRoleTitle: "Sales Ops",
          prefabTemplateId: "sales-analyst",
        }),
      }),
    }),
  );
  expect(channelsService.createDirectChannel).not.toHaveBeenCalled();
});

it("rejects duplicate installs for unique templates", async () => {
  clawHive.listPrefabAgentTemplates.mockResolvedValue([makeTemplate()]);
  installedApplications.findByApplicationId.mockResolvedValue({
    id: "common-app-1",
  });
  botService.getBotsByInstalledApplicationId.mockResolvedValue([
    {
      botId: "bot-existing",
      isActive: true,
      managedMeta: { prefabTemplateId: "sales-analyst" },
      extra: {},
    },
  ]);

  await expect(
    service.installRecommendedStaff(
      "tenant-1",
      "installer-1",
      "sales-analyst",
      {},
    ),
  ).rejects.toBeInstanceOf(ConflictException);
});

it("generates short role title when the template does not provide one", async () => {
  clawHive.listPrefabAgentTemplates.mockResolvedValue([
    makeTemplate({
      metadata: {
        team9: {
          displayName: "Support Specialist",
          roleTitle: "Customer Support Specialist",
          unique: false,
        },
      },
    }),
  ]);
  installedApplications.findByApplicationId.mockResolvedValue({
    id: "common-app-1",
  });
  staffService.generateShortRoleTitle.mockResolvedValue("Support");
  staffService.createBotWithAgent.mockResolvedValue({
    botId: "bot-2",
    userId: "bot-user-2",
    agentId: "common-staff-bot-2",
    displayName: "Support Specialist",
  });

  await service.installRecommendedStaff(
    "tenant-1",
    "installer-1",
    "sales-analyst",
    {},
  );

  expect(staffService.generateShortRoleTitle).toHaveBeenCalledWith({
    tenantId: "tenant-1",
    installedApplicationId: "common-app-1",
    roleTitle: "Customer Support Specialist",
  });
  expect(staffService.createBotWithAgent).toHaveBeenCalledWith(
    expect.objectContaining({
      botExtra: expect.objectContaining({
        commonStaff: expect.objectContaining({ shortRoleTitle: "Support" }),
      }),
    }),
  );
});

it("validates mentor only when mentorId is provided and creates mentor DM", async () => {
  const query = {
    from: jest.fn<any>().mockReturnThis(),
    where: jest.fn<any>().mockReturnThis(),
    limit: jest.fn<any>().mockResolvedValue([{ userId: "mentor-1" }]),
  };
  db.select.mockReturnValue(query);
  clawHive.listPrefabAgentTemplates.mockResolvedValue([makeTemplate()]);
  installedApplications.findByApplicationId.mockResolvedValue({
    id: "common-app-1",
  });
  staffService.createBotWithAgent.mockResolvedValue({
    botId: "bot-1",
    userId: "bot-user-1",
    agentId: "common-staff-bot-1",
    displayName: "Sales Analyst",
  });

  await service.installRecommendedStaff(
    "tenant-1",
    "installer-1",
    "sales-analyst",
    { mentorId: "mentor-1" },
  );

  expect(staffService.createBotWithAgent).toHaveBeenCalledWith(
    expect.objectContaining({ mentorId: "mentor-1" }),
  );
  expect(channelsService.createDirectChannel).toHaveBeenCalledWith(
    "bot-user-1",
    "mentor-1",
    "tenant-1",
  );
});
```

- [ ] **Step 5.2: Run failing install tests**

Run:

```bash
pnpm --filter @team9/gateway test -- agent-hub/agent-hub.service.spec.ts --runInBand
```

Expected: FAIL because `installRecommendedStaff` and DTO do not exist.

- [ ] **Step 5.3: Add install DTO**

Create `apps/server/apps/gateway/src/agent-hub/dto/install-recommended-staff.dto.ts`:

```ts
import { IsOptional, IsString } from "class-validator";

export class InstallRecommendedStaffDto {
  @IsOptional()
  @IsString()
  mentorId?: string | null;
}
```

- [ ] **Step 5.4: Implement install helpers**

In `apps/server/apps/gateway/src/agent-hub/agent-hub.service.ts`, add these private helpers inside the class:

```ts
  private async getTemplateById(
    templateId: string,
  ): Promise<CachedRecommendedStaffTemplate> {
    const cached = await this.getCachedTemplates();
    const found = cached.find((template) => template.templateId === templateId);
    if (found) return found;

    const refreshed = await this.refreshTemplates();
    const refreshedFound = refreshed.find(
      (template) => template.templateId === templateId,
    );
    if (!refreshedFound) {
      throw new NotFoundException(`Recommended staff template ${templateId} not found`);
    }
    return refreshedFound;
  }

  private async getCommonStaffApp(tenantId: string, actorUserId: string) {
    let app = await this.installedApplications.findByApplicationId(
      tenantId,
      COMMON_STAFF_APPLICATION_ID,
    );
    if (app) return app;

    await this.installedApplications.ensureAutoInstallApps(tenantId, actorUserId);
    app = await this.installedApplications.findByApplicationId(
      tenantId,
      COMMON_STAFF_APPLICATION_ID,
    );
    if (!app) {
      throw new ServiceUnavailableException('Common Staff app is not installed');
    }
    return app;
  }

  private async findInstalledTemplateBot(
    installedApplicationId: string,
    templateId: string,
  ): Promise<string | null> {
    const bots = await this.bots.getBotsByInstalledApplicationId(
      installedApplicationId,
    );
    const found = bots.find((bot) => {
      if (!bot.isActive) return false;
      return (
        bot.managedMeta?.prefabTemplateId === templateId ||
        bot.extra?.commonStaff?.prefabTemplateId === templateId
      );
    });
    return found?.botId ?? null;
  }

  private async validateMentor(
    tenantId: string,
    mentorId: string | null | undefined,
  ): Promise<string | null> {
    if (!mentorId) return null;
    const [member] = await this.db
      .select({ userId: schema.tenantMembers.userId })
      .from(schema.tenantMembers)
      .where(
        and(
          eq(schema.tenantMembers.tenantId, tenantId),
          eq(schema.tenantMembers.userId, mentorId),
        ),
      )
      .limit(1);
    if (!member) {
      throw new BadRequestException(
        `Mentor ${mentorId} is not a member of this workspace`,
      );
    }
    return mentorId;
  }

  private requiredTeam9ComponentConfigs(
    tenantId: string,
  ): Record<string, Record<string, unknown>> {
    return {
      'team9-staff-profile': {},
      'team9-staff-soul': {},
      folder9: {
        folder9Url: process.env.FOLDER9_API_URL,
        workspaceId: tenantId,
      },
      'just-bash': { network: 'none' },
      'just-bash-team9-workspace': { mountTeam9Skills: true },
    };
  }
```

- [ ] **Step 5.5: Implement `installRecommendedStaff`**

Add this public method to `AgentHubService`:

```ts
  async installRecommendedStaff(
    tenantId: string,
    actorUserId: string,
    templateId: string,
    dto: InstallRecommendedStaffDto,
  ): Promise<StaffBotResult> {
    const template = await this.getTemplateById(templateId);
    const app = await this.getCommonStaffApp(tenantId, actorUserId);

    const existingBotId = await this.findInstalledTemplateBot(
      app.id,
      template.templateId,
    );
    if (template.unique && existingBotId) {
      throw new ConflictException({
        message: 'Recommended staff template is already installed',
        botId: existingBotId,
      });
    }

    const mentorId = await this.validateMentor(tenantId, dto.mentorId);
    const shortRoleTitle =
      template.shortRoleTitle ??
      (await this.generateShortRoleTitleOrNull(
        tenantId,
        app.id,
        template.roleTitle,
      ));

    const result = await this.staff.createBotWithAgent({
      agentIdPrefix: 'common-staff',
      blueprintId: template.blueprintId,
      ownerId: actorUserId,
      tenantId,
      displayName: template.displayName,
      installedApplicationId: app.id,
      mentorId,
      avatarUrl: template.avatarUrl ?? undefined,
      model: template.model,
      managedMeta: { prefabTemplateId: template.templateId },
      botExtra: {
        commonStaff: {
          roleTitle: template.roleTitle,
          shortRoleTitle,
          persona: template.persona ?? undefined,
          jobDescription: template.jobDescription ?? undefined,
          model: template.model,
          prefabTemplateId: template.templateId,
          identity: { name: template.displayName },
        },
      },
      extraComponentConfigs: {
        ...template.componentConfigs,
        ...this.requiredTeam9ComponentConfigs(tenantId),
      },
    });

    if (mentorId) {
      await this.channels.createDirectChannel(result.userId, mentorId, tenantId);
    }

    return result;
  }

  private async generateShortRoleTitleOrNull(
    tenantId: string,
    installedApplicationId: string,
    roleTitle: string,
  ): Promise<string | null> {
    try {
      return await this.staff.generateShortRoleTitle({
        tenantId,
        installedApplicationId,
        roleTitle,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to generate short role title for recommended staff: ${error}`,
      );
      return null;
    }
  }
```

- [ ] **Step 5.6: Verify install tests pass**

Run:

```bash
pnpm --filter @team9/gateway test -- agent-hub/agent-hub.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5.7: Commit AgentHub service**

```bash
git add apps/server/apps/gateway/src/agent-hub/agent-hub.types.ts \
        apps/server/apps/gateway/src/agent-hub/agent-hub.service.ts \
        apps/server/apps/gateway/src/agent-hub/agent-hub.service.spec.ts \
        apps/server/apps/gateway/src/agent-hub/dto/install-recommended-staff.dto.ts
git commit -m "feat(agent-hub): list and install recommended staff"
```

## Task 6: AgentHub Controller and Module Wiring

**Files:**

- Create: `apps/server/apps/gateway/src/agent-hub/agent-hub.controller.ts`
- Create: `apps/server/apps/gateway/src/agent-hub/agent-hub.controller.spec.ts`
- Create: `apps/server/apps/gateway/src/agent-hub/agent-hub.module.ts`
- Modify: `apps/server/apps/gateway/src/app.module.ts`

- [ ] **Step 6.1: Write failing controller tests**

Create `apps/server/apps/gateway/src/agent-hub/agent-hub.controller.spec.ts`:

```ts
import { Test, TestingModule } from "@nestjs/testing";
import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { AgentHubController } from "./agent-hub.controller.js";
import { AgentHubService } from "./agent-hub.service.js";

describe("AgentHubController", () => {
  let controller: AgentHubController;
  let service: {
    listRecommendedStaff: jest.Mock<(...args: any[]) => any>;
    installRecommendedStaff: jest.Mock<(...args: any[]) => any>;
  };

  beforeEach(async () => {
    service = {
      listRecommendedStaff: jest.fn<any>().mockResolvedValue([
        {
          templateId: "sales-analyst",
          displayName: "Sales Analyst",
          roleTitle: "Sales Operations Analyst",
          shortRoleTitle: "Sales Ops",
          model: { provider: "openrouter", id: "anthropic/claude-sonnet-4.6" },
          unique: true,
          installed: false,
        },
      ]),
      installRecommendedStaff: jest.fn<any>().mockResolvedValue({
        botId: "bot-1",
        userId: "bot-user-1",
        agentId: "common-staff-bot-1",
        displayName: "Sales Analyst",
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AgentHubController],
      providers: [{ provide: AgentHubService, useValue: service }],
    }).compile();

    controller = module.get(AgentHubController);
  });

  it("lists recommended staff for the current tenant", async () => {
    const result = await controller.listRecommendedStaff("tenant-1");

    expect(service.listRecommendedStaff).toHaveBeenCalledWith("tenant-1");
    expect(result[0].templateId).toBe("sales-analyst");
  });

  it("installs recommended staff with nullable mentor body", async () => {
    const result = await controller.installRecommendedStaff(
      "sales-analyst",
      "tenant-1",
      "user-1",
      { mentorId: null },
    );

    expect(service.installRecommendedStaff).toHaveBeenCalledWith(
      "tenant-1",
      "user-1",
      "sales-analyst",
      { mentorId: null },
    );
    expect(result.botId).toBe("bot-1");
  });
});
```

- [ ] **Step 6.2: Run failing controller tests**

Run:

```bash
pnpm --filter @team9/gateway test -- agent-hub/agent-hub.controller.spec.ts --runInBand
```

Expected: FAIL because the controller does not exist.

- [ ] **Step 6.3: Add controller**

Create `apps/server/apps/gateway/src/agent-hub/agent-hub.controller.ts`:

```ts
import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { AuthGuard, CurrentUser } from "@team9/auth";
import { CurrentTenantId } from "../common/decorators/current-tenant.decorator.js";
import { WorkspaceGuard } from "../workspace/guards/workspace.guard.js";
import { AgentHubService } from "./agent-hub.service.js";
import { InstallRecommendedStaffDto } from "./dto/install-recommended-staff.dto.js";

@Controller({
  path: "agent-hub",
  version: "1",
})
@UseGuards(AuthGuard, WorkspaceGuard)
export class AgentHubController {
  constructor(private readonly agentHub: AgentHubService) {}

  @Get("recommended-staff")
  listRecommendedStaff(@CurrentTenantId() tenantId: string) {
    return this.agentHub.listRecommendedStaff(tenantId);
  }

  @Post("recommended-staff/:templateId/install")
  installRecommendedStaff(
    @Param("templateId") templateId: string,
    @CurrentTenantId() tenantId: string,
    @CurrentUser("sub") userId: string,
    @Body() dto: InstallRecommendedStaffDto,
  ) {
    return this.agentHub.installRecommendedStaff(
      tenantId,
      userId,
      templateId,
      dto,
    );
  }
}
```

- [ ] **Step 6.4: Add module**

Create `apps/server/apps/gateway/src/agent-hub/agent-hub.module.ts`:

```ts
import { Module, forwardRef } from "@nestjs/common";
import { RedisModule } from "@team9/redis";
import { ClawHiveModule } from "@team9/claw-hive";
import { ApplicationsModule } from "../applications/applications.module.js";
import { ChannelsModule } from "../im/channels/channels.module.js";
import { AgentHubController } from "./agent-hub.controller.js";
import { AgentHubService } from "./agent-hub.service.js";

@Module({
  imports: [
    RedisModule,
    ClawHiveModule,
    forwardRef(() => ApplicationsModule),
    forwardRef(() => ChannelsModule),
  ],
  controllers: [AgentHubController],
  providers: [AgentHubService],
  exports: [AgentHubService],
})
export class AgentHubModule {}
```

- [ ] **Step 6.5: Import module in AppModule**

In `apps/server/apps/gateway/src/app.module.ts`, add import:

```ts
import { AgentHubModule } from "./agent-hub/agent-hub.module.js";
```

Add `AgentHubModule` to the `imports` array after `ApplicationsModule`:

```ts
    ApplicationsModule,
    AgentHubModule,
```

- [ ] **Step 6.6: Verify controller tests pass**

Run:

```bash
pnpm --filter @team9/gateway test -- agent-hub/agent-hub.controller.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 6.7: Run all AgentHub backend tests**

Run:

```bash
pnpm --filter @team9/gateway test -- agent-hub/agent-hub.service.spec.ts agent-hub/agent-hub.controller.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 6.8: Commit controller/module wiring**

```bash
git add apps/server/apps/gateway/src/agent-hub/agent-hub.controller.ts \
        apps/server/apps/gateway/src/agent-hub/agent-hub.controller.spec.ts \
        apps/server/apps/gateway/src/agent-hub/agent-hub.module.ts \
        apps/server/apps/gateway/src/app.module.ts
git commit -m "feat(agent-hub): expose recommended staff api"
```

## Task 7: Frontend API Client

**Files:**

- Modify: `apps/client/src/services/api/applications.ts`
- Create: `apps/client/src/services/api/__tests__/applications.test.ts`

- [ ] **Step 7.1: Write failing API client tests**

Create `apps/client/src/services/api/__tests__/applications.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockHttp = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock("../../http", () => ({
  __esModule: true,
  default: mockHttp,
  API_BASE_URL: "http://localhost:3000/api",
}));

import applicationsApi from "../applications";

describe("applicationsApi AgentHub methods", () => {
  beforeEach(() => {
    mockHttp.get.mockReset();
    mockHttp.post.mockReset();
  });

  it("gets recommended staff templates from AgentHub", async () => {
    mockHttp.get.mockResolvedValueOnce({
      data: [{ templateId: "sales-analyst", displayName: "Sales Analyst" }],
    });

    const result = await applicationsApi.getRecommendedStaffTemplates();

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/v1/agent-hub/recommended-staff",
    );
    expect(result[0].templateId).toBe("sales-analyst");
  });

  it("installs recommended staff without mentor by default", async () => {
    mockHttp.post.mockResolvedValueOnce({
      data: {
        botId: "bot-1",
        userId: "bot-user-1",
        agentId: "common-staff-bot-1",
        displayName: "Sales Analyst",
      },
    });

    const result =
      await applicationsApi.installRecommendedStaff("sales-analyst");

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/v1/agent-hub/recommended-staff/sales-analyst/install",
      {},
    );
    expect(result.botId).toBe("bot-1");
  });

  it("passes explicit mentorId when provided", async () => {
    mockHttp.post.mockResolvedValueOnce({ data: { botId: "bot-1" } });

    await applicationsApi.installRecommendedStaff("sales-analyst", {
      mentorId: "mentor-1",
    });

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/v1/agent-hub/recommended-staff/sales-analyst/install",
      { mentorId: "mentor-1" },
    );
  });
});
```

- [ ] **Step 7.2: Run failing API tests**

Run:

```bash
pnpm --filter @team9/client test -- src/services/api/__tests__/applications.test.ts
```

Expected: FAIL because the new methods do not exist.

- [ ] **Step 7.3: Add frontend types and methods**

In `apps/client/src/services/api/applications.ts`, add these interfaces near the Common Staff types:

```ts
export interface RecommendedStaffTemplate {
  templateId: string;
  name: string;
  description: string | null;
  displayName: string;
  roleTitle: string;
  shortRoleTitle: string | null;
  persona: string | null;
  jobDescription: string | null;
  avatarUrl: string | null;
  model: { provider: string; id: string };
  unique: boolean;
  installed: boolean;
  installedBotId?: string;
}

export interface InstallRecommendedStaffDto {
  mentorId?: string | null;
}
```

Add these methods near the top of `applicationsApi`:

```ts
  getRecommendedStaffTemplates: async (): Promise<
    RecommendedStaffTemplate[]
  > => {
    const response = await http.get<RecommendedStaffTemplate[]>(
      '/v1/agent-hub/recommended-staff',
    );
    return response.data;
  },

  installRecommendedStaff: async (
    templateId: string,
    body: InstallRecommendedStaffDto = {},
  ): Promise<StaffBotResult> => {
    const response = await http.post<StaffBotResult>(
      `/v1/agent-hub/recommended-staff/${encodeURIComponent(templateId)}/install`,
      body,
    );
    return response.data;
  },
```

- [ ] **Step 7.4: Verify API tests pass**

Run:

```bash
pnpm --filter @team9/client test -- src/services/api/__tests__/applications.test.ts
```

Expected: PASS.

- [ ] **Step 7.5: Commit frontend API client**

```bash
git add apps/client/src/services/api/applications.ts \
        apps/client/src/services/api/__tests__/applications.test.ts
git commit -m "feat(agent-hub): add recommended staff client api"
```

## Task 8: RecommendedStaffSection UI

**Files:**

- Create: `apps/client/src/components/ai-staff/RecommendedStaffSection.tsx`
- Create: `apps/client/src/components/ai-staff/__tests__/RecommendedStaffSection.test.tsx`

- [ ] **Step 8.1: Write failing UI tests**

Create `apps/client/src/components/ai-staff/__tests__/RecommendedStaffSection.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecommendedStaffTemplate } from "@/services/api/applications";

const mockNavigate = vi.hoisted(() => vi.fn());
const mockGetRecommendedStaffTemplates = vi.hoisted(() => vi.fn());
const mockInstallRecommendedStaff = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        recommendedStaffSection: "Recommended Staff",
        recommendedStaffEmpty: "No recommended staff yet",
        recommendedStaffInstall: "Install",
        recommendedStaffInstalled: "Installed",
        recommendedStaffInstallFailed: "Failed to install recommended staff",
      })[key] ?? key,
  }),
}));

vi.mock("@/services/api", () => ({
  api: {
    applications: {
      getRecommendedStaffTemplates: mockGetRecommendedStaffTemplates,
      installRecommendedStaff: mockInstallRecommendedStaff,
    },
  },
}));

import { RecommendedStaffSection } from "../RecommendedStaffSection";

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RecommendedStaffSection workspaceId="workspace-1" />
    </QueryClientProvider>,
  );
}

function template(
  overrides: Partial<RecommendedStaffTemplate> = {},
): RecommendedStaffTemplate {
  return {
    templateId: "sales-analyst",
    name: "Sales Analyst",
    description: "Analyzes pipeline health",
    displayName: "Sales Analyst",
    roleTitle: "Sales Operations Analyst",
    shortRoleTitle: "Sales Ops",
    persona: null,
    jobDescription: "Reviews sales pipeline risks",
    avatarUrl: null,
    model: { provider: "openrouter", id: "anthropic/claude-sonnet-4.6" },
    unique: true,
    installed: false,
    ...overrides,
  };
}

describe("RecommendedStaffSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders installable recommended staff templates", async () => {
    mockGetRecommendedStaffTemplates.mockResolvedValue([template()]);

    renderSection();

    expect(await screen.findByText("Recommended Staff")).toBeInTheDocument();
    expect(screen.getByText("Sales Analyst")).toBeInTheDocument();
    expect(screen.getByText("Sales Operations Analyst")).toBeInTheDocument();
    expect(screen.getByText("Sales Ops")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install" })).toBeEnabled();
  });

  it("shows installed state and navigates to the installed bot", async () => {
    mockGetRecommendedStaffTemplates.mockResolvedValue([
      template({ installed: true, installedBotId: "bot-1" }),
    ]);

    renderSection();

    const card = await screen.findByText("Sales Analyst");
    expect(screen.getByRole("button", { name: "Installed" })).toBeDisabled();
    fireEvent.click(card);

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/ai-staff/$staffId",
      params: { staffId: "bot-1" },
    });
  });

  it("installs a template without mentor and navigates to the new staff", async () => {
    mockGetRecommendedStaffTemplates.mockResolvedValue([template()]);
    mockInstallRecommendedStaff.mockResolvedValue({
      botId: "bot-new",
      userId: "bot-user-new",
      agentId: "common-staff-bot-new",
      displayName: "Sales Analyst",
    });

    renderSection();

    fireEvent.click(await screen.findByRole("button", { name: "Install" }));

    await waitFor(() => {
      expect(mockInstallRecommendedStaff).toHaveBeenCalledWith("sales-analyst");
    });
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/ai-staff/$staffId",
      params: { staffId: "bot-new" },
    });
  });
});
```

- [ ] **Step 8.2: Run failing UI tests**

Run:

```bash
pnpm --filter @team9/client test -- src/components/ai-staff/__tests__/RecommendedStaffSection.test.tsx
```

Expected: FAIL because `RecommendedStaffSection` does not exist.

- [ ] **Step 8.3: Implement RecommendedStaffSection**

Create `apps/client/src/components/ai-staff/RecommendedStaffSection.tsx`:

```tsx
import { AlertCircle, Bot, Check, Loader2, Plus } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/services/api";
import type { RecommendedStaffTemplate } from "@/services/api/applications";

interface RecommendedStaffSectionProps {
  workspaceId: string | null | undefined;
}

function initials(name: string) {
  return name.slice(0, 2).toUpperCase();
}

function RecommendedStaffCard({
  template,
  onInstall,
  installing,
}: {
  template: RecommendedStaffTemplate;
  onInstall: (templateId: string) => void;
  installing: boolean;
}) {
  const { t } = useTranslation("navigation");
  const navigate = useNavigate();
  const canNavigate = template.installed && template.installedBotId;

  const handleCardClick = () => {
    if (!canNavigate) return;
    navigate({
      to: "/ai-staff/$staffId",
      params: { staffId: template.installedBotId! },
    });
  };

  const summary =
    template.description ?? template.jobDescription ?? template.persona ?? "";

  return (
    <Card
      onClick={handleCardClick}
      className={`p-4 transition-all hover:shadow-md ${canNavigate ? "cursor-pointer" : ""}`}
    >
      <div className="flex items-start gap-4">
        <Avatar className="h-12 w-12">
          {template.avatarUrl ? (
            <AvatarImage src={template.avatarUrl} alt={template.displayName} />
          ) : null}
          <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">
            {initials(template.displayName)}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-semibold text-foreground">
              {template.displayName}
            </p>
            {template.shortRoleTitle ? (
              <Badge variant="outline" className="shrink-0 text-[10px]">
                {template.shortRoleTitle}
              </Badge>
            ) : null}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {template.roleTitle}
          </p>
          {summary ? (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
              {summary}
            </p>
          ) : null}
        </div>

        <Button
          size="sm"
          variant={template.installed ? "secondary" : "default"}
          disabled={template.installed || installing}
          onClick={(event) => {
            event.stopPropagation();
            onInstall(template.templateId);
          }}
          className="shrink-0 gap-1 text-xs"
        >
          {installing ? (
            <Loader2 size={14} className="animate-spin" />
          ) : template.installed ? (
            <Check size={14} />
          ) : (
            <Plus size={14} />
          )}
          {template.installed
            ? t("recommendedStaffInstalled")
            : t("recommendedStaffInstall")}
        </Button>
      </div>
    </Card>
  );
}

export function RecommendedStaffSection({
  workspaceId,
}: RecommendedStaffSectionProps) {
  const { t } = useTranslation("navigation");
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["agent-hub-recommended-staff", workspaceId],
    queryFn: () => api.applications.getRecommendedStaffTemplates(),
    enabled: Boolean(workspaceId),
  });

  const installMutation = useMutation({
    mutationFn: (templateId: string) =>
      api.applications.installRecommendedStaff(templateId),
    onSuccess: (result) => {
      queryClient.invalidateQueries({
        queryKey: ["agent-hub-recommended-staff", workspaceId],
      });
      queryClient.invalidateQueries({
        queryKey: ["installed-applications-with-bots", workspaceId],
      });
      navigate({
        to: "/ai-staff/$staffId",
        params: { staffId: result.botId },
      });
    },
    onError: () => {
      queryClient.invalidateQueries({
        queryKey: ["agent-hub-recommended-staff", workspaceId],
      });
      window.alert(t("recommendedStaffInstallFailed"));
    },
  });

  const templates = query.data ?? [];

  return (
    <div>
      <button className="flex w-full items-center gap-2 px-1 py-2 text-sm font-semibold text-muted-foreground">
        <Bot size={14} />
        <span>{t("recommendedStaffSection")}</span>
        <Badge variant="secondary" className="ml-auto px-1.5 py-0 text-[10px]">
          {templates.length}
        </Badge>
      </button>

      {query.isLoading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : query.error ? (
        <Card className="p-4 text-center">
          <AlertCircle className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {t("recommendedStaffLoadFailed")}
          </p>
        </Card>
      ) : templates.length === 0 ? (
        <Card className="border-dashed p-4 text-center">
          <p className="text-sm text-muted-foreground">
            {t("recommendedStaffEmpty")}
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 pl-4 md:grid-cols-2 xl:grid-cols-3">
          {templates.map((template) => (
            <RecommendedStaffCard
              key={template.templateId}
              template={template}
              installing={
                installMutation.isPending &&
                installMutation.variables === template.templateId
              }
              onInstall={(templateId) => installMutation.mutate(templateId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 8.4: Verify RecommendedStaffSection tests pass**

Run:

```bash
pnpm --filter @team9/client test -- src/components/ai-staff/__tests__/RecommendedStaffSection.test.tsx
```

Expected: PASS.

- [ ] **Step 8.5: Commit UI component**

```bash
git add apps/client/src/components/ai-staff/RecommendedStaffSection.tsx \
        apps/client/src/components/ai-staff/__tests__/RecommendedStaffSection.test.tsx
git commit -m "feat(agent-hub): add recommended staff section"
```

## Task 9: Mount Recommended Staff on AI Staff Page

**Files:**

- Modify: `apps/client/src/components/layout/contents/AIStaffMainContent.tsx`
- Modify: `apps/client/src/components/layout/contents/__tests__/AIStaffMainContent.test.tsx`
- Modify: `apps/client/src/i18n/locales/en/navigation.json`
- Modify: `apps/client/src/i18n/locales/zh-CN/navigation.json`

- [ ] **Step 9.1: Write failing page test**

In `apps/client/src/components/layout/contents/__tests__/AIStaffMainContent.test.tsx`, add the translation keys to the test translation map:

```ts
          recommendedStaffSection: 'Recommended Staff',
          recommendedStaffEmpty: 'No recommended staff yet',
          recommendedStaffInstall: 'Install',
          recommendedStaffInstalled: 'Installed',
          recommendedStaffLoadFailed: 'Failed to load recommended staff',
          recommendedStaffInstallFailed: 'Failed to install recommended staff',
```

Mock the section before importing `AIStaffMainContent`:

```ts
vi.mock('@/components/ai-staff/RecommendedStaffSection', () => ({
  RecommendedStaffSection: ({ workspaceId }: { workspaceId?: string }) => (
    <section data-testid="recommended-staff-section">
      Recommended Staff {workspaceId}
    </section>
  ),
}));
```

Add this test:

```ts
  it('mounts recommended staff before AI Staff groups', () => {
    mockUseQuery.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    });

    render(<AIStaffMainContent />);

    expect(screen.getByTestId('recommended-staff-section')).toHaveTextContent(
      'workspace-1',
    );
  });
```

- [ ] **Step 9.2: Run failing page test**

Run:

```bash
pnpm --filter @team9/client test -- src/components/layout/contents/__tests__/AIStaffMainContent.test.tsx
```

Expected: FAIL because the section is not mounted.

- [ ] **Step 9.3: Mount the section**

In `apps/client/src/components/layout/contents/AIStaffMainContent.tsx`, add import:

```ts
import { RecommendedStaffSection } from "@/components/ai-staff/RecommendedStaffSection";
```

Inside the main content, before the "Section 2: AI Staff" block and after the first `<Separator />`, add:

```tsx
              {/* Section 2: Recommended Staff */}
              <RecommendedStaffSection workspaceId={workspaceId} />

              <Separator />

              {/* Section 3: AI Staff (grouped by app) */}
```

Then update the existing AI Staff and Members comments to keep numbering consistent.

- [ ] **Step 9.4: Add i18n keys**

In `apps/client/src/i18n/locales/en/navigation.json`, add:

```json
  "recommendedStaffSection": "Recommended Staff",
  "recommendedStaffEmpty": "No recommended staff yet",
  "recommendedStaffInstall": "Install",
  "recommendedStaffInstalled": "Installed",
  "recommendedStaffLoadFailed": "Failed to load recommended staff",
  "recommendedStaffInstallFailed": "Failed to install recommended staff"
```

In `apps/client/src/i18n/locales/zh-CN/navigation.json`, add:

```json
  "recommendedStaffSection": "推荐员工",
  "recommendedStaffEmpty": "暂无推荐员工",
  "recommendedStaffInstall": "安装",
  "recommendedStaffInstalled": "已安装",
  "recommendedStaffLoadFailed": "推荐员工加载失败",
  "recommendedStaffInstallFailed": "推荐员工安装失败"
```

If JSON ordering is alphabetical in these files, insert the keys in the nearest existing navigation/staff section and run prettier.

- [ ] **Step 9.5: Verify page tests pass**

Run:

```bash
pnpm --filter @team9/client test -- src/components/layout/contents/__tests__/AIStaffMainContent.test.tsx
```

Expected: PASS.

- [ ] **Step 9.6: Commit page wiring**

```bash
git add apps/client/src/components/layout/contents/AIStaffMainContent.tsx \
        apps/client/src/components/layout/contents/__tests__/AIStaffMainContent.test.tsx \
        apps/client/src/i18n/locales/en/navigation.json \
        apps/client/src/i18n/locales/zh-CN/navigation.json
git commit -m "feat(agent-hub): show recommendations on staff page"
```

## Task 10: Full Verification and Fixups

**Files:**

- Modify only files touched by previous tasks if verification reveals issues.

- [ ] **Step 10.1: Run focused backend tests**

Run:

```bash
pnpm --filter @team9/claw-hive test -- claw-hive.service.spec.ts --runInBand
pnpm --filter @team9/gateway test -- agent-hub/agent-hub.service.spec.ts agent-hub/agent-hub.controller.spec.ts applications/staff.service.spec.ts applications/applications.service.spec.ts --runInBand
pnpm --filter @team9/gateway test -- applications/common-staff.service.spec.ts applications/personal-staff.service.spec.ts --runInBand
```

Expected: all PASS.

- [ ] **Step 10.2: Run focused frontend tests**

Run:

```bash
pnpm --filter @team9/client test -- src/services/api/__tests__/applications.test.ts src/components/ai-staff/__tests__/RecommendedStaffSection.test.tsx src/components/layout/contents/__tests__/AIStaffMainContent.test.tsx
```

Expected: all PASS.

- [ ] **Step 10.3: Run typechecks/build checks**

Run:

```bash
pnpm --filter @team9/gateway build
pnpm --filter @team9/client typecheck
```

Expected: both commands exit 0.

- [ ] **Step 10.4: Run lint on touched workspaces**

Run:

```bash
pnpm --filter @team9/client lint:ci
pnpm -C apps/server lint:ci
```

Expected: both commands exit 0. If existing unrelated lint failures appear, capture the file paths and messages before deciding whether they are in scope.

- [ ] **Step 10.5: Manual smoke test in dev**

Run the server and client if local dependencies are available:

```bash
pnpm dev:server
pnpm dev:client
```

In the app:

1. Open the Staff page.
2. Confirm "Recommended Staff" appears above "AI Staff".
3. Confirm the page shows AgentHive templates whose `metadata.team9.roleTitle` is present.
4. Click install on a template with no mentor selector.
5. Confirm the created staff appears in AI Staff and the detail page opens.
6. Click install again on a `unique: true` template and confirm the UI refreshes to installed state.

- [ ] **Step 10.6: Final status commit**

If verification required no follow-up code changes, no commit is needed for this step. If fixups were made:

```bash
git add apps/server/libs/claw-hive/src/claw-hive.service.ts \
        apps/server/libs/claw-hive/src/claw-hive.service.spec.ts \
        apps/server/libs/database/src/schemas/im/bots.ts \
        apps/server/apps/gateway/src/applications/staff.service.ts \
        apps/server/apps/gateway/src/applications/staff.service.spec.ts \
        apps/server/apps/gateway/src/bot/bot.service.ts \
        apps/server/apps/gateway/src/applications/applications.service.ts \
        apps/server/apps/gateway/src/applications/applications.service.spec.ts \
        apps/server/apps/gateway/src/applications/handlers/agent-hub.handler.ts \
        apps/server/apps/gateway/src/applications/handlers/index.ts \
        apps/server/apps/gateway/src/agent-hub \
        apps/server/apps/gateway/src/app.module.ts \
        apps/client/src/services/api/applications.ts \
        apps/client/src/services/api/__tests__/applications.test.ts \
        apps/client/src/components/ai-staff/RecommendedStaffSection.tsx \
        apps/client/src/components/ai-staff/__tests__/RecommendedStaffSection.test.tsx \
        apps/client/src/components/layout/contents/AIStaffMainContent.tsx \
        apps/client/src/components/layout/contents/__tests__/AIStaffMainContent.test.tsx \
        apps/client/src/i18n/locales/en/navigation.json \
        apps/client/src/i18n/locales/zh-CN/navigation.json
git commit -m "fix(agent-hub): address recommended staff verification"
```

## Self-Review Checklist

- Spec coverage: template cache, stale fallback, installed DB state, unique install, nullable mentor, short job title, and staff page UI all have tasks.
- TDD ordering: each implementation task starts with a failing test and explicit command.
- No DB migration required: `prefabTemplateId` is JSONB type metadata only.
- OpenClaw compatibility: no IM API or WebSocket event changes.
- Mentor behavior: install defaults to `mentorId: null`; no mentor DM is created unless a mentor ID is supplied.
