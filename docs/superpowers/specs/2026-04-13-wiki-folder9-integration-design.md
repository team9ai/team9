# Wiki: folder9 Integration Design

> Date: 2026-04-13
> **Status:** Implemented (2026-04-22)
> Author: Winrey + Claude

## Implementation Notes (post-merge)

Implementation followed the spec with these notable adjustments:

- **Review URL prefix:** `/wiki/:slug/-/review` and `/wiki/:slug/-/review/:proposalId` (not `/review`). The `/-/` sentinel segment prevents collisions with wiki pages literally named `review/`. `validateWikiPath` now rejects any path whose top-level segment starts with `-`.
- **Wiki-level icon:** Added `icon` column to `workspace_wikis` (migration `0042_add_wiki_icon`) so the Create/Settings dialogs' icon picker persists. Not in the original spec; added during build-out.
- **Service-level broadcasts:** `WikisService.createWiki/updateWikiSettings/archiveWiki` now emit `wiki_created/updated/archived` via a `safeBroadcast` helper (non-throwing). The original spec's event table only included webhook-driven events.
- **Defensive additions:**
  - Webhook `folder_id` validated as UUID before DB lookup (drops malformed payloads with a 200+warn).
  - `validateWikiPath` rejects empty path segments, absolute paths, `..`/`.` traversal, null bytes, and control characters.
  - `proposalId` controller params validated against `/^[a-zA-Z0-9._-]+$/` with length 1-128.
  - `workspace_wikis.workspace_id` tightened from `TEXT` to `uuid` with `ON DELETE CASCADE` FK to `tenants.id` (migration `0045_wiki_workspace_fk`).
  - Slug uniqueness is now a PARTIAL index on `WHERE archived_at IS NULL` (migration `0047_wiki_slug_partial_unique`) so archived wikis release their slugs.
- **Binary file handling:** `PageDto.encoding` field added so the client renders a read-only "Binary file" placeholder for `encoding: 'base64'` blobs instead of allowing the editor to corrupt them on save.

## Overview

Add a new top-level sidebar entry **Wiki** to the Team9 client. Wikis are Notion-like hierarchical knowledge bases backed by [folder9](../../../../folder9) managed folders (git-backed with PR approval workflow). Each Wiki is one folder9 managed folder; files within are markdown pages with YAML frontmatter for icons, covers, and metadata.

This replaces the existing hidden **Library** entry over time. Library and the underlying `documents` module are left in place for now but are not extended further.

## Goals

- Users can create multiple Wikis per workspace; each Wiki is a folder9 managed folder.
- Users browse Wiki pages through a hierarchical tree in the Wiki sub-sidebar.
- Users edit pages through the existing Lexical `DocumentEditor`, round-tripping through markdown.
- Pages can have emoji icon, cover image, and frontmatter metadata.
- A folder in the tree can be "page-like" via an `index.md` convention.
- Editing uses an explicit **Save** gesture to avoid commit spam; drafts live in localStorage.
- Each Wiki supports two approval modes: `auto` (save commits to `main`) and `review` (save creates a proposal for admin review).
- Two workspace-level roles (`workspace_human`, `workspace_agent`) get per-Wiki permissions: `read` / `propose` / `write`.
- Every new workspace is auto-seeded with a default Wiki named `public`.
- The Team9 gateway proxies all folder9 traffic; the browser never sees folder9 directly.

## Non-Goals (MVP)

Explicitly out of scope for this spec. Tracked under [Future Work](#future-work).

- Backlinks, page references, `team9://` URI scheme, `@mention` on pages.
- Full-text search across Wiki content.
- Drag-to-reorder / rename / move files and folders (requires folder9 `rename`/`move` endpoints that don't exist yet).
- Multipart or whole-folder (zip) upload (folder9 only supports JSON + base64 commit today).
- Block-level "database views" (table / board / calendar of pages).
- Inline per-selection comments on `main` content (folder9's `proposal_comments` only attach to proposals).
- Real-time collaborative editing (no CRDT).
- Server-side draft persistence (MVP uses localStorage).
- Three-way merge conflict resolution UI for proposals.
- Multi-round proposal revisions (`changes_requested` state flow).
- Team-based or individual-level per-Wiki permissions (MVP is workspace-role only).
- Retiring the existing Library / `documents` module.

## Architecture Overview

```
┌────────────────────────────────────────────────────────────────┐
│                        Team9 Client (React)                    │
│                                                                │
│  MainSidebar → WikiSubSidebar → WikiMainContent                │
│                     │                  │                      │
│                     │                  └── DocumentEditor      │
│                     │                      (Lexical)           │
│                     │                                          │
│                     └── WikiTree (folder9 folders + files)    │
└──────────────────────────┬─────────────────────────────────────┘
                           │ REST (JWT)
                           │ WebSocket (wiki events)
                           ▼
┌────────────────────────────────────────────────────────────────┐
│                    Team9 Gateway (NestJS)                      │
│                                                                │
│  WikisModule                                                   │
│   ├─ WikisController         (/api/wikis/*)                   │
│   ├─ WikisService            (permission enforcement)          │
│   ├─ Folder9ClientService    (typed HTTP client → folder9)    │
│   └─ Folder9WebhookController (/api/folder9/webhook)          │
│                                                                │
│  workspace_wikis table      (workspace ↔ folder9_folder_id)    │
└──────────────────────────┬─────────────────────────────────────┘
                           │ PSK (pre-shared key)
                           ▼
┌────────────────────────────────────────────────────────────────┐
│                      folder9 (Go service)                      │
│                                                                │
│  folders / folder_access / proposals / proposal_comments /    │
│  tokens / webhooks      (unchanged, source of truth)          │
│                                                                │
│  Storage: git bare repos under /data/repos/{wsId}/{folderId}/ │
└────────────────────────────────────────────────────────────────┘
```

The browser never talks to folder9 directly. The gateway uses folder9's PSK for all service-to-service traffic. folder9 sends webhooks back to the gateway; the gateway re-broadcasts selected events over Team9's existing WebSocket channel so open clients refresh.

## Data Model

### Invariant: Wikis are a subset of folder9 folders

folder9 hosts many kinds of managed folders — Wikis today, agent workspaces / task scratch / other uses in the future. Team9's `workspace_wikis` table is the **allow-list** defining which folder9 folders are surfaced as Wikis in this feature.

**All Wikis are folder9 managed folders; not all folder9 managed folders are Wikis.**

Consequences for the gateway:

- Every gateway operation starts from a `wikiId` (Team9 primary key), never from a bare `folder9FolderId`.
- Webhook events naming a `folder_id` that has no matching `workspace_wikis` row are dropped with a log (not an error).
- Backfill scripts, enumeration endpoints, and any future admin tooling must filter through `workspace_wikis` — never query folder9's `/api/workspaces/{ws}/folders` and treat the response as "the list of Wikis."

### New Team9 Table: `workspace_wikis`

Lightweight pointer table. folder9 remains the source of truth for content, history, proposals, and access.

| Column              | Type                                | Description                                   |
| ------------------- | ----------------------------------- | --------------------------------------------- |
| `id`                | UUID PK                             |                                               |
| `workspace_id`      | TEXT NOT NULL                       | FK to `tenants.id` (workspace)                |
| `folder9_folder_id` | UUID NOT NULL UNIQUE                | Points to `folder9.folders.id`                |
| `name`              | TEXT NOT NULL                       | Display name, denormalized for fast listing   |
| `slug`              | TEXT NOT NULL                       | URL slug, unique per workspace                |
| `approval_mode`     | ENUM `auto` \| `review`             | Default `auto`                                |
| `human_permission`  | ENUM `read` \| `propose` \| `write` | What workspace humans can do. Default `write` |
| `agent_permission`  | ENUM `read` \| `propose` \| `write` | What workspace agents can do. Default `read`  |
| `created_by`        | TEXT NOT NULL                       | User id                                       |
| `created_at`        | TIMESTAMPTZ NOT NULL DEFAULT NOW()  |                                               |
| `updated_at`        | TIMESTAMPTZ NOT NULL DEFAULT NOW()  |                                               |
| `archived_at`       | TIMESTAMPTZ                         | Soft delete (nullable)                        |

Indexes:

- `UNIQUE(workspace_id, slug)`
- `INDEX(workspace_id)` for fast per-workspace listing
- `UNIQUE(folder9_folder_id)` (invariant: one Team9 wiki ↔ one folder9 folder)

### folder9 Tables (used as-is)

Team9 gateway reads/writes these via PSK:

- `folders` — per-Wiki folder record (type always `managed`, owner_type always `workspace`)
- `proposals` — review-mode pending changes
- `proposal_comments` — reserved for future inline comments (not used in MVP)
- `folder_access`, `tokens` — **unused in MVP** by the gateway path; reserved for Phase 2 direct-agent access

Team9 gateway is the sole consumer of folder9 for Wiki purposes in MVP. folder_access is empty for Wiki folders; all permission enforcement happens in the gateway before PSK calls.

### No New Tables (MVP)

- No `wiki_drafts` — drafts live in browser localStorage.
- No `wiki_backlinks_index` — backlinks are future work.
- No `wiki_permissions_overrides` — permissions are flat per role for MVP.

## Permission Model

### MVP: Two Workspace Roles, Three Permission Levels

Every Team9 user in a workspace has one of two role classes:

- **`workspace_human`** — real human member of the workspace
- **`workspace_agent`** — AI agent / bot member of the workspace

Per-Wiki, the creator sets two independent permission knobs:

| Permission | Allowed Actions                                                                              |
| ---------- | -------------------------------------------------------------------------------------------- |
| `read`     | View Wiki in sidebar, browse tree, read page content                                         |
| `propose`  | All of `read`, plus edit → save creates a proposal (never hits main)                         |
| `write`    | All of `propose`, plus save commits directly to main (subject to the Wiki's `approval_mode`) |

The effective permission for a given user on a given Wiki is determined by:

```
effective_perm = user.role === 'agent'
  ? wiki.agent_permission
  : wiki.human_permission
```

Permission enforcement happens in `WikisService` inside the gateway. folder9 is always called with PSK (fully trusted); folder9's own `folder_access` table is empty for Wiki folders in MVP.

### Interaction with `approval_mode`

`approval_mode` is a property of the Wiki (folder-level), orthogonal to permission level:

| user perm | wiki `auto`                    | wiki `review`                                                     |
| --------- | ------------------------------ | ----------------------------------------------------------------- |
| `read`    | cannot edit                    | cannot edit                                                       |
| `propose` | save → creates proposal        | save → creates proposal                                           |
| `write`   | save → direct commit to `main` | save → creates proposal (write does **not** bypass review in MVP) |

> MVP simplification: `write` does not bypass `review` mode. folder9 spec allows it, but the UX is confusing ("why can some users skip review?"). For MVP, `review` means review for everyone with non-`write`+proposal ambiguity removed. Revisit in Phase 2.

### Future Work: Finer Permission Layers

Tracked under [Future Work](#future-work):

- **Team-level permissions:** assign `read` / `propose` / `write` / `admin` to a team (group of users)
- **Individual permissions:** per-user or per-agent override of `read` / `propose` / `write` / `admin`
- The Wiki's permission model becomes layered: individual → team → workspace role → default, with explicit priority
- `admin` role (not yet in MVP) — can change Wiki settings, approve proposals, manage permissions

### MVP Approvers

Since there is no `admin` role in MVP, proposal approval is handled by any user with `write` permission on the Wiki. This is documented as an MVP limitation and will be replaced when the `admin` role lands.

## Wiki Lifecycle

### Creation

- **Who:** any workspace member (human) can create a new Wiki. Agents cannot create Wikis — the controller rejects requests where the JWT identifies an agent with `403 Agents cannot create Wikis`.
- **Entry point:** `+` button in the Wiki sub-sidebar header.
- **Modal fields:** name, slug (auto-derived from name, editable), optional emoji icon.
- **Defaults:** `approval_mode = auto`, `human_permission = write`, `agent_permission = read`.
- **Server flow:**
  1. `POST /api/wikis` validates: workspace membership, caller is human, slug uniqueness within the workspace.
  2. Gateway calls folder9 `POST /api/workspaces/{wsId}/folders` with `type=managed`, `owner_type=workspace`, `approval_mode=auto`.
  3. Gateway inserts a `workspace_wikis` row with the returned `folder9_folder_id`.
  4. If step 3 fails after step 2 succeeds, the gateway calls folder9 `DELETE` to roll back the orphan folder. If the rollback also fails, the orphan is logged for ops cleanup.
  5. Gateway returns the created Wiki DTO.
- **Post-creation:** the client auto-navigates to the new Wiki's empty state, which offers a "Create first page" CTA.

### Default `public` Wiki (Auto-Seed)

- On workspace creation, a Wiki named `public` (slug `public`) is automatically created using the same flow as manual creation.
- A one-time migration script seeds a `public` Wiki into every existing workspace without one.
- `public` has no special flag or privilege — it is simply a Wiki that happens to exist by default. Users can rename, archive, or delete it like any other.

### Archive / Delete

- **MVP:** soft delete via `archived_at`. The Wiki is hidden from the sidebar but its folder9 folder is not destroyed. This preserves history and allows undelete.
- **Hard delete:** not in MVP. Tracked as future work.
- **Archived Wikis list:** visible under Wiki settings → "Archived Wikis", with a "Restore" button.

### Settings

Per-Wiki settings page (reached via gear icon next to the Wiki name in the tree, or kebab menu):

- Rename / change icon / change slug
- Toggle `approval_mode` (`auto` ↔ `review`)
- Edit `human_permission` / `agent_permission`
- Archive

## File Structure & Conventions

### Managed Folder = Wiki

Every Wiki is one folder9 managed folder. Its git repo layout:

```
my-wiki/                         ← folder9 managed folder root
├── index.md                     ← folder-as-page for the root
│   ---
│   icon: "📘"
│   cover: ".team9/covers/hero.jpg"
│   title: "Welcome"
│   ---
│   # Welcome to My Wiki
│
├── getting-started.md
│   ---
│   icon: "🚀"
│   ---
│   # Getting Started
│
├── api/
│   ├── index.md                 ← folder-as-page for api/
│   │   ---
│   │   icon: "📁"
│   │   title: "API Reference"
│   │   ---
│   ├── auth.md
│   └── webhooks.md
│
└── .team9/                      ← hidden from tree UI
    └── covers/
        ├── hero.jpg
        └── api-cover.jpg
```

### YAML Frontmatter Schema

Every page (`.md` file) may begin with a fenced YAML block:

```markdown
---
icon: "📘" # emoji OR relative path to an image in the same repo
cover: ".team9/covers/hero.jpg" # relative path to image file in the same repo
title: "Welcome" # optional, defaults to first H1 or file basename
---

# Page content starts here
```

Fields (all optional):

| Field   | Type   | Description                                                                 |
| ------- | ------ | --------------------------------------------------------------------------- |
| `icon`  | string | A single emoji character, or a repo-relative path to a small image          |
| `cover` | string | Repo-relative path to a cover image in the same folder9 folder              |
| `title` | string | Display title. If absent, falls back to first H1, then to the file basename |

Unknown frontmatter keys are preserved on round-trip but ignored by the UI.

### `index.md` Convention (Folder-as-Page)

When the user clicks a directory node in the tree, the client looks for `index.md` at that path:

- **If present:** render `index.md` as the page content, with its own frontmatter (icon/cover/title)
- **If absent:** render a generated listing of children (as a fallback empty state)

Creating an `index.md` via the "make this folder a page" action is equivalent to writing `index.md` with default frontmatter.

### Hidden `.team9/` Directory

The client's WikiTree component filters out any entry whose path starts with `.team9/` (or any dot-prefixed top-level directory). These files are still accessible by absolute path (so frontmatter `cover: ".team9/covers/hero.jpg"` works), but they don't appear in the tree UI.

### Slug / Path Conventions

- File paths within a Wiki are regular relative paths: `api/auth.md`
- The client URL for a page is `/wiki/:wikiSlug/:pagePath` where `pagePath` is URL-encoded
- The root page is `/wiki/:wikiSlug` (resolves to `index.md`)
- Slugs and file names must match `[A-Za-z0-9._\- /]+`; illegal characters are rejected at commit time

## Frontend Architecture

### Route and Navigation Entry

- **Rename `library` → `wiki` in place.** The sidebar nav entry's `id` becomes `wiki`, `labelKey` becomes `wiki`, and the icon stays the existing `Library` from `lucide-react` (visual continuity). Edit:
  - [apps/client/src/components/layout/MainSidebar.tsx](apps/client/src/components/layout/MainSidebar.tsx): change `{ id: "library", labelKey: "library", icon: Library }` → `{ id: "wiki", labelKey: "wiki", icon: Library }`
  - [apps/client/src/components/layout/mainSidebarUnlock.ts](apps/client/src/components/layout/mainSidebarUnlock.ts): change `"library"` → `"wiki"` in `HIDDEN_NAV_SECTION_IDS`
  - [apps/client/src/i18n/locales/zh-CN/navigation.json](apps/client/src/i18n/locales/zh-CN/navigation.json) and other locales: replace key `library` (`"知识库"`) with key `wiki` (`"知识库"` — same translation)
  - Update tests under [apps/client/src/components/layout/**tests**/](apps/client/src/components/layout/__tests__/) accordingly
- The hidden-nav unlock mechanism stays in place. **MVP keeps the entry hidden** (you tap "More" 5 times to reveal). Phase 2 of [Migration & Rollout](#migration--rollout) removes the hidden flag.
- **Delete the old library route** ([apps/client/src/routes/\_authenticated/library/index.tsx](apps/client/src/routes/_authenticated/library/index.tsx)) and the old `LibraryMainContent` component in the same change. There is nothing else linking to them.
- **New TanStack Router routes** under [apps/client/src/routes/](apps/client/src/routes/):
  - `_authenticated/wiki/index.tsx` — wiki landing (empty state or first wiki)
  - `_authenticated/wiki/$wikiSlug.tsx` — wiki root (loads `index.md`)
  - `_authenticated/wiki/$wikiSlug/$.tsx` — catch-all for nested page paths

### Component Tree

The Wiki section follows Team9's existing layout convention: each top-level nav section provides a `XxxSubSidebar` (in [apps/client/src/components/layout/sidebars/](apps/client/src/components/layout/sidebars/)) and a `XxxMainContent` (in [apps/client/src/components/layout/contents/](apps/client/src/components/layout/contents/)). The layout shell mounts them as siblings — the SubSidebar is **not** nested inside the MainContent.

```
DashboardLayout (existing)
├── MainSidebar                    ← icon nav, includes the new "wiki" entry
├── <WikiSubSidebar>               ← mounted at the layout's sub-sidebar slot when wiki is active
│     ├── <WikiSubHeader>           ← "Wiki" title + "+" new wiki button
│     ├── <WikiList>                ← list of wikis (workspace scope)
│     │     └── <WikiTreeNode>       ← recursive: expandable folder9 folder / dir / file
│     └── <ArchivedWikisLink>        ← link to archived Wikis view
└── <WikiMainContent>              ← mounted at the layout's main content slot when wiki is active
      ├── (no page selected) <WikiEmptyState>
      └── <WikiPageView>
            ├── <WikiCover>            ← cover image band
            ├── <WikiPageHeader>       ← icon + breadcrumb + title + kebab
            ├── <WikiStatusBar>        ← "last saved X · ● Synced/Unsaved" + Save button
            ├── <WikiProposalBanner>   ← shown when page has open proposal
            └── <WikiPageEditor>       ← wraps DocumentEditor + frontmatter state
```

New files created:

- [apps/client/src/components/layout/sidebars/WikiSubSidebar.tsx](apps/client/src/components/layout/sidebars/WikiSubSidebar.tsx)
- [apps/client/src/components/layout/contents/WikiMainContent.tsx](apps/client/src/components/layout/contents/WikiMainContent.tsx)
- Plus subcomponents under a new folder: [apps/client/src/components/wiki/](apps/client/src/components/wiki/) (WikiTreeNode, WikiPageView, WikiPageEditor, WikiCover, WikiPageHeader, WikiStatusBar, WikiProposalBanner, WikiEmptyState, etc.)

Files deleted (Phase 1 of rollout — see [Migration & Rollout](#migration--rollout)):

- [apps/client/src/components/layout/contents/LibraryMainContent.tsx](apps/client/src/components/layout/contents/LibraryMainContent.tsx)
- [apps/client/src/routes/\_authenticated/library/index.tsx](apps/client/src/routes/_authenticated/library/index.tsx)
- Associated tests for LibraryMainContent

### WikiTree Component

- Renders one row per wiki (folder9 folder); expandable.
- When a wiki is expanded, fetches its tree via `GET /api/wikis/:wikiId/tree?path=/&recursive=true`.
- **Important folder9 quirk:** folder9's `recursive=true` returns **files only** (no directory entries). The client must derive directory nodes from file paths: split each `path` on `/` and fold intermediate segments into directory nodes. Empty directories (no files) are therefore invisible — acceptable for MVP since the UI never creates empty folders (creating a "folder" always creates an `index.md` inside it).
- The recursive fetch is acceptable for MVP scale (single Wiki → one network call). Switch to per-directory lazy loading if any Wiki exceeds ~500 entries.
- Filters out entries whose path starts with `.` (hides `.team9/` and any other dot-prefixed dirs).
- Each file node shows its frontmatter icon. Icons are fetched lazily by batching `GET /api/wikis/:wikiId/pages?path=...&fieldsOnly=frontmatter` calls when a directory is first expanded.
- Directory nodes show `📁` by default, or their own `index.md` frontmatter icon if present.
- Click file → navigate to page route.
- Click directory → navigate to directory's `index.md` if present, else show folder landing (an empty state with a "Create index page" CTA).
- Right-click / kebab menu per node: new page, new subfolder (creates `path/<name>/index.md`), delete, rename (rename disabled in MVP with tooltip "coming soon — folder9 endpoint pending").

### WikiPageEditor (Lexical + Frontmatter)

Wraps the existing [apps/client/src/components/documents/DocumentEditor.tsx](apps/client/src/components/documents/DocumentEditor.tsx) with a thin frontmatter layer:

1. On page load, fetch raw markdown via `GET /api/wikis/:wikiId/pages?path=...`.
2. Parse the markdown into two parts:
   - YAML frontmatter block (if present) → stored in React state as `frontmatter: Record<string, unknown>`
   - Remaining markdown body → passed to `DocumentEditor` as `initialContent`
3. On edit, `DocumentEditor` emits a new markdown body; frontmatter state is managed separately (icon picker, cover picker, etc.).
4. Dirty detection: compare current `(body, frontmatter)` against last-saved snapshot.
5. On save:
   - Re-serialize: emit YAML frontmatter block + a blank line + markdown body
   - POST to gateway commit endpoint with the full serialized file content
6. Use `yaml` package (already a common dep) for frontmatter parse/stringify. Unknown keys are preserved.

The frontmatter parse/serialize logic lives in two places that intentionally mirror each other (no shared code path between Node and browser builds in this repo):

- Client: `apps/client/src/lib/wiki-frontmatter.ts`
- Gateway: `apps/server/apps/gateway/src/wikis/utils/frontmatter.ts`

Both implement the same format spec described in [YAML Frontmatter Schema](#yaml-frontmatter-schema). A round-trip test fixture is shared between both via JSON files under `apps/server/libs/shared/test-fixtures/wiki-frontmatter/` so any drift between the two implementations is caught by tests.

Icon and cover are edited via popovers over the header, not in the editor body itself. They mutate the `frontmatter` state and mark the page dirty.

### Draft Persistence (localStorage)

- Key format: `team9.wiki.draft.{workspaceId}.{folder9FolderId}.{pathBase64}.{userId}`
- Value: JSON `{ body: string, frontmatter: object, savedAt: timestamp }`
- Write-debounced 500ms from last edit.
- On page mount, if a draft exists for the user+path pair **and** is newer than the server's last commit, prompt the user: "You have unsaved changes from <relative time>. Restore draft / Discard."
- After a successful save, clear the draft.
- Drafts survive refresh and cross-tab navigation but not across devices. Tracked in [Future Work](#future-work).

### Save Flow

**Common (both modes):**

1. User clicks `Save` (or presses `Cmd+S` / `Ctrl+S`).
2. Editor assembles `{ path, content: serialized(body, frontmatter) }`.
3. Client calls `POST /api/wikis/:wikiId/commit` with:
   ```json
   {
     "message": "<auto-generated or user-typed>",
     "files": [{ "path": "api/auth.md", "content": "...", "action": "update" }]
   }
   ```

**`auto` mode:**

- Auto-generated commit message: `Update api/auth.md` (or `Create ...` / `Delete ...`)
- Request proceeds; on 200, status bar flips to `Synced`, draft cleared.

**`review` mode:**

- Before sending, client opens a small "Submit for review" dialog prompting for `title` and optional `description`.
- Client sends the same commit endpoint with `propose: true`.
- Gateway calls folder9 `POST /api/workspaces/{wsId}/folders/{folderId}/commit` with `propose: true` → folder9 creates a proposal branch + proposal record.
- Response includes the created proposal id; client shows a toast "Submitted for review" and renders a banner at the top of the page with a link to the proposal.
- Draft is **not** cleared until the proposal is approved or rejected (so the user can re-submit if changes are requested). Tracked state: `lastSubmittedProposalId`.

### Review UX

- Each Wiki header has a small `Review` icon with a pending-count badge.
- Clicking opens a list of pending proposals (gateway endpoint `GET /api/wikis/:wikiId/proposals?status=pending`).
- Clicking a proposal opens a read-only proposal view:
  - Summary: title, description, author, created time
  - Diff: file-level unified diff (gateway fetches via folder9 `/diff` endpoint)
  - Action buttons (only for users with `write` perm): `Approve`, `Reject`
  - `Request changes` is not in MVP; tracked as future work
- On approve, gateway calls folder9 `POST /proposals/{pid}/approve`; folder9 merges the proposal branch; webhook `proposal.approved` fires; gateway broadcasts WS event; all clients viewing that Wiki refresh.
- Conflicts (folder9 returns `conflicted: true`) → MVP shows an error toast "This proposal conflicts with the current page. Ask the author to re-base." No in-UI merge tool. Tracked as future work.

### Image Paste / Drop Upload

- The editor listens for paste and drop events.
- On image paste or drop:
  1. Generate filename `.team9/covers/{uuid}.{ext}` (for cover picker) or `attachments/{uuid}.{ext}` (for inline images).
  2. Show a placeholder "Uploading…" inline image node.
  3. Read the file as base64 and call `POST /api/wikis/:wikiId/commit` with `{ files: [{ path, content, encoding: "base64", action: "create" }], message: "Upload image" }`.
  4. On success, replace the placeholder with a regular markdown image node: `![alt](attachments/{uuid}.png)`.
  5. Mark the page dirty so the user's next save includes the reference.
- Uploads are separate commits from page edits. This means uploading an image creates one commit, and saving the page containing the reference creates a second. Acceptable for MVP; de-duplication into a single commit tracked as future work.
- File size limit (MVP): 5 MB per image, enforced client-side. Larger uploads rejected with a toast.

## Backend Architecture (Team9 Gateway)

### New Module: `WikisModule`

New directory: [apps/server/apps/gateway/src/wikis/](apps/server/apps/gateway/src/wikis/)

```
apps/server/apps/gateway/src/wikis/
├── wikis.module.ts
├── wikis.controller.ts          ← REST API for /api/wikis/*
├── wikis.service.ts             ← permission + business logic
├── folder9-client.service.ts    ← typed HTTP client → folder9
├── folder9-webhook.controller.ts ← receives folder9 webhooks
├── dto/
│   ├── create-wiki.dto.ts
│   ├── update-wiki.dto.ts
│   ├── commit-page.dto.ts
│   ├── wiki.dto.ts
│   ├── tree-entry.dto.ts
│   └── proposal.dto.ts
└── __tests__/
    ├── wikis.service.spec.ts
    ├── wikis.controller.spec.ts
    ├── folder9-client.service.spec.ts
    └── folder9-webhook.controller.spec.ts
```

Wired into [apps/server/apps/gateway/src/app.module.ts](apps/server/apps/gateway/src/app.module.ts).

### `Folder9ClientService`

Thin HTTP wrapper around folder9's REST API, used only by `WikisService`. Every request attaches the pre-shared key in the header that folder9's auth middleware expects — verify the exact header name during implementation by reading [folder9's `internal/auth/`](../../../../folder9/internal/auth/) package.

Methods (one per consumed folder9 endpoint):

```ts
class Folder9ClientService {
  createFolder(workspaceId: string, dto: CreateFolderDto): Promise<Folder>;
  getFolder(workspaceId: string, folderId: string): Promise<Folder>;
  updateFolder(
    workspaceId: string,
    folderId: string,
    dto: UpdateFolderDto,
  ): Promise<Folder>;
  deleteFolder(workspaceId: string, folderId: string): Promise<void>;

  getTree(
    workspaceId: string,
    folderId: string,
    opts: { path?: string; recursive?: boolean; ref?: string },
  ): Promise<TreeEntry[]>;
  getBlob(
    workspaceId: string,
    folderId: string,
    path: string,
    ref?: string,
  ): Promise<{ content: string; size: number }>;

  commit(
    workspaceId: string,
    folderId: string,
    dto: CommitDto,
  ): Promise<CommitResult>;

  listProposals(
    workspaceId: string,
    folderId: string,
    opts: { status?: string },
  ): Promise<Proposal[]>;
  getProposal(
    workspaceId: string,
    folderId: string,
    proposalId: string,
  ): Promise<Proposal>;
  getMergePreview(
    workspaceId: string,
    folderId: string,
    proposalId: string,
  ): Promise<MergePreview>;
  approveProposal(
    workspaceId: string,
    folderId: string,
    proposalId: string,
    reviewerId: string,
  ): Promise<void>;
  rejectProposal(
    workspaceId: string,
    folderId: string,
    proposalId: string,
    reviewerId: string,
    reason?: string,
  ): Promise<void>;
}
```

Configuration from environment variables (add to gateway env):

| Variable                 | Description                                           |
| ------------------------ | ----------------------------------------------------- |
| `FOLDER9_API_URL`        | folder9 REST base URL                                 |
| `FOLDER9_PSK`            | Pre-shared key for service-to-service auth            |
| `FOLDER9_WEBHOOK_SECRET` | HMAC secret for verifying incoming webhook signatures |

### `WikisService`

Owns:

- CRUD on `workspace_wikis` table (Drizzle-based, consistent with existing modules)
- Permission enforcement before every mutation / read
- Orchestrating folder9 calls via `Folder9ClientService`
- Mapping folder9 errors to Team9-friendly HTTP errors

Key methods:

```ts
class WikisService {
  listWikis(workspaceId: string, userId: string): Promise<WikiDto[]>;
  createWiki(
    workspaceId: string,
    userId: string,
    dto: CreateWikiDto,
  ): Promise<WikiDto>;
  getWiki(
    workspaceId: string,
    wikiId: string,
    userId: string,
  ): Promise<WikiDto>;
  updateWikiSettings(
    workspaceId: string,
    wikiId: string,
    userId: string,
    dto: UpdateWikiDto,
  ): Promise<WikiDto>;
  archiveWiki(
    workspaceId: string,
    wikiId: string,
    userId: string,
  ): Promise<void>;

  getTree(
    wikiId: string,
    userId: string,
    opts: { path?: string; recursive?: boolean },
  ): Promise<TreeEntryDto[]>;
  getPage(wikiId: string, userId: string, path: string): Promise<PageDto>; // { content, frontmatter, lastCommit }
  commitPage(
    wikiId: string,
    userId: string,
    dto: CommitPageDto,
  ): Promise<CommitResultDto>;

  listProposals(
    wikiId: string,
    userId: string,
    opts?: { status?: string },
  ): Promise<ProposalDto[]>;
  approveProposal(
    wikiId: string,
    proposalId: string,
    userId: string,
  ): Promise<void>;
  rejectProposal(
    wikiId: string,
    proposalId: string,
    userId: string,
    reason?: string,
  ): Promise<void>;
}
```

### Permission Helper

```ts
function resolveWikiPermission(
  wiki: WikiRow,
  user: { id: string; isAgent: boolean },
): "read" | "propose" | "write" | null {
  return user.isAgent ? wiki.agentPermission : wiki.humanPermission;
}

function requirePermission(
  wiki: WikiRow,
  user: { id: string; isAgent: boolean },
  required: "read" | "propose" | "write",
): void {
  const actual = resolveWikiPermission(wiki, user);
  const order = { read: 0, propose: 1, write: 2 };
  if (!actual || order[actual] < order[required]) {
    throw new ForbiddenException(`Wiki permission '${required}' required`);
  }
}
```

### Commit Handling: auto vs review

`WikisService.commitPage()` logic:

```ts
async commitPage(wikiId, userId, dto) {
  const wiki = await this.loadWiki(wikiId)
  const user = await this.loadUser(userId)
  const required = wiki.approvalMode === 'auto' && !dto.propose ? 'write' : 'propose'
  requirePermission(wiki, user, required)

  // If user only has propose perm, or the wiki is in review mode, force propose=true
  const effectivePropose =
    dto.propose === true ||
    wiki.approvalMode === 'review' ||
    resolveWikiPermission(wiki, user) === 'propose'

  return this.folder9.commit(workspaceId, wiki.folder9FolderId, {
    ...dto,
    propose: effectivePropose,
  })
}
```

### Webhook Receiver: `Folder9WebhookController`

folder9 sends webhook events to the gateway. The gateway:

1. Verifies the `X-Folder9-Signature` HMAC against `FOLDER9_WEBHOOK_SECRET`.
2. Looks up the Team9 Wiki by `folder_id`.
3. Re-broadcasts the event on the Team9 WebSocket gateway to all members of the workspace who currently have that Wiki open.

Events handled in MVP:

| folder9 event        | Team9 WS event           | Client behavior                                                            |
| -------------------- | ------------------------ | -------------------------------------------------------------------------- |
| `proposal.created`   | `wiki_proposal_created`  | Bump proposals badge count                                                 |
| `proposal.approved`  | `wiki_proposal_approved` | Refresh affected page; clear `lastSubmittedProposalId` for affected drafts |
| `proposal.rejected`  | `wiki_proposal_rejected` | Clear `lastSubmittedProposalId`; show toast                                |
| `ref.updated` (main) | `wiki_page_updated`      | Refresh tree and any open page from that Wiki                              |

Events `comment.created`, `proposal.changes_requested`, `proposal.updated` are received but ignored in MVP (logged for observability).

### Auto-Seed `public` Wiki on Workspace Creation

Workspace creation currently lives in [apps/server/apps/gateway/src/workspace/](apps/server/apps/gateway/src/workspace/). Add a post-creation hook (in the existing service) that calls `WikisService.createWiki(workspaceId, creatorId, { name: 'public', slug: 'public' })`.

If the call fails, log the error but do **not** fail workspace creation — log and surface to ops. An on-demand "create missing public Wiki" admin action is tracked as future work.

### Migration for Existing Workspaces

A standalone script under [apps/server/apps/gateway/src/wikis/scripts/](apps/server/apps/gateway/src/wikis/scripts/):

```
backfill-public-wiki.ts
```

Iterates every workspace, and for any without an existing `public` Wiki, calls `WikisService.createWiki` using the workspace's owner as `created_by`. Idempotent (safe to re-run).

## API Contract (Gateway → Client)

All endpoints require JWT auth (existing `JwtAuthGuard`). All mutations check workspace membership + Wiki permission.

### Wiki CRUD

```
GET    /api/wikis                              List all non-archived Wikis in current workspace
POST   /api/wikis                              Create a new Wiki
       Body: { name, slug?, icon?, approvalMode?, humanPermission?, agentPermission? }
GET    /api/wikis/:wikiId                      Get one Wiki's metadata
PATCH  /api/wikis/:wikiId                      Update name/slug/icon/approvalMode/permissions
DELETE /api/wikis/:wikiId                      Soft-archive (sets archived_at)
```

### Page / Tree Access

```
GET    /api/wikis/:wikiId/tree?path=/&recursive=true
       Response: TreeEntry[] (folder9 shape, minus .team9/ if the query flag `includeHidden`=false, default false)

GET    /api/wikis/:wikiId/pages?path=api/auth.md
       Response: { path, content, frontmatter, lastCommit: { sha, author, timestamp } }
       (gateway parses frontmatter out of the raw markdown; client gets both halves separately)

POST   /api/wikis/:wikiId/commit
       Body: { message, files: CommitFile[], propose?: boolean }
       Response: { commit: { sha }, proposal?: { id, status } }
```

### Proposals

```
GET    /api/wikis/:wikiId/proposals?status=pending
POST   /api/wikis/:wikiId/proposals/:proposalId/approve
POST   /api/wikis/:wikiId/proposals/:proposalId/reject
       Body: { reason?: string }
GET    /api/wikis/:wikiId/proposals/:proposalId/diff
       Response: file-level unified diff (via folder9 `/diff`)
```

### Webhook In (folder9 → Gateway)

```
POST   /api/folder9/webhook
       Headers: X-Folder9-Signature
       Body: folder9 webhook payload (see folder9 spec)
```

### WebSocket Events (Gateway → Client)

Emitted on the existing Team9 Socket.io connection, scoped per workspace:

```
wiki_created          { wikiId, name }
wiki_updated          { wikiId, fields }
wiki_archived         { wikiId }
wiki_page_updated     { wikiId, path, sha }
wiki_proposal_created { wikiId, proposalId, authorId }
wiki_proposal_approved { wikiId, proposalId }
wiki_proposal_rejected { wikiId, proposalId }
```

## Testing Strategy

Following the project rule (CLAUDE.md): 100% test coverage on new code, covering happy path + bad cases + integration.

### Backend (Gateway)

- **Unit tests** (`__tests__/`):
  - `WikisService` permission enforcement for every method × role × approval_mode combination
  - `Folder9ClientService` with a mocked HTTP client, verifying request shapes and error propagation
  - Webhook signature verification (valid, invalid, missing, tampered)
  - Frontmatter parse/serialize round-trip (incl. unknown keys preserved, no frontmatter, malformed YAML)
- **Integration tests**:
  - Full controller → service → (mocked folder9) flow for Wiki CRUD, commit, propose, approve
  - Workspace creation hook seeds `public` Wiki (mock folder9)
  - Migration script is idempotent (run twice, second run is a no-op)
- **Bad cases:**
  - Non-member calls Wiki API → 403
  - User with `read` tries to commit → 403
  - User with `propose` commits in `auto` mode → still creates a proposal (forced)
  - Commit with illegal path (`../escape`, absolute path, too long) → 400
  - Commit with oversized image (>5 MB) → 413
  - Approve a proposal the user has no `write` perm on → 403
  - Approve an already-approved proposal → folder9 error mapped to 409
  - Webhook with bad signature → 401
  - Race: two users commit the same file simultaneously (conflict) → last one wins in auto mode, surfaces conflict error in review mode

### Frontend

- **Unit tests** (Vitest + React Testing Library):
  - `WikiTree` renders given a folder9 tree response; hides `.team9/`; expands/collapses; calls navigation on click
  - `WikiPageEditor` parses frontmatter into state, re-serializes on save, detects dirty state
  - Draft localStorage write/read cycle; stale-draft prompt triggers when server is newer
  - Image paste handler uploads and replaces placeholder
  - Save button disabled when not dirty; disabled when user lacks permission; loads spinner while pending
- **Integration / page tests:**
  - New-wiki-creation flow: modal → POST → navigate to new wiki
  - Page edit → save in auto mode → status bar shows "Synced"
  - Page edit → save in review mode → modal for title → banner appears with link to proposal
  - Approve a proposal → page refreshes to new content
  - WebSocket `wiki_page_updated` received while editing → non-destructive prompt to reload
- **Bad cases:**
  - User with `read` perm sees editor in readonly mode, no Save button
  - User with `propose` perm in `auto` mode still sees "Submit for review" flow (no direct save)
  - Network failure during save → retains draft, shows retry
  - Invalid frontmatter on load → falls back to empty frontmatter + shows a subtle warning
  - Oversized image → toast error, no upload attempted

### Folder9 Integration Tests

A new test suite in the gateway's integration layer hits a **real folder9 instance** (docker-compose) end-to-end, exercising:

- Create Wiki → folder9 folder exists, repo initialized
- Commit page → folder9 returns commit, content round-trips
- Propose commit → folder9 creates a proposal branch; gateway reads the proposal list
- Approve → folder9 merges; next `getPage` returns new content
- Webhook → folder9 fires `ref.updated`; gateway receives it, WS event observed

## Migration & Rollout

### Phase 1: Merge-in (feature hidden)

1. Land all backend code + new module, tests green.
2. Land frontend code behind the existing hidden-nav mechanism (users need to tap "More" 5 times to reveal). The nav entry is renamed from `library` to `wiki` at the same time.
3. Seed the `public` Wiki on every workspace creation going forward.
4. Run `backfill-public-wiki.ts` against production to seed existing workspaces.
5. Internal dogfood.

### Phase 2: Promote

1. Remove `wiki` from `HIDDEN_NAV_SECTION_IDS` in [apps/client/src/components/layout/mainSidebarUnlock.ts](apps/client/src/components/layout/mainSidebarUnlock.ts).
2. Announce to users.
3. Leave Library entry removed (it was hidden anyway; no user impact).

### Phase 3: Retire `documents` module

Out of scope for this spec. Will be planned separately once Wiki is stable.

## Open Questions (to discuss, not blocking MVP)

### Backlinks Index Location

When backlinks / `team9://` URI / `@mention` ships in a future phase, where should the reverse-index live?

- **Option A — Team9 gateway owns it:** Gateway subscribes to folder9 `ref.updated` / `proposal.approved`, fetches changed files, parses `team9://` URIs, maintains a `wiki_page_references` table. Pros: integrates with existing query layer, cross-Wiki joins work. Cons: adds state to maintain in two places.
- **Option B — folder9 owns it:** folder9 maintains an index per folder (or cross-folder). Pros: single source of truth, git-backed. Cons: introduces Team9 semantics into folder9, which is currently content-agnostic.
- **Option C — Client computes lazily:** No server-side index. Client scans same-folder files on page open. Pros: zero new state. Cons: doesn't scale past a few hundred pages; no cross-folder.

**Current lean:** Option A, but revisit when backlinks are actually scheduled. **No code in MVP depends on this decision.**

### `write` Bypassing `review`

folder9 spec allows `write` permission to bypass `review` approval mode. This MVP disables that for UX clarity (review means review for everyone). Revisit if product wants an explicit "trusted editor" role.

### Commit Attribution Model

Every commit made via the gateway is currently authored as the Team9 user (user id + display name threaded into the folder9 commit author field). Is there a case where a commit should be attributed to a service account or the workspace itself? For MVP: always the acting user.

## Future Work

Grouped list of everything deferred out of MVP. Each item may become its own spec later.

### Wiki features

- **Backlinks / page references:** `team9://` URI scheme, `@mention` in pages, custom Lexical node + transformer, reverse-index (see Open Question above)
- **Full-text search:** across all Wikis in a workspace
- **Block-level database views:** table / board / calendar of pages driven by frontmatter
- **Inline comments on `main`:** select a range → comment; threaded discussions not tied to proposals
- **Page templates:** "Create page from template"
- **Version history per page:** visual UI over folder9's `/log` endpoint
- **Export:** download a Wiki as zip / PDF

### Editing UX

- **Drag-to-reorder** files and folders in the tree (requires folder9 rename/move endpoint)
- **Rename file / folder** UI (requires folder9 rename/move endpoint)
- **Server-side draft persistence** (`wiki_drafts` table) so drafts follow the user across devices
- **Multi-round proposal revisions** (`changes_requested` state flow)
- **Three-way merge conflict resolution UI**
- **Bundle image upload + page save into one commit** instead of two
- **Cover image crop / focal point** picker
- **Icon picker upgrade:** custom image icons, not just emoji

### Permission system

- **Team-level permissions:** assign `read` / `propose` / `write` / `admin` to a team
- **Individual permissions:** per-user or per-agent overrides with a clear priority order (individual > team > workspace role > default)
- **`admin` role:** dedicated approver role separate from `write`
- **`write` bypasses `review`** flag (product decision pending)

### Workspace / lifecycle

- **Hard-delete Wikis** (removes folder9 folder and local pointer)
- **Un-archive / restore** UI
- **On-demand "create missing public Wiki"** admin action
- **Audit log** of permission changes and proposal actions

### folder9 enhancements we depend on

- **Rename / move file** endpoint (`PATCH /files?from=a&to=b`)
- **Rename / move folder** endpoint
- **Multipart file upload** for large binaries (current JSON + base64 path is fine for wiki-scale)
- **Zip upload / bulk import** for migrating existing content
- **Per-file tree metadata:** last commit author + timestamp returned in `/tree` response (to avoid N+1 log calls from the sidebar)
- **Structured tree `recursive=true`** that returns directories as well (current behavior only returns files when recursive)

### Replacement of existing Library / `documents`

- Design a migration path from `documents` rows into a dedicated "internal" Wiki (or keep them as task_instruction / bot_notes only)
- Retire the `documents` controller and UI
- Move any task_instruction references to the new Wiki pages API

## References

- [folder9 service spec](../../../../folder9)
- [folder9 design document](./2026-04-07-folder9-managed-folders-design.md)
- [Existing DocumentEditor (Lexical)](../../../apps/client/src/components/documents/DocumentEditor.tsx)
- [Existing LibraryMainContent (to be replaced)](../../../apps/client/src/components/layout/contents/LibraryMainContent.tsx)
- [Main sidebar unlock mechanism](../../../apps/client/src/components/layout/mainSidebarUnlock.ts)
- [Workspace module (where workspace creation hook goes)](../../../apps/server/apps/gateway/src/workspace/)
