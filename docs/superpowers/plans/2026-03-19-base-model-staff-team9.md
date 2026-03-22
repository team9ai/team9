# Base Model Staff (team9 side) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate claw-hive base model staff agents into the team9 platform — bot schema changes, application handler, message routing, and executor strategy.

**Architecture:** team9 registers a `base-model-staff` application. On install, it creates 3 bots (Claude, ChatGPT, Gemini) and registers corresponding agents in claw-hive via REST. Messages to these bots are routed to claw-hive's `/input` endpoint. Agents reply via tool calls that hit team9's streaming API.

**Tech Stack:** NestJS, Drizzle ORM, PostgreSQL, TypeScript

**Spec:** `team9-agent-pi/docs/superpowers/specs/2026-03-19-base-model-staff-design.md`

**Scope:** team9 NestJS server side only. Frontend is out of scope for this plan.

---

## File Map

### New files

| File                                                                                  | Responsibility                                                                                      |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `apps/server/libs/claw-hive/src/claw-hive.service.ts`                                 | HTTP client for claw-hive-api (shared across gateway, im-worker, task-worker)                       |
| `apps/server/libs/claw-hive/src/claw-hive.service.spec.ts`                            | Tests                                                                                               |
| `apps/server/libs/claw-hive/src/claw-hive.module.ts`                                  | NestJS module for ClawHiveService                                                                   |
| `apps/server/libs/claw-hive/src/index.ts`                                             | Barrel exports                                                                                      |
| `apps/server/apps/gateway/src/applications/handlers/base-model-staff.handler.ts`      | ApplicationHandler: onInstall creates 3 bots + registers agents in claw-hive, onUninstall cleans up |
| `apps/server/apps/gateway/src/applications/handlers/base-model-staff.handler.spec.ts` | Tests                                                                                               |
| `apps/server/apps/gateway/src/applications/handlers/base-model-staff.presets.ts`      | Preset model configurations (Claude, ChatGPT, Gemini)                                               |
| `apps/server/apps/task-worker/src/executor/strategies/hive.strategy.ts`               | ExecutionStrategy for hive-managed bots                                                             |

### Modified files

| File                                                                          | Changes                                                                                                                                                            |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/server/libs/database/src/schemas/im/bots.ts`                            | Add `managedProvider`, `managedMeta` fields + `ManagedMeta` interface                                                                                              |
| `apps/server/libs/shared/src/env.ts`                                          | Add `CLAW_HIVE_API_URL`, `CLAW_HIVE_AUTH_TOKEN` getters                                                                                                            |
| `apps/server/apps/gateway/src/bot/bot.service.ts`                             | Add `managedProvider`/`managedMeta`/`type` to `CreateWorkspaceBotOptions`; update `createWorkspaceBot` and `getBotsByInstalledApplicationId` to include new fields |
| `apps/server/apps/gateway/src/applications/applications.service.ts`           | Add `base-model-staff` to APPLICATIONS list                                                                                                                        |
| `apps/server/apps/gateway/src/applications/handlers/index.ts`                 | Export BaseModelStaffHandler, add to APPLICATION_HANDLERS                                                                                                          |
| `apps/server/apps/gateway/src/applications/applications.module.ts`            | Import ClawHiveModule, inject BaseModelStaffHandler                                                                                                                |
| `apps/server/apps/gateway/src/applications/installed-applications.service.ts` | Allow uninstall for `base-model-staff` managed apps (or change app type)                                                                                           |
| `apps/server/apps/im-worker/src/post-broadcast/post-broadcast.service.ts`     | Add hive routing in `pushToBotWebhooks` for `managedProvider === 'hive'`                                                                                           |
| `apps/server/apps/im-worker/src/im-worker.module.ts`                          | Import ClawHiveModule                                                                                                                                              |
| `apps/server/apps/task-worker/src/executor/executor.module.ts`                | Import ClawHiveModule, register HiveStrategy                                                                                                                       |
| `apps/server/apps/task-worker/src/executor/executor.service.ts`               | Update bot query to include `managedProvider`; strategy dispatch uses `managedProvider` when set                                                                   |
| `apps/server/.env.example`                                                    | Add CLAW_HIVE_API_URL, CLAW_HIVE_AUTH_TOKEN                                                                                                                        |

---

## Phase 1: Foundation

### Task 1: Bot schema — add managedProvider and managedMeta fields

**Files:**

- Modify: `apps/server/libs/database/src/schemas/im/bots.ts`

- [ ] **Step 1: Add ManagedMeta interface and fields to schema**

```typescript
// Add interface after BotExtra:
export interface ManagedMeta {
  agentId?: string;      // claw-hive agent ID
  instanceId?: string;   // openclaw instance ID
  [key: string]: unknown;
}

// Add after 'extra' field in bots table:

// Managed bot provider (e.g. "hive", "openclaw")
// null = unmanaged (custom/webhook)
managedProvider: text('managed_provider'),

// Provider-specific metadata (e.g. { agentId: "base-model-claude" })
managedMeta: jsonb('managed_meta').$type<ManagedMeta>(),
```

Add index in the table callback:

```typescript
index('idx_bots_managed_provider').on(table.managedProvider),
```

Export `ManagedMeta` from the schemas barrel.

- [ ] **Step 2: Generate migration**

Run: `cd apps/server/libs/database && pnpm db:generate`
Verify migration SQL includes `ALTER TABLE im_bots ADD COLUMN managed_provider text, ADD COLUMN managed_meta jsonb`.

- [ ] **Step 3: Add data migration for existing openclaw bots**

In the generated migration SQL file, append:

```sql
-- Migrate existing openclaw bots to use managedProvider/managedMeta
UPDATE im_bots
SET managed_provider = 'openclaw',
    managed_meta = extra->'openclaw'
WHERE extra->>'openclaw' IS NOT NULL
  AND managed_provider IS NULL;
```

- [ ] **Step 4: Build and verify**

Run: `pnpm build`

- [ ] **Step 5: Commit**

```bash
git add apps/server/libs/database/
git commit -m "feat(database): add managedProvider and managedMeta fields to im_bots"
```

### Task 2: Environment configuration

**Files:**

- Modify: `apps/server/.env.example`
- Modify: `apps/server/libs/shared/src/env.ts`

- [ ] **Step 1: Add env vars to .env.example**

```
# Claw Hive Integration
CLAW_HIVE_API_URL=http://localhost:4100
CLAW_HIVE_AUTH_TOKEN=your-pre-shared-key
```

- [ ] **Step 2: Add env vars to env.ts**

Follow the existing pattern (getter-based, no Zod):

```typescript
get CLAW_HIVE_API_URL() {
  return process.env.CLAW_HIVE_API_URL;
},
get CLAW_HIVE_AUTH_TOKEN() {
  return process.env.CLAW_HIVE_AUTH_TOKEN;
},
```

- [ ] **Step 3: Commit**

```bash
git add apps/server/.env.example apps/server/libs/shared/src/env.ts
git commit -m "feat(config): add CLAW_HIVE_API_URL and CLAW_HIVE_AUTH_TOKEN env vars"
```

### Task 3: Extend bot service for managed bots

**Files:**

- Modify: `apps/server/apps/gateway/src/bot/bot.service.ts`

This task must be done BEFORE the handler (Task 6) which depends on these new options.

- [ ] **Step 1: Add fields to CreateWorkspaceBotOptions**

```typescript
export interface CreateWorkspaceBotOptions {
  // ... existing fields ...
  type?: "system" | "custom" | "webhook"; // NEW: override default 'custom'
  managedProvider?: string; // NEW
  managedMeta?: ManagedMeta; // NEW
}
```

- [ ] **Step 2: Update createWorkspaceBot to pass new fields**

In `createWorkspaceBot`, change the `createBot` call to include:

```typescript
const bot = await this.createBot({
  ...
  type: options.type ?? 'custom',   // was hardcoded 'custom'
  ...
});
```

After the bot is created, update managed fields if provided:

```typescript
if (options.managedProvider) {
  await this.db
    .update(schema.bots)
    .set({
      managedProvider: options.managedProvider,
      managedMeta: options.managedMeta ?? {},
    })
    .where(eq(schema.bots.id, bot.botId));
}
```

- [ ] **Step 3: Update getBotsByInstalledApplicationId to return managedMeta**

Ensure the select includes `managedProvider` and `managedMeta` fields, and add them to the `BotInfo` interface:

```typescript
export interface BotInfo {
  // ... existing fields ...
  managedProvider: string | null; // NEW
  managedMeta: ManagedMeta | null; // NEW
}
```

- [ ] **Step 4: Run existing bot tests**

- [ ] **Step 5: Commit**

```bash
git add apps/server/apps/gateway/src/bot/bot.service.ts
git commit -m "feat(gateway): extend bot creation with type override, managedProvider and managedMeta"
```

---

## Phase 2: Claw Hive Client (shared library)

### Task 4: ClawHiveService — HTTP client in shared lib

**Files:**

- Create: `apps/server/libs/claw-hive/src/claw-hive.service.ts`
- Create: `apps/server/libs/claw-hive/src/claw-hive.service.spec.ts`
- Create: `apps/server/libs/claw-hive/src/claw-hive.module.ts`
- Create: `apps/server/libs/claw-hive/src/index.ts`

ClawHiveService lives in a shared library because it is needed by three separate NestJS apps: gateway (handler install/uninstall), im-worker (message routing), and task-worker (executor strategy).

- [ ] **Step 1: Create library structure**

Follow the pattern of existing libs (e.g., `libs/shared`, `libs/database`). Create `libs/claw-hive/` with `src/`, `tsconfig.json`, `package.json`. Add path alias to the root `tsconfig.json`: `"@team9/claw-hive": ["libs/claw-hive/src"]`.

- [ ] **Step 2: Write tests**

Test cases (mock fetch/undici):

- `registerAgent` sends POST /api/agents with correct body and auth header
- `deleteAgent` sends DELETE /api/agents/:id with auth header
- `sendInput` sends POST /api/sessions/:sessionId/input with event payload
- `healthCheck` calls GET /api/health, returns true on 200, false on error
- All methods throw on non-2xx responses
- Auth header includes `X-Hive-Auth` and optional `X-Hive-Tenant`

- [ ] **Step 3: Implement ClawHiveService**

```typescript
@Injectable()
export class ClawHiveService {
  private readonly logger = new Logger(ClawHiveService.name);
  private readonly baseUrl: string;
  private readonly authToken: string;

  constructor() {
    this.baseUrl = env.CLAW_HIVE_API_URL ?? "http://localhost:4100";
    this.authToken = env.CLAW_HIVE_AUTH_TOKEN ?? "";
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/health`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async registerAgent(params: {
    id: string;
    name: string;
    blueprintId: string;
    tenantId: string;
    model: { provider: string; id: string };
    componentConfigs: Record<string, Record<string, unknown>>;
  }): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/agents`, {
      method: "POST",
      headers: this.headers(params.tenantId),
      body: JSON.stringify(params),
    });
    if (!res.ok)
      throw new Error(
        `Failed to register agent: ${res.status} ${await res.text()}`,
      );
  }

  async deleteAgent(agentId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/agents/${agentId}`, {
      method: "DELETE",
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Failed to delete agent: ${res.status}`);
  }

  async sendInput(
    sessionId: string,
    event: {
      type: string;
      source: string;
      timestamp: string;
      payload: Record<string, unknown>;
    },
    tenantId?: string,
  ): Promise<{ messages: unknown[] }> {
    const res = await fetch(
      `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/input`,
      {
        method: "POST",
        headers: this.headers(tenantId),
        body: JSON.stringify({ event }),
      },
    );
    if (!res.ok) throw new Error(`Failed to send input: ${res.status}`);
    return res.json();
  }

  private headers(tenantId?: string): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "X-Hive-Auth": this.authToken,
      ...(tenantId ? { "X-Hive-Tenant": tenantId } : {}),
    };
  }
}
```

- [ ] **Step 4: Create module and barrel exports**

```typescript
// claw-hive.module.ts
@Module({
  providers: [ClawHiveService],
  exports: [ClawHiveService],
})
export class ClawHiveModule {}

// index.ts
export { ClawHiveService } from "./claw-hive.service.js";
export { ClawHiveModule } from "./claw-hive.module.js";
```

- [ ] **Step 5: Run tests**

- [ ] **Step 6: Commit**

```bash
git add apps/server/libs/claw-hive/
git commit -m "feat(libs): add ClawHiveService shared HTTP client for claw-hive-api"
```

---

## Phase 3: Application Handler

### Task 5: Preset model configuration

**Files:**

- Create: `apps/server/apps/gateway/src/applications/handlers/base-model-staff.presets.ts`

- [ ] **Step 1: Define presets**

```typescript
export interface BaseModelPreset {
  key: string;
  name: string;
  provider: string;
  modelId: string;
  emoji: string;
  avatar: string;
}

export const BASE_MODEL_PRESETS: BaseModelPreset[] = [
  {
    key: "claude",
    name: "Claude",
    provider: "anthropic",
    modelId: "claude-sonnet-4-6",
    emoji: "🟠",
    avatar: "/assets/avatars/claude.png",
  },
  {
    key: "chatgpt",
    name: "ChatGPT",
    provider: "openai",
    modelId: "gpt-5.4-mini",
    emoji: "🟢",
    avatar: "/assets/avatars/chatgpt.png",
  },
  {
    key: "gemini",
    name: "Gemini",
    provider: "google",
    modelId: "gemini-3-flash-preview",
    emoji: "🔵",
    avatar: "/assets/avatars/gemini.png",
  },
];
```

- [ ] **Step 2: Commit**

```bash
git add apps/server/apps/gateway/src/applications/handlers/base-model-staff.presets.ts
git commit -m "feat(gateway): add base model staff preset configurations"
```

### Task 6: BaseModelStaffHandler

**Files:**

- Create: `apps/server/apps/gateway/src/applications/handlers/base-model-staff.handler.ts`
- Create: `apps/server/apps/gateway/src/applications/handlers/base-model-staff.handler.spec.ts`

**Dependencies:** Task 3 (bot service extension) and Task 4 (ClawHiveService) must be complete.

- [ ] **Step 1: Write tests**

Test cases:

- `onInstall` calls claw-hive health check
- `onInstall` registers 3 agents in claw-hive with correct config (blueprint, model, componentConfigs)
- `onInstall` creates 3 bots with `type='system'`, `managedProvider='hive'`, correct `managedMeta`
- `onInstall` creates DM channels for all workspace members for each bot (not just installer)
- `onInstall` returns config with botIds array
- `onUninstall` deletes all 3 agents from claw-hive (reads `managedMeta.agentId`)
- `onUninstall` deletes all 3 bots and shadow users via `deleteBotAndCleanup`
- Error in claw-hive agent registration triggers rollback: previously created bots are cleaned up
- Health check failure throws before any bot creation

- [ ] **Step 2: Implement handler**

```typescript
@Injectable()
export class BaseModelStaffHandler implements ApplicationHandler {
  readonly applicationId = "base-model-staff";
  private readonly logger = new Logger(BaseModelStaffHandler.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly botService: BotService,
    private readonly clawHiveService: ClawHiveService,
    private readonly channelsService: ChannelsService,
  ) {}

  async onInstall(context: InstallContext): Promise<InstallResult> {
    const { installedApplication, tenantId, installedBy } = context;

    // 1. Health check
    const healthy = await this.clawHiveService.healthCheck();
    if (!healthy) throw new Error("Claw Hive API is not reachable");

    // 2. Get all workspace members for DM creation
    const members = await this.db
      .select({ userId: schema.tenantMembers.userId })
      .from(schema.tenantMembers)
      .where(eq(schema.tenantMembers.tenantId, tenantId));

    // 3. Create bots and register agents
    const createdBots: string[] = [];
    const botIds: string[] = [];

    try {
      for (const preset of BASE_MODEL_PRESETS) {
        // 3a. Create bot in team9
        const { bot, accessToken } = await this.botService.createWorkspaceBot({
          ownerId: installedBy,
          tenantId,
          type: "system",
          displayName: preset.name,
          username: `${preset.key}-bot-${tenantId.slice(0, 8)}`,
          installedApplicationId: installedApplication.id,
          generateToken: true,
          mentorId: installedBy,
          managedProvider: "hive",
          managedMeta: { agentId: `base-model-${preset.key}` },
        });

        createdBots.push(bot.botId);
        botIds.push(bot.botId);

        // 3b. Register agent in claw-hive
        await this.clawHiveService.registerAgent({
          id: `base-model-${preset.key}`,
          name: preset.name,
          blueprintId: "team9-hive-base-model",
          tenantId,
          model: { provider: preset.provider, id: preset.modelId },
          componentConfigs: {
            "base-model-agent": { modelName: preset.name },
            team9: {
              team9AuthToken: accessToken!,
              botUserId: bot.userId,
            },
          },
        });

        // 3c. Create DM channels for all workspace members
        await this.channelsService.createDirectChannelsBatch(
          bot.userId,
          members.map((m) => m.userId),
          tenantId,
        );
      }
    } catch (error) {
      // Rollback: clean up any bots created before the failure
      this.logger.error(
        "Failed to install base model staff, rolling back",
        error,
      );
      for (const botId of createdBots) {
        try {
          await this.botService.deleteBotAndCleanup(botId);
        } catch (cleanupError) {
          this.logger.warn(
            `Failed to clean up bot ${botId} during rollback`,
            cleanupError,
          );
        }
      }
      throw error;
    }

    return {
      config: { botIds },
    };
  }

  async onUninstall(app: schema.InstalledApplication): Promise<void> {
    const bots = await this.botService.getBotsByInstalledApplicationId(app.id);

    for (const bot of bots) {
      // Use managedMeta (not extra) to get agentId
      if (bot.managedMeta?.agentId) {
        try {
          await this.clawHiveService.deleteAgent(bot.managedMeta.agentId);
          this.logger.log(`Deleted claw-hive agent ${bot.managedMeta.agentId}`);
        } catch (error) {
          this.logger.warn(
            `Failed to delete claw-hive agent ${bot.managedMeta.agentId}`,
            error,
          );
        }
      }
      try {
        await this.botService.deleteBotAndCleanup(bot.botId);
      } catch (error) {
        this.logger.warn(`Failed to clean up bot ${bot.botId}`, error);
      }
    }
  }
}
```

- [ ] **Step 3: Run tests**

- [ ] **Step 4: Commit**

```bash
git add apps/server/apps/gateway/src/applications/handlers/base-model-staff.*
git commit -m "feat(gateway): add BaseModelStaffHandler for base model staff installation"
```

### Task 7: Application registration and module wiring

**Files:**

- Modify: `apps/server/apps/gateway/src/applications/applications.service.ts`
- Modify: `apps/server/apps/gateway/src/applications/handlers/index.ts`
- Modify: `apps/server/apps/gateway/src/applications/applications.module.ts`
- Modify: `apps/server/apps/gateway/src/applications/installed-applications.service.ts`

- [ ] **Step 1: Add to APPLICATIONS list**

In `applications.service.ts`:

```typescript
{
  id: 'base-model-staff',
  name: 'Base Model Staff',
  description: 'Create AI staff members powered by base models (Claude, ChatGPT, Gemini)',
  iconUrl: '/icons/base-model-staff.svg',
  categories: ['ai', 'bot'],
  enabled: true,
  type: 'managed',
  singleton: true,
},
```

- [ ] **Step 2: Export handler**

In `handlers/index.ts`:

```typescript
export * from "./base-model-staff.handler.js";
export * from "./base-model-staff.presets.js";

import { OpenClawHandler } from "./openclaw.handler.js";
import { BaseModelStaffHandler } from "./base-model-staff.handler.js";

export const APPLICATION_HANDLERS = [OpenClawHandler, BaseModelStaffHandler];
```

- [ ] **Step 3: Import ClawHiveModule in ApplicationsModule**

In `applications.module.ts`:

```typescript
import { ClawHiveModule } from '@team9/claw-hive';

@Module({
  imports: [DatabaseModule, ClawHiveModule, /* ... existing imports ... */],
  // ... rest unchanged, handler auto-injected via APPLICATION_HANDLERS
})
```

- [ ] **Step 4: Allow uninstall for base-model-staff**

In `installed-applications.service.ts`, the `uninstall()` method blocks `type: 'managed'` apps. Update the guard to allow specific managed apps that support uninstall:

```typescript
// Change from:
if (application?.type === "managed") {
  throw new ForbiddenException(
    `Managed application ${application.name} cannot be uninstalled`,
  );
}

// To:
const UNINSTALLABLE_MANAGED_APPS = ["base-model-staff"];
if (
  application?.type === "managed" &&
  !UNINSTALLABLE_MANAGED_APPS.includes(application.id)
) {
  throw new ForbiddenException(
    `Managed application ${application.name} cannot be uninstalled`,
  );
}
```

- [ ] **Step 5: Build and verify**

- [ ] **Step 6: Commit**

```bash
git add apps/server/apps/gateway/src/applications/
git commit -m "feat(gateway): register base-model-staff application, wire module, allow uninstall"
```

---

## Phase 4: Message Routing

### Task 8: Route messages to claw-hive for hive-managed bots

**Files:**

- Modify: `apps/server/apps/im-worker/src/post-broadcast/post-broadcast.service.ts`
- Modify: `apps/server/apps/im-worker/src/im-worker.module.ts`

The actual bot message dispatch happens in `PostBroadcastService.pushToBotWebhooks()` in the im-worker process (NOT in gateway, NOT in message-router). This method is called after a message is persisted and broadcast. It currently only handles webhook-based bots. We need to add hive routing here.

Since im-worker is a separate NestJS app from gateway, it needs ClawHiveModule imported from the shared lib.

- [ ] **Step 1: Import ClawHiveModule in im-worker**

In `im-worker.module.ts`:

```typescript
import { ClawHiveModule } from '@team9/claw-hive';

@Module({
  imports: [/* existing imports */, ClawHiveModule],
  // ...
})
```

- [ ] **Step 2: Write tests**

Test cases:

- Message @mentioning a hive bot in group channel → calls `clawHiveService.sendInput` with correct event
- DM message to hive bot → calls `clawHiveService.sendInput` without needing @mention
- Message to non-hive bot (no managedProvider) → does NOT call clawHiveService
- Message to webhook bot → goes through existing webhook path, not hive
- Correct session-id format: `team9/{tenantId}/{agentId}/{scope}/{scopeId}`
- MessageLocation is built recursively from thread hierarchy
- File/image messages produce `team9:message.file` event type
- claw-hive API error is caught and logged (message delivery to channel is not affected)
- claw-hive API down → graceful degradation (no crash, just log)

- [ ] **Step 3: Implement hive routing in PostBroadcastService**

Inject `ClawHiveService` into `PostBroadcastService`. In `pushToBotWebhooks()` (or a new sibling method called from the same entry point), add:

```typescript
// After existing webhook dispatch logic, add hive dispatch:
for (const bot of mentionedBots) {
  if (bot.managedProvider === "hive" && bot.managedMeta?.agentId) {
    await this.routeToHive(bot, message, channel, sender, tenantId);
  }
}
```

Implement `routeToHive` as a private method:

```typescript
private async routeToHive(
  bot: BotWithManagedFields,
  message: IMMessage,
  channel: Channel,
  sender: { userId: string; displayName: string },
  tenantId: string,
): Promise<void> {
  try {
    const agentId = bot.managedMeta!.agentId!;

    // Build session ID
    const isDm = channel.type === 'direct';
    const scope = message.parentId ? 'thread' : (isDm ? 'dm' : 'thread');
    const scopeId = message.parentId
      ? `${channel.id}/${message.parentId}`
      : channel.id;
    const sessionId = `team9/${tenantId}/${agentId}/${scope}/${scopeId}`;

    // Build location (recursive)
    const location = await this.buildMessageLocation(channel, message.parentId);

    // Build event
    const isFile = message.type === 'file' || message.type === 'image';
    const event = {
      type: isFile ? 'team9:message.file' : 'team9:message.text',
      source: 'team9',
      timestamp: new Date().toISOString(),
      payload: {
        sender,
        messageId: message.id,
        location,
        ...(isFile
          ? { file: message.fileInfo }
          : { content: message.content }),
      },
    };

    await this.clawHiveService.sendInput(sessionId, event, tenantId);
  } catch (error) {
    this.logger.error(`Failed to route message to hive for bot ${bot.botId}`, error);
    // Do NOT rethrow — message delivery to channel should not be affected
  }
}

private async buildMessageLocation(
  channel: Channel,
  parentId?: string,
): Promise<MessageLocation> {
  if (!parentId) {
    return {
      type: 'channel',
      id: channel.id,
      name: channel.name,
    };
  }

  // Fetch parent message and build recursive location
  const [parentMsg] = await this.db
    .select({ id: schema.messages.id, content: schema.messages.content, parentId: schema.messages.parentId })
    .from(schema.messages)
    .where(eq(schema.messages.id, parentId))
    .limit(1);

  const parentLocation = await this.buildMessageLocation(channel, parentMsg?.parentId);

  return {
    type: 'thread',
    id: parentId,
    name: parentMsg?.content?.slice(0, 50) ?? parentId,
    content: parentMsg?.content,
    parent: parentLocation,
  };
}
```

**Note:** The bot query in `pushToBotWebhooks` must be updated to also select `managedProvider` and `managedMeta` from the bots table.

- [ ] **Step 4: Ensure DM messages trigger routing without @mention**

Verify the existing `pushToBotWebhooks` logic: for DM channels (type='direct'), ALL messages should be considered as targeting the bot — no @mention required. If the current code only triggers on @mention, add a check for DM channels.

- [ ] **Step 5: Run tests**

- [ ] **Step 6: Commit**

```bash
git add apps/server/apps/im-worker/
git commit -m "feat(im-worker): route messages to claw-hive for hive-managed bots"
```

---

## Phase 5: Executor Strategy

### Task 9: HiveStrategy for task execution

**Files:**

- Create: `apps/server/apps/task-worker/src/executor/strategies/hive.strategy.ts`
- Modify: `apps/server/apps/task-worker/src/executor/executor.module.ts`
- Modify: `apps/server/apps/task-worker/src/executor/executor.service.ts`

- [ ] **Step 1: Implement HiveStrategy**

```typescript
@Injectable()
export class HiveStrategy implements ExecutionStrategy {
  private readonly logger = new Logger(HiveStrategy.name);

  constructor(private readonly clawHiveService: ClawHiveService) {}

  async execute(context: ExecutionContext): Promise<void> {
    // Task execution via claw-hive will be implemented in a separate plan.
    // For now, log and no-op.
    this.logger.log(
      `HiveStrategy.execute called for task ${context.taskId} (not yet implemented)`,
    );
  }

  async pause(context: ExecutionContext): Promise<void> {
    this.logger.log(
      `HiveStrategy.pause called for task ${context.taskId} (no-op)`,
    );
  }

  async resume(context: ExecutionContext): Promise<void> {
    this.logger.log(
      `HiveStrategy.resume called for task ${context.taskId} (no-op)`,
    );
  }

  async stop(context: ExecutionContext): Promise<void> {
    this.logger.log(
      `HiveStrategy.stop called for task ${context.taskId} (no-op)`,
    );
  }
}
```

- [ ] **Step 2: Update bot query in executor service**

In `executor.service.ts`, update the bot query in `triggerExecution` (step 7) to also select `managedProvider`:

```typescript
// Change from:
const [bot] = await this.db
  .select({ userId: schema.bots.userId, type: schema.bots.type })
  .from(schema.bots)
  .where(eq(schema.bots.id, task.botId))
  .limit(1);

// To:
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

- [ ] **Step 3: Update strategy dispatch to use managedProvider**

In `triggerExecution` (step 8), change strategy lookup:

```typescript
// Change from:
const strategy = this.strategies.get(bot.type);

// To:
const strategy = bot.managedProvider
  ? this.strategies.get(bot.managedProvider)
  : this.strategies.get(bot.type);
```

- [ ] **Step 4: Import ClawHiveModule and register strategy**

In `executor.module.ts`:

```typescript
import { ClawHiveModule } from "@team9/claw-hive";
import { HiveStrategy } from "./strategies/hive.strategy.js";

@Module({
  imports: [DatabaseModule, ClawHiveModule],
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
    this.executorService.registerStrategy("hive", this.hiveStrategy);
  }
}
```

- [ ] **Step 5: Run tests**

- [ ] **Step 6: Commit**

```bash
git add apps/server/apps/task-worker/src/executor/
git commit -m "feat(task-worker): add HiveStrategy and update executor dispatch for managedProvider"
```

---

## Phase 6: Final Verification

### Task 10: Build, test, lint

- [ ] **Step 1: Run all tests**

Run: `pnpm test`

- [ ] **Step 2: Type check**

Run: `pnpm typecheck`

- [ ] **Step 3: Lint**

Run: `pnpm lint`

- [ ] **Step 4: Build**

Run: `pnpm build`

- [ ] **Step 5: Fix any issues and commit**

```bash
git add -A
git commit -m "chore: fix lint/type issues from base model staff integration"
```
