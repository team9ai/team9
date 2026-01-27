import { Injectable, Inject, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  DATABASE_CONNECTION,
  sql,
  eq,
  and,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';

export interface MessageIndexPayload {
  message: schema.Message;
  channel: schema.Channel;
  sender?: schema.User;
}

export interface ChannelIndexPayload {
  channel: schema.Channel;
}

export interface UserIndexPayload {
  user: schema.User;
}

export interface FileIndexPayload {
  file: schema.File;
  channel?: schema.Channel;
  uploader?: schema.User;
}

@Injectable()
export class SearchIndexerService {
  private readonly logger = new Logger(SearchIndexerService.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  // ==========================================
  // Message Indexing
  // ==========================================

  async indexMessage(
    message: schema.Message,
    channel: schema.Channel,
    sender?: schema.User,
  ): Promise<void> {
    const searchText = (message.content || '').toLowerCase();
    const hasAttachment = await this.checkHasAttachment(message.id);

    try {
      await this.db
        .insert(schema.messageSearch)
        .values({
          messageId: message.id,
          searchVector: sql`to_tsvector('simple', ${searchText})`,
          contentSnapshot: message.content,
          channelId: message.channelId,
          channelName: channel.name,
          senderId: message.senderId,
          senderUsername: sender?.username,
          senderDisplayName: sender?.displayName,
          messageType: message.type,
          hasAttachment,
          isPinned: message.isPinned,
          isThreadReply: !!message.parentId,
          tenantId: channel.tenantId,
          messageCreatedAt: message.createdAt,
        })
        .onConflictDoUpdate({
          target: schema.messageSearch.messageId,
          set: {
            searchVector: sql`to_tsvector('simple', ${searchText})`,
            contentSnapshot: message.content,
            isPinned: message.isPinned,
            hasAttachment,
            updatedAt: new Date(),
          },
        });
    } catch (error) {
      this.logger.error(`Failed to index message ${message.id}:`, error);
    }
  }

  async removeMessageIndex(messageId: string): Promise<void> {
    try {
      await this.db
        .delete(schema.messageSearch)
        .where(eq(schema.messageSearch.messageId, messageId));
    } catch (error) {
      this.logger.error(`Failed to remove message index ${messageId}:`, error);
    }
  }

  // ==========================================
  // Channel Indexing
  // ==========================================

  async indexChannel(channel: schema.Channel): Promise<void> {
    const searchText =
      `${channel.name || ''} ${channel.description || ''}`.toLowerCase();
    const memberCount = await this.getChannelMemberCount(channel.id);

    try {
      await this.db
        .insert(schema.channelSearch)
        .values({
          channelId: channel.id,
          searchVector: sql`to_tsvector('simple', ${searchText})`,
          name: channel.name,
          description: channel.description,
          channelType: channel.type,
          memberCount,
          isArchived: channel.isArchived,
          tenantId: channel.tenantId,
          channelCreatedAt: channel.createdAt,
        })
        .onConflictDoUpdate({
          target: schema.channelSearch.channelId,
          set: {
            searchVector: sql`to_tsvector('simple', ${searchText})`,
            name: channel.name,
            description: channel.description,
            memberCount,
            isArchived: channel.isArchived,
            updatedAt: new Date(),
          },
        });
    } catch (error) {
      this.logger.error(`Failed to index channel ${channel.id}:`, error);
    }
  }

  async removeChannelIndex(channelId: string): Promise<void> {
    try {
      await this.db
        .delete(schema.channelSearch)
        .where(eq(schema.channelSearch.channelId, channelId));
    } catch (error) {
      this.logger.error(`Failed to remove channel index ${channelId}:`, error);
    }
  }

  // ==========================================
  // User Indexing
  // ==========================================

  async indexUser(user: schema.User): Promise<void> {
    const searchText =
      `${user.username || ''} ${user.displayName || ''} ${user.email || ''}`.toLowerCase();

    try {
      await this.db
        .insert(schema.userSearch)
        .values({
          userId: user.id,
          searchVector: sql`to_tsvector('simple', ${searchText})`,
          username: user.username,
          displayName: user.displayName,
          email: user.email,
          status: user.status,
          isActive: user.isActive,
          userCreatedAt: user.createdAt,
        })
        .onConflictDoUpdate({
          target: schema.userSearch.userId,
          set: {
            searchVector: sql`to_tsvector('simple', ${searchText})`,
            username: user.username,
            displayName: user.displayName,
            status: user.status,
            isActive: user.isActive,
            updatedAt: new Date(),
          },
        });
    } catch (error) {
      this.logger.error(`Failed to index user ${user.id}:`, error);
    }
  }

  async removeUserIndex(userId: string): Promise<void> {
    try {
      await this.db
        .delete(schema.userSearch)
        .where(eq(schema.userSearch.userId, userId));
    } catch (error) {
      this.logger.error(`Failed to remove user index ${userId}:`, error);
    }
  }

  // ==========================================
  // File Indexing
  // ==========================================

  async indexFile(
    file: schema.File,
    channel?: schema.Channel,
    uploader?: schema.User,
  ): Promise<void> {
    const searchText = (file.fileName || '').toLowerCase();

    try {
      await this.db
        .insert(schema.fileSearch)
        .values({
          fileId: file.id,
          searchVector: sql`to_tsvector('simple', ${searchText})`,
          fileName: file.fileName,
          mimeType: file.mimeType,
          fileSize: file.fileSize,
          channelId: file.channelId,
          channelName: channel?.name,
          uploaderId: file.uploaderId,
          uploaderUsername: uploader?.username,
          tenantId: file.tenantId,
          fileCreatedAt: file.createdAt,
        })
        .onConflictDoUpdate({
          target: schema.fileSearch.fileId,
          set: {
            searchVector: sql`to_tsvector('simple', ${searchText})`,
            fileName: file.fileName,
            channelName: channel?.name,
            updatedAt: new Date(),
          },
        });
    } catch (error) {
      this.logger.error(`Failed to index file ${file.id}:`, error);
    }
  }

  async removeFileIndex(fileId: string): Promise<void> {
    try {
      await this.db
        .delete(schema.fileSearch)
        .where(eq(schema.fileSearch.fileId, fileId));
    } catch (error) {
      this.logger.error(`Failed to remove file index ${fileId}:`, error);
    }
  }

  // ==========================================
  // Event Handlers
  // ==========================================

  @OnEvent('message.created')
  async handleMessageCreated(payload: MessageIndexPayload): Promise<void> {
    await this.indexMessage(payload.message, payload.channel, payload.sender);
  }

  @OnEvent('message.updated')
  async handleMessageUpdated(payload: MessageIndexPayload): Promise<void> {
    await this.indexMessage(payload.message, payload.channel, payload.sender);
  }

  @OnEvent('message.deleted')
  async handleMessageDeleted(messageId: string): Promise<void> {
    await this.removeMessageIndex(messageId);
  }

  @OnEvent('channel.created')
  async handleChannelCreated(payload: ChannelIndexPayload): Promise<void> {
    await this.indexChannel(payload.channel);
  }

  @OnEvent('channel.updated')
  async handleChannelUpdated(payload: ChannelIndexPayload): Promise<void> {
    await this.indexChannel(payload.channel);
  }

  @OnEvent('channel.deleted')
  async handleChannelDeleted(channelId: string): Promise<void> {
    await this.removeChannelIndex(channelId);
  }

  @OnEvent('user.created')
  async handleUserCreated(payload: UserIndexPayload): Promise<void> {
    await this.indexUser(payload.user);
  }

  @OnEvent('user.updated')
  async handleUserUpdated(payload: UserIndexPayload): Promise<void> {
    await this.indexUser(payload.user);
  }

  @OnEvent('file.created')
  async handleFileCreated(payload: FileIndexPayload): Promise<void> {
    await this.indexFile(payload.file, payload.channel, payload.uploader);
  }

  @OnEvent('file.deleted')
  async handleFileDeleted(fileId: string): Promise<void> {
    await this.removeFileIndex(fileId);
  }

  // ==========================================
  // Bulk Reindexing
  // ==========================================

  async reindexAllMessages(): Promise<void> {
    const batchSize = 1000;
    let offset = 0;
    let indexed = 0;

    this.logger.log('Starting message reindexing...');

    while (true) {
      const messages = await this.db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.isDeleted, false))
        .limit(batchSize)
        .offset(offset);

      if (messages.length === 0) break;

      for (const message of messages) {
        const [channel] = await this.db
          .select()
          .from(schema.channels)
          .where(eq(schema.channels.id, message.channelId))
          .limit(1);

        if (channel) {
          let sender: schema.User | undefined;
          if (message.senderId) {
            const [s] = await this.db
              .select()
              .from(schema.users)
              .where(eq(schema.users.id, message.senderId))
              .limit(1);
            sender = s;
          }

          await this.indexMessage(message, channel, sender);
          indexed++;
        }
      }

      offset += batchSize;
      this.logger.log(`Indexed ${indexed} messages...`);
    }

    this.logger.log(`Message reindexing completed. Total: ${indexed}`);
  }

  async reindexAllChannels(): Promise<void> {
    this.logger.log('Starting channel reindexing...');

    const channels = await this.db.select().from(schema.channels);

    for (const channel of channels) {
      await this.indexChannel(channel);
    }

    this.logger.log(`Channel reindexing completed. Total: ${channels.length}`);
  }

  async reindexAllUsers(): Promise<void> {
    this.logger.log('Starting user reindexing...');

    const users = await this.db.select().from(schema.users);

    for (const user of users) {
      await this.indexUser(user);
    }

    this.logger.log(`User reindexing completed. Total: ${users.length}`);
  }

  async reindexAllFiles(): Promise<void> {
    const batchSize = 1000;
    let offset = 0;
    let indexed = 0;

    this.logger.log('Starting file reindexing...');

    while (true) {
      const files = await this.db
        .select()
        .from(schema.files)
        .limit(batchSize)
        .offset(offset);

      if (files.length === 0) break;

      for (const file of files) {
        let channel: schema.Channel | undefined;
        if (file.channelId) {
          const [c] = await this.db
            .select()
            .from(schema.channels)
            .where(eq(schema.channels.id, file.channelId))
            .limit(1);
          channel = c;
        }

        let uploader: schema.User | undefined;
        if (file.uploaderId) {
          const [u] = await this.db
            .select()
            .from(schema.users)
            .where(eq(schema.users.id, file.uploaderId))
            .limit(1);
          uploader = u;
        }

        await this.indexFile(file, channel, uploader);
        indexed++;
      }

      offset += batchSize;
      this.logger.log(`Indexed ${indexed} files...`);
    }

    this.logger.log(`File reindexing completed. Total: ${indexed}`);
  }

  async reindexAll(): Promise<void> {
    await this.reindexAllUsers();
    await this.reindexAllChannels();
    await this.reindexAllMessages();
    await this.reindexAllFiles();
  }

  // ==========================================
  // Helper Methods
  // ==========================================

  private async checkHasAttachment(messageId: string): Promise<boolean> {
    const [result] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.messageAttachments)
      .where(eq(schema.messageAttachments.messageId, messageId));

    return (result?.count || 0) > 0;
  }

  private async getChannelMemberCount(channelId: string): Promise<number> {
    const [result] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.channelMembers)
      .where(
        and(
          eq(schema.channelMembers.channelId, channelId),
          sql`${schema.channelMembers.leftAt} IS NULL`,
        ),
      );

    return result?.count || 0;
  }
}
