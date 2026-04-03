# Common Staff System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the `team9-common-staff` blueprint as a managed singleton application, enabling users to create AI employees with profiles, roles, personas, and 3D badge cards.

**Architecture:** New `common-staff` application handler (same pattern as `openclaw` and `base-model-staff`) with dedicated CRUD endpoints, AI generation APIs (persona/avatar/candidates via SSE), and a multi-step frontend create dialog supporting 3 creation modes (form/agentic/recruitment). A 3D badge card component (React Three Fiber) provides visual identity for staff.

**Tech Stack:** NestJS (backend), React + TanStack Query/Router (frontend), Anthropic SDK (persona generation), image generation API (avatars), React Three Fiber + Drei + react-three-rapier (3D badge), Socket.io (bootstrap trigger), SSE (streaming).

**Spec:** `docs/superpowers/specs/2026-04-04-common-staff-system-design.md`

---

## File Structure

### Backend — Create

| File                                                                              | Responsibility                                |
| --------------------------------------------------------------------------------- | --------------------------------------------- |
| `apps/server/apps/gateway/src/applications/handlers/common-staff.handler.ts`      | Application handler (onInstall no-op)         |
| `apps/server/apps/gateway/src/applications/common-staff.service.ts`               | Staff CRUD business logic + claw-hive sync    |
| `apps/server/apps/gateway/src/applications/dto/common-staff.dto.ts`               | Request/response DTOs                         |
| `apps/server/apps/gateway/src/applications/common-staff.controller.ts`            | REST endpoints for staff CRUD + AI generation |
| `apps/server/apps/gateway/src/applications/handlers/common-staff.handler.spec.ts` | Handler unit tests                            |
| `apps/server/apps/gateway/src/applications/common-staff.service.spec.ts`          | Service unit tests                            |
| `apps/server/apps/gateway/src/applications/common-staff.controller.spec.ts`       | Controller unit tests                         |

### Backend — Modify

| File                                                                             | Change                                                    |
| -------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `apps/server/apps/gateway/src/applications/applications.service.ts`              | Add `common-staff` to APPLICATIONS array                  |
| `apps/server/apps/gateway/src/applications/handlers/index.ts`                    | Export CommonStaffHandler                                 |
| `apps/server/apps/gateway/src/applications/applications.module.ts`               | Register CommonStaffController, CommonStaffService        |
| `apps/server/libs/database/src/schemas/im/bots.ts`                               | Extend BotExtra with `commonStaff` field                  |
| `apps/server/libs/claw-hive/src/claw-hive.service.ts`                            | Extend updateAgent to support name/model/componentConfigs |
| `apps/server/apps/gateway/src/applications/installed-applications.controller.ts` | Add common-staff bot info to `with-bots` endpoint         |

### Frontend — Create

| File                                                               | Responsibility                                |
| ------------------------------------------------------------------ | --------------------------------------------- |
| `apps/client/src/lib/common-staff-models.ts`                       | Hardcoded model list                          |
| `apps/client/src/components/ai-staff/CreateCommonStaffDialog.tsx`  | Multi-step create dialog (3 modes)            |
| `apps/client/src/components/ai-staff/StaffBadgeCard3D.tsx`         | 3D badge card (React Three Fiber)             |
| `apps/client/src/components/ai-staff/StaffBadgeCard2D.tsx`         | 2D fallback badge card (CSS flip)             |
| `apps/client/src/components/ai-staff/StaffBadgeCard.tsx`           | Wrapper that detects WebGL and picks 3D vs 2D |
| `apps/client/src/components/ai-staff/CommonStaffDetailSection.tsx` | Detail page section for common-staff bots     |

### Frontend — Modify

| File                                                                  | Change                                                                |
| --------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `apps/client/src/services/api/applications.ts`                        | Add CommonStaffBotInfo type, CRUD + generation methods                |
| `apps/client/src/components/layout/contents/AIStaffMainContent.tsx`   | Add create button, common-staff cards                                 |
| `apps/client/src/components/layout/contents/AIStaffDetailContent.tsx` | Add common-staff detail rendering branch                              |
| `apps/client/package.json`                                            | Add @react-three/fiber, @react-three/drei, @react-three/rapier, three |

---

### Task 0: Application Definition & Handler

**Goal:** Register `common-staff` as a managed singleton auto-install application with a no-op handler.

**Files:**

- Modify: `apps/server/apps/gateway/src/applications/applications.service.ts:7-31`
- Create: `apps/server/apps/gateway/src/applications/handlers/common-staff.handler.ts`
- Modify: `apps/server/apps/gateway/src/applications/handlers/index.ts`
- Create: `apps/server/apps/gateway/src/applications/handlers/common-staff.handler.spec.ts`

**Acceptance Criteria:**

- [ ] `common-staff` appears in `APPLICATIONS` array with `type: 'managed'`, `singleton: true`, `autoInstall: true`
- [ ] `CommonStaffHandler.onInstall()` returns empty config without creating bots
- [ ] Uninstall is blocked by existing `type: 'managed'` check in service layer
- [ ] Handler is registered in DI via `APPLICATION_HANDLERS`
- [ ] Unit tests pass

**Verify:** `cd apps/server && pnpm jest --testPathPattern="common-staff.handler" --verbose` → all tests PASS

**Steps:**

- [ ] **Step 1: Write handler test**

```typescript
// apps/server/apps/gateway/src/applications/handlers/common-staff.handler.spec.ts
import { CommonStaffHandler } from "./common-staff.handler.js";

describe("CommonStaffHandler", () => {
  let handler: CommonStaffHandler;

  beforeEach(() => {
    handler = new CommonStaffHandler();
  });

  it('should have applicationId "common-staff"', () => {
    expect(handler.applicationId).toBe("common-staff");
  });

  it("should return empty config on install", async () => {
    const context = {
      installedApplication: { id: "test-id" } as any,
      tenantId: "tenant-1",
      installedBy: "user-1",
    };
    const result = await handler.onInstall(context);
    expect(result).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && pnpm jest --testPathPattern="common-staff.handler" --verbose`
Expected: FAIL — module not found

- [ ] **Step 3: Implement CommonStaffHandler**

```typescript
// apps/server/apps/gateway/src/applications/handlers/common-staff.handler.ts
import { Injectable } from "@nestjs/common";
import {
  ApplicationHandler,
  InstallContext,
  InstallResult,
} from "./application-handler.interface.js";

@Injectable()
export class CommonStaffHandler implements ApplicationHandler {
  readonly applicationId = "common-staff";

  async onInstall(_context: InstallContext): Promise<InstallResult> {
    return {};
  }
}
```

- [ ] **Step 4: Add to APPLICATIONS array**

In `apps/server/apps/gateway/src/applications/applications.service.ts`, add after `base-model-staff` entry:

```typescript
{
  id: 'common-staff',
  name: 'Common Staff',
  description: 'AI employee system with profile, role, and mentor bootstrap',
  iconUrl: '/icons/common-staff.svg',
  categories: ['ai', 'bot'],
  enabled: true,
  type: 'managed',
  singleton: true,
  autoInstall: true,
},
```

- [ ] **Step 5: Export handler and register in DI**

In `apps/server/apps/gateway/src/applications/handlers/index.ts`, add export and update `APPLICATION_HANDLERS` to include `CommonStaffHandler`.

- [ ] **Step 6: Run tests**

Run: `cd apps/server && pnpm jest --testPathPattern="common-staff.handler" --verbose`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/server/apps/gateway/src/applications/
git commit -m "feat: add common-staff application definition and handler"
```

---

### Task 1: BotExtra Schema Extension & ClawHive Service Update

**Goal:** Extend `BotExtra` with `commonStaff` field and enhance `ClawHiveService.updateAgent()` to support name/model/componentConfigs updates.

**Files:**

- Modify: `apps/server/libs/database/src/schemas/im/bots.ts:26-31`
- Modify: `apps/server/libs/claw-hive/src/claw-hive.service.ts:44-64`

**Acceptance Criteria:**

- [ ] `BotExtra` includes optional `commonStaff` field with `roleTitle`, `persona`, `jobDescription`, `model`
- [ ] `ClawHiveService.updateAgent()` accepts optional `name`, `model`, `componentConfigs` params
- [ ] Existing code using `BotExtra` and `updateAgent` remains unaffected

**Verify:** `cd apps/server && pnpm jest --testPathPattern="claw-hive" --verbose` → PASS (if tests exist) or `pnpm build:server` → compiles without errors

**Steps:**

- [ ] **Step 1: Extend BotExtra interface**

In `apps/server/libs/database/src/schemas/im/bots.ts`, update:

```typescript
export interface BotExtra {
  openclaw?: {
    agentId?: string;
    workspace?: string;
  };
  commonStaff?: {
    roleTitle?: string;
    persona?: string;
    jobDescription?: string;
    model?: { provider: string; id: string };
  };
}
```

- [ ] **Step 2: Extend ClawHiveService.updateAgent()**

In `apps/server/libs/claw-hive/src/claw-hive.service.ts`, update the `updateAgent` method to accept additional optional fields:

```typescript
async updateAgent(
  agentId: string,
  params: {
    tenantId: string;
    metadata: Record<string, unknown>;
    name?: string;
    model?: { provider: string; id: string };
    componentConfigs?: Record<string, Record<string, unknown>>;
  },
): Promise<void> {
  await this.httpClient.patch(`/api/agents/${agentId}`, params);
}
```

- [ ] **Step 3: Verify build**

Run: `cd apps/server && pnpm build`
Expected: compiles without errors

- [ ] **Step 4: Commit**

```bash
git add apps/server/libs/database/src/schemas/im/bots.ts apps/server/libs/claw-hive/
git commit -m "feat: extend BotExtra with commonStaff and enhance updateAgent"
```

---

### Task 2: Staff CRUD DTOs & Service

**Goal:** Implement the business logic for creating, updating, and deleting common-staff bots with claw-hive sync.

**Files:**

- Create: `apps/server/apps/gateway/src/applications/dto/common-staff.dto.ts`
- Create: `apps/server/apps/gateway/src/applications/common-staff.service.ts`
- Create: `apps/server/apps/gateway/src/applications/common-staff.service.spec.ts`

**Acceptance Criteria:**

- [ ] `CreateCommonStaffDto` validates required fields (displayName, model) and optional fields
- [ ] `createStaff()` creates bot via `BotService`, registers agent via `ClawHiveService`, creates DM channels, sets `BotExtra.commonStaff`
- [ ] `updateStaff()` updates bot record, syncs claw-hive agent
- [ ] `deleteStaff()` deletes claw-hive agent then bot+channels
- [ ] All operations verify the installed application is `common-staff` type
- [ ] Unit tests cover create, update, delete flows and error cases

**Verify:** `cd apps/server && pnpm jest --testPathPattern="common-staff.service" --verbose` → all PASS

**Steps:**

- [ ] **Step 1: Create DTOs**

```typescript
// apps/server/apps/gateway/src/applications/dto/common-staff.dto.ts
import {
  IsString,
  IsOptional,
  IsBoolean,
  ValidateNested,
  IsObject,
} from "class-validator";
import { Type } from "class-transformer";

class ModelDto {
  @IsString()
  provider: string;

  @IsString()
  id: string;
}

export class CreateCommonStaffDto {
  @IsString()
  displayName: string;

  @IsOptional()
  @IsString()
  roleTitle?: string;

  @IsOptional()
  @IsString()
  mentorId?: string;

  @IsOptional()
  @IsString()
  persona?: string;

  @IsOptional()
  @IsString()
  jobDescription?: string;

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

export class UpdateCommonStaffDto {
  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsString()
  roleTitle?: string;

  @IsOptional()
  @IsString()
  persona?: string;

  @IsOptional()
  @IsString()
  jobDescription?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ModelDto)
  model?: ModelDto;

  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @IsOptional()
  @IsString()
  mentorId?: string;
}
```

- [ ] **Step 2: Write service tests**

Write tests for `CommonStaffService` covering:

- `createStaff()` — calls createWorkspaceBot with correct params, registers claw-hive agent, sets BotExtra, creates DM channels
- `createStaff()` with `agenticBootstrap: true` — additionally triggers bootstrap session
- `updateStaff()` — updates bot fields, syncs claw-hive
- `deleteStaff()` — deletes claw-hive agent then bot
- Error cases: invalid app type, bot not found, claw-hive failure rollback

Mock `BotService`, `ClawHiveService`, `ChannelsService`, `InstalledApplicationsService`, `DatabaseService`.

- [ ] **Step 3: Implement CommonStaffService**

```typescript
// apps/server/apps/gateway/src/applications/common-staff.service.ts
import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { BotService } from "../bot/bot.service.js";
import { ClawHiveService } from "@app/claw-hive";
import { ChannelsService } from "../im/channels/channels.service.js";
import { InstalledApplicationsService } from "./installed-applications.service.js";
import { DatabaseService } from "@app/database";
import {
  CreateCommonStaffDto,
  UpdateCommonStaffDto,
} from "./dto/common-staff.dto.js";
import { env } from "../config/env.js";
import * as schema from "@app/database/schemas";
import { eq, and, ne } from "drizzle-orm";

@Injectable()
export class CommonStaffService {
  constructor(
    private readonly botService: BotService,
    private readonly clawHiveService: ClawHiveService,
    private readonly channelsService: ChannelsService,
    private readonly installedApplicationsService: InstalledApplicationsService,
    private readonly db: DatabaseService,
  ) {}

  async createStaff(
    appId: string,
    tenantId: string,
    userId: string,
    dto: CreateCommonStaffDto,
  ) {
    // Verify app is common-staff
    const app = await this.installedApplicationsService.findById(
      appId,
      tenantId,
    );
    if (app.applicationId !== "common-staff") {
      throw new BadRequestException("Not a common-staff application");
    }

    const mentorId = dto.mentorId ?? userId;

    // 1. Create bot with token (managedMeta set without agentId initially)
    const { bot, accessToken } = await this.botService.createWorkspaceBot({
      ownerId: userId,
      tenantId,
      type: "custom",
      displayName: dto.displayName,
      installedApplicationId: appId,
      generateToken: true,
      mentorId,
      managedProvider: "hive",
      managedMeta: {},
    });

    // Now that we have botId, update managedMeta with the agentId
    await this.db.db
      .update(schema.bots)
      .set({ managedMeta: { agentId: `common-staff-${bot.botId}` } })
      .where(eq(schema.bots.id, bot.botId));

    // Set BotExtra.commonStaff
    await this.botService.updateBotExtra(bot.botId, {
      commonStaff: {
        roleTitle: dto.roleTitle,
        persona: dto.persona,
        jobDescription: dto.jobDescription,
        model: dto.model,
      },
    });

    // 2. Register with claw-hive
    await this.clawHiveService.registerAgent({
      id: `common-staff-${bot.botId}`,
      name: dto.displayName,
      blueprintId: "team9-common-staff",
      tenantId,
      model: dto.model,
      metadata: { tenantId, botId: bot.botId, mentorId },
      componentConfigs: {
        "system-prompt": { prompt: "You are a helpful AI assistant." },
        team9: {
          team9AuthToken: accessToken,
          botUserId: bot.userId,
          team9BaseUrl: env.API_URL,
        },
        "team9-staff-profile": {},
        "team9-staff-bootstrap": {},
        "team9-staff-soul": {},
      },
    });

    // 3. Create DM channels for all workspace members
    const members = await this.db.db
      .select({ userId: schema.tenantMembers.userId })
      .from(schema.tenantMembers)
      .where(
        and(
          eq(schema.tenantMembers.tenantId, tenantId),
          ne(schema.tenantMembers.userId, bot.userId),
        ),
      );
    const memberUserIds = members.map((m) => m.userId);
    await this.channelsService.createDirectChannelsBatch(
      bot.userId,
      memberUserIds,
      tenantId,
    );

    // 4. If agentic bootstrap, trigger session (implemented in Task 10)
    // if (dto.agenticBootstrap) { ... }

    return {
      botId: bot.botId,
      userId: bot.userId,
      agentId: `common-staff-${bot.botId}`,
      displayName: dto.displayName,
    };
  }

  async updateStaff(
    appId: string,
    botId: string,
    tenantId: string,
    dto: UpdateCommonStaffDto,
  ) {
    // Verify app + bot belong together
    const app = await this.installedApplicationsService.findById(
      appId,
      tenantId,
    );
    if (app.applicationId !== "common-staff") {
      throw new BadRequestException("Not a common-staff application");
    }

    const bot = await this.botService.getBotById(botId);
    if (!bot || bot.installedApplicationId !== appId) {
      throw new NotFoundException("Bot not found for this application");
    }

    // Update local bot fields
    if (dto.displayName) {
      await this.botService.updateBotDisplayName(botId, dto.displayName);
    }
    if (dto.mentorId !== undefined) {
      await this.botService.updateBotMentor(botId, dto.mentorId);
    }
    if (dto.avatarUrl !== undefined) {
      await this.botService.updateBotAvatar(botId, dto.avatarUrl);
    }

    // Update BotExtra.commonStaff
    const currentExtra = bot.extra ?? {};
    const currentCommonStaff = currentExtra.commonStaff ?? {};
    await this.botService.updateBotExtra(botId, {
      ...currentExtra,
      commonStaff: {
        ...currentCommonStaff,
        ...(dto.roleTitle !== undefined && { roleTitle: dto.roleTitle }),
        ...(dto.persona !== undefined && { persona: dto.persona }),
        ...(dto.jobDescription !== undefined && {
          jobDescription: dto.jobDescription,
        }),
        ...(dto.model !== undefined && { model: dto.model }),
      },
    });

    // Sync claw-hive agent
    await this.clawHiveService.updateAgent(`common-staff-${botId}`, {
      tenantId,
      metadata: { tenantId, botId, mentorId: dto.mentorId ?? bot.mentorId },
      ...(dto.displayName && { name: dto.displayName }),
      ...(dto.model && { model: dto.model }),
    });
  }

  async deleteStaff(appId: string, botId: string, tenantId: string) {
    const app = await this.installedApplicationsService.findById(
      appId,
      tenantId,
    );
    if (app.applicationId !== "common-staff") {
      throw new BadRequestException("Not a common-staff application");
    }

    // 1. Unregister from claw-hive
    await this.clawHiveService.deleteAgent(`common-staff-${botId}`);

    // 2. Delete bot and cleanup (DM channels, etc.)
    await this.botService.deleteBotAndCleanup(botId);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd apps/server && pnpm jest --testPathPattern="common-staff.service" --verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/apps/gateway/src/applications/dto/ apps/server/apps/gateway/src/applications/common-staff.service*
git commit -m "feat: add common-staff service with CRUD and claw-hive sync"
```

---

### Task 3: Staff CRUD Controller & Module Wiring

**Goal:** Expose REST endpoints for common-staff CRUD and wire everything into the NestJS module.

**Files:**

- Create: `apps/server/apps/gateway/src/applications/common-staff.controller.ts`
- Create: `apps/server/apps/gateway/src/applications/common-staff.controller.spec.ts`
- Modify: `apps/server/apps/gateway/src/applications/applications.module.ts`
- Modify: `apps/server/apps/gateway/src/applications/installed-applications.controller.ts` (add common-staff to with-bots)

**Acceptance Criteria:**

- [ ] `POST /v1/installed-applications/:id/common-staff/staff` creates a staff member
- [ ] `PATCH /v1/installed-applications/:id/common-staff/staff/:botId` updates a staff member
- [ ] `DELETE /v1/installed-applications/:id/common-staff/staff/:botId` deletes a staff member
- [ ] `GET /v1/installed-applications/with-bots` includes common-staff bots with `CommonStaffBotInfo` shape
- [ ] All endpoints require `JwtAuthGuard`
- [ ] Controller tests pass

**Verify:** `cd apps/server && pnpm jest --testPathPattern="common-staff.controller" --verbose` → PASS

**Steps:**

- [ ] **Step 1: Write controller tests**

Test the controller methods by mocking `CommonStaffService`. Cover:

- Create staff — calls service, returns 201 with bot info
- Update staff — calls service, returns 200
- Delete staff — calls service, returns 204
- Auth guard is applied

- [ ] **Step 2: Implement CommonStaffController**

```typescript
// apps/server/apps/gateway/src/applications/common-staff.controller.ts
import {
  Controller,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { CurrentUserId } from "../auth/current-user.decorator.js";
import { CurrentTenantId } from "../workspace/current-tenant.decorator.js";
import { CommonStaffService } from "./common-staff.service.js";
import {
  CreateCommonStaffDto,
  UpdateCommonStaffDto,
} from "./dto/common-staff.dto.js";

@Controller("v1/installed-applications/:id/common-staff")
@UseGuards(JwtAuthGuard)
export class CommonStaffController {
  constructor(private readonly commonStaffService: CommonStaffService) {}

  @Post("staff")
  async createStaff(
    @Param("id") appId: string,
    @CurrentTenantId() tenantId: string,
    @CurrentUserId() userId: string,
    @Body() dto: CreateCommonStaffDto,
  ) {
    return this.commonStaffService.createStaff(appId, tenantId, userId, dto);
  }

  @Patch("staff/:botId")
  async updateStaff(
    @Param("id") appId: string,
    @Param("botId") botId: string,
    @CurrentTenantId() tenantId: string,
    @Body() dto: UpdateCommonStaffDto,
  ) {
    await this.commonStaffService.updateStaff(appId, botId, tenantId, dto);
  }

  @Delete("staff/:botId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteStaff(
    @Param("id") appId: string,
    @Param("botId") botId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    await this.commonStaffService.deleteStaff(appId, botId, tenantId);
  }
}
```

- [ ] **Step 3: Register in ApplicationsModule**

In `apps/server/apps/gateway/src/applications/applications.module.ts`:

- Add `CommonStaffController` to `controllers` array
- Add `CommonStaffService` to `providers` array
- Add necessary imports (BotModule if not already imported)

- [ ] **Step 4: Add common-staff bots to with-bots endpoint**

In `apps/server/apps/gateway/src/applications/installed-applications.controller.ts`, in the `findAllWithBots()` method, add a new case for `common-staff` alongside existing `openclaw` and `base-model-staff` cases. Fetch bots by `installedApplicationId`, map to `CommonStaffBotInfo` shape including `extra.commonStaff` fields.

- [ ] **Step 5: Run tests**

Run: `cd apps/server && pnpm jest --testPathPattern="common-staff" --verbose`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/server/apps/gateway/src/applications/
git commit -m "feat: add common-staff controller endpoints and module wiring"
```

---

### Task 4: Persona Streaming Generation API

**Goal:** SSE endpoint that streams AI-generated persona text based on staff info and user prompt.

**Files:**

- Modify: `apps/server/apps/gateway/src/applications/common-staff.controller.ts`
- Modify: `apps/server/apps/gateway/src/applications/common-staff.service.ts`
- Create: `apps/server/apps/gateway/src/applications/dto/generate-persona.dto.ts`

**Acceptance Criteria:**

- [ ] `POST /v1/installed-applications/:id/common-staff/generate-persona` returns SSE stream
- [ ] Accepts optional `displayName`, `roleTitle`, `existingPersona`, `prompt`
- [ ] Uses AI client to stream persona generation
- [ ] Persona is personality-rich (traits, communication style, quirks)
- [ ] When `existingPersona` is provided, expands rather than regenerates
- [ ] Requires JwtAuthGuard

**Verify:** `curl -N -X POST http://localhost:3000/v1/installed-applications/{id}/common-staff/generate-persona -H "Authorization: Bearer {token}" -H "Content-Type: application/json" -d '{"displayName":"Alice","roleTitle":"Engineer"}' ` → streams SSE events

**Steps:**

- [ ] **Step 1: Create DTO**

```typescript
// apps/server/apps/gateway/src/applications/dto/generate-persona.dto.ts
import { IsOptional, IsString } from "class-validator";

export class GeneratePersonaDto {
  @IsOptional() @IsString() displayName?: string;
  @IsOptional() @IsString() roleTitle?: string;
  @IsOptional() @IsString() existingPersona?: string;
  @IsOptional() @IsString() prompt?: string;
}

export class GenerateAvatarDto {
  @IsString() style: "realistic" | "cartoon" | "anime" | "notion-lineart";
  @IsOptional() @IsString() displayName?: string;
  @IsOptional() @IsString() roleTitle?: string;
  @IsOptional() @IsString() persona?: string;
  @IsOptional() @IsString() prompt?: string;
}

export class GenerateCandidatesDto {
  @IsOptional() @IsString() jobTitle?: string;
  @IsOptional() @IsString() jobDescription?: string;
}
```

- [ ] **Step 2: Add persona generation to service**

In `CommonStaffService`, add a `generatePersona()` method that:

- Builds a system prompt instructing the LLM to create a rich, personality-driven persona
- Includes context from displayName, roleTitle, existingPersona, user prompt
- Uses the existing `AiClientService` with streaming enabled
- Returns an AsyncGenerator of text chunks

- [ ] **Step 3: Add SSE endpoint to controller**

```typescript
@Post('generate-persona')
@Header('Content-Type', 'text/event-stream')
@Header('Cache-Control', 'no-cache')
@Header('Connection', 'keep-alive')
async generatePersona(
  @Param('id') appId: string,
  @CurrentTenantId() tenantId: string,
  @Body() dto: GeneratePersonaDto,
  @Res() res: Response,
) {
  const stream = await this.commonStaffService.generatePersona(appId, tenantId, dto);
  for await (const chunk of stream) {
    res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
  }
  res.write('data: [DONE]\n\n');
  res.end();
}
```

- [ ] **Step 4: Test manually with curl**

- [ ] **Step 5: Commit**

```bash
git add apps/server/apps/gateway/src/applications/
git commit -m "feat: add persona streaming generation endpoint"
```

---

### Task 5: Avatar AI Generation & Candidate Generation APIs

**Goal:** Image generation endpoint for staff avatars and SSE endpoint for recruitment-mode candidate generation.

**Files:**

- Modify: `apps/server/apps/gateway/src/applications/common-staff.controller.ts`
- Modify: `apps/server/apps/gateway/src/applications/common-staff.service.ts`

**Acceptance Criteria:**

- [ ] `POST .../generate-avatar` accepts style + context, returns `{ avatarUrl }`
- [ ] `POST .../generate-candidates` streams 3 candidate role cards via SSE
- [ ] Avatar is uploaded to file service after generation
- [ ] Both endpoints require JwtAuthGuard

**Verify:** `cd apps/server && pnpm build` → compiles

**Steps:**

- [ ] **Step 1: Implement avatar generation in service**

Add `generateAvatar()` method that:

- Maps style to base prompt template
- Combines with staff info context
- Calls image generation API (environment-variable-configured key)
- Uploads result to file service
- Returns URL

- [ ] **Step 2: Implement candidate generation in service**

Add `generateCandidates()` method that:

- Builds prompt to generate 3 diverse candidate profiles (each with displayName, roleTitle, persona summary)
- Streams as structured JSON objects via AsyncGenerator
- Each candidate includes enough data for a badge card

- [ ] **Step 3: Add controller endpoints**

```typescript
@Post('generate-avatar')
async generateAvatar(
  @Param('id') appId: string,
  @CurrentTenantId() tenantId: string,
  @Body() dto: GenerateAvatarDto,
) {
  return this.commonStaffService.generateAvatar(appId, tenantId, dto);
}

@Post('generate-candidates')
@Header('Content-Type', 'text/event-stream')
@Header('Cache-Control', 'no-cache')
@Header('Connection', 'keep-alive')
async generateCandidates(
  @Param('id') appId: string,
  @CurrentTenantId() tenantId: string,
  @Body() dto: GenerateCandidatesDto,
  @Res() res: Response,
) {
  const stream = await this.commonStaffService.generateCandidates(appId, tenantId, dto);
  for await (const chunk of stream) {
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }
  res.write('data: [DONE]\n\n');
  res.end();
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/server/apps/gateway/src/applications/
git commit -m "feat: add avatar generation and candidate generation endpoints"
```

---

### Task 6: Frontend API Client & Types

**Goal:** Add common-staff API methods and TypeScript types to the frontend API client.

**Files:**

- Modify: `apps/client/src/services/api/applications.ts`
- Create: `apps/client/src/lib/common-staff-models.ts`

**Acceptance Criteria:**

- [ ] `CommonStaffBotInfo` type defined with all fields (roleTitle, persona, model, etc.)
- [ ] `InstalledApplicationWithBots.bots` union updated to include `CommonStaffBotInfo`
- [ ] API methods: `createCommonStaff`, `updateCommonStaff`, `deleteCommonStaff`
- [ ] Streaming helpers: `generatePersona`, `generateCandidates` (return EventSource or fetch+ReadableStream)
- [ ] `generateAvatar` returns `{ avatarUrl }`
- [ ] `COMMON_STAFF_MODELS` array exported with default model
- [ ] TypeScript compiles without errors

**Verify:** `cd apps/client && pnpm tsc --noEmit` → no errors

**Steps:**

- [ ] **Step 1: Create model list**

```typescript
// apps/client/src/lib/common-staff-models.ts
export interface StaffModel {
  provider: string;
  id: string;
  label: string;
  default?: boolean;
}

export const COMMON_STAFF_MODELS: StaffModel[] = [
  {
    provider: "anthropic",
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    default: true,
  },
  { provider: "anthropic", id: "claude-opus-4-6", label: "Claude Opus 4.6" },
  { provider: "openai", id: "gpt-4.1", label: "GPT-4.1" },
  { provider: "openai", id: "o3", label: "o3" },
  { provider: "google", id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
];

export const DEFAULT_STAFF_MODEL = COMMON_STAFF_MODELS.find((m) => m.default)!;
```

- [ ] **Step 2: Add CommonStaffBotInfo type**

In `apps/client/src/services/api/applications.ts`, add:

```typescript
export interface CommonStaffBotInfo {
  botId: string;
  userId: string;
  username: string;
  displayName: string | null;
  roleTitle: string | null;
  persona: string | null;
  jobDescription: string | null;
  avatarUrl: string | null;
  model: { provider: string; id: string } | null;
  mentorId: string | null;
  mentorDisplayName: string | null;
  mentorAvatarUrl: string | null;
  isActive: boolean;
  createdAt: string;
  managedMeta: { agentId: string } | null;
}
```

Update the `AIStaffBot` union and `InstalledApplicationWithBots` to include this type.

- [ ] **Step 3: Add API methods**

Add to the applications API client object:

```typescript
createCommonStaff(appId: string, body: {
  displayName: string;
  roleTitle?: string;
  mentorId?: string;
  persona?: string;
  jobDescription?: string;
  model: { provider: string; id: string };
  avatarUrl?: string;
  agenticBootstrap?: boolean;
}): Promise<{ botId: string; userId: string; agentId: string; displayName: string }> {
  return httpClient.post(`/v1/installed-applications/${appId}/common-staff/staff`, body);
},

updateCommonStaff(appId: string, botId: string, body: Record<string, unknown>): Promise<void> {
  return httpClient.patch(`/v1/installed-applications/${appId}/common-staff/staff/${botId}`, body);
},

deleteCommonStaff(appId: string, botId: string): Promise<void> {
  return httpClient.delete(`/v1/installed-applications/${appId}/common-staff/staff/${botId}`);
},

generateAvatar(appId: string, body: {
  style: string;
  displayName?: string;
  roleTitle?: string;
  persona?: string;
  prompt?: string;
}): Promise<{ avatarUrl: string }> {
  return httpClient.post(`/v1/installed-applications/${appId}/common-staff/generate-avatar`, body);
},
```

For streaming methods (`generatePersona`, `generateCandidates`), use `fetch` with `ReadableStream` or `EventSource` — follow the existing SSE pattern from `useExecutionStream`.

- [ ] **Step 4: Verify TypeScript compilation**

Run: `cd apps/client && pnpm tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/services/api/applications.ts apps/client/src/lib/common-staff-models.ts
git commit -m "feat: add common-staff frontend API client and types"
```

---

### Task 7: 3D Badge Card Component

**Goal:** Build a 3D interactive badge card using React Three Fiber, with a 2D CSS fallback.

**Files:**

- Create: `apps/client/src/components/ai-staff/StaffBadgeCard3D.tsx`
- Create: `apps/client/src/components/ai-staff/StaffBadgeCard2D.tsx`
- Create: `apps/client/src/components/ai-staff/StaffBadgeCard.tsx`
- Modify: `apps/client/package.json` (add 3D deps)

**Acceptance Criteria:**

- [ ] 3D badge renders with lanyard, flip interaction, and dynamic content
- [ ] Front shows: avatar, displayName, roleTitle, mentor
- [ ] Back shows: persona summary, model
- [ ] 2D fallback renders same content with CSS perspective flip
- [ ] Wrapper auto-detects WebGL support and chooses 3D vs 2D
- [ ] Component accepts `StaffBadgeCardProps` with all fields

**Verify:** `cd apps/client && pnpm tsc --noEmit` → no errors; visual verification in browser

**Steps:**

- [ ] **Step 1: Install 3D dependencies**

```bash
cd apps/client && pnpm add @react-three/fiber @react-three/drei @react-three/rapier three
cd apps/client && pnpm add -D @types/three
```

- [ ] **Step 2: Create shared props type**

```typescript
// In StaffBadgeCard.tsx
export interface StaffBadgeCardProps {
  displayName: string;
  roleTitle?: string;
  avatarUrl?: string;
  mentorName?: string;
  mentorAvatarUrl?: string;
  persona?: string;
  modelLabel?: string;
  selected?: boolean;
  onClick?: () => void;
}
```

- [ ] **Step 3: Implement 2D fallback card**

`StaffBadgeCard2D.tsx` — CSS perspective-based flip card:

- Front face with avatar, name, role, mentor badge
- Back face with persona summary and model
- Click to flip via CSS `transform: rotateY(180deg)`
- Uses existing shadcn Card/Avatar components
- Styled with Tailwind + CSS transforms

- [ ] **Step 4: Implement 3D badge card**

`StaffBadgeCard3D.tsx` — React Three Fiber scene:

- `Canvas` with `Physics` from react-three-rapier
- Lanyard with rope joints (RopeJoint from react-three-rapier)
- Badge mesh with front/back textures via `RenderTexture` from Drei
- Drag interaction using `useDrag` from `@use-gesture/react` or Drei's `DragControls`
- Click/flip rotation animation
- Reference: Vercel 3D Event Badge pattern (~80 lines declarative)

- [ ] **Step 5: Implement wrapper with WebGL detection**

```typescript
// StaffBadgeCard.tsx
import { lazy, Suspense } from 'react';
import { StaffBadgeCard2D } from './StaffBadgeCard2D';

const StaffBadgeCard3D = lazy(() => import('./StaffBadgeCard3D'));

function detectWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch { return false; }
}

const hasWebGL = detectWebGL();

export function StaffBadgeCard(props: StaffBadgeCardProps) {
  if (!hasWebGL) return <StaffBadgeCard2D {...props} />;
  return (
    <Suspense fallback={<StaffBadgeCard2D {...props} />}>
      <StaffBadgeCard3D {...props} />
    </Suspense>
  );
}
```

- [ ] **Step 6: Verify build**

Run: `cd apps/client && pnpm tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add apps/client/src/components/ai-staff/StaffBadgeCard* apps/client/package.json pnpm-lock.yaml
git commit -m "feat: add 3D badge card component with 2D fallback"
```

---

### Task 8: Frontend Create Dialog — Form Mode

**Goal:** Build the multi-step create dialog with Form Mode as the primary path.

**Files:**

- Create: `apps/client/src/components/ai-staff/CreateCommonStaffDialog.tsx`
- Modify: `apps/client/src/components/layout/contents/AIStaffMainContent.tsx`

**Acceptance Criteria:**

- [ ] Step 1: Three creation mode cards (Form / Agentic / Recruitment) — only Form is functional in this task
- [ ] Step 2 (Form): Display Name, Role Title, Job Description, Mentor dropdown, Model dropdown
- [ ] Step 3 (Form): Persona textarea with "AI Generate" button (SSE streaming into textarea)
- [ ] Step 4 (Form): Avatar upload/preset/AI-generate + badge card preview
- [ ] Back/Next navigation between steps
- [ ] Submit calls `createCommonStaff` API
- [ ] Success invalidates queries, navigates to detail page
- [ ] "Create Staff" button added to AIStaffMainContent

**Verify:** Visual verification in browser; `cd apps/client && pnpm tsc --noEmit` → no errors

**Steps:**

- [ ] **Step 1: Add create button to AIStaffMainContent**

In `AIStaffMainContent.tsx`, find the create dialog trigger area. Add a "Create Staff" button that opens `CreateCommonStaffDialog`. Pass the common-staff app ID (find from `installedApplicationsWithBots` data where `applicationId === 'common-staff'`).

- [ ] **Step 2: Create dialog scaffold with step state**

```typescript
// apps/client/src/components/ai-staff/CreateCommonStaffDialog.tsx
type CreationMode = "form" | "agentic" | "recruitment";
type FormStep = 1 | 2 | 3 | 4;

const [mode, setMode] = useState<CreationMode | null>(null);
const [step, setStep] = useState<FormStep>(1);
```

Step 1: Three card options for mode selection. Step transitions managed by mode.

- [ ] **Step 3: Implement Form Mode Step 2 — Basic Info**

Fields:

- `displayName` (Input, required)
- `roleTitle` (Input, required)
- `jobDescription` (Textarea, optional)
- `mentorId` (Select dropdown, populated from workspace members via `useQuery`, defaults to current user)
- `model` (Select dropdown, populated from `COMMON_STAFF_MODELS`, defaults to `DEFAULT_STAFF_MODEL`)

Use existing UI patterns from the OpenClaw create dialog (shadcn Dialog, Input, Select components).

- [ ] **Step 4: Implement Form Mode Step 3 — Persona**

- Textarea for persona with character count
- "AI Generate" button triggers `fetch` to `/generate-persona` SSE endpoint
- Stream text into textarea progressively (append chunks)
- "AI Generate" button changes to "Regenerate" after first generation
- When regenerating with existing text, sends `existingPersona` to expand
- Optional `prompt` input for user guidance (e.g. "make it more fun")

- [ ] **Step 5: Implement Form Mode Step 4 — Avatar & Preview**

Three sub-options for avatar:

- Upload: file input → upload to file service → get URL
- Presets: grid of preset avatar images to select
- AI Generate: select style (4 options) → call `/generate-avatar` → show result

Below avatar selection, render `StaffBadgeCard` with all current form data as preview.

- [ ] **Step 6: Wire submit to API**

On final submit:

```typescript
const mutation = useMutation({
  mutationFn: () =>
    api.applications.createCommonStaff(appId, {
      displayName,
      roleTitle,
      mentorId,
      persona,
      jobDescription,
      model,
      avatarUrl,
    }),
  onSuccess: (data) => {
    queryClient.invalidateQueries({
      queryKey: ["installed-applications-with-bots", workspaceId],
    });
    navigate({ to: "/ai-staff/$staffId", params: { staffId: data.botId } });
    onOpenChange(false);
  },
});
```

- [ ] **Step 7: Commit**

```bash
git add apps/client/src/components/ai-staff/CreateCommonStaffDialog.tsx apps/client/src/components/layout/contents/AIStaffMainContent.tsx
git commit -m "feat: add common-staff create dialog with form mode"
```

---

### Task 9: Frontend Create Dialog — Agentic & Recruitment Modes

**Goal:** Add the remaining two creation paths to the create dialog.

**Files:**

- Modify: `apps/client/src/components/ai-staff/CreateCommonStaffDialog.tsx`

**Acceptance Criteria:**

- [ ] Agentic Mode Step 2: Model select → submit creates bot with `agenticBootstrap: true` → navigates to mentor DM
- [ ] Recruitment Mode Step 2: Job Title + JD inputs
- [ ] Recruitment Mode Step 3: Streams 3 candidates as badge cards, editable, selectable, re-rollable
- [ ] Recruitment Mode Step 4: Model + Mentor select → submit creates selected candidate

**Verify:** Visual verification in browser

**Steps:**

- [ ] **Step 1: Implement Agentic Mode**

Step 2: Only Model dropdown.
On submit: call `createCommonStaff` with `agenticBootstrap: true`, minimal data. On success, navigate to the mentor's DM channel with the new bot (find the DM channel from existing channel data).

- [ ] **Step 2: Implement Recruitment Mode Steps 2-3**

Step 2: Job Title (Input, optional) + JD (Textarea, optional).
Step 3:

- On entering step 3, initiate `fetch` to `/generate-candidates` SSE endpoint
- Parse each streamed candidate object, render as a `StaffBadgeCard`
- Show 3 cards in a row/grid
- After generation completes, each card becomes editable (click to edit fields)
- "Re-roll" button re-triggers generation
- User selects one card (highlight selected)

- [ ] **Step 3: Implement Recruitment Mode Step 4**

Model dropdown + Mentor dropdown. On submit: call `createCommonStaff` with the selected candidate's data.

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/components/ai-staff/CreateCommonStaffDialog.tsx
git commit -m "feat: add agentic and recruitment creation modes"
```

---

### Task 10: Frontend Detail Page — Common Staff Section

**Goal:** Add common-staff rendering branch to the AI Staff detail page with inline editing.

**Files:**

- Create: `apps/client/src/components/ai-staff/CommonStaffDetailSection.tsx`
- Modify: `apps/client/src/components/layout/contents/AIStaffDetailContent.tsx`

**Acceptance Criteria:**

- [ ] New type guard `isCommonStaffBot()` distinguishes common-staff from other types
- [ ] Profile card: avatar (changeable), display name (inline edit), role title (inline edit), status badge, chat button
- [ ] Info section: persona (textarea + AI regenerate), model (dropdown), mentor (dropdown), job description (textarea), created at
- [ ] All edits call `updateCommonStaff` API and sync
- [ ] Delete button with confirmation dialog calls `deleteCommonStaff`

**Verify:** Visual verification in browser; `cd apps/client && pnpm tsc --noEmit` → no errors

**Steps:**

- [ ] **Step 1: Add type guard**

In `AIStaffDetailContent.tsx`, add:

```typescript
function isCommonStaffBot(bot: AIStaffBot): bot is CommonStaffBotInfo {
  return (
    "managedMeta" in bot &&
    bot.managedMeta?.agentId?.startsWith("common-staff-") === true
  );
}
```

- [ ] **Step 2: Create CommonStaffDetailSection component**

Separate component for clarity. Receives `bot: CommonStaffBotInfo`, `app: InstalledApplicationWithBots`, `workspaceId: string`.

Implements:

- Profile card with avatar, inline-editable name/roleTitle (reuse existing inline edit pattern from openclaw section)
- Mentor dropdown (reuse existing pattern)
- Model dropdown using `COMMON_STAFF_MODELS`
- Persona textarea with AI regenerate button (SSE streaming)
- Job description textarea
- Delete with AlertDialog confirmation

Each edit triggers a `useMutation` calling `updateCommonStaff`.

- [ ] **Step 3: Add rendering branch in AIStaffDetailContent**

Add a new conditional block alongside existing openclaw/base-model-staff branches:

```typescript
{!isLoading && commonStaffBot && currentApp?.applicationId === 'common-staff' && (
  <CommonStaffDetailSection
    bot={commonStaffBot}
    app={currentApp}
    workspaceId={workspaceId}
  />
)}
```

- [ ] **Step 4: Add common-staff cards to main list**

In `AIStaffMainContent.tsx`, update `AIStaffBotCard` to handle `CommonStaffBotInfo`:

- Show avatar (from `avatarUrl` or initials fallback)
- Show role title badge
- Show mentor info

- [ ] **Step 5: Verify build and visual test**

Run: `cd apps/client && pnpm tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add apps/client/src/components/ai-staff/ apps/client/src/components/layout/contents/
git commit -m "feat: add common-staff detail page with inline editing"
```

---

### Task 11: Agentic Bootstrap Session Trigger

**Goal:** Implement server-side logic to trigger a claw-hive bootstrap session in the mentor's DM when agentic creation mode is used.

**Files:**

- Modify: `apps/server/apps/gateway/src/applications/common-staff.service.ts`
- Modify: `apps/server/apps/gateway/src/im/websocket/websocket.gateway.ts` (if needed)

**Acceptance Criteria:**

- [ ] When `agenticBootstrap === true`, after bot creation + claw-hive registration:
  1. Find the DM channel between mentor and bot
  2. Trigger a claw-hive session in that channel with `isMentorDm: true` context
  3. Agent sends welcome message in the DM
- [ ] Uses existing WebSocket gateway DM → session creation flow
- [ ] Temporary display name ("Candidate #N") auto-generated if displayName not provided

**Verify:** Manual test: create staff with agentic mode → mentor receives welcome DM from new bot

**Steps:**

- [ ] **Step 1: Find DM channel after bot creation**

In `CommonStaffService.createStaff()`, after DM channels are created:

```typescript
if (dto.agenticBootstrap) {
  // Find the DM channel between mentor and bot
  const dmChannel = await this.channelsService.findDirectChannel(
    bot.userId,
    mentorId,
    tenantId,
  );

  if (dmChannel) {
    // Trigger bootstrap session via WebSocket gateway
    await this.triggerBootstrapSession(bot, dmChannel, tenantId, mentorId);
  }
}
```

- [ ] **Step 2: Implement triggerBootstrapSession**

This method needs to create a claw-hive session in the DM channel context with `isMentorDm: true`. The exact mechanism depends on how the existing WebSocket gateway creates sessions for bot DMs. Options:

- Emit an internal event that the WebSocket gateway picks up
- Call the claw-hive session creation API directly
- Use the existing message-triggered session flow by sending a synthetic system message

Investigate the WebSocket gateway's DM message handling to determine the best approach and implement accordingly.

- [ ] **Step 3: Handle temporary names**

```typescript
if (dto.agenticBootstrap && !dto.displayName) {
  // Count existing common-staff bots for this tenant
  const existingCount = await this.countCommonStaffBots(tenantId);
  dto.displayName = `Candidate #${existingCount + 1}`;
}
```

- [ ] **Step 4: Test manually**

Create a staff member with agentic mode via the UI. Verify mentor receives a welcome DM from the new bot.

- [ ] **Step 5: Commit**

```bash
git add apps/server/apps/gateway/src/applications/ apps/server/apps/gateway/src/im/
git commit -m "feat: add agentic bootstrap session trigger for common-staff"
```

---

## Task Dependency Graph

```
Task 0 (App Definition)
  └─→ Task 1 (Schema Extension)
       └─→ Task 2 (Service CRUD)
            └─→ Task 3 (Controller + Module)
                 ├─→ Task 4 (Persona API)
                 ├─→ Task 5 (Avatar + Candidates API)
                 └─→ Task 11 (Bootstrap Trigger)
            └─→ Task 6 (Frontend API Client)
                 ├─→ Task 7 (3D Badge Card)
                 │    └─→ Task 8 (Create Dialog - Form)
                 │         └─→ Task 9 (Create Dialog - Agentic/Recruitment)
                 └─→ Task 10 (Detail Page)
```

Tasks 4, 5, 11 can be parallelized after Task 3.
Tasks 7 and 10 can be parallelized after Task 6.
Task 8 depends on Task 7 (badge card used in form step 4).
Task 9 depends on Task 8 (extends the create dialog).
