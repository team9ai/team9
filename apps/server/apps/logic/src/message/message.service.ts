import { Injectable, Logger, Inject } from '@nestjs/common';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  sql,
  isNull,
  gt,
  desc,
} from '@team9/database';
import type { PostgresJsDatabase } from '@team9/database';
import * as schema from '@team9/database/schemas';
import { RedisService } from '@team9/redis';
import { v4 as uuidv4 } from 'uuid';
import type {
  UpstreamMessage,
  IMMessageEnvelope,
  TextMessagePayload,
  ServerAckResponse,
  CreateMessageDto,
  CreateMessageResponse,
  OutboxEventPayload,
} from '@team9/shared';
import { SequenceService } from '../sequence/sequence.service.js';
import { MessageRouterService } from './message-router.service.js';

const REDIS_KEYS = {
  MSG_DEDUP: (clientMsgId: string) => `im:dedup:${clientMsgId}`,
  RECENT_MESSAGES: (channelId: string) => `im:recent_messages:${channelId}`,
};

/**
 * Message Service - handles message processing in Logic Service
 *
 * Responsibilities:
 * - Process upstream messages from Gateway
 * - Generate sequence IDs
 * - Store messages in database
 * - Route messages to recipients
 */
@Injectable()
export class MessageService {
  private readonly logger = new Logger(MessageService.name);

  // Dedup key TTL: 5 minutes
  private readonly DEDUP_TTL = 300;

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly redisService: RedisService,
    private readonly sequenceService: SequenceService,
    private readonly routerService: MessageRouterService,
  ) {}

  /**
   * Process incoming message from Gateway
   */
  async processUpstreamMessage(
    upstream: UpstreamMessage,
  ): Promise<ServerAckResponse> {
    const { message, userId, gatewayId } = upstream;

    try {
      // Check for duplicate (if clientMsgId provided)
      if (message.clientMsgId) {
        const existing = await this.checkDuplicate(message.clientMsgId);
        if (existing) {
          this.logger.debug(`Duplicate message: ${message.clientMsgId}`);
          return {
            msgId: existing.msgId,
            clientMsgId: message.clientMsgId,
            status: 'duplicate',
            seqId: existing.seqId?.toString(),
            serverTime: Date.now(),
          };
        }
      }

      // Generate message ID and sequence
      const msgId = uuidv4();
      const seqId = await this.sequenceService.generateChannelSeq(
        message.targetId,
      );

      // Store message in database
      await this.storeMessage(
        {
          ...message,
          msgId,
          seqId,
        },
        userId,
        gatewayId,
      );

      // Mark as processed (for dedup)
      if (message.clientMsgId) {
        await this.markAsProcessed(message.clientMsgId, msgId, seqId);
      }

      // Get channel members and route message
      const memberIds = await this.getChannelMemberIds(message.targetId);
      const recipientIds = memberIds.filter((id) => id !== userId);

      if (recipientIds.length > 0) {
        const enrichedMessage: IMMessageEnvelope = {
          ...message,
          msgId,
          seqId,
          senderId: userId,
        };

        await this.routerService.routeMessage(enrichedMessage, recipientIds);
      }

      // Update unread counts
      await this.updateUnreadCounts(message.targetId, userId, recipientIds);

      this.logger.debug(
        `Processed message ${msgId} (seq: ${seqId}) for channel ${message.targetId}`,
      );

      return {
        msgId,
        clientMsgId: message.clientMsgId,
        status: 'ok',
        seqId: seqId.toString(),
        serverTime: Date.now(),
      };
    } catch (error) {
      this.logger.error(`Failed to process message: ${error}`);
      return {
        msgId: '',
        clientMsgId: message.clientMsgId,
        status: 'error',
        serverTime: Date.now(),
        error: (error as Error).message,
      };
    }
  }

  /**
   * Check for duplicate message
   */
  private async checkDuplicate(
    clientMsgId: string,
  ): Promise<{ msgId: string; seqId: bigint } | null> {
    const key = REDIS_KEYS.MSG_DEDUP(clientMsgId);
    const data = await this.redisService.get(key);

    if (!data) {
      return null;
    }

    try {
      const parsed = JSON.parse(data);
      return {
        msgId: parsed.msgId,
        seqId: BigInt(parsed.seqId),
      };
    } catch {
      return null;
    }
  }

  /**
   * Mark message as processed (for dedup)
   */
  private async markAsProcessed(
    clientMsgId: string,
    msgId: string,
    seqId: bigint,
  ): Promise<void> {
    const key = REDIS_KEYS.MSG_DEDUP(clientMsgId);
    await this.redisService.set(
      key,
      JSON.stringify({ msgId, seqId: seqId.toString() }),
      this.DEDUP_TTL,
    );
  }

  /**
   * Store message in database
   */
  private async storeMessage(
    message: IMMessageEnvelope & { seqId: bigint },
    senderId: string,
    gatewayId: string,
  ): Promise<void> {
    const payload = message.payload as TextMessagePayload;

    await this.db.insert(schema.messages).values({
      id: message.msgId,
      channelId: message.targetId,
      senderId,
      content: payload.content,
      parentId: payload.parentId,
      type: message.type as 'text' | 'file' | 'image' | 'system',
      seqId: message.seqId,
      clientMsgId: message.clientMsgId,
      gatewayId,
    });

    // Cache recent message
    await this.cacheRecentMessage(message.targetId, message);
  }

  /**
   * Cache recent message in Redis
   */
  private async cacheRecentMessage(
    channelId: string,
    message: IMMessageEnvelope,
  ): Promise<void> {
    const key = REDIS_KEYS.RECENT_MESSAGES(channelId);
    const client = this.redisService.getClient();

    await client.lpush(key, JSON.stringify(message));
    await client.ltrim(key, 0, 49); // Keep last 50
    await this.redisService.expire(key, 3600); // 1 hour TTL
  }

  /**
   * Get channel member IDs
   */
  private async getChannelMemberIds(channelId: string): Promise<string[]> {
    const members = await this.db
      .select({ userId: schema.channelMembers.userId })
      .from(schema.channelMembers)
      .where(
        and(
          eq(schema.channelMembers.channelId, channelId),
          isNull(schema.channelMembers.leftAt),
        ),
      );

    return members.map((m) => m.userId);
  }

  /**
   * Update unread counts for recipients
   */
  private async updateUnreadCounts(
    channelId: string,
    senderId: string,
    recipientIds: string[],
  ): Promise<void> {
    for (const userId of recipientIds) {
      await this.db
        .insert(schema.userChannelReadStatus)
        .values({
          userId,
          channelId,
          unreadCount: 1,
        })
        .onConflictDoUpdate({
          target: [
            schema.userChannelReadStatus.userId,
            schema.userChannelReadStatus.channelId,
          ],
          set: {
            unreadCount: sql`${schema.userChannelReadStatus.unreadCount} + 1`,
          },
        });
    }
  }

  /**
   * Get messages for sync (after a certain seqId)
   */
  async getMessagesSince(
    channelId: string,
    afterSeqId: bigint,
    limit = 50,
  ): Promise<schema.Message[]> {
    return this.db
      .select()
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.channelId, channelId),
          sql`${schema.messages.seqId} > ${afterSeqId}`,
          eq(schema.messages.isDeleted, false),
        ),
      )
      .orderBy(schema.messages.seqId)
      .limit(limit);
  }

  /**
   * Get undelivered messages for a user (for offline message delivery)
   * Returns messages that the user hasn't read yet across all their channels
   */
  async getUndeliveredMessages(
    userId: string,
    limit = 50,
  ): Promise<IMMessageEnvelope[]> {
    // Get user's channel read status
    const readStatuses = await this.db
      .select({
        channelId: schema.userChannelReadStatus.channelId,
        lastReadMessageId: schema.userChannelReadStatus.lastReadMessageId,
        unreadCount: schema.userChannelReadStatus.unreadCount,
      })
      .from(schema.userChannelReadStatus)
      .where(
        and(
          eq(schema.userChannelReadStatus.userId, userId),
          gt(schema.userChannelReadStatus.unreadCount, 0),
        ),
      );

    if (readStatuses.length === 0) {
      return [];
    }

    const messages: IMMessageEnvelope[] = [];

    for (const status of readStatuses) {
      // Get unread messages for this channel
      let query = this.db
        .select()
        .from(schema.messages)
        .where(
          and(
            eq(schema.messages.channelId, status.channelId),
            eq(schema.messages.isDeleted, false),
          ),
        )
        .orderBy(desc(schema.messages.createdAt))
        .limit(Math.min(status.unreadCount, limit));

      // If we have a last read message, filter to newer messages
      if (status.lastReadMessageId) {
        const lastReadMsg = await this.db
          .select({ seqId: schema.messages.seqId })
          .from(schema.messages)
          .where(eq(schema.messages.id, status.lastReadMessageId))
          .limit(1);

        if (lastReadMsg.length > 0 && lastReadMsg[0].seqId) {
          query = this.db
            .select()
            .from(schema.messages)
            .where(
              and(
                eq(schema.messages.channelId, status.channelId),
                eq(schema.messages.isDeleted, false),
                gt(schema.messages.seqId, lastReadMsg[0].seqId),
              ),
            )
            .orderBy(schema.messages.seqId)
            .limit(Math.min(status.unreadCount, limit));
        }
      }

      const channelMessages = await query;

      // Convert to IMMessageEnvelope format
      for (const msg of channelMessages) {
        messages.push(this.toMessageEnvelope(msg));
      }

      // Limit total messages
      if (messages.length >= limit) {
        break;
      }
    }

    return messages.slice(0, limit);
  }

  /**
   * Convert database message to IMMessageEnvelope
   */
  private toMessageEnvelope(msg: schema.Message): IMMessageEnvelope {
    return {
      msgId: msg.id,
      seqId: msg.seqId ?? undefined,
      clientMsgId: msg.clientMsgId ?? undefined,
      type: msg.type as 'text' | 'file' | 'image' | 'system',
      senderId: msg.senderId,
      targetType: 'channel',
      targetId: msg.channelId,
      payload: {
        content: msg.content ?? '',
        parentId: msg.parentId ?? undefined,
      },
      timestamp: msg.createdAt.getTime(),
    };
  }

  // ============ HTTP API Methods (with Outbox Pattern) ============

  /**
   * Create and persist a message with Outbox pattern
   * Used by Gateway via HTTP API for synchronous message creation
   *
   * This method:
   * 1. Checks for duplicates
   * 2. Generates msgId and seqId
   * 3. Writes message + outbox event in a single transaction
   * 4. Returns immediately (outbox processor handles delivery)
   */
  async createAndPersist(
    dto: CreateMessageDto,
  ): Promise<CreateMessageResponse> {
    const timestamp = Date.now();

    try {
      // 1. Check for duplicate
      if (dto.clientMsgId) {
        const existing = await this.checkDuplicate(dto.clientMsgId);
        if (existing) {
          this.logger.debug(`Duplicate message via HTTP: ${dto.clientMsgId}`);
          return {
            msgId: existing.msgId,
            seqId: existing.seqId.toString(),
            clientMsgId: dto.clientMsgId,
            status: 'duplicate',
            timestamp,
          };
        }
      }

      // 2. Generate IDs
      const msgId = uuidv4();
      const seqId = await this.sequenceService.generateChannelSeq(
        dto.channelId,
      );

      // 3. Build outbox payload
      const outboxPayload: OutboxEventPayload = {
        msgId,
        channelId: dto.channelId,
        senderId: dto.senderId,
        content: dto.content,
        parentId: dto.parentId,
        type: dto.type,
        seqId: seqId.toString(),
        timestamp,
        workspaceId: dto.workspaceId,
        metadata: dto.metadata,
      };

      // 4. Write message + outbox in transaction
      await this.db.transaction(async (tx) => {
        // Insert message
        await tx.insert(schema.messages).values({
          id: msgId,
          channelId: dto.channelId,
          senderId: dto.senderId,
          content: dto.content,
          parentId: dto.parentId,
          type: dto.type,
          seqId,
          clientMsgId: dto.clientMsgId,
          metadata: dto.metadata,
        });

        // Insert outbox event
        await tx.insert(schema.messageOutbox).values({
          messageId: msgId,
          eventType: 'message_created',
          payload: outboxPayload,
          status: 'pending',
        });
      });

      // 5. Mark as processed for dedup
      if (dto.clientMsgId) {
        await this.markAsProcessed(dto.clientMsgId, msgId, seqId);
      }

      // 6. Cache recent message
      const envelope: IMMessageEnvelope = {
        msgId,
        seqId,
        clientMsgId: dto.clientMsgId,
        type: dto.type,
        senderId: dto.senderId,
        targetType: 'channel',
        targetId: dto.channelId,
        payload: {
          content: dto.content,
          parentId: dto.parentId,
        },
        timestamp,
      };
      await this.cacheRecentMessage(dto.channelId, envelope);

      this.logger.debug(
        `Created message ${msgId} (seq: ${seqId}) via HTTP API for channel ${dto.channelId}`,
      );

      return {
        msgId,
        seqId: seqId.toString(),
        clientMsgId: dto.clientMsgId,
        status: 'persisted',
        timestamp,
      };
    } catch (error) {
      this.logger.error(`Failed to create message via HTTP: ${error}`);
      throw error;
    }
  }

  /**
   * Get channel member IDs (public for Outbox processor)
   */
  async getChannelMemberIdsPublic(channelId: string): Promise<string[]> {
    return this.getChannelMemberIds(channelId);
  }
}
