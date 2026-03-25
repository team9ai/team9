# Tracking Channel v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stream the agent's full execution process into a dedicated "tracking channel" visible to users, with real-time guidance support during execution and read-only archival when execution ends.

**Architecture:** When a group @mention triggers a hive-managed bot, the IM-Worker creates a tracking channel and a placeholder system message in the original channel. The tracking channel ID is passed to claw-hive via the event payload. The agent-side `TrackingChannelObserver` (external dependency — claw-hive team) writes execution events into the tracking channel. When execution ends, the observer calls `POST /deactivate` to mark the channel as archived. Users can send guidance messages into an active tracking channel; these are routed to the same claw-hive session. For DM channels, the DM itself serves as the tracking channel — no separate channel is created.

**Base branch:** `origin/dev` (NOT main)

**Tech Stack:** NestJS (Team9 server), Drizzle ORM + PostgreSQL, TypeScript, Jest (server-side tests)

**Key Design Rules:**

- One tracking channel = one agent interaction (triggered by @mention in group channel)
- DM/task channels are their own tracking channels (no separate creation)
- Group @mention → new tracking channel per interaction
- `isActivated` field (default `true`) controls channel writability; `false` = read-only archive
- `isActivated` is **bidirectional** — can be reactivated (e.g., for future use cases)
- Session ID for group tracking: `team9/{tenantId}/{agentId}/tracking/{trackingChannelId}`
- Guidance in tracking channel routes to the **same session** (same `trackingChannelId` in session ID)
- Agent-side observer and claw-hive wiring are **external dependencies** — not in this plan's scope

**External Dependencies (claw-hive team):**

- `TrackingChannelObserver`: listens to agent execution events, writes to tracking channel via Team9 API
- `HiveRuntime.createSession()`: wires observer into session lifecycle
- `Team9ApiClient.deactivateChannel()`: calls `POST /deactivate` when execution ends
- claw-hive event reporting interface: supports insert, auto-trigger, and interrupt for guidance

---

## File Structure

### Team9 Server Side

| Action | File                                                                      | Responsibility                                                                                                                 |
| ------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Modify | `apps/server/libs/database/src/schemas/im/channels.ts`                    | Add `'tracking'` to `channelTypeEnum`, add `isActivated` field                                                                 |
| Modify | `apps/server/apps/gateway/src/im/channels/channels.service.ts`            | Add `'tracking'` to `ChannelResponse.type`, add `isActivated` field, add `deactivateChannel()` and `activateChannel()` methods |
| Modify | `apps/server/apps/gateway/src/im/channels/channels.controller.ts`         | Add `POST :id/deactivate` and `POST :id/activate` endpoints                                                                    |
| Modify | `apps/server/apps/im-worker/src/post-broadcast/post-broadcast.service.ts` | Add `createTrackingChannel()`, extend `pushToHiveBots()` with tracking channel creation and routing                            |
| Modify | `apps/server/apps/gateway/src/im/messages/messages.controller.ts`         | Reject messages to deactivated channels                                                                                        |
| Modify | `apps/server/libs/shared/src/events/event-names.ts`                       | Add `TRACKING` event group with `DEACTIVATED` and `ACTIVATED` events                                                           |
| Create | DB migration                                                              | Add `'tracking'` enum value + `is_activated` column                                                                            |

---

## Task 1: Add `tracking` Channel Type and `isActivated` Field to Database Schema

**Files:**

- Modify: `apps/server/libs/database/src/schemas/im/channels.ts`
- Modify: `apps/server/apps/gateway/src/im/channels/channels.service.ts:28-41`
- Create: DB migration

- [ ] **Step 1: Add `'tracking'` to `channelTypeEnum` and `isActivated` to channels table**

In `apps/server/libs/database/src/schemas/im/channels.ts`, the enum at line 3-8:

```typescript
export const channelTypeEnum = pgEnum("channel_type", [
  "direct",
  "public",
  "private",
  "task",
  "tracking",
]);
```

In the same file, after `isArchived` (around line 36), add:

```typescript
    isActivated: boolean('is_activated').default(true).notNull(),
```

- [ ] **Step 2: Update `ChannelResponse` interface**

In `apps/server/apps/gateway/src/im/channels/channels.service.ts`, update lines 28-41:

```typescript
export interface ChannelResponse {
  id: string;
  tenantId: string | null;
  name: string | null;
  description: string | null;
  type: "direct" | "public" | "private" | "task" | "tracking";
  avatarUrl: string | null;
  createdBy: string | null;
  sectionId: string | null;
  order: number;
  isArchived: boolean;
  isActivated: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

Also update `ChannelWithUnread` if it inherits `ChannelResponse` (it does via `extends` — no change needed, it inherits automatically).

- [ ] **Step 3: Generate and run migration**

```bash
cd apps/server && pnpm db:generate
```

Review the generated SQL — it should contain:

```sql
ALTER TYPE "public"."channel_type" ADD VALUE 'tracking';
ALTER TABLE "im_channels" ADD COLUMN "is_activated" boolean DEFAULT true NOT NULL;
```

The migration will be numbered `0027` (dev is at `0026`).

```bash
pnpm db:migrate
```

- [ ] **Step 4: Commit**

```bash
git add apps/server/libs/database/src/schemas/im/channels.ts \
       apps/server/apps/gateway/src/im/channels/channels.service.ts \
       apps/server/libs/database/migrations/
git commit -m "feat(db): add 'tracking' channel type and isActivated field to schema"
```

---

## Task 2: Add Tracking Event Names

**Files:**

- Modify: `apps/server/libs/shared/src/events/event-names.ts`

- [ ] **Step 1: Add `TRACKING` event group to `WS_EVENTS`**

In `apps/server/libs/shared/src/events/event-names.ts`, add after the `TASK` section (around line 217):

```typescript
  // ==================== Tracking Channel ====================
  /**
   * Tracking channel lifecycle events
   */
  TRACKING: {
    /** Tracking channel deactivated (execution complete, read-only) */
    DEACTIVATED: 'tracking:deactivated',
    /** Tracking channel activated (resumed for new execution) */
    ACTIVATED: 'tracking:activated',
  },
```

- [ ] **Step 2: Add `TRACKING` to `WsEventName` union**

In the `WsEventName` type union (around line 235), add:

```typescript
  | (typeof WS_EVENTS.TRACKING)[keyof typeof WS_EVENTS.TRACKING]
```

- [ ] **Step 3: Commit**

```bash
git add apps/server/libs/shared/src/events/event-names.ts
git commit -m "feat(shared): add TRACKING event group to WS_EVENTS"
```

---

## Task 3: Add `deactivateChannel()` and `activateChannel()` to Service + Controller

**Files:**

- Modify: `apps/server/apps/gateway/src/im/channels/channels.service.ts`
- Modify: `apps/server/apps/gateway/src/im/channels/channels.controller.ts`

- [ ] **Step 1: Add `deactivateChannel()` method to `ChannelsService`**

In `apps/server/apps/gateway/src/im/channels/channels.service.ts`, add after the `archiveChannel` method (around line 795):

```typescript
  /**
   * Deactivate a channel — sets isActivated=false, preventing further messages.
   * Used when agent execution ends to make the tracking channel read-only.
   * Also applicable to task channels when execution completes.
   */
  async deactivateChannel(channelId: string): Promise<void> {
    const channel = await this.findById(channelId);
    if (!channel) {
      throw new NotFoundException('Channel not found');
    }
    if (channel.type !== 'tracking' && channel.type !== 'task') {
      throw new ForbiddenException('Only tracking and task channels can be deactivated');
    }

    await this.db
      .update(schema.channels)
      .set({ isActivated: false, updatedAt: new Date() })
      .where(eq(schema.channels.id, channelId));

    await this.redis.invalidate(REDIS_KEYS.CHANNEL_CACHE(channelId));
  }

  /**
   * Activate a channel — sets isActivated=true, allowing messages again.
   * Used to reactivate a previously deactivated tracking/task channel.
   */
  async activateChannel(channelId: string): Promise<void> {
    const channel = await this.findById(channelId);
    if (!channel) {
      throw new NotFoundException('Channel not found');
    }
    if (channel.type !== 'tracking' && channel.type !== 'task') {
      throw new ForbiddenException('Only tracking and task channels can be activated');
    }

    await this.db
      .update(schema.channels)
      .set({ isActivated: true, updatedAt: new Date() })
      .where(eq(schema.channels.id, channelId));

    await this.redis.invalidate(REDIS_KEYS.CHANNEL_CACHE(channelId));
  }
```

- [ ] **Step 2: Add `POST :id/deactivate` endpoint to controller**

In `apps/server/apps/gateway/src/im/channels/channels.controller.ts`, add after the `unarchiveChannel` endpoint:

```typescript
  @Post(':id/deactivate')
  async deactivateChannel(
    @CurrentUser('sub') userId: string,
    @Param('id') channelId: string,
  ): Promise<{ success: boolean }> {
    const isMember = await this.channelsService.isMember(channelId, userId);
    if (!isMember) {
      throw new ForbiddenException('Not a channel member');
    }

    // Only bots can deactivate channels (execution lifecycle is bot-controlled)
    const isBot = await this.channelsService.isBot(userId);
    if (!isBot) {
      throw new ForbiddenException('Only bots can deactivate channels');
    }

    await this.channelsService.deactivateChannel(channelId);

    await this.websocketGateway.sendToChannelMembers(
      channelId,
      WS_EVENTS.TRACKING.DEACTIVATED,
      { channelId },
    );

    return { success: true };
  }

  @Post(':id/activate')
  async activateChannel(
    @CurrentUser('sub') userId: string,
    @Param('id') channelId: string,
  ): Promise<{ success: boolean }> {
    const isMember = await this.channelsService.isMember(channelId, userId);
    if (!isMember) {
      throw new ForbiddenException('Not a channel member');
    }

    // Only bots can activate channels
    const isBot = await this.channelsService.isBot(userId);
    if (!isBot) {
      throw new ForbiddenException('Only bots can activate channels');
    }

    await this.channelsService.activateChannel(channelId);

    await this.websocketGateway.sendToChannelMembers(
      channelId,
      WS_EVENTS.TRACKING.ACTIVATED,
      { channelId },
    );

    return { success: true };
  }
```

Add `WS_EVENTS` to the imports from `../websocket/events/events.constants.js` if not already imported.

- [ ] **Step 3: Commit**

```bash
git add apps/server/apps/gateway/src/im/channels/channels.service.ts \
       apps/server/apps/gateway/src/im/channels/channels.controller.ts
git commit -m "feat(gateway): add deactivate/activate endpoints for tracking and task channels"
```

---

## Task 4: Enforce `isActivated` Check in Message Creation

**Files:**

- Modify: `apps/server/apps/gateway/src/im/messages/messages.controller.ts`

- [ ] **Step 1: Add `isActivated` check before message creation**

In `apps/server/apps/gateway/src/im/messages/messages.controller.ts`, in `createMessage()` (line 103-160), after the channel is fetched (line 121-123), add:

```typescript
// Get workspaceId (tenantId) from channel for message context
const channel = await this.channelsService.findById(channelId);
const t2 = Date.now();
const workspaceId = channel?.tenantId ?? undefined;

// Reject messages to deactivated tracking/task channels
if (channel && !channel.isActivated) {
  throw new ForbiddenException(
    "Channel is deactivated — execution has completed",
  );
}
```

This rejects messages from **both** users and bots to deactivated channels. The bot sends its final message before calling deactivate, so there's no ordering issue.

- [ ] **Step 2: Commit**

```bash
git add apps/server/apps/gateway/src/im/messages/messages.controller.ts
git commit -m "feat(gateway): reject messages to deactivated channels"
```

---

## Task 5: Create Tracking Channel in `pushToHiveBots`

This is the core IM-Worker change. When a group message triggers a hive bot, create a tracking channel + placeholder message before sending to claw-hive. When a message comes from a tracking channel, route it to the same session.

**Files:**

- Modify: `apps/server/apps/im-worker/src/post-broadcast/post-broadcast.service.ts`

- [ ] **Step 1: Add `createTrackingChannel` private method**

In `apps/server/apps/im-worker/src/post-broadcast/post-broadcast.service.ts`, add after the `pushToBotWebhooks` method (after line 421):

```typescript
  // ── Tracking Channel Creation ──────────────────────────────────

  /**
   * Create a tracking channel for a hive bot interaction.
   * Tracking channels show the agent's execution process in real-time.
   *
   * Inserts: channel (type='tracking'), two members (bot + trigger sender),
   * and a placeholder system message in the original channel linking to the
   * tracking channel.
   */
  private async createTrackingChannel(
    tenantId: string | null,
    botUserId: string,
    triggerSenderId: string,
    triggerMessageId: string,
    originalChannelId: string,
  ): Promise<string> {
    const channelId = uuidv7();

    await this.db.transaction(async (tx) => {
      await tx.insert(schema.channels).values({
        id: channelId,
        tenantId,
        name: null,
        type: 'tracking',
        createdBy: botUserId,
      });

      await tx.insert(schema.channelMembers).values({
        id: uuidv7(),
        channelId,
        userId: botUserId,
        role: 'member',
      });

      await tx.insert(schema.channelMembers).values({
        id: uuidv7(),
        channelId,
        userId: triggerSenderId,
        role: 'member',
      });

      // Placeholder message in original channel — client renders as tracking link
      await tx.insert(schema.messages).values({
        id: uuidv7(),
        channelId: originalChannelId,
        senderId: botUserId,
        content: '',
        type: 'system',
        metadata: {
          trackingChannelId: channelId,
          triggerMessageId,
        },
      });
    });

    return channelId;
  }
```

> **Note:** The placeholder message is inserted via direct `tx.insert`, bypassing the gateway's normal message creation flow (no WebSocket broadcast, no postBroadcast pipeline). The client in the original channel will NOT receive this message in real-time via WebSocket. Options: (a) the bot's first streaming message in the original channel naturally pushes clients to refetch, (b) add an explicit WebSocket emit via RabbitMQ → Gateway relay, or (c) the client periodically fetches new messages. This is a **client-team concern** — choose the approach during client implementation.

- [ ] **Step 2: Modify `pushToHiveBots` to create tracking channel for group @mentions and route tracking channel messages**

Replace the current `pushToHiveBots` method (lines 432-530) with the updated version. Key changes:

1. Add `isTracking` / `alwaysForward` logic
2. Create tracking channel for group @mentions only
3. Route tracking channel messages to the same session (no new channel)
4. Pass `trackingChannelId` in event payload for non-DM

```typescript
  /**
   * Push message to claw-hive managed bots in the channel.
   * Trigger rules:
   *   - DM channel: always trigger for all hive bots
   *   - Tracking channel: always trigger (guidance routed to same session)
   *   - Group channel: only trigger if the bot is @mentioned
   * Fire-and-forget: failures are logged but do not block message delivery.
   */
  private async pushToHiveBots(
    msgId: string,
    senderId: string,
    memberIds: string[],
  ): Promise<void> {
    try {
      if (memberIds.length === 0) return;

      // Find hive-managed bots among channel members (excluding sender)
      const hiveBots = await this.db
        .select({
          userId: schema.bots.userId,
          botId: schema.bots.id,
          managedMeta: schema.bots.managedMeta,
        })
        .from(schema.bots)
        .innerJoin(schema.users, eq(schema.bots.userId, schema.users.id))
        .where(
          and(
            inArray(schema.bots.userId, memberIds),
            eq(schema.bots.isActive, true),
            eq(schema.bots.managedProvider, 'hive'),
            eq(schema.users.userType, 'bot'),
          ),
        );

      const targetBots = hiveBots.filter(
        (b) => b.userId !== senderId && b.managedMeta?.agentId,
      );
      if (targetBots.length === 0) return;

      const messageData = await this.getMessageWithContext(msgId);
      if (!messageData) return;

      const { message, sender, channel, mentions, parentMessage } = messageData;

      const isDm = channel.type === 'direct';
      const isTracking = channel.type === 'tracking';
      const alwaysForward = isDm || isTracking;
      const mentionedUserIds = alwaysForward
        ? null
        : extractMentionedUserIds(mentions);

      // Build the recursive MessageLocation for the event payload
      const channelLocation: Record<string, unknown> = {
        type: isDm ? 'dm' : 'channel',
        id: channel.id,
        ...(channel.name ? { name: channel.name } : {}),
      };
      const location: Record<string, unknown> = message.parentId
        ? {
            type: 'thread',
            id: message.parentId,
            ...(parentMessage?.content
              ? { content: parentMessage.content }
              : {}),
            parent: channelLocation,
          }
        : channelLocation;

      const tenantId = channel.tenantId ?? '';
      const timestamp = new Date().toISOString();

      for (const bot of targetBots) {
        const agentId = bot.managedMeta!.agentId!;

        // Apply trigger rules
        if (!alwaysForward && !mentionedUserIds!.includes(bot.userId)) {
          continue;
        }

        // Create tracking channel for group @mentions only
        // Tracking channel messages reuse the existing channel (same session)
        let trackingChannelId: string | undefined;
        if (!isDm && !isTracking) {
          trackingChannelId = await this.createTrackingChannel(
            tenantId || null,
            bot.userId,
            sender.id,
            message.id,
            channel.id,
          );
        }

        // Session ID:
        //   DM: team9/{tenant}/{agent}/dm/{channelId}
        //   Group @mention: team9/{tenant}/{agent}/tracking/{newTrackingChannelId}
        //   Tracking guidance: team9/{tenant}/{agent}/tracking/{existingChannelId}
        const scope = isDm ? 'dm' : 'tracking';
        const scopeId = isDm
          ? channel.id
          : (trackingChannelId ?? channel.id);
        const sessionId = `team9/${tenantId}/${agentId}/${scope}/${scopeId}`;

        const event = {
          type: 'team9:message.text' as const,
          source: 'team9',
          timestamp,
          payload: {
            messageId: message.id,
            content: message.content ?? '',
            sender: {
              id: sender.id,
              username: sender.username,
              displayName: sender.displayName,
            },
            location,
            ...(trackingChannelId ? { trackingChannelId } : {}),
          },
        };

        this.clawHiveService
          .sendInput(sessionId, event, tenantId || undefined)
          .catch((err: Error) => {
            this.logger.warn(
              `Hive bot input failed for bot ${bot.botId} (agent ${agentId}): ${err.message}`,
            );
          });
      }
    } catch (error) {
      this.logger.warn(`Hive bot push failed: ${error}`);
      // Don't throw - hive failures should never block message delivery
    }
  }
```

- [ ] **Step 3: Commit**

```bash
git add apps/server/apps/im-worker/src/post-broadcast/post-broadcast.service.ts
git commit -m "feat(im-worker): create tracking channel for hive bot group interactions"
```

---

## Task 6: Unit Tests for Tracking Channel Logic

**Files:**

- Modify: `apps/server/apps/im-worker/src/post-broadcast/post-broadcast.service.spec.ts`

The existing test file (369 lines on dev) has `mockDb()`, fixture helpers (`makeMessage`, `makeSender`, `makeChannel`, `makeHiveBot`), and a `setupDbForHivePush` helper. We extend these.

- [ ] **Step 1: Update `mockDb()` to support transactions**

In the `mockDb()` function (lines 12-37), add transaction support:

```typescript
// transaction: pass the same mockDb as the transaction context
chain.transaction = jest.fn<any>((fn) => fn(chain));
// insert inside transaction for createTrackingChannel
chain.insert.mockReturnValue({
  values: jest.fn<any>().mockReturnValue({
    returning: jest
      .fn<any>()
      .mockResolvedValue([{ id: "mock-tracking-channel-id" }]),
  }),
});
```

Add after `chain.where.mockResolvedValue([]);` (line 35), before `return chain;`.

- [ ] **Step 2: Write tracking channel trigger tests**

Append to the `describe('PostBroadcastService — pushToHiveBots')` block:

```typescript
// ── Tracking channel ─────────────────────────────────────────────

it("creates tracking channel for group @mention and uses tracking/ session scope", async () => {
  const bot = makeHiveBot("claude");
  const msg = makeMessage({
    content: `<mention data-user-id="${bot.userId}">@Claude</mention> hello`,
  });
  setupDbForHivePush({
    bots: [bot],
    message: msg,
    channel: makeChannel("public"),
  });

  await (service as any).pushToHiveBots(MSG_ID, SENDER_ID, [bot.userId]);

  // Verify tracking channel was created (transaction called)
  expect(db.transaction).toHaveBeenCalled();

  // Verify session ID uses tracking/ scope
  const [sessionId] = clawHiveService.sendInput.mock.calls[0] as [
    string,
    ...unknown[],
  ];
  expect(sessionId).toMatch(
    new RegExp(
      `^team9/${TENANT_ID}/${bot.managedMeta.agentId}/tracking/[\\w-]+$`,
    ),
  );
});

it("does NOT create tracking channel for DM — uses dm/ scope", async () => {
  const bot = makeHiveBot("claude");
  setupDbForHivePush({ bots: [bot], channel: makeChannel("direct") });

  await (service as any).pushToHiveBots(MSG_ID, SENDER_ID, [bot.userId]);

  // No transaction = no tracking channel created
  expect(db.transaction).not.toHaveBeenCalled();

  const [sessionId] = clawHiveService.sendInput.mock.calls[0] as [
    string,
    ...unknown[],
  ];
  expect(sessionId).toBe(
    `team9/${TENANT_ID}/${bot.managedMeta.agentId}/dm/${CHANNEL_ID}`,
  );
});

it("routes tracking channel message to same session without creating new channel", async () => {
  const bot = makeHiveBot("claude");
  setupDbForHivePush({ bots: [bot], channel: makeChannel("tracking") });

  await (service as any).pushToHiveBots(MSG_ID, SENDER_ID, [bot.userId]);

  // No transaction = no new tracking channel
  expect(db.transaction).not.toHaveBeenCalled();

  // Session uses existing tracking channel ID
  const [sessionId] = clawHiveService.sendInput.mock.calls[0] as [
    string,
    ...unknown[],
  ];
  expect(sessionId).toBe(
    `team9/${TENANT_ID}/${bot.managedMeta.agentId}/tracking/${CHANNEL_ID}`,
  );
});

it("includes trackingChannelId in payload for group channel, not for DM", async () => {
  // Group channel
  const bot = makeHiveBot("claude");
  const msg = makeMessage({
    content: `<mention data-user-id="${bot.userId}">@Claude</mention> hello`,
  });
  setupDbForHivePush({
    bots: [bot],
    message: msg,
    channel: makeChannel("public"),
  });

  await (service as any).pushToHiveBots(MSG_ID, SENDER_ID, [bot.userId]);

  const [, groupEvent] = clawHiveService.sendInput.mock.calls[0] as [
    string,
    any,
    string,
  ];
  expect(groupEvent.payload.trackingChannelId).toBeDefined();

  // DM channel
  clawHiveService.sendInput.mockClear();
  setupDbForHivePush({ bots: [bot], channel: makeChannel("direct") });

  await (service as any).pushToHiveBots(MSG_ID, SENDER_ID, [bot.userId]);

  const [, dmEvent] = clawHiveService.sendInput.mock.calls[0] as [
    string,
    any,
    string,
  ];
  expect(dmEvent.payload.trackingChannelId).toBeUndefined();
});
```

- [ ] **Step 3: Run tests**

```bash
cd apps/server && pnpm jest --testPathPattern="post-broadcast.service.spec" --verbose
```

Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add apps/server/apps/im-worker/src/post-broadcast/post-broadcast.service.spec.ts
git commit -m "test(im-worker): add tracking channel unit tests for pushToHiveBots"
```

---

## Task 7: Streaming Controller `isActivated` Check

The streaming controller (`apps/server/apps/gateway/src/im/streaming/streaming.controller.ts`) handles bot streaming messages. When a tracking channel is deactivated, streaming should also be rejected.

**Files:**

- Modify: `apps/server/apps/gateway/src/im/streaming/streaming.controller.ts`

- [ ] **Step 1: Add `isActivated` check to `startStreaming`**

In the `startStreaming` method, after the channel membership / bot validation checks, add:

```typescript
// Reject streaming to deactivated channels
const channel = await this.channelsService.findById(dto.channelId);
if (channel && !channel.isActivated) {
  throw new ForbiddenException(
    "Channel is deactivated — execution has completed",
  );
}
```

This only needs to be in `startStreaming` — once a stream is started, `content` and `end` events don't need to re-check (the channel won't be deactivated mid-stream since the bot controls deactivation).

- [ ] **Step 2: Commit**

```bash
git add apps/server/apps/gateway/src/im/streaming/streaming.controller.ts
git commit -m "feat(gateway): reject streaming to deactivated channels"
```

---

## Summary of Changes

| Side                   | What                                                        | Where                            |
| ---------------------- | ----------------------------------------------------------- | -------------------------------- |
| **DB Schema**          | Add `'tracking'` enum value + `isActivated` field           | `channels.ts`, migration         |
| **Shared**             | Add `TRACKING.DEACTIVATED` and `TRACKING.ACTIVATED` events  | `event-names.ts`                 |
| **Gateway Service**    | Add `deactivateChannel()`, `activateChannel()`              | `channels.service.ts`            |
| **Gateway Controller** | Add `POST :id/deactivate` and `POST :id/activate` endpoints | `channels.controller.ts`         |
| **Gateway Messages**   | Reject messages to deactivated channels                     | `messages.controller.ts`         |
| **Gateway Streaming**  | Reject streaming to deactivated channels                    | `streaming.controller.ts`        |
| **IM-Worker**          | Create tracking channel + placeholder for group @mentions   | `post-broadcast.service.ts`      |
| **IM-Worker**          | Route tracking channel messages to same session             | `post-broadcast.service.ts`      |
| **IM-Worker Tests**    | Test tracking channel creation, routing, payload            | `post-broadcast.service.spec.ts` |

## What's NOT in This Plan (External Dependencies)

| Side          | What                                                                                            | Owner          |
| ------------- | ----------------------------------------------------------------------------------------------- | -------------- |
| **claw-hive** | `TrackingChannelObserver` — writes execution events to tracking channel                         | claw-hive team |
| **claw-hive** | Wire observer into `HiveRuntime.createSession()`                                                | claw-hive team |
| **claw-hive** | `Team9ApiClient.deactivateChannel()` — calls deactivate on agent_end                            | claw-hive team |
| **claw-hive** | Event reporting: insert, auto-trigger, interrupt support for guidance                           | claw-hive team |
| **Client**    | Render tracking channel with `ChannelView` (reuse `hideHeader` + `readOnly` from task channels) | Client team    |
| **Client**    | Render placeholder system message as tracking channel link                                      | Client team    |
| **Client**    | Handle `TRACKING.DEACTIVATED` / `TRACKING.ACTIVATED` events for readOnly toggle                 | Client team    |
