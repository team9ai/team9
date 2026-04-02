# Account Settings Page Design

## Overview

Add a dedicated account settings page at `/profile`, opened from the user menu `Profile` entry in the left-bottom sidebar menu. The page manages two distinct concerns:

- `Profile`: avatar, display name, username
- `Login Email`: current email, verification state, email change flow

This is not a generic preferences page. It is a focused account page for self-service identity/profile management.

## Scope

- Frontend:
  - Add `/profile` route and account settings UI
  - Wire the existing `Profile` menu item to navigate to the page
  - Add profile update hooks and tests
  - Reuse file upload for avatar upload
- Backend:
  - Extend current self-update endpoint to support `username`
  - Add controlled email-change flow with pending state and confirmation
  - Seed default `displayName` / `avatarUrl` on first Google signup
- Out of scope:
  - Password change
  - Third-party login management UI
  - Additional profile fields such as bio

## Goals

- Let a signed-in user edit avatar, display name, and username from a dedicated page
- Let a signed-in user start an email change without treating email as a normal profile field
- Keep login-identity changes separated from normal profile edits
- Ensure first-time Google signups get sensible defaults for name and avatar

## Non-Goals

- No direct inline editing of email in the profile form
- No account linking/unlinking UI for Google
- No password reset/change UI
- No admin-facing user management changes

## User Experience

### Entry Point

- The existing `Profile` button in the user popover navigates to `/profile`
- The route uses the authenticated app shell

### Page Layout

The page uses the same full-height content style as workspace settings: a header with back navigation plus a scrollable body.

Two cards appear in order:

1. `Profile`
2. `Login Email`

### Profile Card

Fields:

- Avatar preview and upload action
- `displayName`
- `username`
- `Save changes` button

Behavior:

- Avatar uploads only allow `image/jpeg`, `image/png`, `image/webp`
- Max file size: 5 MB
- Validation is inline and localized
- Save button is enabled only when valid fields changed
- Save only sends changed fields
- Username conflict returns a user-facing localized `409` message

### Login Email Card

Displays:

- Current email
- Email verification status
- Pending new email, if one exists

Actions:

- `Change email`
- If pending change exists:
  - `Resend confirmation`
  - `Cancel change`

Behavior:

- Starting an email change does not immediately update `users.email`
- The page clearly shows that confirmation is required
- After confirmation, the next account fetch reflects the new email

## Backend Design

### 1. Extend Self Profile Update

Current endpoint:

- `PATCH /v1/im/users/me`

Extend `UpdateUserDto` and service logic to support:

- `displayName?: string`
- `username?: string`
- `avatarUrl?: string | null`

Validation:

- `displayName`: existing max length remains
- `username`:
  - required only when present
  - lowercase letters, numbers, and hyphens only
  - length constraints defined explicitly in DTO
  - globally unique

Error handling:

- username conflict returns `409 Conflict`

### 2. Email Change Flow

Add a dedicated flow instead of overloading `PATCH /v1/im/users/me`.

Recommended persistence:

- New table: `user_email_change_requests`

Suggested columns:

- `id`
- `userId`
- `currentEmail`
- `newEmail`
- `tokenHash` or code hash
- `status` (`pending`, `confirmed`, `cancelled`, `expired`)
- `expiresAt`
- `confirmedAt`
- `createdAt`
- `updatedAt`

Recommended endpoints:

- `POST /v1/account/email-change`
  - start email change
- `GET /v1/account/email-change`
  - fetch current pending change for signed-in user
- `POST /v1/account/email-change/resend`
  - resend confirmation
- `DELETE /v1/account/email-change`
  - cancel pending change
- `GET /v1/account/confirm-email-change`
  - public confirmation endpoint from email link

Rules:

- New email must be globally unique
- Only one pending change per user at a time
- Confirmation writes the new email to `im_users.email`
- On confirmation, mark user email verified

### 3. Default Profile Seeding on First Google Signup

In first-time Google signup flow:

- `displayName` defaults to Google `name`
- `avatarUrl` defaults to Google `picture`
- If Google `picture` is missing, use Gravatar derived from normalized email

Rules:

- Only apply defaults at user creation time
- Never overwrite existing user-managed profile fields on later logins

## Frontend Design

### Routing

Add:

- `apps/client/src/routes/_authenticated/profile.tsx`

### Main UI Component

Add:

- `apps/client/src/components/layout/contents/AccountSettingsContent.tsx`

Responsibilities:

- Fetch current user account data
- Manage profile form state
- Handle avatar upload
- Show email state and email-change actions

### Data Access

Existing API:

- `imUsersApi.updateMe(...)`

Frontend changes:

- Extend current current-user API typing to include account page needs
- Add account/email-change API methods
- Add hooks for:
  - loading current user/account state
  - updating profile
  - fetching pending email change
  - starting email change
  - resending email change
  - cancelling email change

### State Updates

After successful profile save:

- Refresh current user query/cache
- Update any user store used by sidebar/topbar profile display

After email-change mutations:

- Refresh pending email-change query
- Refresh current user query when relevant

## Validation and Errors

### Username

- Client-side format validation
- Backend uniqueness validation
- `409` mapped to localized “username already taken”

### Avatar

- Raster formats only
- 5 MB max
- Upload failure surfaced inline

### Email Change

- Invalid email format blocked client-side and server-side
- Duplicate email returns localized conflict message
- Pending request UI always makes status explicit

## Security Considerations

- Do not allow direct email mutation through generic profile update
- Do not allow SVG avatar uploads
- Confirmation token/code must be hashed server-side if persisted
- Email change confirmation must expire
- Only the authenticated user can create/resend/cancel their own email change

## Testing

### Frontend

- Account page renders current profile values
- Profile save only submits changed fields
- Username validation blocks invalid input
- Username `409` conflict shows localized error
- Avatar upload enforces type/size
- Email section renders current email and pending state
- Start/resend/cancel email-change flows render correct UI states

### Backend

- `PATCH /v1/im/users/me` accepts username updates
- Username conflict returns `409`
- Email change creation rejects duplicate target email
- Email change confirmation updates `im_users.email`
- Repeat Google login does not overwrite existing manual profile data
- First Google signup seeds name/avatar correctly, with Gravatar fallback

## File Plan

Expected files to add or modify:

- `apps/client/src/routes/_authenticated/profile.tsx`
- `apps/client/src/components/layout/contents/AccountSettingsContent.tsx`
- `apps/client/src/components/layout/MainSidebar.tsx`
- `apps/client/src/services/api/im.ts`
- `apps/client/src/hooks/useIMUsers.ts` or a new dedicated account hook file
- `apps/client/src/i18n/locales/en/settings.json`
- `apps/client/src/i18n/locales/zh/settings.json`
- `apps/server/apps/gateway/src/im/users/dto/update-user.dto.ts`
- `apps/server/apps/gateway/src/im/users/users.service.ts`
- `apps/server/apps/gateway/src/im/users/users.controller.ts`
- new account/email-change module files if separated from IM users
- new database schema + migration for `user_email_change_requests`
- Google signup logic in `apps/server/apps/gateway/src/auth/auth.service.ts`

## Recommended Implementation Order

1. Backend profile update support for `username`
2. Backend email-change persistence and endpoints
3. Google signup default profile seeding
4. Frontend route and account page
5. Frontend profile editing and avatar upload
6. Frontend email-change UI
7. Tests and verification
