# HTTP Streaming Endpoints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 3 REST endpoints so claw-hive bots can stream messages via HTTP instead of WebSocket.

**Architecture:** The gateway already has full WebSocket-based streaming infrastructure (Redis state, Socket.io broadcast). We add a thin `StreamingController` that reuses the same Redis keys and WebSocket gateway broadcast methods, exposing the same logic over HTTP. Bot authentication is handled by the existing `AuthGuard` which validates `t9bot_` tokens.

**Tech Stack:** NestJS controller, Redis (via `RedisService`), Socket.io broadcast (via `WebsocketGateway`)

---

## File Structure

| File                                                                     | Action | Purpose                                        |
| ------------------------------------------------------------------------ | ------ | ---------------------------------------------- |
| `apps/server/apps/gateway/src/im/streaming/streaming.controller.ts`      | Create | REST endpoints for streaming start/content/end |
| `apps/server/apps/gateway/src/im/streaming/streaming.controller.spec.ts` | Create | Unit tests                                     |
| `apps/server/apps/gateway/src/im/streaming/dto/streaming.dto.ts`         | Create | Request DTOs with validation                   |
| `apps/server/apps/gateway/src/im/messages/messages.module.ts`            | Modify | Register the new controller                    |

---

### Task 1: Create DTOs

**Files:**

- Create: `apps/server/apps/gateway/src/im/streaming/dto/streaming.dto.ts`

- [ ] **Step 1: Create the DTO file**

```typescript
import { IsString, IsUUID, IsOptional, MaxLength } from "class-validator";

export class StartStreamingDto {
  @IsUUID()
  senderId: string;

  @IsUUID()
  @IsOptional()
  parentId?: string;
}

export class UpdateStreamingContentDto {
  @IsString()
  @MaxLength(100000)
  content: string;
}

export class EndStreamingDto {
  @IsString()
  @MaxLength(100000)
  content: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/server/apps/gateway/src/im/streaming/dto/streaming.dto.ts
git commit -m "feat(streaming): add DTOs for HTTP streaming endpoints"
```

---

### Task 2: Create StreamingController

**Files:**

- Create: `apps/server/apps/gateway/src/im/streaming/streaming.controller.ts`

The controller exposes 3 endpoints that mirror the WebSocket streaming handlers in `websocket.gateway.ts:851-995`. It reuses the same Redis keys (`STREAMING_SESSION`, `BOT_ACTIVE_STREAMS`) and broadcasts via `WebsocketGateway.sendToChannel()`.

Key differences from the WebSocket handlers:

- Authentication via `AuthGuard` + `@CurrentUser('sub')` instead of `socketClient.isBot`
- Bot identity verified by checking `userType === 'bot'` in the database (via `BotService.isBot()`)
- The `streaming/end` endpoint creates the message via gRPC (same as `createMessage`), persists it, then broadcasts

- [ ] **Step 1: Create the controller**

```typescript
import {
  Controller,
  Post,
  Body,
  Param,
  UseGuards,
  ForbiddenException,
  Inject,
  forwardRef,
  Logger,
} from "@nestjs/common";
import { v7 as uuidv7 } from "uuid";
import { AuthGuard, CurrentUser } from "@team9/auth";
import { RedisService } from "@team9/redis";
import { GatewayMQService } from "@team9/rabbitmq";
import type { PostBroadcastTask } from "@team9/shared";
import { ChannelsService } from "../channels/channels.service.js";
import { MessagesService } from "../messages/messages.service.js";
import { WebsocketGateway } from "../websocket/websocket.gateway.js";
import { WS_EVENTS } from "../websocket/events/events.constants.js";
import { REDIS_KEYS } from "../shared/constants/redis-keys.js";
import { ImWorkerGrpcClientService } from "../services/im-worker-grpc-client.service.js";
import { BotService } from "../../bot/bot.service.js";
import {
  StartStreamingDto,
  UpdateStreamingContentDto,
  EndStreamingDto,
} from "./dto/streaming.dto.js";

const STREAM_TTL = 120;

@Controller({ path: "im", version: "1" })
@UseGuards(AuthGuard)
export class StreamingController {
  private readonly logger = new Logger(StreamingController.name);

  constructor(
    private readonly channelsService: ChannelsService,
    private readonly messagesService: MessagesService,
    private readonly redisService: RedisService,
    @Inject(forwardRef(() => WebsocketGateway))
    private readonly websocketGateway: WebsocketGateway,
    private readonly imWorkerGrpcClientService: ImWorkerGrpcClientService,
    private readonly botService: BotService,
    @Inject(forwardRef(() => GatewayMQService))
    private readonly gatewayMQService: GatewayMQService | undefined,
  ) {}

  /**
   * Ensure the authenticated user is a bot. Throws ForbiddenException otherwise.
   */
  private async assertBot(userId: string): Promise<void> {
    const isBot = await this.botService.isBot(userId);
    if (!isBot) {
      throw new ForbiddenException("Only bot users can stream messages");
    }
  }

  // ── POST /v1/im/channels/:channelId/streaming/start ────────────────

  @Post("channels/:channelId/streaming/start")
  async startStreaming(
    @CurrentUser("sub") userId: string,
    @Param("channelId") channelId: string,
    @Body() dto: StartStreamingDto,
  ): Promise<{ streamId: string }> {
    await this.assertBot(userId);

    const isMember = await this.channelsService.isMember(channelId, userId);
    if (!isMember) {
      throw new ForbiddenException("Not a member of this channel");
    }

    const streamId = uuidv7();

    // Store session in Redis (same keys as WebSocket handler)
    await this.redisService.set(
      REDIS_KEYS.STREAMING_SESSION(streamId),
      JSON.stringify({
        channelId,
        senderId: userId,
        parentId: dto.parentId,
        startedAt: Date.now(),
      }),
      STREAM_TTL,
    );

    await this.redisService.sadd(
      REDIS_KEYS.BOT_ACTIVE_STREAMS(userId),
      streamId,
    );
    await this.redisService.expire(
      REDIS_KEYS.BOT_ACTIVE_STREAMS(userId),
      STREAM_TTL,
    );

    // Broadcast to channel via Socket.io
    this.websocketGateway.sendToChannel(channelId, WS_EVENTS.STREAMING.START, {
      streamId,
      channelId,
      senderId: userId,
      parentId: dto.parentId,
      startedAt: Date.now(),
    });

    return { streamId };
  }

  // ── POST /v1/im/streaming/:streamId/content ────────────────────────

  @Post("streaming/:streamId/content")
  async updateContent(
    @CurrentUser("sub") userId: string,
    @Param("streamId") streamId: string,
    @Body() dto: UpdateStreamingContentDto,
  ): Promise<{ success: true }> {
    await this.assertBot(userId);

    const sessionRaw = await this.redisService.get(
      REDIS_KEYS.STREAMING_SESSION(streamId),
    );
    if (!sessionRaw) {
      throw new ForbiddenException("Streaming session not found or expired");
    }
    const session = JSON.parse(sessionRaw);

    // Refresh TTL
    await this.redisService.expire(
      REDIS_KEYS.STREAMING_SESSION(streamId),
      STREAM_TTL,
    );

    this.websocketGateway.sendToChannel(
      session.channelId,
      WS_EVENTS.STREAMING.CONTENT,
      {
        streamId,
        channelId: session.channelId,
        senderId: userId,
        content: dto.content,
      },
    );

    return { success: true };
  }

  // ── POST /v1/im/streaming/:streamId/end ────────────────────────────

  @Post("streaming/:streamId/end")
  async endStreaming(
    @CurrentUser("sub") userId: string,
    @Param("streamId") streamId: string,
    @Body() dto: EndStreamingDto,
  ): Promise<{ success: true; messageId: string }> {
    await this.assertBot(userId);

    const sessionRaw = await this.redisService.get(
      REDIS_KEYS.STREAMING_SESSION(streamId),
    );
    if (!sessionRaw) {
      throw new ForbiddenException("Streaming session not found or expired");
    }
    const session = JSON.parse(sessionRaw);
    const channelId = session.channelId;

    // Clean up Redis state
    await this.redisService.del(REDIS_KEYS.STREAMING_SESSION(streamId));
    await this.redisService.srem(
      REDIS_KEYS.BOT_ACTIVE_STREAMS(userId),
      streamId,
    );

    // Persist the message via gRPC (same flow as MessagesController.createMessage)
    const channel = await this.channelsService.findById(channelId);
    const workspaceId = channel?.tenantId ?? undefined;

    const result = await this.imWorkerGrpcClientService.createMessage({
      clientMsgId: uuidv7(),
      channelId,
      senderId: userId,
      content: dto.content,
      parentId: session.parentId,
      type: "text",
      workspaceId,
    });

    const message = await this.messagesService.getMessageWithDetails(
      result.msgId,
    );

    // Broadcast streaming_end with persisted message
    this.websocketGateway.sendToChannel(channelId, WS_EVENTS.STREAMING.END, {
      streamId,
      channelId,
      senderId: userId,
      message,
    });

    // Also broadcast as new_message for clients that missed the stream
    this.websocketGateway.sendToChannel(
      channelId,
      WS_EVENTS.MESSAGE.NEW,
      message,
    );

    // Post-broadcast task (unread counts, notifications, hive bot push)
    if (this.gatewayMQService) {
      const postBroadcastTask: PostBroadcastTask = {
        msgId: result.msgId,
        channelId,
        senderId: userId,
        workspaceId,
        broadcastAt: Date.now(),
      };
      this.gatewayMQService
        .publishPostBroadcast(postBroadcastTask)
        .catch((err) => {
          this.logger.warn(`Failed to publish post-broadcast task: ${err}`);
        });
    }

    return { success: true, messageId: result.msgId };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/server/apps/gateway/src/im/streaming/streaming.controller.ts
git commit -m "feat(streaming): add HTTP streaming controller with start/content/end endpoints"
```

---

### Task 3: Register Controller in Module

**Files:**

- Modify: `apps/server/apps/gateway/src/im/messages/messages.module.ts`

- [ ] **Step 1: Add StreamingController to the module**

Add `StreamingController` import and register it in `controllers` array. Also add `RedisModule` and `BotModule` (or `BotService`) to imports/providers as needed.

Check how `BotService` is provided — it may already be available via the IM module. If not, import the bot module.

```typescript
import { StreamingController } from "../streaming/streaming.controller.js";
```

Add `StreamingController` to the `controllers` array.

Add `RedisModule` to `imports` if not already present (the `MessagesModule` currently does NOT import `RedisModule`).

- [ ] **Step 2: Verify the server starts without errors**

```bash
pnpm dev:server
```

- [ ] **Step 3: Commit**

```bash
git add apps/server/apps/gateway/src/im/messages/messages.module.ts
git commit -m "feat(streaming): register StreamingController in messages module"
```

---

### Task 4: Write Tests

**Files:**

- Create: `apps/server/apps/gateway/src/im/streaming/streaming.controller.spec.ts`

- [ ] **Step 1: Write unit tests covering all 3 endpoints**

Test cases:

1. `startStreaming` — creates Redis session, broadcasts streaming_start, returns streamId
2. `startStreaming` — rejects non-bot users
3. `startStreaming` — rejects non-members
4. `updateContent` — refreshes TTL and broadcasts streaming_content
5. `updateContent` — rejects expired/missing session
6. `endStreaming` — persists message, broadcasts streaming_end + new_message, cleans up Redis
7. `endStreaming` — rejects expired/missing session

Use the same `mockDb` + NestJS `Test.createTestingModule` pattern as existing specs (e.g. `bot.service.spec.ts`).

Mock dependencies:

- `RedisService`: mock `set`, `get`, `del`, `sadd`, `srem`, `expire`
- `WebsocketGateway`: mock `sendToChannel`
- `ChannelsService`: mock `isMember`, `findById`
- `MessagesService`: mock `getMessageWithDetails`
- `ImWorkerGrpcClientService`: mock `createMessage`
- `BotService`: mock `isBot`
- `GatewayMQService`: mock `publishPostBroadcast`, `isReady`

- [ ] **Step 2: Run tests**

```bash
cd apps/server && NODE_OPTIONS='--experimental-vm-modules' npx jest --config apps/gateway/jest.config.cjs apps/gateway/src/im/streaming/streaming.controller.spec.ts --no-coverage
```

- [ ] **Step 3: Commit**

```bash
git add apps/server/apps/gateway/src/im/streaming/streaming.controller.spec.ts
git commit -m "test(streaming): add unit tests for HTTP streaming controller"
```

---

### Task 5: Integration Verification

- [ ] **Step 1: Start the full dev environment**

```bash
pnpm dev:server:all
```

- [ ] **Step 2: Manually test with curl (using a bot token)**

```bash
# Start streaming
curl -X POST http://localhost:3000/v1/im/channels/<channelId>/streaming/start \
  -H 'Authorization: Bearer t9bot_<token>' \
  -H 'Content-Type: application/json' \
  -d '{"senderId":"<botUserId>"}'

# Update content
curl -X POST http://localhost:3000/v1/im/streaming/<streamId>/content \
  -H 'Authorization: Bearer t9bot_<token>' \
  -H 'Content-Type: application/json' \
  -d '{"content":"Hello, streaming!"}'

# End streaming
curl -X POST http://localhost:3000/v1/im/streaming/<streamId>/end \
  -H 'Authorization: Bearer t9bot_<token>' \
  -H 'Content-Type: application/json' \
  -d '{"content":"Hello, streaming!"}'
```

- [ ] **Step 3: Test end-to-end with claw-hive bot**

Send a message to a base-model-staff bot DM and verify the response appears in the frontend.

- [ ] **Step 4: Commit all remaining changes**
