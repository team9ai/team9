import { IsString, MaxLength, IsOptional, IsIn } from 'class-validator';
import type { SkillAgentAccess } from '@team9/database/schemas';

export class UpdateSkillDto {
  @IsString()
  @MaxLength(255)
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @MaxLength(64)
  @IsOptional()
  icon?: string;

  @IsIn(['none', 'read', 'write'] as const)
  @IsOptional()
  agentAccess?: SkillAgentAccess;
}
