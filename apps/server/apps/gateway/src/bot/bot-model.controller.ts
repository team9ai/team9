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
} from '@nestjs/common';
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

@Controller({ path: 'im/bots', version: '1' })
@UseGuards(AuthGuard)
export class BotModelController {
  constructor(
    private readonly botService: BotService,
    private readonly clawHiveService: ClawHiveService,
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
  ): Promise<BotModelResponse> {
    const { bot, agentId } = await this.requireManagedHiveBot(botId);

    // Write authorization: only the bot's mentor or owner can change the
    // default model. Workspace admin override is left for a follow-up.
    if (bot.mentorId !== userId && bot.ownerId !== userId) {
      throw new ForbiddenException(
        'Only the bot mentor or owner can change its default model',
      );
    }

    // Pull the existing agent snapshot so we can preserve its metadata
    // (especially `tenantId`, which `updateAgent` requires).
    const agent = await this.clawHiveService.getAgent(agentId);
    if (!agent) throw new NotFoundException('Agent not registered on hive');

    const tenantId = this.resolveAgentTenantId(agent);
    if (!tenantId) {
      throw new ForbiddenException('Agent is not attached to a tenant');
    }

    // mentor/owner must also still be an active tenant member — blocks the
    // "ex-member is still named as mentor on the row" edge case.
    if (!(await this.botService.isActiveTenantMember(userId, tenantId))) {
      throw new ForbiddenException(
        'Requester is not an active member of this workspace',
      );
    }

    await this.clawHiveService.updateAgent(agentId, {
      tenantId,
      metadata: {
        ...(agent.metadata ?? {}),
        tenantId,
        botId: bot.botId,
        mentorId: bot.mentorId,
      },
      model: dto.model,
    });

    // Keep team9's local bot snapshot (`bots.extra.commonStaff.model` /
    // `personalStaff.model`) in sync with agent-pi. The local copy is a
    // cache used by StaffProfileSnapshot bootstrap — agent-pi remains the
    // authoritative source for runtime resolution.
    const next = { ...(bot.extra ?? {}) };
    if (next.commonStaff) {
      next.commonStaff = { ...next.commonStaff, model: dto.model };
    }
    if (next.personalStaff) {
      next.personalStaff = { ...next.personalStaff, model: dto.model };
    }
    await this.botService.updateBotExtra(bot.botId, next);

    return { botId: bot.botId, agentId, model: dto.model };
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
