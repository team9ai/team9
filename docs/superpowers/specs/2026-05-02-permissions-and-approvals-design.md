# Permissions and Approvals System — Design

**Date:** 2026-05-02
**Status:** Reviewed (open questions resolved 2026-05-02)
**Author:** Claude (auto-mode brainstorming)

## 1. Background

Team9 currently has no general-purpose authorization layer beyond JWT + workspace role guards (`WorkspaceRoleGuard` with owner/admin/member/guest tiers) and channel-level role on `im_channel_members`. Bot capabilities live as a flexible JSONB blob on `im_bots.capabilities` but cannot be scoped per-channel, per-routine, or per-tool, and there is no mechanism for an agent to **ask** for elevated permission.

`routine__interventions` exists for in-routine pause/approval, but it is tied to a single routine execution lifecycle and does not generalize to ad-hoc capability/data permissions.

This spec introduces:

- A **Grant** primitive — a user proactively gives an agent / chat session / routine a permission, optionally scoped via metadata.
- A **Permission Request** primitive — an agent asks for a permission it does not have, identified by a memorable **Spell ID**, and a user approves once or remembers it as a Grant.
- A central **`PermissionsService.gate(...)`** entry point that callers (services, websocket handlers, routine steps) invoke before performing sensitive actions.

Out of scope for v1: claw-hive runtime tool-call hooks (will be added in a follow-up); tenant-wide policy DSL; delegation chains.

## 2. Goals & Non-Goals

### Goals

- Users can grant a permission to (a) an agent, (b) a chat session (channel), (c) a routine execution, (d) a routine definition (task) — with optional metadata scope.
- Agents can request a permission with a clearly-identifiable Spell ID; users approve `once` / `remember (durable)` / `deny`.
- Single canonical check function `gate(...)` used at every enforcement point.
- WebSocket events let inboxes & settings UIs update live.
- Auditable: every grant and decision recorded with actor + timestamp.

### Non-Goals

- Role hierarchy / role inheritance (workspace role guard handles its own surface area).
- Cross-tenant grants.
- Replacing `routine__interventions` (kept for in-flow pauses).
- Automatic grant inference from past behavior.

## 3. Subjects (who gets a grant)

| `subject_kind`      | `subject_id` references  | Lifetime                                                 | Use case                                                                        |
| ------------------- | ------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `agent`             | `im_bots.id`             | Long-lived (until bot deleted / grant revoked / expired) | "Always let this assistant read the wiki."                                      |
| `channel-session`   | `im_channels.id`         | Per-channel (until channel archived)                     | "In this support thread the agent may invoke the SQL tool."                     |
| `execution-session` | `routine__executions.id` | Until execution completes                                | "Just for this run, let the agent post in #ops."                                |
| `task`              | `routine__routines.id`   | Until routine deleted                                    | "Every execution of the daily-report routine may read the analytics warehouse." |

> **Note on terminology:** the user's request uses "session" generically; we split it into chat-session vs execution-session because they have different lifetimes and audit semantics.

## 4. Permission Keys, Scope Schema & Approver Resolution

Permission keys are **defined in code** (not a DB table). Each key is registered with:

- a JSONSchema for the valid `scope_metadata` shape,
- a `resolveApprovers(ctx)` function returning the **resource holders** for a given request context (the primary approvers),
- an optional `defaultApprovers` fallback when the resolver returns an empty set,
- a `risk` label.

This is how Q2 ("primary approver = resource holder") is encoded: the key itself owns the rule for who is allowed to grant it. Adding a new permission means writing both the scope shape and a holder-resolver in the same file, so the two can never drift.

```ts
// apps/server/apps/gateway/src/permissions/permission-keys.ts
export interface PermissionKeyDef {
  metadata: JSONSchema; // shape of scope_metadata
  risk: "low" | "medium" | "high";
  resolveApprovers: (
    ctx: ApproverContext,
    deps: ApproverDeps,
  ) => Promise<UserId[]>;
  defaultApprovers?: "workspace-admins" | "bot-owners" | "none";
  describe: (metadata: object) => string; // human-readable for UI
}

export const PERMISSION_KEYS: Record<string, PermissionKeyDef> = {
  "messages:send": {
    metadata: ChannelScopeSchema,
    risk: "low",
    resolveApprovers: async ({ metadata, contextChannelId }, { db }) => {
      const channelId = pickChannelId(metadata, contextChannelId);
      return channelId ? db.findChannelOwnersAndAdmins(channelId) : [];
    },
    defaultApprovers: "workspace-admins",
    describe: (m) =>
      `Send messages${m.channelIds ? ` in ${m.channelIds.length} channel(s)` : ""}`,
  },
  "messages:read": {
    /* similar */
  },
  "tools:invoke": {
    metadata: ToolScopeSchema,
    risk: "medium",
    resolveApprovers: async ({ requesterBotId }, { db }) =>
      db.findBotOwnerAndMentor(requesterBotId),
    defaultApprovers: "workspace-admins",
    describe: (m) =>
      `Invoke tool${m.toolNames ? ` (${m.toolNames.join(", ")})` : ""}`,
  },
  "wiki:read": {
    metadata: WikiScopeSchema,
    risk: "low",
    resolveApprovers: async ({ metadata }, { db }) =>
      db.findWikiOwners(metadata.wikiId),
    defaultApprovers: "workspace-admins",
    describe: (m) => `Read wiki${m.wikiId ? ` ${m.wikiId}` : ""}`,
  },
  "wiki:write": {
    /* same shape, risk: 'high' */
  },
  "files:read": {
    /* PathScopeSchema, holder = file-keeper resource owner */
  },
  "files:write": {
    /* same, high risk */
  },
  "routine:trigger": {
    metadata: RoutineScopeSchema,
    risk: "medium",
    resolveApprovers: async ({ metadata }, { db }) =>
      db.findRoutineCreatorAndOwner(metadata.routineId),
    defaultApprovers: "workspace-admins",
    describe: (m) => `Trigger routine ${m.routineId}`,
  },
} as const;
```

**Approver resolution order** (used by `PermissionsService.resolveApprovers(request)`):

1. Run `key.resolveApprovers(ctx)` → primary holders.
2. Union with `request.suggestedApproverIds` (an optional array the AI can include when filing the request — see §8).
3. If the union is empty, apply `key.defaultApprovers` (`workspace-admins` or `bot-owners`).
4. Workspace `owner` always belongs to the approver set as a safety net (cannot be excluded).

This is the **only** place that decides who can decide a request. The WS dispatcher (§9) and the controller's `canDecide(...)` check both call it.

**`ApproverContext`** carries `tenantId`, `requesterBotId`, `permissionKey`, `metadata`, `contextChannelId?`, `contextExecutionId?`, `contextRoutineId?` — the same data the request row holds.

**`ApproverDeps`** is a small interface (`db.findChannelOwnersAndAdmins(...)`, `db.findBotOwnerAndMentor(...)`, etc.) implemented by `PermissionsApproverRepository`. Centralizing the queries keeps key definitions declarative and makes resolvers trivially mockable in tests.

Scope schemas are intersection-style: each property is optional; presence narrows scope; absence means unrestricted.

```jsonc
// ChannelScopeSchema example
{
  "channelIds": ["uuid", "..."],          // optional whitelist
  "channelTypes": ["public", "direct"]    // optional whitelist
}
// ToolScopeSchema example
{
  "toolNames": ["sql_query", "fetch"],
  "targets":   ["staging"]                // free-form labels per tool
}
```

A **`PermissionMatcher`** compares request metadata against grant `scope_metadata`:

- Field absent in grant → unrestricted on that field.
- Array → request value must be `∈` array.
- String → exact match.
- Glob (prefix `glob:`) → minimatch.

All matching logic lives in one file (`permission-matcher.ts`) with unit tests.

## 5. Database Schema

New schema folder: `apps/server/libs/database/src/schemas/permissions/`. Tables prefixed `auth_` for visibility.

### 5.1 `auth_permission_grants`

```ts
export const authPermissionGrants = pgTable(
  "auth_permission_grants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    grantedByUserId: uuid("granted_by_user_id")
      .notNull()
      .references(() => imUsers.id),
    subjectKind: subjectKindEnum("subject_kind").notNull(),
    subjectId: uuid("subject_id").notNull(),
    permissionKey: text("permission_key").notNull(),
    scopeMetadata: jsonb("scope_metadata")
      .$type<Record<string, unknown>>()
      .default({}),
    source: grantSourceEnum("source").notNull(), // 'proactive' | 'request_approved'
    requestId: uuid("request_id").references(() => authPermissionRequests.id),
    expiresAt: timestamp("expires_at"),
    revokedAt: timestamp("revoked_at"),
    revokedByUserId: uuid("revoked_by_user_id").references(() => imUsers.id),
    note: text("note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    bySubject: index("auth_grants_subject_idx").on(
      t.tenantId,
      t.subjectKind,
      t.subjectId,
      t.permissionKey,
    ),
    active: index("auth_grants_active_idx")
      .on(t.tenantId, t.permissionKey)
      .where(sql`${t.revokedAt} IS NULL`),
  }),
);
```

Enums:

- `subject_kind`: `agent` | `channel-session` | `execution-session` | `task`
- `source`: `proactive` | `request_approved`

### 5.2 `auth_permission_requests`

```ts
export const authPermissionRequests = pgTable(
  "auth_permission_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    spellId: text("spell_id").notNull().unique(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    requesterBotId: uuid("requester_bot_id")
      .notNull()
      .references(() => imBots.id, { onDelete: "cascade" }),
    contextChannelId: uuid("context_channel_id").references(
      () => imChannels.id,
      { onDelete: "set null" },
    ),
    contextExecutionId: uuid("context_execution_id").references(
      () => routineExecutions.id,
      { onDelete: "set null" },
    ),
    contextRoutineId: uuid("context_routine_id").references(
      () => routineRoutines.id,
      { onDelete: "set null" },
    ),
    permissionKey: text("permission_key").notNull(),
    requestedMetadata: jsonb("requested_metadata")
      .$type<Record<string, unknown>>()
      .default({}),
    suggestedApproverIds: uuid("suggested_approver_ids")
      .array()
      .default(sql`ARRAY[]::uuid[]`), // optional: AI-supplied extra approvers, validated server-side
    reason: text("reason"),
    status: requestStatusEnum("status").notNull().default("pending"),
    decidedByUserId: uuid("decided_by_user_id").references(() => imUsers.id),
    decidedAt: timestamp("decided_at"),
    decisionNote: text("decision_note"),
    durableGrantId: uuid("durable_grant_id").references(
      () => authPermissionGrants.id,
    ),
    consumedAt: timestamp("consumed_at"), // for 'approved_once'
    expiresAt: timestamp("expires_at").notNull(), // default now()+30min
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    spellIdx: uniqueIndex("auth_req_spell_idx").on(t.spellId),
    pendingByBot: index("auth_req_pending_bot_idx").on(
      t.tenantId,
      t.requesterBotId,
      t.status,
    ),
    pendingByContext: index("auth_req_pending_ctx_idx").on(
      t.tenantId,
      t.contextChannelId,
      t.status,
    ),
  }),
);
```

Enum `request_status`: `pending` | `approved_once` | `approved_durable` | `denied` | `expired` | `cancelled`.

A scheduled job (or lazy lookup-time check) flips stale `pending` rows to `expired`.

### 5.3 Migration plan

1. `pnpm db:generate` after committing schema.
2. Single migration `00XX_permissions_init.sql` creates enums + both tables + indexes.
3. No backfill — system starts empty.

## 6. Spell ID Service

Located at `apps/server/apps/gateway/src/permissions/spell-id.service.ts`.

```ts
@Injectable()
export class SpellIdService {
  generate(opts?: { wordCount?: 3 | 4 }): string; // default 3, escalates to 4 on collision
  parse(input: string): string | null; // trims, lowercases, collapses whitespace
}
```

**Word list:** the **BIP-39 English mnemonic word list** (the same list used by crypto wallets for recovery phrases, also commonly called "secret words"). 2048 words, 3–8 lowercase letters each, designed so the first four letters of every word are unique → unambiguous when typed or spoken aloud.

Stored as a static asset at `apps/server/apps/gateway/src/permissions/spell-words.ts` (re-exported from a checked-in copy of the BIP-39 list, ~13 KB). No runtime dependency on a wallet library — the file is a `readonly string[]`.

**Combinatorics:** with 3 words → 2048³ ≈ 8.6 billion combinations; collisions for any realistic pending-set size are negligible. 4-word fallback exists only as defense-in-depth.

**Collision handling:** `generate()` retries until the DB unique constraint accepts the insert. After 3 retries at 3 words, escalates to 4 words.

**Format:** lowercase letters + single spaces; regex `^[a-z]+( [a-z]+){2,4}$`. Parser normalizes (trim, lowercase, collapse runs of whitespace) so users can type it loosely.

**Spell ID is not a secret.** Authentication is still JWT; the spell id is purely a memorable handle for "which request are we deciding right now," especially useful when the user reads it aloud from a notification or pastes it into chat.

## 7. Decision & Check Algorithms

### 7.1 `gate({ key, metadata, ctx })` — central entry

```
input ctx: { tenantId, botId, channelId?, executionId?, routineId?, userId? }

1. Resolve candidate grants:
   SELECT * FROM auth_permission_grants WHERE
     tenant_id = ctx.tenantId AND
     permission_key = key AND
     revoked_at IS NULL AND
     (expires_at IS NULL OR expires_at > now()) AND
     (
       (subject_kind='execution-session' AND subject_id=ctx.executionId)
       OR (subject_kind='channel-session' AND subject_id=ctx.channelId)
       OR (subject_kind='task'             AND subject_id=ctx.routineId)
       OR (subject_kind='agent'            AND subject_id=ctx.botId)
     )
   ORDER BY specificity_rank(subject_kind) DESC

2. For each candidate, run PermissionMatcher(metadata, grant.scope_metadata).
   First match -> return { allowed: true, via: 'grant', grantId }.

3. If no match, look for a one-time approval:
   SELECT * FROM auth_permission_requests WHERE
     tenant_id=ctx.tenantId AND requester_bot_id=ctx.botId
     AND permission_key=key AND status='approved_once' AND consumed_at IS NULL
     AND expires_at > now()
     AND (context_channel_id IS NULL OR context_channel_id=ctx.channelId)
     AND (context_execution_id IS NULL OR context_execution_id=ctx.executionId)
   ORDER BY decided_at DESC LIMIT 1
   If found and metadata satisfies requested_metadata -> mark consumed, return ALLOW.

4. Return { allowed: false }.
```

`specificity_rank`: `execution-session=4 > channel-session=3 > task=2 > agent=1`.

### 7.2 Decision endpoint

```
POST /api/permissions/requests/:id/decide
body: {
  decision: 'once' | 'remember' | 'deny',
  scopeOverride?: jsonb,    // tighten metadata before remembering
  expiresAt?: ISO8601,      // for 'remember'
  rememberSubject?: 'agent' | 'channel-session' | 'execution-session' | 'task',
                            // default: 'agent' if no channel context, else 'channel-session'
  note?: string,
}
```

- `once` → `status='approved_once'`. The first matching `gate(...)` call consumes it (sets `consumed_at`, emits `permission_request_consumed` event). If `scopeOverride` is supplied it replaces `requested_metadata` so the consume step matches against the tightened scope.
- `remember` → `status='approved_durable'` + creates a row in `auth_permission_grants` (atomically, in one transaction). `durable_grant_id` is set. `scopeOverride` (if any) becomes the grant's `scope_metadata`.
- `deny` → `status='denied'`. Future calls return DENY immediately.

### 7.3 Approver resolution & decision authorization

There is **one** function that decides who may decide a request, and it lives in `PermissionsService.resolveApprovers(request)`. The algorithm:

```
approvers := key.resolveApprovers({
              tenantId, requesterBotId, permissionKey,
              metadata: request.requested_metadata,
              contextChannelId, contextExecutionId, contextRoutineId,
            })
if request.suggested_approver_ids?.length:
   approvers ∪= validate(suggested_approver_ids)   // must be in same tenant
if approvers is empty:
   approvers := fallback(key.defaultApprovers)     // workspace-admins / bot-owners / none
approvers ∪= workspace_owners(tenant)              // safety-net, never excluded
return approvers
```

`PermissionsService.canDecide(user, request)` returns `true` iff `user.id ∈ resolveApprovers(request)`.

Both the controller (`POST /requests/:id/decide`) and the WebSocket dispatcher (§9) ask this single function — there is no second authorization rule anywhere else.

**Validation of suggested approvers:** the bot can suggest only users that exist in the same tenant. Suggestions that fail validation are dropped silently (logged), they don't reject the request — the holder set still applies.

## 8. REST API

All routes under `/api/permissions/*`, JWT-protected.

```
GET    /grants?subjectKind=&subjectId=&permissionKey=
POST   /grants                                # create proactive grant
DELETE /grants/:id                            # revoke (sets revoked_at)

GET    /requests?status=&scope=mine|tenant   # 'mine' = approver list contains caller
GET    /requests/by-spell/:spell              # case-insensitive, normalized
POST   /requests                              # bot creates (uses bot JWT)
                                              # body MAY include suggestedApproverIds: uuid[]
DELETE /requests/:id                          # bot cancels (still pending)
POST   /requests/:id/decide
POST   /requests/by-spell/:spell/decide
```

Bots authenticate with the same JWT system as users (their shadow `im_users` row); the controller distinguishes via `userType='bot'`.

## 9. WebSocket Events

New domain `permissions` under `apps/server/libs/shared/src/events/domains/`.

"Approvers" in the table below means the set returned by `PermissionsService.resolveApprovers(request)` (§7.3) — i.e., the per-key resource holders, plus AI-suggested approvers, plus workspace owners as a safety net.

| Event                         | Payload                                                                                                  | Recipients                                  |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `permission_request_created`  | `{ id, spellId, requesterBotId, permissionKey, requestedMetadata, reason, contextChannelId, expiresAt }` | All approvers for this request              |
| `permission_request_decided`  | `{ id, spellId, status, decidedByUserId, durableGrantId? }`                                              | Approvers + the requester bot's connections |
| `permission_request_consumed` | `{ id, requesterBotId, key }`                                                                            | Approvers (UI hides consumed)               |
| `permission_grant_created`    | `{ id, subjectKind, subjectId, permissionKey, scopeMetadata }`                                           | Approvers                                   |
| `permission_grant_revoked`    | `{ id }`                                                                                                 | Approvers                                   |

Events are emitted by `PermissionsService` after DB writes (single transaction commits, then publishes).

## 10. Frontend

### 10.1 Components

```
apps/client/src/components/permissions/
├── PermissionInbox.tsx          # list of pending requests, real-time
├── PermissionRequestCard.tsx    # single request: spell id (copy button), reason, allow once / remember / deny
├── ScopeEditor.tsx              # JSON-form editor driven by metadata schema (key-aware)
├── GrantList.tsx                # per-subject grant table
└── GrantEditor.tsx              # create/edit a grant for a chosen subject
```

Settings surfaces:

- Agent settings page: "Permissions" tab → `<GrantList subjectKind='agent' subjectId={botId} />`
- Channel settings → `<GrantList subjectKind='channel-session' subjectId={channelId} />`
- Routine detail page → `<GrantList subjectKind='task' subjectId={routineId} />`

Top-bar: bell icon shows badge with `pendingPermissionCount`; clicking opens `PermissionInbox`.

In-channel UX: when a bot files a request whose `contextChannelId === currentChannel`, render an inline system-style message card embedding the request's spell id and the same approve/deny buttons (so users don't have to leave the chat).

### 10.2 State

- React Query hooks: `usePendingPermissionRequests()`, `useGrants(subject)`, `useDecidePermission()`, `useCreateGrant()`, `useRevokeGrant()`.
- Zustand `useAppStore` adds `pendingPermissionCount: number` driven by `permission_request_created` / `permission_request_decided` / `permission_request_consumed` events.

### 10.3 i18n

Strings under `apps/client/src/i18n/locales/{en,zh-CN}/permissions.json`. New domain.

## 11. Agent Integration (claw-hive client)

`packages/claw-hive/src/runtime/permissions-client.ts` exposes:

```ts
export class PermissionsClient {
  async ensure(
    key: string,
    metadata: object,
    opts?: {
      reason?: string;
      waitMs?: number; // default 300_000 (5 min)
      contextChannelId?: string;
      contextExecutionId?: string;
      contextRoutineId?: string;
    },
  ): Promise<
    | { allowed: true }
    | {
        allowed: false;
        reason: "denied" | "timeout" | "expired";
        spellId?: string;
      }
  >;
}
```

Implementation:

1. Call `gate(...)` via gateway. If allowed → return.
2. Else `POST /requests` with context. Receive `{ id, spellId }`.
3. (Optional) emit a synthetic system message in the bound channel announcing the spell id; UI renders the card.
4. Subscribe (via existing WS) for `permission_request_decided` matching `id`.
5. Resolve when decided or `waitMs` elapses.

v1 does **not** wire this into agent tool calls automatically — the agent code calls `permissions.ensure(...)` explicitly. Auto-wrapping is a future enhancement.

## 12. Audit & Observability

- All grants and decisions are durable rows; no separate audit table needed for v1.
- Add Pino structured log on every grant/request/decision: `{ event, tenantId, actorUserId, requesterBotId, permissionKey, decision, durable }`.
- Posthog event `permission_decided` for analytics on approval rates by key.

## 13. Edge Cases

| Case                                                               | Behavior                                                                                                                            |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Bot deleted while request pending                                  | Cancel request via cascade (`requester_bot_id` is FK; `ON DELETE CASCADE` on the column). Decision endpoint returns 404 thereafter. |
| Channel archived while grant active                                | Grant remains; check still resolves to the (archived) channel id. UI marks as "archived context" but doesn't auto-revoke.           |
| Routine execution completes before once-use approval consumed      | Approval expires when execution row's `completedAt` is non-null; `gate(...)` ignores it. Add condition in lookup.                   |
| Two parallel `gate()` calls racing to consume same `approved_once` | `consumedAt` update uses `WHERE consumed_at IS NULL` and checks affected rows; loser falls through to DENY.                         |
| Spell-id collision under load                                      | DB unique constraint + retry loop (max 5 attempts, escalating word count).                                                          |
| User decides after `expiresAt`                                     | Endpoint returns 409 Conflict with current status `expired`.                                                                        |
| Workspace/tenant deletion                                          | Both tables cascade via `tenant_id` FK.                                                                                             |

## 14. Testing Strategy

(Adheres to Team9 100% coverage rule.)

- **Unit:**
  - `permission-matcher.spec.ts` — exhaustive table tests for absent / array / string / glob.
  - `spell-id.service.spec.ts` — generation determinism via injectable RNG; collision retry; parse normalization.
  - `permissions.service.spec.ts` — grant creation, revoke, gate algorithm with all subject kinds, once-use consume race.
- **Integration:**
  - Gateway controller e2e against a Postgres testcontainer: full flow (proactive grant → gate allows; agent request → user decides once → second gate denies; remember → second gate allows).
  - WebSocket event delivery to authorized recipients only.
- **Frontend:**
  - Component tests for `PermissionRequestCard` (all three buttons, scope override).
  - React Query hook tests with MSW.
- **Regression:** none required (greenfield).

## 15. Rollout

The first PR ships everything needed to demonstrate and test the loop end-to-end:

1. **PR 1 (this spec)** — DB schema + `PermissionsService` (gate / grant / request / decide / consume) + per-key resolvers for `messages:send`, `tools:invoke`, `routine:trigger` + REST + WS events + frontend inbox & settings tabs + **one concrete enforcement point** (see below).
2. **PR 2+** — Add enforcement at additional call sites (wiki write, file-keeper ops, more routine actions) and the claw-hive auto-wrapper for tool calls.

**First enforcement point (PR 1):** `messages:send` for **bot cross-channel posts** — when a bot calls the message-create flow targeting a channel where it is not a member, the IM service calls `permissions.gate('messages:send', { channelId }, ctx)`. If denied, the IM service files a permission request (with the channel's owners/admins as the resolved approver set) and returns a `PERMISSION_PENDING` error to the bot containing `{ requestId, spellId }`. On approval, the bot retries.

Why this first:

- Fully server-enforced — testable from gateway integration tests without claw-hive in the loop.
- Smallest blast radius — only fires on the rare cross-channel post path; existing in-channel sends are unaffected.
- Demonstrates every system component: holder resolution (channel owners), spell-id propagation, in-channel approval card UX, durable-grant retry path.

No feature flag — additive only. A revert is purely a deletion.

## 16. Resolved Decisions (from 2026-05-02 review)

- **Q1 — `task` subject:** Confirmed = `routine__routines.id` (routine-definition level). Encoded in §3.
- **Q2 — Approvers:** The primary approver is the **resource holder**, resolved by a per-key `resolveApprovers(ctx)` function (§4). The bot may suggest extra approvers via `suggestedApproverIds` (§5.2, §8). Workspace owners are always included as a safety net. There is one canonical resolver, used by both REST and WS paths (§7.3).
- **Q3 — First enforcement point:** Ships in PR 1. Chosen call site: bot cross-channel `messages:send` (§15).
- **Q4 — Grant expiry:** No upper bound. `expiresAt` is `null` for indefinite, otherwise any future timestamp. The validator only rejects past timestamps.
- **Q5 — Spell word list:** BIP-39 English mnemonic list (§6) — the same list crypto wallets use for "secret words" / recovery phrases.

## 17. Files To Be Created / Modified (sketch)

```
NEW:
  apps/server/libs/database/src/schemas/permissions/grants.ts
  apps/server/libs/database/src/schemas/permissions/requests.ts
  apps/server/libs/database/src/schemas/permissions/index.ts
  apps/server/libs/database/migrations/00XX_permissions_init.sql
  apps/server/apps/gateway/src/permissions/permissions.module.ts
  apps/server/apps/gateway/src/permissions/permissions.service.ts
  apps/server/apps/gateway/src/permissions/permissions.controller.ts
  apps/server/apps/gateway/src/permissions/permission-matcher.ts
  apps/server/apps/gateway/src/permissions/permission-keys.ts
  apps/server/apps/gateway/src/permissions/permissions-approver.repository.ts  # holder lookups (channel/wiki/routine/bot)
  apps/server/apps/gateway/src/permissions/spell-id.service.ts
  apps/server/apps/gateway/src/permissions/spell-words.ts                       # BIP-39 list
  apps/server/apps/gateway/src/permissions/dto/*.dto.ts
  apps/server/apps/gateway/src/permissions/__tests__/*.spec.ts
  apps/server/libs/shared/src/events/domains/permissions/index.ts
  apps/client/src/components/permissions/{PermissionInbox,PermissionRequestCard,GrantList,GrantEditor,ScopeEditor}.tsx
  apps/client/src/hooks/usePermissions.ts
  apps/client/src/i18n/locales/{en,zh-CN}/permissions.json
  packages/claw-hive/src/runtime/permissions-client.ts          # team9-agent-pi monorepo (PR 2+ only)

MODIFIED:
  apps/server/apps/gateway/src/app.module.ts                     # register PermissionsModule
  apps/server/libs/database/src/schemas/index.ts                 # re-export permissions
  apps/server/libs/shared/src/events/index.ts                    # add permissions domain
  apps/server/apps/gateway/src/im/messages/messages.service.ts   # call gate('messages:send') for cross-channel bot posts
  apps/client/src/services/websocket.ts                          # listeners
  apps/client/src/stores/useAppStore.ts                          # pendingPermissionCount
```
