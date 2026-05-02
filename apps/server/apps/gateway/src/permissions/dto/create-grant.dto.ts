import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  IsDateString,
} from 'class-validator';

export class CreateGrantDto {
  @IsEnum(['agent', 'channel-session', 'execution-session', 'task'])
  subjectKind!: 'agent' | 'channel-session' | 'execution-session' | 'task';

  @IsUUID()
  subjectId!: string;

  @IsString()
  permissionKey!: string;

  @IsOptional()
  @IsObject()
  scopeMetadata?: Record<string, unknown>;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
