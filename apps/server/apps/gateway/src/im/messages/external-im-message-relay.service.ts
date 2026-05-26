import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  DATABASE_CONNECTION,
  eq,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';

interface MessageCreatedEvent {
  message?: {
    id?: string;
    channelId?: string;
    senderId?: string | null;
    content?: string | null;
    type?: string;
    parentId?: string | null;
    createdAt?: string | Date;
    metadata?: Record<string, unknown> | null;
    attachments?: Array<{
      id?: string;
      fileName?: string;
      mimeType?: string;
      fileSize?: number;
      fileUrl?: string;
      publicUrl?: string | null;
      thumbnailUrl?: string | null;
    }>;
  };
  channel?: {
    id?: string;
    name?: string | null;
    type?: string;
  } | null;
  sender?: {
    id?: string;
    username?: string;
    displayName?: string | null;
  } | null;
}

@Injectable()
export class ExternalImMessageRelayService {
  private readonly logger = new Logger(ExternalImMessageRelayService.name);
  private readonly webhookUrl = this.resolveWebhookUrl();

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  @OnEvent('message.created')
  async handleMessageCreated(event: MessageCreatedEvent): Promise<void> {
    if (!this.webhookUrl) return;

    const message = event.message;
    if (!message?.id || !message.channelId || !message.senderId) return;

    try {
      const metadata = await this.resolveMessageMetadata(message);
      if (!this.shouldRelayMessage(message, metadata)) return;

      await this.deliver({
        event: 'message.created',
        timestamp: new Date().toISOString(),
        data: {
          messageId: message.id,
          channelId: message.channelId,
          senderId: message.senderId,
          content: message.content ?? null,
          type: message.type,
          parentId: message.parentId ?? null,
          createdAt: this.toIsoString(message.createdAt),
          metadata: metadata ?? null,
          attachments: this.mapAttachments(message.attachments),
          sender: event.sender
            ? {
                id: event.sender.id,
                username: event.sender.username,
                displayName: event.sender.displayName,
              }
            : { id: message.senderId },
          channel: event.channel
            ? {
                id: event.channel.id,
                name: event.channel.name,
                type: event.channel.type,
              }
            : { id: message.channelId },
        },
      });
    } catch (error) {
      this.logger.warn(
        `External IM message relay failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async resolveMessageMetadata(
    message: NonNullable<MessageCreatedEvent['message']>,
  ): Promise<Record<string, unknown> | null | undefined> {
    if (message.metadata !== undefined) return message.metadata;

    try {
      const [row] = await this.db
        .select({ metadata: schema.messages.metadata })
        .from(schema.messages)
        .where(eq(schema.messages.id, message.id!))
        .limit(1);
      return row?.metadata ?? null;
    } catch (error) {
      this.logger.warn(
        `Failed to load message metadata for external IM relay: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return undefined;
    }
  }

  private shouldRelayMessage(
    message: NonNullable<MessageCreatedEvent['message']>,
    metadata: Record<string, unknown> | null | undefined,
  ): boolean {
    if (message.type === 'tracking') return false;
    if (metadata && typeof metadata.externalIm === 'object') return false;

    const agentEventType = this.getAgentEventType(metadata);
    if (agentEventType && agentEventType !== 'writing') return false;

    return !this.isAgentLifecyclePlaceholder(message.content);
  }

  private mapAttachments(
    attachments: NonNullable<MessageCreatedEvent['message']>['attachments'],
  ): Array<{
    id?: string;
    fileName?: string;
    mimeType?: string;
    fileSize?: number;
    fileUrl?: string;
    publicUrl?: string | null;
    thumbnailUrl?: string | null;
  }> {
    return (attachments ?? []).map((attachment) => ({
      id: attachment.id,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      fileSize: attachment.fileSize,
      fileUrl: attachment.fileUrl,
      publicUrl: attachment.publicUrl ?? null,
      thumbnailUrl: attachment.thumbnailUrl ?? null,
    }));
  }

  private getAgentEventType(
    metadata: Record<string, unknown> | null | undefined,
  ): string | undefined {
    if (!metadata || typeof metadata.agentEventType !== 'string') {
      return undefined;
    }
    if (
      metadata.agentEventType === 'func_call' ||
      metadata.agentEventType === 'function_call'
    ) {
      return 'tool_call';
    }
    if (
      metadata.agentEventType === 'func_result' ||
      metadata.agentEventType === 'function_result'
    ) {
      return 'tool_result';
    }
    return metadata.agentEventType;
  }

  private isAgentLifecyclePlaceholder(content: string | null | undefined) {
    const text = content?.trim();
    if (!text) return false;
    return (
      /^Turn\s+\d+$/i.test(text) ||
      /^Execution started\.?$/i.test(text) ||
      /^Execution complete\.?$/i.test(text)
    );
  }

  private async deliver(payload: unknown): Promise<void> {
    if (!this.webhookUrl) return;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-team9-event': 'message.created',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) {
        this.logger.warn(
          `External IM message relay returned ${response.status}`,
        );
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  private resolveWebhookUrl(): string | undefined {
    const explicit = process.env.EXTERNAL_IM_GATEWAY_WEBHOOK_URL?.trim();
    if (explicit) return explicit;

    const baseUrl = process.env.EXTERNAL_IM_GATEWAY_URL?.trim();
    if (!baseUrl) return undefined;
    return new URL('/team9/webhooks/message-created', baseUrl).toString();
  }

  private toIsoString(value: string | Date | undefined): string | undefined {
    if (!value) return undefined;
    return value instanceof Date ? value.toISOString() : value;
  }
}
