import {
  ArrayMaxSize,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateRequestDto {
  @IsString()
  permissionKey!: string;

  @IsObject()
  requestedMetadata!: Record<string, unknown>;

  @IsOptional()
  @IsString()
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
