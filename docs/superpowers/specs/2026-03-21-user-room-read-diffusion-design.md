# User Room Delivery Architecture

**Date:** 2026-03-21
**Status:** Approved
**Scope:** WebSocket message delivery model overhaul — replace channel room broadcast with user room delivery

## Problem Statement

The current WebSocket architecture uses a **channel room model**: when a user connects, the Gateway joins them into every channel room they belong to. This creates:

- **High connection cost**: O(k) join operations per connect, where k = number of channels
- **Wasted Redis memory**: inactive channels still occupy room membership records
- **Reconnection overhead**: every reconnect repeats the full join cycle

As the platform grows to support large numbers of low-frequency channels (e.g., per-task/bot channels), this model scales poorly — most rooms will be idle, yet every online user pays the cost of maintaining membership in all of them.

## Solution: User Room Delivery

Replace the channel room model with a **user room model**. Each user joins a single `user:{userId}` room on connect. Messages are delivered by querying channel membership and pushing to individual user rooms.

### Event Classification

**All channel-scoped events** are delivered via `sendToChannelMembers` at the Gateway layer. The IM Worker is NOT involved in real-time delivery — it only handles persistence (via gRPC `createAndPersist`) and post-processing (via PostBroadcastTask).

**Important context:** The current `gRPC createMessage` → Worker path only calls `createAndPersist()` for DB storage + Outbox creation. It does NOT invoke `MessageRouterService` for delivery. The `PostBroadcastService` only handles unread counts, notifications, and bot webhooks — NOT message delivery. Therefore, the Gateway's `sendToChannel` is currently the **sole real-time delivery mechanism**. This refactor replaces it with `sendToChannelMembers`.

| Category              | Events                                                                                                 | Delivery Path                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| **Channel-scoped**    | `new_message`, `message_updated`, `message_deleted`, `typing`, `streaming`, `reactions`, `read_status` | Gateway → ChannelMemberCacheService → `sendToChannelMembers` → user room |
| **Channel lifecycle** | `channel_updated`, `channel_joined`, `channel_left`                                                    | Gateway → ChannelMemberCacheService → `sendToChannelMembers` → user room |
| **Unaffected**        | `user_online`, `user_offline`, `user_status_changed`, `workspace_member_*`, `task:*`, `notification_*` | Already use workspace room / `sendToUser` — no changes needed            |

**Sender inclusion policy** — each call site decides:

| Event             | Include sender? | Reason                                             |
| ----------------- | --------------- | -------------------------------------------------- |
| `new_message`     | Yes             | Multi-device: other devices of sender must receive |
| `message_updated` | Yes             | Multi-device consistency                           |
| `message_deleted` | Yes             | Multi-device consistency                           |
| `typing`          | No              | Sender doesn't need their own typing indicator     |
| `streaming`       | Yes             | Sender is a bot, all users need to see it          |
| `reactions`       | Yes             | All members including reactor                      |
| `read_status`     | Yes             | All members                                        |
| `channel_updated` | Yes             | All members                                        |

**Special case — `streaming_end`:** The streaming end handler may emit both `STREAMING.END` and `MESSAGE.NEW`. Both use `sendToChannelMembers` — the `new_message` is already persisted by the bot's HTTP call, this is just notification delivery.

### Edit/Delete Consistency Model

**Problem:** Current edit/delete operations do NOT advance `seqId`, and the sync service filters out deleted messages (`isDeleted = false`). If a client misses a `message_updated` or `message_deleted` event, there is no recovery path — incremental sync will not surface the change.

**Fix (included in this refactor):**

1. **Edit/delete advance seqId:** When a message is edited or deleted, generate a new channel seqId and update the message record. This ensures the change appears in incremental sync.

```typescript
// messages.service.ts - update method
const newSeqId = await this.sequenceService.generateChannelSeq(channelId);
await this.db.update(schema.messages).set({
  content: dto.content,
  isEdited: true,
  updatedAt: new Date(),
  seqId: newSeqId, // advance seqId so sync picks it up
});
```

```typescript
// messages.service.ts - delete method
const newSeqId = await this.sequenceService.generateChannelSeq(channelId);
await this.db.update(schema.messages).set({
  isDeleted: true,
  deletedAt: new Date(),
  updatedAt: new Date(),
  seqId: newSeqId, // advance seqId so sync picks it up
});
```

2. **Sync returns deleted messages:** Remove the `isDeleted = false` filter from sync queries. Clients receive deleted message records and can remove them from local cache.

```typescript
// sync.service.ts - remove isDeleted filter
const messages = await this.db
  .select()
  .from(schema.messages)
  .where(
    and(
      eq(schema.messages.channelId, channelId),
      gt(schema.messages.seqId, afterSeqId),
      // REMOVED: eq(schema.messages.isDeleted, false)
    ),
  )
  .orderBy(schema.messages.seqId)
  .limit(limit + 1);
```

3. **Client sync merge rewrite (`useSyncChannel.ts`):** The current merge logic has two gaps that break edit/delete recovery:
   - **Gap A:** Existing message IDs are skipped (`existingIds.has(msg.id)` → skip). An edited message returns with the same ID but updated content — it must **replace** the local version, not be skipped.
   - **Gap B:** Thread replies are filtered out (`filter(item => !item.parentId)`). Edit/delete of thread messages has no recovery path.

   **New merge logic:**

   ```typescript
   // Partition synced messages by type
   const deletedIds = new Set(
     syncedMessages.filter((m) => m.isDeleted).map((m) => m.id),
   );
   const mainMessages = syncedMessages
     .filter((m) => !m.parentId && !m.isDeleted)
     .map(syncItemToMessage);
   const threadMessages = syncedMessages
     .filter((m) => m.parentId && !m.isDeleted)
     .map(syncItemToMessage);

   // Main message cache: remove deleted, replace updated, append new
   queryClient.setQueriesData({ queryKey: ["messages", channelId] }, (old) => {
     // 1. Remove deleted messages
     // 2. Replace existing messages that have been edited (same ID, new content)
     // 3. Append genuinely new messages
     const existingById = new Map(allExistingMsgs.map((m) => [m.id, m]));

     const merged = allExistingMsgs
       .filter((m) => !deletedIds.has(m.id)) // remove deleted
       .map((m) => mainMessages.find((s) => s.id === m.id) || m); // replace edited

     const newMessages = mainMessages.filter((m) => !existingById.has(m.id)); // append new
     return rebuildPages([...newMessages, ...merged]);
   });

   // Thread caches: same logic per parentId/rootId
   const threadsByParent = groupBy(
     threadMessages,
     (m) => m.parentId || m.rootId,
   );
   for (const [parentId, msgs] of threadsByParent) {
     queryClient.setQueriesData({ queryKey: ["thread", parentId] }, (old) => {
       // Same delete/replace/append logic
     });
   }

   // Thread deleted messages
   const deletedThreadMsgs = syncedMessages.filter(
     (m) => m.parentId && m.isDeleted,
   );
   for (const msg of deletedThreadMsgs) {
     queryClient.setQueriesData(
       { queryKey: ["thread", msg.parentId] },
       (old) => {
         // Remove deleted thread messages from cache
       },
     );
   }
   ```

   **`syncItemToMessage` also needs updating:** Currently hardcodes `isDeleted: false` (line 20). Must pass through the actual value from sync response.

### Public Channel Preview

**Decision:** After this refactor, public channel preview for non-members is **history-only**. Non-members can still fetch message history via REST API but will NOT receive real-time events (`new_message`, `typing`, etc.) since they are not in the channel member list used by `sendToChannelMembers`.

The `handleJoinChannel` handler becomes a no-op for room management. The preview UI should note this limitation. If real-time preview is needed in the future, it can be implemented by adding a separate "preview subscribers" list to `ChannelMemberCacheService`.

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│  Message Creation (HTTP)                                          │
│                                                                   │
│  Client HTTP POST /channels/:id/messages                          │
│       ↓                                                           │
│  Gateway MessagesController                                       │
│       ├── gRPC createMessage → IM Worker (persist only, no route) │
│       ├── sendToChannelMembers → user rooms (real-time delivery)  │
│       └── publishPostBroadcast → RabbitMQ (unread, notifications) │
│                                                                   │
├──────────────────────────────────────────────────────────────────┤
│  All Other Channel Events (WS)                                    │
│                                                                   │
│  Client WS emit (typing_start, add_reaction, etc.)                │
│       ↓                                                           │
│  Gateway WebSocket handler                                        │
│       ├── ChannelMemberCacheService.getMemberIds()                 │
│       └── server.to(`user:${userId}`).emit(event, data)           │
│           (for each member, via Redis Adapter cross-node)          │
└──────────────────────────────────────────────────────────────────┘
```

**Key insight:** ALL real-time delivery goes through Gateway `sendToChannelMembers`. The IM Worker is a persistence-only service for message creation — it does NOT route or deliver messages.

## Detailed Design

### 1. Connection Lifecycle

**Current:**

```
connect → verify token → register session → join ALL channel rooms → join workspace room → broadcast online
```

**New:**

```
connect → verify token → register session → join user:{userId} room → join workspace room → broadcast online
```

#### handleConnection changes

```typescript
// Remove (current lines ~235-250)
const channels = await this.channelsService.getUserChannels(userId);
for (const channel of channels) {
  client.join(`channel:${channel.id}`);
}

// Replace with
client.join(`user:${userId}`);
```

#### handleDisconnect changes

- No explicit channel room leave needed (Socket.io auto-cleans on disconnect)
- Retain: session cleanup, offline broadcast, bot stream cleanup
- User room membership auto-removed on socket disconnect

#### Multi-device behavior

Multiple sockets for the same user all join `user:{userId}` room:

```
Device A (socket-1) → join user:abc  ─┐
Device B (socket-2) → join user:abc  ─┤→ user:abc room has 2 sockets
                                      │
server.to("user:abc").emit(...)  ─────┘  both devices receive
```

This replaces the current `sendToUser` pattern (iterating USER_SOCKETS) with native Socket.io room broadcast.

#### sendToUser migration

The existing `WebsocketGateway.sendToUser()` method iterates `REDIS_KEYS.USER_SOCKETS` to find socket IDs and emits to each individually. Refactor to:

```typescript
sendToUser(userId: string, event: string, data: unknown) {
  this.server.to(`user:${userId}`).emit(event, data);
}
```

Callers of `sendToUser` (e.g., `NotificationDeliveryService.deliverToUser()`) continue to work unchanged — only the internal implementation changes.

#### Legacy Redis keys (USER_SOCKETS, SOCKET_USER)

These keys are **retained** for now. `SessionService` and other services (e.g., `NotificationDeliveryService.isUserOnline()`) still use them for online-status checks. These can be migrated to check user room membership in a follow-up, but are not part of this refactor's scope to avoid unnecessary blast radius.

#### join_channel / leave_channel events

Remove room join/leave operations from these handlers. Keep business logic (permission checks, member change notifications). Add deprecation warning log for client compatibility:

```typescript
@SubscribeMessage(WS_EVENTS.CHANNEL.JOIN)
handleJoinChannel(client: SocketWithUser, data: { channelId: string }) {
  this.logger.warn(`Deprecated: join_channel from ${client.userId}, ignoring room join`);
  // No-op for room management
}
```

### 2. Ephemeral Event Delivery

#### New service: ChannelMemberCacheService

```typescript
const CACHE_KEY = (channelId: string) =>
  `im:cache:channel_members:${channelId}`;
const CACHE_TTL = 300; // 5 minutes

class ChannelMemberCacheService {
  async getMemberIds(channelId: string): Promise<string[]>;
  async invalidate(channelId: string): Promise<void>;
}
```

**Cache invalidation triggers:**

- User joins/leaves a channel
- User is removed from a channel
- Channel is deleted/archived

**Cache stampede prevention:** Concurrent requests for the same uncached channel should coalesce into a single DB query. Implementation: use a per-key in-flight `Promise` map — if a load is already in progress for a channelId, subsequent callers await the same promise instead of issuing a new DB query.

```typescript
private inflightLoads = new Map<string, Promise<string[]>>();

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
```

#### New method: sendToChannelMembers

```typescript
async sendToChannelMembers(
  channelId: string,
  event: string,
  data: unknown,
  excludeUserId?: string,
) {
  const memberIds = await this.channelMemberCacheService.getMemberIds(channelId);
  for (const userId of memberIds) {
    if (userId === excludeUserId) continue;
    this.server.to(`user:${userId}`).emit(event, data);
  }
}
```

#### Event handler changes

All ephemeral events replace `this.server.to(\`channel:${channelId}\`).emit(...)`with`this.sendToChannelMembers(channelId, event, data, excludeUserId?)`:

- **Typing**: exclude sender (sender doesn't need their own typing indicator)
- **Streaming**: include all members (sender is a bot, other users need to see it)
- **Reactions**: include all members (including the reactor)
- **Read Status**: include all members
- **Channel lifecycle** (`channel_updated`, `channel_joined`, `channel_left`): include all members
- **Bot stream cleanup** (`cleanupBotStreams` on bot disconnect): `STREAMING.ABORT` uses `sendToChannelMembers`

#### Error handling

Ephemeral events are loss-tolerant by definition. If `ChannelMemberCacheService` throws (Redis down + DB unreachable), the event handler should **catch and log**, not propagate the error to the client:

```typescript
async sendToChannelMembers(channelId: string, event: string, data: unknown, excludeUserId?: string) {
  try {
    const memberIds = await this.channelMemberCacheService.getMemberIds(channelId);
    for (const userId of memberIds) {
      if (userId === excludeUserId) continue;
      this.server.to(`user:${userId}`).emit(event, data);
    }
  } catch (error) {
    this.logger.error(`Failed to deliver ${event} to channel ${channelId}: ${error.message}`);
  }
}
```

#### Performance impact

Streaming content (highest frequency ephemeral event, one per token):

- Redis GET for member cache: ~0.1-0.5ms
- 50 member channel, 50x `server.to(user room).emit()`: ~1-2ms
- **Total additional latency: ~2ms** — imperceptible for streaming

### 3. Message Delivery Changes

#### Message creation flow

**Current:**

```
HTTP POST → gRPC createMessage (persist) → sendToChannel broadcast → PostBroadcastTask
```

**New:**

```
HTTP POST → gRPC createMessage (persist) → sendToChannelMembers → PostBroadcastTask
```

The only change is replacing `sendToChannel` (channel room broadcast) with `sendToChannelMembers` (user room delivery). The gRPC persistence path and PostBroadcastTask are unchanged.

```typescript
// messages.controller.ts
// Current
if (!dto.skipBroadcast) {
  this.websocketGateway.sendToChannel(
    channelId,
    WS_EVENTS.MESSAGE.NEW,
    message,
  );
}

// New — include sender for multi-device consistency
if (!dto.skipBroadcast) {
  await this.websocketGateway.sendToChannelMembers(
    channelId,
    WS_EVENTS.MESSAGE.NEW,
    message,
  );
  // No excludeUserId — sender's other devices need this
}
```

#### message_updated / message_deleted

Same pattern — replace `sendToChannel` with `sendToChannelMembers`:

```typescript
// messages.controller.ts - update
await this.websocketGateway.sendToChannelMembers(
  channelId,
  WS_EVENTS.MESSAGE.UPDATED,
  updatedMessage,
);

// messages.controller.ts - delete
await this.websocketGateway.sendToChannelMembers(
  channelId,
  WS_EVENTS.MESSAGE.DELETED,
  { messageId, channelId },
);
```

Both include the sender (no `excludeUserId`) for multi-device consistency.

#### streaming_end special case

The `handleStreamingEnd` method emits both `STREAMING.END` and potentially `MESSAGE.NEW`. Both use `sendToChannelMembers`:

```typescript
await this.sendToChannelMembers(
  channelId,
  WS_EVENTS.STREAMING.END,
  streamEndPayload,
);
if (data.message) {
  await this.sendToChannelMembers(
    channelId,
    WS_EVENTS.MESSAGE.NEW,
    data.message,
  );
}
```

#### ConnectionService downstream message handling

The existing RabbitMQ downstream path (used by the legacy `MessageRouterService`) is updated to use user rooms instead of individual socket IDs:

```typescript
// Current: iterate socketIds
for (const socketId of socketIds) {
  this.server.to(socketId).emit(event, fullMessage);
}

// New: push to user rooms
for (const userId of targetUserIds) {
  this.server.to(`user:${userId}`).emit(event, fullMessage);
}
```

#### PostBroadcastTask role (unchanged)

PostBroadcastTask continues to handle post-processing only:

- Unread count updates
- Push notifications (mentions, DM, replies)
- Bot webhooks
- Outbox completion

It was never responsible for message delivery and remains unchanged.

#### Delivery guarantees

Same as current fast path — fire-and-forget from Gateway. If a client misses a message:

- User offline → message not delivered via WS → caught by seqId incremental sync on reconnect/channel open
- User online but WS hiccup → same recovery via incremental sync

#### Latency impact

```
Current: Gateway sendToChannel (channel room broadcast) ~1ms
New: Gateway sendToChannelMembers (member cache lookup + user room emit) ~2-3ms
```

The ~1-2ms delta comes from the Redis cache lookup for channel members. No Worker round-trip is involved — this is a Gateway-local operation, same as typing/streaming delivery.

### 4. Socket.io Redis Adapter

**Decision: Retain Redis Adapter, but only for user room + workspace room broadcast.**

Rationale:

- Ephemeral events need cross-node delivery with minimal latency
- `server.to(\`user:${userId}\`).emit()` works transparently across nodes via Redis Adapter
- User room count = online user count, far smaller than previous channel room count — Pub/Sub load drops significantly
- Removing the adapter would require routing ephemeral events through RabbitMQ, adding 3-5ms latency

**Final architecture:**

```
All channel events: Gateway → sendToChannelMembers → Redis Adapter → user room (cross-node auto-sync)
IM Worker: persistence only (gRPC createAndPersist) + post-processing (PostBroadcastTask via RabbitMQ)
```

### 5. Client-Side Changes

#### WebSocket service changes

**Remove:**

- `pendingChannelJoins: Set<string>` and all related logic
- `joinChannel(channelId)` method
- `leaveChannel(channelId)` method
- `processPendingJoins()` method
- All component-level `joinChannel`/`leaveChannel` calls

**Retain (unchanged):**

- Connection, reconnection, authentication
- Event listeners (new_message, typing, streaming, etc.)
- Heartbeat ping
- Pending listeners queue

#### Reconnection behavior

```
Current: reconnect → server re-joins all channel rooms
New: reconnect → server joins user room only → client pulls incremental messages for active channels
```

The existing seqId incremental sync mechanism becomes more important after this change.

### 6. Data Migration & Deployment

#### Redis state

| Data                              | Migration                                             | Risk                        |
| --------------------------------- | ----------------------------------------------------- | --------------------------- |
| Socket.io channel room data       | No migration needed — expires naturally after restart | None                        |
| Socket.io Redis Adapter data      | Retained for user room, old channel room data expires | None                        |
| SessionService user route/session | Unchanged                                             | None                        |
| New member cache keys             | Cold start from DB on first access                    | Slightly slower first query |

#### Deployment strategy: Stop-and-deploy (recommended)

```
1. Announce brief maintenance window (2-3 minutes)
2. Stop all Gateway nodes
3. Deploy new version
4. Start all nodes
5. Users auto-reconnect → join user room → everything works
```

Rationale: Current user base is small enough for a maintenance window. Rolling deployment introduces incompatibility between old (channel room) and new (user room) nodes where ephemeral events would be lost during the transition.

#### Client version compatibility

Old clients will still emit `join_channel`/`leave_channel`. Server handles gracefully:

- Keep handlers but make them no-op with deprecation warning log
- Socket.io silently ignores emits to non-existent handlers
- Remove deprecated handlers in a subsequent release

## Rollback Plan

If the new model has issues in production:

1. Redeploy the previous version (stop-and-deploy, same as the forward deployment)
2. Users auto-reconnect → old version re-joins channel rooms → everything reverts
3. No data migration to undo — Redis state is ephemeral, DB schema is unchanged
4. New `im:cache:channel_members:*` keys will expire naturally (TTL 5 minutes)

The clean-break deployment strategy makes rollback trivial.

## Testing Strategy

### Unit Tests

**1. ChannelMemberCacheService (new service, critical)**

| Test Case            | Description                                                        |
| -------------------- | ------------------------------------------------------------------ |
| Cache miss → DB load | Fetches from DB and stores in Redis on cache miss                  |
| Cache hit            | Returns cached data without DB query                               |
| Invalidation         | After invalidate(), next call reloads from DB                      |
| TTL expiry           | Expired cache triggers reload                                      |
| Empty channel        | Returns empty array, no errors                                     |
| DB failure           | Throws exception, does not cache dirty data                        |
| Stampede prevention  | Concurrent requests for same channel coalesce into single DB query |

**2. WebSocketGateway.sendToChannelMembers (new method)**

| Test Case            | Description                               |
| -------------------- | ----------------------------------------- |
| Normal delivery      | Iterates members, emits to each user room |
| Exclude sender       | excludeUserId correctly skipped           |
| Empty members        | No errors on empty member list            |
| Single member (DM)   | Delivers to one user                      |
| Large channel (100+) | All members receive                       |

**3. WebSocketGateway.handleConnection (modified)**

| Test Case           | Description                                    |
| ------------------- | ---------------------------------------------- |
| Join user room      | Socket joins `user:{userId}` room on connect   |
| Join workspace room | Socket joins workspace room on connect         |
| No channel rooms    | Socket is NOT in any `channel:*` room          |
| Multi-device        | Second socket joins same user room             |
| Bot token           | Bot authentication uses same user room pattern |

**4. WebSocketGateway.handleDisconnect (modified)**

| Test Case               | Description                                                     |
| ----------------------- | --------------------------------------------------------------- |
| Auto room cleanup       | User room membership removed on disconnect (Socket.io behavior) |
| Multi-device disconnect | One device disconnect doesn't affect other device's user room   |
| Bot stream cleanup      | Bot disconnect stream cleanup unaffected                        |

**5. Ephemeral event handlers**

| Event             | Test Cases                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------- |
| Typing            | Calls sendToChannelMembers, excludes sender                                                 |
| Streaming         | Calls sendToChannelMembers for start/content/thinking_content/end/abort                     |
| Streaming end     | Emits both STREAMING.END and MESSAGE.NEW via sendToChannelMembers when message data present |
| Reactions         | Calls sendToChannelMembers, includes all members                                            |
| Read Status       | Calls sendToChannelMembers, includes all members                                            |
| Channel lifecycle | channel_updated, channel_joined, channel_left use sendToChannelMembers                      |
| Bot cleanup       | cleanupBotStreams emits STREAMING.ABORT via sendToChannelMembers                            |
| Error resilience  | sendToChannelMembers catches and logs errors, does not propagate to client                  |

**6. sendToUser (refactored)**

| Test Case            | Description                                                      |
| -------------------- | ---------------------------------------------------------------- |
| Single device        | Emits to `user:{userId}` room                                    |
| Multi-device         | Single emit covers all sockets in user room                      |
| User offline         | No error when user room is empty                                 |
| NotificationDelivery | Existing callers continue to work with refactored implementation |

**7. ConnectionService downstream (modified)**

| Test Case          | Description                                                  |
| ------------------ | ------------------------------------------------------------ |
| User room delivery | Pushes to `user:{userId}` room instead of individual sockets |
| Missing user       | User not on this node — empty room emit, no error            |
| Multi-device       | Single user room emit covers all devices                     |

**8. Edit/delete seqId advancement**

| Test Case            | Description                                                           |
| -------------------- | --------------------------------------------------------------------- |
| Edit advances seq    | Editing a message generates a new seqId greater than the original     |
| Delete advances seq  | Deleting a message generates a new seqId greater than the original    |
| Sync returns edits   | Incremental sync after edit returns the message with updated content  |
| Sync returns deletes | Incremental sync after delete returns the message with isDeleted=true |

**9. Client sync merge (`useSyncChannel.ts`)**

| Test Case                          | Description                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------ |
| New messages appended              | Sync returns messages not in cache → appended to first page                    |
| Edited message replaced            | Sync returns message with existing ID but new content → local version replaced |
| Deleted message removed            | Sync returns message with isDeleted=true → removed from cache                  |
| Thread edit recovered              | Sync returns edited thread reply → thread cache updated                        |
| Thread delete recovered            | Sync returns deleted thread reply → removed from thread cache                  |
| Mixed batch                        | Sync returns new + edited + deleted in one batch → all handled correctly       |
| syncItemToMessage passes isDeleted | isDeleted field from sync response flows through, not hardcoded false          |

**10. Client WebSocket service**

| Test Case              | Description                              |
| ---------------------- | ---------------------------------------- |
| No joinChannel         | joinChannel/leaveChannel methods removed |
| No pendingChannelJoins | Pending joins queue removed              |
| Reconnection           | No channel re-join on reconnect          |
| Event listeners        | Still work without channel room joins    |

### Integration Tests

**1. Gateway WebSocket integration (NestJS TestingModule + Socket.io Client)**

```
Connection & authentication:
- Client connects → joins user room (verify socket.rooms)
- Client connects → joins workspace room
- Client connects → NOT in any channel room

Ephemeral event end-to-end:
- Client A sends typing_start → Client B (same channel) receives user_typing
- Client A sends typing_start → Client A does NOT receive it
- Client C (different channel) does NOT receive typing
- Streaming content → all channel members receive
- add_reaction → all channel members receive reaction_added

Member cache consistency:
- User joins channel → cache invalidated → new member receives subsequent events
- User leaves channel → cache invalidated → ex-member stops receiving events
```

**2. Message creation full-chain integration**

```
- HTTP POST create message → gRPC persist → sendToChannelMembers → all members receive via user room
- Sender's other devices receive the message (multi-device)
- Non-member does NOT receive the message
- Message content integrity (all fields preserved from creation to receipt)
- Message ordering (multiple messages in same channel ordered by seqId)
```

**3. Edit/delete consistency integration**

```
- Edit message → new seqId assigned → sendToChannelMembers delivers update
- Delete message → new seqId assigned → sendToChannelMembers delivers deletion
- Client reconnects → incremental sync returns edited message with isEdited=true
- Client reconnects → incremental sync returns deleted message with isDeleted=true → client removes from cache
```

### End-to-End Tests

**Using real Redis + RabbitMQ, simulating multi-user multi-device scenarios:**

```
Scenario 1: Basic message send/receive
- User A and User B in same channel
- A sends message → B receives via user room
- A's other devices also receive via user room (sender included in sendToChannelMembers)

Scenario 2: Multi-device
- User A online on device 1 and device 2
- B sends message → both of A's devices receive

Scenario 3: User isolation
- A and B in channel-1, C in channel-2
- A sends to channel-1 → B receives, C does NOT receive

Scenario 4: Ephemeral events
- A starts typing → B receives typing indicator → A stops → B receives stop
- Bot starts streaming → channel members receive content chunks in real-time → end

Scenario 5: Member changes
- A joins channel → cache invalidated → A receives new messages and ephemeral events
- A leaves channel → cache invalidated → A stops receiving

Scenario 6: Disconnect and reconnect
- A disconnects → B sends message → A reconnects → A pulls message via incremental sync
```

### Regression Tests

**Ensure refactor does not break existing functionality:**

```
1. Message functionality:
- Text/file/image/system message send/receive
- Message edit, delete (message_updated, message_deleted)
- Thread messages (parentId)
- Mention parsing

2. Online presence:
- User online/offline broadcast (via workspace room, unchanged)
- Multi-device online/offline logic

3. Bot functionality:
- Bot token authentication
- Bot streaming
- Bot disconnect stream cleanup

4. ACK and sync:
- message_ack
- seqId incremental sync (now includes edited/deleted messages)
- Edit/delete advances seqId correctly
- Sync returns isDeleted=true records, client removes them

5. Public channel preview:
- Non-member can fetch message history via REST
- Non-member does NOT receive real-time events

6. Notifications:
- Unread count updates
- Push notifications (PostBroadcastTask pipeline unchanged)
```

### Coverage Targets

| Module                    | Target |
| ------------------------- | ------ |
| ChannelMemberCacheService | > 95%  |
| sendToChannelMembers      | > 90%  |
| handleConnection changes  | > 90%  |
| ConnectionService changes | > 90%  |
| Ephemeral event handlers  | > 85%  |
| Client WebSocket changes  | > 80%  |

## Files Affected

### Server — Gateway

| File                                                 | Change                                                                                                                                                                        |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `im/websocket/websocket.gateway.ts`                  | Remove channel room joins, add user room join, add sendToChannelMembers, refactor sendToUser, update all ephemeral/channel-lifecycle event handlers, update cleanupBotStreams |
| `im/websocket/websocket.module.ts`                   | Add ChannelMemberCacheService provider                                                                                                                                        |
| `im/messages/messages.controller.ts`                 | Replace sendToChannel with sendToChannelMembers for new_message (remove fast path), message_updated, message_deleted                                                          |
| `im/channels/channels.controller.ts`                 | Replace sendToChannel with sendToChannelMembers for channel_updated, channel_joined events                                                                                    |
| `cluster/connection/connection.service.ts`           | Change downstream delivery from socketId to user room                                                                                                                         |
| `workspace/workspace.service.ts`                     | Replace sendToChannel with sendToChannelMembers for system messages (workspace join welcome)                                                                                  |
| **New:** `im/shared/channel-member-cache.service.ts` | Channel member cache with Redis + DB fallback + stampede prevention                                                                                                           |
| `im/channels/channels.service.ts`                    | Add cache invalidation calls on member changes                                                                                                                                |
| `im/messages/messages.service.ts`                    | Edit/delete methods: generate new seqId before updating                                                                                                                       |
| `im/sync/sync.service.ts`                            | Remove `isDeleted = false` filter from incremental sync query                                                                                                                 |

**Note on `sendToChannel`:** After migration, remove it entirely to avoid confusion.

### Server — IM Worker

| File                                | Change                                                             |
| ----------------------------------- | ------------------------------------------------------------------ |
| `message/message-router.service.ts` | No changes needed (not invoked in current HTTP createMessage path) |

### Client

| File                                                       | Change                                                                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `services/websocket/index.ts`                              | Remove joinChannel, leaveChannel, pendingChannelJoins, processPendingJoins                                          |
| Components calling joinChannel/leaveChannel                | Remove those calls                                                                                                  |
| `channel_created` listener calling `this.joinChannel(...)` | Remove the joinChannel call (keep the cache invalidation logic)                                                     |
| `hooks/useSyncChannel.ts`                                  | Rewrite merge logic: replace edited messages (don't skip), remove deleted, merge thread messages into thread caches |
| `hooks/useSyncChannel.ts` → `syncItemToMessage`            | Pass through `isDeleted` from sync response instead of hardcoding `false`                                           |

## Known Limitations & Future Work

- **REST `POST /channels/:id/read` does not broadcast `read_status_updated`** — only the WS `mark_as_read` handler does. This is a pre-existing issue not addressed in this refactor. Fix: add `sendToChannelMembers` call in the REST handler.
- **Public channel real-time preview** — non-members lose real-time events. Can be restored in the future via a "preview subscribers" list in `ChannelMemberCacheService`.
- **System messages are best-effort** — `sendSystemMessage()` inserts directly to DB without seqId and broadcasts via WS. If a client misses the event, incremental sync will NOT recover it (no seqId = not in sync range). This is acceptable given system messages are infrequent (channel join/leave only). Future fix: route through `createAndPersist` pipeline to assign seqId.

## Latency Summary

| Event Type        | Current          | After  | Delta                  |
| ----------------- | ---------------- | ------ | ---------------------- |
| Typing            | ~1ms             | ~2-3ms | +1-2ms (imperceptible) |
| Streaming content | ~1ms             | ~2-3ms | +1-2ms (imperceptible) |
| Reactions         | ~1ms             | ~2-3ms | +1-2ms (imperceptible) |
| New message       | ~1ms (fast path) | ~2-3ms | +1-2ms (imperceptible) |
| Message edit      | ~1ms             | ~2-3ms | +1-2ms (imperceptible) |
| Message delete    | ~1ms             | ~2-3ms | +1-2ms (imperceptible) |
