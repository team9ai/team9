# Wiki (folder9 Integration) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new top-level `Wiki` section to Team9 that stores hierarchical markdown knowledge bases in folder9 managed folders, with Notion-like editing (cover, icon, index.md folder-as-page), manual Save, and optional PR review workflow.

**Architecture:** All browser↔folder9 traffic proxies through the Team9 NestJS gateway (new `WikisModule`) using a pre-shared key. folder9 remains the source of truth for content, git history, and proposals. Team9 keeps a lightweight `workspace_wikis` pointer table and enforces workspace-role permissions (`workspace_human` / `workspace_agent` × `read` / `propose` / `write`) before delegating to folder9.

**Tech Stack:**

- Backend: NestJS 11, Drizzle ORM, PostgreSQL, Socket.io, native `fetch` (no axios), Jest
- Frontend: React 19 + TanStack Router + TanStack Query + Zustand, Lexical (via existing `DocumentEditor`), Vitest + React Testing Library
- Integration: folder9 REST API + webhook (HMAC-SHA256 signed)

**Design spec:** [docs/superpowers/specs/2026-04-13-wiki-folder9-integration-design.md](../specs/2026-04-13-wiki-folder9-integration-design.md)

---

## File Structure

### Backend — new

```
apps/server/libs/database/src/schemas/wiki/
├── workspace-wikis.ts            Drizzle schema for workspace_wikis
└── index.ts                      export barrel

apps/server/apps/gateway/src/wikis/
├── wikis.module.ts
├── wikis.controller.ts           /api/wikis/*
├── wikis.service.ts              CRUD + permission + orchestration
├── folder9-client.service.ts     typed fetch wrapper around folder9
├── folder9-webhook.controller.ts /api/folder9/webhook
├── utils/
│   ├── frontmatter.ts            parse/serialize YAML frontmatter
│   └── permission.ts             resolveWikiPermission + requirePermission
├── dto/
│   ├── create-wiki.dto.ts
│   ├── update-wiki.dto.ts
│   ├── commit-page.dto.ts
│   ├── wiki.dto.ts
│   ├── tree-entry.dto.ts
│   ├── page.dto.ts
│   └── proposal.dto.ts
├── types/
│   └── folder9.types.ts          Folder9 request/response shapes (internal)
├── scripts/
│   └── backfill-public-wiki.ts   migration for existing workspaces
└── __tests__/
    ├── wikis.service.spec.ts
    ├── wikis.controller.spec.ts
    ├── folder9-client.service.spec.ts
    ├── folder9-webhook.controller.spec.ts
    ├── frontmatter.spec.ts
    ├── permission.spec.ts
    └── integration/
        └── wiki-folder9.integration.spec.ts   hits real folder9

apps/server/libs/shared/test-fixtures/wiki-frontmatter/
├── basic.md                       round-trip fixture
├── no-frontmatter.md
├── unknown-keys.md
└── empty-body.md
```

### Backend — modified

```
apps/server/libs/database/src/schemas/index.ts         add wiki re-export
apps/server/apps/gateway/src/app.module.ts             wire WikisModule
apps/server/apps/gateway/src/workspace/workspace.service.ts  add seed hook
apps/server/libs/shared/src/env.ts                     add FOLDER9_* getters
apps/server/apps/gateway/src/im/websocket/websocket.gateway.ts  add wiki WS events helper (if needed)
```

### Frontend — new

```
apps/client/src/components/layout/sidebars/WikiSubSidebar.tsx
apps/client/src/components/layout/contents/WikiMainContent.tsx
apps/client/src/components/wiki/
├── WikiEmptyState.tsx
├── WikiTreeNode.tsx
├── WikiPageView.tsx
├── WikiPageHeader.tsx
├── WikiCover.tsx
├── WikiStatusBar.tsx
├── WikiProposalBanner.tsx
├── WikiPageEditor.tsx             DocumentEditor wrapper + frontmatter
├── CreateWikiDialog.tsx
├── WikiSettingsDialog.tsx
├── ReviewPanel.tsx
├── ProposalDiffView.tsx
├── IconPickerPopover.tsx
└── CoverPickerPopover.tsx

apps/client/src/routes/_authenticated/wiki/
├── index.tsx
├── $wikiSlug.tsx
└── $wikiSlug/$.tsx

apps/client/src/hooks/useWikis.ts                      React Query hooks
apps/client/src/hooks/useWikiPage.ts                   single-page hook (load + save + draft)
apps/client/src/hooks/useWikiDraft.ts                  localStorage draft persistence
apps/client/src/hooks/useWikiProposals.ts

apps/client/src/services/api/wikis.ts                  typed client → /api/wikis/*
apps/client/src/stores/wiki.ts                         Zustand: selected wiki/page, expand state
apps/client/src/lib/wiki-frontmatter.ts                parse/serialize YAML frontmatter
apps/client/src/types/wiki.ts                          shared DTOs mirroring backend
```

### Frontend — modified

```
apps/client/src/components/layout/MainSidebar.tsx             library → wiki rename
apps/client/src/components/layout/mainSidebarUnlock.ts        library → wiki in HIDDEN_NAV_SECTION_IDS
apps/client/src/components/layout/DynamicSubSidebar.tsx       add case 'wiki' → <WikiSubSidebar/>
apps/client/src/components/layout/contents/*.tsx (wrapper)    route wiki → <WikiMainContent/>
apps/client/src/i18n/locales/{12 locales}/navigation.json     library → wiki key
apps/client/src/services/websocket/index.ts                   register wiki_* event types (if needed)
```

### Frontend — deleted

```
apps/client/src/components/layout/contents/LibraryMainContent.tsx
apps/client/src/routes/_authenticated/library/index.tsx
apps/client/src/components/layout/contents/__tests__/*Library*
```

---

## Tasks Overview

| #   | Task                                                   | Depends on | Layer    |
| --- | ------------------------------------------------------ | ---------- | -------- |
| 1   | Database schema + env vars                             |            | Backend  |
| 2   | Folder9ClientService + shared types                    | 1          | Backend  |
| 3   | Frontmatter util (gateway) + test fixtures             |            | Backend  |
| 4   | Permission helpers + DTOs                              | 1          | Backend  |
| 5   | WikisService (CRUD)                                    | 2, 3, 4    | Backend  |
| 6   | WikisService (tree / page / commit / proposals)        | 5          | Backend  |
| 7   | WikisController                                        | 6          | Backend  |
| 8   | Folder9WebhookController + WS broadcast                | 7          | Backend  |
| 9   | WikisModule wiring into AppModule                      | 8          | Backend  |
| 10  | Workspace creation seed hook + backfill script         | 9          | Backend  |
| 11  | Integration test against real folder9                  | 10         | Backend  |
| 12  | i18n + MainSidebar rename + delete old Library         |            | Frontend |
| 13  | Types + API client + React Query hooks + Zustand store | 12         | Frontend |
| 14  | Frontmatter util (client) + shared fixtures            | 3          | Frontend |
| 15  | Wiki routes + WikiMainContent shell                    | 13         | Frontend |
| 16  | WikiSubSidebar (list + tree)                           | 13         | Frontend |
| 17  | WikiPageView + draft persistence                       | 14, 15     | Frontend |
| 18  | WikiPageEditor (DocumentEditor wrapper + frontmatter)  | 17         | Frontend |
| 19  | Save flow (auto + review mode + proposal banner)       | 18         | Frontend |
| 20  | Create Wiki + settings + archive dialogs               | 16         | Frontend |
| 21  | Review panel (list + diff + approve/reject)            | 19         | Frontend |
| 22  | Image paste/drop upload                                | 18         | Frontend |
| 23  | WebSocket event consumers                              | 19, 21     | Frontend |

Tasks 1–11 are backend only, 12–23 are frontend only. Within a phase, task order follows dependency; tasks with the same dependencies may run in parallel.

---

## Task 1: Database schema + env vars

**Goal:** Create the `workspace_wikis` Drizzle schema, run the migration, and wire three new environment variables for folder9 in the gateway.

**Files:**

- Create: `apps/server/libs/database/src/schemas/wiki/workspace-wikis.ts`
- Create: `apps/server/libs/database/src/schemas/wiki/index.ts`
- Modify: `apps/server/libs/database/src/schemas/index.ts` (export new barrel)
- Modify: `apps/server/libs/shared/src/env.ts` (add three getters)
- Generated: `apps/server/libs/database/migrations/XXXX_add_workspace_wikis.sql`

**Acceptance Criteria:**

- [ ] `workspace_wikis` table exists in the DB after `pnpm db:migrate`
- [ ] Enums `wiki_approval_mode` and `wiki_permission_level` created in the migration
- [ ] Unique index on `(workspace_id, slug)` and on `folder9_folder_id`
- [ ] `env.FOLDER9_API_URL`, `env.FOLDER9_PSK`, `env.FOLDER9_WEBHOOK_SECRET` available
- [ ] `pnpm build:server` passes with no TS errors

**Verify:**

```bash
pnpm --filter @team9/server db:push --dry-run
pnpm --filter @team9/server exec tsc --noEmit
```

Expected: migration SQL contains `CREATE TABLE "workspace_wikis"`, no TS errors.

**Steps:**

- [ ] **Step 1: Write the schema**

Create `apps/server/libs/database/src/schemas/wiki/workspace-wikis.ts`:

```ts
import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  pgEnum,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const wikiApprovalModeEnum = pgEnum("wiki_approval_mode", [
  "auto",
  "review",
]);

export const wikiPermissionLevelEnum = pgEnum("wiki_permission_level", [
  "read",
  "propose",
  "write",
]);

export const workspaceWikis = pgTable(
  "workspace_wikis",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: text("workspace_id").notNull(),
    folder9FolderId: uuid("folder9_folder_id").notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    slug: varchar("slug", { length: 100 }).notNull(),
    approvalMode: wikiApprovalModeEnum("approval_mode")
      .default("auto")
      .notNull(),
    humanPermission: wikiPermissionLevelEnum("human_permission")
      .default("write")
      .notNull(),
    agentPermission: wikiPermissionLevelEnum("agent_permission")
      .default("read")
      .notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    archivedAt: timestamp("archived_at"),
  },
  (table) => [
    uniqueIndex("workspace_wikis_workspace_slug_unique").on(
      table.workspaceId,
      table.slug,
    ),
    uniqueIndex("workspace_wikis_folder9_unique").on(table.folder9FolderId),
    index("workspace_wikis_workspace_idx").on(table.workspaceId),
  ],
);

export type WorkspaceWiki = typeof workspaceWikis.$inferSelect;
export type NewWorkspaceWiki = typeof workspaceWikis.$inferInsert;
```

- [ ] **Step 2: Create the barrel file**

Create `apps/server/libs/database/src/schemas/wiki/index.ts`:

```ts
export * from "./workspace-wikis.js";
```

- [ ] **Step 3: Re-export from top-level schemas index**

Edit `apps/server/libs/database/src/schemas/index.ts` — add:

```ts
export * from "./wiki/index.js";
```

- [ ] **Step 4: Add env var getters**

Edit `apps/server/libs/shared/src/env.ts` — add after existing getters:

```ts
  get FOLDER9_API_URL() {
    return process.env.FOLDER9_API_URL;
  },
  get FOLDER9_PSK() {
    return process.env.FOLDER9_PSK;
  },
  get FOLDER9_WEBHOOK_SECRET() {
    return process.env.FOLDER9_WEBHOOK_SECRET;
  },
```

- [ ] **Step 5: Generate + apply the migration**

Run from repo root:

```bash
pnpm db:generate
pnpm db:push  # or pnpm db:migrate if prod-style migration is required
```

Expected output: new file under `apps/server/libs/database/migrations/` named like `0XXX_add_workspace_wikis.sql` with `CREATE TABLE workspace_wikis` and the two enum types.

- [ ] **Step 6: Type-check**

```bash
pnpm --filter @team9/server exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/server/libs/database/src/schemas/wiki apps/server/libs/database/src/schemas/index.ts apps/server/libs/database/migrations apps/server/libs/shared/src/env.ts
git commit -m "feat(wiki): add workspace_wikis schema and folder9 env vars"
```

---

## Task 2: Folder9ClientService + internal types

**Goal:** Build a typed `fetch`-based client that the gateway uses to talk to folder9. Every call attaches the PSK header. Unit-tested with a mocked fetch.

**Files:**

- Create: `apps/server/apps/gateway/src/wikis/folder9-client.service.ts`
- Create: `apps/server/apps/gateway/src/wikis/types/folder9.types.ts`
- Create: `apps/server/apps/gateway/src/wikis/__tests__/folder9-client.service.spec.ts`

**Acceptance Criteria:**

- [ ] Service has typed methods for every folder9 endpoint the gateway needs (see [spec §Folder9ClientService](../specs/2026-04-13-wiki-folder9-integration-design.md#folder9clientservice))
- [ ] Every request includes the PSK header (verify against [folder9 `internal/auth/`](../../../folder9/internal/auth/) during step 1)
- [ ] Non-2xx responses throw a `Folder9ApiError` with `status`, `body`, `endpoint`
- [ ] Network errors mapped to `Folder9NetworkError`
- [ ] Tests cover: create/list/get folder, tree, blob, commit (auto + propose), list/approve/reject proposal, bad status, network error, missing env var
- [ ] 100% coverage on `folder9-client.service.ts`

**Verify:**

```bash
pnpm --filter @team9/server test -- folder9-client.service.spec --coverage
```

Expected: all tests pass, `folder9-client.service.ts` at 100% statements/branches/functions/lines.

**Steps:**

- [ ] **Step 1: Confirm the PSK header name**

Open [folder9's auth middleware](../../../folder9/internal/auth/) and find which header the PSK check reads. Replace `PSK_HEADER` in step 2 with the exact value (e.g., `X-Folder9-PSK` or whatever folder9 uses).

- [ ] **Step 2: Write the type definitions**

Create `apps/server/apps/gateway/src/wikis/types/folder9.types.ts`:

```ts
export type Folder9FolderType = "managed" | "light";
export type Folder9ApprovalMode = "auto" | "review";
export type Folder9Permission = "read" | "propose" | "write" | "admin";
export type Folder9ProposalStatus =
  | "pending"
  | "changes_requested"
  | "approved"
  | "rejected";

export interface Folder9Folder {
  id: string;
  name: string;
  type: Folder9FolderType;
  ownerType: "agent" | "workspace";
  ownerId: string;
  workspaceId: string;
  approvalMode: Folder9ApprovalMode;
  createdAt: string;
  updatedAt: string;
}

export interface Folder9TreeEntry {
  name: string;
  path: string;
  type: "file" | "dir";
  size: number;
}

export interface Folder9BlobResponse {
  content: string; // UTF-8 decoded
  size: number;
}

export interface Folder9CommitFile {
  path: string;
  content: string;
  encoding?: "text" | "base64";
  action: "create" | "update" | "delete";
}

export interface Folder9CommitRequest {
  message: string;
  files: Folder9CommitFile[];
  propose?: boolean;
  authorName?: string;
  authorEmail?: string;
}

export interface Folder9CommitResponse {
  commit: { sha: string };
  proposal?: { id: string; status: Folder9ProposalStatus; branchName: string };
}

export interface Folder9Proposal {
  id: string;
  folderId: string;
  branchName: string;
  title: string;
  description: string;
  status: Folder9ProposalStatus;
  authorType: "agent" | "user";
  authorId: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export class Folder9ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly endpoint: string,
    public readonly body: unknown,
  ) {
    super(`folder9 API ${status} at ${endpoint}`);
    this.name = "Folder9ApiError";
  }
}

export class Folder9NetworkError extends Error {
  constructor(
    public readonly endpoint: string,
    cause: unknown,
  ) {
    super(`folder9 network error at ${endpoint}`);
    this.name = "Folder9NetworkError";
    this.cause = cause;
  }
}
```

- [ ] **Step 3: Write the failing test**

Create `apps/server/apps/gateway/src/wikis/__tests__/folder9-client.service.spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { Folder9ClientService } from "../folder9-client.service.js";
import {
  Folder9ApiError,
  Folder9NetworkError,
} from "../types/folder9.types.js";

const ORIGINAL_FETCH = globalThis.fetch;
const PSK_HEADER = "X-Folder9-PSK"; // replace with the real header name

function mockEnv(
  overrides: Partial<{ FOLDER9_API_URL: string; FOLDER9_PSK: string }> = {},
) {
  process.env.FOLDER9_API_URL =
    overrides.FOLDER9_API_URL ?? "http://folder9.test";
  process.env.FOLDER9_PSK = overrides.FOLDER9_PSK ?? "psk-test";
}

function mockFetchOnce(response: { status: number; body: unknown }) {
  const fn = jest.fn(
    async () =>
      new Response(JSON.stringify(response.body), {
        status: response.status,
        headers: { "content-type": "application/json" },
      }),
  );
  globalThis.fetch = fn as unknown as typeof globalThis.fetch;
  return fn;
}

describe("Folder9ClientService", () => {
  let svc: Folder9ClientService;

  beforeEach(async () => {
    mockEnv();
    const module = await Test.createTestingModule({
      providers: [Folder9ClientService],
    }).compile();
    svc = module.get(Folder9ClientService);
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    delete process.env.FOLDER9_API_URL;
    delete process.env.FOLDER9_PSK;
  });

  it("createFolder POSTs to /api/workspaces/{wsId}/folders with PSK header", async () => {
    const fetchFn = mockFetchOnce({
      status: 201,
      body: { id: "f-1", name: "wiki", type: "managed" },
    });

    const result = await svc.createFolder("ws-1", {
      name: "wiki",
      type: "managed",
      ownerType: "workspace",
      ownerId: "ws-1",
      approvalMode: "auto",
    });

    expect(result.id).toBe("f-1");
    expect(fetchFn).toHaveBeenCalledWith(
      "http://folder9.test/api/workspaces/ws-1/folders",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ [PSK_HEADER]: "psk-test" }),
      }),
    );
  });

  it("maps 4xx responses to Folder9ApiError", async () => {
    mockFetchOnce({ status: 403, body: { error: "FORBIDDEN" } });
    await expect(svc.getFolder("ws-1", "f-1")).rejects.toBeInstanceOf(
      Folder9ApiError,
    );
  });

  it("maps network failures to Folder9NetworkError", async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new TypeError("ECONNREFUSED");
    }) as unknown as typeof globalThis.fetch;
    await expect(svc.getFolder("ws-1", "f-1")).rejects.toBeInstanceOf(
      Folder9NetworkError,
    );
  });

  it("throws a clear error when FOLDER9_API_URL is missing", async () => {
    delete process.env.FOLDER9_API_URL;
    await expect(svc.getFolder("ws-1", "f-1")).rejects.toThrow(
      /FOLDER9_API_URL/,
    );
  });

  // ... 一轮 commit (auto), commit (propose), tree, blob, listProposals,
  //     approveProposal, rejectProposal tests following the same pattern
});
```

Run `pnpm --filter @team9/server test -- folder9-client.service.spec` — expect FAIL (service does not exist yet).

- [ ] **Step 4: Implement the service**

Create `apps/server/apps/gateway/src/wikis/folder9-client.service.ts`:

```ts
import { Injectable } from "@nestjs/common";
import { env } from "@team9/shared";
import {
  Folder9ApiError,
  Folder9BlobResponse,
  Folder9CommitRequest,
  Folder9CommitResponse,
  Folder9Folder,
  Folder9NetworkError,
  Folder9Proposal,
  Folder9TreeEntry,
} from "./types/folder9.types.js";

const PSK_HEADER = "X-Folder9-PSK"; // replace with real value from step 1

interface CreateFolderInput {
  name: string;
  type: "managed" | "light";
  ownerType: "workspace" | "agent";
  ownerId: string;
  approvalMode: "auto" | "review";
}

@Injectable()
export class Folder9ClientService {
  private baseUrl(): string {
    const u = env.FOLDER9_API_URL;
    if (!u) throw new Error("FOLDER9_API_URL is not configured");
    return u.replace(/\/$/, "");
  }

  private psk(): string {
    const p = env.FOLDER9_PSK;
    if (!p) throw new Error("FOLDER9_PSK is not configured");
    return p;
  }

  private async request<T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl()}${path}`;
    const init: RequestInit = {
      method,
      headers: {
        [PSK_HEADER]: this.psk(),
        ...(body !== undefined && { "Content-Type": "application/json" }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    };

    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (cause) {
      throw new Folder9NetworkError(path, cause);
    }

    const text = await res.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!res.ok) {
      throw new Folder9ApiError(res.status, path, parsed);
    }

    return parsed as T;
  }

  createFolder(wsId: string, input: CreateFolderInput): Promise<Folder9Folder> {
    return this.request("POST", `/api/workspaces/${wsId}/folders`, input);
  }

  getFolder(wsId: string, folderId: string): Promise<Folder9Folder> {
    return this.request("GET", `/api/workspaces/${wsId}/folders/${folderId}`);
  }

  updateFolder(
    wsId: string,
    folderId: string,
    patch: Partial<Pick<Folder9Folder, "name" | "approvalMode">>,
  ): Promise<Folder9Folder> {
    return this.request(
      "PATCH",
      `/api/workspaces/${wsId}/folders/${folderId}`,
      patch,
    );
  }

  deleteFolder(wsId: string, folderId: string): Promise<void> {
    return this.request(
      "DELETE",
      `/api/workspaces/${wsId}/folders/${folderId}`,
    );
  }

  getTree(
    wsId: string,
    folderId: string,
    opts: { path?: string; recursive?: boolean; ref?: string } = {},
  ): Promise<Folder9TreeEntry[]> {
    const qs = new URLSearchParams();
    if (opts.path) qs.set("path", opts.path);
    if (opts.recursive) qs.set("recursive", "true");
    if (opts.ref) qs.set("ref", opts.ref);
    const suffix = qs.toString() ? `?${qs}` : "";
    return this.request(
      "GET",
      `/api/workspaces/${wsId}/folders/${folderId}/tree${suffix}`,
    );
  }

  getBlob(
    wsId: string,
    folderId: string,
    path: string,
    ref?: string,
  ): Promise<Folder9BlobResponse> {
    const qs = new URLSearchParams({ path });
    if (ref) qs.set("ref", ref);
    return this.request(
      "GET",
      `/api/workspaces/${wsId}/folders/${folderId}/blob?${qs}`,
    );
  }

  commit(
    wsId: string,
    folderId: string,
    input: Folder9CommitRequest,
  ): Promise<Folder9CommitResponse> {
    return this.request(
      "POST",
      `/api/workspaces/${wsId}/folders/${folderId}/commit`,
      input,
    );
  }

  listProposals(
    wsId: string,
    folderId: string,
    opts: { status?: string } = {},
  ): Promise<Folder9Proposal[]> {
    const qs = opts.status ? `?status=${encodeURIComponent(opts.status)}` : "";
    return this.request(
      "GET",
      `/api/workspaces/${wsId}/folders/${folderId}/proposals${qs}`,
    );
  }

  getProposal(
    wsId: string,
    folderId: string,
    pid: string,
  ): Promise<Folder9Proposal> {
    return this.request(
      "GET",
      `/api/workspaces/${wsId}/folders/${folderId}/proposals/${pid}`,
    );
  }

  approveProposal(
    wsId: string,
    folderId: string,
    pid: string,
    reviewerId: string,
  ): Promise<void> {
    return this.request(
      "POST",
      `/api/workspaces/${wsId}/folders/${folderId}/proposals/${pid}/approve`,
      {
        reviewerId,
      },
    );
  }

  rejectProposal(
    wsId: string,
    folderId: string,
    pid: string,
    reviewerId: string,
    reason?: string,
  ): Promise<void> {
    return this.request(
      "POST",
      `/api/workspaces/${wsId}/folders/${folderId}/proposals/${pid}/reject`,
      {
        reviewerId,
        reason,
      },
    );
  }
}
```

- [ ] **Step 5: Run tests until green**

```bash
pnpm --filter @team9/server test -- folder9-client.service.spec --coverage
```

Expected: all tests pass, 100% coverage on the new file. Add more assertions to the test file until every branch is exercised (missing env, commit with propose=true, commit with propose=false, etc.).

- [ ] **Step 6: Commit**

```bash
git add apps/server/apps/gateway/src/wikis/folder9-client.service.ts apps/server/apps/gateway/src/wikis/types apps/server/apps/gateway/src/wikis/__tests__/folder9-client.service.spec.ts
git commit -m "feat(wiki): add Folder9ClientService with 100% unit coverage"
```

---

## Task 3: Frontmatter util (gateway) + shared test fixtures

**Goal:** Parse and serialize YAML frontmatter the same way on both sides (gateway now, client in Task 14). Create the shared fixture files that both unit-test suites reuse.

**Files:**

- Create: `apps/server/apps/gateway/src/wikis/utils/frontmatter.ts`
- Create: `apps/server/apps/gateway/src/wikis/__tests__/frontmatter.spec.ts`
- Create: `apps/server/libs/shared/test-fixtures/wiki-frontmatter/basic.md`
- Create: `apps/server/libs/shared/test-fixtures/wiki-frontmatter/no-frontmatter.md`
- Create: `apps/server/libs/shared/test-fixtures/wiki-frontmatter/unknown-keys.md`
- Create: `apps/server/libs/shared/test-fixtures/wiki-frontmatter/empty-body.md`
- Create: `apps/server/libs/shared/test-fixtures/wiki-frontmatter/fixtures.json` (parsed expectations)

**Acceptance Criteria:**

- [ ] `parseFrontmatter(source)` returns `{ frontmatter: Record<string, unknown>, body: string }`
- [ ] `serializeFrontmatter({ frontmatter, body })` re-emits a round-trip-stable markdown file
- [ ] Round-trip preserves unknown keys
- [ ] No frontmatter → `frontmatter === {}`, body is the full input
- [ ] Malformed YAML → throws `FrontmatterParseError`
- [ ] Test uses all fixture files; fixture JSON documents the expected parse output
- [ ] 100% coverage on `frontmatter.ts`

**Verify:**

```bash
pnpm --filter @team9/server test -- frontmatter.spec --coverage
```

Expected: all tests pass, 100% coverage.

**Steps:**

- [ ] **Step 1: Write fixture files**

Create `apps/server/libs/shared/test-fixtures/wiki-frontmatter/basic.md`:

```markdown
---
icon: "📘"
cover: ".team9/covers/hero.jpg"
title: "Welcome"
---

# Welcome

Some content.
```

Create `apps/server/libs/shared/test-fixtures/wiki-frontmatter/no-frontmatter.md`:

```markdown
# Just a title

No frontmatter here.
```

Create `apps/server/libs/shared/test-fixtures/wiki-frontmatter/unknown-keys.md`:

```markdown
---
icon: "🔐"
customField:
  nested: value
anotherKey: 42
---

Body with unknown frontmatter keys.
```

Create `apps/server/libs/shared/test-fixtures/wiki-frontmatter/empty-body.md`:

```markdown
---
icon: "📝"
title: "Draft"
---
```

Create `apps/server/libs/shared/test-fixtures/wiki-frontmatter/fixtures.json`:

```json
{
  "basic.md": {
    "frontmatter": {
      "icon": "📘",
      "cover": ".team9/covers/hero.jpg",
      "title": "Welcome"
    },
    "body": "# Welcome\n\nSome content.\n"
  },
  "no-frontmatter.md": {
    "frontmatter": {},
    "body": "# Just a title\n\nNo frontmatter here.\n"
  },
  "unknown-keys.md": {
    "frontmatter": {
      "icon": "🔐",
      "customField": { "nested": "value" },
      "anotherKey": 42
    },
    "body": "Body with unknown frontmatter keys.\n"
  },
  "empty-body.md": {
    "frontmatter": { "icon": "📝", "title": "Draft" },
    "body": ""
  }
}
```

- [ ] **Step 2: Write the failing test**

Create `apps/server/apps/gateway/src/wikis/__tests__/frontmatter.spec.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseFrontmatter,
  serializeFrontmatter,
  FrontmatterParseError,
} from "../utils/frontmatter.js";

const FIXTURE_DIR = join(
  __dirname,
  "../../../../../libs/shared/test-fixtures/wiki-frontmatter",
);
const EXPECTED = JSON.parse(
  readFileSync(join(FIXTURE_DIR, "fixtures.json"), "utf8"),
) as Record<string, { frontmatter: Record<string, unknown>; body: string }>;

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), "utf8");
}

describe("frontmatter util", () => {
  for (const [file, expected] of Object.entries(EXPECTED)) {
    it(`parses ${file}`, () => {
      const result = parseFrontmatter(loadFixture(file));
      expect(result.frontmatter).toEqual(expected.frontmatter);
      expect(result.body).toBe(expected.body);
    });

    it(`round-trips ${file}`, () => {
      const parsed = parseFrontmatter(loadFixture(file));
      const serialized = serializeFrontmatter(parsed);
      const reparsed = parseFrontmatter(serialized);
      expect(reparsed.frontmatter).toEqual(parsed.frontmatter);
      expect(reparsed.body).toBe(parsed.body);
    });
  }

  it("throws on malformed YAML", () => {
    const bad = `---\nicon: "📘\n---\n\nbody`;
    expect(() => parseFrontmatter(bad)).toThrow(FrontmatterParseError);
  });

  it("preserves unknown frontmatter keys on serialize", () => {
    const parsed = {
      frontmatter: { custom: "value", nested: { foo: "bar" } },
      body: "hello",
    };
    const out = serializeFrontmatter(parsed);
    expect(out).toContain("custom: value");
    expect(out).toContain("nested:");
    expect(out).toContain("foo: bar");
  });
});
```

Run `pnpm --filter @team9/server test -- frontmatter.spec` — expect FAIL.

- [ ] **Step 3: Implement the util**

Create `apps/server/apps/gateway/src/wikis/utils/frontmatter.ts`:

```ts
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export class FrontmatterParseError extends Error {
  constructor(
    message: string,
    public readonly cause: unknown,
  ) {
    super(message);
    this.name = "FrontmatterParseError";
  }
}

export interface ParsedPage {
  frontmatter: Record<string, unknown>;
  body: string;
}

const FENCE = "---";
const FENCE_RE = /^---\r?\n/;

export function parseFrontmatter(source: string): ParsedPage {
  if (!FENCE_RE.test(source)) {
    return { frontmatter: {}, body: source };
  }

  const afterOpen = source.replace(FENCE_RE, "");
  const closeIdx = afterOpen.search(/\r?\n---\r?\n/);
  if (closeIdx === -1) {
    // Open fence with no matching close → treat as no frontmatter
    return { frontmatter: {}, body: source };
  }

  const yamlSource = afterOpen.slice(0, closeIdx);
  const afterCloseIdx = afterOpen.slice(closeIdx).search(/\r?\n/) + 1;
  const body = afterOpen.slice(closeIdx + afterCloseIdx).replace(/^\r?\n/, "");

  let fm: unknown;
  try {
    fm = parseYaml(yamlSource);
  } catch (cause) {
    throw new FrontmatterParseError("Invalid frontmatter YAML", cause);
  }

  if (fm == null) return { frontmatter: {}, body };
  if (typeof fm !== "object" || Array.isArray(fm)) {
    throw new FrontmatterParseError("Frontmatter must be an object", fm);
  }

  return { frontmatter: fm as Record<string, unknown>, body };
}

export function serializeFrontmatter(page: ParsedPage): string {
  const { frontmatter, body } = page;
  const hasFm = Object.keys(frontmatter).length > 0;
  if (!hasFm) return body;

  const yaml = stringifyYaml(frontmatter).trimEnd();
  return `${FENCE}\n${yaml}\n${FENCE}\n\n${body}`;
}
```

Dependencies: the `yaml` package is already used elsewhere — verify with `grep -r "from 'yaml'" apps/server/` before assuming. If not present, install it as a gateway dependency: `pnpm --filter @team9/server add yaml`.

- [ ] **Step 4: Run tests until green, achieve 100% coverage**

```bash
pnpm --filter @team9/server test -- frontmatter.spec --coverage
```

Expected: all tests pass, 100% coverage. If any branch is missed (e.g., the `array frontmatter` error path), add the corresponding test.

- [ ] **Step 5: Commit**

```bash
git add apps/server/apps/gateway/src/wikis/utils/frontmatter.ts apps/server/apps/gateway/src/wikis/__tests__/frontmatter.spec.ts apps/server/libs/shared/test-fixtures/wiki-frontmatter
git commit -m "feat(wiki): add frontmatter parser/serializer with shared fixtures"
```

---

## Task 4: Permission helpers + DTOs

**Goal:** Implement `resolveWikiPermission` and `requirePermission` (the guard functions that every WikisService method uses) and all the NestJS DTOs for request/response shapes.

**Files:**

- Create: `apps/server/apps/gateway/src/wikis/utils/permission.ts`
- Create: `apps/server/apps/gateway/src/wikis/__tests__/permission.spec.ts`
- Create: `apps/server/apps/gateway/src/wikis/dto/create-wiki.dto.ts`
- Create: `apps/server/apps/gateway/src/wikis/dto/update-wiki.dto.ts`
- Create: `apps/server/apps/gateway/src/wikis/dto/commit-page.dto.ts`
- Create: `apps/server/apps/gateway/src/wikis/dto/wiki.dto.ts`
- Create: `apps/server/apps/gateway/src/wikis/dto/tree-entry.dto.ts`
- Create: `apps/server/apps/gateway/src/wikis/dto/page.dto.ts`
- Create: `apps/server/apps/gateway/src/wikis/dto/proposal.dto.ts`

**Acceptance Criteria:**

- [ ] `resolveWikiPermission(wiki, { isAgent })` returns the correct per-role permission
- [ ] `requirePermission(wiki, user, required)` throws `ForbiddenException` when the user's perm is below required
- [ ] `requirePermission` ordering: `read < propose < write` (a user with `write` passes a `read` check)
- [ ] All DTOs have `class-validator` decorators where applicable
- [ ] 100% coverage on `permission.ts`

**Verify:**

```bash
pnpm --filter @team9/server test -- permission.spec --coverage
pnpm --filter @team9/server exec tsc --noEmit
```

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `apps/server/apps/gateway/src/wikis/__tests__/permission.spec.ts`:

```ts
import { ForbiddenException } from "@nestjs/common";
import {
  resolveWikiPermission,
  requirePermission,
} from "../utils/permission.js";

const baseWiki = {
  humanPermission: "write" as const,
  agentPermission: "read" as const,
};

describe("resolveWikiPermission", () => {
  it("returns humanPermission for a human user", () => {
    expect(resolveWikiPermission(baseWiki, { id: "u1", isAgent: false })).toBe(
      "write",
    );
  });
  it("returns agentPermission for an agent user", () => {
    expect(resolveWikiPermission(baseWiki, { id: "a1", isAgent: true })).toBe(
      "read",
    );
  });
});

describe("requirePermission", () => {
  it("passes when user has exactly the required perm", () => {
    expect(() =>
      requirePermission(
        { humanPermission: "propose", agentPermission: "read" },
        { id: "u", isAgent: false },
        "propose",
      ),
    ).not.toThrow();
  });

  it("passes when user has a higher perm", () => {
    expect(() =>
      requirePermission(
        { humanPermission: "write", agentPermission: "read" },
        { id: "u", isAgent: false },
        "read",
      ),
    ).not.toThrow();
  });

  it("throws Forbidden when user is below required perm", () => {
    expect(() =>
      requirePermission(
        { humanPermission: "read", agentPermission: "read" },
        { id: "u", isAgent: false },
        "write",
      ),
    ).toThrow(ForbiddenException);
  });

  it("throws for agent with lower perm than required", () => {
    expect(() =>
      requirePermission(
        { humanPermission: "write", agentPermission: "read" },
        { id: "a", isAgent: true },
        "propose",
      ),
    ).toThrow(ForbiddenException);
  });
});
```

Run — expect FAIL.

- [ ] **Step 2: Implement**

Create `apps/server/apps/gateway/src/wikis/utils/permission.ts`:

```ts
import { ForbiddenException } from "@nestjs/common";

export type WikiPermissionLevel = "read" | "propose" | "write";

const ORDER: Record<WikiPermissionLevel, number> = {
  read: 0,
  propose: 1,
  write: 2,
};

interface WikiPerms {
  humanPermission: WikiPermissionLevel;
  agentPermission: WikiPermissionLevel;
}

interface ActingUser {
  id: string;
  isAgent: boolean;
}

export function resolveWikiPermission(
  wiki: WikiPerms,
  user: ActingUser,
): WikiPermissionLevel {
  return user.isAgent ? wiki.agentPermission : wiki.humanPermission;
}

export function requirePermission(
  wiki: WikiPerms,
  user: ActingUser,
  required: WikiPermissionLevel,
): void {
  const actual = resolveWikiPermission(wiki, user);
  if (ORDER[actual] < ORDER[required]) {
    throw new ForbiddenException(
      `Wiki permission '${required}' required (you have '${actual}')`,
    );
  }
}
```

- [ ] **Step 3: Write all DTOs**

Create `apps/server/apps/gateway/src/wikis/dto/create-wiki.dto.ts`:

```ts
import { IsIn, IsOptional, IsString, Length, Matches } from "class-validator";

export class CreateWikiDto {
  @IsString()
  @Length(1, 200)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  @Matches(/^[a-z0-9][a-z0-9-]*$/)
  slug?: string;

  @IsOptional()
  @IsString()
  @Length(0, 8)
  icon?: string;

  @IsOptional()
  @IsIn(["auto", "review"])
  approvalMode?: "auto" | "review";

  @IsOptional()
  @IsIn(["read", "propose", "write"])
  humanPermission?: "read" | "propose" | "write";

  @IsOptional()
  @IsIn(["read", "propose", "write"])
  agentPermission?: "read" | "propose" | "write";
}
```

Create `apps/server/apps/gateway/src/wikis/dto/update-wiki.dto.ts`:

```ts
import { IsIn, IsOptional, IsString, Length, Matches } from "class-validator";

export class UpdateWikiDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  @Matches(/^[a-z0-9][a-z0-9-]*$/)
  slug?: string;

  @IsOptional()
  @IsIn(["auto", "review"])
  approvalMode?: "auto" | "review";

  @IsOptional()
  @IsIn(["read", "propose", "write"])
  humanPermission?: "read" | "propose" | "write";

  @IsOptional()
  @IsIn(["read", "propose", "write"])
  agentPermission?: "read" | "propose" | "write";
}
```

Create `apps/server/apps/gateway/src/wikis/dto/commit-page.dto.ts`:

```ts
import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  ValidateNested,
  MaxLength,
} from "class-validator";
import { Type } from "class-transformer";

export class CommitFileDto {
  @IsString()
  @MaxLength(500)
  path!: string;

  @IsString()
  content!: string;

  @IsOptional()
  @IsIn(["text", "base64"])
  encoding?: "text" | "base64";

  @IsIn(["create", "update", "delete"])
  action!: "create" | "update" | "delete";
}

export class CommitPageDto {
  @IsString()
  @MaxLength(500)
  message!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CommitFileDto)
  files!: CommitFileDto[];

  @IsOptional()
  propose?: boolean;
}
```

Create `apps/server/apps/gateway/src/wikis/dto/wiki.dto.ts`:

```ts
export interface WikiDto {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  approvalMode: "auto" | "review";
  humanPermission: "read" | "propose" | "write";
  agentPermission: "read" | "propose" | "write";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}
```

Create `apps/server/apps/gateway/src/wikis/dto/tree-entry.dto.ts`:

```ts
export interface TreeEntryDto {
  name: string;
  path: string;
  type: "file" | "dir";
  size: number;
}
```

Create `apps/server/apps/gateway/src/wikis/dto/page.dto.ts`:

```ts
export interface PageDto {
  path: string;
  content: string;
  frontmatter: Record<string, unknown>;
  lastCommit: {
    sha: string;
    author: string | null;
    timestamp: string | null;
  } | null;
}
```

Create `apps/server/apps/gateway/src/wikis/dto/proposal.dto.ts`:

```ts
export interface ProposalDto {
  id: string;
  wikiId: string;
  title: string;
  description: string;
  status: "pending" | "changes_requested" | "approved" | "rejected";
  authorId: string;
  authorType: "user" | "agent";
  createdAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
}
```

- [ ] **Step 4: Run tests + type-check**

```bash
pnpm --filter @team9/server test -- permission.spec --coverage
pnpm --filter @team9/server exec tsc --noEmit
```

Expected: all tests pass, 100% coverage, no TS errors.

- [ ] **Step 5: Commit**

```bash
git add apps/server/apps/gateway/src/wikis/utils apps/server/apps/gateway/src/wikis/dto apps/server/apps/gateway/src/wikis/__tests__/permission.spec.ts
git commit -m "feat(wiki): add permission helpers and request/response DTOs"
```

---

## Task 5: WikisService (CRUD)

**Goal:** Implement the service methods for Wiki lifecycle (list, create, get, update settings, archive). Content ops (tree/page/commit/proposals) come in Task 6.

**Files:**

- Create: `apps/server/apps/gateway/src/wikis/wikis.service.ts` (partial — CRUD only)
- Create: `apps/server/apps/gateway/src/wikis/__tests__/wikis.service.spec.ts` (partial)

**Acceptance Criteria:**

- [ ] `createWiki` inserts into `workspace_wikis` after successfully creating the folder9 folder
- [ ] On DB failure after folder9 create, the service calls `Folder9ClientService.deleteFolder()` as compensation
- [ ] `createWiki` rejects agent callers with `ForbiddenException('Agents cannot create Wikis')`
- [ ] `createWiki` derives slug from name when not provided; rejects duplicates with a readable error
- [ ] `listWikis` filters out `archivedAt != null` and workspace members only see their workspace's Wikis
- [ ] `updateWikiSettings` requires `write` permission on the Wiki
- [ ] `archiveWiki` sets `archivedAt = now`; does NOT delete the folder9 folder
- [ ] Slug auto-derivation: strip non `a-z0-9-`, collapse multiple dashes, trim dashes
- [ ] Unit tests mock `Folder9ClientService` and the Drizzle db chain (pattern from `workspace.service.spec.ts`)
- [ ] 100% coverage

**Verify:**

```bash
pnpm --filter @team9/server test -- wikis.service.spec --coverage
```

**Steps:**

- [ ] **Step 1: Write failing tests for happy paths + compensation**

Create `apps/server/apps/gateway/src/wikis/__tests__/wikis.service.spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { ForbiddenException, ConflictException } from "@nestjs/common";
import { WikisService } from "../wikis.service.js";
import { Folder9ClientService } from "../folder9-client.service.js";
import { DATABASE_CONNECTION } from "@team9/database";

function mockDb() {
  const chain: Record<string, jest.Mock> = {};
  const methods = [
    "select",
    "from",
    "where",
    "and",
    "eq",
    "insert",
    "values",
    "returning",
    "update",
    "set",
    "delete",
    "orderBy",
    "limit",
  ];
  for (const m of methods) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  return chain;
}

function mockFolder9(): jest.Mocked<Folder9ClientService> {
  return {
    createFolder: jest.fn(),
    getFolder: jest.fn(),
    updateFolder: jest.fn(),
    deleteFolder: jest.fn(),
    getTree: jest.fn(),
    getBlob: jest.fn(),
    commit: jest.fn(),
    listProposals: jest.fn(),
    getProposal: jest.fn(),
    approveProposal: jest.fn(),
    rejectProposal: jest.fn(),
  } as unknown as jest.Mocked<Folder9ClientService>;
}

describe("WikisService — createWiki", () => {
  let svc: WikisService;
  let db: ReturnType<typeof mockDb>;
  let f9: jest.Mocked<Folder9ClientService>;

  beforeEach(async () => {
    db = mockDb();
    f9 = mockFolder9();
    const module = await Test.createTestingModule({
      providers: [
        WikisService,
        { provide: DATABASE_CONNECTION, useValue: db },
        { provide: Folder9ClientService, useValue: f9 },
      ],
    }).compile();
    svc = module.get(WikisService);
  });

  it("creates a Wiki end-to-end", async () => {
    f9.createFolder.mockResolvedValue({
      id: "f9-1",
      name: "public",
      type: "managed",
      ownerType: "workspace",
      ownerId: "ws-1",
      workspaceId: "ws-1",
      approvalMode: "auto",
      createdAt: "2026-04-13T00:00:00Z",
      updatedAt: "2026-04-13T00:00:00Z",
    });
    (db.returning as jest.Mock).mockResolvedValueOnce([
      { id: "wiki-1", workspaceId: "ws-1", name: "public", slug: "public" },
    ]);
    // simulate "slug not taken" lookup
    (db.limit as jest.Mock).mockResolvedValueOnce([]);

    const result = await svc.createWiki(
      "ws-1",
      { id: "user-1", isAgent: false },
      { name: "public" },
    );

    expect(f9.createFolder).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        name: "public",
        type: "managed",
        ownerType: "workspace",
        ownerId: "ws-1",
        approvalMode: "auto",
      }),
    );
    expect(db.insert).toHaveBeenCalled();
    expect(result.id).toBe("wiki-1");
  });

  it("rejects agent callers with ForbiddenException", async () => {
    await expect(
      svc.createWiki("ws-1", { id: "a-1", isAgent: true }, { name: "x" }),
    ).rejects.toThrow(ForbiddenException);
    expect(f9.createFolder).not.toHaveBeenCalled();
  });

  it("compensates by deleting folder9 folder if DB insert fails", async () => {
    f9.createFolder.mockResolvedValue({ id: "f9-ghost" } as never);
    (db.limit as jest.Mock).mockResolvedValueOnce([]);
    (db.returning as jest.Mock).mockRejectedValueOnce(new Error("db down"));

    await expect(
      svc.createWiki("ws-1", { id: "u-1", isAgent: false }, { name: "x" }),
    ).rejects.toThrow(/db down/);
    expect(f9.deleteFolder).toHaveBeenCalledWith("ws-1", "f9-ghost");
  });

  it("throws ConflictException when slug already taken", async () => {
    (db.limit as jest.Mock).mockResolvedValueOnce([{ id: "existing" }]);
    await expect(
      svc.createWiki(
        "ws-1",
        { id: "u-1", isAgent: false },
        {
          name: "public",
          slug: "public",
        },
      ),
    ).rejects.toThrow(ConflictException);
  });

  it("derives slug from name", async () => {
    // Verify service.createWiki normalizes "Hello World!" → "hello-world"
    // then attempts insert with that slug
  });
});

// Similar describes for listWikis, getWiki, updateWikiSettings, archiveWiki
```

- [ ] **Step 2: Implement `WikisService` CRUD**

Create `apps/server/apps/gateway/src/wikis/wikis.service.ts`:

```ts
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq, isNull } from "drizzle-orm";
import { DATABASE_CONNECTION, schema, type Database } from "@team9/database";
import { Folder9ClientService } from "./folder9-client.service.js";
import { CreateWikiDto } from "./dto/create-wiki.dto.js";
import { UpdateWikiDto } from "./dto/update-wiki.dto.js";
import { WikiDto } from "./dto/wiki.dto.js";
import { requirePermission } from "./utils/permission.js";

export interface ActingUser {
  id: string;
  isAgent: boolean;
}

function deriveSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 100) || "wiki"
  );
}

function toDto(row: typeof schema.workspaceWikis.$inferSelect): WikiDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    slug: row.slug,
    approvalMode: row.approvalMode,
    humanPermission: row.humanPermission,
    agentPermission: row.agentPermission,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class WikisService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly folder9: Folder9ClientService,
  ) {}

  async listWikis(workspaceId: string): Promise<WikiDto[]> {
    const rows = await this.db
      .select()
      .from(schema.workspaceWikis)
      .where(
        and(
          eq(schema.workspaceWikis.workspaceId, workspaceId),
          isNull(schema.workspaceWikis.archivedAt),
        ),
      )
      .orderBy(desc(schema.workspaceWikis.createdAt));
    return rows.map(toDto);
  }

  async getWikiOrThrow(
    workspaceId: string,
    wikiId: string,
  ): Promise<typeof schema.workspaceWikis.$inferSelect> {
    const [row] = await this.db
      .select()
      .from(schema.workspaceWikis)
      .where(
        and(
          eq(schema.workspaceWikis.id, wikiId),
          eq(schema.workspaceWikis.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException(`Wiki ${wikiId} not found`);
    return row;
  }

  async createWiki(
    workspaceId: string,
    user: ActingUser,
    dto: CreateWikiDto,
  ): Promise<WikiDto> {
    if (user.isAgent) {
      throw new ForbiddenException("Agents cannot create Wikis");
    }

    const slug = dto.slug ?? deriveSlug(dto.name);
    const existing = await this.db
      .select()
      .from(schema.workspaceWikis)
      .where(
        and(
          eq(schema.workspaceWikis.workspaceId, workspaceId),
          eq(schema.workspaceWikis.slug, slug),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      throw new ConflictException(`Wiki slug '${slug}' already exists`);
    }

    const folder = await this.folder9.createFolder(workspaceId, {
      name: dto.name,
      type: "managed",
      ownerType: "workspace",
      ownerId: workspaceId,
      approvalMode: dto.approvalMode ?? "auto",
    });

    try {
      const [inserted] = await this.db
        .insert(schema.workspaceWikis)
        .values({
          workspaceId,
          folder9FolderId: folder.id,
          name: dto.name,
          slug,
          approvalMode: dto.approvalMode ?? "auto",
          humanPermission: dto.humanPermission ?? "write",
          agentPermission: dto.agentPermission ?? "read",
          createdBy: user.id,
        })
        .returning();
      return toDto(inserted);
    } catch (err) {
      // Compensation: roll back the orphan folder9 folder
      try {
        await this.folder9.deleteFolder(workspaceId, folder.id);
      } catch {
        // Log to ops — leave as a comment so the logger injection is clear
      }
      throw err;
    }
  }

  async updateWikiSettings(
    workspaceId: string,
    wikiId: string,
    user: ActingUser,
    dto: UpdateWikiDto,
  ): Promise<WikiDto> {
    const wiki = await this.getWikiOrThrow(workspaceId, wikiId);
    requirePermission(wiki, user, "write");

    if (dto.slug && dto.slug !== wiki.slug) {
      const [dup] = await this.db
        .select()
        .from(schema.workspaceWikis)
        .where(
          and(
            eq(schema.workspaceWikis.workspaceId, workspaceId),
            eq(schema.workspaceWikis.slug, dto.slug),
          ),
        )
        .limit(1);
      if (dup) throw new ConflictException(`Slug '${dto.slug}' already exists`);
    }

    const [updated] = await this.db
      .update(schema.workspaceWikis)
      .set({
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.slug !== undefined && { slug: dto.slug }),
        ...(dto.approvalMode !== undefined && {
          approvalMode: dto.approvalMode,
        }),
        ...(dto.humanPermission !== undefined && {
          humanPermission: dto.humanPermission,
        }),
        ...(dto.agentPermission !== undefined && {
          agentPermission: dto.agentPermission,
        }),
        updatedAt: new Date(),
      })
      .where(eq(schema.workspaceWikis.id, wikiId))
      .returning();

    // Mirror folder9 if name or approvalMode changed
    if (dto.name !== undefined || dto.approvalMode !== undefined) {
      await this.folder9.updateFolder(workspaceId, wiki.folder9FolderId, {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.approvalMode !== undefined && {
          approvalMode: dto.approvalMode,
        }),
      });
    }
    return toDto(updated);
  }

  async archiveWiki(
    workspaceId: string,
    wikiId: string,
    user: ActingUser,
  ): Promise<void> {
    const wiki = await this.getWikiOrThrow(workspaceId, wikiId);
    requirePermission(wiki, user, "write");
    await this.db
      .update(schema.workspaceWikis)
      .set({ archivedAt: new Date() })
      .where(eq(schema.workspaceWikis.id, wikiId));
  }

  async getWiki(
    workspaceId: string,
    wikiId: string,
    user: ActingUser,
  ): Promise<WikiDto> {
    const wiki = await this.getWikiOrThrow(workspaceId, wikiId);
    requirePermission(wiki, user, "read");
    return toDto(wiki);
  }
}
```

- [ ] **Step 3: Run tests until green, 100% coverage**

```bash
pnpm --filter @team9/server test -- wikis.service.spec --coverage
```

Fill in the missing test cases until 100% coverage — especially: `listWikis`, `archiveWiki`, `updateWikiSettings` permission denial, `updateWikiSettings` slug conflict, `getWiki` not-found, `deriveSlug` edge cases (via createWiki with weird name input).

- [ ] **Step 4: Commit**

```bash
git add apps/server/apps/gateway/src/wikis/wikis.service.ts apps/server/apps/gateway/src/wikis/__tests__/wikis.service.spec.ts
git commit -m "feat(wiki): add WikisService CRUD with folder9 compensation"
```

---

## Task 6: WikisService (tree / page / commit / proposals)

**Goal:** Extend `WikisService` with the content operations: `getTree`, `getPage`, `commitPage`, `listProposals`, `approveProposal`, `rejectProposal`. All enforce permissions before calling `Folder9ClientService`.

**Files:**

- Modify: `apps/server/apps/gateway/src/wikis/wikis.service.ts` (append methods)
- Modify: `apps/server/apps/gateway/src/wikis/__tests__/wikis.service.spec.ts` (add describes)

**Acceptance Criteria:**

- [ ] `getTree` requires `read`; returns folder9 tree entries unchanged (including dot-prefixed paths — filtering happens in client)
- [ ] `getPage` fetches blob via folder9, parses frontmatter, returns `PageDto` with split content + frontmatter
- [ ] `commitPage` computes effective `propose` flag per the spec §"Commit Handling: auto vs review"
- [ ] `commitPage` with `approvalMode=auto` + user has `write` → direct commit, no proposal
- [ ] `commitPage` with `approvalMode=review` OR user only has `propose` → force `propose=true`
- [ ] `commitPage` passes `authorName` / `authorEmail` to folder9 (fetched from existing `users` or `tenant_members` table by `user.id`)
- [ ] `approveProposal` / `rejectProposal` require `write` permission
- [ ] 100% coverage on the new methods

**Verify:**

```bash
pnpm --filter @team9/server test -- wikis.service.spec --coverage
```

**Steps:**

- [ ] **Step 1: Write failing tests**

Append to `wikis.service.spec.ts`:

```ts
describe("WikisService — commitPage", () => {
  // fixtures for wikis in auto and review modes
  const autoWiki = {
    id: "w1",
    workspaceId: "ws-1",
    folder9FolderId: "f9-1",
    approvalMode: "auto" as const,
    humanPermission: "write" as const,
    agentPermission: "read" as const,
  };

  const reviewWiki = { ...autoWiki, id: "w2", approvalMode: "review" as const };

  // ... tests:
  // - auto + write → folder9.commit({ propose: false })
  // - auto + propose user → folder9.commit({ propose: true })
  // - review + write → folder9.commit({ propose: true }) (no bypass)
  // - review + propose user → folder9.commit({ propose: true })
  // - read user → ForbiddenException
  // - commit passes authorName/authorEmail from user profile lookup
});

describe("WikisService — getTree", () => {
  // - read user can list
  // - non-member → not-found (precedes permission check)
});

describe("WikisService — getPage", () => {
  // - returns { content, frontmatter, lastCommit }
  // - malformed frontmatter does NOT throw; returns frontmatter: {}
});

describe("WikisService — approveProposal / rejectProposal", () => {
  // - write user can approve
  // - propose user → Forbidden
  // - folder9 conflict error → re-thrown as ConflictException
});
```

- [ ] **Step 2: Extend the service**

Append to `wikis.service.ts`:

```ts
import { parseFrontmatter } from './utils/frontmatter.js';
import { TreeEntryDto } from './dto/tree-entry.dto.js';
import { PageDto } from './dto/page.dto.js';
import { CommitPageDto } from './dto/commit-page.dto.js';
import { ProposalDto } from './dto/proposal.dto.js';
import {
  Folder9ApiError,
  Folder9Proposal,
} from './types/folder9.types.js';
import { resolveWikiPermission } from './utils/permission.js';

// Inside WikisService:

async getTree(
  workspaceId: string,
  wikiId: string,
  user: ActingUser,
  opts: { path?: string; recursive?: boolean } = {},
): Promise<TreeEntryDto[]> {
  const wiki = await this.getWikiOrThrow(workspaceId, wikiId);
  requirePermission(wiki, user, 'read');
  const entries = await this.folder9.getTree(workspaceId, wiki.folder9FolderId, {
    path: opts.path ?? '/',
    recursive: opts.recursive ?? false,
  });
  return entries.map(e => ({ name: e.name, path: e.path, type: e.type, size: e.size }));
}

async getPage(
  workspaceId: string,
  wikiId: string,
  user: ActingUser,
  path: string,
): Promise<PageDto> {
  const wiki = await this.getWikiOrThrow(workspaceId, wikiId);
  requirePermission(wiki, user, 'read');
  const blob = await this.folder9.getBlob(workspaceId, wiki.folder9FolderId, path);
  let frontmatter: Record<string, unknown> = {};
  let body = blob.content;
  try {
    const parsed = parseFrontmatter(blob.content);
    frontmatter = parsed.frontmatter;
    body = parsed.body;
  } catch {
    // malformed frontmatter → keep full content as body, empty fm
  }
  return {
    path,
    content: body,
    frontmatter,
    lastCommit: null, // TODO: fetch via folder9 /log when that method is added
  };
}

async commitPage(
  workspaceId: string,
  wikiId: string,
  user: ActingUser,
  dto: CommitPageDto,
): Promise<{ commit: { sha: string }; proposal: { id: string; status: string } | null }> {
  const wiki = await this.getWikiOrThrow(workspaceId, wikiId);
  const actualPerm = resolveWikiPermission(wiki, user);

  // propose users always need at least propose; write users need write only in auto mode
  const minRequired =
    wiki.approvalMode === 'auto' && !dto.propose ? 'write' : 'propose';
  requirePermission(wiki, user, minRequired);

  const effectivePropose =
    dto.propose === true ||
    wiki.approvalMode === 'review' ||
    actualPerm === 'propose';

  // Fetch user display name for git author attribution
  const profile = await this.loadUserProfile(user);

  try {
    const result = await this.folder9.commit(
      workspaceId,
      wiki.folder9FolderId,
      {
        message: dto.message,
        files: dto.files,
        propose: effectivePropose,
        authorName: profile.displayName,
        authorEmail: profile.email,
      },
    );
    return {
      commit: result.commit,
      proposal: result.proposal
        ? { id: result.proposal.id, status: result.proposal.status }
        : null,
    };
  } catch (err) {
    if (err instanceof Folder9ApiError && err.status === 409) {
      throw new ConflictException(`Commit conflicts with current page`);
    }
    throw err;
  }
}

async listProposals(
  workspaceId: string,
  wikiId: string,
  user: ActingUser,
  opts: { status?: string } = {},
): Promise<ProposalDto[]> {
  const wiki = await this.getWikiOrThrow(workspaceId, wikiId);
  requirePermission(wiki, user, 'read');
  const proposals = await this.folder9.listProposals(
    workspaceId,
    wiki.folder9FolderId,
    opts,
  );
  return proposals.map((p: Folder9Proposal) => ({
    id: p.id,
    wikiId,
    title: p.title,
    description: p.description,
    status: p.status,
    authorId: p.authorId,
    authorType: p.authorType === 'user' ? 'user' : 'agent',
    createdAt: p.createdAt,
    reviewedBy: p.reviewedBy,
    reviewedAt: p.reviewedAt,
  }));
}

async approveProposal(
  workspaceId: string,
  wikiId: string,
  user: ActingUser,
  proposalId: string,
): Promise<void> {
  const wiki = await this.getWikiOrThrow(workspaceId, wikiId);
  requirePermission(wiki, user, 'write');
  try {
    await this.folder9.approveProposal(
      workspaceId,
      wiki.folder9FolderId,
      proposalId,
      user.id,
    );
  } catch (err) {
    if (err instanceof Folder9ApiError && err.status === 409) {
      throw new ConflictException('Proposal already resolved or conflicts with main');
    }
    throw err;
  }
}

async rejectProposal(
  workspaceId: string,
  wikiId: string,
  user: ActingUser,
  proposalId: string,
  reason?: string,
): Promise<void> {
  const wiki = await this.getWikiOrThrow(workspaceId, wikiId);
  requirePermission(wiki, user, 'write');
  await this.folder9.rejectProposal(
    workspaceId,
    wiki.folder9FolderId,
    proposalId,
    user.id,
    reason,
  );
}

private async loadUserProfile(
  user: ActingUser,
): Promise<{ displayName: string; email: string }> {
  // Look up the user's display name and email from the users table (humans)
  // or from the agent profile table (agents). Returns safe defaults if missing.
  const [row] = await this.db
    .select({
      displayName: schema.users.displayName,
      email: schema.users.email,
    })
    .from(schema.users)
    .where(eq(schema.users.id, user.id))
    .limit(1);
  return {
    displayName: row?.displayName ?? user.id,
    email: row?.email ?? `${user.id}@team9.internal`,
  };
}
```

> **Note:** If the `users` schema column names differ (e.g., `name` instead of `displayName`), adjust here. Check [apps/server/libs/database/src/schemas/im/users.ts](../../apps/server/libs/database/src/schemas/im/users.ts) during implementation.

- [ ] **Step 3: Run tests until green, 100% coverage**

```bash
pnpm --filter @team9/server test -- wikis.service.spec --coverage
```

Add any missing branch tests until every path is exercised.

- [ ] **Step 4: Commit**

```bash
git add apps/server/apps/gateway/src/wikis/wikis.service.ts apps/server/apps/gateway/src/wikis/__tests__/wikis.service.spec.ts
git commit -m "feat(wiki): add tree/page/commit/proposal ops to WikisService"
```

---

## Task 7: WikisController

**Goal:** Expose all `WikisService` methods as REST endpoints under `/api/wikis/*`. Every endpoint authenticates via the existing `AuthGuard`, extracts the acting user via `@CurrentUser()`, and resolves the `workspaceId` from the user's current workspace context (the existing `WorkspaceGuard` / `@CurrentWorkspaceId()` decorator — follow the pattern from `workspace.controller.ts`).

**Files:**

- Create: `apps/server/apps/gateway/src/wikis/wikis.controller.ts`
- Create: `apps/server/apps/gateway/src/wikis/__tests__/wikis.controller.spec.ts`

**Acceptance Criteria:**

- [ ] All endpoints from [spec §API Contract](../specs/2026-04-13-wiki-folder9-integration-design.md#api-contract-gateway--client) are implemented
- [ ] Controller applies `@UseGuards(AuthGuard, WorkspaceGuard)`
- [ ] Controller is a thin pass-through — no business logic
- [ ] Determines `user.isAgent` from the JWT (existing mechanism — follow the same helper used by other controllers)
- [ ] Controller tests mock `WikisService` and assert each method was called with correct args
- [ ] 100% coverage

**Verify:**

```bash
pnpm --filter @team9/server test -- wikis.controller.spec --coverage
```

**Steps:**

- [ ] **Step 1: Confirm the `user.isAgent` detection helper**

Grep for `isAgent` / `isBot` / `userType` in `apps/server/apps/gateway/src/` to find how other controllers distinguish humans from bots. Use the same mechanism (likely a field on the JWT payload or a lookup against `users.type`).

- [ ] **Step 2: Write failing controller test**

Create `apps/server/apps/gateway/src/wikis/__tests__/wikis.controller.spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { WikisController } from "../wikis.controller.js";
import { WikisService } from "../wikis.service.js";

describe("WikisController", () => {
  let ctrl: WikisController;
  let svc: jest.Mocked<WikisService>;

  beforeEach(async () => {
    svc = {
      listWikis: jest.fn().mockResolvedValue([]),
      createWiki: jest.fn().mockResolvedValue({ id: "w1" }),
      getWiki: jest.fn().mockResolvedValue({ id: "w1" }),
      updateWikiSettings: jest.fn().mockResolvedValue({ id: "w1" }),
      archiveWiki: jest.fn().mockResolvedValue(undefined),
      getTree: jest.fn().mockResolvedValue([]),
      getPage: jest.fn().mockResolvedValue({
        path: "a.md",
        content: "",
        frontmatter: {},
        lastCommit: null,
      }),
      commitPage: jest.fn().mockResolvedValue({
        commit: { sha: "abc" },
        proposal: null,
      }),
      listProposals: jest.fn().mockResolvedValue([]),
      approveProposal: jest.fn().mockResolvedValue(undefined),
      rejectProposal: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<WikisService>;
    const module = await Test.createTestingModule({
      controllers: [WikisController],
      providers: [{ provide: WikisService, useValue: svc }],
    }).compile();
    ctrl = module.get(WikisController);
  });

  it("list forwards workspace + user", async () => {
    await ctrl.list("ws-1");
    expect(svc.listWikis).toHaveBeenCalledWith("ws-1");
  });

  it("create forwards DTO + user identity", async () => {
    const user = { id: "u1", isAgent: false };
    await ctrl.create("ws-1", user, { name: "public" });
    expect(svc.createWiki).toHaveBeenCalledWith("ws-1", user, {
      name: "public",
    });
  });

  // ... similar tests for each endpoint
});
```

- [ ] **Step 3: Implement the controller**

Create `apps/server/apps/gateway/src/wikis/wikis.controller.ts`:

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/guards/auth.guard.js"; // adjust to real path
import { WorkspaceGuard } from "../workspace/workspace.guard.js"; // adjust
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { CurrentWorkspaceId } from "../workspace/decorators/current-workspace-id.decorator.js";
import { WikisService, ActingUser } from "./wikis.service.js";
import { CreateWikiDto } from "./dto/create-wiki.dto.js";
import { UpdateWikiDto } from "./dto/update-wiki.dto.js";
import { CommitPageDto } from "./dto/commit-page.dto.js";

@Controller("api/wikis")
@UseGuards(AuthGuard, WorkspaceGuard)
export class WikisController {
  constructor(private readonly service: WikisService) {}

  @Get()
  list(@CurrentWorkspaceId() workspaceId: string) {
    return this.service.listWikis(workspaceId);
  }

  @Post()
  create(
    @CurrentWorkspaceId() workspaceId: string,
    @CurrentUser() user: ActingUser,
    @Body() dto: CreateWikiDto,
  ) {
    return this.service.createWiki(workspaceId, user, dto);
  }

  @Get(":wikiId")
  get(
    @CurrentWorkspaceId() workspaceId: string,
    @CurrentUser() user: ActingUser,
    @Param("wikiId") wikiId: string,
  ) {
    return this.service.getWiki(workspaceId, wikiId, user);
  }

  @Patch(":wikiId")
  update(
    @CurrentWorkspaceId() workspaceId: string,
    @CurrentUser() user: ActingUser,
    @Param("wikiId") wikiId: string,
    @Body() dto: UpdateWikiDto,
  ) {
    return this.service.updateWikiSettings(workspaceId, wikiId, user, dto);
  }

  @Delete(":wikiId")
  @HttpCode(HttpStatus.NO_CONTENT)
  archive(
    @CurrentWorkspaceId() workspaceId: string,
    @CurrentUser() user: ActingUser,
    @Param("wikiId") wikiId: string,
  ) {
    return this.service.archiveWiki(workspaceId, wikiId, user);
  }

  @Get(":wikiId/tree")
  getTree(
    @CurrentWorkspaceId() workspaceId: string,
    @CurrentUser() user: ActingUser,
    @Param("wikiId") wikiId: string,
    @Query("path") path?: string,
    @Query("recursive") recursive?: string,
  ) {
    return this.service.getTree(workspaceId, wikiId, user, {
      path,
      recursive: recursive === "true",
    });
  }

  @Get(":wikiId/pages")
  getPage(
    @CurrentWorkspaceId() workspaceId: string,
    @CurrentUser() user: ActingUser,
    @Param("wikiId") wikiId: string,
    @Query("path") path: string,
  ) {
    return this.service.getPage(workspaceId, wikiId, user, path);
  }

  @Post(":wikiId/commit")
  commit(
    @CurrentWorkspaceId() workspaceId: string,
    @CurrentUser() user: ActingUser,
    @Param("wikiId") wikiId: string,
    @Body() dto: CommitPageDto,
  ) {
    return this.service.commitPage(workspaceId, wikiId, user, dto);
  }

  @Get(":wikiId/proposals")
  listProposals(
    @CurrentWorkspaceId() workspaceId: string,
    @CurrentUser() user: ActingUser,
    @Param("wikiId") wikiId: string,
    @Query("status") status?: string,
  ) {
    return this.service.listProposals(workspaceId, wikiId, user, { status });
  }

  @Post(":wikiId/proposals/:proposalId/approve")
  @HttpCode(HttpStatus.NO_CONTENT)
  approve(
    @CurrentWorkspaceId() workspaceId: string,
    @CurrentUser() user: ActingUser,
    @Param("wikiId") wikiId: string,
    @Param("proposalId") proposalId: string,
  ) {
    return this.service.approveProposal(workspaceId, wikiId, user, proposalId);
  }

  @Post(":wikiId/proposals/:proposalId/reject")
  @HttpCode(HttpStatus.NO_CONTENT)
  reject(
    @CurrentWorkspaceId() workspaceId: string,
    @CurrentUser() user: ActingUser,
    @Param("wikiId") wikiId: string,
    @Param("proposalId") proposalId: string,
    @Body() body: { reason?: string } = {},
  ) {
    return this.service.rejectProposal(
      workspaceId,
      wikiId,
      user,
      proposalId,
      body.reason,
    );
  }
}
```

> **Note:** Import paths for `AuthGuard`, `WorkspaceGuard`, `CurrentUser`, `CurrentWorkspaceId` must match the actual names in your codebase. Grep to confirm before writing.

- [ ] **Step 4: Run tests, achieve 100% coverage**

```bash
pnpm --filter @team9/server test -- wikis.controller.spec --coverage
```

- [ ] **Step 5: Commit**

```bash
git add apps/server/apps/gateway/src/wikis/wikis.controller.ts apps/server/apps/gateway/src/wikis/__tests__/wikis.controller.spec.ts
git commit -m "feat(wiki): add WikisController REST endpoints"
```

---

## Task 8: Webhook controller + WebSocket broadcast

**Goal:** Receive folder9 webhook events, verify the HMAC signature, and re-broadcast the relevant ones on the existing Team9 WebSocket gateway scoped to the workspace.

**Files:**

- Create: `apps/server/apps/gateway/src/wikis/folder9-webhook.controller.ts`
- Create: `apps/server/apps/gateway/src/wikis/__tests__/folder9-webhook.controller.spec.ts`

**Acceptance Criteria:**

- [ ] `POST /api/folder9/webhook` verifies the `X-Folder9-Signature` header using HMAC-SHA256 with `FOLDER9_WEBHOOK_SECRET`
- [ ] Invalid / missing signature → 401 (no business logic runs)
- [ ] For `proposal.created`, `proposal.approved`, `proposal.rejected`, `ref.updated` → look up the Wiki by `folder_id`, emit WS event to the workspace room via existing `WebsocketGateway`
- [ ] Unknown event types → 200 OK, no-op with a log
- [ ] If `folder_id` has no matching Wiki (e.g., already archived) → 200 OK, log warning
- [ ] 100% coverage

**Verify:**

```bash
pnpm --filter @team9/server test -- folder9-webhook.controller.spec --coverage
```

**Steps:**

- [ ] **Step 1: Identify WebSocket broadcast API**

Confirm from [apps/server/apps/gateway/src/im/websocket/websocket.gateway.ts](../../apps/server/apps/gateway/src/im/websocket/websocket.gateway.ts) that there is a `broadcastToWorkspace(workspaceId, event, data)` method. If not, add it in this step using the same `this.server.to(`workspace:${workspaceId}`).emit(event, data)` pattern.

- [ ] **Step 2: Write the failing test**

Create `apps/server/apps/gateway/src/wikis/__tests__/folder9-webhook.controller.spec.ts`:

```ts
import { createHmac } from "node:crypto";
import { Test } from "@nestjs/testing";
import { Folder9WebhookController } from "../folder9-webhook.controller.js";
import { WEBSOCKET_GATEWAY } from "../../im/websocket/tokens.js";
import { DATABASE_CONNECTION } from "@team9/database";

function sign(body: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

describe("Folder9WebhookController", () => {
  let ctrl: Folder9WebhookController;
  let ws: { broadcastToWorkspace: jest.Mock };
  let db: ReturnType<typeof mockDb>;

  beforeEach(async () => {
    process.env.FOLDER9_WEBHOOK_SECRET = "whsec";
    ws = { broadcastToWorkspace: jest.fn() };
    db = mockDb();
    (db.limit as jest.Mock).mockResolvedValue([
      { id: "w-1", workspaceId: "ws-1", folder9FolderId: "f9-1" },
    ]);
    const module = await Test.createTestingModule({
      controllers: [Folder9WebhookController],
      providers: [
        { provide: WEBSOCKET_GATEWAY, useValue: ws },
        { provide: DATABASE_CONNECTION, useValue: db },
      ],
    }).compile();
    ctrl = module.get(Folder9WebhookController);
  });

  it("rejects missing signature", async () => {
    await expect(ctrl.receive({}, undefined as never)).rejects.toMatchObject({
      status: 401,
    });
  });

  it("rejects invalid signature", async () => {
    const body = { event: "proposal.approved", folderId: "f9-1" };
    await expect(ctrl.receive(body, "sha256=wrong")).rejects.toMatchObject({
      status: 401,
    });
  });

  it("broadcasts proposal.approved to workspace", async () => {
    const body = {
      event: "proposal.approved",
      folderId: "f9-1",
      proposalId: "p1",
    };
    const sig = sign(JSON.stringify(body), "whsec");
    await ctrl.receive(body, sig);
    expect(ws.broadcastToWorkspace).toHaveBeenCalledWith(
      "ws-1",
      "wiki_proposal_approved",
      expect.objectContaining({ wikiId: "w-1", proposalId: "p1" }),
    );
  });

  it("ignores unknown folder9 folder_id with log + 200", async () => {
    (db.limit as jest.Mock).mockResolvedValueOnce([]);
    const body = { event: "ref.updated", folderId: "f9-ghost" };
    const sig = sign(JSON.stringify(body), "whsec");
    await expect(ctrl.receive(body, sig)).resolves.toBeUndefined();
    expect(ws.broadcastToWorkspace).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Implement the controller**

Create `apps/server/apps/gateway/src/wikis/folder9-webhook.controller.ts`:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  Post,
} from "@nestjs/common";
import { eq } from "drizzle-orm";
import { env } from "@team9/shared";
import { DATABASE_CONNECTION, schema, type Database } from "@team9/database";
import { WEBSOCKET_GATEWAY } from "../im/websocket/tokens.js"; // confirm path

interface BroadcastingGateway {
  broadcastToWorkspace(
    workspaceId: string,
    event: string,
    data: unknown,
  ): Promise<void>;
}

interface Folder9WebhookPayload {
  event: string;
  folderId: string;
  workspaceId?: string;
  proposalId?: string;
  [k: string]: unknown;
}

@Controller("api/folder9")
export class Folder9WebhookController {
  private readonly logger = new Logger(Folder9WebhookController.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    @Inject(WEBSOCKET_GATEWAY) private readonly ws: BroadcastingGateway,
  ) {}

  @Post("webhook")
  @HttpCode(HttpStatus.OK)
  async receive(
    @Body() body: Folder9WebhookPayload,
    @Headers("x-folder9-signature") signature: string | undefined,
  ): Promise<void> {
    const secret = env.FOLDER9_WEBHOOK_SECRET;
    if (!secret) throw new HttpException("webhook secret not set", 500);
    if (!signature) throw new HttpException("missing signature", 401);

    const expected =
      "sha256=" +
      createHmac("sha256", secret).update(JSON.stringify(body)).digest("hex");
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new HttpException("invalid signature", 401);
    }

    const [wiki] = await this.db
      .select()
      .from(schema.workspaceWikis)
      .where(eq(schema.workspaceWikis.folder9FolderId, body.folderId))
      .limit(1);
    if (!wiki) {
      this.logger.warn(`webhook for unknown folder9 folder ${body.folderId}`);
      return;
    }

    switch (body.event) {
      case "proposal.created":
        await this.ws.broadcastToWorkspace(
          wiki.workspaceId,
          "wiki_proposal_created",
          {
            wikiId: wiki.id,
            proposalId: body.proposalId,
          },
        );
        return;
      case "proposal.approved":
        await this.ws.broadcastToWorkspace(
          wiki.workspaceId,
          "wiki_proposal_approved",
          {
            wikiId: wiki.id,
            proposalId: body.proposalId,
          },
        );
        return;
      case "proposal.rejected":
        await this.ws.broadcastToWorkspace(
          wiki.workspaceId,
          "wiki_proposal_rejected",
          {
            wikiId: wiki.id,
            proposalId: body.proposalId,
          },
        );
        return;
      case "ref.updated":
        await this.ws.broadcastToWorkspace(
          wiki.workspaceId,
          "wiki_page_updated",
          {
            wikiId: wiki.id,
            ref: body["ref"],
            sha: body["sha"],
          },
        );
        return;
      default:
        this.logger.debug(`ignored folder9 event ${body.event}`);
    }
  }
}
```

- [ ] **Step 4: Run tests, 100% coverage**

```bash
pnpm --filter @team9/server test -- folder9-webhook.controller.spec --coverage
```

- [ ] **Step 5: Commit**

```bash
git add apps/server/apps/gateway/src/wikis/folder9-webhook.controller.ts apps/server/apps/gateway/src/wikis/__tests__/folder9-webhook.controller.spec.ts
git commit -m "feat(wiki): add folder9 webhook receiver with HMAC verification"
```

---

## Task 9: WikisModule wiring into AppModule

**Goal:** Register the new module and verify the gateway boots with no runtime errors.

**Files:**

- Create: `apps/server/apps/gateway/src/wikis/wikis.module.ts`
- Modify: `apps/server/apps/gateway/src/app.module.ts`

**Acceptance Criteria:**

- [ ] `WikisModule` imports `DatabaseModule`, `WebsocketModule` (via `forwardRef`)
- [ ] Providers: `WikisService`, `Folder9ClientService`
- [ ] Controllers: `WikisController`, `Folder9WebhookController`
- [ ] `WikisService` exported so `WorkspaceService` can inject it in Task 10
- [ ] Gateway boots: `pnpm dev:server` starts with no errors

**Steps:**

- [ ] **Step 1: Create the module**

Create `apps/server/apps/gateway/src/wikis/wikis.module.ts`:

```ts
import { forwardRef, Module } from "@nestjs/common";
import { DatabaseModule } from "@team9/database";
import { WebsocketModule } from "../im/websocket/websocket.module.js";
import { WikisController } from "./wikis.controller.js";
import { WikisService } from "./wikis.service.js";
import { Folder9ClientService } from "./folder9-client.service.js";
import { Folder9WebhookController } from "./folder9-webhook.controller.js";

@Module({
  imports: [DatabaseModule, forwardRef(() => WebsocketModule)],
  controllers: [WikisController, Folder9WebhookController],
  providers: [WikisService, Folder9ClientService],
  exports: [WikisService],
})
export class WikisModule {}
```

- [ ] **Step 2: Register in AppModule**

Edit `apps/server/apps/gateway/src/app.module.ts` — add `WikisModule` to the `imports` array.

- [ ] **Step 3: Smoke test**

```bash
pnpm dev:server
```

Expected: gateway boots. Hit `GET /api/wikis` with a valid JWT → empty array.

- [ ] **Step 4: Commit**

```bash
git add apps/server/apps/gateway/src/wikis/wikis.module.ts apps/server/apps/gateway/src/app.module.ts
git commit -m "feat(wiki): register WikisModule in gateway"
```

---

## Task 10: Workspace creation seed hook + backfill script

**Goal:** Auto-create a `public` Wiki when a new workspace is created, and provide a script to backfill existing workspaces.

**Files:**

- Modify: `apps/server/apps/gateway/src/workspace/workspace.service.ts`
- Modify: `apps/server/apps/gateway/src/workspace/workspace.module.ts` (import WikisModule)
- Modify: `apps/server/apps/gateway/src/workspace/workspace.service.spec.ts` (mock WikisService)
- Create: `apps/server/apps/gateway/src/wikis/scripts/backfill-public-wiki.ts`
- Create: `apps/server/apps/gateway/src/wikis/scripts/__tests__/backfill-public-wiki.spec.ts`

**Acceptance Criteria:**

- [ ] `WorkspaceService.create` calls `wikisService.createWiki(ws.id, { id: ownerId, isAgent: false }, { name: 'public', slug: 'public' })` after the workspace row + owner membership are committed
- [ ] If the Wiki creation fails, workspace creation still succeeds (errors logged only)
- [ ] Backfill script iterates every workspace, skips those with an existing `public` Wiki, creates one using the workspace's owner as `createdBy`
- [ ] Backfill is idempotent (running twice is safe)
- [ ] Backfill is runnable: `pnpm --filter @team9/server exec tsx apps/server/apps/gateway/src/wikis/scripts/backfill-public-wiki.ts`
- [ ] Existing `workspace.service.spec.ts` updated to mock the new dependency and assert the seed is called

**Steps:**

- [ ] **Step 1: Modify WorkspaceModule**

Add `WikisModule` to `imports` in `workspace.module.ts` (use `forwardRef` if circular deps appear).

- [ ] **Step 2: Modify `WorkspaceService.create`**

Inject `WikisService` in the constructor; after the owner membership step (line ~985 in `workspace.service.ts`), add:

```ts
// Seed default public wiki — don't fail workspace creation if this fails
try {
  await this.wikisService.createWiki(
    workspace.id,
    { id: data.ownerId, isAgent: false },
    { name: "public", slug: "public" },
  );
} catch (err) {
  this.logger.warn(
    `failed to seed default public wiki for workspace ${workspace.id}: ${err instanceof Error ? err.message : String(err)}`,
  );
}
```

- [ ] **Step 3: Update workspace.service.spec.ts**

Add a `WikisService` mock to the test module. Assert `wikisService.createWiki` is called once with the expected args after a successful workspace create. Add a test that the workspace is still created when `wikisService.createWiki` rejects.

- [ ] **Step 4: Write the backfill script**

Create `apps/server/apps/gateway/src/wikis/scripts/backfill-public-wiki.ts`:

```ts
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../app.module.js";
import { WikisService } from "../wikis.service.js";
import { DATABASE_CONNECTION, schema, type Database } from "@team9/database";
import { and, eq } from "drizzle-orm";

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const wikisService = app.get(WikisService);
  const db = app.get<Database>(DATABASE_CONNECTION);

  const workspaces = await db.select().from(schema.tenants);
  let created = 0;
  let skipped = 0;

  for (const ws of workspaces) {
    const [existing] = await db
      .select()
      .from(schema.workspaceWikis)
      .where(
        and(
          eq(schema.workspaceWikis.workspaceId, ws.id),
          eq(schema.workspaceWikis.slug, "public"),
        ),
      )
      .limit(1);
    if (existing) {
      skipped++;
      continue;
    }

    // Use the workspace owner as createdBy. Adjust lookup if your membership
    // model stores owner differently.
    const [owner] = await db
      .select()
      .from(schema.tenantMembers)
      .where(
        and(
          eq(schema.tenantMembers.tenantId, ws.id),
          eq(schema.tenantMembers.role, "owner"),
        ),
      )
      .limit(1);
    if (!owner) {
      console.warn(`workspace ${ws.id} has no owner, skipping`);
      skipped++;
      continue;
    }

    try {
      await wikisService.createWiki(
        ws.id,
        { id: owner.userId, isAgent: false },
        { name: "public", slug: "public" },
      );
      created++;
      console.log(`seeded public wiki for ${ws.id}`);
    } catch (err) {
      console.error(`failed to seed public wiki for ${ws.id}:`, err);
    }
  }

  console.log(`backfill complete: created=${created}, skipped=${skipped}`);
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 5: Test the backfill script**

Write `backfill-public-wiki.spec.ts` that mocks the NestJS context + service + db and asserts idempotency (running twice only creates once).

- [ ] **Step 6: Commit**

```bash
git add apps/server/apps/gateway/src/workspace apps/server/apps/gateway/src/wikis/scripts
git commit -m "feat(wiki): seed public wiki on workspace creation + backfill script"
```

---

## Task 11: Integration test against real folder9

**Goal:** Run a thin end-to-end test that spins up a real folder9 instance via docker-compose and exercises the critical flows through the gateway.

**Files:**

- Create: `apps/server/apps/gateway/src/wikis/__tests__/integration/wiki-folder9.integration.spec.ts`
- Create: `apps/server/apps/gateway/src/wikis/__tests__/integration/docker-compose.yml`

**Acceptance Criteria:**

- [ ] Docker-compose starts a folder9 container with a bound postgres
- [ ] Test boots the NestJS module with real env vars pointing at the container
- [ ] Flows tested:
  - [ ] Create Wiki → folder9 folder exists
  - [ ] Commit page (auto mode) → `getPage` returns the content
  - [ ] Commit page (review mode) → proposal created; listProposals returns it
  - [ ] Approve proposal → next getPage reflects new content
- [ ] Test is tagged so it only runs with `pnpm test:integration` (skip on normal `pnpm test`)

**Steps:**

- [ ] **Step 1: Write the docker-compose**

```yaml
version: "3.8"
services:
  folder9-postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: folder9
      POSTGRES_USER: folder9
      POSTGRES_PASSWORD: folder9
    ports: ["55432:5432"]
  folder9:
    image: team9ai/folder9:latest # build locally if not in registry
    environment:
      DATABASE_URL: postgres://folder9:folder9@folder9-postgres:5432/folder9
      PSK: test-psk
      WEBHOOK_SECRET: test-secret
      FOLDER9_API_URL: http://folder9:8080
      FOLDER9_GIT_URL: http://folder9:8080
      DATA_ROOT: /data
    ports: ["58080:8080"]
    depends_on: [folder9-postgres]
    volumes: [folder9-data:/data]
volumes:
  folder9-data:
```

- [ ] **Step 2: Write the integration test**

Create a Jest spec that uses `startFolder9()` / `stopFolder9()` helpers (can shell out to `docker compose up -d` and poll for readiness), boots a NestJS test module with env vars pointing at `http://localhost:58080`, then runs the four scenarios above.

Tag the describe block: `describe.skipIf(!process.env.INTEGRATION)('WikisModule integration', ...)` or use a jest config to isolate.

- [ ] **Step 3: Run**

```bash
INTEGRATION=1 pnpm --filter @team9/server test -- wiki-folder9.integration
```

Expected: all four flows pass end-to-end.

- [ ] **Step 4: Commit**

```bash
git add apps/server/apps/gateway/src/wikis/__tests__/integration
git commit -m "test(wiki): add end-to-end integration test against real folder9"
```

---

## Task 12: i18n + MainSidebar rename + delete old Library

**Goal:** Rename the `library` nav entry to `wiki` across MainSidebar, unlock list, all locale files, and the DynamicSubSidebar switch. Delete the old LibraryMainContent component and its route.

**Files:**

- Modify: `apps/client/src/components/layout/MainSidebar.tsx`
- Modify: `apps/client/src/components/layout/mainSidebarUnlock.ts`
- Modify: `apps/client/src/components/layout/DynamicSubSidebar.tsx`
- Modify: `apps/client/src/components/layout/__tests__/mainSidebarUnlock.test.ts`
- Modify: `apps/client/src/components/layout/__tests__/MainSidebar.user-menu.test.tsx`
- Modify: `apps/client/src/i18n/locales/{en,ja,zh-CN,zh-TW,ko,fr,es,de,it,pt,ru,nl}/navigation.json` (12 files)
- Delete: `apps/client/src/components/layout/contents/LibraryMainContent.tsx`
- Delete: `apps/client/src/routes/_authenticated/library/index.tsx`
- Delete: `apps/client/src/components/layout/contents/__tests__/LibraryMainContent*.test.tsx` (if present)
- Create (stubs for now): `apps/client/src/components/layout/sidebars/WikiSubSidebar.tsx`, `apps/client/src/components/layout/contents/WikiMainContent.tsx`

**Acceptance Criteria:**

- [ ] `MainSidebar.tsx` shows the new `wiki` entry with the existing `Library` icon
- [ ] Tapping "More" 5 times still unlocks the wiki entry (same hidden-nav flow)
- [ ] `DynamicSubSidebar` routes `wiki` section to `<WikiSubSidebar />` placeholder
- [ ] All 12 locale files have `"wiki": "<translated>"` (re-use the existing `library` translation verbatim for now; no new strings)
- [ ] `pnpm --filter @team9/client test` passes (updated tests + route deletion tests)
- [ ] `pnpm --filter @team9/client build` completes with no errors

**Verify:**

```bash
pnpm --filter @team9/client test
pnpm --filter @team9/client build
```

**Steps:**

- [ ] **Step 1: Rename in MainSidebar**

Edit `apps/client/src/components/layout/MainSidebar.tsx` line 76:

```diff
- { id: "library", labelKey: "library" as const, icon: Library },
+ { id: "wiki", labelKey: "wiki" as const, icon: Library },
```

- [ ] **Step 2: Rename in unlock list**

Edit `apps/client/src/components/layout/mainSidebarUnlock.ts`:

```diff
 export const HIDDEN_NAV_SECTION_IDS = [
   "skills",
   "resources",
-  "library",
+  "wiki",
 ] as const satisfies readonly SidebarSection[];
```

- [ ] **Step 3: Create placeholder WikiSubSidebar and WikiMainContent**

Create `apps/client/src/components/layout/sidebars/WikiSubSidebar.tsx` — minimal shell (real impl in Task 16):

```tsx
import { Library } from "lucide-react";
import { useTranslation } from "react-i18next";

export function WikiSubSidebar() {
  const { t } = useTranslation("navigation");
  return (
    <div className="flex flex-col h-full bg-background">
      <header className="h-14 flex items-center gap-2 px-4 border-b border-border">
        <Library size={18} className="text-primary" />
        <h2 className="font-semibold text-sm">{t("wiki")}</h2>
      </header>
      <div className="p-4 text-sm text-muted-foreground">
        Wiki tree coming soon…
      </div>
    </div>
  );
}
```

Create `apps/client/src/components/layout/contents/WikiMainContent.tsx` — minimal shell:

```tsx
export function WikiMainContent() {
  return (
    <main className="h-full flex items-center justify-center bg-background">
      <p className="text-muted-foreground">Select a Wiki page</p>
    </main>
  );
}
```

- [ ] **Step 4: Wire DynamicSubSidebar**

Edit `apps/client/src/components/layout/DynamicSubSidebar.tsx`:

```diff
   if (pathname.startsWith("/messages")) return "messages";
   if (pathname.startsWith("/activity")) return "activity";
+  if (pathname.startsWith("/wiki")) return "wiki";
   if (pathname.startsWith("/files")) return "files";
   ...
   switch (sidebarType) {
     case "home": return <HomeSubSidebar />;
     case "messages": return <MessagesSubSidebar />;
+    case "wiki": return <WikiSubSidebar />;
     ...
```

The `SidebarSection` type (likely in `@/stores`) also needs a new `"wiki"` literal. Grep for its definition and update.

- [ ] **Step 5: Update i18n locales**

For each of the 12 locale files under `apps/client/src/i18n/locales/*/navigation.json`, replace:

```diff
-  "library": "Library",
+  "wiki": "Library",
```

(Keep the translated string; we're only renaming the key. User-visible text stays the same — see [spec §Route and Navigation Entry](../specs/2026-04-13-wiki-folder9-integration-design.md#route-and-navigation-entry).)

Use a single loop: `for f in apps/client/src/i18n/locales/*/navigation.json; do node -e '...'; done` — OR do each file manually with Edit.

- [ ] **Step 6: Delete old Library files**

```bash
rm apps/client/src/components/layout/contents/LibraryMainContent.tsx
rm apps/client/src/routes/_authenticated/library/index.tsx
# Plus any tests referencing LibraryMainContent
```

- [ ] **Step 7: Update existing tests**

- [mainSidebarUnlock.test.ts](apps/client/src/components/layout/__tests__/mainSidebarUnlock.test.ts) line 19 + line 63: update `library` → `wiki`.
- [MainSidebar.user-menu.test.tsx](apps/client/src/components/layout/__tests__/MainSidebar.user-menu.test.tsx) line 23: update `library: "Library"` → `wiki: "Library"`.
- Any test that imports `LibraryMainContent` → delete those tests.

- [ ] **Step 8: Type-check + test + build**

```bash
pnpm --filter @team9/client test
pnpm --filter @team9/client build
```

- [ ] **Step 9: Commit**

```bash
git add apps/client/src/components/layout apps/client/src/i18n/locales apps/client/src/routes/_authenticated/library apps/client/src/routes/_authenticated/wiki
git commit -m "feat(wiki): rename library nav to wiki, wire placeholder section"
```

---

## Task 13: Types + API client + React Query hooks + Zustand store

**Goal:** Add the frontend-facing types, the typed `apiClient.wikis.*` methods, the React Query hooks for reading and mutating, and a small Zustand store for UI state (selected wiki, selected page, tree-expansion state).

**Files:**

- Create: `apps/client/src/types/wiki.ts`
- Create: `apps/client/src/services/api/wikis.ts`
- Modify: `apps/client/src/services/api/index.ts` (export wikis client)
- Create: `apps/client/src/hooks/useWikis.ts`
- Create: `apps/client/src/hooks/useWikiTree.ts`
- Create: `apps/client/src/hooks/useWikiPage.ts`
- Create: `apps/client/src/hooks/useWikiProposals.ts`
- Create: `apps/client/src/stores/wiki.ts`
- Create tests alongside each hook/store

**Acceptance Criteria:**

- [ ] `WikiDto`, `TreeEntryDto`, `PageDto`, `ProposalDto` types match the backend shapes exactly
- [ ] `apiClient.wikis.list / create / update / archive / getTree / getPage / commit / listProposals / approve / reject` methods work against the gateway
- [ ] Query keys structured as `['wikis']`, `['wikis', wikiId]`, `['wikis', wikiId, 'tree', path]`, `['wikis', wikiId, 'page', path]`, `['wikis', wikiId, 'proposals']`
- [ ] Mutations invalidate the correct keys on success
- [ ] Zustand store holds: `selectedWikiId`, `selectedPagePath`, `expandedDirectories: Set<string>`
- [ ] Store selectors follow the `useSelectedWikiId()` / `wikiActions.setSelectedWikiId()` pattern from existing `home.ts`
- [ ] All hooks + store have Vitest tests (following `HomeMainContent.test.tsx` mock pattern)

**Verify:**

```bash
pnpm --filter @team9/client test -- wiki
```

**Steps:**

- [ ] **Step 1: Write types**

Create `apps/client/src/types/wiki.ts`:

```ts
export type WikiApprovalMode = "auto" | "review";
export type WikiPermissionLevel = "read" | "propose" | "write";

export interface WikiDto {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  approvalMode: WikiApprovalMode;
  humanPermission: WikiPermissionLevel;
  agentPermission: WikiPermissionLevel;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface TreeEntryDto {
  name: string;
  path: string;
  type: "file" | "dir";
  size: number;
}

export interface PageDto {
  path: string;
  content: string;
  frontmatter: Record<string, unknown>;
  lastCommit: {
    sha: string;
    author: string | null;
    timestamp: string | null;
  } | null;
}

export interface ProposalDto {
  id: string;
  wikiId: string;
  title: string;
  description: string;
  status: "pending" | "changes_requested" | "approved" | "rejected";
  authorId: string;
  authorType: "user" | "agent";
  createdAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
}

export interface CommitFileInput {
  path: string;
  content: string;
  encoding?: "text" | "base64";
  action: "create" | "update" | "delete";
}

export interface CommitPageInput {
  message: string;
  files: CommitFileInput[];
  propose?: boolean;
}
```

- [ ] **Step 2: Write API client**

Create `apps/client/src/services/api/wikis.ts`:

```ts
import { httpClient } from "../http";
import type {
  WikiDto,
  TreeEntryDto,
  PageDto,
  ProposalDto,
  CommitPageInput,
} from "@/types/wiki";

export interface CreateWikiInput {
  name: string;
  slug?: string;
  icon?: string;
  approvalMode?: "auto" | "review";
  humanPermission?: "read" | "propose" | "write";
  agentPermission?: "read" | "propose" | "write";
}

export interface UpdateWikiInput {
  name?: string;
  slug?: string;
  approvalMode?: "auto" | "review";
  humanPermission?: "read" | "propose" | "write";
  agentPermission?: "read" | "propose" | "write";
}

export const wikisApi = {
  list: () => httpClient.get<WikiDto[]>("/api/wikis"),
  create: (dto: CreateWikiInput) => httpClient.post<WikiDto>("/api/wikis", dto),
  get: (wikiId: string) => httpClient.get<WikiDto>(`/api/wikis/${wikiId}`),
  update: (wikiId: string, dto: UpdateWikiInput) =>
    httpClient.patch<WikiDto>(`/api/wikis/${wikiId}`, dto),
  archive: (wikiId: string) => httpClient.delete<void>(`/api/wikis/${wikiId}`),
  getTree: (
    wikiId: string,
    opts: { path?: string; recursive?: boolean } = {},
  ) => {
    const params = new URLSearchParams();
    if (opts.path) params.set("path", opts.path);
    if (opts.recursive) params.set("recursive", "true");
    const qs = params.toString() ? `?${params}` : "";
    return httpClient.get<TreeEntryDto[]>(`/api/wikis/${wikiId}/tree${qs}`);
  },
  getPage: (wikiId: string, path: string) =>
    httpClient.get<PageDto>(
      `/api/wikis/${wikiId}/pages?path=${encodeURIComponent(path)}`,
    ),
  commit: (wikiId: string, dto: CommitPageInput) =>
    httpClient.post<{
      commit: { sha: string };
      proposal: { id: string; status: string } | null;
    }>(`/api/wikis/${wikiId}/commit`, dto),
  listProposals: (wikiId: string, status?: string) => {
    const qs = status ? `?status=${encodeURIComponent(status)}` : "";
    return httpClient.get<ProposalDto[]>(`/api/wikis/${wikiId}/proposals${qs}`);
  },
  approveProposal: (wikiId: string, proposalId: string) =>
    httpClient.post<void>(
      `/api/wikis/${wikiId}/proposals/${proposalId}/approve`,
    ),
  rejectProposal: (wikiId: string, proposalId: string, reason?: string) =>
    httpClient.post<void>(
      `/api/wikis/${wikiId}/proposals/${proposalId}/reject`,
      { reason },
    ),
};
```

Re-export from `apps/client/src/services/api/index.ts`:

```ts
export { wikisApi } from "./wikis";
```

- [ ] **Step 3: Write React Query hooks**

Create `apps/client/src/hooks/useWikis.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  wikisApi,
  type CreateWikiInput,
  type UpdateWikiInput,
} from "@/services/api/wikis";

export const wikiKeys = {
  all: ["wikis"] as const,
  detail: (id: string) => ["wikis", id] as const,
  tree: (id: string, path: string) => ["wikis", id, "tree", path] as const,
  page: (id: string, path: string) => ["wikis", id, "page", path] as const,
  proposals: (id: string) => ["wikis", id, "proposals"] as const,
};

export function useWikis() {
  return useQuery({ queryKey: wikiKeys.all, queryFn: () => wikisApi.list() });
}

export function useCreateWiki() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateWikiInput) => wikisApi.create(dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: wikiKeys.all }),
  });
}

export function useUpdateWiki(wikiId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateWikiInput) => wikisApi.update(wikiId, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: wikiKeys.all });
      qc.invalidateQueries({ queryKey: wikiKeys.detail(wikiId) });
    },
  });
}

export function useArchiveWiki() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (wikiId: string) => wikisApi.archive(wikiId),
    onSuccess: () => qc.invalidateQueries({ queryKey: wikiKeys.all }),
  });
}
```

Create `apps/client/src/hooks/useWikiTree.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { wikisApi } from "@/services/api/wikis";
import { wikiKeys } from "./useWikis";

export function useWikiTree(wikiId: string | null, path: string = "/") {
  return useQuery({
    queryKey: wikiId
      ? wikiKeys.tree(wikiId, path)
      : ["wikis", "tree", "disabled"],
    queryFn: () => wikisApi.getTree(wikiId!, { path, recursive: true }),
    enabled: !!wikiId,
  });
}
```

Create `apps/client/src/hooks/useWikiPage.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { wikisApi } from "@/services/api/wikis";
import type { CommitPageInput } from "@/types/wiki";
import { wikiKeys } from "./useWikis";

export function useWikiPage(wikiId: string | null, path: string | null) {
  return useQuery({
    queryKey:
      wikiId && path
        ? wikiKeys.page(wikiId, path)
        : ["wikis", "page", "disabled"],
    queryFn: () => wikisApi.getPage(wikiId!, path!),
    enabled: !!wikiId && !!path,
  });
}

export function useCommitWikiPage(wikiId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CommitPageInput) => wikisApi.commit(wikiId, dto),
    onSuccess: (_res, variables) => {
      qc.invalidateQueries({ queryKey: wikiKeys.tree(wikiId, "/") });
      for (const f of variables.files) {
        qc.invalidateQueries({ queryKey: wikiKeys.page(wikiId, f.path) });
      }
    },
  });
}
```

Create `apps/client/src/hooks/useWikiProposals.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { wikisApi } from "@/services/api/wikis";
import { wikiKeys } from "./useWikis";

export function useWikiProposals(
  wikiId: string | null,
  status: string = "pending",
) {
  return useQuery({
    queryKey: wikiId
      ? [...wikiKeys.proposals(wikiId), status]
      : ["wikis", "proposals", "disabled"],
    queryFn: () => wikisApi.listProposals(wikiId!, status),
    enabled: !!wikiId,
  });
}

export function useApproveProposal(wikiId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (proposalId: string) =>
      wikisApi.approveProposal(wikiId, proposalId),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: wikiKeys.proposals(wikiId) }),
  });
}

export function useRejectProposal(wikiId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { proposalId: string; reason?: string }) =>
      wikisApi.rejectProposal(wikiId, input.proposalId, input.reason),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: wikiKeys.proposals(wikiId) }),
  });
}
```

- [ ] **Step 4: Write Zustand store**

Create `apps/client/src/stores/wiki.ts`:

```ts
import { create } from "zustand";
import { devtools } from "zustand/middleware";

interface WikiState {
  selectedWikiId: string | null;
  selectedPagePath: string | null;
  expandedDirectories: Set<string>;

  setSelectedWiki: (wikiId: string | null) => void;
  setSelectedPage: (path: string | null) => void;
  toggleDirectory: (key: string) => void;
  reset: () => void;
}

export const useWikiStore = create<WikiState>()(
  devtools(
    (set) => ({
      selectedWikiId: null,
      selectedPagePath: null,
      expandedDirectories: new Set(),
      setSelectedWiki: (selectedWikiId) =>
        set(
          { selectedWikiId, selectedPagePath: null },
          false,
          "setSelectedWiki",
        ),
      setSelectedPage: (selectedPagePath) =>
        set({ selectedPagePath }, false, "setSelectedPage"),
      toggleDirectory: (key) =>
        set(
          (s) => {
            const next = new Set(s.expandedDirectories);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return { expandedDirectories: next };
          },
          false,
          "toggleDirectory",
        ),
      reset: () =>
        set(
          {
            selectedWikiId: null,
            selectedPagePath: null,
            expandedDirectories: new Set(),
          },
          false,
          "reset",
        ),
    }),
    { name: "WikiStore" },
  ),
);

export const useSelectedWikiId = () => useWikiStore((s) => s.selectedWikiId);
export const useSelectedPagePath = () =>
  useWikiStore((s) => s.selectedPagePath);
export const useExpandedDirectories = () =>
  useWikiStore((s) => s.expandedDirectories);

export const wikiActions = {
  setSelectedWiki: (id: string | null) =>
    useWikiStore.getState().setSelectedWiki(id),
  setSelectedPage: (path: string | null) =>
    useWikiStore.getState().setSelectedPage(path),
  toggleDirectory: (key: string) =>
    useWikiStore.getState().toggleDirectory(key),
  reset: () => useWikiStore.getState().reset(),
};
```

- [ ] **Step 5: Write tests for each file**

Follow patterns from existing tests (e.g., `useDocuments.test.tsx`, `home.test.ts`). Test:

- Each query hook: mocks `wikisApi`, asserts `queryKey` and `queryFn` wire up correctly
- Each mutation hook: fires mutation, verifies invalidation
- Store: all actions, all selectors, toggle de-dup

- [ ] **Step 6: Commit**

```bash
git add apps/client/src/types/wiki.ts apps/client/src/services/api/wikis.ts apps/client/src/services/api/index.ts apps/client/src/hooks/useWikis.ts apps/client/src/hooks/useWikiTree.ts apps/client/src/hooks/useWikiPage.ts apps/client/src/hooks/useWikiProposals.ts apps/client/src/stores/wiki.ts apps/client/src/hooks/__tests__ apps/client/src/stores/__tests__
git commit -m "feat(wiki): add types, API client, React Query hooks, and Zustand store"
```

---

## Task 14: Frontmatter util (client) + shared fixtures

**Goal:** Implement the browser-side frontmatter parser/serializer that mirrors the gateway's, and run the same fixture-based round-trip tests against both.

**Files:**

- Create: `apps/client/src/lib/wiki-frontmatter.ts`
- Create: `apps/client/src/lib/__tests__/wiki-frontmatter.test.ts`

**Acceptance Criteria:**

- [ ] `parseFrontmatter(source)` returns `{ frontmatter, body }` matching the gateway implementation bit-for-bit
- [ ] `serializeFrontmatter({ frontmatter, body })` is a pure inverse
- [ ] Unit tests import the same `test-fixtures/wiki-frontmatter/fixtures.json` used by the gateway tests (via relative path)
- [ ] Vitest tests pass
- [ ] Uses the `yaml` package (already in `package.json` — confirm via `grep '"yaml"' apps/client/package.json`; if absent, `pnpm --filter @team9/client add yaml`)

**Steps:**

- [ ] **Step 1: Implement**

Create `apps/client/src/lib/wiki-frontmatter.ts` — copy the same logic from the gateway's `frontmatter.ts` verbatim (it's ESM-compatible; only the `yaml` import differs from Node's). Rename `FrontmatterParseError` to the same class.

- [ ] **Step 2: Write the test**

Create `apps/client/src/lib/__tests__/wiki-frontmatter.test.ts` — mirror the gateway spec with Vitest (import from `vitest`, use `describe/it/expect`). Load fixtures via `?raw` Vite import:

```ts
import { describe, it, expect } from "vitest";
import { parseFrontmatter, serializeFrontmatter } from "../wiki-frontmatter";

import basicMd from "../../../../server/libs/shared/test-fixtures/wiki-frontmatter/basic.md?raw";
import noneMd from "../../../../server/libs/shared/test-fixtures/wiki-frontmatter/no-frontmatter.md?raw";
import unknownMd from "../../../../server/libs/shared/test-fixtures/wiki-frontmatter/unknown-keys.md?raw";
import emptyMd from "../../../../server/libs/shared/test-fixtures/wiki-frontmatter/empty-body.md?raw";
import expected from "../../../../server/libs/shared/test-fixtures/wiki-frontmatter/fixtures.json";

const cases = [
  ["basic.md", basicMd],
  ["no-frontmatter.md", noneMd],
  ["unknown-keys.md", unknownMd],
  ["empty-body.md", emptyMd],
] as const;

describe("wiki-frontmatter", () => {
  for (const [name, source] of cases) {
    it(`parses ${name}`, () => {
      const result = parseFrontmatter(source);
      expect(result.frontmatter).toEqual(expected[name].frontmatter);
      expect(result.body).toBe(expected[name].body);
    });
    it(`round-trips ${name}`, () => {
      const p1 = parseFrontmatter(source);
      const p2 = parseFrontmatter(serializeFrontmatter(p1));
      expect(p2).toEqual(p1);
    });
  }

  it("throws on malformed YAML", () => {
    expect(() => parseFrontmatter('---\nicon: "\n---\n')).toThrow();
  });
});
```

If the `?raw` import isn't enabled for `.md` files, add `md` to the Vite `assetsInclude` config or use `fs.readFileSync` via `vite-node`.

- [ ] **Step 3: Run tests**

```bash
pnpm --filter @team9/client test -- wiki-frontmatter
```

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/lib/wiki-frontmatter.ts apps/client/src/lib/__tests__/wiki-frontmatter.test.ts
git commit -m "feat(wiki): add client-side frontmatter util with shared fixtures"
```

---

## Task 15: Wiki routes + WikiMainContent shell

**Goal:** Create the three TanStack Router files that back the Wiki section and replace the placeholder `WikiMainContent.tsx` with one that wires the selected-page state to the page view (page view stub — real impl in Task 17).

**Files:**

- Create: `apps/client/src/routes/_authenticated/wiki/index.tsx`
- Create: `apps/client/src/routes/_authenticated/wiki/$wikiSlug.tsx`
- Create: `apps/client/src/routes/_authenticated/wiki/$wikiSlug.$.tsx`
- Modify: `apps/client/src/components/layout/contents/WikiMainContent.tsx`
- Create: `apps/client/src/components/wiki/WikiEmptyState.tsx`

**Acceptance Criteria:**

- [ ] Navigating to `/wiki` shows the empty state (no wiki selected)
- [ ] Navigating to `/wiki/public` selects the `public` wiki and shows its `index.md` if one exists (or empty state)
- [ ] Navigating to `/wiki/public/api/auth.md` selects the page at `api/auth.md`
- [ ] Route params update the Zustand store via `useEffect`, and `WikiMainContent` reads from the store
- [ ] The tree-expanded state in the store also updates when a deep path is opened, so the sidebar auto-expands the needed directories

**Steps:**

- [ ] **Step 1: Create the three route files**

`apps/client/src/routes/_authenticated/wiki/index.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { WikiMainContent } from "@/components/layout/contents/WikiMainContent";

export const Route = createFileRoute("/_authenticated/wiki/")({
  component: () => <WikiMainContent />,
});
```

`apps/client/src/routes/_authenticated/wiki/$wikiSlug.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { WikiMainContent } from "@/components/layout/contents/WikiMainContent";
import { wikiActions } from "@/stores/wiki";
import { useWikis } from "@/hooks/useWikis";

export const Route = createFileRoute("/_authenticated/wiki/$wikiSlug")({
  component: WikiSlugPage,
});

function WikiSlugPage() {
  const { wikiSlug } = Route.useParams();
  const { data: wikis } = useWikis();

  useEffect(() => {
    const wiki = wikis?.find((w) => w.slug === wikiSlug);
    if (wiki) {
      wikiActions.setSelectedWiki(wiki.id);
      wikiActions.setSelectedPage("index.md");
    }
  }, [wikis, wikiSlug]);

  return <WikiMainContent />;
}
```

`apps/client/src/routes/_authenticated/wiki/$wikiSlug.$.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { WikiMainContent } from "@/components/layout/contents/WikiMainContent";
import { wikiActions } from "@/stores/wiki";
import { useWikis } from "@/hooks/useWikis";

export const Route = createFileRoute("/_authenticated/wiki/$wikiSlug/$")({
  component: WikiCatchallPage,
});

function WikiCatchallPage() {
  const { wikiSlug, _splat: pagePath } = Route.useParams() as {
    wikiSlug: string;
    _splat: string;
  };
  const { data: wikis } = useWikis();

  useEffect(() => {
    const wiki = wikis?.find((w) => w.slug === wikiSlug);
    if (wiki) {
      wikiActions.setSelectedWiki(wiki.id);
      wikiActions.setSelectedPage(pagePath);

      // Auto-expand parent directories
      const parts = pagePath.split("/");
      parts.pop();
      let acc = "";
      for (const p of parts) {
        acc = acc ? `${acc}/${p}` : p;
        wikiActions.toggleDirectory(acc);
      }
    }
  }, [wikis, wikiSlug, pagePath]);

  return <WikiMainContent />;
}
```

> **Note:** `toggleDirectory` should only _add_ if not present. If a user manually collapses a directory we don't want an auto-expand to re-collapse it. Consider adding a dedicated `expandDirectory(key)` action that idempotently adds.

- [ ] **Step 2: Build WikiEmptyState**

```tsx
import { Library } from "lucide-react";

export function WikiEmptyState() {
  return (
    <main className="h-full flex flex-col items-center justify-center text-center gap-3 bg-background">
      <Library size={48} className="text-primary/40" />
      <h2 className="font-semibold text-lg">Select a Wiki page</h2>
      <p className="text-sm text-muted-foreground max-w-sm">
        Pick a page from the tree on the left, or create a new Wiki with the +
        button.
      </p>
    </main>
  );
}
```

- [ ] **Step 3: Update WikiMainContent**

`apps/client/src/components/layout/contents/WikiMainContent.tsx`:

```tsx
import { useSelectedWikiId, useSelectedPagePath } from "@/stores/wiki";
import { WikiEmptyState } from "@/components/wiki/WikiEmptyState";
import { WikiPageView } from "@/components/wiki/WikiPageView"; // placeholder — built in Task 17

export function WikiMainContent() {
  const wikiId = useSelectedWikiId();
  const pagePath = useSelectedPagePath();

  if (!wikiId || !pagePath) return <WikiEmptyState />;

  return <WikiPageView wikiId={wikiId} path={pagePath} />;
}
```

Stub `WikiPageView` for now (returns `<div>loading...</div>`) so the build passes until Task 17.

- [ ] **Step 4: Regenerate route tree + build**

```bash
pnpm --filter @team9/client build
```

TanStack Router auto-generates `routeTree.gen.ts` — commit this file with the new routes.

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/routes/_authenticated/wiki apps/client/src/components/layout/contents/WikiMainContent.tsx apps/client/src/components/wiki/WikiEmptyState.tsx apps/client/src/routeTree.gen.ts
git commit -m "feat(wiki): add wiki routes and content area scaffolding"
```

---

## Task 16: WikiSubSidebar (list + tree)

**Goal:** Replace the placeholder `WikiSubSidebar` with the real one: header + list of wikis + recursive file tree derived from the flat folder9 response.

**Files:**

- Modify: `apps/client/src/components/layout/sidebars/WikiSubSidebar.tsx`
- Create: `apps/client/src/components/wiki/WikiListItem.tsx`
- Create: `apps/client/src/components/wiki/WikiTreeNode.tsx`
- Create: `apps/client/src/lib/wiki-tree.ts` (pure util to build a tree from flat paths)
- Create tests for each

**Acceptance Criteria:**

- [ ] Header shows "Wiki" + a `+` button (opens CreateWikiDialog — stub for now)
- [ ] Lists all non-archived wikis; each row is a `<WikiListItem>` with chevron, icon, name
- [ ] Clicking a wiki row expands/collapses it and fetches its tree lazily via `useWikiTree`
- [ ] Tree entries whose path starts with `.` (e.g., `.team9/`) are filtered out before rendering
- [ ] The flat folder9 response is converted to a nested tree by splitting each file path on `/`
- [ ] Directory nodes are synthetic — built from path segments, sorted (dirs first, then files alphabetically)
- [ ] Clicking a file → `navigate(/wiki/:slug/:filePath)` + update store
- [ ] Clicking a directory → expand/collapse; if the dir has an `index.md` child, navigate to that; else navigate to the dir-as-folder empty state
- [ ] Active page is highlighted (compare against `useSelectedPagePath`)
- [ ] Vitest tests cover: flat → nested transform, filtering, empty wiki, click handlers

**Steps:**

- [ ] **Step 1: Write the pure tree-building util**

Create `apps/client/src/lib/wiki-tree.ts`:

```ts
import type { TreeEntryDto } from "@/types/wiki";

export interface WikiTreeNodeData {
  name: string;
  path: string; // full path from wiki root
  type: "file" | "dir";
  children: WikiTreeNodeData[];
}

/**
 * Convert folder9's flat file list into a nested tree.
 * folder9's recursive=true returns files only, so directories are derived
 * from the path segments.
 */
export function buildTree(entries: TreeEntryDto[]): WikiTreeNodeData[] {
  const rootChildren: Record<string, WikiTreeNodeData> = {};

  for (const entry of entries) {
    if (entry.path.startsWith(".") || entry.path.includes("/.")) {
      // Skip dot-prefixed paths (.team9/, etc.)
      continue;
    }
    if (entry.type !== "file") continue;

    const parts = entry.path.split("/");
    let cursor = rootChildren;
    let accumulated = "";

    for (let i = 0; i < parts.length - 1; i++) {
      const segment = parts[i];
      accumulated = accumulated ? `${accumulated}/${segment}` : segment;
      if (!cursor[segment]) {
        cursor[segment] = {
          name: segment,
          path: accumulated,
          type: "dir",
          children: [],
        };
      }
      const node = cursor[segment];
      // Re-use the same object's children via a map — store children as map during build, flatten later
      const childMap = ((
        node as unknown as { _childMap?: Record<string, WikiTreeNodeData> }
      )._childMap ??= {});
      cursor = childMap as unknown as Record<string, WikiTreeNodeData>;
    }

    const fileName = parts[parts.length - 1];
    cursor[fileName] = {
      name: fileName,
      path: entry.path,
      type: "file",
      children: [],
    };
  }

  return flatten(rootChildren);
}

function flatten(map: Record<string, WikiTreeNodeData>): WikiTreeNodeData[] {
  const result: WikiTreeNodeData[] = [];
  for (const key of Object.keys(map).sort()) {
    const node = map[key];
    const childMap = (
      node as unknown as { _childMap?: Record<string, WikiTreeNodeData> }
    )._childMap;
    if (childMap) {
      node.children = flatten(childMap);
      delete (node as unknown as { _childMap?: unknown })._childMap;
    }
    result.push(node);
  }
  // Directories before files
  return result.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
```

Test the util thoroughly with fixtures like `[{path: 'a.md'}, {path: 'api/auth.md'}, {path: 'api/webhooks.md'}, {path: '.team9/covers/x.jpg'}]` → expected nested shape.

- [ ] **Step 2: Write WikiTreeNode**

Create `apps/client/src/components/wiki/WikiTreeNode.tsx`:

```tsx
import { ChevronDown, ChevronRight, FileText, Folder } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import {
  useExpandedDirectories,
  useSelectedPagePath,
  wikiActions,
} from "@/stores/wiki";
import type { WikiTreeNodeData } from "@/lib/wiki-tree";

interface Props {
  node: WikiTreeNodeData;
  wikiSlug: string;
  depth: number;
}

export function WikiTreeNode({ node, wikiSlug, depth }: Props) {
  const navigate = useNavigate();
  const expanded = useExpandedDirectories();
  const selectedPath = useSelectedPagePath();
  const isExpanded = expanded.has(node.path);
  const isActive = node.type === "file" && selectedPath === node.path;

  const handleClick = () => {
    if (node.type === "dir") {
      wikiActions.toggleDirectory(node.path);
      // If the dir has an index.md child, navigate to it
      const indexChild = node.children.find((c) => c.name === "index.md");
      if (indexChild) {
        navigate({
          to: "/wiki/$wikiSlug/$",
          params: { wikiSlug, _splat: indexChild.path },
        });
      }
    } else {
      navigate({
        to: "/wiki/$wikiSlug/$",
        params: { wikiSlug, _splat: node.path },
      });
    }
  };

  return (
    <div>
      <button
        onClick={handleClick}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        className={cn(
          "flex items-center gap-1 px-2 py-1 text-xs w-full text-left hover:bg-accent",
          isActive && "bg-primary/10 text-primary font-medium",
        )}
      >
        {node.type === "dir" ? (
          isExpanded ? (
            <ChevronDown size={12} />
          ) : (
            <ChevronRight size={12} />
          )
        ) : (
          <span style={{ width: 12 }} />
        )}
        {node.type === "dir" ? <Folder size={12} /> : <FileText size={12} />}
        <span className="truncate">{node.name}</span>
      </button>
      {node.type === "dir" && isExpanded && (
        <div>
          {node.children.map((child) => (
            <WikiTreeNode
              key={child.path}
              node={child}
              wikiSlug={wikiSlug}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Write WikiListItem and WikiSubSidebar**

`apps/client/src/components/wiki/WikiListItem.tsx`:

```tsx
import {
  ChevronDown,
  ChevronRight,
  Library as LibraryIcon,
} from "lucide-react";
import { useWikiTree } from "@/hooks/useWikiTree";
import { useExpandedDirectories, wikiActions } from "@/stores/wiki";
import { buildTree } from "@/lib/wiki-tree";
import { WikiTreeNode } from "./WikiTreeNode";
import type { WikiDto } from "@/types/wiki";

interface Props {
  wiki: WikiDto;
}

export function WikiListItem({ wiki }: Props) {
  const expanded = useExpandedDirectories();
  const isOpen = expanded.has(`wiki:${wiki.id}`);
  const { data: entries } = useWikiTree(isOpen ? wiki.id : null);
  const tree = entries ? buildTree(entries) : [];

  return (
    <div>
      <button
        onClick={() => wikiActions.toggleDirectory(`wiki:${wiki.id}`)}
        className="flex items-center gap-1 px-3 py-1.5 text-sm w-full text-left hover:bg-accent font-medium"
      >
        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <LibraryIcon size={14} className="text-primary" />
        <span className="truncate">{wiki.name}</span>
      </button>
      {isOpen &&
        tree.map((node) => (
          <WikiTreeNode
            key={node.path}
            node={node}
            wikiSlug={wiki.slug}
            depth={1}
          />
        ))}
    </div>
  );
}
```

`apps/client/src/components/layout/sidebars/WikiSubSidebar.tsx` — replace the stub:

```tsx
import { useState } from "react";
import { Library, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useTranslation } from "react-i18next";
import { useWikis } from "@/hooks/useWikis";
import { WikiListItem } from "@/components/wiki/WikiListItem";
import { CreateWikiDialog } from "@/components/wiki/CreateWikiDialog"; // Task 20

export function WikiSubSidebar() {
  const { t } = useTranslation("navigation");
  const { data: wikis, isLoading } = useWikis();
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="flex flex-col h-full bg-background">
      <header className="h-14 flex items-center justify-between px-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Library size={18} className="text-primary" />
          <h2 className="font-semibold text-sm">{t("wiki")}</h2>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setShowCreate(true)}>
          <Plus size={14} />
        </Button>
      </header>
      <Separator />
      <ScrollArea className="flex-1 py-2">
        {isLoading && (
          <p className="px-4 py-2 text-xs text-muted-foreground">Loading…</p>
        )}
        {!isLoading && wikis?.length === 0 && (
          <p className="px-4 py-2 text-xs text-muted-foreground">
            No wikis yet. Click + to create one.
          </p>
        )}
        {wikis?.map((wiki) => (
          <WikiListItem key={wiki.id} wiki={wiki} />
        ))}
      </ScrollArea>
      <CreateWikiDialog open={showCreate} onOpenChange={setShowCreate} />
    </div>
  );
}
```

Stub `CreateWikiDialog` as a no-op for now (real impl in Task 20): `export function CreateWikiDialog({open, onOpenChange}: {open: boolean; onOpenChange: (o: boolean) => void}) { return null; }`.

- [ ] **Step 4: Tests**

Write Vitest tests for `buildTree` (unit), `WikiTreeNode` (click handlers, active highlighting, recursive render), and `WikiSubSidebar` (loading, empty, with wikis).

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/lib/wiki-tree.ts apps/client/src/components/wiki/WikiListItem.tsx apps/client/src/components/wiki/WikiTreeNode.tsx apps/client/src/components/wiki/CreateWikiDialog.tsx apps/client/src/components/layout/sidebars/WikiSubSidebar.tsx apps/client/src/lib/__tests__/wiki-tree.test.ts
git commit -m "feat(wiki): add sidebar with wiki list and derived file tree"
```

---

## Task 17: WikiPageView composite + draft persistence hook

**Goal:** Replace the `WikiPageView` stub with the Notion-style page view (cover band → overlapping icon → breadcrumb → title → status bar). Build the `useWikiDraft` hook that persists edits to localStorage.

**Files:**

- Create: `apps/client/src/components/wiki/WikiPageView.tsx`
- Create: `apps/client/src/components/wiki/WikiCover.tsx`
- Create: `apps/client/src/components/wiki/WikiPageHeader.tsx`
- Create: `apps/client/src/components/wiki/WikiStatusBar.tsx`
- Create: `apps/client/src/hooks/useWikiDraft.ts`
- Create tests for `useWikiDraft` + `WikiPageView` render

**Acceptance Criteria:**

- [ ] `WikiPageView` takes `wikiId` + `path`, calls `useWikiPage`, shows skeleton → view
- [ ] `WikiCover` renders either the frontmatter `cover` image (fetched via gateway `getPage` for the image file? OR direct HTTP GET on the blob endpoint) or a gradient fallback
- [ ] `WikiPageHeader` shows icon (emoji or image), breadcrumb of parent dirs, and the title (frontmatter.title || first H1 || filename)
- [ ] `WikiStatusBar` shows "last saved X minutes ago · Synced/Unsaved" + Save button (wired in Task 19)
- [ ] `useWikiDraft` persists `{ body, frontmatter, savedAt }` to localStorage with key format from spec
- [ ] `useWikiDraft` offers: `draft`, `setDraft`, `clearDraft`, `isDirty`
- [ ] On mount, hook checks if draft is newer than `page.lastCommit.timestamp` — returns a `hasStaleDraftAlert` flag
- [ ] Debounced writes (500ms)
- [ ] Vitest tests cover: write cycle, clear, stale-alert, cross-user isolation (key includes userId)

**Steps:**

- [ ] **Step 1: Implement `useWikiDraft`**

Create `apps/client/src/hooks/useWikiDraft.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { useCurrentUser } from "./useAuth";
import { useWorkspaceStore } from "@/stores";

export interface Draft {
  body: string;
  frontmatter: Record<string, unknown>;
  savedAt: number;
}

function draftKey(
  userId: string,
  workspaceId: string,
  wikiId: string,
  path: string,
): string {
  const pathB64 = btoa(unescape(encodeURIComponent(path)));
  return `team9.wiki.draft.${workspaceId}.${wikiId}.${pathB64}.${userId}`;
}

function readDraft(key: string): Draft | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as Draft;
  } catch {
    return null;
  }
}

function writeDraft(key: string, draft: Draft): void {
  try {
    localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // quota exceeded or SSR — silently drop
  }
}

export function useWikiDraft(
  wikiId: string | null,
  path: string | null,
  serverSnapshot: {
    body: string;
    frontmatter: Record<string, unknown>;
    lastCommitTime: string | null;
  } | null,
) {
  const { data: currentUser } = useCurrentUser();
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);

  const [draft, setDraftState] = useState<Draft | null>(null);
  const [hasStaleAlert, setHasStaleAlert] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const key =
    currentUser && workspaceId && wikiId && path
      ? draftKey(currentUser.id, workspaceId, wikiId, path)
      : null;

  // Load draft on mount / path change
  useEffect(() => {
    if (!key || !serverSnapshot) {
      setDraftState(null);
      setHasStaleAlert(false);
      return;
    }
    const existing = readDraft(key);
    if (!existing) {
      setDraftState(null);
      setHasStaleAlert(false);
      return;
    }
    const serverTime = serverSnapshot.lastCommitTime
      ? new Date(serverSnapshot.lastCommitTime).getTime()
      : 0;
    if (existing.savedAt > serverTime) {
      setDraftState(existing);
      setHasStaleAlert(true);
    } else {
      // Stale server snapshot is newer than draft → discard draft silently
      localStorage.removeItem(key);
      setDraftState(null);
      setHasStaleAlert(false);
    }
  }, [key, serverSnapshot]);

  const setDraft = useCallback(
    (next: { body: string; frontmatter: Record<string, unknown> }) => {
      if (!key) return;
      const d: Draft = { ...next, savedAt: Date.now() };
      setDraftState(d);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => writeDraft(key, d), 500);
    },
    [key],
  );

  const clearDraft = useCallback(() => {
    if (!key) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    localStorage.removeItem(key);
    setDraftState(null);
    setHasStaleAlert(false);
  }, [key]);

  const dismissStaleAlert = useCallback(() => setHasStaleAlert(false), []);

  const isDirty = draft != null;

  return {
    draft,
    setDraft,
    clearDraft,
    isDirty,
    hasStaleAlert,
    dismissStaleAlert,
  };
}
```

Test file covers: debounce write, read on mount, stale alert, cross-user key isolation (different userId → different key), `clearDraft` removes from storage.

- [ ] **Step 2: Implement composites**

`WikiCover.tsx` — shows a cover image or gradient fallback; the cover path is resolved by calling gateway's `GET /api/wikis/:wikiId/pages?path=<cover-path>` and base64-decoding the content — OR, simpler: use a dedicated `GET /api/wikis/:wikiId/raw?path=<cover-path>` endpoint that streams binary. **For MVP, add a new gateway method `getRaw(path)` to `WikisService` that passes through to folder9's `/raw` endpoint (managed folders supports this).** Track that as a mini-addition inside this task.

```tsx
import { env } from "@/config/env";

interface Props {
  wikiId: string;
  coverPath: string | null;
}

export function WikiCover({ wikiId, coverPath }: Props) {
  if (!coverPath) {
    return (
      <div className="h-32 bg-gradient-to-br from-primary/30 via-blue-400/20 to-purple-400/20" />
    );
  }
  // Use the gateway raw endpoint (added as part of this task)
  const url = `/api/wikis/${wikiId}/raw?path=${encodeURIComponent(coverPath)}`;
  return (
    <div
      className="h-32 bg-cover bg-center"
      style={{ backgroundImage: `url(${url})` }}
    />
  );
}
```

Add to `WikisController`:

```ts
@Get(':wikiId/raw')
getRaw(
  @CurrentWorkspaceId() workspaceId: string,
  @CurrentUser() user: ActingUser,
  @Param('wikiId') wikiId: string,
  @Query('path') path: string,
) {
  return this.service.getRaw(workspaceId, wikiId, user, path);
}
```

Add matching `getRaw` to `WikisService` and `Folder9ClientService`. Include tests — this is a small extension that belongs with the cover UI task.

`WikiPageHeader.tsx` — builds the breadcrumb from the path string, renders icon + title:

```tsx
import { Link } from "@tanstack/react-router";

interface Props {
  wikiSlug: string;
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

function extractTitle(
  path: string,
  frontmatter: Record<string, unknown>,
  body: string,
): string {
  if (typeof frontmatter.title === "string") return frontmatter.title;
  const h1 = body.match(/^#\s+(.+)$/m);
  if (h1) return h1[1].trim();
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.md$/, "");
}

export function WikiPageHeader({ wikiSlug, path, frontmatter, body }: Props) {
  const icon = typeof frontmatter.icon === "string" ? frontmatter.icon : "📄";
  const title = extractTitle(path, frontmatter, body);
  const segments = path.split("/").slice(0, -1);

  return (
    <header className="relative px-12 pb-3 pt-8">
      <div className="absolute -top-7 left-12 w-14 h-14 flex items-center justify-center text-4xl bg-background rounded-lg shadow-lg">
        {icon}
      </div>
      <nav className="text-xs text-muted-foreground mt-6 mb-2 flex gap-1">
        <Link
          to="/wiki/$wikiSlug"
          params={{ wikiSlug }}
          className="hover:underline"
        >
          {wikiSlug}
        </Link>
        {segments.map((seg, i) => (
          <span key={i}> / {seg}</span>
        ))}
      </nav>
      <h1 className="text-3xl font-bold">{title}</h1>
    </header>
  );
}
```

`WikiStatusBar.tsx` — shows last-saved + Save button (actions wired in Task 19):

```tsx
interface Props {
  lastSavedAt: string | null;
  isDirty: boolean;
  isSaving: boolean;
  canSave: boolean;
  onSave: () => void;
}

export function WikiStatusBar({
  lastSavedAt,
  isDirty,
  isSaving,
  canSave,
  onSave,
}: Props) {
  return (
    <div className="flex items-center justify-between px-12 py-2 border-b border-border text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        {isDirty ? (
          <span className="text-orange-500">● Unsaved changes</span>
        ) : (
          <span className="text-green-500">● Synced</span>
        )}
        {lastSavedAt && (
          <span>· last saved {new Date(lastSavedAt).toLocaleTimeString()}</span>
        )}
      </div>
      <button
        onClick={onSave}
        disabled={!canSave || isSaving || !isDirty}
        className="px-3 py-1 rounded bg-primary text-primary-foreground disabled:opacity-50 text-xs"
      >
        {isSaving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
```

`WikiPageView.tsx` — composes them (editor slot is filled in Task 18):

```tsx
import { useWikiPage } from "@/hooks/useWikiPage";
import { useWikis } from "@/hooks/useWikis";
import { WikiCover } from "./WikiCover";
import { WikiPageHeader } from "./WikiPageHeader";
import { WikiStatusBar } from "./WikiStatusBar";
import { WikiPageEditor } from "./WikiPageEditor"; // Task 18

interface Props {
  wikiId: string;
  path: string;
}

export function WikiPageView({ wikiId, path }: Props) {
  const { data: page, isLoading } = useWikiPage(wikiId, path);
  const { data: wikis } = useWikis();
  const wiki = wikis?.find((w) => w.id === wikiId);

  if (isLoading || !page || !wiki) return <div className="p-8">Loading…</div>;

  const coverPath =
    typeof page.frontmatter.cover === "string" ? page.frontmatter.cover : null;

  return (
    <main className="h-full flex flex-col bg-background overflow-auto">
      <WikiCover wikiId={wikiId} coverPath={coverPath} />
      <WikiPageHeader
        wikiSlug={wiki.slug}
        path={path}
        frontmatter={page.frontmatter}
        body={page.content}
      />
      <WikiPageEditor
        wikiId={wikiId}
        path={path}
        serverPage={page}
        wiki={wiki}
      />
    </main>
  );
}
```

- [ ] **Step 3: Tests**

- `useWikiDraft.test.ts`: full lifecycle, stale detection
- `WikiPageHeader.test.tsx`: title extraction fallbacks, breadcrumb rendering
- `WikiStatusBar.test.tsx`: button disabled states

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/components/wiki apps/client/src/hooks/useWikiDraft.ts apps/server/apps/gateway/src/wikis
git commit -m "feat(wiki): add page view shell, cover/header/status bar, draft persistence"
```

---

## Task 18: WikiPageEditor (Lexical wrapper + frontmatter state)

**Goal:** Build the editor that ties the existing `DocumentEditor` (Lexical + markdown) together with the frontmatter state (icon/cover picker) and draft persistence.

**Files:**

- Create: `apps/client/src/components/wiki/WikiPageEditor.tsx`
- Create: `apps/client/src/components/wiki/IconPickerPopover.tsx`
- Create: `apps/client/src/components/wiki/CoverPickerPopover.tsx`

**Acceptance Criteria:**

- [ ] `WikiPageEditor` receives `{wikiId, path, serverPage, wiki}` props
- [ ] Internal state: `body: string`, `frontmatter: Record<string, unknown>`
- [ ] Initialized from `serverPage` (or from draft if draft is newer)
- [ ] Wraps `<DocumentEditor initialContent={body} onChange={handleBodyChange} readOnly={readOnly}>`
- [ ] `readOnly = effective permission is 'read'` (derived from wiki + current user)
- [ ] Icon picker popover lets the user choose an emoji; updates `frontmatter.icon`
- [ ] Cover picker popover: button opens a dialog to paste a file URL or upload a new image (upload impl deferred to Task 22 — stub now)
- [ ] Every body or frontmatter change calls `draft.setDraft(...)` from `useWikiDraft`
- [ ] Exposes an imperative `save()` method (used by Task 19) or a callback prop

**Steps:**

- [ ] **Step 1: Implement**

`WikiPageEditor.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { DocumentEditor } from "@/components/documents/DocumentEditor";
import { useWikiDraft } from "@/hooks/useWikiDraft";
import { useCurrentUser } from "@/hooks/useAuth";
import { IconPickerPopover } from "./IconPickerPopover";
import { CoverPickerPopover } from "./CoverPickerPopover";
import { WikiStatusBar } from "./WikiStatusBar";
import { resolveClientPermission } from "@/lib/wiki-permission";
import type { PageDto, WikiDto } from "@/types/wiki";

interface Props {
  wikiId: string;
  path: string;
  serverPage: PageDto;
  wiki: WikiDto;
}

export function WikiPageEditor({ wikiId, path, serverPage, wiki }: Props) {
  const { data: currentUser } = useCurrentUser();
  const perm = resolveClientPermission(wiki, currentUser);
  const readOnly = perm === "read";

  const { draft, setDraft, clearDraft, isDirty, hasStaleAlert } = useWikiDraft(
    wikiId,
    path,
    {
      body: serverPage.content,
      frontmatter: serverPage.frontmatter,
      lastCommitTime: serverPage.lastCommit?.timestamp ?? null,
    },
  );

  // Seed state — draft wins if present (user explicitly accepted it)
  const [body, setBody] = useState(() => draft?.body ?? serverPage.content);
  const [frontmatter, setFrontmatter] = useState<Record<string, unknown>>(
    () => draft?.frontmatter ?? serverPage.frontmatter,
  );

  // If serverPage changes (remote update), reset state unless dirty
  useEffect(() => {
    if (isDirty) return;
    setBody(serverPage.content);
    setFrontmatter(serverPage.frontmatter);
  }, [serverPage, isDirty]);

  function handleBodyChange(md: string) {
    setBody(md);
    setDraft({ body: md, frontmatter });
  }

  function handleFrontmatterChange(next: Record<string, unknown>) {
    setFrontmatter(next);
    setDraft({ body, frontmatter: next });
  }

  // TODO (Task 19): implement save() and wire via WikiStatusBar

  return (
    <div className="flex-1 flex flex-col">
      <div className="flex gap-2 px-12 py-2">
        <IconPickerPopover
          value={frontmatter.icon as string | undefined}
          onChange={(icon) => handleFrontmatterChange({ ...frontmatter, icon })}
          disabled={readOnly}
        />
        <CoverPickerPopover
          wikiId={wikiId}
          value={frontmatter.cover as string | undefined}
          onChange={(cover) =>
            handleFrontmatterChange({ ...frontmatter, cover })
          }
          disabled={readOnly}
        />
      </div>
      {hasStaleAlert && (
        <div className="mx-12 p-3 mb-2 text-xs bg-yellow-50 border border-yellow-200 rounded">
          You have unsaved local changes. Viewing your draft.
        </div>
      )}
      <div className="flex-1 px-12 pb-8">
        <DocumentEditor
          initialContent={body}
          onChange={handleBodyChange}
          readOnly={readOnly}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the client-side permission util**

`apps/client/src/lib/wiki-permission.ts`:

```ts
import type { WikiDto } from "@/types/wiki";

export function resolveClientPermission(
  wiki: WikiDto,
  user: { type?: "human" | "agent" | "bot" } | null | undefined,
): "read" | "propose" | "write" {
  if (!user) return "read";
  const isAgent = user.type === "agent" || user.type === "bot";
  return isAgent ? wiki.agentPermission : wiki.humanPermission;
}
```

- [ ] **Step 3: Icon / cover popovers**

`IconPickerPopover.tsx`: a simple emoji picker over the existing Team9 `EmojiPicker` component (reused from the chat editor — `apps/client/src/components/channel/editor`). Expose `value`, `onChange`, `disabled`.

`CoverPickerPopover.tsx`: for MVP, just a button that opens a file input; on select, stubs `onChange` to a hard-coded placeholder path. Real upload flow comes in Task 22.

- [ ] **Step 4: Tests**

Test: initial state seeds from `serverPage`, dirty detection triggers `setDraft`, changing icon updates frontmatter, readOnly mode disables pickers.

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/components/wiki/WikiPageEditor.tsx apps/client/src/components/wiki/IconPickerPopover.tsx apps/client/src/components/wiki/CoverPickerPopover.tsx apps/client/src/lib/wiki-permission.ts
git commit -m "feat(wiki): add WikiPageEditor wrapping DocumentEditor with frontmatter state"
```

---

## Task 19: Save flow (auto + review mode + proposal banner)

**Goal:** Wire the Save button in `WikiStatusBar` to a real save action. Handle both `auto` and `review` modes. On review mode, prompt for commit message + show the pending-proposal banner.

**Files:**

- Create: `apps/client/src/components/wiki/SubmitForReviewDialog.tsx`
- Create: `apps/client/src/components/wiki/WikiProposalBanner.tsx`
- Modify: `apps/client/src/components/wiki/WikiPageEditor.tsx` (connect save)
- Modify: `apps/client/src/components/wiki/WikiPageView.tsx` (show banner when pending)

**Acceptance Criteria:**

- [ ] Cmd+S / Ctrl+S triggers save (when editor focused)
- [ ] `auto` mode: save calls `wikisApi.commit(...)` with `propose: false`, on success clears draft + shows "Synced"
- [ ] `review` mode: save opens `<SubmitForReviewDialog>` (title + optional description) → commit with `propose: true`
- [ ] On successful proposal creation, client stores `lastSubmittedProposalId` in the wiki store (or a local map keyed by path)
- [ ] `<WikiProposalBanner>` shows atop the page when `lastSubmittedProposalId` is set for the current path
- [ ] Banner has a "View proposal" button that navigates to the review panel scoped to that proposal (Task 21)
- [ ] Draft NOT cleared in review mode (so user can re-submit if changes requested)
- [ ] Draft cleared when the banner is closed by approval / rejection (Task 23 WS consumer)
- [ ] Error handling: 409 conflict shows a toast "Conflicts with current page"; 403 shows "You don't have permission"

**Steps:**

- [ ] **Step 1: Add a submitted-proposals map to the wiki store**

Extend `stores/wiki.ts`:

```ts
submittedProposals: Record<string, string>;  // key: `${wikiId}:${path}` → proposalId
setSubmittedProposal: (wikiId: string, path: string, proposalId: string | null) => void;
```

- [ ] **Step 2: Build the dialog**

`SubmitForReviewDialog.tsx`: basic Radix `Dialog` with two inputs (title required, description optional) and a Submit button that fires the provided `onSubmit({title, description})` callback.

- [ ] **Step 3: Build the banner**

`WikiProposalBanner.tsx`:

```tsx
interface Props {
  proposalId: string;
  onView: () => void;
}

export function WikiProposalBanner({ proposalId, onView }: Props) {
  return (
    <div className="mx-12 my-2 p-3 rounded-md bg-amber-50 border border-amber-200 flex items-center justify-between text-xs">
      <span>🟡 This page has a pending review proposal.</span>
      <button onClick={onView} className="text-amber-700 underline">
        View proposal →
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Wire save in WikiPageEditor**

Inside `WikiPageEditor`, add:

```tsx
import { useCommitWikiPage } from "@/hooks/useWikiPage";
import { serializeFrontmatter } from "@/lib/wiki-frontmatter";
import { toast } from "@/components/ui/use-toast";
import { useWikiStore } from "@/stores/wiki";

// ... inside the component:
const commit = useCommitWikiPage(wikiId);
const setSubmittedProposal = useWikiStore((s) => s.setSubmittedProposal);
const [showReviewDialog, setShowReviewDialog] = useState(false);

async function handleSave(reviewInput?: {
  title: string;
  description?: string;
}) {
  const content = serializeFrontmatter({ frontmatter, body });
  const isReview = wiki.approvalMode === "review";
  if (isReview && !reviewInput) {
    setShowReviewDialog(true);
    return;
  }
  try {
    const result = await commit.mutateAsync({
      message: reviewInput?.title ?? `Update ${path}`,
      files: [{ path, content, action: "update" }],
      propose: isReview,
    });
    if (result.proposal) {
      setSubmittedProposal(wikiId, path, result.proposal.id);
      toast({ title: "Submitted for review" });
    } else {
      clearDraft();
      toast({ title: "Saved" });
    }
  } catch (err) {
    if ((err as { status?: number }).status === 409) {
      toast({
        title: "Conflict",
        description: "This page changed on the server. Reload and try again.",
        variant: "destructive",
      });
    } else if ((err as { status?: number }).status === 403) {
      toast({ title: "You don't have permission", variant: "destructive" });
    } else {
      toast({ title: "Save failed", variant: "destructive" });
    }
  }
}

// Cmd+S binding
useEffect(() => {
  function onKey(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      if (isDirty && !commit.isPending) void handleSave();
    }
  }
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, [isDirty, commit.isPending]);
```

Render `<WikiStatusBar>` with `onSave={() => handleSave()}` and render the dialog conditionally.

- [ ] **Step 5: Show banner in WikiPageView**

Inside `WikiPageView`, read `submittedProposals[`${wikiId}:${path}`]` from the store and render `<WikiProposalBanner>` if set.

- [ ] **Step 6: Tests**

- Auto-mode save: mock mutation → asserts `propose: false`, draft cleared, toast shown
- Review-mode save: opens dialog, submit → mutation called with `propose: true`, `submittedProposal` set in store, draft NOT cleared
- 409 handling
- Cmd+S triggers save when dirty
- Save disabled when not dirty

- [ ] **Step 7: Commit**

```bash
git add apps/client/src/components/wiki/SubmitForReviewDialog.tsx apps/client/src/components/wiki/WikiProposalBanner.tsx apps/client/src/components/wiki/WikiPageEditor.tsx apps/client/src/components/wiki/WikiPageView.tsx apps/client/src/stores/wiki.ts
git commit -m "feat(wiki): implement save flow for auto + review modes"
```

---

## Task 20: Create Wiki dialog + Wiki settings dialog + archive action

**Goal:** Replace the stubbed `CreateWikiDialog` with a real modal. Add a `WikiSettingsDialog` for renaming, toggling approval_mode, editing permissions, and archiving.

**Files:**

- Modify: `apps/client/src/components/wiki/CreateWikiDialog.tsx`
- Create: `apps/client/src/components/wiki/WikiSettingsDialog.tsx`
- Modify: `apps/client/src/components/wiki/WikiListItem.tsx` (add kebab menu → Settings / Archive)

**Acceptance Criteria:**

- [ ] `CreateWikiDialog` has name + slug (auto-derived, editable) + icon picker
- [ ] Submit calls `useCreateWiki` mutation; on success closes dialog, navigates to new Wiki's root
- [ ] `WikiSettingsDialog` loads the Wiki by id (via `useWikis().data.find`) and shows editable fields
- [ ] Archive button opens a confirmation AlertDialog; on confirm calls `useArchiveWiki`
- [ ] Validation: name required, slug matches `[a-z0-9-]+`, unique per workspace (the server rejects duplicates — show the server error toast)
- [ ] Optimistic UI: list refreshes after create/archive
- [ ] Tests cover: validation, successful submit, server error toast, archive confirmation

**Steps:**

- [ ] **Step 1: Implement CreateWikiDialog**

Use existing Radix Dialog components from `@/components/ui/dialog`. Form fields via `<Input>` from `@/components/ui/input`. On submit, call the mutation and handle errors. Pattern same as the existing `CreateDocumentDialog` in `LibraryMainContent.tsx` (now deleted — refer to git history `git show HEAD~N` if needed).

- [ ] **Step 2: Implement WikiSettingsDialog**

Similar dialog with tabs / sections:

- General (name, slug, icon)
- Approval mode (radio: auto / review)
- Permissions (two Select inputs: human, agent)
- Danger zone (Archive button)

- [ ] **Step 3: Add kebab to WikiListItem**

Right-click or hover-only button → `<DropdownMenu>` with items: Settings, Archive.

- [ ] **Step 4: Tests**

Each dialog: render test + submit flow + error path.

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/components/wiki/CreateWikiDialog.tsx apps/client/src/components/wiki/WikiSettingsDialog.tsx apps/client/src/components/wiki/WikiListItem.tsx
git commit -m "feat(wiki): add create/settings/archive dialogs for wikis"
```

---

## Task 21: Review panel (list + diff + approve/reject)

**Goal:** A dedicated review view accessible from a `Review` icon in the Wiki sub-sidebar header (when there are pending proposals) OR from the proposal banner on a page.

**Files:**

- Create: `apps/client/src/components/wiki/ReviewPanel.tsx`
- Create: `apps/client/src/components/wiki/ProposalDiffView.tsx`
- Create: `apps/client/src/routes/_authenticated/wiki/$wikiSlug.review.tsx`
- Create: `apps/client/src/routes/_authenticated/wiki/$wikiSlug.review.$proposalId.tsx`
- Modify: `apps/client/src/components/layout/sidebars/WikiSubSidebar.tsx` (add Review icon + badge)
- Modify gateway: add `GET /api/wikis/:wikiId/proposals/:proposalId/diff` endpoint

**Acceptance Criteria:**

- [ ] Review icon in the sub-sidebar shows a badge with the number of pending proposals (`useWikiProposals` per wiki, aggregated)
- [ ] Clicking opens the list route: each row = one proposal
- [ ] Clicking a proposal opens the diff view with Approve / Reject buttons
- [ ] Approve / Reject only enabled for users with `write` permission
- [ ] `ProposalDiffView` shows a simple file-level diff — use `diff` library (already a common dep) or a basic line-diff renderer
- [ ] On approve/reject success, navigate back to the proposal list
- [ ] Approve error 409 → toast "Conflict — merge aborted"
- [ ] Tests: happy path approve, reject, permission gating

**Steps:**

- [ ] **Step 1: Extend gateway to return a diff**

In `WikisService`, add `getProposalDiff(workspaceId, wikiId, user, proposalId)` that calls a new `Folder9ClientService.getProposalDiff` method (which proxies folder9's `/diff` endpoint). Add controller route. Write tests.

- [ ] **Step 2: Build `ProposalDiffView`**

```tsx
import DiffMatchPatch from "diff-match-patch"; // or react-diff-view or similar

// Iterate files, render unified diff for each.
```

- [ ] **Step 3: Build `ReviewPanel`**

List proposals for a wiki; clicking navigates to `/wiki/:slug/review/:proposalId`.

- [ ] **Step 4: Wire routes**

Two new route files — list + detail. Load data with `useWikiProposals`.

- [ ] **Step 5: Add Review icon to sub-sidebar header**

Compute badge count: `useWikiProposals(wiki.id).data?.length || 0`, sum across all wikis.

- [ ] **Step 6: Tests**

- List renders proposals
- Click → detail loads
- Approve → mutation → navigate back
- Permission gate: read user sees no buttons
- Badge updates

- [ ] **Step 7: Commit**

```bash
git add apps/client/src/components/wiki/ReviewPanel.tsx apps/client/src/components/wiki/ProposalDiffView.tsx apps/client/src/routes/_authenticated/wiki apps/server/apps/gateway/src/wikis
git commit -m "feat(wiki): add review panel with diff view and approve/reject"
```

---

## Task 22: Image paste/drop upload

**Goal:** When the user pastes or drops an image into the editor, upload it to `.team9/attachments/{uuid}.{ext}` via a commit, then insert the markdown image reference.

**Files:**

- Create: `apps/client/src/hooks/useWikiImageUpload.ts`
- Modify: `apps/client/src/components/wiki/WikiPageEditor.tsx` (paste/drop handlers)

**Acceptance Criteria:**

- [ ] Paste of an image file OR drag-drop onto the editor triggers upload
- [ ] Files > 5 MB rejected with a toast "File too large (max 5 MB)"
- [ ] Uploaded as a separate commit (message: "Upload image <filename>")
- [ ] Uploaded path: `attachments/{uuid}.{ext}` (inline images) or `.team9/covers/{uuid}.{ext}` (cover uploads — via CoverPickerPopover)
- [ ] Insertion: markdown image node `![alt](attachments/foo.png)` inserted at cursor
- [ ] Show a placeholder while uploading; replace on success, remove on error

**Steps:**

- [ ] **Step 1: Build the upload hook**

```ts
import { useState } from "react";
import { wikisApi } from "@/services/api/wikis";

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function useWikiImageUpload(wikiId: string) {
  const [uploading, setUploading] = useState(false);

  async function upload(file: File, basePath: string): Promise<string> {
    if (file.size > 5 * 1024 * 1024) {
      throw new Error("File too large (max 5 MB)");
    }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || "bin";
      const path = `${basePath}/${crypto.randomUUID()}.${ext}`;
      const content = await fileToBase64(file);
      await wikisApi.commit(wikiId, {
        message: `Upload ${file.name}`,
        files: [{ path, content, encoding: "base64", action: "create" }],
      });
      return path;
    } finally {
      setUploading(false);
    }
  }

  return { upload, uploading };
}
```

- [ ] **Step 2: Wire paste/drop into WikiPageEditor**

Lexical has an `OnChangePlugin` and composable event handling. Use the Lexical `DRAG_DROP_PASTE` command or register a root DOM event listener on the editor container:

```tsx
useEffect(() => {
  const root = editorRootRef.current;
  if (!root) return;

  function onPaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) void handleUpload(file);
      }
    }
  }

  function onDrop(e: DragEvent) {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    for (const file of e.dataTransfer.files) {
      if (file.type.startsWith("image/")) void handleUpload(file);
    }
  }

  root.addEventListener("paste", onPaste);
  root.addEventListener("drop", onDrop);
  return () => {
    root.removeEventListener("paste", onPaste);
    root.removeEventListener("drop", onDrop);
  };
}, []);

async function handleUpload(file: File) {
  try {
    const path = await imageUpload.upload(file, "attachments");
    // Insert markdown at cursor — use Lexical's $insertText or a custom command
    insertImageMarkdown(`![${file.name}](${path})`);
    // Mark dirty so next save commits the reference
    handleBodyChange(body + `\n\n![${file.name}](${path})\n`);
  } catch (err) {
    toast({
      title: "Upload failed",
      description: err instanceof Error ? err.message : "unknown",
      variant: "destructive",
    });
  }
}
```

Note: the actual Lexical insertion API is `editor.update(() => { const sel = $getSelection(); sel?.insertText(...); })`. Use that via an imperative ref.

- [ ] **Step 3: Tests**

- Paste valid image → upload called
- Paste oversize → rejected, no upload
- Upload failure → toast

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/hooks/useWikiImageUpload.ts apps/client/src/components/wiki/WikiPageEditor.tsx
git commit -m "feat(wiki): add image paste/drop upload to editor"
```

---

## Task 23: WebSocket event consumers

**Goal:** Subscribe to `wiki_*` WebSocket events in the client and invalidate the relevant React Query cache so changes from other users (or from proposal approvals) refresh the UI automatically.

**Files:**

- Create: `apps/client/src/hooks/useWikiWebSocketSync.ts`
- Modify: `apps/client/src/components/layout/contents/WikiMainContent.tsx` (mount the sync hook)
- Modify: `apps/client/src/services/websocket/index.ts` (add `wiki_*` event types to the type map if typed)

**Acceptance Criteria:**

- [ ] Hook subscribes to: `wiki_created`, `wiki_updated`, `wiki_archived`, `wiki_page_updated`, `wiki_proposal_created`, `wiki_proposal_approved`, `wiki_proposal_rejected`
- [ ] `wiki_created` / `wiki_archived` / `wiki_updated` → `queryClient.invalidateQueries({queryKey: wikiKeys.all})`
- [ ] `wiki_page_updated` → invalidate `wikiKeys.page(wikiId, path)` and `wikiKeys.tree(wikiId, '/')`
- [ ] `wiki_proposal_created` / `wiki_proposal_approved` / `wiki_proposal_rejected` → invalidate `wikiKeys.proposals(wikiId)`
- [ ] On `wiki_proposal_approved` / `wiki_proposal_rejected`, clear the matching `submittedProposals[key]` from the wiki store + clear any draft that was tied to it
- [ ] Unsubscribes on unmount

**Steps:**

- [ ] **Step 1: Implement the hook**

```ts
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { wsService } from "@/services/websocket";
import { wikiKeys } from "./useWikis";
import { useWikiStore } from "@/stores/wiki";

export function useWikiWebSocketSync() {
  const qc = useQueryClient();
  const setSubmittedProposal = useWikiStore((s) => s.setSubmittedProposal);

  useEffect(() => {
    const handlers: Array<[string, (data: unknown) => void]> = [
      ["wiki_created", () => qc.invalidateQueries({ queryKey: wikiKeys.all })],
      ["wiki_updated", () => qc.invalidateQueries({ queryKey: wikiKeys.all })],
      ["wiki_archived", () => qc.invalidateQueries({ queryKey: wikiKeys.all })],
      [
        "wiki_page_updated",
        (data) => {
          const d = data as { wikiId: string };
          qc.invalidateQueries({ queryKey: wikiKeys.tree(d.wikiId, "/") });
          qc.invalidateQueries({ queryKey: ["wikis", d.wikiId, "page"] });
        },
      ],
      [
        "wiki_proposal_created",
        (data) => {
          const d = data as { wikiId: string };
          qc.invalidateQueries({ queryKey: wikiKeys.proposals(d.wikiId) });
        },
      ],
      [
        "wiki_proposal_approved",
        (data) => {
          const d = data as { wikiId: string; proposalId: string };
          qc.invalidateQueries({ queryKey: wikiKeys.proposals(d.wikiId) });
          qc.invalidateQueries({ queryKey: ["wikis", d.wikiId, "page"] });
          // Clear any submitted-proposal entries matching this proposalId
          const map = useWikiStore.getState().submittedProposals;
          for (const [k, v] of Object.entries(map)) {
            if (v === d.proposalId) {
              const [wikiId, path] = k.split(":");
              setSubmittedProposal(wikiId, path, null);
            }
          }
        },
      ],
      [
        "wiki_proposal_rejected",
        (data) => {
          const d = data as { wikiId: string; proposalId: string };
          qc.invalidateQueries({ queryKey: wikiKeys.proposals(d.wikiId) });
          const map = useWikiStore.getState().submittedProposals;
          for (const [k, v] of Object.entries(map)) {
            if (v === d.proposalId) {
              const [wikiId, path] = k.split(":");
              setSubmittedProposal(wikiId, path, null);
            }
          }
        },
      ],
    ];

    for (const [event, handler] of handlers) {
      wsService.on(event, handler);
    }
    return () => {
      for (const [event, handler] of handlers) {
        wsService.off(event, handler);
      }
    };
  }, [qc, setSubmittedProposal]);
}
```

> **Note:** Verify `wsService.off(...)` exists (or whatever the unsubscribe API is). If not, extend the service with an `off` method as part of this task.

- [ ] **Step 2: Mount the hook**

In `WikiMainContent.tsx` (or a higher-level wiki layout wrapper), call `useWikiWebSocketSync()` once.

- [ ] **Step 3: Tests**

Mock `wsService` with an event emitter shim. Fire each event type and assert the correct React Query invalidation / store mutation happens.

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/hooks/useWikiWebSocketSync.ts apps/client/src/components/layout/contents/WikiMainContent.tsx apps/client/src/services/websocket
git commit -m "feat(wiki): wire WebSocket event consumers for live refresh"
```

---

## Self-Review Checklist (run before handoff)

Before asking for execution, verify every spec requirement has a corresponding task:

- [ ] Spec §Data Model → Task 1
- [ ] Spec §Permission Model → Tasks 4, 5, 6
- [ ] Spec §Wiki Lifecycle (creation) → Tasks 5, 10, 20
- [ ] Spec §Default `public` Wiki → Task 10
- [ ] Spec §Archive / Delete → Tasks 5, 20
- [ ] Spec §File Structure & Conventions (frontmatter) → Tasks 3, 14, 18
- [ ] Spec §`index.md` Convention → Tasks 15, 16 (navigate to index when dir clicked)
- [ ] Spec §Hidden `.team9/` → Task 16 (`buildTree` filter)
- [ ] Spec §Route and Navigation Entry → Tasks 12, 15
- [ ] Spec §Component Tree → Tasks 12, 15, 16, 17
- [ ] Spec §WikiTree Component → Task 16
- [ ] Spec §WikiPageEditor → Task 18
- [ ] Spec §Draft Persistence → Task 17
- [ ] Spec §Save Flow (auto + review) → Task 19
- [ ] Spec §Review UX → Task 21
- [ ] Spec §Image Paste / Drop Upload → Task 22
- [ ] Spec §Backend Architecture (WikisService, Folder9ClientService) → Tasks 2, 4, 5, 6
- [ ] Spec §Folder9WebhookController → Task 8
- [ ] Spec §Auto-Seed `public` Wiki → Task 10
- [ ] Spec §API Contract → Task 7
- [ ] Spec §WebSocket Events (gateway emit + client consume) → Tasks 8, 23
- [ ] Spec §Testing Strategy → every task has tests inline + Task 11 (E2E)
- [ ] Spec §Migration & Rollout Phase 1 (hidden + seed + backfill) → Tasks 10, 12

Open question tracked: backlinks index location → spec Open Questions (no MVP task).
Future work items → spec Future Work section (no MVP tasks).

---

## Type / Name Consistency Check

Names used across tasks:

- `WikisService` (Tasks 5, 6, 7, 9, 10)
- `Folder9ClientService` (Tasks 2, 5, 6, 9, 10, 21)
- `workspace_wikis` table (Tasks 1, 5, 8, 10)
- `workspaceWikis` Drizzle schema export (Tasks 1, 5, 8, 10)
- `WikiDto` / `TreeEntryDto` / `PageDto` / `ProposalDto` (Tasks 4, 7, 13)
- `buildTree(entries)` (Task 16)
- `useWikiDraft` / `Draft` (Task 17)
- `WikiPageEditor` / `WikiPageView` (Tasks 17, 18, 19)
- `resolveClientPermission` (Task 18)
- `useWikiWebSocketSync` (Task 23)
- `wikiKeys.*` query key builder (Task 13)
- `submittedProposals` store field (Tasks 19, 23)

All consistent across task boundaries.

---

## Notes for the implementing engineer

- **Follow existing test patterns.** The `mockDb()` chain pattern in `workspace.service.spec.ts` is the canonical way to mock Drizzle — don't invent a new one. For controllers, mock the service directly. For React components, mock the hooks, not the underlying `fetch`.
- **100% coverage is the bar.** The project rule is 100% on new code; every task's verify step runs with `--coverage`. If a branch isn't exercised, add a bad-case test until it is.
- **Commit often.** One commit per task at minimum. If a task has a natural mid-point (e.g., "schema + migration" and "env vars" are separable in Task 1), you can split into two commits within the task.
- **Don't skip the review gate.** Per the project rules in `CLAUDE.md`, each completed task must be reviewed by an independent agent before the next one starts. Dispatch the `feature-dev:code-reviewer` agent between tasks.
- **If you hit a folder9 quirk not in the spec**, don't hack around it — stop and ask. folder9 is under active development and the contract may have drifted.
- **If a route/path differs from the spec** (e.g., the current user extraction uses `@Req() req` instead of `@CurrentUser()`), match existing conventions rather than the spec's illustrative code.
