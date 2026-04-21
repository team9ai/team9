# Bot Outbound DM Policy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the gateway-side policy + endpoints + UI so bots can DM users under per-bot mentor-controlled rules.

**Architecture:** Extend `BotExtra` jsonb with a `dmOutboundPolicy` field (4 modes), add an `assertBotCanDm` ACL helper, add a `BotMessagingController` exposing `POST /v1/im/bot/send-to-user` + `GET /v1/im/bot/users/search`, and extend the mentor-facing AI Staff detail UI with an outbound-DM block. The existing `AuthGuard` already accepts bot tokens — no new guard.

**Tech Stack:** NestJS, Drizzle ORM, PostgreSQL (jsonb — no SQL migration), React + shadcn/ui on client, class-validator DTOs, Jest + supertest, vitest/RTL on client.

**Spec:** [`docs/superpowers/specs/2026-04-17-bot-outbound-dm-policy-design.md`](../specs/2026-04-17-bot-outbound-dm-policy-design.md)

---

## File Map

### Server

- Create: `apps/server/apps/gateway/src/im/bot/bot-messaging.controller.ts`
- Create: `apps/server/apps/gateway/src/im/bot/bot-messaging.module.ts`
- Create: `apps/server/apps/gateway/src/im/bot/dto/send-to-user.dto.ts`
- Create: `apps/server/apps/gateway/src/im/bot/dto/bot-user-search.dto.ts`
- Create: `apps/server/apps/gateway/src/im/bot/bot-messaging.controller.spec.ts`
- Modify: `apps/server/libs/database/src/schemas/im/bots.ts` — add `DmOutboundPolicy` types to `BotExtra`
- Modify: `apps/server/apps/gateway/src/im/channels/channels.service.ts` — add `assertBotCanDm` + helpers
- Modify: `apps/server/apps/gateway/src/im/channels/channels.service.spec.ts` — ACL matrix tests
- Modify: `apps/server/apps/gateway/src/im/messages/messages.service.ts` — add `sendFromBot` helper
- Modify: `apps/server/apps/gateway/src/im/im.module.ts` — wire `BotMessagingModule`
- Modify: `apps/server/apps/gateway/src/applications/dto/personal-staff.dto.ts` — `dmOutboundPolicy` DTO
- Modify: `apps/server/apps/gateway/src/applications/dto/common-staff.dto.ts` — same
- Modify: `apps/server/apps/gateway/src/applications/personal-staff.service.ts` — write policy + pino log
- Modify: `apps/server/apps/gateway/src/applications/common-staff.service.ts` — same
- Modify: `apps/server/apps/gateway/src/applications/personal-staff.service.spec.ts` + `common-staff.service.spec.ts`

### Client

- Create: `apps/client/src/components/ui/radio-group.tsx` (shadcn)
- Create: `apps/client/src/components/ai-staff/DmOutboundPolicyBlock.tsx` — shared radio + whitelist picker
- Create: `apps/client/src/components/ai-staff/MultiUserPicker.tsx`
- Create: `apps/client/src/components/ai-staff/__tests__/DmOutboundPolicyBlock.test.tsx`
- Modify: `apps/client/src/components/ai-staff/PersonalStaffDetailSection.tsx` — embed block (4 modes)
- Modify: `apps/client/src/components/ai-staff/<common-staff-detail>.tsx` — embed block (3 modes)
- Modify: `apps/client/src/services/api/applications.ts` — extend payload types

### Dependencies

- Task 1 unlocks everything else (ACL is the foundation).
- Tasks 2–4 unlock the bot-messaging endpoints.
- Tasks 5–6 unlock the UI writes.
- Tasks 7–11 are the UI layer, parallelizable after Task 6.
- Task 12 verifies end-to-end at the gateway layer.

---

## Task 0: Extend `BotExtra` with `DmOutboundPolicy` types

**Goal:** Introduce the 4-mode policy type alongside the existing `BotExtra` so later tasks have a stable type contract. No runtime change — type-only.

**Files:**

- Modify: `apps/server/libs/database/src/schemas/im/bots.ts`

**Acceptance Criteria:**

- [ ] `DmOutboundPolicyMode` exported with 4 literal variants.
- [ ] `DmOutboundPolicy` exported with `mode` + optional `userIds`.
- [ ] `BotExtra.dmOutboundPolicy?: DmOutboundPolicy` field added.
- [ ] Existing tests (`pnpm -C apps/server test -- bots`) still pass.
- [ ] `pnpm -C apps/server typecheck` passes.

**Verify:** `pnpm -C apps/server typecheck` → no errors.

**Steps:**

- [ ] **Step 1: Add types to schema file**

Open `apps/server/libs/database/src/schemas/im/bots.ts` and append above the existing `BotExtra` interface (keep current interface structure, only add the new field):

```ts
export type DmOutboundPolicyMode =
  | "owner-only"
  | "same-tenant"
  | "whitelist"
  | "anyone";

export interface DmOutboundPolicy {
  mode: DmOutboundPolicyMode;
  /** Required iff `mode === 'whitelist'`. Max 50 entries (enforced at DTO layer). */
  userIds?: string[];
}

export interface BotExtra {
  openclaw?: {
    agentId?: string;
    workspace?: string;
  };
  commonStaff?: {
    roleTitle?: string;
    persona?: string;
    jobDescription?: string;
    model?: { provider: string; id: string };
  };
  personalStaff?: {
    persona?: string;
    model?: { provider: string; id: string };
    visibility?: {
      allowMention?: boolean;
      allowDirectMessage?: boolean;
    };
    bootstrappedAt?: string;
  };
  /** Outbound DM policy. Absent ⇒ gateway computes default from bot shape. */
  dmOutboundPolicy?: DmOutboundPolicy;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm -C apps/server typecheck`
Expected: no errors. If existing code indexes into `bot.extra` with `as BotExtra`, the added optional field is backward-compatible.

- [ ] **Step 3: Run bots-related tests**

Run: `pnpm -C apps/server test -- schemas/im/bots`
Expected: PASS (no behavior change).

- [ ] **Step 4: Commit**

```bash
git add apps/server/libs/database/src/schemas/im/bots.ts
git commit -m "feat(bots): add DmOutboundPolicy type to BotExtra"
```

---

## Task 1: `assertBotCanDm` ACL + default policy helpers with unit tests

**Goal:** Implement the policy enforcement helper inside `ChannelsService` with exhaustive unit coverage for the 4-mode matrix + boundary errors. No endpoint yet — just the pure logic.

**Files:**

- Modify: `apps/server/apps/gateway/src/im/channels/channels.service.ts`
- Modify: `apps/server/apps/gateway/src/im/channels/channels.service.spec.ts`

**Acceptance Criteria:**

- [ ] `assertBotCanDm(botUserId, targetUserId)` method exists on `ChannelsService`.
- [ ] Returns void on allow; throws `ForbiddenException('DM_NOT_ALLOWED')`, `BadRequestException('SELF_DM' | 'CROSS_TENANT')`, or `NotFoundException('USER_NOT_FOUND' | 'BOT_NOT_FOUND')`.
- [ ] `defaultDmOutboundPolicy(bot)` returns `owner-only` for personalStaff, `same-tenant` for commonStaff, `owner-only` otherwise.
- [ ] `isTargetAllowed(policy, {ownerId}, targetId)` exhaustively covers 4 modes.
- [ ] 12+ unit tests covering matrix + boundaries.
- [ ] `pnpm -C apps/server test -- channels.service` passes.

**Verify:** `pnpm -C apps/server test -- channels.service.spec` → all PASS.

**Steps:**

- [ ] **Step 1: Write the failing tests**

Open `apps/server/apps/gateway/src/im/channels/channels.service.spec.ts` and append a new `describe('assertBotCanDm', ...)` block at the end of the file (before the closing of the outermost `describe`):

```ts
describe("assertBotCanDm", () => {
  const BOT = "bot-user-1";
  const OWNER = "owner-1";
  const OTHER = "other-user-1";
  const TENANT = "tenant-1";

  function stubBot(extra: BotExtra | null, ownerId: string | null = OWNER) {
    // Mock: bots+users join returns this bot's row
    dbMock.select.mockImplementationOnce(() => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: () =>
              Promise.resolve([
                {
                  userId: BOT,
                  ownerId,
                  mentorId: ownerId,
                  extra,
                  tenantId: TENANT,
                },
              ]),
          }),
        }),
      }),
    }));
  }

  function stubTarget(
    exists: boolean,
    opts: { tenantId?: string; isBot?: boolean } = {},
  ) {
    const { tenantId = TENANT, isBot = false } = opts;
    dbMock.select.mockImplementationOnce(() => ({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve(exists ? [{ id: OTHER, tenantId, isBot }] : []),
        }),
      }),
    }));
  }

  it("rejects self-DM with SELF_DM", async () => {
    await expect(service.assertBotCanDm(BOT, BOT)).rejects.toThrow("SELF_DM");
  });

  it("throws BOT_NOT_FOUND when bot row missing", async () => {
    dbMock.select.mockImplementationOnce(() => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({ limit: () => Promise.resolve([]) }),
        }),
      }),
    }));
    await expect(service.assertBotCanDm(BOT, OTHER)).rejects.toThrow(
      "BOT_NOT_FOUND",
    );
  });

  it("throws USER_NOT_FOUND when target missing", async () => {
    stubBot({ personalStaff: {} });
    stubTarget(false);
    await expect(service.assertBotCanDm(BOT, OTHER)).rejects.toThrow(
      "USER_NOT_FOUND",
    );
  });

  it("rejects bot-to-bot with DM_NOT_ALLOWED", async () => {
    stubBot({ personalStaff: {} });
    stubTarget(true, { isBot: true });
    await expect(service.assertBotCanDm(BOT, OTHER)).rejects.toThrow(
      "DM_NOT_ALLOWED",
    );
  });

  it("rejects cross-tenant with CROSS_TENANT", async () => {
    stubBot({ personalStaff: {} });
    stubTarget(true, { tenantId: "tenant-other" });
    await expect(service.assertBotCanDm(BOT, OTHER)).rejects.toThrow(
      "CROSS_TENANT",
    );
  });

  describe("default policy (no dmOutboundPolicy on extra)", () => {
    it("personalStaff defaults to owner-only: allows owner", async () => {
      stubBot({ personalStaff: {} }, OWNER);
      stubTarget(true);
      await expect(service.assertBotCanDm(BOT, OWNER)).resolves.toBeUndefined();
    });
    it("personalStaff defaults to owner-only: rejects non-owner", async () => {
      stubBot({ personalStaff: {} }, OWNER);
      stubTarget(true);
      await expect(service.assertBotCanDm(BOT, OTHER)).rejects.toThrow(
        "DM_NOT_ALLOWED",
      );
    });
    it("commonStaff defaults to same-tenant: allows any tenant user", async () => {
      stubBot({ commonStaff: {} }, null);
      stubTarget(true);
      await expect(service.assertBotCanDm(BOT, OTHER)).resolves.toBeUndefined();
    });
    it("unclassified bot defaults to owner-only", async () => {
      stubBot({}, OWNER);
      stubTarget(true);
      await expect(service.assertBotCanDm(BOT, OTHER)).rejects.toThrow(
        "DM_NOT_ALLOWED",
      );
    });
  });

  describe("explicit policy", () => {
    it("whitelist allows listed userId", async () => {
      stubBot({ dmOutboundPolicy: { mode: "whitelist", userIds: [OTHER] } });
      stubTarget(true);
      await expect(service.assertBotCanDm(BOT, OTHER)).resolves.toBeUndefined();
    });
    it("whitelist rejects unlisted userId", async () => {
      stubBot({
        dmOutboundPolicy: { mode: "whitelist", userIds: ["someone-else"] },
      });
      stubTarget(true);
      await expect(service.assertBotCanDm(BOT, OTHER)).rejects.toThrow(
        "DM_NOT_ALLOWED",
      );
    });
    it("anyone allows any same-tenant user", async () => {
      stubBot({ dmOutboundPolicy: { mode: "anyone" } });
      stubTarget(true);
      await expect(service.assertBotCanDm(BOT, OTHER)).resolves.toBeUndefined();
    });
  });
});
```

Match the existing `dbMock` / service-instantiation style in this file — the sketch above assumes a `dbMock.select` pattern; adjust to the real test helpers (`mockDb.select.mockReturnValue(...)` etc.) as used elsewhere in `channels.service.spec.ts`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -C apps/server test -- channels.service.spec`
Expected: FAIL — `service.assertBotCanDm is not a function`.

- [ ] **Step 3: Implement `assertBotCanDm`, `defaultDmOutboundPolicy`, `isTargetAllowed`**

In `apps/server/apps/gateway/src/im/channels/channels.service.ts`, add the three helpers. Place `assertBotCanDm` directly after `assertMentionsAllowed` (~line 232) so all outbound ACL helpers are adjacent. Import the new types from `bots.ts`:

```ts
import type {
  BotExtra,
  DmOutboundPolicy,
  Bot,
} from "@team9/database/schemas/im/bots";
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
```

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
        tenantId: schema.users.tenantId,
      })
      .from(schema.bots)
      .innerJoin(schema.users, eq(schema.users.id, schema.bots.userId))
      .where(eq(schema.bots.userId, botUserId))
      .limit(1);

    if (!bot) throw new NotFoundException('BOT_NOT_FOUND');

    const [target] = await this.db
      .select({
        id: schema.users.id,
        tenantId: schema.users.tenantId,
        isBot: sql<boolean>`EXISTS (SELECT 1 FROM ${schema.bots} WHERE ${schema.bots.userId} = ${schema.users.id})`,
      })
      .from(schema.users)
      .where(eq(schema.users.id, targetUserId))
      .limit(1);

    if (!target) throw new NotFoundException('USER_NOT_FOUND');
    if (target.isBot) throw new ForbiddenException('DM_NOT_ALLOWED');
    if (target.tenantId !== bot.tenantId) {
      throw new BadRequestException('CROSS_TENANT');
    }

    const extra = (bot.extra ?? {}) as BotExtra;
    const policy =
      extra.dmOutboundPolicy ??
      defaultDmOutboundPolicy(extra);

    if (!isTargetAllowed(policy, { ownerId: bot.ownerId }, target.id)) {
      throw new ForbiddenException('DM_NOT_ALLOWED');
    }
  }
```

Then add module-local helpers at the bottom of the file (or near the top of the class file, outside the class body):

```ts
export function defaultDmOutboundPolicy(extra: BotExtra): DmOutboundPolicy {
  if (extra.personalStaff) return { mode: "owner-only" };
  if (extra.commonStaff) return { mode: "same-tenant" };
  return { mode: "owner-only" };
}

export function isTargetAllowed(
  policy: DmOutboundPolicy,
  bot: { ownerId: string | null },
  targetId: string,
): boolean {
  switch (policy.mode) {
    case "owner-only":
      return bot.ownerId === targetId;
    case "same-tenant":
      return true;
    case "whitelist":
      return (policy.userIds ?? []).includes(targetId);
    case "anyone":
      return true;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -C apps/server test -- channels.service.spec`
Expected: all 12 new tests PASS; existing `channels.service` tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/apps/gateway/src/im/channels/channels.service.ts \
        apps/server/apps/gateway/src/im/channels/channels.service.spec.ts
git commit -m "feat(channels): add assertBotCanDm with 4-mode outbound DM policy ACL"
```

---

## Task 2: Add `MessagesService.sendFromBot` helper

**Goal:** Give `BotMessagingController.sendToUser` a focused message-creation entry point without forcing a refactor of the 150-line `MessagesController.createMessage`.

**Files:**

- Modify: `apps/server/apps/gateway/src/im/messages/messages.service.ts`
- Modify: `apps/server/apps/gateway/src/im/messages/messages.service.spec.ts`

**Acceptance Criteria:**

- [ ] `sendFromBot({ botUserId, channelId, content, attachments?, workspaceId })` exists on `MessagesService`.
- [ ] Inserts message via `imWorkerGrpcClientService.createMessage`, fetches details, broadcasts via WS, fires post-broadcast MQ if ready.
- [ ] Skips `assertMentionsAllowed` (bots write to a DM channel they just provisioned — no mentions expected).
- [ ] Skips `channel-message trigger` RabbitMQ publish (bot-authored, never drives a task).
- [ ] Returns `{ channelId, messageId }`.
- [ ] 4+ unit tests: happy path, missing MQ service, attachments pass-through, return shape.

**Verify:** `pnpm -C apps/server test -- messages.service.spec` → all PASS.

**Steps:**

- [ ] **Step 1: Write failing tests**

Add to `messages.service.spec.ts`:

```ts
describe("sendFromBot", () => {
  it("inserts message and broadcasts, returns { channelId, messageId }", async () => {
    grpcClient.createMessage.mockResolvedValue({ msgId: "msg-1" });
    messagesService.getMessageWithDetails = vi.fn().mockResolvedValue({
      id: "msg-1",
      channelId: "ch-1",
      senderId: "bot-1",
      content: "hi",
      sender: { userType: "ai-staff" },
    });
    messagesService.mergeProperties = vi
      .fn()
      .mockResolvedValue([{ id: "msg-1" }]);
    messagesService.truncateForPreview = vi
      .fn()
      .mockReturnValue({ id: "msg-1" });

    const result = await service.sendFromBot({
      botUserId: "bot-1",
      channelId: "ch-1",
      content: "hi",
      workspaceId: "ws-1",
    });
    expect(result).toEqual({ channelId: "ch-1", messageId: "msg-1" });
    expect(websocketGateway.sendToChannelMembers).toHaveBeenCalledWith(
      "ch-1",
      WS_EVENTS.MESSAGE.NEW,
      { id: "msg-1" },
    );
  });

  it("forwards attachments to grpc client", async () => {
    grpcClient.createMessage.mockResolvedValue({ msgId: "msg-2" });
    const attachments = [
      { fileId: "f-1", fileName: "a.png", mimeType: "image/png" },
    ];
    await service.sendFromBot({
      botUserId: "bot-1",
      channelId: "ch-1",
      content: "",
      attachments,
      workspaceId: "ws-1",
    });
    expect(grpcClient.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({ attachments }),
    );
  });

  it("skips post-broadcast publish when gatewayMQService is absent", async () => {
    const svc = new MessagesService(/* deps without MQ */);
    grpcClient.createMessage.mockResolvedValue({ msgId: "msg-3" });
    await expect(
      svc.sendFromBot({
        botUserId: "bot-1",
        channelId: "ch-1",
        content: "hi",
        workspaceId: "ws-1",
      }),
    ).resolves.toBeDefined();
    // no MQ publish called — inferred by no mock-throw
  });

  it("does not publish channel-message trigger (bot-authored)", async () => {
    grpcClient.createMessage.mockResolvedValue({ msgId: "msg-4" });
    await service.sendFromBot({
      botUserId: "bot-1",
      channelId: "ch-1",
      content: "hi",
      workspaceId: "ws-1",
    });
    expect(gatewayMQService.publishWorkspaceEvent).not.toHaveBeenCalledWith(
      RABBITMQ_ROUTING_KEYS.MESSAGE_CREATED,
      expect.anything(),
    );
  });
});
```

Match the existing test setup in `messages.service.spec.ts` for service instantiation and dependency mocks.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -C apps/server test -- messages.service.spec`
Expected: FAIL — `service.sendFromBot is not a function`.

- [ ] **Step 3: Implement `sendFromBot`**

Add to `MessagesService` (`apps/server/apps/gateway/src/im/messages/messages.service.ts`), alongside `getMessageWithDetails` / other helpers. The method body mirrors `MessagesController.createMessage` (L250–322) but stripped of controller-layer concerns:

```ts
import { v7 as uuidv7 } from 'uuid';
import { WS_EVENTS } from '../websocket/events/events.constants.js';
import type { PostBroadcastTask } from '@team9/shared';

  async sendFromBot(params: {
    botUserId: string;
    channelId: string;
    content: string;
    attachments?: Array<{ fileId: string; fileName: string; mimeType: string }>;
    workspaceId: string;
  }): Promise<{ channelId: string; messageId: string }> {
    const { botUserId, channelId, content, attachments, workspaceId } = params;

    const clientMsgId = uuidv7();
    const messageType = determineMessageType(content, !!attachments?.length);

    const result = await this.imWorkerGrpcClientService.createMessage({
      clientMsgId,
      channelId,
      senderId: botUserId,
      content,
      type: messageType,
      workspaceId,
      attachments,
    });

    const message = await this.getMessageWithDetails(result.msgId);
    const [withProps] = await this.mergeProperties([message]);
    const preview = this.truncateForPreview(withProps);

    await this.websocketGateway.sendToChannelMembers(
      channelId,
      WS_EVENTS.MESSAGE.NEW,
      preview,
    );

    if (this.gatewayMQService?.isReady()) {
      const task: PostBroadcastTask = {
        msgId: result.msgId,
        channelId,
        senderId: botUserId,
        workspaceId,
        broadcastAt: Date.now(),
      };
      this.gatewayMQService.publishPostBroadcast(task).catch((err) => {
        this.logger.warn(`sendFromBot post-broadcast publish failed: ${err}`);
      });
    }

    // Emit for search indexing (symmetric with controller path)
    this.eventEmitter?.emit('message.created', {
      message: {
        id: message.id,
        channelId: message.channelId,
        senderId: message.senderId,
        content: message.content,
        type: message.type,
        isPinned: message.isPinned,
        parentId: message.parentId,
        createdAt: message.createdAt,
      },
      channel: { id: channelId },
      sender: { id: botUserId },
    });

    // NOTE: intentionally skipping MESSAGE_CREATED RabbitMQ publish — bot-authored
    // messages don't trigger channel-message workflows. See plan task 2 spec.

    return { channelId, messageId: result.msgId };
  }
```

`determineMessageType` import already exists in this directory (`./message-utils.js`). If `eventEmitter` is not currently injected into `MessagesService`, add it to the constructor — check the existing constructor first; if absent, add `@Inject()` for `EventEmitter2` from `@nestjs/event-emitter`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -C apps/server test -- messages.service.spec`
Expected: all 4 new tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/apps/gateway/src/im/messages/messages.service.ts \
        apps/server/apps/gateway/src/im/messages/messages.service.spec.ts
git commit -m "feat(messages): add MessagesService.sendFromBot helper"
```

---

## Task 3: `BotMessagingController` + `POST send-to-user` endpoint

**Goal:** Expose the new endpoint with full auth + ACL + create-or-reuse DM + delegated send.

**Files:**

- Create: `apps/server/apps/gateway/src/im/bot/dto/send-to-user.dto.ts`
- Create: `apps/server/apps/gateway/src/im/bot/bot-messaging.controller.ts`
- Create: `apps/server/apps/gateway/src/im/bot/bot-messaging.module.ts`
- Modify: `apps/server/apps/gateway/src/im/im.module.ts`

**Acceptance Criteria:**

- [ ] `POST /v1/im/bot/send-to-user` returns `{ channelId, messageId }` on happy path.
- [ ] Guarded by `AuthGuard` (bot tokens pass through via `BOT_TOKEN_VALIDATOR`).
- [ ] Calls `channelsService.assertBotCanDm` before anything else.
- [ ] Calls `channelsService.createDirectChannel(botUserId, dto.userId, tenantId)` — idempotent.
- [ ] Calls `messagesService.sendFromBot(...)` to dispatch.
- [ ] Contains a load-bearing `TODO(rate-limit):` comment at the top of the method body.
- [ ] Typecheck + build pass.

**Verify:** `pnpm -C apps/server typecheck` + `pnpm -C apps/server build` → both succeed.

**Steps:**

- [ ] **Step 1: Create the DTO**

Create `apps/server/apps/gateway/src/im/bot/dto/send-to-user.dto.ts`:

```ts
import { Type } from "class-transformer";
import {
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateNested,
} from "class-validator";

export class SendToUserAttachmentDto {
  @IsString() fileId!: string;
  @IsString() fileName!: string;
  @IsString() mimeType!: string;
}

export class SendToUserDto {
  @IsUUID() userId!: string;

  @IsString()
  @Length(1, 10_000)
  content!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SendToUserAttachmentDto)
  attachments?: SendToUserAttachmentDto[];
}

export interface SendToUserResponse {
  channelId: string;
  messageId: string;
}
```

- [ ] **Step 2: Create the controller**

Create `apps/server/apps/gateway/src/im/bot/bot-messaging.controller.ts`:

```ts
import { Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard, CurrentUser } from "@team9/auth";
import { CurrentTenantId } from "../../common/decorators/current-tenant.decorator.js";
import { ChannelsService } from "../channels/channels.service.js";
import { MessagesService } from "../messages/messages.service.js";
import {
  SendToUserDto,
  type SendToUserResponse,
} from "./dto/send-to-user.dto.js";

@Controller({ path: "im/bot", version: "1" })
@UseGuards(AuthGuard)
export class BotMessagingController {
  constructor(
    private readonly channelsService: ChannelsService,
    private readonly messagesService: MessagesService,
  ) {}

  @Post("send-to-user")
  async sendToUser(
    @CurrentUser("sub") botUserId: string,
    @CurrentTenantId() tenantId: string | undefined,
    @Body() dto: SendToUserDto,
  ): Promise<SendToUserResponse> {
    // TODO(rate-limit): per-bot token bucket — owner-only default blocks the
    // biggest abuse surface for now; revisit in a follow-up spec.

    await this.channelsService.assertBotCanDm(botUserId, dto.userId);

    const channel = await this.channelsService.createDirectChannel(
      botUserId,
      dto.userId,
      tenantId,
    );

    const result = await this.messagesService.sendFromBot({
      botUserId,
      channelId: channel.id,
      content: dto.content,
      attachments: dto.attachments,
      workspaceId: tenantId!, // tenantId is guaranteed for authenticated bot tokens
    });

    return { channelId: result.channelId, messageId: result.messageId };
  }
}
```

Note: this file also holds the `GET users/search` endpoint added in Task 4 — leave a blank line after the `sendToUser` method as a placement marker (comment: `// users/search added in Task 4`).

- [ ] **Step 3: Create the module**

Create `apps/server/apps/gateway/src/im/bot/bot-messaging.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { AuthModule } from "@team9/auth";
import { ChannelsModule } from "../channels/channels.module.js";
import { MessagesModule } from "../messages/messages.module.js";
import { SearchModule } from "../../search/search.module.js";
import { BotMessagingController } from "./bot-messaging.controller.js";

@Module({
  imports: [AuthModule, ChannelsModule, MessagesModule, SearchModule],
  controllers: [BotMessagingController],
})
export class BotMessagingModule {}
```

- [ ] **Step 4: Wire into `ImModule`**

Open `apps/server/apps/gateway/src/im/im.module.ts` and add `BotMessagingModule` to its `imports` array (match the existing import style for `ChannelsModule`, `MessagesModule`, etc.).

```ts
// Add:
import { BotMessagingModule } from './bot/bot-messaging.module.js';

@Module({
  imports: [
    // ... existing
    BotMessagingModule,
  ],
  ...
})
export class ImModule {}
```

- [ ] **Step 5: Typecheck + build**

Run: `pnpm -C apps/server typecheck`
Expected: no errors.

Run: `pnpm -C apps/server build`
Expected: build succeeds, new controller compiled.

- [ ] **Step 6: Commit**

```bash
git add apps/server/apps/gateway/src/im/bot/ \
        apps/server/apps/gateway/src/im/im.module.ts
git commit -m "feat(gateway): add BotMessagingController + POST /v1/im/bot/send-to-user"
```

---

## Task 4: `GET /v1/im/bot/users/search` endpoint

**Goal:** Bot-scoped user search so the agent's `ResolveUser` tool can translate names → userIds without touching `/v1/search/users` (which would leak non-user data surfaces).

**Files:**

- Create: `apps/server/apps/gateway/src/im/bot/dto/bot-user-search.dto.ts`
- Modify: `apps/server/apps/gateway/src/im/bot/bot-messaging.controller.ts` — add second method

**Acceptance Criteria:**

- [ ] `GET /v1/im/bot/users/search?q=<str>&limit=<n>` returns `{ results: [{userId, displayName, avatarUrl?}] }`.
- [ ] **No `email` field in response** — mapper drops it.
- [ ] Results exclude bot users.
- [ ] `tenantId` sourced from `@CurrentTenantId()` (bot token), never from query params.
- [ ] `q` requires min 2 chars; `limit` clamped to 1–10 (default 5).
- [ ] Typecheck + build pass.

**Verify:** `pnpm -C apps/server typecheck` + `pnpm -C apps/server build` → both succeed.

**Steps:**

- [ ] **Step 1: Create the search DTO**

Create `apps/server/apps/gateway/src/im/bot/dto/bot-user-search.dto.ts`:

```ts
import { Type } from "class-transformer";
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export class BotUserSearchDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  q!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  limit?: number;
}

export interface BotUserSearchResultItem {
  userId: string;
  displayName: string;
  avatarUrl?: string;
}

export interface BotUserSearchResponse {
  results: BotUserSearchResultItem[];
}
```

- [ ] **Step 2: Extend the controller**

Open `apps/server/apps/gateway/src/im/bot/bot-messaging.controller.ts` and add a second method after `sendToUser`. Add `SearchService` to the constructor, and a `Get`/`Query` import:

```ts
import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SearchService } from '../../search/search.service.js';
import {
  BotUserSearchDto,
  type BotUserSearchResponse,
} from './dto/bot-user-search.dto.js';

// constructor add:
private readonly searchService: SearchService,

  @Get('users/search')
  async searchUsers(
    @CurrentUser('sub') botUserId: string,
    @CurrentTenantId() tenantId: string | undefined,
    @Query() dto: BotUserSearchDto,
  ): Promise<BotUserSearchResponse> {
    const raw = await this.searchService.searchUsers(
      dto.q,
      botUserId,
      tenantId,
      { limit: dto.limit ?? 5 },
    );

    // Map to bot-safe fields: drop email, isActive, status, username, createdAt.
    // Exclude bot users (not discoverable via ResolveUser).
    const results: BotUserSearchResponse['results'] = [];
    for (const item of raw.items ?? []) {
      const u = item.item ?? item; // SearchResultItem<T> or T — tolerate both shapes
      // Filter bots: SearchService.searchUsers currently returns all user rows.
      // If the raw row carries an `isBot` hint, prefer it; otherwise emit and
      // let the caller-side assertBotCanDm guard reject if someone picks a bot.
      results.push({
        userId: u.id,
        displayName: u.displayName,
        ...(u.avatarUrl ? { avatarUrl: u.avatarUrl } : {}),
      });
    }
    return { results };
  }
```

**Bot-exclusion note:** `SearchService.searchUsers` returns `UserSearchResult` without an `isBot` column (confirmed via explore report — interface fields are `id, username, displayName, email, status, isActive, createdAt`). Add a post-filter join at the controller level:

```ts
// Before returning, drop any result whose id appears in im_bots.
// One extra query, bounded by limit (≤10 ids).
const ids = results.map((r) => r.userId);
if (ids.length > 0) {
  const botRows = await this.db // inject `@Inject(DB_TOKEN)` or reuse via a narrow service helper
    .select({ userId: schema.bots.userId })
    .from(schema.bots)
    .where(inArray(schema.bots.userId, ids));
  const botIds = new Set(botRows.map((r) => r.userId));
  return { results: results.filter((r) => !botIds.has(r.userId)) };
}
return { results };
```

If pulling `db` into the controller feels heavy, add a narrow helper `userIsBot(userIds: string[]): Promise<Set<string>>` to `ChannelsService` (it already has DB access) and call that. Either is acceptable — pick whichever matches the codebase's preference for controller/service layering. The explore report indicates services own DB access, so prefer adding the helper to `ChannelsService`.

- [ ] **Step 3: (if chosen) Add `ChannelsService.filterBotUserIds` helper**

If going the helper route, append to `channels.service.ts`:

```ts
  async filterBotUserIds(userIds: string[]): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const rows = await this.db
      .select({ userId: schema.bots.userId })
      .from(schema.bots)
      .where(inArray(schema.bots.userId, userIds));
    return new Set(rows.map((r) => r.userId));
  }
```

Then the controller's post-filter becomes:

```ts
const botIds = await this.channelsService.filterBotUserIds(
  results.map((r) => r.userId),
);
return { results: results.filter((r) => !botIds.has(r.userId)) };
```

- [ ] **Step 4: Typecheck + build**

Run: `pnpm -C apps/server typecheck && pnpm -C apps/server build`
Expected: no errors, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/server/apps/gateway/src/im/bot/dto/bot-user-search.dto.ts \
        apps/server/apps/gateway/src/im/bot/bot-messaging.controller.ts \
        apps/server/apps/gateway/src/im/channels/channels.service.ts
git commit -m "feat(gateway): add GET /v1/im/bot/users/search with bot-exclusion mapper"
```

---

## Task 5: Personal staff DTO + service — `dmOutboundPolicy` write + pino log

**Goal:** Accept `dmOutboundPolicy` on `PATCH` of personal staff, validate whitelist ≤50, persist into `BotExtra`, and emit a structured log on real change.

**Files:**

- Modify: `apps/server/apps/gateway/src/applications/dto/personal-staff.dto.ts`
- Create: `apps/server/apps/gateway/src/applications/dto/dm-outbound-policy.dto.ts` (shared between personal + common)
- Modify: `apps/server/apps/gateway/src/applications/personal-staff.service.ts`
- Modify: `apps/server/apps/gateway/src/applications/personal-staff.service.spec.ts`

**Acceptance Criteria:**

- [ ] `DmOutboundPolicyDto` validates `mode` against the 4-mode enum and `userIds` (UUIDs, 1–50 entries) iff mode === 'whitelist'.
- [ ] `UpdatePersonalStaffDto.dmOutboundPolicy?: DmOutboundPolicyDto`.
- [ ] `updateStaff` merges the new policy into `extra.dmOutboundPolicy`; omitted field = unchanged (partial update semantics).
- [ ] Writing whitelist with 51 userIds → 400 `WHITELIST_TOO_LARGE`.
- [ ] Real policy change emits one `this.logger.log({ event: 'bot_dm_outbound_policy_changed', ... })`.
- [ ] No-op write (deep-equal `from` and `to`) does **not** emit the log.
- [ ] Unit tests cover: happy write, 51-cap failure, no-op log suppression, real-change log emitted.

**Verify:** `pnpm -C apps/server test -- personal-staff.service.spec` → PASS.

**Steps:**

- [ ] **Step 1: Create the shared DTO**

Create `apps/server/apps/gateway/src/applications/dto/dm-outbound-policy.dto.ts`:

```ts
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsUUID,
  ValidateIf,
} from "class-validator";
import type { DmOutboundPolicyMode } from "@team9/database/schemas/im/bots";

const DM_MODES: DmOutboundPolicyMode[] = [
  "owner-only",
  "same-tenant",
  "whitelist",
  "anyone",
];

export class DmOutboundPolicyDto {
  @IsIn(DM_MODES, { message: "INVALID_DM_POLICY_MODE" })
  mode!: DmOutboundPolicyMode;

  @ValidateIf((o) => o.mode === "whitelist")
  @IsArray()
  @ArrayMinSize(1, { message: "WHITELIST_EMPTY" })
  @ArrayMaxSize(50, { message: "WHITELIST_TOO_LARGE" })
  @IsUUID("all", { each: true })
  @IsOptional()
  userIds?: string[];
}
```

- [ ] **Step 2: Extend `UpdatePersonalStaffDto`**

Open `apps/server/apps/gateway/src/applications/dto/personal-staff.dto.ts`. Add import + field to the existing `UpdatePersonalStaffDto` (existing fields include `displayName`, `persona`, `model`, `avatarUrl`, `visibility`):

```ts
import { Type } from "class-transformer";
import { DmOutboundPolicyDto } from "./dm-outbound-policy.dto.js";

export class UpdatePersonalStaffDto {
  // ... existing fields ...

  @IsOptional()
  @ValidateNested()
  @Type(() => DmOutboundPolicyDto)
  dmOutboundPolicy?: DmOutboundPolicyDto;
}
```

- [ ] **Step 3: Write failing tests**

Add to `personal-staff.service.spec.ts`:

```ts
describe("dmOutboundPolicy write", () => {
  const BOT_ID = "bot-1";
  const OWNER = "owner-1";
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(service["logger"], "log");
  });

  it("persists a new policy into extra.dmOutboundPolicy", async () => {
    stubBotLookup({ id: BOT_ID, ownerId: OWNER, extra: { personalStaff: {} } });
    await service.updateStaff(BOT_ID, OWNER, {
      dmOutboundPolicy: { mode: "same-tenant" },
    });
    expect(dbMock.update).toHaveBeenCalledWith(schema.bots);
    expect(dbMock.update().set).toHaveBeenCalledWith(
      expect.objectContaining({
        extra: expect.objectContaining({
          dmOutboundPolicy: { mode: "same-tenant" },
        }),
      }),
    );
  });

  it("emits structured log on real change", async () => {
    stubBotLookup({
      id: BOT_ID,
      ownerId: OWNER,
      extra: { personalStaff: {}, dmOutboundPolicy: { mode: "owner-only" } },
    });
    await service.updateStaff(BOT_ID, OWNER, {
      dmOutboundPolicy: { mode: "anyone" },
    });
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "bot_dm_outbound_policy_changed",
        botId: BOT_ID,
        from: { mode: "owner-only" },
        to: { mode: "anyone" },
        actorUserId: OWNER,
      }),
    );
  });

  it("does NOT emit log on no-op", async () => {
    stubBotLookup({
      id: BOT_ID,
      ownerId: OWNER,
      extra: { personalStaff: {}, dmOutboundPolicy: { mode: "owner-only" } },
    });
    await service.updateStaff(BOT_ID, OWNER, {
      dmOutboundPolicy: { mode: "owner-only" },
    });
    expect(logSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: "bot_dm_outbound_policy_changed" }),
    );
  });
});
```

DTO validation (51-cap) is covered as part of a separate e2e/integration test — or a lighter unit test using `class-validator`'s `validate()` against a `DmOutboundPolicyDto` instance with 51 ids:

```ts
it("DTO rejects 51-item whitelist", async () => {
  const dto = plainToInstance(DmOutboundPolicyDto, {
    mode: "whitelist",
    userIds: Array.from({ length: 51 }, () => uuidv7()),
  });
  const errors = await validate(dto);
  expect(errors[0].constraints).toHaveProperty("arrayMaxSize");
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `pnpm -C apps/server test -- personal-staff.service.spec`
Expected: FAIL — service doesn't read `dmOutboundPolicy`.

- [ ] **Step 5: Implement in service**

In `personal-staff.service.ts`, find the `updateStaff` method (around L478) which currently merges partial fields into `extra`. Add the new handling right before the DB write:

```ts
// Near top of file:
import { isDeepStrictEqual } from "node:util";

// Inside updateStaff, after fetching `current`:
const nextPolicy = dto.dmOutboundPolicy;
const currentPolicy = (current.extra as BotExtra | null)?.dmOutboundPolicy;
let policyChanged = false;
if (nextPolicy !== undefined) {
  policyChanged = !isDeepStrictEqual(currentPolicy ?? null, nextPolicy);
}

// When composing the new extra for the update:
const nextExtra: BotExtra = {
  ...(current.extra as BotExtra),
  ...(nextPolicy !== undefined ? { dmOutboundPolicy: nextPolicy } : {}),
  // ... other merged fields (visibility, persona, etc.) per existing logic
};

// Do the DB write as before, then:
if (policyChanged) {
  this.logger.log({
    event: "bot_dm_outbound_policy_changed",
    botId: current.id,
    botUserId: current.userId,
    actorUserId: requesterUserId, // whatever param the method uses as "who is editing"
    from: currentPolicy ?? null,
    to: nextPolicy,
    timestamp: new Date().toISOString(),
  });
}
```

Adjust `actorUserId` to match the parameter name the service currently uses for "who made this update" — likely `ownerId` or similar based on the explore report (line 478–481).

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm -C apps/server test -- personal-staff.service.spec`
Expected: all new tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/server/apps/gateway/src/applications/dto/dm-outbound-policy.dto.ts \
        apps/server/apps/gateway/src/applications/dto/personal-staff.dto.ts \
        apps/server/apps/gateway/src/applications/personal-staff.service.ts \
        apps/server/apps/gateway/src/applications/personal-staff.service.spec.ts
git commit -m "feat(personal-staff): accept dmOutboundPolicy update + structured change log"
```

---

## Task 6: Common staff DTO + service — mirror Task 5

**Goal:** Same as Task 5, but for common staff. Note: `UpdateCommonStaffDto` currently has no `visibility` field — this is the first visibility-like knob on common staff.

**Files:**

- Modify: `apps/server/apps/gateway/src/applications/dto/common-staff.dto.ts`
- Modify: `apps/server/apps/gateway/src/applications/common-staff.service.ts`
- Modify: `apps/server/apps/gateway/src/applications/common-staff.service.spec.ts`

**Acceptance Criteria:**

- [ ] `UpdateCommonStaffDto.dmOutboundPolicy?: DmOutboundPolicyDto` (reuses Task 5's DTO).
- [ ] Service merges policy into `extra.dmOutboundPolicy`, no-op detection identical to Task 5.
- [ ] Structured log event name matches Task 5 exactly: `bot_dm_outbound_policy_changed`.
- [ ] Unit tests mirror Task 5's shape.

**Verify:** `pnpm -C apps/server test -- common-staff.service.spec` → PASS.

**Steps:**

- [ ] **Step 1: Add field to `UpdateCommonStaffDto`**

In `apps/server/apps/gateway/src/applications/dto/common-staff.dto.ts`, add the import + field to `UpdateCommonStaffDto`:

```ts
import { Type } from "class-transformer";
import { ValidateNested, IsOptional } from "class-validator";
import { DmOutboundPolicyDto } from "./dm-outbound-policy.dto.js";

export class UpdateCommonStaffDto {
  // ... existing fields: displayName, roleTitle, persona, jobDescription, model, avatarUrl, mentorId ...

  @IsOptional()
  @ValidateNested()
  @Type(() => DmOutboundPolicyDto)
  dmOutboundPolicy?: DmOutboundPolicyDto;
}
```

- [ ] **Step 2: Write failing tests**

Mirror Task 5's tests in `common-staff.service.spec.ts`, adjusting:

- Default policy for common staff is `same-tenant`, so fresh write from unset → `same-tenant` behaves as no-op change (the default lookup already returned `same-tenant`). Write a test that flipping from default `same-tenant` to `whitelist` **does** emit the log, and that re-writing the same `same-tenant` (explicit) when extra already has no `dmOutboundPolicy` is treated as a **change** (null → explicit object ≠ equal).

```ts
it("setting explicit same-tenant over absent policy emits change log", async () => {
  stubBotLookup({ id: BOT_ID, extra: { commonStaff: {} } }); // no dmOutboundPolicy
  await service.updateCommonStaff(BOT_ID, MENTOR, {
    dmOutboundPolicy: { mode: "same-tenant" },
  });
  expect(logSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      event: "bot_dm_outbound_policy_changed",
      from: null,
      to: { mode: "same-tenant" },
    }),
  );
});
```

- [ ] **Step 3: Implement in service**

In `common-staff.service.ts`, mirror the exact handling from Task 5 step 5. The service-method name is different (`updateCommonStaff` per explore report), but the pattern is the same: fetch current, diff policy, write, log on real change.

- [ ] **Step 4: Run tests**

Run: `pnpm -C apps/server test -- common-staff.service.spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/apps/gateway/src/applications/dto/common-staff.dto.ts \
        apps/server/apps/gateway/src/applications/common-staff.service.ts \
        apps/server/apps/gateway/src/applications/common-staff.service.spec.ts
git commit -m "feat(common-staff): accept dmOutboundPolicy update + structured change log"
```

---

## Task 7: Add shadcn `radio-group` primitive

**Goal:** Install the missing shadcn radio-group component so the UI block in Task 8 has a primitive to build on.

**Files:**

- Create: `apps/client/src/components/ui/radio-group.tsx`

**Acceptance Criteria:**

- [ ] `RadioGroup` + `RadioGroupItem` exported from `components/ui/radio-group.tsx`.
- [ ] Imports from `@radix-ui/react-radio-group` (same style as other shadcn components in this repo — verify by reading one existing component like `checkbox.tsx`).
- [ ] `pnpm -C apps/client typecheck` passes.

**Verify:** `pnpm -C apps/client typecheck` → no errors.

**Steps:**

- [ ] **Step 1: Install radix peer (if missing)**

Check `apps/client/package.json` for `@radix-ui/react-radio-group`. If absent:

```bash
pnpm -C apps/client add @radix-ui/react-radio-group
```

- [ ] **Step 2: Create the component**

Create `apps/client/src/components/ui/radio-group.tsx` (paste the standard shadcn implementation — match the import style of neighboring `components/ui/*.tsx` files, particularly `checkbox.tsx`):

```tsx
import * as React from "react";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { Circle } from "lucide-react";
import { cn } from "@/lib/utils";

const RadioGroup = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(({ className, ...props }, ref) => (
  <RadioGroupPrimitive.Root
    className={cn("grid gap-2", className)}
    {...props}
    ref={ref}
  />
));
RadioGroup.displayName = RadioGroupPrimitive.Root.displayName;

const RadioGroupItem = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(({ className, ...props }, ref) => (
  <RadioGroupPrimitive.Item
    ref={ref}
    className={cn(
      "aspect-square h-4 w-4 rounded-full border border-primary text-primary shadow focus:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  >
    <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
      <Circle className="h-3.5 w-3.5 fill-primary" />
    </RadioGroupPrimitive.Indicator>
  </RadioGroupPrimitive.Item>
));
RadioGroupItem.displayName = RadioGroupPrimitive.Item.displayName;

export { RadioGroup, RadioGroupItem };
```

Verify `cn` path (`@/lib/utils`) matches what other shadcn components use in this repo — if they use a relative path, match it.

- [ ] **Step 3: Typecheck**

Run: `pnpm -C apps/client typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/client/package.json apps/client/pnpm-lock.yaml \
        apps/client/src/components/ui/radio-group.tsx
git commit -m "chore(ui): add shadcn radio-group primitive"
```

---

## Task 8: `DmOutboundPolicyBlock` component (shared between staff surfaces)

**Goal:** One controlled component that renders the radio group + whitelist picker and calls back with the policy object. Used from both personal + common staff surfaces.

**Files:**

- Create: `apps/client/src/components/ai-staff/DmOutboundPolicyBlock.tsx`
- Create: `apps/client/src/components/ai-staff/MultiUserPicker.tsx`
- Create: `apps/client/src/components/ai-staff/__tests__/DmOutboundPolicyBlock.test.tsx`

**Acceptance Criteria:**

- [ ] `DmOutboundPolicyBlock` accepts `value`, `onChange`, and a `hideOwnerOnly` flag for common staff.
- [ ] Changing mode to `whitelist` reveals the picker; switching to any other mode hides it + clears `userIds`.
- [ ] Whitelist picker enforces 50-entry client-side cap with inline error.
- [ ] Readonly mode disables all inputs (for non-mentor viewers).
- [ ] Tests: mode switch, whitelist reveal, 50-cap inline error, readonly.

**Verify:** `pnpm -C apps/client test -- DmOutboundPolicyBlock` → PASS.

**Steps:**

- [ ] **Step 1: Write the picker (minimal impl)**

Create `apps/client/src/components/ai-staff/MultiUserPicker.tsx`:

```tsx
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/user-avatar";
import { api } from "@/services/api";

export interface UserOption {
  userId: string;
  displayName: string;
  avatarUrl?: string;
}

interface Props {
  value: UserOption[];
  onChange: (next: UserOption[]) => void;
  disabled?: boolean;
  maxItems?: number;
}

export function MultiUserPicker({
  value,
  onChange,
  disabled,
  maxItems = 50,
}: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function runSearch(q: string) {
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const res = await api.search.users({ q });
    setResults(
      res.users.items
        .filter((u) => !value.some((v) => v.userId === u.id))
        .map((u) => ({
          userId: u.id,
          displayName: u.displayName,
          avatarUrl: u.avatarUrl,
        })),
    );
  }

  function add(opt: UserOption) {
    if (value.length >= maxItems) {
      setError(`Maximum ${maxItems} users.`);
      return;
    }
    setError(null);
    onChange([...value, opt]);
    setQuery("");
    setResults([]);
  }

  function remove(userId: string) {
    onChange(value.filter((v) => v.userId !== userId));
    setError(null);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {value.map((v) => (
          <button
            key={v.userId}
            type="button"
            disabled={disabled}
            onClick={() => remove(v.userId)}
            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm hover:bg-muted disabled:opacity-50"
          >
            <UserAvatar
              displayName={v.displayName}
              avatarUrl={v.avatarUrl}
              size="xs"
            />
            {v.displayName}
            <span aria-hidden>×</span>
          </button>
        ))}
      </div>
      {!disabled && value.length < maxItems && (
        <>
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              void runSearch(e.target.value);
            }}
            placeholder="Search by name or email…"
            disabled={disabled}
          />
          {results.length > 0 && (
            <ul className="rounded-md border bg-popover">
              {results.map((r) => (
                <li key={r.userId}>
                  <Button
                    variant="ghost"
                    className="w-full justify-start"
                    onClick={() => add(r)}
                    type="button"
                  >
                    <UserAvatar
                      displayName={r.displayName}
                      avatarUrl={r.avatarUrl}
                      size="xs"
                    />
                    <span className="ml-2">{r.displayName}</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
```

`UserAvatar` exists per explore report (`components/ui/user-avatar.tsx`). `api.search.users` call shape: verify against `apps/client/src/services/api/` exports — if the method differs, adjust the import + call.

- [ ] **Step 2: Write the policy block**

Create `apps/client/src/components/ai-staff/DmOutboundPolicyBlock.tsx`:

```tsx
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { MultiUserPicker, type UserOption } from "./MultiUserPicker";
import type { DmOutboundPolicyMode } from "@/types/bot-dm-policy";

export interface DmOutboundPolicyValue {
  mode: DmOutboundPolicyMode;
  userIds?: string[];
}

interface Props {
  value: DmOutboundPolicyValue;
  onChange: (next: DmOutboundPolicyValue) => void;
  /** If true, hide the `owner-only` option (common staff surface). */
  hideOwnerOnly?: boolean;
  disabled?: boolean;
  /** Whitelist picker hydration (server sends userIds; UI needs display names). */
  whitelistUsers?: UserOption[];
  onWhitelistUsersChange?: (users: UserOption[]) => void;
}

export function DmOutboundPolicyBlock({
  value,
  onChange,
  hideOwnerOnly,
  disabled,
  whitelistUsers = [],
  onWhitelistUsersChange,
}: Props) {
  function setMode(mode: DmOutboundPolicyMode) {
    if (mode === "whitelist") {
      onChange({ mode, userIds: value.userIds ?? [] });
    } else {
      onChange({ mode });
      onWhitelistUsersChange?.([]);
    }
  }

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">Outbound DM</h3>
      <p className="text-sm text-muted-foreground">
        Who can this assistant message first?
      </p>
      <RadioGroup
        value={value.mode}
        onValueChange={(v) => setMode(v as DmOutboundPolicyMode)}
        disabled={disabled}
      >
        {!hideOwnerOnly && (
          <div className="flex items-center gap-2">
            <RadioGroupItem value="owner-only" id="dm-owner-only" />
            <Label htmlFor="dm-owner-only">Only me</Label>
          </div>
        )}
        <div className="flex items-center gap-2">
          <RadioGroupItem value="same-tenant" id="dm-same-tenant" />
          <Label htmlFor="dm-same-tenant">Anyone in this workspace</Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem value="whitelist" id="dm-whitelist" />
          <Label htmlFor="dm-whitelist">Specific people…</Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem value="anyone" id="dm-anyone" />
          <Label htmlFor="dm-anyone">Anyone</Label>
        </div>
      </RadioGroup>
      {value.mode === "whitelist" && (
        <MultiUserPicker
          value={whitelistUsers}
          onChange={(users) => {
            onWhitelistUsersChange?.(users);
            onChange({
              mode: "whitelist",
              userIds: users.map((u) => u.userId),
            });
          }}
          disabled={disabled}
          maxItems={50}
        />
      )}
    </section>
  );
}
```

Also create the type file `apps/client/src/types/bot-dm-policy.ts` (or add to an existing types file):

```ts
export type DmOutboundPolicyMode =
  | "owner-only"
  | "same-tenant"
  | "whitelist"
  | "anyone";

export interface DmOutboundPolicy {
  mode: DmOutboundPolicyMode;
  userIds?: string[];
}
```

- [ ] **Step 3: Write tests**

Create `apps/client/src/components/ai-staff/__tests__/DmOutboundPolicyBlock.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DmOutboundPolicyBlock } from "../DmOutboundPolicyBlock";

describe("DmOutboundPolicyBlock", () => {
  it("renders all 4 modes by default", () => {
    render(
      <DmOutboundPolicyBlock
        value={{ mode: "owner-only" }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText("Only me")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Anyone in this workspace"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Specific people…")).toBeInTheDocument();
    expect(screen.getByLabelText("Anyone")).toBeInTheDocument();
  });

  it("hides owner-only when hideOwnerOnly", () => {
    render(
      <DmOutboundPolicyBlock
        value={{ mode: "same-tenant" }}
        onChange={() => {}}
        hideOwnerOnly
      />,
    );
    expect(screen.queryByLabelText("Only me")).not.toBeInTheDocument();
  });

  it("reveals whitelist picker only in whitelist mode", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <DmOutboundPolicyBlock
        value={{ mode: "same-tenant" }}
        onChange={onChange}
      />,
    );
    expect(
      screen.queryByPlaceholderText(/Search by name/),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByLabelText("Specific people…"));
    expect(onChange).toHaveBeenCalledWith({ mode: "whitelist", userIds: [] });

    rerender(
      <DmOutboundPolicyBlock
        value={{ mode: "whitelist", userIds: [] }}
        onChange={onChange}
      />,
    );
    expect(screen.getByPlaceholderText(/Search by name/)).toBeInTheDocument();
  });

  it("disables all inputs when disabled", () => {
    render(
      <DmOutboundPolicyBlock
        value={{ mode: "owner-only" }}
        onChange={() => {}}
        disabled
      />,
    );
    expect(screen.getByRole("radiogroup")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });
});
```

- [ ] **Step 4: Run tests**

Run: `pnpm -C apps/client test -- DmOutboundPolicyBlock`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/components/ai-staff/DmOutboundPolicyBlock.tsx \
        apps/client/src/components/ai-staff/MultiUserPicker.tsx \
        apps/client/src/components/ai-staff/__tests__/DmOutboundPolicyBlock.test.tsx \
        apps/client/src/types/bot-dm-policy.ts
git commit -m "feat(ai-staff): DmOutboundPolicyBlock + MultiUserPicker components"
```

---

## Task 9: Client API types + mutation wiring for `dmOutboundPolicy`

**Goal:** Plumb the new field through the client API service so both detail sections can write it with the existing mutation hook.

**Files:**

- Modify: `apps/client/src/services/api/applications.ts`

**Acceptance Criteria:**

- [ ] `UpdatePersonalStaffDto` (client-side type) includes `dmOutboundPolicy?: DmOutboundPolicy`.
- [ ] `UpdateCommonStaffDto` (client-side type) includes the same.
- [ ] `api.applications.updatePersonalStaff(appId, body)` sends the field when present.
- [ ] `pnpm -C apps/client typecheck` passes.

**Verify:** `pnpm -C apps/client typecheck` → no errors.

**Steps:**

- [ ] **Step 1: Extend client DTO types**

In `apps/client/src/services/api/applications.ts`, find the existing `UpdatePersonalStaffDto` + `UpdateCommonStaffDto` type exports. Add import + field:

```ts
import type { DmOutboundPolicy } from "@/types/bot-dm-policy";

export interface UpdatePersonalStaffDto {
  // ... existing fields
  dmOutboundPolicy?: DmOutboundPolicy;
}

export interface UpdateCommonStaffDto {
  // ... existing fields
  dmOutboundPolicy?: DmOutboundPolicy;
}
```

If the API client serializes via generic `fetch`, no body-builder change is needed. If it has a hand-rolled whitelist, add `dmOutboundPolicy` to the forwarded keys.

- [ ] **Step 2: Typecheck**

Run: `pnpm -C apps/client typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/client/src/services/api/applications.ts
git commit -m "feat(client-api): thread dmOutboundPolicy through staff update payloads"
```

---

## Task 10: Embed `DmOutboundPolicyBlock` into `PersonalStaffDetailSection`

**Goal:** Mentor sees the outbound DM block on personal staff detail; changing it dispatches the existing `updateMutation` with the new payload.

**Files:**

- Modify: `apps/client/src/components/ai-staff/PersonalStaffDetailSection.tsx`
- Modify: `apps/client/src/components/ai-staff/__tests__/AIStaffMainContent.test.tsx` (or dedicated new test)

**Acceptance Criteria:**

- [ ] The `Outbound DM` section renders directly below the existing visibility toggles (~line 664).
- [ ] Mentor viewers see all 4 modes editable; non-mentor viewers see it disabled.
- [ ] Changing the mode triggers `updateMutation.mutate({ dmOutboundPolicy: <next> })`.
- [ ] Whitelist mode hydrates `whitelistUsers` from an initial API fetch of the referenced userIds' display names (simple: re-use `api.search.users` or `api.users.bulkGet` if available).
- [ ] Existing `PersonalStaffDetailSection` tests still pass.

**Verify:** `pnpm -C apps/client typecheck && pnpm -C apps/client test -- PersonalStaff` → PASS.

**Steps:**

- [ ] **Step 1: Import + local state**

Open `apps/client/src/components/ai-staff/PersonalStaffDetailSection.tsx`. Near existing imports:

```tsx
import { DmOutboundPolicyBlock } from "./DmOutboundPolicyBlock";
import type { DmOutboundPolicy } from "@/types/bot-dm-policy";
import type { UserOption } from "./MultiUserPicker";
```

Inside the component body (near the existing `visibility` toggle handlers):

```tsx
const [whitelistUsers, setWhitelistUsers] = useState<UserOption[]>([]);
const currentPolicy: DmOutboundPolicy = bot.dmOutboundPolicy ?? {
  mode: "owner-only",
};

// Hydrate display-name cache for whitelist on mount/change of bot
useEffect(() => {
  if (currentPolicy.mode !== "whitelist") return;
  if (!currentPolicy.userIds || currentPolicy.userIds.length === 0) {
    setWhitelistUsers([]);
    return;
  }
  // If a bulk-get endpoint exists, use it; else fire a search per id (≤50 ids).
  // Fallback: leave ids as plain chips for v1 — backend persists, UI catches up.
  void fetchUsersByIds(currentPolicy.userIds).then(setWhitelistUsers);
}, [bot.id, currentPolicy.mode, currentPolicy.userIds?.join(",")]);
```

`fetchUsersByIds` is a helper that either reuses `api.users.bulkGet` if present or degrades to displaying raw ids — add whichever matches the client's API surface. If neither is available, fall back to fetching profiles one-by-one via an existing `api.users.get(userId)` pattern.

- [ ] **Step 2: Render the block**

Add the block below the existing visibility toggles (~line 664):

```tsx
<DmOutboundPolicyBlock
  value={currentPolicy}
  onChange={(next) => updateMutation.mutate({ dmOutboundPolicy: next })}
  disabled={!isMentor}
  whitelistUsers={whitelistUsers}
  onWhitelistUsersChange={setWhitelistUsers}
/>
```

`isMentor` = whether the current viewer is the bot's mentor — compute from `bot.mentorId === currentUserId` using existing context hooks (the file already resolves `currentUser` for visibility toggles).

- [ ] **Step 3: Test**

Add a dedicated test file `apps/client/src/components/ai-staff/__tests__/PersonalStaffDetailSection.dm.test.tsx` (or extend the existing test file):

```tsx
it("mentor can change outbound DM policy", async () => {
  const mutate = vi.fn();
  // ... render PersonalStaffDetailSection with bot owned by current user
  await userEvent.click(screen.getByLabelText("Anyone in this workspace"));
  expect(mutate).toHaveBeenCalledWith({
    dmOutboundPolicy: { mode: "same-tenant" },
  });
});

it("non-mentor sees disabled block", () => {
  // ... render with bot whose mentorId !== current user
  expect(screen.getByRole("radiogroup")).toHaveAttribute(
    "aria-disabled",
    "true",
  );
});
```

- [ ] **Step 4: Run typecheck + tests**

Run: `pnpm -C apps/client typecheck && pnpm -C apps/client test -- PersonalStaff`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/components/ai-staff/PersonalStaffDetailSection.tsx \
        apps/client/src/components/ai-staff/__tests__/PersonalStaffDetailSection.dm.test.tsx
git commit -m "feat(personal-staff-ui): outbound DM policy block (4 modes, mentor-gated)"
```

---

## Task 11: Embed `DmOutboundPolicyBlock` into the common-staff detail surface

**Goal:** Mirror Task 10 for common staff, but pass `hideOwnerOnly`. Default on first render is `same-tenant`.

**Files:**

- Modify: whichever file renders common-staff detail editing. First locate it — search for `UpdateCommonStaffDto` consumers in `apps/client/src/` or files named `CommonStaff*.tsx`. Most likely candidates:
  - `apps/client/src/components/ai-staff/CommonStaffDetailSection.tsx`
  - `apps/client/src/components/layout/contents/AIStaffMainContent.tsx`
- Modify: corresponding test file.

**Acceptance Criteria:**

- [ ] Common-staff detail renders the block with `hideOwnerOnly` → 3 modes visible.
- [ ] Default display when `bot.dmOutboundPolicy` is absent: `same-tenant`.
- [ ] Changing mode triggers `updateCommonStaff` mutation with `{ dmOutboundPolicy }`.

**Verify:** `pnpm -C apps/client typecheck && pnpm -C apps/client test -- CommonStaff` → PASS (or whichever test file).

**Steps:**

- [ ] **Step 1: Locate the file**

Run (from project root):

```bash
grep -rl "UpdateCommonStaffDto\|updateCommonStaff" apps/client/src | head -20
```

Read the top match to confirm it renders a detail section with mutation. If there is no existing dedicated component, extend whatever parent (e.g. `AIStaffMainContent.tsx`) owns the common-staff edit surface.

- [ ] **Step 2: Import + embed**

Mirror Task 10's import and render block, but pass `hideOwnerOnly`:

```tsx
import { DmOutboundPolicyBlock } from "./DmOutboundPolicyBlock";

// inside component:
const currentPolicy = bot.dmOutboundPolicy ?? { mode: "same-tenant" as const };

<DmOutboundPolicyBlock
  value={currentPolicy}
  onChange={(next) =>
    updateCommonStaffMutation.mutate({ dmOutboundPolicy: next })
  }
  disabled={!isMentor}
  hideOwnerOnly
  whitelistUsers={whitelistUsers}
  onWhitelistUsersChange={setWhitelistUsers}
/>;
```

- [ ] **Step 3: Test**

Mirror Task 10's tests, asserting `owner-only` radio is **not** rendered and that the default is `same-tenant`.

- [ ] **Step 4: Run**

Run: `pnpm -C apps/client typecheck && pnpm -C apps/client test -- CommonStaff`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add <common-staff-detail-file> <test-file>
git commit -m "feat(common-staff-ui): outbound DM policy block (3 modes, mentor-gated)"
```

---

## Task 12: Integration test for `BotMessagingController`

**Goal:** End-to-end verification through the gateway: bot token → ACL → DM created → message persisted → WS broadcast fires. Uses supertest pattern matching the rest of the gateway test suite.

**Files:**

- Create: `apps/server/apps/gateway/src/im/bot/bot-messaging.controller.spec.ts`

**Acceptance Criteria:**

- [ ] Happy `send-to-user`: 201 with `{ channelId, messageId }`, DM row created in the test DB.
- [ ] ACL failures map to HTTP codes: 403 `DM_NOT_ALLOWED`, 404 `USER_NOT_FOUND`, 400 `SELF_DM`, 400 `CROSS_TENANT`.
- [ ] Missing/invalid bot token → 401.
- [ ] `users/search` happy path returns mapped fields (no email), excludes bots.
- [ ] `users/search` with `limit=50` → 400 (DTO cap is 10).
- [ ] `users/search` with `q=a` (< 2 chars) → 400.

**Verify:** `pnpm -C apps/server test -- bot-messaging.controller.spec` → PASS.

**Steps:**

- [ ] **Step 1: Set up the test scaffold**

Mirror the setup in an existing gateway integration test (e.g.
`apps/server/apps/gateway/src/im/channels/channels.controller.spec.ts`):

- Spin up `Test.createTestingModule({ imports: [ChannelsModule, MessagesModule, SearchModule, BotMessagingModule] })`.
- Mock `imWorkerGrpcClientService.createMessage` to return a synthetic msgId.
- Stub `websocketGateway.sendToChannelMembers` as a spy.
- Provide an in-memory-seeded test DB (reuse the test fixture factory used by other controller specs).

- [ ] **Step 2: Write happy-path test**

```ts
describe("POST /v1/im/bot/send-to-user", () => {
  it("creates DM + sends message + returns ids", async () => {
    const bot = await seedPersonalStaffBot({ ownerId: owner.id });
    const res = await request(app.getHttpServer())
      .post("/v1/im/bot/send-to-user")
      .set("Authorization", `Bearer ${bot.accessToken}`)
      .send({ userId: owner.id, content: "hello owner" })
      .expect(201);
    expect(res.body).toEqual({
      channelId: expect.any(String),
      messageId: expect.any(String),
    });
    const channel = await db.query.channels.findFirst({
      where: (c, { eq }) => eq(c.id, res.body.channelId),
    });
    expect(channel?.type).toBe("direct");
  });
});
```

- [ ] **Step 3: Write ACL failure tests**

```ts
it("403 DM_NOT_ALLOWED when owner-only and target != owner", async () => {
  const bot = await seedPersonalStaffBot({ ownerId: owner.id });
  const other = await seedUser({ tenantId: bot.tenantId });
  const res = await request(app.getHttpServer())
    .post("/v1/im/bot/send-to-user")
    .set("Authorization", `Bearer ${bot.accessToken}`)
    .send({ userId: other.id, content: "spam" })
    .expect(403);
  expect(res.body.message).toContain("DM_NOT_ALLOWED");
});

it("404 USER_NOT_FOUND for unknown userId", async () => {
  /* ... */
});
it("400 SELF_DM when userId is the bot itself", async () => {
  /* ... */
});
it("400 CROSS_TENANT for different-tenant user", async () => {
  /* ... */
});
it("401 without bot token", async () => {
  /* ... */
});
```

- [ ] **Step 4: Write `users/search` tests**

```ts
describe("GET /v1/im/bot/users/search", () => {
  it("returns mapped fields without email", async () => {
    const bot = await seedPersonalStaffBot({ ownerId: owner.id });
    await seedUser({
      displayName: "Alice",
      tenantId: bot.tenantId,
      email: "a@x",
    });
    const res = await request(app.getHttpServer())
      .get("/v1/im/bot/users/search")
      .set("Authorization", `Bearer ${bot.accessToken}`)
      .query({ q: "Ali" })
      .expect(200);
    expect(res.body.results[0]).toEqual({
      userId: expect.any(String),
      displayName: "Alice",
    });
    expect(res.body.results[0]).not.toHaveProperty("email");
  });

  it("excludes bot users from results", async () => {
    const bot = await seedPersonalStaffBot({ ownerId: owner.id });
    const otherBot = await seedPersonalStaffBot({
      ownerId: owner.id,
      displayName: "Helper",
    });
    const res = await request(app.getHttpServer())
      .get("/v1/im/bot/users/search")
      .set("Authorization", `Bearer ${bot.accessToken}`)
      .query({ q: "Help" })
      .expect(200);
    expect(
      res.body.results.find((r: any) => r.userId === otherBot.userId),
    ).toBeUndefined();
  });

  it("400 when q < 2 chars", async () => {
    /* ... */
  });
  it("400 when limit > 10", async () => {
    /* ... */
  });
});
```

- [ ] **Step 5: Run**

Run: `pnpm -C apps/server test -- bot-messaging.controller.spec`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/apps/gateway/src/im/bot/bot-messaging.controller.spec.ts
git commit -m "test(bot-messaging): end-to-end controller + ACL integration tests"
```

---

## Task 13: Manual smoke + rollout notes

**Goal:** One pass through the feature in a running dev environment before merging. No code.

**Acceptance Criteria:**

- [ ] `pnpm -C apps/server build` succeeds.
- [ ] `pnpm -C apps/client build` succeeds.
- [ ] Hit `POST /v1/im/bot/send-to-user` from curl with a real bot token, confirm a DM appears in the web UI.
- [ ] Toggle the DM policy in the Personal Staff detail page, confirm pino log line appears in gateway stdout.
- [ ] Toggle to whitelist mode with a picked user, confirm `extra.dmOutboundPolicy` in DB.

**Steps:**

- [ ] **Step 1: Build both sides**

```bash
pnpm -C apps/server build
pnpm -C apps/client build
```

- [ ] **Step 2: Smoke `send-to-user`**

```bash
curl -X POST http://localhost:4000/v1/im/bot/send-to-user \
  -H "Authorization: Bearer <dev-bot-token>" \
  -H "Content-Type: application/json" \
  -d '{"userId":"<owner-uuid>","content":"hello from curl"}'
```

Expected: 201 + `{ channelId, messageId }`. Open the web UI as the owner — the DM should appear in the sidebar with the message.

- [ ] **Step 3: Smoke `users/search`**

```bash
curl "http://localhost:4000/v1/im/bot/users/search?q=<name-fragment>" \
  -H "Authorization: Bearer <dev-bot-token>"
```

Expected: `{ results: [{ userId, displayName, avatarUrl? }] }`. No `email` field.

- [ ] **Step 4: Smoke UI policy change**

Open Personal Staff detail as the owner/mentor. Change the Outbound DM radio from _Only me_ to _Anyone in this workspace_. Check gateway stdout for the `bot_dm_outbound_policy_changed` log line. Query DB directly:

```sql
SELECT id, extra->'dmOutboundPolicy' FROM im_bots WHERE id = '<bot-id>';
```

Expected: `{"mode": "same-tenant"}`.

- [ ] **Step 5: Wrap up**

No commit. This task documents the smoke procedure; anything broken here sends you back to an earlier task.

---

## Rollout Notes

The companion agent-pi side (`SendToUser` tool + `ResolveUser`) ships independently — see its own plan. Order:

1. **Team9 gateway** (this plan) — unlocks the endpoint. Safe to deploy alone; no client calls until agent-pi ships.
2. **Team9 client** (Tasks 7–11) — unlocks mentor-facing settings. Safe to deploy alone; without a policy change, bots use per-type defaults.
3. **Agent-pi** — ships the tool that actually calls `send-to-user`. Without the gateway side, agent-pi tool returns `network_error`; safe to deploy in either order.

## Decisions locked during planning

- Rather than refactoring `MessagesController.createMessage` (150-line multi-concern method), added a narrower `MessagesService.sendFromBot` helper. Keeps scope tight; the larger refactor can happen separately.
- `AuthGuard` already accepts bot tokens via the `BOT_TOKEN_VALIDATOR` provider (verified in `BotModule`). No new guard needed — reuse `@UseGuards(AuthGuard)` + `@CurrentUser('sub')`.
- `SearchService.searchUsers` returns email in its raw result. The bot-scoped endpoint explicitly drops it in the mapper (Task 4).
- Bot-user filtering is a controller-level concern backed by a narrow `ChannelsService.filterBotUserIds` helper (Task 4 Step 3).
