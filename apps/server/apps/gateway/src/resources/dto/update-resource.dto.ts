import {
  IsString,
  IsOptional,
  IsIn,
  IsObject,
  MaxLength,
} from 'class-validator';
import type { ResourceStatus } from '@team9/database/schemas';

export class UpdateResourceDto {
  @IsString()
  @MaxLength(255)
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsObject()
  @IsOptional()
  config?: Record<string, unknown>;

  @IsIn(['online', 'offline', 'error', 'configuring'] as const)
  @IsOptional()
  status?: ResourceStatus;
}
