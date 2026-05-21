import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { v7 as uuidv7 } from 'uuid';
import {
  and,
  DATABASE_CONNECTION,
  desc,
  eq,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import { CapabilityHubClient } from '../../capability-hub/capability-hub.client.js';
import {
  ChannelsService,
  type ChannelResponse,
} from '../channels/channels.service.js';
import {
  MessagesService,
  type MessageResponse,
} from '../messages/messages.service.js';
import { determineMessageType } from '../messages/message-utils.js';
import { sanitizeMessageContent } from '../messages/utils/sanitize-content.js';
import { ChannelSequenceService } from '../shared/channel-sequence.service.js';
import { WebsocketGateway } from '../websocket/websocket.gateway.js';
import { WS_EVENTS } from '../websocket/events/events.constants.js';
import { deepResearchText } from './deep-research-i18n.js';

const DEEP_RESEARCH_CAPABILITY_NAME = 'deep_research_run';
const DEFAULT_DEEP_RESEARCH_FOLLOW_UP_MODEL = 'gemini-3-flash-preview';
const CAPABILITY_DISCOVERY_LIMIT = 100;
const CAPABILITY_INVOKE_TIMEOUT_MS = 15_000;
const TASK_POLL_INTERVAL_MS = 5_000;
const TASK_POLL_MAX_ATTEMPTS = 144;
const MAX_STORED_CONTENT_CHARS = 580_000;
const TASK_STREAM_METADATA_UPDATE_MIN_MS = 1_500;
const TASK_HEARTBEAT_INTERVAL_MS = 30_000;

type DeepResearchAction = 'modify_plan' | 'start_research' | 'follow_up';
type DeepResearchKind = 'plan' | 'report';
type ParentTaskStatus = 'running' | 'plan_ready' | 'completed' | 'failed';
interface DeepResearchSessionRef {
  childChannelId: string;
  parentChannelId: string;
  parentMessageId?: string;
}

interface CapabilityItemLike {
  id?: unknown;
  name?: unknown;
  tool?: {
    capabilityId?: unknown;
  };
}

interface TaskSnapshot {
  id?: string;
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  result?: unknown;
  error?: { message?: string } | null;
}

interface TaskStreamEvent {
  id?: string;
  event?: string;
  data?: unknown;
}

interface DeepResearchThoughtProgress {
  id?: string;
  title?: string;
  text: string;
  status?: string;
}

interface DeepResearchSourceProgress {
  id?: string;
  url: string;
  title?: string;
  domain?: string;
  status?: string;
}

interface DeepResearchProgressSnapshot {
  version?: number;
  phase?: string;
  activeStep?: string;
  interactionId?: string;
  thoughts?: DeepResearchThoughtProgress[];
  sources?: DeepResearchSourceProgress[];
  queries?: string[];
  counts?: Record<string, unknown>;
  updatedAt?: string;
}

@Injectable()
export class DeepResearchSessionsService {
  private readonly logger = new Logger(DeepResearchSessionsService.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly hub: CapabilityHubClient,
    @Inject(forwardRef(() => ChannelsService))
    private readonly channels: ChannelsService,
    private readonly messages: MessagesService,
    private readonly channelSequence: ChannelSequenceService,
    @Inject(forwardRef(() => WebsocketGateway))
    private readonly ws: WebsocketGateway,
    private readonly eventEmitter: EventEmitter2,
    private readonly config: ConfigService,
  ) {}

  static isDeepResearchRequestMetadata(metadata: unknown): boolean {
    return Boolean(
      DeepResearchSessionsService.asRecord(metadata)?.deepResearchRequest,
    );
  }

  static isIsolatedDeepResearchMetadata(metadata: unknown): boolean {
    const ref =
      DeepResearchSessionsService.asRecord(metadata)?.deepResearchSessionRef;
    return (
      DeepResearchSessionsService.asRecord(ref)?.agentWakePolicy === 'none'
    );
  }

  static withSessionRef(
    metadata: Record<string, unknown> | undefined,
    ref: DeepResearchSessionRef,
  ): Record<string, unknown> {
    return {
      ...(metadata ?? {}),
      deepResearchSessionRef: {
        ...ref,
        agentWakePolicy: 'none',
      },
    };
  }

  async createChildChannel(params: {
    creatorId: string;
    tenantId: string | null;
    parentChannelId: string;
    title: string | null;
  }): Promise<ChannelResponse> {
    return this.channels.createDeepResearchSessionChannel(params);
  }

  async startPlan(params: {
    userId: string;
    tenantId: string | null;
    parentChannelId: string;
    childChannelId: string;
    parentMessageId: string;
    input: string;
    title: string;
    requestMetadata: Record<string, unknown>;
  }): Promise<void> {
    const request = DeepResearchSessionsService.asRecord(
      params.requestMetadata.deepResearchRequest,
    );
    const language = await this.resolveUserLanguage(params.userId);
    const payload = this.buildPayload({
      input: params.input,
      request,
      kind: 'plan',
      language,
    });

    void this.run({
      userId: params.userId,
      tenantId: params.tenantId,
      sessionRef: {
        childChannelId: params.childChannelId,
        parentChannelId: params.parentChannelId,
        parentMessageId: params.parentMessageId,
      },
      kind: 'plan',
      title: params.title,
      payload,
      language,
    });
  }

  async handleAction(params: {
    userId: string;
    tenantId: string | null;
    childChannelId: string;
    action: DeepResearchAction;
    planMessageId: string;
    planInteractionId: string;
    input?: string;
  }): Promise<{ accepted: true }> {
    await this.channels.assertReadAccess(params.childChannelId, params.userId);

    const planMessage = await this.messages.getMessageWithDetails(
      params.planMessageId,
    );
    if (
      planMessage.channelId !== params.childChannelId &&
      !(await this.canReadMessageChannel(planMessage, params.userId))
    ) {
      throw new ForbiddenException('Access denied');
    }

    const sessionRef =
      this.extractSessionRef(planMessage.metadata) ??
      (await this.extractSessionRefFromChannel(params.childChannelId));
    if (!sessionRef || sessionRef.childChannelId !== params.childChannelId) {
      throw new BadRequestException('Deep research session reference missing');
    }

    const requestedInteractionId = params.planInteractionId.trim();
    const messageInteractionId = this.extractInteractionId(
      planMessage.metadata,
    );
    if (
      requestedInteractionId &&
      messageInteractionId &&
      requestedInteractionId !== messageInteractionId
    ) {
      throw new BadRequestException('Plan interaction id does not match');
    }

    const interactionId = messageInteractionId || requestedInteractionId;
    if (!interactionId) {
      throw new BadRequestException('Plan interaction id is required');
    }

    const language = await this.resolveUserLanguage(params.userId);
    const kind: DeepResearchKind =
      params.action === 'modify_plan' ? 'plan' : 'report';
    const input =
      params.input?.trim() ||
      (params.action === 'modify_plan'
        ? deepResearchText(language, 'actionModifyPlan')
        : params.action === 'follow_up'
          ? deepResearchText(language, 'actionFollowUp')
          : deepResearchText(language, 'actionStartResearch'));
    const payload = this.buildPayload({
      input,
      kind,
      previousInteractionId: interactionId,
      model:
        params.action === 'follow_up' ? this.getFollowUpModel() : undefined,
      language,
    });

    void this.run({
      userId: params.userId,
      tenantId: params.tenantId,
      sessionRef,
      kind,
      title:
        this.extractTitleFromMetadata(planMessage.metadata) ??
        this.extractTitle(planMessage.content) ??
        'Deep Research',
      payload,
      language,
    });

    return { accepted: true };
  }

  async getContext(params: {
    userId: string;
    childChannelId: string;
    limit?: number;
  }): Promise<{ channelId: string; messages: MessageResponse[] }> {
    await this.channels.assertReadAccess(params.childChannelId, params.userId);
    const messages = await this.messages.getChannelMessages(
      params.childChannelId,
      Math.min(Math.max(params.limit ?? 20, 1), 50),
    );
    return { channelId: params.childChannelId, messages };
  }

  private async run(params: {
    userId: string;
    tenantId: string | null;
    sessionRef: DeepResearchSessionRef;
    kind: DeepResearchKind;
    title: string;
    payload: Record<string, unknown>;
    language?: string | null;
  }): Promise<void> {
    let childStatusMessageId: string | null = null;
    let latestProgress: DeepResearchProgressSnapshot | undefined;
    let progressAbort: AbortController | null = null;
    let progressStream: Promise<void> | null = null;
    let progressHeartbeat: Promise<void> | null = null;
    try {
      const capability = await this.discoverCapability(params);
      const submitted = await this.invokeCapability(params, capability.id);
      const taskId = this.stringValue(submitted.taskId);
      if (!taskId) {
        throw new Error('Capability did not return a taskId');
      }

      const runningMetadata = this.buildMetadata({
        kind: params.kind,
        status: 'running',
        phase: this.resolveRunningPhase(params),
        taskId,
        capabilityId: capability.id,
        title: params.title,
        sessionRef: params.sessionRef,
      });

      await this.upsertParentTaskCard({
        ...params,
        content: this.formatParentTaskContent({
          title: params.title,
          kind: params.kind,
          status: 'running',
          phase: this.resolveRunningPhase(params),
          language: params.language,
        }),
        metadata: this.buildParentTaskMetadata({
          childMetadata: runningMetadata,
          sessionRef: params.sessionRef,
        }),
      });

      const childStatusMessage = await this.createChildSessionMessage({
        ...params,
        content: this.formatChildRunningContent(params),
        metadata: runningMetadata,
      });
      childStatusMessageId = childStatusMessage.id;

      progressAbort = new AbortController();
      progressStream = this.streamTaskProgress({
        ...params,
        taskId,
        capabilityId: capability.id,
        messageId: childStatusMessage.id,
        signal: progressAbort.signal,
        onProgress: (progress) => {
          latestProgress = this.mergeDeepResearchProgress(
            latestProgress,
            progress,
          );
          return latestProgress;
        },
      }).catch((error) => {
        if (!progressAbort?.signal.aborted) {
          this.logger.warn(`Deep research progress stream failed: ${error}`);
        }
      });
      progressHeartbeat = this.heartbeatTaskProgress({
        ...params,
        taskId,
        capabilityId: capability.id,
        messageId: childStatusMessage.id,
        signal: progressAbort.signal,
        onHeartbeat: () => {
          latestProgress = this.mergeDeepResearchProgress(latestProgress, {
            phase: this.resolveRunningPhase(params),
            activeStep: this.resolveHeartbeatStep(params),
            updatedAt: new Date().toISOString(),
          });
          return latestProgress;
        },
      }).catch((error) => {
        if (!progressAbort?.signal.aborted) {
          this.logger.warn(`Deep research progress heartbeat failed: ${error}`);
        }
      });

      const snapshot = await this.waitForTask(params, taskId);
      progressAbort.abort();
      await progressStream.catch(() => undefined);
      await progressHeartbeat.catch(() => undefined);
      if (snapshot.status !== 'completed') {
        throw new Error(
          snapshot.error?.message ?? `Deep research ${snapshot.status}`,
        );
      }

      const result = this.extractTaskResult(snapshot.result);
      const finalKind = result.kind ?? params.kind;
      const content = this.limitContent(
        result.markdown || this.formatFallbackResult(snapshot.result),
        params.language,
      );
      const interactionId = result.interactionId;
      const markdownSourceProgress =
        this.extractMarkdownSourceProgress(content);
      const progressWithMarkdownSources = markdownSourceProgress
        ? this.mergeDeepResearchProgress(latestProgress, markdownSourceProgress)
        : latestProgress;
      const completedProgress = this.completeDeepResearchProgress(
        progressWithMarkdownSources,
        params.language,
      );

      const completedPhase = finalKind === 'plan' ? 'plan_ready' : 'completed';
      const completedMetadata = this.buildMetadata({
        kind: finalKind,
        status: 'completed',
        phase: completedPhase,
        taskId,
        capabilityId: capability.id,
        title: params.title,
        sessionRef: params.sessionRef,
        ...(interactionId ? { interactionId } : {}),
        ...(result.reportS3Key ? { reportS3Key: result.reportS3Key } : {}),
        ...(result.truncated !== undefined
          ? { truncated: result.truncated }
          : {}),
        ...(typeof result.sizeBytes === 'number'
          ? { sizeBytes: result.sizeBytes }
          : {}),
        ...(completedProgress ? { progress: completedProgress } : {}),
      });

      if (childStatusMessageId) {
        await this.updateChildSessionMessage({
          ...params,
          messageId: childStatusMessageId,
          content,
          metadata: completedMetadata,
        });
      } else {
        await this.createChildSessionMessage({
          ...params,
          content,
          metadata: completedMetadata,
        });
      }

      await this.upsertParentTaskCard({
        ...params,
        content: this.formatParentTaskContent({
          title: params.title,
          kind: finalKind,
          status: finalKind === 'plan' ? 'plan_ready' : 'completed',
          phase: completedPhase,
          language: params.language,
        }),
        metadata: this.buildParentTaskMetadata({
          childMetadata: completedMetadata,
          sessionRef: params.sessionRef,
        }),
      });
    } catch (error) {
      progressAbort?.abort();
      await progressStream?.catch(() => undefined);
      await progressHeartbeat?.catch(() => undefined);
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Deep research run failed: ${message}`);
      const failedMetadata = this.buildMetadata({
        kind: params.kind,
        status: 'failed',
        phase: 'failed',
        title: params.title,
        sessionRef: params.sessionRef,
        error: message,
      });
      const emitFailedMessage = childStatusMessageId
        ? this.updateChildSessionMessage({
            ...params,
            messageId: childStatusMessageId,
            content: deepResearchText(params.language, 'failureMessage', {
              error: message,
            }),
            metadata: failedMetadata,
          })
        : this.createChildSessionMessage({
            ...params,
            content: deepResearchText(params.language, 'failureMessage', {
              error: message,
            }),
            metadata: failedMetadata,
          });
      await emitFailedMessage.catch((emitError) => {
        this.logger.warn(
          `Failed to emit deep research failure message: ${emitError}`,
        );
      });
      await this.upsertParentTaskCard({
        ...params,
        content: this.formatParentTaskContent({
          title: params.title,
          kind: params.kind,
          status: 'failed',
          phase: 'failed',
          error: message,
          language: params.language,
        }),
        metadata: this.buildParentTaskMetadata({
          childMetadata: failedMetadata,
          sessionRef: params.sessionRef,
        }),
      }).catch((emitError) => {
        this.logger.warn(
          `Failed to update deep research parent task card: ${emitError}`,
        );
      });
    }
  }

  private async createChildSessionMessage(params: {
    tenantId: string | null;
    sessionRef: DeepResearchSessionRef;
    content: string;
    metadata: Record<string, unknown>;
  }): Promise<MessageResponse> {
    return this.createSystemAuthoredMessage({
      channelId: params.sessionRef.childChannelId,
      tenantId: params.tenantId,
      content: params.content,
      metadata: params.metadata,
    });
  }

  private async updateChildSessionMessage(params: {
    sessionRef: DeepResearchSessionRef;
    messageId: string;
    content: string;
    metadata: Record<string, unknown>;
  }): Promise<MessageResponse> {
    return this.updateSystemAuthoredMessage({
      messageId: params.messageId,
      channelId: params.sessionRef.childChannelId,
      content: params.content,
      metadata: params.metadata,
    });
  }

  private async upsertParentTaskCard(params: {
    tenantId: string | null;
    sessionRef: DeepResearchSessionRef;
    content: string;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    const existingMessageId = await this.findParentTaskMessageId(
      params.sessionRef,
    );
    if (existingMessageId) {
      await this.updateSystemAuthoredMessage({
        messageId: existingMessageId,
        channelId: params.sessionRef.parentChannelId,
        content: params.content,
        metadata: params.metadata,
      });
      return;
    }

    await this.createSystemAuthoredMessage({
      channelId: params.sessionRef.parentChannelId,
      tenantId: params.tenantId,
      content: params.content,
      metadata: params.metadata,
    });
  }

  private async createSystemAuthoredMessage(params: {
    channelId: string;
    tenantId: string | null;
    content: string;
    metadata: Record<string, unknown>;
  }): Promise<MessageResponse> {
    const messageId = uuidv7();
    const seqId = await this.channelSequence.generateChannelSeq(
      params.channelId,
    );
    const content = sanitizeMessageContent(params.content);
    const type = determineMessageType(content, false);

    await this.db.insert(schema.messages).values({
      id: messageId,
      channelId: params.channelId,
      senderId: null,
      content,
      type,
      seqId,
      clientMsgId: uuidv7(),
      metadata: params.metadata,
    });

    const message = await this.messages.getMessageWithDetails(messageId);
    const [withProps] = await this.messages.mergeProperties([message]);
    const preview = this.messages.truncateForPreview(withProps);

    await this.ws.sendToChannelMembers(
      params.channelId,
      WS_EVENTS.MESSAGE.NEW,
      preview,
    );

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
      channel: { id: params.channelId },
    });

    return preview;
  }

  private async updateSystemAuthoredMessage(params: {
    messageId: string;
    channelId: string;
    content: string;
    metadata: Record<string, unknown>;
  }): Promise<MessageResponse> {
    const content = sanitizeMessageContent(params.content);
    const type = determineMessageType(content, false);

    await this.db
      .update(schema.messages)
      .set({
        content,
        type,
        metadata: params.metadata,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.messages.id, params.messageId),
          eq(schema.messages.channelId, params.channelId),
        ),
      );

    const message = await this.messages.getMessageWithDetails(params.messageId);
    const [withProps] = await this.messages.mergeProperties([message]);
    const preview = this.messages.truncateForPreview(withProps);

    await this.ws.sendToChannelMembers(
      params.channelId,
      WS_EVENTS.MESSAGE.UPDATED,
      preview,
    );

    const channel = await this.channels.findById(params.channelId);
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
      channel: channel ?? { id: params.channelId },
      sender: undefined,
    });

    return preview;
  }

  private async findParentTaskMessageId(
    sessionRef: DeepResearchSessionRef,
  ): Promise<string | null> {
    const rows = await this.db
      .select({
        id: schema.messages.id,
        metadata: schema.messages.metadata,
      })
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.channelId, sessionRef.parentChannelId),
          eq(schema.messages.isDeleted, false),
        ),
      )
      .orderBy(desc(schema.messages.createdAt))
      .limit(100);

    for (const row of rows) {
      const metadata = DeepResearchSessionsService.asRecord(row.metadata);
      const task = DeepResearchSessionsService.asRecord(
        metadata?.deepResearchTask,
      );
      const session = DeepResearchSessionsService.asRecord(task?.session);
      const childChannelId =
        this.stringValue(task?.childChannelId) ??
        this.stringValue(session?.childChannelId);
      if (childChannelId === sessionRef.childChannelId) {
        return row.id;
      }
    }

    return null;
  }

  private async discoverCapability(params: {
    userId: string;
    tenantId: string | null;
  }): Promise<{ id: string }> {
    if (!params.tenantId) {
      throw new Error('tenantId is required for capability-hub calls');
    }

    const identity = { userId: params.userId, tenantId: params.tenantId };
    const items = [
      ...(await this.fetchCapabilityItems(
        identity,
        DEEP_RESEARCH_CAPABILITY_NAME,
      )),
      ...(await this.fetchCapabilityItems(identity, 'deep research')),
    ];
    const capability = items.find((item) => {
      const name = this.stringValue(item.name);
      return (
        name?.replace(/[-_]/g, '_').toLowerCase() ===
        DEEP_RESEARCH_CAPABILITY_NAME
      );
    });
    const id =
      this.stringValue(capability?.tool?.capabilityId) ??
      this.stringValue(capability?.id);
    if (!id) {
      throw new Error('deep research capability not found');
    }
    return { id };
  }

  private async fetchCapabilityItems(
    params: { userId: string; tenantId: string },
    query: string,
  ): Promise<CapabilityItemLike[]> {
    const search = new URLSearchParams({
      type: 'tool',
      status: 'active',
      page: '1',
      limit: String(CAPABILITY_DISCOVERY_LIMIT),
      query,
    });
    const response = await this.hub.request(
      'GET',
      `/api/capabilities?${search.toString()}`,
      {
        headers: this.hub.serviceHeaders({
          userId: params.userId,
          tenantId: params.tenantId,
        }),
      },
    );
    if (!response.ok) {
      throw new Error(`capability discovery failed: ${response.status}`);
    }

    return this.extractCapabilityItems((await response.json()) as unknown);
  }

  private async invokeCapability(
    params: {
      userId: string;
      tenantId: string | null;
      payload: Record<string, unknown>;
    },
    capabilityId: string,
  ): Promise<Record<string, unknown>> {
    if (!params.tenantId) {
      throw new Error('tenantId is required for capability-hub calls');
    }
    const response = await this.hub.request(
      'POST',
      `/api/invoke/${encodeURIComponent(capabilityId)}`,
      {
        headers: {
          ...this.hub.serviceHeaders({
            userId: params.userId,
            tenantId: params.tenantId,
          }),
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          payload: params.payload,
          timeout: CAPABILITY_INVOKE_TIMEOUT_MS,
        }),
      },
    );
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `capability invoke failed: ${response.status} ${body}`.trim(),
      );
    }

    const value = (await response.json()) as unknown;
    const record = DeepResearchSessionsService.asRecord(value);
    const data = DeepResearchSessionsService.asRecord(record?.data);
    return data ?? record ?? {};
  }

  private async waitForTask(
    params: { userId: string; tenantId: string | null },
    taskId: string,
  ): Promise<TaskSnapshot> {
    for (let attempt = 0; attempt < TASK_POLL_MAX_ATTEMPTS; attempt += 1) {
      await this.sleep(TASK_POLL_INTERVAL_MS);
      const snapshot = await this.getTask(params, taskId);
      if (
        snapshot.status === 'completed' ||
        snapshot.status === 'failed' ||
        snapshot.status === 'cancelled'
      ) {
        return snapshot;
      }
    }
    throw new Error('Deep research timed out while waiting for task result');
  }

  private async streamTaskProgress(params: {
    userId: string;
    tenantId: string | null;
    sessionRef: DeepResearchSessionRef;
    kind: DeepResearchKind;
    title: string;
    payload: Record<string, unknown>;
    taskId: string;
    capabilityId: string;
    messageId: string;
    signal: AbortSignal;
    language?: string | null;
    onProgress: (
      progress: DeepResearchProgressSnapshot,
    ) => DeepResearchProgressSnapshot;
  }): Promise<void> {
    let lastUpdateAt = 0;
    let lastEventId: string | undefined;

    for await (const event of this.streamTaskEvents({
      userId: params.userId,
      tenantId: params.tenantId,
      taskId: params.taskId,
      signal: params.signal,
    })) {
      if (params.signal.aborted) return;
      if (event.id) lastEventId = event.id;

      if (event.event === 'deep_research.progress') {
        const nextProgress = this.normalizeDeepResearchProgress(event.data);
        if (!nextProgress) continue;
        const progress = params.onProgress(nextProgress);
        if (this.isTerminalProgress(progress)) {
          continue;
        }
        const now = Date.now();
        if (now - lastUpdateAt < TASK_STREAM_METADATA_UPDATE_MIN_MS) {
          continue;
        }
        lastUpdateAt = now;
        await this.updateChildProgressMessage({
          ...params,
          progress,
          lastEventId,
        });
        continue;
      }

      if (
        event.event === 'interaction.start' ||
        event.event === 'interaction.created'
      ) {
        const interactionId = this.extractInteractionIdFromEvent(event.data);
        const progress = params.onProgress({
          phase: 'started',
          activeStep: deepResearchText(params.language, 'activeStepStarting'),
          ...(interactionId ? { interactionId } : {}),
          updatedAt: new Date().toISOString(),
        });
        await this.updateChildProgressMessage({
          ...params,
          progress,
          lastEventId,
        });
        lastUpdateAt = Date.now();
        continue;
      }

      if (
        event.event === 'completed' ||
        event.event === 'failed' ||
        event.event === 'cancelled'
      ) {
        return;
      }
    }
  }

  private async heartbeatTaskProgress(params: {
    sessionRef: DeepResearchSessionRef;
    kind: DeepResearchKind;
    title: string;
    payload: Record<string, unknown>;
    taskId: string;
    capabilityId: string;
    messageId: string;
    signal: AbortSignal;
    language?: string | null;
    onHeartbeat: () => DeepResearchProgressSnapshot;
  }): Promise<void> {
    while (!params.signal.aborted) {
      const shouldContinue = await this.sleepUnlessAborted(
        TASK_HEARTBEAT_INTERVAL_MS,
        params.signal,
      );
      if (!shouldContinue) return;
      const progress = params.onHeartbeat();
      await this.updateChildProgressMessage({
        ...params,
        progress,
      });
    }
  }

  private async updateChildProgressMessage(params: {
    sessionRef: DeepResearchSessionRef;
    kind: DeepResearchKind;
    title: string;
    payload: Record<string, unknown>;
    taskId: string;
    capabilityId: string;
    messageId: string;
    progress: DeepResearchProgressSnapshot;
    lastEventId?: string;
    language?: string | null;
  }): Promise<void> {
    const progress = this.isTerminalProgress(params.progress)
      ? {
          ...params.progress,
          phase: this.resolveRunningPhase(params),
          activeStep: this.resolveHeartbeatStep(params),
          updatedAt: new Date().toISOString(),
        }
      : params.progress;
    const phase = progress.phase ?? this.resolveRunningPhase(params);
    await this.updateChildSessionMessage({
      sessionRef: params.sessionRef,
      messageId: params.messageId,
      content: this.formatChildRunningContent(params),
      metadata: this.buildMetadata({
        kind: params.kind,
        status: 'running',
        phase,
        taskId: params.taskId,
        capabilityId: params.capabilityId,
        title: params.title,
        sessionRef: params.sessionRef,
        progress,
        ...(progress.interactionId
          ? { interactionId: progress.interactionId }
          : {}),
        ...(params.lastEventId ? { lastEventId: params.lastEventId } : {}),
      }),
    });
  }

  private async *streamTaskEvents(params: {
    userId: string;
    tenantId: string | null;
    taskId: string;
    signal: AbortSignal;
  }): AsyncIterable<TaskStreamEvent> {
    if (!params.tenantId) {
      throw new Error('tenantId is required for capability-hub calls');
    }
    const response = await this.hub.request(
      'GET',
      `/api/tasks/${encodeURIComponent(params.taskId)}/stream`,
      {
        signal: params.signal,
        headers: {
          ...this.hub.serviceHeaders({
            userId: params.userId,
            tenantId: params.tenantId,
          }),
          accept: 'text/event-stream',
        },
      },
    );
    if (!response.ok) {
      throw new Error(`task stream failed: ${response.status}`);
    }
    if (!response.body) {
      throw new Error('task stream returned no body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (!params.signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        yield* this.parseTaskEventBlocks(buffer, (nextBuffer) => {
          buffer = nextBuffer;
        });
      }
      buffer += decoder.decode();
      yield* this.parseTaskEventBlocks(`${buffer}\n\n`, (nextBuffer) => {
        buffer = nextBuffer;
      });
    } catch (error) {
      if (!params.signal.aborted) throw error;
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }

  private *parseTaskEventBlocks(
    buffer: string,
    setBuffer: (value: string) => void,
  ): Iterable<TaskStreamEvent> {
    let remaining = buffer;
    while (true) {
      const match = remaining.match(/\r?\n\r?\n/);
      if (!match) break;
      const boundaryIndex = match.index ?? -1;
      if (boundaryIndex < 0) break;
      const block = remaining.slice(0, boundaryIndex);
      remaining = remaining.slice(boundaryIndex + match[0].length);
      const event = this.parseTaskEventBlock(block);
      if (event) yield event;
    }
    setBuffer(remaining);
  }

  private parseTaskEventBlock(block: string): TaskStreamEvent | null {
    let id: string | undefined;
    let event: string | undefined;
    const dataLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('id:')) {
        id = line.slice(3).trim();
      } else if (line.startsWith('event:')) {
        event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    if (dataLines.length === 0 && !event && !id) return null;
    const rawData = dataLines.join('\n');
    let data: unknown = rawData;
    if (rawData) {
      try {
        data = JSON.parse(rawData) as unknown;
      } catch {
        data = rawData;
      }
    }
    return {
      ...(id ? { id } : {}),
      ...(event ? { event } : {}),
      data,
    };
  }

  private async getTask(
    params: { userId: string; tenantId: string | null },
    taskId: string,
  ): Promise<TaskSnapshot> {
    if (!params.tenantId) {
      throw new Error('tenantId is required for capability-hub calls');
    }
    const response = await this.hub.request(
      'GET',
      `/api/tasks/${encodeURIComponent(taskId)}`,
      {
        headers: this.hub.serviceHeaders({
          userId: params.userId,
          tenantId: params.tenantId,
        }),
      },
    );
    if (!response.ok) {
      throw new Error(`get task failed: ${response.status}`);
    }
    const payload = (await response.json()) as unknown;
    const record = DeepResearchSessionsService.asRecord(payload);
    const data = DeepResearchSessionsService.asRecord(record?.data);
    return (data ?? record ?? {}) as TaskSnapshot;
  }

  private buildPayload(params: {
    input: string;
    kind: DeepResearchKind;
    request?: Record<string, unknown> | null;
    previousInteractionId?: string;
    model?: string;
    language?: string | null;
  }): Record<string, unknown> {
    const localizedInput = this.withLanguageInstruction(
      params.input,
      params.language,
    );
    if (params.model) {
      return {
        input: localizedInput,
        model: params.model,
        ...(params.previousInteractionId
          ? {
              previousInteractionId: params.previousInteractionId,
              previous_interaction_id: params.previousInteractionId,
            }
          : {}),
      };
    }

    const collaborativePlanning = params.kind === 'plan';
    const requestAgentConfig = DeepResearchSessionsService.asRecord(
      params.request?.agentConfig,
    );
    const agentConfig = {
      ...(requestAgentConfig ?? {}),
      type: 'deep-research',
      collaborativePlanning,
      collaborative_planning: collaborativePlanning,
    };

    return {
      input: localizedInput,
      background: true,
      stream: true,
      ...(params.request?.agent ? { agent: params.request.agent } : {}),
      ...(params.request?.tools ? { tools: params.request.tools } : {}),
      agentConfig,
      agent_config: agentConfig,
      ...(params.previousInteractionId
        ? {
            previousInteractionId: params.previousInteractionId,
            previous_interaction_id: params.previousInteractionId,
          }
        : {}),
    };
  }

  private async resolveUserLanguage(userId: string): Promise<string | null> {
    try {
      const [row] = await this.db
        .select({ language: schema.users.language })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1);
      return row?.language ?? null;
    } catch (error) {
      this.logger.warn(
        `Failed to resolve deep research user language for ${userId}: ${error}`,
      );
      return null;
    }
  }

  private withLanguageInstruction(
    input: string,
    preferredLanguage?: string | null,
  ): string {
    const trimmed = input.trim();
    const language = this.resolveTargetLanguage(trimmed, preferredLanguage);
    if (language === 'zh-CN') {
      return [
        '请始终使用简体中文输出，包括研究计划、研究过程总结、网站检索说明、最终报告和后续回答。',
        '不要因为英文资料来源或模型默认行为而切换成英文；专有名词可以保留原文并附中文解释。',
        '',
        `用户问题：${trimmed}`,
      ].join('\n');
    }
    if (language === 'zh-TW') {
      return [
        '請始終使用繁體中文輸出，包括研究計畫、研究過程摘要、網站檢索說明、最終報告和後續回答。',
        '不要因為英文資料來源或模型預設行為而切換成英文；專有名詞可以保留原文並附繁體中文解釋。',
        '',
        `使用者問題：${trimmed}`,
      ].join('\n');
    }

    const languageName = this.languageDisplayName(language);

    return [
      languageName
        ? `Respond in ${languageName}. Keep the research plan, progress summaries, website-search notes, final report, and follow-up answers in ${languageName}.`
        : 'Respond in the same language as the user request. Keep the research plan, progress summaries, website-search notes, final report, and follow-up answers in that language.',
      '',
      `User request: ${trimmed}`,
    ].join('\n');
  }

  private resolveTargetLanguage(
    input: string,
    preferredLanguage?: string | null,
  ): string {
    const preferred = this.normalizeLanguageTag(preferredLanguage);
    if (/[\u3040-\u30ff]/.test(input)) return 'ja';
    if (/[\uac00-\ud7af]/.test(input)) return 'ko';
    if (/[\u0400-\u04ff]/.test(input)) return 'ru';
    if (/[\u3400-\u9fff]/.test(input)) {
      return preferred === 'zh-TW' ? 'zh-TW' : 'zh-CN';
    }
    return preferred ?? 'auto';
  }

  private normalizeLanguageTag(
    language: string | null | undefined,
  ): string | null {
    const normalized = language?.trim();
    if (!normalized) return null;
    const lower = normalized.toLowerCase();
    if (
      lower === 'zh-tw' ||
      lower === 'zh-hant' ||
      lower.startsWith('zh-hant-') ||
      lower === 'zh-hk' ||
      lower === 'zh-mo'
    ) {
      return 'zh-TW';
    }
    if (
      lower === 'zh' ||
      lower === 'zh-cn' ||
      lower === 'zh-hans' ||
      lower.startsWith('zh-hans-') ||
      lower === 'zh-sg'
    ) {
      return 'zh-CN';
    }
    return lower.split('-')[0] || null;
  }

  private languageDisplayName(language: string): string | null {
    switch (language) {
      case 'de':
        return 'German';
      case 'es':
        return 'Spanish';
      case 'fr':
        return 'French';
      case 'it':
        return 'Italian';
      case 'ja':
        return 'Japanese';
      case 'ko':
        return 'Korean';
      case 'nl':
        return 'Dutch';
      case 'pt':
        return 'Portuguese';
      case 'ru':
        return 'Russian';
      case 'en':
        return 'English';
      case 'auto':
        return null;
      default:
        return language ? `the user's preferred language (${language})` : null;
    }
  }

  private resolveRunningPhase(params: {
    kind: DeepResearchKind;
    payload: Record<string, unknown>;
  }): string {
    if (params.kind === 'plan') return 'planning';
    if (this.isModelFollowUpPayload(params.payload)) return 'answering';
    return 'researching';
  }

  private formatChildRunningContent(params: {
    kind: DeepResearchKind;
    payload: Record<string, unknown>;
    language?: string | null;
  }): string {
    if (params.kind === 'plan') {
      return deepResearchText(params.language, 'childGeneratingPlan');
    }
    if (this.isModelFollowUpPayload(params.payload)) {
      return deepResearchText(params.language, 'childAnswering');
    }
    return deepResearchText(params.language, 'childStartedResearch');
  }

  private resolveHeartbeatStep(params: {
    kind: DeepResearchKind;
    payload: Record<string, unknown>;
    language?: string | null;
  }): string {
    if (params.kind === 'plan') {
      return deepResearchText(params.language, 'heartbeatPlan');
    }
    if (this.isModelFollowUpPayload(params.payload)) {
      return deepResearchText(params.language, 'heartbeatAnswering');
    }
    return deepResearchText(params.language, 'heartbeatResearch');
  }

  private isModelFollowUpPayload(payload: Record<string, unknown>): boolean {
    return typeof payload.model === 'string' && payload.model.trim().length > 0;
  }

  private buildMetadata(params: {
    kind: DeepResearchKind;
    status: 'running' | 'completed' | 'failed';
    phase: string;
    title: string;
    sessionRef: DeepResearchSessionRef;
    taskId?: string;
    capabilityId?: string;
    interactionId?: string;
    reportS3Key?: string;
    truncated?: boolean;
    sizeBytes?: number;
    error?: string;
    progress?: DeepResearchProgressSnapshot;
    lastEventId?: string;
  }): Record<string, unknown> {
    return {
      longRunning: params.status === 'running',
      deepResearch: {
        source: 'capability-hub',
        updatedAt: new Date().toISOString(),
        ...params,
        session: {
          ...params.sessionRef,
          agentWakePolicy: 'none',
        },
      },
      deepResearchSessionRef: {
        ...params.sessionRef,
        agentWakePolicy: 'none',
      },
    };
  }

  private buildParentTaskMetadata(params: {
    childMetadata: Record<string, unknown>;
    sessionRef: DeepResearchSessionRef;
  }): Record<string, unknown> {
    const deepResearch = DeepResearchSessionsService.asRecord(
      params.childMetadata.deepResearch,
    );
    const status = this.stringValue(deepResearch?.status);
    const kind = this.stringValue(deepResearch?.kind);
    const phase = this.stringValue(deepResearch?.phase);
    const taskStatus: ParentTaskStatus =
      status === 'failed' || phase === 'failed'
        ? 'failed'
        : kind === 'plan' && status === 'completed'
          ? 'plan_ready'
          : kind === 'report' && status === 'completed'
            ? 'completed'
            : 'running';

    return {
      deepResearchTask: {
        source: 'team9',
        childChannelId: params.sessionRef.childChannelId,
        parentChannelId: params.sessionRef.parentChannelId,
        ...(params.sessionRef.parentMessageId
          ? { parentMessageId: params.sessionRef.parentMessageId }
          : {}),
        title: this.stringValue(deepResearch?.title) ?? 'Deep Research',
        kind,
        status: taskStatus,
        phase,
        updatedAt: new Date().toISOString(),
        agentWakePolicy: 'none',
        ...(this.stringValue(deepResearch?.taskId)
          ? { taskId: this.stringValue(deepResearch?.taskId) }
          : {}),
        ...(this.stringValue(deepResearch?.capabilityId)
          ? { capabilityId: this.stringValue(deepResearch?.capabilityId) }
          : {}),
        ...(this.stringValue(deepResearch?.interactionId)
          ? { interactionId: this.stringValue(deepResearch?.interactionId) }
          : {}),
        ...(this.stringValue(deepResearch?.reportS3Key)
          ? { reportS3Key: this.stringValue(deepResearch?.reportS3Key) }
          : {}),
        ...(typeof deepResearch?.truncated === 'boolean'
          ? { truncated: deepResearch.truncated }
          : {}),
        ...(typeof deepResearch?.sizeBytes === 'number'
          ? { sizeBytes: deepResearch.sizeBytes }
          : {}),
        ...(this.stringValue(deepResearch?.error)
          ? { error: this.stringValue(deepResearch?.error) }
          : {}),
        session: {
          ...params.sessionRef,
          agentWakePolicy: 'none',
        },
      },
      deepResearchSessionRef: {
        ...params.sessionRef,
        agentWakePolicy: 'none',
      },
    };
  }

  private formatParentTaskContent(params: {
    title: string;
    kind: DeepResearchKind;
    status: ParentTaskStatus;
    phase: string;
    error?: string;
    language?: string | null;
  }): string {
    if (params.status === 'failed') {
      return deepResearchText(params.language, 'parentFailed', {
        title: params.title,
        error:
          params.error ?? deepResearchText(params.language, 'unknownError'),
      });
    }
    if (params.status === 'plan_ready') {
      return deepResearchText(params.language, 'parentPlanReady', {
        title: params.title,
      });
    }
    if (params.status === 'completed') {
      return deepResearchText(params.language, 'parentCompleted', {
        title: params.title,
      });
    }
    if (params.kind === 'plan') {
      return deepResearchText(params.language, 'parentGeneratingPlan', {
        title: params.title,
      });
    }
    return deepResearchText(params.language, 'parentRunning', {
      title: params.title,
    });
  }

  private extractTaskResult(value: unknown): {
    kind?: DeepResearchKind;
    markdown?: string;
    interactionId?: string;
    reportS3Key?: string;
    truncated?: boolean;
    sizeBytes?: number;
  } {
    const record = DeepResearchSessionsService.asRecord(value);
    const data = DeepResearchSessionsService.asRecord(record?.data);
    const result = data ?? record ?? {};
    const kindValue = this.stringValue(result.kind);
    const kind =
      kindValue === 'plan' || kindValue === 'report' ? kindValue : undefined;
    return {
      ...(kind ? { kind } : {}),
      ...(this.stringValue(result.markdown)
        ? { markdown: this.stringValue(result.markdown) }
        : this.stringValue(result.content)
          ? { markdown: this.stringValue(result.content) }
          : this.stringValue(result.text)
            ? { markdown: this.stringValue(result.text) }
            : {}),
      ...(this.stringValue(result.interactionId)
        ? { interactionId: this.stringValue(result.interactionId) }
        : this.stringValue(result.interaction_id)
          ? { interactionId: this.stringValue(result.interaction_id) }
          : this.stringValue(result.id)
            ? { interactionId: this.stringValue(result.id) }
            : {}),
      ...(this.stringValue(result.reportS3Key)
        ? { reportS3Key: this.stringValue(result.reportS3Key) }
        : {}),
      ...(typeof result.truncated === 'boolean'
        ? { truncated: result.truncated }
        : {}),
      ...(typeof result.sizeBytes === 'number'
        ? { sizeBytes: result.sizeBytes }
        : {}),
    };
  }

  private extractMarkdownSourceProgress(
    markdown: string,
  ): DeepResearchProgressSnapshot | undefined {
    const sourcesSection = this.extractSourcesSection(markdown);
    if (!sourcesSection) return undefined;

    const sources: DeepResearchSourceProgress[] = [];
    const seen = new Set<string>();
    const linkPattern = /\[([^\]\n]{1,160})\]\((https?:\/\/[^)\s]+)\)/g;
    let match: RegExpExecArray | null;
    while ((match = linkPattern.exec(sourcesSection))) {
      const label = this.stripMarkdownSourceLabel(match[1] ?? '');
      const url = match[2]?.trim();
      if (!label || !url) continue;
      const domain =
        this.domainFromSourceLabel(label) ??
        this.nonRedirectDomainFromUrl(url) ??
        this.domainFromUrl(url);
      const key = `${domain ?? ''}|${url}`;
      if (!domain || seen.has(key)) continue;
      seen.add(key);
      sources.push({
        id: key,
        url,
        title: label,
        domain,
        status: 'used',
      });
      if (sources.length >= 32) break;
    }

    if (sources.length === 0) return undefined;
    return {
      sources,
      counts: { websites: sources.length },
      updatedAt: new Date().toISOString(),
    };
  }

  private extractSourcesSection(markdown: string): string | undefined {
    const headingPattern =
      /(?:^|\n)\s*(?:#{1,6}\s*)?(?:\*\*)?\s*(?:Sources|来源|参考来源|参考资料)\s*:?\s*(?:\*\*)?\s*(?:\n|$)/gi;
    let lastMatch: RegExpExecArray | null = null;
    let match: RegExpExecArray | null;
    while ((match = headingPattern.exec(markdown))) {
      lastMatch = match;
    }
    if (!lastMatch) return undefined;
    const start = lastMatch.index + lastMatch[0].length;
    return markdown.slice(start);
  }

  private stripMarkdownSourceLabel(label: string): string {
    return label
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .trim();
  }

  private domainFromSourceLabel(label: string): string | undefined {
    const withoutProtocol = label
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .split(/[/?#]/)[0]
      ?.trim()
      .toLowerCase();
    if (
      withoutProtocol &&
      /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(withoutProtocol)
    ) {
      return withoutProtocol;
    }
    return undefined;
  }

  private nonRedirectDomainFromUrl(url: string): string | undefined {
    const domain = this.domainFromUrl(url);
    if (!domain) return undefined;
    return domain === 'vertexaisearch.cloud.google.com' ? undefined : domain;
  }

  private domainFromUrl(url: string): string | undefined {
    try {
      return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
    } catch {
      return undefined;
    }
  }

  private normalizeDeepResearchProgress(
    value: unknown,
  ): DeepResearchProgressSnapshot | undefined {
    const record = DeepResearchSessionsService.asRecord(value);
    if (!record) return undefined;

    const thoughts = this.normalizeProgressThoughts(record.thoughts);
    const sources = this.normalizeProgressSources(record.sources);
    const queries = this.normalizeProgressQueries(record.queries);
    const counts = DeepResearchSessionsService.asRecord(record.counts);
    const version =
      typeof record.version === 'number' && Number.isFinite(record.version)
        ? record.version
        : undefined;
    const phase = this.stringValue(record.phase);
    const activeStep = this.stringValue(record.activeStep);
    const interactionId = this.stringValue(record.interactionId);
    const updatedAt = this.stringValue(record.updatedAt);

    const hasProgress =
      version !== undefined ||
      phase ||
      activeStep ||
      interactionId ||
      thoughts.length > 0 ||
      sources.length > 0 ||
      queries.length > 0 ||
      counts ||
      updatedAt;
    if (!hasProgress) return undefined;

    return {
      ...(version !== undefined ? { version } : {}),
      ...(phase ? { phase } : {}),
      ...(activeStep ? { activeStep } : {}),
      ...(interactionId ? { interactionId } : {}),
      ...(thoughts.length ? { thoughts } : {}),
      ...(sources.length ? { sources } : {}),
      ...(queries.length ? { queries } : {}),
      ...(counts ? { counts } : {}),
      ...(updatedAt ? { updatedAt } : {}),
    };
  }

  private normalizeProgressThoughts(
    value: unknown,
  ): DeepResearchThoughtProgress[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((item): DeepResearchThoughtProgress | null => {
        const record = DeepResearchSessionsService.asRecord(item);
        if (!record) return null;
        const text = this.stringValue(record.text);
        if (!text) return null;
        return {
          ...(this.stringValue(record.id)
            ? { id: this.stringValue(record.id) }
            : {}),
          ...(this.stringValue(record.title)
            ? { title: this.stringValue(record.title) }
            : {}),
          text: this.truncateString(text, 1_800),
          ...(this.stringValue(record.status)
            ? { status: this.stringValue(record.status) }
            : {}),
        };
      })
      .filter((item): item is DeepResearchThoughtProgress => item !== null)
      .slice(0, 8);
  }

  private normalizeProgressSources(
    value: unknown,
  ): DeepResearchSourceProgress[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((item): DeepResearchSourceProgress | null => {
        const record = DeepResearchSessionsService.asRecord(item);
        if (!record) return null;
        const url = this.stringValue(record.url);
        if (!url) return null;
        const title = this.stringValue(record.title);
        return {
          ...(this.stringValue(record.id)
            ? { id: this.stringValue(record.id) }
            : {}),
          url,
          ...(title ? { title: this.truncateString(title, 160) } : {}),
          ...(this.stringValue(record.domain)
            ? { domain: this.stringValue(record.domain) }
            : {}),
          ...(this.stringValue(record.status)
            ? { status: this.stringValue(record.status) }
            : {}),
        };
      })
      .filter((item): item is DeepResearchSourceProgress => item !== null)
      .slice(0, 32);
  }

  private normalizeProgressQueries(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => this.stringValue(item))
      .filter((item): item is string => Boolean(item))
      .slice(0, 16);
  }

  private mergeDeepResearchProgress(
    previous: DeepResearchProgressSnapshot | undefined,
    next: DeepResearchProgressSnapshot,
  ): DeepResearchProgressSnapshot {
    if (!previous) return next;
    const thoughts = this.mergeProgressThoughts(
      previous.thoughts,
      next.thoughts,
    );
    const sources = this.mergeProgressSources(previous.sources, next.sources);
    const queries = this.mergeProgressQueries(previous.queries, next.queries);
    return {
      ...previous,
      ...next,
      ...(thoughts.length ? { thoughts } : {}),
      ...(sources.length ? { sources } : {}),
      ...(queries.length ? { queries } : {}),
      ...(previous.counts || next.counts
        ? { counts: { ...(previous.counts ?? {}), ...(next.counts ?? {}) } }
        : {}),
    };
  }

  private completeDeepResearchProgress(
    progress: DeepResearchProgressSnapshot | undefined,
    language?: string | null,
  ): DeepResearchProgressSnapshot | undefined {
    if (!progress) return undefined;
    return {
      ...progress,
      phase: 'completed',
      activeStep: deepResearchText(language, 'progressCompleted'),
      updatedAt: new Date().toISOString(),
    };
  }

  private isTerminalProgress(progress: DeepResearchProgressSnapshot): boolean {
    return progress.phase === 'completed' || progress.phase === 'failed';
  }

  private mergeProgressThoughts(
    previous: DeepResearchThoughtProgress[] | undefined,
    next: DeepResearchThoughtProgress[] | undefined,
  ): DeepResearchThoughtProgress[] {
    const merged = [...(previous ?? [])];
    const byKey = new Map<string, number>();
    merged.forEach((thought, index) => {
      const key = thought.id ? `id:${thought.id}` : `text:${thought.text}`;
      byKey.set(key, index);
    });
    for (const thought of next ?? []) {
      const key = thought.id ? `id:${thought.id}` : `text:${thought.text}`;
      const index = byKey.get(key);
      if (index === undefined) {
        byKey.set(key, merged.length);
        merged.push(thought);
        continue;
      }
      merged[index] = merged[index]
        ? { ...merged[index], ...thought }
        : thought;
    }
    return merged.slice(-8);
  }

  private mergeProgressSources(
    previous: DeepResearchSourceProgress[] | undefined,
    next: DeepResearchSourceProgress[] | undefined,
  ): DeepResearchSourceProgress[] {
    const byUrl = new Map<string, DeepResearchSourceProgress>();
    for (const source of previous ?? []) byUrl.set(source.url, source);
    for (const source of next ?? []) {
      byUrl.set(source.url, { ...(byUrl.get(source.url) ?? {}), ...source });
    }
    return [...byUrl.values()].slice(-32);
  }

  private mergeProgressQueries(
    previous: string[] | undefined,
    next: string[] | undefined,
  ): string[] {
    return [...new Set([...(previous ?? []), ...(next ?? [])])].slice(-16);
  }

  private extractInteractionIdFromEvent(value: unknown): string | undefined {
    const record = DeepResearchSessionsService.asRecord(value);
    if (!record) return undefined;
    const interaction = DeepResearchSessionsService.asRecord(
      record.interaction,
    );
    return (
      this.stringValue(record.interactionId) ??
      this.stringValue(record.interaction_id) ??
      this.stringValue(record.id) ??
      this.stringValue(interaction?.id)
    );
  }

  private async canReadMessageChannel(
    message: MessageResponse,
    userId: string,
  ): Promise<boolean> {
    try {
      await this.channels.assertReadAccess(message.channelId, userId);
      return true;
    } catch {
      return false;
    }
  }

  private async extractSessionRefFromChannel(
    childChannelId: string,
  ): Promise<DeepResearchSessionRef | null> {
    const channel = await this.channels.findById(childChannelId);
    const settings = DeepResearchSessionsService.asRecord(
      channel?.propertySettings,
    );
    const session = DeepResearchSessionsService.asRecord(
      settings?.deepResearchSession,
    );
    const parentChannelId = this.stringValue(session?.parentChannelId);
    if (!parentChannelId) return null;
    return { childChannelId, parentChannelId };
  }

  private extractSessionRef(metadata: unknown): DeepResearchSessionRef | null {
    const record = DeepResearchSessionsService.asRecord(metadata);
    const direct = DeepResearchSessionsService.asRecord(
      record?.deepResearchSessionRef,
    );
    const deepResearch = DeepResearchSessionsService.asRecord(
      record?.deepResearch,
    );
    const nested = DeepResearchSessionsService.asRecord(deepResearch?.session);
    const source = direct ?? nested;
    const childChannelId = this.stringValue(source?.childChannelId);
    const parentChannelId = this.stringValue(source?.parentChannelId);
    if (!childChannelId || !parentChannelId) return null;
    const parentMessageId = this.stringValue(source?.parentMessageId);
    return {
      childChannelId,
      parentChannelId,
      ...(parentMessageId ? { parentMessageId } : {}),
    };
  }

  private extractInteractionId(metadata: unknown): string | undefined {
    const record = DeepResearchSessionsService.asRecord(metadata);
    const deepResearch = DeepResearchSessionsService.asRecord(
      record?.deepResearch,
    );
    return (
      this.stringValue(deepResearch?.interactionId) ??
      this.stringValue(deepResearch?.interaction_id) ??
      this.stringValue(deepResearch?.id)
    );
  }

  private extractTitle(content: string | null): string | undefined {
    return content?.match(/^\s{0,3}#{1,3}\s+(.+)$/m)?.[1]?.trim();
  }

  private extractTitleFromMetadata(metadata: unknown): string | undefined {
    const record = DeepResearchSessionsService.asRecord(metadata);
    const deepResearch = DeepResearchSessionsService.asRecord(
      record?.deepResearch,
    );
    return this.stringValue(deepResearch?.title);
  }

  private extractCapabilityItems(payload: unknown): CapabilityItemLike[] {
    const record = DeepResearchSessionsService.asRecord(payload);
    const data = DeepResearchSessionsService.asRecord(record?.data);
    const items = record?.items ?? data?.items;
    return Array.isArray(items) ? (items as CapabilityItemLike[]) : [];
  }

  private getFollowUpModel(): string {
    return (
      this.config.get<string>('GEMINI_DEEP_RESEARCH_FOLLOW_UP_MODEL')?.trim() ||
      DEFAULT_DEEP_RESEARCH_FOLLOW_UP_MODEL
    );
  }

  private formatFallbackResult(value: unknown): string {
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  private limitContent(content: string, language?: string | null): string {
    if (content.length <= MAX_STORED_CONTENT_CHARS) return content;
    return `${content.slice(0, MAX_STORED_CONTENT_CHARS)}\n\n${deepResearchText(
      language,
      'truncated',
    )}`;
  }

  private truncateString(value: string, maxChars: number): string {
    if (value.length <= maxChars) return value;
    return `${value.slice(0, maxChars).trim()}...`;
  }

  private stringValue(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private sleepUnlessAborted(
    ms: number,
    signal: AbortSignal,
  ): Promise<boolean> {
    if (signal.aborted) return Promise.resolve(false);
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve(true);
      }, ms);
      const onAbort = () => {
        clearTimeout(timeout);
        signal.removeEventListener('abort', onAbort);
        resolve(false);
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private static asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }
}
