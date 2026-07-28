import {
  Controller,
  Get,
  Patch,
  Body,
  Param,
  UseGuards,
  ForbiddenException,
  NotFoundException,
  ParseUUIDPipe,
  Headers,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Type } from 'class-transformer';
import {
  IsObject,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { AuthGuard, CurrentUser } from '@team9/auth';
import {
  ClawHiveService,
  type HiveAgentSnapshot,
  type HiveModelRef,
} from '@team9/claw-hive';
import { BotService } from './bot.service.js';
import { ModelChangeCommandService } from '../model-policy/model-change-command.service.js';
import { ModelChangeUnavailableException } from '../model-policy/model-policy.errors.js';
import {
  modelChangeStatusUrl,
  normalizeModelChangeIdempotencyKey,
  throwStoredModelChangeRejection,
} from '../model-policy/model-change-http.js';

class ModelRefDto implements HiveModelRef {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  provider!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(256)
  id!: string;
}

class UpdateBotModelDto {
  @IsObject()
  @ValidateNested()
  @Type(() => ModelRefDto)
  model!: ModelRefDto;
}

interface BotModelResponse {
  botId: string;
  agentId: string;
  model: HiveModelRef;
}

interface PendingBotModelChangeResponse {
  attemptId: string;
  idempotencyKey: string;
  statusUrl: string;
}

type BotModelMutationResponse =
  | (BotModelResponse & PendingBotModelChangeResponse)
  | PendingBotModelChangeResponse;

@Controller({ path: 'im/bots', version: '1' })
@UseGuards(AuthGuard)
export class BotModelController {
  constructor(
    private readonly botService: BotService,
    private readonly clawHiveService: ClawHiveService,
    private readonly modelChanges: ModelChangeCommandService,
  ) {}

  @Get(':botId/model')
  async getModel(
    @CurrentUser('sub') userId: string,
    @Param('botId', ParseUUIDPipe) botId: string,
  ): Promise<BotModelResponse> {
    const { bot, agentId } = await this.requireManagedHiveBot(botId);

    const agent = await this.clawHiveService.getAgent(agentId);
    if (!agent) {
      throw new NotFoundException('Agent not registered on hive');
    }

    // Read authorization: requester must be an active member of the bot's
    // tenant. Bot-default model isn't high-entropy, but it's still tenant
    // metadata — cross-tenant read should 403. Mentor/owner are always
    // members, so they pass this check too.
    await this.requireTenantMember(agent, userId);

    return { botId: bot.botId, agentId, model: agent.model };
  }

  @Patch(':botId/model')
  async updateModel(
    @CurrentUser('sub') userId: string,
    @Param('botId', ParseUUIDPipe) botId: string,
    @Body() dto: UpdateBotModelDto,
    @Headers('idempotency-key') requestedIdempotencyKey: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<BotModelMutationResponse> {
    const idempotencyKey = normalizeModelChangeIdempotencyKey(
      requestedIdempotencyKey,
    );
    const result = await this.modelChanges.requestBotModelChange({
      actorUserId: userId,
      botId,
      idempotencyKey,
      model: dto.model,
    });
    const statusUrl = modelChangeStatusUrl(result.attemptId);

    if (result.state === 'rejected') {
      throwStoredModelChangeRejection(result.reasonCode);
    }
    if (result.state === 'failed') {
      throw new ModelChangeUnavailableException();
    }
    if (result.state === 'pending') {
      response.status(202);
      return { attemptId: result.attemptId, idempotencyKey, statusUrl };
    }

    const { bot, agentId } = await this.requireManagedHiveBot(botId);
    response.status(200);
    return {
      botId: bot.botId,
      agentId,
      model: result.model,
      attemptId: result.attemptId,
      idempotencyKey,
      statusUrl,
    };
  }

  private async requireManagedHiveBot(botId: string): Promise<{
    bot: NonNullable<Awaited<ReturnType<BotService['getBotById']>>>;
    agentId: string;
  }> {
    const bot = await this.botService.getBotById(botId);
    if (!bot) throw new NotFoundException('Bot not found');

    if (bot.managedProvider !== 'hive' || !bot.managedMeta?.agentId) {
      throw new ForbiddenException(
        'Model switching is only supported for hive-managed bots',
      );
    }

    return {
      bot,
      agentId: bot.managedMeta.agentId,
    };
  }

  /**
   * Agent-pi returns `tenantId` either as a first-class field or — for
   * agents registered with older versions — nested under `metadata.tenantId`.
   * Accept either and treat missing as null.
   */
  private resolveAgentTenantId(agent: HiveAgentSnapshot): string | null {
    if (agent.tenantId) return agent.tenantId;
    const nested = agent.metadata?.tenantId;
    return typeof nested === 'string' ? nested : null;
  }

  private async requireTenantMember(
    agent: HiveAgentSnapshot,
    userId: string,
  ): Promise<void> {
    const tenantId = this.resolveAgentTenantId(agent);
    if (!tenantId) {
      // Agent without a tenant is a misconfiguration — don't leak it cross
      // user. Treat as forbidden rather than expose the raw agent.
      throw new ForbiddenException('Agent is not attached to a tenant');
    }
    if (!(await this.botService.isActiveTenantMember(userId, tenantId))) {
      throw new ForbiddenException(
        'Requester is not an active member of this workspace',
      );
    }
  }
}
