# Folder9: Managed Folder Service Design

> Date: 2026-04-07
> Status: Draft
> Author: Winrey + Claude

## Overview

Folder9 is a standalone file hosting service providing versioned file management for AI agents and human users. Built as an independent Go project, it exposes REST API, Git HTTP protocol, and WebDAV protocol.

**Core Capabilities:**

- AI agents store and retrieve files via Git or REST API
- Human users browse, edit, and manage files through Web UI
- Managed Folders provide version control and approval workflow (Git-backed)
- Light Directories provide simple bidirectional file sync (WebDAV)
- WebDAV mounting for filesystem-like access
- CLI client and daemon for local sync

**Endpoints (configured via environment variables):**

| Variable          | Example (production)          | Purpose           |
| ----------------- | ----------------------------- | ----------------- |
| `FOLDER9_API_URL` | `https://folder.team9.ai`     | REST API + WebDAV |
| `FOLDER9_GIT_URL` | `https://git.folder.team9.ai` | Git HTTP protocol |

All URLs below use `FOLDER9_API_URL` and `FOLDER9_GIT_URL` as placeholders. Actual values differ per environment (dev, staging, production).

## Two Folder Types

|                    | Managed Folder                  | Light Directory                     |
| ------------------ | ------------------------------- | ----------------------------------- |
| Backend            | Git bare repo                   | Plain file directory                |
| Version control    | Full git history                | None                                |
| Proposals / review | PR model                        | None                                |
| WebDAV             | Read-only                       | Bidirectional read/write            |
| Git protocol       | clone / pull / push             | Not supported                       |
| Permissions        | read / write / propose / admin  | Token-scoped access                 |
| Use cases          | Wiki, config, important content | Agent workspace, temp files, drafts |

## Architecture

### Standalone Service

Folder9 is deployed as an independent Go service, separate from Team9 Gateway.

```
┌──────────────────────────────────────────────────────────────┐
│                        folder9                                │
│                                                              │
│  ┌─────────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │   REST API       │  │  Git HTTP    │  │   WebDAV       │  │
│  │   /api/*         │  │  Server      │  │   Server       │  │
│  │                  │  │              │  │   /dav/*       │  │
│  └────────┬─────────┘  └──────┬───────┘  └───────┬────────┘  │
│           │                   │                   │           │
│  ┌────────┴───────────────────┴───────────────────┴────────┐ │
│  │                    Core Service Layer                     │ │
│  │  - Folder management   - Git ops (go-git)                │ │
│  │  - Proposal lifecycle  - Webhook dispatch                │ │
│  │  - Auth / tokens       - Permission enforcement          │ │
│  └────────┬───────────────────┬────────────────────────────┘ │
│           │                   │                              │
│  ┌────────┴────────┐  ┌──────┴──────────┐                   │
│  │   PostgreSQL     │  │  /data/ (volume) │                   │
│  │   metadata/state │  │  repos/ + dirs/  │                   │
│  └─────────────────┘  └─────────────────┘                   │
└──────────────────────────────────────────────────────────────┘
```

### Technology

- **Language:** Go
- **Git operations:** go-git (pure Go, no git CLI dependency)
- **WebDAV:** golang.org/x/net/webdav
- **HTTP framework:** chi (consistent with file-keeper)
- **Database:** PostgreSQL
- **Storage:** Mounted volume, injected at deploy time (Railway Volume / EFS / k8s PVC / etc.)

### Storage Layout

```
/data/
├── repos/                                    # Managed Folder bare repos
│   ├── {workspaceId}/
│   │   ├── {folderId}.git/
│   │   └── ...
│   └── ...
└── dirs/                                     # Light Directory files
    ├── {workspaceId}/
    │   ├── {folderId}/
    │   │   ├── file.md
    │   │   └── ...
    │   └── ...
    └── ...
```

Storage is designed as a mount path, not tied to any specific cloud provider. The backing store is injected per environment via PVC (k8s), Volume (Railway), or EFS (AWS). Application code is agnostic.

## Authentication

### Three-Tier Model

| Tier                   | Method                           | Consumer                  | Scope                                                    |
| ---------------------- | -------------------------------- | ------------------------- | -------------------------------------------------------- |
| **Service-to-service** | Pre-shared key (header)          | Team9 Gateway             | Full access (management, token issuance, proxy)          |
| **Direct access**      | Opaque token (PostgreSQL-backed) | Agent / user              | Per-folder, specific permission, optional TTL            |
| **Proxied**            | Agent's existing credentials     | Agent (via Team9 Gateway) | Gateway authenticates, then forwards with pre-shared key |

### Token Design

Format: `f9_` + 32 random characters (~35 chars total). Stored in PostgreSQL.

**`tokens` table:**

| Column       | Type      | Description                                                  |
| ------------ | --------- | ------------------------------------------------------------ |
| `id`         | UUID      | Primary key                                                  |
| `token`      | string    | `f9_` + 32 chars, unique index                               |
| `folder_id`  | UUID      | Associated folder                                            |
| `permission` | enum      | `read` / `write` / `propose` / `admin`                       |
| `name`       | string    | Purpose description (e.g. "Research Agent long-term access") |
| `expires_at` | timestamp | Nullable — null means never expires                          |
| `revoked_at` | timestamp | Nullable — non-null means revoked                            |
| `created_by` | string    | Issuer identifier                                            |
| `created_at` | timestamp |                                                              |

Validation: `WHERE token = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`

Two usage patterns:

- **Temporary token:** `expires_at` set to N hours, auto-expires after task
- **Persistent token:** `expires_at = NULL`, valid until manually revoked

### Permission Levels

| Permission | Managed Folder                                       | Light Directory             |
| ---------- | ---------------------------------------------------- | --------------------------- |
| `read`     | Read files, view proposals                           | Read files                  |
| `propose`  | Push to `proposal/*` branches only, create proposals | N/A (treated as write)      |
| `write`    | Push directly to `main` + all propose capabilities   | Read and write files        |
| `admin`    | All above + manage folder settings, access, tokens   | All above + manage settings |

Key distinction: `propose` allows agents to submit changes for review without direct write access to `main`. `write` grants direct modification of `main` (bypasses review even in `review` mode).

## Data Model

### `folders` table

| Column          | Type      | Description                      |
| --------------- | --------- | -------------------------------- |
| `id`            | UUID      | Primary key                      |
| `name`          | string    | Folder display name              |
| `type`          | enum      | `managed` / `light`              |
| `owner_type`    | enum      | `agent` / `workspace`            |
| `owner_id`      | string    | Agent ID or workspace ID         |
| `workspace_id`  | string    | Parent workspace                 |
| `approval_mode` | enum      | `auto` / `review` (managed only) |
| `created_at`    | timestamp |                                  |
| `updated_at`    | timestamp |                                  |

### `folder_access` table

| Column           | Type   | Description                            |
| ---------------- | ------ | -------------------------------------- |
| `id`             | UUID   | Primary key                            |
| `folder_id`      | UUID   | Associated folder                      |
| `principal_type` | enum   | `agent` / `user`                       |
| `principal_id`   | string | Grantee identifier                     |
| `permission`     | enum   | `read` / `write` / `propose` / `admin` |

### `proposals` table (managed folders only)

| Column        | Type      | Description                                               |
| ------------- | --------- | --------------------------------------------------------- |
| `id`          | UUID      | Primary key                                               |
| `folder_id`   | UUID      | Associated folder                                         |
| `branch_name` | string    | Git branch (e.g. `proposal/xxx`)                          |
| `title`       | string    | Change title (from commit message)                        |
| `description` | text      | Change description                                        |
| `status`      | enum      | `pending` / `changes_requested` / `approved` / `rejected` |
| `author_type` | enum      | `agent` / `user`                                          |
| `author_id`   | string    | Submitter ID                                              |
| `reviewed_by` | string    | Reviewer ID (nullable)                                    |
| `reviewed_at` | timestamp | Nullable                                                  |
| `created_at`  | timestamp |                                                           |

### `proposal_comments` table

| Column        | Type      | Description                                              |
| ------------- | --------- | -------------------------------------------------------- |
| `id`          | UUID      | Primary key                                              |
| `proposal_id` | UUID      | Associated proposal                                      |
| `author_id`   | string    | Commenter ID                                             |
| `author_type` | enum      | `user` / `agent`                                         |
| `body`        | text      | Comment content                                          |
| `file_path`   | string    | Nullable — file-level comment                            |
| `line_start`  | int       | Nullable — start line                                    |
| `line_end`    | int       | Nullable — end line (multi-line selection)               |
| `commit_id`   | string    | Commit SHA this comment targets (for stable positioning) |
| `created_at`  | timestamp |                                                          |

## API Design

### Management API (service-to-service, pre-shared key auth)

```
# Folder management
POST   /api/workspaces/{wsId}/folders                     # Create folder
GET    /api/workspaces/{wsId}/folders                     # List folders
GET    /api/workspaces/{wsId}/folders/{id}                # Get folder details
PATCH  /api/workspaces/{wsId}/folders/{id}                # Update settings
DELETE /api/workspaces/{wsId}/folders/{id}                # Delete folder (+ repo/dir)

# Access management
POST   /api/workspaces/{wsId}/folders/{id}/access         # Grant access
DELETE /api/workspaces/{wsId}/folders/{id}/access/{aId}   # Revoke access
GET    /api/workspaces/{wsId}/folders/{id}/access         # List permissions

# Token management
POST   /api/tokens                                        # Issue token
GET    /api/tokens/{token}                                # Token info (ownership, scope, expiry)
DELETE /api/tokens/{token}                                 # Revoke token
GET    /api/tokens?folder_id={id}                         # List tokens for a folder

# Webhook management
POST   /api/webhooks                                      # Register webhook URL
GET    /api/webhooks                                      # List registered webhooks
PATCH  /api/webhooks/{id}                                 # Update webhook (URL, events filter)
DELETE /api/webhooks/{id}                                  # Remove webhook
```

### Relationship Between `folder_access` and `tokens`

These are two independent authorization mechanisms for different access paths:

- **`folder_access`:** Identity-based. Used when requests come through Team9 Gateway (proxied path). Gateway authenticates the agent/user, then folder9 checks `folder_access` to determine permission level.
- **`tokens`:** Credential-based. Used for direct access to folder9. Each token carries its own permission scope. Not tied to `folder_access` entries.

When Team9 issues a token for an agent, it should set the token's permission to match (or be more restrictive than) what the agent has in `folder_access`.

### File Operations API (token auth)

```
# Browse files (reads from main or specified ref)
GET    /api/workspaces/{wsId}/folders/{id}/tree?ref=main&path=/
GET    /api/workspaces/{wsId}/folders/{id}/blob?ref=main&path=/readme.md
GET    /api/workspaces/{wsId}/folders/{id}/raw?ref=main&path=/image.png

# Commit changes (managed folders)
POST   /api/workspaces/{wsId}/folders/{id}/commit
       Body: {
         message: string,
         files: [{ path, content, encoding?: "base64", action: "create"|"update"|"delete" }]
       }
       → approval_mode=auto + write permission: commit to main
       → approval_mode=review OR propose permission: create proposal

# History (managed folders)
GET    /api/workspaces/{wsId}/folders/{id}/log?ref=main&path=/
GET    /api/workspaces/{wsId}/folders/{id}/diff?from=main&to=proposal/xx

# File operations (light directories)
PUT    /api/workspaces/{wsId}/folders/{id}/files?path=/readme.md    # Write file
DELETE /api/workspaces/{wsId}/folders/{id}/files?path=/readme.md    # Delete file
POST   /api/workspaces/{wsId}/folders/{id}/files?action=mkdir&path=/docs  # Create dir
```

### Proposal API (token auth, managed folders)

```
GET    /api/workspaces/{wsId}/folders/{id}/proposals
GET    /api/workspaces/{wsId}/folders/{id}/proposals/{pid}

# Merge preview (three-way merge info)
GET    /api/workspaces/{wsId}/folders/{id}/proposals/{pid}/merge-preview
       → { conflicted: bool, files: [{ path, status, base, ours, theirs, merged }] }

# Approve (with optional conflict resolution)
POST   /api/workspaces/{wsId}/folders/{id}/proposals/{pid}/approve
       Body: { resolved_files?: [{ path, content }] }

# Reject
POST   /api/workspaces/{wsId}/folders/{id}/proposals/{pid}/reject
       Body: { reason?: string }

# Request changes (sets status to changes_requested + creates comments)
POST   /api/workspaces/{wsId}/folders/{id}/proposals/{pid}/request-changes
       Body: { comments: [{ body, file_path?, line_start?, line_end? }] }

# Comments
POST   /api/workspaces/{wsId}/folders/{id}/proposals/{pid}/comments
       Body: { body, file_path?, line_start?, line_end?, commit_id? }
GET    /api/workspaces/{wsId}/folders/{id}/proposals/{pid}/comments
```

### Git HTTP Protocol

```
Endpoint: {FOLDER9_GIT_URL}/{wsId}/{folderId}
Also:     {FOLDER9_API_URL}/git/{wsId}/{folderId}
Auth: HTTP Basic (username=anything, password=token)

Supported operations: clone, fetch, pull, push
```

Server-side hook behavior on push:

| approval_mode | Permission        | Push target  | Behavior                         |
| ------------- | ----------------- | ------------ | -------------------------------- |
| `auto`        | `write`           | `main`       | Allow, commit directly           |
| `auto`        | `propose`         | `main`       | Reject with guidance             |
| `auto`        | `write`/`propose` | `proposal/*` | Allow, auto-approve + merge      |
| `review`      | `write`           | `main`       | Allow (write bypasses review)    |
| `review`      | `propose`         | `main`       | Reject with guidance             |
| `review`      | `propose`         | `proposal/*` | Allow, create proposal (pending) |

### WebDAV

```
Endpoint: {FOLDER9_API_URL}/dav/{wsId}/{folderId}/
Auth: Bearer token or HTTP Basic (password=token)

Managed Folder: read-only (GET, PROPFIND)
Light Directory: read-write (GET, PUT, DELETE, MKCOL, PROPFIND)
```

### Ref Query API (for polling / sync)

```
GET    /api/workspaces/{wsId}/folders/{id}/refs/main
       → { commit: "abc123", updated_at: "2026-04-07T..." }
```

## AI Agent Interaction

### Agent Access Paths

```
Path 1: Agent → Team9 Gateway (existing agent auth) → folder9 (pre-shared key)
Path 2: Agent → folder9 directly (scoped token, issued by Team9 on behalf)
```

Team9 issues scoped folder9 tokens when assigning tasks to agents. Agents receive a token + endpoint URL as part of their task context.

### Context Injection

When Team9 dispatches a task to an agent, it injects folder access info into the system prompt or tool description:

```
You have access to the following managed folders:

- wiki (ID: xxx): git repo, approval_mode: review
  Git URL: {FOLDER9_GIT_URL}/{wsId}/xxx
  Token: f9_a3xK9mW2pQ7...
  Instructions: Push to proposal/* branches to submit change proposals.
    Human will review. See {FOLDER9_API_URL}/skill.md for full guide.

- scratch (ID: yyy): light directory
  WebDAV: {FOLDER9_API_URL}/dav/{wsId}/yyy/
  Token: f9_b7kM2nR4sT8...
  Instructions: Read and write freely via WebDAV.
```

### Git Workflow (managed folder, review mode)

```bash
git clone https://x-token:f9_xxx@{FOLDER9_GIT_URL}/{wsId}/{folderId} my-wiki
cd my-wiki
git checkout -b proposal/add-getting-started-guide
# edit files...
git commit -m "Add getting started guide for new users"
git push origin proposal/add-getting-started-guide
```

### API Workflow (managed folder)

```json
POST /api/workspaces/{wsId}/folders/{id}/commit
{
  "message": "Add getting started guide for new users",
  "files": [
    { "path": "getting-started.md", "content": "# Getting Started\n...", "action": "create" },
    { "path": "images/screenshot.png", "content": "<base64>", "encoding": "base64", "action": "create" }
  ]
}
```

## AI-Friendly Error Responses

All denial responses (403, 422, etc.) return structured guidance so LLMs know exactly why the action failed and what to do next:

```json
{
  "error": "PROTECTED_BRANCH",
  "message": "Cannot push directly to main. This folder requires review.",
  "guidance": {
    "reason": "approval_mode is 'review' and your token has 'propose' permission. Changes must go through a proposal.",
    "next_steps": [
      "Push to a proposal branch instead: git push origin proposal/<descriptive-name>",
      "A proposal will be created automatically for human review",
      "Example: git checkout -b proposal/update-docs && git push origin proposal/update-docs"
    ],
    "docs": "{FOLDER9_API_URL}/skill.md#proposals"
  }
}
```

```json
{
  "error": "WEBDAV_READ_ONLY",
  "message": "WebDAV access to managed folders is read-only.",
  "guidance": {
    "reason": "Managed folders use Git for version control. WebDAV is provided for read-only mounting.",
    "next_steps": [
      "Use Git to make changes: git clone {FOLDER9_GIT_URL}/{wsId}/{folderId}",
      "Or use REST API: POST /api/workspaces/{wsId}/folders/{folderId}/commit",
      "See {FOLDER9_API_URL}/skill.md for examples"
    ],
    "docs": "{FOLDER9_API_URL}/skill.md"
  }
}
```

```json
{
  "error": "INSUFFICIENT_PERMISSION",
  "message": "Token has 'read' permission, but 'write' or 'propose' is required.",
  "guidance": {
    "reason": "Your current token only grants read access to this folder.",
    "next_steps": [
      "Request a write or propose token from your platform administrator"
    ],
    "docs": "{FOLDER9_API_URL}/skill.md#authentication"
  }
}
```

### skill.md

`{FOLDER9_API_URL}/skill.md` serves as an **AI-readable operation manual**, written for LLMs (concise, structured, example-rich). Agents can fetch this file for a complete guide to folder9 operations.

## Human Approval Workflow

### Proposal Lifecycle (PR model)

```
1. Agent pushes to proposal/* branch
              ↓
2. folder9 creates proposal record (status: pending)
              ↓
3. folder9 sends webhook to Team9
              ↓
4. Team9 notifies user (WebSocket / notification)
              ↓
5. User reviews in Web UI:
   - Views changed files and diff
   - Leaves comments (file-level or line-level)
   - Approves, rejects, or requests changes
              ↓
6a. Approve → folder9 merges proposal branch to main, deletes branch
6b. Reject → folder9 deletes branch, records reason
6c. Request changes → status becomes changes_requested
              ↓ (if 6c)
7. folder9 webhook notifies Team9
              ↓
8. Team9 dispatches revision task to agent
              ↓
9. Agent reads comments from folder9 API
              ↓
10. Agent pushes new commits to same proposal branch
              ↓
11. Back to step 3 (new review round)
```

### Status Machine

```
pending → changes_requested → pending → ... → approved
                                          └→ rejected
```

### Three-Way Merge

When approving a proposal that conflicts with current `main`:

```
GET /api/workspaces/{wsId}/folders/{id}/proposals/{pid}/merge-preview
→ {
    conflicted: true,
    files: [{
      path: "docs/guide.md",
      status: "conflicted",
      base: "...",           // common ancestor
      ours: "...",           // main branch version
      theirs: "...",         // proposal branch version
      merged: null           // null when conflicted
    }]
  }
```

User resolves conflicts in Web UI, then approves with resolved content:

```
POST .../proposals/{pid}/approve
Body: { resolved_files: [{ path: "docs/guide.md", content: "resolved content..." }] }
```

### Webhook Events

folder9 sends webhooks on key events. Signed with pre-shared key (HMAC-SHA256).

```json
POST {webhook_url}
X-Folder9-Signature: sha256=...

{
  "event": "proposal.created",
  "folder_id": "xxx",
  "workspace_id": "wsId",
  "proposal_id": "yyy",
  "author": { "type": "agent", "id": "zzz" },
  "title": "Add getting started guide",
  "timestamp": "2026-04-07T..."
}
```

Event types:

- `proposal.created` — new proposal submitted
- `proposal.updated` — new commits pushed to proposal branch
- `proposal.approved` — proposal merged
- `proposal.rejected` — proposal rejected
- `proposal.changes_requested` — reviewer requested changes
- `ref.updated` — a branch ref changed (useful for sync)
- `comment.created` — new comment on a proposal

## CLI Client and Daemon

### CLI (`folder9`)

Single Go binary. Provides both interactive and scriptable access.

```bash
# Auth (token stored in ~/.folder9/config.json)
folder9 auth login --token f9_xxx                          # direct token
folder9 auth login --token f9_xxx --endpoint https://...   # with custom endpoint
# Default endpoint: configurable, falls back to FOLDER9_API_URL env var

# Token info
folder9 auth whoami                                        # show current token ownership, scope, expiry
folder9 token info f9_xxx                                  # query any token's details

# Browse
folder9 ls {wsId}/{folderId}                               # list files
folder9 tree {wsId}/{folderId}                             # file tree
folder9 cat {wsId}/{folderId} path/to/file.md              # read file

# Pull (download to local)
folder9 pull {wsId}/{folderId} ./local-dir                 # one-time pull
folder9 pull {wsId}/{folderId} ./local-dir --watch         # pull + register for daemon tracking

# Push (upload from local)
folder9 push ./local-dir {wsId}/{folderId}                         # auto mode: direct commit
folder9 push ./local-dir {wsId}/{folderId} --propose               # create proposal
       --title "Update wiki" --message "Restructured docs"

# Proposals
folder9 proposals ls {wsId}/{folderId}
folder9 proposals diff {wsId}/{folderId} {proposalId}
folder9 proposals approve {wsId}/{folderId} {proposalId}
folder9 proposals reject {wsId}/{folderId} {proposalId}

# All commands support inline token override:
folder9 ls {wsId}/{folderId} --token f9_other_token
```

All commands support `--help` with clear descriptions, examples, and common error resolutions.

### Daemon Mode (`folder9 daemon`)

Keeps local directories in sync with folder9, without git.

```bash
# Start daemon (manages all registered folders)
folder9 daemon start

# Folders are registered via `folder9 pull --watch`:
folder9 pull {wsId}/{folderId} ./wiki --watch
# This creates a tracking entry; daemon auto-syncs going forward
```

**Sync directions:**

| Direction       | Description                                                             |
| --------------- | ----------------------------------------------------------------------- |
| `pull`          | Watch folder9 for changes (WebSocket/long-poll), update local dir       |
| `push`          | Watch local fs changes (fsnotify), upload to folder9                    |
| `bidirectional` | Both directions (light directories only; managed folders are pull-only) |

**Local directory structure:**

```
./wiki/                        # plain directory, NOT a git repo
├── getting-started.md
├── images/
│   └── screenshot.png
└── .folder9/                  # metadata (gitignored equivalent)
    ├── config.json            # { endpoint, wsId, folderId, direction, token }
    └── state.json             # { lastSyncCommit: "abc123" }
```

**Daemon behavior:**

- Incremental sync using `lastSyncCommit` tracking
- On conflict (bidirectional mode): rename local file to `.conflict`, pull remote version, notify user
- Auto-reconnect on network failure

## Configuration

### Environment Variables (folder9 server)

| Variable          | Default    | Description                                  |
| ----------------- | ---------- | -------------------------------------------- |
| `PORT`            | 8080       | Server listen port                           |
| `DATABASE_URL`    | (required) | PostgreSQL connection string                 |
| `DATA_ROOT`       | /data      | Root directory for repos and dirs            |
| `PSK`             | (required) | Pre-shared key for service-to-service auth   |
| `WEBHOOK_SECRET`  | (required) | HMAC secret for signing webhooks             |
| `FOLDER9_API_URL` | (required) | Public API URL (used in error guidance)      |
| `FOLDER9_GIT_URL` | (required) | Public Git HTTP URL (used in error guidance) |

### Environment Variables (folder9 CLI)

| Variable          | Default                   | Description             |
| ----------------- | ------------------------- | ----------------------- |
| `FOLDER9_API_URL` | `https://folder.team9.ai` | Default server endpoint |
| `FOLDER9_TOKEN`   | —                         | Default auth token      |

## First Use Case

The initial deployment target is a **Markdown wiki with multimedia**:

- Folder type: `managed`, approval_mode: `review`
- Content: Markdown files + embedded images
- Binary files: stored directly in git (no LFS needed for wiki-scale media)
- Agents propose wiki changes, humans review and approve
- Wiki content served via WebDAV for read-only mounting by consumers

Future upgrade path: if repo size grows due to binary accumulation, migrate to Git LFS using `git lfs migrate` (tooling exists, non-breaking change).

## Testing Requirements

### Coverage Target

100% test coverage across all packages. No coverage ignore without explicit approval.

### Test Layers

| Layer                 | Scope                                                                                                                                       | Tools                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **Unit tests**        | Individual functions, permission checks, token validation, path resolution, error formatting                                                | Go standard `testing` + testify                             |
| **Integration tests** | Database operations, go-git repo operations, WebDAV handler chains, Git HTTP protocol handler chains                                        | testcontainers (PostgreSQL), temp directories for git repos |
| **End-to-end tests**  | Full HTTP request lifecycle: REST API → DB + git repo → response; Git clone/push → hook → proposal creation; WebDAV mount → file operations | httptest server, real PostgreSQL + filesystem               |

### Required Bad Case Coverage

- **Auth:** expired token, revoked token, wrong permission level, invalid token format, missing token
- **Git push:** push to protected branch with `propose` permission, push to non-existent folder, push with `read` token
- **WebDAV:** write attempt on managed folder, write with read-only token, access non-existent folder
- **Proposals:** approve already-approved proposal, approve with unresolved conflicts, comment on rejected proposal, request changes on approved proposal
- **File operations:** path traversal attempts (`../`), oversized files, empty commits, invalid base64 encoding, duplicate file paths in single commit
- **Webhooks:** unreachable webhook URL, webhook timeout handling
- **Edge cases:** concurrent proposals modifying same files, folder deletion while proposals are pending, token revocation during active git session

### Review Gates

After each implementation task completes, trigger two reviews before proceeding:

1. **Spec review:** Verify the implementation matches this design spec — correct API paths, permission logic, error response format, data model alignment.
2. **Quality review:** Check code quality, test completeness, error handling, security (path traversal, injection), and adherence to Go conventions.
