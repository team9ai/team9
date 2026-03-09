# Resources Module Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a new "Resources" module (sidebar entry between Tasks and Library) for managing workspace-level Agent Computer and API resources with CRUD, authorization, and usage logs.

**Architecture:** Single polymorphic `resources` table with `type` enum + JSONB config. Separate `resource_usage_logs` table. NestJS backend module with controller/service/DTOs. React frontend with card grid, detail panel, and create dialog. Follows existing Tasks module patterns exactly.

**Tech Stack:** NestJS 11, Drizzle ORM, PostgreSQL, React 19, TanStack Router/Query, Zustand, Tailwind CSS, Radix UI, Lucide icons, i18next

---

## Task 1: Database Schema — `resources` table

**Files:**

- Create: `apps/server/libs/database/src/schemas/resource/resources.ts`
- Create: `apps/server/libs/database/src/schemas/resource/index.ts`
- Modify: `apps/server/libs/database/src/schemas/index.ts`

**Step 1: Create resource schema file**

Create `apps/server/libs/database/src/schemas/resource/resources.ts`:

```typescript
import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { tenants } from "../tenant/tenants.js";
import { users } from "../im/users.js";

// ── Enums ────────────────────────────────────────────────────────────

export const resourceTypeEnum = pgEnum("resource__type", [
  "agent_computer",
  "api",
]);

export const resourceStatusEnum = pgEnum("resource__status", [
  "online",
  "offline",
  "error",
  "configuring",
]);

// ── Types ────────────────────────────────────────────────────────────

export interface AgentComputerConfig {
  connectionType: "ahand" | "ssh" | "cloud";
  host?: string;
  port?: number;
  os?: string;
  arch?: string;
}

export interface ApiResourceConfig {
  provider: string;
  baseUrl?: string;
  apiKey: string;
  model?: string;
}

export type ResourceConfig = AgentComputerConfig | ApiResourceConfig;

export interface ResourceAuthorization {
  granteeType: "user" | "task";
  granteeId: string;
  permissions: { level: "full" | "readonly" };
  grantedBy: string;
  grantedAt: string;
}

// ── Table ────────────────────────────────────────────────────────────

export const resources = pgTable(
  "resources",
  {
    id: uuid("id").primaryKey().notNull(),

    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),

    type: resourceTypeEnum("type").notNull(),

    name: varchar("name", { length: 255 }).notNull(),

    description: text("description"),

    config: jsonb("config").$type<ResourceConfig>().notNull(),

    status: resourceStatusEnum("status").default("offline").notNull(),

    authorizations: jsonb("authorizations")
      .$type<ResourceAuthorization[]>()
      .default([])
      .notNull(),

    lastHeartbeatAt: timestamp("last_heartbeat_at"),

    creatorId: uuid("creator_id")
      .references(() => users.id)
      .notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_resources_tenant_id").on(table.tenantId),
    index("idx_resources_tenant_type").on(table.tenantId, table.type),
    index("idx_resources_status").on(table.status),
  ],
);

export type Resource = typeof resources.$inferSelect;
export type NewResource = typeof resources.$inferInsert;
export type ResourceType = (typeof resourceTypeEnum.enumValues)[number];
export type ResourceStatus = (typeof resourceStatusEnum.enumValues)[number];
```

**Step 2: Create barrel export**

Create `apps/server/libs/database/src/schemas/resource/index.ts`:

```typescript
export * from "./resources.js";
export * from "./resource-usage-logs.js";
export * from "./relations.js";
```

**Step 3: Register in root schemas index**

Modify `apps/server/libs/database/src/schemas/index.ts` — add line:

```typescript
export * from "./resource/index.js";
```

**Step 4: Generate and run migration**

Run: `pnpm db:generate`
Run: `pnpm db:push` (dev)

**Step 5: Commit**

```bash
git add apps/server/libs/database/src/schemas/resource/ apps/server/libs/database/src/schemas/index.ts
git commit -m "feat(resources): add resources table schema with enums and types"
```

---

## Task 2: Database Schema — `resource_usage_logs` table + relations

**Files:**

- Create: `apps/server/libs/database/src/schemas/resource/resource-usage-logs.ts`
- Create: `apps/server/libs/database/src/schemas/resource/relations.ts`

**Step 1: Create usage logs schema**

Create `apps/server/libs/database/src/schemas/resource/resource-usage-logs.ts`:

```typescript
import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { resources } from "./resources.js";
import { agentTasks } from "../task/tasks.js";
import { agentTaskExecutions } from "../task/task-executions.js";

// ── Enums ────────────────────────────────────────────────────────────

export const resourceActorTypeEnum = pgEnum("resource__actor_type", [
  "agent",
  "user",
]);

// ── Table ────────────────────────────────────────────────────────────

export const resourceUsageLogs = pgTable(
  "resource_usage_logs",
  {
    id: uuid("id").primaryKey().notNull(),

    resourceId: uuid("resource_id")
      .references(() => resources.id, { onDelete: "cascade" })
      .notNull(),

    actorType: resourceActorTypeEnum("actor_type").notNull(),

    actorId: uuid("actor_id").notNull(),

    taskId: uuid("task_id").references(() => agentTasks.id),

    executionId: uuid("execution_id").references(() => agentTaskExecutions.id),

    action: varchar("action", { length: 64 }).notNull(),

    metadata: jsonb("metadata").$type<Record<string, unknown>>(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_resource_usage_logs_resource_created").on(
      table.resourceId,
      table.createdAt,
    ),
    index("idx_resource_usage_logs_actor_created").on(
      table.actorId,
      table.createdAt,
    ),
  ],
);

export type ResourceUsageLog = typeof resourceUsageLogs.$inferSelect;
export type NewResourceUsageLog = typeof resourceUsageLogs.$inferInsert;
```

**Step 2: Create relations file**

Create `apps/server/libs/database/src/schemas/resource/relations.ts`:

```typescript
import { relations } from "drizzle-orm";
import { resources } from "./resources.js";
import { resourceUsageLogs } from "./resource-usage-logs.js";
import { tenants } from "../tenant/tenants.js";
import { users } from "../im/users.js";

export const resourcesRelations = relations(resources, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [resources.tenantId],
    references: [tenants.id],
  }),
  creator: one(users, {
    fields: [resources.creatorId],
    references: [users.id],
  }),
  usageLogs: many(resourceUsageLogs),
}));

export const resourceUsageLogsRelations = relations(
  resourceUsageLogs,
  ({ one }) => ({
    resource: one(resources, {
      fields: [resourceUsageLogs.resourceId],
      references: [resources.id],
    }),
  }),
);
```

**Step 3: Generate and push schema**

Run: `pnpm db:generate`
Run: `pnpm db:push`

**Step 4: Commit**

```bash
git add apps/server/libs/database/src/schemas/resource/
git commit -m "feat(resources): add resource_usage_logs table and relations"
```

---

## Task 3: Backend — DTOs

**Files:**

- Create: `apps/server/apps/gateway/src/resources/dto/create-resource.dto.ts`
- Create: `apps/server/apps/gateway/src/resources/dto/update-resource.dto.ts`
- Create: `apps/server/apps/gateway/src/resources/dto/authorize-resource.dto.ts`
- Create: `apps/server/apps/gateway/src/resources/dto/index.ts`

**Step 1: Create DTOs**

Create `apps/server/apps/gateway/src/resources/dto/create-resource.dto.ts`:

```typescript
import {
  IsString,
  IsOptional,
  IsIn,
  IsObject,
  MaxLength,
} from "class-validator";
import type { ResourceType } from "@team9/database/schemas";

export class CreateResourceDto {
  @IsIn(["agent_computer", "api"] as const)
  type: ResourceType;

  @IsString()
  @MaxLength(255)
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsObject()
  config: Record<string, unknown>;
}
```

Create `apps/server/apps/gateway/src/resources/dto/update-resource.dto.ts`:

```typescript
import {
  IsString,
  IsOptional,
  IsIn,
  IsObject,
  MaxLength,
} from "class-validator";
import type { ResourceStatus } from "@team9/database/schemas";

export class UpdateResourceDto {
  @IsString()
  @MaxLength(255)
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsObject()
  @IsOptional()
  config?: Record<string, unknown>;

  @IsIn(["online", "offline", "error", "configuring"] as const)
  @IsOptional()
  status?: ResourceStatus;
}
```

Create `apps/server/apps/gateway/src/resources/dto/authorize-resource.dto.ts`:

```typescript
import { IsString, IsIn, IsUUID, IsOptional, IsObject } from "class-validator";

export class AuthorizeResourceDto {
  @IsIn(["user", "task"] as const)
  granteeType: "user" | "task";

  @IsUUID()
  granteeId: string;

  @IsObject()
  @IsOptional()
  permissions?: { level: "full" | "readonly" };
}

export class RevokeResourceDto {
  @IsIn(["user", "task"] as const)
  granteeType: "user" | "task";

  @IsUUID()
  granteeId: string;
}
```

Create `apps/server/apps/gateway/src/resources/dto/index.ts`:

```typescript
export { CreateResourceDto } from "./create-resource.dto.js";
export { UpdateResourceDto } from "./update-resource.dto.js";
export {
  AuthorizeResourceDto,
  RevokeResourceDto,
} from "./authorize-resource.dto.js";
```

**Step 2: Commit**

```bash
git add apps/server/apps/gateway/src/resources/dto/
git commit -m "feat(resources): add resource DTOs"
```

---

## Task 4: Backend — Service

**Files:**

- Create: `apps/server/apps/gateway/src/resources/resources.service.ts`

**Step 1: Create resources service**

Create `apps/server/apps/gateway/src/resources/resources.service.ts`:

```typescript
import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { v7 as uuidv7 } from "uuid";
import {
  DATABASE_CONNECTION,
  eq,
  and,
  desc,
  type PostgresJsDatabase,
} from "@team9/database";
import * as schema from "@team9/database/schemas";
import type {
  ResourceType,
  ResourceAuthorization,
} from "@team9/database/schemas";
import type { CreateResourceDto } from "./dto/create-resource.dto.js";
import type { UpdateResourceDto } from "./dto/update-resource.dto.js";
import type { AuthorizeResourceDto } from "./dto/authorize-resource.dto.js";
import type { RevokeResourceDto } from "./dto/authorize-resource.dto.js";

export interface ResourceListFilters {
  type?: ResourceType;
}

@Injectable()
export class ResourcesService {
  private readonly logger = new Logger(ResourcesService.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  // ── CRUD ────────────────────────────────────────────────────────

  async create(dto: CreateResourceDto, userId: string, tenantId: string) {
    const [resource] = await this.db
      .insert(schema.resources)
      .values({
        id: uuidv7(),
        tenantId,
        type: dto.type,
        name: dto.name,
        description: dto.description ?? null,
        config: dto.config as schema.ResourceConfig,
        status: "configuring",
        creatorId: userId,
      })
      .returning();

    return resource;
  }

  async list(tenantId: string, filters?: ResourceListFilters) {
    const conditions = [eq(schema.resources.tenantId, tenantId)];

    if (filters?.type) {
      conditions.push(eq(schema.resources.type, filters.type));
    }

    return this.db
      .select()
      .from(schema.resources)
      .where(and(...conditions))
      .orderBy(desc(schema.resources.createdAt));
  }

  async getById(id: string, tenantId: string) {
    return this.getResourceOrThrow(id, tenantId);
  }

  async update(
    id: string,
    dto: UpdateResourceDto,
    userId: string,
    tenantId: string,
  ) {
    const resource = await this.getResourceOrThrow(id, tenantId);
    this.assertCreatorOwnership(resource, userId);

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.config !== undefined) updateData.config = dto.config;
    if (dto.status !== undefined) updateData.status = dto.status;

    const [updated] = await this.db
      .update(schema.resources)
      .set(updateData)
      .where(eq(schema.resources.id, id))
      .returning();

    return updated;
  }

  async delete(id: string, userId: string, tenantId: string) {
    const resource = await this.getResourceOrThrow(id, tenantId);
    this.assertCreatorOwnership(resource, userId);

    await this.db.delete(schema.resources).where(eq(schema.resources.id, id));

    return { success: true };
  }

  // ── Authorization ──────────────────────────────────────────────

  async authorize(
    id: string,
    dto: AuthorizeResourceDto,
    userId: string,
    tenantId: string,
  ) {
    const resource = await this.getResourceOrThrow(id, tenantId);

    const authorizations = [...(resource.authorizations ?? [])];

    // Check for duplicate
    const exists = authorizations.some(
      (a) => a.granteeType === dto.granteeType && a.granteeId === dto.granteeId,
    );
    if (exists) {
      throw new BadRequestException("Authorization already exists");
    }

    const newAuth: ResourceAuthorization = {
      granteeType: dto.granteeType,
      granteeId: dto.granteeId,
      permissions: dto.permissions ?? { level: "full" },
      grantedBy: userId,
      grantedAt: new Date().toISOString(),
    };
    authorizations.push(newAuth);

    const [updated] = await this.db
      .update(schema.resources)
      .set({ authorizations, updatedAt: new Date() })
      .where(eq(schema.resources.id, id))
      .returning();

    return updated;
  }

  async revoke(
    id: string,
    dto: RevokeResourceDto,
    userId: string,
    tenantId: string,
  ) {
    const resource = await this.getResourceOrThrow(id, tenantId);

    const authorizations = (resource.authorizations ?? []).filter(
      (a) =>
        !(a.granteeType === dto.granteeType && a.granteeId === dto.granteeId),
    );

    const [updated] = await this.db
      .update(schema.resources)
      .set({ authorizations, updatedAt: new Date() })
      .where(eq(schema.resources.id, id))
      .returning();

    return updated;
  }

  // ── Usage Logs ─────────────────────────────────────────────────

  async getUsageLogs(id: string, tenantId: string, limit = 50, offset = 0) {
    await this.getResourceOrThrow(id, tenantId);

    return this.db
      .select()
      .from(schema.resourceUsageLogs)
      .where(eq(schema.resourceUsageLogs.resourceId, id))
      .orderBy(desc(schema.resourceUsageLogs.createdAt))
      .limit(limit)
      .offset(offset);
  }

  async createUsageLog(
    id: string,
    data: {
      actorType: "agent" | "user";
      actorId: string;
      action: string;
      taskId?: string;
      executionId?: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    const [log] = await this.db
      .insert(schema.resourceUsageLogs)
      .values({
        id: uuidv7(),
        resourceId: id,
        actorType: data.actorType,
        actorId: data.actorId,
        action: data.action,
        taskId: data.taskId ?? null,
        executionId: data.executionId ?? null,
        metadata: data.metadata ?? null,
      })
      .returning();

    return log;
  }

  // ── Heartbeat ──────────────────────────────────────────────────

  async heartbeat(id: string) {
    const [updated] = await this.db
      .update(schema.resources)
      .set({
        lastHeartbeatAt: new Date(),
        status: "online",
        updatedAt: new Date(),
      })
      .where(eq(schema.resources.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundException("Resource not found");
    }

    return { success: true };
  }

  // ── Internal helpers ──────────────────────────────────────────

  private async getResourceOrThrow(
    id: string,
    tenantId: string,
  ): Promise<schema.Resource> {
    const [resource] = await this.db
      .select()
      .from(schema.resources)
      .where(
        and(
          eq(schema.resources.id, id),
          eq(schema.resources.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!resource) {
      throw new NotFoundException("Resource not found");
    }

    return resource;
  }

  private assertCreatorOwnership(
    resource: schema.Resource,
    userId: string,
  ): void {
    if (resource.creatorId !== userId) {
      throw new ForbiddenException(
        "You do not have permission to perform this action",
      );
    }
  }
}
```

**Step 2: Commit**

```bash
git add apps/server/apps/gateway/src/resources/resources.service.ts
git commit -m "feat(resources): add resources service with CRUD, auth, usage logs"
```

---

## Task 5: Backend — Controller + Module

**Files:**

- Create: `apps/server/apps/gateway/src/resources/resources.controller.ts`
- Create: `apps/server/apps/gateway/src/resources/resources.module.ts`
- Modify: `apps/server/apps/gateway/src/app.module.ts`

**Step 1: Create controller**

Create `apps/server/apps/gateway/src/resources/resources.controller.ts`:

```typescript
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  ParseIntPipe,
  DefaultValuePipe,
} from "@nestjs/common";
import { AuthGuard, CurrentUser } from "@team9/auth";
import type { ResourceType } from "@team9/database/schemas";
import { CurrentTenantId } from "../common/decorators/current-tenant.decorator.js";
import { ResourcesService } from "./resources.service.js";
import {
  CreateResourceDto,
  UpdateResourceDto,
  AuthorizeResourceDto,
  RevokeResourceDto,
} from "./dto/index.js";

@Controller({
  path: "resources",
  version: "1",
})
@UseGuards(AuthGuard)
export class ResourcesController {
  constructor(private readonly resourcesService: ResourcesService) {}

  @Post()
  async create(
    @Body() dto: CreateResourceDto,
    @CurrentUser("sub") userId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.resourcesService.create(dto, userId, tenantId);
  }

  @Get()
  async list(
    @CurrentTenantId() tenantId: string,
    @Query("type") type?: ResourceType,
  ) {
    return this.resourcesService.list(tenantId, { type });
  }

  @Get(":id")
  async getById(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.resourcesService.getById(id, tenantId);
  }

  @Patch(":id")
  async update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateResourceDto,
    @CurrentUser("sub") userId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.resourcesService.update(id, dto, userId, tenantId);
  }

  @Delete(":id")
  async delete(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser("sub") userId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.resourcesService.delete(id, userId, tenantId);
  }

  // ── Authorization ──────────────────────────────────────────────

  @Post(":id/authorize")
  async authorize(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: AuthorizeResourceDto,
    @CurrentUser("sub") userId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.resourcesService.authorize(id, dto, userId, tenantId);
  }

  @Delete(":id/authorize")
  async revoke(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: RevokeResourceDto,
    @CurrentUser("sub") userId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.resourcesService.revoke(id, dto, userId, tenantId);
  }

  // ── Usage Logs ─────────────────────────────────────────────────

  @Get(":id/usage-logs")
  async getUsageLogs(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
    @Query("limit", new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query("offset", new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ) {
    return this.resourcesService.getUsageLogs(id, tenantId, limit, offset);
  }

  // ── Heartbeat ──────────────────────────────────────────────────

  @Post(":id/heartbeat")
  async heartbeat(@Param("id", ParseUUIDPipe) id: string) {
    return this.resourcesService.heartbeat(id);
  }
}
```

**Step 2: Create module**

Create `apps/server/apps/gateway/src/resources/resources.module.ts`:

```typescript
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { ResourcesController } from "./resources.controller.js";
import { ResourcesService } from "./resources.service.js";

@Module({
  imports: [AuthModule],
  controllers: [ResourcesController],
  providers: [ResourcesService],
  exports: [ResourcesService],
})
export class ResourcesModule {}
```

**Step 3: Register module in app.module.ts**

In `apps/server/apps/gateway/src/app.module.ts`, add import and register:

```typescript
import { ResourcesModule } from "./resources/resources.module.js";
```

Add `ResourcesModule` to the `imports` array after `TasksModule`.

**Step 4: Verify backend compiles**

Run: `pnpm build:server`
Expected: Build succeeds with no errors.

**Step 5: Commit**

```bash
git add apps/server/apps/gateway/src/resources/ apps/server/apps/gateway/src/app.module.ts
git commit -m "feat(resources): add resources controller, module, register in app"
```

---

## Task 6: Frontend — Types + API Service

**Files:**

- Create: `apps/client/src/types/resource.ts`
- Create: `apps/client/src/services/api/resources.ts`

**Step 1: Create types**

Create `apps/client/src/types/resource.ts`:

```typescript
// ── Enums ────────────────────────────────────────────────────────

export type ResourceType = "agent_computer" | "api";

export type ResourceStatus = "online" | "offline" | "error" | "configuring";

// ── Config ───────────────────────────────────────────────────────

export interface AgentComputerConfig {
  connectionType: "ahand" | "ssh" | "cloud";
  host?: string;
  port?: number;
  os?: string;
  arch?: string;
}

export interface ApiResourceConfig {
  provider: string;
  baseUrl?: string;
  apiKey: string;
  model?: string;
}

export type ResourceConfig = AgentComputerConfig | ApiResourceConfig;

// ── Authorization ────────────────────────────────────────────────

export interface ResourceAuthorization {
  granteeType: "user" | "task";
  granteeId: string;
  permissions: { level: "full" | "readonly" };
  grantedBy: string;
  grantedAt: string;
}

// ── Entity ───────────────────────────────────────────────────────

export interface Resource {
  id: string;
  tenantId: string;
  type: ResourceType;
  name: string;
  description: string | null;
  config: ResourceConfig;
  status: ResourceStatus;
  authorizations: ResourceAuthorization[];
  lastHeartbeatAt: string | null;
  creatorId: string;
  createdAt: string;
  updatedAt: string;
}

// ── Usage Log ────────────────────────────────────────────────────

export interface ResourceUsageLog {
  id: string;
  resourceId: string;
  actorType: "agent" | "user";
  actorId: string;
  taskId: string | null;
  executionId: string | null;
  action: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

// ── DTOs ─────────────────────────────────────────────────────────

export interface CreateResourceDto {
  type: ResourceType;
  name: string;
  description?: string;
  config: Record<string, unknown>;
}

export interface UpdateResourceDto {
  name?: string;
  description?: string;
  config?: Record<string, unknown>;
  status?: ResourceStatus;
}

export interface AuthorizeResourceDto {
  granteeType: "user" | "task";
  granteeId: string;
  permissions?: { level: "full" | "readonly" };
}
```

**Step 2: Create API service**

Create `apps/client/src/services/api/resources.ts`:

```typescript
import http from "../http";
import type {
  Resource,
  ResourceUsageLog,
  CreateResourceDto,
  UpdateResourceDto,
  AuthorizeResourceDto,
  ResourceType,
} from "@/types/resource";

export const resourcesApi = {
  create: async (dto: CreateResourceDto): Promise<Resource> => {
    const response = await http.post<Resource>("/v1/resources", dto);
    return response.data;
  },

  list: async (params?: { type?: ResourceType }): Promise<Resource[]> => {
    const response = await http.get<Resource[]>("/v1/resources", { params });
    return response.data;
  },

  getById: async (id: string): Promise<Resource> => {
    const response = await http.get<Resource>(`/v1/resources/${id}`);
    return response.data;
  },

  update: async (id: string, dto: UpdateResourceDto): Promise<Resource> => {
    const response = await http.patch<Resource>(`/v1/resources/${id}`, dto);
    return response.data;
  },

  delete: async (id: string): Promise<void> => {
    await http.delete(`/v1/resources/${id}`);
  },

  authorize: async (
    id: string,
    dto: AuthorizeResourceDto,
  ): Promise<Resource> => {
    const response = await http.post<Resource>(
      `/v1/resources/${id}/authorize`,
      dto,
    );
    return response.data;
  },

  revoke: async (
    id: string,
    dto: { granteeType: string; granteeId: string },
  ): Promise<Resource> => {
    const response = await http.delete<Resource>(
      `/v1/resources/${id}/authorize`,
      { data: dto },
    );
    return response.data;
  },

  getUsageLogs: async (
    id: string,
    params?: { limit?: number; offset?: number },
  ): Promise<ResourceUsageLog[]> => {
    const response = await http.get<ResourceUsageLog[]>(
      `/v1/resources/${id}/usage-logs`,
      { params },
    );
    return response.data;
  },

  heartbeat: async (id: string): Promise<void> => {
    await http.post(`/v1/resources/${id}/heartbeat`);
  },
};
```

**Step 3: Commit**

```bash
git add apps/client/src/types/resource.ts apps/client/src/services/api/resources.ts
git commit -m "feat(resources): add frontend types and API service"
```

---

## Task 7: Frontend — Sidebar + Route + i18n

**Files:**

- Modify: `apps/client/src/components/layout/MainSidebar.tsx`
- Modify: `apps/client/src/stores/useAppStore.ts`
- Create: `apps/client/src/routes/_authenticated/resources/index.tsx`
- Modify: `apps/client/src/i18n/index.ts`
- Modify: `apps/client/src/i18n/locales/en/navigation.json`
- Modify: `apps/client/src/i18n/locales/zh/navigation.json`
- Create: `apps/client/src/i18n/locales/en/resources.json`
- Create: `apps/client/src/i18n/locales/zh/resources.json`

**Step 1: Add sidebar navigation item**

In `apps/client/src/components/layout/MainSidebar.tsx`:

Add `Box` to the lucide-react import, then insert new item between tasks and library in `navigationItems`:

```typescript
{ id: "resources", labelKey: "resources" as const, icon: Box },
```

**Step 2: Update useAppStore.ts**

In `apps/client/src/stores/useAppStore.ts`:

Add `"resources"` to `SidebarSection` type (after `"tasks"`).

Add `"resources"` to `ALL_SIDEBAR_SECTIONS` array (after `"tasks"`).

Add to `DEFAULT_SECTION_PATHS`:

```typescript
resources: "/resources",
```

Add to `getSectionFromPath()`:

```typescript
if (pathname.startsWith("/resources")) return "resources";
```

**Step 3: Create i18n locale files**

Create `apps/client/src/i18n/locales/en/resources.json`:

```json
{
  "title": "Resources",
  "tabs": {
    "all": "All",
    "agent_computer": "Agent Computer",
    "api": "API"
  },
  "noResources": "No resources yet",
  "status": {
    "online": "Online",
    "offline": "Offline",
    "error": "Error",
    "configuring": "Configuring"
  },
  "type": {
    "agent_computer": "Agent Computer",
    "api": "API"
  },
  "connectionType": {
    "ahand": "Ahand",
    "ssh": "SSH",
    "cloud": "Cloud"
  },
  "create": {
    "title": "Add Resource",
    "selectType": "Resource Type",
    "name": "Name",
    "namePlaceholder": "Enter resource name",
    "description": "Description",
    "descriptionPlaceholder": "Optional description",
    "connectionType": "Connection Type",
    "host": "Host",
    "hostPlaceholder": "e.g. 192.168.1.100",
    "port": "Port",
    "provider": "Provider",
    "providerPlaceholder": "e.g. openai, google, custom",
    "apiKey": "API Key",
    "apiKeyPlaceholder": "Enter API key",
    "baseUrl": "Base URL",
    "baseUrlPlaceholder": "Optional custom base URL",
    "model": "Model",
    "modelPlaceholder": "e.g. gpt-4, claude-3",
    "submit": "Create",
    "cancel": "Cancel"
  },
  "detail": {
    "title": "Resource Details",
    "loadError": "Failed to load resource",
    "basicInfo": "Basic Info",
    "authorizations": "Authorizations",
    "noAuthorizations": "No authorizations yet",
    "addAuthorization": "Add",
    "usageLogs": "Usage Logs",
    "noUsageLogs": "No usage logs yet",
    "delete": "Delete",
    "deleteConfirm": "Are you sure you want to delete this resource?",
    "lastHeartbeat": "Last heartbeat: {{time}}",
    "authCount": "{{count}} authorized",
    "maskedKey": "{{prefix}}...{{suffix}}",
    "granteeType": {
      "user": "User",
      "task": "Task"
    },
    "permissionLevel": {
      "full": "Full Access",
      "readonly": "Read Only"
    }
  },
  "actions": {
    "connect": "Connect",
    "disconnect": "Disconnect",
    "api_call": "API Call",
    "error": "Error"
  }
}
```

Create `apps/client/src/i18n/locales/zh/resources.json`:

```json
{
  "title": "资源",
  "tabs": {
    "all": "全部",
    "agent_computer": "Agent 计算机",
    "api": "API"
  },
  "noResources": "暂无资源",
  "status": {
    "online": "在线",
    "offline": "离线",
    "error": "错误",
    "configuring": "配置中"
  },
  "type": {
    "agent_computer": "Agent 计算机",
    "api": "API"
  },
  "connectionType": {
    "ahand": "Ahand",
    "ssh": "SSH",
    "cloud": "Cloud"
  },
  "create": {
    "title": "添加资源",
    "selectType": "资源类型",
    "name": "名称",
    "namePlaceholder": "输入资源名称",
    "description": "描述",
    "descriptionPlaceholder": "可选描述",
    "connectionType": "连接方式",
    "host": "主机",
    "hostPlaceholder": "例如 192.168.1.100",
    "port": "端口",
    "provider": "服务商",
    "providerPlaceholder": "例如 openai, google, custom",
    "apiKey": "API Key",
    "apiKeyPlaceholder": "输入 API Key",
    "baseUrl": "Base URL",
    "baseUrlPlaceholder": "可选自定义 Base URL",
    "model": "模型",
    "modelPlaceholder": "例如 gpt-4, claude-3",
    "submit": "创建",
    "cancel": "取消"
  },
  "detail": {
    "title": "资源详情",
    "loadError": "加载资源失败",
    "basicInfo": "基本信息",
    "authorizations": "授权",
    "noAuthorizations": "暂无授权",
    "addAuthorization": "添加",
    "usageLogs": "使用记录",
    "noUsageLogs": "暂无使用记录",
    "delete": "删除",
    "deleteConfirm": "确定要删除这个资源吗？",
    "lastHeartbeat": "最后心跳: {{time}}",
    "authCount": "{{count}} 个授权",
    "maskedKey": "{{prefix}}...{{suffix}}",
    "granteeType": {
      "user": "用户",
      "task": "任务"
    },
    "permissionLevel": {
      "full": "完全访问",
      "readonly": "只读"
    }
  },
  "actions": {
    "connect": "连接",
    "disconnect": "断开",
    "api_call": "API 调用",
    "error": "错误"
  }
}
```

**Step 4: Update navigation i18n**

In `apps/client/src/i18n/locales/en/navigation.json`, add:

```json
"resources": "Resources"
```

In `apps/client/src/i18n/locales/zh/navigation.json`, add:

```json
"resources": "资源"
```

**Step 5: Register i18n namespace**

In `apps/client/src/i18n/index.ts`:

Add imports:

```typescript
import zhResources from "./locales/zh/resources.json";
import enResources from "./locales/en/resources.json";
```

Add to `resources` object in both `zh` and `en`:

```typescript
resources: zhResources,  // in zh
resources: enResources,  // in en
```

Add `"resources"` to the `ns` array.

**Step 6: Create route**

Create `apps/client/src/routes/_authenticated/resources/index.tsx`:

```typescript
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ResourceList } from "@/components/resources/ResourceList";
import { CreateResourceDialog } from "@/components/resources/CreateResourceDialog";

export const Route = createFileRoute("/_authenticated/resources/")({
  component: ResourcesPage,
});

function ResourcesPage() {
  const [showCreate, setShowCreate] = useState(false);
  const { t } = useTranslation("resources");

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-border shrink-0 flex items-center justify-between">
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        <Button size="sm" variant="ghost" onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4" />
        </Button>
      </div>
      <div className="flex-1 min-h-0">
        <ResourceList />
      </div>
      <CreateResourceDialog
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
      />
    </div>
  );
}
```

**Step 7: Verify route generates**

Run: `pnpm dev:client` — TanStack Router should auto-generate the route tree.

**Step 8: Commit**

```bash
git add apps/client/src/components/layout/MainSidebar.tsx \
  apps/client/src/stores/useAppStore.ts \
  apps/client/src/routes/_authenticated/resources/ \
  apps/client/src/i18n/ \
  apps/client/src/i18n/locales/
git commit -m "feat(resources): add sidebar nav, route, i18n for resources module"
```

---

## Task 8: Frontend — ResourceCard + ResourceList

**Files:**

- Create: `apps/client/src/components/resources/ResourceCard.tsx`
- Create: `apps/client/src/components/resources/ResourceList.tsx`

**Step 1: Create ResourceCard**

Create `apps/client/src/components/resources/ResourceCard.tsx`:

```typescript
import { useTranslation } from "react-i18next";
import { Monitor, Key, Wifi, WifiOff, AlertCircle, Settings } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Resource, ApiResourceConfig } from "@/types/resource";

interface ResourceCardProps {
  resource: Resource;
  onClick: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  online: "bg-green-500",
  offline: "bg-gray-400",
  error: "bg-red-500",
  configuring: "bg-yellow-500",
};

const STATUS_ICONS = {
  online: Wifi,
  offline: WifiOff,
  error: AlertCircle,
  configuring: Settings,
};

function maskApiKey(key: string): string {
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

export function ResourceCard({ resource, onClick }: ResourceCardProps) {
  const { t } = useTranslation("resources");
  const StatusIcon = STATUS_ICONS[resource.status] ?? WifiOff;
  const authCount = resource.authorizations?.length ?? 0;

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left rounded-lg border border-border bg-card p-4 space-y-2",
        "hover:border-primary/30 hover:bg-accent/50 transition-colors cursor-pointer",
      )}
    >
      <div className="flex items-center gap-2">
        <div
          className={cn(
            "w-2 h-2 rounded-full shrink-0",
            STATUS_COLORS[resource.status],
          )}
        />
        {resource.type === "agent_computer" ? (
          <Monitor size={16} className="text-muted-foreground shrink-0" />
        ) : (
          <Key size={16} className="text-muted-foreground shrink-0" />
        )}
        <span className="text-sm font-medium truncate flex-1">
          {resource.name}
        </span>
        <Badge variant="outline" className="text-xs shrink-0">
          {t(`type.${resource.type}`)}
        </Badge>
      </div>

      {resource.type === "agent_computer" && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <StatusIcon size={12} />
          <span>{t(`status.${resource.status}`)}</span>
          {"connectionType" in resource.config && (
            <>
              <span>·</span>
              <span>
                {t(
                  `connectionType.${(resource.config as { connectionType: string }).connectionType}`,
                )}
              </span>
            </>
          )}
        </div>
      )}

      {resource.type === "api" && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{(resource.config as ApiResourceConfig).provider}</span>
          <span>·</span>
          <code className="text-xs">
            {maskApiKey((resource.config as ApiResourceConfig).apiKey)}
          </code>
        </div>
      )}

      {authCount > 0 && (
        <div className="text-xs text-muted-foreground">
          {t("detail.authCount", { count: authCount })}
        </div>
      )}
    </button>
  );
}
```

**Step 2: Create ResourceList**

Create `apps/client/src/components/resources/ResourceList.tsx`:

```typescript
import { useMemo, useState } from "react";
import { Loader2, Box } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { resourcesApi } from "@/services/api/resources";
import { cn } from "@/lib/utils";
import { ResourceCard } from "./ResourceCard";
import { ResourceDetailPanel } from "./ResourceDetailPanel";
import type { ResourceType } from "@/types/resource";

const TAB_KEYS = ["all", "agent_computer", "api"] as const;
type TabKey = (typeof TAB_KEYS)[number];

export function ResourceList() {
  const [tab, setTab] = useState<TabKey>("all");
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(
    null,
  );
  const { t } = useTranslation("resources");

  const { data: allResources = [], isLoading } = useQuery({
    queryKey: ["resources"],
    queryFn: () => resourcesApi.list(),
  });

  const resources = useMemo(
    () =>
      tab === "all"
        ? allResources
        : allResources.filter((r) => r.type === tab),
    [allResources, tab],
  );

  return (
    <div className="flex h-full">
      <div className="flex flex-col flex-1 min-w-0 h-full">
        {/* Filter tabs */}
        <div
          className="flex gap-1 px-3 py-2 border-b border-border"
          role="tablist"
        >
          {TAB_KEYS.map((key) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cn(
                "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                tab === key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent",
              )}
            >
              {t(`tabs.${key}`)}
            </button>
          ))}
        </div>

        {/* Resource grid */}
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && resources.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 gap-2">
            <Box size={24} className="text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              {t("noResources")}
            </p>
          </div>
        )}

        {!isLoading && resources.length > 0 && (
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {resources.map((resource) => (
              <ResourceCard
                key={resource.id}
                resource={resource}
                onClick={() => setSelectedResourceId(resource.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Detail panel */}
      {selectedResourceId && (
        <ResourceDetailPanel
          resourceId={selectedResourceId}
          onClose={() => setSelectedResourceId(null)}
        />
      )}
    </div>
  );
}
```

**Step 3: Commit**

```bash
git add apps/client/src/components/resources/ResourceCard.tsx \
  apps/client/src/components/resources/ResourceList.tsx
git commit -m "feat(resources): add ResourceCard and ResourceList components"
```

---

## Task 9: Frontend — ResourceDetailPanel

**Files:**

- Create: `apps/client/src/components/resources/ResourceDetailPanel.tsx`

**Step 1: Create detail panel**

Create `apps/client/src/components/resources/ResourceDetailPanel.tsx`:

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  X,
  Loader2,
  Trash2,
  Monitor,
  Key,
  Wifi,
  WifiOff,
  AlertCircle,
  Settings,
  Clock,
  User,
  ListChecks,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { resourcesApi } from "@/services/api/resources";
import type {
  Resource,
  ApiResourceConfig,
  AgentComputerConfig,
  ResourceUsageLog,
} from "@/types/resource";

interface ResourceDetailPanelProps {
  resourceId: string;
  onClose: () => void;
}

function maskApiKey(key: string): string {
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

const STATUS_BADGE_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  online: "default",
  offline: "secondary",
  error: "destructive",
  configuring: "outline",
};

export function ResourceDetailPanel({
  resourceId,
  onClose,
}: ResourceDetailPanelProps) {
  const { t } = useTranslation("resources");
  const queryClient = useQueryClient();

  const {
    data: resource,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["resource", resourceId],
    queryFn: () => resourcesApi.getById(resourceId),
  });

  const { data: usageLogs = [] } = useQuery({
    queryKey: ["resource-usage-logs", resourceId],
    queryFn: () => resourcesApi.getUsageLogs(resourceId, { limit: 20 }),
    enabled: !!resource,
  });

  const deleteMutation = useMutation({
    mutationFn: () => resourcesApi.delete(resourceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["resources"] });
      onClose();
    },
  });

  return (
    <div className="border-l bg-background flex flex-col h-full w-[400px]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <h3 className="text-sm font-semibold truncate">
          {t("detail.title")}
        </h3>
        <Button variant="ghost" size="icon-sm" onClick={onClose}>
          <X size={16} />
        </Button>
      </div>

      {/* Content */}
      {isLoading && (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {isError && (
        <div className="flex-1 flex items-center justify-center px-4">
          <p className="text-sm text-muted-foreground">
            {t("detail.loadError")}
          </p>
        </div>
      )}

      {resource && !isLoading && (
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-5">
            {/* Basic info */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge
                  variant={STATUS_BADGE_VARIANT[resource.status]}
                  className="text-xs"
                >
                  {t(`status.${resource.status}`)}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {t(`type.${resource.type}`)}
                </Badge>
              </div>
              <h2 className="text-base font-semibold leading-tight">
                {resource.name}
              </h2>
              {resource.description && (
                <p className="text-sm text-muted-foreground">
                  {resource.description}
                </p>
              )}

              {/* Type-specific config display */}
              {resource.type === "agent_computer" && (
                <div className="text-xs text-muted-foreground space-y-1">
                  <div className="flex items-center gap-2">
                    <Monitor size={12} />
                    <span>
                      {t(
                        `connectionType.${(resource.config as AgentComputerConfig).connectionType}`,
                      )}
                    </span>
                  </div>
                  {(resource.config as AgentComputerConfig).host && (
                    <div>
                      Host: {(resource.config as AgentComputerConfig).host}
                      {(resource.config as AgentComputerConfig).port &&
                        `:${(resource.config as AgentComputerConfig).port}`}
                    </div>
                  )}
                  {(resource.config as AgentComputerConfig).os && (
                    <div>
                      OS: {(resource.config as AgentComputerConfig).os}
                      {(resource.config as AgentComputerConfig).arch &&
                        ` (${(resource.config as AgentComputerConfig).arch})`}
                    </div>
                  )}
                  {resource.lastHeartbeatAt && (
                    <div className="flex items-center gap-1">
                      <Clock size={12} />
                      {t("detail.lastHeartbeat", {
                        time: new Date(
                          resource.lastHeartbeatAt,
                        ).toLocaleString(),
                      })}
                    </div>
                  )}
                </div>
              )}

              {resource.type === "api" && (
                <div className="text-xs text-muted-foreground space-y-1">
                  <div className="flex items-center gap-2">
                    <Key size={12} />
                    <span>
                      {(resource.config as ApiResourceConfig).provider}
                    </span>
                  </div>
                  <div>
                    API Key:{" "}
                    <code>
                      {maskApiKey(
                        (resource.config as ApiResourceConfig).apiKey,
                      )}
                    </code>
                  </div>
                  {(resource.config as ApiResourceConfig).baseUrl && (
                    <div>
                      Base URL:{" "}
                      {(resource.config as ApiResourceConfig).baseUrl}
                    </div>
                  )}
                  {(resource.config as ApiResourceConfig).model && (
                    <div>
                      Model: {(resource.config as ApiResourceConfig).model}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Delete button */}
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (window.confirm(t("detail.deleteConfirm"))) {
                  deleteMutation.mutate();
                }
              }}
            >
              <Trash2 size={14} />
              {t("detail.delete")}
            </Button>

            <Separator />

            {/* Authorizations */}
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">
                {t("detail.authorizations")}
              </h4>
              {(!resource.authorizations ||
                resource.authorizations.length === 0) && (
                <p className="text-xs text-muted-foreground">
                  {t("detail.noAuthorizations")}
                </p>
              )}
              {resource.authorizations?.map((auth, i) => (
                <div
                  key={`${auth.granteeType}-${auth.granteeId}`}
                  className="flex items-center gap-2 text-xs p-2 rounded border border-border"
                >
                  {auth.granteeType === "user" ? (
                    <User size={12} className="text-muted-foreground" />
                  ) : (
                    <ListChecks size={12} className="text-muted-foreground" />
                  )}
                  <span className="flex-1 truncate">
                    {t(`detail.granteeType.${auth.granteeType}`)}:{" "}
                    {auth.granteeId.slice(0, 8)}...
                  </span>
                  <Badge variant="outline" className="text-xs">
                    {t(`detail.permissionLevel.${auth.permissions.level}`)}
                  </Badge>
                </div>
              ))}
            </div>

            <Separator />

            {/* Usage logs */}
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">
                {t("detail.usageLogs")}
              </h4>
              {usageLogs.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  {t("detail.noUsageLogs")}
                </p>
              )}
              {usageLogs.map((log: ResourceUsageLog) => (
                <div
                  key={log.id}
                  className="text-xs p-2 rounded border border-border space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="text-xs">
                      {t(`actions.${log.action}`, {
                        defaultValue: log.action,
                      })}
                    </Badge>
                    <span className="text-muted-foreground">
                      {new Date(log.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-muted-foreground">
                    {log.actorType}: {log.actorId.slice(0, 8)}...
                  </div>
                </div>
              ))}
            </div>
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add apps/client/src/components/resources/ResourceDetailPanel.tsx
git commit -m "feat(resources): add ResourceDetailPanel component"
```

---

## Task 10: Frontend — CreateResourceDialog

**Files:**

- Create: `apps/client/src/components/resources/CreateResourceDialog.tsx`

**Step 1: Create dialog component**

Create `apps/client/src/components/resources/CreateResourceDialog.tsx`:

```typescript
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { resourcesApi } from "@/services/api/resources";
import type { ResourceType } from "@/types/resource";

interface CreateResourceDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CreateResourceDialog({
  isOpen,
  onClose,
}: CreateResourceDialogProps) {
  const { t } = useTranslation("resources");
  const queryClient = useQueryClient();

  const [type, setType] = useState<ResourceType>("agent_computer");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  // Agent Computer fields
  const [connectionType, setConnectionType] = useState<
    "ahand" | "ssh" | "cloud"
  >("ahand");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");

  // API fields
  const [provider, setProvider] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");

  const createMutation = useMutation({
    mutationFn: resourcesApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["resources"] });
      resetForm();
      onClose();
    },
  });

  function resetForm() {
    setType("agent_computer");
    setName("");
    setDescription("");
    setConnectionType("ahand");
    setHost("");
    setPort("");
    setProvider("");
    setApiKey("");
    setBaseUrl("");
    setModel("");
  }

  function handleSubmit() {
    if (!name.trim()) return;

    const config =
      type === "agent_computer"
        ? {
            connectionType,
            ...(host && { host }),
            ...(port && { port: parseInt(port, 10) }),
          }
        : {
            provider: provider || "custom",
            apiKey,
            ...(baseUrl && { baseUrl }),
            ...(model && { model }),
          };

    createMutation.mutate({ type, name: name.trim(), description: description.trim() || undefined, config });
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          resetForm();
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("create.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Type selector */}
          <div className="space-y-1.5">
            <Label>{t("create.selectType")}</Label>
            <Select
              value={type}
              onValueChange={(v) => setType(v as ResourceType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="agent_computer">
                  {t("type.agent_computer")}
                </SelectItem>
                <SelectItem value="api">{t("type.api")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Name */}
          <div className="space-y-1.5">
            <Label>{t("create.name")}</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("create.namePlaceholder")}
              maxLength={255}
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label>{t("create.description")}</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("create.descriptionPlaceholder")}
              rows={2}
            />
          </div>

          {/* Agent Computer config */}
          {type === "agent_computer" && (
            <>
              <div className="space-y-1.5">
                <Label>{t("create.connectionType")}</Label>
                <Select
                  value={connectionType}
                  onValueChange={(v) =>
                    setConnectionType(v as "ahand" | "ssh" | "cloud")
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ahand">Ahand</SelectItem>
                    <SelectItem value="ssh">SSH</SelectItem>
                    <SelectItem value="cloud">Cloud</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2 space-y-1.5">
                  <Label>{t("create.host")}</Label>
                  <Input
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    placeholder={t("create.hostPlaceholder")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("create.port")}</Label>
                  <Input
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                    placeholder="22"
                    type="number"
                  />
                </div>
              </div>
            </>
          )}

          {/* API config */}
          {type === "api" && (
            <>
              <div className="space-y-1.5">
                <Label>{t("create.provider")}</Label>
                <Input
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  placeholder={t("create.providerPlaceholder")}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("create.apiKey")}</Label>
                <Input
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={t("create.apiKeyPlaceholder")}
                  type="password"
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("create.baseUrl")}</Label>
                <Input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder={t("create.baseUrlPlaceholder")}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("create.model")}</Label>
                <Input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={t("create.modelPlaceholder")}
                />
              </div>
            </>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                resetForm();
                onClose();
              }}
            >
              {t("create.cancel")}
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={
                !name.trim() ||
                (type === "api" && !apiKey.trim()) ||
                createMutation.isPending
              }
            >
              {t("create.submit")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 2: Commit**

```bash
git add apps/client/src/components/resources/CreateResourceDialog.tsx
git commit -m "feat(resources): add CreateResourceDialog component"
```

---

## Task 11: Schema push + end-to-end verification

**Step 1: Push database schema**

Run: `pnpm db:generate`
Run: `pnpm db:push`

**Step 2: Build backend**

Run: `pnpm build:server`
Expected: Compiles without errors.

**Step 3: Start dev and verify**

Run: `pnpm dev`

- Navigate to `/resources` in the browser
- Verify sidebar shows "Resources" between Tasks and Library
- Verify empty state shows
- Click "+" to open create dialog
- Create an Agent Computer resource
- Create an API resource
- Verify both appear in the list
- Click a card, verify detail panel opens
- Filter by tabs (All / Agent Computer / API)

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(resources): complete resources module with DB, API, and UI"
```
