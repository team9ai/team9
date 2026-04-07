# Common Staff System Design

> Date: 2026-04-04
> Status: Draft
> Author: Winrey + Claude

## Overview

Integrate a formal AI employee system into Team9, backed by the `team9-common-staff` blueprint from agent-hive. This application is an auto-installed, non-uninstallable, managed singleton component. It coexists with the existing `base-model-staff` (direct base-model pass-through); `common-staff` represents fully-profiled "formal employees" with identity, role, and persona.

## Relationship with Existing System

| Aspect                  | base-model-staff                | common-staff (this design)               |
| ----------------------- | ------------------------------- | ---------------------------------------- |
| Type                    | singleton, autoInstall, custom  | singleton, autoInstall, **managed**      |
| Bots created on install | 3 fixed (Claude/ChatGPT/Gemini) | 0                                        |
| User can uninstall      | Yes (type=custom)               | **No** (type=managed)                    |
| Bots deletable          | No                              | **Yes**                                  |
| Blueprint               | `team9-hive-base-model`         | `team9-common-staff`                     |
| Profile management      | None                            | Yes (name/role/persona)                  |
| Mentor system           | Implicit (installer)            | Explicit (any workspace member)          |
| Model selection         | Fixed per bot                   | User-selected, default Claude Sonnet 4.6 |
| Bootstrap flow          | None                            | Supported via mentor DM                  |

## 1. Application Definition

Add to the `APPLICATIONS` array:

```typescript
{
  id: 'common-staff',
  name: 'Common Staff',
  description: 'AI employee system with profile, role, and mentor bootstrap',
  iconUrl: '/icons/common-staff.svg',
  categories: ['ai', 'bot'],
  enabled: true,
  type: 'managed',        // Cannot be uninstalled or disabled
  singleton: true,         // One per workspace
  autoInstall: true,       // Installed on workspace creation
}
```

### CommonStaffHandler

- `applicationId: 'common-staff'`
- `onInstall()`: No-op — creates zero bots, returns empty config. The app exists purely as a container.
- Uninstall protection is handled automatically at the service layer via `type: 'managed'` (`ForbiddenException`).

## 2. Backend API — Staff CRUD

All endpoints live under `InstalledApplicationsController`, require `JwtAuthGuard` + workspace membership verification.

### Create Staff

```
POST /v1/installed-applications/:id/common-staff/staff
Body: {
  displayName: string          // Required
  roleTitle?: string           // Optional (left empty in agentic mode; required by frontend in form mode)
  mentorId?: string            // Optional, server defaults to currentUser
  persona?: string             // Optional
  jobDescription?: string      // Optional
  model: {                     // Required, default { provider: "anthropic", id: "claude-sonnet-4-6" }
    provider: string
    id: string
  }
  avatarUrl?: string           // Optional
  agenticBootstrap?: boolean   // true = agentic creation path
}
Response: { botId, userId, agentId, displayName }
```

**Flow:**

1. Verify the app is `common-staff` type
2. `createWorkspaceBot()` — create bot with access token
3. `clawHiveService.registerAgent()` — register with claw-hive
4. Create DM channels for all workspace members
5. If `agenticBootstrap === true`: trigger bootstrap event (see Section 7)
6. Return bot info

### Update Staff

```
PATCH /v1/installed-applications/:id/common-staff/staff/:botId
Body: {
  displayName?: string
  roleTitle?: string
  persona?: string
  jobDescription?: string
  model?: { provider: string; id: string }
  avatarUrl?: string
  mentorId?: string
}
```

Syncs updates to both the team9 bot record and claw-hive agent via `clawHiveService.updateAgent()`.

### Delete Staff

```
DELETE /v1/installed-applications/:id/common-staff/staff/:botId
```

1. `clawHiveService.deleteAgent()` — unregister from claw-hive
2. `botService.deleteBotAndCleanup()` — delete bot + DM channels

### List Query

Reuse existing `GET /v1/installed-applications/with-bots`, including common-staff bots in the response.

## 3. Backend API — Persona Streaming Generation

```
POST /v1/installed-applications/:id/common-staff/generate-persona
Body: {
  displayName?: string
  roleTitle?: string
  existingPersona?: string    // Existing persona to expand upon
  prompt?: string              // User instructions, e.g. "make it more cheerful", "add a love for coffee"
}
Response: SSE stream (text/event-stream)
```

- Uses the API key configured via Gateway environment variables
- All fields are optional; context is assembled from whatever is provided
- `prompt` is injected as user guidance with highest priority
- When `existingPersona` is present, expands/refines rather than regenerating from scratch
- **Style:** Personality-rich and interesting — includes character traits, communication style, work habits, quirks. Not a dry job description.
- Not persisted — frontend receives the stream and lets the user confirm before filling the form
- Requires JwtAuthGuard authentication

## 4. Backend API — Avatar AI Generation

```
POST /v1/installed-applications/:id/common-staff/generate-avatar
Body: {
  style: 'realistic' | 'cartoon' | 'anime' | 'notion-lineart'
  displayName?: string
  roleTitle?: string
  persona?: string
  prompt?: string              // Extra instructions, e.g. "wears glasses", "short red hair"
}
Response: { avatarUrl: string }
```

- Uses image generation API key from Gateway environment variables
- Each style has a base prompt template, combined with staff info for generation
- Result is uploaded to the file service, returns a URL
- Requires JwtAuthGuard authentication

**Preset Styles:**

| Style            | Description                         |
| ---------------- | ----------------------------------- |
| `realistic`      | Photorealistic portrait             |
| `cartoon`        | Cartoon/illustration style          |
| `anime`          | Anime style                         |
| `notion-lineart` | Notion-style black & white line art |

## 5. Backend API — Candidate Generation (Recruitment Mode)

```
POST /v1/installed-applications/:id/common-staff/generate-candidates
Body: {
  jobTitle?: string
  jobDescription?: string
}
Response: SSE stream (text/event-stream)
```

- Streams 3 candidate role cards (each with displayName, roleTitle, persona, personality summary)
- Frontend renders candidates progressively as badge cards
- User selects one candidate, or clicks "re-roll" to regenerate
- Requires JwtAuthGuard authentication

## 6. Claw-Hive Registration

After bot creation, register with claw-hive via `clawHiveService.registerAgent()`:

```typescript
clawHiveService.registerAgent({
  id: `common-staff-${botId}`,
  name: displayName,
  blueprintId: "team9-common-staff",
  tenantId,
  model: { provider, id },
  metadata: { tenantId, botId, mentorId },
  componentConfigs: {
    "system-prompt": { prompt: "You are a helpful AI assistant." },
    team9: {
      team9AuthToken: accessToken,
      botUserId: bot.userId,
      team9BaseUrl: env.API_URL,
    },
    "team9-staff-profile": {},
    "team9-staff-bootstrap": {},
    "team9-staff-soul": {},
  },
});
```

- **On update:** `clawHiveService.updateAgent()` to sync name, model, componentConfigs
- **On delete:** `clawHiveService.deleteAgent()` to unregister

### Data Storage

Common-staff-specific fields (roleTitle, persona, jobDescription, model) are stored in the `im_bots.extra` JSONB column:

```typescript
interface BotExtra {
  openclaw?: { ... }           // Existing
  commonStaff?: {              // New
    roleTitle?: string
    persona?: string
    jobDescription?: string
    model: { provider: string; id: string }
  }
}
```

These fields are also synced to the agent side via claw-hive `componentConfigs` (the `team9-staff-profile` component reads them from the Team9 API).

## 7. Agentic Creation Path

Additional flow when `agenticBootstrap === true`:

### Temporary Identity

- displayName uses the user-provided name; if empty, auto-generates a temp name (e.g. "Candidate #1", "Candidate #2", incrementing)
- roleTitle / persona are left empty, to be filled during bootstrap

### Triggering Bootstrap

After creation, the team9 server:

1. Finds the DM channel between the mentor and the bot
2. Triggers a session via the WebSocket gateway, reusing the existing DM message → session creation flow
3. Session context includes `isMentorDm: true` and a bootstrap trigger marker

The implementation must match the existing claw-hive session creation mechanism (WebSocket gateway DM message triggering session assign).

- `team9-staff-bootstrap` component detects `isMentorDm: true` and enables profile editing
- Agent sends a welcome message, guiding the mentor through name → role → persona setup

### Bootstrap Completion

- Once identity.name + role.title + persona.markdown are all filled
- Agent automatically switches to normal working mode

## 8. Frontend — Create Dialog (Multi-Step)

### Step 1 (Shared): Choose Creation Mode

Three option cards:

- **Form Mode** — Fill in all information directly
- **Agentic Mode** — AI guides the mentor through setup in a private DM
- **Recruitment Mode** — Enter a JD, AI generates candidates to choose from

### Form Mode

**Step 2: Basic Info**

- Display Name (required)
- Role Title (required)
- Job Description (optional)
- Mentor (dropdown, defaults to current user)
- Model (dropdown, defaults to Claude Sonnet 4.6)

**Step 3: Personality & Attributes**

- Persona textarea + "AI Generate" button (streams content, can be invoked multiple times to expand)
- Additional attribute fields

**Step 4: Avatar**

- Upload custom avatar
- Select from presets
- AI generate (choose style: realistic/cartoon/anime/notion-lineart)
- Final preview as 3D badge card

### Agentic Mode

**Step 2: Configuration**

- Model (dropdown, defaults to Claude Sonnet 4.6)
- On submit: create bot → trigger bootstrap → navigate to mentor DM

### Recruitment Mode

**Step 2: Job Requirements**

- Job Title (optional)
- JD / Job Description (optional)

**Step 3: Candidate Selection**

- AI streams 3 candidates, displayed as 3D badge cards
- Candidates are editable after generation completes
- Select one candidate, or click "re-roll" to regenerate

**Step 4: Configuration**

- Model (dropdown, defaults to Claude Sonnet 4.6)
- Mentor (dropdown, defaults to current user)
- Submit to create

## 9. Frontend — Detail Page

Add common-staff sections to `AIStaffDetailContent`.

### Profile Card

- Avatar (clickable to change: upload/preset/AI regenerate)
- Display Name (inline edit)
- Role Title (inline edit)
- Status badge (online/offline)
- "Chat" button to navigate to DM

### Info Section

| Field           | Editable | Notes                            |
| --------------- | -------- | -------------------------------- |
| Persona         | Yes      | Text edit + AI regenerate button |
| Model           | Yes      | Dropdown switch                  |
| Mentor          | Yes      | Dropdown, workspace members      |
| Job Description | Yes      | Text edit                        |
| Created At      | No       | Read-only                        |

More modules will be added in the future.

### Actions

- Edits sync to both team9 bot and claw-hive agent
- "Delete Staff" button with confirmation dialog

### Type Discrimination

New type guard for common-staff bots: check `managedProvider === 'hive'` + `managedMeta.agentId` starts with `common-staff-` prefix.

## 10. 3D Badge Card Component — StaffBadgeCard

Reference: [Vercel 3D Event Badge](https://vercel.com/blog/building-an-interactive-3d-event-badge-with-react-three-fiber).

### Tech Stack

- React Three Fiber + Drei + react-three-rapier
- Physics-based lanyard suspension, draggable with swinging
- Flip interaction (click or drag to rotate)
- Dynamic text rendering via Drei's RenderTexture

### Card Content

**Front:**

- Avatar (large)
- Display Name
- Role Title
- Mentor name/avatar

**Back (flip to reveal):**

- Persona summary
- Model

### Usage

1. Form Mode Step 4 — preview before creation
2. Recruitment Mode Step 3 — display 3 candidates as badge cards
3. AI Staff list page — reuse badge component for staff cards

### Fallback

WebGL-unsupported environments fall back to 2D cards with CSS flip animation.

## 11. Frontend — API Client

Add to `apps/client/src/services/api/applications.ts`:

```typescript
// Staff CRUD
createCommonStaff(appId, body): Promise<{ botId, userId, agentId, displayName }>
updateCommonStaff(appId, botId, body): Promise<void>
deleteCommonStaff(appId, botId): Promise<void>

// AI Generation
generatePersona(appId, body): EventSource (SSE stream)
generateAvatar(appId, body): Promise<{ avatarUrl: string }>
generateCandidates(appId, body): EventSource (SSE stream)
```

### New Types

```typescript
interface CommonStaffBotInfo {
  botId: string;
  userId: string;
  username: string;
  displayName: string | null;
  roleTitle: string | null;
  persona: string | null;
  jobDescription: string | null;
  avatarUrl: string | null;
  model: { provider: string; id: string };
  mentorId: string | null;
  mentorDisplayName: string | null;
  mentorAvatarUrl: string | null;
  isActive: boolean;
  createdAt: string;
  managedMeta: { agentId: string };
}
```

## 12. Hardcoded Model List

Keys are managed via OpenRouter on the claw-hive side. Team9 only maintains the selectable list:

```typescript
const COMMON_STAFF_MODELS = [
  {
    provider: "anthropic",
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    default: true,
  },
  { provider: "anthropic", id: "claude-opus-4-6", label: "Claude Opus 4.6" },
  { provider: "openai", id: "gpt-4.1", label: "GPT-4.1" },
  { provider: "openai", id: "o3", label: "o3" },
  { provider: "google", id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
];
```

Runtime keys are managed by claw-hive; team9 is not involved.
