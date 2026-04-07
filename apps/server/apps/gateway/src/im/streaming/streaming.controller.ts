import {
  Controller,
  Post,
  Body,
  Param,
  UseGuards,
  ForbiddenException,
  Inject,
  forwardRef,
  Optional,
  Logger,
  ParseUUIDPipe,
} from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuthGuard, CurrentUser } from '@team9/auth';
import { RedisService } from '@team9/redis';
import { GatewayMQService, RABBITMQ_ROUTING_KEYS } from '@team9/rabbitmq';
import type { PostBroadcastTask } from '@team9/shared';
import { ChannelsService } from '../channels/channels.service.js';
import {
  MessagesService,
  type MessageResponse,
} from '../messages/messages.service.js';
import { WebsocketGateway } from '../websocket/websocket.gateway.js';
import { WS_EVENTS } from '../websocket/events/events.constants.js';
import { REDIS_KEYS } from '../shared/constants/redis-keys.js';
import { ImWorkerGrpcClientService } from '../services/im-worker-grpc-client.service.js';
import { BotService } from '../../bot/bot.service.js';
import {
  StartStreamingDto,
  UpdateStreamingContentDto,
  EndStreamingDto,
} from './dto/streaming.dto.js';

const STREAM_TTL = 120;

interface StreamingSession {
  channelId: string;
  senderId: string;
  parentId?: string;
  metadata?: Record<string, unknown>;
  startedAt: number;
}

@Controller({ path: 'im', version: '1' })
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
    private readonly eventEmitter: EventEmitter2,
    @Optional() private readonly gatewayMQService?: GatewayMQService,
  ) {}

  private shouldPublishChannelMessageTrigger(
    message: MessageResponse,
  ): boolean {
    const sender = message.sender;
    return sender?.userType === 'human' && sender.agentType === null;
  }

  private parseStreamingSession(sessionRaw: string): StreamingSession {
    return JSON.parse(sessionRaw) as StreamingSession;
  }

  /**
   * Ensure the authenticated user is a bot. Throws ForbiddenException otherwise.
   */
  private async assertBot(userId: string): Promise<void> {
    const isBot = await this.botService.isBot(userId);
    if (!isBot) {
      throw new ForbiddenException('Only bot users can stream messages');
    }
  }

  // ── POST /v1/im/channels/:channelId/streaming/start ────────────────

  @Post('channels/:channelId/streaming/start')
  async startStreaming(
    @CurrentUser('sub') userId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Body() dto: StartStreamingDto,
  ): Promise<{ streamId: string }> {
    await this.assertBot(userId);

    const isMember = await this.channelsService.isMember(channelId, userId);
    if (!isMember) {
      throw new ForbiddenException('Not a member of this channel');
    }

    // Reject streaming to deactivated channels
    const channel = await this.channelsService.findById(channelId);
    if (channel && !channel.isActivated) {
      throw new ForbiddenException(
        'Channel is deactivated — execution has completed',
      );
    }

    const streamId = uuidv7();
    const startedAt = Date.now();

    // Store session in Redis (same keys as WebSocket handler)
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

    await this.redisService.sadd(
      REDIS_KEYS.BOT_ACTIVE_STREAMS(userId),
      streamId,
    );
    await this.redisService.expire(
      REDIS_KEYS.BOT_ACTIVE_STREAMS(userId),
      STREAM_TTL,
    );

    // Broadcast to channel via Socket.io
    await this.websocketGateway.sendToChannelMembers(
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

    return { streamId };
  }

  // ── POST /v1/im/streaming/:streamId/content ────────────────────────

  @Post('streaming/:streamId/content')
  async updateContent(
    @CurrentUser('sub') userId: string,
    @Param('streamId') streamId: string,
    @Body() dto: UpdateStreamingContentDto,
  ): Promise<{ success: true }> {
    await this.assertBot(userId);

    const sessionRaw = await this.redisService.get(
      REDIS_KEYS.STREAMING_SESSION(streamId),
    );
    if (!sessionRaw) {
      throw new ForbiddenException('Streaming session not found or expired');
    }
    const session = this.parseStreamingSession(sessionRaw);

    if (session.senderId !== userId) {
      throw new ForbiddenException('Not the owner of this stream');
    }

    // Refresh TTL on both session and active-streams set
    await this.redisService.expire(
      REDIS_KEYS.STREAMING_SESSION(streamId),
      STREAM_TTL,
    );
    await this.redisService.expire(
      REDIS_KEYS.BOT_ACTIVE_STREAMS(userId),
      STREAM_TTL,
    );

    await this.websocketGateway.sendToChannelMembers(
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

  @Post('streaming/:streamId/end')
  async endStreaming(
    @CurrentUser('sub') userId: string,
    @Param('streamId') streamId: string,
    @Body() dto: EndStreamingDto,
  ): Promise<{ success: true; messageId: string }> {
    await this.assertBot(userId);

    const sessionRaw = await this.redisService.get(
      REDIS_KEYS.STREAMING_SESSION(streamId),
    );
    if (!sessionRaw) {
      throw new ForbiddenException('Streaming session not found or expired');
    }
    const session = this.parseStreamingSession(sessionRaw);

    if (session.senderId !== userId) {
      throw new ForbiddenException('Not the owner of this stream');
    }

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
      type: 'text',
      workspaceId,
    });

    // Fetch the persisted message with sender/attachment details.
    // If this fails, we still have enough data to broadcast a minimal message.
    let message: MessageResponse | null = null;
    try {
      message = await this.messagesService.getMessageWithDetails(result.msgId);
    } catch (error) {
      this.logger.warn(
        `[endStreaming] getMessageWithDetails failed for ${result.msgId}: ${(error as Error).message}`,
      );
    }

    // Broadcast streaming_end and new_message independently so that
    // failure of one does not prevent the other from being attempted.
    const streamingEndDelivered =
      await this.websocketGateway.sendToChannelMembers(
        channelId,
        WS_EVENTS.STREAMING.END,
        {
          streamId,
          channelId,
          senderId: userId,
          message,
        },
      );

    // Also broadcast as new_message for clients that missed the stream.
    // This is the safety net — even if streaming_end had a null message
    // or was not delivered, new_message is an independent attempt.
    if (message) {
      const newMsgDelivered = await this.websocketGateway.sendToChannelMembers(
        channelId,
        WS_EVENTS.MESSAGE.NEW,
        message,
      );

      if (!streamingEndDelivered && !newMsgDelivered) {
        this.logger.error(
          `[endStreaming] Both streaming_end and new_message broadcasts failed for channel ${channelId}, message ${result.msgId}. ` +
            `Message was persisted but clients will not see it until they refresh.`,
        );
      }
    } else if (!streamingEndDelivered) {
      this.logger.error(
        `[endStreaming] streaming_end broadcast failed AND getMessageWithDetails returned null for channel ${channelId}, message ${result.msgId}. ` +
          `Message was persisted but clients will not see it until they refresh.`,
      );
    }

    // Emit event for search indexing (same as MessagesController.createMessage)
    if (message) {
      this.eventEmitter.emit('message.created', {
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
        channel,
        sender: message.sender
          ? {
              id: message.sender.id,
              username: message.sender.username,
              displayName: message.sender.displayName,
            }
          : undefined,
      });
    }

    // Publish to RabbitMQ (channel-message triggers + post-broadcast)
    if (this.gatewayMQService?.isReady()) {
      if (message && this.shouldPublishChannelMessageTrigger(message)) {
        this.gatewayMQService
          .publishWorkspaceEvent(RABBITMQ_ROUTING_KEYS.MESSAGE_CREATED, {
            channelId: message.channelId,
            messageId: message.id,
            content: message.content,
            messageType: message.type,
            senderId: message.senderId,
            senderUserType: message.sender?.userType ?? null,
            senderAgentType: message.sender?.agentType ?? null,
          })
          .catch((err) => {
            this.logger.warn(`Failed to publish message.created event: ${err}`);
          });
      } else if (message) {
        this.logger.debug(
          `[endStreaming] Skipping channel-message trigger publish for non-human-authored message ${message.id}`,
        );
      }

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
