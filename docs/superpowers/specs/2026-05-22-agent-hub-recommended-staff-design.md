# AgentHub Recommended Staff — Design

**Date:** 2026-05-22
**Status:** Approved for implementation planning
**Author:** Codex (brainstorming)

## 1. Background

Team9 already has an AI Staff page backed by installed applications and bots. Common Staff creation is implemented through `CommonStaffService` and `StaffService.createBotWithAgent`, which creates a Team9 bot, adds it to the workspace, stores staff profile data in `im_bots.extra.commonStaff`, and registers a Hive agent with Team9 runtime component configs.

AgentHive also has reusable `PrefabAgentTemplate` records. Team9 needs an AgentHubApp surface where users can see recommended staff templates and install one into the current workspace with one action.

This design adds a dedicated AgentHub boundary in Team9. AgentHub reads AgentHive prefab templates, filters templates that opt into Team9 via `metadata.team9`, caches the filtered template catalog, and installs selected templates as Common Staff bots.

## 2. Goals

- Show recommended staff on the existing Employee / AI Staff page.
- Source recommendations from AgentHive `PrefabAgentTemplate` records where `metadata.team9` has a value.
- Cache the AgentHive template list so the employee page does not hit AgentHive on every render.
- Let a workspace member install a recommended staff template with one click.
- Reuse the existing Common Staff bot and Hive registration path so installed recommended staff behave like normal Team9 staff.
- Support template-level uniqueness with `metadata.team9.unique`.
- Preserve `metadata.team9.shortRoleTitle` when present, and generate the short title when absent.
- Default `mentorId` to `null`, not the installing user.

## 3. Non-Goals

- A separate full AgentHub route or marketplace page. The first surface is the current AI Staff page.
- Frontend-to-AgentHive direct calls. The Team9 gateway owns AgentHive auth, caching, filtering, and install orchestration.
- Installing non-staff prefab types. This version only supports recommended Common Staff.
- Template editing in Team9.

## 4. AgentHubApp

Add an `agent-hub` application definition:

- `id: "agent-hub"`
- `name: "Agent Hub"`
- `type: "managed"`
- `singleton: true`
- `autoInstall: true`
- `categories: ["ai", "bot"]`

The app does not create a bot during installation. It represents the AgentHub capability and gives the product a durable app identity for future expansion. The recommended staff API is exposed through a new `AgentHubModule`, not through the installed application controller.

The existing `common-staff` app remains the app that owns installed recommended staff bots.

## 5. AgentHive Template Contract

Team9 consumes AgentHive prefab templates through the gateway-side Hive client. The concrete HTTP endpoint is hidden behind `ClawHiveService` so business code does not know AgentHive paths or headers.

Team9 expects the normalized template shape:

```ts
interface PrefabAgentTemplate {
  id: string;
  name: string;
  description?: string;
  blueprintId: string;
  model?: { provider: string; id: string };
  componentConfigs?: Record<string, Record<string, unknown>>;
  metadata?: {
    team9?: Team9PrefabStaffMetadata;
    [key: string]: unknown;
  };
}

interface Team9PrefabStaffMetadata {
  displayName?: string;
  roleTitle: string;
  shortRoleTitle?: string;
  persona?: string;
  jobDescription?: string;
  avatarUrl?: string;
  model?: { provider: string; id: string };
  unique?: boolean;
}
```

A template is recommended for Team9 when `metadata.team9` is an object and `metadata.team9.roleTitle` is a non-empty string. `displayName` falls back to the template name. `unique` defaults to `false`.

Model precedence during install:

1. `metadata.team9.model`
2. template top-level `model`
3. Team9 default Common Staff model: `{ provider: "openrouter", id: "anthropic/claude-sonnet-4.6" }`

Short role title precedence during install:

1. `metadata.team9.shortRoleTitle`
2. `StaffService.generateShortRoleTitle(...)` from `metadata.team9.roleTitle`
3. `null` if generation fails

## 6. Cache Behavior

AgentHub caches the filtered recommended staff template catalog in Redis.

Cache keys:

- Catalog: `agent-hub:team9-prefab-staff:v1`

TTL policy:

- Redis TTL: 24 hours.
- Freshness window: 5 minutes, computed from payload `cachedAt`.

List flow:

1. If the cached payload is fresh, return cached templates.
2. If cache is missing or stale, fetch AgentHive `PrefabAgentTemplate` records.
3. Filter and normalize templates with Team9 metadata.
4. Store the normalized templates in Redis with `cachedAt`.
5. If AgentHive fetch fails and a stale cached payload exists, return stale templates.
6. If AgentHive fetch fails and there is no cached payload, return an upstream error.

The cache stores only template data. Installed state is never cached. `installed` and `installedBotId` are computed from Team9 DB for each request so the UI updates immediately after installation.

Install flow:

1. Look up `templateId` in the cached template catalog.
2. On cache miss, force-refresh AgentHive once.
3. If still not found, return `404`.
4. Run uniqueness checks from DB before creating anything.

## 7. Backend API

Expose two authenticated, workspace-scoped endpoints:

```http
GET /api/v1/agent-hub/recommended-staff
POST /api/v1/agent-hub/recommended-staff/:templateId/install
```

Response shape:

```ts
interface RecommendedStaffTemplate {
  templateId: string;
  name: string;
  description?: string;
  displayName: string;
  roleTitle: string;
  shortRoleTitle?: string | null;
  persona?: string | null;
  jobDescription?: string | null;
  avatarUrl?: string | null;
  model: { provider: string; id: string };
  unique: boolean;
  installed: boolean;
  installedBotId?: string;
}
```

Install request:

```ts
interface InstallRecommendedStaffDto {
  mentorId?: string | null;
}
```

Install response uses the existing staff result shape:

```ts
interface StaffBotResult {
  botId: string;
  userId: string;
  agentId: string;
  displayName: string;
}
```

Authorization:

- Listing requires an authenticated workspace member.
- Installing requires an authenticated workspace member, matching the existing Common Staff creation behavior.
- If `mentorId` is provided, the mentor must be a human member of the current workspace.
- If `mentorId` is omitted or `null`, the bot mentor remains `null`; Team9 does not create a mentor DM and does not trigger staff bootstrap.

## 8. Install Data Flow

`AgentHubService.installRecommendedStaff(...)`:

1. Resolve the current tenant and installing user.
2. Load the normalized template by `templateId`.
3. Find the current tenant's installed `common-staff` app. If it is missing, call `InstalledApplicationsService.ensureAutoInstallApps(tenantId, installingUserId)` once and query again. If it is still missing, return `503 Service Unavailable`.
4. If `template.unique === true`, query existing bots for the same template in the current workspace. If one exists, return `409 Conflict`.
5. Validate `mentorId` only when provided.
6. Build `BotExtra.commonStaff`:

```ts
{
  commonStaff: {
    roleTitle: template.roleTitle,
    shortRoleTitle: resolvedShortRoleTitle,
    persona: template.persona,
    jobDescription: template.jobDescription,
    model: template.model,
    identity: { name: template.displayName },
    prefabTemplateId: template.templateId
  }
}
```

7. Call `StaffService.createBotWithAgent` with:
   - `agentIdPrefix: "common-staff"`
   - `blueprintId: template.blueprintId`
   - `ownerId: installingUserId`
   - `tenantId`
   - `displayName: template.displayName`
   - `installedApplicationId: commonStaffInstalledApp.id`
   - `mentorId: null` unless explicitly provided
   - `avatarUrl: template.avatarUrl`
   - `model: template.model`
   - `botExtra`
   - `extraComponentConfigs` equal to the template configs plus required Team9 runtime configs
8. Store template traceability in `managedMeta.prefabTemplateId` as well as `extra.commonStaff.prefabTemplateId`.
9. If a mentor was provided, create the mentor DM through the existing Common Staff behavior.
10. Return the created staff result.

`StaffService.createBotWithAgent` must accept `mentorId?: string | null`. The Hive agent metadata should include `mentorId: null` when no mentor is assigned.

`BotService.createWorkspaceBot` must also allow `mentorId?: string | null` without dropping explicitly-null values.

## 9. Template Config Merge

Recommended staff templates own their `blueprintId`, base model, and declared component configs. Team9 still injects required runtime configs for authentication, workspace mounting, and staff profile support.

Merge policy:

- Start with template `componentConfigs`.
- Overlay Team9-required configs:
  - `team9`
  - `team9-staff-profile`
  - `team9-staff-soul`
  - `folder9`
  - `just-bash`
  - `just-bash-team9-workspace`
- Do not add `team9-staff-bootstrap` for no-mentor installs because no bootstrap session is fired.
- If a template declares one of the required config keys, Team9's required values win for security-critical fields such as auth token, bot user ID, and workspace ID.

## 10. Uniqueness

`metadata.team9.unique === true` means one installed bot per `(tenantId, prefabTemplateId)`.

The uniqueness check uses Team9 DB, not Redis:

- Query active bots in the tenant's `common-staff` installed app.
- Match either `managedMeta.prefabTemplateId === templateId` or `extra.commonStaff.prefabTemplateId === templateId`.
- If found, return `409 Conflict` with the existing `botId`.

No new DB index is required for v1 because this is a small list scoped to one installed app. If the template catalog grows large, a future migration can add a generated column or a dedicated installation table.

## 11. Frontend UX

Add a "Recommended Staff" section to `AIStaffMainContent`, positioned before the existing AI Staff section.

Frontend API additions:

```ts
applicationsApi.getRecommendedStaffTemplates()
applicationsApi.installRecommendedStaff(templateId, { mentorId?: string | null })
```

Card content:

- Avatar
- Display name
- Role title
- Short role title badge when present
- Description or job description preview
- Install button

Installed behavior:

- `installed: true` shows an "Installed" button state.
- If `installedBotId` is present, clicking the card navigates to `/ai-staff/$staffId`.
- `unique: false` templates remain installable after previous installs. After install, navigate to the new staff detail page.

Mutation behavior:

- Default install request body omits `mentorId`, so the server stores `mentorId: null`.
- On success, invalidate:
  - `agent-hub-recommended-staff`
  - `installed-applications-with-bots`
- On `409 Conflict`, invalidate `agent-hub-recommended-staff` so the UI reflects the installed state.

The section reuses the existing employee page density and card style. It is not a landing page and does not introduce a separate AgentHub route in v1.

## 12. Error Handling

List endpoint:

- AgentHive unavailable and stale cache exists: return stale data.
- AgentHive unavailable and no stale cache exists: return `503 Service Unavailable`.
- Malformed templates are skipped and logged with template ID.

Install endpoint:

- Template not found after forced refresh: `404 Not Found`.
- Unique template already installed: `409 Conflict`.
- Common Staff app missing after auto-install attempt: `503 Service Unavailable`.
- Invalid mentor ID: `400 Bad Request`.
- Hive agent registration failure: reuse `StaffService.createBotWithAgent` rollback behavior.

## 13. Testing

Backend tests:

- `ClawHiveService` lists prefab templates with correct auth headers and throws on non-ok responses.
- `AgentHubService` filters templates without `metadata.team9`.
- `AgentHubService` rejects templates missing `metadata.team9.roleTitle`.
- Redis fresh cache hit does not call AgentHive.
- AgentHive failure returns stale cache when available.
- Installed state is computed from DB and not from cache.
- `unique: true` duplicate install returns conflict.
- Install without `mentorId` passes `mentorId: null`, registers Hive metadata with `mentorId: null`, and does not create mentor DM.
- `shortRoleTitle` comes from template metadata when present.
- Missing `shortRoleTitle` calls `StaffService.generateShortRoleTitle`.
- Generated short title failure does not fail installation.

Frontend tests:

- API client uses `/v1/agent-hub/recommended-staff`.
- Recommended staff section renders loading, error, empty, installable, and installed states.
- Install success invalidates recommended staff and installed-bots queries.
- Install success navigates to the new staff detail page.
- `409 Conflict` invalidates recommended staff and leaves the page usable.

## 14. Implementation Units

Expected backend files:

- `apps/server/libs/claw-hive/src/claw-hive.service.ts`
- `apps/server/apps/gateway/src/applications/applications.service.ts`
- `apps/server/apps/gateway/src/applications/handlers/index.ts`
- `apps/server/apps/gateway/src/applications/handlers/agent-hub.handler.ts`
- `apps/server/apps/gateway/src/agent-hub/agent-hub.module.ts`
- `apps/server/apps/gateway/src/agent-hub/agent-hub.controller.ts`
- `apps/server/apps/gateway/src/agent-hub/agent-hub.service.ts`
- `apps/server/apps/gateway/src/agent-hub/dto/install-recommended-staff.dto.ts`
- `apps/server/apps/gateway/src/app.module.ts`
- `apps/server/apps/gateway/src/applications/staff.service.ts`
- `apps/server/apps/gateway/src/bot/bot.service.ts`
- `apps/server/libs/database/src/schemas/im/bots.ts`

Expected frontend files:

- `apps/client/src/services/api/applications.ts`
- `apps/client/src/components/layout/contents/AIStaffMainContent.tsx`
- `apps/client/src/i18n/locales/en/navigation.json`
- `apps/client/src/i18n/locales/zh-CN/navigation.json`

Other locale files can receive English fallback strings if this repo's current i18n checks require complete namespace coverage.
