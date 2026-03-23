# Turborepo Migration Design

## Background

The Team9 monorepo currently uses `concurrently` to run parallel dev tasks and `pnpm --filter` for build/test orchestration. This works but lacks:

- Build caching (repeated builds recompute everything)
- Dependency-aware task ordering (manual coordination via script chaining)
- Unified task pipeline across the monorepo

## Goal

Replace `concurrently` with Turborepo for all task orchestration (dev, build, test, lint), with:

- Strict dependency graph for `build` pipeline
- Local caching for build/test/lint
- Standardized script names across all packages
- `apps/server/package.json` retained as convenience entry point

## Design

### 1. turbo.json (root level)

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

- `build`: Strict dependency graph via `^build` (upstream libs build first). Outputs cached in `dist/**`. `env: ["EDITION"]` ensures community/enterprise builds have separate cache keys, preventing cross-edition cache pollution. **Trade-off:** This is a global task-level setting — `@team9/client` builds will also get separate cache entries per `EDITION` value even though the client ignores it. The impact is minimal (one extra cache entry when running full builds with `EDITION` set) and avoids the complexity of per-package turbo.json overrides.
- `dev`: Persistent (long-running), no cache. Does NOT depend on `^build` because server apps use `@swc-node/register` runtime transpilation and client uses Vite — neither requires pre-built libs. **Exception:** `@team9/shared` copies proto files into `dist/` during build; if NestJS apps use gRPC, proto files won't exist until shared is built. See "Known Risks" for the workaround (`turbo run build --filter=@team9/shared` once before the first dev session).
- `test` / `test:cov`: Depend on upstream build for correctness.
- `lint`: Independent, no dependencies. Currently only `@team9/server` has a lint script.

### 2. Package Script Standardization

Add `dev` script aliases so turbo can discover them uniformly:

| Package              | Change    | Script Content                                             |
| -------------------- | --------- | ---------------------------------------------------------- |
| `@team9/gateway`     | Add `dev` | `node --loader @swc-node/register/esm --watch src/main.ts` |
| `@team9/im-worker`   | Add `dev` | `node --loader @swc-node/register/esm --watch src/main.ts` |
| `@team9/task-worker` | Add `dev` | `node --loader @swc-node/register/esm --watch src/main.ts` |
| `@team9/client`      | Add `dev` | `vite`                                                     |
| `@team9/debugger`    | No change | Already has `"dev": "vite"`                                |

Existing scripts (`start:dev`, `dev:web`, `dev:desktop`, etc.) are retained for backward compatibility and special entry points (e.g., Tauri desktop).

Libs have no `dev` script — turbo skips them automatically.

### 3. Root package.json Scripts

```json
{
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
}
```

Key decisions:

- `dev` uses explicit `--filter` for 4 core services (excludes debugger), matching current behavior.
- `build:server` uses `--filter=@team9/gateway... --filter=@team9/im-worker... --filter=@team9/task-worker...` to build all three server apps and their transitive dependencies.
- `dev:desktop`, `build:client:mac/windows`, `db:*`, `start:prod` stay as `pnpm -C` (not suitable for turbo).
- `install:all` removed (pnpm workspaces handles this).
- `clean` removed from root (can be re-added later via turbo if needed).

### 4. apps/server/package.json Scripts (Convenience Entry)

```json
{
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
}
```

Key decisions:

- dev/build/test delegate to turbo for caching and dependency graph.
- `test:watch` stays as pnpm (watch mode not suitable for turbo).
- `lint`, `format`, `db:*`, `start:*`, `clean`, `submodule:*` unchanged.

### 5. Dependency Changes

| Action | Package                         | Dependency     |
| ------ | ------------------------------- | -------------- |
| Add    | Root devDependencies            | `turbo`        |
| Remove | Root devDependencies            | `concurrently` |
| Remove | `@team9/server` devDependencies | `concurrently` |

### 6. .gitignore

Append:

```
# Turbo
.turbo
```

## Known Risks & Notes

- **Proto files in dev mode:** `@team9/shared` copies proto files to `dist/` during build. If gRPC is used, run `turbo run build --filter=@team9/shared` once before the first dev session.
- **Enterprise packages:** `enterprise/libs/*` packages have `main`/`types` pointing to `src/index.ts` instead of `dist/`. This is a pre-existing issue not introduced by this migration, but turbo's `^build` will build them when the submodule is present. Their `dist/` outputs will be cached correctly, but downstream consumers import from `src/` — this should be addressed separately.
- **Client test coverage:** `@team9/client` has `test` (vitest) but no `test:cov` script. It is excluded from the `test:cov` pipeline. This can be addressed separately by adding `"test:cov": "vitest run --coverage"`.
- **Coverage output paths:** Server app jest configs may write coverage to `../coverage/` (relative to the package root). Turbo's `outputs: ["coverage/**"]` resolves relative to each package. If coverage caching is needed, jest configs should be updated to write to `./coverage/` within their own directory.

## Out of Scope

- Remote caching (Vercel) — can be added later
- Per-package lint scripts — currently lint runs at the `apps/server` level only
- Turbo code generation or plugins
- CI/CD pipeline changes (existing CI scripts will continue to work via root scripts)
