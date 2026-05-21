import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import {
  DATABASE_CONNECTION,
  and,
  desc,
  eq,
  sql,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import { ChannelsService } from '../channels/channels.service.js';
import {
  MessagesService,
  type MessageResponse,
} from '../messages/messages.service.js';

const DEFAULT_CONTEXT_LIMIT = 5;
const DEFAULT_MESSAGE_LIMIT = 20;
const DEFAULT_MAX_CONTENT_CHARS = 80_000;

export interface LinkedContextMessage {
  id: string;
  channelId: string;
  senderId: string | null;
  senderName: string | null;
  content: string;
  createdAt: Date;
  metadata?: Record<string, unknown> | null;
  truncated?: boolean;
  fullContentLength?: number;
}

export interface LinkedContextEntry {
  kind: 'deep_research';
  title: string;
  status: string | null;
  phase: string | null;
  parentChannelId: string;
  childChannelId: string;
  parentMessageId?: string;
  taskId?: string;
  interactionId?: string;
  reportS3Key?: string;
  updatedAt?: string;
  messages: LinkedContextMessage[];
  truncated: boolean;
}

export interface LinkedContextResponse {
  parentChannelId: string;
  query?: string;
  contexts: LinkedContextEntry[];
}

interface ParentTaskSnapshot {
  childChannelId: string;
  title?: string;
  status?: string;
  phase?: string;
  parentMessageId?: string;
  taskId?: string;
  interactionId?: string;
  reportS3Key?: string;
  updatedAt?: string;
}

@Injectable()
export class LinkedContextsService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly channels: ChannelsService,
    private readonly messages: MessagesService,
  ) {}

  async query(params: {
    userId: string;
    parentChannelId: string;
    query?: string;
    limit?: number;
    maxContentChars?: number;
  }): Promise<LinkedContextResponse> {
    await this.assertParentMembership(params.parentChannelId, params.userId);

    const limit = Math.min(
      Math.max(params.limit ?? DEFAULT_CONTEXT_LIMIT, 1),
      10,
    );
    const maxContentChars = Math.min(
      Math.max(params.maxContentChars ?? DEFAULT_MAX_CONTENT_CHARS, 1_000),
      120_000,
    );

    const parentTasks = await this.findParentDeepResearchTasks(
      params.parentChannelId,
      limit * 4,
    );
    const childChannels = await this.findDeepResearchChildChannels(
      params.parentChannelId,
      limit * 4,
    );

    const childIds = new Set<string>([
      ...parentTasks.map((task) => task.childChannelId),
      ...childChannels.map((channel) => channel.childChannelId),
    ]);

    const contexts: LinkedContextEntry[] = [];
    for (const childChannelId of childIds) {
      if (contexts.length >= limit) break;

      const parentTask = parentTasks.find(
        (task) => task.childChannelId === childChannelId,
      );
      const child =
        childChannels.find(
          (channel) => channel.childChannelId === childChannelId,
        ) ??
        (await this.findLinkedDeepResearchChildChannel(
          params.parentChannelId,
          childChannelId,
        ));
      if (!child) continue;

      const rawMessages = await this.messages.getChannelMessages(
        childChannelId,
        DEFAULT_MESSAGE_LIMIT,
      );
      const chronological = [...rawMessages].reverse();
      const latestDeepResearch =
        this.findLatestDeepResearchMetadata(rawMessages);
      const normalizedMessages = this.normalizeMessages(
        chronological,
        maxContentChars,
      );

      contexts.push({
        kind: 'deep_research',
        title:
          parentTask?.title ??
          this.stringValue(latestDeepResearch?.title) ??
          child?.title ??
          'Deep Research',
        status:
          parentTask?.status ??
          this.stringValue(latestDeepResearch?.status) ??
          null,
        phase:
          parentTask?.phase ??
          this.stringValue(latestDeepResearch?.phase) ??
          null,
        parentChannelId: params.parentChannelId,
        childChannelId,
        ...(parentTask?.parentMessageId
          ? { parentMessageId: parentTask.parentMessageId }
          : {}),
        ...(parentTask?.taskId ? { taskId: parentTask.taskId } : {}),
        ...(parentTask?.interactionId
          ? { interactionId: parentTask.interactionId }
          : this.stringValue(latestDeepResearch?.interactionId)
            ? {
                interactionId: this.stringValue(
                  latestDeepResearch?.interactionId,
                ),
              }
            : {}),
        ...(parentTask?.reportS3Key
          ? { reportS3Key: parentTask.reportS3Key }
          : this.stringValue(latestDeepResearch?.reportS3Key)
            ? { reportS3Key: this.stringValue(latestDeepResearch?.reportS3Key) }
            : {}),
        ...(parentTask?.updatedAt
          ? { updatedAt: parentTask.updatedAt }
          : this.stringValue(latestDeepResearch?.updatedAt)
            ? { updatedAt: this.stringValue(latestDeepResearch?.updatedAt) }
            : {}),
        messages: normalizedMessages.messages,
        truncated: normalizedMessages.truncated,
      });
    }

    contexts.sort((a, b) => {
      const left = a.updatedAt ? Date.parse(a.updatedAt) : 0;
      const right = b.updatedAt ? Date.parse(b.updatedAt) : 0;
      return right - left;
    });

    return {
      parentChannelId: params.parentChannelId,
      ...(params.query?.trim() ? { query: params.query.trim() } : {}),
      contexts,
    };
  }

  private async assertParentMembership(
    parentChannelId: string,
    userId: string,
  ): Promise<void> {
    const channel = await this.channels.findById(parentChannelId);
    if (!channel) throw new ForbiddenException('Access denied');

    const isMember = channel.tenantId
      ? await this.channels.isChannelMember(
          parentChannelId,
          userId,
          channel.tenantId,
        )
      : await this.channels.isMember(parentChannelId, userId);
    if (!isMember) throw new ForbiddenException('Access denied');
  }

  private async findParentDeepResearchTasks(
    parentChannelId: string,
    limit: number,
  ): Promise<ParentTaskSnapshot[]> {
    const rows = await this.db
      .select({
        id: schema.messages.id,
        metadata: schema.messages.metadata,
      })
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.channelId, parentChannelId),
          eq(schema.messages.isDeleted, false),
        ),
      )
      .orderBy(desc(schema.messages.createdAt))
      .limit(Math.max(limit, 1));

    const tasks: ParentTaskSnapshot[] = [];
    for (const row of rows) {
      const metadata = this.asRecord(row.metadata);
      const task = this.asRecord(metadata?.deepResearchTask);
      const session = this.asRecord(task?.session);
      const childChannelId =
        this.stringValue(task?.childChannelId) ??
        this.stringValue(session?.childChannelId);
      const taskParentChannelId =
        this.stringValue(task?.parentChannelId) ??
        this.stringValue(session?.parentChannelId);
      if (!childChannelId || taskParentChannelId !== parentChannelId) continue;

      tasks.push({
        childChannelId,
        ...(this.stringValue(task?.title)
          ? { title: this.stringValue(task?.title) }
          : {}),
        ...(this.stringValue(task?.status)
          ? { status: this.stringValue(task?.status) }
          : {}),
        ...(this.stringValue(task?.phase)
          ? { phase: this.stringValue(task?.phase) }
          : {}),
        ...(this.stringValue(task?.parentMessageId)
          ? { parentMessageId: this.stringValue(task?.parentMessageId) }
          : this.stringValue(session?.parentMessageId)
            ? { parentMessageId: this.stringValue(session?.parentMessageId) }
            : {}),
        ...(this.stringValue(task?.taskId)
          ? { taskId: this.stringValue(task?.taskId) }
          : {}),
        ...(this.stringValue(task?.interactionId)
          ? { interactionId: this.stringValue(task?.interactionId) }
          : {}),
        ...(this.stringValue(task?.reportS3Key)
          ? { reportS3Key: this.stringValue(task?.reportS3Key) }
          : {}),
        ...(this.stringValue(task?.updatedAt)
          ? { updatedAt: this.stringValue(task?.updatedAt) }
          : {}),
      });
    }

    return tasks;
  }

  private async findDeepResearchChildChannels(
    parentChannelId: string,
    limit: number,
  ): Promise<Array<{ childChannelId: string; title?: string }>> {
    const rows = await this.db
      .select({
        id: schema.channels.id,
        name: schema.channels.name,
      })
      .from(schema.channels)
      .where(
        and(
          eq(schema.channels.isArchived, false),
          sql`${schema.channels.propertySettings}->'deepResearchSession'->>'parentChannelId' = ${parentChannelId}`,
        ),
      )
      .orderBy(desc(schema.channels.updatedAt))
      .limit(Math.max(limit, 1));

    return rows.map((row) => ({
      childChannelId: row.id,
      ...(row.name ? { title: row.name } : {}),
    }));
  }

  private async findLinkedDeepResearchChildChannel(
    parentChannelId: string,
    childChannelId: string,
  ): Promise<{ childChannelId: string; title?: string } | null> {
    const [row] = await this.db
      .select({
        id: schema.channels.id,
        name: schema.channels.name,
      })
      .from(schema.channels)
      .where(
        and(
          eq(schema.channels.id, childChannelId),
          eq(schema.channels.isArchived, false),
          sql`${schema.channels.propertySettings}->'deepResearchSession'->>'parentChannelId' = ${parentChannelId}`,
        ),
      )
      .limit(1);

    if (!row) return null;
    return {
      childChannelId: row.id,
      ...(row.name ? { title: row.name } : {}),
    };
  }

  private normalizeMessages(
    messages: MessageResponse[],
    maxContentChars: number,
  ): { messages: LinkedContextMessage[]; truncated: boolean } {
    let remaining = maxContentChars;
    let truncated = false;
    const result: LinkedContextMessage[] = [];

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (!message) continue;

      const content = message.content ?? '';
      const allowed = Math.max(remaining, 0);
      if (allowed <= 0 && content.length > 0) {
        truncated = true;
        break;
      }
      const nextContent =
        content.length > allowed ? content.slice(0, allowed) : content;
      remaining -= nextContent.length;
      const messageTruncated = nextContent.length < content.length;
      truncated = truncated || messageTruncated;

      result.unshift({
        id: message.id,
        channelId: message.channelId,
        senderId: message.senderId,
        senderName:
          message.sender?.displayName ?? message.sender?.username ?? null,
        content: nextContent,
        createdAt: message.createdAt,
        ...(message.metadata ? { metadata: message.metadata } : {}),
        ...(messageTruncated ? { truncated: true } : {}),
        ...(messageTruncated ? { fullContentLength: content.length } : {}),
      });

      if (remaining <= 0) {
        truncated = truncated || index > 0;
        break;
      }
    }

    return { messages: result, truncated };
  }

  private findLatestDeepResearchMetadata(
    messages: MessageResponse[],
  ): Record<string, unknown> | null {
    for (const message of messages) {
      const metadata = this.asRecord(message.metadata);
      const deepResearch = this.asRecord(metadata?.deepResearch);
      if (deepResearch) return deepResearch;
    }
    return null;
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private stringValue(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }
}
