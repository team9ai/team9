# Tracking Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stream the agent's full execution process (tool calls, LLM turns, reasoning) into a dedicated "tracking channel" visible to users, with real-time guidance support during execution.

**Architecture:** When a message triggers a hive-managed bot, Team9's IM-Worker creates a tracking channel (reusing task channel patterns) and a placeholder message in the original channel. The tracking channel ID is passed to claw-hive via the event payload. On the agent side, a new `TrackingChannelObserver` listens to execution events and writes them into the tracking channel via Team9 API. When `prompt()` ends, the observer calls `POST /lock` on the tracking channel, setting `isLocked = true` — the server then rejects further messages. For DMs, the DM channel itself serves as the tracking channel — no separate channel is created.

**Tech Stack:** NestJS (Team9 server), Drizzle ORM + PostgreSQL, TypeScript, Vitest (agent-side tests)

**Key Design Rules:**

- One tracking channel = one agent loop (`prompt()` call)
- DM/task channels are their own tracking channels (no separate creation)
- Group @mention → new tracking channel per interaction
- Tracking channel locks (`isLocked = true`) when agent loop ends; users cannot send after that
- Session ID for group tracking: `team9/{tenantId}/{agentId}/tracking/{trackingChannelId}`
- User guidance in tracking channel routes to the same session via mapping
- Guidance triggers next `prompt()` with a new tracking channel

---

## File Structure

### Team9 Server Side

| Action | File                                                                              | Responsibility                                                                                                  |
| ------ | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Modify | `apps/server/libs/database/src/schemas/im/channels.ts:16-21`                      | Add `'tracking'` to `channelTypeEnum`                                                                           |
| Modify | `apps/server/apps/gateway/src/im/channels/dto/create-channel.dto.ts:19-20`        | Accept `'tracking'` type                                                                                        |
| Modify | `apps/server/apps/gateway/src/im/channels/channels.service.ts:33`                 | Add `'tracking'` to `ChannelResponse.type`, add `isLocked` field                                                |
| Modify | `apps/server/apps/im-worker/src/post-broadcast/post-broadcast.service.ts:432-530` | Create tracking channel + placeholder before `sendInput()`, route tracking channel messages to original session |
| Modify | `apps/server/libs/claw-hive/src/claw-hive.service.ts:56-87`                       | Pass `trackingChannelId` in `sendInput()`                                                                       |
| Modify | `apps/server/libs/shared/src/events/event-names.ts`                               | Add `TRACKING` event group                                                                                      |
| Create | `apps/server/libs/database/src/migrations/XXXX_add_tracking_channel_type.sql`     | DB migration for new enum value                                                                                 |

### Agent Side (claw-hive)

| Action | File                                                               | Responsibility                                                                      |
| ------ | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Create | `packages/claw-hive/src/runtime/tracking-channel-observer.ts`      | New observer: listens to execution events, writes to tracking channel via Team9 API |
| Create | `packages/claw-hive/src/runtime/tracking-channel-observer.test.ts` | Tests for the observer                                                              |
| Modify | `packages/claw-hive/src/runtime/hive-runtime.ts:415-520`           | Instantiate and wire `TrackingChannelObserver` in `createSession()`                 |
| Modify | `packages/claw-hive/src/components/team9/team9-api-client.ts`      | Add `lockChannel()` method (lock tracking channel when execution ends)              |
| Modify | `packages/claw-hive-types/src/input-event.ts`                      | Add `trackingChannelId` to `HiveInputEvent` payload convention                      |

---

## Task 1: Add `tracking` Channel Type to Database Schema

**Files:**

- Modify: `apps/server/libs/database/src/schemas/im/channels.ts:16-21`
- Modify: `apps/server/apps/gateway/src/im/channels/dto/create-channel.dto.ts:19-20`
- Modify: `apps/server/apps/gateway/src/im/channels/channels.service.ts:33`
- Create: DB migration

- [ ] **Step 1: Add `'tracking'` to `channelTypeEnum`**

In `apps/server/libs/database/src/schemas/im/channels.ts`, line 16-21:

```typescript
export const channelTypeEnum = pgEnum("channel_type", [
  "direct",
  "public",
  "private",
  "task",
  "tracking",
]);
```

- [ ] **Step 2: Update `CreateChannelDto` to accept `'tracking'`**

In `apps/server/apps/gateway/src/im/channels/dto/create-channel.dto.ts`, line 19-20:

```typescript
  @IsEnum(['public', 'private', 'tracking'])
  type: 'public' | 'private' | 'tracking';
```

- [ ] **Step 3: Add `isLocked` field to channels schema**

In `apps/server/libs/database/src/schemas/im/channels.ts`, after `isArchived` (line 39):

```typescript
    isLocked: boolean('is_locked').default(false).notNull(),
```

- [ ] **Step 4: Update `ChannelResponse` type**

In `apps/server/apps/gateway/src/im/channels/channels.service.ts`, line 33:

```typescript
type: "direct" | "public" | "private" | "task" | "tracking";
```

And add to the interface:

```typescript
isLocked: boolean;
```

Also update `ChannelWithUnread` if it inherits `ChannelResponse` (it does via `extends`).

- [ ] **Step 5: Generate and run migration**

```bash
cd apps/server && pnpm db:generate
```

This generates a migration that adds `'tracking'` to the `channel_type` enum. Review the generated SQL:

```sql
ALTER TYPE "channel_type" ADD VALUE 'tracking';
```

```bash
pnpm db:migrate
```

- [ ] **Step 6: Commit**

```bash
git add apps/server/libs/database/src/schemas/im/channels.ts \
       apps/server/apps/gateway/src/im/channels/dto/create-channel.dto.ts \
       apps/server/apps/gateway/src/im/channels/channels.service.ts \
       apps/server/libs/database/src/migrations/
git commit -m "feat(db): add 'tracking' channel type and isLocked field to schema"
```

---

## Task 2: Extend `sendInput` to Pass `trackingChannelId`

**Files:**

- Modify: `apps/server/libs/claw-hive/src/claw-hive.service.ts:56-87`

The `trackingChannelId` is passed as a top-level field in the event payload, not as a separate parameter. This keeps the `sendInput` signature stable — the event payload is already `Record<string, unknown>`.

- [ ] **Step 1: Add `trackingChannelId` to event payload in `pushToHiveBots`**

This change happens in Task 3 (the `pushToHiveBots` modification). No changes needed to `ClawHiveService.sendInput()` itself — the event payload already accepts arbitrary keys.

Verify the event structure that will be sent:

```typescript
const event = {
  type: "team9:message.text" as const,
  source: "team9",
  timestamp,
  payload: {
    messageId: message.id,
    content: message.content ?? "",
    sender: { id, username, displayName },
    location,
    trackingChannelId, // NEW — added by pushToHiveBots
  },
};
```

- [ ] **Step 2: Document the convention in `HiveInputEvent`**

In `packages/claw-hive-types/src/input-event.ts`, add a doc comment to the `payload` field:

```typescript
export interface HiveInputEvent extends InputEvent {
  /** Event source platform, e.g. "team9", "dashboard" */
  source: string;
  /**
   * Event payload, varies by type.
   *
   * For team9:message.* events, may include:
   * - `trackingChannelId?: string` — ID of the tracking channel for this execution.
   *   When present, the agent should stream execution events to this channel.
   *   For DM/task channels, this is the channel itself.
   *   For group channels, this is a newly created tracking channel.
   */
  payload: Record<string, unknown>;
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/claw-hive-types/src/input-event.ts
git commit -m "docs(types): document trackingChannelId in HiveInputEvent payload"
```

---

## Task 3: Create Tracking Channel in `pushToHiveBots`

This is the core Team9 server change. When a group message triggers a hive bot, create a tracking channel + placeholder message before sending to claw-hive.

**Files:**

- Modify: `apps/server/apps/im-worker/src/post-broadcast/post-broadcast.service.ts:432-530`
- Modify: `apps/server/libs/shared/src/events/event-names.ts`

- [ ] **Step 1: Add tracking event names**

In `apps/server/libs/shared/src/events/event-names.ts`, add after the `TASK` section (line 217):

```typescript
  // ==================== Tracking Channel ====================
  /**
   * Tracking channel lifecycle events
   */
  TRACKING: {
    /** Tracking channel locked (execution complete) */
    LOCKED: 'tracking:locked',
  },
```

- [ ] **Step 2: Add `ChannelsService` and `WebsocketGateway` as dependencies in `PostBroadcastService`**

The `PostBroadcastService` needs to create channels and broadcast WebSocket events. Check the existing constructor at line 40-45 and add the necessary injections. If `ChannelsService` is not available in the IM-Worker module, use direct DB inserts (same pattern as `ChannelsService.create()`):

```typescript
// Inside pushToHiveBots, before the for-loop over targetBots:
private async createTrackingChannel(
  tenantId: string | null,
  botUserId: string,
  triggerSenderId: string,
  triggerMessageId: string,
  originalChannelId: string,
): Promise<string> {
  const channelId = uuidv7();

  // Wrap all inserts in a transaction — partial failures must not leave orphaned records
  await this.db.transaction(async (tx) => {
    await tx.insert(schema.channels).values({
      id: channelId,
      tenantId,
      name: null, // tracking channels don't need display names
      type: 'tracking',
      createdBy: botUserId,
    });

    // Bot is a regular member — locking is done via dedicated lock API,
    // not archive (which requires owner/admin).
    await tx.insert(schema.channelMembers).values({
      id: uuidv7(),
      channelId,
      userId: botUserId,
      role: 'member',
    });

    // Add the trigger message sender as member
    await tx.insert(schema.channelMembers).values({
      id: uuidv7(),
      channelId,
      userId: triggerSenderId,
      role: 'member',
    });

    // Insert placeholder message in original channel
    // Uses the existing message creation pattern (direct insert, type: 'system')
    // The placeholder links to the tracking channel
    await tx.insert(schema.messages).values({
      id: uuidv7(),
      channelId: originalChannelId,
      senderId: botUserId,
      content: '', // client renders this as a tracking link based on metadata
      type: 'system',
      metadata: {
        trackingChannelId: channelId,
        triggerMessageId,
        originalChannelId,  // persisted for guidance routing lookup
      },
    });
  });

  // Notify the trigger sender about the new tracking channel via WebSocket.
  // PostBroadcastService doesn't have WebsocketGateway — publish to RabbitMQ
  // for Gateway to emit CHANNEL.CREATED to the user and bot.
  await this.rabbitMQEventService.publish('channel.created', {
    channel: { id: channelId, tenantId, type: 'tracking', createdBy: botUserId },
    memberIds: [botUserId, triggerSenderId],
  });

  return channelId;
}
```

> **Note:** The placeholder message uses `type: 'system'` with `metadata.trackingChannelId`. The client renders this as a tracking channel link. If a new message type `'thinking_block'` is preferred per the earlier discussion, adjust accordingly — this requires adding to the message type enum as well.
>
> **Note:** The `metadata.originalChannelId` field is persisted in the placeholder message so that guidance routing (Task 3, Step 5) can look up the original channel for creating new tracking channels.

- [ ] **Step 3: Modify `pushToHiveBots` to create tracking channel for group messages**

In the `for (const bot of targetBots)` loop (line 493), after the trigger rule check (line 497-499), add tracking channel creation for non-DM channels:

```typescript
for (const bot of targetBots) {
  const agentId = bot.managedMeta!.agentId!;

  // Apply trigger rules for group channels
  if (!isDm && !mentionedUserIds!.includes(bot.userId)) {
    continue;
  }

  // Create tracking channel for group messages; DM uses channel itself
  let trackingChannelId: string | undefined;
  if (!isDm) {
    trackingChannelId = await this.createTrackingChannel(
      tenantId || null,
      bot.userId,
      sender.id, // triggerSenderId — the user who @mentioned the bot
      message.id,
      channel.id,
    );
  }

  // Session ID: DM keeps existing format, group uses tracking channel
  const scope = isDm ? "dm" : "tracking";
  const scopeId = isDm ? channel.id : trackingChannelId!;
  const sessionId = `team9/${tenantId}/${agentId}/${scope}/${scopeId}`;

  const event = {
    type: "team9:message.text" as const,
    source: "team9",
    timestamp,
    payload: {
      messageId: message.id,
      content: message.content ?? "",
      sender: {
        id: sender.id,
        username: sender.username,
        displayName: sender.displayName,
      },
      location,
      // For DM: trackingChannelId is the DM channel itself
      // For group: trackingChannelId is the new tracking channel
      trackingChannelId: trackingChannelId ?? channel.id,
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
```

- [ ] **Step 4: Add trigger rule for tracking channels**

In the trigger rules section (line 468-469), add tracking channel handling:

```typescript
const isDm = channel.type === "direct";
const isTracking = channel.type === "tracking";
// Tracking channels behave like DMs — all messages forwarded
const alwaysForward = isDm || isTracking;
const mentionedUserIds = alwaysForward
  ? null
  : extractMentionedUserIds(mentions);
```

And update the trigger rule check in the loop:

```typescript
if (!alwaysForward && !mentionedUserIds!.includes(bot.userId)) {
  continue;
}
```

- [ ] **Step 5: Route tracking channel messages to original session**

When a message comes from a tracking channel, we need to:

1. Look up the original session ID (the tracking channel IS the session scope)
2. Create a NEW tracking channel for the guidance-triggered execution
3. Forward to the same agent

The session ID for tracking channels already encodes the tracking channel ID: `team9/{tenantId}/{agentId}/tracking/{trackingChannelId}`. So messages from a tracking channel naturally route to the correct session.

For guidance messages from a tracking channel triggering a new execution:

```typescript
if (isTracking) {
  // Guidance from tracking channel:
  // 1. Look up original context from the tracking channel's metadata
  //    (the channel was created by the bot, createdBy = botUserId)
  // 2. Create a new tracking channel for the new execution
  // 3. Session ID stays the same (same tracking channel scope)
  //    — actually, new tracking channel = new session

  // Look up originalChannelId from the placeholder message that created this tracking channel
  const originalChannelId = await this.getOriginalChannelId(channel.id);
  if (!originalChannelId) {
    this.logger.warn(
      `Cannot find original channel for tracking channel ${channel.id}`,
    );
    continue;
  }

  // Create NEW tracking channel for the guidance-triggered execution.
  // IMPORTANT: The new tracking channel gets a NEW session ID.
  // The old tracking channel (where guidance was typed) is already locked.
  trackingChannelId = await this.createTrackingChannel(
    tenantId || null,
    bot.userId,
    senderId, // the user who sent guidance
    message.id,
    originalChannelId,
  );
}
```

**Helper to look up originalChannelId:**

```typescript
/**
 * Find the original channel that a tracking channel was created for.
 * Queries the placeholder system message's metadata.
 */
private async getOriginalChannelId(trackingChannelId: string): Promise<string | null> {
  const [row] = await this.db
    .select({ metadata: schema.messages.metadata })
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.type, 'system'),
        sql`${schema.messages.metadata}->>'trackingChannelId' = ${trackingChannelId}`,
      ),
    )
    .limit(1);
  return (row?.metadata as any)?.originalChannelId ?? null;
}
```

> **Key:** Each guidance-triggered execution gets a NEW tracking channel with a NEW session ID (`team9/{tenantId}/{agentId}/tracking/{newTrackingChannelId}`). This avoids session ID collision with the locked tracking channel's session. The new placeholder is inserted in the original channel (not the old tracking channel).

- [ ] **Step 6: Commit**

```bash
git add apps/server/apps/im-worker/src/post-broadcast/post-broadcast.service.ts \
       apps/server/libs/shared/src/events/event-names.ts
git commit -m "feat(im-worker): create tracking channel for hive bot group interactions"
```

---

## Task 4: `TrackingChannelObserver` — Agent Side

This is the core agent-side change. The observer listens to execution events and forwards them to the tracking channel as messages via Team9 API.

**Files:**

- Create: `packages/claw-hive/src/runtime/tracking-channel-observer.ts`
- Create: `packages/claw-hive/src/runtime/tracking-channel-observer.test.ts`

- [ ] **Step 1: Write the failing test for basic event forwarding**

```typescript
// tracking-channel-observer.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TrackingChannelObserver } from "./tracking-channel-observer.js";
import type {
  AgentEvent,
  ToolCallStartEvent,
  ToolCallEndEvent,
  AgentStartEvent,
  AgentEndEvent,
} from "@team9claw/types";

function makeApi() {
  return {
    sendMessage: vi.fn().mockResolvedValue({}),
    lockChannel: vi.fn().mockResolvedValue(undefined),
  };
}

describe("TrackingChannelObserver", () => {
  let api: ReturnType<typeof makeApi>;
  let observer: TrackingChannelObserver;
  const sessionId = "test-session";
  const trackingChannelId = "tracking-ch-1";
  const botUserId = "bot-1";

  beforeEach(() => {
    api = makeApi();
    observer = new TrackingChannelObserver(
      sessionId,
      trackingChannelId,
      botUserId,
      api,
    );
  });

  it("sends message on tool_call_start", async () => {
    const event: ToolCallStartEvent = {
      type: "tool_call_start",
      sessionId,
      timestamp: Date.now(),
      toolCallId: "tc-1",
      toolName: "QueryMessages",
      args: { channelId: "ch-1" },
    };

    await observer.onEvent(event);

    expect(api.sendMessage).toHaveBeenCalledOnce();
    expect(api.sendMessage).toHaveBeenCalledWith(
      trackingChannelId,
      expect.stringContaining("QueryMessages"),
      botUserId,
      undefined,
    );
  });

  it("sends message on tool_call_end", async () => {
    const event: ToolCallEndEvent = {
      type: "tool_call_end",
      sessionId,
      timestamp: Date.now(),
      toolCallId: "tc-1",
      toolName: "QueryMessages",
      result: { messages: [] },
      isError: false,
    };

    await observer.onEvent(event);

    expect(api.sendMessage).toHaveBeenCalledOnce();
  });

  it("locks channel on agent_end", async () => {
    const event: AgentEndEvent = {
      type: "agent_end",
      sessionId,
      timestamp: Date.now(),
    };

    await observer.onEvent(event);

    expect(api.lockChannel).toHaveBeenCalledWith(trackingChannelId);
  });

  it("ignores message_update events (too noisy)", async () => {
    const event: AgentEvent = {
      type: "message_update",
      sessionId,
      timestamp: Date.now(),
      messageId: "msg-1",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "hello" }],
      },
    } as any;

    await observer.onEvent(event);

    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it("does not throw on API failure", async () => {
    api.sendMessage.mockRejectedValue(new Error("network error"));

    const event: ToolCallStartEvent = {
      type: "tool_call_start",
      sessionId,
      timestamp: Date.now(),
      toolCallId: "tc-1",
      toolName: "QueryMessages",
      args: {},
    };

    // Should not throw
    await expect(observer.onEvent(event)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/winrey/Projects/weightwave/team9-agent-pi/packages/claw-hive && npx vitest run src/runtime/tracking-channel-observer.test.ts
```

Expected: FAIL — `tracking-channel-observer.ts` does not exist yet.

- [ ] **Step 3: Implement `TrackingChannelObserver`**

```typescript
// tracking-channel-observer.ts
import type { IObserver, AgentEvent } from "@team9claw/types";

export interface TrackingChannelApi {
  sendMessage(
    channelId: string,
    content: string,
    senderId: string,
    parentId?: string,
  ): Promise<unknown>;
  lockChannel(channelId: string): Promise<void>; // locks tracking channel when execution ends
}

/**
 * Forwards agent execution events to a Team9 tracking channel.
 *
 * Lifecycle: one instance per prompt() call.
 * On agent_end, locks the tracking channel via Team9 API.
 */
export class TrackingChannelObserver implements IObserver {
  private trackingChannelId: string | null;

  constructor(
    private sessionId: string,
    trackingChannelId: string | null,
    private botUserId: string,
    private api: TrackingChannelApi,
  ) {
    this.trackingChannelId = trackingChannelId;
  }

  /** Activate the observer with a tracking channel ID (called lazily from Team9Component). */
  setTrackingChannelId(id: string): void {
    this.trackingChannelId = id;
  }

  async onEvent(event: AgentEvent): Promise<void> {
    if (!this.trackingChannelId) return; // Not yet activated — ignore all events
    try {
      switch (event.type) {
        case "agent_start":
          await this.send("Execution started.");
          break;

        case "turn_start":
          if ("turnIndex" in event && event.turnIndex > 0) {
            await this.send(`--- Turn ${event.turnIndex + 1} ---`);
          }
          break;

        case "tool_call_start":
          if ("toolName" in event && "args" in event) {
            const argsStr = JSON.stringify(event.args, null, 2);
            await this.send(
              `🔧 Calling tool: **${event.toolName}**\n\`\`\`json\n${argsStr}\n\`\`\``,
            );
          }
          break;

        case "tool_call_end":
          if ("toolName" in event && "result" in event) {
            const isError = "isError" in event && event.isError;
            const prefix = isError ? "❌ Tool error" : "✅ Tool result";
            const resultStr =
              typeof event.result === "string"
                ? event.result
                : JSON.stringify(event.result, null, 2);
            const truncated =
              resultStr.length > 2000
                ? resultStr.slice(0, 2000) + "\n... (truncated)"
                : resultStr;
            await this.send(
              `${prefix}: **${event.toolName}**\n\`\`\`\n${truncated}\n\`\`\``,
            );
          }
          break;

        case "agent_end":
          // Each call has its own catch — lockChannel MUST run even if send fails.
          // A permanently unlocked tracking channel is worse than a missing "complete" message.
          await this.send("Execution complete.").catch(() => {});
          await this.api.lockChannel(this.trackingChannelId!).catch(() => {});
          break;

        case "error":
          if ("error" in event) {
            const errMsg =
              event.error instanceof Error
                ? event.error.message
                : String(event.error);
            await this.send(`❌ Error: ${errMsg}`);
          }
          break;

        // message_update is too noisy (streaming deltas) — skip
        // message_start/message_end captured via reply_stream events
        // llm_call_start/end are internal — skip
        // component_data_snapshot is internal — skip
        default:
          break;
      }
    } catch {
      // Fire-and-forget: tracking failures must never block agent execution
    }
  }

  private send(content: string): Promise<unknown> {
    return this.api.sendMessage(
      this.trackingChannelId,
      content,
      this.botUserId,
      undefined,
    );
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/winrey/Projects/weightwave/team9-agent-pi/packages/claw-hive && npx vitest run src/runtime/tracking-channel-observer.test.ts
```

Expected: ALL PASS

- [ ] **Step 5: Add edge case tests**

```typescript
// Append to tracking-channel-observer.test.ts

it("sends turn separator for turnIndex > 0", async () => {
  await observer.onEvent({
    type: "turn_start",
    sessionId,
    timestamp: Date.now(),
    turnIndex: 0,
  } as any);

  expect(api.sendMessage).not.toHaveBeenCalled();

  await observer.onEvent({
    type: "turn_start",
    sessionId,
    timestamp: Date.now(),
    turnIndex: 1,
  } as any);

  expect(api.sendMessage).toHaveBeenCalledOnce();
  expect(api.sendMessage).toHaveBeenCalledWith(
    trackingChannelId,
    expect.stringContaining("Turn 2"),
    botUserId,
    undefined,
  );
});

it("truncates long tool results", async () => {
  const longResult = "x".repeat(3000);
  await observer.onEvent({
    type: "tool_call_end",
    sessionId,
    timestamp: Date.now(),
    toolCallId: "tc-1",
    toolName: "Search",
    result: longResult,
    isError: false,
  } as any);

  const content = api.sendMessage.mock.calls[0][1] as string;
  expect(content).toContain("(truncated)");
  expect(content.length).toBeLessThan(3000);
});

it("sends error message on error event", async () => {
  await observer.onEvent({
    type: "error",
    sessionId,
    timestamp: Date.now(),
    error: new Error("something broke"),
  } as any);

  expect(api.sendMessage).toHaveBeenCalledWith(
    trackingChannelId,
    expect.stringContaining("something broke"),
    botUserId,
    undefined,
  );
});

it("still locks channel on agent_end even if send fails", async () => {
  api.sendMessage.mockRejectedValue(new Error("send failed"));

  await observer.onEvent({
    type: "agent_end",
    sessionId,
    timestamp: Date.now(),
  } as any);

  // sendMessage failed, but lockChannel must still be called
  expect(api.lockChannel).toHaveBeenCalledWith(trackingChannelId);
});

it("does not call lockChannel when observer is unactivated", async () => {
  const unactivated = new TrackingChannelObserver("s", null, "bot", api);

  await unactivated.onEvent({
    type: "agent_end",
    sessionId: "s",
    timestamp: Date.now(),
  } as any);

  expect(api.sendMessage).not.toHaveBeenCalled();
  expect(api.lockChannel).not.toHaveBeenCalled();
});
```

- [ ] **Step 6: Run all tests**

```bash
cd /Users/winrey/Projects/weightwave/team9-agent-pi/packages/claw-hive && npx vitest run src/runtime/tracking-channel-observer.test.ts
```

Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add packages/claw-hive/src/runtime/tracking-channel-observer.ts \
       packages/claw-hive/src/runtime/tracking-channel-observer.test.ts
git commit -m "feat(claw-hive): add TrackingChannelObserver for execution tracing"
```

---

## Task 5: Add Lock Channel API (Server + Agent Client)

### 5a: Server-side lock endpoint

**Files:**

- Modify: `apps/server/apps/gateway/src/im/channels/channels.controller.ts`
- Modify: `apps/server/apps/gateway/src/im/channels/channels.service.ts`

- [ ] **Step 1: Add `lockChannel` method to `ChannelsService`**

```typescript
  /** Lock a tracking channel — sets isLocked=true, preventing further user messages. */
  async lockChannel(channelId: string): Promise<void> {
    const channel = await this.findById(channelId);
    if (!channel) throw new NotFoundException('Channel not found');
    if (channel.type !== 'tracking') {
      throw new ForbiddenException('Only tracking channels can be locked');
    }
    await this.db
      .update(schema.channels)
      .set({ isLocked: true, updatedAt: new Date() })
      .where(eq(schema.channels.id, channelId));
  }
```

- [ ] **Step 2: Add `POST /v1/im/channels/:id/lock` endpoint to controller**

```typescript
  @Post(':id/lock')
  async lockChannel(
    @CurrentUser('sub') userId: string,
    @Param('id') channelId: string,
  ): Promise<{ success: boolean }> {
    // Only channel members (including bots) can lock
    const isMember = await this.channelsService.isMember(channelId, userId);
    if (!isMember) throw new ForbiddenException('Not a channel member');

    await this.channelsService.lockChannel(channelId);

    // Notify members that the tracking channel is locked
    const memberIds = await this.channelsService.getChannelMemberIds(channelId);
    for (const memberId of memberIds) {
      await this.websocketGateway.sendToUser(
        memberId,
        WS_EVENTS.TRACKING.LOCKED,
        { channelId },
      );
    }

    return { success: true };
  }
```

> **Note:** Any channel member (including bots) can lock — no owner/admin required. This is a deliberate design choice: the bot that created the tracking channel needs to lock it when execution ends.

- [ ] **Step 3: Commit server changes**

```bash
git add apps/server/apps/gateway/src/im/channels/channels.controller.ts \
       apps/server/apps/gateway/src/im/channels/channels.service.ts
git commit -m "feat(gateway): add POST /v1/im/channels/:id/lock endpoint for tracking channels"
```

### 5b: Agent-side client method

**Files:**

- Modify: `packages/claw-hive/src/components/team9/team9-api-client.ts`

- [ ] **Step 4: Add `lockChannel` method to `Team9ApiClient`**

Append to `Team9ApiClient` class (after `endStreaming`, around line 127):

```typescript
  /** Lock a tracking channel — marks execution as complete, prevents further user messages. */
  async lockChannel(channelId: string): Promise<void> {
    await this.request(`/api/v1/im/channels/${channelId}/lock`, {
      method: 'POST',
    });
  }
```

- [ ] **Step 2: Commit**

```bash
git add packages/claw-hive/src/components/team9/team9-api-client.ts
git commit -m "feat(team9-api): add lockChannel method for tracking channel lock"
```

---

## Task 6: Wire `TrackingChannelObserver` into `HiveRuntime.createSession()`

**Files:**

- Modify: `packages/claw-hive/src/runtime/hive-runtime.ts:415-520`

- [ ] **Step 1: Understand the lazy activation approach**

`TrackingChannelObserver` is instantiated with `trackingChannelId: null` — it starts inactive. `Team9Component.formatEventEntry()` activates it by calling `setTrackingChannelId()` when it processes the first event with a `trackingChannelId` in the payload. The null guard at the top of `onEvent()` ensures no tracking happens before activation. This avoids the need to thread `trackingChannelId` through session creation params.

- [ ] **Step 2: Instantiate `TrackingChannelObserver` in `createSession()`**

After creating the `ReplyStreamObserver` (line 473), add:

```typescript
// Create per-session TrackingChannelObserver
const trackingChannelObs = new TrackingChannelObserver(
  sessionId,
  null, // trackingChannelId set lazily from first event
  team9BotUserId,
  {
    sendMessage: (channelId, content, senderId, parentId) =>
      team9Client
        ? team9Client.sendMessage(channelId, content, senderId, parentId)
        : Promise.reject(new Error("team9 API client not configured")),
    lockChannel: (channelId) =>
      team9Client
        ? team9Client.lockChannel(channelId)
        : Promise.reject(new Error("team9 API client not configured")),
  },
);
```

- [ ] **Step 3: Add to session observers list**

In the observers assembly (line 494-497):

```typescript
const sessionObservers: IObserver[] = [
  ...this.observers,
  ...(params.observers ?? []),
  replyStreamObs,
  trackingChannelObs, // NEW
];
```

- [ ] **Step 4: Inject into Team9Component config for activation**

Similar to how `replyStreamObserver` is injected into the team9 component config (line 476-488):

```typescript
if (compId === "team9" || entry.config?.platformId === "team9") {
  entry.config = {
    ...entry.config,
    replyStreamObserver: replyStreamObs,
    trackingChannelObserver: trackingChannelObs, // NEW
  };
}
```

- [ ] **Step 5: Activate observer from Team9Component**

In `packages/claw-hive/src/components/team9/component.ts`, in `formatEventEntry()` (the method that processes incoming team9 events), extract `trackingChannelId` and activate the observer:

```typescript
formatEventEntry(event: HiveInputEvent): AgentMessage | null {
  // ... existing code ...

  // Activate tracking channel observer if trackingChannelId is present
  const trackingChannelId = event.payload?.trackingChannelId as string | undefined;
  if (trackingChannelId && this.config?.trackingChannelObserver) {
    this.config.trackingChannelObserver.setTrackingChannelId(trackingChannelId);
  }

  // ... rest of existing code ...
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/claw-hive/src/runtime/hive-runtime.ts \
       packages/claw-hive/src/components/team9/component.ts \
       packages/claw-hive/src/runtime/tracking-channel-observer.ts
git commit -m "feat(claw-hive): wire TrackingChannelObserver into session lifecycle"
```

---

## Task 7: Tracking Channel Lock on `agent_end`

The `TrackingChannelObserver` already locks the channel on `agent_end` (Task 4). The Team9 server must enforce that locked tracking channels reject new messages from users.

**Files:**

- Modify: `apps/server/apps/gateway/src/im/messages/messages.controller.ts`

- [ ] **Step 1: Check `isLocked` before accepting messages in tracking channels**

In the message creation endpoint (POST `/v1/im/channels/:channelId/messages`), add a check:

```typescript
// After fetching channel info and verifying membership:
if (channel.type === "tracking" && channel.isLocked) {
  throw new ForbiddenException(
    "Tracking channel is locked — execution has completed",
  );
}
```

This uses the new `isLocked` field. When the agent calls `lockChannel()` on execution end, subsequent messages (from both users and bots) are rejected. The bot sends "Execution complete" BEFORE calling lock, so there's no ordering issue.

- [ ] **Step 3: Commit**

```bash
git add apps/server/apps/gateway/src/im/messages/messages.controller.ts
git commit -m "feat(gateway): enforce tracking channel lock for user messages"
```

---

## Task 8: Integration Test — End-to-End Flow

**Files:**

- Create: `packages/claw-hive/src/__integration__/tracking-channel.integration.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TrackingChannelObserver } from "../runtime/tracking-channel-observer.js";
import type { AgentEvent } from "@team9claw/types";

describe("TrackingChannel integration", () => {
  it("full lifecycle: activate → track events → lock", async () => {
    const api = {
      sendMessage: vi.fn().mockResolvedValue({}),
      lockChannel: vi.fn().mockResolvedValue(undefined),
    };

    const observer = new TrackingChannelObserver(
      "session-1",
      null,
      "bot-1",
      api,
    );

    // Before activation: events are ignored
    await observer.onEvent({
      type: "tool_call_start",
      sessionId: "session-1",
      timestamp: Date.now(),
      toolCallId: "tc-0",
      toolName: "Ignored",
      args: {},
    } as any);
    expect(api.sendMessage).not.toHaveBeenCalled();

    // Activate
    observer.setTrackingChannelId("tracking-ch-1");

    // Simulate full execution
    const events: AgentEvent[] = [
      { type: "agent_start", sessionId: "session-1", timestamp: Date.now() },
      {
        type: "turn_start",
        sessionId: "session-1",
        timestamp: Date.now(),
        turnIndex: 0,
      },
      {
        type: "tool_call_start",
        sessionId: "session-1",
        timestamp: Date.now(),
        toolCallId: "tc-1",
        toolName: "QueryMessages",
        args: { channelId: "ch-1" },
      },
      {
        type: "tool_call_end",
        sessionId: "session-1",
        timestamp: Date.now(),
        toolCallId: "tc-1",
        toolName: "QueryMessages",
        result: { messages: ["hello"] },
        isError: false,
      },
      { type: "agent_end", sessionId: "session-1", timestamp: Date.now() },
    ] as AgentEvent[];

    for (const event of events) {
      await observer.onEvent(event);
    }

    // agent_start + tool_call_start + tool_call_end + agent_end = 4 messages
    expect(api.sendMessage).toHaveBeenCalledTimes(4);

    // Channel should be locked
    expect(api.lockChannel).toHaveBeenCalledWith("tracking-ch-1");
  });
});
```

- [ ] **Step 2: Run integration test**

```bash
cd /Users/winrey/Projects/weightwave/team9-agent-pi/packages/claw-hive && npx vitest run src/__integration__/tracking-channel.integration.test.ts
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/claw-hive/src/__integration__/tracking-channel.integration.test.ts
git commit -m "test(claw-hive): add tracking channel integration test"
```

---

## Summary of Changes

| Side                | What                                                     | Where                                           |
| ------------------- | -------------------------------------------------------- | ----------------------------------------------- |
| **Team9 DB**        | Add `'tracking'` enum value + `isLocked` field           | `channels.ts`, migration                        |
| **Team9 DTO**       | Accept `'tracking'` type                                 | `create-channel.dto.ts`                         |
| **Team9 IM-Worker** | Create tracking channel + placeholder before `sendInput` | `post-broadcast.service.ts`                     |
| **Team9 IM-Worker** | Route tracking channel messages like DMs (all forwarded) | `post-broadcast.service.ts`                     |
| **Team9 Gateway**   | Reject messages to locked tracking channels              | `messages.controller.ts`                        |
| **Team9 Shared**    | Add `TRACKING` event names                               | `event-names.ts`                                |
| **Agent types**     | Document `trackingChannelId` in payload                  | `input-event.ts`                                |
| **Team9 Gateway**   | Add `POST /lock` endpoint for tracking channels          | `channels.controller.ts`, `channels.service.ts` |
| **Agent API**       | Add `lockChannel()` method                               | `team9-api-client.ts`                           |
| **Agent Observer**  | New `TrackingChannelObserver`                            | `tracking-channel-observer.ts`                  |
| **Agent Runtime**   | Wire observer into session lifecycle                     | `hive-runtime.ts`                               |
| **Agent Component** | Activate observer from event payload                     | `component.ts`                                  |
