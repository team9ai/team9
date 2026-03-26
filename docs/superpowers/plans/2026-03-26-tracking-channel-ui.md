# Tracking Channel UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render agent execution tracking as inline cards in group chat with frosted glass overlay, modal detail view with streaming, and supporting protocol changes.

**Architecture:** Backend adds `snapshot` column, streaming metadata, and `channel:observe` WebSocket handler. Agent-side `TrackingChannelObserver` is rewritten to use streaming API with `AgentEventMetadata`. Frontend renders `tracking` type messages as inline cards showing latest 3 events, with a modal for full execution log.

**Tech Stack:** NestJS, Drizzle ORM, PostgreSQL, React, TypeScript, Socket.io, TanStack React Query, Tailwind CSS

**Design Spec:** `docs/superpowers/specs/2026-03-26-tracking-channel-frontend-design.md`

---

## File Structure

### Backend (Team9 Server)

| Action | File                                                                | Responsibility                                          |
| ------ | ------------------------------------------------------------------- | ------------------------------------------------------- |
| Modify | `apps/server/libs/database/src/schemas/im/channels.ts`              | Add `snapshot` jsonb column                             |
| Modify | `apps/server/libs/database/src/schemas/im/messages.ts`              | Add `'tracking'` to messageTypeEnum                     |
| Create | DB migration                                                        | Migration for snapshot column + tracking message type   |
| Modify | `apps/server/apps/gateway/src/im/streaming/dto/streaming.dto.ts`    | Add `metadata` to `StartStreamingDto`                   |
| Modify | `apps/server/apps/gateway/src/im/streaming/streaming.controller.ts` | Broadcast metadata in `streaming_start`                 |
| Modify | `apps/server/apps/gateway/src/im/channels/channels.service.ts`      | Snapshot logic in `deactivateChannel`                   |
| Modify | `apps/server/apps/gateway/src/im/channels/channels.controller.ts`   | Include snapshot in deactivate broadcast                |
| Modify | `apps/server/apps/gateway/src/im/websocket/websocket.gateway.ts`    | `channel:observe` / `channel:unobserve` handlers        |
| Modify | `apps/server/libs/shared/src/events/event-names.ts`                 | Add `CHANNEL.OBSERVE` / `CHANNEL.UNOBSERVE` event names |

### Frontend (Client)

| Action | File                                                       | Responsibility                                                      |
| ------ | ---------------------------------------------------------- | ------------------------------------------------------------------- |
| Modify | `apps/client/src/types/im.ts`                              | Add `tracking` to ChannelType/MessageType, `isActivated` to Channel |
| Modify | `apps/client/src/types/ws-events.ts`                       | Add tracking event types, update StreamingStartEvent                |
| Modify | `apps/client/src/services/websocket/index.ts`              | Add observe/unobserve methods, tracking event listeners             |
| Create | `apps/client/src/hooks/useChannelObserver.ts`              | Hook for channel:observe lifecycle + reconnect                      |
| Create | `apps/client/src/hooks/useTrackingChannel.ts`              | Hook for tracking channel data (messages, streaming state)          |
| Create | `apps/client/src/components/channel/TrackingCard.tsx`      | Inline card component with frosted glass                            |
| Create | `apps/client/src/components/channel/TrackingModal.tsx`     | Modal detail view with execution log                                |
| Create | `apps/client/src/components/channel/TrackingEventItem.tsx` | Single execution event row (dot + label + content)                  |
| Modify | `apps/client/src/components/channel/MessageItem.tsx`       | Route `tracking` type messages to TrackingCard                      |
| Modify | `apps/client/src/hooks/useWebSocketEvents.ts`              | Handle tracking:deactivated event                                   |

### Agent (team9-agent-pi)

| Action | File                                                          | Responsibility                                             |
| ------ | ------------------------------------------------------------- | ---------------------------------------------------------- |
| Modify | `packages/claw-hive/src/runtime/tracking-channel-observer.ts` | Rewrite to use streaming API + metadata                    |
| Modify | `packages/claw-hive/src/components/team9/team9-api-client.ts` | Add metadata to startStreaming, fix lockChannel→deactivate |

---

## Task 1: Backend — Database Schema Changes

**Files:**

- Modify: `apps/server/libs/database/src/schemas/im/channels.ts:41`
- Modify: `apps/server/libs/database/src/schemas/im/messages.ts:16-21`

- [ ] **Step 1: Add `snapshot` column to channels schema**

In `apps/server/libs/database/src/schemas/im/channels.ts`, add after the `isActivated` line (line 41):

```typescript
    snapshot: jsonb('snapshot'),
```

Also add `jsonb` to the import from `drizzle-orm/pg-core` at the top of the file.

- [ ] **Step 2: Add `'tracking'` to message type enum**

In `apps/server/libs/database/src/schemas/im/messages.ts`, update the messageTypeEnum (lines 16-21):

```typescript
export const messageTypeEnum = pgEnum("message_type", [
  "text",
  "file",
  "image",
  "system",
  "tracking",
]);
```

- [ ] **Step 3: Generate and run migration**

```bash
pnpm db:generate
pnpm db:migrate
```

Verify migration file is created with:

- `ALTER TABLE "im_channels" ADD COLUMN "snapshot" jsonb;`
- `ALTER TYPE "public"."message_type" ADD VALUE 'tracking';`

- [ ] **Step 4: Commit**

```bash
git add apps/server/libs/database/
git commit -m "feat(db): add snapshot column to channels, tracking message type"
```

---

## Task 2: Backend — Streaming DTO Metadata Extension

**Files:**

- Modify: `apps/server/apps/gateway/src/im/streaming/dto/streaming.dto.ts`
- Modify: `apps/server/apps/gateway/src/im/streaming/streaming.controller.ts:84-119`

- [ ] **Step 1: Add metadata to StartStreamingDto**

Replace the full `StartStreamingDto` class in `apps/server/apps/gateway/src/im/streaming/dto/streaming.dto.ts`:

```typescript
import {
  IsString,
  IsUUID,
  IsOptional,
  IsNotEmpty,
  IsObject,
  MaxLength,
} from "class-validator";

export class StartStreamingDto {
  @IsUUID()
  @IsOptional()
  parentId?: string;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}
```

- [ ] **Step 2: Store and broadcast metadata in streaming controller**

In `apps/server/apps/gateway/src/im/streaming/streaming.controller.ts`, update the `startStreaming` method. Change the Redis session storage (lines 88-96) to include metadata:

```typescript
await this.redisService.set(
  REDIS_KEYS.STREAMING_SESSION(streamId),
  JSON.stringify({
    channelId,
    senderId: userId,
    parentId: dto.parentId,
    metadata: dto.metadata,
    startedAt,
  }),
  STREAM_TTL,
);
```

And update the broadcast payload (lines 109-118) to include metadata:

```typescript
this.websocketGateway.sendToChannelMembers(
  channelId,
  WS_EVENTS.STREAMING.START,
  {
    streamId,
    channelId,
    senderId: userId,
    parentId: dto.parentId,
    metadata: dto.metadata,
    startedAt,
  },
);
```

- [ ] **Step 3: Commit**

```bash
git add apps/server/apps/gateway/src/im/streaming/
git commit -m "feat(streaming): add metadata field to StartStreamingDto and broadcast"
```

---

## Task 3: Backend — Deactivate with Snapshot

**Files:**

- Modify: `apps/server/apps/gateway/src/im/channels/channels.service.ts:802-820`
- Modify: `apps/server/apps/gateway/src/im/channels/channels.controller.ts:405-430`

- [ ] **Step 1: Update deactivateChannel to write snapshot**

In `apps/server/apps/gateway/src/im/channels/channels.service.ts`, replace the `deactivateChannel` method (lines 802-820):

```typescript
  async deactivateChannel(channelId: string): Promise<{
    snapshot: {
      totalMessageCount: number;
      latestMessages: Array<{
        id: string;
        content: string | null;
        metadata: Record<string, unknown> | null;
        createdAt: Date;
      }>;
    };
  }> {
    const channel = await this.findById(channelId);
    if (!channel) {
      throw new NotFoundException('Channel not found');
    }
    if (channel.type !== 'tracking' && channel.type !== 'task') {
      throw new ForbiddenException(
        'Only tracking and task channels can be deactivated',
      );
    }
    if (!channel.isActivated) {
      // Already deactivated — return existing snapshot
      return { snapshot: channel.snapshot as any ?? { totalMessageCount: 0, latestMessages: [] } };
    }

    // Query latest 3 messages and total count
    const [latestMessages, countResult] = await Promise.all([
      this.db
        .select({
          id: schema.messages.id,
          content: schema.messages.content,
          metadata: schema.messages.metadata,
          createdAt: schema.messages.createdAt,
        })
        .from(schema.messages)
        .where(eq(schema.messages.channelId, channelId))
        .orderBy(desc(schema.messages.createdAt))
        .limit(3),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.messages)
        .where(eq(schema.messages.channelId, channelId)),
    ]);

    const snapshot = {
      totalMessageCount: countResult[0]?.count ?? 0,
      latestMessages: latestMessages.reverse(), // oldest first
    };

    await this.db
      .update(schema.channels)
      .set({
        isActivated: false,
        snapshot: snapshot,
        updatedAt: new Date(),
      })
      .where(eq(schema.channels.id, channelId));

    await this.redis.invalidate(REDIS_KEYS.CHANNEL_CACHE(channelId));

    return { snapshot };
  }
```

Add `desc` and `sql` to the drizzle-orm imports at the top of the file if not already present.

- [ ] **Step 2: Update deactivate controller to broadcast snapshot**

In `apps/server/apps/gateway/src/im/channels/channels.controller.ts`, replace the deactivateChannel method (lines 405-430):

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

    const isBot = await this.channelsService.isBot(userId);
    if (!isBot) {
      throw new ForbiddenException('Only bots can deactivate channels');
    }

    const { snapshot } = await this.channelsService.deactivateChannel(channelId);

    await this.websocketGateway.sendToChannelMembers(
      channelId,
      WS_EVENTS.TRACKING.DEACTIVATED,
      { channelId, snapshot },
    );

    return { success: true };
  }
```

- [ ] **Step 3: Commit**

```bash
git add apps/server/apps/gateway/src/im/channels/
git commit -m "feat(channels): write snapshot on deactivate, broadcast in event"
```

---

## Task 4: Backend — channel:observe / channel:unobserve WebSocket Handlers

**Files:**

- Modify: `apps/server/libs/shared/src/events/event-names.ts`
- Modify: `apps/server/apps/gateway/src/im/websocket/websocket.gateway.ts`

- [ ] **Step 1: Add event names**

In `apps/server/libs/shared/src/events/event-names.ts`, add a `CHANNEL` group after the `TRACKING` group (around line 228):

```typescript
  CHANNEL: {
    /** Client requests to observe a channel (temporary subscription for non-members) */
    OBSERVE: 'channel:observe',
    /** Client requests to stop observing a channel */
    UNOBSERVE: 'channel:unobserve',
  },
```

- [ ] **Step 2: Add WebSocket handlers**

In `apps/server/apps/gateway/src/im/websocket/websocket.gateway.ts`, add two new handlers. Add them after the existing streaming handlers (around line 1011):

```typescript
  // ── channel:observe / channel:unobserve ────────────────────────

  @SubscribeMessage(WS_EVENTS.CHANNEL.OBSERVE)
  async handleChannelObserve(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { channelId: string },
  ): Promise<void> {
    const user = (client as SocketWithUser).user;
    if (!user) return;

    const { channelId } = data;
    if (!channelId) return;

    // Permission check: user must be in the same tenant as the channel
    const channel = await this.channelsService.findById(channelId);
    if (!channel) return;

    const isSameTenant = await this.channelsService.isUserInTenant(
      user.userId,
      channel.tenantId,
    );
    if (!isSameTenant) return;

    // Join the channel room for this socket only
    client.join(channelId);
  }

  @SubscribeMessage(WS_EVENTS.CHANNEL.UNOBSERVE)
  async handleChannelUnobserve(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { channelId: string },
  ): Promise<void> {
    const { channelId } = data;
    if (!channelId) return;

    client.leave(channelId);
  }
```

Note: `isUserInTenant` may need to be added to `ChannelsService` if it doesn't exist. Check and add a simple query:

```typescript
  async isUserInTenant(userId: string, tenantId: string): Promise<boolean> {
    const result = await this.db
      .select({ id: schema.tenantMembers.id })
      .from(schema.tenantMembers)
      .where(
        and(
          eq(schema.tenantMembers.userId, userId),
          eq(schema.tenantMembers.tenantId, tenantId),
        ),
      )
      .limit(1);
    return result.length > 0;
  }
```

- [ ] **Step 3: Commit**

```bash
git add apps/server/libs/shared/ apps/server/apps/gateway/src/im/websocket/ apps/server/apps/gateway/src/im/channels/channels.service.ts
git commit -m "feat(ws): add channel:observe/unobserve for temporary subscriptions"
```

---

## Task 5: Frontend — Type Updates

**Files:**

- Modify: `apps/client/src/types/im.ts:3,4,23-36`
- Modify: `apps/client/src/types/ws-events.ts`

- [ ] **Step 1: Update ChannelType and MessageType**

In `apps/client/src/types/im.ts`, update line 3-4:

```typescript
export type ChannelType = "direct" | "public" | "private" | "task" | "tracking";
export type MessageType = "text" | "file" | "image" | "system" | "tracking";
```

- [ ] **Step 2: Add isActivated and snapshot to Channel interface**

In `apps/client/src/types/im.ts`, update the Channel interface (lines 23-36). Add after `isArchived`:

```typescript
export interface Channel {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  avatarUrl?: string;
  type: ChannelType;
  createdBy: string;
  sectionId?: string | null;
  order: number;
  isArchived: boolean;
  isActivated: boolean;
  snapshot?: ChannelSnapshot | null;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 3: Add AgentEventMetadata and ChannelSnapshot types**

In `apps/client/src/types/im.ts`, add after the `ChannelType`/`MessageType` lines (around line 7):

```typescript
export interface AgentEventMetadata {
  agentEventType:
    | "thinking"
    | "writing"
    | "tool_call"
    | "tool_result"
    | "agent_start"
    | "agent_end"
    | "error"
    | "turn_separator";
  status: "running" | "completed" | "failed";
  toolName?: string;
  success?: boolean;
}

export interface ChannelSnapshot {
  totalMessageCount: number;
  latestMessages: Array<{
    id: string;
    content: string;
    metadata: AgentEventMetadata;
    createdAt: string;
  }>;
}
```

- [ ] **Step 4: Add tracking event types to ws-events.ts**

In `apps/client/src/types/ws-events.ts`, add tracking deactivated/activated event interfaces (near the existing streaming event types):

```typescript
export interface TrackingDeactivatedEvent {
  channelId: string;
  snapshot: {
    totalMessageCount: number;
    latestMessages: Array<{
      id: string;
      content: string;
      metadata: Record<string, unknown>;
      createdAt: string;
    }>;
  };
}

export interface TrackingActivatedEvent {
  channelId: string;
}
```

Also update `StreamingStartEvent` to include `metadata`:

```typescript
export interface StreamingStartEvent {
  streamId: string;
  channelId: string;
  senderId: string;
  parentId?: string;
  metadata?: Record<string, unknown>;
  startedAt: number;
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/types/
git commit -m "feat(types): add tracking channel types, AgentEventMetadata, ChannelSnapshot"
```

---

## Task 6: Frontend — WebSocket Observe Infrastructure

**Files:**

- Modify: `apps/client/src/services/websocket/index.ts`
- Create: `apps/client/src/hooks/useChannelObserver.ts`

- [ ] **Step 1: Add observe/unobserve methods to WebSocket service**

In `apps/client/src/services/websocket/index.ts`, add methods near the end of the class (following the existing `onStreamingStart`/`offStreamingStart` pattern):

```typescript
  // ── Channel Observe ──────────────────────────────

  observeChannel(channelId: string): void {
    this.emit(WS_EVENTS.CHANNEL.OBSERVE, { channelId });
  }

  unobserveChannel(channelId: string): void {
    this.emit(WS_EVENTS.CHANNEL.UNOBSERVE, { channelId });
  }

  // ── Tracking Events ──────────────────────────────

  onTrackingDeactivated(callback: (event: TrackingDeactivatedEvent) => void): void {
    this.on(WS_EVENTS.TRACKING.DEACTIVATED, callback);
  }

  offTrackingDeactivated(callback: (event: TrackingDeactivatedEvent) => void): void {
    this.off(WS_EVENTS.TRACKING.DEACTIVATED, callback);
  }

  onTrackingActivated(callback: (event: TrackingActivatedEvent) => void): void {
    this.on(WS_EVENTS.TRACKING.ACTIVATED, callback);
  }

  offTrackingActivated(callback: (event: TrackingActivatedEvent) => void): void {
    this.off(WS_EVENTS.TRACKING.ACTIVATED, callback);
  }
```

Add the necessary imports for `TrackingDeactivatedEvent`, `TrackingActivatedEvent` from `@/types/ws-events`.

Also add the new event names to the frontend WS_EVENTS constants. Find the frontend events constants file (likely `apps/client/src/services/websocket/events.ts` or similar) and add:

```typescript
CHANNEL: {
  OBSERVE: 'channel:observe',
  UNOBSERVE: 'channel:unobserve',
},
TRACKING: {
  DEACTIVATED: 'tracking:deactivated',
  ACTIVATED: 'tracking:activated',
},
```

- [ ] **Step 2: Create useChannelObserver hook**

Create `apps/client/src/hooks/useChannelObserver.ts`:

```typescript
import { useEffect, useRef } from "react";
import wsService from "@/services/websocket";

/**
 * Hook to temporarily observe a channel's events via WebSocket.
 * Per-connection subscription — automatically re-subscribes on reconnect.
 * Pass null/undefined channelId to unsubscribe.
 */
export function useChannelObserver(channelId: string | null | undefined) {
  const observedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!channelId) {
      // Unobserve previous if any
      if (observedRef.current) {
        wsService.unobserveChannel(observedRef.current);
        observedRef.current = null;
      }
      return;
    }

    // Observe the new channel
    wsService.observeChannel(channelId);
    observedRef.current = channelId;

    // Re-subscribe on reconnect
    const handleReconnect = () => {
      if (observedRef.current) {
        wsService.observeChannel(observedRef.current);
      }
    };
    wsService.on("connect", handleReconnect);

    return () => {
      // Cleanup: unobserve and remove reconnect handler
      if (observedRef.current) {
        wsService.unobserveChannel(observedRef.current);
        observedRef.current = null;
      }
      wsService.off("connect", handleReconnect);
    };
  }, [channelId]);
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/client/src/services/websocket/ apps/client/src/hooks/useChannelObserver.ts
git commit -m "feat(ws): add channel observe/unobserve, reconnect-safe hook"
```

---

## Task 7: Frontend — Tracking Channel Data Hook

**Files:**

- Create: `apps/client/src/hooks/useTrackingChannel.ts`

- [ ] **Step 1: Create useTrackingChannel hook**

Create `apps/client/src/hooks/useTrackingChannel.ts`:

```typescript
import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import imApi from "@/services/api/im";
import wsService from "@/services/websocket";
import { useChannelObserver } from "./useChannelObserver";
import type { Message, ChannelSnapshot, AgentEventMetadata } from "@/types/im";
import type {
  StreamingStartEvent,
  StreamingContentEvent,
  StreamingEndEvent,
  TrackingDeactivatedEvent,
} from "@/types/ws-events";

interface TrackingChannelState {
  isActivated: boolean;
  latestMessages: Message[];
  totalMessageCount: number;
  isLoading: boolean;
  /** Currently streaming message (not yet persisted) */
  activeStream: {
    streamId: string;
    content: string;
    metadata?: Record<string, unknown>;
  } | null;
}

/**
 * Hook to manage tracking channel data for inline card display.
 * Handles initial loading, observe subscription, and streaming updates.
 */
export function useTrackingChannel(trackingChannelId: string | undefined) {
  const [activeStream, setActiveStream] =
    useState<TrackingChannelState["activeStream"]>(null);
  const [extraMessages, setExtraMessages] = useState<Message[]>([]);
  const [isDeactivated, setIsDeactivated] = useState(false);
  const [snapshot, setSnapshot] = useState<ChannelSnapshot | null>(null);

  // Fetch channel info to determine state
  const { data: channelInfo, isLoading: isLoadingChannel } = useQuery({
    queryKey: ["channels", trackingChannelId],
    queryFn: () => imApi.channels.getChannel(trackingChannelId!),
    enabled: !!trackingChannelId,
    staleTime: Infinity,
    retry: false,
  });

  const isActivated = channelInfo ? channelInfo.isActivated : true;

  // For deactivated channels, use snapshot from channel info
  useEffect(() => {
    if (channelInfo && !channelInfo.isActivated && channelInfo.snapshot) {
      setSnapshot(channelInfo.snapshot as ChannelSnapshot);
      setIsDeactivated(true);
    }
  }, [channelInfo]);

  // For active channels, fetch latest messages
  const { data: fetchedMessages = [], isLoading: isLoadingMessages } = useQuery(
    {
      queryKey: ["trackingMessages", trackingChannelId],
      queryFn: () =>
        imApi.channels
          .getMessages(trackingChannelId!, { limit: 3 })
          .then((res) => res.messages),
      enabled: !!trackingChannelId && isActivated && !isDeactivated,
      staleTime: 30000,
    },
  );

  // Observe active tracking channels
  useChannelObserver(
    trackingChannelId && isActivated && !isDeactivated
      ? trackingChannelId
      : null,
  );

  // Listen for new messages in observed channel
  useEffect(() => {
    if (!trackingChannelId || isDeactivated) return;

    const handleNewMessage = (msg: Message) => {
      if (msg.channelId !== trackingChannelId) return;
      setExtraMessages((prev) => [...prev, msg]);
    };

    const handleStreamStart = (event: StreamingStartEvent) => {
      if (event.channelId !== trackingChannelId) return;
      setActiveStream({
        streamId: event.streamId,
        content: "",
        metadata: event.metadata,
      });
    };

    const handleStreamContent = (event: StreamingContentEvent) => {
      setActiveStream((prev) => {
        if (!prev || prev.streamId !== event.streamId) return prev;
        return { ...prev, content: event.content };
      });
    };

    const handleStreamEnd = (event: StreamingEndEvent) => {
      setActiveStream((prev) => {
        if (!prev || prev.streamId !== event.streamId) return prev;
        return null;
      });
      // The new_message event will add the persisted message
    };

    const handleDeactivated = (event: TrackingDeactivatedEvent) => {
      if (event.channelId !== trackingChannelId) return;
      setIsDeactivated(true);
      setSnapshot(event.snapshot as ChannelSnapshot);
      setActiveStream(null);
    };

    wsService.onNewMessage(handleNewMessage);
    wsService.onStreamingStart(handleStreamStart);
    wsService.onStreamingContent(handleStreamContent);
    wsService.onStreamingEnd(handleStreamEnd);
    wsService.onTrackingDeactivated(handleDeactivated);

    return () => {
      wsService.offNewMessage(handleNewMessage);
      wsService.offStreamingStart(handleStreamStart);
      wsService.offStreamingContent(handleStreamContent);
      wsService.offStreamingEnd(handleStreamEnd);
      wsService.offTrackingDeactivated(handleDeactivated);
    };
  }, [trackingChannelId, isDeactivated]);

  // Compute latest 3 messages
  const allMessages = [...fetchedMessages, ...extraMessages];
  const latest3 = allMessages.slice(-3);

  // Use snapshot for deactivated channels
  if (isDeactivated && snapshot) {
    return {
      isActivated: false,
      latestMessages: snapshot.latestMessages as unknown as Message[],
      totalMessageCount: snapshot.totalMessageCount,
      isLoading: isLoadingChannel,
      activeStream: null,
    };
  }

  return {
    isActivated: true,
    latestMessages: latest3,
    totalMessageCount: allMessages.length,
    isLoading: isLoadingChannel || isLoadingMessages,
    activeStream,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/client/src/hooks/useTrackingChannel.ts
git commit -m "feat: add useTrackingChannel hook for tracking card data"
```

---

## Task 8: Frontend — TrackingEventItem Component

**Files:**

- Create: `apps/client/src/components/channel/TrackingEventItem.tsx`

- [ ] **Step 1: Create TrackingEventItem component**

Create `apps/client/src/components/channel/TrackingEventItem.tsx`:

```typescript
import { cn } from "@/lib/utils";
import type { AgentEventMetadata } from "@/types/im";

interface TrackingEventItemProps {
  metadata: AgentEventMetadata;
  content: string;
  /** Whether this item is actively streaming */
  isStreaming?: boolean;
  /** Whether to show in compact mode (inline card) vs full mode (modal) */
  compact?: boolean;
}

const STATUS_DOT_CLASSES: Record<AgentEventMetadata["status"], string> = {
  running: "bg-emerald-500 animate-pulse",
  completed: "bg-emerald-500",
  failed: "bg-red-500",
};

const LABEL_CLASSES: Record<AgentEventMetadata["status"], string> = {
  running: "text-yellow-400",
  completed: "text-emerald-500",
  failed: "text-red-500",
};

const EVENT_LABELS: Record<AgentEventMetadata["agentEventType"], string> = {
  thinking: "Thinking",
  writing: "Writing",
  tool_call: "Calling",
  tool_result: "Result",
  agent_start: "Started",
  agent_end: "Completed",
  error: "Error",
  turn_separator: "Turn",
};

export function TrackingEventItem({
  metadata,
  content,
  isStreaming = false,
  compact = true,
}: TrackingEventItemProps) {
  const status = isStreaming ? "running" : metadata.status;
  const label = EVENT_LABELS[metadata.agentEventType] ?? metadata.agentEventType;
  const displayContent =
    metadata.agentEventType === "tool_call" && metadata.toolName
      ? metadata.toolName
      : content;

  return (
    <div className="flex items-center gap-2.5 min-h-6">
      {/* Status dot */}
      <div
        className={cn("w-2 h-2 rounded-full shrink-0", STATUS_DOT_CLASSES[status])}
      />
      {/* Label */}
      <span
        className={cn("text-xs font-semibold shrink-0", LABEL_CLASSES[status])}
      >
        {label}
      </span>
      {/* Content */}
      <span
        className={cn(
          "text-xs truncate",
          metadata.agentEventType === "tool_call" || metadata.agentEventType === "tool_result"
            ? "font-mono text-foreground/80"
            : "text-muted-foreground",
        )}
      >
        {displayContent}
        {isStreaming && (
          <span className="inline-block w-0.5 h-3.5 bg-yellow-400 animate-pulse ml-0.5 align-text-bottom" />
        )}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/client/src/components/channel/TrackingEventItem.tsx
git commit -m "feat: add TrackingEventItem component for execution event rows"
```

---

## Task 9: Frontend — TrackingCard Component

**Files:**

- Create: `apps/client/src/components/channel/TrackingCard.tsx`

- [ ] **Step 1: Create TrackingCard component**

Create `apps/client/src/components/channel/TrackingCard.tsx`:

```typescript
import { useState, useEffect } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { useTrackingChannel } from "@/hooks/useTrackingChannel";
import { TrackingEventItem } from "./TrackingEventItem";
import { TrackingModal } from "./TrackingModal";
import type { Message, AgentEventMetadata } from "@/types/im";

interface TrackingCardProps {
  message: Message;
}

function formatElapsed(startTime: string): string {
  const elapsed = Math.floor(
    (Date.now() - new Date(startTime).getTime()) / 1000,
  );
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export function TrackingCard({ message }: TrackingCardProps) {
  const trackingChannelId = (message.metadata as any)?.trackingChannelId as
    | string
    | undefined;
  const {
    isActivated,
    latestMessages,
    totalMessageCount,
    isLoading,
    activeStream,
  } = useTrackingChannel(trackingChannelId);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [elapsed, setElapsed] = useState("");

  // Live-updating elapsed timer
  useEffect(() => {
    if (!message.createdAt) return;
    if (!isActivated) {
      setElapsed(formatElapsed(message.createdAt));
      return;
    }
    const update = () => setElapsed(formatElapsed(message.createdAt));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [message.createdAt, isActivated]);

  const moreCount = totalMessageCount - 3;
  const showFrost = moreCount > 0;

  // Build display items: latest messages + active stream
  const displayItems: Array<{
    id: string;
    content: string;
    metadata: AgentEventMetadata;
    isStreaming: boolean;
  }> = latestMessages.map((msg) => ({
    id: msg.id,
    content: msg.content ?? "",
    metadata: (msg.metadata as AgentEventMetadata) ?? {
      agentEventType: "writing",
      status: "completed",
    },
    isStreaming: false,
  }));

  if (activeStream) {
    displayItems.push({
      id: `stream-${activeStream.streamId}`,
      content: activeStream.content,
      metadata: (activeStream.metadata as AgentEventMetadata) ?? {
        agentEventType: "writing",
        status: "running",
      },
      isStreaming: true,
    });
  }

  // Only show last 3
  const visibleItems = displayItems.slice(-3);

  return (
    <>
      <div
        onClick={() => setIsModalOpen(true)}
        className={cn(
          "rounded-lg p-4 max-w-md cursor-pointer border border-transparent",
          "bg-muted/50 transition-all duration-200",
          "hover:bg-muted hover:border-border hover:shadow-md",
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Avatar className="w-8 h-8">
              <AvatarImage src={message.sender?.avatarUrl ?? undefined} />
              <AvatarFallback className="text-xs">
                {message.sender?.displayName?.[0] ??
                  message.sender?.username?.[0] ??
                  "B"}
              </AvatarFallback>
            </Avatar>
            <span className="text-sm font-semibold">
              {message.sender?.displayName ?? message.sender?.username ?? "Bot"}
            </span>
          </div>
          {elapsed && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-background/80 px-2 py-0.5 rounded-full">
              {isActivated ? (
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              ) : (
                <span className="text-emerald-500">✓</span>
              )}
              <span>{elapsed}</span>
            </div>
          )}
        </div>

        {/* Bot summary text */}
        {message.content && (
          <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
            {message.content}
          </p>
        )}

        {/* Timeline */}
        {!isLoading && visibleItems.length > 0 && (
          <div className="border-l-2 border-border ml-1 pl-3 relative flex flex-col gap-2.5">
            {/* Frosted glass overlay on first item */}
            {showFrost && (
              <div className="absolute -top-1 -left-0.5 right-0 h-8 z-10 backdrop-blur-[3px] bg-muted/60 rounded-t flex items-center justify-center">
                <span className="text-[11px] text-muted-foreground">
                  View {moreCount} more details ›
                </span>
              </div>
            )}
            {visibleItems.map((item) => (
              <TrackingEventItem
                key={item.id}
                metadata={item.metadata}
                content={item.content}
                isStreaming={item.isStreaming}
                compact
              />
            ))}
          </div>
        )}

        {isLoading && (
          <div className="text-xs text-muted-foreground py-2">Loading...</div>
        )}
      </div>

      {/* Modal */}
      <TrackingModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        trackingChannelId={trackingChannelId}
        botUser={message.sender}
        isActivated={isActivated}
      />
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/client/src/components/channel/TrackingCard.tsx
git commit -m "feat: add TrackingCard component with frosted glass overlay"
```

---

## Task 10: Frontend — TrackingModal Component

**Files:**

- Create: `apps/client/src/components/channel/TrackingModal.tsx`

- [ ] **Step 1: Create TrackingModal component**

Create `apps/client/src/components/channel/TrackingModal.tsx`:

```typescript
import { useState, useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import imApi from "@/services/api/im";
import wsService from "@/services/websocket";
import { useChannelObserver } from "@/hooks/useChannelObserver";
import { TrackingEventItem } from "./TrackingEventItem";
import type { Message, IMUser, AgentEventMetadata } from "@/types/im";
import type {
  StreamingStartEvent,
  StreamingContentEvent,
  StreamingEndEvent,
} from "@/types/ws-events";

interface TrackingModalProps {
  isOpen: boolean;
  onClose: () => void;
  trackingChannelId: string | undefined;
  botUser?: IMUser;
  isActivated: boolean;
}

export function TrackingModal({
  isOpen,
  onClose,
  trackingChannelId,
  botUser,
  isActivated,
}: TrackingModalProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [activeStream, setActiveStream] = useState<{
    streamId: string;
    content: string;
    metadata?: Record<string, unknown>;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Observe channel when modal is open
  useChannelObserver(isOpen ? trackingChannelId : null);

  // Fetch all messages when modal opens
  const { data: fetchedMessages } = useQuery({
    queryKey: ["trackingModalMessages", trackingChannelId],
    queryFn: () =>
      imApi.channels
        .getMessages(trackingChannelId!, { limit: 100 })
        .then((res) => res.messages),
    enabled: isOpen && !!trackingChannelId,
  });

  useEffect(() => {
    if (fetchedMessages) {
      setMessages(fetchedMessages);
    }
  }, [fetchedMessages]);

  // Listen for real-time updates
  useEffect(() => {
    if (!isOpen || !trackingChannelId) return;

    const handleNewMessage = (msg: Message) => {
      if (msg.channelId !== trackingChannelId) return;
      setMessages((prev) => [...prev, msg]);
    };

    const handleStreamStart = (event: StreamingStartEvent) => {
      if (event.channelId !== trackingChannelId) return;
      setActiveStream({
        streamId: event.streamId,
        content: "",
        metadata: event.metadata,
      });
    };

    const handleStreamContent = (event: StreamingContentEvent) => {
      setActiveStream((prev) => {
        if (!prev || prev.streamId !== event.streamId) return prev;
        return { ...prev, content: event.content };
      });
    };

    const handleStreamEnd = (event: StreamingEndEvent) => {
      setActiveStream((prev) => {
        if (!prev || prev.streamId !== event.streamId) return prev;
        return null;
      });
    };

    wsService.onNewMessage(handleNewMessage);
    wsService.onStreamingStart(handleStreamStart);
    wsService.onStreamingContent(handleStreamContent);
    wsService.onStreamingEnd(handleStreamEnd);

    return () => {
      wsService.offNewMessage(handleNewMessage);
      wsService.offStreamingStart(handleStreamStart);
      wsService.offStreamingContent(handleStreamContent);
      wsService.offStreamingEnd(handleStreamEnd);
    };
  }, [isOpen, trackingChannelId]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length, activeStream?.content]);

  const handleSend = async () => {
    if (!inputValue.trim() || !trackingChannelId) return;
    try {
      await imApi.channels.sendMessage(trackingChannelId, {
        content: inputValue.trim(),
      });
      setInputValue("");
    } catch {
      // Handle error silently for now
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-2xl max-h-[80vh] bg-background border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-xs text-primary-foreground font-bold">
              {botUser?.displayName?.[0] ?? botUser?.username?.[0] ?? "B"}
            </div>
            <div>
              <div className="text-sm font-semibold">
                {botUser?.displayName ?? botUser?.username ?? "Bot"}
              </div>
              <div className="text-xs text-muted-foreground">
                Tracking Channel
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isActivated && (
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xs text-emerald-500">Running</span>
              </div>
            )}
            <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7">
              <X size={16} />
            </Button>
          </div>
        </div>

        {/* Message list */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {messages.map((msg) => {
            const meta = msg.metadata as AgentEventMetadata | undefined;

            // Turn separator
            if (meta?.agentEventType === "turn_separator") {
              return (
                <div key={msg.id} className="flex items-center gap-2 py-1">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-[10px] text-muted-foreground">
                    {msg.content}
                  </span>
                  <div className="flex-1 h-px bg-border" />
                </div>
              );
            }

            return (
              <div
                key={msg.id}
                className="flex items-start gap-2.5 p-2 rounded-lg bg-muted/30"
              >
                <TrackingEventItem
                  metadata={
                    meta ?? { agentEventType: "writing", status: "completed" }
                  }
                  content={msg.content ?? ""}
                  compact={false}
                />
              </div>
            );
          })}

          {/* Active streaming message */}
          {activeStream && (
            <div className="flex items-start gap-2.5 p-2 rounded-lg bg-muted/30">
              <TrackingEventItem
                metadata={
                  (activeStream.metadata as AgentEventMetadata) ?? {
                    agentEventType: "writing",
                    status: "running",
                  }
                }
                content={activeStream.content}
                isStreaming
                compact={false}
              />
            </div>
          )}
        </div>

        {/* Input area */}
        {isActivated && (
          <div className="flex items-center gap-2.5 px-5 py-3 border-t border-border">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder="Send guidance to agent..."
              className="flex-1 bg-muted border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <Button size="sm" onClick={handleSend} disabled={!inputValue.trim()}>
              ↑
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/client/src/components/channel/TrackingModal.tsx
git commit -m "feat: add TrackingModal with execution log, streaming, and input"
```

---

## Task 11: Frontend — Integrate TrackingCard into MessageItem

**Files:**

- Modify: `apps/client/src/components/channel/MessageItem.tsx:68-83`

- [ ] **Step 1: Add tracking message rendering**

In `apps/client/src/components/channel/MessageItem.tsx`, add import at the top:

```typescript
import { TrackingCard } from "./TrackingCard";
```

Then add a tracking message check before the system message check (before line 74):

```typescript
  // Tracking message display (inline card)
  const isTrackingMessage = message.type === "tracking";
  if (isTrackingMessage) {
    return (
      <div id={`message-${message.id}`} className="py-2 px-2">
        <TrackingCard message={message} />
      </div>
    );
  }
```

- [ ] **Step 2: Commit**

```bash
git add apps/client/src/components/channel/MessageItem.tsx
git commit -m "feat: route tracking type messages to TrackingCard in MessageItem"
```

---

## Task 12: Frontend — Handle Tracking WebSocket Events

**Files:**

- Modify: `apps/client/src/hooks/useWebSocketEvents.ts`

- [ ] **Step 1: Add tracking:deactivated handler**

In `apps/client/src/hooks/useWebSocketEvents.ts`, add a handler for `tracking:deactivated` to invalidate the channel query cache. Follow the existing pattern in the file:

```typescript
// Handle tracking channel deactivation
const handleTrackingDeactivated = (event: TrackingDeactivatedEvent) => {
  // Invalidate channel cache to update isActivated status
  queryClient.invalidateQueries({
    queryKey: ["channels", event.channelId],
  });
  // Invalidate tracking messages cache
  queryClient.invalidateQueries({
    queryKey: ["trackingMessages", event.channelId],
  });
  queryClient.invalidateQueries({
    queryKey: ["trackingModalMessages", event.channelId],
  });
};

wsService.onTrackingDeactivated(handleTrackingDeactivated);
```

And in the cleanup return:

```typescript
wsService.offTrackingDeactivated(handleTrackingDeactivated);
```

Add import for `TrackingDeactivatedEvent` from `@/types/ws-events`.

- [ ] **Step 2: Commit**

```bash
git add apps/client/src/hooks/useWebSocketEvents.ts
git commit -m "feat: handle tracking:deactivated in WebSocket events hook"
```

---

## Task 13: Agent — Rewrite TrackingChannelObserver

**Files:**

- Modify: `/Users/winrey/Projects/weightwave/team9-agent-pi/packages/claw-hive/src/runtime/tracking-channel-observer.ts`
- Modify: `/Users/winrey/Projects/weightwave/team9-agent-pi/packages/claw-hive/src/components/team9/team9-api-client.ts`

- [ ] **Step 1: Update Team9ApiClient — add metadata to startStreaming, fix lockChannel**

In `team9-api-client.ts`, update `sendMessage` to accept metadata:

```typescript
  async sendMessage(
    channelId: string,
    content: string,
    senderId: string,
    metadata?: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request(`/api/v1/im/channels/${channelId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content, metadata }),
      senderId,
    });
  }
```

Update `startStreaming` to accept metadata:

```typescript
  async startStreaming(
    channelId: string,
    senderId: string,
    metadata?: Record<string, unknown>,
  ): Promise<{ streamId: string }> {
    const res = await this.request(`/api/v1/im/channels/${channelId}/streaming/start`, {
      method: 'POST',
      body: JSON.stringify({ metadata }),
      senderId,
    });
    return res as { streamId: string };
  }
```

Fix `lockChannel` to call the correct endpoint (`/deactivate` instead of `/lock`):

```typescript
  async lockChannel(channelId: string): Promise<void> {
    await this.request(`/api/v1/im/channels/${channelId}/deactivate`, {
      method: 'POST',
    });
  }
```

- [ ] **Step 2: Rewrite TrackingChannelObserver**

Replace the content of `tracking-channel-observer.ts`:

```typescript
import type { AgentEvent, IObserver } from "../types.js";

export interface TrackingChannelApi {
  sendMessage(
    channelId: string,
    content: string,
    senderId: string,
    metadata?: Record<string, unknown>,
  ): Promise<unknown>;
  startStreaming(
    channelId: string,
    senderId: string,
    metadata?: Record<string, unknown>,
  ): Promise<{ streamId: string }>;
  updateStreamingContent(streamId: string, content: string): Promise<void>;
  endStreaming(streamId: string, content: string): Promise<void>;
  lockChannel(channelId: string): Promise<void>;
}

export class TrackingChannelObserver implements IObserver {
  private trackingChannelId: string | null = null;
  private senderId: string | null = null;
  private activeStreamId: string | null = null;
  private turnIndex = 0;

  constructor(private readonly api: TrackingChannelApi) {}

  setTrackingChannelId(id: string): void {
    this.trackingChannelId = id;
  }

  setSenderId(id: string): void {
    this.senderId = id;
  }

  async onEvent(event: AgentEvent): Promise<void> {
    if (!this.trackingChannelId || !this.senderId) return;

    try {
      await this.handleEvent(event);
    } catch {
      // Tracking failures must never block agent execution
    }
  }

  private async handleEvent(event: AgentEvent): Promise<void> {
    const channelId = this.trackingChannelId!;
    const senderId = this.senderId!;

    switch (event.type) {
      case "agent_start":
        await this.api.sendMessage(channelId, "Execution started.", senderId, {
          agentEventType: "agent_start",
          status: "completed",
        });
        break;

      case "turn_start":
        if (this.turnIndex > 0) {
          await this.api.sendMessage(
            channelId,
            `Turn ${this.turnIndex + 1}`,
            senderId,
            { agentEventType: "turn_separator", status: "completed" },
          );
        }
        this.turnIndex++;
        break;

      case "thinking_start":
        await this.startStream(channelId, senderId, {
          agentEventType: "thinking",
          status: "running",
        });
        break;

      case "thinking_content":
        await this.updateStream(event.content ?? "");
        break;

      case "thinking_end":
        await this.endStream(event.content ?? "");
        break;

      case "content_start":
        await this.startStream(channelId, senderId, {
          agentEventType: "writing",
          status: "running",
        });
        break;

      case "content_delta":
        await this.updateStream(event.content ?? "");
        break;

      case "content_end":
        await this.endStream(event.content ?? "");
        break;

      case "tool_call_start":
        await this.api.sendMessage(
          channelId,
          event.toolName ?? "Unknown tool",
          senderId,
          {
            agentEventType: "tool_call",
            status: "completed",
            toolName: event.toolName,
          },
        );
        break;

      case "tool_call_end": {
        const success = !event.error;
        const content = event.error
          ? `Error: ${event.error}`
          : this.truncate(event.result ?? "", 2000);
        await this.api.sendMessage(channelId, content, senderId, {
          agentEventType: "tool_result",
          status: success ? "completed" : "failed",
          success,
        });
        break;
      }

      case "agent_end":
        await this.api.sendMessage(channelId, "Execution complete.", senderId, {
          agentEventType: "agent_end",
          status: "completed",
        });
        await this.api.lockChannel(channelId);
        break;

      case "error":
        await this.api.sendMessage(
          channelId,
          event.message ?? "Unknown error",
          senderId,
          { agentEventType: "error", status: "failed" },
        );
        break;
    }
  }

  private async startStream(
    channelId: string,
    senderId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    // End any existing stream first
    if (this.activeStreamId) {
      await this.api.endStreaming(this.activeStreamId, "").catch(() => {});
      this.activeStreamId = null;
    }
    const { streamId } = await this.api.startStreaming(
      channelId,
      senderId,
      metadata,
    );
    this.activeStreamId = streamId;
  }

  private async updateStream(content: string): Promise<void> {
    if (!this.activeStreamId) return;
    await this.api.updateStreamingContent(this.activeStreamId, content);
  }

  private async endStream(content: string): Promise<void> {
    if (!this.activeStreamId) return;
    await this.api.endStreaming(this.activeStreamId, content);
    this.activeStreamId = null;
  }

  private truncate(str: string, maxLen: number): string {
    return str.length > maxLen ? str.slice(0, maxLen) + "…" : str;
  }
}
```

- [ ] **Step 3: Commit** (in team9-agent-pi repo)

```bash
cd /Users/winrey/Projects/weightwave/team9-agent-pi
git add packages/claw-hive/src/runtime/tracking-channel-observer.ts packages/claw-hive/src/components/team9/team9-api-client.ts
git commit -m "feat: rewrite TrackingChannelObserver to use streaming API + metadata"
```

---

## Task 14: Frontend — Update useChannelsByType Hook

**Files:**

- Modify: `apps/client/src/hooks/useChannels.ts:97-117`

- [ ] **Step 1: Exclude tracking channels from standard channel lists**

In `apps/client/src/hooks/useChannels.ts`, update `useChannelsByType` to exclude tracking and task channels from the main lists (they should not appear in sidebar):

```typescript
export function useChannelsByType() {
  const { data: channels = [], ...rest } = useChannels();

  const publicChannels = channels.filter(
    (ch) => ch.type === "public" && !ch.isArchived,
  );
  const privateChannels = channels.filter(
    (ch) => ch.type === "private" && !ch.isArchived,
  );
  const directChannels = channels.filter((ch) => ch.type === "direct");
  const archivedChannels = channels.filter((ch) => ch.isArchived);

  return {
    channels,
    publicChannels,
    privateChannels,
    directChannels,
    archivedChannels,
    ...rest,
  };
}
```

Note: This is already correct — tracking and task channels naturally fall through since they don't match any filter. No code change needed, but verify this is the case.

- [ ] **Step 2: Commit (if changes were needed)**

```bash
git add apps/client/src/hooks/useChannels.ts
git commit -m "fix: ensure tracking/task channels excluded from sidebar channel lists"
```

---

## Task 15: Smoke Test & Integration Verification

- [ ] **Step 1: Build the backend**

```bash
pnpm build:server
```

Expected: Build succeeds without errors.

- [ ] **Step 2: Run database migration**

```bash
pnpm db:push
```

Expected: Schema changes applied.

- [ ] **Step 3: Build the frontend**

```bash
pnpm build:client
```

Expected: Build succeeds without TypeScript errors.

- [ ] **Step 4: Verify dev server starts**

```bash
pnpm dev:client
```

Expected: Vite dev server starts, no console errors.

- [ ] **Step 5: Final commit**

If any type fixes or adjustments were needed during verification:

```bash
git add -A
git commit -m "fix: address build issues from tracking channel integration"
```
