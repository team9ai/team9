# Agent DM Row Pills — Design Spec

## Overview

Redesign the second line of bot rows in the DM sidebar list so it communicates what kind of AI agent the row represents, instead of showing the raw `@username`. The first line remains the display name; the second line becomes a row of short pills that describes the agent category and key attributes.

Human users are unaffected.

## Scope

- **In scope:** Bot rows rendered via `UserListItem` for existing direct channels. This covers:
  - `MessagesSubSidebar` (the 私信 sub-sidebar)
  - `HomeSubSidebar` (the Home sub-sidebar's DM section)
- **Out of scope (intentionally):**
  - Workspace members list (`filteredMembers` in `MessagesSubSidebar` — the "Start a conversation" section). These entries do not flow through the channel `otherUser` payload and would require a separate API extension. Deferred until requested.
  - AI Staff page, mention picker, channel member sheet — those components have their own rendering paths.
- **Data origin:** The three new fields live on `ChannelWithUnread.otherUser`, served by `channels.service.ts`.

## Display Rules

| Bot kind       | Detection                             | Line 2 pills                                                |
| -------------- | ------------------------------------- | ----------------------------------------------------------- |
| Common agent   | `bots.extra.commonStaff` is present   | `AI` + `${roleTitle}` (only `AI` if `roleTitle` is missing) |
| Personal agent | `bots.extra.personalStaff` is present | `AI` + `个人助理` + `${ownerName}`                          |
| Other bot      | bot, but neither common nor personal  | `AI` + `模型`                                               |
| Human          | `userType !== 'bot'`                  | No pill row (existing behavior preserved)                   |

Notes:

- Precedence: common staff takes precedence over personal staff if, due to data corruption, both sub-objects were present. In practice they are mutually exclusive.
- `ownerName` resolution: `users.displayName ?? users.username` for the row joined via `bots.ownerId`. If the owner record is missing (orphaned bot), `ownerName` is `null` and the pill row falls back to `AI` + `个人助理` (two pills).
- Pill strings `AI`, `个人助理`, `模型` are i18n-localized. `roleTitle` and `ownerName` are raw strings from the database (user-authored content).

## Data Layer

No schema changes. All needed data already exists:

- `im_bots.extra` → `commonStaff.roleTitle`, `personalStaff`
- `im_bots.owner_id` → FK to `im_users`
- `im_users.display_name`, `im_users.username`

## Backend Changes

### Extended `otherUser` payload

Target shape in `channels.service.ts`:

```ts
otherUser?: {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  status: 'online' | 'offline' | 'away' | 'busy';
  userType: 'human' | 'bot' | 'system';
  agentType: AgentType | null;
  // NEW:
  staffKind: 'common' | 'personal' | 'other' | null;  // null = human/system
  roleTitle: string | null;                            // common only
  ownerName: string | null;                            // personal only
};
```

### `mapChannelUserSummary` extension

`ChannelUserSummaryRow` gains three optional fields:

```ts
type ChannelUserSummaryRow = {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  status: "online" | "offline" | "away" | "busy";
  userType: "human" | "bot" | "system";
  applicationId: string | null;
  managedProvider: string | null;
  managedMeta: schema.ManagedMeta | null;
  // NEW:
  botExtra: schema.BotExtra | null;
  ownerDisplayName: string | null;
  ownerUsername: string | null;
};
```

`mapChannelUserSummary` derives:

```ts
let staffKind: "common" | "personal" | "other" | null = null;
let roleTitle: string | null = null;
let ownerName: string | null = null;

if (row.userType === "bot") {
  if (row.botExtra?.commonStaff) {
    staffKind = "common";
    roleTitle = row.botExtra.commonStaff.roleTitle ?? null;
  } else if (row.botExtra?.personalStaff) {
    staffKind = "personal";
    ownerName = row.ownerDisplayName ?? row.ownerUsername ?? null;
  } else {
    staffKind = "other";
  }
}
```

### Query updates

Two query sites in `channels.service.ts` need the new columns:

1. **`listUserChannelsRaw` → `allMembers` query** (lines ~694–728).
2. **`getDmOtherUser`** (Redis-cached path, lines ~810–855).

Both already `leftJoin(schema.bots, eq(bots.userId, channelMembers.userId))`. Add:

- An aliased `leftJoin` of `schema.users` (as `ownerUser`) on `ownerUser.id = bots.ownerId`, using Drizzle's table-alias helper to avoid collision with the primary `users` join.
- Select `bots.extra`, `ownerUser.displayName`, `ownerUser.username`.

The `getUserSummary` path (self for echo channels) doesn't need the new fields — it can return `null/null/null` for the three new fields since a user viewing their own echo channel is always a human (or at least: bot-self is not a product case we support).

### Redis cache key bump

Existing key: `REDIS_KEYS.CHANNEL_DM_OTHER_USER(channelId, userId)`.

Bump the key version (e.g. append `:v2`) so deployed instances that read stale cache entries from before this change don't hand back the old shape. Rationale: the frontend will expect the three new fields; stale cache → `undefined` → inconsistent rendering.

### Type exports

`ChannelWithUnread.otherUser` type in `channels.service.ts` updated to match the new shape. `ChannelMemberResponse.user` also gains the three new fields (since it calls `mapChannelUserSummary`); this is incidental but kept consistent. No API contract break for existing consumers — the new fields are additive.

## Frontend Changes

### `UserListItem` new props

```ts
staffKind?: 'common' | 'personal' | 'other' | null;
roleTitle?: string | null;
ownerName?: string | null;
```

Rendering logic (in the text block currently showing `name` + `subtitle`):

```tsx
<div className="flex-1 min-w-0 text-left">
  <div className="flex items-center gap-2 min-w-0">
    <div className="flex-1 min-w-0 truncate" title={name}>
      {name}
    </div>
    <AgentTypeBadge agentType={agentType} />
  </div>
  {isBot && staffKind ? (
    <AgentPillRow
      staffKind={staffKind}
      roleTitle={roleTitle}
      ownerName={ownerName}
    />
  ) : subtitle ? (
    <div className="text-xs text-nav-foreground-faint truncate">{subtitle}</div>
  ) : null}
</div>
```

If both `staffKind` and `subtitle` are somehow provided, pills win (bots with staffKind do not need `@username`).

### New component: `AgentPillRow`

Location: `apps/client/src/components/sidebar/AgentPillRow.tsx` (co-located with `UserListItem`).

Renders a `flex gap-1` row of tiny pills sized to match the `text-xs` subtitle line. Pills are simple `<span>` with a muted background (`bg-nav-hover` or `bg-muted/40`) + `text-[10px]` + `rounded-full px-1.5 py-0.5 text-nav-foreground-muted`. Not reusing `<Badge>` because its default padding/height is too tall for this micro-scale treatment inside a list row.

Pill content per `staffKind`:

- `common`: `AI` then, if `roleTitle` truthy, another pill with `roleTitle` (truncated, max-width ~12ch).
- `personal`: `AI`, `t('bots.pills.personalAssistant')`, then if `ownerName` truthy, another pill with `ownerName` (truncated).
- `other`: `AI`, `t('bots.pills.model')`.

The `AI` pill gets a slightly different accent (e.g. `bg-primary/15 text-primary`) to visually anchor "this is an AI row"; the other pills use the neutral muted style.

Overflow: the row is `flex-wrap-nowrap overflow-hidden`, and each variable-content pill (roleTitle / ownerName) uses `truncate max-w-[12ch]`. The fixed-text pills (`AI`, `个人助理`, `模型`) never truncate.

### Call sites

`MessagesSubSidebar::directMessageUsers` (lines 54–71) and `HomeSubSidebar::directMessageUsers` (lines ~416) both map `channel.otherUser` → local DM descriptor. Pull the three new fields off `otherUser` and pass through to `UserListItem`.

### Types

`apps/client/src/types/im.ts`: the `ChannelOtherUser`-shaped interfaces (4 call sites) gain:

```ts
staffKind?: 'common' | 'personal' | 'other' | null;
roleTitle?: string | null;
ownerName?: string | null;
```

## i18n

Three new strings. Keep them under a new `bots` namespace file for tidiness, or co-locate under existing `navigation.json`'s `dm` key. Proposed keys under `navigation.json`:

```json
{
  "dm": {
    "pills": {
      "ai": "AI",
      "personalAssistant": "个人助理",
      "model": "模型"
    }
  }
}
```

All 8 locales must be updated (de, en, es, fr, it, zh-CN, zh-TW, plus any others present under `apps/client/src/i18n/locales`). The `ai` pill stays "AI" in every locale. `personalAssistant` and `model` translate per locale (e.g. en: "Personal Assistant" / "Model"; zh-TW: "個人助理" / "模型").

## Testing

### Backend

**Unit — `mapChannelUserSummary`** (new test file or extend existing `channels.service.spec.ts`):

1. Common staff with roleTitle → `staffKind: 'common'`, `roleTitle: <value>`, `ownerName: null`.
2. Common staff without roleTitle → `staffKind: 'common'`, `roleTitle: null`.
3. Personal staff with owner → `staffKind: 'personal'`, `ownerName: <displayName>`.
4. Personal staff with owner that has only `username` → `ownerName: <username>`.
5. Personal staff with missing owner row → `ownerName: null`.
6. Bot with empty `extra` → `staffKind: 'other'`.
7. Human row → `staffKind: null`, `roleTitle: null`, `ownerName: null`.

**Integration — `listUserChannelsRaw`:** Existing test suite for `getUserChannels` gets one additional assertion verifying the three new fields round-trip for a bot DM. Add one fixture DM channel whose other user is a common-staff bot.

**Integration — `getDmOtherUser` / Redis cache:** Verify cache miss + hit both return the new fields, and that old v1 keys are not read.

### Frontend

**`UserListItem` component tests** (extend `UserListItem.size.test.tsx` or new `UserListItem.agentPills.test.tsx`):

1. `isBot && staffKind='common'` with roleTitle → renders `AI` pill + roleTitle pill.
2. `isBot && staffKind='common'` without roleTitle → renders only `AI` pill.
3. `isBot && staffKind='personal'` with ownerName → renders `AI` + `个人助理` + ownerName pills.
4. `isBot && staffKind='personal'` without ownerName → renders `AI` + `个人助理` (two pills).
5. `isBot && staffKind='other'` → renders `AI` + `模型`.
6. Human with subtitle → renders subtitle, no pill row.
7. Bot with `staffKind=null` → falls back to subtitle if provided (defensive).

**`AgentPillRow` snapshot/unit test** (new file) — visual structure stability.

### Coverage

Hold to project-standard: 100% coverage for new code per project testing policy. Both `AgentPillRow` and the new branches in `mapChannelUserSummary` must have full-branch coverage.

## Edge Cases & Non-Goals

- **Echo channels (self-chat)** — `otherUser` is the current user (human). No pill row.
- **System users** — `staffKind` is null; no pill row.
- **Bot with `commonStaff` AND `personalStaff` both set** — precedence: common wins. Flag for server log (`logger.warn`) since data model says they are mutually exclusive.
- **Unicode/long role titles** — truncation handled by `max-w-[12ch]` + `truncate`.
- **Mobile responsive** — sidebar width is fixed at `w-64` in both sub-sidebars; no responsive breakpoint concerns.
- **Dark mode** — pill colors use theme tokens (`bg-nav-hover`, `text-nav-foreground-muted`, `bg-primary/15`), so both light and dark themes work.
- **Accessibility** — pill row is decorative labeling; `UserListItem` already has `title={name}` for tooltips. No screen-reader-only text added beyond the visible pill content.

## Rollout

- Backend and frontend ship together in a single PR. Backwards compatibility: backend fields are additive (`staffKind`, `roleTitle`, `ownerName` are new keys); an old frontend simply ignores them.
- Redis cache v2 bump ensures a clean cutover — no flush needed.
- No migration required.

## Open Questions (Resolved)

1. ~Should OpenClaw/base-model bots get a differentiated pill?~ → No. Use `AI` + `模型` for all non-staff bots.
2. ~Should workspace members list ("start a conversation") also get pills?~ → No, out of scope.
3. ~Pill style — reuse `Badge` component?~ → No, build a tiny `AgentPillRow` to match the `text-xs` subtitle scale.
4. ~i18n key placement?~ → Under `navigation.json` → `dm.pills.*`.
