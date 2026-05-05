import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  IsDateString,
  MaxLength,
  Validate,
} from 'class-validator';
import { JsonMaxSize } from './validators.js';

export class CreateGrantDto {
  @IsEnum(['agent', 'channel-session', 'execution-session', 'task'])
  subjectKind!: 'agent' | 'channel-session' | 'execution-session' | 'task';

  @IsUUID()
  subjectId!: string;

  @IsString()
  permissionKey!: string;

  @IsOptional()
  @IsObject()
  @Validate(JsonMaxSize, [4096])
  scopeMetadata?: Record<string, unknown>;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
