# Agent DM Row Pills — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `@username` subtitle on bot rows in the DM sidebar with i18n pill rows that label the agent (Common / Personal / Other), pulling category metadata through the existing `ChannelWithUnread.otherUser` payload.

**Architecture:** Backend extends `mapChannelUserSummary` and the two `users + bots` query sites in `channels.service.ts` with `bots.extra` and an aliased owner-user join, exposing three new fields (`staffKind`, `roleTitle`, `ownerName`). Redis cache key bumps to `:v2`. Frontend introduces a small `AgentPillRow` component and threads the new fields through `UserListItem` into `MessagesSubSidebar` and `HomeSubSidebar`.

**Tech Stack:** NestJS · Drizzle ORM (with `alias()` for self-joins) · PostgreSQL · Redis · React 19 · TanStack Query · vitest · @testing-library/react · react-i18next.

**Spec:** [docs/superpowers/specs/2026-04-13-agent-dm-row-pills-design.md](../specs/2026-04-13-agent-dm-row-pills-design.md)

---

### Task 1: Backend — extend types and `mapChannelUserSummary`

**Goal:** Type the new fields end-to-end on the backend (`ChannelUserSummaryRow`, `ChannelWithUnread.otherUser`, `ChannelMemberResponse.user`) and add the derivation logic in `mapChannelUserSummary`. Cover all four mapping cases with unit tests. No query changes yet — those land in Task 2.

**Files:**

- Modify: `apps/server/apps/gateway/src/im/channels/channels.service.ts:54-67` (`ChannelWithUnread.otherUser`)
- Modify: `apps/server/apps/gateway/src/im/channels/channels.service.ts:69-93` (`ChannelMemberResponse.user`)
- Modify: `apps/server/apps/gateway/src/im/channels/channels.service.ts:95-105` (`ChannelUserSummaryRow`)
- Modify: `apps/server/apps/gateway/src/im/channels/channels.service.ts:193-208` (`mapChannelUserSummary` body)
- Test: `apps/server/apps/gateway/src/im/channels/channels.service.spec.ts` (new `describe("mapChannelUserSummary")` block)

**Acceptance Criteria:**

- [ ] `ChannelUserSummaryRow` includes `botExtra: BotExtra | null`, `ownerDisplayName: string | null`, `ownerUsername: string | null`.
- [ ] `mapChannelUserSummary` returns `staffKind`, `roleTitle`, `ownerName` per spec rules.
- [ ] `ChannelWithUnread.otherUser` and `ChannelMemberResponse.user` types include the three new fields.
- [ ] `pnpm --filter server test channels.service.spec` passes including the seven new mapping cases.

**Verify:** `cd apps/server && pnpm test -- channels.service.spec --testPathPattern=channels` → all green, new test cases included.

**Steps:**

- [ ] **Step 1: Extend type definitions**

In `apps/server/apps/gateway/src/im/channels/channels.service.ts`, update the three type blocks:

```ts
// ChannelWithUnread.otherUser (around line 58)
export interface ChannelWithUnread extends ChannelResponse {
  unreadCount: number;
  lastReadMessageId: string | null;
  showInDmSidebar?: boolean;
  otherUser?: {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    status: "online" | "offline" | "away" | "busy";
    userType: "human" | "bot" | "system";
    agentType: AgentType | null;
    staffKind: "common" | "personal" | "other" | null;
    roleTitle: string | null;
    ownerName: string | null;
  };
}
```

```ts
// ChannelMemberResponse.user (around line 76)
export interface ChannelMemberResponse {
  id: string;
  userId: string;
  role: "owner" | "admin" | "member";
  isMuted: boolean;
  notificationsEnabled: boolean;
  joinedAt: Date;
  user: {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    status: "online" | "offline" | "away" | "busy";
    userType: "human" | "bot" | "system";
    agentType: AgentType | null;
    staffKind: "common" | "personal" | "other" | null;
    roleTitle: string | null;
    ownerName: string | null;
    createdAt: Date;
  };
}
```

```ts
// ChannelUserSummaryRow (around line 95)
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
  botExtra: schema.BotExtra | null;
  ownerDisplayName: string | null;
  ownerUsername: string | null;
};
```

`schema.BotExtra` is already exported (`import type { BotExtra } from '@team9/database/schemas'` in this file's existing imports — keep the existing import). If TypeScript reports it as missing, add `BotExtra` to the named imports near the top.

- [ ] **Step 2: Update the inline `UserSummary` type in `getUserChannels`**

The same shape exists inline around line 906. Mirror the change there:

```ts
type UserSummary = {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  status: "online" | "offline" | "away" | "busy";
  userType: "human" | "bot" | "system";
  agentType: AgentType | null;
  staffKind: "common" | "personal" | "other" | null;
  roleTitle: string | null;
  ownerName: string | null;
};
```

Also update the `getUserSummary` private method's return type (around line 766) and the `getDmOtherUser` private method's return type (around line 1025) to include the three new keys (typed identically).

- [ ] **Step 3: Update `mapChannelUserSummary` body**

Replace the existing function (around lines 193–208):

```ts
private mapChannelUserSummary(row: ChannelUserSummaryRow) {
  let staffKind: 'common' | 'personal' | 'other' | null = null;
  let roleTitle: string | null = null;
  let ownerName: string | null = null;

  if (row.userType === 'bot') {
    if (row.botExtra?.commonStaff) {
      staffKind = 'common';
      roleTitle = row.botExtra.commonStaff.roleTitle ?? null;
      if (row.botExtra.personalStaff) {
        this.logger.warn(
          `Bot ${row.userId} has both commonStaff and personalStaff in extra; preferring common`,
        );
      }
    } else if (row.botExtra?.personalStaff) {
      staffKind = 'personal';
      ownerName = row.ownerDisplayName ?? row.ownerUsername ?? null;
    } else {
      staffKind = 'other';
    }
  }

  return {
    id: row.userId,
    username: row.username,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    status: row.status,
    userType: row.userType,
    agentType: resolveAgentType({
      userType: row.userType,
      applicationId: row.applicationId,
      managedProvider: row.managedProvider,
      managedMeta: row.managedMeta,
    }),
    staffKind,
    roleTitle,
    ownerName,
  };
}
```

- [ ] **Step 4: Patch `getUserSummary` to provide null fields**

`getUserSummary` (around lines 766–793) builds a row inline (no bots join). Add `botExtra: null, ownerDisplayName: null, ownerUsername: null` to the selected projection so the row matches `ChannelUserSummaryRow`:

```ts
const [user] = await this.db
  .select({
    userId: schema.users.id,
    username: schema.users.username,
    displayName: schema.users.displayName,
    avatarUrl: schema.users.avatarUrl,
    status: schema.users.status,
    userType: schema.users.userType,
    applicationId: sql<string | null>`NULL`,
    managedProvider: sql<string | null>`NULL`,
    managedMeta: sql<Record<string, unknown> | null>`NULL`,
    botExtra: sql<schema.BotExtra | null>`NULL`,
    ownerDisplayName: sql<string | null>`NULL`,
    ownerUsername: sql<string | null>`NULL`,
  })
  .from(schema.users)
  .where(eq(schema.users.id, userId))
  .limit(1);
```

- [ ] **Step 5: Write failing unit tests for `mapChannelUserSummary`**

Open `apps/server/apps/gateway/src/im/channels/channels.service.spec.ts`. Find an existing `describe('ChannelsService', ...)` block. Add a nested `describe('mapChannelUserSummary')` block. Because `mapChannelUserSummary` is `private`, expose it via cast: `(service as unknown as { mapChannelUserSummary: (row: ChannelUserSummaryRow) => unknown }).mapChannelUserSummary(row)` — or call it indirectly through a public method. The cleaner path: cast.

```ts
import type { BotExtra } from "@team9/database/schemas";

describe("mapChannelUserSummary", () => {
  const baseRow = {
    userId: "u1",
    username: "alice",
    displayName: "Alice",
    avatarUrl: null,
    status: "online" as const,
    userType: "bot" as const,
    applicationId: null,
    managedProvider: null,
    managedMeta: null,
    botExtra: null as BotExtra | null,
    ownerDisplayName: null as string | null,
    ownerUsername: null as string | null,
  };

  const map = (row: typeof baseRow) =>
    (
      service as unknown as {
        mapChannelUserSummary: (r: typeof baseRow) => {
          staffKind: "common" | "personal" | "other" | null;
          roleTitle: string | null;
          ownerName: string | null;
        };
      }
    ).mapChannelUserSummary(row);

  it("common staff with roleTitle → staffKind=common, roleTitle set", () => {
    const result = map({
      ...baseRow,
      botExtra: { commonStaff: { roleTitle: "HR Lead" } },
    });
    expect(result.staffKind).toBe("common");
    expect(result.roleTitle).toBe("HR Lead");
    expect(result.ownerName).toBeNull();
  });

  it("common staff without roleTitle → staffKind=common, roleTitle=null", () => {
    const result = map({
      ...baseRow,
      botExtra: { commonStaff: {} },
    });
    expect(result.staffKind).toBe("common");
    expect(result.roleTitle).toBeNull();
  });

  it("personal staff with owner displayName → ownerName uses displayName", () => {
    const result = map({
      ...baseRow,
      botExtra: { personalStaff: {} },
      ownerDisplayName: "Winrey",
      ownerUsername: "winrey1998",
    });
    expect(result.staffKind).toBe("personal");
    expect(result.ownerName).toBe("Winrey");
  });

  it("personal staff with only username → ownerName falls back to username", () => {
    const result = map({
      ...baseRow,
      botExtra: { personalStaff: {} },
      ownerDisplayName: null,
      ownerUsername: "winrey1998",
    });
    expect(result.ownerName).toBe("winrey1998");
  });

  it("personal staff with missing owner row → ownerName=null", () => {
    const result = map({
      ...baseRow,
      botExtra: { personalStaff: {} },
    });
    expect(result.staffKind).toBe("personal");
    expect(result.ownerName).toBeNull();
  });

  it("bot with empty extra → staffKind=other", () => {
    const result = map({ ...baseRow, botExtra: {} });
    expect(result.staffKind).toBe("other");
    expect(result.roleTitle).toBeNull();
    expect(result.ownerName).toBeNull();
  });

  it("human row → staffKind=null and other agent fields null", () => {
    const result = map({
      ...baseRow,
      userType: "human",
      botExtra: null,
    });
    expect(result.staffKind).toBeNull();
    expect(result.roleTitle).toBeNull();
    expect(result.ownerName).toBeNull();
  });

  it("bot with both commonStaff and personalStaff → common wins (and warns)", () => {
    const warnSpy = vi
      .spyOn(service["logger"], "warn")
      .mockImplementation(() => undefined);
    const result = map({
      ...baseRow,
      botExtra: {
        commonStaff: { roleTitle: "Manager" },
        personalStaff: {},
      },
    });
    expect(result.staffKind).toBe("common");
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
```

- [ ] **Step 6: Run the new tests — expect all to pass after Steps 1–4**

Run: `cd apps/server && pnpm test -- --testPathPattern=channels.service.spec`
Expected: all `mapChannelUserSummary` cases pass; existing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add apps/server/apps/gateway/src/im/channels/channels.service.ts \
        apps/server/apps/gateway/src/im/channels/channels.service.spec.ts
git commit -m "feat(channels): derive staffKind/roleTitle/ownerName in user summary

Extends ChannelUserSummaryRow with botExtra + owner alias columns, and
teaches mapChannelUserSummary to classify bots as common/personal/other
plus resolve owner display name. Query call sites updated in next commit."
```

---

### Task 2: Backend — wire query joins and bump Redis cache key

**Goal:** Update both `ChannelUserSummaryRow` query sites (`getUserChannels::allMembers` and `getDmOtherUser`) to select `bots.extra` and join an aliased `users` row for the bot owner, so `mapChannelUserSummary` receives populated columns. Bump the Redis cache key version to invalidate stale entries.

**Files:**

- Modify: `apps/server/apps/gateway/src/im/channels/channels.service.ts:917-952` (`getUserChannels::allMembers`)
- Modify: `apps/server/apps/gateway/src/im/channels/channels.service.ts:1037-1075` (`getDmOtherUser` query)
- Modify: `apps/server/apps/gateway/src/im/shared/constants/redis-keys.ts:15-16` (cache key bump)
- Test: `apps/server/apps/gateway/src/im/channels/channels.service.spec.ts` (extend existing `getUserChannels` test fixture with a bot DM)

**Acceptance Criteria:**

- [ ] Both query sites select `bots.extra` and `ownerUser.displayName`/`ownerUser.username` via an aliased `users` join.
- [ ] `getUserChannels` returns `otherUser.staffKind / roleTitle / ownerName` for a bot DM in tests.
- [ ] Redis key `CHANNEL_DM_OTHER_USER` is `im:channel_dm_other:v2:<channelId>:<userId>`.
- [ ] All existing `channels.service.spec` tests still pass.

**Verify:** `cd apps/server && pnpm test -- --testPathPattern=channels.service.spec` → all green.

**Steps:**

- [ ] **Step 1: Bump the Redis cache key**

In `apps/server/apps/gateway/src/im/shared/constants/redis-keys.ts`:

```ts
CHANNEL_DM_OTHER_USER: (channelId: string, userId: string) =>
  `im:channel_dm_other:v2:${channelId}:${userId}`,
```

- [ ] **Step 2: Add the aliased owner-user import once**

At the top of `channels.service.ts`, add Drizzle's `alias` helper to the existing `@team9/database` import:

```ts
import {
  DATABASE_CONNECTION,
  eq,
  and,
  sql,
  desc,
  isNull,
  inArray,
  alias,
  type PostgresJsDatabase,
} from "@team9/database";
```

If `alias` is **not** re-exported by `@team9/database`, add it to the re-export first (single-line addition in `apps/server/libs/database/src/index.ts`), then import as above. Do not bypass the package boundary by importing from `drizzle-orm/pg-core` directly — keep the existing convention.

Then declare the alias as a module-level constant just above `@Injectable()` so both query sites reference the same alias:

```ts
const ownerUser = alias(schema.users, "owner_user");
```

- [ ] **Step 3: Patch `getUserChannels::allMembers` query (around line 917)**

```ts
const allMembers = await this.db
  .select({
    channelId: schema.channelMembers.channelId,
    userId: schema.channelMembers.userId,
    username: schema.users.username,
    displayName: schema.users.displayName,
    avatarUrl: schema.users.avatarUrl,
    status: schema.users.status,
    userType: schema.users.userType,
    applicationId: schema.installedApplications.applicationId,
    managedProvider: schema.bots.managedProvider,
    managedMeta: schema.bots.managedMeta,
    botExtra: schema.bots.extra,
    ownerDisplayName: ownerUser.displayName,
    ownerUsername: ownerUser.username,
  })
  .from(schema.channelMembers)
  .innerJoin(schema.users, eq(schema.users.id, schema.channelMembers.userId))
  .leftJoin(schema.bots, eq(schema.bots.userId, schema.channelMembers.userId))
  .leftJoin(ownerUser, eq(ownerUser.id, schema.bots.ownerId))
  .leftJoin(
    schema.installedApplications,
    eq(schema.bots.installedApplicationId, schema.installedApplications.id),
  )
  .where(
    and(
      inArray(schema.channelMembers.channelId, directChannelIds),
      isNull(schema.channelMembers.leftAt),
    ),
  );
```

- [ ] **Step 4: Patch `getDmOtherUser` query (around line 1037)**

```ts
const members = await this.db
  .select({
    userId: schema.channelMembers.userId,
    username: schema.users.username,
    displayName: schema.users.displayName,
    avatarUrl: schema.users.avatarUrl,
    status: schema.users.status,
    userType: schema.users.userType,
    applicationId: schema.installedApplications.applicationId,
    managedProvider: schema.bots.managedProvider,
    managedMeta: schema.bots.managedMeta,
    botExtra: schema.bots.extra,
    ownerDisplayName: ownerUser.displayName,
    ownerUsername: ownerUser.username,
  })
  .from(schema.channelMembers)
  .innerJoin(schema.users, eq(schema.users.id, schema.channelMembers.userId))
  .leftJoin(schema.bots, eq(schema.bots.userId, schema.channelMembers.userId))
  .leftJoin(ownerUser, eq(ownerUser.id, schema.bots.ownerId))
  .leftJoin(
    schema.installedApplications,
    eq(schema.bots.installedApplicationId, schema.installedApplications.id),
  )
  .where(
    and(
      eq(schema.channelMembers.channelId, channelId),
      isNull(schema.channelMembers.leftAt),
    ),
  );
```

- [ ] **Step 5: Extend the integration test for `getUserChannels` with a bot DM**

In `channels.service.spec.ts`, find the existing `getUserChannels` test fixture (look for `otherUser` setups around lines 1099 and 1195). Add a fixture: a direct channel where the other user is a `bot` with `bots.extra = { commonStaff: { roleTitle: 'HR Lead' } }`. Mock the Drizzle query to return `botExtra` and owner alias columns, and assert the returned channel has:

```ts
expect(result[0].otherUser).toMatchObject({
  staffKind: "common",
  roleTitle: "HR Lead",
  ownerName: null,
});
```

If the existing tests use a hand-rolled in-memory DB mock that doesn't model the join, extend the mock to return the new columns. If the existing tests stub `mapChannelUserSummary` directly, add a separate `it` block that exercises the wiring at the unit level.

- [ ] **Step 6: Run the channels test suite**

Run: `cd apps/server && pnpm test -- --testPathPattern=channels.service.spec`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add apps/server/apps/gateway/src/im/channels/channels.service.ts \
        apps/server/apps/gateway/src/im/channels/channels.service.spec.ts \
        apps/server/apps/gateway/src/im/shared/constants/redis-keys.ts \
        apps/server/libs/database/src/index.ts
git commit -m "feat(channels): join bot owner + select bots.extra in DM queries

Both getUserChannels::allMembers and getDmOtherUser now join an aliased
users row for bots.ownerId and select bots.extra so mapChannelUserSummary
can derive staffKind/roleTitle/ownerName. Bumps CHANNEL_DM_OTHER_USER
cache key to v2 so stale cache entries don't mask the new fields."
```

(Drop `apps/server/libs/database/src/index.ts` from `git add` if Step 2 didn't touch it.)

---

### Task 3: Frontend — extend `ChannelOtherUser` type

**Goal:** Extend the frontend channel/user types so the new backend fields are typed end-to-end. This is a tiny, no-runtime-impact change that unblocks Tasks 5–7.

**Files:**

- Modify: `apps/client/src/types/im.ts` (search for `otherUser` shape)

**Acceptance Criteria:**

- [ ] All places that type `channel.otherUser` (or a member's user shape) include `staffKind`, `roleTitle`, `ownerName`.
- [ ] `pnpm --filter client typecheck` passes.

**Verify:** `cd apps/client && pnpm typecheck` → no new errors.

**Steps:**

- [ ] **Step 1: Locate every `otherUser` / member-user shape in the file**

```bash
grep -n "otherUser\|userType: " apps/client/src/types/im.ts
```

The four call sites referenced in the spec (lines 87, 122, 194, 357 per the existing grep) each describe a user-summary-shaped object. For every one of them, add the three fields:

```ts
staffKind?: 'common' | 'personal' | 'other' | null;
roleTitle?: string | null;
ownerName?: string | null;
```

Keep the fields **optional** in the interface (with `?`) because legacy snapshots in tests / cached data may lack them. The runtime branching code in `UserListItem` already treats them as nullable.

- [ ] **Step 2: Run typecheck**

```bash
cd apps/client && pnpm typecheck
```

Expected: no new errors. Existing components that don't use these fields are unaffected.

- [ ] **Step 3: Commit**

```bash
git add apps/client/src/types/im.ts
git commit -m "types(im): add staffKind/roleTitle/ownerName to user summary shapes"
```

---

### Task 4: Frontend — add i18n strings to all 12 locales

**Goal:** Add the three pill strings (`agentPillAi`, `agentPillPersonalAssistant`, `agentPillModel`) to `navigation.json` for every supported locale. Reuse the existing `personalAssistant` key naming convention by mirroring it under a more specific key.

**Files:**

- Modify: `apps/client/src/i18n/locales/{de,en,es,fr,it,ja,ko,nl,pt,ru,zh-CN,zh-TW}/navigation.json`

**Acceptance Criteria:**

- [ ] Each of the 12 `navigation.json` files contains the keys `agentPillAi`, `agentPillPersonalAssistant`, `agentPillModel`.
- [ ] `agentPillAi` is `"AI"` in every locale.
- [ ] `agentPillPersonalAssistant` matches the existing `personalAssistant` key value in each locale (do a per-locale lookup; do not hand-translate fresh).
- [ ] `agentPillModel` is `"模型"` (zh-CN), `"模型"` (zh-TW), `"Model"` (en), with reasonable per-locale equivalents elsewhere.

**Verify:** `cd apps/client && pnpm typecheck && pnpm test -- --testPathPattern=i18n` (if there are i18n key-completeness tests; otherwise `cd apps/client && pnpm typecheck`).

**Steps:**

- [ ] **Step 1: Read the existing `personalAssistant` value per locale**

```bash
for f in apps/client/src/i18n/locales/*/navigation.json; do
  echo "=== $f ==="
  grep -E '"personalAssistant"' "$f" || echo "(missing)"
done
```

Use the printed value as the target for `agentPillPersonalAssistant` per locale.

- [ ] **Step 2: Add the three keys to every locale**

For each locale file, add (preserve existing key order; insert near the end, before the closing brace, to minimize merge friction):

```json
"agentPillAi": "AI",
"agentPillPersonalAssistant": "<value from Step 1>",
"agentPillModel": "<localized 'Model'>"
```

Per-locale `agentPillModel`:

- de: `"Modell"`
- en: `"Model"`
- es: `"Modelo"`
- fr: `"Modèle"`
- it: `"Modello"`
- ja: `"モデル"`
- ko: `"모델"`
- nl: `"Model"`
- pt: `"Modelo"`
- ru: `"Модель"`
- zh-CN: `"模型"`
- zh-TW: `"模型"`

If any locale lacks a `personalAssistant` key (only some namespaces have it), use the en value `"Personal Assistant"` as a fallback and flag in commit message.

- [ ] **Step 3: Validate JSON syntax**

```bash
for f in apps/client/src/i18n/locales/*/navigation.json; do
  node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" || echo "INVALID: $f"
done
```

Expected: no `INVALID:` output.

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/i18n/locales/*/navigation.json
git commit -m "i18n(navigation): add agentPillAi/PersonalAssistant/Model strings"
```

---

### Task 5: Frontend — create `AgentPillRow` component with tests

**Goal:** Build a self-contained `AgentPillRow` that renders 1–3 micro-pills based on `staffKind`. Cover all four rendering branches with unit tests.

**Files:**

- Create: `apps/client/src/components/sidebar/AgentPillRow.tsx`
- Create: `apps/client/src/components/sidebar/__tests__/AgentPillRow.test.tsx`

**Acceptance Criteria:**

- [ ] `AgentPillRow` accepts `staffKind`, `roleTitle?`, `ownerName?` props.
- [ ] Renders the correct pill set per `staffKind` per the spec.
- [ ] Pills use theme tokens (`bg-nav-hover` neutral; `bg-primary/15 text-primary` for `AI` accent).
- [ ] Variable-content pills (`roleTitle`, `ownerName`) truncate with `max-w-[12ch]`.
- [ ] All branch tests pass.

**Verify:** `cd apps/client && pnpm test -- AgentPillRow` → all green.

**Steps:**

- [ ] **Step 1: Write the component**

`apps/client/src/components/sidebar/AgentPillRow.tsx`:

```tsx
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export type AgentStaffKind = "common" | "personal" | "other";

export interface AgentPillRowProps {
  staffKind: AgentStaffKind;
  roleTitle?: string | null;
  ownerName?: string | null;
}

const basePill =
  "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] leading-none";
const neutralPill = cn(basePill, "bg-nav-hover text-nav-foreground-muted");
const accentPill = cn(basePill, "bg-primary/15 text-primary");
const truncatedPill = cn(neutralPill, "truncate max-w-[12ch]");

export function AgentPillRow({
  staffKind,
  roleTitle,
  ownerName,
}: AgentPillRowProps) {
  const { t } = useTranslation("navigation");

  const aiLabel = t("agentPillAi");

  if (staffKind === "common") {
    return (
      <div className="mt-0.5 flex items-center gap-1 overflow-hidden">
        <span className={accentPill}>{aiLabel}</span>
        {roleTitle ? (
          <span className={truncatedPill} title={roleTitle}>
            {roleTitle}
          </span>
        ) : null}
      </div>
    );
  }

  if (staffKind === "personal") {
    return (
      <div className="mt-0.5 flex items-center gap-1 overflow-hidden">
        <span className={accentPill}>{aiLabel}</span>
        <span className={neutralPill}>{t("agentPillPersonalAssistant")}</span>
        {ownerName ? (
          <span className={truncatedPill} title={ownerName}>
            {ownerName}
          </span>
        ) : null}
      </div>
    );
  }

  // "other"
  return (
    <div className="mt-0.5 flex items-center gap-1 overflow-hidden">
      <span className={accentPill}>{aiLabel}</span>
      <span className={neutralPill}>{t("agentPillModel")}</span>
    </div>
  );
}
```

- [ ] **Step 2: Write failing tests**

`apps/client/src/components/sidebar/__tests__/AgentPillRow.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { AgentPillRow } from "../AgentPillRow";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("AgentPillRow", () => {
  it("common with roleTitle → AI + roleTitle", () => {
    render(<AgentPillRow staffKind="common" roleTitle="HR Lead" />);
    expect(screen.getByText("agentPillAi")).toBeInTheDocument();
    expect(screen.getByText("HR Lead")).toBeInTheDocument();
    expect(screen.queryByText("agentPillPersonalAssistant")).toBeNull();
    expect(screen.queryByText("agentPillModel")).toBeNull();
  });

  it("common without roleTitle → only AI pill", () => {
    render(<AgentPillRow staffKind="common" />);
    expect(screen.getByText("agentPillAi")).toBeInTheDocument();
    expect(screen.queryByText("agentPillPersonalAssistant")).toBeNull();
    expect(screen.queryByText("agentPillModel")).toBeNull();
  });

  it("personal with ownerName → AI + 个人助理 + ownerName", () => {
    render(<AgentPillRow staffKind="personal" ownerName="Winrey" />);
    expect(screen.getByText("agentPillAi")).toBeInTheDocument();
    expect(screen.getByText("agentPillPersonalAssistant")).toBeInTheDocument();
    expect(screen.getByText("Winrey")).toBeInTheDocument();
  });

  it("personal without ownerName → AI + 个人助理 only", () => {
    render(<AgentPillRow staffKind="personal" />);
    expect(screen.getByText("agentPillAi")).toBeInTheDocument();
    expect(screen.getByText("agentPillPersonalAssistant")).toBeInTheDocument();
  });

  it("other → AI + Model", () => {
    render(<AgentPillRow staffKind="other" />);
    expect(screen.getByText("agentPillAi")).toBeInTheDocument();
    expect(screen.getByText("agentPillModel")).toBeInTheDocument();
    expect(screen.queryByText("agentPillPersonalAssistant")).toBeNull();
  });

  it("variable-content pills truncate via title attribute", () => {
    render(
      <AgentPillRow
        staffKind="common"
        roleTitle="Very Long Role Title That Overflows"
      />,
    );
    const pill = screen.getByText("Very Long Role Title That Overflows");
    expect(pill).toHaveAttribute(
      "title",
      "Very Long Role Title That Overflows",
    );
    expect(pill.className).toMatch(/truncate/);
    expect(pill.className).toMatch(/max-w-\[12ch\]/);
  });
});
```

- [ ] **Step 3: Run tests — expect all to pass**

```bash
cd apps/client && pnpm test -- AgentPillRow
```

Expected: 6 passing.

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/components/sidebar/AgentPillRow.tsx \
        apps/client/src/components/sidebar/__tests__/AgentPillRow.test.tsx
git commit -m "feat(sidebar): add AgentPillRow for bot row second-line labeling"
```

---

### Task 6: Frontend — extend `UserListItem` to render `AgentPillRow`

**Goal:** Teach `UserListItem` to render `AgentPillRow` instead of `subtitle` when the row represents a bot with a known `staffKind`. Add component tests covering the new branches.

**Files:**

- Modify: `apps/client/src/components/sidebar/UserListItem.tsx`
- Create: `apps/client/src/components/sidebar/__tests__/UserListItem.agentPills.test.tsx`

**Acceptance Criteria:**

- [ ] `UserListItem` accepts `staffKind`, `roleTitle`, `ownerName` props.
- [ ] When `isBot && staffKind` is provided, `AgentPillRow` renders in the subtitle slot (subtitle is suppressed).
- [ ] When not a bot or `staffKind` is null, existing `subtitle` rendering is preserved.
- [ ] All new tests pass; existing `UserListItem.size.test.tsx` and `UserListItem.avatar.test.tsx` still pass.

**Verify:** `cd apps/client && pnpm test -- UserListItem` → all green.

**Steps:**

- [ ] **Step 1: Update `UserListItem.tsx` props and rendering**

Add props in the `UserListItemProps` interface:

```ts
/** Bot staff classification — drives second-line pill rendering */
staffKind?: 'common' | 'personal' | 'other' | null;
/** Common-staff role title (only used when staffKind='common') */
roleTitle?: string | null;
/** Personal-staff owner display name (only used when staffKind='personal') */
ownerName?: string | null;
```

Add to the destructured `function UserListItem(...)` signature:

```ts
function UserListItem({
  // ...existing destructure...
  staffKind,
  roleTitle,
  ownerName,
}: UserListItemProps) {
```

Import `AgentPillRow`:

```ts
import { AgentPillRow } from "./AgentPillRow";
```

Replace the existing subtitle block (around lines 104–108) with branched rendering:

```tsx
{
  isBot && staffKind ? (
    <AgentPillRow
      staffKind={staffKind}
      roleTitle={roleTitle}
      ownerName={ownerName}
    />
  ) : subtitle ? (
    <div className="text-xs text-nav-foreground-faint truncate">{subtitle}</div>
  ) : null;
}
```

- [ ] **Step 2: Write tests**

`apps/client/src/components/sidebar/__tests__/UserListItem.agentPills.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { UserListItem } from "../UserListItem";

vi.mock("@/hooks/useIMUsers", () => ({
  useIsUserOnline: vi.fn(() => false),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("UserListItem agent pills", () => {
  it("bot + staffKind=common with roleTitle renders AI + role pills", () => {
    render(
      <UserListItem
        name="Employee Relations Tracker"
        userId="bot-1"
        isBot
        staffKind="common"
        roleTitle="HR Lead"
      />,
    );
    expect(screen.getByText("Employee Relations Tracker")).toBeInTheDocument();
    expect(screen.getByText("agentPillAi")).toBeInTheDocument();
    expect(screen.getByText("HR Lead")).toBeInTheDocument();
  });

  it("bot + staffKind=common without roleTitle renders only AI pill", () => {
    render(
      <UserListItem
        name="Generic Common Bot"
        userId="bot-2"
        isBot
        staffKind="common"
      />,
    );
    expect(screen.getByText("agentPillAi")).toBeInTheDocument();
    expect(screen.queryByText("agentPillPersonalAssistant")).toBeNull();
    expect(screen.queryByText("agentPillModel")).toBeNull();
  });

  it("bot + staffKind=personal renders AI + 个人助理 + ownerName", () => {
    render(
      <UserListItem
        name="Personal Staff"
        userId="bot-3"
        isBot
        staffKind="personal"
        ownerName="Winrey"
      />,
    );
    expect(screen.getByText("agentPillAi")).toBeInTheDocument();
    expect(screen.getByText("agentPillPersonalAssistant")).toBeInTheDocument();
    expect(screen.getByText("Winrey")).toBeInTheDocument();
  });

  it("bot + staffKind=personal without ownerName drops owner pill", () => {
    render(
      <UserListItem
        name="Orphan Personal"
        userId="bot-4"
        isBot
        staffKind="personal"
      />,
    );
    expect(screen.getByText("agentPillAi")).toBeInTheDocument();
    expect(screen.getByText("agentPillPersonalAssistant")).toBeInTheDocument();
  });

  it("bot + staffKind=other renders AI + Model", () => {
    render(
      <UserListItem
        name="OpenClaw Bot"
        userId="bot-5"
        isBot
        staffKind="other"
      />,
    );
    expect(screen.getByText("agentPillAi")).toBeInTheDocument();
    expect(screen.getByText("agentPillModel")).toBeInTheDocument();
  });

  it("bot + staffKind=null falls back to subtitle if provided", () => {
    render(
      <UserListItem
        name="Legacy Bot"
        userId="bot-6"
        isBot
        subtitle="@legacy_bot"
      />,
    );
    expect(screen.getByText("@legacy_bot")).toBeInTheDocument();
    expect(screen.queryByText("agentPillAi")).toBeNull();
  });

  it("human with subtitle renders subtitle, no pill row", () => {
    render(<UserListItem name="Alice" userId="user-1" subtitle="@alice" />);
    expect(screen.getByText("@alice")).toBeInTheDocument();
    expect(screen.queryByText("agentPillAi")).toBeNull();
  });

  it("subtitle is suppressed when bot has staffKind (pills win)", () => {
    render(
      <UserListItem
        name="Some Bot"
        userId="bot-7"
        isBot
        subtitle="@some_bot"
        staffKind="other"
      />,
    );
    expect(screen.queryByText("@some_bot")).toBeNull();
    expect(screen.getByText("agentPillAi")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run all UserListItem tests**

```bash
cd apps/client && pnpm test -- UserListItem
```

Expected: new + existing tests all pass.

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/components/sidebar/UserListItem.tsx \
        apps/client/src/components/sidebar/__tests__/UserListItem.agentPills.test.tsx
git commit -m "feat(sidebar): UserListItem renders AgentPillRow for staffed bots"
```

---

### Task 7: Frontend — wire the new fields through the DM sub-sidebars

**Goal:** Pull `staffKind / roleTitle / ownerName` off `channel.otherUser` in both `MessagesSubSidebar` and `HomeSubSidebar`, and pass through to `UserListItem`.

**Files:**

- Modify: `apps/client/src/components/layout/sidebars/MessagesSubSidebar.tsx:54-71` (`directMessageUsers` map) and the `<UserListItem>` render around lines 137–147
- Modify: `apps/client/src/components/layout/sidebars/HomeSubSidebar.tsx:416-432` (`directMessageUsers` map) and the `<UserListItem>` render around lines 722–731

**Acceptance Criteria:**

- [ ] Both sub-sidebars derive `staffKind / roleTitle / ownerName` from `channel.otherUser` and pass to `UserListItem`.
- [ ] No new typecheck errors.
- [ ] The existing sub-sidebar tests (`HomeSubSidebar.test.tsx` and any `MessagesSubSidebar` tests if present) still pass.

**Verify:** `cd apps/client && pnpm typecheck && pnpm test -- --testPathPattern=SubSidebar`

**Steps:**

- [ ] **Step 1: Patch `MessagesSubSidebar.tsx`**

Update the `directMessageUsers` map:

```tsx
const directMessageUsers = useMemo(() => {
  return directChannels.map((channel) => {
    const otherUser = channel.otherUser;
    const displayName =
      otherUser?.displayName || otherUser?.username || "Direct Message";

    return {
      id: channel.id,
      channelId: channel.id,
      userId: otherUser?.id,
      name: displayName,
      avatarUrl: otherUser?.avatarUrl,
      agentType: otherUser?.agentType,
      staffKind: otherUser?.staffKind ?? null,
      roleTitle: otherUser?.roleTitle ?? null,
      ownerName: otherUser?.ownerName ?? null,
      unreadCount: channel.unreadCount || 0,
      isBot: otherUser?.userType === "bot",
    };
  });
}, [directChannels]);
```

Update the `<UserListItem>` render:

```tsx
<UserListItem
  name={dm.name}
  avatarUrl={dm.avatarUrl}
  userId={dm.userId}
  isSelected={selectedChannelId === dm.channelId}
  unreadCount={dm.unreadCount}
  channelId={dm.channelId}
  linkPrefix="/messages"
  isBot={dm.isBot}
  agentType={dm.agentType}
  staffKind={dm.staffKind}
  roleTitle={dm.roleTitle}
  ownerName={dm.ownerName}
/>
```

- [ ] **Step 2: Patch `HomeSubSidebar.tsx`**

Update the `directMessageUsers` map (around line 416):

```tsx
const directMessageUsers = directChannels.map((channel) => {
  const otherUser = channel.otherUser;
  const displayName =
    otherUser?.displayName || otherUser?.username || "Direct Message";

  return {
    id: channel.id,
    channelId: channel.id,
    userId: otherUser?.id,
    name: displayName,
    avatarUrl: otherUser?.avatarUrl,
    agentType: otherUser?.agentType,
    staffKind: otherUser?.staffKind ?? null,
    roleTitle: otherUser?.roleTitle ?? null,
    ownerName: otherUser?.ownerName ?? null,
    status: otherUser?.status || ("offline" as const),
    unreadCount: channel.unreadCount || 0,
    isBot: otherUser?.userType === "bot",
  };
});
```

Update the `<UserListItem>` render (around line 722):

```tsx
<UserListItem
  name={dm.name}
  avatarUrl={dm.avatarUrl}
  userId={dm.userId}
  isSelected={selectedChannelId === dm.channelId}
  unreadCount={dm.unreadCount}
  channelId={dm.channelId}
  isBot={dm.isBot}
  agentType={dm.agentType}
  staffKind={dm.staffKind}
  roleTitle={dm.roleTitle}
  ownerName={dm.ownerName}
/>
```

- [ ] **Step 3: Typecheck and run tests**

```bash
cd apps/client && pnpm typecheck && pnpm test -- --testPathPattern="SubSidebar|UserListItem|AgentPillRow"
```

Expected: green.

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/components/layout/sidebars/MessagesSubSidebar.tsx \
        apps/client/src/components/layout/sidebars/HomeSubSidebar.tsx
git commit -m "feat(sidebar): thread agent pill fields into DM list UserListItems"
```

---

### Task 8: Manual verification

**Goal:** Visually confirm the rendering matches the spec across the four agent kinds in a running dev environment.

**Files:** None changed.

**Acceptance Criteria:**

- [ ] In `pnpm dev`, the 私信 sidebar shows correct pills for at least one bot of each kind: common-staff with role title, common-staff without role title, personal-staff (own personal staff), and OpenClaw / base-model bot.
- [ ] Human DM rows are unchanged.
- [ ] No console errors.
- [ ] Pills truncate gracefully when the role title or owner name is long (resize sidebar / use long fixture).

**Verify:** Manual inspection.

**Steps:**

- [ ] **Step 1: Start dev environment**

```bash
pnpm dev
```

Wait for both gateway (port 3000) and client (Vite) to come up.

- [ ] **Step 2: Open the desktop or web client**

Sign in to a workspace that has:

- At least one common-staff bot with a `roleTitle` (e.g., the seeded `Employee Relations Tracker`)
- A common-staff bot without `roleTitle` (create one via the AI Staff dialog if needed, leaving role title blank)
- A personal-staff bot (your own; check `/messages`)
- An OpenClaw or base-model bot (e.g., `OpenClaw Bot`)

- [ ] **Step 3: Visually verify each row**

For each bot in the 私信 list, confirm:

| Bot                      | Expected line 2                           |
| ------------------------ | ----------------------------------------- |
| Common with roleTitle    | `AI` accent pill + role title pill        |
| Common without roleTitle | only `AI` accent pill                     |
| Personal staff           | `AI` + `个人助理` + owner name            |
| OpenClaw / base-model    | `AI` + `模型`                             |
| Human DM                 | unchanged (no pill row, may have nothing) |

Open browser DevTools → check console for warnings/errors.

- [ ] **Step 4: Test truncation**

Edit a common-staff bot's role title to a 30+ character string via the AI Staff dialog (or directly in DB). Confirm pill truncates with ellipsis and full title appears on hover.

- [ ] **Step 5: If anything looks off**

File a follow-up rather than amending Tasks 1–7. Capture a screenshot and note the bot fixture in the report.

- [ ] **Step 6: No commit needed for manual verification.**

If you want to record the screenshot evidence, attach it to the PR description rather than committing it.

---

## Self-Review Notes

- All seven mapping cases in the spec map to test cases in Task 1.
- Task 2 covers both query sites + cache-key bump (3 of the 5 backend acceptance items in the spec).
- Tasks 5–7 cover the frontend acceptance items.
- Task 4 covers all 12 locales — exceeds the spec's "8 locales" estimate (the codebase actually has 12).
- The spec calls out `ChannelMemberResponse.user` getting incidentally extended; Task 1 handles it.
- Cache-key version bump is in Task 2 (matches spec § "Redis cache key bump").
- No tasks reference `mapChannelUserSummary` differently from how Task 1 defines it.
- Pill class names are consistent across `AgentPillRow.tsx` and the test assertions.
