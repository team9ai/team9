# User Room Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace channel room broadcast with user room delivery — all channel-scoped WebSocket events go through `sendToChannelMembers` which queries cached member lists and emits to per-user rooms.

**Architecture:** On connect, each socket joins `user:{userId}` room instead of all channel rooms. A new `ChannelMemberCacheService` caches channel member IDs in Redis. All event handlers replace `server.to(\`channel:${channelId}\`).emit()`with`sendToChannelMembers()` which iterates members and emits to their user rooms. Edit/delete advance seqId for incremental sync recovery. Client removes joinChannel/leaveChannel and rewrites sync merge to handle edits/deletes across main + thread + sub-reply caches.

**Tech Stack:** NestJS, Socket.io, Redis, Drizzle ORM, Jest (server), Vitest (client), TanStack React Query

**Spec:** `docs/superpowers/specs/2026-03-21-user-room-read-diffusion-design.md`

---

## File Structure

### New Files

| File                                                                          | Responsibility                                                             |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `apps/server/apps/gateway/src/im/shared/channel-member-cache.service.ts`      | Redis-cached channel member ID lookups with stampede prevention            |
| `apps/server/apps/gateway/src/im/shared/channel-member-cache.service.spec.ts` | Unit tests for cache service                                               |
| `apps/server/apps/gateway/src/im/shared/channel-sequence.service.ts`          | Gateway-side seqId generation (Redis INCR on `im:seq:channel:{channelId}`) |
| `apps/server/apps/gateway/src/im/shared/channel-sequence.service.spec.ts`     | Unit tests for sequence service                                            |
| `apps/server/apps/gateway/src/im/websocket/websocket.gateway.spec.ts`         | Unit tests for gateway changes                                             |
| `apps/server/apps/gateway/test/websocket-user-room.e2e-spec.ts`               | E2E tests for user room delivery                                           |
| `apps/client/src/hooks/__tests__/useSyncChannel.test.ts`                      | Vitest tests for sync merge rewrite                                        |

### Modified Files

| File                                                                    | Changes                                                                                                                                                 |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/apps/gateway/src/im/websocket/websocket.gateway.ts`        | Remove channel room joins, add user room join, add `sendToChannelMembers`, refactor `sendToUser`, update all event handlers, update `cleanupBotStreams` |
| `apps/server/apps/gateway/src/im/websocket/websocket.module.ts`         | Register new services                                                                                                                                   |
| `apps/server/apps/gateway/src/im/messages/messages.controller.ts`       | Replace `sendToChannel` with `sendToChannelMembers`                                                                                                     |
| `apps/server/apps/gateway/src/im/messages/messages.service.ts`          | Edit/delete advance seqId                                                                                                                               |
| `apps/server/apps/gateway/src/im/channels/channels.controller.ts`       | Replace `sendToChannel`, add member removal WS notification                                                                                             |
| `apps/server/apps/gateway/src/im/channels/channels.service.ts`          | Add cache invalidation on member changes                                                                                                                |
| `apps/server/apps/gateway/src/im/sync/sync.service.ts`                  | Remove `isDeleted=false` filter, add `isDeleted` to serialization                                                                                       |
| `apps/server/apps/gateway/src/cluster/connection/connection.service.ts` | Use user room instead of socket IDs                                                                                                                     |
| `apps/server/libs/shared/src/types/message.types.ts`                    | Add `isDeleted` to `SyncMessageItem`                                                                                                                    |
| `apps/client/src/services/websocket/index.ts`                           | Remove joinChannel/leaveChannel/pendingChannelJoins                                                                                                     |
| `apps/client/src/hooks/useMessages.ts`                                  | Remove `wsService.joinChannel()` calls                                                                                                                  |
| `apps/client/src/hooks/useSyncChannel.ts`                               | Rewrite merge logic for edit/delete/thread recovery                                                                                                     |
| `apps/client/src/types/im.ts`                                           | Add `isDeleted` to `SyncMessageItem`                                                                                                                    |

---

## Task 1: ChannelMemberCacheService — Test + Implement

**Files:**

- Create: `apps/server/apps/gateway/src/im/shared/channel-member-cache.service.ts`
- Create: `apps/server/apps/gateway/src/im/shared/channel-member-cache.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/server/apps/gateway/src/im/shared/channel-member-cache.service.spec.ts
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

type MockFn = jest.Mock<(...args: any[]) => any>;

function mockDb() {
  const chain: Record<string, MockFn> = {};
  const methods = [
    "select",
    "from",
    "where",
    "limit",
    "insert",
    "values",
    "returning",
    "update",
    "set",
  ];
  for (const m of methods) {
    chain[m] = jest.fn<any>().mockReturnValue(chain);
  }
  chain.select.mockReturnValue(chain);
  return chain;
}

describe("ChannelMemberCacheService", () => {
  let service: any;
  let redisService: Record<string, MockFn>;
  let db: ReturnType<typeof mockDb>;

  beforeEach(async () => {
    redisService = {
      get: jest.fn<any>().mockResolvedValue(null),
      set: jest.fn<any>().mockResolvedValue(undefined),
      del: jest.fn<any>().mockResolvedValue(undefined),
    };
    db = mockDb();

    const { ChannelMemberCacheService } =
      await import("./channel-member-cache.service.js");
    const { Test } = await import("@nestjs/testing");
    const { DATABASE_CONNECTION } = await import("@team9/database");

    const module = await Test.createTestingModule({
      providers: [
        ChannelMemberCacheService,
        { provide: "RedisService", useValue: redisService },
        { provide: DATABASE_CONNECTION, useValue: db },
      ],
    }).compile();

    service = module.get(ChannelMemberCacheService);
  });

  it("returns cached member IDs on cache hit", async () => {
    redisService.get.mockResolvedValue(JSON.stringify(["user-1", "user-2"]));
    const result = await service.getMemberIds("channel-1");
    expect(result).toEqual(["user-1", "user-2"]);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("queries DB on cache miss and writes to Redis", async () => {
    redisService.get.mockResolvedValue(null);
    db.select.mockReturnValue(db);
    db.from.mockReturnValue(db);
    db.where.mockResolvedValue([{ userId: "user-1" }, { userId: "user-2" }]);

    const result = await service.getMemberIds("channel-1");
    expect(result).toEqual(["user-1", "user-2"]);
    expect(redisService.set).toHaveBeenCalledWith(
      "im:cache:channel_members:channel-1",
      JSON.stringify(["user-1", "user-2"]),
      300,
    );
  });

  it("returns empty array for channel with no members", async () => {
    db.where.mockResolvedValue([]);
    const result = await service.getMemberIds("empty-channel");
    expect(result).toEqual([]);
  });

  it("invalidate deletes Redis key", async () => {
    await service.invalidate("channel-1");
    expect(redisService.del).toHaveBeenCalledWith(
      "im:cache:channel_members:channel-1",
    );
  });

  it("coalesces concurrent requests for same channel", async () => {
    db.where.mockResolvedValue([{ userId: "user-1" }]);
    const [r1, r2] = await Promise.all([
      service.getMemberIds("channel-1"),
      service.getMemberIds("channel-1"),
    ]);
    expect(r1).toEqual(r2);
    // DB should only be called once
    expect(db.from).toHaveBeenCalledTimes(1);
  });

  it("throws on DB failure, does not cache", async () => {
    db.where.mockRejectedValue(new Error("DB down"));
    await expect(service.getMemberIds("channel-1")).rejects.toThrow("DB down");
    expect(redisService.set).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/server && npx jest apps/gateway/src/im/shared/channel-member-cache.service.spec.ts --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ChannelMemberCacheService**

```typescript
// apps/server/apps/gateway/src/im/shared/channel-member-cache.service.ts
import { Injectable, Inject, Logger } from "@nestjs/common";
import { RedisService } from "@team9/redis";
import { DATABASE_CONNECTION } from "@team9/database";
import type { PostgresJsDatabase } from "@team9/database";
import * as schema from "@team9/database/schemas";
import { eq, isNull } from "drizzle-orm";

const CACHE_KEY = (channelId: string) =>
  `im:cache:channel_members:${channelId}`;
const CACHE_TTL = 300; // 5 minutes

@Injectable()
export class ChannelMemberCacheService {
  private readonly logger = new Logger(ChannelMemberCacheService.name);
  private readonly inflightLoads = new Map<string, Promise<string[]>>();

  constructor(
    private readonly redisService: RedisService,
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async getMemberIds(channelId: string): Promise<string[]> {
    // 1. Check Redis cache
    const cached = await this.redisService.get(CACHE_KEY(channelId));
    if (cached) return JSON.parse(cached);

    // 2. Coalesce concurrent loads
    const inflight = this.inflightLoads.get(channelId);
    if (inflight) return inflight;

    const loadPromise = this.loadFromDb(channelId);
    this.inflightLoads.set(channelId, loadPromise);
    try {
      return await loadPromise;
    } finally {
      this.inflightLoads.delete(channelId);
    }
  }

  async invalidate(channelId: string): Promise<void> {
    await this.redisService.del(CACHE_KEY(channelId));
  }

  private async loadFromDb(channelId: string): Promise<string[]> {
    const rows = await this.db
      .select({ userId: schema.channelMembers.userId })
      .from(schema.channelMembers)
      .where(
        eq(schema.channelMembers.channelId, channelId),
        // Only active members (not left)
      );

    // Filter out members who have left (leftAt is not null)
    // The exact filter depends on schema — adjust if channelMembers has leftAt
    const memberIds = rows.map((r) => r.userId);

    await this.redisService.set(
      CACHE_KEY(channelId),
      JSON.stringify(memberIds),
      CACHE_TTL,
    );

    return memberIds;
  }
}
```

**Note:** The exact DB query filter for active members depends on the `channelMembers` schema. Check `schema.channelMembers` for a `leftAt` column — if present, add `isNull(schema.channelMembers.leftAt)` to the where clause. Read `apps/server/libs/database/schemas/im/channel-members.ts` to verify.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/server && npx jest apps/gateway/src/im/shared/channel-member-cache.service.spec.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/apps/gateway/src/im/shared/channel-member-cache.service.ts apps/server/apps/gateway/src/im/shared/channel-member-cache.service.spec.ts
git commit -m "feat(im): add ChannelMemberCacheService with Redis cache and stampede prevention"
```

---

## Task 2: ChannelSequenceService — Test + Implement

The Gateway needs to generate seqIds for edit/delete operations. Currently `SequenceService` lives in the IM Worker (`apps/server/apps/im-worker/src/sequence/`). It uses Redis INCR on `im:seq:channel:{channelId}`. We create a lightweight version in the Gateway that uses the same Redis key pattern, ensuring compatibility.

**Files:**

- Create: `apps/server/apps/gateway/src/im/shared/channel-sequence.service.ts`
- Create: `apps/server/apps/gateway/src/im/shared/channel-sequence.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/server/apps/gateway/src/im/shared/channel-sequence.service.spec.ts
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

describe("ChannelSequenceService", () => {
  let service: any;
  let redisService: any;

  beforeEach(async () => {
    redisService = {
      incr: jest.fn<any>().mockResolvedValue(42),
      exists: jest.fn<any>().mockResolvedValue(1),
    };

    const { ChannelSequenceService } =
      await import("./channel-sequence.service.js");
    const { Test } = await import("@nestjs/testing");

    const module = await Test.createTestingModule({
      providers: [
        ChannelSequenceService,
        { provide: "RedisService", useValue: redisService },
      ],
    }).compile();

    service = module.get(ChannelSequenceService);
  });

  it("generates seqId via Redis INCR", async () => {
    const seq = await service.generateChannelSeq("channel-1");
    expect(redisService.incr).toHaveBeenCalledWith("im:seq:channel:channel-1");
    expect(seq).toBe(BigInt(42));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && npx jest apps/gateway/src/im/shared/channel-sequence.service.spec.ts --no-coverage`
Expected: FAIL

- [ ] **Step 3: Implement ChannelSequenceService**

```typescript
// apps/server/apps/gateway/src/im/shared/channel-sequence.service.ts
import { Injectable } from "@nestjs/common";
import { RedisService } from "@team9/redis";

@Injectable()
export class ChannelSequenceService {
  constructor(private readonly redisService: RedisService) {}

  /**
   * Generate next seqId for a channel.
   * Uses the same Redis key pattern as IM Worker's SequenceService
   * to ensure seqId continuity.
   */
  async generateChannelSeq(channelId: string): Promise<bigint> {
    const key = `im:seq:channel:${channelId}`;
    const seq = await this.redisService.incr(key);
    return BigInt(seq);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/server && npx jest apps/gateway/src/im/shared/channel-sequence.service.spec.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/apps/gateway/src/im/shared/channel-sequence.service.ts apps/server/apps/gateway/src/im/shared/channel-sequence.service.spec.ts
git commit -m "feat(im): add ChannelSequenceService for Gateway-side seqId generation"
```

---

## Task 3: WebSocket Gateway — sendToChannelMembers + sendToUser refactor

**Files:**

- Modify: `apps/server/apps/gateway/src/im/websocket/websocket.gateway.ts`
- Modify: `apps/server/apps/gateway/src/im/websocket/websocket.module.ts`

- [ ] **Step 1: Register new services in WebSocket module**

In `websocket.module.ts`, add `ChannelMemberCacheService` and `ChannelSequenceService` to providers array.

- [ ] **Step 2: Inject ChannelMemberCacheService into WebSocketGateway constructor**

Add: `private readonly channelMemberCacheService: ChannelMemberCacheService` to constructor params.

- [ ] **Step 3: Add sendToChannelMembers method**

Add after existing `sendToChannel` method (around line 804):

```typescript
async sendToChannelMembers(
  channelId: string,
  event: string,
  data: unknown,
  excludeUserId?: string,
): Promise<void> {
  try {
    const memberIds = await this.channelMemberCacheService.getMemberIds(channelId);
    for (const userId of memberIds) {
      if (userId === excludeUserId) continue;
      this.server.to(`user:${userId}`).emit(event, data);
    }
  } catch (error) {
    this.logger.error(
      `Failed to deliver ${event} to channel ${channelId}: ${error.message}`,
    );
  }
}
```

- [ ] **Step 4: Refactor sendToUser to use user room**

Replace `sendToUser` implementation (lines 789-800):

```typescript
async sendToUser(userId: string, event: string, data: unknown): Promise<void> {
  this.server.to(`user:${userId}`).emit(event, data);
}
```

- [ ] **Step 5: Run existing tests to verify no breakage**

Run: `cd apps/server && npx jest apps/gateway/ --no-coverage`
Expected: PASS (existing tests should still pass)

- [ ] **Step 6: Commit**

```bash
git add apps/server/apps/gateway/src/im/websocket/websocket.gateway.ts apps/server/apps/gateway/src/im/websocket/websocket.module.ts
git commit -m "feat(im): add sendToChannelMembers method and refactor sendToUser to user room"
```

---

## Task 4: handleConnection — Replace channel room joins with user room

**Files:**

- Modify: `apps/server/apps/gateway/src/im/websocket/websocket.gateway.ts`

- [ ] **Step 1: Replace channel room joins with user room join**

In `handleConnection` (around lines 239-241), replace:

```typescript
// REMOVE:
const userChannels = await this.channelsService.getUserChannels(payload.sub);
for (const channel of userChannels) {
  void client.join(`channel:${channel.id}`);
}

// REPLACE WITH:
void client.join(`user:${payload.sub}`);
```

- [ ] **Step 2: Make handleJoinChannel/handleLeaveChannel no-op**

Replace `handleJoinChannel` body (lines 517-555) — keep the `@SubscribeMessage` decorator but log deprecation and return:

```typescript
@SubscribeMessage(WS_EVENTS.CHANNEL.JOIN)
async handleJoinChannel(
  @ConnectedSocket() client: Socket,
  @MessageBody() data: JoinChannelPayload,
) {
  this.logger.warn(
    `Deprecated: join_channel from ${(client as SocketWithUser).userId}, no-op`,
  );
  return { success: true };
}
```

Replace `handleLeaveChannel` (lines 557-573) similarly:

```typescript
@SubscribeMessage(WS_EVENTS.CHANNEL.LEAVE)
async handleLeaveChannel(
  @ConnectedSocket() client: Socket,
  @MessageBody() data: LeaveChannelPayload,
) {
  this.logger.warn(
    `Deprecated: leave_channel from ${(client as SocketWithUser).userId}, no-op`,
  );
  return { success: true };
}
```

- [ ] **Step 3: Run existing tests**

Run: `cd apps/server && npx jest apps/gateway/ --no-coverage`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/server/apps/gateway/src/im/websocket/websocket.gateway.ts
git commit -m "feat(im): replace channel room joins with user room, deprecate join/leave handlers"
```

---

## Task 5: Migrate all event handlers to sendToChannelMembers

**Files:**

- Modify: `apps/server/apps/gateway/src/im/websocket/websocket.gateway.ts`

- [ ] **Step 1: Migrate typing handlers**

In `handleTypingStart` and `handleTypingStop`, replace channel room broadcast with:

```typescript
// BEFORE (in handleTypingStart):
this.server
  .to(`channel:${channelId}`)
  .emit(WS_EVENTS.TYPING.USER_TYPING, payload);

// AFTER:
await this.sendToChannelMembers(
  channelId,
  WS_EVENTS.TYPING.USER_TYPING,
  payload,
  socketClient.userId,
);
// excludeUserId = sender (typing indicator not sent to self)
```

- [ ] **Step 2: Migrate read status handler**

In `handleMarkAsRead` (lines 591-595), replace:

```typescript
// BEFORE:
client.to(`channel:${channelId}`).emit(WS_EVENTS.READ_STATUS.UPDATED, {...});

// AFTER:
await this.sendToChannelMembers(channelId, WS_EVENTS.READ_STATUS.UPDATED, {
  channelId,
  userId: socketClient.userId,
  lastReadMessageId: messageId,
});
```

- [ ] **Step 3: Migrate reaction handlers**

In `handleAddReaction` and `handleRemoveReaction`, replace channel room broadcast:

```typescript
// BEFORE:
this.server
  .to(`channel:${channelId}`)
  .emit(WS_EVENTS.REACTION.ADDED, reactionData);

// AFTER:
await this.sendToChannelMembers(
  channelId,
  WS_EVENTS.REACTION.ADDED,
  reactionData,
);
// No excludeUserId — all members including reactor
```

- [ ] **Step 4: Migrate streaming handlers**

In `handleStreamingStart`, `handleStreamingContent`, `handleStreamingThinkingContent`, `handleStreamingEnd`, `handleStreamingAbort`, replace all channel room broadcasts:

```typescript
// BEFORE (each handler):
this.server.to(`channel:${channelId}`).emit(WS_EVENTS.STREAMING.*, payload);

// AFTER:
await this.sendToChannelMembers(channelId, WS_EVENTS.STREAMING.*, payload);
```

**Special case for `handleStreamingEnd`:** Also replace the `new_message` emit:

```typescript
// BEFORE:
if (data.message) {
  this.server
    .to(`channel:${data.channelId}`)
    .emit(WS_EVENTS.MESSAGE.NEW, data.message);
}

// AFTER:
if (data.message) {
  await this.sendToChannelMembers(
    data.channelId,
    WS_EVENTS.MESSAGE.NEW,
    data.message,
  );
}
```

- [ ] **Step 5: Migrate cleanupBotStreams**

In `cleanupBotStreams` (around line 1050), replace:

```typescript
// BEFORE:
this.server.to(`channel:${session.channelId}`).emit(WS_EVENTS.STREAMING.ABORT, {...});

// AFTER:
await this.sendToChannelMembers(session.channelId, WS_EVENTS.STREAMING.ABORT, {...});
```

- [ ] **Step 6: Run tests**

Run: `cd apps/server && npx jest apps/gateway/ --no-coverage`
Expected: PASS (some tests may need updating if they mock `sendToChannel`)

- [ ] **Step 7: Commit**

```bash
git add apps/server/apps/gateway/src/im/websocket/websocket.gateway.ts
git commit -m "feat(im): migrate all WS event handlers from channel room to sendToChannelMembers"
```

**Note:** Do NOT delete `sendToChannel` yet — Tasks 6, 7, and 7b still need to migrate their call sites first. Deletion happens in Task 16.

---

## Task 6: Messages Controller — Replace sendToChannel

**Files:**

- Modify: `apps/server/apps/gateway/src/im/messages/messages.controller.ts`

- [ ] **Step 1: Update createMessage**

Replace line 152:

```typescript
// BEFORE:
this.websocketGateway.sendToChannel(channelId, WS_EVENTS.MESSAGE.NEW, message);

// AFTER (include sender for multi-device):
await this.websocketGateway.sendToChannelMembers(
  channelId,
  WS_EVENTS.MESSAGE.NEW,
  message,
);
```

- [ ] **Step 2: Update updateMessage**

Replace lines 283-287:

```typescript
// BEFORE:
this.websocketGateway.sendToChannel(
  message.channelId,
  WS_EVENTS.MESSAGE.UPDATED,
  message,
);

// AFTER:
await this.websocketGateway.sendToChannelMembers(
  message.channelId,
  WS_EVENTS.MESSAGE.UPDATED,
  message,
);
```

- [ ] **Step 3: Update deleteMessage**

Replace line 326:

```typescript
// BEFORE:
this.websocketGateway.sendToChannel(channelId, WS_EVENTS.MESSAGE.DELETED, {
  messageId,
});

// AFTER:
await this.websocketGateway.sendToChannelMembers(
  channelId,
  WS_EVENTS.MESSAGE.DELETED,
  { messageId, channelId },
);
```

- [ ] **Step 4: Run tests**

Run: `cd apps/server && npx jest apps/gateway/src/im/messages/ --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/apps/gateway/src/im/messages/messages.controller.ts
git commit -m "feat(im): messages controller uses sendToChannelMembers for all broadcasts"
```

---

## Task 7: Channels Controller — Replace sendToChannel + member removal notification

**Files:**

- Modify: `apps/server/apps/gateway/src/im/channels/channels.controller.ts`

- [ ] **Step 1: Replace channel_updated broadcast**

Find `sendToChannel` call for `CHANNEL.UPDATED` (line 183) and replace:

```typescript
// BEFORE:
this.websocketGateway.sendToChannel(
  channelId,
  WS_EVENTS.CHANNEL.UPDATED,
  channel,
);

// AFTER:
await this.websocketGateway.sendToChannelMembers(
  channelId,
  WS_EVENTS.CHANNEL.UPDATED,
  channel,
);
```

- [ ] **Step 2: Replace channel_joined broadcast**

Find `sendToChannel` call for `CHANNEL.JOINED` (line 244) and replace:

```typescript
// BEFORE:
this.websocketGateway.sendToChannel(channelId, WS_EVENTS.CHANNEL.JOINED, {...});

// AFTER:
await this.websocketGateway.sendToChannelMembers(channelId, WS_EVENTS.CHANNEL.JOINED, {...});
```

- [ ] **Step 3: Add member removal WS notification**

In `removeMember` (lines 263-271), add notification after service call. **Strict ordering: DB remove → invalidate cache → notify remaining → notify removed user:**

```typescript
@Delete(':id/members/:memberId')
async removeMember(
  @CurrentUser('sub') userId: string,
  @Param('id') channelId: string,
  @Param('memberId') memberId: string,
): Promise<{ success: boolean }> {
  await this.channelsService.removeMember(channelId, memberId, userId);

  // Cache is already invalidated by channelsService.removeMember
  // Notify remaining members
  await this.websocketGateway.sendToChannelMembers(channelId, WS_EVENTS.CHANNEL.LEFT, {
    channelId,
    userId: memberId,
  });
  // Notify the removed user directly
  await this.websocketGateway.sendToUser(memberId, WS_EVENTS.CHANNEL.LEFT, {
    channelId,
    userId: memberId,
  });

  return { success: true };
}
```

- [ ] **Step 4: Run tests**

Run: `cd apps/server && npx jest apps/gateway/src/im/channels/ --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/apps/gateway/src/im/channels/channels.controller.ts
git commit -m "feat(im): channels controller uses sendToChannelMembers, adds member removal WS notification"
```

---

## Task 7b: Workspace Service — Replace sendToChannel

**Files:**

- Modify: `apps/server/apps/gateway/src/workspace/workspace.service.ts`

- [ ] **Step 1: Find and replace sendToChannel calls**

Search for all `sendToChannel` calls in `workspace.service.ts`. Replace each with `sendToChannelMembers`:

```typescript
// BEFORE:
this.websocketGateway.sendToChannel(
  channelId,
  WS_EVENTS.MESSAGE.NEW,
  systemMessage,
);

// AFTER:
await this.websocketGateway.sendToChannelMembers(
  channelId,
  WS_EVENTS.MESSAGE.NEW,
  systemMessage,
);
```

- [ ] **Step 2: Run tests**

Run: `cd apps/server && npx jest apps/gateway/src/workspace/ --no-coverage`
Expected: PASS (update mocks if needed — `sendToChannel` → `sendToChannelMembers`)

- [ ] **Step 3: Commit**

```bash
git add apps/server/apps/gateway/src/workspace/workspace.service.ts
git commit -m "feat(im): workspace service uses sendToChannelMembers for system messages"
```

---

## Task 8: Channels Service — Add cache invalidation

**Files:**

- Modify: `apps/server/apps/gateway/src/im/channels/channels.service.ts`

- [ ] **Step 1: Inject ChannelMemberCacheService**

Add to constructor: `private readonly channelMemberCacheService: ChannelMemberCacheService`

- [ ] **Step 2: Add cache invalidation to addMember**

After the DB insert in `addMember` (around line 600):

```typescript
await this.channelMemberCacheService.invalidate(channelId);
```

- [ ] **Step 3: Add cache invalidation to removeMember**

After setting `leftAt` in `removeMember` (around line 625):

```typescript
await this.channelMemberCacheService.invalidate(channelId);
```

- [ ] **Step 4: Run tests**

Run: `cd apps/server && npx jest apps/gateway/src/im/channels/channels.service.spec.ts --no-coverage`
Expected: PASS (may need to update mocks to provide ChannelMemberCacheService)

- [ ] **Step 5: Commit**

```bash
git add apps/server/apps/gateway/src/im/channels/channels.service.ts
git commit -m "feat(im): add channel member cache invalidation on member changes"
```

---

## Task 9: Edit/Delete seqId advancement

**Files:**

- Modify: `apps/server/apps/gateway/src/im/messages/messages.service.ts`

- [ ] **Step 1: Inject ChannelSequenceService into MessagesService**

Add `private readonly channelSequenceService: ChannelSequenceService` to constructor.

- [ ] **Step 2: Advance seqId in update method**

In the `update` method (around line 851), before the DB update:

```typescript
const newSeqId = await this.channelSequenceService.generateChannelSeq(
  message.channelId,
);
await this.db
  .update(schema.messages)
  .set({
    content: dto.content,
    isEdited: true,
    updatedAt: new Date(),
    seqId: newSeqId,
  })
  .where(eq(schema.messages.id, messageId));
```

- [ ] **Step 3: Advance seqId in delete method**

In the `delete` method (around line 877):

```typescript
const message = /* existing message fetch */;
const newSeqId = await this.channelSequenceService.generateChannelSeq(message.channelId);
await this.db
  .update(schema.messages)
  .set({
    isDeleted: true,
    deletedAt: new Date(),
    updatedAt: new Date(),
    seqId: newSeqId,
  })
  .where(eq(schema.messages.id, messageId));
```

- [ ] **Step 4: Run tests**

Run: `cd apps/server && npx jest apps/gateway/src/im/messages/ --no-coverage`
Expected: PASS (update mocks for ChannelSequenceService)

- [ ] **Step 5: Commit**

```bash
git add apps/server/apps/gateway/src/im/messages/messages.service.ts
git commit -m "feat(im): edit/delete advance seqId for incremental sync recovery"
```

---

## Task 10: Sync service — Return deleted messages + expose isDeleted

**Files:**

- Modify: `apps/server/apps/gateway/src/im/sync/sync.service.ts`
- Modify: `apps/server/libs/shared/src/types/message.types.ts`

- [ ] **Step 1: Add isDeleted to SyncMessageItem type**

In `libs/shared/src/types/message.types.ts` (around line 654), add to the interface:

```typescript
export interface SyncMessageItem {
  id: string;
  channelId: string;
  senderId: string | null;
  parentId: string | null;
  rootId: string | null;
  content: string | null;
  type: string;
  seqId: string;
  isPinned: boolean;
  isEdited: boolean;
  isDeleted: boolean;   // ADD THIS
  createdAt: string;
  updatedAt: string;
  sender?: { ... };
}
```

- [ ] **Step 2: Remove isDeleted=false filter from sync query**

In `sync.service.ts` (around line 73), remove:

```typescript
// REMOVE this line from the where clause:
eq(schema.messages.isDeleted, false),
```

- [ ] **Step 3: Add isDeleted to serialization**

In the message mapping section of `enrichMessagesWithSenders` (around line 247), add `isDeleted`:

```typescript
// Add to the returned object:
isDeleted: msg.isDeleted,
```

- [ ] **Step 4: Run tests**

Run: `cd apps/server && npx jest apps/gateway/ --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/libs/shared/src/types/message.types.ts apps/server/apps/gateway/src/im/sync/sync.service.ts
git commit -m "feat(im): sync returns deleted messages with isDeleted flag for recovery"
```

---

## Task 11: ConnectionService — Use user rooms

**Files:**

- Modify: `apps/server/apps/gateway/src/cluster/connection/connection.service.ts`

- [ ] **Step 1: Replace socket ID iteration with user room emit**

In `handleDownstreamMessage` (around line 183), replace:

```typescript
// BEFORE:
const socketIds = this.getLocalUserSockets(userId);
for (const socketId of socketIds) {
  this.server.to(socketId).emit(event, fullMessage);
}

// AFTER:
this.server.to(`user:${userId}`).emit(event, fullMessage);
```

- [ ] **Step 2: Run tests**

Run: `cd apps/server && npx jest apps/gateway/ --no-coverage`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/server/apps/gateway/src/cluster/connection/connection.service.ts
git commit -m "feat(im): ConnectionService delivers to user rooms instead of socket IDs"
```

---

## Task 12: Client — Remove joinChannel/leaveChannel

**Files:**

- Modify: `apps/client/src/services/websocket/index.ts`
- Modify: `apps/client/src/hooks/useMessages.ts`

- [ ] **Step 1: Remove from WebSocket service**

In `apps/client/src/services/websocket/index.ts`:

1. Delete `pendingChannelJoins: Set<string>` property declaration
2. Delete `processPendingJoins()` method (lines 322-329)
3. Delete `joinChannel()` method (lines 341-349)
4. Delete `leaveChannel()` method (lines 351-357)
5. Remove `this.processPendingJoins()` call from connection handler (line 170)
6. In the `channel_created` listener (lines 200-204), remove `this.joinChannel(channel.id)`:

```typescript
// BEFORE:
this.socket.on("channel_created", (channel: { id: string }) => {
  this.joinChannel(channel.id);
});

// AFTER:
// Keep the listener but remove the join — just invalidate queries
this.socket.on("channel_created", () => {
  queryClient.invalidateQueries({ queryKey: ["channels"] });
});
```

- [ ] **Step 2: Remove joinChannel calls from useMessages**

In `apps/client/src/hooks/useMessages.ts`, remove lines 78 and 761:

```typescript
// DELETE these lines:
wsService.joinChannel(channelId);
```

- [ ] **Step 3: Run client tests**

Run: `cd apps/client && npx vitest run --reporter verbose`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/services/websocket/index.ts apps/client/src/hooks/useMessages.ts
git commit -m "feat(client): remove joinChannel/leaveChannel, server delivers via user room"
```

---

## Task 13: Client — Sync merge rewrite + isDeleted type

**Files:**

- Modify: `apps/client/src/hooks/useSyncChannel.ts`
- Modify: `apps/client/src/types/im.ts`
- Create: `apps/client/src/hooks/__tests__/useSyncChannel.test.ts`

- [ ] **Step 1: Add isDeleted to client SyncMessageItem type**

In `apps/client/src/types/im.ts` (around line 253), add:

```typescript
isDeleted: boolean;
```

- [ ] **Step 2: Write failing tests for sync merge**

```typescript
// apps/client/src/hooks/__tests__/useSyncChannel.test.ts
import { describe, it, expect } from "vitest";

// Test the pure sync merge logic (extract it as a helper function)
// Import after extraction
import { mergeSyncedMessages } from "../useSyncChannel";

describe("mergeSyncedMessages", () => {
  it("appends new messages", () => {
    const existing = [{ id: "msg-1", content: "hello" }];
    const synced = [
      {
        id: "msg-2",
        content: "world",
        isDeleted: false,
        parentId: null,
        rootId: null,
      },
    ];
    const result = mergeSyncedMessages(existing, synced);
    expect(result.main).toHaveLength(2);
  });

  it("replaces edited messages", () => {
    const existing = [{ id: "msg-1", content: "old" }];
    const synced = [
      {
        id: "msg-1",
        content: "new",
        isDeleted: false,
        isEdited: true,
        parentId: null,
        rootId: null,
      },
    ];
    const result = mergeSyncedMessages(existing, synced);
    expect(result.main[0].content).toBe("new");
  });

  it("removes deleted messages", () => {
    const existing = [{ id: "msg-1", content: "hello" }];
    const synced = [
      { id: "msg-1", isDeleted: true, parentId: null, rootId: null },
    ];
    const result = mergeSyncedMessages(existing, synced);
    expect(result.main).toHaveLength(0);
    expect(result.deletedIds).toContain("msg-1");
  });

  it("routes first-level replies to thread cache", () => {
    const synced = [
      { id: "reply-1", parentId: "root-1", rootId: "root-1", isDeleted: false },
    ];
    const result = mergeSyncedMessages([], synced);
    expect(result.threadUpdates.get("root-1")).toHaveLength(1);
  });

  it("routes sub-replies to subReplies cache by parentReplyId", () => {
    const synced = [
      { id: "sub-1", parentId: "reply-1", rootId: "root-1", isDeleted: false },
    ];
    const result = mergeSyncedMessages([], synced);
    expect(result.subReplyUpdates.get("reply-1")).toHaveLength(1);
  });

  it("syncItemToMessage passes isDeleted through", () => {
    // Verify the conversion function doesn't hardcode isDeleted
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/client && npx vitest run src/hooks/__tests__/useSyncChannel.test.ts`
Expected: FAIL

- [ ] **Step 4: Fix syncItemToMessage — pass through isDeleted**

In `useSyncChannel.ts` line 20, replace:

```typescript
// BEFORE:
isDeleted: false,

// AFTER:
isDeleted: item.isDeleted ?? false,
```

- [ ] **Step 5: Extract merge logic as a pure function and rewrite**

Extract the sync merge logic from the `useEffect` into a testable pure function `mergeSyncedMessages`. Rewrite to:

1. Partition synced messages into main / first-level replies / sub-replies / deleted
2. Main cache: remove deleted, replace edited, append new
3. Thread updates: group first-level replies by rootId for `["thread", rootId]`
4. Sub-reply updates: group by parentId (first-level reply ID) for `["subReplies", parentReplyId]`

- [ ] **Step 6: Update the useEffect to use the extracted merge function**

Apply the merge results to the appropriate React Query caches.

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd apps/client && npx vitest run src/hooks/__tests__/useSyncChannel.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/client/src/types/im.ts apps/client/src/hooks/useSyncChannel.ts apps/client/src/hooks/__tests__/useSyncChannel.test.ts
git commit -m "feat(client): rewrite sync merge for edit/delete/thread recovery with isDeleted support"
```

---

## Task 14: Integration tests — WebSocket user room delivery

**Files:**

- Create: `apps/server/apps/gateway/test/websocket-user-room.e2e-spec.ts`

- [ ] **Step 1: Write integration tests**

Use NestJS `TestingModule` with real Socket.io client (`socket.io-client`) to test the full flow:

```typescript
// Key test scenarios:
// 1. Client connects → verify socket.rooms contains user:{userId}, not channel:*
// 2. Two clients in same channel → typing event delivered via user rooms
// 3. Client NOT in channel → does NOT receive typing
// 4. Message created → both channel members receive via user rooms
// 5. Sender's other device receives the message (multi-device)
// 6. Member removed → removed user gets channel_left, stops receiving events
// 7. Edit message → new seqId assigned → sync returns updated content
// 8. Delete message → new seqId assigned → sync returns isDeleted=true
```

**Note:** These tests need to mock/stub the database and Redis. Use the existing test patterns from `app.e2e-spec.ts` and `auth.controller.spec.ts` for setup.

- [ ] **Step 2: Run integration tests**

Run: `cd apps/server && npx jest apps/gateway/test/websocket-user-room.e2e-spec.ts --config apps/gateway/test/jest-e2e.json --no-coverage`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/server/apps/gateway/test/websocket-user-room.e2e-spec.ts
git commit -m "test(im): add integration tests for user room delivery architecture"
```

---

## Task 15: Unit tests — WebSocket Gateway changes

**Files:**

- Create: `apps/server/apps/gateway/src/im/websocket/websocket.gateway.spec.ts`

- [ ] **Step 1: Write unit tests for gateway changes**

```typescript
// Test cases:
// 1. handleConnection joins user:{userId} room, NOT channel rooms
// 2. handleJoinChannel is no-op (returns success, no room join)
// 3. handleLeaveChannel is no-op
// 4. sendToChannelMembers iterates members and emits to user rooms
// 5. sendToChannelMembers excludes sender when excludeUserId provided
// 6. sendToChannelMembers catches errors and logs (doesn't throw)
// 7. sendToUser emits to user:{userId} room
// 8. handleTypingStart calls sendToChannelMembers with excludeUserId
// 9. handleStreamingEnd emits both STREAMING.END and MESSAGE.NEW via sendToChannelMembers
// 10. cleanupBotStreams uses sendToChannelMembers for STREAMING.ABORT
```

- [ ] **Step 2: Run tests**

Run: `cd apps/server && npx jest apps/gateway/src/im/websocket/websocket.gateway.spec.ts --no-coverage`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/server/apps/gateway/src/im/websocket/websocket.gateway.spec.ts
git commit -m "test(im): add unit tests for WebSocket gateway user room changes"
```

---

## Task 16: Regression — Delete sendToChannel, run all tests, fix

- [ ] **Step 1: Delete sendToChannel method from WebSocket gateway**

All call sites have been migrated (Tasks 5, 6, 7, 7b). Now delete the method entirely from `websocket.gateway.ts` (lines 802-804).

- [ ] **Step 2: Run all server tests**

Run: `cd apps/server && pnpm test`
Expected: PASS. If any tests fail, update mocks for removed `sendToChannel` method and new service dependencies.

- [ ] **Step 2: Run all client tests**

Run: `cd apps/client && pnpm test`
Expected: PASS

- [ ] **Step 3: Fix any failing tests**

Update test mocks that reference `sendToChannel` to use `sendToChannelMembers`.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix(tests): update test mocks for user room delivery architecture"
```

---

## Task 17: Final verification — Build check

- [ ] **Step 1: Build server**

Run: `pnpm build:server`
Expected: SUCCESS with no TypeScript errors

- [ ] **Step 2: Build client**

Run: `pnpm build:client`
Expected: SUCCESS with no TypeScript errors

- [ ] **Step 3: Fix any build errors and commit**

```bash
git add -A
git commit -m "fix: resolve build errors from user room delivery migration"
```

---

## Dependency Graph

```
Task 1 (CacheService) ──┐
Task 2 (SeqService)  ───┤
                        ├─→ Task 3 (Gateway methods) ─→ Task 4 (handleConnection) ─→ Task 5 (event handlers)
                        │                                                            ↓
                        ├─→ Task 8 (channels.service cache invalidation)          Task 6 (messages.controller)
                        │                                                          Task 7 (channels.controller)
                        │                                                          Task 7b (workspace.service)
                        ├─→ Task 9 (edit/delete seqId)
                        ├─→ Task 10 (sync service)
                        └─→ Task 11 (ConnectionService)

Task 8 must complete before Task 7 (member removal needs cache invalidation)

Task 12 (client WS) ────── independent, can run in parallel with server tasks
Task 13 (client sync) ──── depends on Task 10 (type changes)

Task 14 (integration) ──── depends on Tasks 1-11
Task 15 (unit tests) ───── depends on Tasks 3-5
Task 16 (regression) ───── depends on all above, deletes sendToChannel method
Task 17 (build check) ──── final gate
```

Tasks 1-2 can run in parallel. Tasks 6-11 can run in parallel after Task 5. Task 12 is independent of server tasks.
