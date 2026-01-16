import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  or,
  desc,
  lt,
  sql,
  isNull,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import { RedisService } from '@team9/redis';
import { env } from '@team9/shared';
import {
  CreateMessageDto,
  UpdateMessageDto,
  AttachmentDto,
} from './dto/index.js';
import {
  parseMentions,
  extractMentionedUserIds,
  hasBroadcastMention,
} from '../shared/utils/mention-parser.js';
import { REDIS_KEYS } from '../shared/constants/redis-keys.js';

export interface MessageSender {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
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
}

@Injectable()
export class MessagesService {
  private readonly MESSAGES_CACHE_LIMIT = 50;

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly redisService: RedisService,
  ) {}

  async create(
    channelId: string,
    senderId: string,
    dto: CreateMessageDto,
  ): Promise<MessageResponse> {
    const { content, parentId, attachments } = dto;

    // Calculate rootId based on parentId
    // - Root message: parentId = null, rootId = null
    // - First-level reply: parentId = rootId (both point to root message)
    // - Second-level reply: parentId = first-level reply, rootId = root message
    let rootId: string | null = null;

    if (parentId) {
      const parentInfo = await this.getParentMessageInfo(parentId);
      console.log('[create] parentId:', parentId);
      console.log('[create] parentInfo:', parentInfo);

      if (parentInfo.rootId) {
        // Parent is already a reply (has rootId), so this is a second-level reply
        // Check if parent is already a second-level reply (not allowed)
        if (parentInfo.parentId && parentInfo.parentId !== parentInfo.rootId) {
          throw new BadRequestException(
            'Maximum nesting depth reached. Cannot reply to a second-level reply.',
          );
        }
        rootId = parentInfo.rootId;
      } else {
        // Parent is a root message, so this is a first-level reply
        rootId = parentId;
      }
      console.log('[create] calculated rootId:', rootId);
    }

    // Determine message type
    const type = attachments?.length ? 'file' : 'text';

    // Create message
    const [message] = await this.db
      .insert(schema.messages)
      .values({
        id: uuidv7(),
        channelId,
        senderId,
        content,
        parentId,
        rootId,
        type,
      })
      .returning();

    // Handle attachments
    if (attachments?.length) {
      await this.createAttachments(message.id, attachments);
    }

    // Parse and save mentions
    if (content) {
      await this.saveMentions(message.id, channelId, content);
    }

    // Update unread count for channel members
    await this.incrementUnreadCount(channelId, senderId);

    // Cache recent message
    await this.cacheMessage(channelId, message);

    return this.getMessageWithDetails(message.id);
  }

  private async createAttachments(
    messageId: string,
    attachments: AttachmentDto[],
  ): Promise<void> {
    const attachmentValues = attachments.map((att) => ({
      id: uuidv7(),
      messageId,
      fileKey: att.fileKey,
      fileName: att.fileName,
      fileUrl: `${env.S3_ENDPOINT}/im-attachments/${att.fileKey}`,
      mimeType: att.mimeType,
      fileSize: att.fileSize,
    }));

    await this.db.insert(schema.messageAttachments).values(attachmentValues);
  }

  private async saveMentions(
    messageId: string,
    channelId: string,
    content: string,
  ): Promise<void> {
    const mentions = parseMentions(content);
    if (mentions.length === 0) return;

    const userIds = extractMentionedUserIds(mentions);
    const broadcast = hasBroadcastMention(mentions);

    const mentionRecords: schema.NewMention[] = [];

    // Add user mentions
    for (const userId of userIds) {
      mentionRecords.push({
        id: uuidv7(),
        messageId,
        mentionedUserId: userId,
        type: 'user',
      });
    }

    // Add broadcast mentions
    if (broadcast.everyone) {
      mentionRecords.push({
        id: uuidv7(),
        messageId,
        type: 'everyone',
      });
    }

    if (broadcast.here) {
      mentionRecords.push({
        id: uuidv7(),
        messageId,
        type: 'here',
      });
    }

    if (mentionRecords.length > 0) {
      await this.db.insert(schema.mentions).values(mentionRecords);
    }
  }

  private async incrementUnreadCount(
    channelId: string,
    excludeUserId: string,
  ): Promise<void> {
    // Get channel members excluding sender
    const members = await this.db
      .select({ userId: schema.channelMembers.userId })
      .from(schema.channelMembers)
      .where(
        and(
          eq(schema.channelMembers.channelId, channelId),
          sql`${schema.channelMembers.userId} != ${excludeUserId}`,
          isNull(schema.channelMembers.leftAt),
        ),
      );

    for (const member of members) {
      await this.db
        .insert(schema.userChannelReadStatus)
        .values({
          id: uuidv7(),
          userId: member.userId,
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

  private async cacheMessage(
    channelId: string,
    message: schema.Message,
  ): Promise<void> {
    const key = REDIS_KEYS.RECENT_MESSAGES(channelId);
    const client = this.redisService.getClient();
    await client.lpush(key, JSON.stringify(message));
    await client.ltrim(key, 0, this.MESSAGES_CACHE_LIMIT - 1);
    await this.redisService.expire(key, 3600);
  }

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
   * Get parent message info for determining rootId (single query, O(1))
   */
  private async getParentMessageInfo(
    messageId: string,
  ): Promise<{ parentId: string | null; rootId: string | null }> {
    const [message] = await this.db
      .select({
        parentId: schema.messages.parentId,
        rootId: schema.messages.rootId,
      })
      .from(schema.messages)
      .where(eq(schema.messages.id, messageId))
      .limit(1);

    if (!message) {
      throw new NotFoundException('Parent message not found');
    }

    return {
      parentId: message.parentId,
      rootId: message.rootId,
    };
  }

  /**
   * Get thread with nested replies (max 2 levels)
   * Uses rootId for efficient querying - all replies share the same rootId
   */
  async getThread(rootMessageId: string, limit = 50): Promise<ThreadResponse> {
    // Get root message
    const rootMessage = await this.getMessageWithDetails(rootMessageId);

    // Get ALL replies for this thread in one query using rootId
    const allReplies = await this.db
      .select()
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.rootId, rootMessageId),
          eq(schema.messages.isDeleted, false),
        ),
      )
      .orderBy(schema.messages.createdAt);

    console.log('[getThread] rootMessageId:', rootMessageId);
    console.log('[getThread] allReplies count:', allReplies.length);
    console.log(
      '[getThread] allReplies:',
      allReplies.map((r) => ({
        id: r.id,
        parentId: r.parentId,
        rootId: r.rootId,
      })),
    );

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

    // Apply limit to first-level replies
    const limitedFirstLevel = firstLevelReplies.slice(0, limit);

    // Build thread replies with nested structure
    const replies: ThreadReply[] = await Promise.all(
      limitedFirstLevel.map(async (reply) => {
        const messageDetails = await this.getMessageWithDetails(reply.id);
        const subRepliesRaw = secondLevelByParent.get(reply.id) || [];
        const subReplyCount = subRepliesRaw.length;

        // Only include first 2 sub-replies as preview
        const subRepliesPreview = await Promise.all(
          subRepliesRaw
            .slice(0, 2)
            .map((sr) => this.getMessageWithDetails(sr.id)),
        );

        return {
          ...messageDetails,
          subReplies: subRepliesPreview,
          subReplyCount,
        };
      }),
    );

    // Total reply count = all replies in thread
    const totalReplyCount = allReplies.length;

    return {
      rootMessage,
      replies,
      totalReplyCount,
    };
  }

  /**
   * Get all second-level replies for a first-level reply (for expanding)
   */
  async getSubReplies(
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

    return Promise.all(replies.map((m) => this.getMessageWithDetails(m.id)));
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

    return Promise.all(replies.map((m) => this.getMessageWithDetails(m.id)));
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

  async getUserMentions(
    userId: string,
    limit = 50,
  ): Promise<MessageResponse[]> {
    const mentionRecords = await this.db
      .select({ messageId: schema.mentions.messageId })
      .from(schema.mentions)
      .where(
        and(
          eq(schema.mentions.mentionedUserId, userId),
          eq(schema.mentions.isRead, false),
        ),
      )
      .orderBy(desc(schema.mentions.createdAt))
      .limit(limit);

    const messageIds = mentionRecords.map((m) => m.messageId);
    if (messageIds.length === 0) return [];

    return Promise.all(messageIds.map((id) => this.getMessageWithDetails(id)));
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
