import {
  IsString,
  MaxLength,
  IsOptional,
  IsIn,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SkillFileDto } from './create-skill.dto.js';
import type { SkillVersionStatus } from '@team9/database/schemas';

export class CreateVersionDto {
  @IsString()
  @MaxLength(255)
  @IsOptional()
  message?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SkillFileDto)
  files: SkillFileDto[];

  @IsIn(['published', 'suggested'] as const)
  status: Extract<SkillVersionStatus, 'published' | 'suggested'>;

  @IsString()
  @IsOptional()
  suggestedBy?: string;
}
