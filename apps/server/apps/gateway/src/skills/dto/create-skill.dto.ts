import {
  IsString,
  MaxLength,
  IsOptional,
  IsIn,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { SkillType } from '@team9/database/schemas';

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
  type: SkillType;

  @IsString()
  @MaxLength(64)
  @IsOptional()
  icon?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SkillFileDto)
  @IsOptional()
  files?: SkillFileDto[];
}
