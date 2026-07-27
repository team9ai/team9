import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  DATABASE_CONNECTION,
  and,
  eq,
  inArray,
  sql,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import { ClawHiveService } from '@team9/claw-hive';
import { v7 as uuidv7 } from 'uuid';
import type { BotService } from '../bot/bot.service.js';
import { BOT_SERVICE_TOKEN } from '../im/channels/channels.service.js';
import { WEBSOCKET_GATEWAY } from '../shared/constants/injection-tokens.js';
import type { WebsocketGateway } from '../im/websocket/websocket.gateway.js';
import {
  WS_EVENTS,
  type ChannelModelChangedEvent,
} from '../im/websocket/events/events.constants.js';

export const MODEL_CHANGE_BATCH_SIZE = 20;
export const MODEL_CHANGE_CLAIM_LEASE_MS = 60_000;
export const MODEL_CHANGE_INTERVAL_MS = 1_000;
export const MODEL_CHANGE_MAX_DISPATCH_ATTEMPTS = 8;
const MAX_BACKOFF_MS = 60_000;

export interface ModelChangeOutboxWorkItem {
  outboxId: string;
  attemptId: string;
  claimToken: string;
  retryCount: number;
  actorUserId: string | null;
  tenantId: string | null;
  channelId: string | null;
  botId: string | null;
  botUserId: string | null;
  applicationId: string | null;
  sessionId: string | null;
  requestedProvider: string;
  requestedModelId: string;
}

export interface ModelChangePublicationWorkItem extends Omit<
  ModelChangeOutboxWorkItem,
  'claimToken' | 'retryCount'
> {
  publicationClaimToken: string;
  publicationRetryCount: number;
}

export abstract class ModelChangeOutboxStore {
  abstract claimDue(
    limit: number,
    now: Date,
  ): Promise<ModelChangeOutboxWorkItem[]>;

  abstract claimAttempt(
    attemptId: string,
    now: Date,
  ): Promise<ModelChangeOutboxWorkItem | null>;

  abstract markDispatched(
    item: ModelChangeOutboxWorkItem,
    now: Date,
  ): Promise<boolean>;

  abstract markRetry(
    item: ModelChangeOutboxWorkItem,
    safeErrorCode: string,
    nextAttemptAt: Date,
    now: Date,
  ): Promise<boolean>;

  abstract markFailed(
    item: ModelChangeOutboxWorkItem,
    safeErrorCode: string,
    now: Date,
  ): Promise<boolean>;

  abstract claimPublications(
    limit: number,
    now: Date,
  ): Promise<ModelChangePublicationWorkItem[]>;

  abstract markPublished(
    item: ModelChangePublicationWorkItem,
    now: Date,
  ): Promise<boolean>;

  abstract releasePublication(
    item: ModelChangePublicationWorkItem,
    safeErrorCode: string,
    nextAttemptAt: Date,
    now: Date,
  ): Promise<boolean>;
}

@Injectable()
export class PostgresModelChangeOutboxStore extends ModelChangeOutboxStore {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {
    super();
  }

  async claimDue(
    limit: number,
    now: Date,
  ): Promise<ModelChangeOutboxWorkItem[]> {
    const claimToken = uuidv7();
    const claimUntil = new Date(now.getTime() + MODEL_CHANGE_CLAIM_LEASE_MS);
    const rows = await this.db.execute(sql`
      WITH due AS (
        SELECT o.id
        FROM im_model_change_outbox AS o
        JOIN im_model_change_attempts AS a ON a.id = o.attempt_id
        WHERE a.decision = 'accepted'
          AND (
            (o.status = 'pending' AND o.next_attempt_at <= ${now})
            OR (
              o.status = 'processing'
              AND (o.claim_until IS NULL OR o.claim_until <= ${now})
            )
          )
        ORDER BY o.next_attempt_at, o.created_at
        FOR UPDATE OF o SKIP LOCKED
        LIMIT ${limit}
      )
      UPDATE im_model_change_outbox AS o
      SET status = 'processing',
          claim_token = ${claimToken},
          claim_until = ${claimUntil},
          updated_at = ${now}
      FROM due, im_model_change_attempts AS a
      WHERE o.id = due.id
        AND a.id = o.attempt_id
      RETURNING
        o.id AS "outboxId",
        o.attempt_id AS "attemptId",
        o.claim_token AS "claimToken",
        o.retry_count AS "retryCount",
        a.actor_user_id AS "actorUserId",
        a.tenant_id AS "tenantId",
        a.channel_id AS "channelId",
        a.bot_id AS "botId",
        a.bot_user_id AS "botUserId",
        a.application_id AS "applicationId",
        a.session_id AS "sessionId",
        a.requested_provider AS "requestedProvider",
        a.requested_model_id AS "requestedModelId"
    `);
    const claimed = Array.from(
      rows as unknown as Iterable<ModelChangeOutboxWorkItem>,
    );
    if (claimed.length > 0) {
      await this.db
        .update(schema.modelChangeAttempts)
        .set({ dispatchStatus: 'dispatching', updatedAt: now })
        .where(
          inArray(
            schema.modelChangeAttempts.id,
            claimed.map((item) => item.attemptId),
          ),
        );
    }
    return claimed;
  }

  async claimAttempt(
    attemptId: string,
    now: Date,
  ): Promise<ModelChangeOutboxWorkItem | null> {
    const claimToken = uuidv7();
    const claimUntil = new Date(now.getTime() + MODEL_CHANGE_CLAIM_LEASE_MS);
    const rows = await this.db.execute(sql`
      WITH due AS (
        SELECT o.id
        FROM im_model_change_outbox AS o
        JOIN im_model_change_attempts AS a ON a.id = o.attempt_id
        WHERE o.attempt_id = ${attemptId}
          AND a.decision = 'accepted'
          AND (
            (o.status = 'pending' AND o.next_attempt_at <= ${now})
            OR (
              o.status = 'processing'
              AND (o.claim_until IS NULL OR o.claim_until <= ${now})
            )
          )
        FOR UPDATE OF o SKIP LOCKED
      )
      UPDATE im_model_change_outbox AS o
      SET status = 'processing',
          claim_token = ${claimToken},
          claim_until = ${claimUntil},
          updated_at = ${now}
      FROM due, im_model_change_attempts AS a
      WHERE o.id = due.id
        AND a.id = o.attempt_id
      RETURNING
        o.id AS "outboxId",
        o.attempt_id AS "attemptId",
        o.claim_token AS "claimToken",
        o.retry_count AS "retryCount",
        a.actor_user_id AS "actorUserId",
        a.tenant_id AS "tenantId",
        a.channel_id AS "channelId",
        a.bot_id AS "botId",
        a.bot_user_id AS "botUserId",
        a.application_id AS "applicationId",
        a.session_id AS "sessionId",
        a.requested_provider AS "requestedProvider",
        a.requested_model_id AS "requestedModelId"
    `);
    const [claimed] = Array.from(
      rows as unknown as Iterable<ModelChangeOutboxWorkItem>,
    );
    if (!claimed) return null;
    await this.db
      .update(schema.modelChangeAttempts)
      .set({ dispatchStatus: 'dispatching', updatedAt: now })
      .where(eq(schema.modelChangeAttempts.id, claimed.attemptId));
    return claimed;
  }

  async markDispatched(
    item: ModelChangeOutboxWorkItem,
    now: Date,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const updated = await tx
        .update(schema.modelChangeOutbox)
        .set({
          status: 'dispatched',
          claimToken: null,
          claimUntil: null,
          safeErrorCode: null,
          publishedAt: item.channelId ? null : now,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.modelChangeOutbox.id, item.outboxId),
            eq(schema.modelChangeOutbox.status, 'processing'),
            eq(schema.modelChangeOutbox.claimToken, item.claimToken),
          ),
        )
        .returning({ id: schema.modelChangeOutbox.id });
      if (updated.length === 0) return false;

      await tx
        .update(schema.modelChangeAttempts)
        .set({
          dispatchStatus: 'dispatched',
          safeErrorCode: null,
          dispatchedAt: now,
          updatedAt: now,
        })
        .where(eq(schema.modelChangeAttempts.id, item.attemptId));
      return true;
    });
  }

  async markRetry(
    item: ModelChangeOutboxWorkItem,
    safeErrorCode: string,
    nextAttemptAt: Date,
    now: Date,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const updated = await tx
        .update(schema.modelChangeOutbox)
        .set({
          status: 'pending',
          retryCount: sql`${schema.modelChangeOutbox.retryCount} + 1`,
          nextAttemptAt,
          claimToken: null,
          claimUntil: null,
          safeErrorCode,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.modelChangeOutbox.id, item.outboxId),
            eq(schema.modelChangeOutbox.status, 'processing'),
            eq(schema.modelChangeOutbox.claimToken, item.claimToken),
          ),
        )
        .returning({ id: schema.modelChangeOutbox.id });
      if (updated.length === 0) return false;

      await tx
        .update(schema.modelChangeAttempts)
        .set({
          dispatchStatus: 'pending',
          safeErrorCode,
          updatedAt: now,
        })
        .where(eq(schema.modelChangeAttempts.id, item.attemptId));
      return true;
    });
  }

  async markFailed(
    item: ModelChangeOutboxWorkItem,
    safeErrorCode: string,
    now: Date,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const updated = await tx
        .update(schema.modelChangeOutbox)
        .set({
          status: 'failed',
          retryCount: sql`${schema.modelChangeOutbox.retryCount} + 1`,
          claimToken: null,
          claimUntil: null,
          safeErrorCode,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.modelChangeOutbox.id, item.outboxId),
            eq(schema.modelChangeOutbox.status, 'processing'),
            eq(schema.modelChangeOutbox.claimToken, item.claimToken),
          ),
        )
        .returning({ id: schema.modelChangeOutbox.id });
      if (updated.length === 0) return false;

      await tx
        .update(schema.modelChangeAttempts)
        .set({
          dispatchStatus: 'failed',
          safeErrorCode,
          updatedAt: now,
        })
        .where(eq(schema.modelChangeAttempts.id, item.attemptId));
      return true;
    });
  }

  async claimPublications(
    limit: number,
    now: Date,
  ): Promise<ModelChangePublicationWorkItem[]> {
    const publicationClaimToken = uuidv7();
    const claimUntil = new Date(now.getTime() + MODEL_CHANGE_CLAIM_LEASE_MS);
    const rows = await this.db.execute(sql`
      WITH due AS (
        SELECT o.id
        FROM im_model_change_outbox AS o
        JOIN im_model_change_attempts AS a ON a.id = o.attempt_id
        WHERE o.status = 'dispatched'
          AND o.published_at IS NULL
          AND a.channel_id IS NOT NULL
          AND (
            o.publication_claim_until IS NULL
            OR o.publication_claim_until <= ${now}
          )
        ORDER BY o.updated_at, o.created_at
        FOR UPDATE OF o SKIP LOCKED
        LIMIT ${limit}
      )
      UPDATE im_model_change_outbox AS o
      SET publication_claim_token = ${publicationClaimToken},
          publication_claim_until = ${claimUntil},
          updated_at = ${now}
      FROM due, im_model_change_attempts AS a
      WHERE o.id = due.id
        AND a.id = o.attempt_id
      RETURNING
        o.id AS "outboxId",
        o.attempt_id AS "attemptId",
        o.publication_claim_token AS "publicationClaimToken",
        o.publication_retry_count AS "publicationRetryCount",
        a.actor_user_id AS "actorUserId",
        a.tenant_id AS "tenantId",
        a.channel_id AS "channelId",
        a.bot_id AS "botId",
        a.bot_user_id AS "botUserId",
        a.application_id AS "applicationId",
        a.session_id AS "sessionId",
        a.requested_provider AS "requestedProvider",
        a.requested_model_id AS "requestedModelId"
    `);
    return Array.from(
      rows as unknown as Iterable<ModelChangePublicationWorkItem>,
    );
  }

  async markPublished(
    item: ModelChangePublicationWorkItem,
    now: Date,
  ): Promise<boolean> {
    const updated = await this.db
      .update(schema.modelChangeOutbox)
      .set({
        publishedAt: now,
        publicationClaimToken: null,
        publicationClaimUntil: null,
        publicationSafeErrorCode: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.modelChangeOutbox.id, item.outboxId),
          eq(
            schema.modelChangeOutbox.publicationClaimToken,
            item.publicationClaimToken,
          ),
        ),
      )
      .returning({ id: schema.modelChangeOutbox.id });
    return updated.length > 0;
  }

  async releasePublication(
    item: ModelChangePublicationWorkItem,
    safeErrorCode: string,
    nextAttemptAt: Date,
    now: Date,
  ): Promise<boolean> {
    const updated = await this.db
      .update(schema.modelChangeOutbox)
      .set({
        publicationClaimToken: null,
        publicationClaimUntil: nextAttemptAt,
        publicationRetryCount: sql`${schema.modelChangeOutbox.publicationRetryCount} + 1`,
        publicationSafeErrorCode: safeErrorCode,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.modelChangeOutbox.id, item.outboxId),
          eq(
            schema.modelChangeOutbox.publicationClaimToken,
            item.publicationClaimToken,
          ),
        ),
      )
      .returning({ id: schema.modelChangeOutbox.id });
    return updated.length > 0;
  }
}

interface ClassifiedDispatchError {
  safeCode: string;
  terminal: boolean;
}

function classifyDispatchError(error: unknown): ClassifiedDispatchError {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('unexpected model-change message ID')) {
    return { safeCode: 'hive_protocol_error', terminal: true };
  }
  if (message.startsWith('model_change_target_')) {
    return { safeCode: message.slice(0, 128), terminal: true };
  }
  if (
    (error instanceof Error && error.name === 'AbortError') ||
    message.toLowerCase().includes('timeout')
  ) {
    return { safeCode: 'hive_timeout', terminal: false };
  }
  const status = /Failed to (?:send input|update agent): (\d{3})/.exec(
    message,
  )?.[1];
  if (status) {
    const numeric = Number(status);
    return {
      safeCode: `hive_http_${status}`,
      terminal: numeric < 500 && ![408, 425, 429].includes(numeric),
    };
  }
  return { safeCode: 'hive_unavailable', terminal: false };
}

function retryAt(now: Date, retryCount: number): Date {
  const delay = Math.min(1_000 * 2 ** retryCount, MAX_BACKOFF_MS);
  return new Date(now.getTime() + delay);
}

@Injectable()
export class ModelChangeOutboxProcessor
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ModelChangeOutboxProcessor.name);
  private intervalHandle: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly store: ModelChangeOutboxStore,
    private readonly clawHive: ClawHiveService,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit(): void {
    if (process.env.MODEL_CHANGE_OUTBOX_ENABLED !== 'true') {
      this.logger.log('model-change outbox processor is disabled');
      return;
    }
    void this.runTick();
    this.intervalHandle = setInterval(() => {
      void this.runTick();
    }, MODEL_CHANGE_INTERVAL_MS);
    this.intervalHandle.unref();
  }

  onModuleDestroy(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  async processOnce(
    now = new Date(),
  ): Promise<{ dispatchedClaims: number; publicationClaims: number }> {
    const dispatchItems = await this.store.claimDue(
      MODEL_CHANGE_BATCH_SIZE,
      now,
    );
    await Promise.all(
      dispatchItems.map((item) => this.processDispatch(item, now)),
    );

    const publicationItems = await this.store.claimPublications(
      MODEL_CHANGE_BATCH_SIZE,
      new Date(),
    );
    await Promise.all(
      publicationItems.map((item) => this.processPublication(item, new Date())),
    );
    return {
      dispatchedClaims: dispatchItems.length,
      publicationClaims: publicationItems.length,
    };
  }

  async tryDispatch(
    attemptId: string,
  ): Promise<'pending' | 'dispatched' | 'failed'> {
    if (process.env.MODEL_CHANGE_OUTBOX_ENABLED !== 'true') return 'pending';
    const now = new Date();
    const item = await this.store.claimAttempt(attemptId, now);
    if (!item) return 'pending';
    const state = await this.processDispatch(item, now);
    if (state === 'dispatched') {
      const publicationItems = await this.store.claimPublications(
        MODEL_CHANGE_BATCH_SIZE,
        new Date(),
      );
      await Promise.all(
        publicationItems.map((publication) =>
          this.processPublication(publication, new Date()),
        ),
      );
    }
    return state;
  }

  private async runTick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.processOnce();
    } catch (error) {
      this.logger.error(
        `model-change outbox tick failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      this.running = false;
    }
  }

  private async processDispatch(
    item: ModelChangeOutboxWorkItem,
    now: Date,
  ): Promise<'pending' | 'dispatched' | 'failed'> {
    try {
      await this.dispatch(item);
      return (await this.store.markDispatched(item, new Date()))
        ? 'dispatched'
        : 'pending';
    } catch (error) {
      const classified = classifyDispatchError(error);
      const exhausted =
        item.retryCount + 1 >= MODEL_CHANGE_MAX_DISPATCH_ATTEMPTS;
      if (classified.terminal || exhausted) {
        await this.store.markFailed(item, classified.safeCode, new Date());
        return 'failed';
      }
      await this.store.markRetry(
        item,
        classified.safeCode,
        retryAt(now, item.retryCount),
        new Date(),
      );
      return 'pending';
    }
  }

  private async dispatch(item: ModelChangeOutboxWorkItem): Promise<void> {
    const model = {
      provider: item.requestedProvider,
      id: item.requestedModelId,
    };
    if (item.channelId && item.sessionId) {
      await this.clawHive.changeSessionModel(item.sessionId, model, {
        ...(item.tenantId ? { tenantId: item.tenantId } : {}),
        idempotencyKey: item.attemptId,
      });
      return;
    }

    if (!item.botId || !item.tenantId) {
      throw new Error('model_change_target_invalid');
    }
    const bot = await this.bots.getBotById(item.botId);
    const agentId = bot?.managedMeta?.agentId;
    if (!bot || !agentId || bot.tenantId !== item.tenantId) {
      throw new Error('model_change_target_invalid');
    }
    const agent = await this.clawHive.getAgent(agentId, item.tenantId);
    if (!agent) {
      throw new Error('model_change_target_agent_missing');
    }
    await this.clawHive.updateAgent(agentId, {
      tenantId: item.tenantId,
      metadata: {
        ...(agent.metadata ?? {}),
        tenantId: item.tenantId,
        botId: bot.botId,
        mentorId: bot.mentorId,
      },
      model,
    });

    const next = { ...(bot.extra ?? {}) };
    if (next.commonStaff) {
      next.commonStaff = { ...next.commonStaff, model };
    }
    if (next.personalStaff) {
      next.personalStaff = { ...next.personalStaff, model };
    }
    await this.bots.updateBotExtra(bot.botId, next);
  }

  private async processPublication(
    item: ModelChangePublicationWorkItem,
    now: Date,
  ): Promise<void> {
    try {
      if (!item.channelId || !item.botUserId) {
        throw new Error('model_change_publication_target_invalid');
      }
      const event: ChannelModelChangedEvent = {
        attemptId: item.attemptId,
        channelId: item.channelId,
        botId: item.botUserId,
        model: {
          provider: item.requestedProvider,
          id: item.requestedModelId,
        },
        source: 'dynamic',
        changedBy: item.actorUserId,
        changedAt: now.toISOString(),
      };
      await this.websocketGateway.sendToChannelMembers(
        item.channelId,
        WS_EVENTS.CHANNEL.MODEL_CHANGED,
        event,
      );
      await this.store.markPublished(item, new Date());
    } catch {
      await this.store.releasePublication(
        item,
        'websocket_unavailable',
        retryAt(now, item.publicationRetryCount),
        new Date(),
      );
    }
  }

  private get bots(): Pick<BotService, 'getBotById' | 'updateBotExtra'> {
    return this.moduleRef.get<
      Pick<BotService, 'getBotById' | 'updateBotExtra'>
    >(BOT_SERVICE_TOKEN, {
      strict: false,
    });
  }

  private get websocketGateway(): Pick<
    WebsocketGateway,
    'sendToChannelMembers'
  > {
    return this.moduleRef.get<Pick<WebsocketGateway, 'sendToChannelMembers'>>(
      WEBSOCKET_GATEWAY,
      {
        strict: false,
      },
    );
  }
}
