import {
  IsString,
  MaxLength,
  IsOptional,
  IsIn,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { SkillType, SkillAgentAccess } from '@team9/database/schemas';

export class SkillFileDto {
  @IsString()
  @MaxLength(1024)
  path: string;

  @IsString()
  content: string;
}

export class CreateSkillDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsIn(['claude_code_skill', 'prompt_template', 'general'] as const)
  @IsOptional()
  type?: SkillType;

  @IsString()
  @MaxLength(64)
  @IsOptional()
  icon?: string;

  @IsIn(['none', 'read', 'write'] as const)
  @IsOptional()
  agentAccess?: SkillAgentAccess;

  // Initial files retained — used by import flows.
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SkillFileDto)
  @IsOptional()
  files?: SkillFileDto[];
}
