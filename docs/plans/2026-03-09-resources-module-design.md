# Resources Module Design

**Date:** 2026-03-09
**Status:** Approved

## Overview

Add a new "Resources" (资源) module as a top-level sidebar navigation entry between Tasks and Library. Resources are workspace-level shared assets that Agents and users consume during task execution. Two resource types at launch: **Agent Computer** (servers, Ahand-connected local machines) and **API** (configurable API keys for AI services).

Demo phase: full CRUD with real persistence, extensible architecture for future resource types.

## Resource Types

| Type             | Description                                                                       |
| ---------------- | --------------------------------------------------------------------------------- |
| `agent_computer` | Servers and local computers connected via Ahand/SSH/Cloud that Agents can operate |
| `api`            | API keys (OpenAI, Google, GitHub, custom) configurable for AI/Agent use           |

## Data Model

### Approach: Single Polymorphic Table (方案 A)

One `resources` table with `type` enum + `config` JSONB. Authorizations stored as JSONB array on the resource row. Usage logs in a separate table due to volume.

### Table 1: `resources`

| Column              | Type                    | Description                                      |
| ------------------- | ----------------------- | ------------------------------------------------ |
| `id`                | UUID PK                 |                                                  |
| `tenant_id`         | UUID FK → tenants       | Workspace ownership                              |
| `type`              | enum `resource__type`   | `agent_computer`, `api`                          |
| `name`              | VARCHAR(255)            | Display name                                     |
| `description`       | TEXT                    | Optional description                             |
| `config`            | JSONB                   | Type-specific configuration (see below)          |
| `status`            | enum `resource__status` | `online`, `offline`, `error`, `configuring`      |
| `authorizations`    | JSONB                   | Array of authorization entries                   |
| `last_heartbeat_at` | TIMESTAMP               | Heartbeat for Agent Computers (nullable for API) |
| `creator_id`        | UUID FK → users         | Creator                                          |
| `created_at`        | TIMESTAMP               |                                                  |
| `updated_at`        | TIMESTAMP               |                                                  |

**Indexes:**

- `idx_resources_tenant_id` on `(tenant_id)`
- `idx_resources_tenant_type` on `(tenant_id, type)`
- `idx_resources_status` on `(status)`

### Config Schemas

```typescript
// Agent Computer
interface AgentComputerConfig {
  connectionType: "ahand" | "ssh" | "cloud";
  host?: string;
  port?: number;
  os?: string;
  arch?: string;
  // Future: capabilities, installed tools, etc.
}

// API
interface ApiResourceConfig {
  provider: string; // e.g. 'openai', 'google', 'github', 'custom'
  baseUrl?: string;
  apiKey: string; // Demo: plaintext; future: encrypted
  model?: string;
  // Future: rate limits, quotas, etc.
}

type ResourceConfig = AgentComputerConfig | ApiResourceConfig;
```

### Authorization Schema (JSONB array on `resources.authorizations`)

```typescript
interface ResourceAuthorization {
  granteeType: "user" | "task";
  granteeId: string;
  permissions: { level: "full" | "readonly" };
  grantedBy: string; // userId
  grantedAt: string; // ISO timestamp
}
```

Separate authorize/revoke endpoints for clean semantics and future table extraction.

### Table 2: `resource_usage_logs`

| Column         | Type                            | Description                                       |
| -------------- | ------------------------------- | ------------------------------------------------- |
| `id`           | UUID PK                         |                                                   |
| `resource_id`  | UUID FK → resources (CASCADE)   |                                                   |
| `actor_type`   | enum `resource__actor_type`     | `agent`, `user`                                   |
| `actor_id`     | UUID                            | Bot or user ID                                    |
| `task_id`      | UUID FK → tasks (nullable)      | Associated task                                   |
| `execution_id` | UUID FK → executions (nullable) | Associated run                                    |
| `action`       | VARCHAR(64)                     | e.g. `connect`, `disconnect`, `api_call`, `error` |
| `metadata`     | JSONB                           | Type-specific data (token usage, duration, etc.)  |
| `created_at`   | TIMESTAMP                       |                                                   |

**Indexes:**

- `idx_resource_usage_logs_resource_created` on `(resource_id, created_at)`
- `idx_resource_usage_logs_actor_created` on `(actor_id, created_at)`

## Backend API

### Resource CRUD

```
POST   /v1/resources              Create resource
GET    /v1/resources              List (supports ?type=agent_computer|api filter)
GET    /v1/resources/:id          Get detail
PATCH  /v1/resources/:id          Update (name, config, status, description)
DELETE /v1/resources/:id          Delete
```

### Authorization

```
POST   /v1/resources/:id/authorize     Add authorization (body: { granteeType, granteeId, permissions })
DELETE /v1/resources/:id/authorize      Remove authorization (body: { granteeType, granteeId })
```

Updates `authorizations` JSONB array. Separate endpoints preserve clean semantics and leave room for future table extraction.

### Usage Logs

```
GET    /v1/resources/:id/usage-logs    Query usage logs (pagination, time range)
POST   /v1/resources/:id/usage-logs    Write usage log (internal, called by Agent during execution)
```

### Heartbeat (Agent Computer)

```
POST   /v1/resources/:id/heartbeat     Ahand/agent periodic status report
```

Demo phase: updates `last_heartbeat_at` and `status`. Future: system info reporting.

## Frontend

### Sidebar Navigation

Insert between Tasks and Library in `MainSidebar.tsx`:

```typescript
{ id: "resources", labelKey: "resources" as const, icon: Box }
```

Update `SidebarSection` type, `ALL_SIDEBAR_SECTIONS`, `DEFAULT_SECTION_PATHS`, `getSectionFromPath()` in `useAppStore.ts`.

Route: `/resources` → `routes/_authenticated/resources/index.tsx`

i18n keys: `navigation.resources` → EN: "Resources", ZH: "资源"

### Page Layout

Card grid with filter tabs: `All` | `Agent Computer` | `API`

Top-right: "+ Create" button → Create Resource Dialog.

### Resource Cards

**Agent Computer card:**

- Name + status indicator (green online / gray offline / red error)
- Connection type label (Ahand / SSH / Cloud)
- OS/arch info (if available)
- "In use by XX Agent" tag (if active usage log exists)
- Authorization count badge

**API card:**

- Name + provider icon/label (OpenAI / Google / Custom)
- API Key masked display (`sk-...3f8a`)
- Recent call count summary (aggregated from usage logs)
- Authorization count badge

### Detail Panel (right slide-in, same pattern as Tasks)

- Basic info (name, description, type, config)
- Authorization list (users/tasks, add/remove)
- Usage log list (reverse chronological, paginated)

### Create Resource Dialog

Step 1: Select type → Step 2: Type-specific form:

- **Agent Computer**: Name, connection type, host/port (optional), description
- **API**: Name, provider (dropdown), API Key, Base URL (optional), description

## Extensibility Considerations

- New resource types: add enum value + config TypeScript interface + card component
- Authorization → separate table: change JSONB to FK without API changes (endpoints already isolated)
- API Key encryption: swap plaintext storage for encrypted JSONB field
- Heartbeat → WebSocket: upgrade from polling to persistent connection
- Resource capabilities: extend config with structured capability declarations
- Quotas/rate limiting: extend API config + add enforcement middleware
