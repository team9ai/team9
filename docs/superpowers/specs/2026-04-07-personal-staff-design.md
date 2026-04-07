# Personal Staff + Staff Sidebar Refactor Design Spec

**Date:** 2026-04-07
**Status:** Implemented

## Overview

Personal Staff is a per-user, per-workspace AI assistant. Each user has exactly one within a workspace. Unlike Common Staff (shared, workspace-level AI employees), Personal Staff is private by default — only the owner can see and interact with it.

This spec also covers two related changes:

1. **Sidebar refactor:** "AI Staff" → "Staff" with categorized display (personal / AI / human)
2. **DM lazy creation:** Staff creation no longer batch-creates DM channels; DMs are created on-demand when a user clicks "Chat"

## Scope

### In Scope

- Personal Staff data model, API, service layer
- Claw-Hive blueprint and agent registration
- Staff sidebar refactor (AI Staff → Staff)
- DM lazy creation for all staff types
- Visibility / permission system for Personal Staff
- Auto-install of managed applications (new workspaces)
- Migration script for old workspaces (install common-staff, personal-staff, base-model-staff)
- Member lifecycle: auto-create on join, auto-cleanup on leave

### Out of Scope

- Personal Staff onboarding flow (future spec)
- Cross-workspace memory sharing
- Personal Staff in channels (future: proxy messaging)

## Data Model

### Reuse `im_bots` Table

Personal Staff reuses the existing bot infrastructure. No new tables needed.

**Key fields:**

| Field                    | Value for Personal Staff                   |
| ------------------------ | ------------------------------------------ |
| `userId`                 | Shadow user (userType='bot') in `im_users` |
| `ownerId`                | The user who owns this personal staff      |
| `mentorId`               | Always equals `ownerId`, immutable         |
| `installedApplicationId` | FK to `personal-staff` managed application |
| `managedProvider`        | `'hive'`                                   |
| `managedMeta`            | `{ agentId: "personal-staff-{botId}" }`    |
| `type`                   | `'custom'`                                 |
| `isActive`               | `true`                                     |

### BotExtra Extension

```typescript
interface BotExtra {
  commonStaff?: { ... };          // Existing
  personalStaff?: {               // New
    persona?: string;
    model: { provider: string; id: string };
    visibility: {
      allowMention: boolean;      // Allow others to @mention, default false
      allowDirectMessage: boolean; // Allow others to DM, default false
    };
  };
}
```

### Fixed Fields (Not Stored in DB)

These are hardcoded constants, not user-configurable:

- **roleTitle:** "Personal Assistant" (or localized equivalent)
- **jobDescription:** "Personal AI assistant for {ownerDisplayName}"

### Uniqueness Constraint

`UNIQUE(ownerId, installedApplicationId)` — one personal staff per user per workspace.

Since `installedApplicationId` is already scoped to a tenant, this effectively enforces one per user per workspace.

### Display Fields

`displayName` and `avatarUrl` are stored on the shadow user record in `im_users` (same as Common Staff).

## Backend API & Service Layer

### Service Refactoring

Extract shared logic from `CommonStaffService` into a base `StaffService`:

```
StaffService (shared base)
├── createBot / updateBot / deleteBot
├── registerAgent (claw-hive)
├── generatePersona / generateAvatar
└── DM channel lazy creation helper

CommonStaffService (uses StaffService)
├── createStaff — multiple staff, no uniqueness constraint
├── Full customization (roleTitle, jobDescription, persona, model, mentor...)
├── Existing behavior unchanged (except DM no longer batch-created)

PersonalStaffService (uses StaffService)
├── createStaff — uniqueness check (ownerId + tenantId)
├── roleTitle / jobDescription hardcoded
├── mentorId fixed to ownerId
├── visibility management (allowMention, allowDirectMessage)
├── Bootstrap flow (auto-trigger agentic bootstrap after creation)
```

### Personal Staff API Endpoints

All under `POST/PATCH/DELETE/GET /v1/installed-applications/{appId}/personal-staff/staff`

```
POST   /staff          # Create (with uniqueness validation)
PATCH  /staff          # Update (no botId needed — one per user)
DELETE /staff          # Delete
GET    /staff          # Get current user's personal staff
```

No `{botId}` path parameter needed — the backend resolves via current user + workspace.

**CreatePersonalStaffDto:**

```typescript
{
  displayName?: string;           // Auto-generated if omitted
  persona?: string;               // Optional, can be set via bootstrap
  model: {                        // Required
    provider: string;
    id: string;
  };
  avatarUrl?: string;             // Optional
  agenticBootstrap?: boolean;     // Default true — trigger bootstrap interview
}
```

**UpdatePersonalStaffDto:**

```typescript
{
  displayName?: string;
  persona?: string;
  model?: { provider: string; id: string };
  avatarUrl?: string;
  visibility?: {
    allowMention?: boolean;
    allowDirectMessage?: boolean;
  };
}
```

Note: `roleTitle`, `jobDescription`, `mentorId` are NOT in update DTO — they cannot be changed.

### Visibility Permission Checks

When a non-owner user attempts to interact with someone's personal staff:

- **Create DM:** Check `visibility.allowDirectMessage`. If false → 403 with message: "This is a private assistant and is not open for direct messages."
- **@mention in channel:** Check `visibility.allowMention`. If false → 400 with message: "This is a private assistant and is not open for @mentions."
- **Search results:** Personal staff with both flags false should not appear in non-owner's search results.

## Claw-Hive Agent Layer

### New Blueprint: `team9-personal-staff`

Reuses all Common Staff components. Differences are config-driven, not code-driven.

```typescript
export const TEAM9_PERSONAL_STAFF_BLUEPRINT: HiveBlueprint = {
  id: "team9-personal-staff",
  name: "Team9 Personal Staff",
  description: "Personal AI assistant scoped to a single user",
  components: [
    "system-prompt",
    "team9",
    "team9-staff-profile",
    "team9-staff-soul", // May use personal-assistant variant
    "team9-staff-bootstrap",
    "tool-tier",
    "agent-control",
    "hive-wait",
  ],
  componentSchemas: {
    /* same as common-staff */
  },
};
```

### Config Differences at Registration Time

When Gateway registers a personal staff agent with claw-hive:

1. **`team9` component config:** includes `ownerUserId` field
2. **`team9-staff-profile`:** roleTitle and jobDescription are written as fixed values by Gateway; `UpdateStaffProfile` tool will not allow modifying them during bootstrap
3. **`team9-staff-soul`:** injects a personal-assistant SOUL variant via config (`soulVariant: "personal-assistant"`). Falls back to the default common-staff SOUL if variant is not defined yet. The personal-assistant SOUL emphasizes: private assistant identity, owner-centric loyalty, discretion about owner's information
4. **`team9-staff-bootstrap`:** `isMentorDm` is always `true` for the owner's DM (owner = mentor)

### No New Components Needed

Access control (non-owner can't interact) is enforced at the Gateway layer via DM creation permissions and visibility settings. By the time a message reaches the agent, it's already authorized.

## Staff Sidebar Refactor

### Rename: "AI Staff" → "Staff"

The sidebar section currently showing only AI members is expanded to show all staff types with categorization.

### Layout

```
Staff
├── 📌 My Personal Staff
│   └── Alex (Personal Assistant)     ← Only visible to owner (unless permissions opened)
├── 🤖 AI Staff
│   ├── HR Bot                        ← Common Staff
│   ├── DevOps Assistant              ← Common Staff
│   └── Bob's Assistant               ← Other user's Personal Staff (if permissions opened)
└── 👥 Members
    ├── Alice
    ├── Bob
    └── Charlie
```

### Category Logic

- **My Personal Staff:** Current user's personal staff. Always at top. Max one entry.
- **AI Staff:** All Common Staff bots + other users' Personal Staff that have opened visibility (allowMention or allowDirectMessage is true).
- **Members:** Human workspace members.

### Interaction

- Each entry has a **Chat** button → creates DM on click (lazy creation)
- Personal Staff entries of other users show a lock icon if permissions are restricted
- Clicking Chat on a restricted Personal Staff shows a permission denied toast with message about it being a private assistant

## DM Lazy Creation

### Change from Current Behavior

**Before (Common Staff):** Creating a staff bot batch-creates DM channels with ALL workspace members.

**After (All Staff Types):** DM channels are created on-demand.

### Creation Flow

- **Personal Staff creation:** Creates exactly ONE DM — owner ↔ bot (needed for bootstrap)
- **Common Staff creation:** Creates NO DMs at creation time
- **User clicks Chat on any staff:** Calls existing `createDirectChannel` endpoint → DM created if not exists
- **Personal Staff permission check:** If non-owner clicks Chat and `allowDirectMessage` is false → reject with message

### Impact on Common Staff

Existing Common Staff behavior changes: DMs are no longer pre-created. Users click Chat to initiate. This is a non-breaking change — the DM creation API already exists, it just wasn't used this way.

## Visibility & Permissions

### Default State

Personal Staff is fully private:

- `allowMention: false`
- `allowDirectMessage: false`

### Configurable via Settings

Owner can toggle each flag independently in the Personal Staff detail panel.

### UI Warning

When enabling either permission, show a warning dialog:

> **Privacy Notice**
>
> Enabling this will allow other workspace members to interact with your personal assistant. Your assistant may reference information from your previous conversations when responding to others. Please be aware of potential information exposure.

### Permission Enforcement Points

| Action                                | Check                                  | Failure Response           |
| ------------------------------------- | -------------------------------------- | -------------------------- |
| Create DM with others' Personal Staff | `allowDirectMessage`                   | 403 + toast message        |
| @mention in channel message           | `allowMention`                         | 400 + inline error         |
| Search/autocomplete @mention          | `allowMention`                         | Excluded from results      |
| View in sidebar                       | `allowMention \|\| allowDirectMessage` | Not shown in AI Staff list |

## Auto-Install & Migration

### New Workspaces

On workspace creation, auto-install three managed applications:

1. `common-staff`
2. `personal-staff`
3. `base-model-staff`

### Old Workspace Migration Script

One-time script that:

1. Scans all tenants
2. For each tenant, checks installed applications
3. Installs missing managed applications:
   - `common-staff` (if missing)
   - `personal-staff` (if missing)
   - `base-model-staff` (if missing, including preset bots)
4. For newly installed `personal-staff`: creates a personal staff bot for each existing workspace member with:
   - Default model: Claude Sonnet 4.6 (`{ provider: "anthropic", id: "claude-sonnet-4-6" }`)
   - Auto-generated display name (e.g., "Personal Assistant #1")
   - Empty persona (bootstrap not yet completed)
   - Bootstrap is NOT auto-triggered during migration — the bot is created in a "pending bootstrap" state (persona is empty). Users see a prompt in the DM to complete setup when they first open it

### Member Lifecycle

**On member join:**

1. Auto-create one personal staff bot for the new member
2. Create owner ↔ bot DM channel
3. Trigger agentic bootstrap in the DM

**On member leave:**

1. Delete the member's personal staff bot
2. Clean up associated DM channels (owner ↔ bot, and any opened DMs with other members)
3. Deregister claw-hive agent

## Code Reuse Strategy

The goal is maximum reuse with Common Staff. Key approach:

1. **Extract `StaffService`** from `CommonStaffService` — shared bot CRUD, claw-hive registration, persona/avatar generation
2. **`PersonalStaffService`** and `CommonStaffService` both use `StaffService`
3. **`PersonalStaffController`** mirrors `CommonStaffController` structure but with simplified endpoints (no botId params)
4. **Claw-Hive components** are 100% reused — differences are config-only
5. **Frontend components:** Extract shared staff UI (profile editing, avatar selection, model picker) into reusable components used by both Common Staff and Personal Staff detail views
