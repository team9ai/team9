# User Room + Read Diffusion WebSocket Architecture

**Date:** 2026-03-21
**Status:** Approved
**Scope:** WebSocket message delivery model overhaul

## Problem Statement

The current WebSocket architecture uses a **channel room model**: when a user connects, the Gateway joins them into every channel room they belong to. This creates:

- **High connection cost**: O(k) join operations per connect, where k = number of channels
- **Wasted Redis memory**: inactive channels still occupy room membership records
- **Reconnection overhead**: every reconnect repeats the full join cycle

As the platform grows to support large numbers of low-frequency channels (e.g., per-task/bot channels), this model scales poorly — most rooms will be idle, yet every online user pays the cost of maintaining membership in all of them.

## Solution: User Room + Read Diffusion

Replace the channel room model with a **user room model**. Each user joins a single `user:{userId}` room on connect. Messages are delivered by querying channel membership and pushing to individual user rooms.

### Event Classification

Events are split by persistence requirement:

| Category              | Events                                                                                                 | Delivery Path                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| **Persistent**        | `new_message`                                                                                          | Gateway → gRPC → IM Worker → query members → RabbitMQ → Gateway → user room |
| **Ephemeral**         | `typing`, `streaming`, `reactions`, `read_status`, `message_updated`, `message_deleted`                | Gateway → query member cache → user room (direct, no Worker)                |
| **Channel Lifecycle** | `channel_updated`, `channel_joined`, `channel_left`                                                    | Gateway → query member cache → user room (via sendToChannelMembers)         |
| **Unaffected**        | `user_online`, `user_offline`, `user_status_changed`, `workspace_member_*`, `task:*`, `notification_*` | Already use workspace room / sendToUser — no changes needed                 |

**Decision criterion: does the event need to be persisted AND routed through the Worker pipeline?**

- Only `new_message` → Worker pipeline (reliable, ordered, seqId assignment, traceable)
- Everything else → Gateway direct delivery via user room (low latency, loss-tolerant)

**Why `message_updated` and `message_deleted` are ephemeral:** These events are already persisted to DB by the time they are broadcast. They are low-frequency and loss-tolerant — if a client misses one, incremental sync (seqId-based) will catch it on next channel open. Building a new Worker pipeline for update/delete adds complexity with little benefit.

**Special case — `streaming_end`:** The streaming end handler may emit both `STREAMING.END` (ephemeral) and `MESSAGE.NEW` (persistent). The `new_message` within streaming_end must go through `sendToChannelMembers` to ensure delivery via user rooms, since the message is already persisted to DB by the bot's HTTP call. This is NOT routed through the Worker pipeline — it is a direct user-room broadcast of an already-persisted message.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  Persistent Events                                       │
│                                                          │
│  Client HTTP POST                                        │
│       ↓                                                  │
│  Gateway (no local broadcast)                            │
│       ↓ gRPC                                             │
│  IM Worker                                               │
│       ├── Store to DB (seqId)                            │
│       ├── Query channel members                          │
│       ├── Query user → gateway mapping                   │
│       └── RabbitMQ → target Gateway(s)                   │
│                 ↓                                         │
│  Gateway ConnectionService                               │
│       └── server.to(`user:${userId}`).emit(event, data)  │
│                                                          │
├──────────────────────────────────────────────────────────┤
│  Ephemeral Events                                        │
│                                                          │
│  Client WS emit (typing_start, add_reaction, etc.)       │
│       ↓                                                  │
│  Gateway WebSocket handler                               │
│       ├── ChannelMemberCacheService.getMemberIds()        │
│       └── server.to(`user:${userId}`).emit(event, data)  │
│           (for each member, via Redis Adapter cross-node) │
└──────────────────────────────────────────────────────────┘
```

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

### 3. Persistent Event Delivery

#### Message creation flow change

**Current (MessagesController):**

```
HTTP POST → gRPC createMessage → immediate sendToChannel broadcast → PostBroadcastTask
```

**New:**

```
HTTP POST → gRPC createMessage → IM Worker stores + routes → RabbitMQ → Gateway → user room
```

Key change in `MessagesController`:

```typescript
// Remove (lines ~151-157)
if (!dto.skipBroadcast) {
  this.websocketGateway.sendToChannel(
    channelId,
    WS_EVENTS.MESSAGE.NEW,
    message,
  );
}

// No replacement needed — IM Worker's MessageRouterService handles delivery
```

#### ConnectionService downstream message handling

```typescript
// Current: iterate socketIds
for (const socketId of socketIds) {
  this.server.to(socketId).emit(WS_EVENTS.MESSAGE.NEW, fullMessage);
}

// New: push to user rooms
for (const userId of targetUserIds) {
  this.server.to(`user:${userId}`).emit(WS_EVENTS.MESSAGE.NEW, fullMessage);
}
```

#### message_updated / message_deleted

These are reclassified as ephemeral. The Gateway controller already persists the update/delete to DB before broadcasting. Replace `sendToChannel` with `sendToChannelMembers`:

```typescript
// Current (messages.controller.ts)
this.websocketGateway.sendToChannel(
  channelId,
  WS_EVENTS.MESSAGE.UPDATED,
  updatedMessage,
);

// New
await this.websocketGateway.sendToChannelMembers(
  channelId,
  WS_EVENTS.MESSAGE.UPDATED,
  updatedMessage,
);
```

If a client misses these events, seqId incremental sync will provide the updated state on next channel open.

#### streaming_end special case

The `handleStreamingEnd` method emits both `STREAMING.END` and potentially `MESSAGE.NEW`. Both must use `sendToChannelMembers`:

```typescript
// Replace channel room broadcast with user room delivery
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

The `new_message` here is already persisted by the bot's HTTP call — this broadcast is just notification delivery.

#### PostBroadcastTask role

After this change, PostBroadcastTask becomes purely for business post-processing:

- Unread count updates
- Push notifications
- Outbox marking

It no longer supplements broadcast delivery.

#### Sender self-delivery

The current IM Worker's `MessageRouterService` excludes the sender from routing (`memberIds.filter(id => id !== userId)`). This was fine when the Gateway fast path broadcast to the channel room (sender was in the room and received it). After removing the fast path, the sender would not receive their own message via WebSocket.

**Decision:** The sender already receives the full message object in the HTTP response. The client can optimistically add it to the local cache. No change needed to IM Worker routing. Update the E2E test expectations accordingly — sender does NOT receive `new_message` via WebSocket, only via HTTP response.

#### Delivery guarantees

The Worker pipeline is more reliable than the current fire-and-forget fast path:

- User offline → not delivered → caught by seqId incremental sync on reconnect
- RabbitMQ delivery failure → dead letter queue → retryable
- Gateway receives but user disconnected → no impact, incremental sync on reconnect

#### Latency impact

```
Current fast path: Gateway direct broadcast ~1ms
New: Gateway → gRPC (~2ms) → IM Worker → Redis queries (~5ms) → RabbitMQ (~3ms) → Gateway → user room
Total: ~13-20ms
```

Acceptable for chat messages — user-perceived network latency is already 50-200ms.

### 4. Socket.io Redis Adapter

**Decision: Retain Redis Adapter, but only for user room + workspace room broadcast.**

Rationale:

- Ephemeral events need cross-node delivery with minimal latency
- `server.to(\`user:${userId}\`).emit()` works transparently across nodes via Redis Adapter
- User room count = online user count, far smaller than previous channel room count — Pub/Sub load drops significantly
- Removing the adapter would require routing ephemeral events through RabbitMQ, adding 3-5ms latency

**Final architecture:**

```
Persistent events: IM Worker → RabbitMQ precise routing → Gateway → user room (local)
Ephemeral events: Gateway → Redis Adapter → user room (cross-node auto-sync)
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

**8. Client WebSocket service**

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

**2. IM Worker routing integration**

```
- Message created → MessageRouterService queries members → groups by gateway → publishes to correct RabbitMQ queues
- Target user offline → no delivery, no error
- Multi-gateway scenario → messages correctly distributed to each node's queue
```

**3. Persistent event full-chain integration**

```
- HTTP POST create message → no Gateway direct broadcast → IM Worker routes → RabbitMQ → ConnectionService receives → user room delivery
- Message content integrity (all fields preserved from creation to receipt)
- Message ordering (multiple messages in same channel ordered by seqId)
```

### End-to-End Tests

**Using real Redis + RabbitMQ, simulating multi-user multi-device scenarios:**

```
Scenario 1: Basic message send/receive
- User A and User B in same channel
- A sends message → B receives via user room
- A receives the message in the HTTP response (NOT via WebSocket — sender excluded from Worker routing)

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
- seqId incremental sync

5. Notifications:
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

**Note on `sendToChannel`:** After migration, `sendToChannel` can be removed entirely OR reimplemented as a thin wrapper around `sendToChannelMembers` for backward compatibility during the transition. Recommended: remove it to avoid confusion.

### Server — IM Worker

| File                                | Change                                              |
| ----------------------------------- | --------------------------------------------------- |
| `message/message-router.service.ts` | No changes needed (already does user-level routing) |

### Client

| File                                                       | Change                                                                     |
| ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| `services/websocket/index.ts`                              | Remove joinChannel, leaveChannel, pendingChannelJoins, processPendingJoins |
| Components calling joinChannel/leaveChannel                | Remove those calls                                                         |
| `channel_created` listener calling `this.joinChannel(...)` | Remove the joinChannel call (keep the cache invalidation logic)            |

## Latency Summary

| Event Type        | Current          | After                      | Delta                  |
| ----------------- | ---------------- | -------------------------- | ---------------------- |
| Typing            | ~1ms             | ~2-3ms                     | +1-2ms (imperceptible) |
| Streaming content | ~1ms             | ~2-3ms                     | +1-2ms (imperceptible) |
| Reactions         | ~1ms             | ~2-3ms                     | +1-2ms (imperceptible) |
| New message       | ~1ms (fast path) | ~13-20ms (Worker pipeline) | +12-19ms (acceptable)  |
