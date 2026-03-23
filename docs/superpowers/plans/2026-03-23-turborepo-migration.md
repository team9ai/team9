# Turborepo Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `concurrently` with Turborepo for unified dev/build/test/lint task orchestration across the Team9 monorepo.

**Architecture:** Add a root-level `turbo.json` defining task pipelines with dependency graph and caching. Standardize `dev` script names across packages. Update root and server `package.json` scripts to delegate to `turbo run`.

**Tech Stack:** Turborepo v2, pnpm workspaces

**Spec:** `docs/superpowers/specs/2026-03-23-turborepo-migration-design.md`

---

## File Map

| Action | File                                        | Responsibility                                     |
| ------ | ------------------------------------------- | -------------------------------------------------- |
| Create | `turbo.json`                                | Task pipeline definitions (build, dev, test, lint) |
| Modify | `package.json`                              | Root scripts + dependency changes                  |
| Modify | `apps/server/package.json`                  | Server convenience scripts + remove concurrently   |
| Modify | `apps/server/apps/gateway/package.json`     | Add `dev` script alias                             |
| Modify | `apps/server/apps/im-worker/package.json`   | Add `dev` script alias                             |
| Modify | `apps/server/apps/task-worker/package.json` | Add `dev` script alias                             |
| Modify | `apps/client/package.json`                  | Add `dev` script alias                             |
| Modify | `.gitignore`                                | Exclude `.turbo/` directory                        |

---

### Task 1: Install turbo and remove concurrently

**Files:**

- Modify: `package.json` (root devDependencies)
- Modify: `apps/server/package.json` (devDependencies)

- [ ] **Step 1: Install turbo as root devDependency**

Run: `pnpm add -Dw turbo`

- [ ] **Step 2: Remove concurrently from root**

Run: `pnpm remove -w concurrently`

- [ ] **Step 3: Remove concurrently from server**

Run: `pnpm -C apps/server remove concurrently`

- [ ] **Step 4: Verify installation**

Run: `pnpm turbo --version`
Expected: Turbo version prints (e.g., `2.x.x`)

- [ ] **Step 5: Commit**

```bash
git add package.json apps/server/package.json pnpm-lock.yaml
git commit -m "chore: add turbo, remove concurrently"
```

---

### Task 2: Create turbo.json

**Files:**

- Create: `turbo.json`

- [ ] **Step 1: Create turbo.json at repo root**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"],
      "env": ["EDITION"]
    },
    "dev": {
      "persistent": true,
      "cache": false
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "test:cov": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"]
    },
    "lint": {}
  }
}
```

- [ ] **Step 2: Add .turbo to .gitignore**

Append to `.gitignore`:

```
# Turbo
.turbo
```

- [ ] **Step 3: Verify turbo recognizes the config**

Run: `pnpm turbo run build --dry`
Expected: Turbo prints the task graph showing packages with `build` scripts, ordered by dependencies. No errors.

- [ ] **Step 4: Commit**

```bash
git add turbo.json .gitignore
git commit -m "chore: add turbo.json pipeline config and .gitignore"
```

---

### Task 3: Add `dev` script aliases to packages

**Files:**

- Modify: `apps/server/apps/gateway/package.json` — add `"dev"` script
- Modify: `apps/server/apps/im-worker/package.json` — add `"dev"` script
- Modify: `apps/server/apps/task-worker/package.json` — add `"dev"` script
- Modify: `apps/client/package.json` — add `"dev"` script

- [ ] **Step 1: Add `dev` to gateway**

In `apps/server/apps/gateway/package.json`, add to `scripts`:

```json
"dev": "node --loader @swc-node/register/esm --watch src/main.ts",
```

This is identical to the existing `start:dev` script. Keep `start:dev` as-is.

- [ ] **Step 2: Add `dev` to im-worker**

In `apps/server/apps/im-worker/package.json`, add to `scripts`:

```json
"dev": "node --loader @swc-node/register/esm --watch src/main.ts",
```

- [ ] **Step 3: Add `dev` to task-worker**

In `apps/server/apps/task-worker/package.json`, add to `scripts`:

```json
"dev": "node --loader @swc-node/register/esm --watch src/main.ts",
```

- [ ] **Step 4: Add `dev` to client**

In `apps/client/package.json`, add to `scripts`:

```json
"dev": "vite",
```

This is identical to the existing `dev:web` script. Keep `dev:web` as-is.

- [ ] **Step 5: Verify turbo sees the dev tasks**

Run: `pnpm turbo run dev --dry --filter=@team9/gateway --filter=@team9/im-worker --filter=@team9/task-worker --filter=@team9/client`
Expected: Turbo lists all 4 packages in the task graph for `dev`.

- [ ] **Step 6: Commit**

```bash
git add apps/server/apps/gateway/package.json apps/server/apps/im-worker/package.json apps/server/apps/task-worker/package.json apps/client/package.json
git commit -m "chore: add standardized dev script aliases for turbo"
```

---

### Task 4: Update root package.json scripts

**Files:**

- Modify: `package.json` (root `scripts` section)

- [ ] **Step 1: Replace all scripts in root package.json**

Replace the entire `scripts` section with:

```json
"scripts": {
  "dev": "turbo run dev --filter=@team9/client --filter=@team9/gateway --filter=@team9/im-worker --filter=@team9/task-worker",
  "dev:client": "turbo run dev --filter=@team9/client",
  "dev:desktop": "pnpm -C apps/client dev:desktop",
  "dev:server": "turbo run dev --filter=@team9/gateway",
  "dev:im-worker": "turbo run dev --filter=@team9/im-worker",
  "dev:task-worker": "turbo run dev --filter=@team9/task-worker",
  "dev:server:all": "turbo run dev --filter=@team9/gateway --filter=@team9/im-worker --filter=@team9/task-worker",
  "build": "turbo run build",
  "build:server": "turbo run build --filter=@team9/gateway... --filter=@team9/im-worker... --filter=@team9/task-worker...",
  "build:client": "turbo run build --filter=@team9/client",
  "build:client:mac": "pnpm -C apps/client build:mac",
  "build:client:windows": "pnpm -C apps/client build:windows",
  "test": "turbo run test",
  "test:cov": "turbo run test:cov",
  "lint": "turbo run lint",
  "start:prod": "pnpm -C apps/server start:prod",
  "db:generate": "pnpm -C apps/server db:generate",
  "db:migrate": "pnpm -C apps/server db:migrate",
  "db:push": "pnpm -C apps/server db:push",
  "db:studio": "pnpm -C apps/server db:studio",
  "dev:debugger": "turbo run dev --filter=@team9/debugger",
  "prepare": "husky"
}
```

Scripts removed: `install:all`, `clean`, `dev:server:all` (old concurrently version).
Scripts kept as-is: `dev:desktop`, `build:client:mac`, `build:client:windows`, `start:prod`, all `db:*`, `prepare`.

- [ ] **Step 2: Verify root scripts resolve**

Run: `pnpm turbo run build --dry`
Expected: Turbo prints the full build dependency graph for all packages. (Note: use `pnpm turbo` directly, not `pnpm run build --dry`, because pnpm does not forward `--dry` to turbo.)

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: update root scripts to use turbo"
```

---

### Task 5: Update apps/server/package.json scripts

**Files:**

- Modify: `apps/server/package.json` (`scripts` section)

- [ ] **Step 1: Replace scripts section**

Replace the entire `scripts` section in `apps/server/package.json` with:

```json
"scripts": {
  "dev": "turbo run dev --filter=@team9/gateway",
  "dev:im-worker": "turbo run dev --filter=@team9/im-worker",
  "dev:task-worker": "turbo run dev --filter=@team9/task-worker",
  "dev:all": "turbo run dev --filter=@team9/gateway --filter=@team9/im-worker --filter=@team9/task-worker",
  "dev:enterprise": "EDITION=enterprise turbo run dev --filter=@team9/gateway",
  "build": "turbo run build --filter=@team9/gateway... --filter=@team9/im-worker... --filter=@team9/task-worker...",
  "build:main": "turbo run build --filter=@team9/gateway...",
  "build:community": "EDITION=community turbo run build --filter=@team9/gateway...",
  "build:enterprise": "EDITION=enterprise turbo run build --filter=@team9/gateway...",
  "start:prod": "pnpm --filter @team9/gateway start:prod",
  "start:community": "EDITION=community pnpm --filter @team9/gateway start:prod",
  "start:enterprise": "EDITION=enterprise pnpm --filter @team9/gateway start:prod",
  "format": "prettier --write \"apps/**/*.ts\" \"libs/**/*.ts\" \"test/**/*.ts\"",
  "lint": "eslint \"{apps,libs,test}/**/*.ts\" --fix",
  "test": "turbo run test --filter=@team9/gateway --filter=@team9/im-worker --filter=@team9/task-worker",
  "test:watch": "pnpm --filter \"./apps/**\" test:watch",
  "test:cov": "turbo run test:cov --filter=@team9/gateway --filter=@team9/im-worker --filter=@team9/task-worker",
  "db:generate": "pnpm --filter @team9/database db:generate",
  "db:migrate": "pnpm --filter @team9/database db:migrate",
  "db:push": "pnpm --filter @team9/database db:push",
  "db:studio": "pnpm --filter @team9/database db:studio",
  "clean": "pnpm --recursive exec rm -rf dist node_modules",
  "submodule:init": "git submodule update --init --recursive",
  "submodule:update": "git submodule update --remote --merge"
}
```

Scripts replaced: `dev:all` (concurrently → turbo), `build` (pnpm --filter → turbo), `dev` (pnpm --filter → turbo), `test`/`test:cov` (pnpm --filter → turbo), `start:community`/`start:enterprise` (self-referencing → explicit filter).
Scripts kept as-is: `format`, `lint`, `test:watch`, all `db:*`, `clean`, `submodule:*`.

- [ ] **Step 2: Verify server build resolves**

Run: `pnpm turbo run build --filter=@team9/gateway... --filter=@team9/im-worker... --filter=@team9/task-worker... --dry`
Expected: Turbo prints the build graph for all server apps + libs. (Note: use `pnpm turbo` directly to pass `--dry` correctly.)

- [ ] **Step 3: Commit**

```bash
git add apps/server/package.json
git commit -m "chore: update server scripts to use turbo"
```

---

### Task 6: Smoke test — build pipeline

**Files:** None (verification only)

- [ ] **Step 1: Clean previous build artifacts (dist only)**

Run: `find apps/server -name "dist" -type d -maxdepth 4 -exec rm -rf {} + 2>/dev/null; true`
This removes only `dist/` directories in server packages without touching `node_modules/`. Do NOT use `pnpm -C apps/server clean` here — it also deletes `node_modules/`, which would require reinstalling and could temporarily break turbo resolution.

- [ ] **Step 2: Run full server build via turbo**

Run: `pnpm build:server`
Expected: Turbo builds libs first (respecting `^build` dependency order), then apps. All packages build successfully. Output shows task execution order.

- [ ] **Step 3: Run build again to verify caching**

Run: `pnpm build:server`
Expected: Turbo reports all tasks as `FULL TURBO` (cache hit) — near-instant completion.

- [ ] **Step 4: Run client build**

Run: `pnpm build:client`
Expected: Vite build succeeds.

- [ ] **Step 5: Run full build**

Run: `pnpm build`
Expected: All packages build. Server packages hit cache, client builds fresh (or cached if run after step 4).

- [ ] **Step 6: (Conditional) Verify enterprise build if submodule is present**

Run: `ls enterprise/libs/ 2>/dev/null && pnpm turbo run build --filter=@team9/gateway... --env-mode=strict -- --force || echo "Enterprise submodule not present, skipping"`
If the enterprise submodule exists, turbo should build enterprise libs + gateway without error. If the submodule is absent, this step is skipped.

- [ ] **Step 7: Commit (if any adjustments were needed)**

If any fixes were made during smoke testing, commit them:

```bash
git add -A
git commit -m "fix: adjust turbo config based on build smoke test"
```

---

### Task 7: Smoke test — test pipeline

**Files:** None (verification only)

- [ ] **Step 1: Run tests via turbo**

Run: `pnpm test`
Expected: Turbo runs `test` script in all packages that have one (gateway, im-worker, task-worker, client). Tests pass or fail as they do today — turbo is just the orchestrator.

- [ ] **Step 2: Run server-scoped tests**

Run: `pnpm -C apps/server test`
Expected: Runs tests for gateway, im-worker, task-worker only.

- [ ] **Step 3: Run test:cov and verify client is gracefully skipped**

Run: `pnpm test:cov`
Expected: Turbo runs `test:cov` for gateway, im-worker, task-worker. `@team9/client` is skipped (no `test:cov` script) without error.

- [ ] **Step 4: Commit (if any adjustments were needed)**

If any fixes were made, commit:

```bash
git add -A
git commit -m "fix: adjust turbo config based on test smoke test"
```

---

### Task 8: Smoke test — lint pipeline

**Files:** None (verification only)

- [ ] **Step 1: Run lint via turbo**

Run: `pnpm lint`
Expected: Turbo runs `lint` script in `@team9/server` (the only package with a lint script). Lint passes or shows existing warnings — no change in behavior.

- [ ] **Step 2: Commit (if any adjustments were needed)**

If any fixes were made, commit:

```bash
git add -A
git commit -m "fix: adjust turbo config based on lint smoke test"
```

---

### Task 9: Update CLAUDE.md

**Files:**

- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the Common Commands section**

The `pnpm dev` command description should note it now uses Turborepo. No other changes needed — the command names are the same, only the underlying orchestrator changed.

Add a brief note under the Development section:

```markdown
> Note: `pnpm dev` and other scripts use Turborepo for task orchestration.
> Build artifacts are cached locally in `.turbo/`. Run `turbo run build`
> directly if you need fine-grained control (e.g., `--filter`, `--dry`).
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with turbo notes"
```
