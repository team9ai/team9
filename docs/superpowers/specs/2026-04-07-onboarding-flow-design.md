# Onboarding Flow Design

## Overview

Add a guided onboarding experience for **self-registered users** (not invited users). After creating a workspace, users walk through a 6-step wizard that collects preferences and configures their workspace with channels, AI staff, and team invitations.

The design follows a **two-phase model**: collect all preferences first (Phase 1), then batch-create real resources after the user confirms (Phase 2). This ensures atomicity — no orphan resources if the user abandons mid-flow.

## Reference

UI and interaction design based on `/Users/jiangtao/Desktop/页面设计/onboarding-card-lab`.

## Trigger & Entry Point

- **Who:** Self-registered users only. Invited users will have a separate onboarding flow (out of scope).
- **When:** Immediately after registration + workspace creation.
- **Flow:** Register → Create Workspace (name input) → 6-step Onboarding → Provisioning → Main app.
- **Detection:** `_authenticated.tsx` `beforeLoad` checks if the user's workspace has a completed onboarding record. If not, redirect to `/onboarding`.
- **Skip:** Users can skip onboarding at any step. Skipping marks the onboarding as `skipped` and sends the user to the main app with default configuration.

## Internationalization (i18n)

The onboarding flow must support all languages configured in the app's i18n system (currently zh and en via `i18next`).

**Static UI text** (titles, descriptions, buttons, labels): Use the existing `i18next` namespace system. Add a new `onboarding` namespace with translation keys for all static strings.

**Step 1 role data**: The `onboarding_roles` table stores labels and categories as JSONB for multi-language support (e.g., `{ "zh": "产品经理", "en": "Product Manager" }`). The API returns the appropriate language based on the `Accept-Language` header or a `lang` query parameter.

**AI-generated content (Steps 2/3/4)**: The generation endpoints accept a `lang` parameter. The AI prompt instructs the model to generate tasks, channel names, and agent names/descriptions in the requested language. The frontend passes the current `i18n.language` value.

**Seed data**: Migration seeds include both zh and en translations for all 113 roles and 14 categories.

## UI Layout

Left-right split layout, matching the reference project:

- **Left panel (40%):** Step number, title, description, progress indicator bar (6 segments). Gradient background (brand blue).
- **Right panel (60%):** Interactive content area. White background.
- **Animations:** `card-enter` (700ms cubic-bezier), `chip-enter` (520ms ease) for step transitions.
- **Responsive:** At viewport < 960px, stack vertically (left panel on top, right panel below).

## Step-by-Step Design

### Step 1: Role Selection

**Title:** 先告诉我们你的工作

**Interaction:**

- Free-text input for job description
- Predefined role pills filtered by category tags
- Categories: 推荐, 金融, 法律, 咨询, 营销, 销售, 电商, 创作, Influencer, 设计, 技术, AI, 教育, 企业职能
- Featured roles shown in 推荐 tab
- Can select a predefined role OR type a custom description (or both)

**Data source:** `onboarding_roles` database table (seed-populated, API-served).

**Continue condition:** `description.trim() || selectedRole` is truthy.

**Saved data:**

```json
{
  "role": {
    "description": "string | null",
    "selectedRoleId": "uuid | null",
    "selectedRoleLabel": "string | null",
    "selectedTag": "string"
  }
}
```

### Step 2: Task Selection

**Title:** 选一个最接近真实工作的任务

**Interaction:**

- Display 3 AI-generated daily recurring tasks based on role + description from Step 1
- Each task has emoji + title
- Multi-select with checkbox-style indicators
- Custom task textarea below a divider
- Regenerate button in header to re-generate tasks
- Loading spinner during generation

**Data source:** Backend AI generation endpoint (`POST /v1/workspaces/:id/onboarding/generate-tasks`).

**Continue condition:** `selectedTaskIds.length > 0 || customTask.trim()`.

**Saved data:**

```json
{
  "tasks": {
    "generatedTasks": [
      { "id": "string", "emoji": "string", "title": "string" }
    ],
    "selectedTaskIds": ["string"],
    "customTask": "string | null"
  }
}
```

### Step 3: Channel Setup

**Title:** 我们先帮你准备一些频道

**Interaction:**

- Slack-style dark-themed preview UI
- Left sidebar shows channel list (up to 4 AI-generated channels)
- Main area shows a preview shell for the active channel
- Channel names are editable inline (click to edit)
- Auto-generated based on role and task selections

**Data source:** Backend AI generation endpoint (`POST /v1/workspaces/:id/onboarding/generate-channels`).

**Continue condition:** At least 1 channel draft exists.

**Saved data:**

```json
{
  "channels": {
    "channelDrafts": [{ "id": "string", "name": "string" }],
    "activeChannelId": "string"
  }
}
```

### Step 4: Agent Configuration

**Title:** 最后确认你的 Agent 组合

**Interaction:**

- Pyramid layout with visual connector lines
- Top: 1 main agent (Personal Staff — 🧑‍💼 私人秘书) with AI-generated description
- Bottom row: 3 child agents (Common Staff) with role-specific names and emojis
- Agent names are editable inline
- Main agent name is fixed ("私人秘书"), description is editable

**Agent mapping to Team9 Staff system:**

| Onboarding concept    | Team9 entity   | Creation method                 |
| --------------------- | -------------- | ------------------------------- |
| Main agent (私人秘书) | Personal Staff | `PersonalStaffService.create()` |
| Child agents × 3      | Common Staff   | `CommonStaffService.create()`   |

**Data source:** Backend AI generation endpoint (`POST /v1/workspaces/:id/onboarding/generate-agents`).

**Continue condition:** Agent draft exists (always true after generation).

**Saved data:**

```json
{
  "agents": {
    "main": {
      "emoji": "🧑‍💼",
      "name": "私人秘书",
      "description": "string"
    },
    "children": [{ "id": "string", "emoji": "string", "name": "string" }]
  }
}
```

### Step 5: Invite Collaboration

**Title:** 邀请你的同伴一起协作

**Interaction:**

- Display workspace invitation link (auto-generated)
- Copy-to-clipboard button with "已复制" feedback
- Dark-themed card design
- "Continue" and "Skip" options

**Data source:** Existing invitation system — `POST /v1/workspaces/:id/invitations` with `{ role: 'member' }`.

**Saved data:**

```json
{
  "invite": {
    "invitationCode": "string",
    "invitationUrl": "string"
  }
}
```

### Step 6: Pricing Plan

**Title:** 为你的 Workspace 选择一个合适的月卡

**Interaction:**

- Display subscription products from Billing Hub
- Two-column pricing card grid
- Each card: price, credits, feature list, selection indicator
- "Subscribe" triggers Stripe Checkout redirect
- "Skip" / free trial option available

**Data source:** Existing Billing Hub — `GET /v1/workspaces/:id/billing/products`.

**On selection:** Call `POST /v1/workspaces/:id/billing/checkout` → redirect to Stripe → return to `/onboarding?step=6&result=success`.

**Saved data:**

```json
{
  "plan": {
    "selectedPlan": "string | null",
    "checkoutCompleted": "boolean"
  }
}
```

## Database Design

### Table: `workspace_onboarding`

```sql
CREATE TABLE workspace_onboarding (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES im_users(id),
  status        TEXT NOT NULL DEFAULT 'in_progress',
  current_step  INT NOT NULL DEFAULT 1,
  step_data     JSONB NOT NULL DEFAULT '{}',
  version       INT NOT NULL DEFAULT 1,
  completed_at  TIMESTAMP,
  created_at    TIMESTAMP NOT NULL DEFAULT now(),
  updated_at    TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, user_id)
);
```

**Status values:**

- `in_progress` — User is going through the wizard
- `skipped` — User skipped onboarding
- `completed` — User finished all steps, awaiting provisioning
- `provisioning` — Batch resource creation in progress
- `provisioned` — All resources created successfully
- `failed` — Provisioning failed (can retry)

### Table: `onboarding_roles`

```sql
CREATE TABLE onboarding_roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  emoji       VARCHAR(10) NOT NULL,
  label       JSONB NOT NULL,       -- { "zh": "产品经理", "en": "Product Manager" }
  category    JSONB NOT NULL,       -- { "zh": "推荐", "en": "Recommended" }
  category_key VARCHAR(20) NOT NULL, -- canonical key for grouping (e.g. "recommended", "finance")
  featured    BOOLEAN DEFAULT false,
  sort_order  INT DEFAULT 0,
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMP NOT NULL DEFAULT now()
);
```

- `label` and `category` are JSONB with language codes as keys, supporting all i18n languages.
- `category_key` is a stable English identifier for grouping/filtering (language-independent).
- Seed-populated via migration with 113 roles from the reference project, with zh and en translations for all labels and categories.

## API Design

### Onboarding Endpoints

All endpoints require authentication (`JwtAuthGuard`) and workspace membership (`WorkspaceGuard`).

| Method | Endpoint                                          | Description                               |
| ------ | ------------------------------------------------- | ----------------------------------------- |
| GET    | `/v1/onboarding/roles`                            | List active roles grouped by category     |
| GET    | `/v1/workspaces/:id/onboarding`                   | Get current onboarding state              |
| PATCH  | `/v1/workspaces/:id/onboarding`                   | Update step_data and current_step         |
| POST   | `/v1/workspaces/:id/onboarding/generate-tasks`    | AI-generate 3 tasks from role/description |
| POST   | `/v1/workspaces/:id/onboarding/generate-channels` | AI-generate up to 4 channels              |
| POST   | `/v1/workspaces/:id/onboarding/generate-agents`   | AI-generate 1 main + 3 child agents       |
| POST   | `/v1/workspaces/:id/onboarding/complete`          | Trigger provisioning                      |

### AI Generation Endpoints

Request body for all generation endpoints:

```json
{
  "role": { "description": "string", "selectedRoleLabel": "string" },
  "tasks": { ... },  // only for generate-channels and generate-agents
  "lang": "zh"       // target language for generated content, from client i18n.language
}
```

The `lang` parameter is included in the AI prompt to ensure generated task titles, channel names, and agent names/descriptions are in the user's preferred language.

Response format follows the reference project's output structures. Streaming is optional (can use SSE for progressive display or simple JSON response).

### Roles Endpoint

`GET /v1/onboarding/roles?lang=zh`

Returns roles with labels resolved to the requested language:

```json
[
  {
    "id": "uuid",
    "emoji": "📊",
    "label": "产品经理",
    "categoryKey": "recommended",
    "category": "推荐",
    "featured": true
  }
]
```

If a label has no translation for the requested language, falls back to English.

### Provisioning (`POST /v1/workspaces/:id/onboarding/complete`)

Executes in order:

1. Validate `status === 'completed'` or `status === 'failed'` (allow retry)
2. Set status to `provisioning`
3. Create channels from `step_data.channels.channelDrafts` via existing channel creation logic
4. Create Personal Staff from `step_data.agents.main` via `PersonalStaffService.create()` (includes Hive registration)
5. Create Common Staff × 3 from `step_data.agents.children` via `CommonStaffService.create()` (includes Hive registration)
6. Store role/task preferences in workspace settings or user profile
7. Set status to `provisioned`, set `completed_at`
8. On any failure: set status to `failed`, log error, allow retry

## Frontend Architecture

### Route

- Path: `/_authenticated/onboarding`
- Full-screen layout (no sidebar, no top bar)
- Protected: requires auth token

### Redirect Logic

In `_authenticated.tsx` `beforeLoad`:

```
if (user has workspace AND workspace has no onboarding record with status 'provisioned' or 'skipped') {
  redirect to /onboarding
}
```

### i18n Namespace

Add a new `onboarding` namespace to `src/i18n/`:

- `locales/zh/onboarding.json` — Chinese translations for all static UI text (step titles, descriptions, buttons, placeholders)
- `locales/en/onboarding.json` — English translations
- Register in `src/i18n/index.ts` resources and ns array

All static text in onboarding components uses `useTranslation("onboarding")`.

### State Management

Component-local `useState` for all step data (matching reference project pattern). On each step transition, persist to backend via `PATCH /v1/workspaces/:id/onboarding`.

### Step Navigation

- Forward: "继续" button, validates current step's continue condition
- Backward: "返回" button or click on progress indicator
- Skip: "跳过" link on applicable steps

### Data Flow

```
Step 1 (role) → auto-trigger generate-tasks on entering Step 2
Step 2 (tasks) → auto-trigger generate-channels on entering Step 3
Step 3 (channels) → auto-trigger generate-agents on entering Step 4
Step 4 (agents) → no generation needed for Step 5
Step 5 (invite) → auto-create invitation on entering step
Step 6 (plan) → load billing products on entering step
```

Each generation uses a signature-based deduplication pattern (from reference project) to avoid duplicate API calls when navigating back and forth.

## Error Handling

- **AI generation failures:** Show error message with retry button (per step)
- **Network errors during save:** Auto-retry with exponential backoff, show toast on persistent failure
- **Provisioning failures:** Set status to `failed`, show error screen with "Retry" button that calls `complete` again
- **Stripe redirect failures:** User returns to Step 6, can retry checkout

## Future Considerations

- `version` field in `workspace_onboarding` supports schema evolution when the onboarding flow changes
- `onboarding_roles` table supports future admin UI for managing roles without code changes
- Invited user onboarding is a separate flow (out of scope, can share UI components)
