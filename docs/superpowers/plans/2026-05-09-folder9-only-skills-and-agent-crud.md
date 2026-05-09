# Folder9-Only Skills + Agent CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status: Implemented** (branch `feat/folder9-skills-agent-crud`, 2026-05-09)

**Goal:** Drop the legacy `skill_versions` / `skill_files` tables, add a per-skill `agentAccess` permission axis, and bridge the workspace skill library into the claw-hive agent runtime so agents can search / mount / create / modify tenant skills.

**Architecture:** Folder9 light folder is the only file store; commits go straight to HEAD (`approval_mode: 'auto'`). Agent CRUD lives in a new `Team9SkillsComponent` with two new LLM tools (`create_workspace_skill`, `mount_workspace_skill`) and a new `WorkspaceSkillsProvider` for `search_skills`/`load_skills`. Permission decisions are centralized in a `resolveSkillAgentAccess(skillId, botUserId)` helper on the gateway and surfaced to the LLM via skill-tier XML attributes plus a static guidance block.

**Tech Stack:** NestJS 11 + Drizzle ORM (gateway), pi-agent-core component framework (claw-hive / agent-pi), TanStack Query + React 19 (frontend), Vitest (agent-pi) / Jest (gateway/frontend) for tests.

**Spec:** [docs/superpowers/specs/2026-05-09-folder9-only-skills-and-agent-crud-design.md](../specs/2026-05-09-folder9-only-skills-and-agent-crud-design.md)

**Repos touched:**

- team9 (`/Users/winrey/Projects/weightwave/team9`) — DB schema, gateway, frontend
- team9-agent-pi (`/Users/winrey/Projects/weightwave/team9-agent-pi`) — runtime types, components, providers

**Sequencing constraint:** Tasks 7–11 in agent-pi must be published before Task 6 (gateway folder-token.service `'workspace.skill'` branch) deploys, because the gateway will reference the new `Team9LogicalMountKey` value `'workspace.skill'` exported from `@team9claw/claw-hive-types`. Plan order keeps gateway and agent-pi work parallel-able where possible; the package version bump (Task 11) is the synchronization point.

---

## File Structure

### team9 (gateway / frontend)

**New files**

- `apps/server/libs/database/migrations/<timestamp>_drop_skill_versions_skill_files.sql` — drop legacy tables + currentVersion + version status enum
- `apps/server/libs/database/migrations/<timestamp>_add_skills_agent_access.sql` — add `skill__agent_access` enum + `skills.agentAccess` column
- `apps/server/apps/gateway/src/skills/agent-access.service.ts` — `resolveSkillAgentAccess(skillId, botUserId)` helper
- `apps/server/apps/gateway/src/skills/agent-access.service.spec.ts`
- `apps/server/apps/gateway/src/skills/bot-skills.controller.ts` — agent-facing `/v1/bot/skills`
- `apps/server/apps/gateway/src/skills/bot-skills.controller.spec.ts`
- `apps/client/src/components/skills/AgentAccessControl.tsx` — 3-radio control
- `apps/client/src/components/skills/__tests__/AgentAccessControl.test.tsx`

**Modified files**

- `apps/server/libs/database/src/schemas/skill/skills.ts` — add `agentAccess` column + enum
- `apps/server/libs/database/src/schemas/skill/index.ts` — drop legacy re-exports
- `apps/server/libs/database/src/schemas/skill/relations.ts` — drop `versions` / `files` relations
- `apps/server/libs/database/src/schemas/skill/skill-versions.ts` — **deleted**
- `apps/server/libs/database/src/schemas/skill/skill-files.ts` — **deleted**
- `apps/server/apps/gateway/src/skills/skills.service.ts` — drop legacy methods, plumb `agentAccess`
- `apps/server/apps/gateway/src/skills/skills.controller.ts` — drop version routes
- `apps/server/apps/gateway/src/skills/skills.module.ts` — register `BotSkillsController` + `agent-access.service`
- `apps/server/apps/gateway/src/skills/dto/create-skill.dto.ts` — add `agentAccess`
- `apps/server/apps/gateway/src/skills/dto/update-skill.dto.ts` — add `agentAccess`
- `apps/server/apps/gateway/src/skills/dto/index.ts` — drop `create-version` / `review-version` re-exports
- `apps/server/apps/gateway/src/skills/dto/create-version.dto.ts` — **deleted**
- `apps/server/apps/gateway/src/skills/dto/review-version.dto.ts` — **deleted**
- `apps/server/apps/gateway/src/skills/skills.service.spec.ts` — drop version tests, add `agentAccess` tests
- `apps/server/apps/gateway/src/skills/skills.controller.spec.ts` — drop version tests
- `apps/server/apps/gateway/src/folder9/folder-token.service.ts` — add `'workspace.skill'` branch + matrix
- `apps/server/apps/gateway/src/folder9/folder-token.service.spec.ts` — add new matrix tests
- `apps/client/src/types/skill.ts` — drop `SkillVersion` / `SkillFile` / `SkillFileManifestEntry`; add `SkillAgentAccess`
- `apps/client/src/services/api/skills.ts` — drop version methods, extend update body
- `apps/client/src/services/api/folder9-folder.ts` — drop `fetchLegacySkillFiles` / `isMissingSkillFolderRoute`
- `apps/client/src/hooks/useSkills.ts` — drop version queries
- `apps/client/src/components/skills/SkillCard.tsx` — drop `hasPendingSuggestion` badge
- `apps/client/src/components/skills/SuggestionReviewPanel.tsx` — **deleted**
- `apps/client/src/components/skills/__tests__/SuggestionReviewPanel.test.tsx` — **deleted**
- `apps/client/src/components/skills/CreateSkillDialog.tsx` — add `agentAccess` selector defaulting to `'read'`
- `apps/client/src/components/skills/SkillDetailPage.tsx` — mount `AgentAccessControl`
- `apps/client/src/i18n/locales/*/skills.json` — strings for the new control

### team9-agent-pi (runtime)

**New files**

- `packages/agent-components/src/components/skill/workspace-skills-provider.ts` — new `ISkillProvider`
- `packages/agent-components/src/components/skill/workspace-skills-provider.test.ts`
- `packages/claw-hive/src/components/team9-skills/component.ts` — new `Team9SkillsComponent`
- `packages/claw-hive/src/components/team9-skills/component.test.ts`
- `packages/claw-hive/src/components/team9-skills/tools/create-workspace-skill.ts`
- `packages/claw-hive/src/components/team9-skills/tools/mount-workspace-skill.ts`
- `packages/claw-hive/src/components/team9-skills/tools/__tests__/*.test.ts`
- `packages/claw-hive/src/components/team9-skills/index.ts`
- `packages/claw-hive/src/components/team9-skills/team9-skills-prompt.ts` — static guidance block

**Modified files**

- `packages/claw-hive-types/src/just-bash-team9-workspace.ts` — add `'workspace.skill'` to `Team9LogicalMountKey`
- `packages/agent-components/src/components/skill/skill-component.ts` — add `unregisterProvider` to API
- `packages/agent-components/src/components/skill/skill-component.test.ts` — `unregisterProvider` cases
- `packages/agent-components/src/resource-tier/resource-tier-manager.ts` — add `removeByProviderId(providerId)`
- `packages/agent-components/src/resource-tier/resource-tier-manager.test.ts`
- `packages/agent-components/src/components/skill/skill-tier-xml.ts` — render `source` + `agentAccess` attributes
- `packages/agent-components/src/components/skill/skill-tier-xml.test.ts`
- `packages/types/src/skill.ts` (or wherever `TieredSkill` / `SkillProviderSearchResult` live) — add optional `source` and `agentAccess` fields
- `packages/agent-components/src/components/skill/mounted-folder-provider.ts` — set `source: 'bundled'` on returned skills
- `packages/agent-components/src/components/skill/memory-skill-provider.ts` — set `source: 'bundled'`
- `packages/agent-components/src/components/skill/register-source-code-skills.ts` — set `source: 'bundled'`
- `packages/claw-hive/src/blueprints/presets.ts` — add `team9-skills` to relevant blueprints (`team9-common-staff`, routine-hosting)
- `packages/claw-hive/src/component-factories.ts` — register `team9-skills` factory

---

## Task 0: Drizzle migrations — drop legacy tables, add `agentAccess`

**Goal:** Mutate the production schema to the terminal state in two atomic migrations.

**Files:**

- Create: `apps/server/libs/database/migrations/<timestamp>_add_skills_agent_access.sql`
- Create: `apps/server/libs/database/migrations/<timestamp>_drop_skill_versions_skill_files.sql`
- Modify: `apps/server/libs/database/src/schemas/skill/skills.ts`
- Modify: `apps/server/libs/database/src/schemas/skill/index.ts`
- Modify: `apps/server/libs/database/src/schemas/skill/relations.ts`
- Delete: `apps/server/libs/database/src/schemas/skill/skill-versions.ts`
- Delete: `apps/server/libs/database/src/schemas/skill/skill-files.ts`

**Acceptance Criteria:**

- [ ] New `skill__agent_access` pgEnum exists with values `('none','read','write')`.
- [ ] `skills.agentAccess` column exists, NOT NULL, default `'read'`.
- [ ] `skill_versions` and `skill_files` tables are gone; `skill_version__status` enum is gone.
- [ ] `skills.currentVersion` column is gone.
- [ ] `skillVersions`, `skillFiles`, `skillVersionsRelations`, `skillFilesRelations` no longer exported from `@team9/database/schemas`.
- [ ] `pnpm db:generate` produces no further diff after applying these migrations.

**Verify:** `pnpm --filter @team9/database typecheck && pnpm db:generate -- --check` (no diff)

**Steps:**

- [ ] **Step 1: Update `skills.ts` schema**

Edit `apps/server/libs/database/src/schemas/skill/skills.ts`:

```ts
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

export const skillTypeEnum = pgEnum("skill__type", [
  "claude_code_skill",
  "prompt_template",
  "general",
]);

export const skillAgentAccessEnum = pgEnum("skill__agent_access", [
  "none",
  "read",
  "write",
]);

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
    folderId: uuid("folder_id"),
    agentAccess: skillAgentAccessEnum("agent_access").default("read").notNull(),
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
export type SkillAgentAccess = (typeof skillAgentAccessEnum.enumValues)[number];
```

(`currentVersion` is removed; `agentAccess` is added.)

- [ ] **Step 2: Delete legacy schema files**

```bash
rm apps/server/libs/database/src/schemas/skill/skill-versions.ts
rm apps/server/libs/database/src/schemas/skill/skill-files.ts
```

- [ ] **Step 3: Update `index.ts`**

`apps/server/libs/database/src/schemas/skill/index.ts` becomes:

```ts
export * from "./skills.js";
export * from "./relations.js";
```

- [ ] **Step 4: Update `relations.ts`**

`apps/server/libs/database/src/schemas/skill/relations.ts`:

```ts
import { relations } from "drizzle-orm";
import { skills } from "./skills.js";
import { tenants } from "../tenant/tenants.js";
import { users } from "../im/users.js";

export const skillsRelations = relations(skills, ({ one }) => ({
  tenant: one(tenants, {
    fields: [skills.tenantId],
    references: [tenants.id],
  }),
  creator: one(users, {
    fields: [skills.creatorId],
    references: [users.id],
  }),
}));
```

- [ ] **Step 5: Generate migrations**

```bash
pnpm db:generate
```

This emits two SQL files in `apps/server/libs/database/migrations/`. Inspect them — they should add the `skill__agent_access` enum + `skills.agent_access` column, and drop the two legacy tables + `skills.current_version` column + the `skill_version__status` enum. If Drizzle generates them in a single SQL file, split them into two files manually so the deploy plan stays "add column first, drop tables second" (same deploy, two separate statements).

- [ ] **Step 6: Apply locally + verify**

```bash
pnpm db:push        # local dev DB
pnpm db:generate -- --check    # should report no diff
```

- [ ] **Step 7: Commit**

```bash
git add apps/server/libs/database/src/schemas/skill/ \
        apps/server/libs/database/migrations/
git commit -m "feat(skills/db): drop skill_versions/skill_files, add agentAccess column"
```

---

## Task 1: SkillsService refactor — drop legacy methods, plumb `agentAccess`

**Goal:** Strip every reference to `skill_versions` / `skill_files` / `currentVersion` out of `SkillsService`, accept and persist `agentAccess` on create/update/list/getById.

**Files:**

- Modify: `apps/server/apps/gateway/src/skills/skills.service.ts`
- Modify: `apps/server/apps/gateway/src/skills/dto/create-skill.dto.ts`
- Modify: `apps/server/apps/gateway/src/skills/dto/update-skill.dto.ts`
- Modify: `apps/server/apps/gateway/src/skills/dto/index.ts`
- Delete: `apps/server/apps/gateway/src/skills/dto/create-version.dto.ts`
- Delete: `apps/server/apps/gateway/src/skills/dto/review-version.dto.ts`
- Modify: `apps/server/apps/gateway/src/skills/skills.service.spec.ts`

**Acceptance Criteria:**

- [ ] `listVersions`, `getVersion`, `createVersion`, `reviewVersion`, `createVersionInternal` are gone from the service.
- [ ] `getById` returns `Skill` (no `files` field, no `currentVersionInfo`).
- [ ] `list` returns plain `Skill[]` (no `pendingSuggestionsCount`).
- [ ] `create` accepts an `agentAccess` argument; default is parameterized by caller (UI default `'read'`, bot default `'write'`).
- [ ] `update` accepts `agentAccess` and persists it.
- [ ] `provisionSkillFolder` / `getSkillFolderSeedFiles` no longer reference `skillVersions` / `skillFiles`.
- [ ] DTOs `CreateSkillDto` and `UpdateSkillDto` accept optional `agentAccess: 'none' | 'read' | 'write'`.
- [ ] `dto/index.ts` no longer re-exports `CreateVersionDto` / `ReviewVersionDto`.
- [ ] All existing skill service tests that don't reference versions still pass.

**Verify:** `pnpm --filter gateway test src/skills/skills.service.spec.ts`

**Steps:**

- [ ] **Step 1: Update DTOs**

`apps/server/apps/gateway/src/skills/dto/create-skill.dto.ts`:

```ts
import { IsEnum, IsOptional, IsString, MaxLength } from "class-validator";
import type { SkillType, SkillAgentAccess } from "@team9/database/schemas";

export class CreateSkillDto {
  @IsString()
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(["claude_code_skill", "prompt_template", "general"])
  type?: SkillType;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  icon?: string;

  @IsOptional()
  @IsEnum(["none", "read", "write"])
  agentAccess?: SkillAgentAccess;

  // Initial files retained — used by import flows.
  @IsOptional()
  files?: { path: string; content: string }[];
}
```

`apps/server/apps/gateway/src/skills/dto/update-skill.dto.ts`:

```ts
import { IsEnum, IsOptional, IsString, MaxLength } from "class-validator";
import type { SkillAgentAccess } from "@team9/database/schemas";

export class UpdateSkillDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  icon?: string;

  @IsOptional()
  @IsEnum(["none", "read", "write"])
  agentAccess?: SkillAgentAccess;
}
```

`apps/server/apps/gateway/src/skills/dto/index.ts`:

```ts
export * from "./create-skill.dto.js";
export * from "./update-skill.dto.js";
```

- [ ] **Step 2: Delete legacy DTO files**

```bash
rm apps/server/apps/gateway/src/skills/dto/create-version.dto.ts
rm apps/server/apps/gateway/src/skills/dto/review-version.dto.ts
```

- [ ] **Step 3: Refactor `SkillsService.create`**

Replace the method to plumb `agentAccess`:

```ts
async create(
  dto: CreateSkillDto,
  userId: string,
  tenantId: string,
  defaults: { agentAccess: SkillAgentAccess } = { agentAccess: 'read' },
) {
  const skillId = uuidv7();
  const files = this.ensureSkillMd(dto.files, dto.name, dto.description);

  const folder = await this.folder9Client.createFolder(tenantId, {
    name: dto.name,
    type: 'light',
    owner_type: 'workspace',
    owner_id: tenantId,
    approval_mode: 'auto',
    metadata: { team9_kind: 'skill', team9_skill_id: skillId },
  });

  const token = await this.mintSkillFolderToken(
    folder.id,
    userId,
    'write',
    SkillsService.WRITE_TOKEN_TTL_MS,
  );

  await this.folder9Client.commit(tenantId, folder.id, token, {
    message: 'Initialize skill',
    files: files.map((file) => ({
      path: file.path,
      content: file.content,
      action: 'create' as const,
    })),
  });

  const [skill] = await this.db
    .insert(schema.skills)
    .values({
      id: skillId,
      tenantId,
      name: dto.name,
      description: dto.description ?? null,
      type: dto.type ?? 'general',
      icon: dto.icon ?? null,
      folderId: folder.id,
      agentAccess: dto.agentAccess ?? defaults.agentAccess,
      creatorId: userId,
    })
    .returning();

  return skill;
}
```

(Caller passes `defaults: { agentAccess: 'write' }` from `BotSkillsController` in Task 4.)

- [ ] **Step 4: Refactor `getById`, `list`, `update`, `provisionSkillFolder`, `getSkillFolderSeedFiles`**

`getById` — drop `currentVersion` / `fileManifest` / `skill_files` lookup:

```ts
async getById(skillId: string, tenantId: string) {
  return this.getSkillOrThrow(skillId, tenantId);
}
```

`list` — drop `pendingSuggestionsCount`:

```ts
async list(tenantId: string, type?: SkillType) {
  const conditions = [eq(schema.skills.tenantId, tenantId)];
  if (type) conditions.push(eq(schema.skills.type, type));
  return this.db
    .select()
    .from(schema.skills)
    .where(and(...conditions))
    .orderBy(desc(schema.skills.createdAt));
}
```

`update` — accept `agentAccess`:

```ts
async update(skillId: string, dto: UpdateSkillDto, tenantId: string) {
  await this.getSkillOrThrow(skillId, tenantId);

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (dto.name !== undefined) updateData.name = dto.name;
  if (dto.description !== undefined) updateData.description = dto.description;
  if (dto.icon !== undefined) updateData.icon = dto.icon;
  if (dto.agentAccess !== undefined) updateData.agentAccess = dto.agentAccess;

  const [updated] = await this.db
    .update(schema.skills)
    .set(updateData)
    .where(eq(schema.skills.id, skillId))
    .returning();

  return updated;
}
```

`getSkillFolderSeedFiles` — drop the version branch entirely:

```ts
private async getSkillFolderSeedFiles(
  skill: schema.Skill,
): Promise<{ path: string; content: string }[]> {
  return this.ensureSkillMd(
    undefined,
    skill.name,
    skill.description ?? undefined,
  );
}
```

Delete the methods `listVersions`, `getVersion`, `createVersion`, `reviewVersion`, `createVersionInternal`. Remove the `inArray` import if unused.

- [ ] **Step 5: Update existing tests**

`apps/server/apps/gateway/src/skills/skills.service.spec.ts`:

- Delete every `describe('listVersions' | 'getVersion' | 'createVersion' | 'reviewVersion', ...)` block.
- Delete fixtures referencing `skillVersions` / `skillFiles`.
- Update existing `create` and `list` tests to expect the new shape (no `pendingSuggestionsCount`).
- Add new `it`s:

```ts
it("persists agentAccess on create when provided", async () => {
  const skill = await service.create(
    { name: "X", type: "general", agentAccess: "write" },
    userId,
    tenantId,
  );
  expect(skill.agentAccess).toBe("write");
});

it("uses caller default for agentAccess when dto omits it", async () => {
  const a = await service.create(
    { name: "A", type: "general" },
    userId,
    tenantId,
    { agentAccess: "read" },
  );
  expect(a.agentAccess).toBe("read");

  const b = await service.create(
    { name: "B", type: "general" },
    userId,
    tenantId,
    { agentAccess: "write" },
  );
  expect(b.agentAccess).toBe("write");
});

it("updates agentAccess", async () => {
  const skill = await service.create(/* ... */);
  const updated = await service.update(
    skill.id,
    { agentAccess: "none" },
    tenantId,
  );
  expect(updated.agentAccess).toBe("none");
});
```

- [ ] **Step 6: Run tests**

```bash
pnpm --filter gateway test src/skills/skills.service.spec.ts
```

Expected: PASS, no compile errors. The drop of legacy methods will surface call-site compile errors in `skills.controller.ts` — that's expected and addressed in Task 2.

- [ ] **Step 7: Commit**

```bash
git add apps/server/apps/gateway/src/skills/skills.service.ts \
        apps/server/apps/gateway/src/skills/skills.service.spec.ts \
        apps/server/apps/gateway/src/skills/dto/
git commit -m "feat(skills/service): drop legacy version paths, add agentAccess"
```

---

## Task 2: SkillsController — drop version routes, surface `agentAccess`

**Goal:** Remove the four version routes from `SkillsController` and verify the existing CRUD routes continue to compile and pass.

**Files:**

- Modify: `apps/server/apps/gateway/src/skills/skills.controller.ts`
- Modify: `apps/server/apps/gateway/src/skills/skills.controller.spec.ts`

**Acceptance Criteria:**

- [ ] No `versions` / `:version` routes remain in `SkillsController`.
- [ ] No imports of `CreateVersionDto` / `ReviewVersionDto` remain.
- [ ] `POST /v1/skills` calls service with default `{ agentAccess: 'read' }`.
- [ ] Existing CRUD/folder route tests still pass.

**Verify:** `pnpm --filter gateway test src/skills/skills.controller.spec.ts`

**Steps:**

- [ ] **Step 1: Strip version handlers**

In `apps/server/apps/gateway/src/skills/skills.controller.ts`, remove these handlers and their decorators:

- `listVersions`
- `getVersion`
- `createVersion`
- `reviewVersion`

Update the imports to drop `CreateVersionDto`, `ReviewVersionDto`, and `ParseIntPipe` if it's no longer used. Update `create` to pass the user default:

```ts
@Post()
async create(
  @Body() dto: CreateSkillDto,
  @CurrentUser('sub') userId: string,
  @CurrentTenantId() tenantId: string,
) {
  return this.skillsService.create(dto, userId, tenantId, { agentAccess: 'read' });
}
```

- [ ] **Step 2: Update controller tests**

In `apps/server/apps/gateway/src/skills/skills.controller.spec.ts`:

- Delete any `describe('versions' | 'reviewVersion' | ...)` blocks.
- Add a tiny passthrough test:

```ts
it("passes agentAccess from CreateSkillDto through to service", async () => {
  serviceMock.create.mockResolvedValue(/* fixture */);
  await controller.create(
    { name: "X", type: "general", agentAccess: "none" },
    userId,
    tenantId,
  );
  expect(serviceMock.create).toHaveBeenCalledWith(
    expect.objectContaining({ agentAccess: "none" }),
    userId,
    tenantId,
    { agentAccess: "read" },
  );
});
```

- [ ] **Step 3: Run tests**

```bash
pnpm --filter gateway test src/skills/skills.controller.spec.ts
pnpm --filter gateway typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/server/apps/gateway/src/skills/skills.controller.ts \
        apps/server/apps/gateway/src/skills/skills.controller.spec.ts
git commit -m "feat(skills/controller): drop version routes, pass agentAccess default"
```

---

## Task 3: `resolveSkillAgentAccess` helper service

**Goal:** Centralize the per-(skill, bot) access decision in one helper so both the bot controller and the folder-token branch call the same code path; v2 per-agent override slots in here.

**Files:**

- Create: `apps/server/apps/gateway/src/skills/agent-access.service.ts`
- Create: `apps/server/apps/gateway/src/skills/agent-access.service.spec.ts`
- Modify: `apps/server/apps/gateway/src/skills/skills.module.ts`

**Acceptance Criteria:**

- [ ] `SkillAgentAccessService.resolve(skillId, botUserId, tenantId)` returns the per-skill default.
- [ ] Returns `'none'` when the skill does not exist or belongs to a different tenant (caller treats this as denial).
- [ ] Provider exposed by `SkillsModule` so `BotSkillsController` and `FolderTokenService` can inject it.
- [ ] Tests cover: existing skill returns its `agentAccess`; missing skill returns `'none'`; cross-tenant skill returns `'none'`.

**Verify:** `pnpm --filter gateway test src/skills/agent-access.service.spec.ts`

**Steps:**

- [ ] **Step 1: Implement service**

`apps/server/apps/gateway/src/skills/agent-access.service.ts`:

```ts
import { Inject, Injectable } from "@nestjs/common";
import {
  DATABASE_CONNECTION,
  eq,
  and,
  type PostgresJsDatabase,
} from "@team9/database";
import * as schema from "@team9/database/schemas";
import type { SkillAgentAccess } from "@team9/database/schemas";

@Injectable()
export class SkillAgentAccessService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /**
   * Resolve effective agent access for a (skill, bot) pair.
   *
   * v1: returns the per-skill default. If the skill is missing or
   * belongs to a different tenant, returns `'none'` so callers can
   * uniformly treat it as denial without branching on errors.
   *
   * v2 (out of scope, see spec §9): consult `skill_agent_access` table
   * for a per-agent override before falling back to the per-skill
   * default. Signature already accepts `botUserId` so call sites do
   * not need to change.
   */
  async resolve(
    skillId: string,
    _botUserId: string,
    tenantId: string,
  ): Promise<SkillAgentAccess> {
    const [row] = await this.db
      .select({ agentAccess: schema.skills.agentAccess })
      .from(schema.skills)
      .where(
        and(
          eq(schema.skills.id, skillId),
          eq(schema.skills.tenantId, tenantId),
        ),
      )
      .limit(1);

    return row?.agentAccess ?? "none";
  }
}
```

- [ ] **Step 2: Register in module**

`apps/server/apps/gateway/src/skills/skills.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { DatabaseModule } from "@team9/database";
import { Folder9Module } from "../wikis/folder9.module.js";
import { SkillsController } from "./skills.controller.js";
import { BotSkillsController } from "./bot-skills.controller.js";
import { SkillsService } from "./skills.service.js";
import { SkillAgentAccessService } from "./agent-access.service.js";

@Module({
  imports: [DatabaseModule, Folder9Module],
  controllers: [SkillsController, BotSkillsController],
  providers: [SkillsService, SkillAgentAccessService],
  exports: [SkillsService, SkillAgentAccessService],
})
export class SkillsModule {}
```

(Note: `BotSkillsController` is created in Task 4. If you implement out of order, comment out its line and add it in Task 4.)

- [ ] **Step 3: Write tests**

`apps/server/apps/gateway/src/skills/agent-access.service.spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { v7 as uuidv7 } from "uuid";
import { DATABASE_CONNECTION } from "@team9/database";
import * as schema from "@team9/database/schemas";
import { SkillAgentAccessService } from "./agent-access.service.js";
import { buildTestDb, seedTenant, seedUser } from "../../test-helpers/db.js"; // existing helper used elsewhere

describe("SkillAgentAccessService", () => {
  let service: SkillAgentAccessService;
  let db: ReturnType<typeof buildTestDb>;

  beforeAll(async () => {
    db = await buildTestDb();
    const moduleRef = await Test.createTestingModule({
      providers: [
        SkillAgentAccessService,
        { provide: DATABASE_CONNECTION, useValue: db },
      ],
    }).compile();
    service = moduleRef.get(SkillAgentAccessService);
  });

  it("returns the per-skill agentAccess for an existing skill in the tenant", async () => {
    const tenantId = await seedTenant(db);
    const userId = await seedUser(db, tenantId);
    const skillId = uuidv7();
    await db.insert(schema.skills).values({
      id: skillId,
      tenantId,
      name: "X",
      type: "general",
      creatorId: userId,
      agentAccess: "write",
      folderId: null,
    });
    expect(await service.resolve(skillId, "bot:123", tenantId)).toBe("write");
  });

  it('returns "none" for a missing skill', async () => {
    const tenantId = await seedTenant(db);
    expect(await service.resolve(uuidv7(), "bot:123", tenantId)).toBe("none");
  });

  it('returns "none" for a skill that belongs to a different tenant', async () => {
    const tenantA = await seedTenant(db);
    const tenantB = await seedTenant(db);
    const userId = await seedUser(db, tenantA);
    const skillId = uuidv7();
    await db.insert(schema.skills).values({
      id: skillId,
      tenantId: tenantA,
      name: "X",
      type: "general",
      creatorId: userId,
      agentAccess: "write",
      folderId: null,
    });
    expect(await service.resolve(skillId, "bot:123", tenantB)).toBe("none");
  });
});
```

(Adjust seed helpers to whatever the gateway's existing test harness provides — the existing `skills.service.spec.ts` is the reference.)

- [ ] **Step 4: Run tests**

```bash
pnpm --filter gateway test src/skills/agent-access.service.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/apps/gateway/src/skills/agent-access.service.ts \
        apps/server/apps/gateway/src/skills/agent-access.service.spec.ts \
        apps/server/apps/gateway/src/skills/skills.module.ts
git commit -m "feat(skills/access): add resolveSkillAgentAccess helper"
```

---

## Task 4: `BotSkillsController` — agent-facing `/v1/bot/skills`

**Goal:** Expose the four agent-facing endpoints (`list`, `getById`, `getFolderBlob`, `create`) under `/v1/bot/skills`, applying the `agentAccess !== 'none'` filter on every read and defaulting `agentAccess` to `'write'` on create.

**Files:**

- Create: `apps/server/apps/gateway/src/skills/bot-skills.controller.ts`
- Create: `apps/server/apps/gateway/src/skills/bot-skills.controller.spec.ts`
- Modify: `apps/server/apps/gateway/src/skills/skills.service.ts` (add `listForAgent`, `getByIdForAgent`, `getFolderBlobForAgent` methods that apply the filter — see step 1)
- Modify: `apps/server/apps/gateway/src/skills/skills.module.ts` (already done in Task 3 if `BotSkillsController` was uncommented)

**Acceptance Criteria:**

- [ ] `GET /v1/bot/skills` returns rows where `agentAccess !== 'none'` for the bot's tenant; supports `?type=` and `?name=` (substring match, case-insensitive) filters.
- [ ] `GET /v1/bot/skills/:id` returns 403 when `agentAccess === 'none'` (or 404 if cross-tenant).
- [ ] `GET /v1/bot/skills/:id/folder/blob?path=...` returns 403 when `agentAccess === 'none'`; otherwise returns the same `Folder9BlobResponse` shape as the user-facing route.
- [ ] `POST /v1/bot/skills` calls `SkillsService.create(..., { agentAccess: 'write' })` and returns the created skill.
- [ ] Bot-auth path mirrors `BotStaffProfileController`'s header pattern (`x-team9-bot-user-id`).

**Verify:** `pnpm --filter gateway test src/skills/bot-skills.controller.spec.ts`

**Steps:**

- [ ] **Step 1: Add agent-aware helpers to `SkillsService`**

Append to `skills.service.ts`:

```ts
async listForAgent(
  tenantId: string,
  filters: { type?: SkillType; name?: string } = {},
) {
  const conditions = [
    eq(schema.skills.tenantId, tenantId),
    ne(schema.skills.agentAccess, 'none'),
  ];
  if (filters.type) conditions.push(eq(schema.skills.type, filters.type));
  if (filters.name) {
    conditions.push(ilike(schema.skills.name, `%${filters.name}%`));
  }
  return this.db
    .select()
    .from(schema.skills)
    .where(and(...conditions))
    .orderBy(desc(schema.skills.createdAt));
}

async getByIdForAgent(skillId: string, tenantId: string) {
  const skill = await this.getSkillOrThrow(skillId, tenantId);
  if (skill.agentAccess === 'none') {
    throw new ForbiddenException('Skill is hidden from agents');
  }
  return skill;
}

async getFolderBlobForAgent(
  skillId: string,
  userId: string,
  tenantId: string,
  path: string,
) {
  const skill = await this.getSkillOrThrow(skillId, tenantId);
  if (skill.agentAccess === 'none') {
    throw new ForbiddenException('Skill is hidden from agents');
  }
  return this.getFolderBlobInternal(skill, userId, tenantId, path);
}
```

(Where `getFolderBlobInternal` is the body of the existing `getSkillFolderBlob` method, factored so both the user-facing and agent-facing paths share it. If you prefer minimal change, just call the existing `getSkillFolderBlob` after the access check.)

Add `ne`, `ilike`, `ForbiddenException` imports if not already present.

- [ ] **Step 2: Create the controller**

`apps/server/apps/gateway/src/skills/bot-skills.controller.ts`:

```ts
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard, CurrentUser } from "@team9/auth";
import type { SkillType } from "@team9/database/schemas";
import { CurrentTenantId } from "../common/decorators/current-tenant.decorator.js";
import { SkillsService } from "./skills.service.js";
import { CreateSkillDto } from "./dto/index.js";

@Controller({ path: "bot/skills", version: "1" })
@UseGuards(AuthGuard)
export class BotSkillsController {
  constructor(private readonly skillsService: SkillsService) {}

  @Get()
  async list(
    @CurrentUser("sub") authenticatedUserId: string,
    @Headers("x-team9-bot-user-id") headerBotUserId: string | undefined,
    @CurrentTenantId() tenantId: string,
    @Query("type") type?: SkillType,
    @Query("name") name?: string,
  ) {
    this.assertBot(headerBotUserId, authenticatedUserId);
    return this.skillsService.listForAgent(tenantId, { type, name });
  }

  @Get(":id")
  async getById(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser("sub") authenticatedUserId: string,
    @Headers("x-team9-bot-user-id") headerBotUserId: string | undefined,
    @CurrentTenantId() tenantId: string,
  ) {
    this.assertBot(headerBotUserId, authenticatedUserId);
    return this.skillsService.getByIdForAgent(id, tenantId);
  }

  @Get(":id/folder/blob")
  async getFolderBlob(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser("sub") authenticatedUserId: string,
    @Headers("x-team9-bot-user-id") headerBotUserId: string | undefined,
    @CurrentTenantId() tenantId: string,
    @Query("path") path: string,
  ) {
    this.assertBot(headerBotUserId, authenticatedUserId);
    if (!path) throw new BadRequestException("path query parameter required");
    return this.skillsService.getFolderBlobForAgent(
      id,
      authenticatedUserId,
      tenantId,
      path,
    );
  }

  @Post()
  async create(
    @Body() dto: CreateSkillDto,
    @CurrentUser("sub") authenticatedUserId: string,
    @Headers("x-team9-bot-user-id") headerBotUserId: string | undefined,
    @CurrentTenantId() tenantId: string,
  ) {
    this.assertBot(headerBotUserId, authenticatedUserId);
    return this.skillsService.create(dto, authenticatedUserId, tenantId, {
      agentAccess: "write",
    });
  }

  private assertBot(headerBotUserId: string | undefined, authUserId: string) {
    if (!headerBotUserId || headerBotUserId !== authUserId) {
      throw new ForbiddenException(
        "x-team9-bot-user-id must equal authenticated bot user id",
      );
    }
  }
}
```

- [ ] **Step 3: Write controller tests**

`apps/server/apps/gateway/src/skills/bot-skills.controller.spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { ForbiddenException } from "@nestjs/common";
import { BotSkillsController } from "./bot-skills.controller.js";
import { SkillsService } from "./skills.service.js";

describe("BotSkillsController", () => {
  let controller: BotSkillsController;
  let serviceMock: jest.Mocked<
    Pick<
      SkillsService,
      "listForAgent" | "getByIdForAgent" | "getFolderBlobForAgent" | "create"
    >
  >;

  const botId = "bot-uuid-1";
  const tenantId = "tenant-uuid-1";

  beforeEach(async () => {
    serviceMock = {
      listForAgent: jest.fn(),
      getByIdForAgent: jest.fn(),
      getFolderBlobForAgent: jest.fn(),
      create: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [BotSkillsController],
      providers: [{ provide: SkillsService, useValue: serviceMock }],
    }).compile();
    controller = moduleRef.get(BotSkillsController);
  });

  it("rejects when header bot id mismatches authenticated user", async () => {
    await expect(
      controller.list(botId, "other", tenantId),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("list passes type+name filters through to listForAgent", async () => {
    serviceMock.listForAgent.mockResolvedValue([]);
    await controller.list(botId, botId, tenantId, "general", "deploy");
    expect(serviceMock.listForAgent).toHaveBeenCalledWith(tenantId, {
      type: "general",
      name: "deploy",
    });
  });

  it("getFolderBlob requires path", async () => {
    await expect(
      controller.getFolderBlob("skill-id", botId, botId, tenantId, ""),
    ).rejects.toThrow(/path/);
  });

  it("create defaults agentAccess to write via service call", async () => {
    serviceMock.create.mockResolvedValue({ id: "s" } as never);
    await controller.create(
      { name: "X", type: "general" },
      botId,
      botId,
      tenantId,
    );
    expect(serviceMock.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "X" }),
      botId,
      tenantId,
      { agentAccess: "write" },
    );
  });

  it("getByIdForAgent forwards 403 from service when skill is hidden", async () => {
    serviceMock.getByIdForAgent.mockRejectedValue(
      new ForbiddenException("Skill is hidden from agents"),
    );
    await expect(
      controller.getById("skill-id", botId, botId, tenantId),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
```

Add a service-level integration test in `skills.service.spec.ts` that verifies `listForAgent` excludes `'none'` skills and supports `name` filtering.

- [ ] **Step 4: Wire into module**

If `skills.module.ts` was edited in Task 3 with the `BotSkillsController` already in the controllers list, no change is needed. Otherwise, add `BotSkillsController` to `controllers: [...]`.

- [ ] **Step 5: Run tests + typecheck**

```bash
pnpm --filter gateway test src/skills/bot-skills.controller.spec.ts
pnpm --filter gateway test src/skills/skills.service.spec.ts
pnpm --filter gateway typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/apps/gateway/src/skills/bot-skills.controller.ts \
        apps/server/apps/gateway/src/skills/bot-skills.controller.spec.ts \
        apps/server/apps/gateway/src/skills/skills.service.ts \
        apps/server/apps/gateway/src/skills/skills.service.spec.ts \
        apps/server/apps/gateway/src/skills/skills.module.ts
git commit -m "feat(skills/bot): add /v1/bot/skills controller with agentAccess filter"
```

---

## Task 5: `'workspace.skill'` logicalKey on `/v1/bot/folder-token`

**Goal:** Add the `'workspace.skill'` logicalKey to both the agent-pi types package and the gateway's folder-token service, applying the agentAccess matrix when minting tokens.

**Files:**

- Modify: `/Users/winrey/Projects/weightwave/team9-agent-pi/packages/claw-hive-types/src/just-bash-team9-workspace.ts` (add `'workspace.skill'` to `Team9LogicalMountKey`)
- Modify: `apps/server/apps/gateway/src/folder9/folder-token.service.ts`
- Modify: `apps/server/apps/gateway/src/folder9/folder-token.service.spec.ts`
- Modify: `apps/server/apps/gateway/src/folder9/folder9.module.ts` (import `SkillsModule` to inject `SkillAgentAccessService`)

**Acceptance Criteria:**

- [ ] `Team9LogicalMountKey` includes `'workspace.skill'` (claw-hive-types).
- [ ] Gateway's `KNOWN_LOGICAL_KEYS` includes `'workspace.skill'`.
- [ ] When `req.logicalKey === 'workspace.skill'`:
  - Verify `req.folderId` matches a `skills.folderId` row in `req.workspaceId`'s tenant; otherwise `ForbiddenException`.
  - Resolve `agentAccess` via `SkillAgentAccessService.resolve(skillId, callerBotUserId, workspaceId)`.
  - Apply matrix: `'none'` → 403; `'read'` + `permission='write'` → 403; otherwise mint a folder9 token at the requested permission.
  - Audit `scopeId` = the resolved `skillId`.
- [ ] Test matrix exhaustive: 7 cases (auto allow read, auto allow write, read+read, read+write deny, write+read, write+write, none deny, cross-tenant deny, unknown folder deny).

**Verify:** `pnpm --filter gateway test src/folder9/folder-token.service.spec.ts`

**Steps:**

- [ ] **Step 1: Extend `Team9LogicalMountKey` in claw-hive-types**

Edit `/Users/winrey/Projects/weightwave/team9-agent-pi/packages/claw-hive-types/src/just-bash-team9-workspace.ts`:

Locate the `Team9LogicalMountKey` union type (line ~4). Add `| 'workspace.skill'`:

```ts
export type Team9LogicalMountKey =
  | "session.tmp"
  | "session.home"
  | "agent.tmp"
  | "agent.home"
  | "routine.tmp"
  | "routine.home"
  | "routine.document"
  | "user.tmp"
  | "user.home"
  | "workspace.skill";
```

Build and publish a new version of `claw-hive-types` locally:

```bash
cd /Users/winrey/Projects/weightwave/team9-agent-pi
pnpm --filter @team9claw/claw-hive-types build
```

The team9 monorepo consumes this via workspace link in dev; in CI the gateway's package.json version pin needs bumping (handle in Task 11).

- [ ] **Step 2: Extend gateway folder-token service**

`apps/server/apps/gateway/src/folder9/folder-token.service.ts`:

Add `'workspace.skill'` to the `KNOWN_LOGICAL_KEYS` set:

```ts
const KNOWN_LOGICAL_KEYS = new Set([
  "session.tmp",
  "session.home",
  "agent.tmp",
  "agent.home",
  "routine.tmp",
  "routine.home",
  "routine.document",
  "user.tmp",
  "user.home",
  "workspace.skill",
]);
```

Inject `SkillAgentAccessService` via constructor and add a new `authorizeWorkspaceSkill` branch parallel to `authorizeRoutineDocument`:

```ts
constructor(
  @Inject(DATABASE_CONNECTION) private readonly db: PostgresJsDatabase<typeof schema>,
  private readonly folder9Client: Folder9ClientService,
  private readonly skillAccess: SkillAgentAccessService,   // NEW
) {}

// ... in the request handler, after the bot identity gate:

if (req.logicalKey === 'workspace.skill') {
  const skillId = await this.authorizeWorkspaceSkill(req, callerBotUserId);
  scopeId = skillId;
} else if (req.logicalKey === 'routine.document') {
  // existing branch
} else {
  scopeId = await this.authorizeNonDocumentLogicalKey(req, bot);
}

// ... new helper:

private async authorizeWorkspaceSkill(
  req: FolderTokenRequest,
  callerBotUserId: string,
): Promise<string> {
  // 1. folderId must point at a skill in the caller's tenant.
  const [row] = await this.db
    .select({ id: schema.skills.id })
    .from(schema.skills)
    .where(
      and(
        eq(schema.skills.folderId, req.folderId),
        eq(schema.skills.tenantId, req.workspaceId),
      ),
    )
    .limit(1);
  if (!row) {
    throw new ForbiddenException(
      `Folder ${req.folderId} is not a skill in workspace ${req.workspaceId}`,
    );
  }

  // 2. Apply per-skill agentAccess matrix.
  const access = await this.skillAccess.resolve(
    row.id,
    callerBotUserId,
    req.workspaceId,
  );
  if (access === 'none') {
    throw new ForbiddenException('Skill is hidden from this agent');
  }
  if (access === 'read' && req.permission === 'write') {
    throw new ForbiddenException(
      'Skill is read-only for this agent; cannot mint a write token',
    );
  }
  if (req.permission === 'propose' || req.permission === 'admin') {
    throw new ForbiddenException(
      `permission=${req.permission} is not supported for workspace.skill in v1`,
    );
  }

  return row.id;
}
```

- [ ] **Step 3: Module wiring**

`apps/server/apps/gateway/src/folder9/folder9.module.ts` — import `SkillsModule` so `SkillAgentAccessService` resolves:

```ts
@Module({
  imports: [DatabaseModule, SkillsModule],
  // ...
})
export class Folder9Module {}
```

If this introduces a circular dep (Folder9 ← Skills ← Folder9), break it by extracting `SkillAgentAccessService` into its own thin `SkillAccessModule` that depends only on `DatabaseModule` and is imported by both `SkillsModule` and `Folder9Module`. Adjust Task 3's wiring accordingly.

- [ ] **Step 4: Tests — full matrix**

Append to `folder-token.service.spec.ts`:

```ts
describe("workspace.skill logicalKey", () => {
  const buildReq = (
    overrides: Partial<FolderTokenRequest> = {},
  ): FolderTokenRequest => ({
    sessionId: "sess",
    agentId: "agent",
    userId: "user",
    workspaceId: "tenant-A",
    folderId: "folder-A",
    folderType: "light",
    logicalKey: "workspace.skill",
    permission: "read",
    ...overrides,
  });

  it("mints a read token when agentAccess=read and permission=read", async () => {
    seedSkill({
      id: "skill-1",
      tenantId: "tenant-A",
      folderId: "folder-A",
      agentAccess: "read",
    });
    const res = await service.issueToken(
      "bot-A",
      buildReq({ permission: "read" }),
    );
    expect(res.token).toBeTruthy();
  });

  it("mints a write token when agentAccess=write and permission=write", async () => {
    seedSkill({
      id: "skill-2",
      tenantId: "tenant-A",
      folderId: "folder-B",
      agentAccess: "write",
    });
    const res = await service.issueToken(
      "bot-A",
      buildReq({
        folderId: "folder-B",
        permission: "write",
      }),
    );
    expect(res.token).toBeTruthy();
  });

  it("denies write when agentAccess=read", async () => {
    seedSkill({
      id: "skill-3",
      tenantId: "tenant-A",
      folderId: "folder-C",
      agentAccess: "read",
    });
    await expect(
      service.issueToken(
        "bot-A",
        buildReq({ folderId: "folder-C", permission: "write" }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("denies any permission when agentAccess=none", async () => {
    seedSkill({
      id: "skill-4",
      tenantId: "tenant-A",
      folderId: "folder-D",
      agentAccess: "none",
    });
    await expect(
      service.issueToken(
        "bot-A",
        buildReq({ folderId: "folder-D", permission: "read" }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.issueToken(
        "bot-A",
        buildReq({ folderId: "folder-D", permission: "write" }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("denies cross-tenant", async () => {
    seedSkill({
      id: "skill-5",
      tenantId: "tenant-B",
      folderId: "folder-E",
      agentAccess: "write",
    });
    await expect(
      service.issueToken(
        "bot-A",
        buildReq({ folderId: "folder-E", permission: "read" }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("denies unknown folderId", async () => {
    await expect(
      service.issueToken("bot-A", buildReq({ folderId: "no-such-folder" })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects propose / admin permissions for workspace.skill in v1", async () => {
    seedSkill({
      id: "skill-6",
      tenantId: "tenant-A",
      folderId: "folder-F",
      agentAccess: "write",
    });
    await expect(
      service.issueToken(
        "bot-A",
        buildReq({
          folderId: "folder-F",
          permission: "propose" as never,
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
```

(Adjust `seedSkill` / `service.issueToken` shape to whatever the existing spec uses; the existing spec is the reference.)

- [ ] **Step 5: Run tests + typecheck**

```bash
pnpm --filter gateway test src/folder9/folder-token.service.spec.ts
pnpm --filter gateway typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit (gateway)**

```bash
git add apps/server/apps/gateway/src/folder9/folder-token.service.ts \
        apps/server/apps/gateway/src/folder9/folder-token.service.spec.ts \
        apps/server/apps/gateway/src/folder9/folder9.module.ts
git commit -m "feat(folder9/token): add workspace.skill logicalKey with agentAccess matrix"
```

In the agent-pi repo:

```bash
cd /Users/winrey/Projects/weightwave/team9-agent-pi
git add packages/claw-hive-types/src/just-bash-team9-workspace.ts
git commit -m "feat(types): add workspace.skill to Team9LogicalMountKey"
```

---

## Task 6: SkillTier API — `unregisterProvider` + `removeByProviderId`

**Goal:** Close the API gap on `SkillTierDependencyApi` so providers can be unregistered cleanly. `WorkspaceSkillsProvider` itself does not need this for its own lifetime, but the gap should be closed for completeness.

**Repo:** team9-agent-pi

**Files:**

- Modify: `packages/agent-components/src/components/skill/skill-component.ts`
- Modify: `packages/agent-components/src/components/skill/skill-component.test.ts`
- Modify: `packages/agent-components/src/resource-tier/resource-tier-manager.ts`
- Modify: `packages/agent-components/src/resource-tier/resource-tier-manager.test.ts`

**Acceptance Criteria:**

- [ ] `SkillTierDependencyApi` exposes `unregisterProvider(providerId: string): void`.
- [ ] `ResourceTierManager` exposes `removeByProviderId(providerId: string): void`.
- [ ] Unregistering a provider removes its skills from the tier manager and clears its entries from `ctx.data.skillStates`.
- [ ] Calling `unregisterProvider` with an unknown id is a no-op (does not throw).
- [ ] All existing skill-component tests still pass.

**Verify:** `pnpm --filter @team9claw/agent-components test src/components/skill/skill-component.test.ts src/resource-tier/resource-tier-manager.test.ts`

**Steps:**

- [ ] **Step 1: Add `removeByProviderId` to `ResourceTierManager`**

In `packages/agent-components/src/resource-tier/resource-tier-manager.ts`, append a method:

```ts
/**
 * Remove every resource owned by `providerId` from all tiers + state.
 * No-op when no resources match. Used when a provider is unregistered
 * mid-session so dangling references do not survive in persisted state.
 */
removeByProviderId(providerId: string): void {
  const toRemove: string[] = [];
  for (const [name, state] of this.states.entries()) {
    if (state.providerId === providerId) {
      toRemove.push(name);
    }
  }
  for (const name of toRemove) {
    this.states.delete(name);
  }
}
```

(Field/method names may differ slightly — `this.states` is the Map of `name → PersistedResourceState`. If the field is private and named differently in the actual file, adapt accordingly. The contract is what matters.)

Add a unit test:

```ts
it("removeByProviderId drops only resources owned by that provider", () => {
  const mgr = new ResourceTierManager<TieredSkill>({
    tierSet: ["summarized", "listed", "dormant"],
  });
  mgr.upsert({ name: "a", providerId: "p1" /* ... */ } as never);
  mgr.upsert({ name: "b", providerId: "p2" /* ... */ } as never);
  mgr.removeByProviderId("p1");
  expect(mgr.snapshot()["a"]).toBeUndefined();
  expect(mgr.snapshot()["b"]).toBeDefined();
});

it("removeByProviderId is a no-op for unknown id", () => {
  const mgr = new ResourceTierManager<TieredSkill>({
    tierSet: ["summarized", "listed", "dormant"],
  });
  expect(() => mgr.removeByProviderId("nonexistent")).not.toThrow();
});
```

- [ ] **Step 2: Add `unregisterProvider` to the dependency API**

In `packages/agent-components/src/components/skill/skill-component.ts`:

```ts
export interface SkillTierDependencyApi {
  readonly tierManager: ResourceTierManager<TieredSkill>;
  registerProvider(provider: ISkillProvider): void;
  unregisterProvider(providerId: string): void;
}
```

In `getDependencyApi`:

```ts
return {
  tierManager: this.tierManager,
  registerProvider: (provider: ISkillProvider) => {
    this.providers.set(provider.id, provider);
  },
  unregisterProvider: (providerId: string) => {
    if (!this.providers.delete(providerId)) {
      // No-op for unknown id.
      return;
    }
    this.tierManager.removeByProviderId(providerId);
    if (ctx.data.skillStates) {
      // Persist-state cleanup: scan and prune.
      for (const [name, state] of Object.entries(ctx.data.skillStates)) {
        if (state.providerId === providerId) {
          delete ctx.data.skillStates[name];
        }
      }
    }
  },
};
```

(`PersistedResourceState` already carries `providerId`; if not, add it — every state is owned by exactly one provider.)

- [ ] **Step 3: Add SkillComponent tests**

```ts
describe("unregisterProvider", () => {
  it("removes the provider and its skills from the tier manager", async () => {
    const provider = makeMockProvider("p1", [
      /* fixtures */
    ]);
    const ctx = makeCtx();
    component.getDependencyApi(ctx).registerProvider(provider);
    // populate tier
    await component.tools.search_skills({ query: "..." }, ctx);

    component.getDependencyApi(ctx).unregisterProvider("p1");

    expect((component as any).providers.get("p1")).toBeUndefined();
    expect(component.tierManager.snapshot()).toEqual({});
  });

  it("clears persisted skillStates owned by the unregistered provider", async () => {
    const provider = makeMockProvider("p1" /* ... */);
    const ctx = makeCtx({
      data: {
        skillStates: {
          "p1::s1": { providerId: "p1", tier: "listed" } as never,
        },
      },
    });
    component.getDependencyApi(ctx).registerProvider(provider);
    component.getDependencyApi(ctx).unregisterProvider("p1");
    expect(ctx.data.skillStates?.["p1::s1"]).toBeUndefined();
  });

  it("is a no-op for unknown providerId", () => {
    const ctx = makeCtx();
    expect(() =>
      component.getDependencyApi(ctx).unregisterProvider("nope"),
    ).not.toThrow();
  });
});
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/winrey/Projects/weightwave/team9-agent-pi
pnpm --filter @team9claw/agent-components test
pnpm --filter @team9claw/agent-components typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-components/src/components/skill/skill-component.ts \
        packages/agent-components/src/components/skill/skill-component.test.ts \
        packages/agent-components/src/resource-tier/resource-tier-manager.ts \
        packages/agent-components/src/resource-tier/resource-tier-manager.test.ts
git commit -m "feat(skill-tier): add unregisterProvider + ResourceTierManager.removeByProviderId"
```

---

## Task 7: TieredSkill / SkillProviderSearchResult source + agentAccess

**Goal:** Add optional `source` and `agentAccess` fields to the TieredSkill / SkillProviderSearchResult shapes so providers can label every skill, and update the skill-tier XML renderer to emit them as attributes.

**Repo:** team9-agent-pi

**Files:**

- Modify: `packages/types/src/skill.ts`
- Modify: `packages/agent-components/src/components/skill/skill-tier-xml.ts`
- Modify: `packages/agent-components/src/components/skill/skill-tier-xml.test.ts`
- Modify: `packages/agent-components/src/components/skill/mounted-folder-provider.ts`
- Modify: `packages/agent-components/src/components/skill/memory-skill-provider.ts`
- Modify: `packages/agent-components/src/components/skill/register-source-code-skills.ts`

**Acceptance Criteria:**

- [ ] `TieredSkill` has optional `source?: 'bundled' | 'workspace'` and `agentAccess?: 'read' | 'write'` fields.
- [ ] `SkillProviderSearchResult` has the same optional fields.
- [ ] `renderSkillTierXml` emits `source` and `agent-access` attributes (kebab-case to match XML conventions in this codebase) on every `<skill>` element when present; absent attributes when fields are undefined.
- [ ] All bundled providers (`MountedFolderSkillProvider`, `MemorySkillProvider`, source-code register helper) tag returned skills/results with `source: 'bundled'` (and no `agentAccess`, which the renderer treats as read-only by default).

**Verify:** `pnpm --filter @team9claw/agent-components test src/components/skill/skill-tier-xml.test.ts`

**Steps:**

- [ ] **Step 1: Extend types**

`packages/types/src/skill.ts`:

```ts
/** Where this skill comes from. Surfaced to the LLM so it knows whether
 *  it can request a writable mount. */
export type SkillSource = "bundled" | "workspace";

export interface TieredSkill extends TieredResource {
  description: string;
  whenToUse?: string;
  allowedTools?: string[];
  arguments?: string[];
  context?: "inline" | "fork";
  agent?: string;
  /** Origin label rendered into the system prompt. */
  source?: SkillSource;
  /** For workspace skills only — agent's effective access on this skill. */
  agentAccess?: "read" | "write";
  getPrompt(args: string, ctx: SkillContext): Promise<string>;
}

export interface SkillProviderSearchResult extends ResourceDescriptor {
  whenToUse?: string;
  source?: SkillSource;
  agentAccess?: "read" | "write";
}
```

- [ ] **Step 2: Update XML renderer**

`packages/agent-components/src/components/skill/skill-tier-xml.ts`:

```ts
import type { TieredSkill } from "@team9claw/types";
import { renderResourceTierXml } from "../../resource-tier/resource-tier-xml.js";
import { escapeXml } from "@team9claw/types";

export function renderSkillTierXml(
  summarized: TieredSkill[],
  listed: TieredSkill[],
  dormantCount: number,
): string {
  return renderResourceTierXml(summarized, listed, dormantCount, {
    rootTag: "available-skills",
    itemTag: "skill",
    hint: "Use search_skills to find skills, invoke_skill to use them.",
    renderExtraAttrs: (r) => {
      const skill = r as TieredSkill;
      const attrs: string[] = [];
      if (skill.whenToUse) {
        attrs.push(`when-to-use="${escapeXml(skill.whenToUse)}"`);
      }
      if (skill.source) {
        attrs.push(`source="${escapeXml(skill.source)}"`);
      }
      if (skill.agentAccess) {
        attrs.push(`agent-access="${escapeXml(skill.agentAccess)}"`);
      }
      return attrs.join(" ");
    },
  });
}
```

- [ ] **Step 3: Update XML renderer test**

Append to `skill-tier-xml.test.ts`:

```ts
it("renders source and agent-access attributes when set", () => {
  const skill: TieredSkill = {
    name: "s1",
    tier: "listed",
    description: "d",
    source: "workspace",
    agentAccess: "write",
    getPrompt: async () => "",
  } as never;
  const xml = renderSkillTierXml([], [skill], 0);
  expect(xml).toContain('source="workspace"');
  expect(xml).toContain('agent-access="write"');
});

it("omits source/agent-access attributes when undefined", () => {
  const skill: TieredSkill = {
    name: "s1",
    tier: "listed",
    description: "d",
    getPrompt: async () => "",
  } as never;
  const xml = renderSkillTierXml([], [skill], 0);
  expect(xml).not.toContain("source=");
  expect(xml).not.toContain("agent-access=");
});

it("renders bundled source when provider sets it", () => {
  const skill: TieredSkill = {
    name: "b1",
    tier: "listed",
    description: "d",
    source: "bundled",
    getPrompt: async () => "",
  } as never;
  const xml = renderSkillTierXml([], [skill], 0);
  expect(xml).toContain('source="bundled"');
});
```

- [ ] **Step 4: Tag bundled providers with `source: 'bundled'`**

In each of `mounted-folder-provider.ts`, `memory-skill-provider.ts`, `register-source-code-skills.ts`, find where the provider builds its `TieredSkill` / `SkillProviderSearchResult` objects and add `source: 'bundled'`. For `MountedFolderSkillProvider`, the change is inside `resolve()` after gray-matter parse:

```ts
const skill: TieredSkill = {
  name: parsed.name,
  description: parsed.description,
  whenToUse: parsed.whenToUse,
  source: "bundled", // NEW
  // ...rest unchanged
};
```

For `search()`:

```ts
const result: SkillProviderSearchResult = {
  name: parsed.name,
  description: parsed.description,
  whenToUse: parsed.whenToUse,
  source: "bundled", // NEW
};
```

Apply the same change in `MemorySkillProvider` and `register-source-code-skills`. No `agentAccess` is set on bundled — undefined means "read-only by default" per the system prompt block (Task 9).

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @team9claw/types build
pnpm --filter @team9claw/agent-components test
pnpm --filter @team9claw/agent-components typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/types/src/skill.ts \
        packages/agent-components/src/components/skill/
git commit -m "feat(skill-tier): add source + agentAccess attributes for LLM context"
```

---

## Task 8: `WorkspaceSkillsProvider`

**Goal:** Implement the new `ISkillProvider` that bridges the workspace skill library into the agent's skill-tier. Search → gateway list endpoint; resolve → gateway blob endpoint, parsed via gray-matter.

**Repo:** team9-agent-pi

**Files:**

- Create: `packages/agent-components/src/components/skill/workspace-skills-provider.ts`
- Create: `packages/agent-components/src/components/skill/workspace-skills-provider.test.ts`
- Modify: `packages/agent-components/src/components/skill/index.ts` (re-export)

**Acceptance Criteria:**

- [ ] Provider id is stable per session, e.g. `workspace-skills:<tenantId>`.
- [ ] `search(query)` calls the configured `httpClient.get('/v1/bot/skills', { params })` and returns `SkillProviderSearchResult[]` tagged with `source: 'workspace'` and the row's `agentAccess` (`'read'` | `'write'`).
- [ ] `resolve(name)` finds the matching row (by exact name match within tenant) via the same list call (or a cached map populated by prior `search()`), then fetches `skill.md` via `GET /v1/bot/skills/:id/folder/blob?path=skill.md`, parses frontmatter, returns `TieredSkill` tagged with `source: 'workspace'` + `agentAccess`.
- [ ] Defensive filter: if the gateway ever returns a row with `agentAccess: 'none'`, drop it. (The gateway already filters; this is a belt-and-suspenders.)
- [ ] Errors (404, malformed YAML, missing required frontmatter, name mismatch) log via `console.warn` and return `null` / `[]` — never throw out of `search()` / `resolve()`. Same convention as `MountedFolderSkillProvider`.
- [ ] HTTP client is injected — the provider does not pick a transport.

**Verify:** `pnpm --filter @team9claw/agent-components test src/components/skill/workspace-skills-provider.test.ts`

**Steps:**

- [ ] **Step 1: Define the provider**

`packages/agent-components/src/components/skill/workspace-skills-provider.ts`:

```ts
/**
 * WorkspaceSkillsProvider — surface tenant-owned skills from the team9
 * gateway into the agent's skill-tier.
 *
 * Lifecycle: registered once per session by Team9SkillsComponent.
 * Works against the bot-namespace gateway endpoints:
 *   GET  /v1/bot/skills                          (list / search)
 *   GET  /v1/bot/skills/:id                      (metadata)
 *   GET  /v1/bot/skills/:id/folder/blob?path=skill.md  (content)
 *
 * Output skills carry `source: 'workspace'` and the row's `agentAccess`
 * so the LLM (via skill-tier-xml) sees what it can do with each skill
 * without a round-trip.
 *
 * Errors (HTTP failures, malformed frontmatter) log + degrade to null/empty;
 * never thrown out of search()/resolve(). Matches MountedFolderSkillProvider's
 * contract.
 */

import matter from "gray-matter";
import type {
  ISkillProvider,
  SkillProviderSearchResult,
  TieredSkill,
  SkillContext,
} from "@team9claw/types";

export interface WorkspaceSkillRow {
  id: string;
  name: string;
  description: string | null;
  agentAccess: "read" | "write"; // 'none' is filtered by the gateway
}

export interface WorkspaceSkillsHttpClient {
  listSkills(params?: {
    type?: string;
    name?: string;
  }): Promise<WorkspaceSkillRow[]>;
  getSkillMd(skillId: string): Promise<string>;
}

export interface WorkspaceSkillsProviderOptions {
  tenantId: string;
  http: WorkspaceSkillsHttpClient;
}

export class WorkspaceSkillsProvider implements ISkillProvider {
  readonly id: string;
  private cache = new Map<string, WorkspaceSkillRow>();

  constructor(private readonly opts: WorkspaceSkillsProviderOptions) {
    this.id = `workspace-skills:${opts.tenantId}`;
  }

  async search(query: string): Promise<SkillProviderSearchResult[]> {
    let rows: WorkspaceSkillRow[];
    try {
      rows = await this.opts.http.listSkills({ name: query || undefined });
    } catch (err) {
      console.warn(
        `[WorkspaceSkillsProvider] list failed: ${(err as Error).message}`,
      );
      return [];
    }

    this.cache.clear();
    const out: SkillProviderSearchResult[] = [];
    for (const row of rows) {
      // Defensive: gateway filters 'none', but never trust the wire.
      if ((row.agentAccess as string) === "none") continue;
      this.cache.set(row.name, row);
      out.push({
        name: row.name,
        description: row.description ?? "",
        source: "workspace",
        agentAccess: row.agentAccess,
      });
    }
    return out;
  }

  async resolve(name: string): Promise<TieredSkill | null> {
    let row = this.cache.get(name);
    if (!row) {
      try {
        const rows = await this.opts.http.listSkills({ name });
        row = rows.find((r) => r.name === name);
      } catch (err) {
        console.warn(
          `[WorkspaceSkillsProvider] list-for-resolve failed: ${(err as Error).message}`,
        );
        return null;
      }
    }
    if (!row || (row.agentAccess as string) === "none") return null;
    this.cache.set(row.name, row);

    let raw: string;
    try {
      raw = await this.opts.http.getSkillMd(row.id);
    } catch (err) {
      console.warn(
        `[WorkspaceSkillsProvider] getSkillMd(${row.id}) failed: ${(err as Error).message}`,
      );
      return null;
    }

    let parsed: ReturnType<typeof matter>;
    try {
      parsed = matter(raw);
    } catch (err) {
      console.warn(
        `[WorkspaceSkillsProvider] gray-matter parse failed for ${row.id}: ${(err as Error).message}`,
      );
      return null;
    }

    const fm = parsed.data ?? {};
    if (typeof fm.name !== "string" || fm.name !== row.name) {
      console.warn(
        `[WorkspaceSkillsProvider] frontmatter name mismatch: db=${row.name} fm=${String(fm.name)}`,
      );
      return null;
    }

    return {
      name: row.name,
      tier: "dormant",
      summary: fm.description ?? row.description ?? "",
      description: fm.description ?? row.description ?? "",
      whenToUse: typeof fm.whenToUse === "string" ? fm.whenToUse : undefined,
      allowedTools: Array.isArray(fm.allowedTools)
        ? fm.allowedTools
        : undefined,
      arguments: Array.isArray(fm.arguments) ? fm.arguments : undefined,
      context: fm.context === "fork" ? "fork" : "inline",
      agent: typeof fm.agent === "string" ? fm.agent : undefined,
      source: "workspace",
      agentAccess: row.agentAccess,
      getPrompt: async (_args: string, _ctx: SkillContext) => parsed.content,
    };
  }
}
```

(Adjust `tier`, `summary` shape if `TieredResource` requires different fields — check the existing `MountedFolderSkillProvider` for the exact required-field set.)

- [ ] **Step 2: Re-export**

`packages/agent-components/src/components/skill/index.ts`:

```ts
export { WorkspaceSkillsProvider } from "./workspace-skills-provider.js";
export type {
  WorkspaceSkillRow,
  WorkspaceSkillsHttpClient,
  WorkspaceSkillsProviderOptions,
} from "./workspace-skills-provider.js";
```

- [ ] **Step 3: Tests**

`packages/agent-components/src/components/skill/workspace-skills-provider.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { WorkspaceSkillsProvider } from "./workspace-skills-provider.js";

const goodMd = `---
name: deploy
description: Deploy something
whenToUse: When deploying
---

Run \`make deploy\`.
`;

function makeProvider(rows: any[], blobs: Record<string, string> = {}) {
  return new WorkspaceSkillsProvider({
    tenantId: "t1",
    http: {
      listSkills: vi.fn(async () => rows),
      getSkillMd: vi.fn(async (id: string) => {
        if (blobs[id] === undefined) throw new Error("not found");
        return blobs[id];
      }),
    },
  });
}

describe("WorkspaceSkillsProvider", () => {
  it("search tags results with source=workspace and agentAccess", async () => {
    const p = makeProvider([
      { id: "s1", name: "deploy", description: "d", agentAccess: "write" },
      { id: "s2", name: "lint", description: null, agentAccess: "read" },
    ]);
    const out = await p.search("");
    expect(out).toEqual([
      {
        name: "deploy",
        description: "d",
        source: "workspace",
        agentAccess: "write",
      },
      {
        name: "lint",
        description: "",
        source: "workspace",
        agentAccess: "read",
      },
    ]);
  });

  it("search filters out rows with agentAccess=none defensively", async () => {
    const p = makeProvider([
      { id: "s1", name: "a", agentAccess: "read" },
      { id: "s2", name: "b", agentAccess: "none" },
    ]);
    const out = await p.search("");
    expect(out.map((r) => r.name)).toEqual(["a"]);
  });

  it("search returns [] on HTTP failure (warns instead of throwing)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const p = new WorkspaceSkillsProvider({
      tenantId: "t1",
      http: {
        listSkills: vi.fn(async () => {
          throw new Error("boom");
        }),
        getSkillMd: vi.fn(),
      },
    });
    expect(await p.search("x")).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("resolve fetches blob, parses frontmatter, returns TieredSkill", async () => {
    const p = makeProvider(
      [{ id: "s1", name: "deploy", description: "d", agentAccess: "write" }],
      { s1: goodMd },
    );
    await p.search(""); // populate cache
    const skill = await p.resolve("deploy");
    expect(skill?.name).toBe("deploy");
    expect(skill?.source).toBe("workspace");
    expect(skill?.agentAccess).toBe("write");
    expect(await skill?.getPrompt("", {} as never)).toContain("make deploy");
  });

  it("resolve returns null on frontmatter name mismatch", async () => {
    const p = makeProvider(
      [{ id: "s1", name: "deploy", agentAccess: "read" }],
      { s1: "---\nname: WRONG\n---\nbody" },
    );
    expect(await p.resolve("deploy")).toBeNull();
  });

  it("resolve returns null on malformed YAML", async () => {
    const p = makeProvider(
      [{ id: "s1", name: "deploy", agentAccess: "read" }],
      { s1: "---\nname: [unterminated\n---\nbody" },
    );
    expect(await p.resolve("deploy")).toBeNull();
  });

  it("resolve returns null when blob fetch fails", async () => {
    const p = makeProvider(
      [{ id: "s1", name: "deploy", agentAccess: "read" }],
      {
        /* no blob */
      },
    );
    expect(await p.resolve("deploy")).toBeNull();
  });

  it("resolve looks up via list when cache miss", async () => {
    const p = makeProvider(
      [{ id: "s1", name: "deploy", agentAccess: "read" }],
      { s1: goodMd },
    );
    // skip search() — go straight to resolve
    const skill = await p.resolve("deploy");
    expect(skill?.name).toBe("deploy");
  });
});
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @team9claw/agent-components test src/components/skill/workspace-skills-provider.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-components/src/components/skill/workspace-skills-provider.ts \
        packages/agent-components/src/components/skill/workspace-skills-provider.test.ts \
        packages/agent-components/src/components/skill/index.ts
git commit -m "feat(skill-tier): add WorkspaceSkillsProvider for tenant skills via gateway"
```

---

## Task 9: `Team9SkillsComponent` + 2 tools + system-prompt guidance block

**Goal:** Add the new `team9-skills` component that owns provider registration, exposes `create_workspace_skill` and `mount_workspace_skill` LLM tools, and injects the static permission-guidance block into the system prompt.

**Repo:** team9-agent-pi

**Files:**

- Create: `packages/claw-hive/src/components/team9-skills/component.ts`
- Create: `packages/claw-hive/src/components/team9-skills/component.test.ts`
- Create: `packages/claw-hive/src/components/team9-skills/team9-skills-prompt.ts`
- Create: `packages/claw-hive/src/components/team9-skills/team9-skills-prompt.test.ts`
- Create: `packages/claw-hive/src/components/team9-skills/tools/create-workspace-skill.ts`
- Create: `packages/claw-hive/src/components/team9-skills/tools/mount-workspace-skill.ts`
- Create: `packages/claw-hive/src/components/team9-skills/tools/__tests__/create-workspace-skill.test.ts`
- Create: `packages/claw-hive/src/components/team9-skills/tools/__tests__/mount-workspace-skill.test.ts`
- Create: `packages/claw-hive/src/components/team9-skills/index.ts`

**Acceptance Criteria:**

- [ ] `Team9SkillsComponent` typeKey: `team9-skills`. Hard dependencies: `['team9', 'folder9', 'host', 'skill-tier']`. Priority: similar to `team9-routine-creation` (~5).
- [ ] On `onSessionStart`, the component instantiates `WorkspaceSkillsProvider` and calls `skillTier.registerProvider(provider)`. The HTTP client is built from the Team9 backend client + bot user header.
- [ ] On `onBeforePrompt`, the component returns `contextInjection` containing the static guidance block (see step 1 for exact text).
- [ ] Tool `create_workspace_skill { name, description?, type?, icon?, autoMount? }` calls the Team9 backend's `POST /v1/bot/skills`. Returns `{ skillId, folderId, mountPath? }`. If `autoMount === true`, chains an internal `mount_workspace_skill` invocation with `permission: 'write'`.
- [ ] Tool `mount_workspace_skill { skillId, permission: 'read' | 'write', mountPath? }` calls `Team9FolderTokenApi.issueFolderToken({ logicalKey: 'workspace.skill', folderId, permission, ... })` then `Folder9DependencyApi.applyMount({ externallyManagedToken: true, mountPath, token, folderId, permission })`. On token denial (403), surfaces a structured ToolResult with `is_error: true` and a body that names the policy reason ("skill is hidden from agents", "skill is read-only for agents") so the LLM can recover.
- [ ] On `onDispose`, the component calls `skillTier.unregisterProvider(provider.id)`.

**Verify:** `pnpm --filter @team9claw/claw-hive test src/components/team9-skills/`

**Steps:**

- [ ] **Step 1: Static guidance block**

`packages/claw-hive/src/components/team9-skills/team9-skills-prompt.ts`:

```ts
/**
 * Static block injected into the system prompt by Team9SkillsComponent.
 * Explains skill source + permission semantics and the recovery paths
 * the agent should follow when it hits a permission boundary.
 *
 * Keep this file short — when the user adds new permission states or
 * tools, the wording here must stay in sync with the access matrix
 * in skills/agent-access.service.ts (gateway).
 */
export const TEAM9_SKILLS_GUIDANCE = `\
<team9_skills_guidance>
Each skill in <available-skills> carries source and (for workspace
skills) agent-access attributes. Use them to decide what you can do:

- source="bundled" — system skill, **read-only and immutable**.
  You cannot modify these. If the user asks you to change a bundled
  skill, explain that it is system-owned and either (a) suggest copying
  its content into a new workspace skill (use create_workspace_skill)
  that you can edit, or (b) tell the user to take it up with the system
  maintainers.

- source="workspace" agent-access="read" — workspace skill, you can
  read it (load_skills, invoke_skill, mount_workspace_skill with
  permission="read"). You **cannot** mount with permission="write" —
  the gateway will deny it. If the user asks you to modify a read-only
  workspace skill, tell them to bump the skill's agent permission to
  "Read & write" on the skill detail page (or to perform the edit
  themselves via the UI).

- source="workspace" agent-access="write" — workspace skill, you can
  read and edit it freely. mount_workspace_skill with permission="write"
  will succeed; commits go straight to HEAD.

If the user references a skill by name and search_skills cannot find
it, the skill may be hidden from agents (agent-access="none" — never
returned to you). Tell the user, and ask them to grant access on the
skill's detail page rather than guessing or giving up.
</team9_skills_guidance>`;
```

Test:

```ts
import { describe, it, expect } from "vitest";
import { TEAM9_SKILLS_GUIDANCE } from "./team9-skills-prompt.js";

describe("TEAM9_SKILLS_GUIDANCE", () => {
  it("mentions all three recovery paths", () => {
    expect(TEAM9_SKILLS_GUIDANCE).toMatch(/bundled/);
    expect(TEAM9_SKILLS_GUIDANCE).toMatch(/copying/);
    expect(TEAM9_SKILLS_GUIDANCE).toMatch(/bump.*permission/);
    expect(TEAM9_SKILLS_GUIDANCE).toMatch(/hidden.*agent/i);
  });
  it("starts and ends with the guidance tag", () => {
    expect(TEAM9_SKILLS_GUIDANCE).toMatch(/^<team9_skills_guidance>/);
    expect(TEAM9_SKILLS_GUIDANCE.trim()).toMatch(/<\/team9_skills_guidance>$/);
  });
});
```

- [ ] **Step 2: `mount_workspace_skill` tool**

`packages/claw-hive/src/components/team9-skills/tools/mount-workspace-skill.ts`:

```ts
import type { AgentTool, ToolResult } from "@team9claw/types";
import type {
  Team9FolderTokenApi,
  Folder9DependencyApi,
} from "@team9claw/claw-hive-types";
import { Team9FolderTokenIssuanceError } from "@team9claw/claw-hive-types";

interface Args {
  skillId: string;
  permission: "read" | "write";
  mountPath?: string;
}

export interface MountWorkspaceSkillDeps {
  getTokenApi: () => Team9FolderTokenApi | undefined;
  getFolder9Api: () => Folder9DependencyApi | undefined;
  /** Resolve folderId from skillId via the bot HTTP client. */
  resolveSkillFolderId: (skillId: string) => Promise<string>;
  getSessionContext: () => {
    sessionId: string;
    agentId?: string;
    routineId?: string;
    userId?: string;
    workspaceId: string;
  };
}

export function createMountWorkspaceSkillTool(
  deps: MountWorkspaceSkillDeps,
): AgentTool {
  return {
    name: "mount_workspace_skill",
    description:
      "Mount a workspace skill folder into the bash filesystem so you can read or edit its files. " +
      "Requires agent-access permission on the skill (search_skills shows the level).",
    parameters: {
      type: "object",
      required: ["skillId", "permission"],
      properties: {
        skillId: { type: "string" },
        permission: { type: "string", enum: ["read", "write"] },
        mountPath: {
          type: "string",
          description: "Default: /workspace/skill/<skillId>/",
        },
      },
    },
    async execute({ args }: { args: Args }): Promise<ToolResult> {
      const tokenApi = deps.getTokenApi();
      const folder9Api = deps.getFolder9Api();
      if (!tokenApi || !folder9Api) {
        return {
          is_error: true,
          content:
            "Required dependencies missing (team9-folder-token / folder9).",
        };
      }

      let folderId: string;
      try {
        folderId = await deps.resolveSkillFolderId(args.skillId);
      } catch (err) {
        return {
          is_error: true,
          content: `Could not resolve folder for skill ${args.skillId}: ${(err as Error).message}`,
        };
      }

      const ctx = deps.getSessionContext();
      let token: { token: string; expiresAt?: number };
      try {
        token = await tokenApi.issueFolderToken({
          sessionId: ctx.sessionId,
          agentId: ctx.agentId,
          routineId: ctx.routineId,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
          logicalKey: "workspace.skill",
          folderId,
          folderType: "light",
          permission: args.permission,
        });
      } catch (err) {
        if (err instanceof Team9FolderTokenIssuanceError) {
          // The team9 backend signals policy denial here. Surface a
          // structured error the LLM can act on.
          let reason: string;
          if (err.code === "not_allowed") {
            reason =
              args.permission === "write"
                ? "Skill is read-only or hidden for this agent. Ask the user to update agent permission on the skill detail page."
                : "Skill is hidden from this agent. Ask the user to grant access on the skill detail page.";
          } else if (err.code === "folder_not_found") {
            reason = `Skill ${args.skillId} not found.`;
          } else {
            reason = `Token issuance failed (${err.code}): ${err.message}`;
          }
          return { is_error: true, content: reason };
        }
        return {
          is_error: true,
          content: `Mount failed: ${(err as Error).message}`,
        };
      }

      const mountPath = args.mountPath ?? `/workspace/skill/${args.skillId}/`;
      try {
        await folder9Api.applyMount({
          mountPath,
          folderId,
          folderType: "light",
          permission: args.permission,
          token: token.token,
          externallyManagedToken: true,
        });
      } catch (err) {
        return {
          is_error: true,
          content: `applyMount failed: ${(err as Error).message}`,
        };
      }

      return {
        is_error: false,
        content: `Mounted skill ${args.skillId} at ${mountPath} with permission=${args.permission}.`,
      };
    },
  };
}
```

(`Folder9DependencyApi.applyMount` exact shape — check the existing `mount_folder9` tool. The `externallyManagedToken: true` flag is the key difference from PSK-mode mounts.)

- [ ] **Step 3: `create_workspace_skill` tool**

`packages/claw-hive/src/components/team9-skills/tools/create-workspace-skill.ts`:

```ts
import type { AgentTool, ToolResult } from "@team9claw/types";

interface Args {
  name: string;
  description?: string;
  type?: "claude_code_skill" | "prompt_template" | "general";
  icon?: string;
  autoMount?: boolean;
}

export interface CreateWorkspaceSkillDeps {
  /** POST /v1/bot/skills wrapper; returns { id, folderId } and any other fields. */
  createSkill: (body: {
    name: string;
    description?: string;
    type?: string;
    icon?: string;
  }) => Promise<{ id: string; folderId: string }>;
  /** When autoMount=true, dispatch the mount tool internally. */
  mountWorkspaceSkill?: (args: {
    skillId: string;
    permission: "read" | "write";
  }) => Promise<ToolResult>;
}

export function createCreateWorkspaceSkillTool(
  deps: CreateWorkspaceSkillDeps,
): AgentTool {
  return {
    name: "create_workspace_skill",
    description:
      "Create a new workspace skill (registers it in the team9 skill library and provisions a folder9 folder seeded with skill.md). " +
      'You become the creator and the default agent-access for the new skill is "write" (you can edit it).',
    parameters: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        type: {
          type: "string",
          enum: ["claude_code_skill", "prompt_template", "general"],
        },
        icon: { type: "string" },
        autoMount: {
          type: "boolean",
          description:
            "If true, mount the new skill at /workspace/skill/<id>/ with write permission immediately.",
        },
      },
    },
    async execute({ args }: { args: Args }): Promise<ToolResult> {
      let result;
      try {
        result = await deps.createSkill({
          name: args.name,
          description: args.description,
          type: args.type,
          icon: args.icon,
        });
      } catch (err) {
        return {
          is_error: true,
          content: `Create failed: ${(err as Error).message}`,
        };
      }

      let mounted = "";
      if (args.autoMount && deps.mountWorkspaceSkill) {
        const mountRes = await deps.mountWorkspaceSkill({
          skillId: result.id,
          permission: "write",
        });
        mounted = mountRes.is_error
          ? ` (auto-mount failed: ${mountRes.content})`
          : ` and mounted at /workspace/skill/${result.id}/`;
      }

      return {
        is_error: false,
        content:
          `Created skill ${result.id} (folderId=${result.folderId})${mounted}. ` +
          `Default agent-access is "write".`,
      };
    },
  };
}
```

- [ ] **Step 4: Component**

`packages/claw-hive/src/components/team9-skills/component.ts`:

```ts
import { BaseComponent } from "@team9claw/agent-components";
import {
  WorkspaceSkillsProvider,
  type WorkspaceSkillsHttpClient,
} from "@team9claw/agent-components";
import type {
  ComponentContext,
  AgentTool,
  BeforePromptResult,
  ComponentConfig,
  ComponentData,
} from "@team9claw/types";
import type {
  Team9FolderTokenApi,
  Folder9DependencyApi,
} from "@team9claw/claw-hive-types";
import type { SkillTierDependencyApi } from "@team9claw/agent-components";
import { createMountWorkspaceSkillTool } from "./tools/mount-workspace-skill.js";
import { createCreateWorkspaceSkillTool } from "./tools/create-workspace-skill.js";
import { TEAM9_SKILLS_GUIDANCE } from "./team9-skills-prompt.js";

export interface Team9SkillsComponentConfig extends ComponentConfig {
  /** Base URL of the team9 gateway, e.g. https://gateway.team9.ai */
  gatewayBaseUrl: string;
  /** Bot user id used for the x-team9-bot-user-id header + auth. */
  botUserId: string;
  /** Workspace (tenant) id. */
  workspaceId: string;
  /** Bearer token for the bot's auth. */
  botJwt: string;
}

export interface Team9SkillsComponentData extends ComponentData {}

export class Team9SkillsComponent extends BaseComponent<
  Team9SkillsComponentConfig,
  Team9SkillsComponentData
> {
  override readonly typeKey = "team9-skills";
  readonly dependencies = ["team9", "folder9", "host", "skill-tier"] as const;

  private provider?: WorkspaceSkillsProvider;

  constructor(config: Team9SkillsComponentConfig, id?: string) {
    super(
      {
        typeKey: "team9-skills",
        name: "Team9 Skills",
        priority: 5,
        initialData: {},
      },
      config,
      id,
    );
  }

  override async onSessionStart(
    ctx: ComponentContext<Team9SkillsComponentConfig, Team9SkillsComponentData>,
  ): Promise<void> {
    const skillTier = ctx.getDependency<SkillTierDependencyApi>("skill-tier");
    if (!skillTier) {
      console.warn(
        "[Team9SkillsComponent] skill-tier dependency missing; provider not registered",
      );
      return;
    }
    const http = this.buildHttpClient(ctx.config);
    this.provider = new WorkspaceSkillsProvider({
      tenantId: ctx.config.workspaceId,
      http,
    });
    skillTier.registerProvider(this.provider);
  }

  override async onDispose(
    ctx: ComponentContext<Team9SkillsComponentConfig, Team9SkillsComponentData>,
  ): Promise<void> {
    if (!this.provider) return;
    const skillTier = ctx.getDependency<SkillTierDependencyApi>("skill-tier");
    skillTier?.unregisterProvider(this.provider.id);
  }

  override onBeforePrompt(
    _ctx: ComponentContext<
      Team9SkillsComponentConfig,
      Team9SkillsComponentData
    >,
  ): BeforePromptResult {
    return {
      contextInjection: { content: TEAM9_SKILLS_GUIDANCE, target: "system" },
    };
  }

  override getTools(
    ctx: ComponentContext<Team9SkillsComponentConfig, Team9SkillsComponentData>,
  ): AgentTool[] {
    const tokenApi = ctx.getDependency<Team9FolderTokenApi>("team9");
    const folder9Api = ctx.getDependency<Folder9DependencyApi>("folder9");

    const mountTool = createMountWorkspaceSkillTool({
      getTokenApi: () => tokenApi,
      getFolder9Api: () => folder9Api,
      resolveSkillFolderId: async (skillId: string) => {
        const http = this.buildHttpClient(ctx.config);
        const skill = await http.getSkill(skillId);
        if (!skill?.folderId)
          throw new Error(`skill ${skillId} has no folderId`);
        return skill.folderId;
      },
      getSessionContext: () => ({
        sessionId: ctx.sessionId,
        workspaceId: ctx.config.workspaceId,
      }),
    });

    const createTool = createCreateWorkspaceSkillTool({
      createSkill: async (body) => {
        const http = this.buildHttpClient(ctx.config);
        return http.createSkill(body);
      },
      mountWorkspaceSkill: async ({ skillId, permission }) =>
        mountTool.execute({ args: { skillId, permission } } as never),
    });

    return [createTool, mountTool];
  }

  private buildHttpClient(
    config: Team9SkillsComponentConfig,
  ): WorkspaceSkillsHttpClient & {
    getSkill(id: string): Promise<{ id: string; folderId: string } | null>;
    createSkill(body: any): Promise<{ id: string; folderId: string }>;
  } {
    const baseHeaders = {
      authorization: `Bearer ${config.botJwt}`,
      "x-team9-bot-user-id": config.botUserId,
      "content-type": "application/json",
    } as const;
    const base = `${config.gatewayBaseUrl}/v1/bot/skills`;

    return {
      async listSkills(params) {
        const url = new URL(base);
        if (params?.type) url.searchParams.set("type", params.type);
        if (params?.name) url.searchParams.set("name", params.name);
        const res = await fetch(url, { headers: baseHeaders });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      },
      async getSkillMd(skillId) {
        const url = `${base}/${skillId}/folder/blob?path=skill.md`;
        const res = await fetch(url, { headers: baseHeaders });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        return body.content;
      },
      async getSkill(id) {
        const res = await fetch(`${base}/${id}`, { headers: baseHeaders });
        if (!res.ok) return null;
        return res.json();
      },
      async createSkill(body) {
        const res = await fetch(base, {
          method: "POST",
          headers: baseHeaders,
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      },
    };
  }
}
```

(If the codebase has a shared HTTP client (e.g. inside `Team9Component`), prefer reusing it over `fetch` — check `team9/component.ts` for the existing client. The shape above is illustrative; align with the established pattern during implementation.)

- [ ] **Step 5: Component test (high-level)**

`packages/claw-hive/src/components/team9-skills/component.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { Team9SkillsComponent } from "./component.js";
import { WorkspaceSkillsProvider } from "@team9claw/agent-components";

function makeCtx(overrides: any = {}) {
  const skillTier = {
    tierManager: {} as never,
    registerProvider: vi.fn(),
    unregisterProvider: vi.fn(),
  };
  const tokenApi = { issueFolderToken: vi.fn() };
  const folder9Api = { applyMount: vi.fn() };
  return {
    sessionId: "sess",
    config: {
      gatewayBaseUrl: "https://gw.test",
      botUserId: "bot",
      workspaceId: "ws",
      botJwt: "jwt",
    },
    data: {},
    getDependency: (k: string) =>
      k === "skill-tier"
        ? skillTier
        : k === "team9"
          ? tokenApi
          : k === "folder9"
            ? folder9Api
            : undefined,
    ...overrides,
  };
}

describe("Team9SkillsComponent", () => {
  it("registers a WorkspaceSkillsProvider on session start", async () => {
    const ctx = makeCtx();
    const component = new Team9SkillsComponent(ctx.config);
    await component.onSessionStart(ctx as never);
    expect(
      ctx.getDependency("skill-tier").registerProvider,
    ).toHaveBeenCalledWith(expect.any(WorkspaceSkillsProvider));
  });

  it("unregisters the provider on dispose", async () => {
    const ctx = makeCtx();
    const component = new Team9SkillsComponent(ctx.config);
    await component.onSessionStart(ctx as never);
    await component.onDispose(ctx as never);
    expect(
      ctx.getDependency("skill-tier").unregisterProvider,
    ).toHaveBeenCalled();
  });

  it("injects TEAM9_SKILLS_GUIDANCE into the system prompt", () => {
    const ctx = makeCtx();
    const component = new Team9SkillsComponent(ctx.config);
    const r = component.onBeforePrompt(ctx as never);
    expect(r?.contextInjection?.content).toMatch(/team9_skills_guidance/);
    expect(r?.contextInjection?.target).toBe("system");
  });

  it("exposes both tools via getTools", () => {
    const ctx = makeCtx();
    const component = new Team9SkillsComponent(ctx.config);
    const tools = component.getTools(ctx as never);
    expect(tools.map((t) => t.name).sort()).toEqual([
      "create_workspace_skill",
      "mount_workspace_skill",
    ]);
  });
});
```

Add tool-specific tests in `tools/__tests__/` covering the success path + each error branch (missing dep, token issuance error with each error code, applyMount throw).

- [ ] **Step 6: Re-export**

`packages/claw-hive/src/components/team9-skills/index.ts`:

```ts
export { Team9SkillsComponent } from "./component.js";
export type {
  Team9SkillsComponentConfig,
  Team9SkillsComponentData,
} from "./component.js";
```

- [ ] **Step 7: Run tests**

```bash
pnpm --filter @team9claw/claw-hive test src/components/team9-skills/
pnpm --filter @team9claw/claw-hive typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/claw-hive/src/components/team9-skills/
git commit -m "feat(claw-hive): add Team9SkillsComponent with create/mount tools and guidance block"
```

---

## Task 10: Wire `team9-skills` into blueprints + factory registry

**Goal:** Make `team9-skills` a registered component type and add it to blueprints that already mount the skill stack.

**Repo:** team9-agent-pi

**Files:**

- Modify: `packages/claw-hive/src/component-factories.ts`
- Modify: `packages/claw-hive/src/component-factories.test.ts`
- Modify: `packages/claw-hive/src/blueprints/presets.ts`
- Modify: `packages/claw-hive/src/blueprints/presets.test.ts`

**Acceptance Criteria:**

- [ ] `component-factories.ts` registers `team9-skills` → `Team9SkillsComponent`.
- [ ] `team9-common-staff` and any routine-hosting blueprint that already includes `skill-tier` also include `team9-skills`. (Search: `componentIds.includes('skill-tier')` blueprints.)
- [ ] Existing blueprint tests assert the new `team9-skills` is present in those presets.

**Verify:** `pnpm --filter @team9claw/claw-hive test src/component-factories.test.ts src/blueprints/presets.test.ts`

**Steps:**

- [ ] **Step 1: Register factory**

In `component-factories.ts`, find the entry for `skill-tier` (line ~102) and add `team9-skills` next to it:

```ts
'team9-skills': (config, id) =>
  new Team9SkillsComponent(config as Team9SkillsComponentConfig, id),
```

Add the import at the top.

Update the `component-factories.test.ts` `expect(registered).toContain('skill-tier')` assertion to also check `'team9-skills'`.

- [ ] **Step 2: Add to blueprints**

In `presets.ts`, locate the blueprints listed in the spec ("routine-hosting blueprints include the workspace + skill stack" — see `presets.test.ts` for the canonical list). For each blueprint that currently lists `'skill-tier'`, add `'team9-skills'` immediately after. Also add the corresponding `componentConfigs` entry referencing `gatewayBaseUrl`, `botUserId`, `workspaceId`, `botJwt` — these come from session-bootstrap config the same way `Team9Component` consumes them.

The `team9-common-staff` blueprint also gets the new component added.

- [ ] **Step 3: Update blueprint tests**

`presets.test.ts` already asserts `componentIds(blueprint)` for each preset. Extend the assertions:

```ts
it("routine-hosting blueprints include team9-skills alongside skill-tier", () => {
  expect(componentIds(blueprint)).toContain("skill-tier");
  expect(componentIds(blueprint)).toContain("team9-skills");
});
```

- [ ] **Step 4: Run tests + build**

```bash
pnpm --filter @team9claw/claw-hive test
pnpm --filter @team9claw/claw-hive typecheck
pnpm build  # full agent-pi build to surface cross-package issues
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/claw-hive/src/component-factories.ts \
        packages/claw-hive/src/component-factories.test.ts \
        packages/claw-hive/src/blueprints/presets.ts \
        packages/claw-hive/src/blueprints/presets.test.ts
git commit -m "feat(claw-hive/blueprints): wire team9-skills into routine + staff blueprints"
```

---

## Task 11: Bump `@team9claw/*` package version pin in team9 gateway

**Goal:** Surface the new `'workspace.skill'` `Team9LogicalMountKey` value into the gateway compile by consuming the bumped agent-pi package.

**Repo:** team9 (consuming) + team9-agent-pi (publishing)

**Files:**

- Modify: `packages/claw-hive-types/package.json` (version bump in agent-pi)
- Modify: any other agent-pi packages whose major API changed (`claw-hive`, `agent-components`)
- Modify: `apps/server/apps/gateway/package.json` (team9) — bump pin
- Modify: `pnpm-lock.yaml` (team9 + agent-pi)

**Acceptance Criteria:**

- [ ] Agent-pi packages publish locally with bumped versions (in dev, this is workspace-link; in CI, the published versions need bumping).
- [ ] team9 `apps/server/apps/gateway/package.json` references the new versions.
- [ ] `pnpm install` in both repos resolves cleanly.
- [ ] Gateway typecheck passes — `'workspace.skill'` is now a valid `Team9LogicalMountKey`.

**Verify:** `pnpm --filter gateway typecheck && pnpm --filter @team9claw/claw-hive build`

**Steps:**

- [ ] **Step 1: Bump versions in agent-pi**

`packages/claw-hive-types/package.json`, `packages/agent-components/package.json`, `packages/claw-hive/package.json`: bump the `version` field by patch (or minor if the change is API-additive — it is, `'workspace.skill'` and new components are additive, not breaking; minor is appropriate).

```bash
cd /Users/winrey/Projects/weightwave/team9-agent-pi
pnpm install     # update lockfile
pnpm build
```

- [ ] **Step 2: Update gateway package.json**

`apps/server/apps/gateway/package.json`: bump the pinned version of `@team9claw/claw-hive-types` (and any other packages used directly).

```bash
cd /Users/winrey/Projects/weightwave/team9
pnpm install
pnpm --filter gateway typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit (each repo)**

```bash
cd /Users/winrey/Projects/weightwave/team9-agent-pi
git add packages/claw-hive-types/package.json \
        packages/agent-components/package.json \
        packages/claw-hive/package.json \
        pnpm-lock.yaml
git commit -m "chore: bump versions for workspace.skill + Team9SkillsComponent"

cd /Users/winrey/Projects/weightwave/team9
git add apps/server/apps/gateway/package.json pnpm-lock.yaml
git commit -m "chore(gateway): bump claw-hive-types pin for workspace.skill"
```

---

## Task 12: Frontend types + API client cleanup

**Goal:** Update the team9 client's TypeScript types and HTTP client to match the new gateway shape.

**Repo:** team9

**Files:**

- Modify: `apps/client/src/types/skill.ts`
- Modify: `apps/client/src/services/api/skills.ts`
- Modify: `apps/client/src/services/api/folder9-folder.ts`
- Modify: `apps/client/src/hooks/useSkills.ts`

**Acceptance Criteria:**

- [ ] `SkillVersion`, `SkillFile`, `SkillFileManifestEntry` removed from `types/skill.ts`.
- [ ] `SkillAgentAccess = 'none' | 'read' | 'write'` exported.
- [ ] `Skill` and `SkillDetail` types include `agentAccess: SkillAgentAccess`.
- [ ] `services/api/skills.ts`: `listVersions`, `getVersion`, `createVersion`, `reviewVersion` removed; `update` body includes `agentAccess?`.
- [ ] `services/api/folder9-folder.ts`: `fetchLegacySkillFiles` and `isMissingSkillFolderRoute` removed; the `fetchTree` / `fetchBlob` / `fetchHistory` methods drop their fallback try/catch around them.
- [ ] `hooks/useSkills.ts`: queries / mutations for versions removed.
- [ ] Frontend typecheck passes (`pnpm typecheck` in `apps/client`).

**Verify:** `pnpm --filter team9-app-web typecheck && pnpm --filter team9-app-web test`

**Steps:**

- [ ] **Step 1: Update types**

`apps/client/src/types/skill.ts`:

```ts
export type SkillType = "claude_code_skill" | "prompt_template" | "general";
export type SkillAgentAccess = "none" | "read" | "write";

export interface Skill {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  type: SkillType;
  icon: string | null;
  folderId: string | null;
  agentAccess: SkillAgentAccess;
  creatorId: string;
  createdAt: string;
  updatedAt: string;
}

export type SkillDetail = Skill;

// SkillVersion / SkillFile / SkillFileManifestEntry removed.
```

(Remove every `import` of the deleted types across the client — typecheck will surface any leftover sites.)

- [ ] **Step 2: Update API client**

`apps/client/src/services/api/skills.ts`:

```ts
import { http } from "../http.js";
import type {
  Skill,
  SkillDetail,
  SkillType,
  SkillAgentAccess,
} from "@/types/skill";

export interface CreateSkillBody {
  name: string;
  description?: string;
  type?: SkillType;
  icon?: string;
  agentAccess?: SkillAgentAccess;
  files?: { path: string; content: string }[];
}

export interface UpdateSkillBody {
  name?: string;
  description?: string;
  icon?: string;
  agentAccess?: SkillAgentAccess;
}

export const skillsApi = {
  async create(dto: CreateSkillBody) {
    const r = await http.post<Skill>("/v1/skills", dto);
    return r.data;
  },
  async list(params: { type?: SkillType } = {}) {
    const r = await http.get<Skill[]>("/v1/skills", { params });
    return r.data;
  },
  async getById(id: string) {
    const r = await http.get<SkillDetail>(`/v1/skills/${id}`);
    return r.data;
  },
  async update(id: string, dto: UpdateSkillBody) {
    const r = await http.patch<Skill>(`/v1/skills/${id}`, dto);
    return r.data;
  },
  async delete(id: string) {
    await http.delete(`/v1/skills/${id}`);
  },
};

export default skillsApi;
```

(All version endpoints removed.)

- [ ] **Step 3: Strip legacy fallback in folder9-folder.ts**

In `apps/client/src/services/api/folder9-folder.ts`:

- Delete `fetchLegacySkillFiles` and `isMissingSkillFolderRoute`.
- In `fetchTree`/`fetchBlob`/`fetchHistory` inside `skillFolderApi(skillId)`, remove the `try { ... } catch (error) { if (!isMissingSkillFolderRoute(error)) throw error; ... fallback ... }` blocks. Keep the straight HTTP calls.
- Update the doc comment near line 255 to drop the "vs. legacy" sentence — folder9 is now the only path.

- [ ] **Step 4: Strip useSkills hooks**

In `apps/client/src/hooks/useSkills.ts`:

- Delete every `useQuery` / `useMutation` referencing `listVersions`, `getVersion`, `createVersion`, `reviewVersion`.
- The hooks for `useSkillsList`, `useSkill(id)`, `useCreateSkill`, `useUpdateSkill`, `useDeleteSkill` stay; ensure they accept the new optional `agentAccess` argument (just by typing — most pass through).

- [ ] **Step 5: Run typecheck**

```bash
pnpm --filter team9-app-web typecheck
```

Expected: PASS. Any remaining errors point at component sites that still reference dead types (handled in Task 13).

- [ ] **Step 6: Commit**

```bash
git add apps/client/src/types/skill.ts \
        apps/client/src/services/api/skills.ts \
        apps/client/src/services/api/folder9-folder.ts \
        apps/client/src/hooks/useSkills.ts
git commit -m "feat(client/skills): remove version API + add agentAccess types"
```

---

## Task 13: `AgentAccessControl` + `CreateSkillDialog` + `SkillCard` + i18n

**Goal:** Add the 3-state agent-access selector to the skill detail UI, surface it in the create dialog, and remove the suggestion badge.

**Repo:** team9

**Files:**

- Create: `apps/client/src/components/skills/AgentAccessControl.tsx`
- Create: `apps/client/src/components/skills/__tests__/AgentAccessControl.test.tsx`
- Modify: `apps/client/src/components/skills/CreateSkillDialog.tsx`
- Modify: `apps/client/src/components/skills/SkillCard.tsx`
- Modify: `apps/client/src/components/skills/SkillDetailPage.tsx` (or whichever component currently hosts the skill settings)
- Modify: `apps/client/src/i18n/locales/{en,zh-CN,...}/skills.json`

**Acceptance Criteria:**

- [ ] `AgentAccessControl` renders three options: Hidden / Read-only / Read & write. Selecting one calls `onChange(value)`.
- [ ] When mounted in `SkillDetailPage`, it reads the skill's current `agentAccess` and persists changes via the existing update mutation.
- [ ] `CreateSkillDialog` includes the same control with default `'read'`. The dialog passes `agentAccess` in the create body.
- [ ] `SkillCard` no longer renders a `hasPendingSuggestion` badge.
- [ ] i18n strings added: `skills.agentAccess.label`, `.hidden`, `.read`, `.write`, plus help-text strings.
- [ ] Tests: `AgentAccessControl` renders all three states, fires `onChange` when clicking an option, shows the help text.

**Verify:** `pnpm --filter team9-app-web test src/components/skills/`

**Steps:**

- [ ] **Step 1: Build `AgentAccessControl`**

`apps/client/src/components/skills/AgentAccessControl.tsx`:

```tsx
import { useTranslation } from "react-i18next";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import type { SkillAgentAccess } from "@/types/skill";

interface AgentAccessControlProps {
  value: SkillAgentAccess;
  onChange: (next: SkillAgentAccess) => void;
  disabled?: boolean;
}

export function AgentAccessControl({
  value,
  onChange,
  disabled,
}: AgentAccessControlProps) {
  const { t } = useTranslation();
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-medium">
        {t("skills.agentAccess.label")}
      </legend>
      <RadioGroup
        value={value}
        onValueChange={(v) => onChange(v as SkillAgentAccess)}
      >
        {(["none", "read", "write"] as const).map((opt) => (
          <label
            key={opt}
            className="flex items-start gap-2 rounded border p-2 cursor-pointer"
          >
            <RadioGroupItem value={opt} id={`access-${opt}`} />
            <div>
              <Label htmlFor={`access-${opt}`} className="font-medium">
                {t(`skills.agentAccess.${opt}.title`)}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t(`skills.agentAccess.${opt}.help`)}
              </p>
            </div>
          </label>
        ))}
      </RadioGroup>
    </fieldset>
  );
}
```

(Adapt the imports to whatever `RadioGroup` library the project uses — Radix primitives appear to be in `@/components/ui/radio-group`. If absent, build a tiny custom radio inline.)

- [ ] **Step 2: i18n strings**

`apps/client/src/i18n/locales/en/skills.json` — add:

```json
"agentAccess": {
  "label": "Agent access",
  "none": {
    "title": "Hidden",
    "help": "Agents in this workspace cannot see or use this skill."
  },
  "read": {
    "title": "Read-only",
    "help": "Agents can find and use this skill but cannot edit its files."
  },
  "write": {
    "title": "Read & write",
    "help": "Agents can both use and edit this skill."
  }
}
```

Mirror the structure to every other locale file under `apps/client/src/i18n/locales/`. For locales the team translates manually, leave English placeholders and the translation team can update later.

- [ ] **Step 3: Mount in `SkillDetailPage`**

Find the section where skill metadata is displayed; insert:

```tsx
<AgentAccessControl
  value={skill.agentAccess}
  onChange={(next) =>
    updateSkill.mutate({ id: skill.id, body: { agentAccess: next } })
  }
  disabled={updateSkill.isPending}
/>
```

(The exact component / hook names depend on the existing structure. The mutation is the existing `useUpdateSkill`.)

- [ ] **Step 4: Update `CreateSkillDialog`**

Add a state `const [agentAccess, setAgentAccess] = useState<SkillAgentAccess>('read');` and include it in the dialog body. Pass it through in the create call:

```tsx
const onSubmit = () => {
  skillsApi.create({ name, description, type, icon, agentAccess });
};
```

- [ ] **Step 5: Strip suggestion badge from `SkillCard`**

In `apps/client/src/components/skills/SkillCard.tsx`:

- Remove the `hasPendingSuggestion?: boolean` prop.
- Delete the JSX block that renders the badge.
- Remove the prop from any callers (likely `SkillsListPage.tsx` and `SkillCard.test.tsx`).

- [ ] **Step 6: Test**

`apps/client/src/components/skills/__tests__/AgentAccessControl.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import { AgentAccessControl } from "../AgentAccessControl";

const renderWithI18n = (ui: React.ReactElement) =>
  render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);

describe("AgentAccessControl", () => {
  it("renders all three options", () => {
    renderWithI18n(<AgentAccessControl value="read" onChange={() => {}} />);
    expect(screen.getByLabelText(/hidden/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/read-only/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/read & write/i)).toBeInTheDocument();
  });

  it("fires onChange when an option is clicked", () => {
    const onChange = jest.fn();
    renderWithI18n(<AgentAccessControl value="read" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(/hidden/i));
    expect(onChange).toHaveBeenCalledWith("none");
  });

  it("respects disabled prop", () => {
    renderWithI18n(
      <AgentAccessControl value="read" onChange={() => {}} disabled />,
    );
    const radio = screen.getByLabelText(/hidden/i);
    expect(radio).toBeDisabled();
  });
});
```

- [ ] **Step 7: Run tests + typecheck**

```bash
pnpm --filter team9-app-web test src/components/skills/
pnpm --filter team9-app-web typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/client/src/components/skills/AgentAccessControl.tsx \
        apps/client/src/components/skills/__tests__/AgentAccessControl.test.tsx \
        apps/client/src/components/skills/CreateSkillDialog.tsx \
        apps/client/src/components/skills/SkillCard.tsx \
        apps/client/src/components/skills/SkillDetailPage.tsx \
        apps/client/src/i18n/locales/
git commit -m "feat(client/skills): add AgentAccessControl, drop suggestion badge"
```

---

## Task 14: Delete `SuggestionReviewPanel` + clean up integration sites

**Goal:** Remove the no-longer-used suggestion review panel and verify nothing references it.

**Repo:** team9

**Files:**

- Delete: `apps/client/src/components/skills/SuggestionReviewPanel.tsx`
- Delete: `apps/client/src/components/skills/__tests__/SuggestionReviewPanel.test.tsx` (if exists)
- Modify: any file that imports it (likely `SkillsListPage.tsx` or `SkillDetailPage.tsx`)

**Acceptance Criteria:**

- [ ] `grep -r 'SuggestionReviewPanel' apps/client/src` returns zero matches.
- [ ] Frontend typecheck passes.
- [ ] Skill detail page renders without the deleted panel — manual smoke check via the dev server.

**Verify:** `pnpm --filter team9-app-web typecheck && rg 'SuggestionReviewPanel' apps/client/src; echo "should be zero matches above"`

**Steps:**

- [ ] **Step 1: Delete the component file**

```bash
rm apps/client/src/components/skills/SuggestionReviewPanel.tsx
# delete the test file if it exists:
rm -f apps/client/src/components/skills/__tests__/SuggestionReviewPanel.test.tsx
```

- [ ] **Step 2: Find and remove imports**

```bash
rg 'SuggestionReviewPanel' apps/client/src
```

For each hit, delete the import line and the JSX usage. Typecheck guides:

```bash
pnpm --filter team9-app-web typecheck
```

- [ ] **Step 3: Smoke test in dev**

```bash
pnpm --filter team9-app-web dev
```

Open the skills page, open a skill, confirm it renders without errors. (No automated test for this — ad-hoc visual check.)

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/components/skills/ apps/client/src/routes/_authenticated/skills/
git commit -m "feat(client/skills): delete SuggestionReviewPanel"
```

---

## Migration & Deploy Notes

The plan tasks land in this order during a single deploy. Sequencing:

1. Tasks 0–4 (gateway-only schema + service + bot controller) deploy first — backwards compatible because the agent-pi side is not yet using `'workspace.skill'`. Frontend may surface 404s if it tries the version routes; pair with frontend deploy.
2. Task 5 (workspace.skill logicalKey) **must not deploy until** Task 11 publishes new agent-pi packages with the `'workspace.skill'` literal. In dev, this is automatic via workspace links; in CI/prod, sequence package publish → bump pin → deploy.
3. Tasks 6–10 (agent-pi runtime additions) ship in the agent image build that follows the next routine run.
4. Tasks 12–14 (frontend) ship together with Task 0–4.

Rollback: each task is its own commit. Reverting in reverse order restores the previous working state.

---

## Self-review checklist (filled by plan author)

- Spec §2.1 schema → Task 0. ✅
- Spec §2.2 user-facing routes → Tasks 1, 2. ✅
- Spec §2.2 bot routes → Tasks 1 (service helpers), 4 (controller). ✅
- Spec §2.2 service layer → Tasks 1, 4. ✅
- Spec §2.2 token mint extension → Task 5. ✅
- Spec §2.3 websocket events → out of scope (no task — confirmed by spec §9). ✅
- Spec §2.4 WorkspaceSkillsProvider + new tools → Tasks 8, 9. ✅
- Spec §2.5 source/agentAccess in prompt + recovery → Tasks 7 (XML), 9 (component + guidance). ✅
- Spec §2.6 unregisterProvider → Task 6. ✅
- Spec §3.1 cleanup migrations → Task 0. ✅
- Spec §3.2 backend cleanup → Tasks 1, 2, 3, 4, 5. ✅
- Spec §3.3 frontend cleanup → Tasks 12, 13, 14. ✅
- Spec §3.4 tests → covered inside each task's "Steps" + Verify. ✅
- Spec §5 access matrix → Task 5 spec, Task 9 prompt. ✅
- Spec §6 migration & rollout → "Migration & Deploy Notes" above. ✅
- Spec §7 testing strategy → integrated test cases inside each task. ✅
- Spec §8 (no remaining open questions) — N/A.
- Spec §9 out of scope items: not implemented (correct).
