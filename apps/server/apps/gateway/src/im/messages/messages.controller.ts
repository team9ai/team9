import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ForbiddenException,
  Inject,
  forwardRef,
  Optional,
  Logger,
  ParseUUIDPipe,
  BadRequestException,
  BadGatewayException,
  HttpException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { v7 as uuidv7 } from 'uuid';
import {
  MessagesService,
  MessageResponse,
  PaginatedMessagesResponse,
  ThreadResponse,
  SubRepliesResponse,
} from './messages.service.js';
import {
  CreateMessageDto,
  UpdateMessageDto,
  AddReactionDto,
  StartDeepResearchDto,
} from './dto/index.js';
import { AuthGuard, CurrentUser } from '@team9/auth';
import { GatewayMQService, RABBITMQ_ROUTING_KEYS } from '@team9/rabbitmq';
import {
  type PostBroadcastTask,
  parseMentions,
  extractMentionedUserIds,
} from '@team9/shared';
import { ChannelsService } from '../channels/channels.service.js';
import { WebsocketGateway } from '../websocket/websocket.gateway.js';
import { WS_EVENTS } from '../websocket/events/events.constants.js';
import { ImWorkerGrpcClientService } from '../services/im-worker-grpc-client.service.js';
import { MessagePropertiesService } from '../properties/message-properties.service.js';
import { AiAutoFillService } from '../properties/ai-auto-fill.service.js';
import { PropertyDefinitionsService } from '../properties/property-definitions.service.js';
import { determineMessageType } from './message-utils.js';
import { CapabilityHubClient } from '../../deep-research/capability-hub.client.js';

type DeepResearchOrigin = 'dashboard' | 'chat';
type DeepResearchTaskStatus = 'pending' | 'running' | 'completed' | 'failed';

@Controller({
  path: 'im',
  version: '1',
})
@UseGuards(AuthGuard)
export class MessagesController {
  private readonly logger = new Logger(MessagesController.name);

  constructor(
    private readonly messagesService: MessagesService,
    private readonly channelsService: ChannelsService,
    @Inject(forwardRef(() => WebsocketGateway))
    private readonly websocketGateway: WebsocketGateway,
    private readonly imWorkerGrpcClientService: ImWorkerGrpcClientService,
    private readonly messagePropertiesService: MessagePropertiesService,
    private readonly aiAutoFillService: AiAutoFillService,
    private readonly propertyDefinitionsService: PropertyDefinitionsService,
    private readonly eventEmitter: EventEmitter2,
    private readonly capabilityHubClient: CapabilityHubClient,
    @Optional() private readonly gatewayMQService?: GatewayMQService,
  ) {}

  private isDeepResearchMessage(
    metadata?: Record<string, unknown> | null,
  ): boolean {
    if (!metadata || typeof metadata !== 'object') return false;
    const deepResearch = metadata.deepResearch;
    if (!deepResearch || typeof deepResearch !== 'object') return false;
    return typeof (deepResearch as Record<string, unknown>).taskId === 'string';
  }

  private shouldPublishChannelMessageTrigger(
    message: MessageResponse,
  ): boolean {
    const sender = message.sender;
    return (
      sender?.userType === 'human' &&
      sender.agentType === null &&
      !this.isDeepResearchMessage(message.metadata)
    );
  }

  private buildDeepResearchMessageMetadata(
    taskId: string,
    origin: DeepResearchOrigin = 'dashboard',
  ): Record<string, unknown> {
    return {
      deepResearch: {
        taskId,
        version: 1,
        origin,
      },
    };
  }

  private unwrapHubEnvelope<T>(body: unknown): T {
    if (
      body &&
      typeof body === 'object' &&
      'data' in body &&
      (body as { success?: unknown }).success === true
    ) {
      return (body as { data: T }).data;
    }

    return body as T;
  }

  private getHubErrorMessage(body: unknown): string | undefined {
    if (!body || typeof body !== 'object') return undefined;

    if (
      'message' in body &&
      typeof (body as { message?: unknown }).message === 'string'
    ) {
      return (body as { message: string }).message;
    }

    const error = (body as { error?: unknown }).error;
    if (
      error &&
      typeof error === 'object' &&
      'message' in error &&
      typeof (error as { message?: unknown }).message === 'string'
    ) {
      return (error as { message: string }).message;
    }

    return undefined;
  }

  private async createDeepResearchTask(
    identity: { userId: string; tenantId: string; botId: string },
    body: {
      input: string;
      agentConfig?: { thinkingSummaries?: 'auto' | 'off' };
    },
  ): Promise<{ id: string; status: DeepResearchTaskStatus }> {
    const upstream = await this.capabilityHubClient.request(
      'POST',
      '/api/deep-research/tasks',
      {
        headers: {
          ...this.capabilityHubClient.serviceHeaders(identity),
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );

    let payload: unknown = null;
    try {
      payload = (await upstream.json()) as unknown;
    } catch {
      if (upstream.ok) {
        throw new BadGatewayException(
          'Deep research response could not be parsed.',
        );
      }
    }

    if (!upstream.ok) {
      throw new HttpException(
        payload ?? {
          message:
            this.getHubErrorMessage(payload) ??
            `Deep research request failed with status ${upstream.status}.`,
        },
        upstream.status,
      );
    }

    const task = this.unwrapHubEnvelope<{
      id?: string;
      taskId?: string;
      status?: DeepResearchTaskStatus;
    }>(payload);
    const taskId = task.id ?? task.taskId;

    if (!taskId) {
      throw new BadGatewayException(
        'Deep research response is missing a task id.',
      );
    }

    return {
      id: taskId,
      status: task.status ?? 'pending',
    };
  }

  private async createChannelMessage(
    userId: string,
    channelId: string,
    dto: CreateMessageDto,
  ): Promise<MessageResponse> {
    const t0 = Date.now();

    const isMember = await this.channelsService.isMember(channelId, userId);
    const t1 = Date.now();

    if (!isMember) {
      throw new ForbiddenException('Access denied');
    }

    const clientMsgId = dto.clientMsgId || uuidv7();

    // Get workspaceId (tenantId) from channel for message context
    const channel = await this.channelsService.findById(channelId);
    const t2 = Date.now();
    const workspaceId = channel?.tenantId ?? undefined;

    // Reject messages to deactivated tracking/task channels
    if (channel && !channel.isActivated) {
      throw new ForbiddenException(
        'Channel is deactivated — execution has completed',
      );
    }

    // Reject messages to archived channels (e.g. one-time routine-creation
    // channels archived on finishRoutineCreation). Without this, agent tools
    // like SendToChannel and Reply's non-streaming fallback appear successful
    // but the message never reaches anyone.
    if (channel && channel.isArchived) {
      throw new ForbiddenException(
        'Channel is archived and no longer accepts new messages',
      );
    }

    // Validate @mention permissions (block mentions of restricted personal staff)
    if (dto.content) {
      const mentions = parseMentions(dto.content);
      const mentionedIds = extractMentionedUserIds(mentions);
      if (mentionedIds.length > 0) {
        await this.channelsService.assertMentionsAllowed(userId, mentionedIds);
      }
    }

    // Determine message type based on attachments and content length
    const messageType = determineMessageType(
      dto.content,
      !!dto.attachments?.length,
    );

    // Create message via gRPC
    const result = await this.imWorkerGrpcClientService.createMessage({
      clientMsgId,
      channelId,
      senderId: userId,
      content: dto.content,
      parentId: dto.parentId,
      type: messageType,
      workspaceId,
      attachments: dto.attachments,
      metadata: dto.metadata,
    });
    const t3 = Date.now();

    // Fetch the full message details for response
    const message = await this.messagesService.getMessageWithDetails(
      result.msgId,
    );
    const t4 = Date.now();

    // Set properties if provided
    if (dto.properties && Object.keys(dto.properties).length > 0) {
      await this.messagePropertiesService.batchSet(
        result.msgId,
        Object.entries(dto.properties).map(([key, value]) => ({ key, value })),
        userId,
      );
    }

    // Merge properties into message response
    const [messageWithProps] = await this.messagesService.mergeProperties([
      message,
    ]);
    const previewMessage =
      this.messagesService.truncateForPreview(messageWithProps);

    // Immediately broadcast to online users via Socket.io Redis Adapter
    // Skip broadcast when the message is part of a streaming session (bot will
    // emit streaming_end with the persisted message, which handles the broadcast)
    if (!dto.skipBroadcast) {
      // No excludeUserId — sender's other devices need this
      await this.websocketGateway.sendToChannelMembers(
        channelId,
        WS_EVENTS.MESSAGE.NEW,
        previewMessage,
      );
    }

    const broadcastAt = Date.now();

    // Send post-broadcast task to IM Worker Service via RabbitMQ (event-driven)
    // This handles: unread counts, outbox completion
    if (this.gatewayMQService?.isReady()) {
      const postBroadcastTask: PostBroadcastTask = {
        msgId: result.msgId,
        channelId,
        senderId: userId,
        workspaceId,
        broadcastAt,
      };

      // Fire-and-forget: don't block response for post-broadcast processing
      this.gatewayMQService
        .publishPostBroadcast(postBroadcastTask)
        .catch((err) => {
          this.logger.warn(`Failed to publish post-broadcast task: ${err}`);
          // Outbox processor will handle it as fallback
        });
    } else {
      this.logger.warn(
        `[sendMessage] GatewayMQService not ready, skipping post-broadcast task`,
      );
    }

    const total = Date.now() - t0;
    const timing = `isMember=${t1 - t0}ms findById=${t2 - t1}ms gRPC=${t3 - t2}ms getDetails=${t4 - t3}ms total=${total}ms`;
    if (total > 1000) {
      this.logger.warn(
        `[createMessage] SLOW channel=${channelId} msgId=${result.msgId} ${timing}`,
      );
    } else {
      this.logger.debug(
        `[createMessage] channel=${channelId} msgId=${result.msgId} ${timing}`,
      );
    }

    // Emit event for search indexing
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
      channel: channel,
      sender: message.sender
        ? {
            id: message.sender.id,
            username: message.sender.username,
            displayName: message.sender.displayName,
          }
        : undefined,
    });

    // Publish to RabbitMQ for channel-message triggers (task-worker).
    // Only human-authored messages should trigger agent tasks.
    if (
      this.gatewayMQService &&
      this.shouldPublishChannelMessageTrigger(message)
    ) {
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
    } else if (this.gatewayMQService) {
      this.logger.debug(
        `[createMessage] Skipping channel-message trigger publish for non-human-authored message ${message.id}`,
      );
    }

    // Fire-and-forget AI auto-fill for root messages in public/private channels
    this.triggerAiAutoFill(message, userId);

    return previewMessage;
  }

  @Get('channels/:channelId/messages')
  async getChannelMessages(
    @CurrentUser('sub') userId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
    @Query('after') after?: string,
    @Query('around') around?: string,
  ): Promise<MessageResponse[] | PaginatedMessagesResponse> {
    const t0 = Date.now();

    await this.channelsService.assertReadAccess(channelId, userId);

    const parsedLimit = limit ? parseInt(limit, 10) : 50;
    // When after/around is used, return paginated response with hasOlder/hasNewer
    if (after || around) {
      const paginated = await this.messagesService.getChannelMessagesPaginated(
        channelId,
        parsedLimit,
        { before, after, around },
      );
      return {
        ...paginated,
        messages: paginated.messages.map((m) =>
          this.messagesService.truncateForPreview(m),
        ),
      };
    }
    // Legacy: flat array for backward compatibility (OpenClaw plugin etc.)
    const result = await this.messagesService.getChannelMessages(
      channelId,
      parsedLimit,
      before,
    );

    const total = Date.now() - t0;
    if (total > 1000) {
      this.logger.warn(
        `[getChannelMessages] SLOW channel=${channelId} count=${result.length} total=${total}ms`,
      );
    }

    return result.map((m) => this.messagesService.truncateForPreview(m));
  }

  @Post('channels/:channelId/messages')
  async createMessage(
    @CurrentUser('sub') userId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Body() dto: CreateMessageDto,
  ): Promise<MessageResponse> {
    return this.createChannelMessage(userId, channelId, dto);
  }

  @Post('channels/:channelId/deep-research')
  async startDeepResearch(
    @CurrentUser('sub') userId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Body() dto: StartDeepResearchDto,
  ): Promise<{
    task: { id: string; status: DeepResearchTaskStatus };
    message: MessageResponse;
  }> {
    await this.channelsService.assertReadAccess(channelId, userId);
    const channel = await this.channelsService.findByIdOrThrow(
      channelId,
      userId,
    );

    if (channel.type !== 'direct' || channel.otherUser?.userType !== 'bot') {
      throw new BadRequestException(
        'Deep research can only be started in a bot direct message.',
      );
    }

    if (!channel.tenantId) {
      throw new BadRequestException(
        'Deep research channel is missing a workspace context.',
      );
    }

    const task = await this.createDeepResearchTask(
      {
        userId,
        tenantId: channel.tenantId,
        botId: channel.otherUser.id,
      },
      {
        input: dto.input,
        agentConfig: dto.agentConfig,
      },
    );
    const message = await this.createChannelMessage(userId, channelId, {
      content: dto.input,
      metadata: this.buildDeepResearchMessageMetadata(
        task.id,
        dto.origin ?? 'dashboard',
      ),
    });

    return { task, message };
  }

  @Get('channels/:channelId/pinned')
  async getPinnedMessages(
    @CurrentUser('sub') userId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
  ): Promise<MessageResponse[]> {
    await this.channelsService.assertReadAccess(channelId, userId);
    const pinned = await this.messagesService.getPinnedMessages(channelId);
    return pinned.map((m) => this.messagesService.truncateForPreview(m));
  }

  @Post('channels/:channelId/read')
  async markAsRead(
    @CurrentUser('sub') userId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Body() body: { messageId: string },
  ): Promise<{ success: boolean }> {
    await this.channelsService.assertReadAccess(channelId, userId);
    await this.messagesService.markAsRead(channelId, userId, body.messageId);
    return { success: true };
  }

  @Get('messages/:id')
  async getMessage(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) messageId: string,
  ): Promise<MessageResponse> {
    const message = await this.messagesService.getMessageWithDetails(messageId);
    await this.channelsService.assertReadAccess(message.channelId, userId);
    return this.messagesService.truncateForPreview(message);
  }

  @Get('messages/:id/full-content')
  async getFullContent(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) messageId: string,
  ): Promise<{ content: string }> {
    const channelId = await this.messagesService.getMessageChannelId(messageId);
    await this.channelsService.assertReadAccess(channelId, userId);
    return this.messagesService.getFullContent(messageId);
  }

  @Patch('messages/:id')
  async updateMessage(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) messageId: string,
    @Body() dto: UpdateMessageDto,
  ): Promise<MessageResponse> {
    const message = await this.messagesService.update(messageId, userId, dto);
    const previewMessage = this.messagesService.truncateForPreview(message);

    // Broadcast message update to all channel members via WebSocket
    await this.websocketGateway.sendToChannelMembers(
      message.channelId,
      WS_EVENTS.MESSAGE.UPDATED,
      previewMessage,
    );

    // Emit event for search indexing
    const channel = await this.channelsService.findById(message.channelId);
    if (channel) {
      this.eventEmitter.emit('message.updated', {
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
        channel: channel,
        sender: message.sender
          ? {
              id: message.sender.id,
              username: message.sender.username,
              displayName: message.sender.displayName,
            }
          : undefined,
      });
    }

    // Fire-and-forget AI auto-fill for edited messages
    this.triggerAiAutoFill(message, userId);

    return previewMessage;
  }

  @Delete('messages/:id')
  async deleteMessage(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) messageId: string,
  ): Promise<{ success: boolean }> {
    const channelId = await this.messagesService.getMessageChannelId(messageId);
    const role = await this.channelsService.getMemberRole(channelId, userId);
    await this.messagesService.delete(messageId, userId, role ?? undefined);

    // Broadcast message deletion to all channel members via WebSocket
    await this.websocketGateway.sendToChannelMembers(
      channelId,
      WS_EVENTS.MESSAGE.DELETED,
      { messageId, channelId },
    );

    // Emit event for search index removal
    this.eventEmitter.emit('message.deleted', messageId);

    return { success: true };
  }

  /**
   * Get thread with nested replies (max 2 levels)
   * Supports cursor-based pagination
   */
  @Get('messages/:id/thread')
  async getThread(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) messageId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ): Promise<ThreadResponse> {
    const channelId = await this.messagesService.getMessageChannelId(messageId);
    await this.channelsService.assertReadAccess(channelId, userId);
    const thread = await this.messagesService.getThread(
      messageId,
      limit ? parseInt(limit, 10) : 20,
      cursor,
    );
    const tp = (m: MessageResponse) =>
      this.messagesService.truncateForPreview(m);
    return {
      ...thread,
      rootMessage: tp(thread.rootMessage),
      replies: thread.replies.map((r) => ({
        ...tp(r),
        subReplies: r.subReplies.map(tp),
        subReplyCount: r.subReplyCount,
      })),
    } as ThreadResponse;
  }

  /**
   * Get sub-replies for a first-level reply (for expanding collapsed replies)
   * Supports cursor-based pagination
   */
  @Get('messages/:id/sub-replies')
  async getSubReplies(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) messageId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ): Promise<SubRepliesResponse> {
    const channelId = await this.messagesService.getMessageChannelId(messageId);
    await this.channelsService.assertReadAccess(channelId, userId);
    const subReplies = await this.messagesService.getSubReplies(
      messageId,
      limit ? parseInt(limit, 10) : 20,
      cursor,
    );
    return {
      ...subReplies,
      replies: subReplies.replies.map((m) =>
        this.messagesService.truncateForPreview(m),
      ),
    };
  }

  @Post('messages/:id/pin')
  async pinMessage(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) messageId: string,
  ): Promise<{ success: boolean }> {
    const channelId = await this.messagesService.getMessageChannelId(messageId);
    const role = await this.channelsService.getMemberRole(channelId, userId);
    if (!role || !['owner', 'admin'].includes(role)) {
      throw new ForbiddenException('Insufficient permissions');
    }
    await this.messagesService.pinMessage(messageId, true);
    return { success: true };
  }

  @Delete('messages/:id/pin')
  async unpinMessage(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) messageId: string,
  ): Promise<{ success: boolean }> {
    const channelId = await this.messagesService.getMessageChannelId(messageId);
    const role = await this.channelsService.getMemberRole(channelId, userId);
    if (!role || !['owner', 'admin'].includes(role)) {
      throw new ForbiddenException('Insufficient permissions');
    }
    await this.messagesService.pinMessage(messageId, false);
    return { success: true };
  }

  @Post('messages/:id/reactions')
  async addReaction(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) messageId: string,
    @Body() dto: AddReactionDto,
  ): Promise<{ success: boolean }> {
    await this.messagesService.addReaction(messageId, userId, dto.emoji);
    return { success: true };
  }

  @Delete('messages/:id/reactions/:emoji')
  async removeReaction(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) messageId: string,
    @Param('emoji') emoji: string,
  ): Promise<{ success: boolean }> {
    await this.messagesService.removeReaction(messageId, userId, emoji);
    return { success: true };
  }

  /**
   * Fire-and-forget AI auto-fill for root messages in public/private channels
   * with text/long_text/file/image types that have aiAutoFill definitions.
   */
  private triggerAiAutoFill(message: MessageResponse, userId: string): void {
    const ALLOWED_TYPES = new Set(['text', 'long_text', 'file', 'image']);
    // Only root messages with allowed types
    if (message.parentId !== null || !ALLOWED_TYPES.has(message.type)) {
      return;
    }

    const ALLOWED_CHANNEL_TYPES = new Set(['public', 'private']);

    // Load channel to check type, then check for aiAutoFill definitions
    this.channelsService
      .findById(message.channelId)
      .then((channel) => {
        if (
          !channel ||
          !channel.tenantId ||
          !ALLOWED_CHANNEL_TYPES.has(channel.type)
        ) {
          return;
        }

        const tenantId = channel.tenantId;

        return this.propertyDefinitionsService
          .findAllByChannel(message.channelId)
          .then((definitions) => {
            const hasAutoFill = definitions.some((d) => d.aiAutoFill);
            if (!hasAutoFill) return;

            return this.aiAutoFillService.autoFill(
              message.id,
              userId,
              tenantId,
              { preserveExisting: true },
            );
          });
      })
      .catch((err) => {
        this.logger.warn(
          `AI auto-fill failed for message ${message.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }
}
