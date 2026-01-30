import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  desc,
  lt,
  sql,
  isNull,
  inArray,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import { UpdateMessageDto } from './dto/index.js';

export interface MessageSender {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  userType: 'human' | 'bot' | 'system';
}

export interface MessageAttachmentResponse {
  id: string;
  fileName: string;
  fileKey: string;
  fileUrl: string;
  fileSize: number;
  mimeType: string;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
}

export interface MessageReactionResponse {
  emoji: string;
  count: number;
  userIds: string[];
}

export interface MessageResponse {
  id: string;
  channelId: string;
  senderId: string | null;
  parentId: string | null;
  rootId: string | null;
  content: string | null;
  type: 'text' | 'file' | 'image' | 'system';
  isPinned: boolean;
  isEdited: boolean;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
  sender: MessageSender | null;
  attachments: MessageAttachmentResponse[];
  reactions: MessageReactionResponse[];
  replyCount: number;
}

// Thread response types for nested replies (max 2 levels)
export interface ThreadReply extends MessageResponse {
  subReplies: MessageResponse[]; // Second-level replies (preview, max 2)
  subReplyCount: number; // Total count of second-level replies
}

export interface ThreadResponse {
  rootMessage: MessageResponse;
  replies: ThreadReply[];
  totalReplyCount: number;
  hasMore: boolean; // Whether there are more first-level replies
  nextCursor: string | null; // Cursor for next page (createdAt of last reply)
}

export interface SubRepliesResponse {
  replies: MessageResponse[];
  hasMore: boolean;
  nextCursor: string | null;
}

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async getMessageWithDetails(messageId: string): Promise<MessageResponse> {
    const [message] = await this.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.id, messageId))
      .limit(1);

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    // Get sender
    let sender: MessageSender | null = null;
    if (message.senderId) {
      const [user] = await this.db
        .select({
          id: schema.users.id,
          username: schema.users.username,
          displayName: schema.users.displayName,
          avatarUrl: schema.users.avatarUrl,
          userType: schema.users.userType,
        })
        .from(schema.users)
        .where(eq(schema.users.id, message.senderId))
        .limit(1);
      sender = user || null;
    }

    // Get attachments
    const attachments = await this.db
      .select()
      .from(schema.messageAttachments)
      .where(eq(schema.messageAttachments.messageId, messageId));

    // Get reactions
    const reactionsRaw = await this.db
      .select({
        emoji: schema.messageReactions.emoji,
        userId: schema.messageReactions.userId,
      })
      .from(schema.messageReactions)
      .where(eq(schema.messageReactions.messageId, messageId));

    const reactionsMap = new Map<string, string[]>();
    reactionsRaw.forEach((r) => {
      const arr = reactionsMap.get(r.emoji) || [];
      arr.push(r.userId);
      reactionsMap.set(r.emoji, arr);
    });

    const reactions: MessageReactionResponse[] = Array.from(
      reactionsMap.entries(),
    ).map(([emoji, userIds]) => ({
      emoji,
      count: userIds.length,
      userIds,
    }));

    // Get reply count
    const [{ count: replyCount }] = await this.db
      .select({ count: sql<number>`COUNT(*)` })
      .from(schema.messages)
      .where(eq(schema.messages.parentId, messageId));

    return {
      id: message.id,
      channelId: message.channelId,
      senderId: message.senderId,
      parentId: message.parentId,
      rootId: message.rootId,
      content: message.content,
      type: message.type,
      isPinned: message.isPinned,
      isEdited: message.isEdited,
      isDeleted: message.isDeleted,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
      sender,
      attachments,
      reactions,
      replyCount: Number(replyCount),
    };
  }

  /**
   * Batch get message details for multiple messages
   * Optimized to use only 4 queries instead of N*4 queries
   */
  private async getMessagesWithDetailsBatch(
    messages: schema.Message[],
  ): Promise<Map<string, MessageResponse>> {
    if (messages.length === 0) {
      return new Map();
    }

    const messageIds = messages.map((m) => m.id);
    const senderIds = [
      ...new Set(messages.map((m) => m.senderId).filter(Boolean)),
    ] as string[];

    // Batch query 1: Get all senders
    const sendersMap = new Map<string, MessageSender>();
    if (senderIds.length > 0) {
      const senders = await this.db
        .select({
          id: schema.users.id,
          username: schema.users.username,
          displayName: schema.users.displayName,
          avatarUrl: schema.users.avatarUrl,
          userType: schema.users.userType,
        })
        .from(schema.users)
        .where(inArray(schema.users.id, senderIds));

      senders.forEach((s) => sendersMap.set(s.id, s));
    }

    // Batch query 2: Get all attachments
    const attachmentsMap = new Map<string, MessageAttachmentResponse[]>();
    const allAttachments = await this.db
      .select()
      .from(schema.messageAttachments)
      .where(inArray(schema.messageAttachments.messageId, messageIds));

    allAttachments.forEach((att) => {
      const existing = attachmentsMap.get(att.messageId) || [];
      existing.push(att);
      attachmentsMap.set(att.messageId, existing);
    });

    // Batch query 3: Get all reactions
    const reactionsMap = new Map<string, MessageReactionResponse[]>();
    const allReactions = await this.db
      .select({
        messageId: schema.messageReactions.messageId,
        emoji: schema.messageReactions.emoji,
        userId: schema.messageReactions.userId,
      })
      .from(schema.messageReactions)
      .where(inArray(schema.messageReactions.messageId, messageIds));

    // Group reactions by messageId, then by emoji
    const reactionsByMessage = new Map<string, Map<string, string[]>>();
    allReactions.forEach((r) => {
      if (!reactionsByMessage.has(r.messageId)) {
        reactionsByMessage.set(r.messageId, new Map());
      }
      const emojiMap = reactionsByMessage.get(r.messageId)!;
      const userIds = emojiMap.get(r.emoji) || [];
      userIds.push(r.userId);
      emojiMap.set(r.emoji, userIds);
    });

    // Convert to MessageReactionResponse format
    reactionsByMessage.forEach((emojiMap, messageId) => {
      const reactions: MessageReactionResponse[] = Array.from(
        emojiMap.entries(),
      ).map(([emoji, userIds]) => ({
        emoji,
        count: userIds.length,
        userIds,
      }));
      reactionsMap.set(messageId, reactions);
    });

    // Batch query 4: Get reply counts for all messages
    const replyCountsMap = new Map<string, number>();
    const replyCounts = await this.db
      .select({
        parentId: schema.messages.parentId,
        count: sql<number>`COUNT(*)`,
      })
      .from(schema.messages)
      .where(inArray(schema.messages.parentId, messageIds))
      .groupBy(schema.messages.parentId);

    replyCounts.forEach((rc) => {
      if (rc.parentId) {
        replyCountsMap.set(rc.parentId, Number(rc.count));
      }
    });

    // Build result map
    const result = new Map<string, MessageResponse>();
    messages.forEach((message) => {
      result.set(message.id, {
        id: message.id,
        channelId: message.channelId,
        senderId: message.senderId,
        parentId: message.parentId,
        rootId: message.rootId,
        content: message.content,
        type: message.type,
        isPinned: message.isPinned,
        isEdited: message.isEdited,
        isDeleted: message.isDeleted,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
        sender: message.senderId
          ? sendersMap.get(message.senderId) || null
          : null,
        attachments: attachmentsMap.get(message.id) || [],
        reactions: reactionsMap.get(message.id) || [],
        replyCount: replyCountsMap.get(message.id) || 0,
      });
    });

    return result;
  }

  async getChannelMessages(
    channelId: string,
    limit = 50,
    before?: string,
  ): Promise<MessageResponse[]> {
    let query = this.db
      .select()
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.channelId, channelId),
          eq(schema.messages.isDeleted, false),
          isNull(schema.messages.parentId),
        ),
      )
      .orderBy(desc(schema.messages.createdAt))
      .limit(limit);

    if (before) {
      const [beforeMessage] = await this.db
        .select({ createdAt: schema.messages.createdAt })
        .from(schema.messages)
        .where(eq(schema.messages.id, before))
        .limit(1);

      if (beforeMessage) {
        query = this.db
          .select()
          .from(schema.messages)
          .where(
            and(
              eq(schema.messages.channelId, channelId),
              eq(schema.messages.isDeleted, false),
              isNull(schema.messages.parentId),
              lt(schema.messages.createdAt, beforeMessage.createdAt),
            ),
          )
          .orderBy(desc(schema.messages.createdAt))
          .limit(limit);
      }
    }

    const messageList = await query;
    return Promise.all(
      messageList.map((m) => this.getMessageWithDetails(m.id)),
    );
  }

  /**
   * Get thread with nested replies (max 2 levels)
   * Uses rootId for efficient querying - all replies share the same rootId
   * Optimized: Uses batch queries instead of N+1 queries
   * Supports cursor-based pagination for first-level replies
   *
   * @param rootMessageId - The root message ID
   * @param limit - Max number of first-level replies to return (default 20)
   * @param cursor - Cursor for pagination (createdAt ISO string of last reply)
   */
  async getThread(
    rootMessageId: string,
    limit = 20,
    cursor?: string,
  ): Promise<ThreadResponse> {
    // Get root message
    const rootMessage = await this.getMessageWithDetails(rootMessageId);

    // Build query conditions
    const conditions = [
      eq(schema.messages.rootId, rootMessageId),
      eq(schema.messages.isDeleted, false),
    ];

    // Parse cursor (ISO date string)
    let cursorDate: Date | null = null;
    if (cursor) {
      cursorDate = new Date(cursor);
      if (isNaN(cursorDate.getTime())) {
        cursorDate = null;
      }
    }

    // Get ALL replies for this thread in one query using rootId
    const allReplies = await this.db
      .select()
      .from(schema.messages)
      .where(and(...conditions))
      .orderBy(schema.messages.createdAt);

    // Separate first-level and second-level replies
    // First-level: parentId === rootId
    // Second-level: parentId !== rootId (parentId points to a first-level reply)
    const firstLevelReplies: schema.Message[] = [];
    const secondLevelByParent = new Map<string, schema.Message[]>();

    for (const reply of allReplies) {
      if (reply.parentId === rootMessageId) {
        // First-level reply
        firstLevelReplies.push(reply);
      } else if (reply.parentId) {
        // Second-level reply - group by parent
        const existing = secondLevelByParent.get(reply.parentId) || [];
        existing.push(reply);
        secondLevelByParent.set(reply.parentId, existing);
      }
    }

    // Apply cursor filter for first-level replies
    let filteredFirstLevel = firstLevelReplies;
    if (cursorDate) {
      filteredFirstLevel = firstLevelReplies.filter(
        (r) => r.createdAt > cursorDate!,
      );
    }

    // Apply limit + 1 to check if there are more
    const limitedFirstLevel = filteredFirstLevel.slice(0, limit + 1);
    const hasMore = limitedFirstLevel.length > limit;
    const actualFirstLevel = limitedFirstLevel.slice(0, limit);

    // Calculate next cursor
    const lastReply = actualFirstLevel[actualFirstLevel.length - 1];
    const nextCursor =
      hasMore && lastReply ? lastReply.createdAt.toISOString() : null;

    // Collect all messages that need details (first-level + preview sub-replies)
    const messagesToFetch: schema.Message[] = [...actualFirstLevel];
    for (const firstLevel of actualFirstLevel) {
      const subReplies = secondLevelByParent.get(firstLevel.id) || [];
      // Only fetch first 2 sub-replies as preview
      messagesToFetch.push(...subReplies.slice(0, 2));
    }

    // Batch fetch all message details in 4 queries instead of N*4
    const messageDetailsMap =
      await this.getMessagesWithDetailsBatch(messagesToFetch);

    // Build thread replies with nested structure (pure memory operations)
    const replies: ThreadReply[] = actualFirstLevel.map((reply) => {
      const messageDetails = messageDetailsMap.get(reply.id)!;
      const subRepliesRaw = secondLevelByParent.get(reply.id) || [];
      const subReplyCount = subRepliesRaw.length;

      // Get pre-fetched sub-reply details
      const subRepliesPreview = subRepliesRaw
        .slice(0, 2)
        .map((sr) => messageDetailsMap.get(sr.id)!);

      return {
        ...messageDetails,
        subReplies: subRepliesPreview,
        subReplyCount,
      };
    });

    // Total first-level reply count
    const totalReplyCount = firstLevelReplies.length;

    return {
      rootMessage,
      replies,
      totalReplyCount,
      hasMore,
      nextCursor,
    };
  }

  /**
   * Get second-level replies for a first-level reply (for expanding)
   * Optimized: Uses batch queries instead of N+1 queries
   * Supports cursor-based pagination
   *
   * @param parentId - The first-level reply ID
   * @param limit - Max number of replies to return (default 20)
   * @param cursor - Cursor for pagination (createdAt ISO string of last reply)
   */
  async getSubReplies(
    parentId: string,
    limit = 20,
    cursor?: string,
  ): Promise<SubRepliesResponse> {
    // Build query conditions
    const conditions = [
      eq(schema.messages.parentId, parentId),
      eq(schema.messages.isDeleted, false),
    ];

    // Parse cursor - convert to ISO string for postgres driver compatibility
    if (cursor) {
      const cursorDate = new Date(cursor);
      if (!isNaN(cursorDate.getTime())) {
        conditions.push(
          sql`${schema.messages.createdAt} > ${cursorDate.toISOString()}`,
        );
      }
    }

    // Fetch limit + 1 to check if there are more
    const replies = await this.db
      .select()
      .from(schema.messages)
      .where(and(...conditions))
      .orderBy(schema.messages.createdAt)
      .limit(limit + 1);

    const hasMore = replies.length > limit;
    const actualReplies = replies.slice(0, limit);

    // Calculate next cursor
    const lastReply = actualReplies[actualReplies.length - 1];
    const nextCursor =
      hasMore && lastReply ? lastReply.createdAt.toISOString() : null;

    // Use batch query instead of N individual queries
    const detailsMap = await this.getMessagesWithDetailsBatch(actualReplies);

    return {
      replies: actualReplies.map((m) => detailsMap.get(m.id)!),
      hasMore,
      nextCursor,
    };
  }

  /**
   * @deprecated Use getThread() instead for nested thread structure
   */
  async getThreadReplies(
    parentId: string,
    limit = 50,
  ): Promise<MessageResponse[]> {
    const replies = await this.db
      .select()
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.parentId, parentId),
          eq(schema.messages.isDeleted, false),
        ),
      )
      .orderBy(schema.messages.createdAt)
      .limit(limit);

    // Use batch query instead of N individual queries
    const detailsMap = await this.getMessagesWithDetailsBatch(replies);
    return replies.map((m) => detailsMap.get(m.id)!);
  }

  async update(
    messageId: string,
    userId: string,
    dto: UpdateMessageDto,
  ): Promise<MessageResponse> {
    const [message] = await this.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.id, messageId))
      .limit(1);

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    if (message.senderId !== userId) {
      throw new ForbiddenException('Cannot edit message from another user');
    }

    await this.db
      .update(schema.messages)
      .set({
        content: dto.content,
        isEdited: true,
        updatedAt: new Date(),
      })
      .where(eq(schema.messages.id, messageId));

    return this.getMessageWithDetails(messageId);
  }

  async delete(messageId: string, userId: string): Promise<void> {
    const [message] = await this.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.id, messageId))
      .limit(1);

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    if (message.senderId !== userId) {
      throw new ForbiddenException('Cannot delete message from another user');
    }

    await this.db
      .update(schema.messages)
      .set({
        isDeleted: true,
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.messages.id, messageId));
  }

  async pinMessage(messageId: string, isPinned: boolean): Promise<void> {
    await this.db
      .update(schema.messages)
      .set({ isPinned, updatedAt: new Date() })
      .where(eq(schema.messages.id, messageId));
  }

  async getPinnedMessages(channelId: string): Promise<MessageResponse[]> {
    const messages = await this.db
      .select()
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.channelId, channelId),
          eq(schema.messages.isPinned, true),
          eq(schema.messages.isDeleted, false),
        ),
      )
      .orderBy(desc(schema.messages.createdAt));

    return Promise.all(messages.map((m) => this.getMessageWithDetails(m.id)));
  }

  async addReaction(
    messageId: string,
    userId: string,
    emoji: string,
  ): Promise<void> {
    await this.db
      .insert(schema.messageReactions)
      .values({ id: uuidv7(), messageId, userId, emoji })
      .onConflictDoNothing();
  }

  async removeReaction(
    messageId: string,
    userId: string,
    emoji: string,
  ): Promise<void> {
    await this.db
      .delete(schema.messageReactions)
      .where(
        and(
          eq(schema.messageReactions.messageId, messageId),
          eq(schema.messageReactions.userId, userId),
          eq(schema.messageReactions.emoji, emoji),
        ),
      );
  }

  async markAsRead(
    channelId: string,
    userId: string,
    messageId: string,
  ): Promise<void> {
    // Validate messageId format - must be a valid UUID
    // Temporary IDs (e.g., "temp-1234567890-abc123") should be filtered on the client side,
    // but we add server-side validation as a defensive measure
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!messageId || !uuidRegex.test(messageId)) {
      this.logger.warn(
        `[markAsRead] Invalid messageId format: ${messageId} for user ${userId} in channel ${channelId}. Skipping.`,
      );
      return; // Silently skip instead of throwing error to avoid breaking client flow
    }

    // Check if messageId is a temporary ID (starts with "temp-")
    if (messageId.startsWith('temp-')) {
      this.logger.warn(
        `[markAsRead] Temporary messageId detected: ${messageId} for user ${userId} in channel ${channelId}. Skipping.`,
      );
      return;
    }

    // Verify that the message exists in the database
    const [existingMessage] = await this.db
      .select({ id: schema.messages.id })
      .from(schema.messages)
      .where(eq(schema.messages.id, messageId))
      .limit(1);

    if (!existingMessage) {
      this.logger.warn(
        `[markAsRead] Message ${messageId} not found in database for user ${userId} in channel ${channelId}. Skipping.`,
      );
      return; // Message doesn't exist yet (likely still being processed by server)
    }

    // All validations passed - update read status
    await this.db
      .insert(schema.userChannelReadStatus)
      .values({
        id: uuidv7(),
        userId,
        channelId,
        lastReadMessageId: messageId,
        lastReadAt: new Date(),
        unreadCount: 0,
      })
      .onConflictDoUpdate({
        target: [
          schema.userChannelReadStatus.userId,
          schema.userChannelReadStatus.channelId,
        ],
        set: {
          lastReadMessageId: messageId,
          lastReadAt: new Date(),
          unreadCount: 0,
        },
      });
  }

  async getMessageChannelId(messageId: string): Promise<string> {
    const [message] = await this.db
      .select({ channelId: schema.messages.channelId })
      .from(schema.messages)
      .where(eq(schema.messages.id, messageId))
      .limit(1);

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    return message.channelId;
  }
}
