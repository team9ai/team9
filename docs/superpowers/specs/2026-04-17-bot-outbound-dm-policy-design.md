# Bot Outbound DM Policy — Design

**Date:** 2026-04-17
**Status:** Design — pending implementation plan
**Scope:** team9 gateway + web client. Companion to team9-agent-pi spec
`2026-04-17-send-to-user-tool-design.md` (agent-side `SendToUser` tool).

## Background

Agents currently reach users via `SendToChannel(channelId, ...)`, which
requires the agent to already know the channel's UUID. There is no
LLM-facing way for an agent to DM a user it has never talked to. The
agent-pi spec introduces a `SendToUser(userId, content)` tool that needs a
gateway endpoint capable of:

1. Resolving / auto-creating the bot ↔ user DM channel.
2. Enforcing per-bot authorization on who the bot is allowed to DM.
3. Sending the message and routing it through the normal delivery path
   (WS broadcast + target-side session dispatch).

Unbounded outbound DMs are a spam / privacy risk: a personal assistant
bound to user A must not spontaneously DM user B just because the mentor
typed B's id into a prompt. The gateway is the only place where this
restriction can be enforced — the agent runtime is not a trust boundary.

The existing inbound ACLs (`assertDirectMessageAllowed`,
`assertMentionsAllowed` in
`apps/gateway/src/im/channels/channels.service.ts:156`) only govern whether
_other users_ can DM a personal staff bot. They do not govern whether the
bot itself can initiate DMs. This spec adds the complementary outbound ACL.

## Goals

- A per-bot `dmOutboundPolicy` stored in `im_bots.extra` that declares
  which users the bot is allowed to DM on its own initiative.
- Policy editable by the bot's **mentor** only (not by tenant admins, not
  by random users). Mentor ownership is the established trust boundary for
  AI Staff configuration — see the `mentorId` FK on `im_bots`.
- Sensible defaults per bot type:
  - **Personal staff** (`extra.personalStaff` present): default
    `owner-only`. The "private assistant" contract breaks if a personal
    assistant can DM strangers without the owner opting in.
    (Note: for personal staff, `mentorId === ownerId` is an invariant
    enforced in `personal-staff.service.ts:244`, so `owner-only` also
    means "mentor-only" — the UI does not need a separate mentor mode.)
  - **Common staff** (`extra.commonStaff` present): default `same-tenant`.
    A shared staff bot is expected to collaborate broadly; restricting it
    to its mentor would defeat its purpose.
  - **Bots with neither** (system bots, webhook bots): default
    `owner-only`, conservative.
- New gateway endpoint `POST /v1/im/bot/send-to-user` that:
  - Authenticates the bot via its access token (same guard as other bot
    API calls).
  - Validates the target, enforces policy, auto-creates the DM channel,
    sends the message, returns `{ channelId, messageId }`.
- Companion endpoint `GET /v1/im/bot/users/search` so agents can resolve
  names to `userId`s before calling `send-to-user` (the existing
  `/v1/search/users` is guarded by `AuthGuard` and rejects bot tokens).
- Structured error codes that the agent can surface back to the LLM as
  machine-readable tool results (`DM_NOT_ALLOWED`, `USER_NOT_FOUND`,
  `SELF_DM`, `CROSS_TENANT`, `WHITELIST_TOO_LARGE`).

## Non-goals

- Broadcast / multi-recipient outbound. One call, one recipient.
- Group channel auto-join. Outbound to channels (not users) keeps going
  through the existing `POST /v1/im/channels/:id/messages` + bot
  membership logic.
- Tenant-admin-level overrides. A future `tenants.policies.bot_dm_default`
  can layer on top; not in this spec.
- Changing the inbound ACLs
  (`allowDirectMessage` / `allowMention` on `extra.personalStaff.visibility`).
  Those stay as-is. Outbound is a separate axis.
- Rate limiting. The endpoint will be rate-limited per-bot per-minute, but
  the policy tuning is an ops config question tracked separately.

## Design

### 1. Schema — `bots.extra.dmOutboundPolicy`

`im_bots.extra` is already a `jsonb` column with a TypeScript interface
`BotExtra` in
`apps/server/libs/database/src/schemas/im/bots.ts`. Extend the interface —
no SQL migration needed, since jsonb permits unknown keys:

```ts
export type DmOutboundPolicyMode =
  | 'owner-only'    // Only the bot's ownerId (personal staff only; see UI notes)
  | 'same-tenant'   // Any non-bot user in the same tenant
  | 'whitelist'     // Only users listed in `userIds` (max 50)
  | 'anyone';       // No restriction (cross-tenant still blocked)

export interface DmOutboundPolicy {
  mode: DmOutboundPolicyMode;
  userIds?: string[]; // required iff mode === 'whitelist'; max 50 entries
}

export interface BotExtra {
  openclaw?: { ... };
  commonStaff?: { ... };
  personalStaff?: { ... };
  dmOutboundPolicy?: DmOutboundPolicy; // NEW
}
```

**Four modes, intentionally minimal.** An earlier draft included
`mentor-only` and `owner-mentor`. They were dropped:

- For personal staff, `mentorId === ownerId` is always true, so `owner-only`
  already covers the mentor.
- For common staff, where `mentorId` can differ from `ownerId`, the
  semantically clean way to express "owner + mentor can DM this bot"
  is `whitelist` with those specific userIds — explicit beats a
  purpose-built enum variant.

If a future workflow needs "all users in role X", add a `role-based`
mode then. Do not pre-pave.

When `dmOutboundPolicy` is absent (true for every existing row), the
gateway computes the default from the bot's shape:

```ts
function defaultDmOutboundPolicy(bot: Bot): DmOutboundPolicy {
  const extra = (bot.extra ?? {}) as BotExtra;
  if (extra.personalStaff) return { mode: "owner-only" };
  if (extra.commonStaff) return { mode: "same-tenant" };
  return { mode: "owner-only" }; // conservative fallback
}
```

No backfill migration. Rows without the field are interpreted via the
default; an explicit edit from the mentor materializes the field on that
row.

### 2. ACL helper — `assertBotCanDm`

**Location:** `apps/server/apps/gateway/src/im/channels/channels.service.ts`,
next to the existing `assertDirectMessageAllowed` / `assertMentionsAllowed`
helpers. Co-locating keeps all DM ACL logic in one file.

```ts
async assertBotCanDm(botUserId: string, targetUserId: string): Promise<void> {
  if (botUserId === targetUserId) {
    throw new BadRequestException('SELF_DM');
  }

  const [bot] = await this.db
    .select({
      userId: schema.bots.userId,
      ownerId: schema.bots.ownerId,
      mentorId: schema.bots.mentorId,
      extra: schema.bots.extra,
      tenantId: schema.users.tenantId, // via join on shadow user row
    })
    .from(schema.bots)
    .innerJoin(schema.users, eq(schema.users.id, schema.bots.userId))
    .where(eq(schema.bots.userId, botUserId))
    .limit(1);
  if (!bot) throw new NotFoundException('BOT_NOT_FOUND'); // auth anomaly

  const [target] = await this.db
    .select({
      id: schema.users.id,
      tenantId: schema.users.tenantId,
      isBot: sql<boolean>`EXISTS (
        SELECT 1 FROM ${schema.bots} WHERE ${schema.bots.userId} = ${schema.users.id}
      )`,
    })
    .from(schema.users)
    .where(eq(schema.users.id, targetUserId))
    .limit(1);
  if (!target) throw new NotFoundException('USER_NOT_FOUND');

  if (target.isBot) {
    // Bot-to-bot DM is out of scope for this endpoint. Refuse cleanly.
    throw new ForbiddenException('DM_NOT_ALLOWED');
  }
  if (target.tenantId !== bot.tenantId) {
    throw new BadRequestException('CROSS_TENANT');
  }

  const policy =
    (bot.extra as BotExtra)?.dmOutboundPolicy ??
    defaultDmOutboundPolicy(bot as Bot);

  if (isTargetAllowed(policy, bot, target.id)) return;
  throw new ForbiddenException('DM_NOT_ALLOWED');
}

function isTargetAllowed(
  policy: DmOutboundPolicy,
  bot: Pick<Bot, 'ownerId'>,
  targetId: string,
): boolean {
  switch (policy.mode) {
    case 'owner-only':  return bot.ownerId === targetId;
    case 'same-tenant': return true; // tenant check already done
    case 'whitelist':   return (policy.userIds ?? []).includes(targetId);
    case 'anyone':      return true;
  }
}
```

Exception classes map 1:1 to HTTP status in the controller (below) so the
agent side can decode them cleanly (see agent-pi spec's HTTP → error-code
table).

### 3. New endpoint — `POST /v1/im/bot/send-to-user`

**Location:** new file
`apps/server/apps/gateway/src/im/bot/bot-messaging.controller.ts`
(or a `bot/` submodule under `im/`). A dedicated file keeps the endpoint
out of the existing `channels.controller.ts` — that file routes by
`/channels/:id/...`, and this endpoint is user-scoped, not channel-scoped.

Guard: existing `BotAccessTokenGuard` (used by other bot-originated
endpoints; see `auth/internal-auth.controller.ts` region). The guard
attaches `req.bot = { userId, ownerId, mentorId, tenantId }`.

```ts
@Controller("v1/im/bot")
@UseGuards(BotAccessTokenGuard)
export class BotMessagingController {
  constructor(
    private readonly channelsService: ChannelsService,
    private readonly messagesService: MessagesService,
  ) {}

  @Post("send-to-user")
  async sendToUser(
    @Req() req: AuthedBotRequest,
    @Body() dto: SendToUserDto,
  ): Promise<SendToUserResponse> {
    const botUserId = req.bot.userId;

    // ACL — throws if not allowed, target missing, self-DM, or cross-tenant.
    await this.channelsService.assertBotCanDm(botUserId, dto.userId);

    // Auto-create (or reuse) the bot ↔ user DM. createDirectChannel is
    // idempotent: it returns the existing channel if one already exists
    // for this pair.
    const channel = await this.channelsService.createDirectChannel(
      botUserId,
      dto.userId,
      req.bot.tenantId,
    );

    // Normal send path — MessagesService already handles WS broadcast,
    // target-side session dispatch, attachments, etc. Reusing it means
    // no new event fan-out code.
    const message = await this.messagesService.sendMessage(channel.id, {
      senderId: botUserId,
      content: dto.content,
      attachments: dto.attachments,
      // No parentId: a fresh DM channel has no parent to reply to.
    });

    return { channelId: channel.id, messageId: message.id };
  }
}
```

**`SendToUserDto`**:

```ts
export class SendToUserDto {
  @IsUUID() userId!: string;
  @IsString() @Length(1, 10_000) content!: string;
  @IsOptional() attachments?: BotOutboundAttachment[];
}
```

**Rate limit.** Out of scope for v1. Leave a load-bearing `TODO` next to
the controller method so it is not silently forgotten:

```ts
@Post('send-to-user')
async sendToUser(
  @Req() req: AuthedBotRequest,
  @Body() dto: SendToUserDto,
): Promise<SendToUserResponse> {
  // TODO(rate-limit): per-bot token bucket, see follow-up spec. The
  // owner-only default blocks the biggest abuse surface for now.
  ...
}
```

**`SendToUserResponse`**:

```ts
export interface SendToUserResponse {
  channelId: string;
  messageId: string;
}
```

Errors are standard Nest `HttpException`s thrown from `assertBotCanDm`.
No custom error envelope — the agent matches on `statusCode` + `message`.

### 4. Why `createDirectChannel` is safe to reuse

`createDirectChannel` already:

- Returns the existing channel when one exists (`SELECT ... GROUP BY ...
HAVING COUNT = 2`, then `SELECT` the channel row).
- Calls `assertDirectMessageAllowed(userId1, userId2)` — the inbound ACL.
  For a bot DMing a user, this call check looks up the **target** in the
  `bots` table (it doesn't find one, since the target is a human), returns
  without throwing. For bot-to-bot that call would throw, but our
  outbound ACL (`assertBotCanDm`) already refuses bot targets before we
  reach here.
- Creates a tenant-scoped `direct` channel row + 2 member rows.

We do **not** want to bypass `assertDirectMessageAllowed` — if a mentor
sets their personal assistant's `allowDirectMessage=false` on an
_inbound_ basis, that restriction should still apply when a _different_
bot tries to DM that personal assistant. The `assertBotCanDm` + the
implicit `assertDirectMessageAllowed` inside `createDirectChannel`
together enforce both sides.

Edge case: if `assertBotCanDm` approves but `assertDirectMessageAllowed`
rejects (e.g. bot A is allowed `same-tenant`, target is bot B's owner but
B is set to `allowDirectMessage=false`), the inner assert will throw. The
controller should map that inner `ForbiddenException` to the same
`DM_NOT_ALLOWED` HTTP 403 that `assertBotCanDm` uses, so the agent sees a
consistent error code either way.

### 5. Mentor-facing settings UI

The UI exposes a subset of the enum based on bot type — the raw 4-mode
enum is the backend contract; user-facing copy is tuned per context.

**Personal staff.** The existing
`apps/client/src/components/ai-staff/PersonalStaffDetailSection.tsx`
already renders `allowMention` / `allowDirectMessage` as toggles. Add a
sibling block below them:

> **Outbound DM** — Who can this assistant message first?
> Radio group:
>
> - _Only me_ → `owner-only` (default)
> - _Anyone in this workspace_ → `same-tenant`
> - _Specific people…_ → `whitelist` (expands people-picker, 50-person cap)
> - _Anyone in the tenant (including guests)_ → `anyone`
>
> Visibility: mentor only. Others see read-only copy.

**Common staff.** Add a mirror block on the common-staff detail section
(whichever file the mentor uses to configure common staff — same pattern).
`owner-only` is **hidden** on this surface because "only the installer"
is an awkward semantic for shared bots. Available modes:

> - _Anyone in this workspace_ → `same-tenant` (default)
> - _Specific people…_ → `whitelist` (expands people-picker, 50-person cap)
> - _Anyone_ → `anyone`

If a mentor needs "only me and a few people" for a common staff, they
pick `whitelist` and add themselves + the allowed users — this subsumes
the dropped `owner-mentor` mode with zero backend complexity.

**API for the UI.** Extend the existing bot-update endpoint
(`PATCH /v1/applications/:installedAppId/staff/:botId` or equivalent —
whichever path the current `allowMention` toggle already uses) to accept
`dmOutboundPolicy` in the body. Wrap the write in the existing
mentor-authorization check.

### 6. Cross-cutting authorization on the settings write

The mentor-authorization check used for `allowMention` is the same
check we need here: "requester must be the mentorId of this bot, or a
tenant admin with override permission." Do **not** invent a new check —
reuse the existing one and let policy drift through the same audit trail.

**DTO validation for the write path.** The update DTO
(`UpdatePersonalStaffDto` / `UpdateCommonStaffDto`) gains optional
`dmOutboundPolicy` with these rules:

```ts
@IsOptional()
@ValidateNested()
@Type(() => DmOutboundPolicyDto)
dmOutboundPolicy?: DmOutboundPolicyDto;

export class DmOutboundPolicyDto {
  @IsIn(['owner-only', 'same-tenant', 'whitelist', 'anyone'])
  mode!: DmOutboundPolicyMode;

  @ValidateIf((o) => o.mode === 'whitelist')
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)              // hard cap — see decision below
  @IsUUID('all', { each: true })
  userIds?: string[];
}
```

Exceeding 50 returns HTTP 400 `WHITELIST_TOO_LARGE`. Fail loud, not silent
truncation — someone picking >50 people probably meant `same-tenant`.

### 7. Policy change logging

No DB-level audit table in v1 (the existing `allowMention` /
`allowDirectMessage` toggles also do not audit — parity argument). To
keep ops visibility without blocking on a broader audit-trail spec, emit
a structured pino log at **info** level inside the update service
whenever `dmOutboundPolicy` is written:

```ts
this.logger.log({
  event: "bot_dm_outbound_policy_changed",
  botId,
  botUserId,
  actorUserId, // mentor or admin making the change
  from: prevPolicy ?? null, // null when first-time set
  to: nextPolicy,
  timestamp: new Date().toISOString(),
});
```

Rationale:

- Zero infra work (goes to the existing pino stack).
- Searchable via the log aggregator for "who turned on `anyone` for bot X
  and when" — the most likely abuse-forensics query.
- A future DB-backed audit table can ingest this event type if and when
  compliance requires formal retention. Follow-up spec territory.

Omit the log when the write is a no-op (`from` deep-equals `to`) to avoid
noisy entries on reconcile jobs.

### 8. Bot-scoped user search — `GET /v1/im/bot/users/search`

The agent-pi `ResolveUser` tool needs a lookup primitive so the LLM can
resolve "张三" → `userId` before calling `SendToUser`. The existing
`SearchController` (`apps/server/apps/gateway/src/search/search.controller.ts`)
is guarded by `AuthGuard` (human user context) — bot tokens bounce off it.

**Decision:** add a narrow, bot-scoped companion endpoint rather than
extending `AuthGuard` to accept bot tokens. The latter would implicitly
open `search/messages`, `search/channels`, `search/files` to bots — a
much broader data surface.

**Location:** same controller as `send-to-user`
(`bot-messaging.controller.ts`), so the whole "bot-initiated operations"
surface lives in one file.

```ts
@Get('users/search')
async searchUsers(
  @Req() req: AuthedBotRequest,
  @Query() dto: BotUserSearchDto,
): Promise<BotUserSearchResponse> {
  const result = await this.searchService.searchUsers(
    dto.q,
    req.bot.userId,     // "requester" for search-side ACL
    req.bot.tenantId,   // scope hard-bound to bot's tenant; not client-settable
    { limit: dto.limit ?? 5 },
  );
  // Strip to bot-safe fields — no email by default.
  return {
    results: result.items.map((r) => ({
      userId: r.id,
      displayName: r.displayName,
      avatarUrl: r.avatarUrl ?? undefined,
    })),
  };
}
```

**`BotUserSearchDto`:**

```ts
export class BotUserSearchDto {
  @IsString() @MinLength(2) @MaxLength(100) q!: string;
  @IsOptional() @IsInt() @Min(1) @Max(10) limit?: number;
}
```

**Scope and hardening rules:**

- `tenantId` is **always** derived from the bot's token, never from a
  query parameter. Cross-tenant lookup is structurally impossible.
- Only `id`, `displayName`, `avatarUrl` are returned. Email is
  deliberately omitted in v1 — agents do not need it to call
  `SendToUser`, and leaking email addresses to LLM context raises PII
  questions we do not need to answer today.
- Results exclude bot users (`im_bots.userId` join filter). The LLM
  should not pick a bot as a DM target; `assertBotCanDm` would reject
  anyway, but surfacing bots in search results is misleading.
- Limit capped at 10. A bot does not need to page through the user
  directory.

**What this costs.** One new DTO, one new route, ~40 lines of controller
code. Reuses `SearchService.searchUsers` entirely; no search-provider
changes. No new migration.

## Testing

### Gateway unit tests

`channels.service.spec.ts`:

- Policy matrix: for each of the 4 modes, verify `assertBotCanDm` allows
  / rejects the right targets.
- Default policy fallback: bot with no `dmOutboundPolicy` + `personalStaff`
  ⇒ `owner-only`. Bot with `commonStaff` ⇒ `same-tenant`. Bot with
  neither ⇒ `owner-only`.
- Target-is-bot ⇒ `DM_NOT_ALLOWED`.
- Target-missing ⇒ `USER_NOT_FOUND`.
- Self-DM (botUserId === targetUserId) ⇒ `SELF_DM`.
- Cross-tenant target ⇒ `CROSS_TENANT`.

`personal-staff.service.spec.ts` / `common-staff.service.spec.ts`:

- Writing `dmOutboundPolicy` with whitelist of 51 userIds ⇒ 400
  `WHITELIST_TOO_LARGE`.
- Writing a whitelist policy with missing `userIds` ⇒ 400.
- No-op write (same `from` and `to`) ⇒ **no** pino log entry.
- Real change ⇒ single pino log entry with `event:
bot_dm_outbound_policy_changed`, correct `from`/`to`/`actorUserId`.

### Controller integration tests

`bot-messaging.controller.spec.ts` (new):

- `send-to-user` happy path: valid bot token + allowed target ⇒ 201 with
  `{ channelId, messageId }`. Channel is created if missing, reused if
  present.
- Each ACL failure maps to correct HTTP status (400 / 403 / 404).
- Missing / invalid bot token ⇒ 401 (delegated to guard; assert via
  integration).
- Attachments are forwarded to `MessagesService.sendMessage`.
- `users/search` happy path: returns `{ results: [{userId, displayName,
avatarUrl}] }`, **no email field** in response shape.
- `users/search` hard-binds `tenantId` from bot token: request with a
  forged `tenantId` query param (if any existed) is ignored; results
  only contain same-tenant users.
- `users/search` excludes bot users from results.
- `users/search` with `limit=50` ⇒ 400 (DTO cap is 10).

### Client tests

`PersonalStaffDetailSection.test.tsx`:

- Mentor sees the outbound DM block (all 4 modes); non-mentor sees
  read-only copy or nothing.
- Changing the mode calls the update endpoint with the right body shape.
- Whitelist mode shows the people-picker; picked userIds round-trip.
- Picking 51+ people in the whitelist picker → client-side block with
  message (matches backend 50 cap, avoids round trip).

Mirror test file for common-staff detail section:

- `owner-only` option is **not** rendered.
- Default on fresh open is `same-tenant`.

## Files touched

| File                                                                  | Change                                                                                         |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `apps/server/libs/database/src/schemas/im/bots.ts`                    | Extend `BotExtra` with `dmOutboundPolicy`; add `DmOutboundPolicy` type + 4-mode enum           |
| `apps/server/apps/gateway/src/im/channels/channels.service.ts`        | Add `assertBotCanDm`, `defaultDmOutboundPolicy`, `isTargetAllowed`                             |
| `apps/server/apps/gateway/src/im/bot/bot-messaging.controller.ts`     | New — `POST send-to-user` + `GET users/search`                                                 |
| `apps/server/apps/gateway/src/im/bot/bot-messaging.module.ts`         | New — wires controller + deps (ChannelsService, MessagesService, SearchService)                |
| `apps/server/apps/gateway/src/im/im.module.ts`                        | Import new module                                                                              |
| `apps/server/apps/gateway/src/im/bot/dto/send-to-user.dto.ts`         | New — validation DTO                                                                           |
| `apps/server/apps/gateway/src/im/bot/dto/bot-user-search.dto.ts`      | New — search DTO with `q` + `limit` caps                                                       |
| `apps/server/apps/gateway/src/applications/personal-staff.service.ts` | Accept `dmOutboundPolicy` on update; validate mode + userIds (50-cap); emit pino log on change |
| `apps/server/apps/gateway/src/applications/common-staff.service.ts`   | Same                                                                                           |
| `apps/server/apps/gateway/src/applications/dto/*.dto.ts`              | Add `DmOutboundPolicyDto` nested validator                                                     |
| `apps/client/src/components/ai-staff/PersonalStaffDetailSection.tsx`  | Add outbound DM block + whitelist picker (all 4 modes)                                         |
| `apps/client/src/components/ai-staff/<common-staff-detail>.tsx`       | Same, but hide `owner-only` option                                                             |
| `apps/client/src/services/api/applications.ts`                        | Include `dmOutboundPolicy` in update payload type                                              |

No database migration (jsonb extension only). No WS protocol changes.
No changes to the message delivery fan-out.

## Rollout

Order of deploy:

1. **Gateway** first (backend-only): adds the new endpoint and ACL.
   `PATCH /.../staff/:botId` starts accepting `dmOutboundPolicy`; existing
   clients that do not send the field continue working.
2. **Client** next: adds the UI. Without the UI, existing bots run on
   their default policy (personal: `owner-only`, common: `same-tenant`).
3. **Agent-pi** last: ships the `SendToUser` tool that calls the new
   endpoint (see companion spec).

Rolling back any one layer is safe: gateway alone ⇒ nobody calls the new
endpoint. Gateway + client ⇒ mentors can edit policy but no bot uses it.
Full rollout ⇒ agents can DM users per the configured policy.

## Decisions locked after initial review

- **4 modes, not 6.** `owner-only | same-tenant | whitelist | anyone`.
  `mentor-only` and `owner-mentor` dropped: personal staff has
  `ownerId === mentorId` as an invariant, and common staff expresses
  "owner + mentor" via `whitelist` with two userIds. See schema section.
- **Whitelist hard-capped at 50.** DTO-level validation, HTTP 400
  `WHITELIST_TOO_LARGE` on overflow. Fail loud.
- **No DB audit table; structured pino log instead.** Matches existing
  `allowMention` / `allowDirectMessage` conventions. A future audit-table
  spec can ingest the log event type directly.
- **No rate limit in v1.** `TODO(rate-limit)` comment on the controller
  method; owner-only default already blocks the biggest abuse surface.
- **Bot user-search endpoint is new and narrow.** `GET
/v1/im/bot/users/search` returns userId + displayName + avatarUrl —
  no email. Same-tenant only; cap at 10 results.

## Open questions

1. **Email in search results.** v1 returns none. If a future `ResolveUser`
   UX needs email to disambiguate two people with the same displayName,
   reconsider — probably add `allowEmailInBotSearch` as a tenant-level
   policy rather than bot-level.
2. **Who counts as the "installer" for common staff `owner-only`?** The
   UI hides `owner-only` for common staff so this never comes up in
   practice. But if an admin API call writes `owner-only` on a common
   staff bot directly, the ACL still evaluates against `ownerId`. Check
   whether common staff `ownerId` is meaningfully populated today (it
   may just be the installer; the ACL result may or may not be what the
   admin expected). No-op for v1 because the UI path avoids the mode;
   flag for review if the admin API is used in practice.
