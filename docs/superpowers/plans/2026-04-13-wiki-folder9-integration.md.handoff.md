# Wiki (folder9) Integration — Session Handoff

> Written at the end of a session that delivered **Task 1–11 (backend Phase 1)**. Handing off to a fresh session to continue with **Task 12–23 (frontend)**.
>
> Read this document, then `2026-04-13-wiki-folder9-integration-design.md` (spec), then `2026-04-13-wiki-folder9-integration.md` (plan), in that order.

## Quick Start for the Next Agent

You are inside a git worktree:

```
/Users/winrey/Projects/weightwave/team9/.claude/worktrees/wiki-folder9-integration
```

Always `cd` here first for any command. The parent repo (`/Users/winrey/Projects/weightwave/team9`) is on `main` with unrelated in-progress work — don't touch it.

Branch: `worktree-wiki-folder9-integration`. Latest commit as of handoff: `d9920a76`.

To resume:

1. Read this file in full.
2. Read the two co-located artifacts:
   - `docs/superpowers/specs/2026-04-13-wiki-folder9-integration-design.md` — the design spec (source of truth for requirements)
   - `docs/superpowers/plans/2026-04-13-wiki-folder9-integration.md` — the 23-task implementation plan
3. Read `.tasks.json` to see task status (tasks 0–10 are `completed`, 11–22 are `pending` — the array is 0-indexed but the task titles say "Task 1" through "Task 23")
4. Invoke the `superpowers-extended-cc:subagent-driven-development` skill (or `executing-plans` if running as a parallel session).
5. Start dispatching Task 12 implementer — see the "Task 12 First Steps" section below for the specific concerns.

## Status Snapshot — 11 / 23 tasks done

Backend Phase 1 is complete. All commits on `worktree-wiki-folder9-integration`.

| # | Task                                                     | Commit(s)                                 | Tests (wiki)    |
| - | -------------------------------------------------------- | ----------------------------------------- | --------------- |
| 1 | workspace_wikis schema + folder9 env vars                | `8811fd04` + fix `0ba78333`               | schema-only     |
| 2 | Folder9ClientService (13 methods, PSK + token auth)      | `2986ea82` + fix `fc185aa3` (timeout)     | 49              |
| 3 | Frontmatter parse/serialize util + shared fixtures       | `302ddf10`                                | 22              |
| 4 | Permission helpers + 8 DTOs                              | `6efbff6a`                                | 10              |
| 5 | WikisService CRUD + folder9 compensation rollback        | `d9acce29`                                | 29              |
| 6 | WikisService content ops + token cache + `createToken`   | `d9f589f2` + `22406dfe` + fix `118e5470`  | 67              |
| 7 | WikisController `/api/v1/wikis/*` + getRaw / getProposalDiff service extensions | `8a3d08b8`    | 25              |
| 8 | Folder9WebhookController (HMAC + rawBody + WS broadcast) | `18878257`                                | 22              |
| 9 | WikisModule wiring into AppModule                        | `bcae98a8`                                | boot            |
| 10 | WorkspaceService seed hook + backfill script             | `3f7cb509` + `d7ea3166`                   | 13              |
| 11 | Opt-in docker-compose integration test                   | `3dbe89eb`                                | 4 (skipped by default) |

~300 wiki unit tests, all green. 100% statements/functions/lines coverage on new code (minus known ts-jest artifacts on constructor-param branches — see patterns section).

Run the suite to verify:

```bash
cd /Users/winrey/Projects/weightwave/team9/.claude/worktrees/wiki-folder9-integration
pnpm --filter @team9/gateway test -- wikis
```

You should see 6 suites / ~300 tests passing. There is 1 suite skipped by default (the integration test, gated behind `INTEGRATION=1`).

## Critical Invariants — DO NOT VIOLATE

### 1. Wikis are a strict subset of folder9 managed folders

> "Not all folder9 folders are Wikis. `workspace_wikis` is the authoritative allow-list."

This is codified in the spec (added late in the session after the user flagged it). Concrete consequences:

- Every gateway operation starts from a `wikiId` (Team9 primary key), never from a bare `folder9FolderId`.
- The webhook controller returns `200 OK` with a warn log when it gets an event for a `folder_id` that isn't in `workspace_wikis` — folder9 may be hosting folders for completely unrelated features.
- Backfill scripts, enumeration endpoints, and future admin tooling MUST filter through `workspace_wikis`. Never query folder9's `/api/workspaces/{ws}/folders` endpoint and treat the response as "the list of Wikis."
- Frontend `useWikis()` hook (Task 13) calls the gateway's `/api/v1/wikis` — not folder9 directly — and the gateway reads `workspace_wikis`.

### 2. folder9 has two authentication modes

The original spec assumed a single PSK model. We discovered during Task 2 that folder9 actually splits auth into two tiers. This shapes every service method downstream:

| Endpoint family | Auth | Used by |
| --- | --- | --- |
| `POST/GET/PATCH/DELETE /api/workspaces/{ws}/folders[/:id]` | **Bearer PSK** | `Folder9ClientService.createFolder` / `getFolder` / `updateFolder` / `deleteFolder` / `createToken` |
| `GET .../tree`, `/blob`, `/raw`, `POST .../commit`, all `/proposals/*` | **Bearer scoped token** | Every other `Folder9ClientService` method — caller supplies the token |

Scoped tokens are minted by calling `POST /api/tokens` (PSK-protected) via `Folder9ClientService.createToken`. The token's `created_by` field becomes the **git commit author** inside folder9 — so every user who commits to a wiki needs their own token. Read-only operations share one token per wiki (keyed by `wiki:${folder9FolderId}`).

`WikisService.getFolderToken` handles all of this:

- Cache key: `${folder9FolderId}::${permission}::${createdBy}`
- TTL 15 min local, 16 min on folder9 side (so local cache invalidates first)
- Deduplicates concurrent mints by storing the in-flight Promise
- Evicts expired entries on miss (bounded map growth)
- Logs mint failures with `folder=<id> permission=<perm> createdBy=<name>` context

### 3. `write` does NOT bypass `review` mode (MVP simplification)

folder9's spec allows `write` permission to commit directly to main even when `approval_mode=review`. The Team9 gateway **disables that** in MVP — `review` mode always forces `propose=true`, regardless of the user's permission level. This is documented in the spec's Permission Model section. If product later wants a "trusted editor" role, revisit there.

### 4. No server-side draft storage (MVP)

Drafts live in browser localStorage keyed by `team9.wiki.draft.{workspaceId}.{folder9FolderId}.{pathBase64}.{userId}`. Don't build a `wiki_drafts` table or endpoint — it's explicitly in the Future Work list. The client-side draft hook comes in Task 17.

## folder9 Real API — Drift Notes

These are things the plan's illustrative code got wrong, and the delivered code corrects. If the next agent writes more client code or extends the service, respect these:

### Wire format is snake_case, not camelCase

folder9 marshals Go structs with default JSON tags, yielding snake_case. So `Folder9Folder`, `Folder9TreeEntry`, `Folder9Proposal`, etc. in `types/folder9.types.ts` use `owner_type`, `owner_id`, `workspace_id`, `approval_mode`, `created_at`, `updated_at`, `folder_id`, `reviewed_by`, `author_id`, `author_type`, `branch_name`.

The Team9 DTOs (`WikiDto`, `TreeEntryDto`, `PageDto`, `ProposalDto`) are camelCase — the translation happens in `WikisService` (mostly `toDto()` helpers). Frontend consumes camelCase only.

### Commit author attribution — no body fields

folder9's commit endpoint does NOT accept `authorName`/`authorEmail` in the request body. It reads the git author from the **token's `created_by` field** (and builds the email as `{created_by}@folder9`). That's why the token cache keys on `(folderId, permission, createdBy)`.

### Commit response is flat

folder9 returns `{ commit: string, branch: string, proposal_id?: string }`. The service synthesizes the nested `{commit: {sha}, proposal: {id, status}}` shape used by the controller/client.

### Proposal response fields

`handlers_proposals.go` emits `reviewed_by` but NOT `reviewed_at`. `ProposalDto.reviewedAt` is hard-coded `null` — don't try to read it from folder9. If folder9 adds the field later, widen the mapper at that point.

### Proposal status `merged` — dead code

folder9's valid statuses are `pending | approved | rejected | changes_requested`. No `merged` state exists. `Folder9ProposalStatus` in the types file includes `'merged'` defensively but it's dead. The DTO mapper normalizes it to `approved` just in case. Safe to drop later, leave alone for now.

### `approve`/`reject` bodies use `reviewer_id` (snake_case)

Both `POST /proposals/{pid}/approve` and `/reject` expect `{ "reviewer_id": "..." }`. The client service passes this correctly; don't "fix" it to camelCase.

### Webhook payload is flat snake_case

folder9's webhook dispatcher sends:

```json
{
  "event": "proposal.created",
  "folder_id": "uuid",
  "workspace_id": "tenant-id",
  "data": { ... },
  "timestamp": "2026-04-13T..."
}
```

Signature header `X-Folder9-Signature: sha256=<hex>`. Some event payloads have fields at the top level instead of under `data` (historical inconsistency in folder9). The webhook controller's `pick()` helper falls back from `data.x` to top-level `x` to handle both shapes.

### No dedicated `/diff` endpoint

folder9 embeds `diff_summary` directly in the proposal GET response. `Folder9ClientService.getProposalDiff` just extracts it from `getProposal()`. Don't look for a separate URL.

### folder9 `recursive=true` on `/tree` returns FILES ONLY

A classic footgun. A recursive tree call to folder9 returns only file entries with full paths — it does NOT return directory entries. The client-side tree building in Task 16 must derive directory nodes from file paths by splitting on `/`. Empty directories won't appear in the tree — acceptable because the UI never creates empty folders (creating a folder-as-page always writes an `index.md` inside).

## Patterns & Conventions Learned

### Team9 conventions that surprised us

1. **`@team9/gateway`, not `@team9/server`.** The Turbo `--filter @team9/server` fans out to multiple sub-packages and fails on sub-packages without matching specs. Always use `pnpm --filter @team9/gateway test ...` for targeted gateway work.

2. **URI versioning.** Controllers use `@Controller({ path: 'wikis', version: '1' })`, not `@Controller('api/wikis')`. The global prefix is `api` and the default version is `1`, so the resolved URL is `/api/v1/wikis/*`.

3. **"Workspace" = "tenant" in the backend.** There is no `@CurrentWorkspaceId()` decorator — use `@CurrentTenantId()` from `src/common/decorators/current-tenant.decorator.js`. `WorkspaceGuard` reads `request.tenantId` under the hood. The frontend uses "workspace" terminology for user-facing labels, but the backend is built on "tenant".

4. **User identity in controllers.** Use `@CurrentUser('sub') userId: string` (returns the JWT `sub` claim). To determine `isAgent`, call `BotService.isBot(userId)` — this is the canonical `users.userType === 'bot'` check. Then construct `ActingUser { id, isAgent }` yourself. `BotModule` is `@Global()` so the import works automatically in `WikisController`.

5. **Drizzle migrations can't be generated today.** `pnpm db:generate` fails because of a pre-existing `0034/0035` snapshot-chain collision in the repo's meta. Migrations 0036–0039 are **all hand-authored bare SQL** without snapshot updates. Follow the same pattern if you need another migration. When someone eventually fixes the meta chain, the snapshots can be regenerated from scratch.

6. **Pre-commit hooks reformat.** Lint-staged runs prettier + eslint --fix. Commits can come back with broader whitespace diffs than the author wrote — acceptable. If it reformats a long doc (like the plan) that wasn't prettified before, the diff can look huge; only substantive lines matter.

7. **`NestFactory.create(AppModule, { rawBody: true })` is now set.** Task 8 enabled this so the webhook HMAC verification can hash the raw bytes. Existing `@Body()` consumers still work; any new middleware that reads the request stream must not consume `req.rawBody`.

### Test mocking patterns

1. **Drizzle chain mock.** Every method on the chain returns the same chain object so fluent calls work: `db.select().from(...).where(...).limit(...)`. Terminal methods (`returning`, `limit`, `orderBy`) queue results via `mockResolvedValueOnce` in FIFO order matching the service's call sequence.

   ```ts
   function mockDb() {
     const chain: Record<string, jest.Mock> = {};
     const methods = ['select','from','where','and','eq','insert','values',
                      'returning','update','set','delete','orderBy','limit'];
     for (const m of methods) chain[m] = jest.fn().mockReturnValue(chain);
     return chain;
   }
   ```

   Fragile invariant: if a service is later refactored to NOT call `.limit()`, queue ordering breaks silently. Worth a comment if you add complex multi-query paths.

2. **Folder9ClientService mock.** Jest mock object with all methods pre-stubbed; assertions check both call count AND args (path, body, headers). Never trust that "fetch was called" — verify what it was called WITH.

3. **ts-jest parameter-decorator branch artifact.** Every `@Inject(TOKEN) private readonly x: T` constructor parameter emits an unreachable default-value ternary in the ts-jest output. That becomes an uncovered branch in Istanbul's report — typically 1 per injected dep. **This is NOT a real gap.** Services in this codebase sit at ~97-98% branches because of this artifact. Don't try to reach 100% branches; target 100% statements/functions/lines and accept the one-or-two branch residue per file.

### NestJS + Drizzle conventions

- Services inject the DB via `@Inject(DATABASE_CONNECTION) private readonly db: PostgresJsDatabase<typeof schema>`.
- Schemas are imported as `import { schema } from '@team9/database'` and accessed as `schema.workspaceWikis`, `schema.users`, etc.
- Timestamps stored as Drizzle `Date`s, converted to ISO strings in the DTO mapper.
- Logger: instantiate with `private readonly logger = new Logger(ClassName.name)` (not injected).
- Guards live at the controller level — `@UseGuards(AuthGuard, WorkspaceGuard)` is applied once per class. Public endpoints (like webhooks) omit the decorator entirely.

## Known Issues — Pre-existing, NOT introduced by this work

Verified by running the same specs against the `dev` base branch (via `git stash`) and observing the same failures.

1. **`installed-applications.controller.spec.ts` and `installed-applications.service.spec.ts`** — 10 tests fail on dev baseline. Unrelated to Wiki work. Must be resolved before CI green but NOT in scope for this feature.

2. **Drizzle meta snapshot chain broken (0034/0035 collision).** `pnpm db:generate` refuses to run. All migrations 0036+ are hand-authored. Don't try to fix this in-scope; someone will regenerate the full snapshot history as a separate cleanup.

3. **`@team9/server` Turbo filter is noisy.** Several sub-packages under the `@team9/server` umbrella don't have test specs, so `pnpm --filter @team9/server test ...` errors out on them. Use `@team9/gateway` for targeted runs.

## Known Minor Debt in the New Code (deferred, not fixed)

Tracked items the code reviewers flagged but didn't block merge. Consider when you have time:

1. **`CreateWikiDto.icon` is silently dropped** — Task 5/7's DTO accepts `icon` but there's no column for it and the service ignores it. Spec says icons belong on the page's `index.md` frontmatter, not on the wiki itself. Either remove the field from the DTO (cleaner) or extend the schema + `toDto()` when Task 20 (create dialog) needs it. Decision should happen in Task 20.

2. **`updateWikiSettings` is not transactional across DB + folder9.** If the DB update succeeds but the folder9 mirror fails, name/approval_mode diverge between the two systems. `createWiki` has compensation, `updateWikiSettings` does not. Add a compensation path OR document the inconsistency explicitly. Low-probability issue (both services are stable in practice).

3. **`getWiki` test at `wikis.service.spec.ts:418-434` is mislabeled.** Title says "throws ForbiddenException" but it tests the happy path because `read` is the minimum permission level. Rename the test to "succeeds for read-only user (lowest level)" for clarity.

4. **`loadUserProfile` fetches an `email` that's never used.** The commit path uses the token's `created_by` (= displayName) and folder9 synthesizes the email. Keep `email` in the helper or drop it — either is fine, not urgent.

5. **Pre-existing `installed-applications` failures.** See above.

None of these block Task 12.

## Task 12 — First Steps for the Next Agent

Task 12 is the **first frontend task** and is substantial — it renames the `library` nav section to `wiki` across 12 i18n locale files, deletes `LibraryMainContent` and its route, wires new placeholder components into `DynamicSubSidebar`, and updates two tests. It's classified as **complex** because:

- Touches ~20 files across i18n, routing, layout, tests
- Has destructive steps (deleting `LibraryMainContent.tsx` + its route)
- Any mistake in the locale files is user-visible

Double review recommended (spec + quality).

### Before dispatching the implementer

1. Read the full Task 12 section of the plan. The plan has exact line references for `MainSidebar.tsx:76`, `mainSidebarUnlock.ts:11-15`, etc.

2. Confirm the `SidebarSection` type location. Grep for `SidebarSection` in `apps/client/src/stores/` — the new literal `"wiki"` needs to be added there.

3. Decide whether to touch all 12 locales in one commit or one per locale. Since the translation stays the same (`"library": "知识库"` → `"wiki": "知识库"` etc. — same user-facing text), a single sweep is fine.

4. The placeholder `WikiSubSidebar` and `WikiMainContent` from Task 12 are intentionally minimal. Real implementations come in Tasks 16 and 17. Don't over-build.

### Testing expectations

- `pnpm --filter @team9/client test` must pass after Task 12
- `pnpm --filter @team9/client build` must succeed
- Existing tests like `MainSidebar.user-menu.test.tsx` and `mainSidebarUnlock.test.ts` need their `"library"` → `"wiki"` string updates

### Task ordering note

Tasks 13 (API client/hooks/store) and 14 (client frontmatter util) can run in parallel with Task 15 (routes) after 12 lands. Tasks 16–23 stack sequentially on top of 12/13/14/15. See the dependency table in the plan's "Tasks Overview" section.

## Review Cadence — what worked in this session

The user chose **Option 4** mid-session: complex tasks get double review (spec + quality), simple tasks get single review or spot-check. That classification worked well. For frontend:

**Complex (double review):**
- Task 12 (touches lots of files, destructive deletions)
- Task 16 (recursive tree derivation + filtering)
- Task 17 (draft localStorage persistence with stale detection)
- Task 18 (Lexical + frontmatter round-trip)
- Task 19 (save flow state machine — auto vs review mode)
- Task 21 (proposal diff view + permission gating)
- Task 22 (binary upload + size limit)
- Task 23 (WS event routing + store mutation)

**Simple (spec review + spot check):**
- Task 13 (many small files, each trivial)
- Task 14 (mirrors the gateway frontmatter util)
- Task 15 (TanStack router scaffold)
- Task 20 (standard dialog UI)

Adjust as your judgment dictates — these are starting points.

### Workflow tips that save context

- Subagent's report is usually trustworthy enough to mark a task complete if both reviewers said ✅. Spot-check via `Read` on key files rather than dispatching another reviewer.
- Small review-fix cycles (2-line changes) can be done via a fresh general-purpose subagent rather than a full `superpowers-extended-cc:code-reviewer` dispatch.
- Update `.tasks.json` every time a task completes so a cross-session resume sees the right state.
- If the shell seems to "escape" the worktree (git log shows main-branch commits), you've lost the `cd` — always `cd /Users/winrey/Projects/weightwave/team9/.claude/worktrees/wiki-folder9-integration &&` at the top of each commit sequence.

## Final Repository State

```
worktree-wiki-folder9-integration (HEAD: d9920a76)
└── based on dev at 0e3d1907 "docs(spec): agent DM row pills ..."
```

Commits introduced by this session (newest first):

```
d9920a76 chore(wiki): mark Task 11 complete; backend Phase 1 done
3dbe89eb test(wiki): add opt-in integration test against real folder9
d7ea3166 feat(wiki): add idempotent backfill script for public wiki seed
3f7cb509 feat(wiki): seed default public wiki on workspace creation
5ffa4ad4 chore(wiki): mark Task 9 completed in .tasks.json
bcae98a8 feat(wiki): register WikisModule in gateway
cdfc6f87 chore(wiki): mark Task 8 completed in .tasks.json
18878257 feat(wiki): add folder9 webhook receiver with HMAC verification
73e66b96 chore(wiki): mark Task 7 completed in .tasks.json
8a3d08b8 feat(wiki): add WikisController REST endpoints (+ getRaw / getProposalDiff on service)
823a859b docs(wiki): codify Wiki ⊂ folder9 invariant + mark Task 6 complete
118e5470 fix(wiki): evict expired tokens, dedupe concurrent mints, log failures
22406dfe feat(wiki): add tree/page/commit/proposal ops to WikisService
d9f589f2 feat(wiki): add Folder9ClientService.createToken for scoped token minting
cf671784 chore(wiki): mark Task 5 completed in .tasks.json
d9acce29 feat(wiki): add WikisService CRUD with folder9 compensation rollback
6ab29c2b chore(wiki): mark Task 4 completed in .tasks.json
6efbff6a feat(wiki): add permission helpers and request/response DTOs
1d3b8bb7 chore(wiki): mark Task 3 completed in .tasks.json
302ddf10 feat(wiki): add YAML frontmatter parse/serialize util with shared fixtures
8ac5cf74 chore(wiki): mark Task 2 completed in .tasks.json
fc185aa3 fix(wiki): add request timeout to Folder9ClientService
2986ea82 feat(wiki): add Folder9ClientService for service-to-service folder9 calls
98c820d8 chore(wiki): mark Task 1 completed in .tasks.json
0ba78333 fix(wiki): use array-form index callback and drop redundant notNull on PK
8811fd04 feat(wiki): add workspace_wikis schema and folder9 env vars
0b6ad4af docs(wiki): add implementation plan and task persistence file
ff89a8da docs(wiki): add design spec for folder9 integration as knowledge base
```

Latest merge-base with `dev`: `0e3d1907`. Run `git diff 0e3d1907..HEAD --stat` for a full change summary.

## Closing Note to the Next Agent

Good luck. The backend is solid; the frontend plan is detailed. The folder9 service is cooperative but its wire format and auth model differ from what the plan originally assumed — always cross-check against the real folder9 source at `/Users/winrey/Projects/weightwave/folder9` when types or routes surprise you.

When in doubt, ask the user (Winrey / 雨夏夏) — they've been guiding the design decisions actively throughout. If you propose a change to the spec or plan, land it as a docs commit first, then implement. The user prefers review-driven iteration and will push back on lazy work; deliver well-tested, well-reviewed code and communicate surprises immediately.




