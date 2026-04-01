# User Avatar Seeded Colors Design

## Overview

Fix the current default-avatar issue where users without `avatarUrl` all render with nearly the same fallback color, making them hard to distinguish in dense message and member lists.

The frontend will introduce a dedicated `UserAvatar` component for user identity rendering and a shared seeded avatar color utility reused by both user avatars and workspace avatars. Fallback colors remain restricted to a predefined safe palette already established by workspace avatars.

## Goals

- Make default user avatar colors deterministic from `userId`
- Keep avatar colors stable across pages and sessions
- Reuse the existing workspace avatar palette instead of inventing a new color system
- Centralize user-avatar fallback logic so new screens do not regress to hardcoded single-color fallbacks

## Non-Goals

- No backend or database changes
- No changes to uploaded avatar behavior
- No changes to bot image fallback behavior
- No visual redesign of workspace avatar layout or interaction
- No attempt to guarantee unique colors per user inside a workspace

## Current Problem

Today, user avatar fallbacks are rendered in many call sites with hardcoded classes such as `bg-primary`, `bg-primary/10`, or `bg-accent`. This creates two problems:

- users without uploaded avatars look too similar
- fallback behavior is duplicated across multiple components, so fixes do not propagate automatically

Workspace avatars already use a predefined gradient palette, but that logic is local to `MainSidebar.tsx` and indexed by workspace list position rather than a stable seed.

## Chosen Approach

Use a component-based approach:

1. Extract the workspace gradient palette into a shared avatar-color utility
2. Add a stable seed-to-palette mapping function based on a string hash
3. Introduce a `UserAvatar` component that owns fallback rendering for user identities
4. Migrate existing user-avatar call sites to `UserAvatar`
5. Update workspace avatars to reuse the shared palette utility without changing their product behavior

This is preferred over piecemeal call-site fixes because it removes the duplication that caused the inconsistency in the first place.

## Alternatives Considered

### 1. Patch Existing User Avatar Call Sites Only

Replace hardcoded fallback classes in a few key screens with seeded classes.

Pros:

- smaller immediate diff
- fastest path for visible improvement

Cons:

- leaves duplicate avatar behavior in place
- new screens can still reintroduce the bug
- does not create a single source of truth for user fallback rendering

### 2. Chosen: Shared Utility Plus `UserAvatar`

Pros:

- stable and reusable
- aligns user and workspace avatars with the same palette source
- reduces future UI drift

Cons:

- touches more files this round
- requires minor migration work at existing call sites

## Design

### Shared Avatar Color Utility

Add a small utility under `apps/client/src/lib/` to own seeded avatar colors and initials.

Responsibilities:

- export the shared predefined gradient palette currently used by workspace avatars
- expose `getSeededAvatarGradient(seed: string): string`
- expose `getInitials(name: string): string`

Hashing requirements:

- deterministic for the same input
- simple and local, with no crypto dependency
- output mapped by modulo into the predefined palette

Seed rules:

- user avatar fallback uses `userId`
- workspace avatar fallback uses `workspaceId` when available
- if an ID is temporarily unavailable, fall back to a stable textual seed such as display name or username rather than random behavior

### `UserAvatar` Component

Add a reusable component under `apps/client/src/components/ui/` or another existing avatar-oriented location in the client.

Inputs should cover current user-avatar usage:

- `userId?: string`
- `name?: string`
- `username?: string`
- `avatarUrl?: string | null`
- `isBot?: boolean`
- `className?: string`
- `fallbackClassName?: string`

Behavior:

- if `avatarUrl` exists, render `AvatarImage`
- else if `isBot` is true, render `/bot.webp`
- else render initials in a gradient fallback chosen from the seeded palette
- if `name` is unavailable, use `username`
- if both are unavailable, render `?`

The component should build on the existing Radix `Avatar`, `AvatarImage`, and `AvatarFallback` primitives rather than replace them.

### Workspace Avatar Reuse

`MainSidebar.tsx` currently owns:

- the workspace gradient palette constant
- initials logic
- workspace gradient selection logic

This logic should move to the shared avatar-color utility. The sidebar should keep its existing layout and stacked rendering, but compute gradients via the shared utility so user and workspace avatars share one palette source.

This is a refactor for reuse, not a UI redesign.

### Migration Scope

Migrate the main user-facing user-avatar call sites that currently duplicate fallback logic, prioritizing:

- message list items
- streaming or agent-adjacent user message items where applicable
- sidebar current-user avatar
- reusable user list items
- member pickers and member lists
- user profile cards and other direct user identity surfaces encountered in the current client

Out-of-scope avatar surfaces can remain temporarily on raw `AvatarFallback` only if they are not user identities or if they intentionally use a different visual treatment.

## Testing

Add unit tests for the shared avatar-color utility:

- same seed returns the same gradient class
- different seeds map into the predefined palette
- empty or missing display names still produce safe initials output

Add or update component tests only where a current test already covers avatar fallback behavior. This change does not require broad snapshot coverage if the utility behavior is directly tested and the main migrated components render correctly.

## Rollout and Risk

Primary risk:

- some user-avatar call sites may still bypass `UserAvatar`, leaving inconsistent fallback styling

Mitigation:

- migrate the highest-traffic user avatar surfaces in this change
- keep the new component easy to adopt so later cleanup is mechanical

Secondary risk:

- gradient text contrast may become inconsistent on some surfaces that previously used solid semantic colors

Mitigation:

- reuse the existing workspace palette, which is already accepted in the product
- keep fallback text white and preserve existing size/layout classes

## Implementation Notes

- No API contract changes are needed
- No OpenClaw, IM, or websocket compatibility concerns apply because this is a client-only rendering change
- The work should be implemented with test-first changes around the new utility

## Success Criteria

- users without uploaded avatars no longer all appear with the same fallback color
- the same user renders with the same fallback color everywhere in the client
- workspace avatars still look and behave the same as before
- avatar fallback logic for users is centralized in one component instead of duplicated across many files
