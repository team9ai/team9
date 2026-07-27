import { HttpException, Inject, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  DATABASE_CONNECTION,
  eq,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import { v7 as uuidv7 } from 'uuid';
import type { BotService } from '../bot/bot.service.js';
import { ChannelsService } from '../im/channels/channels.service.js';
import { BOT_SERVICE_TOKEN } from '../im/channels/channels.service.js';
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
import { ModelChangeOutboxProcessor } from './model-change-outbox.processor.js';

export type ModelChangeRequestResult =
  | { state: 'pending'; attemptId: string }
  | {
      state: 'dispatched';
      attemptId: string;
      model: { provider: string; id: string };
    }
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
    return {
      state: 'dispatched',
      attemptId: existing.id,
      model: {
        provider: existing.requestedProvider,
        id: existing.requestedModelId,
      },
    };
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
    private readonly modelPolicy: ModelPolicyService,
    private readonly moduleRef: ModuleRef,
    private readonly outboxProcessor: ModelChangeOutboxProcessor,
  ) {}

  async requestChannelModelChange(
    request: ChannelModelChangeRequest,
  ): Promise<ModelChangeRequestResult> {
    const normalized = this.normalizedRequest(request.model);
    let auditTarget: {
      tenantId?: string | null;
      channelId: string;
      botId?: string;
      botUserId?: string;
      installedApplicationId?: string | null;
      applicationId?: string | null;
      sessionId?: string | null;
      capability?: string;
    } = { channelId: request.channelId };
    const existing = await this.findExisting(request.idempotencyKey);
    if (existing) {
      this.assertSameRequest(existing, request.actorUserId, {
        channelId: request.channelId,
        model: normalized,
      });
      return stateFromExisting(existing);
    }

    try {
      const target = await this.channels.resolveModelManageTarget(
        request.channelId,
        request.actorUserId,
      );
      auditTarget = {
        tenantId: target.tenantId,
        channelId: request.channelId,
        botId: target.botId,
        botUserId: target.botUserId,
        installedApplicationId: target.installedApplicationId,
        applicationId: target.applicationId,
        sessionId: target.sessionId,
      };
      const capability = this.modelPolicy.assertDynamicSwitchAllowed(
        target.applicationId,
      );
      auditTarget.capability = capability;
      const approved = this.modelPolicy.assertModelAllowed(
        capability,
        request.model,
      );
      const persisted = await this.persistAccepted({
        request,
        approved,
        target: {
          tenantId: target.tenantId,
          channelId: request.channelId,
          botId: target.botId,
          botUserId: target.botUserId,
          installedApplicationId: target.installedApplicationId,
          applicationId: target.applicationId,
          sessionId: target.sessionId,
        },
      });
      return await this.confirmDispatch(persisted, approved);
    } catch (error) {
      if (error instanceof ModelChangeAuditUnavailableException) throw error;
      await this.persistRejected({
        request,
        normalized,
        ...auditTarget,
        reasonCode: exceptionCode(error),
      });
      throw error;
    }
  }

  async requestBotModelChange(
    request: BotModelChangeRequest,
  ): Promise<ModelChangeRequestResult> {
    const normalized = this.normalizedRequest(request.model);
    let auditTarget: {
      tenantId?: string | null;
      botId: string;
      botUserId?: string;
      installedApplicationId?: string | null;
      applicationId?: string | null;
      capability?: string;
    } = { botId: request.botId };
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
      if (bot) {
        auditTarget = {
          tenantId: bot.tenantId,
          botId: request.botId,
          botUserId: bot.userId,
          installedApplicationId: bot.installedApplicationId,
          applicationId: bot.applicationId,
        };
      }
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
      auditTarget.capability = capability;
      const approved = this.modelPolicy.assertModelAllowed(
        capability,
        request.model,
      );
      const persisted = await this.persistAccepted({
        request,
        approved,
        target: {
          tenantId: bot.tenantId,
          botId: bot.botId,
          botUserId: bot.userId,
          installedApplicationId: bot.installedApplicationId,
          applicationId: bot.applicationId,
          sessionId: null,
        },
      });
      return await this.confirmDispatch(persisted, approved);
    } catch (error) {
      if (error instanceof ModelChangeAuditUnavailableException) throw error;
      await this.persistRejected({
        request,
        normalized,
        ...auditTarget,
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
      botUserId: string;
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
          botUserId: input.target.botUserId,
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
      try {
        const existing = await this.findExisting(input.request.idempotencyKey);
        if (existing) {
          this.assertSameRequest(existing, input.request.actorUserId, {
            ...(input.target.channelId
              ? { channelId: input.target.channelId }
              : { botId: input.target.botId }),
            model: {
              provider: input.approved.provider,
              id: input.approved.id,
            },
          });
          return stateFromExisting(existing);
        }
      } catch (error) {
        if (error instanceof ModelChangeIdempotencyConflictException) {
          throw error;
        }
      }
      throw new ModelChangeAuditUnavailableException();
    }
    return { state: 'pending', attemptId };
  }

  private async persistRejected(input: {
    request: BaseModelChangeRequest;
    normalized: { provider: string; id: string };
    channelId?: string;
    botId?: string;
    botUserId?: string;
    tenantId?: string | null;
    installedApplicationId?: string | null;
    applicationId?: string | null;
    sessionId?: string | null;
    capability?: string;
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
        botUserId: input.botUserId,
        tenantId: input.tenantId,
        installedApplicationId: input.installedApplicationId,
        applicationId: input.applicationId,
        sessionId: input.sessionId,
        requestedProvider: input.normalized.provider,
        requestedModelId: input.normalized.id,
        capability: input.capability,
        decision: 'rejected',
        reasonCode: input.reasonCode,
        dispatchStatus: 'not_applicable',
      });
    } catch {
      try {
        const existing = await this.findExisting(input.request.idempotencyKey);
        if (existing) {
          this.assertSameRequest(existing, input.request.actorUserId, {
            ...(input.channelId
              ? { channelId: input.channelId }
              : { botId: input.botId }),
            model: input.normalized,
          });
          if (
            existing.decision === 'rejected' &&
            existing.reasonCode === input.reasonCode
          ) {
            return;
          }
        }
      } catch (error) {
        if (error instanceof ModelChangeIdempotencyConflictException) {
          throw error;
        }
      }
      throw new ModelChangeAuditUnavailableException();
    }
  }

  private async confirmDispatch(
    persisted: ModelChangeRequestResult,
    approved: ApprovedModelRef,
  ): Promise<ModelChangeRequestResult> {
    if (persisted.state !== 'pending') return persisted;
    try {
      const state = await this.outboxProcessor.tryDispatch(persisted.attemptId);
      return state === 'dispatched'
        ? {
            state,
            attemptId: persisted.attemptId,
            model: {
              provider: approved.provider,
              id: approved.id,
            },
          }
        : { state, attemptId: persisted.attemptId };
    } catch {
      // The durable row already exists. An immediate-claim failure is not a
      // failed mutation: the periodic processor can safely retry it.
      return persisted;
    }
  }

  private get bots(): Pick<BotService, 'getBotById' | 'isActiveTenantMember'> {
    return this.moduleRef.get<
      Pick<BotService, 'getBotById' | 'isActiveTenantMember'>
    >(BOT_SERVICE_TOKEN, {
      strict: false,
    });
  }
}
