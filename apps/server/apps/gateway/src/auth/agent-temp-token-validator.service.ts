import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { env } from '@team9/shared';
import {
  AGENT_TEMP_TOKEN_CAPAHUB_AUDIENCE,
  AGENT_TEMP_TOKEN_ISSUER,
  AGENT_TEMP_TOKEN_USE,
} from '../agent-temp-token/agent-temp-token.constants.js';

export interface AgentTempTokenValidationContext {
  userId: string;
  botId: string;
  tenantId: string;
}

interface AgentTempTokenPayload {
  sub?: unknown;
  tenantId?: unknown;
  agentId?: unknown;
  botId?: unknown;
  tokenUse?: unknown;
}

@Injectable()
export class AgentTempTokenValidatorService {
  constructor(private readonly jwtService: JwtService) {}

  validateCapabilityHubToken(
    rawToken: string,
  ): AgentTempTokenValidationContext | null {
    let payload: AgentTempTokenPayload;
    try {
      payload = this.jwtService.verify<AgentTempTokenPayload>(rawToken, {
        publicKey: env.JWT_PUBLIC_KEY,
        algorithms: ['ES256'],
        audience: AGENT_TEMP_TOKEN_CAPAHUB_AUDIENCE,
        issuer: AGENT_TEMP_TOKEN_ISSUER,
      });
    } catch {
      return null;
    }

    if (payload.tokenUse !== AGENT_TEMP_TOKEN_USE) {
      return null;
    }

    const userId = this.nonEmptyString(payload.sub);
    const tenantId = this.nonEmptyString(payload.tenantId);
    const botId =
      this.nonEmptyString(payload.botId) ??
      this.nonEmptyString(payload.agentId);

    if (!userId || !tenantId || !botId) {
      return null;
    }

    return { userId, botId, tenantId };
  }

  private nonEmptyString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
  }
}
