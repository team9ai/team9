# Skills Module Design

**Date:** 2026-03-09
**Status:** Approved

## Overview

Add a new "Skills" (技能) module as a top-level sidebar navigation entry between Tasks and Library. Skills are workspace-level shared agent capabilities — reusable instruction sets, prompt templates, and tool definitions that Agents consume during task execution. Each Skill is conceptually a git folder containing files, with version snapshots and AI-suggested changes with human approval.

Based on Claude Code skill format (markdown with frontmatter), compatible with general formats. Demo phase: JSON-simulated file system, no real git backend.

## Skill Types

| Type                | Description                                                                   |
| ------------------- | ----------------------------------------------------------------------------- |
| `claude_code_skill` | Claude Code skill format — markdown with name/description/trigger frontmatter |
| `prompt_template`   | Reusable prompt templates with variable placeholders                          |
| `general`           | General-purpose skill — arbitrary files (code, config, docs)                  |

## Data Model

### Approach: Three-Table Separation (skills + skill_versions + skill_files)

`skills` holds metadata, `skill_versions` holds version snapshots with a JSONB file manifest, `skill_files` holds actual file content. Files are deduplicated across versions via manifest references.

### Table 1: `skills`

| Column            | Type               | Description                                       |
| ----------------- | ------------------ | ------------------------------------------------- |
| `id`              | UUID PK            |                                                   |
| `tenant_id`       | UUID FK → tenants  | Workspace ownership                               |
| `name`            | VARCHAR(255)       | Display name                                      |
| `description`     | TEXT               | Optional description                              |
| `type`            | enum `skill__type` | `claude_code_skill`, `prompt_template`, `general` |
| `icon`            | VARCHAR(64)        | Optional emoji or icon identifier                 |
| `current_version` | INTEGER            | Points to latest `published` version              |
| `creator_id`      | UUID FK → users    | Creator                                           |
| `created_at`      | TIMESTAMP          |                                                   |
| `updated_at`      | TIMESTAMP          |                                                   |

**Indexes:**

- `idx_skills_tenant_id` on `(tenant_id)`

### Table 2: `skill_versions`

| Column          | Type                         | Description                                                |
| --------------- | ---------------------------- | ---------------------------------------------------------- |
| `id`            | UUID PK                      |                                                            |
| `skill_id`      | UUID FK → skills (CASCADE)   | Parent Skill                                               |
| `version`       | INTEGER                      | Version number, starts at 1                                |
| `message`       | VARCHAR(255)                 | Version description (optional)                             |
| `status`        | enum `skill_version__status` | `draft`, `published`, `suggested`, `rejected`              |
| `file_manifest` | JSONB                        | File list: `[{"path": "skill.md", "fileId": "uuid"}, ...]` |
| `suggested_by`  | VARCHAR(64)                  | Source of suggestion, e.g. bot ID (nullable)               |
| `creator_id`    | UUID FK → users              | Committer                                                  |
| `created_at`    | TIMESTAMP                    |                                                            |

**Indexes:**

- UNIQUE on `(skill_id, version)`

### Table 3: `skill_files`

| Column       | Type                       | Description                                     |
| ------------ | -------------------------- | ----------------------------------------------- |
| `id`         | UUID PK                    |                                                 |
| `skill_id`   | UUID FK → skills (CASCADE) | Parent Skill                                    |
| `path`       | VARCHAR(1024)              | File path, e.g. `skill.md` or `prompts/main.md` |
| `content`    | TEXT                       | File content                                    |
| `size`       | INTEGER                    | Content byte size                               |
| `created_at` | TIMESTAMP                  |                                                 |

**Indexes:**

- `idx_skill_files_skill_id` on `(skill_id)`

### Version Status Flow

```
draft → published          (user manually publishes)
suggested → published      (human approves AI suggestion)
suggested → rejected       (human rejects)
```

- `published`: Active version. `skills.current_version` always points to the latest published version.
- `suggested`: AI-submitted change proposal. Appears in detail page's review area for human diff review and approve/reject.
- `draft`: User work-in-progress (optional, can skip for demo).
- `rejected`: Declined suggestion, kept for audit trail.

### Version Workflow

- **Read a version**: Query `skill_versions` for `file_manifest`, batch-fetch referenced `skill_files` by `fileId`.
- **Save new version**: Write new/modified files to `skill_files`, reuse unchanged file IDs, assemble new `file_manifest`, insert `skill_versions` row, update `skills.current_version`.
- **File deduplication**: Unchanged files share the same `skill_files` row across versions.

## Backend API

### Skill CRUD

```
POST   /v1/skills              Create skill (supports blank/template/upload)
GET    /v1/skills              List (supports ?type= filter)
GET    /v1/skills/:id          Detail (includes current version file list)
PATCH  /v1/skills/:id          Update name/description/icon
DELETE /v1/skills/:id          Delete (CASCADE deletes versions + files)
```

### Version Management

```
GET    /v1/skills/:id/versions                List versions
GET    /v1/skills/:id/versions/:version        Get specific version (with file_manifest)
POST   /v1/skills/:id/versions                Create new version (publish or suggest)
PATCH  /v1/skills/:id/versions/:version        Review operation (approve/reject)
```

Create version body:

```typescript
{
  message?: string;
  files: { path: string; content: string }[];  // Complete file list
  status: 'published' | 'suggested';
  suggestedBy?: string;  // bot ID
}
```

### Single File Operations (convenience endpoints, operate on current version)

```
GET    /v1/skills/:id/files/:path     Read file content
PUT    /v1/skills/:id/files/:path     Create/update file (auto-generates new version)
DELETE /v1/skills/:id/files/:path     Delete file (auto-generates new version)
```

## Frontend

### Sidebar Navigation

Insert between Tasks and Library in `MainSidebar.tsx`:

```typescript
{ id: "skills", labelKey: "skills" as const, icon: Sparkles }
```

Update `SidebarSection` type, `ALL_SIDEBAR_SECTIONS`, `DEFAULT_SECTION_PATHS`, `getSectionFromPath()` in `useAppStore.ts`.

Routes: `/skills` → list page, `/skills/:id` → detail page.

i18n keys: `navigation.skills` → EN: "Skills", ZH: "技能"

### List Page (`/skills`)

- Top: title + filter tabs (All | Claude Code Skill | Prompt Template | General)
- Top-right: "+ Create" button
- Card grid displaying each Skill:
  - Icon + name
  - Description (truncated)
  - Type badge
  - File count + current version number
  - Pending suggestion indicator (red dot when suggested versions exist)
- Click card → navigate to `/skills/:id` detail page

### Detail Page (`/skills/:id`)

Full-screen layout, left-right split:

**Left panel: File tree**

- Tree view of all files/folders in current version
- Context menu: new file, rename, delete
- Top: version dropdown selector (switch to view historical versions)
- "Upload File" button

**Right panel: Editor area**

- Click file → display content (Markdown rendering / code highlighting)
- Edit mode: text editor, save generates new version
- Top breadcrumb: Skills > skill name > file path

**Review area** (shown when suggested versions exist):

- Banner or tab: "AI suggested changes"
- Diff view (current published vs suggested)
- Approve / Reject buttons

### Create Skill Dialog

Step 1: Select creation method

- Blank — empty skill
- From Template — select from presets
- Upload Files — drag & drop

Step 2: Fill basic info

- Name (required)
- Description (optional)
- Type selection (claude_code_skill / prompt_template / general)

Step 3 (template): Preview template files → confirm
Step 3 (upload): Drag & drop upload → confirm

### Preset Templates

Demo phase: 2 built-in templates, hardcoded in frontend at `apps/client/src/constants/skillTemplates.ts`. Can migrate to backend later.

**Claude Code Skill template:**

```
skill.md — frontmatter (name, description, trigger) + example instructions
```

**Prompt Template:**

```
prompt.md       — main prompt with {{variable}} placeholders
variables.json  — variable definitions
```

## i18n

New `skills` namespace with EN and ZH translations covering:

- `tabs.*` — filter tab labels
- `create.*` — creation dialog fields
- `detail.*` — detail page elements
- `version.*` — version management labels
- `status.*` — version status labels

## Extensibility Considerations

- **Real Git Backend**: Replace `skill_files` table with git storage read/write. `skill_versions` maps to git commits. API layer unchanged.
- **Authorization Model**: Add `authorizations` JSONB to `skills` table or standalone authorization table. Add authorize/revoke endpoints.
- **AI Suggestion Enhancements**: Attach AI rationale (reason field) to suggested versions. Support partial adoption (per-file approve) during review.
- **Skill Marketplace**: Publish skills to a public marketplace. Other workspaces can fork/import.
- **Runtime Binding**: Task creation can bind skills. Agent execution auto-loads bound skill files.
- **Webhook/Event Triggers**: Skill file changes trigger notifications or automatic agent reload.
