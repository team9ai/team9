import {
  ArrayMaxSize,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Validate,
} from 'class-validator';
import { JsonMaxSize } from './validators.js';

export class CreateRequestDto {
  @IsString()
  permissionKey!: string;

  @IsObject()
  @Validate(JsonMaxSize, [4096])
  requestedMetadata!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsUUID()
  contextChannelId?: string;

  @IsOptional()
  @IsUUID()
  contextExecutionId?: string;

  @IsOptional()
  @IsUUID()
  contextRoutineId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID(undefined, { each: true })
  suggestedApproverIds?: string[];
}
