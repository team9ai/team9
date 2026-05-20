import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  DATABASE_CONNECTION,
  and,
  eq,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import { env } from '@team9/shared';
import { v7 as uuidv7 } from 'uuid';
import {
  AGENT_TEMP_TOKEN_AUDIENCES,
  type AgentTempTokenRequestDto,
  type AgentTempTokenResponse,
} from './dto/agent-temp-token-request.dto.js';

const TEMP_TOKEN_TTL_SECONDS = 3600;
const TOKEN_USE = 'team9-agent-temp';
const TOKEN_ISSUER = 'team9';
const ALLOWED_AUDIENCES = new Set<string>(AGENT_TEMP_TOKEN_AUDIENCES);

interface BotAgentRow {
  id: string;
  userId: string;
  managedMeta: unknown;
}

@Injectable()
export class AgentTempTokenService {
  private readonly logger = new Logger(AgentTempTokenService.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly jwtService: JwtService,
  ) {}

  async issueToken(
    dto: AgentTempTokenRequestDto,
    callerBotUserId: string,
    callerTenantId: string | undefined,
  ): Promise<AgentTempTokenResponse> {
    this.validateRequestPolicy(dto);

    if (!callerTenantId) {
      throw new ForbiddenException('tenant context missing');
    }

    const bot = await this.findActiveBot(callerBotUserId);
    const managedAgentId = this.extractManagedAgentId(bot.managedMeta);
    if (!managedAgentId) {
      this.logger.warn(
        `issueToken: active bot has no managed agent id botUserId=${callerBotUserId}`,
      );
      throw new ForbiddenException('agentId does not belong to caller bot');
    }

    const requestedAgentId = dto.agentId;
    if (requestedAgentId && requestedAgentId !== managedAgentId) {
      this.logger.warn(
        `issueToken: agent mismatch botUserId=${callerBotUserId} requestedAgentId=${requestedAgentId} managedAgentId=${managedAgentId}`,
      );
      throw new ForbiddenException('agentId does not belong to caller bot');
    }

    const tokenId = uuidv7();
    const expiresAt = new Date(
      Date.now() + TEMP_TOKEN_TTL_SECONDS * 1000,
    ).toISOString();
    const agentId = requestedAgentId ?? managedAgentId;

    const token = this.jwtService.sign(
      {
        sub: callerBotUserId,
        tenantId: callerTenantId,
        sessionId: dto.sessionId,
        agentId,
        tokenUse: TOKEN_USE,
        jti: tokenId,
      },
      {
        privateKey: env.JWT_PRIVATE_KEY,
        algorithm: 'ES256',
        expiresIn: TEMP_TOKEN_TTL_SECONDS,
        audience: dto.audiences,
        issuer: TOKEN_ISSUER,
      },
    );

    return { token, tokenId, expiresAt };
  }

  private validateRequestPolicy(dto: AgentTempTokenRequestDto): void {
    if (!dto || typeof dto.sessionId !== 'string' || !dto.sessionId) {
      throw new BadRequestException('sessionId is required');
    }

    if (dto.ttlSeconds !== TEMP_TOKEN_TTL_SECONDS) {
      throw new BadRequestException('ttlSeconds must be 3600');
    }

    if (
      !Array.isArray(dto.audiences) ||
      dto.audiences.length === 0 ||
      dto.audiences.some((audience) => !ALLOWED_AUDIENCES.has(audience))
    ) {
      throw new BadRequestException('unsupported audience');
    }
  }

  private async findActiveBot(botUserId: string): Promise<BotAgentRow> {
    const rows = await this.db
      .select({
        id: schema.bots.id,
        userId: schema.bots.userId,
        managedMeta: schema.bots.managedMeta,
      })
      .from(schema.bots)
      .where(
        and(eq(schema.bots.userId, botUserId), eq(schema.bots.isActive, true)),
      )
      .limit(1);

    const bot = (rows as BotAgentRow[])[0];
    if (!bot) {
      this.logger.warn(`issueToken: no active bot for userId=${botUserId}`);
      throw new ForbiddenException('agentId does not belong to caller bot');
    }

    return bot;
  }

  private extractManagedAgentId(managedMeta: unknown): string | null {
    if (!managedMeta || typeof managedMeta !== 'object') {
      return null;
    }

    const agentId = (managedMeta as { agentId?: unknown }).agentId;
    return typeof agentId === 'string' && agentId ? agentId : null;
  }
}
