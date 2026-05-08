# Folder9-Only Skills + Agent CRUD — Design

**Date:** 2026-05-09
**Status:** Draft
**Author:** Claude (auto-mode brainstorming)

## 1. Background

Team9 has a workspace-scoped Skill library backed by:

- DB: `skills` (metadata + folder9 pointer), `skill_versions` (publish/suggest workflow), `skill_files` (frozen snapshots per version).
- Storage: each skill has a folder9 `light` folder. `folderId` links the row to the folder9 folder; `skill.md` plus supporting files live there.
- Backend: `SkillsController` (`/v1/skills/...`) with metadata CRUD, folder9 proxy routes (`tree` / `blob` / `commit`), and a parallel "version" surface (`/versions`, `/versions/:v`, review endpoints).
- Frontend: `SkillsListPage`, `SkillDetailPage` with `FileTree` + `FileEditor`, `CreateSkillDialog`, `SuggestionReviewPanel`. The editor reads/writes via folder9 routes; the suggestion panel reads/writes via the version endpoints.

In parallel, the agent runtime (`team9-agent-pi`) has its own skill abstraction:

- `SkillComponent` (typeKey `skill-tier`) owns a `ResourceTierManager<TieredSkill>` with three tiers `summarized` / `listed` / `dormant` and exposes four LLM tools: `search_skills`, `load_skills`, `unload_skills`, `invoke_skill`.
- Skills enter the tier manager via `ISkillProvider`s. Existing providers: `MountedFolderSkillProvider` (read SKILL.md from a host-mounted path), `MemorySkillProvider`, source-code bundled skills.
- The agent talks to folder9 via `Folder9Component` (`mount_folder9` / `unmount_folder9` / `edit_file` / `submit_changes`). For tenant-owned folders, the agent does **not** hold the folder9 PSK — it asks the team9 gateway to mint a scoped token via `Team9FolderTokenApi.issueFolderToken` (which calls `POST /api/v1/bot/folder-token` on the gateway with full session context). Tokens are externally managed; folder9 ops happen agent-side with that token.

### What's broken / what's missing

1. **Two redundant version systems.** File storage already moved to folder9 (the editor and `CreateSkillDialog` were rewritten in commit b2110a1a). But `skill_versions` / `skill_files` are still wired up for the suggestion / review workflow even though folder9 natively supports the same flow via `approval_mode: 'review'` + proposals + webhook events (see `wikis` module for a working precedent). The two systems can drift: an approved suggestion bumps `currentVersion` but does **not** write back into folder9, so the editor's HEAD and the "current" version row diverge.
2. **Tenant skills are invisible to agents.** `search_skills` only sees source-code-bundled skills; the workspace skill library never reaches the tier manager. Agents have no way to discover, mount, create, or modify tenant skills.

### Goal of this design

Reach a clean folder9-only terminal state for skills, then bridge the workspace skill library into the agent runtime using the existing patterns (`Team9FolderTokenApi`, externally-managed-token mounts, `ISkillProvider`). Add the smallest possible set of new tools — `create_workspace_skill` and `mount_workspace_skill` — and reuse everything else.

## 2. Terminal-State Architecture

### 2.1 Single source of truth

- `skills` table is a thin pointer: `id`, `tenantId`, `name`, `description`, `type`, `icon`, `folderId`, `creatorId`, `createdAt`, `updatedAt`. **`currentVersion` is removed.**
- `skill_versions` and `skill_files` tables are dropped.
- The folder9 `light` folder is the only file store. History is folder9 commits. "Suggestion vs. published" is folder9 `approval_mode` (`auto` vs. `review`) plus folder9 proposals.
- Agent-side write policy is **derived** from folder9 — the gateway reads the folder's `approval_mode` when minting a token and chooses `permission` accordingly. There is no separate `agent_write_policy` column on `skills`.

### 2.2 Backend (gateway) surface

The gateway has two parallel namespaces, following the existing pattern (e.g. `/v1/im/...` vs `/v1/bot/folder-token`, `/v1/bot/staff/profile`, `/v1/bot/routines/...`): `/v1/skills/...` is the human/UI surface, `/v1/bot/skills/...` is the agent-auth surface. Skills uses the same split.

**User-facing (`/v1/skills/...`, JWT user auth):**

- Existing folder proxy routes stay: `GET /v1/skills/:id/folder/{tree,blob}` and `POST /v1/skills/:id/folder/commit`.
- Existing metadata CRUD stays: `POST/GET/PATCH/DELETE /v1/skills`, `GET /v1/skills/:id`.
- All four version routes (`GET /:id/versions`, `GET /:id/versions/:v`, `POST /:id/versions`, `PATCH /:id/versions/:v`) are **removed**.
- No proposal/review surface in this scope. All skill folders run `approval_mode: 'auto'`. A review/proposal flow may be reintroduced later (see §9 Out of Scope).

**Agent-facing (`/v1/bot/skills/...`, bot/agent auth):**

- New `BotSkillsController` mirroring the agent-relevant subset:
  - `GET /v1/bot/skills` — list skills in the bot's tenant. Accepts optional query params `type` and `name` (substring match) for filtering. Returns metadata only. Backs `WorkspaceSkillsProvider.search()`.
  - `GET /v1/bot/skills/:id` — get one skill's metadata. Backs `WorkspaceSkillsProvider.resolve()` cache lookup.
  - `GET /v1/bot/skills/:id/folder/blob?path=...` — read a single blob (typically `skill.md`) for SKILL.md hydration. Backs `WorkspaceSkillsProvider.resolve()` content fetch.
  - `POST /v1/bot/skills` — create a skill. Backs `create_workspace_skill` tool. `creatorId` comes from the bot's user identity.
- Folder editing by agent does **not** go through `/v1/bot/skills/:id/folder/commit`. Editing is via the folder mount path (see §2.4): agent gets a folder9 token from `POST /v1/bot/folder-token` and writes directly to folder9.
- Existing: `POST /v1/bot/folder-token` is **extended** with a new `logicalKey` value `workspace.skill`. Authorization branch verifies `req.folderId` matches an existing `skills.folderId` for the caller's tenant; mints a normal `read` or `write` folder9 token per request.

**Service layer:**

- `SkillsService.create` keeps its existing folder9 createFolder + initial `skill.md` write path. All folders are created with `approval_mode: 'auto'`; the parameter is plumbed but no caller sets it to `'review'` in this scope. The same service method is used by both `SkillsController` and `BotSkillsController` (caller difference is just auth + `creatorId` source).
- `SkillsService.list` no longer returns a `pendingSuggestionsCount` field — the suggestion concept is dropped. The response is plain skill metadata.

### 2.3 WebSocket events

No new websocket events in this scope. When proposal/review for skills returns (see §9), `skill_proposal_*` events would mirror the existing `wiki_proposal_*` family — webhook handler branches on folder metadata `team9_kind: 'skill'` and dispatches to the workspace room. Out of scope here.

### 2.4 Agent runtime surface

Two new pieces in `team9-agent-pi`:

- `WorkspaceSkillsProvider` (in `agent-components/src/components/skill/`): a session-singleton `ISkillProvider` registered once at `onSessionStart`. Its `search()` calls `GET /v1/bot/skills`; its `resolve(name)` calls `GET /v1/bot/skills/:id/folder/blob?path=skill.md` (folder9 token minted server-side; agent does **not** need a folder9 token for read-only SKILL.md hydration). The provider parses frontmatter and returns a `TieredSkill` shaped like `MountedFolderSkillProvider` does.
- Two new LLM tools, owned by a new dedicated component `Team9SkillsComponent` (typeKey `team9-skills`). Hard dependencies: `team9` (for `Team9FolderTokenApi`), `folder9` (for `Folder9DependencyApi.applyMount`), `host` (for the bash backend used by mounts), `skill-tier` (for provider registration). The new component is also where `WorkspaceSkillsProvider` is constructed and registered — keeping all skill-library agent surface in one component rather than swelling `Team9Component`. Tools:
  - `create_workspace_skill { name, description?, type?, icon? }` — calls `POST /v1/bot/skills`. Returns the new `skillId` and `folderId`. The tool optionally chains an immediate `mount_workspace_skill` so the agent can keep editing without a second round.
  - `mount_workspace_skill { skillId, permission: 'read' | 'write', mountPath? }` — calls `Team9FolderTokenApi.issueFolderToken({ logicalKey: 'workspace.skill', folderId: <skill.folderId>, permission })`, then `Folder9DependencyApi.applyMount({ externallyManagedToken: true, mountPath: mountPath ?? '/workspace/skill/<id>/' })`. Once mounted, the agent uses the existing `edit_file` / `submit_changes` flow (commits go straight to HEAD; no proposal in this scope).

Reused (no changes): `search_skills`, `load_skills`, `unload_skills`, `invoke_skill`, `unmount_folder9`, `edit_file`, `submit_changes`, `mount_folder9` (kept for PSK-direct admin/local cases).

### 2.5 SkillTierDependencyApi

Add `unregisterProvider(providerId: string)` to `SkillTierDependencyApi`. Implementation:

- Remove from the internal `providers` map.
- Drop owned skills from the `tierManager` (add a `removeByProviderId(providerId)` helper on `ResourceTierManager` if it does not exist).
- Clear matching entries from `ctx.data.skillStates` so persisted state does not leak references to a vanished provider.

`WorkspaceSkillsProvider` itself never needs to be unregistered for this feature, but the API gap should be closed for completeness and future use.

## 3. Cleanup Scope

### 3.1 Database

- Drop `skill_versions` table (drizzle migration).
- Drop `skill_files` table.
- Drop `skillVersionStatusEnum` (`skill_version__status`) along with the version table. Keep `skillTypeEnum` (`skill__type`) — it remains in use on `skills.type`.
- Remove `skills.currentVersion` column.
- Delete schema source files: `apps/server/libs/database/src/schemas/skill/skill-versions.ts` and `skill-files.ts`. Remove their re-exports from `skill/index.ts` and the `skillVersionsRelations` / `skillFilesRelations` blocks from `skill/relations.ts` (the remaining `skillsRelations` keeps `tenant` and `creator`; `versions` and `files` relations go away).

### 3.2 Backend (gateway)

- `SkillsController` (user-facing): remove the four version routes (`listVersions`, `getVersion`, `createVersion`, `reviewVersion`). No proposal proxy routes added in this scope.
- New `BotSkillsController` (agent-facing) under `/v1/bot/skills` with bot auth: `list`, `getById`, `getFolderBlob`, `create`. Reuses `SkillsService`. Tenant scoping derives from the bot's identity (same pattern as `BotStaffProfileController`).
- `SkillsService`: delete `listVersions`, `getVersion`, `createVersion`, `reviewVersion`, `createVersionInternal`. In `getById`, drop the `currentVersion` / `fileManifest` / `skill_files` lookup and remove the `files` field from the response — files are fetched via folder routes by the caller. In `list`, drop the suggestion-count query entirely; the response is plain skill metadata. In `provisionSkillFolder` / `getSkillFolderSeedFiles`, drop the version-restoration branch — provisioning always seeds a fresh `skill.md` from `name` + `description` (legacy data with `currentVersion > 0` no longer exists after migration).
- DTOs: delete `create-version.dto.ts`, `review-version.dto.ts`, and their `index.ts` re-exports.
- `folder-token.service.ts`: add `'workspace.skill'` to `Team9LogicalMountKey` (in `claw-hive-types`) and `KNOWN_LOGICAL_KEYS` (in the gateway service); add a switch branch that joins on `skills` to verify the folder belongs to the caller's tenant. The branch mints a normal folder9 token at the requested `permission` (`read` or `write`); no review-mode clamp logic in this scope.
- Webhook handler: no skill-related changes in this scope. Folder9 webhooks for skill folders fire but are silently ignored by the gateway (the folders are all `auto`, so no proposal events arrive). Out-of-scope future work would add a `skill_proposal_*` dispatch path (see §9).

### 3.3 Frontend (web client)

- `apps/client/src/services/api/skills.ts`: delete `listVersions`, `getVersion`, `createVersion`, `reviewVersion`. No replacement endpoints added.
- `apps/client/src/hooks/useSkills.ts`: remove the version-related queries / mutations.
- `apps/client/src/components/skills/SuggestionReviewPanel.tsx`: **delete** (not rewritten). The suggestion concept is fully retired in this scope; if proposals come back later, a new panel will be designed against the future folder9-proposal data shape.
- `apps/client/src/components/skills/SkillCard.tsx`: remove the `hasPendingSuggestion` prop and badge entirely.
- `apps/client/src/services/api/folder9-folder.ts`: delete `fetchLegacySkillFiles` and `isMissingSkillFolderRoute`. All skills now have `folderId`; the legacy fallback is dead code.
- `apps/client/src/types/skill.ts`: drop `SkillVersion`, `SkillFile`, `SkillFileManifestEntry` types.
- WebSocket client (`apps/client/src/services/websocket.ts`): no changes in this scope (no new skill events).

### 3.4 Tests

- Remove all `skill_versions` / `skill_files` test fixtures. Update `skills.service.spec.ts` and `skills.controller.spec.ts` to drop version-related cases.
- Add `bot-skills.controller.spec.ts` covering the four bot endpoints (`list`, `getById`, `getFolderBlob`, `create`), tenant scoping, and bot-auth path.
- Add gateway tests for the new `'workspace.skill'` `logicalKey` branch in `folder-token.service.spec.ts`: positive (tenant-owned skill, `write` returned), denial (cross-tenant folderId), denial (folderId not pointing at any skill).

## 4. Lifecycle Walkthroughs

### 4.1 Agent searches the workspace skill library

```
LLM → search_skills{ query: "deploy ..." }
  └─ SkillComponent.tools.search_skills
       └─ for each provider, provider.search(query)
            └─ WorkspaceSkillsProvider.search(query)
                 └─ http.get('/v1/bot/skills', { params: { type? } })
                 └─ rank by name+description+frontmatter, return top-N
       └─ aggregate, return ranked list
```

No folder9 token, no mount. Just metadata over HTTP via the bot namespace.

### 4.2 Agent loads a skill into context

```
LLM → load_skills{ skillName: "deploy-runbook" }
  └─ SkillComponent.tools.load_skills
       └─ provider.resolve("deploy-runbook")
            └─ WorkspaceSkillsProvider.resolve(name)
                 └─ cache from prior search OR http.get('/v1/bot/skills?name=...')
                 └─ http.get(`/v1/bot/skills/${id}/folder/blob?path=skill.md`)
                 └─ gray-matter parse, return TieredSkill
       └─ tierManager: dormant → listed (or summarized → listed, etc.)
```

Still no folder9 token agent-side; gateway serves blob via its own internal token.

### 4.3 Agent edits a skill

```
LLM → mount_workspace_skill{ skillId: "...", permission: "write" }
  └─ Team9FolderTokenApi.issueFolderToken({
       logicalKey: "workspace.skill",
       folderId: <skill.folderId>,
       permission: "write",
       sessionId, agentId, userId, workspaceId,
     })
  └─ gateway POST /api/v1/bot/folder-token
       ├─ verify folderId is a skill in workspaceId
       └─ folder9 POST /api/tokens → opaque token
  └─ Folder9DependencyApi.applyMount({
       mountPath: "/workspace/skill/<id>/",
       externallyManagedToken: true,
       token, folderId, permission,
     })

LLM → edit_file{ path: "/workspace/skill/<id>/skill.md", ... }   # existing tool
LLM → submit_changes{ mountPath: "/workspace/skill/<id>/" }      # existing tool
  └─ folder9 commits to HEAD (folder is approval_mode: 'auto')

LLM → unmount_folder9{ mountPath: "/workspace/skill/<id>/" }     # existing tool
```

All skill folders are `approval_mode: 'auto'` in this scope, so `submit_changes` commits straight to HEAD and no proposal/review path executes.

### 4.4 Agent creates a new skill

```
LLM → create_workspace_skill{ name, description?, type?, icon?, autoMount?: true }
  └─ http.post('/v1/bot/skills', { name, description, type, icon })
       └─ BotSkillsController → SkillsService.create
            ├─ folder9 createFolder({ approval_mode: "auto", metadata: { team9_kind: "skill", ... } })
            ├─ commit initial skill.md
            └─ insert into skills (no currentVersion column; creatorId = bot's user id)
  └─ if autoMount: tool chains mount_workspace_skill internally
  └─ return { skillId, folderId, mountPath? }
```

All skills are created with `approval_mode: 'auto'` in this scope; switching to `review` requires the future UI work listed in §9. Agent identity is recorded via the gateway's normal auth — `creatorId` becomes the agent's bot user id.

### 4.5 Mid-session unmount / unregister

Filesystem: `unmount_folder9` (existing) takes the path back. Skill-tier knowledge: `unload_skills` (existing) drops the skill back to `dormant`. Provider lifetime: `WorkspaceSkillsProvider` is registered for the whole session — unregister is unused for this feature but available via the new `unregisterProvider` API.

## 5. Permissions Model

All skill folders run `approval_mode: 'auto'` in this scope.

- Read token: granted to any caller with valid bot/user auth scoped to the skill's tenant.
- Write token: granted when the caller has tenant role ≥ member (same as today's editor commit path). Writes go straight to HEAD; no proposal flow.
- Cross-tenant safety: the gateway's `'workspace.skill'` logicalKey branch joins on `skills.folderId === req.folderId AND skills.tenantId === req.workspaceId`. Mismatch → `ForbiddenException` (matches the existing pattern for `routine.document`).
- Future review-mode work (see §9) would re-introduce per-skill `approval_mode` selection and a proposal/review surface.

## 6. Migration & Rollout

Single deploy, no feature flag. Sequencing matters within the deploy:

1. Add `'workspace.skill'` logicalKey + new endpoints to gateway.
2. Add `WorkspaceSkillsProvider`, `create_workspace_skill`, `mount_workspace_skill`, `unregisterProvider` to agent-pi packages. Bump claw-hive package versions consumed by gateway (the agent images redeploy on the next routine run).
3. Drop the legacy DB tables and code in the same gateway deploy (migration `drop_skill_versions_skill_files`). No pre-migration reconciliation needed: the suggestion flow has not been exercised in production and any rows are discarded. Confirm before running with a quick `SELECT COUNT(*) FROM skill_versions` sanity check.
4. Frontend deploy lands the skills.ts / useSkills.ts cleanup and SuggestionReviewPanel removal. Old clients pointing at deleted `/versions` routes get 404 — acceptable because the new client should be deployed within minutes.

Down-revert: re-add the dropped tables (empty) and re-deploy the old controller. Acceptable if discovered within hours; agent code can be left in place (agents simply won't be able to mount tenant skills until rollback finishes, but they fall back gracefully because the tools are additive, not replacing existing surface).

## 7. Testing Strategy

- **Gateway unit:** `skills.service.spec.ts` covers create / list / get / update / delete / folder proxy routes; cross-tenant denial test. `bot-skills.controller.spec.ts` covers the new bot endpoints (list / getById / getFolderBlob / create) and bot-auth path. `folder-token.service.spec.ts` covers the new `'workspace.skill'` logicalKey branch (tenant-owned skill + write, cross-tenant deny, unknown folder deny).
- **Agent-pi unit:** `WorkspaceSkillsProvider.test.ts` covers search (HTTP mocked), resolve (HTTP mocked, gray-matter parse), error paths (404, malformed frontmatter, name mismatch). `Team9SkillsComponent.test.ts` covers `onSessionStart` provider registration, the two new tools, and their failure paths (mock `Team9FolderTokenApi` and `Folder9DependencyApi`). `SkillComponent.test.ts` adds `unregisterProvider` cases (provider removed, owned skills dropped from tier, persisted state cleared).
- **Frontend unit:** `useSkills.ts` queries adapt; `SkillCard.tsx` renders without the deleted suggestion badge; the `skills/index.tsx` page renders without `SuggestionReviewPanel`.
- **Integration / E2E:** one happy-path E2E in the gateway — create skill → agent mounts (write) → agent commits → commit visible in folder9 history.

100% coverage on new code per project policy; gaps noted to user before merging.

## 8. Open Questions / TBD During Plan-Writing

None remaining. (The earlier open questions on review-mode token semantics and `pendingProposalsCount` are resolved by dropping the proposal/review surface from this scope; the component-host question is resolved as a dedicated `Team9SkillsComponent`.)

## 9. Out of Scope

- **Proposal / review flow for skills.** No `skill_proposal_*` websocket events, no `/skills/:id/proposals` proxy, no rewritten `SuggestionReviewPanel`, no review-mode token clamp. Folder9 still supports it natively (wikis uses it); when skills need it back, the work is: add a `team9_kind: 'skill'` branch to the existing folder9 webhook handler, add the proposal proxy routes to `SkillsController`, add a new review UI component, extend the `'workspace.skill'` token branch to clamp permission for `review` folders. None of that is in this scope.
- A user-facing UI toggle for `approval_mode` on a skill — needed as a prerequisite to bringing review back, but not delivered here.
- Tenant-wide policy DSL or per-agent policy overrides.
- Versioning UX beyond folder9's commit history (no pinned releases, tags, or rollback UI).
- Cross-workspace skill sharing.
- A per-skill `agent_write_policy` override that diverges from folder9's `approval_mode` (deliberately rejected — folder9 is the single source if/when review returns).
