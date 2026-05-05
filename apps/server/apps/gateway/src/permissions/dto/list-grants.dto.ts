import {
  IsBooleanString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class ListGrantsQueryDto {
  @IsOptional()
  @IsEnum(['agent', 'channel-session', 'execution-session', 'task'])
  subjectKind?: 'agent' | 'channel-session' | 'execution-session' | 'task';

  @IsOptional()
  @IsUUID()
  subjectId?: string;

  @IsOptional()
  @IsString()
  permissionKey?: string;

  @IsOptional()
  @IsBooleanString()
  includeRevoked?: string;
}
