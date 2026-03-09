import {
  IsString,
  IsOptional,
  IsIn,
  IsObject,
  MaxLength,
} from 'class-validator';
import type { ResourceType } from '@team9/database/schemas';

export class CreateResourceDto {
  @IsIn(['agent_computer', 'api'] as const)
  type: ResourceType;

  @IsString()
  @MaxLength(255)
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsObject()
  config: Record<string, unknown>;
}
