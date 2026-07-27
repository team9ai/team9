import { HttpException, Inject, Injectable } from '@nestjs/common';
import {
  DATABASE_CONNECTION,
  eq,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import { v7 as uuidv7 } from 'uuid';
import { BotService } from '../bot/bot.service.js';
import { ChannelsService } from '../im/channels/channels.service.js';
import {
  ModelChangeAuditUnavailableException,
  ModelChangeIdempotencyConflictException,
  ModelManageForbiddenException,
  ModelPolicyTargetInvalidException,
} from './model-policy.errors.js';
import {
  ModelPolicyService,
  type ApprovedModelRef,
  type RequestedModelRef,
} from './model-policy.service.js';

export type ModelChangeRequestResult =
  | { state: 'pending'; attemptId: string }
  | { state: 'dispatched'; attemptId: string }
  | { state: 'failed'; attemptId: string }
  | { state: 'rejected'; attemptId: string; reasonCode: string };

interface BaseModelChangeRequest {
  actorUserId: string;
  idempotencyKey: string;
  authSessionId?: string;
  correlationId?: string;
  model: RequestedModelRef;
}

export interface ChannelModelChangeRequest extends BaseModelChangeRequest {
  channelId: string;
}

export interface BotModelChangeRequest extends BaseModelChangeRequest {
  botId: string;
}

type ExistingAttempt = typeof schema.modelChangeAttempts.$inferSelect;

function boundedAuditValue(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return `<invalid:${typeof value}>`;
  const normalized = Array.from(value.trim(), (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127 ? '\uFFFD' : character;
  }).join('');
  return (normalized || '<empty>').slice(0, maxLength);
}

function exceptionCode(error: unknown): string {
  if (!(error instanceof HttpException)) return 'model_policy_internal_error';
  const response = error.getResponse();
  if (typeof response !== 'object' || response === null) {
    return 'model_policy_internal_error';
  }
  const code = (response as { code?: unknown }).code;
  return typeof code === 'string'
    ? code.slice(0, 64)
    : 'model_policy_internal_error';
}

function stateFromExisting(
  existing: ExistingAttempt,
): ModelChangeRequestResult {
  if (existing.decision === 'rejected') {
    return {
      state: 'rejected',
      attemptId: existing.id,
      reasonCode: existing.reasonCode,
    };
  }
  if (existing.dispatchStatus === 'dispatched') {
    return { state: 'dispatched', attemptId: existing.id };
  }
  if (existing.dispatchStatus === 'failed') {
    return { state: 'failed', attemptId: existing.id };
  }
  return { state: 'pending', attemptId: existing.id };
}

@Injectable()
export class ModelChangeCommandService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly channels: ChannelsService,
    private readonly bots: BotService,
    private readonly modelPolicy: ModelPolicyService,
  ) {}

  async requestChannelModelChange(
    request: ChannelModelChangeRequest,
  ): Promise<ModelChangeRequestResult> {
    const normalized = this.normalizedRequest(request.model);
    const existing = await this.findExisting(request.idempotencyKey);
    if (existing) {
      this.assertSameRequest(existing, request.actorUserId, {
        channelId: request.channelId,
        model: normalized,
      });
      return stateFromExisting(existing);
    }

    try {
      const target = await this.channels.resolveModelSwitchTarget(
        request.channelId,
        request.actorUserId,
      );
      const approved = this.modelPolicy.assertModelAllowed(
        target.capability,
        request.model,
      );
      return await this.persistAccepted({
        request,
        approved,
        target: {
          tenantId: target.tenantId,
          channelId: request.channelId,
          botId: target.botId,
          installedApplicationId: target.installedApplicationId,
          applicationId: target.applicationId,
          sessionId: target.sessionId,
        },
      });
    } catch (error) {
      if (error instanceof ModelChangeAuditUnavailableException) throw error;
      await this.persistRejected({
        request,
        normalized,
        channelId: request.channelId,
        reasonCode: exceptionCode(error),
      });
      throw error;
    }
  }

  async requestBotModelChange(
    request: BotModelChangeRequest,
  ): Promise<ModelChangeRequestResult> {
    const normalized = this.normalizedRequest(request.model);
    const existing = await this.findExisting(request.idempotencyKey);
    if (existing) {
      this.assertSameRequest(existing, request.actorUserId, {
        botId: request.botId,
        model: normalized,
      });
      return stateFromExisting(existing);
    }

    try {
      const bot = await this.bots.getBotById(request.botId);
      if (
        !bot ||
        bot.managedProvider !== 'hive' ||
        !bot.managedMeta?.agentId ||
        !bot.installedApplicationId ||
        !bot.applicationId ||
        !bot.tenantId ||
        !['common-staff', 'personal-staff', 'base-model-staff'].includes(
          bot.applicationId,
        )
      ) {
        throw new ModelPolicyTargetInvalidException();
      }
      if (
        (bot.ownerId !== request.actorUserId &&
          bot.mentorId !== request.actorUserId) ||
        !(await this.bots.isActiveTenantMember(
          request.actorUserId,
          bot.tenantId,
        ))
      ) {
        throw new ModelManageForbiddenException();
      }
      const capability = this.modelPolicy.assertDynamicSwitchAllowed(
        bot.applicationId,
      );
      const approved = this.modelPolicy.assertModelAllowed(
        capability,
        request.model,
      );
      return await this.persistAccepted({
        request,
        approved,
        target: {
          tenantId: bot.tenantId,
          botId: bot.botId,
          installedApplicationId: bot.installedApplicationId,
          applicationId: bot.applicationId,
          sessionId: null,
        },
      });
    } catch (error) {
      if (error instanceof ModelChangeAuditUnavailableException) throw error;
      await this.persistRejected({
        request,
        normalized,
        botId: request.botId,
        reasonCode: exceptionCode(error),
      });
      throw error;
    }
  }

  private normalizedRequest(model: RequestedModelRef) {
    return {
      provider: boundedAuditValue(model.provider, 128),
      id: boundedAuditValue(model.id, 256),
    };
  }

  private async findExisting(
    idempotencyKey: string,
  ): Promise<ExistingAttempt | null> {
    const [existing] = await this.db
      .select()
      .from(schema.modelChangeAttempts)
      .where(
        eq(
          schema.modelChangeAttempts.idempotencyKey,
          idempotencyKey.slice(0, 128),
        ),
      )
      .limit(1);
    return existing ?? null;
  }

  private assertSameRequest(
    existing: ExistingAttempt,
    actorUserId: string,
    expected: {
      channelId?: string;
      botId?: string;
      model: { provider: string; id: string };
    },
  ): void {
    if (
      existing.actorUserId !== actorUserId ||
      (expected.channelId !== undefined &&
        existing.channelId !== expected.channelId) ||
      (expected.botId !== undefined && existing.botId !== expected.botId) ||
      existing.requestedProvider !== expected.model.provider ||
      existing.requestedModelId !== expected.model.id
    ) {
      throw new ModelChangeIdempotencyConflictException();
    }
  }

  private async persistAccepted(input: {
    request: BaseModelChangeRequest;
    approved: ApprovedModelRef;
    target: {
      tenantId: string | null;
      channelId?: string;
      botId: string;
      installedApplicationId: string | null;
      applicationId: string | null;
      sessionId: string | null;
    };
  }): Promise<ModelChangeRequestResult> {
    const attemptId = uuidv7();
    try {
      await this.db.transaction(async (tx) => {
        await tx.insert(schema.modelChangeAttempts).values({
          id: attemptId,
          idempotencyKey: input.request.idempotencyKey.slice(0, 128),
          actorUserId: input.request.actorUserId,
          authSessionId: input.request.authSessionId?.slice(0, 128),
          correlationId: input.request.correlationId?.slice(0, 128),
          tenantId: input.target.tenantId,
          channelId: input.target.channelId,
          botId: input.target.botId,
          installedApplicationId: input.target.installedApplicationId,
          applicationId: input.target.applicationId,
          sessionId: input.target.sessionId,
          requestedProvider: input.approved.provider,
          requestedModelId: input.approved.id,
          capability: input.approved.capability,
          catalogVersion: input.approved.catalogVersion,
          decision: 'accepted',
          reasonCode: 'accepted',
          dispatchStatus: 'pending',
        });
        await tx.insert(schema.modelChangeOutbox).values({
          id: uuidv7(),
          attemptId,
          status: 'pending',
        });
      });
    } catch {
      throw new ModelChangeAuditUnavailableException();
    }
    return { state: 'pending', attemptId };
  }

  private async persistRejected(input: {
    request: BaseModelChangeRequest;
    normalized: { provider: string; id: string };
    channelId?: string;
    botId?: string;
    reasonCode: string;
  }): Promise<void> {
    try {
      await this.db.insert(schema.modelChangeAttempts).values({
        id: uuidv7(),
        idempotencyKey: input.request.idempotencyKey.slice(0, 128),
        actorUserId: input.request.actorUserId,
        authSessionId: input.request.authSessionId?.slice(0, 128),
        correlationId: input.request.correlationId?.slice(0, 128),
        channelId: input.channelId,
        botId: input.botId,
        requestedProvider: input.normalized.provider,
        requestedModelId: input.normalized.id,
        decision: 'rejected',
        reasonCode: input.reasonCode,
        dispatchStatus: 'not_applicable',
      });
    } catch {
      throw new ModelChangeAuditUnavailableException();
    }
  }
}
