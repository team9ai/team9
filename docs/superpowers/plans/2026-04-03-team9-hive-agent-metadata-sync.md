# Team9 Hive Agent Metadata Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send `tenantId`, `botId`, and `mentorId` to agent-hive when Team9 registers hive agents, and keep that metadata synchronized for every `managedProvider = 'hive'` bot when mentorship changes.

**Architecture:** Extend the shared `ClawHiveService` client with a dedicated `updateAgent()` method, then reuse that client from gateway code. `BaseModelStaffHandler` writes metadata on initial registration, while `BotService.updateBotMentor()` becomes the single synchronous orchestration point for hive-managed mentor changes, including compensating rollback if the Team9 DB write fails after the hive update.

**Tech Stack:** NestJS 11, TypeScript, Jest, workspace packages `@team9/gateway` and `@team9/claw-hive`

---

## File Structure

### Modify

- `apps/server/libs/claw-hive/src/claw-hive.service.ts`
- `apps/server/libs/claw-hive/src/claw-hive.service.spec.ts`
- `apps/server/apps/gateway/src/applications/handlers/base-model-staff.handler.ts`
- `apps/server/apps/gateway/src/applications/handlers/base-model-staff.handler.spec.ts`
- `apps/server/apps/gateway/src/bot/bot.module.ts`
- `apps/server/apps/gateway/src/bot/bot.service.ts`
- `apps/server/apps/gateway/src/bot/bot.service.spec.ts`
- `apps/server/apps/gateway/src/applications/installed-applications.controller.spec.ts`

### Responsibilities

- `claw-hive.service.ts`: typed Team9 client for hive agent registration and metadata updates
- `base-model-staff.handler.ts`: include initial hive metadata during batch registration
- `bot.module.ts`: make `ClawHiveService` injectable inside `BotService`
- `bot.service.ts`: centralize hive metadata construction, tenant resolution, mentor sync, and rollback behavior
- `*.spec.ts`: lock in the contract for request payloads, mentor sync ordering, and failure handling

## Task 1: Add Hive Agent Update Client

**Files:**

- Modify: `apps/server/libs/claw-hive/src/claw-hive.service.ts`
- Modify: `apps/server/libs/claw-hive/src/claw-hive.service.spec.ts`

- [ ] **Step 1: Write the failing client tests**

```ts
describe("updateAgent", () => {
  it("sends PUT to /api/agents/:id with tenant-scoped metadata", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: "agent-1" }));

    await service.updateAgent("agent-1", {
      tenantId: "tenant-123",
      metadata: {
        tenantId: "tenant-123",
        botId: "bot-123",
        mentorId: "mentor-123",
      },
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "http://test-hive:9999/api/agents/agent-1",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          metadata: {
            tenantId: "tenant-123",
            botId: "bot-123",
            mentorId: "mentor-123",
          },
        }),
      }),
    );

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = opts.headers as Record<string, string>;
    expect(headers["X-Hive-Tenant"]).toBe("tenant-123");
  });

  it("throws on non-ok responses", async () => {
    mockFetch.mockResolvedValueOnce(textResponse("Bad Request", 400));

    await expect(
      service.updateAgent("agent-1", {
        tenantId: "tenant-123",
        metadata: {
          tenantId: "tenant-123",
          botId: "bot-123",
          mentorId: null,
        },
      }),
    ).rejects.toThrow("Failed to update agent: 400 Bad Request");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --dir apps/server/apps/gateway test -- --runTestsByPath ../../libs/claw-hive/src/claw-hive.service.spec.ts -t "updateAgent"`

Expected: FAIL with `service.updateAgent is not a function` or TypeScript errors for the missing method

- [ ] **Step 3: Write the minimal client implementation**

```ts
async updateAgent(
  agentId: string,
  params: {
    tenantId: string;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  const res = await fetch(
    `${this.baseUrl}/api/agents/${encodeURIComponent(agentId)}`,
    {
      method: 'PUT',
      headers: this.headers(params.tenantId),
      body: JSON.stringify({ metadata: params.metadata }),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to update agent: ${res.status} ${text}`);
  }
}
```

Also widen the `registerAgent()` and `registerAgents()` parameter types to accept optional `metadata?: Record<string, unknown>` so gateway callers can compile once they start sending the new field.

```ts
async registerAgent(params: {
  id: string;
  name: string;
  blueprintId: string;
  tenantId: string;
  metadata?: Record<string, unknown>;
  model: { provider: string; id: string };
  componentConfigs: Record<string, Record<string, unknown>>;
}): Promise<void> {}

async registerAgents(params: {
  agents: Array<{
    id: string;
    name: string;
    blueprintId: string;
    tenantId: string;
    metadata?: Record<string, unknown>;
    model: { provider: string; id: string };
    componentConfigs: Record<string, Record<string, unknown>>;
  }>;
  atomic?: boolean;
}): Promise<{
  results: Array<{ id: string; status: string; error?: string }>;
  hasErrors: boolean;
}> {}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --dir apps/server/apps/gateway test -- --runTestsByPath ../../libs/claw-hive/src/claw-hive.service.spec.ts -t "updateAgent"`

Expected: PASS with 2 passing tests in the `updateAgent` block

- [ ] **Step 5: Commit**

```bash
git add apps/server/libs/claw-hive/src/claw-hive.service.ts apps/server/libs/claw-hive/src/claw-hive.service.spec.ts
git commit -m "feat(claw-hive): add agent metadata update client"
```

## Task 2: Send Metadata During Base-Model Agent Registration

**Files:**

- Modify: `apps/server/apps/gateway/src/applications/handlers/base-model-staff.handler.ts`
- Modify: `apps/server/apps/gateway/src/applications/handlers/base-model-staff.handler.spec.ts`

- [ ] **Step 1: Write the failing handler expectation**

```ts
it("batch-registers claw-hive agents with searchable metadata", async () => {
  await handler.onInstall(makeContext());

  expect(clawHiveService.registerAgents).toHaveBeenCalledWith(
    expect.objectContaining({
      atomic: true,
      agents: expect.arrayContaining(
        BASE_MODEL_PRESETS.map((preset) =>
          expect.objectContaining({
            id: `base-model-${preset.key}-${TENANT_ID}`,
            metadata: {
              tenantId: TENANT_ID,
              botId: `bot-id-${preset.key}`,
              mentorId: INSTALLED_BY,
            },
          }),
        ),
      ),
    }),
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --dir apps/server/apps/gateway test -- --runTestsByPath src/applications/handlers/base-model-staff.handler.spec.ts -t "searchable metadata"`

Expected: FAIL because `registerAgents()` is called without `metadata`

- [ ] **Step 3: Write the minimal handler implementation**

```ts
await this.clawHiveService.registerAgents({
  agents: createdBotData.map(({ bot, accessToken, preset }) => ({
    id: `base-model-${preset.key}-${tenantId}`,
    name: preset.name,
    blueprintId: "team9-hive-base-model",
    tenantId,
    metadata: {
      tenantId,
      botId: bot.botId,
      mentorId: installedBy,
    },
    model: { provider: preset.provider, id: preset.modelId },
    componentConfigs: {
      "base-model-agent": { modelName: preset.name },
      team9: {
        team9AuthToken: accessToken,
        botUserId: bot.userId,
      },
    },
  })),
  atomic: true,
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --dir apps/server/apps/gateway test -- --runTestsByPath src/applications/handlers/base-model-staff.handler.spec.ts -t "searchable metadata"`

Expected: PASS with the metadata assertion succeeding for every preset

- [ ] **Step 5: Commit**

```bash
git add apps/server/apps/gateway/src/applications/handlers/base-model-staff.handler.ts apps/server/apps/gateway/src/applications/handlers/base-model-staff.handler.spec.ts
git commit -m "feat(gateway): include hive metadata on base-model registration"
```

## Task 3: Sync Hive Metadata on Mentor Updates

**Files:**

- Modify: `apps/server/apps/gateway/src/bot/bot.module.ts`
- Modify: `apps/server/apps/gateway/src/bot/bot.service.ts`
- Modify: `apps/server/apps/gateway/src/bot/bot.service.spec.ts`

- [ ] **Step 1: Write the failing mentor sync tests**

```ts
describe("updateBotMentor", () => {
  it("updates unmanaged bots in Team9 only", async () => {
    db.limit.mockResolvedValueOnce([
      {
        botId: "bot-1",
        mentorId: "old-mentor",
        managedProvider: null,
        managedMeta: null,
        tenantId: null,
      },
    ] as any);

    await service.updateBotMentor("bot-1", "new-mentor");

    expect(clawHiveService.updateAgent).not.toHaveBeenCalled();
    expect(db.update).toHaveBeenCalled();
  });

  it("updates hive metadata before persisting the new mentor", async () => {
    db.limit.mockResolvedValueOnce([
      {
        botId: "bot-1",
        mentorId: "old-mentor",
        managedProvider: "hive",
        managedMeta: { agentId: "agent-1" },
        tenantId: "tenant-1",
      },
    ] as any);

    await service.updateBotMentor("bot-1", "new-mentor");

    expect(clawHiveService.updateAgent).toHaveBeenCalledWith("agent-1", {
      tenantId: "tenant-1",
      metadata: {
        tenantId: "tenant-1",
        botId: "bot-1",
        mentorId: "new-mentor",
      },
    });
    expect(
      clawHiveService.updateAgent.mock.invocationCallOrder[0],
    ).toBeLessThan(db.update.mock.invocationCallOrder[0]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --dir apps/server/apps/gateway test -- --runTestsByPath src/bot/bot.service.spec.ts -t "updateBotMentor"`

Expected: FAIL because `BotService` does not inject `ClawHiveService` and `updateBotMentor()` only updates the database

- [ ] **Step 3: Write the minimal mentor sync implementation**

```ts
constructor(
  @Inject(DATABASE_CONNECTION)
  private readonly db: PostgresJsDatabase<typeof schema>,
  private readonly eventEmitter: EventEmitter2,
  private readonly channelsService: ChannelsService,
  private readonly botAuthCache: BotAuthCacheService,
  private readonly clawHiveService: ClawHiveService,
) {}

private async getBotMentorSyncRow(botId: string) {
  const [row] = await this.db
    .select({
      botId: schema.bots.id,
      mentorId: schema.bots.mentorId,
      managedProvider: schema.bots.managedProvider,
      managedMeta: schema.bots.managedMeta,
      tenantId: schema.installedApplications.tenantId,
    })
    .from(schema.bots)
    .leftJoin(
      schema.installedApplications,
      eq(schema.bots.installedApplicationId, schema.installedApplications.id),
    )
    .where(eq(schema.bots.id, botId))
    .limit(1);

  return row ?? null;
}

async updateBotMentor(botId: string, mentorId: string | null): Promise<void> {
  const bot = await this.getBotMentorSyncRow(botId);
  if (!bot) {
    throw new Error(`Bot not found: ${botId}`);
  }

  if (bot.managedProvider === 'hive') {
    const agentId = (bot.managedMeta as Record<string, unknown> | null)
      ?.agentId as string | undefined;

    if (!agentId) {
      throw new Error(`Hive agentId not configured for bot ${botId}`);
    }
    if (!bot.tenantId) {
      throw new Error(`Hive tenantId not configured for bot ${botId}`);
    }

    await this.clawHiveService.updateAgent(agentId, {
      tenantId: bot.tenantId,
      metadata: {
        tenantId: bot.tenantId,
        botId: bot.botId,
        mentorId,
      },
    });
  }

  await this.db
    .update(schema.bots)
    .set({ mentorId, updatedAt: new Date() })
    .where(eq(schema.bots.id, botId));
}
```

Also wire the dependency in `bot.module.ts`:

```ts
@Module({
  imports: [forwardRef(() => ChannelsModule), ClawHiveModule],
  // ...
})
export class BotModule {}
```

Update the test module in `bot.service.spec.ts` to provide:

```ts
{ provide: ClawHiveService, useValue: clawHiveService }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --dir apps/server/apps/gateway test -- --runTestsByPath src/bot/bot.service.spec.ts -t "updateBotMentor"`

Expected: PASS with the unmanaged and happy-path hive mentor sync tests both green

- [ ] **Step 5: Commit**

```bash
git add apps/server/apps/gateway/src/bot/bot.module.ts apps/server/apps/gateway/src/bot/bot.service.ts apps/server/apps/gateway/src/bot/bot.service.spec.ts
git commit -m "feat(gateway): sync hive metadata on mentor updates"
```

## Task 4: Add Failure Handling, Rollback, and End-to-End Verification

**Files:**

- Modify: `apps/server/apps/gateway/src/bot/bot.service.ts`
- Modify: `apps/server/apps/gateway/src/bot/bot.service.spec.ts`
- Modify: `apps/server/apps/gateway/src/applications/installed-applications.controller.spec.ts`

- [ ] **Step 1: Write the failing rollback and controller regression tests**

```ts
describe("updateBotMentor", () => {
  it("rejects when a hive bot is missing agentId", async () => {
    db.limit.mockResolvedValueOnce([
      {
        botId: "bot-1",
        mentorId: "old-mentor",
        managedProvider: "hive",
        managedMeta: {},
        tenantId: "tenant-1",
      },
    ] as any);

    await expect(
      service.updateBotMentor("bot-1", "new-mentor"),
    ).rejects.toThrow("Hive agentId not configured for bot bot-1");
    expect(db.update).not.toHaveBeenCalled();
  });

  it("rolls hive metadata back when the Team9 write fails", async () => {
    db.limit.mockResolvedValueOnce([
      {
        botId: "bot-1",
        mentorId: "old-mentor",
        managedProvider: "hive",
        managedMeta: { agentId: "agent-1" },
        tenantId: "tenant-1",
      },
    ] as any);
    db.where.mockRejectedValueOnce(new Error("write failed"));

    await expect(
      service.updateBotMentor("bot-1", "new-mentor"),
    ).rejects.toThrow("write failed");

    expect(clawHiveService.updateAgent).toHaveBeenNthCalledWith(1, "agent-1", {
      tenantId: "tenant-1",
      metadata: {
        tenantId: "tenant-1",
        botId: "bot-1",
        mentorId: "new-mentor",
      },
    });
    expect(clawHiveService.updateAgent).toHaveBeenNthCalledWith(2, "agent-1", {
      tenantId: "tenant-1",
      metadata: {
        tenantId: "tenant-1",
        botId: "bot-1",
        mentorId: "old-mentor",
      },
    });
  });
});

it("surfaces mentor sync failures from the controller endpoint", async () => {
  installedApplicationsService.findById.mockResolvedValueOnce(
    makeInstalledApp({
      id: OPENCLAW_APP_ID,
      applicationId: "openclaw",
    }),
  );
  botService.getBotById.mockResolvedValueOnce(
    makeBot({ botId: "bot-transfer", mentorId: USER_ID }),
  );
  db.limit.mockResolvedValueOnce([{ role: "member" }]);
  botService.updateBotMentor.mockRejectedValueOnce(new Error("hive down"));

  await expect(
    controller.updateOpenClawBotMentor(
      OPENCLAW_APP_ID,
      "bot-transfer",
      USER_ID,
      TENANT_ID,
      { mentorId: OTHER_USER_ID },
    ),
  ).rejects.toThrow("hive down");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --dir apps/server/apps/gateway test -- --runTestsByPath src/bot/bot.service.spec.ts src/applications/installed-applications.controller.spec.ts -t "mentor"`

Expected: FAIL because `updateBotMentor()` does not compensate after DB failures and does not reject missing hive linkage cleanly

- [ ] **Step 3: Write the minimal rollback implementation**

```ts
async updateBotMentor(botId: string, mentorId: string | null): Promise<void> {
  const bot = await this.getBotMentorSyncRow(botId);
  if (!bot) {
    throw new Error(`Bot not found: ${botId}`);
  }

  const agentId = (bot.managedMeta as Record<string, unknown> | null)
    ?.agentId as string | undefined;

  if (bot.managedProvider !== 'hive') {
    await this.persistBotMentor(botId, mentorId);
    return;
  }
  if (!agentId) {
    throw new Error(`Hive agentId not configured for bot ${botId}`);
  }
  if (!bot.tenantId) {
    throw new Error(`Hive tenantId not configured for bot ${botId}`);
  }

  const nextMetadata = {
    tenantId: bot.tenantId,
    botId: bot.botId,
    mentorId,
  };
  const previousMetadata = {
    tenantId: bot.tenantId,
    botId: bot.botId,
    mentorId: bot.mentorId,
  };

  await this.clawHiveService.updateAgent(agentId, {
    tenantId: bot.tenantId,
    metadata: nextMetadata,
  });

  try {
    await this.persistBotMentor(botId, mentorId);
  } catch (error) {
    try {
      await this.clawHiveService.updateAgent(agentId, {
        tenantId: bot.tenantId,
        metadata: previousMetadata,
      });
    } catch (rollbackError) {
      this.logger.error(
        `Failed to roll hive metadata back for bot ${botId}`,
        rollbackError as Error,
      );
    }
    throw error;
  }
}
```

Where `persistBotMentor()` is the small shared DB update helper:

```ts
private async persistBotMentor(
  botId: string,
  mentorId: string | null,
): Promise<void> {
  await this.db
    .update(schema.bots)
    .set({ mentorId, updatedAt: new Date() })
    .where(eq(schema.bots.id, botId));
}
```

- [ ] **Step 4: Run focused tests and full verification**

Run:

```bash
pnpm --dir apps/server/apps/gateway test -- --runTestsByPath ../../libs/claw-hive/src/claw-hive.service.spec.ts
pnpm --dir apps/server/apps/gateway test -- --runTestsByPath src/applications/handlers/base-model-staff.handler.spec.ts
pnpm --dir apps/server/apps/gateway test -- --runTestsByPath src/bot/bot.service.spec.ts
pnpm --dir apps/server/apps/gateway test -- --runTestsByPath src/applications/installed-applications.controller.spec.ts
pnpm --dir apps/server --filter @team9/claw-hive build
pnpm --dir apps/server --filter @team9/gateway build
```

Expected:

- all four Jest commands PASS with 0 failing tests
- both build commands exit 0

- [ ] **Step 5: Commit**

```bash
git add apps/server/apps/gateway/src/bot/bot.service.ts apps/server/apps/gateway/src/bot/bot.service.spec.ts apps/server/apps/gateway/src/applications/installed-applications.controller.spec.ts
git commit -m "test(gateway): cover hive mentor sync rollback"
```
