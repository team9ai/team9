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
- New: `GET /v1/skills/:id/proposals` — proxy folder9's proposal list for the skill folder, used by the rewritten `SuggestionReviewPanel`.
- New: `POST /v1/skills/:id/proposals/:branch/{approve,reject}` — proxy folder9 proposal review.

**Agent-facing (`/v1/bot/skills/...`, bot/agent auth):**

- New `BotSkillsController` mirroring the agent-relevant subset:
  - `GET /v1/bot/skills` — list skills in the bot's tenant. Accepts optional query params `type` and `name` (substring match) for filtering. Returns metadata only. Backs `WorkspaceSkillsProvider.search()`.
  - `GET /v1/bot/skills/:id` — get one skill's metadata. Backs `WorkspaceSkillsProvider.resolve()` cache lookup.
  - `GET /v1/bot/skills/:id/folder/blob?path=...` — read a single blob (typically `skill.md`) for SKILL.md hydration. Backs `WorkspaceSkillsProvider.resolve()` content fetch.
  - `POST /v1/bot/skills` — create a skill. Backs `create_workspace_skill` tool. `creatorId` comes from the bot's user identity.
- Folder editing by agent does **not** go through `/v1/bot/skills/:id/folder/commit`. Editing is via the folder mount path (see §2.4): agent gets a folder9 token from `POST /v1/bot/folder-token` and writes directly to folder9.
- Existing: `POST /v1/bot/folder-token` is **extended** with a new `logicalKey` value `workspace.skill`. Authorization branch verifies `req.folderId` matches an existing `skills.folderId` for the caller's tenant; permission is gated by the folder's `approval_mode`.

**Service layer:**

- `SkillsService.create` keeps its existing folder9 createFolder + initial `skill.md` write path, but now sets `approval_mode` from a creation-time argument (default `auto`; UI can switch to `review` for shared/reviewed skills). The same service method is used by both `SkillsController` and `BotSkillsController` (caller difference is just auth + `creatorId` source).
- `SkillsService.list` still returns `pendingProposalsCount`, but the count is sourced from folder9 proposal count rather than `skill_versions`.
- A new `SkillsService.listProposals(skillId, tenantId)` method proxies folder9 proposal list. `SkillsService.reviewProposal(skillId, branch, action, tenantId)` proxies folder9 proposal approve/reject.

### 2.3 WebSocket events

Three new events fire to the workspace room when folder9 webhook delivers proposal lifecycle for a skill folder (folder metadata `team9_kind: 'skill'`):

- `skill_proposal_created`
- `skill_proposal_approved`
- `skill_proposal_rejected`

Dispatch logic is the same shape as the existing `wiki_proposal_*` path. The webhook handler checks the folder's `team9_kind` metadata to decide which event family to emit. Recommendation: extract a small "team9_kind → event family" helper from the wikis webhook so this is a one-line addition rather than a copy.

### 2.4 Agent runtime surface

Two new pieces in `team9-agent-pi`:

- `WorkspaceSkillsProvider` (in `agent-components/src/components/skill/`): a session-singleton `ISkillProvider` registered once at `onSessionStart`. Its `search()` calls `GET /v1/bot/skills`; its `resolve(name)` calls `GET /v1/bot/skills/:id/folder/blob?path=skill.md` (folder9 token minted server-side; agent does **not** need a folder9 token for read-only SKILL.md hydration). The provider parses frontmatter and returns a `TieredSkill` shaped like `MountedFolderSkillProvider` does.
- Two new LLM tools, owned by a thin "team9 workspace skills" component (or hosted on `Team9Component` if simpler — TBD during plan-writing, see §8):
  - `create_workspace_skill { name, description?, type?, icon? }` — calls `POST /v1/bot/skills`. Returns the new `skillId` and `folderId`. The tool optionally chains an immediate `mount_workspace_skill` so the agent can keep editing without a second round.
  - `mount_workspace_skill { skillId, permission: 'read' | 'write', mountPath? }` — calls `Team9FolderTokenApi.issueFolderToken({ logicalKey: 'workspace.skill', folderId: <skill.folderId>, permission })`, then `Folder9DependencyApi.applyMount({ externallyManagedToken: true, mountPath: mountPath ?? '/workspace/skill/<id>/' })`. Once mounted, the agent uses the existing `edit_file` / `submit_changes` flow.

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

- `SkillsController` (user-facing): remove the four version routes (`listVersions`, `getVersion`, `createVersion`, `reviewVersion`). Add the three proposal proxy routes listed in §2.2.
- New `BotSkillsController` (agent-facing) under `/v1/bot/skills` with bot auth: `list`, `getById`, `getFolderBlob`, `create`. Reuses `SkillsService`. Tenant scoping derives from the bot's identity (same pattern as `BotStaffProfileController`).
- `SkillsService`: delete `listVersions`, `getVersion`, `createVersion`, `reviewVersion`, `createVersionInternal`. In `getById`, drop the `currentVersion` / `fileManifest` / `skill_files` lookup and remove the `files` field from the response — files are fetched via folder routes by the caller. In `list`, replace the suggestion-count query with a folder9 proposal count call. In `provisionSkillFolder` / `getSkillFolderSeedFiles`, drop the version-restoration branch — provisioning always seeds a fresh `skill.md` from `name` + `description` (legacy data with `currentVersion > 0` no longer exists after migration).
- DTOs: delete `create-version.dto.ts`, `review-version.dto.ts`, and their `index.ts` re-exports.
- `folder-token.service.ts`: add `'workspace.skill'` to `Team9LogicalMountKey` (in `claw-hive-types`) and `KNOWN_LOGICAL_KEYS` (in the gateway service); add a switch branch that joins on `skills` to verify the folder belongs to the caller's tenant and reads `approval_mode` to clamp `permission` (e.g. when folder is `review`, `write` is downgraded to `propose`-equivalent — the exact mapping depends on folder9 token semantics; defer to plan-writing for the precise clamp).
- Webhook: in the existing folder9 webhook handler, branch on the folder's `team9_kind` metadata. For `team9_kind === 'skill'`, emit `skill_proposal_*` events to the workspace room. Extract a `dispatchProposalEvent(metadata, payload)` helper if not already extracted.

### 3.3 Frontend (web client)

- `apps/client/src/services/api/skills.ts`: delete `listVersions`, `getVersion`, `createVersion`, `reviewVersion`. Add `listProposals`, `approveProposal`, `rejectProposal` (or similarly named) wrapping the new gateway routes.
- `apps/client/src/hooks/useSkills.ts`: remove the version-related queries / mutations. Add proposal queries / mutations.
- `apps/client/src/components/skills/SuggestionReviewPanel.tsx`: rewrite to consume folder9 proposals. Data shape changes from `{ version, files, suggestedBy, status }` to `{ branch, commits[], proposer, lastUpdatedAt }`. The diff view re-uses `FileEditor`'s read-only mode; the approve/reject buttons hit the new endpoints.
- `apps/client/src/components/skills/SkillCard.tsx`: `hasPendingSuggestion` is sourced from `pendingProposalsCount` (returned from the updated `list` endpoint).
- `apps/client/src/services/api/folder9-folder.ts`: delete `fetchLegacySkillFiles` and `isMissingSkillFolderRoute`. All skills now have `folderId`; the legacy fallback is dead code.
- `apps/client/src/types/skill.ts`: drop `SkillVersion`, `SkillFile`, `SkillFileManifestEntry` types. Replace with `SkillProposal` shape.
- WebSocket client (`apps/client/src/services/websocket.ts`): subscribe to the new `skill_proposal_*` events; update React Query cache keys for the proposal list and the skill list (the badge).

### 3.4 Tests

- Remove all `skill_versions` / `skill_files` test fixtures. Update `skills.service.spec.ts` and `skills.controller.spec.ts` to drop version-related cases and add proposal-proxy cases.
- Add gateway tests for the new `'workspace.skill'` `logicalKey` branch in `folder-token.service.spec.ts`: positive (tenant-owned skill, `auto` folder, `write` returned), denial (cross-tenant folderId), clamp (`review` folder + `write` requested → clamped per the §3.2 mapping).

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
       ├─ read folder9 approval_mode
       ├─ clamp permission (auto → write; review → propose)
       └─ folder9 POST /api/tokens → opaque token
  └─ Folder9DependencyApi.applyMount({
       mountPath: "/workspace/skill/<id>/",
       externallyManagedToken: true,
       token, folderId, permission,
     })

LLM → edit_file{ path: "/workspace/skill/<id>/skill.md", ... }   # existing tool
LLM → submit_changes{ mountPath: "/workspace/skill/<id>/" }      # existing tool
  ├─ if permission was clamped to propose → folder9 creates a proposal branch
  ├─ folder9 webhook fires on completion
  ├─ gateway dispatches skill_proposal_created → workspace room
  └─ frontend SuggestionReviewPanel shows the new proposal

LLM → unmount_folder9{ mountPath: "/workspace/skill/<id>/" }     # existing tool
```

Auto-mode skill: `submit_changes` commits straight to HEAD; no proposal event. Review-mode skill: agent's writes accumulate on a proposal branch; `submit_changes` finalizes the proposal; human approves via the panel; folder9 emits approval webhook; gateway broadcasts `skill_proposal_approved`.

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

Newly-created skills default to `approval_mode: 'auto'` (the creator owns it; they can change to `review` later via the UI). Agent identity is recorded via the gateway's normal auth — `creatorId` becomes the agent's bot user id.

### 4.5 Mid-session unmount / unregister

Filesystem: `unmount_folder9` (existing) takes the path back. Skill-tier knowledge: `unload_skills` (existing) drops the skill back to `dormant`. Provider lifetime: `WorkspaceSkillsProvider` is registered for the whole session — unregister is unused for this feature but available via the new `unregisterProvider` API.

## 5. Permissions Model

Single source of truth: folder9 folder's `approval_mode`.

| `skills.folderId` `approval_mode` | Read token mint     | Write token mint                                                                                                    | Effect on `submit_changes`                     |
| --------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `auto`                            | always allowed      | allowed when caller has tenant role ≥ member                                                                        | direct commit to HEAD                          |
| `review`                          | allowed (read-only) | mints a `propose`-class token (or write token folder9 will route to a branch — exact folder9 semantics TBD in plan) | proposal branch; proposal opens; webhook fires |

Cross-tenant safety: the gateway's `'workspace.skill'` logicalKey branch joins on `skills.folderId === req.folderId AND skills.tenantId === req.workspaceId`. Mismatch → `ForbiddenException` (matches the existing pattern for `routine.document`).

UI control: a future user-facing toggle on the skill detail page to flip `approval_mode` is out of scope here but unblocked — it's a single folder9 PATCH plus invalidation of cached tokens.

## 6. Migration & Rollout

Single deploy, no feature flag. Sequencing matters within the deploy:

1. Add `'workspace.skill'` logicalKey + new endpoints to gateway.
2. Add `WorkspaceSkillsProvider`, `create_workspace_skill`, `mount_workspace_skill`, `unregisterProvider` to agent-pi packages. Bump claw-hive package versions consumed by gateway (the agent images redeploy on the next routine run).
3. Drop the legacy DB tables and code in the same gateway deploy (migration `drop_skill_versions_skill_files`). Pre-migration: confirm zero rows in `skill_versions` with `status: 'suggested'` (or surface them as folder9 proposals manually if any exist — production likely has zero, given the feature is recent and the suggestion path was rarely used).
4. Frontend deploy lands new SuggestionReviewPanel + skills.ts cleanup. Old clients pointing at deleted `/versions` routes get 404 — acceptable because the new client should be deployed within minutes.

Down-revert: re-add the dropped tables (empty) and re-deploy the old controller. Acceptable if discovered within hours; agent code can be left in place (agents simply won't be able to mount tenant skills until rollback finishes, but they fall back gracefully because the tools are additive, not replacing existing surface).

## 7. Testing Strategy

- **Gateway unit:** `skills.service.spec.ts` covers create / list / get / update / delete / folder proxy routes. Add proposal-proxy tests. Add cross-tenant denial test. `folder-token.service.spec.ts` covers the new `'workspace.skill'` logicalKey branch (auto-folder + write, review-folder + write clamp, cross-tenant deny, unknown folder deny).
- **Agent-pi unit:** `WorkspaceSkillsProvider.test.ts` covers search (HTTP mocked), resolve (HTTP mocked, gray-matter parse), error paths (404, malformed frontmatter, name mismatch). Tool tests for `create_workspace_skill` and `mount_workspace_skill` mock `Team9FolderTokenApi` and `Folder9DependencyApi`. `SkillComponent.test.ts` adds `unregisterProvider` cases (provider removed, owned skills dropped from tier, persisted state cleared).
- **Frontend unit:** `useSkills.ts` queries adapt; `SuggestionReviewPanel.tsx` renders proposal data; `SkillCard.tsx` renders the proposal-count badge.
- **Integration / E2E:** one happy-path E2E in the gateway: create skill → agent mounts (auto) → agent commits → version visible in folder9 history. One review-path E2E: switch skill to `approval_mode: 'review'` → agent commits → proposal appears → human approves → HEAD updates.

100% coverage on new code per project policy; gaps noted to user before merging.

## 8. Open Questions / TBD During Plan-Writing

- Exact folder9 token-clamp behavior for `review` folders + `write` permission requests: does folder9 mint a `propose` token, or a `write` token that the folder routes to a branch? Confirm by reading folder9 source / current `wikis` clamp logic.
- Component-host for the two new agent tools: extend `Team9Component` directly, or add a thin sibling component `Team9SkillsComponent`? Decide during plan-writing based on which has cleaner dependency wiring.
- `pendingProposalsCount` on `skills.list`: a single batched folder9 call (per-tenant aggregate) vs N+1 per-folder calls. Single call preferred; depends on folder9 list-proposals API supporting a tenant-wide query. If not, cache + invalidate on webhook.

## 9. Out of Scope

- A user-facing UI toggle for `approval_mode` on a skill (mentioned in §5 as unblocked but not delivered here).
- Tenant-wide policy DSL or per-agent policy overrides.
- Versioning UX beyond folder9's commit history (no pinned releases, tags, or rollback UI).
- Cross-workspace skill sharing.
- A per-skill `agent_write_policy` override that diverges from `approval_mode` (deliberately rejected — folder9 is the single source).
