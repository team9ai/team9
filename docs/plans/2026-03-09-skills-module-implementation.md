# Skills Module Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Skills module (sidebar entry between Tasks and Library) with full CRUD, version snapshots, AI suggestion review, file tree browsing, and preset templates — demo phase.

**Architecture:** Three-table database model (skills, skill_versions, skill_files) with NestJS backend module and React frontend. Backend follows existing resource/task module patterns. Frontend uses card grid list page + full-screen detail page with file tree and editor.

**Tech Stack:** Drizzle ORM + PostgreSQL (backend), NestJS 11 (backend), React 19 + TanStack Router + TanStack React Query + Zustand + Tailwind CSS 4 + Radix UI (frontend)

**Design doc:** `docs/plans/2026-03-09-skills-module-design.md`

---

## Task 1: Database Schemas

**Files:**

- Create: `apps/server/libs/database/src/schemas/skill/skills.ts`
- Create: `apps/server/libs/database/src/schemas/skill/skill-versions.ts`
- Create: `apps/server/libs/database/src/schemas/skill/skill-files.ts`
- Create: `apps/server/libs/database/src/schemas/skill/relations.ts`
- Create: `apps/server/libs/database/src/schemas/skill/index.ts`
- Modify: `apps/server/libs/database/src/schemas/index.ts`

**Step 1: Create skills table schema**

Create `apps/server/libs/database/src/schemas/skill/skills.ts`:

```typescript
import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { tenants } from "../tenant/tenants.js";
import { users } from "../im/users.js";

// ── Enums ────────────────────────────────────────────────────────────

export const skillTypeEnum = pgEnum("skill__type", [
  "claude_code_skill",
  "prompt_template",
  "general",
]);

// ── Table ────────────────────────────────────────────────────────────

export const skills = pgTable(
  "skills",
  {
    id: uuid("id").primaryKey().notNull(),

    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),

    name: varchar("name", { length: 255 }).notNull(),

    description: text("description"),

    type: skillTypeEnum("type").notNull(),

    icon: varchar("icon", { length: 64 }),

    currentVersion: integer("current_version").default(0).notNull(),

    creatorId: uuid("creator_id")
      .references(() => users.id)
      .notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("idx_skills_tenant_id").on(table.tenantId)],
);

export type Skill = typeof skills.$inferSelect;
export type NewSkill = typeof skills.$inferInsert;
export type SkillType = (typeof skillTypeEnum.enumValues)[number];
```

**Step 2: Create skill_versions table schema**

Create `apps/server/libs/database/src/schemas/skill/skill-versions.ts`:

```typescript
import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  integer,
  timestamp,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { skills } from "./skills.js";
import { users } from "../im/users.js";

// ── Enums ────────────────────────────────────────────────────────────

export const skillVersionStatusEnum = pgEnum("skill_version__status", [
  "draft",
  "published",
  "suggested",
  "rejected",
]);

// ── Types ────────────────────────────────────────────────────────────

export interface SkillFileManifestEntry {
  path: string;
  fileId: string;
}

// ── Table ────────────────────────────────────────────────────────────

export const skillVersions = pgTable(
  "skill_versions",
  {
    id: uuid("id").primaryKey().notNull(),

    skillId: uuid("skill_id")
      .references(() => skills.id, { onDelete: "cascade" })
      .notNull(),

    version: integer("version").notNull(),

    message: varchar("message", { length: 255 }),

    status: skillVersionStatusEnum("status").default("published").notNull(),

    fileManifest: jsonb("file_manifest")
      .$type<SkillFileManifestEntry[]>()
      .default([])
      .notNull(),

    suggestedBy: varchar("suggested_by", { length: 64 }),

    creatorId: uuid("creator_id")
      .references(() => users.id)
      .notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("idx_skill_versions_skill_version").on(
      table.skillId,
      table.version,
    ),
  ],
);

export type SkillVersion = typeof skillVersions.$inferSelect;
export type NewSkillVersion = typeof skillVersions.$inferInsert;
export type SkillVersionStatus =
  (typeof skillVersionStatusEnum.enumValues)[number];
```

**Step 3: Create skill_files table schema**

Create `apps/server/libs/database/src/schemas/skill/skill-files.ts`:

```typescript
import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { skills } from "./skills.js";

// ── Table ────────────────────────────────────────────────────────────

export const skillFiles = pgTable(
  "skill_files",
  {
    id: uuid("id").primaryKey().notNull(),

    skillId: uuid("skill_id")
      .references(() => skills.id, { onDelete: "cascade" })
      .notNull(),

    path: varchar("path", { length: 1024 }).notNull(),

    content: text("content").notNull(),

    size: integer("size").default(0).notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("idx_skill_files_skill_id").on(table.skillId)],
);

export type SkillFile = typeof skillFiles.$inferSelect;
export type NewSkillFile = typeof skillFiles.$inferInsert;
```

**Step 4: Create relations**

Create `apps/server/libs/database/src/schemas/skill/relations.ts`:

```typescript
import { relations } from "drizzle-orm";
import { skills } from "./skills.js";
import { skillVersions } from "./skill-versions.js";
import { skillFiles } from "./skill-files.js";
import { tenants } from "../tenant/tenants.js";
import { users } from "../im/users.js";

export const skillsRelations = relations(skills, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [skills.tenantId],
    references: [tenants.id],
  }),
  creator: one(users, {
    fields: [skills.creatorId],
    references: [users.id],
  }),
  versions: many(skillVersions),
  files: many(skillFiles),
}));

export const skillVersionsRelations = relations(skillVersions, ({ one }) => ({
  skill: one(skills, {
    fields: [skillVersions.skillId],
    references: [skills.id],
  }),
  creator: one(users, {
    fields: [skillVersions.creatorId],
    references: [users.id],
  }),
}));

export const skillFilesRelations = relations(skillFiles, ({ one }) => ({
  skill: one(skills, {
    fields: [skillFiles.skillId],
    references: [skills.id],
  }),
}));
```

**Step 5: Create index barrel and register in top-level schemas**

Create `apps/server/libs/database/src/schemas/skill/index.ts`:

```typescript
export * from "./skills.js";
export * from "./skill-versions.js";
export * from "./skill-files.js";
export * from "./relations.js";
```

Add to `apps/server/libs/database/src/schemas/index.ts`:

```typescript
export * from "./skill/index.js";
```

**Step 6: Generate and push migration**

Run: `pnpm db:generate && pnpm db:push`

Expected: Migration generated, 3 new tables created in PostgreSQL.

**Step 7: Commit**

```bash
git add apps/server/libs/database/src/schemas/skill/ apps/server/libs/database/src/schemas/index.ts
git commit -m "feat(skills): add database schemas for skills, skill_versions, skill_files"
```

---

## Task 2: Backend DTOs

**Files:**

- Create: `apps/server/apps/gateway/src/skills/dto/create-skill.dto.ts`
- Create: `apps/server/apps/gateway/src/skills/dto/update-skill.dto.ts`
- Create: `apps/server/apps/gateway/src/skills/dto/create-version.dto.ts`
- Create: `apps/server/apps/gateway/src/skills/dto/review-version.dto.ts`
- Create: `apps/server/apps/gateway/src/skills/dto/index.ts`

**Step 1: Create DTOs**

`create-skill.dto.ts`:

```typescript
import {
  IsString,
  MaxLength,
  IsOptional,
  IsIn,
  IsArray,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import type { SkillType } from "@app/database";

export class SkillFileDto {
  @IsString()
  @MaxLength(1024)
  path: string;

  @IsString()
  content: string;
}

export class CreateSkillDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsIn(["claude_code_skill", "prompt_template", "general"] as const)
  type: SkillType;

  @IsString()
  @MaxLength(64)
  @IsOptional()
  icon?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SkillFileDto)
  @IsOptional()
  files?: SkillFileDto[];
}
```

`update-skill.dto.ts`:

```typescript
import { IsString, MaxLength, IsOptional } from "class-validator";

export class UpdateSkillDto {
  @IsString()
  @MaxLength(255)
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @MaxLength(64)
  @IsOptional()
  icon?: string;
}
```

`create-version.dto.ts`:

```typescript
import {
  IsString,
  MaxLength,
  IsOptional,
  IsIn,
  IsArray,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { SkillFileDto } from "./create-skill.dto.js";
import type { SkillVersionStatus } from "@app/database";

export class CreateVersionDto {
  @IsString()
  @MaxLength(255)
  @IsOptional()
  message?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SkillFileDto)
  files: SkillFileDto[];

  @IsIn(["published", "suggested"] as const)
  status: Extract<SkillVersionStatus, "published" | "suggested">;

  @IsString()
  @IsOptional()
  suggestedBy?: string;
}
```

`review-version.dto.ts`:

```typescript
import { IsIn } from "class-validator";

export class ReviewVersionDto {
  @IsIn(["approve", "reject"] as const)
  action: "approve" | "reject";
}
```

`index.ts`:

```typescript
export * from "./create-skill.dto.js";
export * from "./update-skill.dto.js";
export * from "./create-version.dto.js";
export * from "./review-version.dto.js";
```

**Step 2: Commit**

```bash
git add apps/server/apps/gateway/src/skills/dto/
git commit -m "feat(skills): add backend DTOs for skills module"
```

---

## Task 3: Backend Service

**Files:**

- Create: `apps/server/apps/gateway/src/skills/skills.service.ts`

**Step 1: Implement service**

```typescript
import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { eq, and, desc } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import * as schema from "@app/database";
import { DATABASE_CONNECTION } from "@app/database";
import type { SkillType, SkillVersionStatus } from "@app/database";
import type {
  CreateSkillDto,
  UpdateSkillDto,
  CreateVersionDto,
} from "./dto/index.js";

@Injectable()
export class SkillsService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  // ── Skill CRUD ──────────────────────────────────────────────────

  async create(dto: CreateSkillDto, userId: string, tenantId: string) {
    const skillId = uuidv7();
    const files = dto.files ?? [];

    // Insert skill
    const [skill] = await this.db
      .insert(schema.skills)
      .values({
        id: skillId,
        tenantId,
        name: dto.name,
        description: dto.description ?? null,
        type: dto.type,
        icon: dto.icon ?? null,
        currentVersion: files.length > 0 ? 1 : 0,
        creatorId: userId,
      })
      .returning();

    // If files provided, create initial version
    if (files.length > 0) {
      await this.createVersionInternal(skillId, {
        message: "Initial version",
        files,
        status: "published",
        version: 1,
        creatorId: userId,
      });
    }

    return skill;
  }

  async list(tenantId: string, type?: SkillType) {
    const conditions = [eq(schema.skills.tenantId, tenantId)];
    if (type) conditions.push(eq(schema.skills.type, type));

    return this.db
      .select()
      .from(schema.skills)
      .where(and(...conditions))
      .orderBy(desc(schema.skills.createdAt));
  }

  async getById(skillId: string, tenantId: string) {
    const skill = await this.getSkillOrThrow(skillId, tenantId);

    // Fetch current version files
    let files: schema.SkillFile[] = [];
    let currentVersionInfo: schema.SkillVersion | null = null;

    if (skill.currentVersion > 0) {
      const [version] = await this.db
        .select()
        .from(schema.skillVersions)
        .where(
          and(
            eq(schema.skillVersions.skillId, skillId),
            eq(schema.skillVersions.version, skill.currentVersion),
          ),
        )
        .limit(1);

      if (version) {
        currentVersionInfo = version;
        const fileIds = version.fileManifest.map((f) => f.fileId);
        if (fileIds.length > 0) {
          files = await this.db
            .select()
            .from(schema.skillFiles)
            .where(
              and(
                eq(schema.skillFiles.skillId, skillId),
                // Filter by ids from manifest
              ),
            );
          // Filter in memory for simplicity (demo phase)
          files = files.filter((f) => fileIds.includes(f.id));
        }
      }
    }

    // Check for pending suggestions
    const suggestions = await this.db
      .select()
      .from(schema.skillVersions)
      .where(
        and(
          eq(schema.skillVersions.skillId, skillId),
          eq(schema.skillVersions.status, "suggested"),
        ),
      );

    return {
      ...skill,
      currentVersionInfo,
      files,
      pendingSuggestions: suggestions,
    };
  }

  async update(skillId: string, dto: UpdateSkillDto, tenantId: string) {
    await this.getSkillOrThrow(skillId, tenantId);

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.icon !== undefined) updateData.icon = dto.icon;

    const [updated] = await this.db
      .update(schema.skills)
      .set(updateData)
      .where(eq(schema.skills.id, skillId))
      .returning();

    return updated;
  }

  async delete(skillId: string, tenantId: string) {
    await this.getSkillOrThrow(skillId, tenantId);
    await this.db.delete(schema.skills).where(eq(schema.skills.id, skillId));
    return { success: true };
  }

  // ── Version Management ──────────────────────────────────────────

  async listVersions(skillId: string, tenantId: string) {
    await this.getSkillOrThrow(skillId, tenantId);

    return this.db
      .select()
      .from(schema.skillVersions)
      .where(eq(schema.skillVersions.skillId, skillId))
      .orderBy(desc(schema.skillVersions.version));
  }

  async getVersion(skillId: string, version: number, tenantId: string) {
    await this.getSkillOrThrow(skillId, tenantId);

    const [versionRow] = await this.db
      .select()
      .from(schema.skillVersions)
      .where(
        and(
          eq(schema.skillVersions.skillId, skillId),
          eq(schema.skillVersions.version, version),
        ),
      )
      .limit(1);

    if (!versionRow) throw new NotFoundException("Version not found");

    // Fetch files referenced in manifest
    const fileIds = versionRow.fileManifest.map((f) => f.fileId);
    let files: schema.SkillFile[] = [];
    if (fileIds.length > 0) {
      const allFiles = await this.db
        .select()
        .from(schema.skillFiles)
        .where(eq(schema.skillFiles.skillId, skillId));
      files = allFiles.filter((f) => fileIds.includes(f.id));
    }

    return { ...versionRow, files };
  }

  async createVersion(
    skillId: string,
    dto: CreateVersionDto,
    userId: string,
    tenantId: string,
  ) {
    const skill = await this.getSkillOrThrow(skillId, tenantId);
    const nextVersion = skill.currentVersion + 1;

    const version = await this.createVersionInternal(skillId, {
      message: dto.message,
      files: dto.files,
      status: dto.status,
      suggestedBy: dto.suggestedBy,
      version: dto.status === "suggested" ? nextVersion : nextVersion,
      creatorId: userId,
    });

    // Only advance currentVersion for published versions
    if (dto.status === "published") {
      await this.db
        .update(schema.skills)
        .set({ currentVersion: nextVersion, updatedAt: new Date() })
        .where(eq(schema.skills.id, skillId));
    }

    return version;
  }

  async reviewVersion(
    skillId: string,
    version: number,
    action: "approve" | "reject",
    tenantId: string,
  ) {
    const skill = await this.getSkillOrThrow(skillId, tenantId);

    const [versionRow] = await this.db
      .select()
      .from(schema.skillVersions)
      .where(
        and(
          eq(schema.skillVersions.skillId, skillId),
          eq(schema.skillVersions.version, version),
        ),
      )
      .limit(1);

    if (!versionRow) throw new NotFoundException("Version not found");
    if (versionRow.status !== "suggested") {
      throw new BadRequestException("Only suggested versions can be reviewed");
    }

    if (action === "approve") {
      await this.db
        .update(schema.skillVersions)
        .set({ status: "published" })
        .where(eq(schema.skillVersions.id, versionRow.id));

      // Advance currentVersion
      await this.db
        .update(schema.skills)
        .set({ currentVersion: version, updatedAt: new Date() })
        .where(eq(schema.skills.id, skillId));
    } else {
      await this.db
        .update(schema.skillVersions)
        .set({ status: "rejected" })
        .where(eq(schema.skillVersions.id, versionRow.id));
    }

    return { success: true };
  }

  // ── Helpers ─────────────────────────────────────────────────────

  private async createVersionInternal(
    skillId: string,
    opts: {
      message?: string;
      files: { path: string; content: string }[];
      status: SkillVersionStatus;
      suggestedBy?: string;
      version: number;
      creatorId: string;
    },
  ) {
    // Write files
    const fileManifest: schema.SkillFileManifestEntry[] = [];
    for (const file of opts.files) {
      const fileId = uuidv7();
      await this.db.insert(schema.skillFiles).values({
        id: fileId,
        skillId,
        path: file.path,
        content: file.content,
        size: Buffer.byteLength(file.content, "utf8"),
      });
      fileManifest.push({ path: file.path, fileId });
    }

    // Write version
    const versionId = uuidv7();
    const [version] = await this.db
      .insert(schema.skillVersions)
      .values({
        id: versionId,
        skillId,
        version: opts.version,
        message: opts.message ?? null,
        status: opts.status,
        fileManifest,
        suggestedBy: opts.suggestedBy ?? null,
        creatorId: opts.creatorId,
      })
      .returning();

    return version;
  }

  private async getSkillOrThrow(id: string, tenantId?: string) {
    const conditions = [eq(schema.skills.id, id)];
    if (tenantId) conditions.push(eq(schema.skills.tenantId, tenantId));

    const [skill] = await this.db
      .select()
      .from(schema.skills)
      .where(and(...conditions))
      .limit(1);

    if (!skill) throw new NotFoundException("Skill not found");
    return skill;
  }
}
```

**Step 2: Commit**

```bash
git add apps/server/apps/gateway/src/skills/skills.service.ts
git commit -m "feat(skills): add backend service with CRUD and version management"
```

---

## Task 4: Backend Controller

**Files:**

- Create: `apps/server/apps/gateway/src/skills/skills.controller.ts`

**Step 1: Implement controller**

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
} from "@nestjs/common";
import { AuthGuard } from "@app/auth";
import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { CurrentTenantId } from "../../auth/decorators/current-tenant-id.decorator.js";
import { SkillsService } from "./skills.service.js";
import {
  CreateSkillDto,
  UpdateSkillDto,
  CreateVersionDto,
  ReviewVersionDto,
} from "./dto/index.js";
import type { SkillType } from "@app/database";

@Controller({ path: "skills", version: "1" })
@UseGuards(AuthGuard)
export class SkillsController {
  constructor(private readonly skillsService: SkillsService) {}

  // ── Skill CRUD ──────────────────────────────────────────────────

  @Post()
  create(
    @Body() dto: CreateSkillDto,
    @CurrentUser("sub") userId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.skillsService.create(dto, userId, tenantId);
  }

  @Get()
  list(@CurrentTenantId() tenantId: string, @Query("type") type?: SkillType) {
    return this.skillsService.list(tenantId, type);
  }

  @Get(":id")
  getById(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.skillsService.getById(id, tenantId);
  }

  @Patch(":id")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateSkillDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.skillsService.update(id, dto, tenantId);
  }

  @Delete(":id")
  delete(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.skillsService.delete(id, tenantId);
  }

  // ── Version Management ──────────────────────────────────────────

  @Get(":id/versions")
  listVersions(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.skillsService.listVersions(id, tenantId);
  }

  @Get(":id/versions/:version")
  getVersion(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("version", ParseIntPipe) version: number,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.skillsService.getVersion(id, version, tenantId);
  }

  @Post(":id/versions")
  createVersion(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CreateVersionDto,
    @CurrentUser("sub") userId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.skillsService.createVersion(id, dto, userId, tenantId);
  }

  @Patch(":id/versions/:version")
  reviewVersion(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("version", ParseIntPipe) version: number,
    @Body() dto: ReviewVersionDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.skillsService.reviewVersion(id, version, dto.action, tenantId);
  }
}
```

**Step 2: Commit**

```bash
git add apps/server/apps/gateway/src/skills/skills.controller.ts
git commit -m "feat(skills): add backend controller with REST endpoints"
```

---

## Task 5: Backend Module Registration

**Files:**

- Create: `apps/server/apps/gateway/src/skills/skills.module.ts`
- Modify: `apps/server/apps/gateway/src/app.module.ts`

**Step 1: Create module**

`skills.module.ts`:

```typescript
import { Module } from "@nestjs/common";
import { AuthModule } from "@app/auth";
import { SkillsController } from "./skills.controller.js";
import { SkillsService } from "./skills.service.js";

@Module({
  imports: [AuthModule],
  controllers: [SkillsController],
  providers: [SkillsService],
  exports: [SkillsService],
})
export class SkillsModule {}
```

**Step 2: Register in app.module.ts**

Add `SkillsModule` import alongside existing modules (after `TasksModule`):

```typescript
import { SkillsModule } from './skills/skills.module.js';
// ...
imports: [
  // ... existing imports ...
  TasksModule,
  SkillsModule,  // Add this
  ResourcesModule,
],
```

**Step 3: Verify server compiles**

Run: `pnpm build:server`

Expected: Successful compilation with no errors.

**Step 4: Commit**

```bash
git add apps/server/apps/gateway/src/skills/skills.module.ts apps/server/apps/gateway/src/app.module.ts
git commit -m "feat(skills): register skills module in gateway app"
```

---

## Task 6: Frontend Types

**Files:**

- Create: `apps/client/src/types/skill.ts`

**Step 1: Create type definitions**

```typescript
// ── Enums ────────────────────────────────────────────────────────────

export type SkillType = "claude_code_skill" | "prompt_template" | "general";

export type SkillVersionStatus =
  | "draft"
  | "published"
  | "suggested"
  | "rejected";

// ── Entities ─────────────────────────────────────────────────────────

export interface Skill {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  type: SkillType;
  icon: string | null;
  currentVersion: number;
  creatorId: string;
  createdAt: string;
  updatedAt: string;
}

export interface SkillFileManifestEntry {
  path: string;
  fileId: string;
}

export interface SkillVersion {
  id: string;
  skillId: string;
  version: number;
  message: string | null;
  status: SkillVersionStatus;
  fileManifest: SkillFileManifestEntry[];
  suggestedBy: string | null;
  creatorId: string;
  createdAt: string;
}

export interface SkillFile {
  id: string;
  skillId: string;
  path: string;
  content: string;
  size: number;
  createdAt: string;
}

export interface SkillDetail extends Skill {
  currentVersionInfo: SkillVersion | null;
  files: SkillFile[];
  pendingSuggestions: SkillVersion[];
}

export interface SkillVersionDetail extends SkillVersion {
  files: SkillFile[];
}

// ── DTOs ─────────────────────────────────────────────────────────────

export interface CreateSkillDto {
  name: string;
  description?: string;
  type: SkillType;
  icon?: string;
  files?: { path: string; content: string }[];
}

export interface UpdateSkillDto {
  name?: string;
  description?: string;
  icon?: string;
}

export interface CreateVersionDto {
  message?: string;
  files: { path: string; content: string }[];
  status: "published" | "suggested";
  suggestedBy?: string;
}

export interface ReviewVersionDto {
  action: "approve" | "reject";
}
```

**Step 2: Commit**

```bash
git add apps/client/src/types/skill.ts
git commit -m "feat(skills): add frontend type definitions"
```

---

## Task 7: Frontend API Service

**Files:**

- Create: `apps/client/src/services/api/skills.ts`
- Modify: `apps/client/src/services/api/index.ts`

**Step 1: Create API service**

`skills.ts`:

```typescript
import http from "../http";
import type {
  Skill,
  SkillDetail,
  SkillVersion,
  SkillVersionDetail,
  SkillType,
  CreateSkillDto,
  UpdateSkillDto,
  CreateVersionDto,
  ReviewVersionDto,
} from "@/types/skill";

export interface SkillListParams {
  type?: SkillType;
}

export const skillsApi = {
  create: async (dto: CreateSkillDto): Promise<Skill> => {
    const response = await http.post<Skill>("/v1/skills", dto);
    return response.data;
  },

  list: async (params?: SkillListParams): Promise<Skill[]> => {
    const response = await http.get<Skill[]>("/v1/skills", { params });
    return response.data;
  },

  getById: async (id: string): Promise<SkillDetail> => {
    const response = await http.get<SkillDetail>(`/v1/skills/${id}`);
    return response.data;
  },

  update: async (id: string, dto: UpdateSkillDto): Promise<Skill> => {
    const response = await http.patch<Skill>(`/v1/skills/${id}`, dto);
    return response.data;
  },

  delete: async (id: string): Promise<void> => {
    await http.delete(`/v1/skills/${id}`);
  },

  // Versions
  listVersions: async (id: string): Promise<SkillVersion[]> => {
    const response = await http.get<SkillVersion[]>(
      `/v1/skills/${id}/versions`,
    );
    return response.data;
  },

  getVersion: async (
    id: string,
    version: number,
  ): Promise<SkillVersionDetail> => {
    const response = await http.get<SkillVersionDetail>(
      `/v1/skills/${id}/versions/${version}`,
    );
    return response.data;
  },

  createVersion: async (
    id: string,
    dto: CreateVersionDto,
  ): Promise<SkillVersion> => {
    const response = await http.post<SkillVersion>(
      `/v1/skills/${id}/versions`,
      dto,
    );
    return response.data;
  },

  reviewVersion: async (
    id: string,
    version: number,
    dto: ReviewVersionDto,
  ): Promise<void> => {
    await http.patch(`/v1/skills/${id}/versions/${version}`, dto);
  },
};

export default skillsApi;
```

**Step 2: Register in api index**

Add to `apps/client/src/services/api/index.ts`:

```typescript
import skillsApi from "./skills";
// ...
export const api = {
  // ... existing
  skills: skillsApi,
};
```

**Step 3: Commit**

```bash
git add apps/client/src/services/api/skills.ts apps/client/src/services/api/index.ts
git commit -m "feat(skills): add frontend API service"
```

---

## Task 8: Frontend React Query Hooks

**Files:**

- Create: `apps/client/src/hooks/useSkills.ts`

**Step 1: Create hooks**

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";
import type {
  CreateSkillDto,
  UpdateSkillDto,
  CreateVersionDto,
  SkillType,
} from "@/types/skill";

// ── Query Hooks ─────────────────────────────────────────────────────

export function useSkills(type?: SkillType) {
  return useQuery({
    queryKey: ["skills", { type }],
    queryFn: () => api.skills.list(type ? { type } : undefined),
  });
}

export function useSkill(id: string | undefined) {
  return useQuery({
    queryKey: ["skills", id],
    queryFn: () => api.skills.getById(id!),
    enabled: !!id,
  });
}

export function useSkillVersions(id: string | undefined) {
  return useQuery({
    queryKey: ["skills", id, "versions"],
    queryFn: () => api.skills.listVersions(id!),
    enabled: !!id,
  });
}

export function useSkillVersion(
  id: string | undefined,
  version: number | undefined,
) {
  return useQuery({
    queryKey: ["skills", id, "versions", version],
    queryFn: () => api.skills.getVersion(id!, version!),
    enabled: !!id && version != null,
  });
}

// ── Mutation Hooks ──────────────────────────────────────────────────

export function useCreateSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateSkillDto) => api.skills.create(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}

export function useUpdateSkill(skillId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateSkillDto) => api.skills.update(skillId, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills", skillId] });
      queryClient.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}

export function useDeleteSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.skills.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}

export function useCreateSkillVersion(skillId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateVersionDto) =>
      api.skills.createVersion(skillId, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills", skillId] });
      queryClient.invalidateQueries({
        queryKey: ["skills", skillId, "versions"],
      });
    },
  });
}

export function useReviewSkillVersion(skillId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      version,
      action,
    }: {
      version: number;
      action: "approve" | "reject";
    }) => api.skills.reviewVersion(skillId, version, { action }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills", skillId] });
      queryClient.invalidateQueries({
        queryKey: ["skills", skillId, "versions"],
      });
    },
  });
}
```

**Step 2: Commit**

```bash
git add apps/client/src/hooks/useSkills.ts
git commit -m "feat(skills): add React Query hooks"
```

---

## Task 9: i18n Translations

**Files:**

- Create: `apps/client/src/i18n/locales/en/skills.json`
- Create: `apps/client/src/i18n/locales/zh/skills.json`
- Modify: `apps/client/src/i18n/locales/en/navigation.json`
- Modify: `apps/client/src/i18n/locales/zh/navigation.json`
- Modify: `apps/client/src/i18n/index.ts`

**Step 1: Create EN translations**

`en/skills.json`:

```json
{
  "title": "Skills",
  "description": "Shared agent skills for your workspace",
  "empty": "No skills yet",
  "emptyDescription": "Create your first skill to get started",
  "tabs": {
    "all": "All",
    "claudeCodeSkill": "Claude Code Skill",
    "promptTemplate": "Prompt Template",
    "general": "General"
  },
  "create": {
    "title": "Create Skill",
    "method": "Creation Method",
    "blank": "Blank",
    "blankDescription": "Start with an empty skill",
    "template": "From Template",
    "templateDescription": "Start from a preset template",
    "upload": "Upload Files",
    "uploadDescription": "Import files from your computer",
    "name": "Name",
    "namePlaceholder": "Enter skill name",
    "description": "Description",
    "descriptionPlaceholder": "What does this skill do?",
    "type": "Type",
    "selectType": "Select type",
    "files": "Files",
    "dragDrop": "Drag & drop files here, or click to browse",
    "creating": "Creating...",
    "cancel": "Cancel",
    "next": "Next",
    "back": "Back",
    "create": "Create"
  },
  "detail": {
    "files": "Files",
    "versions": "Versions",
    "noFiles": "No files yet",
    "uploadFile": "Upload File",
    "newFile": "New File",
    "newFileName": "File name",
    "newFilePlaceholder": "e.g., skill.md",
    "save": "Save",
    "edit": "Edit",
    "delete": "Delete",
    "deleteConfirm": "Are you sure you want to delete this skill?",
    "backToList": "Back to Skills",
    "fileCount": "{{count}} files",
    "rename": "Rename"
  },
  "version": {
    "current": "Current",
    "version": "v{{version}}",
    "publishedBy": "Published by {{name}}",
    "suggestedBy": "Suggested by {{name}}",
    "approve": "Approve",
    "reject": "Reject",
    "pendingSuggestion": "AI suggested changes",
    "pendingSuggestionDescription": "Review the proposed changes below",
    "approved": "Approved",
    "rejected": "Rejected",
    "noVersions": "No versions yet",
    "saveVersion": "Save as New Version",
    "versionMessage": "Version description",
    "versionMessagePlaceholder": "What changed?"
  },
  "status": {
    "published": "Published",
    "suggested": "Suggested",
    "rejected": "Rejected",
    "draft": "Draft"
  },
  "type": {
    "claude_code_skill": "Claude Code Skill",
    "prompt_template": "Prompt Template",
    "general": "General"
  },
  "template": {
    "selectTemplate": "Select Template",
    "claudeCodeSkill": "Claude Code Skill",
    "claudeCodeSkillDescription": "Markdown skill with frontmatter for Claude Code",
    "promptTemplate": "Prompt Template",
    "promptTemplateDescription": "Reusable prompt with variable placeholders"
  }
}
```

**Step 2: Create ZH translations**

`zh/skills.json`:

```json
{
  "title": "技能",
  "description": "工作空间共享的 Agent 技能",
  "empty": "暂无技能",
  "emptyDescription": "创建你的第一个技能",
  "tabs": {
    "all": "全部",
    "claudeCodeSkill": "Claude Code 技能",
    "promptTemplate": "提示词模板",
    "general": "通用"
  },
  "create": {
    "title": "创建技能",
    "method": "创建方式",
    "blank": "空白创建",
    "blankDescription": "从空白技能开始",
    "template": "从模板创建",
    "templateDescription": "从预设模板开始",
    "upload": "上传文件",
    "uploadDescription": "从电脑导入文件",
    "name": "名称",
    "namePlaceholder": "输入技能名称",
    "description": "描述",
    "descriptionPlaceholder": "这个技能做什么？",
    "type": "类型",
    "selectType": "选择类型",
    "files": "文件",
    "dragDrop": "拖拽文件到此处，或点击浏览",
    "creating": "创建中...",
    "cancel": "取消",
    "next": "下一步",
    "back": "上一步",
    "create": "创建"
  },
  "detail": {
    "files": "文件",
    "versions": "版本",
    "noFiles": "暂无文件",
    "uploadFile": "上传文件",
    "newFile": "新建文件",
    "newFileName": "文件名",
    "newFilePlaceholder": "例如 skill.md",
    "save": "保存",
    "edit": "编辑",
    "delete": "删除",
    "deleteConfirm": "确定要删除这个技能吗？",
    "backToList": "返回技能列表",
    "fileCount": "{{count}} 个文件",
    "rename": "重命名"
  },
  "version": {
    "current": "当前",
    "version": "v{{version}}",
    "publishedBy": "由 {{name}} 发布",
    "suggestedBy": "由 {{name}} 建议",
    "approve": "批准",
    "reject": "驳回",
    "pendingSuggestion": "AI 建议了修改",
    "pendingSuggestionDescription": "请查看下方的修改建议",
    "approved": "已批准",
    "rejected": "已驳回",
    "noVersions": "暂无版本",
    "saveVersion": "保存为新版本",
    "versionMessage": "版本说明",
    "versionMessagePlaceholder": "修改了什么？"
  },
  "status": {
    "published": "已发布",
    "suggested": "待审批",
    "rejected": "已驳回",
    "draft": "草稿"
  },
  "type": {
    "claude_code_skill": "Claude Code 技能",
    "prompt_template": "提示词模板",
    "general": "通用"
  },
  "template": {
    "selectTemplate": "选择模板",
    "claudeCodeSkill": "Claude Code 技能",
    "claudeCodeSkillDescription": "带 frontmatter 的 Markdown 技能文件",
    "promptTemplate": "提示词模板",
    "promptTemplateDescription": "带变量占位符的可复用提示词"
  }
}
```

**Step 3: Add navigation keys**

In `en/navigation.json` add: `"skills": "Skills"`
In `zh/navigation.json` add: `"skills": "技能"`

**Step 4: Register namespace in i18n/index.ts**

Add imports for `enSkills` and `zhSkills`, add to resources object:

```typescript
import enSkills from "./locales/en/skills.json";
import zhSkills from "./locales/zh/skills.json";

// In resources:
en: { ..., skills: enSkills },
zh: { ..., skills: zhSkills },
```

**Step 5: Commit**

```bash
git add apps/client/src/i18n/
git commit -m "feat(skills): add i18n translations for skills module"
```

---

## Task 10: Sidebar + Routing + Store

**Files:**

- Modify: `apps/client/src/stores/useAppStore.ts` — add `"skills"` to SidebarSection
- Modify: `apps/client/src/components/layout/MainSidebar.tsx` — add skills nav item between tasks and library
- Create: `apps/client/src/routes/_authenticated/skills/index.tsx` — list page route
- Create: `apps/client/src/routes/_authenticated/skills/$skillId.tsx` — detail page route

**Step 1: Update useAppStore.ts**

Add `"skills"` to `SidebarSection` type (after `"tasks"`), to `ALL_SIDEBAR_SECTIONS` array, and to `DEFAULT_SECTION_PATHS`:

```typescript
// SidebarSection type — add "skills" after "tasks"
export type SidebarSection =
  | "home" | "messages" | "activity" | "files" | "aiStaff"
  | "tasks" | "skills" | "resources" | "library" | "application" | "more";

// ALL_SIDEBAR_SECTIONS — add "skills" after "tasks"

// DEFAULT_SECTION_PATHS — add:
skills: "/skills",

// getSectionFromPath — add before library case:
if (pathname.startsWith("/skills")) return "skills";
```

**Step 2: Update MainSidebar.tsx**

Add between tasks and library entries (after `resources` if it exists, but before `library`):

```typescript
{ id: "skills", labelKey: "skills" as const, icon: Sparkles },
```

Import `Sparkles` from `lucide-react`.

**Step 3: Create list page route**

`apps/client/src/routes/_authenticated/skills/index.tsx`:

```typescript
import { createFileRoute } from "@tanstack/react-router";
import { SkillsListPage } from "@/components/skills/SkillsListPage";

export const Route = createFileRoute("/_authenticated/skills/")({
  component: SkillsListPage,
});
```

**Step 4: Create detail page route**

`apps/client/src/routes/_authenticated/skills/$skillId.tsx`:

```typescript
import { createFileRoute } from "@tanstack/react-router";
import { SkillDetailPage } from "@/components/skills/SkillDetailPage";

export const Route = createFileRoute("/_authenticated/skills/$skillId")({
  component: SkillDetailPage,
});
```

**Step 5: Commit**

```bash
git add apps/client/src/stores/useAppStore.ts apps/client/src/components/layout/MainSidebar.tsx apps/client/src/routes/_authenticated/skills/
git commit -m "feat(skills): add sidebar entry, routes, and store updates"
```

---

## Task 11: Skill Templates Constant

**Files:**

- Create: `apps/client/src/constants/skillTemplates.ts`

**Step 1: Create templates**

```typescript
import type { SkillType } from "@/types/skill";

export interface SkillTemplate {
  id: string;
  name: string;
  descriptionKey: string;
  type: SkillType;
  files: { path: string; content: string }[];
}

export const SKILL_TEMPLATES: SkillTemplate[] = [
  {
    id: "claude-code-skill",
    name: "template.claudeCodeSkill",
    descriptionKey: "template.claudeCodeSkillDescription",
    type: "claude_code_skill",
    files: [
      {
        path: "skill.md",
        content: `---
name: my-skill
description: Describe what this skill does and when to use it
---

# My Skill

## Overview

Describe the skill's purpose and behavior here.

## Instructions

- Step-by-step instructions for the agent
- Use clear, actionable language
- Include examples when helpful

## Examples

\`\`\`
Example input → Expected output
\`\`\`
`,
      },
    ],
  },
  {
    id: "prompt-template",
    name: "template.promptTemplate",
    descriptionKey: "template.promptTemplateDescription",
    type: "prompt_template",
    files: [
      {
        path: "prompt.md",
        content: `# {{task_name}}

## Context

You are helping with {{context}}.

## Instructions

{{instructions}}

## Output Format

Provide your response in the following format:
- Summary
- Key findings
- Recommendations
`,
      },
      {
        path: "variables.json",
        content: JSON.stringify(
          {
            variables: [
              {
                name: "task_name",
                description: "Name of the task",
                required: true,
              },
              {
                name: "context",
                description: "Context for the task",
                required: true,
              },
              {
                name: "instructions",
                description: "Specific instructions",
                required: false,
                default: "Follow best practices",
              },
            ],
          },
          null,
          2,
        ),
      },
    ],
  },
];
```

**Step 2: Commit**

```bash
git add apps/client/src/constants/skillTemplates.ts
git commit -m "feat(skills): add preset skill templates"
```

---

## Task 12: Skills List Page Component

**Files:**

- Create: `apps/client/src/components/skills/SkillsListPage.tsx`
- Create: `apps/client/src/components/skills/SkillCard.tsx`

**Step 1: Create SkillCard**

`apps/client/src/components/skills/SkillCard.tsx`:

A card component displaying:

- Skill icon (emoji or default icon per type) + name
- Truncated description
- Type badge (using `skills` i18n namespace `type.*` keys)
- File count + version number (`v3 · 5 files`)
- Red dot indicator if `pendingSuggestions > 0` (only visible on list if backend returns this — for list endpoint, compute from a count subquery or keep simple for demo)

Pattern: follow TaskCard.tsx style — clickable card with hover effect, uses `useTranslation("skills")`, Badge for type, `cn()` for class composition.

On click: `navigate({ to: "/skills/$skillId", params: { skillId: skill.id } })` using TanStack Router.

**Step 2: Create SkillsListPage**

`apps/client/src/components/skills/SkillsListPage.tsx`:

Layout (follow Tasks page pattern):

- Header: `t("title")` + "+" button to open CreateSkillDialog
- Tabs: All | Claude Code Skill | Prompt Template | General (client-side filtering from `useSkills()`)
- Grid of SkillCards (responsive: `grid-cols-1 md:grid-cols-2 lg:grid-cols-3`)
- Empty state when no skills
- Loading skeleton state

State: `const [tab, setTab] = useState<"all" | SkillType>("all")` for filtering. `const [showCreate, setShowCreate] = useState(false)` for dialog.

**Step 3: Commit**

```bash
git add apps/client/src/components/skills/SkillsListPage.tsx apps/client/src/components/skills/SkillCard.tsx
git commit -m "feat(skills): add list page with skill cards and filtering"
```

---

## Task 13: Create Skill Dialog

**Files:**

- Create: `apps/client/src/components/skills/CreateSkillDialog.tsx`

**Step 1: Implement multi-step dialog**

Uses Dialog from Radix UI (same pattern as CreateTaskDialog).

State machine with 3 steps:

1. **Method selection**: 3 cards (Blank / Template / Upload)
2. **Basic info**: Name (Input), Description (Textarea), Type (Select) — auto-set type if template selected
3. **Template preview / Upload area / Confirm**

On submit: call `useCreateSkill()` mutation with assembled `CreateSkillDto`. For template, pass `files` from `SKILL_TEMPLATES`. For upload, read file contents via `FileReader` and populate `files` array. For blank, pass empty `files` (or omit).

Close on success, toast notification.

**Step 2: Commit**

```bash
git add apps/client/src/components/skills/CreateSkillDialog.tsx
git commit -m "feat(skills): add create skill dialog with blank/template/upload"
```

---

## Task 14: Skill Detail Page

**Files:**

- Create: `apps/client/src/components/skills/SkillDetailPage.tsx`
- Create: `apps/client/src/components/skills/FileTree.tsx`
- Create: `apps/client/src/components/skills/FileEditor.tsx`

**Step 1: Create FileTree component**

`FileTree.tsx`:

Takes `files: SkillFile[]` and renders a tree. Build tree structure from flat file paths:

- Parse paths like `prompts/main.md` into nested folders
- Render folders as collapsible groups, files as leaf nodes
- Highlight selected file
- Icons: `Folder` / `FolderOpen` for directories, `FileText` for files (from lucide-react)

Props: `files`, `selectedPath`, `onSelectFile(path)`, `onNewFile()`, `onDeleteFile(path)`

**Step 2: Create FileEditor component**

`FileEditor.tsx`:

Takes a `SkillFile` and renders:

- Read mode: render markdown (for .md files) or syntax-highlighted code (for others) — can use a simple `<pre>` for demo
- Edit mode: `<textarea>` with monospace font, full height
- Toggle edit button, save button

Props: `file`, `isEditing`, `onToggleEdit()`, `onSave(content)`, `readOnly` (for historical versions)

**Step 3: Create SkillDetailPage**

`SkillDetailPage.tsx`:

Layout:

- Top bar: back button (`<- Skills`), skill name (editable inline), type badge, settings dropdown (rename, delete)
- Below top bar: version selector dropdown + "Save as New Version" button
- If pending suggestions: amber banner with "AI suggested changes — Review" link
- Main area split: left 25% FileTree, right 75% FileEditor

Data flow:

- `const { skillId } = Route.useParams()`
- `const { data: skill } = useSkill(skillId)`
- `const [selectedPath, setSelectedPath] = useState<string | null>(null)`
- `const [viewingVersion, setViewingVersion] = useState<number | null>(null)` — null = current
- When `viewingVersion` set, fetch with `useSkillVersion(skillId, viewingVersion)` and show read-only
- "Save as New Version": collect all file contents, open a small modal for version message, call `useCreateSkillVersion`

**Step 4: Commit**

```bash
git add apps/client/src/components/skills/SkillDetailPage.tsx apps/client/src/components/skills/FileTree.tsx apps/client/src/components/skills/FileEditor.tsx
git commit -m "feat(skills): add detail page with file tree and editor"
```

---

## Task 15: Suggestion Review UI

**Files:**

- Create: `apps/client/src/components/skills/SuggestionReviewPanel.tsx`
- Modify: `apps/client/src/components/skills/SkillDetailPage.tsx`

**Step 1: Create SuggestionReviewPanel**

Shows when user clicks "Review" on the suggestion banner.

Layout:

- Header: "Suggested by {{botName}} — v{{version}}"
- For each file in suggested version, show side-by-side or inline diff:
  - Left: current published content
  - Right: suggested content
  - For demo: simple two-column layout with highlighted differences (can use basic line-by-line comparison, or just show both contents side-by-side)
- Footer: Reject (outline/destructive) + Approve (primary) buttons

Uses `useReviewSkillVersion(skillId)` mutation.

**Step 2: Wire into SkillDetailPage**

Add state: `const [reviewingVersion, setReviewingVersion] = useState<number | null>(null)`

When `reviewingVersion` is set, render `SuggestionReviewPanel` overlay/panel instead of normal editor area.

**Step 3: Commit**

```bash
git add apps/client/src/components/skills/SuggestionReviewPanel.tsx apps/client/src/components/skills/SkillDetailPage.tsx
git commit -m "feat(skills): add suggestion review panel with diff view"
```

---

## Task 16: Final Integration Verification

**Step 1: Build server**

Run: `pnpm build:server`
Expected: No compilation errors.

**Step 2: Build client**

Run: `pnpm build:client`
Expected: No compilation errors.

**Step 3: Run dev server and verify**

Run: `pnpm dev`
Expected: Skills icon appears in sidebar between Tasks and Library. Clicking navigates to `/skills`. List page renders (empty state). Create dialog opens. Detail page route works.

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix(skills): resolve integration issues from final verification"
```

---

## File Summary

### New files (backend):

- `apps/server/libs/database/src/schemas/skill/skills.ts`
- `apps/server/libs/database/src/schemas/skill/skill-versions.ts`
- `apps/server/libs/database/src/schemas/skill/skill-files.ts`
- `apps/server/libs/database/src/schemas/skill/relations.ts`
- `apps/server/libs/database/src/schemas/skill/index.ts`
- `apps/server/apps/gateway/src/skills/dto/create-skill.dto.ts`
- `apps/server/apps/gateway/src/skills/dto/update-skill.dto.ts`
- `apps/server/apps/gateway/src/skills/dto/create-version.dto.ts`
- `apps/server/apps/gateway/src/skills/dto/review-version.dto.ts`
- `apps/server/apps/gateway/src/skills/dto/index.ts`
- `apps/server/apps/gateway/src/skills/skills.service.ts`
- `apps/server/apps/gateway/src/skills/skills.controller.ts`
- `apps/server/apps/gateway/src/skills/skills.module.ts`

### New files (frontend):

- `apps/client/src/types/skill.ts`
- `apps/client/src/services/api/skills.ts`
- `apps/client/src/hooks/useSkills.ts`
- `apps/client/src/i18n/locales/en/skills.json`
- `apps/client/src/i18n/locales/zh/skills.json`
- `apps/client/src/constants/skillTemplates.ts`
- `apps/client/src/routes/_authenticated/skills/index.tsx`
- `apps/client/src/routes/_authenticated/skills/$skillId.tsx`
- `apps/client/src/components/skills/SkillsListPage.tsx`
- `apps/client/src/components/skills/SkillCard.tsx`
- `apps/client/src/components/skills/CreateSkillDialog.tsx`
- `apps/client/src/components/skills/SkillDetailPage.tsx`
- `apps/client/src/components/skills/FileTree.tsx`
- `apps/client/src/components/skills/FileEditor.tsx`
- `apps/client/src/components/skills/SuggestionReviewPanel.tsx`

### Modified files:

- `apps/server/libs/database/src/schemas/index.ts`
- `apps/server/apps/gateway/src/app.module.ts`
- `apps/client/src/services/api/index.ts`
- `apps/client/src/stores/useAppStore.ts`
- `apps/client/src/components/layout/MainSidebar.tsx`
- `apps/client/src/i18n/index.ts`
- `apps/client/src/i18n/locales/en/navigation.json`
- `apps/client/src/i18n/locales/zh/navigation.json`
