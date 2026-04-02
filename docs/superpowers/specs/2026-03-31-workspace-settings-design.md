# Workspace Settings Page Design

## Overview

Add a workspace settings page at `/more/workspace-settings` where owners and admins can edit the workspace name, slug, and logo. Non-admin users do not see the entry point.

## Scope

- Frontend only. The backend `PATCH /v1/workspaces/:workspaceId` endpoint already exists with owner/admin guard and supports `name`, `slug`, `logoUrl` fields.
- No new backend changes required.

## Entry Point

In **MoreMainContent**, add a "Workspace Settings" item to the Workspace section. This item is **only visible** to users whose role is `owner` or `admin` (determined via `useCurrentWorkspaceRole()`).

Clicking it navigates to `/more/workspace-settings`.

## Route

**File:** `apps/client/src/routes/_authenticated/more/workspace-settings.tsx`

Standard TanStack Router file route rendering the `WorkspaceSettingsContent` component.

## Page Component

**File:** `apps/client/src/components/layout/contents/WorkspaceSettingsContent.tsx`

### Layout

Standard content page layout consistent with Members page:
- Header: back arrow + "Workspace Settings" title
- Content area inside `ScrollArea`

### Form Fields

1. **Logo**
   - Displays current workspace logo as a rounded-square preview (64x64)
   - If no logo set, shows a placeholder with workspace initial
   - Hover overlay with camera icon indicating clickable
   - Click triggers hidden `<input type="file" accept="image/jpeg,image/png,image/webp,image/svg+xml">`
   - Max file size: 5MB (validated client-side before upload)
   - Upload flow: `useFileUpload` hook → presign → S3 upload (visibility: `workspace`) → confirm → set publicUrl as `logoUrl`
   - Shows loading spinner during upload

2. **Name**
   - Text input, required
   - Min 2, max 100 characters (matches `UpdateWorkspaceDto`)
   - Pre-filled with current workspace name

3. **Slug**
   - Text input, required
   - Min 2, max 50 characters
   - Pattern: lowercase letters, numbers, hyphens only (`/^[a-z0-9-]+$/`)
   - Real-time format validation on input
   - Uniqueness validated server-side (409 conflict error handled gracefully)
   - Pre-filled with current workspace slug

### Save Button

- Disabled when form is pristine (no changes) or during submission
- On click: calls `updateWorkspace({ name, slug, logoUrl })` via mutation
- Success: toast notification, invalidate `userWorkspaces` query cache so sidebar/topbar update
- Error: toast with error message (special handling for 409 slug conflict)

## Frontend Changes

### New Files

| File | Purpose |
|------|---------|
| `apps/client/src/routes/_authenticated/more/workspace-settings.tsx` | Route file |
| `apps/client/src/components/layout/contents/WorkspaceSettingsContent.tsx` | Page component with form |

### Modified Files

| File | Change |
|------|--------|
| `apps/client/src/services/api/workspace.ts` | Add `updateWorkspace(workspaceId, data)` calling `PATCH /v1/workspaces/:workspaceId` |
| `apps/client/src/hooks/useWorkspace.ts` | Add `useUpdateWorkspace()` mutation hook that invalidates `userWorkspaces` on success |
| `apps/client/src/components/layout/contents/MoreMainContent.tsx` | Add "Workspace Settings" item in Workspace group, conditionally rendered for owner/admin |
| `apps/client/src/i18n/locales/en/workspace.json` | Add translation keys for workspace settings page |
| `apps/client/src/i18n/locales/zh/workspace.json` | Add Chinese translation keys |

## Permissions

- Entry point in MoreMainContent: hidden for non-owner/admin users (check via `useCurrentWorkspaceRole()`)
- Backend enforces `WorkspaceRoleGuard('owner', 'admin')` on PATCH endpoint

## Data Flow

1. User clicks "Workspace Settings" in More page → navigates to `/more/workspace-settings`
2. Page loads → `useUserWorkspaces` provides current workspace data → form pre-fills
3. Logo change: file select → `useFileUpload` (presign → S3 → confirm) → update local logoUrl state
4. Name/slug edit: direct input state changes
5. Save: `useUpdateWorkspace` mutation → `PATCH /v1/workspaces/:id` with `{ name, slug, logoUrl }`
6. Success: invalidate `userWorkspaces` query → sidebar, topbar, and all workspace name displays update automatically

## Error Handling

- Logo upload failure: toast error, logo reverts to previous
- 409 on slug: toast "This slug is already taken"
- Validation errors: inline field-level error messages
- Network error: generic toast error

## Testing

- Unit tests for `WorkspaceSettingsContent` component
- Unit test for `useUpdateWorkspace` hook
- Test permission gating (entry point hidden for member/guest roles)
- Test form validation (name length, slug format)
- Test save disabled when form pristine
