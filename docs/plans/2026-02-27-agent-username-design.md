# Agent Username Field Design

## Summary

Add a username field to the "Create New Agent" dialog so agents get readable usernames instead of auto-generated `bot_{hex}_{timestamp}` strings.

## Username Format

Pattern: `{name_in_snake_case}_{random_4_alphanumeric}_bot`

Example: Name "My Helper" → `my_helper_a3b2_bot`

## Frontend Changes

**File:** `apps/client/src/components/layout/contents/AIStaffMainContent.tsx`

- Add Username input field below the Name field in CreateAgentDialog
- Auto-generate username preview when user types Name (snake_case + random 4 chars + `_bot`)
- Field is editable — user can override the auto-generated value
- Validation: lowercase letters, numbers, underscores, 3-30 characters
- Display with `@` prefix hint

## Backend Changes

**Controller:** `apps/server/apps/gateway/src/applications/installed-applications.controller.ts`

- Accept optional `username` parameter in create agent endpoint
- Fall back to existing auto-generation if not provided

**Bot Service:** `apps/server/apps/gateway/src/bot/bot.service.ts`

- `createWorkspaceBot()` accepts optional `username` parameter
- Use provided username when present, otherwise use existing auto-generation
- Validate username uniqueness, return error on conflict

## Data Flow

```
User types Name → Frontend auto-generates username preview →
User can edit username → Submit { displayName, username, description? } →
Backend validates username uniqueness → Create im_users + im_bots records
```
