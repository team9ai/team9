import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  desc,
  lt,
  sql,
  isNull,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import { RedisService } from '@team9/redis';
import { CreateMessageDto, UpdateMessageDto, AttachmentDto } from './dto.js';
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

    // Determine message type
    const type = attachments?.length ? 'file' : 'text';

    // Create message
    const [message] = await this.db
      .insert(schema.messages)
      .values({
        channelId,
        senderId,
        content,
        parentId,
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
      messageId,
      fileKey: att.fileKey,
      fileName: att.fileName,
      fileUrl: `${process.env.S3_ENDPOINT || 'http://localhost:9000'}/im-attachments/${att.fileKey}`,
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
        messageId,
        mentionedUserId: userId,
        type: 'user',
      });
    }

    // Add broadcast mentions
    if (broadcast.everyone) {
      mentionRecords.push({
        messageId,
        type: 'everyone',
      });
    }

    if (broadcast.here) {
      mentionRecords.push({
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
      .values({ messageId, userId, emoji })
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
