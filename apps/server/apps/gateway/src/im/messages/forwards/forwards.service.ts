import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  ForbiddenException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import {
  eq,
  DATABASE_CONNECTION,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import type {
  ForwardAttachmentSnapshot,
  NewMessageForward,
} from '@team9/database/schemas';
import { ChannelsService } from '../../channels/channels.service.js';
import { MessagesService, type MessageResponse } from '../messages.service.js';
import { ImWorkerGrpcClientService } from '../../services/im-worker-grpc-client.service.js';
import {
  FORWARD_BUNDLE_LIMIT,
  FORWARD_CONTENT_SNAPSHOT_LIMIT,
  FORWARDABLE_SOURCE_TYPES,
  type ForwardItemResponse,
  type ForwardKind,
  type ForwardMetadata,
  type ForwardPayload,
} from './types.js';

export interface ForwardInput {
  targetChannelId: string;
  sourceChannelId: string;
  sourceMessageIds: string[];
  clientMsgId?: string;
  userId: string;
}

@Injectable()
export class ForwardsService {
  private readonly logger = new Logger(ForwardsService.name);

  constructor(
    private readonly channelsService: ChannelsService,
    @Inject(forwardRef(() => MessagesService))
    private readonly messagesService: MessagesService,
    private readonly grpc: ImWorkerGrpcClientService,
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async forward(input: ForwardInput): Promise<MessageResponse> {
    const { targetChannelId, sourceChannelId, sourceMessageIds, userId } =
      input;

    // --- Validation ---
    if (sourceMessageIds.length === 0) {
      throw new BadRequestException('forward.empty');
    }
    if (sourceMessageIds.length > FORWARD_BUNDLE_LIMIT) {
      throw new BadRequestException('forward.tooManySelected');
    }

    // --- Permission checks ---
    try {
      await this.channelsService.assertReadAccess(sourceChannelId, userId);
    } catch {
      throw new ForbiddenException('forward.noSourceAccess');
    }
    try {
      await this.channelsService.assertWriteAccess(targetChannelId, userId);
    } catch {
      throw new ForbiddenException('forward.noWriteAccess');
    }

    // --- Load source messages ---
    const sourceMessages =
      await this.messagesService.findManyByIds(sourceMessageIds);
    if (sourceMessages.length !== sourceMessageIds.length) {
      throw new NotFoundException('forward.notFound');
    }

    // --- Validate each source message ---
    for (const m of sourceMessages) {
      if (m.channelId !== sourceChannelId) {
        throw new BadRequestException('forward.mixedChannels');
      }
      if (m.isDeleted) {
        throw new BadRequestException('forward.notAllowed');
      }
      if (!FORWARDABLE_SOURCE_TYPES.has(m.type)) {
        throw new BadRequestException('forward.notAllowed');
      }
      const meta = m.metadata ?? {};
      if (meta.streaming === true) {
        throw new BadRequestException('forward.notAllowed');
      }
    }

    // Preserve the original ordering from the input IDs
    const ordered = sourceMessageIds.map((id) => {
      const m = sourceMessages.find((s) => s.id === id)!;
      return m;
    });

    // --- Load attachments for source messages ---
    const attachmentsByMessage =
      await this.messagesService.getAttachmentsForMessages(
        ordered.map((m) => m.id),
      );

    // --- Load source channel info ---
    const sourceChannel = await this.channelsService.findById(sourceChannelId);
    const sourceChannelName = sourceChannel?.name ?? null;

    const kind: ForwardKind = ordered.length === 1 ? 'single' : 'bundle';

    // --- Build forward rows ---
    const items: Array<{
      row: Omit<NewMessageForward, 'id'>;
      truncated: boolean;
    }> = ordered.map((m, position) => {
      const attachments = (attachmentsByMessage.get(m.id) ?? []).map(
        (a): ForwardAttachmentSnapshot => ({
          originalAttachmentId: a.id,
          fileName: a.fileName,
          fileUrl: a.fileUrl,
          fileKey: a.fileKey ?? null,
          fileSize: a.fileSize,
          mimeType: a.mimeType,
          thumbnailUrl: a.thumbnailUrl ?? null,
          width: a.width ?? null,
          height: a.height ?? null,
        }),
      );

      let snapshot = m.content ?? null;
      let truncated = false;
      if (snapshot && snapshot.length > FORWARD_CONTENT_SNAPSHOT_LIMIT) {
        snapshot = snapshot.slice(0, FORWARD_CONTENT_SNAPSHOT_LIMIT);
        truncated = true;
      }

      // For re-forwarded messages: use content (digest) as snapshot, no AST, no attachments
      const isReForward = m.type === 'forward';

      return {
        truncated,
        row: {
          forwardedMessageId: '__placeholder__', // patched after createMessage
          position,
          sourceMessageId: m.id,
          sourceChannelId,
          sourceWorkspaceId: sourceChannel?.tenantId ?? null,
          sourceSenderId: m.senderId,
          sourceCreatedAt: m.createdAt,
          sourceSeqId: m.seqId ?? null,
          contentSnapshot: snapshot,
          contentAstSnapshot: isReForward ? null : (m.contentAst ?? null),
          attachmentsSnapshot: isReForward ? [] : attachments,
          sourceType: m.type,
        },
      };
    });

    const anyTruncated = items.some((i) => i.truncated);
    const digest = this.buildDigest(kind, ordered, sourceChannelName);
    const metadataForward: ForwardMetadata = {
      kind,
      count: ordered.length,
      sourceChannelId,
      sourceChannelName: sourceChannelName ?? '',
      ...(anyTruncated && { truncated: true }),
    };

    // --- Create the forward message via gRPC ---
    const targetChannel = await this.channelsService.findById(targetChannelId);
    const created = await this.grpc.createMessage({
      clientMsgId: input.clientMsgId ?? uuidv7(),
      channelId: targetChannelId,
      senderId: userId,
      content: digest,
      type: 'forward',
      workspaceId: targetChannel?.tenantId ?? undefined,
      attachments: undefined,
      metadata: { forward: metadataForward },
    });

    const forwardedMessageId = created.msgId;

    // --- Insert forward snapshot rows ---
    try {
      await this.db
        .insert(schema.messageForwards)
        .values(items.map((i) => ({ ...i.row, forwardedMessageId })));
    } catch (err) {
      this.logger.error(
        `Failed to insert forward rows for ${forwardedMessageId}: ${String(err)}`,
      );
      await this.messagesService.softDelete(forwardedMessageId, userId);
      throw new InternalServerErrorException('forward.insertFailed');
    }

    const message =
      await this.messagesService.getMessageWithDetails(forwardedMessageId);
    return this.messagesService.truncateForPreview(message);
  }

  /**
   * Get ordered forward items for a bundle-viewer endpoint.
   * Enforces read access on the forward message's channel.
   */
  async getForwardItems(
    forwardedMessageId: string,
    userId: string,
  ): Promise<ForwardItemResponse[]> {
    const channelId =
      await this.messagesService.getMessageChannelId(forwardedMessageId);
    await this.channelsService.assertReadAccess(channelId, userId);
    return this.hydrateItems(forwardedMessageId, userId);
  }

  /**
   * Internal: hydrate forward rows into ForwardItemResponse[].
   * Does NOT enforce access — callers must check before calling.
   */
  async hydrateItems(
    forwardedMessageId: string,
    userId: string,
  ): Promise<ForwardItemResponse[]> {
    const rows = await this.db
      .select()
      .from(schema.messageForwards)
      .where(eq(schema.messageForwards.forwardedMessageId, forwardedMessageId))
      .orderBy(schema.messageForwards.position);

    if (rows.length === 0) return [];

    const distinctChannelIds = Array.from(
      new Set(rows.map((r) => r.sourceChannelId)),
    );
    const distinctSenderIds = Array.from(
      new Set(
        rows.map((r) => r.sourceSenderId).filter((x): x is string => !!x),
      ),
    );
    const distinctSourceMsgIds = rows
      .map((r) => r.sourceMessageId)
      .filter((x): x is string => !!x);

    const [channels, senders, liveSources] = await Promise.all([
      this.channelsService.findManyByIds(distinctChannelIds),
      this.messagesService.findUsersByIds(distinctSenderIds),
      distinctSourceMsgIds.length > 0
        ? this.messagesService.findManyByIds(distinctSourceMsgIds)
        : Promise.resolve([]),
    ]);

    const channelMap = new Map(channels.map((c) => [c.id, c]));
    const senderMap = new Map(senders.map((u) => [u.id, u]));
    const liveSourceIds = new Set(
      liveSources.filter((m) => !m.isDeleted).map((m) => m.id),
    );

    // Check read access per channel (non-throwing)
    const accessByChannel = new Map<string, boolean>();
    await Promise.all(
      distinctChannelIds.map(async (cid) => {
        const ok = await this.channelsService.canRead(cid, userId);
        accessByChannel.set(cid, ok);
      }),
    );

    return rows.map((r): ForwardItemResponse => {
      const ch = channelMap.get(r.sourceChannelId);
      const sender = r.sourceSenderId ? senderMap.get(r.sourceSenderId) : null;
      /* istanbul ignore next -- accessByChannel always populated via Promise.all above */
      const userCanReadSource = accessByChannel.get(r.sourceChannelId) ?? false;
      const sourceStillExists =
        !!r.sourceMessageId && liveSourceIds.has(r.sourceMessageId);
      const truncated =
        !!r.contentSnapshot &&
        r.contentSnapshot.length === FORWARD_CONTENT_SNAPSHOT_LIMIT;

      return {
        position: r.position,
        sourceMessageId: r.sourceMessageId ?? null,
        sourceChannelId: r.sourceChannelId,
        sourceChannelName: userCanReadSource ? (ch?.name ?? null) : null,
        sourceWorkspaceId: r.sourceWorkspaceId ?? null,
        sourceSender: sender
          ? {
              id: sender.id,
              username: sender.username,
              displayName: sender.displayName ?? null,
              avatarUrl: sender.avatarUrl ?? null,
            }
          : null,
        sourceCreatedAt: r.sourceCreatedAt.toISOString(),
        sourceSeqId: r.sourceSeqId !== null ? r.sourceSeqId.toString() : null,
        sourceType: r.sourceType as ForwardItemResponse['sourceType'],
        contentSnapshot: r.contentSnapshot ?? null,
        contentAstSnapshot: r.contentAstSnapshot ?? null,
        attachmentsSnapshot: r.attachmentsSnapshot ?? [],
        canJumpToOriginal: sourceStillExists && userCanReadSource,
        truncated,
      };
    });
  }

  /**
   * Hydrate a ForwardPayload for consumption by MessagesService (Task 5).
   */
  async hydratePayload(
    forwardedMessageId: string,
    userId: string,
    metadataForward: ForwardMetadata,
  ): Promise<ForwardPayload> {
    const items = await this.hydrateItems(forwardedMessageId, userId);
    return {
      kind: metadataForward.kind,
      count: metadataForward.count,
      sourceChannelId: metadataForward.sourceChannelId,
      sourceChannelName: metadataForward.sourceChannelName || null,
      truncated: metadataForward.truncated ?? items.some((i) => i.truncated),
      items,
    };
  }

  private buildDigest(
    kind: ForwardKind,
    sources: { content: string | null; senderId: string | null }[],
    channelName: string | null,
  ): string {
    if (kind === 'single') {
      const m = sources[0];
      const head = (m.content ?? '').slice(0, 200);
      return `[Forwarded] ${head}`;
    }
    const previews = sources
      .slice(0, 3)
      .map((m) => (m.content ?? '').slice(0, 80))
      .join('; ');
    return `[Forwarded chat record · ${sources.length} messages from #${channelName ?? 'channel'}] ${previews}`;
  }
}
