# Folder9 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build folder9, a standalone Go service providing Git-backed managed folders and simple light directories for AI agents and human users.

**Architecture:** folder9 is a Go microservice using chi for HTTP routing, go-git for Git operations, golang.org/x/net/webdav for WebDAV, and PostgreSQL for metadata. It exposes REST API, Git HTTP smart protocol, and WebDAV endpoints. Authentication uses pre-shared keys for service-to-service and opaque tokens for direct access.

**Tech Stack:** Go 1.22+, chi v5, go-git v5, golang.org/x/net/webdav, lib/pq, golang-migrate, testify, testcontainers-go

**Spec:** `docs/superpowers/specs/2026-04-07-folder9-managed-folders-design.md`

**Review gates:** After each task completes, trigger spec review (does implementation match spec?) and quality review (code quality, test completeness, security) before proceeding.

---

## File Structure

```
folder9/
├── cmd/
│   └── server/
│       └── main.go                    # Entry point, config, router setup, graceful shutdown
├── internal/
│   ├── config/
│   │   └── config.go                  # Environment variable loading
│   ├── api/
│   │   ├── router.go                  # Chi router configuration, route registration
│   │   ├── middleware_psk.go          # Pre-shared key auth middleware
│   │   ├── middleware_token.go        # Token auth middleware
│   │   ├── errors.go                  # AI-friendly structured error responses
│   │   ├── responses.go              # JSON response helpers
│   │   ├── handlers_folders.go       # Folder CRUD endpoints
│   │   ├── handlers_access.go        # Folder access management endpoints
│   │   ├── handlers_tokens.go        # Token management endpoints
│   │   ├── handlers_files.go         # File browsing + commit endpoints
│   │   ├── handlers_proposals.go     # Proposal lifecycle endpoints
│   │   ├── handlers_comments.go      # Proposal comment endpoints
│   │   ├── handlers_webhooks.go      # Webhook registration endpoints
│   │   └── handlers_refs.go          # Ref query endpoints
│   ├── auth/
│   │   ├── psk.go                     # PSK validation
│   │   ├── token.go                   # Token generation + validation
│   │   └── permission.go             # Permission level checking
│   ├── db/
│   │   ├── db.go                      # PostgreSQL connection + migration runner
│   │   ├── folders.go                 # Folder queries
│   │   ├── access.go                  # Access queries
│   │   ├── tokens.go                  # Token queries
│   │   ├── proposals.go              # Proposal queries
│   │   ├── comments.go               # Comment queries
│   │   └── webhooks.go               # Webhook queries
│   ├── gitops/
│   │   ├── repo.go                    # Bare repo lifecycle (create, delete)
│   │   ├── files.go                   # Read files/trees from refs
│   │   ├── commit.go                  # Create commits on branches
│   │   ├── branch.go                  # Branch management
│   │   ├── diff.go                    # Diff between refs
│   │   ├── log.go                     # Commit history
│   │   ├── merge.go                   # Three-way merge + conflict detection
│   │   └── httpserver.go             # Git smart HTTP protocol handler
│   ├── lightdir/
│   │   └── service.go                 # Plain directory file operations
│   ├── proposal/
│   │   └── service.go                 # Proposal business logic (state machine, merge)
│   ├── webhook/
│   │   ├── service.go                 # Webhook dispatch + HMAC signing
│   │   └── events.go                  # Event type constants
│   └── webdav/
│       └── handler.go                 # WebDAV endpoint (read-only managed, read-write light)
├── migrations/
│   ├── 000001_initial_schema.up.sql
│   └── 000001_initial_schema.down.sql
├── static/
│   └── skill.md                       # AI-readable operation manual
├── go.mod
├── go.sum
├── Dockerfile
├── docker-compose.yml
└── Makefile
```

---

### Task 0: Project Scaffolding

**Goal:** Create the folder9 Go project with chi server, config loading, health endpoint, Docker setup, and Makefile.

**Files:**

- Create: `go.mod`
- Create: `cmd/server/main.go`
- Create: `internal/config/config.go`
- Create: `internal/config/config_test.go`
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `Makefile`

**Acceptance Criteria:**

- [ ] `go build ./cmd/server` compiles
- [ ] Server starts, `GET /health` returns `200 {"status":"ok"}`
- [ ] All env vars loaded with documented defaults
- [ ] `docker compose up` runs the service
- [ ] `make build`, `make test`, `make run` work
- [ ] Config tests cover defaults, overrides, and missing required vars

**Verify:** `go test ./internal/config/ -v -count=1` → all pass

**Steps:**

- [ ] **Step 1: Initialize Go module and install core dependencies**

```bash
mkdir -p folder9 && cd folder9
go mod init github.com/team9ai/folder9
go get github.com/go-chi/chi/v5
go get github.com/stretchr/testify
```

- [ ] **Step 2: Write config tests then implementation (TDD)**

Create `internal/config/config_test.go` — tests for defaults, required vars, custom values.
Create `internal/config/config.go` — `Config` struct with `Load()` function.

Config struct fields: `Port`, `DatabaseURL`, `DataRoot`, `PSK`, `WebhookSecret`, `APIBaseURL`, `GitBaseURL`.
Required (no default): `DATABASE_URL`, `PSK`, `WEBHOOK_SECRET`, `FOLDER9_API_URL`, `FOLDER9_GIT_URL`.
Defaults: `PORT=8080`, `DATA_ROOT=/data`.

Run: `go test ./internal/config/ -v` → all pass

- [ ] **Step 3: Write main.go**

Create `cmd/server/main.go`:

- Load config via `config.Load()`
- Chi router with `middleware.Logger`, `middleware.Recoverer`, `middleware.RealIP`
- `GET /health` → `{"status":"ok"}`
- Graceful shutdown via `SIGINT`/`SIGTERM`
- `ReadTimeout`/`WriteTimeout` = 30s

Run: `go build ./cmd/server` → compiles

- [ ] **Step 4: Create Dockerfile, docker-compose.yml, Makefile**

`Dockerfile`: multi-stage build (golang:1.22-alpine builder → alpine:3.20 runtime with `ca-certificates` + `git`).
`docker-compose.yml`: folder9 service + postgres:16-alpine with healthcheck, dev env vars.
`Makefile`: targets for `build`, `test`, `test-cover`, `run`, `lint`, `migrate-up`, `migrate-down`.

- [ ] **Step 5: Verify and commit**

```bash
make test && make build
git add -A && git commit -m "feat: initialize folder9 project scaffolding"
```

---

### Task 1: Database Foundation

**Goal:** Set up PostgreSQL connection, migration runner, and create the full initial schema.

**Files:**

- Create: `internal/db/db.go`
- Create: `internal/db/db_test.go`
- Create: `migrations/000001_initial_schema.up.sql`
- Create: `migrations/000001_initial_schema.down.sql`

**Acceptance Criteria:**

- [ ] Database connects and runs migrations on startup
- [ ] All 6 tables created: `folders`, `folder_access`, `tokens`, `proposals`, `proposal_comments`, `webhooks`
- [ ] Migration rollback works cleanly
- [ ] Integration test verifies schema creation against real PostgreSQL (testcontainers)

**Verify:** `go test ./internal/db/ -v -count=1 -tags=integration` → all pass

**Steps:**

- [ ] **Step 1: Install dependencies**

```bash
go get github.com/lib/pq
go get github.com/golang-migrate/migrate/v4
go get github.com/golang-migrate/migrate/v4/database/postgres
go get github.com/golang-migrate/migrate/v4/source/iofs
go get github.com/testcontainers/testcontainers-go
go get github.com/testcontainers/testcontainers-go/modules/postgres
```

- [ ] **Step 2: Write migration SQL**

Create `migrations/000001_initial_schema.up.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TYPE folder_type AS ENUM ('managed', 'light');
CREATE TYPE owner_type AS ENUM ('agent', 'workspace');
CREATE TYPE approval_mode AS ENUM ('auto', 'review');
CREATE TYPE permission_level AS ENUM ('read', 'propose', 'write', 'admin');
CREATE TYPE principal_type AS ENUM ('agent', 'user');
CREATE TYPE proposal_status AS ENUM ('pending', 'changes_requested', 'approved', 'rejected');
CREATE TYPE author_type AS ENUM ('agent', 'user');

CREATE TABLE folders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    type folder_type NOT NULL,
    owner_type owner_type NOT NULL,
    owner_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    approval_mode approval_mode NOT NULL DEFAULT 'auto',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_folders_workspace ON folders(workspace_id);

CREATE TABLE folder_access (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    folder_id UUID NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    principal_type principal_type NOT NULL,
    principal_id TEXT NOT NULL,
    permission permission_level NOT NULL,
    UNIQUE(folder_id, principal_type, principal_id)
);

CREATE TABLE tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    token TEXT NOT NULL UNIQUE,
    folder_id UUID NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    permission permission_level NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tokens_token ON tokens(token);
CREATE INDEX idx_tokens_folder ON tokens(folder_id);

CREATE TABLE proposals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    folder_id UUID NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    branch_name TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status proposal_status NOT NULL DEFAULT 'pending',
    author_type author_type NOT NULL,
    author_id TEXT NOT NULL,
    reviewed_by TEXT,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_proposals_folder ON proposals(folder_id);

CREATE TABLE proposal_comments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    proposal_id UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
    author_id TEXT NOT NULL,
    author_type author_type NOT NULL,
    body TEXT NOT NULL,
    file_path TEXT,
    line_start INT,
    line_end INT,
    commit_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_comments_proposal ON proposal_comments(proposal_id);

CREATE TABLE webhooks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    url TEXT NOT NULL,
    events TEXT[] NOT NULL DEFAULT '{}',
    workspace_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Create `migrations/000001_initial_schema.down.sql`:

```sql
DROP TABLE IF EXISTS proposal_comments;
DROP TABLE IF EXISTS proposals;
DROP TABLE IF EXISTS tokens;
DROP TABLE IF EXISTS folder_access;
DROP TABLE IF EXISTS folders;
DROP TABLE IF EXISTS webhooks;
DROP TYPE IF EXISTS author_type;
DROP TYPE IF EXISTS proposal_status;
DROP TYPE IF EXISTS principal_type;
DROP TYPE IF EXISTS permission_level;
DROP TYPE IF EXISTS approval_mode;
DROP TYPE IF EXISTS owner_type;
DROP TYPE IF EXISTS folder_type;
```

- [ ] **Step 3: Write db.go with embedded migrations and connection**

Create `internal/db/db.go`:

- Embed `migrations/` via `embed.FS`
- `type DB struct` wrapping `*sql.DB`
- `func New(databaseURL string) (*DB, error)` — open connection, run migrations
- `func (d *DB) Close() error`
- Use `golang-migrate` with `iofs` source driver

- [ ] **Step 4: Write integration test with testcontainers**

Create `internal/db/db_test.go`:

- Use `testcontainers-go/modules/postgres` to spin up real PostgreSQL
- Test: `New()` succeeds, all tables exist (query `information_schema.tables`)
- Test: `New()` is idempotent (run twice, no error)
- Tag with `//go:build integration`

Run: `go test ./internal/db/ -v -count=1 -tags=integration` → all pass

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add database foundation with migrations"
```

---

### Task 2: Authentication & Token Management

**Goal:** Implement PSK middleware, opaque token CRUD, permission checking, and token auth middleware.

**Files:**

- Create: `internal/auth/psk.go`
- Create: `internal/auth/psk_test.go`
- Create: `internal/auth/token.go`
- Create: `internal/auth/token_test.go`
- Create: `internal/auth/permission.go`
- Create: `internal/auth/permission_test.go`
- Create: `internal/db/tokens.go`
- Create: `internal/db/tokens_test.go`
- Create: `internal/api/middleware_psk.go`
- Create: `internal/api/middleware_token.go`
- Create: `internal/api/middleware_test.go`
- Create: `internal/api/responses.go`
- Create: `internal/api/errors.go`
- Create: `internal/api/handlers_tokens.go`
- Create: `internal/api/handlers_tokens_test.go`

**Acceptance Criteria:**

- [ ] PSK middleware rejects missing/invalid pre-shared keys with constant-time comparison
- [ ] Token generation produces `f9_` + 32 random chars
- [ ] Token validation checks: exists, not revoked, not expired
- [ ] Permission hierarchy: `admin > write > propose > read`
- [ ] `POST /api/tokens` creates token, `GET /api/tokens/{token}` returns info, `DELETE /api/tokens/{token}` revokes
- [ ] Token middleware extracts token from `Authorization: Bearer` header or HTTP Basic password
- [ ] All error responses use AI-friendly structured format with `guidance` field
- [ ] Bad cases: expired token, revoked token, invalid format, wrong permission, missing header

**Verify:** `go test ./internal/auth/... ./internal/api/... -v -count=1` → all pass

**Steps:**

- [ ] **Step 1: Implement PSK validation with tests**

`internal/auth/psk.go`: `func ValidatePSK(provided, expected string) bool` — uses `crypto/subtle.ConstantTimeCompare`.
`internal/auth/psk_test.go`: Tests for valid, invalid, empty, timing-safe behavior.

- [ ] **Step 2: Implement token generation with tests**

`internal/auth/token.go`:

- `func GenerateToken() (string, error)` — `"f9_"` + 32 chars from `crypto/rand` (base62 encoding)
- Tests: format validation, uniqueness (generate 1000 tokens, no duplicates), length = 35

- [ ] **Step 3: Implement permission hierarchy with tests**

`internal/auth/permission.go`:

- `type Permission string` with constants `PermRead`, `PermPropose`, `PermWrite`, `PermAdmin`
- `func (p Permission) Satisfies(required Permission) bool` — checks if `p` is at least `required` level
- Tests: all combinations (read satisfies read, read doesn't satisfy propose, admin satisfies everything, etc.)

- [ ] **Step 4: Implement token DB queries with integration tests**

`internal/db/tokens.go`:

- `func (d *DB) CreateToken(ctx, folderID, permission, name, createdBy string, expiresAt *time.Time) (*Token, error)`
- `func (d *DB) GetToken(ctx, tokenStr string) (*Token, error)` — validates not revoked, not expired
- `func (d *DB) RevokeToken(ctx, tokenStr string) error`
- `func (d *DB) ListTokensByFolder(ctx, folderID string) ([]Token, error)`

`internal/db/tokens_test.go` (integration, testcontainers):

- Create + Get round-trip
- Revoked token returns error
- Expired token returns error
- List by folder

- [ ] **Step 5: Write response helpers and AI-friendly error format**

`internal/api/responses.go`:

- `func writeJSON(w, status, data)`
- `func writeError(w, status, errCode, message string, guidance *Guidance)`

`internal/api/errors.go`:

- `type Guidance struct { Reason, NextSteps []string, Docs string }`
- `type APIError struct { Error, Message string, Guidance *Guidance }`
- Predefined errors: `ErrInvalidToken`, `ErrExpiredToken`, `ErrInsufficientPermission`, `ErrProtectedBranch`, `ErrWebDAVReadOnly`
- Each includes `guidance` with `reason`, `next_steps`, and `docs` URL (using `config.APIBaseURL`)

- [ ] **Step 6: Write PSK and token auth middleware**

`internal/api/middleware_psk.go`:

- `func PSKMiddleware(psk string) func(http.Handler) http.Handler`
- Extracts `Authorization: Bearer {psk}` header, constant-time compare

`internal/api/middleware_token.go`:

- `func TokenMiddleware(db *db.DB) func(http.Handler) http.Handler`
- Extracts token from `Authorization: Bearer {token}` OR HTTP Basic Auth password
- Validates via `db.GetToken()`, stores token info in `context.Context`
- `func TokenFromContext(ctx) *db.Token` helper
- `func RequirePermission(required Permission) func(http.Handler) http.Handler` — checks token permission satisfies required

`internal/api/middleware_test.go`:

- Test PSK: valid, invalid, missing header
- Test token: valid Bearer, valid Basic Auth, expired, revoked, insufficient permission

- [ ] **Step 7: Write token handler endpoints**

`internal/api/handlers_tokens.go`:

- `POST /api/tokens` (PSK auth): create token, return `{ id, token, folder_id, permission, expires_at }`
- `GET /api/tokens/{token}` (PSK auth): return token info including ownership
- `DELETE /api/tokens/{token}` (PSK auth): revoke token
- `GET /api/tokens?folder_id={id}` (PSK auth): list tokens for folder

`internal/api/handlers_tokens_test.go`:

- Integration tests using httptest + testcontainers
- CRUD round-trip, revocation, query by folder, bad cases (missing fields, nonexistent token)

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: add authentication, tokens, and permission system"
```

---

### Task 3: Folder Management API

**Goal:** Implement folder CRUD and access management endpoints.

**Files:**

- Create: `internal/db/folders.go`
- Create: `internal/db/folders_test.go`
- Create: `internal/db/access.go`
- Create: `internal/db/access_test.go`
- Create: `internal/api/handlers_folders.go`
- Create: `internal/api/handlers_folders_test.go`
- Create: `internal/api/handlers_access.go`
- Create: `internal/api/handlers_access_test.go`
- Create: `internal/api/router.go`

**Acceptance Criteria:**

- [ ] `POST /api/workspaces/{wsId}/folders` creates folder with `type` = `managed` or `light`
- [ ] `GET /api/workspaces/{wsId}/folders` lists folders filtered by workspace
- [ ] `GET /api/workspaces/{wsId}/folders/{id}` returns folder details
- [ ] `PATCH /api/workspaces/{wsId}/folders/{id}` updates name, approval_mode
- [ ] `DELETE /api/workspaces/{wsId}/folders/{id}` deletes folder (cascades access, tokens, proposals)
- [ ] Access CRUD: grant, revoke, list permissions per folder
- [ ] Workspace isolation: cannot access folders from other workspaces
- [ ] Bad cases: duplicate name in workspace, invalid type, non-existent folder, invalid permission level

**Verify:** `go test ./internal/db/... ./internal/api/... -v -count=1 -tags=integration` → all pass

**Steps:**

- [ ] **Step 1: Implement folder DB queries with integration tests**

`internal/db/folders.go`:

- `type Folder struct` matching schema columns
- `func (d *DB) CreateFolder(ctx, params CreateFolderParams) (*Folder, error)`
- `func (d *DB) GetFolder(ctx, id string) (*Folder, error)`
- `func (d *DB) ListFolders(ctx, workspaceID string) ([]Folder, error)`
- `func (d *DB) UpdateFolder(ctx, id string, params UpdateFolderParams) (*Folder, error)`
- `func (d *DB) DeleteFolder(ctx, id string) error`

`internal/db/folders_test.go` (integration): CRUD round-trip, list by workspace, delete cascade, non-existent folder returns `sql.ErrNoRows`.

- [ ] **Step 2: Implement access DB queries with integration tests**

`internal/db/access.go`:

- `func (d *DB) GrantAccess(ctx, folderID, principalType, principalID, permission string) (*FolderAccess, error)`
- `func (d *DB) RevokeAccess(ctx, accessID string) error`
- `func (d *DB) ListAccess(ctx, folderID string) ([]FolderAccess, error)`
- `func (d *DB) GetAccess(ctx, folderID, principalType, principalID string) (*FolderAccess, error)`

`internal/db/access_test.go` (integration): grant + list, revoke, duplicate grant (upsert), get specific principal.

- [ ] **Step 3: Write router setup**

`internal/api/router.go`:

- `func NewRouter(cfg *config.Config, database *db.DB) chi.Router`
- PSK-protected group for management API under `/api/workspaces/{wsId}/folders`
- Token-protected group for file operations (prepared for later tasks)
- Health endpoint

- [ ] **Step 4: Write folder and access handlers with tests**

`internal/api/handlers_folders.go`: CRUD handlers. Validate `wsId` path param matches request. Validate `type` enum. Return AI-friendly errors for bad input.

`internal/api/handlers_access.go`: Grant/revoke/list handlers. Validate permission enum.

Integration tests using `httptest.NewServer` + real database:

- Full CRUD lifecycle
- Workspace isolation (folder in wsA not accessible via wsB URL)
- Invalid inputs return 400 with structured error
- Delete folder cascades tokens and access

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add folder management and access control API"
```

---

### Task 4: Git Core Operations

**Goal:** Implement bare repo lifecycle, file reading, commit creation, branch management, diff, and log using go-git.

**Files:**

- Create: `internal/gitops/repo.go`
- Create: `internal/gitops/repo_test.go`
- Create: `internal/gitops/files.go`
- Create: `internal/gitops/files_test.go`
- Create: `internal/gitops/commit.go`
- Create: `internal/gitops/commit_test.go`
- Create: `internal/gitops/branch.go`
- Create: `internal/gitops/branch_test.go`
- Create: `internal/gitops/diff.go`
- Create: `internal/gitops/diff_test.go`
- Create: `internal/gitops/log.go`
- Create: `internal/gitops/log_test.go`

**Acceptance Criteria:**

- [ ] Create and delete bare repos at `{dataRoot}/repos/{wsId}/{folderId}.git`
- [ ] Read file tree from any ref (branch name or commit SHA)
- [ ] Read single file content (text and binary) from any ref
- [ ] Create commits with multiple file changes (create, update, delete) on a branch
- [ ] Create and delete branches
- [ ] Diff between two refs returns changed files with content
- [ ] Log returns commit history for a ref, optionally filtered by path
- [ ] All operations work on bare repos (no working directory)
- [ ] Bad cases: non-existent ref, non-existent path, empty repo, invalid commit

**Verify:** `go test ./internal/gitops/... -v -count=1` → all pass

**Steps:**

- [ ] **Step 1: Install go-git**

```bash
go get github.com/go-git/go-git/v5
```

- [ ] **Step 2: Implement repo lifecycle with tests**

`internal/gitops/repo.go`:

- `type Service struct { dataRoot string }`
- `func NewService(dataRoot string) *Service`
- `func (s *Service) RepoPath(wsId, folderId string) string` → `{dataRoot}/repos/{wsId}/{folderId}.git`
- `func (s *Service) InitRepo(wsId, folderId string) error` — `git.PlainInitWithOptions` with `Bare: true`. Creates initial empty commit on `main` branch.
- `func (s *Service) DeleteRepo(wsId, folderId string) error` — `os.RemoveAll`
- `func (s *Service) OpenRepo(wsId, folderId string) (*git.Repository, error)`

Tests: init + open round-trip, delete removes directory, open non-existent returns error.

- [ ] **Step 3: Implement file reading with tests**

`internal/gitops/files.go`:

- `type TreeEntry struct { Name, Path string; IsDir bool; Size int64 }`
- `type FileContent struct { Path string; Content []byte; Size int64 }`
- `func (s *Service) ListTree(repo *git.Repository, ref, path string) ([]TreeEntry, error)` — resolve ref → commit → tree, walk to path, list entries
- `func (s *Service) ReadBlob(repo *git.Repository, ref, path string) (*FileContent, error)` — resolve ref → commit → tree → blob
- `func (s *Service) ReadRaw(repo *git.Repository, ref, path string) (io.ReadCloser, int64, error)` — same but returns reader for streaming

Tests: init repo, create commits with files (including nested directories), then read tree at root, read tree at subdirectory, read blob for text file, read blob for binary file, non-existent path returns error, non-existent ref returns error.

- [ ] **Step 4: Implement commit creation with tests**

`internal/gitops/commit.go`:

- `type FileChange struct { Path, Content string; Encoding string; Action string }` — action: `create`, `update`, `delete`
- `func (s *Service) CreateCommit(repo *git.Repository, branch, message, authorName, authorEmail string, changes []FileChange) (string, error)` — returns commit SHA
  - Resolve branch → head commit → parent tree
  - Apply changes to tree (add/update/delete entries)
  - Create new tree object → create commit object → update branch ref
  - Handle base64 encoding for binary files
  - For new branch from main: resolve main → use as parent

Tests: create file, update file, delete file, multiple changes in one commit, create file in nested directory (auto-create tree), base64 encoded file, empty changes list returns error.

- [ ] **Step 5: Implement branch management with tests**

`internal/gitops/branch.go`:

- `func (s *Service) CreateBranch(repo, branchName, fromRef string) error`
- `func (s *Service) DeleteBranch(repo, branchName string) error`
- `func (s *Service) ListBranches(repo) ([]string, error)`
- `func (s *Service) GetRef(repo, ref string) (commitSHA string, err error)` — resolves branch name or SHA

Tests: create from main, list includes new branch, delete removes it, create from non-existent ref fails.

- [ ] **Step 6: Implement diff with tests**

`internal/gitops/diff.go`:

- `type DiffEntry struct { Path, Status string; OldContent, NewContent string }`
- `func (s *Service) DiffRefs(repo, fromRef, toRef string) ([]DiffEntry, error)` — uses go-git's `object.DiffTree`

Tests: diff with added file, modified file, deleted file, multiple changes, identical refs returns empty diff.

- [ ] **Step 7: Implement log with tests**

`internal/gitops/log.go`:

- `type LogEntry struct { SHA, Message, AuthorName, AuthorEmail string; Time time.Time }`
- `func (s *Service) Log(repo, ref string, path string, limit int) ([]LogEntry, error)` — if path is non-empty, filter commits that touch that path

Tests: multiple commits show in reverse chronological order, path filter works, limit works.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: add git core operations with go-git"
```

---

### Task 5: Light Directory Operations

**Goal:** Implement plain filesystem CRUD for light directories with path safety.

**Files:**

- Create: `internal/lightdir/service.go`
- Create: `internal/lightdir/service_test.go`

**Acceptance Criteria:**

- [ ] Create, read, update, delete files in `{dataRoot}/dirs/{wsId}/{folderId}/`
- [ ] List directory contents with metadata (name, size, is_dir, mod_time)
- [ ] Create subdirectories
- [ ] Path traversal prevention: `../`, absolute paths, null bytes, symlink escape
- [ ] Auto-create parent directories on file write

**Verify:** `go test ./internal/lightdir/... -v -count=1` → all pass

**Steps:**

- [ ] **Step 1: Implement path safety (reuse file-keeper pattern)**

`internal/lightdir/service.go`:

- `type Service struct { dataRoot string }`
- `func (s *Service) BasePath(wsId, folderId string) string` → `{dataRoot}/dirs/{wsId}/{folderId}`
- `func (s *Service) ResolvePath(baseDir, relPath string) (string, error)` — reject null bytes, absolute paths, `..` traversal, symlink escape. Same multi-layer validation as file-keeper.

Tests: valid paths resolve correctly, `../` rejected, absolute path rejected, null byte rejected, symlink escape rejected.

- [ ] **Step 2: Implement file operations**

- `func (s *Service) ReadFile(absPath string) (io.ReadCloser, os.FileInfo, error)`
- `func (s *Service) WriteFile(absPath string, content io.Reader) (int64, bool, error)` — returns bytes written + isNew. Auto-creates parent dirs.
- `func (s *Service) DeleteFile(absPath string) error` — works for files and empty directories
- `func (s *Service) ListDir(absPath string) ([]DirEntry, error)` — returns `[]DirEntry{Name, Type, Size, ModTime}`
- `func (s *Service) MkDir(absPath string) error`
- `func (s *Service) InitFolder(wsId, folderId string) error` — creates base directory
- `func (s *Service) DeleteFolder(wsId, folderId string) error` — removes entire directory

Tests: write + read round-trip, overwrite updates content, delete file, list directory, mkdir, auto-create parents, delete non-existent returns error.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: add light directory file operations"
```

---

### Task 6: File Operations REST API

**Goal:** Wire up REST endpoints for file browsing, commits, history, and light directory operations.

**Files:**

- Create: `internal/api/handlers_files.go`
- Create: `internal/api/handlers_files_test.go`
- Create: `internal/api/handlers_refs.go`
- Create: `internal/api/handlers_refs_test.go`
- Modify: `internal/api/router.go` — add file operation routes

**Acceptance Criteria:**

- [ ] `GET .../tree?ref=main&path=/` returns directory listing from git (managed) or filesystem (light)
- [ ] `GET .../blob?ref=main&path=/file.md` returns file content (managed)
- [ ] `GET .../raw?ref=main&path=/image.png` returns binary content with correct Content-Type
- [ ] `POST .../commit` creates commit on managed folders; for `auto+write` → main, for `review` or `propose` → creates proposal
- [ ] `GET .../log?ref=main` returns commit history (managed)
- [ ] `GET .../diff?from=main&to=proposal/x` returns diff (managed)
- [ ] Light directory file ops: `PUT .../files`, `DELETE .../files`, `POST .../files?action=mkdir`
- [ ] `GET .../refs/main` returns current commit SHA + timestamp
- [ ] Token permission enforced: `read` for browsing, `write`/`propose` for modifications
- [ ] Bad cases: invalid ref, non-existent path, light folder with git-only endpoints, managed folder with light-only endpoints

**Verify:** `go test ./internal/api/... -v -count=1 -tags=integration` → all pass

**Steps:**

- [ ] **Step 1: Implement file browsing handlers (tree, blob, raw)**

`internal/api/handlers_files.go`:

- For managed folders: delegate to `gitops.Service` methods
- For light folders: delegate to `lightdir.Service` methods
- `tree` handler: managed → `gitops.ListTree`, light → `lightdir.ListDir`
- `blob` handler: managed only → `gitops.ReadBlob`, light returns 400
- `raw` handler: managed → `gitops.ReadRaw` with `Content-Type` detection, light → `lightdir.ReadFile`

Tests: tree for managed (with ref param), tree for light (ignores ref), blob for managed, raw with correct MIME type, blob on light returns 400.

- [ ] **Step 2: Implement commit handler**

Commit handler (`POST .../commit`):

1. Parse body: `{ message, files: [{ path, content, encoding?, action }] }`
2. If managed folder:
   - If `approval_mode=auto` AND token has `write` permission → `gitops.CreateCommit` on `main`
   - If `approval_mode=review` OR token has `propose` permission → create branch `proposal/{uuid}`, commit there, create proposal DB record
3. If light folder: apply file changes directly via `lightdir.Service`

Tests: auto+write → commit on main, review+propose → creates proposal, auto+propose → creates proposal, light folder applies directly.

- [ ] **Step 3: Implement history and diff handlers**

- `GET .../log` → `gitops.Log` (managed only)
- `GET .../diff` → `gitops.DiffRefs` (managed only)
- `GET .../refs/main` → `gitops.GetRef` returns SHA + read folder `updated_at`

Tests: log returns commits, diff between branches, refs endpoint returns current SHA.

- [ ] **Step 4: Implement light directory file handlers**

- `PUT .../files?path=...` → `lightdir.WriteFile`
- `DELETE .../files?path=...` → `lightdir.DeleteFile`
- `POST .../files?action=mkdir&path=...` → `lightdir.MkDir`

Tests: write + read, delete, mkdir, path traversal returns 400.

- [ ] **Step 5: Wire all routes in router.go and test end-to-end**

Update `internal/api/router.go`:

- Token-authed group: `/api/workspaces/{wsId}/folders/{folderId}/tree`, `/blob`, `/raw`, `/commit`, `/log`, `/diff`, `/files`, `/refs`
- Middleware: `TokenMiddleware` + `RequirePermission` per route

E2E test: create folder via PSK API → issue token → use token to browse/commit/read.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add file operations REST API"
```

---

### Task 7: Proposal System

**Goal:** Implement proposal lifecycle (PR model): CRUD, status transitions, comments with line-level positioning, three-way merge preview.

**Files:**

- Create: `internal/db/proposals.go`
- Create: `internal/db/proposals_test.go`
- Create: `internal/db/comments.go`
- Create: `internal/db/comments_test.go`
- Create: `internal/proposal/service.go`
- Create: `internal/proposal/service_test.go`
- Create: `internal/gitops/merge.go`
- Create: `internal/gitops/merge_test.go`
- Create: `internal/api/handlers_proposals.go`
- Create: `internal/api/handlers_proposals_test.go`
- Create: `internal/api/handlers_comments.go`
- Create: `internal/api/handlers_comments_test.go`
- Modify: `internal/api/router.go` — add proposal routes

**Acceptance Criteria:**

- [ ] `GET .../proposals` lists proposals for a folder
- [ ] `GET .../proposals/{pid}` returns proposal details with diff summary
- [ ] `GET .../proposals/{pid}/merge-preview` returns three-way merge info with conflict detection
- [ ] `POST .../proposals/{pid}/approve` merges to main (with optional resolved_files for conflicts)
- [ ] `POST .../proposals/{pid}/reject` deletes branch, updates status
- [ ] `POST .../proposals/{pid}/request-changes` sets status + batch-creates comments
- [ ] Comments support file_path, line_start, line_end, commit_id
- [ ] Status machine: `pending → changes_requested → pending → ... → approved/rejected`
- [ ] Bad cases: approve already-approved, reject already-rejected, approve with unresolved conflicts, comment on rejected proposal, invalid status transition

**Verify:** `go test ./internal/proposal/... ./internal/gitops/... ./internal/api/... -v -count=1 -tags=integration` → all pass

**Steps:**

- [ ] **Step 1: Implement proposal DB queries with tests**

`internal/db/proposals.go`:

- `func (d *DB) CreateProposal(ctx, params) (*Proposal, error)`
- `func (d *DB) GetProposal(ctx, id string) (*Proposal, error)`
- `func (d *DB) ListProposals(ctx, folderID string, status *string) ([]Proposal, error)`
- `func (d *DB) UpdateProposalStatus(ctx, id, status, reviewedBy string) error` — validates state transitions
- `func (d *DB) DeleteProposal(ctx, id string) error`

`internal/db/proposals_test.go` (integration): CRUD, status transitions (valid + invalid), list with status filter.

- [ ] **Step 2: Implement comment DB queries with tests**

`internal/db/comments.go`:

- `func (d *DB) CreateComment(ctx, params CreateCommentParams) (*ProposalComment, error)`
- `func (d *DB) ListComments(ctx, proposalID string) ([]ProposalComment, error)`
- `func (d *DB) CreateCommentBatch(ctx, proposalID string, comments []CreateCommentParams) error`

`internal/db/comments_test.go` (integration): create single, create batch, list ordered by created_at, comments with file_path + line numbers.

- [ ] **Step 3: Implement three-way merge with tests**

`internal/gitops/merge.go`:

- `type MergeFile struct { Path, Status string; Base, Ours, Theirs, Merged *string }`
- `func (s *Service) MergePreview(repo, mainBranch, proposalBranch string) (conflicted bool, files []MergeFile, err error)`
  - Find merge base (common ancestor)
  - Diff base→main (ours) and base→proposal (theirs)
  - For each changed file: if only one side changed → auto-merge; if both changed same file → mark conflicted
  - Return three-way content for conflicted files
- `func (s *Service) MergeBranch(repo, mainBranch, proposalBranch string, resolvedFiles map[string]string) (commitSHA string, err error)`
  - If no conflicts: fast-forward or create merge commit
  - If conflicts + resolvedFiles provided: create merge commit with resolved content
  - If conflicts + no resolvedFiles: return error

Tests: clean merge (no conflict), conflict detected, merge with resolved files, fast-forward merge, merge with deletions on one side.

- [ ] **Step 4: Implement proposal service (business logic)**

`internal/proposal/service.go`:

- `type Service struct { db *db.DB; gitSvc *gitops.Service }`
- `func (s *Service) Approve(ctx, proposalID, reviewerID string, resolvedFiles map[string]string) error`
  1. Get proposal, verify status is `pending` or `changes_requested`
  2. Call `gitops.MergePreview` to check conflicts
  3. If conflicted and no resolvedFiles → return error with merge preview
  4. Call `gitops.MergeBranch`
  5. Delete proposal branch
  6. Update status to `approved`
- `func (s *Service) Reject(ctx, proposalID, reviewerID, reason string) error`
  1. Verify status not already `approved`/`rejected`
  2. Delete proposal branch
  3. Update status to `rejected`
  4. Optionally create comment with reason
- `func (s *Service) RequestChanges(ctx, proposalID, reviewerID string, comments []CreateCommentParams) error`
  1. Verify status is `pending`
  2. Batch-create comments
  3. Update status to `changes_requested`

`internal/proposal/service_test.go`: approve happy path, approve with conflicts (returns error), approve with resolved files, reject, request changes creates comments, invalid state transitions.

- [ ] **Step 5: Write proposal and comment API handlers with tests**

`internal/api/handlers_proposals.go`: list, get (includes diff summary from `gitops.DiffRefs`), merge-preview, approve, reject, request-changes.

`internal/api/handlers_comments.go`: create comment, list comments.

Integration tests: full lifecycle E2E (create folder → commit → push to proposal branch → list proposals → add comment → request changes → approve → verify merged to main).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add proposal system with PR lifecycle"
```

---

### Task 8: Git HTTP Smart Protocol

**Goal:** Implement Git smart HTTP protocol server so agents can `git clone`, `pull`, `fetch`, and `push` against folder9.

**Files:**

- Create: `internal/gitops/httpserver.go`
- Create: `internal/gitops/httpserver_test.go`
- Create: `internal/gitops/hooks.go`
- Create: `internal/gitops/hooks_test.go`
- Modify: `internal/api/router.go` — add git HTTP routes

**Acceptance Criteria:**

- [ ] `git clone {FOLDER9_GIT_URL}/{wsId}/{folderId}` works with HTTP Basic auth (password=token)
- [ ] `git pull` fetches latest changes
- [ ] `git push` to `main` with `write` permission succeeds (auto mode)
- [ ] `git push` to `main` with `propose` permission is rejected with AI-friendly guidance
- [ ] `git push` to `proposal/*` with `propose` permission creates proposal record
- [ ] `git push` to `proposal/*` in `auto` mode auto-approves + merges
- [ ] Server-side hook enforces branch protection per spec's permission×mode table
- [ ] Bad cases: push with `read` token, push to `main` in `review` mode with `propose`, clone non-existent repo

**Verify:** `go test ./internal/gitops/... -v -count=1 -tags=integration` → all pass (integration tests do actual git clone/push)

**Steps:**

- [ ] **Step 1: Implement Git smart HTTP protocol handlers**

`internal/gitops/httpserver.go`:

- `func (s *Service) InfoRefsHandler(w, r *http.Request)` — handles `GET /{wsId}/{folderId}/info/refs?service=git-upload-pack|git-receive-pack`
- `func (s *Service) UploadPackHandler(w, r *http.Request)` — handles `POST /{wsId}/{folderId}/git-upload-pack` (clone/fetch)
- `func (s *Service) ReceivePackHandler(w, r *http.Request)` — handles `POST /{wsId}/{folderId}/git-receive-pack` (push)

Implementation approach: Use go-git's `transport/server` package which provides `UploadPackSession` and `ReceivePackSession` for serving git protocol over HTTP. Alternatively, if go-git's server support is insufficient, fall back to shelling out to `git http-backend` CGI (git is installed in the Docker image).

Research go-git's server capabilities first. If `go-git/v5/plumbing/transport/server` supports smart HTTP natively, use it. Otherwise, use `os/exec` to call `git http-backend` with appropriate environment variables (`GIT_PROJECT_ROOT`, `GIT_HTTP_EXPORT_ALL`).

- [ ] **Step 2: Implement server-side hook logic**

`internal/gitops/hooks.go`:

- `type PushContext struct { Token *db.Token; Folder *db.Folder; RefName, OldSHA, NewSHA string }`
- `func (s *Service) ValidatePush(ctx PushContext) error`
  - Parse ref name to determine target: `refs/heads/main` or `refs/heads/proposal/*`
  - Apply permission×mode matrix from spec:

  ```
  auto  + write  + main        → allow
  auto  + propose + main       → reject (PROTECTED_BRANCH guidance)
  auto  + write/propose + proposal/* → allow (auto-approve later)
  review + write  + main       → allow
  review + propose + main      → reject (PROTECTED_BRANCH guidance)
  review + propose + proposal/* → allow (create proposal)
  read   + any                 → reject (INSUFFICIENT_PERMISSION guidance)
  ```

- `func (s *Service) PostReceiveHook(ctx PushContext) error` — called after successful push:
  - If pushed to `proposal/*`: create proposal DB record from branch's latest commit message
  - If pushed to `proposal/*` in `auto` mode: auto-approve (merge to main, delete branch)

`internal/gitops/hooks_test.go`: test all 6 cells of the permission×mode matrix, plus `read` rejection. Test post-receive creates proposal record. Test auto-mode auto-approves.

- [ ] **Step 3: Wire git HTTP routes with token auth**

In `internal/api/router.go`:

- Route group: `/git/{wsId}/{folderId}/*` (same server)
- Also register under a separate chi handler that can be mounted for `git.folder.team9.ai` virtual host
- Token auth via HTTP Basic Auth (username ignored, password = token)
- After auth: extract folder info, call `ValidatePush` in receive-pack handler

- [ ] **Step 4: Integration test with actual git client**

Test using `os/exec` to run real `git clone`, `git push`:

1. Create folder via API, issue `write` token
2. `git clone` with HTTP Basic auth → succeeds
3. Create file, commit, `git push origin main` → succeeds (auto mode)
4. `git push origin main` with `propose` token → rejected with guidance message
5. `git push origin proposal/test` with `propose` token → succeeds, proposal created
6. Verify proposal exists via API

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add Git HTTP smart protocol server"
```

---

### Task 9: WebDAV Server

**Goal:** Expose WebDAV endpoints — read-only for managed folders, read-write for light directories.

**Files:**

- Create: `internal/webdav/handler.go`
- Create: `internal/webdav/handler_test.go`
- Modify: `internal/api/router.go` — add WebDAV routes

**Acceptance Criteria:**

- [ ] `PROPFIND /dav/{wsId}/{folderId}/` returns directory listing
- [ ] `GET /dav/{wsId}/{folderId}/file.md` returns file content
- [ ] Light directory: `PUT`, `DELETE`, `MKCOL` work
- [ ] Managed folder: `PUT`, `DELETE`, `MKCOL` return 403 with AI-friendly guidance
- [ ] Auth via Bearer token or HTTP Basic
- [ ] macOS Finder can mount light directory WebDAV URL

**Verify:** `go test ./internal/webdav/... -v -count=1 -tags=integration` → all pass

**Steps:**

- [ ] **Step 1: Implement WebDAV handler**

`internal/webdav/handler.go`:

- For managed folders: wrap `golang.org/x/net/webdav.Handler` with a read-only filesystem adapter that reads from go-git's tree objects at `main` HEAD
- For light directories: use `webdav.Handler` with `webdav.Dir` pointing to the folder's physical directory
- Managed write attempts (PUT, DELETE, MKCOL) intercepted → return 403 `WEBDAV_READ_ONLY` with guidance

- [ ] **Step 2: Implement read-only git filesystem adapter**

Create a `webdav.FileSystem` implementation that serves files from a git repo's `main` branch:

- `OpenFile` → `gitops.ReadRaw`
- `Stat` → resolve path in git tree
- `Readdir` → `gitops.ListTree`
- Write methods → return `os.ErrPermission`

- [ ] **Step 3: Wire routes and test**

Route: `/dav/{wsId}/{folderId}/` → WebDAV handler with token auth.
Tests: PROPFIND returns listing, GET returns file, PUT on light succeeds, PUT on managed returns 403 with guidance, auth required.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add WebDAV server"
```

---

### Task 10: Webhook System

**Goal:** Implement webhook registration API and event dispatch with HMAC-SHA256 signing.

**Files:**

- Create: `internal/db/webhooks.go`
- Create: `internal/db/webhooks_test.go`
- Create: `internal/webhook/events.go`
- Create: `internal/webhook/service.go`
- Create: `internal/webhook/service_test.go`
- Create: `internal/api/handlers_webhooks.go`
- Create: `internal/api/handlers_webhooks_test.go`
- Modify: `internal/api/router.go` — add webhook routes

**Acceptance Criteria:**

- [ ] `POST /api/webhooks` registers webhook URL with optional event filter
- [ ] `GET /api/webhooks` lists registered webhooks
- [ ] `DELETE /api/webhooks/{id}` removes webhook
- [ ] Events dispatched: `proposal.created`, `proposal.updated`, `proposal.approved`, `proposal.rejected`, `proposal.changes_requested`, `ref.updated`, `comment.created`
- [ ] Payload signed with `X-Folder9-Signature: sha256=...` using HMAC-SHA256
- [ ] Dispatch is async (goroutine), non-blocking, with timeout
- [ ] Bad cases: unreachable URL logged but doesn't block, invalid URL rejected

**Verify:** `go test ./internal/webhook/... ./internal/api/... -v -count=1 -tags=integration` → all pass

**Steps:**

- [ ] **Step 1: Implement webhook DB queries with tests**

`internal/db/webhooks.go`: CRUD for webhooks table.
Tests: create, list, delete, filter by workspace_id.

- [ ] **Step 2: Implement event types and dispatch service**

`internal/webhook/events.go`: Event type constants and payload struct.
`internal/webhook/service.go`:

- `func (s *Service) Dispatch(ctx, event string, payload interface{})` — async dispatch to all matching webhooks
- Sign payload with HMAC-SHA256, set `X-Folder9-Signature` header
- HTTP POST with 10s timeout, log failures but don't retry (MVP)

Tests: dispatch sends POST with correct signature, event filter respected, timeout handling.

- [ ] **Step 3: Wire into existing code paths**

Add `webhook.Dispatch` calls to: proposal creation (Task 7 commit handler), proposal status changes (approve/reject/request-changes), ref updates (git push), comment creation.

- [ ] **Step 4: Write webhook management handlers and commit**

`internal/api/handlers_webhooks.go`: CRUD endpoints (PSK auth).
Tests: register, list, delete webhook.

```bash
git add -A && git commit -m "feat: add webhook system"
```

---

### Task 11: AI-Friendly Error Responses & skill.md

**Goal:** Ensure all error responses include structured guidance, and serve `skill.md` as an AI-readable operation manual.

**Files:**

- Modify: `internal/api/errors.go` — complete all error types with guidance
- Create: `static/skill.md`
- Modify: `cmd/server/main.go` — serve skill.md at root

**Acceptance Criteria:**

- [ ] All 403/422 responses include `error`, `message`, `guidance` with `reason`, `next_steps[]`, `docs`
- [ ] `docs` URLs use `FOLDER9_API_URL` config value (not hardcoded)
- [ ] `GET /skill.md` serves the AI operation manual
- [ ] skill.md covers: auth, folder types, git workflow, API workflow, proposal lifecycle, error codes
- [ ] Audit: every handler that returns 4xx uses structured error format

**Verify:** `grep -r "writeError\|WriteError" internal/api/ | wc -l` — all error calls use structured format

**Steps:**

- [ ] **Step 1: Audit and standardize all error responses**

Review every handler file. Replace any plain `writeError(w, status, "message")` calls with structured `writeAPIError(w, status, apiErr)` that includes guidance. Create predefined `APIError` constants for all error codes from the spec:

- `ErrProtectedBranch`, `ErrWebDAVReadOnly`, `ErrInsufficientPermission`, `ErrInvalidToken`, `ErrExpiredToken`, `ErrFolderNotFound`, `ErrProposalNotFound`, `ErrInvalidStatusTransition`, `ErrMergeConflict`, `ErrPathTraversal`

- [ ] **Step 2: Write skill.md**

Create `static/skill.md` — structured for LLM consumption:

- Concise sections: Overview, Auth, Managed Folders (git workflow), Light Directories (WebDAV), Proposals, Error Codes
- Code examples for every operation (git clone, push, API commit, etc.)
- Use `{FOLDER9_API_URL}` / `{FOLDER9_GIT_URL}` placeholders — server replaces them when serving

- [ ] **Step 3: Serve skill.md and commit**

In `cmd/server/main.go`: `r.Get("/skill.md", ...)` — read from embedded `static/skill.md`, replace URL placeholders with config values.

```bash
git add -A && git commit -m "feat: add AI-friendly errors and skill.md"
```

---

### Task 12: CLI Client Foundation

**Goal:** Build the `folder9` CLI with auth, browse, pull, push, and proposal commands.

**Files:**

- Create: `cmd/cli/main.go`
- Create: `internal/cli/client.go` — HTTP client wrapper
- Create: `internal/cli/auth.go` — login, whoami, token info
- Create: `internal/cli/browse.go` — ls, tree, cat
- Create: `internal/cli/sync.go` — pull, push
- Create: `internal/cli/proposals.go` — ls, diff, approve, reject
- Create: `internal/cli/config.go` — ~/.folder9/config.json management
- Create test files for each

**Acceptance Criteria:**

- [ ] `folder9 auth login --token f9_xxx` saves token to `~/.folder9/config.json`
- [ ] `folder9 auth login --token f9_xxx --endpoint https://...` saves custom endpoint
- [ ] `folder9 auth whoami` shows token ownership, scope, expiry
- [ ] `folder9 token info f9_xxx` queries token details
- [ ] `folder9 ls {wsId}/{folderId}` lists files
- [ ] `folder9 tree {wsId}/{folderId}` shows file tree
- [ ] `folder9 cat {wsId}/{folderId} path/to/file` prints file content
- [ ] `folder9 pull {wsId}/{folderId} ./local-dir` downloads folder content
- [ ] `folder9 pull --watch` registers for daemon tracking
- [ ] `folder9 push ./local-dir {wsId}/{folderId}` uploads (auto mode)
- [ ] `folder9 push --propose --title "..." --message "..."` creates proposal
- [ ] `folder9 proposals ls/diff/approve/reject` work
- [ ] All commands support `--token` override and `--endpoint` override
- [ ] All commands support `--help` with examples
- [ ] Default endpoint from `FOLDER9_API_URL` env var or config file
- [ ] Bad cases: invalid token, unreachable server, non-existent folder

**Verify:** `go test ./internal/cli/... -v -count=1` → all pass

**Steps:**

- [ ] **Step 1: Set up CLI framework**

Use `cobra` or Go stdlib `flag`. Create `cmd/cli/main.go` with subcommand structure:
`folder9 {auth|token|ls|tree|cat|pull|push|proposals} [args] [flags]`

- [ ] **Step 2: Implement HTTP client wrapper**

`internal/cli/client.go`:

- `type Client struct { baseURL, token string; http *http.Client }`
- Methods: `Get`, `Post`, `Patch`, `Delete` with auth header injection
- Error handling: parse API error responses, display guidance to user

- [ ] **Step 3: Implement auth commands with tests**

`internal/cli/auth.go`: login (saves to config), whoami (calls `GET /api/tokens/{token}`).
`internal/cli/config.go`: read/write `~/.folder9/config.json`.
Tests: login saves config, whoami displays info, missing config returns error.

- [ ] **Step 4: Implement browse commands with tests**

`internal/cli/browse.go`: ls, tree, cat. Call REST API, format output for terminal.
Tests: ls formats directory listing, cat prints content, non-existent path returns error.

- [ ] **Step 5: Implement pull/push with tests**

`internal/cli/sync.go`:

- `pull`: GET tree recursively, download each file, write to local directory. Create `.folder9/` metadata dir.
- `push`: scan local directory, diff against remote (via refs API), upload changed files via commit API.
- `--watch` flag: write tracking entry to `.folder9/config.json` for daemon.
- `--propose` flag: set proposal mode in commit request.

Tests: pull creates local files, push uploads changes, watch creates tracking entry.

- [ ] **Step 6: Implement proposal commands and commit**

`internal/cli/proposals.go`: ls, diff, approve, reject. Call proposal API, format output.
Tests: list proposals, diff output, approve/reject state changes.

```bash
git add -A && git commit -m "feat: add folder9 CLI client"
```

---

### Task 13: Daemon Mode

**Goal:** Implement `folder9 daemon` that keeps local directories in sync with folder9 server.

**Files:**

- Create: `cmd/daemon/main.go`
- Create: `internal/daemon/daemon.go`
- Create: `internal/daemon/watcher.go`
- Create: `internal/daemon/sync.go`
- Create: `internal/daemon/daemon_test.go`

**Acceptance Criteria:**

- [ ] `folder9 daemon start` starts background process managing all registered folders
- [ ] Registered via `folder9 pull --watch` (creates `.folder9/config.json` entry)
- [ ] Pull direction: polls refs API, detects changes, downloads updated files
- [ ] Push direction (light dirs only): watches local fs via fsnotify, uploads on change
- [ ] Bidirectional (light dirs): both directions, conflicts → `.conflict` file + notification
- [ ] Incremental sync using `lastSyncCommit` tracking in `.folder9/state.json`
- [ ] Auto-reconnect on network failure with exponential backoff
- [ ] Managed folders are pull-only (push attempts logged as warning)

**Verify:** `go test ./internal/daemon/... -v -count=1` → all pass

**Steps:**

- [ ] **Step 1: Implement daemon core**

`internal/daemon/daemon.go`:

- `type Daemon struct` — manages multiple folder sync entries
- `func (d *Daemon) Start()` — scans registered folders, starts sync goroutine per folder
- `func (d *Daemon) Stop()` — graceful shutdown of all watchers
- Load tracked folders from `~/.folder9/tracked.json`

- [ ] **Step 2: Implement pull sync**

`internal/daemon/sync.go`:

- `func (d *Daemon) PullSync(entry *TrackedFolder) error`
- Poll `GET /refs/main` on interval (default 30s)
- If commit changed: diff old→new, download changed files, update local, update `lastSyncCommit`
- Handle deleted files (remove local)

Tests: mock server returns new commit → local files updated. No change → no-op.

- [ ] **Step 3: Implement push sync (light dirs)**

`internal/daemon/watcher.go`:

- Use `github.com/fsnotify/fsnotify` to watch local directory
- On file change: debounce (500ms), then upload to folder9 via commit/files API
- Skip `.folder9/` metadata directory

Tests: file create triggers upload, file modify triggers upload, rapid changes debounced.

- [ ] **Step 4: Implement bidirectional + conflict handling**

For bidirectional mode (light dirs only):

- Pull + push both active
- Conflict: if remote changed AND local changed same file since last sync → rename local to `{name}.conflict`, pull remote version, log warning

Tests: conflict creates `.conflict` file, non-conflicting changes sync normally.

- [ ] **Step 5: Wire daemon entry point and commit**

`cmd/daemon/main.go`: start daemon, signal handling for graceful shutdown.
Add `folder9 daemon start` subcommand to CLI.

```bash
git add -A && git commit -m "feat: add folder9 daemon for local sync"
```

---

## Task Dependencies

```
Task 0 (scaffolding)
  └→ Task 1 (database)
       └→ Task 2 (auth + tokens)
            ├→ Task 3 (folders + access)
            │    ├→ Task 4 (git core)
            │    │    ├→ Task 6 (file REST API)
            │    │    │    └→ Task 7 (proposals)
            │    │    │         └→ Task 10 (webhooks)
            │    │    └→ Task 8 (git HTTP protocol)
            │    └→ Task 5 (light dirs)
            │         └→ Task 6 (file REST API)
            └→ Task 9 (WebDAV) — depends on Task 4 + Task 5
       └→ Task 11 (AI errors + skill.md) — can start after Task 2, finalize after all handlers
  └→ Task 12 (CLI) — depends on Tasks 6, 7 (needs working API)
       └→ Task 13 (daemon) — depends on Task 12
```

Linear execution order: 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13
