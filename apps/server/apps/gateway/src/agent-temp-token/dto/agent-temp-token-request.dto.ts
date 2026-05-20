import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Equals,
} from 'class-validator';

export const AGENT_TEMP_TOKEN_AUDIENCES = [
  'team9-agent',
  'team9-ahand',
  'team9-capahub',
] as const;

export type AgentTempTokenAudience =
  (typeof AGENT_TEMP_TOKEN_AUDIENCES)[number];

export class AgentTempTokenRequestDto {
  @IsString()
  @MaxLength(1024)
  sessionId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  agentId?: string;

  @IsInt()
  @Equals(3600)
  ttlSeconds!: 3600;

  @IsArray()
  @ArrayNotEmpty()
  @IsIn([...AGENT_TEMP_TOKEN_AUDIENCES], { each: true })
  audiences!: AgentTempTokenAudience[];
}

export interface AgentTempTokenResponse {
  token: string;
  tokenId: string;
  expiresAt: string;
}
