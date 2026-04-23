# Hidden Application Flag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let us soft-retire the OpenClaw entry (and any future app) by flipping a single `hidden: true` flag — workspaces that have not installed it see it disappear from list/detail and cannot install it, while already-installed workspaces are untouched.

**Architecture:** Add an optional `hidden` boolean to the `Application` type. Filter list/detail reads in `ApplicationsController` based on what the tenant has installed. Reject new installs of hidden apps inside `InstalledApplicationsService.install`. No schema, no migration, no client changes — the frontend already subtracts installed from the catalog, and the list endpoint will simply stop returning the hidden entry for tenants that never installed it.

**Tech Stack:** NestJS 11, Drizzle ORM, Jest (with `@jest/globals`), SWC. Backend-only change under `apps/server/apps/gateway/src/applications/`.

**Spec:** [docs/superpowers/specs/2026-04-16-hidden-application-flag-design.md](../specs/2026-04-16-hidden-application-flag-design.md)

---

### Task 1: Add `hidden` field, `findAllVisible`, and auto-install filter in `ApplicationsService`

**Goal:** Type-level support for the flag, a tenant-aware visibility filter on the service, and an updated auto-install filter. Mark `openclaw` as hidden. Fully unit-tested.

**Files:**

- Modify: `apps/server/apps/gateway/src/applications/application.types.ts`
- Modify: `apps/server/apps/gateway/src/applications/applications.service.ts`
- Modify: `apps/server/apps/gateway/src/applications/applications.service.spec.ts`

**Acceptance Criteria:**

- [ ] `Application` type has an optional `hidden?: boolean` with JSDoc describing the soft-retire semantics.
- [ ] `openclaw` entry in the `APPLICATIONS` array has `hidden: true`. Every other entry is unchanged.
- [ ] New method `findAllVisible(installedIds: Set<string>): Application[]` returns all enabled apps minus any that are `hidden` and not in `installedIds`.
- [ ] `findAll()` still returns every enabled app regardless of hidden — this is the internal/unfiltered accessor.
- [ ] `findById(id)` still returns hidden apps (install/uninstall handlers and `omitSecrets` depend on this).
- [ ] `findAutoInstall()` excludes any entry with `hidden: true` (defense in depth — openclaw already lacks `autoInstall`, so nothing observable changes today, but a future `hidden + autoInstall` combo won't silently auto-install).
- [ ] Unit tests cover: hidden openclaw, `findAllVisible` in/out of installed set for hidden + non-hidden, `findById` still returns openclaw, `findAutoInstall` excludes hidden.
- [ ] All existing `applications.service.spec.ts` tests still pass (openclaw type/category etc. unchanged).

**Verify:** `cd /Users/winrey/Projects/weightwave/team9 && pnpm --filter @team9/gateway test -- --testPathPattern 'applications.service.spec'` → all tests pass, including the new ones.

**Steps:**

- [ ] **Step 1: Add `hidden` field to the `Application` interface**

Edit [apps/server/apps/gateway/src/applications/application.types.ts](../../../apps/server/apps/gateway/src/applications/application.types.ts). Insert after the `autoInstall` field:

```ts
  /**
   * If true, this application is soft-retired. It is filtered out of the
   * public list/detail endpoints for tenants that have not installed it,
   * and new installs are rejected. Tenants that already installed it keep
   * using it normally and may uninstall (but not reinstall).
   */
  hidden?: boolean;
```

- [ ] **Step 2: Write failing tests for the new service behavior**

Edit [apps/server/apps/gateway/src/applications/applications.service.spec.ts](../../../apps/server/apps/gateway/src/applications/applications.service.spec.ts). Add these blocks (keep existing blocks intact):

Inside `describe('findAll', ...)` — add one assertion:

```ts
it("should mark openclaw as hidden", () => {
  const openclaw = service.findAll().find((app) => app.id === "openclaw");
  expect(openclaw).toBeDefined();
  expect(openclaw!.hidden).toBe(true);
});
```

Add a new top-level describe after `findAll`:

```ts
describe("findAllVisible", () => {
  it("excludes hidden apps when the tenant has not installed them", () => {
    const apps = service.findAllVisible(new Set<string>());
    expect(apps.some((app) => app.id === "openclaw")).toBe(false);
  });

  it("includes hidden apps when the tenant has installed them", () => {
    const apps = service.findAllVisible(new Set<string>(["openclaw"]));
    expect(apps.some((app) => app.id === "openclaw")).toBe(true);
  });

  it("always includes non-hidden apps regardless of install state", () => {
    const apps = service.findAllVisible(new Set<string>());
    expect(apps.some((app) => app.id === "base-model-staff")).toBe(true);
    expect(apps.some((app) => app.id === "common-staff")).toBe(true);
    expect(apps.some((app) => app.id === "personal-staff")).toBe(true);
  });

  it("never returns disabled apps", () => {
    const apps = service.findAllVisible(new Set<string>(["openclaw"]));
    expect(apps.every((app) => app.enabled)).toBe(true);
  });
});
```

Inside `describe('findById', ...)` — add:

```ts
it("still returns hidden apps (used by install/uninstall handlers)", () => {
  const app = service.findById("openclaw");
  expect(app).toBeDefined();
  expect(app!.hidden).toBe(true);
});
```

Inside `describe('findAutoInstall', ...)` — add:

```ts
it("excludes any hidden app even if autoInstall were set", () => {
  const autoApps = service.findAutoInstall();
  expect(autoApps.every((app) => !app.hidden)).toBe(true);
});
```

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `cd /Users/winrey/Projects/weightwave/team9 && pnpm --filter @team9/gateway test -- --testPathPattern 'applications.service.spec'`

Expected: the four new tests fail (`hidden` is `undefined`, `findAllVisible` is not a function), existing tests still pass.

- [ ] **Step 4: Implement the service changes**

Edit [apps/server/apps/gateway/src/applications/applications.service.ts](../../../apps/server/apps/gateway/src/applications/applications.service.ts).

In the `APPLICATIONS` array, find the `openclaw` entry (id `'openclaw'`, around lines 7-18) and add `hidden: true` as the last field:

```ts
  {
    id: 'openclaw',
    name: 'OpenClaw',
    description:
      'AI-powered coding assistant that helps you write, review, and debug code.',
    iconUrl: '/icons/openclaw.svg',
    categories: ['ai', 'bot'],
    enabled: true,
    type: 'custom',
    singleton: true,
    hidden: true,
  },
```

Replace the class body (preserving `@Injectable()` above) so the methods are:

```ts
@Injectable()
export class ApplicationsService {
  /**
   * Get all enabled applications, unfiltered by visibility.
   * Internal accessor used by install handlers, metadata lookup,
   * and `findAllVisible` / `findAutoInstall`.
   */
  findAll(): Application[] {
    return APPLICATIONS.filter((app) => app.enabled);
  }

  /**
   * Get all applications visible to a tenant: excludes `hidden` apps the
   * tenant has not installed. Hidden apps the tenant already installed are
   * kept (so clients that render the full catalog can still resolve them).
   */
  findAllVisible(installedIds: Set<string>): Application[] {
    return this.findAll().filter(
      (app) => !app.hidden || installedIds.has(app.id),
    );
  }

  /**
   * Get an application by ID. Returns hidden apps too — install/uninstall
   * handlers and metadata enrichment need them.
   */
  findById(id: string): Application | undefined {
    return APPLICATIONS.find((app) => app.id === id && app.enabled);
  }

  /**
   * Get all applications that should be auto-installed when a workspace
   * is created. Hidden apps are always excluded.
   */
  findAutoInstall(): Application[] {
    return APPLICATIONS.filter(
      (app) => app.autoInstall && app.enabled && !app.hidden,
    );
  }
}
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `cd /Users/winrey/Projects/weightwave/team9 && pnpm --filter @team9/gateway test -- --testPathPattern 'applications.service.spec'`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/server/apps/gateway/src/applications/application.types.ts \
        apps/server/apps/gateway/src/applications/applications.service.ts \
        apps/server/apps/gateway/src/applications/applications.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(applications): add hidden flag + findAllVisible helper

Introduce an optional hidden boolean on the Application definition and a
tenant-aware findAllVisible accessor. Mark openclaw as hidden so new
workspaces no longer discover it; already-installed workspaces are
unaffected because findAllVisible keeps hidden apps in installedIds.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Make `ApplicationsController` tenant-aware

**Goal:** `GET /v1/applications` and `GET /v1/applications/:id` respect the `hidden` flag per tenant. Uses the same `WorkspaceGuard` + `@CurrentTenantId()` pattern already wired in sibling controllers.

**Files:**

- Modify: `apps/server/apps/gateway/src/applications/applications.controller.ts`
- Modify: `apps/server/apps/gateway/src/applications/applications.controller.spec.ts`

**Acceptance Criteria:**

- [ ] Controller decorated with `@UseGuards(AuthGuard, WorkspaceGuard)` (matching `InstalledApplicationsController`).
- [ ] `InstalledApplicationsService` injected alongside `ApplicationsService`.
- [ ] `findAll` resolves `@CurrentTenantId()`, throws `BadRequestException('Tenant ID is required')` if missing, builds `Set<string>` of installed `applicationId`s via `installedApplicationsService.findAllByTenant`, returns `applicationsService.findAllVisible(installedIds)`.
- [ ] `findById` resolves `@CurrentTenantId()`, throws `BadRequestException` if missing, throws `NotFoundException` when (a) the id is unknown, (b) the app is `hidden` and the tenant has no `installed_applications` row for it. Returns the app otherwise.
- [ ] Unit tests cover: list excludes hidden for uninstalled tenant; list includes hidden for installed tenant; list includes non-hidden for both; detail returns hidden app when installed; detail 404s hidden app when not installed; detail 404s unknown id (existing); detail throws `BadRequestException` when tenant id missing.
- [ ] All existing `applications.controller.spec.ts` tests either still pass or are updated to reflect the new constructor signature and tenant arguments.

**Verify:** `cd /Users/winrey/Projects/weightwave/team9 && pnpm --filter @team9/gateway test -- --testPathPattern 'applications.controller.spec'` → all tests pass.

**Steps:**

- [ ] **Step 1: Rewrite the controller test first (TDD)**

Replace the entire contents of [apps/server/apps/gateway/src/applications/applications.controller.spec.ts](../../../apps/server/apps/gateway/src/applications/applications.controller.spec.ts) with:

```ts
import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ApplicationsController } from "./applications.controller.js";

describe("ApplicationsController", () => {
  let applicationsService: {
    findAll: jest.Mock;
    findAllVisible: jest.Mock;
    findById: jest.Mock;
  };
  let installedApplicationsService: {
    findAllByTenant: jest.Mock;
    findByApplicationId: jest.Mock;
  };
  let controller: ApplicationsController;

  const TENANT_ID = "tenant-uuid";

  beforeEach(() => {
    applicationsService = {
      findAll: jest.fn(),
      findAllVisible: jest.fn(),
      findById: jest.fn(),
    };
    installedApplicationsService = {
      findAllByTenant: jest.fn(),
      findByApplicationId: jest.fn(),
    };
    controller = new ApplicationsController(
      applicationsService as never,
      installedApplicationsService as never,
    );
  });

  describe("findAll", () => {
    it("passes the installed application ids to findAllVisible", async () => {
      installedApplicationsService.findAllByTenant.mockResolvedValue([
        { applicationId: "common-staff" },
        { applicationId: "openclaw" },
      ]);
      applicationsService.findAllVisible.mockReturnValue([
        { id: "common-staff" },
      ]);

      const result = await controller.findAll(TENANT_ID);

      expect(installedApplicationsService.findAllByTenant).toHaveBeenCalledWith(
        TENANT_ID,
      );
      const arg = applicationsService.findAllVisible.mock
        .calls[0][0] as Set<string>;
      expect(arg.has("common-staff")).toBe(true);
      expect(arg.has("openclaw")).toBe(true);
      expect(result).toEqual([{ id: "common-staff" }]);
    });

    it("throws BadRequestException when tenant id is missing", async () => {
      await expect(controller.findAll("")).rejects.toThrow(
        new BadRequestException("Tenant ID is required"),
      );
    });
  });

  describe("findById", () => {
    it("returns the app when it is not hidden", async () => {
      applicationsService.findById.mockReturnValue({
        id: "common-staff",
        hidden: false,
      });

      const result = await controller.findById("common-staff", TENANT_ID);

      expect(result).toEqual({ id: "common-staff", hidden: false });
      expect(
        installedApplicationsService.findByApplicationId,
      ).not.toHaveBeenCalled();
    });

    it("returns a hidden app when the tenant has installed it", async () => {
      applicationsService.findById.mockReturnValue({
        id: "openclaw",
        hidden: true,
      });
      installedApplicationsService.findByApplicationId.mockResolvedValue({
        id: "installed-uuid",
      });

      const result = await controller.findById("openclaw", TENANT_ID);

      expect(result).toEqual({ id: "openclaw", hidden: true });
      expect(
        installedApplicationsService.findByApplicationId,
      ).toHaveBeenCalledWith(TENANT_ID, "openclaw");
    });

    it("throws NotFoundException for a hidden app the tenant has not installed", async () => {
      applicationsService.findById.mockReturnValue({
        id: "openclaw",
        hidden: true,
      });
      installedApplicationsService.findByApplicationId.mockResolvedValue(null);

      await expect(controller.findById("openclaw", TENANT_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws NotFoundException for an unknown id", async () => {
      applicationsService.findById.mockReturnValue(undefined);

      await expect(
        controller.findById("missing-app", TENANT_ID),
      ).rejects.toThrow(
        new NotFoundException("Application missing-app not found"),
      );
    });

    it("throws BadRequestException when tenant id is missing", async () => {
      await expect(controller.findById("openclaw", "")).rejects.toThrow(
        new BadRequestException("Tenant ID is required"),
      );
    });
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `cd /Users/winrey/Projects/weightwave/team9 && pnpm --filter @team9/gateway test -- --testPathPattern 'applications.controller.spec'`

Expected: compile/construction errors because the controller still takes one constructor arg and has no tenant plumbing.

- [ ] **Step 3: Implement the controller**

Replace the contents of [apps/server/apps/gateway/src/applications/applications.controller.ts](../../../apps/server/apps/gateway/src/applications/applications.controller.ts) with:

```ts
import {
  Controller,
  Get,
  Param,
  BadRequestException,
  NotFoundException,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@team9/auth";
import { CurrentTenantId } from "../common/decorators/current-tenant.decorator.js";
import { WorkspaceGuard } from "../workspace/guards/workspace.guard.js";
import { ApplicationsService } from "./applications.service.js";
import { InstalledApplicationsService } from "./installed-applications.service.js";

@Controller({
  path: "applications",
  version: "1",
})
@UseGuards(AuthGuard, WorkspaceGuard)
export class ApplicationsController {
  constructor(
    private readonly applicationsService: ApplicationsService,
    private readonly installedApplicationsService: InstalledApplicationsService,
  ) {}

  /**
   * Get all applications visible to the current tenant.
   * Hidden apps are filtered out unless the tenant has installed them.
   */
  @Get()
  async findAll(@CurrentTenantId() tenantId: string) {
    if (!tenantId) {
      throw new BadRequestException("Tenant ID is required");
    }
    const installed =
      await this.installedApplicationsService.findAllByTenant(tenantId);
    const installedIds = new Set(installed.map((a) => a.applicationId));
    return this.applicationsService.findAllVisible(installedIds);
  }

  /**
   * Get an application by ID. A hidden app returns 404 for tenants that have
   * not installed it, to avoid leaking the existence of soft-retired apps.
   */
  @Get(":id")
  async findById(@Param("id") id: string, @CurrentTenantId() tenantId: string) {
    if (!tenantId) {
      throw new BadRequestException("Tenant ID is required");
    }
    const app = this.applicationsService.findById(id);
    if (!app) {
      throw new NotFoundException(`Application ${id} not found`);
    }
    if (app.hidden) {
      const installed =
        await this.installedApplicationsService.findByApplicationId(
          tenantId,
          id,
        );
      if (!installed) {
        throw new NotFoundException(`Application ${id} not found`);
      }
    }
    return app;
  }
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `cd /Users/winrey/Projects/weightwave/team9 && pnpm --filter @team9/gateway test -- --testPathPattern 'applications.controller.spec'`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/server/apps/gateway/src/applications/applications.controller.ts \
        apps/server/apps/gateway/src/applications/applications.controller.spec.ts
git commit -m "$(cat <<'EOF'
feat(applications): filter hidden apps per tenant in list/detail

ApplicationsController now resolves the current tenant (via WorkspaceGuard +
CurrentTenantId), looks up the tenant's installed applications, and returns
findAllVisible. GET /applications/:id 404s for hidden apps the tenant has
not installed, matching the soft-retire contract.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Reject new installs of hidden apps in `InstalledApplicationsService.install`

**Goal:** A direct call to `install()` with a hidden applicationId is rejected with `ForbiddenException` before any DB write. Uninstall of already-installed hidden apps continues to work.

**Files:**

- Modify: `apps/server/apps/gateway/src/applications/installed-applications.service.ts`
- Modify: `apps/server/apps/gateway/src/applications/installed-applications.service.spec.ts`

**Acceptance Criteria:**

- [ ] `install()` looks up `applicationsService.findById(dto.applicationId)` once, and if `hidden === true`, throws `ForbiddenException` with a message naming the application. The throw happens after the handler-registered check (so unknown ids still 404) and before the singleton check.
- [ ] No DB insert occurs on the hidden path: `db.insert` is not called. Handler `onInstall` is not called.
- [ ] Existing install paths (singleton, rollback, happy path, unknown handler) are not regressed.
- [ ] Uninstall of a hidden app already installed still works (regression coverage).
- [ ] Unit tests cover: install hidden app throws `ForbiddenException` and no handler/DB side effect; install non-hidden app unchanged; uninstall hidden app still invokes `onUninstall`.

**Verify:** `cd /Users/winrey/Projects/weightwave/team9 && pnpm --filter @team9/gateway test -- --testPathPattern 'installed-applications.service.spec'` → all tests pass.

**Steps:**

- [ ] **Step 1: Add failing tests for hidden guard**

Edit [apps/server/apps/gateway/src/applications/installed-applications.service.spec.ts](../../../apps/server/apps/gateway/src/applications/installed-applications.service.spec.ts). Inside the `describe('InstalledApplicationsService — install', ...)` block, after the existing `'throws NotFoundException when no handler is registered'` test, add:

```ts
// ── hidden guard ────────────────────────────────────────────────────────────

it("throws ForbiddenException when installing a hidden app, without touching the DB", async () => {
  applicationsService.findById.mockReturnValueOnce({
    id: APP_ID,
    name: "Base Model Staff",
    type: "custom",
    singleton: true,
    enabled: true,
    hidden: true,
  });

  await expect(
    service.install(TENANT_ID, INSTALLED_BY, { applicationId: APP_ID }),
  ).rejects.toThrow(ForbiddenException);

  expect(db.insert).not.toHaveBeenCalled();
  expect(handler.onInstall).not.toHaveBeenCalled();
});
```

Inside `describe('InstalledApplicationsService — uninstall', ...)`, after `'calls onUninstall handler for custom apps'`, add:

```ts
it("still uninstalls a hidden app (soft-retire allows uninstall)", async () => {
  applicationsService.findById.mockReturnValueOnce({
    id: APP_ID,
    name: "Base Model Staff",
    type: "custom",
    singleton: true,
    enabled: true,
    hidden: true,
  });
  db.where.mockResolvedValueOnce([
    { ...INSERTED_RECORD, applicationId: APP_ID },
  ]);

  await service.uninstall(INSERTED_RECORD.id, TENANT_ID);

  expect(handler.onUninstall).toHaveBeenCalled();
  expect(db.delete).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `cd /Users/winrey/Projects/weightwave/team9 && pnpm --filter @team9/gateway test -- --testPathPattern 'installed-applications.service.spec'`

Expected: the new install test fails (no `ForbiddenException` thrown, DB gets called). The uninstall test may already pass — that's intentional (regression guard).

- [ ] **Step 3: Implement the guard**

Edit [apps/server/apps/gateway/src/applications/installed-applications.service.ts](../../../apps/server/apps/gateway/src/applications/installed-applications.service.ts). In `install()` (around line 183), insert the new guard immediately after the `if (!handler)` block and before the singleton check. Replace:

```ts
    // Fail fast if no handler registered
    const handler = this.handlers.get(dto.applicationId);
    if (!handler) {
      throw new NotFoundException(
        `No handler registered for application: ${dto.applicationId}`,
      );
    }

    // Check singleton constraint
    const appDefinition = this.applicationsService.findById(dto.applicationId);
    if (appDefinition?.singleton) {
```

with:

```ts
    // Fail fast if no handler registered
    const handler = this.handlers.get(dto.applicationId);
    if (!handler) {
      throw new NotFoundException(
        `No handler registered for application: ${dto.applicationId}`,
      );
    }

    // Reject new installs of soft-retired (hidden) applications.
    // Existing installs keep working via the rest of this module.
    const appDefinition = this.applicationsService.findById(dto.applicationId);
    if (appDefinition?.hidden) {
      throw new ForbiddenException(
        `Application ${appDefinition.name} is no longer available for new installation`,
      );
    }

    // Check singleton constraint
    if (appDefinition?.singleton) {
```

Important: the old block had `const appDefinition = ...` inside the singleton check. The new code declares `appDefinition` once above and reuses it. Verify the final file has only one `const appDefinition =` declaration in `install()`.

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `cd /Users/winrey/Projects/weightwave/team9 && pnpm --filter @team9/gateway test -- --testPathPattern 'installed-applications.service.spec'`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/server/apps/gateway/src/applications/installed-applications.service.ts \
        apps/server/apps/gateway/src/applications/installed-applications.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(applications): reject new installs of hidden apps

Guard InstalledApplicationsService.install against hidden applications
before the DB insert. Unknown applicationIds still 404; already-installed
hidden apps continue to work and can be uninstalled.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Full-module verification

**Goal:** Confirm the whole `applications` module (including controller specs that exercise OpenClaw flows) stays green and the gateway still compiles.

**Files:** none (verification only)

**Acceptance Criteria:**

- [ ] `pnpm --filter @team9/gateway test -- --testPathPattern applications` is green.
- [ ] `pnpm build:server` succeeds.
- [ ] No new TypeScript errors across the gateway.

**Verify:** Commands below all succeed.

**Steps:**

- [ ] **Step 1: Run the applications module test suite**

Run: `cd /Users/winrey/Projects/weightwave/team9 && pnpm --filter @team9/gateway test -- --testPathPattern applications`

Expected: green. Pay attention to `installed-applications.controller.spec.ts` and any other spec that implicitly assumed `openclaw` was discoverable in a plain `/applications` response for a fresh tenant — pivot those fixtures to a tenant that has already installed it, or assert the new absence behavior. Fix inline.

- [ ] **Step 2: Type-check the gateway build**

Run: `cd /Users/winrey/Projects/weightwave/team9 && pnpm build:server`

Expected: build succeeds.

- [ ] **Step 3: If any fixups were needed in Step 1, commit them**

```bash
git add <fixed-files>
git commit -m "$(cat <<'EOF'
test(applications): adjust fixtures for hidden openclaw

Tests that implicitly assumed openclaw was discoverable in fresh-tenant
list responses are updated to seed an installed-applications row or to
assert its absence, per the hidden soft-retire contract.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

If no fixups were needed, skip the commit.

---

## Self-Review Checklist (for plan author, before handoff)

- [x] Every spec goal has a task: type + service (Task 1), list/detail filtering (Task 2), install guard (Task 3).
- [x] Every task has exact files, exact commands, complete code in steps, and a verify command.
- [x] No TBD / TODO / "similar to Task N" / "handle edge cases" — all code blocks are complete and consistent.
- [x] Type/method names match across tasks: `findAllVisible(Set<string>)`, `findByApplicationId`, `hidden?: boolean`.
- [x] Task 2 mirrors sibling controller pattern (`AuthGuard + WorkspaceGuard`, `CurrentTenantId`) so the guards + decorator are imported from the same paths already used in `installed-applications.controller.ts`.
- [x] Task 4 covers the spec's "integration / regression" section by running the full module suite and allows for inline fixups.
