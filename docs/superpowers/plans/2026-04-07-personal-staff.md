# Personal Staff + Staff Sidebar Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-user, per-workspace Personal Staff AI assistant with privacy controls, refactor sidebar to unified Staff view, and change DM creation to lazy on-demand.

**Architecture:** Personal Staff reuses the existing `im_bots` infrastructure and claw-hive agent system. A new `StaffService` base layer is extracted from `CommonStaffService` for shared logic. The frontend sidebar is restructured from "AI Staff" to "Staff" with categorized display. DM channels are no longer batch-created at staff creation time.

**Tech Stack:** NestJS, Drizzle ORM, PostgreSQL, React, TanStack Query, Socket.io, claw-hive (Go), go-git

**Spec:** `docs/superpowers/specs/2026-04-07-personal-staff-design.md`

---

## File Structure

### Backend (New Files)

- `apps/server/apps/gateway/src/applications/staff.service.ts` — Shared base service extracted from CommonStaffService
- `apps/server/apps/gateway/src/applications/personal-staff.service.ts` — Personal Staff business logic
- `apps/server/apps/gateway/src/applications/personal-staff.controller.ts` — Personal Staff REST endpoints
- `apps/server/apps/gateway/src/applications/dto/personal-staff.dto.ts` — Personal Staff DTOs
- `apps/server/apps/gateway/src/applications/handlers/personal-staff.handler.ts` — Managed app handler
- `apps/server/apps/gateway/src/scripts/backfill-managed-apps.ts` — Migration script

### Backend (Modified Files)

- `apps/server/apps/gateway/src/applications/common-staff.service.ts` — Delegate to StaffService, remove DM batch creation
- `apps/server/apps/gateway/src/applications/applications.service.ts` — Add personal-staff app definition
- `apps/server/apps/gateway/src/applications/handlers/index.ts` — Register PersonalStaffHandler
- `apps/server/apps/gateway/src/applications/applications.module.ts` — Register new providers
- `apps/server/apps/gateway/src/workspace/workspace.service.ts` — Member join/leave lifecycle hooks
- `apps/server/apps/gateway/src/im/channels/channels.service.ts` — Permission check for DM creation
- `apps/server/apps/gateway/src/im/websocket/websocket.gateway.ts` — @mention permission check

### Claw-Hive (agent-pi)

- `packages/claw-hive/src/blueprints/presets.ts` — Add TEAM9_PERSONAL_STAFF_BLUEPRINT
- `packages/claw-hive/src/components/team9-staff-soul/default-soul.ts` — Add personal assistant SOUL variant
- `packages/claw-hive/src/components/team9-staff-soul/component.ts` — Support soul variant config

### Frontend (New Files)

- `apps/client/src/components/ai-staff/PersonalStaffDetailSection.tsx` — Personal Staff detail view
- `apps/client/src/components/ai-staff/shared/` — Extracted reusable staff UI components

### Frontend (Modified Files)

- `apps/client/src/services/api/applications.ts` — Add personal staff API methods
- `apps/client/src/components/layout/MainSidebar.tsx` — Rename "AI Staff" to "Staff"
- `apps/client/src/components/layout/contents/AIStaffMainContent.tsx` — Categorized staff list
- `apps/client/src/components/layout/contents/AIStaffDetailContent.tsx` — Support personal staff detail
- `apps/client/src/components/channel/editor/plugins/MentionsPlugin.tsx` — Filter restricted personal staff
- `apps/client/src/hooks/useChannels.ts` — Permission-aware DM creation

---

## Task 1: Claw-Hive — Personal Staff Blueprint + Soul Variant

**Goal:** Register a new `team9-personal-staff` blueprint and add a personal-assistant SOUL variant in the agent-pi codebase.

**Files:**

- Modify: `packages/claw-hive/src/components/team9-staff-soul/default-soul.ts`
- Modify: `packages/claw-hive/src/components/team9-staff-soul/component.ts`
- Modify: `packages/claw-hive/src/blueprints/presets.ts`

**Acceptance Criteria:**

- [ ] `TEAM9_PERSONAL_ASSISTANT_SOUL` constant exists with personal-assistant-oriented content
- [ ] `Team9StaffSoulComponent` reads `variant` from config and selects correct SOUL
- [ ] `TEAM9_PERSONAL_STAFF_BLUEPRINT` is registered in `defaultBlueprints` array
- [ ] Blueprint uses same components as common-staff with `team9-staff-soul` variant config

**Verify:** `pnpm build` in `packages/claw-hive` succeeds

**Steps:**

- [ ] **Step 1: Add personal assistant SOUL constant**

In `packages/claw-hive/src/components/team9-staff-soul/default-soul.ts`, add after the existing `TEAM9_COMMON_STAFF_SOUL`:

```typescript
export const TEAM9_PERSONAL_ASSISTANT_SOUL = `# SOUL.md - Personal Assistant

_You are someone's personal assistant. That relationship is your foundation._

## Core Truths

**Your owner comes first.** You exist to help one person. Their priorities are your priorities. Their context is your context.

**Be genuinely helpful, not performatively helpful.** Skip the "Great question!" and "I'd be happy to help!" - just help. Actions speak louder than filler words.

**Have opinions.** You're allowed to disagree, prefer things, find stuff amusing or boring. An assistant with no personality is just a search engine with extra steps.

**Be resourceful before asking.** Try to figure it out. Read the file. Check the context. Search for it. _Then_ ask if you're stuck.

**Be discreet.** You have access to your owner's conversations and work. When interacting with others (if permitted), never volunteer information from private conversations unless your owner explicitly asks you to share it.

**Earn trust through competence.** Your human gave you access to their stuff. Don't make them regret it.`;
```

- [ ] **Step 2: Update soul component to support variant config**

In `packages/claw-hive/src/components/team9-staff-soul/component.ts`, update the config interface and `onBeforePrompt`:

```typescript
import {
  TEAM9_COMMON_STAFF_SOUL,
  TEAM9_PERSONAL_ASSISTANT_SOUL,
} from "./default-soul";

export interface Team9StaffSoulComponentConfig extends ComponentConfig {
  variant?: "common-staff" | "personal-assistant";
}

// In onBeforePrompt():
override onBeforePrompt(): BeforePromptResult {
  const souls: Record<string, string> = {
    "common-staff": TEAM9_COMMON_STAFF_SOUL,
    "personal-assistant": TEAM9_PERSONAL_ASSISTANT_SOUL,
  };
  const soul = souls[this.config.variant ?? "common-staff"] ?? TEAM9_COMMON_STAFF_SOUL;
  return {
    contextInjection: {
      target: "system",
      content: soul,
    },
  };
}
```

- [ ] **Step 3: Add personal staff blueprint to presets**

In `packages/claw-hive/src/blueprints/presets.ts`, add after `TEAM9_COMMON_STAFF_BLUEPRINT`:

```typescript
export const TEAM9_PERSONAL_STAFF_BLUEPRINT: HiveBlueprint = {
  id: "team9-personal-staff",
  name: "Team9 Personal Staff",
  description:
    "Personal AI assistant scoped to a single user with privacy controls",
  components: [
    "system-prompt",
    "team9",
    "team9-staff-profile",
    "team9-staff-soul",
    "team9-staff-bootstrap",
    "tool-tier",
    "agent-control",
    "hive-wait",
  ],
  componentSchemas: {
    "system-prompt": [
      {
        key: "prompt",
        label: "System Prompt",
        type: "textarea",
        default: "You are a helpful personal AI assistant.",
      },
    ],
    team9: [
      {
        key: "team9AuthToken",
        label: "Auth Token",
        type: "text",
        required: true,
        secret: true,
      },
      { key: "botUserId", label: "Bot User ID", type: "text", required: true },
      {
        key: "team9BaseUrl",
        label: "Team9 Base URL",
        type: "text",
        placeholder: "Defaults to env TEAM9_BASE_URL",
      },
    ],
    "team9-staff-profile": [
      {
        key: "profileCacheTtlMs",
        label: "Profile Cache TTL (ms)",
        type: "text",
        placeholder: "60000",
      },
    ],
    "team9-staff-soul": [
      {
        key: "variant",
        label: "Soul Variant",
        type: "select",
        default: "personal-assistant",
        options: [
          { value: "common-staff", label: "Common Staff" },
          { value: "personal-assistant", label: "Personal Assistant" },
        ],
      },
    ],
  },
};
```

Add to the `defaultBlueprints` array:

```typescript
export const defaultBlueprints: HiveBlueprint[] = [
  // ... existing blueprints ...
  TEAM9_PERSONAL_STAFF_BLUEPRINT,
];
```

- [ ] **Step 4: Build and verify**

```bash
cd /Users/winrey/Projects/weightwave/team9-agent-pi && pnpm build
```

- [ ] **Step 5: Commit**

```bash
git add packages/claw-hive/src/blueprints/presets.ts packages/claw-hive/src/components/team9-staff-soul/
git commit -m "feat(claw-hive): add personal staff blueprint and soul variant"
```

---

## Task 2: Backend — Extract StaffService Base Layer

**Goal:** Extract shared bot CRUD, claw-hive registration, and AI generation logic from `CommonStaffService` into a reusable `StaffService`.

**Files:**

- Create: `apps/server/apps/gateway/src/applications/staff.service.ts`
- Modify: `apps/server/apps/gateway/src/applications/common-staff.service.ts` — Delegate shared methods to StaffService
- Modify: `apps/server/apps/gateway/src/applications/applications.module.ts` — Register StaffService

**Acceptance Criteria:**

- [ ] `StaffService` contains: `createBotWithAgent()`, `updateBotAndAgent()`, `deleteBotAndAgent()`, `generatePersona()`, `generateAvatar()`
- [ ] `CommonStaffService` injects `StaffService` and delegates shared operations
- [ ] All existing common-staff tests still pass
- [ ] No behavioral changes to common-staff functionality

**Verify:** `pnpm test --filter=gateway` — all existing tests pass

**Steps:**

- [ ] **Step 1: Create StaffService with shared bot+agent creation**

Create `apps/server/apps/gateway/src/applications/staff.service.ts`:

```typescript
import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "@app/database";
import { BotService } from "../bot/bot.service";
import { ClawHiveService } from "@app/claw-hive";
import { ChannelsService } from "../im/channels/channels.service";

export interface CreateStaffBotOptions {
  ownerId: string;
  tenantId: string;
  displayName?: string;
  mentorId?: string;
  installedApplicationId: string;
  managedProvider: string;
  blueprintId: string;
  agentIdPrefix: string; // e.g. "common-staff" or "personal-staff"
  model: { provider: string; id: string };
  extraComponentConfigs?: Record<string, unknown>;
  botExtra?: Record<string, unknown>;
}

export interface StaffBotResult {
  botId: string;
  userId: string;
  agentId: string;
  accessToken: string;
  displayName: string | undefined;
}

@Injectable()
export class StaffService {
  private readonly logger = new Logger(StaffService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly botService: BotService,
    private readonly clawHiveService: ClawHiveService,
    private readonly channelsService: ChannelsService,
  ) {}

  async createBotWithAgent(
    options: CreateStaffBotOptions,
  ): Promise<StaffBotResult> {
    // 1. Create bot via BotService
    const { bot, accessToken } = await this.botService.createWorkspaceBot({
      ownerId: options.ownerId,
      tenantId: options.tenantId,
      displayName: options.displayName,
      type: "custom",
      installedApplicationId: options.installedApplicationId,
      generateToken: true,
      mentorId: options.mentorId,
      managedProvider: options.managedProvider,
      managedMeta: { agentId: `${options.agentIdPrefix}-${bot.id}` },
    });

    // 2. Update botExtra
    if (options.botExtra) {
      await this.botService.updateBotExtra(bot.id, options.botExtra);
    }

    const agentId = `${options.agentIdPrefix}-${bot.id}`;

    // 3. Register with claw-hive
    await this.clawHiveService.registerAgent({
      id: agentId,
      name: options.displayName ?? "Staff",
      blueprintId: options.blueprintId,
      tenantId: options.tenantId,
      model: options.model,
      componentConfigs: {
        team9: {
          team9AuthToken: accessToken,
          botUserId: bot.userId,
        },
        ...options.extraComponentConfigs,
      },
    });

    return {
      botId: bot.id,
      userId: bot.userId,
      agentId,
      accessToken: accessToken!,
      displayName: options.displayName,
    };
  }

  async updateBotAndAgent(/* params matching existing updateStaff shared logic */) {
    // Extract shared update logic from CommonStaffService.updateStaff()
    // Bot display name, avatar, mentor, extra metadata, claw-hive sync
  }

  async deleteBotAndAgent(botId: string, agentId: string) {
    // Delete from claw-hive first, then cleanup bot
    await this.clawHiveService.deleteAgent(agentId);
    await this.botService.deleteBotAndCleanup(botId);
  }

  // Move generatePersona() and generateAvatar() from CommonStaffService
  async *generatePersona(/* same params */) {
    /* existing streaming logic */
  }
  async generateAvatar(/* same params */) {
    /* existing logic */
  }
}
```

Note: The exact method signatures should match what's extracted from `CommonStaffService` lines 86-300 (createStaff), 312-429 (updateStaff), 440-500 (deleteStaff), 511-639 (generate methods). Read the full source before extracting.

- [ ] **Step 2: Update CommonStaffService to use StaffService**

Inject `StaffService` and delegate shared operations. Keep common-staff-specific logic (DM batch creation, agentic bootstrap trigger) in `CommonStaffService`.

- [ ] **Step 3: Register StaffService in applications.module.ts**

Add `StaffService` to the module's `providers` array.

- [ ] **Step 4: Run existing tests**

```bash
cd apps/server && pnpm test -- --testPathPattern="common-staff"
```

- [ ] **Step 5: Commit**

```bash
git add apps/server/apps/gateway/src/applications/
git commit -m "refactor(server): extract StaffService base layer from CommonStaffService"
```

---

## Task 3: Backend — Personal Staff App Registration + DTOs

**Goal:** Register `personal-staff` as a managed application with auto-install, create DTOs, and add the application handler.

**Files:**

- Modify: `apps/server/apps/gateway/src/applications/applications.service.ts` — Add personal-staff app definition
- Create: `apps/server/apps/gateway/src/applications/dto/personal-staff.dto.ts` — Personal Staff DTOs
- Create: `apps/server/apps/gateway/src/applications/handlers/personal-staff.handler.ts` — Managed app handler
- Modify: `apps/server/apps/gateway/src/applications/handlers/index.ts` — Register handler

**Acceptance Criteria:**

- [ ] `personal-staff` app definition exists with `type: 'managed'`, `autoInstall: true`
- [ ] `CreatePersonalStaffDto` has: `displayName?`, `persona?`, `model` (required), `avatarUrl?`, `agenticBootstrap?`
- [ ] `UpdatePersonalStaffDto` has: `displayName?`, `persona?`, `model?`, `avatarUrl?`, `visibility?`
- [ ] `PersonalStaffHandler` is registered in `APPLICATION_HANDLERS`
- [ ] New workspaces auto-install personal-staff app

**Verify:** `pnpm build:server` succeeds

**Steps:**

- [ ] **Step 1: Add personal-staff app definition**

In `apps/server/apps/gateway/src/applications/applications.service.ts`, add to the application definitions array (after the `common-staff` entry around line 41):

```typescript
{
  id: 'personal-staff',
  name: 'Personal Staff',
  description: 'Private AI assistant — one per user per workspace',
  iconUrl: '/icons/personal-staff.svg',
  categories: ['ai', 'bot'],
  enabled: true,
  type: 'managed',
  singleton: true,
  autoInstall: true,
}
```

- [ ] **Step 2: Create Personal Staff DTOs**

Create `apps/server/apps/gateway/src/applications/dto/personal-staff.dto.ts`:

```typescript
import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { ModelDto } from "./common-staff.dto";

export class VisibilityDto {
  @IsOptional()
  @IsBoolean()
  allowMention?: boolean;

  @IsOptional()
  @IsBoolean()
  allowDirectMessage?: boolean;
}

export class CreatePersonalStaffDto {
  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsString()
  persona?: string;

  @ValidateNested()
  @Type(() => ModelDto)
  model: ModelDto;

  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @IsOptional()
  @IsBoolean()
  agenticBootstrap?: boolean;
}

export class UpdatePersonalStaffDto {
  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsString()
  persona?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ModelDto)
  model?: ModelDto;

  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => VisibilityDto)
  visibility?: VisibilityDto;
}
```

- [ ] **Step 3: Create PersonalStaffHandler**

Create `apps/server/apps/gateway/src/applications/handlers/personal-staff.handler.ts`:

```typescript
import { Injectable } from "@nestjs/common";
import {
  ApplicationHandler,
  InstallContext,
  InstallResult,
} from "./application-handler.interface";

@Injectable()
export class PersonalStaffHandler implements ApplicationHandler {
  readonly applicationId = "personal-staff";

  async onInstall(context: InstallContext): Promise<InstallResult> {
    // No-op on install — personal staff bots are created per-user via member lifecycle
    return { success: true };
  }
}
```

- [ ] **Step 4: Register handler in index.ts**

In `apps/server/apps/gateway/src/applications/handlers/index.ts`, add `PersonalStaffHandler` to the `APPLICATION_HANDLERS` array.

- [ ] **Step 5: Register in applications.module.ts**

Add `PersonalStaffHandler` to the module's `providers` array.

- [ ] **Step 6: Build and verify**

```bash
pnpm build:server
```

- [ ] **Step 7: Commit**

```bash
git add apps/server/apps/gateway/src/applications/
git commit -m "feat(server): register personal-staff managed app and DTOs"
```

---

## Task 4: Backend — PersonalStaffService + Controller

**Goal:** Implement the core Personal Staff CRUD service and REST controller with uniqueness constraint and fixed fields.

**Files:**

- Create: `apps/server/apps/gateway/src/applications/personal-staff.service.ts`
- Create: `apps/server/apps/gateway/src/applications/personal-staff.controller.ts`
- Modify: `apps/server/apps/gateway/src/applications/applications.module.ts` — Register new providers

**Acceptance Criteria:**

- [ ] `createStaff()` enforces one-per-user-per-workspace uniqueness
- [ ] `mentorId` is always set to `ownerId`, not configurable
- [ ] `roleTitle` and `jobDescription` are hardcoded constants, not stored in DB
- [ ] `GET /staff` returns the current user's personal staff (or 404)
- [ ] `PATCH /staff` and `DELETE /staff` operate without botId param
- [ ] Bootstrap is auto-triggered (creates owner↔bot DM, sends bootstrap event)
- [ ] `BotExtra.personalStaff` stores persona, model, and visibility settings

**Verify:** `pnpm build:server` succeeds; manual test: `POST /v1/installed-applications/{appId}/personal-staff/staff` creates one bot, second call returns 409

**Steps:**

- [ ] **Step 1: Create PersonalStaffService**

Create `apps/server/apps/gateway/src/applications/personal-staff.service.ts`:

```typescript
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "@app/database";
import * as schema from "@app/database/schemas";
import { eq, and } from "drizzle-orm";
import { StaffService } from "./staff.service";
import { BotService } from "../bot/bot.service";
import { ChannelsService } from "../im/channels/channels.service";
import { ClawHiveService } from "@app/claw-hive";
import {
  CreatePersonalStaffDto,
  UpdatePersonalStaffDto,
} from "./dto/personal-staff.dto";

export const PERSONAL_STAFF_ROLE_TITLE = "Personal Assistant";
export const PERSONAL_STAFF_JOB_DESCRIPTION = "Personal AI assistant";
const PERSONAL_STAFF_APPLICATION_ID = "personal-staff";
const HIVE_BLUEPRINT_ID = "team9-personal-staff";
const AGENT_ID_PREFIX = "personal-staff";

@Injectable()
export class PersonalStaffService {
  private readonly logger = new Logger(PersonalStaffService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly staffService: StaffService,
    private readonly botService: BotService,
    private readonly channelsService: ChannelsService,
    private readonly clawHiveService: ClawHiveService,
  ) {}

  async getStaff(userId: string, installedAppId: string) {
    const bot = await this.findPersonalStaffBot(userId, installedAppId);
    if (!bot) throw new NotFoundException("Personal staff not found");
    return this.formatBotResponse(bot);
  }

  async createStaff(
    userId: string,
    tenantId: string,
    installedAppId: string,
    dto: CreatePersonalStaffDto,
  ) {
    // Uniqueness check
    const existing = await this.findPersonalStaffBot(userId, installedAppId);
    if (existing) {
      throw new ConflictException(
        "User already has a personal staff in this workspace",
      );
    }

    const displayName = dto.displayName ?? `Personal Assistant`;

    // Create bot + register agent via StaffService
    const result = await this.staffService.createBotWithAgent({
      ownerId: userId,
      tenantId,
      displayName,
      mentorId: userId, // Fixed: mentor is always the owner
      installedApplicationId: installedAppId,
      managedProvider: "hive",
      blueprintId: HIVE_BLUEPRINT_ID,
      agentIdPrefix: AGENT_ID_PREFIX,
      model: dto.model,
      extraComponentConfigs: {
        "team9-staff-soul": { variant: "personal-assistant" },
      },
      botExtra: {
        personalStaff: {
          persona: dto.persona ?? null,
          model: dto.model,
          visibility: {
            allowMention: false,
            allowDirectMessage: false,
          },
        },
      },
    });

    // Create owner ↔ bot DM (for bootstrap)
    await this.channelsService.createDirectChannel(
      result.userId,
      userId,
      tenantId,
    );

    // Auto-trigger bootstrap if requested (default true)
    if (dto.agenticBootstrap !== false) {
      await this.triggerBootstrap(result.agentId, userId, tenantId);
    }

    return result;
  }

  async updateStaff(
    userId: string,
    installedAppId: string,
    dto: UpdatePersonalStaffDto,
  ) {
    const bot = await this.findPersonalStaffBot(userId, installedAppId);
    if (!bot) throw new NotFoundException("Personal staff not found");

    // Update display name / avatar on shadow user
    if (dto.displayName !== undefined || dto.avatarUrl !== undefined) {
      await this.botService.updateBotDisplayName(bot.id, {
        displayName: dto.displayName,
        avatarUrl: dto.avatarUrl,
      });
    }

    // Merge BotExtra.personalStaff
    const currentExtra = (bot.extra as any)?.personalStaff ?? {};
    const updatedPersonalStaff = {
      ...currentExtra,
      ...(dto.persona !== undefined && { persona: dto.persona }),
      ...(dto.model !== undefined && { model: dto.model }),
      ...(dto.visibility !== undefined && {
        visibility: { ...currentExtra.visibility, ...dto.visibility },
      }),
    };
    await this.botService.updateBotExtra(bot.id, {
      personalStaff: updatedPersonalStaff,
    });

    // Sync to claw-hive if model changed
    if (dto.model) {
      const agentId = (bot.managedMeta as any)?.agentId;
      if (agentId) {
        await this.clawHiveService.updateAgent(agentId, {
          tenantId: bot.tenantId,
          model: dto.model,
        });
      }
    }

    return this.formatBotResponse(bot);
  }

  async deleteStaff(userId: string, installedAppId: string) {
    const bot = await this.findPersonalStaffBot(userId, installedAppId);
    if (!bot) throw new NotFoundException("Personal staff not found");

    const agentId = (bot.managedMeta as any)?.agentId;
    await this.staffService.deleteBotAndAgent(bot.id, agentId);
  }

  private async findPersonalStaffBot(ownerId: string, installedAppId: string) {
    const [bot] = await this.db
      .select()
      .from(schema.bots)
      .where(
        and(
          eq(schema.bots.ownerId, ownerId),
          eq(schema.bots.installedApplicationId, installedAppId),
        ),
      )
      .limit(1);
    return bot ?? null;
  }

  private async triggerBootstrap(
    agentId: string,
    userId: string,
    tenantId: string,
  ) {
    // Similar to CommonStaffService bootstrap trigger
    // Creates session with isMentorDm: true, sends initial input
  }

  private formatBotResponse(bot: any) {
    // Format bot data for API response, injecting fixed roleTitle/jobDescription
  }
}
```

Note: Read the full `CommonStaffService` source to match exact patterns for `triggerBootstrap` and `formatBotResponse`. The `findPersonalStaffBot` query leverages `ownerId + installedApplicationId` which enforces workspace-level uniqueness since `installedAppId` is tenant-scoped.

- [ ] **Step 2: Create PersonalStaffController**

Create `apps/server/apps/gateway/src/applications/personal-staff.controller.ts`:

```typescript
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
  Version,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { WorkspaceGuard } from "../workspace/workspace.guard";
import { PersonalStaffService } from "./personal-staff.service";
import {
  CreatePersonalStaffDto,
  UpdatePersonalStaffDto,
} from "./dto/personal-staff.dto";

@Controller("installed-applications/:id/personal-staff")
@Version("1")
@UseGuards(AuthGuard, WorkspaceGuard)
export class PersonalStaffController {
  constructor(private readonly personalStaffService: PersonalStaffService) {}

  @Get("staff")
  async getStaff(@Param("id") appId: string, @Req() req: any) {
    return this.personalStaffService.getStaff(req.user.id, appId);
  }

  @Post("staff")
  async createStaff(
    @Param("id") appId: string,
    @Body() dto: CreatePersonalStaffDto,
    @Req() req: any,
  ) {
    return this.personalStaffService.createStaff(
      req.user.id,
      req.workspace.id,
      appId,
      dto,
    );
  }

  @Patch("staff")
  async updateStaff(
    @Param("id") appId: string,
    @Body() dto: UpdatePersonalStaffDto,
    @Req() req: any,
  ) {
    return this.personalStaffService.updateStaff(req.user.id, appId, dto);
  }

  @Delete("staff")
  async deleteStaff(@Param("id") appId: string, @Req() req: any) {
    return this.personalStaffService.deleteStaff(req.user.id, appId);
  }

  // SSE streaming endpoints — delegate to StaffService (same as CommonStaffController)
  @Post("generate-persona")
  async generatePersona(
    @Param("id") appId: string,
    @Body() dto: any,
    @Res() res: Response,
  ) {
    // Same SSE streaming pattern as CommonStaffController.generatePersona()
    // Set headers: Content-Type text/event-stream, Cache-Control no-cache, Connection keep-alive
    // Stream from this.staffService.generatePersona(dto)
  }

  @Post("generate-avatar")
  async generateAvatar(@Param("id") appId: string, @Body() dto: any) {
    return this.staffService.generateAvatar(dto);
  }
}
```

- [ ] **Step 3: Register in module**

Add `PersonalStaffService` and `PersonalStaffController` to `applications.module.ts`.

- [ ] **Step 4: Write tests**

Test cases:

- Create personal staff → returns bot with agentId
- Create second personal staff → 409 Conflict
- Get personal staff → returns formatted response with fixed roleTitle
- Update persona/model/visibility → updates BotExtra
- Delete personal staff → removes bot and agent
- PATCH with roleTitle/jobDescription/mentorId → ignored (not in DTO)

- [ ] **Step 5: Commit**

```bash
git add apps/server/apps/gateway/src/applications/
git commit -m "feat(server): add PersonalStaffService and controller"
```

---

## Task 5: Backend — DM Lazy Creation + Visibility Permissions

**Goal:** Remove DM batch creation from CommonStaffService, add permission checks for Personal Staff DM and @mention.

**Files:**

- Modify: `apps/server/apps/gateway/src/applications/common-staff.service.ts` — Remove `createDirectChannelsBatch` call from `createStaff()`
- Modify: `apps/server/apps/gateway/src/im/channels/channels.service.ts` — Add permission check before DM creation with personal staff bots
- Modify: `apps/server/apps/gateway/src/im/websocket/websocket.gateway.ts` — Add @mention permission check
- Modify: `apps/server/apps/gateway/src/im/users/users.service.ts` — Filter personal staff from search results

**Acceptance Criteria:**

- [ ] `CommonStaffService.createStaff()` no longer calls `createDirectChannelsBatch`
- [ ] Creating a DM with a restricted personal staff returns 403 with clear message
- [ ] @mentioning a restricted personal staff returns 400 with clear message
- [ ] Search/autocomplete excludes restricted personal staff from non-owner results
- [ ] Existing common staff DM creation via Chat button still works (no permission block)

**Verify:** `pnpm test --filter=gateway` — all tests pass; manual test: create common staff, verify no DMs auto-created; try DM with restricted personal staff → 403

**Steps:**

- [ ] **Step 1: Remove DM batch creation from CommonStaffService**

In `apps/server/apps/gateway/src/applications/common-staff.service.ts`, remove the block around lines 211-230 that fetches all tenant members and calls `createDirectChannelsBatch`. Keep the single DM creation for the staff creator (if it exists) needed for bootstrap.

Before (lines ~211-230):

```typescript
// DELETE THIS BLOCK:
const members = await this.db
  .select({ userId: schema.tenantMembers.userId })
  .from(schema.tenantMembers)
  .where(eq(schema.tenantMembers.tenantId, tenantId));
const memberUserIds = members.map((m) => m.userId).filter(/*...*/);
if (memberUserIds.length > 0) {
  dmChannelMap = await this.channelsService.createDirectChannelsBatch(/*...*/);
}
```

After: Remove entirely. The creator's DM (for agentic bootstrap) is already handled separately.

- [ ] **Step 2: Add personal staff visibility check to DM creation**

In `apps/server/apps/gateway/src/im/channels/channels.service.ts`, add a check in the `createDirectChannel` method. Before creating the DM, check if the target user is a personal staff bot with `allowDirectMessage: false` and the requester is not the owner:

```typescript
async createDirectChannel(botUserId: string, requesterId: string, tenantId: string) {
  // Check if target is a restricted personal staff
  const targetBot = await this.db
    .select()
    .from(schema.bots)
    .where(eq(schema.bots.userId, botUserId))
    .limit(1)
    .then(rows => rows[0]);

  if (targetBot) {
    const extra = targetBot.extra as any;
    if (extra?.personalStaff && targetBot.ownerId !== requesterId) {
      if (!extra.personalStaff.visibility?.allowDirectMessage) {
        throw new ForbiddenException(
          "This is a private assistant and is not open for direct messages.",
        );
      }
    }
  }
  // ... existing DM creation logic
}
```

- [ ] **Step 3: Add @mention permission check**

In the WebSocket gateway or message service, when processing a new message with mentions, check each mentioned user. If a mentioned user is a restricted personal staff and the sender is not the owner, reject with an error:

```typescript
// In message processing logic (websocket.gateway.ts or messages.service.ts)
for (const mentionedUserId of parsedMentions) {
  const bot = await this.botService.findByUserId(mentionedUserId);
  if (bot) {
    const extra = bot.extra as any;
    if (extra?.personalStaff && bot.ownerId !== senderId) {
      if (!extra.personalStaff.visibility?.allowMention) {
        throw new WsException(
          "This is a private assistant and is not open for @mentions.",
        );
      }
    }
  }
}
```

- [ ] **Step 4: Filter personal staff from search/autocomplete**

In the user search service (used by @mention autocomplete), exclude personal staff bots where `allowMention: false` unless the searcher is the owner:

```typescript
// In users search query, add filter:
// Exclude other users' restricted personal staff from results
.where(
  or(
    // Not a bot
    ne(schema.users.userType, 'bot'),
    // Bot but not personal staff
    isNull(sql`${schema.bots.extra}->>'personalStaff'`),
    // Personal staff owned by searcher
    eq(schema.bots.ownerId, searcherId),
    // Personal staff with allowMention enabled
    sql`${schema.bots.extra}->'personalStaff'->'visibility'->>'allowMention' = 'true'`,
  ),
)
```

- [ ] **Step 5: Write tests**

Test cases:

- Common staff creation no longer creates DMs for workspace members
- DM creation with restricted personal staff by non-owner → 403
- DM creation with restricted personal staff by owner → success
- DM creation with personal staff (allowDirectMessage=true) by anyone → success
- @mention restricted personal staff by non-owner → error
- @mention restricted personal staff by owner → success
- Search excludes restricted personal staff for non-owners
- Search includes personal staff for owner

- [ ] **Step 6: Commit**

```bash
git add apps/server/apps/gateway/src/
git commit -m "feat(server): DM lazy creation and personal staff visibility permissions"
```

---

## Task 6: Backend — Member Lifecycle + Migration Script

**Goal:** Auto-create personal staff on member join, auto-cleanup on member leave, and backfill old workspaces.

**Files:**

- Modify: `apps/server/apps/gateway/src/workspace/workspace.service.ts` — Add hooks in `acceptInvitation()` and `removeMember()`
- Create: `apps/server/apps/gateway/src/scripts/backfill-managed-apps.ts` — One-time migration script

**Acceptance Criteria:**

- [ ] New member joining workspace gets a personal staff bot auto-created with bootstrap DM
- [ ] Member leaving workspace has their personal staff bot + DMs cleaned up + agent deregistered
- [ ] Migration script installs missing managed apps (common-staff, personal-staff, base-model-staff) for all tenants
- [ ] Migration script creates personal staff bots for existing members in workspaces that get personal-staff installed

**Verify:** Migration script: `npx ts-node apps/server/apps/gateway/src/scripts/backfill-managed-apps.ts` runs without errors

**Steps:**

- [ ] **Step 1: Add personal staff creation on member join**

In `apps/server/apps/gateway/src/workspace/workspace.service.ts`, in the `acceptInvitation()` method (around lines 541-569 where DM batch creation happens), add after the existing logic:

```typescript
// Auto-create personal staff for new member
try {
  const personalStaffApp =
    await this.installedApplicationsService.findByApplicationId(
      invitation.tenantId,
      "personal-staff",
    );
  if (personalStaffApp) {
    await this.personalStaffService.createStaff(
      userId,
      invitation.tenantId,
      personalStaffApp.id,
      {
        model: { provider: "anthropic", id: "claude-sonnet-4-6" },
        agenticBootstrap: true,
      },
    );
  }
} catch (error) {
  this.logger.warn(
    `Failed to auto-create personal staff for user ${userId}: ${error.message}`,
  );
}
```

- [ ] **Step 2: Add personal staff cleanup on member leave**

In `apps/server/apps/gateway/src/workspace/workspace.service.ts`, in the `removeMember()` method (around line 1090), add cleanup before or after marking the member as left:

```typescript
// Cleanup personal staff bot for departing member
try {
  const personalStaffApp =
    await this.installedApplicationsService.findByApplicationId(
      tenantId,
      "personal-staff",
    );
  if (personalStaffApp) {
    await this.personalStaffService.deleteStaff(userId, personalStaffApp.id);
  }
} catch (error) {
  // May not have a personal staff, that's OK
  if (!(error instanceof NotFoundException)) {
    this.logger.warn(
      `Failed to cleanup personal staff for user ${userId}: ${error.message}`,
    );
  }
}
```

- [ ] **Step 3: Create migration script**

Create `apps/server/apps/gateway/src/scripts/backfill-managed-apps.ts`:

```typescript
/**
 * One-time migration script to backfill managed applications for existing workspaces.
 *
 * For each tenant:
 * 1. Install missing managed apps: common-staff, personal-staff, base-model-staff
 * 2. For newly installed personal-staff: create a personal staff bot for each member
 *    (with default model, empty persona, bootstrap NOT auto-triggered)
 *
 * Usage: npx ts-node -r tsconfig-paths/register apps/server/apps/gateway/src/scripts/backfill-managed-apps.ts
 */

async function main() {
  // Bootstrap NestJS app context
  const app = await NestFactory.createApplicationContext(AppModule);
  const db = app.get(DatabaseService);
  const installedAppsService = app.get(InstalledApplicationsService);
  const personalStaffService = app.get(PersonalStaffService);

  // Get all active tenants
  const tenants = await db
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.isActive, true));

  for (const tenant of tenants) {
    console.log(`Processing tenant: ${tenant.id} (${tenant.name})`);

    // Check and install missing managed apps
    const managedAppIds = [
      "common-staff",
      "personal-staff",
      "base-model-staff",
    ];
    for (const appId of managedAppIds) {
      const existing = await installedAppsService.findByApplicationId(
        tenant.id,
        appId,
      );
      if (!existing) {
        console.log(`  Installing ${appId}...`);
        await installedAppsService.install(tenant.id, tenant.ownerId, {
          applicationId: appId,
        });
      }
    }

    // Create personal staff for members who don't have one
    const personalStaffApp = await installedAppsService.findByApplicationId(
      tenant.id,
      "personal-staff",
    );
    if (personalStaffApp) {
      const members = await db
        .select({ userId: schema.tenantMembers.userId })
        .from(schema.tenantMembers)
        .where(
          and(
            eq(schema.tenantMembers.tenantId, tenant.id),
            isNull(schema.tenantMembers.leftAt),
          ),
        );

      for (const member of members) {
        try {
          await personalStaffService.createStaff(
            member.userId,
            tenant.id,
            personalStaffApp.id,
            {
              model: { provider: "anthropic", id: "claude-sonnet-4-6" },
              agenticBootstrap: false, // Don't trigger bootstrap during migration
            },
          );
          console.log(`  Created personal staff for user ${member.userId}`);
        } catch (error) {
          if (error instanceof ConflictException) {
            // Already has personal staff, skip
          } else {
            console.error(
              `  Failed for user ${member.userId}: ${error.message}`,
            );
          }
        }
      }
    }
  }

  console.log("Migration complete.");
  await app.close();
}

main().catch(console.error);
```

- [ ] **Step 4: Inject PersonalStaffService into WorkspaceService**

Add `PersonalStaffService` to `WorkspaceService` constructor injection and update the workspace module imports.

- [ ] **Step 5: Write tests**

Test cases:

- Member joins workspace → personal staff created + DM exists
- Member joins workspace where personal-staff app not installed → no error, no staff created
- Member leaves → personal staff deleted + agent deregistered
- Migration script: tenant missing apps → apps installed
- Migration script: tenant with existing personal staff → no duplicates (ConflictException caught)

- [ ] **Step 6: Commit**

```bash
git add apps/server/apps/gateway/src/
git commit -m "feat(server): member lifecycle hooks and managed app migration script"
```

---

## Task 7: Frontend — Personal Staff API Client + Hooks

**Goal:** Add Personal Staff API methods and React Query hooks for frontend consumption.

**Files:**

- Modify: `apps/client/src/services/api/applications.ts` — Add personal staff CRUD methods
- Create: `apps/client/src/hooks/usePersonalStaff.ts` — React Query hooks

**Acceptance Criteria:**

- [ ] `getPersonalStaff()`, `createPersonalStaff()`, `updatePersonalStaff()`, `deletePersonalStaff()` API methods exist
- [ ] `usePersonalStaff(appId)` query hook fetches current user's personal staff
- [ ] `useCreatePersonalStaff()`, `useUpdatePersonalStaff()`, `useDeletePersonalStaff()` mutation hooks exist
- [ ] Query is invalidated after mutations

**Verify:** `pnpm build:client` succeeds

**Steps:**

- [ ] **Step 1: Add API methods**

In `apps/client/src/services/api/applications.ts`, add after the existing common-staff methods:

```typescript
// Personal Staff API
async getPersonalStaff(appId: string) {
  return this.http.get<PersonalStaffBotInfo>(
    `/v1/installed-applications/${appId}/personal-staff/staff`,
  );
},

async createPersonalStaff(appId: string, body: CreatePersonalStaffDto) {
  return this.http.post<StaffBotResult>(
    `/v1/installed-applications/${appId}/personal-staff/staff`,
    body,
  );
},

async updatePersonalStaff(appId: string, body: UpdatePersonalStaffDto) {
  return this.http.patch<PersonalStaffBotInfo>(
    `/v1/installed-applications/${appId}/personal-staff/staff`,
    body,
  );
},

async deletePersonalStaff(appId: string) {
  return this.http.delete(
    `/v1/installed-applications/${appId}/personal-staff/staff`,
  );
},

// Reuse same generatePersona/generateAvatar SSE patterns as common-staff
// but targeting /personal-staff/ path
async *generatePersonalStaffPersona(appId: string, body: any): AsyncGenerator<string> {
  // Same SSE streaming logic as generatePersona() but with personal-staff URL
  // `/v1/installed-applications/${appId}/personal-staff/generate-persona`
},

async generatePersonalStaffAvatar(appId: string, body: any) {
  return this.http.post(
    `/v1/installed-applications/${appId}/personal-staff/generate-avatar`,
    body,
  );
},
```

Add types:

```typescript
export interface PersonalStaffBotInfo {
  botId: string;
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  persona: string | null;
  model: { provider: string; id: string } | null;
  visibility: {
    allowMention: boolean;
    allowDirectMessage: boolean;
  };
  isActive: boolean;
  createdAt: string;
  managedMeta: { agentId: string } | null;
  // Fixed fields (always returned, not editable)
  roleTitle: string; // "Personal Assistant"
  jobDescription: string;
}

export interface CreatePersonalStaffDto {
  displayName?: string;
  persona?: string;
  model: { provider: string; id: string };
  avatarUrl?: string;
  agenticBootstrap?: boolean;
}

export interface UpdatePersonalStaffDto {
  displayName?: string;
  persona?: string;
  model?: { provider: string; id: string };
  avatarUrl?: string;
  visibility?: {
    allowMention?: boolean;
    allowDirectMessage?: boolean;
  };
}
```

- [ ] **Step 2: Create React Query hooks**

Create `apps/client/src/hooks/usePersonalStaff.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";
import { useWorkspaceStore } from "@/stores/workspace";

export function usePersonalStaff(appId: string | undefined) {
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspace?.id);
  return useQuery({
    queryKey: ["personal-staff", workspaceId, appId],
    queryFn: () => api.applications.getPersonalStaff(appId!),
    enabled: !!appId && !!workspaceId,
  });
}

export function useCreatePersonalStaff() {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspace?.id);
  return useMutation({
    mutationFn: ({
      appId,
      dto,
    }: {
      appId: string;
      dto: CreatePersonalStaffDto;
    }) => api.applications.createPersonalStaff(appId, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["personal-staff", workspaceId],
      });
      queryClient.invalidateQueries({
        queryKey: ["installed-applications-with-bots"],
      });
    },
  });
}

export function useUpdatePersonalStaff() {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspace?.id);
  return useMutation({
    mutationFn: ({
      appId,
      dto,
    }: {
      appId: string;
      dto: UpdatePersonalStaffDto;
    }) => api.applications.updatePersonalStaff(appId, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["personal-staff", workspaceId],
      });
    },
  });
}

export function useDeletePersonalStaff() {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspace?.id);
  return useMutation({
    mutationFn: (appId: string) => api.applications.deletePersonalStaff(appId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["personal-staff", workspaceId],
      });
      queryClient.invalidateQueries({
        queryKey: ["installed-applications-with-bots"],
      });
    },
  });
}
```

- [ ] **Step 3: Build and verify**

```bash
pnpm build:client
```

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/services/api/applications.ts apps/client/src/hooks/usePersonalStaff.ts
git commit -m "feat(client): add personal staff API client and React Query hooks"
```

---

## Task 8: Frontend — Staff Sidebar Refactor

**Goal:** Rename "AI Staff" to "Staff" and show categorized list: My Personal Staff / AI Staff / Human Members.

**Files:**

- Modify: `apps/client/src/components/layout/MainSidebar.tsx` — Rename nav item
- Modify: `apps/client/src/components/layout/contents/AIStaffMainContent.tsx` — Categorized staff list with 3 sections

**Acceptance Criteria:**

- [ ] Sidebar nav item shows "Staff" instead of "AI Staff" (with same Bot icon)
- [ ] Staff page shows 3 sections: "My Personal Staff", "AI Staff", "Members"
- [ ] "My Personal Staff" section shows current user's personal staff (max 1, pinned at top)
- [ ] "AI Staff" section shows all common staff + other users' visible personal staff
- [ ] "Members" section shows human workspace members
- [ ] Each staff entry has a "Chat" button
- [ ] Other users' restricted personal staff do NOT appear in "AI Staff" section
- [ ] Lock icon shown on other users' personal staff (even if visible)

**Verify:** `pnpm dev:client` — sidebar shows "Staff", staff page renders 3 categorized sections

**Steps:**

- [ ] **Step 1: Rename sidebar nav item**

In `apps/client/src/components/layout/MainSidebar.tsx`, line 69, change the navigation item:

```typescript
// Before:
{ id: "aiStaff", labelKey: "aiStaff" as const, icon: Bot }
// After:
{ id: "aiStaff", labelKey: "staff" as const, icon: Bot }
```

Also update any i18n/label mappings for "staff" if they exist.

- [ ] **Step 2: Refactor AIStaffMainContent to show 3 categories**

In `apps/client/src/components/layout/contents/AIStaffMainContent.tsx`, restructure the content to:

1. Fetch personal staff via `usePersonalStaff(personalStaffAppId)`
2. Fetch all installed apps with bots (existing query)
3. Fetch workspace members
4. Categorize into 3 sections:

```typescript
// Category logic:
const myPersonalStaff = personalStaffData; // From usePersonalStaff hook
const aiStaffBots = allBots.filter((bot) => {
  // Common staff bots
  if (bot.extra?.commonStaff) return true;
  // Other users' personal staff with visibility enabled
  if (bot.extra?.personalStaff && bot.ownerId !== currentUserId) {
    const vis = bot.extra.personalStaff.visibility;
    return vis?.allowMention || vis?.allowDirectMessage;
  }
  return false;
});
const humanMembers = workspaceMembers.filter((m) => m.userType === "human");
```

Render 3 collapsible sections with appropriate headers and list items. Each staff/member entry shows:

- Avatar + display name
- Role badge (for AI staff)
- Chat button (triggers DM lazy creation)
- Lock icon on other users' personal staff

- [ ] **Step 3: Add Chat button with lazy DM creation**

Each staff entry's Chat button calls `createDirectChannel` and navigates to the DM:

```typescript
const handleChat = async (targetUserId: string) => {
  try {
    const channel = await createDirectChannel.mutateAsync(targetUserId);
    navigate({ to: "/messages/$channelId", params: { channelId: channel.id } });
  } catch (error) {
    if (error.status === 403) {
      toast.error(
        "This is a private assistant and is not open for direct messages.",
      );
    }
  }
};
```

- [ ] **Step 4: Verify rendering**

```bash
pnpm dev:client
```

Navigate to Staff page, verify 3 sections render correctly.

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/components/layout/
git commit -m "refactor(client): rename AI Staff to Staff with categorized display"
```

---

## Task 9: Frontend — Personal Staff Detail + Visibility Settings

**Goal:** Create the Personal Staff detail view with profile editing and visibility toggle switches with privacy warning.

**Files:**

- Create: `apps/client/src/components/ai-staff/PersonalStaffDetailSection.tsx`
- Modify: `apps/client/src/components/layout/contents/AIStaffDetailContent.tsx` — Route personal staff to new detail component

**Acceptance Criteria:**

- [ ] Personal Staff detail section shows: display name, avatar, persona (editable with AI gen), model selector
- [ ] roleTitle ("Personal Assistant") and jobDescription shown as read-only text
- [ ] No mentor selector (mentor is fixed to owner)
- [ ] Visibility section with two toggle switches: "Allow @mentions" and "Allow direct messages"
- [ ] Enabling either visibility toggle shows a privacy warning dialog before confirming
- [ ] Chat button opens DM with personal staff
- [ ] Delete button with confirmation dialog

**Verify:** `pnpm dev:client` — navigate to personal staff detail page, all sections render and toggles work

**Steps:**

- [ ] **Step 1: Create PersonalStaffDetailSection**

Create `apps/client/src/components/ai-staff/PersonalStaffDetailSection.tsx`. This component mirrors `CommonStaffDetailSection` but:

- Removes mentor selector
- Shows roleTitle/jobDescription as static text
- Adds Visibility section with toggle switches
- Reuses the same avatar picker, persona editor, model selector patterns

Key sections:

```tsx
// Visibility settings section
<div className="space-y-4">
  <h3 className="text-sm font-medium">Privacy Settings</h3>

  <div className="flex items-center justify-between">
    <div>
      <Label>Allow @mentions</Label>
      <p className="text-xs text-muted-foreground">
        Other members can mention your assistant in channels
      </p>
    </div>
    <Switch
      checked={visibility.allowMention}
      onCheckedChange={(checked) =>
        handleVisibilityChange("allowMention", checked)
      }
    />
  </div>

  <div className="flex items-center justify-between">
    <div>
      <Label>Allow direct messages</Label>
      <p className="text-xs text-muted-foreground">
        Other members can chat directly with your assistant
      </p>
    </div>
    <Switch
      checked={visibility.allowDirectMessage}
      onCheckedChange={(checked) =>
        handleVisibilityChange("allowDirectMessage", checked)
      }
    />
  </div>
</div>
```

Privacy warning dialog (shown when enabling either toggle):

```tsx
<AlertDialog>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Privacy Notice</AlertDialogTitle>
      <AlertDialogDescription>
        Enabling this will allow other workspace members to interact with your
        personal assistant. Your assistant may reference information from your
        previous conversations when responding to others. Please be aware of
        potential information exposure.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction onClick={confirmVisibilityChange}>
        Enable
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

- [ ] **Step 2: Update AIStaffDetailContent to route personal staff**

In `apps/client/src/components/layout/contents/AIStaffDetailContent.tsx`, add detection for personal staff bots and render `PersonalStaffDetailSection` instead of `CommonStaffDetailSection`:

```typescript
// Around lines 82-104 (type guards), add:
function isPersonalStaffBot(bot: any): boolean {
  return !!bot.extra?.personalStaff;
}

// In the render logic:
if (isPersonalStaffBot(selectedBot)) {
  return <PersonalStaffDetailSection bot={selectedBot} appId={appId} />;
}
if (isCommonStaffBot(selectedBot)) {
  return <CommonStaffDetailSection bot={selectedBot} appId={appId} />;
}
```

- [ ] **Step 3: Build and verify**

```bash
pnpm build:client
```

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/components/ai-staff/ apps/client/src/components/layout/contents/AIStaffDetailContent.tsx
git commit -m "feat(client): add personal staff detail view with visibility settings"
```

---

## Task 10: Frontend — @Mention Autocomplete Filter

**Goal:** Filter restricted personal staff from @mention autocomplete suggestions for non-owners.

**Files:**

- Modify: `apps/client/src/components/channel/editor/plugins/MentionsPlugin.tsx` — Filter suggestions

**Acceptance Criteria:**

- [ ] @mention autocomplete does NOT show other users' personal staff when `allowMention: false`
- [ ] @mention autocomplete DOES show the current user's own personal staff
- [ ] @mention autocomplete DOES show other users' personal staff when `allowMention: true`

**Verify:** `pnpm dev:client` — type `@` in a channel, verify restricted personal staff is not shown

**Steps:**

- [ ] **Step 1: Update mention lookup to filter restricted bots**

The filtering should ideally happen server-side (in Task 5's search filter), but as a defense-in-depth measure, also filter on the client. In `MentionsPlugin.tsx`, the `useMentionLookupService` hook (lines 52-60) already uses `useSearchUsers`. The server-side filter from Task 5 will exclude restricted personal staff from search results, so no client-side change is needed if the backend filter is correct.

However, if the search API returns bot metadata, add a client-side filter:

```typescript
// In useMentionLookupService, after getting results:
const filteredResults = results.filter((user) => {
  // If user is a personal staff bot belonging to someone else
  if (user.botExtra?.personalStaff && user.botOwnerId !== currentUserId) {
    return user.botExtra.personalStaff.visibility?.allowMention === true;
  }
  return true;
});
```

Note: This depends on the search API returning `botExtra` and `botOwnerId` fields. If the search API doesn't return these, the server-side filter from Task 5 is the sole enforcement point.

- [ ] **Step 2: Verify with both server and client filtering**

```bash
pnpm dev:client
```

Test: Create two users. User A has personal staff with `allowMention: false`. User B types `@` in a channel — User A's personal staff should NOT appear.

- [ ] **Step 3: Commit**

```bash
git add apps/client/src/components/channel/editor/plugins/MentionsPlugin.tsx
git commit -m "feat(client): filter restricted personal staff from @mention autocomplete"
```
